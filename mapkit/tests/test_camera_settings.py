"""The 3D view's camera from the game: the player's field of view (editor/game_fov.py, Settings > Camera's default)
and the map's TrueNorth (mapsettings.true_north, the heading under the axis widget)."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
sys.path[:0] = [str(KIT / 'editor'), str(KIT)]
import game_fov  # noqa: E402
import mapsettings  # noqa: E402

USER_INI = (b'[Engine.Input]\r\nDefaultFOV=10\r\n[Engine.PlayerPawn]\r\nBob=0.016000\r\n'
            b'DesiredFOV=90.000000\r\nDefaultFOV=95.500000\r\n[Engine.GameInfo]\r\nDefaultFOV=40\r\n')


class PlayerFovTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fov-')
        self.addCleanup(self.temp.cleanup)
        self.ini = Path(self.temp.name) / 'RevisionUser.ini'

    def fov(self, text, target='revision'):
        self.ini.write_bytes(text)
        return game_fov.player_fov(self.ini, target)

    def test_the_player_section_default_fov_wins(self):
        self.assertEqual(self.fov(USER_INI), dict(fov=95.5, file='RevisionUser.ini'))

    def test_desired_fov_when_the_default_is_missing_or_not_a_number(self):
        self.assertEqual(self.fov(b'[Engine.PlayerPawn]\r\nDesiredFOV=100\r\n')['fov'], 100.0)
        self.assertEqual(self.fov(b'[engine.playerpawn]\r\ndefaultfov=wide\r\nDESIREDFOV=88\r\n')['fov'], 88.0)

    def test_the_game_default_without_a_usable_value(self):
        for text in (b'', b'[Engine.PlayerPawn]\r\nBob=1\r\n', b'[Engine.PlayerPawn]\r\nDefaultFOV=0\r\nDesiredFOV=400\r\n',
                     b'[Engine.GameInfo]\r\nDefaultFOV=90\r\n'):
            self.assertEqual(self.fov(text), dict(fov=86.0, file=None), text)
        self.assertEqual(self.fov(b'', 'vanilla'), dict(fov=75.0, file=None))

    def test_a_missing_file_is_the_game_default(self):
        self.assertEqual(game_fov.player_fov(Path(self.temp.name) / 'User.ini', 'vanilla'), dict(fov=75.0, file=None))

    def test_ini_value_reads_one_section_and_the_last_key(self):
        text = USER_INI.decode('latin1') + '[Engine.PlayerPawn]\r\nDefaultFOV=101\r\n'
        self.assertEqual(game_fov.ini_value(text, 'Engine.PlayerPawn', 'DefaultFOV'), '101')
        self.assertEqual(game_fov.ini_value(text, 'Engine.Input', 'defaultfov'), '10')
        self.assertIsNone(game_fov.ini_value(text, 'Engine.Missing', 'DefaultFOV'))


class TrueNorthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='north-')
        self.addCleanup(self.temp.cleanup)
        p = patch.object(mapsettings, 'CACHE', Path(self.temp.name))
        p.start()
        self.addCleanup(p.stop)

    def scene(self, name, text):
        folder = Path(self.temp.name) / name
        folder.mkdir()
        (folder / 'scene.t3d').write_text(text, encoding='latin-1')

    def test_the_level_info_true_north(self):
        self.scene('M1', 'Begin Actor Class=LevelInfo Name=LevelInfo0\n TrueNorth=5\nEnd Actor\n'
                   'Begin Actor Class=DeusExLevelInfo Name=DeusExLevelInfo0\n MapName="M1"\n TrueNorth=49152\nEnd Actor\n')
        self.assertEqual(mapsettings.true_north('M1'), 49152)

    def test_a_negative_north_wraps_and_none_is_zero(self):
        self.scene('M2', 'Begin Actor Class=DeusExLevelInfo Name=DeusExLevelInfo0\n TrueNorth=-16384\nEnd Actor\n')
        self.assertEqual(mapsettings.true_north('M2'), 49152)
        self.scene('M3', 'Begin Actor Class=DeusExLevelInfo Name=DeusExLevelInfo0\n MapName="M3"\nEnd Actor\n')
        self.assertEqual(mapsettings.true_north('M3'), 0)
        self.assertEqual(mapsettings.true_north('NotLookedAtYet'), 0)


if __name__ == '__main__':
    unittest.main()
