"""Project runtime isolation without launching the engine or touching game files."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import Mock, patch

KIT = Path(__file__).resolve().parents[1]


def module(name, settings):
    spec = importlib.util.spec_from_file_location('isolated_' + name, KIT / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'settings': settings}), patch.dict(os.environ, {'DEUSEDIX_PROJECT_WORKER': '1'}):
        spec.loader.exec_module(result)
    return result


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.parent = KIT / 'backup/project_manager_20261014/runtime-tests'
        self.parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=self.parent, prefix='runtime-')
        self.root = Path(self.temp.name)
        self.app = self.root / 'app'
        self.a = self.root / 'a'
        self.b = self.root / 'b'
        for folder in (self.app, self.a, self.b):
            folder.mkdir()
        self.settings = types.SimpleNamespace(APP_ROOT=self.app, PROJECT=self.a, PACKAGE='DXP_a',
            MANAGED_PROJECT=True, STANDALONE=True, MAPS_DIR_NAME='DeusEdixProjects/a',
            MAPS_DIR=self.root / 'game/Revision/DeusEdixProjects/a', GAME=self.root / 'game',
            REVISION=self.root / 'game/Revision', ANIMS_PACKAGE='DXP_aAnims', MODELS_PACKAGE='DXP_aModels',
            GAME_INI=self.root / 'game/Revision/System/Revision.ini', PROFILE={'exe': 'Revision.exe', 'short': 'Revision'},
            INI_SECTIONS=('Core.System', 'RevisionInternal.LaunchSystem'),
            GAME_SYSTEM=self.root / 'game/Revision/System', SCRIPTS_PACKAGE='DXP_aScripts',
            SOUNDS_PACKAGE='DXP_aSounds', current=lambda: {'id': 'a'}, python=lambda: ['python'])
        self.game = module('project_game', self.settings)
        self.preferences = module('project_preferences', self.settings)
        self.server = module('project_server', self.settings)

    def tearDown(self):
        self.assertTrue(self.root.resolve().is_relative_to(self.parent.resolve()))
        self.temp.cleanup()

    @staticmethod
    def original_ini():
        return ('[Core.System]\r\nSavePath=..\\Save\r\nPaths=..\\Maps\\*.dx\r\n'
                'Paths=..\\OtherMod\\*.u\r\nPaths=..\\DeusEdixMaps\\*.u\r\n'
                '[RevisionInternal.LaunchSystem]\r\nPaths=..\\UnatcoMaps\\*.dx\r\n'
                'Paths=..\\Textures\\*.utx\r\n[Other.Settings]\r\nUserSetting=keep\r\n'
                '[Engine.GameEngine]\r\nServerActors=UnatcoContinues.UCLegacyActor\r\n'
                'ServerActors=ThirdParty.Observer\r\n')

    def test_active_project_paths_replace_previous_only_and_restore_original_saves(self):
        text = self.original_ini()
        saved = self.game.original_save_paths(text)
        actors = self.game.original_actors(text)
        a_paths = ['Paths=..\\DeusEdixProjects\\a\\*.dx', 'Paths=..\\DeusEdixProjects\\a\\*.u']
        a = self.game.activate_text(text, a_paths, saved, '..\\DeusEdixProjects\\a\\Save')
        b_paths = [line.replace('\\a\\', '\\b\\') for line in a_paths]
        b = self.game.activate_text(a, b_paths, saved, '..\\DeusEdixProjects\\b\\Save')
        self.assertNotIn('\\a\\', b)
        self.assertNotIn('UnatcoMaps', b)
        self.assertNotIn('DeusEdixMaps', b)
        self.assertIn('Paths=..\\OtherMod\\*.u', b)
        self.assertIn('Paths=..\\Textures\\*.utx', b)
        self.assertIn('UserSetting=keep', b)
        self.assertNotIn('ServerActors=UnatcoContinues', b)
        self.assertIn('ServerActors=ThirdParty.Observer', b)
        self.assertEqual(b.count(b_paths[0]), 2)
        self.assertEqual(self.game.activate_text(b, b_paths, saved, '..\\DeusEdixProjects\\b\\Save'), b)
        legacy = self.game.activate_text(b, ['Paths=..\\DeusEdixMaps\\*.dx'], saved, actors=actors)
        self.assertNotIn('DeusEdixProjects', legacy)
        self.assertIn('SavePath=..\\Save\r\n', legacy)
        self.assertEqual(legacy.count('ServerActors=UnatcoContinues.UCLegacyActor'), 1)

    def test_workspace_ini_never_loads_another_project_package_or_maps(self):
        workspace = module('workspace', self.settings)
        workspace.SYS.mkdir(parents=True)
        (workspace.SYS / 'DeusEx.u').write_text('synthetic engine package')
        text = self.original_ini() + ('[Editor.EditorEngine]\r\nEditPackages=DeusEx\r\n'
              'EditPackages=DXP_b\r\nEditPackages=DXP_a\r\nPaths=..\\DeusEdixProjects\\b\\*.u\r\n')
        with patch.dict(sys.modules, {'project_game': self.game}):
            prepared = workspace._ini(text)
        self.assertNotIn('DeusEdixProjects\\b', prepared)
        self.assertNotIn('EditPackages=DXP_b', prepared)
        self.assertNotIn('UnatcoMaps', prepared)
        self.assertNotIn('DeusEdixMaps', prepared)
        self.assertNotIn('ServerActors=UnatcoContinues', prepared)
        self.assertIn('ServerActors=ThirdParty.Observer', prepared)
        self.assertEqual(prepared.count('EditPackages=DXP_a'), 1)
        self.assertIn('EditPackages=DeusEx', prepared)
        self.assertIn('Paths=%s\\*.dx' % (self.a / 'maps'), prepared)
        self.assertTrue(workspace._NOT_THEIRS.search('DXP_b.u'))

    def test_deactivation_restores_original_paths_saves_and_campaign_actors(self):
        ini = self.settings.REVISION / 'System/Revision.ini'
        ini.parent.mkdir(parents=True)
        original = self.original_ini()
        ini.write_text(original, encoding='latin1', newline='')
        paths = ['Paths=..\\DeusEdixProjects\\a\\*.dx', 'Paths=..\\DeusEdixProjects\\a\\*.u']
        self.assertTrue(self.game.activate(paths))
        active = ini.read_text(encoding='latin1')
        self.assertNotIn('UnatcoContinues.UCLegacyActor', active)
        self.assertNotIn('Paths=..\\UnatcoMaps\\*.dx', active)
        self.assertFalse(self.game.activate(paths))
        self.assertTrue(self.game.deactivate())
        restored = ini.read_text(encoding='latin1')
        self.assertEqual(self.game.original_paths(restored), self.game.original_paths(original))
        self.assertEqual(self.game.original_actors(restored), self.game.original_actors(original))
        self.assertEqual(self.game.original_save_paths(restored), self.game.original_save_paths(original))
        self.assertNotIn('DeusEdixProjects', restored)
        self.assertIn('Paths=..\\OtherMod\\*.u', restored)
        self.assertEqual(ini.with_name('Revision.ini.bak_projects').read_text(encoding='latin1'), original.replace('\r\n', '\n'))

    def test_old_snapshot_recovers_paths_and_actors_from_original_backup(self):
        ini = self.settings.REVISION / 'System/Revision.ini'
        ini.parent.mkdir(parents=True)
        original = self.original_ini()
        ini.with_name('Revision.ini.bak_projects').write_text(original)
        saved = self.game.original_save_paths(original)
        ini.with_name('deusedix-project-activation.json').write_text(json.dumps({'save_paths': saved}))
        active = self.game.activate_text(original, ['Paths=..\\DeusEdixProjects\\a\\*.dx'], saved,
                                         '..\\DeusEdixProjects\\a\\Save')
        ini.write_text(active)
        self.game.deactivate()
        restored = ini.read_text()
        self.assertEqual(self.game.original_paths(restored), self.game.original_paths(original))
        self.assertIn('ServerActors=UnatcoContinues.UCLegacyActor', restored)

    def test_project_close_deactivates_current_and_preserves_snapshot_and_backup(self):
        ini = self.settings.REVISION / 'System/Revision.ini'
        ini.parent.mkdir(parents=True)
        original = self.original_ini()
        ini.write_text(original, encoding='latin1', newline='')
        self.game.activate(['Paths=..\\DeusEdixProjects\\a\\*.dx', 'Paths=..\\DeusEdixProjects\\a\\*.u'])
        stamp = ini.with_name('deusedix-project-activation.json')
        backup = ini.with_name('Revision.ini.bak_projects')
        before = {path: path.read_bytes() for path in (stamp, backup)}
        self.assertTrue(self.game.deactivate_if_current())
        restored = ini.read_text(encoding='latin1')
        self.assertNotIn('DeusEdixProjects', restored)
        self.assertEqual(self.game.original_paths(restored), self.game.original_paths(original))
        self.assertEqual(self.game.original_actors(restored), self.game.original_actors(original))
        self.assertEqual(self.game.original_save_paths(restored), self.game.original_save_paths(original))
        self.assertEqual(before, {path: path.read_bytes() for path in (stamp, backup)})
        self.assertFalse(self.game.deactivate_if_current())

    def test_project_close_does_not_write_when_other_project_or_no_project_is_active(self):
        self.assertFalse(self.game.deactivate_if_current())
        self.assertFalse(self.settings.REVISION.exists())
        ini = self.settings.REVISION / 'System/Revision.ini'
        ini.parent.mkdir(parents=True)
        for lines in ('Paths=..\\DeusEdixProjects\\b\\*.dx',
                      'Paths=..\\DeusEdixProjects\\a\\*.dx\nPaths=..\\DeusEdixProjects\\b\\*.u',
                      'Paths=..\\DeusEdixMaps\\*.dx'):
            ini.write_text('[Core.System]\n' + lines + '\n')
            before = ini.read_bytes()
            with patch.object(self.game, 'deactivate') as deactivate:
                self.assertFalse(self.game.deactivate_if_current())
                deactivate.assert_not_called()
            self.assertEqual(ini.read_bytes(), before)
            self.assertEqual(list(ini.parent.iterdir()), [ini])

    def test_legacy_close_does_not_read_or_modify_game_configuration(self):
        self.settings.MANAGED_PROJECT = False
        with patch.object(Path, 'read_text', side_effect=AssertionError('Legacy must not read game ini')), \
                patch.object(self.game, 'deactivate') as deactivate:
            self.assertFalse(self.game.deactivate_if_current())
            deactivate.assert_not_called()
        self.assertFalse(self.settings.REVISION.exists())

    def test_project_close_rejects_concurrent_ini_change_before_snapshot_access(self):
        ini = self.settings.REVISION / 'System/Revision.ini'
        ini.parent.mkdir(parents=True)
        ini.write_text('[Core.System]\nPaths=..\\DeusEdixProjects\\b\\*.dx\n')
        before = ini.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'changed before'), patch.object(self.game, '_state') as state:
            self.game.deactivate(_expected='[Core.System]\nPaths=..\\DeusEdixProjects\\a\\*.dx\n')
        state.assert_not_called()
        self.assertEqual(ini.read_bytes(), before)

    def test_existing_workspace_install_also_activates_its_search_paths(self):
        self.settings.MANAGED_PROJECT = False
        self.settings.MAPS_DIR_NAME = 'DeusEdixMaps'
        self.settings.MAPS_DIR = self.root / 'game/Revision/DeusEdixMaps'
        self.settings.current = lambda: {'id': 'legacy', 'name': 'Existing workspace'}
        workspace = module('workspace', self.settings)
        workspace.DIST.mkdir()
        (workspace.DIST / 'DXP_a.u').write_text('synthetic runtime')
        ini = self.settings.REVISION / 'System/Revision.ini'
        ini.parent.mkdir(parents=True)
        ini.write_text(self.original_ini())
        with patch.object(workspace.subprocess, 'run', return_value=types.SimpleNamespace(stdout='')), \
                patch.object(workspace, 'activate') as activate:
            ok, _lines = workspace.install(log=lambda *args: None)
        self.assertTrue(ok)
        activate.assert_called_once_with()

    def test_preferences_share_layout_but_keep_project_content_separate(self):
        self.preferences.save({'deusedix.workspace.v1': 'layout A', 'deusedix.project:a:recent': 'map A'}, 'a')
        self.settings.PROJECT = self.b
        self.assertEqual(self.preferences.load('b'), {'deusedix.workspace.v1': 'layout A'})
        self.preferences.save({'deusedix.workspace.v1': 'layout B', 'deusedix.project:b:recent': 'map B'}, 'b')
        self.settings.PROJECT = self.a
        self.assertEqual(self.preferences.load('a'), {'deusedix.workspace.v1': 'layout B',
                                                     'deusedix.project:a:recent': 'map A'})

    def test_preferences_reject_foreign_identity_and_non_string_values_without_writes(self):
        for values in ({'deusedix.project:b:recent': 'foreign'}, {'arbitrary': 'x'}, {'deusedix.prefs': []}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.preferences.save(values, 'a')
        self.assertFalse((self.app / '.deusedix-ui.json').exists())
        self.assertFalse((self.a / '.deusedix-project-ui.json').exists())

    def test_operations_and_game_prevent_retiring_and_closed_workers_reject_late_writes(self):
        with self.server.operation():
            self.assertEqual(self.server.status()['operations'], 1)
            with self.assertRaises(RuntimeError):
                self.server.retire(lambda: False)
        self.assertEqual(self.server.status()['operations'], 0)
        with self.assertRaises(RuntimeError):
            self.server.retire(lambda: True)
        self.server.retire(lambda: False)
        with self.assertRaises(RuntimeError), self.server.operation():
            self.fail('Retired worker accepted an operation')
        self.server.retire(lambda: False, False)
        with self.assertRaisesRegex(ValueError, 'failed'), self.server.operation():
            raise ValueError('failed')
        self.assertEqual(self.server.status()['operations'], 0)

    def test_session_token_is_required_and_bootstrap_keeps_closing_script_text_inert(self):
        self.server.SESSION = 'a-private-session'
        self.assertTrue(self.server.authorized({'X-DeusEdix-Session': 'a-private-session'}))
        self.assertFalse(self.server.authorized({'X-DeusEdix-Session': 'a-stale-session'}))
        self.assertFalse(self.server.authorized({}))
        self.settings.current = lambda: {'id': 'a', 'name': '</script><script>bad</script>'}
        with patch.dict(sys.modules, {'project_preferences': self.preferences}):
            html = self.server.page('<html><head></head><body></body></html>')
        self.assertNotIn('</script><script>bad', html)
        self.assertIn('X-DeusEdix-Session', html)

    def test_failed_provision_resumes_previous_worker_and_preserves_active_identity(self):
        supervisor = self.server.Supervisor(game_running=lambda: False)
        previous = dict(project={'id': 'a'}, process=Mock(poll=lambda: None), url='http://old/', session='old')
        supervisor.active = previous
        fake_projects = types.SimpleNamespace(provision=Mock(side_effect=ValueError('local changes')))
        with patch.dict(sys.modules, {'projects': fake_projects}), patch.object(supervisor, '_retire') as retire, \
                patch.object(supervisor, '_stop'), patch.object(self.server, 'request') as request:
            with self.assertRaisesRegex(ValueError, 'local changes'):
                supervisor.open({'id': 'b'})
        retire.assert_called_once_with(previous)
        request.assert_called_once_with('http://old/api/project/resume', 'old', {}, timeout=3)
        self.assertIs(supervisor.active, previous)
        self.assertFalse(supervisor.lock.locked())

    def test_failed_process_launch_closes_log_and_releases_supervisor(self):
        supervisor = self.server.Supervisor(game_running=lambda: False)
        fake_projects = types.SimpleNamespace(provision=lambda _id: {'id': 'a', 'path': str(self.a)})
        stream = Mock()
        with patch.dict(sys.modules, {'projects': fake_projects}), patch.object(supervisor, '_port', return_value=9998), \
                patch.object(supervisor, '_stop'), patch.object(Path, 'open', return_value=stream), \
                patch.object(self.server.subprocess, 'Popen', side_effect=OSError('launch failed')):
            with self.assertRaisesRegex(OSError, 'launch failed'):
                supervisor.open({'id': 'a'})
        stream.close.assert_called_once_with()
        self.assertIsNone(supervisor.active)
        self.assertFalse(supervisor.lock.locked())

    @staticmethod
    def worker(ident='a'):
        process = Mock()
        process.poll.return_value = None
        process.wait.return_value = 0
        return dict(project={'id': ident}, process=process, url='http://' + ident + '/', session=ident, log=Mock())

    def test_gui_shutdown_drains_pending_close_timer_and_late_callback_is_idempotent(self):
        supervisor = self.server.Supervisor(game_running=lambda: False)
        worker = self.worker()
        supervisor.active = worker
        timer = Mock()
        with patch.object(self.server.threading, 'Timer', return_value=timer), patch.object(self.server, 'request'):
            supervisor.close()
            self.assertEqual(len(supervisor.retired), 1)
            self.assertIsNone(supervisor.active)
            supervisor.shutdown()
            # Simulate a timer callback already dispatched when cancel ran.
            supervisor._finish_retired(worker)
        timer.cancel.assert_called_once_with()
        worker['process'].wait.assert_called_once_with(timeout=5)
        worker['log'].close.assert_called_once_with()
        self.assertEqual(supervisor.retired, {})

    def test_immediate_shutdown_after_switch_stops_old_and_new_worker(self):
        supervisor = self.server.Supervisor(game_running=lambda: False)
        previous = self.worker()
        supervisor.active = previous
        child = self.worker('b')['process']
        fake_projects = types.SimpleNamespace(provision=lambda _id: {'id': 'b', 'path': str(self.b)})
        timer = Mock()
        with patch.dict(sys.modules, {'projects': fake_projects}), patch.object(supervisor, '_port', return_value=9998), \
                patch.object(self.server.subprocess, 'Popen', return_value=child), \
                patch.object(self.server.threading, 'Timer', return_value=timer), \
                patch.object(self.server, 'request', return_value={'project': {'id': 'b'}}):
            self.assertEqual(supervisor.open({'id': 'b'})['project']['id'], 'b')
            current = supervisor.active
            self.assertEqual(len(supervisor.retired), 1)
            supervisor.shutdown()
        self.assertIsNone(supervisor.active)
        self.assertEqual(supervisor.retired, {})
        previous['log'].close.assert_called_once_with()
        previous['process'].wait.assert_called_once_with(timeout=5)
        child.wait.assert_called_once_with(timeout=5)
        self.assertTrue(current['log'].closed)

    def test_external_workspace_worker_gets_identity_without_leaking_it_to_managed_workers(self):
        for external in (True, False):
            with self.subTest(external=external):
                supervisor = self.server.Supervisor(game_running=lambda: False)
                info = dict(id='workspace-test' if external else 'custom-test', path=str(self.b), external=external)
                child = self.worker()['process']
                fake_projects = types.SimpleNamespace(provision=lambda _id: info)
                with patch.dict(sys.modules, {'projects': fake_projects}), \
                        patch.dict(os.environ, {'DEUSEDIX_WORKSPACE_ID': 'stale'}), \
                        patch.object(supervisor, '_port', return_value=9998), \
                        patch.object(self.server.subprocess, 'Popen', return_value=child) as launch, \
                        patch.object(self.server, 'request', return_value={'project': info}):
                    supervisor.open(info)
                    env = launch.call_args.kwargs['env']
                    self.assertEqual(env['DEUSEDIX_PROJECT_ID'], info['id'])
                    self.assertEqual(env.get('DEUSEDIX_WORKSPACE_ID'), info['id'] if external else None)
                    supervisor.shutdown()

    def test_stop_and_shutdown_race_close_worker_log_exactly_once(self):
        supervisor = self.server.Supervisor(game_running=lambda: False)
        worker = self.worker()
        entered, release, draining = threading.Event(), threading.Event(), threading.Event()
        errors = []
        def wait(timeout):
            entered.set()
            if not release.wait(2):
                raise AssertionError('Test did not release waiting child')
            return 0
        worker['process'].wait.side_effect = wait
        supervisor.retired[id(worker)] = (worker, Mock())
        def stop():
            try:
                supervisor._finish_retired(worker)
            except BaseException as error:
                errors.append(error)
        def shutdown():
            try:
                draining.set()
                supervisor.shutdown()
            except BaseException as error:
                errors.append(error)
        with patch.object(self.server, 'request'):
            first = threading.Thread(target=stop)
            first.start()
            self.assertTrue(entered.wait(2))
            second = threading.Thread(target=shutdown)
            second.start()
            self.assertTrue(draining.wait(2))
            release.set()
            first.join(2)
            second.join(2)
        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(supervisor.retired, {})
        worker['log'].close.assert_called_once_with()
        worker['process'].wait.assert_called_once_with(timeout=5)

    def test_external_game_blocks_new_project_before_provision_and_current_project_stays_available(self):
        running = Mock(return_value=True)
        supervisor = self.server.Supervisor(game_running=running)
        fake_projects = types.SimpleNamespace(provision=Mock())
        with patch.dict(sys.modules, {'projects': fake_projects}):
            with self.assertRaisesRegex(RuntimeError, 'Close the game'):
                supervisor.open({'id': 'a'})
        fake_projects.provision.assert_not_called()
        self.assertIsNone(supervisor.active)
        supervisor.active = self.worker()
        self.assertEqual(supervisor.open({'id': 'a'})['url'], 'http://a/')
        running.assert_called_once_with()

    def test_failed_retired_timer_start_keeps_previous_worker_active_and_resumes_it(self):
        supervisor = self.server.Supervisor(game_running=lambda: False)
        previous = self.worker()
        supervisor.active = previous
        timer = Mock()
        timer.start.side_effect = RuntimeError('Cannot start timer')
        with patch.object(self.server.threading, 'Timer', return_value=timer), patch.object(self.server, 'request') as request:
            with self.assertRaisesRegex(RuntimeError, 'Cannot start timer'):
                supervisor.close()
        self.assertIs(supervisor.active, previous)
        self.assertEqual(supervisor.retired, {})
        self.assertEqual(request.call_args.args[0], 'http://a/api/project/resume')
        previous['log'].close.assert_not_called()


if __name__ == '__main__':
    unittest.main()
