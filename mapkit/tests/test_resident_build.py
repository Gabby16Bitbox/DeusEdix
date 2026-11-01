import io
import json
import os
from pathlib import Path
import queue
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

import kit
import resident_build as rb


class ResidentBuild(unittest.TestCase):
    def test_offer_is_consumed_once_for_multi_map_scripts(self):
        with patch.dict(os.environ,{rb.ENDPOINT:'["private-pipe","secret"]'}), \
             patch.object(kit,'new_run',return_value=Path('private-run')):
            ready=rb.RemoteBuild('test')
            self.assertEqual(ready.endpoint,'["private-pipe","secret"]')
            self.assertNotIn(rb.ENDPOINT,os.environ)

    def test_full_build_only_and_no_external_package_mutation(self):
        self.assertTrue(rb.eligible(['MAP NEW', 'MAP IMPORTADD FILE="..\\T3D\\actors.t3d"',
            'MAP REBUILD', 'BSP REBUILD OPTIMAL BALANCE=15', 'LIGHT APPLY',
            'MAP SAVE FILE="..\\Output\\A.dx"', 'MAP LOAD FILE="..\\Output\\A.dx"', 'UC_PREVIEW']))
        for commands in ([], ['MAP LOAD FILE="..\\Input\\A.dx"'], ['MAP NEW', 'MAP NEW'],
                         ['MAP NEW', 'UC_ANIMNEW something'], ['MAP NEW', 'UC_OBJPROP External.X Texture nope'],
                         ['MAP NEW', 'TEXTURE IMPORT FILE="a.pcx" PACKAGE=External'],
                         ['MAP NEW', 'MAP LOAD FILE="..\\Input\\A.dx"'],
                         ['MAP NEW', 'MAP REBUILD\nUC_QUIT']):
            self.assertFalse(rb.eligible(commands), commands)

    def test_unknown_host_or_opt_out_is_not_pooled(self):
        with tempfile.TemporaryDirectory() as tmp:
            host=Path(tmp)/'host.exe';host.write_bytes(b'old')
            with patch.object(kit, 'HOST', host):self.assertFalse(rb.supported())
            host.write_bytes(b'--build-worker\0')
            with patch.object(kit, 'HOST', host):self.assertFalse(rb.supported())
            with patch.dict(os.environ, DEUSEDIX_BUILD_RESIDENT='off'):self.assertFalse(rb.supported())

    def test_fingerprint_tracks_audio_packages_and_atomic_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);sound=root/'Sound.uax';sound.write_bytes(b'one')
            with patch.object(kit, 'DEV', root), patch.object(kit, 'PROJECT', root), \
                 patch.object(kit, '_ini', return_value='Paths='+str(root/'*.uax')), \
                 patch.object(kit, 'extra_packages', return_value=[]), \
                 patch.object(kit, 'host_files', return_value=[]), patch.object(kit, 'native_files', return_value=[]):
                before=rb.fingerprint({}, ['MAP NEW'])
                stamp=sound.stat().st_mtime_ns
                replacement=root/'replacement';replacement.write_bytes(b'two')
                os.utime(replacement,ns=(stamp,stamp));replacement.replace(sound)
                self.assertNotEqual(before,rb.fingerprint({}, ['MAP NEW']))
                self.assertNotEqual(rb.fingerprint({}, []),rb.fingerprint({'DEUSEDIX_LIGHT_BUILD':'off'}, []))

    @unittest.skipUnless(os.name=='nt','Windows file lease')
    def test_active_run_is_protected_from_pruning(self):
        import msvcrt
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);active=root/'0';old=root/'1';active.mkdir();old.mkdir();(root/'2').mkdir()
            with (active/'.resident.lock').open('w+b') as lease:
                lease.write(b'1');lease.flush();lease.seek(0)
                msvcrt.locking(lease.fileno(),msvcrt.LK_NBLCK,1)
                self.assertTrue(rb.run_in_use(active))
                with patch.object(kit, 'RUNS', root):kit.prune(keep=1)
                self.assertTrue(active.exists());self.assertFalse(old.exists())
            self.assertFalse(rb.run_in_use(active))

    def test_cancellation_and_script_death_abort_collection(self):
        for cancelled,ended in ((True,False),(False,True)):
            pool=rb.Pool();pool.lines=queue.Queue()
            worker=Mock();worker.poll.return_value=0 if ended else None
            with self.assertRaises(kit.Stopped):
                pool._collect(b'done',io.BytesIO(),time.monotonic()+1,worker,Mock(stopped=cancelled))

    def test_timeout_does_not_wait_for_another_native_reply(self):
        pool=rb.Pool();pool.lines=queue.Queue();worker=Mock();worker.poll.return_value=None
        with self.assertRaises(TimeoutError):pool._collect(b'done',io.BytesIO(),0,worker,None)

    def test_eof_is_failure_not_success(self):
        pool=rb.Pool();pool.lines=queue.Queue();pool.lines.put(None)
        worker=Mock();worker.poll.return_value=None
        with self.assertRaises(RuntimeError):pool._collect(b'done',io.BytesIO(),time.monotonic()+1,worker,None)

    def test_batch_token_prevents_accepting_an_old_completion(self):
        pool=rb.Pool();pool.lines=queue.Queue()
        for line in (b'UCMapKit|batch-end|old\n', b'UCMapKit|done\n', b'UCMapKit|batch-end|new\n'):pool.lines.put(line)
        stream=io.BytesIO();worker=Mock();worker.poll.return_value=None
        pool._collect(b'UCMapKit|batch-end|new',stream,time.monotonic()+1,worker,None)
        self.assertEqual(len(stream.getvalue().splitlines()),3)

    def test_retire_closes_only_owned_process_and_lease(self):
        pool=rb.Pool();process=Mock();process.poll.return_value=0
        pool.process=process;pool.lease=Mock();lease=pool.lease
        pool.close();pool.close()
        process.stdin.close.assert_called_once();process.kill.assert_not_called()
        lease.close.assert_called_once();self.assertIsNone(pool.process)

    def test_missing_dependency_retires_an_existing_worker(self):
        pool=rb.Pool();process=Mock();process.poll.return_value=0;pool.process=process
        with patch.object(rb,'fingerprint',side_effect=OSError('package removed')):
            with self.assertRaises(OSError):pool.run(Path('.'),Path('batch'),[],{},Mock(),None,1)
        self.assertIsNone(pool.process);process.stdin.close.assert_called_once()

    def test_low_memory_retires_after_success_and_cancel_race_retires(self):
        for cancel in (False,True):
            with self.subTest(cancel=cancel), tempfile.TemporaryDirectory() as temp:
                folder=Path(temp);batch=folder/'commands.txt';batch.write_text('MAP NEW\n')
                pool=rb.Pool();process=Mock();process.poll.return_value=None
                worker=Mock();worker.poll.return_value=None
                watch=Mock(stopped=False,note=folder/'note') if cancel else None
                if watch:watch.started.side_effect=[None,kit.Stopped('cancel at completion')]
                def start(*args):pool.process=process
                def collect(marker,stream,*args):
                    if b'batch-end' in marker:stream.write(b'UCMapKit|complete|0 ms\nUCMapKit|done\n')
                with patch.object(pool,'_start',side_effect=start), patch.object(pool,'_collect',side_effect=collect), \
                     patch.object(rb,'fingerprint',return_value='key'),patch.object(rb,'private_bytes',return_value=1), \
                     patch.object(rb,'memory_available',return_value=10*1024**3 if cancel else 0):
                    if cancel:
                        with self.assertRaises(kit.Stopped):pool.run(folder,batch,['MAP NEW'],{},worker,watch,1)
                    else:self.assertGreaterEqual(pool.run(folder,batch,['MAP NEW'],{},worker,watch,1),0)
                self.assertIsNone(pool.process)


if __name__=='__main__':unittest.main()
