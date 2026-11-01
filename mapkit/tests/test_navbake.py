"""The walkable area in the game (editor/navbake.py): which maps get it, the UCNavMesh actor, the actions."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import links  # noqa: E402
import navbake  # noqa: E402
import story  # noqa: E402

POLYS = ['4 0 0 0 100 0 0 100 100 0 0 100 0 -1 1 -1 -1', '3 100 0 0 200 0 0 100 100 0 -1 -1 0']


def walk(nav=True, verb='goto'):
    act = {'verb': verb, 'target': 'Agent1', 'delay': 0, 'at': [10, 20, 30]}
    if nav:
        act['nav'] = True
    return {'links': [{'id': 'L1', 'src': 'Button1', 'when': 'used', 'do': [act]}]}


class NavBakeTest(unittest.TestCase):
    def setUp(self):
        self.no_story = patch.object(story, 'load', return_value={'dialogues': [], 'events': []})
        self.no_story.start()

    def tearDown(self):
        self.no_story.stop()

    def test_only_maps_that_use_it(self):
        self.assertFalse(navbake.needed({}, 'M'))
        self.assertFalse(navbake.needed(walk(nav=False), 'M'))
        self.assertTrue(navbake.needed(walk(), 'M'))
        self.assertTrue(navbake.needed({'level': {'navmesh': True}}, 'M'))

    def test_story_actions_count(self):
        tale = {'events': [{'do': [{'type': 'npc', 'actor': 'Agent1', 'act': 'run', 'at': [1, 2, 3], 'nav': True}]}]}
        with patch.object(story, 'load', return_value=tale):
            self.assertTrue(navbake.needed({}, 'M'))

    def test_actor_with_the_polygons(self):
        edits = dict(walk(), navmesh={'v': 1, 'polys': POLYS + ['3 1 2 "x" 0 0 0']})
        (a,) = navbake.blocks(edits, 'M')
        self.assertEqual(a['cls'], 'UCNavMesh')
        self.assertEqual(a['props']['NumPolys'], '2')            # the bad one is left out
        p = a['props']                                            # polygon 1: corners at 6, 7, 8
        self.assertEqual([p['Sides(0)'], p['Sides(1)']], ['4', '3'])
        self.assertEqual([p['CornerX(6)'], p['CornerY(6)'], p['CornerZ(6)']], ['100', '0', '0'])
        self.assertEqual([p['CornerX(8)'], p['CornerY(8)']], ['100', '100'])
        self.assertEqual([p['Across(6)'], p['Across(7)'], p['Across(8)']], ['-1', '-1', '0'])
        self.assertEqual([p['Across(%d)' % k] for k in range(4)], ['-1', '1', '-1', '-1'])
        self.assertNotIn('CornerX(9)', p)
        self.assertFalse(any(k.startswith('Poly(') for k in p))
        self.assertEqual(navbake.blocks(dict(walk(nav=False), navmesh={'polys': POLYS}), 'M'), [])
        self.assertIn('not been made', navbake.report(walk(), 'M')[0])

    def test_a_polygon_of_another_shape_keeps_its_place(self):
        p = navbake.fields(['7 ' + ' '.join(['0'] * 28), POLYS[1], '3 0 0 0 1 1 1'])
        self.assertEqual([p['Sides(0)'], p['Sides(1)'], p['Sides(2)']], ['0', '3', '0'])
        self.assertEqual(p['CornerX(7)'], '200')

    def test_a_polygon_with_no_area_is_left_out(self):
        line = '3 0 600 0 100 600 0 200 600 0 -1 -1 -1'                 # a line seen from above
        point = '3 1 1 1 1 1 1 1 1 1 -1 -1 -1'
        sliver = '4 300 149 0 500 149 0 500 150 0 300 150 0 -1 -1 -1 -1'    # one unit wide: a real polygon
        p = navbake.fields([line, point, sliver])
        self.assertEqual([p['Sides(0)'], p['Sides(1)'], p['Sides(2)']], ['0', '0', '4'])

    def test_actions_on_the_walkable_area(self):
        for verb, game in (('goto', 'navgo'), ('run', 'navrun')):
            act = walk(verb=verb)['links'][0]['do'][0]
            self.assertEqual(links.act_string(act).split('|')[1], game)
        self.assertEqual(links.act_string(walk(nav=False)['links'][0]['do'][0]).split('|')[1], 'goto')

    def test_script_maps_get_it_too(self):
        from scene import Scene
        s = Scene('NavSceneTest')
        s._apply_actor_edits(dict(walk(), navmesh={'v': 1, 'polys': POLYS}))
        (block,) = [b for b in s.actors if 'Class=UCNavMesh ' in b]
        self.assertIn('NumPolys=2', block)
        self.assertIn('Sides(1)=3', block)
        self.assertIn('CornerX(7)=200', block)
        self.assertIn('Across(8)=0', block)

    def test_story_code(self):
        a = {'type': 'npc', 'actor': 'Agent1', 'act': 'goto', 'at': [1, 2, 3], 'nav': True}
        self.assertIn("NpcWalk('Agent1'", story.action_code('M', a, {}, '\t')[0])
        a.pop('nav')
        self.assertIn("NpcGo('Agent1'", story.action_code('M', a, {}, '\t')[0])


if __name__ == '__main__':
    unittest.main()
