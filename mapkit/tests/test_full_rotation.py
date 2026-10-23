import ast, json, sys, unittest
from pathlib import Path
from unittest.mock import patch
KIT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(KIT),str(KIT/'editor')]
import geom, scene, prefabs, moving_pieces, gamelib, drawn, motions, dxmaps
class TransformTests(unittest.TestCase):
    def new(self):
        with patch('texcat.ensure_index',return_value=False): return scene.Scene('Test')
    def test_ue_rotation(self):
        self.assertAlmostEqual(geom.XForm((0,0,0),pitch=16384).vec((1,0,0))[2],1)
        self.assertAlmostEqual(geom.XForm((0,0,0),roll=16384).vec((0,1,0))[2],-1)
        a,b=(5000,7000,1200),(3000,9000,1800)
        c=geom.rotation_matrix(geom.compose_rotation(a,b));aa,bb=geom.rotation_matrix(a),geom.rotation_matrix(b)
        for i in range(3):
            for j in range(3): self.assertAlmostEqual(c[i][j],sum(aa[i][k]*bb[k][j] for k in range(3)),delta=0.00015)
    def test_unnested_geometry_can_duplicate_under_protected_parent(self):
        s=self.new();s.begin_group('roof',copyable=False);s.add(geom.box((0,0,0),(100,60,20),'Metal'));s.end_group()
        s._apply_groups({});pc=s.structures()['roof']['pieces'][0]
        self.assertTrue(pc['copyable'])
        s=self.new();s.begin_group('roof',copyable=False);s.add(geom.box((0,0,0),(100,60,20),'Metal'));s.end_group()
        edit={'unnest':[pc['id']],'copies':[{'group':pc['id'],'id':'c1','offset':[200,0,0],'pitch':8000,'roll':3000,'scale':[0.4,0.7,2]}]}
        s._apply_groups(edit);key=pc['id']+'~c1'
        self.assertIn(key,s.groups);self.assertEqual(s.placement[key]['pitch'],8000);self.assertEqual(s.placement[key]['scale'],[0.4,0.7,2])
    def test_story_actor_stays_protected(self):
        s=self.new();s.begin_group('room',copyable=False);s.actor('UNATCOTroop',(1,2,3),name='StoryGuard');s.end_group()
        s._apply_groups({});self.assertFalse(s._copyable('room'))
    def test_actor_in_structure_keeps_compound_rotation(self):
        xf=geom.XForm((0,0,0),pitch=1234,yaw=5000,roll=2300)
        raw=scene.Scene._block('ScientistFemale',(10,20,30),'June',(6000,10000,2000),'',{})
        import t3d
        a=next(t3d.actors(scene.Scene._xf_block(raw,xf)))
        self.assertEqual(t3d.rot(a['props']['Rotation']),xf.rot((6000,10000,2000)))
    def test_box_rotation_is_baked_in_script_geometry(self):
        s=self.new();s._apply_box_edits({'boxes':[{'name':'B','lo':[0,0,0],'hi':[100,20,10],'tex':'Metal','rot':[16384,0,0]}]})
        lo,hi=s.ops[0][1].bounds();self.assertAlmostEqual(hi[2]-lo[2],100);self.assertAlmostEqual(hi[0]-lo[0],10)
    def test_all_native_mover_endpoints_follow_rotation(self):
        import mover_transform,t3d
        props={'Location':'(X=100,Y=200,Z=300)','Rotation':'(Pitch=1200,Yaw=3000,Roll=4000)','BasePos':'(X=100,Y=200,Z=300)','BaseRot':'(Pitch=1200,Yaw=3000,Roll=4000)'}
        for i in range(8):
            props[f'KeyPos({i})']=f'(X={i*20},Y={i*11},Z={i*5})'
            props[f'KeyRot({i})']=f'(Pitch={i*170},Yaw={i*300},Roll={i*90})'
        xf=geom.XForm((10,20,30),(40,50,60),yaw=7000,pitch=4000,roll=3200)
        result=mover_transform.properties(props,xf)
        base=t3d.rot(props['BaseRot']);newbase=t3d.rot(result['BaseRot'])
        for i in range(8):
            got=t3d.vec(result[f'KeyPos({i})']);expected=xf.vec(t3d.vec(props[f'KeyPos({i})']))
            self.assertLess(max(abs(got[k]-expected[k]) for k in range(3)),.001)
            oldkey=t3d.rot(props[f'KeyRot({i})']);newkey=t3d.rot(result[f'KeyRot({i})'])
            end=geom.rotation_matrix(xf.rot(tuple(base[k]+oldkey[k] for k in range(3))))
            actual=geom.rotation_matrix(tuple(newbase[k]+newkey[k] for k in range(3)))
            self.assertLess(max(abs(end[j][k]-actual[j][k]) for j in range(3) for k in range(3)),.0002)
    def test_repeated_mover_relocation_does_not_rotate_travel_twice(self):
        import mover_transform,t3d
        props={'Location':'(X=100,Y=200,Z=300)','Rotation':'(Pitch=0,Yaw=0,Roll=0)','KeyPos(1)':'(X=50,Y=0,Z=0)'}
        target=(4200,8000,2800);location=(400,500,600)
        once=mover_transform.properties(props,mover_transform.relocation(props,location,target))
        updated={**props,**once,'Location':once['BasePos'],'Rotation':once['BaseRot']}
        again=mover_transform.properties(updated,mover_transform.relocation(updated,location,target))
        self.assertEqual(again['KeyPos(1)'],once['KeyPos(1)'])

if __name__ == '__main__':
    unittest.main()
