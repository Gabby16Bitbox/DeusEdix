"""A moved path node of a New map room is moved at the next Rebuild (B6 in the game, 27 Oct 2026: "EDIT skipped
PathNode0" at every Rebuild). The script build rests every walking point on the floor (host UC_NAVDROP *: the floor
plus its collision height, 15; build.log "navdrop|PathNode0|48.0 -> 15.5"), and the editor records a moved object's
original place as the build left it. A new room's script puts its path node there (newmap.py); a room made before
(z 48 in its script, recorded at 15.5) still finds it (scene.py). No game, no build: generated actors only."""
import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT), str(KIT.parent)]
import maplinks  # noqa: E402
import newmap  # noqa: E402
import settings  # noqa: E402
import t3d  # noqa: E402


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


scene = module('path_node_tested_scene', KIT / 'scene.py')
REST = 15.5                  # where the build rested PathNode0 of a 2048 room (floor at z 0): its build.log
TOLERANCE = 2                # host/UCEngineBridge.ini [Navigation] FloorTolerance: a point closer than this stays


def rested(z):
    """Where the build leaves a point at z over the room's floor (UC_NAVDROP *)."""
    return z if abs(z - REST) < TOLERANCE else REST


def room_scene(path_node_z):
    """A New map room's script actors as blocks, without building it (test_replace_class.py's way)."""
    s = object.__new__(scene.Scene)
    s.map_name = 'PathNodeFixture'
    s.actors, s.movers, s.actor_group, s.groups, s._group = [], [], {}, {}, None
    s.explicit, s.pieces, s.actor_note, s.op_piece, s._n, s.ops = set(), {}, {}, [], {}, []
    s.actors.append(scene.Scene._block('PlayerStart', (0, -512, 48), 'PlayerStart0', (0, 16384, 0), '', {}))
    s.actors.append(scene.Scene._block('PathNode', (0, 0, path_node_z), 'PathNode0', None, '', {}))
    s.actors.append(scene.Scene._block('Light', (-768, -768, 360), 'Light0', None, '', {}))
    return s


def where(s, name):
    return next(a['props'].get('Location') for a in t3d.actors(''.join(s.actors)) if a['name'] == name)


class NewRoomTest(unittest.TestCase):
    def test_a_new_rooms_path_node_is_where_the_build_rests_it(self):
        with tempfile.TemporaryDirectory(prefix='.newmap-path-node-', dir=Path(__file__).parent) as temp:
            with patch.object(newmap.kit, 'PROJECT', Path(temp)), patch.object(maplinks, 'all_maps', return_value=[]), \
                    patch.object(settings, 'PROJECT_KIND', 'custom', create=True):
                script, _ = newmap.create_empty('Room', 10, (2048, 2048, 384))
                text = (newmap.maps_folder() / (script + '.py')).read_text(encoding='utf-8')
        found = re.findall(r"^s\.actor\('PathNode', \(([-\d.]+), ([-\d.]+), ([-\d.]+)\)\)", text, re.M)
        self.assertEqual(len(found), 1, text)
        z = float(found[0][2])
        # the build leaves it where the script puts it: the place the editor records is the script's
        self.assertEqual(rested(z), z)
        s = room_scene(z)
        report = s._apply_actor_edits({'moved': {'PathNode0': {'cls': 'PathNode', 'loc': [0, -300, 16], 'rot': [0, 0, 0],
                                                               'orig': [0, 0, rested(z)]}}})
        self.assertIn('  EDIT moved PathNode0', report)


class RoomMadeBeforeTest(unittest.TestCase):
    """Rooms made before 28 Oct 2026: PathNode0 at z 48 in the script, recorded at 15.5 by the editor."""
    MOVE = {'cls': 'PathNode', 'loc': [0, -300, 16], 'rot': [0, 0, 0], 'orig': [0, 0, REST]}

    def test_a_moved_path_node_is_moved(self):
        s = room_scene(48)
        report = s._apply_actor_edits({'moved': {'PathNode0': dict(self.MOVE)}})
        self.assertIn('  EDIT moved PathNode0', report)
        self.assertNotIn('skipped', ' '.join(report))
        self.assertEqual(where(s, 'PathNode0'), '(X=0.00,Y=-300.00,Z=16.00)')

    def test_a_deleted_path_node_is_deleted(self):
        s = room_scene(48)
        report = s._apply_actor_edits({'deleted': {'PathNode0': {'cls': 'PathNode', 'orig': [0, 0, REST]}}})
        self.assertIn('  EDIT deleted PathNode0', report)
        self.assertNotIn('PathNode0', [a['name'] for a in t3d.actors(''.join(s.actors))])

    def test_what_is_not_where_the_build_could_have_rested_it_is_still_skipped(self):
        cases = {
            'another place on the floor': ('PathNode0', dict(self.MOVE, orig=[100, 0, REST])),
            'higher than its collision height over the script place': ('PathNode0', dict(self.MOVE, orig=[0, 0, 48 + 18])),
            'farther down than the floor is looked for': ('PathNode0', dict(self.MOVE, orig=[0, 0, 48 - 513])),
            'farther down than a rest under the script place (another floor\'s)': ('PathNode0', dict(self.MOVE, orig=[0, 0, 48 - 65])),
            'not a walking point (a lamp is never rested)': ('Light0', {'cls': 'Light', 'loc': [0, 0, 300],
                                                                        'orig': [-768, -768, 360 - 32.5]}),
            'another class under its name': ('PathNode0', dict(self.MOVE, cls='PatrolPoint')),
        }
        for case, (name, info) in cases.items():
            with self.subTest(case=case):
                report = room_scene(48)._apply_actor_edits({'moved': {name: info}})
                self.assertIn('  EDIT skipped %s (not found as %s at its original place)' % (name, info['cls']), report)

    def test_other_walking_points_rested_by_the_build(self):
        for cls in ('PatrolPoint', 'WanderPoint', 'HidePoint', 'AmbushPoint', 'MapExit'):
            with self.subTest(cls=cls):
                s = room_scene(48)
                s.actors[1] = scene.Scene._block(cls, (64, 64, 40), 'Point1', None, '', {})
                report = s._apply_actor_edits({'moved': {'Point1': {'cls': cls, 'loc': [64, 128, 16], 'orig': [64, 64, REST]}}})
                self.assertIn('  EDIT moved Point1', report)


class WalkingPointClassesTest(unittest.TestCase):
    """Which walking points the build rests (host dropNavPoints: every NavigationPoint but PlayerStart and Teleporter),
    by the game's classes, else by the name in any case (this PC's class defaults spell the game's 'Ambushpoint');
    how high over the script's place their own collision height takes them; stacked points (part_a_result findings 3,
    4, 9: an upper floor's point never takes a ground floor's record)."""

    def moved(self, cls, at, orig, record_cls=None):
        s = room_scene(48)
        s.actors[1] = scene.Scene._block(cls, at, 'Point1', None, '', {})
        return s._apply_actor_edits({'moved': {'Point1': {'cls': record_cls or cls, 'loc': [64, 128, 16], 'orig': list(orig)}}})

    def test_every_walking_point_the_build_rests(self):
        # the game's spelling (Ambushpoint), those the original maps use (GuardPoint, SpawnPoint, HomeBase), the others
        for cls in ('Ambushpoint', 'GuardPoint', 'SpawnPoint', 'HomeBase', 'LiftCenter', 'LiftExit', 'ButtonMarker',
                    'TriggerMarker'):
            with self.subTest(cls=cls):
                self.assertIn('  EDIT moved Point1', self.moved(cls, (64, 64, 40), (64, 64, REST)))

    def test_a_class_name_in_any_case(self):
        # the script's AmbushPoint, the editor's record in the game's spelling, and the other way round
        self.assertIn('  EDIT moved Point1', self.moved('AmbushPoint', (64, 64, 40), (64, 64, REST), 'Ambushpoint'))
        self.assertIn('  EDIT moved Point1', self.moved('Ambushpoint', (64, 64, 40), (64, 64, REST), 'AmbushPoint'))
        # a name the game's classes do not have as it is written: by its name, any case
        self.assertIn('  EDIT moved Point1', self.moved('GUARDPOINT', (64, 64, 40), (64, 64, REST)))

    def test_without_the_class_defaults_by_the_name(self):
        props = scene._editor_props()
        with patch.object(props, 'CACHE', Path(__file__).parent / 'no-class-defaults-here.json'):
            for cls in ('Ambushpoint', 'GuardPoint', 'pathnode'):
                with self.subTest(cls=cls):
                    self.assertIn('  EDIT moved Point1', self.moved(cls, (64, 64, 40), (64, 64, REST)))
            self.assertIn('  EDIT skipped Point1 (not found as PlayerStart at its original place)',
                          self.moved('PlayerStart', (64, 64, 40), (64, 64, REST)))

    def test_up_to_its_own_collision_height(self):
        # an InventorySpot's is 40: rested 40 over a floor at the script's place; a PathNode's 15
        self.assertIn('  EDIT moved Point1', self.moved('InventorySpot', (64, 64, 0), (64, 64, 40)))
        self.assertIn('  EDIT skipped Point1 (not found as PathNode at its original place)',
                      self.moved('PathNode', (64, 64, 0), (64, 64, 40)))

    def test_never_a_player_start_a_teleporter_or_another_mods_class(self):
        for cls in ('PlayerStart', 'Teleporter', 'SomeModPoint', 'Light'):
            with self.subTest(cls=cls):
                self.assertIn('  EDIT skipped Point1 (not found as %s at its original place)' % cls,
                              self.moved(cls, (64, 64, 40), (64, 64, REST)))

    def test_stacked_points_never_take_another_floors_record(self):
        move = {'moved': {'PathNode0': dict(RoomMadeBeforeTest.MOVE)}}  # recorded at (0, 0, 15.5)
        # PathNode0 is now the point over an upper floor (z 256), PathNode1 the ground floor's (a name shift)
        s = room_scene(304)
        s.actors.append(scene.Scene._block('PathNode', (0, 0, 48), 'PathNode1', None, '', {}))
        self.assertIn('  EDIT skipped PathNode0 (not found as PathNode at its original place)', s._apply_actor_edits(move))
        self.assertIn('Z=304.0', where(s, 'PathNode0'))                       # left where the script puts it
        # another walking point of the script between the record and the script's place: whose record it is, unknown
        s = room_scene(60)
        s.actors.append(scene.Scene._block('PatrolPoint', (0, 0, 30), 'PatrolPoint0', None, '', {}))
        self.assertIn('  EDIT skipped PathNode0 (not found as PathNode at its original place)', s._apply_actor_edits(move))
        # alone, the same point 60 over the floor (rested 44.5 lower) is found
        self.assertIn('  EDIT moved PathNode0', room_scene(60)._apply_actor_edits({'moved': {'PathNode0': dict(RoomMadeBeforeTest.MOVE)}}))


if __name__ == '__main__':
    unittest.main()
