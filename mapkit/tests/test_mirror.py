"""Mirror X / Y / Z (editor/static/mirror.js, run by Node): what the build makes of a mirrored block or drawing is the
mirror image of what it made before, and the rotator arithmetic is the matrices' of geom.rotation_matrix."""
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import blocks  # noqa: E402
import drawn  # noqa: E402
import geom  # noqa: E402

MIRROR_JS = (KIT / 'editor' / 'static' / 'mirror.js').as_uri()
ABOUT = [40, -24, 72]
ROTS = [[0, 0, 0], [0, 16384, 0], [2000, 9000, -3000], [-12000, 60000, 7000], [20000, 30000, 16384], [16384, 0, 0]]


def run_mirror(calls):
    """[[function name, *args]] -> their results, from mirror.js."""
    script = ("import * as mirror from %s;\n"
              "console.log(JSON.stringify(%s.map(([f, ...a]) => mirror[f](...a))));\n" % (json.dumps(MIRROR_JS), json.dumps(calls)))
    r = subprocess.run([shutil.which('node'), '--input-type=module', '-e', script], capture_output=True, text=True, timeout=60)
    if r.returncode:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


def flip(axis):
    return [-1 if k == axis else 1 for k in range(3)]


def block(**kw):
    return dict(dict(name='UCEditBox1', lo=[-16, 8, 0], hi=[112, 72, 96], tex='ClenGreyCncrt_A', solid=True), **kw)


def built_block(b):
    centre = [(b['lo'][k] + b['hi'][k]) / 2 for k in range(3)]
    return [geom.rotate_brush(br, centre, b.get('rot')) for br in blocks.brushes(b, geom.Mat('X'), 'B')]


def built_drawing(d):
    return [br for _name, br in drawn.all_brushes({'drawn': [d]})[0]]


def corners(brushes, mirror_axis=None):
    """Every corner of the brushes, rounded (mirrored about ABOUT when asked)."""
    out = set()
    for br in brushes:
        for f in br.faces:
            for p in f.verts:
                q = [2 * ABOUT[k] - p[k] if k == mirror_axis else p[k] for k in range(3)]
                out.add(tuple(round(v, 1) + 0.0 for v in q))
    return out


@unittest.skipUnless(shutil.which('node'), 'no Node')
class MirrorTest(unittest.TestCase):
    def assertSamePoints(self, got, want, msg):
        self.assertEqual(len(got), len(want), msg)
        for p in want:
            self.assertTrue(any(max(abs(p[k] - q[k]) for k in range(3)) < 0.3 for q in got), (msg, p))

    def test_rotators_are_the_matrices(self):
        """MIRRORED is M R M and FACING is M R Y (Y the thing's own left-right mirror), as the build's matrices."""
        calls = [[f, rot, axis] for f in ('mirrorTurn', 'faceMirrored') for rot in ROTS for axis in range(3)]
        for (f, rot, axis), got in zip(calls, run_mirror(calls)):
            m, s = geom.rotation_matrix(rot), flip(axis)
            right = s if f == 'mirrorTurn' else flip(1)
            want = [[s[i] * m[i][j] * right[j] for j in range(3)] for i in range(3)]
            have = geom.rotation_matrix(got)
            for i in range(3):
                for j in range(3):
                    self.assertAlmostEqual(have[i][j], want[i][j], places=3, msg=(f, rot, axis, got))

    def test_blocks_build_as_their_mirror_image(self):
        shapes = [dict(), dict(shape='wedge'), dict(shape='cylinder', sides=7), dict(shape='cylinder', sides=8, align=True),
                  dict(shape='cone', sides=5, top=0.3), dict(shape='dome', sides=12, hollow=8), dict(shape='sphere', sides=9),
                  dict(verts=[[0, 0, 0], [1, 0, 0], [0, 1, 0], [0.2, 0.7, 1], [1, 1, 0.4]])]
        cases = [block(rot=rot, **kw) for kw in shapes for rot in ROTS[1:4]]
        calls = [['mirrorBlock', b, axis, ABOUT] for b in cases for axis in range(3)]
        for (_f, b, axis, _about), out in zip(calls, run_mirror(calls)):
            mirrored = dict(b, **out)
            self.assertSamePoints(corners(built_block(mirrored)), corners(built_block(b), axis), (b, axis, out))

    def test_cubes_mirror_without_a_half_turn(self):
        out = run_mirror([['mirrorBlock', block(rot=[0, 0, 0]), axis, ABOUT] for axis in range(3)])
        self.assertEqual([o['rot'] for o in out], [[0, 0, 0]] * 3)
        self.assertEqual(out[0]['lo'], [-32, 8, 0])     # its middle (48) about 40: 32
        self.assertEqual(run_mirror([['mirrorPoint', [10, 0, 0], 0, [-42.66666, 0, 0]]])[0], [-95.3, 0, 0])

    def test_a_sign_moves_to_the_face_on_the_other_side(self):
        b = block(sign={'text': 'EXIT', 'face': '+x', 'tex': 'UCSign1'})
        out = run_mirror([['mirrorBlock', b, 0, ABOUT], ['mirrorBlock', b, 1, ABOUT]])
        self.assertEqual(out[0]['sign']['face'], '-x')
        self.assertNotIn('sign', out[1])

    def test_drawings_build_as_their_mirror_image(self):
        cases = [dict(kind='wall', pts=[[0, 0], [256, 0], [256, 192]], z=16, rot=[0, 4000, 0]),
                 dict(kind='floor', pts=[[0, 0], [300, 0], [300, 200], [150, 80], [0, 200]], z=0),
                 dict(kind='stairs', pts=[[0, 0], [256, 256]], z=0, rise=128, shape='curved', curve=90),
                 dict(kind='stairs', pts=[[0, 0], [160, 40]], z=0, rise=256, shape='spiral', turn='right'),
                 dict(kind='roof', pts=[[0, 0], [0, 200]], z=128, shape='gable', width=320)]
        calls = [['mirrorDrawing', d, axis, ABOUT] for d in cases for axis in range(2)]
        for (_f, d, axis, _about), out in zip(calls, run_mirror(calls)):
            self.assertSamePoints(corners(built_drawing(dict(d, **out))), corners(built_drawing(d), axis), (d, axis, out))
        self.assertIsNone(run_mirror([['mirrorDrawing', cases[0], 2, ABOUT]])[0])

    def test_animations_move_and_turn_the_mirrored_way(self):
        m = {'pos': [{'t': 0, 'v': [0, 0, 0]}, {'t': 1, 'v': [64, 32, 16]}], 'rot': [{'t': 1, 'v': [100, 200, 300]}], 'mode': 'loop'}
        block_x, object_z = run_mirror([['mirrorMotion', m, 0, True], ['mirrorMotion', m, 2, False]])
        self.assertEqual(block_x['pos'][1]['v'], [-64, 32, 16])
        self.assertEqual(block_x['rot'][0]['v'], [-100, -200, 300])
        self.assertEqual(object_z['pos'][1]['v'], [64, 32, -16])
        self.assertEqual(object_z['rot'][0]['v'], [-100, 200, -300])
        self.assertEqual(object_z['mode'], 'loop')


if __name__ == '__main__':
    unittest.main()
