"""Upgrading must invalidate an old runtime without erasing locally generated sources."""
import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import workspace


class RuntimeUpgrade(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.source = root / 'src'
        self.source.mkdir()
        self.file = self.source / 'UCVoiceDubs.uc'
        self.file.write_text('local dub index')
        self.dist = root / 'dist'
        self.dist.mkdir()
        self.package = self.dist / (workspace.settings.PACKAGE + '.u')
        self.package.write_bytes(b'compiled runtime')
        host, stamp = root / 'host.exe', root / 'workspace.json'
        host.write_bytes(b'host')
        stamp.write_text('{}')
        self.paths = patch.multiple(workspace, SRC=self.source, DIST=self.dist, HOST=host, STAMP=stamp)
        self.paths.start()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.paths.stop)

    def record(self):
        (self.dist / 'runtime-build.json').write_text(json.dumps(dict(
            sources=workspace.runtime_fingerprint(), package=hashlib.sha256(self.package.read_bytes()).hexdigest())))

    def test_old_install_without_manifest_rebuilds(self):
        self.assertTrue(workspace.needs_build())
        self.assertEqual(self.file.read_text(), 'local dub index')

    def test_unchanged_runtime_does_not_recompile(self):
        self.record()
        self.assertFalse(workspace.needs_build())

    def test_changed_source_with_preserved_date_rebuilds(self):
        self.record()
        date = self.file.stat().st_mtime
        self.file.write_text('new local dub index')
        os.utime(self.file, (date, date))
        self.assertTrue(workspace.needs_build())

    def test_missing_or_replaced_package_rebuilds(self):
        self.record()
        self.package.write_bytes(b'old runtime')
        self.assertTrue(workspace.needs_build())
        self.package.unlink()
        self.assertTrue(workspace.needs_build())

    def test_removed_source_or_changed_compiler_rebuilds(self):
        self.record()
        self.file.unlink()
        self.assertTrue(workspace.needs_build())
        self.file.write_text('local dub index')
        self.assertFalse(workspace.needs_build())
        workspace.HOST.write_bytes(b'new host')
        self.assertTrue(workspace.needs_build())


if __name__ == '__main__':
    unittest.main()
