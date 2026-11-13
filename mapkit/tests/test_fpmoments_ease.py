"""First-person moments: eased moves laid as the game's straight steps (editor/fpmoments.py game_offsets, the same
numbers as static/fp-moment.js gameOffsets, tests/test_fp_moment_ease.mjs) and written to the UCViewMoment."""
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import fpmoments  # noqa: E402

KEYS = [dict(t=0.5, x=10, y=0, z=0, ease='smooth'), dict(t=1, x=0, y=4, z=-2)]
GAME = [(0.1, 1.04, 0, 0), (0.2, 3.52, 0, 0), (0.3, 6.48, 0, 0), (0.4, 8.96, 0, 0), (0.5, 10, 0, 0), (1, 0, 4, -2)]


class EaseTest(unittest.TestCase):
    def test_game_offsets(self):
        g = fpmoments.game_offsets(KEYS)
        self.assertEqual(len(g), len(GAME))
        for k, want in zip(g, GAME):
            for got, w in zip((k['t'], k['x'], k['y'], k['z']), want):
                self.assertAlmostEqual(got, w, places=6)
        self.assertEqual(fpmoments.game_offsets([dict(t=1, x=2, y=3, z=4)]), [dict(t=1.0, x=2.0, y=3.0, z=4.0)])

    def test_shared_out(self):
        many = [dict(t=(i + 1) * 0.2, x=5 if i % 2 else -5, ease='smooth') for i in range(10)]
        self.assertEqual(len(fpmoments.game_offsets(many)), 10)
        few = [dict(t=(i + 1) * 0.3, x=i, ease='in') for i in range(3)]
        self.assertEqual(len(fpmoments.game_offsets(few)), 15)
        five = [dict(t=(i + 1) * 0.3, x=i, ease='out') for i in range(5)]
        self.assertEqual(len(fpmoments.game_offsets(five)), 15)

    def test_props(self):
        p = fpmoments.props_of('Inspect', dict(weapon='DeusEx.WeaponPistol', clips=[], offsets=KEYS))
        self.assertEqual(p['NumOff'], '6')
        self.assertEqual(p['OffT(0)'], '0.100000')
        self.assertEqual(p['OffV(1)'], '(X=3.520000,Y=0.000000,Z=0.000000)')
        self.assertEqual(p['OffV(5)'], '(X=0.000000,Y=4.000000,Z=-2.000000)')


class ScriptMapTest(unittest.TestCase):
    def test_script_maps_get_the_moment(self):
        """A map made by a script (scene.py) gets the UCViewMoment its rule plays and its sound's package; before 13 Nov
        2026 only the original maps' build (dxmaps.py) had it, so a new map's rule played nothing."""
        from scene import Scene
        moment = dict(weapon='WeaponPistol', clips=[], offsets=KEYS,
                      sounds=[dict(t=0.1, sound='DeusExSounds.Weapons.PistolSelect')])
        rule = dict(id='R1', src='Btn', when='used', do=[dict(verb='fpmoment', a='Inspect', target='', delay=0)])
        s = Scene('FpMomentSceneTest')
        s._apply_actor_edits(dict(links=[rule], fpmoments=dict(Inspect=moment, Unused=moment)))
        blocks = [b for b in s.actors if 'Class=UCViewMoment ' in b]
        self.assertEqual(len(blocks), 1)                   # only the moments a rule plays
        self.assertIn('Name=UCFP_Inspect', blocks[0])
        self.assertIn('NumOff=6', blocks[0])
        self.assertTrue(any('DeusExSounds' in c for c in s.extra_obj), s.extra_obj)


if __name__ == '__main__':
    unittest.main()
