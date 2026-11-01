"""Native-engine proof: the host keeps its engine's windows hidden and leaves the foreground where it is
(host/README.md, "No window on the screen").

With Revision, LIGHT APPLY's temporary viewport is a real window: WinDrvLite shows, activates and focuses it. The host
must never show it nor give it the foreground, nor take the foreground from the window that has it, at every build of
a map. A generated lit room is built in a temporary folder, as test_rebuild_native.py does, by a host started for it,
while every window of its host process is watched: the shows and the foreground changes Windows reports (a WinEvent
hook), and a poll every 5 ms of the process's windows and of the foreground window. The viewport must have been there
(the check is not met by a build that opened no window). Never installs or edits game maps.

The foreground part needs a host that may take the foreground, as one started from the program in front (DeusEdix)
can: the test gives its host that right as soon as it runs (AllowSetForegroundWindow). The foreground must then never
be a window of the host, nor no window at all for longer than NOWHERE_LIMIT while a host lives, nor no window at the
end when a window had it at the start. A process that cannot give that right (one not started from the program in
front) proves only the hidden windows: the test then ends with NOT PROVEN and exit code 2, not PASS. A faulty host
takes the foreground from whoever is using the PC (it is handed back at the end): run it when nobody is.

Run directly with mapkit Python: test_host_hidden_window.py [the folder of a host build to try; default the kit's bin]
"""
import ctypes
import sys
import tempfile
import threading
import time
from ctypes import wintypes
from pathlib import Path
from unittest.mock import patch

from PIL import Image

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import game_process
import geom
import kit
from scene import Scene

user32 = ctypes.WinDLL('user32', use_last_error=True)
kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
EVENT_SYSTEM_FOREGROUND, EVENT_OBJECT_SHOW = 0x0003, 0x8002
OBJID_WINDOW, CHILDID_SELF, WINEVENT_OUTOFCONTEXT, WM_QUIT = 0, 0, 0, 0x0012
PROCESS_QUERY_LIMITED_INFORMATION, SYNCHRONIZE, WAIT_TIMEOUT = 0x1000, 0x100000, 0x102
ERROR_INVALID_PARAMETER = 87    # AllowSetForegroundWindow: also a process that has not loaded user32 yet
NOWHERE_LIMIT = 0.1             # s: the longest the foreground may be no window at all while a host lives
HOST_SCAN = 0.25                # s between two looks for new hosts (a process snapshot takes tens of ms)
WinEventProc = ctypes.WINFUNCTYPE(None, wintypes.HANDLE, wintypes.DWORD, wintypes.HWND, wintypes.LONG,
                                  wintypes.LONG, wintypes.DWORD, wintypes.DWORD)
EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.SetWinEventHook.restype = wintypes.HANDLE
user32.SetWinEventHook.argtypes = (wintypes.DWORD, wintypes.DWORD, wintypes.HMODULE, WinEventProc, wintypes.DWORD,
                                   wintypes.DWORD, wintypes.DWORD)
user32.UnhookWinEvent.argtypes = (wintypes.HANDLE,)
user32.EnumWindows.argtypes = (EnumProc, wintypes.LPARAM)
user32.GetWindowThreadProcessId.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.DWORD))
user32.GetForegroundWindow.restype = wintypes.HWND
user32.IsWindowVisible.argtypes = (wintypes.HWND,)
user32.GetClassNameW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
user32.GetWindowRect.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.RECT))
user32.PostThreadMessageW.argtypes = (wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
user32.AllowSetForegroundWindow.argtypes = (wintypes.DWORD,)
user32.SetForegroundWindow.argtypes = (wintypes.HWND,)
user32.IsWindow.argtypes = (wintypes.HWND,)
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
kernel32.QueryFullProcessImageNameW.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                                                ctypes.POINTER(wintypes.DWORD))
kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)


def image(pid):
    """The program file of a process, '' when it cannot be read (gone, or not ours to read)."""
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return ''
    try:
        size = wintypes.DWORD(1024)
        name = ctypes.create_unicode_buffer(size.value)
        return name.value if kernel32.QueryFullProcessImageNameW(handle, 0, name, ctypes.byref(size)) else ''
    finally:
        kernel32.CloseHandle(handle)


def describe(window):
    """{class, visible, rect} of a window."""
    name = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(window, name, 256)
    rect = wintypes.RECT()
    user32.GetWindowRect(window, ctypes.byref(rect))
    return {'class': name.value, 'visible': bool(user32.IsWindowVisible(window)),
            'rect': [rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top]}


class HostWindows:
    """The windows of the host processes run from under root, while it is open: the shows and the foreground changes
    Windows reports, and what a poll every 5 ms sees (every window of those processes, which of them were visible,
    when one of them was the foreground window, how long the foreground was no window at all while a host lived). Each
    host gets the right to take the foreground as soon as it runs, as a host started from the program in front has it.

        with HostWindows(root) as seen: ...build...      then seen.shown, .foreground, .visible, .windows, .rights
                                                         (pid: True, or Windows' error), .nowhere (s), .front
    The foreground window at the start and at the end is in .front (None: no window). If the hosts left it to no window,
    it is handed back to the window that had it (.given_back).
    """

    def __init__(self, root):
        self.root = str(Path(root).resolve()).lower()
        self.shown, self.foreground, self.visible, self.windows = [], [], [], {}
        self.polls = 0
        self.hosts, self.rights = {}, {}
        self.nowhere, self.nowhere_polls = 0.0, 0
        self.front, self.given_back = [], None
        self._programs = {}
        self._processes = game_process.WindowsProcesses(kit.HOST)
        self._done = threading.Event()
        self._ready = threading.Event()

    def _program(self, pid):
        """Is the process a program run from under root?"""
        if pid not in self._programs:
            self._programs[pid] = image(pid).lower().startswith(self.root)
        return self._programs[pid]

    def _ours(self, window):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(window, ctypes.byref(pid))
        return self._program(pid.value)

    def allowed(self):
        """Could every host be given the right to take the foreground? (one that never loaded user32 is left out)"""
        return any(r is True for r in self.rights.values()) and all(r in (True, None) for r in self.rights.values())

    def _find_hosts(self):
        """The hosts under root that started since the last look (one Toolhelp snapshot), kept by their process
        handles."""
        for pid, name in self._processes.processes():
            if pid not in self.hosts and name.lower() == kit.HOST.name.lower() and self._program(pid):
                handle = kernel32.OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
                if handle:
                    self.hosts[pid] = handle
                    self.rights[pid] = None

    def _give_rights(self):
        """Each host given the right to take the foreground. Windows answers ERROR_INVALID_PARAMETER until the process
        has loaded user32: asked again at the next poll."""
        for pid in [p for p, r in self.rights.items() if r is None]:
            if user32.AllowSetForegroundWindow(pid):
                self.rights[pid] = True
                continue
            error = ctypes.get_last_error()
            if error != ERROR_INVALID_PARAMETER:
                self.rights[pid] = error

    def _alive(self):
        """Is a host still running?"""
        return any(kernel32.WaitForSingleObject(h, 0) == WAIT_TIMEOUT for h in self.hosts.values())

    def _front(self):
        window = user32.GetForegroundWindow()
        return dict(describe(window), window=int(window)) if window else None

    def _event(self, hook, event, window, obj, child, thread, at):
        if window and obj == OBJID_WINDOW and child == CHILDID_SELF and self._ours(window):
            (self.foreground if event == EVENT_SYSTEM_FOREGROUND else self.shown).append(
                dict(describe(window), at=round(time.time() - self.start, 3)))

    def _events(self):
        self._thread = kernel32.GetCurrentThreadId()
        proc = WinEventProc(self._event)
        hooks = [user32.SetWinEventHook(e, e, None, proc, 0, 0, WINEVENT_OUTOFCONTEXT)
                 for e in (EVENT_SYSTEM_FOREGROUND, EVENT_OBJECT_SHOW)]
        self._ready.set()
        message = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(message))
            user32.DispatchMessageW(ctypes.byref(message))
        for hook in hooks:
            user32.UnhookWinEvent(hook)

    def _poll(self):
        def each(window, _):
            if self._ours(window):
                seen = describe(window)
                self.windows.setdefault(int(window), seen['class'])
                if seen['visible']:
                    self.visible.append(dict(seen, at=round(time.time() - self.start, 3)))
            return True
        each_proc = EnumProc(each)
        since = None                    # when the foreground became no window, a host living
        scan = 0
        while not self._done.wait(0.005):
            if time.time() >= scan:
                self._find_hosts()
                scan = time.time() + HOST_SCAN
            self._give_rights()
            user32.EnumWindows(each_proc, 0)
            front = user32.GetForegroundWindow()
            if front and self._ours(front):
                self.foreground.append(dict(describe(front), at=round(time.time() - self.start, 3), by='poll'))
            if front or not self._alive():
                since = None
            else:
                since = time.time() if since is None else since
                self.nowhere = max(self.nowhere, time.time() - since)
                self.nowhere_polls += 1
            self.polls += 1

    def __enter__(self):
        self.start = time.time()
        self.front = [self._front()]
        self._threads = [threading.Thread(target=self._events, daemon=True), threading.Thread(target=self._poll, daemon=True)]
        for t in self._threads:
            t.start()
        self._ready.wait(10)
        return self

    def __exit__(self, *exc):
        self._done.set()
        user32.PostThreadMessageW(self._thread, WM_QUIT, 0, 0)
        for t in self._threads:
            t.join(10)
        self.front.append(self._front())
        for handle in self.hosts.values():
            kernel32.CloseHandle(handle)
        first = self.front[0]
        if first and not self.front[-1] and user32.IsWindow(first['window']):
            self.given_back = bool(user32.SetForegroundWindow(first['window']))


def build_room(root):
    """A generated room with a light, built with lighting in root (the build folder: its log has LIGHT APPLY)."""
    Image.new('P', (16, 16), 128).save(root / 'gray.pcx')
    scene = Scene('HiddenWindowFixture', packages=[])
    scene.texture(root / 'gray.pcx', 'HiddenWindowGray')
    scene.auto_groups = False
    scene.sub(geom.box((-256, -256, -64), (256, 256, 256), 'HiddenWindowGray'))
    scene.actor('Light', (0, 0, 160), name='FixtureLight', LightBrightness='128', LightRadius='8')
    scene.actor('PlayerStart', (120, 120, 0), name='FixtureStart')
    folder, _ = scene.build(root / 'HiddenWindowFixture.dx', light=True, paths=False)
    return folder


def main(host=None):
    host = Path(host).resolve() / kit.HOST.name if host else kit.HOST
    with tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='host-window-') as temp:
        root = Path(temp)
        with patch.object(kit, 'RUNS', root / 'runs'), patch.object(kit, 'HOST', host):
            with HostWindows(root) as seen:
                folder = build_room(root)
            log = (folder / 'build.log').read_text(errors='replace')
            assert 'UCMapKit|command|LIGHT APPLY' in log and 'UCMapKit|windows|not hidden' not in log, log[-2000:]
            assert seen.polls > 100 and seen.windows, ('no window of the host was seen: nothing proven', seen.polls)
            print('host %s: %d polls, windows %s' % (host.parent, seen.polls, sorted(set(seen.windows.values()))))
            assert not seen.shown, ('a window of the host was shown', seen.shown[:3])
            assert not seen.visible, ('a window of the host was visible', seen.visible[:3])
            assert not seen.foreground, ('a window of the host had the foreground', seen.foreground[:3])
            print('foreground right given %s; no foreground window for %.3f s at most while a host lived (%d polls); in '
                  'front at the start %s, at the end %s%s' % (
                      seen.rights, seen.nowhere, seen.nowhere_polls, seen.front[0], seen.front[-1],
                      '' if seen.given_back is None else '; handed back: %s' % seen.given_back))
            assert seen.nowhere <= NOWHERE_LIMIT, ('the foreground was no window while the host built', seen.nowhere)
            assert seen.front[-1] or not seen.front[0], ('the host left the foreground to no window', seen.front)
    if not seen.allowed():
        print('NOT PROVEN that the foreground is left alone: this process could not give the host the right to take '
              'it (%s); the windows stayed hidden. Run it from the program in front, when nobody uses the PC.'
              % seen.rights, flush=True)
        sys.exit(2)
    print('PASS the host built a lit room with its windows hidden, never in the foreground, and left the foreground '
          'where it was', flush=True)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
