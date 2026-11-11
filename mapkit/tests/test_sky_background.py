"""The Sky background controls preserve old maps and match the live preview's UV mapping."""
import json
import math
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'editor'))
import geom
import zones


def edits(sky='hongkong', background=None):
    level = {'sky': sky}
    if sky == 'mine':
        geom.register('TestSky', 512, 1024)
        level['skyLook'] = dict(walls='TestSky', top='starslesser', bottom='starslesser')
    if background is not None:
        level['skyBackground'] = background
    return dict(level=level, boxes=[dict(hole=True, sky=True)])


def uv(face, point):
    u, v, o = (face.u, face.v, face.origin) if face.u is not None else geom.mapping(face, True)
    return tuple(sum((point[i] - o[i]) * axis[i] for i in range(3)) for axis in (u, v))


class SkyBackground(unittest.TestCase):
    def brush(self, e):
        return zones.skybox(e, False)[0][0][1]

    def test_default_and_explicit_reset_preserve_original_mapping(self):
        for sky in (*zones.SKIES, 'mine'):
            self.assertEqual(self.brush(edits(sky)).t3d(True), self.brush(edits(sky, {})).t3d(True))
            self.assertEqual(self.brush(edits(sky)).t3d(True), self.brush(edits(sky, dict(height=0, scale=100, horizontal=0))).t3d(True))

    def test_height_migration_equals_old_minus_32_pan(self):
        original = self.brush(edits())
        changed = self.brush(edits(background={'height': -12.5}))
        self.assertEqual(geom.tex_size('HK_City_A_A')[1], 256)
        for i in range(4):
            for p in original.faces[i].verts:
                before, after = uv(original.faces[i], p), uv(changed.faces[i], p)
                self.assertAlmostEqual(after[0], before[0])
                self.assertAlmostEqual(after[1], before[1] - 32)

    def test_background_does_not_change_clouds_roof_floor_or_geometry(self):
        e = edits()
        e['level']['clouds'] = dict(look='game', tex='ClenCloudBank_B', height=8, size=30, speed=30, wind=180)
        before = zones.skybox(e, False)
        e['level']['skyBackground'] = dict(height=-30, scale=55, horizontal=20)
        after = zones.skybox(e, False)
        self.assertEqual(before[1], after[1])
        self.assertEqual(before[0][1][1].t3d(), after[0][1][1].t3d())
        for a, b in zip(before[0][0][1].faces, after[0][0][1].faces):
            self.assertEqual(a.verts, b.verts)
            if abs(a.normal[2]) > .5:
                self.assertEqual(uv(a, a.verts[0]), uv(b, b.verts[0]))
            if b.origin is not None:
                self.assertAlmostEqual(sum((b.origin[k] - b.verts[0][k]) * b.normal[k] for k in range(3)), 0)
        self.assertEqual(zones.skybox(e, True), ([], []))

    def test_scale_keeps_wall_centers_fixed(self):
        a, b = self.brush(edits()), self.brush(edits(background={'scale': 50}))
        for i in range(4):
            f = a.faces[i]
            center = [sum(p[k] for p in f.verts)/len(f.verts) for k in range(3)]
            for x, y in zip(uv(f, center), uv(b.faces[i], center)):
                self.assertAlmostEqual(x, y)

    def test_custom_background_is_separate_from_sky(self):
        geom.register('CustomBackdrop', 1024, 1024)
        b = self.brush(edits(background=dict(texture='CustomBackdrop', height=-20)))
        self.assertTrue(all(f.mat.tex == 'CustomBackdrop' for f in b.faces[:4]))
        self.assertTrue(all(f.mat.tex == 'starslesser' for f in b.faces[4:]))
        self.assertIn('Texture=CustomBackdrop', b.t3d(True))

    def test_invalid_values_do_not_write_nan_or_zero_axes(self):
        e = edits(background=dict(height=float('nan'), horizontal=1e10, scale=0, texture='../bad'))
        s = zones.background_settings(e['level'])
        self.assertEqual(s, dict(height=0, horizontal=100, scale=25, texture=''))
        self.assertNotIn('nan', self.brush(e).t3d(True))

    def test_preview_matches_exported_uvs_all_sides_and_texture_aspects(self):
        fixtures = []
        for sky in (*zones.SKIES, 'mine'):
            for settings in ({}, dict(height=-12.5), dict(scale=55, height=20, horizontal=-32), dict(scale=180, height=-45, texture='TestSky')):
                geom.register('TestSky', 512, 1024)
                b = self.brush(edits(sky, settings))
                for index, f in enumerate(b.faces):
                    size = geom.tex_size(f.mat.tex)
                    for world in [f.verts[0], f.verts[2], [sum(p[k] for p in f.verts)/len(f.verts) for k in range(3)]]:
                        expected = [v/size[k] for k, v in enumerate(uv(f, world))]
                        fixtures.append(dict(point=[world[k] - zones.SKYBOX_CENTER[k] for k in range(3)], face=index,
                            recipe=dict(tile=f.mat.tile, width=size[0], height=size[1], painted=bool(index<4 and (sky=='mine' or settings.get('texture')))),
                            background=settings, expected=expected))
        module = (ROOT / 'editor/static/sky-background.js').as_uri()
        code = f"import {{skyUV}} from {json.dumps(module)}; let s=''; for await (const c of process.stdin) s+=c; const rows=JSON.parse(s); for(const r of rows) {{ const uv=skyUV(r.point,r.face,r.recipe,r.background); if(uv.some((v,i)=>Math.abs(v-r.expected[i])>1e-7)) throw Error(JSON.stringify({{r,uv}})); }} console.log(rows.length+' UV samples match');"
        run = subprocess.run(['node', '--input-type=module', '-e', code], input=json.dumps(fixtures), text=True, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn('576 UV samples match', run.stdout)


if __name__ == '__main__':
    unittest.main()
