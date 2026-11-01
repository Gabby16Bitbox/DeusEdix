"""Rebuild requests must add engine work without bypassing map safeguards."""
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import dxmaps
import rebuild

# the Rebuild menu's items (the arrow of the Rebuild/Play button): a mode's item as menubar.js writes it
MENU_ITEM = r"label: '([^']+)',[^}]*?rebuild\('(\w+)'\)"


class RebuildOptionsTests(unittest.TestCase):
    def test_defaults_and_modes(self):
        self.assertEqual(rebuild.normalize(), {'mode': 'auto'})
        self.assertEqual(rebuild.normalize({}), {'mode': 'auto'})
        for mode in rebuild.MODES:
            self.assertEqual(rebuild.normalize({'mode': mode}), {'mode': mode})

    def test_invalid_options_cannot_supply_engine_commands(self):
        for options in (True, [], 'full', {'mode': None}, {'mode': 1}, {'mode': []},
                        {'mode': 'full\nMAP NEW'}, {'mode': 'geometry'}, {'balance': 15},
                        {'mode': 'full', 'command': 'MAP NEW'}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                rebuild.normalize(options)

    def test_modes_are_named_as_the_rebuild_menu_names_them(self):
        """rebuild.NAMES, the one table of the modes' names the editor's messages use (Play's line for a map built in
        its last Rebuild's mode, normalize's refusal, the build's REBUILD line), is the Rebuild menu's words for them
        (cross-check of 31 Oct 2026: Play's line said 'Paths', a name no menu uses)."""
        menu = (KIT / 'editor' / 'static' / 'menubar.js').read_text(encoding='utf-8')
        items = menu[menu.index('pair.items = ['):]
        items = items[:items.index('];')]
        named = {mode: label.split(' \u00b7 ')[0] for label, mode in re.findall(MENU_ITEM, items)}
        self.assertEqual(rebuild.NAMES, named)
        self.assertEqual(tuple(rebuild.NAMES), rebuild.MODES)
        with self.assertRaises(ValueError) as refused:
            rebuild.normalize({'mode': 'geometry'})
        self.assertEqual(str(refused.exception), 'Choose Automatic, Full, Lighting or AI paths.')

    def test_the_builds_line_for_a_forced_mode_names_it_as_the_rebuild_menu_does(self):
        """rebuild.report, a build's line for a forced mode (a script map's, which server.build puts right after Play's
        line for a map built in its last Rebuild's mode; an existing map's, dxmaps.build), names the mode by
        rebuild.NAMES, as Play's line does (re-test 4 of 31 Oct 2026, #7: 'Rebuilding the map in AI paths', then
        'requested paths stages'). Automatic adds no line."""
        for generated in (True, False):
            self.assertEqual(rebuild.report({'mode': 'auto'}, generated=generated), [])
            for mode in ('full', 'lighting', 'paths'):
                with self.subTest(mode=mode, generated=generated):
                    line, = rebuild.report({'mode': mode}, generated=generated)
                    self.assertTrue(line.startswith('  REBUILD '), line)
                    self.assertIn('a Rebuild in %s ' % rebuild.NAMES[mode], line.replace('A Rebuild', 'a Rebuild'))

    def test_automatic_keeps_baked_clean_map(self):
        self.assertEqual(rebuild.plan(), {'geometry': False, 'lights': False, 'paths': False})

    def test_full_rebuilds_clean_map_and_overrides_keep_paths(self):
        self.assertEqual(rebuild.plan({'mode': 'full'}, keep_paths=True),
                         {'geometry': True, 'lights': True, 'paths': True})

    def test_requested_stages_do_not_skip_required_work(self):
        self.assertEqual(rebuild.plan({'mode': 'lighting'}, geometry=True, paths=True),
                         {'geometry': True, 'lights': True, 'paths': True})
        self.assertEqual(rebuild.plan({'mode': 'paths'}, geometry=True, lights=True),
                         {'geometry': True, 'lights': True, 'paths': True})

    def test_keep_paths_still_supported_except_for_explicit_force_or_activation(self):
        self.assertFalse(rebuild.plan(paths=True, keep_paths=True)['paths'])
        self.assertTrue(rebuild.plan(paths=True, keep_paths=True, inactive=True)['paths'])
        self.assertTrue(rebuild.plan({'mode': 'paths'}, keep_paths=True)['paths'])

    def test_script_environment_is_scoped_to_child(self):
        before = dict(os.environ)
        base = {'PATH': 'fixture', rebuild.ENV_MODE: 'paths'}
        env = rebuild.script_environment({'mode': 'full'}, base)
        self.assertEqual(env, {'PATH': 'fixture', rebuild.ENV_MODE: 'full'})
        self.assertEqual(base[rebuild.ENV_MODE], 'paths')
        self.assertEqual(dict(os.environ), before)
        self.assertEqual(rebuild.script_environment(None, base)[rebuild.ENV_MODE], 'auto')

    def test_scripts_always_recreate_geometry_but_keep_defaults(self):
        self.assertEqual(rebuild.script_stages(False, False, {}),
                         {'geometry': True, 'lights': False, 'paths': False})
        self.assertEqual(rebuild.script_stages(False, False, {rebuild.ENV_MODE: 'full'}),
                         {'geometry': True, 'lights': True, 'paths': True})
        self.assertEqual(rebuild.script_stages(False, False, {rebuild.ENV_MODE: 'lighting'}),
                         {'geometry': True, 'lights': True, 'paths': False})
        with self.assertRaises(ValueError):
            rebuild.script_stages(env={rebuild.ENV_MODE: 'full\nMAP NEW'})


class ExistingMapBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='rebuild-command-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'RebuildFixture.dx'
        self.source.write_bytes(b'untouched authoring source')
        self.edits = self.root / 'edits.json'
        self.edits.write_text('{}')
        self.out = self.root / 'out'
        self.run = self.root / 'run'
        for sub in ('T3D', 'Output'):
            (self.run / sub).mkdir(parents=True)
        self.commands = []
        self.patch(dxmaps, 'MOD_MAPS', self.root)
        self.patch(dxmaps, 'OUT', self.out)
        self.patch(dxmaps, 'edits_path', lambda _: self.edits)
        self.patch(dxmaps.kit, 'new_run', lambda *a, **k: self.run)
        self.patch(dxmaps.kit, 'execute', self.execute)
        self.patch(dxmaps.activation, 'save', lambda *a: None)
        self.patch(dxmaps.settings, 'STANDALONE', False)

    def patch(self, target, name, value):
        p = patch.object(target, name, value)
        p.start()
        self.addCleanup(p.stop)

    def execute(self, folder, commands, *args, **kwargs):
        if commands[-1] == 'MAP EXPORT FILE="..\\Output\\source.t3d"':        # the source's objects (dxmaps.source_scene)
            (folder / 'Output' / 'source.t3d').write_text('Begin Map\nEnd Map\n')
            return '', 0.01
        self.commands = commands
        (folder / 'Output' / 'RebuildFixture.dx').write_bytes(b'private built map')
        (folder / 'Output' / 'RebuildFixture.t3d').write_text('Begin Map\nEnd Map\n')
        return '', 0.01

    def build(self, options=None, edits=None):
        if edits is not None:
            self.edits.write_text(json.dumps(edits))
        original = self.edits.read_bytes()
        ok, lines = dxmaps.build('RebuildFixture', options=options)
        self.assertTrue(ok, lines)
        self.assertEqual(self.source.read_bytes(), b'untouched authoring source')
        self.assertEqual(self.edits.read_bytes(), original)
        return json.loads((self.out / 'RebuildFixture.dxinfo.json').read_text())['built']

    def test_clean_automatic_keeps_original_baked_data(self):
        built = self.build()
        for command in ('MAP REBUILD', dxmaps.BSP_OPTIMAL, 'LIGHT APPLY', 'PATHS DEFINE'):
            self.assertNotIn(command, self.commands)
        self.assertFalse(built['geometry'] or built['lights'] or built['paths'])

    def test_full_clean_rebuild_runs_all_stages_in_safe_order(self):
        built = self.build({'mode': 'full'}, {'paths': False})
        required = ['MAP REBUILD', dxmaps.BSP_OPTIMAL, 'UC_WORLD finish', 'PATHS DEFINE',
                    'LIGHT APPLY', 'UC_CAMERAS clear', 'MAP SAVE FILE="..\\Output\\RebuildFixture.dx"']
        positions = [self.commands.index(command) for command in required]
        self.assertEqual(positions, sorted(positions))
        self.assertTrue(built['geometry'] and built['lights'] and built['paths'])
        self.assertEqual(built['rebuild_mode'], 'full')

    def test_lighting_and_paths_force_only_requested_clean_stages(self):
        for mode, command, excluded in (('lighting', 'LIGHT APPLY', 'PATHS DEFINE'),
                                        ('paths', 'PATHS DEFINE', 'LIGHT APPLY')):
            with self.subTest(mode=mode):
                self.build({'mode': mode})
                self.assertIn(command, self.commands)
                self.assertNotIn(excluded, self.commands)
                self.assertNotIn('MAP REBUILD', self.commands)

    def test_paths_defined_with_the_points_on_the_floor_then_put_back(self):
        self.build({'mode': 'paths'})
        i = self.commands.index('PATHS DEFINE')
        self.assertEqual(self.commands[i - 1:i + 3], ['UC_NAVDROP temp', 'PATHS DEFINE', 'UC_NAVLIFT', 'UC_KEEPPATHS restore'])
        self.assertTrue(self.commands[0].startswith('MAP LOAD'))
        self.assertEqual(self.commands[1], 'UC_KEEPPATHS save')         # the map's own links, before any edit

    def test_path_request_keeps_needed_lighting(self):
        self.build({'mode': 'paths'}, {'moved': {
            'FixtureLight': {'cls': 'Light', 'loc': [1, 2, 3]}}})
        self.assertIn('PATHS DEFINE', self.commands)
        self.assertIn('LIGHT APPLY', self.commands)

    def test_surface_edits_replayed_after_forced_bsp_and_before_lighting(self):
        self.build({'mode': 'full'}, {'surfaces': [
            {'op': 'pan', 'args': [16, -8], 'targets': [{'brush': 'Brush2', 'poly': 0}]}]})
        self.assertLess(self.commands.index(dxmaps.BSP_OPTIMAL),
                        self.commands.index('UC_SURFACE Brush2 0 pan 16 -8'))
        self.assertLess(self.commands.index('UC_SURFACE Brush2 0 pan 16 -8'),
                        self.commands.index('LIGHT APPLY'))

    def test_inactive_actors_removed_before_forced_bsp(self):
        self.build({'mode': 'full'}, {'disabled': {'FixtureLight': True}, 'paths': False})
        self.assertLess(self.commands.index('UC_DEL FixtureLight'), self.commands.index('MAP REBUILD'))
        self.assertIn('PATHS DEFINE', self.commands)

    def test_invalid_options_fail_before_creating_a_run(self):
        with patch.object(dxmaps.kit, 'new_run') as new_run, self.assertRaises(ValueError):
            dxmaps.build('RebuildFixture', options={'mode': 'full\nMAP NEW'})
        new_run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
