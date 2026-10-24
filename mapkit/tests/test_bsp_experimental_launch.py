"""Map > Local geometry (Experimental) says so when its window cannot start. Until 24 Oct 2026 the launcher looked at
the window's process the instant it began: a Python without pywebview (the development workspace's) died a moment
later, and the editor still answered 'Experimental BSP opened...' with nothing on screen."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import bsp_experimental  # noqa: E402


class Launch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.kit = Path(self.tmp.name) / 'mapkit'
        (self.kit / 'experimental_bsp').mkdir(parents=True)
        (self.kit / 'experimental_bsp' / 'app.py').write_text('', encoding='utf-8')
        self.map = Path(self.tmp.name) / 'Map.dx'
        self.map.write_bytes(b'not a real map')
        self.started = []
        real = subprocess.Popen

        def popen(*args, **kwargs):
            self.started.append(real(*args, **kwargs))
            return self.started[-1]
        patcher = patch.object(bsp_experimental.subprocess, 'Popen', popen)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        for p in self.started:
            p.wait(timeout=30)
        self.tmp.cleanup()

    def launch(self, code):
        return bsp_experimental.launch(self.map, kit_dir=self.kit, python_command=[sys.executable, '-c', code], label='Map')

    def test_a_window_that_cannot_start_is_reported(self):
        with self.assertRaisesRegex(RuntimeError, r"could not start \(ModuleNotFoundError: No module named 'no_such_window_module'\)"):
            self.launch('import no_such_window_module')

    def test_a_window_that_runs_is_opened(self):
        with patch.object(bsp_experimental, 'STARTUP_SECONDS', 0.5):
            result = self.launch('import time; time.sleep(3)')
        self.assertTrue(result['started'])
        handoffs = list((self.kit / 'experimental_bsp' / 'handoffs').glob('*/handoff.json'))
        self.assertEqual(len(handoffs), 1)


if __name__ == '__main__':
    unittest.main()
