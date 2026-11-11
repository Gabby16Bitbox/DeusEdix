"""Turn into script (P8 slice 6, editor/rulescript.py): rules written as a UCScript doing what they did (Act, Holds,
After/Step), the rules it cannot do yet refused in words, and the build leaving out the rules a script does now."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import links  # noqa: E402
import rulescript  # noqa: E402
import scripts  # noqa: E402


def rule(**kw):
    base = dict(id='L1', src='Button1', when='used', do=[dict(verb='open', target='Door1')])
    base.update(kw)
    return base


class Written(unittest.TestCase):
    def test_what_the_rule_did(self):
        e = {'links': [rule(id='L7', label='Button1 used', once=True, requires=[{'flag': 'Alarm', 'is': False}],
                            do=[dict(verb='open', target='Door1'), dict(verb='message', a='Hi "you" \\ there'),
                                dict(verb='close', target='Door1', delay=3),
                                dict(verb='goto', target='Rossi', at=[1, 2, 3], delay=1.5)])]}
        out = rulescript.script_of(e, ['L7'], 'DoorScript', 'Lab')
        t = out['text']
        self.assertEqual(out['rules'], ['L7'])
        self.assertIn('class DoorScript extends UCScript;', t)
        self.assertIn('case "L7":\n\t\tL7();', t)
        self.assertIn('if (!Holds("flag|Alarm|0"))', t)
        self.assertIn('if (bL7Done)', t)
        self.assertIn('var bool bL7Done;', t)
        self.assertIn('Act("open", "Door1");', t)
        self.assertIn('Act("message", "", "Hi \'you\' \\\\ there");', t)     # quotes plain, the backslash escaped
        # later steps at their times from the start, in time order, the rule busy until the last
        self.assertLess(t.index("After(1.5, 'L7_1')"), t.index("After(3.0, 'L7_2')"))
        self.assertIn("case 'L7_1':\n\t\tAct(\"goto\", \"Rossi\", \"1.0\", \"2.0\", \"3.0\");", t)
        self.assertIn('L7Until = Level.TimeSeconds + 3.0;', t)
        self.assertIn('Inputs(0)=(Id="L7",Label="Do what L7 did")', t)
        # the same action strings as the rule's own build (UCLink.Act)
        built = [b for b in links.blocks(e) if b['cls'] == 'UCLink'][0]['props']
        self.assertIn('"0|open|Door1|||"', built.values())

    def test_a_rule_with_nothing_later_has_no_step(self):
        t = rulescript.script_of({'links': [rule()]}, ['L1'], 'One')['text']
        self.assertNotIn('function Step', t)
        self.assertNotIn('Until', t)
        self.assertNotIn('bL1Done', t)

    def test_what_it_cannot_do_yet_in_words(self):
        e = {'links': [rule(id='L1', also=[dict(src='Button2', when='used')]),
                       rule(id='L2', otherwiseOf='L3'), rule(id='L3'),
                       rule(id='L4', steps=True, do=[dict(verb='if'), dict(verb='open', target='Door1'), dict(verb='end')]),
                       rule(id='L5', do=[dict(verb='ownorders', target='Rossi')]),
                       rule(id='L6', replacedBy={'script': 'Old', 'object': 'Old0', 'rule': 'L9'}),
                       rule(id='L8', do=[])]}
        out = rulescript.script_of(e, ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L8', 'L99'], 'Nope')
        why = {x['id']: x['why'] for x in out['refused']}
        self.assertEqual(out['rules'], [])
        self.assertEqual(out['text'], '')
        self.assertIn('Or when', why['L1'])
        self.assertIn('If not', why['L2'])
        self.assertIn('If not', why['L3'])
        self.assertIn('steps', why['L4'])
        self.assertIn('own orders', why['L5'])
        self.assertIn('Old', why['L6'])
        self.assertIn('nothing', why['L8'])
        self.assertIn('no such rule', why['L99'])

    def test_at_most_eight(self):
        e = {'links': [rule(id='L%d' % i, src='B%d' % i) for i in range(1, 11)]}
        out = rulescript.script_of(e, ['L%d' % i for i in range(1, 11)], 'Many')
        self.assertEqual(len(out['rules']), 8)
        self.assertEqual([x['id'] for x in out['refused']], ['L9', 'L10'])

    def test_the_name(self):
        with self.assertRaises(ValueError):
            rulescript.script_of({'links': [rule()]}, ['L1'], '9bad')


class Built(unittest.TestCase):
    def test_the_build_leaves_out_what_a_script_does(self):
        e = {'links': [rule(id='L1', replacedBy={'script': 'S', 'object': 'S0', 'rule': 'L2'}),
                       dict(id='L2', src='Button1', when='used', do=[dict(verb='input', target='S0', a='L1')])]}
        made = [b for b in links.blocks(e) if b['cls'] == 'UCLink']
        self.assertEqual([b['name'] for b in made], ['UCLink_L2'])
        self.assertIn('"0|input|S0|L1||"', made[0]['props'].values())
        self.assertIn('  EDIT interaction L1: done by the script S', links.report(e))


class Saved(unittest.TestCase):
    def test_write_saves_a_new_script(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(scripts, 'CLASSES', Path(d)):
            out = rulescript.write({'links': [rule()]}, ['L1'], '', 'Lab')
            self.assertEqual(out['name'], 'RulesScript')
            self.assertTrue(out['saved'])
            self.assertTrue((Path(d) / 'RulesScript.uc').is_file())
            self.assertEqual(rulescript.free_name(), 'RulesScript2')
            with self.assertRaisesRegex(ValueError, 'already'):
                rulescript.write({'links': [rule()]}, ['L1'], 'RulesScript')
            peek = rulescript.write({'links': [rule()]}, ['L1'], 'Peek', preview=True)
            self.assertFalse(peek['saved'])
            self.assertFalse((Path(d) / 'Peek.uc').exists())
            self.assertEqual(scripts.ports('RulesScript')['inputs'][0]['id'], 'L1')


if __name__ == '__main__':
    unittest.main()
