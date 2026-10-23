"""Exercise the real file-serving methods without starting any game/project.

Run directly, or pass --serve-fixture for the isolated real-browser audio test.
"""
import ast
import http.client
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import struct
import sys
import tempfile
import threading
import unittest
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


SOURCE = Path(os.environ.get('DEUSEDIX_TEST_SERVER', Path(__file__).resolve().parents[1] / 'editor/server.py'))


def file_handler(folder):
    tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
    original = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Handler')
    methods = [node for node in original.body if isinstance(node, ast.FunctionDef)
               and node.name in ('_send', '_audio_file', '_file')]
    assert len(methods) == 3, 'Test the real range implementation, not a substitute'
    namespace = dict(json=json, mimetypes=mimetypes, os=os, re=re)
    exec(compile(ast.Module(body=methods, type_ignores=[]), str(SOURCE), 'exec'), namespace)

    class Handler(BaseHTTPRequestHandler):
        _send = namespace['_send']
        _audio_file = namespace['_audio_file']
        _file = namespace['_file']

        def log_message(self, *_args):
            pass

        def do_GET(self):
            name = self.path.split('?', 1)[0].lstrip('/')
            if name not in ('sound.wav', 'empty.wav', 'script.js', 'missing.wav', 'folder'):
                return self._send(404, {'error': 'test route not found'})
            self._file(folder / name, keep='keep=1' in self.path)

    return Handler


class AudioRanges(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='deusedix-audio-range-')
        cls.folder = Path(cls.temp.name)
        cls.payload = bytes(range(256)) * 1024
        (cls.folder / 'sound.wav').write_bytes(cls.payload)
        (cls.folder / 'empty.wav').touch()
        (cls.folder / 'script.js').write_bytes(b'export const ok = true;')
        (cls.folder / 'folder').mkdir()
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), file_handler(cls.folder))
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join()
        cls.temp.cleanup()

    def request(self, path='/sound.wav', **headers):
        client = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            client.request('GET', path, headers=headers)
            response = client.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            client.close()

    def test_full_response_is_seekable(self):
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(body, self.payload)
        self.assertEqual(headers['Accept-Ranges'], 'bytes')
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(int(headers['Content-Length']), len(body))
        self.assertTrue(headers['Content-Type'].startswith('audio/'))

    def test_single_ranges(self):
        size = len(self.payload)
        for value, start, end in [('bytes=0-', 0, size-1), ('bytes=10-100', 10, 100),
                                  ('bytes=65535-131074', 65535, 131074), ('bytes=262140-', size-4, size-1),
                                  ('bytes=5-9999999', 5, size-1), ('bytes=-20', size-20, size-1),
                                  ('bytes=-9999999', 0, size-1)]:
            with self.subTest(value=value):
                status, headers, body = self.request(Range=value)
                self.assertEqual(status, 206)
                self.assertEqual(body, self.payload[start:end+1])
                self.assertEqual(headers['Content-Range'], f'bytes {start}-{end}/{size}')
                self.assertEqual(int(headers['Content-Length']), len(body))

    def test_unsatisfiable_ranges(self):
        for value in ('bytes=262144-', 'bytes=300000-400000', 'bytes=100-99', 'bytes=-0'):
            with self.subTest(value=value):
                status, headers, body = self.request(Range=value)
                self.assertEqual(status, 416)
                self.assertEqual(headers['Content-Range'], 'bytes */262144')
                self.assertEqual(body, b'')

    def test_malformed_or_multiple_ranges_fall_back_to_full_response(self):
        for value in ('bytes=-', 'bytes=nan-100', 'bytes=0-2,5-8', 'items=0-2', 'bytes='+'9'*10000+'-'):
            with self.subTest(value=value[:60]):
                status, headers, body = self.request(Range=value)
                self.assertEqual(status, 200)
                self.assertNotIn('Content-Range', headers)
                self.assertEqual(body, self.payload)

    def test_empty_file(self):
        self.assertEqual(self.request('/empty.wav')[::2], (200, b''))
        status, headers, body = self.request('/empty.wav', Range='bytes=0-')
        self.assertEqual((status, body), (416, b''))
        self.assertEqual(headers['Content-Range'], 'bytes */0')

    def test_cache_validation_and_if_range(self):
        _, headers, _ = self.request('/sound.wav?keep=1')
        tag = headers['ETag']
        self.assertEqual(headers['Cache-Control'], 'no-cache')
        status, _, body = self.request('/sound.wav?keep=1', **{'If-None-Match': tag})
        self.assertEqual((status, body), (304, b''))
        status, _, body = self.request('/sound.wav?keep=1', **{'If-Range': tag, 'Range': 'bytes=10-20'})
        self.assertEqual((status, body), (206, self.payload[10:21]))
        status, _, body = self.request('/sound.wav?keep=1', **{'If-Range': '"old-file"', 'Range': 'bytes=10-20'})
        self.assertEqual((status, body), (200, self.payload))

    def test_non_audio_and_missing_paths_unchanged(self):
        status, headers, body = self.request('/script.js', Range='bytes=2-5')
        self.assertEqual((status, body), (200, b'export const ok = true;'))
        self.assertEqual(headers['Content-Type'], 'text/javascript')
        self.assertNotIn('Accept-Ranges', headers)
        self.assertEqual(self.request('/missing.wav')[0], 404)
        self.assertEqual(self.request('/folder')[0], 404)


def serve_fixture():
    with tempfile.TemporaryDirectory(prefix='deusedix-browser-audio-') as directory:
        folder = Path(directory)
        with wave.open(str(folder / 'sound.wav'), 'wb') as wav:
            rate = 22050
            wav.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(struct.pack('<h', round(math.sin(i*2*math.pi*220/rate)*3500*
                            (.5+.5*math.sin(i/rate*3)))) for i in range(8*rate)))
        server = ThreadingHTTPServer(('127.0.0.1', 0), file_handler(folder))
        print(json.dumps({'port': server.server_port, 'bytes': (folder / 'sound.wav').stat().st_size}), flush=True)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            sys.stdin.readline()  # Parent test sends one line after closing its browser.
        finally:
            server.shutdown()
            server.server_close()
            worker.join()


if __name__ == '__main__':
    if '--serve-fixture' in sys.argv:
        serve_fixture()
    else:
        unittest.main()
