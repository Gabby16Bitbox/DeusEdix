"""Prestarted compiler ownership, cancellation and fail-fast retry policy."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import kit


class PreparedBuild(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        (self.folder / 'System').mkdir()
        (self.folder / 'Output').mkdir()
        self.host = self.folder / 'host.exe'
        self.host.write_bytes(b'--wait-batch\0')
        self.proc = Mock(_handle=1, returncode=0)
        self.proc.poll.return_value = None
        self.addCleanup(patch.stopall)
        patch.object(kit, 'HOST', self.host).start()
        patch.object(kit, 'new_run', return_value=self.folder).start()
        patch.object(kit.subprocess, 'Popen', return_value=self.proc).start()
        patch('build_cpu.prefer_performance', return_value=[]).start()
        patch.dict(os.environ, DEUSEDIX_BUILD_PREWARM='auto').start()

    def test_preparation_failure_closes_only_owned_process_and_log(self):
        with self.assertRaisesRegex(ValueError, 'invalid map'):
            with kit.prewarm_build('test') as ready:
                raise ValueError('invalid map')
        self.proc.kill.assert_called_once()
        self.proc.wait.assert_called_once()
        self.assertTrue(ready.stream.closed)

    def test_old_host_and_explicit_off_do_not_start_process(self):
        for old, mode in ((True, 'auto'), (False, 'off')):
            self.host.write_bytes(b'old' if old else b'--wait-batch\0')
            with patch.dict(os.environ, DEUSEDIX_BUILD_PREWARM=mode):
                with kit.prewarm_build('test') as ready:
                    self.assertIsNone(ready)
        kit.subprocess.Popen.assert_not_called()

    def test_finished_process_is_not_killed_again(self):
        self.proc.poll.return_value = 0
        with kit.prewarm_build('test') as ready:
            command_file = self.folder / 'commands.txt'
            ready.send(self.folder, 'build.log', command_file)
            self.proc.stdin.write.assert_called_once_with((str(command_file.absolute())+'\n').encode('utf-8'))
            with self.assertRaises(RuntimeError):
                ready.send(self.folder, 'build.log', command_file)
        self.proc.kill.assert_not_called()
        self.assertTrue(ready.stream.closed)

    def test_mismatched_run_is_rejected_before_handoff(self):
        with kit.prewarm_build('test') as ready:
            with self.assertRaises(RuntimeError):
                ready.send(self.folder / 'different', 'build.log', self.folder/'commands.txt')
            with self.assertRaises(RuntimeError):
                ready.send(self.folder, 'different.log', self.folder/'commands.txt')
            self.proc.stdin.write.assert_not_called()

    def test_cancelled_watch_never_sends_batch(self):
        watch = Mock()
        watch.started.side_effect = kit.Stopped('cancelled')
        with kit.prewarm_build('test') as ready:
            with self.assertRaises(kit.Stopped):
                kit.execute(self.folder, ['MAP NEW'], 'build.log', watch=watch, prepared=ready)
            self.proc.stdin.write.assert_not_called()
            self.proc.kill.assert_called()

    def test_timeout_kills_worker_and_is_not_retried(self):
        self.proc.wait.side_effect = [subprocess.TimeoutExpired('host', .1), None, None]
        with kit.prewarm_build('test') as ready:
            with self.assertRaises(subprocess.TimeoutExpired):
                kit.execute(self.folder, ['MAP NEW'], 'build.log', timeout=.1, prepared=ready)
            kit.subprocess.Popen.assert_called_once()
            self.proc.kill.assert_called()

    def test_driver_retry_starts_fresh_compiler(self):
        (self.folder/'build.log').write_text('UCMapKit|command|LIGHT APPLY\n')
        prepared = object()
        with patch.object(kit, '_execute', side_effect=[RuntimeError('driver'), ('success', 1)]) as execute, \
             patch.object(kit.time, 'sleep'):
            result = kit.execute(self.folder, ['LIGHT APPLY'], 'build.log', tries=2, prepared=prepared)
        self.assertEqual(result, ('success', 1))
        self.assertIs(execute.call_args_list[0].args[-1], prepared)
        self.assertIsNone(execute.call_args_list[1].args[-1])


if __name__ == '__main__': unittest.main()
