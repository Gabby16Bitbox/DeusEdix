"""The project's Logic runtime (editor/logicruntime.py, P6), kept for one release as a way back: v2 (a rule that needs
the new options a UCRule, the others UCLinks), classic (every rule a UCLink; one that needs the new options stops the
build, named, with what it has), all (every rule a UCRule: the golden-log parity test). The project's file, the edits
the builds read (apply), links.blocks, and the Logic window's check (logic_compile) say the same."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402
import logic_compile  # noqa: E402
import logicruntime  # noqa: E402

FIX = Path(HERE) / 'fixtures' / 'logic'
PLAIN = dict(id='L1', src='Button1', when='used', label='When the player uses Button1: open Door1',
             do=[dict(id='a1', verb='open', target='Door1', delay=0), dict(id='a2', verb='message', a='Hi', delay=2)])
NEW = dict(PLAIN, id='L2', cooldown=2, also=[dict(src='Lever1', when='used')])


def classes(blocks):
    return sorted(b['cls'] for b in blocks if b['cls'] in ('UCLink', 'UCRule', 'UCRuleAlso'))


class Runtime(unittest.TestCase):
    def test_file_roundtrip_and_default(self):
        with tempfile.TemporaryDirectory() as kit:
            self.assertEqual(logicruntime.load(kit), 'v2')
            self.assertEqual(logicruntime.save('classic', kit), 'classic')
            self.assertEqual(json.loads(logicruntime.path(kit).read_text(encoding='utf-8')),
                             {'version': 1, 'runtime': 'classic'})
            self.assertEqual(logicruntime.load(kit), 'classic')
            self.assertEqual(logicruntime.save('v2', kit), 'v2')
            self.assertFalse(logicruntime.path(kit).exists())      # the default needs no file
            with self.assertRaises(ValueError):
                logicruntime.save('fast', kit)
            logicruntime.path(kit).parent.mkdir(exist_ok=True)
            logicruntime.path(kit).write_text('{"runtime": "nonsense"}', encoding='utf-8')
            self.assertEqual(logicruntime.load(kit), 'v2')
            logicruntime.path(kit).write_text('not json', encoding='utf-8')
            self.assertEqual(logicruntime.load(kit), 'v2')

    def test_apply_replaces_what_a_map_saved(self):
        e = {'links': [PLAIN]}
        self.assertIs(logicruntime.apply(e, 'v2'), e)
        self.assertEqual(logicruntime.apply(e, 'classic')['logicRuntime'], 'classic')
        self.assertNotIn('logicRuntime', e)                            # a copy
        saved = dict(e, logicRuntime='classic')                        # a page saved it with the map
        self.assertNotIn('logicRuntime', logicruntime.apply(saved, 'v2'))
        self.assertEqual(logicruntime.apply(saved, 'all')['logicRuntime'], 'all')
        self.assertEqual(logicruntime.of({'logicRuntime': 'weird'}), 'v2')

    def test_v2_builds_each_rule_as_it_needs(self):
        self.assertEqual(classes(links.blocks({'links': [PLAIN, NEW]})), ['UCLink', 'UCRule', 'UCRuleAlso'])

    def test_classic_builds_plain_rules_and_refuses_new_ones_by_name(self):
        e = logicruntime.apply({'links': [PLAIN]}, 'classic')
        self.assertEqual(links.blocks(e), links.blocks({'links': [PLAIN]}))      # exactly what v2 builds
        with self.assertRaises(ValueError) as cm:
            links.blocks(logicruntime.apply({'links': [PLAIN, NEW]}, 'classic'))
        msg = str(cm.exception)
        self.assertIn('Interaction L2', msg)
        self.assertIn('another cause', msg)
        self.assertIn('a cooldown', msg)
        self.assertIn('Classic rules', msg)
        # the Logic window's check says it too
        self.assertIn('Interaction L2', logic_compile.compiled(logicruntime.apply({'links': [NEW]}, 'classic'))['error'])
        self.assertEqual(logic_compile.compiled(logicruntime.apply({'links': [PLAIN]}, 'classic'))['error'], '')

    def test_each_new_option_has_its_words(self):
        for extra, words in [(dict(match='any', requires=[{'type': 'flag', 'flag': 'A', 'is': True},
                                                          {'type': 'flag', 'flag': 'B', 'is': True}]), 'any of these'),
                             (dict(**{'else': [dict(id='e1', verb='message', a='No')]}), 'an Otherwise'),
                             (dict(again='each'), 'set off again'), (dict(max=3), 'at most 3 times'),
                             (dict(talkBusy='wait'), 'while the player talks'),
                             (dict(do=[dict(id='a1', verb='hide', target='@by', delay=0)]), 'what set it off')]:
            rule = dict(PLAIN, **extra)
            self.assertIn(words, links.classic_refusal('L1', rule), extra)
        self.assertEqual(links.classic_refusal('L1', PLAIN), '')

    def test_all_builds_every_rule_as_a_ucrule(self):
        b = links.blocks(logicruntime.apply({'links': [PLAIN]}, 'all'))
        self.assertEqual(classes(b), ['UCRule'])
        props = [x for x in b if x['cls'] == 'UCRule'][0]['props']
        self.assertEqual(props['bSteps'], 'True')            # a UCRule runs a list of steps (as_steps: delays between)
        self.assertEqual(props['ActId(0)'], '"a1"')

    def test_the_golden_fixtures_build_under_all(self):
        """every behaviour fixture the in-game parity run plays (backup/20261110_golden) builds as UCRules"""
        chosen = ['action_without_name', 'actions_in_delay_order', 'area_dynamic', 'conditions_before_actions',
                  'counter_actions', 'running_ignores_refire', 'self_retrigger_skips_running', 'timer_finished',
                  'timer_pause_resume', 'timer_stopped_only_when_running', 'zero_delay_loop', 'start_rule',
                  'used_and_any_one_event']
        for name in chosen:
            fx = json.loads((FIX / (name + '.json')).read_text(encoding='utf-8'))
            got = classes(links.blocks(logicruntime.apply(fx['edits'], 'all')))
            self.assertTrue(got and set(got) == {'UCRule'}, (name, got))


if __name__ == '__main__':
    unittest.main()
