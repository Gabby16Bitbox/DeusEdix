"""Own just the game launched by this editor, never an arbitrary game process (Revision or Deus Ex).

Steam is asynchronous, so an exact executable path and PID alone are insufficient:
the launched map URL contains a nonce, verified in the new process's command line.
Every close operation also verifies the Windows process creation time while holding
an open process handle. No executable-name-wide termination is used.
"""
import ctypes
from ctypes import wintypes
from dataclasses import dataclass
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import uuid


def _path(value):
    return os.path.normcase(os.path.abspath(str(value)))


@dataclass(frozen=True)
class Identity:
    pid: int
    created: int
    executable: str


class _ProcessEntry(ctypes.Structure):
    _fields_ = [('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD),
                ('th32ProcessID', wintypes.DWORD), ('th32DefaultHeapID', ctypes.c_size_t),
                ('th32ModuleID', wintypes.DWORD), ('cntThreads', wintypes.DWORD),
                ('th32ParentProcessID', wintypes.DWORD), ('pcPriClassBase', wintypes.LONG),
                ('dwFlags', wintypes.DWORD), ('szExeFile', wintypes.WCHAR * 260)]


class WindowsProcesses:
    """Small Win32 adapter; process enumeration does not spawn tasklist/PowerShell."""
    def __init__(self, executable):
        self.executable = _path(executable)
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.user = ctypes.WinDLL('user32', use_last_error=True)
        k = self.kernel
        k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        k.OpenProcess.restype = wintypes.HANDLE
        k.CloseHandle.argtypes = [wintypes.HANDLE]
        k.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                                               ctypes.POINTER(wintypes.DWORD)]
        k.QueryFullProcessImageNameW.restype = wintypes.BOOL
        k.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        k.GetProcessTimes.restype = wintypes.BOOL
        k.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
        k.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        k.Process32FirstW.argtypes = k.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_ProcessEntry)]
        k.Process32FirstW.restype = k.Process32NextW.restype = wintypes.BOOL
        k.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        k.WaitForSingleObject.restype = wintypes.DWORD
        k.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
        k.TerminateProcess.restype = wintypes.BOOL
        self.user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        self.user.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        self.user.PostMessageW.restype = wintypes.BOOL

    def _open(self, pid, access=0x1000 | 0x100000):
        handle = self.kernel.OpenProcess(access, False, int(pid))
        if not handle:
            error = ctypes.get_last_error()
            if error in (87, 1168):  # the process exited between enumeration and OpenProcess
                return None
            raise OSError(error, 'Cannot inspect the game process safely')
        return handle

    def _identity(self, handle, pid):
        name = ctypes.create_unicode_buffer(32768)
        size = wintypes.DWORD(len(name))
        if not self.kernel.QueryFullProcessImageNameW(handle, 0, name, ctypes.byref(size)):
            raise ctypes.WinError(ctypes.get_last_error())
        times = [wintypes.FILETIME() for _ in range(4)]
        if not self.kernel.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)):
            raise ctypes.WinError(ctypes.get_last_error())
        created = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
        return Identity(int(pid), created, _path(name.value))

    def _running_identity(self, handle, pid):
        state = self.kernel.WaitForSingleObject(handle, 0)
        if state == 0:
            return None
        if state != 258:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return self._identity(handle, pid)
        except OSError as error:
            # QueryFullProcessImageName can fail with ERROR_GEN_FAILURE after exit,
            # even while another handle keeps the terminated process object alive.
            if self.kernel.WaitForSingleObject(handle, 0) == 0:
                return None
            # a game closing itself (console "exit") answers ACCESS_DENIED for a moment before it is gone
            # (live.stop failed there on 20 Oct 2026): give it two seconds to finish
            if getattr(error, 'winerror', None) == 5 and self.kernel.WaitForSingleObject(handle, 2000) == 0:
                return None
            raise

    def list(self):
        k = self.kernel
        snapshot = k.CreateToolhelp32Snapshot(2, 0)
        if snapshot == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        out = []
        try:
            entry = _ProcessEntry()
            entry.dwSize = ctypes.sizeof(entry)
            found = k.Process32FirstW(snapshot, ctypes.byref(entry))
            while found:
                if entry.szExeFile.casefold() == Path(self.executable).name.casefold():
                    handle = self._open(entry.th32ProcessID)
                    if handle:
                        try:
                            identity = self._running_identity(handle, entry.th32ProcessID)
                            if identity and identity.executable == self.executable:
                                out.append(identity)
                        finally:
                            k.CloseHandle(handle)
                found = k.Process32NextW(snapshot, ctypes.byref(entry))
        finally:
            k.CloseHandle(snapshot)
        return out

    def alive(self, identity):
        handle = self._open(identity.pid)
        if not handle:
            return False
        try:
            return self._running_identity(handle, identity.pid) == identity
        finally:
            self.kernel.CloseHandle(handle)

    def matches_launch(self, identity, token):
        # CIM is queried once per candidate, never once per frame or for the process list.
        # It works across 32/64-bit games without reading undocumented PEB structures.
        command = ('$p = Get-CimInstance Win32_Process -Filter "ProcessId = %d"; '
                   'if ($p) { ConvertTo-Json -Compress -InputObject $p.CommandLine }') % identity.pid
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command],
                                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=12,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:
            raise RuntimeError('Cannot verify the game launch command; the game has not been claimed.')
        try:
            command_line = json.loads(result.stdout.strip()) if result.stdout.strip() else ''
        except ValueError as exc:
            raise RuntimeError('Cannot read the game launch command safely.') from exc
        return isinstance(command_line, str) and ('?DeusEdixSession=' + token) in command_line and self.alive(identity)

    def close(self, identity, grace=3):
        # Keep this handle until completion: PID reuse cannot redirect TerminateProcess.
        handle = self._open(identity.pid, 0x1000 | 0x100000 | 0x0001)
        if not handle:
            return True
        try:
            if self._running_identity(handle, identity.pid) != identity:
                return True
            if self.kernel.WaitForSingleObject(handle, 0) != 258:
                return True
            callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
            @callback_type
            def close_window(window, _):
                pid = wintypes.DWORD()
                self.user.GetWindowThreadProcessId(window, ctypes.byref(pid))
                if pid.value == identity.pid:
                    self.user.PostMessageW(window, 0x0010, 0, 0)  # WM_CLOSE
                return True
            self.user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
            self.user.EnumWindows(close_window, 0)
            if self.kernel.WaitForSingleObject(handle, int(max(0, grace) * 1000)) == 0:
                return True
            if not self.kernel.TerminateProcess(handle, 0):
                if self.kernel.WaitForSingleObject(handle, 0) == 0:
                    return True
                raise ctypes.WinError(ctypes.get_last_error())
            if self.kernel.WaitForSingleObject(handle, 3000) != 0:
                raise RuntimeError('The game has not exited. Its settings have been kept intact; try Stop again.')
            return True
        finally:
            self.kernel.CloseHandle(handle)


class GameSession:
    """One launch at a time, including cancellation while Steam is still starting."""
    def __init__(self, processes, launch_timeout=90, poll=0.25, clock=time.monotonic):
        self.processes = processes
        self.launch_timeout = launch_timeout
        self.poll = poll
        self.clock = clock
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.session = None

    def _status(self):
        s = self.session or {}
        owner = s.get('identity')
        return dict(owned=bool(owner), launching=bool(s.get('launching')), running=bool(s.get('running')),
                    pid=owner.pid if owner else None, created=str(owner.created) if owner else None,
                    token=s.get('token'), stopping=bool(s.get('cancelled')), error=s.get('error', ''))

    def status(self):
        with self.lock:
            return self._status()

    def start(self, prepare, dispatch, cleanup):
        with self.lock:
            if self.session and (self.session['launching'] or self.session.get('identity') or self.session.get('cleanup')):
                raise RuntimeError('A game session is still active or closing. Wait for Stop to finish.')
            if self.processes.list():
                raise RuntimeError('The game is already running. Close it before starting a new play session.')
            s = self.session = dict(token=uuid.uuid4().hex, identity=None, launching=True, running=False,
                                    cancelled=False, error='', cleanup=cleanup, checked=set(),
                                    deadline=self.clock() + self.launch_timeout)
            try:
                prepare()
                dispatch(s['token'])
            except Exception as exc:
                s['launching'] = False
                s['error'] = str(exc)
                self._cleanup(s)
                raise
            thread = threading.Thread(target=self._watch, args=(s,), name='DeusEdix-game-session', daemon=True)
            thread.start()
            return self._status()

    def _cleanup(self, s):
        # Called only after verified process exit or a launch which never acquired a process.
        if s.get('cleanup'):
            try:
                s['cleanup']()
                s['cleanup'] = None
            except Exception as exc:
                s['error'] = 'Game settings could not be restored: %s' % exc
                return False
        s['cancelled'] = False
        return True

    def _watch(self, s):
        while True:
            try:
                with self.lock:
                    if self.session is not s:
                        return
                    owner = s.get('identity')
                    if not owner and not s['launching']:
                        return
                    if owner:
                        if not self.processes.alive(owner):
                            s.update(identity=None, running=False, launching=False)
                            self._cleanup(s)
                            return
                        cancel = s['cancelled']
                    else:
                        cancel = False
                if owner and cancel:
                    self._close(s, owner)
                    with self.lock:
                        if not s.get('identity'):
                            return
                if not owner:
                    candidates = self.processes.list()
                    for candidate in candidates:
                        if candidate in s['checked']:
                            continue
                        matched = self.processes.matches_launch(candidate, s['token'])
                        s['checked'].add(candidate)
                        if matched:
                            with self.lock:
                                s.update(identity=candidate, running=True, launching=False, error='')
                            break
                    with self.lock:
                        if not s.get('identity') and self.clock() >= s['deadline']:
                            s['launching'] = False
                            if not s['cancelled']:
                                s['error'] = 'The game did not start within %d seconds. Check Steam, then try Play again.' % self.launch_timeout
                            self._cleanup(s)
                            return
            except Exception as exc:
                with self.lock:
                    s['error'] = str(exc)
                    if self.clock() >= s['deadline'] and not s.get('identity'):
                        s['launching'] = False
                        self._cleanup(s)
                        return
            self.wake.wait(self.poll)
            self.wake.clear()

    def _close(self, s, owner, grace=3):
        with self.lock:
            if s.get('closing') or s.get('identity') != owner:
                return
            s['closing'] = True
        try:
            self.processes.close(owner, grace=grace)
            with self.lock:
                if self.processes.alive(owner):
                    raise RuntimeError('The game is still running. Try Stop again.')
                s.update(identity=None, running=False, launching=False)
                s['error'] = ''
                self._cleanup(s)
        except Exception as exc:
            with self.lock:
                s['error'] = str(exc)
                s['cancelled'] = False
        finally:
            with self.lock:
                s['closing'] = False

    def stop(self, timeout=5):
        with self.lock:
            s = self.session
            if not s:
                return self._status()
            s['cancelled'] = True
            owner = s.get('identity')
            if not owner and not s['launching']:
                s['error'] = ''
                self._cleanup(s)
                return self._status()
            self.wake.set()
        if owner:
            # _close reserves the identity under the lock, but waits without holding it.
            self._close(s, owner, grace=min(3, max(0, timeout)))
        return self.status()

