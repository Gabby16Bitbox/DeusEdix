"""NativeGamePanel's rules for the game's window, on stand-ins of Win32 and WinForms (no game, no window): which
windows it takes into the panel (window_mode, the wait for a settled window whose game answers), what it does with one
that turns full screen or minimizes itself in the panel or that its game keeps restyling there (D6 of the game test,
29 Oct 2026; not Revision's own SetRes, even two or three that run into each other, g1f of that of 30 Oct 2026, each
seen at its own size before or after a repair waits for the game, D2 of a later one that day), how it gives
one back, and that every window and panel call runs on the UI thread (29 Oct 2026:
Revision's full-screen start made the embedded Play black or crashed it). Then full screen asked for in the panel,
which both games die of (Alt+Enter kept from the game, the window that vanishes with an error), and the job that ends
an embedded game with the editor, the last also on real stand-in processes (game test, 29 Oct 2026), and the hotkey,
the error box, the question to a game's thread and the repair's two reads of the game's window on real Win32 calls
(review 2c, D5 of the game test, 29 Oct 2026, and D2). Last, the cover that keeps the editor's window above every
other window while an embedded Play starts, on stand-ins and on a real window (the start-up investigation, 29 Oct
2026), its ends that the game tests of 30 Oct 2026 found wanting (a topmost window in front, the game's dialog, also
behind its splash, the desktop, the editor's own processes, also on real windows and processes), and the question sent
to a starting game without waiting for it; last, the cover's look at other programs, which never resolves the path
of their executables, and Continue in game window, which brings the game's window to the front (review su3, 31 Oct
2026) only while the editor's is in front, never while no window is, and finds it as embed does, on real windows
(review su4).

    .venv/Scripts/python.exe -m unittest discover -s launcher -p "test_*.py"
"""
import ctypes
from ctypes import wintypes
import itertools
import json
import os
import queue
import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import native_play                                                  # noqa: E402

GWL_STYLE, GWL_EXSTYLE = -16, -20
SCREEN = (0, 0, 3840, 2160)
# Revision's window as the runs of 28 Oct 2026 saw it: captioned as it appears, full screen after the start-up SetRes
# of StartupFullscreen=True (run 1), minimized as a child of the panel (run 2)
WINDOWED = dict(style=0x14cf0000, exstyle=0x00040100, rect=(0, 0, 3866, 2190))
FULL_SCREEN = dict(style=0x14000000, exstyle=0x00040008, rect=(0, 0, 3840, 2160))
MINIMIZED_CHILD = dict(style=0x7ccf0000, exstyle=0, rect=(0, 0, 314, 50))
# Revision's in-panel full screen as the game test's c3 saw it: its SetRes kept WS_CHILD and covered the monitor from
# the panel's corner, then the game stopped with "Failed to create D3D device"
C3_FULL_SCREEN_CHILD = dict(style=0x5c000000, exstyle=0, rect=(2163, 1060, 3840, 2160))
PANEL = 500                                                         # the panel's handle
EMBED = dict(session='worker-session-0123456789', processToken='play-1', dpr=1, visible=True,
             rect=dict(x=0, y=40, width=1280, height=640))
UI_THREADS = set()                                                  # the threads the panel's WinForms calls ran on


class Handle:
    def __init__(self, value):
        self.value = value

    def ToInt64(self):
        return self.value


class Event(list):
    def __iadd__(self, handler):
        self.append(handler)
        return self


class Panel:
    def __init__(self):
        self.IsDisposed, self.Handle, self.MouseDown = False, Handle(PANEL), Event()
        self.Width = self.Height = 0

    def __setattr__(self, name, value):
        if name == 'Visible':
            UI_THREADS.add(threading.get_ident())
        object.__setattr__(self, name, value)

    def SetBounds(self, x, y, width, height):
        UI_THREADS.add(threading.get_ident())
        self.Width, self.Height = width, height

    def BringToFront(self):
        UI_THREADS.add(threading.get_ident())

    def PointToScreen(self, point):
        return point


class Timer:
    def __init__(self):
        self.Tick, self.running = Event(), False

    def Start(self):
        self.running = True

    def Stop(self):
        self.running = False


class Browser:
    IsDisposed = False
    ClientSize = SimpleNamespace(Width=1600, Height=900)
    Handle = Handle(300)

    def PointToScreen(self, point):
        return point


class UI:
    """The form's UI thread: what BeginInvoke gets runs there, in order."""
    def __init__(self):
        self.actions = queue.Queue()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        while True:
            self.actions.get()()

    def run(self, task):
        """task() on the UI thread (a timer tick), waited for."""
        done = threading.Event()
        self.actions.put(lambda: (task(), done.set()))
        done.wait(3)


class Form:
    def __init__(self, ui=None):
        self.IsDisposed = self.Disposing = False
        self.IsHandleCreated = True
        self.InvokeRequired, self.ui = ui is not None, ui
        self.Handle, self.webview, self.Controls = Handle(200), Browser(), SimpleNamespace(Add=lambda control: None)

    def BeginInvoke(self, action):
        self.ui.actions.put(action)

    def PointToClient(self, point):
        return point


BINDINGS = (SimpleNamespace(Panel=Panel, Timer=Timer), lambda task: task,
            lambda x, y: SimpleNamespace(X=x, Y=y), SimpleNamespace(Black='black'))


class Win:
    """Win32 as the panel uses it: one game process (pid 123, Revision's unless `path` names another executable) with
    one window (hwnd 77) that looks as `look` says. What the panel does to the window is kept in `calls`; the threads
    of its window calls in `threads`. repair_child reports a bounds-only repair every time, as a game whose window
    keeps drifting would (RestylingWin: one whose game restyles it, in runs). `window` False: the window is gone while
    the process may run on (`running`); `box`: its error box shows; `active`: the editor is the foreground window;
    `answering`: the game's thread takes messages (answers), the answers the panel got kept in `asked`, the questions
    it sent without waiting counted in `questions`, their replies delivered once the game answers, at the panel's next
    find_window (the UI thread's message loop between two of its calls). What the panel does to the process and the
    keys is kept apart: the jobs it holds the game in (`jobs`) and whether it keeps Alt+Enter from the game (`caught`);
    press() is the player's Alt+Enter while it does (WM_HOTKEY). The cover: `in_front_now` is the window in front and
    its process ((None, 0): none), `others` the executables of other programs' processes by pid, `family` the pids of
    the processes the editor started, directly or not, `dialogs` the windows that are dialogs (a game's, or another
    program's by its pid), `z` the top-level windows front first, as (window, its process) (None: the window in front
    alone), `desktops` the shell's desktop windows among them, `shown_now` whether the editor's window is visible and
    not minimized; the cover's changes are calls ('topmost', on, behind), which Windows takes while `z_order` says
    so."""
    def __init__(self, look):
        self.look = dict(look, parent=None, enabled=True)
        self.path = 'C:/Games/Deus Ex/Revision/System/Revision.exe'
        self.calls, self.threads = [], set()
        self.running = self.window = self.answering = True
        self.box = self.active = False
        self.jobs, self.caught, self.asked = [], [], []
        self.press = None
        self.questions, self.replies = 0, []
        self.in_front_now, self.others, self.shown_now = (None, 0), {}, True
        self.family, self.dialogs = set(), set()
        self.z, self.desktops = None, set()
        self.z_order = True

    def _on(self, *call):
        self.threads.add(threading.get_ident())
        if call:
            self.calls.append(call)

    def process(self, pid):
        return dict(handle=1, pid=pid, path=self.others.get(pid, self.path), created='1')

    def close(self, handle):
        pass

    def alive(self, process):
        return self.running

    def exists(self, hwnd):
        self._on()
        return hwnd == 77 and self.running and self.window

    def pid(self, hwnd):
        return 123

    def find_window(self, pid):
        self._on()
        self.reply()
        return 77 if self.window else None

    def error_box(self, pid):
        self._on()
        return self.box

    def snapshot(self, hwnd):
        self._on()
        look = self.look
        return dict(parent=look['parent'], style=look['style'], exstyle=look['exstyle'], enabled=look['enabled'],
                    rect=look['rect'], screen=SCREEN)

    def answers(self, hwnd):
        self._on()
        self.asked.append(self.answering)
        return self.answering

    def ask(self, hwnd, answered):
        self._on()
        self.questions += 1
        self.replies.append(answered)
        self.reply()
        return True

    def reply(self):
        """the replies to the questions sent without waiting, once the game answers"""
        while self.answering and self.replies:
            self.replies.pop(0)()

    def style(self, hwnd, index, value):
        self._on('style', index, value)
        self.look['style' if index == GWL_STYLE else 'exstyle'] = value

    def parent(self, hwnd, parent):
        self._on('parent', parent)
        self.look['parent'] = parent

    def position(self, hwnd, rect, frame=False):
        self._on('position', rect, frame)

    def repair_child(self, hwnd, parent, width, height):
        self._on('repair', width, height)
        return 'moved'

    def enabled(self, hwnd, value):
        self._on('enabled', value)

    def foreground(self, form, hwnd):
        return self.active

    def focus(self, hwnd, form):
        self._on('focus', hwnd)

    def release_cursor(self):
        self._on('release_cursor')

    def key(self, vk):
        return False

    def cursor(self):
        return 0, 0

    def front(self, hwnd):
        self._on('front', hwnd)

    def in_front(self):
        return self.in_front_now

    def shown(self, hwnd):
        return self.shown_now

    def topmost(self, hwnd, on, behind=None):
        self._on('topmost', on, behind)
        return self.z_order

    def dialog(self, hwnd):
        return hwnd in self.dialogs

    def open_dialogs(self, pid=None, also=None):
        self._on()
        z = [self.in_front_now] if self.z is None else self.z
        return [(hwnd, owner) for hwnd, owner in z
                if hwnd and (hwnd == also or self.dialog(hwnd) and (pid is None or owner == pid))]

    def desktop(self, hwnd):
        return hwnd in self.desktops

    def descends(self, pid, ancestor):
        return pid in self.family and ancestor == os.getpid()

    def keys_window(self, pressed):
        self._on()
        self.press = pressed
        return 900

    def catch_keys(self, hwnd, on):
        self._on()
        self.caught.append(on)
        return on

    def job(self, pid):
        self._on()
        self.jobs.append(('job', pid))
        return 600

    def free_job(self, job):
        self._on()
        self.jobs.append(('free', job))


class VanishingWin(Win):
    """The game's window destroyed by its own thread in the middle of a tick, between IsWindow and GetWindowRect
    (`vanish`): that snapshot fails as Win32 does on a handle that is gone, and the window is gone from then on (c3 of
    the game test destroyed it 8 ms after its error box showed, 29 Oct 2026)."""
    def __init__(self, look):
        super().__init__(look)
        self.vanish = False

    def snapshot(self, hwnd):
        if self.vanish:
            self.vanish, self.window = False, False
            raise OSError(1400, 'Invalid window handle')
        return super().snapshot(hwnd)


class SlowStartWin(Win):
    """SetParent held until the game has drawn its first frame (`drawn`), as the original game's slow start held it
    ~5 s (c2 and c2b of the game test, 29 Oct 2026) before the panel asked first: here the game answers the question
    and turns busy right after."""
    def __init__(self, look):
        super().__init__(look)
        self.drawn = threading.Event()
        self.drawn.set()

    def parent(self, hwnd, parent):
        self.drawn.wait(10)
        super().parent(hwnd, parent)


class FailingRepairWin(Win):
    """repair_child fails once (`fail`) on the window still in the panel, as any Win32 call of a tick may."""
    def __init__(self, look):
        super().__init__(look)
        self.fail = False

    def repair_child(self, hwnd, parent, width, height):
        if self.fail:
            self.fail = False
            raise OSError(5, 'Access is denied')
        return super().repair_child(hwnd, parent, width, height)


class RestylingWin(Win):
    """repair_child has to restyle the window at the next `restyles` repairs, then finds nothing to repair (False), as
    Revision's SetRes in the panel did (a run of 3-4, f4c/f4d of the game test of 30 Oct 2026; an attach's 2-3, f3d: 3);
    at every repair while `restyles` is None, as the original game's SetRes put its frame back at every repair once
    Retry embedding had taken in the window it switched to after a full-screen start (D6 of the game test, 29 Oct
    2026). A restyle waits while its game does not answer (None), as on Win32."""
    def __init__(self, look, restyles=None):
        super().__init__(look)
        self.restyles = restyles

    def repair_child(self, hwnd, parent, width, height):
        super().repair_child(hwnd, parent, width, height)
        if self.restyles == 0:
            return False
        if not self.answers(hwnd):
            return None
        if self.restyles:
            self.restyles -= 1
        return 'restyled'


class SetResWin(Win):
    """Revision's SetRes in the panel, driven by when each one reaches the window (`setres`: times by `clock`, the
    panel's), as repair_child sees it with its second read, after it waits for the game (D2 of the game test of 30 Oct
    2026): the window is restyled at the next three repairs from then, found first at the size its game chose
    ('resized', G), then twice at the panel's ('restyled', P), each repair holding the UI thread as long as g1f's did
    (0.245, 0.196 and 0.026 s, game test of 30 Oct 2026); a SetRes that reaches it before those are done starts them
    again (g1h), and one that reaches it while a repair holds the UI thread is found by that repair's second read, which
    is then its 'resized', the rest of its run following (h1a b4, h1d b2). Then nothing to repair (False, '|'). The
    repairs are kept in `shape`, so that SetRes whose runs touch (no settled repair between them, as in g1f) can be
    told from runs that do not."""
    RUN = (('resized', 'G', .245), ('restyled', 'P', .196), ('restyled', 'P', .026))

    def __init__(self, look):
        super().__init__(look)
        self.clock, self.setres, self.left, self.shape = None, [], [], ''

    def repair_child(self, hwnd, parent, width, height):
        super().repair_child(hwnd, parent, width, height)
        if self.reached():
            self.left = list(self.RUN)
        result, letter, hold = self.left.pop(0) if self.left else (False, '|', 0)
        self.clock.now += hold                                      # the UI thread held by the restyle
        if hold and self.reached():                                 # found by the repair's second read
            (result, letter, _), self.left = self.RUN[0], list(self.RUN[1:])
        self.shape += letter
        return result

    def reached(self):
        """Whether a SetRes has reached the window by now (each one taken from `setres` once)"""
        reached = False
        while self.setres and self.setres[0] <= self.clock():
            self.setres.pop(0)
            reached = True
        return reached


def made(win, clock, ui=None, state=None):
    """A NativeGamePanel of a project whose Play runs (token play-1, or as `state` says), on `win`, with the clock
    `clock`."""
    window = SimpleNamespace(native=Form(ui))
    state = dict(owned=True, running=True, pid=123, token='play-1', created='1') if state is None else state
    panel = native_play.NativeGamePanel(window, lambda: 'C:/Games/Deus Ex', _win=win, _native_bindings=BINDINGS,
                                        _session_lookup=lambda session: state, _worker_check=lambda session: None,
                                        _clock=clock)
    return panel, window.native


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def attached(test, win=None):
    """A panel holding the game's windowed window, embedded after it had settled (embed every 0.5 s)."""
    win, clock = win or Win(WINDOWED), Clock()
    panel, form = made(win, clock)
    for _ in range(3):
        state = panel.embed(EMBED)
        clock.now += .5
    test.assertTrue(state['attached'], state)
    return panel, form, win, clock


def tick(panel, clock, times=1):
    for _ in range(times):
        clock.now += .04
        panel._timer.Tick[0](None, None)


def cover_tick(panel):
    """the cover's timer (COVER_TICK) ticking once, if it runs, as a WinForms Timer does"""
    if panel._cover_timer is not None and panel._cover_timer.running:
        panel._cover_watch(None, None)


def resolving(resolved, resolve=None):
    """Path.resolve recording in `resolved` each path it is asked to resolve, then resolving it as `resolve` says (a
    function of the path, which reaches no file; None: as Path.resolve does)"""
    real = native_play.Path.resolve

    def record(path, *args, **kwargs):
        resolved.append(str(path))
        return native_play.Path(resolve(str(path))) if resolve else real(path, *args, **kwargs)
    return mock.patch.object(native_play.Path, 'resolve', autospec=True, side_effect=record)


def setres_played(test, times):
    """SetResWin's SetRes reaching the window `times` seconds after its attach has settled, then 4 s of the 40 ms timer
    -> the panel's windowMode, and the repairs' shape from the first SetRes on"""
    panel, form, win, clock = attached(test, SetResWin(WINDOWED))
    win.clock = clock
    tick(panel, clock, 25)                                          # the attach settled: nothing to repair
    win.shape, win.setres = '', [clock.now + at for at in times]
    tick(panel, clock, 100)
    return panel.status()['windowMode'], win.shape.strip('|')


class WindowModeTests(unittest.TestCase):
    def test_the_windows_of_the_runs(self):
        mode = native_play.window_mode
        self.assertEqual(mode(WINDOWED['style'], WINDOWED['exstyle'], WINDOWED['rect'], SCREEN), 'windowed')
        self.assertEqual(mode(FULL_SCREEN['style'], FULL_SCREEN['exstyle'], FULL_SCREEN['rect'], SCREEN), 'fullscreen')
        self.assertEqual(mode(MINIMIZED_CHILD['style'], 0, MINIMIZED_CHILD['rect'], SCREEN), 'minimized')
        # the game as a healthy child of the panel (run 1's 0x540b0000), even as large as the monitor
        self.assertEqual(mode(0x540b0000, 0, (812, 300, 3058, 1614), SCREEN), 'windowed')
        self.assertEqual(mode(0x540b0000, 0, (0, 0, 3840, 2160), SCREEN), 'windowed')
        # so is c3's full-screen child (WS_CHILD kept): no window rule tells it from the healthy child above, which
        # is that large right after every attach; the game dies of it anyway (FullScreenTests)
        self.assertEqual(mode(C3_FULL_SCREEN_CHILD['style'], 0, C3_FULL_SCREEN_CHILD['rect'], SCREEN), 'windowed')

    def test_full_screen_is_topmost_or_covers_its_own_monitor(self):
        mode = native_play.window_mode
        # Alt+Enter in the panel: no caption, no WS_CHILD, topmost, wherever the panel puts it
        self.assertEqual(mode(0x14000000, 0x00040008, (812, 300, 1280, 640), SCREEN), 'fullscreen')
        self.assertEqual(mode(0x14000000, 0x00040000, (0, 0, 3840, 2160), SCREEN), 'fullscreen')
        self.assertEqual(mode(0x14000000, 0x00040000, (3840, 0, 1920, 1080), (3840, 0, 1920, 1080)), 'fullscreen')
        # a borderless window smaller than its monitor, and a captioned one larger than it
        self.assertEqual(mode(0x14000000, 0x00040000, (0, 0, 1280, 720), SCREEN), 'windowed')
        self.assertEqual(mode(0x14cf0000, 0x00040108, (0, 0, 3866, 2190), SCREEN), 'windowed')


class AttachTests(unittest.TestCase):
    def test_a_windowed_window_is_taken_in_only_once_it_has_settled(self):
        win, clock = Win(WINDOWED), Clock()
        panel, _ = made(win, clock)
        self.assertTrue(panel.embed(EMBED).get('pending'))
        clock.now += .5
        win.look['rect'] = (12, 12, 3866, 2190)                         # it moved: the wait starts again
        self.assertTrue(panel.embed(EMBED).get('pending'))
        clock.now += .5
        self.assertTrue(panel.embed(EMBED).get('pending'))
        self.assertEqual(win.calls, [], 'nothing done to a window that is still changing')
        clock.now += .5
        state = panel.embed(EMBED)
        self.assertTrue(state['attached'])
        self.assertEqual((state['error'], state['windowMode']), ('', ''))
        self.assertEqual(win.calls[:3], [('style', GWL_STYLE, 0x54000000), ('style', GWL_EXSTYLE, 0),
                                         ('parent', PANEL)])
        # its game asked without waiting when the window was first seen, then at the attach (waiting ANSWER_WAIT at
        # most), not again when it moved (review 2e #2)
        self.assertEqual((win.questions, win.asked), (1, [True]))

    def test_a_window_that_turns_full_screen_as_it_starts_is_reported_and_never_taken_in(self):
        win, clock = Win(WINDOWED), Clock()
        panel, _ = made(win, clock)
        self.assertTrue(panel.embed(EMBED).get('pending'))
        asked = len(win.asked), win.questions                           # asked while it was windowed
        win.look.update(FULL_SCREEN)                                    # the start-up SetRes, 0.1 s later
        for _ in range(19):
            clock.now += .5
            state = panel.embed(EMBED)
            self.assertTrue(state.get('pending'), clock.now)
            self.assertEqual(state['error'], '')
        clock.now += .5                                                 # 10 s after it was first seen
        state = panel.embed(EMBED)
        self.assertEqual((state['attached'], state.get('pending'), state['windowMode']), (False, False, 'fullscreen'))
        self.assertIn('full screen', state['error'])
        self.assertEqual(win.calls, [], 'a full-screen window is never touched')
        self.assertEqual((len(win.asked), win.questions), asked, 'nor its game asked')
        # Alt+Enter in the game makes it windowed: Retry embedding takes it in once it has settled
        win.look.update(WINDOWED)
        clock.now += 30
        state = panel.embed(EMBED)
        self.assertEqual((state['attached'], state.get('pending'), state['windowMode'], state['error']),
                         (False, True, '', ''))
        clock.now += 1
        self.assertTrue(panel.embed(EMBED)['attached'])

    def test_a_minimized_window_is_reported_too(self):
        win, clock = Win(dict(MINIMIZED_CHILD, style=0x34cf0000)), Clock()
        panel, _ = made(win, clock)
        for _ in range(21):
            state = panel.embed(EMBED)
            clock.now += .5
        self.assertEqual(win.calls, [], 'a minimized window is never touched')
        self.assertEqual((win.asked, win.questions), ([], 0), 'nor its game asked')
        self.assertEqual((state['attached'], state.get('windowMode')), (False, 'minimized'))
        self.assertIn('minimized', state['error'])

    def test_a_starting_game_is_asked_without_waiting_and_its_window_taken_in_settle_after_its_answer(self):
        # D5 of the game test (29 Oct 2026): SetWindowLong and SetParent wait for the game's thread, which takes no
        # messages while the game starts. The first question of every Play of the game tests of 29-30 Oct 2026 went
        # unanswered (the game was still drawing its first frame), Revision's holding the UI thread 0.10-0.20 s, and
        # the next came a SETTLE later: now one is sent without waiting, nothing is done to the window until its game
        # answers, and the answers then say when it may be taken in (readyIn): SETTLE after that answer, at once
        win, clock = Win(WINDOWED), Clock()
        win.answering = False
        panel, _ = made(win, clock)
        for _ in range(100):                                            # 10 s of embeds, one every 0.1 s
            state = panel.embed(EMBED)
            self.assertEqual((state['attached'], state.get('pending'), state['windowMode'], 'readyIn' in state),
                             (False, True, '', False))
            clock.now += .1
        self.assertEqual((win.calls, win.questions, win.asked), ([], 1, []), 'asked once, never waited for')
        clock.now = answered = 200.0
        win.answering = True                                            # its first frame: the question taken
        state = panel.embed(EMBED)
        self.assertEqual((state['attached'], state.get('pending'), state.get('readyIn')),
                         (False, True, native_play.SETTLE))
        clock.now = answered + state['readyIn'] - .1
        self.assertEqual(panel.embed(EMBED).get('readyIn'), .1, 'not before')
        clock.now = answered + state['readyIn']
        self.assertTrue(panel.embed(EMBED)['attached'], 'taken in when its answers said')
        self.assertEqual((clock.now - answered, win.questions, win.asked), (native_play.SETTLE, 1, [True]))

    def test_a_game_that_stops_answering_before_the_attach_is_asked_again_without_waiting(self):
        # the attach's own question waits ANSWER_WAIT at most: a game that no longer answers then (a map loading) is
        # asked again without waiting, and SETTLE starts again at its answer
        win, clock = Win(WINDOWED), Clock()
        panel, _ = made(win, clock)
        self.assertTrue(panel.embed(EMBED).get('pending'))              # asked and answered at once
        clock.now += native_play.SETTLE
        win.answering = False
        state = panel.embed(EMBED)
        self.assertEqual((state['attached'], 'readyIn' in state, win.asked, win.questions), (False, False, [False], 2))
        clock.now += 5
        self.assertEqual((panel.embed(EMBED)['attached'], win.asked, win.questions), (False, [False], 2))
        win.answering = True
        self.assertEqual(panel.embed(EMBED).get('readyIn'), native_play.SETTLE)
        clock.now += native_play.SETTLE
        self.assertTrue(panel.embed(EMBED)['attached'])
        self.assertEqual(win.asked, [False, True])

    def test_a_window_no_longer_windowed_after_its_game_answered_gives_no_ready_in(self):
        # review su #6 (30 Oct 2026): the page embeds again at once for an answer whose readyIn is 0 (game-view.js
        # syncAt). A window that turned full screen or minimized after its game answered, or before the answer came,
        # had readyIn 0 in every pending answer until MODE_WAIT: embeds back to back. The page's rule here: the next
        # embed readyIn seconds later when an answer gives one, else at its next half second
        turned = dict(fullscreen=FULL_SCREEN, minimized=dict(MINIMIZED_CHILD, style=0x34cf0000))
        for mode, late in itertools.product(turned, (False, True)):
            with self.subTest(mode=mode, late_answer=late):
                win, clock = Win(WINDOWED), Clock()
                win.answering = not late
                panel, _ = made(win, clock)
                state = panel.embed(EMBED)                              # seen windowed: asked
                self.assertEqual(state.get('readyIn'), None if late else native_play.SETTLE)
                clock.now += .3
                win.look.update(turned[mode])
                win.answering = True                                    # a late answer comes now
                embeds = []
                while not state['windowMode'] and len(embeds) < 100:
                    clock.now += state.get('readyIn', .5)
                    state = panel.embed(EMBED)
                    embeds.append(state.get('readyIn'))
                self.assertEqual(state['windowMode'], mode)
                self.assertEqual(embeds, [None] * len(embeds), 'no readyIn once no longer windowed')
                self.assertLessEqual(len(embeds), native_play.MODE_WAIT / .5 + 1, 'one embed every half second')
                # windowed again (Alt+Enter in its game): its game asked again, and taken in SETTLE after that answer
                win.look.update(WINDOWED)
                state = panel.embed(EMBED)
                self.assertEqual((state.get('pending'), state.get('readyIn'), win.questions),
                                 (True, native_play.SETTLE, 2))
                clock.now += state['readyIn']
                self.assertTrue(panel.embed(EMBED)['attached'])

    def test_d5_a_window_windowed_past_settle_while_its_game_starts_then_full_screen_is_reported(self):
        # D5 of the game test (29 Oct 2026): the original game's window stayed windowed for 5 s while the game started,
        # long enough to settle, and turned full screen as the game began to answer; taken in, it ended minimized in
        # the panel, and the attach's SetWindowLong held the editor's UI thread 15 s
        win, clock = Win(WINDOWED), Clock()
        win.answering = False
        panel, _ = made(win, clock)
        start = clock.now
        for _ in range(4):                                              # 2 s windowed: past SETTLE
            self.assertTrue(panel.embed(EMBED).get('pending'))
            clock.now += .5
        asked = len(win.asked), win.questions
        win.look.update(FULL_SCREEN)                                    # its first frame
        win.answering = True
        while clock.now - start < native_play.MODE_WAIT:
            state = panel.embed(EMBED)
            self.assertEqual((state['attached'], state.get('pending'), state['error']), (False, True, ''))
            clock.now += .5
        state = panel.embed(EMBED)
        self.assertEqual((state['attached'], state.get('pending'), state['windowMode']), (False, False, 'fullscreen'))
        self.assertIn('full screen', state['error'])
        self.assertEqual((win.calls, win.jobs), ([], []), 'never taken in')
        self.assertEqual((len(win.asked), win.questions), asked, 'never asked once full screen')

    def test_a_full_screen_report_says_whether_retry_embedding_can_show_its_game(self):
        # D6 of the game test (29 Oct 2026): the original game, switched to a window after it opened full screen, never
        # showed in the panel once Retry embedding took it in; Revision's did (GAMES)
        for exe, retry in (('Revision/System/Revision.exe', True), ('System/DeusEx.exe', False)):
            with self.subTest(exe=exe):
                win, clock = Win(FULL_SCREEN), Clock()
                win.path = 'C:/Games/Deus Ex/' + exe
                panel, _ = made(win, clock)
                for _ in range(21):
                    state = panel.embed(EMBED)
                    clock.now += .5
                self.assertEqual((state['windowMode'], state['retryFromFullScreen']), ('fullscreen', retry))
                win.window = False                                      # its window gone a moment: the same report
                state = panel.embed(EMBED)
                self.assertEqual((state['windowMode'], state['retryFromFullScreen']), ('fullscreen', retry))

    def test_a_report_is_about_its_own_game(self):
        # review 2b #0: a report about a window never taken in outlived its Play (after a reload, the page never
        # detaches), and the next Play's first embeds, before its window shows, answered it
        win, clock = Win(FULL_SCREEN), Clock()
        state = dict(owned=True, running=True, pid=123, token='play-1', created='1')
        panel, _ = made(win, clock, state=state)
        for _ in range(21):
            answer = panel.embed(EMBED)
            clock.now += .5
        self.assertEqual(answer['windowMode'], 'fullscreen')
        win.window = False                                              # the same game, its window gone a moment
        self.assertEqual(panel.embed(EMBED)['windowMode'], 'fullscreen')
        win.window = True
        self.assertEqual(panel.embed(EMBED)['windowMode'], 'fullscreen')
        # the next Play: launching (no process yet), then its process before its window shows
        launching = dict(launching=True, owned=False, token='play-2')
        panel._session_lookup = lambda session: launching
        answer = panel.embed(dict(EMBED, processToken='play-2'))
        self.assertEqual((answer.get('pending'), answer['windowMode'], answer['error']), (True, '', ''))
        panel._session_lookup = lambda session: state
        state.update(pid=124, token='play-2')
        win.window = False
        answer = panel.embed(dict(EMBED, processToken='play-2'))
        self.assertEqual((answer.get('pending'), answer['windowMode'], answer['error']), (True, '', ''))


class LeftAloneTests(unittest.TestCase):
    def test_a_child_that_minimizes_itself_is_left_alone_and_reported(self):
        panel, form, win, clock = attached(self)
        tick(panel, clock, 5)
        self.assertTrue(any(call[0] == 'repair' for call in win.calls), 'a healthy child is still repaired')
        win.look.update(MINIMIZED_CHILD, parent=PANEL)
        done = len(win.calls)
        tick(panel, clock, 100)                                         # 4 s of the 40 ms timer
        self.assertEqual(win.calls[done:], [('release_cursor',)], 'reported once: no repair, resize or focus after')
        self.assertEqual(panel._error, '', 'no tick failed')
        state = panel.status()
        self.assertEqual((state['attached'], state.get('windowMode')), (True, 'minimized'))
        self.assertIn('minimized', state['error'])
        # the page hides the panel to show why, then releases the mouse at Stop: still nothing done to the window
        self.assertEqual(panel.resize(dict(EMBED, visible=False))['windowMode'], 'minimized')
        panel.release()
        self.assertFalse(any(call[0] in ('repair', 'position', 'style', 'parent', 'enabled', 'focus')
                             for call in win.calls[done:]), win.calls[done:])

    def test_a_window_left_alone_is_not_focused_by_a_click_or_resized_by_the_page(self):
        # review 2b #11: between the tick that leaves it alone and the page's next hidden resize the panel is shown
        panel, form, win, clock = attached(self)
        win.look.update(MINIMIZED_CHILD, parent=PANEL)
        tick(panel, clock)
        done = len(win.calls)
        panel._handlers[1](None, None)                                  # a click on the panel (_capture)
        panel.resize(dict(EMBED, rect=dict(x=0, y=40, width=1000, height=500)))     # the page's layout (_resize_game)
        self.assertFalse(any(call[0] in ('enabled', 'focus', 'position', 'repair') for call in win.calls[done:]),
                         win.calls[done:])

    def test_full_screen_in_the_panel_is_left_alone(self):
        panel, form, win, clock = attached(self)
        win.look.update(style=0x14000000, exstyle=0x00040008, rect=(0, 40, 3840, 2160))     # Alt+Enter
        done = len(win.calls)
        tick(panel, clock, 50)
        self.assertEqual(win.calls[done:], [('release_cursor',)])
        self.assertEqual(panel.status().get('windowMode'), 'fullscreen')

    def test_a_full_screen_or_minimized_window_goes_back_without_the_frame_change_resize(self):
        for look, style, exstyle in ((MINIMIZED_CHILD, 0x3ccf0000, 0x00040000),
                                     (dict(style=0x14000000, exstyle=0x00040008, rect=(0, 40, 3840, 2160)),
                                      0x14000000, 0x00040008)):
            with self.subTest(style=hex(look['style'])):
                panel, form, win, clock = attached(self)
                win.look.update(look)                                   # between two ticks: no tick saw it yet
                done = len(win.calls)
                state = panel.detach()
                self.assertEqual(win.calls[done:], [('release_cursor',), ('parent', None), ('style', GWL_STYLE, style),
                                                    ('style', GWL_EXSTYLE, exstyle), ('enabled', True)])
                self.assertEqual((state['attached'], state['error'], state.get('windowMode')), (False, '', ''))

    def test_a_windowed_child_goes_back_as_before(self):
        panel, form, win, clock = attached(self)
        tick(panel, clock, 3)
        done = len(win.calls)
        panel.detach()
        self.assertEqual(win.calls[done:], [('release_cursor',), ('parent', None), ('style', GWL_STYLE, 0x14cf0000),
                                            ('style', GWL_EXSTYLE, 0x00040100), ('enabled', True),
                                            ('position', (0, 0, 3866, 2190), True)])

    def test_a_game_that_ended_in_the_panel_is_not_restored(self):
        panel, form, win, clock = attached(self)
        win.running = False                                             # Stop's exit: it closed as a child
        done = len(win.calls)
        tick(panel, clock)
        self.assertFalse(panel.status()['attached'])
        self.assertEqual(win.calls[done:], [('release_cursor',)])

    def test_d6_a_window_its_game_keeps_restyling_is_left_alone_once_and_handed_back_as_it_came(self):
        # D6 of the game test (29 Oct 2026): the original game, switched to a window after it opened full screen and
        # taken in again (Retry embedding), put its frame back at every repair, 17-28 times in about 5 s, each repair
        # holding the UI thread 0.1-0.34 s, and its picture never showed
        panel, form, win, clock = attached(self, RestylingWin(WINDOWED))
        done = len(win.calls)
        tick(panel, clock, 100)                                         # 4 s of the 40 ms timer
        repairs = [('repair', 1280, 640)] * (native_play.RESTYLES + 1)  # EMBED's panel
        self.assertEqual(win.calls[done:], repairs + [('release_cursor',)], 'reported once: no repair after the cap')
        state = panel.status()
        self.assertEqual((state['attached'], state['windowMode'], state['error']),
                         (True, 'unsettled', native_play.WINDOW_ERRORS['unsettled']))
        # the page hides the panel to show why; neither that, a new layout nor a late tick touches the window
        done = len(win.calls)
        panel.resize(dict(EMBED, visible=False))
        panel.resize(dict(EMBED, rect=dict(x=0, y=40, width=1000, height=500)))
        tick(panel, clock, 25)
        self.assertEqual(panel.status()['windowMode'], 'unsettled')
        self.assertFalse(any(call[0] in ('repair', 'position', 'style', 'parent', 'enabled', 'focus')
                             for call in win.calls[done:]), win.calls[done:])
        # Continue in game window: handed back as it came, like a windowed one (its own style and rect, a frame change)
        done = len(win.calls)
        state = panel.detach()
        self.assertEqual(win.calls[done:], [('release_cursor',), ('parent', None), ('style', GWL_STYLE, 0x14cf0000),
                                            ('style', GWL_EXSTYLE, 0x00040100), ('enabled', True),
                                            ('position', (0, 0, 3866, 2190), True)])
        self.assertEqual((state['attached'], state['windowMode'], state['error']), (False, '', ''))

    def test_d6_a_hidden_panel_repairs_nothing_until_it_shows_again(self):
        # the page hides the panel (_layout: not visible): the window is let go, not repaired, so not cut either
        panel, form, win, clock = attached(self, RestylingWin(WINDOWED))
        panel.resize(dict(EMBED, visible=False))
        done = len(win.calls)
        tick(panel, clock, 100)
        self.assertEqual((panel.status()['windowMode'], [call for call in win.calls[done:] if call[0] == 'repair']),
                         ('', []))
        panel.resize(EMBED)
        tick(panel, clock, 100)
        self.assertEqual(panel.status()['windowMode'], 'unsettled')

    def test_d6_a_normal_attach_is_never_unsettled(self):
        # bounds-only repairs (the original game's drift during SetRes) are no restyles
        panel, form, win, clock = attached(self)
        tick(panel, clock, 200)
        self.assertGreater(sum(call[0] == 'repair' for call in win.calls), native_play.RESTYLES + 1)
        state = panel.status()
        self.assertEqual((state['windowMode'], state['error']), ('', ''))

    def test_a_size_the_page_asks_for_too_soon_after_the_last_reaches_the_game_at_a_later_tick(self):
        # a drag of the panel: the renderer's resets are coalesced to one a tenth of a second (_resize_game), and the
        # drag's last size, asked for sooner than that, is the timer's to give the game
        panel, form, win, clock = attached(self)
        tick(panel, clock, 5)
        for width in (1000, 1100):
            panel.resize(dict(EMBED, rect=dict(x=0, y=40, width=width, height=640)))
        done = len(win.calls)
        tick(panel, clock, 8)
        self.assertEqual([call for call in win.calls[done:] if call[0] in ('position', 'repair')][:2],
                         [('position', (0, 0, 1100, 640), False), ('repair', 1100, 640)])

    def test_d6_restyles_now_and_then_or_at_each_new_size_are_never_unsettled(self):
        # Revision's SetRes in the panel, as the game test of 30 Oct 2026 measured it: a run of 3-4 restyles, then
        # nothing to repair (f4c/f4d), and 2-3 for the attach (f3d: 3). Runs that settle are no loop, even two within
        # RESTYLE_SPAN (review 2f #0), nor are the restyles at each new size of a dragged panel: only more than RESTYLES
        # in one unbroken run within RESTYLE_SPAN seconds at one size are
        runs = {'attach 2, then 3 + 3 a second apart (f4c)': ((2, 1.0), (3, 1.0), (3, 2.0)),
                "4 + 4 (f4d's count), a settled repair between them": ((4, .7), (4, 2.0)),
                'attach 3 (f3d), then 4 + 4 within RESTYLE_SPAN': ((3, .6), (4, .7), (4, 2.0))}
        for name, setres in runs.items():
            with self.subTest(name):
                panel, form, win, clock = attached(self, RestylingWin(WINDOWED, restyles=0))
                for restyles, seconds in setres:                        # a run, then the seconds to the next one
                    win.restyles = restyles
                    tick(panel, clock, round(seconds / .04))
                self.assertEqual((panel.status()['windowMode'], win.restyles), ('', 0))
        panel, form, win, clock = attached(self, RestylingWin(WINDOWED))
        for width in (1000, 1040, 1080, 1120):                          # a drag: RESTYLES at each new size
            panel.resize(dict(EMBED, rect=dict(x=0, y=40, width=width, height=640)))
            tick(panel, clock, 3 * native_play.RESTYLES)
        self.assertEqual(panel.status()['windowMode'], '')
        tick(panel, clock, 3)                                           # one more at the same size
        self.assertEqual(panel.status()['windowMode'], 'unsettled')

    def test_d6_six_restyles_within_restyle_span_are_cut_and_spread_over_more_are_not(self):
        # how far apart the restyles of one unbroken run may be and still count together (RESTYLE_SPAN, 3 s), and how
        # many are cut (more than RESTYLES, 5): six 0.594 s apart (2.97 s) are, six 0.606 s apart (3.03 s) are not
        for gap, mode in ((.594, 'unsettled'), (.606, '')):
            with self.subTest(gap=gap):
                panel, form, win, clock = attached(self, RestylingWin(WINDOWED))
                for _ in range(3 * native_play.RESTYLES):               # each tick a repair, `gap` after the last
                    tick(panel, clock)
                    clock.now += gap - .04
                self.assertEqual(panel.status()['windowMode'], mode)

    def test_d6_whose_game_does_not_answer_every_other_repair_is_still_cut(self):
        # a restyle that waits for its game (None) does not end the run: only a repair with nothing to repair does
        panel, form, win, clock = attached(self, RestylingWin(WINDOWED))
        done = len(win.calls)
        with mock.patch.object(win, 'answers', side_effect=itertools.cycle((True, False))):
            tick(panel, clock, 100)                                     # 4 s of the 40 ms timer
        repairs = [('repair', 1280, 640)] * (2 * native_play.RESTYLES + 1)     # 6 restyles, a wait between each two
        self.assertEqual(win.calls[done:], repairs + [('release_cursor',)], 'cut after RESTYLES + 1 restyles')
        self.assertEqual(panel.status()['windowMode'], 'unsettled')

    def test_d6_with_a_bounds_only_repair_between_its_restyles_is_still_cut(self):
        # a bounds-only repair (the original game's drift during SetRes) does not end the run either (review 2g #4)
        panel, form, win, clock = attached(self, RestylingWin(WINDOWED))
        real, drift = win.repair_child, itertools.cycle((False, True))
        with mock.patch.object(win, 'repair_child',
                               side_effect=lambda *args: 'moved' if next(drift) else real(*args)) as repair:
            tick(panel, clock, 100)                                     # 4 s of the 40 ms timer
        self.assertEqual(repair.call_count, 2 * native_play.RESTYLES + 1, '6 restyles, a bounds-only repair between')
        self.assertEqual(panel.status()['windowMode'], 'unsettled')

    def test_d1_two_or_three_setres_that_run_into_each_other_are_not_unsettled(self):
        # D1 of the game test of 30 Oct 2026 (g1f): two of Revision's SetRes whose windows came 0.62 s apart touched,
        # no repair finding the window settled between their runs, and their 3 + 3 restyles were cut as 'unsettled'.
        # A restyle that finds the window at a size its game chose ('resized') drops the restyles at the panel's size
        # before it (RESTYLES). SetResWin stands for repair_child with its second read, after it waits for the game:
        # without it, a SetRes that reached the game during that wait counted at the panel's size only, and three in
        # one run were cut (D2 of a later game test that day, h1d b2 and h1e b5). Their runs touch here (no '|')
        runs = {'two 0.70 s apart, the second found as a repair begins (g1f)': ((0, .70), 'GPPGPP'),
                "two 0.66 s apart, the second during the first one's last restyle (h1a b4)": ((0, .66), 'GPGPP'),
                "three, the third during the second one's last restyle (h1d b2, h1e b5)": ((0, .61, 1.175), 'GPGPGPP'),
                'three, the third found as a repair begins (i1b b9, i1c b7 and b10)': ((0, .61, 1.19), 'GPGPPGPP'),
                'three, the second found as a repair begins (i1a b2)': ((0, .67, 1.23), 'GPPGPGPP')}
        for name, (times, shape) in runs.items():
            with self.subTest(name):
                self.assertEqual(setres_played(self, times), ('', shape))

    def test_d1_a_game_that_restyles_its_window_at_a_size_of_its_own_at_every_repair_is_still_cut(self):
        # the 'resized' restyles themselves still count: a SetRes at every repair (UE1's endless SetRes cycle, _bounds)
        # is cut after RESTYLES + 1, like D6
        self.assertEqual(setres_played(self, [.05 * n for n in range(80)]),
                         ('unsettled', 'G' * (native_play.RESTYLES + 1)))


class RepairWaitTests(unittest.TestCase):
    """_Win32.repair_child's reads of the game's window before and after it waits for the game's thread (D2 of the game
    test of 30 Oct 2026), on a dict window: its Win32 calls patched onto a _Win32 made without them, the 'game'
    changing the window inside one of the repair's calls that wait for it (GWL_STYLE, GWL_EXSTYLE or SetParent): the
    read after the wait follows the last of them."""
    FRAMED, FRAMED_EX = 0x5cc40000, 0x100
    # (window rect, client size) of a framed game window: at the panel's size (1280x640), after Revision's SetRes to
    # 1280x720, and with the original game's frame put back around a client at the panel's size (D6, as h2a saw it)
    PANEL_SIZE = (2163, 1060, 1280, 640), (1254, 569)
    SETRES = (2163, 1060, 1306, 791), (1280, 720)
    D6_FRAME = (2163, 1060, 1306, 711), (1280, 640)

    def repaired(self, found, during=None, wait=GWL_STYLE, **look):
        """repair_child on a framed window found as `found` (and `look`: style, exstyle) says and, if `during` says
        how, framed again by its game while the repair waits for it in its call `wait` (GWL_STYLE, GWL_EXSTYLE or
        'parent': the window then found out of the panel); panel 1280x640. Its calls are kept in `calls`."""
        window = dict(style=self.FRAMED, exstyle=self.FRAMED_EX, rect=found[0], client=found[1],
                      parent=None if wait == 'parent' else PANEL)
        window.update(look)
        self.calls = []

        def game(call):
            if call == wait and during:                             # the game, while this repair waits for it
                window.update(style=self.FRAMED, exstyle=self.FRAMED_EX, rect=during[0], client=during[1])

        def style(hwnd, index, value):
            self.calls.append(('style', index, value))
            window['style' if index == GWL_STYLE else 'exstyle'] = value
            game(index)

        def parent(hwnd, to):
            self.calls.append(('parent', to))
            window['parent'] = to
            game('parent')

        def position(hwnd, to, frame=False):
            self.calls.append(('position', tuple(to), frame))
            window.update(rect=tuple(to), client=tuple(to[2:]))

        win = native_play._Win32.__new__(native_play._Win32)
        win._get_long = lambda hwnd, index: window['style' if index == GWL_STYLE else 'exstyle']
        win.user = SimpleNamespace(GetParent=lambda hwnd: window['parent'])
        win.child_geometry = lambda hwnd, parent: window['rect']
        win.client_size = lambda hwnd: window['client']
        win.answers, win.style, win.parent, win.position = (lambda hwnd: True), style, parent, position
        return win.repair_child(77, PANEL, 1280, 640)

    def test_d2_a_setres_that_reaches_the_game_while_a_repair_waits_is_its_own(self):
        # D2 of the game test of 30 Oct 2026 (h1d b2, h1e b5): a SetRes that reached Revision while a restyle waited
        # for its thread was put back at the panel's size by that repair before any repair found it, so all its
        # restyles counted at the panel's size and three SetRes in one run were cut ('unsettled'). The original
        # game's frame, put back around a client at the panel's size while a repair waits (D6), is no SetRes. Each of
        # the repair's style and parent calls waits for the game (i1a-i1c and i1e of a later game test that day: 10
        # of the 19 SetRes the second read saw reached the game during the GWL_EXSTYLE call)
        cases = {'a SetRes to 1280x720 while it waits': (self.SETRES, 'resized'),
                 "D6: its frame put back around the panel's size": (self.D6_FRAME, 'restyled'),
                 'nothing while it waits': (None, 'restyled')}
        for (name, (during, expected)), wait in itertools.product(cases.items(), (GWL_STYLE, GWL_EXSTYLE, 'parent')):
            with self.subTest(name, wait=wait):
                self.assertEqual(self.repaired(self.PANEL_SIZE, during, wait), expected)

    def test_d2_either_read_tells_a_setres_and_neither_takes_d6s_frame_for_one(self):
        # the read before the wait: found at a size its game chose, the restyle is 'resized' whatever the window is
        # after it; found with D6's frame around a client at the panel's size, it is the panel's (own_size)
        cases = {"found at its own size, at the panel's after the wait": (self.SETRES, self.PANEL_SIZE, 'resized'),
                 "found with D6's frame around a client at the panel's size": (self.D6_FRAME, None, 'restyled')}
        for name, (found, during, expected) in cases.items():
            with self.subTest(name):
                self.assertEqual(self.repaired(found, during), expected)

    def test_a_repair_puts_back_only_what_is_wrong_to_the_childs_styles_and_with_no_frame_change(self):
        # each of the three alone (the games' restyles put back both styles: 317 of 317 in i1a-i3c of a game test
        # of 30 Oct 2026), with its own call only, to _child_styles' values, then the window positioned with no frame
        # change (one makes UE1 run SetRes again); a SetRes that reaches the game during that one call is its own too
        child, child_ex = native_play._child_styles(self.FRAMED, self.FRAMED_EX)
        position = ('position', (0, 0, 1280, 640), False)
        cases = {'its style': (dict(exstyle=child_ex), GWL_STYLE, [('style', GWL_STYLE, child)]),
                 'its extended style': (dict(style=child), GWL_EXSTYLE, [('style', GWL_EXSTYLE, child_ex)]),
                 'its parent': (dict(style=child, exstyle=child_ex), 'parent', [('parent', PANEL)])}
        for (name, (look, wait, calls)), (during, expected) in itertools.product(
                cases.items(), ((None, 'restyled'), (self.SETRES, 'resized'))):
            with self.subTest(name, setres=bool(during)):
                self.assertEqual((self.repaired(self.PANEL_SIZE, during, wait, **look), self.calls),
                                 (expected, calls + [position]))


class FullScreenTests(unittest.TestCase):
    """Full screen asked for in the panel, which both games die of (c3 and c7c of the game test, 29 Oct 2026): Alt+Enter
    kept from the game and reported, and the after-effect of a switch that cannot be kept (the game's video settings,
    the console's ToggleFullscreen)."""

    def test_alt_enter_is_kept_from_the_game_only_while_it_has_the_keyboard(self):
        panel, form, win, clock = attached(self)
        tick(panel, clock, 3)
        self.assertEqual(win.caught, [], 'not while the editor has the keyboard')
        win.active = True
        panel._handlers[1](None, None)                                  # a click in the panel: the game has it
        tick(panel, clock, 5)
        self.assertEqual(win.caught, [True])
        panel.release()                                                 # Shift+F1: let go at once
        self.assertEqual(win.caught, [True, False])
        panel._handlers[1](None, None)
        tick(panel, clock)
        win.active = False                                              # Alt+Tab to another program
        tick(panel, clock)
        self.assertEqual(win.caught, [True, False, True, False])
        win.active = True
        panel._handlers[1](None, None)
        tick(panel, clock)
        win.look.update(MINIMIZED_CHILD, parent=PANEL)                  # a window left alone
        tick(panel, clock, 3)
        self.assertEqual(win.caught, [True, False, True, False, True, False])
        panel.detach()
        self.assertEqual(win.caught[-1], False)

    def test_alt_enter_is_reported_and_the_game_handed_back_to_the_front(self):
        panel, form, win, clock = attached(self)
        win.active = True
        panel._handlers[1](None, None)
        tick(panel, clock)
        done = len(win.calls)
        win.press()                                                     # WM_HOTKEY: the player's Alt+Enter
        state = panel.status()
        self.assertEqual((state['attached'], state['windowMode'], state['error']), (True, 'fullscreenAsked', ''))
        tick(panel, clock, 5)
        self.assertFalse(any(call[0] in ('style', 'parent', 'front') for call in win.calls[done:]), win.calls[done:])
        self.assertEqual(win.caught, [True], 'still kept from the game until the page answers')
        # the page's answer: Continue in game window. Given back as it was, then made the foreground window, where
        # the page asks it for full screen; the key let go at once (no tick runs after a detach)
        state = panel.detach()
        self.assertEqual(win.caught, [True, False])
        self.assertEqual(win.calls[-4:], [('style', GWL_EXSTYLE, 0x00040100), ('enabled', True),
                                          ('position', (0, 0, 3866, 2190), True), ('front', 77)])
        self.assertEqual((state['attached'], state['windowMode']), (False, ''))
        # a Stop's hand-back with no Alt+Enter brings nothing to the front
        panel, form, win, clock = attached(self)
        panel.detach()
        self.assertNotIn(('front', 77), win.calls)

    def test_an_alt_enter_handled_after_the_player_left_the_editor_asks_nothing_and_lets_the_key_go(self):
        # review 2c #5: a WM_HOTKEY handled late (the UI thread held by a display change or SetParent), after the player
        # went to another program and before any tick: that Alt+Enter was the other program's
        panel, form, win, clock = attached(self)
        win.active = True
        panel._handlers[1](None, None)
        tick(panel, clock)
        self.assertEqual(win.caught, [True])
        win.active = False                                              # another program in front, no tick yet
        win.press()
        self.assertEqual(win.caught, [True, False], 'let go at once')
        self.assertEqual(panel.status()['windowMode'], '')
        tick(panel, clock, 3)
        self.assertEqual(panel.status()['windowMode'], '')

    def test_alt_tab_lets_alt_enter_go_before_enable_window_waits_for_the_game(self):
        # review 2c #5: EnableWindow waits for a busy game (a map loading); the key goes first, so that it is not kept
        # from the program the player went to while the UI thread waits there
        panel, form, win, clock = attached(self)
        win.active = True
        panel._handlers[1](None, None)
        tick(panel, clock)
        kept, enabled = [], win.enabled
        win.enabled = lambda hwnd, value: (kept.append((value, win.caught[-1])), enabled(hwnd, value))
        win.active = False                                              # Alt+Tab to another program
        tick(panel, clock)
        self.assertEqual(kept, [(False, False)], 'disabled with the key already let go')

    def test_an_alt_enter_queued_past_a_detach_asks_nothing_of_the_next_game(self):
        # review 2c #8: a WM_HOTKEY still queued when the game was let go (Stop's hand-back, Continue in game window)
        panel, form, win, clock = attached(self)
        win.active = True
        panel._handlers[1](None, None)
        tick(panel, clock)
        panel.detach()
        win.press()
        for _ in range(3):                                              # the next Play's window, settled
            state = panel.embed(EMBED)
            clock.now += .5
        self.assertTrue(state['attached'], state)
        self.assertEqual(panel.status()['windowMode'], '')

    def test_c3_the_window_that_vanishes_into_an_error_box_is_reported(self):
        panel, form, win, clock = attached(self)
        win.look.update(C3_FULL_SCREEN_CHILD, parent=PANEL)
        tick(panel, clock)
        win.window, win.box = False, True                               # "Critical Error", the process runs on
        tick(panel, clock)
        self.assertFalse(panel.status()['attached'])
        done = len(win.calls)
        state = panel.embed(EMBED)                                      # the page waits for a window again
        self.assertEqual((state['attached'], state.get('pending'), state['windowMode']), (False, False, 'crashed'))
        # worded by what was seen (review 2c #12): any critical error of the game looks so; full screen is one cause
        self.assertRegex(state['error'], r'window closed while the game ran on.*one cause')
        self.assertEqual(panel.embed(EMBED)['windowMode'], 'crashed')
        self.assertEqual(win.calls[done:], [], 'nothing done to its windows')

    def test_a_tick_that_races_the_vanishing_window_leaves_no_error_over_the_crashed_report(self):
        # review 2c #3: the window destroyed between the tick's IsWindow and its GetWindowRect; the tick's error is
        # about that window, which the next tick lets go
        panel, form, win, clock = attached(self, VanishingWin(WINDOWED))
        win.box = win.vanish = True
        tick(panel, clock)
        self.assertTrue(panel._error.startswith('Game panel:'), panel._error)
        tick(panel, clock)
        state = panel.status()
        self.assertEqual((state['attached'], state['windowMode'], state['error']), (False, '', ''))
        state = panel.embed(EMBED)
        self.assertEqual((state.get('pending'), state['windowMode']), (False, 'crashed'))

    def test_a_game_left_with_no_window_is_reported_after_gone_wait_unless_one_shows_again(self):
        panel, form, win, clock = attached(self)
        win.window = False                                              # the original game: gone with no resize (c7c)
        tick(panel, clock)
        state = panel.embed(EMBED)
        self.assertEqual((state.get('pending'), state['windowMode']), (True, ''), 'a game that quits ends in 0.1-0.4 s')
        clock.now += native_play.GONE_WAIT
        state = panel.embed(EMBED)
        self.assertEqual((state.get('pending'), state['windowMode']), (False, 'crashed'))
        win.window = True                                               # a window of its own again: taken in, settled
        self.assertEqual(panel.embed(EMBED)['windowMode'], '')
        clock.now += native_play.SETTLE
        self.assertTrue(panel.embed(EMBED)['attached'])


class CoverTests(unittest.TestCase):
    """The cover: the editor's window kept above every other window while an embedded Play starts, so that the game's
    splash and its window, white until its first frame, stay behind it (S6b of the start-up investigation, 29 Oct
    2026), on stand-ins (the editor's window is the form's 200)"""
    CHANGES = ('topmost', 'style', 'parent', 'position', 'enabled', 'focus')

    def covered(self, win=None, clock=None):
        """a panel whose cover went on (the page's game_cover at the launch), its game not started yet"""
        win, clock = win or Win(WINDOWED), clock or Clock()
        win.window = False
        panel, form = made(win, clock)
        self.assertEqual(panel.cover(True), dict(covered=True, error=''))
        self.assertEqual([c for c in win.calls if c[0] in self.CHANGES], [('topmost', True, None)])
        self.assertEqual((panel.status()['covered'], panel._cover_timer.running), (True, True))
        return panel, form, win, clock

    def watch(self, panel, clock, times=1):
        """the cover's timer, `times` ticks COVER_TICK apart"""
        for _ in range(times):
            clock.now += native_play.COVER_TICK / 1000
            cover_tick(panel)

    def test_the_cover_goes_on_at_the_launch_and_off_once_the_game_window_is_in_the_panel(self):
        panel, form, win, clock = self.covered()
        self.assertTrue(panel.embed(EMBED).get('pending'))              # Steam still starting the game
        win.window = True                                               # its window, then its game's answer
        self.watch(panel, clock, 5)
        win.in_front_now = (77, 123)                                    # the game in front as it starts (S6b)
        self.watch(panel, clock, 5)
        self.assertTrue(panel.status()['covered'], 'neither the game nor time let it go')
        for _ in range(3):
            state = panel.embed(EMBED)
            clock.now += .5
        self.assertEqual((state['attached'], state['covered']), (True, False))
        # let go before the window is the panel's child: changed with a child of the game's thread, the editor's window
        # waits for that thread (5.7 s for a stand-in thread that took no messages)
        self.assertEqual([call[:2] for call in win.calls if call[0] in ('topmost', 'style', 'parent')],
                         [('topmost', True), ('topmost', False), ('style', GWL_STYLE), ('style', GWL_EXSTYLE),
                          ('parent', PANEL)])
        self.watch(panel, clock, 5)
        self.assertEqual(sum(c[0] == 'topmost' for c in win.calls), 2, 'once')

    def test_the_cover_goes_at_every_end(self):
        # the ends of the cover (COVER_LIMIT): what the page asks, what the panel finds, and the time limit
        def left_alone(panel, form, win, clock):
            win.window, win.look = True, dict(FULL_SCREEN, parent=None, enabled=True)
            for _ in range(21):                                         # MODE_WAIT: reported, never taken in
                panel.embed(EMBED)
                clock.now += .5
            self.assertEqual(panel.status()['windowMode'], 'fullscreen')
            self.watch(panel, clock)

        def crashed(panel, form, win, clock):
            # a game in the panel (its attach lets the cover go), then its window vanishes with an error box
            win.window = True
            for _ in range(3):
                panel.embed(EMBED)
                clock.now += .5
            win.window, win.box = False, True
            tick(panel, clock)
            win.calls.clear()
            self.assertEqual(panel.cover(True)['covered'], True)
            self.assertEqual(panel.embed(EMBED)['windowMode'], 'crashed')
            self.watch(panel, clock)

        def other_program(panel, form, win, clock):
            win.others[4242] = 'C:/Programs/Browser/browser.exe'
            win.in_front_now = (999, 4242)
            self.watch(panel, clock)

        def unreadable(panel, form, win, clock):
            # a program the editor cannot look at (one run as administrator, or gone meanwhile) is another program
            win.in_front_now = (996, 4545)
            with mock.patch.object(win, 'process', side_effect=OSError(5, 'Access is denied')):
                self.watch(panel, clock)

        def started_for_the_player(path):
            # a program the editor starts for the player (Steam that was not running yet, a browser, Blender) is
            # another program: its window in front kept the cover, then stayed behind the editor (cross-check of 30
            # Oct 2026)
            def end(panel, form, win, clock):
                win.others[4343] = path
                win.family.add(4343)
                win.in_front_now = (998, 4343)
                self.watch(panel, clock)
            return end

        def game_dialog(panel, form, win, clock):
            # its 'Critical Error' box as a start fails before its window (review su #4, 30 Oct 2026), even of a game
            # the editor started itself (no Steam): shown at once, not kept behind the editor for COVER_LIMIT
            win.family.add(123)
            win.dialogs.add(88)
            win.in_front_now = (88, 123)
            self.watch(panel, clock)

        def desktop(panel, form, win, clock):
            # the shell's desktop window, the player having clicked the desktop: behind it, where _Win32.topmost goes
            # no further than HWND_NOTOPMOST (review su2 #5, 30 Oct 2026)
            win.others[4343], win.desktops = 'C:/Windows/explorer.exe', {997}
            win.in_front_now = (997, 4343)
            self.watch(panel, clock)

        def failed_attach(panel, form, win, clock):
            win.window = True
            with mock.patch.object(win, 'parent', side_effect=OSError(5, 'Access is denied')):
                for _ in range(3):
                    state = panel.embed(EMBED)
                    clock.now += .5
            self.assertIn('Access is denied', state['error'])

        def minimized(panel, form, win, clock):
            win.shown_now = False
            self.watch(panel, clock)

        def limit(panel, form, win, clock):
            clock.now += native_play.COVER_LIMIT - 1
            cover_tick(panel)
            self.assertTrue(panel.status()['covered'], 'not before COVER_LIMIT')
            clock.now += 1
            cover_tick(panel)

        ends = {'Stop (the page lets it go)': (lambda panel, form, win, clock: panel.cover(False), None),
                'the Game view left, the app closing (detach)': (lambda panel, form, win, clock: panel.detach(), None),
                'the attach failed (detach)': (failed_attach, None),
                'its window left alone outside the panel': (left_alone, None),
                'its window vanished with an error': (crashed, None),
                'another program in front: behind its window': (other_program, 999),
                'a program the editor cannot look at in front: behind its window': (unreadable, 996),
                'Steam the editor started, in front: behind its window':
                    (started_for_the_player('C:/Program Files (x86)/Steam/steam.exe'), 998),
                'a browser the editor started, in front: behind its window':
                    (started_for_the_player('C:/Program Files/Browser/browser.exe'), 998),
                'Blender the editor started, in front: behind its window':
                    (started_for_the_player('C:/Program Files/Blender Foundation/Blender 5.0/blender.exe'), 998),
                "the game's dialog in front: behind it": (game_dialog, 88),
                'the desktop in front: behind it': (desktop, 997),
                'the editor minimized or hidden': (minimized, None),
                'COVER_LIMIT': (limit, None)}
        for name, (end, behind) in ends.items():
            with self.subTest(name):
                panel, form, win, clock = self.covered()
                end(panel, form, win, clock)
                self.assertEqual((panel.status()['covered'], panel._cover_timer.running), (False, False))
                self.assertEqual([c for c in win.calls if c[0] == 'topmost'][-1], ('topmost', False, behind))
                self.watch(panel, clock, 3)
                self.assertEqual([c for c in win.calls if c[0] == 'topmost'].count(('topmost', True, None)), 1,
                                 'never on again by itself')

    def test_the_games_dialog_ends_the_cover_wherever_it_shows(self):
        # defect B of the second game test (30 Oct 2026): the 'Critical Error' box of a start that failed showed while
        # the game's splash stayed the window in front, and lay below the editor until COVER_LIMIT, then for good. A
        # dialog of the game ends the cover wherever it is, the editor going behind the lowest of them, or behind
        # another program's window in front when that one is lower still: below them all. Not behind the desktop's,
        # the last of all, behind which _Win32.topmost goes no further than HWND_NOTOPMOST, above the box
        splash, box, second, theirs, desktop = (76, 123), (88, 123), (89, 123), (999, 4242), (997, 4343)
        editor = (200, os.getpid())
        cases = {"the game's splash in front (g4b)": (splash, [splash, box], 88),
                 'the editor in front': (editor, [editor, box], 88),
                 'nothing in front': ((None, 0), [box], 88),
                 'two boxes: behind the lower': (splash, [splash, box, second], 89),
                 "another program's window in front, above the box: behind the box": (theirs, [theirs, box], 88),
                 "another program's window in front, below the box: behind it": (theirs, [box, theirs], 999),
                 'the desktop in front: behind the box': (desktop, [box, desktop], 88),
                 "a dialog of another program, not the game's: no end": (splash, [splash, (87, 4242)], None)}
        for name, (front, z, behind) in cases.items():
            with self.subTest(name):
                panel, form, win, clock = self.covered()
                win.others.update({4242: 'C:/Programs/Browser/browser.exe', 4343: 'C:/Windows/explorer.exe'})
                win.dialogs, win.desktops, win.z, win.in_front_now = {87, 88, 89}, {997}, z, front
                self.watch(panel, clock)
                self.assertEqual(panel.status()['covered'], behind is None)
                self.assertEqual([c for c in win.calls if c[0] == 'topmost'][-1],
                                 ('topmost', True, None) if behind is None else ('topmost', False, behind))
        # the box showing as COVER_LIMIT comes: behind it, not only out of the topmost windows (above it, for good)
        panel, form, win, clock = self.covered()
        clock.now += native_play.COVER_LIMIT
        win.dialogs, win.z, win.in_front_now = {88}, [splash, box], splash
        self.watch(panel, clock)
        self.assertEqual((panel.status()['covered'], [c for c in win.calls if c[0] == 'topmost'][-1]),
                         (False, ('topmost', False, 88)))

    def test_the_cover_resolves_the_path_of_no_other_programs_executable(self):
        # review su3 #4 (31 Oct 2026): the cover looks at the process of every captioned window that shows (_foreign),
        # and resolved the path of each one's executable on the UI thread (Path.resolve opens the file): one on a share
        # that no longer answered held it 21 s at the cover's first look. Only an executable named as one of GAMES' is
        # resolved, and only when its path as Windows gives it is none of the cover's GAMES: the game's own needs no
        # resolving, the game started through a link and a copy of it elsewhere do (GAME_NAMES)
        link, copy = r'C:\Link\Revision\System\Revision.exe', r'C:\Copy\System\DeusEx.exe'
        links = {link: 'C:/Games/Deus Ex/Revision/System/Revision.exe'}
        splash, theirs = (76, 123), [(87, 4242), (86, 4343)]
        cases = {"other programs' dialogs only: no end": (splash, None, None, []),
                 "another program's window in front: behind it": ((999, 4444), None, 999, []),
                 "the game's box: behind it": (splash, 123, 88, []),
                 'the box of the game started through a link: behind it': (splash, 5151, 88, [link]),
                 'the box of a copy of the game elsewhere: no end': (splash, 5252, None, [copy])}
        for name, (front, box, behind, expected) in cases.items():
            with self.subTest(name):
                panel, form, win, clock = self.covered()
                win.others.update({4242: r'\\nas\apps\tool.exe', 4343: 'N:/Viewer/viewer.exe',
                                   4444: r'\\nas\apps\editor.exe', 5151: link, 5252: copy})
                win.dialogs, win.in_front_now = {86, 87, 88}, front
                win.z = [front] + theirs + ([(88, box)] if box else [])
                resolved = []
                with resolving(resolved, lambda path: links.get(path, path)):
                    self.watch(panel, clock)
                self.assertEqual(resolved, expected)
                self.assertEqual(panel.status()['covered'], behind is None)
                self.assertEqual([c for c in win.calls if c[0] == 'topmost'][-1],
                                 ('topmost', True, None) if behind is None else ('topmost', False, behind))

    def test_continue_in_game_window_brings_a_game_window_never_taken_in_to_the_front(self):
        # review su3 #5 (31 Oct 2026): a cover that ends without an attach (here COVER_LIMIT: the game's window there,
        # its game never answering) leaves the editor's window above the game's, and the page's Continue in game
        # window, after the detach of its error, only detached again: the game's window stayed under the editor's,
        # maybe the foreground window, until its player found it with Alt+Tab. detach(front) brings it to the front
        # while the editor's window is in front (its player's click), the game of the page's Play still running
        def failed():
            panel, form, win, clock = self.covered()
            win.window, win.answering = True, False
            for _ in range(int(native_play.COVER_LIMIT / .5) + 1):     # embed every 0.5 s, the cover's timer too
                self.assertTrue(panel.embed(EMBED).get('pending'))
                clock.now += .5
                cover_tick(panel)
            self.assertEqual((panel.status()['covered'], [c for c in win.calls if c[0] == 'topmost'][-1]),
                             (False, ('topmost', False, None)))
            panel.detach()                                              # the page's own, at its error
            self.assertNotIn(('front', 77), win.calls)
            win.active = True                                           # the click on Continue in game window
            return panel, win
        # Windows with no foreground window as its task runs (the window in front just closed or minimized, a locked
        # PC): the real _Win32.foreground, GetForegroundWindow answering NULL (review su4 #3, 31 Oct 2026)
        nobody = native_play._Win32.__new__(native_play._Win32)
        nobody.user = SimpleNamespace(GetForegroundWindow=lambda: None, GetAncestor=lambda hwnd, kind: None)
        for name, change, front, fronted in (
                ('Continue in game window', {}, True, True),
                ('no flag: Stop, the Game view left, the app closing', {}, False, False),
                ('the editor no longer in front as its task runs', dict(active=False), True, False),
                ('no foreground window as its task runs', dict(foreground=nobody.foreground), True, False),
                ('its game ended', dict(running=False), True, False)):
            with self.subTest(name):
                panel, win = failed()
                for key, value in change.items():
                    setattr(win, key, value)
                state = panel.detach(front) if front else panel.detach()
                self.assertEqual((state['attached'], state['error']), (False, ''))
                self.assertEqual(win.calls.count(('front', 77)), int(fronted))
                if fronted:
                    self.assertEqual(win.calls[-1], ('front', 77))
        # another process with the game's pid (Windows gives the pids of processes that ended to new ones)
        panel, win = failed()
        with mock.patch.object(win, 'process', return_value=dict(handle=1, pid=123, path=win.path, created='2')):
            self.assertEqual(panel.detach(True)['error'], '')
        self.assertNotIn(('front', 77), win.calls)
        # a window in the panel that its game kept restyling ('unsettled'): handed back as it came, then to the front
        panel, form, win, clock = attached(self, RestylingWin(WINDOWED))
        tick(panel, clock, 100)
        self.assertEqual(panel.status()['windowMode'], 'unsettled')
        win.active = True
        with mock.patch.object(win, 'find_window', return_value=None):     # top-level windows only: not this one
            self.assertEqual(panel.detach(True)['attached'], False)
        self.assertEqual(win.calls[-2:], [('position', (0, 0, 3866, 2190), True), ('front', 77)])
        # a Play never embedded brings nothing to the front; a flag that is not one is refused, nothing detached
        win, clock = Win(WINDOWED), Clock()
        panel, form = made(win, clock)
        win.active = True
        self.assertEqual((panel.detach(True)['error'], [c for c in win.calls if c[0] == 'front']), ('', []))
        panel, form, win, clock = attached(self)
        done = len(win.calls)
        self.assertEqual(panel.detach('yes')['error'], 'Invalid detach request')
        self.assertEqual((win.calls[done:], panel.status()['attached']), ([], True))

    def test_the_cover_never_goes_on_over_another_program_a_hidden_editor_or_a_game_in_the_panel(self):
        win, clock = Win(WINDOWED), Clock()
        panel, form = made(win, clock)
        win.others[4242], win.in_front_now = 'C:/Programs/Browser/browser.exe', (999, 4242)
        self.assertEqual(panel.cover(True), dict(covered=False, error=''))
        win.in_front_now, win.shown_now = (200, 1), False
        self.assertEqual(panel.cover(True), dict(covered=False, error=''))
        win.shown_now = True
        for _ in range(3):
            panel.embed(EMBED)
            clock.now += .5
        self.assertEqual(panel.cover(True), dict(covered=False, error=''))
        self.assertFalse(any(call[0] == 'topmost' for call in win.calls), win.calls)
        self.assertEqual(panel.cover('yes')['error'], 'Invalid cover request')
        # nor when Windows does not take the change (_Win32.topmost, TOPMOST_TRIES)
        panel, form = made(win, clock)
        win.window, win.z_order = False, False
        self.assertEqual((panel.cover(True), panel._cover_timer), (dict(covered=False, error=''), None))

    def test_a_cover_windows_does_not_let_go_stays_on_and_its_timer_asks_again(self):
        # the editor's window must never stay above every other window: a letting go that Windows dropped TOPMOST_TRIES
        # times in a row is asked again at every tick of the cover's timer until it is taken
        panel, form, win, clock = self.covered()
        win.others[4242], win.in_front_now = 'C:/Programs/Browser/browser.exe', (999, 4242)
        win.z_order = False
        self.watch(panel, clock)
        self.assertEqual((panel.status()['covered'], panel._cover_timer.running), (True, True))
        self.watch(panel, clock, 2)
        win.z_order = True
        self.watch(panel, clock)
        self.assertEqual((panel.status()['covered'], panel._cover_timer.running), (False, False))
        self.assertEqual([c for c in win.calls if c[0] == 'topmost'],
                         [('topmost', True, None)] + [('topmost', False, 999)] * 4)

    def test_a_cover_whose_watch_fails_is_let_go_only_once_windows_takes_it(self):
        # the editor's window must never stay above every other window: an error in the cover's timer lets the cover
        # go, and a letting go that Windows dropped TOPMOST_TRIES times is asked again at the next tick
        panel, form, win, clock = self.covered()
        win.z_order = False
        with mock.patch.object(win, 'in_front', side_effect=RuntimeError('a window call failed')):
            self.watch(panel, clock)
            self.assertEqual((panel.status()['covered'], panel._cover_timer.running), (True, True))
            win.z_order = True
            self.watch(panel, clock)
        self.assertEqual((panel.status()['covered'], panel._cover_timer.running), (False, False))
        self.assertEqual([c for c in win.calls if c[0] == 'topmost'],
                         [('topmost', True, None)] + [('topmost', False, None)] * 2)

    def test_letting_go_behind_a_topmost_window_never_leaves_the_editor_topmost(self):
        # review su #3 (30 Oct 2026): behind a window that is topmost itself (the taskbar, Start, the Alt+Tab switcher)
        # Windows made the editor's window topmost again, and topmost() said it was let go. Windows' rule, as the
        # review measured it on real windows: a window moved behind another takes that one's band
        top, no_top, band = native_play.HWND_TOPMOST, native_play.HWND_NOTOPMOST, native_play.WS_EX_TOPMOST
        flags = native_play.SWP_NOMOVE | native_play.SWP_NOSIZE | native_play.SWP_NOACTIVATE
        cases = {'behind a window that is not topmost': (0, False, [no_top, 999]),
                 'behind a topmost window: no further than HWND_NOTOPMOST': (band, False, [no_top]),
                 'behind a window made topmost meanwhile: asked again': (0, True, [no_top, 999, no_top])}
        for name, (behind, turns, expected) in cases.items():
            with self.subTest(name):
                exstyle, asked = {200: band, 999: behind}, []

                def set_window_pos(hwnd, after, x, y, width, height, flags):
                    asked.append((after, flags))
                    if after in (top, no_top):
                        exstyle[hwnd] = band if after == top else 0
                        return True
                    if turns:
                        exstyle[after] = band                           # topmost between the look and the move
                    exstyle[hwnd] = exstyle[after]
                    return True
                win = native_play._Win32.__new__(native_play._Win32)
                win.user = SimpleNamespace(SetWindowPos=set_window_pos)
                win._get_long = lambda hwnd, index: exstyle[hwnd]
                win._class = lambda hwnd: 'Static'
                self.assertTrue(win.topmost(200, False, 999))
                self.assertEqual((asked, exstyle[200]), ([(after, flags) for after in expected], 0))

    def test_letting_go_behind_the_desktop_leaves_the_editor_where_it_is(self):
        # review su2 #5 (30 Oct 2026): behind the shell's desktop window, the window in front once the player clicks
        # the desktop and the last of all, the editor's window went under every other window. Windows' band rule as
        # above; a plain window for comparison
        top, no_top, band = native_play.HWND_TOPMOST, native_play.HWND_NOTOPMOST, native_play.WS_EX_TOPMOST
        for name, expected in (('Progman', [no_top]), ('WorkerW', [no_top]), ('Static', [no_top, 998])):
            with self.subTest(name):
                exstyle, asked = {200: band, 998: 0}, []

                def set_window_pos(hwnd, after, x, y, width, height, flags):
                    asked.append(after)
                    exstyle[hwnd] = band if after == top else 0 if after == no_top else exstyle[after]
                    return True
                win = native_play._Win32.__new__(native_play._Win32)
                win.user = SimpleNamespace(SetWindowPos=set_window_pos)
                win._get_long = lambda hwnd, index: exstyle[hwnd]
                win._class = lambda hwnd: {998: name}.get(hwnd, 'Static')
                self.assertTrue(win.topmost(200, False, 998))
                self.assertEqual((asked, exstyle[200]), (expected, 0))

    def test_a_z_order_change_that_windows_drops_is_asked_again(self):
        # Windows answered SetWindowPos(HWND_TOPMOST / HWND_NOTOPMOST) as done and left WS_EX_TOPMOST as it was in 16
        # of about 480 calls with four test processes at once, and took it asked again at once (30 Oct 2026)
        for on, behind, drops in itertools.product((True, False), (None, 999), range(native_play.TOPMOST_TRIES + 1)):
            with self.subTest(on=on, behind=behind, drops=drops):
                window, asked = dict(exstyle=0 if on else native_play.WS_EX_TOPMOST), []

                def set_window_pos(hwnd, after, x, y, width, height, flags):
                    asked.append((after, flags))
                    if after in (native_play.HWND_TOPMOST, native_play.HWND_NOTOPMOST) and len(asked) > drops:
                        window['exstyle'] = native_play.WS_EX_TOPMOST if after == native_play.HWND_TOPMOST else 0
                    return True
                win = native_play._Win32.__new__(native_play._Win32)
                win.user = SimpleNamespace(SetWindowPos=set_window_pos)
                win._get_long = lambda hwnd, index: window['exstyle']
                win._class = lambda hwnd: 'Static'
                taken = drops < native_play.TOPMOST_TRIES
                band = native_play.HWND_TOPMOST if on else native_play.HWND_NOTOPMOST
                flags = native_play.SWP_NOMOVE | native_play.SWP_NOSIZE | native_play.SWP_NOACTIVATE
                self.assertEqual(win.topmost(200, on, behind), taken)
                self.assertEqual(asked, [(band, flags)] * min(drops + 1, native_play.TOPMOST_TRIES) +
                                 ([(behind, flags)] if behind and not on and taken else []))

    def test_the_window_in_front_stands_for_the_foreground_windows_root_owner(self):
        # an owned window in front (another program's dialog, a box owned by the game's splash) stands for its root
        # owner, the window the editor's goes behind (review su2 #4, 30 Oct 2026: no test ran in_front)
        ancestors = {(5, native_play.GA_ROOTOWNER): 3, (5, 2): 5}                # 2: GA_ROOT, the top-level window
        win = native_play._Win32.__new__(native_play._Win32)
        win.user = SimpleNamespace(GetForegroundWindow=lambda: 5, GetAncestor=lambda hwnd, kind: ancestors[hwnd, kind])
        win.pid = {3: 4242}.get
        self.assertEqual(win.in_front(), (3, 4242))
        win.user.GetForegroundWindow = lambda: None
        self.assertEqual(win.in_front(), (None, 0))

    def test_the_editor_is_in_front_only_while_a_window_of_its_own_or_the_game_is_the_foreground_window(self):
        # Continue in game window brings the game's window to the front only while the editor's is in front
        # (foreground(form, None)). Windows has no foreground window at times (the window in front just closed or
        # minimized, a locked PC), and that is no window of the editor's (review su4 #3, 31 Oct 2026: no test ran the
        # real foreground); the form 200, a window whose root (GA_ROOT) is the form, the game's 77, another's 999
        roots = {200: 200, 201: 200, 77: 77, 999: 999}
        win = native_play._Win32.__new__(native_play._Win32)
        for active, alone, with_the_game in ((None, False, False), (200, True, True), (201, True, True),
                                             (77, False, True), (999, False, False)):
            with self.subTest(active=active):
                win.user = SimpleNamespace(GetForegroundWindow=lambda active=active: active,
                                           GetAncestor=lambda hwnd, kind: roots[hwnd] if kind == 2 else None)
                self.assertEqual((win.foreground(200, None), win.foreground(200, 77)), (alone, with_the_game))

    def test_the_editors_own_windows_and_its_games_are_no_other_program(self):
        # the editor's window, a window it owns or of its process or of one of its own programs it started, directly
        # or not (its build host's lighting viewport, captioned: defect 2 of the game test of 30 Oct 2026), and the
        # game's viewport (Revision's or the original game's, taking the front as it starts: S6b) keep the cover; the
        # first window of another program in front ends it, a build host the editor did not start (another
        # DeusEdix's) too
        for other in ('C:/Games/Deus Ex/Revision/System/Other.exe', 'C:/Other/tools/mapkit/bin/UCMapKitHost.exe'):
            with self.subTest(other):
                panel, form, win, clock = self.covered()
                win.others[555] = 'C:/Games/Deus Ex/System/DeusEx.exe'
                win.others[os.getpid()] = 'C:/Program Files/DeusEdix/DeusEdix.exe'      # the editor's own: no game
                win.others[666] = 'C:/DeusEdixProjects/p/tools/mapkit/runs/r/System/UCMapKitHost.exe'
                win.family.add(666)
                win.dialogs.add(66)
                for front in ((200, 1), (321, os.getpid()), (77, 123), (88, 555), (66, 666), (None, 0)):
                    win.in_front_now = front
                    self.watch(panel, clock)
                    self.assertTrue(panel.status()['covered'], front)
                win.others[4242], win.in_front_now = other, (999, 4242)
                self.watch(panel, clock)
                self.assertFalse(panel.status()['covered'])


class JobTests(unittest.TestCase):
    def test_an_embedded_game_ends_with_the_editor_until_it_is_handed_back(self):
        # c8b of the game test (29 Oct 2026): the editor ended, the game ran on with no window at all
        panel, form, win, clock = attached(self)
        self.assertEqual(win.jobs, [('job', 123)])
        panel.detach()                                                  # Continue in game window, or Stop's hand-back
        self.assertEqual(win.jobs, [('job', 123), ('free', 600)])
        # one that ended in the panel is let go too; a window never taken in is never held
        panel, form, win, clock = attached(self)
        win.running = False
        tick(panel, clock)
        self.assertEqual(win.jobs, [('job', 123), ('free', 600)])
        win, clock = Win(FULL_SCREEN), Clock()
        panel, _ = made(win, clock)
        for _ in range(21):
            panel.embed(EMBED)
            clock.now += .5
        self.assertEqual(win.jobs, [])

    @unittest.skipUnless(sys.platform == 'win32', 'job objects are Windows')
    def test_on_real_processes_the_game_ends_with_the_editor_that_holds_it_and_lives_on_once_let_go(self):
        # stand-ins: the game is a Python reading its stdin (it ends when this test closes it), the editor a Python
        # that holds it in its job and ends with os._exit, closing nothing, as a crash does
        for free in (False, True):
            with self.subTest(free=free):
                game = subprocess.Popen([sys.executable, '-c', 'import sys; sys.stdin.read()'], stdin=subprocess.PIPE)
                try:
                    editor = ('import os, sys; sys.path.insert(0, %r); import native_play; win = native_play._Win32(); '
                              'job = win.job(%d); %s os._exit(0)' % (str(HERE), game.pid,
                                                                     'win.free_job(job);' if free else ''))
                    subprocess.run([sys.executable, '-c', editor], check=True, timeout=60)
                    try:
                        game.wait(2)                                    # ended at once, if it ends
                    except subprocess.TimeoutExpired:
                        pass
                    self.assertEqual(game.poll() is None, free)
                finally:
                    game.stdin.close()
                    game.wait(10)


# Win32 values of the real-window tests: the 'Critical Error' box as c3 of the game test saw it (captioned #32770) and a
# start-up dialog of the game (no caption), each made off screen, never activated, with no taskbar button; the hidden
# windows of D5's tests
CRITICAL_ERROR_STYLE, START_UP_DIALOG_STYLE = 0x94c801c5, 0x94000a44
WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE = 0x00000080, 0x08000000
WS_EX_NOPARENTNOTIFY = 0x00000004
WS_VISIBLE, WS_BORDER, ERROR_CLASS_ALREADY_EXISTS = 0x10000000, 0x00800000, 1410
PM_REMOVE, ERROR_HOTKEY_ALREADY_REGISTERED = 1, 1409


def user32():
    """user32 with the calls of the real-window tests that the panel never makes (posting and taking messages,
    destroying a window, reading the z-order and the shell's windows); the panel's own are called on _Win32's `user`,
    which declares them"""
    user = ctypes.WinDLL('user32', use_last_error=True)
    message = ctypes.POINTER(wintypes.MSG)
    for name, args, result in (
            ('PostMessageW', [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM], wintypes.BOOL),
            ('PeekMessageW', [message, wintypes.HWND, wintypes.UINT, wintypes.UINT, wintypes.UINT], wintypes.BOOL),
            ('DispatchMessageW', [message], ctypes.c_ssize_t),
            ('DestroyWindow', [wintypes.HWND], wintypes.BOOL),
            ('ShowWindow', [wintypes.HWND, ctypes.c_int], wintypes.BOOL),
            ('GetWindow', [wintypes.HWND, wintypes.UINT], wintypes.HWND),
            ('UnregisterClassW', [wintypes.LPCWSTR, wintypes.HINSTANCE], wintypes.BOOL),
            ('GetTopWindow', [wintypes.HWND], wintypes.HWND),
            ('GetShellWindow', [], wintypes.HWND)):
        function = getattr(user, name)
        function.argtypes, function.restype = args, result
    return user


def z_order(user):
    """Every top-level window, the front one first (GetTopWindow, then each next one), read apart from EnumWindows"""
    found, hwnd = [], user.GetTopWindow(None)
    while hwnd:
        found.append(int(hwnd))
        hwnd = user.GetWindow(hwnd, 2)                                  # GW_HWNDNEXT
    return found


def take_messages(user, done, wait):
    """The calling thread's messages taken (PeekMessage, which also runs the messages other threads send it) until
    done(), for `wait` seconds at most."""
    message, end = wintypes.MSG(), time.monotonic() + wait
    while not done() and time.monotonic() < end:
        while user.PeekMessageW(ctypes.byref(message), None, 0, 0, PM_REMOVE):
            user.DispatchMessageW(ctypes.byref(message))
        time.sleep(.005)


class SilentWindow:
    """A hidden window of a thread of its own that takes no messages until `answer` is set (5 s at most), as the thread
    of a game that is still starting (D5 of the game test, 29 Oct 2026), then takes them (`taking`) until close(),
    which destroys the window on that thread."""
    def __init__(self, win, user):
        self.answer, self.taking, self.closing, made = (threading.Event() for _ in range(4))
        self.hwnd = None

        def run():
            self.hwnd = win.user.CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_NOPARENTNOTIFY, 'Static',
                                                 'stand-in', native_play.WS_POPUP, -32000, -32000, 100, 50, None,
                                                 None, None, None)
            made.set()
            self.answer.wait(5)
            self.taking.set()
            take_messages(user, self.closing.is_set, 60)
            user.DestroyWindow(self.hwnd)
        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()
        made.wait(5)

    def close(self, user):
        """Its thread let go and ended, this thread taking its own messages meanwhile."""
        self.answer.set()
        self.closing.set()
        take_messages(user, lambda: not self.thread.is_alive(), 10)


@unittest.skipUnless(sys.platform == 'win32', 'Win32')
class RealWin32Tests(unittest.TestCase):
    """The real _Win32 calls of the hotkey, the error box (review 2c #7) and the game's window (find_window, review su4
    #4, 31 Oct 2026), on this thread: a message-only window, Alt+Enter held for milliseconds only, error-box and
    viewport stand-ins off screen, each let go or destroyed in a finally. Then
    the question to a game's thread (D5 of the game test, 29 Oct 2026) and the repair's reads of a window that its
    'game' changes while the repair waits for it (D2 of that of 30 Oct 2026), on hidden windows of a thread that takes
    no messages until it is told to (SilentWindow)."""

    def test_the_keys_window_reports_its_hotkey_and_alt_enter_is_held_only_while_caught(self):
        win, user, presses = native_play._Win32(), user32(), []
        hwnd = win.keys_window(lambda: presses.append(True))
        caught = taken = freed = None
        try:
            # its WM_HOTKEY, posted and pumped (only this window's messages)
            self.assertTrue(user.PostMessageW(hwnd, native_play.WM_HOTKEY, 1, 0))
            message = wintypes.MSG()
            while user.PeekMessageW(ctypes.byref(message), hwnd, 0, 0, PM_REMOVE):
                user.DispatchMessageW(ctypes.byref(message))
            self.assertEqual(presses, [True])
            alt_enter = native_play.MOD_ALT | native_play.MOD_NOREPEAT, native_play.VK_RETURN
            try:
                caught = win.catch_keys(hwnd, True)
                if caught:
                    # nobody else gets Alt+Enter while it is caught (the error code), everybody once it is let go
                    taken = bool(win.user.RegisterHotKey(None, 2, *alt_enter)) or ctypes.get_last_error()
                    win.catch_keys(hwnd, False)
                    freed = bool(win.user.RegisterHotKey(None, 2, *alt_enter))
            finally:
                win.catch_keys(hwnd, False)
                win.user.UnregisterHotKey(None, 2)
        finally:
            user.DestroyWindow(hwnd)
        if not caught:
            self.skipTest('another program holds Alt+Enter')
        self.assertEqual((taken, freed), (ERROR_HOTKEY_ALREADY_REGISTERED, True))

    def test_the_error_box_is_a_captioned_dialog_of_the_game(self):
        win, user, pid = native_play._Win32(), user32(), os.getpid()
        self.assertFalse(win.error_box(pid), 'no dialog of this process yet')
        for style, box in ((CRITICAL_ERROR_STYLE, True), (START_UP_DIALOG_STYLE, False)):
            hwnd = win.user.CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, '#32770', 'stand-in', style,
                                            -32000, -32000, 100, 50, None, None, None, None)
            try:
                self.assertTrue(hwnd, ctypes.get_last_error())
                self.assertEqual(win.error_box(pid), box, hex(style))
            finally:
                user.DestroyWindow(hwnd)

    def test_a_dialog_of_a_game_is_a_captioned_window_that_is_not_its_viewport(self):
        # review su #4 (30 Oct 2026): the cover shows a game's dialog at once. Its 'Critical Error' box (c3 and
        # c7_crashed of the game tests) and any captioned window but its viewport are; its splash and start-up dialogs
        # (no caption), a window with a thin border only (one of the caption's two bits) and its viewport (captioned,
        # a class of VIEWPORTS, registered here as Revision's) are not
        win, user, pid = native_play._Win32(), user32(), os.getpid()
        instance, viewport = win.kernel.GetModuleHandleW(None), 'RevisionUnrealWWindowsViewportWindowLite'
        window_class = native_play._WindowClass(lpfnWndProc=ctypes.cast(win.user.DefWindowProcW, ctypes.c_void_p),
                                                hInstance=instance, lpszClassName=viewport)
        registered = win.user.RegisterClassW(ctypes.byref(window_class))
        self.assertTrue(registered or ctypes.get_last_error() == ERROR_CLASS_ALREADY_EXISTS)
        try:
            for kind, style, dialog in (('#32770', CRITICAL_ERROR_STYLE, True),
                                        ('#32770', START_UP_DIALOG_STYLE, False),
                                        ('Static', native_play.WS_POPUP | native_play.WS_CAPTION | WS_VISIBLE, True),
                                        ('Static', native_play.WS_POPUP | WS_BORDER | WS_VISIBLE, False),
                                        (viewport, 0x14cf0000, False)):          # Revision's, as it opens
                hwnd = win.user.CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, kind, 'stand-in', style,
                                                -32000, -32000, 100, 50, None, None, instance, None)
                try:
                    self.assertTrue(hwnd, ctypes.get_last_error())
                    self.assertEqual((win.dialog(hwnd), win.error_box(pid)), (dialog, dialog), (kind, hex(style)))
                finally:
                    user.DestroyWindow(hwnd)
        finally:
            if registered:
                user.UnregisterClassW(viewport, instance)

    def test_the_games_window_is_its_shown_top_level_viewport_big_enough_to_play_in(self):
        # review su4 #4 (31 Oct 2026): find_window decides which window of the game embed takes into the panel and
        # Continue in game window brings to the front, and no test ran it. The game's 'Critical Error' box (captioned,
        # #32770), a viewport too small to play in, a window of another class and a viewport owned by another window
        # (GetParent gives an owned popup's owner) are none of it; its viewport (Revision's class, registered here, as
        # it opens) is, until it is hidden, and never for another process. Windows of this process, never activated
        win, user, pid, made = native_play._Win32(), user32(), os.getpid(), []
        instance, viewport = win.kernel.GetModuleHandleW(None), 'RevisionUnrealWWindowsViewportWindowLite'
        window_class = native_play._WindowClass(lpfnWndProc=ctypes.cast(win.user.DefWindowProcW, ctypes.c_void_p),
                                                hInstance=instance, lpszClassName=viewport)
        registered = win.user.RegisterClassW(ctypes.byref(window_class))
        self.assertTrue(registered or ctypes.get_last_error() == ERROR_CLASS_ALREADY_EXISTS)

        def window(kind, style, width, height, owner=None):
            hwnd = win.user.CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, kind, 'stand-in', style, -32000,
                                            -32000, width, height, owner, None, instance, None)
            self.assertTrue(hwnd, ctypes.get_last_error())
            made.append(hwnd)
            return hwnd
        try:
            window('#32770', CRITICAL_ERROR_STYLE, 400, 200)                    # its error box, big
            window(viewport, 0x14cf0000, 90, 90)                                # too small to play in
            holder = window('Static', native_play.WS_POPUP | WS_VISIBLE, 600, 400)
            window(viewport, native_play.WS_POPUP | native_play.WS_CAPTION | WS_VISIBLE, 500, 300, holder)
            self.assertIsNone(win.find_window(pid))
            big = window(viewport, 0x14cf0000, 300, 200)                        # Revision's, as it opens
            self.assertEqual(win.find_window(pid), big)
            self.assertIsNone(win.find_window(pid + 4), 'another process')
            user.ShowWindow(big, 0)                                             # SW_HIDE
            self.assertIsNone(win.find_window(pid))
            self.assertNotIn(int(win.user.GetForegroundWindow() or 0), made, 'no focus taken')
        finally:
            for hwnd in reversed(made):
                user.DestroyWindow(hwnd)
            if registered:
                user.UnregisterClassW(viewport, instance)

    def test_the_dialogs_that_show_are_listed_front_first_owned_or_not(self):
        # defect B of the second game test (30 Oct 2026): the game's 'Critical Error' box showed behind its splash, not
        # in front, so the cover looks at every dialog that shows (visible and captioned: dialog), owned or not, in the
        # z-order, front first, the window in front among them where it is (also), shown or not; here this process's
        flags = native_play.SWP_NOMOVE | native_play.SWP_NOSIZE | native_play.SWP_NOACTIVATE
        win, user, pid, made = native_play._Win32(), user32(), os.getpid(), []

        def window(kind, style, owner=None):
            hwnd = win.user.CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, kind, 'stand-in', style, -32000,
                                            -32000, 100, 50, owner, None, None, None)
            self.assertTrue(hwnd, ctypes.get_last_error())
            made.append(hwnd)
            return hwnd
        try:
            splash = window('#32770', START_UP_DIALOG_STYLE)                    # no caption: no dialog
            box = window('#32770', CRITICAL_ERROR_STYLE)
            owned = window('#32770', CRITICAL_ERROR_STYLE, splash)
            window('#32770', CRITICAL_ERROR_STYLE & ~WS_VISIBLE)                # hidden: none
            plain = window('Static', native_play.WS_POPUP)                     # hidden, no caption: only as `also`
            orders = []
            for moved, below in ((plain, box), (box, plain)):                   # one right below the other, in turn
                self.assertTrue(win.user.SetWindowPos(moved, below, 0, 0, 0, 0, flags))
                z = [hwnd for hwnd in z_order(user) if hwnd in (box, owned, plain)]
                orders.append(z)
                self.assertEqual(win.open_dialogs(pid, also=plain), [(hwnd, pid) for hwnd in z])
                self.assertEqual(win.open_dialogs(pid), [(hwnd, pid) for hwnd in z if hwnd != plain])
                self.assertEqual([shown for shown in win.open_dialogs() if shown[0] in made],
                                 [(hwnd, pid) for hwnd in z if hwnd != plain])
            self.assertNotEqual(orders[0], orders[1])
            self.assertEqual([hwnd for hwnd, _ in win.open_dialogs(pid + 4) if hwnd in made], [], 'another process')
            self.assertNotIn(int(win.user.GetForegroundWindow() or 0), made, 'no focus taken')
        finally:
            for hwnd in reversed(made):
                user.DestroyWindow(hwnd)

    def test_a_thread_that_takes_no_messages_is_asked_for_a_moment_only(self):
        # D5 of the game test (29 Oct 2026): answers() is all the UI thread waits for a game that is still starting
        win, user = native_play._Win32(), user32()
        silent = SilentWindow(win, user)
        try:
            self.assertTrue(silent.hwnd)
            started = time.monotonic()
            self.assertFalse(win.answers(silent.hwnd))
            self.assertLess(time.monotonic() - started, native_play.ANSWER_WAIT + .5)
            silent.answer.set()
            self.assertTrue(silent.taking.wait(5))
            self.assertTrue(win.answers(silent.hwnd))
        finally:
            silent.close(user)

    def test_a_question_sent_without_waiting_is_answered_on_this_thread_once_the_game_takes_messages(self):
        # the first question to a starting game (_ready): sent at once, answered by this thread's message loop when the
        # game's thread first takes messages, never before
        win, user = native_play._Win32(), user32()
        silent = SilentWindow(win, user)
        answered = []
        try:
            started = time.monotonic()
            self.assertTrue(win.ask(silent.hwnd, lambda: answered.append(threading.get_ident())))
            self.assertLess(time.monotonic() - started, .05, 'not waited for')
            take_messages(user, lambda: answered, .3)
            self.assertEqual(answered, [], 'no answer while its thread takes no messages')
            silent.answer.set()
            self.assertTrue(silent.taking.wait(5))
            take_messages(user, lambda: answered, 5)
            self.assertEqual(answered, [threading.get_ident()])
        finally:
            silent.close(user)

    def test_a_repair_never_waits_for_a_thread_that_takes_no_messages(self):
        # D5 of the game test (29 Oct 2026): SetWindowLong on the window of a thread that takes no messages waits for
        # that thread (here until it answers); the tick restyles and re-parents the game's window once its game answers
        # (None until then: nothing done, and not settled either, RESTYLES). Found at another size than the panel's
        # before or after it waits for the game, a restyle is 'resized' (its game's own SetRes), at the panel's
        # 'restyled'
        win, user = native_play._Win32(), user32()
        panel = win.user.CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, 'Static', 'panel', native_play.WS_POPUP,
                                         -32000, -32000, 200, 100, None, None, None, None)
        silent = SilentWindow(win, user)
        try:
            self.assertTrue(panel and silent.hwnd)
            before, started = win.snapshot(silent.hwnd), time.monotonic()
            self.assertIsNone(win.repair_child(silent.hwnd, panel, 64, 32))
            self.assertLess(time.monotonic() - started, native_play.ANSWER_WAIT + .5)
            self.assertEqual(win.snapshot(silent.hwnd), before, 'nothing changed')
            silent.answer.set()
            self.assertTrue(silent.taking.wait(5))
            self.assertEqual(win.repair_child(silent.hwnd, panel, 64, 32), 'resized')
            look = win.snapshot(silent.hwnd)
            self.assertEqual((bool(look['style'] & native_play.WS_CHILD), look['parent']), (True, panel))
            # moved off its place (the original game's drift during SetRes): put back with no question (review 2e #3)
            win.position(silent.hwnd, (5, 5, 20, 10))
            take_messages(user, lambda: win.child_geometry(silent.hwnd, panel) == (5, 5, 20, 10), 5)
            self.assertEqual(win.child_geometry(silent.hwnd, panel), (5, 5, 20, 10))
            with mock.patch.object(win, 'answers', side_effect=AssertionError('a bounds-only repair asked')):
                self.assertEqual(win.repair_child(silent.hwnd, panel, 64, 32), 'moved')
            take_messages(user, lambda: win.child_geometry(silent.hwnd, panel) == (0, 0, 64, 32), 5)
            self.assertEqual(win.child_geometry(silent.hwnd, panel), (0, 0, 64, 32))
            # its frame put back at the panel's size (a SetRes's later restyles, D6's every one): 'restyled'
            look = win.snapshot(silent.hwnd)
            win.style(silent.hwnd, GWL_STYLE, look['style'] | native_play.WS_CAPTION)
            self.assertEqual(win.repair_child(silent.hwnd, panel, 64, 32), 'restyled')
            # nothing to repair: False, which ends a run of restyles (RESTYLES)
            self.assertIs(win.repair_child(silent.hwnd, panel, 64, 32), False)
            # a SetRes of its game's own that lands while the repair waits for the game's thread (D2 of the game test
            # of 30 Oct 2026): the repair's own position puts the window back at the panel's size, so no later repair
            # sees its size; the read after the wait does
            real_answers = win.answers

            def setres_during_the_wait(hwnd):
                answered = real_answers(hwnd)
                win.position(hwnd, (0, 0, 100, 50))
                take_messages(user, lambda: win.child_geometry(hwnd, panel)[2:] == (100, 50), 5)
                return answered
            win.style(silent.hwnd, GWL_STYLE, look['style'] | native_play.WS_CAPTION)
            with mock.patch.object(win, 'answers', side_effect=setres_during_the_wait):
                self.assertEqual(win.repair_child(silent.hwnd, panel, 64, 32), 'resized')
            take_messages(user, lambda: win.child_geometry(silent.hwnd, panel) == (0, 0, 64, 32), 5)
            self.assertEqual(win.client_size(silent.hwnd), (64, 32))
            self.assertIs(win.repair_child(silent.hwnd, panel, 64, 32), False)
            # off its place at the panel's size, its frame back: the size alone tells its game's own SetRes
            win.position(silent.hwnd, (5, 5, 64, 32))
            take_messages(user, lambda: win.child_geometry(silent.hwnd, panel) == (5, 5, 64, 32), 5)
            win.style(silent.hwnd, GWL_STYLE, look['style'] | native_play.WS_CAPTION)
            self.assertEqual(win.repair_child(silent.hwnd, panel, 64, 32), 'restyled')
            # D6 in h2a's order (game test of 30 Oct 2026): its game puts its frame back in answer to the repair's own
            # strip of it (after the GWL_STYLE call, while the repair still waits on the game) and grows the window
            # around a client at the panel's size: the panel's at the read after the wait too
            take_messages(user, lambda: win.child_geometry(silent.hwnd, panel) == (0, 0, 64, 32), 5)
            real_style = win.style

            def frame_back_after_the_strip(hwnd, index, value):
                real_style(hwnd, index, value)
                if index == GWL_STYLE:
                    real_style(hwnd, GWL_STYLE, value | native_play.WS_CAPTION)
                    win.position(hwnd, (0, 0, 100, 60), frame=True)
                    take_messages(user, lambda: win.child_geometry(hwnd, panel)[2:] == (100, 60), 5)
                    client = wintypes.RECT()                    # measured apart from client_size, under test
                    self.assertTrue(win.user.GetClientRect(hwnd, ctypes.byref(client)))
                    grown = 0, 0, 64 + 100 - client.right, 32 + 60 - client.bottom
                    win.position(hwnd, grown, frame=True)
                    take_messages(user, lambda: win.child_geometry(hwnd, panel) == grown, 5)
                    self.assertNotEqual(win.child_geometry(hwnd, panel)[2:], (64, 32), 'a frame around the client')
                    self.assertEqual(win.client_size(hwnd), (64, 32))
            win.style(silent.hwnd, GWL_STYLE, look['style'] | native_play.WS_CAPTION)
            with mock.patch.object(win, 'style', side_effect=frame_back_after_the_strip):
                self.assertEqual(win.repair_child(silent.hwnd, panel, 64, 32), 'restyled')
        finally:
            silent.close(user)
            user.DestroyWindow(panel)


class RealCoverWin(Win):
    """Win with the cover's own calls real (_Win32.topmost and shown, on a real window standing in for the editor's,
    dialog, desktop, and the walk of the dialogs that show), the threads they ran on kept in `cover_threads`; what is in
    front stays the stand-in's (`in_front_now`): the real one is this PC's user's. The walk keeps the windows of the
    test's own processes (`programs`) and the window asked for only: the stand-in's process() would take any other
    program's process for the game."""
    def __init__(self, look):
        super().__init__(look)
        self.real, self.cover_threads, self.programs = native_play._Win32(), set(), set()

    def topmost(self, hwnd, on, behind=None):
        self.cover_threads.add(threading.get_ident())
        return self.real.topmost(hwnd, on, behind)

    def shown(self, hwnd):
        return self.real.shown(hwnd)

    def dialog(self, hwnd):
        return self.real.dialog(hwnd)

    def open_dialogs(self, pid=None, also=None):
        return [(hwnd, owner) for hwnd, owner in self.real.open_dialogs(pid, also)
                if owner in self.programs or hwnd == also]

    def desktop(self, hwnd):
        return self.real.desktop(hwnd)


def other_program():
    """Another program for the real cover tests, run in a process of its own: a topmost window, a captioned dialog
    (the game's 'Critical Error' box as c7_crashed of the game test saw it: #32770, not topmost, unowned) and the
    game's splash as Revision shows it (#32770, no caption, topmost: g4b of the second game test, 30 Oct 2026), off
    screen, never in front; their handles and its pid on stdout; each shown or hidden without activation as its stdin
    asks ('show <name>' or 'hide <name>', answered 'ok'), its messages taken until its stdin closes."""
    win, user = native_play._Win32(), user32()
    windows = [win.user.CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | exstyle, kind, 'stand-in', style,
                                        -32000, -32000, 100, 50, None, None, None, None)
               for exstyle, kind, style in ((native_play.WS_EX_TOPMOST, 'Static', native_play.WS_POPUP | WS_VISIBLE),
                                            (0, '#32770', CRITICAL_ERROR_STYLE),
                                            (native_play.WS_EX_TOPMOST, '#32770', START_UP_DIALOG_STYLE))]
    names = dict(topmost=windows[0], dialog=windows[1], splash=windows[2])
    print(json.dumps(dict(pid=os.getpid(), **names)), flush=True)
    closed = threading.Event()

    def commands():
        for line in sys.stdin:
            verb, name = line.split()
            user.ShowWindow(names[name], 4 if verb == 'show' else 0)       # SW_SHOWNOACTIVATE, SW_HIDE
            print('ok', flush=True)
        closed.set()
    threading.Thread(target=commands, daemon=True).start()
    take_messages(user, closed.is_set, 60)
    for hwnd in windows:
        user.DestroyWindow(hwnd)


@unittest.skipUnless(sys.platform == 'win32', 'Win32')
class RealCoverTests(unittest.TestCase):
    """The cover on a real window standing in for the editor's: a tool window of the UI stand-in's thread, off screen,
    shown without activation, never in front; a second one stands in for another program's window in front, another
    process (other_program) for a program whose window in front is topmost and for the game's error box and splash,
    and the shell's own desktop windows, only read, for the desktop in front."""
    SW_HIDE, SW_SHOWNOACTIVATE, GW_HWNDNEXT = 0, 4, 2

    def test_the_cover_goes_on_and_off_on_the_ui_thread_at_each_end_and_takes_no_focus(self):
        user, ui, win, clock = user32(), UI(), RealCoverWin(WINDOWED), Clock()
        panel, form = made(win, clock, ui)
        windows = []

        def window():
            hwnd = win.real.user.CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, 'Static', 'stand-in',
                                                 native_play.WS_POPUP, -32000, -32000, 100, 50, None, None, None, None)
            user.ShowWindow(hwnd, self.SW_SHOWNOACTIVATE)
            windows.append(hwnd)
        ui.run(window)
        ui.run(window)
        editor, other = windows
        self.assertTrue(editor and other)
        form.Handle = Handle(editor)
        on_top = lambda: bool(win.real._get_long(editor, GWL_EXSTYLE) & native_play.WS_EX_TOPMOST)
        watch = lambda: ui.run(lambda: cover_tick(panel))
        flags = native_play.SWP_NOMOVE | native_play.SWP_NOSIZE | native_play.SWP_NOACTIVATE
        # a window put right below the window `after` (None: HWND_TOP, as high as Windows lets this process put it),
        # without activation
        put = lambda hwnd, after: ui.run(lambda: win.real.user.SetWindowPos(hwnd, after, 0, 0, 0, 0, flags))

        def tell(verb, name):
            # one of other_program's windows shown or hidden, without activation
            program.stdin.write('%s %s\n' % (verb, name))
            program.stdin.flush()
            self.assertEqual(program.stdout.readline().strip(), 'ok')

        def behind(upper):
            hwnd = user.GetWindow(upper, self.GW_HWNDNEXT)
            while hwnd and hwnd != editor:
                hwnd = user.GetWindow(hwnd, self.GW_HWNDNEXT)
            return hwnd == editor

        def attach():
            win.window = True
            for _ in range(3):
                panel.embed(EMBED)
                clock.now += .5
            watch()

        def hide():
            ui.run(lambda: user.ShowWindow(editor, self.SW_HIDE))
            watch()
            ui.run(lambda: user.ShowWindow(editor, self.SW_SHOWNOACTIVATE))

        def other_program():
            win.others[4242], win.in_front_now = 'C:/Programs/Browser/browser.exe', (int(other), 4242)
            watch()
            self.assertTrue(behind(other), 'behind the window in front')
            win.in_front_now = (None, 0)

        def other_topmost_program():
            # review su #3 (30 Oct 2026): behind a topmost window Windows made the editor's window topmost again; the
            # program the player goes to then comes above it (here our plain window, put on top without activation)
            pid = theirs['pid']
            win.others[pid], win.in_front_now = 'C:/Programs/Browser/browser.exe', (theirs['topmost'], pid)
            for _ in range(3):
                watch()
            put(other, None)
            self.assertTrue(behind(other), 'below the program the player goes to')
            win.in_front_now = (None, 0)

        def game_dialog():
            # review su #4: the game's 'Critical Error' box of a start that failed, shown at once, the editor behind it
            game = theirs['pid']
            tell('show', 'dialog')
            win.others[game], win.in_front_now = win.path, (theirs['dialog'], game)
            for _ in range(3):
                watch()
            self.assertTrue(behind(theirs['dialog']), 'behind the box')
            win.in_front_now = (None, 0)

        def game_dialog_behind_its_splash():
            # defect B of the second game test (30 Oct 2026): the box showed while the game's splash (no caption,
            # topmost as it shows) stayed the window in front, and lay below the editor
            game = theirs['pid']
            tell('show', 'dialog')
            win.others[game], win.in_front_now = win.path, (theirs['splash'], game)
            watch()
            self.assertTrue(behind(theirs['dialog']), 'behind the box')
            win.in_front_now = (None, 0)

        def game_dialog_with_another_program(lower):
            # the box shows while another program's window is in front (the case the box's review left open): behind
            # whichever of the two is lower, below both
            def end():
                game = theirs['pid']
                tell('show', 'dialog')
                win.others[game], win.others[4242] = win.path, 'C:/Programs/Browser/browser.exe'
                if lower == 'program':
                    put(other, theirs['dialog'])                            # our window right below the box
                else:
                    put(theirs['dialog'], other)                            # the box right below our window
                win.in_front_now = (int(other), 4242)
                watch()
                self.assertEqual((behind(other), behind(theirs['dialog'])), (True, True), 'below both')
                win.in_front_now = (None, 0)
            return end

        def desktop(hwnd, box=False):
            # review su2 #5 (30 Oct 2026): the shell's desktop window in front (the player clicked the desktop), the
            # last of all: the editor goes no further than HWND_NOTOPMOST, above our plain window put as high as this
            # process can put it, not under every window; with the game's box shown, behind the box
            def end():
                explorer = win.real.pid(hwnd)
                win.others[explorer] = 'C:/Windows/explorer.exe'
                if box:
                    tell('show', 'dialog')
                    win.others[theirs['pid']] = win.path
                put(other, None)
                win.in_front_now = (hwnd, explorer)
                watch()
                if box:
                    self.assertTrue(behind(theirs['dialog']), 'behind the box')
                else:
                    self.assertFalse(behind(other), 'above the windows that are not topmost')
                win.in_front_now = (None, 0)
            return end

        def limit():
            clock.now += native_play.COVER_LIMIT
            watch()

        ends = {'Stop': lambda: panel.cover(False), 'the Game view left or the app closing': panel.detach,
                'the attach': attach, 'the editor hidden': hide, 'another program in front': other_program,
                "another program's topmost window in front": other_topmost_program,
                "the game's error box in front": game_dialog,
                "the game's error box behind its splash in front": game_dialog_behind_its_splash,
                "the game's error box below another program's window in front":
                    game_dialog_with_another_program('dialog'),
                "the game's error box above another program's window in front":
                    game_dialog_with_another_program('program'),
                'COVER_LIMIT': limit}
        # the shell's own windows, only read (none where no shell runs): its Progman, and the last WorkerW of the
        # z-order (the desktop's own where it holds the icons)
        shell = int(user.GetShellWindow() or 0)
        workers = [hwnd for hwnd in z_order(user) if win.real._class(hwnd) == 'WorkerW']
        for name, hwnd in (('Progman', shell), ('WorkerW', workers[-1] if workers else 0)):
            if hwnd:
                ends["the desktop's %s in front" % name] = desktop(hwnd)
        if shell:
            ends["the desktop in front, the game's error box shown"] = desktop(shell, box=True)
        program = subprocess.Popen([sys.executable, '-B', '-c', 'import sys; sys.path.insert(0, %r); '
                                    'import test_native_play; test_native_play.other_program()' % str(HERE)],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            theirs = json.loads(program.stdout.readline())
            self.assertTrue(theirs['topmost'] and theirs['dialog'] and theirs['splash'])
            win.programs.add(theirs['pid'])
            for name, end in ends.items():
                with self.subTest(name):
                    win.window, win.in_front_now = False, (None, 0)         # whatever an end that failed left
                    # their box hidden (a game's box showing keeps the cover off), their windows another program's
                    # until an end makes them the game's: a process is looked at once a cover
                    tell('hide', 'dialog')
                    win.others[theirs['pid']] = 'C:/Programs/Browser/browser.exe'
                    # from this thread; asked again if Windows dropped the change TOPMOST_TRIES times (other programs
                    # changing their z-order at once: 1 run in 60 with four copies of this test)
                    self.assertTrue(any(panel.cover(True) == dict(covered=True, error='') for _ in range(3)))
                    self.assertTrue(on_top())
                    end()
                    for _ in range(3):                                  # a letting go Windows dropped: asked again
                        if panel.status()['covered']:
                            watch()
                    self.assertEqual((panel.status()['covered'], on_top()), (False, False))
                    self.assertNotIn(win.real.user.GetForegroundWindow(), windows, 'no focus taken')
                    panel.detach()
        finally:
            for hwnd in windows:
                ui.run(lambda hwnd=hwnd: user.DestroyWindow(hwnd))
            program.stdin.close()
            program.wait(30)
        self.assertEqual(win.cover_threads, {ui.thread.ident}, 'every change on the UI thread')


# the stand-ins of the editor's own processes on real processes: the project's worker, which starts the build host (a
# process with a hidden window); each prints its pid (the host its window too) and ends once its stdin closes
HOST = ('import ctypes, os, sys; user = ctypes.WinDLL("user32"); user.CreateWindowExW.restype = ctypes.c_void_p; '
        'hwnd = user.CreateWindowExW(0, "Static", "stand-in", 0, -32000, -32000, 100, 50, None, None, None, None); '
        'print(os.getpid(), hwnd, flush=True); sys.stdin.read(); user.DestroyWindow(ctypes.c_void_p(hwnd))')
WORKER = ('import os, subprocess, sys; print(os.getpid(), flush=True); '
          'host = subprocess.Popen([sys.executable, "-B", "-c", %r], stdin=subprocess.PIPE); '
          'sys.stdin.read(); host.stdin.close(); host.wait(30)' % HOST)


class EditorProcessTests(unittest.TestCase):
    """The editor's own processes, for the cover (defect 2 of the game test of 30 Oct 2026: the build host, started by
    the project's worker, which the editor's process started, took the front during the launch and ended the cover):
    its own programs (OWN) among the processes it started, directly or not, walked up by parent pid and creation
    time (_Win32.descends)"""

    def test_a_parent_that_started_after_its_child_or_has_ended_ends_the_walk(self):
        # Windows gives the pids of processes that ended to new ones. A fake process table: (parent, created) by pid
        def descends(table, pid, ancestor):
            win = native_play._Win32.__new__(native_play._Win32)
            win._started = table.get
            return win.descends(pid, ancestor)
        tree = {30: (20, 300), 20: (10, 200), 10: (1, 100), 1: (0, 50)}
        self.assertEqual([descends(tree, pid, 10) for pid in (30, 20, 10, 1, 99)], [True, True, False, False, False])
        self.assertTrue(descends(tree, 30, 20))
        for name, change in (('its parent ended', {20: None}),
                             ("its parent's pid taken by a later process", {20: (10, 301)}),
                             ("the editor's pid taken by a later process", {10: (1, 201)})):
            with self.subTest(name):
                self.assertFalse(descends({**tree, **change}, 30, 10))
        # process p started by p - 1
        chain = {pid: (pid - 1, pid) for pid in range(1, native_play.DESCENT + 3)}
        self.assertTrue(descends(chain, 1 + native_play.DESCENT, 1), 'DESCENT processes up')
        self.assertFalse(descends(chain, 2 + native_play.DESCENT, 1), 'not one more')

    @unittest.skipUnless(sys.platform == 'win32', 'Win32')
    def test_on_real_processes_what_the_editor_started_is_its_own_and_nothing_else(self):
        # this test process plays the editor: its child the project's worker, its grandchild the build host
        win = native_play._Win32()
        worker = subprocess.Popen([sys.executable, '-B', '-c', WORKER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  text=True)
        try:
            worker_pid = int(worker.stdout.readline())
            host_pid, host_window = map(int, worker.stdout.readline().split())
            self.assertEqual(win.pid(host_window), host_pid)
            self.assertEqual([win.descends(pid, os.getpid()) for pid in (worker_pid, host_pid, os.getppid())],
                             [True, True, False], 'the worker and the host, not what started the editor')
            self.assertEqual((win.descends(host_pid, worker_pid), win.descends(worker_pid, host_pid)), (True, False))
            # what the walk reads: each process's parent, and a creation time later than its parent's
            started = [win._started(pid) for pid in (host_pid, worker_pid, os.getpid())]
            self.assertEqual(started[2][0], os.getppid())
            self.assertTrue(started[0][1] > started[1][1] > started[2][1] > 0, started)
            # the cover: the host's window in front keeps it while its program is one of the editor's own (OWN, here
            # the stand-in's own name); under another name it is a program the editor started for the player (Steam,
            # a browser, Blender: cross-check of 30 Oct 2026) and ends it, as a window of the process that started
            # the editor does, whatever its name
            process = win.process(host_pid)
            win.close(process['handle'])
            name = Path(process['path']).name.lower()
            panel = native_play.NativeGamePanel(SimpleNamespace(native=None), lambda: None, _win=win)
            resolved = []
            for own, front, foreign, kind in (((name,), (host_window, host_pid), None, 'editor'),
                                              (native_play.OWN, (host_window, host_pid), host_window, ''),
                                              ((name,), (4321, os.getppid()), 4321, '')):
                with self.subTest(own=own, front=front), mock.patch.object(native_play, 'OWN', own):
                    with mock.patch.object(win, 'in_front', return_value=front), resolving(resolved):
                        panel._cover = dict(since=0.0, games={}, known={})
                        self.assertEqual(panel._foreign(1), foreign)
                    # what the process in front was found to be (known also holds each process showing a dialog)
                    self.assertEqual(panel._cover['known'][front[1]], kind)
            # review su3 #4 (31 Oct 2026): of the processes in front and of every one showing a captioned window on
            # this PC, none had the path of its executable resolved but one named as a game's (GAME_NAMES)
            self.assertEqual([path for path in resolved if Path(path).name.lower() not in native_play.GAME_NAMES], [])
        finally:
            worker.stdin.close()
            worker.wait(30)


class UIThreadTests(unittest.TestCase):
    def test_every_window_and_panel_call_runs_on_the_ui_thread(self):
        ui, win, clock = UI(), Win(WINDOWED), Clock()
        panel, form = made(win, clock, ui)
        UI_THREADS.clear()
        for _ in range(3):
            state = panel.embed(EMBED)
            clock.now += .5
        self.assertTrue(state['attached'], state)
        ui.run(lambda: tick(panel, clock, 3))
        win.active = True
        ui.run(lambda: panel._handlers[1](None, None))                  # a click: the game has the keyboard
        ui.run(lambda: tick(panel, clock))
        self.assertIsNotNone(win.press, 'the panel made its keys window')
        ui.run(win.press)                                               # Alt+Enter (WM_HOTKEY)
        asked = panel.status().get('windowMode')
        panel.resize(dict(EMBED, visible=False))
        panel.status()
        win.look.update(MINIMIZED_CHILD, parent=PANEL)
        ui.run(lambda: tick(panel, clock, 3))
        mode = panel.status().get('windowMode')
        panel.release()
        panel.detach()
        # taken in again, then its window vanishes into an error box: noticed by the tick, reported by an embed
        win.look.update(WINDOWED, parent=None)
        for _ in range(3):
            panel.embed(EMBED)
            clock.now += .5
        win.window, win.box = False, True
        ui.run(lambda: tick(panel, clock))
        crashed = panel.embed(EMBED).get('windowMode')
        self.assertEqual(win.threads, {ui.thread.ident})
        self.assertEqual(UI_THREADS, {ui.thread.ident})
        self.assertEqual((asked, mode, crashed, win.caught[:1], win.jobs[:1]),
                         ('fullscreenAsked', 'minimized', 'crashed', [True], [('job', 123)]),
                         'the walk above went through Alt+Enter, a window left alone, a job and a crashed game')

    def test_a_cover_asked_from_another_thread_goes_on_and_off_on_the_ui_thread(self):
        # S7 of the start-up investigation (29 Oct 2026): a form changed from a Python thread waited for the UI thread
        # while holding Python's lock, which the panel's timer on the UI thread waited for, and both hung
        ui, win, clock = UI(), Win(WINDOWED), Clock()
        panel, form = made(win, clock, ui)
        self.assertEqual(panel.cover(True), dict(covered=True, error=''))
        ui.run(lambda: cover_tick(panel))
        self.assertEqual(panel.cover(False), dict(covered=False, error=''))
        self.assertEqual([c for c in win.calls if c[0] == 'topmost'],
                         [('topmost', True, None), ('topmost', False, None)])
        self.assertEqual(win.threads, {ui.thread.ident})

    def test_continue_in_game_window_finds_and_fronts_the_game_window_on_the_ui_thread(self):
        # review su3 #5 (31 Oct 2026): a game window never taken in, looked for and made the foreground window
        ui, win, clock = UI(), Win(WINDOWED), Clock()
        panel, form = made(win, clock, ui)
        win.answering = False                                           # its game never answers: never taken in
        for _ in range(3):
            self.assertTrue(panel.embed(EMBED).get('pending'))
            clock.now += .5
        win.threads.clear()
        win.active = True
        self.assertEqual(panel.detach(True)['error'], '')
        self.assertEqual((win.calls[-1], win.threads), (('front', 77), {ui.thread.ident}))

    def test_an_attach_held_past_the_wait_answers_busy_once_and_carries_no_error_after(self):
        # D3 of the game test (c2, c2b, 29 Oct 2026): SetParent held the UI thread while the original game was still
        # starting; the attach answered BUSY while it went through, and every status answer after carried that error
        ui, win, clock = UI(), SlowStartWin(WINDOWED), Clock()
        panel, form = made(win, clock, ui)
        with mock.patch.object(native_play, 'UI_WAIT', .2):
            for _ in range(2):
                self.assertTrue(panel.embed(EMBED).get('pending'))
                clock.now += .5
            win.drawn.clear()                                           # no first frame yet: SetParent waits
            state = panel.embed(EMBED)
            self.assertEqual((state['attached'], state['error']), (True, native_play.BUSY))
            win.drawn.set()
            ui.run(lambda: None)                                        # the attach goes through
            state = panel.status()
        self.assertEqual((state['attached'], state['error']), (True, ''))

    def test_a_ticks_own_error_over_a_window_still_in_the_panel_stays_reported(self):
        # review 2d #6: status() drops a BUSY only; a tick that fails lets the game go (_release) with its window still
        # in the panel, and the page learns of that only from the answers
        panel, form, win, clock = attached(self, FailingRepairWin(WINDOWED))
        win.fail = True
        tick(panel, clock)
        state = panel.status()
        self.assertTrue(state['attached'], state)
        self.assertTrue(state['error'].startswith('Game panel:'), state)


if __name__ == '__main__':
    unittest.main()
