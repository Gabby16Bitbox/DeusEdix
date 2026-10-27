"""Play saves in a folder of DeusEdix's and clears a map's saved state only there, never in the player's own Save folder."""
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


class PlaySavesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)                    # the game's folder (Revision\)
        self.ini = self.root / 'RevisionUser.ini'
        self.ini.write_text('[Engine.Player]\nName=JC\n', encoding='latin1')
        self.player = self.root / 'Save' / 'Current'        # the player's own game in progress
        # the session only prepares the launch: no game is started
        session = types.SimpleNamespace(processes=types.SimpleNamespace(list=lambda: []),
                                        start=lambda prepare, dispatch, cleanup: prepare())
        self.activate = Mock()
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(patch.multiple(live, INI=self.ini, CMD=self.root / 'UCLive.txt', REV=self.root,
                                                CONSOLE_CMD=self.root / 'UCConsole.txt', PLAY_INI=None,
                                                LOADOUT=self.root / 'UCLoadout.txt', GAME_INI=self.root / 'Revision.ini',
                                                SYS=self.root, _SESSION=session,
                                                STATE={'seq': 0, 'folder': None, 'maps': set(), 'command_written': False}))
        self.stack.enter_context(patch.dict(sys.modules, {'workspace': types.SimpleNamespace(activate=self.activate)}))

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
        with patch.object(live, 'settings', types.SimpleNamespace(MAPS_DIR=maps, SAVE_DIR=saves, MANAGED_PROJECT=managed)):
            live.play('TestMap')

    def test_managed_project_clears_only_that_map_in_its_own_save_folder(self):
        saves = self.root / 'DeusEdixProjects' / 'my-project' / 'Save'
        stale = self.save(saves / 'Current')
        other = self.save(saves / 'Current', 'OtherMap')
        player = self.save(self.player)
        self.play(saves, True)
        self.assertFalse(stale.exists())
        self.assertEqual(other.read_bytes(), b'saved state of OtherMap')
        self.assertEqual(player.read_bytes(), b'saved state of TestMap')
        self.activate.assert_called_once_with(play=True)

    def test_existing_workspace_clears_its_own_save_folder_never_the_players(self):
        saves = self.root / 'DeusEdixProjects' / 'legacy' / 'Save'
        stale = self.save(saves / 'Current')
        player = self.save(self.player)
        self.play(saves, False)
        self.assertFalse(stale.exists())
        self.assertEqual(player.read_bytes(), b'saved state of TestMap')
        self.activate.assert_called_once_with(play=True)

    def test_a_save_folder_outside_deusedix_folders_is_never_cleared(self):
        player = self.save(self.player)
        self.play(self.root / 'Save', False)                # a SavePath that would be the player's own
        self.assertEqual(player.read_bytes(), b'saved state of TestMap')
        saves = self.root / 'DeusEdixProjects' / 'p' / 'Save'
        with patch.object(live, 'settings', types.SimpleNamespace(SAVE_DIR=saves)):
            self.assertIsNone(live._own_saved_state('..\\..\\..\\..\\Save\\Current\\TestMap'))
            self.assertEqual(live._own_saved_state('TestMap'), (saves / 'Current' / 'TestMap.dxs').resolve())


class PlaySaveFolderTests(unittest.TestCase):
    """The game's SavePath while a workspace that is not a project plays, and the player's own again after it."""
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
            GAME=self.game, TARGETS={'revision': {'root': '', 'ini': 'Revision.ini'}})
        self.project_game = module('project_game', self.settings)

    def tearDown(self):
        self.temp.cleanup()

    def text(self):
        return self.ini.read_text(encoding='latin1')

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

    def test_play_saves_in_deusedix_folder_and_closing_puts_the_players_back(self):
        self.assertTrue(self.project_game.activate(self.PATHS, play=True))
        text = self.text()
        self.assertEqual(text.count(self.OWN), 2)
        self.assertNotIn('MySaves', text)
        self.assertEqual(text.count(self.ACTOR), 1)             # DeusEdix's own lines: once, and once a section
        self.assertEqual(text.count(self.PATHS[0]), 2)
        self.assertEqual(text.count(self.PATHS[1]), 2)
        self.assertTrue(self.settings.SAVE_DIR.is_dir())
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

    def test_a_play_left_by_a_crash_is_undone_by_the_next_activation(self):
        self.project_game.activate(self.PATHS, play=True)
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
                            settings=self.settings), \
                patch.dict(sys.modules, {'project_game': self.project_game,
                                         'workspace': types.SimpleNamespace(paths_lines=lambda: self.PATHS)}):
            live._session_inis('external')
        text = play_ini.read_text(encoding='latin1')
        self.assertIn(self.OWN + '\n', text)
        self.assertIn('StartupFullscreen=False', text)
        self.assertEqual(game_ini.read_bytes(), before)
        self.assertTrue(self.settings.SAVE_DIR.is_dir())

    def test_the_snapshot_is_written_before_the_ini(self):
        # an ini write that fails (the editor killed at that moment) leaves the player's folders recorded, so the
        # undo of that Play puts them back, not the first activation's
        self.players_own()
        with patch.object(self.project_game, '_write', side_effect=OSError('killed while writing the ini')):
            with self.assertRaises(OSError):
                self.project_game.activate(self.PATHS, play=True)
        self.assertEqual(json.loads(self.stamp.read_text(encoding='utf-8'))['save_paths'], self.PLAYERS)

    def test_a_mods_savepath_naming_the_play_folder_is_not_ours_to_restore(self):
        self.ini.write_bytes(b'[Core.System]\r\nSavePath=..\\MySaves\r\n[SomeMod.Settings]\r\n' + self.OWN.encode() + b'\r\n')
        before = self.ini.read_bytes()
        self.assertFalse(self.project_game.deactivate_if_current())
        self.assertEqual(self.ini.read_bytes(), before)
        self.assertFalse(self.stamp.exists())

    def test_install_never_moves_the_players_saves_and_a_play_does(self):
        """workspace.activate as Install calls it (no arguments) and as live's Play does (play=True), on the real
        project_game."""
        self.players_own()
        workspace = self.workspace()
        with patch.dict(sys.modules, {'project_game': self.project_game}):
            workspace.activate()                                      # Install
            self.assert_players_own()
            self.assertTrue(workspace.activate(play=True))            # Play
            self.assertEqual(self.text().count(self.OWN), 2)
            workspace.activate()                                      # an Install after a Play cut short
        self.assert_players_own()
        self.assertNotIn('DeusEdixProjects', self.text())

    def test_play_through_live_puts_the_players_save_folder_back_when_the_game_closes(self):
        """live.play's prepare, then its cleanup once the game has closed, on the real workspace and project_game."""
        self.players_own()
        user = self.system / 'RevisionUser.ini'
        user.write_bytes(b'[Engine.Player]\r\nName=JC\r\n')
        seen = {}

        def start(prepare, dispatch, cleanup):                       # no game: prepared, then closed
            prepare()
            seen['playing'] = self.text()
            cleanup()
        session = types.SimpleNamespace(processes=types.SimpleNamespace(list=lambda: []), start=start)
        workspace = self.workspace()
        with patch.multiple(live, INI=user, CMD=self.system / 'UCLive.txt', REV=self.game, SYS=self.system,
                            CONSOLE_CMD=self.system / 'UCConsole.txt', LOADOUT=self.system / 'UCLoadout.txt',
                            GAME_INI=self.ini, PLAY_INI=None, _SESSION=session, settings=self.settings,
                            STATE={'seq': 0, 'folder': None, 'maps': set(), 'command_written': False}), \
                patch.dict(sys.modules, {'workspace': workspace, 'project_game': self.project_game}):
            live.play('TestMap')
        self.assertEqual(seen['playing'].count(self.OWN), 2)
        self.assert_players_own()
        self.assertNotIn('DeusEdixProjects', self.text())

    def test_after_a_play_the_player_gets_back_the_folder_they_had_when_it_started(self):
        """27 Oct 2026: the snapshot of DeusEdix's first activation (STALE) came back instead, over the folders the
        player had chosen since. Whatever ends the Play: its close, or after a Play cut short (the editor killed while
        its game ran) the next Play, an Install, the uninstall or the editor starting again. A Play cut short never
        records DeusEdix's own folder."""
        ends = {
            'its close': self.project_game.deactivate_if_current,
            'the next Play and its close': lambda: (self.project_game.activate(self.PATHS, play=True),
                                                    self.project_game.deactivate_if_current()),
            'an Install': lambda: self.project_game.activate(self.PATHS),
            'the uninstall': lambda: self.assertEqual(self.project_game.deactivate_all(), ([str(self.ini)], [])),
            'the editor starting again': lambda: self.assertTrue(
                editor_function('restore_cut_short_play', settings=self.settings)()),
        }
        for name, end in ends.items():
            with self.subTest(end=name):
                self.players_own()
                self.assertTrue(self.project_game.activate(self.PATHS, play=True))
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

    def test_the_editor_starting_with_no_game_running_undoes_a_play_cut_short(self):
        """editor/server.py main(): restore_cut_short_play in its start-up block (a worker, no game running). A
        snapshot that cannot be read is only logged (the project still opens); a project's settings are its close's."""
        tree = ast.parse(SERVER.read_text(encoding='utf-8-sig'))
        main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
        start_up = [ast.unparse(line) for node in ast.walk(main) if isinstance(node, ast.If)
                    and 'not game_running()' in ast.unparse(node.test) for line in node.body]
        self.assertIn('restore_cut_short_play()', start_up)
        restore = editor_function('restore_cut_short_play', settings=self.settings)
        self.players_own()
        self.project_game.activate(self.PATHS, play=True)              # cut short
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


if __name__ == '__main__':
    unittest.main()
