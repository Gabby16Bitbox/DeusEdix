"""Echo gains a zone cannot take are left out of the builds (B6 in the game, 28 Oct 2026: a RevZoneInfo given the Hangar
preset by an older editor kept Gain(0)=120 ... Gain(5)=25 in its edits, and every Rebuild wrote UC_PROP UCEdit1 Gain(0)
120, which set OpenAL's float Gain to 120: build_report.txt). A class whose Gain is a FloatProperty in the class
defaults (Revision's RevZoneInfo, RevSoundZone, WaterZone, PrecipitationZone, SnowZone) gets no Gain(n), neither from
the Properties' edits nor from an added object's own properties, in a script map's build (scene.py) and in an original
.dx's (dxmaps.py); the build report says what was left out and why. No game: the host's run is stopped before it
starts, and only temporary folders under tests/ are written."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import dxmaps  # noqa: E402
import props  # noqa: E402
import zones  # noqa: E402
from scene import Scene  # noqa: E402

# the class defaults as the game gives them (types as on this PC: cache/_palette/defaults.json)
FAKE = {'version': props.VERSION, 'enums': {}, 'classes': {
    'ZoneInfo': {'parents': ['Info', 'Actor', 'Object'], 'props': {'Gain': ['150', '70', '0', '0', '0', '0']},
                 'types': {'Gain': 'ByteProperty'}},
    'RevZoneInfo': {'parents': ['ZoneInfo', 'Info', 'Actor', 'Object'],
                    'props': {'Gain': ['0.320000'], 'ReverbPreset': ['RP_None']},
                    'types': {'Gain': 'FloatProperty', 'ReverbPreset': 'ByteProperty'}},
    'WaterZone': {'parents': ['ZoneInfo', 'Info', 'Actor', 'Object'],
                  'props': {'Gain': ['0.320000'], 'ReverbPreset': ['RP_Underwater']},
                  'types': {'Gain': 'FloatProperty', 'ReverbPreset': 'ByteProperty'}},
}}
# what the old Hangar preset left on 10_B6_Ingame's UCEdit1 (Projects/Feature Test, new_10_b6_ingame.edits.json)
B6 = {'bReverbZone': 'True', 'MasterGain': '120', 'CutoffHz': '7000', 'ReverbPreset': 'RP_Hangar',
      **{'Delay(%d)' % i: d for i, d in enumerate(('60', '100', '140', '180', '220', '255'))},
      **{'Gain(%d)' % i: g for i, g in enumerate(('120', '95', '75', '55', '40', '25'))}}
LINE = ("  EDIT skipped Gain(0..5) of UCEdit1 (echo gains: a RevZoneInfo's Gain is OpenAL's EFX gain, which hides them; "
        "its echoes keep the class's)")
# a pool: a water box, whose WaterZone the builds add (zones.actors: UCZone_Pool), and echo gains given to that zone
POOL = {'name': 'Pool', 'lo': [0, 0, 0], 'hi': [256, 256, 128], 'water': {'kind': 'water'}, 'tex': 'ClenGreyCncrt_A'}
POOL_EDITS = {'boxes': [POOL], 'props': {'UCZone_Pool': {'Gain(0)': '120', 'Gain(1)': '95', 'bReverbZone': 'True'}}}
POOL_LINE = ("  EDIT skipped Gain(0..1) of UCZone_Pool (echo gains: a WaterZone's Gain is OpenAL's EFX gain, which hides "
             "them; its echoes keep the class's)")


def gain_props(cmds, name):
    return [c for c in cmds if c.startswith('UC_PROP %s Gain' % name)]


def bare_scene(map_name):
    """A script map's Scene with no script run (what _apply_actor_edits and actor_commands need)."""
    s = object.__new__(Scene)
    s.actors, s.movers, s.actor_group, s.groups, s._group = [], [], {}, {}, None
    s.explicit, s.pieces, s.actor_note, s.op_piece, s._n, s.ops = set(), {}, {}, [], {}, []
    s.map_name, s.tex_edits = map_name, None
    return s


class EchoGainsTest(unittest.TestCase):
    def setUp(self):
        for fake in (patch.object(props, 'defaults', lambda log=print: FAKE),
                     patch.object(props, 'cached_defaults', lambda: FAKE, create=True)):
            fake.start()
            self.addCleanup(fake.stop)

    def test_the_properties_commands_leave_them_out_where_the_class_hides_them(self):
        edits = {'props': {'UCEdit1': dict(B6), 'UCEdit0': {'Gain(0)': '90', 'bReverbZone': 'True'},
                           'Pool': {'Gain(1)': '20'}}}
        classes = {'UCEdit1': 'RevZoneInfo', 'UCEdit0': 'ZoneInfo', 'Pool': 'MyLevel.WaterZone'}
        cmds = props.commands(edits, classes)
        self.assertEqual(gain_props(cmds, 'UCEdit1') + gain_props(cmds, 'Pool'), [])
        self.assertIn('UC_PROP UCEdit1 Delay(5) 255', cmds)
        self.assertIn('UC_PROP UCEdit1 ReverbPreset RP_Hangar', cmds)
        self.assertEqual(gain_props(cmds, 'UCEdit0'), ['UC_PROP UCEdit0 Gain(0) 90'])     # a plain zone's echo gain
        # the build report: what was left out and why, and not among the values set
        report = props.report(edits, classes)
        self.assertIn(LINE, report)
        self.assertIn("  EDIT skipped Gain(1) of Pool (echo gains: a WaterZone's Gain is OpenAL's EFX gain, which hides "
                      "them; its echoes keep the class's)", report)
        edit_line = next(line for line in report if line.startswith('  EDIT UCEdit1:'))
        self.assertNotIn('Gain(', edit_line)
        self.assertIn('Delay(0)=60', edit_line)
        # a name whose class is not known (none given, another mod's class): as it was
        self.assertEqual(len(gain_props(props.commands(edits), 'UCEdit1')), 6)
        self.assertEqual(len(gain_props(props.commands(edits, {'UCEdit1': 'SomeModZone'}), 'UCEdit1')), 6)

    def test_a_script_maps_build(self):
        s = bare_scene('EchoGainsFixture')
        edits = {'added': [{'name': 'UCEdit1', 'cls': 'RevZoneInfo', 'loc': [-768, 512, 200], 'rot': [0, 0, 0],
                            'props': {'Gain(2)': '75', 'MasterGain': '120'}},
                           {'name': 'UCEdit0', 'cls': 'ZoneInfo', 'loc': [512, -768, 200], 'props': {'Gain(2)': '50'}}],
                 'props': {'UCEdit1': dict(B6)}}
        report = s._apply_actor_edits(edits)
        self.assertIn(LINE, report)
        self.assertIn("  EDIT skipped Gain(2) of UCEdit1 (echo gains: a RevZoneInfo's Gain is OpenAL's EFX gain, which "
                      "hides them; its echoes keep the class's)", report)
        block = next(b for b in s.actors if 'Name=UCEdit1' in b)
        self.assertNotRegex(block, r'(?m)^\s*Gain\(')                       # its own properties: imported without it
        self.assertIn('MasterGain=120', block)
        self.assertIn('Gain(2)=50', next(b for b in s.actors if 'Name=UCEdit0' in b))
        s.prop_edits = edits
        with tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='echo-gains-') as temp:
            (Path(temp) / 'T3D').mkdir()
            cmds = s.actor_commands(temp)
        self.assertEqual(gain_props(cmds, 'UCEdit1'), [])
        self.assertIn('UC_PROP UCEdit1 Delay(0) 60', cmds)

    def test_an_original_maps_build(self):
        edits = {'added': [{'name': 'UCEdit1', 'cls': 'RevZoneInfo', 'loc': [-768, 512, 200], 'rot': [0, 0, 0],
                            'props': {'Gain(0)': '120', 'Gain(1)': '95', 'bReverbZone': 'True'}}],
                 'props': {'UCEdit1': dict(B6)}}
        ran = {}

        def execute(folder, cmds, *args, **kwargs):
            ran['cmds'], ran['added'] = cmds, (Path(folder) / 'T3D' / 'added.t3d').read_text(encoding='latin1')
            raise RuntimeError('stopped before the game\'s editor runs')

        with tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='echo-gains-') as temp:
            root = Path(temp)
            (root / 'run' / 'T3D').mkdir(parents=True)
            (root / 'out').mkdir()
            (root / 'EchoGainsFixture.dx').write_bytes(b'a map')
            editfile = root / 'EchoGainsFixture.edits.json'
            editfile.write_text(json.dumps(edits), encoding='utf-8')
            with patch.object(dxmaps, 'MOD_MAPS', root), patch.object(dxmaps, 'OUT', root / 'out'), \
                    patch.object(dxmaps, 'edits_path', lambda _: editfile), \
                    patch.object(dxmaps.kit, 'new_run', lambda *a, **k: root / 'run'), \
                    patch.object(dxmaps.kit, 'execute', execute), \
                    patch.object(dxmaps, 'source_scene', lambda *a, **k: ''):      # a source without objects
                ok, lines = dxmaps.build('EchoGainsFixture')
        self.assertFalse(ok)
        self.assertEqual(gain_props(ran['cmds'], 'UCEdit1'), [])
        self.assertIn('UC_PROP UCEdit1 MasterGain 120', ran['cmds'])
        self.assertIn(LINE, lines)
        self.assertIn("  EDIT skipped Gain(0..1) of UCEdit1 (echo gains: a RevZoneInfo's Gain is OpenAL's EFX gain, "
                      "which hides them; its echoes keep the class's)", lines)
        self.assertNotRegex(ran['added'], r'(?m)^\s*Gain\(')
        self.assertIn('bReverbZone=True', ran['added'])

    def test_a_pools_water_zone_in_a_script_maps_build(self):
        """#7 of part_a2: the WaterZone of a pool comes after the added objects (zone_actors): its echo gains are left
        out of its UC_PROP and the build report says so."""
        s = bare_scene('EchoGainsPoolFixture')
        s.zone_actors = zones.actors(POOL_EDITS)
        self.assertEqual([(a['cls'], a['name']) for a in s.zone_actors], [('WaterZone', 'UCZone_Pool')])
        report = s._apply_actor_edits(POOL_EDITS)
        self.assertIn(POOL_LINE, report)
        s.prop_edits = POOL_EDITS
        with tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='echo-gains-') as temp:
            (Path(temp) / 'T3D').mkdir()
            cmds = s.actor_commands(temp)
        self.assertEqual(gain_props(cmds, 'UCZone_Pool'), [])
        self.assertIn('UC_PROP UCZone_Pool bReverbZone True', cmds)

    def test_a_pools_water_zone_in_an_original_maps_build(self):
        """#7 of part_a2: an original .dx's build with a pool whose zone the map's scene.t3d does not have yet (a source
        changed since it was shown, an MCP edit by name): the zone's echo gains are left out, and said."""
        ran = {}

        def execute(folder, cmds, *args, **kwargs):
            ran['cmds'] = cmds
            raise RuntimeError('stopped before the game\'s editor runs')

        with tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='echo-gains-') as temp:
            root = Path(temp)
            (root / 'run' / 'T3D').mkdir(parents=True)
            (root / 'out').mkdir()
            (root / 'EchoGainsPoolFixture.dx').write_bytes(b'a map')
            editfile = root / 'EchoGainsPoolFixture.edits.json'
            editfile.write_text(json.dumps(POOL_EDITS), encoding='utf-8')
            with patch.object(dxmaps, 'MOD_MAPS', root), patch.object(dxmaps, 'OUT', root / 'out'), \
                    patch.object(dxmaps, 'edits_path', lambda _: editfile), \
                    patch.object(dxmaps.kit, 'new_run', lambda *a, **k: root / 'run'), \
                    patch.object(dxmaps.kit, 'execute', execute), \
                    patch.object(dxmaps, 'source_scene', lambda *a, **k: ''):      # a source without objects
                ok, lines = dxmaps.build('EchoGainsPoolFixture')
        self.assertFalse(ok)
        self.assertEqual(gain_props(ran['cmds'], 'UCZone_Pool'), [])
        self.assertIn('UC_PROP UCZone_Pool bReverbZone True', ran['cmds'])
        self.assertIn(POOL_LINE, lines)


class ThisPcsClassesTest(unittest.TestCase):
    def test_the_zone_classes_whose_gain_is_openals(self):
        # the cache file only: defaults() would start a session of the host and write the cache again when the file is
        # older than props.VERSION (after a VERSION change)
        d = props.cached_defaults()
        if d is None:
            self.skipTest('no class defaults of this VERSION here (cache/_palette/defaults.json)')
        classes = d['classes']
        if 'RevZoneInfo' not in classes:
            self.skipTest('the original game: no OpenAL zones')
        for cls in ('RevZoneInfo', 'RevSoundZone', 'WaterZone', 'PrecipitationZone', 'SnowZone'):
            self.assertTrue(props.openal_gain(cls), cls)
        for cls in ('ZoneInfo', 'SkyZoneInfo', 'PathNode', 'NoSuchClass'):
            self.assertFalse(props.openal_gain(cls), cls)


if __name__ == '__main__':
    unittest.main()
