"""P5 slice 4, the Story sends signals, on the build's side: a dialogue's step {"type": "signal"} is the conversation's
own trigger event on UCS_<name>, a Story action (an event's, a dialogue's or an InfoLink's end) a TriggerTag on it;
the Tag is the one the rules "When the signal ... is sent" wait on (links.tag_of). The page's side:
tests/test_logic_story_signals.mjs."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402
import originalstory  # noqa: E402
import story  # noqa: E402

STORY = {'dialogues': [{'id': 'd1', 'title': 'Gate talk', 'owner': 'Guard1', 'steps': [
    {'type': 'line', 'who': 'npc', 'text': 'Halt.'}, {'type': 'signal', 'signal': 'Alarm on'}, {'type': 'signal', 'signal': ''},
    {'type': 'do', 'do': [{'type': 'signal', 'signal': 'Talked'}]}, {'type': 'end'}]}],
    'infolinks': [{'id': 'i1', 'title': 'Jock calls', 'caller': 'Jock', 'lines': [{'text': 'Ready.'}],
                   'do': [{'type': 'signal', 'signal': 'Heard Jock'}]}],
    'events': [{'id': 'e1', 'title': 'Start', 'when': {'type': 'start'}, 'do': [{'type': 'signal', 'signal': 'Begin'}]}]}


class Build(unittest.TestCase):
    def setUp(self):
        self.code = story.generate('01_Test', STORY)

    def test_the_tag_is_the_rules_one(self):
        for name in ('Alarm on', 'Begin', 'a-b c'):
            [p] = [b['props'] for b in links.blocks({'links': [{'id': 'L1', 'when': 'signal', 'signal': name,
                                                                 'do': [{'verb': 'message', 'a': 'x'}]}]})]
            self.assertEqual(p['Tag'], story.signal_tag(name))
        self.assertEqual(story.signal_tag(''), '')
        self.assertEqual(story.signal_tag('  '), '')

    def test_the_dialogue_step_is_its_trigger_event_where_it_is(self):
        self.assertIn("c.Trigger('UCS_Alarm_on');", self.code)
        self.assertLess(self.code.index('Halt.'), self.code.index("c.Trigger('UCS_Alarm_on');"))
        self.assertNotIn("c.Trigger('UCS_');", self.code, 'none chosen: nothing')

    def test_the_actions_trigger_the_tag(self):
        for tag in ('UCS_Talked', 'UCS_Heard_Jock', 'UCS_Begin'):
            self.assertIn("TriggerTag('%s');" % tag, self.code)

    def test_the_story_check_takes_the_step(self):
        originalstory.validate(STORY, complete=True)


if __name__ == '__main__':
    unittest.main()
