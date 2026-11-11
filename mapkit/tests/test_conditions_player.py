"""P9 slice 2, the player's own conditions (conditions.py): health, energy, skill points, an augmentation (has it, has it
on, at a level or more), in water, in a zone, things of a kind. Each is checked, written for the game (encode: what
UCEditorStory.Holds reads, the same strings the page decodes: tests/test_conditions_player.mjs) and turned round
(negate: a "while" ends, an "If not" rule). The game's side is UCEditorStory.uc Holds / AugHolds / ItemsOf."""
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import conditions  # noqa: E402
import links  # noqa: E402

TEMPLATE = os.path.join(HERE, '..', 'project-template', 'src', 'DeusEdix', 'Classes', 'UCEditorStory.uc')

# [the condition, what the game reads, what its opposite reads]
CASES = [
    ({'type': 'health', 'op': '<', 'value': 30}, 'health|<|30', 'health|>=|30'),
    ({'type': 'energy', 'op': '<', 'value': 20}, 'energy|<|20', 'energy|>=|20'),
    ({'type': 'skillpoints', 'op': '>=', 'value': 2000}, 'skillpoints|>=|2000', 'skillpoints|<|2000'),
    ({'type': 'aug', 'aug': 'AugSpeed', 'how': 'has', 'is': True}, 'aug|AugSpeed|has|0|1', 'aug|AugSpeed|has|0|0'),
    ({'type': 'aug', 'aug': 'AugSpeed', 'how': 'on', 'is': True}, 'aug|AugSpeed|on|0|1', 'aug|AugSpeed|on|0|0'),
    ({'type': 'aug', 'aug': 'AugVision', 'how': 'level', 'level': 3, 'is': False}, 'aug|AugVision|level|3|0', 'aug|AugVision|level|3|1'),
    ({'type': 'aug', 'aug': 'AugCloak'}, 'aug|AugCloak|has|0|1', 'aug|AugCloak|has|0|0'),
    ({'type': 'water', 'is': True}, 'water|1', 'water|0'),
    ({'type': 'zone', 'zone': 'UCZone_Pool', 'is': False}, 'zone|UCZone_Pool|0', 'zone|UCZone_Pool|1'),
    ({'type': 'items', 'item': 'DeusEx.DeusExWeapon', 'op': '>=', 'value': 1}, 'items|DeusEx.DeusExWeapon|>=|1',
     'items|DeusEx.DeusExWeapon|<|1'),
]


class PlayerConditions(unittest.TestCase):
    def test_each_is_written_for_the_game_and_turned_round(self):
        for c, written, opposite in CASES:
            self.assertEqual(conditions.check([c]), [c])
            self.assertEqual(conditions.encode(c), written)
            self.assertEqual(conditions.encode(conditions.negate(c)), opposite)
            self.assertEqual(conditions.unreal(c), 'Holds("%s")' % written)

    def test_what_is_wrong_is_said(self):
        bad = [{'type': 'energy', 'op': '=<', 'value': 1}, {'type': 'energy', 'op': '<', 'value': 1.5},
               {'type': 'aug', 'aug': 'Aug Speed'}, {'type': 'aug', 'aug': 'AugSpeed', 'how': 'off'},
               {'type': 'aug', 'aug': 'AugSpeed', 'how': 'level', 'level': 5},
               {'type': 'aug', 'aug': 'AugSpeed', 'how': 'level'}, {'type': 'zone', 'zone': ''},
               {'type': 'items', 'item': 'DeusExWeapon', 'op': '>=', 'value': 1}]
        for c in bad:
            with self.assertRaises(ValueError, msg=c):
                conditions.check([c])
        self.assertTrue(conditions.unfinished({'type': 'zone', 'zone': ''}))
        self.assertTrue(conditions.unfinished({'type': 'items', 'item': '', 'op': '>=', 'value': 1}))
        self.assertFalse(conditions.unfinished({'type': 'water'}))

    def test_the_game_knows_every_kind(self):
        """UCEditorStory.Holds has a branch for each kind encode writes (else it logs "bad" and never holds)."""
        with open(TEMPLATE, encoding='latin-1') as f:
            uc = f.read()
        known = set(re.findall(r'kind == "(\w+)"', uc))
        for c, written, _ in CASES:
            self.assertIn(written.split('|')[0], known)
        for k in ('AugHolds', 'ItemsOf', 'bWaterZone', 'SkillPointsAvail', 'P.Energy'):
            self.assertIn(k, uc)

    def test_a_rule_on_the_player_is_a_condition_that_becomes_true(self):
        """The Logic window's "The player" happenings (logic-rule-ui.js PLAYER_CAUSES) are "becomes" rules: UCLink
        watches the condition every half second; as a rule's check it is one of its Cond."""
        msg = {'id': 'a1', 'verb': 'message', 'target': '', 'a': 'x'}
        b = {x['name']: x for x in links.blocks({'links': [
            dict(id='P1', src='', when='becomes', watch={'type': 'aug', 'aug': 'AugSpeed', 'how': 'on', 'is': True}, do=[msg]),
            dict(id='P2', src='Button1', when='used', requires=[{'type': 'water', 'is': False}], do=[msg])]})}
        self.assertEqual(b['UCLink_P1']['props']['Watch'], '"aug|AugSpeed|on|0|1"')
        self.assertEqual(b['UCLink_P2']['props']['Cond(0)'], '"water|0"')
        with self.assertRaises(ValueError):
            links.blocks({'links': [dict(id='P3', src='', when='becomes', watch={'type': 'zone', 'zone': 'a b'}, do=[msg])]})


if __name__ == '__main__':
    unittest.main()
