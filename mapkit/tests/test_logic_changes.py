"""P9 slice 4, the changes a rule can make (config/logic.json): the player's energy, an augmentation of the player, how
two factions see each other, a property of the safe list (safeProps, Advanced). links.py writes them for UCLink.DoMore
(ChangeAug, Allies, SetSafeProp); the game takes only the safe properties (the page's side: tests/test_logic_changes.mjs)."""
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402
import logic_catalog  # noqa: E402

CLASSES = os.path.join(HERE, '..', 'project-template', 'src', 'DeusEdix', 'Classes')
VERBS = ('energy', 'aug', 'allies', 'setprop')


def uc(name):
    with open(os.path.join(CLASSES, name + '.uc'), encoding='latin-1') as f:
        return f.read()


class Changes(unittest.TestCase):
    def test_the_catalogue_has_them_and_the_game_does_each(self):
        link = uc('UCLink')
        for v in VERBS:
            self.assertIn(v, logic_catalog.INPUTS)
            self.assertIn('verb == "%s"' % v, link)
        self.assertTrue({'energy', 'aug', 'allies'} <= set(logic_catalog.FREE))
        self.assertEqual(logic_catalog.INPUTS['setprop']['level'], 'advanced')
        for name in ('ChangeAug', 'Allies', 'SetSafeProp', 'ChangeAlly', 'GivePlayerAugmentation'):
            self.assertIn(name, link)

    def test_the_game_takes_the_same_safe_properties(self):
        listed = re.search(r'InStr\(Caps\(((?:"[^"]*"\s*(?:\$\s*)?)+)\)', uc('UCLink'))
        self.assertTrue(listed)
        game = {n.lower() for n in ''.join(re.findall(r'"([^"]*)"', listed.group(1))).split(',') if n}
        table = {p[0].lower() for props in logic_catalog.SAFE_PROPS.values() for p in props}
        self.assertEqual(game, table)

    def test_what_links_writes(self):
        act = links.act_string
        self.assertEqual(act({'verb': 'energy', 'a': '-30'}), '0|energy||-30||')
        self.assertEqual(act({'verb': 'energy'}), '0|energy||25||', 'its default')
        self.assertEqual(act({'verb': 'aug', 'a': 'AugCloak', 'b': 'level', 'c': '9'}), '0|aug||AugCloak|level|4')
        self.assertEqual(act({'verb': 'aug', 'a': 'Aug Bad|x', 'b': 'steal'}), '0|aug|||give|2', 'no such name, no such way')
        self.assertEqual(act({'verb': 'allies', 'a': 'MJ12', 'b': 'UNATCO', 'c': 'hostile'}), '0|allies||MJ12|UNATCO|hostile both')
        self.assertEqual(act({'verb': 'allies', 'a': 'Gang', 'b': 'Player', 'c': 'friendly', 'both': False}), '0|allies||Gang|Player|friendly')
        self.assertEqual(act({'verb': 'allies', 'a': 'A|B', 'b': '', 'c': 'evil'}), '0|allies||||hostile both')
        self.assertEqual(act({'verb': 'setprop', 'target': 'Guard1', 'a': 'groundspeed', 'b': '400.5'}), '0|setprop|Guard1|GroundSpeed|400.5|')
        self.assertEqual(act({'verb': 'setprop', 'target': 'Guard1', 'a': 'GroundSpeed', 'b': '-3'}), '0|setprop|Guard1|GroundSpeed|0|')
        self.assertEqual(act({'verb': 'setprop', 'target': 'Guard1', 'a': 'bInvincible', 'b': 'yes'}), '0|setprop|Guard1|bInvincible|True|')
        self.assertEqual(act({'verb': 'setprop', 'target': 'Crate1', 'a': 'HitPoints', 'b': '12.7'}), '0|setprop|Crate1|HitPoints|12|')
        self.assertEqual(act({'verb': 'setprop', 'target': 'Guard1', 'a': 'Alliance', 'b': 'x'}), '0|setprop|Guard1|||',
                         'not a safe one: no name, the game says noprop')

    def test_safe_prop_by_family(self):
        self.assertEqual(logic_catalog.safe_prop('lockstrength', 'door'), ('lockStrength', 'number'))
        self.assertEqual(logic_catalog.safe_prop('DrawScale', 'door'), ('DrawScale', 'number'), "every object's")
        self.assertIsNone(logic_catalog.safe_prop('lockStrength', 'character'))
        self.assertIsNone(logic_catalog.safe_prop('Alliance'))

    def test_the_original_game_compiles_the_same_calls(self):
        # Revision's GivePlayerAugmentation takes an optional second parameter: one argument works in both games
        self.assertIn('GivePlayerAugmentation(aug.Class)', uc('UCLink'))
        self.assertNotIn('IncLevel(', uc('UCLink'), "the game's IncLevel wants an upgrade canister")


if __name__ == '__main__':
    unittest.main()
