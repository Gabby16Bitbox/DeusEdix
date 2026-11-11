"""P5, the Story's action rows use the rules' verbs: a Story action {"type": "act", "act": {verb, target, a, b, c, at,
nav...}} (the rules' own fields, drawn by the rules' own rows: app.js lkStoryActs) is written as a rule's Act text
(links.act_string) and done in the game as a rule does it: UCEditorStory.RunAct gives it to one UCLink with no cause of
its own (UCLink.DoAct), the logic log naming story:<event, dialogue or InfoLink id>. DeusEdix projects only: the mod's
own classes have no RunAct yet. The page's side: tests/test_story_verbs.mjs."""
import os
import re
import sys
import unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import settings  # noqa: E402
import story  # noqa: E402

UC = os.path.join(HERE, '..', 'project-template', 'src', 'DeusEdix', 'Classes', 'UCEditorStory.uc')
STORY = {'dialogues': [{'id': 'd1', 'title': 'Gate talk', 'owner': 'Guard1', 'steps': [
    {'type': 'line', 'who': 'npc', 'text': 'Halt.'},
    {'type': 'do', 'do': [{'type': 'act', 'act': {'verb': 'explode', 'target': 'Crate1', 'a': '40', 'b': '200'}}]}, {'type': 'end'}]}],
    'infolinks': [{'id': 'i1', 'title': 'Jock calls', 'caller': 'Jock', 'lines': [{'text': 'Ready.'}],
                   'do': [{'type': 'act', 'act': {'verb': 'giveitem', 'a': 'DeusEx.Medkit', 'b': '2'}}]}],
    'events': [{'id': 'e1', 'title': 'Start', 'when': {'type': 'start'},
                'do': [{'type': 'message', 'text': 'Hi'},
                       {'type': 'act', 'act': {'verb': 'sound', 'target': '', 'a': 'Ambient.Ambient.Alarm1', 'b': '1', 'c': '0', 'delay': 3}},
                       {'type': 'act', 'act': {'verb': 'goto', 'target': 'Guard1', 'at': [10, 20, 30], 'nav': True}}]}]}


class Build(unittest.TestCase):
    def test_the_rules_act_text_done_at_once(self):
        self.assertEqual(story.act_text({'verb': 'sound', 'a': 'Ambient.Ambient.Alarm1', 'b': '1', 'c': '0', 'delay': 3}),
                         '0|sound||Ambient.Ambient.Alarm1|1|0')
        self.assertEqual(story.act_text({'verb': 'goto', 'target': 'Guard1', 'at': [10, 20, 30], 'nav': True}),
                         '0|navgo|Guard1|10.0|20.0|30.0')
        self.assertEqual(story.act_text({'verb': 'count', 'a': 'Keys found', 'b': '2'}), '0|count||Keys_found|2|')
        # one object or none: a group, an area, a tag, a check of its own are the rules' only
        self.assertEqual(story.act_text({'verb': 'open', 'target': 'Door1', 'targetTag': 'x', 'requires': [{'flag': 'A'}]}),
                         '0|open|Door1|||')
        for verb in ('', 'ownorders', 'wait', 'Open', 'if'):
            with self.assertRaises(ValueError):
                story.act_text({'verb': verb})

    def test_each_place_of_the_story_does_it_naming_itself(self):
        with patch.object(settings, 'STANDALONE', True):
            code = story.generate('01_Test', STORY)
        self.assertIn('RunAct("0|explode|Crate1|40|200|", "story:d1");', code)
        self.assertIn('RunAct("0|giveitem||DeusEx.Medkit|2|", "story:i1");', code)
        self.assertIn('RunAct("0|sound||Ambient.Ambient.Alarm1|1|0", "story:e1");', code)
        self.assertIn('RunAct("0|navgo|Guard1|10.0|20.0|30.0", "story:e1");', code)
        # in the event's order, after its message
        self.assertLess(code.index('Message("Hi");'), code.index('RunAct("0|sound|'))
        self.assertLess(code.index('RunAct("0|sound|'), code.index('RunAct("0|navgo|'))

    def test_the_mod_refuses_it_in_words(self):
        with patch.object(settings, 'STANDALONE', False):
            with self.assertRaises(ValueError) as e:
                story.generate('01_Test', STORY)
        self.assertIn('DeusEdix projects', str(e.exception))

    def test_the_game_class_gives_it_to_one_rule(self):
        with open(UC, encoding='latin1') as f:
            uc = f.read()
        body = uc[uc.index('function RunAct(string s, string who)'):]
        body = body[:body.index('\n}\n')]
        self.assertIn("foreach AllActors(class'UCLink', doer, 'UCStoryDoer')", body)
        self.assertIn("doer = Spawn(class'UCLink',, 'UCStoryDoer');", body)
        self.assertIn('doer.Rule = who;', body)
        self.assertIn('doer.DoAct(s);', body)
        self.assertNotIn('\r', uc)
        self.assertFalse(re.search(r'\nvar UCLink', uc), 'no new variable: the lines other tests point at stay put')


if __name__ == '__main__':
    unittest.main()
