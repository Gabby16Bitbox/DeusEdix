"""The installer puts DeusEdixNav into every game's System, and the uninstaller can take out everything DeusEdix put
into the games (25 Oct 2026): DeusEdix's own folders, files, ini lines and Play sections go; another mod's lines,
the games' own files and whatever a link points to stay."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
sys.path.insert(0, str(KIT))

TARGETS = {
    'revision': dict(name='Deus Ex: Revision', short='Revision', root='Revision', exe='Revision.exe',
                     ini='Revision.ini', user_ini='RevisionUser.ini'),
    'vanilla': dict(name='Deus Ex (original game)', short='Deus Ex', root='', exe='DeusEx.exe', ini='DeusEx.ini',
                    user_ini='User.ini'),
}
GAME_INI = ('[Core.System]\r\nPaths=..\\System\\*.u\r\nPaths=..\\DeusEdixMaps\\*.dx\r\n'
            'Paths=..\\DeusEdixProjects\\abc\\*.dx\r\nPaths=..\\UnatcoMaps\\*.dx\r\n'
            '[Engine.GameEngine]\r\nServerActors=IpDrv.UdpBeacon\r\nServerActors=DeusEdix.UCLegacyActor\r\n'
            'ServerActors=DXP_abc.UCLegacyActor\r\nServerActors=UnatcoContinues.UCLegacyActor\r\n'
            '[Engine.Engine]\r\nSavePath=..\\Save\r\n')
KEPT_INI = ('[Core.System]\r\nPaths=..\\System\\*.u\r\nPaths=..\\UnatcoMaps\\*.dx\r\n'
            '[Engine.GameEngine]\r\nServerActors=IpDrv.UdpBeacon\r\nServerActors=UnatcoContinues.UCLegacyActor\r\n'
            '[Engine.Engine]\r\nSavePath=..\\Save\r\n')


def load(settings):
    spec = importlib.util.spec_from_file_location('tested_workspace', KIT / 'workspace.py')
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'settings': settings}):
        spec.loader.exec_module(module)
    return module


def not_running(*args, **kwargs):
    return types.SimpleNamespace(stdout='INFO: No tasks are running')


class Cleanup(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=HERE)
        self.root = Path(self.tmp.name)
        self.game = self.root / 'Deus Ex'
        self.s = types.SimpleNamespace(PROJECT=self.root / 'app', PACKAGE='DeusEdix', ANIMS_PACKAGE='A',
                                       MODELS_PACKAGE='M', SOUNDS_PACKAGE='S', SCRIPTS_PACKAGE='Scripts', GAME=self.game,
                                       GAME_ROOT=self.game / 'Revision', REVISION=self.game / 'Revision',
                                       GAME_SYSTEM=self.game / 'Revision/System', TARGETS=TARGETS,
                                       MANAGED_PROJECT=False, STANDALONE=True)
        self.w = load(self.s)
        native = self.root / 'bin'
        native.mkdir()
        self.w.NATIVE = tuple(native / n for n in ('DeusEdixNav.u', 'DeusEdixNav.dll'))
        for f in self.w.NATIVE:
            f.write_bytes(b'this build')
        for profile in TARGETS.values():
            system = (self.game / profile['root'] if profile['root'] else self.game) / 'System'
            system.mkdir(parents=True)
            (system / profile['exe']).write_bytes(b'game')
            (system / profile['ini']).write_bytes(GAME_INI.encode('latin1'))

    def tearDown(self):
        self.tmp.cleanup()

    def system(self, target):
        root = TARGETS[target]['root']
        return (self.game / root if root else self.game) / 'System'

    def test_native_goes_into_every_game_there(self):
        ok, lines = self.w.install_native_everywhere()
        self.assertTrue(ok)
        for target in TARGETS:
            self.assertEqual((self.system(target) / 'DeusEdixNav.dll').read_bytes(), b'this build')
        (self.system('vanilla') / 'DeusEx.exe').unlink()            # no original game: only Revision's
        self.assertEqual(self.w.game_systems(), [self.system('revision')])

    def test_everything_of_deusedix_goes_and_nothing_else(self):
        outside = self.root / 'elsewhere'
        outside.mkdir()
        (outside / 'canary.txt').write_text('keep me')
        for target in TARGETS:
            system, root = self.system(target), self.system(target).parent
            for name in ('DeusEdixNav.u', 'DeusEdixNav.dll', 'deusedix-project-activation.json',
                         TARGETS[target]['ini'] + '.bak_projects', 'Core.u'):
                (system / name).write_bytes(b'x')
            for folder in ('DeusEdixProjects/abc/Save', 'DeusEdixMods/mymod', 'DeusEdixMaps', 'Maps'):
                (root / folder).mkdir(parents=True)
            (root / 'DeusEdixProjects/abc/01_Map.dx').write_bytes(b'map')
            (root / 'Maps/00_Intro.dx').write_bytes(b'the game')
            subprocess.run(['cmd', '/c', 'mklink', '/J', str(root / 'DeusEdixProjects/abc/Link'), str(outside)],
                           capture_output=True, check=True)
        revision = self.system('revision')
        (revision / 'DeusEdixMod.ini').write_text('mod launch copy')
        (revision / 'RevisionUser.ini').write_bytes(b'[Engine.Input]\r\nF=Fire\r\n[DeusEdix.UCConsoleLink]\r\nSeq=3\r\n'
                                                     b'[UnatcoContinues.UCShotRunner]\r\nbActive=False\r\n')
        (revision / 'RevisionUser.ini.bak_shots').write_bytes(b'backup')
        (self.system('vanilla') / 'User.ini').write_bytes(b'[Engine.Input]\r\nF=Fire\r\n[DXP_abc.UCShotRunner]\r\nx=1\r\n')
        (self.system('vanilla') / 'User.ini.bak_shots').write_bytes(b'backup')
        with patch.object(self.w.subprocess, 'run', not_running):
            ok, lines = self.w.remove_game_files()
        self.assertTrue(ok, lines)
        self.assertEqual((outside / 'canary.txt').read_text(), 'keep me')          # a link is removed as a link
        for target in TARGETS:
            system, root = self.system(target), self.system(target).parent
            for name in ('DeusEdixProjects', 'DeusEdixMods', 'DeusEdixMaps'):
                self.assertFalse((root / name).exists(), name)
            for name in ('DeusEdixNav.u', 'DeusEdixNav.dll', 'deusedix-project-activation.json',
                         TARGETS[target]['ini'] + '.bak_projects'):
                self.assertFalse((system / name).exists(), name)
            self.assertTrue((root / 'Maps/00_Intro.dx').is_file())                 # the game's own files stay
            self.assertTrue((system / 'Core.u').is_file())
            self.assertEqual((system / TARGETS[target]['ini']).read_bytes().decode('latin1'), KEPT_INI)
        self.assertFalse((revision / 'DeusEdixMod.ini').exists())
        self.assertEqual((revision / 'RevisionUser.ini').read_bytes(),
                         b'[Engine.Input]\r\nF=Fire\r\n[UnatcoContinues.UCShotRunner]\r\nbActive=False\r\n')
        self.assertTrue((revision / 'RevisionUser.ini.bak_shots').exists())       # another mod's runner still uses it
        self.assertEqual((self.system('vanilla') / 'User.ini').read_bytes(), b'[Engine.Input]\r\nF=Fire\r\n')
        self.assertFalse((self.system('vanilla') / 'User.ini.bak_shots').exists())

    def test_a_running_game_is_left_alone(self):
        (self.system('revision') / 'DeusEdixNav.dll').write_bytes(b'in use')
        running = lambda args, **kw: types.SimpleNamespace(stdout='Revision.exe 1234' if 'Revision.exe' in args[-1] else '')
        with patch.object(self.w.subprocess, 'run', running):
            ok, lines = self.w.remove_game_files()
        self.assertFalse(ok)
        self.assertTrue((self.system('revision') / 'DeusEdixNav.dll').exists())
        self.assertIn('Revision is running', '\n'.join(lines))

    def test_still_saving_into_a_project_keeps_the_backup(self):
        ini = self.system('vanilla') / 'DeusEx.ini'
        ini.write_bytes(b'[Engine.Engine]\r\nSavePath=..\\DeusEdixProjects\\abc\\Save\r\n')
        (self.system('vanilla') / 'DeusEx.ini.bak_projects').write_bytes(b'the original')
        with patch.object(self.w.subprocess, 'run', not_running):
            ok, lines = self.w.remove_game_files()
        self.assertFalse(ok)
        self.assertTrue((self.system('vanilla') / 'DeusEx.ini.bak_projects').exists())

    def test_projects_go_but_one_kept_elsewhere_stays(self):
        projects = self.s.PROJECT / 'Projects'
        (projects / 'p1/maps').mkdir(parents=True)
        elsewhere = self.root / 'My project'
        elsewhere.mkdir()
        (projects / 'registry.json').write_text(json.dumps({'version': 1, 'projects': [
            {'id': 'p1', 'path': str(projects / 'p1')}, {'id': 'p2', 'path': str(elsewhere)}]}))
        exports = self.root / 'Documents/DeusEdix Mods'
        exports.mkdir(parents=True)
        (exports / 'Mine-1.0.dxmod').write_bytes(b'zip')
        with patch.dict(sys.modules, {'mods': types.SimpleNamespace(EXPORTS=exports)}), \
                patch.dict(os.environ, {'DEUSEDIX_PROJECTS_DIR': ''}):
            ok, lines = self.w.remove_projects()
        self.assertTrue(ok, lines)
        self.assertFalse(projects.exists())
        self.assertFalse(exports.exists())
        self.assertTrue(elsewhere.is_dir())
        self.assertIn(str(elsewhere), '\n'.join(lines))


if __name__ == '__main__':
    unittest.main()
