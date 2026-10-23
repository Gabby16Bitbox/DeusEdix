"""Editable layers round-trip locally; game textures remain flattened paletted PCX."""
import base64
import copy
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
from editor import textures


def png(size=(16, 8), color=(180, 40, 20, 255)):
    stream = io.BytesIO()
    Image.new('RGBA', size, color).save(stream, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode('ascii')


def document(size=(16, 8)):
    return dict(format='deusedix-texture-project', version=1, width=size[0], height=size[1],
                activeLayerId='paint', layers=[
                    dict(id='original', name='Original', visible=True, locked=True, opacity=1,
                         blendMode='source-over', png=png(size)),
                    dict(id='paint', name='Grime', visible=False, locked=False, opacity=.35,
                         blendMode='multiply', png=png(size, (20, 80, 30, 100)))])


class TextureProjects(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='.texture-project-', dir=Path(__file__).parent)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.library = self.root / '_library'
        for key, value in [('ROOT', self.root), ('LIBRARY', self.library), ('FULL', self.root / '_full')]:
            context = patch.object(textures, key, value)
            context.start()
            self.addCleanup(context.stop)

    def test_library_preserves_layer_pixels_and_settings_without_inflating_listing(self):
        doc = document()
        original = copy.deepcopy(doc)
        name = textures.library_save('Crate grime', png(), doc)
        self.assertEqual(doc, original)
        self.assertEqual(name, 'Crate_grime')
        restored = textures.library_project(name)['document']
        self.assertEqual(restored, doc)
        listed = textures.library()[0]
        self.assertTrue(listed['editable'])
        self.assertEqual(listed['documentUrl'], '/api/texture_project?name=Crate_grime')
        self.assertNotIn('layers', listed)

    def test_map_source_returns_layers_but_game_import_is_flat_and_masked(self):
        size = (24, 13)
        doc = document(size)
        info = textures.import_png('Room01', png(size, (0, 50, 20, 0)), 'DeusEx.Crate', document=doc)
        self.assertEqual((info['w'], info['h']), (32, 16))
        self.assertTrue(info['masked'])
        with Image.open(self.root / info['pcx']) as game:
            self.assertEqual(game.mode, 'P')
            self.assertEqual(game.getpixel((0, 0)), 0)
        restored = textures.source(info['name'], 'Room01')
        self.assertEqual(restored['document'], doc)
        self.assertEqual((restored['w'], restored['h']), (32, 16))

    def test_high_resolution_project_keeps_editable_pixels_while_game_caps_at_1024(self):
        size = (2048, 1)
        info = textures.import_png('Room01', png(size), document=document(size))
        self.assertEqual((info['w'], info['h']), (1024, 8))
        restored = textures.source(info['name'], 'Room01')['document']
        self.assertEqual((restored['width'], restored['height']), size)

    def test_legacy_save_replaces_old_layers_and_delete_removes_both_files(self):
        textures.library_save('Crate', png(), document())
        textures.library_save('Crate', png(color=(1, 2, 3, 255)))
        self.assertIsNone(textures.library_project('Crate')['document'])
        self.assertFalse(textures.library()[0]['editable'])
        textures.library_save('Crate', png(), document())
        textures.library_delete('Crate')
        self.assertEqual(list(self.library.iterdir()), [])

    def test_invalid_documents_never_replace_existing_texture_or_layers(self):
        textures.library_save('Crate', png(), document())
        before = {p.name: p.read_bytes() for p in self.library.iterdir()}
        changes = [lambda d: d.update(width=17), lambda d: d.update(version=True),
                   lambda d: d.update(activeLayerId='missing'), lambda d: d.update(layers=[]),
                   lambda d: d['layers'][0].update(id='removed-original'),
                   lambda d: d['layers'][1].update(id='original'),
                   lambda d: d['layers'][1].update(opacity=float('nan')),
                   lambda d: d['layers'][1].update(opacity=-1),
                   lambda d: d['layers'][1].update(visible='yes'),
                   lambda d: d['layers'][1].update(locked=1),
                   lambda d: d['layers'][1].update(blendMode='invalid'),
                   lambda d: d['layers'][1].update(name='bad\nname'),
                   lambda d: d['layers'][1].update(png=png((8, 8))),
                   lambda d: d['layers'][1].update(png='data:image/png;base64,broken!')]
        for change in changes:
            doc = document()
            change(doc)
            with self.subTest(document=repr(doc)[:100]):
                with self.assertRaises(ValueError):
                    textures.library_save('Crate', png(), doc)
                self.assertEqual({p.name: p.read_bytes() for p in self.library.iterdir()}, before)

    def test_invalid_png_and_paths_do_not_create_map_assets(self):
        for raw in ['data:text/html;base64,PCFET0NUWVBFPg==', 'data:image/png;base64,bm90IHBuZw==', 'bad']:
            with self.assertRaises(ValueError):
                textures.import_png('Room01', raw)
        for name in ['../Room01', 'C:\\escape', '.', '', 'CON', None]:
            with self.assertRaises(ValueError):
                textures.import_png(name, png())
            with self.assertRaises(ValueError):
                textures.library_project(name)
            with self.assertRaises(ValueError):
                textures.library_delete(name)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_limits_are_checked_before_decoding_layers(self):
        oversized = document((2048, 2048))
        oversized['layers'] = [dict(oversized['layers'][0], id='layer%d' % i) for i in range(9)]
        oversized['layers'][0]['id'] = 'original'
        with self.assertRaisesRegex(ValueError, 'memory limit'):
            textures.validate_document(oversized)
        too_many = document()
        too_many['layers'] = too_many['layers'] * 17
        with self.assertRaisesRegex(ValueError, '32 layers'):
            textures.validate_document(too_many)
        with self.assertRaisesRegex(ValueError, '2048'):
            textures.library_save('Huge', png((2049, 1)))

    def test_invalid_sidecar_falls_back_to_flat_image(self):
        textures.library_save('Crate', png(), document())
        (self.library / 'Crate.texture.json').write_text('{not JSON', encoding='utf-8')
        self.assertIsNone(textures.library_project('Crate')['document'])
        self.assertEqual(textures.library()[0]['name'], 'Crate')

    def test_import_does_not_overwrite_orphaned_texture_files(self):
        first = textures.import_png('Room01', png())
        second = textures.import_png('Room01', png(color=(0, 0, 0, 255)))
        self.assertNotEqual(first['name'], second['name'])
        self.assertTrue((self.root / first['png']).exists())

    def test_io_failure_rolls_back_saved_flat_texture_and_layers(self):
        textures.library_save('Crate', png(), document())
        before = {p.name: p.read_bytes() for p in self.library.iterdir()}
        original_replace = os.replace
        calls = 0

        def fail_second(source, destination):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('Simulated unavailable sidecar destination')
            return original_replace(source, destination)

        with patch.object(textures.os, 'replace', side_effect=fail_second):
            with self.assertRaises(OSError):
                textures.library_save('Crate', png(color=(0, 0, 0, 255)), document())
        self.assertEqual({p.name: p.read_bytes() for p in self.library.iterdir()}, before)


if __name__ == '__main__':
    unittest.main()
