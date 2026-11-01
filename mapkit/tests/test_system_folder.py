"""Review 2c #14 (29 Oct 2026): a game's System folder comes from one function, settings.system_folder (the game's
root in TARGETS, under the Deus Ex folder). The uninstaller (workspace.remove_game_files, project_game.deactivate_all),
the hub's check for a running game (project_server._game_running), a conversion's private run (convert._run), and
(review 2d #8) a mod's install (mods.game_root, kit.install_native) and the check of what a game would miss
(gamecheck.search_paths: the Paths of the ini there or, with none, the folders beside it, review 2e #4) follow it when
it moves there (a third game, another layout of the folders); before, each worked it out by hand and kept the old one.
Fake game folders only."""
import importlib.util
import io
import json
import os
import sys
import tempfile
import types
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import settings as real_settings  # noqa: E402  (the real data: TARGETS, the launch copies' names)
import convert  # noqa: E402
import gamecheck  # noqa: E402


def module(name, settings):
    """A fresh copy of one of mapkit's modules on these settings (as a project's worker: no hub of its own)."""
    spec = importlib.util.spec_from_file_location('moved_' + name, KIT / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'settings': settings}), patch.dict(os.environ, {'DEUSEDIX_PROJECT_WORKER': '1'}):
        spec.loader.exec_module(result)
    return result


class MovedSystemTests(unittest.TestCase):
    """Each game's System folder where only settings.system_folder knows it (Moved\\<target>\\System, outside the Deus
    Ex folder's own layout), with the game's program and ini in it."""
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.game = self.root / 'Deus Ex'
        for target, profile in real_settings.TARGETS.items():
            self.moved(target).mkdir(parents=True)
            (self.moved(target) / profile['exe']).write_bytes(b'the game')
            (self.moved(target) / profile['ini']).write_bytes(b'[Core.System]\r\nPaths=..\\Maps\\*.dx\r\n')
        self.s = types.SimpleNamespace(
            GAME=self.game, TARGETS=real_settings.TARGETS, PROJECT=self.root / 'app', PACKAGE='DeusEdix',
            ANIMS_PACKAGE='A', MODELS_PACKAGE='M', SOUNDS_PACKAGE='S', SCRIPTS_PACKAGE='Scripts', STANDALONE=True,
            MANAGED_PROJECT=False, DEV={'package': 'DevMod', 'mapsDir': 'DevMaps'},
            LAUNCH_PLAY=real_settings.LAUNCH_PLAY, LAUNCH_MOD=real_settings.LAUNCH_MOD,
            launch_names=real_settings.launch_names, check_game=lambda folder, target=None: [],
            game_running=lambda target=None: False,
            system_folder=lambda target=None, folder=None: self.moved(target or 'revision'))

    def moved(self, target):
        return self.root / 'Moved' / target / 'System'

    def test_the_uninstaller_removes_what_deusedix_put_there(self):
        workspace = module('workspace', self.s)
        for target in real_settings.TARGETS:
            (self.moved(target) / 'DeusEdixNav.dll').write_bytes(b'x')
            (self.moved(target).parent / 'DeusEdixMods' / 'my-mod').mkdir(parents=True)
        none = types.SimpleNamespace(stdout='INFO: No tasks are running')            # tasklist: no game running
        with patch.object(workspace.subprocess, 'run', return_value=none):
            ok, lines = workspace.remove_game_files()
        self.assertTrue(ok, lines)
        for target, profile in real_settings.TARGETS.items():
            self.assertFalse((self.moved(target) / 'DeusEdixNav.dll').exists(), target)
            self.assertFalse((self.moved(target).parent / 'DeusEdixMods').exists(), target)
            self.assertTrue((self.moved(target) / profile['exe']).is_file(), target)        # the game's own stays

    def test_the_uninstall_gives_back_each_games_ini_there(self):
        project_game = module('project_game', self.s)
        inis = [self.moved(target) / profile['ini'] for target, profile in real_settings.TARGETS.items()]
        for ini in inis:
            ini.with_name('deusedix-project-activation.json').write_text('{}')           # DeusEdix changed it
        with patch.object(project_game, 'deactivate') as deactivate:
            self.assertEqual(project_game.deactivate_all(), ([str(ini) for ini in inis], []))
        self.assertEqual([call.kwargs['ini'] for call in deactivate.call_args_list], inis)

    def test_the_hub_looks_for_each_games_program_there(self):
        project_server = module('project_server', self.s)
        seen = []
        none = types.SimpleNamespace(list=lambda: [])                                # no game running
        processes = types.SimpleNamespace(WindowsProcesses=lambda exe: seen.append(exe) or none)
        with patch.dict(sys.modules, {'game_process': processes}):
            self.assertFalse(project_server._game_running())
        exes = [self.moved(target) / profile['exe'] for target, profile in real_settings.TARGETS.items()]
        self.assertEqual(seen, exes)

    def test_a_conversion_runs_on_the_games_files_there(self):
        (self.moved('revision') / 'Engine.u').write_bytes(b'the game')
        with patch.object(convert, 'settings', self.s), \
                patch.multiple(convert, RUNS=self.root / 'runs', HOST=self.root / 'no-host' / 'UCMapKitHost.exe'):
            run = convert._run(self.game, 'revision', 'moved') / 'System'
        self.assertEqual((run / 'Engine.u').read_bytes(), b'the game')
        self.assertIn('[Core.System]', (run / 'Revision.ini').read_text(encoding='latin1'))

    def test_a_mod_installs_beside_that_system_folder_and_its_dll_into_it(self):
        mods = module('mods', self.s)
        native = []
        kit = types.SimpleNamespace(install_native=native.append)
        none = types.SimpleNamespace(stdout='INFO: No tasks are running')            # tasklist: no game running
        for target in real_settings.TARGETS:
            with self.subTest(game=target):
                manifest = dict(format=1, id='my-mod', name='My Mod', version='1', game=target, package='DXP_my_mod',
                                packages=['DXP_my_mod'], maps=['01_ModMap'], start='01_ModMap')
                raw = io.BytesIO()
                with zipfile.ZipFile(raw, 'w') as z:
                    z.writestr('mod.json', json.dumps(manifest))
                    z.writestr('maps/01_ModMap.dx', b'a map')
                    z.writestr('packages/DXP_my_mod.u', b'a package')
                with patch.dict(sys.modules, {'kit': kit}), patch.object(mods.subprocess, 'run', return_value=none):
                    mods.install(raw.getvalue())
                self.assertTrue((self.moved(target).parent / 'DeusEdixMods' / 'my-mod' / '01_ModMap.dx').is_file())
                self.assertEqual(native[-1], self.moved(target))

    def test_the_check_of_what_a_game_would_miss_reads_the_ini_there(self):
        for target in real_settings.TARGETS:
            with self.subTest(game=target), patch.object(gamecheck, 'settings', self.s):
                maps = (self.moved(target).parent / 'Maps').resolve()                # the ini's Paths=..\Maps\*.dx
                self.assertEqual(gamecheck.search_paths(target), [(maps, '*.dx')])

    def test_with_no_paths_the_check_reads_the_folders_beside_that_system_folder(self):
        for target, profile in real_settings.TARGETS.items():
            (self.moved(target) / profile['ini']).write_bytes(b'[Engine.Engine]\r\n')      # no Paths
            with self.subTest(game=target), patch.object(gamecheck, 'settings', self.s):
                root = self.moved(target).parent
                self.assertEqual(gamecheck.search_paths(target),
                                 [(self.moved(target), '*.u'), (root / 'Maps', '*.dx'), (root / 'Textures', '*.utx'),
                                  (root / 'Sounds', '*.uax'), (root / 'Music', '*.umx')])


if __name__ == '__main__':
    unittest.main()
