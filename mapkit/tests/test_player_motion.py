"""Pure math/serialization regressions. No game assets or game processes needed."""
import math, struct, sys, unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
KIT=HERE.parent
sys.path[:0]=[str(KIT/'editor'),str(KIT)]
import player_motion as motion


class MotionTests(unittest.TestCase):
    def fixture(self):
        raw=struct.pack('<24h',0,0,0, 20,0,0, 0,20,0, 0,0,20,
                        10,0,0, 30,0,0, 10,20,0, 10,0,20)
        info=dict(counts=dict(frameVerts=4,specialVerts=0,faces=0,wedges=0,specialFaces=0,verts=8),
                  offset=0,scale=[.5,.5,.5],origin=[0,0,2],rot=[0,16384,0],
                  seqs=[dict(name='Still',start=0,frames=1,rate=1,group='None',notifys=[]),
                        dict(name='Walk',start=0,frames=2,rate=2,group='None',notifys=[])])
        return motion.Mesh(info,raw),raw

    def test_rigid_fit_rotation_translation(self):
        points=[(0,0,0),(1,0,0),(0,1,0),(0,0,1),(1,2,3)]
        target=[(-y+3,x-2,z+7) for x,y,z in points]
        r,t=motion.rigid_fit(points,target)
        for p,q in zip(points,target):
            result=[a+b for a,b in zip(motion.matvec(r,p),t)]
            self.assertLess(math.dist(result,q),1e-7)

    def test_rigid_fit_identity(self):
        points=[(0,0,0),(3,0,0),(0,7,0),(0,0,4)]
        r,t=motion.rigid_fit(points,points)
        self.assertLess(math.dist(t,(0,0,0)),1e-8)
        self.assertLess(math.dist(motion.matvec(r,(1,2,3)),(1,2,3)),1e-8)

    def test_raw_roundtrip_rotated_origin(self):
        mesh,raw=self.fixture()
        self.assertEqual(mesh.encode(mesh.points),raw)

    def test_interpolation(self):
        mesh,_=self.fixture()
        a=mesh.sample('Walk',0); b=mesh.sample('Walk',1); middle=mesh.sample('Walk',.5)
        for p,q,r in zip(a,b,middle):
            self.assertLess(math.dist(r,[(x+y)/2 for x,y in zip(p,q)]),1e-8)
        for a,b in zip(mesh.sample('Walk',.75,loop=True),middle):
            self.assertLess(math.dist(a,b),1e-8)

    def test_coordinate_overflow_fails_instead_of_clipping(self):
        mesh,_=self.fixture()
        with self.assertRaisesRegex(ValueError,'coordinate range'):
            mesh.encode([(1e6,0,0)])

    def test_surface_constraints_remove_spikes(self):
        rest=[(0,0,0),(1,0,0),(0,1,0),(1,1,0)]
        edges=[(0,1),(0,2),(1,3),(2,3),(0,3)]
        adapted=motion.preserve_shape([(0,0,0),(1,0,0),(0,1,0),(99,99,99)],rest,edges)
        for a,b in edges:
            self.assertLess(math.dist(adapted[a],adapted[b]),math.dist(rest[a],rest[b])*1.22)

    def test_missing_combat_motion_uses_existing_base(self):
        mesh,_=self.fixture()
        self.assertEqual(motion.base_motion('Strafe2H',mesh),'Walk')

    def test_one_frame_placeholders_are_adapted_but_real_motions_unchanged(self):
        target,_=self.fixture(); donor,_=self.fixture()
        target.seqs['Reload']=dict(frames=1); donor.seqs['Reload']=dict(frames=4)
        self.assertTrue(motion.needs_motion('Reload',target,donor))
        target.seqs['Reload']['frames']=3
        self.assertFalse(motion.needs_motion('Reload',target,donor))
        self.assertFalse(motion.needs_motion('Still',target,donor))


if __name__=='__main__': unittest.main(verbosity=2)
