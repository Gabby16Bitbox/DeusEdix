"""Tools > Weapons: a model of the project made a weapon of the game (static/weapon-editor.js).

In Deus Ex the first-person weapon is one model with the player's arms in it (PlayerViewMesh): its own frames for
Select, Shoot, Reload, Idle... and texture slots the game fills with the player's hands (GetWeaponHandTex). The
editor takes a weapon of the game as the base, keeps its arms, puts the new model in their hands (it follows the
old gun's every move) and imports the result as a model of the project (<Name>FP). This module keeps the weapon's
settings (weapons/<Name>.json) and writes its class, compiled with the project's scripts (scripts.py): it extends
DeusExWeapon with the base's values, loads its models when the game runs and gives the arms the player's hands.
"""
import json
import re

import settings

FOLDER = settings.PROJECT / 'tools' / 'mapkit' / 'weapons'
NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_]{1,30}$')
PREFIX = 'UCW_'

# The weapons of the game a new one can take the arms and moves of. hands: the texture slots of the arms (the game
# gives them the player's hands), muzzle: the slot of the muzzle flash (DeusExWeapon swaps MultiSkins[2]), gun: the
# slots of the old gun (left out). defaults: the base's own values (its class's defaultproperties, without its
# meshes, names and multiplayer values), the new weapon starts from them.
BASES = {
    'pistol': dict(
        label='Pistol (one hand)', mesh='DeusExItems.Glock', hands=[0, 1], muzzle=2, gun=[3],
        pickup='DeusExItems.GlockPickup', third='DeusExItems.Glock3rd', icon=[46, 28],
        defaults='''LowAmmoWaterMark=6
GoverningSkill=Class'DeusEx.SkillWeaponPistol'
EnviroEffective=ENVEFF_Air
Concealability=CONC_Visual
ShotTime=0.600000
reloadTime=2.000000
HitDamage=14
maxRange=4800
AccurateRange=2400
BaseAccuracy=0.700000
recoilStrength=0.300000
PenetrationHitDamage=8
RicochetHitDamage=4
AmmoName=Class'DeusEx.Ammo10mm'
ReloadCount=6
PickupAmmoCount=6
bInstantHit=True
FireOffset=(X=-22.000000,Y=10.000000,Z=14.000000)
shakemag=50.000000
FireSound=Sound'DeusExSounds.Weapons.PistolFire'
CockingSound=Sound'DeusExSounds.Weapons.PistolReload'
SelectSound=Sound'DeusExSounds.Weapons.PistolSelect'
InventoryGroup=2
PlayerViewOffset=(X=22.000000,Y=-10.000000,Z=-14.000000)
Icon=Texture'DeusExUI.Icons.BeltIconPistol'
largeIcon=Texture'DeusExUI.Icons.LargeIconPistol'
largeIconWidth=46
largeIconHeight=28
CollisionRadius=7.000000
CollisionHeight=1.000000'''),
    'rifle': dict(
        label='Assault rifle (two hands)', mesh='DeusExItems.AssaultGun', hands=[0, 3], muzzle=2, gun=[1],
        pickup='DeusExItems.AssaultGunPickup', third='DeusExItems.AssaultGun3rd', icon=[94, 65],
        defaults='''LowAmmoWaterMark=30
GoverningSkill=Class'DeusEx.SkillWeaponRifle'
EnviroEffective=ENVEFF_Air
Concealability=CONC_Visual
bAutomatic=True
ShotTime=0.100000
reloadTime=3.000000
HitDamage=4
BaseAccuracy=0.700000
recoilStrength=0.500000
MinWeaponAcc=0.200000
PenetrationHitDamage=2
RicochetHitDamage=2
AmmoName=Class'DeusEx.Ammo762mm'
ReloadCount=30
PickupAmmoCount=30
bInstantHit=True
FireOffset=(X=-16.000000,Y=5.000000,Z=11.500000)
shakemag=200.000000
FireSound=Sound'DeusExSounds.Weapons.AssaultGunFire'
CockingSound=Sound'DeusExSounds.Weapons.AssaultGunReload'
SelectSound=Sound'DeusExSounds.Weapons.AssaultGunSelect'
InventoryGroup=4
PlayerViewOffset=(X=16.000000,Y=-5.000000,Z=-11.500000)
ThirdPersonScale=1.250000
LandSound=Sound'DeusExSounds.Generic.DropMediumWeapon'
Icon=Texture'DeusExUI.Icons.BeltIconAssaultGun'
largeIcon=Texture'DeusExUI.Icons.LargeIconAssaultGun'
largeIconWidth=94
largeIconHeight=65
invSlotsX=2
invSlotsY=2
CollisionRadius=15.000000
CollisionHeight=1.100000
Mass=30.000000'''),
}
AMMO = ['Ammo10mm', 'Ammo762mm', 'Ammo3006', 'AmmoShell', 'AmmoSabot', 'Ammo20mm', 'AmmoRocket', 'AmmoDartPoison', 'AmmoPlasma']
# the values the editor lets one change: name -> (kind, low, high)
STATS = dict(HitDamage=('int', 1, 1000), ReloadCount=('int', 1, 500), PickupAmmoCount=('int', 0, 500),
             ShotTime=('float', 0.02, 10), reloadTime=('float', 0.1, 20), BaseAccuracy=('float', 0, 1),
             maxRange=('int', 64, 65536), AccurateRange=('int', 64, 65536), recoilStrength=('float', 0, 5),
             bAutomatic=('bool', 0, 1), bHasScope=('bool', 0, 1), ScopeFOV=('int', 3, 60))


AMMO_FOLDER = FOLDER / 'ammo'
AMMO_PREFIX = 'UCA_'
AMMO_CLASS = '''//=============================================================================
// %(label)s: ammunition made in the Weapon editor (as %(base)s). Made again at each Save: changes here are lost.
//=============================================================================
class %(cls)s extends %(base)s;

var string ModelPickup;

// its model is the project's (the models package), read when the game runs
function LoadModel()
{
	local Mesh m;

	m = Mesh(DynamicLoadObject(ModelPickup, class'Mesh', True));
	if (m != None)
	{
		PickupViewMesh = m;
		Default.PickupViewMesh = m;
		if (Owner == None)
			Mesh = m;
	}
}

function PostBeginPlay()
{
	LoadModel();
	Super.PostBeginPlay();
}

function TravelPostAccept()
{
	LoadModel();
	Super.TravelPostAccept();
}

defaultproperties
{
     AmmoAmount=%(amount)d
     MaxAmmo=%(max)d
     ItemName="%(label)s"
     beltDescription="%(belt)s"
     Description="%(desc)s"
     ModelPickup="%(models)s.UCM_%(name)s"
}
'''


def ammo_names():
    """The project's own ammunition (Weapons > + New ammunition)."""
    return sorted(p.stem for p in AMMO_FOLDER.glob('*.json')) if AMMO_FOLDER.is_dir() else []


def ammo_class_text(a):
    """A new kind of ammunition: a game ammunition's behaviour (icons, shell casings) with its own name, amounts and
    model; the game counts it apart (a weapon takes the ammunition class it names, not its relatives)."""
    label = _text(a.get('label') or a['name'], 40)
    return (AMMO_CLASS % dict(label=label, base=a['base'], cls=AMMO_PREFIX + a['name'], amount=max(1, min(999, int(a.get('amount') or 10))),
                              max=max(1, min(9999, int(a.get('max') or 100))), belt=label.upper()[:14],
                              desc=_text(a.get('description') or label, 400), models=settings.MODELS_PACKAGE, name=a['name'])
            ).replace('\n', '\r\n')


def save_ammo(body):
    """body: {name, base (a game ammunition), label, description, amount, max}: writes the class, compiles."""
    import scripts
    name = _name(body.get('name'))
    if body.get('base') not in AMMO:
        raise ValueError('Choose the game ammunition it behaves like.')
    a = dict(name=name, base=body['base'], label=_text(body.get('label') or name, 40), description=_text(body.get('description'), 400),
             amount=int(body.get('amount') or 10), max=int(body.get('max') or 100))
    AMMO_FOLDER.mkdir(parents=True, exist_ok=True)
    (AMMO_FOLDER / (name + '.json')).write_text(json.dumps(a, indent=1), encoding='utf-8')
    scripts.CLASSES.mkdir(parents=True, exist_ok=True)
    (scripts.CLASSES / (AMMO_PREFIX + name + '.uc')).write_bytes(ammo_class_text(a).encode('latin1', 'replace'))
    r = scripts.compile()
    r['cls'] = '%s.%s%s' % (scripts.PACKAGE, AMMO_PREFIX, name)
    return r


def _view_offset(b):
    m = re.search(r'PlayerViewOffset=\(X=([-\d.]+),Y=([-\d.]+),Z=([-\d.]+)\)', b['defaults'])
    return [float(v) for v in m.groups()] if m else [20.0, -10.0, -14.0]


def bases():
    # view: PlayerViewOffset; the game draws the held model 0.9/FOV (75) x 100 of it from the eye, its side turned
    # by the hand the player holds it with (Weapon.SetHand): the editor's view stands where the eye is
    return [dict(id=k, label=b['label'], mesh=b['mesh'], hands=b['hands'], muzzle=b['muzzle'], gun=b['gun'], view=_view_offset(b),
                 pickup=b['pickup'], third=b['third'], icon=b['icon']) for k, b in BASES.items()]


def names():
    return sorted(p.stem for p in FOLDER.glob('*.json') if not p.name.endswith('.gun.json')) if FOLDER.is_dir() else []  # <Name>.gun.json: its model


def read(name):
    return json.loads((FOLDER / (_name(name) + '.json')).read_text(encoding='utf-8'))


def _name(name):
    if not NAME.match(name or ''):
        raise ValueError('A weapon name has letters, digits and _ only, starts with a letter, 2 to 31 characters.')
    return name


def _text(s, n):
    return str(s or '').replace('"', "'").replace('\\', '/').replace('\n', ' ')[:n]


def class_text(w):
    """The weapon's UnrealScript class (in the project's scripts package)."""
    import scripts
    base = BASES[w['base']]
    models = settings.MODELS_PACKAGE
    given = {k for k in w.get('stats', {}) if k in STATS}
    arms = w.get('arms')
    dropped = given | {'AmmoName'} | ({'PlayerViewOffset'} if arms else set())
    lines = [l for l in base['defaults'].splitlines() if l.split('=')[0].split('(')[0] not in dropped]
    if arms:                                                    # drawn from the eye as the other model wants
        lines.append('PlayerViewOffset=(X=%.6f,Y=%.6f,Z=%.6f)' % tuple(arms['view']))
    for k, (kind, lo, hi) in STATS.items():
        if k not in w.get('stats', {}):
            continue
        v = w['stats'][k]
        if kind == 'bool':
            lines.append('%s=%s' % (k, 'True' if v else 'False'))
        elif kind == 'int':
            lines.append('%s=%d' % (k, max(lo, min(hi, int(v)))))
        else:
            lines.append('%s=%.6f' % (k, max(lo, min(hi, float(v)))))
    if w.get('ammo') in AMMO:
        lines.append("AmmoName=Class'DeusEx.%s'" % w['ammo'])
    elif str(w.get('ammo') or '').startswith(AMMO_PREFIX) and w['ammo'][len(AMMO_PREFIX):] in ammo_names():
        lines.append("AmmoName=Class'%s.%s'" % (scripts.PACKAGE, w['ammo']))      # the project's own
    else:
        lines.append("AmmoName=Class'DeusEx.%s'" % re.search(r"DeusEx\.(\w+)'", base['defaults'].split('AmmoName=')[1]).group(1))
    slots = w.get('hands') or base['hands']
    hands = ''.join('\t\tMultiSkins[%d] = GetWeaponHandTex();\n' % i for i in slots)
    clear = ''.join('\t\tMultiSkins[%d] = None;\n' % i for i in slots)
    label = _text(w.get('label') or w['name'], 40)
    lines += ['ItemName="%s"' % label, 'beltDescription="%s"' % label.upper()[:14],
              'Description="%s"' % _text(w.get('description') or label, 400),
              'ModelFP="%s.UCM_%sFP"' % (models, w['name']), 'ModelPickup="%s.UCM_%s"' % (models, w['name']),
              'Model3rd="%s.UCM_%s3rd"' % (models, w['name']),
              'IconBelt="%s.Icons.UCI_%s_belt"' % (models, w['name']), 'IconLarge="%s.Icons.UCI_%s_large"' % (models, w['name'])]
    if w.get('scope_pic'):
        lines.append('ScopeSight="%s.Icons.UCI_%s_scope"' % (models, w['name']))
    for key, var in (('fire', 'SoundFire'), ('reload', 'SoundReload'), ('select', 'SoundSelect')):
        s = str((w.get('sounds') or {}).get(key) or '')
        if re.fullmatch(r'\w+(\.\w+){1,3}', s):
            lines.append('%s="%s"' % (var, s))
    return ('''//=============================================================================
// %(label)s: a weapon made in the Weapon editor (the %(base)s's arms and moves). Made again at
// each Save of the weapon: changes here are lost.
//=============================================================================
class %(cls)s extends DeusExWeapon;

var string ModelFP, ModelPickup, Model3rd, IconBelt, IconLarge, SoundFire, SoundReload, SoundSelect, ScopeSight;
var Texture ScopeTex, Black;

// its models, icons and sounds are the project's (or the game's), read when the game runs: nothing to load to compile
simulated function LoadModels()
{
	local Mesh m;
	local Texture t;
	local Sound s;

	m = Mesh(DynamicLoadObject(ModelFP, class'Mesh', True));
	if (m != None)
	{
		PlayerViewMesh = m;
		Default.PlayerViewMesh = m;
	}
	m = Mesh(DynamicLoadObject(ModelPickup, class'Mesh', True));
	if (m != None)
	{
		PickupViewMesh = m;
		ThirdPersonMesh = m;
		Default.PickupViewMesh = m;
		Default.ThirdPersonMesh = m;
		if (Owner == None)
			Mesh = m;
	}
	m = Mesh(DynamicLoadObject(Model3rd, class'Mesh', True));
	if (m != None)
	{
		ThirdPersonMesh = m;
		Default.ThirdPersonMesh = m;
	}
	t = Texture(DynamicLoadObject(IconBelt, class'Texture', True));
	if (t != None)
	{
		Icon = t;
		Default.Icon = t;
	}
	t = Texture(DynamicLoadObject(IconLarge, class'Texture', True));
	if (t != None)
	{
		largeIcon = t;
		Default.largeIcon = t;
	}
	if (ScopeSight != "")
	{
		ScopeTex = Texture(DynamicLoadObject(ScopeSight, class'Texture', True));
		Black = Texture(DynamicLoadObject("Extension.Solid", class'Texture', True));
	}
	if (SoundFire != "")
	{
		s = Sound(DynamicLoadObject(SoundFire, class'Sound', True));
		if (s != None) { FireSound = s; Default.FireSound = s; }
	}
	if (SoundReload != "")
	{
		s = Sound(DynamicLoadObject(SoundReload, class'Sound', True));
		if (s != None) { CockingSound = s; Default.CockingSound = s; }
	}
	if (SoundSelect != "")
	{
		s = Sound(DynamicLoadObject(SoundSelect, class'Sound', True));
		if (s != None) { SelectSound = s; Default.SelectSound = s; }
	}
}

function PostBeginPlay()
{
	LoadModels();
	Super.PostBeginPlay();
}

function TravelPostAccept()
{
	LoadModels();
	Super.TravelPostAccept();
}

// its own scope sight: the zoom alone (the game's scope window, with the game's sight, stays closed) ...
simulated function RefreshScopeDisplay(DeusExPlayer player, bool bInstant, bool bScopeOn)
{
	if (ScopeTex == None)
	{
		Super.RefreshScopeDisplay(player, bInstant, bScopeOn);
		return;
	}
	if (player == None)
		return;
	if (bScopeOn && bInstant)
		player.SetFOVAngle(ScopeFOV);
	else if (bScopeOn)
		player.DesiredFOV = ScopeFOV;
	else
		player.DesiredFOV = player.Default.DefaultFOV;
	ResetShake();
}

// ... and the sight drawn over the view: the picture as a square in the middle, black at its sides
simulated function DrawScope(canvas Canvas)
{
	local float s, x;

	s = Canvas.ClipY;
	x = (Canvas.ClipX - s) / 2;
	Canvas.Style = 1;
	if (Black != None && x > 0)
	{
		Canvas.DrawColor.R = 0;
		Canvas.DrawColor.G = 0;
		Canvas.DrawColor.B = 0;
		Canvas.SetPos(0, 0);
		Canvas.DrawTile(Black, x + 1, Canvas.ClipY, 0, 0, Black.USize, Black.VSize);
		Canvas.SetPos(x + s - 1, 0);
		Canvas.DrawTile(Black, Canvas.ClipX - x - s + 1, Canvas.ClipY, 0, 0, Black.USize, Black.VSize);
	}
	Canvas.DrawColor.R = 255;
	Canvas.DrawColor.G = 255;
	Canvas.DrawColor.B = 255;
	Canvas.Style = 2;
	Canvas.SetPos(x, 0);
	Canvas.DrawTile(ScopeTex, s, s, 0, 0, ScopeTex.USize, ScopeTex.VSize);
	Canvas.Style = 1;
}

// the arms take the player's hands (as the game's own weapons do)
simulated event RenderOverlays(canvas Canvas)
{
	if (bZoomed && ScopeTex != None && DeusExPlayer(Owner) != None)
	{
		DrawScope(Canvas);
		return;
	}
	if (DeusExPlayer(Owner) != None)
	{
%(hands)s		Super.RenderOverlays(Canvas);
%(clear)s	}
	else
		Super.RenderOverlays(Canvas);
}

defaultproperties
{
%(props)s
}
''' % dict(label=label, base=base['label'].split(' (')[0].lower(), cls=PREFIX + w['name'], hands=hands, clear=clear,
           props='\n'.join('     ' + l for l in lines))).replace('\n', '\r\n')


def save(body):
    """body: {name, base, label, description, ammo, stats, placement (the editor's, kept to edit again)}.
    Writes the settings and the class, compiles the scripts' package: dict(ok, lines, problems, cls)."""
    import scripts
    name = _name(body.get('name'))
    if body.get('base') not in BASES:
        raise ValueError('Choose the weapon of the game to start from.')
    stats = {k: v for k, v in (body.get('stats') or {}).items() if k in STATS}
    ammo = str(body.get('ammo') or '')
    ok_ammo = ammo in AMMO or (ammo.startswith(AMMO_PREFIX) and ammo[len(AMMO_PREFIX):] in ammo_names())
    sounds = {k: str(v) for k, v in (body.get('sounds') or {}).items() if k in ('fire', 'reload', 'select') and v}
    w = dict(name=name, base=body['base'], label=_text(body.get('label') or name, 40),
             description=_text(body.get('description'), 400), ammo=ammo if ok_ammo else '',
             stats=stats, sounds=sounds, placement=body.get('placement') or {})
    hands = [int(s) for s in (body.get('hands') or []) if str(s).isdigit() and 0 <= int(s) <= 7][:8]
    if hands:
        w['hands'] = hands                                      # the baked model's slots the player's hands go on
    arms = body.get('arms') or None                             # the arms of another first-person model
    if arms and re.fullmatch(r'\w+(\.\w+){1,2}', str(arms.get('mesh') or '')):
        roles = {str(int(k)): v for k, v in (arms.get('roles') or {}).items()
                 if str(k).isdigit() and v in ('hands', 'keep', 'muzzle', 'gun')}
        view = [max(-200.0, min(200.0, float(v))) for v in (arms.get('view') or [])[:3]]
        if len(view) == 3:
            w['arms'] = dict(mesh=arms['mesh'], roles=roles, view=view)
    sight = str(body.get('scope_pic') or '')                    # the scope's own sight (a picture of the person's)
    if sight.startswith('data:image/') and len(sight) < 1500000:
        w['scope_pic'] = sight
    icon = str(body.get('icon') or '')                          # a picture of the person's own for the icons
    if icon.startswith('data:image/') and len(icon) < 600000:
        w['icon'] = icon
    FOLDER.mkdir(parents=True, exist_ok=True)
    (FOLDER / (name + '.json')).write_text(json.dumps(w, indent=1), encoding='utf-8')
    if body.get('gun'):                                         # the model as read, to place it again later
        (FOLDER / (name + '.gun.json')).write_text(json.dumps(body['gun']), encoding='utf-8')
    scripts.CLASSES.mkdir(parents=True, exist_ok=True)
    (scripts.CLASSES / (PREFIX + name + '.uc')).write_bytes(class_text(w).encode('latin1', 'replace'))
    r = scripts.compile()
    r['cls'] = '%s.%s%s' % (scripts.PACKAGE, PREFIX, name)
    return r


def gun(name):
    """The weapon's model as the editor read it (its points, corners, materials): {} if it was not kept."""
    p = FOLDER / (_name(name) + '.gun.json')
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else {}


def delete(name):
    import scripts
    name = _name(name)
    (FOLDER / (name + '.json')).unlink(missing_ok=True)
    (FOLDER / (name + '.gun.json')).unlink(missing_ok=True)
    (scripts.CLASSES / (PREFIX + name + '.uc')).unlink(missing_ok=True)
    return scripts.compile()
