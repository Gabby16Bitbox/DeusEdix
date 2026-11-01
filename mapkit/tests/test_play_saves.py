"""Play saves in a folder of DeusEdix's and clears a map's saved state only there, never in the player's own Save folder.
Since 29 Oct 2026 (A2) a Play names that folder in its own copy of the game's ini, never in the player's: what a Play of
DeusEdix 0.1.58 or older cut short left there (DeusEdix's SavePath, the record of the map played last) is still given
back by what ends it."""
import ast
import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

KIT = Path(__file__).resolve().parents[1]
SERVER = KIT / 'editor' / 'server.py'
sys.path.insert(0, str(KIT))
import live


def module(name, settings):
    spec = importlib.util.spec_from_file_location('isolated_' + name, KIT / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'settings': settings}):
        spec.loader.exec_module(result)
    return result


def editor_function(name, **names):
    """A function of editor/server.py on its own (the module needs the whole editor), with `names` as its globals."""
    tree = ast.parse(SERVER.read_text(encoding='utf-8-sig'))
    found = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name]
    if not found:
        raise AssertionError('editor/server.py has no %s()' % name)
    namespace = dict(names)
    exec(compile(ast.Module(body=found, type_ignores=[]), str(SERVER), 'exec'), namespace)
    return namespace[name]


def live_play(test, during, *args, **kwargs):
    """live.play on the real workspace and project_game of a test's fake game (test.game, test.system, test.settings,
    test.project_game): its prepare, then during() (the game), then its cleanup unless during() returns 'cut short'.
    The launch's copies are Revision's: DeusEdixPlay_legacy.ini and its user ini in the game's System folder."""
    def start(prepare, dispatch, cleanup):
        prepare()
        if during() != 'cut short':
            cleanup()
    session = types.SimpleNamespace(processes=types.SimpleNamespace(list=lambda: []), start=start)
    for name, value in dict(PROJECT=test.game.parent / 'project', PACKAGE='DeusEdix', STANDALONE=True,
                            ANIMS_PACKAGE='DeusEdixAnims', MODELS_PACKAGE='DeusEdixModels',
                            SOUNDS_PACKAGE='DeusEdixSounds', SCRIPTS_PACKAGE='DeusEdixScripts').items():
        setattr(test.settings, name, value)
    workspace = module('workspace', test.settings)
    with patch.multiple(live, PLAY_INI=test.system / 'DeusEdixPlay_legacy.ini', INI=test.system / 'DeusEdixPlay_legacyUser.ini',
                        CMD=test.system / 'UCLive.txt', REV=test.game, SYS=test.system, WINDOWED=['-windowed'],
                        CONSOLE_CMD=test.system / 'UCConsole.txt', LOADOUT=test.system / 'UCLoadout.txt',
                        _SESSION=session, settings=test.settings,
                        STATE={'seq': 0, 'folder': None, 'maps': set(), 'command_written': False}), \
            patch.dict(sys.modules, {'workspace': workspace, 'project_game': test.project_game}):
        live.play(*args, **kwargs)


class PlaySavesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)                    # the game's folder (Revision\)
        self.ini = self.root / 'RevisionUser.ini'
        self.ini.write_text('[Engine.Player]\nName=JC\n', encoding='latin1')
        self.game_ini = self.root / 'Revision.ini'
        self.game_ini.write_bytes(b'[Core.System]\r\nSavePath=..\\Save\r\n')
        self.player = self.root / 'Save' / 'Current'        # the player's own game in progress
        # the session only prepares the launch: no game is started
        session = types.SimpleNamespace(processes=types.SimpleNamespace(list=lambda: []),
                                        start=lambda prepare, dispatch, cleanup: prepare())
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(patch.multiple(live, INI=self.root / 'DeusEdixPlay_pUser.ini', CMD=self.root / 'UCLive.txt',
                                                REV=self.root, CONSOLE_CMD=self.root / 'UCConsole.txt',
                                                PLAY_INI=self.root / 'DeusEdixPlay_p.ini', LOADOUT=self.root / 'UCLoadout.txt',
                                                SYS=self.root, _SESSION=session,
                                                STATE={'seq': 0, 'folder': None, 'maps': set(), 'command_written': False}))
        self.stack.enter_context(patch.dict(sys.modules, {'workspace': types.SimpleNamespace(paths_lines=lambda: [])}))

    def tearDown(self):
        self.stack.close()
        self.temp.cleanup()

    def save(self, folder, name='TestMap'):
        path = folder / (name + '.dxs')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'saved state of ' + name.encode())
        return path

    def play(self, saves, managed):
        # the existing workspace's maps folder is not its save folder's parent: clearing MAPS_DIR\Save fails here too
        maps = saves.parent if managed else self.root / 'DeusEdixMaps'
        with patch.object(live, 'settings', types.SimpleNamespace(MAPS_DIR=maps, SAVE_DIR=saves, MANAGED_PROJECT=managed,
                                                                  MAPS_DIR_NAME='DeusEdixProjects/' + saves.parent.name,
                                                                  GAME_INI=self.game_ini, USER_INI=self.ini)):
            live.play('TestMap')
        # a Play never writes the player's ini files (A2: its own copies of them)
        self.assertEqual(self.ini.read_text(encoding='latin1'), '[Engine.Player]\nName=JC\n')
        self.assertEqual(self.game_ini.read_bytes(), b'[Core.System]\r\nSavePath=..\\Save\r\n')

    def test_managed_project_clears_only_that_map_in_its_own_save_folder(self):
        saves = self.root / 'DeusEdixProjects' / 'my-project' / 'Save'
        stale = self.save(saves / 'Current')
        other = self.save(saves / 'Current', 'OtherMap')
        player = self.save(self.player)
        self.play(saves, True)
        self.assertFalse(stale.exists())
        self.assertEqual(other.read_bytes(), b'saved state of OtherMap')
        self.assertEqual(player.read_bytes(), b'saved state of TestMap')
        self.assertIn(b'SavePath=..\\DeusEdixProjects\\my-project\\Save\r\n', live.PLAY_INI.read_bytes())

    def test_existing_workspace_clears_its_own_save_folder_never_the_players(self):
        saves = self.root / 'DeusEdixProjects' / 'legacy' / 'Save'
        stale = self.save(saves / 'Current')
        player = self.save(self.player)
        self.play(saves, False)
        self.assertFalse(stale.exists())
        self.assertEqual(player.read_bytes(), b'saved state of TestMap')

    def test_a_save_folder_outside_deusedix_folders_is_never_cleared(self):
        player = self.save(self.player)
        self.play(self.root / 'Save', False)                # a SavePath that would be the player's own
        self.assertEqual(player.read_bytes(), b'saved state of TestMap')
        saves = self.root / 'DeusEdixProjects' / 'p' / 'Save'
        with patch.object(live, 'settings', types.SimpleNamespace(SAVE_DIR=saves)):
            self.assertIsNone(live._own_saved_state('..\\..\\..\\..\\Save\\Current\\TestMap'))
            self.assertEqual(live._own_saved_state('TestMap'), (saves / 'Current' / 'TestMap.dxs').resolve())


class PlaySaveFolderTests(unittest.TestCase):
    """The game's SavePath: a Play's copy of the game's ini names a folder of DeusEdix's, the player's own ini never
    does; what a Play of DeusEdix 0.1.58 or older cut short left there (that folder in both sections) goes back to the
    player's own by what ends it."""
    # DeusEdix's own maps folder and package: project_game owns them in every build, a development copy's too
    PATHS = ['Paths=..\\DeusEdixMaps\\*.dx', 'Paths=..\\DeusEdixMaps\\*.u']
    ACTOR = 'ServerActors=DeusEdix.UCLegacyActor'
    OWN = 'SavePath=..\\DeusEdixProjects\\legacy\\Save'
    # a snapshot of DeusEdix's first activation made before the player chose other save folders (this PC's has ..\Save
    # in both sections, 15 Oct 2026), and the folders they have now: each section its own, and a mod's SavePath
    STALE = {'[core.system]': '..\\Save', '[revisioninternal.launchsystem]': '..\\Save'}
    PLAYERS = {'[core.system]': '..\\MySaves', '[revisioninternal.launchsystem]': 'D:\\Games\\DX Saves',
               '[somemod.settings]': '..\\ModSaves'}

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.game = Path(self.temp.name) / 'game'          # the targeted game's folder (GAME_ROOT)
        self.system = self.game / 'System'
        self.system.mkdir(parents=True)
        self.ini = self.system / 'Revision.ini'
        self.stamp = self.system / 'deusedix-project-activation.json'
        self.ini.write_bytes(b'[Core.System]\r\nSavePath=..\\MySaves\r\nPaths=..\\DeusEdixMaps\\*.dx\r\nPaths=..\\Maps\\*.dx\r\n'
                             b'[RevisionInternal.LaunchSystem]\r\nSavePath=..\\Save\r\nPaths=..\\Maps\\*.dx\r\n'
                             b'[Engine.GameEngine]\r\nServerActors=DeusEdix.UCLegacyActor\r\n')
        self.settings = types.SimpleNamespace(DEV={'package': 'DevMod', 'mapsDir': 'DevMaps'}, MANAGED_PROJECT=False,
            MAPS_DIR_NAME='DeusEdixMaps', MAPS_DIR=self.game / 'DeusEdixMaps', GAME_INI=self.ini, USER_INI=self.system / 'User.ini',
            SAVE_DIR_NAME='DeusEdixProjects/legacy/Save', SAVE_DIR=self.game / 'DeusEdixProjects/legacy/Save',
            GAME=self.game, TARGETS={'revision': {'root': '', 'ini': 'Revision.ini'}},
            system_folder=lambda target=None, folder=None: self.system)
        self.project_game = module('project_game', self.settings)

    def tearDown(self):
        self.temp.cleanup()

    def text(self):
        return self.ini.read_text(encoding='latin1')

    def older_play(self):
        """What a Play of the workspace under DeusEdix 0.1.58 or older left in the game's ini when it was cut short (the
        editor killed while its game ran): the workspace's folders and DeusEdix's save folder in both sections, the
        player's own recorded (as an Install's activation records them)."""
        self.project_game.activate(self.PATHS)
        self.project_game._write(self.ini, self.project_game.play_save_text(self.text(), self.project_game.play_save_path()))

    def players_own(self):
        """The stale snapshot (STALE) and the ini with the player's folders of now (PLAYERS)."""
        self.stamp.write_text(json.dumps({'save_paths': self.STALE}), encoding='utf-8')
        self.ini.with_name('Revision.ini.bak_projects').unlink(missing_ok=True)
        self.ini.write_bytes(b'[Core.System]\r\nSavePath=..\\MySaves\r\nPaths=..\\Maps\\*.dx\r\n'
                             b'[RevisionInternal.LaunchSystem]\r\nSavePath=D:\\Games\\DX Saves\r\nPaths=..\\Maps\\*.dx\r\n'
                             b'[SomeMod.Settings]\r\nSavePath=..\\ModSaves\r\n')

    def assert_players_own(self):
        """The player's folders of now in the ini, each in its section, and in the snapshot (what an uninstall and a
        project's close put back)."""
        lines = [line for line in self.text().splitlines() if line.lower().startswith('savepath=')]
        self.assertEqual(lines, ['SavePath=' + value for value in self.PLAYERS.values()])
        self.assertEqual(json.loads(self.stamp.read_text(encoding='utf-8'))['save_paths'], self.PLAYERS)

    def workspace(self):
        """The real workspace.py on this test's settings."""
        for name, value in dict(PROJECT=self.game.parent / 'project', PACKAGE='DeusEdix', STANDALONE=True,
                                ANIMS_PACKAGE='DeusEdixAnims', MODELS_PACKAGE='DeusEdixModels',
                                SOUNDS_PACKAGE='DeusEdixSounds', SCRIPTS_PACKAGE='DeusEdixScripts').items():
            setattr(self.settings, name, value)
        return module('workspace', self.settings)

    def test_an_older_plays_save_folder_is_given_back_by_its_close(self):
        self.older_play()
        text = self.text()
        self.assertEqual(text.count(self.OWN), 2)
        self.assertNotIn('MySaves', text)
        self.assertEqual(text.count(self.ACTOR), 1)             # DeusEdix's own lines: once, and once a section
        self.assertEqual(text.count(self.PATHS[0]), 2)
        self.assertEqual(text.count(self.PATHS[1]), 2)
        self.assertTrue(self.project_game.deactivate_if_current())
        text = self.text()                                  # each section's own SavePath again
        self.assertLess(text.index('SavePath=..\\MySaves\n'), text.index('[RevisionInternal.LaunchSystem]'))
        self.assertGreater(text.index('SavePath=..\\Save\n'), text.index('[RevisionInternal.LaunchSystem]'))
        self.assertNotIn('DeusEdixProjects', text)
        self.assertEqual(text.count(self.ACTOR), 1)
        self.assertEqual(text.count(self.PATHS[0]), 2)
        self.assertEqual(text.count(self.PATHS[1]), 2)
        self.assertFalse(self.project_game.deactivate_if_current())

    def test_install_never_moves_the_players_saves(self):
        self.project_game.activate(self.PATHS)
        self.assertIn('SavePath=..\\MySaves', self.text())
        self.assertNotIn('DeusEdixProjects', self.text())
        before = self.ini.read_bytes()
        self.assertFalse(self.project_game.deactivate_if_current())
        self.assertEqual(self.ini.read_bytes(), before)

    def test_closing_a_workspace_that_never_played_writes_nothing(self):
        before = self.ini.read_bytes()
        self.assertFalse(self.project_game.deactivate_if_current())
        self.assertEqual(self.ini.read_bytes(), before)
        self.assertFalse((self.system / 'deusedix-project-activation.json').exists())

    def test_an_older_play_left_by_a_crash_is_undone_by_the_next_activation(self):
        self.older_play()
        self.project_game.activate(self.PATHS)              # an Install after the editor was closed mid-Play
        self.assertIn('SavePath=..\\MySaves', self.text())
        self.assertNotIn('DeusEdixProjects', self.text())

    def test_the_original_game_plays_on_copies_that_save_in_deusedix_folder(self):
        game_ini = self.system / 'DeusEx.ini'
        game_ini.write_bytes(b'[Core.System]\r\nSavePath=..\\Save\r\nPaths=..\\Maps\\*.dx\r\n'
                             b'[WinDrv.WindowsClient]\r\nStartupFullscreen=True\r\n')
        self.settings.USER_INI.write_bytes(b'[Engine.Player]\r\nName=JC\r\n')
        before = game_ini.read_bytes()
        play_ini = self.game / 'DeusEdixMaps' / 'Play' / 'DeusEx.ini'
        self.settings.GAME_INI = game_ini
        with patch.multiple(live, PLAY_INI=play_ini, INI=play_ini.with_name('User.ini'), SYS=self.system,
                            WINDOWED=[], settings=self.settings), \
                patch.dict(sys.modules, {'project_game': self.project_game,
                                         'workspace': types.SimpleNamespace(paths_lines=lambda: self.PATHS)}):
            live._session_inis('external')
        text = play_ini.read_text(encoding='latin1')
        self.assertIn(self.OWN + '\n', text)
        self.assertIn(b'StartupFullscreen=False\r\n', play_ini.read_bytes())
        self.assertEqual(play_ini.with_name('User.ini').read_bytes(), b'[Engine.Player]\r\nName=JC\r\n')
        self.assertEqual(game_ini.read_bytes(), before)
        self.assertTrue(self.settings.SAVE_DIR.is_dir())

    def test_the_snapshot_is_written_before_the_ini(self):
        # an ini write that fails (the editor killed at that moment) leaves the player's folders recorded, so the
        # undo of an older Play puts them back, not the first activation's
        self.players_own()
        with patch.object(self.project_game, '_write', side_effect=OSError('killed while writing the ini')):
            with self.assertRaises(OSError):
                self.project_game.activate(self.PATHS)
        self.assertEqual(json.loads(self.stamp.read_text(encoding='utf-8'))['save_paths'], self.PLAYERS)

    def test_a_mods_savepath_naming_the_play_folder_is_not_ours_to_restore(self):
        self.ini.write_bytes(b'[Core.System]\r\nSavePath=..\\MySaves\r\n[SomeMod.Settings]\r\n' + self.OWN.encode() + b'\r\n')
        before = self.ini.read_bytes()
        self.assertFalse(self.project_game.deactivate_if_current())
        self.assertEqual(self.ini.read_bytes(), before)
        self.assertFalse(self.stamp.exists())

    def test_install_never_moves_the_players_saves_and_gives_back_an_older_plays(self):
        """workspace.activate as Install calls it (no arguments), on the real project_game: the player's folders stay,
        and after an older Play cut short they come back."""
        self.players_own()
        workspace = self.workspace()
        with patch.dict(sys.modules, {'project_game': self.project_game}):
            workspace.activate()                                      # Install
            self.assert_players_own()
            self.older_play()
            self.assertEqual(self.text().count(self.OWN), 2)
            workspace.activate()                                      # an Install after an older Play cut short
        self.assert_players_own()
        self.assertNotIn('DeusEdixProjects', self.text())

    def test_play_through_live_never_names_the_save_folder_in_the_players_ini(self):
        """live.play's prepare, then its cleanup once the game has closed, on the real workspace and project_game: the
        launch's copy saves in DeusEdix's folder (both sections); the player's ini is the same bytes all along."""
        self.players_own()
        before = self.ini.read_bytes()
        user = self.system / 'RevisionUser.ini'
        user.write_bytes(b'[Engine.Player]\r\nName=JC\r\n')
        self.settings.USER_INI = user
        seen = {}

        def during():
            seen['playing'] = self.ini.read_bytes()
            seen['copy'] = (self.system / 'DeusEdixPlay_legacy.ini').read_text(encoding='latin1')
        live_play(self, during, 'TestMap')
        self.assertEqual(seen['playing'], before)
        self.assertEqual(seen['copy'].count(self.OWN), 2)
        self.assertEqual(self.ini.read_bytes(), before)
        self.assertEqual(user.read_bytes(), b'[Engine.Player]\r\nName=JC\r\n')
        self.assertFalse((self.system / 'DeusEdixPlay_legacy.ini').exists())

    def test_after_an_older_play_the_player_gets_back_the_folder_they_had_when_it_started(self):
        """27 Oct 2026: the snapshot of DeusEdix's first activation (STALE) came back instead, over the folders the
        player had chosen since. Whatever ends an older Play cut short (the editor killed while its game ran): the
        project's close, an Install, the uninstall, the editor starting again, also after a Play of today's in between
        (which leaves the game's ini alone). Such a Play never recorded DeusEdix's own folder."""
        user = self.system / 'RevisionUser.ini'
        user.write_bytes(b'[Engine.Player]\r\nName=JC\r\n')
        self.settings.USER_INI = user
        restore = editor_function('restore_cut_short_play', settings=self.settings)
        ends = {
            'its close': self.project_game.deactivate_if_current,
            'an Install': lambda: self.project_game.activate(self.PATHS),
            'the uninstall': lambda: self.assertEqual(self.project_game.deactivate_all(), ([str(self.ini)], [])),
            'the editor starting again': lambda: self.assertTrue(restore()),
            'a Play, then the editor starting again': lambda: (live_play(self, lambda: None, 'TestMap'),
                                                               self.assertEqual(self.text().count(self.OWN), 2),
                                                               self.assertTrue(restore())),
        }
        for name, end in ends.items():
            with self.subTest(end=name):
                self.players_own()
                self.older_play()
                text = self.text()
                self.assertEqual(text.count(self.OWN), 2)             # the game's two sections, never a mod's
                self.assertIn('SavePath=..\\ModSaves', text)
                with patch.dict(sys.modules, {'project_game': self.project_game}):
                    end()
                self.assert_players_own()

    def test_a_projects_close_gives_back_the_folder_the_player_has_now(self):
        """A project's activation records the player's folders of now too: its close puts them back."""
        self.players_own()
        self.settings.MANAGED_PROJECT = True
        self.settings.MAPS_DIR_NAME = 'DeusEdixProjects/p'
        self.settings.MAPS_DIR = self.game / 'DeusEdixProjects' / 'p'
        self.assertTrue(self.project_game.activate(['Paths=..\\DeusEdixProjects\\p\\*.dx', 'Paths=..\\DeusEdixProjects\\p\\*.u']))
        self.assertIn('SavePath=..\\DeusEdixProjects\\p\\Save', self.text())
        self.assertNotIn('MySaves', self.text())
        self.assertTrue(self.project_game.deactivate_if_current())
        self.assert_players_own()

    def test_the_editor_starting_with_no_game_running_undoes_an_older_play_cut_short(self):
        """editor/server.py main(): restore_cut_short_play in its start-up block (a worker, no game running). A
        snapshot that cannot be read is only logged (the project still opens); a project's settings are its close's."""
        tree = ast.parse(SERVER.read_text(encoding='utf-8-sig'))
        main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
        start_up = [ast.unparse(line) for node in ast.walk(main) if isinstance(node, ast.If)
                    and 'not game_running()' in ast.unparse(node.test) for line in node.body]
        self.assertIn('restore_cut_short_play()', start_up)
        restore = editor_function('restore_cut_short_play', settings=self.settings)
        self.players_own()
        self.older_play()                                              # cut short
        self.stamp.write_text('{', encoding='utf-8')
        with patch.dict(sys.modules, {'project_game': self.project_game}), \
                contextlib.redirect_stdout(io.StringIO()) as log:
            self.assertFalse(restore())
        self.assertIn('could not be restored', log.getvalue())
        self.assertEqual(self.text().count(self.OWN), 2)
        self.settings.MANAGED_PROJECT = True
        project_game = Mock()
        with patch.dict(sys.modules, {'project_game': project_game}):
            self.assertFalse(restore())
        project_game.deactivate_if_current.assert_not_called()


class LastPlayedTests(unittest.TestCase):
    """The map and chapter Revision's game writes into its user ini when a map starts (RevisionUser.ini [DeusEx.Human]
    lastPlayedMap / lastPlayedChapter, which its main menu may use): since 29 Oct 2026 (A2) into a Play's own copy, so
    a Play records nothing and leaves the player's file alone. A Play of DeusEdix 0.1.58 or older let the game write the
    player's (B6 in the game, 28 Oct 2026: 10_B6_Ingame / 10 stayed after the Play, a map the player's game does not
    have) and recorded the two values it found with 'played', the maps that Play could make the game write (its own, a
    setup's launch map, every map of its folder, which it could travel to, a map live.show_map showed). One rule, no
    guess at the close from the files on disk (fix-a3): a close writes such a record back only when the ini names one
    of those maps then (its file there or not, one of the game's own names too), else drops it unwritten; with no record
    it never writes. The game's other changes to the file stay. Fake game folders only."""
    PATHS = PlaySaveFolderTests.PATHS
    PROJECT = ['Paths=..\\DeusEdixProjects\\p\\*.dx']          # the project p's folder, as its activation names it
    # as the game writes it (LF, 28 Oct 2026), the two lines in the middle of its section
    USER = ('[Engine.Player]\nName=JC\n[DeusEx.Human]\nbUseRevisionFootsteps=True\nlastPlayedMap=02_NYC_BatteryPark\n'
            'lastPlayedChapter=2\nbAnimatedMainMenu=False\n\n[Extension.InputExt]\nAim=Button\n')
    PLAYERS = {'lastPlayedMap': '02_NYC_BatteryPark', 'lastPlayedChapter': '2'}

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.game = Path(self.temp.name) / 'game'
        self.system = self.game / 'System'
        self.system.mkdir(parents=True)
        self.ini = self.system / 'Revision.ini'
        self.ini.write_bytes(b'[Core.System]\r\nSavePath=..\\Save\r\nPaths=..\\Maps\\*.dx\r\n'
                             b'[RevisionInternal.LaunchSystem]\r\nSavePath=..\\Save\r\nPaths=..\\Maps\\*.dx\r\n')
        self.user = self.system / 'RevisionUser.ini'
        self.user.write_bytes(self.USER.encode('latin1'))
        self.stamp = self.system / 'deusedix-project-activation.json'
        self.settings = types.SimpleNamespace(DEV={'package': 'DevMod', 'mapsDir': 'DevMaps'}, MANAGED_PROJECT=False,
            MAPS_DIR_NAME='DeusEdixMaps', MAPS_DIR=self.game / 'DeusEdixMaps', GAME_INI=self.ini, USER_INI=self.user,
            SAVE_DIR_NAME='DeusEdixProjects/legacy/Save', SAVE_DIR=self.game / 'DeusEdixProjects/legacy/Save', GAME=self.game,
            TARGETS={'revision': {'root': '', 'ini': 'Revision.ini', 'user_ini': 'RevisionUser.ini'}},
            system_folder=lambda target=None, folder=None: self.system)
        self.project_game = module('project_game', self.settings)
        # the maps the two lines can name: the game's own, DeusEdix's (this workspace's, a project's, the development
        # folder's), another mod's
        for folder, name in (('Maps', '02_NYC_BatteryPark'), ('Maps', '04_NYC_Street'), ('DeusEdixMaps', '10_B6_Ingame'),
                             ('DeusEdixMaps', '11_Other'), ('DeusEdixProjects/p', '01_Lab'), ('DevMaps', '20_Dev'),
                             ('OtherMod/Maps', '30_Mod')):
            (self.game / folder).mkdir(parents=True, exist_ok=True)
            (self.game / folder / (name + '.dx')).write_bytes(b'a map')

    def tearDown(self):
        self.temp.cleanup()

    def project(self, managed):
        """The settings of the project p (a managed project) or of the workspace (DeusEdixMaps)."""
        self.settings.MANAGED_PROJECT = managed
        self.settings.MAPS_DIR_NAME = 'DeusEdixProjects/p' if managed else 'DeusEdixMaps'
        self.settings.MAPS_DIR = self.game / self.settings.MAPS_DIR_NAME

    def older_play(self, *played, managed=False):
        """What the start of a Play of DeusEdix 0.1.58 or older of the workspace (or of p) left: its folders in the
        game's ini (the workspace's save folder too) and, in the snapshot, the player's two values as they were then
        with 'played', the maps that Play could make the game write (given here: its own, its folder's...)."""
        self.project(managed)
        self.project_game.activate(self.PROJECT if managed else self.PATHS)
        if not managed:
            text = self.ini.read_text(encoding='latin1')
            self.project_game._write(self.ini, self.project_game.play_save_text(text, self.project_game.play_save_path()))
        state = self.snapshot()
        state.update(last_played=self.project_game.last_played(self.user.read_bytes().decode('latin1')),
                     played=sorted({self.project_game.map_key(name) for name in played}))
        self.stamp.write_text(json.dumps(state), encoding='utf-8')

    def fresh(self, managed=False):
        """The player's user ini again, no record (a subtest's start)."""
        self.project(managed)
        self.user.write_bytes(self.USER.encode('latin1'))
        if self.stamp.exists():
            state = self.snapshot()
            state.pop('last_played', None)
            state.pop('played', None)
            self.stamp.write_text(json.dumps(state), encoding='utf-8')

    def ends(self):
        """The closes that give an older Play's record back (or drop it): {name: (managed, call)}. A project's close
        (retire_project), the editor starting again (restore_cut_short_play; the mapkit MCP's start does the same), the
        uninstall; and deactivate_if_current as the workspace's ('its end' before A2)."""
        restore = editor_function('restore_cut_short_play', settings=self.settings)
        return {'its end': (False, self.project_game.deactivate_if_current),
                'the project\'s close': (True, self.project_game.deactivate_if_current),
                'the editor starting again': (False, restore),
                'the uninstall': (False, self.project_game.deactivate_all)}

    def end(self, call):
        with patch.dict(sys.modules, {'project_game': self.project_game}):
            return call()

    def game_plays(self, map_name='10_B6_Ingame', chapter='10', user=None):
        """What the game does to its user ini (the player's, or `user`) while it plays a map: those two lines, and a
        setting of its menu."""
        user = user or self.user
        text = user.read_bytes().decode('latin1')
        lines = [('lastPlayedMap=' + map_name) if line.startswith('lastPlayedMap=') else
                 ('lastPlayedChapter=' + chapter) if line.startswith('lastPlayedChapter=') else line
                 for line in text.split('\n')]
        text = '\n'.join(lines).replace('bAnimatedMainMenu=False', 'bAnimatedMainMenu=True')
        if 'lastPlayedMap=' not in text:
            text = text.replace('[DeusEx.Human]\n', '[DeusEx.Human]\nlastPlayedMap=%s\nlastPlayedChapter=%s\n' % (map_name, chapter))
        user.write_bytes(text.encode('latin1'))

    def players_own(self):
        """The user ini as the player had it, but for the game's own change to its menu setting."""
        return self.USER.replace('bAnimatedMainMenu=False', 'bAnimatedMainMenu=True').encode('latin1')

    def snapshot(self):
        return json.loads(self.stamp.read_text(encoding='utf-8')) if self.stamp.exists() else {}

    def recorded(self):
        return self.snapshot().get('last_played')

    def values(self, text=None):
        """The two lines' values in the user ini (or text), whichever section: what the game would read."""
        lines = (self.user.read_bytes().decode('latin1') if text is None else text).splitlines()
        return {key: next((line.split('=', 1)[1] for line in lines if line.startswith(key + '=')), None)
                for key in ('lastPlayedMap', 'lastPlayedChapter')}

    def test_an_older_play_gives_back_the_map_and_chapter_it_found(self):
        self.older_play('10_B6_Ingame', '11_Other')
        self.assertEqual(self.recorded(), self.PLAYERS)
        self.game_plays()
        self.assertTrue(self.project_game.deactivate_if_current())
        self.assertEqual(self.user.read_bytes(), self.players_own())         # LF kept, in their place, the rest as left
        self.assertIsNone(self.recorded())
        self.assertNotIn('played', self.snapshot())
        self.assertFalse(self.project_game.deactivate_if_current())          # nothing left to put back

    def test_an_older_projects_play_gives_them_back_at_its_close(self):
        self.older_play('01_Lab', managed=True)
        self.game_plays('01_Lab', '1')
        self.assertTrue(self.project_game.deactivate_if_current())
        self.assertEqual(self.user.read_bytes(), self.players_own())

    def test_lines_the_game_added_are_taken_away(self):
        self.USER = self.USER.replace('lastPlayedMap=02_NYC_BatteryPark\nlastPlayedChapter=2\n', '')
        self.user.write_bytes(self.USER.encode('latin1'))
        self.older_play('10_B6_Ingame')
        self.assertEqual(self.recorded(), {'lastPlayedMap': None, 'lastPlayedChapter': None})
        self.game_plays()
        self.assertIn(b'lastPlayedMap=10_B6_Ingame', self.user.read_bytes())
        self.project_game.deactivate_if_current()
        self.assertEqual(self.user.read_bytes(), self.players_own())

    def test_an_install_records_nothing(self):
        self.project_game.activate(self.PATHS)
        self.assertIsNone(self.recorded())
        before = self.user.read_bytes()
        self.assertFalse(self.project_game.deactivate_if_current())
        self.assertEqual(self.user.read_bytes(), before)

    def test_an_older_play_cut_short_is_given_back_by_what_ends_it(self):
        """The editor killed while its game ran: the record stays, and what ends that Play gives the player's back."""
        ends = self.ends()
        del ends['its end']
        for name, (managed, call) in ends.items():
            with self.subTest(end=name):
                self.fresh(managed)
                map_name = '01_Lab' if managed else '10_B6_Ingame'
                self.older_play(map_name, managed=managed)
                self.game_plays(map_name)                                    # and no close: cut short
                self.end(call)
                self.assertEqual(self.values(), self.PLAYERS)
                self.assertIsNone(self.recorded())
                self.assertNotIn('played', self.snapshot())

    def test_an_older_play_cut_short_of_a_temporary_play_copy(self):
        """#0 of part_a2: a map never installed played on a temporary copy (play_preview.stage), removed
        (play_preview.restore) before the close that gives the player's values back runs (editor/server.py main and
        retire_project). The record knows the map by its name: given back all the same."""
        ends = self.ends()
        del ends['its end']
        for name, (managed, call) in ends.items():
            with self.subTest(end=name):
                self.fresh(managed)
                staged = self.settings.MAPS_DIR / '20_Never_Installed.dx'
                staged.write_bytes(b'a Play copy')
                self.older_play('20_Never_Installed', managed=managed)
                self.game_plays('20_Never_Installed', '20')                 # and no close: cut short
                staged.unlink()                                             # play_preview.restore at the start-up
                self.end(call)
                self.assertEqual(self.values(), self.PLAYERS)
                self.assertIsNone(self.recorded())

    def test_an_older_play_of_an_edited_original_map(self):
        """#1 of part_a2: a project's copy of one of the game's own maps keeps its name, and the game wrote that name:
        the player's values come back at its close."""
        (self.game / 'DeusEdixProjects' / 'p' / '04_NYC_Street.dx').write_bytes(b'an edited original')
        self.older_play('04_NYC_Street', '01_Lab', managed=True)
        self.game_plays('04_NYC_Street', '4')
        self.assertTrue(self.project_game.deactivate_if_current())
        self.assertEqual(self.user.read_bytes(), self.players_own())

    def test_no_record_never_writes(self):
        """#2 of part_a2: with no record (no older Play since the last close) no close writes, whatever the ini names:
        a map of DeusEdixMaps or of the development maps folder the player played in their own game (both stay on the
        game's Paths), a project's, one of the game's own, another mod's, a name of no map or not a map's."""
        self.project_game.activate(self.PATHS)                         # an Install: DeusEdix's lines, no record
        ends = self.ends()
        for map_name in ('10_B6_Ingame', '20_Dev', '01_Lab', '02_NYC_BatteryPark', '04_NYC_Street', '30_Mod',
                         '99_Nowhere', '..\\DeusEdixMaps\\10_B6_Ingame', ''):
            for name, (managed, call) in ends.items():
                with self.subTest(map=map_name, end=name):
                    self.project(managed)
                    self.user.write_bytes(self.USER.replace('02_NYC_BatteryPark', map_name).encode('latin1'))
                    if managed:
                        self.project_game.activate(self.PROJECT)       # the project's Install
                    before = self.user.read_bytes()
                    self.end(call)
                    self.assertEqual(self.user.read_bytes(), before)
                    self.project(False)
                    self.project_game.activate(self.PATHS)

    def test_an_install_then_its_map_played_from_the_game_is_left_alone(self):
        """An Install records nothing; the project's map then started by hand from Revision's own menu writes the two
        lines, and no close takes them out: with no record nothing is written (cosmetic: the game's main menu)."""
        for name, (managed, call) in self.ends().items():
            with self.subTest(end=name):
                self.fresh(managed)
                self.project_game.activate(self.PROJECT if managed else self.PATHS)
                self.assertIsNone(self.recorded())
                self.game_plays('01_Lab' if managed else '10_B6_Ingame', '1')
                played = self.user.read_bytes()
                self.end(call)
                self.assertEqual(self.user.read_bytes(), played)
                self.project_game.deactivate()

    def test_a_newer_map_of_the_players_own_game_after_an_older_play_cut_short(self):
        """An older Play cut short, then the player's own game (04_NYC_Street: not one of the record's 'played'): every
        close keeps their newer map and drops the record unwritten."""
        ends = self.ends()
        del ends['its end']
        for name, (managed, call) in ends.items():
            with self.subTest(end=name):
                self.fresh(managed)
                map_name = '01_Lab' if managed else '10_B6_Ingame'
                self.older_play(map_name, managed=managed)
                self.game_plays(map_name)                                    # and no close: cut short
                self.game_plays('04_NYC_Street', '4')                         # then the player's own game
                newer = self.user.read_bytes()
                self.end(call)
                self.assertEqual(self.user.read_bytes(), newer)
                self.assertIsNone(self.recorded())

    def test_an_older_play_that_travelled_to_another_map_of_its_folder(self):
        """#0 of part_a3: an older Play went on to another map of its own folder (a map exit or teleporter, a link's or
        the Story's 'travel'), whose level wrote its own name too; its 'played' had every map of its folder: what ends
        that Play gives the player's values back, after it was cut short there too (the workspace and the project p)."""
        (self.game / 'DeusEdixProjects' / 'p' / '02_Lab.dx').write_bytes(b'a second map of the project')
        travels = {False: ('10_B6_Ingame', '11_Other'), True: ('01_Lab', '02_Lab')}  # {managed: (its map, the next)}
        for name, (managed, call) in self.ends().items():
            with self.subTest(end=name):
                self.fresh(managed)
                own, travelled = travels[managed]
                self.older_play(own, travelled, managed=managed)
                self.game_plays(own)
                self.game_plays(travelled, '11')                            # the map exit; then the end, or cut short
                self.end(call)
                self.assertEqual(self.user.read_bytes(), self.players_own())
                self.assertIsNone(self.recorded())
                self.assertNotIn('played', self.snapshot())

    def test_a_play_writes_into_its_copy_and_records_nothing(self):
        """A Play of today's (live.play's prepare, the game, its cleanup, on the real workspace and project_game): the
        game's two lines and the runner's section go into the launch's user copy; the player's file and the snapshot
        are the same bytes all along, and the copy goes with the game."""
        self.project_game.activate(self.PATHS)                          # an Install: the snapshot is there
        before = self.stamp.read_bytes()
        copy = self.system / 'DeusEdixPlay_legacyUser.ini'
        seen = {}

        def during():
            seen['copy'] = copy.read_bytes().decode('latin1')
            self.game_plays('TestMap', '10', user=copy)
            seen['played'] = self.values(copy.read_bytes().decode('latin1'))
        live_play(self, during, 'TestMap')
        self.assertIn('UCShotRunner', seen['copy'])
        self.assertEqual(seen['played'], {'lastPlayedMap': 'TestMap', 'lastPlayedChapter': '10'})
        self.assertEqual(self.user.read_bytes(), self.USER.encode('latin1'))
        self.assertEqual(self.stamp.read_bytes(), before)
        self.assertFalse(copy.exists())

    def test_a_play_with_a_setup_cut_short_leaves_the_players_file_alone(self):
        """live.play with a setup starts on another map (01_NYC_UNATCOIsland) and jumps to its own: the game writes the
        launch map first, into the copy. Cut short there, the player's file still has their values and nothing is
        recorded; the editor starting again writes nothing."""
        copy = self.system / 'DeusEdixPlay_legacyUser.ini'

        def during():
            self.game_plays('01_NYC_UNATCOIsland', '1', user=copy)
            return 'cut short'
        live_play(self, during, '10_B6_Ingame', setup='UCDbgSomething')
        self.assertEqual(self.values(), self.PLAYERS)
        self.assertIsNone(self.recorded())
        self.end(self.ends()['the editor starting again'][1])
        self.assertEqual(self.user.read_bytes(), self.USER.encode('latin1'))

    def test_show_map_records_nothing(self):
        """live.show_map while a Play runs opens a copy (UCLive<n>, removed at the session's end) of a map built only in
        out/; the game writes that map's name into the launch's copy, and an older Play's record waiting for its close
        is left as it is (it no longer grows by the shown map)."""
        out = self.game.parent / 'out'
        out.mkdir()
        (out / '30_Built_Only.dx').write_bytes(b'a map built only in out')
        self.older_play('10_B6_Ingame')                                # an older Play cut short: its record waits
        record = self.snapshot()
        running = {'owned': True, 'running': True, 'stopping': False, 'launching': False, 'error': None}
        seen = {}

        def during():
            with patch.object(live, 'session_status', lambda: running), patch.object(live, 'do', lambda *a, **k: ('', None)):
                live.show_map('30_Built_Only', out / '30_Built_Only.dx')
            seen['copies'] = sorted(p.name for p in self.settings.MAPS_DIR.glob('UCLive*.dx'))
            seen['record'] = self.snapshot()
        live_play(self, during, '10_B6_Ingame')
        self.assertEqual(len(seen['copies']), 1)
        self.assertEqual(list(self.settings.MAPS_DIR.glob('UCLive*.dx')), [])
        self.assertEqual(seen['record'], record)
        self.assertEqual(self.snapshot(), record)
        self.assertFalse(hasattr(self.project_game, 'add_played'))

    def test_a_record_of_an_older_copy(self):
        """A record without 'played' (a Play cut short under a copy before fix-a3): a close with none of its maps drops
        it unwritten. A 'played' with no record goes at a close. A 'played' that is not a list of map names stops the
        close (the ini not changed)."""
        self.project_game.activate(self.PATHS)
        state = self.snapshot()
        self.stamp.write_text(json.dumps(dict(state, last_played=self.PLAYERS)), encoding='utf-8')
        self.game_plays()
        played = self.user.read_bytes()
        self.end(self.ends()['the editor starting again'][1])
        self.assertEqual(self.user.read_bytes(), played)
        self.assertIsNone(self.recorded())
        self.stamp.write_text(json.dumps(dict(state, played=['10_b6_ingame'])), encoding='utf-8')
        self.assertFalse(self.project_game.deactivate_if_current())
        self.assertNotIn('played', self.snapshot())
        for bad in ('10_b6_ingame', ['10_B6_Ingame'], [3], ['']):
            with self.subTest(played=bad):
                self.stamp.write_text(json.dumps(dict(state, last_played=self.PLAYERS, played=bad)), encoding='utf-8')
                before = self.user.read_bytes()
                with self.assertRaises(ValueError):
                    self.project_game.deactivate_if_current()
                self.assertEqual(self.user.read_bytes(), before)

    def test_the_two_lines_in_any_user_ini(self):
        put = self.project_game.last_played_text
        crlf = '[DeusEx.Human]\r\nA=1\r\nlastPlayedMap=X\r\nlastPlayedChapter=3\r\n\r\n[Other]\r\nlastPlayedMap=Mine\r\n'
        self.assertEqual(put(crlf, {'lastPlayedMap': 'Y', 'lastPlayedChapter': '1'}),
                         crlf.replace('Map=X', 'Map=Y').replace('Chapter=3', 'Chapter=1'))   # another section's stays
        self.assertEqual(put(crlf, {'lastPlayedMap': None, 'lastPlayedChapter': None}),
                         '[DeusEx.Human]\r\nA=1\r\n\r\n[Other]\r\nlastPlayedMap=Mine\r\n')
        self.assertEqual(put('[DeusEx.Human]\r\nA=1\r\n\r\n[Other]\r\n', {'lastPlayedMap': 'Y', 'lastPlayedChapter': None}),
                         '[DeusEx.Human]\r\nA=1\r\nlastPlayedMap=Y\r\n\r\n[Other]\r\n')       # before the blank line
        self.assertEqual(put('[Other]\nB=2', {'lastPlayedMap': 'Y', 'lastPlayedChapter': '1'}),
                         '[Other]\nB=2\n[DeusEx.Human]\nlastPlayedMap=Y\nlastPlayedChapter=1\n')
        self.assertEqual(self.project_game.last_played('[deusex.human]\nLASTPLAYEDMAP=Z\n[X]\nlastPlayedChapter=9\n'),
                         {'lastPlayedMap': 'Z', 'lastPlayedChapter': None})
        self.assertEqual(self.project_game.map_key(' "10_B6_Ingame" '), '10_b6_ingame')


if __name__ == '__main__':
    unittest.main()
