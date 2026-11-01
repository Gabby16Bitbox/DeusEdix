"""Runtime-only Play preparation must never overwrite installed maps."""
import contextlib
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import workspace


class WorkspacePlayInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.dist, self.maps, self.game, self.system, self.bin = (self.root / name for name in
                                                                 ('dist', 'maps', 'game', 'system', 'bin'))
        for path in (self.dist, self.maps, self.game, self.system, self.bin):
            path.mkdir()
        native = tuple(self.bin / n for n in ('DeusEdixNav.u', 'DeusEdixNav.dll'))
        for f in native:
            f.write_bytes(b'native ' + f.name.encode())
        (self.dist / 'Unit.u').write_bytes(b'new runtime')
        (self.maps / 'Test.dx').write_bytes(b'project map')
        (self.game / 'Test.dx').write_bytes(b'installed map edited outside editor')
        self.settings = types.SimpleNamespace(MAPS_DIR=self.game, GAME_SYSTEM=self.system, PACKAGE='Unit', STANDALONE=True,
                                              PROFILE={'exe': 'Revision.exe', 'short': 'Revision'},
                                              game_running=lambda target=None: False,
                                              current=lambda: {'name': 'Unit Test'})
        self.activate = Mock()
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(patch.multiple(workspace, PROJECT=self.root, DIST=self.dist, MAPS=self.maps,
                                                PACKAGES=('Unit', 'UnitSounds'), settings=self.settings,
                                                activate=self.activate, NATIVE=native))
        self.stack.enter_context(patch.object(workspace.subprocess, 'run', return_value=types.SimpleNamespace(stdout='')))

    def tearDown(self):
        self.stack.close()
        self.temp.cleanup()

    def test_runtime_only_copies_packages_preserving_all_installed_maps(self):
        (self.game / 'Unrelated.dx').write_bytes(b'unrelated')
        ok, lines = workspace.install(log=lambda *_: None, maps=False)
        self.assertTrue(ok)
        self.assertEqual((self.game / 'Unit.u').read_bytes(), b'new runtime')
        self.assertEqual((self.game / 'Test.dx').read_bytes(), b'installed map edited outside editor')
        self.assertEqual((self.game / 'Unrelated.dx').read_bytes(), b'unrelated')
        self.assertFalse(any('installed map' in line for line in lines))
        self.activate.assert_called_once()
        # DeusEdixNav, the package the runtime uses: in the game's System folder (its DLL is found only there)
        self.assertEqual((self.system / 'DeusEdixNav.dll').read_bytes(), b'native DeusEdixNav.dll')
        self.assertEqual((self.system / 'DeusEdixNav.u').read_bytes(), b'native DeusEdixNav.u')
        self.assertFalse((self.game / 'DeusEdixNav.dll').exists())

    def test_default_install_keeps_existing_map_install_behavior(self):
        ok, _ = workspace.install(log=lambda *_: None)
        self.assertTrue(ok)
        self.assertEqual((self.game / 'Test.dx').read_bytes(), b'project map')

    def test_play_preparation_does_not_activate_game_settings_before_launch(self):
        ok, _ = workspace.install(log=lambda *_: None, maps=False, activate_project=False)
        self.assertTrue(ok)
        self.activate.assert_not_called()
        self.assertEqual((self.game / 'Test.dx').read_bytes(), b'installed map edited outside editor')

    def test_shared_checkout_runtime_preserves_voice_package_and_release_fallback(self):
        self.settings.STANDALONE = False
        self.settings.PACKAGE = 'DevMod'
        self.settings.DEV, self.settings.VOICES_PACKAGE = {'package': 'DevMod'}, 'DevModVoices'
        (self.root / 'release').mkdir()
        (self.root / 'release' / 'DevModVoices.u').write_bytes(b'voice package')
        (self.dist / 'DevMod.u').write_bytes(b'shared runtime')
        with patch.object(workspace, 'PACKAGES', ('DevMod', 'DevModAnims', 'DevModModels', 'DevModSounds')):
            ok, _ = workspace.install(log=lambda *_: None, maps=False)
        self.assertTrue(ok)
        self.assertEqual((self.game / 'DevMod.u').read_bytes(), b'shared runtime')
        self.assertEqual((self.game / 'DevModVoices.u').read_bytes(), b'voice package')
        self.assertEqual((self.game / 'Test.dx').read_bytes(), b'installed map edited outside editor')

    def test_play_preparation_asks_whether_the_game_runs_without_tasklist(self):
        """settings.game_running (one list of the processes, 15-20 ms), not a tasklist run of its own (0.3-0.5 s at
        every Play whose install runs: game re-test of 30 Oct 2026, #12)."""
        with patch.object(workspace.subprocess, 'run', side_effect=AssertionError('tasklist started')):
            ok, _ = workspace.install(log=lambda *_: None, maps=False, activate_project=False)
        self.assertTrue(ok)
        self.assertEqual((self.game / 'Unit.u').read_bytes(), b'new runtime')

    def test_running_game_prevents_any_file_change(self):
        self.settings.game_running = lambda target=None: True
        with patch.object(workspace.subprocess, 'run', side_effect=AssertionError('tasklist started')):
            ok, _ = workspace.install(log=lambda *_: None, maps=False)
        self.assertFalse(ok)
        self.assertFalse((self.game / 'Unit.u').exists())
        self.activate.assert_not_called()
        self.assertEqual((self.game / 'Test.dx').read_bytes(), b'installed map edited outside editor')


if __name__ == '__main__':
    unittest.main()
