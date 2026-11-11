"""P9 slice 3, the world (config/logic.json hears 'world'): a saved game loaded, the player coming back to the map, a goal
completed, a noise near the player, a character or a body appearing. Each is a UCRule of its own (links.py: WorldArg, a
noise's NearDist), never an "Or when..."; the game's side is UCRule.LookAtWorld / HearNoise / HearSpawn, UCBoot.Wake,
UCGameEars, UCSpawnEars (the page's: tests/test_logic_world.mjs)."""
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402
import logic_catalog  # noqa: E402

CLASSES = os.path.join(HERE, '..', 'project-template', 'src', 'DeusEdix', 'Classes')
MSG = [{'id': 'a1', 'verb': 'message', 'target': '', 'a': 'x'}]
WORLD = ('loaded', 'back', 'goaldone', 'noise', 'appears')


def uc(name):
    with open(os.path.join(CLASSES, name + '.uc'), encoding='latin-1') as f:
        return f.read()


def built(**cause):
    b = links.blocks({'links': [dict(id='W', src='', do=MSG, **cause)]})
    assert len(b) == 1, b
    return b[0]


class World(unittest.TestCase):
    def test_the_catalogue_has_them_and_the_game_knows_each(self):
        self.assertEqual([w for w, e in logic_catalog.OUTPUTS.items() if e['hears'] == 'world'], list(WORLD))
        rule = uc('UCRule')
        for w in WORLD:
            self.assertIn("When == '%s'" % w, rule)
        for k in ('LookAtWorld', 'LookAtGoals', 'HearNoise', 'HearSpawn', 'UCGameEars', 'UCSpawnEars', 'WokeAs'):
            self.assertIn(k, rule)
        self.assertIn('function Wake()', uc('UCBoot'))
        self.assertIn('PlayerTraveling', uc('UCBoot'))
        self.assertIn("'UCEdHere'", uc('UCBoot'))
        ears = uc('UCGameEars')
        for kind in links.NOISES:
            self.assertIn('"%s"' % kind, ears + rule)
        self.assertIn('extends SpawnNotify', uc('UCSpawnEars'))

    def test_each_is_a_rule_of_the_v2_runtime_with_what_it_hears(self):
        b = built(when='loaded')
        self.assertEqual((b['cls'], b['props']['When']), ('UCRule', 'loaded'))
        self.assertNotIn('WorldArg', b['props'])
        self.assertEqual(built(when='back')['props']['When'], 'back')
        self.assertEqual(built(when='goaldone', goal='Find It')['props']['WorldArg'], '"Find_It"', 'the goal verb\'s name')
        self.assertNotIn('WorldArg', built(when='goaldone', goal='')['props'], 'any goal')
        n = built(when='noise', noise='gunshot', within='800')['props']
        self.assertEqual((n['WorldArg'], n['NearDist']), ('"gunshot"', '800.000000'))
        self.assertEqual(built(when='noise')['props']['NearDist'], '0.000000', 'anywhere: not UCLink\'s 256')
        self.assertEqual(built(when='noise', noise='whistle')['props']['WorldArg'], '"loud"')
        self.assertEqual(built(when='appears', what='body')['props']['WorldArg'], '"body"')
        self.assertEqual(built(when='appears')['props']['WorldArg'], '"character"')
        self.assertTrue(any('world' in r for r in links.v2_reasons(dict(id='W', src='', when='noise', do=MSG))))

    def test_never_an_or_when(self):
        for w in WORLD:
            with self.assertRaises(ValueError, msg=w):
                links.blocks({'links': [dict(id='X', src='Button1', when='used', also=[dict(when=w, src='')], do=MSG)]})
        # the other way round is fine: a world rule with another cause
        b = links.blocks({'links': [dict(id='X', src='', when='loaded', also=[dict(when='used', src='Button1')], do=MSG)]})
        self.assertEqual(sorted(x['cls'] for x in b), ['UCRule', 'UCRuleAlso'])

    def test_the_boot_tells_the_wake_before_the_rules_start(self):
        boot = uc('UCBoot')
        timer = boot[boot.index('function Timer()'):]
        self.assertLess(timer.index('Wake();'), timer.index('SpawnEditorStory();'))
        self.assertTrue(re.search(r'var transient name WokeAs;', boot))


if __name__ == '__main__':
    unittest.main()
