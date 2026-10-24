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

import settings

PROJECT = Path(__file__).resolve().parents[2]
DEV = PROJECT / 'DevInstall' / 'System'
RUNS = PROJECT / 'tools' / 'mapkit' / 'runs'
HOST = PROJECT / 'tools' / 'mapkit' / 'bin' / 'UCMapKitHost.exe'

# the engine's and the game's packages every editor session loads (with Revision: Revision.u too)
EDIT_PACKAGES = ('Core', 'Engine', 'Editor', 'Extension', 'DeusExUI', 'ConSys', 'DeusEx') + settings.GAME_EDIT_PACKAGES
# packages of other mods the editor loads too (the map editor's Packages panel: editor/packages.py)
PACKAGES_FILE = PROJECT / 'tools' / 'mapkit' / 'packages.json'


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
        shutil.rmtree(d, ignore_errors=True)


def host_files():
    """The host and its engine bridge next to it (host/README.md); a host without one (an older build) runs alone."""
    bridge = HOST.with_name('UCEngineBridge.dll')
    return [HOST] + ([bridge] if bridge.is_file() else [])


def new_run(inputs=(), label='run'):
    """Create a private run. inputs: paths of maps (or other files) copied into Input\\."""
    if not HOST.exists():
        raise SystemExit('Build the host first: tools\\mapkit\\host\\build_host.ps1')
    prune()
    folder = RUNS / (time.strftime('%Y%m%d-%H%M%S-') + label + '-' + uuid.uuid4().hex[:6])
    system = folder / 'System'
    system.mkdir(parents=True)
    for path in DEV.iterdir():
        if path.is_file() and path.suffix.lower() in ('.exe', '.dll', '.u', '.int'):
            if path.name in (settings.PACKAGE + '.u', 'UnatcoVoices.u', settings.MODELS_PACKAGE + '.u', settings.SOUNDS_PACKAGE + '.u',
                             settings.SCRIPTS_PACKAGE + '.u'):
                continue
            os.link(path, system / path.name)
    # UCModels, UCSounds, UCScripts: the models and the sounds imported in the editor, the scripts written in it
    for name in (settings.PACKAGE + '.u', 'UnatcoVoices.u', settings.MODELS_PACKAGE + '.u', settings.SOUNDS_PACKAGE + '.u',
                 settings.SCRIPTS_PACKAGE + '.u'):
        source = PROJECT / 'dist' / name
        if source.exists():
            os.link(source, system / name)      # a link, not a copy: the voices alone are 37 MB
    for f in host_files():
        shutil.copy2(f, system / f.name)
    for p in extra_packages():                  # a package of another mod kept outside the game's folders
        source = Path(p.get('path') or '')
        if p.get('path') and source.is_file() and not (system / source.name).exists():
            try:
                os.link(source, system / source.name)
            except OSError:
                shutil.copy2(source, system / source.name)
    for path in DEV.glob('*.ini'):
        shutil.copy2(path, system / path.name)
    ini = _ini(system)
    for name in ('Default.ini', 'DeusEx.ini', 'Revision.ini', 'ucc.ini', 'Editor.ini', 'UnrealEd.ini'):
        (system / name).write_text(ini, encoding='latin1')
    for sub in ('Input', 'Output', 'T3D'):
        (folder / sub).mkdir()
    for path in inputs:
        shutil.copy2(path, folder / 'Input' / Path(path).name)
    return folder


def execute(folder, commands, log_name='host.log', timeout=3600, echo=False, tries=4):
    """Run commands in the host. Paths in commands are relative to the run's System folder.

    LIGHT APPLY opens a hidden OpenGL viewport; now and then the NVIDIA driver crashes while
    creating it (nvoglv32.dll, null read; seen on 11 Oct 2026 for a quarter of an hour, then
    gone, with identical inputs). A run that dies in that step is simply run again."""
    for attempt in range(tries):
        try:
            return _execute(folder, commands, log_name, timeout, echo and attempt == tries - 1)
        except RuntimeError as e:
            text = (Path(folder) / log_name).read_text(encoding='utf-8', errors='replace')
            last = re.findall(r'UCMapKit\|command\|(.*)', text)
            if attempt == tries - 1 or not last or last[-1].strip() != 'LIGHT APPLY' or 'UCMapKit|done' in text:
                raise
            print('  LIGHT APPLY crashed in the graphics driver: retry %d/%d' % (attempt + 2, tries))
            for f in (Path(folder) / 'Output').glob('*'):
                f.unlink()
            time.sleep(3)


def _execute(folder, commands, log_name, timeout, echo):
    folder = Path(folder)
    command_file = folder / ('commands-' + uuid.uuid4().hex[:8] + '.txt')
    command_file.write_text('\n'.join(commands) + '\n', encoding='utf-8')     # UC_PROP texts may have accents
    log = folder / log_name
    start = time.time()
    with log.open('wb') as stream:
        process = subprocess.run([str(folder / 'System' / HOST.name), str(command_file)], cwd=folder / 'System',
                                 stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT,
                                 timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW)
    text = log.read_text(encoding='utf-8', errors='replace')
    expected = sum(1 for c in commands if c.strip() and not c.startswith('#'))
    ok = (process.returncode == 0 and 'UCMapKit|done' in text and text.count('UCMapKit|complete') == expected)
    bad = re.findall(r'(?im)^.*(?:Failed to load|Failed import|Critical:|UCMapKit\|fault|UCMapKit\|failed).*$', text)
    if echo or not ok or bad:
        print(text[-4000:])
    if not ok or bad:
        raise RuntimeError('host run failed (%s); log %s; %s' % (process.returncode, log, bad[:5]))
    return text, time.time() - start


class Session:
    """A live host: the SDK editor stays open with its level, commands go one at a time.

        s = Session([map_path], 'label'); s.cmd('MAP LOAD FILE="..\Input\X.dx"'); s.trace(...); s.close()

    The host answers every command with a block ending in 'UCMapKit|ready'; a reader thread
    drains its output so large batches never block the pipe.
    """

    def __init__(self, inputs=(), label='session', folder=None):
        import queue
        import threading
        self.folder = Path(folder) if folder else new_run(inputs, label)
        self.log = (self.folder / 'session.log').open('a', encoding='utf-8')
        self.proc = subprocess.Popen([str(self.folder / 'System' / HOST.name), '-'], cwd=self.folder / 'System',
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     creationflags=subprocess.CREATE_NO_WINDOW)
        self.lines = queue.Queue()

        def pump():
            for raw in self.proc.stdout:
                self.lines.put(raw.decode('utf-8', errors='replace').rstrip('\r\n'))
            self.lines.put(None)
        threading.Thread(target=pump, daemon=True).start()
        self._collect(1, 300)          # the SDK is up

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
