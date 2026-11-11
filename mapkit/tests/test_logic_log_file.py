"""Why didn't it run? (P2): live.logic_lines reads one map's logic lines out of the game's log (/api/logic_log), and how
many times that game loaded the map."""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import live  # noqa: E402

LOG = b"""Log: Log file open, 11/08/26 18:02:11
Log: LoadMap: entry.dx
Log: Browse: 16_Logic_Blocks?Name=Player?Class=Revision.RevJCDentonMale
Log: LoadMap: 16_Logic_Blocks?Name=Player?Class=Revision.RevJCDentonMale
DeusEdixLogic: value|16_Logic_Blocks|UCEdit3|0/2\r
DeusEdixLogic: fire|16_Logic_Blocks|L1|Btn15|used|RevJCDentonMale0|When the player uses Button 15: say "hi" | twice
ScriptLog: something else
DeusEdixLogic: fire|Other_Map|L1|Btn1|used|RevJCDentonMale0|
Log: LoadMap: Other_Map.dx?Name=Player
Log: LoadMap: 16_LOGIC_BLOCKS.dx?Name=Player
DeusEdixLogic: skip|16_logic_blocks|L2|once|
DeusEdixLogic: broken
"""


class LogicLines(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.path = self.dir / 'Revision.log'
        self.was = live.log_path
        live.log_path = lambda: self.path

    def tearDown(self):
        live.log_path = self.was
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_one_maps_lines_and_loads(self):
        self.path.write_bytes(LOG)
        r = live.logic_lines('16_Logic_Blocks')
        self.assertEqual(r['lines'], ['value|16_Logic_Blocks|UCEdit3|0/2',
                                      'fire|16_Logic_Blocks|L1|Btn15|used|RevJCDentonMale0|When the player uses Button 15: say "hi" | twice',
                                      'skip|16_logic_blocks|L2|once|'])
        self.assertEqual(r['loads'], 2, 'its name in any case, with or without .dx')
        self.assertEqual(r['maps'], ['entry', '16_Logic_Blocks', 'Other_Map'])
        self.assertIsInstance(r['written'], int)
        self.assertEqual(live.logic_lines('Other_Map')['lines'], ['fire|Other_Map|L1|Btn1|used|RevJCDentonMale0|'])

    def test_the_last_lines_only(self):
        self.path.write_bytes(b''.join(b'DeusEdixLogic: act|M|L1|message||n%d\n' % i for i in range(50)))
        r = live.logic_lines('M', keep=5)
        self.assertEqual([x.rsplit('|', 1)[1] for x in r['lines']], ['n45', 'n46', 'n47', 'n48', 'n49'])
        self.assertEqual(r['loads'], 0)
        tail = live.logic_lines('M', limit=200)
        self.assertTrue(tail['lines'] and all(x.startswith('act|M|L1|message||n') for x in tail['lines']),
                        'a log read from the middle starts at a whole line')

    def test_no_log(self):
        self.assertIsNone(live.logic_lines('M'))


if __name__ == '__main__':
    unittest.main()
