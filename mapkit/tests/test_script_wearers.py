"""A script map's "every object wearing X" (Texture > every object wearing) is decided by the build itself: the objects
its script makes (its drop/snap placements and its paste() pieces too) as the editor's last look at the map has them
(cache/<map>/meshes.json), every other object the build imports (a structure copied in the editor, its placements, a
pasted prefab) from its own block, and a copy as its original looks (re-test 3 of 31 Oct 2026, #0: those objects are in
that look only after a build, so the first build after a copy or a paste left them wearing X and the next one, with
nothing changed, retextured them; Play's skip then kept the first one). The real Scene._build_ready, the host stopped at
its run (kit.execute: the commands noted); the page's dump is made after each build from what that build imported and
set, as UC_MESHES shows it. A part of the map's own objects counts by the texture it wore before the map's imported
textures replaced it (each one's 'from', as the Texture Editor writes it), the retextures taken in order from there, and
one of them the look lacks (written into the script since) by its block, unless it has a mesh of its own (re-test 4 of
31 Oct 2026, #0: the first build after such a change decided from the look of the last one, the second build differed,
and Play's skip kept the first). Only temporary folders under tests/ are written."""
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import data  # noqa: E402
import geom  # noqa: E402
import kit  # noqa: E402
import player_profiles  # noqa: E402
import prefabs  # noqa: E402
import scene  # noqa: E402
import t3d  # noqa: E402
import textures  # noqa: E402

MAP = 'ScriptWearersFixture'
OLD, NEW = 'DeusExDeco.Skins.LampTex1', 'UCT_LampNew'
SKIN = textures.ref(NEW)
LAMP = textures.short(OLD).lower()          # how textures.wearers gives a part's texture
# two more textures of the map: one painted over LampTex1 on one lamp ("this object"), one over a texture of the map's
OTHER, REPAINT = 'UCT_LampOther', 'UCT_LampRepaint'
MINE = 'MyLevel.Imported.'                  # how the look names the map's own textures (Texture'MyLevel.Imported.X')
SHADE = 'DeusExDeco.Skins.LampShadeTex'
# the lamps' class as the palette has its model (data.GAME_CACHE/_palette/models): the texture on its base (slot 0), a
# shade on slot 1
LAMP_MODEL = {'parts': [{'slot': 0, 'tex': OLD}, {'slot': 1, 'tex': SHADE}]}
# meshes of their own that two of the script's lamps are given (Mesh=...): the texture on another slot, which only the
# editor's look at the map knows
MESHES = {"LodMesh'DeusExDeco.LampTall'": {'parts': [{'slot': 0, 'tex': SHADE}, {'slot': 2, 'tex': OLD}]},
          "LodMesh'DeusExDeco.LampLow'": {'parts': [{'slot': 0, 'tex': SHADE}, {'slot': 3, 'tex': OLD}]}}
# a lamp of the prefab library (prefabs.copy), its shade given the lamp's texture too; pasted, prefabs.place names it
# UCPfAA0
PREFAB = {'id': 'lamp_corner', 'label': 'Corner lamp', 'source': '01_Other', 'pivot': [0, 0, 0], 'packages': [],
          'blocks': [{'name': 'Lamp3', 'cls': 'Lamp1', 'brush': False,
                      'raw': "Begin Actor Class=Lamp1 Name=Lamp3\n    MultiSkins(1)=Texture'%s'\n"
                             "    Location=(X=0.000000,Y=300.000000,Z=0.000000)\nEnd Actor\n" % OLD}]}
PASTE = {'pid': 'A', 'prefab': 'lamp_corner', 'offset': [0, 0, 0]}
# a piece of an original map the script pastes (Scene.paste: prefabs.library_piece's lib_<map>_<piece>), a lamp with a
# mesh of its own; prefabs.place names it UCPfS0A0
LIBRARY = {'id': 'lib_01_Other_shelf', 'label': 'Shelf lamp', 'source': '01_Other', 'pivot': [0, 0, 0], 'packages': [],
           'blocks': [{'name': 'Lamp9', 'cls': 'Lamp1', 'brush': False,
                       'raw': "Begin Actor Class=Lamp1 Name=Lamp9\n    Mesh=LodMesh'DeusExDeco.LampTall'\n"
                              "    Location=(X=0.000000,Y=0.000000,Z=0.000000)\nEnd Actor\n"}]}
# the look before the copy and the paste: the script's lamps (its pasted one too) by their own meshes
LOOK = {'Lamp0': MESHES["LodMesh'DeusExDeco.LampTall'"], 'Lamp2': MESHES["LodMesh'DeusExDeco.LampLow'"],
        'UCPfS0A0': MESHES["LodMesh'DeusExDeco.LampTall'"]}


def made_over(tex, base):
    """An imported texture of the map painted over base in the Texture Editor (edits['textures'][tex]['from'])."""
    return {tex: {'pcx': 'none/%s.pcx' % tex, 'from': base}}


# every object wearing LampTex1 retextured, the structure copied, the prefab pasted
EDITS = {'textures': made_over(NEW, OLD),
         'retexture': [{'kind': 'actors', 'old': OLD, 'tex': NEW}],
         'copies': [{'group': 'corner', 'id': 'c1', 'offset': [256, 0, 0]}],
         'prefabs': [PASTE]}
# the lines of every build of EDITS: the script's lamps by their own meshes (the dropped one and its own paste() piece
# too), the copies as their originals, the pasted lamp by its class's model and its own skin
EXPECTED = sorted('UC_PROP %s MultiSkins(%d) %s' % (name, slot, SKIN) for name, slot in (
    ('Lamp0', 2), ('Lamp2', 3), ('UCPfS0A0', 2), ('Lamp0_c1', 2), ('Lamp2_c1', 3), ('UCPfS0A0_c1', 2),
    ('UCPfAA0', 0), ('UCPfAA0', 1)))


def script(lamp5=False):
    """The map's script, run afresh by every build (build_cached.py): a copyable structure with a lamp placed at a point
    (Lamp0), one dropped on the floor (Lamp2) and one pasted from an original map (UCPfS0A0), each with a mesh of its
    own; lamp5: a lamp with none (its class's model) placed outside it, written into the script later."""
    with patch('texcat.ensure_index', return_value=False):
        s = scene.Scene(MAP)
    s.begin_group('corner', label='Corner', copyable=True)
    s.add(geom.box((0, 0, 0), (32, 32, 128), 'ClenGreyCncrt_A'))
    s.actor('Lamp1', (0, 64, 0), name='Lamp0', Mesh="LodMesh'DeusExDeco.LampTall'")
    s.drop('Lamp1', 0, -64, 120, name='Lamp2', Mesh="LodMesh'DeusExDeco.LampLow'")
    s.paste('01_Other', 'shelf', (0, 128, 0))
    s.end_group()
    if lamp5:
        s.actor('Lamp1', (0, 200, 0), name='Lamp5')
    return s


class FloorSession:
    """The drop traces' session: a floor at z 10 under every point."""
    def trace(self, start, end):
        return ((start[0], start[1], 10.0), (0.0, 0.0, 1.0)) if end[2] < start[2] else None

    def close(self):
        pass


def lines(cmds, slot=r'\d+'):
    return sorted(c for c in cmds if re.fullmatch(r'UC_PROP \w+ MultiSkins\(%s\) .*' % slot, c))


def worn(cmds):
    """{(object, slot): the map's texture a build leaves on that part}: its last skin line of each part."""
    out = {}
    for c in cmds:
        m = re.fullmatch(r"UC_PROP (\w+) MultiSkins\((\d+)\) Texture'MyLevel\.Imported\.(\w+)'", c)
        if m:
            out[(m.group(1), int(m.group(2)))] = m.group(3)
    return out


class ScriptBuildTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='script-wearers-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.run = self.root / 'run'
        for sub in ('Input', 'Output', 'T3D'):
            (self.run / sub).mkdir(parents=True)
        model = self.root / 'gamecache' / '_palette' / 'models' / 'Lamp1.json'
        model.parent.mkdir(parents=True)
        model.write_text(json.dumps(LAMP_MODEL))
        for prefab in (PREFAB, LIBRARY):
            folder = self.root / 'prefabs' / prefab['id']
            folder.mkdir(parents=True)
            (folder / 'prefab.json').write_text(json.dumps(prefab))
        self.edits = self.root / (MAP + '.edits.json')
        self.ran = []
        for target, name, value in ((data, 'CACHE', self.root / 'cache'), (data, 'GAME_CACHE', self.root / 'gamecache'),
                                    (prefabs, 'ROOT', self.root / 'prefabs'),
                                    (player_profiles, 'FILE', self.root / 'players.json'),       # none
                                    (kit, 'new_run', lambda *a, **k: self.run), (kit, 'execute', self.execute),
                                    (scene.Scene, '_trace_session', lambda s, label: FloorSession())):
            p = patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch('sizes.load', return_value={'Lamp1': [16.0, 30.0]})
        p.start()
        self.addCleanup(p.stop)

    def execute(self, folder, cmds, *args, **kwargs):
        """The host's run of the build, stopped: its commands noted."""
        self.ran = list(cmds)
        return '', None

    def build(self, edits=EDITS, **made):
        """A Rebuild of the map: its script (made: script()'s arguments) run afresh, then its build
        (Scene._build_ready) with the edits."""
        self.edits.write_text(json.dumps(edits))
        script(**made)._build_ready(None, edits=self.edits)
        return lines(self.ran)

    def dump(self, meshes):
        """The page's dump of the map it shows (data.prepare: meshes.json)."""
        folder = data.CACHE / MAP
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'meshes.json').write_text(json.dumps(meshes))

    def look_at_the_build(self):
        """The page's dump of the map just built (UC_MESHES): every lamp the build imported, its model (its own mesh, or
        its class's) with its own skins, and the skins the build set over them."""
        built = {}
        for c in self.ran:
            m = re.fullmatch(r"UC_PROP (\w+) MultiSkins\((\d+)\) Texture'(.*)'", c)
            if m:
                built[(m.group(1), int(m.group(2)))] = m.group(3)
        meshes = {}
        for a in t3d.actors((self.run / 'T3D' / 'actors.t3d').read_text(encoding='latin1')):
            if a['cls'] == 'Lamp1':
                skins = textures._skins(a['props'])
                meshes[a['name']] = {'parts': [
                    dict(part, tex=built.get((a['name'], part['slot']), skins.get(part['slot'], part['tex'])))
                    for part in MESHES.get(a['props'].get('Mesh'), LAMP_MODEL)['parts']]}
        self.dump(meshes)

    def test_the_first_second_and_third_builds_retexture_the_same_objects(self):
        """The look before the copy and the paste, then the look of each build: the same lines every time. The script's
        lamps by their own meshes (the dropped one and its own paste() piece too: once the script's pastes are blocks
        they are the map's own objects, cross-check of 31 Oct 2026), the copies as their originals, the pasted lamp by
        its class's model and its own skin."""
        self.dump(LOOK)
        for n in (1, 2, 3):
            with self.subTest(build=n):
                self.assertEqual(self.build(), EXPECTED)
            self.look_at_the_build()

    def test_an_object_written_into_the_script_since_the_last_build_is_retextured_by_the_first_build(self):
        """A lamp written into the script since the editor last looked at the map, with no mesh of its own (Lamp5): the
        look has no entry for it, so it is taken from its block (its class's model, its own skins), and the first build
        retextures it as the next one does (re-test 4 of 31 Oct 2026, #0: only from the second build, and Play's skip
        kept the first)."""
        self.dump(LOOK)
        self.build()
        self.look_at_the_build()
        expected = sorted(EXPECTED + ['UC_PROP Lamp5 MultiSkins(0) %s' % SKIN])
        for n in (1, 2):
            with self.subTest(build=n):
                self.assertEqual(self.build(lamp5=True), expected)
            self.look_at_the_build()

    def test_a_part_wearing_a_texture_taken_away_is_retextured_by_the_first_build(self):
        """"This object" on Lamp0's slot 2 (OTHER, painted over LampTex1) with every object wearing LampTex1, built;
        then OTHER taken away ("Original": its rule goes, the texture stays in the map's list). The look still shows
        OTHER there, a part that wore LampTex1 under it: the first build retextures it, as the next one does (re-test 4
        of 31 Oct 2026, #0: the first build left LampTex1 on it in the game, the next Play kept that, and only another
        Rebuild retextured it)."""
        textures_ = dict(EDITS['textures'], **made_over(OTHER, OLD))
        self.dump(LOOK)
        self.build(dict(EDITS, textures=textures_,
                        retexture=EDITS['retexture'] + [{'kind': 'actor', 'name': 'Lamp0', 'slot': 2, 'tex': OTHER}]))
        self.look_at_the_build()
        look = json.loads((data.CACHE / MAP / 'meshes.json').read_text())
        self.assertIn({'slot': 2, 'tex': MINE + OTHER}, look['Lamp0']['parts'])
        for n in (1, 2):
            with self.subTest(build=n):
                self.assertEqual(self.build(dict(EDITS, textures=textures_)), EXPECTED)
            self.look_at_the_build()

    def test_a_first_build_with_no_look_leaves_an_object_with_a_mesh_of_its_own_alone(self):
        """No look at the map yet (no meshes.json): the script's lamps come from their blocks, but not those with a mesh
        of their own (placed, dropped, pasted from an original map), whose parts only a look knows: their class's model
        would retexture another part, which would then wear the new texture and be retextured again at every build
        (verify-su4 of 31 Oct 2026). The lamp with none (Lamp5) by its class's model."""
        every = {'textures': EDITS['textures'], 'retexture': EDITS['retexture']}
        self.assertEqual(self.build(every, lamp5=True), ['UC_PROP Lamp5 MultiSkins(0) %s' % SKIN])

    def test_a_texture_painted_over_one_of_the_maps_own_takes_the_parts_left_wearing_it(self):
        """A texture painted, after a Rebuild, over one the map's retextures put on its objects (its 'from' is then
        MyLevel.Imported.<that one>) takes the parts the retextures before it leave wearing that one, from the first
        build as from the next: every lamp repainted; one lamp's own texture on every object wearing it (that lamp
        alone); a lamp given its own texture over the one every lamp wears, then that one repainted (that lamp keeps its
        own). The retextures are taken in order from what each part wore before the map's textures
        (textures.actor_commands), not each by itself from the parts' first textures: that took no part for the first
        two, every lamp for the second, or that lamp for the third."""
        every = {'kind': 'actors', 'old': OLD, 'tex': NEW}
        own = {'kind': 'actor', 'name': 'Lamp0', 'slot': 2, 'tex': OTHER}
        cases = {
            'every lamp repainted': (
                dict(made_over(NEW, OLD), **made_over(REPAINT, MINE + NEW)),
                [every], [every, {'kind': 'actors', 'old': MINE + NEW, 'tex': REPAINT}],
                {('Lamp0', 2): REPAINT, ('Lamp2', 3): REPAINT, ('UCPfS0A0', 2): REPAINT}),
            "one lamp's texture on every object wearing it": (
                dict(made_over(OTHER, OLD), **made_over(REPAINT, MINE + OTHER)),
                [own], [own, {'kind': 'actors', 'old': MINE + OTHER, 'tex': REPAINT}],
                {('Lamp0', 2): REPAINT}),
            'a lamp keeps its own texture': (
                dict(made_over(NEW, OLD), **made_over(OTHER, MINE + NEW), **made_over(REPAINT, MINE + NEW)),
                [every, own], [every, own, {'kind': 'actors', 'old': MINE + NEW, 'tex': REPAINT}],
                {('Lamp0', 2): OTHER, ('Lamp2', 3): REPAINT, ('UCPfS0A0', 2): REPAINT}),
        }
        for case, (made, before, after, expected) in cases.items():
            with self.subTest(case):
                self.dump(LOOK)
                self.build({'textures': made, 'retexture': before})
                self.look_at_the_build()
                for n in (1, 2):
                    self.build({'textures': made, 'retexture': after})
                    self.assertEqual(worn(self.ran), expected, 'build %d' % n)
                    self.look_at_the_build()

    def test_a_deleted_paste_is_not_retextured_from_the_look_that_still_has_it(self):
        self.dump(LOOK)
        self.build()
        self.look_at_the_build()
        self.assertIn('UCPfAA0', json.loads((data.CACHE / MAP / 'meshes.json').read_text()))
        built = self.build(dict(EDITS, prefabs=[dict(PASTE, deleted=True)]))
        self.assertEqual([c for c in built if 'UCPfAA0' in c], [])
        self.assertIn('UC_PROP Lamp0_c1 MultiSkins(2) %s' % SKIN, built)


class WearersTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='wearers-')
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        (root / 'cache' / MAP).mkdir(parents=True)
        crate = {'parts': [{'slot': 0, 'tex': 'Crate.Tex'}]}
        for cls, model in (('Lamp1', LAMP_MODEL), ('CrateUnbreakableSmall', crate)):
            path = root / 'gamecache' / '_palette' / 'models' / (cls + '.json')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(model))
        self.look = root / 'cache' / MAP / 'meshes.json'
        for name, value in (('CACHE', root / 'cache'), ('GAME_CACHE', root / 'gamecache')):
            p = patch.object(data, name, value)
            p.start()
            self.addCleanup(p.stop)

    def wearing(self, edits, **parts):
        """The parts textures.wearers gives as wearing LampTex1, in its order."""
        return [part for part, tex in textures.wearers(MAP, edits, **parts).items() if tex == LAMP]

    def test_a_copy_wears_what_its_original_wears_in_the_look(self):
        """textures.wearers' copies ({a copy's name: its original's}): the original's entry in the look, when the
        original is one of the map's own objects in this build; else, as any object the build imports, its class's model
        with its own skins. The copy's own entry in the look never counts."""
        self.look.write_text(json.dumps({
            'Lamp0': {'parts': [{'slot': 2, 'tex': OLD}]},
            'Lamp0_c1': {'parts': [{'slot': 5, 'tex': OLD}]}}))           # a look older than the copy
        copy = [dict(name='Lamp0_c1', cls='Lamp1', props={})]
        wearing = lambda edits, source={'Lamp0'}: self.wearing(edits, source=source, blocks=copy,
                                                               copies={'Lamp0_c1': 'Lamp0'})
        self.assertEqual(wearing({}), [('Lamp0', 2), ('Lamp0_c1', 2)])
        self.assertEqual(wearing({'deleted': {'Lamp0': {}}}), [('Lamp0_c1', 0)], 'its original deleted')
        self.assertEqual(wearing({}, source=set()), [('Lamp0_c1', 0)], 'its original not in the build')

    def test_every_block_of_the_build_but_those_the_look_or_the_edits_decide(self):
        """textures.wearers' blocks are every block the build imports, the map's own too: one of its own objects the
        look has comes from the look, never from its block; one the look lacks from its block (its class's model, its
        own skins), unless the block gives it a mesh of its own (left alone: only a look knows its parts); one deleted
        in the editor, or added in its place (Replace with...: the added one's class), never from its block (verify-su4
        of 31 Oct 2026)."""
        self.look.write_text(json.dumps({'Lamp0': {'parts': [{'slot': 2, 'tex': OLD}]}}))
        blocks = [dict(name='Lamp0', cls='Lamp1', props={}),
                  dict(name='Lamp5', cls='Lamp1', props={'MultiSkins(1)': "Texture'%s'" % OLD}),
                  dict(name='Lamp6', cls='Lamp1', props={'Mesh': "LodMesh'DeusExDeco.LampTall'"}),
                  dict(name='Lamp7', cls='Lamp1', props={}),
                  dict(name='Lamp8', cls='Lamp1', props={})]
        edits = {'deleted': {'Lamp7': {}}, 'added': [dict(name='Lamp8', cls='CrateUnbreakableSmall')]}
        self.assertEqual(textures.wearers(MAP, edits, source={b['name'] for b in blocks}, blocks=blocks),
                         {('Lamp0', 2): LAMP, ('Lamp8', 0): 'tex', ('Lamp5', 0): LAMP, ('Lamp5', 1): LAMP})

    def test_a_part_counts_by_the_texture_it_wore_before_the_maps_own_replaced_it(self):
        """A part the look shows wearing one of the map's imported textures counts as wearing the texture that one was
        painted over ('from', followed through the map's textures, a loop ending it); a texture of the map with no
        'from' (edits older than it) or none of the map's, as it is named."""
        self.look.write_text(json.dumps({'Lamp0': {'parts': [
            {'slot': 0, 'tex': MINE + REPAINT}, {'slot': 1, 'tex': MINE + NEW}, {'slot': 2, 'tex': MINE + OTHER},
            {'slot': 3, 'tex': MINE + 'UCT_Gone'}, {'slot': 4, 'tex': 'Loop.A'}]}}))
        made = dict(made_over(NEW, OLD), **made_over(REPAINT, MINE + NEW), **{OTHER: {'pcx': 'none/x.pcx'}},
                    **made_over('A', 'Loop.B'), **made_over('B', 'Loop.A'))
        self.assertEqual(textures.wearers(MAP, {'textures': made}),
                         {('Lamp0', 0): LAMP, ('Lamp0', 1): LAMP, ('Lamp0', 2): OTHER.lower(),
                          ('Lamp0', 3): 'uct_gone', ('Lamp0', 4): 'a'})


if __name__ == '__main__':
    unittest.main()
