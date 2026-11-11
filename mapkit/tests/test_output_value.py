"""P8 slice 5b: an output of a script that comes with a number (Args="Value", UCScript.OutputValue). The editor reads
which outputs do (scripts.ports 'carries', logic_catalog.io_for 'carries'), the rules write Value as the token $ in
their numbers and conditions (formula.py, links.py), and Turn into script leaves the rules that read it alone (a
script's Act and Holds have no output's number). The page's side: tests/test_logic_output_value.mjs."""
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import conditions  # noqa: E402
import formula  # noqa: E402
import links  # noqa: E402
import logic_catalog  # noqa: E402
import rulescript  # noqa: E402
import scripts  # noqa: E402

FINDER = '''class Finder extends UCScript;

function Started()
{
	OutputValue("Found", 3, Player());
}

defaultproperties
{
	Inputs(0)=(Id="Look",Label="Look around",Args="Seconds:seconds")
	Outputs(0)=(Id="Found",Label="it finds coins",Args="Value")
	Outputs(1)=(Id="Done",Label="it is done")
	Outputs(2)=(Id="Many",Label="it finds many",Args="value:number")
}
'''


def rule(**kw):
    base = dict(id='L1', src='Finder', when='output', port='Found', do=[dict(verb='count', a='Coins', b='Coins + Value')])
    base.update(kw)
    return base


class Ports(unittest.TestCase):
    def test_which_outputs_come_with_a_number(self):
        p = scripts.ports('Finder', FINDER)
        self.assertEqual(p['outputs'], [dict(id='Found', label='it finds coins', carries=True),
                                        dict(id='Done', label='it is done'),
                                        dict(id='Many', label='it finds many', carries=True)])
        self.assertNotIn('carries', p['inputs'][0])

    def test_the_catalog_says_them(self):
        io = logic_catalog.io_for(['Finder', 'UCScript', 'Actor'], scripts.ports('Finder', FINDER))
        self.assertEqual(io['carries'], ['output:Found', 'output:Many'])
        plain = logic_catalog.io_for(['Other', 'UCScript', 'Actor'], dict(inputs=[], outputs=[dict(id='Done', label='x')]))
        self.assertNotIn('carries', plain)


class Rules(unittest.TestCase):
    def test_value_is_the_token_dollar(self):
        self.assertEqual(formula.game_number('Coins + Value'), '=@Coins,$,+')
        self.assertEqual(formula.names_in('=@Coins,$,+'), ['Coins'], 'Value is no counter')
        self.assertTrue(formula.uses_value('=@Coins,$,+'))
        self.assertFalse(formula.uses_value('=@Coins,1,+'))
        self.assertEqual(formula.text_of('=$,2,*'), 'Value * 2')

    def test_the_rule_as_the_game_reads_it(self):
        self.assertEqual(links.act_string(dict(verb='count', a='Coins', b='Coins + Value')).split('|')[3:5], ['Coins', '=@Coins,$,+'])
        said = conditions.check([dict(type='counter', counter='Coins', op='<', value='Value * 10')], limit=8)
        self.assertEqual([conditions.encode(c) for c in said], ['count|Coins|<|=$,10,*'])

    def test_turn_into_script_leaves_them_alone(self):
        e = {'links': [rule(), rule(id='L2', do=[dict(verb='count', a='Coins', b='1')]),
                       rule(id='L3', do=[dict(verb='count', a='Coins', b='1')],
                            requires=[dict(type='counter', counter='Coins', op='<', value='Value')])]}
        out = rulescript.script_of(e, ['L1', 'L2', 'L3'], 'CoinScript', 'Lab')
        self.assertEqual(out['rules'], ['L2'])
        self.assertEqual([r['id'] for r in out['refused']], ['L1', 'L3'])
        self.assertIn('Value', out['refused'][0]['why'])


if __name__ == '__main__':
    unittest.main()
