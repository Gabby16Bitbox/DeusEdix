"""The sky box of Map > Sky & time of day: the painted walls and the cloud layer (editor/zones.py)."""
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'editor'))

import geom  # noqa: E402
import zones  # noqa: E402

geom.register('SkyWallsT', 1024, 1024)
geom.register('SkyTopT', 512, 512)
geom.register('SkyCloudsT', 512, 512)


def edits(**clouds):
    lv = {'sky': 'mine', 'skyLook': {'walls': 'SkyWallsT', 'top': 'SkyTopT', 'bottom': 'SkyTopT'}}
    if clouds:
        lv['clouds'] = dict({'look': 'soft', 'tex': 'SkyCloudsT', 'height': 8, 'size': 40, 'speed': 25, 'wind': 135}, **clouds)
    return {'level': lv, 'boxes': [{'name': 'Hole1', 'hole': True, 'sky': True, 'lo': [0, 0, 0], 'hi': [256, 256, 128]}]}


class SkyWalls(unittest.TestCase):
    def test_painted_walls_once_top_to_bottom(self):
        (op, brush, _f), = zones.skybox(edits(), False)[0]
        c, h = zones.SKYBOX_CENTER, zones.SKYBOX_SIZE / 2
        for f in brush.faces:
            if abs(f.normal[2]) > 0.5:
                continue
            U, V, origin = geom.mapping(f, True)
            # V: the 1024 rows over the wall's 2048 height, downwards; row 1 on the top edge (row 0 would mix in
            # the last one: the texture wraps)
            self.assertAlmostEqual(V[2], -1024 / zones.SKYBOX_SIZE)
            top_row = sum((p - o) * v for p, o, v in zip((f.verts[0][0], f.verts[0][1], c[2] + h), origin, V))
            self.assertAlmostEqual(top_row % 1024, 1.0, places=3)
            self.assertAlmostEqual(math.hypot(U[0], U[1]), 1024 / zones.SKYBOX_SIZE)

    def test_game_sky_unchanged(self):
        e = edits()
        e['level'] = {'sky': 'hongkong'}
        (op, brush, _f), = zones.skybox(e, False)[0]
        self.assertTrue(all(f.mat.align == (0.0, 0.0, 0.0) for f in brush.faces))


class CloudLayer(unittest.TestCase):
    """The clouds as the game's levels make them: a sheet of the sky box panned by the engine."""

    def sheet(self, **clouds):
        ops, actors = zones.skybox(edits(**clouds), False)
        return ops, actors[0]['props']

    def test_none_without_clouds_or_with_a_sky_of_the_map(self):
        self.assertEqual(len(zones.skybox(edits(), False)[0]), 1)
        self.assertEqual(len(self.sheet(look='none')[0]), 1)
        self.assertEqual(zones.skybox(edits(look='soft'), True), ([], []))
        self.assertEqual(len(self.sheet(look='game', tex='NotACloud')[0]), 1)

    def test_sheet_height_flags_and_pan(self):
        ops, props = self.sheet(height=8, size=0, speed=100, wind=180)
        (op, brush, fl) = ops[1]
        self.assertEqual((op, fl), ('add', zones.PF_SEMISOLID))
        c, h = zones.SKYBOX_CENTER, zones.SKYBOX_SIZE / 2
        high = h * math.tan(math.radians(8))
        (bottom,) = [f for f in brush.faces if f.normal[2] < -0.5]
        self.assertAlmostEqual(bottom.verts[0][2] - c[2], high, places=3)
        self.assertEqual(bottom.mat.flags, zones.CLOUD_FLAGS | zones.PF_AUTOUPAN)
        self.assertFalse(bottom.mat.flags & zones.PF_NOTSOLID)
        self.assertTrue(all(f.mat.flags == zones.PF_INVISIBLE for f in brush.faces if f is not bottom))
        # inside the box, its walls untouched
        self.assertTrue(all(abs(v[k] - c[k]) < h for f in brush.faces for v in f.verts for k in (0, 1)))
        # the zone pans it: one tile (2 x high, size 0) in 2 x 10 / 1 seconds at full wind
        speed = high * 0.1
        self.assertAlmostEqual(abs(float(props['TexUPanSpeed'])), speed * 512 / (high * 2) / zones.PAN_RATE, places=5)
        self.assertEqual(float(props['TexVPanSpeed']), 0.0)

    def test_texture_turned_to_the_wind(self):
        for wind, along in ((180, (1, 0)), (270, (0, 1)), (45, (-0.7071, -0.7071))):
            ops, props = self.sheet(wind=wind, speed=50)
            (bottom,) = [f for f in ops[1][1].faces if f.normal[2] < -0.5]
            n = math.hypot(bottom.u[0], bottom.u[1])
            self.assertAlmostEqual(bottom.u[0] / n, along[0], places=3)
            self.assertAlmostEqual(bottom.u[1] / n, along[1], places=3)

    def test_still_clouds_do_not_pan(self):
        ops, props = self.sheet(speed=0)
        (bottom,) = [f for f in ops[1][1].faces if f.normal[2] < -0.5]
        self.assertFalse(bottom.mat.flags & zones.PF_AUTOUPAN)
        self.assertEqual(float(props['TexUPanSpeed']), 0.0)

    def test_the_games_clouds(self):
        ops, props = self.sheet(look='game', tex='ClenCloudBank_B')
        (bottom,) = [f for f in ops[1][1].faces if f.normal[2] < -0.5]
        self.assertEqual(bottom.mat.tex, 'ClenCloudBank_B')
        self.assertIn('OBJ LOAD FILE="CoreTexSky.utx"', zones.packages(edits(look='game', tex='ClenCloudBank_B')))

    def test_t3d(self):
        ops, props = self.sheet(look='puffy')
        text = ops[1][1].t3d()
        self.assertIn('Texture=SkyCloudsT', text)
        self.assertIn('Flags=%d' % (zones.CLOUD_FLAGS | zones.PF_AUTOUPAN), text)


def _inside(p, poly):
    """p inside the convex polygon poly (either winding)."""
    sign = 0
    for i in range(len(poly)):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % len(poly)]
        c = (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax)
        if abs(c) < 1e-6:
            continue
        s = 1 if c > 0 else -1
        if sign and s != sign:
            return False
        sign = s
    return True


if __name__ == '__main__':
    unittest.main()
