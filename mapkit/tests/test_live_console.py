"""live.console while the game holds its files for a moment: the launch's user ini while it saves UCConsoleLink's
answer, UCConsole.txt while it execs it. Windows refuses the other side then; the Console tries again instead of failing
(the command file through project_game.write_file, which waits out a sharing violation)."""
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import live  # noqa: E402
import project_game  # noqa: E402

RUNNING = dict(owned=True, running=True, stopping=False, launching=False, error='', token='t')


class BusyIni:
    """RevisionUser.ini as the game leaves it: refused `busy` times, then UCConsoleLink's answer to command `done`."""
    def __init__(self, busy, done, result):
        self.busy, self.text = busy, '%s\r\nDone=%d\r\nResult=%s\r\n' % (live.CONSOLE, done, result)

    def read_text(self, **_):
        if self.busy:
            self.busy -= 1
            raise PermissionError(13, 'Permission denied')
        return self.text


class ConsoleTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        live.STATE['console'] = 0
        patches = [mock.patch.object(live, 'session_status', return_value=RUNNING),
                   mock.patch.object(live, 'CONSOLE_CMD', Path(self.dir.name) / 'UCConsole.txt')]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_an_answer_read_while_the_game_writes_its_ini_comes_after_it(self):
        with mock.patch.object(live, 'INI', BusyIni(3, 1, '500')):
            self.assertEqual(live.console('get DeusExPlayer Credits'), '500')
        self.assertIn('set UCConsoleLink Cmd get DeusExPlayer Credits', live.CONSOLE_CMD.read_text(encoding='latin1'))

    def test_the_command_file_is_written_when_the_game_lets_go_of_it(self):
        real, refused = project_game.os.replace, []

        def replace(src, dst):
            if len(refused) < 2:
                refused.append(dst)
                raise PermissionError(13, 'Permission denied')
            return real(src, dst)
        with mock.patch.object(live, 'INI', BusyIni(0, 1, '')), mock.patch.object(project_game.os, 'replace', replace):
            self.assertEqual(live.console('pause'), '')
        self.assertEqual(len(refused), 2)
        self.assertTrue(live.CONSOLE_CMD.exists())

    def test_a_game_that_never_answers_still_gives_none_in_time(self):
        with mock.patch.object(live, 'INI', BusyIni(10 ** 6, 1, '')):
            t0 = time.time()
            self.assertIsNone(live.console('slomo 0.25', timeout=0.5))
            self.assertLess(time.time() - t0, 2)


if __name__ == '__main__':
    unittest.main()
