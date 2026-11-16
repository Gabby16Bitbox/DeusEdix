"""The map cache's big text files kept packed (packed.py): a reader finds the text plain or packed, the plain file
wins when both are there, and the date and size a cache was stamped with stay the same once it is packed. Every test
runs both ways: with the zstd module (.zst, what the editor writes as a rule) and without it (.gz, in Python itself)."""
import gzip
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import packed  # noqa: E402

TEXT = 'Begin Map\n' + 'Begin Actor Class=Brush Name=Brush%d\nEnd Actor\n' * 400 % tuple(range(400)) + 'End Map\n'
ZSTD = packed.zstd


class Both:
    """The tests, for one form (FORM: packed.ZST or packed.GZ)."""
    FORM = None

    def setUp(self):
        if self.FORM == packed.GZ:              # as where the zstd module is not installed
            module = patch.object(packed, 'zstd', None)
            module.start()
            self.addCleanup(module.stop)
        self.folder = Path(tempfile.mkdtemp(prefix='packed-', dir=str(Path(__file__).parent)))
        self.addCleanup(shutil.rmtree, self.folder, True)
        self.file = self.folder / 'scene.t3d'
        self.file.write_bytes(TEXT.encode('latin1'))        # (bytes: no line ending changed on Windows)

    def test_a_packed_file_reads_as_it_did_and_keeps_its_stamp(self):
        stamp = packed.signature(self.file)
        self.assertEqual(stamp, (self.file.stat().st_mtime_ns, len(TEXT)))
        self.assertTrue(packed.pack(self.file))
        self.assertFalse(self.file.exists())
        stored = packed.packed_path(self.file)
        self.assertEqual(stored.name, 'scene.t3d' + self.FORM)
        self.assertLess(stored.stat().st_size, len(TEXT) // 5)
        self.assertTrue(packed.exists(self.file))
        self.assertEqual(packed.real(self.file), stored)
        self.assertEqual(packed.form_of(stored), self.FORM)
        self.assertIsNone(packed.form_of(self.file))
        self.assertEqual(packed.read_text(self.file, encoding='latin1'), TEXT)
        self.assertEqual(packed.signature(self.file), stamp)             # what was stamped before still matches
        self.assertFalse(packed.pack(self.file))                         # nothing plain to pack
        self.assertEqual([p.name for p in self.folder.iterdir()], [stored.name])     # no pending file left

    def test_the_plain_file_wins_and_packing_replaces_the_old_packed_one(self):
        packed.pack(self.file)
        self.file.write_bytes(b'written again')
        self.assertEqual(packed.read_text(self.file, encoding='latin1'), 'written again')
        self.assertEqual(packed.real(self.file), self.file)
        self.assertEqual(packed.signature(self.file)[1], len('written again'))
        self.assertTrue(packed.pack(self.file, packed.FAST))
        self.assertEqual(packed.read_text(self.file, encoding='latin1'), 'written again')
        self.assertEqual(packed.signature(self.file)[1], len('written again'))      # a small frame says its size too

    def test_a_file_written_again_while_it_is_packed_stays_plain(self):
        real_replace = os.replace

        def replace_then_write(src, dst):
            real_replace(src, dst)
            self.file.write_bytes(b'a newer text, written meanwhile')
        with patch.object(packed.os, 'replace', replace_then_write):
            self.assertFalse(packed.pack(self.file))
        self.assertFalse(packed.packed_path(self.file).exists())         # what was packed was the old text
        self.assertEqual(packed.read_text(self.file, encoding='latin1'), 'a newer text, written meanwhile')

    def test_text_comes_with_the_line_ends_text_mode_gives(self):
        # the engine writes its T3D with CR LF; Path.read_text gave LF alone, and the readers' patterns count on it
        self.file.write_bytes(b'Begin Actor Class=LevelInfo Name=LevelInfo0\r\n TrueNorth=5\r\nEnd Actor\r\n')
        want = self.file.read_text(encoding='latin1')
        self.assertNotIn('\r', want)
        self.assertEqual(packed.read_text(self.file, encoding='latin1'), want)
        packed.pack(self.file)
        self.assertEqual(packed.read_text(self.file, encoding='latin1'), want)

    def test_neither_form_there(self):
        missing = self.folder / 'polys.json'
        self.assertFalse(packed.exists(missing))
        self.assertEqual(packed.real(missing), missing)
        with self.assertRaises(FileNotFoundError):
            packed.read_text(missing)
        with self.assertRaises(OSError):
            packed.signature(missing)

    def test_a_damaged_packed_file_is_an_os_error(self):
        packed.pack(self.file)
        stored = packed.packed_path(self.file)
        whole = stored.read_bytes()
        stored.write_bytes(whole[:len(whole) // 2])
        with self.assertRaises(OSError):
            packed.read_text(self.file, encoding='latin1')

    def test_a_folder_packs_its_big_text_files_only(self):
        (self.folder / 'geometry.json').write_bytes(b'{"groups": []}')
        (self.folder / 'brushes.json').write_text('[]', encoding='utf-8')
        self.assertEqual(packed.pack_folder(self.folder), 2)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()),
                         ['brushes.json', 'geometry.json' + self.FORM, 'scene.t3d' + self.FORM])
        self.assertEqual(packed.pack_folder(self.folder), 0)
        self.assertEqual(packed.read_bytes(self.folder / 'geometry.json'), b'{"groups": []}')


@unittest.skipUnless(ZSTD, 'the zstd module (python-zstd) is not installed here: the editor then writes .gz')
class WithZstd(Both, unittest.TestCase):
    FORM = packed.ZST

    def test_a_gz_made_without_the_module_is_read_and_replaced(self):
        with patch.object(packed, 'zstd', None):
            packed.pack(self.file)
        self.assertEqual([p.name for p in self.folder.iterdir()], ['scene.t3d.gz'])
        self.assertEqual(packed.read_text(self.file, encoding='latin1'), TEXT)       # read wherever it is
        self.assertEqual(packed.signature(self.file)[1], len(TEXT))
        self.file.write_bytes(TEXT.encode('latin1'))
        self.assertTrue(packed.pack(self.file))
        self.assertEqual([p.name for p in self.folder.iterdir()], ['scene.t3d.zst'])  # the old form went with it

    def test_what_it_writes_is_a_zstandard_frame_that_says_its_size(self):
        packed.pack(self.file)
        stored = packed.packed_path(self.file)
        self.assertEqual(stored.read_bytes()[:4], packed.ZSTD_MAGIC)
        self.assertEqual(packed._zstd_size(stored), len(TEXT))


class WithoutZstd(Both, unittest.TestCase):
    FORM = packed.GZ

    def test_a_zst_cannot_be_read_so_the_file_is_as_if_not_there(self):
        (self.folder / 'polys.json.zst').write_bytes(packed.ZSTD_MAGIC + b'made where the module is')
        self.assertFalse(packed.exists(self.folder / 'polys.json'))        # data.prepare then makes it again
        with self.assertRaises(FileNotFoundError):
            packed.read_bytes(self.folder / 'polys.json')
        # made again and packed here: as .gz, and the unreadable form goes
        (self.folder / 'polys.json').write_bytes(b'[]')
        self.assertTrue(packed.pack(self.folder / 'polys.json'))
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['polys.json.gz', 'scene.t3d'])

    def test_what_it_writes_is_plain_gzip(self):
        packed.pack(self.file)
        with gzip.open(self.folder / 'scene.t3d.gz', 'rb') as stream:
            self.assertEqual(stream.read(), TEXT.encode('latin1'))


class Readers(unittest.TestCase):
    def test_the_readers_of_the_cache_go_through_it(self):
        # no reader left that opens one of the three files itself (a packed cache would look empty to it)
        import re
        direct = re.compile(r"/ '(?:scene\.t3d|geometry\.json|polys\.json)'\)\.(?:read_text|read_bytes|exists|is_file|stat|open)\(")
        found = []
        for file in [KIT / 'build_cache.py', *sorted((KIT / 'editor').glob('*.py'))]:
            for n, line in enumerate(file.read_text(encoding='utf-8').splitlines(), 1):
                if direct.search(line):
                    found.append('%s:%d' % (file.name, n))
        self.assertEqual(found, [])

    def test_the_frame_header_is_read_as_the_format_says(self):
        # RFC 8878: descriptor (size flag, single segment, dictionary id), window, dictionary, size
        folder = Path(tempfile.mkdtemp(prefix='packed-', dir=str(Path(__file__).parent)))
        self.addCleanup(shutil.rmtree, folder, True)
        cases = {
            b'\x80' + b'\x58' + (35_800_000).to_bytes(4, 'little'): 35_800_000,          # 4 bytes, with a window
            b'\x20' + b'\x7b': 123,                                                      # single segment: 1 byte
            b'\x60' + (1000 - 256).to_bytes(2, 'little'): 1000,                          # 2 bytes: 256 more
            b'\xe0' + (5_000_000_000).to_bytes(8, 'little'): 5_000_000_000,              # 8 bytes
            b'\x81' + b'\x58' + b'\x07' + (4096).to_bytes(4, 'little'): 4096,            # after a dictionary id
            b'\x00' + b'\x58': None,                                                     # a frame that does not say
        }
        for n, (header, size) in enumerate(cases.items()):
            file = folder / ('f%d.zst' % n)
            file.write_bytes(packed.ZSTD_MAGIC + header + b'\x00' * 8)
            self.assertEqual(packed._zstd_size(file), size, header.hex())
        (folder / 'not.zst').write_bytes(b'not a frame at all')
        self.assertIsNone(packed._zstd_size(folder / 'not.zst'))


if __name__ == '__main__':
    unittest.main()
