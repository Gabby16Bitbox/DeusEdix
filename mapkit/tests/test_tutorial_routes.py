"""Exercise the real HTTP handler methods without loading native/game modules.

The handler and tutorial guards are compiled directly from server.py. Requests
use in-memory bodies and response capture; all engine/filesystem boundaries are
stubbed. Session file cleanup itself is covered by test_tutorial.py.
"""
import ast
import contextlib
import io
import json
import mimetypes
import re
import secrets
import shutil
import sys
import tempfile
import threading
import time
import traceback
import types
import unittest
from email.message import Message
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

KIT = Path(__file__).resolve().parents[1]
SOURCE = KIT / 'editor/server.py'
SCRIPT = 'deusedix_tutorial'
MAP = '00_DeusEdix_Tutorial'
TAG_VALIDATION = types.ModuleType('route_tag_validation')
exec(compile((KIT / 'editor/object_tags.py').read_text(), 'object_tags.py', 'exec'), TAG_VALIDATION.__dict__)


class SessionStore:
    MAP = MAP

    def __init__(self, events):
        self.events, self.active, self.serial = events, 'session-A', 0
        self.enabled = True

    def available(self):
        return self.enabled

    def published_edits(self):
        return {'groups': {'authored_platform': {'scale': [.65, .3, .2]}}}

    @staticmethod
    def is_script(value):
        return value == SCRIPT

    @staticmethod
    def is_map(value):
        return value == MAP

    @staticmethod
    def play_start():
        return dict(at=[-120, -170, 48], yaw=0, pitch=0)

    def active_session(self):
        return self.active

    def require_session(self, token):
        if not isinstance(token, str) or not self.active or not secrets.compare_digest(token, self.active):
            raise ValueError('This training session has ended.')
        return self.active

    def prepare_runtime(self):
        self.events.append('prepare_runtime')
        return True

    def start(self, build, session=None):
        if session:
            self.require_session(session)
        else:
            self.serial += 1
            self.active = f'fresh-{self.serial}'
            self.events.append('fresh')
        return {'session': self.active, 'fresh': not bool(session), 'script': SCRIPT, 'map': MAP}

    def end(self, session):
        if not session or session != self.active:
            return {'closed': False}
        self.events.append('end')
        self.active = None
        return {'closed': True}

    def reset(self, session=None):
        self.require_session(session)
        return self.end(session)

    def cache_scene(self, session):
        self.require_session(session)
        self.events.append('cache_scene')


class TutorialRouteTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        temporary = tempfile.TemporaryDirectory(prefix='tutorial-routes-', dir=Path(__file__).parent)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / 'out').mkdir()
        (self.root / 'out' / (MAP + '.dx')).write_bytes(b'fresh tutorial build')
        self.session = SessionStore(self.events)
        self.game = False
        self.project = types.SimpleNamespace(
            WORKER=True, authorized=Mock(return_value=True), operation=contextlib.nullcontext,
            error_payload=lambda exc: {'error': str(exc)},
            ensure_runtime=Mock(side_effect=lambda: self.events.append('ensure_runtime')),
            current=lambda: {'id': 'training', 'kind': 'tutorial'},
        )
        self.workspace = types.SimpleNamespace(
            needs_build=Mock(return_value=True),
            build=Mock(side_effect=lambda: (self.events.append('runtime_build') or True, [])),
            install=Mock(side_effect=lambda: (self.events.append('runtime_install') or True, [])),
        )
        self.edits = Mock()
        self.atomicfile = types.SimpleNamespace(write_json=Mock(side_effect=lambda *args, **kwargs: self.events.append('write_edits')))
        self.story = types.SimpleNamespace(save=Mock(), voiced_lines=Mock(return_value=[]))
        self.textures = types.SimpleNamespace(import_png=Mock(return_value={'png': 'paint.png'}))
        self.data = types.SimpleNamespace(
            OUT=self.root / 'out', prepare=Mock(side_effect=lambda *a, **k: self.events.append('prepare')),
            palette_meshes=Mock(), actors=Mock(return_value=[]), structures=Mock(return_value=[]), palette=Mock(return_value=[]), object_tags=Mock(return_value={}),
        )
        self.play = types.SimpleNamespace(
            pending_install=Mock(return_value=True), flags_text=Mock(return_value=''),
            start=Mock(side_effect=lambda *a, **k: self.events.append('play') or 'started'),
        )
        self.namespace = {
            '__name__': 'tutorial_routes_fixture', 'BaseHTTPRequestHandler': BaseHTTPRequestHandler,
            'json': json, 'mimetypes': mimetypes, 're': re, 'threading': threading, 'time': time, 'shutil': shutil,
            'traceback': traceback, 'parse_qs': parse_qs, 'urlparse': urlparse,
            'LOCK': threading.RLock(), 'PLAY': {'active': False}, 'LIVE': {'active': False},
            'PREVIEW': {'token': None, 'script': None},
            'tutorial': self.session, 'project_server': self.project,
            'settings': types.SimpleNamespace(PROJECT=self.root, STANDALONE=True, PACKAGE='DXP_training', MODELS_PACKAGE='DXP_trainingModels',
                                              TARGET='revision', GAME_NAME='Deus Ex: Revision', FEATURES=frozenset()),
            'game_running': lambda: self.game,
            'data': self.data, 'story': self.story, 'textures': self.textures, 'play': self.play,
            'dxmaps': types.SimpleNamespace(built_current=Mock(return_value=True)),
            'is_dx': lambda script: False,
            'map_of': lambda script: MAP if script == SCRIPT else '01_MyRoom',
            'edits_path': lambda script: self.edits,
            'load_edits': lambda script: {},
            'require_player_start': Mock(),
            'build': Mock(side_effect=lambda script, *args: (self.events.append('build') or True, [])),
            'view': Mock(side_effect=lambda *a: (self.events.append('view') or '/shot.png', 'ready')),
            'install_map': Mock(side_effect=lambda *a: (self.events.append('map_install') or True, [])),
            'activation': types.SimpleNamespace(names=Mock()),
            'surfaces': types.SimpleNamespace(commands=Mock()),
            'documents': types.SimpleNamespace(validate=Mock()),
            'maplinks': types.SimpleNamespace(validate_travel=Mock()),
            'sounds': types.SimpleNamespace(rekey=Mock(return_value=[])),
        }
        tree = ast.parse(SOURCE.read_text(encoding='utf-8-sig'), filename=str(SOURCE))
        names = {'Handler', 'tutorial_write_guard', 'tutorial_can_reset', 'tutorial_runtime'}
        # Execute the production tag-validator import too. Injecting a fake global
        # here previously concealed a missing import that broke every real save.
        selected = ast.Module(body=[node for node in tree.body if
            (isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names) or
            (isinstance(node, ast.Import) and any(alias.name == 'object_tags' for alias in node.names))], type_ignores=[])
        with patch.dict(sys.modules, {'object_tags': TAG_VALIDATION}):
            exec(compile(selected, str(SOURCE), 'exec'), self.namespace)
        self.Handler = self.namespace['Handler']
        module_patch = patch.dict(sys.modules, {
            'atomicfile': self.atomicfile,
            'tutorial': self.session, 'workspace': self.workspace,
            'originalstory': types.SimpleNamespace(validate=Mock()),
        })
        module_patch.start()
        self.addCleanup(module_patch.stop)

    def request(self, path, body=None, token=None, method='POST'):
        raw = json.dumps(body if body is not None else {}).encode('utf-8')
        handler = object.__new__(self.Handler)
        handler.path = path
        handler.headers = Message()
        handler.headers['Content-Length'] = str(len(raw))
        if token is not None:
            handler.headers['X-DeusEdix-Tutorial'] = token
        handler.rfile = io.BytesIO(raw)
        response = []
        handler._send = lambda code, payload, *args: response.append((code, payload))
        getattr(handler, 'do_' + method)()
        self.assertEqual(len(response), 1, response)
        return response[0]

    def test_play_without_player_start_is_rejected_before_build_or_launch(self):
        self.namespace['require_player_start'].side_effect = ValueError('No enabled Player start')
        code, result = self.request(f'/api/play?script={SCRIPT}', token='session-A')
        self.assertEqual(code, 409, result)
        self.assertIn('Player start', result['error'])
        self.assertEqual(self.events, [])
        self.play.start.assert_not_called()

    def test_missing_and_stale_tokens_block_map_writes_before_runtime_or_file_changes(self):
        for route in ('edits', 'story', 'story_apply', 'texture_import', 'build', 'gamecons/copy'):
            for token in (None, 'old-session'):
                with self.subTest(route=route, token=token):
                    self.events.clear()
                    code, result = self.request(f'/api/{route}?script={SCRIPT}', token=token)
                    self.assertEqual(code, 409, result)
                    self.assertEqual(self.events, [])
        self.atomicfile.write_json.assert_not_called()
        self.story.save.assert_not_called()
        self.textures.import_png.assert_not_called()
        self.namespace['build'].assert_not_called()

    def test_map_identity_guard_and_token_only_guard_reject_late_asset_requests(self):
        for url, token in ((f'/api/dub?map={MAP}', None), ('/api/texture_library', 'old-session')):
            code, result = self.request(url, token=token)
            self.assertEqual(code, 409, result)
            self.assertEqual(self.events, [])

    def test_active_session_can_edit_story_import_texture_and_rebuild(self):
        for route, body in (('edits', {'moved': {'Crate0': [1, 2, 3]}}), ('story', {'dialogues': []}),
                            ('texture_import', {'png': 'fixture'}), ('build', {})):
            with self.subTest(route=route):
                code, result = self.request(f'/api/{route}?script={SCRIPT}', body, token='session-A')
                self.assertEqual(code, 200, result)
        self.atomicfile.write_json.assert_called_once()
        self.story.save.assert_called_once_with(MAP, {'dialogues': []})
        self.textures.import_png.assert_called_once()
        self.namespace['build'].assert_called_once_with(SCRIPT, {})

    def test_bad_scripting_tag_is_rejected_before_any_write(self):
        code, result = self.request('/api/edits?script=my_room', {'objectTags': {'Anna': {'mode':'manual','value':'x|off'}}})
        self.assertEqual(code, 400, result)
        self.atomicfile.write_json.assert_not_called()

    def test_player_start_saves_without_a_tag_or_jc_link(self):
        self.assertIs(self.namespace.get('object_tags'), TAG_VALIDATION)
        self.assertNotIn('links', self.namespace)
        body = {'added': [{'name': 'UCEdit4', 'cls': 'PlayerStart', 'loc': [-8, -32, 40.5]}]}
        code, result = self.request(f'/api/edits?script={SCRIPT}', body, token='session-A')
        self.assertEqual(code, 200, result)
        self.atomicfile.write_json.assert_called_once_with(self.edits, body)

    def test_ordinary_maps_keep_saving_without_a_tutorial_token(self):
        code, result = self.request('/api/edits?script=my_room', {'moved': {}})
        self.assertEqual(code, 200, result)
        self.assertEqual(self.events, ['ensure_runtime', 'write_edits'])

    def test_late_save_after_close_cannot_recreate_the_exercise(self):
        self.assertEqual(self.request('/api/tutorial_end', {'session': 'session-A'})[0], 200)
        self.events.clear()
        code, result = self.request(f'/api/edits?script={SCRIPT}', token='session-A')
        self.assertEqual(code, 409, result)
        self.assertEqual(self.events, [])

    def test_late_end_of_a_cannot_close_b_or_block_on_b_running_game(self):
        self.session.active = 'session-B'
        self.game = True
        code, result = self.request('/api/tutorial_end', {'session': 'session-A'}, token='session-A')
        self.assertEqual((code, result), (200, {'closed': False}))
        self.assertEqual(self.session.active, 'session-B')
        self.assertEqual(self.events, [])

    def test_end_and_reset_current_session_refuse_while_game_or_preview_is_open(self):
        for mode in ('game', 'PLAY', 'LIVE'):
            for route in ('tutorial_end', 'tutorial_reset'):
                with self.subTest(mode=mode, route=route):
                    self.game = mode == 'game'
                    self.namespace['PLAY']['active'] = mode == 'PLAY'
                    self.namespace['LIVE']['active'] = mode == 'LIVE'
                    code, result = self.request('/api/' + route, {'session': 'session-A'})
                    self.assertEqual(code, 409, result)
                    self.assertEqual(self.session.active, 'session-A')
                    self.assertEqual(self.events, [])

    def test_fresh_start_is_blocked_in_game_but_existing_session_can_resume(self):
        self.game = True
        code, result = self.request('/api/tutorial_start')
        self.assertEqual(code, 409, result)
        self.assertEqual(self.session.active, 'session-A')
        self.assertEqual(self.events, [])
        code, result = self.request('/api/tutorial_start', {'session': 'session-A'})
        self.assertEqual(code, 200, result)
        self.assertEqual(result['session'], 'session-A')
        self.assertFalse(result['fresh'])

    def test_stock_runtime_is_prepared_before_initial_compile_only(self):
        code, result = self.request('/api/tutorial_start')
        self.assertEqual(code, 200, result)
        self.assertEqual(self.events, ['prepare_runtime', 'ensure_runtime', 'fresh'])
        self.events.clear()
        code, result = self.request('/api/tutorial_start', {'session': result['session']})
        self.assertEqual(code, 200, result)
        self.assertNotIn('prepare_runtime', self.events)

    def test_stale_start_cannot_initialize_the_runtime(self):
        code, result = self.request('/api/tutorial_start', {'session': 'old-session'})
        self.assertEqual(code, 409, result)
        self.assertEqual(self.session.active, 'session-A')
        self.assertEqual(self.events, [])

    def test_scene_direct_open_starts_clean_and_rebuild_reuses_the_session(self):
        code, first = self.request(f'/api/scene?script={SCRIPT}', method='GET')
        self.assertEqual(code, 200, first)
        self.assertEqual(first['publishedLayout'], self.session.published_edits())
        self.assertEqual(self.events, ['ensure_runtime', 'fresh', 'prepare', 'cache_scene'])
        self.events.clear()
        self.game = True
        code, second = self.request(f'/api/scene?script={SCRIPT}', token=first['tutorialSession'], method='GET')
        self.assertEqual(code, 200, second)
        self.assertEqual(second['tutorialSession'], first['tutorialSession'])
        self.assertNotIn('fresh', self.events)

    def test_stale_scene_token_and_direct_open_while_playing_do_not_prepare_or_reset(self):
        for token, game in (('old-session', False), (None, True)):
            with self.subTest(token=token, game=game):
                self.game = game
                code, result = self.request(f'/api/scene?script={SCRIPT}', token=token, method='GET')
                self.assertEqual(code, 409, result)
                self.assertEqual(self.session.active, 'session-A')
                self.data.prepare.assert_not_called()
                self.assertEqual(self.events, [])

    def test_ordinary_scene_does_not_start_or_inherit_a_training_session(self):
        code, result = self.request('/api/scene?script=my_room', method='GET')
        self.assertEqual(code, 200, result)
        self.assertIsNone(result['tutorialSession'])
        self.assertIsNone(result['publishedLayout'])
        self.assertEqual(self.session.active, 'session-A')
        self.assertEqual(self.events, ['ensure_runtime', 'prepare'])

    def test_custom_map_named_like_tutorial_is_not_treated_as_an_exercise(self):
        self.session.enabled = False
        code, result = self.request(f'/api/edits?script={SCRIPT}', {'moved': {}})
        self.assertEqual(code, 200, result)
        code, result = self.request(f'/api/scene?script={SCRIPT}', method='GET')
        self.assertEqual(code, 200, result)
        self.assertIsNone(result['tutorialSession'])
        self.assertIsNone(result['publishedLayout'])
        code, result = self.request(f'/api/install?script={SCRIPT}')
        self.assertEqual(code, 200, result)
        self.assertTrue(result['ok'])
        self.namespace['install_map'].assert_called_once_with(SCRIPT)
        self.workspace.build.assert_not_called()
        self.assertNotIn('fresh', self.events)

    def test_tutorial_play_always_uses_reception_and_fresh_mission_state(self):
        for mode in ('embedded', 'external'):
            code, result = self.request(f'/api/play?script={SCRIPT}', {
                'at': [9000, -4000, 900], 'yaw': 12345, 'pitch': -400,
                'setup': 'UCDbgOtherMission', 'flags': 'SkipTutorial=1', 'route': True,
                'displayMode': mode}, token='session-A')
            self.assertEqual(code, 200, result)
            self.assertEqual(self.play.start.call_args.args[1:6], ([-120, -170, 48], 0, 0, '', ''))
            self.assertEqual(self.play.start.call_args.kwargs['display_mode'], mode)
            self.play.flags_text.assert_called_with(False, '')

    def test_other_project_play_keeps_its_camera_and_flags(self):
        self.session.enabled = False
        code, result = self.request('/api/play?script=my_room', {
            'at': [100, 200, 300], 'yaw': 42, 'pitch': -50, 'setup': 'MySetup',
            'route': True, 'flags': 'MyFlag=1'})
        self.assertEqual(code, 200, result)
        self.assertEqual(self.play.start.call_args.args[1:5], ([100, 200, 300], 42, -50, 'MySetup'))
        self.play.flags_text.assert_called_with(True, 'MyFlag=1')

    def test_play_updates_stock_runtime_and_installed_map_before_launch(self):
        code, result = self.request(f'/api/play?script={SCRIPT}', {'install': True}, token='session-A')
        self.assertEqual(code, 200, result)
        self.assertTrue(result['ok'])
        self.assertEqual(self.events, ['ensure_runtime', 'runtime_build', 'runtime_install', 'map_install', 'play'])
        self.assertTrue(self.namespace['PLAY']['active'])

    def test_view_updates_stock_runtime_before_preview(self):
        code, result = self.request(f'/api/view?script={SCRIPT}', token='session-A')
        self.assertEqual(code, 200, result)
        self.assertEqual(self.events, ['ensure_runtime', 'runtime_build', 'runtime_install', 'view'])

    def test_tutorial_play_installs_its_current_map_even_without_regular_install_checkbox(self):
        self.workspace.needs_build.return_value = False
        def install():
            self.assertEqual((self.root / 'maps' / (MAP + '.dx')).read_bytes(), b'fresh tutorial build')
            self.events.append('runtime_install')
            return True, []
        self.workspace.install.side_effect = install
        code, result = self.request(f'/api/play?script={SCRIPT}', {'install': False}, token='session-A')
        self.assertEqual(code, 200, result)
        self.assertTrue(result['ok'])
        self.assertEqual(self.events, ['ensure_runtime', 'runtime_install', 'play'])
        self.namespace['install_map'].assert_not_called()

    def test_failed_runtime_compile_cannot_install_or_launch(self):
        self.workspace.build.side_effect = None
        self.workspace.build.return_value = False, ['compile failure']
        code, result = self.request(f'/api/play?script={SCRIPT}', {'install': True}, token='session-A')
        self.assertEqual(code, 409, result)
        self.assertIn('compile failure', result['error'])
        self.workspace.install.assert_not_called()
        self.namespace['install_map'].assert_not_called()
        self.play.start.assert_not_called()
        self.assertFalse(self.namespace['PLAY']['active'])

    def test_manual_install_refuses_tutorial_but_preserves_normal_maps(self):
        code, result = self.request(f'/api/install?script={SCRIPT}', token='session-A')
        self.assertEqual(code, 200, result)
        self.assertFalse(result['ok'])
        self.namespace['install_map'].assert_not_called()
        code, result = self.request('/api/install?script=my_room')
        self.assertEqual(code, 200, result)
        self.assertTrue(result['ok'])
        self.namespace['install_map'].assert_called_once_with('my_room')

    def test_wrong_project_session_blocks_tutorial_operations_too(self):
        self.project.authorized.return_value = False
        for method, path in (('POST', '/api/tutorial_start'), ('POST', '/api/tutorial_end'), ('GET', f'/api/scene?script={SCRIPT}')):
            code, result = self.request(path, {'session': 'session-A'}, method=method)
            self.assertEqual(code, 409, result)
        self.assertEqual(self.events, [])
        self.assertEqual(self.session.active, 'session-A')


if __name__ == '__main__':
    unittest.main()

