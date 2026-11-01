"""Every launch of the editor's (Play, a live session, the mapkit MCP's live_start, a mod's game) starts the game on its
own copies of the game's ini files (INI=, USERINI=), Revision's too (A2, 29 Oct 2026): the player's Revision.ini and
RevisionUser.ini are never written, so the window mode, size, map played last and answers the game and the mod save go
into the copies, which go with the game. Every launch of the editor's is in a window, a mod's game in the player's own
mode. A player with no user ini plays on a copy of its default user ini. Stop asks the game's own exit through its
Console link first, waits longer for a game that answered it (read or ran it, or removed the Running.ini it had at the
request; from its answer, a later Stop too) or whose console was seen inside an earlier line, and no Console line takes
its place. Every replace and removal of a game's file waits out a sharing violation; the start-up tidies what a launch
cut short left, the session's cleanup the mark of a game closed from outside, last (29 Oct 2026, fix2c, fix2d, fix2e,
fix2f). Fake game folders only."""
import contextlib
import importlib.util
import json
import os
import re
import stat
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import settings as real_settings  # noqa: E402  (the real data: TARGETS, launch_inis)
from game_process import GameSession  # noqa: E402
from test_game_process import FakeProcesses  # noqa: E402

# the player's own files, as Revision and the development mod leave them (CRLF ini, LF user ini: 28 Oct 2026)
PLAYER_INI = (b'[Core.System]\r\nSavePath=..\\Save\r\nPaths=..\\Maps\\*.dx\r\nPaths=..\\DeusEdixMaps\\*.dx\r\n'
              b'[RevisionInternal.LaunchSystem]\r\nSavePath=..\\Save\r\nPaths=..\\Maps\\*.dx\r\n'
              b'[Engine.Engine]\r\nGameRenderDevice=D3D9Drv.D3D9RenderDevice\r\n'
              b'[Engine.GameEngine]\r\nServerActors=IpDrv.UdpBeacon\r\nServerActors=DevMod.UCDevActor\r\n'
              b'[Engine.GameInfo]\r\nGameSpeed=1.000000\r\n'
              b'[WinDrv.WindowsClient]\r\nStartupFullscreen=True\r\nUseDirectDraw=True\r\nWindowedViewportX=1280\r\n'
              b'[WinDrvLite.WindowsClientLite]\r\nStartupFullscreen=True\r\nWindowedViewportX=3840\r\n')
PLAYER_USER = (b'[Engine.Input]\nF24=\n[DeusEx.Human]\nlastPlayedMap=01_Missione_1\nlastPlayedChapter=1\n'
               b'bAnimatedMainMenu=False\n')
VANILLA_INI = (b'[Core.System]\r\nSavePath=..\\Save\r\nPaths=..\\Maps\\*.dx\r\n'
               b'[Engine.Engine]\r\nGameRenderDevice=D3D9Drv.D3D9RenderDevice\r\n'
               b'[WinDrv.WindowsClient]\r\nStartupFullscreen=True\r\nUseDirectDraw=True\r\n'
               b'WindowedViewportX=1600\r\n')
# each game's default user ini, where the real game has it (the listing of its System folders, 29 Oct 2026): what the
# engine makes a missing user ini from
DEFAULT_USER = {'revision': ('Revision/System/RevisionDefUser.ini', b'[Engine.Input]\r\nW=MoveForward\r\nF24=\r\n'),
                'vanilla': ('System/DefUser.ini', b'[Engine.Input]\r\nW=MoveForward\r\n')}


def module(name, settings):
    """A fresh copy of one of mapkit's modules on these settings."""
    spec = importlib.util.spec_from_file_location('isolated_' + name, KIT / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'settings': settings}):
        spec.loader.exec_module(result)
    return result


def fake_settings(game, target='revision', project='p', managed=True):
    """settings for a project (or, not managed, a workspace) of `target` in the fake Deus Ex folder `game`."""
    profile = real_settings.TARGETS[target]
    root = game / profile['root'] if profile['root'] else game
    system = root / 'System'
    maps = 'DeusEdixProjects/' + project if managed else 'DeusEdixMaps'

    def real(function):
        """One of the real settings' functions, in the fake Deus Ex folder, for `target` unless told another game."""
        def call(*args, **kwargs):
            with patch.object(real_settings, 'GAME', game), patch.object(real_settings, 'TARGET', target):
                return function(*args, **kwargs)
        return call
    return types.SimpleNamespace(
        TARGET=target, TARGETS=real_settings.TARGETS, PROFILE=profile, IS_REVISION=target == 'revision', GAME=game,
        REVISION=root, GAME_ROOT=root, GAME_SYSTEM=system, GAME_EXE=system / profile['exe'],
        GAME_INI=system / profile['ini'], USER_INI=system / profile['user_ini'], STEAM_APP=profile['app'],
        PACKAGE='DXP_' + project, PROJECT_ID=project, MANAGED_PROJECT=managed, MAPS_DIR_NAME=maps, MAPS_DIR=root / maps,
        SAVE_DIR_NAME='DeusEdixProjects/%s/Save' % project, SAVE_DIR=root / 'DeusEdixProjects' / project / 'Save',
        DEV={'package': 'DevMod', 'mapsDir': 'DevMaps'}, PROJECT=game.parent / 'project', STANDALONE=True,
        ANIMS_PACKAGE='A', MODELS_PACKAGE='M', SOUNDS_PACKAGE='S', SCRIPTS_PACKAGE='Scripts',
        LAUNCH_PLAY=real_settings.LAUNCH_PLAY, LAUNCH_MOD=real_settings.LAUNCH_MOD, launch_names=real_settings.launch_names,
        check_game=lambda folder, target=None: [], launch_inis=real(real_settings.launch_inis),
        system_folder=real(real_settings.system_folder),
        game_command=lambda args, target=None, folder=None: (['C:\\Steam\\steam.exe', '-applaunch', profile['app']]
                                                             + list(args), None))


class Game(unittest.TestCase):
    """A fake Deus Ex folder with Revision and the original game, the player's files in each, and live, project_game
    and workspace made on the settings of one project of one of them (play())."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.game = Path(self.temp.name) / 'Deus Ex'
        for target, ini, user in (('revision', PLAYER_INI, PLAYER_USER), ('vanilla', VANILLA_INI, b'[Engine.Input]\r\nF24=\r\n')):
            s = fake_settings(self.game, target)
            s.GAME_SYSTEM.mkdir(parents=True, exist_ok=True)
            s.GAME_INI.write_bytes(ini)
            s.USER_INI.write_bytes(user)
            (self.game / DEFAULT_USER[target][0]).write_bytes(DEFAULT_USER[target][1])
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.stack.close)
        self.use()

    def use(self, target='revision', managed=True, project='p'):
        """live, project_game and workspace of that project; a session that only prepares (and, closed(), cleans up)."""
        self.s = fake_settings(self.game, target, project, managed)
        self.pg = module('project_game', self.s)
        self.ws = module('workspace', self.s)
        self.mods = module('mods', self.s)
        self.live = module('live', self.s)
        self.live.SHOTS = self.game.parent / 'shots'                     # a live session's photos: not the project's
        self.cleanup = None

        def start(prepare, dispatch, cleanup):
            prepare()
            self.dispatch, self.cleanup = dispatch, cleanup
            return {}
        self.live._SESSION = types.SimpleNamespace(processes=types.SimpleNamespace(list=lambda: []), start=start)
        self.stack.enter_context(patch.dict(sys.modules, {'project_game': self.pg, 'workspace': self.ws, 'mods': self.mods}))
        self.before = {path: path.read_bytes() if path.exists() else None for path in (self.s.GAME_INI, self.s.USER_INI)}
        return self.live

    def system(self):
        return self.s.GAME_SYSTEM

    def copies(self):
        """This project's launch copies: Revision's in its System folder by the project's id, the original game's in
        the project's folder in the game under its own names."""
        if self.s.IS_REVISION:
            name = 'DeusEdixPlay_' + self.s.PROJECT_ID
            return self.system() / (name + '.ini'), self.system() / (name + 'User.ini')
        return self.s.MAPS_DIR / 'Play' / 'DeusEx.ini', self.s.MAPS_DIR / 'Play' / 'User.ini'

    def assert_players_untouched(self):
        """The player's two files as they were (one they did not have still not there), no activation."""
        for path, data in self.before.items():
            self.assertEqual(path.read_bytes() if path.exists() else None, data, path.name)
        self.assertFalse((self.system() / 'deusedix-project-activation.json').exists())

    def left_long_ago(self, *paths):
        """Files a launch cut short left, older than LAUNCH_AGE."""
        old = time.time() - 3600
        for path in paths:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'left by a launch cut short')
            os.utime(path, (old, old))

    def read_only(self, path):
        """`path` made read-only (as shutil.copy2 copied a read-only user ini), writable again for the clean-up."""
        os.chmod(path, stat.S_IREAD)
        self.addCleanup(lambda: path.exists() and os.chmod(path, stat.S_IREAD | stat.S_IWRITE))

    def held_for_a_moment(self, files, seconds=0.4):
        """Path.unlink as Windows answers it while a scanner reads `files` (what the game wrote as it closed): each one
        refused for `seconds` from now."""
        unlink, until = Path.unlink, time.monotonic() + seconds

        def held(path, *args, **kwargs):
            if path in files and time.monotonic() < until:
                raise PermissionError(32, 'The process cannot access the file because it is being used by another process')
            return unlink(path, *args, **kwargs)
        return patch.object(Path, 'unlink', held)


class LaunchCopiesTests(Game):
    def test_settings_name_the_copies_by_game(self):
        """Revision's launcher reads them by a bare file name of its System folder; the original game's sit in the
        project's folder in the game, under its own names."""
        with patch.object(real_settings, 'GAME', self.game):
            folder = self.game / 'Revision' / 'DeusEdixProjects' / 'p'
            self.assertEqual(real_settings.launch_inis('DeusEdixPlay_p', folder, 'revision'),
                             (self.game / 'Revision/System/DeusEdixPlay_p.ini', self.game / 'Revision/System/DeusEdixPlay_pUser.ini'))
            folder = self.game / 'DeusEdixMods' / 'm'
            self.assertEqual(real_settings.launch_inis('DeusEdixMod', folder, 'vanilla'),
                             (folder / 'Play' / 'DeusEx.ini', folder / 'Play' / 'User.ini'))

    def test_a_revision_play_starts_on_its_own_copies_and_never_writes_the_players(self):
        """T1, T2, T8: the copies in Revision's System folder, the project's folders and save folder in the ini copy,
        the runner and the Console in the user copy; the player's two files and the activation snapshot as they were,
        no backup beside them; the game told of the copies by bare names, INI= before USERINI=."""
        live = self.live
        live.play('10_Map', display_mode='embedded')
        ini, user = self.copies()
        self.assertEqual((ini.parent, ini.name, user.name), (self.system(), 'DeusEdixPlay_p.ini', 'DeusEdixPlay_pUser.ini'))
        text = ini.read_bytes().decode('latin1')
        self.assertEqual(text.count('Paths=..\\DeusEdixProjects\\p\\*.dx\r\n'), 2)
        self.assertEqual(text.count('SavePath=..\\DeusEdixProjects\\p\\Save\r\n'), 2)
        self.assertNotIn('DevMod.UCDevActor', text)                    # a project's Play: owned actors out
        copy = user.read_bytes().decode('latin1')
        self.assertTrue(copy.startswith(PLAYER_USER.decode('latin1').rstrip()))
        self.assertIn(live.RUNNER + '\r\nbActive=True\r\n', copy)
        self.assertIn(live.CONSOLE + '\r\nbActive=True\r\n', copy)
        self.assert_players_untouched()
        self.assertEqual(sorted(p.name for p in self.system().glob('*.bak_shots')), [])
        with patch.object(live.subprocess, 'Popen') as popen:
            self.dispatch('abc123')
        argv = popen.call_args.args[0]
        self.assertEqual(argv[3:], ['10_Map?Mutator=DXP_p.UCMutator?DeusEdixSession=abc123', '-windowed',
                                    'INI=DeusEdixPlay_p.ini,', 'USERINI=DeusEdixPlay_pUser.ini,'])

    def test_a_workspace_play_and_a_live_session_too(self):
        """The working copy (not a project: its own save folder, the development mod's actors kept) and the mapkit
        MCP's live_start (live.start: the runner in live mode) start on copies as well."""
        live = self.use(managed=False, project='legacy')
        with patch.object(live, '_wait_done', return_value={}):
            live.start('10_Map')
        ini, user = self.copies()
        text = ini.read_bytes().decode('latin1')
        self.assertEqual(text.count('SavePath=..\\DeusEdixProjects\\legacy\\Save\r\n'), 2)
        self.assertIn('ServerActors=DevMod.UCDevActor', text)
        self.assertIn('bLive=True', user.read_bytes().decode('latin1'))
        self.assertEqual(ini.name, 'DeusEdixPlay_legacy.ini')
        self.assert_players_untouched()

    def test_the_copies_are_made_fresh_from_the_players_files_at_each_launch(self):
        self.live.play('10_Map')
        self.cleanup()
        self.s.GAME_INI.write_bytes(PLAYER_INI.replace(b'WindowedViewportX=3840', b'WindowedViewportX=2560'))
        self.s.USER_INI.write_bytes(PLAYER_USER.replace(b'F24=', b'F24=Jump'))
        self.before = {path: path.read_bytes() for path in (self.s.GAME_INI, self.s.USER_INI)}
        self.live.play('10_Map')
        ini, user = self.copies()
        self.assertIn(b'WindowedViewportX=2560\r\n', ini.read_bytes())
        self.assertIn(b'F24=Jump\n', user.read_bytes())
        self.assert_players_untouched()

    def live_session(self, live):
        """live.start, as View in game and the mapkit MCP's live_start open the game (its first answer not waited for)."""
        with patch.object(live, '_wait_done', return_value={}):
            live.start('10_Map')

    def show_map(self, live):
        """live.show_map in the running game of a live session: a built map's copy opened through its console, in the
        same game (no launch of its own), its launch copy as it was."""
        built = self.game.parent / '10_Map.dx'
        built.write_bytes(b'a built map')
        copy, steps = self.copies()[0].read_bytes(), []
        with patch.object(live, 'session_status', return_value=dict(owned=True, running=True, stopping=False, error='')), \
                patch.object(live, 'do', side_effect=lambda step, timeout=30: steps.append(step) or ('ready', None)):
            live.show_map('10_Map', built)
        self.assertTrue(steps[0].startswith('console;open UCLive'), steps)
        self.assertEqual(self.copies()[0].read_bytes(), copy)

    def test_every_launch_of_the_editors_is_in_a_window(self):
        """T3, the window rule (29 Oct 2026): Play in the Game view or in the game's own window, a live session (View in
        game, the mapkit MCP's live_start) and a map it shows: StartupFullscreen=False in every client section of the
        copy and DirectDraw off (UseDirectDraw=False, 30 Oct 2026), the lines' CRLF kept, and Revision told -windowed
        (the original game has no such switch), whatever the player chose (True here); the player's own files as they
        were."""
        launches = {'Play in the editor': lambda live: live.play('10_Map', display_mode='embedded'),
                    'Play in game window': lambda live: live.play('10_Map', display_mode='external'),
                    'View in game, live_start': self.live_session,
                    'a map shown in it': lambda live: (self.live_session(live), self.show_map(live))}
        for target, words in (('revision', ['-windowed']), ('vanilla', [])):
            for kind, launch in launches.items():
                with self.subTest(game=target, launch=kind):
                    live = self.use(target)
                    launch(live)
                    data = self.copies()[0].read_bytes()
                    self.assertGreater(data.count(b'StartupFullscreen=False\r\n'), 0)
                    self.assertEqual(data.count(b'StartupFullscreen='), data.count(b'StartupFullscreen=False\r\n'))
                    # and DirectDraw off, which the original game's start-up waited on for 17-33 s (30 Oct 2026)
                    self.assertEqual(data.count(b'UseDirectDraw='), data.count(b'UseDirectDraw=False\r\n'))
                    self.assertGreater(data.count(b'UseDirectDraw=False\r\n'), 0)
                    self.assertEqual(data.count(b'\n'), data.count(b'\r\n'))
                    with patch.object(live.subprocess, 'Popen') as popen:
                        self.dispatch('abc123')
                    self.assertEqual(popen.call_args.args[0][4:-2], words)
                    self.assert_players_untouched()

    def test_the_original_game_is_told_of_its_copies_by_a_path_as_before(self):
        live = self.use('vanilla')
        live.play('10_Map')
        with patch.object(live.subprocess, 'Popen') as popen:
            self.dispatch('abc123')
        self.assertEqual(popen.call_args.args[0][3:], ['10_Map?Mutator=DXP_p.UCMutator?DeusEdixSession=abc123',
                                                        'INI=..\\DeusEdixProjects\\p\\Play\\DeusEx.ini,',
                                                        'USERINI=..\\DeusEdixProjects\\p\\Play\\User.ini,'])

    def test_the_game_closed_its_copies_go(self):
        """T4: after the game (which wrote into its user copy), both copies and the Console's command file are gone;
        the player's files as they were."""
        self.live.play('10_Map')
        self.copies()[1].write_bytes(self.copies()[1].read_bytes() + b'lastPlayedMap=10_Map\r\n')   # the game's own write
        self.cleanup()
        for path in self.copies() + (self.live.CONSOLE_CMD,):
            self.assertFalse(path.exists(), path.name)
        self.assert_players_untouched()

    def test_an_install_stays_after_a_play(self):
        """T4: the project's Install (its folders and save folder in Revision.ini, the snapshot) is as it was after a
        Play of it: a Play no longer deactivates the project at its end."""
        self.pg.activate(['Paths=..\\DeusEdixProjects\\p\\*.dx', 'Paths=..\\DeusEdixProjects\\p\\*.u'])  # an Install
        installed = self.s.GAME_INI.read_bytes()
        snapshot = (self.system() / 'deusedix-project-activation.json').read_bytes()
        self.assertIn(b'DeusEdixProjects\\p\\*.dx', installed)
        self.live.play('10_Map')
        self.cleanup()
        self.assertEqual(self.s.GAME_INI.read_bytes(), installed)
        self.assertEqual((self.system() / 'deusedix-project-activation.json').read_bytes(), snapshot)
        self.assertEqual(self.s.USER_INI.read_bytes(), PLAYER_USER)

    def test_no_backup_is_left_beside_the_inis(self):
        """T8: a Play makes no .bak_shots (its runner's section is in the copy) and leaves nothing new in System but
        what the game's own files were."""
        system = set(self.system().iterdir())
        self.live.play('10_Map', commands=['god'])
        self.cleanup()
        self.assertEqual(sorted(p.name for p in set(self.system().iterdir()) - system), [])
        self.assert_players_untouched()

    def test_the_start_up_tidies_what_a_launch_cut_short_left_once_nothing_can_use_it(self):
        """Game test defects 5 and 4, review #14 (29 Oct 2026): the start-up's tidy (tidy_cut_short: the editor's worker,
        the mapkit MCP) removes what a launch whose game no editor saw close left: this project's copies, the runner's
        live channel it rewrote, the Console's command file with Stop's 'exit' in it, the loadout, and a mod's game's
        copies from the Mods panel; only once no game runs and each is older than LAUNCH_AGE (a game running, or a file
        a launch may be starting on, keeps it). Another project's copies and the player's files are never touched."""
        live = self.live
        (self.mods.mods_root('revision') / 'my-mod').mkdir(parents=True)              # a mod installed, played before
        left = self.copies() + (live.CMD, live.CONSOLE_CMD, live.LOADOUT,
                                self.system() / 'DeusEdixMod.ini', self.system() / 'DeusEdixModUser.ini')
        other = (self.system() / 'DeusEdixPlay_q.ini', self.system() / 'DeusEdixPlay_qUser.ini')
        self.left_long_ago(*left + other)
        games = []
        live._SESSION = GameSession(types.SimpleNamespace(list=lambda: games), launch_timeout=0.2, poll=0.005)
        games.append('a game')
        self.assertEqual(live.tidy_cut_short(), [])
        self.assertTrue(all(path.exists() for path in left))
        games.clear()
        os.utime(left[0], None)                                              # just written: a launch may be starting
        self.assertEqual(sorted(live.tidy_cut_short()), sorted(left[1:]))
        self.assertTrue(left[0].exists())
        os.utime(left[0], (time.time() - 3600,) * 2)
        self.assertEqual(live.tidy_cut_short(), [left[0]])
        self.assertTrue(all(path.exists() for path in other))
        self.assert_players_untouched()

    def test_an_original_game_mods_copies_in_its_folder_go_too(self):
        """Game test defect 4: the original game's mod copies are in the mod's own folder (settings.launch_inis)."""
        live = self.use('vanilla')
        folder = self.mods.mods_root('vanilla') / 'my-mod'
        left = (folder / 'Play' / 'DeusEx.ini', folder / 'Play' / 'User.ini')
        self.left_long_ago(*left)
        live._SESSION = GameSession(types.SimpleNamespace(list=lambda: []), launch_timeout=0.2, poll=0.005)
        self.assertEqual(sorted(live.tidy_cut_short()), sorted(left))

    def test_revisions_mod_copies_go_with_no_mod_installed(self):
        """Review 2c #6: Revision's mod copies are the same two in its System folder for every mod
        (settings.launch_inis), so a mod played and then uninstalled (the last one) left them with no mod folder to find
        them by: the start-up's tidy removes them all the same."""
        left = (self.system() / 'DeusEdixMod.ini', self.system() / 'DeusEdixModUser.ini')
        self.left_long_ago(*left)
        self.assertFalse(self.mods.mods_root('revision').exists())                     # no mod installed
        self.live._SESSION = GameSession(types.SimpleNamespace(list=lambda: []), launch_timeout=0.2, poll=0.005)
        self.assertEqual(sorted(self.live.tidy_cut_short()), sorted(left))

    def test_stop_never_tidies_up_after_a_launch_cut_short(self):
        """Review #14: one function per job. stop() with no launch of this editor's removes nothing (before, it removed
        the stale copies, and the editor's start-up got its tidy only as a side effect of calling it)."""
        live = self.live
        self.left_long_ago(*self.copies())
        live._SESSION = GameSession(types.SimpleNamespace(list=lambda: []), launch_timeout=0.2, poll=0.005)
        self.assertEqual(live.stop(), 'stopped')
        self.assertTrue(all(path.exists() for path in self.copies()))

    def test_a_file_held_now_stays_for_the_next_start_and_the_start_up_never_waits_on_it(self):
        """Review #1: the start-up's tidy removes with no wait (the project is opening): a file Windows refuses to remove
        now (an antivirus scanning it) stays for the next start, the rest go, and the start-up goes on."""
        live = self.live
        ini, user = self.copies()
        self.left_long_ago(ini, user)
        live._SESSION = GameSession(types.SimpleNamespace(list=lambda: []), launch_timeout=0.2, poll=0.005)
        unlink = Path.unlink

        def busy(path, *args, **kwargs):
            if path == ini:
                raise PermissionError(32, 'The process cannot access the file because it is being used by another process')
            return unlink(path, *args, **kwargs)
        with patch.object(Path, 'unlink', busy):
            t0 = time.monotonic()
            self.assertEqual(live.tidy_cut_short(), [user])
            self.assertLess(time.monotonic() - t0, 0.5)
        self.assertTrue(ini.exists())
        self.assertEqual(live.tidy_cut_short(), [ini])

    def test_the_cleanup_waits_out_a_file_held_for_a_moment(self):
        """Review #1: the game writes its copies as it closes and the cleanup runs at once, when a scanner may be reading
        them: each removal of the cleanup (the copies, the Console's command file, the loadout) is tried again for a
        moment, as every write is (project_game.remove), instead of failing at once."""
        self.live.play('10_Map', commands=['god'])
        files = self.copies() + (self.live.CONSOLE_CMD, self.live.LOADOUT)
        self.assertTrue(all(path.exists() for path in files))
        with self.held_for_a_moment(files):
            self.cleanup()
        self.assertFalse(any(path.exists() for path in files))
        self.assert_players_untouched()
        path = self.system() / 'Held.ini'
        path.write_bytes(b'x')
        with patch.object(Path, 'unlink', side_effect=PermissionError(32, 'in use')), self.assertRaises(PermissionError):
            self.pg.remove(path, wait=0.2)                                  # held for good: the error, after the wait

    def test_a_live_sessions_cleanup_waits_out_its_live_channel_held_for_a_moment(self):
        """Review 2c #10: a live session (View in game, the mapkit MCP's live_start) writes the runner's live channel
        (UCLive.txt), which no file was before it: its cleanup removes it, waiting out a hold for a moment as its other
        removals do (project_game.remove)."""
        self.assertFalse(self.live.CMD.exists())
        self.live_session(self.live)
        files = self.copies() + (self.live.CMD, self.live.CONSOLE_CMD)
        self.assertTrue(all(path.exists() for path in files))
        with self.held_for_a_moment((self.live.CMD,)):              # alone: no removal before it waits the hold out
            self.cleanup()
        self.assertFalse(any(path.exists() for path in files))
        self.assert_players_untouched()

    def test_the_cleanup_removes_the_mark_of_a_game_closed_from_outside_and_the_start_up_leaves_one_alone(self):
        """Game test D2 (the second of 29 Oct 2026): a game closed from outside (a Stop of a game stopped in its error
        box, the editor's process ending and its game with it) leaves System\\Running.ini, and the next start, Steam's
        too, stops on the Recovery Mode dialog. The session's cleanup, which runs only once this launch's game has
        ended, removes it, waiting out a hold for a moment as its other removals do (review 2d #4); the start-up's tidy,
        which cannot tell it from the mark of the player's own game that crashed, leaves one alone."""
        mark = self.system() / 'Running.ini'
        self.live.play('10_Map')
        mark.write_bytes(b'[Running]\r\n')                              # the game's, closed from outside
        with self.held_for_a_moment((mark,)):                           # a scanner reading it as the game ended
            self.cleanup()
        self.assertFalse(mark.exists())
        self.left_long_ago(mark)
        self.live._SESSION = GameSession(types.SimpleNamespace(list=lambda: []), launch_timeout=0.2, poll=0.005)
        self.assertEqual(self.live.tidy_cut_short(), [])
        self.assertTrue(mark.exists())
        self.assert_players_untouched()

    def test_a_mark_held_past_the_wait_stays_alone_and_stops_retry_removes_it(self):
        """Review 2d #5: Running.ini is the game's file: the cleanup removes it last, so one held past the wait (a
        scanner keeping it open) is all that stays, never DeusEdix's own files with it. The error says Play could not
        tidy up, and Stop's retry runs the cleanup again."""
        mark = self.system() / 'Running.ini'
        self.live.play('10_Map', commands=['god'])
        mark.write_bytes(b'[Running]\r\n')
        files = self.copies() + (self.live.CONSOLE_CMD, self.live.LOADOUT)
        remove = self.pg.remove
        with self.held_for_a_moment((mark,), seconds=60), \
                patch.object(self.pg, 'remove', lambda path, wait=0.2: remove(path, wait)), \
                self.assertRaises(PermissionError):                     # held past a short wait
            self.cleanup()
        self.assertFalse(any(path.exists() for path in files))
        self.assertTrue(mark.exists())
        self.cleanup()                                                  # Stop's retry, the file let go
        self.assertFalse(mark.exists())
        self.assert_players_untouched()

    def test_the_start_and_the_cleanup_remove_the_mark_of_the_system_folder_live_names_then(self):
        """Review 2f #3: live names the game's mark (_running_mark) from SYS at each call, never from a copy made at
        import. The tests that patch.multiple(live, SYS=...) on the kit's own live, made on the real settings, start
        and clean up launches with no game running: a copy made at import would remove the Running.ini of the player's
        real game there. Here the System folder live was made on stands for the player's, and keeps its mark."""
        other = self.game.parent / 'System'
        other.mkdir()
        players, mark = self.system() / 'Running.ini', other / 'Running.ini'
        for path in (players, mark):
            path.write_bytes(b'[Running]\r\n')
        self.stack.enter_context(patch.object(self.live, 'SYS', other))
        self.live.play('10_Map')
        self.assertFalse(mark.exists())                                 # a stale mark: no game running
        mark.write_bytes(b'[Running]\r\n')                              # the game's, closed from outside
        self.cleanup()
        self.assertFalse(mark.exists())
        self.assertTrue(players.exists())
        self.assert_players_untouched()

    def test_a_read_only_copy_an_older_play_left_is_written_over_and_removed(self):
        """Review #5: a Play before 29 Oct 2026 copied a player's read-only user ini with its attribute and left it: every
        later Play of the project failed on it, and the start-up could not remove it. DeusEdix's own launch copies are
        made writable before they are written over or removed. A player's own read-only file stays read-only (an
        Install's write still fails on it), and a write that fails leaves no temporary file beside it."""
        live = self.use('vanilla')
        ini, user = self.copies()
        user.parent.mkdir(parents=True)
        user.write_bytes(b'[Engine.Input]\r\nF24=\r\n')
        self.read_only(user)
        live.play('10_Map')
        self.assertIn(live.RUNNER.encode(), user.read_bytes())
        self.left_long_ago(ini, user)
        self.read_only(user)
        live._SESSION = GameSession(types.SimpleNamespace(list=lambda: []), launch_timeout=0.2, poll=0.005)
        self.assertIn(user, live.tidy_cut_short())
        self.assertFalse(user.exists())
        self.read_only(self.s.GAME_INI)
        with self.assertRaises(PermissionError):
            self.pg.write_file(self.s.GAME_INI, b'[Core.System]\r\n', wait=0.1)
        self.assertFalse(os.stat(self.s.GAME_INI).st_mode & stat.S_IWRITE)
        self.assertEqual([p.name for p in self.system().glob('*.deusedix-tmp')], [])

    def test_a_prepare_that_fails_after_the_copies_removes_them(self):
        """Review #9: `prepared` is set before the copies are written, so a prepare that fails after them (the user copy
        held past REPLACE_WAIT, so the Console's section cannot go in) leaves nothing in System: the session's cleanup
        removes them."""
        live = self.live
        live._SESSION = GameSession(FakeProcesses(), launch_timeout=0.2, poll=0.005)
        with patch.object(live, '_set_console', side_effect=PermissionError(13, 'in use')), \
                self.assertRaises(PermissionError):
            live.play('10_Map')
        self.assertFalse(any(path.exists() for path in self.copies()))
        self.assert_players_untouched()

    def test_an_installs_snapshot_waits_out_a_sharing_violation_too(self):
        """Review #9: the activation snapshot (_save_state: the player's SavePath brought up to date at an Install) goes
        through write_file like every write of a game's file: a refusal for a moment is waited out."""
        self.use(managed=False, project='legacy')
        snapshot = self.system() / 'deusedix-project-activation.json'
        self.pg.activate(['Paths=..\\DeusEdixMaps\\*.dx'])
        self.s.GAME_INI.write_bytes(self.s.GAME_INI.read_bytes().replace(b'SavePath=..\\Save', b'SavePath=..\\MySaves'))
        real, refused = os.replace, []

        def busy_once(src, dst):
            if Path(dst) == snapshot and not refused:
                refused.append(dst)
                raise PermissionError(13, 'The process cannot access the file')
            return real(src, dst)
        with patch.object(self.pg.os, 'replace', busy_once):
            self.pg.activate(['Paths=..\\DeusEdixMaps\\*.dx'])
        self.assertEqual(len(refused), 1)
        self.assertIn('MySaves', snapshot.read_text(encoding='utf-8'))

    def test_every_replace_waits_out_a_sharing_violation(self):
        """Windows refuses a replace while another program (an antivirus, the game) holds the file: tried again for a
        moment, then the error; a launch's prepare and its files go through it, written as bytes (CRLF, never CR CR LF)."""
        real, refused = os.replace, []

        def busy_once(src, dst):
            if dst not in refused:
                refused.append(dst)
                raise PermissionError(13, 'The process cannot access the file')
            return real(src, dst)
        with patch.object(self.pg.os, 'replace', busy_once):
            self.live.play('10_Map', commands=['god'])
            self.pg._write(self.s.GAME_INI, '[Core.System]\r\n')
        self.assertGreaterEqual(len(refused), 5)
        self.assertEqual(self.s.GAME_INI.read_bytes(), b'[Core.System]\r\n')
        self.live._write_cmd(['set UCShotRunner LiveSeq 1'])
        self.assertEqual(self.live.CMD.read_bytes(), b'set UCShotRunner LiveSeq 1\r\n')
        path = self.system() / 'Busy.ini'
        with patch.object(self.pg.os, 'replace', side_effect=PermissionError(13, 'in use')):
            t0 = time.monotonic()
            with self.assertRaises(PermissionError):
                self.pg.write_file(path, b'x', wait=0.3)
            self.assertLess(time.monotonic() - t0, 2)
            self.assertGreaterEqual(time.monotonic() - t0, 0.25)


class StopTests(Game):
    """T9: Stop asks the game's own exit through UCConsoleLink's command file (read in a Play whose runner has
    switched itself off too), and only a game still open is closed from outside."""
    def setUp(self):
        super().setUp()
        self.processes = FakeProcesses()
        self.live._SESSION = GameSession(self.processes, launch_timeout=0.5, poll=0.005)
        self.live.EXIT_WAIT = 1.0

        def dispatch(argv, **kwargs):
            token = next(a for a in argv if '?DeusEdixSession=' in a).split('?DeusEdixSession=')[1]
            self.processes.add(token)
        self.stack.enter_context(patch.object(self.live.subprocess, 'Popen', side_effect=dispatch))
        self.live.play('10_Map')
        deadline = time.monotonic() + 2
        while not self.live.session_status()['owned']:
            self.assertLess(time.monotonic(), deadline, 'the launch was not claimed')
            time.sleep(0.005)

    def tearDown(self):
        self.processes.identities.clear()
        self.live._SESSION.stop(timeout=0)

    def game_quits_on(self, line):
        """The game: quits by itself (its process gone) once the Console's command file holds `line`."""
        done = threading.Event()
        self.addCleanup(done.set)

        def game():
            while not done.wait(0.01):
                try:
                    text = self.live.CONSOLE_CMD.read_bytes().decode('latin1')
                except OSError:
                    continue
                if line in text:
                    self.processes.identities.clear()
                    return
        threading.Thread(target=game, daemon=True).start()

    def test_a_play_closes_by_its_own_exit_and_nothing_closes_it_from_outside(self):
        self.game_quits_on('set UCConsoleLink Cmd exit\r\n')
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertLess(time.monotonic() - t0, 1.0)
        self.assertEqual(self.processes.closed, [])                      # no WM_CLOSE, no TerminateProcess
        self.assertFalse(any(path.exists() for path in self.copies()))
        self.assert_players_untouched()

    def stop_in_time(self, seconds=6, **kwargs):
        """live.stop(**kwargs) in a thread: its answer, or None while it is still waiting after `seconds` (a Stop that
        never ends holds the editor's LOCK; tearDown ends the game, and with it the wait)."""
        answer = []
        stopper = threading.Thread(target=lambda: answer.append(self.live.stop(**kwargs)), daemon=True)
        stopper.start()
        stopper.join(seconds)
        return answer[0] if answer else None

    def console_saved(self, **values):
        """The Console's section of the user copy with these values (Seq, Done), as UCConsoleLink saves it."""
        user = self.copies()[1]
        data = user.read_bytes()
        for key, value in values.items():
            data = re.sub(rb'(?m)^%s=\d+' % key.encode(), b'%s=%d' % (key.encode(), value), data)
        user.write_bytes(data)

    def game_answers_then_quits(self, after, busy=0.0, runs_exit=True, saves=True):
        """The game, as UCConsoleLink saves into its section of the user copy: Seq once it has read a line of the
        Console's command file, Done once it has run it. It reads the 'exit' and runs it (not `runs_exit`: it saves Seq
        only, as the original game did after a ToggleFullscreen in the third game test of 29 Oct 2026; not `saves`,
        neither, its saves lost as in e1c, e2b and e3c of the fourth), removes System\\Running.ini if it has one, then
        quits `after` seconds later (leaving exclusive full screen); with `busy`, only that long from now, inside the
        line before until then (read, not run: the original game in the page's ToggleFullscreen, 8-14 s)."""
        done, start = threading.Event(), time.monotonic()
        self.addCleanup(done.set)
        if busy:
            self.console_saved(Seq=self.live.STATE['console'])

        def game():
            while not done.wait(0.01):
                if time.monotonic() < start + busy:
                    continue
                try:
                    seq = re.search(rb'Cmd exit\r\nset UCConsoleLink Seq (\d+)', self.live.CONSOLE_CMD.read_bytes())
                except OSError:
                    continue
                if seq:
                    n = int(seq.group(1))
                    if saves:
                        self.console_saved(Seq=n, Done=n if runs_exit else n - 1)
                    (self.system() / 'Running.ini').unlink(missing_ok=True)
                    if not done.wait(after):
                        self.processes.identities.clear()
                    return
        threading.Thread(target=game, daemon=True).start()

    def test_a_game_that_answered_the_exit_is_given_time_to_close_by_itself(self):
        """Game test defect 2 (29 Oct 2026): a full-screen game read 'exit' at once but took 4.9-5.4 s to leave exclusive
        full screen, past EXIT_WAIT, and Stop went on to close it from outside while it closed. Once the game has
        answered the line (its Console's Done), Stop waits up to EXIT_WAIT_TAKEN, and nothing closes it from outside."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        self.game_answers_then_quits(0.8)
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertGreater(time.monotonic() - t0, 0.7)
        self.assertEqual(self.processes.closed, [])
        self.assertFalse(any(path.exists() for path in self.copies()))

    def test_an_embedded_stop_that_only_asks_hands_an_answered_game_back_after_exit_wait(self):
        """The longer wait is a Stop's that may close the game: the page's embedded Stop only asks first (force=False),
        and a game still open after EXIT_WAIT may be held up by the editor's window, its parent: STILL_OPEN then, so the
        page hands it back, and its next Stop gives an answered exit its time
        (test_a_later_stop_gives_an_exit_the_game_answered_its_time)."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        self.game_answers_then_quits(0.8)
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(force=False), self.live.STILL_OPEN)
        self.assertLess(time.monotonic() - t0, 0.7)
        self.assertEqual(self.processes.closed, [])

    def test_a_game_that_never_answered_is_closed_from_outside_after_exit_wait(self):
        """A game that never takes the exit (its Console link not ticking: an error box) is closed from outside after
        EXIT_WAIT, as before: the longer wait is only for a game that answered."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertLess(time.monotonic() - t0, 1.5)
        self.assertEqual(len(self.processes.closed), 1)

    def test_a_console_still_inside_an_earlier_line_is_given_time_to_read_the_exit(self):
        """Game test D1 (the second of 29 Oct 2026): the original game spent 8-14 s in the page's ToggleFullscreen, read
        Stop's 'exit' only after EXIT_WAIT and was closed from outside while it closed itself. While the console is
        still inside an earlier line (Done below the line before the 'exit'), Stop waits up to EXIT_WAIT_TAKEN from the
        request; once the game answers, up to EXIT_WAIT_TAKEN from that answer (review 2c #0: counted from the request,
        a game leaving full screen after a long toggle was closed from outside all the same)."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 1.5
        self.assertIsNone(self.live.console('ToggleFullscreen', timeout=0))       # sent, not answered yet
        self.game_answers_then_quits(0.6, busy=1.3)
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertGreater(time.monotonic() - t0, 1.5)
        self.assertEqual(self.processes.closed, [])

    def test_a_console_done_with_its_earlier_lines_is_not_waited_for_longer(self):
        """The longer wait is only for a console still inside an earlier line: one that answered every line before the
        'exit' and never answers that (its link stopped) is closed from outside after EXIT_WAIT, as before."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        self.live.console('summon MedKit', timeout=0)
        self.console_saved(Seq=1, Done=1)                               # the game answered it
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertLess(time.monotonic() - t0, 1.5)
        self.assertEqual(len(self.processes.closed), 1)

    def test_a_game_that_only_read_the_exit_is_given_time_to_close_by_itself(self):
        """Review 2d #0 (O1 of the third game test of 29 Oct 2026): UCConsoleLink tries to save Seq when it reads a line
        and Done when it has run it, but the game can lose either save, so a missing Seq is no proof that the line was
        not read (review 2e #5); the original game, after a ToggleFullscreen, saved Seq for Stop's 'exit' and never
        Done, and ended by itself 3-4 s later. Reading the line is its answer: Stop waits up to EXIT_WAIT_TAKEN from it,
        and nothing closes the game from outside."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        self.game_answers_then_quits(0.8, runs_exit=False)
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertGreater(time.monotonic() - t0, 0.7)
        self.assertEqual(self.processes.closed, [])

    def test_a_game_that_read_the_exit_after_a_busy_console_is_given_time_to_close_by_itself(self):
        """Review 2d #0, as d1v2 of the third game test of 29 Oct 2026: the console inside the page's ToggleFullscreen
        (Seq 1, Done 0) past EXIT_WAIT, then the toggle run and the 'exit' read (Seq 2, Done 1, never Done 2), and the
        game ends by itself past EXIT_WAIT_TAKEN from the request: Stop counts from the reading, and nothing closes it
        from outside."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 1.5
        self.assertIsNone(self.live.console('ToggleFullscreen', timeout=0))       # sent, not answered yet
        self.game_answers_then_quits(0.6, busy=1.3, runs_exit=False)
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertGreater(time.monotonic() - t0, 1.5)
        self.assertEqual(self.processes.closed, [])

    def test_a_line_read_but_not_the_exit_is_no_answer(self):
        """Review 2d #0's guard: Seq at the line before the 'exit' with Done below it is the console still inside that
        line (read, not run), not an answer to the 'exit': a game that stays there is closed from outside
        EXIT_WAIT_TAKEN after the request."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 1.0
        self.live.console('ToggleFullscreen', timeout=0)
        self.console_saved(Seq=1)
        t0 = time.monotonic()
        self.assertEqual(self.stop_in_time(), 'stopped')
        self.assertIsNone(self.live.STATE['exit_answered'])
        self.assertGreater(time.monotonic() - t0, 0.9)
        self.assertEqual(len(self.processes.closed), 1)

    def test_a_console_seen_busy_keeps_its_wait_when_it_frees_with_no_answer_to_the_exit(self):
        """Review 2d #2's guard: once the console has been seen inside the line before the 'exit', a patient Stop waits
        up to EXIT_WAIT_TAKEN from the request even if the console then frees and nothing answers the 'exit' (no Seq
        either): a game that ends by itself in that time is not closed from outside."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        self.live.console('ToggleFullscreen', timeout=0)

        def game():
            time.sleep(1.0)
            self.console_saved(Seq=1, Done=1)                           # the toggle run, the 'exit' not read
            time.sleep(0.6)
            self.processes.identities.clear()                           # gone by itself
        threading.Thread(target=game, daemon=True).start()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertEqual(self.processes.closed, [])

    def test_a_console_busy_for_good_is_closed_after_exit_wait_taken_from_the_request(self):
        """Review 2d #1: a game that died inside the line before the 'exit' (c3 of the second game test of 29 Oct 2026:
        its error box up, its process alive) never frees its console. A patient Stop (a page reloaded while the error
        box is up, the MCP's live_stop) closes it from outside EXIT_WAIT_TAKEN after the request, not later: the route
        holds the editor's LOCK while it waits."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 1.0
        self.live.console('ToggleFullscreen', timeout=0)
        self.assertEqual(self.stop_in_time(), 'stopped')                # None: still waiting after 6 s
        self.assertEqual(len(self.processes.closed), 1)

    def test_the_pages_first_stop_hands_a_busy_game_back_after_exit_wait(self):
        """Review 2d #1: the longer wait for a busy console is a patient Stop's only: the page's embedded Stop
        (force=False) answers STILL_OPEN after EXIT_WAIT, as for any game still open."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        self.live.console('ToggleFullscreen', timeout=0)
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(force=False), self.live.STILL_OPEN)
        self.assertLess(time.monotonic() - t0, 1.0)

    def test_a_console_that_cannot_be_read_is_not_busy(self):
        """Review 2d #1: a section that cannot be read (gone from the copy) says nothing of the console: no longer wait,
        closed from outside after EXIT_WAIT."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        self.live.console('ToggleFullscreen', timeout=0)
        user = self.copies()[1]
        user.write_bytes(self.live._CONSOLE_SECTION.sub('', user.read_bytes().decode('latin1')).encode('latin1'))
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertLess(time.monotonic() - t0, 1.5)

    def test_a_later_stop_gives_an_exit_the_game_answered_its_time(self):
        """Review 2c #1: the page's first Stop only asks (force=False, not patient). A game that answered the 'exit' at
        once but is still closing after EXIT_WAIT (a window left alone in full screen outside the panel took 3.4-5.4 s)
        gets STILL_OPEN; the page's next Stop ({token}) writes no second 'exit' and waits on the answer the first one
        recorded, up to EXIT_WAIT_TAKEN from it: nothing closes the game from outside. An exit nobody answered, with a
        console that was never busy, is not waited for again
        (test_only_asked_a_game_still_open_stays_open_until_a_stop_that_may_close_it)."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        self.game_answers_then_quits(0.8)
        self.assertEqual(self.live.stop(force=False), self.live.STILL_OPEN)
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertEqual(self.processes.closed, [])
        self.assertEqual(self.live.STATE['console'], 1)                   # one line in this launch: the 'exit'

    def test_a_later_stop_counts_from_the_first_answer_whichever_stop_saw_it(self):
        """Review 2c #1: the first Stop records the game's answer even when it only asks (not patient), and a later Stop
        waits up to EXIT_WAIT_TAKEN from that answer, not from itself: a game that answered and never ends (hung while
        closing) is closed from outside then, not EXIT_WAIT_TAKEN after each Stop."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 1.0, 1.5
        self.game_answers_then_quits(30)
        self.assertEqual(self.live.stop(force=False), self.live.STILL_OPEN)          # answered at once, 1.0 s ago
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertLess(time.monotonic() - t0, 1.1)
        self.assertEqual(len(self.processes.closed), 1)

    def test_a_later_stop_gives_an_exit_the_game_only_read_its_time(self):
        """Review 2d #0: the page's first Stop (force=False, not patient) records a reading of the 'exit' (Seq) as the
        game's answer and still hands the game back after EXIT_WAIT; its next Stop waits on that answer, and nothing
        closes the game from outside."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        self.game_answers_then_quits(0.8, runs_exit=False)
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(force=False), self.live.STILL_OPEN)
        self.assertLess(time.monotonic() - t0, 0.7)
        self.assertIsNotNone(self.live.STATE['exit_answered'])
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertEqual(self.processes.closed, [])

    def test_a_game_whose_saves_were_lost_answers_by_removing_its_running_ini(self):
        """Review 2e #0 (F1 of the fourth game test of 29 Oct 2026, e1c and e3c): in exclusive full screen the original
        game ran Stop's 'exit' and saved neither Seq nor Done (another program reading the copy refuses its saves), but
        removed System\\Running.ini, the mark it made as it started, every time. That removal is its answer: a patient
        Stop (external Play's, the MCP's live_stop) waits up to EXIT_WAIT_TAKEN from it, and nothing closes the game
        from outside."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        (self.system() / 'Running.ini').write_bytes(b'[Running]\r\n')     # made by the game as it started
        self.game_answers_then_quits(0.8, saves=False)
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertGreater(time.monotonic() - t0, 0.7)
        self.assertEqual(self.processes.closed, [])

    def test_a_later_stop_waits_on_a_removal_of_running_ini_the_first_one_saw(self):
        """Review 2e #0, the page's two Stops: the first (force=False, not patient) records the removal of Running.ini
        as the game's answer and still hands the game back after EXIT_WAIT; the next ({token}) waits on that answer.
        Before, it found no answer and closed the game from outside at once, while the game was closing by itself."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        (self.system() / 'Running.ini').write_bytes(b'[Running]\r\n')
        self.game_answers_then_quits(0.8, saves=False)
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(force=False), self.live.STILL_OPEN)
        self.assertLess(time.monotonic() - t0, 0.7)
        self.assertIsNotNone(self.live.STATE['exit_answered'])
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertEqual(self.processes.closed, [])

    def test_a_later_stop_counts_a_removal_of_running_ini_made_after_the_first_one_returned(self):
        """Review 2f #2: the mark is the request's, noted once as Stop writes the 'exit', not again by each Stop. The
        page's first Stop (force=False) returns STILL_OPEN with no answer yet; the game then removes the Running.ini it
        had at the request and quits 0.8 s later, saving nothing. The next Stop ({token}) counts that removal as the
        game's answer and waits on it. A Stop that noted the mark again would find none, then no answer, and close the
        game from outside as it closed itself (f2i of the game test of 30 Oct 2026 came close: the game answered 0.23 s
        before the first Stop's EXIT_WAIT ended, and the second Stop began 0.085 s after the first returned)."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        mark = self.system() / 'Running.ini'
        mark.write_bytes(b'[Running]\r\n')                              # made by the game as it started
        self.assertEqual(self.live.stop(force=False), self.live.STILL_OPEN)
        self.assertIsNone(self.live.STATE['exit_answered'])
        mark.unlink()                                                   # the game runs the 'exit'
        timer = threading.Timer(0.8, self.processes.identities.clear)   # and quits by itself
        self.addCleanup(timer.cancel)
        timer.start()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertIsNotNone(self.live.STATE['exit_answered'])
        self.assertEqual(self.processes.closed, [])

    def test_a_game_that_made_no_running_ini_gives_no_answer_by_its_absence(self):
        """Review 2e #0's guard: the removal counts only for a mark there at the request. A game that made none (no
        Running.ini when Stop asked) and saves no answer is closed from outside after EXIT_WAIT, as before."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        self.game_answers_then_quits(2.0, saves=False)
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertLess(time.monotonic() - t0, 1.5)
        self.assertIsNone(self.live.STATE['exit_answered'])
        self.assertEqual(len(self.processes.closed), 1)

    def test_a_game_in_its_error_box_keeps_its_running_ini_and_gives_no_answer(self):
        """Review 2e #0's guard: a game stopped in its error box never takes the 'exit' and keeps its Running.ini (e4 of
        the fourth game test of 29 Oct 2026, until the cleanup): the mark still there is no answer, and the game is
        closed from outside after EXIT_WAIT."""
        self.live.EXIT_WAIT, self.live.EXIT_WAIT_TAKEN = 0.3, 3.0
        (self.system() / 'Running.ini').write_bytes(b'[Running]\r\n')
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertLess(time.monotonic() - t0, 1.5)
        self.assertIsNone(self.live.STATE['exit_answered'])
        self.assertEqual(len(self.processes.closed), 1)

    def test_a_stop_that_only_asks_asks_whatever_ask_says(self):
        """Review 2c #4 (a regression of 2c's ask): force=False promises only asking. With ask=False too (an API
        client's pair; the page never sends both) Stop went straight to the close from outside, which an embedded game's
        child window never gets (TerminateProcess after 3 s, Running.ini left): it asks, and a game still open stays
        open."""
        self.live.EXIT_WAIT = 0.3
        self.assertEqual(self.live.stop(force=False, ask=False), self.live.STILL_OPEN)
        self.assertEqual(self.processes.closed, [])
        self.assertTrue(self.live.session_status()['running'])
        self.assertIn(b'Cmd exit\r\n', self.live.CONSOLE_CMD.read_bytes())

    def test_a_game_that_can_no_longer_answer_is_closed_at_once_unasked(self):
        """fix2c_front.md section 6: ask=False (the page's Stop of a game stopped in its error box) writes no 'exit'
        and does not wait EXIT_WAIT for a console that no longer runs: closed from outside at once."""
        self.live.EXIT_WAIT = 3.0
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(ask=False), 'stopped')
        self.assertLess(time.monotonic() - t0, 1.5)
        self.assertEqual(len(self.processes.closed), 1)
        self.assertFalse(self.live.CONSOLE_CMD.exists() and b'Cmd exit' in self.live.CONSOLE_CMD.read_bytes())

    def test_a_console_line_never_takes_the_place_of_stops_exit(self):
        """Review #2: the Console's command file holds one line. Once Stop has asked the game to quit, a Console line
        would replace 'exit' before the game read it, and Stop would wait for nothing: refused, and 'exit' stays."""
        self.assertEqual(self.live.stop(force=False), self.live.STILL_OPEN)
        with self.assertRaisesRegex(RuntimeError, 'closing'):
            self.live.console('summon MedKit', timeout=0.2)
        self.assertIn(b'Cmd exit\r\n', self.live.CONSOLE_CMD.read_bytes())

    def test_one_writer_of_the_console_at_a_time(self):
        """Review #2: a Console line and Stop's 'exit' written at the same moment by two threads that do not hold the
        server's lock (a script calling live directly: the editor's routes are serialised by its LOCK) go one after the
        other: never two writers of the command file and its temporary copy at once."""
        real, writers, most = self.pg.write_file, [], [0]

        def slow_write(path, data, wait=2.0):
            if path != self.live.CONSOLE_CMD:
                return real(path, data, wait)
            writers.append(path)
            most[0] = max(most[0], len(writers))
            time.sleep(0.1)
            try:
                return real(path, data, wait)
            finally:
                writers.pop()
        with patch.object(self.pg, 'write_file', slow_write):
            line = threading.Thread(target=lambda: self.live.console('summon MedKit', timeout=0.3), daemon=True)
            line.start()
            time.sleep(0.03)
            self.live.stop(force=False)
            line.join(2)
        self.assertEqual(most[0], 1)
        self.assertIn(b'Cmd exit\r\n', self.live.CONSOLE_CMD.read_bytes())

    def test_only_asked_a_game_still_open_stays_open_until_a_stop_that_may_close_it(self):
        """force=False (the page, with the game embedded): asked, still open -> STILL_OPEN, not closed; the next Stop
        (after the page detached it) closes it from outside at once, without waiting again."""
        self.assertEqual(self.live.stop(force=False), self.live.STILL_OPEN)
        self.assertEqual(self.processes.closed, [])
        self.assertTrue(self.live.session_status()['running'])
        self.assertTrue(self.copies()[0].exists())
        t0 = time.monotonic()
        self.assertEqual(self.live.stop(), 'stopped')
        self.assertLess(time.monotonic() - t0, 0.8)
        self.assertEqual(len(self.processes.closed), 1)
        self.assertFalse(any(path.exists() for path in self.copies()))


class ModPlayTests(Game):
    """T7 (A4 review #2): the Mods panel's Play starts the mod's game on copies of both ini files."""
    MANIFEST = dict(format=1, id='my-mod', name='My Mod', version='1', package='DXP_my_mod', packages=['DXP_my_mod'],
                    maps=['01_ModMap'], start='01_ModMap', requires=[])

    def play(self, target, editor=None):
        """The Mods panel's Play of a mod of `target` (the hub's game: `editor`, the mod's by default)."""
        self.use(editor or target)
        mods = module('mods', self.s)
        folder = mods.mods_root(target) / 'my-mod'
        folder.mkdir(parents=True)
        (folder / 'mod.json').write_text(json.dumps(dict(self.MANIFEST, game=target)), encoding='utf-8')
        with patch.object(mods.subprocess, 'run', return_value=types.SimpleNamespace(stdout='')), \
                patch.object(mods.subprocess, 'Popen') as popen:
            mods.play(target, 'my-mod')
        return popen.call_args.args[0][3:], folder

    def test_a_revision_mod_plays_on_both_copies_and_never_writes_the_players(self):
        argv, folder = self.play('revision')
        self.assertEqual(argv, ['01_ModMap', 'INI=DeusEdixMod.ini,', 'USERINI=DeusEdixModUser.ini,'])
        self.assertEqual((self.system() / 'DeusEdixModUser.ini').read_bytes(), PLAYER_USER)
        self.assertIn(b'Paths=..\\DeusEdixMods\\my-mod\\*.dx', (self.system() / 'DeusEdixMod.ini').read_bytes())
        self.assertIn(b'StartupFullscreen=True', (self.system() / 'DeusEdixMod.ini').read_bytes())   # the player's mode
        self.assert_players_untouched()

    def test_an_original_game_mod_too(self):
        """A mod's game is a player's game: the player's own mode (full screen here), no switch for a window, unlike
        every launch of the editor's."""
        argv, folder = self.play('vanilla')
        self.assertEqual(argv, ['01_ModMap', 'INI=..\\DeusEdixMods\\my-mod\\Play\\DeusEx.ini,',
                                'USERINI=..\\DeusEdixMods\\my-mod\\Play\\User.ini,'])
        self.assertEqual((folder / 'Play' / 'User.ini').read_bytes(), b'[Engine.Input]\r\nF24=\r\n')
        self.assertIn(b'StartupFullscreen=True\r\n', (folder / 'Play' / 'DeusEx.ini').read_bytes())
        self.assert_players_untouched()

    def test_every_launch_copy_is_named_by_settings(self):
        """Review #13: a Play's and a mod's game's copies take their names from settings (LAUNCH_PLAY, LAUNCH_MOD,
        launch_names), and so do the uninstaller's patterns (workspace.game_files): renamed there, every one follows."""
        with patch.multiple(real_settings, LAUNCH_PLAY='OtherPlay_', LAUNCH_MOD='OtherMod'):
            argv, _ = self.play('revision')
            self.live.play('10_Map')
        self.assertEqual(argv, ['01_ModMap', 'INI=OtherMod.ini,', 'USERINI=OtherModUser.ini,'])
        names = ('OtherPlay_p.ini', 'OtherPlay_pUser.ini', 'OtherMod.ini', 'OtherModUser.ini')
        self.assertTrue(all((self.system() / name).is_file() for name in names), sorted(p.name for p in self.system().iterdir()))
        patterns = self.ws.game_files()
        self.assertTrue(all(any(Path(name).match(pattern) for pattern in patterns) for name in names), patterns)


class NeverStartedTests(Game):
    """A player with no user ini (RevisionUser.ini, User.ini; deleted to reset the settings): the engine makes it at the
    game's start from the default user ini beside it (RevisionDefUser.ini, DefUser.ini: DEFAULT_USER). A launch's user
    copy is made from that default, as the engine would, and the player's own is still not made; with no default
    either, the copy starts empty. Before, Play and a mod's Play stopped on FileNotFoundError (29 Oct 2026)."""
    mod_play = ModPlayTests.play
    MANIFEST = ModPlayTests.MANIFEST

    def never_started(self, target, default):
        """No user ini of `target`; its default user ini `default` (None: none either)."""
        fake_settings(self.game, target).USER_INI.unlink()
        path = self.game / DEFAULT_USER[target][0]
        if default is None:
            path.unlink()
        else:
            path.write_bytes(default)

    def user_copies(self, target, folder):
        """The user copy of the Play's launch and of the mod's."""
        return self.copies()[1], (self.system() / 'DeusEdixModUser.ini' if target == 'revision' else folder / 'Play' / 'User.ini')

    def test_a_launch_starts_on_a_copy_of_the_games_default_user_ini(self):
        for target in ('revision', 'vanilla'):
            with self.subTest(game=target):
                default = DEFAULT_USER[target][1]
                self.never_started(target, default)
                live = self.use(target)
                live.play('10_Map')
                copy = self.copies()[1].read_bytes()
                self.assertTrue(copy.startswith(default.rstrip()), copy)
                self.assertIn(live.RUNNER.encode() + b'\r\nbActive=True\r\n', copy)
                self.assertIn(live.CONSOLE.encode() + b'\r\nbActive=True\r\n', copy)
                self.assert_players_untouched()
                _, folder = self.mod_play(target)
                self.assertEqual(self.user_copies(target, folder)[1].read_bytes(), default)
                self.assert_players_untouched()

    def test_a_mod_of_the_other_game_starts_on_its_own_default_user_ini(self):
        """Review #12: the Mods panel plays a mod of either game, whatever the hub's own game is: a missing user ini of the
        mod's game is made from that game's default (mods.launch_ini passes the mod's game on), not the hub's."""
        self.never_started('vanilla', DEFAULT_USER['vanilla'][1])
        _, folder = self.mod_play('vanilla', editor='revision')
        self.assertEqual((folder / 'Play' / 'User.ini').read_bytes(), DEFAULT_USER['vanilla'][1])
        self.assert_players_untouched()

    def test_with_no_default_user_ini_either_the_copy_starts_empty(self):
        for target in ('revision', 'vanilla'):
            with self.subTest(game=target):
                self.never_started(target, None)
                live = self.use(target)
                live.play('10_Map')
                copy = self.copies()[1].read_bytes().decode('latin1')
                self.assertTrue(copy.lstrip().startswith(live.RUNNER + '\r\n'), copy)
                self.assertNotIn('[Engine.Input]', copy)
                self.assert_players_untouched()
                _, folder = self.mod_play(target)
                self.assertEqual(self.user_copies(target, folder)[1].read_bytes(), b'')
                self.assert_players_untouched()


if __name__ == '__main__':
    unittest.main()
