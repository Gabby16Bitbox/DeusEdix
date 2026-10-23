"""Tools > Scripts > Import a mod: another mod's files brought into the project, as far as they can be.

A mod comes as a folder or a .zip: compiled packages (.u: classes, models; .utx textures, .uax sounds, .umx
music), maps (.dx), sometimes its UnrealScript sources (<Package>/Classes/*.uc) and its texts (.int). The page
uploads the files into a staging folder (mods/_incoming/<id>), scan() says what each one is and whether this
project's game can load it, install() does what was chosen:
  packages   kept in mods/<Mod>/, used by the editor (packages.json, kit.py links them into every run) and
             copied next to the project's maps when it installs (workspace.py), so the game finds them too;
  sources    .uc of a package that came without its .u: made scripts of the project and compiled; when they do
             not compile they are taken out again (the scripts stay as they were) and the problems are listed;
  maps       imported as copies of the project (mapfiles.import_map), opened from Open a map.
What cannot be done is said, with the reason; the page's Help says how to do it by hand.
"""
import json
import re
import shutil
import uuid
import zipfile
from pathlib import Path

import settings

MODS = settings.PROJECT / 'tools' / 'mapkit' / 'mods'
INCOMING = MODS / '_incoming'
KINDS = {'.u': 'code', '.utx': 'textures', '.uax': 'sounds', '.umx': 'music', '.dx': 'map', '.uc': 'source', '.int': 'text'}
PACKAGE_KINDS = ('code', 'textures', 'sounds', 'music')
MAX_FILE = 256 * 1024 * 1024
MAX_TOTAL = 2 * 1024 * 1024 * 1024
NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,40}$')


def _stage(sid):
    if not re.fullmatch(r'[0-9a-f]{32}', sid or ''):
        raise ValueError('Unknown import.')
    d = INCOMING / sid
    if not d.is_dir():
        raise ValueError('That import is gone: choose the mod again.')
    return d


def _safe_rel(rel):
    """A relative path inside the stage, or ValueError (no drive, no .., no hidden tricks)."""
    parts = [p for p in str(rel).replace('\\', '/').split('/') if p not in ('', '.')]
    if not parts or any(p == '..' or ':' in p for p in parts):
        raise ValueError('Bad file path in the mod: %s' % rel)
    return Path(*parts)


def new():
    # imports left behind (the page closed before Install or Cancel) go after a day
    import time
    if INCOMING.is_dir():
        for old in INCOMING.iterdir():
            if old.is_dir() and time.time() - old.stat().st_mtime > 86400:
                shutil.rmtree(old, ignore_errors=True)
    sid = uuid.uuid4().hex
    (INCOMING / sid).mkdir(parents=True)
    return sid


def add_file(sid, rel, raw):
    """One file of the mod; a .zip is opened (its files, never outside the stage)."""
    d = _stage(sid)
    rel = _safe_rel(rel)
    if len(raw) > MAX_FILE:
        raise ValueError('%s is larger than 256 MB.' % rel.name)
    if sum(f.stat().st_size for f in d.rglob('*') if f.is_file()) + len(raw) > MAX_TOTAL:
        raise ValueError('The mod is larger than 2 GB.')
    if rel.suffix.lower() == '.zip':
        import io
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            for info in z.infolist():
                if info.is_dir() or info.file_size > MAX_FILE:
                    continue
                target = d / rel.stem / _safe_rel(info.filename)
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(info) as src, open(target, 'wb') as out:
                    shutil.copyfileobj(src, out)
        return
    if rel.suffix.lower() not in KINDS and rel.suffix.lower() not in ('.txt', '.md', '.ini'):
        return                                      # pictures, docs, tools of the mod: not used here
    target = d / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)


def _class_of(path):
    m = re.search(r'(?im)^\s*class\s+(\w+)\s+(?:extends|expands)\s+([\w.]+)', path.read_text(encoding='latin1', errors='replace'))
    return (m.group(1), m.group(2)) if m else (path.stem, '')


def scan(sid):
    """What the mod has and what can be done with it (the page shows it as a list to tick)."""
    import gamecheck
    import kit
    import scripts
    d = _stage(sid)
    files = [f for f in d.rglob('*') if f.is_file()]
    packages, maps, sources, texts, readme = [], [], {}, [], ''
    names = {f.stem for f in files if KINDS.get(f.suffix.lower()) in PACKAGE_KINDS}
    own = gamecheck.own_packages() | names
    have = {p['name'].lower() for p in kit.extra_packages()}
    game = {f.stem.lower() for dd in settings.SYSTEM_DIRS if dd.is_dir() for f in dd.glob('*.u')}
    for f in sorted(files, key=lambda x: str(x).lower()):
        kind = KINDS.get(f.suffix.lower())
        rel = f.relative_to(d).as_posix()
        if kind in PACKAGE_KINDS:
            row = dict(file=rel, name=f.stem, kind=kind, size=f.stat().st_size, added=f.stem.lower() in have)
            if f.stem.lower() in game and kind == 'code':
                row.update(loads=True, note='The game has a package with this name already: the game\'s is used.', skip=True)
            else:
                try:
                    r = gamecheck.report(f, own=own)
                    row.update(loads=r['loads'], note='' if r['loads'] else r['message'])
                except (OSError, ValueError, IndexError) as exc:
                    row.update(loads=False, note='Cannot read it: %s' % exc)
            packages.append(row)
        elif kind == 'map':
            maps.append(dict(file=rel, name=f.stem, size=f.stat().st_size))
        elif kind == 'source':
            # <Package>/Classes/X.uc; loose .uc files go under the mod's name
            parts = f.relative_to(d).parts
            pkg = parts[-3] if len(parts) >= 3 and parts[-2].lower() == 'classes' else ''
            cls, parent = _class_of(f)
            sources.setdefault(pkg, []).append(dict(file=rel, cls=cls, parent=parent))
        elif kind == 'text':
            texts.append(rel)
        elif not readme and re.search(r'read ?me|install', f.name, re.I) and f.suffix.lower() in ('.txt', '.md'):
            readme = f.read_text(encoding='latin1', errors='replace')[:3000]
    mine = {n.lower() for n in scripts.names()}
    groups = []
    for pkg, classes in sorted(sources.items()):
        compiled = bool(pkg) and pkg.lower() in {p['name'].lower() for p in packages if p['kind'] == 'code'}
        clash = sorted(c['cls'] for c in classes if c['cls'].lower() in mine or re.match(r'(?i)UC[WA]_', c['cls']))
        groups.append(dict(package=pkg or '(loose files)', classes=classes, compiled=compiled, clash=clash,
                           note=('Its compiled %s.u is in the mod: that one is used, the sources are not needed.' % pkg) if compiled
                           else ('Scripts of yours with the same names: %s.' % ', '.join(clash)) if clash else ''))
    # its name: the folder (or .zip) it came in, else its first package
    tops = {f.relative_to(d).parts[0] for f in files if len(f.relative_to(d).parts) > 1}
    guess = (tops.pop() if len(tops) == 1 and all(len(f.relative_to(d).parts) > 1 for f in files) else '')         or next((p['name'] for p in packages if p['kind'] == 'code'), '') or 'Mod'
    return dict(id=sid, name=re.sub(r'\W', '', guess)[:40] or 'Mod', packages=packages, maps=maps, sources=groups,
                texts=texts, readme=readme, game=settings.TARGETS[settings.TARGET]['name'])


def install(sid, choice, log=None):
    """choice: {name, packages: [file], sources: [package], maps: [file]}. Returns {ok, lines, problems, maps}."""
    import kit
    import packages as pkgs
    import scripts
    d = _stage(sid)
    name = str(choice.get('name') or 'Mod')
    if not NAME.match(name):
        raise ValueError('The mod\'s name: letters, digits and _, starting with a letter.')
    plan = scan(sid)
    lines, problems, opened = [], [], []
    home = MODS / name
    # 1. packages: kept with the project, the editor loads them, the game gets them at each install
    chosen = [p for p in plan['packages'] if p['file'] in set(choice.get('packages') or []) and not p.get('skip')]
    if chosen:
        home.mkdir(parents=True, exist_ok=True)
        extra = [dict(p) for p in kit.extra_packages()]
        for p in chosen:
            src = d / p['file']
            dest = home / src.name
            shutil.copy2(src, dest)
            for t in plan['texts']:                 # its translations sit next to it (the game reads them there)
                if Path(t).stem.lower() == src.stem.lower():
                    shutil.copy2(d / t, home / Path(t).name)
            extra = [x for x in extra if x['name'].lower() != p['name'].lower()]
            extra.append(dict(name=p['name'], path=str(dest), kind=p['kind']))
            lines.append('%s (%s) added%s' % (src.name, p['kind'], '' if p['loads'] else ': ' + p['note']))
        try:
            pkgs.save(extra)
        except ValueError as exc:
            problems.append(dict(script='', line=0, kind='error', message=str(exc)))
            return dict(ok=False, lines=lines, problems=problems, maps=[])
    # 2. sources without their package: scripts of the project, compiled; taken out again if they fail
    groups = [g for g in plan['sources'] if g['package'] in set(choice.get('sources') or []) and not g['compiled']]
    added = []
    for g in groups:
        for c in g['classes']:
            if c['cls'] in g['clash']:
                lines.append('%s skipped: a script of yours has that name' % c['cls'])
                continue
            text = (d / c['file']).read_text(encoding='latin1', errors='replace')
            scripts.save(c['cls'], text)
            added.append(c['cls'])
    if added:
        r = scripts.compile(log)
        if not r.get('ok'):
            # the classes with errors go out, the others are tried again; failing again, all of them go
            problems += r.get('problems') or []
            bad = {x['script'].lower() for x in r.get('problems') or [] if x.get('kind') == 'error' and x.get('script')}
            out = [c for c in added if c.lower() in bad] if bad & {c.lower() for c in added} else list(added)
            for cls in out:
                scripts._path(cls).unlink(missing_ok=True)
            added = [c for c in added if c not in out]
            r = scripts.compile(log)
            if added and not r.get('ok'):
                for cls in added:
                    scripts._path(cls).unlink(missing_ok=True)
                out += added
                added = []
                scripts.compile(log)
            lines.append('Not compiled, taken out again (your scripts are as before): %s' % ', '.join(out))
        if added:
            lines.append('%d script(s) compiled: %s' % (len(added), ', '.join(added)))
    # 3. maps: copies of the project
    import mapfiles
    for f in choice.get('maps') or []:
        if f not in {m['file'] for m in plan['maps']}:
            continue
        try:
            res = mapfiles.import_map(Path(f).name, (d / f).read_bytes())
            opened.append(res)
            lines.append('map %s imported as a copy' % Path(f).name)
        except (FileExistsError, ValueError) as exc:
            lines.append('map %s not imported: %s' % (Path(f).name, exc))
    if not problems:
        shutil.rmtree(d, ignore_errors=True)
    return dict(ok=not problems, lines=lines, problems=problems, maps=opened)


def discard(sid):
    shutil.rmtree(_stage(sid), ignore_errors=True)
