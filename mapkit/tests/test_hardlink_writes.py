"""A private System folder (the workspace's, a run's) is mostly hard links to the game's own files: whatever is
written there must replace a name, never write into a file shared with the game."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import settings  # noqa: E402
import workspace  # noqa: E402
import kit  # noqa: E402
import convert  # noqa: E402


def files(*folders):
    """{path: bytes} of every file in the folders (not following links)."""
    return {p: p.read_bytes() for folder in folders for p in Path(folder).rglob('*') if p.is_file()}


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


class HardLinks(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(workspace._rmtree, self.root)     # never through a link
        probe = write(self.root / 'probe', b'x')
        try:
            os.link(probe, self.root / 'probe-link')
        except OSError:
            self.skipTest('no hard links on this disk')
        # the original game (its retail System: the editor engine) with Revision inside it
        self.game = self.root / 'Deus Ex'
        self.retail = self.game / 'System'
        self.rev_sys = self.game / 'Revision' / 'System'
        write(self.retail / 'Editor.dll', b'retail editor')
        write(self.retail / 'Core.u', b'retail core')
        write(self.retail / 'Fire.u', b'retail fire')
        # Revision's own files, two of them named like the retail ones
        write(self.rev_sys / 'Editor.dll', b'revision editor')
        write(self.rev_sys / 'Core.u', b'revision core')
        write(self.rev_sys / 'Engine.u', b'revision engine')
        write(self.rev_sys / 'Engine.int', b'revision engine int')
        write(self.rev_sys / 'Revision.exe', b'revision exe')
        write(self.rev_sys / 'Revision.ini', b'[Core.System]\r\nPaths=..\\System\\*.u\r\n'
                                             b'[Editor.EditorEngine]\r\nEditPackages=Core\r\n')
        write(self.rev_sys / 'RevisionUser.ini', b'revision user')
        self.host = write(self.root / 'bin' / 'UCMapKitHost.exe', b'new host')
        self.before = files(self.game)

    def assertGameUnchanged(self):
        self.assertEqual(files(self.game), self.before)

    def ensure(self, old_links=()):
        """workspace.ensure (twice: a refresh too) on the temporary game -> the workspace's System.
        old_links: (game file, name) pairs already hard links in it, as an older workspace may have them."""
        dev = self.root / 'project' / 'DevInstall'
        sys_dir = dev / 'System'
        sys_dir.mkdir(parents=True)
        for src, name in old_links:
            os.link(src, sys_dir / name)
        native = (write(self.root / 'bin' / 'DeusEdixNav.u', b'nav'), write(self.root / 'bin' / 'DeusEdixNav.dll', b'nav dll'))
        game = dict(GAME=self.game, GAME_SYSTEM=self.rev_sys, REVISION=self.game / 'Revision', IS_REVISION=True,
                    GAME_INI=self.rev_sys / 'Revision.ini', GAME_EXE=self.rev_sys / 'Revision.exe', MANAGED_PROJECT=False,
                    check_game=lambda *a: [])
        with patch.multiple(settings, create=True, **game), \
                patch.multiple(workspace, DEV=dev, SYS=sys_dir, SRC=self.root / 'project' / 'src' / 'Package',
                               STAMP=dev / 'workspace.json', NATIVE=native, _junction=Mock(), _ini=lambda text: text):
            self.assertTrue(workspace.ensure(log=lambda *a: None, force=True))
            self.assertTrue(workspace.ensure(log=lambda *a: None, force=True))
        self.assertEqual([p.name for p in sys_dir.glob('*.tmp')], [])
        return sys_dir

    def test_workspace_retail_packages_replace_the_links(self):
        sys_dir = self.ensure()
        self.assertGameUnchanged()
        self.assertEqual((sys_dir / 'Editor.dll').read_bytes(), b'retail editor')
        self.assertEqual((sys_dir / 'Core.u').read_bytes(), b'retail core')
        self.assertEqual((sys_dir / 'Fire.u').read_bytes(), b'retail fire')
        self.assertTrue(os.path.samefile(sys_dir / 'Engine.u', self.rev_sys / 'Engine.u'))     # still a link
        for name in ('Editor.dll', 'Core.u'):
            self.assertFalse(os.path.samefile(sys_dir / name, self.rev_sys / name), name)

    def test_workspace_ini_files_linked_by_an_older_workspace(self):
        sys_dir = self.ensure(old_links=((self.rev_sys / 'Revision.ini', 'Revision.ini'),
                                         (self.rev_sys / 'RevisionUser.ini', 'User.ini')))
        self.assertGameUnchanged()
        self.assertEqual((sys_dir / 'User.ini').read_bytes(), b'revision user')
        self.assertFalse(os.path.samefile(sys_dir / 'Revision.ini', self.rev_sys / 'Revision.ini'))
        self.assertFalse(os.path.samefile(sys_dir / 'User.ini', self.rev_sys / 'RevisionUser.ini'))

    def test_kit_new_run_never_writes_into_a_game_file(self):
        dev = self.root / 'project' / 'DevInstall' / 'System'
        dev.mkdir(parents=True)
        for f in self.rev_sys.iterdir():
            if f.suffix.lower() != '.ini':
                os.link(f, dev / f.name)
        # the DevInstall a game file named like the host or an ini would give: still links into the game
        os.link(write(self.rev_sys / self.host.name, b'game file named like the host'), dev / self.host.name)
        os.link(self.rev_sys / 'Revision.ini', dev / 'Revision.ini')
        write(dev / 'DeusEx.ini', (self.rev_sys / 'Revision.ini').read_bytes())
        self.before = files(self.game)
        dist = write(self.root / 'project' / 'dist' / (settings.PACKAGE + '.u'), b'editor package')
        with patch.multiple(kit, PROJECT=self.root / 'project', DEV=dev, RUNS=self.root / 'project' / 'runs',
                            HOST=self.host, PACKAGES_FILE=self.root / 'packages.json'):
            run = kit.new_run(label='links') / 'System'
        self.assertGameUnchanged()
        self.assertEqual((run / self.host.name).read_bytes(), b'new host')
        self.assertTrue(os.path.samefile(run / 'Engine.u', self.rev_sys / 'Engine.u'))
        self.assertTrue(os.path.samefile(run / dist.name, dist))
        self.assertFalse(os.path.samefile(run / 'Revision.ini', self.rev_sys / 'Revision.ini'))
        self.assertEqual([p.name for p in run.glob('*.tmp')], [])

    def test_convert_run_never_writes_into_a_game_file(self):
        with patch.multiple(convert, RUNS=self.root / 'runs', HOST=self.host):
            run = convert._run(self.game, 'revision', 'links') / 'System'
        self.assertGameUnchanged()
        self.assertTrue(os.path.samefile(run / 'Editor.dll', self.retail / 'Editor.dll'))
        self.assertTrue(os.path.samefile(run / 'Core.u', self.retail / 'Core.u'))
        self.assertTrue(os.path.samefile(run / 'Engine.u', self.rev_sys / 'Engine.u'))
        self.assertEqual((run / 'User.ini').read_bytes(), b'revision user')
        self.assertFalse(os.path.samefile(run / 'User.ini', self.rev_sys / 'RevisionUser.ini'))


if __name__ == '__main__':
    unittest.main()
