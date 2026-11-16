"""An editor update's backup in a project (projects._apply_editor_update): the files it replaces are kept in
.deusedix-updates, but not the baseline (the editor's own files zipped, 28 MB: every update left one more in every
project, 14 Nov 2026), and the baselines older updates kept are removed."""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT))
import projects  # noqa: E402


class UpdateBackup(unittest.TestCase):
    def setUp(self):
        self.path = Path(tempfile.mkdtemp(prefix='update-backup-', dir=str(Path(__file__).parent)))
        self.addCleanup(shutil.rmtree, self.path, True)
        (self.path / 'tools').mkdir()
        (self.path / 'tools' / 'a.py').write_bytes(b'old a')
        (self.path / projects.BASE).write_bytes(b'old baseline')
        old = self.path / '.deusedix-updates' / '20261111-000000-aaaaaaaa' / 'files'
        (old / 'tools').mkdir(parents=True)
        (old / projects.BASE).write_bytes(b'a baseline an older update kept')
        (old / 'tools' / 'a.py').write_bytes(b'older a')
        self.old = old
        self.writes = {'tools/a.py': b'new a', projects.BASE: b'new baseline'}
        self.expected = {'tools/a.py': projects._hash(b'old a'), projects.BASE: projects._hash(b'old baseline')}

    def test_the_backup_keeps_the_replaced_files_but_no_baseline(self):
        backup = Path(projects._apply_editor_update(self.path, self.writes, self.expected))
        self.assertEqual((backup / 'files' / 'tools' / 'a.py').read_bytes(), b'old a')
        self.assertFalse((backup / 'files' / projects.BASE).exists())
        self.assertEqual((self.path / projects.BASE).read_bytes(), b'new baseline')
        # the baseline an older update kept goes, its other files stay
        self.assertFalse((self.old / projects.BASE).exists())
        self.assertEqual((self.old / 'tools' / 'a.py').read_bytes(), b'older a')

    def test_a_failed_update_puts_the_baseline_back(self):
        real, calls = projects._write, []

        def failing(path, content):
            calls.append(path)
            if Path(path) == self.path / 'tools' / 'a.py' and content == b'new a':
                raise OSError('disk full')
            return real(path, content)
        writes = {projects.BASE: b'new baseline', 'tools/a.py': b'new a'}        # the baseline first, then the failure
        with patch.object(projects, '_write', failing), self.assertRaises(OSError):
            projects._apply_editor_update(self.path, writes, self.expected)
        self.assertEqual((self.path / projects.BASE).read_bytes(), b'old baseline')
        self.assertEqual((self.path / 'tools' / 'a.py').read_bytes(), b'old a')
        self.assertTrue((self.old / projects.BASE).exists())                     # nothing cleaned on a failure


if __name__ == '__main__':
    unittest.main()
