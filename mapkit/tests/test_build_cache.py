from pathlib import Path
import concurrent.futures
import os
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import build_cache as cache


class BuildCache(unittest.TestCase):
    def test_nested_scope_and_exception_expire(self):
        with self.assertRaises(RuntimeError):
            with cache.scope():
                self.assertEqual(cache.memo('key',lambda:1),1)
                with cache.scope():self.assertEqual(cache.memo('key',lambda:2),2)
                self.assertEqual(cache.memo('key',lambda:3),1)
                raise RuntimeError()
        self.assertEqual(cache.memo('key',lambda:4),4)

    def test_parallel_builds_do_not_share(self):
        def run(value):
            with cache.scope():return cache.memo('target',lambda:value)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(list(pool.map(run,['original','revision'])),['original','revision'])

    def test_file_change_and_defensive_actor(self):
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/'map.t3d';file.write_text('one')
            calls=[]
            def parse(text):
                calls.append(text)
                yield {'name':'A','props':{'value':text}}
            with cache.scope():
                value=cache.actor(file,'A',parse);value['props']['value']='changed'
                self.assertEqual(cache.actor(file,'A',parse)['props']['value'],'one')
                self.assertEqual(calls,['one'])
                file.write_text('another')
                self.assertEqual(cache.actor(file,'A',parse)['props']['value'],'another')
                self.assertEqual(calls,['one','another'])

    def test_no_scope_keeps_lazy_actor_search(self):
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/'map.t3d';file.write_text('')
            def parse(text):
                yield {'name':'A'}
                raise AssertionError('Unneeded actors parsed')
            self.assertEqual(cache.actor(file,'A',parse),{'name':'A'})

    def test_atomic_replace_with_same_size_and_timestamp(self):
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/'data.json';file.write_text('{"value":1}')
            old=file.stat()
            with cache.scope():
                self.assertEqual(cache.json_file(file),{'value':1})
                replacement=Path(temp)/'replacement';replacement.write_text('{"value":2}')
                os.utime(replacement,ns=(old.st_atime_ns,old.st_mtime_ns))
                replacement.replace(file)
                self.assertEqual(cache.json_file(file),{'value':2})

    def test_actor_parser_and_duplicate_order_are_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/'map.t3d';file.write_text('input')
            def parse(text):
                yield {'name':'A','value':'first'}
                yield {'name':'A','value':'second'}
            def other(text):yield {'name':'A','value':'other parser'}
            with cache.scope():
                self.assertEqual(cache.actor(file,'A',parse)['value'],'first')
                self.assertEqual(cache.actor(file,'A',other)['value'],'other parser')


if __name__=='__main__':unittest.main()
