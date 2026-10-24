"""A drawing's textured preview (editor/drawn.py look()): the faces the build makes, each with the setting whose texture
it shows and the texture coordinates the build writes for it."""
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import drawn  # noqa: E402
import geom  # noqa: E402
import t3d  # noqa: E402

FLOOR = dict(kind='floor', name='F', pts=[[0, 0], [256, 0], [256, 192], [0, 192]], z=0)
DOOR = dict(name='Door', lo=[200, -64, 0], hi=[300, 64, 112], hole=True, tex='DoorFrame_A')


def settings(p, holes=()):
    return {(g['setting'], g['tex']) for g in drawn.look(p, holes)}


class Look(unittest.TestCase):
    def test_each_face_knows_its_setting(self):
        self.assertEqual(settings(dict(kind='wall', pts=[[0, 0], [256, 0]], z=0)), {('tex', 'graycncrtwall_a')})
        self.assertEqual(settings(FLOOR), {('tex', 'flatconcrete_a'), ('edgeTex', 'ClenGreyCncrt_B')})
        ceiling = dict(FLOOR, kind='ceiling', underTex='X_Under')
        self.assertEqual(settings(ceiling), {('tex', 'flatconcrete_a'), ('underTex', 'X_Under'), ('edgeTex', 'ClenGreyCncrt_B')})
        stairs = dict(kind='stairs', pts=[[0, 0], [320, 0]], z=0, rise=160, tex='X_Tread', riserTex='X_Riser', sideTex='X_Side')
        self.assertEqual(settings(stairs), {('tex', 'X_Tread'), ('riserTex', 'X_Riser'), ('sideTex', 'X_Side')})
        road = dict(kind='road', pts=[[0, 0], [512, 0]], z=0)
        self.assertEqual({k for k, _t in settings(road)}, {'tex', 'walkTex', 'curbTex'})

    def test_two_settings_with_one_texture_stay_apart(self):
        roof = dict(kind='roof', pts=[[0, 0], [0, 200]], z=128)      # underTex and sideTex both flatconcrete_a
        self.assertEqual({k for k, _t in settings(roof)}, {'tex', 'underTex', 'sideTex'})

    def test_the_walls_of_a_hole_are_the_holes(self):
        self.assertIn(('', 'DoorFrame_A'), settings(dict(kind='wall', pts=[[0, 0], [512, 0]], z=0), [DOOR]))

    def test_texture_coordinates_are_the_builds(self):
        """Every corner's (u, v) is what the build's T3D maps there: (corner - Origin) . TextureU / texture width."""
        for p, holes in ((FLOOR, ()), (dict(kind='wall', pts=[[0, 0], [256, 0], [256, 256]], z=0, rot=[0, 3000, 0]), [DOOR]),
                         (dict(kind='stairs', pts=[[0, 0], [256, 256]], z=0, rise=128, shape='curved'), ())):
            built, _report = drawn.all_brushes({'drawn': [p], 'boxes': holes})
            want = {}
            for _name, brush in built:
                for poly in t3d.blocks(brush.t3d()):
                    for b in t3d.walk([poly]):
                        if b.kind != 'Polygon':
                            continue
                        o, u, v = (b.numbers(k) for k in ('Origin', 'TextureU', 'TextureV'))
                        tu, tv = geom.tex_size(b.fields['Texture'])
                        for line in b.lines:
                            if line.startswith('Vertex'):
                                q = [float(c) for c in line.split(None, 1)[1].split(',')]
                                d = [q[k] - o[k] for k in range(3)]
                                want.setdefault(tuple(round(c, 1) for c in q), set()).add(
                                    (round(sum(d[k] * u[k] for k in range(3)) / tu, 2), round(sum(d[k] * v[k] for k in range(3)) / tv, 2)))
            for g in drawn.look(p, holes):
                for i in range(0, len(g['pos']), 3):
                    corner = tuple(round(c, 1) for c in g['pos'][i:i + 3])
                    uv = (round(g['uv'][i // 3 * 2], 2), round(g['uv'][i // 3 * 2 + 1], 2))
                    self.assertTrue(any(abs(uv[0] - a) < 0.02 and abs(uv[1] - b) < 0.02 for a, b in want[corner]), (p['kind'], corner, uv))


if __name__ == '__main__':
    unittest.main()
