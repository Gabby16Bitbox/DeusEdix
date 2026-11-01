"""Imports stay in the project; malformed packages and existing names never damage data."""
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT), str(KIT.parent)]
import mapfiles


class MapFilesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = KIT / 'out' / '00_DeusEdix_Tutorial.dx'
        if not source.exists():
            source = next(mapfiles.dxmaps.GAME_MAPS.glob('*.dx'), None)
        if source is None:
            raise unittest.SkipTest('A local Deus Ex map is required for the package round-trip.')
        cls.raw = source.read_bytes()
        cls.original = source
        cls.digest = hashlib.sha256(cls.raw).digest()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='deusedix-import-test-')
        self.root = Path(self.temp.name)
        for sub in ('project/maps','game/Maps','kit/maps','kit/out'):
            (self.root / sub).mkdir(parents=True)
        self.patches = [patch.object(mapfiles.dxmaps,'MOD_MAPS', self.root/'project/maps'),
                        patch.object(mapfiles.dxmaps,'GAME_MAPS', self.root/'game/Maps'),
                        patch.object(mapfiles.dxmaps,'KIT', self.root/'kit'),
                        patch.object(mapfiles.dxmaps,'OUT', self.root/'kit/out'),
                        patch.object(mapfiles.settings,'GAME', self.root/'game')]
        for p in self.patches: p.start()

    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()

    def test_valid_copy_and_collision(self):
        result = mapfiles.import_map('LocalTest.dx', self.raw)
        self.assertEqual(result['script'],'dx:LocalTest')
        self.assertEqual((self.root/'project/maps/LocalTest.dx').read_bytes(),self.raw)
        with self.assertRaises(FileExistsError): mapfiles.import_map('localtest.dx',self.raw)
        self.assertEqual(hashlib.sha256(self.original.read_bytes()).digest(),self.digest)
        self.assertEqual(list((self.root/'game/Maps').iterdir()),[])
        self.assertEqual(len(list((self.root/'project/maps').iterdir())),1)

    def test_existing_original_script_and_edits_are_reserved(self):
        (self.root/'game/Maps/Original.dx').write_bytes(b'original')
        (self.root/'kit/maps/test.py').write_text("MAP = 'ScriptMap'\n")
        (self.root/'kit/maps/Edited.edits.json').write_text('{}')
        for name in ('original','ScriptMap','Edited'):
            with self.assertRaises(FileExistsError): mapfiles.import_map(name+'.dx',self.raw)

    def test_unsafe_names_and_bad_packages_leave_no_files(self):
        for name in ('../escape.dx',r'..\escape.dx','C:\\map.dx','CON.dx','a.u','a.dx:stream','name .dx'):
            with self.assertRaises(ValueError): mapfiles.import_map(name,self.raw)
        for raw in (b'not a map',bytes(100),self.raw[:100]):
            with self.assertRaises(ValueError): mapfiles.import_map('Invalid.dx',raw)
        self.assertEqual(list((self.root/'project/maps').iterdir()),[])

    def test_game_folder_is_never_an_import_destination(self):
        with patch.object(mapfiles.dxmaps,'MOD_MAPS',self.root/'game/Maps'):
            with self.assertRaises(ValueError): mapfiles.import_map('Nope.dx',self.raw)

    def test_empty_catalog_and_badges(self):
        self.assertEqual(mapfiles.describe([]),[])
        (self.root/'kit/maps/unbuilt.edits.json').write_text('{"added": [{"name": "Box"}]}')
        entry = mapfiles.describe([dict(script='unbuilt',map='01_NewRoom',kind='script',built=False)])[0]
        self.assertTrue(entry['changed'])
        self.assertEqual(entry['mission'],1)
        self.assertEqual(entry['label'],'New Room')


if __name__ == '__main__': unittest.main()
