"""Geometry compute equivalence and failover; real GPU tests skip without hardware."""
from array import array
from pathlib import Path
import math
import sys
import unittest
from unittest import mock

KIT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(KIT),str(KIT/'editor')]
import geometry_compute as compute


class GeometryCompute(unittest.TestCase):
    def fixture(self):
        # Oblique mapping with negative pan and no baked lightmap.
        return [('T',0,[1,2,3,0.5,0.25,0,0,-0.5,0.5,-2,1,64,128],
                 [1,2,3,65,2,3,1,66,3],0)]

    def test_small_auto_keeps_original_path(self):
        with mock.patch.object(compute,'_load',side_effect=AssertionError('Must not initialize a GPU')):
            self.assertIsNone(compute.prepare(self.fixture(),None,[],'auto'))

    def test_optional_library_missing(self):
        with mock.patch.object(compute,'_load',return_value=None):
            self.assertIsNone(compute.prepare(self.fixture(),None,[],'gpu'))

    def test_real_gpu_matches_native_cpu_at_output_precision(self):
        if not compute.status()['available']:
            self.skipTest('No compatible DirectCompute double-precision adapter')
        lm={'size':[256,128],'surfs':{'1':[10,20,8,4,-2,1,4,-2]}}
        cpu,_=compute.prepare(self.fixture(),lm,[1],'cpu')
        gpu,_=compute.prepare(self.fixture(),lm,[1],'gpu')
        self.assertEqual(compute.last_run()['backend'],'gpu')
        self.assertTrue(compute._rounded_equal(cpu,gpu))

    def test_failed_gpu_uses_cpu(self):
        fake=object()
        with mock.patch.object(compute,'_load',return_value=fake), mock.patch.object(compute,'_call',
                side_effect=lambda lib,v,p,gpu: (None,0.1) if gpu else (array('d',[1,2,3,4]),0.01)):
            params=array('d',[1]*24)
            self.assertEqual(compute.packed(array('d',[0,0,0,0]),params,'gpu'),array('d',[1,2,3,4]))
            self.assertEqual(compute.last_run()['backend'],'cpu')

    def test_auto_refuses_inconsistent_gpu_result(self):
        count=compute.MIN_GPU_VERTICES
        bad=array('d',[2,2,3,4])*count
        good=array('d',[1,2,3,4])*count
        with mock.patch.object(compute,'_choices',{}),mock.patch.object(compute,'_load',return_value=object()),\
             mock.patch.object(compute,'_call',side_effect=lambda lib,v,p,gpu:(bad,0.001) if gpu else (good,0.1)):
            result=compute.packed(array('d',[0,0,0,0])*count,array('d',[1]*24),'auto')
            self.assertIs(result,good)
            self.assertFalse(compute.last_run()['matched'])
            self.assertEqual(compute.last_run()['backend'],'cpu')

    def test_invalid_index_refused(self):
        lib=compute._load()
        if lib is None:self.skipTest('Native helper unavailable')
        for index in (-1,.25,1,math.nan):
            value,_=compute._call(lib,array('d',[0,0,0,index]),array('d',[1]*24),False)
            self.assertIsNone(value)


if __name__=='__main__':unittest.main()
