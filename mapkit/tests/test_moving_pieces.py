import ast
import json
from pathlib import Path
import re
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'editor'),str(ROOT)]
import moving_pieces as moving
import prefabs
import geom
import t3d


def actor(**props):
    values=dict(Location='(X=100,Y=200,Z=300)', Rotation='(Yaw=16384)',
                **{'KeyPos(1)':'(X=80,Y=0,Z=0)'})
    values.update(props)
    raw=('Begin Actor Class=DeusExMover Name=Door1\n'
         '    Begin Brush Name=DoorModel\n        Begin PolyList\n'
         '          Begin Polygon Texture=TestDoor\n'
         '             Origin +0,+0,+0\n             TextureU +1,+0,+0\n             TextureV +0,+1,+0\n'
         '             Vertex +0,+0,+0\n             Vertex +128,+0,+0\n'
         '             Vertex +128,+128,+16\n             Vertex +0,+128,+16\n'
         '          End Polygon\n        End PolyList\n    End Brush\n'
         "    Brush=Model'MyLevel.DoorModel'\n"+
         ''.join('    %s=%s\n'%kv for kv in values.items())+'End Actor\n')
    return next(t3d.actors(raw))


class MovingPiecesTests(unittest.TestCase):
    def template(self,a=None,kind='door'):
        return moving.template(a or actor(),kind,{'Test.Walls.TestDoor'})

    def test_supported_door_and_lift(self):
        self.assertEqual(moving.kind(actor()),'door')
        self.assertEqual(moving.kind(actor(**{'KeyPos(1)':'(Z=400)'})),'elevator')

    def test_shutter_is_not_lift(self):
        a=actor(**{'KeyPos(1)':'(Z=400)'})
        with patch.object(t3d,'bounds',return_value=((0,0,0),(128,8,160))):
            self.assertEqual(moving.kind(a),'door')

    def test_exclude_complex_and_static(self):
        for args in ({'NumKeys':'4'},{'KeyNum':'1'},{'Rotation':'(Pitch=16384)'},
                     {'KeyPos(1)':'(X=0)'},{'KeyRot(1)':'(Roll=500)'},
                     {'MainScale':'(SheerRate=0.500000)'},{'bHidden':'True'}):
            self.assertIsNone(moving.kind(actor(**args)),args)
        a=actor();a['cls']='MultiMover'
        self.assertIsNone(moving.kind(a))

    def test_drop_original_mission_dependencies(self):
        a=actor(Tag='AnnaDoor',Event='AnnaDead',ReturnGroup='OtherDoor',KeyIDNeeded='SecretKey',
                bLocked='True',InitialState='TriggerControl',Leader="DeusExMover'MyLevel.AnotherDoor'",
                BasePos='(X=9999)',SavedPos='(X=9999)',bSlave='True',BumpEvent='MissionFlag')
        p=next(t3d.actors(self.template(a)))['props']
        for key in ('Tag','Event','ReturnGroup','KeyIDNeeded','Leader','BasePos','SavedPos','BumpEvent'):
            self.assertNotIn(key,p)
        self.assertEqual(p['bLocked'],'False');self.assertEqual(p['InitialState'],'TriggerToggle')
        self.assertEqual(p['bSlave'],'False')

    def test_preserve_motion_and_sound(self):
        a=actor(OpeningSound="Sound'MoverSFX.Door.Open'",MoveTime='2.500000',**{'KeyRot(1)':'(Yaw=16384)'})
        p=next(t3d.actors(self.template(a)))['props']
        for key in ('MoveTime','OpeningSound','KeyPos(1)','KeyRot(1)'):
            self.assertEqual(a['props'][key],p[key])

    def test_elevator_operation(self):
        a=actor(**{'KeyPos(1)':'(Z=400)'})
        p=next(t3d.actors(self.template(a,'elevator')))['props']
        self.assertEqual(p['InitialState'],'StandOpenTimed')
        self.assertEqual(p['BumpType'],'BT_PlayerBump')
        self.assertEqual(p['bFrobbable'],'False')

    def test_ambiguous_or_level_local_resources_rejected(self):
        with self.assertRaises(ValueError):moving.template(actor(),'door',{'A.TestDoor','B.TestDoor'})
        with self.assertRaises(ValueError):self.template(actor(OpeningSound="Sound'MyLevel.StorySound'"))

    def test_move_rotate_duplicate_and_uniform_scale(self):
        raw=self.template()
        pf=dict(pivot=[100,200,300],blocks=[dict(raw=raw,brush=False,mover=True)],id='test')
        names=[]; models=[]
        for pid,yaw in [('one',16384),('two',32768)]:
            blocks,brushes,actors=prefabs.place(dict(_prefab=pf,pid=pid,offset=[1000,2000,3000],yaw=yaw,scale=[2,2,2]))
            self.assertFalse(brushes);self.assertEqual(len(actors),1)
            a=next(t3d.actors(blocks[0]));p=a['props'];names.append(p['Tag']);models.append(p['Brush'])
            self.assertEqual(t3d.vec(p['Location']),(1100,2200,3300))
            self.assertEqual(p['BasePos'],p['Location']);self.assertEqual(p['BaseRot'],p['Rotation'])
            self.assertEqual(t3d.vec(p['KeyPos(1)']), (0,160,0) if yaw==16384 else (-160,0,0))
        self.assertEqual(len(set(names)),2);self.assertEqual(len(set(models)),2)

    def test_zero_transform_still_sets_base_and_tag(self):
        pf=dict(pivot=[0,0,0],blocks=[dict(raw=self.template(),brush=False,mover=True)])
        blocks,_,_=prefabs.place(dict(_prefab=pf,pid='zero'))
        p=next(t3d.actors(blocks[0]))['props']
        self.assertEqual(p['Tag'],'UCPfzeroA0');self.assertEqual(p['BasePos'],p['Location'])

    def test_static_paste_stays_static(self):
        raw=actor()['raw'].replace('Class=DeusExMover','Class=Brush')
        blocks,brushes,actors=prefabs.place(dict(_prefab=dict(pivot=[0,0,0],blocks=[dict(raw=raw,brush=True)]),pid='static'))
        self.assertEqual(brushes,['UCPfstaticB0']);self.assertFalse(actors)
        p=next(t3d.actors(blocks[0]))['props']
        self.assertNotIn('BasePos',p);self.assertNotIn('Tag',p)

    def test_new_ids_and_traversal(self):
        for good in ('01_NYC_UNATCOHQ~44','01_NYC_UNATCOHQ~mDeusExMover42'):
            self.assertIsNotNone(re.fullmatch(moving.IDENTITY,good))
        for bad in ('../01_A~mDoor','01_A~m../door','01_A~mDoor/xx'):
            self.assertIsNone(re.fullmatch(moving.IDENTITY,bad))

    def test_cache_invalidates_when_scene_changes(self):
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td);scene=folder/'scene.t3d';scene.write_text('old')
            (folder/moving.ASSETS).write_text(json.dumps(dict(stamp=moving._stamp(folder),meshes={})))
            self.assertTrue(moving.ready(folder));scene.write_text('different scene')
            self.assertFalse(moving.ready(folder))

    def test_sound_packages_loaded_explicitly(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);(root/'MoverSFX.uax').touch()
            with patch.object(prefabs.settings,'GAME',root),patch.object(prefabs.settings,'GAME_ROOT',root),patch.object(prefabs.settings,'SYSTEM_DIRS',[root]):
                self.assertEqual(prefabs.package_commands(['sound:MoverSFX']),['OBJ LOAD FILE="MoverSFX.uax"'])
                with self.assertRaises(ValueError):prefabs.package_commands(['sound:Missing'])
                with self.assertRaises(ValueError):prefabs.package_commands(['sound:../outside'])

    def test_scene_prepares_inserted_movers(self):
        tree=ast.parse((ROOT/'scene.py').read_text(encoding='utf-8'))
        cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Scene')
        node=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='_apply_prefabs')
        ns={'Path':Path,'__file__':str(ROOT/'scene.py'),'_head':lambda raw:re.search(r'Begin Actor Class=(\S+) Name=(\S+)',raw).groups()}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'scene-test','exec'),ns)
        raw=self.template();pf=dict(id='door',label='Door',source='01_Test',pivot=[0,0,0],packages=[],blocks=[dict(raw=raw,brush=False,mover=True)])
        state=SimpleNamespace(pastes=[],extra_obj=[],groups={},pivots={},placement={},actors=[],movers=[],actor_group={})
        with patch.object(prefabs,'load',return_value=pf):
            ns['_apply_prefabs'](state,{'prefabs':[dict(prefab='door',pid='one')]})
        self.assertEqual(state.movers,['UCPfoneA0'])
        self.assertEqual(state.actor_group['UCPfoneA0'],'paste~one')

def hinged(**props):
    """A door 64 wide along +x from its hinge at the origin, turning a quarter (Yaw 16384) to open."""
    values={'Location':'(X=0,Y=0,Z=0)','KeyRot(1)':'(Yaw=16384)','bIsDoor':'True'}
    values.update(props)
    raw=('Begin Actor Class=DeusExMover Name=Door2\n'
         '    Begin Brush Name=DoorModel\n        Begin PolyList\n          Begin Polygon Texture=TestDoor\n'
         '             Vertex +0,-4,+0\n             Vertex +64,-4,+0\n             Vertex +64,+4,+128\n'
         '             Vertex +0,+4,+128\n          End Polygon\n        End PolyList\n    End Brush\n'+
         ''.join('    %s=%s\n'%kv for kv in values.items())+'End Actor\n')
    return raw


def box_door():
    """The library door of Deep Ops' 02_Close_Test: 8 thick, 64 wide, 128 high, hinged on its +x face."""
    faces=[]
    for axis in range(3):
        for side in (0,1):
            lo,hi=(-8,-32,-64),(0,32,64)
            corners=[]
            for a in (0,1):
                for b in (0,1) if a==0 else (1,0):
                    q=[0,0,0];q[axis]=(lo,hi)[side][axis]
                    o=[i for i in range(3) if i!=axis]
                    q[o[0]]=(lo,hi)[a][o[0]];q[o[1]]=(lo,hi)[b][o[1]];corners.append(q)
            faces.append('          Begin Polygon Texture=TestDoor\n'+''.join(
                '             Vertex %+f,%+f,%+f\n'%tuple(c) for c in corners)+'          End Polygon\n')
    return ('Begin Actor Class=DeusExMover Name=Door3\n    bIsDoor=True\n    KeyRot(1)=(Yaw=-16384)\n'
            '    BasePos=(X=132.000000,Y=-200.000000,Z=128.000000)\n'
            '    Location=(X=132.000000,Y=-200.000000,Z=128.000000)\n'
            '    Begin Brush Name=Door3M\n       Begin PolyList\n'+''.join(faces)+
            '       End PolyList\n    End Brush\n    PrePivot=(Y=-32.000000,Z=64.000000)\nEnd Actor\n')


class DoorOpensTests(unittest.TestCase):
    """Which way a library door swings (the Inspector's Opens, 17 Nov 2026): Gabby's doors opened toward JC."""
    def props(self,raw):
        a=next(t3d.actors(raw));return a['cls'],a['props']

    def test_a_door_goes_on_opening_when_it_meets_someone_a_lift_goes_back(self):
        self.assertEqual(next(t3d.actors(moving.template(actor(**{'KeyRot(1)':'(Yaw=16384)'}),'door',{'Test.Walls.TestDoor'})))['props']['MoverEncroachType'],'ME_IgnoreWhenEncroach')
        lift=actor(**{'KeyPos(1)':'(Z=400)'})
        self.assertEqual(next(t3d.actors(moving.template(lift,'elevator',{'Test.Walls.TestDoor'})))['props']['MoverEncroachType'],'ME_ReturnWhenEncroach')
        # a door of a prefab made before (Return) is placed as one that goes on
        old=hinged(MoverEncroachType='ME_ReturnWhenEncroach')
        self.assertEqual(self.props(moving.placed(old,geom.XForm((0,0,0),(0,0,0),0,(1,1,1),False),'D'))[1]['MoverEncroachType'],'ME_IgnoreWhenEncroach')

    def test_the_middle_of_the_door_turns_about_its_hinge(self):
        a=next(t3d.actors(hinged()))
        for yaw,want in [(0,(32,0)),(16384,(0,32)),(-16384,(0,-32))]:
            got=moving.swing_center(a,yaw)
            self.assertAlmostEqual(got[0],want[0],3);self.assertAlmostEqual(got[1],want[1],3)

    def test_built_other_away(self):
        raw=hinged()
        self.assertEqual(moving.opening(raw,None),raw)
        self.assertEqual(moving.opening(raw,{'opens':'built'}),raw)
        cls,p=self.props(moving.opening(raw,{'opens':'other'}))
        self.assertEqual((cls,t3d.rot(p['KeyRot(1)'])),('DeusExMover',(0,-16384,0)))
        cls,p=self.props(moving.opening(raw,{'opens':'away'}))
        self.assertEqual((cls,t3d.rot(p['KeyRot(1)'])),('UCDoorMover',(0,16384,0)))   # the game class picks each time

    def test_into_takes_the_way_toward_the_room(self):
        cls,p=self.props(moving.opening(hinged(),{'opens':'into','into':[0,300,0]}))
        self.assertEqual(t3d.rot(p['KeyRot(1)']),(0,16384,0))          # its own way already swings to +y
        cls,p=self.props(moving.opening(hinged(),{'opens':'into','into':[10,-300,40]}))
        self.assertEqual(t3d.rot(p['KeyRot(1)']),(0,-16384,0))
        cls,p=self.props(moving.opening(hinged(**{'KeyRot(1)':'(Yaw=-16384)'}),{'opens':'into','into':[0,300]}))
        self.assertEqual(t3d.rot(p['KeyRot(1)']),(0,16384,0))

    def test_a_sliding_door_or_a_lift_is_left_as_it_is(self):
        slide=hinged(**{'KeyRot(1)':'(Yaw=0)','KeyPos(1)':'(X=64)'})
        for how in ('other','away',):
            self.assertEqual(moving.opening(slide,{'opens':how}),slide)
        lift=hinged(bIsDoor='False')
        self.assertEqual(moving.opening(lift,{'opens':'away'}),lift)

    def test_settings_are_checked(self):
        for bad in ({'opens':'sideways'},{'opens':'into'},{'opens':'into','into':[1,'x',2]},{'opens':'into','into':[True,1,2]}):
            with self.assertRaises(ValueError,msg=bad):moving.apply_settings(hinged(),bad)
        self.assertEqual(moving.apply_settings(hinged(),{'opens':'away'}),hinged())

    def test_placed_copy_keeps_its_way_after_a_turn(self):
        # placed() sets the keys again from the original (mover_transform): the way is chosen after it (prefabs.place)
        pf=dict(pivot=[32,0,0],blocks=[dict(raw=hinged(),brush=False,mover=True)])
        blocks,_,_=prefabs.place(dict(_prefab=pf,pid='d',offset=[1000,0,0],yaw=16384,moverSettings={'opens':'other'}))
        cls,p=self.props(blocks[0])
        self.assertEqual(t3d.rot(p['KeyRot(1)'])[1],-16384)
        blocks,_,_=prefabs.place(dict(_prefab=pf,pid='d',offset=[1000,0,0],yaw=16384,moverSettings={'opens':'away'}))
        self.assertTrue(blocks[0].startswith('Begin Actor Class=UCDoorMover Name=UCPfdA0'))
        self.assertEqual(self.props(blocks[0])[1]['MoverEncroachType'],'ME_IgnoreWhenEncroach')

    def test_the_other_way_turns_about_the_other_face(self):
        # Gabby, 17 Nov 2026: a door 8 thick hinged on its +x face went into the jamb turned the other way.
        # Like UCPfp1A0: x -8..0 from the hinge, 64 wide toward +y, PrePivot (0,-32,64), opens Yaw -16384 (to +x)
        door=box_door()
        shut=sorted(v for _,vs in t3d.world_verts(next(t3d.actors(door))) for v in vs)
        cls,p=self.props(moving.opening(door,{'opens':'other'}))
        a=next(t3d.actors(moving.opening(door,{'opens':'other'})))
        self.assertEqual(t3d.rot(p['KeyRot(1)'])[1],16384)
        self.assertEqual((t3d.vec(p['Location']),t3d.vec(p['BasePos'])),((124,-200,128),(124,-200,128)))
        got=sorted(v for _,vs in t3d.world_verts(a) for v in vs)      # shut it stays where it was
        for g,w in zip(got,shut):
            for k in range(3):self.assertAlmostEqual(g[k],w[k],3)
        # open, it lies on the -x side from x 60 to 124, y -200..-192: out of the jamb (y < -200 is the wall)
        a['props']['Rotation']='(Yaw=16384)'
        lo,hi=t3d.bounds(a)
        for g,w in zip(lo+hi,(60,-200,0,124,-192,128)):self.assertAlmostEqual(g,w,3)

    def test_away_gets_both_hinges_and_where_the_door_ends(self):
        cls,p=self.props(moving.opening(box_door(),{'opens':'away'}))
        self.assertEqual(cls,'UCDoorMover')
        want={'MirrorHinge':(-8,0,0),'MirrorPrePivot':(-8,0,0),'MirrorKeyPos':(0,0,0),
              'BuiltMiddle':(164,-196,64),'MirrorMiddle':(92,-196,64)}
        for key,w in want.items():
            for g,v in zip(t3d.vec(p[key]),w):self.assertAlmostEqual(g,v,3,msg=key)

    def test_the_room_each_way_is_on_its_own_side_of_the_wall(self):
        # the Discord's gate in a narrow alley: the lines it sweeps, each way (the wall is x 120..136, door x 124..132)
        room=moving.sweep(next(t3d.actors(box_door())))
        self.assertEqual((len(room['built']),len(room['other'])),(10,10))
        for a,b in room['built']:
            self.assertTrue(all(q[0]>136 and -200<q[1]<-136 and q[2] in (32,96) for q in (a,b)),(a,b))
        for (a,b),(c,d) in zip(room['built'],room['other']):       # the mirror image about the middle of the door, x 128
            for q,r in ((a,c),(b,d)):
                for g,w in zip((256-q[0],q[1],q[2]),r):self.assertAlmostEqual(g,w,2)
        self.assertIsNone(moving.sweep(next(t3d.actors(hinged(**{'KeyRot(1)':'(Yaw=0)','KeyPos(1)':'(Z=64)'})))))

    def test_away_takes_the_room_to_the_game(self):
        cls,p=self.props(moving.opening(box_door(),{'opens':'away'}))
        room=moving.sweep(next(t3d.actors(box_door())))
        for i in range(moving.ROOM_LINES):
            self.assertEqual(t3d.vec(p['BuiltRoomFrom(%d)'%i]),room['built'][i][0])
            self.assertEqual(t3d.vec(p['MirrorRoomTo(%d)'%i]),room['other'][i][1])
        uc=(ROOT/'project-template'/'src'/'DeusEdix'/'Classes'/'UCDoorMover.uc').read_text(encoding='utf-8')
        self.assertIn('BuiltRoomFrom[%d]'%moving.ROOM_LINES,uc)

    def test_door_room_refuses_what_is_not_a_placed_copy(self):
        for bad in (None,{},{'pid':'p1','prefab':'../x'},{'pid':'p1','prefab':'usr_'+'0'*32+'/..'}):
            with self.assertRaises(ValueError):prefabs.door_room(bad)

    def test_into_compares_the_mirror_image(self):
        cls,p=self.props(moving.opening(box_door(),{'opens':'into','into':[-300,-168,48]}))
        self.assertEqual((t3d.rot(p['KeyRot(1)'])[1],t3d.vec(p['Location'])),(16384,(124,-200,128)))
        self.assertEqual(moving.opening(box_door(),{'opens':'into','into':[400,-168,48]}),box_door())

    def test_description_says_how_it_turns(self):
        d=moving.description(dict(blocks=[dict(mover=True,raw=hinged())]))
        self.assertEqual((d['turn'],d['opens'],d['meets']),(16384,'built','ignore'))

    def test_meets_someone(self):
        # the game's MoverEncroachType, chosen in the Inspector (Discord, 17 Nov 2026); Ignore by default
        self.assertEqual(moving.meeting(hinged(),None),hinged())
        self.assertEqual(moving.meeting(hinged(),{'meets':'ignore'}),hinged())
        for how,enc in [('stop','ME_StopWhenEncroach'),('return','ME_ReturnWhenEncroach'),('crush','ME_CrushWhenEncroach')]:
            self.assertEqual(self.props(moving.meeting(hinged(),{'meets':how}))[1]['MoverEncroachType'],enc)
        lift=hinged(bIsDoor='False')
        self.assertEqual(moving.meeting(lift,{'meets':'crush'}),lift)
        with self.assertRaises(ValueError):moving.apply_settings(hinged(),{'meets':'bounce'})
        self.assertEqual(moving.apply_settings(hinged(),{'meets':'stop'}),hinged())
        # placed through prefabs.place: after placed(), which sets Ignore on every door
        pf=dict(pivot=[32,0,0],blocks=[dict(raw=hinged(),brush=False,mover=True)])
        blocks,_,_=prefabs.place(dict(_prefab=pf,pid='d',offset=[0,0,0],yaw=0,moverSettings={'opens':'away','meets':'return'}))
        cls,p=self.props(blocks[0])
        self.assertEqual((cls,p['MoverEncroachType']),('UCDoorMover','ME_ReturnWhenEncroach'))

    def test_the_builds_take_the_door_class_as_a_mover(self):
        for name in ('scene.py','editor/dxmaps.py'):
            self.assertIn('UCDoorMover',(ROOT/name).read_text(encoding='utf-8'),name)
        uc=ROOT/'project-template'/'src'/'DeusEdix'/'Classes'/'UCDoorMover.uc'
        self.assertIn('class UCDoorMover extends DeusExMover;',uc.read_text(encoding='utf-8'))


if __name__=='__main__':unittest.main()
