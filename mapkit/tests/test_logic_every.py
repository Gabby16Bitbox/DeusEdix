"""P9 slice 1, the game rules on anyone of a set, on the editor's Python side (links.py): a group of a kind
({'filter': {'kind': 'MJ12Troop'}}) or of a faction ({'filter': {'faction': 'MJ12'}}) starts one UCRule that looks at
each living member (Every "class:MJ12Troop" / "faction:MJ12", no Source, hooked to nothing); a step on such a group is
"every" (UCRule.DoEvery: each living one then); the happenings only the game rules hear (sees, turnshostile, findsbody)
on one character are a set of one ("names:Guard1"), on a group of picked characters a set of its members. The game
side is UCRule.uc; the in-game run backup/20261110_p9/tools/game_m22_p9sets.py."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402

GROUPS = {'groups': [{'id': 'G1', 'name': 'MJ12 troopers', 'members': [], 'filter': {'kind': 'MJ12Troop'}},
                     {'id': 'G2', 'name': 'UNATCO', 'members': [], 'filter': {'faction': 'UNATCO'}},
                     {'id': 'G3', 'name': 'Pair', 'members': ['Guard1', 'Guard2']},
                     {'id': 'G4', 'name': 'Lab doors', 'members': ['Door1']}]}


def built(*rules):
    return {b['name']: b for b in links.blocks({'logic': GROUPS, 'links': list(rules)})}


def msg(text):
    return {'id': 'a1', 'verb': 'message', 'target': '', 'a': text}


class Every(unittest.TestCase):
    def test_a_group_of_a_kind_or_a_faction_is_a_filter(self):
        g = links.logic_groups({'logic': GROUPS})
        self.assertEqual(g['G1']['filter'], {'kind': 'MJ12Troop'})
        self.assertEqual(g['G2']['filter'], {'faction': 'UNATCO'})
        self.assertEqual(links.every_set({'kind': 'MJ12Troop'}), 'class:MJ12Troop')
        self.assertEqual(links.every_set({'faction': 'MJ12'}), 'faction:MJ12')
        for bad in ({'kind': 'a b'}, {'kind': ''}, {'faction': 'x|y'}, {'kind': 'A', 'faction': 'B'}, None, 'kind'):
            self.assertEqual(links.every_set(bad), '')
        with self.assertRaises(ValueError):
            links.logic_groups({'logic': {'groups': [{'id': 'G9', 'name': 'x', 'members': [], 'filter': {'kind': 'a|b'}}]}})

    def test_anyone_of_a_kind_is_one_rule_that_looks(self):
        b = built(dict(id='R1', src='', group='G1', when='findsbody', do=[dict(msg('A body'))]))['UCLink_R1']
        self.assertEqual(b['cls'], 'UCRule')
        p = b['props']
        self.assertEqual((p['When'], p['Every'], p['Tag']), ('findsbody', '"class:MJ12Troop"', 'UCLW_R1'))
        self.assertNotIn('Source', p)
        self.assertNotIn('bWatchProp', p)
        self.assertEqual(p['Again'], 'each')          # two members at once: a run each
        again = built(dict(id='R2', src='', group='G1', when='sees', again='restart', do=[msg('x')]))['UCLink_R2']
        self.assertEqual(again['props']['Again'], 'restart')

    def test_the_old_happenings_on_a_faction_and_hurt_below(self):
        b = built(dict(id='R1', src='', group='G2', when='killed', do=[msg('x')]),
                  dict(id='R2', src='', group='G2', when='hurt', below=150, do=[msg('y')]),
                  dict(id='R3', src='', group='G2', when='hurt', do=[msg('z')]))
        self.assertEqual(b['UCLink_R1']['props']['Every'], '"faction:UNATCO"')
        self.assertEqual(b['UCLink_R2']['props']['EveryArg'], '100')
        self.assertNotIn('EveryArg', b['UCLink_R3']['props'])
        self.assertNotIn('UCRuleAlso_R1_1', b)

    def test_a_happening_only_the_game_rules_hear(self):
        b = built(dict(id='R1', src='Guard1', when='sees', do=[msg('seen')]),
                  dict(id='R2', src='', group='G3', when='turnshostile', do=[msg('h')]),
                  dict(id='R3', src='', group='G3', when='killed', do=[msg('k')]))
        self.assertEqual(b['UCLink_R1']['cls'], 'UCRule')
        self.assertEqual(b['UCLink_R1']['props']['Every'], '"names:Guard1"')
        self.assertEqual(b['UCLink_R2']['props']['Every'], '"names:Guard1,Guard2"')
        # an old happening on picked characters stays as it was: the first, the other its other cause
        self.assertNotIn('Every', b['UCLink_R3']['props'])
        self.assertIn('UCRuleAlso_R3_1', b)

    def test_a_step_on_anyone_of_a_kind(self):
        b = built(dict(id='R1', src='Button1', when='used', do=[{'id': 'a1', 'verb': 'hostile', 'target': '', 'group': 'G1'},
                                                                {'id': 'a2', 'verb': 'open', 'target': '', 'group': 'G1'}]))
        p = b['UCLink_R1']['props']
        self.assertEqual(b['UCLink_R1']['cls'], 'UCRule')
        self.assertEqual(p['Act(0)'], '"0|hostile|||||every|class:MJ12Troop|MJ12 troopers"')
        self.assertNotIn('Act(1)', p)                 # (a door verb: no character can do it)

    def test_what_cannot_be(self):
        # a set's happening that is not a character's; no object; an "Or when" that looks at a set
        self.assertFalse(links.cause_ok({'when': 'opened', 'every': 'class:X'}))
        self.assertFalse(links.cause_ok({'when': 'sees', 'src': ''}))
        self.assertTrue(links.cause_ok({'when': 'sees', 'every': 'faction:MJ12'}))
        with self.assertRaisesRegex(ValueError, 'Or when'):
            built(dict(id='R1', src='Button1', when='used', also=[{'src': 'Guard1', 'when': 'sees'}], do=[msg('x')]))
        self.assertIn('a happening of the game rules', ' '.join(links.v2_reasons({'src': 'Guard1', 'when': 'findsbody'})))
        with self.assertRaisesRegex(ValueError, 'classic rules'):
            links.blocks({'logicRuntime': 'classic', 'logic': GROUPS, 'links': [dict(id='R1', src='Guard1', when='sees', do=[msg('x')])]})


if __name__ == '__main__':
    unittest.main()
