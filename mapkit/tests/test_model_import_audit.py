"""No engine imports or writes: extracted production functions + fake pack().

Run with --fixed to exercise the proposed replacement instead of current code.
All source files are read-only; fixture writes stay under this audit directory.
"""
import ast
import base64
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
SOURCE = Path(__file__).resolve().parents[1] / 'editor' / 'models.py'
FIXED = '--fixed' in sys.argv
if FIXED:
    sys.argv.remove('--fixed')

def load_functions():
    target = HERE / 'models.py' if FIXED else SOURCE
    source = target.read_text(encoding='utf-8')
    wanted = {'_name', '_write_3d', '_publish_package', 'pack', 'import_model', 'delete_model'}
    tree = ast.parse(source)
    selected = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in wanted], type_ignores=[])
    module = types.ModuleType('isolated_models')
    module.__dict__.update(base64=base64, json=json, Path=Path, re=re, shutil=shutil,
                           struct=struct, tempfile=tempfile, os=os, MAX_TRIS=30000, MAX_VERTICES=8191,
                           MAX_MATERIALS=8, PACKAGE='TestModels')
    exec(compile(selected, str(target), 'exec'), module.__dict__)
    return module

def payload():
    return dict(name='Chair', positions=[0, 0, 0, 1, 0, 0, 0, 1, 0], indices=[0, 1, 2],
                uvs=[0, 0, 1, 0, 0, 1], triMaterials=[0], materials=[dict(color=[1, 0, 0])])

class ImportSafety(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='.model-audit-', dir=HERE)
        self.addCleanup(self.temporary.cleanup)
        self.models = load_functions()
        self.models.SOURCES = Path(self.temporary.name) / 'models'
        self.folder = self.models.SOURCES / 'Chair'
        self.folder.mkdir(parents=True)
        self.original = b'{"source":"user original","positions":[0,0,0]}'
        (self.folder / 'model.json').write_bytes(self.original)
        (self.folder / 'tex_0.png').write_bytes(b'user texture')
        self.models.pack = Mock(return_value=(True, ['synthetic package built']))

    def assert_source_preserved(self):
        self.assertTrue((self.folder / 'model.json').is_file(), 'original editable source disappeared')
        self.assertEqual((self.folder / 'model.json').read_bytes(), self.original)
        self.assertEqual((self.folder / 'tex_0.png').read_bytes(), b'user texture')
        self.assertEqual(sorted(p.name for p in self.models.SOURCES.iterdir()), ['Chair'])

    def test_invalid_numeric_payload_preserves_saved_model_before_build(self):
        value = payload()
        value['positions'][0] = 'not a number'
        with self.assertRaises(ValueError):
            self.models.import_model(value)
        self.models.pack.assert_not_called()
        self.assert_source_preserved()

    def test_invalid_png_payload_preserves_saved_model_before_build(self):
        value = payload()
        value['materials'][0]['png'] = 'data:image/png;base64,broken!'
        with self.assertRaises(ValueError):
            self.models.import_model(value)
        self.models.pack.assert_not_called()
        self.assert_source_preserved()

    def test_pack_exception_preserves_saved_model(self):
        self.models.pack.side_effect = RuntimeError('synthetic engine unavailable')
        with self.assertRaises(RuntimeError):
            self.models.import_model(payload())
        self.assert_source_preserved()

    def test_new_import_pack_exception_removes_partial_source(self):
        shutil.rmtree(self.folder)
        self.models.pack.side_effect = RuntimeError('synthetic engine unavailable')
        with self.assertRaises(RuntimeError):
            self.models.import_model(payload())
        self.assertEqual(list(self.models.SOURCES.iterdir()), [])

    def test_restore_io_error_keeps_recoverable_backup_instead_of_cleaning_it(self):
        self.models.pack.return_value = False, ['synthetic compile error']
        rename = Path.rename
        def fail_restore(path, target):
            if path.name == 'previous':
                raise OSError('synthetic locked restore target')
            return rename(path, target)
        with patch.object(Path, 'rename', fail_restore):
            with self.assertRaises(OSError):
                self.models.import_model(payload())
        backups = list(Path(self.temporary.name).glob('.model-import-*/previous/model.json'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), self.original)

    def test_pack_rejection_preserves_saved_model(self):
        self.models.pack.return_value = False, ['synthetic compile error']
        self.assertEqual(self.models.import_model(payload()), (False, ['synthetic compile error'], None))
        self.assert_source_preserved()

    def test_delete_pack_exception_preserves_saved_model(self):
        self.models.pack.side_effect = RuntimeError('synthetic engine unavailable')
        with self.assertRaises(RuntimeError):
            self.models.delete_model('Chair')
        self.assert_source_preserved()

    def test_delete_pack_rejection_preserves_saved_model(self):
        self.models.pack.return_value = False, ['synthetic compile error']
        self.assertEqual(self.models.delete_model('Chair'), (False, ['synthetic compile error']))
        self.assert_source_preserved()

    def test_supported_triangle_count_with_8192_vertices_fails_before_mutation(self):
        value = payload()
        value['positions'] = [float(n % 100) for n in range(8192 * 3)]
        value['indices'] = list(range(8190))
        value['uvs'] = [0.0] * (8190 * 2)
        value['triMaterials'] = [0] * 2730
        # Exercise the native header builder, not a speculative format limit.
        def packing(_log):
            m = json.loads((self.folder / 'model.json').read_text(encoding='utf-8'))
            self.models._write_3d(m, Path(self.temporary.name), 'Chair', {})
            return True, []
        self.models.pack.side_effect = packing
        with self.assertRaisesRegex(ValueError, '8191'):
            self.models.import_model(value)
        self.models.pack.assert_not_called()
        self.assert_source_preserved()

    def test_success_replaces_saved_model_without_duplicate_backup_asset(self):
        self.assertEqual(self.models.import_model(payload())[2], 'TestModels.UCM_Chair')
        self.assertEqual(json.loads((self.folder / 'model.json').read_text())['indices'], [0, 1, 2])
        self.assertEqual(sorted(p.name for p in self.models.SOURCES.iterdir()), ['Chair'])

    def test_replacement_backup_is_not_discovered_as_a_second_imported_model(self):
        def packing(_log):
            discovered = [p.name for p in self.models.SOURCES.iterdir() if (p / 'model.json').exists()]
            self.assertEqual(discovered, ['Chair'])
            return True, []
        self.models.pack.side_effect = packing
        self.models.import_model(payload())

    def test_header_accepts_8191_vertices_without_truncation(self):
        value = payload()
        value['positions'] = [float(n % 100) for n in range(8191 * 3)]
        self.models._write_3d(value, Path(self.temporary.name), 'Boundary', {})
        data = (Path(self.temporary.name) / 'Boundary_a.3d').read_bytes()
        self.assertEqual(struct.unpack('<HH', data[:4]), (1, 8191 * 8))
        self.assertEqual(len(data), 4 + 8191 * 8)

    def test_header_rejects_8192_vertices_without_creating_partial_native_files(self):
        value = payload()
        value['positions'] = [0.0] * (8192 * 3)
        with self.assertRaisesRegex(ValueError, '8191'):
            self.models._write_3d(value, Path(self.temporary.name), 'Boundary', {})
        self.assertFalse((Path(self.temporary.name) / 'Boundary_a.3d').exists())
        self.assertFalse((Path(self.temporary.name) / 'Boundary_d.3d').exists())

    def test_success_delete_removes_model_after_package_succeeds(self):
        self.assertEqual(self.models.delete_model('Chair'), (True, ['synthetic package built']))
        self.assertFalse(self.folder.exists())


class PackagePublication(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='.package-audit-', dir=HERE)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.models = load_functions()
        self.models.SOURCES = self.root / 'models'
        self.models.SOURCES.mkdir()
        self.models.DIST = self.root / 'dist' / 'TestModels.u'
        self.game = self.root / 'game' / 'TestModels.u'
        self.models.CACHE = self.root / 'cache'
        self.models.settings = types.SimpleNamespace(PACKAGES_DIR=self.game.parent)
        for path, raw in [(self.models.DIST, b'old dist package'), (self.game, b'old game package')]:
            path.parent.mkdir(parents=True)
            path.write_bytes(raw)
        run = self.root / 'run'
        (run / 'Input').mkdir(parents=True)
        (run / 'Output').mkdir()
        class Session:
            def __init__(session, *_args):
                session.folder = run
            def batch(session, _cmds, **_kwargs):
                (run / 'Output' / 'TestModels.u').write_bytes(b'new compiled package')
                return 'synthetic compiler success'
            def close(session):
                pass
        self.models.kit = types.SimpleNamespace(Session=Session)
        def fake_pcx(_png, _color, destination):
            destination.write_bytes(b'synthetic texture')
            return False
        self.models._pcx = fake_pcx
        live = types.ModuleType('live')
        live.running = lambda: False
        self.live_patch = patch.dict(sys.modules, {'live': live})
        self.live_patch.start()
        self.addCleanup(self.live_patch.stop)

    def assert_prior_packages(self):
        self.assertEqual(self.models.DIST.read_bytes(), b'old dist package')
        self.assertEqual(self.game.read_bytes(), b'old game package')
        self.assertEqual(list(self.models.DIST.parent.glob('*.tmp')), [])
        self.assertEqual(list(self.game.parent.glob('*.tmp')), [])

    def fail_game_copy(self, original):
        def copy(source, destination, *args, **kwargs):
            if Path(destination).parent == self.game.parent:
                Path(destination).write_bytes(b'partial interrupted package copy')
                raise OSError('synthetic game copy failure')
            return original(source, destination, *args, **kwargs)
        return copy

    def test_game_copy_failure_keeps_dist_and_untruncated_game_package(self):
        with patch.object(shutil, 'copy2', self.fail_game_copy(shutil.copy2)):
            with self.assertRaisesRegex(OSError, 'game copy failure'):
                self.models.pack(log=lambda *_args: None)
        self.assert_prior_packages()

    def test_second_publish_failure_restores_already_published_dist(self):
        replace = os.replace
        def fail_game_publish(source, destination):
            if Path(destination) == self.game:
                raise OSError('synthetic game replace failure')
            return replace(source, destination)
        with patch.object(os, 'replace', fail_game_publish):
            with self.assertRaisesRegex(OSError, 'game replace failure'):
                self.models.pack(log=lambda *_args: None)
        self.assert_prior_packages()

    def test_success_publishes_identical_compiled_package_to_both_locations(self):
        self.assertTrue(self.models.pack(log=lambda *_args: None)[0])
        self.assertEqual(self.models.DIST.read_bytes(), b'new compiled package')
        self.assertEqual(self.game.read_bytes(), b'new compiled package')

    def test_import_game_copy_failure_keeps_both_source_and_packages(self):
        folder = self.models.SOURCES / 'Chair'
        folder.mkdir()
        original = dict(payload(), materials=[])
        before = json.dumps(original).encode()
        (folder / 'model.json').write_bytes(before)
        with patch.object(shutil, 'copy2', self.fail_game_copy(shutil.copy2)):
            with self.assertRaisesRegex(OSError, 'game copy failure'):
                self.models.import_model(dict(payload(), materials=[]), log=lambda *_args: None)
        self.assertEqual((folder / 'model.json').read_bytes(), before)
        self.assert_prior_packages()

    def test_delete_game_copy_failure_keeps_both_source_and_packages(self):
        folder = self.models.SOURCES / 'Chair'
        folder.mkdir()
        before = json.dumps(dict(payload(), materials=[])).encode()
        (folder / 'model.json').write_bytes(before)
        with patch.object(shutil, 'copy2', self.fail_game_copy(shutil.copy2)):
            with self.assertRaisesRegex(OSError, 'game copy failure'):
                self.models.delete_model('Chair')
        self.assertEqual((folder / 'model.json').read_bytes(), before)
        self.assert_prior_packages()

if __name__ == '__main__':
    unittest.main(verbosity=2)
