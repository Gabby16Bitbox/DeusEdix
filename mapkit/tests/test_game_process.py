"""Process ownership and cancellation without starting or closing a real game."""
import sys
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from game_process import GameSession, Identity


class FakeProcesses:
    def __init__(self):
        self.identities = {}
        self.tokens = {}
        self.closed = []
        self.close_error = None
        self.close_entered = threading.Event()
        self.close_release = None
        self.command_error = None

    def list(self):
        return list(self.identities.values())

    def alive(self, identity):
        return self.identities.get(identity.pid) == identity

    def matches_launch(self, identity, token):
        if self.command_error:
            raise self.command_error
        return self.alive(identity) and self.tokens.get(identity) == token

    def close(self, identity, grace=3):
        self.close_entered.set()
        if self.close_release:
            if not self.close_release.wait(2):
                raise AssertionError('The test did not release close')
        if self.close_error:
            raise self.close_error
        if self.alive(identity):
            self.closed.append(identity)
            del self.identities[identity.pid]
        return True

    def add(self, token, pid=123, created=134048023975010123):
        identity = Identity(pid, created, 'C:\\Game\\Revision.exe')
        self.identities[pid] = identity
        self.tokens[identity] = token
        return identity


class GameProcessTests(unittest.TestCase):
    def setUp(self):
        self.processes = FakeProcesses()
        self.session = GameSession(self.processes, launch_timeout=0.5, poll=0.005)
        self.events = []
        self.token = None

    def until(self, condition, timeout=2):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if condition():
                return
            time.sleep(0.005)
        self.fail('Timed out: %r, events=%r' % (self.session.status(), self.events))

    def start(self, immediate=True):
        def dispatch(token):
            self.token = token
            self.events.append('dispatched')
            if immediate:
                self.processes.add(token)
        self.session.start(lambda: self.events.append('prepared'), dispatch,
                           lambda: self.events.append('cleaned'))
        if immediate:
            self.until(lambda: self.session.status()['running'])

    def tearDown(self):
        self.processes.close_error = None
        if self.processes.close_release:
            self.processes.close_release.set()
        self.session.stop(timeout=0)
        self.until(lambda: not self.session.status()['launching'])

    def test_preexisting_game_is_never_claimed_or_modified(self):
        old = self.processes.add('external')
        with self.assertRaisesRegex(RuntimeError, 'already running'):
            self.start()
        self.assertEqual(self.events, [])
        self.session.stop()
        self.assertEqual(self.processes.closed, [])
        self.assertTrue(self.processes.alive(old))

    def test_unrelated_game_started_during_steam_delay_is_never_claimed(self):
        self.start(immediate=False)
        other = self.processes.add('manual-launch')
        self.until(lambda: not self.session.status()['launching'])
        self.assertFalse(self.session.status()['owned'])
        self.assertIn('did not start', self.session.status()['error'])
        self.session.stop()
        self.assertEqual(self.processes.closed, [])
        self.assertTrue(self.processes.alive(other))

    def test_status_preserves_filetime_precision_for_native_identity(self):
        self.start()
        status = self.session.status()
        self.assertEqual(status['created'], '134048023975010123')
        self.assertEqual(status['pid'], 123)
        self.assertEqual(status['token'], self.token)
        self.assertTrue(status['owned'])

    def test_stop_closes_owned_process_then_cleans_settings(self):
        self.start()
        owner = self.processes.identities[123]
        self.session.stop()
        self.assertEqual(self.processes.closed, [owner])
        self.assertEqual(self.events, ['prepared', 'dispatched', 'cleaned'])
        self.assertFalse(self.session.status()['running'])
        self.session.stop()
        self.assertEqual(self.events.count('cleaned'), 1)

    def test_pid_reuse_does_not_close_replacement(self):
        self.start()
        replacement = self.processes.add('unrelated', created=134048023975019999)
        self.session.stop()
        self.assertTrue(self.processes.alive(replacement))
        self.assertEqual(self.processes.closed, [])

    def test_stop_while_launch_pending_closes_late_matching_process(self):
        self.start(immediate=False)
        result = self.session.stop()
        self.assertTrue(result['launching'])
        self.assertTrue(result['stopping'])
        self.assertNotIn('cleaned', self.events)
        owner = self.processes.add(self.token)
        self.until(lambda: bool(self.processes.closed))
        self.assertEqual(self.processes.closed, [owner])
        self.until(lambda: self.events.count('cleaned') == 1)
        self.assertFalse(self.session.status()['running'])

    def test_pending_cancel_without_process_cleans_at_deadline(self):
        self.start(immediate=False)
        self.session.stop()
        self.assertNotIn('cleaned', self.events)
        self.until(lambda: not self.session.status()['launching'])
        self.assertEqual(self.events.count('cleaned'), 1)
        self.assertEqual(self.session.status()['error'], '')

    def test_stop_failure_keeps_ownership_and_settings_for_retry(self):
        self.start()
        self.processes.close_error = RuntimeError('Access denied')
        result = self.session.stop()
        self.assertTrue(result['running'])
        self.assertTrue(result['owned'])
        self.assertIn('Access denied', result['error'])
        self.assertNotIn('cleaned', self.events)
        self.processes.close_error = None
        self.session.stop()
        self.until(lambda: self.events.count('cleaned') == 1)

    def test_natural_exit_is_cleaned_once_without_stop(self):
        self.start()
        self.processes.identities.clear()
        self.until(lambda: self.events.count('cleaned') == 1)
        self.session.stop()
        self.assertFalse(self.session.status()['owned'])
        self.assertEqual(self.events.count('cleaned'), 1)

    def test_late_monitor_after_completed_stop_cannot_report_a_launch_timeout(self):
        self.start()
        self.session.stop()
        self.until(lambda: not self.session.status()['owned'])
        stopped = self.session.session
        self.session.clock = lambda: stopped['deadline'] + 1
        # Simulate the monitor reaching its next iteration after another thread's
        # Stop finished; its old launch deadline must no longer have any effect.
        monitor = threading.Thread(target=self.session._watch, args=(stopped,))
        monitor.start()
        monitor.join(0.5)
        self.assertFalse(monitor.is_alive())
        self.assertEqual(self.session.status()['error'], '')
        self.assertEqual(self.events.count('cleaned'), 1)

    def test_new_launch_rejected_while_previous_launch_is_pending(self):
        self.start(immediate=False)
        self.session.stop()
        with self.assertRaisesRegex(RuntimeError, 'still active'):
            self.start(immediate=False)
        self.assertEqual(self.events.count('dispatched'), 1)

    def test_start_failure_restores_prepared_settings(self):
        def fail(_token):
            raise RuntimeError('Steam missing')
        with self.assertRaisesRegex(RuntimeError, 'Steam missing'):
            self.session.start(lambda: self.events.append('prepared'), fail,
                               lambda: self.events.append('cleaned'))
        self.assertEqual(self.events, ['prepared', 'cleaned'])
        self.assertFalse(self.session.status()['launching'])

    def test_verification_failure_never_claims_or_terminates_game(self):
        self.processes.command_error = RuntimeError('Cannot verify launch')
        self.start(immediate=False)
        other = self.processes.add(self.token)
        self.until(lambda: not self.session.status()['launching'])
        self.assertIn('Cannot verify', self.session.status()['error'])
        self.assertFalse(self.session.status()['owned'])
        self.session.stop()
        self.assertTrue(self.processes.alive(other))
        self.assertEqual(self.processes.closed, [])

    def test_stop_waits_for_confirmed_exit_before_cleanup_and_status_remains_readable(self):
        self.start()
        self.processes.close_release = threading.Event()
        stopping = threading.Thread(target=lambda: self.session.stop())
        stopping.start()
        self.assertTrue(self.processes.close_entered.wait(1))
        self.assertNotIn('cleaned', self.events)
        status = self.session.status()
        self.assertTrue(status['owned'])
        self.assertTrue(status['running'])
        self.processes.close_release.set()
        stopping.join(2)
        self.assertFalse(stopping.is_alive())
        self.until(lambda: self.events.count('cleaned') == 1)
        self.assertEqual(len(self.processes.closed), 1)

    def test_failed_cleanup_can_be_retried_without_another_process_close(self):
        attempts = []
        def cleanup():
            attempts.append(1)
            if len(attempts) == 1:
                raise RuntimeError('Config busy')
        self.session.start(lambda: None, lambda token: self.processes.add(token), cleanup)
        self.until(lambda: self.session.status()['running'])
        self.session.stop()
        self.assertIn('Config busy', self.session.status()['error'])
        self.assertFalse(self.session.status()['running'])
        self.session.stop()
        self.assertEqual(len(attempts), 2)
        self.assertEqual(len(self.processes.closed), 1)
        self.assertEqual(self.session.status()['error'], '')

    def test_a_launch_looks_for_its_game_every_launch_poll_then_every_poll(self):
        """startup2: while it launches, the session lists the processes every launch_poll (the game Steam starts about
        2 s after Play is claimed soon after it appears: the desktop app embeds it only then); once it owns the game, it
        checks it every poll."""
        lists, checks = [], []
        listed, alive = self.processes.list, self.processes.alive
        self.processes.list = lambda: lists.append(time.monotonic()) or listed()
        self.processes.alive = lambda identity: checks.append(time.monotonic()) or alive(identity)
        self.session = GameSession(self.processes, launch_timeout=5, poll=1.0, launch_poll=0.01)
        self.start(immediate=False)
        time.sleep(0.3)
        self.assertGreater(len(lists), 10, 'listed every launch_poll, not every poll')
        self.processes.add(self.token)
        self.until(lambda: self.session.status()['running'], timeout=0.5)
        claimed, checks[:] = time.monotonic(), []
        time.sleep(0.3)
        self.assertLessEqual(len([t for t in checks if t > claimed + 0.05]), 1, 'owned: checked every poll')

    def test_a_failed_tidy_up_says_what_failed_and_not_that_settings_were_lost(self):
        """Review #16: since 29 Oct 2026 a Play's cleanup only removes its own launch copies and files; the player's
        settings are never written, so its failure says that Play could not tidy up, not that settings were not
        restored (which read as the player's own being damaged)."""
        def cleanup():
            raise PermissionError(32, 'DeusEdixPlay_p.ini is in use')
        self.session.start(lambda: None, lambda token: self.processes.add(token), cleanup)
        self.until(lambda: self.session.status()['running'])
        self.session.stop()
        self.assertEqual(self.session.status()['error'], 'Play could not tidy up after the game (choose Stop again to '
                                                         'retry): [Errno 32] DeusEdixPlay_p.ini is in use')


if __name__ == '__main__':
    unittest.main()
