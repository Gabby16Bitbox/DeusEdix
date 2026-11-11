"""Your own blocks in the Logic window (P8 slice 1, editor/static/logic-boxes.js, edits['logic']['boxes']) are only a
way of looking at the rules: the build (links.py) makes exactly the same actors with them as without.
tests/test_logic_boxes.mjs tests what the window draws."""
import copy
import json
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import logic_compile  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / 'fixtures' / 'logic'


class BoxesChangeNothing(unittest.TestCase):
    def test_every_fixture_builds_the_same_with_its_rules_in_blocks(self):
        found = [json.loads(p.read_text(encoding='utf-8')) for p in sorted(FIXTURES.glob('*.json'))]
        self.assertGreaterEqual(len(found), 25)
        for fx in found:
            edits = copy.deepcopy(fx['edits'])
            rules = [l['id'] for l in edits.get('links') or [] if isinstance(l, dict) and l.get('id')]
            logic = edits.setdefault('logic', {})
            self.assertIsInstance(logic, dict, fx['id'])
            half = len(rules) // 2
            logic['boxes'] = [
                {'id': 'X1', 'name': 'First half', 'rules': rules[:half], 'pieces': [], 'parent': None,
                 'ports': {'in:obj:Button1|out:used': 'Pressed'}},
                {'id': 'X2', 'name': 'Inside', 'rules': rules[half:], 'pieces': ['blk:B1'], 'parent': 'X1', 'ports': {}}]
            self.assertEqual(logic_compile.compiled(edits), logic_compile.compiled(fx['edits']), fx['id'])


if __name__ == '__main__':
    unittest.main()
