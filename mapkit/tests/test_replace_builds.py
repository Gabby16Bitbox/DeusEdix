"""Real engine regression of Replace with...: objects of a generated room given another class under their own names,
built as a script map and as an original .dx (UC_DEL, then the import under the same name). Only a temporary folder
under tests/; no game map is installed or changed."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import dxmaps
import geom
import t3d
from scene import Scene

EDITS = {'added': [
    {'name': 'FixtureGuard', 'cls': 'UNATCOTroop', 'loc': [-100, 0, 0], 'rot': [0, 16384, 0],
     'props': {'Tag': 'Guards', 'Health': '67'}, 'replaces': {'cls': 'MJ12Troop', 'orig': [-100, 0, 0]}},
    {'name': 'FixtureCrate', 'cls': 'Barrel1', 'loc': [60, 0, -40], 'rot': [0, 0, 0],
     'props': {'Tag': 'Box'}, 'replaces': {'cls': 'CrateUnbreakableSmall', 'orig': [60, 0, -48]}}],
    'props': {'FixtureGuard': {'Health': '55'}}}         # set after the import: it reaches the new object


@unittest.skipUnless(dxmaps.kit.HOST.exists(), 'the map host is not built (mapkit/host/build_host.ps1)')
class ReplaceBuildTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='replace-engine-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        Image.new('P', (16, 16), 128).save(self.root / 'gray.pcx')
        self.editfile = self.root / 'fixture.edits.json'
        self.editfile.write_text(json.dumps(EDITS))

    def scene(self):
        s = Scene('ReplaceFixture', packages=['CoreTexMetal'])
        s.texture(self.root / 'gray.pcx', 'ReplaceGray')
        s.auto_groups = False
        s.sub(geom.box((-256, -256, -64), (256, 256, 256), 'ReplaceGray'))
        s.actor('MJ12Troop', (-100, 0, 0), name='FixtureGuard', Tag='Guards', Health='67')
        s.actor('CrateUnbreakableSmall', (60, 0, -48), name='FixtureCrate', Tag='Box')
        s.actor('Light', (0, 0, 160), name='FixtureLight', LightBrightness='128', LightRadius='8')
        s.actor('PlayerStart', (120, 120, 0), name='FixtureStart')
        return s

    def assertReplaced(self, t3d_file):
        found = list(t3d.actors(Path(t3d_file).read_text(encoding='latin1')))
        named = lambda n: [a for a in found if a['name'] == n]
        self.assertEqual([a['cls'] for a in named('FixtureGuard')], ['UNATCOTroop'])
        self.assertEqual([a['cls'] for a in named('FixtureCrate')], ['Barrel1'])
        self.assertFalse([a for a in found if a['cls'] in ('MJ12Troop', 'CrateUnbreakableSmall')])
        guard = named('FixtureGuard')[0]['props']
        self.assertEqual((guard.get('Tag'), guard.get('Health')), ('Guards', '55'))

    def test_script_map_and_original_dx(self):
        scripted = self.root / 'scripted.dx'
        self.scene().build(scripted, paths=False, edits=self.editfile)
        self.assertReplaced(scripted.with_suffix('.t3d'))
        self.scene().build(self.root / 'ReplaceFixture.dx', paths=False)
        out = self.root / 'out'
        out.mkdir()
        with patch.object(dxmaps, 'MOD_MAPS', self.root), patch.object(dxmaps, 'OUT', out), \
                patch.object(dxmaps, 'edits_path', lambda _: self.editfile):
            ok, lines = dxmaps.build('ReplaceFixture')
        self.assertTrue(ok, lines)
        self.assertIn('  EDIT replaced FixtureGuard (MJ12Troop)', lines)
        self.assertReplaced(out / 'ReplaceFixture.t3d')


if __name__ == '__main__':
    unittest.main()
