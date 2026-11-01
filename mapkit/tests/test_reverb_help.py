"""The Inspector's help of the OpenAL reverb row (editor/props.py FIELDS) says only what the Reverb row does (app.js
reverbField, only read here): that a water zone keeps its own reverb (None puts it back) only once reverbField gives
zone-reverb.js the class's own preset, not `!!fieldOf(a, EFX)`, which is RP_None for every class (#3 of part A2,
28 Oct 2026: the help promised it while None wrote RP_None over a WaterZone's RP_Underwater). The two change in one
step (for_part_b.md section 1: 1a with 1e)."""
import re
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import props  # noqa: E402

APP = KIT / 'editor' / 'static' / 'app.js'


class ReverbHelpTest(unittest.TestCase):
    def test_the_help_says_what_the_row_does(self):
        source = APP.read_text(encoding='utf-8').replace('\r\n', '\n')
        found = re.search(r'\nfunction reverbField\(.*?\n}\n', source, re.S)
        self.assertIsNotNone(found, 'app.js has no reverbField')
        body = found.group(0)
        own = 'efxField.default' in body                     # the class's own preset (for_part_b.md 1a)
        self.assertNotEqual(own, '!!fieldOf(a, EFX)' in body, 'reverbField gives zone-reverb.js neither')
        help_ = next(f[5] for f in props.FIELDS if f[2] == 'ReverbPreset')
        self.assertIn('The Reverb presets set it too', help_)
        self.assertEqual('water zone keeps its own' in help_, own,
                         'the OpenAL reverb help and app.js reverbField disagree about a water zone')


if __name__ == '__main__':
    unittest.main()
