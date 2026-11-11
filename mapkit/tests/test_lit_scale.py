"""The editor's blocks never take a texture scale that makes their lightmap too coarse (geom.lit_scale).

5 Nov 2026: ClenGreyCncrt_A (the default block texture) takes the game's scale 28 on walls; a block's wall then had
a lightmap of 2 x 2 samples on its edges with the floor and ceiling, and was black in the game.
"""
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT))
sys.path.insert(0, str(KIT / 'editor'))
import geom  # noqa: E402


class LitScale(unittest.TestCase):
    def test_default_block_texture(self):
        if geom.game_scale('ClenGreyCncrt_A', 'wall') <= geom.LIT_SCALE_MAX:
            self.skipTest('catalog without the game scale of ClenGreyCncrt_A')
        for kind in ('wall', 'floor', 'ceiling'):
            self.assertLessEqual(geom.lit_scale('ClenGreyCncrt_A', kind), geom.LIT_SCALE_MAX)

    def test_block_faces(self):
        m = geom.Mat('ClenGreyCncrt_A')
        m.lit_guard = True
        b = geom.box((-768, 296, 0), (-64, 312, 320), m)
        for f in b.faces:
            u, _v, _o = geom.mapping(f, False)
            self.assertGreaterEqual(abs(u[0]) + abs(u[1]) + abs(u[2]), 1 / geom.LIT_SCALE_MAX - 1e-6)
        self.assertTrue(m.with_(offset=(1, 0)).lit_guard)

    def test_unguarded_and_unlit_keep_the_game_scale(self):
        plain = geom.Mat('ClenGreyCncrt_A')
        unlit = geom.Mat('ClenGreyCncrt_A', flags=0x400000)
        unlit.lit_guard = True
        g = geom.game_scale('ClenGreyCncrt_A', 'wall')
        self.assertEqual(geom._scales(plain, 'wall')[2], geom.tex_size('ClenGreyCncrt_A')[0] * g)
        self.assertEqual(geom._scales(unlit, 'wall')[2], geom.tex_size('ClenGreyCncrt_A')[0] * g)

    def test_small_scales_unchanged(self):
        self.assertEqual(geom.lit_scale('ClenGrayCemnt_A', 'floor'), geom.game_scale('ClenGrayCemnt_A', 'floor'))


if __name__ == '__main__':
    unittest.main()
