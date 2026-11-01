"""New map's "Dark (horror)" mood flickers some of its lamps the way the project's game can show it (measured in the game,
28 Oct 2026, backup/20261028_b6_game_fixes/lights_research.md): Revision's renderer never lights an LT_Flicker lamp,
whatever its settings, so a Revision project's room gets LT_Blink with the Light class's own LightPeriod (32: Period + 1
is not a power of two, so it never turns steady); the original game lights LT_Flicker (its LT_Blink turns steady after
7.3 x (Period + 1) seconds), so an original-game project's room keeps it. The room is read back as the same mood either
way (map templates). No game, no build: the script's lamps are read by running it on a stand-in Scene."""
import re
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT), str(KIT.parent)]
import maplinks  # noqa: E402
import newmap  # noqa: E402
import settings  # noqa: E402


def lamps(text):
    """The Light actors a New map script places ({property: value} each), its Scene and geometry stand-ins."""
    placed = []

    class Scene:
        def __init__(self, name):
            pass

        def begin_group(self, *args, **kwargs):
            pass

        def sub(self, *args, **kwargs):
            pass

        def actor(self, cls, loc, **props):
            placed.append((cls, props))

    stand_ins = {'scene': types.SimpleNamespace(Scene=Scene), 'geom': types.SimpleNamespace(Mat=str, box=lambda *a: a)}
    with patch.dict(sys.modules, stand_ins):
        exec(compile(text, 'room.py', 'exec'), {'__name__': 'room', '__file__': str(KIT / 'maps' / 'room.py')})
    return [props for cls, props in placed if cls == 'Light']


def room(mood, revision):
    """The script New map writes for a room of that mood, in a project for Revision or the original game."""
    with tempfile.TemporaryDirectory(prefix='.newmap-mood-', dir=Path(__file__).parent) as temp:
        with patch.object(newmap.kit, 'PROJECT', Path(temp)), patch.object(maplinks, 'all_maps', return_value=[]), \
                patch.object(settings, 'PROJECT_KIND', 'custom', create=True), \
                patch.object(settings, 'IS_REVISION', revision):
            script, _ = newmap.create_empty('Room', 10, (2048, 2048, 384), mood=mood)
            return (newmap.maps_folder() / (script + '.py')).read_text(encoding='utf-8')


class DarkMoodTest(unittest.TestCase):
    def test_a_revision_projects_dark_room_blinks_with_the_class_period(self):
        text = room('dark', revision=True)
        types_ = [lamp['LightType'] for lamp in lamps(text)]
        self.assertIn('LT_Blink', types_)
        self.assertNotIn('LT_Flicker', types_)
        self.assertEqual(set(types_), {'LT_Blink', 'LT_Steady'})
        self.assertFalse([lamp for lamp in lamps(text) if 'LightPeriod' in lamp])    # the class's own: 32
        self.assertEqual(newmap.room_of(text)['mood'], 'dark')

    def test_an_original_game_projects_dark_room_flickers(self):
        text = room('dark', revision=False)
        types_ = [lamp['LightType'] for lamp in lamps(text)]
        self.assertEqual(set(types_), {'LT_Flicker', 'LT_Steady'})
        self.assertEqual(newmap.room_of(text)['mood'], 'dark')

    def test_the_same_lamps_flicker_in_both_games(self):
        made = {revision: lamps(room('dark', revision)) for revision in (True, False)}
        self.assertEqual([lamp['LightType'] != 'LT_Steady' for lamp in made[True]],
                         [lamp['LightType'] != 'LT_Steady' for lamp in made[False]])
        self.assertEqual(sum(lamp['LightType'] != 'LT_Steady' for lamp in made[True]), 5)     # 4 x 4 lamps, (i + j) % 3 == 1

    def test_the_other_moods_stay_steady_and_an_older_dark_room_is_still_dark(self):
        for mood in ('normal', 'warm', 'cold'):
            with self.subTest(mood=mood):
                self.assertEqual({lamp['LightType'] for lamp in lamps(room(mood, revision=True))}, {'LT_Steady'})
        older = re.sub(r"LightType='LT_\w+' if True", "LightType='LT_Flicker' if True", room('dark', revision=True))
        self.assertIn("LightType='LT_Flicker' if True", older)
        self.assertEqual(newmap.room_of(older)['mood'], 'dark')

    def test_the_light_class_period_never_turns_steady(self):
        defaults = KIT / 'editor' / 'cache' / '_palette' / 'defaults.json'
        if not defaults.exists():
            self.skipTest('no class defaults here (cache/_palette/defaults.json)')
        import json
        period = int(json.loads(defaults.read_text(encoding='utf-8'))['classes']['Light']['props']['LightPeriod'][0])
        self.assertNotEqual((period + 1) & period, 0, 'Period + 1 a power of two: the lamp turns steady (Revision)')


if __name__ == '__main__':
    unittest.main()
