"""Climbable areas (editor/climb.py): the walls inside the box get an invisible ladder skin, only inside the box."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import climb  # noqa: E402

# a room as the cache keeps it: polygons seen from inside it (their normals into the room)
ROOM = [
    ([(480, 512, 0), (480, -512, 0), (480, -512, 384), (480, 512, 384)], 0),        # wall x=480, seen toward -x
    ([(-480, -512, 0), (-480, 512, 0), (-480, 512, 384), (-480, -512, 384)], 0),    # wall x=-480, toward +x
    ([(-480, 512, 0), (480, 512, 0), (480, 512, 384), (-480, 512, 384)], 0),        # wall y=512, toward -y
    ([(-480, -512, 0), (480, -512, 0), (480, 512, 0), (-480, 512, 0)], 0),          # the floor
    ([(-480, -512, 384), (-480, 512, 384), (480, 512, 384), (480, -512, 384)], 0),  # the ceiling
]


def area(lo, hi, **kw):
    return dict(dict(name='UCEditBox3', lo=lo, hi=hi, tex='ClenGreyCncrt_A', solid=True, climb=True), **kw)


class ClimbArea(unittest.TestCase):
    def test_room_normals_face_the_room(self):
        self.assertEqual(climb._normal(ROOM[0][0]), (-1.0, 0.0, 0.0))
        self.assertEqual(climb._normal(ROOM[3][0])[2], 1.0)

    def test_a_skin_on_the_wall_inside_the_box_only(self):
        [br] = climb.brushes(area([440, -64, 0], [520, 64, 256]), ROOM)
        lo, hi = br.bounds()
        self.assertEqual((lo, hi), ((480 - climb.SKIN, -64, 0), (480 + climb.BACK, 64, 256)))
        self.assertTrue(all(f.mat.tex == climb.LADDER_TEX and f.mat.flags == climb.PF_INVISIBLE for f in br.faces))
        self.assertEqual(len(br.faces), 6)

    def test_a_corner_gets_both_walls(self):
        out = climb.brushes(area([440, 448, 0], [520, 560, 256]), ROOM)
        self.assertEqual(len(out), 2)

    def test_no_wall_inside_no_skin(self):
        self.assertEqual(climb.brushes(area([0, 0, 100], [50, 50, 150]), ROOM), [])

    def test_floors_ceilings_and_what_is_not_a_wall_are_left(self):
        flat = area([-100, -100, -16], [100, 100, 16])               # across the floor only
        self.assertEqual(climb.brushes(flat, ROOM), [])
        for flags in (climb.PF_INVISIBLE, climb.PF_NOTSOLID, climb.PF_FAKEBACKDROP, climb.PF_PORTAL):
            polys = [(ROOM[0][0], flags)]
            self.assertEqual(climb.brushes(area([440, -64, 0], [520, 64, 256]), polys), [], flags)

    def test_its_own_skins_are_not_walls_again(self):
        b = area([440, -64, 0], [520, 64, 256])
        [skin] = climb.brushes(b, ROOM)
        rebuilt = ROOM + [([tuple(p) for p in f.verts], f.mat.flags) for f in skin.faces]
        self.assertEqual(len(climb.brushes(b, rebuilt)), 1)

    def test_pieces_of_one_wall_merge_a_doorway_stays_open(self):
        # the wall x=480 cut by the BSP in two halves: one skin
        halves = [([(480, 0, 0), (480, -512, 0), (480, -512, 384), (480, 0, 384)], 0),
                  ([(480, 512, 0), (480, 0, 0), (480, 0, 384), (480, 512, 384)], 0)]
        self.assertEqual(len(climb.brushes(area([440, -64, 0], [520, 64, 256]), halves)), 1)
        # a doorway between two pieces: two skins, the doorway free
        door = [([(480, -32, 0), (480, -512, 0), (480, -512, 384), (480, -32, 384)], 0),
                ([(480, 512, 0), (480, 32, 0), (480, 32, 384), (480, 512, 384)], 0)]
        out = climb.brushes(area([440, -64, 0], [520, 64, 256]), door)
        self.assertEqual(len(out), 2)
        self.assertTrue(all(br.bounds()[1][1] <= -32 or br.bounds()[0][1] >= 32 for br in out))

    def test_a_turned_box_cuts_along_its_own_sides(self):
        [br] = climb.brushes(area([440, -64, 0], [520, 64, 256], rot=[0, 8192, 0]), ROOM)
        lo, hi = br.bounds()
        self.assertAlmostEqual(hi[1], -lo[1], places=3)
        self.assertLess(hi[1], 64)                                    # narrower where the turned box crosses it

    def test_the_cache_and_the_packages(self):
        with tempfile.TemporaryDirectory() as tmp:
            import packed
            folder = Path(tmp) / 'M'
            folder.mkdir()
            rows = [['T.G.x', flags, [0] * 13, [c for p in pts for c in p], 0] for pts, flags in ROOM]
            (folder / 'polys.json').write_text(json.dumps(rows), encoding='utf-8')
            self.assertTrue(packed.exists(folder / 'polys.json'))
            polys = climb.world_polys('M', tmp)
            self.assertEqual(len(polys), len(ROOM))
            self.assertEqual(polys[0][0][0], (480, 512, 0))
            self.assertEqual(climb.world_polys('Nothing', tmp), [])
        self.assertEqual(climb.packages({'boxes': [area([0, 0, 0], [1, 1, 1])]}), ['OBJ LOAD FILE="CoreTexMetal.utx"'])
        self.assertEqual(climb.packages({'boxes': [dict(name='B', lo=[0, 0, 0], hi=[1, 1, 1])]}), [])

    def test_what_the_build_says(self):
        b = area([0, 0, 0], [1, 1, 1])
        self.assertIn('Rebuild once more', climb.report_line(b, 0, []))
        self.assertIn('no wall inside it', climb.report_line(b, 0, ROOM))
        self.assertIn('2 pieces of wall', climb.report_line(b, 2, ROOM))

    def test_turned_on_and_off_only_when_a_rule_names_it_or_it_starts_off(self):
        b = area([440, -64, 0], [520, 64, 256])
        self.assertFalse(climb.switched(b, {}))
        self.assertFalse(climb.switched(b, {'links': [{'id': 'L1', 'src': 'Lever', 'do': [{'verb': 'open', 'target': 'Door'}]}]}))
        rule = {'id': 'L1', 'src': '', 'do': [{'verb': 'input', 'target': 'ucEditBox3', 'a': 'Off'}]}
        self.assertTrue(climb.switched(b, {'links': [rule]}))                  # any letter case, as the game's names
        self.assertTrue(climb.switched(dict(b, climbOff=True), {}))
        self.assertFalse(climb.switched(dict(b, climb=False, climbOff=True), {}))

    def test_its_slabs_wait_in_the_wall_and_come_out_over_the_skin(self):
        b = area([440, -64, 0], [520, 64, 256])
        (loc, props), slabs = climb.switch_parts(b, ROOM)
        self.assertEqual(loc, (480, 0, 128))
        self.assertEqual(props, {})
        [(name, at, rel, sp)] = slabs
        self.assertEqual(name, 'UCEditBox3_Off0')
        self.assertEqual(sp['Tag'], 'UCEditBox3')
        self.assertNotIn('KeyNum', sp)
        lo, hi = rel.bounds()
        # in (key 0): inside the wall (x > 480), behind the skin's face (480 - SKIN)
        self.assertGreater(at[0] + lo[0], 480 - climb.SKIN + 0.1)
        self.assertGreaterEqual(at[0] + lo[0], 480)
        # out (key 1): its face past the skin's, still touching the skin
        out_lo = at[0] + lo[0] + sp['KeyPos(1)'][0]
        out_hi = at[0] + hi[0] + sp['KeyPos(1)'][0]
        self.assertLess(out_lo, 480 - climb.SKIN)
        self.assertGreater(out_hi, 480 - climb.SKIN)
        self.assertEqual((lo[1] + at[1], hi[1] + at[1], lo[2] + at[2], hi[2] + at[2]), (-64, 64, 0, 256))
        self.assertTrue(all(f.mat.flags == climb.PF_INVISIBLE and f.mat.tex != climb.LADDER_TEX for f in rel.faces))
        (loc, props), slabs = climb.switch_parts(dict(b, climbOff=True), ROOM)
        self.assertEqual(props, {'bOff': 'True'})
        self.assertNotIn('KeyNum', slabs[0][3])
        t3d = climb.slab_t3d(*slabs[0])
        self.assertIn('Begin Actor Class=UCClimbBlock Name=UCEditBox3_Off0', t3d)
        self.assertIn('KeyPos(1)=', t3d)
        self.assertIn("Brush=Model'MyLevel.UCMdlUCEditBox3_Off0'", t3d)
        self.assertIn('starts off', climb.switch_line(dict(b, climbOff=True), 1))

    def test_other_blocks_leave_it_out(self):
        import blocks
        import t3d_clipboard
        b = area([440, -64, 0], [520, 64, 256], shape='cylinder')
        self.assertEqual(blocks.shape_of(b), 'box')
        out = t3d_clipboard.export([{'kind': 'box', 'box': b}])
        self.assertEqual(out['text'].count('Begin Actor'), 0)
        self.assertTrue(out['skipped'])


if __name__ == '__main__':
    unittest.main()
