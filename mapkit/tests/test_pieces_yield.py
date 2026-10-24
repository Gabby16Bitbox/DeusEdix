"""The Pieces scan lets the person go first: while a request of theirs waits for the lock (a Save, a Rebuild:
server.UserTurn) it starts no more maps (24 Oct 2026: the first scan of the original game's 80 maps held the lock
map after map and a Save waited 2 minutes)."""
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import pieces_library as pl  # noqa: E402


class ScanYields(unittest.TestCase):
    def run_scan(self, waiting):
        read = []

        def read_map(name, path, identity, signature):
            read.append((name, waiting()))
            return signature
        with patch.multiple(pl, _read_map=read_map, _signature=lambda p: {'sha256': p}, _source=lambda *a: None,
                            _cache_valid=lambda *a, **k: False, _catalog=lambda: {}, _publish=lambda *a, **k: None,
                            _WORKERS=1):
            pl._cancel.clear()
            thread = threading.Thread(target=pl._run, args=(threading.RLock(), {'A': 'a', 'B': 'b'}, {}, None, None,
                                                            waiting), daemon=True)
            thread.start()
            yield read
            thread.join(5)
            self.assertFalse(thread.is_alive())

    def test_no_map_starts_while_a_request_waits(self):
        state = {'waiting': True}
        scan = self.run_scan(lambda: state['waiting'])
        read = next(scan)
        time.sleep(0.4)
        self.assertEqual(read, [], 'the scan started a map while a Save was waiting')
        state['waiting'] = False
        next(scan, None)
        self.assertEqual([name for name, _ in read], ['A', 'B'])
        self.assertFalse(any(was_waiting for _, was_waiting in read))

    def test_without_requests_it_reads_every_map(self):
        scan = self.run_scan(lambda: False)
        read = next(scan)
        next(scan, None)
        self.assertEqual([name for name, _ in read], ['A', 'B'])


if __name__ == '__main__':
    unittest.main()
