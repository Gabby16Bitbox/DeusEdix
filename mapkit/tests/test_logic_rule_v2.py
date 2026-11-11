"""The Logic runtime v2's rules (editor/links.py blocks, P6): a rule that needs more than a UCLink can do becomes a
UCRule (its other causes UCRuleAlso actors that set it off), every other rule stays the UCLink it was. Its Otherwise
runs after a jump past the main list (ElseAt); an action with its own conditions gets a check step that skips only
it; again / max / cooldown / talkBusy / match any are its properties; ActId names each step for the logic log.
The game's side is UCRule.uc / UCRuleAlso.uc; the page's static/logic-sim.js."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402
import logic_compile  # noqa: E402


def built(**rule):
    link = dict(dict(id='L1', src='Button1', when='used'), **rule)
    return links.blocks({'links': [link]})


def one(blocks, cls):
    found = [b for b in blocks if b['cls'] == cls]
    assert len(found) == 1, [b['cls'] for b in blocks]
    return found[0]['props']


def acts(props):
    return [props['Act(%d)' % i].strip('"') for i in range(24) if 'Act(%d)' % i in props]


class StaysAUCLink(unittest.TestCase):
    def test_a_plain_rule_is_the_UCLink_it_was(self):
        b = built(do=[{'verb': 'message', 'a': 'Late', 'delay': 2}, {'verb': 'open', 'target': 'Door1', 'delay': 0}])
        self.assertEqual([x['cls'] for x in b], ['UCLink'])
        p = b[0]['props']
        self.assertNotIn('bSteps', p)
        self.assertEqual(acts(p), ['0|open|Door1|||', '2|message||Late||'])
        self.assertEqual(logic_compile.built_rules(b), ['L1'])

    def test_an_action_with_its_own_conditions_is_skipped_alone(self):
        p = one(built(do=[{'verb': 'open', 'target': 'Door1', 'delay': 1, 'requires': [{'flag': 'Key'}]},
                          {'verb': 'message', 'a': 'After', 'delay': 3}]), 'UCLink')
        self.assertEqual(p['bSteps'], 'True')
        self.assertEqual(p['StepCond(0)'], '"flag|Key|1"')
        # the check carries the wait; failing, it goes past the action (index 2); the message 2 s later
        self.assertEqual(acts(p), ['1|check|all|0|1|2', '0|open|Door1|||', '2|message||After||'])


class BecomesAUCRule(unittest.TestCase):
    def test_other_causes_set_the_rule_off(self):
        b = built(do=[{'verb': 'open', 'target': 'Door1'}],
                  also=[{'src': 'Button2', 'when': 'used'}, {'src': 'Lever1', 'when': 'used'}])
        self.assertEqual(sorted(x['cls'] for x in b), ['UCRule', 'UCRuleAlso', 'UCRuleAlso'])
        main = one(b, 'UCRule')
        self.assertEqual(main['Rule'], '"L1"')
        self.assertEqual(main['bSteps'], 'True')
        also = [x for x in b if x['cls'] == 'UCRuleAlso']
        self.assertEqual([x['name'] for x in also], ['UCRuleAlso_L1_1', 'UCRuleAlso_L1_2'])
        self.assertEqual([x['props']['Source'] for x in also], ['"Button2"', '"Lever1"'])
        self.assertTrue(all(x['props']['Main'] == '"UCLink_L1"' and x['props']['Rule'] == '"L1"' for x in also))
        self.assertTrue(all('Act(0)' not in x['props'] for x in also))
        self.assertEqual(logic_compile.built_rules(b), ['L1'])

    def test_otherwise_after_a_jump_past_the_main_list(self):
        p = one(built(requires=[{'flag': 'Power'}],
                      do=[{'verb': 'open', 'target': 'Door1', 'id': 'a1'}],
                      **{'else': [{'verb': 'message', 'a': 'No power', 'delay': 1, 'id': 'a2'}]}), 'UCRule')
        self.assertEqual(acts(p), ['0|open|Door1|||', '0|jump|||stop|', '1|message||No power||'])
        self.assertEqual(p['ElseAt'], '2')
        self.assertEqual(p['Cond(0)'], '"flag|Power|1"')
        self.assertEqual((p['ActId(0)'], p['ActId(2)']), ('"a1"', '"a2"'))
        self.assertNotIn('ActId(1)', p)

    def test_the_otherwise_of_a_list_of_steps_waits_from_step_to_step(self):
        # a rule of steps (the editor's lists): its Otherwise too, each delay from the step before (the editor's
        # form edits both the same way: app.js lkElseOf); a rule of timed actions: each at its time
        steps = dict(requires=[{'flag': 'Power'}], do=[{'verb': 'open', 'target': 'Door1'}],
                     **{'else': [{'verb': 'message', 'a': 'One', 'delay': 1}, {'verb': 'message', 'a': 'Two', 'delay': 1}]})
        self.assertEqual(acts(one(built(steps=True, **steps), 'UCRule'))[2:], ['1|message||One||', '1|message||Two||'])
        timed = dict(steps, **{'else': [{'verb': 'message', 'a': 'One', 'delay': 1}, {'verb': 'message', 'a': 'Two', 'delay': 3}]})
        self.assertEqual(acts(one(built(**timed), 'UCRule'))[2:], ['1|message||One||', '2|message||Two||'])

    def test_its_properties(self):
        p = one(built(match='any', requires=[{'flag': 'A'}, {'flag': 'B'}], again='each', max=3, cooldown=2.5,
                      talkBusy='wait', do=[{'verb': 'message', 'a': 'Hi'}]), 'UCRule')
        self.assertEqual((p['bAny'], p['Again'], p['MaxRuns'], p['Cooldown'], p['TalkBusy']),
                         ('True', 'each', '3', '2.500000', 'wait'))
        self.assertNotIn('ElseAt', p)

    def test_an_action_on_what_set_it_off(self):
        p = one(built(do=[{'verb': 'hide', 'target': '@by'}]), 'UCRule')
        self.assertTrue(acts(p)[0].startswith('0|hide|@by|'), acts(p))

    def test_a_list_of_steps_keeps_its_ids(self):
        p = one(built(steps=True, again='restart', do=[
            {'verb': 'if', 'requires': [{'flag': 'A'}], 'id': 's1'},
            {'verb': 'message', 'a': 'A', 'id': 's2'},
            {'verb': 'end', 'id': 's3'}]), 'UCRule')
        self.assertEqual(acts(p), ['0|check|all|0|1|2', '0|message||A||'])
        self.assertEqual((p['ActId(0)'], p['ActId(1)']), ('"s1"', '"s2"'))

    def test_a_watched_other_cause_has_a_tag_of_its_own(self):
        b = links.blocks({'links': [{'id': 'R9', 'src': 'Crate3', 'when': 'damaged', 'below': 0, 'do': [{'verb': 'hide', 'target': '@it'}],
                                     'also': [{'src': 'Crate4', 'when': 'damaged', 'below': 50}]}]})
        main, also = one(b, 'UCRule'), one(b, 'UCRuleAlso')
        self.assertEqual((main['Tag'], also['Tag']), ('UCLW_R9', 'UCLW_R9_1'))
        self.assertEqual((main['Watch'], also['Watch']), ('"HitPoints down"', '"HitPoints<%50"'))
        self.assertEqual((also['Rule'], also['Source'], also['bWatchProp']), ('"R9"', '"Crate4"', 'True'))

    def test_ignore_is_the_default_and_not_written(self):
        b = built(again='ignore', do=[{'verb': 'message', 'a': 'Hi'}])
        self.assertEqual([x['cls'] for x in b], ['UCLink'])


if __name__ == '__main__':
    unittest.main()
