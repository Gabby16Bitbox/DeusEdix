"""HTTP lifecycle: prepare without installing maps, stale tokens, safe cleanup."""
import ast
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import test_tutorial_routes as routes
import test_play_launch_copies as launch_copies      # a Play's fake game with live itself (StopTests)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'editor'))
import kit  # noqa: E402
import play_prepare  # noqa: E402        (the steps a preparation leaves out: test_play_prepare)
import rebuild as rebuild_options  # noqa: E402


class PlayRoutes(unittest.TestCase):
    request = routes.TutorialRouteTests.request

    def setUp(self):
        routes.TutorialRouteTests.setUp(self)
        self.session.enabled = False
        self.live_state = dict(owned=False, running=False, launching=False, token='owned-game', error='')
        self.live = types.SimpleNamespace(session_status=lambda: dict(self.live_state), stop=Mock(return_value='stopped'))
        self.preview = types.SimpleNamespace(restore=Mock(return_value=[]), stage=Mock(return_value=['staged']))
        self.workspace.needs_build.return_value = False
        self.workspace.install.side_effect = lambda **kwargs: (True, ['runtime only'])
        self.story.write_all = Mock(return_value=[])
        self.players = []               # a map's player character (player_profiles.blocks)
        # player_profiles.blocks as the real one decides: the player character only for edits that name one (level
        # player; no players.json here), so a route that hands it other edits than the map's is seen (re-test 4 of 31
        # Oct 2026, #6); the real load_edits (below) reads the map's edits
        blocks = lambda edits: list(self.players) if (edits.get('level') or {}).get('player') else []
        self.namespace.update(play_preview=self.preview, run_ps=Mock(return_value=(True, [])), play_prepare=play_prepare,
                              map_source=lambda script: self.root / (script + '.py'), rebuild_options=rebuild_options,
                              player_profiles=types.SimpleNamespace(blocks=blocks, validate_edits=Mock()))
        tree = ast.parse(routes.SOURCE.read_text(encoding='utf-8-sig'))
        selected = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)
                                   and n.name in ('prepare_play', 'play_session_status', 'rebuild', 'play_files',
                                                  'compile_for_player', 'load_edits')],
                              type_ignores=[])
        exec(compile(selected, str(routes.SOURCE), 'exec'), self.namespace)
        p = patch.dict('sys.modules', {'live': self.live}); p.start(); self.addCleanup(p.stop)
        # the preparation's records and what they are made from, in this test's folder (test_play_prepare)
        game = self.root / 'game'
        p = patch.multiple(play_prepare, KIT=self.root, RECORD=self.root / 'out' / '.play-prepare.json', workspace=self.workspace,
                           settings=types.SimpleNamespace(PROJECT_ID='p1', TARGET='revision', GAME=game, PROJECT=self.root,
                                                          PACKAGE='P', MAPS_DIR=game / 'Mine', GAME_SYSTEM=game / 'System',
                                                          STANDALONE=True),
                           data=types.SimpleNamespace(OUT=self.root / 'out', CACHE=self.root / 'cache', GAME_CACHE=game / 'cache'),
                           kit=types.SimpleNamespace(extra_packages=lambda: [], PACKAGES_FILE=self.root / 'packages.json',
                                                     LINKED=play_prepare.kit.LINKED, Stopped=kit.Stopped),
                           player_profiles=types.SimpleNamespace(FILE=self.root / 'players.json'), create=True)
        p.start(); self.addCleanup(p.stop)
        self.workspace.SYS, self.workspace.STAMP, self.workspace.DIST = self.root / 'System', self.root / 'workspace.json', self.root / 'dist'
        self.workspace.GAME_FILES = ('DeusEdixNav.u', 'DeusEdixNav.dll')
        self.namespace['edits_path'] = lambda script: self.root / (script + '.edits.json')
        # what a map's build loads (play_prepare._loaded: preview_bundle.dependencies, with the kit itself): this test's
        p = patch.multiple(kit, DEV=self.root / 'System', PROJECT=self.root, PACKAGES_FILE=self.root / 'packages.json')
        p.start(); self.addCleanup(p.stop)
        (self.root / 'System').mkdir(exist_ok=True)
        (self.root / 'System' / 'DeusEx.ini').write_text('[Core.System]\r\n[Editor.EditorEngine]\r\n', encoding='latin1')

        def build(script, options=None, watch=None):
            self.events.append('build')
            (self.root / 'out' / '01_MyRoom.dx').write_bytes(b'built in mode %r' % (options or {}).get('mode'))
            return True, ['built 01_MyRoom']
        self.namespace['build'].side_effect = build

    def test_prepare_builds_without_installing_project_maps_or_committing_edits(self):
        code, result = self.request('/api/play_prepare?script=my_room', {})
        self.assertEqual(code, 200, result)
        self.assertTrue(result['token'])
        self.workspace.install.assert_called_once_with(maps=False, activate_project=False)
        self.namespace['install_map'].assert_not_called()
        self.preview.stage.assert_called_once_with(self.data.OUT / '01_MyRoom.dx', '01_MyRoom')
        self.assertFalse(self.namespace['PLAY']['active'])

    def test_a_second_prepare_of_an_unchanged_map_does_not_build_or_install_again(self):
        """startup2 (30 Oct 2026): the map's build and the packages' install are left out when nothing they are made from
        changed since they last succeeded (play_prepare), and the lines say so; the Play copy is staged every time."""
        _, first = self.request('/api/play_prepare?script=my_room')
        code, second = self.request('/api/play_prepare?script=my_room')
        self.assertEqual(code, 200, second)
        self.assertTrue(second['ok'] and second['token'])
        self.assertEqual(self.events.count('build'), 1)
        self.workspace.install.assert_called_once_with(maps=False, activate_project=False)
        self.assertIn('Map unchanged since the last Play: not rebuilt.', second['lines'])
        self.assertIn('Packages unchanged since the last Play: not installed again.', second['lines'])
        self.assertEqual(self.preview.stage.call_count, 2)
        self.assertEqual(second['lines'][-1], 'staged')
        (self.root / 'out' / '01_MyRoom.dx').write_bytes(b'objects only')        # the map's build changed since (another tool)
        self.request('/api/play_prepare?script=my_room')
        self.assertEqual(self.events.count('build'), 2)

    def test_prepared_launch_consumes_token_and_does_not_install_again(self):
        _, prepared = self.request('/api/play_prepare?script=my_room')
        self.workspace.install.reset_mock()
        code, result = self.request('/api/play?script=my_room', {'previewToken': prepared['token']})
        self.assertEqual(code, 200, result)
        self.assertTrue(result['ok'])
        self.workspace.install.assert_not_called()
        self.namespace['install_map'].assert_not_called()
        self.assertIsNone(self.namespace['PREVIEW']['token'])

    def test_a_preparation_and_its_play_check_the_player_start_once_each(self):
        """The route checks the map's Player start before anything else (do_POST); prepare_play and /api/play do not
        check it again (fix-back2, 30 Oct 2026: twice for a preparation and twice for its Play, about 0.1 s each)."""
        check = self.namespace['require_player_start']
        _, prepared = self.request('/api/play_prepare?script=my_room')
        self.assertEqual(check.call_count, 1)
        code, result = self.request('/api/play?script=my_room', {'previewToken': prepared['token']})
        self.assertEqual(code, 200, result)
        self.assertEqual(check.call_count, 2)

    def test_a_rebuild_in_any_mode_spares_the_next_play_its_build(self):
        """server.rebuild, the page's Rebuild (build_job), in any mode, leaves the map's record of Play's preparation
        (play_prepare.rebuilt), so the next Play stages the map the editor shows without building it again: a forced mode
        only adds stages to what the edits need (fix-back2, 30 Oct 2026; game re-test #2: a Rebuild in Lighting was
        built again by the next Play, in Automatic, without its lighting)."""
        rebuild = self.namespace['rebuild']
        for mode in ('auto', 'lighting', 'full'):
            with self.subTest(mode):
                built = self.events.count('build')
                self.assertTrue(rebuild('my_room', {'mode': mode}, watch=None)[0])
                _, prepared = self.request('/api/play_prepare?script=my_room')
                self.assertTrue(prepared['ok'], prepared)
                self.assertEqual(self.events.count('build'), built + 1, "the Rebuild stood for the Play's build")
                self.assertIn('Map unchanged since the last Play: not rebuilt.', prepared['lines'])
                self.assertEqual((self.root / 'out' / '01_MyRoom.dx').read_bytes(), b'built in mode %r' % mode)

    def test_a_play_after_a_forced_rebuild_and_a_change_builds_in_that_mode(self):
        """server.prepare_play builds the map in the mode its record keeps (play_prepare.rebuilt): after a Rebuild in
        Lighting and an edit, Play's build is in Lighting and its lines say so (re-test 3 of 31 Oct 2026, #1)."""
        self.assertTrue(self.namespace['rebuild']('my_room', {'mode': 'lighting'}, watch=None)[0])
        (self.root / 'my_room.edits.json').write_text('{"moved": {}}', encoding='utf-8')
        _, prepared = self.request('/api/play_prepare?script=my_room')
        self.assertTrue(prepared['ok'], prepared)
        self.assertEqual(self.events.count('build'), 2)
        self.assertEqual((self.root / 'out' / '01_MyRoom.dx').read_bytes(), b"built in mode 'lighting'")
        self.assertIn('Rebuilding the map in Lighting, the mode of its last Rebuild (a Rebuild in Automatic goes back '
                      'to the usual build).', prepared['lines'])

    def test_a_cancelled_rebuild_leaves_the_maps_record_for_the_next_play(self):
        """server.rebuild hands play_prepare.rebuilt its job's settle(): a Rebuild cancelled while it built (the job
        puts the map's earlier output back) leaves the map's record as it was, so the next Play of the unchanged map
        does not build it, nor in the cancelled Rebuild's mode (cross-check of 31 Oct 2026: a cancelled Lighting Rebuild
        made every Play that built the map build it in Lighting)."""
        output = self.root / 'out' / '01_MyRoom.dx'
        self.request('/api/play_prepare?script=my_room')
        kept = output.read_bytes()
        job = types.SimpleNamespace(settle=Mock(return_value=True))   # cancelled while it built
        self.namespace['build'].side_effect = lambda script, options=None, watch=None: (
            self.events.append('build'), output.write_bytes(b'half a lighting build'), (False, ['stopped']))[-1]
        self.assertFalse(self.namespace['rebuild']('my_room', {'mode': 'lighting'}, watch=job)[0])
        job.settle.assert_called_once_with()
        output.write_bytes(kept)                                      # build_job.put_back
        _, prepared = self.request('/api/play_prepare?script=my_room')
        self.assertTrue(prepared['ok'], prepared)
        self.assertEqual(self.events.count('build'), 2, 'not built by the Play')
        self.assertIn('Map unchanged since the last Play: not rebuilt.', prepared['lines'])

    def test_a_rebuild_compiles_a_player_characters_package_before_its_record(self):
        """A map with a player character: server.rebuild has the package compiled (compile_for_player) before
        play_prepare.rebuilt reads what the map is made from, so the compile in build() is left out and the next Play
        finds the map as recorded; with the game open it refuses (re-test 3 of 31 Oct 2026, #2). The player character
        is the map's own (its edits' level player), which server.rebuild must read (re-test 4, #6)."""
        self.players = [dict(cls='UCPlayerMap', name='UCPlayerMap0', loc=[0, 0, 0], props={})]
        (self.root / 'my_room.edits.json').write_text(json.dumps({'level': {'player': 'hero'}}), encoding='utf-8')
        self.namespace['run_ps'].side_effect = lambda *args: (self.events.append('compile ' + args[0]) or True, [])
        real = play_prepare.rebuilt
        with patch.object(play_prepare, 'rebuilt', lambda *a, **k: self.events.append('rebuilt') or real(*a, **k)):
            self.assertTrue(self.namespace['rebuild']('my_room', {'mode': 'auto'}, watch=None)[0])
            self.assertEqual(self.events, ['rebuilt', 'build'], 'the package current: not compiled')
            self.events.clear()
            self.workspace.needs_build.return_value = True
            self.game = True
            self.assertEqual(self.namespace['rebuild']('my_room', {'mode': 'auto'}, watch=None),
                             (False, ['Close the game before rebuilding player characters.']))
            self.assertEqual(self.events, [])
            self.game = False
            self.assertTrue(self.namespace['rebuild']('my_room', {'mode': 'auto'}, watch=None)[0])
        self.assertEqual(self.events, ['compile build.ps1', 'rebuilt', 'build'])

    def test_a_build_compiles_a_player_characters_package_through_its_record(self):
        """server.build, every map build's (Play's, a Rebuild's, the route's): a map with a player character has the
        package compiled first through compile_for_player (play_prepare.compile_step), never by its own check of the
        workspace (re-test 3 of 31 Oct 2026, #2). The player character is the map's own (its edits' level player),
        which server.build must read (re-test 4, #6)."""
        tree = ast.parse(routes.SOURCE.read_text(encoding='utf-8-sig'))
        exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'build'],
                                type_ignores=[]), str(routes.SOURCE), 'exec'), self.namespace)
        dx = self.namespace['dxmaps']
        dx.build = Mock(return_value=(False, ['stopped before the host']))
        self.namespace.update(is_dx=lambda script: True, prefab_snapshot=types.SimpleNamespace(source_state=Mock()),
                              map_source=lambda script: self.root / (script + '.dx'))
        self.players = [dict(cls='UCPlayerMap', name='UCPlayerMap0', loc=[0, 0, 0], props={})]
        (self.root / 'my_room.edits.json').write_text(json.dumps({'level': {'player': 'hero'}}), encoding='utf-8')
        self.namespace['run_ps'].side_effect = lambda *args: (self.events.append('compile ' + args[0]) or True, [])
        compile_step = Mock(side_effect=play_prepare.compile_step)
        with patch.object(play_prepare, 'compile_step', compile_step):
            self.assertFalse(self.namespace['build']('my_room')[0])
            self.assertEqual((self.events, compile_step.call_count, dx.build.call_count), ([], 1, 1),
                             'the package current: not compiled')
            self.workspace.needs_build.return_value = True
            self.game = True
            self.assertEqual(self.namespace['build']('my_room'),
                             (False, ['Close the game before rebuilding player characters.']))
            self.assertEqual(dx.build.call_count, 1, 'no build')
            self.game = False
            self.namespace['build']('my_room')
        self.assertEqual((self.events, compile_step.call_count, dx.build.call_count), (['compile build.ps1'], 3, 2))

    def test_an_authored_maps_installed_copy_is_one_of_its_files(self):
        """play_files: a .dx map edited from its private copy (dxmaps.source: an authoring record) is built from that
        copy and checks the copy installed in the project (source() refuses one changed outside DeusEdix), so that copy
        is one of the files its record hashes, by content; a map whose source is the installed copy, or a script, has
        its own two. No record counts the project's other maps (re-test 4 of 31 Oct 2026, #2: Install of another map
        built every unchanged map again at its next Play)."""
        project = play_prepare.settings.PROJECT = self.root / 'project'         # the kit's maps are not the project's
        maps = self.namespace['dxmaps'].MOD_MAPS = project / 'maps'
        private, installed = maps / '.authoring' / '01_MyRoom.dx', maps / '01_MyRoom.dx'
        edits = self.root / 'my_room.edits.json'
        for path in (private, installed):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'the map')
        play_files = self.namespace['play_files']
        self.namespace.update(is_dx=lambda script: True, map_source=lambda script: private)
        self.assertEqual(play_files('my_room'), [private, edits, installed])
        for change, builds in ((None, 1), (None, 1), (lambda: (maps / '02_Other.dx').write_bytes(b'another map'), 1),
                               (lambda: installed.write_bytes(b'installed again'), 2)):
            if change:
                change()
            self.assertTrue(self.request('/api/play_prepare?script=my_room')[1]['ok'])
            self.assertEqual(self.events.count('build'), builds)
        self.namespace['map_source'] = lambda script: installed
        self.assertEqual(play_files('my_room'), [installed, edits])
        installed.unlink()                              # an original map edited with no copy in the project
        self.namespace['map_source'] = lambda script: self.root / 'game' / '01_MyRoom.dx'
        self.assertEqual(play_files('my_room'), [self.root / 'game' / '01_MyRoom.dx', edits])
        self.namespace.update(is_dx=lambda script: False, map_source=lambda script: self.root / 'my_room.py')
        self.assertEqual(play_files('my_room'), [self.root / 'my_room.py', edits])

    def test_story_apply_records_its_compile_in_a_working_copy(self):
        """Story > Apply's build.ps1 goes through play_prepare.recompiled: in a development working copy its compile is
        recorded, so the next Play does not compile the same sources again (re-test 3 of 31 Oct 2026, #2)."""
        play_prepare.settings.STANDALONE, play_prepare.settings.VOICES_PACKAGE = False, 'PVoices'
        for name, value in (('host_files', lambda: []), ('native_files', lambda: []), ('editor_packages', lambda: ())):
            setattr(play_prepare.kit, name, value)
        code, result = self.request('/api/story_apply?script=my_room', {})
        self.assertEqual(code, 200, result)
        self.assertTrue(result['ok'], result)
        self.namespace['run_ps'].assert_any_call('build.ps1', '-Isolated')
        self.assertIn('compile', json.loads(play_prepare.RECORD.read_text(encoding='utf-8')))

    def test_stale_or_wrong_map_preparation_cannot_launch(self):
        _, prepared = self.request('/api/play_prepare?script=my_room')
        for script, token in [('my_room', 'stale'), ('other', prepared['token'])]:
            code, _ = self.request('/api/play?script=' + script, {'previewToken': token})
            self.assertEqual(code, 409)
        self.play.start.assert_not_called()

    def test_preparation_refuses_an_external_game(self):
        self.game = True
        code, _ = self.request('/api/play_prepare?script=my_room')
        self.assertEqual(code, 409)
        self.preview.restore.assert_not_called()
        self.workspace.install.assert_not_called()

    def test_stale_stop_token_does_not_stop_replacement(self):
        code, _ = self.request('/api/live_stop', {'token': 'old-game'})
        self.assertEqual(code, 409)
        self.live.stop.assert_not_called()
        self.preview.restore.assert_not_called()

    def test_stop_during_delayed_steam_launch_does_not_restore_map(self):
        self.live_state.update(owned=True, launching=True)
        code, result = self.request('/api/live_stop', {'token': 'owned-game'})
        self.assertEqual(code, 200, result)
        self.assertTrue(result['session']['launching'])
        self.preview.restore.assert_not_called()
        self.project.ensure_runtime.assert_not_called()

    def test_stop_restores_only_after_process_exit(self):
        self.namespace['PLAY']['active'] = True
        code, result = self.request('/api/live_stop', {'token': 'owned-game'})
        self.assertEqual(code, 200, result)
        self.preview.restore.assert_called_once()
        self.assertFalse(self.namespace['PLAY']['active'])

    def test_stop_restore_failure_preserves_recovery_until_retry_succeeds(self):
        self.namespace['PLAY']['active'] = True
        self.namespace['LIVE']['active'] = True
        self.preview.restore.side_effect = RuntimeError('File changed outside Play')
        code, result = self.request('/api/live_stop', {'token': 'owned-game'})
        self.assertEqual(code, 409, result)
        self.assertTrue(self.namespace['PLAY']['active'])
        self.assertTrue(self.namespace['LIVE']['active'])
        code, status = self.request('/api/play_session', method='GET')
        self.assertEqual(code, 200, status)
        self.assertIn('File changed outside Play', status['error'])
        self.assertTrue(self.namespace['PLAY']['active'])
        self.preview.restore.side_effect = None
        code, result = self.request('/api/live_stop', {'token': 'owned-game'})
        self.assertEqual(code, 200, result)
        self.assertFalse(self.namespace['PLAY']['active'])
        self.assertFalse(self.namespace['LIVE']['active'])

    def test_an_embedded_stop_first_only_asks_and_a_game_still_open_stays_as_it_is(self):
        """The Game view's embedded Stop sends {token, force: false} first (game-view.js): live.stop only asks the game
        to close; still open, it is left running in the panel, the Play still active and nothing restored, for the
        page to take it out and Stop again. Any other Stop (no force, true, null, a string) may close it from outside
        (backend.md section 4, 29 Oct 2026)."""
        self.namespace['PLAY']['active'] = True
        self.live_state.update(owned=True, running=True)
        self.live.stop.return_value = 'The game was asked to close and is still open.'
        code, result = self.request('/api/live_stop', {'token': 'owned-game', 'force': False})
        self.assertEqual(code, 200, result)
        self.live.stop.assert_called_once_with(timeout=5, force=False, ask=True)
        self.assertEqual(result['answer'], 'The game was asked to close and is still open.')
        self.assertTrue(result['session']['running'])
        self.preview.restore.assert_not_called()
        self.assertTrue(self.namespace['PLAY']['active'])
        for force in ('absent', True, None, 'false', 0):
            with self.subTest(force=force):
                self.live.stop.reset_mock()
                body = {'token': 'owned-game'} if force == 'absent' else {'token': 'owned-game', 'force': force}
                code, result = self.request('/api/live_stop', body)
                self.assertEqual(code, 200, result)
                self.live.stop.assert_called_once_with(timeout=5, force=True, ask=True)

    def test_a_stop_of_a_game_that_can_no_longer_answer_is_not_asked_first(self):
        """The Game view's Stop of a game stopped in its error box sends {token, ask: false} (game-view.js): live.stop
        does not ask it first (its console no longer runs). Only a JSON false does that; anything else asks."""
        self.namespace['PLAY']['active'] = True
        self.live_state.update(owned=True, running=True)
        code, result = self.request('/api/live_stop', {'token': 'owned-game', 'ask': False})
        self.assertEqual(code, 200, result)
        self.live.stop.assert_called_once_with(timeout=5, force=True, ask=False)
        for ask in (True, None, 'false', 0):
            with self.subTest(ask=ask):
                self.live.stop.reset_mock()
                code, result = self.request('/api/live_stop', {'token': 'owned-game', 'ask': ask})
                self.assertEqual(code, 200, result)
                self.live.stop.assert_called_once_with(timeout=5, force=True, ask=True)

    def test_a_stop_that_only_asks_asks_whatever_ask_says(self):
        """Review 2c #4: {token, force: false, ask: false} (an API client's pair; the page never sends both) only asks
        the game, as force false promises. On live.stop itself and a fake game (test_play_launch_copies.StopTests): the
        answer is STILL_OPEN, the game still runs, nothing closed it from outside and the Play is still active. Before,
        ask false skipped the asking and closed it from outside at once, which an embedded game's child window never
        gets (TerminateProcess after 3 s)."""
        game = launch_copies.StopTests('test_a_stop_that_only_asks_asks_whatever_ask_says')
        self.addCleanup(game.doCleanups)
        game.setUp()
        self.addCleanup(game.tearDown)
        game.live.EXIT_WAIT = 0.3
        self.live.stop, self.live.session_status = game.live.stop, game.live.session_status
        self.namespace['PLAY']['active'] = True
        body = {'token': game.live.session_status()['token'], 'force': False, 'ask': False}
        code, result = self.request('/api/live_stop', body)
        self.assertEqual(code, 200, result)
        self.assertEqual(result['answer'], game.live.STILL_OPEN)
        self.assertTrue(result['session']['running'])
        self.assertEqual(game.processes.closed, [])
        self.assertTrue(self.namespace['PLAY']['active'])

    def test_a_stop_asks_windows_once_whether_a_game_still_runs(self):
        """Game test 2d O2: a crashed game's Stop answered 2.00 s after the click, although the game was gone at 0.15 s
        and its cleanup done at 0.32 s: after it, the route asked game_running (a tasklist run, about 0.5 s) twice in a
        row for the same answer. Once is enough."""
        self.namespace['PLAY']['active'] = True
        running = Mock(return_value=False)
        self.namespace['game_running'] = running
        code, result = self.request('/api/live_stop', {'token': 'owned-game', 'ask': False})
        self.assertEqual(code, 200, result)
        self.assertEqual(running.call_count, 1)
        self.preview.restore.assert_called_once()
        self.assertFalse(self.namespace['PLAY']['active'])

    def test_unrelated_game_prevents_cleanup_without_being_stopped(self):
        self.game = True
        code, _ = self.request('/api/live_stop', {})
        self.assertEqual(code, 409)
        self.preview.restore.assert_not_called()

    def test_natural_exit_status_finishes_cleanup_before_unlock(self):
        self.namespace['PLAY']['active'] = True
        code, result = self.request('/api/play_session', method='GET')
        self.assertEqual(code, 200, result)
        self.assertFalse(result['running'])
        self.preview.restore.assert_called_once()
        self.assertFalse(self.namespace['PLAY']['active'])

    def test_failed_restore_keeps_session_recoverable(self):
        self.namespace['PLAY']['active'] = True
        self.preview.restore.side_effect = RuntimeError('File changed outside Play')
        code, result = self.request('/api/play_session', method='GET')
        self.assertEqual(code, 200, result)
        self.assertIn('File changed', result['error'])
        self.assertTrue(self.namespace['PLAY']['active'])

    def test_reload_can_discover_and_cancel_preparation_without_launch(self):
        _, prepared = self.request('/api/play_prepare?script=my_room')
        code, status = self.request('/api/play_session', method='GET')
        self.assertEqual(code, 200, status)
        self.assertTrue(status['prepared'])
        self.assertEqual(status['previewToken'], prepared['token'])
        code, result = self.request('/api/live_stop', {'previewToken': status['previewToken']})
        self.assertEqual(code, 200, result)
        self.assertIsNone(self.namespace['PREVIEW']['token'])
        self.play.start.assert_not_called()

    def test_stale_reload_cancel_cannot_stop_a_game_launched_by_original_page(self):
        self.namespace['PREVIEW']['token'] = 'preparation-a'
        self.live_state.update(owned=True, launching=True)
        code, _ = self.request('/api/live_stop', {'previewToken': 'preparation-a'})
        self.assertEqual(code, 409)
        self.live.stop.assert_not_called()
        self.preview.restore.assert_not_called()


if __name__ == '__main__':
    unittest.main()

