"""What a build reads of the game's class defaults (editor/cache/_palette/defaults.json) for its walking points and
its zones' echo gains (fix-a3, 28 Oct 2026): scene.rested_height reads the file once (not once a point: 85 reads of the
3 MB file took 1.8 s for a map script's PathNodes), again only when the file changes; neither it nor
props.openal_gain ever starts a session of the host (the game's editor) to make the file again when it is missing or
older than props.VERSION: they go by the names then (RESTED_POINTS; Revision's five zone classes with OpenAL's float
Gain). Only temporary folders are written; the host is a stand-in that says so if it is started."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import build_cache  # noqa: E402
import kit  # noqa: E402
import props  # noqa: E402
import scene  # noqa: E402

# a small set of the game's classes, as the class defaults have them
CLASSES = {
    'NavigationPoint': {'parents': ['Actor', 'Object'], 'props': {'CollisionHeight': ['15.000000']}, 'types': {}},
    'PathNode': {'parents': ['NavigationPoint', 'Actor', 'Object'], 'props': {'CollisionHeight': ['15.000000']}, 'types': {}},
    'InventorySpot': {'parents': ['NavigationPoint', 'Actor', 'Object'], 'props': {'CollisionHeight': ['40.000000']},
                      'types': {}},
    'PlayerStart': {'parents': ['NavigationPoint', 'Actor', 'Object'], 'props': {'CollisionHeight': ['40.000000']},
                    'types': {}},
    'Light': {'parents': ['Actor', 'Object'], 'props': {}, 'types': {}},
    'ZoneInfo': {'parents': ['Info', 'Actor', 'Object'], 'props': {'Gain': ['150', '70']}, 'types': {'Gain': 'ByteProperty'}},
    'RevZoneInfo': {'parents': ['ZoneInfo', 'Info', 'Actor', 'Object'], 'props': {'Gain': ['0.320000']},
                    'types': {'Gain': 'FloatProperty'}},
    # a class of this cache only, with a float Gain: found by its type, not by its name
    'MyFloatZone': {'parents': ['ZoneInfo', 'Info', 'Actor', 'Object'], 'props': {'Gain': ['0.5']},
                    'types': {'Gain': 'FloatProperty'}},
}


class ClassDefaultsReadsTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.cache = Path(temp.name) / 'defaults.json'
        for p in (patch.object(props, 'CACHE', self.cache), patch.object(kit, 'Session', self.host)):
            p.start()
            self.addCleanup(p.stop)
        self.hosts, self.reads = [], 0
        real = build_cache.json_file

        def counted(path):
            self.reads += 1
            return real(path)
        p = patch.object(build_cache, 'json_file', counted)
        p.start()
        self.addCleanup(p.stop)

    def host(self, *args, **kwargs):
        self.hosts.append(args)
        raise RuntimeError('a session of the host was started to read the class defaults')

    def write(self, version=None, classes=CLASSES):
        self.cache.write_text(json.dumps({'version': props.VERSION if version is None else version, 'classes': classes,
                                          'enums': {}}), encoding='utf-8')

    def test_rested_height_reads_the_class_defaults_once(self):
        self.write()
        heights = [scene.rested_height('PathNode') for _ in range(85)]
        self.assertEqual(heights, [15.0] * 85)
        self.assertEqual(scene.rested_height('InventorySpot'), 40.0)
        self.assertIsNone(scene.rested_height('PlayerStart'))
        self.assertIsNone(scene.rested_height('Light'))
        self.assertEqual(scene.rested_height('Pathnode'), 15)           # not the classes' spelling: by the name
        self.assertEqual(self.reads, 1)
        # the file made again (another time): read again, once
        stamp = self.cache.stat().st_mtime_ns + 5 * 10 ** 9
        os.utime(self.cache, ns=(stamp, stamp))
        self.assertEqual([scene.rested_height('PathNode') for _ in range(10)], [15.0] * 10)
        self.assertEqual(self.reads, 2)
        self.assertEqual(self.hosts, [])

    def test_an_older_or_missing_cache_never_starts_the_host(self):
        for case in ('older', 'missing'):
            with self.subTest(cache=case):
                if case == 'older':
                    self.write(version=props.VERSION - 1)
                else:
                    self.cache.unlink(missing_ok=True)
                # the walking points by their names (RESTED_POINTS)
                self.assertEqual(scene.rested_height('PathNode'), 15)
                self.assertEqual(scene.rested_height('InventorySpot'), 40)
                self.assertIsNone(scene.rested_height('PlayerStart'))
                # Revision's five zone classes with OpenAL's float Gain by their names (the target pinned: a
                # workspace may target the original game, which has none)
                with patch.object(props.settings, 'IS_REVISION', True):
                    for cls in ('RevZoneInfo', 'RevSoundZone', 'WaterZone', 'MyLevel.PrecipitationZone', 'SnowZone'):
                        self.assertTrue(props.openal_gain(cls), cls)
                    for cls in ('ZoneInfo', 'SkyZoneInfo', 'MyFloatZone', 'SomeMod.Zone', ''):
                        self.assertFalse(props.openal_gain(cls), cls)
                self.assertEqual(self.hosts, [])
                if case == 'older':
                    self.assertEqual(json.loads(self.cache.read_text(encoding='utf-8'))['version'], props.VERSION - 1)

    def test_the_original_game_has_none_of_them(self):
        self.cache.unlink(missing_ok=True)
        with patch.object(props.settings, 'IS_REVISION', False):
            for cls in ('RevZoneInfo', 'WaterZone', 'ZoneInfo'):
                self.assertFalse(props.openal_gain(cls), cls)
        self.assertEqual(self.hosts, [])

    def test_a_current_cache_answers_by_the_types(self):
        self.write()
        self.assertTrue(props.openal_gain('RevZoneInfo'))
        self.assertTrue(props.openal_gain('MyFloatZone'))                # its type, though not one of the five names
        self.assertFalse(props.openal_gain('WaterZone'))                 # not in this cache: False
        self.assertFalse(props.openal_gain('ZoneInfo'))
        self.assertEqual(self.hosts, [])


if __name__ == '__main__':
    unittest.main()
