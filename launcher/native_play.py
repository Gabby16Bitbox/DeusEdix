"""Host only the current project's own game process (Revision, or the original Deus Ex) in a native Game panel.

The game remains the user's locally installed executable. No renderer, engine or
game assets are included here. Win32 calls stay behind a small adapter so the
ownership, restoration and geometry rules can be tested without running a game.
"""
import ctypes
from ctypes import wintypes
import math
import os
from pathlib import Path
import secrets
import sys
import threading
import time


WS_CHILD = 0x40000000
WS_POPUP = 0x80000000
WS_CAPTION = 0x00C00000
WS_THICKFRAME = 0x00040000
WS_MINIMIZEBOX = 0x00020000
WS_MAXIMIZEBOX = 0x00010000
WS_SYSMENU = 0x00080000
WS_EX_APPWINDOW = 0x00040000
WS_EX_WINDOWEDGE = 0x00000100
WS_EX_CLIENTEDGE = 0x00000200
GWL_STYLE = -16
GWL_EXSTYLE = -20


def _payload(value):
    if not isinstance(value, dict):
        raise ValueError('Invalid Game panel request')
    session = value.get('session')
    if not isinstance(session, str) or not 16 <= len(session) <= 256:
        raise ValueError('Invalid project session')
    visible = value.get('visible', True)
    if type(visible) is not bool:
        raise ValueError('Invalid Game panel visibility')
    if 'processToken' in value and (not isinstance(value['processToken'], str) or not 1 <= len(value['processToken']) <= 256):
        raise ValueError('Invalid Play process token')
    rect = value.get('rect')
    if not isinstance(rect, dict):
        raise ValueError('Missing Game panel bounds')
    numbers = [value.get('dpr', 1)] + [rect.get(k) for k in ('x', 'y', 'width', 'height')]
    if any(type(n) not in (int, float) or not math.isfinite(n) for n in numbers):
        raise ValueError('Invalid Game panel bounds')
    dpr, x, y, width, height = numbers
    if not .25 <= dpr <= 8 or max(abs(x), abs(y), width, height) > 65536 or width < 0 or height < 0:
        raise ValueError('Game panel bounds are out of range')
    return session, (x, y, width, height), dpr, visible


def _bounds(rect, dpr, viewport):
    """CSS pixels -> the WebView's device pixels, clipped to its client area."""
    x, y, width, height = rect
    vw, vh = viewport
    left = max(0, min(vw, round(x * dpr)))
    top = max(0, min(vh, round(y * dpr)))
    right = max(left, min(vw, round((x + width) * dpr)))
    bottom = max(top, min(vh, round((y + height) * dpr)))
    # UE1 rounds an odd renderer width up to an even value. Asking for the odd
    # size again in repair_child produces an endless WM_SIZE / SetRes cycle,
    # restoring top-level styles and screen offsets inside the child panel.
    # Round down inside the available area (at most one unused pixel per edge).
    return left, top, (right - left) // 2 * 2, (bottom - top) // 2 * 2


def _child_styles(style, exstyle):
    return ((style | WS_CHILD) & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX |
                                   WS_MAXIMIZEBOX | WS_SYSMENU),
            exstyle & ~(WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE))


def _active_worker(session):
    manager = sys.modules.get('project_server')
    if manager is None or manager.WORKER:
        raise RuntimeError('Open a project before using embedded Play')
    supervisor = manager.SUPERVISOR
    if not supervisor.lock.acquire(timeout=.5):
        raise RuntimeError('The project is changing; try Play again')
    try:
        worker = supervisor.active
        if (not worker or worker['process'].poll() is not None or
                not secrets.compare_digest(session, worker['session'])):
            raise RuntimeError('This project session is no longer active')
        return manager, worker
    finally:
        supervisor.lock.release()


def _owned_session(session):
    manager, worker = _active_worker(session)
    state = manager.request(worker['url'] + 'api/play_session', worker['session'], timeout=2)
    _, current = _active_worker(session)
    if current is not worker:
        raise RuntimeError('The project changed while opening Game')
    if not isinstance(state, dict):
        raise RuntimeError('The project returned an invalid Play session')
    if state.get('launching') and not state.get('owned') and not state.get('error'):
        return state
    if not state.get('owned') or not state.get('running'):
        raise RuntimeError(state.get('error') or 'The project has no running Play session')
    if type(state.get('pid')) is not int or state['pid'] <= 0 or not state.get('token'):
        raise RuntimeError('The Play session has no verified process identity')
    try:
        if int(state['created']) <= 0:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise RuntimeError('The Play session has no process creation identity') from None
    return state


def _bindings():
    import clr
    clr.AddReference('System.Windows.Forms')
    clr.AddReference('System.Drawing')
    import System.Windows.Forms as forms
    from System import Action
    from System.Drawing import Point, Color
    return forms, Action, Point, Color


class _Win32:
    def __init__(self):
        self.user = ctypes.WinDLL('user32', use_last_error=True)
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        u, k = self.user, self.kernel
        pointer = ctypes.c_ssize_t
        self._get_long = getattr(u, 'GetWindowLongPtrW', u.GetWindowLongW)
        self._set_long = getattr(u, 'SetWindowLongPtrW', u.SetWindowLongW)
        self._get_long.argtypes, self._get_long.restype = [wintypes.HWND, ctypes.c_int], pointer
        self._set_long.argtypes, self._set_long.restype = [wintypes.HWND, ctypes.c_int, pointer], pointer
        signatures = {
            'GetParent': ([wintypes.HWND], wintypes.HWND),
            'SetParent': ([wintypes.HWND, wintypes.HWND], wintypes.HWND),
            'IsWindow': ([wintypes.HWND], wintypes.BOOL),
            'IsWindowVisible': ([wintypes.HWND], wintypes.BOOL),
            'IsWindowEnabled': ([wintypes.HWND], wintypes.BOOL),
            'EnableWindow': ([wintypes.HWND, wintypes.BOOL], wintypes.BOOL),
            'GetWindowThreadProcessId': ([wintypes.HWND, ctypes.POINTER(wintypes.DWORD)], wintypes.DWORD),
            'GetWindowRect': ([wintypes.HWND, ctypes.POINTER(wintypes.RECT)], wintypes.BOOL),
            'ClientToScreen': ([wintypes.HWND, ctypes.POINTER(wintypes.POINT)], wintypes.BOOL),
            'GetClientRect': ([wintypes.HWND, ctypes.POINTER(wintypes.RECT)], wintypes.BOOL),
            'GetClassNameW': ([wintypes.HWND, wintypes.LPWSTR, ctypes.c_int], ctypes.c_int),
            'SetWindowPos': ([wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                              ctypes.c_int, ctypes.c_int, wintypes.UINT], wintypes.BOOL),
            'GetForegroundWindow': ([], wintypes.HWND),
            'SetForegroundWindow': ([wintypes.HWND], wintypes.BOOL),
            'SetFocus': ([wintypes.HWND], wintypes.HWND),
            'AttachThreadInput': ([wintypes.DWORD, wintypes.DWORD, wintypes.BOOL], wintypes.BOOL),
            'GetAsyncKeyState': ([ctypes.c_int], ctypes.c_short),
            'GetCursorPos': ([ctypes.POINTER(wintypes.POINT)], wintypes.BOOL),
            'ClipCursor': ([ctypes.POINTER(wintypes.RECT)], wintypes.BOOL),
            'GetAncestor': ([wintypes.HWND, wintypes.UINT], wintypes.HWND),
            'IsChild': ([wintypes.HWND, wintypes.HWND], wintypes.BOOL),
        }
        for name, (args, result) in signatures.items():
            fn = getattr(u, name)
            fn.argtypes, fn.restype = args, result
        k.OpenProcess.argtypes, k.OpenProcess.restype = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE
        k.CloseHandle.argtypes = [wintypes.HANDLE]
        k.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        k.QueryFullProcessImageNameW.restype = wintypes.BOOL
        k.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        k.GetProcessTimes.restype = wintypes.BOOL
        k.WaitForSingleObject.argtypes, k.WaitForSingleObject.restype = [wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD
        k.GetCurrentThreadId.restype = wintypes.DWORD
        self._enum_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        u.EnumWindows.argtypes, u.EnumWindows.restype = [self._enum_type, wintypes.LPARAM], wintypes.BOOL

    def process(self, pid):
        handle = self.kernel.OpenProcess(0x1000 | 0x00100000, False, pid)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            name, size = ctypes.create_unicode_buffer(32768), wintypes.DWORD(32768)
            times = [wintypes.FILETIME() for _ in range(4)]
            if not self.kernel.QueryFullProcessImageNameW(handle, 0, name, ctypes.byref(size)):
                raise ctypes.WinError(ctypes.get_last_error())
            if not self.kernel.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)):
                raise ctypes.WinError(ctypes.get_last_error())
            return {'handle': handle, 'pid': pid, 'path': name.value,
                    'created': str((times[0].dwHighDateTime << 32) | times[0].dwLowDateTime)}
        except Exception:
            self.close(handle)
            raise

    def close(self, handle):
        if handle:
            self.kernel.CloseHandle(handle)

    def alive(self, process):
        return self.kernel.WaitForSingleObject(process['handle'], 0) == 258

    def pid(self, hwnd):
        pid = wintypes.DWORD()
        self.user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return int(pid.value)

    def find_window(self, pid):
        candidates = []
        def visit(hwnd, _):
            if self.pid(hwnd) == pid and self.user.IsWindowVisible(hwnd) and not self.user.GetParent(hwnd):
                # An engine startup error is a #32770 dialog; embedding that
                # would incorrectly announce a playable viewport. Revision's
                # extended client registers its own Unreal viewport class.
                name = ctypes.create_unicode_buffer(256)
                self.user.GetClassNameW(hwnd, name, len(name))
                if name.value.lower() not in ('unrealwindow', 'unrealviewport',
                        'unrealwwindowsviewportwindow', 'revisionunrealwwindowsviewportwindow',
                        'revisionunrealwwindowsviewportwindowlite',
                        'deusexunrealwwindowsviewportwindow'):        # the original game's (15 Oct 2026)
                    return True
                rect = wintypes.RECT()
                if self.user.GetClientRect(hwnd, ctypes.byref(rect)):
                    area = (rect.right - rect.left) * (rect.bottom - rect.top)
                    if area > 10000:
                        candidates.append((area, int(hwnd)))
            return True
        self.user.EnumWindows(self._enum_type(visit), 0)
        # Revision also uses a temporary dialog while loading a map. Ignore it
        # and let the caller keep waiting for the real viewport (or time out).
        return max(candidates)[1] if candidates else None

    def snapshot(self, hwnd):
        rect = wintypes.RECT()
        if not self.user.GetWindowRect(hwnd, ctypes.byref(rect)):
            raise ctypes.WinError(ctypes.get_last_error())
        return dict(parent=self.user.GetParent(hwnd), style=int(self._get_long(hwnd, GWL_STYLE)) & 0xffffffff,
                    exstyle=int(self._get_long(hwnd, GWL_EXSTYLE)) & 0xffffffff,
                    enabled=bool(self.user.IsWindowEnabled(hwnd)),
                    rect=(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top))

    def style(self, hwnd, index, value):
        ctypes.set_last_error(0)
        previous = self._set_long(hwnd, index, value)
        if not previous and ctypes.get_last_error():
            raise ctypes.WinError(ctypes.get_last_error())

    def parent(self, hwnd, parent):
        ctypes.set_last_error(0)
        previous = self.user.SetParent(hwnd, parent)
        if not previous and ctypes.get_last_error():
            raise ctypes.WinError(ctypes.get_last_error())

    def position(self, hwnd, rect, frame=False):
        # The renderer belongs to a different input thread. A synchronous size
        # notification can block the WinForms UI until the JS bridge times out,
        # then the late attach is immediately undone by the error's detach.
        # Do not let UE1 rewrite child coordinates in WM_WINDOWPOSCHANGING.
        flags = 0x0004 | 0x0010 | 0x0040 | 0x4000 | 0x0400 | 0x2000 | (0x0020 if frame else 0)
        if not self.user.SetWindowPos(hwnd, None, *rect, flags):
            raise ctypes.WinError(ctypes.get_last_error())

    def child_geometry(self, hwnd, parent):
        rect, origin = wintypes.RECT(), wintypes.POINT(0, 0)
        if not self.user.GetWindowRect(hwnd, ctypes.byref(rect)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not self.user.ClientToScreen(parent, ctypes.byref(origin)):
            raise ctypes.WinError(ctypes.get_last_error())
        return (rect.left - origin.x, rect.top - origin.y,
                rect.right - rect.left, rect.bottom - rect.top)

    def repair_child(self, hwnd, parent, width, height):
        # UE1's SetRes can restore overlapped-window styles after initialization
        # or a renderer resize. Reapply only when that actually happened, never
        # resize a healthy viewport on every timer tick.
        style = int(self._get_long(hwnd, GWL_STYLE)) & 0xffffffff
        exstyle = int(self._get_long(hwnd, GWL_EXSTYLE)) & 0xffffffff
        child, child_ex = _child_styles(style, exstyle)
        wrong_parent = self.user.GetParent(hwnd) != parent
        # Original Deus Ex can keep WS_CHILD but move the viewport to screen
        # coordinates during SetRes. Styles alone do not detect that drift.
        wrong_bounds = self.child_geometry(hwnd, parent) != (0, 0, width, height)
        if style == child and exstyle == child_ex and not wrong_parent and not wrong_bounds:
            return False
        if style != child:
            self.style(hwnd, GWL_STYLE, child)
        if exstyle != child_ex:
            self.style(hwnd, GWL_EXSTYLE, child_ex)
        if wrong_parent:
            self.parent(hwnd, parent)
        # A frame-changed notification here causes UE1 to run SetRes again,
        # recreating the very same frame and repeating WM_SIZE indefinitely.
        self.position(hwnd, (0, 0, width, height), frame=False)
        return True

    def enabled(self, hwnd, value):
        self.user.EnableWindow(hwnd, value)

    def exists(self, hwnd):
        return bool(hwnd and self.user.IsWindow(hwnd))

    def foreground(self, form, hwnd):
        active = self.user.GetForegroundWindow()
        root = self.user.GetAncestor(active, 2) if active else None
        return active in (form, hwnd) or root == form

    def focus(self, hwnd, form):
        current = self.kernel.GetCurrentThreadId()
        target = self.user.GetWindowThreadProcessId(hwnd, None)
        joined = bool(target != current and self.user.AttachThreadInput(current, target, True))
        try:
            self.user.SetForegroundWindow(form)
            self.user.SetFocus(hwnd)
        finally:
            if joined:
                self.user.AttachThreadInput(current, target, False)

    def release_cursor(self):
        self.user.ClipCursor(None)

    def key(self, vk):
        return bool(self.user.GetAsyncKeyState(vk) & 0x8000)

    def cursor(self):
        point = wintypes.POINT()
        self.user.GetCursorPos(ctypes.byref(point))
        return point.x, point.y


class NativeGamePanel:
    def __init__(self, window, game_folder, *, _win=None, _native_bindings=None,
                 _session_lookup=None, _worker_check=None, _clock=None):
        self._window, self._game_folder = window, game_folder
        self._win, self._bindings = _win, _native_bindings
        self._session_lookup = _session_lookup or _owned_session
        self._worker_check = _worker_check or _active_worker
        self._clock = _clock or time.monotonic
        self._panel = self._timer = None
        self._process = self._hwnd = self._original = None
        self._session = self._token = None
        self._captured = False
        self._visible = True
        self._error = ''
        self._handlers = []
        self._last_mouse = False
        self._last_release = False
        self._rect = None
        self._game_size = None
        self._target_size = None
        self._last_resize = self._last_repair = 0
        self._style_repairs = 0
        self._supported = sys.platform == 'win32' or _win is not None

    def _on_ui(self, task):
        form = self._window.native
        if form is None or form.IsDisposed or form.Disposing or not form.IsHandleCreated:
            raise RuntimeError('The desktop window is not ready')
        if self._bindings is None:
            self._bindings = _bindings()
        if self._win is None:
            self._win = _Win32()
        result, error, finished, cancelled = [], [], threading.Event(), threading.Event()
        def run():
            if cancelled.is_set():
                finished.set()
                return
            try:
                result.append(task(form))
            except Exception as exc:
                error.append(exc)
            finally:
                finished.set()
        if form.InvokeRequired:
            form.BeginInvoke(self._bindings[1](run))
            if not finished.wait(3):
                cancelled.set()
                raise RuntimeError('The desktop window is busy; try again')
        else:
            run()
        if error:
            raise error[0]
        return result[0] if result else None

    def _state(self, **extra):
        return dict(supported=self._supported, attached=self._hwnd is not None,
                    captured=self._captured, pid=self._process['pid'] if self._process else None,
                    error=self._error, **extra)

    def capabilities(self):
        return dict(self._state(), releaseShortcut='Shift+F1', mode='native-window')

    def _same_process(self):
        return (self._process and self._win.alive(self._process) and self._win.exists(self._hwnd)
                and self._win.pid(self._hwnd) == self._process['pid'])

    def _ensure_panel(self, form):
        if self._panel is not None and not self._panel.IsDisposed:
            return
        forms, _, _, color = self._bindings
        panel = forms.Panel()
        panel.Name = 'DeusEdixGamePanel'
        panel.BackColor = color.Black
        panel.TabStop = False
        panel.Visible = False
        form.Controls.Add(panel)
        self._panel = panel
        timer = forms.Timer()
        timer.Interval = 40
        def tick(sender, args):
            try:
                self._tick(form)
            except Exception as exc:
                self._error = 'Game panel: ' + str(exc)
                self._release(form)
        def clicked(sender, args):
            if self._visible:
                self._capture(form)
        timer.Tick += tick
        panel.MouseDown += clicked
        self._handlers = [tick, clicked]
        self._timer = timer

    def _layout(self, form, rect, dpr, visible):
        browser = getattr(form, 'webview', None)
        if browser is None or browser.IsDisposed:
            raise RuntimeError('The WebView is unavailable')
        point = self._bindings[2]
        origin = form.PointToClient(browser.PointToScreen(point(0, 0)))
        bounds = _bounds(rect, dpr, (int(browser.ClientSize.Width), int(browser.ClientSize.Height)))
        x, y, width, height = bounds
        self._visible = visible and width >= 4 and height >= 4
        if not self._visible:
            self._release(form)
            self._panel.Visible = False
            return
        self._panel.SetBounds(int(origin.X) + x, int(origin.Y) + y, width, height)
        self._panel.Visible = True
        self._panel.BringToFront()
        self._target_size = width, height
        self._resize_game()
        self._rect = rect, dpr

    def _resize_game(self):
        # Follow drag geometry immediately with the host panel, but coalesce
        # costly renderer resets to the latest size at most ten times/second.
        now = self._clock()
        if (self._same_process() and self._target_size and self._game_size != self._target_size
                and (self._game_size is None or now - self._last_resize >= .1)):
            self._win.position(self._hwnd, (0, 0, *self._target_size), frame=False)
            self._game_size = self._target_size
            self._last_resize = self._last_repair = now

    def _capture(self, form):
        if self._same_process() and self._visible:
            self._win.enabled(self._hwnd, True)
            self._win.focus(self._hwnd, int(form.Handle.ToInt64()))
            self._captured = bool(self._win.foreground(int(form.Handle.ToInt64()), self._hwnd))
            if not self._captured:
                self._win.enabled(self._hwnd, False)
                self._win.release_cursor()

    def _release(self, form):
        if self._win is None:
            return
        if self._same_process():
            browser = getattr(form, 'webview', None)
            if (browser is not None and not browser.IsDisposed and
                    self._win.foreground(int(form.Handle.ToInt64()), self._hwnd)):
                self._win.focus(int(browser.Handle.ToInt64()), int(form.Handle.ToInt64()))
            self._win.enabled(self._hwnd, False)
        if self._hwnd is not None or self._captured:
            self._win.release_cursor()
        self._captured = False

    def _detach(self, form):
        if self._timer:
            self._timer.Stop()
        if self._hwnd is not None or self._captured:
            self._win.release_cursor()
        failure = None
        if self._same_process() and self._original:
            original = self._original
            try:
                # Restore while the process handle still pins the identity.
                self._win.parent(self._hwnd, original['parent'])
                self._win.style(self._hwnd, GWL_STYLE, original['style'])
                self._win.style(self._hwnd, GWL_EXSTYLE, original['exstyle'])
                self._win.enabled(self._hwnd, original['enabled'])
                self._win.position(self._hwnd, original['rect'], frame=True)
            except Exception as exc:
                failure = exc
        if failure:
            # Do not dispose a parent that may still contain a live game HWND.
            raise RuntimeError('Could not detach the game window: ' + str(failure))
        if self._panel:
            self._panel.Visible = False
        if self._process:
            self._win.close(self._process['handle'])
        self._process = self._hwnd = self._original = None
        self._session = self._token = None
        self._game_size = None
        self._target_size = None
        self._last_resize = self._last_repair = 0
        self._captured = False

    def _tick(self, form):
        if not self._same_process():
            self._detach(form)
            return
        if self._visible:
            self._resize_game()
            now = self._clock()
            # A queued resize needs time to reach the game before measuring it.
            if self._game_size and now - self._last_repair >= .1:
                if self._win.repair_child(self._hwnd, int(self._panel.Handle.ToInt64()), *self._game_size):
                    self._style_repairs += 1
                self._last_repair = now
        foreground = self._win.foreground(int(form.Handle.ToInt64()), self._hwnd)
        release = self._win.key(0x10) and self._win.key(0x70)
        mouse = self._win.key(1)
        if foreground and release and not self._last_release:
            self._release(form)
        elif foreground and mouse and not self._last_mouse and not self._captured and self._visible:
            x, y = self._win.cursor()
            point = self._bindings[2]
            origin = self._panel.PointToScreen(point(0, 0))
            if origin.X <= x < origin.X + self._panel.Width and origin.Y <= y < origin.Y + self._panel.Height:
                self._capture(form)
        elif not foreground and self._captured:
            # Alt+Tab must never leave the pointer trapped in another window.
            self._win.release_cursor()
            self._win.enabled(self._hwnd, False)
            self._captured = False
        self._last_release, self._last_mouse = release, mouse

    def embed(self, value):
        process = None
        try:
            if not self._supported:
                raise RuntimeError('Embedded Play is available in the Windows desktop app')
            session, rect, dpr, visible = _payload(value)
            state = self._session_lookup(session)
            if value.get('processToken') and value['processToken'] != state.get('token'):
                raise RuntimeError('This Play process has been replaced by a newer session')
            if state.get('launching') and not state.get('owned') and not state.get('error'):
                self._error = ''
                return self._state(pending=True)
            expected = self._game_folder()
            if not expected:
                raise RuntimeError('The local Deus Ex installation is not configured')
            # a project plays Revision (Revision\System\Revision.exe) or the original game (System\DeusEx.exe)
            expected = {os.path.normcase(str((Path(expected) / exe).resolve()))
                        for exe in ('Revision/System/Revision.exe', 'System/DeusEx.exe')}
            if self._win is None:
                self._win = _Win32()
            process = self._win.process(state['pid'])
            if (os.path.normcase(str(Path(process['path']).resolve())) not in expected or
                    str(process['created']) != str(state['created']) or not self._win.alive(process)):
                raise RuntimeError('The Play process no longer matches the local game installation')
            def attach(form):
                nonlocal process
                self._worker_check(session)
                if (self._same_process() and self._session == session and self._token == state['token'] and
                        self._process['created'] == process['created'] and self._process['pid'] == process['pid']):
                    self._layout(form, rect, dpr, visible)
                    return self._state()
                if self._hwnd is not None:
                    self._detach(form)
                hwnd = self._win.find_window(process['pid'])
                if not hwnd:
                    return self._state(pending=True)
                self._ensure_panel(form)
                self._layout(form, rect, dpr, visible)
                original = self._win.snapshot(hwnd)
                self._process, process = process, None
                self._hwnd, self._original = hwnd, original
                self._session, self._token = session, state['token']
                try:
                    style, exstyle = _child_styles(original['style'], original['exstyle'])
                    self._win.style(hwnd, GWL_STYLE, style)
                    self._win.style(hwnd, GWL_EXSTYLE, exstyle)
                    self._win.parent(hwnd, int(self._panel.Handle.ToInt64()))
                    self._layout(form, rect, dpr, visible)
                    self._timer.Start()
                    self._release(form)
                except Exception:
                    self._detach(form)
                    raise
                return self._state()
            self._error = ''
            return self._on_ui(attach)
        except Exception as exc:
            self._error = str(exc)
            return self._state()
        finally:
            if process is not None:
                self._win.close(process['handle'])

    def resize(self, value):
        try:
            session, rect, dpr, visible = _payload(value)
            self._worker_check(session)
            def resize_on_ui(form):
                if (session != self._session or not self._same_process() or
                        (value.get('processToken') and value['processToken'] != self._token)):
                    raise RuntimeError('The embedded Play session has ended')
                self._layout(form, rect, dpr, visible)
                return self._state()
            self._error = ''
            return self._on_ui(resize_on_ui)
        except Exception as exc:
            self._error = str(exc)
            return self._state()

    def release(self):
        try:
            self._on_ui(self._release)
            self._error = ''
        except Exception as exc:
            self._error = str(exc)
        return self._state()

    def detach(self):
        try:
            self._on_ui(self._detach)
            self._error = ''
        except Exception as exc:
            self._error = str(exc)
        return self._state()

    def status(self):
        try:
            if self._hwnd is not None:
                self._on_ui(lambda form: self._detach(form) if not self._same_process() else None)
        except Exception as exc:
            self._error = str(exc)
        return self._state()
