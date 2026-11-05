"""Seat actions keep exact actor identities through the authoring/build boundary."""
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT)]
import links
import logic_catalog
import story


class SeatOrders(unittest.TestCase):
    def test_start_sit_and_later_stand_keep_the_exact_seat(self):
        # Two chairs may share the same game Tag; the action still names only Chair2.
        edits = {'props': {'Chair1': {'Tag': 'Office'}, 'Chair2': {'Tag': 'Office'}},
                 'links': [{'id': 'Sit', 'when': 'start', 'do': [
                     {'verb': 'sit', 'target': 'Guard1', 'a': 'Chair2'},
                     {'verb': 'standup', 'target': 'Guard1', 'delay': 5}]}]}
        built = links.blocks(edits)
        self.assertEqual(len(built), 1)
        self.assertEqual(built[0]['props']['Act(0)'], '"0|sit|Guard1|Chair2||"')
        self.assertEqual(built[0]['props']['Act(1)'], '"5|standup|Guard1|||"')
        self.assertEqual(edits['props']['Chair2']['Tag'], 'Office')

    def test_missing_removed_or_disabled_seat_is_not_compiled(self):
        action = {'verb': 'sit', 'target': 'Guard1', 'a': 'Chair2'}
        rule = {'id': 'Sit', 'when': 'start', 'do': [action]}
        for edits in ({'deleted': {'Chair2': True}}, {'disabled': {'Chair2': True}}):
            self.assertEqual(links.blocks(dict(edits, links=[rule])), [])
        for name in ('', 'Chair 2', 'Chair2|attack|Guard1'):
            self.assertEqual(links.blocks({'links': [dict(rule, do=[dict(action, a=name)])]}), [])

    def test_story_uses_the_same_commands_and_rejects_unfinished_seating(self):
        self.assertEqual(story.action_code('M', {'type': 'npc', 'actor': 'Guard1', 'act': 'sit', 'seat': 'Chair2'}, {}, '  '),
                         ["  NpcSit('Guard1', 'Chair2');"])
        self.assertEqual(story.action_code('M', {'type': 'npc', 'actor': 'Guard1', 'act': 'standup'}, {}, ''),
                         ["NpcStandUp('Guard1');"])
        for chair in ('', 'Chair 2', "Chair2');Attack('Guard1"):
            with self.assertRaisesRegex(ValueError, 'choose a seat'):
                story.action_code('M', {'type': 'npc', 'actor': 'Guard1', 'act': 'sit', 'seat': chair}, {}, '')

    def test_available_for_characters_in_both_games(self):
        for verb in ('sit', 'standup'):
            self.assertIn(verb, logic_catalog.FAMILIES['character']['inputs'])
            self.assertNotIn(verb, logic_catalog.FAMILIES['carcass']['inputs'])
            for game in ('vanilla', 'revision'):
                self.assertTrue(logic_catalog.works_in('verb', verb, game))


if __name__ == '__main__':
    unittest.main()
