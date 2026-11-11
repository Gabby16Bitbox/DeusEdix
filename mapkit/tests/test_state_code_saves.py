"""A saved game made with the last released classes must load with these: the code of a state that waits (UCLink's
Running, UCEdInfoLink's Playing) may only grow after its last wait (state_code.py says why: measured in the game on
10 Nov 2026, a line added at the top of UCLink.Running crashed Revision on loading a save made mid-run, "Unknown code
token 03"; a variable added, or code added after the last wait, loaded and ran on). data/released_state_code.json is
the released prefix: regenerated at each release (python state_code.py <released project-template> <version>)."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
import state_code  # noqa: E402

TEMPLATE = os.path.join(HERE, '..', 'project-template')


class Saves(unittest.TestCase):
    def test_waiting_states_keep_their_released_code(self):
        with open(state_code.RELEASED, encoding='utf-8') as f:
            released = json.load(f)
        now = state_code.template_states(TEMPLATE)
        self.assertTrue(released['states'])
        for key, code in released['states'].items():
            with self.subTest(state=key):
                self.assertIn(key, now, '%s waited in %s: a save made in it needs it' % (key, released['version']))
                got = now[key][:len(code)]
                for i, (a, b) in enumerate(zip(code, got)):
                    self.assertEqual(b, a, '%s changed at its line %d before its last wait: a game saved with %s while '
                                     'it waits there would crash on loading. Put new code after the last wait, or in a '
                                     'function it calls' % (key, i + 1, released['version']))
                self.assertEqual(len(got), len(code), key + ' lost code before its last wait')

    def test_the_reader(self):
        text = ('class X extends Actor;\nfunction F() { Sleep(1); }\nstate A\n{\n\tfunction G() { }\nBegin:\n\t// note\n'
                '\tn = 0;\n\n\tSleep(0.5); // wait\nNext:\n\tif (n < 2)\n\t{\n\t\tn++;\n\t\tGoto(\'Next\');\n\t}\n'
                '\tLog("a // b");\n}\nstate B\n{\nBegin:\n\tDestroy();\n}\n')
        found = state_code.states(text)
        self.assertEqual(sorted(found), ['A'], 'B does not wait')
        self.assertEqual(found['A'][:4], ['Begin:', 'n = 0;', 'Sleep(0.5);', 'Next:'])
        self.assertIn('Log("a // b");', found['A'], 'a // inside quotes is no comment')
        self.assertEqual(state_code.frozen(found['A']), ['Begin:', 'n = 0;', 'Sleep(0.5);'])

    def test_a_change_before_the_last_wait_is_seen(self):
        code = ['Begin:', 'Step = 0;', 'Sleep(1);', 'Goto(\'Begin\');']
        frozen = state_code.frozen(code)
        self.assertNotEqual(['Begin:', 'n = 1;', 'Step = 0;', 'Sleep(1);'][:len(frozen)], frozen)
        self.assertEqual((code + ['Log("added");'])[:len(frozen)], frozen, 'after the last wait: free')


if __name__ == '__main__':
    unittest.main()
