"""Replace with... at Rebuild: an added object that `replaces` one of the map takes its name; the map's own goes first,
as a deleted one (a script map: its block, matched by class and place; a .dx map: UC_DEL before the import). No game
or user files are changed: generated actors and in-memory command checks."""
import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import dxmaps
import t3d


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


scene = module('replace_tested_scene', KIT / 'scene.py')
GUARD = {'name': 'FixtureGuard', 'cls': 'UNATCOTroop', 'loc': [-100, 0, 50], 'rot': [0, 16384, 0],
         'props': {'Tag': 'Guards', 'Health': '67'}, 'replaces': {'cls': 'MJ12Troop', 'orig': [-100, 0, 48]}}


def script_scene():
    """A script map's actors as blocks, without building it (test_mover_delete.py's way)."""
    s = object.__new__(scene.Scene)
    s.map_name = 'ReplaceFixture'
    s.actors, s.movers, s.actor_group, s.groups, s._group = [], [], {}, {}, None
    s.explicit, s.pieces, s.actor_note, s.op_piece, s._n, s.ops = set(), {}, {}, [], {}, []
    s.actors.append(scene.Scene._block('MJ12Troop', (-100, 0, 48), 'FixtureGuard', None, '', {'Tag': 'Guards'}))
    s.actors.append(scene.Scene._block('Light', (0, 0, 160), 'FixtureLight', None, '', {}))
    return s


def names(blocks):
    return [(a['cls'], a['name']) for a in t3d.actors(''.join(blocks))]


class ScriptMapTests(unittest.TestCase):
    def test_the_script_object_goes_and_the_new_one_takes_its_name(self):
        s = script_scene()
        edits = {'added': [copy.deepcopy(GUARD)]}
        before = copy.deepcopy(edits)
        report = s._apply_actor_edits(edits)
        self.assertEqual(names(s.actors), [('Light', 'FixtureLight'), ('UNATCOTroop', 'FixtureGuard')])
        self.assertIn('  EDIT replaced FixtureGuard', report)
        self.assertEqual(edits, before)

    def test_matched_as_a_deleted_one_by_class_and_place(self):
        for replaces in ({'cls': 'Light', 'orig': [-100, 0, 48]}, {'cls': 'MJ12Troop', 'orig': [900, 0, 48]}):
            with self.subTest(replaces=replaces):
                s = script_scene()
                report = s._apply_actor_edits({'added': [dict(GUARD, replaces=replaces)]})
                self.assertIn(('MJ12Troop', 'FixtureGuard'), names(s.actors))      # not the object it named: it stays
                self.assertIn('  EDIT FixtureGuard not replaced (not found as %s at its original place)' % replaces['cls'], report)
                # and the new one is left out: never two actors under one name
                self.assertEqual([n for _, n in names(s.actors)].count('FixtureGuard'), 1)
                self.assertIn('  EDIT UNATCOTroop FixtureGuard not added (the object it replaces is still there)', report)

    def test_a_replaced_object_of_a_moved_structure_is_found_where_the_structure_took_it(self):
        s = script_scene()
        # as the build has it once it has moved the object with its structure (_apply_groups), 32 units along X
        s.actors[0] = scene.Scene._block('MJ12Troop', (-68, 0, 48), 'FixtureGuard', None, '', {'Tag': 'Guards'})
        report = s._apply_actor_edits({'added': [dict(GUARD, replaces={'cls': 'MJ12Troop', 'orig': [-68, 0, 48]})]})
        self.assertEqual(names(s.actors), [('Light', 'FixtureLight'), ('UNATCOTroop', 'FixtureGuard')])
        self.assertIn('  EDIT replaced FixtureGuard', report)


@unittest.skipUnless(dxmaps.kit.HOST.exists(), 'the map host is not built (mapkit/host/build_host.ps1)')
class DxMapBuildTests(unittest.TestCase):
    """dxmaps.build's commands (its host session still starts the map host: skipped without one)."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='replace-command-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'ReplaceFixture.dx').write_bytes(b'untouched authoring source')
        self.edits = self.root / 'edits.json'
        self.run = self.root / 'run'
        for sub in ('T3D', 'Output'):
            (self.run / sub).mkdir(parents=True)
        self.commands = []
        for target, name, value in ((dxmaps, 'MOD_MAPS', self.root), (dxmaps, 'OUT', self.root / 'out'),
                                    (dxmaps, 'edits_path', lambda _: self.edits), (dxmaps.kit, 'new_run', lambda *a, **k: self.run),
                                    (dxmaps.kit, 'execute', self.execute), (dxmaps.activation, 'save', lambda *a: None),
                                    (dxmaps.settings, 'STANDALONE', False)):
            p = patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)

    def execute(self, folder, commands, *args, **kwargs):
        self.commands = commands
        (folder / 'Output' / 'ReplaceFixture.dx').write_bytes(b'private built map')
        (folder / 'Output' / 'ReplaceFixture.t3d').write_text('Begin Map\nEnd Map\n')
        return '', 0.01

    def build(self, edits):
        self.edits.write_text(json.dumps(edits))
        ok, lines = dxmaps.build('ReplaceFixture')
        self.assertTrue(ok, lines)
        return lines

    def test_the_map_object_is_deleted_before_the_new_one_comes_in_under_its_name(self):
        lines = self.build({'added': [GUARD]})
        self.assertLess(self.commands.index('UC_DEL FixtureGuard'), self.commands.index(r'MAP IMPORTADD FILE="..\T3D\added.t3d"'))
        added = {a['name']: a for a in t3d.actors((self.run / 'T3D' / 'added.t3d').read_text(encoding='latin1'))}
        self.assertEqual(added['FixtureGuard']['cls'], 'UNATCOTroop')
        self.assertEqual(added['FixtureGuard']['props']['Tag'], 'Guards')
        self.assertIn('  EDIT replaced FixtureGuard (MJ12Troop)', lines)

    def test_a_replaced_light_lights_the_map_again(self):
        self.build({'added': [dict(GUARD, name='FixtureLight', cls='Barrel1', replaces={'cls': 'Light', 'orig': [0, 0, 160]})]})
        self.assertIn('UC_DEL FixtureLight', self.commands)
        self.assertIn('LIGHT APPLY', self.commands)

    def test_an_added_object_alone_deletes_nothing(self):
        self.build({'added': [dict(GUARD, replaces=None)]})
        self.assertFalse([c for c in self.commands if c.startswith('UC_DEL FixtureGuard')])


if __name__ == '__main__':
    unittest.main()
