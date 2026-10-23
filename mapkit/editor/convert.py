"""A copy of a Deus Ex: Revision map that the original Deus Ex loads.

A map saved by Revision names what only Revision has: its music actors (DXOgg), its mission scripts
(RevisionMission), its classes (Revision, RevisionDeco, RevisionPawn, Precipitation, MoreTriggers...),
its textures and sounds (RevTex*, RSounds), HDTP's models; gamecheck.check(path, 'vanilla') lists them.
The copy is made by a round trip through T3D text in private runs of the headless SDK editor
(bin\\UCMapKitHost.exe), made here for each game whatever game this project is for:

 1. Revision's run (Revision\\System with the original game's editor engine): MAP LOAD of the source,
    MAP EXPORT, the defaults of Revision's classes, the pictures of the map's own textures (MyLevel);
 2. the text rewritten for the original game: Revision's music actors removed and the song of the
    original map of the same place set; the original game's mission script and conversations; every
    object of a class the original game lacks made an object of its nearest original ancestor class
    (zones: ZoneInfo with the properties ZoneInfo has; an ancestor that cannot be placed, like
    DeusExDecoration: the original class under it with the same model, else the object goes; Revision's
    rain and snow go), keeping what its Revision class set where the original class has it; every
    texture, model, sound or class the original game lacks replaced by the one of the same name in the
    original packages, else cleared (a brush face gets a fitting original texture instead);
 3. the original game's run (Deus Ex\\System): MAP NEW, the map's own textures imported again,
    MAP IMPORT, geometry, AI paths and lighting rebuilt as the editor builds a map, MAP SAVE;
 4. checked: gamecheck for the original game, then MAP LOAD in a fresh run of the original game.

    revision_to_vanilla(src, new_name, log=print) -> (bytes of the .dx, report)

report: ok, source, name, actors_before/after, brushes_before/after, replaced_classes {old: new},
replaced_references, cleared_references, retextured {old: new}, removed, dropped_properties (zones),
ignored_properties (the import left them out), song, song_from, script, world, gamecheck,
loads_in_original_editor, warnings, seconds. ValueError: what the user can fix (no Revision, not a map,
a name); RuntimeError: the engine failed, or the copy would not load in the original game.

The source is only read. The runs live in runs\\convert and are deleted at the end: their System files
are hard links to the game's, and deleting a link never touches the game's own file.
"""
import collections
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
sys.path[:0] = [str(HERE), str(KIT), str(KIT.parent)]
import settings  # noqa: E402
import kit  # noqa: E402
import gamecheck  # noqa: E402
from ue1pkg import Pkg  # noqa: E402

RUNS = KIT / 'runs' / 'convert'
HOST = KIT / 'bin' / 'UCMapKitHost.exe'
# the retail packages the editor engine needs and Revision does not ship (as workspace.py)
RETAIL = ('Editor', 'Fire', 'UBrowser', 'UWindow', 'MPCharacters', 'IpServer', 'Core')
FAILED = re.compile(r'(?im)^.*(?:Failed to load|Failed import|Critical:|UCMapKit\|fault|UCMapKit\|failed).*$')
NAME = re.compile(r'[A-Za-z0-9_][A-Za-z0-9_-]{0,63}')
# what a Revision class sets for its objects that stays with them when an original class takes its place
# (a T3D has only what differs from the class's defaults): how they look, collide, sound and are called,
# with every property the original class declares below Actor
CARRIED = ('Mesh', 'Skin', 'Texture', 'MultiSkins', 'DrawType', 'Style', 'DrawScale', 'Fatness', 'ScaleGlow',
           'AmbientGlow', 'bUnlit', 'bMeshEnviroMap', 'CollisionRadius', 'CollisionHeight', 'bCollideActors',
           'bCollideWorld', 'bBlockActors', 'bBlockPlayers', 'bProjTarget', 'LightType', 'LightEffect',
           'LightBrightness', 'LightHue', 'LightSaturation', 'LightRadius', 'AmbientSound', 'SoundRadius',
           'SoundVolume', 'SoundPitch', 'ItemName', 'FamiliarName', 'UnfamiliarName', 'BindName', 'BarkBindName',
           'bPushable', 'bInvincible', 'HitPoints', 'Mass', 'Buoyancy', 'Physics', 'bHidden')
# what a reference names, by the class of the object (T3D: Type'Package.Group.Name')
KINDS = {'lodmesh': 'mesh', 'mesh': 'mesh', 'sound': 'sound', 'music': 'music', 'class': 'class', 'font': 'font'}
# Revision's and HDTP's names for objects the original game has under the plain name (HDTPGM_Trench: GM_Trench)
PREFIX = re.compile(r'^(?:(?i:hdtp)_?|(?i:rev)_|Rev(?=[A-Z])|(?i:nv)_)')
CLASS_ABSTRACT = 0x1
TEXF_P8 = 0
MOVERS = 'Mover'
# Revision's music actor (the original game plays LevelInfo.Song) and its rain and snow package (the zones
# stay as ZoneInfo, the rest goes: settings.FEATURES 'weather' is Revision's only)
MUSIC = 'dxoggmusicinfo'
WEATHER = ('precipitation',)


def _kind(cls):
    cls = cls.lower()
    return 'texture' if cls.endswith('texture') else KINDS.get(cls)


def _say(log, *a):
    if log:
        log(' '.join(str(x) for x in a))


def _require():
    """Both games: Revision reads the source, the original game writes the copy."""
    game = settings.GAME
    for target, name in (('revision', 'Deus Ex: Revision'), ('vanilla', 'the original Deus Ex')):
        missing = settings.check_game(game, target)
        if missing:
            raise ValueError('Converting a map needs %s installed in %s (missing: %s).'
                             % (name, game, ', '.join(missing)))
    if not HOST.is_file():
        raise ValueError('The editor engine host is missing: %s' % HOST)
    return game


# ------------------------------------------------------------------------------------------ runs
def _link(src, dst):
    try:
        os.link(src, dst)
    except OSError:                 # another disk
        shutil.copy2(src, dst)


def _ini(text, ini_dir, system, extra=()):
    """The game's ini for a run: every relative folder made absolute (from the game's System), the run's
    System read first, maps read only from the run's Input, no autosave."""
    out = []
    for line in text.splitlines():
        if line.startswith(('AutoSave=', 'ServerActors=')):
            continue
        if line.lower().startswith('paths='):
            value = line[6:].strip()
            path = Path(value) if Path(value).is_absolute() else ini_dir / value
            if path.suffix.lower() == '.dx':
                continue
            line = 'Paths=' + os.path.normpath(str(path))
        out.append(line)
        if line.strip() == '[Core.System]':
            out += ['Paths=' + str(p) for p in [system / '*.u'] + list(extra)]
        elif line.strip() == '[Editor.EditorEngine]':
            out.append('AutoSave=False')
    return '\r\n'.join(out) + '\r\n'


def _run(game, target, label, extra_paths=(), packages=()):
    """A private run for `target`: a System folder with hard links of the game's engine and packages
    (Revision's with the original game's editor engine, as workspace.py makes it), the host, the game's
    ini with its EditPackages; Input, Output and T3D folders."""
    profile = settings.TARGETS[target]
    system_src = (game / profile['root'] if profile['root'] else game) / 'System'
    RUNS.mkdir(parents=True, exist_ok=True)
    folder = RUNS / ('%s-%s-%s' % (time.strftime('%Y%m%d-%H%M%S'), label[:60], uuid.uuid4().hex[:6]))
    system = folder / 'System'
    system.mkdir(parents=True)
    try:
        for sub in ('Input', 'Output', 'T3D'):
            (folder / sub).mkdir()
        for f in system_src.iterdir():
            if f.is_file() and f.suffix.lower() in ('.dll', '.u', '.int'):
                _link(f, system / f.name)
        if target == 'revision':
            retail = game / 'System'
            for name in ('Editor.dll',) + tuple(n + '.u' for n in RETAIL):
                if (retail / name).is_file():
                    (system / name).unlink(missing_ok=True)
                    _link(retail / name, system / name)
        for f in packages:
            (system / Path(f).name).unlink(missing_ok=True)
            _link(Path(f), system / Path(f).name)
        shutil.copy2(HOST, system / HOST.name)
        ini = _ini((system_src / profile['ini']).read_text(encoding='latin1'), system_src, system, extra_paths)
        for name in dict.fromkeys(('Default.ini', 'DeusEx.ini', profile['ini'])):
            (system / name).write_text(ini, encoding='latin1', newline='')
        users = (('RevisionUser.ini', 'User.ini'), ('RevisionDefUser.ini', 'DefUser.ini')) if target == 'revision' \
            else (('User.ini', 'User.ini'), ('DefUser.ini', 'DefUser.ini'))
        for a, b in users:
            if (system_src / a).is_file():
                shutil.copy2(system_src / a, system / b)
    except BaseException:           # a run half made (a full disk...) is not left behind
        _remove(folder)
        raise
    return folder


def _execute(folder, commands, log_name, timeout=3600, tries=3):
    """Run commands in the host (paths relative to the run's System): its whole output. LIGHT APPLY now and
    then dies in the graphics driver (kit.execute): a run that dies there is run again."""
    commands = [c for c in commands if c.strip()]
    for attempt in range(tries):
        command_file = folder / ('commands-%s.txt' % uuid.uuid4().hex[:8])
        command_file.write_text('\n'.join(commands) + '\n', encoding='utf-8')
        log = folder / log_name
        with log.open('wb') as stream:
            process = subprocess.run([str(folder / 'System' / HOST.name), str(command_file)], cwd=folder / 'System',
                                     stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT,
                                     timeout=timeout, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        text = log.read_text(encoding='utf-8', errors='replace')
        if process.returncode == 0 and 'UCMapKit|done' in text and text.count('UCMapKit|complete') == len(commands):
            return text
        last = re.findall(r'UCMapKit\|command\|(.*)', text)
        if attempt < tries - 1 and last and last[-1].strip() == 'LIGHT APPLY':
            for f in (folder / 'Output').glob('*.dx'):
                f.unlink()
            time.sleep(3)
            continue
        raise RuntimeError('The editor engine stopped at %s (exit code %s): %s (log: %s)' % (
            last[-1] if last else 'its start', process.returncode, FAILED.findall(text)[:3], log))


def _is_link(path):
    try:
        return bool(os.lstat(path).st_file_attributes & 0x400)      # FILE_ATTRIBUTE_REPARSE_POINT
    except (OSError, AttributeError):
        return False


def _rmtree(path):
    """Delete a run without going through a link: a junction or symbolic link is removed as a link; a hard
    link is one name of the game's file, removing it leaves the file."""
    for e in os.scandir(path):
        if _is_link(e.path):
            os.rmdir(e.path) if e.is_dir() else os.unlink(e.path)
        elif e.is_dir(follow_symlinks=False):
            _rmtree(e.path)
        else:
            try:
                os.unlink(e.path)
            except PermissionError:
                os.chmod(e.path, 0o666)
                os.unlink(e.path)
    os.rmdir(path)


def _remove(folder, log=None):
    for attempt in range(5):
        try:
            if folder.exists():
                _rmtree(folder)
            break
        except OSError as e:            # the host still closing a file
            if attempt == 4:
                _say(log, 'could not remove %s: %s' % (folder, e))
            time.sleep(1)
    try:
        RUNS.rmdir()                    # when no other conversion runs
    except OSError:
        pass


# ------------------------------------------------------------------------------------------ packages
_pkgs = {}         # for one conversion (a package reader holds the whole file)


def _pkg(path):
    """ue1pkg.Pkg, read once per file version."""
    path = Path(path)
    st = path.stat()
    key = str(path).lower()
    hit = _pkgs.get(key)
    if hit and hit[0] == (st.st_size, st.st_mtime_ns):
        return hit[1]
    pkg = Pkg(str(path))
    _pkgs[key] = ((st.st_size, st.st_mtime_ns), pkg)
    return pkg


def _path(pkg, index):
    """[Package, Group, Name] of an import (index < 0) or [Group, Name] of an export (index > 0)."""
    names = []
    while index:
        if index < 0:
            _cp, _cls, index, name = pkg.imports[-index - 1]
        else:
            e = pkg.exports[index - 1]
            index, name = e['pkg'], e['name']
        names.append(name)
    return list(reversed(names))


def _tex_size(files, path):
    """The size in world units (USize, VSize times its DrawScale) of the texture Package.Group.Name in these package
    files ({name: file}), else None. DrawScale counts: Revision's HDTP textures are 8 times the pixels at 0.125 (the
    same size in the world: a face keeps its axes); without it a converted fence came out 16 times too fine."""
    parts = path.split('.')
    f = files.get(parts[0].lower()) if len(parts) > 1 else None
    if f is None:
        return None
    try:
        pkg = _pkg(f)
    except OSError:
        return None
    want = [x.lower() for x in parts[1:]]
    for i, e in enumerate(pkg.exports, 1):
        if e['name'].lower() == want[-1] and [x.lower() for x in _path(pkg, i)] == want:
            try:
                u, v = int(pkg.get(i, 'USize', 0) or 0), int(pkg.get(i, 'VSize', 0) or 0)
                scale = float(pkg.get(i, 'DrawScale', 1.0) or 1.0)
            except (TypeError, ValueError):
                return None
            return (u * scale, v * scale) if u and v else None
    return None


# a brush face's texture axes and pan (T3D): scaled with the texture when a face gets one of another size
_AXIS = re.compile(r'^(\s*Texture([UV])\s+)([-+0-9.eE]+),([-+0-9.eE]+),([-+0-9.eE]+)\s*$')
_PAN = re.compile(r'^(\s*Pan\s+)U=([-+0-9]+)\s+V=([-+0-9]+)\s*$')


# words of texture names that say nothing about what a texture shows
_VAGUE = {'new', 'old', 'alt', 'the', 'and', 'clen', 'clean', 'drty', 'dirty', 'damg', 'tex', 'texture'}


def _tokens(name):
    words = {w.lower() for w in re.findall(r'[A-Z]?[a-z]+|[A-Z]+(?![a-z])', name) if len(w) >= 3}
    return words - _VAGUE


class Original:
    """What the original game has: its packages (gamecheck.files('vanilla'), maps aside) and their objects."""

    def __init__(self, extra=()):
        self.files = {k: v for k, v in gamecheck.files('vanilla').items() if v.suffix.lower() != '.dx'}
        self.files.update({Path(p).stem.lower(): Path(p) for p in extra})
        self._index = None
        self._textures, self._classes, self._props = {}, {}, {}

    def has(self, path):
        """Package.[Group.]Name: does the original game have it (gamecheck's rule: the package, then the
        object's name in it)?"""
        parts = path.split('.')
        f = self.files.get(parts[0].lower())
        return bool(f) and (len(parts) == 1 or parts[-1].lower() in gamecheck.exports(f))

    def class_path(self, name):
        """Package.Class of an original class (the first package of the game's Paths that has it), or None."""
        low = name.lower()
        if low not in self._classes:
            self._classes[low] = None
            for f in self.files.values():
                if f.suffix.lower() == '.u' and low in gamecheck.exports(f):
                    e = next((e for e in _pkg(f).exports if not e['class'] and e['name'].lower() == low), None)
                    if e is not None:
                        self._classes[low] = '%s.%s' % (f.stem, e['name'])
                        break
        return self._classes[low]

    def properties(self, name, stop=None):
        """The names of the properties of an original class, its own and its parents' (up to `stop`, not
        included): what the class has, read from its package (a property's outer is its class)."""
        key = (name.lower(), (stop or '').lower())
        if key not in self._props:
            out, path = set(), self.class_path(name)
            while path:
                package, cls = path.split('.')
                if stop and cls.lower() == stop.lower():
                    break
                pkg = _pkg(self.files[package.lower()])
                i, e = next(((i, e) for i, e in enumerate(pkg.exports)
                             if not e['class'] and e['name'] == cls), (0, None))
                if e is None:
                    break
                out |= {x['name'] for x in pkg.exports if x['pkg'] == i + 1 and pkg.classname(x).endswith('Property')}
                if not e['super']:
                    break
                parts = _path(pkg, e['super'])
                path = '%s.%s' % (parts[0] if e['super'] < 0 else package, parts[-1])
            self._props[key] = out
        return self._props[key]

    def index(self):
        """{name: [(kind, Package.Group.Name)]}: the textures, models, sounds, songs and classes (read once,
        one package at a time: they are not kept)."""
        if self._index is None:
            self._index = collections.defaultdict(list)
            for low, f in sorted(self.files.items()):
                if f.suffix.lower() not in ('.utx', '.uax', '.umx', '.u') or low.endswith(('conversations', 'text')):
                    continue
                try:
                    pkg = Pkg(str(f))
                except Exception:           # a package the reader does not understand: nothing found in it
                    continue
                for i, e in enumerate(pkg.exports):
                    kind = 'class' if not e['class'] else _kind(pkg.classname(e))
                    if kind:
                        self._index[e['name'].lower()].append((kind, '.'.join([f.stem] + _path(pkg, i + 1))))
        return self._index

    def find(self, kind, name, prefer=()):
        """The object of that kind with that name, or with the name Revision's and HDTP's prefixes hide
        (packages in `prefer` first)."""
        for n in dict.fromkeys((name, PREFIX.sub('', name))):
            hits = [p for k, p in self.index().get(n.lower(), []) if k == kind]
            if hits:
                return min(hits, key=lambda p: (p.split('.')[0].lower() not in prefer, len(p)))
        return None

    def textures(self, package):
        """[(group, Package.Group.Name)] of an original texture package, in its order."""
        low = package.lower()
        if low not in self._textures:
            f = self.files.get(low)
            out = []
            if f is not None and f.suffix.lower() == '.utx':
                pkg = _pkg(f)
                for i, e in enumerate(pkg.exports):
                    if e['class'] and _kind(pkg.classname(e)) == 'texture' and pkg.classname(e) != 'ScriptedTexture':
                        parts = [f.stem] + _path(pkg, i + 1)
                        out.append((parts[1] if len(parts) > 2 else '', '.'.join(parts)))
            self._textures[low] = out
        return self._textures[low]

    def related(self, package):
        """The original texture packages a Revision package's textures most likely stand for
        (RevTexUNATCO: UNATCO; RevTexFoliage: CoreTexFoliage; RevTexHK: HK_Signs, HK_Interior...)."""
        base = re.sub(r'(?i)^(?:revtex|rev|hdtp|nv)_?', '', package).lower()
        names = [n for n, f in sorted(self.files.items()) if f.suffix.lower() == '.utx']
        return [n for n in names if n in (package.lower(), base, 'coretex' + base)] + \
               [n for n in names if base and n.startswith(base + '_')]


# ------------------------------------------------------------------------------------------ the source
class Source:
    """The Revision map: the full paths of what it uses (a T3D names a face's texture by its name only), its
    own objects (MyLevel), and the ancestors of the classes it uses (ue1pkg: a class names its super)."""

    def __init__(self, path):
        self.path = Path(path)
        self.pkg = _pkg(self.path)
        self.files = gamecheck.files('revision')
        self.paths = {}             # (kind, name lower) -> Package.Group.Name
        self.class_package = {}     # class name lower -> package
        for i, (_cp, cls, _outer, name) in enumerate(self.pkg.imports):
            parts = _path(self.pkg, -(i + 1))
            if len(parts) < 2:
                continue
            if _kind(cls):
                self.paths.setdefault((_kind(cls), name.lower()), '.'.join(parts))
            if cls == 'Class':
                self.class_package[name.lower()] = parts[0]
        self.own = []               # (class, MyLevel.Group.Name, export index)
        for i, e in enumerate(self.pkg.exports):
            kind = _kind(self.pkg.classname(e)) if e['class'] else None
            if kind:
                path = '.'.join(['MyLevel'] + _path(self.pkg, i + 1))
                self.own.append((self.pkg.classname(e), path, i + 1))
                self.paths.setdefault((kind, e['name'].lower()), path)
        self._supers = {}

    def _file(self, package):
        f = self.files.get(package.lower())
        near = self.path.parent / (package + '.u')
        return f if f is not None else (near if near.is_file() else None)

    def supers(self, cls):
        """The class's ancestors, its parent first: ['DeusExDecoration', 'Decoration', 'Actor', 'Object']."""
        low = cls.lower()
        if low not in self._supers:
            package, out = self.class_package.get(low), []
            while package:
                f = self._file(package)
                if f is None:
                    break
                pkg = _pkg(f)
                e = next((e for e in pkg.exports if not e['class'] and e['name'].lower() == cls.lower()), None)
                if e is None or not e['super']:
                    break
                parts = _path(pkg, e['super'])
                package, cls = (parts[0] if e['super'] < 0 else f.stem), parts[-1]
                out.append(cls)
            self._supers[low] = out
        return self._supers[low]

    def below_actor(self, cls):
        """The actor class's ancestors under Actor ([] for a class that is not an actor's)."""
        chain = [c.lower() for c in self.supers(cls)]
        return self.supers(cls)[:chain.index('actor')] if 'actor' in chain else []


# ------------------------------------------------------------------------------------------ host outputs
def _classes(path):
    """UC_CLASSES: {class lower: dict(name, package, flags, mesh, parents, names)} (names: its item and
    familiar names)."""
    return {c['class'].lower(): dict(name=c['class'], package=c['package'], flags=c['flags'], mesh=c['mesh'],
                                     parents=c['parents'], names=c['itemName'] + ' ' + c['familiarName'])
            for c in kit.rows(path)}


def _defaults_commands(props, out_name):
    """UC_DEFAULTS lines (the host takes up to 256 names and 7679 characters a line): (commands, files)."""
    props = sorted({p for p in props if re.fullmatch(r'\w{1,63}', p)}, key=str.lower)
    chunks = [[]]
    for p in props:
        if len(chunks[-1]) >= 250 or len(','.join(chunks[-1] + [p])) > 7000:
            chunks.append([])
        chunks[-1].append(p)
    files = ['%s%d.jsonl' % (out_name, i) for i in range(len(chunks))]
    return [r'UC_DEFAULTS ..\Output\%s %s' % (f, ','.join(c)) for f, c in zip(files, chunks) if c], files


def _defaults(folder, files):
    """UC_DEFAULTS: {class lower: {property (as asked): {index: (property type, value)}}}."""
    out = collections.defaultdict(dict)
    for name in files:
        for row in kit.rows(folder / 'Output' / name):
            if row['kind'] == 'class':
                for p in row['properties']:
                    out[row['class'].lower()].setdefault(p['name'], {})[p['index']] = (p['type'], p['value'])
    return out


# ------------------------------------------------------------------------------------------ T3D
_ACTOR = re.compile(r'^Begin Actor Class=(\S+) Name=(\S+)\s*$')
_PROP = re.compile(r'^(\s*)(\w+)(?:\((\d+)\))?=(.*)$')
_REF = re.compile(r"(\w+)'([^'\s]+)'")
_STRING = re.compile(r'("[^"]*")')         # a text value (the engine writes no quote inside one)


def _read_t3d(path):
    """A T3D as text: the engine writes it in ANSI (Latin-1), or in UTF-16 with its mark when a text in the
    map has a letter ANSI has not."""
    raw = Path(path).read_bytes()
    return raw[2:].decode('utf-16-le') if raw[:2] == b'\xff\xfe' else raw.decode('latin1')


def _t3d_bytes(text):
    """The rewritten T3D as the engine reads it: ANSI, or UTF-16 with its mark (MAP IMPORT reads both)."""
    try:
        return text.encode('latin1')
    except UnicodeEncodeError:
        return b'\xff\xfe' + text.encode('utf-16-le')


def _split(text):
    """(head lines, [(class, name, lines)], tail lines) of a MAP EXPORT."""
    head, actors, tail = [], [], []
    cur = None
    for line in text.splitlines():
        m = _ACTOR.match(line)
        if cur is None and m:
            cur = (m.group(1), m.group(2), [line])
        elif cur is not None:
            cur[2].append(line)
            if line.strip() == 'End Actor' and not line[:1].isspace():
                actors.append(cur)
                cur = None
        else:
            (tail if actors else head).append(line)
    return head, actors, tail


def _top(lines):
    """[(line index, match)] of the properties at the top level of an actor block (not its brush's)."""
    out, depth = [], 0
    for i, line in enumerate(lines[1:-1], 1):
        s = line.strip()
        if s.startswith('Begin '):
            depth += 1
        elif s.startswith('End '):
            depth -= 1
        elif depth == 0:
            m = _PROP.match(line)
            if m:
                out.append((i, m))
    return out


def _quote(kind, value):
    return '"%s"' % value.replace('"', "'") if kind == 'StrProperty' else value


class Rewrite:
    """The rules, applied to the exported text block by block; what they did goes into the report."""

    def __init__(self, source, original, classes, rev_defaults, van_defaults, new_name, song, runtime=(), textures=None):
        self.src, self.orig, self.classes = source, original, classes
        self.rev_def, self.van_def = rev_defaults, van_defaults
        self.new_name, self.song = new_name, song
        self.runtime = {c.lower() for c in runtime}
        self.replaced, self.removed, self.warnings, self.movers = {}, [], [], []
        self.cleared, self.dropped = collections.Counter(), collections.Counter()
        self.retextured, self.renamed, self.loads = {}, {}, set()
        self.script = self.mission = None
        self.own = set()            # the map's own textures carried into the copy (names, lower case)
        self.actors, self._target, self._subst = {}, {}, {}
        self.chosen = {k.lower(): v for k, v in (textures or {}).items()}     # textures chosen by hand

    # -- classes
    def keeps(self, cls):
        c = self.classes.get(cls.lower())
        return c is not None and not c['flags'] & CLASS_ABSTRACT

    def target(self, cls):
        """What an actor of class `cls` becomes: (class or None to remove it, why). Itself when the original
        game has it; zones: ZoneInfo (sky zones: SkyZoneInfo); else its nearest original ancestor, and when
        that one cannot be placed (abstract: DeusExDecoration, HumanCivilian...) the original class under it
        with the same model, else the next ancestor that can be placed."""
        low = cls.lower()
        if low not in self._target:
            chain = self.src.supers(cls)
            names = [c.lower() for c in chain]
            known = next((c for c in chain if c.lower() in self.classes), None)
            if self.keeps(cls):
                hit = cls, None
            elif self.src.class_package.get(low, '').lower() in WEATHER and 'zoneinfo' not in names:
                hit = None, 'Revision\'s rain and snow: the original game has no weather'
            elif 'zoneinfo' in names:
                hit = ('SkyZoneInfo' if 'skyzoneinfo' in names else 'ZoneInfo'), None
            elif known is None:
                hit = None, 'no class of the original game among its ancestors (%s)' % ('/'.join(chain) or 'not found')
            elif self.keeps(known):
                hit = known, None
            else:
                twin = self.twin(cls, known)
                if twin:
                    hit = twin, '%s cannot be placed: %s has the same model' % (known, twin)
                else:
                    further = next((c for c in chain if self.keeps(c)), None)
                    hit = further, None if further else (
                        '%s cannot be placed and no original class under it has its model' % known)
            if hit[1]:
                self.warnings.append('%s: %s' % (cls, hit[1]))
            self._target[low] = hit
        return self._target[low]

    def twin(self, cls, known):
        """A class of the original game that can be placed, under `known`, with the model of `cls`: the
        closest by name, then by class defaults (LDDPBatParkOldBum -> BumMale2, 'Older Bum')."""
        mine = self.rev_def.get(cls.lower(), {})
        ref = _REF.search(mine.get('Mesh', {}).get(0, ('', ''))[1])
        model = ref and self.substitute(ref.group(1), ref.group(2))
        if not model:
            return None
        found = [c for c in self.classes.values() if not c['flags'] & CLASS_ABSTRACT
                 and c['mesh'].lower() == model.lower() and known.lower() in [p.lower() for p in c['parents']]]
        words = {w.lower() for w in re.findall(r'[A-Z]?[a-z]+|[A-Z]+(?![a-z])', cls) if len(w) >= 3}

        def score(c):
            text = (c['name'] + ' ' + c['names']).lower()
            theirs = self.rev_def.get(c['name'].lower(), {})
            same = sum(1 for p, values in mine.items() if theirs.get(p) == values)
            return -sum(1 for w in words if w in text), -same, len(c['parents']), c['name']
        return min(found, key=score)['name'] if found else None

    def clash(self, cls, new, prop):
        """Does the Revision class's property hold another type than the original class's property of the
        same name? (PrecipitationZone's own float Gain hides ZoneInfo's Gain[6] of bytes: Gain=0.32 would
        be read as Gain(0)=0.)"""
        def kinds(defaults, name):
            values = next((v for k, v in defaults.get(name.lower(), {}).items() if k.lower() == prop.lower()), None)
            return {kind for kind, _value in values.values()} if values else None
        mine, theirs = kinds(self.rev_def, cls), kinds(self.van_def, new)
        return bool(mine and theirs and mine != theirs)

    def is_mover(self, cls):
        c = self.classes.get(cls.lower())
        return c is not None and (c['name'] == MOVERS or MOVERS in c['parents'])

    # -- references
    def substitute(self, typ, path):
        """The original game's object for a reference to `path`: the same, the one of the same name, or None."""
        key = (typ.lower(), path.lower())
        if key not in self._subst:
            kind, parts = _kind(typ), path.split('.')
            if parts[0].lower() == 'mylevel':           # the map's own: carried textures only (and its actors)
                new = path if kind is None or (kind == 'texture' and parts[-1].lower() in self.own) else None
            elif self.orig.has(path) or (kind == 'class' and parts[-1].lower() in self.runtime):
                new = path
            elif kind == 'texture' and path.lower() in self.chosen:
                new = self.chosen[path.lower()]
            elif kind:
                new = self.orig.find(kind, parts[-1], prefer=self.orig.related(parts[0]))
            else:
                new = None
            self._subst[key] = new
        return self._subst[key]

    def value(self, text, where):
        """A property value with every reference replaced: (text, True when it was one reference, now None).
        A reference to an actor of the map names it by the class it now has (Region=(Zone=ZoneInfo'MyLevel.
        PrecipitationZone1'...): the original game has no PrecipitationZone), or None when the actor goes.
        Texts in quotes are left as they are ("O'Brien's" is no reference)."""
        def sub(m):
            typ, path = m.group(1), m.group(2)
            parts = path.split('.')
            if parts[0].lower() == 'mylevel' and len(parts) == 2 and parts[1].lower() in self.actors:
                new = self.actors[parts[1].lower()][0]
                return "%s'%s'" % (new, path) if new else 'None'
            new = self.substitute(typ, path)
            if not new:
                self.cleared["%s'%s' (%s)" % (typ, path, where)] += 1
                return 'None'
            if new.split('.')[0].lower() != 'mylevel':
                self.loads.add(new.split('.')[0])
            if new.lower() != path.lower():
                kept = self.retextured if _kind(typ) == 'texture' else self.renamed
                kept["%s'%s'" % (typ, path)] = "%s'%s'" % (typ, new)
            return "%s'%s'" % (typ, new)
        lone = _REF.fullmatch(text.strip())
        text = ''.join(part if i % 2 else _REF.sub(sub, part) for i, part in enumerate(_STRING.split(text)))
        return text, bool(lone) and text.strip() == 'None'

    def face(self, name):
        """A brush face's texture (named without its package in a T3D) as an original full path."""
        if name.lower() == 'none':
            return name
        path = self.src.paths.get(('texture', name.lower()))
        if path is None:
            new = self.orig.find('texture', name)
            if new is None:
                self.warnings.append('face texture %s is neither in the map nor in the original game' % name)
                return name
        else:
            new = self.substitute('Texture', path) or self.fitting(path)
            if new.lower() != path.lower():
                self.retextured[path] = new
        if new.split('.')[0].lower() != 'mylevel':
            self.loads.add(new.split('.')[0])
        return new

    def face_scale(self, before, after):
        """(u, v) factors for a face whose texture became one of another size (new size / old size), else None."""
        old = re.search(r'Texture=(\S+)', before)
        new = re.search(r'Texture=(\S+)', after)
        if not old or not new or old.group(1).lower() == new.group(1).lower():
            return None
        src = self.src.paths.get(('texture', old.group(1).lower()))
        new_path = new.group(1) if '.' in new.group(1) else None
        if not src or not new_path:
            return None
        a, b = _tex_size(self.src.files, src), _tex_size(self.orig.files, new_path)
        if not a or not b or a == b:
            return None
        return (b[0] / a[0], b[1] / a[1])

    def fitting(self, path):
        """An original texture for a face whose texture the original game lacks: the closest by name and
        group in the original packages the Revision package stands for, else in all of them, else the
        first of a related package, else a plain original concrete."""
        key = ('face', path.lower())
        if key not in self._subst and path.lower() in self.chosen:
            self._subst[key] = self.chosen[path.lower()]
        if key not in self._subst:
            parts = path.split('.')
            name, group = parts[-1], (parts[1].lower() if len(parts) > 2 else '')
            words, low = _tokens(name), name.lower()

            def score(item):
                g, p = item
                other = p.split('.')[-1]
                return (2 if group and g.lower() == group else 0) + sum(1 for w in _tokens(other) if w in low) \
                    + sum(1 for w in words if w in other.lower())
            related = [t for package in self.orig.related(parts[0]) for t in self.orig.textures(package)]
            every = [t for package in sorted(self.orig.files) for t in self.orig.textures(package)]
            found = None
            for pool in (related, every):
                best = max(pool, key=score, default=None)
                if best and score(best) > (0 if pool is related else 1):
                    found = best[1]
                    break
            if not found and related:
                found = related[0][1]
            self._subst[key] = found or self.orig.find('texture', 'ClenGrayCemnt_A') or 'Engine.DefaultTexture'
        return self._subst[key]

    # -- actors
    def fates(self, actors):
        """What becomes of each actor: {name lower: (class or None, why)}, before any block is rewritten (a
        block may refer to any other actor)."""
        for cls, name, _lines in actors:
            if MUSIC in [c.lower() for c in [cls] + self.src.supers(cls)]:
                self.actors[name.lower()] = None, 'Revision\'s music; the original game plays LevelInfo.Song'
            else:
                self.actors[name.lower()] = self.target(cls)

    def actor(self, cls, name, lines):
        """The rewritten lines of an actor block, or None when it goes."""
        new, why = self.actors[name.lower()]
        if new is None:
            self.removed.append('%s (%s: %s)' % (name, cls, why))
            return None
        changed = new != cls
        if changed:
            self.replaced[cls] = new
        if self.is_mover(new):
            self.movers.append(name)
        zone = changed and new in ('ZoneInfo', 'SkyZoneInfo')
        has = {p.lower() for p in self.orig.properties(new)} if zone else set()
        out = list(lines)
        out[0] = 'Begin Actor Class=%s Name=%s' % (new, name)
        top = dict(_top(lines))
        scale = None                 # (u, v) while inside a polygon whose texture changed size
        for i, line in enumerate(lines[1:-1], 1):
            if line.strip().startswith('Begin Polygon'):
                out[i] = re.sub(r'Texture=(\S+)', lambda m: 'Texture=' + self.face(m.group(1)), line)
                scale = self.face_scale(line, out[i])
                continue
            if scale and line.strip().startswith('End Polygon'):
                scale = None
            if scale:
                # the same part of the face shows the new texture whole: its axes and pan grow or shrink
                a = _AXIS.match(line)
                if a:
                    f = scale[0] if a.group(2) == 'U' else scale[1]
                    out[i] = '%s%+013.6f,%+013.6f,%+013.6f' % (a.group(1), *(float(a.group(k)) * f for k in (3, 4, 5)))
                    continue
                a = _PAN.match(line)
                if a:
                    out[i] = '%sU=%d V=%d' % (a.group(1), round(int(a.group(2)) * scale[0]), round(int(a.group(3)) * scale[1]))
                    continue
            m = top.get(i)
            if not m:
                continue
            key = m.group(2)
            if (zone and key.lower() not in has and key.lower() != 'name') or (changed and self.clash(cls, new, key)):
                self.dropped['%s.%s' % (cls, key)] += 1
                out[i] = None
                continue
            line = self.special(new, m)
            if line is None:
                out[i] = None
                continue
            m = _PROP.match(line)
            text, gone = self.value(m.group(4), '%s.%s' % (cls, key))
            out[i] = None if gone else '%s%s%s=%s' % (m.group(1), key, '(%s)' % m.group(3) if m.group(3) else '', text)
        out = [line for line in out if line is not None]
        have = {(m.group(2).lower(), int(m.group(3) or 0)) for m in top.values()}
        extra = self.look(cls, new, have) if changed else []
        if new == 'LevelInfo' and self.song:
            extra.append("    Song=Music'%s'" % self.song)
            self.loads.add(self.song.split('.')[0])
        if new == 'DeusExLevelInfo' and ('mapname', 0) not in have:
            extra.append('    MapName="%s"' % self.new_name)
        return out[:-1] + extra + out[-1:]

    def special(self, cls, m):
        """The level's own settings: mission script, conversations, name, song. None: drop the line."""
        indent, key, value = m.group(1), m.group(2).lower(), m.group(4)
        if cls == 'DeusExLevelInfo':
            if key == 'script':
                ref = _REF.search(value)
                if ref and not (self.orig.has(ref.group(2)) or ref.group(2).split('.')[-1].lower() in self.runtime):
                    value = self.mission_script(ref.group(2))
                self.script = value
                return '%sScript=%s' % (indent, value)
            if key == 'conversationpackage':
                package = value.strip().strip('"')
                if package.lower() not in ('', 'none') and not self.orig.has(package):
                    package = 'DeusExConversations'     # Revision's: the original game's own
                return '%sConversationPackage="%s"' % (indent, package)
            if key == 'mapname':
                return '%sMapName="%s"' % (indent, self.new_name)
        if cls == 'LevelInfo' and key == 'song' and self.song:
            return None
        return m.group(0)

    def mission_script(self, script):
        """The original game's script for Revision's: the same class without Revision's name in front when
        DeusEx.u has it (RevisionMission00: Mission00, RevisionMissionIntro: MissionIntro,
        RevisionMissionEndgame: MissionEndgame), else the one of the map's mission (settings.mission_script's
        rule: MissionNN, none for 07 and 13), else None."""
        own = re.sub(r'(?i)^rev(?:ision)?', '', script.split('.')[-1])
        names = [own] if own.lower().startswith('mission') and own.lower() != 'missionscript' else []
        if self.mission is not None and self.mission >= 0:
            names.append('Mission%02d' % self.mission)
        for name in names:
            path = self.orig.class_path(name)
            if path and path.split('.')[0].lower() == 'deusex':
                return "Class'%s'" % path
        return 'None'

    def look(self, cls, new, have):
        """What the Revision class changes for its objects (its defaults against those of the class taking
        its place, both as Revision has them) that the actor does not set itself: its look, its collision,
        and the properties the original class declares below Actor."""
        rev, van = self.rev_def.get(cls.lower(), {}), self.van_def.get(new.lower(), {})
        base = self.rev_def.get(new.lower()) or van
        out = []
        for prop in sorted(set(rev) & set(van), key=str.lower):
            if self.clash(cls, new, prop):
                continue
            for i, (kind, value) in sorted(rev[prop].items()):
                if (prop.lower(), i) in have or value == base.get(prop, {}).get(i, (kind, None))[1]:
                    continue
                text, gone = self.value(_quote(kind, value), '%s.%s (class default)' % (cls, prop))
                if not gone and text != _quote(kind, van[prop].get(i, (kind, ''))[1]):
                    out.append('    %s%s=%s' % (prop, '(%d)' % i if len(rev[prop]) > 1 else '', text))
        return out


# ------------------------------------------------------------------------------------------ song, own textures
def _song(game, names):
    """The song of the original map of the same name (Maps\\<name>.dx: LevelInfo.Song), else the most common
    song of the original maps of the same place (the longest common name: 06_HongKong_WanChai_...):
    ('Package.Name', from where) or (None, why)."""
    maps, music = game / 'Maps', game / 'Music'

    def song_of(f):
        try:
            pkg = _pkg(f)
            i = next(i for i, e in enumerate(pkg.exports) if pkg.classname(e) == 'LevelInfo')
            value = {n: v for n, _t, _a, v in pkg.props(i + 1)}.get('Song')
            parts = _path(pkg, value[1]) if isinstance(value, tuple) and value[1] else None
        except Exception:               # a map the package reader does not understand: no song from it
            return None
        return '.'.join(parts) if parts and (music / (parts[0] + '.umx')).is_file() else None

    for name in names:
        song = song_of(maps / (name + '.dx')) if (maps / (name + '.dx')).is_file() else None
        if song:
            return song, 'the original %s' % name
    originals = sorted(maps.glob('*.dx'))
    for name in names:
        words = name.split('_')
        for n in range(len(words) - 1, 1, -1):
            prefix = '_'.join(words[:n]).lower()
            found = collections.Counter(s for s in (song_of(f) for f in originals
                                                    if f.stem.lower().startswith(prefix + '_')) if s)
            if found:
                return found.most_common(1)[0][0], 'the original maps %s_*' % '_'.join(words[:n])
    return None, 'no original map of the same name or place'


def _own_textures(source):
    """The map's own textures (MyLevel): (commands for Revision's run that write them as pictures,
    [(picture, name, group, flags, scale)] to import in the original game's run)."""
    export, imports = [], []
    for cls, path, index in source.own:
        if cls != 'Texture':
            continue
        values = {n: source.pkg.pval(v) for n, _t, _a, v in source.pkg.props(index)}
        parts = path.split('.')
        flags = int(values.get('PolyFlags') or 0) | (2 if values.get('bMasked') else 0)
        if int(values.get('Format') or TEXF_P8) == TEXF_P8:
            picture = 'own_%s.bmp' % parts[-1]
            export.append(r'OBJ EXPORT TYPE=Texture NAME=%s FILE="..\Output\%s"' % (path, picture))
        else:                       # compressed or true colour: the host decodes it, PIL makes it 8-bit
            picture = 'own_%s.raw' % parts[-1]
            export.append(r'UC_TEXDUMP %s ..\Output\%s 1024' % (path, picture))
        group = parts[1] if len(parts) > 2 else ''
        imports.append((picture, parts[-1], group, flags, float(values.get('DrawScale') or 1)))
    return export, imports


def _picture(src, dst_dir):
    """The exported picture as a file TEXTURE IMPORT reads (8-bit BMP or PCX), or None."""
    if not src.is_file() or not src.stat().st_size:
        return None
    if src.suffix.lower() == '.bmp':
        shutil.copy2(src, dst_dir / src.name)
        return dst_dir / src.name
    try:
        from PIL import Image
        data = src.read_bytes()
        head, body = data.split(b'\n', 1)
        _tag, w, h = head.split()
        image = Image.frombytes('RGBA', (int(w), int(h)), body[:int(w) * int(h) * 4]).convert('RGB').quantize(256)
        out = dst_dir / (src.stem + '.pcx')
        image.save(out)
        return out
    except Exception:
        return None


# ------------------------------------------------------------------------------------------ the conversion
def revision_to_vanilla(src, new_name, log=print, runtime=None, textures=None):
    """A converted copy of the Revision map `src`, named `new_name`, that the original game loads:
    (bytes of the .dx, report). `runtime`: packages built for the original game whose classes the copy keeps
    (a DeusEdix project's own package: its objects stay its own); by default this project's own package
    when the project is for the original game and it is built, else none. `textures`: {Revision texture path:
    original texture path} chosen by hand, used before the closest-by-name guess (neon signs, logos)."""
    t_start = time.time()
    src = Path(src)
    if not src.is_file():
        raise ValueError('Map not found: %s' % src)
    if not NAME.fullmatch(str(new_name or '')):
        raise ValueError('Invalid map name: up to 64 letters, numbers, underscores or hyphens.')
    game = _require()
    if runtime is None:
        own = settings.PROJECT / 'dist' / (settings.PACKAGE + '.u')
        runtime = [own] if settings.TARGET == 'vanilla' and own.is_file() else []
    runtime = [Path(p) for p in runtime]
    seconds, folders = {}, []
    try:
        # 1. Revision: the map as text, the defaults of its classes, its own textures as pictures
        _say(log, 'Reading %s in Deus Ex: Revision' % src.name)
        t = time.time()
        try:
            source = Source(src)
        except Exception as e:      # ue1pkg on a damaged or foreign file
            raise ValueError('%s is not a Deus Ex map package that can be read (%s).' % (src.name, e)) from e
        if not any(source.pkg.classname(e) == 'Level' for e in source.pkg.exports):
            raise ValueError('%s has no level in it: it is not a map.' % src.name)
        original = Original(runtime)
        # the properties whose class defaults count: the look, and what the original classes that can take
        # a Revision class's place (its ancestors the original game has) declare below Actor
        ancestors = {a for c in source.class_package if not original.class_path(c) for a in source.below_actor(c)}
        props = set(CARRIED).union(*[original.properties(a, stop='Actor') for a in ancestors if original.class_path(a)])
        rev = _run(game, 'revision', 'export-' + new_name, extra_paths=[src.parent / '*.u'])
        folders.append(rev)
        shutil.copy2(src, rev / 'Input' / 'source.dx')
        own_export, own_import = _own_textures(source)
        rev_cmds, rev_files = _defaults_commands(props, 'revdefaults')
        export_log = _execute(rev, [r'MAP LOAD FILE="..\Input\source.dx"', r'MAP EXPORT FILE="..\Output\source.t3d"']
                              + rev_cmds + own_export, 'export.log', timeout=1800)
        bad = FAILED.findall(export_log)
        if bad or not (rev / 'Output' / 'source.t3d').is_file():
            raise ValueError('Deus Ex: Revision could not load %s: %s'
                             % (src.name, '; '.join(b.strip() for b in bad[:3])))
        text = _read_t3d(rev / 'Output' / 'source.t3d')
        rev_defaults = _defaults(rev, rev_files)
        head, actors, tail = _split(text)
        if not actors:
            raise RuntimeError('Deus Ex: Revision exported no objects of %s (log: %s)' % (src.name, rev / 'export.log'))
        seconds['export'] = round(time.time() - t, 1)

        # 2. the original game's classes and their defaults; the text rewritten
        _say(log, 'Rewriting %d objects for the original game' % len(actors))
        t = time.time()
        van = _run(game, 'vanilla', 'build-' + new_name, packages=runtime)
        folders.append(van)
        van_cmds, van_files = _defaults_commands(props, 'vandefaults')
        _execute(van, ['MAP NEW'] + ['OBJ LOAD FILE="%s"' % p.name for p in runtime]
                 + [r'UC_CLASSES ..\Output\classes.txt'] + van_cmds, 'classes.log', timeout=1800)
        classes = _classes(van / 'Output' / 'classes.txt')
        own_packages = {p.stem.lower() for p in runtime}
        song, song_from = _song(game, list(dict.fromkeys([src.stem, new_name])))
        rw = Rewrite(source, original, classes, rev_defaults, _defaults(van, van_files), new_name, song,
                     [c['name'] for c in classes.values() if c['package'].lower() in own_packages], textures)
        own_cmds = []
        for picture, name, group, flags, scale in own_import:
            f = _picture(rev / 'Output' / picture, van / 'Input')
            if f is None:
                rw.warnings.append('the map\'s own texture %s could not be read: an original texture takes its '
                                   'place' % name)
                continue
            rw.own.add(name.lower())
            own_cmds.append(r'TEXTURE IMPORT FILE="..\Input\%s" NAME=%s%s PACKAGE=MyLevel MIPS=1 FLAGS=%d'
                            % (f.name, name, ' GROUP=%s' % group if group else '', flags))
            if abs(scale - 1) > 1e-6:
                own_cmds.append('UC_OBJPROP %s DrawScale %.6f' % (name, scale))
        left = sorted({p for c, p, _i in source.own if c != 'Texture' or p.split('.')[-1].lower() not in rw.own})
        if left:
            rw.warnings.append('the map\'s own objects the copy cannot carry (only its plain textures): '
                               + ', '.join(left))
        level = next((lines for c, _n, lines in actors
                      if 'deusexlevelinfo' in [x.lower() for x in [c] + source.supers(c)]), [])
        number = next((m.group(4).strip() for _i, m in _top(level) if m.group(2).lower() == 'missionnumber'), '')
        rw.mission = int(number) if re.fullmatch(r'-?\d+', number) else None
        rw.fates(actors)
        blocks = [rw.actor(c, n, lines) for c, n, lines in actors]
        t3d = '\r\n'.join(head + [line for b in blocks if b for line in b] + tail) + '\r\n'
        (van / 'T3D' / 'map.t3d').write_bytes(_t3d_bytes(t3d))
        seconds['rewrite'] = round(time.time() - t, 1)

        # 3. the original game: the map made again from the text, built as the editor builds a map
        _say(log, 'Building %s for the original game' % new_name)
        t = time.time()
        cmds = ['MAP NEW'] + ['OBJ LOAD FILE="%s"' % p.name for p in runtime]
        cmds += ['OBJ LOAD FILE="%s"' % original.files[p.lower()].name for p in sorted(rw.loads, key=str.lower)
                 if p.lower() in original.files]
        cmds += own_cmds + [r'MAP IMPORT FILE="..\T3D\map.t3d"']
        cmds += ['UC_MOVER prep %s 1 1 1' % n for n in rw.movers]
        # the map's points are linked on the floor and put back (host UC_NAVDROP temp / UC_NAVLIFT): PATHS DEFINE
        # alone links none floating more than about 20 units over the floor, as most of the original maps' are
        cmds += ['MAP REBUILD', 'BSP REBUILD OPTIMAL BALANCE=15', 'UC_WORLD finish', 'UC_ACTORS check',
                 'UC_NAVDROP temp', 'PATHS DEFINE', 'UC_NAVLIFT', 'LIGHT APPLY', 'UC_CAMERAS clear', r'MAP SAVE FILE="..\Output\%s.dx"' % new_name]
        build_log = _execute(van, cmds, 'build.log', timeout=3600)
        out = van / 'Output' / (new_name + '.dx')
        if not out.is_file():
            raise RuntimeError('The original game\'s editor did not save the map (log: %s)' % (van / 'build.log'))
        seconds['build'] = round(time.time() - t, 1)
        ignored = collections.Counter('%s.%s' % (c, p) for c, p in re.findall(
            r'(?m)^\w+\.(\w+): Unknown property in defaults:\s+(\w+)', build_log))
        if ignored:
            rw.warnings.append('properties the original game\'s classes have not (left out by the import): '
                               + ', '.join('%s x%d' % kv if kv[1] > 1 else kv[0] for kv in sorted(ignored.items())))
        buried = [b.split('|')[1] for b in re.findall(r'UCMapKit\|in solid\|(.*)', build_log)]
        if buried:
            rw.warnings.append('%d objects inside solid geometry after the rebuild: %s%s' % (
                len(buried), ', '.join(buried[:12]), ' ...' if len(buried) > 12 else ''))
        rw.warnings += ['the import or the rebuild said: ' + b.strip() for b in FAILED.findall(build_log)[:10]]

        # 4. checked: what the original game would miss, then a load in a fresh run of the original game
        _say(log, 'Checking %s in the original game' % new_name)
        t = time.time()
        check = gamecheck.check(out, 'vanilla', own=[p.stem for p in runtime])
        test = _run(game, 'vanilla', 'check-' + new_name, packages=runtime)
        folders.append(test)
        shutil.copy2(out, test / 'Input' / out.name)
        load_log = _execute(test, [r'MAP LOAD FILE="..\Input\%s"' % out.name, r'MAP EXPORT FILE="..\Output\check.t3d"'],
                            'load.log', timeout=1800)
        load_errors = [b.strip() for b in FAILED.findall(load_log)]
        _h, after, _t = _split(_read_t3d(test / 'Output' / 'check.t3d'))
        seconds['check'] = round(time.time() - t, 1)
        if not check['loads'] or load_errors:
            raise RuntimeError('The converted copy of %s does not load in the original game: %s' % (src.name, '; '.join(
                ['%s (%s)' % (m['package'], ', '.join(m['objects'][:5])) for m in check['missing']] + load_errors[:5])
                or 'package version %d' % check['version']))
        # the lighting build's view (a Camera) is cleared on purpose; the original game's AI path build
        # removes Revision's InventorySpot markers (the original maps have none)
        dropped = {n for n, (c, _w) in rw.actors.items()
                   if c and c not in ('Camera', 'InventorySpot')} - {n.lower() for _c, n, _l in after}
        if dropped:
            rw.warnings.append('%d objects did not come through the import: %s'
                               % (len(dropped), ', '.join(sorted(dropped)[:12])))
        world = re.findall(r'UCMapKit\|world\|(.*)', build_log)
        report = dict(
            ok=True, source=str(src), name=new_name,
            actors_before=len(actors), actors_after=len(after),
            brushes_before=sum(1 for c, _n, _l in actors if c == 'Brush'),
            brushes_after=sum(1 for c, _n, _l in after if c == 'Brush'),
            replaced_classes=dict(sorted(rw.replaced.items(), key=lambda kv: kv[0].lower())),
            cleared_references=['%s x%d' % (k, n) if n > 1 else k for k, n in sorted(rw.cleared.items())],
            retextured=dict(sorted(rw.retextured.items(), key=lambda kv: kv[0].lower())),
            replaced_references=dict(sorted(rw.renamed.items(), key=lambda kv: kv[0].lower())),
            removed=rw.removed, dropped_properties=dict(sorted(rw.dropped.items())),
            ignored_properties=dict(sorted(ignored.items())),
            song=song, song_from=song_from, script=rw.script, world=world[-1] if world else None,
            gamecheck=dict(loads=check['loads'], version=check['version'], missing=check['missing']),
            loads_in_original_editor=not load_errors, load_errors=load_errors[:10],
            warnings=rw.warnings, seconds=dict(seconds, total=round(time.time() - t_start, 1)))
        _say(log, 'Converted %s in %.0f s: %d objects (%d before), %d classes replaced, %d references cleared, '
                  '%d textures replaced' % (new_name, report['seconds']['total'], len(after), len(actors),
                                            len(rw.replaced), sum(rw.cleared.values()),
                                            len(rw.retextured)))
        return out.read_bytes(), report
    finally:
        _pkgs.clear()
        for f in folders:
            _remove(f, log)
