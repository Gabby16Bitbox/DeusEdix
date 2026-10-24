"""UnrealEd's views of a map (editor/data.py views(): Wireframe, BSP cuts, Zones) from a map's last SDK pass."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import data  # noqa: E402

# a floor split by the BSP in two (one surface, 0), a wall (surface 1) behind a ZoneInfo, a block moved as a structure
SQUARE_A = [0, 0, 0, 64, 0, 0, 64, 64, 0, 0, 64, 0]
SQUARE_B = [64, 0, 0, 128, 0, 0, 128, 64, 0, 64, 64, 0]
WALL = [0, 0, 0, 0, 0, 96, 0, 64, 96, 0, 64, 0]
BLOCK = [200, 0, 0, 216, 0, 0, 216, 16, 0]


def edges(flat):
    pts = [tuple(flat[i:i + 3]) for i in range(0, len(flat), 3)]
    return {tuple(sorted(pts[i:i + 2])) for i in range(0, len(pts), 2)}


class Views(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name)
        polys = [['Floor', 0, [0] * 13, SQUARE_A, 0], ['Floor', 0, [0] * 13, SQUARE_B, 0], ['Wall', 0, [0] * 13, WALL, 0],
                 ['Box', 0, [0] * 13, BLOCK, 1]]
        for name, value in (('polys', polys), ('psurf', [0, 0, 1, 2]), ('brushes', [{'name': 'Brush0', 'ord': 0}, {'name': 'Brush1', 'ord': 1}]),
                            ('pzone', {'zones': ['', 'ZoneInfo0'], 'zone': [0, 0, 1, 0]})):
            (self.folder / (name + '.json')).write_text(json.dumps(value), encoding='utf-8')
        (self.folder / 'assembled.txt').write_text('built-1')
        for patch in (mock.patch.object(data, 'map_folder', return_value=self.folder),
                      mock.patch.object(data, 'structures', return_value={'s_Box': {'brushes': [1]}})):
            patch.start()
            self.addCleanup(patch.stop)

    def test_cuts_are_every_polygon_edge_once_and_wire_the_surfaces_outlines(self):
        v = data.views('Map')['structures']
        shared = ((64, 0, 0), (64, 64, 0))                       # where the BSP split the floor
        self.assertIn(shared, edges(v['']['cuts']))
        self.assertEqual(len(edges(v['']['cuts'])), 4 + 3 + 3)   # the two squares share one edge; the wall shares one too
        self.assertNotIn(shared, edges(v['']['wire']))           # inside the floor's surface: not an outline
        self.assertIn(((0, 0, 0), (0, 64, 0)), edges(v['']['wire']))   # the floor's edge along the wall: both outlines

    def test_triangles_carry_their_zone_and_structures_their_own_polygons(self):
        v = data.views('Map')
        self.assertEqual(v['zones'], ['', 'ZoneInfo0'])
        self.assertTrue(v['zoned'])
        self.assertEqual(v['structures']['']['zone'], [0, 0, 0, 0, 1, 1])     # two triangles a quad
        self.assertEqual(len(v['structures']['']['tris']), 6 * 9)
        self.assertEqual(v['structures']['s_Box']['tris'], BLOCK)

    def test_kept_until_the_polygons_are_assembled_again(self):
        first = data.views('Map')
        (self.folder / 'polys.json').write_text('[]', encoding='utf-8')
        self.assertEqual(data.views('Map'), first)
        (self.folder / 'assembled.txt').write_text('built-2')
        self.assertEqual(data.views('Map')['structures'], {})

    def test_a_pass_from_before_the_zones(self):
        (self.folder / 'pzone.json').unlink()
        v = data.views('Map')
        self.assertFalse(v['zoned'])
        self.assertEqual(set(v['structures']['']['zone']), {0})


if __name__ == '__main__':
    unittest.main()
