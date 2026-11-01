"""Live runner configuration belongs to the verified editor launch, not the process name. Since 29 Oct 2026 (A2) it is in
the launch's own copies of the game's ini files, which go with the game: the player's own are never written."""
import contextlib
import re
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import live
from game_process import GameSession
from test_game_process import FakeProcesses


class LiveSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.ini = self.root / 'RevisionUser.ini'                 # the player's own user ini (with another runner's section)
        self.original = '[Engine.Player]\nName=JC\n\n' + live.RUNNER + '\nbActive=False\nStartDelay=8\n'
        self.ini.write_text(self.original, encoding='latin1')
        self.game_ini = self.root / 'Revision.ini'
        self.game_ini.write_bytes(b'[Core.System]\r\nSavePath=..\\Save\r\nPaths=..\\Maps\\*.dx\r\n')
        self.copies = (self.root / 'DeusEdixPlay_p.ini', self.root / 'DeusEdixPlay_pUser.ini')
        self.maps = self.root / 'Maps'
        self.maps.mkdir()
        self.processes = FakeProcesses()
        self.manager = GameSession(self.processes, launch_timeout=0.2, poll=0.005)
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(patch.multiple(live, PLAY_INI=self.copies[0], INI=self.copies[1], CMD=self.root / 'UCLive.txt',
                                                REV=self.root, CONSOLE_CMD=self.root / 'UCConsole.txt', WINDOWED=['-windowed'],
                                                LOADOUT=self.root / 'UCLoadout.txt', EXIT_WAIT=0.05,
                                                SYS=self.root, SHOTS=self.root / 'shots', _SESSION=self.manager,
                                                STATE={'seq': 0, 'folder': None, 'maps': set(), 'command_written': False},
                                                settings=types.SimpleNamespace(MAPS_DIR=self.maps, SAVE_DIR=self.maps / 'Save', MANAGED_PROJECT=True,
                                                    MAPS_DIR_NAME='DeusEdixProjects/p', GAME_INI=self.game_ini, USER_INI=self.ini,
                                                    # a Steam copy: started through Steam (settings.game_command)
                                                    game_command=lambda args: (['C:\Steam\Steam.exe', '-applaunch', '397550'] + list(args), None))))
        self.stack.enter_context(patch.dict(sys.modules, {
            'workspace': types.SimpleNamespace(paths_lines=lambda: ['Paths=..\\DeusEdixProjects\\p\\*.dx']),
            'winreg': types.SimpleNamespace(HKEY_CURRENT_USER=1, OpenKey=lambda *_: contextlib.nullcontext(1),
                                           QueryValueEx=lambda *_: ('C:\\Steam\\Steam.exe', 1)),
        }))
        def dispatch(args, **kwargs):
            token = re.search(r'\?DeusEdixSession=([a-f0-9]+)', args[3]).group(1)
            self.processes.add(token)
        self.stack.enter_context(patch.object(live.subprocess, 'Popen', side_effect=dispatch))

    def until_owned(self):
        import time
        deadline = time.monotonic() + 2
        while not live.session_status()['owned']:
            if time.monotonic() > deadline:
                self.fail('Launch was not claimed')
            time.sleep(0.005)

    def tearDown(self):
        self.processes.close_error = None
        self.processes.identities.clear()
        self.manager.stop(timeout=0)
        self.stack.close()
        self.temp.cleanup()

    def players_untouched(self, text=None):
        self.assertEqual(self.ini.read_text(encoding='latin1'), self.original if text is None else text)
        self.assertEqual(self.game_ini.read_bytes(), b'[Core.System]\r\nSavePath=..\\Save\r\nPaths=..\\Maps\\*.dx\r\n')

    def test_stop_without_owned_session_changes_no_files(self):
        """No file of the player's or of another editor's (its UCLive map, a launch copy just written)."""
        unrelated = self.maps / 'UCLive12345.dx'
        unrelated.write_bytes(b'other editor copy')
        self.copies[0].write_bytes(b'another editor of this workspace, its game starting')
        live.stop()
        self.players_untouched()
        self.assertEqual(unrelated.read_bytes(), b'other editor copy')
        self.assertEqual(self.copies[0].read_bytes(), b'another editor of this workspace, its game starting')

    def test_owned_stop_removes_the_runner_with_the_copies_preserving_player_changes(self):
        live.play('TestMap')
        self.until_owned()
        self.assertIn('bActive=True', self.copies[1].read_text(encoding='latin1'))
        self.players_untouched()
        self.ini.write_text(self.ini.read_text(encoding='latin1').replace('Name=JC', 'Name=Changed'), encoding='latin1')
        live.stop()
        self.assertIn('Name=Changed', self.ini.read_text(encoding='latin1'))
        self.assertIn('StartDelay=8', self.ini.read_text(encoding='latin1'))
        self.assertIn('bActive=False', self.ini.read_text(encoding='latin1'))
        self.assertFalse(any(path.exists() for path in self.copies))
        self.players_untouched(self.original.replace('Name=JC', 'Name=Changed'))

    def test_preexisting_game_blocks_configuration_and_dispatch(self):
        self.processes.add('outside')
        with self.assertRaisesRegex(RuntimeError, 'already running'):
            live.play('TestMap')
        self.players_untouched()
        self.assertFalse(any(path.exists() for path in self.copies))
        live.subprocess.Popen.assert_not_called()

    def test_failed_termination_does_not_remove_the_runner(self):
        live.play('TestMap')
        self.until_owned()
        self.processes.close_error = RuntimeError('Denied')
        with self.assertRaisesRegex(RuntimeError, 'Denied'):
            live.stop()
        self.assertIn('bActive=True', self.copies[1].read_text(encoding='latin1'))
        self.processes.close_error = None
        live.stop()
        self.assertFalse(any(path.exists() for path in self.copies))
        self.players_untouched()

    def test_other_game_blocks_cleanup_after_owned_exit_until_it_has_closed(self):
        live.play('TestMap')
        self.until_owned()
        self.processes.add('other', pid=456)
        with self.assertRaisesRegex(RuntimeError, 'Another Revision'):
            live.stop()
        self.assertIn('bActive=True', self.copies[1].read_text(encoding='latin1'))
        self.processes.identities.clear()
        live.stop()
        self.assertFalse(any(path.exists() for path in self.copies))
        self.players_untouched()

    def test_commands_cannot_target_an_unowned_game(self):
        self.processes.add('outside')
        with self.assertRaisesRegex(RuntimeError, 'No owned game'):
            live.do('console;exit')
        self.assertFalse(live.CMD.exists())


if __name__ == '__main__':
    unittest.main()
