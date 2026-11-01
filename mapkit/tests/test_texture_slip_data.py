"""What the 3D view's Texture Slip and its preview of queued surface rows read from the server: each face's mapping and
its brush's csg, each triangle's BSP polygon (data._assemble, geometry.json), and the surface rows the map shown was
built with (dxmaps.built_surfaces for an existing map, data.built_surfaces from the rows scene.py keeps for a map
script), sent by /api/scene as builtSurfaces (test_tutorial_routes)."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import data  # noqa: E402
import dxmaps  # noqa: E402
import tutorial  # noqa: E402

WALL = [64, 400, 0, 0, -1, 0, 0, 0, -1, 0, 0, 128, 128]


class Assembly(unittest.TestCase):
    def assemble(self, polys, brushes, pface):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            values = {'polys': polys, 'textures': {'Pkg.Wall': {}}, 'brushes': brushes, 'pface': pface}
            for name, value in values.items():
                (folder / (name + '.json')).write_text(json.dumps(value))
            with mock.patch.object(data, 'structures', return_value={}):
                data._assemble('Fixture', folder)
            return json.loads((folder / 'geometry.json').read_text())

    def test_each_face_has_its_mapping_and_csg_and_each_triangle_its_bsp_polygon(self):
        quad = [64, 528, 0, 64, 528, 96, 64, 272, 96, 64, 272, 0]
        cut = [64, 600, 0, 64, 600, 96, 64, 528, 96]
        moved = WALL[:9] + [16, 0, 128, 128]
        # face 0 of Brush1: two BSP pieces mapped alike; face 0 of Brush2 (a hole): one piece; face 1 of Brush2: two
        # pieces mapped otherwise (one panned since): no single mapping
        polys = [['Pkg.Wall', 0, WALL, quad, 0], ['Pkg.Wall', 0, WALL, cut, 0], ['Pkg.Wall', 0, WALL, cut, 1],
                 ['Pkg.Wall', 0, WALL, quad, 1], ['Pkg.Wall', 0, moved, cut, 1]]
        brushes = [{'name': 'Brush1', 'ord': 0, 'csg': 1}, {'name': 'Brush2', 'ord': 1, 'csg': 2}]
        geometry = self.assemble(polys, brushes, [0, 0, 0, 1, 1])
        faces = geometry['faces']
        self.assertEqual([(f['brush'], f['poly'], f['csg']) for f in faces], [('Brush1', 0, 1), ('Brush2', 0, 2), ('Brush2', 1, 2)])
        self.assertEqual([f['map'] for f in faces], [WALL, WALL, None])
        group = geometry['groups'][0]
        # a quad is two triangles of its polygon, the others one: each triangle its polygon and its face
        self.assertEqual(group['piece'], [0, 0, 1, 2, 3, 3, 4])
        self.assertEqual(group['faces'], [0, 0, 0, 1, 2, 2, 2])
        self.assertEqual(len(group['pos']), 9 * len(group['piece']))

    def test_a_brush_without_csg_and_the_assembly_made_again(self):
        geometry = self.assemble([['Pkg.Wall', 0, WALL, [0, 0, 0, 1, 0, 0, 0, 1, 0], 0]], [{'name': 'Brush1', 'ord': 0}], [0])
        self.assertIsNone(geometry['faces'][0]['csg'])
        self.assertEqual(geometry['groups'][0]['piece'], [0])
        self.assertEqual(data.ASSEMBLY, 6)          # geometry.json of an older assembly is made again on the next open


class BuiltSurfaces(unittest.TestCase):
    ROWS = [{'op': 'pan', 'args': [4, 0], 'targets': [{'brush': 'Brush1', 'poly': 0}]}]

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.out = Path(tmp.name)
        patch = mock.patch.object(data, 'OUT', self.out)
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_map_script_the_rows_scene_py_kept_next_to_its_build(self):
        rows, built = self.out / 'Lab.surfaces.json', self.out / 'Lab.dx'
        T, S = 1_700_000_000 * 10 ** 9, 10 ** 9            # a time, a second (in nanoseconds)
        self.assertIsNone(data.built_surfaces('Lab'))                  # built before the rows were kept
        built.write_bytes(b'map')
        rows.write_text(json.dumps(self.ROWS))
        os.utime(built, ns=(T, T))
        os.utime(rows, ns=(T + 5 * S, T + 5 * S))
        self.assertEqual(data.built_surfaces('Lab'), self.ROWS)
        os.utime(built, ns=(T + 9 * S, T + 9 * S))               # a build newer than its rows: not known
        self.assertIsNone(data.built_surfaces('Lab'))
        os.utime(built, ns=(T, T))
        for text in ('{"op": "pan"}', 'not json'):
            rows.write_text(text)
            os.utime(rows, ns=(T + 5 * S, T + 5 * S))
            self.assertIsNone(data.built_surfaces('Lab'))
        rows.write_text('[]')
        self.assertEqual(data.built_surfaces('Lab'), [])

    def test_a_map_script_built_before_its_rows_were_kept_the_edits_saved_before_it(self):
        built, edits = self.out / 'Lab.dx', self.out / 'lab.edits.json'
        T, S = 1_700_000_000 * 10 ** 9, 10 ** 9
        self.assertIsNone(data.built_surfaces('Lab', edits))               # no build
        built.write_bytes(b'map')
        os.utime(built, ns=(T, T))
        self.assertEqual(data.built_surfaces('Lab', edits), [])            # no edits saved: none built
        edits.write_text(json.dumps(dict(moved={}, surfaces=self.ROWS)))
        os.utime(edits, ns=(T - S, T - S))
        self.assertEqual(data.built_surfaces('Lab', edits), self.ROWS)     # saved before the build: in it
        edits.write_text(json.dumps(dict(moved={})))
        os.utime(edits, ns=(T - S, T - S))
        self.assertEqual(data.built_surfaces('Lab', edits), [])
        os.utime(edits, ns=(T + S, T + S))                                 # saved after it: not known
        self.assertIsNone(data.built_surfaces('Lab', edits))
        self.assertIsNone(data.built_surfaces('Lab'))
        # rows kept older than the build: the edits' when they are older still
        rows = self.out / 'Lab.surfaces.json'
        rows.write_text('[]')
        os.utime(rows, ns=(T - 2 * S, T - 2 * S))
        os.utime(edits, ns=(T - S, T - S))
        edits.write_text(json.dumps(dict(surfaces=self.ROWS)))
        os.utime(edits, ns=(T - S, T - S))
        self.assertEqual(data.built_surfaces('Lab', edits), self.ROWS)
        edits.write_text('not json')
        os.utime(edits, ns=(T - S, T - S))
        self.assertIsNone(data.built_surfaces('Lab', edits))

    def test_an_existing_map_the_rows_of_its_current_build(self):
        info = self.out / 'Map.dxinfo.json'
        edits = dict(surfaces=self.ROWS)
        with mock.patch.object(dxmaps, '_info_path', return_value=info), mock.patch.object(dxmaps, 'load_edits', return_value=edits), \
                mock.patch.object(dxmaps, '_edits_fingerprint', side_effect=lambda e: json.dumps(e, sort_keys=True)):
            with mock.patch.object(dxmaps, 'built_current', return_value=False):
                self.assertEqual(dxmaps.built_surfaces('Map'), [])         # the source shown: none of them built
            with mock.patch.object(dxmaps, 'built_current', return_value=True):
                info.write_text(json.dumps({'built': {'surfaces': self.ROWS[:0] + [dict(self.ROWS[0], args=[9, 9])]}}))
                self.assertEqual(dxmaps.built_surfaces('Map')[0]['args'], [9, 9])
                info.write_text(json.dumps({'built': {'surfaces': None}}))
                self.assertEqual(dxmaps.built_surfaces('Map'), [])
                # a build from before the rows were kept: the edits' when the build was made from them, else not known
                info.write_text(json.dumps({'built': {'edits': json.dumps(edits, sort_keys=True)}}))
                self.assertEqual(dxmaps.built_surfaces('Map'), self.ROWS)
                info.write_text(json.dumps({'built': {'edits': 'another'}}))
                self.assertIsNone(dxmaps.built_surfaces('Map'))

    def test_an_existing_map_whose_build_the_caller_checked_is_not_read_again(self):
        # /api/scene asks built_current once (it reads and hashes the whole source map) and gives its answer on
        info, source = self.out / 'Map.dxinfo.json', self.out / 'source' / 'Map.dx'
        info.write_text(json.dumps({'built': {'surfaces': self.ROWS}}))
        with mock.patch.object(dxmaps, '_info_path', return_value=info), mock.patch.object(dxmaps, 'OUT', self.out), \
                mock.patch.object(dxmaps, 'source', return_value=source), \
                mock.patch.object(dxmaps, 'built_current', side_effect=AssertionError('the source read again')):
            self.assertEqual(dxmaps.built_surfaces('Map', True), self.ROWS)
            self.assertEqual(dxmaps.built_surfaces('Map', False), [])
            self.assertEqual(dxmaps.shown('Map', True), self.out / 'Map.dx')
            self.assertEqual(dxmaps.shown('Map', False), source)


class Wiring(unittest.TestCase):
    def test_a_build_keeps_its_rows(self):
        build = (KIT / 'editor' / 'dxmaps.py').read_text(encoding='utf-8')
        kept = build[build.index("info['built'] = dict("):]
        self.assertIn("surfaces=edits.get('surfaces') or [])", kept[:kept.index('_info_path(map_name).write_text')])
        scene = (KIT / 'scene.py').read_text(encoding='utf-8')
        groups = scene.index("with_suffix('.groups.json')")
        self.assertRegex(scene[groups:groups + 600], r"with_suffix\('\.surfaces\.json'\)\.write_text\(json\.dumps\(changes\.get\('surfaces'\) or \[\]\)")
        # the tutorial's clean build goes with its rows (reset, kept and put back with the map); /api/scene sends them:
        # test_tutorial_routes
        self.assertIn('.surfaces.json', tutorial._OUTPUTS)


if __name__ == '__main__':
    unittest.main()
