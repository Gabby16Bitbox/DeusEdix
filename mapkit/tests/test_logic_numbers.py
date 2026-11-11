"""P9 slice 5, numbers: whole-number formulas of counters ("Alarms + 1") in a counter change, an amount (skill points,
credits, health, energy) and a compared value. formula.py reads them into the game's tokens (=@Alarms,1,+), never runs
them; UCEditorStory.NumberOf works them out on a stack. The shared cases (tests/fixtures/formulas.json) are the same
for static/logic-numbers.js (tests/test_logic_numbers.mjs)."""
import json
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import conditions  # noqa: E402
import formula  # noqa: E402
import links  # noqa: E402
import statecatalog  # noqa: E402

CLASSES = os.path.join(HERE, '..', 'project-template', 'src', 'DeusEdix', 'Classes')
with open(os.path.join(HERE, 'fixtures', 'formulas.json'), encoding='utf-8') as f:
    CASES = json.load(f)


def uc(name):
    with open(os.path.join(CLASSES, name + '.uc'), encoding='latin-1') as f:
        return f.read()


def counter(n):
    return CASES['counters'].get(n, 0)


class Numbers(unittest.TestCase):
    def test_the_shared_cases(self):
        for typed, game, value, text in CASES['good']:
            self.assertEqual(formula.game_number(typed), game, typed)
            self.assertEqual(formula.evaluate(game, counter, CASES['value']), value, typed)
            self.assertEqual(formula.text_of(game), text, typed)
        for typed, problem in CASES['bad']:
            self.assertTrue(formula.is_formula(typed), typed)
            with self.assertRaises(formula.FormulaError) as e:
                formula.tokens(typed)
            self.assertEqual(str(e.exception), problem, typed)
            self.assertEqual(formula.game_number(typed, 7), '7', 'a bad one takes the default')
        for game, value in CASES['worked']:
            self.assertEqual(formula.evaluate(game, counter, CASES['value']), value, game)

    def test_conditions(self):
        c = {'type': 'counter', 'counter': 'Alarms', 'op': '>=', 'value': 'Guards + 1'}
        self.assertEqual(conditions.check([c])[0], c)
        self.assertEqual(conditions.encode(c), 'count|Alarms|>=|=@Guards,1,+')
        self.assertEqual(conditions.encode(dict(c, value=3)), 'count|Alarms|>=|3', 'a number as before')
        self.assertEqual(conditions.encode(dict(c, value='3')), 'count|Alarms|>=|3')
        self.assertEqual(conditions.encode({'type': 'credits', 'op': '<', 'value': 'Price * 2'}), 'credits|<|=@Price,2,*')
        self.assertEqual(conditions.encode({'type': 'items', 'item': 'DeusEx.Flare', 'op': '>=', 'value': 'Need'}), 'items|DeusEx.Flare|>=|=@Need')
        self.assertEqual(conditions.negate(c)['value'], 'Guards + 1')
        with self.assertRaisesRegex(ValueError, 'A counter value: the formula stops too soon'):
            conditions.check([dict(c, value='Guards +')])
        with self.assertRaisesRegex(ValueError, 'whole number'):
            conditions.check([dict(c, value=2.5)])

    def test_what_links_writes(self):
        act = links.act_string
        self.assertEqual(act({'verb': 'count', 'a': 'Score', 'b': 'Kills * 10'}), '0|count||Score|=@Kills,10,*|')
        self.assertEqual(act({'verb': 'count', 'a': 'Score', 'b': 'Kills', 'c': 'set'}), '0|count||Score|=@Kills|set')
        self.assertEqual(act({'verb': 'count', 'a': 'Score', 'b': '2.9'}), '0|count||Score|2|')
        self.assertEqual(act({'verb': 'count', 'a': 'Score', 'b': 'Kills +'}), '0|count||Score|1|', 'a bad one: the default')
        for verb, dflt in (('skillpoints', 100), ('credits', 100), ('health', 25), ('energy', 25)):
            self.assertEqual(act({'verb': verb, 'a': 'Bonus - 5'}), '0|%s||=@Bonus,5,-||' % verb)
            self.assertEqual(act({'verb': verb}), '0|%s||%d||' % (verb, dflt))
            self.assertEqual(act({'verb': verb, 'a': '-30'}), '0|%s||-30||' % verb)

    def test_the_game_works_them_out(self):
        story, link = uc('UCEditorStory'), uc('UCLink')
        self.assertIn('function int NumberOf(string s)', story)
        body = story[story.index('function int NumberOf'):story.index('function int GetI')]
        self.assertIn('local int st[8];', body)
        self.assertEqual(formula.DEEPEST, 8, 'the stack of NumberOf')
        self.assertIn('else if (b == 0)', body, 'a division by 0 gives 0')
        # every compared value of Holds is a NumberOf, none an int() of its field any more
        holds = story[story.index('function bool Holds'):story.index('function bool Compare')]
        self.assertEqual(len(re.findall(r'Compare\([^;]*NumberOf\(Field\(c, \d\)\)\)', holds)), 6)
        self.assertNotRegex(holds, r'Compare\([^;]*, int\(Field\(c, \d\)\)\)')
        self.assertIn('Count(StringToName(a), NumberOf(b), c == "set")', link)
        self.assertIn('n = NumberOf(a);', link)

    def test_the_states_page_lists_the_counters_read(self):
        rows = statecatalog.collect_edits({'links': [{'id': 'R', 'requires': [{'type': 'counter', 'counter': 'Alarms', 'op': '>=', 'value': 'Guards + 1'}],
                                                      'do': [{'verb': 'credits', 'a': 'Coins * 2'}, {'verb': 'count', 'a': 'Score', 'b': 'Kills'}]}]}, 'M')
        read = {r['flag'] for r in rows if any(u['kind'] == 'read' for u in r['uses'])}
        self.assertEqual(read, {'Alarms', 'Guards', 'Coins', 'Kills'})


if __name__ == '__main__':
    unittest.main()
