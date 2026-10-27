"""The Console's Time: when the editor's own game started, from its session's process creation time."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import live

NOON = 1793016000000                 # 26 October 2026, 12:00 UTC, in ms since 1970


class StartedTests(unittest.TestCase):
    def test_the_process_creation_time_in_ms_since_1970(self):
        created = str(NOON * 10000 + live.FILETIME_1970)      # as game_process gives it: a decimal FILETIME
        self.assertEqual(live.started_ms(dict(running=True, owned=True, created=created)), NOON)
        # a FILETIME's 100 ns steps under a millisecond are left out
        self.assertEqual(live.started_ms(dict(running=True, owned=True, created=str(int(created) + 9999))), NOON)

    def test_none_while_no_game_of_the_editor_runs(self):
        created = str(NOON * 10000 + live.FILETIME_1970)
        for status in ({}, dict(running=True, owned=False, created=created), dict(running=False, owned=True, created=created),
                       dict(running=True, owned=True, created=None)):
            with self.subTest(status=status):
                self.assertIsNone(live.started_ms(status))


if __name__ == '__main__':
    unittest.main()
