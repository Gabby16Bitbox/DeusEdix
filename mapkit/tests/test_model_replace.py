"""Read-only source extraction; no engine/cache writes."""
import ast
from pathlib import Path
import re
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]

class ReplacementTests(unittest.TestCase):
    def test_startup_appearance_targets_exact_actor_without_changing_gameplay(self):
        tree=ast.parse((ROOT/'editor/anims.py').read_text(encoding='utf-8'))
        node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='appearance_blocks')
        scope={'re':re};exec(compile(ast.Module(body=[node],type_ignores=[]),'appearance','exec'),scope)
        edits={'props':{'Computer1':{'Mesh':"LodMesh'DeusExDeco.Barrel1'",'Skin':'None','MultiSkins(0)':'None','Tag':'SharedDoor','CollisionRadius':12},
                        'Deleted':{'Mesh':"LodMesh'DeusExDeco.Barrel1'",'Skin':'None'}},'deleted':{'Deleted':{}}}
        blocks=scope['appearance_blocks'](edits)
        self.assertEqual(len(blocks),1)
        self.assertEqual(blocks[0]['props']['PawnName'],'Computer1')
        self.assertEqual(blocks[0]['props']['AppearanceMesh'],edits['props']['Computer1']['Mesh'])
        self.assertNotIn('Tag',blocks[0]['props']);self.assertNotIn('CollisionRadius',blocks[0]['props'])
        self.assertEqual(scope['appearance_blocks']({'props':{'A':{'Mesh':'not a mesh','Skin':'None'}}}),[])
    def test_visual_properties_survive_backend_whitelist(self):
        tree = ast.parse((ROOT/'editor/props.py').read_text(encoding='utf-8'))
        nodes = [n for n in tree.body if (isinstance(n,ast.FunctionDef) and n.name in ('base','commands','raw_commands','t3d_props')) or
                 (isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('FIELDS','MOVEMENT','NAMES','RAW_KEY') for t in n.targets))]   # NAMES is made of FIELDS and MOVEMENT
        scope={'re':re};exec(compile(ast.Module(body=nodes,type_ignores=[]),'props','exec'),scope)
        props={'Mesh':"LodMesh'DeusExDeco.Barrel1'",'Skin':'None',**{f'MultiSkins({i})':'None' for i in range(8)}}
        cmds=scope['commands']({'props':{'Computer1':props}})
        self.assertEqual(len(cmds),10)
        self.assertEqual(scope['t3d_props'](props),props)
        self.assertEqual(scope['commands']({'props':{'Computer1':props},'deleted':{'Computer1':{}}}),[])
        self.assertFalse(any('Collision' in c or 'PrePivot' in c or 'DrawScale' in c for c in cmds))

    def test_script_map_loads_packages_for_existing_actor_overrides(self):
        tree=ast.parse((ROOT/'scene.py').read_text(encoding='utf-8'))
        node=next(n for n in ast.walk(tree) if isinstance(n,ast.If) and
                  any(isinstance(x,ast.Attribute) and x.attr=='model_edits' for x in ast.walk(ast.Module(body=n.body,type_ignores=[]))) and
                  'changes' in ast.unparse(n.test))
        expression=compile(ast.Expression(node.test),'condition','eval')
        for changes in ({'props':{'Existing':{'Mesh':"LodMesh'Other.Mesh'"}}},
                        {'added':[{'cls':'ComputerSecurity','props':{'Mesh':"LodMesh'Other.Mesh'"}}]},
                        {'added':[{'cls':'UCMeshDeco'}]}):
            self.assertTrue(eval(expression,{'changes':changes}))
        self.assertFalse(eval(expression,{'changes':{'props':{'Existing':{'Tag':'StillSame'}}}}))

if __name__=='__main__':unittest.main()
