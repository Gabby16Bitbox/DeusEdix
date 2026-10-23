"""Live link to the running game (Revision + UNATCO Continues, or the project's game: settings.TARGET): open
it once, then look around in seconds.

    import live
    live.start('06_HongKong_WanChai_Rooftop')                 # launches the game through Steam (~30 s)
    path = live.do('player;-29400;100;48;32768;0')            # JC there, screenshot -> PNG path (~1-2 s)
    live.do('console;summon MedKit')   # any console command
    live.show_map('06_HongKong_WanChai_Rooftop')              # after a rebuild: fresh copy, no restart
    live.stop()                                               # quits the game, restores RevisionUser.ini

Channel: the mod's UCShotRunner in live mode execs System\\UCLive.txt (console "set" lines written
here) and acknowledges each step by saving LiveDone/LiveResult to RevisionUser.ini.
"""
import os
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
INI = settings.USER_INI                     # RevisionUser.ini
# the original game is started with copies of its ini files made for the launch (INI=, USERINI=: it has no
# -windowed and no second Paths list): its own DeusEx.ini (fullscreen, its folders) and User.ini stay as
# the player has them. The copies sit in the project's folder in the game, named to the game by a path
# relative to its System folder: no spaces, no quotes (Steam rewrites quoted values, 15 Oct 2026)
PLAY_INI = None if settings.IS_REVISION else settings.MAPS_DIR / 'Play' / settings.GAME_INI.name
PLAY_REL = '..\\' + settings.MAPS_DIR_NAME.replace('/', '\\') + '\\Play\\'
if PLAY_INI is not None:
    INI = PLAY_INI.with_name(settings.USER_INI.name)
EXE = settings.GAME_EXE
GAME = settings.PROFILE['short']
STEAM_APP = settings.STEAM_APP
CMD = SYS / 'UCLive.txt'
CONSOLE_CMD = SYS / 'UCConsole.txt'
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


def running():
    return bool(_session().processes.list())


def _launch(map_name, runner_lines, launch, live_mode=False, display_mode='external'):
    snapshot = {}

    def prepare():
        import workspace
        if PLAY_INI is not None:
            _session_inis(display_mode)
        previous = _SECTION.search(INI.read_text(encoding='latin1'))
        snapshot['section'] = previous.group(0) if previous else ''
        snapshot['command'] = CMD.read_bytes() if CMD.is_file() else None
        snapshot['prepared'] = True
        # a game closed from outside leaves System\Running.ini, and the next start stops on the "Recovery Mode"
        # dialog (the editor's tests got stuck there, 20 Oct 2026): with no game running, it is only a stale mark
        if not running():
            (SYS / 'Running.ini').unlink(missing_ok=True)
        if PLAY_INI is None:
            workspace.activate()
        _set_section(runner_lines)
        _set_console(True)
        STATE.update(seq=0, command_written=False, maps=set())
        if live_mode:
            _write_cmd([])
        save_root = settings.MAPS_DIR / 'Save' if getattr(settings, 'MANAGED_PROJECT', False) else REV / 'Save'
        (save_root / 'Current' / (map_name + '.dxs')).unlink(missing_ok=True)

    def dispatch(token):
        url = launch + MUTATOR + '?DeusEdixSession=' + token
        if map_name == '00_DeusEdix_Tutorial':
            import project_preferences
            if project_preferences.load().get('ucmap.doctorAudioMuted') == 'true':
                url += '?DeusEdixHaleMuted=1'
        if PLAY_INI is not None:
            # the original game (Steam's copy has Steam's launch check: "Failed to find Steam" when started
            # directly; GOG's starts by itself, settings.game_command): the URL first (the engine's first
            # word), then the launch's ini files. Steam quotes every word, and the engine would read the
            # closing quote as part of the file name (then no ini: its First-Time Configuration); it stops a
            # value at a comma, so a comma ends each one (15 Oct 2026)
            argv, cwd = settings.game_command([url, 'INI=' + PLAY_REL + PLAY_INI.name + ',', 'USERINI=' + PLAY_REL + INI.name + ','])
            subprocess.Popen(argv, cwd=cwd)
            return
        argv, cwd = settings.game_command([url, '-windowed'])
        subprocess.Popen(argv, cwd=cwd)

    def cleanup():
        if not snapshot.get('prepared'):
            return
        if running():
            raise RuntimeError('Another %s process is running; game settings have been left intact.' % GAME)
        _set_section(snapshot['section'].splitlines() if snapshot['section'] else None)
        _set_console(False)
        if STATE['command_written']:
            if snapshot['command'] is None:
                CMD.unlink(missing_ok=True)
            else:
                CMD.write_bytes(snapshot['command'])
        for path in tuple(STATE['maps']):
            path.unlink(missing_ok=True)
        STATE.update(seq=0, folder=None, command_written=False, maps=set())
        import project_game
        project_game.deactivate_if_current()
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


def _session_inis(display_mode='external'):
    """The original game's DeusEx.ini and User.ini for one launch (PLAY_INI): its own, read now, with the
    project's folders first and its save folder (as project_game.activate writes them into Revision.ini),
    in a window."""
    import project_game
    import workspace
    PLAY_INI.parent.mkdir(parents=True, exist_ok=True)
    text = settings.GAME_INI.read_text(encoding='latin1')
    managed = getattr(settings, 'MANAGED_PROJECT', False)
    save = '..\\' + settings.MAPS_DIR_NAME.replace('/', '\\') + '\\Save' if managed else None
    if managed:
        (settings.MAPS_DIR / 'Save').mkdir(parents=True, exist_ok=True)
    text = project_game.activate_text(text, workspace.paths_lines(), project_game.original_save_paths(text), save,
                                      project_game.original_actors(text))
    text = re.sub(r'(?im)^StartupFullscreen=.*$', 'StartupFullscreen=False', text)
    display_text = _preview_display_ini(text, display_mode)
    if display_text != text and not (SYS / 'D3D9Drv.dll').is_file():
        raise RuntimeError('Resizable embedded Play needs a Deus Ex-compatible Direct3D 9 renderer (D3D9Drv.dll) in the game System folder. Use Play in game window to keep the original renderer.')
    text = display_text
    PLAY_INI.write_text(text, encoding='latin1', newline='')
    shutil.copy2(settings.USER_INI, INI)


def _set_section(lines):
    backup = INI.with_name(INI.name + '.bak_shots')
    if not backup.exists():
        shutil.copy2(INI, backup)
    text = _SECTION.sub('', INI.read_text(encoding='latin1'))
    if lines:
        text = text.rstrip() + '\r\n\r\n' + '\r\n'.join(lines) + '\r\n'
    tmp = INI.with_name(INI.name + '.deusedix-tmp')      # replaced at once: never cut short by a full disk
    tmp.write_text(text, encoding='latin1', newline='')
    os.replace(tmp, INI)


def _set_console(on):
    """The Console's section of the user ini (UCConsoleLink) and its command file: there for a launch of
    the editor's, gone after it (the game writes the section back when it quits: cleanup runs after)."""
    text = _CONSOLE_SECTION.sub('', INI.read_text(encoding='latin1'))
    if on:
        text = text.rstrip() + '\r\n\r\n' + '\r\n'.join([CONSOLE, 'bActive=True', 'Seq=0', 'Done=0', 'Cmd=', 'Result=']) + '\r\n'
    tmp = INI.with_name(INI.name + '.deusedix-tmp')
    tmp.write_text(text, encoding='latin1', newline='')
    os.replace(tmp, INI)
    if on:
        CONSOLE_CMD.write_text('\r\n', encoding='latin1')
    else:
        CONSOLE_CMD.unlink(missing_ok=True)
    STATE['console'] = 0


def console(command, timeout=3.0):
    """One line for the game's own console while the editor's Play runs (UCConsoleLink): its answer
    ('' for most commands), or None when the game has not taken it yet (a map loading)."""
    status = session_status()
    if not status['owned'] or not status['running'] or status['stopping']:
        raise RuntimeError('The game is not running: start it with Play.')
    command = ' '.join(str(command).split())             # one line: the file is read line by line
    if not command:
        return ''
    STATE['console'] = n = STATE.get('console', 0) + 1
    tmp = CONSOLE_CMD.with_suffix('.tmp')
    tmp.write_bytes(('set UCConsoleLink Cmd %s\r\nset UCConsoleLink Seq %d\r\n' % (command, n)).encode('latin1', 'replace'))
    os.replace(tmp, CONSOLE_CMD)
    end = time.time() + timeout
    while time.time() < end:
        m = _CONSOLE_SECTION.search(INI.read_text(encoding='latin1', errors='replace'))
        if m:
            values = dict(line.split('=', 1) for line in m.group(0).splitlines()[1:] if '=' in line)
            try:
                if int(values.get('Done', '0') or 0) >= n:
                    return values.get('Result', '').strip()
            except ValueError:
                pass
        time.sleep(0.1)
    return None


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
    tmp = CMD.with_suffix('.tmp')
    tmp.write_text('\r\n'.join(lines) + '\r\n', encoding='latin1')
    os.replace(tmp, CMD)
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


def start(map_name='06_HongKong_WanChai_Rooftop', setup='', delay=6, start_map='01_NYC_UNATCOIsland', timeout=180):
    """Launch the game in live mode on map_name (or run a UCDbg* setup first). Returns its first answer."""
    launch = start_map if setup else map_name
    _launch(map_name, [RUNNER, 'bActive=True', 'bLive=True', 'LiveSeq=0', 'LiveDone=-1',
                      'LiveCmd=', 'LiveResult=', 'Setup=%s' % setup, 'SetupFlags=', 'StartDelay=%s' % delay],
            launch, live_mode=True)
    STATE['folder'] = SHOTS / (time.strftime('%Y%m%d-%H%M%S') + '-live')
    STATE['folder'].mkdir(parents=True, exist_ok=True)
    return _wait_done(0, timeout).get('LiveResult', '')


def play(map_name, at=None, yaw=0, pitch=0, setup='', flags='', start_map=None, display_mode='external'):
    """'Play from here' of the map editor: the game on the installed map, JC at `at` facing yaw/pitch,
    the mission flags of a UCDbg* setup and/or 'Flag=1,Other=0'; then the player has the controls and
    the runner switches itself off (bActive=False). Returns at once (the game takes ~30 s to start)."""
    step = 'go;play;%.1f;%.1f;%.1f;%d;%d' % (at[0], at[1], at[2], int(yaw) % 65536, int(pitch)) if at else 'go;play'
    shots = (['w;waitmap;%s;90' % map_name] if setup else []) + ['w2;wait;1', step]
    if setup:
        # a setup jumps to its map: start somewhere else (jumping to the same map reloads its saved state);
        # UNATCO Island -> Wan Chai Street crashed once, so the Street starts from the rooftop
        launch = start_map or ('06_HongKong_WanChai_Rooftop' if map_name == '06_HongKong_WanChai_Street'
                               else '01_NYC_UNATCOHQ' if map_name == '01_NYC_UNATCOIsland' else '01_NYC_UNATCOIsland')
    else:
        launch = map_name
    _launch(map_name, [RUNNER, 'bActive=True', 'bLive=False', 'Setup=%s' % setup,
                      'SetupFlags=%s' % flags, 'StartDelay=1'] + ['Shots[%d]=%s' % (i, s) for i, s in enumerate(shots)], launch,
            display_mode=display_mode)
    return 'starting %s%s' % (map_name, ' after %s' % setup if setup else '')


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
    UnatcoMaps under a new name each time (UCLive<n>: no locked file, no saved state); the story
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


def _exit_by_itself(wait=8.0):
    """The game asked to quit through its own console (the runner's step 'console;exit'): it closes as a player's
    Quit does and removes System\\Running.ini. Closed from outside (WM_CLOSE, then TerminateProcess after 3 s)
    it left Running.ini, and the next start stopped on the Recovery Mode dialog (20 Oct 2026)."""
    status = session_status()
    if not status['owned'] or not status['running'] or status['stopping'] or status['launching']:
        return
    try:
        STATE['seq'] += 1
        _write_cmd(['set UCShotRunner LiveCmd console;exit', 'set UCShotRunner LiveSeq %d' % STATE['seq']])
    except OSError:
        return
    end = time.time() + wait
    while time.time() < end and running():
        time.sleep(0.2)


def stop(timeout=5):
    """Close only this launch, including a runner which already switched itself off: first by its own exit,
    then (still open) as before."""
    _exit_by_itself()
    status = _session().stop(timeout)
    if status['error']:
        raise RuntimeError(status['error'])
    if status['launching']:
        return 'Launch cancelled; waiting for Steam to finish starting so the game can be closed safely.'
    if status['running']:
        return 'Closing the game.'
    return 'stopped'
