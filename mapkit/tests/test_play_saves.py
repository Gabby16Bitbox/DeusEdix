"""Play saves in a folder of DeusEdix's and clears a map's saved state only there, never in the player's own Save folder."""
import contextlib
import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

KIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT))
import live


def module(name, settings):
    spec = importlib.util.spec_from_file_location('isolated_' + name, KIT / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'settings': settings}):
        spec.loader.exec_module(result)
    return result


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
        with patch.object(live, 'settings', types.SimpleNamespace(MAPS_DIR=saves.parent, SAVE_DIR=saves,
                                                                  MANAGED_PROJECT=managed)):
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
    PATHS = ['Paths=..\\DevMaps\\*.dx', 'Paths=..\\DevMaps\\*.u']
    OWN = 'SavePath=..\\DeusEdixProjects\\legacy\\Save'

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.game = Path(self.temp.name) / 'game'          # the targeted game's folder (GAME_ROOT)
        self.system = self.game / 'System'
        self.system.mkdir(parents=True)
        self.ini = self.system / 'Revision.ini'
        self.ini.write_bytes(b'[Core.System]\r\nSavePath=..\\MySaves\r\nPaths=..\\DevMaps\\*.dx\r\nPaths=..\\Maps\\*.dx\r\n'
                             b'[RevisionInternal.LaunchSystem]\r\nSavePath=..\\Save\r\nPaths=..\\Maps\\*.dx\r\n'
                             b'[Engine.GameEngine]\r\nServerActors=DevMod.UCLegacyActor\r\n')
        self.settings = types.SimpleNamespace(DEV={'package': 'DevMod', 'mapsDir': 'DevMaps'}, MANAGED_PROJECT=False,
            MAPS_DIR_NAME='DevMaps', MAPS_DIR=self.game / 'DevMaps', GAME_INI=self.ini, USER_INI=self.system / 'User.ini',
            SAVE_DIR_NAME='DeusEdixProjects/legacy/Save', SAVE_DIR=self.game / 'DeusEdixProjects/legacy/Save')
        self.project_game = module('project_game', self.settings)

    def tearDown(self):
        self.temp.cleanup()

    def text(self):
        return self.ini.read_text(encoding='latin1')

    def test_play_saves_in_deusedix_folder_and_closing_puts_the_players_back(self):
        self.assertTrue(self.project_game.activate(self.PATHS, play=True))
        self.assertEqual(self.text().count(self.OWN), 2)
        self.assertNotIn('MySaves', self.text())
        self.assertIn('ServerActors=DevMod.UCLegacyActor', self.text())
        self.assertIn('Paths=..\\DevMaps\\*.u', self.text())
        self.assertTrue(self.settings.SAVE_DIR.is_dir())
        self.assertTrue(self.project_game.deactivate_if_current())
        text = self.text()                                  # each section's own SavePath again
        self.assertLess(text.index('SavePath=..\\MySaves\n'), text.index('[RevisionInternal.LaunchSystem]'))
        self.assertGreater(text.index('SavePath=..\\Save\n'), text.index('[RevisionInternal.LaunchSystem]'))
        self.assertNotIn('DeusEdixProjects', self.text())
        self.assertIn('ServerActors=DevMod.UCLegacyActor', self.text())
        self.assertIn('Paths=..\\DevMaps\\*.u', self.text())
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


if __name__ == '__main__':
    unittest.main()
