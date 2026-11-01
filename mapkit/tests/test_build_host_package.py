"""The package of the project that the warm build host holds does not stop the next compile (fix-back2, 30 Oct 2026: a
Play after a Story change failed with [Errno 13] on dist\\DXP_<id>.u for two minutes after a build, game test c3 and
c3b). The host (resident_build: kept IDLE_SECONDS after a build) loads dist's packages through the hard links of its
run's System (kit.new_run) and keeps them open sharing reading and deleting, not writing (measured on the real host
the same day): DeusEdix's compile puts its package in dist as a new file (atomicfile), which Windows allows beside that
handle; a development working copy's build.ps1 writes into dist's file in place, so the idle host lets go before it runs
(resident_build.release)."""
import ast
import ctypes
import os
import re
import subprocess
import sys
import tempfile
import types
import unittest
from ctypes import wintypes
from pathlib import Path
from unittest.mock import Mock, patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import resident_build  # noqa: E402
import workspace  # noqa: E402


def hold(path):
    """`path` opened as the build host holds a package: reading, others may read and delete it, not write it."""
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
                                   wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateFileW(str(path), 0x80000000, 0x1 | 0x4, None, 3, 0x80, None)   # GENERIC_READ, SHARE_READ|DELETE
    if handle in (None, wintypes.HANDLE(-1).value):
        raise ctypes.WinError(ctypes.get_last_error())
    return lambda: kernel.CloseHandle(handle)


@unittest.skipUnless(os.name == 'nt', 'Windows file sharing')
class CompileBesideTheWarmHost(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.system, self.dist = root / 'DevInstall' / 'System', root / 'dist'
        host = root / 'bin' / 'UCMapKitHost.exe'
        for folder in (self.system, self.dist, host.parent, root / 'runs' / 'run' / 'System'):
            folder.mkdir(parents=True)
        host.write_bytes(b'host')
        self.package = self.dist / 'P.u'
        self.package.write_bytes(b'the package the host loaded')
        self.linked = root / 'runs' / 'run' / 'System' / 'P.u'
        os.link(self.package, self.linked)                     # kit.new_run: a link, not a copy
        self.addCleanup(hold(self.linked))                     # closed before the folder goes (cleanups: last first)
        stack = patch.multiple(workspace, SYS=self.system, DIST=self.dist, HOST=host, STAMP=root / 'workspace.json',
                               COMPILE_LOG=root / 'compile.log', ensure=lambda log=None: True, _copy_native=lambda: None,
                               runtime_fingerprint=lambda: 'sources',
                               settings=types.SimpleNamespace(PACKAGE='P', MANAGED_PROJECT=False))
        stack.start()
        self.addCleanup(stack.stop)

    def compiler(self, args, **kwargs):
        """The host's --make: the package compiled into the workspace's System."""
        (self.system / 'P.u').write_bytes(b'the package compiled now')
        return subprocess.CompletedProcess(args, 0, stdout='Success', stderr='')

    def test_deusedix_compile_replaces_the_package_the_warm_host_holds(self):
        with patch.object(workspace.subprocess, 'run', side_effect=self.compiler):
            ok, lines = workspace.build(log=lambda *a: None)
        self.assertTrue(ok, lines)
        self.assertEqual(self.package.read_bytes(), b'the package compiled now')
        self.assertEqual(self.linked.read_bytes(), b'the package the host loaded', "the host's own file, as it was")
        self.assertEqual(sorted(p.name for p in self.dist.iterdir()), ['P.u', 'runtime-build.json'], 'no copy left over')


class WorkingCopyCompile(unittest.TestCase):
    """A development working copy compiles with its build.ps1 (server.run_ps), which copies the package it made into
    dist's file in place: the idle warm host lets go of it first."""

    def setUp(self):
        self.events = []
        source = (KIT / 'editor' / 'server.py').read_text(encoding='utf-8-sig')
        tree = ast.parse(source)
        self.namespace = dict(re=re, PROJECT=Path('project'), settings=types.SimpleNamespace(STANDALONE=False),
                              subprocess=types.SimpleNamespace(run=self.powershell))
        exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'run_ps'],
                                type_ignores=[]), 'server.py', 'exec'), self.namespace)
        held = types.SimpleNamespace(release=lambda: self.events.append('release'))
        selected = types.SimpleNamespace(activate=lambda: self.events.append('activate'))     # never the game's ini
        modules = patch.dict(sys.modules, {'resident_build': held, 'workspace': selected})
        modules.start()
        self.addCleanup(modules.stop)

    def powershell(self, args, **kwargs):
        self.events.append(Path(args[args.index('-File') + 1]).name)
        return subprocess.CompletedProcess(args, 0, stdout='OK: dist\\P.u', stderr='')

    def test_build_ps1_runs_after_the_warm_host_let_go(self):
        self.assertTrue(self.namespace['run_ps']('build.ps1', '-Isolated')[0])
        self.assertEqual(self.events, ['release', 'build.ps1'])
        self.events.clear()
        self.namespace['run_ps']('install.ps1')
        self.assertEqual(self.events, ['install.ps1', 'activate'], 'the install only reads dist')


class Release(unittest.TestCase):
    def test_release_closes_the_idle_warm_host(self):
        pool = resident_build.Pool()
        process = Mock()
        process.poll.return_value = None
        lease = Mock()
        pool.process, pool.lease, pool.key, pool.count = process, lease, 'its packages', 3
        with patch.object(resident_build, '_pool', pool):
            resident_build.release()
        process.stdin.close.assert_called_once()
        lease.close.assert_called_once()
        self.assertEqual((pool.process, pool.lease, pool.key, pool.count), (None, None, None, 0))
        with patch.object(resident_build, '_pool', pool):
            resident_build.release()                           # none running: nothing to do


if __name__ == '__main__':
    unittest.main()
