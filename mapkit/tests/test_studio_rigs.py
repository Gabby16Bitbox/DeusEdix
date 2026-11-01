"""The Studio's skeletons (editor/anims.py rig_get / rig_save): a new rig version keeps the one it replaces, once,
for the animations made with it."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT), str(KIT.parent)]
import anims  # noqa: E402

MESH = 'DeusExCharacters.GM_Suit'


def rig(version, error):
    return dict(version=version, mesh=MESH, H=98.5, joints=[[0, 0, 0]], tails=[[0, 1, 0]], weights=[[0, 1, 0, 0]], error=error)


class Rigs(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='studio-rigs-', dir=Path(__file__).parent)
        self.addCleanup(self.directory.cleanup)
        redirect = patch.object(anims, 'STUDIO', Path(self.directory.name) / 'anims')
        redirect.start()
        self.addCleanup(redirect.stop)

    def test_the_upgrade_keeps_the_old_rig_once(self):
        anims.rig_save(rig(2, 0.5))
        anims.rig_save(dict(rig(2, 0.5), legacy=True))         # the Studio keeps it before making version 3
        anims.rig_save(rig(3, 0.6))
        anims.rig_save(dict(rig(3, 0.6), legacy=True))         # a later upgrade never replaces the first old one
        self.assertEqual(anims.rig_get(MESH)['version'], 3)
        old = anims.rig_get(MESH, legacy=True)
        self.assertEqual((old['version'], old['error']), (2, 0.5))
        self.assertNotIn('legacy', old)

    def test_no_old_rig_and_the_list_shows_models_only(self):
        anims.rig_save(rig(3, 0.6))
        self.assertIsNone(anims.rig_get(MESH, legacy=True))
        anims.rig_save(dict(rig(2, 0.5), legacy=True))
        self.assertEqual(anims.studio_list()['rigs'], [MESH])


if __name__ == '__main__':
    unittest.main()
