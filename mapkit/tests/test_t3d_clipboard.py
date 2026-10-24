"""UnrealEd's clipboard (editor/t3d_clipboard.py): the selection as T3D for UnrealEd's Edit > Paste, and the T3D its
Edit > Copy makes read back as blocks and objects."""
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import blocks  # noqa: E402
import geom  # noqa: E402
import t3d  # noqa: E402
import t3d_clipboard  # noqa: E402

# a brush as UnrealEd copies it (from the Wan Chai street of Deus Ex: Revision): a frustum, its polygons relative to
# its Location, two textures
UNREALED_BRUSH = """Begin Map
Begin Actor Class=Brush Name=Brush695
    CsgOper=CSG_Add
    PolyFlags=32
    Level=LevelInfo'MyLevel.LevelInfo0'
    Tag=Brush
    Region=(Zone=LevelInfo'MyLevel.LevelInfo0',iLeaf=-1)
    Location=(X=-1406.000000,Y=-1135.999756,Z=1989.000000)
    Begin Brush Name=Model754
       Begin PolyList
%s       End PolyList
    End Brush
    Brush=Model'MyLevel.Model754'
    Name=Brush695
End Actor
Begin Actor Class=Lamp1 Name=Lamp12
    Level=LevelInfo'MyLevel.LevelInfo0'
    Tag=StreetLamp
    Region=(Zone=LevelInfo'MyLevel.LevelInfo0',iLeaf=-1)
    Location=(X=10.000000,Y=20.000000,Z=30.000000)
    Rotation=(Yaw=16384)
    bOn=True
    Base=Brush'MyLevel.Brush695'
    Name=Lamp12
End Actor
End Map
"""
FRUSTUM = [((0, 0, 1), [(16, 24, 2), (-8, 24, 2), (-8, -24, 2), (16, -24, 2)], 'FileCab_siding'),
           ((0, 0, -1), [(24, -32, -2), (-16, -32, -2), (-16, 32, -2), (24, 32, -2)], 'Heli_LiftMetl_A'),
           ((0, -1, 2), [(24, -32, -2), (16, -24, 2), (-8, -24, 2), (-16, -32, -2)], 'FileCab_siding'),
           ((0, 1, 2), [(-16, 32, -2), (-8, 24, 2), (16, 24, 2), (24, 32, -2)], 'FileCab_siding'),
           ((1, 0, 2), [(24, 32, -2), (16, 24, 2), (16, -24, 2), (24, -32, -2)], 'FileCab_siding'),
           ((-1, 0, 2), [(-16, -32, -2), (-8, -24, 2), (-8, 24, 2), (-16, 32, -2)], 'FileCab_siding')]


def polygon_list(polys):
    return ''.join('          Begin Polygon Texture=%s Flags=0\n%s          End Polygon\n'
                   % (tex, ''.join('             Vertex   %+013.6f,%+013.6f,%+013.6f\n' % v for v in vs))
                   for _n, vs, tex in polys)


def corners(brushes):
    return sorted({tuple(round(v, 1) + 0.0 for v in p) for br in brushes for f in br.faces for p in f.verts})


def built(b):
    """The corners of a block as the build makes it."""
    centre = [(b['lo'][k] + b['hi'][k]) / 2 for k in range(3)]
    return corners(geom.rotate_brush(br, centre, b.get('rot')) for br in blocks.brushes(b, geom.Mat('X'), 'B'))


def pasted(t3d_text):
    """The corners of the brushes of a T3D text, where UnrealEd would put them."""
    return sorted({tuple(round(v, 1) + 0.0 for v in p) for a in t3d.actors(t3d_text) if a['cls'] == 'Brush'
                   for _poly, vs in t3d.world_verts(a) for p in vs})


def assert_same_points(test, got, want):
    test.assertEqual(len(got), len(want))
    for p, q in zip(got, want):
        test.assertLess(max(abs(p[k] - q[k]) for k in range(3)), 0.2, (p, q))


class FromUnrealEd(unittest.TestCase):
    def test_a_brush_becomes_a_block_with_its_corners(self):
        got = t3d_clipboard.read(UNREALED_BRUSH % polygon_list(FRUSTUM))
        self.assertEqual(len(got['boxes']), 1)
        b = got['boxes'][0]
        self.assertEqual((b['tex'], b['solid'], b.get('hole')), ('FileCab_siding', False, None))      # semisolid: a detail block
        self.assertEqual(got['notes'], ['Brush695: its faces had 2 textures: the block takes FileCab_siding'])
        want = sorted(tuple(round(v[k] + (-1406.0, -1135.999756, 1989.0)[k], 1) + 0.0 for k in range(3))
                      for _n, vs, _t in FRUSTUM for v in vs)
        assert_same_points(self, built(b), sorted(set(want)))

    def test_objects_keep_their_own_properties_not_the_maps(self):
        got = t3d_clipboard.read(UNREALED_BRUSH % polygon_list(FRUSTUM))
        self.assertEqual(got['added'], [dict(cls='Lamp1', loc=[10.0, 20.0, 30.0], rot=[0, 16384, 0],
                                             props={'Tag': 'StreetLamp', 'bOn': 'True'})])

    def test_what_a_block_cannot_be_is_said(self):
        concave = FRUSTUM[:4] + [((0, 0, 1), [(0, 0, 40), (8, 0, 40), (8, 8, 40)], 'X')]   # a corner well out of it
        sheet = [((0, 0, 1), [(0, 0, 0), (64, 0, 0), (64, 64, 0), (0, 64, 0)], 'X')]
        cases = {'not convex': UNREALED_BRUSH % polygon_list(concave), 'a sheet': UNREALED_BRUSH % polygon_list(sheet),
                 'the builder brush': (UNREALED_BRUSH % polygon_list(FRUSTUM)).replace('    CsgOper=CSG_Add\n', ''),
                 'non-solid': (UNREALED_BRUSH % polygon_list(FRUSTUM)).replace('PolyFlags=32', 'PolyFlags=8'),
                 'a mover': (UNREALED_BRUSH % polygon_list(FRUSTUM)).replace('Class=Brush ', 'Class=DeusExMover ')}
        for why, text in cases.items():
            got = t3d_clipboard.read(text)
            self.assertEqual(got['boxes'], [], why)
            self.assertEqual(len(got['skipped']), 1, why)
            self.assertIn(why, got['skipped'][0])

    def test_text_that_is_not_t3d(self):
        with self.assertRaises(ValueError):
            t3d_clipboard.read('DeusEdix: copied in the map editor')


class ToUnrealEd(unittest.TestCase):
    def test_blocks_are_brushes_where_the_build_puts_them(self):
        shapes = [dict(shape='wedge', rot=[0, 8192, 0], solid=True), dict(shape='cylinder', sides=8, hole=True),
                  dict(verts=[[0, 0, 0], [1, 0, 0], [0, 1, 0], [0.2, 0.7, 1]], rot=[3000, 0, -2000])]
        for kw in shapes:
            b = dict(dict(name='UCEditBox4', lo=[-32, 16, 0], hi=[96, 80, 112], tex='flatconcrete_a'), **kw)
            out = t3d_clipboard.export([{'kind': 'box', 'box': b}])
            self.assertEqual(out['skipped'], [])
            assert_same_points(self, pasted(out['text']), built(b))
            head = next(t3d.actors(out['text']))['props']
            self.assertEqual(head['CsgOper'], 'CSG_Subtract' if b.get('hole') else 'CSG_Add')
            self.assertEqual(head['PolyFlags'], '0' if b.get('hole') or b.get('solid') else '32')     # a detail block: semisolid
            self.assertIn("Brush=Model'MyLevel.UCEditBox4Model'", out['text'])
            # its full name where the catalog of the game's textures knows it
            self.assertIn('Texture=%s ' % (blocks.texture_ref('flatconcrete_a') or 'flatconcrete_a'), out['text'])

    def test_and_back_again(self):
        b = dict(name='UCEditBox4', lo=[-32, 16, 0], hi=[96, 80, 112], tex='flatconcrete_a', shape='wedge', rot=[0, 8192, 0])
        back = t3d_clipboard.read(t3d_clipboard.export([{'kind': 'box', 'box': b}])['text'])['boxes'][0]
        self.assertFalse(back['solid'])                                                       # a detail block
        assert_same_points(self, built(back), built(b))

    def test_drawings_go_cut_by_the_holes(self):
        wall = dict(name='UCDrawn0', kind='wall', pts=[[0, 0], [512, 0]], z=0)
        door = dict(name='UCEditBox9', lo=[200, -64, 0], hi=[300, 64, 112], hole=True, tex='DoorFrame_A')
        out = t3d_clipboard.export([{'kind': 'drawn', 'drawn': wall}], [door])
        actors = list(t3d.actors(out['text']))
        self.assertEqual([a['props']['PolyFlags'] for a in actors], ['32'] * 3)

    def test_objects_and_what_does_not_go(self):
        out = t3d_clipboard.export([
            {'kind': 'actor', 'cls': 'Lamp1', 'loc': [1, 2, 3], 'rot': [0, 100, 0], 'scale': 2,
             'props': {'Tag': 'A', 'Base': "Brush'MyLevel.Brush4'", 'Level': "LevelInfo'MyLevel.LevelInfo0'"}},
            {'kind': 'structure', 'label': 'Helipad'},
            {'kind': 'box', 'box': dict(name='UCEditBox1', lo=[0, 0, 0], hi=[64, 64, 64], water={'kind': 'water'})}])
        lamp = next(t3d.actors(out['text']))
        self.assertEqual(lamp['cls'], 'Lamp1')
        self.assertEqual(lamp['props'], {'Location': '(X=1.000000,Y=2.000000,Z=3.000000)', 'Rotation': '(Pitch=0,Yaw=100,Roll=0)',
                                         'Tag': 'A', 'DrawScale': '2.0000'})
        self.assertEqual(len(out['skipped']), 2)


if __name__ == '__main__':
    unittest.main()
