"""Disposable editor preview from the build's existing native process.

The playable map remains the authority. A changed/missing map, host or bundle
uses the ordinary preview path. Bundles never substitute for any build stage.
The sidecar is a normal map output, so build cancellation rolls it back too.
"""
import hashlib
import glob
import json
import os
from pathlib import Path
import re

VERSION = 1
SIDECAR = '.preview.json'
REQUIRED = ('bsp.bin', 'brushes.jsonl', 'meshes.bin', 'lights.bin',
            'paths.jsonl', 'texflags.jsonl', 'scene.t3d', 'complete.json')


class Unavailable(ValueError):
    pass


def digest(path):
    # The packaged editor uses Python 3.10; hashlib.file_digest needs 3.11.
    # Stream the bytes so large maps and textures do not need a second full copy.
    result = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def producer(files):
    return {Path(p).name: digest(p) for p in files}


def _digests(files):
    """Hash every byte as before; overlap independent reads of larger bundles."""
    def read(item):
        name, path = item
        return name, digest(path)
    items = list(files.items())
    if len(items) < 32:
        return dict(map(read, items))
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=4, thread_name_prefix='preview-hash') as pool:
        return dict(pool.map(read, items))


def dependencies():
    """Invalidate derived preview data when a linked package or its search path changes."""
    import kit
    roots = [Path(p) for p in (getattr(kit, 'DEV', None), getattr(kit, 'PROJECT', None)) if p]
    if getattr(kit, 'PROJECT', None):
        roots.append(Path(kit.PROJECT) / 'dist')
    patterns = set()
    ini = ''
    if hasattr(kit, '_ini') and getattr(kit, 'DEV', None):
        ini = kit._ini(Path(kit.DEV))
        for value in re.findall(r'(?im)^Paths\s*=\s*(.+)$', ini):
            p = Path(value.strip())
            if p.suffix.lower() in ('.u', '.utx', '.usx'):
                patterns.add(str(p if p.is_absolute() else Path(kit.DEV) / p))
    for root in roots:
        for ext in ('*.u', '*.dll', '*.utx'):
            patterns.add(str(root / ext))
    if hasattr(kit, 'extra_packages'):
        for row in kit.extra_packages():
            if row.get('path'):
                patterns.add(str(Path(row['path']).resolve()))
    entries = {}
    for pattern in sorted(patterns):
        for name in sorted(glob.glob(pattern)):
            stat = Path(name).stat()
            entries[str(Path(name).absolute())] = [stat.st_mtime_ns, stat.st_size]
    return dict(ini=hashlib.sha256(ini.encode()).hexdigest(), files=entries)


def commands(folder, map_name, enabled=False):
    if not enabled or os.environ.get('DEUSEDIX_BUILD_PREVIEW') == '0':
        return []
    import kit
    # An older host continues to work. Never send it an unknown command.
    try:
        if b'UC_PREVIEW\0' not in Path(kit.HOST).read_bytes():
            return []
    except OSError:
        return []
    if not re.fullmatch(r'[\w-]+', map_name):
        return []
    folder = Path(folder)
    (folder / 'Preview/Output/tex').mkdir(parents=True, exist_ok=True)
    inputs = dict(dependencies=dependencies(), producer=producer([
        (folder / 'System' / Path(p).name) if (folder / 'System' / Path(p).name).is_file() else p
        for p in kit.host_files()]))
    (folder / 'Preview/inputs.json').write_text(json.dumps(inputs), encoding='utf-8')
    # A reload applies native PostLoad fixups (especially mover polygon links).
    # Packages and the engine stay resident, unlike a second SDK process.
    return [r'MAP LOAD FILE="..\Output\%s.dx"' % map_name, 'UC_PREVIEW']


def publish(map_path, folder):
    """Only a complete verified export is advertised; failure cannot spoil a build."""
    import kit
    import atomicfile
    path, folder = Path(map_path), Path(folder)
    sidecar = path.with_suffix(SIDECAR)
    # A previous build's bundle is never advertised for new output.
    root = folder / 'Preview/Output'
    try:
        sidecar.unlink(missing_ok=True)
        marker = json.loads((root / 'complete.json').read_text(encoding='utf-8'))
        _textures(marker)
        inputs = json.loads((root.parent / 'inputs.json').read_text(encoding='utf-8'))
        current_dependencies = dependencies()
        current_producer = producer(kit.host_files())
        if inputs != dict(dependencies=current_dependencies, producer=current_producer):
            return False
        paths = {n: root / n for n in REQUIRED}
        for p in (root / 'tex').iterdir():
            if p.is_file() and re.fullmatch(r'\d+\.(bmp|raw)', p.name):
                paths['tex/' + p.name] = p
        files = _digests(paths)
        relative = root.resolve().relative_to(Path(kit.RUNS).resolve()).as_posix()
        meta = dict(version=VERSION, source=str(path.resolve()), sha256=digest(path),
                    folder=relative, producer=current_producer, dependencies=current_dependencies, files=files)
        atomicfile.write_text(sidecar, json.dumps(meta), encoding='utf-8')
        return True
    except (OSError, ValueError, TypeError, KeyError):
        return False


def _textures(marker):
    if not isinstance(marker, dict) or marker.get('version') != VERSION:
        raise Unavailable('preview version changed')
    entries = marker.get('textures')
    if not isinstance(entries, dict) or any(not isinstance(k, str) or
            not isinstance(v, str) or not re.fullmatch(r'\d+', v) for k, v in entries.items()):
        raise Unavailable('invalid preview texture index')
    return entries


class Session:
    """Read-only adapter for data._dump; never executes saved commands."""
    def __init__(self, root, texture_files):
        self.folder = root.parent
        self.texture_files = texture_files

    def cmd(self, command, **kwargs):
        if command.startswith(('MAP LOAD FILE=', 'MAP EXPORT FILE=', 'UC_BSPDUMP ',
                'UC_BRUSHES ', 'UC_MESHES ', 'UC_LIGHTDUMP ', 'UC_PATHS ', 'UC_TEXFLAGS ')):
            return ''
        raise Unavailable('preview requested new native data')

    def close(self):
        pass


def open_session(map_path):
    import kit
    if os.environ.get('DEUSEDIX_BUILD_PREVIEW') == '0':
        return None
    path = Path(map_path)
    try:
        meta = json.loads(path.with_suffix(SIDECAR).read_text(encoding='utf-8'))
        if meta.get('version') != VERSION or meta.get('source') != str(path.resolve()):
            return None
        if meta.get('sha256') != digest(path) or meta.get('producer') != producer(kit.host_files()):
            return None
        if meta.get('dependencies') != dependencies():
            return None
        base = Path(kit.RUNS).resolve()
        relative = Path(meta['folder'])
        if relative.is_absolute() or '..' in relative.parts:
            return None
        root = (base / relative).resolve()
        root.relative_to(base)
        if root.parts[-2:] != ('Preview', 'Output'):
            return None
        files = meta.get('files', {})
        if not isinstance(files, dict) or not set(REQUIRED).issubset(files):
            return None
        paths = {}
        for name, expected in files.items():
            if name not in REQUIRED and not re.fullmatch(r'tex/\d+\.(bmp|raw)', name):
                return None
            f = (root / name).resolve()
            f.relative_to(root)
            paths[name] = f
        if _digests(paths) != files:
            return None
        textures = _textures(json.loads((root / 'complete.json').read_text(encoding='utf-8')))
        return Session(root, textures)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None
