"""Mods: a finished project in one file, installed and played in one click, for Revision and the original game.

A mod file (.dxmod) is a zip:
    mod.json            {format, id, name, author, version, description, game, start, maps, packages, requires}
    cover.png|jpg       optional, shown in the launcher's Mods
    maps/<name>.dx      the project's maps
    packages/<name>.u   the project's own packages (DXP_<id>, ...Anims, ...Models, ...Sounds, ...Scripts)

Nothing of the game is in it (export checks every map against the game). Installed, a mod is a folder of its
game: <game root>\\DeusEdixMods\\<id>\\ (Revision\\ for Revision, the Deus Ex folder for the original game).
Play never touches the player's ini files: it writes a copy with the mod's folder first and its own save
folder, and starts the game on it (Revision only takes a bare file name in its System folder, INI=DeusEdixMod.ini;
the original game takes a path, as the editor's Play does). Tried in Revision on 16 Oct 2026.
"""
import io
import json
import re
import shutil
import subprocess
import time
import zipfile
from pathlib import Path

import settings

FORMAT = 1
EXT = '.dxmod'
MODS_DIR = 'DeusEdixMods'
EXPORTS = Path.home() / 'Documents' / 'DeusEdix Mods'          # where Export mod... saves, easy to find
MAX_FILE = 256 * 1024 * 1024
MAX_TOTAL = 1024 * 1024 * 1024
MAX_COVER = 4 * 1024 * 1024
REVISION_INI = 'DeusEdixMod.ini'                                 # Revision's launch copy (System\)
_NAME = re.compile(r'^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$')
_ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')
_PACKAGE = re.compile(r'^DXP_[a-z0-9_]{1,64}$')
_SUFFIXES = ('', 'Anims', 'Models', 'Sounds', 'Scripts')


# ------------------------------------------------------------------ the games

def game_root(target):
    """The folder of `target` that reads its maps and packages, or None when that game is not installed."""
    if target not in settings.TARGETS or settings.check_game(settings.GAME, target):
        return None
    root = settings.TARGETS[target]['root']
    return settings.GAME / root if root else settings.GAME


def mods_root(target):
    root = game_root(target)
    return root / MODS_DIR if root else None


def _running(target):
    exe = settings.TARGETS[target]['exe']
    r = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq ' + exe], capture_output=True, text=True,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    return exe.lower() in r.stdout.lower()


# ------------------------------------------------------------------ the manifest

def _text(value, limit, what, required=True):
    value = str(value or '').strip()
    if required and not value:
        raise ValueError('The mod needs a %s.' % what)
    if len(value) > limit or any(ord(c) < 32 and c not in '\n\t' for c in value):
        raise ValueError('The %s is too long or has invalid characters.' % what)
    return value


def check_manifest(m):
    """mod.json as the launcher trusts it: every field checked, nothing else kept."""
    if not isinstance(m, dict) or m.get('format') != FORMAT:
        raise ValueError('This is not a DeusEdix mod (or it needs a newer DeusEdix).')
    out = dict(format=FORMAT)
    out['id'] = str(m.get('id', ''))
    if not _ID.match(out['id']):
        raise ValueError('The mod has an invalid id.')
    out['name'] = _text(m.get('name'), 80, 'name')
    out['author'] = _text(m.get('author'), 80, 'author', False)
    out['version'] = _text(m.get('version'), 32, 'version')
    out['description'] = _text(m.get('description'), 2000, 'description', False)
    out['game'] = m.get('game')
    if out['game'] not in settings.TARGETS:
        raise ValueError('The mod is for an unknown game.')
    out['kind'] = 'classic' if m.get('kind') == 'classic' else 'deusedix'
    maps, packages = m.get('maps'), m.get('packages')
    if not isinstance(maps, list) or not maps or not all(isinstance(x, str) and _NAME.match(x) for x in maps):
        raise ValueError('The mod has no valid maps.')
    if not isinstance(packages, list) or not all(isinstance(x, str) for x in packages):
        raise ValueError('The mod has an invalid package list.')
    if out['kind'] == 'classic':
        # a mod from the internet (import_zip): its packages are file names, checked against the game's at import
        out['package'] = ''
        if not all(_NAME.match(p) and Path(p).suffix.lower() in CLASSIC_PACKAGES for p in packages):
            raise ValueError('The mod has an invalid package list.')
    else:
        out['package'] = str(m.get('package', ''))
        if not _PACKAGE.match(out['package']):
            raise ValueError('The mod has an invalid package name.')
        own = {out['package'] + s for s in _SUFFIXES}
        if any(p not in own for p in packages) or out['package'] not in packages:
            raise ValueError('A mod may only carry its own packages (%s...).' % out['package'])
    out['maps'], out['packages'] = list(maps), list(packages)
    out['start'] = str(m.get('start', ''))
    if out['start'] not in maps:
        raise ValueError('The mod\'s start map is not one of its maps.')
    requires = m.get('requires') or []
    if not isinstance(requires, list) or not all(isinstance(x, str) and _NAME.match(x) for x in requires):
        raise ValueError('The mod has an invalid list of required packages.')
    out['requires'] = list(requires)
    out['cover'] = m.get('cover') if m.get('cover') in ('cover.png', 'cover.jpg') else None
    out['created'] = _text(m.get('created'), 40, 'date', False)
    out['editor'] = _text(m.get('editor'), 40, 'editor version', False)
    out['source'] = _text(m.get('source'), 120, 'source file', False)
    return out


# ------------------------------------------------------------------ export (inside a project)

def _project_maps():
    import workspace
    return sorted(f for f in workspace.MAPS.glob('*.dx') if f.is_file())


def _pending(map_file):
    """The map has editor changes newer than its installed copy (Map > Install map not done since)."""
    try:
        import dxmaps
        edits = dxmaps.edits_path(map_file.stem)
    except Exception:
        return False
    try:
        data = json.loads(edits.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return False
    changed = any(v for k, v in data.items() if k not in ('version', 'level') and v) if isinstance(data, dict) else False
    return changed and edits.stat().st_mtime > map_file.stat().st_mtime


def export_info():
    """What Export mod... needs to show: the project's maps, those with changes not installed, the last
    details used (kept in the project), whether the project can be exported."""
    if not getattr(settings, 'MANAGED_PROJECT', False) or getattr(settings, 'PROJECT_KIND', '') != 'custom':
        return dict(ok=False, reason='Only your own campaign projects can be exported as mods for now '
                    '(the original campaign and the tutorial cannot).')
    import workspace
    meta = settings.current()
    maps = _project_maps()
    saved = {}
    try:
        saved = json.loads((workspace.PROJECT / 'mod.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        pass
    return dict(ok=True, name=saved.get('name') or meta.get('name'), author=saved.get('author', ''),
                version=saved.get('version', '1.0'), description=saved.get('description', ''),
                start=saved.get('start') if saved.get('start') in [m.stem for m in maps] else (maps[0].stem if maps else ''),
                maps=[dict(name=m.stem, pending=_pending(m)) for m in maps], game=settings.TARGET,
                gameName=settings.GAME_NAME, folder=str(EXPORTS))


def export(details, cover=None, log=None):
    """Write <Documents>\\DeusEdix Mods\\<Name>-<version>.dxmod from the project's installed maps and its built
    packages (built here when out of date). details: name, author, version, description, start.
    cover: PNG bytes or None. Returns dict(path, size, maps, packages, warnings)."""
    info = export_info()
    if not info['ok']:
        raise ValueError(info['reason'])
    import gamecheck
    import story
    import workspace
    say = log or (lambda *a: None)
    maps = _project_maps()
    if not maps:
        raise ValueError('The project has no maps yet.')
    lines = list(story.write_all() or [])
    if workspace.needs_build():
        say('Building the project\'s packages...')
        ok, built = workspace.build(say)
        lines += built
        if not ok:
            raise RuntimeError('The project\'s packages did not compile: open the Console to see why.')
    packages = [n for n in workspace.PACKAGES if (workspace.DIST / (n + '.u')).is_file()]
    if settings.PACKAGE not in packages:
        raise RuntimeError('%s.u is not built.' % settings.PACKAGE)
    manifest = check_manifest(dict(
        format=FORMAT, id=settings.PROJECT_ID.lower().replace('_', '-'), name=details.get('name'),
        author=details.get('author'), version=details.get('version'), description=details.get('description'),
        game=settings.TARGET, package=settings.PACKAGE, maps=[m.stem for m in maps], packages=packages,
        start=details.get('start'), requires=[], cover='cover.png' if cover else None,
        created=time.strftime('%Y-%m-%d %H:%M'), editor='DeusEdix'))
    # every map loads with the game and the mod's own packages only (nothing of the game is carried)
    import kit
    extra = {p['name'] for p in kit.extra_packages()}
    own = set(packages) | extra | {'DeusEdixNav'}      # DeusEdix installs it with every mod (never in the file)
    warnings, requires = [], set()
    for m in maps:
        result = gamecheck.check(m, settings.TARGET, own)
        if not result['loads']:
            what = ', '.join(x['package'] for x in result['missing'][:4]) or 'a newer package version'
            raise ValueError('%s does not load in %s: it uses %s.' % (m.stem, settings.GAME_NAME, what))
        used = {n.lower() for n in result.get('packages', [])}
        requires |= {p for p in extra if p.lower() in used}
        if _pending(m):
            warnings.append('%s has changes that are not installed: the mod has its last installed version '
                            '(Map > Install map to include them).' % m.stem)
    manifest['requires'] = sorted(requires)
    if requires:
        warnings.append('It needs other mods\' packages the player must have: %s.' % ', '.join(sorted(requires)))
    if cover and len(cover) > MAX_COVER:
        cover = None
        manifest['cover'] = None
    EXPORTS.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r'[^A-Za-z0-9_.-]+', '_', manifest['name']).strip('_.') or 'Mod'
    out = EXPORTS / ('%s-%s%s' % (safe, re.sub(r'[^A-Za-z0-9_.-]+', '_', manifest['version']), EXT))
    tmp = out.with_name(out.name + '.tmp')
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr('mod.json', json.dumps(manifest, indent=1, ensure_ascii=False))
        if cover:
            z.writestr('cover.png', cover)
        for m in maps:
            z.write(m, 'maps/' + m.name)
        for n in packages:
            z.write(workspace.DIST / (n + '.u'), 'packages/%s.u' % n)
    tmp.replace(out)
    # the details are remembered for the next export (version, author...)
    (workspace.PROJECT / 'mod.json').write_text(json.dumps({k: manifest[k] for k in
        ('name', 'author', 'version', 'description', 'start')}, indent=1, ensure_ascii=False), encoding='utf-8')
    return dict(path=str(out), size=out.stat().st_size, maps=manifest['maps'], packages=packages,
                warnings=warnings, lines=lines)


# ------------------------------------------------------------------ install, list, remove

def read(source):
    """Open a .dxmod (a path or its bytes) and check it all: (manifest, zipfile, members)."""
    z = zipfile.ZipFile(io.BytesIO(source) if isinstance(source, (bytes, bytearray)) else source)
    _safe(z)
    try:
        manifest = check_manifest(json.loads(z.read('mod.json').decode('utf-8')))
    except KeyError:
        raise ValueError('This is not a DeusEdix mod (no mod.json).')
    members = {'mod.json': 'mod.json'}
    for m in manifest['maps']:
        members['maps/%s.dx' % m] = '%s.dx' % m
    for p in manifest['packages']:
        members['packages/%s.u' % p] = '%s.u' % p
    if manifest['cover']:
        members[manifest['cover']] = manifest['cover']
    names = {i.filename for i in z.infolist() if not i.filename.endswith('/')}
    missing = [k for k in members if k not in names]
    if missing:
        raise ValueError('The mod file is incomplete: %s' % ', '.join(missing[:3]))
    extra = sorted(names - set(members))
    if extra:
        raise ValueError('The mod file has files a mod cannot have: %s' % ', '.join(extra[:3]))
    return manifest, z, members


def _safe(z):
    """Every member of a zip stays inside it (no absolute path, no ..), and nothing is too big."""
    total = 0
    for i in z.infolist():
        name = i.filename
        if name.endswith('/'):
            continue
        if '\\' in name or name.startswith('/') or '..' in name.split('/') or ':' in name:
            raise ValueError('The mod file has an unsafe path: %s' % name)
        total += i.file_size
        if i.file_size > MAX_FILE or total > MAX_TOTAL:
            raise ValueError('The mod file is too big.')
        if i.compress_size and i.file_size / i.compress_size > 200:
            raise ValueError('The mod file is not a valid archive.')


def installed():
    """Every installed mod of both games, newest first."""
    out = []
    for target in settings.TARGETS:
        root = mods_root(target)
        if not root or not root.is_dir():
            continue
        for folder in root.iterdir():
            try:
                m = check_manifest(json.loads((folder / 'mod.json').read_text(encoding='utf-8')))
            except (OSError, ValueError):
                continue
            if m['id'] != folder.name or m['game'] != target:
                continue
            m['gameName'] = settings.TARGETS[target]['name']
            m['installed'] = (folder / 'mod.json').stat().st_mtime
            m['missing'] = [r for r in m['requires'] if not _has_package(target, r)]
            out.append(m)
    return sorted(out, key=lambda m: -m['installed'])


def _has_package(target, name):
    import gamecheck
    return name.lower() in gamecheck.files(target)


def install(source, replace=False):
    """Install a mod file into its game. Returns dict(manifest, replaced). Raises FileExistsError with the
    installed version when the mod is there and replace is False."""
    manifest, z, members = read(source)
    target = manifest['game']
    root = mods_root(target)
    if not root:
        raise ValueError('This mod is for %s, which is not installed on this PC.' % settings.TARGETS[target]['name'])
    if _running(target):
        raise ValueError('Close %s before installing a mod.' % settings.TARGETS[target]['short'])
    dest = root / manifest['id']
    old = None
    if (dest / 'mod.json').is_file():
        try:
            old = json.loads((dest / 'mod.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            old = {}
        if not replace:
            raise FileExistsError(json.dumps(dict(installed=old.get('version', '?'), incoming=manifest['version'],
                                                  name=manifest['name'])))
    root.mkdir(parents=True, exist_ok=True)
    tmp = root / ('.%s.installing' % manifest['id'])
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir()
    try:
        for member, name in members.items():
            with z.open(member) as src, open(tmp / name, 'wb') as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
        (tmp / 'mod.json').write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding='utf-8')
        (tmp / 'Save').mkdir()
        if dest.exists():
            keep = dest / 'Save'                   # an update keeps the player's saved games
            if keep.is_dir():
                shutil.rmtree(tmp / 'Save')
                shutil.move(str(keep), str(tmp / 'Save'))
            shutil.rmtree(dest)
        tmp.rename(dest)
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    # DeusEdixNav, the package every DeusEdix mod's code uses: DeusEdix's own build, into the game's System folder
    # (the only place the engine finds its DLL); a mod file never carries a DLL
    import kit
    kit.install_native(game_root(target) / 'System')
    return dict(manifest=manifest, replaced=old is not None)


# ------------------------------------------------------------------ any downloaded mod (Install mod... / drop)

CLASSIC_PACKAGES = {'.u', '.utx', '.uax', '.umx'}      # code, textures, sounds, music: read through the Paths
_PROGRAMS = {'.exe', '.dll', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.jar', '.com', '.scr', '.msi', '.reg', '.lnk', '.sys'}
_README = {'.txt', '.md'}
_PICTURES = {'.png', '.jpg', '.jpeg'}


def import_zip(raw, filename='', game=None, replace=False):
    """Install what a player downloaded: a DeusEdix .dxmod, a zip with one inside, or a classic mod's zip
    (maps, packages, textures, sounds, music in any folders). Programs are never installed; a mod that
    replaces the game's own files is refused (it needs its own installer). Returns install()'s dict plus
    kind and skipped."""
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise ValueError('Only .dxmod and .zip files can be installed here (extract a .7z or .rar first).')
    _safe(z)
    names = [i.filename for i in z.infolist() if not i.filename.endswith('/')]
    if 'mod.json' in names:
        return dict(install(raw, replace), kind='deusedix', skipped=[])
    inner = [n for n in names if n.lower().endswith(EXT)]
    if len(inner) == 1:
        return dict(install(z.read(inner[0]), replace), kind='deusedix', skipped=[])
    return _import_classic(z, names, raw, filename, game, replace)


def _slug(text):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', text.lower())).strip('-')[:40] or 'mod'


def _import_classic(z, names, raw, filename, game, replace):
    import hashlib
    import tempfile
    import gamecheck
    files, skipped, readme, picture, inis = {}, [], None, None, []
    for n in names:
        base, ext = n.rsplit('/', 1)[-1], Path(n).suffix.lower()
        if ext in _PROGRAMS:
            skipped.append(base)
        elif ext == '.dx' or ext in CLASSIC_PACKAGES:
            if base.lower() in {k.lower() for k in files}:
                raise ValueError('The zip has two files called %s: install it by hand.' % base)
            if not _NAME.match(base):
                raise ValueError('The zip has a file with an unusual name: %s' % base)
            files[base] = n
        elif ext == '.ini':
            inis.append(n)
        elif ext in _README and readme is None and z.getinfo(n).file_size < 512 * 1024:
            readme = n
        elif ext in _PICTURES and picture is None and z.getinfo(n).file_size <= MAX_COVER:
            picture = n
    maps = sorted(Path(b).stem for b in files if b.lower().endswith('.dx'))
    packages = sorted(b for b in files if not b.lower().endswith('.dx'))
    if not maps:
        raise ValueError('There are no maps in this zip. It may be a mod that changes the game itself '
                         '(it needs its own installer) or only a part of another mod.')
    if game and not game_root(game):
        raise ValueError('%s is not installed on this PC.' % settings.TARGETS.get(game, {}).get('name', game))
    targets = [game] if game else [t for t in ('vanilla', 'revision') if game_root(t)]
    with tempfile.TemporaryDirectory(prefix='deusedix-mod-') as tmp:
        tmp = Path(tmp)
        for base, member in files.items():
            with z.open(member) as src, open(tmp / base, 'wb') as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
        own = {Path(p).stem for p in packages}
        problems, chosen = {}, None
        for t in targets:
            have = gamecheck.files(t)
            clash = sorted(p for p in packages if Path(p).stem.lower() in have)
            if clash:
                problems[t] = 'it replaces files of the game (%s), so it needs its own installer' % ', '.join(clash[:4])
                continue
            missing = set()
            for m in maps:
                result = gamecheck.check(tmp / (m + '.dx'), t, own)
                missing |= {x['package'] for x in result['missing']}
                if result.get('too_new'):
                    missing.add('a newer game (its maps were saved by Revision)')
            if missing:
                problems[t] = 'it needs %s' % ', '.join(sorted(missing)[:5])
                continue
            chosen = t
            break
        if not chosen:
            why = '; '.join('%s: %s' % (settings.TARGETS[t]['short'], p) for t, p in problems.items())
            raise ValueError('This mod cannot be installed: %s.' % (why or 'no Deus Ex game is installed'))
        # the map it starts on: its own ini's LocalMap, a map with 'intro' in its name, else the first by name
        start = None
        for ini in inis:
            found = re.search(r'(?im)^\s*LocalMap\s*=\s*([^\s?#.]+)', z.read(ini).decode('latin1', 'replace'))
            if found and found.group(1) in maps:
                start = found.group(1)
                break
        start = start or next((m for m in maps if 'intro' in m.lower()), None) or maps[0]
        stem = Path(filename or 'Mod').stem
        name = re.sub(r'_+', ' ', stem).strip()[:80] or 'Mod'
        mod_id = 'zip-%s-%s' % (_slug(stem), hashlib.sha1(raw).hexdigest()[:8])
        description = ''
        if readme:
            description = re.sub(r'\s+', ' ', z.read(readme).decode('latin1', 'replace')).strip()[:600]
        cover_name = None
        if picture:
            cover_name = 'cover.png' if picture.lower().endswith('.png') else 'cover.jpg'
        manifest = check_manifest(dict(format=FORMAT, kind='classic', id=mod_id, name=name, author='', version='1.0',
                                       description=description, game=chosen, maps=maps, packages=packages, start=start,
                                       requires=[], cover=cover_name, created=time.strftime('%Y-%m-%d %H:%M'),
                                       editor='', source=(filename or '')[:120]))
        if _running(chosen):
            raise ValueError('Close %s before installing a mod.' % settings.TARGETS[chosen]['short'])
        root = mods_root(chosen)
        dest = root / mod_id
        old = None
        if (dest / 'mod.json').is_file():
            try:
                old = json.loads((dest / 'mod.json').read_text(encoding='utf-8'))
            except (OSError, ValueError):
                old = {}
            if not replace:
                raise FileExistsError(json.dumps(dict(installed=old.get('version', '?'), incoming=manifest['version'],
                                                      name=manifest['name'])))
        root.mkdir(parents=True, exist_ok=True)
        stage = root / ('.%s.installing' % mod_id)
        if stage.exists():
            shutil.rmtree(stage)
        stage.mkdir()
        try:
            for base in files:
                shutil.copy2(tmp / base, stage / base)
            if readme:
                (stage / 'readme.txt').write_bytes(z.read(readme))
            if picture:
                (stage / cover_name).write_bytes(z.read(picture))
            (stage / 'mod.json').write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding='utf-8')
            (stage / 'Save').mkdir()
            if dest.exists():
                if (dest / 'Save').is_dir():
                    shutil.rmtree(stage / 'Save')
                    shutil.move(str(dest / 'Save'), str(stage / 'Save'))
                shutil.rmtree(dest)
            stage.rename(dest)
        except Exception:
            shutil.rmtree(stage, ignore_errors=True)
            raise
    return dict(manifest=manifest, replaced=old is not None, kind='classic', skipped=sorted(set(skipped)))


def set_start(target, mod_id, start):
    """The map a mod starts on (Projects > Mods: Starts on)."""
    folder = _folder(target, mod_id)
    m = json.loads((folder / 'mod.json').read_text(encoding='utf-8'))
    if start not in m.get('maps', []):
        raise ValueError('That map is not part of the mod.')
    m['start'] = start
    (folder / 'mod.json').write_text(json.dumps(check_manifest(m), indent=1, ensure_ascii=False), encoding='utf-8')
    return dict(ok=True)


def _folder(target, mod_id):
    root = mods_root(target)
    if target not in settings.TARGETS or not _ID.match(str(mod_id or '')) or not root:
        raise ValueError('Unknown mod.')
    folder = root / mod_id
    if not (folder / 'mod.json').is_file():
        raise ValueError('That mod is not installed.')
    return folder


def uninstall(target, mod_id):
    folder = _folder(target, mod_id)
    if _running(target):
        raise ValueError('Close %s before removing a mod.' % settings.TARGETS[target]['short'])
    shutil.rmtree(folder)
    return dict(ok=True)


def cover(target, mod_id):
    folder = _folder(target, mod_id)
    for name in ('cover.png', 'cover.jpg'):
        if (folder / name).is_file():
            return (folder / name).read_bytes(), 'image/png' if name.endswith('png') else 'image/jpeg'
    return None, None


# ------------------------------------------------------------------ play

def launch_ini(target, mod_id):
    """The game's own ini, read now, with the mod's folder first and the mod's save folder; the player's
    files are never written. Returns the INI= value for the command line."""
    import project_game
    folder = _folder(target, mod_id)
    profile = settings.TARGETS[target]
    system = game_root(target) / 'System'
    text = (system / profile['ini']).read_text(encoding='latin1')
    rel = '..\\%s\\%s' % (MODS_DIR, mod_id)
    paths = ['Paths=%s\\*.%s' % (rel, ext) for ext in ('dx', 'u', 'utx', 'uax', 'umx')]
    (folder / 'Save').mkdir(exist_ok=True)
    text = project_game.activate_text(text, paths, project_game.original_save_paths(text), rel + '\\Save',
                                      project_game.original_actors(text))
    if target == 'revision':
        # Revision's launcher takes only a file name of its System folder ("Malformed system ini" otherwise)
        ini = system / REVISION_INI
        value = REVISION_INI
    else:
        ini = folder / 'Play' / profile['ini']
        ini.parent.mkdir(exist_ok=True)
        value = rel + '\\Play\\' + profile['ini']
    tmp = ini.with_name(ini.name + '.tmp')
    tmp.write_text(text, encoding='latin1', newline='')
    tmp.replace(ini)
    return value


def play(target, mod_id):
    """Start the mod's game on its start map: through Steam for a Steam copy (it adds the player's own launch
    options), by itself for a GOG copy (settings.game_command)."""
    folder = _folder(target, mod_id)
    m = check_manifest(json.loads((folder / 'mod.json').read_text(encoding='utf-8')))
    missing = [r for r in m['requires'] if not _has_package(target, r)]
    if missing:
        raise ValueError('This mod needs packages of other mods that are not installed: %s.' % ', '.join(missing))
    if _running(target):
        raise ValueError('%s is already running: close it first.' % settings.TARGETS[target]['short'])
    value = launch_ini(target, mod_id)
    # Steam quotes every word; the engine stops a value at a comma, so a comma ends INI= (as the editor's Play)
    argv, cwd = settings.game_command([m['start'], 'INI=' + value + ','], target=target)
    subprocess.Popen(argv, cwd=cwd)
    return dict(ok=True, name=m['name'], start=m['start'])
