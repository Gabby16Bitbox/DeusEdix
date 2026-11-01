"""G27 and G28 on the server: a zone's own sound with its looks (zones.ambience, data.zone_looks: Hear the map hears it
in its zone) and a zone's reverb in the Properties (props.py: the Reverb row, its values, Revision's OpenAL preset,
written to the map with UC_PROP like every property)."""
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
End Actor
Begin Actor Class=ZoneInfo Name=ZoneInfo2
    AmbientSound=Sound'Ambient.Ambient.Machinery'
    SoundRadius=40
    SoundVolume=200
    Location=(X=100.000000,Y=-50.000000,Z=32.000000)
End Actor
Begin Actor Class=WaterZone Name=WaterZone0
    Location=(X=10.000000,Y=0.000000,Z=0.000000)
End Actor
End Map
"""


class ZoneSound(unittest.TestCase):
    def test_the_maps_sound_before_its_class_and_actors_values_where_neither_says(self):
        self.assertEqual(zones.ambience({'AmbientSound': "Sound'Ambient.Ambient.Bar'", 'SoundRadius': '40'}, {'SoundVolume': ['64']}),
                         dict(sound='Ambient.Ambient.Bar', radius=40, volume=64, pitch=64))
        self.assertEqual(zones.ambience({}, {'AmbientSound': ["Sound'Ambient.Ambient.Underwater'"], 'SoundRadius': ['0']}),
                         dict(sound='Ambient.Ambient.Underwater', radius=0, volume=128, pitch=64))
        self.assertEqual(zones.ambience({'SoundPitch': '300', 'AmbientSound': "Sound'A.B'"}, {})['pitch'], 255)   # a byte
        self.assertEqual(zones.ambience({'SoundVolume': 'loud', 'AmbientSound': "Sound'A.B'"}, {})['volume'], 128)
        self.assertIsNone(zones.ambience({'AmbientSound': 'None'}, {}))
        self.assertIsNone(zones.ambience({}, {}))


class ZoneLooksWithSounds(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        folder = Path(tmp.name)
        (folder / 'scene.t3d').write_text(SCENE, encoding='latin1')
        (folder / 'pzone.json').write_text(json.dumps({'zones': ['', 'ZoneInfo2', 'WaterZone0'], 'zone': [0, 1, 2]}))
        classes = {'classes': {'WaterZone': {'props': {'AmbientSound': ["Sound'Ambient.Ambient.Underwater'"], 'SoundRadius': ['0']}},
                               'ZoneInfo': {'props': {'SoundPitch': ['64']}}, 'LevelInfo': {'props': {}}}}
        for patch in (mock.patch.object(data, 'map_folder', return_value=folder),
                      mock.patch.object(data.props_mod, 'defaults', return_value=classes)):
            patch.start()
            self.addCleanup(patch.stop)

    def test_each_zone_has_its_actor_its_place_and_its_sound(self):
        level, bar, water = data.zone_looks('Map')
        self.assertEqual((level['name'], level['sound']), ('LevelInfo0', None))
        self.assertEqual(bar['name'], 'ZoneInfo2')
        self.assertEqual(bar['at'], [100.0, -50.0, 32.0])
        self.assertEqual(bar['sound'], dict(sound='Ambient.Ambient.Machinery', radius=40, volume=200, pitch=64))
        self.assertEqual(water['sound']['sound'], 'Ambient.Ambient.Underwater')     # its class's own
        self.assertIn('viewFog', water)                                             # its looks as before


class ReverbFields(unittest.TestCase):
    def defaults(self, revision):
        zone = {'parents': ['Info', 'Actor', 'Object'], 'types': {},
                'props': {'AmbientSound': ['None'], 'bWaterZone': ['False'], 'bReverbZone': ['False'], 'MasterGain': ['100'],
                          'CutoffHz': ['6000'], 'Delay': ['20', '34', '0', '0', '0', '0'], 'Gain': ['150', '70', '0', '0', '0', '0']}}
        classes = {'ZoneInfo': zone}
        if revision:
            classes['RevZoneInfo'] = dict(zone, parents=['ZoneInfo'] + zone['parents'], props=dict(zone['props'], ReverbPreset=['RP_None']))
        return {'classes': classes, 'enums': {'ReverbPreset': ['RP_Generic', 'RP_Cave', 'RP_None']} if revision else {}}

    def test_the_reverb_row_after_the_zones_own_and_revisions_openal_preset(self):
        with mock.patch.object(props, 'defaults', return_value=self.defaults(True)):
            plain = {f['prop']: f for f in props.fields_for('ZoneInfo')}
            rev = [f['prop'] for f in props.fields_for('RevZoneInfo')]
            preset = next(f for f in props.fields_for('RevZoneInfo') if f['prop'] == 'ReverbPreset')
        self.assertEqual(plain['bReverbZone']['kind'], 'reverb')
        self.assertEqual(plain['Delay']['default'], ['20', '34', '0', '0', '0', '0'])
        self.assertEqual({plain[k]['kind'] for k in ('MasterGain', 'CutoffHz', 'Delay', 'Gain')}, {'reverbpart'})
        self.assertNotIn('ReverbPreset', plain)
        self.assertEqual(rev[rev.index('bWaterZone') + 1:rev.index('bWaterZone') + 7],
                         ['bReverbZone', 'MasterGain', 'CutoffHz', 'Delay', 'Gain', 'ReverbPreset'])
        self.assertEqual((preset['kind'], preset['options']), ('enum', ['RP_Generic', 'RP_Cave', 'RP_None']))
        self.assertEqual({f[0] for f in props.FIELDS if f[2] in ('bReverbZone', 'ReverbPreset')}, {'Zone'})     # one section

    def test_a_zone_whose_gain_is_openals_has_no_echo_gains_row(self):
        """Revision's RevZoneInfo, RevSoundZone, WaterZone, PrecipitationZone and SnowZone declare a float Gain, OpenAL's
        EFX gain, that hides ZoneInfo's byte Gain[6] (RevZoneInfo.uc:135, WaterZone.uc:137): no Echo gains row there
        (the Inspector's Values and copy and paste would write Gain(i) into the EFX gain); each has its OpenAL reverb
        row, which says the echo gains stay the class's. A plain ZoneInfo keeps its six."""
        zone = {'parents': ['Info', 'Actor', 'Object'],
                'types': {'bReverbZone': 'BoolProperty', 'MasterGain': 'ByteProperty', 'CutoffHz': 'IntProperty',
                          'Delay': 'ByteProperty', 'Gain': 'ByteProperty'},
                'props': {'bWaterZone': ['False'], 'bReverbZone': ['False'], 'MasterGain': ['100'], 'CutoffHz': ['6000'],
                          'Delay': ['20', '34', '0', '0', '0', '0'], 'Gain': ['150', '70', '0', '0', '0', '0']}}

        def efx(*parents, preset='RP_None'):
            return {'parents': list(parents) + zone['parents'],
                    'types': dict(zone['types'], Gain='FloatProperty', ReverbPreset='ByteProperty'),
                    'props': dict(zone['props'], Gain=['0.320000'], ReverbPreset=[preset])}
        classes = {'ZoneInfo': zone, 'SkyZoneInfo': dict(zone, parents=['ZoneInfo'] + zone['parents']),
                   'RevZoneInfo': efx('ZoneInfo'), 'RevSoundZone': efx('RevZoneInfo', 'ZoneInfo'),
                   'WaterZone': efx('ZoneInfo', preset='RP_Underwater'), 'PrecipitationZone': efx('ZoneInfo'),
                   'SnowZone': efx('PrecipitationZone', 'ZoneInfo')}
        with mock.patch.object(props, 'defaults', return_value={'classes': classes, 'enums': {'ReverbPreset': ['RP_None']}}):
            rows = {cls: {f['prop']: f for f in props.fields_for(cls)} for cls in classes}
        for cls in ('RevZoneInfo', 'RevSoundZone', 'WaterZone', 'PrecipitationZone', 'SnowZone'):
            with self.subTest(cls=cls):
                self.assertNotIn('Gain', rows[cls])
                self.assertEqual([p for p in rows[cls] if p in ('bReverbZone', 'Delay', 'ReverbPreset')],
                                 ['bReverbZone', 'Delay', 'ReverbPreset'])
                self.assertIn('leave the echo gains to the class', rows[cls]['ReverbPreset']['help'])
                self.assertEqual(rows[cls]['ReverbPreset']['declared'], 'WaterZone' if cls == 'WaterZone' else
                                 'PrecipitationZone' if cls in ('PrecipitationZone', 'SnowZone') else 'RevZoneInfo')
        for cls in ('ZoneInfo', 'SkyZoneInfo'):
            self.assertEqual(rows[cls]['Gain']['default'], ['150', '70', '0', '0', '0', '0'])
            self.assertNotIn('ReverbPreset', rows[cls])
        self.assertIn('all but their gains', rows['ZoneInfo']['bReverbZone']['help'])

    @unittest.skipUnless(props.CACHE.is_file(), "no class defaults on this PC (cache/_palette/defaults.json)")
    def test_this_pcs_classes_with_an_openal_reverb_have_no_echo_gains_row(self):
        """The class defaults the editor read from the game here: every class with ReverbPreset and a float Gain has
        no Gain row and has the OpenAL reverb row."""
        d = json.loads(props.CACHE.read_text(encoding='utf-8'))
        efx = sorted(c for c, v in d['classes'].items() if 'ReverbPreset' in v.get('props', {}))
        if not efx:
            self.skipTest('the original game: no OpenAL reverb')
        with mock.patch.object(props, 'defaults', return_value=d):
            for cls in efx:
                names = [f['prop'] for f in props.fields_for(cls)]
                with self.subTest(cls=cls):
                    self.assertEqual(d['classes'][cls]['types'].get('Gain'), 'FloatProperty')
                    self.assertNotIn('Gain', names)
                    self.assertIn('ReverbPreset', names)
            self.assertIn('Gain', [f['prop'] for f in props.fields_for('ZoneInfo')])

    def test_the_original_game_has_no_openal_preset(self):
        with mock.patch.object(props, 'defaults', return_value=self.defaults(False)):
            self.assertNotIn('ReverbPreset', [f['prop'] for f in props.fields_for('ZoneInfo')])
            self.assertEqual(props.fields_for('RevZoneInfo'), [])

    def test_its_values_go_into_the_map_and_are_read_from_it(self):
        self.assertGreaterEqual(props.VERSION, 17)                  # the class defaults read again with them
        self.assertTrue({'bReverbZone', 'MasterGain', 'CutoffHz', 'Delay', 'Gain', 'ReverbPreset'} <= set(props.NAMES))
        edits = {'props': {'ZoneInfo3': {'bReverbZone': 'True', 'Delay(5)': '250', 'ReverbPreset': 'RP_Cave'}}}
        self.assertEqual(props.commands(edits), ['UC_PROP ZoneInfo3 Delay(5) 250', 'UC_PROP ZoneInfo3 ReverbPreset RP_Cave',
                                                 'UC_PROP ZoneInfo3 bReverbZone True'])
        self.assertEqual(props.t3d_props({'Delay(0)': '50', 'Gain(5)': '20', 'MasterGain': '90', 'SpeedOfSound': '8000.000000'}),
                         {'Delay(0)': '50', 'Gain(5)': '20', 'MasterGain': '90'})


if __name__ == '__main__':
    unittest.main()
