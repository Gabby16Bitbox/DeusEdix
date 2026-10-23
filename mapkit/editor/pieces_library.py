"""Generate Pieces locally from the selected game's original maps, never ship map data.

GET data() is cheap and never acquires the SDK lock. The optional prepare and
operation callbacks keep runtime preparation/project switching owned by the server.
Only generated reference caches, preview files and catalogs are written here.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
import functools
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time

import atomicfile
import data as editor_data
import dxmaps
import gamelib
import moving_pieces
import settings
import t3d

_MAP = re.compile(r'[0-9]{2}_[A-Za-z0-9_-]+')
_OBJECT = re.compile(moving_pieces.IDENTITY)
# 2: the previews and the prefabs carry the textures' own flags (masked grates, translucent glass), so the
# previews kept from before are made again
PREVIEW_VERSION = 2
_REQUIRED = ('stamp.txt', 'brushes.json', 'polys.json', 'textures.json', 'geometry.json', 'scene.t3d')
# Several maps are read at once: every SDK session is its own process in its own private run folder, and
# about half of a map's time is the SDK starting and the textures turning into PNGs.
_WORKERS = max(1, min(3, (os.cpu_count() or 2) // 3))
_guard = threading.RLock()
_cancel = threading.Event()
_thread = None
_health = {}
_scan = dict(state='idle', processed=0, total=0, current=None, items=0,
             message='Generate Pieces from this game’s installed maps.', errors=[], stale=False)


def _safe(root, path):
    root, path = Path(root).absolute(), Path(path).absolute()
    if path != root and not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Pieces cache paths must stay inside their approved folder.')
    for part in (path, *path.parents):
        if part.exists() or part.is_symlink():
            if part.is_symlink() or getattr(os.lstat(part), 'st_file_attributes', 0) & 0x400:
                raise ValueError('Pieces cannot follow linked cache files or map folders.')
        if part == root:
            break
    return path


def _identity():
    root = Path(settings.REVISION_MAPS)
    _safe(root, root)
    if Path(dxmaps.GAME_MAPS).resolve() != root.resolve():
        raise ValueError('The Pieces map source does not match this project’s game target.')
    return dict(version=1, target=settings.TARGET, maps_root=str(root.resolve()), mesh_version=editor_data.MESH_VERSION)


def _inventory():
    root = Path(settings.REVISION_MAPS)
    if not root.is_dir():
        raise ValueError('This game’s original Maps folder is missing. Check the configured game installation.')
    rows = {}
    for path in root.iterdir():
        if path.suffix.lower() != '.dx' or not _MAP.fullmatch(path.stem):
            continue
        _safe(root, path)
        if path.is_file():
            rows[path.stem] = path
    if not rows:
        raise ValueError('No original NN_*.dx maps were found for this game. No library was changed.')
    return dict(sorted(rows.items(), key=lambda item: item[0].casefold()))


def _signature(path, digest=True):
    path = Path(path)
    before = path.stat()
    value = dict(path=str(path.resolve()), size=before.st_size, mtime=before.st_mtime_ns)
    if digest:
        h = hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                h.update(chunk)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise RuntimeError('An original map changed during scanning; retry after the game update finishes.')
        value['sha256'] = h.hexdigest()
    return value


def _stat_matches(path, signature):
    try:
        return isinstance(signature, dict) and _signature(path, False) == {k: signature.get(k) for k in ('path', 'size', 'mtime')}
    except OSError:
        return False


def _catalog():
    path = _safe(gamelib.CATALOG.parent, gamelib.CATALOG)
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        if (not isinstance(value, dict) or value.get('version') != gamelib.VERSION or
                not isinstance(value.get('items'), list) or not isinstance(value.get('categories'), list) or
                any(not isinstance(category, str) for category in value['categories'])):
            return {}
        return value
    except (OSError, ValueError):
        return {}


def _source(catalog, identity):
    value = catalog.get('piecesSource')
    if (not isinstance(value, dict) or any(value.get(key) != expected for key, expected in identity.items()) or
            not isinstance(value.get('complete'), bool) or not isinstance(value.get('errors'), list) or
            not isinstance(value.get('inventory'), list) or any(
                not isinstance(name, str) or not _MAP.fullmatch(name) for name in value.get('inventory', [])) or
            not isinstance(value.get('maps'), dict) or any(
                not _MAP.fullmatch(name) or not isinstance(signature, dict) or
                not isinstance(signature.get('sha256'), str) or not re.fullmatch(r'[a-f0-9]{64}', signature['sha256'])
                for name, signature in value.get('maps', {}).items())):
        return None
    return value


def _update(**values):
    with _guard:
        _scan.update(values)


def _revision(identity, signature):
    content = dict(target=identity['target'], mesh_version=identity['mesh_version'],
                   objects_version=gamelib.VERSION, sha256=signature.get('sha256'), preview=PREVIEW_VERSION)
    return hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()[:20]


def data():
    """A nonblocking snapshot. Never run SDK extraction from a GET."""
    with _guard:
        scan = dict(_scan, errors=list(_scan['errors']))
    catalog = _catalog()
    try:
        identity = _identity()
        source = _source(catalog, identity)
        inventory = list(_inventory())
    except (OSError, ValueError) as exc:
        source = None
        scan.update(state='error', message=str(exc), stale=True)
    valid, stale = {}, source is None
    if source:
        stale = source.get('inventory') != inventory
        for name, signature in source['maps'].items():
            if (_MAP.fullmatch(name) and _stat_matches(Path(settings.REVISION_MAPS) / (name + '.dx'), signature)
                    and _cache_health(name, signature, identity)):
                valid[name] = signature
            else:
                stale = True
    items = [dict(item, revision=_revision(identity, valid[item['map']]))
             for item in catalog.get('items', []) if isinstance(item, dict) and
             isinstance(item.get('map'), str) and item.get('map') in valid and
             _OBJECT.fullmatch(str(item.get('id', '')))]
    scan.update(items=len(items), stale=stale)
    if source and scan['state'] == 'idle':
        finished = source.get('complete') and not stale
        failed = bool(source.get('errors')) and not valid
        scan.update(state=('error' if failed else 'complete') if finished else 'paused',
                    processed=source.get('processed', len(valid)), total=source.get('total', len(valid)),
                    errors=source.get('errors', []), message='Pieces ready.' if source.get('complete') and not stale else 'Resume scanning to finish or refresh the local library.')
    if stale and scan['state'] == 'complete':
        scan.update(state='idle', message='The original maps changed. Rescan to refresh this game’s Pieces.')
    revision = hashlib.sha256(json.dumps([(item['id'], item['revision']) for item in items]).encode()).hexdigest()[:20]
    return dict(version=gamelib.VERSION, categories=catalog.get('categories', []) if source else [], items=items,
                revision=revision, gameName=getattr(settings, 'GAME_NAME', settings.TARGET), target=settings.TARGET, scan=scan)


def _cache_folder(name):
    return _safe(editor_data.GAME_CACHE, Path(editor_data.GAME_CACHE) / ('ref_' + name))      # shared by the game's projects


def _cache_valid(name, signature, identity, objects=True):
    folder = _cache_folder(name)
    try:
        marker = json.loads(_safe(folder, folder / 'pieces-source.json').read_text(encoding='utf-8'))
        if marker != dict(identity=identity, source=signature):
            return False
        if any(not _safe(folder, folder / file).is_file() for file in _REQUIRED):
            return False
        textures = json.loads((folder / 'textures.json').read_text(encoding='utf-8'))
        if not isinstance(textures, dict):
            return False
        for info in textures.values():
            png = info.get('png') if isinstance(info, dict) else None
            if png and (not isinstance(png, str) or not _safe(folder, folder / png).is_file()):
                return False
        expected = '%s-%d-%d-m%d' % (Path(dxmaps.GAME_MAPS) / (name + '.dx'), signature['mtime'], signature['size'], editor_data.MESH_VERSION)
        return ((folder / 'stamp.txt').read_text() == expected and
                (not objects or (_safe(gamelib.CACHE, gamelib.CACHE / (name + '.json')).is_file() and
                                 moving_pieces.ready(_safe(folder, folder / moving_pieces.ASSETS).parent))))
    except (OSError, ValueError, TypeError, KeyError):
        return False


def _cache_health(name, signature, identity):
    """Short GET-only health memo; scans/placement always recheck every asset."""
    folder = _cache_folder(name)
    try:
        stamps = tuple((file, path.stat().st_mtime_ns, path.stat().st_size) for file in (*_REQUIRED, 'pieces-source.json', moving_pieces.ASSETS)
                       for path in [_safe(folder, folder / file)])
        object_path = _safe(gamelib.CACHE, gamelib.CACHE / (name + '.json'))
        stamps += (('objects', object_path.stat().st_mtime_ns, object_path.stat().st_size),)
    except (OSError, ValueError):
        return False
    key = (str(folder.resolve()), signature['sha256'], identity['target'], identity['mesh_version'])
    now = time.monotonic()
    with _guard:
        previous = _health.get(key)
        if previous and previous[0] > now and previous[1] == stamps:
            return previous[2]
    valid = _cache_valid(name, signature, identity)
    with _guard:
        _health[key] = (now + 3, stamps, valid)
    return valid


def _publish(ready, identity, *, complete=False, processed=0, total=0, errors=(), inventory=()):
    source = dict(identity, maps=dict(ready), complete=complete, processed=processed, total=total,
                  errors=list(errors), inventory=list(inventory), updated=time.time())
    _safe(gamelib.CATALOG.parent, gamelib.CATALOG)
    _safe(gamelib.CACHE, gamelib.CACHE)
    items = gamelib.build(maps=sorted(ready), log=lambda *args: None, metadata=dict(piecesSource=source))
    _update(items=len(items))


def _read_map(name, path, identity, signature):
    """One original map into its reference cache (a worker of _run; the caller holds the SDK lock)."""
    folder = _cache_folder(name)
    if not _cache_valid(name, signature, identity, objects=False):
        # A SHA-only change can defeat data.prepare's mtime/size stamp.
        # Remove only our generated stamp to force a fresh private export.
        if folder.exists() and (folder / 'stamp.txt').exists():
            _safe(folder, folder / 'stamp.txt').unlink()
        key, exported, _ = dxmaps.reference(name, log=lambda *args: None)
        if key != 'ref_' + name or Path(exported).resolve() != folder.resolve():
            raise ValueError('The SDK returned a cache outside this project’s reference folder.')
        if _signature(path) != signature:
            raise RuntimeError('The original map changed during export. Retry this map after the game update.')
        atomicfile.write_json(_safe(folder, folder / 'pieces-source.json'), dict(identity=identity, source=signature))
    _safe(folder, folder / moving_pieces.ASSETS)
    moving_pieces.prepare(folder, path, log=lambda *args: None)
    if _signature(path) != signature:
        raise RuntimeError('The original map changed while reading its movers. Retry after the update.')
    return signature


def _run(lock, maps, identity, prepare, operation):
    ready, errors, processed = {}, [], 0
    # The catalog is indexed again from every map read so far: done after each map it grew with the square
    # of the maps (about 20 minutes of a first scan of 89 maps). Now at most a quarter of the time goes to it.
    published = dict(at=time.monotonic(), took=0.0, pending=False)

    def publish(force=False):
        if not published['pending'] or (not force and time.monotonic() - published['at'] < max(10.0, 3 * published['took'])):
            return
        t = time.monotonic()
        _publish(ready, identity, processed=processed, total=len(maps), errors=errors, inventory=maps)
        published.update(at=time.monotonic(), took=time.monotonic() - t, pending=False)
    try:
        existing = _source(_catalog(), identity)
        if existing:
            ready = {name: value for name, value in existing['maps'].items() if name in maps and
                     _stat_matches(maps[name], value) and _cache_valid(name, value, identity)}
        if prepare:
            _update(message='Preparing the local headless map tools…')
            with operation() if operation else nullcontext():
                with lock:
                    if _cancel.is_set():
                        return
                    prepare()
        names = list(maps)
        with ThreadPoolExecutor(max_workers=_WORKERS, thread_name_prefix='DeusEdix-PiecesMap') as pool:
            for start in range(0, len(names), _WORKERS):
                if _cancel.is_set():
                    break
                batch = names[start:start + _WORKERS]
                _update(current=batch[0], message='Reading %s…' % ', '.join(batch))
                closed = False
                try:
                    with operation() if operation else nullcontext():
                        with lock:
                            if _cancel.is_set():
                                break
                            jobs = {}
                            for name in batch:
                                try:
                                    signature = _signature(maps[name])
                                    if ready.get(name) == signature and _cache_valid(name, signature, identity):
                                        jobs[name] = None          # already in the cache: nothing to read
                                    else:
                                        jobs[name] = pool.submit(_read_map, name, maps[name], identity, signature)
                                except (Exception, SystemExit) as exc:
                                    jobs[name] = exc
                            for name, job in jobs.items():
                                try:
                                    if isinstance(job, BaseException):
                                        raise job
                                    if job is not None:
                                        ready[name] = job.result()
                                        published['pending'] = True
                                except (Exception, SystemExit) as exc:
                                    ready.pop(name, None)
                                    errors.append(dict(map=name, message=str(exc)[:500]))
                                processed += 1
                                _update(processed=processed, errors=list(errors))
                            publish()
                except (Exception, SystemExit) as exc:
                    if operation and 'project has been closed' in str(exc).lower():
                        _cancel.set()
                        _update(message='Scanning paused because the project was closed.')
                        closed = True
                    else:
                        raise
                if closed:
                    break
                # Release project/SDK locks between batches so normal editor actions can proceed.
                if _cancel.wait(0.05):
                    break
        if _cancel.is_set():
            if published['pending']:          # what was read before the pause is in the library
                try:
                    with operation() if operation else nullcontext():
                        with lock:
                            publish(force=True)
                except (Exception, SystemExit):
                    pass
            _update(state='paused', current=None, message='Pieces scanning paused. Generated pieces are kept; Resume continues from the cache.')
        else:
            with operation() if operation else nullcontext():
                with lock:
                    _publish(ready, identity, complete=True, processed=processed, total=len(maps), errors=errors, inventory=maps)
            _update(state='error' if errors and not ready else 'complete', current=None,
                    message=('Some maps could not be read. Retry to complete the library.' if errors else 'Pieces ready.'), errors=list(errors))
    except (Exception, SystemExit) as exc:
        _update(state='paused' if _cancel.is_set() else 'error', current=None, message=str(exc)[:500], errors=list(errors))
    finally:
        if _cancel.is_set():
            _update(state='paused', current=None)


def start(lock, force=False, prepare=None, operation=None):
    """Start/resume one job and return immediately, never synchronously initialize SDK."""
    global _thread
    if not isinstance(force, bool):
        raise ValueError('The Pieces rescan option must be true or false.')
    with _guard:
        if _thread and _thread.is_alive():
            return data()
        snapshot = data()
        identity, maps = _identity(), _inventory()
        # Refresh must check the inventory and source SHA even after a completed
        # job. Valid reference exports are reused, so this does not rerun SDK.
        _health.clear()
        _cancel.clear()
        _scan.update(state='running', processed=0, total=len(maps), current=None, items=len(snapshot['items']),
                     message='Starting local Pieces generation…', errors=[], stale=snapshot['scan']['stale'])
        _thread = threading.Thread(target=_run, args=(lock, maps, identity, prepare, operation), name='DeusEdix-Pieces', daemon=True)
        _thread.start()
    return data()


def stop(snapshot=True):
    """Cancel without SDK interruption; lifecycle callers skip the expensive catalog snapshot."""
    with _guard:
        if _thread and _thread.is_alive():
            _cancel.set()
            _scan.update(state='pausing', message='Pausing after the current map finishes…')
    return data() if snapshot else None


@functools.lru_cache(maxsize=2)
def _brush_blocks(path, mtime, size):
    # Parsing is pure and keyed by the actual exported file, not the game map's
    # name. Rebuilt/replaced reference exports cannot reuse a previous parse.
    return {actor['name']: actor for actor in t3d.actors(Path(path).read_text(encoding='latin1'))}


def _validate_piece(item, name):
    if item.get('kind') in ('door', 'elevator'):
        path = _safe(_cache_folder(name), _cache_folder(name) / 'scene.t3d')
        st = path.stat()
        actors = _brush_blocks(str(path), st.st_mtime_ns, st.st_size)
        names = item.get('actors')
        if not isinstance(names, list) or len(names) != 1 or names[0] not in actors:
            raise ValueError('This moving piece is incomplete. Rescan Pieces first.')
        moving_pieces.template(actors[names[0]], item['kind'], item.get('tex') or [])
        return
    names = item.get('brushes')
    if (not isinstance(names, list) or not names or
            any(not isinstance(value, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', value) for value in names)):
        raise ValueError('This piece’s generated brush cache is incomplete. Rescan Pieces first.')
    path = _safe(_cache_folder(name), _cache_folder(name) / 'scene.t3d')
    st = path.stat()
    actors = _brush_blocks(str(path), st.st_mtime_ns, st.st_size)
    local = re.compile(r'\b(?:MyLevel|%s)\.' % re.escape(name), re.I)
    for selected in names:
        actor = actors.get(selected)
        if not actor or actor['cls'].split('.')[-1] != 'Brush':
            raise ValueError('This piece’s generated brush cache is incomplete. Rescan Pieces first.')
        raw = re.sub(r'(?m)^[ \t]*(?:Level|Region)=.*\n?', '', actor['raw'])
        for line in raw.splitlines():
            model = re.fullmatch(r"\s*Brush=Model'MyLevel\.[A-Za-z_][A-Za-z0-9_]*'\s*", line, re.I)
            if local.search(line) and not model:
                raise ValueError('This piece uses a level-local resource; choose another piece.')


def prefab(oid, log=print):
    """Validate source identity and use a content-versioned generated prefab ID."""
    if not isinstance(oid, str) or not _OBJECT.fullmatch(oid):
        raise ValueError('Invalid Pieces object identity.')
    catalog, identity = _catalog(), _identity()
    source = _source(catalog, identity)
    item = next((item for item in catalog.get('items', []) if isinstance(item, dict) and item.get('id') == oid), None)
    if not source or not item or not isinstance(item.get('map'), str) or item.get('map') not in source['maps']:
        raise ValueError('This piece does not belong to the current game’s generated library. Rescan Pieces first.')
    name, signature = item['map'], source['maps'][item['map']]
    if not _MAP.fullmatch(name):
        raise ValueError('Invalid Pieces source map.')
    path = _safe(Path(settings.REVISION_MAPS), Path(settings.REVISION_MAPS) / (name + '.dx'))
    if _signature(path) != signature or not _cache_valid(name, signature, identity):
        raise ValueError('This original map changed or its cache is missing. Rescan Pieces before placing it.')
    _validate_piece(item, name)
    version = hashlib.sha256(json.dumps(dict(identity, source=signature, objects_version=gamelib.VERSION, preview=PREVIEW_VERSION),
                                        sort_keys=True).encode()).hexdigest()[:16]
    pid = 'obj_' + re.sub(r'\W', '_', oid) + '_' + version
    return gamelib.prefab(oid, log=log, pid=pid)
