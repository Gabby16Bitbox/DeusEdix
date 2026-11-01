"""Preview image conversion without starting the SDK or migrating game caches."""
import ast
import io
import json
from pathlib import Path
import re
import tempfile
import types
import unittest
from unittest.mock import patch

from PIL import Image
from texture_cache import TexturePreviews

source = Path(__file__).resolve().parents[1]/'editor/data.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
names = {'_safe', 'export_textures', '_preview_raw', '_preview_bmp'}
namespace = dict(Path=Path, json=json, re=re)
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names],
                        type_ignores=[]), str(source), 'exec'), namespace)
export = namespace['export_textures']


class Conversion(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.textures = self.root/'native/Output/tex'; self.textures.mkdir(parents=True)
        self.session = types.SimpleNamespace(folder=self.root/'native',texture_files={'Game.Sign':'0'})
        self.out = self.root/'map'

    def image(self):
        info = export(self.session, {'Game.Sign':(512,256)}, self.out)
        name = info['Game.Sign']['png']
        return Image.open(self.out/name).convert('RGBA') if name else None

    def raw(self, colour=(20,40,80,200), size=(512,128)):
        (self.textures/'0.raw').write_bytes(json.dumps(dict(width=size[0],height=size[1])).encode()+b'\n'+bytes(colour)*(size[0]*size[1]))

    def test_raw_size_alpha_and_changed_same_size_input(self):
        self.raw(); first=self.image()
        # Pillow's existing premultiplied-alpha resampling rounds green to 39.
        self.assertEqual((first.size,first.getpixel((0,0))), ((256,64),(20,39,80,200)))
        self.raw((80,40,20,0)); second=self.image()
        self.assertEqual(second.getpixel((0,0))[3],0)

    def test_palette_zero_is_transparent_and_other_colours_remain(self):
        im=Image.new('P',(2,1)); im.putpalette([10,20,30,40,50,60]+[0]*762)
        im.putdata([0,1]);im.save(self.textures/'0.bmp')
        first=self.image(); second=self.image()
        self.assertEqual(list(first.getdata()),[(10,20,30,0),(40,50,60,255)])
        self.assertEqual(first.tobytes(),second.tobytes())

    def test_invalid_raw_falls_back_to_bmp_and_recovers_later(self):
        (self.textures/'0.raw').write_bytes(b'{"width": 4, "height": 4}\nshort')
        Image.new('RGB',(2,2),(20,30,40)).save(self.textures/'0.bmp')
        self.assertEqual(self.image().getpixel((0,0)),(20,30,40,255))
        self.raw((10,90,30,255),(4,4))
        self.assertEqual(self.image().getpixel((0,0)),(10,90,30,255))

    def test_missing_export_never_reuses_old_image(self):
        self.raw(); self.assertIsNotNone(self.image())
        (self.textures/'0.raw').unlink()
        self.assertIsNone(self.image())
        self.raw((90,30,40,255),(4,4))
        self.assertEqual(self.image().getpixel((0,0)),(90,30,40,255))

    def test_cache_off_preserves_pixels(self):
        self.raw(); first=self.image()
        with patch.dict('os.environ', DEUSEDIX_TEXTURE_CACHE='off'):
            second=self.image()
        self.assertEqual(first.tobytes(),second.tobytes())


if __name__=='__main__': unittest.main()
