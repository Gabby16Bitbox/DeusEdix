"""Presentation of inventory classes; never rename a class or rewrite a saved reference.

The exported catalog describes engine classes, not a menu of useful player rewards.
Keep technical classes in the API for existing maps, but mark them for the shared picker.
The Objects browser can still place items that need per-instance configuration.
"""
import re
from collections import Counter

CATEGORIES = ('Weapons', 'Ammo', 'Pickups')
PLACEHOLDER = re.compile(r'DEFAULT\s+\w+\s+NAME|REPORT THIS AS A BUG', re.I)
POLICY = {}


def _policy(cls, **fields):
    POLICY[cls.lower()] = fields


for suffix, name in [('LAM', 'LAM'), ('EMPGrenade', 'EMP grenade'),
                     ('GasGrenade', 'Gas grenade'), ('NanoVirusGrenade', 'Scramble grenade')]:
    _policy('DeusEx.Weapon' + suffix, name=name + ' (usable grenade)', group='Grenades')
    _policy('DeusEx.Ammo' + suffix, name=name + ' (ammo only)', internal=True,
            warning='Ammo only: this does not give an equippable grenade. Choose %s (usable grenade).' % name)

_policy('DeusEx.AmmoSecurityBot3', name='7.62x51mm ammo (security robot)', internal=True,
        warning='Internal security-robot ammo. For the player, use 7.62x51mm Ammo (Ammo762mm).')
_policy('DeusEx.AmmoBattery', name='Riot prod charger')
_policy('Revision.AmmoLaser', name='Laser charger (Revision)', group='Gameplay-specific',
        hint='Revision laser ammo; not a riot prod charger.')
_policy('Revision.WeaponGEPSpray', name='GEP gun (spray variant, Revision)', group='Gameplay-specific')
_policy('Revision.WeaponPlasmaSpray', name='Plasma rifle (spray variant, Revision)', group='Gameplay-specific')
_policy('Revision.WeaponLaserGun', name='Laser gun (Revision)', group='Gameplay-specific')
_policy('DeusEx.AugmentationUpgrade', name='Augmentation upgrade (dialogue alias)', internal=True,
        warning='Legacy dialogue alias. For a new pickup or reward, use Augmentation Upgrade Canister (AugmentationUpgradeCannister).')
_policy('DeusEx.POVCorpse', name='Carried body (internal)', internal=True,
        warning='Internal inventory representation of a carried body. Place a character or a body from the browser instead.')
_policy('DeusEx.NanoKeyRing', name='Nano key ring (internal)', internal=True,
        warning='The player already has a key ring. To give a door key, use the door action "Give the player its key".')
_policy('DeusEx.FakeFlare', name='Flare effect (internal)', internal=True,
        warning='Internal flare effect. Use Flare for a pickup the player can carry.')
_policy('DeusEx.NanoKey', name='NanoKey (set Key ID)', needsSetup=True,
        warning='Set Key ID when giving a NanoKey in a rule or dialogue, or in its Inspector when placed. Use the same Key ID on the door.')
_policy('DeusEx.AugmentationCannister', name='Augmentation canister (choose augmentations)', needsSetup=True,
        warning='For predictable choices, place this canister and set Inspector > Augmentations. Revision can randomize empty choices; Original cannot. For a direct reward use "Change an augmentation of the player".')
_policy('DeusEx.Credits', name='Credit chit (set amount)', needsSetup=True,
        warning='For an exact reward, use "Give credits". Placed credit chits have their own credit amount.')
_policy('DeusEx.WeaponModProjectile', name='Projectile weapon mod (Revision)', group='Gameplay-specific',
        warning='Not in Original Deus Ex. Requires a gameplay mode and weapon that support projectile-count mods; changing gameplay mode can make it unavailable or unusable.')
_policy('DeusEx.VialAmbrosia', name='Ambrosia vial (mission item)', group='Mission items',
        warning='A story item. Giving it does not automatically advance a mission; add a rule or dialogue condition.')
for _cls in ('WeaponDisguiseKit', 'WeaponShrinkGun', 'WeaponAssaultHeartgun'):
    _policy('DeusEx.' + _cls, group='Gameplay-specific',
            warning='Revision-specific weapon. Check support in the gameplay mode used by the player.')
_policy('Revision.WeaponPolyFlags', name='Polyflag tester (debug)', internal=True,
        warning='Developer testing weapon, not a normal player reward.')


def inventory_catalog(classes):
    """Return only classes actually exported from this project's game, with UI metadata.

    Full package identity is intentional: a mod's AmmoLAM is not DeusEx.AmmoLAM.
    Case-insensitive identity deduplication must not collapse distinct classes with equal names.
    """
    rows, seen = [], set()
    for c in classes:
        if c.get('cat') not in CATEGORIES:
            continue
        cls = '%s.%s' % (c['pkg'], c['cls'])
        key = cls.lower()
        if key in seen:
            continue
        seen.add(key)
        row = dict(cls=cls, name=c.get('name') or c['cls'], cat=c['cat'])
        if PLACEHOLDER.search(row['name']):
            row.update(name=c['cls'] + ' (internal)', internal=True,
                       warning='Engine helper class, not a normal player pickup.')
        if (c['pkg'].lower() in ('deusex', 'revision') and
                'invisibleweapon' in str(c.get('mesh', '')).lower()):
            row.update(internal=True, warning='NPC attack weapon. It is not a normal equippable player weapon.')
        if c['pkg'].lower() == 'revision':
            row.setdefault('group', 'Gameplay-specific')
            row.setdefault('hint', 'Available in Revision only. Test with the intended gameplay mode.')
        row.update(POLICY.get(key, {}))
        rows.append(row)
    counts = Counter(r['name'].casefold() for r in rows)
    for row in rows:
        if counts[row['name'].casefold()] > 1:
            row['name'] += ' (%s)' % row['cls']
    return rows


def placement_metadata(item):
    """None excludes engine helpers from new placement, not from existing map loading."""
    if item.get('internal'):
        return None
    return dict(displayLabel=item['name'], itemHint=item.get('warning') or item.get('hint', ''))
