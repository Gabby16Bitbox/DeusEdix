"""Play clears a map's saved state only in DeusEdix's own folders, never in the player's own Save folder."""
import contextlib
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import live


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
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(patch.multiple(live, INI=self.ini, CMD=self.root / 'UCLive.txt', REV=self.root,
                                                CONSOLE_CMD=self.root / 'UCConsole.txt', PLAY_INI=None,
                                                SYS=self.root, _SESSION=session,
                                                STATE={'seq': 0, 'folder': None, 'maps': set(), 'command_written': False}))
        self.stack.enter_context(patch.dict(sys.modules, {'workspace': types.SimpleNamespace(activate=Mock())}))

    def tearDown(self):
        self.stack.close()
        self.temp.cleanup()

    def save(self, folder, name='TestMap'):
        path = folder / (name + '.dxs')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'saved state of ' + name.encode())
        return path

    def play(self, maps, managed):
        with patch.object(live, 'settings', types.SimpleNamespace(MAPS_DIR=maps, MANAGED_PROJECT=managed)):
            live.play('TestMap')

    def test_managed_project_clears_only_that_map_in_its_own_save_folder(self):
        maps = self.root / 'DeusEdixProjects' / 'my-project'
        stale = self.save(maps / 'Save' / 'Current')
        other = self.save(maps / 'Save' / 'Current', 'OtherMap')
        player = self.save(self.player)
        self.play(maps, True)
        self.assertFalse(stale.exists())
        self.assertEqual(other.read_bytes(), b'saved state of OtherMap')
        self.assertEqual(player.read_bytes(), b'saved state of TestMap')

    def test_existing_workspace_never_touches_the_players_saves(self):
        # the installed editor's own workspace and a mod's working copy: their game saves where the player's does
        for folder in ('DeusEdixMaps', 'MyModMaps'):
            with self.subTest(folder=folder):
                player = self.save(self.player)
                maps = self.root / folder
                kept = self.save(maps / 'Save' / 'Current')
                self.play(maps, False)
                self.assertEqual(player.read_bytes(), b'saved state of TestMap')
                self.assertTrue(kept.exists())

    def test_a_save_folder_outside_deusedix_folders_is_never_cleared(self):
        player = self.save(self.player)
        self.play(self.root, True)                          # MAPS_DIR\Save would be the player's Save folder
        self.assertEqual(player.read_bytes(), b'saved state of TestMap')
        with patch.object(live, 'settings', types.SimpleNamespace(MAPS_DIR=self.root / 'DeusEdixProjects' / 'p',
                                                                  MANAGED_PROJECT=True)):
            self.assertIsNone(live._own_saved_state('..\\..\\..\\..\\Save\\Current\\TestMap'))
            self.assertEqual(live._own_saved_state('TestMap'),
                             (self.root / 'DeusEdixProjects' / 'p' / 'Save' / 'Current' / 'TestMap.dxs').resolve())


if __name__ == '__main__':
    unittest.main()
