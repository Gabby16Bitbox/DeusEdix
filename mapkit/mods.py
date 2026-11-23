"""Mods: a finished project in one file, installed and played in one click, for Revision and the original game.

A mod file (.dxmod) is a zip:
    mod.json            {format, id, name, author, version, description, game, start, maps, packages, requires}
    cover.png|jpg       optional, shown in the launcher's Mods
    maps/<name>.dx      the project's maps
    packages/<name>.u   the project's own packages (DXP_<id>, ...Anims, ...Models, ...Sounds, ...Scripts)

Nothing of the game is in it (export checks every map against the game). Installed, a mod is a folder of its
game: <game root>\\DeusEdixMods\\<id>\\ (Revision\\ for Revision, the Deus Ex folder for the original game).
Play never touches the player's ini files: it writes copies of both (settings.launch_inis: the ini with the mod's
folder first and its own save folder, the user ini as the player has it or as the game would make it) and starts the game on them (Revision only
takes bare file names in its System folder, INI=DeusEdixMod.ini and USERINI=DeusEdixModUser.ini; the original game
takes paths, as the editor's Play does). Tried in Revision on 16 Oct 2026, USERINI= on 29 Oct 2026: before it, the mod's
game wrote its map played last into the player's RevisionUser.ini. No editor sees a mod's game close: its copies go at
the next start of an editor of that game (launch_copies, live.tidy_cut_short).
A mod can also have a shortcut on the desktop (shortcut): the same start on ini files of the mod's own that stay
(own_inis), so that it starts with no DeusEdix, the way the big mods start from theirs.
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
_NAME = re.compile(r'^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$')
_ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')
_PACKAGE = re.compile(r'^DXP_[a-z0-9_]{1,64}$')
_SUFFIXES = ('', 'Anims', 'Models', 'Sounds', 'Scripts')


# ------------------------------------------------------------------ the games

def game_root(target):
    """The folder of `target` that reads its maps and packages, the one of its System folder (settings.system_folder),
    or None when that game is not installed."""
    if target not in settings.TARGETS or settings.check_game(settings.GAME, target):
        return None
    return settings.system_folder(target).parent


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
    # its own main menu (editor/main_menu.py): the map behind it, where the mod starts; its classes are in its package
    out['menu'] = str(m.get('menu') or '')
    if out['menu'] and (out['kind'] != 'deusedix' or out['menu'] not in maps):
        raise ValueError('The mod\'s main menu map is not one of its maps.')
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
    # the project's own main menu, when it is on and ready (main_menu.problems): the mod starts on it
    import main_menu
    menu = main_menu.snapshot()
    menu_map = ''
    if menu['menu']['enabled']:
        main_menu.write_runtime()
        if menu['problems']:
            raise ValueError('The main menu is not ready: %s Fix it in File > Main menu... or switch it off there.'
                             % ' '.join(menu['problems']))
        menu_map = menu['menu']['menuMap']
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
        start=details.get('start'), menu=menu_map, requires=[], cover='cover.png' if cover else None,
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
            link = _recorded(folder)
            m['shortcut'] = str(link) if link and link.is_file() else ''
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
            _keep_player_files(dest, tmp)          # an update keeps the player's saved games and shortcut
            shutil.rmtree(dest)
        tmp.rename(dest)
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    _refresh_shortcut(target, manifest['id'])
    # DeusEdixNav, the package every DeusEdix mod's code uses: DeusEdix's own build, into the game's System folder
    # (the only place the engine finds its DLL); a mod file never carries a DLL
    import kit
    kit.install_native(settings.system_folder(target))
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
                _keep_player_files(dest, stage)
                shutil.rmtree(dest)
            stage.rename(dest)
        except Exception:
            shutil.rmtree(stage, ignore_errors=True)
            raise
        _refresh_shortcut(chosen, mod_id)
    return dict(manifest=manifest, replaced=old is not None, kind='classic', skipped=sorted(set(skipped)))


def _keep_player_files(dest, stage):
    """An update of an installed mod (`dest`) staged in `stage`: what is the player's moves over, the saved games
    (Save), the mod's own ini files and its desktop shortcut's record (LAUNCH_DIR, SHORTCUT)."""
    for name in ('Save', LAUNCH_DIR, SHORTCUT):
        old = dest / name
        if not old.exists():
            continue
        new = stage / name
        if new.is_dir():
            shutil.rmtree(new)
        elif new.exists():
            new.unlink()
        shutil.move(str(old), str(new))


def set_start(target, mod_id, start):
    """The map a mod starts on (Projects > Mods: Starts on)."""
    folder = _folder(target, mod_id)
    m = json.loads((folder / 'mod.json').read_text(encoding='utf-8'))
    if start not in m.get('maps', []):
        raise ValueError('That map is not part of the mod.')
    m['start'] = start
    (folder / 'mod.json').write_text(json.dumps(check_manifest(m), indent=1, ensure_ascii=False), encoding='utf-8')
    _refresh_shortcut(target, mod_id)        # its shortcut's ini names the start map
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
    remove_shortcut(target, folder)
    shutil.rmtree(folder)
    return dict(ok=True)


def cover(target, mod_id):
    folder = _folder(target, mod_id)
    for name in ('cover.png', 'cover.jpg'):
        if (folder / name).is_file():
            return (folder / name).read_bytes(), 'image/png' if name.endswith('png') else 'image/jpeg'
    return None, None


# ------------------------------------------------------------------ play

def launch_ini(target, mod_id, inis=None):
    """The game's own ini files, read now, as copies for the mod's game (settings.launch_inis): the ini with the mod's
    folder first and the mod's save folder, in the player's own window mode (a mod is played, not tested: only the
    editor's launches are always in a window, live.WINDOWED), the user ini as the player has it (or, when it is
    missing, as the game would make it); the player's files are never written. With `inis`, the mod's own ini files
    of its desktop shortcut (own_inis): its user ini, once made, is kept (the keys the player set in the mod's game).
    Returns the words for the command line (INI=, USERINI=)."""
    import project_game
    folder = _folder(target, mod_id)
    profile = settings.TARGETS[target]
    system = settings.system_folder(target)
    text = (system / profile['ini']).read_text(encoding='latin1')
    rel = '..\\%s\\%s' % (MODS_DIR, mod_id)
    paths = ['Paths=%s\\*.%s' % (rel, ext) for ext in ('dx', 'u', 'utx', 'uax', 'umx')]
    (folder / 'Save').mkdir(exist_ok=True)
    text = project_game.activate_text(text, paths, project_game.original_save_paths(text), rel + '\\Save',
                                      project_game.original_actors(text))
    m = check_manifest(json.loads((folder / 'mod.json').read_text(encoding='utf-8')))
    start = start_of(target, folder, m)
    if m['menu']:
        # the mod's own main menu: the game opens it at its start and for Esc (its package's UCMenuRoot)
        text = project_game.menu_ini(text, m['package'] + '.UCMenuRoot', m['menu'])
    elif start['new_game']:
        # the game's own menu, its New Game beginning the mod's first map (UCMenuRoot, UCNewGame, UCModStart)
        text = project_game.menu_ini(text, m['package'] + '.UCMenuRoot', '')
        text = project_game.ini_put(text, m['package'] + '.UCModStart', 'StartMap', start['new_game'])
    user = system / profile['user_ini']
    if inis is None:
        inis = settings.launch_inis(settings.LAUNCH_MOD, folder, target)
    elif inis[1].is_file():
        user = inis[1]
    inis = project_game.write_launch_inis(inis, text, user, target)
    return project_game.launch_args(inis, system)


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
    start = start_of(target, folder, m, prepare=True)
    argv, cwd = settings.game_command([start['word']] + launch_ini(target, mod_id), target=target)
    subprocess.Popen(argv, cwd=cwd)
    return dict(ok=True, name=m['name'], start=start['shows'])


def _has_class(folder, package, name):
    """Whether the mod's package (in its folder) has the class `name`: its name table holds the name (a package
    exported by an older DeusEdix lacks the newer classes)."""
    try:
        return name.encode('latin1') + b'\x00' in (folder / (package + '.u')).read_bytes()
    except OSError:
        return False


def _menu_copy(folder, menu):
    """The mod's main menu map as the game's own start map in the mod's folder (DX.dx, settings.START_MAP): a hard
    link to it, else a copy; made again when the menu map changed (an update of the mod)."""
    import filecmp
    import os
    source, copy = folder / (menu + '.dx'), folder / (settings.START_MAP + '.dx')
    if copy.is_file():
        try:
            if os.path.samefile(source, copy) or filecmp.cmp(source, copy, shallow=False):
                return copy
        except OSError:
            pass
        copy.unlink()
    try:
        os.link(source, copy)
    except OSError:
        shutil.copy2(source, copy)
    return copy


def start_of(target, folder, m, prepare=False):
    """How the game of the mod `m` (installed in `folder`) starts. -> dict(word: the first word of its command line,
    the map it starts on; new_game: the map the game's own New Game begins, '' for the game's own; shows: the map
    the player sees first). Revision starts on the map its command line names (the mod's menu map, else its start
    map). The original game takes that map only with -hax0r, which also turns its cheats on (settings.TARGETS
    map_switch): a mod starts there the way the original game's own mods do, on the game's start map DX.dx
    (settings.START_MAP) with nothing on the command line to switch it. With its own main menu, its menu map is that
    DX.dx, in the mod's folder (first in its launch's paths; made when `prepare`, _menu_copy); without, the game's own
    menu, whose New Game begins the mod's start map (UCModStart, in packages from DeusEdix 0.1.75 on). A mod for
    which neither works (a package from an older DeusEdix, a mod from the internet with no DX map of its own, a mod
    map named DX that is not its menu) starts on its map with -hax0r, as before."""
    own = settings.START_MAP.lower()
    named = [x for x in m['maps'] if x.lower() == own]
    if settings.TARGETS[target].get('map_switch'):
        if m['menu'] and (not named or named == [m['menu']]):
            if prepare and m['menu'].lower() != own:
                _menu_copy(folder, m['menu'])
            return dict(word=settings.START_MAP, new_game='', shows=m['menu'])
        if m['kind'] == 'classic' and named:
            return dict(word=settings.START_MAP, new_game='', shows=named[0])
        if (not m['menu'] and m['kind'] == 'deusedix' and not named
                and _has_class(folder, m['package'], 'UCModStart')):
            return dict(word=settings.START_MAP, new_game=m['start'], shows=settings.START_MAP)
    start = m['menu'] or m['start']          # a mod with its own main menu starts on it, as the game on its own
    return dict(word=start, new_game='', shows=start)


def launch_copies(target):
    """The launch copies a mod's game of `target` may have left (launch_ini, settings.launch_inis): Revision's, the same
    two in its System folder for every mod, whether a mod is still installed or not (the last one may have been
    uninstalled since its game, and they stay behind it); the original game's in each installed mod's own folder (an
    uninstall takes them with the folder). The game writes them as it closes, and no editor sees that: they go at the
    next start of an editor of that game, once no game runs (live.tidy_cut_short)."""
    root = mods_root(target)
    if settings.TARGETS[target]['launch_in_system']:
        return sorted(settings.launch_inis(settings.LAUNCH_MOD, root, target))       # the folder is not in their path
    folders = [p for p in root.iterdir() if p.is_dir()] if root and root.is_dir() else []
    return sorted({path for folder in folders for path in settings.launch_inis(settings.LAUNCH_MOD, folder, target)})


# ------------------------------------------------------------------ the desktop shortcut (a mod started without DeusEdix)

SHORTCUT = 'shortcut.json'      # in the mod's folder: where its desktop shortcut is, for an update and a removal
LAUNCH_DIR = 'Launch'           # the original game's: the mod's own ini files, in the mod's folder
ICON = 'icon.ico'               # made from the mod's cover


def own_inis(target, folder, mod_id):
    """The mod's own ini files, the ones its desktop shortcut starts the game on (shortcut): the original game's in the
    mod's folder (Launch, under the game's own names); Revision's in its System folder (Revision takes nothing else,
    settings.launch_inis), by a name of the mod's own, DeusEdixMod_<id>.ini and DeusEdixMod_<id>User.ini. Unlike a
    Play's copies they stay: the mod's game saves its settings and keys into them, as a big mod's own ini files."""
    profile = settings.TARGETS[target]
    if profile['launch_in_system']:
        return tuple(settings.system_folder(target) / name
                     for name in settings.launch_names('%s_%s' % (settings.LAUNCH_MOD, mod_id)))
    return folder / LAUNCH_DIR / profile['ini'], folder / LAUNCH_DIR / profile['user_ini']


def _recorded(folder):
    """The desktop shortcut the mod's folder names (SHORTCUT): a .lnk path, or None."""
    try:
        path = Path(json.loads((folder / SHORTCUT).read_text(encoding='utf-8')).get('path', ''))
    except (OSError, ValueError, AttributeError):
        return None
    return path if path.suffix.lower() == '.lnk' and path.is_absolute() else None


def _link_name(name, mod_id):
    """The shortcut's file name: the mod's name without the characters Windows refuses in one."""
    text = re.sub(r'[<>:"/\|?*\x00-\x1f]', '', name).strip(' .')
    return (text or mod_id)[:80] + '.lnk'


def _icon(folder, target):
    """The shortcut's icon: the mod's cover made an icon (square, centred) in its folder, else the game's program."""
    for name in ('cover.png', 'cover.jpg'):
        if (folder / name).is_file():
            try:
                from PIL import Image
                with Image.open(folder / name) as im:
                    im = im.convert('RGBA')
                    side = min(im.size)
                    im = im.crop(((im.width - side) // 2, (im.height - side) // 2,
                                  (im.width - side) // 2 + side, (im.height - side) // 2 + side))
                    im.resize((256, 256), Image.LANCZOS).save(folder / ICON, sizes=[(256, 256), (48, 48), (32, 32), (16, 16)])
                return str(folder / ICON) + ',0'
            except Exception:
                break
    return str(settings.system_folder(target) / settings.TARGETS[target]['exe']) + ',0'


_MAKE_LINK = r'''
$ErrorActionPreference = 'Stop'
$desk = if ($env:DXM_DESK) { $env:DXM_DESK } else { [Environment]::GetFolderPath('Desktop') }
$path = Join-Path $desk $env:DXM_NAME
$shell = New-Object -ComObject WScript.Shell
if ((Test-Path -LiteralPath $path) -and $path -ne $env:DXM_MINE) {
  $old = $shell.CreateShortcut($path)
  if (-not $old.Arguments.Contains($env:DXM_MARK)) { [Console]::Out.Write('TAKEN ' + $path); exit 3 }
}
$s = $shell.CreateShortcut($path)
$s.TargetPath = $env:DXM_TARGET
$s.Arguments = $env:DXM_ARGS
$s.WorkingDirectory = $env:DXM_CWD
$s.IconLocation = $env:DXM_ICON
$s.Description = $env:DXM_DESC
$s.Save()
[Console]::Out.Write($path)
'''


def shortcut(target, mod_id):
    """A shortcut on the desktop that starts the mod's game the way Play does (mods.start_of: its own menu, the game's
    menu with the mod's New Game, or its map), on the mod's own ini files (own_inis), with no DeusEdix: the way the
    big mods start, from their own shortcut. Made again when it is there (the player's ini read again, the mod's user
    ini kept). Steam's copy starts through Steam (settings.game_command), with the player's own launch options.
    -> dict(ok, path)"""
    folder = _folder(target, mod_id)
    m = check_manifest(json.loads((folder / 'mod.json').read_text(encoding='utf-8')))
    if _running(target):
        raise ValueError('Close %s before making the shortcut.' % settings.TARGETS[target]['short'])
    start = start_of(target, folder, m, prepare=True)
    inis = own_inis(target, folder, mod_id)
    argv, cwd = settings.game_command([start['word']] + launch_ini(target, mod_id, inis), target=target)
    mine = _recorded(folder)
    import os
    env = dict(os.environ, DXM_NAME=_link_name(m['name'], mod_id), DXM_MINE=str(mine or ''),
               DXM_MARK=inis[0].name + ',', DXM_TARGET=argv[0], DXM_ARGS=subprocess.list2cmdline(argv[1:]),
               DXM_CWD=cwd or str(Path(argv[0]).parent), DXM_ICON=_icon(folder, target),
               DXM_DESC='%s for %s' % (m['name'], settings.TARGETS[target]['name']))
    r = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', _MAKE_LINK],
                       capture_output=True, text=True, env=env, creationflags=subprocess.CREATE_NO_WINDOW, timeout=60)
    out = r.stdout.strip()
    if r.returncode == 3 and out.startswith('TAKEN '):
        raise ValueError('There is already a "%s" on your desktop: rename it, then make the shortcut again.'
                         % Path(out[6:]).stem)
    if r.returncode or not out.lower().endswith('.lnk'):
        raise ValueError('The shortcut was not made: %s' % ((r.stderr or out).strip()[:300] or 'PowerShell failed.'))
    if mine and str(mine).lower() != out.lower():
        mine.unlink(missing_ok=True)           # the mod's name changed: its old shortcut goes
    (folder / SHORTCUT).write_text(json.dumps(dict(path=out, created=time.strftime('%Y-%m-%d %H:%M')), indent=1),
                                   encoding='utf-8')
    return dict(ok=True, path=out, name=Path(out).stem)


def _refresh_shortcut(target, mod_id):
    """The mod's desktop shortcut made again after its update or a new start map, when it has one; never fails."""
    try:
        folder = _folder(target, mod_id)
        if _recorded(folder):
            shortcut(target, mod_id)
    except Exception:
        pass


def remove_shortcut(target, folder):
    """The mod's desktop shortcut and own ini files (own_inis) taken away, as it is removed. -> the paths removed"""
    gone = []
    link = _recorded(folder)
    paths = ([link] if link else []) + list(own_inis(target, folder, folder.name)) + [folder / SHORTCUT]
    for path in paths:
        try:
            if path.is_file():
                path.unlink()
                gone.append(path)
        except OSError:
            pass
    return gone
