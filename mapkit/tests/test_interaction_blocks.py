"""The building blocks of the Interactions compiled by editor/links.py: timers, usable objects, characters
using objects, effects (in the game UCTimer, UCUsable, UCNpcUse, UCEffect and UCLink)."""
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT)]
import links  # noqa: E402

BOMB = {
    'usable': {'Bomb': {'text': 'Defuse', 'secs': 3, 'crouch': True, 'uses': 1, 'hidden': True,
                        'item': 'DeusEx.Multitool', 'consume': True, 'at': [10, 20, 30]}},
    'links': [
        {'id': 'L1', 'src': '', 'when': 'start', 'do': [{'verb': 'npcuse', 'target': 'Guard', 'a': 'Crate', 'b': '4', 'c': 'crouch'}]},
        {'id': 'L2', 'src': 'Crate', 'when': 'npcused', 'do': [
            {'verb': 'show', 'target': 'Bomb'}, {'verb': 'timerstart', 'target': 'Timer1', 'a': ''},
            {'verb': 'effect', 'target': 'Bomb', 'a': 'blinklight', 'b': '30', 'c': 'Red beep'}]},
        {'id': 'L3', 'src': 'Bomb', 'when': 'used', 'do': [{'verb': 'timerstop', 'target': 'Timer1'},
                                                            {'verb': 'effect', 'target': 'Bomb', 'a': 'off'}]},
        {'id': 'L4', 'src': 'Timer1', 'when': 'finished', 'do': [{'verb': 'explode', 'target': 'Bomb', 'a': '40', 'b': '200'},
                                                                  {'verb': 'effect', 'target': 'Crate', 'a': 'mist', 'b': '0'}]},
        {'id': 'L5', 'src': 'Timer1', 'when': 'stopped', 'do': [{'verb': 'message', 'a': 'Defused'}]},
        {'id': 'L6', 'src': 'Guard', 'when': 'arrived', 'do': [{'verb': 'timerpause', 'target': 'Timer1'}]},
        {'id': 'L7', 'src': 'Lever', 'when': 'used', 'do': [{'verb': 'timerresume', 'target': 'Timer1'}]},
    ]}


def by_name(edits):
    return {b['name']: b for b in links.blocks(edits)}


class BlocksTest(unittest.TestCase):
    def test_usable_object_becomes_a_UCUsable(self):
        b = by_name(BOMB)['UCUse_Bomb']
        self.assertEqual(b['cls'], 'UCUsable')
        self.assertEqual(b['loc'], [10.0, 20.0, 30.0])
        p = b['props']
        self.assertEqual((p['Tag'], p['Target'], p['UseText'], p['UseEvent']), ('UCU_Bomb', '"Bomb"', '"Defuse"', 'UCL_Bomb_Used'))
        self.assertEqual((p['UseTime'], p['Uses'], p['bCrouch'], p['bHiddenAtStart']), ('3.000000', '1', 'True', 'True'))
        self.assertEqual((p['NeedItem'], p['bConsume']), ('"DeusEx.Multitool"', 'True'))

    def test_tags_of_the_new_whens(self):
        b = by_name(BOMB)
        self.assertEqual(b['UCLink_L2']['props']['Tag'], 'UCL_Crate_Npc')
        self.assertEqual(b['UCLink_L3']['props']['Tag'], 'UCL_Bomb_Used')       # usable: its UCUsable triggers it
        self.assertEqual(b['UCLink_L4']['props']['Tag'], 'UCL_Timer1_Done')
        self.assertEqual(b['UCLink_L5']['props']['Tag'], 'UCL_Timer1_Stop')
        self.assertEqual(b['UCLink_L6']['props']['Tag'], 'UCLW_L6')             # arrived: watched
        self.assertEqual(b['UCLink_L7']['props']['Tag'], 'UCL_Lever')           # not usable: the object's own event

    def test_action_strings(self):
        b = by_name(BOMB)
        self.assertEqual(b['UCLink_L1']['props']['Act(0)'], '"0|npcuse|Guard|Crate|4|crouch"')
        acts = [b['UCLink_L2']['props']['Act(%d)' % i] for i in range(3)]
        self.assertEqual(acts, ['"0|show|Bomb|||"', '"0|timerstart|Timer1|||"', '"0|effect|Bomb|blinklight|30|red beep"'])
        self.assertEqual(b['UCLink_L3']['props']['Act(1)'], '"0|effect|Bomb|off|0|"')
        self.assertEqual(b['UCLink_L4']['props']['Act(1)'], '"0|effect|Crate|mist|0|"')
        self.assertEqual(links.act_string({'verb': 'timerstart', 'target': 'T', 'a': '12.5'}), '0|timerstart|T|12.5||')
        self.assertEqual(links.act_string({'verb': 'effect', 'target': 'T', 'a': 'lava', 'b': '-3'}), '0|effect|T|mist|0|')
        self.assertEqual(links.act_string({'verb': 'npcuse', 'target': 'G', 'a': 'Crate 1', 'b': 'x', 'c': 'stand'}), '0|npcuse|G||3|stand')

    def test_effect_point_and_exact(self):
        # an effect point is an ordinary target; 'exact' (exactly on the object) travels in the c field
        self.assertEqual(links.act_string({'verb': 'effect', 'target': 'UCEdit0', 'a': 'mist', 'b': '0'}),
                         '0|effect|UCEdit0|mist|0|')
        self.assertEqual(links.act_string({'verb': 'effect', 'target': 'Bomb', 'a': 'blinklight', 'b': '0', 'c': 'Red Beep exact'}),
                         '0|effect|Bomb|blinklight|0|red beep exact')
        edits = {'links': [{'id': 'L9', 'src': '', 'when': 'start', 'do': [
            {'verb': 'effect', 'target': 'UCEdit0', 'a': 'fire', 'b': '0'}]}],
            'fxpreview': {'UCEdit0': {'kind': 'smoke', 'always': True}}}      # editor only: nothing in the map
        blocks = links.blocks(edits)
        self.assertEqual([b['cls'] for b in blocks], ['UCLink'])
        self.assertEqual(blocks[0]['props']['Act(0)'], '"0|effect|UCEdit0|fire|0|"')
        self.assertEqual(links.blocks(dict(edits, deleted={'UCEdit0': True})), [])

    def test_deleted_objects_are_left_out(self):
        b = by_name(dict(BOMB, deleted={'Crate': True}))
        self.assertNotIn('UCLink_L1', b)                 # its only action used the deleted crate
        self.assertNotIn('UCLink_L2', b)                 # its object is gone
        self.assertEqual(b['UCLink_L4']['props']['Act(0)'], '"0|explode|Bomb|40|200|"')
        self.assertNotIn('Act(1)', b['UCLink_L4']['props'])
        self.assertNotIn('UCUse_Bomb', by_name(dict(BOMB, deleted={'Bomb': True})))

    def test_report_lists_usable_objects(self):
        self.assertIn('  EDIT usable Bomb: "Defuse", 3 s', links.report(BOMB))


if __name__ == '__main__':
    unittest.main()
