"""Image reuse preserves actual pixels, transparency, changes and failed exports."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
import texture_cache as cache
import texgen


class Generated(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root/'texture.pcx'
        self.calls = 0

    def make(self, path):
        self.calls += 1
        Path(path).write_bytes(b'generated pixels')

    def test_reuses_exact_recipe_and_verifies_output(self):
        cache.generated(self.path, {'colour':[1,2,3]}, self.make)
        before = self.path.stat().st_mtime_ns
        cache.generated(self.path, {'colour':[1,2,3]}, self.make)
        self.assertEqual(self.calls, 1)
        self.assertEqual(before, self.path.stat().st_mtime_ns)
        self.path.write_bytes(b'corrupted pixels')
        cache.generated(self.path, {'colour':[1,2,3]}, self.make)
        self.assertEqual(self.calls, 2)
        self.assertEqual(self.path.read_bytes(), b'generated pixels')

    def test_changed_input_and_bad_receipt_are_misses(self):
        cache.generated(self.path, {'seed':1}, self.make)
        cache.generated(self.path, {'seed':2}, self.make)
        self.path.with_suffix('.pcx.cache.json').write_text('[]')
        cache.generated(self.path, {'seed':2}, self.make)
        self.assertEqual(self.calls, 3)

    def test_error_keeps_previous_image(self):
        cache.generated(self.path, 'old', self.make)
        def fail(path):
            path.write_bytes(b'partial')
            raise RuntimeError('encoder failed')
        with self.assertRaises(RuntimeError):
            cache.generated(self.path, 'new', fail)
        self.assertEqual(self.path.read_bytes(), b'generated pixels')
        self.assertFalse(list(self.root.glob('.*.pcx')))

    def test_disabled_cache_and_unsupported_recipe(self):
        with patch.dict(os.environ, DEUSEDIX_TEXTURE_CACHE='off'):
            for _ in range(2): cache.generated(self.path, 'same', self.make)
        cache.generated(self.path, object(), self.make)
        self.assertEqual(self.calls, 3)

    def test_replacement_preserves_other_hardlink(self):
        self.path.write_bytes(b'linked pixels')
        other = self.root/'original.pcx'
        os.link(self.path, other)
        cache.generated(self.path, 'new', self.make)
        self.assertEqual(other.read_bytes(), b'linked pixels')

    def test_encoder_and_algorithm_changes_invalidate(self):
        encoder = self.root/'ffmpeg.exe'; encoder.write_bytes(b'fake encoder')
        with patch.object(texgen, 'OUT', self.root), patch.object(texgen, 'FF', str(encoder)), \
                patch.object(texgen.Img, 'save_pcx', lambda image,path,**kw:self.make(path)):
            texgen.solid('solid', (1,2,3))
            texgen.solid('solid', (1,2,3))
            self.assertEqual(self.calls, 1)
            encoder.write_bytes(b'new encoder binary')
            texgen.solid('solid', (1,2,3))
            self.assertEqual(self.calls, 2)
            texgen.solid('solid', (1,2,4))
            self.assertEqual(self.calls, 3)
            with patch.object(texgen, 'WARM', [(1,2,3)]):
                texgen.solid('solid', (1,2,4))
            self.assertEqual(self.calls, 4)

    def test_unseeded_generator_is_never_cached(self):
        with patch.object(texgen, 'OUT', self.root), \
                patch.object(texgen.Img, 'save_pcx', lambda image,path,**kw:self.make(path)):
            texgen.clouds('random', w=4, h=4, seed=None)
            texgen.clouds('random', w=4, h=4, seed=None)
        self.assertEqual(self.calls, 2)


class Preview(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.calls = 0

    def make(self, source, destination):
        self.calls += 1
        Image.new('RGBA',(2,3),tuple(source)).save(destination)
        return True

    def convert(self, source=b'\x01\x02\x03\xff', kind='raw', texture='Pkg.Name'):
        c = cache.TexturePreviews(self.root/'cache')
        ok = c.convert(texture,kind,source,self.root/'out.png',self.make)
        c.finish()
        self.assertTrue(ok)

    def test_warm_hit_and_changed_content_not_dates(self):
        self.convert(); self.convert()
        self.assertEqual(self.calls,1)
        self.convert(b'\x03\x02\x01\xff')
        self.assertEqual(self.calls,2)
        self.assertEqual(Image.open(self.root/'out.png').getpixel((0,0)),(3,2,1,255))

    def test_kind_and_version_invalidate(self):
        self.convert(); self.convert(kind='bmp')
        with patch.object(cache.TexturePreviews,'VERSION',99): self.convert(kind='bmp')
        self.assertEqual(self.calls,3)

    def test_corrupt_png_reconverts(self):
        self.convert()
        for p in (self.root/'cache').glob('*.png'): p.write_bytes(b'corrupt')
        self.convert()
        self.assertEqual(self.calls,2)

    def test_missing_failed_texture_is_not_cached(self):
        c = cache.TexturePreviews(self.root/'cache')
        self.assertFalse(c.convert('missing','raw',b'',self.root/'out.png',lambda *_:False))
        c.finish()
        self.assertEqual(json.loads((self.root/'cache/index.json').read_text()),{})

    def test_removed_textures_do_not_accumulate(self):
        self.convert(texture='old')
        self.convert(texture='new')
        self.assertEqual(len(list((self.root/'cache').glob('*.png'))),1)
        self.assertEqual(list(json.loads((self.root/'cache/index.json').read_text())),['new'])

    def test_cache_write_failure_does_not_block_image(self):
        with patch.object(cache, '_write', side_effect=OSError('read only')):
            self.convert()
        self.assertTrue((self.root/'out.png').is_file())


if __name__ == '__main__': unittest.main()
