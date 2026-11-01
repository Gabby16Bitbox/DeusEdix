"""Local acceleration options, evidence binding and deferred startup ordering."""
import ast
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
LAB = KIT/'experimental_bsp'
sys.path.insert(0, str(LAB))
import local_performance as performance
import worker_bridge


class LocalPerformance(unittest.TestCase):
    def test_default_is_stock_and_does_not_prewarm(self):
        self.assertEqual(performance.options({}), dict(acceleration='off', prewarm=False))

    def test_does_not_inherit_full_build_gpu_flags(self):
        self.assertEqual(performance.options({'DEUSEDIX_BSP_COMPUTE': 'gpu',
            'DEUSEDIX_BUILD_RESIDENT': 'auto'}), dict(acceleration='off', prewarm=False))

    def test_invalid_configuration_refused(self):
        for config in ({}, {'acceleration': 'gpu', 'prewarm': 1},
                       {'acceleration': 'unknown', 'prewarm': False},
                       {'acceleration': 'auto', 'prewarm': False, 'skip_proof': True}):
            with self.subTest(config=config), self.assertRaises(ValueError):
                performance.validate(config)

    def test_old_host_cannot_silently_accept_acceleration(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Path(directory)/'host.exe'
            host.write_bytes(b'old-host')
            performance.check_native(host, dict(acceleration='off', prewarm=False))
            with self.assertRaises(ValueError):
                performance.check_native(host, dict(acceleration='auto', prewarm=False))
            host.write_bytes(b'UCMapKit|local acceleration capability|1\0')
            performance.check_native(host, dict(acceleration='verify', prewarm=False))

    def test_environment_is_pinned_without_changing_parent(self):
        original = {performance.ACCELERATION: 'gpu', 'PATH': 'fixture'}
        env = performance.environment(dict(acceleration='verify', prewarm=True), original)
        self.assertEqual(original[performance.ACCELERATION], 'gpu')
        self.assertEqual(performance.options(env), dict(acceleration='verify', prewarm=True))
        self.assertEqual(env['PATH'], 'fixture')

    def test_request_and_receipt_bind_performance_mode(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(worker_bridge, 'ROOT', Path(directory)), \
             patch.object(worker_bridge, 'fingerprint', return_value={}):
            source = Path(directory)/'map.dx'
            source.write_bytes(b'private test input')
            with patch.dict('os.environ', {performance.ACCELERATION: 'off', performance.PREWARM: 'on'}):
                job, digest = worker_bridge.prepare(source, worker_bridge.sha(source), {'Brush1': {'move': [1, 0, 0]}})
            _, request = worker_bridge.validate_request(job, digest)
            self.assertEqual(request['performance'], dict(acceleration='off', prewarm=True))
            with self.assertRaisesRegex(worker_bridge.Rejected, 'configuration changed'):
                worker_bridge.stage_result(job, request, {'performance': dict(acceleration='gpu', prewarm=True)})
            changed = dict(request, performance=dict(acceleration='off', prewarm=False))
            (job/'request.json').write_text(json.dumps(changed))
            with self.assertRaisesRegex(worker_bridge.Rejected, 'request changed'):
                worker_bridge.validate_request(job, digest)


class DeferredReadiness(unittest.TestCase):
    def test_failed_startup_sends_no_commands(self):
        source = ast.parse((KIT/'kit.py').read_text())
        cls = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == 'Session')
        namespace = {}
        exec(compile(ast.Module(body=[cls], type_ignores=[]), str(KIT/'kit.py'), 'exec'), namespace)
        session = namespace['Session'].__new__(namespace['Session'])
        session._pending_ready = True
        writes = io.BytesIO()
        session.proc = type('Process', (), {'stdin': writes})()
        def collect(count, timeout):
            raise RuntimeError('startup failed')
        session._collect = collect
        with self.assertRaisesRegex(RuntimeError, 'startup failed'):
            session.cmd('MAP LOAD FILE="..\\Input\\source.dx"')
        self.assertEqual(writes.getvalue(), b'')
        self.assertTrue(session._pending_ready)

    def test_no_command_is_sent_until_startup_has_finished(self):
        # Extract the class to avoid importing settings or starting a process.
        import re
        source = ast.parse((KIT/'kit.py').read_text())
        cls = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == 'Session')
        namespace = {'re': re}
        exec(compile(ast.Module(body=[cls], type_ignores=[]), str(KIT/'kit.py'), 'exec'), namespace)
        session = namespace['Session'].__new__(namespace['Session'])
        session._pending_ready = True
        writes = io.BytesIO()
        session.proc = type('Process', (), {'stdin': writes})()
        events = []
        def collect(count, timeout):
            events.append((count, writes.getvalue()))
            return 'UCMapKit|ready'
        session._collect = collect
        session.cmd('MAP LOAD FILE="..\\Input\\source.dx"')
        session.cmd('UC_CERT_PROFILE')
        self.assertEqual(events[0], (1, b''))
        self.assertEqual(len(events), 3)  # one startup, two command replies
        self.assertFalse(session._pending_ready)
        self.assertIn(b'MAP LOAD', events[1][1])


if __name__ == '__main__':
    unittest.main()
