"""DeusEdix: the map editor in its own window.

    DeusEdix.exe                         the project hub (each project prepares its workspace only
                                         when an engine operation needs it)
    deusedix-cli.exe --run script.py     runs one of the editor's Python scripts (scripted maps)
    DeusEdix.exe --browser               the editor in the web browser instead of its own window (also by
                                         itself when Edge WebView2 is missing or under Wine; DEUSEDIX_BROWSER=1)
    deusedix-cli.exe --setup | --build | --install | --find-game
    deusedix-cli.exe --install-native    DeusEdixNav into every game's System (the installer)
    deusedix-cli.exe --uninstall-cleanup [--game-files] [--projects]
                                         the uninstaller: the games' settings as they were; with --game-files
                                         also the maps, mods and DeusEdixNav it put into the games; with
                                         --projects the user's projects too
    deusedix-cli.exe --set-game <Deus Ex folder>

The editor's code is not inside the program: it sits next to it (tools\\mapkit, src\\DeusEdix), in the
user's install folder, where it also keeps its caches, runs and workspace. The program is Python with
the libraries the code needs, a window (WebView2) and this launcher.
"""
import json
import os
import re
import socket
import sys
import threading
import traceback
from pathlib import Path

FROZEN = getattr(sys, 'frozen', False)
APP = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parents[1] / 'build' / 'app'
KIT = APP / 'tools' / 'mapkit'
CONFIG = APP / 'deusedix.json'
LOGS = APP / 'logs'
STEAM = {'Deus Ex: Game of the Year Edition on Steam': 'https://store.steampowered.com/app/6910/',
         'Deus Ex: Game of the Year Edition on GOG': 'https://www.gog.com/en/game/deus_ex',
         'Deus Ex: Revision on Steam': 'https://store.steampowered.com/app/397550/'}
STORES = ('https://store.steampowered.com/', 'https://www.gog.com/')
VERSION = '0.1.44'


def trace(*a):
    """One line in logs\\launcher.log: what the launcher did, for when something goes wrong."""
    try:
        import time
        LOGS.mkdir(exist_ok=True)
        with open(LOGS / 'launcher.log', 'a', encoding='utf-8') as f:
            f.write('%s %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), ' '.join(str(x) for x in a)))
    except OSError:
        pass


def _paths():
    for p in (KIT / 'editor', KIT, APP / 'tools'):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))


def _config():
    try:
        return json.loads(CONFIG.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def _write_config(game):
    cfg = _config()
    cfg.update(game=str(game), package='DeusEdix')
    CONFIG.write_text(json.dumps(cfg, indent=1), encoding='utf-8')


def _check(folder, target='vanilla'):
    """The same test as settings.check_game, before settings is imported (it reads the config once): what
    is missing to make maps for `target`. The original game is always needed (its engine is the editor's);
    Revision only for Revision's maps (each project is made for one of them; the editor's own workspace,
    "Existing workspace", is Revision's)."""
    folder = Path(folder)
    missing = []
    if not (folder / 'System' / 'Editor.dll').is_file() or not (folder / 'System' / 'DeusEx.exe').is_file():
        missing.append('Deus Ex: Game of the Year Edition')
    if target == 'revision' and not (folder / 'Revision' / 'System' / 'Revision.exe').is_file():
        missing.append('Deus Ex: Revision')
    return missing


def _game():
    """The game folder from the config, else found through Steam (and saved): (folder or None, missing)."""
    cfg = _config()
    if cfg.get('game') and not _check(cfg['game']):
        return Path(cfg['game']), []
    _paths()
    import settings
    found = settings.find_game('revision') or settings.find_game('vanilla')     # with Revision if there is one
    if found:
        _write_config(found)
        return found, []
    return ((Path(cfg['game']) if cfg.get('game') else None),
            _check(cfg['game']) if cfg.get('game') else ['Deus Ex: Game of the Year Edition'])


def _free_port():
    for port in range(8790, 8890):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return 0


# ---------------------------------------------------------------- the window
PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0d1420;color:#d8e2ee;font:15px/1.5 Segoe UI,Arial,sans-serif;display:flex;align-items:center;
justify-content:center;height:100vh}main{max-width:560px;padding:32px}h1{font-weight:600;letter-spacing:.06em;margin:0 0 4px}
h1 span{color:#89b9e8}small{color:#7f8fa3;letter-spacing:.2em}#msg{margin:24px 0 8px;min-height:3em;white-space:pre-line}
.bad{color:#ff6b6b}a{color:#89b9e8}button{background:#1d2b40;color:#d8e2ee;border:1px solid #33496a;padding:8px 16px;
font:inherit;cursor:pointer;margin:4px 8px 4px 0}button:hover{background:#26395a}.bar{height:3px;background:#1d2b40;margin-top:16px}
.bar i{display:block;height:3px;width:30%;background:#89b9e8;animation:a 1.4s infinite ease-in-out}
@keyframes a{0%{margin-left:0}50%{margin-left:70%}100%{margin-left:0}}</style></head><body><main>
<h1>Deus<span>Edix</span></h1><small>MAP EDITOR</small><div id="msg">Starting...</div><div id="extra"></div>
<div class="bar" id="bar"><i></i></div></main></body></html>"""


class Api:
    """What the start page can ask the launcher (pywebview js_api). Its own state is private (_name):
    pywebview walks every public attribute, and walking the window froze the program."""

    def __init__(self):
        self._window = None
        self._picked = threading.Event()
        self._folder = None
        self._menus = None
        self._game_panel = None
        self._game_panel_lock = threading.Lock()
        self._close_lock = threading.Lock()
        self._close_ready = False

    def _on_closing(self):
        # pywebview runs this event on the UI thread. Return immediately so a
        # save dialog, preference request or worker shutdown can finish.
        if self._close_ready:
            return True
        if self._close_lock.acquire(blocking=False):
            threading.Thread(target=self._finish_close, daemon=True).start()
        return False

    def _finish_close(self):
        try:
            answer, received = [], threading.Event()

            def completed(value):
                answer.append(value)
                received.set()

            self._window.evaluate_js("""(async () => {
                try {
                    if (window.__editor?.confirmProjectLeave &&
                        !(await window.__editor.confirmProjectLeave())) return {ok:false};
                    await window.__flushProjectPreferences?.();
                    return {ok:true};
                } catch (error) { return {ok:false, error:String(error.message || error)}; }
            })()""", callback=completed)
            # A user may be considering the existing Save / Discard dialog.
            received.wait()
            result = answer[0]
            if not isinstance(result, dict) or not result.get('ok'):
                if isinstance(result, dict) and result.get('error'):
                    self._close_error(result['error'])
                return
            # A cancelled Save / Discard dialog must leave Play intact. Only
            # restore the native game window after the user accepted closing.
            if self._game_panel is not None:
                state = self._game_panel.detach()
                if state.get('attached'):
                    raise RuntimeError(state.get('error') or 'Stop Play before closing DeusEdix')
            _shutdown_projects()
            self._close_ready = True
            try:
                self._window.evaluate_js('window.__projectNavigation = true')
            except Exception:
                pass
            self._window.destroy()
        except Exception as exc:
            self._close_error(str(exc))
        finally:
            self._close_lock.release()

    def _close_error(self, message):
        trace('close postponed:', message)
        try:
            self._window.evaluate_js('alert(%s)' % json.dumps('DeusEdix is still open.\n' + message))
        except Exception:
            pass

    def install_menus(self, snapshot):
        from native_menu import NativeMenus
        if self._menus is None:
            self._menus = NativeMenus(self._window)
        ok = self._menus.install(snapshot)
        if not ok:
            trace(self._menus._last_error)
        return ok

    def update_menus(self, states):
        return self._menus.update(states) if self._menus is not None else False

    def _play_panel(self):
        with self._game_panel_lock:
            if self._game_panel is None:
                from native_play import NativeGamePanel
                self._game_panel = NativeGamePanel(self._window, lambda: _config().get('game'))
        return self._game_panel

    def game_capabilities(self):
        return self._play_panel().capabilities()

    def game_embed(self, request):
        return self._play_panel().embed(request)

    def game_resize(self, request):
        return self._play_panel().resize(request)

    def game_release(self):
        return self._play_panel().release()

    def game_detach(self):
        return self._play_panel().detach()

    def game_status(self):
        return self._play_panel().status()

    def pick(self):
        import webview
        r = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if r:
            self._folder = r[0]
            self._picked.set()

    def open(self, url):
        if url.startswith(STORES):
            os.startfile(url)

    # asked by the editor's menu bar (menubar.js)
    def open_url(self, url):
        """The guide (served by the editor here) or a web page, in the user's browser."""
        if re.match(r'^(https://|http://(127\.0\.0\.1|localhost):\d+/)', str(url)):
            os.startfile(url)

    def fullscreen(self):
        self._window.toggle_fullscreen()

    def version(self):
        return VERSION

    def exit(self):
        trace('closed from File > Exit')
        self._window.destroy()


def _say(window, text, bad=False, extra='', busy=True):
    js = ("document.getElementById('msg').textContent=%s;document.getElementById('msg').className=%s;"
          "document.getElementById('extra').innerHTML=%s;document.getElementById('bar').style.display=%s;"
          % (json.dumps(text), json.dumps('bad' if bad else ''), json.dumps(extra), json.dumps('block' if busy else 'none')))
    try:
        window.evaluate_js(js)
    except Exception:
        pass


def _start(window, api):
    for _ in range(100):                             # the start page first
        try:
            if window.evaluate_js('document.getElementById("msg") !== null'):
                break
        except Exception:
            pass
        threading.Event().wait(0.1)
    trace('page ready')
    try:
        game, missing = _game()
        trace('game', game, missing or 'ok')
        while missing:
            links = ''.join('<div><a href="#" onclick="pywebview.api.open(%s);return false">Get %s</a></div>'
                            % (json.dumps(url), name) for name, url in STEAM.items())
            _say(window, 'DeusEdix needs Deus Ex: Game of the Year Edition (Steam or GOG). Deus Ex: Revision (Steam) '
                         'is optional: installed in the same "Deus Ex" folder, it lets you make maps for Revision too.%s\n'
                         'Pick the folder, or install the game first.'
                 % (('\nIn %s: missing %s.' % (game, ', '.join(missing))) if game else ''), bad=True,
                 extra='<button onclick="pywebview.api.pick()">Pick the Deus Ex folder...</button>' + links, busy=False)
            api._picked.clear()
            api._picked.wait()
            missing = _check(api._folder)
            game = Path(api._folder)
            if not missing:
                _write_config(game)
        _paths()
        import importlib
        import settings
        importlib.reload(settings)                   # the game folder may have been picked just now
        if api._close_ready:
            return
        _say(window, 'Opening projects...')
        url = _serve()
        window.load_url(url)
        _SERVED['window'] = True
        trace('editor opened', url)
        (LOGS / 'start-error.txt').unlink(missing_ok=True)       # an old failure, no longer true
    except Exception as e:
        trace('start failed', repr(e))
        LOGS.mkdir(exist_ok=True)
        (LOGS / 'start-error.txt').write_text(traceback.format_exc(), encoding='utf-8')
        _say(window, 'DeusEdix could not start: %s\n(details in %s)' % (e, LOGS / 'start-error.txt'), bad=True, busy=False)


_SERVED = {}


def _serve():
    """The editor's server on a free port, started once: its address when it answers."""
    if _SERVED.get('url'):
        return _SERVED['url']
    port = _free_port()
    os.environ['DEUSEDIX_PORT'] = str(port)
    sys.argv = [sys.argv[0], '--no-browser', '--port', str(port)]
    import server
    trace('server on port', port)
    threading.Thread(target=server.main, daemon=True).start()
    url = 'http://127.0.0.1:%d/' % port
    for _ in range(100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) == 0:
                break
        threading.Event().wait(0.1)
    _SERVED['url'] = url
    return url


# ---------------------------------------------------------------- without the window: the web browser
# The window is Edge WebView2 driven through .NET (pywebview, pythonnet). Where they are missing (an old
# Windows without WebView2, Wine/Proton with Mono instead of .NET) the editor, a web page, opens in the
# player's browser instead (17 Oct 2026: a tester with Mono could not open DeusEdix at all).
def _webview2():
    """The installed Edge WebView2 runtime's version, or '' (Microsoft's documented registry keys)."""
    try:
        import winreg
    except ImportError:
        return ''
    client = r'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    for hive, key in ((winreg.HKEY_LOCAL_MACHINE, 'SOFTWARE\\WOW6432Node\\' + client),
                      (winreg.HKEY_LOCAL_MACHINE, 'SOFTWARE\\' + client),
                      (winreg.HKEY_CURRENT_USER, 'Software\\' + client)):
        try:
            with winreg.OpenKey(hive, key) as k:
                version = str(winreg.QueryValueEx(k, 'pv')[0])
            if version and version != '0.0.0.0':
                return version
        except OSError:
            pass
    return ''


def _wine():
    """True under Wine or Proton (Linux, Steam Deck, macOS)."""
    try:
        import ctypes
        return hasattr(ctypes.WinDLL('ntdll'), 'wine_get_version')
    except (OSError, AttributeError):
        return False


def _message(text, error=False):
    """A plain Windows message box (no .NET needed): blocks until OK."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, 'DeusEdix', 0x10 if error else 0x40)
    except Exception:
        pass


def browser(reason):
    """The editor in the player's web browser; DeusEdix closes by itself when its last page is closed
    (browser_session: the pages say they are open)."""
    trace('browser mode:', reason)
    try:
        game, missing = _game()
        trace('game', game, missing or 'ok')
        if missing:
            _message('DeusEdix needs Deus Ex: Game of the Year Edition (Steam or GOG) and could not find it.\n\n'
                     'Tell it where the game is (the folder with System\\DeusEx.exe) with:\n'
                     '    deusedix-cli.exe --set-game "<Deus Ex folder>"\n'
                     'in DeusEdix\'s folder, then start DeusEdix again.%s'
                     % (('\n\nIn %s: missing %s.' % (game, ', '.join(missing))) if game else ''), error=True)
            return
        _paths()
        os.environ['DEUSEDIX_BROWSER_MODE'] = '1'          # every page (hub, projects) says it is open
        url = _serve()
        import browser_session
        trace('editor opened in the browser', url)
        (LOGS / 'start-error.txt').unlink(missing_ok=True)
        os.startfile(url)
        if not browser_session.wait_for_first(90):
            # no browser opened it: say where it is, and wait for a page a while longer
            trace('no page yet: showing the address')
            threading.Thread(target=_message, args=('DeusEdix is running (%s).\n\nOpen this address in your web '
                                                     'browser:\n%s\n\nDeusEdix closes by itself when you close its page.'
                                                     % (reason, url),), daemon=True).start()
            if not browser_session.wait_for_first(600):
                trace('no page opened: closing')
                return
        browser_session.wait_until_closed()
        trace('the last page was closed: closing')
    except Exception as e:
        trace('browser start failed', traceback.format_exc())
        LOGS.mkdir(exist_ok=True)
        (LOGS / 'start-error.txt').write_text(traceback.format_exc(), encoding='utf-8')
        _message('DeusEdix could not start: %s\n(details in %s)' % (e, LOGS / 'start-error.txt'), error=True)
    finally:
        try:
            _shutdown_projects()
        except Exception as exc:
            trace('closing the projects:', exc)
        os._exit(0)


def _shutdown_projects():
    # Do not import/start a server while closing an early startup error page.
    manager = sys.modules.get('project_server')
    if manager is not None and not manager.WORKER:
        manager.SUPERVISOR.shutdown()


def gui(args=()):
    LOGS.mkdir(exist_ok=True)
    log = open(LOGS / 'editor.log', 'a', encoding='utf-8', buffering=1)
    sys.stdout = sys.stderr = log                    # a windowed program has no console
    import faulthandler
    faulthandler.enable(file=log)
    if os.environ.get('DEUSEDIX_DEBUG'):
        faulthandler.dump_traceback_later(40, repeat=False, file=log)     # where every thread is, if it hangs
    trace('DeusEdix', VERSION, 'starting in', APP)
    if '--browser' in args or os.environ.get('DEUSEDIX_BROWSER') == '1':
        browser('asked for the browser')
    if _wine():
        browser('Wine or Proton: the editor\'s own window needs Windows')
    if not _webview2():
        browser('Microsoft Edge WebView2 is not installed: the editor\'s own window needs it')
    try:
        import webview
    except Exception:
        trace('no window library', traceback.format_exc())
        browser('the editor\'s own window could not load (.NET Framework)')
    api = Api()
    window = webview.create_window('DeusEdix', html=PAGE, js_api=api, width=1600, height=960, min_size=(1024, 640),
                                   background_color='#0d1420')
    api._window = window
    window.events.closing += api._on_closing
    try:
        webview.start(_start, (window, api), gui='edgechromium', private_mode=False,
                      storage_path=str(APP / 'webview'), debug=bool(os.environ.get('DEUSEDIX_DEBUG')))
        trace('window closed')
    except Exception:
        trace('window failed', traceback.format_exc())
        if not _SERVED.get('window'):              # it never showed the editor: the browser instead
            browser('the editor\'s own window could not open')
    # The normal closing event already did this. If WebView2 failed instead,
    # keep the process alive until a running build/game can retire safely.
    while True:
        try:
            _shutdown_projects()
            break
        except Exception as exc:
            trace('waiting for project before exit:', exc)
            threading.Event().wait(1)
    os._exit(0)


# ---------------------------------------------------------------- the console twin
def cli(args):
    if args[0] == '--run':                           # a scripted map: python <script> [args]
        _paths()
        import runpy
        script = Path(args[1]).resolve()
        sys.argv = [str(script)] + args[2:]
        sys.path.insert(0, str(script.parent))
        runpy.run_path(str(script), run_name='__main__')
        return 0
    if args[0] == '--set-game':                     # the game folder, when it was not found (GOG elsewhere...)
        if len(args) < 2:
            print('usage: deusedix-cli.exe --set-game "<Deus Ex folder>"')
            return 2
        missing = _check(args[1])
        if missing:
            print('not a Deus Ex folder for DeusEdix: missing', ', '.join(missing))
            return 1
        _write_config(Path(args[1]))
        print('game folder set:', Path(args[1]))
        return 0
    if args[0] == '--find-game':
        game, missing = _game()
        print(game or '', '|', ', '.join(missing) or 'ok')
        return 0 if not missing else 1
    _paths()
    import workspace
    if args[0] == '--setup':
        return 0 if workspace.ensure(print, force='--force' in args) else 1
    if args[0] == '--build':
        ok, lines = workspace.build(print)
        return 0 if ok else 1
    if args[0] == '--install':
        ok, lines = workspace.install(print)
        print('\n'.join(lines))
        return 0 if ok else 1
    if args[0] == '--install-native':
        ok, lines = workspace.install_native_everywhere(print)
        return 0 if ok else 1
    if args[0] == '--uninstall-cleanup':
        report = []
        say = lambda *a: (report.append(' '.join(str(x) for x in a)), print(*a))
        ok = True
        try:                                    # Revision.ini and the original DeusEx.ini as they were
            import project_game
            done, errors = project_game.deactivate_all()
            for ini in done:
                say('restored', ini)
            for error in errors:
                say('game settings were left as they are:', error)
                ok = False
        except Exception as e:                      # the workspace is removed anyway
            say('game settings were left as they are:', e)
            ok = False
        finally:
            workspace.remove_workspace(say)
        # what the user chose in the uninstaller, each on its own (one that stops does not stop the other)
        for flag, step in (('--game-files', workspace.remove_game_files), ('--projects', workspace.remove_projects)):
            if flag in args:
                try:
                    ok = step(say)[0] and ok
                except Exception as e:
                    say(flag, 'stopped:', e)
                    ok = False
        # the uninstaller names this file when something stayed (a running game, a locked file)
        try:
            Path(os.environ.get('TEMP') or '.', 'DeusEdix-uninstall.log').write_text('\n'.join(report) + '\n',
                                                                                    encoding='utf-8')
        except OSError:
            pass
        return 0 if ok else 1
    print(__doc__)
    return 2


def main():
    args = sys.argv[1:]
    if args and args[0].startswith('--') and args[0] != '--browser':
        sys.exit(cli(args))
    gui(args)


if __name__ == '__main__':
    main()
