import ast
from pathlib import Path
import re
import unittest

tree = ast.parse((Path(__file__).resolve().parents[1] / 'live.py').read_text(encoding='utf-8'))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == '_preview_display_ini')
scope = {'re': re}
exec(compile(ast.Module(body=[function], type_ignores=[]), 'live.py', 'exec'), scope)
convert = scope['_preview_display_ini']

class PreviewDisplayTests(unittest.TestCase):
    def setUp(self):
        self.original = ('[Engine.Engine]\r\nGameRenderDevice=D3DDrv.D3DRenderDevice\r\n'
                         'WindowedRenderDevice=SoftDrv.SoftwareRenderDevice\r\nAudioDevice=Galaxy.GalaxyAudioSubsystem\r\n'
                         '[Other.Section]\r\nGameRenderDevice=DoNotChange\r\nMouseSensitivity=3.000000\r\n')
    def test_embedded_legacy_d3d_uses_d3d9_in_preview_only(self):
        value = convert(self.original, 'embedded')
        self.assertIn('GameRenderDevice=D3D9Drv.D3D9RenderDevice\r\n', value)
        self.assertIn('WindowedRenderDevice=D3D9Drv.D3D9RenderDevice\r\n', value)
        self.assertIn('[Other.Section]\r\nGameRenderDevice=DoNotChange\r\nMouseSensitivity=3.000000\r\n', value)
        self.assertEqual(value.count('\r\n'), self.original.count('\r\n'))
    def test_external_play_is_byte_for_byte_unchanged(self):
        self.assertEqual(convert(self.original, 'external'), self.original)
    def test_modern_or_custom_renderer_is_not_replaced(self):
        for device in ('D3D9Drv.D3D9RenderDevice', 'D3D10Drv.D3D10RenderDevice', 'SoftDrv.SoftwareRenderDevice', 'OpenGLDrv.OpenGLRenderDevice'):
            text = self.original.replace('D3DDrv.D3DRenderDevice', device)
            self.assertEqual(convert(text, 'embedded'), text)
    def test_wrong_section_and_invalid_mode_are_not_silently_changed(self):
        text = self.original.replace('[Engine.Engine]', '[Something.Else]')
        self.assertEqual(convert(text, 'embedded'), text)
        with self.assertRaises(ValueError):
            convert(self.original, 'anything')

if __name__ == '__main__': unittest.main()
