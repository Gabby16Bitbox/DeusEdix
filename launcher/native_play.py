"""Host only the current project's own game process (Revision, or the original Deus Ex) in a native Game panel.

The game remains the user's locally installed executable. No renderer, engine or
game assets are included here. Win32 calls stay behind a small adapter so the
ownership, restoration and geometry rules can be tested without running a game.
"""
import ctypes
from ctypes import wintypes
import math
import os
from pathlib import Path
import secrets
import sys
import threading
import time


WS_CHILD = 0x40000000
WS_POPUP = 0x80000000
WS_MINIMIZE = 0x20000000
WS_CAPTION = 0x00C00000
WS_THICKFRAME = 0x00040000
WS_MINIMIZEBOX = 0x00020000
WS_MAXIMIZEBOX = 0x00010000
WS_SYSMENU = 0x00080000
WS_EX_TOPMOST = 0x00000008
WS_EX_APPWINDOW = 0x00040000
WS_EX_WINDOWEDGE = 0x00000100
WS_EX_CLIENTEDGE = 0x00000200
GWL_STYLE = -16
GWL_EXSTYLE = -20
MONITOR_DEFAULTTONEAREST = 2
WM_NULL = 0x0000
WM_HOTKEY = 0x0312
SMTO_ABORTIFHUNG = 0x0002
MOD_ALT = 0x0001
MOD_NOREPEAT = 0x4000
VK_RETURN = 0x0D
HWND_MESSAGE = -3
HWND_TOPMOST, HWND_NOTOPMOST = -1, -2
SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE = 0x0001, 0x0002, 0x0010
GA_ROOTOWNER = 3
PROCESS_TERMINATE = 0x0001
PROCESS_SET_QUOTA = 0x0100
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_BASIC_INFORMATION = 0                                       # NtQueryInformationProcess's class
JOB_EXTENDED_LIMITS = 9                                             # JobObjectExtendedLimitInformation
JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = 0x00001000
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
# A game window is taken into the panel only once its game answers (ANSWER_WAIT) and the window has then kept the same
# style and rect for SETTLE seconds: Revision's start-up SetRes can turn a new window full screen about 0.1 s after it
# appears (runs 1-2, 28 Oct 2026), and the original game kept a new window windowed for 5 s while it started, then
# turned it full screen (D5 of the game test, 29 Oct 2026).
SETTLE = 1.0
# How long the UI thread waits for the thread of a game window to take a message (WM_NULL) before the panel changes the
# window's style or parent: SetWindowLong and SetParent wait for that thread, which takes none while its game starts or
# loads a map. SetParent on a window whose game had not drawn its first frame held the UI thread until it had (S6b),
# and in D5 the attach's SetWindowLong held it 15 s, then landed on a window by then full screen. A thread that Windows
# counts as hung (5 s without taking a message) answers no at once.
ANSWER_WAIT = 0.1
# A full-screen or minimized game window is waited for this long from when an embed first saw it (the game may still
# make it windowed), then reported instead of embedded.
MODE_WAIT = 10.0
# A game window that the tick has to restyle (repair_child: its style, extended style or parent put back) more than
# RESTYLES times within RESTYLE_SPAN seconds at one size, in one unbroken run (a repair that finds nothing to repair
# ends it), is left alone and reported ('unsettled'). The original game, switched to a window after it opened full
# screen and taken in again, put its frame back at every repair in one unbroken run and never showed its picture, each
# repair holding the UI thread 0.1-0.34 s (D6: e1a 17, e6a 23 and e6b 28 repairs in about 5 s in the game test of
# 29 Oct 2026, f1b-f1d 6 until cut in that of 30 Oct 2026), the window found at the panel's size at every repair. A
# normal attach makes 2-3 restyles (f3d: 3), and Revision's SetRes in the panel 3-4 in one unbroken run, then settles
# (f4c/f4d of the game test of 30 Oct 2026), one restyle finding the window at the size the game chose ('resized'),
# the others at the panel's. Two SetRes can run into each other with no settled repair between them (g1f of the game
# test of 30 Oct 2026: two 0.71 s apart, 3 + 3 restyles, cut), so a 'resized' restyle drops the restyles at the panel's
# size before it, while the 'resized' ones still count: a game that restyles its window at a size of its own at every
# repair is cut like D6. Each repair reads the window before and after it waits for the game (own_size): a SetRes that
# reached the game during that wait went back to the panel's size at that repair's position unseen, and three in one
# run were cut (D2 of a later game test that day, h1d b2 and h1e b5). The original game puts its frame back in answer
# to the repair's own strip of it, around a client at the panel's size, so the second read finds D6 at the panel's
# size too. The limits, on stand-ins (review 2h #0): a SetRes that the game applies after the second read and before
# the repair's asynchronous position reaches it (tens of ms) is still restyled at the panel's size only, so two or
# three in one run with it can still be cut; a SetRes whose window or client is exactly the panel's size counts as the
# panel's; three that touch reach 5, or 6 when the last of them makes 4 restyles; four that reach the window at most
# about 0.5-0.65 s apart are still cut; and own and panel size by turns is cut only while each restyle holds the UI
# thread under about 0.3 s.
RESTYLES, RESTYLE_SPAN = 5, 3.0
# A game whose window vanished from the panel while the game ran on is reported to have stopped with an error once its
# error box shows, or after this long with no window: a game that quits closes its window 0.1-0.4 s before it ends
# (the game test of 29 Oct 2026). That is how any critical error of the game looks from outside (the engine closes its
# window, then shows its error box), full screen asked for in the panel among them, so the report names no single cause.
GONE_WAIT = 2.0
# What the panel reports, by window_mode, about a game window it leaves alone ('fullscreen', 'minimized', 'unsettled':
# RESTYLES) or that vanished with an error while its game ran on ('crashed', worded by what was seen: GONE_WAIT). Taken
# into the panel, a full-screen window broke Revision's renderer (D3D error), and restoring a minimized one from it
# crashed the game with a stack overflow (28 Oct 2026). Full screen asked for in the panel (the video settings, the
# console's ToggleFullscreen) ends both games with a D3D error: D3D9 gives no full screen to a child window (c3 and c7c
# of the game test, 29 Oct 2026).
WINDOW_ERRORS = {
    'fullscreen': 'The game is in full screen, which the editor cannot show. Stop Play, or play it in its own window.',
    'minimized': 'The game window is minimized and cannot be shown in the editor again. Stop Play, then play again.',
    'unsettled': ('The game keeps changing its window inside the editor, so the editor cannot show it. Play it in its '
                  'own window, or Stop Play.'),
    'crashed': ('The game stopped with an error: its window closed while the game ran on. Its error box or log says '
                'why (full screen turned on inside the editor is one cause). Stop Play, then play again.'),
}
# The games a project plays, by executable under the game folder (Revision, or the original game), with what the
# answers about a window of theirs that is not in the panel say of them. retryFromFullScreen: whether a window that
# opened full screen, then was switched to a window by its player, shows its picture once Retry embedding takes it in.
# Revision's does; the original game's keeps putting its frame back and stays black ('unsettled', D6 of the game test,
# 29 Oct 2026), so the page offers Continue in game window instead.
GAMES = {'Revision/System/Revision.exe': dict(retryFromFullScreen=True),
         'System/DeusEx.exe': dict(retryFromFullScreen=False)}
# The names of their executables, lower case: the cover resolves the path of a process (_normal, which opens the
# file) only when its executable has one of them (_kind), never another program's, whose file may lie on a share
# that no longer answers: resolving the executable of every process showing a captioned window held the UI thread
# 21 s at the cover's first look (review su3 #4, 31 Oct 2026).
GAME_NAMES = {Path(exe).name.lower() for exe in GAMES}
# The editor's own programs, by the name of their executable, lower case: a window of one of them in front keeps the
# cover when its process was started by the editor's, directly or not (DESCENT, _foreign): the build host, started by
# the project's worker, whose lighting viewport took the front during a launch and ended the cover (defect 2 of the
# game test of 30 Oct 2026). Not the programs the editor starts for the player (Steam that was not running yet, a
# browser, Blender): a window of theirs in front ends the cover, the editor going behind it, as any other program's
# does (counted as the editor's, one kept the cover until the attach or COVER_LIMIT, then stayed behind the editor:
# cross-check of 30 Oct 2026).
OWN = ('ucmapkithost.exe',)
# The classes of the games' viewport windows, lower case (find_window; Revision's extended client registers its own
# Unreal viewport class). A captioned window of a game that is none of them is a dialog of the game (_Win32.dialog).
VIEWPORTS = ('unrealwindow', 'unrealviewport', 'unrealwwindowsviewportwindow', 'revisionunrealwwindowsviewportwindow',
             'revisionunrealwwindowsviewportwindowlite',
             'deusexunrealwwindowsviewportwindow')                  # the original game's (15 Oct 2026)
# The classes of the shell's desktop windows, lower case: the window in front once the player clicks the desktop
# (Progman, or a WorkerW that holds its icons), the last of all windows. Behind one, the editor's window went under
# every other window (review su2 #5, 30 Oct 2026): _Win32.topmost goes no further than HWND_NOTOPMOST there, and
# one never counts against a dialog of the game (_foreign).
DESKTOPS = ('progman', 'workerw')
# The answers' windowMode while the player's Alt+Enter, kept from the game in the panel (_catch_keys), waits for the
# page, which moves the game into its own window and asks it for full screen there. No error: an older page that does
# not know it plays on in the panel.
FULL_SCREEN_ASKED = 'fullscreenAsked'
# How long a call of the page waits for the UI thread before it answers BUSY. Its task still runs there once the thread
# is free, unless it had not started yet: SetParent held the thread ~5 s while the original game was still starting,
# and that attach went through after its call had answered BUSY (c2 and c2b of the game test, 29 Oct 2026).
UI_WAIT = 3.0
BUSY = 'The desktop window is busy; try again'
# While an embedded Play starts, the editor's window is kept above the others (the cover, asked by the page at the
# launch) until the game's window is in the panel, so that the game's own windows stay behind it: its splash, and its
# window, white from when it opens until its first frame (Revision's 0.62-1.98 s, median 0.80 s, the original game's
# 1.7-6.5 s, median 3.5 s, in the windowed starts of the game tests of 29-30 Oct 2026). A topmost window the game makes
# later lands below it (S6b of the start-up investigation, 29 Oct 2026; the original game's splash, made topmost after
# it shows, in every sample of the 7 covered starts of the game test of 30 Oct 2026). Revision's splash, shown already
# topmost, was above it in the first 50 ms sample of 2 of that test's 21 covered starts, and below it from the next (52
# and 68 ms later), the splash no longer topmost by then, as in the starts without a cover: the cover's tick (100 ms)
# could not come sooner, so the cover is not put back above it. Another program's overlay made topmost later stays above
# it (Discord's, over the game's picture, in that test). Never activated, it goes on only over the editor's own window
# in front, visible and not minimized (around a window that is not maximized, the game's window still shows), and goes
# as the game window is taken in, before it is the panel's child (changed with a child of the game's thread, the
# editor's window waits for that thread: 5.7 s for a stand-in thread that took no messages), when the window is left
# alone or vanished with an error (_window_mode), when another program comes to the front or a dialog of the game
# shows, in front or not (_foreign: the editor's window then goes behind the lower of the two, or only out of the
# topmost windows when that one is topmost itself or the desktop's: _Win32.topmost), when the editor's window is
# minimized or hidden, at a detach (Stop's hand-back, the Game view left, the app's closing), when the page asks, and
# COVER_LIMIT seconds after it went on, whatever the page does: from the launch to the attach took at most 11.3 s for
# Revision and 51.0 s for the original game, whose load under its splash took up to 42 s (the same game tests).
COVER_LIMIT = 60.0
COVER_TICK = 100                                                    # ms between two looks at the cover (UI thread)
# Windows now and then answers a change of a window's z-order band (HWND_TOPMOST, HWND_NOTOPMOST) as done and leaves it
# as it was, while other programs change theirs (16 of about 480 changes with four test processes at once, 30 Oct
# 2026), and takes it asked again at once (4 of 4): the cover asks up to TOPMOST_TRIES times
TOPMOST_TRIES = 3
# How many processes up from that of a window in front the cover looks for the editor's own process (_Win32.descends):
# the build host (OWN) is started by the project's worker (in a working copy through its venv's launcher), which the
# editor's process started. The Alt+Tab switcher and the taskbar are another program's: a player who stays on either
# for a tick of the cover on the way to one of them ends it.
DESCENT = 8


def _payload(value):
    if not isinstance(value, dict):
        raise ValueError('Invalid Game panel request')
    session = value.get('session')
    if not isinstance(session, str) or not 16 <= len(session) <= 256:
        raise ValueError('Invalid project session')
    visible = value.get('visible', True)
    if type(visible) is not bool:
        raise ValueError('Invalid Game panel visibility')
    if 'processToken' in value and (not isinstance(value['processToken'], str) or not 1 <= len(value['processToken']) <= 256):
        raise ValueError('Invalid Play process token')
    rect = value.get('rect')
    if not isinstance(rect, dict):
        raise ValueError('Missing Game panel bounds')
    numbers = [value.get('dpr', 1)] + [rect.get(k) for k in ('x', 'y', 'width', 'height')]
    if any(type(n) not in (int, float) or not math.isfinite(n) for n in numbers):
        raise ValueError('Invalid Game panel bounds')
    dpr, x, y, width, height = numbers
    if not .25 <= dpr <= 8 or max(abs(x), abs(y), width, height) > 65536 or width < 0 or height < 0:
        raise ValueError('Game panel bounds are out of range')
    return session, (x, y, width, height), dpr, visible


def _bounds(rect, dpr, viewport):
    """CSS pixels -> the WebView's device pixels, clipped to its client area."""
    x, y, width, height = rect
    vw, vh = viewport
    left = max(0, min(vw, round(x * dpr)))
    top = max(0, min(vh, round(y * dpr)))
    right = max(left, min(vw, round((x + width) * dpr)))
    bottom = max(top, min(vh, round((y + height) * dpr)))
    # UE1 rounds an odd renderer width up to an even value. Asking for the odd
    # size again in repair_child produces an endless WM_SIZE / SetRes cycle,
    # restoring top-level styles and screen offsets inside the child panel.
    # Round down inside the available area (at most one unused pixel per edge).
    return left, top, (right - left) // 2 * 2, (bottom - top) // 2 * 2


def _child_styles(style, exstyle):
    return ((style | WS_CHILD) & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX |
                                   WS_MAXIMIZEBOX | WS_SYSMENU),
            exstyle & ~(WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE))


def window_mode(style, exstyle, rect, screen):
    """'minimized', 'fullscreen' or 'windowed': a game window, from its style bits and its window rect against its
    monitor's (both x, y, width, height). Full screen is a window with neither WS_CHILD nor a caption that is topmost
    or covers its monitor (Revision's: style 0x14000000, WS_EX_TOPMOST, 3840x2160); a game that minimized itself in the
    panel keeps WS_MINIMIZE (0x7ccf0000). Runs 1 and 2, 28 Oct 2026."""
    if style & WS_MINIMIZE:
        return 'minimized'
    if not style & (WS_CHILD | WS_CAPTION) and (exstyle & WS_EX_TOPMOST or
                                                rect[2] >= screen[2] and rect[3] >= screen[3]):
        return 'fullscreen'
    return 'windowed'


def _mode_of(look):
    """window_mode of a _Win32.snapshot."""
    return window_mode(look['style'], look['exstyle'], look['rect'], look['screen'])


def _normal(path):
    """`path` as the panel compares executables: resolved, in the file system's case"""
    return os.path.normcase(str(Path(path).resolve()))


def _games(folder):
    """GAMES by the path of their executable under the game folder `folder` (_normal)"""
    return {_normal(Path(folder) / exe): game for exe, game in GAMES.items()}


def _active_worker(session):
    manager = sys.modules.get('project_server')
    if manager is None or manager.WORKER:
        raise RuntimeError('Open a project before using embedded Play')
    supervisor = manager.SUPERVISOR
    if not supervisor.lock.acquire(timeout=.5):
        raise RuntimeError('The project is changing; try Play again')
    try:
        worker = supervisor.active
        if (not worker or worker['process'].poll() is not None or
                not secrets.compare_digest(session, worker['session'])):
            raise RuntimeError('This project session is no longer active')
        return manager, worker
    finally:
        supervisor.lock.release()


def _owned_session(session):
    manager, worker = _active_worker(session)
    state = manager.request(worker['url'] + 'api/play_session', worker['session'], timeout=2)
    _, current = _active_worker(session)
    if current is not worker:
        raise RuntimeError('The project changed while opening Game')
    if not isinstance(state, dict):
        raise RuntimeError('The project returned an invalid Play session')
    if state.get('launching') and not state.get('owned') and not state.get('error'):
        return state
    if not state.get('owned') or not state.get('running'):
        raise RuntimeError(state.get('error') or 'The project has no running Play session')
    if type(state.get('pid')) is not int or state['pid'] <= 0 or not state.get('token'):
        raise RuntimeError('The Play session has no verified process identity')
    try:
        if int(state['created']) <= 0:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise RuntimeError('The Play session has no process creation identity') from None
    return state


def _bindings():
    import clr
    clr.AddReference('System.Windows.Forms')
    clr.AddReference('System.Drawing')
    import System.Windows.Forms as forms
    from System import Action
    from System.Drawing import Point, Color
    return forms, Action, Point, Color


class _MonitorInfo(ctypes.Structure):
    _fields_ = [('cbSize', wintypes.DWORD), ('rcMonitor', wintypes.RECT), ('rcWork', wintypes.RECT),
                ('dwFlags', wintypes.DWORD)]


class _WindowClass(ctypes.Structure):
    _fields_ = [('style', wintypes.UINT), ('lpfnWndProc', ctypes.c_void_p), ('cbClsExtra', ctypes.c_int),
                ('cbWndExtra', ctypes.c_int), ('hInstance', wintypes.HINSTANCE), ('hIcon', wintypes.HICON),
                ('hCursor', wintypes.HANDLE), ('hbrBackground', wintypes.HBRUSH), ('lpszMenuName', wintypes.LPCWSTR),
                ('lpszClassName', wintypes.LPCWSTR)]


class _JobLimits(ctypes.Structure):
    """JOBOBJECT_EXTENDED_LIMIT_INFORMATION, its basic limits and I/O counters written out"""
    _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD),
                ('IoInfo', ctypes.c_uint64 * 6), ('ProcessMemoryLimit', ctypes.c_size_t),
                ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t),
                ('PeakJobMemoryUsed', ctypes.c_size_t)]


class _Win32:
    def __init__(self):
        self.user = ctypes.WinDLL('user32', use_last_error=True)
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        u, k = self.user, self.kernel
        pointer = ctypes.c_ssize_t
        self._get_long = getattr(u, 'GetWindowLongPtrW', u.GetWindowLongW)
        self._set_long = getattr(u, 'SetWindowLongPtrW', u.SetWindowLongW)
        self._get_long.argtypes, self._get_long.restype = [wintypes.HWND, ctypes.c_int], pointer
        self._set_long.argtypes, self._set_long.restype = [wintypes.HWND, ctypes.c_int, pointer], pointer
        signatures = {
            'GetParent': ([wintypes.HWND], wintypes.HWND),
            'SetParent': ([wintypes.HWND, wintypes.HWND], wintypes.HWND),
            'IsWindow': ([wintypes.HWND], wintypes.BOOL),
            'IsWindowVisible': ([wintypes.HWND], wintypes.BOOL),
            'IsWindowEnabled': ([wintypes.HWND], wintypes.BOOL),
            'IsIconic': ([wintypes.HWND], wintypes.BOOL),
            'EnableWindow': ([wintypes.HWND, wintypes.BOOL], wintypes.BOOL),
            'GetWindowThreadProcessId': ([wintypes.HWND, ctypes.POINTER(wintypes.DWORD)], wintypes.DWORD),
            'GetWindowRect': ([wintypes.HWND, ctypes.POINTER(wintypes.RECT)], wintypes.BOOL),
            'ClientToScreen': ([wintypes.HWND, ctypes.POINTER(wintypes.POINT)], wintypes.BOOL),
            'GetClientRect': ([wintypes.HWND, ctypes.POINTER(wintypes.RECT)], wintypes.BOOL),
            'GetClassNameW': ([wintypes.HWND, wintypes.LPWSTR, ctypes.c_int], ctypes.c_int),
            'SetWindowPos': ([wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                              ctypes.c_int, ctypes.c_int, wintypes.UINT], wintypes.BOOL),
            'GetForegroundWindow': ([], wintypes.HWND),
            'SetForegroundWindow': ([wintypes.HWND], wintypes.BOOL),
            'SetFocus': ([wintypes.HWND], wintypes.HWND),
            'AttachThreadInput': ([wintypes.DWORD, wintypes.DWORD, wintypes.BOOL], wintypes.BOOL),
            'GetAsyncKeyState': ([ctypes.c_int], ctypes.c_short),
            'GetCursorPos': ([ctypes.POINTER(wintypes.POINT)], wintypes.BOOL),
            'ClipCursor': ([ctypes.POINTER(wintypes.RECT)], wintypes.BOOL),
            'GetAncestor': ([wintypes.HWND, wintypes.UINT], wintypes.HWND),
            'IsChild': ([wintypes.HWND, wintypes.HWND], wintypes.BOOL),
            'MonitorFromWindow': ([wintypes.HWND, wintypes.DWORD], wintypes.HANDLE),
            'GetMonitorInfoW': ([wintypes.HANDLE, ctypes.POINTER(_MonitorInfo)], wintypes.BOOL),
            'RegisterClassW': ([ctypes.POINTER(_WindowClass)], wintypes.ATOM),
            'CreateWindowExW': ([wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_int,
                                 ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.HMENU,
                                 wintypes.HINSTANCE, wintypes.LPVOID], wintypes.HWND),
            'DefWindowProcW': ([wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM], pointer),
            'RegisterHotKey': ([wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT], wintypes.BOOL),
            'UnregisterHotKey': ([wintypes.HWND, ctypes.c_int], wintypes.BOOL),
            'SendMessageTimeoutW': ([wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM, wintypes.UINT,
                                     wintypes.UINT, ctypes.POINTER(ctypes.c_size_t)], pointer),
        }
        for name, (args, result) in signatures.items():
            fn = getattr(u, name)
            fn.argtypes, fn.restype = args, result
        k.OpenProcess.argtypes, k.OpenProcess.restype = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE
        k.CloseHandle.argtypes = [wintypes.HANDLE]
        k.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        k.QueryFullProcessImageNameW.restype = wintypes.BOOL
        k.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        k.GetProcessTimes.restype = wintypes.BOOL
        k.WaitForSingleObject.argtypes, k.WaitForSingleObject.restype = [wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD
        k.GetCurrentThreadId.restype = wintypes.DWORD
        # the process that started a process, as Windows recorded it then (descends)
        self.ntdll = ctypes.WinDLL('ntdll')
        self.ntdll.NtQueryInformationProcess.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p,
                                                         wintypes.ULONG, ctypes.POINTER(wintypes.ULONG)]
        self.ntdll.NtQueryInformationProcess.restype = ctypes.c_long
        k.GetModuleHandleW.argtypes, k.GetModuleHandleW.restype = [wintypes.LPCWSTR], wintypes.HMODULE
        k.CreateJobObjectW.argtypes, k.CreateJobObjectW.restype = [wintypes.LPVOID, wintypes.LPCWSTR], wintypes.HANDLE
        k.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD]
        k.SetInformationJobObject.restype = wintypes.BOOL
        k.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        k.AssignProcessToJobObject.restype = wintypes.BOOL
        self._enum_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        self._procedure_type = ctypes.WINFUNCTYPE(pointer, wintypes.HWND, wintypes.UINT, wintypes.WPARAM,
                                                  wintypes.LPARAM)
        u.EnumWindows.argtypes, u.EnumWindows.restype = [self._enum_type, wintypes.LPARAM], wintypes.BOOL
        # the reply to a question sent without waiting (ask): one callback for every question, kept with this object
        self._reply_type = ctypes.WINFUNCTYPE(None, wintypes.HWND, wintypes.UINT, ctypes.c_size_t, pointer)
        self._reply = self._reply_type(self._replied)
        self._replies, self._questions = {}, 0
        u.SendMessageCallbackW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM,
                                           self._reply_type, ctypes.c_size_t]
        u.SendMessageCallbackW.restype = wintypes.BOOL

    def process(self, pid):
        handle = self.kernel.OpenProcess(0x1000 | 0x00100000, False, pid)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            name, size = ctypes.create_unicode_buffer(32768), wintypes.DWORD(32768)
            if not self.kernel.QueryFullProcessImageNameW(handle, 0, name, ctypes.byref(size)):
                raise ctypes.WinError(ctypes.get_last_error())
            return {'handle': handle, 'pid': pid, 'path': name.value, 'created': str(self._created(handle))}
        except Exception:
            self.close(handle)
            raise

    def _created(self, handle):
        """When the process of `handle` started (its creation time, in 100 ns)"""
        times = [wintypes.FILETIME() for _ in range(4)]
        if not self.kernel.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)):
            raise ctypes.WinError(ctypes.get_last_error())
        return (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime

    def _started(self, pid):
        """(the pid of the process that started the process `pid`, when `pid` started), or None for a process that has
        ended or cannot be looked at"""
        handle = self.kernel.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return None
        try:
            basic = (ctypes.c_size_t * 6)()                         # PROCESS_BASIC_INFORMATION: the parent comes last
            if self.ntdll.NtQueryInformationProcess(handle, PROCESS_BASIC_INFORMATION, basic, ctypes.sizeof(basic),
                                                    None):
                return None
            return int(basic[5]), self._created(handle)
        except OSError:
            return None
        finally:
            self.close(handle)

    def descends(self, pid, ancestor):
        """Whether the process `pid` was started by the process `ancestor`, or by a process that one started, and so on
        (DESCENT processes up at most). Windows gives the pids of processes that ended to new ones: a 'parent' that
        started after the process it would have started is another process, and ends the walk, as one that ended does
        (the editor's worker and a venv's launcher live as long as what they started)."""
        look = self._started(pid)
        for _ in range(DESCENT):
            if look is None:
                return False
            parent, created = look
            look = self._started(parent)
            if look is None or look[1] > created:
                return False                                        # ended, or another process with its pid
            if parent == ancestor:
                return True
        return False

    def close(self, handle):
        if handle:
            self.kernel.CloseHandle(handle)

    def alive(self, process):
        return self.kernel.WaitForSingleObject(process['handle'], 0) == 258

    def pid(self, hwnd):
        pid = wintypes.DWORD()
        self.user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return int(pid.value)

    def find_window(self, pid):
        candidates = []
        def visit(hwnd, _):
            if self.pid(hwnd) == pid and self.user.IsWindowVisible(hwnd) and not self.user.GetParent(hwnd):
                # An engine startup error is a #32770 dialog; embedding that
                # would incorrectly announce a playable viewport.
                if self._class(hwnd).lower() not in VIEWPORTS:
                    return True
                rect = wintypes.RECT()
                if self.user.GetClientRect(hwnd, ctypes.byref(rect)):
                    area = (rect.right - rect.left) * (rect.bottom - rect.top)
                    if area > 10000:
                        candidates.append((area, int(hwnd)))
            return True
        self.user.EnumWindows(self._enum_type(visit), 0)
        # Revision also uses a temporary dialog while loading a map. Ignore it
        # and let the caller keep waiting for the real viewport (or time out).
        return max(candidates)[1] if candidates else None

    def _class(self, hwnd):
        name = ctypes.create_unicode_buffer(256)
        self.user.GetClassNameW(hwnd, name, len(name))
        return name.value

    def error_box(self, pid):
        """Whether the game `pid` shows its error box: a visible dialog of its own (open_dialogs)."""
        return bool(self.open_dialogs(pid))

    def open_dialogs(self, pid=None, also=None):
        """The visible dialogs (dialog) among the top-level windows, owned or not, of the process `pid` (None: of every
        process), and the window `also` if given, shown or not, as (window, its process), in their z-order, the front
        one first: one walk of the windows for both, so that the cover can tell which is lower (_foreign)"""
        found = []
        def visit(hwnd, _):
            if hwnd == also or (self.user.IsWindowVisible(hwnd) and self.dialog(hwnd) and
                                (pid is None or self.pid(hwnd) == pid)):
                found.append((int(hwnd), self.pid(hwnd)))
            return True
        self.user.EnumWindows(self._enum_type(visit), 0)
        return found

    def dialog(self, hwnd):
        """Whether the window `hwnd` of a game is a dialog of the game: captioned and not its viewport (VIEWPORTS),
        as its 'Critical Error' box (class #32770: c3 and c7_crashed of the game tests of 29-30 Oct 2026) or any other
        window it shows with a caption; its splash and the dialogs it shows while it starts have none"""
        return (int(self._get_long(hwnd, GWL_STYLE)) & WS_CAPTION == WS_CAPTION and
                self._class(hwnd).lower() not in VIEWPORTS)

    def snapshot(self, hwnd):
        rect, monitor = wintypes.RECT(), _MonitorInfo()
        monitor.cbSize = ctypes.sizeof(monitor)
        if not self.user.GetWindowRect(hwnd, ctypes.byref(rect)):
            raise ctypes.WinError(ctypes.get_last_error())
        # the monitor the window is on (or the nearest): window_mode compares the window with it
        if not self.user.GetMonitorInfoW(self.user.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST),
                                         ctypes.byref(monitor)):
            raise ctypes.WinError(ctypes.get_last_error())
        screen = monitor.rcMonitor
        return dict(parent=self.user.GetParent(hwnd), style=int(self._get_long(hwnd, GWL_STYLE)) & 0xffffffff,
                    exstyle=int(self._get_long(hwnd, GWL_EXSTYLE)) & 0xffffffff,
                    enabled=bool(self.user.IsWindowEnabled(hwnd)),
                    rect=(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top),
                    screen=(screen.left, screen.top, screen.right - screen.left, screen.bottom - screen.top))

    def answers(self, hwnd):
        """Whether the thread of the window `hwnd` takes messages now: a WM_NULL answered within ANSWER_WAIT, and no at
        once from a thread that Windows counts as hung (SMTO_ABORTIFHUNG)."""
        result = ctypes.c_size_t()
        return bool(self.user.SendMessageTimeoutW(hwnd, WM_NULL, 0, 0, SMTO_ABORTIFHUNG, round(ANSWER_WAIT * 1000),
                                                  ctypes.byref(result)))

    def ask(self, hwnd, answered):
        """WM_NULL sent to the thread of the window `hwnd` without waiting for it: answered() runs on the calling
        thread, from its message loop (the UI thread's), once that thread has taken it, never if it does not.
        -> whether it was sent"""
        self._questions += 1
        self._replies[self._questions] = answered
        if self.user.SendMessageCallbackW(hwnd, WM_NULL, 0, 0, self._reply, self._questions):
            return True
        del self._replies[self._questions]
        return False

    def _replied(self, hwnd, message, question, result):
        answered = self._replies.pop(question, None)
        if answered:
            answered()

    def style(self, hwnd, index, value):
        ctypes.set_last_error(0)
        previous = self._set_long(hwnd, index, value)
        if not previous and ctypes.get_last_error():
            raise ctypes.WinError(ctypes.get_last_error())

    def parent(self, hwnd, parent):
        ctypes.set_last_error(0)
        previous = self.user.SetParent(hwnd, parent)
        if not previous and ctypes.get_last_error():
            raise ctypes.WinError(ctypes.get_last_error())

    def position(self, hwnd, rect, frame=False):
        # The renderer belongs to a different input thread. A synchronous size
        # notification can block the WinForms UI until the JS bridge times out,
        # then the late attach is immediately undone by the error's detach.
        # Do not let UE1 rewrite child coordinates in WM_WINDOWPOSCHANGING.
        flags = 0x0004 | 0x0010 | 0x0040 | 0x4000 | 0x0400 | 0x2000 | (0x0020 if frame else 0)
        if not self.user.SetWindowPos(hwnd, None, *rect, flags):
            raise ctypes.WinError(ctypes.get_last_error())

    def child_geometry(self, hwnd, parent):
        rect, origin = wintypes.RECT(), wintypes.POINT(0, 0)
        if not self.user.GetWindowRect(hwnd, ctypes.byref(rect)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not self.user.ClientToScreen(parent, ctypes.byref(origin)):
            raise ctypes.WinError(ctypes.get_last_error())
        return (rect.left - origin.x, rect.top - origin.y,
                rect.right - rect.left, rect.bottom - rect.top)

    def client_size(self, hwnd):
        rect = wintypes.RECT()
        if not self.user.GetClientRect(hwnd, ctypes.byref(rect)):
            raise ctypes.WinError(ctypes.get_last_error())
        return rect.right - rect.left, rect.bottom - rect.top

    def own_size(self, hwnd, geometry, width, height):
        """Whether the game window `hwnd`, read at `geometry` (child_geometry), is at a size its game chose: neither
        the window's size nor its client area's is the panel's (`width`, `height`)."""
        return geometry[2:] != (width, height) and self.client_size(hwnd) != (width, height)

    def repair_child(self, hwnd, parent, width, height):
        """The game window `hwnd` put back as a child of `parent` that fills it, where it is not (the tick's repair).
        -> 'restyled' (its style, extended style or parent put back: RESTYLES), 'resized' (the same, the window found
        at a size its game chose before or after the repair waits for its game: its own SetRes, own_size), 'moved' (its
        bounds only), None (a restyle that waits while its game does not answer yet) or False (nothing to repair)"""
        # UE1's SetRes can restore overlapped-window styles after initialization
        # or a renderer resize. Reapply only when that actually happened, never
        # resize a healthy viewport on every timer tick.
        style = int(self._get_long(hwnd, GWL_STYLE)) & 0xffffffff
        exstyle = int(self._get_long(hwnd, GWL_EXSTYLE)) & 0xffffffff
        child, child_ex = _child_styles(style, exstyle)
        wrong_parent = self.user.GetParent(hwnd) != parent
        # Original Deus Ex can keep WS_CHILD but move the viewport to screen
        # coordinates during SetRes. Styles alone do not detect that drift.
        geometry = self.child_geometry(hwnd, parent)
        wrong_bounds = geometry != (0, 0, width, height)
        restyle = style != child or exstyle != child_ex or wrong_parent
        if not restyle and not wrong_bounds:
            return False
        # at a size its game chose ('resized'): neither the window nor its client area at the panel's size (the
        # original game puts its frame back around a client at the panel's size at every repair: D6)
        resized = restyle and self.own_size(hwnd, geometry, width, height)
        # Style and parent changes wait for the game's thread: one that takes no messages now (a map loading) is
        # repaired at a later tick instead of holding the UI thread (ANSWER_WAIT). A bounds-only repair asks nothing:
        # SetWindowPos with SWP_ASYNCWINDOWPOS (position) never waits.
        if restyle and not self.answers(hwnd):
            return None                                             # not settled: the run of restyles goes on
        if style != child:
            self.style(hwnd, GWL_STYLE, child)
        if exstyle != child_ex:
            self.style(hwnd, GWL_EXSTYLE, child_ex)
        if wrong_parent:
            self.parent(hwnd, parent)
        # a SetRes that reached the game while those calls waited is seen only now: the position below puts its window
        # back at the panel's size before any later repair can find it (D2 of the game test of 30 Oct 2026)
        resized = resized or restyle and self.own_size(hwnd, self.child_geometry(hwnd, parent), width, height)
        # A frame-changed notification here causes UE1 to run SetRes again,
        # recreating the very same frame and repeating WM_SIZE indefinitely.
        self.position(hwnd, (0, 0, width, height), frame=False)
        return ('resized' if resized else 'restyled') if restyle else 'moved'

    def enabled(self, hwnd, value):
        self.user.EnableWindow(hwnd, value)

    def exists(self, hwnd):
        return bool(hwnd and self.user.IsWindow(hwnd))

    def foreground(self, form, hwnd):
        """Whether the foreground window is the editor's `form`, a window whose root (GA_ROOT) is the form, or the
        window `hwnd`; no while Windows has none (the window in front just closed or minimized, a locked PC), which
        Continue in game window's check (`hwnd` None) took for the editor's (review su4 #3, 31 Oct 2026)"""
        active = self.user.GetForegroundWindow()
        if not active:
            return False
        return active in (form, hwnd) or self.user.GetAncestor(active, 2) == form

    def focus(self, hwnd, form):
        current = self.kernel.GetCurrentThreadId()
        target = self.user.GetWindowThreadProcessId(hwnd, None)
        joined = bool(target != current and self.user.AttachThreadInput(current, target, True))
        try:
            self.user.SetForegroundWindow(form)
            self.user.SetFocus(hwnd)
        finally:
            if joined:
                self.user.AttachThreadInput(current, target, False)

    def release_cursor(self):
        self.user.ClipCursor(None)

    def key(self, vk):
        return bool(self.user.GetAsyncKeyState(vk) & 0x8000)

    def cursor(self):
        point = wintypes.POINT()
        self.user.GetCursorPos(ctypes.byref(point))
        return point.x, point.y

    def front(self, hwnd):
        """`hwnd` made the foreground window (the editor's form is, and may hand that on)."""
        self.user.SetForegroundWindow(hwnd)

    def in_front(self):
        """The window in front (the foreground window's top-level owner) and its process; (None, 0) while none is"""
        active = self.user.GetForegroundWindow()
        if not active:
            return None, 0
        root = self.user.GetAncestor(active, GA_ROOTOWNER) or active
        return int(root), self.pid(root)

    def shown(self, hwnd):
        """Whether the window `hwnd` is visible and not minimized"""
        return bool(self.user.IsWindowVisible(hwnd)) and not self.user.IsIconic(hwnd)

    def topmost(self, hwnd, on, behind=None):
        """The top-level window `hwnd` kept above every other window (on) or no longer, never activated: no focus
        taken from the program in front; asked again while its WS_EX_TOPMOST does not say so (TOPMOST_TRIES). No
        longer, it goes behind the window `behind` if given: HWND_NOTOPMOST alone leaves it above every window that is
        not topmost, the one in front among them. Behind a window that is topmost itself (the taskbar, Start, the
        Alt+Tab switcher, another program's always-on-top window) Windows makes it topmost again (review su #3, 30 Oct
        2026): there it goes no further than HWND_NOTOPMOST, and the program the player goes to comes above it as it
        is activated; a `behind` that turned topmost meanwhile is caught by the look after the move. Behind the shell's
        desktop window (desktop), the last of all, it went under every other window (review su2 #5, 30 Oct 2026):
        there too it goes no further than HWND_NOTOPMOST, where Windows leaves it as the desktop is clicked.
        -> whether it is as asked"""
        flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
        for _ in range(TOPMOST_TRIES):
            self.user.SetWindowPos(hwnd, HWND_TOPMOST if on else HWND_NOTOPMOST, 0, 0, 0, 0, flags)
            if self._topmost(hwnd) != on:
                continue                                            # dropped: asked again
            if on or not behind or self._topmost(behind) or self.desktop(behind):
                return True
            self.user.SetWindowPos(hwnd, behind, 0, 0, 0, 0, flags)
            if not self._topmost(hwnd):
                return True
        return False

    def _topmost(self, hwnd):
        """Whether the window `hwnd` is topmost now (WS_EX_TOPMOST)"""
        return bool(int(self._get_long(hwnd, GWL_EXSTYLE)) & WS_EX_TOPMOST)

    def desktop(self, hwnd):
        """Whether the window `hwnd` is one of the shell's desktop windows (DESKTOPS)"""
        return self._class(hwnd).lower() in DESKTOPS

    def keys_window(self, pressed):
        """A message-only window of the calling thread, the UI thread whose message loop runs it: pressed() when the
        hotkey of catch_keys comes (WM_HOTKEY), nothing else. -> its handle"""
        def procedure(hwnd, message, wparam, lparam):
            if message == WM_HOTKEY:
                pressed()
                return 0
            return self.user.DefWindowProcW(hwnd, message, wparam, lparam)
        self._procedure = self._procedure_type(procedure)           # kept for as long as the window may call it
        instance, name = self.kernel.GetModuleHandleW(None), 'DeusEdixGameKeys%x' % id(self)
        window_class = _WindowClass(lpfnWndProc=ctypes.cast(self._procedure, ctypes.c_void_p), hInstance=instance,
                                    lpszClassName=name)
        if not self.user.RegisterClassW(ctypes.byref(window_class)):
            raise ctypes.WinError(ctypes.get_last_error())
        hwnd = self.user.CreateWindowExW(0, name, None, 0, 0, 0, 0, 0, HWND_MESSAGE, None, instance, None)
        if not hwnd:
            raise ctypes.WinError(ctypes.get_last_error())
        return hwnd

    def catch_keys(self, hwnd, on):
        """Alt+Enter kept from every window and sent to `hwnd` instead (its WM_HOTKEY, the window's only hotkey: id 1),
        or let go; from the thread of `hwnd`. -> whether it is caught now (another program may hold it)"""
        if on:
            return bool(self.user.RegisterHotKey(hwnd, 1, MOD_ALT | MOD_NOREPEAT, VK_RETURN))
        self.user.UnregisterHotKey(hwnd, 1)
        return False

    def job(self, pid):
        """A job object holding the game `pid` that ends it when its last handle closes (KILL_ON_JOB_CLOSE): the
        editor's, when the editor's process ends, however it ends. Only the game itself (what it starts breaks away);
        nested in a job the game may be in already (Windows 8 and later). -> its handle"""
        process = self.kernel.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, False, pid)
        if not process:
            raise ctypes.WinError(ctypes.get_last_error())
        job = self.kernel.CreateJobObjectW(None, None)
        try:
            if not (job and self._job_limits(job, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
                                             JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK)
                    and self.kernel.AssignProcessToJobObject(job, process)):
                raise ctypes.WinError(ctypes.get_last_error())
        except Exception:
            self.close(job)                                         # nothing is in it
            raise
        finally:
            self.close(process)
        return job

    def free_job(self, job):
        """The game in `job` outlives the editor again: the limit goes (a process stays in its job for life), then the
        handle. Kept open if the limit stays: closing it would end the game."""
        if self._job_limits(job, 0):
            self.close(job)

    def _job_limits(self, job, flags):
        limits = _JobLimits(LimitFlags=flags)
        return bool(self.kernel.SetInformationJobObject(job, JOB_EXTENDED_LIMITS, ctypes.byref(limits),
                                                        ctypes.sizeof(limits)))


class NativeGamePanel:
    def __init__(self, window, game_folder, *, _win=None, _native_bindings=None,
                 _session_lookup=None, _worker_check=None, _clock=None):
        self._window, self._game_folder = window, game_folder
        self._win, self._bindings = _win, _native_bindings
        self._session_lookup = _session_lookup or _owned_session
        self._worker_check = _worker_check or _active_worker
        self._clock = _clock or time.monotonic
        self._panel = self._timer = None
        self._process = self._hwnd = self._original = None
        self._session = self._token = None
        self._captured = False
        self._visible = True
        self._error = ''
        self._handlers = []
        self._last_mouse = False
        self._last_release = False
        self._rect = None
        self._game_size = None
        self._target_size = None
        self._last_resize = self._last_repair = 0
        # when the tick restyled the game window in the panel (repair_child) since the window last got a new size or
        # settled, as (time, own) pairs: own when it found the window at a size its game chose ('resized', RESTYLES)
        self._restyles = []
        # the game window an embed is waiting for (_ready: its shape, whether its game answers, since when), or with no
        # window the game whose window vanished from the panel while it ran on (_crashed); the mode of one the panel
        # leaves alone or reports (window_mode's 'fullscreen' or 'minimized', 'unsettled' or 'crashed'; '' while there
        # is none)
        self._seen = None
        self._window_mode = ''
        # the game process of the page's Play as embed last found it (pid, creation time), kept past a detach: the page
        # detaches at every error, before its player may choose Continue in game window (_detach_to_front)
        self._claimed = None
        # the message window that gets Alt+Enter while it is kept from the game (_catch_keys), whether it is now, and
        # whether the player pressed it (FULL_SCREEN_ASKED); the job that ends an embedded game with the editor
        self._keys = None
        self._caught = self._asked = False
        self._job = None
        # the cover while an embedded Play starts (COVER_LIMIT): since when, the paths of GAMES under the game folder,
        # and what each process seen in front or showing a dialog was found to be ('game', 'editor' or '': _kind);
        # None while it is off. Its timer, kept with its handler.
        self._cover = None
        self._cover_timer = self._cover_watch = None
        self._supported = sys.platform == 'win32' or _win is not None

    def _on_ui(self, task):
        form = self._window.native
        if form is None or form.IsDisposed or form.Disposing or not form.IsHandleCreated:
            raise RuntimeError('The desktop window is not ready')
        if self._bindings is None:
            self._bindings = _bindings()
        if self._win is None:
            self._win = _Win32()
        result, error, finished, cancelled = [], [], threading.Event(), threading.Event()
        def run():
            if cancelled.is_set():
                finished.set()
                return
            try:
                result.append(task(form))
            except Exception as exc:
                error.append(exc)
            finally:
                finished.set()
        if form.InvokeRequired:
            form.BeginInvoke(self._bindings[1](run))
            if not finished.wait(UI_WAIT):
                cancelled.set()
                raise RuntimeError(BUSY)
        else:
            run()
        if error:
            raise error[0]
        return result[0] if result else None

    def _state(self, **extra):
        return dict(supported=self._supported, attached=self._hwnd is not None,
                    captured=self._captured, pid=self._process['pid'] if self._process else None,
                    error=self._error or WINDOW_ERRORS.get(self._window_mode, ''),
                    windowMode=self._window_mode or (FULL_SCREEN_ASKED if self._asked else ''),
                    covered=self._cover is not None, **extra)

    def capabilities(self):
        return dict(self._state(), releaseShortcut='Shift+F1', mode='native-window')

    def _same_process(self):
        return (self._process and self._win.alive(self._process) and self._win.exists(self._hwnd)
                and self._win.pid(self._hwnd) == self._process['pid'])

    def _ensure_panel(self, form):
        if self._panel is not None and not self._panel.IsDisposed:
            return
        forms, _, _, color = self._bindings
        panel = forms.Panel()
        panel.Name = 'DeusEdixGamePanel'
        panel.BackColor = color.Black
        panel.TabStop = False
        panel.Visible = False
        form.Controls.Add(panel)
        self._panel = panel
        timer = forms.Timer()
        timer.Interval = 40
        def tick(sender, args):
            try:
                self._tick(form)
            except Exception as exc:
                self._error = 'Game panel: ' + str(exc)
                self._release(form)
        def clicked(sender, args):
            if self._visible:
                self._capture(form)
        timer.Tick += tick
        panel.MouseDown += clicked
        self._handlers = [tick, clicked]
        self._timer = timer
        if self._keys is None:
            try:
                self._keys = self._win.keys_window(self._alt_enter)
            except OSError:
                self._keys = 0                                      # Alt+Enter then reaches the game, as before

    def _layout(self, form, rect, dpr, visible):
        browser = getattr(form, 'webview', None)
        if browser is None or browser.IsDisposed:
            raise RuntimeError('The WebView is unavailable')
        point = self._bindings[2]
        origin = form.PointToClient(browser.PointToScreen(point(0, 0)))
        bounds = _bounds(rect, dpr, (int(browser.ClientSize.Width), int(browser.ClientSize.Height)))
        x, y, width, height = bounds
        self._visible = visible and width >= 4 and height >= 4
        if not self._visible:
            self._release(form)
            self._panel.Visible = False
            return
        self._panel.SetBounds(int(origin.X) + x, int(origin.Y) + y, width, height)
        self._panel.Visible = True
        self._panel.BringToFront()
        self._target_size = width, height
        self._resize_game()
        self._rect = rect, dpr

    def _resize_game(self):
        # Follow drag geometry immediately with the host panel, but coalesce
        # costly renderer resets to the latest size at most ten times/second.
        now = self._clock()
        if (not self._window_mode and self._same_process() and self._target_size
                and self._game_size != self._target_size
                and (self._game_size is None or now - self._last_resize >= .1)):
            self._win.position(self._hwnd, (0, 0, *self._target_size), frame=False)
            self._game_size = self._target_size
            self._last_resize = self._last_repair = now
            # the game's SetRes may restyle its window at each new size: only the restyles at one size count (RESTYLES)
            self._restyles = []

    def _capture(self, form):
        if self._same_process() and self._visible and not self._window_mode:
            self._win.enabled(self._hwnd, True)
            self._win.focus(self._hwnd, int(form.Handle.ToInt64()))
            self._captured = bool(self._win.foreground(int(form.Handle.ToInt64()), self._hwnd))
            if not self._captured:
                self._win.enabled(self._hwnd, False)
                self._win.release_cursor()

    def _release(self, form):
        if self._win is None:
            return
        # a window left alone is neither focused nor disabled: EnableWindow waits for its busy game to answer
        if self._same_process() and not self._window_mode:
            browser = getattr(form, 'webview', None)
            if (browser is not None and not browser.IsDisposed and
                    self._win.foreground(int(form.Handle.ToInt64()), self._hwnd)):
                self._win.focus(int(browser.Handle.ToInt64()), int(form.Handle.ToInt64()))
            self._win.enabled(self._hwnd, False)
        if self._hwnd is not None or self._captured:
            self._win.release_cursor()
        self._captured = False
        self._catch_keys(False)

    def _detach(self, form):
        self._uncover(form)                                         # Stop's hand-back, the Game view left, the closing
        if self._timer:
            self._timer.Stop()
        self._catch_keys(False)
        if self._hwnd is not None or self._captured:
            self._win.release_cursor()
        failure = None
        if self._same_process() and self._original:
            original = self._original
            try:
                # Restore while the process handle still pins the identity. A full-screen or minimized window is
                # only handed back as it is now (its own style without WS_CHILD, no size or frame change): restored
                # to its old size with a frame change, a minimized game re-created its renderer inside that message
                # and crashed (stack overflow; a test run and two real Plays, 28 Oct 2026). An unsettled one is a
                # windowed window that its game kept restyling: restored as it came, like any windowed one.
                look = self._win.snapshot(self._hwnd)
                restore = self._window_mode in ('', 'unsettled') and _mode_of(look) == 'windowed'
                self._win.parent(self._hwnd, original['parent'])
                self._win.style(self._hwnd, GWL_STYLE, original['style'] if restore else look['style'] & ~WS_CHILD)
                self._win.style(self._hwnd, GWL_EXSTYLE, original['exstyle'] if restore else
                                look['exstyle'] | original['exstyle'] & WS_EX_APPWINDOW)
                self._win.enabled(self._hwnd, original['enabled'])
                if restore:
                    self._win.position(self._hwnd, original['rect'], frame=True)
                    if self._asked:
                        # its player asked for full screen, which the page asks of it next: a game takes the screen
                        # only as the foreground window
                        self._win.front(self._hwnd)
            except Exception as exc:
                failure = exc
        if failure:
            # Do not dispose a parent that may still contain a live game HWND.
            raise RuntimeError('Could not detach the game window: ' + str(failure))
        if self._panel:
            self._panel.Visible = False
        if self._job is not None:
            self._win.free_job(self._job)                           # handed back or ended: it may outlive the editor
        if self._process:
            self._win.close(self._process['handle'])
        self._process = self._hwnd = self._original = self._job = None
        self._session = self._token = None
        self._game_size = None
        self._target_size = None
        self._last_resize = self._last_repair = 0
        self._restyles = []
        self._captured = self._asked = False
        self._seen = None
        self._window_mode = ''

    def _detach_to_front(self, form):
        """detach(front), on the UI thread: Continue in game window. The game's window handed back, then made the
        foreground window while the editor's window is in front (its player's click made it so; a task the UI thread
        ran after the player went to another program brings nothing to the front): a window never taken into the panel
        lay under the editor's, which a cover that ended without an attach and the click both leave above it, and its
        player had to find it with Alt+Tab (review su3 #5, 31 Oct 2026). The window in the panel, or else that of the
        process the page's Play claimed (_claimed_window), is looked for before the detach lets go of its process. One
        that the detach made the foreground window itself (Alt+Enter: _asked) is not asked again."""
        hwnd = self._hwnd if self._same_process() else self._claimed_window()
        self._detach(form)
        if hwnd and self._win.foreground(int(form.Handle.ToInt64()), None):
            self._win.front(hwnd)

    def _claimed_window(self):
        """The window of the game process the page's Play claimed (_claimed), as find_window finds it, or None once
        that process has ended (another process may have its pid: its creation time differs) or none was claimed"""
        if not self._claimed:
            return None
        pid, created = self._claimed
        try:
            process = self._win.process(pid)
        except OSError:
            return None                                             # ended, or one the editor cannot look at
        try:
            return self._win.find_window(pid) if process['created'] == created and self._win.alive(process) else None
        finally:
            self._win.close(process['handle'])

    def _detach_gone(self, form):
        """Detach the game window if it is gone: its game ended (Stop, its own Quit), or runs on without it, which
        embed then watches (_crashed). An error about that window goes with it (a tick that raced it as it vanished),
        so that the answers after say what embed finds. -> whether it was gone"""
        if self._same_process():
            return False
        pid = self._process['pid'] if self._process and self._win.alive(self._process) else None
        self._detach(form)
        self._error = ''
        if pid:
            now = self._clock()
            self._seen = dict(window=(pid, None), shape=None, asked=False, answered=False, first=now, since=now)
        return True

    def _leave_alone(self, mode):
        """Stop holding a game window that minimized itself in the panel (a lost focus), turned full screen there, or
        that its game keeps restyling there ('unsettled': RESTYLES): no repair, resize, focus or enable for it from
        now on, the pointer freed, and every answer reports it (_state) until it is detached. A minimized one was
        repaired 470 times in 100 s while the UI thread stalled (run 2, 28 Oct 2026). Neither game was seen full screen
        in the panel: Revision keeps WS_CHILD there and the original game closes its window, and both stop with a D3D
        error (c3 and c7c of the game test, 29 Oct 2026: _crashed); Alt+Enter is kept from them (_catch_keys)."""
        self._window_mode = mode
        self._captured = False
        self._win.release_cursor()

    def _catch_keys(self, on):
        """Alt+Enter kept from the game while it has the keyboard in the panel (on), and only then: full screen asked
        for there ends both games with a D3D error (c3 and c7c of the game test, 29 Oct 2026). The player's press is
        reported instead (FULL_SCREEN_ASKED), and the page plays the game full screen in its own window."""
        if self._keys and on != self._caught:
            self._caught = self._win.catch_keys(self._keys, on)

    def _alt_enter(self):
        """WM_HOTKEY, on the UI thread: the player pressed Alt+Enter, which _catch_keys kept from the game. Only while
        the game has the keyboard in the panel: one handled late (the UI thread held by a display change or SetParent)
        after the player went to another program, or after the game was let go, asks nothing and lets the key go at
        once."""
        if self._captured and self._win.foreground(int(self._window.native.Handle.ToInt64()), self._hwnd):
            self._asked = True
        else:
            self._catch_keys(False)

    def cover(self, on):
        """game_cover: the editor's window kept above every other window while an embedded Play starts (on: the page
        asks at the launch) until the game's window is in the panel or another end comes (COVER_LIMIT), or let go
        (off). Every change on the UI thread, never on the caller's: a form changed from another thread waits for the
        UI thread while holding Python's lock, which the panel's timer on the UI thread waits for (S7 of the start-up
        investigation, 29 Oct 2026: both hung). -> whether it is on, and the error of a call that failed"""
        try:
            if type(on) is not bool:
                raise ValueError('Invalid cover request')
            folder = self._game_folder() if on else None
            if on and not folder:
                raise RuntimeError('The local Deus Ex installation is not configured')
            games = _games(folder) if on else None
            self._on_ui(lambda form: self._cover_on(form, games) if on else self._uncover(form))
            return dict(covered=self._cover is not None, error='')
        except Exception as exc:
            return dict(covered=self._cover is not None, error=str(exc))

    def _cover_on(self, form, games):
        """The cover put on, on the UI thread: only over the editor's own window in front (where its player pressed
        Play), visible and not minimized, while no game window is in the panel; then watched (_watch_cover)"""
        handle = int(form.Handle.ToInt64())
        if self._cover is not None or self._hwnd is not None or not self._win.shown(handle):
            return
        self._cover = dict(since=self._clock(), games=games, known={})
        if self._foreign(handle) or not self._win.topmost(handle, True):
            self._cover = None
            return
        if self._cover_timer is None:
            timer = self._bindings[0].Timer()
            timer.Interval = COVER_TICK
            def watch(sender, args):
                try:
                    self._watch_cover(form)
                except Exception:
                    # watched no longer: let go with its timer once Windows takes it, asked again at the next tick
                    if self._win.topmost(handle, False):
                        self._cover = None
                        timer.Stop()
            timer.Tick += watch
            self._cover_timer, self._cover_watch = timer, watch
        self._cover_timer.Start()

    def _watch_cover(self, form):
        """The cover's timer, on the UI thread: let go once the game window is left alone or vanished with an error
        (_window_mode), when another program comes to the front or a dialog of the game shows (_foreign: the editor's
        window then goes behind it), when the editor's window is minimized or hidden, and COVER_LIMIT seconds after it
        went on (the attach lets it go itself), at every end behind what _foreign gives, so never left above a dialog of
        the game; one that Windows did not let go yet is asked again ('going')"""
        if self._cover is None:
            self._cover_timer.Stop()
            return
        if 'going' in self._cover:
            self._uncover(form, self._cover['going'])
            return
        handle = int(form.Handle.ToInt64())
        front = self._foreign(handle)
        if (front or self._window_mode or not self._win.shown(handle) or
                self._clock() - self._cover['since'] >= COVER_LIMIT):
            self._uncover(form, front)

    def _uncover(self, form, behind=None):
        """The cover let go, on the UI thread: the editor's window no longer above every other window, and behind the
        window `behind` (another program's in front, or a dialog of the game: _foreign) if given. A change Windows
        does not take (TOPMOST_TRIES) leaves the cover on, 'going': its timer asks again at its next tick."""
        if self._cover is None:
            return
        if not self._win.topmost(int(form.Handle.ToInt64()), False, behind):
            self._cover['going'] = behind
            return
        self._cover = None
        if self._cover_timer is not None:
            self._cover_timer.Stop()

    def _foreign(self, handle):
        """The window the editor's window goes behind as the cover ends, or None while the cover stays: the lowest of
        the window in front, if it is another program's, and of the dialogs of the game that show, in front or not
        (dialog: the 'Critical Error' box of a start that failed showed behind the game's splash, which stayed the
        window in front, defect B of the second game test of 30 Oct 2026), so that the editor's window ends below them
        all. The editor's are its window `handle`, the windows it owns, those of its process, and those of its own
        programs (OWN: its build host, defect 2 of the game test of 30 Oct 2026) that it started, directly or not
        (DESCENT), but not of the programs it starts for the player (Steam, a browser, Blender); its game's, those of a
        process of one of the cover's GAMES (the game takes the front as it starts: S6b), but not its dialogs, which
        end the cover (_kind)."""
        window, pid = self._win.in_front()
        theirs = window if window and window != handle and pid != os.getpid() and not self._kind(pid) else None
        # the desktop's window, the last of all, does not count against a dialog: behind it the editor's window goes no
        # further than HWND_NOTOPMOST (_Win32.topmost), above the dialog
        lower = theirs if theirs and not self._win.desktop(theirs) else None
        windows = [shown for shown, owner in self._win.open_dialogs(also=lower)
                   if shown == lower or self._kind(owner) == 'game']
        return windows[-1] if windows else theirs

    def _kind(self, pid):
        """What the process `pid` is to the cover: 'game' (a process of one of its GAMES), 'editor' (one of the editor's
        own programs that the editor started, directly or not: OWN, DESCENT) or '' (another program, or one that the
        editor cannot look at); each process looked at once a cover, by the name of its executable first: only one
        named as a game's is compared with the cover's GAMES, by its path as Windows gives it, resolved only when that
        is none of them (GAME_NAMES)"""
        known = self._cover['known']
        if pid not in known:
            try:
                process = self._win.process(pid)
                self._win.close(process['handle'])
                path, games = process['path'], self._cover['games']
                name = Path(path).name.lower()
                game = name in GAME_NAMES and (os.path.normcase(path) in games or _normal(path) in games)
                known[pid] = ('game' if game else
                              'editor' if name in OWN and self._win.descends(pid, os.getpid()) else '')
            except OSError:
                known[pid] = ''                                     # one the editor cannot look at is another's
        return known[pid]

    def _tick(self, form):
        if self._detach_gone(form):
            return
        if not self._window_mode:
            mode = _mode_of(self._win.snapshot(self._hwnd))
            if mode != 'windowed':
                self._leave_alone(mode)
        if self._visible and not self._window_mode:
            self._resize_game()
            now = self._clock()
            # A queued resize needs time to reach the game before measuring it.
            if self._game_size and now - self._last_repair >= .1:
                repaired = self._win.repair_child(self._hwnd, int(self._panel.Handle.ToInt64()), *self._game_size)
                if repaired in ('restyled', 'resized'):
                    # a window found at a size its game chose is a SetRes of the game's own: the restyles at the
                    # panel's size before it no longer count, the SetRes themselves do (g1f, RESTYLES)
                    self._restyles = [(at, own) for at, own in self._restyles
                                      if now - at < RESTYLE_SPAN and (own or repaired == 'restyled')]
                    self._restyles.append((now, repaired == 'resized'))
                    if len(self._restyles) > RESTYLES:
                        self._leave_alone('unsettled')              # its game puts its frame back at every repair
                elif repaired is False:
                    self._restyles = []                             # settled: a SetRes's restyles end, D6's never do
                self._last_repair = now
        foreground = self._win.foreground(int(form.Handle.ToInt64()), self._hwnd)
        release = self._win.key(0x10) and self._win.key(0x70)
        mouse = self._win.key(1)
        if foreground and release and not self._last_release:
            self._release(form)
        elif foreground and mouse and not self._last_mouse and not self._captured and self._visible:
            x, y = self._win.cursor()
            point = self._bindings[2]
            origin = self._panel.PointToScreen(point(0, 0))
            if origin.X <= x < origin.X + self._panel.Width and origin.Y <= y < origin.Y + self._panel.Height:
                self._capture(form)
        elif not foreground and self._captured:
            # Alt+Tab must never leave the pointer trapped in another window, nor Alt+Enter kept from it: the key goes
            # first, as EnableWindow waits for a busy game (a map loading)
            self._catch_keys(False)
            self._win.release_cursor()
            self._win.enabled(self._hwnd, False)
            self._captured = False
        self._last_release, self._last_mouse = release, mouse
        self._catch_keys(foreground and self._captured and not self._window_mode)

    def _ready(self, pid, hwnd, look):
        """Whether the game window an embed found may be taken into the panel: windowed, its game answering, and the
        window the same (style, rect) for SETTLE seconds since its game first answered, by the launcher's clock,
        however often the page calls embed (on every state or layout change, at least every 0.5 s, and when the
        answers say the window may be taken in: readyIn). The game is asked without waiting (ask) when its window is
        first seen windowed, and answers when its thread first takes messages, at its first frame: no question holds
        the UI thread while the game starts (the first one of every Play of the game tests of 29-30 Oct 2026 went
        unanswered, Revision's holding it 0.10-0.20 s, and the next came a SETTLE later, 0.3-0.9 s after the first
        frame). Once SETTLE is over it is asked again, waiting ANSWER_WAIT at most, just before the attach; one that no
        longer answers is asked again without waiting, and SETTLE starts again at its answer. A full-screen or minimized
        window is waited for MODE_WAIT seconds from when it was first seen, then left alone and reported (_window_mode),
        never attached or asked: so is one that turns full screen as its game ends a start with no answer (D5 of the
        game test, 29 Oct 2026: at its first frame). Its game's answer from before is dropped, so that no answer gives
        it a readyIn (review su #6: the page called embed back to back until MODE_WAIT), and its game is asked again
        once it is windowed."""
        now, shape = self._clock(), (look['style'], look['exstyle'], look['rect'])
        if not self._seen or self._seen['window'] != (pid, hwnd):
            self._seen = dict(window=(pid, hwnd), shape=shape, asked=False, answered=False, first=now, since=now)
        elif self._seen['shape'] != shape:
            self._seen.update(shape=shape, since=now)
        mode = _mode_of(look)
        self._window_mode = mode if mode != 'windowed' and now - self._seen['first'] >= MODE_WAIT else ''
        seen = self._seen
        if mode != 'windowed':
            seen.update(asked=False, answered=False)                # its game's answer from before: no readyIn
            return False
        if seen['answered'] and now - seen['since'] >= SETTLE:
            if self._win.answers(hwnd):
                return True
            seen.update(asked=False, answered=False, since=now)     # no longer answering: asked again below
        if not seen['asked']:
            seen['asked'] = self._win.ask(hwnd, lambda: seen.update(answered=True, since=self._clock()))
        return False

    def _ready_in(self):
        """{'readyIn': seconds} until the window an embed waits for may be taken in (SETTLE after its game's answer),
        for the page to call embed again then; nothing while its game has not answered since the window was last seen
        windowed (_ready)"""
        if not self._seen or not self._seen.get('answered'):
            return {}
        return dict(readyIn=round(max(0.0, self._seen['since'] + SETTLE - self._clock()), 3))

    def _crashed(self, pid):
        """Whether the game `pid`, whose window vanished from the panel while it ran on (_detach_gone), stopped with an
        error: its error box shows (error_box), or it has had no window for GONE_WAIT seconds. Reported from then on
        (window_mode 'crashed') until a window of its own shows again (_ready)."""
        if not self._seen or self._seen['window'] != (pid, None):
            return False
        if self._win.error_box(pid) or self._clock() - self._seen['first'] >= GONE_WAIT:
            self._window_mode = 'crashed'
        return self._window_mode == 'crashed'

    def embed(self, value):
        process = None
        try:
            if not self._supported:
                raise RuntimeError('Embedded Play is available in the Windows desktop app')
            session, rect, dpr, visible = _payload(value)
            state = self._session_lookup(session)
            if value.get('processToken') and value['processToken'] != state.get('token'):
                raise RuntimeError('This Play process has been replaced by a newer session')
            if state.get('launching') and not state.get('owned') and not state.get('error'):
                self._error = ''
                # no window of a launching game yet: a report about an earlier game's window that was never attached is
                # not its own (only read here: this is not the UI thread)
                return (self._state(pending=True) if self._hwnd is not None else
                        dict(self._state(pending=True), windowMode='', error=''))
            expected = self._game_folder()
            if not expected:
                raise RuntimeError('The local Deus Ex installation is not configured')
            # a project plays Revision (Revision\System\Revision.exe) or the original game (System\DeusEx.exe): GAMES
            games = _games(expected)
            if self._win is None:
                self._win = _Win32()
            process = self._win.process(state['pid'])
            game = games.get(_normal(process['path']))
            if game is None or str(process['created']) != str(state['created']) or not self._win.alive(process):
                raise RuntimeError('The Play process no longer matches the local game installation')
            def attach(form):
                nonlocal process
                self._worker_check(session)
                self._claimed = process['pid'], process['created']
                if (self._same_process() and self._session == session and self._token == state['token'] and
                        self._process['created'] == process['created'] and self._process['pid'] == process['pid']):
                    self._layout(form, rect, dpr, visible)
                    return self._state()
                if self._hwnd is not None:
                    self._detach(form)
                if self._seen and self._seen['window'][0] != process['pid']:
                    self._seen, self._window_mode = None, ''            # what an earlier game's window showed
                # an answer about a window not in the panel also says what Retry embedding can do for its game (GAMES)
                hwnd = self._win.find_window(process['pid'])
                if not hwnd:
                    return self._state(pending=not self._crashed(process['pid']), **game)
                original = self._win.snapshot(hwnd)
                if not self._ready(process['pid'], hwnd, original):
                    return self._state(pending=not self._window_mode, **game, **self._ready_in())
                self._seen = None
                # the cover goes now, while the window is not the panel's child yet: changed with a child of the game's
                # thread, the editor's window would wait for that thread (COVER_LIMIT)
                self._uncover(form)
                self._ensure_panel(form)
                self._layout(form, rect, dpr, visible)
                self._process, process = process, None
                self._hwnd, self._original = hwnd, original
                self._session, self._token = session, state['token']
                try:
                    style, exstyle = _child_styles(original['style'], original['exstyle'])
                    self._win.style(hwnd, GWL_STYLE, style)
                    self._win.style(hwnd, GWL_EXSTYLE, exstyle)
                    self._win.parent(hwnd, int(self._panel.Handle.ToInt64()))
                    try:
                        # its window now dies with the editor's, and the game with it, however the editor ends, until
                        # _detach hands it back (c8b of the game test, 29 Oct 2026: it ran on with no window at all)
                        self._job = self._win.job(self._process['pid'])
                    except OSError:
                        pass                                            # it outlives an editor that dies, as before
                    self._layout(form, rect, dpr, visible)
                    self._timer.Start()
                    self._release(form)
                except Exception:
                    self._detach(form)
                    raise
                return self._state()
            self._error = ''
            return self._on_ui(attach)
        except Exception as exc:
            self._error = str(exc)
            return self._state()
        finally:
            if process is not None:
                self._win.close(process['handle'])

    def resize(self, value):
        try:
            session, rect, dpr, visible = _payload(value)
            self._worker_check(session)
            def resize_on_ui(form):
                if (session != self._session or not self._same_process() or
                        (value.get('processToken') and value['processToken'] != self._token)):
                    raise RuntimeError('The embedded Play session has ended')
                self._layout(form, rect, dpr, visible)
                return self._state()
            self._error = ''
            return self._on_ui(resize_on_ui)
        except Exception as exc:
            self._error = str(exc)
            return self._state()

    def release(self):
        try:
            self._on_ui(self._release)
            self._error = ''
        except Exception as exc:
            self._error = str(exc)
        return self._state()

    def detach(self, front=False):
        """game_detach: the game's window handed back (Stop's hand-back, the Game view left, the app closing, an error
        of the page's) and, front, made the foreground window (Continue in game window: _detach_to_front)"""
        try:
            if type(front) is not bool:
                raise ValueError('Invalid detach request')
            self._on_ui(self._detach_to_front if front else self._detach)
            self._error = ''
        except Exception as exc:
            self._error = str(exc)
        return self._state()

    def status(self):
        try:
            # the game still in the panel, as the UI thread answers now: a BUSY of an earlier call no longer applies
            # (that call ran there first, or never will), like c2b's attach that SetParent held past UI_WAIT
            if self._hwnd is not None and not self._on_ui(self._detach_gone) and self._error == BUSY:
                self._error = ''
        except Exception as exc:
            self._error = str(exc)
        return self._state()
