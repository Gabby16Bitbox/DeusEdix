import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch, Mock

HERE=Path(__file__).resolve().parent
KIT=HERE.parent
sys.path.insert(0,str(KIT))
def load(name,setting=None):
    spec=importlib.util.spec_from_file_location('tested_'+name,KIT/(name+'.py'))
    m=importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules,{'settings':setting} if setting else {}): spec.loader.exec_module(m)
    return m
class FixTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=HERE);self.root=Path(self.tmp.name)
        self.s=types.SimpleNamespace(PROJECT=self.root,PACKAGE='DXP_probe',ANIMS_PACKAGE='A',MODELS_PACKAGE='M',
            SOUNDS_PACKAGE='S',SCRIPTS_PACKAGE='Scripts',GAME=self.root/'game',GAME_ROOT=self.root/'game/Revision',
            REVISION=self.root/'game/Revision',GAME_SYSTEM=self.root/'game/Revision/System',
            MANAGED_PROJECT=False,STANDALONE=True)
        self.w=load('workspace',self.s)
    def tearDown(self): self.tmp.cleanup()
    def test_absolute_asset_paths_and_private_system_priority(self):
        text='[Core.System]\nPaths=..\\Textures\\*.utx\nPaths=..\\System\\*.u\nPaths=..\\..\\Sounds\\*.uax\nPaths=..\\Maps\\*.dx\n'
        ini=self.w._ini(text)
        self.assertNotIn('Paths=..',ini)
        self.assertIn(str(self.s.GAME_ROOT/'Textures'/'*.utx'),ini)
        self.assertIn(str(self.w.SYS)+'\\*.u',ini)
        self.assertIn(str(self.s.GAME/'Sounds'/'*.uax'),ini)
    def test_old_workspace_stamp_cannot_skip_migration(self):
        self.assertEqual(self.w.VERSION,3)
        self.w.SYS.mkdir(parents=True)
        (self.w.SYS/'DeusEx.ini').write_text('')
        self.w.STAMP.write_text(json.dumps({'version':1}))
        with patch.object(self.w,'_stamp',return_value={'version':2}): self.assertFalse(self.w.ready())
    def test_missing_dependency_fails_once_without_sleep(self):
        result=types.SimpleNamespace(returncode=1,stdout="Failed to load 'RevDataVaultImages': Can't find file for package 'RevDataVaultImages'",stderr='')
        self.w.SYS.mkdir(parents=True);self.w.HOST=self.root/'host.exe';self.w.HOST.write_bytes(b'host')
        with patch.object(self.w,'ensure',return_value=True),patch.object(self.w,'runtime_fingerprint',return_value='abc'),\
                patch.object(self.w.subprocess,'run',return_value=result) as run,patch.object(self.w.time,'sleep') as sleep:
            ok,lines=self.w.build(log=lambda *a:None)
        self.assertFalse(ok);self.assertEqual(run.call_count,1);sleep.assert_not_called()
        self.assertEqual(len(lines),2);self.assertIn('RevDataVaultImages',lines[0]);self.assertIn('Compiler log:',lines[1])
    def test_transient_failure_still_retries(self):
        self.w.SYS.mkdir(parents=True);self.w.HOST=self.root/'host.exe';self.w.HOST.write_bytes(b'host')
        with patch.object(self.w,'ensure',return_value=True),patch.object(self.w,'runtime_fingerprint',return_value='abc'),\
                patch.object(self.w.subprocess,'run',return_value=types.SimpleNamespace(returncode=7,stdout='fault',stderr='')) as run,\
                patch.object(self.w.time,'sleep') as sleep:
            self.w.build(log=lambda *a:None)
        self.assertEqual(run.call_count,3);self.assertEqual(sleep.call_count,2)
    def fixture(self):
        p=load('projects');folder=self.root/'kit/editor/static/audio/doctor';folder.mkdir(parents=True)
        name='hale_'+'a'*20
        old=folder/(name+'.wav');old.write_bytes(b'old approved wav')
        (folder/(name+'.mp3')).write_bytes(b'new mp3')
        retired=dict(version=1,files={old.name:p._hash(old.read_bytes())})
        (folder/'obsolete-wavs.json').write_text(json.dumps(retired))
        (folder/'manifest.json').write_text(json.dumps(dict(version=1,voice='EliasHale',clips=[dict(url='/static/audio/doctor/'+name+'.mp3')])))
        return p,folder,old
    def test_only_exact_obsolete_web_wav_removed(self):
        p,folder,old=self.fixture();custom=folder/'my.wav';custom.write_bytes(b'custom')
        self.assertTrue(p._compact_doctor_audio(self.root/'kit'))
        self.assertFalse(old.exists());self.assertEqual(custom.read_bytes(),b'custom')
    def test_modified_wav_preserved(self):
        p,folder,old=self.fixture();old.write_bytes(b'user edit')
        self.assertTrue(p._compact_doctor_audio(self.root/'kit'));self.assertEqual(old.read_bytes(),b'user edit')
    def test_missing_mp3_preserves_old_audio(self):
        p,folder,old=self.fixture();next(folder.glob('*.mp3')).unlink()
        self.assertEqual(p._compact_doctor_audio(self.root/'kit'),{});self.assertTrue(old.exists())
    def test_traversal_metadata_preserves_audio(self):
        p,folder,old=self.fixture();(folder/'obsolete-wavs.json').write_text(json.dumps(dict(version=1,files={'../../outside.wav':'a'*64})))
        self.assertEqual(p._compact_doctor_audio(self.root/'kit'),{});self.assertTrue(old.exists())

if __name__=='__main__': unittest.main(verbosity=2)
