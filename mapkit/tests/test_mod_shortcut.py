"""A mod's desktop shortcut (Projects > Mods: Shortcut, mods.shortcut, 21 Nov 2026): the mod's game started with no
DeusEdix, the way Play starts it (mods.start_of), on ini files of the mod's own that stay (mods.own_inis): Revision's in
its System folder by the mod's id, the original game's in the mod's folder (Launch). Made again, the player's ini is read
again and the mod's user ini kept; an update keeps them and the shortcut, a removal takes them. Fake game folders and a
fake PowerShell only: no shortcut is made on the desktop."""
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_play_launch_copies import Game, module  # noqa: E402


class ModShortcutTests(Game):
    MANIFEST = dict(format=1, id='my-mod', name='My Mod: Part 2', version='1', package='DXP_my_mod',
                    packages=['DXP_my_mod'], maps=['01_ModMap'], start='01_ModMap', requires=[])

    def install(self, target, files=(), **manifest):
        self.use(target)
        self.m = module('mods', self.s)
        folder = self.m.mods_root(target) / 'my-mod'
        folder.mkdir(parents=True)
        for name, data in dict(files).items():
            (folder / name).write_bytes(data)
        (folder / 'mod.json').write_text(json.dumps(dict(self.MANIFEST, game=target, **manifest)), encoding='utf-8')
        self.desktop = self.game.parent / 'Desktop'
        self.desktop.mkdir(exist_ok=True)
        return folder

    def shortcut(self, target):
        """mods.shortcut with a fake PowerShell that writes the .lnk as a text file of what it was given."""
        calls = []

        def run(argv, **kw):
            if argv[0] == 'tasklist':
                return types.SimpleNamespace(stdout='', returncode=0, stderr='')
            env = kw['env']
            calls.append(env)
            path = self.desktop / env['DXM_NAME']
            path.write_text(json.dumps({k: v for k, v in env.items() if k.startswith('DXM_')}), encoding='utf-8')
            return types.SimpleNamespace(stdout=str(path), returncode=0, stderr='')
        with patch.object(self.m.subprocess, 'run', side_effect=run):
            result = self.m.shortcut(target, 'my-mod')
        return result, calls[-1]

    def test_a_revision_mod_starts_on_its_own_ini_files_in_system(self):
        folder = self.install('revision')
        result, env = self.shortcut('revision')
        self.assertEqual(Path(result['path']).name, 'My Mod Part 2.lnk')          # no ':' in a file name
        self.assertEqual(env['DXM_TARGET'], 'C:\\Steam\\steam.exe')
        self.assertEqual(env['DXM_ARGS'], '-applaunch 397550 01_ModMap INI=DeusEdixMod_my-mod.ini, '
                                          'USERINI=DeusEdixMod_my-modUser.ini,')
        ini = (self.system() / 'DeusEdixMod_my-mod.ini').read_bytes()
        self.assertIn(b'Paths=..\\DeusEdixMods\\my-mod\\*.dx', ini)
        self.assertIn(b'SavePath=..\\DeusEdixMods\\my-mod\\Save', ini)            # the same saves as Play's
        self.assertEqual(json.loads((folder / 'shortcut.json').read_text())['path'], result['path'])
        self.assert_players_untouched()
        # its patterns are the uninstaller's too
        patterns = self.ws.game_files()
        for name in ('DeusEdixMod_my-mod.ini', 'DeusEdixMod_my-modUser.ini'):
            self.assertTrue(any(Path(name).match(p) for p in patterns), patterns)

    def test_an_original_game_mod_keeps_its_ini_files_in_its_folder_with_no_hax0r(self):
        folder = self.install('vanilla', files={'DXP_my_mod.u': b'\x00UCModStart\x00'})
        _, env = self.shortcut('vanilla')
        self.assertEqual(env['DXM_ARGS'], '-applaunch 6910 DX INI=..\\DeusEdixMods\\my-mod\\Launch\\DeusEx.ini, '
                                          'USERINI=..\\DeusEdixMods\\my-mod\\Launch\\User.ini,')
        ini = (folder / 'Launch' / 'DeusEx.ini').read_bytes()
        self.assertIn(b'[DXP_my_mod.UCModStart]\r\nStartMap=01_ModMap\r\n', ini)
        self.assertFalse((folder / 'Play').exists())                              # not a Play's copies
        self.assert_players_untouched()

    def test_made_again_it_keeps_the_mods_keys_and_reads_the_players_ini_again(self):
        folder = self.install('vanilla')
        self.shortcut('vanilla')
        user = folder / 'Launch' / 'User.ini'
        user.write_bytes(b'[Engine.Input]\r\nF24=MyModKey\r\n')                  # set in the mod's game
        self.s.GAME_INI.write_bytes(self.s.GAME_INI.read_bytes() + b'[Extra.Thing]\r\nNew=1\r\n')
        self.before[self.s.GAME_INI] = self.s.GAME_INI.read_bytes()
        result, env = self.shortcut('vanilla')
        self.assertEqual(user.read_bytes(), b'[Engine.Input]\r\nF24=MyModKey\r\n')
        self.assertIn(b'[Extra.Thing]', (folder / 'Launch' / 'DeusEx.ini').read_bytes())
        self.assertEqual(env['DXM_MINE'], result['path'])                         # it overwrites its own
        self.assert_players_untouched()

    def test_an_update_keeps_the_shortcut_and_the_mods_ini_files(self):
        folder = self.install('vanilla')
        self.shortcut('vanilla')
        (folder / 'Launch' / 'User.ini').write_bytes(b'keys')
        stage = folder.parent / '.my-mod.installing'
        stage.mkdir()
        (stage / 'Save').mkdir()
        self.m._keep_player_files(folder, stage)
        self.assertEqual((stage / 'Launch' / 'User.ini').read_bytes(), b'keys')
        self.assertTrue((stage / 'shortcut.json').is_file())

    def test_a_new_start_map_remakes_the_shortcut(self):
        folder = self.install('revision', maps=['01_ModMap', '02_Other'])
        self.shortcut('revision')
        with patch.object(self.m, 'shortcut') as again:
            self.m.set_start('revision', 'my-mod', '02_Other')
        again.assert_called_once_with('revision', 'my-mod')

    def test_a_removal_takes_the_shortcut_and_the_mods_own_ini_files(self):
        folder = self.install('revision')
        result, _ = self.shortcut('revision')
        with patch.object(self.m.subprocess, 'run', return_value=types.SimpleNamespace(stdout='')):
            self.m.uninstall('revision', 'my-mod')
        self.assertFalse(Path(result['path']).exists())
        self.assertFalse((self.system() / 'DeusEdixMod_my-mod.ini').exists())
        self.assertFalse(folder.exists())
        self.assertTrue(self.desktop.is_dir())

    def test_the_icon_is_the_mods_cover(self):
        import io
        try:
            from PIL import Image
        except ImportError:
            self.skipTest('no Pillow in this Python (the app has it)')
        buf = io.BytesIO()
        Image.new('RGB', (300, 200), (200, 30, 30)).save(buf, 'PNG')
        folder = self.install('revision', files={'cover.png': buf.getvalue()}, cover='cover.png')
        _, env = self.shortcut('revision')
        self.assertEqual(env['DXM_ICON'], str(folder / 'icon.ico') + ',0')
        with Image.open(folder / 'icon.ico') as ico:
            self.assertEqual(ico.size, (256, 256))
        folder2 = self.install('vanilla')
        _, env = self.shortcut('vanilla')                                         # no cover: the game's program
        self.assertTrue(env['DXM_ICON'].endswith('DeusEx.exe,0'), env['DXM_ICON'])

    def test_a_file_of_the_players_with_that_name_is_not_overwritten(self):
        self.install('revision')

        def run(argv, **kw):
            if argv[0] == 'tasklist':
                return types.SimpleNamespace(stdout='', returncode=0, stderr='')
            return types.SimpleNamespace(stdout='TAKEN C:\\Users\\x\\Desktop\\My Mod Part 2.lnk', returncode=3, stderr='')
        with patch.object(self.m.subprocess, 'run', side_effect=run), self.assertRaisesRegex(ValueError, 'already'):
            self.m.shortcut('revision', 'my-mod')

    def test_the_real_powershell_makes_the_link_and_never_overwrites_someone_elses(self):
        """The script itself (Windows' WScript.Shell), into a folder of the test's (DXM_DESK) instead of the desktop."""
        import os
        import subprocess
        self.install('revision')
        env = dict(os.environ, DXM_DESK=str(self.desktop), DXM_NAME='My Mod.lnk', DXM_MINE='', DXM_MARK='DeusEdixMod_my-mod.ini,',
                   DXM_TARGET=sys.executable, DXM_ARGS='01_ModMap INI=DeusEdixMod_my-mod.ini,', DXM_CWD=str(self.game),
                   DXM_ICON=sys.executable + ',0', DXM_DESC='My Mod for Deus Ex')
        run = lambda env: subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                                          '-Command', self.m._MAKE_LINK], capture_output=True, text=True, env=env, timeout=60)
        r = run(env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(Path(r.stdout.strip()), self.desktop / 'My Mod.lnk')
        read = subprocess.run(['powershell', '-NoProfile', '-Command', "$s=(New-Object -ComObject WScript.Shell).CreateShortcut("
                               "'%s'); $s.Arguments" % (self.desktop / 'My Mod.lnk')], capture_output=True, text=True)
        self.assertEqual(read.stdout.strip(), '01_ModMap INI=DeusEdixMod_my-mod.ini,')
        self.assertEqual(run(env).returncode, 0)                                 # ours (its ini in the arguments): again
        r = run(dict(env, DXM_MARK='DeusEdixMod_other.ini,'))                     # another's: left alone
        self.assertEqual(r.returncode, 3)
        self.assertTrue(r.stdout.startswith('TAKEN '))


if __name__ == '__main__':
    unittest.main()
