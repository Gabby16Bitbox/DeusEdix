"""The example maps and the library of patterns that come with the editor (P8 slice 4: editor/examples.py,
editor/config/examples, editor/config/patterns): the Logic Lab is copied into a project's maps once and never over a map
of the project, and every pattern of the library is one the editor can place (each place a rule names, each block it
brings a logic block), the Logic Lab placing each of them with every place filled."""
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import examples  # noqa: E402
import logicpatterns  # noqa: E402

LIBRARY = KIT / 'editor' / 'config' / 'patterns'
BLOCKS = {'UCBAllOf', 'UCBAtLeast', 'UCBCounter', 'UCBFirstOf', 'UCBGate', 'UCBPhases', 'UCBSwitch', 'UCTimer'}


class Examples(unittest.TestCase):
    def setUp(self):
        self.maps = Path(tempfile.mkdtemp(prefix='examples'))

    def tearDown(self):
        shutil.rmtree(self.maps, ignore_errors=True)

    def test_the_logic_lab_is_copied_once(self):
        got = examples.open_example('logic_lab', maps=self.maps, names=[])
        self.assertEqual(got, dict(script='new_25_logic_lab', map='25_Logic_Lab', copied=True))
        src = examples.folder()
        for name in ('new_25_logic_lab.py', 'new_25_logic_lab.edits.json'):
            self.assertEqual((self.maps / name).read_bytes(), (src / name).read_bytes())
        (self.maps / 'new_25_logic_lab.edits.json').write_text('{"mine": 1}', encoding='utf-8')     # changed in the project
        again = examples.open_example('logic_lab', maps=self.maps, names=['25_Logic_Lab'])
        self.assertFalse(again['copied'])
        self.assertEqual((self.maps / 'new_25_logic_lab.edits.json').read_text(encoding='utf-8'), '{"mine": 1}')

    def test_never_over_a_map_of_the_project(self):
        with self.assertRaisesRegex(ValueError, 'already has a map called 25_Logic_Lab'):
            examples.open_example('logic_lab', maps=self.maps, names=['25_logic_lab'])
        (self.maps / 'new_25_logic_lab.edits.json').write_text('{}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'without its map script'):
            examples.open_example('logic_lab', maps=self.maps, names=[])
        self.assertFalse((self.maps / 'new_25_logic_lab.py').exists())
        with self.assertRaisesRegex(ValueError, 'no example'):
            examples.open_example('../x', maps=self.maps, names=[])


class Library(unittest.TestCase):
    def test_every_pattern_can_be_placed(self):
        files = sorted(LIBRARY.glob('*.json'))
        self.assertEqual(len(files), 10)
        for f in files:
            with self.subTest(pattern=f.stem):
                data = logicpatterns._read(f)
                self.assertIsNotNone(data)
                self.assertTrue(logicpatterns.SLUG.match(f.stem))
                for v in data['versions']:
                    logicpatterns._check(v)
                    slots = {s['id']: s for s in v['slots']}
                    text = json.dumps(v['rules'])
                    self.assertEqual(set(re.findall(r'\{([a-z][a-z0-9_]*)\}', text)), set(slots))   # each place is used
                    carried = {s for s, x in slots.items() if x['carried']}
                    self.assertEqual({o['slot'] for o in v['objects']}, carried)
                    self.assertTrue(all(o['cls'] in BLOCKS for o in v['objects']))
                    self.assertTrue(all(s['words'].startswith('the ') for s in v['slots']))
                    self.assertEqual([r['id'] for r in v['rules']], ['R%d' % (i + 1) for i in range(len(v['rules']))])

    def test_the_logic_lab_places_each_with_every_place_filled(self):
        edits = json.loads((examples.folder() / 'new_25_logic_lab.edits.json').read_text(encoding='utf-8'))
        names = {a['name'] for a in edits['added']}
        script = (examples.folder() / 'new_25_logic_lab.py').read_text(encoding='utf-8')
        placed = edits['logic']['instances']
        self.assertEqual(sorted(i['pattern'] for i in placed), sorted(f.stem for f in LIBRARY.glob('*.json')))
        for inst in placed:
            v = logicpatterns.load(inst['pattern'], kit=KIT)['versions'][-1]
            self.assertEqual(inst['v'], v['v'])
            self.assertEqual(set(inst['slots']), {s['id'] for s in v['slots']})
            for obj in inst['slots'].values():          # an object placed in the editor, or a mover of the map script
                self.assertTrue(obj in names or "name='%s'" % obj in script or "'%s'" % obj in script, obj)
        rules = logicpatterns.expand(logicpatterns.apply(edits, kit=KIT))['links']
        self.assertEqual(len([r for r in rules if r.get('instance')]), sum(len(logicpatterns.load(i['pattern'], kit=KIT)['versions'][-1]['rules']) for i in placed))


if __name__ == '__main__':
    unittest.main()
