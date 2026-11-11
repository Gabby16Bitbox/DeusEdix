"""The map's UCLogicHub (P5, editor/LOGIC.md): the states and counters pinned in the Logic window's list
(edits['logic']['watch']) go into the map as one UCLogicHub0 whose Watch(i) are their game names; the game class reads
them every 0.25 s and writes state|map|name|old|new. A map with nothing watched gets no hub. The page's side:
tests/test_logic_window.mjs (the pins), test_logic_log.mjs and test_logic_trails.mjs (the lines)."""
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import links  # noqa: E402
import settings  # noqa: E402
from unittest.mock import patch  # noqa: E402

HUB_UC = os.path.join(HERE, '..', 'project-template', 'src', 'DeusEdix', 'Classes', 'UCLogicHub.uc')


class Hub(unittest.TestCase):
    def test_nothing_watched_no_hub(self):
        self.assertIsNone(links.hub({}))
        self.assertIsNone(links.hub({'logic': {'groups': []}}))
        self.assertIsNone(links.hub({'logic': {'watch': []}}))
        self.assertIsNone(links.hub({'logic': 'bad'}))

    def test_the_watched_names_as_the_game_names_them_once_each(self):
        e = {'logic': {'watch': ['Met', 'met', 'Città', 'Keys', 3, '', 'Door open']}}
        self.assertEqual(links.watched(e), ['Met', 'Citta', 'Keys', 'Door_open'])
        h = links.hub(e)
        self.assertEqual((h['cls'], h['name'], h['loc']), ('UCLogicHub', 'UCLogicHub0', [0.0, 0.0, 0.0]))
        self.assertEqual(h['props'], {'Watch(0)': '"Met"', 'Watch(1)': '"Citta"', 'Watch(2)': '"Keys"', 'Watch(3)': '"Door_open"'})

    def test_at_most_as_many_as_the_game_class_holds(self):
        e = {'logic': {'watch': ['S%d' % i for i in range(40)]}}
        self.assertEqual(len(links.hub(e)['props']), links.MAX_WATCH)
        with open(HUB_UC, encoding='latin1') as f:
            uc = f.read()
        self.assertEqual(int(re.search(r'var\(\) string Watch\[(\d+)\]', uc).group(1)), links.MAX_WATCH)

    def test_script_maps_get_it_too(self):
        """A map made by a script (scene.py) gets the same hub; the mod's own build (not DeusEdix) none: its package has
        no UCLogicHub yet."""
        from scene import Scene
        e = {'logic': {'watch': ['Met']}}
        with patch.object(settings, 'STANDALONE', True):
            s = Scene('HubSceneTest')
            s._apply_actor_edits(e)
            (block,) = [b for b in s.actors if 'Class=UCLogicHub ' in b]
            self.assertIn('Name=UCLogicHub0', block)
            self.assertIn('Watch(0)="Met"', block)
            s = Scene('HubSceneTest2')
            s._apply_actor_edits({'logic': {'groups': []}})
            self.assertFalse([b for b in s.actors if 'UCLogicHub' in b])
        with patch.object(settings, 'STANDALONE', False):
            s = Scene('HubSceneTest3')
            s._apply_actor_edits(e)
            self.assertFalse([b for b in s.actors if 'UCLogicHub' in b])

    def test_start_values_as_the_game_reads_them(self):
        """edits.logic.start = {name: true / false / a whole number}: Start(i) "name|b|1" a state, "name|i|5" a counter;
        anything else is left out. A map with start values and nothing watched still gets its hub."""
        e = {'logic': {'start': {'Door open': True, 'Met': False, 'Keys': 3, 'Bad': 'x', 'Half': 1.5, '': True, 'Low': -2}}}
        self.assertEqual(links.starts(e), [('Door_open', 'b', 1), ('Met', 'b', 0), ('Keys', 'i', 3), ('Low', 'i', -2)])
        h = links.hub(e)
        self.assertEqual(h['props'], {'Start(0)': '"Door_open|b|1"', 'Start(1)': '"Met|b|0"', 'Start(2)': '"Keys|i|3"',
                                      'Start(3)': '"Low|i|-2"'})
        self.assertEqual(links.hub_report(e), '  EDIT logic hub: 4 start values')
        both = links.hub({'logic': {'watch': ['Met'], 'start': {'Keys': 2}}})['props']
        self.assertEqual(both, {'Watch(0)': '"Met"', 'Start(0)': '"Keys|i|2"'})
        self.assertEqual(links.hub_report({'logic': {'watch': ['Met', 'Keys']}}), '  EDIT logic hub: 2 watched while playing')
        self.assertEqual(links.hub_report({'logic': {'watch': ['Met'], 'start': {'Keys': 2}}}),
                         '  EDIT logic hub: 1 watched while playing, 1 start value')
        self.assertEqual(links.hub_report({}), '')
        self.assertIsNone(links.hub({'logic': {'start': {}}}))
        self.assertIsNone(links.hub({'logic': {'start': 'bad'}}))
        with open(HUB_UC, encoding='latin1') as f:
            uc = f.read()
        self.assertEqual(int(re.search(r'var\(\) string Start\[(\d+)\]', uc).group(1)), links.MAX_WATCH)
        self.assertEqual(len(links.hub({'logic': {'start': {'S%d' % i: 1 for i in range(40)}}})['props']), links.MAX_WATCH)

    def test_script_maps_get_the_start_values_too(self):
        from scene import Scene
        with patch.object(settings, 'STANDALONE', True):
            s = Scene('HubSceneStart')
            s._apply_actor_edits({'logic': {'start': {'Keys': 3}}})
            (block,) = [b for b in s.actors if 'Class=UCLogicHub ' in b]
            self.assertIn('Start(0)="Keys|i|3"', block)

    def test_the_game_class_writes_the_line_the_editor_reads(self):
        """state|map|name|old|new, through UCEditorStory.LogicLine (the tag the Console reads), on a timer, no latent
        code (a saved game goes on as it was)."""
        with open(HUB_UC, encoding='latin1') as f:
            uc = f.read()
        self.assertIn('class UCLogicHub extends Info;', uc)
        self.assertIn('SetTimer(0.25, True);', uc)
        self.assertIn('LogicLine("state|" $ MapName() $ "|" $ Watch[i] $ "|" $ Last[i] $ "|" $ now)', uc)
        # the start values: once, the first tick the player is there; one already set is kept
        self.assertIn('function ApplyStarts(DeusExPlayer P)', uc)
        self.assertIn('LogicLine("start|" $ MapName() $ "|" $ nm $ "|" $ ValueOf(P.FlagBase, n) $ "|" $ how)', uc)
        self.assertIn('if (!P.FlagBase.CheckFlag(n, FLAG_Int))', uc)
        self.assertIn('if (!P.FlagBase.CheckFlag(n, FLAG_Bool))', uc)
        self.assertIn('var bool bStarted;', uc)
        self.assertNotRegex(uc, r'\n\s*(state\s+\w+|Sleep\(|FinishAnim\(|Begin:)')
        self.assertNotIn('\r', uc)


if __name__ == '__main__':
    unittest.main()
