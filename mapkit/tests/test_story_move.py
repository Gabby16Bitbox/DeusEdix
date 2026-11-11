"""P5 "Move to Logic": the rule a Story event becomes (tests/fixtures/story_move_vault.json, made by
static/story-move.js and checked against it by test_story_move.mjs) builds into the game's classes as the Story
event behaved: a UCRule on its condition becoming true, looking at the start too, with all the conditions, waiting for
a conversation, and one "Or when" (UCRuleAlso) per condition of the event."""
import json
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT)]
import links  # noqa: E402

FIXTURE = Path(__file__).with_name('fixtures') / 'story_move_vault.json'


class MovedRuleBuilds(unittest.TestCase):
    def test_the_moved_rule_builds(self):
        rule = dict(json.loads(FIXTURE.read_text(encoding='utf-8'))['rule'], id='L9')
        built = {b['name']: b for b in links.blocks({'links': [rule]})}
        main = built['UCLink_L9']
        self.assertEqual(main['cls'], 'UCRule')
        p = main['props']
        self.assertEqual(p['When'], 'becomes')
        self.assertEqual(p['Watch'], '"flag|Vault_Open|1"')
        self.assertEqual(p['bWatchStart'], 'True')
        self.assertEqual(p['TalkBusy'], 'wait')
        self.assertEqual(p['bOnce'], 'True')
        self.assertEqual([p['Cond(%d)' % i] for i in range(4)],
                         ['"flag|Vault_Open|1"', '"alive|Guard1|1"', '"item|DeusEx.Multitool|1"', '"flag|UNATCORouteCommitted|1"'])
        self.assertEqual([p['Act(%d)' % i] for i in range(5)],
                         ['"0|message||The alarm!||"', '"0|attack|Guard1|alone||"', '"0|lock|Door2|||"', '"0|flag||Alarm|1|"',
                          '"0|signal||Raid||"'])
        also = sorted(n for n in built if n.startswith('UCRuleAlso_L9_'))
        self.assertEqual(len(also), 3)
        self.assertEqual([built[n]['props']['Watch'] for n in also],
                         ['"alive|Guard1|1"', '"item|DeusEx.Multitool|1"', '"flag|UNATCORouteCommitted|1"'])
        self.assertTrue(all(built[n]['props']['Main'] == '"UCLink_L9"' for n in also))
        self.assertTrue(all('bWatchStart' not in built[n]['props'] for n in also))

    def test_one_condition_alone(self):
        # an event on one state and nothing else: the rule hears it become true (or hold at the start), no "Or when"
        rule = {'id': 'L3', 'src': '', 'when': 'becomes', 'watch': {'flag': 'UC_SigGo', 'is': True}, 'watchStart': True,
                'once': True, 'at': [0, 0, 0], 'do': [{'delay': 0, 'verb': 'signal', 'a': 'Flag signal'}], 'talkBusy': 'wait'}
        built = {b['name']: b for b in links.blocks({'links': [rule]})}
        p = built['UCLink_L3']['props']
        self.assertEqual(built['UCLink_L3']['cls'], 'UCRule')
        self.assertEqual((p['Watch'], p['bWatchStart']), ('"flag|UC_SigGo|1"', 'True'))
        self.assertNotIn('Cond(0)', p)
        self.assertFalse([n for n in built if n.startswith('UCRuleAlso_')])


if __name__ == '__main__':
    unittest.main()
