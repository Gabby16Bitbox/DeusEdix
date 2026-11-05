import os
import struct
import unittest
from unittest.mock import patch

import build_cpu


def row(ident, logical, efficiency, flags=0, group=0, size=32, kind=0):
    return (struct.pack('<IIIH6BIQ',size,kind,ident,group,logical,logical,0,0,efficiency,flags,0,0)
            + bytes(size-32))


class CpuPolicy(unittest.TestCase):
    def test_selects_available_fast_cores_on_hybrid_cpu(self):
        data=row(100,0,1)+row(101,1,1,flags=1)+row(102,2,0)
        self.assertEqual(build_cpu._select(data,7),[100,101])

    def test_does_nothing_for_homogeneous_or_restricted_cpu(self):
        data=row(100,0,1)+row(101,1,1)+row(102,2,0)
        self.assertEqual(build_cpu._select(data,3),[])
        self.assertEqual(build_cpu._select(data,4),[])
        self.assertEqual(build_cpu._select(data,0),[])

    def test_excludes_reserved_and_realtime_cores(self):
        data=row(100,0,2,flags=2)+row(101,1,1,flags=6)+row(102,2,0)+row(103,3,2,flags=8)
        self.assertEqual(build_cpu._select(data,15),[101])

    def test_unknown_entries_and_future_sizes(self):
        data=row(100,0,7,kind=4)+row(101,1,1,size=48)+row(102,2,0)
        self.assertEqual(build_cpu._select(data,7),[101])

    def test_multigroup_and_truncated_data_fall_back(self):
        self.assertEqual(build_cpu._select(row(1,0,1)+row(2,1,0,group=1),3),[])
        for data in (b'', b'\x00'*8, row(1,0,1)[:-1], struct.pack('<II',4,0)):
            self.assertEqual(build_cpu._select(data,255),[])

    def test_switch_off_never_calls_windows(self):
        with patch.dict(os.environ,DEUSEDIX_BUILD_CPU='off'), patch('ctypes.WinDLL',side_effect=AssertionError):
            self.assertEqual(build_cpu.prefer_performance(),[])

    def test_unavailable_windows_api_falls_back(self):
        with patch('ctypes.WinDLL',side_effect=OSError('not available')):
            self.assertEqual(build_cpu.prefer_performance(),[])

    def test_existing_cpu_policy_is_preserved(self):
        class Function:
            def __init__(self, result): self.result=result
            def __call__(self,*args): return self.result
        class Kernel:
            GetCurrentProcess=Function(-1)
            # Insufficient buffer means an assignment already exists. Do not
            # replace it with an application preference.
            GetProcessDefaultCpuSets=Function(False)
            def __getattr__(self,name): raise AssertionError('queried beyond existing policy: '+name)
        with patch('ctypes.WinDLL',return_value=Kernel()):
            self.assertEqual(build_cpu.prefer_performance(),[])

    def test_thread_scope_restores_after_success_and_error(self):
        calls=[]
        with patch.object(build_cpu,'_prefer_thread',return_value=lambda:calls.append('restored')):
            with build_cpu.performance_thread(): calls.append('work')
            with self.assertRaises(RuntimeError):
                with build_cpu.performance_thread(): raise RuntimeError('build cancelled')
        self.assertEqual(calls,['work','restored','restored'])

    def test_thread_scope_with_existing_or_unsupported_policy_runs_normally(self):
        with patch.object(build_cpu,'_prefer_thread',return_value=None):
            @build_cpu.performance_work
            def worker(): return 42
            self.assertEqual(worker(),42)



class BackgroundWork(unittest.TestCase):
    def test_a_background_process_runs_below_normal_and_gets_no_fast_cores(self):
        # the Pieces scan (pieces_library._read_map): its engine processes give way to the person's programs
        import subprocess
        import sys
        proc = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(5)'])
        try:
            with build_cpu.background():
                self.assertEqual(build_cpu.prefer_performance(int(proc._handle)), [])
                self.assertIsNone(build_cpu._prefer_thread())
            if os.name == 'nt':
                import ctypes
                k = ctypes.WinDLL('kernel32')
                k.GetPriorityClass.argtypes = [ctypes.c_void_p]
                self.assertEqual(k.GetPriorityClass(ctypes.c_void_p(int(proc._handle))), 0x4000)
        finally:
            proc.kill()
            proc.wait()

    def test_outside_background_nothing_changes(self):
        with build_cpu.background():
            pass
        self.assertFalse(getattr(build_cpu._local, 'background', False))


if __name__=='__main__': unittest.main()
