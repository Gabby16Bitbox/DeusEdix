"""The vocabulary of config/logic.json v2 as the editor's Python side reads it (logic_catalog.py): labels as the
families and mover words say them, levels, games, inverse verbs, typed arguments, search, Connect pairs, and the
table refused when it does not hold together. The page's sentences from the same table: tests/test_logic_vocab.mjs."""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import logic_catalog  # noqa: E402


class Words(unittest.TestCase):
    def test_labels_as_the_menus_say_them(self):
        self.assertEqual(logic_catalog.label('output', 'dies'), 'they are killed or knocked out')
        self.assertEqual(logic_catalog.label('verb', 'attack'), 'Attack the player')
        self.assertEqual(logic_catalog.label('verb', 'on', 'soundfx'), 'Play it')          # its family's own words
        self.assertEqual(logic_catalog.label('verb', 'off', 'alarm'), 'Stop the alarm')
        self.assertEqual(logic_catalog.label('verb', 'on', 'door'), 'Switch on')
        self.assertEqual(logic_catalog.label('verb', 'leave'), 'Leave (when the player does not see)')
        self.assertEqual(logic_catalog.label('output', 'leave'), 'the player walks out')            # the same id, another table
        self.assertEqual(logic_catalog.label('verb', 'bogus'), 'bogus')

    def test_a_mover_says_what_it_is(self):
        self.assertEqual([w['id'] for w in logic_catalog.mover_words()], ['door', 'bridge', 'lift', 'platform', 'hatch'])
        self.assertEqual(logic_catalog.label('verb', 'open', 'door', 'bridge'), 'Lower')
        self.assertEqual(logic_catalog.label('verb', 'close', 'door', 'lift'), 'Send it down')
        self.assertEqual(logic_catalog.label('verb', 'lock', 'door', 'bridge'), 'Lock')     # what the word leaves
        self.assertEqual(logic_catalog.label('output', 'opened', '', 'bridge'), 'it has been lowered')
        self.assertEqual(logic_catalog.entry('verb', 'open', 'bridge')['say'], 'lower {t}')
        self.assertEqual(logic_catalog.entry('verb', 'open', 'bridge')['target'], True)    # the rest is the verb's
        self.assertEqual(logic_catalog.entry('verb', 'open', 'spaceship'), logic_catalog.INPUTS['open'])
        self.assertEqual(logic_catalog.noun_of('door', 'bridge'), 'bridge')
        self.assertEqual(logic_catalog.noun_of('soundfx'), 'sound effect')
        self.assertEqual(logic_catalog.noun_of('computer'), '')

    def test_levels_games_inverse_and_arguments(self):
        self.assertEqual(logic_catalog.LEVELS, ('basic', 'more', 'advanced'))
        self.assertEqual(logic_catalog.GAMES, ('revision', 'vanilla'))
        self.assertEqual(logic_catalog.level_of('verb', 'input'), 'advanced')
        self.assertEqual(logic_catalog.level_of('output', 'finished'), 'more')
        self.assertEqual(logic_catalog.level_of('verb', 'bogus'), 'advanced')
        self.assertTrue(logic_catalog.shown_at('verb', 'open', 'basic'))
        self.assertFalse(logic_catalog.shown_at('verb', 'timerstart', 'basic'))
        self.assertTrue(logic_catalog.shown_at('verb', 'timerstart', 'more'))
        for kind, table in (('output', logic_catalog.OUTPUTS), ('verb', logic_catalog.INPUTS)):
            for key in table:
                self.assertEqual(logic_catalog.games_of(kind, key), ['revision', 'vanilla'], key)
                self.assertTrue(logic_catalog.works_in(kind, key, 'vanilla'), key)
        self.assertEqual(logic_catalog.inverse_of('open'), 'close')
        self.assertEqual(logic_catalog.inverse_of('hostile'), 'friend')
        self.assertEqual(logic_catalog.inverse_of('toggle'), '')
        self.assertEqual([a['id'] for a in logic_catalog.args_of('verb', 'count')], ['a', 'b', 'c'])
        self.assertEqual(logic_catalog.args_of('output', 'near')[0]['default'], 256)
        self.assertEqual(logic_catalog.args_of('verb', 'bogus'), [])

    def test_search_by_label_keyword_and_id(self):
        self.assertEqual(logic_catalog.search('kill'), [('output', 'dies', 'they are killed or knocked out'),
                                                        ('output', 'killed', 'they are killed'),
                                                        ('verb', 'attack', 'Attack the player')])   # not "skill points"
        self.assertIn(('verb', 'floor', 'Go to a floor'), logic_catalog.search('elevator'))
        self.assertEqual(logic_catalog.search('keypad wrong'), [('output', 'wrongcode', 'a wrong code is typed')])
        self.assertIn('input', [k for _, k, _ in logic_catalog.search('script')])
        self.assertNotIn('input', [k for _, k, _ in logic_catalog.search('script', level='basic')])
        self.assertEqual(logic_catalog.search('zzz'), [])

    def test_what_a_game_cannot_run_is_named(self):
        links = [{'id': 'L1', 'src': 'B', 'when': 'used', 'do': [{'verb': 'attack'}, {'verb': 'open'}]},
                 {'id': 'L2', 'when': 'start', 'do': [{'verb': 'message'}]}]
        self.assertEqual(logic_catalog.not_in_game(links, 'vanilla'), [])
        narrowed = copy.deepcopy(logic_catalog.TABLE)
        narrowed['inputs']['attack']['games'] = ['revision']
        narrowed['outputs']['start']['games'] = ['revision']
        with mock.patch.dict(logic_catalog.INPUTS, narrowed['inputs']), \
                mock.patch.dict(logic_catalog.OUTPUTS, narrowed['outputs']):
            self.assertEqual(logic_catalog.not_in_game(links, 'vanilla'), [('L1', 'verb', 'attack'), ('L2', 'output', 'start')])
            self.assertEqual(logic_catalog.not_in_game(links, 'revision'), [])


class Pairs(unittest.TestCase):
    def test_the_likeliest_first(self):
        self.assertEqual(logic_catalog.pairs_for('keypad', 'door')[0],
                         {'when': 'code', 'do': ['unlock', 'open'], 'ask': ['code', 'lockAtStart']})
        self.assertEqual(logic_catalog.pairs_for('object', 'door')[0], {'when': 'used', 'do': ['open']})
        self.assertEqual(logic_catalog.ask('lockAtStart'), {'label': 'Locked at the start', 'of': 'target', 'prop': 'bLocked'})
        self.assertIsNone(logic_catalog.ask('bogus'))

    def test_a_character_is_never_first_attacked(self):
        for family in logic_catalog.FAMILIES.values():
            if not family['outputs']:
                self.assertEqual(logic_catalog.pairs_for(family['id'], 'character'), [], family['id'])
                continue
            first = logic_catalog.pairs_for(family['id'], 'character')[0]
            self.assertNotEqual(first['do'][0], 'attack', family['id'])
            self.assertIn(first['when'], family['outputs'], family['id'])

    def test_pairs_for_any_source_follow_with_its_first_output_once(self):
        self.assertEqual([(p['when'], p['do']) for p in logic_catalog.pairs_for('door', 'character')],
                         [('opened', ['hostile']), ('opened', ['attack']), ('opened', ['goto']), ('opened', ['follow'])])
        self.assertEqual([p['do'] for p in logic_catalog.pairs_for('zone', 'character')],
                         [['goto'], ['hostile'], ['attack'], ['follow']])       # goto and hostile once
        self.assertEqual(logic_catalog.pairs_for('zone', 'computer'), [])
        self.assertEqual(logic_catalog.pairs_for('nothing', 'door'), [])


class Checked(unittest.TestCase):
    """A v2 table that does not hold together is refused when it is read, like a family naming an unknown output."""
    def refused(self, change):
        data = copy.deepcopy(logic_catalog.TABLE)
        change(data)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'logic.json'
            path.write_text(json.dumps(data), encoding='utf-8')
            with self.assertRaises(ValueError):
                logic_catalog._load(path)

    def test_the_table_as_it_is_is_taken(self):
        self.assertEqual(logic_catalog._load()['v'], 2)
        old = copy.deepcopy(logic_catalog.TABLE)
        for key in ('v', 'levels', 'games', 'types', 'sentence', 'movers', 'asks', 'pairs'):
            del old[key]
        with tempfile.TemporaryDirectory() as folder:                    # a table before v2 is still read
            path = Path(folder) / 'logic.json'
            path.write_text(json.dumps(old), encoding='utf-8')
            self.assertEqual(logic_catalog._load(path)['outputs'].keys(), logic_catalog.OUTPUTS.keys())

    def test_unknown_levels_games_and_types(self):
        self.refused(lambda d: d['inputs']['open'].update(level='expert'))
        self.refused(lambda d: d['outputs']['used'].update(games=['revision', 'quake']))
        self.refused(lambda d: d['inputs']['count']['args'][1].update(type='fraction'))

    def test_an_inverse_must_undo_it(self):
        self.refused(lambda d: d['inputs']['close'].update(inverse='lock'))
        self.refused(lambda d: d['inputs']['toggle'].update(inverse='bogus'))

    def test_mover_words_and_pairs_name_what_the_families_have(self):
        self.refused(lambda d: d['movers']['words'][1]['verbs'].update(attack={'label': 'Bite'}))
        self.refused(lambda d: d['pairs']['keypad']['door'].append({'when': 'used', 'do': ['open']}))      # a keypad is not used
        self.refused(lambda d: d['pairs']['zone']['door'].append({'when': 'enter', 'do': ['attack']}))
        self.refused(lambda d: d['pairs']['object']['door'].append({'when': 'used', 'do': ['open'], 'ask': ['bogus']}))
        self.refused(lambda d: d['pairs']['any']['character'].append({'when': 'used', 'do': ['goto']}))
        self.refused(lambda d: d['pairs'].update(spaceship={'door': [{'when': 'used', 'do': ['open']}]}))

    def test_mover_phases_are_two_different_ones(self):
        self.assertEqual([w.get('phases') for w in logic_catalog.mover_words()][:2], [['Closed', 'Open'], ['Raised', 'Lowered']])
        self.refused(lambda d: d['movers']['words'][1].update(phases=['Raised']))
        self.refused(lambda d: d['movers']['words'][1].update(phases=['Up', 'up']))
        self.refused(lambda d: d['movers']['words'][1].update(phases=['Up', ' ']))
        self.refused(lambda d: d['movers']['words'][1].update(phases='Up, Down'))


if __name__ == '__main__':
    unittest.main()
