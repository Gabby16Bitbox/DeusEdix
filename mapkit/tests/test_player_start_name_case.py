"""Play's Player start check and the people of a map: an object added in the editor and built under another letter case
(the engine knew the name already: "PS1" built as "ps1") is one object, the edit's, as Unreal names ignore case."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'editor'))
import player_start  # noqa: E402


class PlayerStartNameCase(unittest.TestCase):
    built = [dict(name='ps1', cls='PlayerStart', kind='logic'), dict(name='Light0', cls='Light', kind='light')]

    def test_a_disabled_added_start_is_not_counted_again_under_its_built_spelling(self):
        edits = dict(added=[dict(name='PS1', cls='PlayerStart', props={})], disabled={'PS1': True})
        self.assertEqual(player_start.usable(self.built, edits), [])
        with self.assertRaises(ValueError):
            player_start.require(self.built, edits)

    def test_the_edit_s_entry_wins_and_counts_once(self):
        edits = dict(added=[dict(name='PS1', cls='PlayerStart', props={})])
        self.assertEqual([a['name'] for a in player_start.usable(self.built, edits)], ['PS1'])

    def test_a_deleted_added_start_is_gone_in_any_case(self):
        edits = dict(added=[dict(name='PS1', cls='PlayerStart', props={'bEnabled': 'True'})],
                     deleted={'PS1': dict(cls='PlayerStart', orig=[0, 0, 0])})
        self.assertEqual(player_start.usable(self.built, edits), [])


if __name__ == '__main__':
    unittest.main()
