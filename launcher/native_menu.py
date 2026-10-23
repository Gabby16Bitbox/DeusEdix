"""A small WinForms menu adapter for the existing JavaScript command registry.

The WebView still owns command validation and keyboard shortcuts. Native items
display those shortcuts, but deliberately do not register a second shortcut
handler: editing text must continue to use the WebView's normal focus rules.
"""
import json
import re
import threading


_ID = re.compile(r'^m[0-9]{1,2}_[0-9]{1,3}$')


def _text(value, limit, field):
    if not isinstance(value, str) or not value or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError('Invalid ' + field)
    return value


def _item(value, known=None):
    if not isinstance(value, dict):
        raise ValueError('Invalid menu item')
    command = value.get('id')
    if not isinstance(command, str) or not _ID.fullmatch(command) or (known is not None and command not in known):
        raise ValueError('Invalid menu command')
    result = {'id': command}
    if 'label' in value:
        result['label'] = _text(value['label'], 120, 'label')
    for field in ('enabled', 'checked'):
        if field in value:
            if type(value[field]) is not bool:
                raise ValueError('Invalid ' + field)
            result[field] = value[field]
    if 'shortcut' in value:
        result['shortcut'] = '' if value['shortcut'] == '' else _text(value['shortcut'], 48, 'shortcut')
    return result


def _snapshot(value):
    if not isinstance(value, list) or not 1 <= len(value) <= 12:
        raise ValueError('Invalid menu list')
    result, ids = [], set()
    for menu in value:
        if not isinstance(menu, dict):
            raise ValueError('Invalid menu')
        title = _text(menu.get('title'), 40, 'menu title')
        entries = menu.get('items')
        if not isinstance(entries, list) or not 1 <= len(entries) <= 80:
            raise ValueError('Invalid menu items')
        items = []
        for entry in entries:
            if isinstance(entry, dict) and entry.get('sep') is True and 'id' not in entry:
                items.append({'sep': True})
                continue
            item = _item(entry)
            if 'label' not in item or item['id'] in ids:
                raise ValueError('Missing label or duplicate command')
            ids.add(item['id'])
            item.setdefault('enabled', True)
            item.setdefault('checked', False)
            item.setdefault('shortcut', '')
            items.append(item)
        result.append({'title': title, 'items': items})
    if len(ids) > 400:
        raise ValueError('Too many menu commands')
    return result


def _updates(value, known):
    if not isinstance(value, list) or len(value) > 400:
        raise ValueError('Invalid menu states')
    result, seen = [], set()
    for entry in value:
        item = _item(entry, known)
        if item['id'] in seen:
            raise ValueError('Duplicate menu state')
        seen.add(item['id'])
        result.append(item)
    return result


def _bindings():
    # pywebview has initialized pythonnet before a native form is available.
    # Importing lazily keeps the browser/failure fallback independent of .NET.
    import clr
    clr.AddReference('System.Windows.Forms')
    import System.Windows.Forms as forms
    from System import Action
    return forms, Action


def _caption(text):
    return text.replace('&', '&&')


class NativeMenus:
    """Install/update return False on failure; the HTML menu must then remain.

    All internal fields are private because pywebview enumerates public members
    of js_api objects. ``_last_error`` is available to launcher logging only.
    """

    def __init__(self, window, _native_bindings=None):
        self._window = window
        self._native_bindings = _native_bindings
        self._menu = None
        self._items = {}
        self._handlers = []
        self._structure = None
        self._last_error = ''

    def _on_ui(self, task):
        form = self._window.native
        if form is None or form.IsDisposed or form.Disposing or not form.IsHandleCreated:
            raise RuntimeError('Native window is not ready')
        if self._native_bindings is None:
            self._native_bindings = _bindings()
        _, action = self._native_bindings
        result, errors = [], []

        def run():
            try:
                result.append(task(form))
            except Exception as exc:
                errors.append(exc)

        if form.InvokeRequired:
            form.Invoke(action(run))
        else:
            run()
        if errors:
            raise errors[0]
        return result[0] if result else False

    def _dispatch(self, command):
        def run():
            try:
                self._window.evaluate_js('window.__menubar && window.__menubar.runCommand(%s)' % json.dumps(command))
            except Exception as exc:
                self._last_error = 'Command failed: ' + str(exc)
        threading.Thread(target=run, name='DeusEdix menu', daemon=True).start()

    @staticmethod
    def _apply(item, state):
        if 'label' in state:
            item.Text = _caption(state['label'])
        if 'enabled' in state:
            item.Enabled = state['enabled']
        if 'checked' in state:
            item.Checked = state['checked']
        if 'shortcut' in state:
            item.ShortcutKeyDisplayString = state['shortcut']

    def _sync_headings(self):
        # A modal tool disables every map command. Disable its headings too:
        # otherwise WinForms still handles Alt+E/F and steals the Studio's keys.
        for heading in self._menu.Items:
            enabled = any(getattr(item, 'Enabled', False) for item in heading.DropDownItems
                          if item in self._items.values())
            if not enabled:
                heading.HideDropDown()
            heading.Enabled = enabled
        self._menu.Enabled = any(heading.Enabled for heading in self._menu.Items)

    def install(self, menu_snapshot):
        try:
            snapshot = _snapshot(menu_snapshot)
            structure = [(menu['title'], [item.get('id') for item in menu['items']]) for menu in snapshot]

            def install_on_ui(form):
                if self._menu is not None and not self._menu.IsDisposed and self._structure == structure:
                    for menu in snapshot:
                        for state in menu['items']:
                            if 'id' in state:
                                self._apply(self._items[state['id']], state)
                    self._sync_headings()
                    return True
                forms, _ = self._native_bindings
                candidate = forms.MenuStrip()
                candidate.Name = 'DeusEdixNativeMenu'
                candidate.Dock = forms.DockStyle.Top
                candidate.TabStop = False
                candidate.GripStyle = forms.ToolStripGripStyle.Hidden
                items, handlers = {}, []
                previous_main = form.MainMenuStrip
                attached = False
                try:
                    for menu in snapshot:
                        # Standard Windows Alt+first-letter navigation.
                        heading = forms.ToolStripMenuItem('&' + _caption(menu['title']))
                        for state in menu['items']:
                            if state.get('sep'):
                                heading.DropDownItems.Add(forms.ToolStripSeparator())
                                continue
                            item = forms.ToolStripMenuItem()
                            self._apply(item, state)
                            command = state['id']

                            def clicked(sender, args, command=command):
                                if sender.Enabled:
                                    self._dispatch(command)

                            item.Click += clicked
                            handlers.append(clicked)
                            items[command] = item
                            heading.DropDownItems.Add(item)
                        candidate.Items.Add(heading)
                    form.SuspendLayout()
                    try:
                        form.Controls.Add(candidate)
                        attached = True
                        # A top-docked menu is laid out before the fill-docked
                        # WebView. No existing control bounds are assigned here.
                        candidate.SendToBack()
                        form.MainMenuStrip = candidate
                    finally:
                        form.ResumeLayout(True)
                except Exception:
                    if attached:
                        form.Controls.Remove(candidate)
                        form.MainMenuStrip = previous_main
                    candidate.Dispose()
                    raise
                old = self._menu
                self._menu, self._items, self._handlers, self._structure = candidate, items, handlers, structure
                self._sync_headings()
                if old is not None and old is not candidate:
                    try:
                        form.Controls.Remove(old)
                        old.Dispose()
                    except Exception:
                        # The replacement is already usable. Failure to dispose
                        # an obsolete detached control must not hide its menu.
                        pass
                return True

            ok = bool(self._on_ui(install_on_ui))
            self._last_error = '' if ok else 'Native menu was not installed'
            return ok
        except Exception as exc:
            self._last_error = 'Menu install failed: ' + str(exc)
            return False

    def update(self, states):
        try:
            # Validate once before UI dispatch and again against the current
            # registry on the UI thread, where installs/updates are serialized.
            validated = _updates(states, self._items)

            def update_on_ui(form):
                if self._menu is None or self._menu.IsDisposed:
                    return False
                current = _updates(validated, self._items)
                for state in current:
                    self._apply(self._items[state['id']], state)
                self._sync_headings()
                return True

            ok = bool(self._on_ui(update_on_ui))
            self._last_error = '' if ok else 'Native menu is unavailable'
            return ok
        except Exception as exc:
            self._last_error = 'Menu update failed: ' + str(exc)
            return False
