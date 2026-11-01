import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch, Mock, call

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
        native=self.root/'bin';native.mkdir()
        self.w.NATIVE=tuple(native/n for n in ('DeusEdixNav.u','DeusEdixNav.dll'))
        for f in self.w.NATIVE: f.write_bytes(b'native')
    def tearDown(self):
        # Windows ends a delete only when whatever still has the file open (an indexer, the antivirus looking at a new
        # .exe/.dll) lets go: rmdir can find the folder "not empty" for a moment (the tmp* folders it left in tests\)
        for wait in (0.05,0.2,0.5,1,2):
            try: return self.tmp.cleanup()
            except OSError: time.sleep(wait)
        self.tmp.cleanup()
    def test_absolute_asset_paths_and_private_system_priority(self):
        text='[Core.System]\nPaths=..\\Textures\\*.utx\nPaths=..\\System\\*.u\nPaths=..\\..\\Sounds\\*.uax\nPaths=..\\Maps\\*.dx\n'
        ini=self.w._ini(text)
        self.assertNotIn('Paths=..',ini)
        self.assertIn(str(self.s.GAME_ROOT/'Textures'/'*.utx'),ini)
        self.assertIn(str(self.w.SYS)+'\\*.u',ini)
        self.assertIn(str(self.s.GAME/'Sounds'/'*.uax'),ini)
    def test_old_workspace_stamp_cannot_skip_migration(self):
        self.assertEqual(self.w.VERSION,4)
        self.w.SYS.mkdir(parents=True)
        (self.w.SYS/'DeusEx.ini').write_text('')
        self.w.STAMP.write_text(json.dumps({'version':1}))
        with patch.object(self.w,'_stamp',return_value={'version':2}): self.assertFalse(self.w.ready())
    def compile(self,result):
        """build() with a clock, compiler and host copy of its own module (self.w): patching time.sleep and subprocess.run
        themselves also counted every other thread of the suite, and with the 5 s pause mocked away the host.exe of
        each attempt was deleted and made again within a millisecond, too soon for Windows (see tearDown)"""
        self.w.SYS.mkdir(parents=True);self.w.HOST=self.root/'host.exe'
        sleep,run,copy=Mock(),Mock(return_value=result),Mock()
        own=dict(time=types.SimpleNamespace(sleep=sleep,time=time.time,strftime=time.strftime),atomicfile=types.SimpleNamespace(copy_file=copy),
                 subprocess=types.SimpleNamespace(run=run,DEVNULL=subprocess.DEVNULL,CREATE_NO_WINDOW=getattr(subprocess,'CREATE_NO_WINDOW',0)))
        with patch.object(self.w,'ensure',return_value=True),patch.object(self.w,'runtime_fingerprint',return_value='abc'),\
                patch.multiple(self.w,**own):
            ok,lines=self.w.build(log=lambda *a:None)
        return ok,lines,run,sleep,copy
    def test_missing_dependency_fails_once_without_sleep(self):
        ok,lines,run,sleep,copy=self.compile(types.SimpleNamespace(returncode=1,stdout="Failed to load 'RevDataVaultImages': Can't find file for package 'RevDataVaultImages'",stderr=''))
        self.assertFalse(ok);self.assertEqual(run.call_count,1);sleep.assert_not_called()
        self.assertEqual(len(lines),2);self.assertIn('RevDataVaultImages',lines[0]);self.assertIn('Compiler log:',lines[1])
    def test_transient_failure_still_retries(self):
        ok,lines,run,sleep,copy=self.compile(types.SimpleNamespace(returncode=7,stdout='fault',stderr=''))
        self.assertFalse(ok);self.assertEqual(run.call_count,3);self.assertEqual(sleep.call_args_list,[call(5)]*2)   # two pauses of 5 s between the 3 attempts
        self.assertEqual(copy.call_args_list,[call(self.w.HOST,self.w.SYS/'host.exe')]*3)   # the host copied again for every attempt
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
