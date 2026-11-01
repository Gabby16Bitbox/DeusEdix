"""mapkit: private runs of the headless SDK editor (tools\\mapkit\\bin\\UCMapKitHost.exe).

Each run lives in tools\\mapkit\\runs\\<id> with its own System folder (hard links to the
DevInstall SDK files, the compiled mod from dist\\, adapted ini files), Input\\ and Output\\.
Nothing in the game folder or in maps\\ is written here.
"""
import array
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from contextlib import contextmanager, nullcontext

import atomicfile
import settings

PROJECT = Path(__file__).resolve().parents[2]
DEV = PROJECT / 'DevInstall' / 'System'
RUNS = PROJECT / 'tools' / 'mapkit' / 'runs'
HOST = PROJECT / 'tools' / 'mapkit' / 'bin' / 'UCMapKitHost.exe'

# the engine's and the game's packages every editor session loads (with Revision: Revision.u too)
EDIT_PACKAGES = ('Core', 'Engine', 'Editor', 'Extension', 'DeusExUI', 'ConSys', 'DeusEx') + settings.GAME_EDIT_PACKAGES
# packages of other mods the editor loads too (the map editor's Packages panel: editor/packages.py)
PACKAGES_FILE = PROJECT / 'tools' / 'mapkit' / 'packages.json'
# a map script built by the map editor's Rebuild, in a process of its own (editor/server.py build): its host runs name
# their log in the file this says, so the editor can show the build's stages (editor/build_job.py)
HOST_LOG_ENV = 'DEUSEDIX_HOST_LOG'


class Stopped(Exception):
    """A run stopped on purpose (the map editor's Cancel of a Rebuild): not a failure, never retried."""


class LogNote:
    """The watch of a map script's build (HOST_LOG_ENV): each host run's log named in the file, for the editor that
    started the script (it stops that process itself, so this one never stops a run)."""
    stopped = False

    def __init__(self, path):
        self.path = Path(path)

    def started(self, process, log):
        atomicfile.write_text(self.path, str(log))


def extra_packages():
    """[{'name': 'MyMod', 'path': ''}]: path empty when the game finds it (System, Revision\\System...),
    else the .u file (linked into every run)."""
    try:
        data = json.loads(PACKAGES_FILE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return []
    return [p for p in data.get('extra') or [] if re.fullmatch(r'\w+', str(p.get('name') or ''))
            and p['name'] not in EDIT_PACKAGES]


def rows(path):
    """A file the host wrote: one JSON value a line (host/README.md) -> the values, [] when there is no file."""
    path = Path(path)
    if not path.exists():
        return []
    with path.open(encoding='utf-8') as f:
        return [json.loads(line) for line in f if line.strip()]


ARRAY_TYPES = {'i32': 'i', 'u32': 'I', 'f64': 'd', 'u8': 'B'}


def arrays(path):
    """A bulk dump of the host (UC_BSPDUMP, UC_MESHES, UC_LIGHTDUMP): a JSON header line, then the arrays it lists,
    little endian, back to back (host/PROTOCOL.md) -> (header, {name: array.array}); ({}, {}) when there is no file."""
    path = Path(path)
    if not path.exists():
        return {}, {}
    raw = path.read_bytes()
    end = raw.index(b'\n')
    header = json.loads(raw[:end])
    data = memoryview(raw)
    out, at = {}, end + 1
    for entry in header['arrays']:
        values = array.array(ARRAY_TYPES[entry['type']])
        size = values.itemsize * entry['count']
        if at + size > len(data):
            raise ValueError('%s: the array %s is cut short' % (path.name, entry['name']))
        values.frombytes(data[at:at + size])
        if sys.byteorder == 'big':
            values.byteswap()
        out[entry['name']] = values
        at += size
    return header, out


def texdump(path):
    """A picture UC_TEXDUMP wrote: the JSON line {width, height}, then the RGBA pixels (host/PROTOCOL.md)
    -> (width, height, pixels). ValueError when the file is not one, OSError when there is no file."""
    head, _, pixels = Path(path).read_bytes().partition(b'\n')
    try:
        size = json.loads(head)
        w, h = int(size['width']), int(size['height'])
    except (ValueError, KeyError, TypeError):
        raise ValueError('%s: not a picture of UC_TEXDUMP' % Path(path).name) from None
    if w <= 0 or h <= 0 or len(pixels) < w * h * 4:
        raise ValueError('%s: the picture is cut short' % Path(path).name)
    return w, h, pixels[:w * h * 4]


def load_cmd(file):
    """The host command that loads a package: by name (found through the run's Paths) with OBJ LOAD, from a path
    with UC_LOADPKG (OBJ LOAD FILE= keeps only 80 characters of a path, UC_LOADPKG any)."""
    file = str(file)
    return 'UC_LOADPKG %s' % file if ('\\' in file or '/' in file) else 'OBJ LOAD FILE="%s"' % file


def is_code(p):
    """A package of classes (.u), loaded at startup; textures, sounds and music (.utx .uax .umx) are only found."""
    return Path(p.get('path') or 'x.u').suffix.lower() == '.u'


def _ini(system):
    text = (DEV / 'DeusEx.ini').read_text(encoding='latin1')
    out = []
    for line in text.splitlines():
        if line.startswith(('EditPackages=', 'AutoSave=', 'ServerActors=')):
            continue
        if line.startswith('Paths='):
            value = line[6:]
            path = Path(value) if Path(value).is_absolute() else (DEV / value)
            if path.suffix.lower() == '.dx':
                continue
            line = 'Paths=' + str(path.resolve()) if not Path(value).is_absolute() else line
        if line == '[Core.System]':
            # another mod's textures, sounds and music sit in the run's System folder too (Import a mod)
            out += [line, 'Paths=' + str(system / '*.u')] + ['Paths=' + str(system / ('*' + x)) for x in ('.utx', '.uax', '.umx')]
            continue
        if line == '[Editor.EditorEngine]':
            out += [line, 'AutoSave=False'] + ['EditPackages=' + p for p in EDIT_PACKAGES]
            out += ['EditPackages=' + p['name'] for p in extra_packages() if is_code(p)]      # loaded at startup: their classes
            if (system / (settings.SCRIPTS_PACKAGE + '.u')).exists():           # the editor's scripts (placed in maps)
                out.append('EditPackages=' + settings.SCRIPTS_PACKAGE)
            continue
        out.append(line)
    return '\n'.join(out) + '\n'


def prune(keep=20):
    """Delete all but the newest private runs (their System files are mostly hard links; a run
    still in use keeps its locked files and is skipped)."""
    if not RUNS.exists():
        return
    runs = sorted((d for d in RUNS.iterdir() if d.is_dir()), key=lambda d: d.name)
    for d in runs[:-keep]:
        import resident_build
        if resident_build.run_in_use(d):
            continue
        shutil.rmtree(d, ignore_errors=True)


def host_files():
    """The host, its engine bridge and the bridge's settings next to it (host/README.md); a host without them (an
    older build) runs alone, a bridge without its settings with its defaults."""
    extra = [HOST.with_name(n) for n in ('UCEngineBridge.dll', 'UCEngineBridge.ini')]
    return [HOST] + [f for f in extra if f.is_file()]


NATIVE = ('DeusEdixNav.u', 'DeusEdixNav.dll')      # the walkable area's routes in C++ (native/README.md)


def native_files():
    """DeusEdixNav.u and its DLL, next to the host (native/build_native.ps1, build_package.py): the editor's package
    uses them, so every engine that loads it needs them."""
    return [HOST.with_name(n) for n in NATIVE if HOST.with_name(n).is_file()]


def install_native(system, files=None):
    """DeusEdixNav.u and DeusEdixNav.dll (files: these paths instead of native_files()) into a game's System folder,
    the one with its program: the engine looks for a package's DLL there and nowhere else. Always DeusEdix's own
    build: a mod file never carries a DLL. -> the names written."""
    files = [Path(f) for f in files if Path(f).is_file()] if files is not None else native_files()
    if len(files) != len(NATIVE):
        raise FileNotFoundError('DeusEdixNav is not built: tools\\mapkit\\native\\build_native.ps1, build_package.py')
    written = []
    for f in files:
        target = Path(system) / f.name
        if not target.is_file() or target.read_bytes() != f.read_bytes():
            tmp = target.with_name(target.name + '.tmp')
            shutil.copy2(f, tmp)
            tmp.replace(target)
            written.append(f.name)
    return written


# the kinds of file new_run links from DEV into every run, by suffix (editor/play_prepare.py: a change to one of them
# builds a map again)
LINKED = ('.exe', '.dll', '.u', '.int')


def editor_packages():
    """The map editor's own packages: the models and the sounds imported in it, the scripts written in it. new_run links
    them from dist, never from DEV; a development working copy's compile neither makes nor reads them
    (editor/play_prepare.py)."""
    return settings.MODELS_PACKAGE, settings.SOUNDS_PACKAGE, settings.SCRIPTS_PACKAGE


def new_run(inputs=(), label='run'):
    """Create a private run. inputs: paths of maps (or other files) copied into Input\\."""
    if not HOST.exists():
        raise SystemExit('Build the host first: tools\\mapkit\\host\\build_host.ps1')
    prune()
    folder = RUNS / (time.strftime('%Y%m%d-%H%M%S-') + label + '-' + uuid.uuid4().hex[:6])
    system = folder / 'System'
    system.mkdir(parents=True)
    own = [name + '.u' for name in (settings.PACKAGE, settings.VOICES_PACKAGE) + editor_packages()]
    for path in DEV.iterdir():
        if path.is_file() and path.suffix.lower() in LINKED:
            if path.name in own:
                continue
            os.link(path, system / path.name)
    for name in own:
        source = PROJECT / 'dist' / name
        if source.exists():
            os.link(source, system / name)      # a link, not a copy: the voices alone are 37 MB
    for f in host_files() + native_files():     # the newest build of DeusEdixNav, not a copy left in DEV
        (system / f.name).unlink(missing_ok=True)
        shutil.copy2(f, system / f.name)
    for p in extra_packages():                  # a package of another mod kept outside the game's folders
        source = Path(p.get('path') or '')
        if p.get('path') and source.is_file() and not (system / source.name).exists():
            try:
                os.link(source, system / source.name)
            except OSError:
                atomicfile.copy_file(source, system / source.name)
    # the run's System is mostly hard links (to DEV's files, themselves the game's): a write replaces a name, never
    # writes into a file it shares
    for path in DEV.glob('*.ini'):
        atomicfile.copy_file(path, system / path.name)
    ini = _ini(system)
    for name in ('Default.ini', 'DeusEx.ini', 'Revision.ini', 'ucc.ini', 'Editor.ini', 'UnrealEd.ini'):
        (system / name).unlink(missing_ok=True)
        (system / name).write_text(ini, encoding='latin1')
    for sub in ('Input', 'Output', 'T3D'):
        (folder / sub).mkdir()
    for path in inputs:
        shutil.copy2(path, folder / 'Input' / Path(path).name)
    return folder


def execute(folder, commands, log_name='host.log', timeout=3600, echo=False, tries=4, watch=None, prepared=None):
    """Run commands in the host. Paths in commands are relative to the run's System folder.

    LIGHT APPLY opens a hidden OpenGL viewport; now and then the NVIDIA driver crashes while
    creating it (nvoglv32.dll, null read; seen on 11 Oct 2026 for a quarter of an hour, then
    gone, with identical inputs). A run that dies in that step is simply run again.

    watch: a build that follows the run (the map editor's Rebuild, editor/build_job.py): watch.started(process, log)
    as each run starts (it raises Stopped to refuse it); watch.stopped once it was cancelled (the run it stopped raises
    Stopped: no retry). In a map script the editor runs, the run's log is named in its HOST_LOG_ENV file (LogNote)."""
    if watch is None and os.environ.get(HOST_LOG_ENV):
        watch = LogNote(os.environ[HOST_LOG_ENV])
    for attempt in range(tries):
        try:
            return _execute(folder, commands, log_name, timeout, echo and attempt == tries - 1, watch,
                            prepared if attempt == 0 else None)
        except RuntimeError as e:
            text = (Path(folder) / log_name).read_text(encoding='utf-8', errors='replace')
            last = re.findall(r'UCMapKit\|command\|(.*)', text)
            if attempt == tries - 1 or not last or last[-1].strip() != 'LIGHT APPLY' or 'UCMapKit|done' in text:
                raise
            print('  LIGHT APPLY crashed in the graphics driver: retry %d/%d' % (attempt + 2, tries))
            for f in (Path(folder) / 'Output').glob('*'):
                f.unlink()
            time.sleep(3)


def _execute(folder, commands, log_name, timeout, echo, watch=None, prepared=None):
    folder = Path(folder)
    command_file = folder / ('commands-' + uuid.uuid4().hex[:8] + '.txt')
    command_file.write_text('\n'.join(commands) + '\n', encoding='utf-8')     # UC_PROP texts may have accents
    log = folder / log_name
    start = time.time()
    import resident_build
    if isinstance(prepared, resident_build.RemoteBuild):
        result = resident_build.execute_remote(folder, command_file, timeout, prepared.endpoint)
        if result is not None:
            return result
        prepared = None
    with (nullcontext(prepared.stream) if prepared is not None else log.open('wb')) as stream:
        process = prepared.process if prepared is not None else subprocess.Popen(
            [str(folder / 'System' / HOST.name), str(command_file)], cwd=folder / 'System',
            stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            import build_cpu
            build_cpu.prefer_performance(int(process._handle))
            if watch is not None:
                watch.started(process, log)
            if prepared is not None:
                prepared.send(folder, log_name, command_file)
            process.wait(timeout=timeout)
        except BaseException:                       # stopped or too long (as subprocess.run's timeout): never left running
            process.kill()
            process.wait()
            raise
    if watch is not None and watch.stopped:
        raise Stopped('The run was cancelled.')          # on purpose: not a failure to print or to run again
    text = log.read_text(encoding='utf-8', errors='replace')
    expected = sum(1 for c in commands if c.strip() and not c.startswith('#'))
    ok = (process.returncode == 0 and 'UCMapKit|done' in text and text.count('UCMapKit|complete') == expected)
    bad = re.findall(r'(?im)^.*(?:Failed to load|Failed import|Critical:|UCMapKit\|fault|UCMapKit\|failed).*$', text)
    if echo or not ok or bad:
        print(text[-4000:])
    if not ok or bad:
        raise RuntimeError('host run failed (%s); log %s; %s' % (process.returncode, log, bad[:5]))
    return text, time.time() - start


class _PreparedBuild:
    def __init__(self, label):
        self.folder = new_run([], label)
        self.stream = (self.folder / 'build.log').open('wb')
        self.sent = False
        try:
            self.process = subprocess.Popen(
                [str(self.folder / 'System' / HOST.name), '--wait-batch'], cwd=self.folder / 'System',
                stdin=subprocess.PIPE, stdout=self.stream, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW)
            import build_cpu
            build_cpu.prefer_performance(int(self.process._handle))
        except BaseException:
            if hasattr(self, 'process'):
                self.close()
            else:
                self.stream.close()
            raise

    def send(self, folder, log_name, command_file):
        if self.sent or Path(folder) != self.folder or log_name != 'build.log':
            raise RuntimeError('Prepared build does not match this run')
        self.sent = True
        try:
            self.process.stdin.write((str(command_file.absolute()) + '\n').encode('utf-8'))
            self.process.stdin.close()
        except BrokenPipeError:
            # Let the ordinary log/exit-code validation report an early SDK
            # failure. Never hide it or silently skip a command.
            pass

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait()
        try:
            if self.process.stdin:
                self.process.stdin.close()
        except (BrokenPipeError, OSError):
            pass
        self.stream.close()


@contextmanager
def prewarm_build(label):
    """Overlap SDK initialization with preparation; one fresh SDK per build.

    This scope owns the child from launch to exit, including preparation errors.
    Older hosts and DEUSEDIX_BUILD_PREWARM=off retain the ordinary file runner.
    """
    ready = None
    import resident_build
    if os.environ.get(resident_build.ENDPOINT) and resident_build.supported():
        yield resident_build.RemoteBuild(label)
        return
    try:
        supported = os.environ.get('DEUSEDIX_BUILD_PREWARM', 'auto') != 'off' and b'--wait-batch\0' in HOST.read_bytes()
    except OSError:
        supported = False
    try:
        if supported:
            ready = _PreparedBuild(label)
        yield ready
    finally:
        if ready is not None:
            ready.close()


class Session:
    """A live host: the SDK editor stays open with its level, commands go one at a time.

        s = Session([map_path], 'label'); s.cmd('MAP LOAD FILE="..\Input\X.dx"'); s.trace(...); s.close()

    The host answers every command with a block ending in 'UCMapKit|ready'; a reader thread
    drains its output so large batches never block the pipe.
    """

    def __init__(self, inputs=(), label='session', folder=None, wait_ready=True):
        import queue
        import threading
        self.folder = Path(folder) if folder else new_run(inputs, label)
        self.log = (self.folder / 'session.log').open('a', encoding='utf-8')
        self.proc = subprocess.Popen([str(self.folder / 'System' / HOST.name), '-'], cwd=self.folder / 'System',
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     creationflags=subprocess.CREATE_NO_WINDOW)
        import build_cpu
        build_cpu.prefer_performance(int(self.proc._handle))
        self.lines = queue.Queue()

        def pump():
            for raw in self.proc.stdout:
                self.lines.put(raw.decode('utf-8', errors='replace').rstrip('\r\n'))
            self.lines.put(None)
        threading.Thread(target=pump, daemon=True).start()
        self._pending_ready = True
        if wait_ready:
            self.wait_ready()          # the SDK is up

    def wait_ready(self, timeout=300):
        """Consume startup exactly once before any command is sent.

        Deferred startup lets private callers copy/hash their inputs while the
        SDK initializes. It never reuses an engine from another map or job.
        """
        if self._pending_ready:
            self._collect(1, timeout)
            self._pending_ready = False

    def _collect(self, n, timeout):
        import queue
        out, done, end = [], 0, time.time() + timeout
        while done < n:
            try:
                line = self.lines.get(timeout=max(0.1, end - time.time()))
            except queue.Empty:
                raise RuntimeError('host session timed out; log %s' % self.log.name)
            if line is None:
                raise RuntimeError('host session ended:\n' + '\n'.join(out[-30:]))
            self.log.write(line + '\n')
            out.append(line)
            if line == 'UCMapKit|ready':
                done += 1
        self.log.flush()
        return '\n'.join(out)

    def batch(self, commands, timeout=3600):
        """Send many commands, return the whole output; raises if one failed."""
        commands = [c for c in commands]
        self.wait_ready()
        self.proc.stdin.write(''.join(c + '\n' for c in commands).encode('utf-8'))   # the host reads UC_PROP values as UTF-8
        self.proc.stdin.flush()
        text = self._collect(len(commands), timeout)
        bad = re.findall(r'(?im)^.*(?:Failed to load|Failed import|Critical:|UCMapKit\|fault|UCMapKit\|failed).*$', text)
        if bad:
            raise RuntimeError('host command failed: %s' % bad[:5])
        return text

    def cmd(self, command, timeout=600):
        return self.batch([command], timeout)

    def trace(self, start, end):
        """First level-geometry hit between two points: (point, normal) or None."""
        text = self.cmd('UC_TRACE %g %g %g %g %g %g' % (tuple(start) + tuple(end)))
        m = re.search(r'UCMapKit\|trace\|hit\|([-\d.]+) ([-\d.]+) ([-\d.]+)\|([-\d.]+) ([-\d.]+) ([-\d.]+)', text)
        if not m:
            return None
        v = [float(x) for x in m.groups()]
        return tuple(v[:3]), tuple(v[3:])

    def point(self, p):
        text = self.cmd('UC_POINT %g %g %g' % tuple(p))
        m = re.search(r'leaf (-?\d+)\|zone (\d+)', text)
        return (int(m[1]), int(m[2])) if m else None

    def close(self):
        try:
            self.proc.stdin.write(b'UC_QUIT\n')
            self.proc.stdin.flush()
            self.proc.wait(timeout=120)
        except Exception:
            self.proc.kill()
        self.log.close()
