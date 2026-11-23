"""The editor's blocks, holes and drawings go into the map as Brush actors named after them (editor/surfaces.py
stable_name), so a face change (UC_SURFACE <brush> <polygon>) keeps its face when another block is deleted; face
changes queued on the old Brush<N> names are taken over by the piece of the same shape (surfaces.adopt)."""
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import blocks  # noqa: E402
import geom  # noqa: E402
import scene  # noqa: E402
import surfaces  # noqa: E402
import t3d  # noqa: E402


def box(name, lo, hi, **kw):
    return dict(dict(name=name, lo=lo, hi=hi, tex='Stucco_B', solid=True), **kw)


def brush_of(b):
    return blocks.brushes(b, geom.Mat(b['tex']), b['name'])[0]


def exported(*actors):
    """A MAP EXPORT text with these Brush actors (name, brush, csg), at the origin as BRUSH ADD leaves them."""
    out = ['Begin Map']
    for name, brush, csg in actors:
        out.append('Begin Actor Class=Brush Name=%s\n    CsgOper=%s\n%s    Location=(X=0,Y=0,Z=0)\nEnd Actor'
                   % (name, csg, brush.t3d()))
    return '\n'.join(out + ['End Map']) + '\n'


def row(brush, poly, flags=0x80):
    return dict(op='flags', args=[flags, 0], targets=[dict(brush=brush, poly=poly)])


class Names(unittest.TestCase):
    def test_a_block_and_its_pieces(self):
        self.assertEqual(surfaces.stable_name('UCEditBox7'), 'UCBlk_UCEditBox7')
        self.assertEqual(surfaces.stable_name('UCEditBox7', 2), 'UCBlk_UCEditBox7_2')
        self.assertEqual(surfaces.stable_name('a b-c'), 'UCBlk_a_b_c')
        self.assertTrue(re.fullmatch(r'[A-Za-z0-9_]{1,63}', surfaces.stable_name('x' * 200, 12)))

    def test_the_actor_is_what_brush_add_made(self):
        b = brush_of(box('UCEditBox1', [0, 0, 0], [64, 64, 64]))
        add = surfaces.brush_actor('UCBlk_UCEditBox1', 3, b.t3d(), False, 0x20)
        self.assertIn('Begin Actor Class=Brush Name=UCBlk_UCEditBox1', add)
        self.assertIn('CsgOper=CSG_Add', add)
        self.assertIn('PolyFlags=32', add)
        self.assertIn("Brush=Model'MyLevel.UCBlkModel3'", add)
        self.assertIn('Begin Brush Name=UCBlkModel3', add)
        self.assertEqual(len(t3d.polys(add)), 6)
        sub = surfaces.brush_actor('UCBlk_H', 0, b.t3d(), True, 0x20)
        self.assertIn('CsgOper=CSG_Subtract', sub)
        self.assertNotIn('PolyFlags', sub)              # a hole takes no flags, as BRUSH SUBTRACT
        text = t3d.import_text([add, sub])
        self.assertEqual(text.count('Begin Actor Class=Brush'), 3)   # and the sentinel builder ahead of them
        self.assertTrue(surfaces.UNLINK.startswith('UC_UNLINK UCBlkModel'))

    def test_a_dx_map_imports_its_blocks_file(self):
        # a .dx map's build imports them from T3D\blocks.t3d (a "\b" once turned into a backspace: nothing imported)
        source = (KIT / 'editor' / 'dxmaps.py').read_text(encoding='utf-8')
        self.assertIn('MAP IMPORTADD FILE="..' + chr(92) + 'T3D' + chr(92) + 'blocks.t3d"', source)
        for name in ('editor/dxmaps.py', 'editor/surfaces.py', 'scene.py', 't3d.py'):
            text = (KIT / name).read_text(encoding='utf-8')
            self.assertFalse([c for c in text if ord(c) < 32 and c not in '\t\r\n'], name)


class ScriptMaps(unittest.TestCase):
    def scene_with(self, boxes):
        s = scene.Scene('ZZ_Stable')
        s.add(geom.box((-512, -512, -16), (512, 512, 0), geom.Mat('Stucco_B'), name='Floor'))   # the script's own
        for b in boxes:
            br = brush_of(b)
            br.stable_of = b['name']
            (s.sub if b.get('hole') else s.add)(br)
        return s

    def test_names_follow_the_block_not_the_order(self):
        s = self.scene_with([box('UCEditBox0', [0, 0, 0], [64, 64, 64]),
                             box('UCEditBox1', [100, 0, 0], [164, 64, 64], hole=True)])
        self.assertEqual(s.stable_names(), [None, 'UCBlk_UCEditBox0', 'UCBlk_UCEditBox1'])
        names = [re.search(r'Name=(\S+)', a).group(1) for a in s.brush_blocks()]
        self.assertEqual(names, ['Brush2', 'UCBlk_UCEditBox0', 'UCBlk_UCEditBox1'])
        # the first block deleted: the hole keeps its name (it was Brush4, it would have been Brush3)
        s2 = self.scene_with([box('UCEditBox1', [100, 0, 0], [164, 64, 64], hole=True)])
        self.assertEqual([re.search(r'Name=(\S+)', a).group(1) for a in s2.brush_blocks()], ['Brush2', 'UCBlk_UCEditBox1'])

    def test_two_pieces_of_one_name(self):
        s = self.scene_with([box('X', [0, 0, 0], [64, 64, 64]), box('X', [100, 0, 0], [164, 64, 64])])
        self.assertEqual(s.stable_names()[1:], ['UCBlk_X', 'UCBlk_X_1'])


class Adopt(unittest.TestCase):
    def setUp(self):
        self.a = box('UCEditBox0', [0, 0, 0], [64, 64, 64])
        self.h = box('UCEditBox1', [100, 0, 0], [164, 64, 112], hole=True)
        self.last = exported(('Brush0', geom.box((-9, -9, -9), (9, 9, 9), geom.Mat('X')), 'CSG_Add'),
                             ('Brush7', brush_of(self.a), 'CSG_Add'),
                             ('Brush8', brush_of(self.h), 'CSG_Subtract'))

    def test_old_names_go_to_the_piece_of_the_same_shape(self):
        edits = dict(surfaces=[row('Brush8', 2), row('Brush7', 0), row('Brush0', 1), row('UCBlk_Other', 3)])
        pieces = [('UCBlk_UCEditBox1', brush_of(self.h).t3d())]           # the first block was deleted since
        got = surfaces.adopt(edits, self.last, pieces)
        self.assertEqual(got, {'Brush8': 'UCBlk_UCEditBox1'})
        self.assertEqual([r['targets'][0]['brush'] for r in edits['surfaces']],
                         ['UCBlk_UCEditBox1', 'Brush7', 'Brush0', 'UCBlk_Other'])
        self.assertEqual(edits['surfaces'][0]['targets'][0]['poly'], 2)   # the same face of it
        self.assertTrue(surfaces.adopted_lines(got)[0].startswith('  EDIT face changes of 1 block piece'))

    def test_a_texture_changed_since_still_matches(self):
        changed = exported(('Brush8', blocks.brushes(self.h, geom.Mat('Other_Tex'), 'x')[0], 'CSG_Subtract'))
        edits = dict(surfaces=[row('Brush8', 0)])
        self.assertEqual(surfaces.adopt(edits, changed, [('UCBlk_UCEditBox1', brush_of(self.h).t3d())]),
                         {'Brush8': 'UCBlk_UCEditBox1'})

    def test_never_a_guess(self):
        twin = dict(self.h, name='UCEditBox2')
        edits = dict(surfaces=[row('Brush8', 0)])
        self.assertEqual(surfaces.adopt(edits, self.last, [('UCBlk_UCEditBox1', brush_of(self.h).t3d()),
                                                           ('UCBlk_UCEditBox2', brush_of(twin).t3d())]), {})
        self.assertEqual(edits['surfaces'][0]['targets'][0]['brush'], 'Brush8')
        self.assertEqual(surfaces.adopt(dict(surfaces=[row('UCBlk_A', 0)]), self.last, [('UCBlk_A', 'x')]), {})
        self.assertEqual(surfaces.adopt(dict(surfaces=[row('Brush8', 0)]), '', [('UCBlk_A', 'x')]), {})

    def test_the_saved_edits_too(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'm.edits.json'
            p.write_text(json.dumps(dict(boxes=[], surfaces=[row('Brush8', 2), row('Brush9', 1)])), encoding='utf-8')
            surfaces.adopt_file(p, {'Brush8': 'UCBlk_UCEditBox1'})
            saved = json.loads(p.read_text(encoding='utf-8'))
            self.assertEqual([r['targets'][0]['brush'] for r in saved['surfaces']], ['UCBlk_UCEditBox1', 'Brush9'])
            self.assertEqual(saved['boxes'], [])


if __name__ == '__main__':
    unittest.main()
