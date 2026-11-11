"""Managed project workspaces. No engine launch, compilation, game writes or file deletion.

Each worker imports its own copied application from a complete compatible workspace. A
canonical application owns only manifest-tracked code; maps, stories and resources are local.
"""
import contextlib
import difflib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import threading
import uuid
import zipfile
from datetime import datetime, timezone

import settings

VERSION = 1
MANIFEST = 'deusedix-project.json'
OWNED = '.deusedix-owned.json'
BASE = '.deusedix-editor-base.zip'
KINDS = {'custom', 'original', 'tutorial'}
_LOCK = threading.RLock()
PYTHON = {'activation.py', 'classes.py', 'geom.py', 'kit.py', 'library.py', 'live.py', 'game_process.py', 'originalstory.py',
          'polys.py', 'projects.py', 'project_server.py', 'project_game.py', 'project_preferences.py',
          'refdims.py', 'refscan.py', 'scene.py', 'settings.py', 'sizes.py',
          'story.py', 't3d.py', 'texcat.py', 'texfind.py', 'texgen.py', 'texusage.py', 'workspace.py'}
PYTHON.add('experimental_payload.py')
PYTHON.add('atomicfile.py')
PYTHON.add('mods.py')                    # Export mod... and the launcher's Mods (both games)
PYTHON.add('signs.py')                   # signs drawn like the game's (the tutorial map and the maps use it)
PYTHON.update({'vec3.py', 'classtree.py'})   # the vector type (geom, blocks) and the class hierarchy (props, data)
PYTHON.add('mover_transform.py')        # a mover moved or turned in the editor keeps its keys (scene, dxmaps)
PYTHON.add('conditions.py')             # the rules' and the Story's conditions (links, story)
PYTHON.add('formula.py')                # the formulas of counters (P9 slice 5: conditions, links, statecatalog)
PYTHON.update({'build_cache.py', 'build_cached.py', 'build_cpu.py', 'preview_bundle.py', 'texture_cache.py', 'resident_build.py'})
PYTHON.add('patrol_paths.py')          # walking support for drawn patrol routes
PYTHON.add('infolink_styles.py')       # shared InfoLink styles in existing and new projects
STATIC_EXT = {'.js', '.css', '.html', '.json', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.ogg', '.wav'}
TUTORIAL_EXT = {'.py', '.json', '.png', '.jpg', '.jpeg', '.wav', '.ogg', '.mp3', '.md'}
GENERATED = {'UCPortraits.uc', 'UCVoiceDubs.uc', 'UCInfoLinkStyle.uc', 'UCMenuLook.uc'}
DATA_DIRS = ('maps', 'maps/.authoring', 'dist', 'logs', 'tools/mapkit/maps', 'tools/mapkit/story',
             'tools/mapkit/out', 'tools/mapkit/runs', 'tools/mapkit/editor/cache', 'tools/mapkit/sounds',
             'tools/mapkit/dubs', 'tools/mapkit/models', 'tools/mapkit/textures', 'tools/mapkit/characters',
             'tools/mapkit/prefabs', 'tools/mapkit/anims', 'tools/mapkit/catalog',
             'tools/mapkit/logic')        # the project's mission phases (editor/missionphases.py)


class ProjectConflictError(ValueError):
    def __init__(self, paths):
        self.conflicts = sorted(paths)
        super().__init__('Project application update stopped to preserve local changes: ' + ', '.join(self.conflicts))


def _hash(content):
    return hashlib.sha256(content).hexdigest()


def _merge_editor(base, local, incoming):
    """Conservative line merge: preserve local edits; overlapping edits need a choice."""
    if local == base or local == incoming:
        return incoming
    if incoming == base:
        return local
    if any(b'\0' in value for value in (base, local, incoming)):
        return None
    if any(any(c < 32 and c not in (9, 10, 13) for c in value) for value in (base, local, incoming)):
        return None
    crlf = b'\r\n' in local
    base, local, incoming = (value.replace(b'\r\n', b'\n') for value in (base, local, incoming))
    lines = base.splitlines(keepends=True)
    changes = []
    for version in (local, incoming):
        target = version.splitlines(keepends=True)
        for op, a, b, c, d in difflib.SequenceMatcher(None, lines, target, autojunk=False).get_opcodes():
            if op == 'equal':
                continue
            change = (a, b, target[c:d])
            if change in changes:
                continue
            for start, end, _ in changes:
                # Insertions at the same boundary are deliberately ambiguous.
                if max(a, start) < min(b, end) or (a == b and start <= a <= end) or (start == end and a <= start <= b):
                    return None
            changes.append(change)
    out, cursor = [], 0
    for a, b, value in sorted(changes):
        out.extend(lines[cursor:a]); out.extend(value); cursor = b
    out.extend(lines[cursor:])
    result = b''.join(out)
    return result.replace(b'\n', b'\r\n') if crlf else result


def _base_files(path):
    file = path / BASE
    _no_links(file)
    if not file.exists():
        return {}
    try:
        with zipfile.ZipFile(file) as archive:
            if sum(info.file_size for info in archive.infolist()) > 256 * 1024 * 1024:
                raise ValueError('Editor update baseline is too large.')
            return {_relative(name): archive.read(name) for name in archive.namelist()}
    except (OSError, zipfile.BadZipFile) as exc:
        raise ValueError('Cannot read the editor update baseline; no files were replaced.') from exc


def _base_bytes(payload):
    import io
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        for rel, content in sorted(payload.items()):
            info = zipfile.ZipInfo(rel, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
    return stream.getvalue()


def _apply_editor_update(path, writes, expected):
    """Back up the whole change before writing; roll back a failed update."""
    changed = {rel: data for rel, data in writes.items()
               if not (path / rel).is_file() or (path / rel).read_bytes() != data}
    if not changed:
        return None
    originals = {}
    for rel in changed:
        target = path / _relative(rel)
        _no_links(target)
        old = target.read_bytes() if target.is_file() else None
        if (None if old is None else _hash(old)) != expected[rel]:
            raise ProjectConflictError([rel])
        originals[rel] = old
    backup = path / '.deusedix-updates' / (datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
    for rel, data in originals.items():
        if data is not None:
            _write(backup / 'files' / rel, data)
    report = dict(version=1, status='prepared', files={rel: dict(before=expected[rel], after=_hash(data))
                                                     for rel, data in changed.items()})
    _json(backup / 'update.json', report)
    applied = []
    try:
        for rel, data in changed.items():
            target = path / rel
            now = _hash(target.read_bytes()) if target.is_file() else None
            if now != expected[rel]:
                raise ProjectConflictError([rel])
            _write(target, data)
            applied.append(rel)
        _json(backup / 'update.json', dict(report, status='complete'))
    except Exception:
        for rel in reversed(applied):
            target = path / rel
            _no_links(target)
            if target.is_file() and _hash(target.read_bytes()) == _hash(changed[rel]):
                if originals[rel] is None:
                    target.unlink()
                else:
                    _write(target, originals[rel])
        _json(backup / 'update.json', dict(report, status='rolled back'))
        raise
    return str(backup)


def _read(path):
    _no_links(path)
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise ValueError('Cannot read %s: %s' % (path, exc)) from exc
    if not isinstance(value, dict):
        raise ValueError('Expected an object in ' + str(path))
    return value


def _write(path, content):
    _no_links(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(path.name + '.pending-' + uuid.uuid4().hex)
    with pending.open('xb') as stream:
        stream.write(content)
    os.replace(pending, path)


def _json(path, value):
    _write(path, (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8'))


def _name(value):
    if (not isinstance(value, str) or not value.strip() or len(value.strip()) > 80
            or any(ord(c) < 32 for c in value) or re.search(r'[<>:"/\\|?*]', value)
            or value.strip() in {'.', '..'} or value.rstrip().endswith('.')):
        raise ValueError('Use a project name of 1–80 characters without filename punctuation.')
    if re.fullmatch(r'(?i)CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]', value.strip()):
        raise ValueError('That project name is reserved by Windows.')
    return value.strip()


def _package(ident):
    if not isinstance(ident, str) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,47}', ident):
        raise ValueError('Invalid immutable project ID.')
    return 'DXP_' + ident.replace('-', '_')


def _no_links(path):
    for part in (path, *path.parents):
        if part.exists() or part.is_symlink():
            if part.is_symlink() or getattr(part.stat(), 'st_file_attributes', 0) & 1024:
                raise ValueError('Project paths cannot contain links or junctions: ' + str(part))


def _relative(value):
    if not isinstance(value, str) or not value or value == '.':
        raise ValueError('Invalid owned application path.')
    p = PurePosixPath(value)
    if p.is_absolute() or '..' in p.parts or '\\' in value or ':' in value:
        raise ValueError('Invalid owned application path: ' + value)
    return p.as_posix()


def _target(value):
    """The game a project is made for (settings.TARGETS); None or absent: Revision."""
    target = value or settings.DEFAULT_TARGET
    if target not in settings.TARGETS:
        raise ValueError('Unknown game for a project: %s' % target)
    return target


# the built-in workspaces: kind and game of each reserved ID
RESERVED = {'deusex-story': ('original', 'revision'), 'training': ('tutorial', 'revision'),
            'deusex-goty': ('original', 'vanilla'), 'training-vanilla': ('tutorial', 'vanilla'),
            'training-revision': ('tutorial', 'revision')}
BUILTINS = [('deusex-story', 'Deus Ex story'), ('training', 'Training (legacy)'),
            ('training-revision', 'Revision tutorial'),
            ('training-vanilla', 'Deus Ex original tutorial'),
            ('deusex-goty', 'Deus Ex story (original game)')]


def _metadata(manifest, path):
    if manifest.get('version') != VERSION or manifest.get('kind') not in KINDS:
        raise ValueError('Unsupported DeusEdix project manifest.')
    package = _package(manifest.get('id'))
    if manifest.get('package') != package:
        raise ValueError('Project package must match its immutable ID.')
    target = _target(manifest.get('target'))
    if manifest['id'] == 'legacy' or (manifest['id'] in RESERVED and (manifest['kind'], target) != RESERVED[manifest['id']]):
        raise ValueError('This project ID is reserved for a built-in workspace.')
    out = dict(id=manifest['id'], name=_name(manifest.get('name')), kind=manifest['kind'],
               path=str(path), legacy=False, package=package)
    if target != settings.DEFAULT_TARGET:           # absent: Revision (every project made before)
        out['target'] = target
    return out


def _namespace(content, package):
    text = content.decode('latin1')
    # The fixed nine-character provenance marker DeusEdix: is intentionally unchanged.
    text = re.sub(r'\bDeusEdix(Anims|Models|Sounds|Voices)?(?=\.)',
                  lambda m: package + (m[1] or ''), text)
    text = re.sub(r'([\"\'])(?:DeusEdix|UC)(Anims|Models|Sounds|Voices)\1',
                  lambda m: m[1] + package + m[2] + m[1], text)
    return text.encode('latin1')


def _workspace_metadata(path):
    """Recognize a complete old workspace in place; never convert or provision it."""
    required = ('tools/mapkit/settings.py', 'tools/mapkit/project_server.py',
                'tools/mapkit/editor/server.py', 'tools/mapkit/kit.py')
    for relative in required:
        file = path / relative
        _no_links(file)
        if not file.is_file():
            raise ValueError('Choose a DeusEdix project or an existing editor workspace folder.')
    if (path / MANIFEST).exists():
        raise ValueError('This folder now contains a managed project; open it again as that project.')
    source = (path / 'tools/mapkit/settings.py').read_text(encoding='utf-8')
    if 'DEUSEDIX_WORKSPACE_ID' not in source:
        raise ValueError('This workspace needs the existing-workspace compatibility update before opening.')
    cfg = _read(path / 'deusedix.json') if (path / 'deusedix.json').exists() else {}
    package = cfg.get('package', 'DeusEdix') if cfg else settings.devmode(path)['package']
    if not isinstance(package, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', package):
        raise ValueError('Invalid existing workspace package.')
    for relative in ('maps', 'tools/mapkit/maps', 'src/' + package + '/Classes'):
        folder = path / relative
        _no_links(folder)
        if not folder.is_dir():
            raise ValueError('Incomplete existing workspace: ' + relative)
    target = _target(cfg.get('target'))
    return dict(id=settings.workspace_id(path), name=_name(path.name), kind='workspace',
                path=str(path), legacy=False, external=True, package=package,
                **({'target': target} if target != settings.DEFAULT_TARGET else {}))


def _compact_doctor_audio(kit):
    """Retire only byte-identical, shipped UI WAVs after all MP3 replacements exist.

    Game-import WAVs, custom recordings and modified application assets are never removed.
    The same retired names are excluded from new project payloads; old ownership manifests
    already remove unchanged obsolete files when those projects are next opened.
    """
    folder = kit / 'editor/static/audio/doctor'
    try:
        retired = _read(folder / 'obsolete-wavs.json')
        manifest = _read(folder / 'manifest.json')
        names = retired.get('files')
        clips = manifest.get('clips')
        if (retired.get('version') != 1 or not isinstance(names, dict) or not names or
                manifest.get('version') != 1 or manifest.get('voice') != 'EliasHale' or
                not isinstance(clips, list) or not clips):
            return {}
        if any(not re.fullmatch(r'hale_[a-f0-9]{20}\.wav', name) or
               not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest)
               for name, digest in names.items()):
            return {}
        for clip in clips:
            url = clip.get('url', '') if isinstance(clip, dict) else ''
            if not re.fullmatch(r'/static/audio/doctor/hale_[a-f0-9]{20}\.mp3', url):
                return {}
            replacement = folder / url.rsplit('/', 1)[1]
            _no_links(replacement)
            if not replacement.is_file():
                return {}
        for name, digest in names.items():
            path = folder / name
            _no_links(path)
            if path.is_file() and _hash(path.read_bytes()) == digest:
                path.unlink()
        return names
    except (OSError, ValueError, TypeError):
        # A locked file or damaged migration metadata cannot block the project hub.
        return {}


class ProjectManager:
    def __init__(self, app_root=None, projects_dir=None):
        self.app = Path(app_root or os.environ.get('DEUSEDIX_APP_ROOT') or settings.PROJECT).resolve()
        self.root = Path(projects_dir or os.environ.get('DEUSEDIX_PROJECTS_DIR') or self.app / 'Projects').absolute()
        _no_links(self.root)
        self.root = self.root.resolve()
        self.code = self.app / 'tools' / 'mapkit'
        self.retired_doctor_audio = _compact_doctor_audio(self.code)
        self.registry = self.root / 'registry.json'
        game = Path(self._game()).resolve()
        if self.root == self.app or self.root in self.app.parents or self.root == game or game in self.root.parents:
            raise ValueError('Choose a dedicated projects registry outside the game folder.')

    @contextlib.contextmanager
    def _locked(self):
        with _LOCK:
            _no_links(self.root)
            self.root.mkdir(parents=True, exist_ok=True)
            _no_links(self.root / '.registry.lock')
            with (self.root / '.registry.lock').open('a+b') as lock:
                if lock.tell() == 0:
                    lock.write(b'0')
                    lock.flush()
                lock.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock, fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    lock.seek(0)
                    if os.name == 'nt':
                        msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        fcntl.flock(lock, fcntl.LOCK_UN)

    def _registry(self):
        value = _read(self.registry) if self.registry.exists() else {'version': VERSION, 'projects': []}
        if value.get('version') != VERSION or not isinstance(value.get('projects'), list):
            raise ValueError('Invalid project registry; existing entries were preserved.')
        entries = value['projects']
        ids = [p.get('id') for p in entries if isinstance(p, dict)]
        if len(ids) != len(entries) or len(ids) != len(set(ids)):
            raise ValueError('Invalid or duplicate project registry entries.')
        paths, packages = set(), set()
        for row in entries:
            if not isinstance(row.get('path'), str) or not Path(row['path']).is_absolute():
                raise ValueError('Invalid project registry folder.')
            path = Path(row['path'])
            _no_links(path)
            if row.get('external'):
                if (row.get('external') is not True or row.get('legacy') is not False
                        or row.get('kind') != 'workspace' or row.get('id') != settings.workspace_id(path)):
                    raise ValueError('Invalid existing workspace identity.')
                _name(row.get('name'))
                _target(row.get('target'))
            elif row.get('legacy'):
                if row.get('id') != 'legacy' or row.get('kind') != 'legacy' or path.resolve() != self.app:
                    raise ValueError('The existing workspace registry entry does not match this application.')
            else:
                _metadata({'version': VERSION, **row}, path)
            package = row.get('package')
            if not isinstance(package, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', package):
                raise ValueError('Invalid project registry package.')
            key = str(path.resolve()).casefold()
            if key in paths or package.casefold() in packages:
                raise ValueError('Project folders and packages must be unique.')
            paths.add(key)
            packages.add(package.casefold())
        cfg = _read(self.app / 'deusedix.json') if (self.app / 'deusedix.json').exists() else {}
        defaults = [dict(id='legacy', name='Existing workspace', kind='legacy', path=str(self.app), legacy=True,
                         package=cfg.get('package', settings.devmode(self.app)['package']))]
        for ident, name in BUILTINS:
            kind, target = RESERVED[ident]
            defaults.append(dict(id=ident, name=name, kind=kind, path=str(self.root / ident), legacy=False, package=_package(ident),
                                 **({'target': target} if target != settings.DEFAULT_TARGET else {})))
        changed = False
        for entry in defaults:
            if entry['id'] not in ids:
                entries.append(entry)
                changed = True
        if changed:
            _json(self.registry, value)
        return value

    def _path(self, value, entries, creating=False):
        raw = Path(value).expanduser()
        if not raw.is_absolute():
            raise ValueError('Choose an absolute project folder.')
        _no_links(raw)
        path = raw.resolve()
        game = Path(self._game()).resolve()
        if path == game or game in path.parents:
            raise ValueError('Keep projects outside the original game folder.')
        if path == self.root or path == self.app or path in self.app.parents:
            raise ValueError('Choose a dedicated project folder, not the application or registry folder.')
        if self.app in path.parents and self.root not in path.parents:
            raise ValueError('Managed projects inside the application belong in its Projects folder.')
        if any((parent / MANIFEST).exists() for parent in path.parents):
            raise ValueError('Projects cannot be nested inside another project folder.')
        for entry in entries:
            if entry.get('legacy'):
                continue
            other = Path(entry['path']).resolve()
            if path != other and (path in other.parents or other in path.parents):
                raise ValueError('Projects cannot be nested inside one another.')
        if creating and path.exists() and (not path.is_dir() or any(path.iterdir())):
            raise FileExistsError('The project folder must be new or empty: ' + str(path))
        return path

    def _game(self):
        cfg = _read(self.app / 'deusedix.json') if (self.app / 'deusedix.json').exists() else {}
        return cfg.get('game') or str(settings.GAME)

    def _payload(self, metadata):
        payload, seeds = {}, {}
        def add(source, target):
            _no_links(source)
            payload[_relative(target)] = source.read_bytes()
        for name in sorted(PYTHON):
            if (self.code / name).is_file():
                add(self.code / name, 'tools/mapkit/' + name)
        for file in sorted((self.code / 'editor').glob('*.py')):
            add(file, 'tools/mapkit/editor/' + file.name)
        for file in sorted((self.code / 'editor/config').glob('*.json')):      # the editor's settings as data
            add(file, 'tools/mapkit/editor/config/' + file.name)
        for file in sorted((self.code / 'editor/config/patterns').glob('*.json')):   # the library of logic patterns
            add(file, 'tools/mapkit/editor/config/patterns/' + file.name)
        for file in sorted((self.code / 'editor/config/examples').glob('*')):       # example maps (examples.py)
            if file.is_file() and file.suffix in ('.py', '.json'):
                add(file, 'tools/mapkit/editor/config/examples/' + file.name)
        for folder, extensions in [('editor/static', STATIC_EXT), ('tutorial', TUTORIAL_EXT)]:
            for file in sorted((self.code / folder).rglob('*')):
                if file.is_file() and file.suffix.lower() in extensions:
                    if (file.parent == self.code / 'editor/static/audio/doctor' and
                            file.name in self.retired_doctor_audio):
                        continue
                    add(file, 'tools/mapkit/' + file.relative_to(self.code).as_posix())
        from experimental_payload import distribution_files
        for file, relative in distribution_files(self.code / 'experimental_bsp'):
            add(file, 'tools/mapkit/experimental_bsp/' + relative.as_posix())
        # made from Revision's textures and maps: a project for the original game reads its own
        revision = _target(metadata.get('target')) == 'revision'
        for name in ('sizes.json', 'texusage.json', 'library.json') if revision else ():
            if (self.code / 'catalog' / name).is_file():
                source = self.code / 'catalog' / name
                _no_links(source)
                # Runtime scanners extend these caches; they are never application-owned.
                seeds['tools/mapkit/catalog/' + name] = source.read_bytes()
        for source, target in [(self.code / 'bin/UCMapKitHost.exe', 'tools/mapkit/bin/UCMapKitHost.exe'),
                               (self.code / 'bin/UCEngineBridge.dll', 'tools/mapkit/bin/UCEngineBridge.dll'),
                               (self.code / 'bin/DeusEdixNav.u', 'tools/mapkit/bin/DeusEdixNav.u'),
                               (self.code / 'bin/DeusEdixNav.dll', 'tools/mapkit/bin/DeusEdixNav.dll'),
                               (self.app / 'tools/ue1pkg.py', 'tools/ue1pkg.py')]:
            if not source.is_file():
                raise FileNotFoundError('Required application file is missing: ' + str(source))
            add(source, target)
        # Optional native helpers must follow the editor into each project too.
        for name in ('UCEngineBridge.ini', 'DeusEdixGeometry.dll'):
            if (self.code / 'bin' / name).is_file():
                add(self.code / 'bin' / name, 'tools/mapkit/bin/' + name)
        for name in ('guide.md', 'guide.html'):
            if (self.app / 'docs/guide' / name).is_file():
                add(self.app / 'docs/guide' / name, 'docs/guide/' + name)
        if 'docs/guide/guide.md' not in payload and (self.app / 'docs/tutorials/07-map-editor.md').is_file():
            add(self.app / 'docs/tutorials/07-map-editor.md', 'docs/guide/guide.md')
        template = self.code / 'project-template/src/DeusEdix'
        if not (template / 'Classes/UCBoot.uc').is_file():
            raise FileNotFoundError('The clean project runtime template is missing.')
        doctor_assets = None
        for file in sorted(template.rglob('*')):
            if not file.is_file():
                continue
            _no_links(file)
            rel = file.relative_to(template)
            doctor_audio = (len(rel.parts) == 3 and rel.parts[:2] == ('Sounds', 'Doctor')
                            and re.fullmatch(r'V[0-9]+\.wav', file.name))
            if doctor_audio:
                # Only our published Hale bundle is allowed, not arbitrary user/game audio.
                if doctor_assets is None:
                    manifest = _read(self.code / 'tutorial/voices/manifest.json')
                    if manifest.get('version') != 1 or manifest.get('voice') != 'EliasHale' or not isinstance(manifest.get('lines'), list):
                        raise ValueError('Invalid built-in doctor audio manifest.')
                    doctor_assets = {}
                    for line in manifest['lines']:
                        if (not isinstance(line, dict) or not isinstance(line.get('name'), str)
                                or not re.fullmatch(r'V[0-9]+', line['name'])
                                or not isinstance(line.get('sha256'), str)
                                or not re.fullmatch(r'[a-f0-9]{64}', line['sha256'])
                                or line['name'] + '.wav' in doctor_assets):
                            raise ValueError('Invalid built-in doctor audio manifest entry.')
                        doctor_assets[line['name'] + '.wav'] = line['sha256']
                reference = self.code / 'tutorial/voices' / file.name
                _no_links(reference)
                expected = doctor_assets.get(file.name)
                if (not expected or _hash(file.read_bytes()) != expected or not reference.is_file()
                        or _hash(reference.read_bytes()) != expected):
                    raise ValueError('Unrecognized or changed built-in doctor audio: ' + str(rel))
            else:
                if file.name.startswith('UCEd_') or rel.parts[0] not in {'Classes', 'Textures'}:
                    raise ValueError('Unexpected generated or user file in the clean runtime template: ' + str(rel))
                if file.suffix.lower() not in {'.uc', '.pcx'}:
                    raise ValueError('Unexpected runtime template asset: ' + str(rel))
            target = 'src/' + metadata['package'] + '/' + rel.as_posix()
            content = file.read_bytes()
            if file.suffix.lower() == '.uc':
                content = _namespace(content, metadata['package'])
            (seeds if file.name in GENERATED else payload)[target] = content
        if not revision:
            # the original Deus Ex: the classes that use what only Revision has, in their version for it
            # (DeusEdix dev\vanilla_runtime.py: project-template\vanilla\Classes)
            overlay = sorted((self.code / 'project-template/vanilla/Classes').glob('*.uc'))
            if not overlay:
                raise FileNotFoundError('The runtime for the original game is missing from the application.')
            for file in overlay:
                _no_links(file)
                target = 'src/' + metadata['package'] + '/Classes/' + file.name
                if target not in payload:
                    raise ValueError('Unexpected class in the runtime for the original game: ' + file.name)
                payload[target] = _namespace(file.read_bytes(), metadata['package'])
        return payload, seeds

    def _provision(self, metadata, preserve_local=False, update_local=False):
        if metadata.get('external'):
            path = self._path(metadata['path'], self._registry()['projects'])
            actual = _workspace_metadata(path)
            if (any(actual[k] != metadata[k] for k in ('id', 'kind', 'package'))
                    or _target(actual.get('target')) != _target(metadata.get('target'))):
                raise ValueError('The existing workspace identity changed; no files were replaced.')
            if not (path / OWNED).is_file() or not (path / BASE).is_file():
                return dict(actual, updateWarning=dict(
                    message='This workspace uses its own editor files. Installing DeusEdix does not update them. '
                            'Its custom code needs to be integrated once before automatic editor updates can be enabled.',
                    files=[], canUpdate=False)) if preserve_local else actual
            return self._refresh_external(actual, preserve_local, update_local)
        if metadata.get('legacy'):
            return dict(metadata)                 # Existing work is registered in place, never refreshed.
        path = self._path(metadata['path'], self._registry()['projects'])
        manifest = path / MANIFEST
        updating = manifest.is_file()
        if manifest.exists():
            actual = _metadata(_read(manifest), path)
            if (any(actual[k] != metadata[k] for k in ('id', 'kind', 'package'))
                    or _target(actual.get('target')) != _target(metadata.get('target'))):
                raise ValueError('The project folder belongs to another project.')
            metadata = actual
        elif path.exists() and any(path.iterdir()):
            raise FileExistsError('Cannot provision over a non-project folder: ' + str(path))
        payload, seeds = self._payload(metadata)
        ownership = _read(path / OWNED) if (path / OWNED).exists() else {'version': VERSION, 'files': {}}
        if ownership.get('version') != VERSION or not isinstance(ownership.get('files'), dict):
            raise ValueError('Invalid project application ownership manifest.')
        old = {_relative(key): value for key, value in ownership['files'].items()}
        # Older application snapshots may have tracked a cache as code. Release it
        # from ownership without replacing the user's current generated contents.
        old = {key: value for key, value in old.items() if key not in seeds}
        if any(not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest) for digest in old.values()):
            raise ValueError('Invalid project application ownership hash.')
        baseline = _base_files(path)
        canonical = dict(payload)
        conflicts, before, merged = [], {}, []
        for rel, content in payload.items():
            destination = path / rel
            _no_links(destination)
            digest = _hash(destination.read_bytes()) if destination.is_file() else None
            before[rel] = digest
            if destination.exists() and not destination.is_file():
                conflicts.append(rel)
            elif digest is not None and digest != _hash(content):
                local = destination.read_bytes()
                if rel in baseline:
                    combined = _merge_editor(baseline[rel], local, content)
                    if combined is not None:
                        payload[rel] = combined
                        if combined != content:
                            merged.append(rel)
                        continue
                elif digest == old.get(rel):
                    continue
                conflicts.append(rel)
        if conflicts and not preserve_local and not update_local:
            raise ProjectConflictError(conflicts)
        for rel in seeds:
            destination = path / rel
            _no_links(destination)
            if destination.exists() and not destination.is_file():
                raise ValueError('Expected a project resource file: ' + str(destination))
        for directory in DATA_DIRS:
            destination = path / directory
            _no_links(destination)
            if destination.exists() and not destination.is_dir():
                raise ValueError('Expected a project data folder: ' + str(destination))
        config = dict(game=self._game(), package=metadata['package'], mapsDir='DeusEdixProjects/' + metadata['id'],
                      animsPackage=metadata['package'] + 'Anims', modelsPackage=metadata['package'] + 'Models',
                      soundsPackage=metadata['package'] + 'Sounds')
        if 'target' in metadata:
            config['target'] = metadata['target']
        cfgfile = path / 'deusedix.json'
        if cfgfile.exists():
            existing = _read(cfgfile)
            if (any(existing.get(key, value) != value for key, value in config.items() if key != 'game')
                    or _target(existing.get('target')) != _target(metadata.get('target'))):
                raise ValueError('Project config points to another namespace; it was not replaced.')
            config = {**existing, **config}
        if conflicts and not update_local:
            # Opening may retain a complete existing application, never a hybrid
            # assembled from selected old/new modules. Creation stays strict.
            if not manifest.is_file() or not cfgfile.is_file() or not old:
                raise ProjectConflictError(conflicts)
            for rel in old:
                _no_links(path / rel)
                if not (path / rel).is_file():
                    raise ProjectConflictError(conflicts)
            for rel in ('tools/mapkit/editor/server.py', 'tools/mapkit/settings.py',
                        'tools/mapkit/project_server.py', 'tools/mapkit/editor/static/app.js'):
                if not (path / rel).is_file():
                    raise ProjectConflictError(conflicts)
            return dict(metadata, updateWarning=dict(
                message="This project has local editor or runtime changes that overlap the update. New features are not active yet. "
                        "Update with backup replaces the conflicting editor files; maps, dialogue and project assets are kept.",
                files=sorted(conflicts), canUpdate=True))
        path.mkdir(parents=True, exist_ok=True)
        if not manifest.exists():
            _json(manifest, dict(version=VERSION, **{key: metadata[key] for key in ('id', 'name', 'kind', 'package', 'target')
                                                     if key in metadata}))
        if update_local:
            for rel in conflicts:
                payload[rel] = canonical[rel]
        for rel, content in seeds.items():
            destination = path / rel
            _no_links(destination)
            if not destination.exists():
                destination.parent.mkdir(parents=True, exist_ok=True)
                with destination.open('xb') as stream:
                    stream.write(content)
        for directory in DATA_DIRS:
            _no_links(path / directory)
            (path / directory).mkdir(parents=True, exist_ok=True)
        writes = dict(payload)
        writes['deusedix.json'] = (json.dumps(config, indent=2) + '\n').encode('utf-8')
        writes[OWNED] = (json.dumps({'version': VERSION, 'files': {**old, **{rel: _hash(data) for rel, data in payload.items()}}}, indent=2) + '\n').encode('utf-8')
        writes[BASE] = _base_bytes(canonical)
        for rel in ('deusedix.json', OWNED, BASE):
            before[rel] = _hash((path / rel).read_bytes()) if (path / rel).is_file() else None
        changed = [rel for rel, data in payload.items() if updating and before[rel] != _hash(data)]
        backup = _apply_editor_update(path, writes, before)
        if changed:
            return dict(metadata, updateNotice=dict(message='The project editor was updated. Your maps, dialogue and assets were kept.',
                        files=changed, merged=merged, backup=backup))
        return dict(metadata)

    def _refresh_external(self, metadata, preserve_local, update_local):
        """Only an explicitly integrated external workspace opts in; private mod classes remain unowned."""
        path = Path(metadata['path'])
        old = _read(path / OWNED)
        if old.get('version') != VERSION or not isinstance(old.get('files'), dict):
            raise ValueError('Invalid project application ownership manifest.')
        ownership = {_relative(rel): value for rel, value in old['files'].items()}
        if any(not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest) for digest in ownership.values()):
            raise ValueError('Invalid project application ownership hash.')
        baseline = _base_files(path)
        payload, _seeds = self._payload(metadata)
        ownership = {rel: value for rel, value in ownership.items() if rel not in _seeds}
        dev = settings.devmode(path)
        # External mods keep their original imported-animation/model package names.
        aliases = {metadata['package'] + suffix: dev[key] for suffix, key in
                   [('Anims', 'animsPackage'), ('Models', 'modelsPackage'), ('Sounds', 'soundsPackage'), ('Voices', 'voicesPackage')]}
        for rel, value in list(payload.items()):
            if rel.startswith('src/'):
                if rel not in ownership and (path / rel).exists():
                    del payload[rel]       # private overrides were never adopted as editor code
                    continue
                if rel.endswith('.uc'):
                    for source, target in aliases.items():
                        value = re.sub(rb'\b' + re.escape(source.encode()) + rb'\b', target.encode(), value)
                    payload[rel] = value
        canonical = dict(payload)
        conflicts, before, merged = [], {}, []
        for rel, content in payload.items():
            target = path / rel
            _no_links(target)
            if target.exists() and not target.is_file():
                raise ValueError('Expected an editor file: ' + rel)
            local = target.read_bytes() if target.is_file() else None
            before[rel] = None if local is None else _hash(local)
            if local is None or local == content:
                continue
            combined = _merge_editor(baseline[rel], local, content) if rel in baseline else None
            if combined is not None:
                payload[rel] = combined
                if combined != content:
                    merged.append(rel)
            elif rel in baseline or before[rel] != ownership.get(rel):
                conflicts.append(rel)
        if conflicts and not update_local:
            if not preserve_local:
                raise ProjectConflictError(conflicts)
            return dict(metadata, updateWarning=dict(message='This workspace has local editor changes that overlap the update. '
                        'New features are not active yet. Update with backup replaces the listed files; private maps and resources are kept.',
                        files=conflicts, canUpdate=True))
        if update_local:
            for rel in conflicts:
                payload[rel] = canonical[rel]
        writes = dict(payload)
        writes[OWNED] = (json.dumps(dict(version=VERSION, files={**ownership, **{rel: _hash(data) for rel, data in payload.items()}}), indent=2) + '\n').encode()
        writes[BASE] = _base_bytes(canonical)
        for rel in (OWNED, BASE):
            before[rel] = _hash((path / rel).read_bytes()) if (path / rel).is_file() else None
        changed = [rel for rel, data in payload.items() if before[rel] != _hash(data)]
        backup = _apply_editor_update(path, writes, before)
        return dict(metadata, **(dict(updateNotice=dict(message='The workspace editor was updated. Private mod files were kept.',
                    files=changed, merged=merged, backup=backup)) if changed else {}))

    def list_projects(self):
        with self._locked():
            return [dict(row) for row in self._registry()['projects']]

    def get_project(self, ident):
        with self._locked():
            entry = next((p for p in self._registry()['projects'] if p['id'] == ident), None)
            if entry is None:
                raise ValueError('Unknown project: ' + str(ident))
            return dict(entry)

    def create(self, name, location=None, kind='custom', target=None):
        name = _name(name)
        if kind != 'custom':
            raise ValueError('Use the built-in original story or training project.')
        if target is not None and settings.check_game(self._game(), _target(target)):     # the hub sends the chosen game
            raise ValueError('%s is not installed in the game folder (%s).' % (settings.TARGETS[target]['name'], self._game()))
        with self._locked():
            registry = self._registry()
            ident = uuid.uuid4().hex
            path = self._path(location or self.root / ident, registry['projects'], creating=True)
            if any(Path(p['path']).resolve() == path for p in registry['projects']):
                raise ValueError('This folder is already registered as a project.')
            target = _target(target)
            metadata = dict(id=ident, name=name, kind=kind, path=str(path), legacy=False, package=_package(ident),
                            **({'target': target} if target != settings.DEFAULT_TARGET else {}))
            result = self._provision(metadata)
            registry['projects'].append(result)
            _json(self.registry, registry)
            return result

    def open_project(self, folder):
        with self._locked():
            registry = self._registry()
            path = self._path(folder, registry['projects'])
            metadata = (_metadata(_read(path / MANIFEST), path) if (path / MANIFEST).exists()
                        else _workspace_metadata(path))
            for row in registry['projects']:
                if row['id'] == metadata['id'] or Path(row['path']).resolve() == path:
                    if row['id'] != metadata['id'] or Path(row['path']).resolve() != path:
                        raise ValueError('This project ID is already registered at another location.')
                    if row != metadata:
                        row.update(metadata)
                        _json(self.registry, registry)
                    return metadata
                if row['package'].casefold() == metadata['package'].casefold():
                    raise ValueError('This project package is already registered under another ID.')
            registry['projects'].append(metadata)
            _json(self.registry, registry)
            return metadata

    def provision(self, ident_or_path, preserve_local=False, update_local=False):
        with self._locked():
            registry = self._registry()
            metadata = next((p for p in registry['projects'] if p['id'] == str(ident_or_path)), None)
            if metadata is None:
                path = self._path(ident_or_path, registry['projects'])
                metadata = _metadata(_read(path / MANIFEST), path)
                if any(p['id'] == metadata['id'] and Path(p['path']).resolve() != path for p in registry['projects']):
                    raise ValueError('This project ID is already registered elsewhere.')
                if any(p['package'].casefold() == metadata['package'].casefold() and p['id'] != metadata['id']
                       for p in registry['projects']):
                    raise ValueError('This project package is already registered under another ID.')
            result = self._provision(metadata, preserve_local=preserve_local, update_local=update_local)
            registered = {k: v for k, v in result.items() if k not in ('updateWarning', 'updateNotice')}
            registry['projects'] = [registered if p['id'] == result['id'] else p for p in registry['projects']]
            if not any(p['id'] == result['id'] for p in registry['projects']):
                registry['projects'].append(registered)
            _json(self.registry, registry)
            return result


def list_projects():
    return ProjectManager().list_projects()


def get_project(ident):
    return ProjectManager().get_project(ident)


def create(name, location=None, kind='custom', target=None):
    return ProjectManager().create(name, location, kind, target)


def games():
    """The games of the game folder a project can be made for: [{id, name, installed}]."""
    folder = ProjectManager()._game()
    return [dict(id=t, name=settings.TARGETS[t]['name'], installed=not settings.check_game(folder, t))
            for t in settings.TARGETS]


def open_project(folder):
    return ProjectManager().open_project(folder)


def provision(ident_or_path, preserve_local=False, update_local=False):
    return ProjectManager().provision(ident_or_path, preserve_local=preserve_local, update_local=update_local)


def default_location():
    """Default parent folder; create(location=...) receives the complete target folder."""
    return str(ProjectManager().root)
