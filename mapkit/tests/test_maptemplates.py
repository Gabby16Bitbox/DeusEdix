"""Map templates (editor/maptemplates.py): what a template keeps of a map and what it leaves out, a New map room
read back from its script, saving, listing, deleting, and new maps made from one (a room built now, a map file
copied), leaving nothing behind when that fails."""
import base64
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT), str(KIT.parent)]
import dxmaps
import maplinks
import maptemplates
import newmap
import settings
import textures

JPEG = 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8\xff\xe0 a picture').decode()
PEOPLE = {'MJ12Troop', 'UCCustomSoldier'}


def is_a(cls, *bases, log=None):
    return (cls.split('.')[-1] in PEOPLE) if 'ScriptedPawn' in bases else None


def map_edits():
    """A map's edits with a bit of everything: the place, a character with what is his, the story and its logic."""
    return {
        'moved': {'Light3': {'cls': 'Light', 'loc': [0, 0, 300]}}, 'deleted': {'Light1': {'cls': 'Light'}},
        'added': [
            {'name': 'UCEdit0', 'cls': 'CrateUnbreakableSmall', 'loc': [0, 0, 20], 'props': {'BindName': '"Crate"', 'Tag': 'Box'}, 'bind': 'Crate'},
            {'name': 'UCEdit1', 'cls': 'MJ12Troop', 'loc': [64, 0, 40], 'props': {'BindName': '"Guard"'}},
            {'name': 'UCEdit2', 'cls': 'UCCustomSoldier', 'kind': 'pawn', 'loc': [64, 64, 40], 'bind': 'UCEd_UCEdit2'},
            {'name': 'UCEdit3', 'cls': 'Teleporter', 'loc': [0, 400, 40], 'props': {'URL': '"01_Old#Back"'}},
            {'name': 'UCEdit4', 'cls': 'DeusEdix.UCCutscene', 'loc': [0, 0, 100]},
            {'name': 'UCEdit5', 'cls': 'PlayerStart', 'kind': 'pawn', 'loc': [0, -200, 40]},
            {'name': 'UCEdit6', 'cls': 'Teleporter', 'loc': [0, 500, 40], 'props': {'URL': '"02_Other#Start"'}},
        ],
        'boxes': [{'name': 'UCEditBox0', 'lo': [0, 0, 0], 'hi': [64, 64, 64]}], 'drawn': [{'kind': 'wall'}],
        'groups': {'room': {'offset': [0, 0, 8]}}, 'copies': [], 'prefabs': [{'pid': 'p1'}],
        'props': {'UCEdit1': {'Orders': 'Patrolling'}, 'UCEdit0': {'BindName': '"Crate"', 'bPushable': 'False'}},
        'rawprops': {'UCEdit2': {'Health': '50'}, 'UCEdit0': {'Mass': '30'}},
        'anims': {'UCEdit1': {'idle': 'Sit'}}, 'motions': {'UCEditBox0': {'pos': []}},
        'disabled': {'UCEdit2': True},
        'nests': [{'id': 'n1', 'label': 'Guards', 'items': ['a:UCEdit1', 'a:UCEdit0', 's:room']}],
        'order': ['a:UCEdit2', 'b:UCEditBox0'],
        'retexture': [{'kind': 'actor', 'name': 'UCEdit1', 'slot': 0, 'tex': 'T1'}, {'kind': 'map', 'old': 'A', 'tex': 'T2'}],
        'textures': {'UCT_Wall_1': {'pcx': '01_Old/UCT_Wall_1.pcx', 'png': '01_Old/UCT_Wall_1.png', 'w': 64, 'h': 64}},
        'level': {'music': {'AmbientOggFile': 'x.ogg'}, 'sky': 'hk', 'info': {'MissionLocation': 'Old place',
                  'startupMessage': ['Old', '', '', ''], 'MapAuthor': 'Gabby'}},
        'links': [{'id': 'L1', 'src': 'UCEdit0'}], 'usable': {'UCEdit0': {}}, 'objectTags': {'UCEdit0': {'mode': 'auto'}},
        'cutscenes': {'UCEdit4': {'keys': []}}, 'texts': {'C': {}}, 'documents': {'D': {'text': 'x'}},
        'behave': {'UCEdit1': {}}, 'fxpreview': {'P': {}}, 'navmesh': {'key': '01_Old|1|5', 'polys': []},
        'player_move': {'air': 0.3}, 'paths': False, 'surfaces': [], 'unnest': [], 'defaultFolder': 'n1',
        'someFutureField': {'x': 1},
    }


class PlaceTest(unittest.TestCase):
    def setUp(self):
        stub = patch.object(maptemplates.props, 'is_a', side_effect=is_a)
        stub.start()
        self.addCleanup(stub.stop)

    def test_the_place_is_kept_the_story_and_logic_are_not(self):
        source = map_edits()
        kept = maptemplates.place_of(source)
        self.assertEqual(source, map_edits())                    # the map's own edits are left as they are
        self.assertEqual([a['name'] for a in kept['added']], ['UCEdit0', 'UCEdit3', 'UCEdit5', 'UCEdit6'])
        for field in maptemplates.DROP:
            self.assertNotIn(field, kept)
        self.assertNotIn('someFutureField', kept)               # a field in neither list is left out
        for field in ('boxes', 'drawn', 'groups', 'prefabs', 'moved', 'deleted', 'player_move', 'paths', 'surfaces', 'defaultFolder'):
            self.assertEqual(kept[field], source[field], field)
        # what was the characters' goes with them
        self.assertEqual(kept['props'], {'UCEdit0': {'bPushable': 'False'}})
        self.assertEqual(kept['rawprops'], {'UCEdit0': {'Mass': '30'}})
        self.assertEqual(kept['anims'], {})
        self.assertEqual(kept['disabled'], {})
        self.assertEqual(kept['motions'], source['motions'])
        self.assertEqual(kept['nests'][0]['items'], ['a:UCEdit0', 's:room'])
        self.assertEqual(kept['order'], ['b:UCEditBox0'])
        self.assertEqual(kept['retexture'], [{'kind': 'map', 'old': 'A', 'tex': 'T2'}])
        # the Story's name of an object, and the old place's own words
        self.assertEqual(kept['added'][0]['props'], {'Tag': 'Box'})
        self.assertNotIn('bind', kept['added'][0])
        self.assertEqual(kept['level']['info'], {'MapAuthor': 'Gabby'})
        self.assertEqual(kept['level']['sky'], 'hk')
        self.assertEqual(kept['textures'], source['textures'])

    def test_computers_lose_their_texts_with_what_points_at_them(self):
        source = {
            'added': [{'name': 'UCEdit9', 'cls': 'ComputerPublic', 'loc': [0, 0, 40],
                       'props': {'bulletinTag': 'UCBulletins_01_Old_UCEdit9', 'Tag': 'Terminal'}}],
            'props': {'ComputerPersonal0': {'TextPackage': 'UCMaps', 'Tag': 'Desk'},
                      'UCEdit9': {'TextPackage': 'UCMaps', 'bulletinTag': 'UCBulletins_01_Old_UCEdit9'},
                      'ComputerPersonal1': {'TextPackage': 'TheirPackage'}},
            'texts': {'ComputerPersonal0': {'emails': [{'subject': 'Hi'}], 'bulletins': []},
                      'UCEdit9': {'emails': [], 'bulletins': [{'text': 'News'}]}},
        }
        kept = maptemplates.place_of(source)
        self.assertNotIn('texts', kept)
        self.assertEqual(kept['props']['ComputerPersonal0'], {'Tag': 'Desk'})     # its own emails of the game again
        self.assertEqual(kept['props']['UCEdit9'], {})
        self.assertEqual(kept['added'][0]['props'], {'Tag': 'Terminal'})
        self.assertEqual(kept['props']['ComputerPersonal1'], {'TextPackage': 'TheirPackage'})    # no texts of the editor's
        self.assertEqual(source['props']['UCEdit9']['TextPackage'], 'UCMaps')    # the map's own edits are left as they are

    def test_every_field_the_editor_writes_is_kept_or_left_out_on_purpose(self):
        fields = set()
        for path in (KIT / 'editor' / 'static').glob('*.js'):
            fields |= set(re.findall(r'\bedits\.([A-Za-z_]+)', path.read_text(encoding='utf-8')))
        for path in list((KIT / 'editor').glob('*.py')) + [KIT / 'scene.py']:
            fields |= set(re.findall(r"\bedits(?:\.get\(|\[)'([A-Za-z_]+)'", path.read_text(encoding='utf-8')))
        self.assertGreater(len(fields), 25)
        self.assertEqual(sorted(fields - set(maptemplates.KEEP) - set(maptemplates.DROP)), [])
        self.assertEqual(set(maptemplates.KEEP) & set(maptemplates.DROP), set())

    def test_an_exit_into_the_old_map_leads_into_the_new_one(self):
        self.assertEqual(maptemplates._into('"01_Old#Back"', '01_old', '02_New'), '"02_New#Back"')
        self.assertEqual(maptemplates._into('01_Old/Back', '01_Old', '02_New'), '02_New/Back')
        self.assertEqual(maptemplates._into('"02_Other#Start"', '01_Old', '02_New'), '"02_Other#Start"')
        self.assertEqual(maptemplates._into('01_Old', '01_Old', '02_New'), '01_Old')     # a bare tag: inside the map
        self.assertEqual(maptemplates._into('"#Inside"', '01_Old', '02_New'), '"#Inside"')
        # a MapExit's DestMap: a bare value is a map
        self.assertEqual(maptemplates._into('01_Old', '01_Old', '02_New', bare_map=True), '02_New')
        self.assertEqual(maptemplates._into('"01_old#Up"', '01_Old', '02_New', bare_map=True), '"02_New#Up"')
        self.assertEqual(maptemplates._into('02_Other', '01_Old', '02_New', bare_map=True), '02_Other')

    def test_every_exit_of_the_edits_is_retargeted_destmap_and_all_properties_too(self):
        edits = {
            'added': [{'name': 'UCEdit1', 'cls': 'MapExit', 'props': {'DestMap': '01_Old'}},
                      {'name': 'UCEdit2', 'cls': 'Teleporter', 'props': {'URL': 'Spot'}}],
            'props': {'MapExit0': {'DestMap': '"01_OLD#Roof"'}},
            'rawprops': {'Teleporter3': {'URL': '"01_Old#Spot"'}, 'MapExit4': {'DestMap': '02_Other'}, 'Light1': {'URL': ''}},
        }
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(maptemplates._for_map(edits, Path(folder), '01_Old', '02_New'), [])
        self.assertEqual(edits['added'][0]['props'], {'DestMap': '02_New'})
        self.assertEqual(edits['added'][1]['props'], {'URL': 'Spot'})                 # a tag in the map
        self.assertEqual(edits['props']['MapExit0'], {'DestMap': '"02_New#Roof"'})
        self.assertEqual(edits['rawprops']['Teleporter3'], {'URL': '"02_New#Spot"'})
        self.assertEqual(edits['rawprops']['MapExit4'], {'DestMap': '02_Other'})
        self.assertEqual(edits['rawprops']['Light1'], {'URL': ''})


class RoomTest(unittest.TestCase):
    def test_a_room_new_map_made_is_read_back(self):
        with tempfile.TemporaryDirectory(prefix='.maptemplates-room-', dir=Path(__file__).parent) as temp:
            with patch.object(newmap.kit, 'PROJECT', Path(temp)), patch.object(maplinks, 'all_maps', return_value=[]), \
                    patch.object(settings, 'PROJECT_KIND', 'custom', create=True):
                for i, mood in enumerate(newmap.MOODS):
                    script, _name = newmap.create_empty('Room %d' % i, 3, (1024, 3072, 512), '', {'floor': 'FloorA', 'walls': 'WallB'}, mood=mood)
                    text = (newmap.maps_folder() / (script + '.py')).read_text(encoding='utf-8')
                    self.assertEqual(newmap.room_of(text), dict(size=[1024, 3072, 512], mood=mood,
                                     textures=dict(newmap.TEXTURES, floor='FloorA', walls='WallB')))
                # a room changed by hand, or a script of its own: not a New map room
                self.assertIsNone(newmap.room_of(text.replace('LightBrightness=', 'LightBrightness=1')))
                self.assertIsNone(newmap.room_of(text.replace('W, D, H = 1024', 'W, D, H = WIDTH')))
                self.assertIsNone(newmap.room_of("MAP = '06_Hand'\ns = Scene(MAP)\n"))


class TemplateFilesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='.maptemplates-', dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.kit = self.root / 'tools/mapkit'
        self.maps = self.kit / 'maps'
        self.pictures = self.kit / 'textures'
        for folder in (self.maps, self.pictures / '01_Old', self.root / 'maps'):
            folder.mkdir(parents=True)
        self.taken = []
        patches = [patch.object(newmap.kit, 'PROJECT', self.root), patch.object(dxmaps, 'KIT', self.kit),
                   patch.object(dxmaps, 'edits_path', side_effect=lambda name: self.maps / (name + '.edits.json')),
                   patch.object(dxmaps, 'MOD_MAPS', self.root / 'maps'), patch.object(textures, 'ROOT', self.pictures),
                   patch.object(maplinks, 'all_maps', side_effect=lambda: list(self.taken)),
                   patch.object(settings, 'PROJECT_KIND', 'custom', create=True),
                   patch.object(maptemplates.props, 'is_a', side_effect=is_a)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        with patch.object(maplinks, 'all_maps', return_value=[]):
            self.script, _ = newmap.create_empty('Old', 1, (2048, 1024, 384), 'Old place', None, mood='warm')
        self.taken.append('01_Old')
        for ext in ('.pcx', '.png'):
            (self.pictures / '01_Old' / ('UCT_Wall_1' + ext)).write_bytes(b'picture' + ext.encode())
        self.checked = []

    def files(self):
        return sorted(str(p.relative_to(self.root)).replace('\\', '/') for p in self.root.rglob('*') if p.is_file())

    def save_room(self, **kw):
        return maptemplates.save('01_Old', self.maps / (self.script + '.py'), kw.get('name', 'Warm room'),
                                 kw.get('description', 'A room to start from'), kw.get('picture', JPEG), map_edits(),
                                 check=self.checked.append)

    def test_save_list_picture_and_delete(self):
        before = self.files()
        made = self.save_room()
        self.assertRegex(made['id'], r'^\d{8}-\d{6}-Warm_room$')
        self.assertEqual((made['name'], made['description'], made['source']), ('Warm room', 'A room to start from', '01_Old'))
        self.assertEqual(made['room'], dict(size=[2048, 1024, 384], textures=newmap.TEXTURES, mood='warm'))
        self.assertTrue(made['picture'].startswith('/map_templates/%s/thumb.jpg?v=' % made['id']))
        self.assertEqual(maptemplates.picture_file('%s/thumb.jpg' % made['id']).read_bytes()[:2], b'\xff\xd8')
        self.assertEqual(len(self.checked), 1)                  # the editor's own check of the kept edits
        folder = maptemplates.root() / made['id']
        self.assertEqual(sorted(p.name for p in (folder / 'textures').iterdir()), ['UCT_Wall_1.pcx', 'UCT_Wall_1.png'])
        kept = maptemplates.load(made['id'])['edits']
        self.assertEqual(kept['textures']['UCT_Wall_1']['pcx'], 'UCT_Wall_1.pcx')
        self.assertNotIn('links', kept)
        # a second one of the same name gets a folder of its own; listed by name
        other = self.save_room(name='A warm room', picture='')
        self.assertEqual([t['name'] for t in maptemplates.listing()], ['A warm room', 'Warm room'])
        self.assertEqual(other['picture'], '')
        maptemplates.delete(made['id'])
        maptemplates.delete(other['id'])
        self.assertEqual(maptemplates.listing(), [])
        self.assertEqual(self.files(), before)
        self.assertEqual(list(maptemplates.root().iterdir()), [])

    def test_a_long_name_saved_twice_in_the_same_second(self):
        name = 'A very long template name for a Hong Kong street block with sky'
        with patch.object(maptemplates.time, 'strftime', return_value='20261026-101500'):
            first, second = self.save_room(name=name), self.save_room(name=name)
        self.assertEqual(second['id'], first['id'] + '_2')
        self.assertEqual(len(first['id'].split('-', 2)[2]), 40)
        self.assertEqual([t['id'] for t in maptemplates.listing()], [first['id'], second['id']])
        maptemplates.delete(second['id'])
        self.assertEqual([t['id'] for t in maptemplates.listing()], [first['id']])

    def test_what_cannot_be_a_template_leaves_nothing(self):
        before = self.files()
        (self.maps / 'hand.py').write_text("MAP = '06_Hand'\n", encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'map script of its own'):
            maptemplates.save('06_Hand', self.maps / 'hand.py', 'Hand', '', JPEG, map_edits())
        for bad in ('data:image/png;base64,iVBORw0KGgo=', 'data:image/jpeg;base64,bm90IGEganBlZw==', 'data:image/jpeg;base64,!!'):
            with self.subTest(picture=bad[:30]), self.assertRaises(ValueError):
                self.save_room(picture=bad)
        with self.assertRaisesRegex(ValueError, 'name'):
            self.save_room(name='   ')
        with self.assertRaises(ValueError):
            maptemplates.save('01_Old', self.maps / (self.script + '.py'), 'Refused', '', JPEG, map_edits(),
                              check=lambda edits: (_ for _ in ()).throw(ValueError('not saved')))
        self.assertEqual(self.files(), sorted(before + ['tools/mapkit/maps/hand.py']))
        self.assertEqual(maptemplates.listing(), [])

    def test_unknown_ids_are_refused(self):
        made = self.save_room()
        for bad in ('../maps', '..\\maps', made['id'] + '/..', 'nope', '', None, 3):
            with self.subTest(tid=bad), self.assertRaises(ValueError):
                maptemplates.delete(bad)
        for bad in ('%s/template.json' % made['id'], '../x/thumb.jpg', 'thumb.jpg'):
            with self.subTest(rel=bad), self.assertRaises(ValueError):
                maptemplates.picture_file(bad)
        self.assertEqual(len(maptemplates.listing()), 1)

    def test_delete_never_goes_through_a_junction(self):
        made = self.save_room()
        folder = maptemplates.root() / made['id']
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'keep.txt').write_text('mine', encoding='utf-8')
        for f in (folder / 'textures').iterdir():
            f.unlink()
        (folder / 'textures').rmdir()
        r = subprocess.run(['cmd', '/c', 'mklink', '/J', str(folder / 'textures'), str(outside)], capture_output=True)
        if r.returncode:
            self.skipTest('no junctions here')
        try:
            with self.assertRaises(OSError):
                maptemplates.delete(made['id'])                 # the folder is not empty: the junction stays
            self.assertEqual((outside / 'keep.txt').read_text(encoding='utf-8'), 'mine')
        finally:
            subprocess.run(['cmd', '/c', 'rmdir', str(folder / 'textures')], capture_output=True)

    def test_a_room_template_makes_a_new_map_built_now(self):
        made = self.save_room()
        built = []
        script, name, ok, lines = maptemplates.create(made['id'], 'Fresh', 2, 'New place',
                                                      build=lambda s: (built.append(s) or True, ['built']))
        self.assertEqual((script, name, ok, built), ('new_02_fresh', '02_Fresh', True, ['new_02_fresh']))
        self.assertEqual(lines, ['made from the template Warm room', 'built'])
        text = (self.maps / 'new_02_fresh.py').read_text(encoding='utf-8')
        self.assertEqual(newmap.room_of(text), made['room'])
        self.assertIn('MissionLocation=\'"New place"\'', text)
        edits = json.loads((self.maps / 'new_02_fresh.edits.json').read_text(encoding='utf-8'))
        self.assertEqual(edits['textures']['UCT_Wall_1']['pcx'], '02_Fresh/UCT_Wall_1.pcx')
        self.assertEqual(edits['textures']['UCT_Wall_1']['png'], '02_Fresh/UCT_Wall_1.png')
        self.assertEqual((self.pictures / '02_Fresh' / 'UCT_Wall_1.pcx').read_bytes(), b'picture.pcx')
        urls = {a['name']: a['props'].get('URL') for a in edits['added'] if a.get('props')}
        self.assertEqual(urls['UCEdit3'], '"02_Fresh#Back"')
        self.assertEqual(urls['UCEdit6'], '"02_Other#Start"')
        self.assertNotIn('links', edits)
        self.assertEqual(maptemplates.load(made['id'])['edits']['textures']['UCT_Wall_1']['pcx'], 'UCT_Wall_1.pcx')

    def test_a_failed_build_leaves_nothing_behind(self):
        made = self.save_room()
        before = self.files()
        script, name, ok, lines = maptemplates.create(made['id'], 'Broken', 2, '', build=lambda s: (False, ['Error: no']))
        self.assertFalse(ok)
        self.assertEqual(lines, ['made from the template Warm room', 'Error: no'])
        self.assertEqual(self.files(), before)
        self.assertFalse((self.pictures / '02_Broken').exists())

    def test_pictures_of_the_same_name_in_the_new_maps_folder_are_never_overwritten(self):
        made = self.save_room()
        (self.pictures / '02_Taken').mkdir()
        (self.pictures / '02_Taken' / 'UCT_Wall_1.pcx').write_bytes(b'theirs')
        before = self.files()
        with self.assertRaises(FileExistsError):
            maptemplates.create(made['id'], 'Taken', 2, '', build=lambda s: (True, []))
        self.assertEqual((self.pictures / '02_Taken' / 'UCT_Wall_1.pcx').read_bytes(), b'theirs')
        self.assertEqual(self.files(), before)

    def test_a_map_file_template_is_copied_as_a_project_map(self):
        dx = self.root / 'maps' / '01_Copied.dx'
        dx.write_bytes(b'the copied map')
        made = maptemplates.save('01_Copied', dx, 'Street', '', '', {'added': [], 'moved': {'Lamp2': {'loc': [1, 2, 3]}}})
        self.assertIsNone(made['room'])
        folder = maptemplates.root() / made['id']
        self.assertEqual((folder / '01_Copied.dx').read_bytes(), b'the copied map')
        with patch.object(newmap, 'copy_bytes', return_value=b'prepared copy') as prepare:
            script, name, ok, lines = maptemplates.create(made['id'], 'Block', 6, 'Hong Kong', build=lambda s: self.fail('no build'))
        self.assertEqual((script, name, ok), ('dx:06_Block', '06_Block', True))
        self.assertEqual(prepare.call_args.args[:2], (folder / '01_Copied.dx', '06_Block'))
        self.assertEqual(prepare.call_args.kwargs, dict(mission=6, location='Hong Kong'))
        self.assertEqual((self.root / 'maps' / '06_Block.dx').read_bytes(), b'prepared copy')
        edits = json.loads(dxmaps.edits_path('06_Block').read_text(encoding='utf-8'))
        self.assertEqual(edits['moved'], {'Lamp2': {'loc': [1, 2, 3]}})
        # a name a map has is refused before anything is made
        self.taken.append('06_Block')
        with patch.object(newmap, 'copy_bytes', side_effect=AssertionError('not copied')):
            with self.assertRaisesRegex(ValueError, 'already exists'):
                maptemplates.create(made['id'], 'Block', 6)


if __name__ == '__main__':
    unittest.main()
