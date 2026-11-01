"""The editor's block shapes (editor/blocks.py): a cube, a wedge and a cylinder from a block's box."""
import json
import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import blocks  # noqa: E402
import geom  # noqa: E402
from vec3 import Vec3  # noqa: E402


def block(**kw):
    return dict(dict(name='UCEditBox1', lo=[0, 0, 0], hi=[128, 64, 96], tex='ClenGreyCncrt_A', solid=True), **kw)


def verts(brush):
    return [tuple(float(x) for x in m.groups()) for m in
            re.finditer(r'Vertex\s+([-+\d.]+),([-+\d.]+),([-+\d.]+)', brush.t3d())]


class Shapes(unittest.TestCase):
    def test_old_blocks_and_cubes_are_boxes(self):
        for b in (block(), block(shape='box'), block(shape='nonsense')):
            self.assertEqual(blocks.shape_of(b), 'box')
            self.assertEqual(len(blocks.brush(b, geom.Mat('X'), 'B').faces), 6)

    def test_water_portals_movers_and_signs_stay_boxes(self):
        for extra in ({'water': {'kind': 'water'}}, {'portal': True}, {'mover': True}, {'sign': {'text': 'A'}}):
            self.assertEqual(blocks.shape_of(block(shape='cylinder', **extra)), 'box')

    def test_wedge_is_a_ramp_high_at_plus_x(self):
        br = blocks.brush(block(shape='wedge'), geom.Mat('X'), 'W')
        self.assertEqual(len(br.faces), 5)
        top = [p for p in verts(br) if p[2] == 96]
        self.assertTrue(top and all(p[0] == 128 for p in top))
        self.assertEqual(br.bounds(), ((0, 0, 0), (128, 64, 96)))

    def test_cylinder_fills_the_box(self):
        br = blocks.brush(block(shape='cylinder'), geom.Mat('X'), 'C')
        self.assertEqual(len(br.faces), blocks.CYLINDER_SIDES + 2)
        (lo, hi) = br.bounds()
        for k, want in enumerate([128, 64, 96]):
            self.assertAlmostEqual(hi[k] - lo[k], want, places=3)
        self.assertIn('Texture=X', br.t3d())

    def test_script_maps_build_the_shapes(self):
        from unittest.mock import patch
        import scene
        with patch('texcat.ensure_index', return_value=False):
            s = scene.Scene('Test')
        s._apply_box_edits({'boxes': [block(shape='cylinder'), block(name='UCEditBox2', shape='wedge', hole=True)]})
        self.assertEqual([len(br.faces) for _op, br, *_ in s.ops], [blocks.CYLINDER_SIDES + 2, 5])
        self.assertEqual([op for op, *_ in s.ops], ['add', 'sub'])

    def test_short_texture_names_get_their_package(self):
        self.assertEqual(blocks.texture_ref('ClenGreyCncrt_A'), 'HK_BuildingExt.Concrete.ClenGreyCncrt_A')
        self.assertEqual(blocks.texture_ref('Pkg.Group.Name'), 'Pkg.Group.Name')
        self.assertEqual(blocks.texture_ref('NoSuchTextureAnywhere'), '')

    def test_a_turned_wedge_turns_about_its_centre(self):
        b = block(shape='wedge', rot=[0, 16384, 0])
        br = geom.rotate_brush(blocks.brush(b, geom.Mat('X'), 'W'), [64, 32, 48], b['rot'])
        lo, hi = br.bounds()
        self.assertAlmostEqual(hi[0] - lo[0], 64, places=3)
        self.assertAlmostEqual(hi[1] - lo[1], 128, places=3)


ROUND = [dict(shape='cylinder', sides=8, align=True), dict(shape='cylinder', hollow=16), dict(shape='cone'),
         dict(shape='cone', top=0.5, sides=12), dict(shape='cone', hollow=12, top=0.4), dict(shape='sphere'),
         dict(shape='sphere', sides=24), dict(shape='dome'), dict(shape='dome', hollow=16), dict(shape='sphere', hollow=12)]


class RoundShapes(unittest.TestCase):
    """UnrealEd's Cylinder, Cone and Tetrahedron (sphere) builders as blocks (20 Oct 2026)."""

    def pieces(self, **kw):
        return blocks.brushes(block(**kw), geom.Mat('X'), 'R')

    def test_every_shape_fills_its_box(self):
        for kw in ROUND:
            bs = self.pieces(**kw)
            lo = [min(b.bounds()[0][k] for b in bs) for k in range(3)]
            hi = [max(b.bounds()[1][k] for b in bs) for k in range(3)]
            for k, want in enumerate([128, 64, 96]):
                self.assertLessEqual(hi[k] - lo[k], want + 1e-3, kw)
            self.assertAlmostEqual(hi[2] - lo[2], 96, places=3, msg=kw)

    def test_every_piece_is_convex(self):
        for kw in ROUND:
            for b in self.pieces(**kw):
                pts = [p for f in b.faces for p in f.verts]
                for f in b.faces:
                    d = f.normal.dot(f.verts[0])
                    self.assertTrue(all(f.normal.dot(p) - d <= 1e-3 for p in pts), kw)

    def test_hollow_is_pieces_round_the_middle(self):
        self.assertEqual(len(self.pieces(shape='cylinder', hollow=16)), 16)
        self.assertEqual(len(self.pieces(shape='cylinder', hollow=16, sides=8)), 8)
        middle = (64, 32)
        for b in self.pieces(shape='cylinder', hollow=8):          # nothing in the middle
            for f in b.faces:
                for p in f.verts:
                    self.assertGreater(((p[0] - middle[0]) / 56) ** 2 + ((p[1] - middle[1]) / 24) ** 2, 0.99)
        self.assertEqual(len(self.pieces(shape='cylinder', hollow=40)), 1)   # thicker than it is: solid

    def test_cone_point_and_cap(self):
        point = self.pieces(shape='cone')[0]
        self.assertEqual(len(point.faces), 17)
        tops = {tuple(round(c, 3) for c in p) for f in point.faces for p in f.verts if abs(p[2] - 96) < 1e-6}
        self.assertEqual(tops, {(64, 32, 96)})
        cap = self.pieces(shape='cone', top=0.5)[0]
        self.assertEqual(len(cap.faces), 18)

    def test_sphere_and_dome(self):
        self.assertEqual(len(self.pieces(shape='sphere')[0].faces), 16 * 8)
        dome = self.pieces(shape='dome')[0]
        bottom = [f for f in dome.faces if f.normal[2] < -0.99]
        self.assertEqual(len(bottom), 1)                    # a flat base
        self.assertEqual(len(bottom[0].verts), 16)

    def test_align_to_side(self):
        flat = self.pieces(shape='cylinder', sides=8, align=True)[0]
        self.assertTrue(any(abs(f.normal[0] - 1) < 1e-6 for f in flat.faces))      # a side facing +X
        corner = self.pieces(shape='cylinder', sides=8)[0]
        self.assertFalse(any(abs(f.normal[0] - 1) < 1e-6 for f in corner.faces))

    def test_script_maps_build_the_pieces(self):
        from unittest.mock import patch
        import scene
        with patch('texcat.ensure_index', return_value=False):
            s = scene.Scene('Test')
        s._apply_box_edits({'boxes': [block(shape='cylinder', hollow=16), block(name='UCEditBox2', shape='sphere', hole=True)]})
        self.assertEqual([op for op, *_ in s.ops], ['add'] * 16 + ['sub'])

    @unittest.skipUnless(shutil.which('node'), 'no Node')
    def test_preview_has_the_same_faces(self):
        script = ("import { blockGeometry } from %s;\n"
                  "const THREE = { BufferGeometry: class { setAttribute(n, a) { this[n] = a; } computeVertexNormals() {} }, Float32BufferAttribute: class { constructor(a) { this.array = a; } } };\n"
                  "const cases = %s;\n"
                  "console.log(JSON.stringify(cases.map((c) => { const p = blockGeometry(THREE, c).position.array; const lo = [0, 1, 2].map((k) => Math.min(...p.filter((_, i) => i %% 3 === k))), hi = [0, 1, 2].map((k) => Math.max(...p.filter((_, i) => i %% 3 === k))); return [p.length / 9, lo, hi]; })));\n"
                  % (json.dumps((KIT / 'editor' / 'static' / 'block-shapes.js').as_uri()), json.dumps([block(**kw) for kw in ROUND])))
        r = subprocess.run([shutil.which('node'), '--input-type=module', '-e', script], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        for kw, (tris, lo, hi) in zip(ROUND, json.loads(r.stdout)):
            bs = self.pieces(**kw)
            self.assertEqual(tris, sum(len(f.verts) - 2 for b in bs for f in b.faces), kw)
            plo = [min(b.bounds()[0][k] for b in bs) for k in range(3)]
            phi = [max(b.bounds()[1][k] for b in bs) for k in range(3)]
            size = [128, 64, 96]
            # the preview is a unit block in three's axes (x, z, y), scaled by the box
            for k, k3 in ((0, 0), (1, 2), (2, 1)):
                self.assertAlmostEqual(lo[k3] * size[k] + size[k] / 2, plo[k], places=2, msg=kw)
                self.assertAlmostEqual(hi[k3] * size[k] + size[k] / 2, phi[k], places=2, msg=kw)

    def test_round_sides_are_one_skin(self):
        """wrap_round: neighbouring sides meet with the same texture at their lower edge, no seam round."""
        for kw in (dict(shape='cone'), dict(shape='sphere'), dict(shape='dome', hollow=16), dict(shape='cylinder', hollow=24),
                   dict(shape='cone', hollow=12, top=0.4)):
            fs = [f for b in self.pieces(**kw) for f in b.faces if f.u is not None]
            self.assertTrue(fs, kw)
            tu = geom.tex_size('X')[0]
            for i, f in enumerate(fs):
                for g in fs[i + 1:]:
                    if f.normal.dot(g.normal) < 0.5:
                        continue
                    for p in f.verts:
                        if p[2] > 1e-6 or (abs(p[0] - 64) < 1e-3 and abs(p[1] - 32) < 1e-3) or not any(max(abs(p[k] - q[k]) for k in range(3)) < 1e-6 for q in g.verts):
                            continue      # the bottom ring (not a pole): every band starts there
                        du = ((Vec3.of(p) - f.origin).dot(f.u) - (Vec3.of(p) - g.origin).dot(g.u)) % tu
                        self.assertLess(min(du, tu - du), 0.01, (kw, p))

    @unittest.skipUnless(shutil.which('node'), 'no Node')
    def test_preview_maps_round_sides_as_the_game(self):
        kws = [dict(shape='cone'), dict(shape='dome', hollow=16), dict(shape='cone', hollow=12, top=0.4, sides=8)]
        tu, tv, su, sv = geom._scales(geom.Mat('X'), 'wall')
        script = ("import { blockGeometry } from %s;\n"
                  "const THREE = { BufferGeometry: class { setAttribute(n, a) { this[n] = a; } computeVertexNormals() {} }, Float32BufferAttribute: class { constructor(a) { this.array = a; } } };\n"
                  "const tile = { wall: [%r, %r], floor: [%r, %r], ceiling: [%r, %r] };\n"
                  "console.log(JSON.stringify(%s.map((c) => { const g = blockGeometry(THREE, c, tile); return [Array.from(g.position.array), Array.from(g.uv.array)]; })));\n"
                  % (json.dumps((KIT / 'editor' / 'static' / 'block-shapes.js').as_uri()), su, sv, su, sv, su, sv, json.dumps([block(**kw) for kw in kws])))
        r = subprocess.run([shutil.which('node'), '--input-type=module', '-e', script], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        size, c = [128, 64, 96], [64, 32, 48]
        for kw, (pos, uv) in zip(kws, json.loads(r.stdout)):
            fs = [f for b in self.pieces(**kw) for f in b.faces if f.u is not None]
            checked = 0
            for t3 in range(0, len(pos), 9):
                pts = [(pos[t3 + 3 * k] * size[0] + c[0], pos[t3 + 3 * k + 2] * size[1] + c[1], pos[t3 + 3 * k + 1] * size[2] + c[2]) for k in range(3)]
                mid = tuple(sum(p[k] for p in pts) / 3 for k in range(3))
                n = (Vec3.of(pts[1]) - pts[0]).cross(Vec3.of(pts[2]) - pts[0]).normalized()
                face = [f for f in fs if abs(f.normal.dot(mid - Vec3.of(f.verts[0]))) < 0.05 and abs(abs(f.normal.dot(n)) - 1) < 1e-3
                        and all(f.normal.dot(p - Vec3.of(f.verts[0])) < 0.05 for p in pts)]
                if len(face) != 1:
                    continue
                f = face[0]
                for k, p in enumerate(pts):
                    want = ((p - Vec3.of(f.origin)).dot(f.u) / tu, -(p - Vec3.of(f.origin)).dot(f.v) / tv)
                    got = uv[(t3 // 3 + k) * 2: (t3 // 3 + k) * 2 + 2]
                    for w, g in zip(want, got):
                        d = (w - g) % 1
                        self.assertLess(min(d, 1 - d), 1e-3, (kw, p))
                checked += 1
            self.assertGreater(checked, 8, kw)


if __name__ == '__main__':
    unittest.main()
