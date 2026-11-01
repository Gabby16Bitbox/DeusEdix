from pathlib import Path
import json
import os
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import preview_bundle as preview


class PreviewBundle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runs = self.root / 'runs'
        self.run = self.runs / 'private'
        self.output = self.run / 'Preview/Output'
        (self.output / 'tex').mkdir(parents=True)
        self.map = self.root / 'Example.dx'
        self.map.write_bytes(b'map version one')
        self.host = self.root / 'host.exe'
        self.host.write_bytes(b'host UC_PREVIEW\0')
        self.kit = types.SimpleNamespace(RUNS=self.runs, HOST=self.host, host_files=lambda: [self.host])
        self.addCleanup(patch.stopall)
        patch.dict(sys.modules, kit=self.kit).start()
        patch.dict(os.environ, DEUSEDIX_BUILD_PREVIEW='1').start()
        for name in preview.REQUIRED:
            (self.output / name).write_bytes(b'valid ' + name.encode())
        (self.output / 'complete.json').write_text(json.dumps(dict(version=1, textures={'Map.Sign': '0'})))
        (self.output / 'tex/0.bmp').write_bytes(b'pixels')

    def test_digest_matches_sha256_for_empty_and_multichunk_files(self):
        import hashlib
        # The same test runs inside the frozen Python 3.10 executable.
        for content in (b'', b'abc', bytes(range(256)) * 8193):
            with self.subTest(size=len(content)):
                path = self.root / 'hash-input.bin'
                path.write_bytes(content)
                self.assertEqual(preview.digest(path), hashlib.sha256(content).hexdigest())

    def publish(self):
        (self.output.parent / 'inputs.json').write_text(json.dumps(dict(
            dependencies=preview.dependencies(), producer=preview.producer(self.kit.host_files()))))
        self.assertTrue(preview.publish(self.map, self.run))

    def test_package_changed_during_build_is_not_published(self):
        self.kit.DEV = self.root
        package = self.root / 'Textures.utx'
        package.write_bytes(b'old')
        preview.commands(self.run, 'Example', enabled=True)
        package.write_bytes(b'changed during build')
        self.assertFalse(preview.publish(self.map, self.run))

    def test_complete_bundle_is_read_only_and_commands_are_not_executed(self):
        self.publish()
        session = preview.open_session(self.map)
        self.assertEqual(session.texture_files, {'Map.Sign': '0'})
        self.assertEqual(session.cmd('MAP LOAD FILE="unused"'), '')
        with self.assertRaises(preview.Unavailable):
            session.cmd('LIGHT APPLY')
        with self.assertRaises(preview.Unavailable):
            session.cmd('UC_PROP Whatever')

    def test_changed_map_with_same_size_and_timestamp_is_not_reused(self):
        self.publish()
        stamp = self.map.stat()
        self.map.write_bytes(b'map version two')
        os.utime(self.map, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        self.assertIsNone(preview.open_session(self.map))

    def test_host_upgrade_invalidates_bundle(self):
        self.publish()
        self.host.write_bytes(b'host UC_PREVIEW\0 newer')
        self.assertIsNone(preview.open_session(self.map))

    def test_changed_external_package_invalidates_bundle(self):
        self.kit.DEV = self.root
        package = self.root / 'Textures.utx'
        package.write_bytes(b'old texture')
        self.publish()
        package.write_bytes(b'new texture data')
        self.assertIsNone(preview.open_session(self.map))

    def test_modified_geometry_and_texture_are_not_reused(self):
        for name in ('bsp.bin', 'tex/0.bmp'):
            self.publish()
            (self.output / name).write_bytes(b'changed')
            self.assertIsNone(preview.open_session(self.map))

    def test_missing_run_falls_back(self):
        self.publish()
        (self.output / 'scene.t3d').unlink()
        self.assertIsNone(preview.open_session(self.map))

    def test_incomplete_build_removes_previous_manifest(self):
        self.publish()
        (self.output / 'complete.json').unlink()
        self.assertFalse(preview.publish(self.map, self.run))
        self.assertFalse(self.map.with_suffix(preview.SIDECAR).exists())

    def test_sidecar_cannot_redirect_to_external_directory(self):
        self.publish()
        sidecar = self.map.with_suffix(preview.SIDECAR)
        value = json.loads(sidecar.read_text())
        for location in ('../Preview/Output', str(self.root / 'elsewhere/Preview/Output')):
            value['folder'] = location
            sidecar.write_text(json.dumps(value))
            self.assertIsNone(preview.open_session(self.map))

    def test_unsafe_texture_index_is_refused(self):
        (self.output / 'complete.json').write_text(json.dumps(dict(version=1, textures={'x': '../secret'})))
        self.assertFalse(preview.publish(self.map, self.run))

    def test_only_enabled_supported_host_adds_preview_commands(self):
        self.assertEqual(preview.commands(self.run, 'Example'), [])
        expected = ['MAP LOAD FILE="..\\Output\\Example.dx"', 'UC_PREVIEW']
        self.assertEqual(preview.commands(self.run, 'Example', enabled=True), expected)
        self.host.write_bytes(b'old host')
        self.assertEqual(preview.commands(self.run, 'Example', enabled=True), [])
        self.assertEqual(preview.commands(self.run, '../unsafe', enabled=True), [])

    def test_switch_disables_write_and_read(self):
        self.publish()
        with patch.dict(os.environ, DEUSEDIX_BUILD_PREVIEW='0'):
            self.assertEqual(preview.commands(self.run, 'Example', enabled=True), [])
            self.assertIsNone(preview.open_session(self.map))


if __name__ == '__main__':
    unittest.main()
