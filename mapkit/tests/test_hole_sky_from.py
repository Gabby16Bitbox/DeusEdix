"""A hole open to the sky on its sides from a height (editor/zones.py sky_from, hole_brushes): below it the sides keep
the hole's texture (the fronts of the buildings round a street), above it they are the sky; every face of the brush
keeps its number, the parts above come after them."""
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import zones  # noqa: E402


def hole(**kw):
    return dict(dict(name='UCEditBox0', lo=[0, 0, 0], hi=[256, 128, 320], tex='ClenGreyCncrt_A', hole=True, sky=True,
                     skySides=True), **kw)


def faces(b):
    [br] = zones.hole_brushes(b, b['name'])
    return br.faces


class SkyFrom(unittest.TestCase):
    def test_only_with_the_sky_on_its_sides(self):
        self.assertEqual(zones.sky_from(hole(skyFrom=96)), 96)
        self.assertIsNone(zones.sky_from(hole()))
        self.assertIsNone(zones.sky_from(hole(skyFrom=96, skySides=False)))
        self.assertIsNone(zones.sky_from(hole(skyFrom=96, sky=False)))
        for h in (0, -5, 320, 400, 'x', None, float('nan')):
            self.assertIsNone(zones.sky_from(hole(skyFrom=h)), h)

    def test_the_whole_side_without_it(self):
        fs = faces(hole())
        self.assertEqual(len(fs), 6)
        self.assertEqual(sorted(f.mat.tex for f in fs).count(zones.SKY_TEX), 5)     # the sides and the top

    def test_cut_at_the_height(self):
        fs = faces(hole(skyFrom=96))
        self.assertEqual(len(fs), 10)
        own, above = fs[:6], fs[6:]
        for f in own:
            zs = [p[2] for p in f.verts]
            if abs(f.normal[2]) > 0.999:
                self.assertEqual(f.mat.tex, zones.SKY_TEX if f.normal[2] > 0 else 'ClenGreyCncrt_A')
            else:                                       # a side: its texture, from the floor to the cut
                self.assertEqual((f.mat.tex, min(zs), max(zs)), ('ClenGreyCncrt_A', 0, 96))
                self.assertEqual(len(f.verts), 4)
        for f in above:                                 # the sky, from the cut to the top
            zs = [p[2] for p in f.verts]
            self.assertEqual((f.mat.tex, f.mat.flags, min(zs), max(zs)), (zones.SKY_TEX, zones.PF_FAKEBACKDROP, 96, 320))
            self.assertLess(abs(f.normal[2]), 0.001)
        # the brush the game gets: four sides cut, the same planes
        text = zones.hole_brushes(hole(skyFrom=96), 'H')[0].t3d(inside=True)
        self.assertEqual(text.count('Texture=Marker_sky'), 5)
        self.assertEqual(text.count('Begin Polygon'), 10)

    def test_a_round_hole_and_a_turned_one(self):
        import blocks
        b = hole(shape='cylinder', skyFrom=200)
        n = blocks.options(b)['sides']
        sides = [f for f in faces(b) if abs(f.normal[2]) < 0.001]
        self.assertEqual(len(sides), 2 * n)
        self.assertEqual(sum(f.mat.tex == zones.SKY_TEX for f in sides), n)
        self.assertTrue(all(f.u is not None for f in sides))          # the texture round it, cut with the faces
        import geom
        [br] = zones.hole_brushes(hole(skyFrom=96, rot=[0, 8192, 0]), 'H')
        turned = geom.rotate_brush(br, [128, 64, 160], [0, 8192, 0], True)
        self.assertEqual(len(turned.faces), 10)

    def test_a_cut_through_a_corner(self):
        low, high = zones._cut([(0, 0, 0), (10, 0, 50), (0, 0, 100)], 50)
        self.assertEqual(low, [(0, 0, 0), (10, 0, 50), (0, 0, 50)])      # and the way back crosses it too
        self.assertEqual(high, [(10, 0, 50), (0, 0, 100), (0, 0, 50)])


if __name__ == '__main__':
    unittest.main()
