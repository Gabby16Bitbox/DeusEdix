"""Holes cut what is drawn (geom.subtract, editor/drawn.py): UnrealEd adds semisolid brushes after every subtraction,
so the drawn pieces are cut by the hole blocks before they are added."""
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import drawn  # noqa: E402
import geom  # noqa: E402
from vec3 import Vec3  # noqa: E402


def volume(brush):
    """A closed convex brush's volume (the divergence theorem over its faces)."""
    total = 0.0
    for f in brush.faces:
        a = Vec3.of(f.verts[0])
        for b, c in zip(f.verts[1:], f.verts[2:]):
            total += a.dot((Vec3.of(b) - a).cross(Vec3.of(c) - a)) / 6
    return total


def covers(f, p):
    """Is p on the face (its plane, inside its edges)?"""
    if abs(f.normal.dot(p) - f.normal.dot(f.verts[0])) > 1e-6:
        return False
    return all((Vec3.of(b) - a).cross(Vec3.of(p) - a).dot(f.normal) >= -1e-6 for a, b in zip(f.verts, f.verts[1:] + f.verts[:1]))


def on_plane_of(f, brush, facing):
    """Is face f on a plane of the brush, facing the same way (1) or the other way (-1)?"""
    return any(f.normal.dot(g.normal) * facing > 0.999 and abs(f.normal.dot(f.verts[0]) - f.normal.dot(g.verts[0])) < 1e-6
               for g in brush.faces)


def inside(brush, p, margin=0.5):
    return all(f.normal.dot(p) - f.normal.dot(f.verts[0]) < -margin for f in brush.faces)


def wall(**kw):
    return dict(dict(kind='wall', name='Wall', pts=[[0, 0], [512, 0]], z=0, height=160, thick=16), **kw)


def hole(lo, hi, **kw):
    return dict(dict(name='Door', lo=lo, hi=hi, hole=True, tex='DoorFrame_A'), **kw)


class Subtract(unittest.TestCase):
    def setUp(self):
        self.block = geom.box((0, 0, 0), (256, 128, 64), geom.Mat('Block'))

    def test_a_cutter_that_does_not_meet_it_leaves_it_whole(self):
        far = geom.box((300, 0, 0), (400, 128, 64), geom.Mat('Hole'))
        self.assertEqual(geom.subtract(self.block, far), [self.block])
        touching = geom.box((256, 0, 0), (400, 128, 64), geom.Mat('Hole'))      # face to face: nothing to take
        self.assertEqual(geom.subtract(self.block, touching), [self.block])

    def test_all_inside_the_cutter_leaves_nothing(self):
        self.assertEqual(geom.subtract(self.block, geom.box((-8, -8, -8), (300, 200, 100), geom.Mat('Hole'))), [])

    def test_the_pieces_are_the_brush_less_the_cutter(self):
        cutter = geom.box((64, 32, -16), (128, 96, 80), geom.Mat('Hole'))
        pieces = geom.subtract(self.block, cutter)
        self.assertAlmostEqual(sum(volume(p) for p in pieces), 256 * 128 * 64 - 64 * 64 * 64, places=3)
        # the hole's four walls in its texture (faces into the hole), the rest in the block's; the pieces also meet on
        # the cutter's planes, face to face inside the block
        for middle, n in (((64, 64, 32), (1, 0, 0)), ((128, 64, 32), (-1, 0, 0)), ((96, 32, 32), (0, 1, 0)), ((96, 96, 32), (0, -1, 0))):
            self.assertTrue(any(f.mat.tex == 'Hole' and f.normal.dot(n) > 0.999 and covers(f, middle) for p in pieces for f in p.faces), middle)
        for f in (f for p in pieces for f in p.faces):
            self.assertTrue(on_plane_of(f, cutter, -1) or on_plane_of(f, cutter, 1) if f.mat.tex == 'Hole'
                            else on_plane_of(f, self.block, 1), f.verts)

    def test_a_turned_cutter(self):
        cutter = geom.rotate_brush(geom.box((96, 32, -16), (160, 96, 80), geom.Mat('Hole')), (128, 64, 32), (0, 8192, 0))
        pieces = geom.subtract(self.block, cutter)
        side = 64 * 64
        self.assertAlmostEqual(sum(volume(p) for p in pieces), 256 * 128 * 64 - side * 64, delta=1)
        for p in pieces:            # every corner of a piece is outside the cutter (or on it)
            for f in p.faces:
                for v in f.verts:
                    self.assertFalse(inside(cutter, v), v)

    def test_faces_keep_their_texture_mapping(self):
        b = geom.box((0, 0, 0), (256, 128, 64), geom.Mat('Block', align=(7, 3, 0)))
        u, v, origin = geom.mapping(b.faces[0], False)
        b.faces[0].u, b.faces[0].v, b.faces[0].origin = u, v, origin
        cutter = geom.box((-16, 32, 16), (64, 96, 48), geom.Mat('Hole'))
        kept = [f for p in geom.subtract(b, cutter) for f in p.faces if f.normal == b.faces[0].normal and f.mat.tex == 'Block']
        self.assertGreater(len(kept), 1)
        for f in kept:
            self.assertEqual((f.u, f.v, f.origin), (u, v, origin))


class DrawnHoles(unittest.TestCase):
    def test_a_door_through_a_drawn_wall(self):
        built, report = drawn.all_brushes({'drawn': [wall()], 'boxes': [hole([200, -64, 0], [300, 64, 112])]})
        self.assertFalse([line for line in report if 'not built' in line])     # (unknown textures without the game's catalog)
        self.assertEqual(len(built), 3)              # left, right, the lintel over the door
        self.assertAlmostEqual(sum(volume(b) for _n, b in built), 512 * 16 * 160 - 100 * 16 * 112, places=2)
        self.assertEqual({n for n, _b in built}, {'Wall'})
        for _n, b in built:
            self.assertFalse(inside(b, (250, 0, 50)))

    def test_holes_elsewhere_and_other_blocks_leave_it_whole(self):
        for box in (hole([1000, 0, 0], [1100, 64, 64]), hole([200, -64, 0], [300, 64, 112], hole=False),
                    hole([200, -64, 0], [300, 64, 112], water={'kind': 'water'}),
                    hole([200, -64, 0], [300, 64, 112], mover=True)):
            built, _report = drawn.all_brushes({'drawn': [wall()], 'boxes': [box]})
            self.assertEqual(len(built), 1, box)

    def test_a_stairwell_through_a_drawn_floor_and_a_turned_hole(self):
        floor = dict(kind='floor', name='Floor', pts=[[0, 0], [512, 0], [512, 512], [0, 512]], z=0)
        turned = hole([192, 192, -64], [320, 320, 64], shape='cylinder', sides=8, rot=[0, 4096, 0])
        built, _report = drawn.all_brushes({'drawn': [floor], 'boxes': [turned]})
        self.assertGreater(len(built), 1)
        for _n, b in built:
            self.assertFalse(inside(b, (256, 256, -6)))
            self.assertGreater(volume(b), 0)


if __name__ == '__main__':
    unittest.main()
