"""P5 slice 3, the step "Wait until the dialogue ... has ended / the InfoLink ... has been heard" on the build's and
the game's side: links.py writes an until step on the Story's Tag (UCD_<id> / UCI_<id>, the ones of slice 2); the
story remembers when it saw each end (UCEditorStory.Seen, from EndWatch and UCEdInfoLink.TellHeard) and
UCLink.UntilDone asks it (StorySeen), counting only an end since the wait began. The page's side:
tests/test_logic_story_waits.mjs."""
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402

CLASSES = os.path.join(HERE, '..', 'project-template', 'src', 'DeusEdix', 'Classes')


def source(cls):
    with open(os.path.join(CLASSES, cls + '.uc'), encoding='latin1') as f:
        return f.read()


def body(code, head):
    b = code[code.index(head):]
    return b[:b.index('\n}\n')]


def acts(do):
    link = dict(id='L1', src='Button1', when='used', steps=True, do=do)
    [p] = [b['props'] for b in links.blocks({'links': [link]}) if b['cls'] == 'UCLink']
    return [p['Act(%d)' % i].strip('"') for i in range(24) if 'Act(%d)' % i in p]


class Build(unittest.TestCase):
    def test_the_until_step_names_the_story_s_tag(self):
        self.assertEqual(acts([{'verb': 'talk', 'a': 'd1'},
                               {'verb': 'wait', 'until': {'type': 'ended', 'dialogue': 'd1'}, 'max': 30},
                               {'verb': 'message', 'a': 'Bye'},
                               {'verb': 'wait', 'until': {'type': 'heard', 'infolink': 'i1'}},
                               {'verb': 'message', 'a': 'Over', 'delay': 2}]),
                         ['0|talk||d1||', '0|until|UCD_d1|ended|30|', '0|message||Bye||', '0|until|UCI_i1|heard|0|',
                          '2|message||Over||'])

    def test_none_chosen_is_no_wait(self):
        self.assertEqual(acts([{'verb': 'wait', 'until': {'type': 'ended', 'dialogue': ''}}, {'verb': 'message', 'a': 'x'}]),
                         ['0|message||x||'])
        self.assertEqual(acts([{'verb': 'wait', 'until': {'type': 'heard'}}, {'verb': 'message', 'a': 'x'}]), ['0|message||x||'])

    def test_the_tags_are_the_causes_ones(self):
        [[_, _, tag, _, _, _]] = [a.split('|') for a in acts([{'verb': 'wait', 'until': {'type': 'ended', 'dialogue': 'd1'}},
                                                             {'verb': 'message', 'a': 'x'}])[:1]]
        [p] = [b['props'] for b in links.blocks({'links': [{'id': 'L2', 'when': 'ended', 'dialogue': 'd1',
                                                             'do': [{'verb': 'message', 'a': 'x'}]}]})]
        self.assertEqual(p['Tag'], tag)


class Template(unittest.TestCase):
    def test_the_story_remembers_each_end(self):
        base = source('UCEditorStory')
        self.assertIn('var name seenTag[64];', base)
        self.assertIn('var float seenTime[64];', base)
        seen = body(base, 'function Seen(name tag, float t)')
        self.assertIn('ArrayCount(seenTag)', seen)
        self.assertIn('seenTime[i] < seenTime[k]', seen, 'all slots used: the oldest end gives its slot')
        self.assertIn('string(seenTag[i]) ~= tag', body(base, 'function float SeenAt(string tag)'))
        # (Unreal names ignore case: a variable seenAt would be the function's name, a compile error)
        self.assertNotRegex(base, r'var float seenAt')
        w = body(base, 'function EndWatch(int i, name actorName, name conName, name endTag)')
        # the game's own end time (ConPlayBase.SetPlayedFlag: Level.TimeSeconds), before the rules hear it
        self.assertLess(w.index('Seen(endTag, c.lastPlayedTime);'), w.index('A.Trigger(Plr(), Plr());'))

    def test_the_infolink_tells_the_story_before_its_rules(self):
        f = body(source('UCEdInfoLink'), 'function TellHeard()')
        self.assertLess(f.index('S.Seen(EndTag, Level.TimeSeconds);'), f.index('A.Trigger(Self, Plr());'))

    def test_the_wait_counts_only_an_end_since_it_began(self):
        code = source('UCLink')
        self.assertIn('foreach AllActors(class\'UCEditorStory\', S)', body(code, 'function float StorySeen(string tag)'))
        until = body(code, 'function bool UntilDone(')
        self.assertRegex(until, r'Field\(s, 3\) == "ended" \|\| Field\(s, 3\) == "heard"\)[^\n]*\n\s*bDone = StorySeen\(Field\(s, 2\)\) >= UntilStart;')
        self.assertTrue(re.search(r'"delay\|until\|UCD_<id>\|ended\|most\|"', code), 'the step said in the header')


if __name__ == '__main__':
    unittest.main()
