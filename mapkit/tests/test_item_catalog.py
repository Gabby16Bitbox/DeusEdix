"""Catalog presentation must not rewrite engine identities or drop existing map data."""
import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'editor'))
from itemcatalog import inventory_catalog, placement_metadata


def raw(cls, name, cat='Ammo', mesh='Ammo'):
    pkg, cls = cls.split('.')
    return dict(cls=cls, pkg=pkg, name=name, cat=cat, mesh=mesh, radius=8, height=8, sub='')


class ItemCatalogTests(unittest.TestCase):
    def test_robot_ammo_and_chargers_are_not_confused_with_player_ammo(self):
        rows = inventory_catalog([
            raw('DeusEx.Ammo762mm', '7.62x51mm Ammo'), raw('DeusEx.AmmoSecurityBot3', '7.62x51mm Ammo'),
            raw('DeusEx.AmmoBattery', 'Charger'), raw('Revision.AmmoLaser', 'Charger')])
        self.assertNotIn('internal', rows[0])
        self.assertTrue(rows[1]['internal'])
        self.assertEqual(len(set(r['name'] for r in rows)), 4)
        self.assertIsNone(placement_metadata(rows[1]))

    def test_grenades_keep_usable_pickups_and_describe_internal_ammo(self):
        for suffix in ('LAM', 'EMPGrenade', 'GasGrenade', 'NanoVirusGrenade'):
            weapon, ammo = inventory_catalog([raw('DeusEx.Weapon'+suffix, suffix, 'Weapons'), raw('DeusEx.Ammo'+suffix, suffix)])
            self.assertEqual(weapon['group'], 'Grenades')
            self.assertNotIn('internal', weapon)
            self.assertIn('equippable', ammo['warning'])
            self.assertTrue(ammo['internal'])

    def test_nanokey_requires_configuration_but_remains_placeable(self):
        key, ring = inventory_catalog([raw('DeusEx.NanoKey', 'NanoKey', 'Pickups'), raw('DeusEx.NanoKeyRing', 'Key ring', 'Pickups')])
        self.assertTrue(key['needsSetup'])
        self.assertIn('same Key ID on the door', key['warning'])
        self.assertIsNotNone(placement_metadata(key))
        self.assertIsNone(placement_metadata(ring))

    def test_legacy_alias_and_carried_body_remain_addressable(self):
        names = ['AugmentationUpgradeCannister', 'AugmentationUpgrade', 'POVCorpse']
        rows = inventory_catalog([raw('DeusEx.'+n, n, 'Pickups') for n in names])
        self.assertEqual([r['cls'] for r in rows], ['DeusEx.'+n for n in names])
        self.assertNotIn('internal', rows[0])
        self.assertTrue(all(r['internal'] for r in rows[1:]))

    def test_mod_classes_are_not_filtered_by_substrings_or_short_names(self):
        inputs = [raw('MyMod.AmmoLAM', 'Custom grenade ammo'),
                  raw('MyMod.WeaponRobotRocket', 'Player robot launcher', 'Weapons'),
                  raw('MyMod.NanoKey', 'Custom key', 'Pickups')]
        self.assertTrue(all(not r.get('internal') and not r.get('needsSetup') for r in inventory_catalog(inputs)))

    def test_helpers_are_hidden_and_source_is_not_mutated(self):
        inputs = [raw('DeusEx.WeaponDogBite', 'Bite', 'Weapons', 'DeusExItems.InvisibleWeapon'),
                  raw('DeusEx.AmmoNone', 'DEFAULT AMMO NAME - REPORT THIS AS A BUG')]
        original = copy.deepcopy(inputs)
        self.assertTrue(all(r['internal'] for r in inventory_catalog(inputs)))
        self.assertEqual(inputs, original)

    def test_identity_deduplication_keeps_distinct_classes_with_same_name(self):
        rows = inventory_catalog([raw('Mod.A', 'Supply'), raw('Mod.B', 'Supply'), raw('mod.a', 'Supply')])
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]['name'], rows[1]['name'])

    def test_gameplay_specific_item_is_not_added_to_other_games(self):
        original = inventory_catalog([raw('DeusEx.MedKit', 'Medkit', 'Pickups')])
        self.assertEqual(len(original), 1)
        item = inventory_catalog([raw('DeusEx.WeaponModProjectile', 'Projectile', 'Pickups')])[0]
        self.assertEqual(item['group'], 'Gameplay-specific')
        self.assertIn('gameplay mode', item['warning'])

    def test_objects_browser_and_api_apply_policy_to_cached_catalog(self):
        import data
        catalog = [raw('DeusEx.NanoKey', 'NanoKey', 'Pickups'),
                   raw('DeusEx.AmmoSecurityBot3', '7.62x51mm Ammo'), raw('DeusEx.Ammo762mm', '7.62x51mm Ammo')]
        with patch.object(data, 'catalog', return_value=catalog):
            rows = [i for g in data.palette() for i in g['items']]
            self.assertFalse(any(i['cls'] == 'AmmoSecurityBot3' for i in rows))
            key = next(i for i in rows if i['cls'] == 'NanoKey')
            self.assertIn('Key ID', key['displayLabel'])
            self.assertEqual(len(data.items()), 3, 'Old values remain available to saved maps')

    def test_special_pickups_explain_their_configuration_without_hiding_upgrades(self):
        names=['Credits','AugmentationCannister','AugmentationUpgradeCannister','VialAmbrosia']
        money,can,upgrade,vial=inventory_catalog([raw('DeusEx.'+n,n,'Pickups') for n in names])
        self.assertIn('Give credits',money['warning'])
        self.assertIn('Inspector > Augmentations',can['warning'])
        self.assertTrue(money['needsSetup'] and can['needsSetup'])
        self.assertFalse(upgrade.get('needsSetup') or upgrade.get('internal'))
        self.assertIn('does not automatically advance',vial['warning'])
        self.assertTrue(all(placement_metadata(x) for x in [money,can,upgrade,vial]))


if __name__ == '__main__':
    unittest.main()
