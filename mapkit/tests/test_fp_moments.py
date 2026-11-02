"""First-person moments and keys (editor/fpmoments.py, live.py, links.py; in the game UCViewMoment and UCMutator): a
moment a rule plays is written as the game reads it, a key a rule waits for is bound in Play's copy of the player's
settings, and the game's classes that do it are the same in the runtime and a new project."""
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import fpmoments  # noqa: E402
import links  # noqa: E402
import live  # noqa: E402

CLASSES = [KIT.parent / 'runtime' / 'DeusEdix' / 'Classes', KIT / 'project-template' / 'src' / 'DeusEdix' / 'Classes']
MOMENT = {'weapon': 'WeaponPistol', 'mesh': 'DeusExItems.Glock',
          'clips': [{'seq': 'Reload', 'from': 0, 'to': 12, 'frames': 24, 'secs': 1.5}, {'seq': 'Bad seq!', 'frames': 2}],
          'offsets': [{'t': 2.5, 'x': 0, 'y': 0, 'z': 0}, {'t': 0.5, 'x': 1, 'y': 2, 'z': 999}],
          'sounds': [{'t': 0.2, 'sound': 'DeusExSounds.Weapons.PistolReload'}, {'t': 1, 'sound': 'not a sound'}],
          'shake': {'t': 1, 'secs': 0.3}}
EDITS = {'links': [{'when': 'keypress', 'key': 'f', 'do': [{'verb': 'fpmoment', 'a': 'Inspect'}, {'verb': 'fpmoment', 'a': 'Gone'}]}],
         'fpmoments': {'Inspect': MOMENT, 'Unused': MOMENT}}


class Moments(unittest.TestCase):
    def test_only_the_moments_a_rule_plays(self):
        made = fpmoments.blocks(EDITS)
        self.assertEqual([a['name'] for a in made], ['UCFP_Inspect'])
        self.assertIn('  A rule plays the first-person moment Gone, which this map does not have: left out', fpmoments.report(EDITS))

    def test_as_the_game_reads_it(self):
        p = fpmoments.props_of('Inspect', MOMENT)
        self.assertEqual(p['MomentName'], '"Inspect"')
        self.assertEqual(p['WeaponClass'], '"WeaponPistol"')
        self.assertEqual((p['Seq(0)'], p['SeqFrom(0)'], p['SeqTo(0)'], p['SeqTime(0)']), ('Reload', '0.000000', '0.500000', '1.500000'))
        self.assertEqual(p['NumSeq'], '1', 'a sequence the game cannot name is left out')
        self.assertEqual((p['OffT(0)'], p['OffV(0)']), ('0.500000', '(X=1.000000,Y=2.000000,Z=200.000000)'), 'in time order, within reach')
        self.assertEqual(p['NumOff'], '2')
        self.assertEqual(p['Snd(0)'], "Sound'DeusExSounds.Weapons.PistolReload'")
        self.assertEqual(p['NumSnd'], '1')
        self.assertEqual(p['ShakeTime'], '0.300000')
        self.assertEqual(fpmoments.packages(EDITS), ['sound:DeusExSounds'])


class Keys(unittest.TestCase):
    def test_the_keys_of_the_rules(self):
        self.assertEqual(links.keys_in(EDITS), ['F'])
        self.assertEqual(links.tag_of({'when': 'keypress', 'key': 'f', 'id': 'L1'}), 'UCL_Key_F')
        self.assertTrue(links.valid({'when': 'keypress', 'key': 'F5', 'do': [{'verb': 'message', 'a': 'x'}]}))
        self.assertFalse(links.valid({'when': 'keypress', 'key': 'Shift', 'do': [{'verb': 'message', 'a': 'x'}]}))

    def test_bound_in_plays_copy_of_the_settings(self):
        text = '[Engine.Engine]\r\nX=1\r\n\r\n[Engine.Input]\r\nAaa=bb\r\nF=Use\r\n\r\n[Other]\r\nY=2\r\n'
        out = live.with_keys(text, ['F'])
        self.assertIn('F=mutate UCKey F\r\n', out)
        self.assertNotIn('F=Use', out)
        self.assertIn('Aaa=bb', out)
        self.assertIn('[Other]\r\nY=2', out)
        self.assertEqual(live.with_keys(text, []), text)
        self.assertTrue(live.with_keys('[A]\r\nb=1\r\n', ['K']).endswith('[Engine.Input]\r\nK=mutate UCKey K\r\n'))


class GameClasses(unittest.TestCase):
    def test_the_game_does_it(self):
        for name in ('UCViewMoment.uc', 'UCMutator.uc', 'UCLink.uc'):
            self.assertEqual(*[(f / name).read_text(encoding='utf-8') for f in CLASSES])
        folder = CLASSES[0]
        self.assertIn('"UCL_Key_" $ k', (folder / 'UCMutator.uc').read_text(encoding='utf-8'))
        self.assertIn('verb == "fpmoment"', (folder / 'UCLink.uc').read_text(encoding='utf-8'))
        moment = (folder / 'UCViewMoment.uc').read_text(encoding='utf-8')
        for prop in fpmoments.props_of('X', MOMENT):
            self.assertRegex(moment, r'(?m)^var\(\)\s+\w+\s+%s(\[\d+\])?;' % prop.split('(')[0], prop)


if __name__ == '__main__':
    unittest.main()
