"""Textures a map's script makes at every run (signs.save: signs.plate's signs, the training map's carpet and crate) are
written only when their bytes change: the same bytes at a new time were a change of what the map is made from
(play_prepare counts the kit's textures by size and time), so the training map was built again at every Play (re-test 3
of 31 Oct 2026, #8). Only temporary folders are written."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

KIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT))
import signs  # noqa: E402

OLDER = 1_600_000_000_000_000_000           # a time long before the test (ns)
# a sign made by a map script's run: a fresh process, as build_cached.py runs one
PLATE = 'import sys; sys.path.insert(0, %r); import signs; signs.plate(%r, (64, 16), "notice", [signs.Line(%r, .5)])'


class SaveTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='generated-textures-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def aged(self, path):
        """The file as an earlier run left it: its time set long back."""
        os.utime(path, ns=(OLDER, OLDER))
        return path.read_bytes()

    def test_the_same_picture_saved_again_leaves_its_file_as_it_was(self):
        crate = Image.new('RGB', (16, 8), '#8b7252').quantize(colors=8)
        path = self.root / 'textures' / '_tutorial' / 'Crate.pcx'
        self.assertEqual(signs.save(crate, path), path)
        pil = self.root / 'pil.pcx'
        crate.save(pil)
        self.assertEqual(path.read_bytes(), pil.read_bytes(), 'as PIL saves it by its suffix')
        first = self.aged(path)
        signs.save(crate, path)
        self.assertEqual((path.stat().st_mtime_ns, path.read_bytes()), (OLDER, first))
        signs.save(Image.new('RGB', (16, 8), '#64513b').quantize(colors=8), path)
        self.assertNotEqual(path.stat().st_mtime_ns, OLDER)
        self.assertNotEqual(path.read_bytes(), first)

    def test_a_sign_made_again_keeps_its_file(self):
        """signs.plate saves through signs.save: the same sign made by the next run of the script leaves its file."""
        path = self.root / 'TrainingSign0.pcx'
        with patch.object(signs, 'save', wraps=signs.save) as save:
            signs.plate(path, (64, 16), 'notice', [signs.Line('EXIT', .5)])
        self.assertEqual(save.call_args.args[1], path)
        make = lambda text: subprocess.run([sys.executable, '-B', '-c', PLATE % (str(KIT), str(path), text)],
                                           check=True)
        make('LIVE FIRE')
        first = self.aged(path)
        make('LIVE FIRE')
        self.assertEqual((path.stat().st_mtime_ns, path.read_bytes()), (OLDER, first))
        make('NO ENTRY')
        self.assertNotEqual(path.read_bytes(), first)

    def test_a_sign_is_the_same_bytes_in_one_process_too(self):
        """signs.plate's grain and worn ink come from the plate's own generator (seeded by its name and seed): a sign
        made twice in one process, as the suite's training map tests make the training map's signs after a build made
        them, is the same bytes a fresh process makes (cross-check of 31 Oct 2026: PIL's noise, the C library's rand(),
        gave other bytes from the second sign on, and every suite run wrote the kit's training signs again)."""
        made = [signs.plate(self.root / folder / 'TrainingSign5.pcx', (64, 16), 'notice',
                            [signs.Line('LIVE FIRE', .5)]).read_bytes() for folder in ('one', 'two')]
        self.assertEqual(made[0], made[1], 'made twice in this process')
        fresh = self.root / 'fresh' / 'TrainingSign5.pcx'
        subprocess.run([sys.executable, '-B', '-c', PLATE % (str(KIT), str(fresh), 'LIVE FIRE')], check=True)
        self.assertEqual(fresh.read_bytes(), made[0], 'as a fresh process makes it')


if __name__ == '__main__':
    unittest.main()
