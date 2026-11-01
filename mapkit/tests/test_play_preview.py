"""Temporary Play copies survive interruptions without overwriting external edits."""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import play_preview as preview


class PlayPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='play-preview-test-', dir=KIT / 'tests')
        self.root = Path(self.temp.name)
        self.journal = self.root / 'journal'
        self.maps = self.root / 'game-maps'
        self.maps.mkdir()
        self.target = self.maps / 'TestMap.dx'
        self.source = self.root / 'rebuilt.dx'
        self.source.write_bytes(b'rebuilt playable map')
        self.target.write_bytes(b'previous installed map')
        self.patches = [patch.object(preview, 'ROOT', self.journal),
                        patch.object(preview, 'settings', types.SimpleNamespace(MAPS_DIR=self.maps))]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def stage(self):
        preview.stage(self.source, 'TestMap')
        return json.loads((self.journal / 'active.json').read_text(encoding='utf-8'))

    def test_existing_map_round_trip_preserves_source_and_other_maps(self):
        other = self.maps / 'Other.dx'
        other.write_bytes(b'untouched')
        self.stage()
        self.assertEqual(self.target.read_bytes(), self.source.read_bytes())
        preview.restore()
        self.assertEqual(self.target.read_bytes(), b'previous installed map')
        self.assertEqual(self.source.read_bytes(), b'rebuilt playable map')
        self.assertEqual(other.read_bytes(), b'untouched')
        self.assertEqual(list(self.journal.iterdir()), [])
        self.assertEqual(preview.restore(), [])

    def test_new_map_removed_on_stop(self):
        self.target.unlink()
        self.stage()
        preview.restore()
        self.assertFalse(self.target.exists())
        self.assertTrue(self.source.is_file())

    def test_external_edit_is_kept_and_backup_remains_available(self):
        entry = self.stage()
        self.target.write_bytes(b'edited outside editor')
        with self.assertRaisesRegex(RuntimeError, 'outside DeusEdix'):
            preview.restore()
        self.assertEqual(self.target.read_bytes(), b'edited outside editor')
        self.assertEqual((self.journal / (entry['id'] + '.dx')).read_bytes(), b'previous installed map')
        self.assertTrue((self.journal / 'active.json').is_file())

    def test_external_delete_is_not_silently_undone(self):
        self.stage()
        self.target.unlink()
        with self.assertRaisesRegex(RuntimeError, 'outside DeusEdix'):
            preview.restore()
        self.assertFalse(self.target.exists())

    def test_interrupted_stage_before_atomic_replace_accepts_previous_hash(self):
        original_replace = os.replace
        def interrupted(source, target):
            if Path(target) == self.target:
                raise OSError('Simulated interruption')
            return original_replace(source, target)
        with patch.object(preview.os, 'replace', side_effect=interrupted):
            with self.assertRaisesRegex(OSError, 'Simulated'):
                self.stage()
        self.assertEqual(self.target.read_bytes(), b'previous installed map')
        preview.restore()
        self.assertEqual(self.target.read_bytes(), b'previous installed map')
        self.assertFalse((self.journal / 'active.json').exists())

    def test_interrupted_new_map_stage_can_be_cleared(self):
        self.target.unlink()
        with patch.object(preview.os, 'replace', side_effect=OSError('Simulated interruption')):
            with self.assertRaises(OSError):
                self.stage()
        self.assertFalse(self.target.exists())
        preview.restore()
        self.assertFalse((self.journal / 'active.json').exists())

    def test_interrupted_restore_after_replacement_can_finish_next_time(self):
        self.stage()
        manifest = self.journal / 'active.json'
        unlink = Path.unlink
        def interrupted(path, *args, **kwargs):
            if path == manifest:
                raise OSError('Simulated interruption')
            return unlink(path, *args, **kwargs)
        with patch.object(Path, 'unlink', interrupted):
            with self.assertRaisesRegex(OSError, 'Simulated'):
                preview.restore()
        self.assertEqual(self.target.read_bytes(), b'previous installed map')
        self.assertTrue(manifest.is_file())
        preview.restore()
        self.assertFalse(manifest.exists())

    def test_corrupt_backup_never_overwrites_staged_map(self):
        entry = self.stage()
        (self.journal / (entry['id'] + '.dx')).write_bytes(b'corrupt backup')
        with self.assertRaisesRegex(RuntimeError, 'backup is missing or changed'):
            preview.restore()
        self.assertEqual(self.target.read_bytes(), b'rebuilt playable map')

    def test_invalid_manifest_fields_and_paths_cannot_write_outside_game_map_folder(self):
        entry = self.stage()
        manifest = self.journal / 'active.json'
        for changed in ({'id': '../outside'}, {'target': str(self.source)}, {'target': 'relative.dx'},
                        {'staged': 'bad'}, {'previous': []}, {'version': 2}, {'id': None}):
            with self.subTest(changed=changed):
                manifest.write_text(json.dumps(entry | changed), encoding='utf-8')
                with self.assertRaisesRegex(RuntimeError, 'Invalid Play preview journal'):
                    preview.restore()
                self.assertEqual(self.source.read_bytes(), b'rebuilt playable map')
                self.assertEqual(self.target.read_bytes(), b'rebuilt playable map')
        manifest.write_text(json.dumps(entry), encoding='utf-8')
        preview.restore()

    def test_external_change_during_stage_is_detected_before_replace(self):
        copy = shutil.copy2
        def changed(source, target):
            result = copy(source, target)
            if Path(source) == self.source:
                self.target.write_bytes(b'concurrent external edit')
            return result
        with patch.object(preview.shutil, 'copy2', side_effect=changed):
            with self.assertRaisesRegex(RuntimeError, 'outside DeusEdix'):
                self.stage()
        self.assertEqual(self.target.read_bytes(), b'concurrent external edit')
        self.assertTrue((self.journal / 'active.json').is_file())

    def test_incomplete_source_copy_is_not_published(self):
        copy = shutil.copy2
        def changed(source, target):
            result = copy(source, target)
            if Path(source) == self.source:
                Path(target).write_bytes(b'partial snapshot')
            return result
        with patch.object(preview.shutil, 'copy2', side_effect=changed):
            with self.assertRaisesRegex(RuntimeError, 'source map changed'):
                self.stage()
        self.assertEqual(self.target.read_bytes(), b'previous installed map')
        preview.restore()

    def test_external_change_during_restore_is_detected_before_replace(self):
        entry = self.stage()
        backup = self.journal / (entry['id'] + '.dx')
        copy = shutil.copy2
        def changed(source, target):
            result = copy(source, target)
            if Path(source) == backup:
                self.target.write_bytes(b'concurrent external edit')
            return result
        with patch.object(preview.shutil, 'copy2', side_effect=changed):
            with self.assertRaisesRegex(RuntimeError, 'outside DeusEdix'):
                preview.restore()
        self.assertEqual(self.target.read_bytes(), b'concurrent external edit')

    def test_invalid_map_names_and_source_equal_target_are_rejected(self):
        for name in ('../Outside', 'x/y', 'x\\y', '', 'NUL', 'name:stream', '.', None):
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    preview.stage(self.source, name)
        with self.assertRaises(ValueError):
            preview.stage(self.target, 'TestMap')
        self.assertEqual(self.target.read_bytes(), b'previous installed map')


if __name__ == '__main__':
    unittest.main()
