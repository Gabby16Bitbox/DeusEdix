"""Native map-copy/import checks. Run with DEUSEDIX_NATIVE_TESTS=1 and a prepared local engine."""
import hashlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT), str(KIT.parent)]
import dxmaps
import kit
import mapfiles
import maplinks
import newmap
import settings
import ue1pkg


SOURCE = '''Begin Map
Begin Actor Class=DeusExLevelInfo Name=ProjectLevelInfo
MapName="01_Source"
missionNumber=1
Script=Class'RevisionMission.RevisionMission01'
ConversationPackage="RevisionConversations"
End Actor
Begin Actor Class=PlayerStart Name=ProjectStart
End Actor
Begin Actor Class=Teleporter Name=LocalTag
URL="InsideDoor"
End Actor
Begin Actor Class=Teleporter Name=InsideDoor
Tag=InsideDoor
End Actor
Begin Actor Class=Teleporter Name=LocalHash
URL="#InsideDoor"
End Actor
Begin Actor Class=Teleporter Name=SelfMap
URL="01_Source#InsideDoor"
End Actor
Begin Actor Class=Teleporter Name=ExternalMap
URL="01_Original#Start"
End Actor
Begin Actor Class=Teleporter Name=KnownMap
URL="02_Existing#Start"
End Actor
Begin Actor Class=MapExit Name=ExternalExit
DestMap="01_Original"
End Actor
Begin Actor Class=MapExit Name=KnownExit
DestMap="02_Existing"
End Actor
End Map
'''


@unittest.skipUnless(os.environ.get('DEUSEDIX_NATIVE_TESTS') == '1', 'requires the local native map engine')
class NativeProjectCopyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        session = kit.Session([], 'project-copy-fixture')
        try:
            (session.folder / 'Input/source.t3d').write_text(SOURCE, encoding='latin1')
            session.batch(['MAP NEW', 'OBJ LOAD FILE="RevisionMission.u"',
                           r'MAP IMPORT FILE="..\Input\source.t3d"',
                           r'MAP SAVE FILE="..\Output\01_Source.dx"'])
            cls.raw = (session.folder / 'Output/01_Source.dx').read_bytes()
            no_info = SOURCE[SOURCE.index('Begin Actor Class=PlayerStart'):]
            (session.folder / 'Input/noinfo.t3d').write_text('Begin Map\n' + no_info, encoding='latin1')
            session.batch(['MAP NEW', r'MAP IMPORT FILE="..\Input\noinfo.t3d"',
                           r'MAP SAVE FILE="..\Output\01_NoInfo.dx"'])
            cls.no_info_raw = (session.folder / 'Output/01_NoInfo.dx').read_bytes()
        finally:
            session.close()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='.native-project-', dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.maps, self.originals, self.data = self.root / 'maps', self.root / 'game/Maps', self.root / 'kit'
        for path in (self.maps, self.originals, self.data / 'maps', self.data / 'out'):
            path.mkdir(parents=True)
        self.source = self.originals / '01_Source.dx'
        self.source.write_bytes(self.raw)
        (self.maps / '02_Existing.dx').write_bytes(b'project map inventory fixture')
        self.source_hash = hashlib.sha256(self.source.read_bytes()).hexdigest()
        native_execute = kit.execute
        patches = [patch.object(settings, 'PROJECT_KIND', 'custom', create=True),
                   patch.object(settings, 'GAME', self.root / 'game'),
                   patch.object(dxmaps, 'MOD_MAPS', self.maps), patch.object(dxmaps, 'GAME_MAPS', self.originals),
                   patch.object(dxmaps, 'KIT', self.data), patch.object(dxmaps, 'OUT', self.data / 'out'),
                   patch.object(maplinks.data, 'OUT', self.data / 'out'),
                   patch.object(kit, 'execute', side_effect=lambda *a, **kw: native_execute(*a, **dict(kw, echo=False)))]
        for pending in patches:
            pending.start()
            self.addCleanup(pending.stop)

    def properties(self, path):
        package = ue1pkg.Pkg(str(path))
        return {entry['name']: {name: package.pval(value) for name, _type, _array, value in package.props(i + 1)}
                for i, entry in enumerate(package.exports)
                if package.classname(entry) in ('DeusExLevelInfo', 'Teleporter', 'MapExit')}

    def assert_detached(self, path, name):
        data = self.properties(path)
        info = data['ProjectLevelInfo']
        self.assertIn(info.get('Script'), (None, 'None', ''))
        self.assertEqual(info['ConversationPackage'], 'None')
        self.assertEqual(info['MapName'], name)
        self.assertEqual(data['LocalTag']['URL'], 'InsideDoor')
        self.assertEqual(data['LocalHash']['URL'], '#InsideDoor')
        self.assertEqual(data['SelfMap']['URL'], name + '#InsideDoor')
        self.assertFalse(data['ExternalMap'].get('URL'))
        self.assertFalse(data['ExternalExit'].get('DestMap'))
        self.assertEqual(data['KnownMap']['URL'], '02_Existing#Start')
        self.assertEqual(data['KnownExit']['DestMap'], '02_Existing')
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), self.source_hash)

    def test_custom_copy_removes_original_hooks_and_external_links_only(self):
        script, name = newmap.create_copy('Independent', 4, '01_Source')
        self.assertEqual(script, 'dx:04_Independent')
        self.assert_detached(self.maps / (name + '.dx'), name)
        self.assertEqual(self.properties(self.maps / (name + '.dx'))['ProjectLevelInfo']['missionNumber'], 4)

    def test_import_uses_private_native_copy_and_allows_same_original_filename(self):
        result = mapfiles.import_map('01_Source.dx', self.raw)
        self.assertEqual(result['map'], '01_Source')
        self.assert_detached(self.maps / '01_Source.dx', '01_Source')
        self.assertEqual(list(self.maps.glob('*.import')), [])

    def test_import_without_level_info_gets_explicit_independent_defaults(self):
        mapfiles.import_map('01_NoInfo.dx', self.no_info_raw)
        info = self.properties(self.maps / '01_NoInfo.dx')['DeusEdixLevelInfo']
        self.assertEqual(info['MapName'], '01_NoInfo')
        self.assertEqual(info['ConversationPackage'], 'None')
        self.assertIn(info.get('Script'), (None, 'None', ''))

    def test_original_project_copy_preserves_original_hooks_and_exits(self):
        with patch.object(settings, 'PROJECT_KIND', 'original'):
            _, name = newmap.create_copy('OriginalCopy', 3, '01_Source')
        data = self.properties(self.maps / (name + '.dx'))
        self.assertTrue(str(data['ProjectLevelInfo']['Script']).endswith('RevisionMission03'))
        self.assertEqual(data['ProjectLevelInfo']['ConversationPackage'], 'RevisionConversations')
        self.assertEqual(data['ExternalMap']['URL'], '01_Original#Start')
        self.assertEqual(data['ExternalExit']['DestMap'], '01_Original')
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), self.source_hash)


if __name__ == '__main__':
    unittest.main()
