"""Project hub and process-pinned editor sessions.

Each worker imports its own workspace's code once. Switching never rebinds paths
under an in-flight save, import or engine build. Only the hub owns child processes.
"""
import atexit
import contextlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request

import settings

WORKER = os.environ.get('DEUSEDIX_PROJECT_WORKER') == '1'
SESSION = os.environ.get('DEUSEDIX_SESSION') if WORKER else secrets.token_hex(24)
HUB_URL = os.environ.get('DEUSEDIX_HUB_URL', '')
HOME_URL = ''
_guard = threading.Lock()
_operations = 0
_retiring = False
_runtime_lock = threading.Lock()
_runtime_ready = False


class ProjectTransitionError(RuntimeError):
    """A project switch can wait for work, but must not retry past a running game."""
    CODES = {'project_busy': True, 'game_running': False}

    def __init__(self, message, code):
        if code not in self.CODES:
            raise ValueError('Unknown project transition error code.')
        super().__init__(message)
        self.code = code
        self.retryable = self.CODES[code]


def error_payload(error):
    """Keep structured transition errors through worker -> hub -> browser HTTP."""
    payload = dict(error=str(error))
    if isinstance(error, ProjectTransitionError):
        payload.update(code=error.code, retryable=error.retryable)
    return payload


def current():
    if not WORKER:
        return None
    return settings.current()


def context():
    info = current() or {}
    return dict(info, session=SESSION, homeUrl=HUB_URL if WORKER else HOME_URL)


def page(html):
    # Bind every module's fetch, including delayed saves and imported media, to
    # the session that rendered this page. Reusing a port cannot redirect writes.
    value = json.dumps(context()).replace('<', '\\u003c')
    import project_preferences
    prefs = json.dumps(project_preferences.load((current() or {}).get('id'))).replace('<', '\\u003c')
    bootstrap = '''<script>window.__projectContext=CONTEXT;
(() => { const original=window.fetch.bind(window), session=window.__projectContext.session;
window.fetch=(input,init={})=>{const url=new URL(typeof input==='string'?input:input.url,location.href);
if(url.origin===location.origin && url.pathname.startsWith('/api/')) {
const headers=new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
headers.set('X-DeusEdix-Session',session); init={...init,headers}; }
return original(input,init);}; })();</script>'''.replace('CONTEXT', value)
    bootstrap += '<script>window.__projectPreferences=' + prefs + ';</script><script src="/static/project-storage.js"></script>'
    if os.environ.get('DEUSEDIX_BROWSER_MODE') == '1':     # DeusEdix in the web browser: it closes with its pages
        import browser_session
        bootstrap += browser_session.PAGE_SCRIPT
    return html.replace('<head>', '<head>' + bootstrap, 1)


def authorized(headers):
    return bool(SESSION) and secrets.compare_digest(headers.get('X-DeusEdix-Session', ''), SESSION)


@contextlib.contextmanager
def operation():
    global _operations
    with _guard:
        if _retiring:
            raise RuntimeError('This project has been closed. Return to Projects to open it again.')
        _operations += 1
    try:
        yield
    finally:
        with _guard:
            _operations -= 1


def retire(game_running, value=True):
    global _retiring
    with _guard:
        if value and game_running():
            raise ProjectTransitionError('Close the game before switching projects.', 'game_running')
        if value and _operations:
            raise ProjectTransitionError('Waiting for the current project operation to finish.', 'project_busy')
        _retiring = value


def status():
    with _guard:
        return dict(ok=True, project=current(), operations=_operations, retiring=_retiring)


def ensure_runtime():
    global _runtime_ready
    if _runtime_ready or not getattr(settings, 'MANAGED_PROJECT', False):
        return
    with _runtime_lock:
        if _runtime_ready:
            return
        import workspace
        if not workspace.ensure():
            raise RuntimeError('The project workspace could not be prepared. Check the configured game folder.')
        if workspace.needs_build():
            ok, lines = workspace.build()
            if not ok:
                raise RuntimeError('The project runtime could not be compiled: ' + '\n'.join(lines[-12:]))
        _runtime_ready = True


def request(url, token, body=None, timeout=30):
    headers = {'X-DeusEdix-Session': token}
    raw = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        raw = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=raw, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read())
            message = payload.get('error', str(exc)) if isinstance(payload, dict) else str(exc)
        except (ValueError, AttributeError):
            payload = None
            message = str(exc)
        if not isinstance(message, str):
            message = str(exc)
        if isinstance(payload, dict):
            code = payload.get('code')
            if isinstance(code, str) and code in ProjectTransitionError.CODES and \
                    payload.get('retryable') is ProjectTransitionError.CODES[code]:
                raise ProjectTransitionError(message, code) from exc
        raise RuntimeError(message) from exc


def _game_running():
    # either game of this game folder (projects are made for Revision or for the original game): their own
    # programs only, not another install or a mod's DeusEx.exe elsewhere
    from game_process import WindowsProcesses
    for profile in settings.TARGETS.values():
        exe = (settings.GAME / profile['root'] if profile['root'] else settings.GAME) / 'System' / profile['exe']
        if exe.is_file() and WindowsProcesses(exe).list():
            return True
    return False


class Supervisor:
    def __init__(self, game_running=None):
        self.lock = threading.Lock()
        self.stop_lock = threading.Lock()
        self.retired_lock = threading.Lock()
        self.active = None
        self.used_ports = set()
        self.retired = {}
        self.game_running = game_running or _game_running

    def _port(self):
        # Never reuse a worker port during this hub session; the session header
        # independently protects stale tabs across application restarts.
        for port in range(8890, 9990):
            if port in self.used_ports:
                continue
            with socket.socket() as sock:
                try:
                    sock.bind(('127.0.0.1', port))
                except OSError:
                    continue
            self.used_ports.add(port)
            return port
        raise RuntimeError('No free local port is available for a project.')

    def _retire(self, worker):
        if worker and worker['process'].poll() is None:
            try:
                request(worker['url'] + 'api/project/retire', worker['session'], {}, timeout=30)
            except (TimeoutError, urllib.error.URLError) as exc:
                raise RuntimeError('Closing project: waiting for Play preview and game settings to be restored. '
                                   'The backend did not respond; the project has not been force-closed. '
                                   'Stop Play, wait, then try closing again.') from exc

    def _stop(self, worker):
        if not worker:
            return
        # A timer may already be stopping this worker when GUI shutdown drains
        # the retired list. Keep process handles and the logfile single-owner.
        with self.stop_lock:
            if worker.get('_stopped'):
                return
            process = worker['process']
            if process.poll() is None:
                try:
                    request(worker['url'] + 'api/project/shutdown', worker['session'], {}, timeout=30)
                    process.wait(timeout=5)
                except (OSError, RuntimeError, subprocess.TimeoutExpired):
                    # Only our retired or not-yet-published child reaches here.
                    # Another project's game can reject the old worker's HTTP
                    # shutdown; terminating the old server never stops the game.
                    if process.poll() is None:
                        try:
                            process.terminate()
                        except OSError:
                            if process.poll() is None:
                                raise
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
            worker['log'].close()
            worker['_stopped'] = True

    def _finish_retired(self, worker):
        self._stop(worker)
        with self.retired_lock:
            self.retired.pop(id(worker), None)

    def _schedule_stop(self, worker):
        timer = threading.Timer(2, self._finish_retired, (worker,))
        timer.daemon = True
        with self.retired_lock:
            self.retired[id(worker)] = (worker, timer)
        try:
            timer.start()
        except Exception:
            with self.retired_lock:
                self.retired.pop(id(worker), None)
            raise

    def _drain_retired(self):
        with self.retired_lock:
            pending = list(self.retired.values())
            for _worker, timer in pending:
                timer.cancel()
        for worker, _timer in pending:
            self._finish_retired(worker)

    def open(self, descriptor):
        if not self.lock.acquire(blocking=False):
            raise ProjectTransitionError('Another project is opening. Please wait.', 'project_busy')
        previous = self.active
        worker = None
        try:
            if previous and previous['project']['id'] == descriptor['id'] and previous['process'].poll() is None:
                return dict(project=previous['project'], url=previous['url'])
            if (not previous or previous['process'].poll() is not None) and self.game_running():
                raise ProjectTransitionError('Close the game before opening another project.', 'game_running')
            self._retire(previous)
            import projects
            info = projects.provision(descriptor['id'])
            root = Path(info['path'])
            port, token = self._port(), secrets.token_hex(24)
            env = dict(os.environ, DEUSEDIX_PROJECT_WORKER='1', DEUSEDIX_PROJECT_ID=info['id'],
                       DEUSEDIX_APP_ROOT=str(settings.APP_ROOT), DEUSEDIX_SESSION=token,
                       DEUSEDIX_HUB_URL=HOME_URL, DEUSEDIX_HUB_TOKEN=SESSION)
            # Keep the old mod's own runtime/namespace; only its hub identity changes.
            env.pop('DEUSEDIX_WORKSPACE_ID', None)
            if info.get('external'):
                env['DEUSEDIX_WORKSPACE_ID'] = info['id']
            logfile = root / 'logs' / 'project-server.log'
            logfile.parent.mkdir(parents=True, exist_ok=True)
            stream = logfile.open('ab', buffering=0)
            code = root / 'tools' / 'mapkit' / 'editor' / 'server.py'
            try:
                process = subprocess.Popen(settings.python() + [str(code), '--no-browser', '--port', str(port)],
                                           cwd=root, env=env, stdin=subprocess.DEVNULL, stdout=stream, stderr=stream,
                                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            except Exception:
                stream.close()
                raise
            worker = dict(project=info, process=process, session=token, url='http://127.0.0.1:%d/' % port, log=stream)
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError('The project could not start. Details: ' + str(logfile))
                try:
                    ready = request(worker['url'] + 'api/project/status', token, timeout=1)
                    if ready.get('project', {}).get('id') == info['id']:
                        break
                except (OSError, RuntimeError):
                    pass
                time.sleep(0.1)
            else:
                raise RuntimeError('The project did not respond. Details: ' + str(logfile))
            self.active = worker
            # Allow a request forwarded by the old worker to return its URL.
            if previous:
                self._schedule_stop(previous)
            return dict(project=info, url=worker['url'])
        except Exception:
            self.active = previous
            try:
                self._stop(worker)
            finally:
                if previous and previous['process'].poll() is None:
                    try:
                        request(previous['url'] + 'api/project/resume', previous['session'], {}, timeout=3)
                    except (OSError, RuntimeError):
                        pass
            raise
        finally:
            self.lock.release()

    def close(self):
        if not self.lock.acquire(blocking=False):
            raise ProjectTransitionError('Another project operation is in progress.', 'project_busy')
        try:
            previous = self.active
            self._retire(previous)
            if previous:
                try:
                    self._schedule_stop(previous)
                except Exception:
                    request(previous['url'] + 'api/project/resume', previous['session'], {}, timeout=3)
                    raise
            self.active = None
            return dict(url=HOME_URL)
        finally:
            self.lock.release()

    def shutdown(self):
        if not self.lock.acquire(blocking=False):
            raise ProjectTransitionError('Wait for the current project operation before closing DeusEdix.', 'project_busy')
        try:
            self._drain_retired()
            self._retire(self.active)
            self._stop(self.active)
            self.active = None
        finally:
            self.lock.release()


SUPERVISOR = Supervisor()


def assistant_target():
    """(code, body) for deusedix_mcp.py: the server of the project open in this hub, whose page runs its calls."""
    import agent_bridge
    if not agent_bridge.allowed():
        return 403, dict(error='AI assistants are not allowed in this DeusEdix: Tools > AI assistant...')
    worker = SUPERVISOR.active
    if not worker or worker['process'].poll() is not None:
        return 200, dict(project=None)
    return 200, dict(project=dict(id=worker['project'].get('id'), name=worker['project'].get('name')),
                     url=worker['url'], session=worker['session'])
if not WORKER:
    atexit.register(SUPERVISOR.shutdown)


def api(path, body=None):
    if WORKER:
        value = request(HUB_URL.rstrip('/') + path, os.environ['DEUSEDIX_HUB_TOKEN'], body, timeout=120)
        if body is None:
            value['current'] = current()
        return value
    import projects
    if body is None:
        return dict(current=None, projects=projects.list_projects(), defaultLocation=projects.default_location(), homeUrl=HOME_URL,
                    games=projects.games())
    if path == '/api/projects/create':
        info = projects.create(body.get('name', ''), body.get('location') or None, target=body.get('target') or None)
        return SUPERVISOR.open(info)
    if path == '/api/projects/open':
        info = projects.open_project(body['path']) if body.get('path') else projects.get_project(body.get('id', ''))
        return SUPERVISOR.open(info)
    if path == '/api/projects/close':
        return SUPERVISOR.close()
    if path == '/api/projects/assistant':          # Tools > AI assistant...: the user's switch
        import agent_bridge
        return agent_bridge.set_allowed(body.get('allow') is True, HOME_URL, SESSION, settings.APP_ROOT,
                                        advanced=body.get('advanced') is True)
    raise ValueError('Unknown project action.')
