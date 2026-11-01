"""The compiled form of a map's logic for the Logic simulator (editor/logic_compile.py, "Try it"): links.py's own
actors, how the game hears each output, the rules left out of the game and why, and what stops the build, said
rather than raised. tests/test_logic_sim.mjs plays the compiled form: the behaviour fixtures and the simulator's own
cases (tests/logic_sim_cases.json) must be exactly what links.py makes of their edits."""
import json
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import links  # noqa: E402
import logic_catalog  # noqa: E402
import logic_compile  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / 'fixtures' / 'logic'
CASES = Path(__file__).resolve().parent / 'logic_sim_cases.json'
REMAKE = 'run backup/20261027_logic_phase_a/sim/make_cases.py again if links.py changed on purpose'


def fixtures():
    return [json.loads(p.read_text(encoding='utf-8')) for p in sorted(FIXTURES.glob('*.json'))]


def message(id, src='Button1', when='used', **more):
    """A rule that shows a message."""
    return dict(id=id, src=src, when=when, label='%s %s' % (src, when), do=[{'verb': 'message', 'a': 'hi'}], **more)


class Actors(unittest.TestCase):
    def test_every_fixture_compiles_into_the_actors_it_plays(self):
        found = fixtures()
        self.assertGreaterEqual(len(found), 25)
        for fx in found:
            made = logic_compile.compiled(fx['edits'])
            self.assertEqual(made['error'], '', fx['id'])
            self.assertEqual(made['actors'], fx['compiled'], fx['id'])

    def test_the_simulators_cases_are_what_links_py_makes_of_them(self):
        cases = json.loads(CASES.read_text(encoding='utf-8'))['cases']
        self.assertGreaterEqual(len(cases), 8)
        for name, case in cases.items():
            made = logic_compile.compiled(case['edits'])
            self.assertEqual(made['actors'], case['actors'], '%s: %s' % (name, REMAKE))
            self.assertEqual(made['left'], case['left'], '%s: %s' % (name, REMAKE))

    def test_the_actors_are_links_blocks_and_the_whole_is_json(self):
        edits = dict(links=[message('L1'), message('L2', when='near', near=300)], usable={'Button1': {'text': 'Press'}})
        made = logic_compile.compiled(edits)
        self.assertEqual(made['actors'], links.blocks(edits))
        self.assertEqual(json.loads(json.dumps(made)), made)
        self.assertEqual(logic_compile.built_rules(made['actors']), ['L1', 'L2'])


class Outputs(unittest.TestCase):
    def test_every_output_with_how_the_game_hears_it(self):
        outputs = logic_compile.outputs()
        self.assertEqual(set(outputs), set(logic_catalog.OUTPUTS))
        for when, entry in outputs.items():
            self.assertEqual(entry['hears'], logic_catalog.OUTPUTS[when]['hears'], when)
            self.assertEqual(entry['tag'], logic_catalog.OUTPUTS[when].get('tag', ''), when)

    def test_a_tag_filled_in_is_the_one_its_rule_waits_on(self):
        """The simulator fills in the pattern ({src}, {option}) to tell the rules: it must be links.tag_of's Tag."""
        for when, entry in logic_compile.outputs().items():
            link = message('L1', src='Thing1', when=when, option=2, port='Ready')
            want = entry['tag'].replace('{src}', 'Thing1').replace('{option}', '2') if entry['tag'] else 'UCLW_L1'
            self.assertEqual(links.tag_of(link), want, when)


class Left(unittest.TestCase):
    def test_each_rule_left_out_of_the_game_says_why(self):
        edits = dict(links=[message('L1'), dict(message('L2'), do=[]), message('L3', src=''), message('L4', src='Button4'),
                            message('L5', src='Button5'), dict(message('L6'), do=[{'verb': 'open', 'target': 'Door9'}]),
                            message('L7', src='', when='start')],
                     deleted={'Button4': {'cls': 'Button1'}, 'Door9': {'cls': 'DeusExMover'}}, disabled={'Button5': True})
        made = logic_compile.compiled(edits)
        self.assertEqual(logic_compile.built_rules(made['actors']), ['L1', 'L7'])
        self.assertEqual([(x['id'], x['src'], x['why']) for x in made['left']],
                         [('L2', 'Button1', 'unfinished'), ('L3', '', 'unfinished'), ('L4', 'Button4', 'deleted'),
                          ('L5', 'Button5', 'disabled'), ('L6', 'Button1', 'noaction')])
        for x in made['left']:
            self.assertEqual(x['text'], logic_compile.LEFT[x['why']])

    def test_a_character_to_use_no_object_is_not_said_to_be_deleted(self):
        """links.blocks leaves out a character's use with no object (or none it can name): unfinished, not deleted. Beside
        an action on a deleted object (L4) the deleted object is the reason: bringing it back brings the rule back."""
        use = lambda what: [{'verb': 'npcuse', 'target': 'Guard1', 'a': what}]           # noqa: E731
        edits = dict(links=[dict(message('L1'), do=use('')), dict(message('L2'), do=use('Crate 1')),
                            dict(message('L3'), do=use('Crate9')), dict(message('L4'), do=use('') + [
                                {'verb': 'hide', 'target': 'Crate9'}])],
                     deleted={'Crate9': {'cls': 'CrateUnbreakableSmall'}})
        made = logic_compile.compiled(edits)
        self.assertEqual(made['error'], '')
        self.assertEqual([(x['id'], x['why']) for x in made['left']],
                         [('L1', 'noobject'), ('L2', 'noobject'), ('L3', 'noaction'), ('L4', 'noaction')])
        self.assertEqual(made['left'][0]['text'], 'no object is chosen for the character to use')

    def test_a_yes_or_no_is_written_as_python_takes_it(self):
        """What UCEditorStory.Holds reads (Field != "0"): conditions.py _yes. The page's twin (conditions.js
        conditionHolds) reads the same values the same: tests/test_conditions_holds.mjs."""
        for value, digit in ((True, '1'), (False, '0'), (1, '1'), (0, '0'), (None, '0'), ('', '0'), ('no', '1'),
                             ([], '0'), ({}, '0')):
            made = logic_compile.compiled(dict(links=[message('L1', requires=[{'flag': 'Alarm', 'is': value}])]))
            link = next(a for a in made['actors'] if a['cls'] == 'UCLink')
            self.assertEqual(link['props']['Cond(0)'], '"flag|Alarm|%s"' % digit, repr(value))

    def test_the_deleted_and_disabled_fixture(self):
        fx = next(f for f in fixtures() if f['id'] == 'deleted_and_disabled')
        left = logic_compile.compiled(fx['edits'])['left']
        self.assertEqual([(x['id'], x['why']) for x in left], [('L2', 'deleted'), ('L3', 'disabled'), ('L5', 'noaction')])


class Errors(unittest.TestCase):
    def test_what_stops_the_build_is_said_not_raised(self):
        made = logic_compile.compiled(dict(links=[message('L1'), message('L1', src='Button2')]))
        self.assertIn('L1', made['error'])
        self.assertEqual(made['actors'], [])
        self.assertEqual(made['outputs'], logic_compile.outputs())

    def test_a_condition_not_filled_in_names_its_rule(self):
        rule = message('L4', requires=[{'type': 'counter', 'counter': '', 'op': '>=', 'value': 1}])
        self.assertIn('Interaction L4', logic_compile.compiled(dict(links=[rule]))['error'])


if __name__ == '__main__':
    unittest.main()
