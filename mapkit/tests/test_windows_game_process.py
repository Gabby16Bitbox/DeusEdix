"""Exercise the real Windows API using only children created by this test (Python, or a 32-bit cmd.exe)."""
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import unittest.mock
import uuid
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_process
from game_process import Identity, WindowsProcesses


@unittest.skipUnless(os.name == 'nt', 'Windows process API')
class WindowsProcessTests(unittest.TestCase):
    def test_nonce_identity_and_pid_reuse_guard_then_close_owned_child(self):
        token = uuid.uuid4().hex
        executable = getattr(sys, '_base_executable', sys.executable)
        args = [executable, '-c', 'import time; time.sleep(45)']
        if '\\WindowsApps\\' in executable:
            # the Microsoft Store's Python: its python.exe is an App Execution Alias and the process runs another
            # file, so it is never found under this path; a program that is its own file instead
            executable = os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'System32', 'WindowsPowerShell',
                                      'v1.0', 'powershell.exe')
            args = [executable, '-NoProfile', '-Command', 'Start-Sleep -Seconds 45 #']
        child = subprocess.Popen(args + ['?DeusEdixSession=' + token], creationflags=subprocess.CREATE_NO_WINDOW)
        processes = WindowsProcesses(executable)
        try:
            candidates = processes.list()
            identity = next((p for p in candidates if p.pid == child.pid), None)
            self.assertIsNotNone(identity)
            self.assertTrue(processes.alive(identity))
            self.assertTrue(processes.matches_launch(identity, token))
            self.assertFalse(processes.matches_launch(identity, 'not-this-launch'))
            reused = Identity(identity.pid, identity.created + 1, identity.executable)
            self.assertFalse(processes.alive(reused))
            self.assertTrue(processes.close(reused, grace=0))
            self.assertIsNone(child.poll(), 'A mismatched creation time must never close the process')
            self.assertTrue(processes.close(identity, grace=0))
            child.wait(timeout=5)
            self.assertFalse(processes.alive(identity))
        finally:
            if child.poll() is None:
                child.terminate()  # Popen owns this exact process handle.
                child.wait(timeout=5)


@unittest.skipUnless(os.name == 'nt', 'Windows process API')
class GameRunningTests(unittest.TestCase):
    """settings.game_running answers as tasklist's IMAGENAME filter did (the program's name in any folder, case aside)
    from one Toolhelp snapshot, without starting tasklist (fix-back2, 30 Oct 2026: 0.3-0.5 s at the start of every Play
    preparation and every Play)."""

    @staticmethod
    def tasklist(name):
        found = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq ' + name], capture_output=True, text=True,
                               creationflags=subprocess.CREATE_NO_WINDOW)
        return name.lower() in found.stdout.lower()

    def running(self, target):
        import settings
        with unittest.mock.patch('subprocess.run', side_effect=AssertionError('tasklist started')), \
                unittest.mock.patch('subprocess.Popen', side_effect=AssertionError('a program started')):
            return settings.game_running(target)

    def test_the_games_and_a_program_of_another_name_as_tasklist_sees_them(self):
        import settings
        for target, profile in settings.TARGETS.items():
            with self.subTest(target):
                self.assertEqual(self.running(target), self.tasklist(profile['exe']))
        self.assertEqual(self.running('any'), any(self.tasklist(p['exe']) for p in settings.TARGETS.values()))
        # a 32-bit program, as the games are, under a name of its own: started and ended by this test
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        name = 'DxpFakeGame%s.exe' % uuid.uuid4().hex[:8]
        shutil.copy2(os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'SysWOW64', 'sort.exe'), folder / name)
        targets = dict(settings.TARGETS, fake=dict(settings.TARGETS[settings.TARGET], exe=name.lower()))
        with unittest.mock.patch.object(settings, 'TARGETS', targets):
            self.assertFalse(self.running('fake'))
            child = subprocess.Popen([str(folder / name)], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                     creationflags=subprocess.CREATE_NO_WINDOW)
            try:
                self.assertTrue(self.running('fake'), 'its name in another case')
                self.assertTrue(self.running('any'), "a target's program that is not the first")
                self.assertTrue(self.tasklist(name))
            finally:
                child.stdin.close()                              # sort.exe ends with its input
                child.wait(timeout=5)
            self.assertFalse(self.running('fake'))
            self.assertFalse(self.tasklist(name))


# a 32-bit program, as the game is: read from this 64-bit Python
CMD32 = os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'SysWOW64', 'cmd.exe')
STATUS_INVALID_INFO_CLASS = -0x3FFFFFFD          # 0xC0000003, as NtQueryInformationProcess returns it (an NTSTATUS)


@unittest.skipUnless(os.name == 'nt' and struct.calcsize('P') == 8 and os.path.isfile(CMD32),
                     '64-bit Python on 64-bit Windows')
class CommandLineClaimTests(unittest.TestCase):
    """The claim reads a candidate's command line through a handle of it (NtQueryInformationProcess,
    ProcessCommandLineInformation) in well under a millisecond; PowerShell's CIM (about 1.1 s, 1.9-2.7 s from the game's
    start to its claim in the Plays of 29 Oct 2026) only when that read cannot be made (startup2, 30 Oct 2026). Each
    child is a 32-bit cmd.exe waiting on its input, so that closing it ends it and nothing it started is left."""

    def setUp(self):
        self.processes = WindowsProcesses(CMD32)
        self.token = uuid.uuid4().hex
        self.cim = Mock(side_effect=AssertionError('PowerShell read while the native one works'))
        self.processes._cim_command_line = self.cim

    def child(self, words):
        child = subprocess.Popen([CMD32, '/k', 'rem ' + words], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                 creationflags=subprocess.CREATE_NO_WINDOW)

        def end():
            if child.poll() is None:
                child.stdin.close()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.terminate()                    # Popen owns this exact process handle
                    child.wait(timeout=5)
        self.addCleanup(end)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            identity = next((p for p in self.processes.list() if p.pid == child.pid), None)
            if identity:
                return child, identity
            time.sleep(0.02)
        self.fail('the child never showed in the list')

    def test_a_32_bit_game_with_this_launch_token_is_claimed_and_one_without_it_is_not(self):
        _, identity = self.child('Revision.exe 01_Map?Mutator=X.UCMutator?DeusEdixSession=' + self.token)
        _, other = self.child('Revision.exe 01_Map?Mutator=X.UCMutator')
        t0 = time.perf_counter()
        self.assertTrue(self.processes.matches_launch(identity, self.token))
        self.assertLess(time.perf_counter() - t0, 0.5)
        self.assertFalse(self.processes.matches_launch(identity, uuid.uuid4().hex))
        self.assertFalse(self.processes.matches_launch(other, self.token))
        self.assertIn('?DeusEdixSession=' + self.token, self.read(identity))
        self.cim.assert_not_called()

    def test_a_command_line_longer_than_the_first_buffer_is_read_whole(self):
        real, sizes = self.processes.query, []

        def query(handle, kind, buffer, size, needed):
            sizes.append(size)
            return real(handle, kind, buffer, size, needed)
        self.processes.query = query
        _, identity = self.child('x' * 1500 + '?DeusEdixSession=' + self.token)
        self.assertTrue(self.processes.matches_launch(identity, self.token))
        self.assertEqual(len(sizes), 2, 'asked again with the size the first call gave')
        self.assertGreater(sizes[1], 3000)

    def test_powershell_reads_it_only_when_the_native_read_is_not_there_or_fails(self):
        _, identity = self.child('?DeusEdixSession=' + self.token)
        answers = {'no call (not Windows NT)': None,
                   'no such class (Windows 7 and 8)': lambda *args: STATUS_INVALID_INFO_CLASS,
                   'an answer outside the buffer': self.outside}
        for case, query in answers.items():
            with self.subTest(case):
                self.processes.query = query
                self.processes._cim_command_line = cim = Mock(return_value='x ?DeusEdixSession=' + self.token)
                self.assertTrue(self.processes.matches_launch(identity, self.token))
                cim.assert_called_once_with(identity.pid)
                cim.return_value = 'x ?DeusEdixSession=other'
                self.assertFalse(self.processes.matches_launch(identity, self.token))

    def test_a_game_that_ends_during_the_read_is_not_claimed_and_powershell_is_not_asked(self):
        child, identity = self.child('?DeusEdixSession=' + self.token)
        real, statuses = self.processes.query, []

        def query(*args):
            child.stdin.close()
            child.wait(timeout=5)
            statuses.append(real(*args) & 0xFFFFFFFF)
            return statuses[-1]
        self.processes.query = query
        self.assertFalse(self.processes.matches_launch(identity, self.token))
        self.assertEqual(statuses, [0xC000010A], 'STATUS_PROCESS_IS_TERMINATING: it ended during the read')
        self.cim.assert_not_called()

    @staticmethod
    def outside(handle, kind, buffer, size, needed):
        """An answer whose text lies outside the buffer it was given: never read."""
        text = game_process._UnicodeString.from_buffer(buffer)
        text.Length = text.MaximumLength = 8
        text.Buffer = id(handle)
        return 0

    def read(self, identity):
        handle = self.processes._open(identity.pid)
        try:
            return self.processes.command_line(handle)
        finally:
            self.processes.kernel.CloseHandle(handle)


if __name__ == '__main__':
    unittest.main()
