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

if __name__=='__main__':unittest.main()
