"""P3's named groups on the editor's Python side (edits['logic']['groups'] = [{'id', 'name', 'members'}]): a step on a
group is a UCLink action in members mode ("0|open|||||members|<group name>|UCLG_..."), its members saved in a
UCLinkGroup the game walks (UCLink.DoMembers, each member that can do the verb: TagKind); a rule started by any of a
group becomes a rule on the first member with the others as its other causes (UCRuleAlso). Deleted members are left
out, a group with none left drops the step (or the rule). The page's side is static/logic-sim.js
(tests/test_logic_groups.mjs)."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402

GROUPS = {'groups': [{'id': 'G1', 'name': 'Lab doors', 'members': ['Door1', 'Door2', 'Light1']},
                     {'id': 'G2', 'name': 'Empty', 'members': []}]}


def edits(*rules, **more):
    return dict({'logic': GROUPS, 'links': list(rules)}, **more)


def built(e):
    return {b['name']: b for b in links.blocks(e)}


class Groups(unittest.TestCase):
    def test_the_groups_of_the_map_by_id(self):
        g = links.logic_groups({'logic': {'groups': [{'id': 'G1', 'name': ' Lab ', 'members': ['A', 'A', 'B', 3]}]}})
        self.assertEqual(g, {'G1': {'name': 'Lab', 'members': ['A', 'B'], 'filter': None}})
        self.assertEqual(links.logic_groups({}), {})
        self.assertEqual(links.logic_groups({'logic': 'nonsense'}), {})
        with self.assertRaises(ValueError):
            links.logic_groups({'logic': {'groups': [{'name': 'no id'}]}})

    def test_a_step_on_a_group_walks_its_members_in_the_game(self):
        b = built(edits(dict(id='L1', src='Button1', when='used', do=[{'verb': 'open', 'target': '', 'group': 'G1'}])))
        self.assertEqual(b['UCLink_L1']['props']['Act(0)'], '"0|open|||||members|Lab doors|UCLG_L1_0_0"')
        self.assertEqual(b['UCLG_L1_0_0']['cls'], 'UCLinkGroup')
        self.assertEqual(b['UCLG_L1_0_0']['props'], {'Member(0)': 'Door1', 'Member(1)': 'Door2', 'Member(2)': 'Light1'})

    def test_deleted_members_are_left_out_and_an_empty_group_drops_the_step(self):
        e = edits(dict(id='L1', src='Button1', when='used', do=[{'verb': 'open', 'target': '', 'group': 'G1'},
                                                                 {'verb': 'close', 'target': '', 'group': 'G2'},
                                                                 {'verb': 'message', 'a': 'done'}]),
                  deleted={'Door2': True})
        b = built(e)
        self.assertEqual(b['UCLG_L1_0_0']['props'], {'Member(0)': 'Door1', 'Member(1)': 'Light1'})
        p = b['UCLink_L1']['props']
        self.assertEqual(p['Act(1)'], '"0|message||done||"')
        self.assertNotIn('Act(2)', p)

    def test_a_verb_with_no_object_forgets_the_group(self):
        p = built(edits(dict(id='L1', src='Button1', when='used', do=[{'verb': 'message', 'a': 'hi', 'group': 'G1'}])))
        self.assertEqual(p['UCLink_L1']['props']['Act(0)'], '"0|message||hi||"')

    def test_any_of_a_group_starts_the_rule(self):
        b = built(edits(dict(id='L2', src='Door1', group='G1', when='opened', do=[{'verb': 'message', 'a': 'x'}])))
        self.assertEqual(b['UCLink_L2']['cls'], 'UCRule')
        self.assertEqual(b['UCLink_L2']['props']['Source'], '"Door1"')
        also = sorted((n, x['props']['Source'], x['props']['When']) for n, x in b.items() if x['cls'] == 'UCRuleAlso')
        self.assertEqual(also, [('UCRuleAlso_L2_1', '"Door2"', 'opened'), ('UCRuleAlso_L2_2', '"Light1"', 'opened')])

    def test_the_first_member_left_starts_it_and_a_group_with_none_drops_the_rule(self):
        b = built(edits(dict(id='L2', src='Door1', group='G1', when='opened', do=[{'verb': 'message', 'a': 'x'}]),
                        deleted={'Door1': True}))
        self.assertEqual(b['UCLink_L2']['props']['Source'], '"Door2"')
        b = built(edits(dict(id='L3', src='Door1', group='G2', when='opened', do=[{'verb': 'message', 'a': 'x'}])))
        self.assertFalse(any(n.endswith('_L3') or n.startswith('UCRuleAlso_L3') for n in b))

    def test_a_group_its_lights_can_change(self):
        e = edits(dict(id='L1', src='Button1', when='used', do=[{'verb': 'lightoff', 'target': '', 'group': 'G1'}]))
        lights = {'Light1': {'name': 'Light1', 'cls': 'Light'}}
        self.assertEqual(links.light_targets(e, lights), ['Light1'])
        self.assertEqual(links.commands(e, lights), ['UC_PROP Light1 bStatic False'])

    def test_the_edits_are_not_changed(self):
        e = edits(dict(id='L2', src='Door1', group='G1', when='opened', do=[{'verb': 'open', 'target': '', 'group': 'G1'}]))
        before = repr(e)
        links.blocks(e)
        self.assertEqual(repr(e), before)


if __name__ == '__main__':
    unittest.main()


AREA = {'kind': 'character', 'at': [100, 200, 48], 'radius': 512, 'tag': '', 'dynamic': True}


class FilterGroups(unittest.TestCase):
    """P3 slice 11: a named group with a filter builds exactly as the step it was named from ("Name this group")."""

    def same(self, named, plain, extra=()):
        a = built(edits(dict(id='L1', src='Button1', when='used', do=[named]),
                        logic={'groups': [{'id': 'G1', 'name': 'Guards', 'members': ['Guard1', 'Guard2'], **extra}]}))
        b = built(edits(dict(id='L1', src='Button1', when='used', do=[plain])))
        self.assertEqual(a, b)
        return a

    def test_a_group_by_tag_is_a_step_on_the_objects_tagged_so(self):
        b = self.same({'verb': 'open', 'target': '', 'group': 'G1'}, {'verb': 'open', 'target': '', 'targetTag': 'VAULT'},
                      {'filter': {'tag': 'VAULT'}})
        self.assertEqual(b['UCLink_L1']['props']['Act(0)'], '"0|open|||||tag|VAULT"')

    def test_a_group_by_radius_keeps_its_saved_members_and_the_newcomers(self):
        b = self.same({'verb': 'hostile', 'target': '', 'group': 'G1'},
                      {'verb': 'hostile', 'target': '', 'area': dict(AREA, members=['Guard1', 'Guard2'])}, {'filter': {'area': AREA}})
        self.assertIn('|area+|character|512|', b['UCLink_L1']['props']['Act(0)'])
        # with no saved member left, the newcomers still count
        self.same({'verb': 'hostile', 'target': '', 'group': 'G1'}, {'verb': 'hostile', 'target': '', 'area': dict(AREA, members=[])},
                  {'filter': {'area': AREA}, 'members': []})

    def test_a_verb_its_kind_cannot_do_reaches_the_saved_members_as_a_group(self):
        a = built(edits(dict(id='L1', src='Button1', when='used', do=[{'verb': 'hide', 'target': '', 'group': 'G1'}]),
                        logic={'groups': [{'id': 'G1', 'name': 'Guards', 'members': ['Guard1'], 'filter': {'area': AREA}}]}))
        self.assertEqual(a['UCLink_L1']['props']['Act(0)'], '"0|hide|||||members|Guards|UCLG_L1_0_0"')

    def test_any_of_a_filter_group_starts_on_its_saved_members(self):
        a = built(edits(dict(id='L2', src='Guard1', group='G1', when='used', do=[{'verb': 'message', 'a': 'x'}]),
                        logic={'groups': [{'id': 'G1', 'name': 'Guards', 'members': ['Guard1', 'Guard2'], 'filter': {'area': AREA}}]}))
        self.assertEqual(a['UCLink_L2']['props']['Source'], '"Guard1"')

    def test_a_filter_that_is_not_one_stops_the_build(self):
        for f in ({'tag': 'bad tag'}, {'tag': ''}, {'area': dict(AREA, kind='planet')}, {'area': dict(AREA, radius=0)}, {'what': 1}):
            with self.assertRaises(ValueError, msg=f):
                links.logic_groups({'logic': {'groups': [{'id': 'G1', 'name': 'x', 'members': [], 'filter': f}]}})
