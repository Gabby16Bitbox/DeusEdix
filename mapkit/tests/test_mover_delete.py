"""No game/user files are changed: generated actors and in-memory command checks."""
import ast
import copy
import importlib.util
import os
import sys
import unittest
from pathlib import Path

STAGE = Path(__file__).resolve().parents[1]
KIT = Path(os.environ.get('DEUSEDIX_TEST_KIT', STAGE))
sys.path[:0] = [str(STAGE / 'editor'), str(STAGE), str(KIT / 'editor'), str(KIT)]

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

scene = module('tested_scene', STAGE / 'scene.py')
motions = module('tested_motions', STAGE / 'editor/motions.py')
props = module('tested_props', STAGE / 'editor/props.py')
import geom

def fixture():
    s = object.__new__(scene.Scene)
    s.actors = []
    s.movers = []
    s.actor_group = {}
    s.groups = {}
    s._group = None
    s.explicit = set()
    s.pieces = {}
    s.actor_note = {}
    s.op_piece = []
    s._n = {}
    s.ops = [('preserved surrounding CSG',)]
    # Unit fixture uses a geometry stub to avoid any texture catalogue/export work.
    class Brush:
        faces = []
    from unittest.mock import patch
    with patch.object(geom.Brush, 't3d', lambda self: '    Begin Brush Name=' + self.name + '\n    End Brush\n'):
        s.mover('DeusExMover', (0,0,0), Brush(), name='DoorA', Tag='Gate')
        s.mover('DeusExMover', (50,0,0), Brush(), name='DoorB', Tag='OtherGate')
    s.actors.append(scene.Scene._block('Light', (0,0,100), 'Lamp', None, '', {}))
    return s

class MoverDeleteTests(unittest.TestCase):
    def test_script_removes_actor_brush_and_prep_only_for_target(self):
        s = fixture()
        remaining = s.actors[1:]
        csg = copy.deepcopy(s.ops)
        edits = {'deleted': {'DoorA': {'cls': 'DeusExMover','orig':[0,0,0]}}}
        before = copy.deepcopy(edits)
        s._apply_actor_edits(edits)
        self.assertEqual(s.actors, remaining)
        self.assertEqual(s.ops, csg)
        self.assertNotIn('UCMdlDoorA', ''.join(s.actors))
        self.assertEqual(s.movers, ['DoorB'])
        self.assertEqual(s._mover_names(), {'DoorB'})
        self.assertIn('UC_MOVER prep DoorB 1 1 1', s.world_commands())
        self.assertNotIn('UC_MOVER prep DoorA 1 1 1', s.world_commands())
        self.assertEqual(edits, before)

    def test_original_position_guard_prevents_wrong_actor_deletion(self):
        s = fixture(); before = copy.deepcopy(s.actors)
        s._apply_actor_edits({'deleted': {'DoorA': {'cls':'DeusExMover', 'orig':[900,0,0]}}})
        self.assertEqual(s.actors, before)
        self.assertIn('DoorA', s.movers)

    def test_same_name_wrong_class_is_not_deleted(self):
        s = fixture(); before = copy.deepcopy(s.actors)
        s._apply_actor_edits({'deleted': {'DoorA': {'cls':'Light', 'orig':[0,0,0]}}})
        self.assertEqual(s.actors, before)
        self.assertIn('DoorA', s.movers)

    def test_old_delete_list_format_and_original_scene_regeneration(self):
        s = fixture(); original = copy.deepcopy(s.actors)
        s._apply_actor_edits({'deleted':['DoorA']})
        self.assertEqual(s.movers, ['DoorB'])
        restored = fixture(); restored._apply_actor_edits({})
        self.assertEqual(restored.actors, original)
        self.assertEqual(restored.movers, ['DoorA','DoorB'])

    def test_deleted_animation_and_properties_do_not_emit_invalid_commands(self):
        motion = {'pos':[{'t':0,'v':[0,0,0]},{'t':1,'v':[0,40,0]}]}
        edits = {'deleted': {'DoorA': {}}, 'props': {'DoorA': {'bLocked':'True'}, 'DoorB': {'bLocked':'False'}},
                 'motions': {'DoorA':copy.deepcopy(motion), 'DoorB':copy.deepcopy(motion)}}
        before = copy.deepcopy(edits)
        for output in (motions.commands(edits, ['DoorA','DoorB']), motions.report(edits,['DoorA','DoorB']), props.commands(edits), props.report(edits)):
            self.assertTrue(output)
            self.assertNotIn('DoorA', '\n'.join(output))
            self.assertIn('DoorB', '\n'.join(output))
        self.assertEqual([a['name'] for a in motions.blocks(edits,['DoorA','DoorB'])], ['UCMotion_DoorB'])
        self.assertEqual(edits,before)
        edits['deleted']={}
        self.assertIn('DoorA','\n'.join(motions.commands(edits,['DoorA','DoorB'])))
        self.assertIn('DoorA','\n'.join(props.commands(edits)))

    def test_imported_original_revision_pipeline_deletes_exact_name_without_csg(self):
        # Run the actual command-generation loop without invoking a build on a user's map.
        tree = ast.parse((KIT / 'editor/dxmaps.py').read_text(encoding='utf-8'))
        build = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='build')
        loop = next(n for n in build.body if isinstance(n,ast.For) and "edits.get('deleted')" in ast.unparse(n.iter))
        ns = {'edits': {'deleted': {'DoorA': {'cls':'DeusExMover'}}}, 'cmds': [], 'lines': [],
              'lights': False, 'nav': False, 'NAV': set(), '_cmdname': lambda n:n,
              '_light': lambda cls: cls in ('Light', 'Spotlight')}        # dxmaps._light without the game's classes
        exec(compile(ast.Module(body=[loop],type_ignores=[]),'dxmaps-delete','exec'), ns)
        self.assertEqual(ns['cmds'], ['UC_DEL DoorA'])
        self.assertFalse(ns['lights']); self.assertFalse(ns['nav'])

if __name__ == '__main__':
    unittest.main()
