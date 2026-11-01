"""A .dx map's build decides from the map's source, never from the editor's dump of the map shown (game re-test of 30 Oct
2026, #0): after a build that dump is the build's own output, so a second Rebuild with nothing changed left out UCBoot0
(the editor's story, texts and voices in the game), the sky box, a retexture of every object wearing a texture, and kept
object tags the edits no longer had; play_prepare records a Rebuild, so Play played that map. The host is a stand-in
that writes what the real one does (the source's T3D for its export, the map and its T3D for a build) and the page's
dump is written as data.prepare writes it; only temporary folders under tests/ are written."""
import json
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import data  # noqa: E402
import dxmaps  # noqa: E402
import props  # noqa: E402
import t3d  # noqa: E402
import textures  # noqa: E402

MAP = 'SourceFixture'
CLASSES = {'DeusExMover': ['Mover', 'Brush', 'Actor', 'Object'], 'Light': ['Actor', 'Object'],
           'Lamp1': ['DeusExDecoration', 'Decoration', 'Actor', 'Object'], 'SkyZoneInfo': ['ZoneInfo', 'Info', 'Actor', 'Object'],
           'UCBoot': ['Info', 'Actor', 'Object'], 'UCObjectTag': ['Info', 'Actor', 'Object'],
           'LevelInfo': ['ZoneInfo', 'Info', 'Actor', 'Object']}
FAKE = {'version': props.VERSION, 'enums': {},
        'classes': {name: {'parents': parents, 'props': {}, 'types': {}} for name, parents in CLASSES.items()}}
# the source as the host exports it: a door, a light (blue: its own colour names it, no tag), a lamp wearing LampTex1
SOURCE_T3D = '''Begin Map
Begin Actor Class=LevelInfo Name=LevelInfo0
End Actor
Begin Actor Class=DeusExMover Name=Door0
    BasePos=(X=100.000000,Y=0.000000,Z=0.000000)
    KeyPos(1)=(X=0.000000,Y=0.000000,Z=96.000000)
    Location=(X=100.000000,Y=0.000000,Z=0.000000)
End Actor
Begin Actor Class=Light Name=Light0
    LightHue=170
    LightSaturation=100
    Location=(X=0.000000,Y=0.000000,Z=128.000000)
End Actor
Begin Actor Class=Lamp1 Name=Lamp0
    Location=(X=64.000000,Y=0.000000,Z=0.000000)
End Actor
End Map
'''
OLD_TEX, NEW_TEX = 'DeusExDeco.Skins.LampTex1', 'UCT_LampNew'
# the lamps' class as the palette has its model (data.GAME_CACHE/_palette/models): the texture on its base (slot 0), a
# shade on slot 1
LAMP_MODEL = {'parts': [{'slot': 0, 'tex': OLD_TEX}, {'slot': 1, 'tex': 'DeusExDeco.Skins.LampShadeTex'}]}
# a lamp of the prefab library (prefabs.copy), its shade given the lamp's texture too; pasted, prefabs.place names it
# UCPfAA0
LAMP_PREFAB = {'id': 'lamp_corner', 'label': 'Corner lamp', 'source': '01_Other', 'pivot': [0, 0, 0], 'packages': [],
               'blocks': [{'name': 'Lamp3', 'cls': 'Lamp1', 'brush': False,
                           'raw': "Begin Actor Class=Lamp1 Name=Lamp3\n    MultiSkins(1)=Texture'%s'\n"
                                  "    Location=(X=0.000000,Y=64.000000,Z=0.000000)\nEnd Actor\n" % OLD_TEX}]}
PASTE = {'pid': 'A', 'prefab': 'lamp_corner', 'offset': [0, 0, 0]}


def block(cls, name, x, extra=''):
    """An object of a prefab as prefabs.copy keeps it: its T3D block, at x along X."""
    return {'name': name, 'cls': cls, 'brush': False,
            'raw': 'Begin Actor Class=%s Name=%s\n%s    Location=(X=%.6f,Y=0.000000,Z=0.000000)\nEnd Actor\n' % (cls, name, extra, x)}


# a corner of the prefab library (a chair, a lamp, a plant, a door, a vase), pasted 300 units along X: prefabs.place
# names its objects UCPfp1A<slot>, and the editor's records of them after a Rebuild name the places that build gave them
# (orig)
CORNER_PREFAB = {'id': 'corner', 'label': 'Corner', 'source': '01_Other', 'pivot': [0, 0, 0], 'packages': [], 'blocks': [
    block('ChairLeather', 'Chair1', 0), block('Lamp1', 'Lamp2', 50), block('Plant1', 'Plant1', 70),
    dict(block('DeusExMover', 'Door1', 100, '    KeyPos(1)=(X=0.000000,Y=0.000000,Z=96.000000)\n'), mover=True),
    block('Vase1', 'Vase1', 120)]}
CORNER = {'pid': 'p1', 'prefab': 'corner', 'offset': [300, 0, 0]}
# what the editor changed on them one by one: the chair moved, turned and grown, the lamp deleted, the plant given
# another class (Replace with...), the door raised
CHAIR = {'cls': 'DeusEx.ChairLeather', 'loc': [310, 20, 0], 'rot': [0, 16384, 0], 'orig': [300, 0, 0], 'scale': 1.5}
LAMP = {'cls': 'Lamp1', 'orig': [350, 0, 0]}
PLANT = {'name': 'UCPfp1A2', 'cls': 'Plant2', 'loc': [370, 0, 0], 'rot': [0, 0, 0], 'props': {},
         'replaces': {'cls': 'Plant1', 'orig': [370, 0, 0]}}
DOOR = {'cls': 'DeusExMover', 'loc': [400, 0, 32], 'rot': [0, 0, 0], 'orig': [400, 0, 0]}
IMPORT = r'MAP IMPORTADD FILE="..\T3D\added.t3d"'
EDITS = {'moved': {'Door0': {'loc': [140, 0, 0], 'rot': [0, 0, 0], 'cls': 'DeusExMover'}},
         'boxes': [{'name': 'SkyHole', 'lo': [-64, -64, 192], 'hi': [64, 64, 256], 'hole': True, 'sky': True}],
         'textures': {NEW_TEX: {'pcx': 'none/%s.pcx' % NEW_TEX}},
         'retexture': [{'kind': 'actors', 'old': OLD_TEX, 'tex': NEW_TEX}],
         'objectTags': {'Light0': {'mode': 'manual', 'value': 'red'}},
         'links': [{'id': 'LampUsed', 'when': 'used', 'src': 'Lamp0', 'do': [{'verb': 'lighton', 'targetTag': 'red'}]}]}


def palette_model(game_cache):
    """The palette's model of the lamps' class (LAMP_MODEL), as data.palette_meshes publishes it."""
    path = Path(game_cache) / '_palette' / 'models' / 'Lamp1.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(LAMP_MODEL))


def package(classes):
    """A map package as tools\\ue1pkg.py reads it (version 68): one object of each class, the classes imported."""
    def index(v):            # a compact index: small values only
        assert 0 <= v < 64
        return bytes([v])
    names = ['None', 'Core', 'Class'] + list(classes) + [c + '0' for c in classes]
    body = b''.join(index(len(n) + 1) + n.encode('latin1') + b'\0' + struct.pack('<I', 0) for n in names)
    imports = b''.join(index(1) + index(2) + struct.pack('<i', 0) + index(3 + i) for i in range(len(classes)))
    # each object: its class (import i + 1, a negative index), no super, no package, its name, no flags, no data
    exports = b''.join(bytes([0x80 | (i + 1)]) + index(0) + struct.pack('<i', 0) + index(3 + len(classes) + i)
                       + struct.pack('<I', 0) + index(0) for i in range(len(classes)))
    head = 36
    return (struct.pack('<IIIIIIIII', 0x9E2A83C1, 68, 0, len(names), head, len(classes), head + len(body) + len(imports),
                        len(classes), head + len(body)) + body + imports + exports)


class SourceTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='dx-source-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.maps, self.out, self.run = self.root / 'maps', self.root / 'out', self.root / 'run'
        for folder in (self.maps, self.out, self.run / 'T3D', self.run / 'Output'):
            folder.mkdir(parents=True)
        self.source = self.maps / (MAP + '.dx')
        self.source.write_bytes(package(['LevelInfo', 'DeusExMover', 'Light', 'Lamp1']))
        self.source_t3d = SOURCE_T3D
        self.edits = self.root / 'edits.json'
        self.edits.write_text(json.dumps(EDITS))
        self.builds, self.added, self.exports, self.fail_export = [], [], 0, False
        self.watches = []               # (the host run, its watch)
        self.answer = ''                # what the host's log says of the build's commands
        cache = self.root / 'editor' / 'cache'
        # the editor's cache: data's, and dxmaps' own folder, where the builds before this test looked; the game's
        # palette (the classes' models) and the prefab library
        for target, name, value in ((dxmaps, 'MOD_MAPS', self.maps), (dxmaps, 'OUT', self.out),
                                    (dxmaps, 'edits_path', lambda _: self.edits),
                                    (dxmaps, '__file__', str(self.root / 'editor' / 'dxmaps.py')),
                                    (dxmaps.kit, 'new_run', lambda *a, **k: self.run), (dxmaps.kit, 'execute', self.execute),
                                    (dxmaps.activation, 'save', lambda *a: None), (dxmaps.settings, 'STANDALONE', True),
                                    (data, 'CACHE', cache), (data, 'GAME_CACHE', self.root / 'gamecache'),
                                    (dxmaps.prefabs, 'ROOT', self.root / 'prefabs'), (props, 'defaults', lambda log=print: FAKE),
                                    (props, 'cached_defaults', lambda: FAKE),
                                    (props, 'class_tree', lambda log=print: props.tree_of(FAKE['classes']))):
            p = patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.dict(os.environ, {'DEUSEDIX_BUILD_PREVIEW': '0'})
        p.start()
        self.addCleanup(p.stop)

    def execute(self, folder, commands, *args, **kwargs):
        """The host: the source's export (MAP EXPORT of the map loaded alone) or a build (its map and its T3D: the
        source with the imported objects). Each run's watch is noted (kit.execute's: the Rebuild's); fail_export: the
        export fails (or raises that exception)."""
        folder = Path(folder)
        if len(commands) == 2 and commands[1].startswith('MAP EXPORT'):
            self.exports += 1
            self.watches.append(('export', kwargs.get('watch')))
            if self.fail_export:
                raise self.fail_export if isinstance(self.fail_export, Exception) else RuntimeError('host run failed (3)')
            (folder / 'Output' / 'source.t3d').write_text(self.source_t3d, encoding='latin1')
            return '', 0.01
        added = folder / 'T3D' / 'added.t3d'
        self.watches.append(('build', kwargs.get('watch')))
        self.builds.append(list(commands))
        self.added.append(added.read_text(encoding='latin1') if added.exists() else '')
        (folder / 'Output' / (MAP + '.dx')).write_bytes(b'build %d' % len(self.builds))
        (folder / 'Output' / (MAP + '.t3d')).write_text(self.source_t3d.replace('End Map\n', self.added[-1] + 'End Map\n'),
                                                         encoding='latin1')
        return self.answer, 0.01

    def page_dump(self, shown, scene, lamp_tex):
        """The page's dump of the map it shows (data.prepare: its SDK editor pass kept for that .dx, stamp.txt)."""
        folder = data.CACHE / MAP
        folder.mkdir(parents=True, exist_ok=True)
        st = Path(shown).stat()
        (folder / 'stamp.txt').write_text('%s-%d-%d-m%d' % (shown, st.st_mtime_ns, st.st_size, data.MESH_VERSION))
        (folder / 'scene.t3d').write_text(scene, encoding='latin1')
        (folder / 'meshes.json').write_text(json.dumps({'Lamp0': {'parts': [{'slot': 0, 'tex': lamp_tex}]}}))

    def build(self):
        ok, lines = dxmaps.build(MAP, log=lambda *a: None)
        self.assertTrue(ok, lines)
        return self.builds[-1], self.added[-1]

    def show_the_build(self):
        """The page shows the build: its dump of out\\<map>.dx (the build's T3D, the lamp wearing the new skin)."""
        self.page_dump(self.out / (MAP + '.dx'), (self.out / (MAP + '.t3d')).read_text(encoding='latin1'),
                       'MyLevel.Imported.' + NEW_TEX)

    def paste_lamp(self):
        """A lamp of the prefab library pasted into the map (edits['prefabs']), the palette's model of its class."""
        folder = dxmaps.prefabs.ROOT / LAMP_PREFAB['id']
        folder.mkdir(parents=True)
        (folder / 'prefab.json').write_text(json.dumps(LAMP_PREFAB))
        palette_model(data.GAME_CACHE)
        self.edits.write_text(json.dumps(dict(EDITS, prefabs=[PASTE])))

    def build_corner(self, moved=None, deleted=None, added=()):
        """The corner pasted into the map with the editor's records of its objects (EDITS' door of the map moved too),
        built: (its commands, its imported objects by name: [actor], the report)."""
        folder = dxmaps.prefabs.ROOT / CORNER_PREFAB['id']
        folder.mkdir(parents=True)
        (folder / 'prefab.json').write_text(json.dumps(CORNER_PREFAB))
        self.edits.write_text(json.dumps(dict(EDITS, prefabs=[CORNER], moved=dict(EDITS['moved'], **(moved or {})),
                                              deleted=deleted or {}, added=list(added))))
        self.page_dump(self.source, self.source_t3d, OLD_TEX)
        ok, lines = dxmaps.build(MAP, log=lambda *a: None)
        self.assertTrue(ok, lines)
        imported = {}
        for a in t3d.actors(self.added[-1]):
            imported.setdefault(a['name'], []).append(a)
        return self.builds[-1], imported, lines

    def test_a_copys_objects_changed_one_by_one_reach_the_map(self):
        """What the editor changed on a pasted copy's objects goes into their blocks, before the import: a build starts
        from the map's source, which has no copy, so their UC_SET and UC_DEL found nothing (the host's 'set|missing')
        and the copy came in as its prefab has it, while the report said 'EDIT moved' (part B's #9, 1 Nov 2026). The
        map's own objects keep their commands."""
        cmds, imported, lines = self.build_corner(moved={'UCPfp1A0': CHAIR}, deleted={'UCPfp1A1': LAMP}, added=[PLANT])
        self.assertFalse([c for c in cmds if c.split()[0] in ('UC_SET', 'UC_DEL') and 'UCPfp1' in c])
        self.assertIn('UC_SET Door0 140.000 0.000 0.000 0 0 0', cmds)
        chair = imported['UCPfp1A0'][0]['props']
        self.assertEqual((t3d.vec(chair['Location']), t3d.rot(chair.get('Rotation'))), ((310, 20, 0), (0, 16384, 0)))
        self.assertGreater(cmds.index('UC_SCALE UCPfp1A0 1.5000'), cmds.index(IMPORT), 'grown once it is there')
        self.assertNotIn('UCPfp1A1', imported)
        self.assertEqual([a['cls'] for a in imported['UCPfp1A2']], ['Plant2'], 'one object under that name, the new one')
        self.assertEqual(t3d.vec(imported['UCPfp1A4'][0]['props']['Location']), (420, 0, 0), 'the vase as placed')
        for line in ('  EDIT moved UCPfp1A0', '  EDIT deleted UCPfp1A1', '  EDIT replaced UCPfp1A2 (Plant1)',
                     '  EDIT added Plant2 UCPfp1A2'):
            self.assertIn(line, lines)

    def test_a_copys_door_moved_on_its_own_takes_its_keys_along(self):
        """A pasted door moved in the editor: its keys go with it, as a map script's door's do (the build stopped with
        'UCPfp1A3 is not a door or elevator of this map any more': the source's doors only)."""
        cmds, imported, lines = self.build_corner(moved={'UCPfp1A3': DOOR})
        door = imported['UCPfp1A3'][0]['props']
        self.assertEqual((t3d.vec(door['Location']), t3d.vec(door['BasePos'])), ((400, 0, 32), (400, 0, 32)))
        self.assertFalse([c for c in cmds if 'UCPfp1A3' in c and not c.startswith('UC_MOVER prep')])
        self.assertIn('  EDIT moved UCPfp1A3', lines)

    def test_a_record_whose_object_is_not_where_it_says_is_skipped_and_said(self):
        """A record matches its object by name, class and the place it had (within 2 units), as a map script's build
        does: one that does not leaves the object as placed, and the report says so. The object given another class
        stays then, and the replacing one is not added (two objects never share a name)."""
        cmds, imported, lines = self.build_corner(moved={'UCPfp1A4': {'cls': 'Vase1', 'loc': [420, 40, 0], 'orig': [120, 0, 0]}},
                                                  deleted={'UCPfp1A1': dict(LAMP, cls='Lamp3')},
                                                  added=[dict(PLANT, replaces={'cls': 'Plant1', 'orig': [70, 0, 0]})])
        self.assertEqual(t3d.vec(imported['UCPfp1A4'][0]['props']['Location']), (420, 0, 0))
        self.assertEqual([a['cls'] for a in imported['UCPfp1A1']], ['Lamp1'])
        self.assertEqual([a['cls'] for a in imported['UCPfp1A2']], ['Plant1'])
        for line in ('  EDIT skipped UCPfp1A4 (not found as Vase1 at its original place)',
                     '  EDIT skipped UCPfp1A1 (not found as Lamp3 at its original place)',
                     '  EDIT UCPfp1A2 not replaced (not found as Plant1 at its original place)',
                     '  EDIT Plant2 UCPfp1A2 not added (the object it replaces is still there)'):
            self.assertIn(line, lines)
        self.assertNotIn('  EDIT moved UCPfp1A4', lines)

    def test_a_second_build_with_nothing_changed_makes_the_same_map(self):
        self.page_dump(self.source, self.source_t3d, OLD_TEX)
        first, first_added = self.build()
        self.show_the_build()
        second, second_added = self.build()
        for build, (cmds, added) in enumerate(((first, first_added), (second, second_added)), 1):
            with self.subTest(build=build):
                self.assertIn('Name=UCBoot0', added, 'the editor story, texts and voices start')
                self.assertIn('Class=SkyZoneInfo Name=UCSkyZone', added, 'the sky box and its zone')
                self.assertIn(r'BRUSH IMPORT FILE="..\T3D\sky0.t3d"', cmds)
                self.assertIn('UC_PROP Door0 BasePos (X=140.000,Y=0.000,Z=0.000)', cmds)
                self.assertIn("UC_PROP Lamp0 MultiSkins(0) Texture'MyLevel.Imported.%s'" % NEW_TEX, cmds)
                self.assertIn('UC_PROP Light0 bStatic False', cmds)
                self.assertLess(cmds.index('UC_DEL UCBoot0'), cmds.index(r'MAP IMPORTADD FILE="..\T3D\added.t3d"'))
                self.assertLess(cmds.index('UC_DEL UCTag_Light0'), cmds.index(r'MAP IMPORTADD FILE="..\T3D\added.t3d"'))
        self.assertEqual(second, first)
        self.assertEqual(second_added, first_added)
        self.assertEqual(self.exports, 0, "the page's dump of the source, kept for the next builds")

    def test_a_source_object_the_look_lacks_is_retextured_from_its_block(self):
        """An object of the source the page's dump has no entry for (a dump made without the objects), with no mesh of
        its own: dxmaps.build passes every block of the build, the source's too, so the first build retextures it from
        its block (its class's model), as the builds after a look has it do (re-test 4 of 31 Oct 2026, #0)."""
        self.page_dump(self.source, self.source_t3d, OLD_TEX)
        (data.CACHE / MAP / 'meshes.json').write_text('{}')
        palette_model(data.GAME_CACHE)
        self.assertIn("UC_PROP Lamp0 MultiSkins(0) Texture'MyLevel.Imported.%s'" % NEW_TEX, self.build()[0])

    def test_object_tags_taken_out_of_the_edits_are_out_of_the_next_build(self):
        """A real change still shows: the light's tag taken out of the edits after a build, whose output has it baked
        (UCTag_Light0): the link that turns on the lights tagged red no longer reaches that blue light."""
        self.page_dump(self.source, self.source_t3d, OLD_TEX)
        self.assertIn('UC_PROP Light0 bStatic False', self.build()[0])
        self.show_the_build()
        self.assertIn('Class=UCObjectTag Name=UCTag_Light0', (data.CACHE / MAP / 'scene.t3d').read_text(encoding='latin1'))
        self.edits.write_text(json.dumps(dict(EDITS, objectTags={})))
        self.assertNotIn('UC_PROP Light0 bStatic False', self.build()[0])

    def test_without_a_dump_of_the_source_the_host_exports_it_once(self):
        """A map built without the page's dump of its source (never shown, or shown before it changed; no retexture of
        every object wearing a texture, which is chosen on the objects shown)."""
        self.edits.write_text(json.dumps({k: v for k, v in EDITS.items() if k != 'retexture'}))
        first, first_added = self.build()             # never shown: no dump at all
        self.assertEqual(self.exports, 1)
        self.assertIn('UC_PROP Door0 BasePos (X=140.000,Y=0.000,Z=0.000)', first)
        self.show_the_build()
        self.assertEqual(self.build(), (first, first_added))
        self.assertEqual(self.exports, 1, 'kept for the same source (its content)')
        self.source.write_bytes(self.source.read_bytes() + b'\0')        # the source changed (another tool)
        self.source_t3d = SOURCE_T3D.replace('X=100.000000', 'X=110.000000')
        self.assertIn('UC_PROP Door0 BasePos (X=140.000,Y=0.000,Z=0.000)', self.build()[0])
        self.assertEqual(self.exports, 2, 'read again from the changed source')
        self.assertIn('X=110.000000', (self.out / '.sources' / MAP / 'scene.t3d').read_text(encoding='latin1'))

    def test_a_dump_of_another_version_of_the_source_is_not_taken(self):
        self.page_dump(self.source, SOURCE_T3D.replace('Name=Door0', 'Name=OldDoor'), OLD_TEX)
        self.source.write_bytes(self.source.read_bytes() + b'\0')        # changed after the page looked at it
        self.assertIn('UC_PROP Door0 BasePos (X=140.000,Y=0.000,Z=0.000)', self.build()[0])
        self.assertEqual(self.exports, 1)

    def test_the_host_finding_no_ucboot0_to_delete_is_no_skipped_edit(self):
        """UCBoot0 and the object tags' blocks are deleted and made again at every build, as the walkable area is: the
        host's word that the map had none (a source without them, as an original map) is not an edit skipped (the
        cross-check of 31 Oct 2026: 'EDIT skipped UCTag_Light0' at every build of a map with a tagged light); an
        object of the edits the map has no more still is."""
        self.page_dump(self.source, self.source_t3d, OLD_TEX)
        self.answer = ('UCMapKit|del|missing|UCBoot0\nUCMapKit|del|missing|UCNavMesh0\nUCMapKit|del|missing|UCTag_Light0\n'
                       'UCMapKit|set|missing|Crate9\n')
        ok, lines = dxmaps.build(MAP, log=lambda *a: None)
        self.assertTrue(ok, lines)
        self.assertEqual([line for line in lines if 'skipped' in line], ['  EDIT skipped Crate9 (not in the map any more)'])

    def test_a_dump_the_page_replaced_while_it_was_read_is_not_kept(self):
        """The page may dump the map shown (the build) while the build reads its dump of the source: asked again after
        reading, the source's own export is taken instead."""
        self.page_dump(self.source, SOURCE_T3D.replace('Name=Door0', 'Name=OldDoor'), OLD_TEX)
        answers = iter([True, False])
        with patch.object(data, 'dumped_from', lambda *a: next(answers)):
            self.assertIn('UC_PROP Door0 BasePos (X=140.000,Y=0.000,Z=0.000)', self.build()[0])
        self.assertEqual(self.exports, 1)
        self.assertNotIn('OldDoor', (self.out / '.sources' / MAP / 'scene.t3d').read_text(encoding='latin1'))

    def test_a_source_the_host_cannot_export_fails_the_build_and_keeps_nothing(self):
        self.fail_export = True
        ok, lines = dxmaps.build(MAP, log=lambda *a: None)
        self.assertFalse(ok)
        self.assertIn('could not be read', lines[-1])
        self.assertEqual(self.builds, [], 'no build from a map whose objects are not known')
        self.assertFalse((self.out / '.sources' / MAP / 'stamp.txt').exists())
        self.fail_export = False
        self.assertTrue(dxmaps.build(MAP, log=lambda *a: None)[0])
        self.assertEqual(self.exports, 2, 'tried again')

    def test_a_source_with_a_sky_zone_gets_no_sky_box(self):
        """The source's own SkyZoneInfo (its package's objects): no second sky, whatever the page shows."""
        self.source.write_bytes(package(['LevelInfo', 'DeusExMover', 'Light', 'Lamp1', 'SkyZoneInfo']))
        for shown in ('source', 'build'):
            with self.subTest(shown):
                if shown == 'source':
                    self.page_dump(self.source, self.source_t3d, OLD_TEX)
                else:
                    self.show_the_build()
                cmds, added = self.build()
                self.assertNotIn('UCSkyZone', added)
                self.assertFalse([c for c in cmds if 'sky0.t3d' in c])

    def test_a_pasted_objects_skins_do_not_depend_on_the_map_shown(self):
        """'Every object wearing X' on a pasted structure's objects, which the build imports itself (prefabs.place) and
        the page's dump has only after a build: taken from their blocks (their class's model, their own skins), and of
        that dump only the objects the source has, so the second build with nothing changed gives the same skins
        (cross-check of 31 Oct 2026: the first build left the pasted lamp as it was, the second retextured it), and a
        paste deleted after a build is not retextured from that dump (an object the build no longer has)."""
        self.paste_lamp()
        self.page_dump(self.source, self.source_t3d, OLD_TEX)
        first = [c for c in self.build()[0] if 'MultiSkins' in c]
        self.show_the_build()
        # the build's dump has the pasted lamp too (wearing the texture on both slots, as the first build used to leave it)
        meshes = data.CACHE / MAP / 'meshes.json'
        meshes.write_text(json.dumps(dict(json.loads(meshes.read_text()), UCPfAA0={'parts': [
            {'slot': 0, 'tex': OLD_TEX}, {'slot': 1, 'tex': OLD_TEX}]})))
        second = [c for c in self.build()[0] if 'MultiSkins' in c]
        skin = "Texture'MyLevel.Imported.%s'" % NEW_TEX
        self.assertEqual(first, ['UC_PROP Lamp0 MultiSkins(0) ' + skin, 'UC_PROP UCPfAA0 MultiSkins(0) ' + skin,
                                 'UC_PROP UCPfAA0 MultiSkins(1) ' + skin])
        self.assertEqual(second, first)
        self.edits.write_text(json.dumps(dict(EDITS, prefabs=[dict(PASTE, deleted=True)])))
        self.assertEqual([c for c in self.build()[0] if 'MultiSkins' in c], ['UC_PROP Lamp0 MultiSkins(0) ' + skin])

    def test_the_source_export_is_a_run_of_the_rebuild(self):
        """The source's export runs with the Rebuild's watch (its Cancel stops it: kit.execute), and a run stopped there
        ends the Rebuild with nothing kept for the source (cross-check of 31 Oct 2026)."""
        watch = object()
        self.fail_export = dxmaps.kit.Stopped('cancelled')
        with self.assertRaises(dxmaps.kit.Stopped):
            dxmaps.build(MAP, log=lambda *a: None, watch=watch)
        self.assertEqual((self.watches, self.builds), ([('export', watch)], []))
        self.assertFalse((self.out / '.sources').exists(), 'nothing kept')
        self.fail_export = False
        self.assertTrue(dxmaps.build(MAP, log=lambda *a: None, watch=watch)[0])
        self.assertEqual(self.watches, [('export', watch), ('export', watch), ('build', watch)])

    def test_a_development_working_copy_builds_no_ucboot(self):
        """UCBoot0 starts DeusEdix's story, texts and characters' fates (settings.STANDALONE): a development working
        copy's build neither deletes nor imports one (cross-check of 31 Oct 2026)."""
        self.page_dump(self.source, self.source_t3d, OLD_TEX)
        with patch.object(dxmaps.settings, 'STANDALONE', False):
            cmds, added = self.build()
        self.assertNotIn('UC_DEL UCBoot0', cmds)
        self.assertNotIn('UCBoot', added)
        self.assertIn('Class=UCObjectTag Name=UCTag_Light0', added, 'the rest of the build as before')


class WearersTests(unittest.TestCase):
    def test_every_object_wearing_the_texture_or_already_its_replacement(self):
        """textures.actor_commands' "every object wearing X": the editor's last look at the map is the build's output
        after a build, where those objects wear the replacement already; they are retextured again, so the second
        build makes the same map."""
        with tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='wearers-') as temp:
            cache = Path(temp)
            (cache / MAP).mkdir()
            (cache / MAP / 'meshes.json').write_text(json.dumps({
                'Lamp0': {'parts': [{'slot': 0, 'tex': OLD_TEX}]},
                'Lamp1': {'parts': [{'slot': 1, 'tex': 'MyLevel.Imported.' + NEW_TEX}]},
                'Crate0': {'parts': [{'slot': 0, 'tex': 'CoreTexMetal.Metal.Other'}]}}))
            with patch.object(data, 'CACHE', cache):
                cmds = textures.actor_commands(EDITS, MAP)
        self.assertEqual(cmds, ["UC_PROP Lamp0 MultiSkins(0) Texture'MyLevel.Imported.%s'" % NEW_TEX,
                                "UC_PROP Lamp1 MultiSkins(1) Texture'MyLevel.Imported.%s'" % NEW_TEX])

    def test_pasted_objects_wear_their_classs_model_and_their_own_skins(self):
        """A pasted structure's objects (blocks: as the build imports them, t3d.actors of their blocks): their class's
        model (the palette's), MultiSkins(slot) over it, Skin over slot 0 unless MultiSkins(0) is given. Of the editor's
        last look only the objects the source has (source: a .dx map's); every one for a script map (no source)."""
        with tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='wearers-') as temp:
            root = Path(temp)
            (root / 'cache' / MAP).mkdir(parents=True)
            (root / 'cache' / MAP / 'meshes.json').write_text(json.dumps({
                'Lamp0': {'parts': [{'slot': 0, 'tex': OLD_TEX}]},
                'UCPfAA0': {'parts': [{'slot': 0, 'tex': OLD_TEX}]}}))        # the build's dump: a pasted lamp in it
            palette_model(root / 'gamecache')
            lamp, other = "Texture'%s'" % OLD_TEX, "Texture'DeusExDeco.Skins.OtherTex'"
            pasted = [dict(name='UCPfBA0', cls='Lamp1', props={}),
                      dict(name='UCPfBA1', cls='DeusExDeco.Lamp1', props={'MultiSkins(1)': lamp}),
                      dict(name='UCPfBA2', cls='Lamp1', props={'Skin': other}),
                      dict(name='UCPfBA3', cls='Lamp1', props={'Skin': other, 'MultiSkins(0)': lamp}),
                      dict(name='UCPfBB4', cls='Brush', props={})]
            lamp = textures.short(OLD_TEX).lower()
            wearing = lambda **parts: [part for part, tex in textures.wearers(MAP, {}, **parts).items() if tex == lamp]
            with patch.object(data, 'CACHE', root / 'cache'), patch.object(data, 'GAME_CACHE', root / 'gamecache'):
                self.assertEqual(wearing(source={'Lamp0'}, blocks=pasted),
                                 [('Lamp0', 0), ('UCPfBA0', 0), ('UCPfBA1', 0), ('UCPfBA1', 1), ('UCPfBA3', 0)])
                self.assertEqual(wearing(), [('Lamp0', 0), ('UCPfAA0', 0)],
                                 'a script map: every object of the last look')


if __name__ == '__main__':
    unittest.main()
