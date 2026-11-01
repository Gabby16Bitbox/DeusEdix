"""Project-local native build worker, owned by the editor (never a shared daemon).

Only complete generated-map batches can reuse it. Script Python processes remain
fresh. Failure, cancellation, changed packages, a usage bound or idle expiry
retires the native process. Requests use a private local pipe and bounded JSON.
"""
import atexit
import glob
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import secrets
import subprocess
import threading
import time
from contextlib import contextmanager

ENDPOINT = 'DEUSEDIX_BUILD_WORKER'
IDLE_SECONDS = 120
MAX_BUILDS = 20
MAX_PRIVATE_BYTES = 2816 * 1024 * 1024
LIMIT = 1024 * 1024


def supported():
    import kit
    if os.name != 'nt' or os.environ.get('DEUSEDIX_BUILD_RESIDENT', 'auto') == 'off':
        return False
    try:
        if b'--build-worker\0' not in Path(kit.HOST).read_bytes():
            return False
        if b'UC_BUILD_INIT\0' not in Path(kit.HOST).with_name('UCEngineBridge.dll').read_bytes():
            return False
        core = hashlib.sha256((Path(kit.DEV) / 'Core.dll').read_bytes()).hexdigest()
        editor = hashlib.sha256((Path(kit.DEV) / 'Editor.dll').read_bytes()).hexdigest()
        return core in {'c640fd28fcfe84ac616a37eccd248d665e4008b9554bb87f6437385248c42417',
                        '8bf3039e14f849942ee70a95bdf26cf1f636245926e30106bbe58b7097eba7e4'} and editor == '93e31b3e401880ab17ab4561c3fd4d2baa530fbe25ccb5154911ebad60fff035'
    except OSError:
        return False


def eligible(commands):
    lines = [x.strip() for x in commands if x.strip() and not x.startswith('#')]
    if not lines or lines[0] != 'MAP NEW' or lines.count('MAP NEW') != 1:
        return False
    allowed = ('OBJ LOAD FILE=', 'UC_LOADPKG ', 'MAP IMPORTADD FILE=', 'MAP SAVE FILE=',
               'MAP EXPORT FILE=', 'MAP LOAD FILE=', 'BSP REBUILD ', 'UC_PROP ',
               'UC_TEXTHEX ', 'UC_SET ', 'UC_SCALE ', 'UC_DEL ', 'UC_MOVER ',
               'UC_UNLINK ', 'UC_NAVDROP ', 'UC_SURFACE ', 'UC_SURFTEX ')
    exact = {'MAP NEW', 'MAP REBUILD', 'UC_WORLD finish', 'UC_ACTORS check',
             'PATHS DEFINE', 'LIGHT APPLY', 'UC_CAMERAS clear', 'UC_PREVIEW', 'UC_LIGHTSTATS'}
    for line in lines:
        if '\n' in line or '\r' in line:
            return False
        if line.startswith('TEXTURE IMPORT '):
            if not re.search(r'(?i)\bPACKAGE=MyLevel(?:\s|$)', line):
                return False
        elif line not in exact and not line.startswith(allowed):
            return False
        if line.startswith('OBJ LOAD ') and not re.fullmatch(r'OBJ LOAD FILE="[\w .-]+\.(?:u|utx|uax|umx|usx)"', line, re.I):
            return False
        if line.startswith('UC_LOADPKG ') and not Path(line[len('UC_LOADPKG '):].strip('"')).is_absolute():
            return False
        # Loading a saved result is supported. Loading arbitrary input maps into
        # this pool, animation authoring and external package mutations are not.
        if line.startswith('MAP LOAD ') and not re.fullmatch(r'MAP LOAD FILE="\.\.\\Output\\[\w-]+\.dx"', line):
            return False
    return True


def fingerprint(env, commands):
    import kit
    patterns = set()
    ini = kit._ini(kit.DEV)
    for value in re.findall(r'(?im)^Paths\s*=\s*(.+)$', ini):
        p = Path(value.strip())
        if p.suffix.lower() in ('.u', '.utx', '.uax', '.umx', '.usx'):
            patterns.add(str(p if p.is_absolute() else Path(kit.DEV) / p))
    for root in (Path(kit.DEV), Path(kit.PROJECT) / 'dist'):
        patterns.update(str(root / ext) for ext in ('*.u', '*.dll', '*.utx', '*.uax', '*.umx'))
    patterns.update(str(Path(row['path']).resolve()) for row in kit.extra_packages() if row.get('path'))
    patterns.update(line[len('UC_LOADPKG '):].strip('"') for line in commands if line.startswith('UC_LOADPKG '))
    files = {}
    for pattern in sorted(patterns):
        for name in sorted(glob.glob(pattern)):
            p = Path(name).resolve(); s = p.stat()
            files[str(p)] = (s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_ino)
    binaries = {str(Path(p).resolve()): hashlib.sha256(Path(p).read_bytes()).hexdigest()
                for p in kit.host_files() + kit.native_files()}
    modes = {k: v for k, v in env.items() if k.startswith('DEUSEDIX_') and k not in (ENDPOINT, kit.HOST_LOG_ENV)}
    return json.dumps([str(Path(kit.PROJECT).resolve()), ini, files, binaries, modes], sort_keys=True)


def run_in_use(folder):
    """The originating run contains loaded packages: pruning must leave it intact."""
    path = Path(folder) / '.resident.lock'
    if os.name != 'nt' or not path.exists():
        return False
    import msvcrt
    try:
        with path.open('r+b') as stream:
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                return True
            msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
    except OSError:
        return True
    return False


def private_bytes(process):
    import ctypes
    from ctypes import wintypes
    class Counters(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('faults', wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in ('peak_ws', 'ws', 'peak_paged', 'paged',
                'peak_nonpaged', 'nonpaged', 'pagefile', 'peak_pagefile', 'private')]
    data = Counters(); data.cb = ctypes.sizeof(data)
    query = ctypes.WinDLL('psapi', use_last_error=True).GetProcessMemoryInfo
    query.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    query.restype = wintypes.BOOL
    return data.private if query(int(process._handle), ctypes.byref(data), data.cb) else None


def memory_available():
    import ctypes
    from ctypes import wintypes
    class Status(ctypes.Structure):
        _fields_ = [('length', wintypes.DWORD), ('load', wintypes.DWORD)] + [
            (name, ctypes.c_ulonglong) for name in ('physical', 'available', 'pagefile',
                'free_pagefile', 'virtual', 'free_virtual', 'extended')]
    state = Status(); state.length = ctypes.sizeof(state)
    query = ctypes.WinDLL('kernel32', use_last_error=True).GlobalMemoryStatusEx
    query.argtypes = [ctypes.POINTER(Status)]; query.restype = wintypes.BOOL
    return state.available if query(ctypes.byref(state)) else 0


class Pool:
    def __init__(self):
        self.lock = threading.RLock()
        self.process = self.lease = self.timer = None
        self.key = None
        self.count = 0

    def close(self):
        with self.lock:
            if self.timer:
                self.timer.cancel(); self.timer = None
            process, self.process = self.process, None
            if process:
                try:
                    process.stdin.close()
                    process.wait(timeout=0.5)
                except (OSError, subprocess.TimeoutExpired):
                    if process.poll() is None:
                        process.kill(); process.wait()
                process.stdout.close()
            if self.lease:
                self.lease.close(); self.lease = None
            self.key = None; self.count = 0

    def _start(self, folder, env):
        import kit
        import build_cpu
        import msvcrt
        self.lease = (folder / '.resident.lock').open('w+b')
        self.lease.write(b'1'); self.lease.flush(); self.lease.seek(0)
        msvcrt.locking(self.lease.fileno(), msvcrt.LK_NBLCK, 1)
        self.lines = queue.Queue()
        self.process = subprocess.Popen([str(folder / 'System' / kit.HOST.name), '--build-worker'],
            cwd=folder / 'System', stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW, env=env)
        build_cpu.prefer_performance(int(self.process._handle))
        lines, stream = self.lines, self.process.stdout
        def pump():
            try:
                for raw in stream:
                    lines.put(raw)
            finally:
                lines.put(None)
        threading.Thread(target=pump, daemon=True, name='build-worker-output').start()

    def _collect(self, marker, stream, deadline, worker, watch):
        while True:
            if time.monotonic() >= deadline:
                raise TimeoutError('Native build worker timed out.')
            if (watch and watch.stopped) or worker.poll() is not None:
                import kit
                raise kit.Stopped('The Rebuild was cancelled or its script ended.')
            try:
                raw = self.lines.get(timeout=0.15)
            except queue.Empty:
                continue
            if raw is None:
                raise RuntimeError('Native build worker exited before completing the batch.')
            stream.write(raw); stream.flush()
            if raw.rstrip(b'\r\n') == marker:
                return

    def run(self, folder, batch, commands, env, worker, watch, timeout):
        import kit
        with self.lock:
            if self.timer:
                self.timer.cancel(); self.timer = None
            try:
                key = fingerprint(env, commands)
            except BaseException:
                self.close()
                raise
            if self.key != key or not self.process or self.process.poll() is not None or self.count >= MAX_BUILDS:
                self.close()
            start = time.monotonic()
            log = folder / 'build.log'
            try:
                with log.open('wb') as stream:
                    fresh = self.process is None
                    if fresh:
                        self._start(folder, env)
                    if watch:
                        # Keep the script's stage note consistent with the native owner.
                        kit.LogNote(watch.note).started(self.process, log)
                        watch.started(self.process, log)
                    deadline = start + timeout
                    if fresh:
                        self._collect(b'UCMapKit|worker-ready|1', stream, deadline, worker, watch)
                    token = secrets.token_hex(16)
                    request = dict(folder=str(folder / 'System'), batch=str(batch), id=token)
                    self.process.stdin.write((json.dumps(request) + '\n').encode('utf-8'))
                    self.process.stdin.flush()
                    self._collect(('UCMapKit|batch-end|' + token).encode(), stream, deadline, worker, watch)
                text = log.read_text(encoding='utf-8', errors='replace')
                expected = sum(bool(c.strip()) and not c.startswith('#') for c in commands)
                bad = re.search(r'(?im)^.*(?:Failed to load|Failed import|Critical:|UCMapKit\|fault|UCMapKit\|failed)', text)
                if bad or text.count('UCMapKit|complete|') != expected or 'UCMapKit|done' not in text:
                    raise RuntimeError('Native build batch failed; log: ' + str(log))
                if fingerprint(env, commands) != key:
                    raise RuntimeError('A game package changed during Rebuild. Please rebuild again.')
                self.key = key; self.count += 1
                usage = private_bytes(self.process)
                if usage is None or usage >= MAX_PRIVATE_BYTES or memory_available() < 2 * 1024**3:
                    self.close()
                    return time.monotonic() - start
                def expire():
                    with self.lock:
                        if self.timer is timer:
                            self.close()
                timer = threading.Timer(IDLE_SECONDS, expire)
                self.timer = timer
                self.timer.daemon = True; self.timer.start()
                return time.monotonic() - start
            except BaseException:
                self.close()
                raise
            finally:
                if watch:
                    if watch.stopped:
                        self.close()
                    else:
                        try:
                            watch.started(worker, None)
                        except BaseException:
                            self.close()
                            raise


_pool = Pool()
atexit.register(_pool.close)


def release():
    """Let go of the packages the idle warm host holds (its run links the files of dist: a development working copy's
    build.ps1 writes the packages it made into them, which Windows refuses while they are open). It would not be used
    again anyway, its packages having changed; a batch running is waited for."""
    _pool.close()


class Offer:
    """One build script receives one authenticated capability; no network port."""
    def __init__(self, env, watch):
        from multiprocessing.connection import Listener
        self.env, self.watch = dict(env), watch
        self.secret = secrets.token_hex(32)
        self.address = r'\\.\pipe\deusedix-build-' + secrets.token_hex(24)
        self.listener = Listener(self.address, family='AF_PIPE')
        self.closed = threading.Event(); self.attached = threading.Event()
        self.worker = None
        env[ENDPOINT] = json.dumps([self.address, self.secret])
        self.thread = threading.Thread(target=self._serve, daemon=True, name='build-worker-request')
        self.thread.start()

    def attach(self, worker):
        self.worker = worker; self.attached.set()

    def _serve(self):
        connection = None
        try:
            connection = self.listener.accept()
            if not connection.poll(5):
                return
            message = json.loads(connection.recv_bytes(LIMIT))
            if not isinstance(message, dict) or not secrets.compare_digest(str(message.get('secret', '')), self.secret):
                return
            while not self.attached.wait(0.1):
                if self.closed.is_set():
                    return
            if self.closed.is_set() or message.get('close'):
                return
            import kit
            folder, batch = Path(message['folder']).resolve(), Path(message['batch']).resolve()
            if folder.parent != Path(kit.RUNS).resolve() or batch.parent != folder or not re.fullmatch(r'commands-[0-9a-f]{8}\.txt', batch.name):
                raise ValueError('Invalid private build folder.')
            if batch.stat().st_size > LIMIT:
                raise ValueError('Build batch is too large for reuse.')
            commands = batch.read_text(encoding='utf-8').splitlines()
            if not eligible(commands):
                connection.send_bytes(b'{"fallback":true}'); return
            seconds = _pool.run(folder, batch, commands, self.env, self.worker, self.watch,
                                min(3600, max(1, float(message['timeout']))))
            connection.send_bytes(json.dumps(dict(seconds=seconds)).encode())
        except Exception as exc:
            if connection:
                try:
                    connection.send_bytes(json.dumps(dict(error=str(exc), stopped=bool(self.watch and self.watch.stopped))).encode())
                except (OSError, EOFError):
                    pass
        finally:
            if connection:
                connection.close()

    def close(self):
        self.closed.set()
        if self.thread.is_alive() and not self.attached.is_set():
            self.attached.set()
        # Wake an accept waiting for a script that failed during preparation.
        if self.thread.is_alive():
            from multiprocessing.connection import Client
            try:
                with Client(self.address, family='AF_PIPE') as connection:
                    connection.send_bytes(json.dumps(dict(secret=self.secret, close=True)).encode())
            except (OSError, EOFError):
                pass
        self.listener.close()
        self.thread.join(timeout=2)


@contextmanager
def offer(env, watch=None):
    instance = None
    try:
        if supported():
            instance = Offer(env, watch)
        yield instance
    finally:
        if instance:
            instance.close()


class RemoteBuild:
    def __init__(self, label):
        import kit
        # One offer serves one full batch. Scripts that build several maps keep
        # the ordinary fresh runner for additional builds instead of reconnecting
        # to a listener whose request thread has already finished.
        self.endpoint = os.environ.pop(ENDPOINT)
        self.folder = kit.new_run([], label)
    def close(self):
        pass


def execute_remote(folder, batch, timeout, endpoint):
    from multiprocessing.connection import Client
    import kit
    address, secret = json.loads(endpoint)
    with Client(address, family='AF_PIPE') as connection:
        connection.send_bytes(json.dumps(dict(secret=secret, folder=str(folder.resolve()),
            batch=str(batch.resolve()), timeout=timeout)).encode())
        if not connection.poll(timeout + 10):
            raise TimeoutError('Editor build worker did not answer.')
        result = json.loads(connection.recv_bytes(LIMIT))
    if result.get('fallback'):
        return None
    if result.get('stopped'):
        raise kit.Stopped(result['error'])
    if result.get('error'):
        raise RuntimeError(result['error'])
    text = (folder / 'build.log').read_text(encoding='utf-8', errors='replace')
    return text, float(result['seconds'])
