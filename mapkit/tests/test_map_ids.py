"""The Pieces library knows an original map by its hash (pieces_library._signature), and no longer reads the whole map
again at every scan to make it: a map hashed before is known by its size, date and package GUID (the header's first
52 bytes), kept with its hash in the game's cache (maps-seen.json). Every scan read all of Revision's 137 maps
(1.1 GB) before (17 Nov 2026)."""
import hashlib
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import pieces_library as pl  # noqa: E402

TAG = b'\xc1\x83\x2a\x9e'


def package(guid, body=b'level data ' * 4000):
    """A file with an Unreal package's header: tag, versions, flags, the tables' counts and offsets, the GUID."""
    return TAG + (68).to_bytes(2, 'little') + bytes(2) + bytes(28) + guid + bytes(4) + body


class MapIds(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='mapids-', dir=str(Path(__file__).parent)))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'cache').mkdir()
        cache = patch.object(pl.editor_data, 'GAME_CACHE', self.tmp / 'cache', create=True)
        cache.start()
        self.addCleanup(cache.stop)
        self.map = self.tmp / '01_Test.dx'
        self.map.write_bytes(package(b'\x11' * 16))
        self.hashed = 0
        real = hashlib.sha256

        def counting(*args):
            self.hashed += 1
            return real(*args)
        counter = patch.object(pl.hashlib, 'sha256', counting)
        counter.start()
        self.addCleanup(counter.stop)

    def sha(self):
        return hashlib.new('sha256', self.map.read_bytes()).hexdigest()

    def rewrite(self, data, keep_date=True):
        st = self.map.stat()
        self.map.write_bytes(data)
        if keep_date:
            os.utime(self.map, ns=(st.st_atime_ns, st.st_mtime_ns))

    def test_a_map_hashed_once_is_known_by_its_header(self):
        first = pl._signature(self.map)
        self.assertEqual(first['sha256'], self.sha())
        self.assertEqual(self.hashed, 1)
        self.assertTrue((self.tmp / 'cache' / 'maps-seen.json').is_file())
        self.assertEqual(pl._signature(self.map), first)
        self.assertEqual(self.hashed, 1)                    # not read again
        self.assertTrue(pl._same_map(self.map, first))
        self.assertEqual(self.hashed, 1)
        self.assertEqual(pl._guid(self.map), '11' * 16)

    def test_a_new_guid_size_or_date_reads_it_again(self):
        first = pl._signature(self.map)
        self.rewrite(package(b'\x22' * 16))                 # saved again: same size, same date, new GUID
        second = pl._signature(self.map)
        self.assertEqual((self.hashed, second['sha256']), (2, self.sha()))
        self.assertNotEqual(second['sha256'], first['sha256'])
        self.assertFalse(pl._same_map(self.map, first))
        self.rewrite(package(b'\x22' * 16, b'other level ' * 4000))     # same GUID and date, another size
        self.assertEqual(pl._signature(self.map)['sha256'], self.sha())
        self.assertEqual(self.hashed, 3)
        self.rewrite(package(b'\x22' * 16, b'other level ' * 3999 + b'and changed!'))   # same size: its date
        os.utime(self.map, ns=(self.map.stat().st_atime_ns, self.map.stat().st_mtime_ns + 10_000_000))
        self.assertEqual(pl._signature(self.map)['sha256'], self.sha())
        self.assertEqual(self.hashed, 4)
        pl._signature(self.map)
        self.assertEqual(self.hashed, 4)

    def test_without_the_file_or_with_a_damaged_one_it_hashes_as_before(self):
        pl._signature(self.map)
        (self.tmp / 'cache' / 'maps-seen.json').write_text('{not json', encoding='utf-8')
        self.assertEqual(pl._signature(self.map)['sha256'], self.sha())
        self.assertEqual(self.hashed, 2)
        (self.tmp / 'cache' / 'maps-seen.json').write_text('{"version": 1, "maps": {"x": {"sha256": "no"}}}',
                                                           encoding='utf-8')
        self.assertEqual(pl._signature(self.map)['sha256'], self.sha())
        self.assertEqual(self.hashed, 3)
        pl._signature(self.map)
        self.assertEqual(self.hashed, 3)                    # written again, good this time

    def test_a_file_that_is_not_a_package(self):
        self.map.write_bytes(b'not a package at all, just bytes' * 100)
        self.assertIsNone(pl._guid(self.map))
        first = pl._signature(self.map)
        self.assertEqual((first['sha256'], pl._signature(self.map)), (self.sha(), first))
        self.assertEqual(self.hashed, 1)
        self.map.write_bytes(b'tiny')
        self.assertIsNone(pl._guid(self.map))

    def test_only_size_and_date_without_the_contents(self):
        self.assertNotIn('sha256', pl._signature(self.map, False))
        self.assertEqual(self.hashed, 0)
        self.assertFalse((self.tmp / 'cache' / 'maps-seen.json').exists())


if __name__ == '__main__':
    unittest.main()
