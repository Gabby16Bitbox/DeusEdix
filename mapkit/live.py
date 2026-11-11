"""Live link to the running game (Revision + the development mod, or the project's game: settings.TARGET): open
it once, then look around in seconds.

    import live
    live.start('06_HongKong_WanChai_Rooftop')                 # launches the game through Steam (~30 s)
    path = live.do('player;-29400;100;48;32768;0')            # JC there, screenshot -> PNG path (~1-2 s)
    live.do('console;summon MedKit')   # any console command
    live.show_map('06_HongKong_WanChai_Rooftop')              # after a rebuild: fresh copy, no restart
    live.stop()                                               # quits the game, removes its launch copies

Channel: the editor's UCShotRunner in live mode execs System\\UCLive.txt (console "set" lines written
here) and acknowledges each step by saving LiveDone/LiveResult to the launch's copy of the user ini (INI).
"""
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

import settings

PROJECT = Path(__file__).resolve().parents[2]
REV = settings.REVISION                     # the targeted game's folder (Revision\, or Deus Ex itself)
SYS = REV / 'System'
# a launch (Play, a live session) starts the game on copies of its ini files made for it (INI=, USERINI=), as the
# original game's Play has since 15 Oct 2026 and Revision's since 29 Oct: the player's own (Revision.ini and
# RevisionUser.ini, DeusEx.ini and User.ini) are never written by it, so what the game and the mod save while it plays
# (the window's mode and size: the black embedded Play of 28 Oct 2026; a slomo's GameSpeed; the map played last; the
# runner's and the Console's answers) goes into the copies, and with them. One pair per project (settings.launch_inis:
# Revision's in its System folder, by the project's id as its save folder is; the original game's in the project's
# folder in the game), named to the game by a path from its System folder: no spaces, no quotes (Steam rewrites quoted
# values, 15 Oct 2026)
PLAY_INI, INI = settings.launch_inis(settings.LAUNCH_PLAY + settings.PROJECT_ID, settings.MAPS_DIR)
# every launch of the editor's is in a window, whichever game and wherever it shows (the Game view, the game's own
# window, View in game, the mapkit MCP's live session): StartupFullscreen=False in its copy (_session_inis) and the
# game's own switch for a window (settings.TARGETS 'windowed': Revision's -windowed; the original game has none). A
# full-screen start left the embedded Play black (28 Oct 2026) and puts a topmost game over the editor; in its own
# window, Alt+Enter in the game gives full screen for that launch. A mod played from the Mods panel is the player's
# game, in their own mode (mods.launch_ini)
WINDOWED = list(settings.PROFILE['windowed'])
EXE = settings.GAME_EXE
GAME = settings.PROFILE['short']
STEAM_APP = settings.STEAM_APP
CMD = SYS / 'UCLive.txt'
CONSOLE_CMD = SYS / 'UCConsole.txt'
# a play scenario's loadout (editor/play.py loadout_run): console commands the runner execs once, before the player
# has the controls; there for a launch of the editor's, gone after it
LOADOUT = SYS / 'UCLoadout.txt'


# the game's mark, made as it starts and removed by its own exit (and by the cleanup after a close from outside)
def _running_mark():
    return SYS / 'Running.ini'


# how long Stop waits for the game to close by itself once asked through its console (it was gone 0.2 s after the
# request in the probe of 29 Oct 2026), and how long from the game's answer to the request (it is closing): a game
# leaving exclusive full screen took 4.9-5.4 s to end in the game test of 29 Oct 2026, and Stop went on to close it
# from outside while it was closing by itself. The answer is the game reading the line (Seq) or running it (Done), or
# its own removal of System\Running.ini as it runs the 'exit'. UCConsoleLink tries to save Seq when it reads a line and
# Done when it has run it, but the game can lose either save: after a ToggleFullscreen the original game saved Seq for
# the 'exit', never Done, and closed by itself 3.2-4.4 s later (the third game test of 29 Oct 2026); in exclusive full
# screen it ran the 'exit' with neither saved in 3 of 12 Stops, and removed Running.ini each time (the fourth). A
# missing Seq is no proof that the line was not read. A console still inside an earlier line, which has not read the
# request yet, is given EXIT_WAIT_TAKEN from the request: the original game spent 8-14 s in the page's
# ToggleFullscreen, and Stop closed it from outside before it read the 'exit' (the second game test of 29 Oct 2026)
EXIT_WAIT = 5.0
EXIT_WAIT_TAKEN = 15.0
# a file of a launch's (its copies, the runner's and the Console's files) that a game the editor never saw close left,
# written less than this ago, may be another editor's of the same workspace, or a mod's game's, whose game Steam is
# still starting (GameSession waits 90 s for it): left (tidy_cut_short)
LAUNCH_AGE = 120.0
SHOTS = PROJECT / 'shots'
RUNNER = '[%s.UCShotRunner]' % settings.PACKAGE
MUTATOR = '?Mutator=%s.UCMutator' % settings.PACKAGE
_SECTION = re.compile(r'(?ms)^' + re.escape(RUNNER) + r'[^\r\n]*\r?\n.*?(?=^\[|\Z)')
# the editor's Console while the game runs: UCConsoleLink execs CONSOLE_CMD and answers in its section
CONSOLE = '[%s.UCConsoleLink]' % settings.PACKAGE
_CONSOLE_SECTION = re.compile(r'(?ms)^' + re.escape(CONSOLE) + r'[^\r\n]*\r?\n.*?(?=^\[|\Z)')
STATE = {'seq': 0, 'folder': None, 'maps': set(), 'command_written': False}
_SESSION = None
_SESSION_LOCK = threading.Lock()
# one writer of the Console's command file at a time (_console_line), whoever calls it in this process (the editor's
# routes are already serialised by its LOCK, UserTurn; a script calling live directly is not)
_CONSOLE_LOCK = threading.Lock()


def _session():
    global _SESSION
    with _SESSION_LOCK:
        if _SESSION is None:
            from game_process import GameSession, WindowsProcesses
            _SESSION = GameSession(WindowsProcesses(EXE))
    return _SESSION


def session_status():
    """Current owned launch; `created` is a decimal Windows FILETIME string."""
    return _session().status()


FILETIME_1970 = 116444736000000000           # 1 January 1970 as a Windows FILETIME (100 ns steps since 1601)


def started_ms(status):
    """When the game of a session_status started, in milliseconds since 1970 (the Console's Time: the seconds since
    Play started), from its process's `created`; None while no game of the editor's runs."""
    if not (status.get('running') and status.get('owned') and status.get('created')):
        return None
    return (int(status['created']) - FILETIME_1970) // 10000


def running():
    return bool(_session().processes.list())


# the folders DeusEdix makes in the game for itself (workspace.GAME_FOLDERS): the only ones Play removes a save from
OWN_GAME_FOLDERS = ('DeusEdixProjects', 'DeusEdixMaps', 'DeusEdixMods')


def _own_saved_state(map_name):
    """The saved state of `map_name` that Play removes so that the map opens as built (Save\\Current\\<map>.dxs),
    or None. The game plays in a save folder of DeusEdix's (settings.SAVE_DIR, the SavePath of its launch copy:
    _session_inis); the player's own Save folder, whose Current is their game in progress, is never touched (24 Oct
    2026)."""
    path = (settings.SAVE_DIR / 'Current' / (map_name + '.dxs')).resolve()
    if not any(path.is_relative_to((REV / name).resolve()) for name in OWN_GAME_FOLDERS):
        return None
    return path


def _launch(map_name, runner_lines, launch, live_mode=False, display_mode='external', commands=(), menu=None):
    snapshot = {}

    def prepare():
        snapshot['command'] = CMD.read_bytes() if CMD.is_file() else None
        snapshot['prepared'] = True                  # from here on the cleanup removes what this launch wrote
        # a game closed from outside leaves System\Running.ini, and the next start stops on the "Recovery Mode"
        # dialog (the editor's tests got stuck there, 20 Oct 2026): with no game running, it is only a stale mark
        if not running():
            _running_mark().unlink(missing_ok=True)
        _session_inis(display_mode, menu, photos=live_mode)
        _set_section(runner_lines)
        _set_console()
        _set_keys(project_keys())
        _set_loadout(commands)
        STATE.update(seq=0, command_written=False, maps=set(), exit_asked=None)
        if live_mode:
            _write_cmd([])
        stale = _own_saved_state(map_name)
        if stale is not None:
            stale.unlink(missing_ok=True)

    def dispatch(token):
        import project_game
        url = launch + MUTATOR + '?DeusEdixSession=' + token
        if map_name == '00_DeusEdix_Tutorial':
            import project_preferences
            if project_preferences.load().get('ucmap.doctorAudioMuted') == 'true':
                url += '?DeusEdixHaleMuted=1'
        # the URL first (the engine's first word), then the launch's ini files (project_game.launch_args). Steam's
        # copy of the original game has Steam's launch check ("Failed to find Steam" when started directly); GOG's
        # starts by itself (settings.game_command)
        argv, cwd = settings.game_command([url] + WINDOWED + project_game.launch_args((PLAY_INI, INI), SYS))
        subprocess.Popen(argv, cwd=cwd)

    def cleanup():
        # the game has closed: what it saved went into the launch copies, which go with it. The player's own ini files
        # were never written, an Install's selection of the project in them stays (29 Oct 2026)
        import project_game
        if not snapshot.get('prepared'):
            return
        if running():
            raise RuntimeError('Another %s process is running; game settings have been left intact.' % GAME)
        _set_loadout(())
        project_game.remove(CONSOLE_CMD)
        if STATE['command_written']:
            if snapshot['command'] is None:
                project_game.remove(CMD)
            else:
                project_game.write_file(CMD, snapshot['command'])
        for path in tuple(STATE['maps']):
            path.unlink(missing_ok=True)
        STATE.update(seq=0, folder=None, command_written=False, maps=set())
        remove_launch_inis()
        # this launch's game has ended: a System\Running.ini still there is the mark of one that did not end by its own
        # exit (closed from outside: a Stop of a game stopped in its error box, the editor's process ending and its
        # game with it), and the next start, Steam's too, would stop on the "Recovery Mode" dialog (the second game
        # test of 29 Oct 2026). The start-up's tidy leaves one alone: it cannot tell it from the player's own crash.
        # Last, as it is the game's: one held past the wait stays alone, and Stop's retry runs the cleanup again
        project_game.remove(_running_mark())
        snapshot['prepared'] = False

    return _session().start(prepare, dispatch, cleanup)


def _preview_display_ini(text, display_mode):
    """Use an installed D3D9 renderer only for an embedded legacy-D3D
    preview. Never rewrite the user's own ini, external Play or modern renderers.
    The original D3D7 driver can fault in TestCooperativeLevel after HWND resize;
    stock OpenGL is not a safe fallback because it can lose reflective surfaces.
    """
    if display_mode not in ('embedded', 'external'):
        raise ValueError('Unknown Play display mode.')
    if display_mode != 'embedded':
        return text
    section = re.compile(r'(?ims)^(\[Engine\.Engine\][^\r\n]*\r?\n)(.*?)(?=^\[|\Z)')
    def compatible(match):
        body = match.group(2)
        if not re.search(r'(?im)^GameRenderDevice\s*=\s*D3DDrv\.D3DRenderDevice\s*$', body):
            return match.group(0)
        body = re.sub(r'(?im)^(GameRenderDevice|WindowedRenderDevice)\s*=[^\r\n]*',
                      lambda item: item.group(1) + '=D3D9Drv.D3D9RenderDevice', body)
        return match.group(1) + body
    return section.sub(compatible, text)


def _session_inis(display_mode='external', menu=None, photos=False):
    """The game's ini files for one launch (PLAY_INI, INI), made fresh each time from the player's own, read now: the
    ini with the project's folders first and its save folder (as project_game.activate writes them for an Install), in
    a window (WINDOWED), the user ini as the player has it (or, when it is missing, as the game would make it).
    `menu`: the map behind the project's own main menu, for a Play from the menu (project_game.menu_ini).
    `photos`: a live session, whose runner takes photos (the 'shot' command): with the Direct3D 9 renderer."""
    import project_game
    import workspace
    text = settings.GAME_INI.read_text(encoding='latin1')
    managed = getattr(settings, 'MANAGED_PROJECT', False)
    save = '..\\' + settings.MAPS_DIR_NAME.replace('/', '\\') + '\\Save' if managed else None
    if managed:
        (settings.MAPS_DIR / 'Save').mkdir(parents=True, exist_ok=True)
    text = project_game.activate_text(text, workspace.paths_lines(), project_game.original_save_paths(text), save,
                                      project_game.original_actors(text))
    if not managed:
        # any other workspace plays in a save folder of DeusEdix's too (settings.SAVE_DIR), never in the player's own
        settings.SAVE_DIR.mkdir(parents=True, exist_ok=True)
        text = project_game.play_save_text(text, project_game.play_save_path())
    # in a window (WINDOWED): Revision's -windowed alone loses to the player's StartupFullscreen=True (saved from their
    # own game by the development mod), and a full-screen game in the editor's panel gave no picture or crashed (28 Oct
    # 2026). The line's end stays ([^\r\n]: CRLF kept)
    text = re.sub(r'(?im)^StartupFullscreen=[^\r\n]*', 'StartupFullscreen=False', text)
    # DirectDraw off: a game in a window never needs it, and the original game's own DeusEx.ini has it on (its
    # Default.ini's UseDirectDraw=True), with which its start-up waited 17-33 s inside DirectDraw before its window
    # opened ('Startup time' 29.5 s -> 4.5 s with it off in the copy, 30 Oct 2026). Revision's ini has it off already
    text = re.sub(r'(?im)^UseDirectDraw=[^\r\n]*', 'UseDirectDraw=False', text)
    if menu:
        # the project's root window that opens its menu (editor/main_menu.py root_class), from this project's package
        text = project_game.menu_ini(text, settings.PACKAGE + '.UCMenuRoot', menu)
    if photos and (SYS / 'D3D9Drv.dll').is_file():
        # the original game's Direct3D 7 renderer (D3DDrv) reads no picture back: every shot of a live session was all
        # magenta, 640x480 (Oct-Nov 2026). The installed Direct3D 9 one (as for the embedded Play) does; this copy only
        text = _preview_display_ini(text, 'embedded')
        # and pictures big enough to read: a window of at least 1280 x 720 (the original game's own is 640 x 480)
        text = re.sub(r'(?im)^(WindowedViewportX=)(\d+)', lambda m: m.group(1) + str(max(int(m.group(2)), 1280)), text)
        text = re.sub(r'(?im)^(WindowedViewportY=)(\d+)', lambda m: m.group(1) + str(max(int(m.group(2)), 720)), text)
    display_text = _preview_display_ini(text, display_mode)
    if display_text != text and not (SYS / 'D3D9Drv.dll').is_file():
        raise RuntimeError('Resizable embedded Play needs a Deus Ex-compatible Direct3D 9 renderer (D3D9Drv.dll) in the game System folder. Use Play in game window to keep the original renderer.')
    project_game.write_launch_inis((PLAY_INI, INI), display_text, settings.USER_INI)


def remove_launch_inis():
    """This project's launch copies (PLAY_INI, INI) gone after its game closed (the session's cleanup), never while the
    game runs (it reads and writes them). The game writes them as it closes, when a scanner may be reading them: each
    removal waits that out (project_game.remove), then the error, which the next Stop tries again. -> removed any"""
    import project_game
    if running():
        return False
    return any([project_game.remove(path) for path in (PLAY_INI, INI)])


# what the start-ups say when tidy_cut_short fails (editor/server.py main, the mapkit MCP's): the project opens anyway
TIDY_FAILED = 'What a launch cut short left in the game could not be removed: %s'


def tidy_cut_short():
    """The start-up's tidy (the editor's worker, the mapkit MCP), once no game of this target runs: what a launch left
    in the game when no editor saw its game close goes. A Play or live session cut short (the editor killed while its
    game ran) left this project's launch copies (PLAY_INI, INI), the runner's live channel it rewrote (CMD), the
    Console's command file with Stop's 'exit' in it (CONSOLE_CMD) and the loadout (LOADOUT); a mod's game from the
    Mods panel, whose close no editor sees, left its copies (mods.launch_copies). A file written less than LAUNCH_AGE
    ago stays: another editor of the same workspace (the working copy's and the mapkit MCP's are both 'legacy'), or a
    mod's game, may be starting on it. One Windows will not let go of now (an antivirus scanning it) stays for the next
    start, at once: a start-up never waits or fails on it. -> the files removed"""
    import mods
    import project_game
    if running():
        return []
    removed = []
    for path in (PLAY_INI, INI, CMD, CONSOLE_CMD, LOADOUT, *mods.launch_copies(settings.TARGET)):
        try:
            if time.time() - path.stat().st_mtime >= LAUNCH_AGE and project_game.remove(path, wait=0):
                removed.append(path)
        except OSError:                          # gone already, or held now: the next start's
            pass
    return removed


def _set_section(lines):
    """The runner's section (RUNNER) of the launch's user ini as `lines`; the rest of the copy as it is."""
    import project_game
    text = _SECTION.sub('', INI.read_bytes().decode('latin1'))
    if lines:
        text = text.rstrip() + '\r\n\r\n' + '\r\n'.join(lines) + '\r\n'
    project_game.write_file(INI, text.encode('latin1'))


def _set_console():
    """The Console's section of the launch's user ini (UCConsoleLink on, nothing asked yet) and its command file, for a
    launch of the editor's: the section goes with the copy, the command file with the game (cleanup)."""
    import project_game
    text = _CONSOLE_SECTION.sub('', INI.read_bytes().decode('latin1'))
    text = text.rstrip() + '\r\n\r\n' + '\r\n'.join([CONSOLE, 'bActive=True', 'Seq=0', 'Done=0', 'Cmd=', 'Result=']) + '\r\n'
    project_game.write_file(INI, text.encode('latin1'))
    project_game.write_file(CONSOLE_CMD, b'\r\n')
    STATE['console'] = 0


# the player's key bindings (the user ini's [Engine.Input]) and one key's line in it
_INPUT_SECTION = re.compile(r'(?ms)^\[Engine\.Input\][^\r\n]*\r?\n(.*?)(?=^\[|\Z)')
KEY_COMMAND = 'mutate UCKey %s'


def project_keys():
    """The keys the rules of the project's maps wait for ("When JC presses a key": links.keys_in)."""
    import json
    sys_path = str(Path(__file__).resolve().parent / 'editor')
    import sys
    if sys_path not in sys.path:
        sys.path.insert(0, sys_path)
    import links
    keys = set()
    for path in sorted((Path(__file__).resolve().parent / 'maps').glob('*.edits.json')):
        try:
            keys |= set(links.keys_in(json.loads(path.read_text(encoding='utf-8'))))
        except (OSError, ValueError, AttributeError):
            continue
    return sorted(keys)


def with_keys(text, keys):
    """The user ini's text with each key bound to "mutate UCKey <key>" (UCMutator.Mutate tells the rules), in its
    [Engine.Input] (made when it has none); its other keys as they are."""
    if not keys:
        return text
    m = _INPUT_SECTION.search(text)
    body = m.group(1) if m else ''
    lines = [l for l in body.splitlines() if l.strip() and l.split('=', 1)[0].strip().lower() not in {k.lower() for k in keys}]
    lines += ['%s=%s' % (k, KEY_COMMAND % k) for k in keys]
    section = '[Engine.Input]\r\n' + '\r\n'.join(lines) + '\r\n'
    if m:
        return text[:m.start()] + section + ('\r\n' if text[m.end():] else '') + text[m.end():]
    return text.rstrip() + '\r\n\r\n' + section


def _set_keys(keys):
    """The keys of the Interactions in the launch's copy of the player's settings (only for this launch: the player's
    own bindings of those keys are back the next time)."""
    if not keys:
        return
    import project_game
    project_game.write_file(INI, with_keys(INI.read_bytes().decode('latin1'), keys).encode('latin1'))


def _set_loadout(commands):
    """The loadout's file (LOADOUT): its commands, one a line, for a launch; gone without them."""
    import project_game
    if commands:
        project_game.write_file(LOADOUT, ('\r\n'.join(commands) + '\r\n').encode('latin1'))
    else:
        project_game.remove(LOADOUT)


def console(command, timeout=3.0):
    """One line for the game's own console while the editor's Play runs (UCConsoleLink): its answer
    ('' for most commands), or None when the game has not taken it yet (a map loading). Refused once Stop has asked
    the game to quit (_console_line)."""
    status = session_status()
    if not status['owned'] or not status['running'] or status['stopping']:
        raise RuntimeError('The game is not running: start it with Play.')
    command = ' '.join(str(command).split())             # one line: the file is read line by line
    if not command:
        return ''
    end = time.time() + timeout
    n = _console_line(command, timeout, status['token'])
    while time.time() < end:
        answer = _console_answer(n)
        if answer is not None:
            return answer
        time.sleep(0.1)
    return None


def _console_done():
    """How far the game's console has got, as UCConsoleLink saved it into the launch's user ini: (Done, the number of
    the last Console line it ran; Result, its answer to that line; Seq, the number of the last line it read), or None
    while it cannot be read. The link tries to save Seq when it reads the command file, before it runs the line, and
    Done once it has run it, but the game can lose either save (the original game in exclusive full screen ran Stop's
    'exit' with neither saved in 3 of 12 Stops, the fourth game test of 29 Oct 2026): a missing Seq is no proof that the
    line was not read."""
    try:
        m = _CONSOLE_SECTION.search(INI.read_text(encoding='latin1', errors='replace'))
    except OSError:                                          # the game is writing it (SaveConfig)
        return None
    if not m:
        return None
    values = dict(line.split('=', 1) for line in m.group(0).splitlines()[1:] if '=' in line)
    try:
        return (int(values.get('Done', '0') or 0), values.get('Result', '').strip(),
                int(values.get('Seq', '0') or 0))
    except ValueError:
        return None


def _console_answer(n):
    """The game's answer to the Console's line `n` (_console_done's Result, with Done at `n` or past it), or None while
    it has not taken that line."""
    done = _console_done()
    return done[1] if done is not None and done[0] >= n else None


def _console_line(command, wait, token, last=False):
    """One line for the game's own console into its command file (CONSOLE_CMD), which UCConsoleLink execs every 0.25 s
    while the game runs: replaced as soon as the game lets go of it, for `wait` seconds at most. One writer at a time
    (_CONSOLE_LOCK). The file holds one line: once the last line of the launch `token` is in it (Stop's 'exit', `last`),
    another would take its place before the game read it, and is refused. -> its number (Seq)"""
    import project_game
    with _CONSOLE_LOCK:
        if STATE.get('exit_asked') == token:
            raise RuntimeError('The game is closing.')
        STATE['console'] = n = STATE.get('console', 0) + 1
        project_game.write_file(CONSOLE_CMD, ('set UCConsoleLink Cmd %s\r\nset UCConsoleLink Seq %d\r\n'
                                              % (command, n)).encode('latin1', 'replace'), wait)
        if last:                         # Stop's 'exit': its line, when it was asked, the game's mark (_exit_by_itself)
            STATE.update(exit_asked=token, exit_line=n, exit_at=time.time(), exit_answered=None,
                         exit_mark=_running_mark().exists())
    return n


def log_path():
    """The running game's log (Revision.log, DeusEx.log), in its System folder."""
    return SYS / (EXE.stem + '.log')


def read_log(offset=-1, limit=400000):
    """The log's new whole lines from `offset` (a byte position): (next offset, lines). -1: the last
    few kilobytes of it; an offset past its end means a new log (the game started again): from the top."""
    path = log_path()
    try:
        size = path.stat().st_size
    except OSError:
        return 0, []
    tail = offset < 0
    if tail:
        offset = max(0, size - 12000)
    elif offset > size:
        offset = 0
    with path.open('rb') as f:
        f.seek(offset)
        data = f.read(limit)
    if tail and offset:                       # the tail starts in the middle of a line: from the next one
        skip = data.find(b'\n') + 1
        data, offset = data[skip:], offset + skip
    cut = data.rfind(b'\n') + 1
    return offset + cut, data[:cut].decode('latin1').splitlines()


LOGIC_TAG = b'DeusEdixLogic: '              # the logic log's lines (editor/LOGIC.md, logic-log.js LOGIC_TAG)
LOAD_MAP = re.compile(rb'^Log: LoadMap: ([^?\s]+)')


def logic_lines(map_name, limit=64 << 20, keep=6000):
    """What one map's rules wrote in the game that ran last (its log starts again with each game): a dict of
    lines (the logic log's, the tag taken off: the last `keep` of them, from the log's last `limit` bytes), loads (how
    many times that game loaded the map), maps (the maps it loaded, in order, once each) and written (when the log was
    last written, ms since 1970). None when there is no log."""
    path = log_path()
    try:
        st = path.stat()
    except OSError:
        return None
    want, out, maps, loads = map_name.lower(), [], {}, 0
    with path.open('rb') as f:
        if st.st_size > limit:
            f.seek(st.st_size - limit)
            f.readline()                      # from the next whole line
        for raw in f:
            if raw.startswith(LOGIC_TAG):
                line = raw[len(LOGIC_TAG):].rstrip(b'\r\n').decode('latin1')
                parts = line.split('|', 2)
                if len(parts) > 1 and parts[1].lower() == want:
                    out.append(line)
                continue
            m = LOAD_MAP.match(raw)
            if m:
                name = m.group(1).decode('latin1').rsplit('/', 1)[-1].rsplit('\\', 1)[-1]
                name = re.sub(r'\.(dx|unr)$', '', name, flags=re.I)
                maps.setdefault(name.lower(), name)
                loads += name.lower() == want
    return dict(lines=out[-keep:], loads=loads, maps=list(maps.values()), written=st.st_mtime_ns // 1000000)


def _section():
    m = _SECTION.search(INI.read_text(encoding='latin1', errors='replace'))
    out = {}
    if m:
        for line in m.group(0).splitlines()[1:]:
            if '=' in line:
                k, v = line.split('=', 1)
                out[k.strip()] = v.strip()
    return out


def _write_cmd(lines):
    """The runner's live channel (CMD) as `lines`, each ended by CRLF (written as bytes: a text-mode write made it
    CR CR LF), put in place at once."""
    import project_game
    project_game.write_file(CMD, ('\r\n'.join(lines) + '\r\n').encode('latin1'))
    STATE['command_written'] = True


def _wait_done(seq, timeout):
    end = time.time() + timeout
    while time.time() < end:
        status = session_status()
        if status['stopping'] or not (status['running'] or status['launching']):
            raise RuntimeError(status['error'] or 'the game session was stopped')
        if status['launching']:
            time.sleep(0.2)
            continue
        try:
            s = _section()
            if int(s.get('LiveDone', '-99')) >= seq:
                return s
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise TimeoutError('no answer from the game for step %d' % seq)


def start(map_name='06_HongKong_WanChai_Rooftop', setup='', delay=6, start_map='01_NYC_UNATCOIsland', timeout=180,
          menu=False):
    """Launch the game in live mode on map_name (or run a UCDbg* setup first). Returns its first answer. `menu`: with
    the project's own main menu (map_name is the map behind it)."""
    launch = start_map if setup else map_name
    _launch(map_name, [RUNNER, 'bActive=True', 'bLive=True', 'LiveSeq=0', 'LiveDone=-1',
                      'LiveCmd=', 'LiveResult=', 'Setup=%s' % setup, 'SetupFlags=', 'StartDelay=%s' % delay],
            launch, live_mode=True, menu=map_name if menu else None)
    STATE['folder'] = SHOTS / (time.strftime('%Y%m%d-%H%M%S') + '-live')
    STATE['folder'].mkdir(parents=True, exist_ok=True)
    return _wait_done(0, timeout).get('LiveResult', '')


# A Play's runner waits only where a case needs it (startup2, 30 Oct 2026; before, StartDelay=1 and a 'wait;1' step in
# every Play: 2 s more before JC had the controls). UCShotRunner waits 1 s at its start (its Begin, in the project
# template), then StartDelay, then runs its steps. The map's mission script (DeusEx's MissionScript) runs its first
# Timer 1 s after the map starts (checkTime), and on a map reached by travel (a setup's jump) that Timer runs its
# FirstFrame. A plain Play needs nothing more: the 'play' step only places JC and gives him the controls, and a
# loadout's commands and items need only JC, there at the runner's start. A setup's map (its FirstFrame) and the flags
# of a Play without a setup (set by the 'play' step) need the 'play' step after that first Timer, as the old waits had
# it: MISSION_MARGIN more, unless a loadout's steps, half a second each in the runner, give it already
PLAY_START_DELAY = 0
MISSION_MARGIN = 'w2;wait;0.5'


def play_steps(map_name, step, setup='', flags='', steps=(), commands=()):
    """The runner's steps of a Play (its Shots[]), the 'play' `step` last: a setup's 'waitmap' first (the steps are for
    its map: the setup may travel through another), MISSION_MARGIN where it is needed, the loadout (LOADOUT's commands
    by one step, then its `steps`)."""
    loadout = (['ld;console;exec %s' % LOADOUT.name] if commands else []) + list(steps)
    margin = [MISSION_MARGIN] if (setup or flags) and not loadout else []
    return (['w;waitmap;%s;90' % map_name] if setup else []) + margin + loadout + [step]


def play(map_name, at=None, yaw=0, pitch=0, setup='', flags='', start_map=None, display_mode='external', steps=(),
         commands=()):
    """'Play from here' of the map editor: the game on the installed map, JC at `at` facing yaw/pitch,
    the mission flags of a UCDbg* setup and/or 'Flag=1,Other=0'; then the player has the controls and
    the runner switches itself off (bActive=False). Returns at once (the game takes ~30 s to start).
    A play scenario's loadout (editor/play.py loadout_run) comes first: its console `commands`, run from LOADOUT by one
    step, then its runner `steps` (the items in front of where JC will stand)."""
    step = 'go;play;%.1f;%.1f;%.1f;%d;%d' % (at[0], at[1], at[2], int(yaw) % 65536, int(pitch)) if at else 'go;play'
    shots = play_steps(map_name, step, setup, flags, steps, commands)
    if setup:
        # a setup jumps to its map: start somewhere else (jumping to the same map reloads its saved state);
        # UNATCO Island -> Wan Chai Street crashed once, so the Street starts from the rooftop
        launch = start_map or ('06_HongKong_WanChai_Rooftop' if map_name == '06_HongKong_WanChai_Street'
                               else '01_NYC_UNATCOHQ' if map_name == '01_NYC_UNATCOIsland' else '01_NYC_UNATCOIsland')
    else:
        launch = map_name
    _launch(map_name, [RUNNER, 'bActive=True', 'bLive=False', 'Setup=%s' % setup, 'SetupFlags=%s' % flags,
                       'StartDelay=%s' % PLAY_START_DELAY] + ['Shots[%d]=%s' % (i, s) for i, s in enumerate(shots)],
            launch, display_mode=display_mode, commands=commands)
    return 'starting %s%s' % (map_name, ' after %s' % setup if setup else '')


def play_menu(menu_map, display_mode='external'):
    """File > Main menu > Play: the game as the project's own, on the map behind its main menu with that menu open
    (project_game.menu_ini), as a player of the mod would start it. The runner stays off: nothing is done for the player.
    Returns at once."""
    _launch(menu_map, [RUNNER, 'bActive=False', 'bLive=False', 'Setup=', 'SetupFlags=', 'StartDelay=0'],
            menu_map, display_mode=display_mode, menu=menu_map)
    return 'starting the main menu on %s' % menu_map


def _new_shot(after):
    found = []
    for d in (SYS, REV, REV.parent):
        for f in d.glob('Shot*'):
            if f.suffix.lower() in ('.bmp', '.png', '.jpg') and f.stat().st_mtime > after:
                found.append(f)
    return max(found, key=lambda f: f.stat().st_mtime) if found else None


def do(step, timeout=30, label=None, width=1600):
    """Run one step ('player;x;y;z;yaw;pitch', 'cam;x;y;z;lx;ly;lz', 'view', 'console;cmd', 'flag;Name',
    'talk;Tag', 'next', 'hud;1' ...). Returns (answer, png_path or None)."""
    status = session_status()
    if not status['owned'] or not status['running'] or status['stopping']:
        raise RuntimeError(status['error'] or 'No owned game session is running.')
    STATE['seq'] += 1
    seq = STATE['seq']
    t0 = time.time() - 1
    _write_cmd(['set UCShotRunner LiveCmd %s' % step, 'set UCShotRunner LiveSeq %d' % seq])
    answer = _wait_done(seq, timeout)
    png = None
    parts = answer.get('LiveResult', '').split('|')         # map|location|view|photo taken[|step anim's answer]
    if len(parts) > 3 and parts[3] == 'True':
        for _ in range(25):
            shot = _new_shot(t0)
            if shot is not None:
                time.sleep(0.3)
                from PIL import Image as PILImage
                im = PILImage.open(shot).convert('RGB')
                if im.width > width:
                    im = im.resize((width, int(im.height * width / im.width)))
                folder = STATE['folder'] or SHOTS
                png = folder / ('%03d_%s.png' % (seq, re.sub(r'[^\w-]', '_', label or step.split(';')[0])))
                im.save(png)
                shot.unlink(missing_ok=True)
                break
            time.sleep(0.2)
    return answer.get('LiveResult', ''), png


def show_map(map_name='06_HongKong_WanChai_Rooftop', source='out', timeout=120):
    """Open a freshly built map in the running game without restarting it. The map is copied to
    settings.MAPS_DIR under a new name each time (UCLive<n>: no locked file, no saved state); the story
    scripts key on the real name, so this is for looking, not for playing the story."""
    status = session_status()
    if not status['owned'] or not status['running'] or status['stopping']:
        raise RuntimeError(status['error'] or 'No owned game session is running.')
    if isinstance(source, Path):
        src = source
    else:
        src = (PROJECT / 'tools' / 'mapkit' / 'out' if source == 'out' else PROJECT / 'maps') / (map_name + '.dx')
    n = int(time.time()) % 100000
    name = 'UCLive%05d' % n
    shutil.copy2(src, settings.MAPS_DIR / (name + '.dx'))
    STATE['maps'].add(settings.MAPS_DIR / (name + '.dx'))
    do('console;open %s%s' % (name, MUTATOR), timeout)
    answer, _ = do('wait;0.5', timeout)          # answered by the runner of the new map
    return answer


def _exit_by_itself(patient=True):
    """The game asked to quit through its own console ('exit' into UCConsoleLink's command file), then up to EXIT_WAIT
    for its process to end; `patient`, up to EXIT_WAIT_TAKEN from its answer to that line (it is closing, and leaving
    exclusive full screen takes it about 5 s): the game has read the line (_console_done's Seq), run it (Done), or
    removed System\\Running.ini as it runs the 'exit' (the mark it makes as it starts). The removal counts only when the
    mark was there at the request: a game that made none gives no such answer, and one stopped in its error box keeps
    it. The game can lose its saves of Seq and Done (another program reading the copy as it saves): in e3c of the fourth
    game test of 29 Oct 2026 the console freed after the request, neither was saved, and only Running.ini's removal
    answered. Once its console has been seen inside an earlier line (Done below the line before the 'exit': it has not
    read it yet), a patient Stop also waits up to EXIT_WAIT_TAKEN from the request, even if the console then frees with
    no answer of any kind: a backstop (the max()), for a case no real run has shown. The page's embedded Stop only asks
    first (not patient): still open after EXIT_WAIT, the game may be held up by the editor's window, its parent, and the
    page hands it back before the Stop that may close it. Asked once a launch: a later Stop writes no second 'exit' and
    only waits by those two rules, on the answer whichever Stop saw it first (a game left alone in full screen outside
    the panel answered the page's first Stop and was still closing at its second). The game closes as a player's Quit
    does, removes System\\Running.ini and saves its settings into its launch copies. The Console link runs in every
    launch of the editor's, a Play whose runner has switched itself off too, and ticks while the game is paused (a HUD
    window); the runner's live channel, which Stop used before, is read in live mode only: a Play's Stop waited 8 s for
    nothing, then closed the game from outside (29 Oct 2026). Closed from outside (WM_CLOSE, then TerminateProcess after
    3 s) the game left Running.ini, and the next start stopped on the Recovery Mode dialog (20 Oct 2026). -> the game
    has ended"""
    status = session_status()
    if not status['owned'] or not status['running'] or status['stopping'] or status['launching']:
        return False
    if STATE.get('exit_asked') != status['token']:
        try:
            _console_line('exit', 1.0, status['token'], last=True)
        except OSError:
            return False
        end = STATE['exit_at'] + EXIT_WAIT
    else:
        end = time.time()                                # asked by an earlier Stop: no EXIT_WAIT again
    n = STATE['exit_line']
    while session_status()['running']:
        done, _, seq = _console_done() or (None, None, None)
        # answered: the 'exit' read (Seq) or run (Done), or the mark there at the request gone (exists(): an
        # attributes-only open, which cannot refuse the game's removal; never a read); busy: Done below the line before
        # it, whatever Seq says
        gone = STATE.get('exit_mark') and not _running_mark().exists()
        if STATE['exit_answered'] is None and (gone or done is not None and max(done, seq) >= n):
            STATE['exit_answered'] = time.time()         # the first answer, whoever saw it: a later Stop waits on it
        if patient and STATE['exit_answered'] is not None:
            end = max(end, STATE['exit_answered'] + EXIT_WAIT_TAKEN)
        elif patient and done is not None and done < n - 1:
            end = max(end, STATE['exit_at'] + EXIT_WAIT_TAKEN)
        if time.time() >= end:
            break
        time.sleep(0.1)
    return not session_status()['running']


# stop(force=False)'s answer while the game, asked to quit, is still open
STILL_OPEN = 'The game was asked to close and is still open.'


def stop(timeout=5, force=True, ask=True):
    """Close only this launch: first by its own exit (_exit_by_itself), then, still open, from outside as before
    (WM_CLOSE to its top-level windows, then TerminateProcess after 3 s); with force False, only asked (-> STILL_OPEN
    while it is open). An embedded game's window is a child of the editor's, which WM_CLOSE never reaches: the page asks
    first, and only when the game is still open detaches it and stops again. With ask False (a game that can no
    longer answer: stopped in its error box, its console not running) nothing is asked: closed from outside at once.
    Force False always asks, whatever ask says (both False, an API client's pair, closed an embedded game from outside).
    What a launch cut short left is the start-up's (tidy_cut_short)."""
    ask = ask or not force
    if ask and not _exit_by_itself(patient=force) and not force:
        status = session_status()
        if status['owned'] and status['running'] and not status['stopping']:
            return STILL_OPEN
    status = _session().stop(timeout)
    if status['error']:
        raise RuntimeError(status['error'])
    if status['launching']:
        return 'Launch cancelled; waiting for Steam to finish starting so the game can be closed safely.'
    if status['running']:
        return 'Closing the game.'
    return 'stopped'
