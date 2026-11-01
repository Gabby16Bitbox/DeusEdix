"""Drop and snap traces reused between builds when the brushes did not change (scene._Traces)."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import geom  # noqa: E402
import scene  # noqa: E402


class FakeSession:
    def __init__(self, log):
        self.log = log
        log.append('open')

    def trace(self, start, end):
        self.log.append(('trace', tuple(start), tuple(end)))
        return ((start[0], start[1], 10.0), (0.0, 0.0, 1.0)) if end[2] < start[2] else None

    def close(self):
        self.log.append('close')


def room(tex='ClenGreyCncrt_A', x1=512):
    with patch('texcat.ensure_index', return_value=False):
        s = scene.Scene('Test')
    s.add(geom.box((0, 0, 0), (x1, 512, 16), tex))
    s.add(geom.box((0, 0, 200), (16, 512, 300), tex))
    return s


class Traces(unittest.TestCase):
    def build_traces(self, s, path, log):
        t = scene._Traces(path, s._geometry_key(), lambda: FakeSession(log))
        try:
            down = t.trace((100, 100, 500), (100, 100, -3500))
            side = t.trace((100, 100, 250), (3100, 100, 250))
        finally:
            t.close()
        return t, down, side

    def test_the_same_brushes_reuse_the_traces_without_a_session(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'Map.traces.json'
            log1, log2 = [], []
            t1, down1, side1 = self.build_traces(room(), path, log1)
            self.assertEqual((t1.traced, t1.reused), (2, 0))
            self.assertIn('open', log1)
            t2, down2, side2 = self.build_traces(room(), path, log2)
            self.assertEqual((t2.traced, t2.reused), (0, 2))
            self.assertEqual(log2, [])                    # no SDK session at all
            self.assertEqual((down1, side1), (down2, side2))

    def test_textures_do_not_matter_but_geometry_does(self):
        self.assertEqual(room('ClenGreyCncrt_A')._geometry_key(), room('ClenGrayMetal_A')._geometry_key())
        self.assertNotEqual(room()._geometry_key(), room(x1=640)._geometry_key())

    def test_moved_brushes_trace_again(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'Map.traces.json'
            self.build_traces(room(), path, [])
            log = []
            t, *_ = self.build_traces(room(x1=640), path, log)
            self.assertEqual((t.traced, t.reused), (2, 0))
            self.assertEqual(log[0], 'open')

    def test_resolve_places_drops_from_the_cache(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'Map.traces.json'
            for log in ([], []):
                s = room()
                s.drop('Barrel1', 100, 100, 500, name='B1')
                t = scene._Traces(path, s._geometry_key(), lambda: FakeSession(log))
                with patch('sizes.load', return_value={'Barrel1': [16.0, 29.5]}):
                    s._resolve(t)
                t.close()
                self.assertIn('Z=39.500000', next(a for a in s.actors if 'Name=B1' in a))
            self.assertEqual(log, [])                       # the second build traced nothing


class BrushImport(unittest.TestCase):
    """The script's brushes in one MAP IMPORTADD (Scene.brush_blocks) instead of BRUSH ADD each."""

    def scene(self):
        s = room()
        s.sub(geom.box((32, 32, 16), (96, 96, 128), 'ClenGreyCncrt_A'))
        s.add(geom.box((200, 0, 16), (260, 60, 40), 'ClenGreyCncrt_A'), semisolid=True)
        return s

    def test_names_order_and_flags_are_those_of_brush_add(self):
        blocks = self.scene().brush_blocks()
        heads = [b.split('\n')[0] for b in blocks]
        self.assertEqual(heads, ['Begin Actor Class=Brush Name=Brush%d' % n for n in range(2, 6)])
        self.assertIn('CsgOper=CSG_Subtract', blocks[2])
        self.assertNotIn('PolyFlags', blocks[2])
        self.assertIn('PolyFlags=32', blocks[3])
        models = [b.split('Begin Brush Name=')[1].split('\n')[0] for b in blocks]
        self.assertEqual(len(set(models)), 4)                         # one model each
        for b, m in zip(blocks, models):
            self.assertTrue(m.startswith(scene.BRUSH_MODEL))
            self.assertIn("Brush=Model'MyLevel.%s'" % m, b)
            self.assertLess(b.index('End Brush'), b.index('Brush=Model'))   # the model first (PrepBrush)

    def test_one_import_then_one_surface_per_polygon(self):
        s = self.scene()
        with tempfile.TemporaryDirectory() as d:
            for sub in ('Input', 'T3D'):
                (Path(d) / sub).mkdir()
            setup = s.brush_commands(d)
            self.assertEqual(setup[-2:], ['MAP IMPORTADD FILE="..\\T3D\\brushes.t3d"', scene.UNLINK])
            self.assertFalse(any(c.startswith(('BRUSH ADD', 'BRUSH IMPORT', 'BRUSH SUBTRACT')) for c in setup))
            text = (Path(d) / 'T3D' / 'brushes.t3d').read_text(encoding='ascii')
            self.assertTrue(text.startswith('Begin Map\nBegin Actor Class=Brush Name=UCImportBuilder'))
            cmds = s.commands(d)
            i = cmds.index('MAP IMPORTADD FILE="..\\T3D\\actors.t3d"')
            self.assertEqual(cmds[i + 1], scene.UNLINK)
            self.assertLess(i, cmds.index('MAP REBUILD'))
            self.assertNotIn('brushes.t3d', ' '.join(cmds))             # the build imports them with the actors
            actors = (Path(d) / 'T3D' / 'actors.t3d').read_text(encoding='latin1')
            self.assertLess(actors.index('Name=Brush2'), actors.index('Name=Brush5'))


if __name__ == '__main__':
    unittest.main()
