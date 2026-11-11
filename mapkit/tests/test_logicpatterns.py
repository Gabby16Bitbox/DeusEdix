"""The project's logic patterns (P8 slice 2, editor/logicpatterns.py): kept in tools/mapkit/logic/patterns/<slug>.json,
a version more each time one of the same name is saved. tests/test_logic_patterns.mjs tests what a version holds."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import logicpatterns  # noqa: E402

VERSION = dict(rules=[dict(id='R1', src='{door}', when='opened', do=[dict(verb='message', a='open')])],
               slots=[dict(id='door', words='the door', family='door', carried=False)], ports=[], states=[])


class Patterns(unittest.TestCase):
    def setUp(self):
        self.kit = Path(tempfile.mkdtemp(prefix='patterns'))

    def tearDown(self):
        shutil.rmtree(self.kit, ignore_errors=True)

    def test_a_pattern_saved_twice_has_two_versions(self):
        first = logicpatterns.save('Alarm network', VERSION, kit=self.kit, now=0)
        self.assertEqual((first['slug'], first['name'], first['v'], first['rules']), ('alarm-network', 'Alarm network', 1, 1))
        self.assertEqual(first['slots'], [dict(id='door', words='the door', family='door', carried=False)])
        again = logicpatterns.save('alarm NETWORK', dict(VERSION, rules=VERSION['rules'] * 2), kit=self.kit)
        self.assertEqual((again['slug'], again['v'], again['versions'], again['rules']), ('alarm-network', 2, 2, 2))
        kept = logicpatterns.load('alarm-network', kit=self.kit)
        self.assertEqual([v['v'] for v in kept['versions']], [1, 2])
        self.assertEqual(set(kept['versions'][0]), {'v', 'made', 'rules', 'pieces', 'objects', 'slots', 'ports', 'states'})
        self.assertEqual(kept['name'], 'Alarm network')       # the name it was first saved with
        on_disk = json.loads((self.kit / 'logic' / 'patterns' / 'alarm-network.json').read_text(encoding='utf-8'))
        self.assertEqual(on_disk['version'], 1)
        self.assertEqual([p['name'] for p in logicpatterns.listed(kit=self.kit)], ['Alarm network'])

    def test_another_name_with_the_same_file_name_gets_its_own_file(self):
        logicpatterns.save('Keycard door', VERSION, kit=self.kit)
        other = logicpatterns.save('Keycard-door', VERSION, kit=self.kit)
        self.assertEqual(other['slug'], 'keycard-door-2')
        self.assertEqual(sorted(p['slug'] for p in logicpatterns.listed(kit=self.kit)), ['keycard-door', 'keycard-door-2'])

    def test_what_is_refused(self):
        for name, version, why in [('', VERSION, 'needs a name'), ('X' * 81, VERSION, 'at most 80'), ('A', dict(VERSION, rules=[]), 'at least one rule'),
                                   ('A', None, 'needs its rules'), ('A', dict(VERSION, slots='no'), 'must be a list')]:
            with self.assertRaisesRegex(ValueError, why):
                logicpatterns.save(name, version, kit=self.kit)
        self.assertEqual(logicpatterns.listed(kit=self.kit), [])

    def test_a_file_that_cannot_be_read_is_never_overwritten(self):
        d = self.kit / 'logic' / 'patterns'
        d.mkdir(parents=True)
        (d / 'broken.json').write_text('{not json', encoding='utf-8')
        kept = logicpatterns.save('Broken', VERSION, kit=self.kit)
        self.assertEqual(kept['slug'], 'broken-2')
        self.assertEqual((d / 'broken.json').read_text(encoding='utf-8'), '{not json')
        self.assertEqual([p['slug'] for p in logicpatterns.listed(kit=self.kit)], ['broken-2'])

    def _shipped(self, slug, name, versions):
        d = self.kit / 'editor' / 'config' / 'patterns'
        d.mkdir(parents=True, exist_ok=True)
        (d / (slug + '.json')).write_text(json.dumps(dict(version=1, name=name, versions=[
            dict(VERSION, v=n, made='2026-11-10T00:00:00') for n in range(1, versions + 1)])), encoding='utf-8')

    def test_the_library_is_listed_and_loaded_with_the_project(self):
        self._shipped('keycard-door', 'Keycard door', 2)
        logicpatterns.save('Alarm network', VERSION, kit=self.kit)
        got = logicpatterns.listed(kit=self.kit)
        self.assertEqual([(p['name'], p['shipped'], p['v']) for p in got], [('Alarm network', False, 1), ('Keycard door', True, 2)])
        self.assertTrue(logicpatterns.load('keycard-door', kit=self.kit)['shipped'])
        self.assertFalse(logicpatterns.load('alarm-network', kit=self.kit)['shipped'])
        edits = dict(logic=dict(instances=[dict(id='P1', pattern='keycard-door', v=2, slots=dict(door='D1'))]))
        self.assertIn('keycard-door@2', logicpatterns.apply(edits, kit=self.kit)['logicPatterns'])

    def test_a_shipped_pattern_saved_again_goes_on_in_the_project(self):
        self._shipped('keycard-door', 'Keycard door', 2)
        lib = (self.kit / 'editor' / 'config' / 'patterns' / 'keycard-door.json').read_bytes()
        again = logicpatterns.save('keycard door', dict(VERSION, rules=VERSION['rules'] * 3), kit=self.kit)
        self.assertEqual((again['slug'], again['v'], again['versions'], again['name']), ('keycard-door', 3, 3, 'Keycard door'))
        self.assertEqual((self.kit / 'editor' / 'config' / 'patterns' / 'keycard-door.json').read_bytes(), lib)   # never written
        mine = logicpatterns.load('keycard-door', kit=self.kit)
        self.assertFalse(mine['shipped'])
        self.assertEqual([len(v['rules']) for v in mine['versions']], [1, 1, 3])
        self.assertEqual([(p['slug'], p['shipped']) for p in logicpatterns.listed(kit=self.kit)], [('keycard-door', False)])
        other = logicpatterns.save('Keycard-Door!', VERSION, kit=self.kit)     # the same slug, another name
        self.assertEqual(other['slug'], 'keycard-door-2')

    def test_names_that_are_not_patterns(self):
        self.assertIsNone(logicpatterns.load('../x', kit=self.kit))
        self.assertIsNone(logicpatterns.load('nothing', kit=self.kit))
        self.assertEqual(logicpatterns.slug_of('  Two-floor  elevator! '), 'two-floor-elevator')
        self.assertEqual(logicpatterns.slug_of('???'), 'pattern')


FIXTURES = KIT / 'tests' / 'fixtures' / 'logic_patterns'


class Placed(unittest.TestCase):
    """Patterns placed in a map (P8 slice 3): edits.logic.instances written out at build"""

    def setUp(self):
        self.kit = Path(tempfile.mkdtemp(prefix='placed'))

    def tearDown(self):
        shutil.rmtree(self.kit, ignore_errors=True)

    def test_expand_as_the_fixture_says(self):
        edits = json.loads((FIXTURES / 'expand_input.json').read_text(encoding='utf-8'))['edits']
        want = json.loads((FIXTURES / 'expand_expected.json').read_text(encoding='utf-8'))
        out = logicpatterns.expand(edits)
        self.assertEqual((out['links'], out['logic']), (want['links'], want['logic']))
        self.assertEqual(out['logicPatterns'], edits['logicPatterns'])         # the rest as it was
        self.assertEqual([i['id'] for i in logicpatterns.instances(edits)], ['P1', 'P2', 'P3'])

    def test_nothing_placed_is_the_same_edits(self):
        edits = dict(links=[dict(id='L1')])
        self.assertIs(logicpatterns.expand(edits), edits)
        self.assertIs(logicpatterns.apply(edits, kit=self.kit), edits)

    def test_apply_puts_the_versions_used(self):
        one = logicpatterns.save('Door watch', VERSION, kit=self.kit)
        logicpatterns.save('Door watch', dict(VERSION, rules=VERSION['rules'] * 2), kit=self.kit)
        edits = dict(logic=dict(instances=[dict(id='P1', pattern=one['slug'], v=1, slots=dict(door='Door1')),
                                           dict(id='P2', pattern='gone', v=1, slots={})]),
                     logicPatterns={'stale@1': {}})
        out = logicpatterns.apply(edits, kit=self.kit)
        self.assertEqual(list(out['logicPatterns']), ['door-watch@1'])
        self.assertEqual(out['logicPatterns']['door-watch@1']['name'], 'Door watch')
        self.assertEqual(len(out['logicPatterns']['door-watch@1']['rules']), 1)
        self.assertNotIn('logicPatterns', logicpatterns.apply(dict(logicPatterns={'x@1': {}}), kit=self.kit))
        # a map saved with a version the project does not have (from another project) keeps its copy
        theirs = dict(v=3, name='Theirs', rules=[dict(id='R1', src='{door}', when='opened')], slots=[])
        out = logicpatterns.apply(dict(logic=dict(instances=[dict(id='P1', pattern='theirs', v=3, slots={})]),
                                       logicPatterns={'theirs@3': theirs, 'theirs@2': theirs}), kit=self.kit)
        self.assertEqual(out['logicPatterns'], {'theirs@3': theirs})

    def test_the_build_writes_their_rules(self):
        import links
        logicpatterns.save('Door watch', VERSION, kit=self.kit)
        edits = logicpatterns.apply(dict(links=[], added=[], deleted={},
                                         logic=dict(instances=[dict(id='P1', pattern='door-watch', v=1, slots=dict(door='Door1'))])), kit=self.kit)
        built = {b['name']: b for b in links.blocks(edits)}
        self.assertIn('UCLink_P1_R1', built)
        self.assertIn('Door1', json.dumps(built['UCLink_P1_R1']['props']))
        edits['logic']['instances'][0]['name'] = 'Door watch'
        self.assertIn("  EDIT interaction P1_R1: the pattern 'Door watch': Door1 opened", links.report(edits))


if __name__ == '__main__':
    unittest.main()
