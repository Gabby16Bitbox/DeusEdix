"""A map exit's URL set in the Properties panel reaches the map without quotes (Crypt Test, 20 Oct 2026): the
engine kept them in a string[64], and the game looked for a map called '"01_Crypt_Chapel'."""
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import props  # noqa: E402


class RawStrings(unittest.TestCase):
    def test_map_exit_url_loses_its_quotes(self):
        cmds = props.commands({'props': {'UCEdit1': {'URL': '"01_Crypt_Chapel#Start"'}}})
        self.assertEqual(cmds, ['UC_PROP UCEdit1 URL 01_Crypt_Chapel#Start'])

    def test_names_keep_theirs(self):
        cmds = props.commands({'props': {'UCEdit4': {'FamiliarName': '"Father Cole"'}}})
        self.assertEqual(cmds, ['UC_PROP UCEdit4 FamiliarName "Father Cole"'])


if __name__ == '__main__':
    unittest.main()
