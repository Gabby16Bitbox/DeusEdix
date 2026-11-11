"""File > Main menu... (editor/main_menu.py): what is kept, the class the game reads, the picture, the launch's ini."""
import base64
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import main_menu
import project_game
import settings


def png(w, h, colour=(200, 40, 40, 255)):
    from PIL import Image
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    im.paste(Image.new('RGBA', (w // 2, h // 2), colour), (w // 4, h // 4))
    out = io.BytesIO()
    im.save(out, format='PNG')
    return out.getvalue()


class ValidateTests(unittest.TestCase):
    def test_defaults_and_unknown_fields(self):
        self.assertEqual(main_menu.validate({}), main_menu.DEFAULT)
        self.assertIsNot(main_menu.validate({})['buttons'], main_menu.DEFAULT['buttons'])
        for bad in ([], None, {'hack': 1}, {'enabled': 1}, {'x': 2}, {'x': True}, {'buttonWidth': 10},
                    {'titleColor': 'red'}, {'titleFont': 'Arial'}, {'align': 'top'}, {'camera': 'orbit'},
                    {'menuMap': 'a b'}, {'menuMap': '..\\x'}, {'title': 'a\nb'}, {'title': 'x' * 81},
                    {'buttons': [{}] * 13}, {'buttons': [{'label': 'A', 'action': 'fly'}]},
                    {'buttons': [{'label': '', 'action': 'new'}]}, {'buttons': [{'label': 'A', 'action': 'new', 'x': 1}]}):
            with self.subTest(bad=bad), self.assertRaises((ValueError, TypeError)):
                main_menu.validate(bad)

    def test_text_safe_for_the_class(self):
        m = main_menu.validate({'title': ' My "Game" \\ ', 'footer': 'v1\\',
                                'buttons': [{'label': 'Go "now"', 'action': 'map', 'map': 'Lab_1'},
                                            {'label': 'New', 'action': 'new', 'map': 'Ignored'}]})
        self.assertEqual(m['title'], "My 'Game' /")
        self.assertEqual(m['footer'], 'v1/')
        self.assertEqual(m['buttons'][0], dict(label="Go 'now'", action='map', shows='always', map='Lab_1'))
        self.assertEqual(m['buttons'][1]['map'], '')          # only a "map" button keeps its map
        self.assertEqual(main_menu.validate({'titleColor': '#AbCdEf'})['titleColor'], '#abcdef')

    def test_problems(self):
        on = main_menu.validate({'enabled': True})
        self.assertEqual(main_menu.problems(main_menu.validate({}), []), [])          # off: nothing to say
        self.assertEqual(len(main_menu.problems(on, ['A'])), 2)                       # no maps chosen
        ready = dict(on, menuMap='A', startMap='B')
        self.assertEqual(main_menu.problems(ready, ['A', 'B']), [])
        self.assertTrue(any('not installed' in p for p in main_menu.problems(ready, ['A'])))
        no_new = dict(ready, buttons=[b for b in ready['buttons'] if b['action'] != 'new'])
        self.assertIn('No button starts a new game.', main_menu.problems(no_new, ['A', 'B']))
        far = dict(ready, buttons=ready['buttons'] + [dict(label='X', action='map', shows='menu', map='C')])
        self.assertTrue(any('"X"' in p for p in main_menu.problems(far, ['A', 'B'])))


class ClassTextTests(unittest.TestCase):
    def test_every_field_and_button(self):
        m = main_menu.validate({'enabled': True, 'menuMap': 'Menu', 'startMap': 'Lab', 'camera': 'sway',
                                'titleFont': 'bold', 'titleColor': '#ff8000', 'align': 'right', 'look': 'text',
                                'x': 0.1, 'y': 0.5, 'buttonWidth': 300, 'title': 'T', 'footer': 'F'})
        text = main_menu.class_text(m)
        self.assertIn('class UCMenuLook extends Object', text)
        self.assertNotIn('#exec', text)
        for line in ('bEnabled=True', 'MenuMap="Menu"', 'StartMap="Lab"', 'CameraMove=1', 'TitleFont=4',
                     'TitleColor=(R=255,G=128,B=0)', 'bLogo=False', 'Align=2', 'PosX=0.100', 'PosY=0.500',
                     'ButtonLook=1', 'ButtonWidth=300', 'Title="T"', 'Footer="F"',
                     'NumButtons=%d' % len(m['buttons']), 'Labels(0)="New Game"', 'Actions(0)=0', 'Shows(1)=2',
                     'Actions(%d)=6' % (len(m['buttons']) - 1)):
            self.assertIn('     %s\n' % line, text)
        with_logo = main_menu.class_text(m, (300, 120))
        self.assertIn('#exec TEXTURE IMPORT NAME=UCMenuLogo FILE=Textures\\Menu\\UCMenuLogo.pcx', with_logo)
        self.assertIn('bLogo=True', with_logo)
        self.assertIn('LogoW=300', with_logo)
        self.assertIn('LogoH=120', with_logo)

    def test_matches_the_templates_fields(self):
        """The generated class declares what the template's seed does (UCMainMenu reads them all)."""
        import re
        seed = (KIT / 'project-template' / 'src' / 'DeusEdix' / 'Classes' / 'UCMenuLook.uc').read_text(encoding='latin1')
        names = lambda t: sorted(n for decl in re.findall(r'(?m)^var\s+\w+\s+([^;]+);', t)
                                 for n in re.split(r'\s*,\s*', decl.strip()))
        self.assertEqual(names(main_menu.class_text(main_menu.validate({}))), names(seed))

    def test_a_new_game_forgets_the_last_one(self):
        """Every new game the menu starts clears the flags first (chain test, 6 Nov 2026: in the original game the
        counters of the game played before came along, its StartNewGame clears only the yes/no states and the menu
        skips the intro that clears the rest): the character screen before its own settings, New Game without it, a
        button that starts a map. In both games' classes."""
        import re
        classes = KIT / 'project-template' / 'src' / 'DeusEdix' / 'Classes'
        for folder in (classes, KIT / 'project-template' / 'vanilla' / 'Classes'):
            text = (folder / 'UCNewGame.uc').read_text(encoding='latin1')
            self.assertIn('p.FlagBase.DeleteAllFlags();', text)
            start = text[text.index('actionKey == "START"'):]
            self.assertLess(start.index('ForgetLastGame(player);'), start.index('SaveSettings();'))
            self.assertLess(start.index('SaveSettings();'), start.index('StartNewGame('))
        menu = (classes / 'UCMainMenu.uc').read_text(encoding='latin1')
        go = menu[menu.index('function Go()'):menu.index('event bool BoxOptionSelected')]
        starts = [m.start() for m in re.finditer(r'StartNewGame\(', go)]
        self.assertEqual(len(starts), 2)
        for at in starts:
            self.assertIn("class'UCNewGame'.static.ForgetLastGame(p);", go[max(0, at - 160):at])


class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / 'maps').mkdir()
        for name in ('Menu', 'Lab'):
            (root / 'maps' / (name + '.dx')).write_bytes(b'x')
        self.root = root
        for p in (patch.object(settings, 'PROJECT', root), patch.object(settings, 'PACKAGE', 'DXP_Test'),
                  patch.object(settings, 'MANAGED_PROJECT', True, create=True),
                  patch.object(settings, 'PROJECT_KIND', 'custom', create=True)):
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        self.tmp.cleanup()

    def test_save_class_and_picture(self):
        snap = main_menu.snapshot()
        self.assertTrue(snap['available'])
        self.assertEqual(snap['maps'], ['Lab', 'Menu'])
        self.assertFalse(snap['menu']['enabled'])
        menu = dict(snap['menu'], enabled=True, menuMap='Menu', startMap='Lab')
        url = 'data:image/png;base64,' + base64.b64encode(png(700, 200)).decode()
        out = main_menu.save(menu, snap['revision'], url)
        self.assertEqual(out['problems'], [])
        self.assertTrue(out['hasLogo'] and out['menu']['logo'])
        self.assertNotEqual(out['revision'], snap['revision'])
        cls = (self.root / 'src' / 'DXP_Test' / 'Classes' / 'UCMenuLook.uc').read_text(encoding='latin1')
        self.assertIn('LogoW=512', cls)                         # 700 x 200 fitted to 512 on its longer side
        self.assertIn('LogoH=146', cls)
        from PIL import Image
        pcx = Image.open(self.root / 'src' / 'DXP_Test' / 'Textures' / 'Menu' / 'UCMenuLogo.pcx')
        self.assertEqual((pcx.mode, pcx.size), ('P', (512, 256)))       # power of two, the rest see-through
        self.assertEqual(pcx.getpixel((0, 0)), 0)
        self.assertNotEqual(pcx.getpixel((256, 73)), 0)
        self.assertEqual(main_menu.logo_png()[:8], b'\x89PNG\r\n\x1a\n')
        # another window's save in between is never overwritten
        with self.assertRaises(ValueError):
            main_menu.save(menu, snap['revision'])
        # the picture removed: no texture, no #exec
        out = main_menu.save(out['menu'], out['revision'], '')
        self.assertFalse(out['hasLogo'])
        self.assertFalse((self.root / 'src' / 'DXP_Test' / 'Textures' / 'Menu' / 'UCMenuLogo.pcx').exists())
        self.assertNotIn('#exec', (self.root / 'src' / 'DXP_Test' / 'Classes' / 'UCMenuLook.uc').read_text())
        self.assertFalse(main_menu.write_runtime())             # nothing changed: the build is not redone

    def test_bad_pictures(self):
        snap = main_menu.snapshot()
        for bad in ('http://x/y.png', 'data:text/plain;base64,aGk=', 'data:image/png;base64,' + base64.b64encode(b'no').decode()):
            with self.subTest(bad=bad[:20]), self.assertRaises(ValueError):
                main_menu.save(snap['menu'], snap['revision'], bad)
        self.assertFalse((self.root / main_menu.FILE_NAME).exists())

    def test_only_own_campaigns(self):
        with patch.object(settings, 'PROJECT_KIND', 'original'):
            self.assertFalse(main_menu.snapshot()['available'])
            with self.assertRaises(ValueError):
                main_menu.save({}, main_menu.snapshot()['revision'])

    def test_a_broken_saved_file_is_kept(self):
        (self.root / main_menu.FILE_NAME).write_text('{"enabled": "yes"}')
        with self.assertRaises(ValueError):
            main_menu.snapshot()
        self.assertEqual((self.root / main_menu.FILE_NAME).read_text(), '{"enabled": "yes"}')


class IniTests(unittest.TestCase):
    INI = ('[URL]\r\nProtocol=deusex\r\nLocalMap=DX.dx\r\nPort=7790\r\n\r\n[Engine.Engine]\r\n'
           'GameRenderDevice=D3D9Drv.D3D9RenderDevice\r\nRoot=DeusEx.DeusExRootWindow\r\nConsole=Engine.Console\r\n')

    def test_root_and_start_map(self):
        out = main_menu.apply_ini(self.INI, 'Menu', 'DXP_Test')
        self.assertIn('\r\nRoot=DXP_Test.UCMenuRoot\r\n', out)
        self.assertIn('\r\nLocalMap=Menu.dx\r\n', out)
        self.assertNotIn('DeusExRootWindow', out)
        self.assertNotIn('DX.dx', out)
        self.assertEqual(out.count('\r\n'), self.INI.count('\r\n'))   # nothing else added or removed
        self.assertNotIn('\r\r', out)
        self.assertEqual(out.replace('DXP_Test.UCMenuRoot', 'DeusEx.DeusExRootWindow').replace('Menu.dx', 'DX.dx'), self.INI)

    def test_missing_lines_and_sections(self):
        out = project_game.menu_ini('[URL]\r\nPort=7790\r\n[Engine.Engine]\r\nConsole=Engine.Console\r\n', 'P.UCMenuRoot', 'M')
        self.assertIn('[URL]\r\nLocalMap=M.dx\r\nPort=7790', out)
        self.assertIn('[Engine.Engine]\r\nRoot=P.UCMenuRoot\r\nConsole', out)
        out = project_game.menu_ini('[Core.System]\r\nPurgeCacheDays=30', 'P.UCMenuRoot', 'M')
        self.assertTrue(out.startswith('[Core.System]\r\nPurgeCacheDays=30\r\n'))
        self.assertIn('[Engine.Engine]\r\nRoot=P.UCMenuRoot\r\n', out)
        self.assertIn('[URL]\r\nLocalMap=M.dx\r\n', out)
        # a key only alike, in another section, is left alone
        out = project_game.menu_ini('[Other]\r\nRoot=Keep\r\n[Engine.Engine]\r\nRootX=1\r\n', 'P.R', '')
        self.assertIn('[Other]\r\nRoot=Keep\r\n', out)
        self.assertIn('Root=P.R\r\nRootX=1', out)
        self.assertNotIn('LocalMap', out)


class ManifestTests(unittest.TestCase):
    def test_menu_must_be_a_map_of_the_mod(self):
        import mods
        base = dict(format=mods.FORMAT, id='my-mod', name='My mod', author='', version='1.0', description='',
                    game='revision', package='DXP_my_mod', maps=['Menu', 'Lab'], packages=['DXP_my_mod'], start='Lab',
                    requires=[], cover=None, created='2026-11-06 10:00', editor='DeusEdix')
        ok = mods.check_manifest(dict(base, menu='Menu'))
        self.assertEqual(ok['menu'], 'Menu')
        self.assertEqual(mods.check_manifest(dict(base))['menu'], '')
        with self.assertRaises(ValueError):
            mods.check_manifest(dict(base, menu='Elsewhere'))


if __name__ == '__main__':
    unittest.main()
