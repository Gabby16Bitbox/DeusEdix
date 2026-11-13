"""Logic runtime v2's compiler (editor/links.py step_items): a rule that is a list of steps (link['steps']) becomes a
UCLink with bSteps, its actions in their order with each delay from the step before; If -> a check step that fails
to its Otherwise or its End, Otherwise -> a jump past the other branch, Wait until -> an until step, the conditions
in StepCond. The game's side is UCLink.uc's DoStep / CheckStep / UntilDone; the page's is static/logic-sim.js."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402


def compiled(do, **more):
    link = dict(dict(id='L1', src='Button1', when='used', steps=True), do=do, **more)
    return [b['props'] for b in links.blocks({'links': [link]}) if b['cls'] == 'UCLink']


def acts(props):
    return [props['Act(%d)' % i].strip('"') for i in range(24) if 'Act(%d)' % i in props]


class Steps(unittest.TestCase):
    def test_if_otherwise_end_and_wait_until(self):
        [p] = compiled([
            {'verb': 'message', 'a': 'Hi', 'delay': 0},
            {'verb': 'if', 'requires': [{'flag': 'A', 'is': True}]},
            {'verb': 'open', 'target': 'Door1', 'delay': 1},
            {'verb': 'else'},
            {'verb': 'message', 'a': 'No'},
            {'verb': 'end'},
            {'verb': 'wait', 'until': {'type': 'arrived', 'actor': 'Guard1'}, 'max': 20},
            {'verb': 'message', 'a': 'There', 'delay': 2}])
        self.assertEqual(p['bSteps'], 'True')
        self.assertEqual(p['StepCond(0)'], '"flag|A|1"')
        self.assertEqual(acts(p), ['0|message||Hi||', '0|check|all|0|1|4', '1|open|Door1|||', '0|jump|||5|',
                                   '0|message||No||', '0|until|Guard1|arrived|20|', '2|message||There||'])

    def test_an_if_with_no_otherwise_fails_past_it_and_any_of(self):
        [p] = compiled([
            {'verb': 'if', 'match': 'any', 'requires': [{'flag': 'A'}, {'type': 'counter', 'counter': 'K', 'op': '>=', 'value': 2}]},
            {'verb': 'message', 'a': 'Yes'},
            {'verb': 'end'},
            {'verb': 'message', 'a': 'Always'}])
        self.assertEqual(acts(p), ['0|check|any|0|2|2', '0|message||Yes||', '0|message||Always||'])
        self.assertEqual([p['StepCond(0)'], p['StepCond(1)']], ['"flag|A|1"', '"count|K|>=|2"'])

    def test_nested_ifs_and_an_if_left_open(self):
        [p] = compiled([
            {'verb': 'if', 'requires': [{'flag': 'A'}]},
            {'verb': 'if', 'requires': [{'flag': 'B'}]},
            {'verb': 'message', 'a': 'A and B'},
            {'verb': 'end'},
            {'verb': 'else'},
            {'verb': 'message', 'a': 'not A'}])
        self.assertEqual(acts(p), ['0|check|all|0|1|4', '0|check|all|1|1|3', '0|message||A and B||', '0|jump|||stop|',
                                   '0|message||not A||'])

    def test_wait_until_a_condition_and_plain_waits(self):
        [p] = compiled([
            {'verb': 'message', 'a': 'Go'},
            {'verb': 'wait', 'until': {'type': 'counter', 'counter': 'Keys', 'op': '>=', 'value': 3}, 'max': 0},
            {'verb': 'wait', 'delay': 1.5},
            {'verb': 'message', 'a': 'Done'}])
        self.assertEqual(acts(p), ['0|message||Go||', '0|until||cond|0|0', '1.5|wait||||', '0|message||Done||'])
        self.assertEqual(p['StepCond(0)'], '"count|Keys|>=|3"')

    def test_the_mistakes_say_their_rule(self):
        for steps, words in (([{'verb': 'else'}, {'verb': 'message', 'a': 'x'}], 'Otherwise'),
                             ([{'verb': 'end'}, {'verb': 'message', 'a': 'x'}], 'End'),
                             ([{'verb': 'if', 'requires': [{'flag': 'B%d' % i} for i in range(9)]}, {'verb': 'message', 'a': 'x'}], 'conditions')):
            with self.assertRaises(ValueError) as caught:
                compiled(steps)
            self.assertIn('L1', str(caught.exception))
            self.assertIn(words, str(caught.exception))

    def test_a_rule_of_before_runs_as_before(self):
        [p] = compiled([{'verb': 'message', 'a': 'B', 'delay': 2}, {'verb': 'message', 'a': 'A', 'delay': 0}], steps=False)
        self.assertNotIn('bSteps', p)
        self.assertEqual(acts(p), ['0|message||A||', '2|message||B||'])

    def test_an_if_without_steps_is_a_list_of_steps(self):
        # 13 Nov 2026, Deep Ops: a rule with If / Otherwise / End but no `steps` was built without them (both ran)
        [p] = compiled([{'verb': 'if', 'requires': [{'flag': 'A', 'is': True}]}, {'verb': 'message', 'a': 'Yes'},
                        {'verb': 'else'}, {'verb': 'message', 'a': 'No'}, {'verb': 'end'}], steps=False)
        self.assertEqual(p['bSteps'], 'True')
        self.assertEqual(acts(p), ['0|check|all|0|1|3', '0|message||Yes||', '0|jump|||4|', '0|message||No||'])

    def test_only_checks_and_waits_build_nothing(self):
        self.assertEqual(compiled([{'verb': 'if', 'requires': [{'flag': 'A'}]}, {'verb': 'end'}, {'verb': 'message', 'a': ''}])[0]['bSteps'], 'True')
        self.assertEqual(links.blocks({'links': [dict(id='L1', src='B', when='used', steps=True,
                                                      do=[{'verb': 'wait', 'delay': 1}])]}), [])


if __name__ == '__main__':
    unittest.main()
