"""P3's rules that hold "while" on the editor's Python side (links.expand_while): a rule with while=True gets a second
rule, `<id>_until`, set off by the paired cause of the same object (logic.json outputs' "until": the player walks
out, the door starts closing; a script's port by untilPorts: Enter_Alarm, Leave_Alarm; a condition by its opposite:
conditions.negate) that undoes its steps in the opposite order, at once (the inverse verbs, a state set back), after
stopping the rule when it has something still to come. A "while" on a condition runs at the map's start too when it
already holds (UCLink.bWatchStart), and so does its end. The page's side is static/logic-sim.js
(tests/test_logic_while.mjs)."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import conditions  # noqa: E402
import links  # noqa: E402
import logic_catalog  # noqa: E402


def built(*rules):
    return {b['name']: b['props'] for b in links.blocks({'links': list(rules)}) if b['cls'] in ('UCLink', 'UCRule', 'UCRuleAlso')}


class Opposites(unittest.TestCase):
    def test_a_condition_and_its_opposite(self):
        self.assertEqual(conditions.negate({'flag': 'Power', 'is': True}), {'flag': 'Power', 'is': False})
        self.assertEqual(conditions.negate({'flag': 'Power'}), {'flag': 'Power', 'is': False})
        self.assertEqual(conditions.negate({'type': 'item', 'item': 'Key', 'has': False})['has'], True)
        self.assertEqual(conditions.negate({'type': 'counter', 'counter': 'Kills', 'op': '>=', 'value': 3})['op'], '<')
        self.assertEqual(conditions.negate({'type': 'credits', 'op': '==', 'value': 3})['op'], '!=')
        self.assertIsNone(conditions.negate('nonsense'))

    def test_the_paired_port_of_a_script(self):
        self.assertEqual(logic_catalog.until_port('Reached'), 'Lost')
        self.assertEqual(logic_catalog.until_port('Enter_Alarm'), 'Leave_Alarm')
        self.assertEqual(logic_catalog.until_port('Enter_'), '')
        self.assertEqual(logic_catalog.until_port('Done'), '')

    def test_every_until_is_an_output(self):
        for when, entry in logic_catalog.OUTPUTS.items():
            if entry.get('until'):
                self.assertIn(entry['until'], logic_catalog.OUTPUTS, when)

    def test_what_ends_a_cause(self):
        self.assertEqual(links.until_of({'src': 'Zone1', 'when': 'enter'}), {'src': 'Zone1', 'when': 'leave'})
        self.assertEqual(links.until_of({'src': 'Door1', 'when': 'opened'})['when'], 'closed')
        self.assertEqual(links.until_of({'src': 'P1', 'when': 'output', 'port': 'Enter_Alarm'})['port'], 'Leave_Alarm')
        self.assertEqual(links.until_of({'when': 'becomes', 'watch': {'flag': 'A'}})['watch'], {'flag': 'A', 'is': False})
        self.assertIsNone(links.until_of({'src': 'Button1', 'when': 'used'}))
        self.assertIsNone(links.until_of({'when': 'becomes', 'watch': {'flag': ''}}), 'a condition not chosen yet')

    def test_what_undoes_a_step(self):
        self.assertEqual(links.undo_of({'verb': 'open', 'target': 'Door1', 'delay': 3, 'id': 'a1'}),
                         {'verb': 'close', 'target': 'Door1', 'delay': 0, 'id': 'ua1'})
        self.assertEqual(links.undo_of({'verb': 'flag', 'a': 'Inside', 'b': '1', 'id': 'a2'})['b'], '0')
        self.assertEqual(links.undo_of({'verb': 'flag', 'a': 'Inside', 'b': '0', 'id': 'a2'})['b'], '1')
        self.assertIsNone(links.undo_of({'verb': 'flag', 'a': 'UCFate1a2b3c_Guard1_Dead', 'b': '1'}), 'a fate stays')
        self.assertIsNone(links.undo_of({'verb': 'message', 'a': 'Hi'}))
        self.assertIsNone(links.undo_of({'verb': 'wait', 'until': {}}))
        undo = links.undo_of({'verb': 'unlock', 'target': 'Door1', 'requires': [{'flag': 'X'}]})
        self.assertNotIn('requires', undo, 'it is undone whatever its check said')


class While(unittest.TestCase):
    def test_walking_out_of_a_zone_undoes_it_in_the_opposite_order(self):
        b = built(dict(id='W1', src='Zone1', when='enter', **{'while': True}, do=[
            {'verb': 'flag', 'a': 'Inside', 'b': '1', 'id': 'a1'},
            {'verb': 'lighton', 'target': 'Lamp1', 'delay': 2, 'id': 'a2'},
            {'verb': 'message', 'a': 'In', 'id': 'a3'}]))
        end = b['UCLink_W1_until']
        self.assertEqual((end['When'], end['Tag'], end['Source']), ('leave', 'UCL_Zone1', '"Zone1"'))
        self.assertEqual([end['Act(%d)' % i] for i in range(3)],
                         ['"0|cancel||W1||"', '"0|lightoff|Lamp1|||"', '"0|flag||Inside|0|"'])
        self.assertNotIn('Act(3)', end, 'a message is not undone')
        self.assertNotIn('bWatchStart', b['UCLink_W1'])

    def test_no_cancel_when_nothing_is_still_to_come(self):
        b = built(dict(id='W1', src='Door1', when='opened', **{'while': True}, do=[{'verb': 'lighton', 'target': 'Lamp1'}]))
        self.assertEqual(b['UCLink_W1_until']['When'], 'closed')
        self.assertEqual(b['UCLink_W1_until']['Act(0)'], '"0|lightoff|Lamp1|||"')

    def test_a_condition_while_it_holds_from_the_start(self):
        b = built(dict(id='W2', when='becomes', watch={'flag': 'Power', 'is': True}, **{'while': True},
                       do=[{'verb': 'open', 'target': 'Door1'}]))
        self.assertEqual((b['UCLink_W2']['Watch'], b['UCLink_W2']['bWatchStart']), ('"flag|Power|1"', 'True'))
        self.assertEqual((b['UCLink_W2_until']['Watch'], b['UCLink_W2_until']['bWatchStart']), ('"flag|Power|0"', 'True'))
        self.assertEqual(b['UCLink_W2_until']['Act(0)'], '"0|close|Door1|||"')

    def test_a_phase_of_a_script(self):
        b = built(dict(id='W3', src='Phases1', when='output', port='Enter_Alarm', **{'while': True},
                       do=[{'verb': 'hostile', 'target': 'Guard1'}]))
        self.assertIn('UCLink_W3_until', b)
        self.assertEqual(b['UCLink_W3_until']['Act(0)'], '"0|friend|Guard1|||"')

    def test_nothing_to_end_it_or_nothing_to_undo_builds_no_second_rule(self):
        b = built(dict(id='W4', src='Button1', when='used', **{'while': True}, do=[{'verb': 'open', 'target': 'Door1'}]),
                  dict(id='W5', src='Zone1', when='enter', **{'while': True}, do=[{'verb': 'message', 'a': 'Hi'}]),
                  dict(id='W6', src='Zone1', when='enter', do=[{'verb': 'open', 'target': 'Door1'}]))
        self.assertEqual(sorted(b), ['UCLink_W4', 'UCLink_W5', 'UCLink_W6'])

    def test_other_causes_end_with_their_pairs(self):
        b = built(dict(id='W7', src='Zone1', when='enter', **{'while': True}, also=[{'src': 'Zone2', 'when': 'enter'}],
                       do=[{'verb': 'lighton', 'target': 'Lamp1'}]))
        self.assertEqual(b['UCLink_W7_until']['When'], 'leave')
        self.assertEqual((b['UCRuleAlso_W7_until_1']['When'], b['UCRuleAlso_W7_until_1']['Source']), ('leave', '"Zone2"'))
        self.assertEqual(b['UCRuleAlso_W7_until_1']['Main'], '"UCLink_W7_until"')


if __name__ == '__main__':
    unittest.main()
