"""An installed mod starts on the original game as the game's own mods do (mods.start_of, 20 Nov 2026): on the game's
start map DX.dx with no map switch (-hax0r turns the cheats on). With its own main menu, its menu map is a DX.dx in
the mod's folder; without, the game's own menu, whose New Game begins the mod's start map (UCModStart)."""
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mods  # noqa: E402
import project_game  # noqa: E402
import settings  # noqa: E402

OTHER = r'Z:\NotSteam\DeusEx'      # not in a Steam library: the game's own program


def manifest(**over):
    base = dict(format=mods.FORMAT, id='my-mod', name='My mod', author='', version='1.0', description='',
                game='vanilla', package='DXP_my_mod', maps=['Menu', 'Lab'], packages=['DXP_my_mod'], start='Lab',
                requires=[], cover=None, created='2026-11-20 10:00', editor='DeusEdix')
    base.update(over)
    return mods.check_manifest(base)


class StartOf(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        (self.folder / 'Menu.dx').write_bytes(b'menu map one')
        (self.folder / 'Lab.dx').write_bytes(b'lab map')
        (self.folder / 'DXP_my_mod.u').write_bytes(b'\x00UCBoot\x00UCModStart\x00UCNewGame\x00')

    def tearDown(self):
        shutil.rmtree(self.folder, ignore_errors=True)

    def test_own_menu_is_the_games_start_map(self):
        start = mods.start_of('vanilla', self.folder, manifest(menu='Menu'), prepare=True)
        self.assertEqual(start, dict(word='DX', new_game='', shows='Menu'))
        self.assertEqual((self.folder / 'DX.dx').read_bytes(), b'menu map one')

    def test_menu_copy_follows_an_update(self):
        mods.start_of('vanilla', self.folder, manifest(menu='Menu'), prepare=True)
        copy = self.folder / 'DX.dx'
        if os.path.samefile(copy, self.folder / 'Menu.dx'):
            os.unlink(copy)                       # an update writes a new menu map: the old link stays behind
            copy.write_bytes(b'menu map one')
        (self.folder / 'Menu.dx').unlink()
        (self.folder / 'Menu.dx').write_bytes(b'menu map two')
        mods.start_of('vanilla', self.folder, manifest(menu='Menu'), prepare=True)
        self.assertEqual(copy.read_bytes(), b'menu map two')

    def test_no_copy_without_prepare(self):
        mods.start_of('vanilla', self.folder, manifest(menu='Menu'))
        self.assertFalse((self.folder / 'DX.dx').exists())

    def test_no_menu_the_games_menu_begins_the_start_map(self):
        start = mods.start_of('vanilla', self.folder, manifest())
        self.assertEqual(start, dict(word='DX', new_game='Lab', shows='DX'))

    def test_older_package_starts_on_its_map(self):
        (self.folder / 'DXP_my_mod.u').write_bytes(b'\x00UCBoot\x00UCNewGame\x00')
        self.assertEqual(mods.start_of('vanilla', self.folder, manifest())['word'], 'Lab')

    def test_a_map_named_dx_that_is_not_the_menu(self):
        (self.folder / 'DX.dx').write_bytes(b'the mod own dx')
        start = mods.start_of('vanilla', self.folder, manifest(maps=['Menu', 'Lab', 'DX'], menu='Menu'), prepare=True)
        self.assertEqual(start['word'], 'Menu')
        self.assertEqual((self.folder / 'DX.dx').read_bytes(), b'the mod own dx')

    def test_classic_mod_with_its_own_dx(self):
        m = manifest(kind='classic', package='', maps=['DX', 'Intro'], packages=['Stuff.u'], start='Intro')
        self.assertEqual(mods.start_of('vanilla', self.folder, m), dict(word='DX', new_game='', shows='DX'))

    def test_classic_mod_without(self):
        m = manifest(kind='classic', package='', maps=['Intro'], packages=['Stuff.u'], start='Intro')
        self.assertEqual(mods.start_of('vanilla', self.folder, m)['word'], 'Intro')

    def test_revision_unchanged(self):
        self.assertEqual(mods.start_of('revision', self.folder, manifest(game='revision', menu='Menu'), prepare=True),
                         dict(word='Menu', new_game='', shows='Menu'))
        self.assertEqual(mods.start_of('revision', self.folder, manifest(game='revision'))['word'], 'Lab')
        self.assertFalse((self.folder / 'DX.dx').exists())


class NoCheats(unittest.TestCase):
    def test_start_map_gets_no_switch(self):
        for word in ('DX', 'dx.dx'):
            argv, _ = settings.game_command([word, 'INI=a,', 'USERINI=b,'], target='vanilla', folder=OTHER)
            self.assertEqual(argv[1:], [word, 'INI=a,', 'USERINI=b,'])

    def test_ini_words_are_not_maps(self):
        argv, _ = settings.game_command(['INI=a,', 'USERINI=b,'], target='vanilla', folder=OTHER)
        self.assertEqual(argv[1:], ['INI=a,', 'USERINI=b,'])


class IniPut(unittest.TestCase):
    def test_new_section_and_replaced_key(self):
        text = '[Engine.Engine]\r\nRoot=DeusEx.DeusExRootWindow\r\nGameEngine=Engine.GameEngine\r\n[URL]\r\nMap=Index.dx\r\n'
        text = project_game.menu_ini(text, 'DXP_my_mod.UCMenuRoot', '')
        text = project_game.ini_put(text, 'DXP_my_mod.UCModStart', 'StartMap', 'Lab')
        self.assertIn('[Engine.Engine]\r\nRoot=DXP_my_mod.UCMenuRoot\r\nGameEngine=Engine.GameEngine\r\n', text)
        self.assertNotIn('LocalMap', text)
        self.assertTrue(text.endswith('[DXP_my_mod.UCModStart]\r\nStartMap=Lab\r\n'))
        again = project_game.ini_put(text, 'DXP_my_mod.UCModStart', 'StartMap', 'Other')
        self.assertEqual(again.count('StartMap='), 1)
        self.assertIn('StartMap=Other', again)


if __name__ == '__main__':
    unittest.main()
