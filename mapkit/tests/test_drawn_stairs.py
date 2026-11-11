"""Stairs and roofs drawn in the map editor (editor/drawn.py, 20 Oct 2026): the parts as Deus Ex makes stairs,
their brushes and textures, and the same parts in the editor's preview (static/draw-tools.js, run by Node).

    tools\\mapkit\\.venv\\Scripts\\python.exe -m unittest tests.test_drawn_stairs
"""
import json
import math
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent), str(HERE.parent / 'editor')]
import drawn  # noqa: E402

STATIC = HERE.parent / 'editor' / 'static'
CASES = [
    dict(kind='stairs', pts=[[0, 0], [320, 0]], z=0, rise=160),
    dict(kind='stairs', pts=[[320, 64], [0, 64]], z=160, rise=-160),                 # drawn from the top down
    dict(kind='stairs', pts=[[0, 0], [200, 150]], z=48, rise=100, width=96, riser=18),
    dict(kind='stairs', pts=[[0, 0], [256, 256]], z=0, rise=128, shape='curved', curve=90),
    dict(kind='stairs', pts=[[0, 0], [256, 0]], z=0, rise=160, shape='curved', curve=200, turn='right', landing=48),
    dict(kind='stairs', pts=[[0, 0], [160, 0]], z=0, rise=256, shape='spiral'),
    dict(kind='stairs', pts=[[0, 0], [0, 200]], z=0, rise=320, shape='spiral', turn='right', inner=0, per360=12),
    dict(kind='stairs', pts=[[0, 0], [256, 0]], z=0, rise=96, form='ramp', landing=64),
    dict(kind='stairs', pts=[[0, 0], [256, 128]], z=0, rise=96, form='ramp', shape='curved', curve=60, base='floating'),
    dict(kind='stairs', pts=[[0, 0], [320, 0]], z=0, rise=4),                        # one level: a ramp
    dict(kind='stairs', pts=[[0, 0], [320, 0]], z=0, rise=160, base='floating', thick=8),
    dict(kind='roof', pts=[[0, 0], [256, 0]], z=160, rise=0),
    dict(kind='roof', pts=[[0, 0], [100, 100]], z=160, rise=96, shape='gable', width=320),
]
NODE = shutil.which('node')


def js_parts():
    script = ("import { stairParts, roofParts } from %s;\n"
              "const cases = %s;\n"
              "console.log(JSON.stringify(cases.map((p) => (p.kind === 'stairs' ? stairParts(p) : roofParts(p)))));\n"
              % (json.dumps((STATIC / 'draw-tools.js').as_uri()), json.dumps(CASES)))
    r = subprocess.run([NODE, '--input-type=module', '-e', script], capture_output=True, text=True, timeout=60)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return json.loads(r.stdout)


def flat(v):
    if isinstance(v, (list, tuple)):
        return [x for e in v for x in flat(e)]
    return [float(v)]


class Stairs(unittest.TestCase):
    def test_like_the_game(self):
        parts = drawn.stair_parts(CASES[0])
        self.assertEqual(len(parts), 10)                     # 160 high: ten steps of 16, 32 deep (the game's)
        self.assertEqual([p['z1'] for p in parts], [16.0 * (i + 1) for i in range(10)])
        self.assertTrue(all(p['z0'] == 0 for p in parts))     # solid down to the floor
        depths = [abs(b['nose'][0] - a['nose'][0]) for a, b in zip(parts, parts[1:])]
        self.assertTrue(all(abs(d - 32) < 1e-6 for d in depths))

    def test_steeper_and_shallower(self):
        steep = drawn.stair_parts(dict(kind='stairs', pts=[[0, 0], [160, 0]], z=0, rise=160))
        long = drawn.stair_parts(dict(kind='stairs', pts=[[0, 0], [640, 0]], z=0, rise=160))
        self.assertEqual(len(steep), len(long))               # as many steps: the treads follow the run
        self.assertAlmostEqual(steep[1]['nose'][0] - steep[0]['nose'][0], 16)
        self.assertAlmostEqual(long[1]['nose'][0] - long[0]['nose'][0], 64)

    def test_same_level_is_a_ramp(self):
        parts = drawn.stair_parts(CASES[9])
        self.assertEqual(len(parts), 1)
        self.assertIn('pts', parts[0])

    def test_downwards_is_the_same(self):
        up, down = drawn.stair_parts(CASES[0]), drawn.stair_parts(CASES[1])
        self.assertEqual(len(up), len(down))
        self.assertEqual(down[0]['z1'], 16)                   # from the lower end

    def test_curved_ends_at_b(self):
        parts = drawn.stair_parts(CASES[3])
        ring = parts[-1]['poly']
        mid = [(ring[i][0] + ring[(i + 1) % 4][0]) / 2 for i in range(4)], [(ring[i][1] + ring[(i + 1) % 4][1]) / 2 for i in range(4)]
        self.assertTrue(any(math.hypot(x - 256, y - 256) < 1 for x, y in zip(*mid)))   # its last edge's middle is B

    def test_spiral(self):
        parts = drawn.stair_parts(CASES[5])
        steps = [p for p in parts if not p.get('column')]
        self.assertEqual(len(steps), 16)
        self.assertTrue(all(p['z1'] - p['z0'] == 16 for p in steps))      # floating, never solid (it overlaps)
        self.assertTrue(parts[-1].get('column'))
        no_col = drawn.stair_parts(CASES[6])
        self.assertFalse(any(p.get('column') for p in no_col))

    def test_textures_follow_each_step(self):
        p = dict(CASES[2])
        brushes = drawn.brushes(p)
        parts = drawn.stair_parts(p)
        for b, part in zip(brushes, parts):
            tread = [f for f in b.faces if f.normal[2] > 0.99][0]
            self.assertEqual(tread.mat.tex, 'ClenGreyStair_A')
            # V runs up the stairs, U across, from the step's own front edge
            v = tread.v
            self.assertAlmostEqual((v[0] * part['run'][0] + v[1] * part['run'][1]) / math.hypot(*v[:2]), 1, places=5)
            self.assertAlmostEqual(tread.origin[2], part['top'])
            riser = [f for f in b.faces if abs(f.normal[2]) < 0.01 and f.normal[0] * part['run'][0] + f.normal[1] * part['run'][1] < -0.7][0]
            self.assertEqual(riser.mat.tex, 'SB_StairFrnt_A')
            self.assertEqual(riser.v[2] < 0, True)

    def test_roof(self):
        parts = drawn.roof_parts(CASES[11])
        self.assertEqual(len(parts), 1)
        zs = sorted({round(q[2], 3) for q in parts[0]['pts']})
        self.assertAlmostEqual(zs[-1], 160 + 256 * math.tan(math.radians(30)) + 16, places=3)   # its pitch
        self.assertEqual(len(drawn.roof_parts(CASES[12])), 2)
        b = drawn.brushes(CASES[11])[0]
        top = max(b.faces, key=lambda f: f.normal[2])
        self.assertEqual(top.mat.tex, 'ClayBrwnRoofT_A')
        self.assertLess(top.v[2], 0)                          # the tiles run down from the ridge

    def test_every_case_builds(self):
        for c in CASES:
            bs = drawn.brushes(c)
            self.assertTrue(bs, c)
            for b in bs:
                self.assertIn('Begin Polygon', b.t3d())

    def test_textures_packages_are_known(self):
        self.assertIn('V_Com_Center', drawn.packages({'drawn': [CASES[0]]}))
        self.assertIn('SubBase', drawn.packages({'drawn': [CASES[0]]}))

    @unittest.skipUnless(NODE, 'no Node')
    def test_preview_is_the_same(self):
        js = js_parts()
        for c, a, b in zip(CASES, [drawn.stair_parts(c) if c['kind'] == 'stairs' else drawn.roof_parts(c) for c in CASES], js):
            self.assertEqual(len(a), len(b), c)
            for pa, pb in zip(a, b):
                self.assertEqual(sorted(k for k in pa if k != 'column'), sorted(k for k in pb if k != 'column'), c)
                for k in pa:
                    if k == 'column':
                        continue
                    fa, fb = flat(pa[k]), flat(pb[k])
                    self.assertEqual(len(fa), len(fb), (c, k))
                    for x, y in zip(fa, fb):
                        self.assertAlmostEqual(x, y, places=4, msg=(c, k))


if __name__ == '__main__':
    unittest.main()
