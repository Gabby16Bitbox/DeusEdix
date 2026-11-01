"""The Animation Studio's IK controllers in a saved animation (editor/anims.py _studio_validate): anim['ik']."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT), str(KIT.parent)]
import anims  # noqa: E402


def animation(**extra):
    return dict(dict(name='ReachUp', frames=20, fps=15, loop=True, source='made', rig=3,
                     keys=[dict(f=0, rot={}, root=[0, 0, 0])]), **extra)


def key(f, **kw):
    return dict(dict(f=f, v=[10, 20, 30], q=[0, 0, 0, 1], pole=[0, 25, -40], mode='smooth'), **kw)


class IK(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='studio-ik-', dir=Path(__file__).parent)
        self.addCleanup(self.directory.cleanup)
        redirect = patch.object(anims, 'STUDIO', Path(self.directory.name) / 'anims')
        redirect.start()
        self.addCleanup(redirect.stop)

    def test_controller_keys_are_kept(self):
        a = animation(ik={'l_arm': {'keys': [key(0), key(12, mode='hold')]}, 'r_leg': {'keys': [key(5)]}})
        anims.studio_save(a)
        self.assertEqual(anims.studio_get('ReachUp')['ik'], a['ik'])

    def test_bad_controllers_are_refused(self):
        for ik, words in [({'tail': {'keys': [key(0)]}}, 'Unknown IK chain'),
                          ({'l_arm': {'keys': []}}, 'at least one key'),
                          ({'l_arm': {'keys': [key(3), key(3)]}}, 'sorted, unique'),
                          ({'l_arm': {'keys': [key(25)]}}, 'integers from 0'),
                          ({'l_arm': {'keys': [key(0, q=[0, 0, 1])]}}, 'turn'),
                          ({'l_arm': {'keys': [key(0, pole=None)]}}, 'pole'),
                          ({'l_arm': {'keys': [key(0, mode='bounce')]}}, 'interpolation')]:
            with self.assertRaises(ValueError) as caught:
                anims.studio_save(animation(ik=ik))
            self.assertIn(words, str(caught.exception))


if __name__ == '__main__':
    unittest.main()
