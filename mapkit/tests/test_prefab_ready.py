"""Prefabs ready sooner (2 Nov 2026, Gabby: "I select a prefab to place it and it takes long to load, even when it is
cached"): the upgraded preview of a prefab is kept on disk, not only in memory (after every start of the editor its first
placing read the whole polys.json of its source map again); a piece made before is placed without hashing its original
map, checking its cache again or waiting for the SDK lock a Rebuild holds."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import data  # noqa: E402
import pieces_library as pl  # noqa: E402
import prefabs  # noqa: E402
import texture_mapping  # noqa: E402

NUMS = [0, 0, 0, 1, 0, 0, 0, 1, 0, 12, 24, 128, 128]
TRIANGLE = [0, 0, 0, 128, 0, 0, 128, 128, 0]
UV = [0.09375, 0.1875, 1.09375, 0.1875, 1.09375, 1.1875]     # the triangle's by NUMS


class DisplayKept(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.prefabs, self.cache, self.maps = root / 'prefabs', root / 'cache', root / 'maps'
        (self.maps / 'Src').mkdir(parents=True)
        (self.maps / 'Src' / 'polys.json').write_text(json.dumps([['Pkg.Sign', 0, NUMS, TRIANGLE, 0]]))
        for patcher in (patch.object(prefabs, 'ROOT', self.prefabs), patch.object(data, 'CACHE', self.cache),
                        patch.object(data, 'map_folder', lambda name: self.maps / name)):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(self.temp.cleanup)
        self.restart()

    def restart(self):
        """What a new start of the editor forgets."""
        for cached in (prefabs._display_cached, prefabs._polys_cached, prefabs._frames_complete, prefabs._source_cached):
            cached.cache_clear()

    def version(self, pid, frames):
        folder = self.prefabs / pid
        folder.mkdir(parents=True)
        (folder / 'prefab.json').write_text(json.dumps(dict(id=pid, source='Src', blocks=[])))
        group = dict(tex='Pkg.Sign', flags=0, pos=TRIANGLE, uv=UV)
        if frames:
            group['uvFrames'] = [texture_mapping.frame(NUMS)]
        (folder / 'display.json').write_text(json.dumps(dict(groups=[group], textures={})))
        return folder / 'display.json'

    def test_the_upgrade_is_made_once_and_kept_across_starts(self):
        display = self.version('usr_a', frames=False)
        before = display.read_bytes()
        calls = []
        enrich = texture_mapping.enrich
        with patch.object(texture_mapping, 'enrich', lambda *a: (calls.append(1), enrich(*a))[1]):
            first = prefabs.display_file('usr_a')
            self.restart()
            second = prefabs.display_file('usr_a')
        self.assertEqual(len(calls), 1, 'the source map was read again after a start')
        self.assertEqual(first, second)
        self.assertTrue(first.is_relative_to(self.cache), 'kept out of the prefabs folder (Play hashes it)')
        self.assertEqual(display.read_bytes(), before, 'the version itself never changes')
        self.assertEqual(json.loads(second.read_text())['groups'][0]['uvFrames'], [texture_mapping.frame(NUMS)])
        self.assertEqual(prefabs.display('usr_a')['groups'][0]['uvFrames'], [texture_mapping.frame(NUMS)])

    def test_a_rebuilt_source_map_makes_it_again(self):
        self.version('usr_b', frames=False)
        first = prefabs.display_file('usr_b')
        polys = self.maps / 'Src' / 'polys.json'
        polys.write_text(polys.read_text() + ' ')
        self.restart()
        second = prefabs.display_file('usr_b')
        self.assertNotEqual(first, second)
        self.assertFalse(first.exists(), 'the older upgrade is taken away')

    def test_a_complete_display_is_served_as_it_is(self):
        display = self.version('usr_c', frames=True)
        self.assertEqual(prefabs.display_file('usr_c'), display)
        self.assertFalse((self.cache / '_prefab_display').exists())

    def test_gone_and_unreadable(self):
        with self.assertRaises(prefabs.Gone):
            prefabs.display_file('usr_missing')
        self.version('usr_d', frames=True)
        (self.prefabs / 'usr_d' / 'prefab.json').write_text('{')
        with self.assertRaises(ValueError):
            prefabs.display_file('usr_d')


class PieceMadeBefore(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.map = Path(self.temp.name) / '01_Test.dx'
        self.map.write_bytes(b'map')
        pl._digests.clear()

    def signature(self):
        st = self.map.stat()
        return dict(path=str(self.map.resolve()), size=st.st_size, mtime=st.st_mtime_ns, sha256='x' * 64)

    def test_the_original_map_is_hashed_once_per_size_and_time(self):
        hashed = []
        real = pl._signature

        def signature(path, digest=True):
            if digest:
                hashed.append(path)
                return dict(real(path, False), sha256='x' * 64)
            return real(path, False)
        with patch.object(pl, '_signature', signature):
            self.assertTrue(pl._same_map(self.map, self.signature()))
            self.assertTrue(pl._same_map(self.map, self.signature()))
            self.assertEqual(len(hashed), 1)
            self.assertFalse(pl._same_map(self.map, dict(self.signature(), sha256='y' * 64)))
            self.map.write_bytes(b'another map')
            self.assertFalse(pl._same_map(self.map, dict(self.signature(), size=3)))

    def test_made_before_needs_no_cache_check_and_none_otherwise(self):
        item = dict(id='Obj_1', map='01_Test')
        with tempfile.TemporaryDirectory() as root, \
                patch.object(pl, '_resolve', return_value=(item, '01_Test', {}, {}, 'obj_Obj_1_v')), \
                patch.object(prefabs, 'ROOT', Path(root)), \
                patch.object(pl, '_cache_valid', side_effect=AssertionError('checked again')), \
                patch.object(pl, '_validate_piece', side_effect=AssertionError('parsed again')), \
                patch.object(pl.gamelib, 'prefab', lambda oid, log=None, pid=None: dict(kind='prefab', id=pid)):
            self.assertIsNone(pl.made('Obj_1'))
            folder = Path(root) / 'obj_Obj_1_v'
            folder.mkdir()
            (folder / 'prefab.json').write_text('{}')
            self.assertIsNone(pl.made('Obj_1'), 'without its display it is not complete')
            (folder / 'display.json').write_text('{}')
            self.assertEqual(pl.made('Obj_1'), dict(kind='prefab', id='obj_Obj_1_v'))
            self.assertEqual(pl.prefab('Obj_1'), dict(kind='prefab', id='obj_Obj_1_v'))

    def test_a_piece_of_another_library_is_not_made(self):
        with patch.object(pl, '_resolve', side_effect=ValueError('Rescan Pieces first.')):
            self.assertIsNone(pl.made('Obj_1'))


if __name__ == '__main__':
    unittest.main()
