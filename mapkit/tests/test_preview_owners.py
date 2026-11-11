import ast
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

ROOT = Path(os.environ.get('MAPKIT_TEST_ROOT', str(Path(__file__).resolve().parents[1])))
sys.path[:0] = [str(Path(__file__).parent), str(ROOT / 'editor'), str(ROOT)]
import preview_owners
import geom
import blocks


def brushes(b):
    c = [(a + z) / 2 for a, z in zip(b['lo'], b['hi'])]
    return [geom.rotate_brush(br, c, b.get('rot'), False) for br in blocks.brushes(b, geom.Mat(b['tex']), 'Test')]


def export(br, name, cls='Brush', csg='CSG_Add'):
    return f'Begin Actor Class={cls} Name={name}\n CsgOper={csg}\n{br.t3d()}\nEnd Actor\n'


class PreviewOwners(unittest.TestCase):
    def setUp(self):
        self.box = dict(name='Cube', lo=[10, 20, 30], hi=[110, 220, 330], tex='Pkg.Metal', rot=[8192, 16384, 4096])

    def test_rotated_snapshot_uses_exact_exported_brush_and_is_immutable(self):
        b = self.box
        br = brushes(b)[0]
        collector = preview_owners.Collector()
        collector.add(b, br)
        b['lo'][0] = 800
        text = export(brushes(dict(b, name='Other', hi=[900, 220, 330]))[0], 'Other') + export(br, 'Brush487')
        result = collector.resolve(text.replace('Texture=Pkg.Metal', 'Texture=Metal'))
        self.assertEqual(result['block~Cube']['brush_names'], ['Brush487'])
        self.assertEqual(result['block~Cube']['previewBox']['lo'][0], 10)

    def test_hollow_shape_claims_every_piece_or_none(self):
        b = dict(self.box, shape='cylinder', hollow=8, sides=8)
        parts = brushes(b)
        self.assertGreater(len(parts), 1)
        c = preview_owners.Collector()
        for br in parts: c.add(b, br)
        texts = [export(br, f'Brush{i}') for i, br in enumerate(parts)]
        self.assertEqual(len(c.resolve(''.join(texts))['block~Cube']['brush_names']), len(parts))
        self.assertEqual(c.resolve(''.join(texts[:-1])), {})

    def test_identical_geometry_never_claims_wrong_object(self):
        br = brushes(self.box)[0]
        c = preview_owners.Collector(); c.add(self.box, br)
        self.assertEqual(c.resolve(export(br, 'A') + export(br, 'B')), {})
        c.add(dict(self.box, name='Other'), br)
        self.assertEqual(c.resolve(export(br, 'A')), {})

    def test_builder_subtractive_and_movers_are_excluded(self):
        br = brushes(self.box)[0]
        c = preview_owners.Collector(); c.add(self.box, br)
        for cls, csg in [('Brush', 'CSG_Active'), ('Brush', 'CSG_Subtract'), ('DeusExMover', 'CSG_Add')]:
            self.assertEqual(c.resolve(export(br, 'NotASolid', cls, csg)), {})

    def test_old_build_recovery_skips_special_boxes(self):
        b = self.box
        special = [dict(b, name=k, **{k: True}) for k in ('hole', 'mover', 'sign', 'portal')]
        result = preview_owners.recover({'boxes': [b] + special}, export(brushes(b)[0], 'Brush487'))
        self.assertEqual(list(result), ['block~Cube'])

    def test_drawings_keep_their_snapshot(self):
        p = dict(name='Road', kind='road', pts=[[0, 0], [256, 0]], z=0, width=64, tex='Metal')
        import drawn
        built = drawn.all_brushes({'drawn': [p]})[0]
        self.assertTrue(built)
        c = preview_owners.Collector()
        for _, br in built: c.add(p, br, drawn=True)
        r = c.resolve(''.join(export(br, f'B{i}') for i, (_, br) in enumerate(built)))
        self.assertEqual(r['drawn~Road']['previewDrawn'], p)

    def test_exported_owner_reaches_geometry_assembly_without_stealing_prefabs(self):
        br = brushes(self.box)[0]
        c = preview_owners.Collector(); c.add(self.box, br)
        groups = {'paste~Bed': {'brush_names': ['BedBrush']}}
        groups.update(c.resolve(export(br, 'Brush487')))
        tree = ast.parse((ROOT / 'editor/data.py').read_text(encoding='utf-8'))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_owners')
        ns = dict(structures=lambda name: groups)
        exec(compile(ast.Module(body=[fn], type_ignores=[]), 'data.py', 'exec'), ns)
        self.assertEqual(ns['_owners']('Map', [dict(name='BedBrush', ord=6), dict(name='Brush487', ord=618)]),
                         {6: 'paste~Bed', 618: 'block~Cube'})

    def test_structures_only_recovers_proven_saved_build_and_keeps_prefabs(self):
        # Execute the real patched function with filesystem/dependency boundaries mocked.
        path = Path(__file__).parent / 'source.dxmaps.py'
        if not path.exists(): path = ROOT / 'editor/dxmaps.py'
        tree = ast.parse(path.read_text(encoding='utf-8'))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'structures')
        for matches in (False, True):
            with tempfile.TemporaryDirectory() as d:
                out = Path(d); info_path = out / 'Map.dxinfo.json'
                info = dict(source={'sha1': 'same'}, structures={}, analysis=4, built=dict(edits='built', pastes={'paste~Bed': {'brush_names': ['BedBrush']}}))
                info_path.write_text(json.dumps(info)); (out/'Map.t3d').write_text('export')
                recovery = Mock(return_value={'block~Cube': {'brush_names': ['Brush487']}})
                ns = dict(json=json, OUT=out, ANALYSIS=4, _info_path=lambda n: info_path, source=lambda n: 'map.dx',
                          stamp=lambda src: {'sha1': 'same'}, built_current=lambda n: True, unnested=lambda s,u:s,
                          load_edits=lambda n:{}, _edits_fingerprint=lambda e:'built' if matches else 'changed',
                          preview_owners=SimpleNamespace(recover=recovery))
                exec(compile(ast.Module(body=[fn], type_ignores=[]), str(path), 'exec'), ns)
                r = ns['structures']('Map')
                self.assertIn('paste~Bed', r)
                self.assertEqual('block~Cube' in r, matches)
                self.assertEqual(recovery.call_count, int(matches))
                ns['structures']('Map')
                self.assertEqual(recovery.call_count, int(matches))


if __name__ == '__main__': unittest.main()
