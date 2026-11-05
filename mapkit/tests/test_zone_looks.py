"""The data of the 3D view's Effects: what a zone does to the view (zones.look, data.zone_looks), the zone of every
triangle in geometry.json (data._assemble), a lamp's phase and corona in the Properties (props.py)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import data  # noqa: E402
import props  # noqa: E402
import zones  # noqa: E402

SCENE = """Begin Map
Begin Actor Class=LevelInfo Name=LevelInfo0
    TexUPanSpeed=2.000000
End Actor
Begin Actor Class=DeusExLevelInfo Name=DeusExLevelInfo0
    MapName="Test"
End Actor
Begin Actor Class=WaterZone Name=WaterZone0
    ViewFlash=(X=-0.300000)
    FogColor=(R=12,G=34,B=56,A=0)
    FogDistance=1500.000000
    bFogZone=True
    Location=(X=10.000000,Y=0.000000,Z=0.000000)
End Actor
End Map
"""


class ZoneLook(unittest.TestCase):
    def test_zoneinfo_defaults_when_neither_the_map_nor_the_class_says(self):
        self.assertEqual(zones.look({}, {}), dict(pan=[35.0, 35.0], viewFog=[0.0, 0.0, 0.0], viewFlash=[0.0, 0.0, 0.0],
                                                  fog=False, fogColour=[0, 0, 0], fogDistance=0.0))

    def test_the_maps_value_before_its_class_and_texels_a_second(self):
        look = zones.look({'TexUPanSpeed': '-0.500000', 'ViewFog': '(X=0.1,Y=0.2,Z=0.3)'},
                          {'ViewFog': ['(Y=0.05,Z=0.1)'], 'TexVPanSpeed': ['0.000000'], 'bFogZone': ['True']})
        self.assertEqual(look['pan'], [-17.5, 0.0])
        self.assertEqual(look['viewFog'], [0.1, 0.2, 0.3])
        self.assertTrue(look['fog'])

    def test_text_it_cannot_read_falls_back(self):
        look = zones.look({'TexUPanSpeed': 'fast', 'ViewFog': '(X=a)', 'FogColor': '(R=x)'}, {})
        self.assertEqual((look['pan'][0], look['viewFog'], look['fogColour']), (35.0, [0.0, 0.0, 0.0], [0, 0, 0]))


class ZoneLooks(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name)
        (self.folder / 'scene.t3d').write_text(SCENE, encoding='latin1')
        (self.folder / 'pzone.json').write_text(json.dumps({'zones': ['', 'WaterZone0', 'GoneZone'], 'zone': [0, 1]}))
        classes = {'classes': {'WaterZone': {'props': {'ViewFog': ['(X=0.000000,Y=0.050000,Z=0.100000)']}}, 'LevelInfo': {'props': {}}}}
        for patch in (mock.patch.object(data, 'map_folder', return_value=self.folder),
                      mock.patch.object(data.props_mod, 'defaults', return_value=classes)):
            patch.start()
            self.addCleanup(patch.stop)

    def test_each_zone_in_order_its_class_defaults_and_the_level_for_the_rest(self):
        level, water, gone = data.zone_looks('Map')
        self.assertEqual(level['pan'], [70.0, 35.0])            # LevelInfo, not DeusExLevelInfo
        self.assertEqual(gone, level)                            # a zone without its ZoneInfo: the level's
        self.assertEqual(water['viewFog'], [0.0, 0.05, 0.1])     # WaterZone's own blue
        self.assertEqual(water['viewFlash'], [-0.3, 0.0, 0.0])
        self.assertEqual((water['fog'], water['fogColour'], water['fogDistance']), (True, [12, 34, 56], 1500.0))

    def test_a_pass_before_the_zones(self):
        (self.folder / 'pzone.json').write_text(json.dumps({'zones': None, 'zone': []}))
        self.assertEqual(data.zone_looks('Map'), [])
        (self.folder / 'pzone.json').unlink()
        self.assertEqual(data.zone_looks('Map'), [])


class TriangleZones(unittest.TestCase):
    def test_every_triangle_has_the_zone_in_front_of_its_polygon(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            nums = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 64, 64]
            values = {'polys': [['Pkg.Water', 0, nums, [0, 0, 0, 64, 0, 0, 64, 64, 0, 0, 64, 0], 0],
                                ['Pkg.Water', 0, nums, [0, 0, 0, 64, 0, 0, 64, 64, 0], 0]],
                      'textures': {'Pkg.Water': {}}, 'brushes': [{'name': 'Brush0', 'ord': 0}], 'pface': [0, 1],
                      'pzone': {'zones': ['', 'WaterZone0'], 'zone': [1, 0]}}
            for name, value in values.items():
                (folder / (name + '.json')).write_text(json.dumps(value))
            with mock.patch.object(data, 'structures', return_value={}):
                data._assemble('Fixture', folder)
            group = json.loads((folder / 'geometry.json').read_text())['groups'][0]
            self.assertEqual(group['zones'], [1, 1, 0])
            (folder / 'pzone.json').unlink()                  # a pass before zones: zone 0 everywhere
            with mock.patch.object(data, 'structures', return_value={}):
                data._assemble('Fixture', folder)
            self.assertEqual(json.loads((folder / 'geometry.json').read_text())['groups'][0]['zones'], [0, 0, 0])


class LampFields(unittest.TestCase):
    def test_pan_speed_fields_inherit_to_water_and_sky_with_cached_defaults(self):
        # Defaults v17 already contains the speeds (previously read for preview only).
        own = {'TexUPanSpeed': ['1.000000'], 'TexVPanSpeed': ['1.000000']}
        classes = {cls: {'parents': [] if cls == 'ZoneInfo' else ['ZoneInfo'], 'props': own, 'types': {}}
                   for cls in ('ZoneInfo', 'WaterZone', 'SkyZoneInfo', 'PrecipitationZone')}
        with mock.patch.object(props, 'defaults', return_value={'classes': classes, 'enums': {}}):
            for cls in classes:
                fields = props.fields_for(cls)
                self.assertEqual([f['prop'] for f in fields], list(own))
                self.assertTrue(all(f['group'] == 'Texture panning' and f['kind'] == 'float' for f in fields))
                self.assertTrue(all(f['declared'] == 'ZoneInfo' for f in fields))
        self.assertTrue(set(own) <= set(props.NAMES))

    def test_zone_speed_edits_keep_zero_and_reverse_separately(self):
        edits = {'props': {'WaterZone0': {'TexUPanSpeed': '-0.500000', 'TexVPanSpeed': '0.000000'},
                           'SkyZone0': {'TexUPanSpeed': '2.000000'}}}
        self.assertEqual(props.commands(edits), ['UC_PROP SkyZone0 TexUPanSpeed 2.000000',
            'UC_PROP WaterZone0 TexUPanSpeed -0.500000', 'UC_PROP WaterZone0 TexVPanSpeed 0.000000'])
        self.assertEqual(zones.look(edits['props']['WaterZone0'], {})['pan'], [-17.5, 0.0])
        self.assertEqual(zones.look(edits['props']['SkyZone0'], {})['pan'], [70.0, 35.0])

    def test_phase_after_period_and_corona_in_a_lamps_properties(self):
        light = {'parents': ['Actor', 'Object'], 'types': {},
                 'props': {p: ['0'] for p in ('LightType', 'LightPeriod', 'LightPhase', 'bSpecialLit', 'bCorona')}}
        with mock.patch.object(props, 'defaults', return_value={'classes': {'Light': light}, 'enums': {}}):
            names = [f['prop'] for f in props.fields_for('Light')]
        self.assertEqual(names[names.index('LightPeriod') + 1], 'LightPhase')
        self.assertIn('bCorona', names)
        self.assertTrue({'LightPhase', 'bCorona'} <= set(props.NAMES))
        self.assertFalse(set(props.ZONE_LOOK) & set(props.NAMES))     # read, not in the panel

    def test_period_and_phase_help_promise_no_blink_rate_or_phase(self):
        """In both games a blink is on or off at random whatever its Period, and Phase moves only a pulse (B6's
        lights_research.md, read in Render.dll and measured in the game on 28 Oct 2026): the help called Period the
        speed of blinking and had Phase put blinking lamps out of step (part B's #4)."""
        help_ = {f[2]: f[5] for f in props.FIELDS if f[1] == 'Light'}
        period, phase = help_['LightPeriod'], help_['LightPhase']
        self.assertRegex(period, r"^A pulse's round, in both games: every Period / 35 seconds")
        self.assertIn('A blink keeps no time: on or off at random whatever its Period', period)
        self.assertNotIn('blinking', period)
        self.assertRegex(phase, r'^Where in its round a pulse starts')
        self.assertIn('it does nothing for the other types (blink,', phase)
        self.assertNotIn('blink out of step', phase)


if __name__ == '__main__':
    unittest.main()
