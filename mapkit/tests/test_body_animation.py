"""A character's body animation in the Interactions: the action as the game reads it (UCLink: body|<character>|
<animation>|<seconds>|<how>), its end heard on UCL_<character>_Body, and the game's classes that play it."""
import re
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import links  # noqa: E402
import logic_catalog  # noqa: E402

CLASSES = [KIT.parent / 'runtime' / 'DeusEdix' / 'Classes', KIT / 'project-template' / 'src' / 'DeusEdix' / 'Classes']


class BodyAction(unittest.TestCase):
    def test_how_it_plays_as_the_game_reads_it(self):
        self.assertEqual(links.body_how(''), 'once x1')
        self.assertEqual(links.body_how('loop own x1.5'), 'loop own x1.5')
        self.assertEqual(links.body_how('walk TIME x0.01 own'), 'time own walk x0.05')
        self.assertEqual(links.body_how('xnan'), 'once x1')
        self.assertNotIn('x', links.body_how('loop own walk x2')[:-2], 'the speed is the first x')

    def test_the_action_string(self):
        self.assertEqual(links.act_string({'verb': 'body', 'target': 'Guard1', 'a': 'Wave', 'b': '3', 'c': 'time own x0.5'}),
                         '0|body|Guard1|Wave|3|time own x0.5')
        self.assertEqual(links.act_string({'verb': 'body', 'target': 'Guard1', 'a': 'Bad name!', 'c': ''}),
                         '0|body|Guard1||0|once x1', 'a name the game cannot have is left out')
        self.assertEqual(links.act_string({'verb': 'bodystop', 'target': 'Guard1'}), '0|bodystop|Guard1|||')

    def test_its_end_is_heard_on_the_tag_the_game_tells(self):
        self.assertEqual(logic_catalog.tag('bodydone', 'Guard1'), 'UCL_Guard1_Body')

    def test_the_game_plays_it(self):
        for folder in CLASSES:
            link = (folder / 'UCLink.uc').read_text(encoding='utf-8')
            self.assertIn('verb == "body" || verb == "bodystop"', link)
            self.assertIn('"UCL_" $ SP.Name $ "_Body"', link)
            self.assertRegex(link, r"When == 'bodydone'")
            anim = (folder / 'UCAnimSet.uc').read_text(encoding='utf-8')
            for fn in ('PlayBody', 'StopBody', 'EndBody', 'BodyTick'):
                self.assertRegex(anim, r'(?m)^function %s\(' % fn)
        self.assertEqual(*[(f / 'UCAnimSet.uc').read_text(encoding='utf-8') for f in CLASSES])
        self.assertEqual(*[(f / 'UCLink.uc').read_text(encoding='utf-8') for f in CLASSES])


if __name__ == '__main__':
    unittest.main()
