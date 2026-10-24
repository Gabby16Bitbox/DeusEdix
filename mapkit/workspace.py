"""DeusEdix's own setup, build and install: what setup.ps1, build.ps1 and install.ps1 do for UNATCO
Continues, in Python, for the installed editor (no PowerShell, no SDK).

  ensure(log)   the workspace (DevInstall): the targeted game's System (hard links, or copies on another
                disk; settings.TARGET), for Revision with the editor engine (Editor.dll) and the retail
                packages from Deus Ex's System, links to the game's asset folders, ini files that read the
                game's maps where they are;
  build(log)    compiles the editor's package (src\\<PACKAGE>\\Classes) with the host (--make) into dist\\;
  install(log)  the packages in dist\\ and the maps in maps\\ into Revision\\DeusEdixMaps, which the game
                reads first (Paths lines in Revision.ini; a backup of it the first time).

Nothing here runs inside the UNATCO Continues working copy: there setup.ps1 / build.ps1 / install.ps1 do it.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import settings  # noqa: E402

PROJECT = settings.PROJECT
DEV = PROJECT / 'DevInstall'
SYS = DEV / 'System'
SRC = PROJECT / 'src' / settings.PACKAGE
DIST = PROJECT / 'dist'
MAPS = PROJECT / 'maps'
HOST = PROJECT / 'tools' / 'mapkit' / 'bin' / 'UCMapKitHost.exe'
STAMP = DEV / 'workspace.json'
# DeusEdixNav (native/README.md): the walkable area's routes in C++, a package the editor's package uses
NATIVE = tuple(HOST.with_name(n) for n in ('DeusEdixNav.u', 'DeusEdixNav.dll'))
COMPILE_LOG = (PROJECT / 'logs' if settings.STANDALONE else DEV) / 'compile.log'    # logs\ is the installed program's
VERSION = 4               # 4: DeusEdixNav in the workspace, compiled before the editor's package
# the retail packages the editor engine needs and Revision does not ship (setup.ps1)
RETAIL = ('Editor', 'Fire', 'UBrowser', 'UWindow', 'MPCharacters', 'IpServer', 'Core')
# Revision's asset folders, read in place through links
LINKED = ('Sounds', 'Textures', 'NewVision', 'HDTP', 'Music')
# DeusEdix's packages, installed into the maps folder (read before Revision's own folders)
PACKAGES = (settings.PACKAGE, settings.ANIMS_PACKAGE, settings.MODELS_PACKAGE, settings.SOUNDS_PACKAGE, settings.SCRIPTS_PACKAGE)
# files of Revision\System that are not Revision's: other mods, logs, screenshots, backups
_NOT_THEIRS = re.compile(r'(?i)^(unatco|uc[A-Z_]|ucl|deusedix|DXP_)|\.log$|\.bak|^shot\d+\.bmp$|\.tmp$')


def _log(log, *a):
    (log or print)(' '.join(str(x) for x in a))


def _stamp():
    st = settings.GAME_EXE.stat()
    stamp = dict(version=VERSION, game=str(settings.GAME), revision=[st.st_size, int(st.st_mtime)], package=settings.PACKAGE)
    if not settings.IS_REVISION:            # Revision's stamp stays as it was (no rebuild of existing workspaces)
        stamp['target'] = settings.TARGET
    return stamp


def ready():
    try:
        return json.loads(STAMP.read_text(encoding='utf-8')) == _stamp() and (SYS / 'DeusEx.ini').is_file()
    except (OSError, ValueError):
        return False


def runtime_fingerprint():
    """Content, not timestamps: an installer may restore an older file date."""
    digest = hashlib.sha256()
    files = sorted((p for p in SRC.rglob('*') if p.is_file()), key=lambda p: str(p.relative_to(SRC)))
    bridge = HOST.with_name('UCEngineBridge.dll')       # the host's engine bridge (host/README.md)
    native = [f for f in NATIVE if f.is_file()]
    for path in files + [HOST] + ([bridge] if bridge.is_file() else []) + native + [STAMP]:
        name = str(path.relative_to(SRC)) if path in files else path.name
        digest.update(name.encode('utf-8') + b'\0')
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def needs_build():
    """First launch and upgrades must compile the current sources, including local indexes."""
    try:
        saved = json.loads((DIST / 'runtime-build.json').read_text(encoding='utf-8'))
        package = DIST / (settings.PACKAGE + '.u')
        return (saved['sources'] != runtime_fingerprint() or
                saved['package'] != hashlib.sha256(package.read_bytes()).hexdigest())
    except (OSError, ValueError, KeyError, TypeError):
        return True


def _link_or_copy(src, dst):
    if dst.exists():
        dst.unlink()
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def _junction(link, target):
    if os.path.lexists(link):
        return
    import _winapi
    _winapi.CreateJunction(str(target), str(link))


def _compiler_sources():
    """A verified physical source snapshot: the legacy compiler need not follow junctions.

    Only this private snapshot is synchronized. Authored SRC is strictly read-only here.
    """
    root = DEV / settings.PACKAGE
    marker = root / '.deusedix-compiler-sources.json'
    if os.path.lexists(root) and getattr(root.lstat(), 'st_file_attributes', 0) & 1024:
        if root.resolve() != SRC.resolve():
            raise ValueError('Unexpected compiler source link; it was preserved: ' + str(root))
        os.rmdir(root)  # Remove the exact junction only, never its target.
    root.mkdir(parents=True, exist_ok=True)
    if marker.exists():
        previous = json.loads(marker.read_text(encoding='utf-8'))
        if previous.get('version') != 1 or previous.get('source') != str(SRC.resolve()):
            raise ValueError('Unexpected compiler source snapshot; it was preserved: ' + str(root))
        owned = previous.get('files', {})
    else:
        if any(root.iterdir()):
            raise ValueError('An unrecognized compiler source folder was preserved: ' + str(root))
        owned = {}
        marker.write_text(json.dumps(dict(version=1, source=str(SRC.resolve()), files={})), encoding='utf-8')
    if not isinstance(owned, dict) or any(not isinstance(k, str) or not k or
            '\\' in k or ':' in k or k.startswith('/') or '..' in Path(k).parts or
            not isinstance(v, str) or not re.fullmatch(r'[a-f0-9]{64}', v) for k, v in owned.items()):
        raise ValueError('Invalid compiler source snapshot manifest.')
    files = {}
    for source in sorted(SRC.rglob('*')):
        if source.is_symlink() or getattr(source.lstat(), 'st_file_attributes', 0) & 1024:
            raise ValueError('Compiler source snapshots cannot follow linked assets: ' + str(source))
        if not source.is_file():
            continue
        rel = source.relative_to(SRC).as_posix()
        content = source.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        target = root / rel
        for part in (target, *target.parents):
            if part == root:
                break
            if os.path.lexists(part) and getattr(part.lstat(), 'st_file_attributes', 0) & 1024:
                raise ValueError('Compiler snapshot contains a linked path: ' + str(part))
        current = hashlib.sha256(target.read_bytes()).hexdigest() if target.is_file() else None
        if current is not None and current not in (owned.get(rel), digest):
            raise ValueError('A modified compiler snapshot file was preserved: ' + str(target))
        if current != digest:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        files[rel] = digest
    if not any(k.startswith('Classes/') and k.endswith('.uc') for k in files):
        raise ValueError('No runtime source classes found in ' + str(SRC))
    for rel, digest in owned.items():
        if rel in files:
            continue
        target = root / rel
        for part in (target, *target.parents):
            if part == root:
                break
            if os.path.lexists(part) and getattr(part.lstat(), 'st_file_attributes', 0) & 1024:
                raise ValueError('Compiler snapshot contains a linked path: ' + str(part))
        if target.is_file() and not getattr(target.lstat(), 'st_file_attributes', 0) & 1024:
            if hashlib.sha256(target.read_bytes()).hexdigest() == digest:
                target.unlink()
    pending = marker.with_suffix('.pending')
    pending.write_text(json.dumps(dict(version=1, source=str(SRC.resolve()), files=files)), encoding='utf-8')
    pending.replace(marker)


def _folder(line):
    """The folder of a Paths= line, absolute and comparable (a relative one is the game's System's)."""
    path = Path(line.strip()[6:])
    if not path.is_absolute():
        path = settings.GAME_SYSTEM / path
    return os.path.normcase(os.path.normpath(str(path.parent)))


def _ini(text):
    """Revision.ini for the workspace: the game's maps read where they are, the base game's folders
    absolute, saves inside the workspace, the editor's package compiled with the others."""
    rev, game = settings.REVISION, settings.GAME
    out = []
    lines = text.splitlines()
    import project_game
    for line in lines:
        if getattr(settings, 'MANAGED_PROJECT', False):
            if project_game.owned_path(line) or project_game.owned_actor(line):
                continue
        # the folder the editor installs into holds the game's copies of its packages: the engine looks for a
        # package in every Paths folder whatever the line's extension, so even its *.dx line made the compiler
        # load the old DeusEdix.u from there instead of making the new one (0.1.37: 'Success', no package)
        elif project_game.owned_path(line) and _folder(line) == _folder('Paths=%s\*.u' % settings.MAPS_DIR):
            continue
        if line.startswith('EditPackages='):
            continue
        if line.lower().startswith('paths='):
            value = line[6:].strip()
            if value.lower().startswith('..\\maps\\'):
                out += ['Paths=%s\\*.dx' % MAPS, 'Paths=%s\\Maps\\*.dx' % rev]
            elif value.lower() == '..\\system\\*.u':
                # Keep the private editor engine/packages ahead of the game copies.
                out.append('Paths=%s\\*.u' % SYS)
            else:
                path = Path(value)
                if not path.is_absolute():
                    path = settings.GAME_SYSTEM / path
                out.append('Paths=' + os.path.normpath(str(path)))
        elif line.lower().startswith('savepath='):
            out.append('SavePath=..\\Save')
        else:
            out.append(line)
        if line.strip() == '[Editor.EditorEngine]':
            names = [l[13:].strip() for l in lines if l.startswith('EditPackages=')]
            names = [n for n in names if n != settings.PACKAGE and (SYS / (n + '.u')).exists()]
            native = ['DeusEdixNav'] if (SYS / 'DeusEdixNav.u').exists() else []     # loaded before the package using it
            out += ['EditPackages=' + n for n in names + native + [settings.PACKAGE]]
    # the maps the user installed are looked for first, then the base game's music (make-ini.ps1)
    for i, line in enumerate(out):
        if line.startswith('Paths='):
            out[i:i] = ['Paths=%s\\*.dx' % MAPS, 'Paths=%s\\Music\\*.umx' % game]
            break
    return '\r\n'.join(out) + '\r\n'


def ensure(log=None, force=False):
    """Make or refresh the workspace. True when it is ready."""
    missing = settings.check_game(settings.GAME, settings.TARGET)
    if missing:
        _log(log, 'Game folder %s: missing %s' % (settings.GAME, ', '.join(missing)))
        return False
    if ready() and not force:
        return True
    rev_sys = settings.GAME_SYSTEM
    _log(log, 'Preparing the workspace from', rev_sys)
    SYS.mkdir(parents=True, exist_ok=True)
    count = 0
    for src in rev_sys.rglob('*'):
        rel = src.relative_to(rev_sys)
        if src.is_dir() or _NOT_THEIRS.search(src.name):
            continue
        dst = SYS / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.suffix.lower() == '.ini':
            shutil.copy2(src, dst)            # ini files are rewritten: never a link to the game's
        else:
            _link_or_copy(src, dst)
        count += 1
    if settings.IS_REVISION:            # the original game's System has them already (linked above)
        shutil.copy2(settings.GAME / 'System' / 'Editor.dll', SYS / 'Editor.dll')
        for name in RETAIL:
            f = settings.GAME / 'System' / (name + '.u')
            if f.is_file():
                shutil.copy2(f, SYS / f.name)
    for name in LINKED:
        if (settings.REVISION / name).is_dir():
            _junction(DEV / name, settings.REVISION / name)
    for name in ('Save', 'Maps'):
        (DEV / name).mkdir(exist_ok=True)
    SRC.mkdir(parents=True, exist_ok=True)
    if getattr(settings, 'MANAGED_PROJECT', False):
        _compiler_sources()
    else:
        _junction(DEV / settings.PACKAGE, SRC)
    _copy_native()
    ini = _ini(settings.GAME_INI.read_text(encoding='latin1'))
    for name in dict.fromkeys((settings.GAME_INI.name, 'DeusEx.ini', 'Default.ini')):
        (SYS / name).write_text(ini, encoding='latin1', newline='')
    for a, b in (('RevisionUser.ini', 'User.ini'), ('RevisionDefault.ini', 'Default.ini'), ('RevisionDefUser.ini', 'DefUser.ini')):
        if (rev_sys / a).is_file() and not (b == 'Default.ini'):
            shutil.copy2(rev_sys / a, SYS / b)
    STAMP.write_text(json.dumps(_stamp()), encoding='utf-8')
    _log(log, 'Workspace ready: %d files from %s' % (count, settings.GAME_NAME))
    return True


def _copy_native():
    """The newest DeusEdixNav.u and its DLL into the workspace's System: the compiler loads the package, and binds its
    native function to the DLL, before the editor's package."""
    for f in NATIVE:
        if not f.is_file():
            raise FileNotFoundError('%s is missing: DeusEdix is not complete (reinstall it)' % f.name)
        if not (SYS / f.name).is_file() or (SYS / f.name).read_bytes() != f.read_bytes():
            (SYS / f.name).unlink(missing_ok=True)
            shutil.copy2(f, SYS / f.name)


def build(log=None):
    """Compile the editor's package: (ok, lines). The compiler's whole output is kept in COMPILE_LOG.

    Retry transient compiler failures, but never repeat an identical missing-dependency error.
    Full diagnostics stay in COMPILE_LOG rather than being repeated in the tutorial dialog."""
    lines = []
    say = lambda *a: (lines.append(' '.join(str(x) for x in a)), _log(log, *a))
    if not ensure(say):
        return False, lines
    if getattr(settings, 'MANAGED_PROJECT', False):
        _compiler_sources()
    _copy_native()
    fingerprint = runtime_fingerprint()
    target = SYS / (settings.PACKAGE + '.u')
    COMPILE_LOG.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        if attempt:
            say('the compile failed, trying again (%d of 3)' % (attempt + 1))
            time.sleep(5)
        target.unlink(missing_ok=True)
        host = SYS / HOST.name
        bridge = HOST.with_name('UCEngineBridge.dll')   # the host's engine bridge (host/README.md)
        shutil.copy2(HOST, host)
        if bridge.is_file():
            shutil.copy2(bridge, SYS / bridge.name)
        t0 = time.time()
        try:
            r = subprocess.run([str(host), '--make', 'DeusEx.ini'], cwd=str(SYS), capture_output=True, text=True,
                               encoding='utf-8', errors='replace', timeout=1800, stdin=subprocess.DEVNULL,
                               creationflags=subprocess.CREATE_NO_WINDOW)
        finally:
            host.unlink(missing_ok=True)
            (SYS / bridge.name).unlink(missing_ok=True)
        text = (r.stdout or '') + (r.stderr or '')
        with COMPILE_LOG.open('w' if not attempt else 'a', encoding='utf-8') as f:
            f.write('==== %s, attempt %d, exit code %s, %.1f s\n%s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), attempt + 1,
                                                                    r.returncode, time.time() - t0, text))
        if r.returncode == 0 and target.is_file():
            break
        if re.search(r"Can't find files matching .*Classes", text, re.IGNORECASE):
            return False, ['The compiler could not read its runtime source classes. No repeated retries were started.',
                           'Compiler log: %s' % COMPILE_LOG]
        missing = re.findall(r"Can't find file for package '([^']+)'", text, re.IGNORECASE)
        missing = list(dict.fromkeys(n for n in missing if n.lower().removesuffix('.u') != settings.PACKAGE.lower()))
        if missing:
            return False, ['Missing game dependency: %s. Check the game files in %s.' % (', '.join(missing), settings.GAME_ROOT),
                           'Compiler log: %s' % COMPILE_LOG]
    # "Failed to load '<package>.u'" is normal (the package being made): only the other failures
    own = settings.PACKAGE.lower() + '.u'
    lines += [l for l in text.splitlines() if re.search(r'(?i)error|warning|success|failure|critical|failed|can.t', l)
              and own not in l.lower()][-40:]
    if r.returncode != 0 or not target.is_file():
        return False, lines + ['the package was not built (exit code %s); the compiler\'s output: %s' % (r.returncode, COMPILE_LOG)]
    DIST.mkdir(exist_ok=True)
    shutil.copy2(target, DIST / target.name)
    stamp = DIST / 'runtime-build.json'
    pending = stamp.with_suffix('.tmp')
    pending.write_text(json.dumps(dict(sources=fingerprint,
                                     package=hashlib.sha256((DIST / target.name).read_bytes()).hexdigest())),
                       encoding='utf-8')
    pending.replace(stamp)
    say('OK: dist\\%s' % target.name)
    return True, lines


def _ini_paths(text, add):
    """The game's ini with `add` (Paths lines) first in its lists of folders: Revision.ini's [Core.System]
    (the editor) and [RevisionInternal.LaunchSystem] (what the game started by Revision.exe reads), the
    original game's [Core.System] (settings.INI_SECTIONS)."""
    changed = []
    for section in settings.INI_SECTIONS:
        m = re.search(r'\[' + re.escape(section) + r'\][^\[]*', text)
        if not m:
            continue
        block = m.group(0)
        new = [a for a in add if not re.search(r'(?im)^' + re.escape(a) + r'\s*$', block)]
        if not new:
            continue
        first = re.search(r'(\r?\n)(Paths=)', block)
        if not first:
            continue
        nl = first.group(1)
        block2 = block[:first.start()] + ''.join(nl + a for a in new) + block[first.start():]
        text = text[:m.start()] + block2 + text[m.end():]
        changed.append(section)
    return text, changed


def paths_lines():
    folder = settings.MAPS_DIR_NAME.replace('/', '\\')
    return ['Paths=..\\%s\\*.%s' % (folder, x) for x in ('dx', 'u', 'utx', 'uax', 'umx')]


def activate():
    """Select this campaign without copying or removing another project's files."""
    import project_game
    return project_game.activate(paths_lines())


def install(log=None, *, maps=True, activate_project=True):
    """Install runtime packages and, by default, project maps: (ok, lines).

    Play uses maps=False and activate_project=False, then stages its selected map.
    Its owned launch activates the project and restores that configuration at Stop.
    This also serves the source checkout without install.ps1 copying unrelated maps.
    """
    lines = []
    say = lambda *a: (lines.append(' '.join(str(x) for x in a)), _log(log, *a))
    exe = settings.PROFILE['exe']           # Revision.exe, or the original game's DeusEx.exe
    r = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq ' + exe], capture_output=True, text=True,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    if exe in r.stdout:
        return False, ['Close %s before installing.' % settings.PROFILE['short']]
    dest = settings.MAPS_DIR
    dest.mkdir(parents=True, exist_ok=True)
    packages = PACKAGES + (('UnatcoVoices',) if not settings.STANDALONE and settings.PACKAGE == 'UnatcoContinues' else ())
    for name in packages:
        f = DIST / (name + '.u')
        if not f.is_file() and not settings.STANDALONE:
            f = PROJECT / 'release' / (name + '.u')
        if f.is_file():
            shutil.copy2(f, dest / f.name)
            say('installed %s' % f.name)
    if not (dest / (settings.PACKAGE + '.u')).is_file():
        return False, lines + ['%s.u is not built yet' % settings.PACKAGE]
    # DeusEdixNav, the package the editor's package uses: its DLL works only in the game's own System folder
    import kit
    for name in kit.install_native(settings.GAME_SYSTEM, NATIVE):
        say('installed %s in %s' % (name, settings.GAME_SYSTEM))
    # other mods' packages kept with the project (Packages panel, Import a mod): the game finds them next to the maps
    import kit
    for p in kit.extra_packages():
        f = Path(p.get('path') or '')
        if p.get('path') and f.is_file():
            for g in [f] + [x for x in f.parent.glob(f.stem + '.int')]:
                shutil.copy2(g, dest / g.name)
            say('installed %s' % f.name)
    if maps:
        for f in sorted(MAPS.glob('*.dx')):
            shutil.copy2(f, dest / f.name)
            say('installed map %s' % f.name)
    if activate_project:
        activate()
        say('Selected project %s.' % settings.current()['name'])
    say('Done.')
    return True, lines


def uninstall(log=None):
    """Take DeusEdix's lines out of the game's ini (the maps folder stays: the user's maps are in it)."""
    import project_game
    return project_game.deactivate()


def _is_link(path):
    """A junction or a symbolic link (a reparse point): removing it removes the link, never what it points to."""
    try:
        return bool(os.lstat(path).st_file_attributes & 0x400)      # FILE_ATTRIBUTE_REPARSE_POINT
    except (OSError, AttributeError):
        return False


def _rmtree(path):
    """shutil.rmtree that never goes through a link: Python 3.10 sees a junction as a folder and would
    delete what is inside it (here, Revision's own Textures, Sounds...)."""
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


def remove_workspace(log=None):
    """Delete the workspace and the caches made from the game (the uninstaller asks for it). The user's
    own work stays: maps, stories, characters, models, textures. The workspace's files are hard links
    or copies of Revision's: deleting them leaves the game's own files as they are."""
    kit = PROJECT / 'tools' / 'mapkit'
    for folder in (DEV, kit / 'runs', kit / 'out', kit / 'editor' / 'cache', kit / 'catalog'):     # catalog: the texture sizes read from the game
        if folder.is_dir() and not _is_link(folder):
            _rmtree(folder)
            _log(log, 'removed', folder)
    return True


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'ensure'
    if cmd == 'ensure':
        print(ensure(force='--force' in sys.argv))
    elif cmd == 'build':
        print(build())
    elif cmd == 'install':
        print(install())
    elif cmd == 'uninstall':
        print(uninstall())
