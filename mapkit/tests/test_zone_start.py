"""After a build, zones.report says when the start of the map is in a zone of the editor, with what that zone does to JC
at once (water, hurts, instant death, own gravity: its exported lines, a WaterZone by its class; the words of its rows
in the Inspector), and nothing for a
zone that only echoes, sounds, lights or fogs (B6 in the game, 27 Oct 2026: "ZONE UCEdit0 contains the start of the
map (JC starts in its water, damage...)" for a Tunnel reverb zone). A zone that is not closed is said as before."""
import re
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import props  # noqa: E402
import zones  # noqa: E402


def actor(cls, name, zone, *lines):
    zone_cls, zone_name = zone
    body = ''.join('    %s\n' % line for line in lines)
    return ("Begin Actor Class=%s Name=%s\n%s    Region=(Zone=%s'MyLevel.%s',iLeaf=1,ZoneNumber=2)\n    Name=%s\nEnd Actor\n"
            % (cls, name, body, zone_cls, zone_name, name))


def build(zone_cls, *lines, start_inside=True):
    """A map as exported with one zone of the editor (UCEdit0) and the player start in it, or in the level's zone."""
    zone = (zone_cls, 'UCEdit0')
    text = 'Begin Map\n' + actor('LevelInfo', 'LevelInfo0', ('LevelInfo', 'LevelInfo0'))
    text += actor(zone_cls, 'UCEdit0', zone, *lines)
    text += actor('PlayerStart', 'PlayerStart0', zone if start_inside else ('LevelInfo', 'LevelInfo0'))
    return text + 'End Map\n', {'added': [{'name': 'UCEdit0', 'cls': zone_cls, 'loc': [0, 0, 0]}]}


class StartInAZone(unittest.TestCase):
    def test_a_zone_that_only_echoes_says_nothing(self):
        text, edits = build('ZoneInfo', 'bReverbZone=True', 'MasterGain=120', 'CutoffHz=5000', 'Delay(0)=17', 'Gain(1)=120')
        self.assertEqual(zones.report(text, edits), [])
        for lines in (('AmbientSound=Sound\'Ambient.Ambient.Bar\'',), ('bFogZone=True', 'ViewFog=(X=0.1,Y=0.1,Z=0.1)'),
                      ('AmbientBrightness=20',), ('bWaterZone=False',)):
            with self.subTest(lines=lines):
                self.assertEqual(zones.report(*build('ZoneInfo', *lines)), [])
        self.assertEqual(zones.report(*build('RevZoneInfo', 'ReverbPreset=RP_Hangar', 'bReverbZone=True')), [])

    def test_what_it_does_at_once_is_said(self):
        cases = {
            'water': (('WaterZone',), 'water'),                                      # by its class
            'toxic water': (('WaterZone', 'bPainZone=True', 'DamagePerSec=10', 'DamageType=Radiation'), 'water, hurts'),
            'a pit': (('ZoneInfo', 'bKillZone=True'), 'instant death'),
            'the moon': (('ZoneInfo', 'bGravityZone=True', 'ZoneGravity=(Z=-300.000000)'), 'own gravity'),
            'water by its lines': (('ZoneInfo', 'bWaterZone=True', 'bPainZone=True'), 'water, hurts'),
        }
        for case, ((cls, *lines), said) in cases.items():
            with self.subTest(case=case):
                self.assertEqual(zones.report(*build(cls, *lines)),
                                 ['  ZONE UCEdit0 contains the start of the map (JC starts in it: %s)' % said])
        # a WaterZone that says it is not water
        self.assertEqual(zones.report(*build('WaterZone', 'bWaterZone=False')), [])

    def test_its_words_are_the_inspectors(self):
        # the label a zone's row shows (app.js: INSPECTOR_LABELS[prop] || the field's label): bKillZone reads Instant
        # death there, not props.py's Kills at once (part_a_result finding 5)
        app = (KIT / 'editor' / 'static' / 'app.js').read_text(encoding='utf-8')
        labels = dict(re.findall(r"(\w+): '([^']*)'", re.search(r'const INSPECTOR_LABELS = \{(.*?)\};', app).group(1)))
        fields = {f[2]: f[3] for f in props.FIELDS if f[1] == 'ZoneInfo'}
        for key, word in zones.AT_ONCE:
            with self.subTest(key=key):
                self.assertTrue((labels.get(key) or fields[key]).lower().startswith(word), (key, word))

    def test_a_start_elsewhere_or_a_sky_zone_says_nothing(self):
        self.assertEqual(zones.report(*build('ZoneInfo', 'bPainZone=True', start_inside=False)), [])
        self.assertEqual(zones.report(*build('SkyZoneInfo', 'bPainZone=True')), [])

    def test_a_zone_that_is_not_closed_is_said_as_before(self):
        text, edits = build('ZoneInfo', 'bReverbZone=True')
        text = text.replace("Region=(Zone=ZoneInfo'MyLevel.UCEdit0',iLeaf=1,ZoneNumber=2)\n    Name=UCEdit0",
                            "Region=(Zone=LevelInfo'MyLevel.LevelInfo0',iLeaf=1,ZoneNumber=2)\n    Name=UCEdit0")
        self.assertEqual(zones.report(text, edits),
                         ['  ZONE UCEdit0 is not closed: it is part of the zone of LevelInfo0 (its water, damage, fog or '
                          'gravity would not be there; close the area with walls or zone portals)'])


if __name__ == '__main__':
    unittest.main()
