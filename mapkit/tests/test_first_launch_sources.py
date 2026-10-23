import importlib.util
import ast
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
KIT=HERE.parent
sys.path.insert(0,str(KIT))
class CompilerSourcesTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=HERE);self.root=Path(self.tmp.name)
        s=types.SimpleNamespace(PROJECT=self.root,PACKAGE='DXP_demo',ANIMS_PACKAGE='A',MODELS_PACKAGE='M',SOUNDS_PACKAGE='S',SCRIPTS_PACKAGE='Scripts',STANDALONE=True)
        spec=importlib.util.spec_from_file_location('tested_workspace',KIT/'workspace.py')
        self.w=importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules,{'settings':s}):spec.loader.exec_module(self.w)
        self.w.SRC.mkdir(parents=True);(self.w.SRC/'Classes').mkdir()
        (self.w.SRC/'Classes/Demo.uc').write_text('class Demo extends Actor;')
        (self.w.SRC/'Sounds').mkdir();(self.w.SRC/'Sounds/own.wav').write_bytes(b'own generated sound')
        self.target=self.w.DEV/'DXP_demo'
    def tearDown(self):self.tmp.cleanup()
    def test_snapshot_is_physical_and_source_read_only(self):
        before={p.relative_to(self.w.SRC):p.read_bytes() for p in self.w.SRC.rglob('*') if p.is_file()}
        self.w._compiler_sources()
        self.assertFalse(getattr(self.target.lstat(),'st_file_attributes',0)&1024)
        for path,data in before.items():
            self.assertEqual((self.target/path).read_bytes(),data);self.assertEqual((self.w.SRC/path).read_bytes(),data)
    def test_source_updates_and_owned_removals_are_synchronized(self):
        self.w._compiler_sources();(self.w.SRC/'Sounds/own.wav').unlink()
        (self.w.SRC/'Classes/Demo.uc').write_text('class Demo extends Object;')
        self.w._compiler_sources()
        self.assertFalse((self.target/'Sounds/own.wav').exists())
        self.assertEqual((self.target/'Classes/Demo.uc').read_text(),'class Demo extends Object;')
    def test_modified_snapshot_is_not_overwritten(self):
        self.w._compiler_sources();(self.target/'Classes/Demo.uc').write_text('unexpected edit')
        with self.assertRaisesRegex(ValueError,'modified compiler'):self.w._compiler_sources()
        self.assertEqual((self.target/'Classes/Demo.uc').read_text(),'unexpected edit')
    def test_unrecognized_physical_directory_is_preserved(self):
        self.target.mkdir(parents=True);(self.target/'user.txt').write_text('keep')
        with self.assertRaisesRegex(ValueError,'unrecognized compiler'):self.w._compiler_sources()
        self.assertEqual((self.target/'user.txt').read_text(),'keep')
    def test_traversal_snapshot_manifest_is_rejected(self):
        self.w._compiler_sources();marker=self.target/'.deusedix-compiler-sources.json'
        data=json.loads(marker.read_text());data['files']['../../outside.txt']='a'*64;marker.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError,'Invalid compiler'):self.w._compiler_sources()
    def test_interrupted_copy_can_resume_when_new_bytes_match_source(self):
        self.w._compiler_sources();text='class Demo extends Object;'
        (self.w.SRC/'Classes/Demo.uc').write_text(text);(self.target/'Classes/Demo.uc').write_text(text)
        self.w._compiler_sources()
        self.assertEqual((self.target/'Classes/Demo.uc').read_text(),text)
    def test_editor_does_not_launch_whole_game_texture_scan_at_startup(self):
        source=(KIT/'editor/static/app.js').read_text(encoding='utf-8')
        self.assertNotIn("api('/api/texflags')",source)
        self.assertNotIn('await texFlagsReady',source)
        self.assertIn('texFlags = g.texflags || {}',source)
    def test_geometry_keeps_map_texture_flags_for_transparency(self):
        source=(KIT/'editor/data.py').read_text(encoding='utf-8')
        tree=ast.parse(source)
        node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_assemble')
        module=ast.Module(body=[node],type_ignores=[])
        namespace=dict(json=json,OUT=self.root,structures=lambda name:{},PF={})
        exec(compile(module,'_assemble','exec'),namespace)
        folder=self.root/'geometry';folder.mkdir()
        for name,content in [('polys',[]),('textures',{}),('brushes',[]),('texflags',{'Package.Leaves':2,'Package.Glass':4})]:
            (folder/(name+'.json')).write_text(json.dumps(content))
        namespace['_assemble']('TestMap',folder)
        result=json.loads((folder/'geometry.json').read_text())
        self.assertEqual(result['texflags'],{'Package.Leaves':2,'Package.Glass':4})

if __name__=='__main__':unittest.main(verbosity=1)
