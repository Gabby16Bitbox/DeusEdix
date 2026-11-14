import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'editor'), str(ROOT), str(ROOT / 'tests')]
import moving_pieces
import prefabs
import gamelib
import t3d
from test_moving_pieces import actor


class MoverLibrarySettingsTests(unittest.TestCase):
    def prefab(self, lift=False):
        source = actor(**{'KeyPos(1)': '(Z=400)'}) if lift else actor()
        raw = moving_pieces.template(source, 'elevator' if lift else 'door', {'Test.Walls.TestDoor'})
        return dict(id='fixture', label='Test mover', source='01_Test', pivot=[100, 200, 300],
                    blocks=[dict(raw=raw, name='Door1', cls='DeusExMover', mover=True, brush=False)])

    def test_description_for_old_cached_prefabs(self):
        for lift in (False, True):
            pf = self.prefab(lift)
            with tempfile.TemporaryDirectory() as folder, patch.object(prefabs, 'ROOT', Path(folder)):
                (Path(folder) / 'fixture').mkdir()
                (Path(folder) / 'fixture/prefab.json').write_text(json.dumps(pf), encoding='utf-8')
                clip = gamelib.prefab('01_Test~mDoor1', pid='fixture')
                self.assertEqual(clip['mover']['kind'], 'elevator' if lift else 'door')
                self.assertEqual(clip['mover']['mode'], 'stand' if lift else 'use')
                self.assertEqual(clip['mover']['moveTime'], 1)
                self.assertEqual(clip['mover']['stayOpenTime'], 4)
                self.assertFalse(clip['mover']['locked'])

    def test_static_prefab_has_no_mover_controls(self):
        pf = self.prefab(); pf['blocks'][0]['mover'] = False
        self.assertIsNone(moving_pieces.description(pf))
        self.assertIsNone(moving_pieces.description({'blocks': []}))

    def test_settings_survive_serialization_place_rotate_and_duplicate(self):
        pf = self.prefab(); original = json.dumps(pf)
        settings = dict(mode='use-timed', moveTime=2.5, stayOpenTime=7, locked=True, keyId='2')
        entry = json.loads(json.dumps(dict(_prefab=pf, pid='one', offset=[10, 0, 0], yaw=16384, moverSettings=settings)))
        raw, brushes, actors = prefabs.place(entry)
        a = next(t3d.actors(raw[0])); p = a['props']
        self.assertEqual(a['cls'], 'DeusExMover'); self.assertFalse(brushes)
        self.assertEqual(actors, ['UCPfoneA0'])
        self.assertEqual(p['InitialState'], 'TriggerOpenTimed'); self.assertEqual(p['bFrobbable'], 'True')
        self.assertEqual(float(p['MoveTime']), 2.5); self.assertEqual(float(p['StayOpenTime']), 7)
        self.assertEqual(p['bLocked'], 'True'); self.assertEqual(t3d.vec(p['KeyPos(1)']), (0, 80, 0))
        self.assertEqual(p['KeyIDNeeded'], '2')
        other = json.loads(json.dumps(entry)); other['pid'] = 'two'; other['moverSettings']['locked'] = False
        second = next(t3d.actors(prefabs.place(other)[0][0]))['props']
        self.assertNotEqual(p['Tag'], second['Tag']); self.assertEqual(second['bLocked'], 'False')
        self.assertEqual(second['KeyIDNeeded'], '2', 'A duplicate keeps the same key independently of its unique Tag')
        self.assertTrue(entry['moverSettings']['locked']); self.assertEqual(json.dumps(pf), original)

    def test_modes_and_sounds(self):
        pf = self.prefab(True)
        pf['blocks'][0]['raw'] = pf['blocks'][0]['raw'].replace('End Actor', "    OpeningSound=Sound'Test.Door.Open'\nEnd Actor")
        for mode, state in [('use', 'TriggerToggle'), ('use-timed', 'TriggerOpenTimed'), ('trigger', 'TriggerToggle'), ('stand', 'StandOpenTimed')]:
            raw = prefabs.place(dict(_prefab=pf, pid='test', moverSettings=dict(mode=mode)))[0][0]
            p = next(t3d.actors(raw))['props']
            self.assertEqual(p['InitialState'], state)
            self.assertEqual(p['OpeningSound'], "Sound'Test.Door.Open'")
            self.assertEqual(p['bFrobbable'], 'True' if mode.startswith('use') else 'False')

    def test_reject_invalid_settings(self):
        for settings in (['bad'], {'Event': 'Mission'}, {'mode': 'None\nEnd Actor'}, {'mode': []},
                         {'moveTime': float('nan')}, {'moveTime': float('inf')}, {'moveTime': True},
                         {'moveTime': 0}, {'stayOpenTime': -1}, {'stayOpenTime': 3601}, {'locked': 'False'}):
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                prefabs.place(dict(_prefab=self.prefab(), pid='test', moverSettings=settings))

    def test_without_settings_unchanged(self):
        raw = self.prefab()['blocks'][0]['raw']
        self.assertEqual(moving_pieces.apply_settings(raw, None), raw)
        self.assertEqual(moving_pieces.apply_settings(raw, {}), raw)

    def test_key_ids_keep_identity_and_can_be_cleared(self):
        pf=self.prefab()
        pf['blocks'][0]['raw']=pf['blocks'][0]['raw'].replace('End Actor','    KeyIDNeeded=OldDoor\nEnd Actor')
        self.assertEqual(moving_pieces.description(pf)['keyId'],'OldDoor')
        for value,expected in [('2','2'),(4,'4'),(0,'0'),('  ApartmentDoor  ','ApartmentDoor'),
                               ('None','None'),('none','None'),('','None'),(None,'None')]:
            with self.subTest(value=value):
                raw=prefabs.place(dict(_prefab=pf,pid='key',moverSettings={'keyId':value}))[0][0]
                self.assertEqual(next(t3d.actors(raw))['props']['KeyIDNeeded'],expected)
        raw=prefabs.place(dict(_prefab=pf,pid='key',moverSettings={'locked':True}))[0][0]
        self.assertEqual(next(t3d.actors(raw))['props']['KeyIDNeeded'],'OldDoor')

    def test_key_id_rejects_malformed_t3d_and_non_names(self):
        for value in ['Key\nEnd Actor','Door ID',"Door'ID",'a'*64,[],{},True,2.5]:
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'Key ID'):
                prefabs.place(dict(_prefab=self.prefab(),pid='key',moverSettings={'keyId':value}))

    def test_lock_picking_and_damage(self):
        # 14 Nov 2026 (Gabby): a door from Objects > Movers had no lockpicking or damage options
        pf = self.prefab()
        d = moving_pieces.description(pf)
        self.assertEqual((d['pickable'], d['lockStrength'], d['breakable'], d['doorStrength'], d['minDamage']), (False, 0.2, False, 0.25, 10))
        raw = prefabs.place(dict(_prefab=pf, pid='lp', moverSettings=dict(pickable=True, lockStrength=0.75, breakable=True,
                                                                          doorStrength=0.5, minDamage=25)))[0][0]
        p = next(t3d.actors(raw))['props']
        self.assertEqual((p['bPickable'], p['lockStrength'], p['bBreakable'], p['doorStrength'], p['minDamageThreshold']),
                         ('True', '0.750000', 'True', '0.500000', '25'))
        for bad in ({'pickable': 'True'}, {'lockStrength': 1.5}, {'doorStrength': -0.1}, {'lockStrength': True},
                    {'doorStrength': float('nan')}, {'minDamage': 5000}, {'breakable': 1}):
            with self.subTest(settings=bad), self.assertRaises(ValueError):
                prefabs.place(dict(_prefab=pf, pid='lp', moverSettings=bad))


if __name__ == '__main__':
    unittest.main()
