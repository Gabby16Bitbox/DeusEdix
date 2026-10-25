"""The level logic's editor side (editor/LOGIC.md): the outputs and inputs of each kind of object
(config/logic.json, logic_catalog.py), the conditions shared by the rules and the Story (conditions.py), the rules
as UCLink actors (links.py), scripts as blocks (scripts.ports) and the counters in the state catalog."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import conditions  # noqa: E402
import links  # noqa: E402
import logic_catalog  # noqa: E402
import scripts  # noqa: E402
import statecatalog  # noqa: E402
import story  # noqa: E402

KEYPAD = ['Keypad1', 'Keypad', 'HackableDevices', 'ElectronicDevices', 'DeusExDecoration', 'Decoration', 'Actor', 'Object']
BEAM = ['BeamTrigger', 'Trigger', 'Triggers', 'Actor', 'Object']


class Catalogue(unittest.TestCase):
    def test_the_nearest_ancestor_decides(self):
        self.assertEqual(logic_catalog.family_of(KEYPAD)['id'], 'keypad')          # not 'object'
        self.assertEqual(logic_catalog.family_of(BEAM)['id'], 'beam')              # not 'zone'
        self.assertEqual(logic_catalog.family_of(['Trigger', 'Triggers', 'Actor'])['id'], 'zone')
        self.assertEqual(logic_catalog.family_of(['SomeModThing'])['id'], 'other')  # a class the game does not know

    def test_known_mistakes_are_not_offered(self):
        self.assertNotIn('leave', logic_catalog.io_for(BEAM)['outputs'])          # a beam never untriggers
        for cls in ('AllianceTrigger', 'OrdersTrigger', 'InterpolateTrigger', 'SequenceTrigger'):
            io = logic_catalog.io_for([cls, 'Trigger', 'Triggers', 'Actor'])
            self.assertEqual(io['outputs'], ['near'], cls)                          # their Event is a target list
        self.assertNotIn('on', logic_catalog.io_for(['ElevatorMover', 'Mover', 'Brush', 'Actor'])['inputs'])

    def test_defaults_and_ports(self):
        self.assertEqual(logic_catalog.io_for(['UCTimer', 'Actor'])['default'], 'timerstart')
        self.assertEqual(logic_catalog.io_for(['Light', 'Actor'])['default'], 'lighttoggle')
        ports = {'inputs': [{'id': 'Sabotage', 'label': 'Sabotage it', 'args': ['Seconds']}],
                 'outputs': [{'id': 'Sabotaged', 'label': 'it is sabotaged'}]}
        io = logic_catalog.io_for(['Generator', 'UCScript', 'Actor'], ports)
        self.assertEqual(io['family'], 'script')
        self.assertEqual(io['outputs'][0], 'output:Sabotaged')
        self.assertEqual(io['inputs'][0], 'input:Sabotage')
        self.assertEqual(io['default'], 'input:Sabotage')
        self.assertEqual(io['args'], {'Sabotage': ['Seconds']})
        self.assertEqual(io['labels']['output:Sabotaged'], 'it is sabotaged')

    def test_tags_follow_the_table(self):
        self.assertEqual(logic_catalog.tag('wrongcode', 'Pad'), 'UCL_Pad_Fail')
        self.assertEqual(logic_catalog.tag('option', 'PC', 2), 'UCL_PC_Opt2')
        self.assertIsNone(logic_catalog.tag('near', 'X'))
        self.assertEqual(links.WHEN['output'], 'port')
        self.assertEqual(links.WHEN['code'], 'keypad')

    def test_an_elevator_goes_to_a_floor(self):
        io = logic_catalog.io_for(['ElevatorMover', 'Mover', 'Brush', 'Actor'])
        self.assertEqual(io['default'], 'floor')
        self.assertEqual(links.act_string({'verb': 'floor', 'target': 'Lift', 'a': '2'}), '0|floor|Lift|2||')

    def test_a_broken_table_is_refused(self):
        table = json.loads(logic_catalog.CONFIG.read_text(encoding='utf-8'))
        broken = [dict(table, families=table['families'] + [dict(id='x', classes=['Keypad'], outputs=[], inputs=[])]),
                  dict(table, families=[dict(id='y', classes=['Y'], outputs=['nope'], inputs=[])]),
                  dict(table, outputs=dict(table['outputs'], odd={'hears': 'telepathy'}))]
        for value in broken:
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / 'logic.json'
                path.write_text(json.dumps(value), encoding='utf-8')
                with self.assertRaises(ValueError):
                    logic_catalog._load(path)


class Conditions(unittest.TestCase):
    def test_each_kind_is_encoded_for_the_game(self):
        cases = [({'flag': 'Crypt Gen', 'is': False}, 'flag|Crypt_Gen|0'),
                 ({'type': 'item', 'item': 'DeusEx.Multitool', 'has': True}, 'item|DeusEx.Multitool|1'),
                 ({'type': 'alive', 'actor': 'Guard1'}, 'alive|Guard1|1'),
                 ({'type': 'skill', 'skill': 'SkillLockpicking', 'level': 2}, 'skill|SkillLockpicking|2'),
                 ({'type': 'counter', 'counter': 'Levers', 'op': '>=', 'value': 3}, 'count|Levers|>=|3'),
                 ({'type': 'credits', 'op': '<', 'value': 100}, 'credits|<|100')]
        for c, text in cases:
            self.assertEqual(conditions.encode(conditions.check([c])[0]), text)

    def test_bad_conditions_say_what_is_wrong(self):
        for bad in ([{'type': 'item', 'item': 'Multitool'}], [{'type': 'skill', 'skill': 'SkillX', 'level': 4}],
                    [{'type': 'counter', 'counter': 'A', 'op': '=>', 'value': 1}], [{'type': 'weather'}],
                    [{'type': 'credits', 'op': '>', 'value': 1.5}]):
            with self.assertRaises(ValueError):
                conditions.check(bad)

    def test_the_eight_conditions_are_a_rules_limit_only(self):
        nine = [{'flag': 'S%d' % i} for i in range(9)]
        self.assertEqual(len(conditions.check(nine)), 9)                 # a dialogue's: ConFlagRef has no limit
        with self.assertRaises(ValueError):
            conditions.check(nine, limit=conditions.MAX_CONDITIONS)
        with self.assertRaises(ValueError):
            conditions.check({'flag': 'A'})                                 # not a list

    def test_names_the_game_cannot_write(self):
        with self.assertRaises(ValueError):                                 # the map's own names are ASCII
            conditions.check([{'type': 'alive', 'actor': 'Gardeś'}])
        counter = {'type': 'counter', 'counter': 'Licznik ś', 'op': '>=', 'value': 1}
        self.assertEqual(conditions.encode(conditions.check([counter])[0]), 'count|Licznik_s|>=|1')     # (an accent goes)
        self.assertEqual(links.act_string({'verb': 'count', 'a': 'Licznik ś', 'b': '1'}), '0|count||Licznik_s|1|')

    def test_unfinished_rows_wait_in_drafts_only(self):
        draft = {'events': [{'title': 'Vault', 'requires': [{'type': 'item', 'item': ''}]}]}
        story.check_conditions(draft, draft=True)                           # autosave keeps the row
        with self.assertRaisesRegex(ValueError, 'Event "Vault"'):            # building names the event
            story.check_conditions(draft)

    def test_empty_state_rows_are_left_out_as_the_story_always_did(self):
        self.assertEqual(conditions.check([{'flag': '', 'is': True}, {'flag': 'A'}]), [{'flag': 'A'}])

    def test_the_story_uses_the_same_model(self):
        self.assertEqual(story.cond([{'flag': 'A', 'is': False}, {'type': 'item', 'item': 'DeusEx.Medkit'}]),
                         ["!GetF('A')", 'Holds("item|DeusEx.Medkit|1")'])
        lines = []
        with self.assertRaises(ValueError):            # a dialogue: the game checks only states (ConFlagRef)
            story.requires(lines, [{'type': 'alive', 'actor': 'Guard1'}])
        story.requires(lines, [{'flag': 'A'}, {'flag': ''}])
        self.assertEqual(lines, ["\t\t\tc.Require('A', True);"])


def rule(**kw):
    base = dict(id='L1', src='Button1', when='used', do=[dict(verb='open', target='Door1')])
    base.update(kw)
    return base


def link_props(edits):
    return [b for b in links.blocks(edits) if b['cls'] == 'UCLink'][0]['props']


class Rules(unittest.TestCase):
    def test_conditions_and_the_rule_id_reach_the_link(self):
        props = link_props({'links': [rule(requires=[{'flag': 'Gen'}, {'type': 'item', 'item': 'DeusEx.Multitool'}])]})
        self.assertEqual(props['Rule'], '"L1"')
        self.assertEqual(props['Cond(0)'], '"flag|Gen|1"')
        self.assertEqual(props['Cond(1)'], '"item|DeusEx.Multitool|1"')

    def test_a_scripts_output_and_input(self):
        props = link_props({'links': [rule(src='Gen0', when='output', port='Sabotaged',
                                           do=[dict(verb='input', target='Gen1', a='Start', b='Seconds=4;Mode=red|x')])]})
        self.assertEqual(props['Port'], '"Sabotaged"')
        self.assertTrue(props['Tag'].startswith('UCLW_'))           # set off directly by the script, not by a Tag
        self.assertEqual(props['Act(0)'], '"0|input|Gen1|Start|Seconds=4;Mode=red/x|"')
        self.assertFalse(links.valid(rule(when='output', port='')))   # an output needs its name

    def test_counters(self):
        self.assertEqual(links.act_string({'verb': 'count', 'a': 'Levers pulled', 'b': '-2'}), '0|count||Levers_pulled|-2|')
        self.assertEqual(links.act_string({'verb': 'count', 'a': 'L', 'b': '5', 'c': 'set'}), '0|count||L|5|set')

    def test_one_option_for_the_tag_and_the_property(self):
        props = link_props({'links': [rule(src='PC', when='option', option=7)]})
        self.assertEqual(props['Option'], '3')
        self.assertEqual(props['Tag'], 'UCL_PC_Opt3')

    def test_each_rule_needs_its_own_id(self):
        with self.assertRaises(ValueError):            # the same id twice: one actor name for two rules
            links.blocks({'links': [rule(id='L1'), rule(id='L1', src='Button2')]})
        with self.assertRaises(ValueError):            # 'L-1' is no name: it would have become actor 'UCLink_'
            links.blocks({'links': [rule(id='L-1')]})

    def test_bad_conditions_stop_the_rebuild_naming_the_rule(self):
        with self.assertRaisesRegex(ValueError, 'Interaction L1'):
            links.blocks({'links': [rule(requires=[{'type': 'skill', 'skill': 'SkillX', 'level': 9}])]})
        with self.assertRaisesRegex(ValueError, 'Interaction L1'):        # an item never chosen
            links.blocks({'links': [rule(requires=[{'type': 'item', 'item': ''}])]})


class ScriptPorts(unittest.TestCase):
    def test_declarations_are_read_from_defaultproperties(self):
        text = '''class Gen extends UCScript;
// Inputs(5)=(Id="Commented") is not in defaultproperties
defaultproperties
{
    Inputs(1)=(Id=Open,Label="Open it",Args="Speed, Mode")  // a bare Id, arguments
    Inputs(0)=(Id="Close")
    Outputs(0)=(Id="Opened",Label="it is open")
    Outputs(1)=(Id="no spaces allowed")
    Seconds=10
}
'''
        self.assertEqual(scripts.ports('Gen', text), {
            'inputs': [{'id': 'Close', 'label': 'Close', 'args': []},
                       {'id': 'Open', 'label': 'Open it', 'args': ['Speed', 'Mode']}],
            'outputs': [{'id': 'Opened', 'label': 'it is open'}]})

    def test_valid_unrealscript_that_looks_odd(self):
        text = '''class Gen extends UCScript;
function Foo() // values in defaultproperties
{
    Say("defaultproperties {");
}
/* Inputs(4)=(Id="Commented") */
defaultproperties
{
    Inputs(0)=(Id="Open",Label="Open {now} // or later")
    Outputs(0) = (Id="Done")
}
'''
        found = scripts.ports('Gen', text)
        self.assertEqual(found['inputs'], [{'id': 'Open', 'label': 'Open {now} // or later', 'args': []}])
        self.assertEqual(found['outputs'], [{'id': 'Done', 'label': 'Done'}])

    def test_a_script_inherits_its_parents_ports(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / 'Base.uc').write_text('class Base extends UCScript;\ndefaultproperties\n{\n Inputs(0)=(Id="Start",Label="Start it")\n'
                                            ' Outputs(0)=(Id="Done")\n}\n', encoding='latin1')
            (folder / 'Child.uc').write_text('class Child extends Base;\ndefaultproperties\n{\n Inputs(0)=(Id="Start",Label="Start the child")\n'
                                             ' Inputs(1)=(Id="Stop")\n}\n', encoding='latin1')
            (folder / 'Pad.uc').write_text('class Pad extends Keypad;\n', encoding='latin1')
            old = scripts.CLASSES
            scripts.CLASSES = folder
            try:
                self.assertEqual(scripts.lineage('Child'), (['Child', 'Base'], 'UCScript'))
                self.assertEqual(scripts.lineage('Pad'), (['Pad'], 'Keypad'))
                merged = scripts.ports_of(['Child', 'Base'])
                self.assertEqual([(p['id'], p['label']) for p in merged['inputs']], [('Start', 'Start the child'), ('Stop', 'Stop')])
                self.assertEqual([p['id'] for p in merged['outputs']], ['Done'])
            finally:
                scripts.CLASSES = old

    def test_the_block_template_declares_its_ports(self):
        ports = scripts.ports('Gen', scripts.TEMPLATES['block'][1] % {'name': 'Gen'})
        self.assertEqual([p['id'] for p in ports['inputs']], ['Start'])
        self.assertEqual([p['id'] for p in ports['outputs']], ['Done'])


class Counters(unittest.TestCase):
    def test_counters_are_int_flags_written_and_read(self):
        edits = {'links': [rule(requires=[{'type': 'counter', 'counter': 'Levers', 'op': '>=', 'value': 3}, {'flag': 'Gen'}],
                                do=[dict(verb='count', a='Levers', b='1')])]}
        found = {e['flag']: e for e in statecatalog.collect_edits(edits, 'M')}
        self.assertEqual(found['Levers']['type'], 'int')
        self.assertEqual({u['kind'] for u in found['Levers']['uses']}, {'read', 'write'})
        self.assertEqual(found['Gen']['type'], 'bool')


if __name__ == '__main__':
    unittest.main()
