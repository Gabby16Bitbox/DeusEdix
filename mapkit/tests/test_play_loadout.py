"""A play scenario's loadout: editor/play.py turns it into the game's console commands and the runner's steps,
leaving out what the editor does not know; live.play puts them before the 'play' step (the commands in a file the
runner execs once, gone after the game); the game's speed saved by its slomo is put back after the game; the server
gives Play the loadout's lists and passes a scenario's loadout on."""
import ast
import contextlib
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

KIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT))
sys.path.insert(0, str(KIT / 'editor'))
import live  # noqa: E402
import play  # noqa: E402
import test_tutorial_routes as routes  # noqa: E402

CATALOG = dict(items=[dict(cls='DeusEx.WeaponPistol', name='Pistol', cat='Weapons'), dict(cls='DeusEx.Ammo10mm', name='10mm Ammo', cat='Ammo'),
                      dict(cls='MyMod.MyMedKit', name='Med kit', cat='Pickups')],
               augs=[dict(cls='AugCloak', name='Cloak'), dict(cls='AugSpeed', name='Speed')],
               skills=[dict(cls='SkillLockpicking', name='Lockpicking')])


class LoadoutTests(unittest.TestCase):
    def test_catalog_lists_the_items_and_the_classes_under_augmentation_and_skill(self):
        classes = {'AugCloak': dict(parents=['Augmentation', 'Actor', 'Object']), 'Augmentation': dict(parents=['Actor', 'Object']),
                   'AugmentationManager': dict(parents=['Actor', 'Object']), 'SkillWeaponPistol': dict(parents=['Skill', 'Actor', 'Object']),
                   'AugEMP': dict(parents=['Augmentation']), 'MedKit': dict(parents=['DeusExPickup'])}
        items = [dict(cls='DeusEx.MedKit', name='Medkit', cat='Pickups', extra=1)]
        got = play.loadout_catalog(items, classes)
        self.assertEqual(got['items'], [dict(cls='DeusEx.MedKit', name='Medkit', cat='Pickups')])
        self.assertEqual(got['augs'], [dict(cls='AugCloak', name='Cloak'), dict(cls='AugEMP', name='EMP')])
        self.assertEqual(got['skills'], [dict(cls='SkillWeaponPistol', name='Weapon Pistol')])

    def test_a_loadout_where_jc_is_put_lies_in_front_of_him_and_the_rest_is_console_commands(self):
        run = play.loadout_run(dict(items=[dict(cls='deusex.weaponpistol', count=1), dict(cls='DeusEx.Ammo10mm', count=2)],
                                    augs=['augcloak'], skills=[dict(cls='SkillLockpicking', level=3)], skillPoints=2000,
                                    credits=500, health=40, cheat='god'), [100.0, 200.0, 48.0], 16384, CATALOG)
        self.assertEqual(run['commands'], [
            'set DeusExPlayer bCheatsEnabled True', 'augadd AugCloak', 'set SkillLockpicking CurrentLevel 3',
            'set DeusExPlayer SkillPointsAvail 2000', 'set DeusExPlayer Credits 500',
            'set DeusExPlayer HealthHead 40', 'set DeusExPlayer HealthTorso 40', 'set DeusExPlayer HealthArmLeft 40',
            'set DeusExPlayer HealthArmRight 40', 'set DeusExPlayer HealthLegLeft 40', 'set DeusExPlayer HealthLegRight 40',
            'set DeusExPlayer Health 40', 'god'])
        self.assertEqual(run['steps'], ['i0;spawn;DeusEx.WeaponPistol;100.0;240.0;48.0;16384',
                                        'i1;spawn;DeusEx.Ammo10mm;86.0;240.0;48.0;16384',
                                        'i2;spawn;DeusEx.Ammo10mm;114.0;240.0;48.0;16384'])
        self.assertIn('Loadout: set DeusExPlayer bCheatsEnabled True | augadd AugCloak', run['lines'][0])
        self.assertEqual(run['lines'][1], 'In front of JC: WeaponPistol, Ammo10mm, Ammo10mm')
        self.assertEqual(len(run['lines']), 2, 'nothing left out')

    def test_at_his_own_start_the_game_summons_the_items_in_front_of_him(self):
        run = play.loadout_run(dict(items=[dict(cls='MyMod.MyMedKit', count=2)], cheat='invisible'), None, 0, CATALOG)
        self.assertEqual(run['commands'], ['set DeusExPlayer bCheatsEnabled True', 'summon MyMod.MyMedKit', 'summon MyMod.MyMedKit',
                                           'invisible 1'])
        self.assertEqual(run['steps'], [])

    def test_only_set_commands_need_no_cheats_and_nothing_given_runs_nothing(self):
        run = play.loadout_run(dict(credits=0, skills=[dict(cls='SkillLockpicking', level=0)]), [0, 0, 0], 0, CATALOG)
        self.assertEqual(run['commands'], ['set SkillLockpicking CurrentLevel 0', 'set DeusExPlayer Credits 0'])
        for nothing in (None, {}, 'items', dict(cheat='none', items=[])):
            self.assertEqual(play.loadout_run(nothing, None, 0, CATALOG), dict(commands=[], steps=[], lines=[]))

    def test_what_the_editor_does_not_know_and_values_out_of_range_are_left_out_and_said(self):
        run = play.loadout_run(dict(items=[dict(cls='Gone.Weapon', count=1), dict(cls='DeusEx.WeaponPistol;exit', count=1),
                                           dict(cls='DeusEx.Ammo10mm', count=0), dict(cls='DeusEx.Ammo10mm', count=True)],
                                    augs=['AugNone', 'AugSpeed'], skills=[dict(cls='SkillLockpicking', level=4), dict(cls='SkillTech', level=1)],
                                    credits=-5, health=101, skillPoints='lots', cheat='fly'), [0, 0, 0], 0, CATALOG)
        self.assertEqual(run['commands'], ['set DeusExPlayer bCheatsEnabled True', 'augadd AugSpeed'])
        self.assertEqual(run['steps'], [])
        left = run['lines'][-1]
        for said in ('Gone.Weapon (not in the game or the mod)', 'DeusEx.WeaponPistol;exit (not in', 'DeusEx.Ammo10mm: 0 is not a count',
                     'DeusEx.Ammo10mm: True is not a count', 'AugNone (not in', 'SkillLockpicking: 4 is not a level', 'SkillTech (not in',
                     'credits: -5 is not a number from 0 to 1000000', 'health: 101 is not a number from 1 to 100', 'skillPoints: lots'):
            self.assertIn(said, left)

    def test_at_most_max_items_reach_jc(self):
        rows = [dict(cls='DeusEx.Ammo10mm', count=play.MAX_COUNT)] * 3
        run = play.loadout_run(dict(items=rows), [0, 0, 0], 0, CATALOG)
        self.assertEqual(len(run['steps']), play.MAX_ITEMS)
        self.assertIn('DeusEx.Ammo10mm: 20 of 20 (at most 40 items)', run['lines'][-1])

    def test_drop_points_are_rows_across_his_view_in_front_of_him(self):
        self.assertEqual(play.drop_points([0, 0, 50], 0, 6), [(40.0, 0.0, 50), (40.0, 14.0, 50), (40.0, -14.0, 50), (40.0, 28.0, 50),
                                                              (40.0, -28.0, 50), (54.0, 0.0, 50)])
        x, y, z = play.drop_points([10, 10, 0], 32768, 1)[0]
        self.assertAlmostEqual(x, -30.0)
        self.assertAlmostEqual(y, 10.0)

    def test_class_labels(self):
        self.assertEqual(play.class_label('AugBallisticPassive', 'Aug'), 'Ballistic Passive')
        self.assertEqual(play.class_label('AugEMP', 'Aug'), 'EMP')
        self.assertEqual(play.class_label('Skill', 'Skill'), 'Skill')


class LaunchTests(unittest.TestCase):
    """live.play with a loadout: the runner's steps in order, the commands' file there for the launch only, and the
    game's speed back as it was before it."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.ini = self.root / 'RevisionUser.ini'
        self.ini.write_bytes(b'[Engine.Player]\r\nName=JC\r\n')
        self.game_ini = self.root / 'Revision.ini'
        self.game_ini.write_bytes(b'[Engine.Engine]\r\nX=1\r\n\r\n[Engine.GameInfo]\r\nbLowGore=False\r\nGameSpeed=1.000000\r\n\r\n'
                                  b'[Other]\r\nGameSpeed=7\r\n')
        self.cleanup = None

        def start(prepare, dispatch, cleanup):
            prepare()
            self.cleanup = cleanup
        session = types.SimpleNamespace(processes=types.SimpleNamespace(list=lambda: []), start=start)
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(patch.multiple(live, INI=self.ini, CMD=self.root / 'UCLive.txt', REV=self.root,
                                                CONSOLE_CMD=self.root / 'UCConsole.txt', LOADOUT=self.root / 'UCLoadout.txt',
                                                GAME_INI=self.game_ini, PLAY_INI=None, SYS=self.root, _SESSION=session,
                                                STATE={'seq': 0, 'folder': None, 'maps': set(), 'command_written': False},
                                                settings=types.SimpleNamespace(MAPS_DIR=self.root, MANAGED_PROJECT=False)))
        self.stack.enter_context(patch.dict(sys.modules, {'workspace': types.SimpleNamespace(activate=Mock()),
                                                          'project_game': types.SimpleNamespace(deactivate_if_current=Mock())}))

    def tearDown(self):
        self.stack.close()
        self.temp.cleanup()

    def shots(self):
        text = self.ini.read_text(encoding='latin1')
        return [line.split('=', 1)[1] for line in text.splitlines() if line.startswith('Shots[')]

    def test_the_loadout_comes_before_the_play_step_and_its_file_goes_with_the_game(self):
        run = play.loadout_run(dict(items=[dict(cls='DeusEx.WeaponPistol', count=1)], cheat='god'), [1.0, 2.0, 3.0], 0, CATALOG)
        live.play('TestMap', at=[1.0, 2.0, 3.0], yaw=0, pitch=0, steps=run['steps'], commands=run['commands'])
        self.assertEqual(self.shots(), ['w2;wait;1', 'ld;console;exec UCLoadout.txt', 'i0;spawn;DeusEx.WeaponPistol;41.0;2.0;3.0;0',
                                        'go;play;1.0;2.0;3.0;0;0'])
        self.assertEqual((self.root / 'UCLoadout.txt').read_bytes(), b'set DeusExPlayer bCheatsEnabled True\r\ngod\r\n')
        self.cleanup()
        self.assertFalse((self.root / 'UCLoadout.txt').exists())

    def test_without_a_loadout_the_steps_are_as_before_and_no_file_is_left(self):
        (self.root / 'UCLoadout.txt').write_text('left by a crash', encoding='latin1')
        live.play('TestMap', at=None, setup='UCDbgOtherMission')
        self.assertEqual(self.shots(), ['w;waitmap;TestMap;90', 'w2;wait;1', 'go;play'])
        self.assertFalse((self.root / 'UCLoadout.txt').exists())

    def test_a_slow_motion_saved_by_the_game_is_put_back_after_it(self):
        live.play('TestMap')
        self.game_ini.write_bytes(self.game_ini.read_bytes().replace(b'GameSpeed=1.000000', b'GameSpeed=0.250000'))
        self.cleanup()
        text = self.game_ini.read_bytes().decode('latin1')
        self.assertIn('[Engine.GameInfo]\r\nbLowGore=False\r\nGameSpeed=1.000000\r\n', text)
        self.assertIn('[Other]\r\nGameSpeed=7\r\n', text, 'only the GameInfo section')
        self.assertEqual(live.game_speed(text), '1.000000')

    def test_a_game_speed_line_the_game_added_goes_and_an_untouched_ini_is_not_written(self):
        self.game_ini.write_bytes(b'[Engine.GameInfo]\nbLowGore=False\n')
        live.play('TestMap')
        self.game_ini.write_bytes(b'[Engine.GameInfo]\nbLowGore=False\nGameSpeed=0.25\n')
        self.cleanup()
        self.assertEqual(self.game_ini.read_bytes(), b'[Engine.GameInfo]\nbLowGore=False\n')
        live.play('TestMap')
        before = self.game_ini.stat().st_mtime_ns
        self.cleanup()
        self.assertEqual(self.game_ini.stat().st_mtime_ns, before)

    def test_the_original_game_plays_on_copies_of_its_ini_and_nothing_is_put_back(self):
        with patch.object(live, 'PLAY_INI', self.root / 'Play' / 'DeusEx.ini'):
            self.assertEqual(live._speed_kept(), ())
            live._speed_back(())
        self.assertIn('GameSpeed=1.000000', self.game_ini.read_text(encoding='latin1'))


class RouteTests(unittest.TestCase):
    """/api/play passes a scenario's loadout on (the tutorial's never); /api/play_info lists what it can name."""
    request = routes.TutorialRouteTests.request

    def setUp(self):
        routes.TutorialRouteTests.setUp(self)
        self.session.enabled = False
        self.play.loadout_run = Mock(return_value=dict(commands=['god'], steps=['i0;spawn;DeusEx.Flare;0;0;0;0'], lines=['Loadout: god']))
        self.play.loadout_catalog = Mock(return_value=CATALOG)
        self.play.setups = Mock(return_value=[])
        self.data.items = Mock(return_value=CATALOG['items'])
        self.namespace['props'] = types.SimpleNamespace(defaults=Mock(return_value={'classes': {'AugCloak': {'parents': ['Augmentation']}}}))
        tree = ast.parse(routes.SOURCE.read_text(encoding='utf-8-sig'))
        selected = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'loadout_catalog'], type_ignores=[])
        exec(compile(selected, str(routes.SOURCE), 'exec'), self.namespace)
        self.namespace['data'] = self.data

    def test_a_scenario_loadout_reaches_the_runner_and_the_play_log(self):
        loadout = dict(items=[dict(cls='DeusEx.Flare', count=1)], cheat='god')
        code, result = self.request('/api/play?script=my_room', {'at': [1, 2, 3], 'yaw': 90, 'pitch': 0, 'loadout': loadout})
        self.assertEqual(code, 200, result)
        self.play.loadout_run.assert_called_once_with(loadout, [1, 2, 3], 90, CATALOG)
        self.play.loadout_catalog.assert_called_once_with(CATALOG['items'], {'AugCloak': {'parents': ['Augmentation']}})
        self.assertEqual(self.play.start.call_args.kwargs['steps'], ['i0;spawn;DeusEx.Flare;0;0;0;0'])
        self.assertEqual(self.play.start.call_args.kwargs['commands'], ['god'])
        self.assertEqual(result['lines'][-1], 'Loadout: god')

    def test_play_without_a_loadout_does_not_read_the_classes(self):
        code, result = self.request('/api/play?script=my_room', {'at': [1, 2, 3]})
        self.assertEqual(code, 200, result)
        self.play.loadout_run.assert_called_once_with(None, [1, 2, 3], 0, {})
        self.play.loadout_catalog.assert_not_called()

    def test_the_tutorial_never_gets_a_loadout(self):
        self.session.enabled = True
        code, result = self.request(f'/api/play?script={routes.SCRIPT}', {'loadout': dict(cheat='god')}, token='session-A')
        self.assertEqual(code, 200, result)
        self.assertIsNone(self.play.loadout_run.call_args.args[0])

    def test_play_info_lists_what_a_loadout_can_name(self):
        code, result = self.request('/api/play_info?script=my_room', method='GET')
        self.assertEqual(code, 200, result)
        self.assertEqual(result['loadout'], CATALOG)


if __name__ == '__main__':
    unittest.main()
