"""A map's Pieces cache is whole only with every texture it names (pieces_library._cache_valid): checked by listing the
textures' folder once (_texture_there) instead of resolving every file and walking its folders, which took 11 of the
12 s of every look at the Pieces of Revision (17 Nov 2026). What it says is what the old check said."""
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import pieces_library as pl  # noqa: E402


class TextureCheck(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp(prefix='texcheck-', dir=str(Path(__file__).parent)))
        self.addCleanup(shutil.rmtree, self.folder, True)
        (self.folder / 'tex').mkdir()
        for name in ('Pkg.Group.Brick.png', 'Pkg.Metal.png'):
            (self.folder / 'tex' / name).write_bytes(b'png')

    def old(self, png):
        try:
            return pl._safe(self.folder, self.folder / png).is_file()
        except ValueError:
            return 'refused'

    def new(self, png):
        try:
            return pl._texture_there(self.folder, png, {})
        except ValueError:
            return 'refused'

    def test_the_same_answers_as_resolving_each_file(self):
        (self.folder / 'tex' / 'Sub').mkdir()
        (self.folder / 'tex' / 'Sub' / 'Deep.png').write_bytes(b'png')
        (self.folder / 'Top.png').write_bytes(b'png')
        for png in ('tex/Pkg.Group.Brick.png', 'tex/Pkg.Metal.png', 'tex/Missing.png', 'tex/Sub', 'other/Pkg.Metal.png',
                    'tex/Sub/Deep.png', 'Top.png', 'tex\\Pkg.Metal.png', '../outside.png', 'tex/../../outside.png'):
            self.assertEqual(self.new(png), self.old(png), png)

    def test_one_listing_for_all_the_textures_of_a_map(self):
        listed = {}
        self.assertTrue(pl._texture_there(self.folder, 'tex/Pkg.Metal.png', listed))
        (self.folder / 'tex' / 'Pkg.Metal.png').unlink()      # gone after the listing: the listing answers
        self.assertTrue(pl._texture_there(self.folder, 'tex/Pkg.Metal.png', listed))
        self.assertEqual(list(listed), ['tex'])
        self.assertFalse(pl._texture_there(self.folder, 'tex/Pkg.Metal.png', {}))

    @unittest.skipUnless(os.name == 'nt', 'names differing in case are one file on Windows only')
    def test_case_as_windows_sees_it(self):
        self.assertTrue(self.old('tex/pkg.metal.PNG'))
        self.assertTrue(self.new('tex/pkg.metal.PNG'))

    def test_a_linked_texture_or_folder_is_not_taken(self):
        outside = Path(tempfile.mkdtemp(prefix='texcheck-out-', dir=str(Path(__file__).parent)))
        self.addCleanup(shutil.rmtree, outside, True)
        (outside / 'Real.png').write_bytes(b'png')
        try:
            os.symlink(outside / 'Real.png', self.folder / 'tex' / 'Linked.png')
        except OSError:
            self.skipTest('symbolic links cannot be made here')
        self.assertEqual(self.old('tex/Linked.png'), 'refused')
        self.assertFalse(self.new('tex/Linked.png'))          # not there, as the cache is then not whole either
        os.symlink(outside, self.folder / 'tex2', target_is_directory=True)
        self.assertEqual(self.old('tex2/Real.png'), 'refused')
        self.assertEqual(self.new('tex2/Real.png'), 'refused')

    def test_no_folder_of_textures(self):
        shutil.rmtree(self.folder / 'tex')
        self.assertFalse(self.new('tex/Pkg.Metal.png'))
        (self.folder / 'tex').write_bytes(b'a file, not a folder')
        with self.assertRaises(OSError):
            pl._texture_there(self.folder, 'tex/Pkg.Metal.png', {})     # _cache_valid: not valid


class HealthMemo(unittest.TestCase):
    """The list of the Pieces (data) knows a map's health again while one listing of its cache folder and its object
    list stay the same, and checks it all again when something there changed."""

    def setUp(self):
        from unittest.mock import patch
        self.tmp = Path(tempfile.mkdtemp(prefix='health-', dir=str(Path(__file__).parent)))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.folder, objects = self.tmp / 'ref_01_Test', self.tmp / 'objects'
        self.folder.mkdir()
        objects.mkdir()
        (self.folder / 'scene.t3d.zst').write_bytes(b'packed')
        (objects / '01_Test.json').write_text('{}', encoding='utf-8')
        self.checked = 0

        def valid(*args):
            self.checked += 1
            return True
        self._patches = [patch.object(pl, '_cache_folder', lambda name: self.folder), patch.object(pl, '_cache_valid', valid),
                         patch.object(pl.gamelib, 'CACHE', objects), patch.dict(pl._health, clear=True)]
        for p in self._patches:
            p.start()
            self.addCleanup(p.stop)
        self.objects = objects

    def health(self):
        return pl._cache_health('01_Test', dict(sha256='a' * 64), dict(target='revision', mesh_version=1))

    def test_known_again_until_something_changes(self):
        self.assertTrue(self.health())
        self.assertTrue(self.health())
        self.assertEqual(self.checked, 1)
        (self.folder / 'stamp.txt').write_text('new', encoding='utf-8')         # the cache made again
        self.health()
        self.assertEqual(self.checked, 2)
        self.health()
        self.assertEqual(self.checked, 2)
        st = (self.objects / '01_Test.json').stat()
        (self.objects / '01_Test.json').write_text('{"x": 1}', encoding='utf-8')  # its object list
        os.utime(self.objects / '01_Test.json', ns=(st.st_atime_ns, st.st_mtime_ns + 10_000_000))
        self.health()
        self.assertEqual(self.checked, 3)

    def test_not_for_ever(self):
        self.health()
        from unittest.mock import patch
        with patch.object(pl.time, 'monotonic', lambda: 10 ** 9):
            self.health()
        self.assertEqual(self.checked, 2)

    def test_no_folder_is_not_healthy(self):
        shutil.rmtree(self.folder)
        self.assertFalse(self.health())
        self.assertEqual(self.checked, 0)


if __name__ == '__main__':
    unittest.main()
