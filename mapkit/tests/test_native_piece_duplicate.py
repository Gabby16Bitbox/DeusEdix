import sys, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(Path(__file__).parent), str(KIT/'editor'), str(KIT), str(KIT/'tests')]
import piece_duplicate as duplicate
import prefab_library, prefabs, geom, t3d
from test_prefab_library import LibraryCase, BRUSH, LIGHT, write_cache


class NativeDuplicateTest(LibraryCase):
    def setUp(self):
        super().setUp()
        self.desk['Desk'].update(label='Lamp fixture', pivot=[100,200,0], placement={})

    def capture(self, pose=None):
        return duplicate.capture('Office', self.cache/'Office', self.desk, 'Desk', pose or {})

    def test_fixture_and_both_lights_are_copied_and_original_cache_is_untouched(self):
        before = {p.name:p.read_bytes() for p in (self.cache/'Office').iterdir()}
        item = self.capture()
        blocks, brushes, actors = prefabs.place({'prefab':item['id'],'pid':'p6','offset':[48,0,0]})
        self.assertEqual((len(brushes), len(actors)),(1,2))
        self.assertEqual(item['members'],{'Light4':1,'Light7':2})
        self.assertEqual(t3d.vec(next(t3d.actors(blocks[1]))['props']['Location']),(158,200,64))
        self.assertEqual(before,{p.name:p.read_bytes() for p in (self.cache/'Office').iterdir()})
        self.assertEqual(prefab_library.library(),[])

    def test_full_live_rotation_scale_and_position_are_used_without_rebuild(self):
        pose={'offset':[40,-70,18],'yaw':13000,'pitch':4000,'roll':8000,'scale':[1.5,2,0.8],'stretch':True}
        xf=prefabs.entry_xform([100,200,0],pose)
        old=list(t3d.actors((self.cache/'Office'/'scene.t3d').read_text()))
        item=self.capture(pose)
        blocks=prefabs.place({'prefab':item['id'],'pid':'p8'})[0]
        got=list(t3d.world_verts(next(t3d.actors(blocks[0]))))[0][1]
        expected=[xf.point(p) for _,ps in t3d.world_verts(old[0]) for p in ps]
        for actual,want in zip(got,expected):
            for a,b in zip(actual,want): self.assertAlmostEqual(a,b,places=3)
        display=json.loads((self.root/item['id']/'display.json').read_text())
        for a,b in zip(display['groups'][0]['pos'][:9],sum((list(p) for p in expected[:3]),[])):
            self.assertAlmostEqual(a,b,places=3)

    def test_built_pose_is_not_applied_twice(self):
        pose={'offset':[240,-20,60],'yaw':16384,'pitch':0,'roll':0,'scale':[2,3,1],'stretch':True}
        xf=prefabs.entry_xform([100,200,0],pose)
        blocks=[prefabs.xf_block(a['raw'],xf) for a in t3d.actors((self.cache/'Office'/'scene.t3d').read_text())]
        write_cache(self.cache/'Office',blocks,self.desk)
        self.desk['Desk']['placement']=pose
        item=self.capture(pose)
        got=prefabs.place({'prefab':item['id'],'pid':'p8'})[0]
        before=[p for _,vs in t3d.world_verts(next(t3d.actors(blocks[0]))) for p in vs]
        after=[p for _,vs in t3d.world_verts(next(t3d.actors(got[0]))) for p in vs]
        for p,q in zip(before,after):
            for a,b in zip(p,q): self.assertAlmostEqual(a,b,places=3)

    def test_two_copies_have_independent_assets_and_names(self):
        a,b=self.capture(),self.capture()
        self.assertNotEqual(a['id'],b['id'])
        aa=prefabs.place({'prefab':a['id'],'pid':'p1'})[1:]
        bb=prefabs.place({'prefab':b['id'],'pid':'p2'})[1:]
        self.assertFalse(set(sum(aa,[])) & set(sum(bb,[])))

    def test_missing_piece_and_bad_pose_do_not_publish_partial_assets(self):
        for pose in [{'scale':[0,1,1]},{'offset':[float('nan'),0,0]}]:
            with self.assertRaises(ValueError): self.capture(pose)
        with self.assertRaises(ValueError): duplicate.capture('Office',self.cache/'Office',{},'Missing',{})
        self.assertFalse(self.root.exists())

    def test_gameplay_link_is_reported_instead_of_silently_dropped(self):
        path=self.cache/'Office'/'scene.t3d'
        path.write_text(path.read_text().replace('Name=Light4\n','Name=Light4\n    Event=DoorOne\n',1))
        with self.assertRaisesRegex(ValueError,'gameplay Event'): self.capture()
        self.assertFalse(self.root.exists())

if __name__=='__main__': unittest.main()
