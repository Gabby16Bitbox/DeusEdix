"""P3's signals and logic blocks on the editor's Python side: a signal sent is a UCLink action "signal|<name>" (the
game triggers UCS_<name>), a rule on "a signal is sent" waits on that Tag and needs its name; a logic block (UCBlock:
All of these, Gate, Switch) offers its family's ports, the same the template class declares in its defaultproperties;
the palette's Logic group places them, the Inspector names their settings.
The game's side is project-template UCLink.uc (DoMore) and UCBlock.uc / UCBAllOf.uc / UCBGate.uc / UCBSwitch.uc;
the page's static/logic-sim.js (tests/test_logic_blocks.mjs)."""
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402
import logic_catalog  # noqa: E402
import props  # noqa: E402

CLASSES = os.path.join(HERE, '..', 'project-template', 'src', 'DeusEdix', 'Classes')
BLOCKS = {'UCBAllOf': 'allof', 'UCBGate': 'gate', 'UCBSwitch': 'switchblock', 'UCBPhases': 'phases', 'UCBAtLeast': 'atleast',
          'UCBFirstOf': 'firstof', 'UCBCounter': 'counterblock'}


def built(*rules):
    return {b['name']: b['props'] for b in links.blocks({'links': list(rules)})}


def fields(cls):
    """The settings the Inspector shows for a class (props.FIELDS: section, class, property, label, type, help)"""
    return {f[2] for f in props.FIELDS if f[1] == cls}


def declared(cls):
    """The ports a template class declares: {'inputs': [(Id, Label)], 'outputs': [...]}"""
    with open(os.path.join(CLASSES, cls + '.uc'), encoding='latin1') as f:
        text = f.read()
    found = {}
    for kind in ('Inputs', 'Outputs'):
        found[kind.lower()] = [(m[1], m[2]) for m in re.finditer(kind + r'\(\d+\)=\(Id="(\w+)",Label="([^"]*)"\)', text)]
    return found


class Signals(unittest.TestCase):
    def test_sending_a_signal_names_it_as_the_game_writes_names(self):
        p = built(dict(id='L1', src='Button1', when='used', do=[{'verb': 'signal', 'a': 'Alarm 2'}]))['UCLink_L1']
        self.assertEqual(p['Act(0)'], '"0|signal||Alarm_2||"')

    def test_a_rule_on_a_signal_waits_on_its_tag_and_has_no_source(self):
        p = built(dict(id='L2', when='signal', signal='Alarm 2', do=[{'verb': 'message', 'a': 'hi'}]))['UCLink_L2']
        self.assertEqual(p['Tag'], 'UCS_Alarm_2')
        self.assertEqual(p['When'], 'signal')
        self.assertNotIn('Source', p)

    def test_a_signal_with_no_name_is_not_a_cause(self):
        self.assertFalse(links.cause_ok({'when': 'signal', 'signal': '  '}))
        self.assertTrue(links.cause_ok({'when': 'signal', 'signal': 'Alarm'}))
        self.assertEqual(built(dict(id='L3', when='signal', signal='', do=[{'verb': 'message', 'a': 'hi'}])), {})

    def test_a_signal_is_a_free_verb_and_an_output_heard_by_its_tag(self):
        self.assertIn('signal', logic_catalog.FREE)
        self.assertEqual(logic_catalog.OUTPUTS['signal']['hears'], 'gametag')


class Blocks(unittest.TestCase):
    def test_a_block_offers_the_ports_its_class_declares(self):
        for cls, fam in BLOCKS.items():
            io = logic_catalog.io_for([cls, 'UCBlock', 'UCScript', 'Info', 'Actor'])
            self.assertEqual(io['family'], fam, cls)
            want = declared(cls)
            self.assertEqual(io['inputs'][:len(want['inputs'])], ['input:' + i for i, _ in want['inputs']], cls)
            self.assertEqual(io['outputs'][:len(want['outputs'])], ['output:' + i for i, _ in want['outputs']], cls)
            for i, label in want['inputs']:
                self.assertEqual(io['labels']['input:' + i], label, cls)
            for i, label in want['outputs']:
                self.assertEqual(io['labels']['output:' + i], label, cls)
            if want['inputs']:                   # (At least N has none: it looks at states by itself)
                self.assertEqual(io['default'], 'input:' + want['inputs'][0][0], cls)

    def test_a_script_keeps_its_own_ports(self):
        mine = {'inputs': [{'id': 'Go', 'label': 'Go', 'args': []}], 'outputs': []}
        io = logic_catalog.io_for(['MyScript', 'UCScript', 'Info', 'Actor'], mine)
        self.assertEqual(io['inputs'][0], 'input:Go')

    def test_calling_a_block_compiles_to_its_input(self):
        p = built(dict(id='L1', src='Button1', when='used', do=[{'verb': 'input', 'target': 'All1', 'a': 'Add'}]))['UCLink_L1']
        self.assertEqual(p['Act(0)'], '"0|input|All1|Add||"')

    def test_the_inspector_names_their_settings(self):
        self.assertEqual(fields('UCBAllOf'), {'Need', 'bAgain'})
        self.assertEqual(fields('UCBGate'), {'bClosed'})
        self.assertEqual(fields('UCBSwitch'), {'NumWays', 'Mode', 'Weights'})
        self.assertEqual(props.CHOICES['Mode'], ['In turn', 'In order', 'At random'])
        self.assertEqual(fields('UCBPhases'), {'Phases', 'StateName'})
        self.assertEqual(fields('UCBAtLeast'), {'States', 'Need', 'StateName'})
        self.assertEqual(fields('UCBFirstOf'), {'NumWays', 'TimeLimit', 'bClockAtStart'})
        self.assertEqual(fields('UCBCounter'), {'ReachedAt', 'StateName', 'bAgain'})

    def test_the_classes_have_the_settings_the_inspector_names(self):
        for cls in BLOCKS:
            with open(os.path.join(CLASSES, cls + '.uc'), encoding='latin1') as f:
                text = f.read()
            for name in fields(cls):
                self.assertRegex(text, r'var\(\)\s+\w+\s+%s;' % name, cls)



class BlockStates(unittest.TestCase):
    """The flags a Phases block and an At least N block keep are offered to the conditions (statecatalog), named as
    UCBlock.FlagName names them."""
    def test_flag_names_as_the_game_makes_them(self):
        import statecatalog
        self.assertEqual(statecatalog.block_flag_name(' 2nd floor '), 'X_2nd_floor')
        self.assertEqual(statecatalog.block_flag_name('città'), 'citt_')
        self.assertEqual(statecatalog.block_flag_name('a' * 70), 'a' * 60)

    def test_the_phases_and_the_derived_state_are_offered(self):
        import statecatalog
        edits = {'added': [{'name': 'Ph1', 'cls': 'UCBPhases', 'props': {'Phases': '"Arrive, Alarm"'}},
                           {'name': 'Some1', 'cls': 'UCBAtLeast', 'props': {'StateName': '"Pressure"'}},
                           {'name': 'Some2', 'cls': 'UCBAtLeast', 'props': {}}],
                 'props': {'Ph1': {'StateName': '"Tower"'}}, 'links': []}
        got = {e['flag']: e['type'] for e in statecatalog.collect_edits(edits, '01_M')}
        self.assertEqual(got, {'Tower': 'int', 'Tower_Arrive': 'bool', 'Tower_Alarm': 'bool', 'Pressure': 'bool'})

    def test_a_phase_input_and_output_compile_as_named(self):
        p = built(dict(id='L1', src='Button1', when='used', do=[{'verb': 'input', 'target': 'Ph1', 'a': 'GoTo_Alarm'}]))['UCLink_L1']
        self.assertEqual(p['Act(0)'], '"0|input|Ph1|GoTo_Alarm||"')
        p = built(dict(id='L2', src='Ph1', when='output', port='Enter_Alarm', do=[{'verb': 'message', 'a': 'hi'}]))['UCLink_L2']
        self.assertEqual(p['Port'], '"Enter_Alarm"')

    def test_a_counter_keeps_its_counter_named_as_it_says(self):
        """A Counter block (P3 slice 6, UCBCounter.Root): its StateName, else its own name, offered as a counter"""
        import statecatalog
        edits = {'added': [{'name': 'Kills', 'cls': 'UCBCounter', 'props': {}},
                           {'name': 'C2', 'cls': 'UCBCounter', 'props': {'StateName': '"Gens down"'}}],
                 'props': {}, 'links': []}
        got = {e['flag']: e['type'] for e in statecatalog.collect_edits(edits, '01_M')}
        self.assertEqual(got, {'Kills': 'int', 'Gens_down': 'int'})
        self.assertEqual(statecatalog.counter_name('C3', {'StateName': '""'}), 'C3')

    def test_a_counter_has_its_goal_and_looks_at_its_counter(self):
        with open(os.path.join(CLASSES, 'UCBCounter.uc'), encoding='latin1') as f:
            text = f.read()
        self.assertIn('ReachedAt=3', text)
        self.assertIn('RepeatEvery=0.500000', text)


if __name__ == '__main__':
    unittest.main()
