"""A hole open to the sky (editor/zones.py hole_mats): its top shows the sky; with 'skySides' its sides too (an open
street, a rooftop), its floor never; in the build's brush (block_shapes) as in the T3D."""
import re
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import blocks as block_shapes  # noqa: E402
import zones  # noqa: E402

SKY = zones.SKY_TEX


def hole(**kw):
    return dict(dict(name='UCEditBox3', lo=[0, 0, 0], hi=[512, 256, 384], tex='Stucco_B', solid=True, hole=True,
                     sky=True), **kw)


def faces(b):
    text = ''.join(br.t3d() for br in block_shapes.brushes(b, zones.hole_mats(b), 'EditBox0'))
    out = []
    for m in re.finditer(r'Begin Polygon Texture=(\S+) Flags=(\d+)\n(.*?)End Polygon', text, re.S):
        normal = [float(x) for x in re.search(r'Normal\s+([-+\d.e]+),([-+\d.e]+),([-+\d.e]+)', m.group(3)).groups()]
        out.append((m.group(1), int(m.group(2)), normal))
    return out


class HoleSkySides(unittest.TestCase):
    def test_top_only_by_default(self):
        got = faces(hole())
        sky = [f for f in got if f[0] == SKY]
        self.assertEqual(len(sky), 1)
        self.assertTrue(sky[0][1] & zones.PF_FAKEBACKDROP)
        self.assertEqual(abs(sky[0][2][2]), 1.0)                # the top
        self.assertEqual(sum(1 for f in got if f[0] == 'Stucco_B'), 5)

    def test_sides_too(self):
        got = faces(hole(skySides=True))
        sky = [f for f in got if f[0] == SKY]
        self.assertEqual(len(sky), 5)                           # four sides and the top
        self.assertTrue(all(f[1] & zones.PF_FAKEBACKDROP for f in sky))
        rest = [f for f in got if f[0] != SKY]
        self.assertEqual(len(rest), 1)                          # the floor keeps its texture
        self.assertEqual(rest[0][0], 'Stucco_B')
        self.assertEqual(abs(rest[0][2][2]), 1.0)

    def test_sides_need_the_sky(self):
        b = hole(skySides=True)
        del b['sky']
        mats = zones.hole_mats(b)
        self.assertEqual(getattr(mats, 'tex', None), 'Stucco_B')  # one texture for every face, no sky


if __name__ == '__main__':
    unittest.main()
