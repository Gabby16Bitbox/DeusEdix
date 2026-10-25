"""The edges of the level logic (editor/LOGIC.md): names, texts and numbers the game reads its own way, the classes
that must never be hooked, scripts written the old way or with typographic text, and a Story that cannot be built
yet. Each test holds a defect found in the review of 25 Oct 2026."""
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import comptexts  # noqa: E402
import conditions  # noqa: E402
import gametext  # noqa: E402
import links  # noqa: E402
import logic_catalog  # noqa: E402
import scripts  # noqa: E402
import story  # noqa: E402


def link_props(edits):
    return next(b['props'] for b in links.blocks(edits) if b['cls'] == 'UCLink')


def rule(**kw):
    return dict(dict(id='L1', src='Button1', when='used', do=[dict(verb='message', a='Hi')]), **kw)


class Names(unittest.TestCase):
    def test_names_are_what_the_script_compiler_takes(self):
        self.assertEqual(conditions.ident('Trova_la_città'), 'Trova_la_citta')      # was kept: no compile
        self.assertEqual(conditions.ident('Сигнал'), '______')     # a valid name still
        self.assertEqual(conditions.ident('2ndFloor', 'G'), 'G_2ndFloor')
        self.assertEqual(len(conditions.ident('A' * 70)), 60)
        self.assertEqual(conditions.name_of('Società'), conditions.ident('Società'))

    def test_a_rule_names_states_and_goals_as_the_story_does(self):
        long_state = 'Crypt_' + 'G' * 60
        self.assertEqual(links.act_string({'verb': 'flag', 'a': long_state, 'b': '1'}).split('|')[3], story.ident(long_state))
        self.assertEqual(links.act_string({'verb': 'goal', 'a': '2nd floor', 'b': 'Go up'}).split('|')[3],
                         story.ident('2nd floor', 'G'))

    def test_an_action_with_no_name_is_built_with_none(self):
        # UCLink then logs fail|...|noname: a shared hidden counter X_ never
        self.assertEqual(links.act_string({'verb': 'count', 'a': '  ', 'b': '1'}), '0|count|||1|')
        self.assertEqual(links.act_string({'verb': 'flag', 'a': '', 'b': '1'}), '0|flag|||1|')

    def test_an_infinite_number_is_a_wrong_value_not_a_crash(self):
        for value in (float('inf'), json.loads('1e400'), float('-inf')):
            with self.assertRaisesRegex(ValueError, 'whole number'):
                conditions.check([{'type': 'credits', 'op': '>=', 'value': value}])
        with self.assertRaisesRegex(ValueError, 'Interaction L1'):
            links.blocks({'links': [rule(requires=[{'type': 'credits', 'op': '>=', 'value': float('inf')}])]})


class Texts(unittest.TestCase):
    def test_typographic_punctuation_reaches_the_game_plain(self):
        said = links.act_string({'verb': 'message', 'a': 'Don’t move — they’re coming… “now”'})
        self.assertEqual(said, "0|message||Don't move - they're coming... 'now'||")

    def test_backslashes_are_written_as_the_engines_reader_takes_them(self):
        back = chr(92)
        props = link_props({'links': [rule(label='a' + back + 'b', do=[dict(verb='message', a='Press ' + back + ' to lean')])]})
        self.assertEqual(props['Act(0)'], '"0|message||Press ' + back * 2 + ' to lean||"')
        self.assertEqual(props['Label'], '"a' + back * 2 + 'b"')
        usable = next(b for b in links.blocks({'usable': {'Crate0': {'text': 'C:' + back + 'x'}}}) if b['cls'] == 'UCUsable')
        self.assertEqual(usable['props']['UseText'], '"C:' + back * 2 + 'x"')

    def test_cutscene_texts_as_the_rules(self):
        import cutscenes
        back = chr(92)
        c = {'title': 'Intro', 'lines': [{'t': 0, 'd': 2, 'who': 'Paul', 'text': 'Saved to C:' + back + 'Data \u2014 don\u2019t move'}]}
        props = cutscenes.props({'cutscenes': {'Cut0': c}}, 'Cut0')
        self.assertEqual(props['LineText(0)'], '"Saved to C:' + back * 2 + "Data - don't move" + '"')

    def test_a_quote_in_a_computer_text_is_the_byte_22(self):
        # ReadToken has no \" : it read the quote as a hex digit, a NUL, and the email ended there
        self.assertEqual(gametext.t3d('He said "hi" ' + chr(92)), 'He said ' + chr(92) + '22hi' + chr(92) + '22 ' + chr(92) * 2)
        texts = {'Computer0': {'emails': [{'user': 'jc', 'subject': 'S', 'body': 'He said "hi"'}]}}
        quoted = [b['props']['Text'] for b in comptexts.blocks({'texts': texts}, '01_Map') if b['cls'] == 'UCTextBlock']
        self.assertTrue(quoted and all(chr(92) + '"' not in q for q in quoted))
        self.assertTrue(any(chr(92) + '22hi' + chr(92) + '22' in q for q in quoted))


class Catalogue(unittest.TestCase):
    def test_triggers_that_aim_their_event_are_never_offered_its_outputs(self):
        for chain in (['ElevatorTrigger'], ['PawnAppearTrigger'], ['TriggerTrigger', 'MoreTriggers', 'Trigger', 'Actor'],
                      ['UnTrigger', 'Trigger', 'Triggers', 'Actor'], ['RevStateTrigger', 'Trigger', 'Triggers', 'Actor']):
            io = logic_catalog.io_for(chain)
            self.assertEqual((io['family'], io['outputs'], io['inputs']), ('targettrigger', ['near'], ['on']), chain[0])
        self.assertEqual(logic_catalog.io_for(['Trigger', 'Triggers', 'Actor'])['outputs'], ['enter', 'leave'])

    def test_revisions_other_moretriggers(self):
        damage = logic_catalog.io_for(['DamageTriggerDirect'])          # burning floors: switched off by a rule
        self.assertEqual((damage['family'], damage['inputs']), ('switchtrigger', ['on', 'off']))
        flagged = logic_catalog.io_for(['FlaggedActorTrigger', 'MoreTriggers', 'Trigger', 'Actor'])
        self.assertEqual((flagged['family'], flagged['outputs']), ('moretrigger', ['leave', 'near']))   # (UnTouch)
        self.assertEqual(logic_catalog.io_for(['CreditsTrigger'])['family'], 'moretrigger')


class Scripts(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        patcher = mock.patch.object(scripts, 'CLASSES', self.folder)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_the_old_word_expands(self):
        (self.folder / 'GenB.uc').write_text('class GenB expands UCScript;\n', encoding='latin1')
        (self.folder / 'ModDoor.uc').write_text('class ModDoor\n\texpands DeusExMover;\n', encoding='latin1')
        self.assertEqual(scripts.lineage('GenB'), (['GenB'], 'UCScript'))
        self.assertEqual(scripts.lineage('ModDoor'), (['ModDoor'], 'DeusExMover'))

    def test_a_weapon_of_tools_weapons_has_its_game_class_above(self):
        (self.folder / 'UCW_Proto.uc').write_text('class UCW_Proto extends WeaponPistol;\n', encoding='latin1')
        cls = scripts.PACKAGE + '.UCW_Proto'
        self.assertFalse(scripts.is_script_class(cls))                    # not a script of Tools > Scripts
        self.assertTrue(scripts.is_script_class(cls, generated=True))     # but its family comes from its base
        self.assertEqual(scripts.lineage('UCW_Proto', generated=True), (['UCW_Proto'], 'WeaponPistol'))

    def test_a_script_is_saved_as_the_game_reads_it(self):
        scripts.save('Say', 'class Say extends UCScript;\n// It’s open — “yes”…\n')
        self.assertEqual(scripts.read('Say').splitlines()[1], "// It's open - 'yes'...")      # (in a comment: ')
        with self.assertRaisesRegex(ValueError, 'Line 2'):
            scripts.save('Say', 'class Say extends UCScript;\n// ☃ snow\n')
        self.assertIn("It's open", scripts.read('Say'))                    # the refused text was not written

    def test_curly_quotes_never_end_a_string(self):
        scripts.save('Quote', 'class Quote extends UCScript;\nfunction Started() { Say("\u201cStop!\u201d he said"); }\n'
                     'function Repeat() { Say(\u201cHi\u201d); }\n'
                     'defaultproperties\n{\n Outputs(0)=(Id="Done",Label="the \u201cdone\u201d signal")\n}\n')
        lines = scripts.read('Quote').splitlines()
        self.assertEqual(lines[1].count('"'), 2)                            # inside a string: '
        self.assertIn('Say("Hi")', lines[2])                                # pasted code: they were its quotes
        self.assertEqual(scripts.ports('Quote')['outputs'], [{'id': 'Done', 'label': "the 'done' signal"}])

    def test_a_curly_quoted_string_with_a_comment_mark_in_it(self):
        scripts.save('Link', 'class Link extends UCScript;\nfunction Started() { Log(\u201csee http://x\u201d); '
                     'Say(\u201ca /* b\u201d); Say(\u201cc */ d\u201d); }\n')
        self.assertIn('Log("see http://x"); Say("a /* b"); Say("c */ d");', scripts.read('Link'))


class Console(unittest.TestCase):
    GAME = KIT.parents[1] / 'DevInstall'

    @unittest.skipUnless((KIT.parents[1] / 'DevInstall' / 'Engine' / 'Classes' / 'PlayerPawn.uc').is_file(), 'no game sources here')
    def test_the_console_turns_on_the_cheats_for_exactly_the_commands_the_game_gates(self):
        import re
        link = (KIT / 'project-template' / 'src' / 'DeusEdix' / 'Classes' / 'UCConsoleLink.uc').read_text(encoding='latin1')
        listed = set(re.search(r'Cheats="\|(.*)\|"', link).group(1).split('|'))
        classes = {}
        for f in self.GAME.glob('*/Classes/*.uc'):
            text = f.read_text(encoding='latin1', errors='replace')
            m = re.search(r'^class\s+(\w+)\s+(?:extends|expands)\s+(\w+)', text, re.M | re.I)
            if m:
                classes[m.group(1).lower()] = (m.group(2).lower(), text)

        def player(c, depth=0):
            return c == 'playerpawn' or (c in classes and depth < 40 and player(classes[c][0], depth + 1))
        gated = set()
        for c, (_, text) in classes.items():
            if not player(c):
                continue
            for m in re.finditer(r'exec\s+function\s+(?:\w+\s+)?(\w+)\s*\([^)]*\)\s*\{', text, re.I):
                depth, i = 1, m.end()
                while depth and i < len(text):
                    depth += {'{': 1, '}': -1}.get(text[i], 0)
                    i += 1
                if re.search(r'if\s*\(\s*!\s*bCheatsEnabled\s*\)', re.sub(r'//[^\n]*', '', text[m.end():i]), re.I):
                    gated.add(m.group(1).lower())
        self.assertEqual(listed, gated)


class Stories(unittest.TestCase):
    def test_a_state_row_never_filled_in_is_not_compiled_as_X(self):
        options = [{'text': 'Open it', 'requires': [{'flag': '', 'is': True}, {'flag': 'Seen', 'is': True}]}]
        d = {'id': 'd1', 'owner': 'Guard0', 'steps': [{'type': 'choice', 'options': options},
                                                       {'type': 'flag', 'flag': 'Talked', 'requires': [{'flag': ''}]}]}
        code = story.generate('TestMap', {'dialogues': [d]})
        self.assertIn("c.AnswerFlag('Seen'", code)
        self.assertNotIn("'X_'", code)

    def test_a_state_step_with_no_state_is_refused_naming_the_dialogue(self):
        d = {'id': 'd1', 'title': 'Guard', 'owner': 'Guard0', 'steps': [{'type': 'flag', 'flag': '', 'requires': [{'flag': ''}]}]}
        with self.assertRaisesRegex(ValueError, 'no state in Guard'):
            story.generate('TestMap', {'dialogues': [d]})

    def test_a_state_action_with_no_state_is_refused_when_built(self):
        st = {'events': [{'id': 'e1', 'title': 'Go', 'when': {'type': 'start'}, 'do': [{'type': 'flag', 'flag': ''}]}]}
        with self.assertRaisesRegex(ValueError, 'no state in event Go'):
            story.generate('TestMap', st)
        import originalstory
        originalstory.validate(st)                                     # a draft keeps it (the Story's autosave)

    def test_one_maps_unfinished_story_does_not_stop_anothers_play(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'story').mkdir()
            (root / 'classes').mkdir()
            draft = {'events': [{'id': 'e1', 'title': 'Vault', 'when': {'type': 'start'},
                                 'requires': [{'type': 'item', 'item': ''}], 'do': [{'type': 'flag', 'flag': 'A'}]}]}
            ready = {'events': [{'id': 'e1', 'title': 'Hello', 'when': {'type': 'start'}, 'do': [{'type': 'flag', 'flag': 'B'}]}]}
            (root / 'story' / '01_A.json').write_text(json.dumps(draft), encoding='utf-8')
            (root / 'story' / '02_B.json').write_text(json.dumps(ready), encoding='utf-8')
            kept = root / 'classes' / (story.class_name('01_A') + '.uc')
            kept.write_text('// the class it had', encoding='latin1')
            sounds = types.SimpleNamespace(write_dub_registry=lambda: None)
            with mock.patch.object(story, 'STORY', root / 'story'), mock.patch.object(story, 'CLASSES', root / 'classes'), \
                    mock.patch.dict(sys.modules, {'sounds': sounds}):
                report = story.write_all(current='02_B')
                self.assertTrue((root / 'classes' / (story.class_name('02_B') + '.uc')).is_file())
                self.assertEqual(kept.read_text(encoding='latin1'), '// the class it had')
                self.assertTrue(any('01_A not built again' in line for line in report))
                for current in ('01_A', None):                          # its own Play, and Export mod: stop, naming it
                    with self.assertRaisesRegex(ValueError, 'Story of 01_A: Event "Vault"'):
                        story.write_all(current=current)


if __name__ == '__main__':
    unittest.main()
