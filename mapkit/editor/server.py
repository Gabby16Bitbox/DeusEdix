"""DeusEdix, the map editor for Deus Ex and Revision: a local web app (http://localhost:8790).

    tools\\mapkit\\.venv\\Scripts\\python.exe tools\\mapkit\\editor\\server.py     (or "Editor mappe.bat")

The browser shows the last build of a map in 3D with its textures; objects are moved, rotated,
added and deleted like in a modern editor. Changes are saved next to the map script
(maps/<script>.edits.json) and applied by every build, so they survive rebuilds.
"""
import json
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import traceback
import webbrowser
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
PROJECT = KIT.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(KIT))
import data  # noqa: E402
import kit  # noqa: E402
import dxmaps  # noqa: E402
import prefabs  # noqa: E402
import prefab_library  # noqa: E402
import prefab_snapshot  # noqa: E402
import textures  # noqa: E402
import story  # noqa: E402
import props  # noqa: E402
import anims  # noqa: E402
import mapsettings  # noqa: E402
import sounds  # noqa: E402
import guide  # noqa: E402
import play  # noqa: E402
import characters  # noqa: E402
import player_profiles  # noqa: E402
import gamelib  # noqa: E402
import pieces_library  # noqa: E402
import maplinks  # noqa: E402
import newmap  # noqa: E402
import settings  # noqa: E402
import surfaces  # noqa: E402
import mapfiles  # noqa: E402
import gamecons  # noqa: E402
import gamecontent  # noqa: E402
import mission_graph  # noqa: E402
import documents  # noqa: E402
import activation  # noqa: E402
import object_tags  # noqa: E402
import project_server  # noqa: E402
import tutorial  # noqa: E402
import rebuild as rebuild_options  # noqa: E402
import play_preview  # noqa: E402
import player_start  # noqa: E402
import mods  # noqa: E402

PORT = int(os.environ.get('DEUSEDIX_PORT') or 8790)      # DeusEdix's launcher picks a free one
STATIC = HERE / 'static'
LOCK = threading.RLock()
LIVE = {'shown': None, 'n': 0}
# requests of the person using the editor waiting for LOCK or holding it: the Pieces scan, which takes it map
# after map for minutes the first time, starts no more maps meanwhile (24 Oct 2026: a Save waited 2 minutes)
WAITING = {'n': 0}
WAITING_GUARD = threading.Lock()


class UserTurn:
    """LOCK for a request of the person: background work lets it go first (pieces_library.start(waiting=...))."""

    def __enter__(self):
        with WAITING_GUARD:
            WAITING['n'] += 1
        try:
            LOCK.acquire()
        except BaseException:
            self._done()
            raise
        return self

    def __exit__(self, *exc):
        LOCK.release()
        self._done()

    @staticmethod
    def _done():
        with WAITING_GUARD:
            WAITING['n'] -= 1


def scripts():
    out = []
    for p in sorted((KIT / 'maps').glob('*.py')):
        m = re.search(r"^MAP\s*=\s*'([^']+)'", p.read_text(encoding='utf-8'), re.M)
        if m:
            out.append(dict(script=p.stem, map=m.group(1), kind='script',
                            built=(data.OUT / (m.group(1) + '.dx')).exists()))
    return out


def is_dx(script):
    return script.startswith(dxmaps.PREFIX)


def map_of(script):
    if is_dx(script):
        name = script[len(dxmaps.PREFIX):]
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', name) or not any(m['map'] == name for m in dxmaps.listing()):
            raise ValueError('This map is not in the current project.')
        return name
    for s in scripts():
        if s['script'] == script:
            return s['map']
    raise ValueError('unknown map script %s' % script)


def edits_path(script):
    map_of(script)
    if is_dx(script):
        return dxmaps.edits_path(map_of(script))
    return KIT / 'maps' / (script + '.edits.json')


def load_edits(script):
    p = edits_path(script)
    if p.exists():
        return json.loads(p.read_text(encoding='utf-8'))
    return dict(moved={}, deleted={}, added=[], boxes=[], groups={}, copies=[])


def people_of(map_name):
    """The characters of a map (name, label): the map as last opened in the editor (nothing for a map
    never opened) and the ones added there. Their names are those of UCFateWatch's flags."""
    out, seen = [], set()
    try:
        acts = data.actors(map_name)
    except Exception:
        acts = []
    for a in acts:
        if a.get('kind') == 'pawn' and a['cls'] != 'PlayerStart' and 'Helicopter' not in a['cls']:
            seen.add(a['name'])
            out.append(dict(name=a['name'], label=a.get('label') or a['cls'], bind=a.get('bind') or ''))
    script = next((s['script'] for s in scripts() if s['map'] == map_name), dxmaps.PREFIX + map_name)
    try:
        added = load_edits(script).get('added') or []
    except Exception:
        added = []
    for a in added:
        if a.get('kind') == 'pawn' and a.get('name') not in seen:
            name = str((a.get('props') or {}).get('FamiliarName') or '').strip('"')
            out.append(dict(name=a['name'], label=name or a.get('cls', ''), bind=a.get('bind') or ''))
    return sorted(out, key=lambda x: x['name'].lower())


COPY_PROPS = re.compile(r'^(DrawScale|DrawScale3D|Skin|MultiSkins\(\d\)|SkinColor|Texture|Style|bUnlit|ScaleGlow|Fatness|'
                        r'AmbientGlow|Mesh|Light\w*|bMeshEnviroMap|ItemName|FamiliarName|UnfamiliarName|bInvincible|'
                        r'bPushable|bExplosive|explosionDamage|HitPoints|Physics)$')


def copy_actor(map_name, name):
    """An object of the map shown, with the properties that make it look the way it does there
    (skins, scale, light...): pasted as a new object anywhere."""
    import t3d
    text = (data.CACHE / map_name / 'scene.t3d').read_text(encoding='latin1', errors='replace')
    for a in t3d.actors(text):
        if a['name'] == name:
            props = {k: v for k, v in a['props'].items() if COPY_PROPS.match(k) and "'MyLevel." not in v}
            info = next((x for x in data.actors(map_name) if x['name'] == name), {})
            return dict(kind='actor', cls=a['cls'], props=props, source=map_name, label=info.get('cls', a['cls']),
                        radius=info.get('radius', 16), height=info.get('height', 16), rot=list(info.get('rot', [0, 0, 0])))
    raise ValueError('object %s not found in %s' % (name, map_name))


def run_ps(script, *args):
    """build.ps1 / install.ps1 of the project: (ok, the lines worth showing)."""
    if settings.STANDALONE:           # DeusEdix installed: the same steps in Python (workspace.py)
        import workspace
        return {'build.ps1': workspace.build, 'install.ps1': workspace.install}[script]()
    r = subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(PROJECT / script)] + list(args),
                       cwd=str(PROJECT), capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=1200)
    text = (r.stdout or '') + (r.stderr or '')
    keep = [l for l in text.splitlines() if re.search(r'error|Error|warning|Success|OK:|installat|Fatto|fallit|[Ii]nstalled|Done|failed|story of|removed', l)]
    ok = r.returncode == 0 and 'Error' not in text.split('Success')[-1]
    if ok and script == 'install.ps1':
        import workspace
        workspace.activate()
    return ok, keep[-25:]


def game_running():
    return settings.game_running()          # the project's game: Revision.exe, or the original DeusEx.exe


def play_session_status():
    """Do not unlock editing until a naturally exited game has been cleaned up."""
    import live
    session = live.session_status()
    if not session.get('running') and not session.get('launching') and not session.get('error') and (PLAY.get('active') or LIVE.get('active')):
        if game_running():
            return dict(session, error='Another game is still running. Close it before restoring the Play copy.')
        try:
            live.stop(timeout=0)
            play_preview.restore()
            PREVIEW.update(token=None, script=None)
            PLAY.update(active=False)
            LIVE.update(active=False, shown=None)
            session = live.session_status()
        except (RuntimeError, ValueError, OSError) as exc:
            session = dict(session, error=str(exc))
    return dict(session, prepared=bool(PREVIEW.get('token')), previewToken=PREVIEW.get('token'))


def retire_project():
    # Cancelling must not validate/read every Pieces cache during shutdown.
    pieces_library.stop(snapshot=False)
    def game_or_play_busy():
        if game_running():
            return True
        if PLAY.get('active') or LIVE.get('active'):
            raise project_server.ProjectTransitionError('Finishing the previous Play session. Please wait.', 'project_busy')
        return False
    project_server.retire(game_or_play_busy)
    try:
        play_preview.restore()
        PREVIEW.update(token=None, script=None)
        import project_game
        project_game.deactivate_if_current()
    except Exception:
        project_server.retire(game_running, False)
        raise


def tutorial_write_guard(path, query, headers):
    """Called under LOCK: a late save must not recreate a discarded exercise."""
    if path in ('/api/tutorial_start', '/api/tutorial_end', '/api/tutorial_reset', '/api/tutorial_info'):
        return
    token = headers.get('X-DeusEdix-Tutorial')
    if token or (tutorial.available() and (tutorial.is_script(query.get('script', '')) or tutorial.is_map(query.get('map', '')))):
        tutorial.require_session(token)


def tutorial_can_reset():
    if game_running() or PLAY.get('active') or LIVE.get('active'):
        raise RuntimeError('Close the game before closing or restarting the tutorial. Your exercise is still open.')


def tutorial_runtime(script):
    """A clean map must not launch with dialogue compiled in an earlier exercise."""
    if not tutorial.available() or not tutorial.is_script(script) or not settings.STANDALONE:
        return
    import workspace
    if workspace.needs_build():
        if game_running():
            raise RuntimeError('Close the game before playing the restarted tutorial.')
        ok, lines = workspace.build()
        if not ok:
            raise RuntimeError('The tutorial runtime could not be rebuilt: ' + '\n'.join(lines[-12:]))
    if not game_running():
        # Play/View need a temporary installed copy even when the ordinary
        # "Install changes" checkbox is off. End/reset remove just this map.
        target = settings.PROJECT / 'maps' / (tutorial.MAP + '.dx')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(data.OUT / (tutorial.MAP + '.dx'), target)
        ok, lines = workspace.install()
        if not ok:
            raise RuntimeError('The tutorial runtime could not be installed: ' + '\n'.join(lines[-12:]))


def build(script, options=None):
    options = rebuild_options.normalize(options)
    map_of(script)
    prefab_edits = load_edits(script)
    # Rebuild can run before Play on an upgraded workspace. Do not silently drop
    # the new map controller because the old compiled package lacks its class.
    if player_profiles.blocks(prefab_edits):
        import workspace
        if workspace.needs_build():
            if game_running():
                return False, ['Close the game before rebuilding player characters.']
            ready, runtime_lines = run_ps('build.ps1', '-Isolated')
            if not ready:
                return False, runtime_lines
    prefab_source = dxmaps.source(map_of(script)) if is_dx(script) else KIT / 'maps' / (script + '.py')
    prefab_source_state = prefab_snapshot.source_state(prefab_source)
    if is_dx(script):
        ok, lines = dxmaps.build(map_of(script), options=options)
        if ok:
            _record_prefab_build(script, prefab_edits, lines, prefab_source_state)
        return ok, lines
    path = KIT / 'maps' / (script + '.py')
    r = subprocess.run(settings.python() + [str(path)], cwd=str(PROJECT), capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=3600, creationflags=subprocess.CREATE_NO_WINDOW,
                       env=rebuild_options.script_environment(options))
    text = (r.stdout or '') + (r.stderr or '')
    lines = [l for l in text.splitlines()
             if re.search(r'built |IN SOLID|TEXTURE|STRETCHED|DROP:|SNAP:|EDIT |ZONE |retry|Error|Traceback', l)]
    if r.returncode != 0:
        lines += text.splitlines()[-20:]
    else:
        _record_prefab_build(script, prefab_edits, lines, prefab_source_state)
    return r.returncode == 0, rebuild_options.report(options, generated=True) + lines


def _record_prefab_build(script, edits, lines, expected_source=None):
    map_name = map_of(script)
    source = dxmaps.source(map_name) if is_dx(script) else KIT / 'maps' / (script + '.py')
    try:
        prefab_snapshot.record_build(data.OUT / (map_name + '.dx'), edits, source, expected_source)
    except (OSError, ValueError) as exc:
        lines.append('Prefab snapshot not available: %s. Rebuild before saving a prefab.' % exc)


def save_prefab_selection(script, body):
    if not isinstance(body, dict) or not isinstance(body.get('edits'), dict):
        raise ValueError('Invalid prefab request.')
    if tutorial.available():
        raise ValueError('The tutorial is temporary: create prefabs in a normal project map.')
    map_name = map_of(script)
    saved = load_edits(script)
    shown = dxmaps.shown(map_name) if is_dx(script) else data.OUT / (map_name + '.dx')
    source = dxmaps.source(map_name) if is_dx(script) else KIT / 'maps' / (script + '.py')
    folder = data.CACHE / map_name
    prefab_snapshot.require_current(shown, saved, body['edits'], folder, data.MESH_VERSION, source,
                                    original=is_dx(script) and shown == source)
    return prefab_library.save(map_name, body.get('selection'), body.get('label'), folder, data.structures(map_name))


def require_player_start(script):
    classes = props.defaults(log=lambda *a: None).get('classes', {})
    chains = {name:entry.get('parents',[]) for name,entry in classes.items()}
    player_start.require(data.actors(map_of(script)), load_edits(script), chains)


def prepare_play(script):
    """Build a test copy without baking edits into the project's editable map."""
    import workspace
    require_player_start(script)
    play_preview.restore()
    lines = story.write_all()
    if workspace.needs_build():
        ok, output = run_ps('build.ps1', '-Isolated')
        lines += output
        if not ok:
            return False, lines
    ok, output = build(script)
    lines += output
    if not ok:
        return False, lines
    ok, output = workspace.install(maps=False, activate_project=False)
    lines += output
    if not ok:
        return False, lines
    lines += play_preview.stage(data.OUT / (map_of(script) + '.dx'), map_of(script))
    return True, lines


def install_map(script):
    """Install button: the last rebuild into maps\\ and the game (install.ps1). (ok, lines)."""
    map_name = map_of(script)
    pre = []
    if is_dx(script):
        with LOCK:
            ok, pre = dxmaps.install(map_name)
        if not ok:
            return False, pre
    else:
        shutil.copy2(data.OUT / (map_name + '.dx'), PROJECT / 'maps' / (map_name + '.dx'))
    if settings.STANDALONE:
        import workspace
        # the map's dialogues and events as the Story saved them, compiled when they changed, as Play does
        # (24 Oct 2026: a dialogue saved in the Story never reached the game installed with Install map)
        pre += story.write_all()
        if workspace.needs_build():
            ok, output = run_ps('build.ps1', '-Isolated')
            pre += output
            if not ok:
                return False, pre
        ok, lines = workspace.install()
        return ok, pre + lines
    r = subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                        str(PROJECT / 'install.ps1')], cwd=str(PROJECT), capture_output=True, text=True,
                       encoding='utf-8', errors='replace', creationflags=subprocess.CREATE_NO_WINDOW)
    if r.returncode == 0:
        import workspace
        workspace.activate()
    return r.returncode == 0, pre + [l for l in (r.stdout or '').splitlines() if l.strip()]


PLAY = {'active': False}      # a game opened with "Play from here" (the watcher tidies up when it closes)
PREVIEW = {'token': None, 'script': None}


def view(script, cam):
    """Screenshot from the editor camera in the running game (starts it the first time)."""
    import live
    map_name = map_of(script)
    if not game_running():
        live.start(map_name)
        LIVE['shown'] = None
    LIVE['active'] = True
    shown = dxmaps.shown(map_name) if is_dx(script) else data.OUT / (map_name + '.dx')
    stamp = (str(shown), shown.stat().st_mtime_ns)
    if LIVE['shown'] != stamp:
        live.show_map(map_name, shown)
        LIVE['shown'] = stamp
    step = 'cam;%.1f;%.1f;%.1f;%.1f;%.1f;%.1f' % tuple(cam['pos'] + cam['look'])
    answer, png = live.do(step)
    if not png:
        return None, answer
    LIVE['n'] += 1
    dst_dir = data.CACHE / map_name / 'views'
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / ('view%03d.png' % LIVE['n'])
    shutil.copy2(png, dst)
    return '/cache/%s/views/%s' % (map_name, dst.name), answer


# the fonts the user imported (editor/static/text-style.js)
FONTS = Path(__file__).resolve().parents[1] / 'fonts'
FONT_TYPES = ('.ttf', '.otf', '.woff', '.woff2')

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype='application/json'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode('utf-8')
        elif isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _audio_file(self, path, keep=False):
        """Serve a byte range so browser previews can seek without restarting at zero.

        Only called after _file's existing path checks. Other assets keep their
        cache behaviour. Stream bounded chunks instead of retaining a whole clip.
        """
        with path.open('rb') as source:
            st = os.fstat(source.fileno())
            size = st.st_size
            tag = '"%x-%x"' % (st.st_mtime_ns, size)
            requested = self.headers.get('Range', '')
            if self.headers.get('If-Range') not in (None, tag):
                requested = ''
            match = re.fullmatch(r'bytes=(\d{0,18})-(\d{0,18})', requested.strip())
            start, end, partial = 0, size - 1, False
            if match and any(match.groups()):
                first, last = match.groups()
                if first:
                    start = int(first)
                    if last:
                        end = min(int(last), size - 1)
                elif int(last) > 0:
                    start = max(0, size - int(last))
                else:
                    start = size
                if start >= size or end < start:
                    self.send_response(416)
                    self.send_header('Accept-Ranges', 'bytes')
                    self.send_header('Content-Range', 'bytes */%d' % size)
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                partial = True
            if keep and not partial and self.headers.get('If-None-Match') == tag:
                self.send_response(304)
                self.send_header('ETag', tag)
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('Accept-Ranges', 'bytes')
                self.end_headers()
                return
            remaining = end - start + 1
            self.send_response(206 if partial else 200)
            self.send_header('Content-Type', mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(remaining))
            self.send_header('Cache-Control', 'no-cache' if keep else 'no-store')
            if keep:
                self.send_header('ETag', tag)
            if partial:
                self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
            self.end_headers()
            source.seek(start)
            try:
                while remaining:
                    chunk = source.read(min(64 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass  # Changing sound or closing its Inspector cancels the request.

    def _file(self, path, keep=False):
        """keep: the browser may keep it and ask again whether it changed (304: nothing to send). For what
        the editor made from the game on this PC (textures, models, previews), not for the editor's code."""
        if not path.exists() or not path.is_file():
            return self._send(404, {'error': 'not found'})
        if path.suffix.lower() in ('.wav', '.mp3', '.ogg', '.flac', '.m4a', '.opus'):
            return self._audio_file(path, keep)
        ctype = mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
        if path.suffix == '.js':
            ctype = 'text/javascript'
        if not keep:
            return self._send(200, path.read_bytes(), ctype)
        st = path.stat()
        tag = '"%x-%x"' % (st.st_mtime_ns, st.st_size)
        if self.headers.get('If-None-Match') == tag:
            self.send_response(304)
            self.send_header('ETag', tag)
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('ETag', tag)
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path == '/alive':                       # a page of DeusEdix in the web browser is open (browser_session)
                import browser_session
                browser_session.alive(parse_qs(urlparse(self.path).query).get('tab', [''])[0])
                return self._send(204, b'', 'text/plain')
            if path == '/mods/cover':                  # an installed mod's picture (Projects > Mods)
                q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
                body, ctype = mods.cover(q.get('game'), q.get('id'))
                return self._send(200, body, ctype) if body else self._send(404, dict(error='No cover.'))
            if path.startswith('/api/') and not project_server.authorized(self.headers):
                return self._send(409, dict(error='This editor session changed. Reopen the project.'))
            if path == '/api/project/status':
                if not project_server.authorized(self.headers):
                    return self._send(403, dict(error='Invalid project session.'))
                return self._send(200, project_server.status())
            if path == '/api/projects':
                return self._send(200, project_server.api(path))
            if path == '/api/mods':                    # the mods installed in both games (app level)
                return self._send(200, dict(mods=mods.installed(), folder=str(mods.EXPORTS)))
            if not project_server.WORKER and path.startswith('/api/'):
                if path == '/api/map_browser':
                    return self._send(200, dict(maps=[], missions=newmap.MISSIONS, standalone=settings.STANDALONE, project=None))
                if path in ('/api/maps', '/api/thumbs'):
                    return self._send(200, [])
                return self._send(409, dict(error='Choose a project first.'))
            with project_server.operation():
                if path.startswith('/api/') and path not in ('/api/maps', '/api/map_browser', '/api/newmap_info', '/api/project_sources', '/api/thumbs', '/api/missiongraph', '/api/state_catalog', '/api/scene', '/api/play_session', '/api/prefab_library', '/api/pieces'):
                    project_server.ensure_runtime()
                return self._project_GET()
        except (ValueError, RuntimeError, OSError) as exc:
            return self._send(409, project_server.error_payload(exc))

    def _project_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == '/api/prefab_library':
                return self._send(200, dict(items=prefab_library.library()))
            if u.path == '/api/missiongraph':
                return self._send(200, mission_graph.status())
            if u.path == '/api/state_catalog':
                import statecatalog
                return self._send(200, statecatalog.catalog())
            if u.path in ('/', '/index.html'):
                return self._send(200, project_server.page((STATIC / 'index.html').read_text(encoding='utf-8')), 'text/html; charset=utf-8')
            if u.path.startswith('/static/'):
                return self._file(STATIC / u.path[len('/static/'):])
            if u.path.startswith('/cache/'):
                rel = Path(u.path[len('/cache/'):])
                if '..' in rel.parts:
                    return self._send(403, {'error': 'no'})
                return self._file(data.cache_file(rel), keep=True)
            if u.path.startswith('/prefabs/'):
                rel = Path(u.path[len('/prefabs/'):])
                if '..' in rel.parts:
                    return self._send(403, {'error': 'no'})
                if len(rel.parts) == 2 and rel.name == 'display.json':
                    return self._send(200, prefabs.display(rel.parts[0]))
                return self._file(prefabs.ROOT / rel, keep=True)
            if u.path.startswith('/music/'):              # Revision's music (the Map panel plays it)
                rel = Path(u.path[len('/music/'):])
                if '..' in rel.parts or rel.suffix.lower() != '.ogg':
                    return self._send(403, {'error': 'no'})
                return self._file(mapsettings.MUSIC_DIR / rel)
            if u.path.startswith('/anims/'):              # the Animation Studio's baked animations
                rel = Path(u.path[len('/anims/'):])
                if '..' in rel.parts:
                    return self._send(403, {'error': 'no'})
                return self._file(anims.STUDIO / rel)
            if u.path.startswith('/fonts/'):              # the fonts the user imported (signs, Text tool)
                rel = Path(u.path[len('/fonts/'):])
                if '..' in rel.parts or len(rel.parts) != 1:
                    return self._send(403, {'error': 'no'})
                return self._file(FONTS / rel)
            if u.path == '/api/fonts':
                FONTS.mkdir(exist_ok=True)
                return self._send(200, dict(fonts=[dict(family=f.stem.replace('_', ' '), url='/fonts/' + f.name)
                                                   for f in sorted(FONTS.iterdir()) if f.suffix.lower() in FONT_TYPES]))
            if u.path.startswith('/textures/'):           # pictures imported in the editor
                rel = Path(u.path[len('/textures/'):])
                if '..' in rel.parts:
                    return self._send(403, {'error': 'no'})
                return self._file(textures.ROOT / rel)
            if u.path in ('/pieces', '/pezzi'):
                return self._send(200, project_server.page((STATIC / 'pieces.html').read_text(encoding='utf-8')), 'text/html; charset=utf-8')
            if u.path == '/guide':
                # the guide (docs/tutorials/07-map-editor.md) and the other tutorials as pages
                code, page = guide.page(q.get('doc'))
                return self._send(code, page, 'text/html; charset=utf-8')
            if u.path == '/api/play_info':
                # "Play from here": the mission states that end in this map, whether the game would
                # miss the last rebuild, whether it is open
                map_name = map_of(q['script'])
                return self._send(200, dict(map=map_name, setups=play.setups(map_name), running=game_running(),
                                            pending=play.pending_install(map_name, is_dx(q['script']), data.OUT,
                                                                         dxmaps.built_current)))
            if u.path == '/api/play_session':
                return self._send(200, play_session_status())
            if u.path == '/api/mod_export':            # File > Export mod...: the project's maps and details
                return self._send(200, mods.export_info())
            if u.path == '/api/scripts':
                # Tools > Scripts: the scripts there are, their package, the templates of a new one
                import scripts as user_scripts
                return self._send(200, dict(package=user_scripts.PACKAGE, base='UCScript', scripts=user_scripts.names(),
                                            templates=[dict(id=k, label=v[0]) for k, v in user_scripts.TEMPLATES.items()]))
            if u.path == '/api/script':
                import scripts as user_scripts
                return self._send(200, dict(name=q['name'], text=user_scripts.read(q['name'])))
            if u.path == '/api/weapons':
                # Tools > Weapons: the weapons of the project, the game's weapons to start from, the ammunition
                import weapons
                import scripts as user_scripts
                return self._send(200, dict(weapons=weapons.names(), bases=weapons.bases(), ammo=weapons.AMMO, ownAmmo=weapons.ammo_names(),
                                            scripts=user_scripts.PACKAGE,
                                            stats=list(weapons.STATS), models=settings.MODELS_PACKAGE))
            if u.path == '/api/weapon':
                import weapons
                return self._send(200, weapons.read(q['name']))
            if u.path == '/api/weapon_gun':
                import weapons
                return self._send(200, weapons.gun(q['name']))
            if u.path == '/api/console_log':
                # the Console: the game's log from a byte offset (live.read_log), and whether Play runs
                import live
                offset, lines = live.read_log(int(q.get('offset', '-1')))
                session = live.session_status()
                return self._send(200, dict(offset=offset, lines=lines, running=bool(session.get('running') and session.get('owned'))))
            if u.path == '/api/people':
                # the characters of a map, for the Story's "is he dead?" asked in another map
                return self._send(200, dict(people=people_of(q['map'])))
            if u.path == '/api/factions':
                # the characters' classes with their default faction and relations, every faction name
                return self._send(200, props.factions(log=lambda *a: None))
            if u.path == '/api/player_profiles':
                return self._send(200, player_profiles.catalog())
            if u.path == '/api/characters':
                # the Character Creator: the catalog of bodies and pieces of the game (made once) and the
                # characters saved in tools/mapkit/characters (editor/characters.py)
                with LOCK:
                    characters.catalog(log=lambda *a: None)
                stamp = (characters.CACHE / 'catalog.json').stat().st_mtime_ns
                return self._send(200, dict(catalog='/cache/_characters/catalog.json?v=%d' % stamp,
                                            characters=characters.load_all()))
            if u.path == '/api/texflags':
                # the PolyFlags of the game's textures (masked fences...), made once (data.texture_flags)
                with LOCK:
                    return self._send(200, data.texture_flags(log=lambda *a: None))
            if u.path == '/api/views':
                # the UnrealEd views of the map shown (View > Wireframe, BSP cuts, Zones), from its last SDK pass
                with LOCK:
                    return self._send(200, data.views(map_of(q['script'])))
            if u.path == '/api/links':
                # the ways in and out of a map, and the exits of the other maps that lead to it (maplinks.py)
                return self._send(200, maplinks.links(q['map']))
            if u.path == '/api/arrivals':
                # where a map can be entered: its start and the tags of its arrival points
                return self._send(200, maplinks.arrivals(q['map']))
            if u.path == '/api/newmap_info':
                return self._send(200, dict(missions=newmap.MISSIONS, maps=maplinks.all_maps(), textures=newmap.TEXTURES,
                                           project=project_server.current()))
            if u.path == '/api/project_sources':
                return self._send(200, dict(maps=sorted(p.stem for p in dxmaps.GAME_MAPS.glob('*.dx') if re.match(r'^\d\d_', p.stem)),
                                           missions=newmap.MISSIONS))
            if u.path == '/api/pieces':
                # Fast status/catalog read: no SDK work or SDK lock on a GET.
                return self._send(200, pieces_library.data())
            if u.path == '/api/anims':
                # the animations of a character class (or of a model): sequences and the url of the frames,
                # the Studio's animations baked on it
                with LOCK:
                    if q.get('mesh'):
                        d = dict(anims.load(q['mesh'], log=lambda *a: None), custom=anims.baked_for(q['mesh']))
                    else:
                        d = anims.for_class(q['cls'], log=lambda *a: None)
                return self._send(200, d or {'error': 'no model', 'seqs': []})
            if u.path == '/api/models':
                # every 3D model the game can load, by package (editor/models.py)
                import models
                with LOCK:
                    return self._send(200, dict(models.listing(log=lambda *a: None), imported=models.imported()))
            if u.path == '/api/models_pkg':
                import models
                with LOCK:
                    try:
                        return self._send(200, models.package_models(q.get('pkg', ''), log=lambda *a: None))
                    except ValueError as e:
                        return self._send(400, dict(error=str(e)))
            if u.path == '/api/sounds':
                # every sound of the game (the sound picker), ambient loops first
                with LOCK:
                    return self._send(200, dict(sounds=sounds.everything(log=lambda *a: None), ambient=list(sounds.AMBIENT),
                                                package=sounds.PACKAGE))
            if u.path == '/api/sound_play':
                with LOCK:
                    return self._send(200, sounds.playable(q.get('name', ''), log=lambda *a: None))
            if u.path == '/api/check':
                # Check map, the part that needs the engine: what is inside solid geometry (last rebuild)
                script = q['script']
                map_name = map_of(script)
                src = dxmaps.shown(map_name) if is_dx(script) else data.OUT / (map_name + '.dx')
                if not Path(src).exists():
                    return self._send(200, dict(solid=[], built=False))
                with LOCK:
                    s = kit.Session([Path(src)], 'editor-check-' + map_name)
                    try:
                        s.cmd(r'MAP LOAD FILE="..\Input\%s"' % Path(src).name)
                        out = s.cmd('UC_ACTORS check')
                    finally:
                        s.close()
                solid = [dict(cls=m.group(1), name=m.group(2), loc=[float(x) for x in m.group(3).split()])
                         for m in re.finditer(r'UCMapKit\|in solid\|(\w+)\|(\w+)\|([-\d. ]+)', out)]
                return self._send(200, dict(solid=solid, built=True))
            if u.path == '/api/mapsettings':
                # the Map panel: what the map has (music, information, ambient light), the music of the game
                map_name = map_of(q['script'])
                return self._send(200, dict(current=mapsettings.current(map_name), level=load_edits(q['script']).get('level') or {},
                                            files=mapsettings.music_files(), presets=mapsettings.presets(),
                                            roles=[r[:2] for r in mapsettings.ROLES],
                                            hint=mapsettings.HINT, preview=mapsettings.OGG))
            if u.path == '/api/texture_source':
                # the texture editor: a texture at its full size (an imported one: its own picture)
                with LOCK:
                    return self._send(200, textures.source(q['tex'], map_of(q['script']), log=lambda *a: None))
            if u.path == '/api/texture_tile':
                # a new block's texture in the 3D view: world units per repeat on walls, floors and
                # ceilings, as the build maps it (geom.mapping: the texture's size times the game's scale)
                import geom
                import blocks
                name = textures.short(q.get('tex', ''))
                tu, tv = geom.tex_size(name)
                out = {k: [tu * geom.game_scale(name, k), tv * geom.game_scale(name, k)] for k in ('wall', 'floor', 'ceiling')}
                return self._send(200, dict(out, ref=blocks.texture_ref(q.get('tex', ''))))
            if u.path == '/api/texture_library':
                return self._send(200, dict(textures=textures.library()))
            if u.path == '/api/texture_index':
                # the texture picker: every texture of the game by package (texpicker.py)
                import texpicker
                return self._send(200, texpicker.index())
            if u.path == '/api/texture_thumbs':
                import texpicker
                with LOCK:
                    return self._send(200, texpicker.thumbs(q.get('pkg', '')))
            if u.path == '/api/texture_project':
                try:
                    with LOCK:
                        return self._send(200, textures.library_project(q.get('name', '')))
                except ValueError as exc:
                    return self._send(400, dict(error=str(exc)))
            if u.path == '/api/studio':
                # the Animation Studio: its animations, the models they are baked on, the rigs made
                return self._send(200, anims.studio_list())
            if u.path == '/api/studio_anim':
                return self._send(200, anims.studio_get(q.get('name', '')) or {'error': 'no such animation'})
            if u.path == '/api/studio_rig':
                return self._send(200, dict(rig=anims.rig_get(q.get('mesh', ''))))
            if u.path == '/api/studio_rig_legacy':
                # the skeleton a model had before the Studio made it again (its older animations keep it)
                return self._send(200, dict(rig=anims.rig_get(q.get('mesh', ''), legacy=True)))
            if u.path == '/api/studio_models':
                # the models of a character class in the game (its own, and HDTP's when it has one)
                with LOCK:
                    return self._send(200, dict(models=anims.models_of(q.get('cls', ''), log=lambda *a: None)))
            if u.path == '/api/packages':
                # packages of other mods the editor loads too (editor/packages.py)
                import packages
                return self._send(200, packages.listing())
            if u.path == '/api/class_props':
                # All properties: every property of a class, as UnrealEd's Properties window (props.class_props)
                try:
                    with LOCK:
                        return self._send(200, props.class_props(q.get('cls', ''), log=lambda *a: None))
                except ValueError as e:
                    return self._send(400, dict(error=str(e)))
            if u.path == '/api/props':
                # the Properties panel of a class: fields, kinds, class defaults (editor/props.py)
                items = data.items()
                return self._send(200, dict(cls=q['cls'], fields=props.fields_for(q['cls'], log=lambda *a: None),
                                            items=items, chain=props.chain(q['cls'], log=lambda *a: None)))
            if u.path == '/api/navneeded':
                # does the map send characters on the walkable area (navbake.py)? the page bakes it before a Rebuild
                import navbake
                edits = json.loads(edits_path(q['script']).read_text(encoding='utf-8')) if edits_path(q['script']).exists() else {}
                return self._send(200, dict(needed=navbake.needed(edits, map_of(q['script']))))
            if u.path == '/api/story':
                # the dialogues and events of the map written in the editor (tools/mapkit/story.py)
                map_name = map_of(q['script'])
                # objects JC can receive in a dialogue: weapons, ammo, pickups of the game and the editor's package
                items = data.items()
                return self._send(200, dict(map=map_name, story=story.load(map_name), flags=story.known_flags(),
                                            cls=story.class_name(map_name), code=story.code(map_name), items=items))
            if u.path == '/api/gamecons':
                with LOCK:
                    map_name = q.get('map') or map_of(q.get('script', ''))
                    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', map_name):
                        return self._send(400, dict(error='Invalid map name.'))
                    return self._send(200, gamecons.for_map(map_name, data.actors(map_name), q.get('package')))
            if u.path == '/api/gamecons/search':
                with LOCK:
                    return self._send(200, gamecons.search(q.get('q', ''), q.get('package', settings.CONVERSATIONS),
                        q.get('mission'), q.get('owner', ''), q.get('limit', 100), q.get('offset', 0), q.get('kind', 'all')))
            if u.path == '/api/gametext':
                with LOCK:
                    package = q.get('package')
                    if not package:
                        default = props.defaults()['classes'].get(q.get('cls', ''), {}).get('props', {})
                        package = (default.get('TextPackage') or ['DeusExText'])[0].strip('"')
                    return self._send(200, gamecontent.text(package, q.get('tag', ''), q.get('map', '')))
            if u.path == '/api/missionflags':
                with LOCK:
                    return self._send(200, gamecontent.mission_flags(q.get('map', '')))
            if u.path == '/api/gamevoice':
                with LOCK:
                    return self._send(200, gamecons.playable(q.get('sound', ''), q.get('package', settings.CONVERSATIONS)))
            if u.path == '/api/library':
                # ready-made pieces of the original maps (tools/mapkit/library.py)
                import library
                words = [w for w in q.get('q', '').split() if w]
                maps = [m for m in re.split(r'[\s,]+', q.get('maps', '')) if m] or None
                found = library.find(words or [''], maps, max_size=int(q.get('max', 800)))
                if q.get('sort', 'size') == 'size':      # objects first: the smallest pieces
                    found.sort(key=lambda x: (max(x[2]['size']), x[0], x[1]))
                else:
                    found.sort(key=lambda x: (-x[2]['pieces'], x[0], x[1]))
                found = [f for f in found if max(f[2]['size']) >= int(q.get('min', 48))]
                return self._send(200, [dict(map=m, name=n, label=e['label'], size=e['size'], tex=e['tex'],
                                             objects=e['objects']) for m, n, e in found[:int(q.get('limit', 48))]])
            if u.path == '/api/maps':
                return self._send(200, scripts() + dxmaps.listing())
            if u.path == '/api/map_browser':
                return self._send(200, dict(maps=mapfiles.describe(scripts() + dxmaps.listing()),
                                           missions=newmap.MISSIONS, standalone=settings.STANDALONE, project=project_server.current(),
                                           package=settings.PACKAGE, models_package=settings.MODELS_PACKAGE))
            if u.path == '/api/dubs':                         # the voices given to lines (Story)
                return self._send(200, dict(package=sounds.PACKAGE, voices=sounds.dubs()))
            if u.path == '/api/thumbs':
                # the 3D previews already made (the page draws the others when the editor is idle)
                d = data.GAME_CACHE / '_palette' / 'thumbs'
                return self._send(200, sorted(p.stem for p in d.glob('*.png')) if d.exists() else [])
            if u.path == '/api/scene':
                script = q['script']
                with LOCK:
                    session = None
                    if tutorial.available() and tutorial.is_script(script):
                        token = self.headers.get('X-DeusEdix-Tutorial')
                        if not token:
                            tutorial_can_reset()
                        else:
                            tutorial.require_session(token)
                        project_server.ensure_runtime()
                        session = tutorial.start(build, session=token)['session']
                    else:
                        project_server.ensure_runtime()
                    map_name = map_of(script)
                    if is_dx(script):
                        # an existing map: shown as built with the edits, or as it is; structures found
                        # automatically on the map as it is
                        data.prepare(map_name, src=dxmaps.shown(map_name), log=lambda *a: None,
                                     analyse=lambda folder: dxmaps.structures(map_name, folder, data.actors(map_name)))
                    else:
                        data.prepare(map_name, log=lambda *a: None)
                    data.palette_meshes(log=lambda *a: None)
                    if session:
                        tutorial.cache_scene(session)
                    t = int(time.time())
                    return self._send(200, dict(
                    script=script, map=map_name, geometry='/cache/%s/geometry.json?t=%d' % (map_name, t),
                    meshes='/cache/%s/meshes.json?t=%d' % (map_name, t), palette_meshes='/cache/_palette/index.json',
                    paths='/cache/%s/paths.json?t=%d' % (map_name, t),
                    actors=data.actors(map_name), structures=data.structures(map_name), bakedObjectTags=data.object_tags(map_name),
                    edits=load_edits(script), publishedLayout=tutorial.published_edits() if session else None, palette=data.palette(),
                    kind=('dx-' + ('mod' if dxmaps.source(map_name).parent == dxmaps.MOD_MAPS else 'game'))
                    if is_dx(script) else 'script',
                    built=dxmaps.built_current(map_name) if is_dx(script) else True, package=settings.PACKAGE,
                    models_package=settings.MODELS_PACKAGE, standalone=settings.STANDALONE,
                    game=game_running(), tutorialSession=session, target=settings.TARGET,
                    gameName=settings.GAME_NAME, features=sorted(settings.FEATURES)))
            return self._send(404, {'error': 'unknown'})
        except (ValueError, RuntimeError, OSError) as e:
            return self._send(409, project_server.error_payload(e))
        except Exception as e:
            return self._send(500, {'error': str(e), 'trace': traceback.format_exc()[-1500:]})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == '/bye':                             # ...and it went away (sendBeacon carries no session header)
            import browser_session
            browser_session.bye(parse_qs(urlparse(self.path).query).get('tab', [''])[0])
            return self._send(204, b'', 'text/plain')
        if not project_server.authorized(self.headers):
            return self._send(409, dict(error='This editor session changed. Reopen the project before saving.'))
        try:
            if path == '/api/prefab_library' and not 0 < int(self.headers.get('Content-Length', 0) or 0) <= 8 * 1024 * 1024:
                return self._send(400, dict(error='The prefab request is too large or empty.'))
            if path.startswith('/api/projects/') or path.startswith('/api/project/'):
                n = int(self.headers.get('Content-Length', 0) or 0)
                if n < 0 or n > (2 * 1024 * 1024 if path == '/api/project/preferences' else 16384):
                    return self._send(400, dict(error='Invalid project request.'))
                body = json.loads(self.rfile.read(n) or b'{}')
                if path == '/api/project/preferences':
                    import project_preferences
                    project_preferences.save(body, (project_server.current() or {}).get('id'))
                    return self._send(200, dict(ok=True))
                if path == '/api/project/retire':
                    retire_project()
                    return self._send(200, dict(ok=True))
                if path == '/api/project/resume':
                    project_server.retire(game_running, False)
                    return self._send(200, dict(ok=True))
                if path == '/api/project/shutdown':
                    retire_project()
                    with LOCK:
                        if tutorial.active_session():
                            tutorial.end(tutorial.active_session())
                    self._send(200, dict(ok=True))
                    threading.Thread(target=self.server.shutdown, daemon=True).start()
                    return
                return self._send(200, project_server.api(path, body))
            if path.startswith('/api/mods/'):
                return self._mods_POST(path)
            if not project_server.WORKER:
                return self._send(409, dict(error='Choose a project first.'))
            if path == '/api/missiongraph/scan':
                # Analysis never saves maps or compiles the project runtime.
                n = int(self.headers.get('Content-Length', 0) or 0)
                if not 0 <= n <= 256:
                    return self._send(400, dict(error='Invalid mission graph request.'))
                body = json.loads(self.rfile.read(n) or b'{}')
                if not isinstance(body, dict) or set(body) - {'readSources'} or ('readSources' in body and not isinstance(body['readSources'], bool)):
                    return self._send(400, dict(error='Invalid mission graph request.'))
                with project_server.operation():
                    return self._send(200, mission_graph.start(body.get('readSources', False), LOCK, project_server.operation))
            if path in ('/api/pieces_scan', '/api/pieces_stop'):
                # Starting/pausing a library scan must not wait for a busy SDK.
                with project_server.operation():
                    n = int(self.headers.get('Content-Length', 0) or 0)
                    if n < 0 or n > 2048:
                        return self._send(400, dict(error='Invalid Pieces request.'))
                    body = json.loads(self.rfile.read(n) or b'{}')
                    if not isinstance(body, dict) or set(body) - {'force'} or ('force' in body and not isinstance(body['force'], bool)):
                        return self._send(400, dict(error='Invalid Pieces request.'))
                    if path == '/api/pieces_stop':
                        return self._send(200, pieces_library.stop())
                    return self._send(200, pieces_library.start(LOCK, force=body.get('force', False),
                                      prepare=project_server.ensure_runtime, operation=project_server.operation,
                                      waiting=lambda: WAITING['n'] > 0))
            with project_server.operation(), UserTurn():
                query = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
                tutorial_write_guard(path, query, self.headers)
                if path in ('/api/play_prepare', '/api/play'):
                    require_player_start(query.get('script', ''))
                automatic_save = query.get('automatic') == '1' and path in ('/api/edits', '/api/story')
                if automatic_save and tutorial.available() and tutorial.is_script(query.get('script', '')):
                    return self._send(409, dict(error='Autosave is disabled for the temporary tutorial.'))
                if not automatic_save and path not in ('/api/tutorial_info', '/api/tutorial_start', '/api/tutorial_end', '/api/tutorial_reset', '/api/live_stop', '/api/experimental_bsp'):
                    project_server.ensure_runtime()
                return self._project_POST()
        except (ValueError, RuntimeError, OSError) as exc:
            return self._send(409, project_server.error_payload(exc))

    def _mods_POST(self, path):
        """Projects > Mods: install a .dxmod (its bytes, ?replace=1 to update), play, uninstall, show a file."""
        n = int(self.headers.get('Content-Length', 0) or 0)
        q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
        if path == '/api/mods/install':
            if n <= 22 or n > mods.MAX_TOTAL:
                return self._send(400, dict(error='Choose a .dxmod or .zip file.'))
            raw = self.rfile.read(n)
            if len(raw) != n:
                return self._send(400, dict(error='The mod upload was incomplete.'))
            try:
                # a .dxmod, a zip with one in it, or a classic mod's zip (mods.import_zip)
                return self._send(200, mods.import_zip(raw, q.get('name', ''), q.get('game') or None,
                                                       replace=q.get('replace') == '1'))
            except FileExistsError as exc:
                return self._send(409, dict(exists=json.loads(str(exc))))
            except zipfile.BadZipFile:
                return self._send(400, dict(error='This is not a DeusEdix mod file.'))
        if n < 0 or n > 4096:
            return self._send(400, dict(error='Invalid mod request.'))
        body = json.loads(self.rfile.read(n) or b'{}')
        if path == '/api/mods/play':
            return self._send(200, mods.play(body.get('game'), body.get('id')))
        if path == '/api/mods/uninstall':
            return self._send(200, mods.uninstall(body.get('game'), body.get('id')))
        if path == '/api/mods/start':
            return self._send(200, mods.set_start(body.get('game'), body.get('id'), body.get('start')))
        if path == '/api/mods/reveal':           # Explorer on an exported mod (only in the exports folder)
            target = Path(str(body.get('path') or '')).resolve()
            if target.suffix.lower() != mods.EXT or mods.EXPORTS.resolve() not in target.parents or not target.is_file():
                return self._send(400, dict(error='Unknown file.'))
            subprocess.Popen(['explorer', '/select,', str(target)])
            return self._send(200, dict(ok=True))
        return self._send(404, dict(error='Unknown mod request.'))

    def _project_POST(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            n = int(self.headers.get('Content-Length', 0) or 0)
            if u.path == '/api/experimental_bsp' and (n <= 0 or n > 8192):
                self.close_connection = True
                return self._send(400, dict(error='Invalid experimental BSP request.'))
            texture_post = u.path in ('/api/texture_library', '/api/texture_import', '/api/texture_library_delete')
            if texture_post and (n <= 0 or n > 200 * 1024 * 1024):
                self.close_connection = True
                return self._send(400, dict(error='Send a texture project no larger than 200 MB.'))
            if u.path == '/api/mod_export':            # the project as one .dxmod in Documents\DeusEdix Mods
                if n <= 0 or n > 8 * 1024 * 1024:
                    return self._send(400, dict(error='Invalid export request.'))
                body = json.loads(self.rfile.read(n))
                picture = str(body.pop('cover', '') or '')
                import base64 as b64                  # (this function imports base64 itself further down)
                cover = b64.b64decode(picture.split(',', 1)[1]) if picture.startswith('data:image/png;base64,') else None
                return self._send(200, mods.export(body, cover))
            if u.path == '/api/mod_file':
                # Import a mod: one of its files (or its .zip) into the staging folder (editor/modimport.py)
                import modimport
                raw = self.rfile.read(n) if n > 0 else b''
                if len(raw) != n:
                    return self._send(400, dict(error='The upload was incomplete.'))
                try:
                    modimport.add_file(q.get('id', ''), q.get('path', ''), raw)
                    return self._send(200, dict(ok=True))
                except (ValueError, OSError) as exc:
                    return self._send(400, dict(error=str(exc)))
                except Exception as exc:
                    return self._send(400, dict(error='Cannot read %s: %s' % (q.get('path', ''), exc)))
            if u.path in ('/api/map_import', '/api/map_convert'):
                if n < 36 or n > mapfiles.MAX_IMPORT:
                    return self._send(400, dict(error='Choose a valid .dx map, no larger than 128 MB.'))
                raw = self.rfile.read(n)
                if len(raw) != n:
                    return self._send(400, dict(error='The map upload was incomplete.'))
                try:
                    with LOCK:
                        result = (mapfiles.convert_import if u.path == '/api/map_convert' else mapfiles.import_map)(q.get('name'), raw)
                    return self._send(200, result)
                except FileExistsError as exc:
                    return self._send(409, dict(error=str(exc)))
                except ValueError as exc:
                    return self._send(400, dict(error=str(exc)))
            if texture_post:
                raw = self.rfile.read(n)
                if len(raw) != n:
                    return self._send(400, dict(error='The texture upload was incomplete.'))
                try:
                    body = json.loads(raw)
                except (ValueError, UnicodeDecodeError):
                    return self._send(400, dict(error='The texture project is not valid JSON.'))
                if not isinstance(body, dict):
                    return self._send(400, dict(error='The texture project must be an object.'))
            else:
                body = json.loads(self.rfile.read(n) or b'{}') if n else {}
            if u.path == '/api/sheet':
                # contact sheet of the Libreria pezzi (pieces.js), for looking at many pieces at once
                import base64
                d = data.CACHE / '_sheets'
                d.mkdir(parents=True, exist_ok=True)
                name = re.sub(r'[^\w-]', '_', q.get('name', 'sheet'))
                (d / (name + '.png')).write_bytes(base64.b64decode(body['png'].split(',', 1)[1]))
                return self._send(200, {'ok': True, 'path': str(d / (name + '.png'))})
            if u.path == '/api/newmap':
                # "New map": an empty room (a map script, built now) or a copy of a map (newmap.py)
                if body.get('from') == 'copy':
                    with LOCK:
                        script, name = newmap.create_copy(body['name'], body['mission'], body['source'], body.get('location', ''))
                    return self._send(200, dict(script=script, map=name, ok=True, lines=['copy of %s' % body['source']]))
                script, name = newmap.create_empty(body['name'], body['mission'], body.get('size') or (2048, 2048, 384),
                                                   body.get('location', ''), body.get('textures'), mood=str(body.get('mood') or 'normal'))
                with LOCK:
                    ok, lines = build(script)
                    if not ok:                     # nothing left behind: the same name can be tried again
                        newmap.discard(script)
                return self._send(200, dict(script=script, map=name, ok=ok, lines=lines))
            if u.path == '/api/piece_prefab':
                # an object of the Pieces as a prefab, to place it (pasted like a copied structure)
                with LOCK:
                    return self._send(200, pieces_library.prefab(q['id']))
            if u.path == '/api/thumb':
                # the 3D preview of an object of the game for the browser (made by the page, kept here)
                import base64
                d = data.GAME_CACHE / '_palette' / 'thumbs'
                d.mkdir(parents=True, exist_ok=True)
                name = re.sub(r'[^\w.-]', '_', q.get('cls', ''))
                if name:
                    (d / (name + '.png')).write_bytes(base64.b64decode(body['png'].split(',', 1)[1]))
                return self._send(200, {'ok': bool(name)})
            if u.path == '/api/texture_library':
                try:
                    with LOCK:
                        name = textures.library_save(body.get('name'), body.get('png'), body.get('document'))
                        return self._send(200, dict(name=name, textures=textures.library()))
                except ValueError as exc:
                    return self._send(400, dict(error=str(exc)))
            if u.path == '/api/texture_library_delete':
                try:
                    with LOCK:
                        textures.library_delete(body.get('name'))
                        return self._send(200, dict(textures=textures.library()))
                except ValueError as exc:
                    return self._send(400, dict(error=str(exc)))
            if u.path == '/api/studio_anim':
                anims.studio_save(body)
                return self._send(200, dict(ok=True, list=anims.studio_list()))
            if u.path == '/api/studio_delete':
                anims.studio_delete(body.get('name', ''))
                return self._send(200, dict(ok=True, list=anims.studio_list()))
            if u.path == '/api/studio_rig':
                anims.rig_save(dict(body, legacy=False))
                return self._send(200, dict(ok=True))
            if u.path == '/api/studio_rig_legacy':
                anims.rig_save(dict(body, legacy=True))
                return self._send(200, dict(ok=True))
            if u.path == '/api/studio_bake':
                # an animation baked on a model by the Studio (frames as the model's own: int16, base64)
                import base64
                with LOCK:
                    anims.bake_save(body['mesh'], body['name'], int(body['frames']), float(body['rate']),
                                    base64.b64decode(body['data']), body.get('group') or 'UCAnim', body.get('props'))
                return self._send(200, dict(ok=True))
            if u.path == '/api/studio_pack':
                # settings.ANIMS_PACKAGE: the models with the Studio's animations, installed when the game is closed
                with LOCK:
                    ok, lines = anims.pack(log=lambda *a: None)
                return self._send(200, dict(ok=ok, lines=lines))
            if u.path == '/api/characters':
                with LOCK:
                    ch = characters.save(body.get('character'))
                return self._send(200, dict(character=ch, characters=characters.load_all()))
            if u.path == '/api/player_profiles':
                with LOCK:
                    return self._send(200, player_profiles.save(body.get('config'), body.get('revision')))
            if u.path == '/api/characters_delete':
                with LOCK:
                    characters.delete(body.get('id') or q.get('id', ''))
                return self._send(200, dict(characters=characters.load_all()))
            if u.path == '/api/texture_import':
                # an edited picture for the texture of an object or a structure (editor/textures.py)
                try:
                    with LOCK:
                        script = q.get('script', '')
                        map_name = map_of(script)
                        existing = set((body.get('existing') or [])) | set((load_edits(script).get('textures') or {}).keys())
                        info = textures.import_png(map_name, body.get('png'), body.get('base', ''), body.get('world'), existing,
                                                   document=body.get('document'))
                        info['url'] = '/textures/' + info['png']
                        return self._send(200, info)
                except (ValueError, TypeError) as exc:
                    return self._send(400, dict(error=str(exc)))
            if u.path == '/api/story':
                with LOCK:
                    import originalstory
                    originalstory.validate(body)
                    maplinks.validate_travel(story_data=body)
                    automatic = q.get('automatic') == '1'
                    # Autosave writes the current draft only. Renaming/packing
                    # voices belongs to explicit Save/Apply, with the game closed.
                    lines = [] if automatic else sounds.rekey(body, log=lambda *a: None)
                    story.save(map_of(q['script']), body)
                return self._send(200, dict(ok=True, lines=lines, voices=None if automatic else [l.get('voice') for l, _ in story.voiced_lines(body)]))
            if u.path == '/api/gamecons/copy':
                with LOCK:
                    try:
                        map_name=map_of(q['script'])
                        return self._send(200,gamecons.edit_copy(map_name,data.actors(map_name),body.get('conversation',''),bool(body.get('disabled')),body.get('actor','')))
                    except ValueError as e:
                        return self._send(400,dict(error=str(e)))
            if u.path in ('/api/dub', '/api/dub_delete'):
                # the voice of one line of the Story (recorded, imported, one of the user's sounds)
                with LOCK:
                    try:
                        if u.path == '/api/dub_delete':
                            ok, lines = sounds.dub_delete(body.get('key'))
                            return self._send(200, dict(ok=ok, lines=lines))
                        ok, lines, info = sounds.dub(body, log=lambda *a: None)
                        return self._send(200, dict(ok=ok, lines=lines, voice=info))
                    except ValueError as e:
                        return self._send(400, dict(error=str(e)))
            if u.path in ('/api/tutorial_start', '/api/tutorial_end', '/api/tutorial_reset', '/api/tutorial_portrait', '/api/tutorial_info'):
                # the interactive tutorial (editor/tutorial.py, static/tutorial.js)
                if u.path == '/api/tutorial_info':
                    return self._send(200, tutorial.info())           # the steps and the guide, nothing built
                with LOCK:
                    if not tutorial.available():
                        raise ValueError('Choose Revision or Deus Ex original, then open that game\'s interactive tutorial.')
                    if u.path == '/api/tutorial_end':
                        if body.get('session') == tutorial.active_session() and body.get('session'):
                            tutorial_can_reset()
                        return self._send(200, tutorial.end(body.get('session')))
                    if u.path == '/api/tutorial_reset':
                        tutorial.require_session(body.get('session'))
                        tutorial_can_reset()
                        return self._send(200, tutorial.reset(session=body.get('session')))
                    if u.path == '/api/tutorial_portrait':
                        return self._send(200, dict(changed=tutorial.portrait(body['png'])))
                    if not body.get('session'):
                        tutorial_can_reset()
                        tutorial.prepare_runtime()
                    else:
                        tutorial.require_session(body.get('session'))
                    project_server.ensure_runtime()
                    return self._send(200, tutorial.start(build, session=body.get('session')))
            if u.path == '/api/story_apply':
                # stories -> UnrealScript, compiled with the editor's package; installed if the game is closed
                with LOCK:
                    if game_running():
                        return self._send(400,dict(ok=False,lines=['Close %s before applying conversation or voice changes.' % settings.PROFILE['short']]))
                    voiced = []
                    if body.get('story') is not None:
                        import originalstory
                        originalstory.validate(body['story'],complete=True)
                        maplinks.validate_travel(story_data=body['story'])
                        voiced = sounds.rekey(body['story'], log=lambda *a: None)
                        story.save(map_of(q['script']), body['story'])
                    lines = voiced + story.write_all()
                    ok, out = run_ps('build.ps1', '-Isolated')
                    lines += out
                    if ok and not game_running():
                        ok, out = run_ps('install.ps1')
                        lines += out
                    elif ok:
                        lines.append('The game is open: close it and press Apply again to install.')
                voices = [l.get('voice') for l, _ in story.voiced_lines(body['story'])] if body.get('story') is not None else None
                return self._send(200, dict(ok=ok, lines=lines, voices=voices))
            if u.path == '/api/copy_ref':
                # a piece of an original map (Libreria pezzi) into the clipboard
                key = 'ref_' + q['map']
                with LOCK:
                    clip = prefabs.copy(q['map'], q['structure'], data.map_folder(key), data.structures(key))
                return self._send(200, clip)
            if u.path == '/api/copy':
                # copy a structure (as a prefab) or an object of the map shown, to paste it into any map
                map_name = map_of(q['script'])
                folder = data.CACHE / map_name
                if body.get('structure'):
                    with LOCK:
                        return self._send(200, prefabs.copy(map_name, body['structure'], folder, data.structures(map_name)))
                return self._send(200, copy_actor(map_name, body['actor']))
            if u.path == '/api/prefab_library':
                with LOCK:
                    return self._send(200, save_prefab_selection(q['script'], body))
            if u.path in ('/api/t3d_export', '/api/t3d_import'):
                # UnrealEd's clipboard: the selection as T3D for its Edit > Paste, or what its Edit > Copy put there
                import t3d_clipboard
                if u.path == '/api/t3d_export':
                    return self._send(200, t3d_clipboard.export(body.get('items') or [], body.get('holes') or []))
                try:
                    return self._send(200, t3d_clipboard.read(body.get('text') or ''))
                except ValueError as e:
                    return self._send(400, dict(error=str(e)))
            if u.path in ('/api/sound_import', '/api/sound_delete'):
                # the user's sounds (the browser's Import, My sounds) made into the editor's sounds package
                with LOCK:
                    try:
                        if u.path == '/api/sound_delete':
                            ok, lines = sounds.delete_sound(body.get('name'))
                            return self._send(200, dict(ok=ok, lines=lines))
                        ok, lines, names = sounds.import_sounds(body.get('items') or [], log=lambda *a: None)
                        return self._send(200, dict(ok=ok, lines=lines, names=names))
                    except ValueError as e:
                        return self._send(400, dict(error=str(e)))
            if u.path in ('/api/model_import', '/api/model_delete'):
                # a 3D model from a file made into the package settings.MODELS_PACKAGE, or taken away
                import models
                with LOCK:
                    try:
                        if u.path == '/api/model_delete':
                            ok, lines = models.delete_model(body.get('name'))
                            return self._send(200, dict(ok=ok, lines=lines))
                        ok, lines, mesh = models.import_model(body, log=lambda *a: None)
                        return self._send(200, dict(ok=ok, lines=lines, mesh=mesh))
                    except ValueError as e:
                        return self._send(400, dict(error=str(e)))
            if u.path in ('/api/mod_new', '/api/mod_scan', '/api/mod_install', '/api/mod_discard'):
                import modimport
                try:
                    with LOCK:
                        if u.path == '/api/mod_new':
                            return self._send(200, dict(id=modimport.new()))
                        if u.path == '/api/mod_scan':
                            return self._send(200, modimport.scan(body.get('id', '')))
                        if u.path == '/api/mod_discard':
                            modimport.discard(body.get('id', ''))
                            return self._send(200, dict(ok=True))
                        return self._send(200, modimport.install(body.get('id', ''), body))
                except ValueError as exc:
                    return self._send(400, dict(error=str(exc)))
            if u.path == '/api/packages':
                import packages
                with LOCK:
                    try:
                        return self._send(200, dict(ok=True, extra=packages.save(body.get('extra'))))
                    except ValueError as e:
                        return self._send(400, dict(error=str(e)))
            if u.path == '/api/edits':
                try:
                    activation.names(body)
                    object_tags.validate(body)
                    surfaces.commands(body)
                    documents.validate(body)
                    maplinks.validate_travel(edits=body)
                    player_profiles.validate_edits(body)
                except (ValueError, TypeError, AttributeError) as e:
                    return self._send(400, dict(error=str(e)))
                import atomicfile
                atomicfile.write_json(edits_path(q['script']), body)
                return self._send(200, {'ok': True})
            if u.path == '/api/experimental_bsp':
                import bsp_experimental
                return self._send(200, bsp_experimental.open_for_editor(sys.modules[__name__], body))
            if u.path == '/api/build':
                with LOCK:
                    ok, lines = build(q['script'], body)
                return self._send(200, {'ok': ok, 'lines': lines})
            if u.path == '/api/view':
                with LOCK:
                    tutorial_runtime(q['script'])
                    url, answer = view(q['script'], body)
                return self._send(200, {'url': url, 'answer': answer})
            if u.path in ('/api/script_save', '/api/script_new', '/api/script_delete'):
                import scripts as user_scripts
                name = str(body.get('name', ''))
                if u.path == '/api/script_save':
                    user_scripts.save(name, str(body.get('text', '')))
                    return self._send(200, dict(ok=True, name=name))
                if u.path == '/api/script_new':
                    return self._send(200, dict(ok=True, name=name, text=user_scripts.new(name, str(body.get('kind', 'triggered')))))
                user_scripts.delete(name)
                return self._send(200, dict(ok=True, scripts=user_scripts.names()))
            if u.path == '/api/font_import':
                # a font file of the user's (signs, the Texture Editor's Text tool): kept in tools\mapkit\fonts
                import base64
                name = Path(str(body.get('name', ''))).name
                ext = Path(name).suffix.lower()
                if ext not in FONT_TYPES:
                    raise ValueError('A font is a .ttf, .otf, .woff or .woff2 file.')
                font_data = base64.b64decode(str(body.get('data', '')), validate=True)
                if not font_data or len(font_data) > 20 * 1024 * 1024:
                    raise ValueError('That font file is empty or too big (over 20 MB).')
                stem = re.sub(r'[^A-Za-z0-9 _-]+', '', Path(name).stem).strip().replace(' ', '_')[:60] or 'Font'
                FONTS.mkdir(exist_ok=True)
                (FONTS / (stem + ext)).write_bytes(font_data)
                return self._send(200, dict(ok=True, family=stem.replace('_', ' ')))
            if u.path == '/api/ammo_save':
                import weapons
                with LOCK:
                    return self._send(200, weapons.save_ammo(body))
            if u.path in ('/api/weapon_save', '/api/weapon_delete'):
                # a weapon's settings and class (weapons.py), compiled with the project's scripts
                import weapons
                with LOCK:
                    if u.path == '/api/weapon_save':
                        return self._send(200, weapons.save(body))
                    return self._send(200, weapons.delete(str(body.get('name', ''))))
            if u.path == '/api/scripts_compile':
                import scripts as user_scripts
                with LOCK:
                    return self._send(200, user_scripts.compile(log=lambda *a: None))
            if u.path == '/api/console':
                # the Console: one line for the running game's own console (UCConsoleLink), not under LOCK
                import live
                answer = live.console(body.get('command', ''))
                return self._send(200, dict(ok=True, answer=answer, queued=answer is None))
            if u.path == '/api/live_stop':
                import live
                with LOCK:
                    session = live.session_status()
                    if body.get('previewToken'):
                        if (not secrets.compare_digest(str(body['previewToken']), PREVIEW.get('token') or '')
                                or session.get('running') or session.get('launching')):
                            raise RuntimeError('This Play preparation has changed. Refresh its status before cancelling.')
                    if body.get('token') and not secrets.compare_digest(str(body['token']), str(session.get('token') or '')):
                        raise RuntimeError('This Play session has been replaced. Refresh its status before stopping.')
                    answer = live.stop(timeout=5)
                    session = live.session_status()
                    if not session.get('running') and not session.get('launching') and game_running():
                        raise RuntimeError('Another game is still running. Close it before restoring the Play copy.')
                    stopped = not session.get('running') and not session.get('launching') and not session.get('error') and not game_running()
                    if stopped:
                        # Keep recovery visible until every temporary map has
                        # been restored, so a conflict stays retryable.
                        play_preview.restore()
                        PLAY.update(active=False)
                        LIVE.update(shown=None, active=False)
                        PREVIEW.update(token=None, script=None)
                    return self._send(200, {'ok': True, 'answer': answer, 'session': session})
            if u.path == '/api/install':
                if tutorial.available() and tutorial.is_script(q['script']):
                    return self._send(200, {'ok': False, 'lines': ['The tutorial is temporary. Use Play to test your exercise; closing its map discards it.']})
                if game_running():
                    return self._send(200, {'ok': False, 'lines': ['Close the game (or press "Close game") before installing.']})
                ok, lines = install_map(q['script'])
                return self._send(200, {'ok': ok, 'lines': lines})
            if u.path == '/api/play_prepare':
                import live
                if game_running() or live.session_status().get('launching'):
                    raise RuntimeError('Stop the current game before preparing another Play session.')
                PREVIEW.update(token=None, script=None)
                try:
                    ok, lines = prepare_play(q['script'])
                except Exception:
                    if not game_running() and not live.session_status().get('launching'):
                        play_preview.restore()
                    raise
                if ok:
                    PREVIEW.update(token=secrets.token_hex(24), script=q['script'])
                return self._send(200, dict(ok=ok, lines=lines, token=PREVIEW['token']))
            if u.path == '/api/play':
                # "Play from here": the installed map, JC where the camera is, a mission state and flags
                import live
                display_mode = body.get('displayMode', 'external')
                if display_mode not in ('embedded', 'external'):
                    raise ValueError('Unknown Play display mode.')
                if game_running() or live.session_status().get('launching'):
                    return self._send(200, {'ok': False, 'lines': ['The game is already open: close it first (or press "Close game").']})
                map_name = map_of(q['script'])
                lines = []
                prepared = bool(body.get('previewToken'))
                require_player_start(q['script'])
                if prepared:
                    if PREVIEW['script'] != q['script'] or not secrets.compare_digest(str(body['previewToken']), PREVIEW['token'] or ''):
                        raise ValueError('This Play preparation expired. Press Play again.')
                elif body.get('prepare'):
                    ok, lines = prepare_play(q['script'])
                    if not ok:
                        return self._send(200, {'ok': False, 'lines': lines})
                else:
                    tutorial_runtime(q['script'])
                if not prepared and not body.get('prepare') and body.get('install') and play.pending_install(map_name, is_dx(q['script']), data.OUT, dxmaps.built_current):
                    ok, lines = install_map(q['script'])
                    if not ok:
                        return self._send(200, {'ok': False, 'lines': lines})
                if tutorial.available() and tutorial.is_script(q['script']):
                    body = dict(body, **tutorial.play_start(), setup='', flags='', route=False)
                flags = play.flags_text(body.get('route', True), body.get('flags', ''))
                with LOCK:
                    try:
                        answer = play.start(map_name, body.get('at'), body.get('yaw', 0), body.get('pitch', 0),
                                            body.get('setup') or '', flags, display_mode=display_mode)
                    except Exception:
                        session = live.session_status()
                        if not session.get('running') and not session.get('launching') and not session.get('error') and not game_running():
                            play_preview.restore()
                        raise
                    PLAY.update(active=True, seen=False, t=time.time())
                    PREVIEW.update(token=None, script=None)
                return self._send(200, {'ok': True, 'session': live.session_status(), 'lines': lines + [answer + (' (flags: %s)' % flags if flags else '')]})
            return self._send(404, {'error': 'unknown'})
        except (ValueError, RuntimeError, OSError) as e:
            return self._send(409, project_server.error_payload(e))
        except Exception as e:
            return self._send(500, {'error': str(e), 'trace': traceback.format_exc()[-1500:]})


def watch_game():
    """The game opened by "View in game" or "Play from here" and then closed with its own X: put its
    settings back (RevisionUser.ini without the runner's section, no UCLive maps), as "Close game" does."""
    import live
    while True:
        time.sleep(3)
        try:
            if PLAY.get('active') or LIVE.get('active'):
                with project_server.operation(), LOCK:
                    play_session_status()
        except RuntimeError:
            if project_server.status()['retiring']:
                return
            traceback.print_exc()
        except Exception:
            traceback.print_exc()


def main():
    import live
    # the folders the editor writes in (a fresh install has none of them yet)
    for d in (KIT / 'out', KIT / 'runs', KIT / 'maps', HERE / 'cache', PROJECT / 'maps', PROJECT / 'dist'):
        d.mkdir(parents=True, exist_ok=True)
    if project_server.WORKER and not game_running():
        live.stop()          # a live session left over by a crash or a game closed while the editor was off
        play_preview.restore()
    if project_server.WORKER:
        threading.Thread(target=watch_game, daemon=True).start()
    port = int(sys.argv[sys.argv.index('--port') + 1]) if '--port' in sys.argv else PORT
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    url = 'http://localhost:%d/' % port
    project_server.HOME_URL = 'http://127.0.0.1:%d/' % port
    print('DeusEdix map editor: %s  (close this window to stop it)' % url, flush=True)
    if '--no-browser' not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    finally:
        srv.server_close()
        if not project_server.WORKER:
            project_server.SUPERVISOR.shutdown()


if __name__ == '__main__':
    main()
