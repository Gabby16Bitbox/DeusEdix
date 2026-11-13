"""Close an opening (editor/static/close-opening.js): the fill block's front and back laid as the wall round it
(editor/blocks.py matched), in the build and in the T3D copy."""
import re
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import blocks  # noqa: E402
import geom  # noqa: E402

WALL = dict(n=[-1, 0, 0], tex='Stucco_B', flags=0x800, u=[0, -2, 0], v=[0, 0, -2], o=[512, 37.5, 200])
BACK = dict(n=[1, 0, 0], tex='Brick_C', flags=0, u=[0, 1, 0], v=[0, 0, -1], o=[528, 0, 0])


def fill(**kw):
    return dict(dict(name='UCEditBox9', label='Fill', lo=[512, 199, -1], hi=[528, 265, 113], tex='Stucco_B', solid=True,
                     match=[WALL, BACK], matchOf='Stucco_B'), **kw)


def polys(text):
    return [dict(tex=m.group(1), flags=int(m.group(2)), body=m.group(3)) for m in
            re.finditer(r'Begin Polygon Texture=(\S+) Flags=(\d+)\n(.*?)End Polygon', text, re.S)]


def axis(body, name):
    return [float(x) for x in re.search(name + r'\s+([-+\d.]+),([-+\d.]+),([-+\d.]+)', body).groups()]


class Matched(unittest.TestCase):
    def brush(self, b):
        br = blocks.brushes(b, geom.Mat(b['tex']), b['name'])[0]
        centre = [(b['lo'][k] + b['hi'][k]) / 2 for k in range(3)]
        return blocks.matched(geom.rotate_brush(br, centre, b.get('rot')), b)

    def test_front_and_back_take_the_walls(self):
        ps = polys(self.brush(fill()).t3d())
        front = [p for p in ps if axis(p['body'], 'Normal')[0] == -1]
        back = [p for p in ps if axis(p['body'], 'Normal')[0] == 1]
        self.assertEqual((front[0]['tex'], front[0]['flags']), ('Stucco_B', 0x800))
        self.assertEqual(axis(front[0]['body'], 'TextureU'), [0, -2, 0])
        self.assertEqual(axis(front[0]['body'], 'Origin'), [512, 37.5, 200])
        self.assertEqual(back[0]['tex'], 'Brick_C')
        self.assertEqual(axis(back[0]['body'], 'TextureV'), [0, 0, -1])
        # the sides (in the jambs, unseen) keep the block's own mapping
        side = [p for p in ps if axis(p['body'], 'Normal')[2] == 1][0]
        self.assertNotEqual(axis(side['body'], 'TextureU'), [0, -2, 0])

    def test_another_texture_covers_every_face(self):
        ps = polys(self.brush(fill(tex='Brick_C')).t3d())
        self.assertTrue(all(p['tex'] == 'Brick_C' for p in ps))
        self.assertFalse(any(axis(p['body'], 'Origin') == [512, 37.5, 200] for p in ps))

    def test_turned_away_it_takes_its_own_mapping(self):
        ps = polys(self.brush(fill(rot=[0, 4096, 0])).t3d())     # 22.5 degrees: no face lies as the wall
        self.assertFalse(any(axis(p['body'], 'TextureU') == [0, -2, 0] for p in ps))

    def test_the_build_and_the_copy_use_it(self):
        import t3d_clipboard
        text = t3d_clipboard.export([{'kind': 'box', 'box': fill()}], [])['text']
        self.assertIn('Texture=Brick_C', text)
        src = (KIT / 'scene.py').read_text(encoding='utf-8')
        self.assertIn('_blocks.matched(turn(br), b)', src)


if __name__ == '__main__':
    unittest.main()
