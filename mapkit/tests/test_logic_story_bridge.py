"""P5 slice 1, the Story bridge, on the editor's Python side: a rule's "Start a dialogue" / "Play an InfoLink" is a
UCLink action "talk|<id>" / "infolink|<id>" (links.py), and the map's story class answers it (story.py
RunStoryAction, which the template's UCEditorStory declares and UCLink.StoryAction asks). Its PlayInfo_<id> say
whether the InfoLink played. The page's side: tests/test_logic_story_bridge.mjs."""
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402
import logic_catalog  # noqa: E402
import story  # noqa: E402

CLASSES = os.path.join(HERE, '..', 'project-template', 'src', 'DeusEdix', 'Classes')
STORY = {'dialogues': [{'id': 'd1', 'title': 'Gate talk', 'owner': 'Guard1', 'steps': [{'type': 'line', 'who': 'owner', 'text': 'Halt.'}]},
                       {'id': 'd2', 'title': 'Old', 'owner': 'Guard2', 'disabled': True, 'steps': []}],
         'infolinks': [{'id': 'i1', 'title': 'Jock calls', 'caller': 'Jock', 'lines': [{'text': 'Ready.'}]},
                       {'id': 'i2', 'title': 'Again', 'caller': 'Jock', 'once': False, 'lines': [{'text': 'Again.'}]}]}


def source(cls):
    with open(os.path.join(CLASSES, cls + '.uc'), encoding='latin1') as f:
        return f.read()


class Actions(unittest.TestCase):
    def test_the_actions_are_the_story_id(self):
        self.assertEqual(links.act_string({'verb': 'talk', 'a': 'd1'}), '0|talk||d1||')
        self.assertEqual(links.act_string({'verb': 'infolink', 'a': 'i1', 'delay': 2}), '2|infolink||i1||')
        self.assertEqual(links.act_string({'verb': 'infolink', 'a': 'i 1'}), '0|infolink||||', 'no Story id: the game says "noname"')
        for verb in ('talk', 'infolink'):
            self.assertIn(verb, logic_catalog.FREE)

    def test_a_rule_with_them_is_built(self):
        b = {x['name']: x['props'] for x in links.blocks({'links': [
            {'id': 'L1', 'src': 'Button1', 'when': 'used', 'do': [{'verb': 'talk', 'a': 'd1'}, {'verb': 'infolink', 'a': 'i1'}]}]})}
        acts = [v for k, v in sorted(b['UCLink_L1'].items()) if k.startswith('Act(')]
        self.assertEqual(acts, ['"0|talk||d1||"', '"0|infolink||i1||"'])


class Runtime(unittest.TestCase):
    def setUp(self):
        self.code = story.generate('01_Test', STORY)

    def test_the_story_answers_its_dialogues_and_infolinks(self):
        body = self.code[self.code.index('function string RunStoryAction(string verb, string id)'):]
        body = body[:body.index('\n}\n')]
        self.assertIn("if (bRouteOnly && !GetF('UNATCORouteCommitted'))\n\t\treturn \"off\";", body)
        self.assertIn('if (id ~= "d1")\n\t\t\treturn TalkNow(\'Guard1\', \'%s\');' % story.con_name('01_Test', STORY['dialogues'][0]), body)
        self.assertNotIn('"d2"', body, 'a dialogue turned off is not there for the game: missing')
        for il in ('i1', 'i2'):
            self.assertIn('if (id ~= "%s")\n\t\t{\n\t\t\tif (!PlayInfo_%s())\n\t\t\t\treturn "heard";\n\t\t\treturn "";' % (il, il), body)
        self.assertTrue(body.rstrip().endswith('return "missing";'))

    def test_an_infolink_says_whether_it_played(self):
        f = self.code[self.code.index('function bool PlayInfo_i1()'):]
        f = f[:f.index('\n}\n')]
        self.assertIn('\tif (s == None)\n\t\treturn False;', f)
        self.assertTrue(f.rstrip().endswith('return True;'))

    def test_a_story_without_dialogues_still_answers(self):
        code = story.generate('01_Test', {})
        self.assertIn('function string RunStoryAction(string verb, string id)', code)
        self.assertNotIn('verb == "talk"', code)

    def test_the_template_asks_and_answers(self):
        base, link = source('UCEditorStory'), source('UCLink')
        self.assertRegex(base, r'function string RunStoryAction\(string verb, string id\)\s*\{\s*return "nostory";\s*\}')
        self.assertIn('function string TalkNow(name actorName, name conName)', base)
        for why in ('"busy"', '"missing"', '"unmet"', '"played"', '"refused"'):
            self.assertIn('return %s;' % why, base)
        talk = base[base.index('function string TalkNow(name actorName, name conName)'):]
        talk = talk[:talk.index('\n}\n')]
        # the dialogue's own rules, as when the player comes near (NearTalk): its conditions, then "once"
        self.assertLess(talk.index('CheckFlagRefs(c.flagRefList)'), talk.index('c.bDisplayOnce'))
        self.assertLess(talk.index('c.bDisplayOnce'), talk.index('P.StartConversation('))
        self.assertIn('if (verb == "talk" || verb == "infolink")', link)
        ask = link[link.index('function StoryAction(string verb, string id)'):]
        ask = ask[:ask.index('\n}\n')]
        self.assertIn("foreach AllActors(class'UCEditorStory', S)", ask)
        self.assertIn('S != Self', ask)
        self.assertIn('why = S.RunStoryAction(verb, id);', ask)
        self.assertIn('Report("fail", verb $ "|" $ id $ "|" $ why);', ask)
        # every reason the game gives has its words on the page (logic-log.js FAILS)
        with open(os.path.join(HERE, '..', 'editor', 'static', 'logic-log.js'), encoding='utf-8') as f:
            log = f.read()
        for why in ('busy', 'refused', 'unmet', 'played', 'heard', 'nostory', 'off'):
            self.assertRegex(log, r'\b%s: ' % why)
        self.assertTrue(re.search(r'talk: "the map\'s Story has no such dialogue', log), 'missing, for a dialogue')


if __name__ == '__main__':
    unittest.main()
