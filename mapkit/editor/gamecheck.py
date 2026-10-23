"""Which game a map (.dx) or a package (.u, .utx...) is made for, and what a game would miss to load it.

A package names everything it uses from other packages (its import table). This reads that table and
checks every name against the files the game itself reads (the Paths of its ini: Revision.ini or the
original DeusEx.ini), down to the objects inside shared packages: Revision's own DeusEx.u has classes the
original game's has not (GuardPoint...), Revision's NewVision textures have names the original ones
have not. No engine: the package reader (tools\\ue1pkg.py) only.

    check(path)               {'loads': bool, 'missing': [...], 'made_for': 'vanilla' | 'revision' | 'other', ...}
    made_for(path)            'vanilla' (loads in the original game, so in Revision too), 'revision', 'other'

`missing` lists the packages (and the objects in packages the game has) that the game lacks:
[{'package': 'RevisionDeco', 'objects': ['Mugfull', ...], 'whole': True}, ...].
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent), str(HERE.parent.parent)]
import settings  # noqa: E402
from ue1pkg import Pkg  # noqa: E402

CACHE = HERE / 'cache' / '_gamecheck.json'
VERSION = 1
EXTS = ('.u', '.utx', '.uax', '.umx', '.dx', '.usx')
# the engine's own packages: their classes made in C++ (TextBuffer, Model, Polys, the Property classes...)
# are in the DLLs, not among the package's names (checked on every map and package of both games)
INTRINSIC = {'core', 'engine'}
_files = {}             # target -> (stamp, {name.lower(): path})
_exports = {}           # path -> (stamp, set of names)
_disk = None


def _root(target):
    profile = settings.TARGETS[target]
    return settings.GAME / profile['root'] if profile['root'] else settings.GAME


def installed(target):
    return not settings.check_game(settings.GAME, target)


def search_paths(target):
    """The folders and patterns the game reads packages from: the Paths lines of its ini's [Core.System]
    (Revision.ini also lists the original game's folders), resolved from its System folder."""
    system = _root(target) / 'System'
    ini = system / settings.TARGETS[target]['ini']
    try:
        text = ini.read_text(encoding='latin1', errors='replace')
    except OSError:
        text = ''
    m = re.search(r'(?ms)^\[Core\.System\]\s*$(.*?)(?=^\[|\Z)', text)
    out = []
    for line in (m.group(1) if m else '').splitlines():
        line = line.strip()
        if not line.lower().startswith('paths='):
            continue
        value = Path(line[6:].strip().replace('/', '\\'))
        full = value if value.is_absolute() else (system / value)
        out.append((full.parent.resolve(), full.name))
    if not out:                 # no ini (or no Paths): the game's own folders
        out = [(system, '*.u'), (_root(target) / 'Maps', '*.dx'), (_root(target) / 'Textures', '*.utx'),
               (_root(target) / 'Sounds', '*.uax'), (_root(target) / 'Music', '*.umx')]
    return out


def files(target):
    """{package name (lower case): its file} as the game finds it (the first folder that has it)."""
    paths = search_paths(target)
    stamp = [str(p) + '|' + pat for p, pat in paths]
    hit = _files.get(target)
    if hit and hit[0] == stamp:
        return hit[1]
    found = {}
    for folder, pattern in paths:
        try:
            items = sorted(folder.glob(pattern))
        except OSError:
            continue
        for f in items:
            if f.suffix.lower() in EXTS:
                found.setdefault(f.stem.lower(), f)
    _files[target] = (stamp, found)
    return found


def _load_disk():
    global _disk
    if _disk is None:
        try:
            data = json.loads(CACHE.read_text(encoding='utf-8'))
            _disk = data['packages'] if data.get('version') == VERSION else {}
        except (OSError, ValueError, KeyError):
            _disk = {}
    return _disk


def exports(path):
    """The names a package has (its exports), cached by size and date."""
    path = Path(path)
    st = path.stat()
    stamp = '%d|%d' % (st.st_size, int(st.st_mtime))
    key = str(path).lower()
    hit = _exports.get(key)
    if hit and hit[0] == stamp:
        return hit[1]
    disk = _load_disk()
    if disk.get(key, {}).get('stamp') == stamp:
        names = set(disk[key]['names'])
    else:
        names = {e['name'].lower() for e in Pkg(str(path)).exports}
        disk[key] = dict(stamp=stamp, names=sorted(names))
        try:
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps(dict(version=VERSION, packages=disk)), encoding='utf-8')
        except OSError:
            pass
    _exports[key] = (stamp, names)
    return names


def requirements(path):
    """What a package uses from others: (version, {top package: [(class, object path inside it)]})."""
    pkg = Pkg(str(path))

    def chain(index):
        names = []
        while index < 0:
            cls_pkg, cls, outer, name = pkg.imports[-index - 1]
            names.append(name)
            index = outer
        return list(reversed(names))

    need = {}
    for i, (cls_pkg, cls, outer, name) in enumerate(pkg.imports):
        parts = chain(-(i + 1))
        top = parts[0]
        need.setdefault(top, [])
        if len(parts) > 1 and cls != 'Package':
            need[top].append((cls, parts[-1]))
    return pkg.ver, need


def check(path, target=None, own=()):
    """Can `target` (this project's game by default) load this package? `own`: names of packages that
    are not the game's but will be there (this project's, the other mods' it uses)."""
    target = target or settings.TARGET
    version, need = requirements(path)
    have = files(target)
    if not have:                # the game's files are not there: nothing to judge by, nothing refused
        return dict(target=target, loads=True, version=version, too_new=False, missing=[], packages=sorted(need),
                    unchecked=True)
    own = {n.lower() for n in own} | {Path(path).stem.lower()}
    missing = []
    for top, objects in sorted(need.items(), key=lambda kv: kv[0].lower()):
        low = top.lower()
        if low in own:
            continue
        if low not in have:
            missing.append(dict(package=top, objects=sorted({o for _c, o in objects}), whole=True))
            continue
        names = exports(have[low])
        lost = sorted({o for c, o in objects if o.lower() not in names and not (c == 'Class' and low in INTRINSIC)})
        if lost:
            missing.append(dict(package=top, objects=lost, whole=False))
    # the original game reads packages of version 68; Revision saved some of its maps as 69
    too_new = target == 'vanilla' and version > 68
    return dict(target=target, loads=not missing and not too_new, version=version, too_new=too_new,
                missing=missing, packages=sorted(need))


def own_packages():
    """The packages that are there when this project's maps play though the game has not them: the
    project's own, and the other mods' packages it uses (Packages panel)."""
    import kit
    return ({settings.PACKAGE, settings.ANIMS_PACKAGE, settings.MODELS_PACKAGE, settings.SOUNDS_PACKAGE, settings.SCRIPTS_PACKAGE, 'UnatcoVoices'}
            | {p['name'] for p in kit.extra_packages()})


def made_for(path, own=()):
    """'vanilla' when the original game loads it (Revision too), 'revision' when only Revision does,
    'other' when neither has everything it uses (another mod's packages)."""
    if installed('vanilla') and check(path, 'vanilla', own)['loads']:
        return 'vanilla'
    if installed('revision') and check(path, 'revision', own)['loads']:
        return 'revision'
    return 'other'


def report(path, target=None, own=()):
    """check() and made_for() together, with a sentence for the editor."""
    target = target or settings.TARGET
    result = check(path, target, own)
    result['made_for'] = 'vanilla' if result['loads'] and target == 'vanilla' else made_for(path, own)
    game = settings.TARGETS[target]['name']
    if result['loads']:
        result['message'] = 'Made for %s: this project (%s) loads it.' % (
            'the original Deus Ex' if result['made_for'] == 'vanilla' else settings.TARGETS[result['made_for']]['name']
            if result['made_for'] in settings.TARGETS else 'another mod', game)
    else:
        parts = ['%s (%s)' % (m['package'], 'the whole package' if m['whole'] else ', '.join(m['objects'][:6])
                              + (' and %d more' % (len(m['objects']) - 6) if len(m['objects']) > 6 else ''))
                 for m in result['missing'][:8]]
        what = {'revision': 'Deus Ex: Revision', 'vanilla': 'the original Deus Ex'}.get(result['made_for'], 'another mod')
        result['message'] = ('Made for %s: %s cannot load it. Missing: %s%s.' % (
            what, game, '; '.join(parts) or 'a newer package version (%d)' % result['version'],
            ' and more' if len(result['missing']) > 8 else ''))
    return result


if __name__ == '__main__':
    for arg in sys.argv[1:]:
        r = report(arg)
        print(Path(arg).name, '|', r['message'])
