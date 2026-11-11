"""The condition "the player is near a point" (P5): {'type': 'near', 'at': [x, y, z], 'radius': r, 'is': True}, one
model for rules and the Story (conditions.py). It is checked, written for the game in whole units
(near|x|y|z|r|1, UCEditorStory.Holds: the same Near() the Story's "JC gets close to a point" uses), turned round,
built as a rule's cause (becomes) and condition, and compiled into a Story event's conditions."""
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT)]
import conditions  # noqa: E402
import links  # noqa: E402
import story  # noqa: E402

NEAR = {'type': 'near', 'at': [1200.4, -340, 48], 'radius': 300, 'is': True}


class NearPoint(unittest.TestCase):
    def test_checked_and_written_for_the_game(self):
        self.assertEqual(conditions.check([NEAR]), [NEAR])
        self.assertEqual(conditions.encode(NEAR), 'near|1200|-340|48|300|1')
        self.assertEqual(conditions.encode({'type': 'near', 'at': [0, 0, 0]}), 'near|0|0|0|256|1')
        self.assertEqual(conditions.encode(conditions.negate(NEAR)), 'near|1200|-340|48|300|0')
        self.assertEqual(conditions.unreal(NEAR), 'Holds("near|1200|-340|48|300|1")')
        for bad in ({'type': 'near'}, {'type': 'near', 'at': [0, 0]}, {'type': 'near', 'at': [0, 'x', 0]},
                    {'type': 'near', 'at': [0, 0, 0], 'radius': 0}, {'type': 'near', 'at': [0, 0, float('nan')]},
                    {'type': 'near', 'at': [0, 0, True]}):
            with self.assertRaises(ValueError):
                conditions.check([bad])

    def test_a_rule_hears_it_and_checks_it(self):
        rule = {'id': 'L2', 'src': '', 'when': 'becomes', 'watch': NEAR, 'watchStart': True, 'once': True, 'at': [0, 0, 0],
                'requires': [dict(NEAR, at=[0, 0, 0], radius=64, **{'is': False})],
                'do': [{'delay': 0, 'verb': 'message', 'a': 'Here'}]}
        built = {b['name']: b for b in links.blocks({'links': [rule]})}
        p = built['UCLink_L2']['props']
        self.assertEqual(p['Watch'], '"near|1200|-340|48|300|1"')
        self.assertEqual(p['Cond(0)'], '"near|0|0|0|64|0"')

    def test_a_story_event_checks_it(self):
        st = {'dialogues': [], 'infolinks': [], 'events': [
            {'id': 'e1', 'title': 'Both', 'when': {'type': 'start'}, 'once': True, 'requires': [NEAR],
             'do': [{'type': 'message', 'text': 'hi'}]}]}
        code = story.generate('01_Test', st)
        self.assertIn('Holds("near|1200|-340|48|300|1")', code)

    def test_the_game_reads_it(self):
        # the template's Holds knows the kind, and builds the point from the fields (vect() takes constants only)
        uc = (KIT / 'project-template' / 'src' / 'DeusEdix' / 'Classes' / 'UCEditorStory.uc').read_text(encoding='utf-8')
        body = uc[uc.index('function bool Holds('):uc.index('function bool Compare(')]
        self.assertIn('kind == "near"', body)
        self.assertIn('return Near(spot, float(Field(c, 4))) == (Field(c, 5) != "0");', body)


if __name__ == '__main__':
    unittest.main()
