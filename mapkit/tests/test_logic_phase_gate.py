"""P3's rules kept to some phases of a Phases block (link.phase = {set: the block's name, in: its phases' flag names}):
links.phase_gate writes UCLink.PhaseGate = "<the block's counter>|<the phases' numbers>" (UCBPhases keeps the phase
now in the counter <StateName>), which UCLink.RunRule / UCRule.Start check before anything else: out of those phases
the rule does nothing, its Otherwise neither. A block not in the map (or deleted) gives "?|", no phase ticked
"<counter>|": the rule never runs, and the Logic window's "To check" says so. The page's side is static/logic-sim.js
(tests/test_logic_phase_gate.mjs)."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402
import statecatalog  # noqa: E402

PHASES = {'name': 'Ph1', 'cls': 'UCBPhases', 'loc': [0, 0, 0], 'props': {'Phases': '"Calm, Red alert, Escape, calm"', 'StateName': '"Raid"'}}


def built(*rules, **more):
    e = dict({'added': [PHASES], 'links': list(rules)}, **more)
    return {b['name']: b['props'] for b in links.blocks(e) if b['cls'] in ('UCLink', 'UCRule', 'UCRuleAlso')}


def rule(rid, phase, **more):
    return dict({'id': rid, 'src': 'Button1', 'when': 'used', 'phase': phase, 'do': [{'verb': 'message', 'a': 'x'}]}, **more)


class PhaseSets(unittest.TestCase):
    def test_the_phases_blocks_of_the_map(self):
        self.assertEqual(statecatalog.phase_sets({'added': [PHASES]}),
                         {'Ph1': {'root': 'Raid', 'phases': ['Calm', 'Red_alert', 'Escape']}})
        e = {'added': [dict(PHASES, props={'Phases': '"A, B"'})], 'props': {'Ph1': {'StateName': '"Base 2"'}}}
        self.assertEqual(statecatalog.phase_sets(e)['Ph1']['root'], 'Base_2', 'the Inspector over the placed one')
        self.assertEqual(statecatalog.phase_sets({'added': [dict(PHASES, props={'Phases': '"A"'})]})['Ph1']['root'], 'Phase')
        self.assertEqual(statecatalog.phase_sets(None), {})


class Gate(unittest.TestCase):
    SETS = {'Ph1': {'root': 'Raid', 'phases': ['Calm', 'Red_alert', 'Escape']}}

    def test_the_gate(self):
        self.assertEqual(links.phase_gate({'set': 'Ph1', 'in': ['Escape', 'red_ALERT']}, self.SETS), 'Raid|2,3')
        self.assertEqual(links.phase_gate({'set': 'Ph1', 'in': []}, self.SETS), 'Raid|')
        self.assertEqual(links.phase_gate({'set': 'Ph1', 'in': ['Nowhere']}, self.SETS), 'Raid|')
        self.assertEqual(links.phase_gate({'set': 'Ph9', 'in': ['Calm']}, self.SETS), '?|')
        self.assertEqual(links.phase_gate(None, self.SETS), '')
        self.assertEqual(links.phase_gate({'in': ['Calm']}, self.SETS), '')

    def test_a_rule_and_a_rule_of_the_runtime_v2_carry_it(self):
        b = built(rule('P1', {'set': 'Ph1', 'in': ['Red_alert']}),
                  rule('P2', {'set': 'Ph1', 'in': ['Calm', 'Escape']}, cooldown=2, also=[{'src': 'Button2', 'when': 'used'}]),
                  rule('P3', None))
        self.assertEqual(b['UCLink_P1']['PhaseGate'], '"Raid|2"')
        self.assertEqual(b['UCLink_P2']['PhaseGate'], '"Raid|1,3"')
        self.assertNotIn('PhaseGate', b['UCRuleAlso_P2_1'], 'its other causes start the rule, which checks it')
        self.assertNotIn('PhaseGate', b['UCLink_P3'])

    def test_a_deleted_block_never_lets_it_run(self):
        b = built(rule('P1', {'set': 'Ph1', 'in': ['Calm']}), deleted={'Ph1': True})
        self.assertEqual(b['UCLink_P1']['PhaseGate'], '"?|"')

    def test_a_while_rule_kept_to_phases_is_undone_in_any(self):
        b = built(dict(id='W1', src='Zone1', when='enter', phase={'set': 'Ph1', 'in': ['Calm']}, **{'while': True},
                       do=[{'verb': 'lighton', 'target': 'Lamp1'}]))
        self.assertEqual(b['UCLink_W1']['PhaseGate'], '"Raid|1"')
        self.assertNotIn('PhaseGate', b['UCLink_W1_until'])


if __name__ == '__main__':
    unittest.main()
