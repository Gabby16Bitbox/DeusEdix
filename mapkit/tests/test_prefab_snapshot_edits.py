"""What a prefab's build receipt compares (editor/prefab_snapshot.py engine_edits): the Hierarchy's own state (its
nests, their order, the folder new objects go in) does not change the built map, so changing it asks for no Rebuild."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'editor'), str(ROOT)]
import prefab_snapshot


class EngineEditsTest(unittest.TestCase):
    def test_hierarchy_state_is_left_out(self):
        built = {'moved': {'Crate0': {'loc': [1.0, 2, 3]}}, 'boxes': []}
        now = dict(built, nests=[{'id': 'n1', 'label': 'Office 2 props', 'items': ['a:Crate0']}],
                   order=['a:Crate0'], defaultFolder='n1')
        self.assertEqual(prefab_snapshot.engine_edits(now), prefab_snapshot.engine_edits(built))
        self.assertEqual(prefab_snapshot.engine_edits(now), {'moved': {'Crate0': {'loc': [1, 2, 3]}}})

    def test_a_change_to_the_map_still_counts(self):
        built = {'moved': {'Crate0': {'loc': [1, 2, 3]}}}
        moved = {'moved': {'Crate0': {'loc': [1, 2, 4]}}, 'defaultFolder': 'n1'}
        self.assertNotEqual(prefab_snapshot.engine_edits(moved), prefab_snapshot.engine_edits(built))


if __name__ == '__main__':
    unittest.main()
