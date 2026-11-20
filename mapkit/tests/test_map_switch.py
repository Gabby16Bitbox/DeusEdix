"""The original game starts on the command line's map only with -hax0r on the line (its UGameEngine::Init, 20 Nov 2026):
settings.game_command adds it to every launch of the original game that names a map, and only there."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import settings  # noqa: E402

OTHER = r'Z:\NotSteam\DeusEx'      # not in a Steam library: the game's own program


class MapSwitch(unittest.TestCase):
    def test_original_game_map_gets_hax0r(self):
        argv, _ = settings.game_command(['01_Map?Mutator=X.Y', 'INI=a,', 'USERINI=b,'], target='vanilla', folder=OTHER)
        self.assertEqual(argv[1:], ['01_Map?Mutator=X.Y', 'INI=a,', 'USERINI=b,', '-hax0r'])

    def test_not_twice(self):
        argv, _ = settings.game_command(['01_Map', '-HAX0R'], target='vanilla', folder=OTHER)
        self.assertEqual(argv[1:], ['01_Map', '-HAX0R'])

    def test_no_map_no_switch(self):
        argv, _ = settings.game_command(['-windowed'], target='vanilla', folder=OTHER)
        self.assertEqual(argv[1:], ['-windowed'])

    def test_revision_unchanged(self):
        argv, _ = settings.game_command(['01_Map', '-windowed'], target='revision', folder=OTHER)
        self.assertEqual(argv[1:], ['01_Map', '-windowed'])


if __name__ == '__main__':
    unittest.main()
