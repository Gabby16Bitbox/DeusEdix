"""P5 slice 2, rules that wait for the map's Story, on the build's and the game's side: "When the dialogue ... has
ended" is a UCLink on the Tag UCD_<id>, which the story class triggers when the game notes the conversation's end
(UCEditorStory.EndWatch, from the generated TickEnds); "When the InfoLink ... has been heard" is one on UCI_<id>,
which the InfoLink triggers when its last line is over (UCEdInfoLink.Heard). The page's side:
tests/test_logic_story_ends.mjs."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402
import story  # noqa: E402

CLASSES = os.path.join(HERE, '..', 'project-template', 'src', 'DeusEdix', 'Classes')
STORY = {'dialogues': [{'id': 'd1', 'title': 'Gate talk', 'owner': 'Guard1', 'steps': [{'type': 'line', 'who': 'owner', 'text': 'Halt.'}]},
                       {'id': 'd2', 'title': 'Old', 'owner': 'Guard2', 'disabled': True, 'steps': []},
                       {'id': 'd3', 'title': 'Again', 'owner': 'Guard1', 'steps': []}],
         'infolinks': [{'id': 'i1', 'title': 'Jock calls', 'caller': 'Jock', 'lines': [{'text': 'Ready.'}]}]}


def source(cls):
    with open(os.path.join(CLASSES, cls + '.uc'), encoding='latin1') as f:
        return f.read()


def body(code, head):
    b = code[code.index(head):]
    return b[:b.index('\n}\n')]


class Build(unittest.TestCase):
    def test_the_rules_wait_for_the_tags_the_story_triggers(self):
        b = {x['name']: x['props'] for x in links.blocks({'links': [
            {'id': 'L1', 'when': 'ended', 'dialogue': 'd1', 'do': [{'verb': 'message', 'a': 'Bye'}]},
            {'id': 'L2', 'when': 'heard', 'infolink': 'i1', 'do': [{'verb': 'message', 'a': 'Over'}]}]})}
        self.assertEqual(b['UCLink_L1']['Tag'], story.end_tag('d1'))
        self.assertEqual(b['UCLink_L2']['Tag'], story.heard_tag('i1'))
        self.assertEqual((story.end_tag('d1'), story.heard_tag('i1')), ('UCD_d1', 'UCI_i1'))
        for p in b.values():
            self.assertFalse(p.get('Source'), 'no object: nothing to hook')

    def test_one_chosen_or_left_out(self):
        self.assertFalse(links.cause_ok({'when': 'ended', 'dialogue': ''}))
        self.assertFalse(links.cause_ok({'when': 'heard'}))
        self.assertTrue(links.cause_ok({'when': 'heard', 'infolink': 'i1'}))
        self.assertIn('dialogue', links.CAUSE_KEYS)
        self.assertIn('infolink', links.CAUSE_KEYS)


class Story(unittest.TestCase):
    def setUp(self):
        self.code = story.generate('01_Test', STORY)

    def test_every_dialogue_turned_on_is_watched_in_its_slot(self):
        ends = body(self.code, 'function TickEnds()')
        d1, d3 = (story.con_name('01_Test', STORY['dialogues'][i]) for i in (0, 2))
        self.assertIn("EndWatch(0, 'Guard1', '%s', 'UCD_d1');" % d1, ends)
        self.assertIn("EndWatch(1, 'Guard1', '%s', 'UCD_d3');" % d3, ends)
        self.assertNotIn('UCD_d2', ends, 'a dialogue turned off is not in the game')

    def test_the_infolink_names_its_tag(self):
        f = body(self.code, 'function bool PlayInfo_i1()')
        self.assertIn("\ts.EndTag = 'UCI_i1';", f)
        self.assertLess(f.index('return False;'), f.index('s.EndTag'), 'after the check that it plays')

    def test_no_dialogues_no_watch(self):
        self.assertNotIn('function TickEnds()', story.generate('01_Test', {'infolinks': STORY['infolinks']}))


class Template(unittest.TestCase):
    def test_the_story_watches_the_game_s_own_end_time(self):
        base = source('UCEditorStory')
        self.assertRegex(base, r'function TickEnds\(\);')
        w = body(base, 'function EndWatch(int i, name actorName, name conName, name endTag)')
        # a conversation attached again (after a load) is taken as it is: no end then
        self.assertLess(w.index('if (c != endCon[i])'), w.index('c.lastPlayedTime > endSeen[i]'))
        self.assertIn('ArrayCount(endWho)', w)
        self.assertIn("foreach AllActors(class'Actor', A, endTag)", w)
        self.assertIn('A.Trigger(Plr(), Plr());', w, 'set off by the player who ended it, not by the story (UCLink.Who)')
        timer = body(base, 'function Timer()')
        self.assertLess(timer.index('TickEnds();'), timer.index('TickStory();'))

    def test_the_infolink_says_it_was_heard_at_its_end_only(self):
        il = source('UCEdInfoLink')
        playing = il[il.index('state Playing'):]
        self.assertLess(playing.index('HideInfo();'), playing.index('TellHeard();'))
        self.assertLess(playing.index('TellHeard();'), playing.index('Destroy();'))
        self.assertNotIn('TellHeard()', body(il, 'function CancelGuidance()'), 'guidance replaced is not heard')
        self.assertIn("foreach AllActors(class'Actor', A, EndTag)", body(il, 'function TellHeard()'))
        # (a function Heard would give the game's name heard, the rules' When, that spelling in the log: "Heard")
        self.assertNotRegex(il, r'function\s+Heard\s*\(')


if __name__ == '__main__':
    unittest.main()
