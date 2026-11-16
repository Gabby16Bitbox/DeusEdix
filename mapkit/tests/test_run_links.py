"""A run's System (kit.py): the game's programs and packages are hard links only while its host runs. Once it has
ended they go (release_system), so a project's runs no longer look like gigabytes of copies in Explorer (14 Nov 2026:
20 runs kept, 580 MB of links each); a run used again gets them back (link_system). A finished run whose outputs
were read is deleted at once (discard), and fewer runs are kept (prune)."""
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import kit  # noqa: E402


class RunLinks(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='runlinks-', dir=str(Path(__file__).parent)))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        dev, dist, runs = self.tmp / 'DevInstall' / 'System', self.tmp / 'dist', self.tmp / 'runs'
        for d in (dev, dist, runs, self.tmp / 'bin'):
            d.mkdir(parents=True)
        for name in ('Core.dll', 'Engine.u', 'Core.int', 'DeusEx.exe'):
            (dev / name).write_bytes(b'game ' + name.encode())
        (dev / 'DeusEx.ini').write_text('[x]\n')
        host = self.tmp / 'bin' / 'Host.exe'
        if os.name == 'nt':
            shutil.copy2(Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32' / 'cmd.exe', host)
        else:
            host.write_bytes(b'host')
        stack = ExitStack()
        self.addCleanup(stack.close)
        for name, value in (('PROJECT', self.tmp), ('DEV', dev), ('RUNS', runs), ('HOST', host),
                            ('host_files', lambda: [host]), ('native_files', lambda: []),
                            ('extra_packages', lambda: []), ('_ini', lambda system: '[made]\n')):
            stack.enter_context(patch.object(kit, name, value))
        self.dev, self.runs, self.host = dev, runs, host

    def linked(self, folder):
        return sorted(p.name for p in (folder / 'System').iterdir() if p.stat().st_nlink > 1)

    def test_a_finished_run_loses_its_links_and_gets_them_back(self):
        run = kit.new_run(label='t')
        self.assertEqual(self.linked(run), ['Core.dll', 'Core.int', 'DeusEx.exe', 'Engine.u'])
        self.assertEqual((run / 'System' / 'Host.exe').stat().st_nlink, 1)          # the host: a copy
        (run / 'System' / 'Made.u').write_bytes(b'what the run compiled')
        self.assertEqual(kit.release_system(run), 4)
        self.assertEqual(sorted(p.name for p in (run / 'System').iterdir()),
                         ['Default.ini', 'DeusEx.ini', 'Editor.ini', 'Host.exe', 'Made.u', 'Revision.ini', 'UnrealEd.ini', 'ucc.ini'])
        self.assertEqual((self.dev / 'Engine.u').read_bytes(), b'game Engine.u')    # the game's file is where it was
        self.assertEqual(kit.release_system(run), 0)
        (run / 'System' / 'Core.int').write_bytes(b'the run wrote this name')       # a name there is kept
        kit.link_system(run / 'System')
        self.assertEqual(self.linked(run), ['Core.dll', 'DeusEx.exe', 'Engine.u'])
        self.assertEqual((run / 'System' / 'Core.int').read_bytes(), b'the run wrote this name')

    def test_a_run_used_again_gets_its_links_back_where_it_can(self):
        run = kit.new_run(label='t')
        kit.release_system(run)
        kit.relink_system(run)
        self.assertEqual(len(self.linked(run)), 4)
        kit.release_system(run)
        with patch.object(kit, 'DEV', self.tmp / 'not there'):      # a run made elsewhere (a test's own folder)
            kit.relink_system(run)
        self.assertEqual(self.linked(run), [])
        kit.relink_system(self.tmp / 'no such run')                 # nothing to do, and no error

    def test_keeping_the_links_can_be_asked(self):
        run = kit.new_run(label='t')
        with patch.dict(os.environ, {'DEUSEDIX_KEEP_RUN_LINKS': '1'}):
            self.assertEqual(kit.release_system(run), 0)
        self.assertEqual(len(self.linked(run)), 4)

    @unittest.skipUnless(os.name == 'nt', 'a running program cannot be opened for writing on Windows')
    def test_a_run_whose_host_runs_is_left_alone(self):
        run = kit.new_run(label='t')
        process = subprocess.Popen([str(run / 'System' / 'Host.exe'), '/c', 'pause'], stdin=subprocess.PIPE,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=run / 'System',
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            self.assertTrue(kit.run_busy(run))
            self.assertEqual(kit.release_system(run), 0)
            self.assertFalse(kit.discard(run))
            with patch.object(kit, 'KEEP_RUNS', 0):
                kit.prune(keep=0)
            self.assertEqual(len(self.linked(run)), 4)
        finally:
            process.stdin.close()
            process.kill()
            process.wait()
        for _ in range(50):                     # Windows lets the program go a moment after its process
            if not kit.run_busy(run):
                break
            time.sleep(0.1)
        self.assertEqual(kit.release_system(run), 4)
        self.assertTrue(kit.discard(run))
        self.assertFalse(run.exists())

    def test_prune_keeps_few_runs_and_takes_the_links_of_old_ones(self):
        old = self.runs / '20200101-000000-old-aaaaaa'
        (old / 'System').mkdir(parents=True)
        os.link(self.dev / 'Engine.u', old / 'System' / 'Engine.u')
        runs = [kit.new_run(label='r%d' % i) for i in range(3)]
        with patch.object(kit, 'KEEP_RUNS', 3):
            last = kit.new_run(label='last')        # prunes first: the old one is the fourth
        self.assertFalse(old.exists())
        self.assertTrue(all(r.exists() for r in runs) and last.exists())
        self.assertEqual(len(self.linked(runs[0])), 4)      # young: its links are its own business
        stale = self.runs / '20200101-000000-stale-bbbbbb'
        (stale / 'System').mkdir(parents=True)
        os.link(self.dev / 'Engine.u', stale / 'System' / 'Engine.u')
        os.rename(stale, self.runs / ('99990101-000000-stale-bbbbbb'))      # sorts newest, though made long ago
        stale = self.runs / '99990101-000000-stale-bbbbbb'
        with patch.object(kit, '_run_age', lambda d: 3600.0 if 'stale' in d.name else 0.0):
            kit.prune(keep=10)
        self.assertEqual(self.linked(stale), [])
        self.assertEqual(len(self.linked(last)), 4)

    def test_discard_only_deletes_a_run(self):
        run = kit.new_run(label='t')
        outside = self.tmp / 'elsewhere'
        (outside / 'System').mkdir(parents=True)
        self.assertFalse(kit.discard(outside))
        self.assertFalse(kit.discard(self.runs))
        self.assertTrue(outside.exists() and self.runs.exists())
        self.assertTrue(kit.discard(run))
        self.assertFalse(run.exists())


if __name__ == '__main__':
    unittest.main()
