"""'Play from here' of the map editor: the game opens on the installed map with JC where the editor's
camera is, after a mission state (one of the development mod's UCDbg* debug commands, which set the flags and jump
to their map) and extra flags; then the player has the controls (UCShotRunner step 'play').
A play scenario (static/play-scenarios.js) adds JC's loadout: the game's own console commands and the items at his
feet, run by the runner before that step (loadout_run).
"""
import math
import re
import sys
from pathlib import Path

ED = Path(__file__).resolve().parent
KIT = ED.parent
PROJECT = KIT.parents[1]
sys.path.insert(0, str(KIT))
import live  # noqa: E402
import settings  # noqa: E402

CLASSES = PROJECT / 'src' / settings.PACKAGE / 'Classes'
# what the debug commands prepare (their own comments are in Italian)
SETUPS_EN = {}   # English descriptions of a mod's own debug setups (UCDbg* classes), by class name


def setups(map_name):
    """The debug commands that end in this map: [{name, text}]."""
    out = []
    for f in sorted(CLASSES.glob('UCDbg*.uc')):
        t = f.read_text(encoding='latin1', errors='replace')
        m = re.search(r'Jump\("([^"#]+)', t)
        if not m or m.group(1).lower() != map_name.lower():
            continue
        d = re.search(r'//\s*%s\s*-\s*(.+)' % re.escape(f.stem), t)
        out.append(dict(name=f.stem, text=SETUPS_EN.get(f.stem) or (d.group(1).strip() if d else f.stem)))
    return out


def _same(a, b):
    a, b = Path(a), Path(b)
    if not (a.exists() and b.exists()) or a.stat().st_size != b.stat().st_size:
        return False
    return a.read_bytes() == b.read_bytes()


def pending_install(map_name, is_dx, out_dir, built_current):
    """What the game would miss: the last rebuild not installed, or the mod's copy not in the game yet."""
    mod = PROJECT / 'maps' / (map_name + '.dx')
    game = settings.MAPS_DIR / (map_name + '.dx')
    if is_dx:
        if built_current(map_name):
            return 'your last rebuild is not installed'
    else:
        out = Path(out_dir) / (map_name + '.dx')
        if out.exists() and not _same(out, mod):
            return 'your last rebuild is not installed'
    if mod.exists() and not _same(mod, game):
        return "the mod's copy of this map is not in the game yet"
    return ''


def flags_text(route, extra):
    """'UNATCORouteCommitted=1,Flag=1,Other=0' from the dialog's choices."""
    isolated = getattr(settings, 'PROJECT_KIND', 'legacy') in ('custom', 'tutorial')
    out = ['UNATCORouteCommitted=1'] if route and not isolated else []
    for item in re.split(r'[,\s;]+', extra or ''):
        if not item:
            continue
        name, _, value = item.partition('=')
        if re.fullmatch(r'\w+', name):
            out.append('%s=%s' % (name, '0' if value.strip() in ('0', 'false', 'False', 'no') else '1'))
    return ','.join(out)


def start(map_name, at, yaw, pitch, setup, flags, display_mode='external', steps=(), commands=()):
    """steps, commands: a scenario's loadout (loadout_run), done before JC gets the controls."""
    if setup and not (CLASSES / (setup + '.uc')).exists():
        raise ValueError('unknown mission state %s' % setup)
    return live.play(map_name, at=at, yaw=yaw, pitch=pitch, setup=setup, flags=flags, display_mode=display_mode,
                     steps=steps, commands=commands)


# ---------------------------------------------------------------- JC's loadout (play scenarios, G13)
# The game's console commands for it: the cheats (summon, augadd, god, invisible) work only with the game's cheats on,
# which `set` turns on for this game; the rest is `set` on the player and his skills. The runner execs them from a
# file (live.LOADOUT) in one step, and puts each item in front of JC with a step of its own (half a second each).
CHEATS_ON = 'set DeusExPlayer bCheatsEnabled True'
BODY = ('HealthHead', 'HealthTorso', 'HealthArmLeft', 'HealthArmRight', 'HealthLegLeft', 'HealthLegRight', 'Health')
CHEATS = {'god': 'god', 'invisible': 'invisible 1'}
# as static/play-scenarios.js: the items at JC's feet in all, of one item, skill points (the game's allskillpoints),
# credits
MAX_ITEMS, MAX_COUNT, MAX_SKILL_POINTS, MAX_CREDITS = 40, 20, 115900, 1000000


def class_label(cls, prefix):
    """'AugCloak' -> 'Cloak', 'SkillWeaponPistol' -> 'Weapon Pistol': a class's name as the lists show it."""
    name = cls[len(prefix):] if cls.startswith(prefix) and len(cls) > len(prefix) else cls
    return re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', name)


def loadout_catalog(items, classes):
    """What a loadout can name, for the page's lists and the check before Play: the items of the game and the mod
    (data.items: 'Package.Class', name, cat), the augmentations and the skills (the classes under Augmentation and Skill
    of props.defaults, by their short names, as the game's augadd and set find them)."""
    def under(base, prefix):
        return [dict(cls=c, name=class_label(c, prefix)) for c in sorted(classes, key=str.lower)
                if base in classes[c].get('parents', ())]
    return dict(items=[dict(cls=i['cls'], name=i['name'], cat=i['cat'],
                           **{k: i[k] for k in ('internal', 'needsSetup', 'group', 'hint', 'warning') if k in i}) for i in items],
                augs=under('Augmentation', 'Aug'), skills=under('Skill', 'Skill'))


def drop_points(at, yaw, n, ahead=40.0, apart=14.0, across=5):
    """Where n items lie in front of JC standing at `at` and facing `yaw` (65536 a turn): rows of `across` across his
    view, the first `ahead` units in front of him, `apart` units from each other, the middle of a row first."""
    turn = yaw * 2 * math.pi / 65536
    fx, fy = math.cos(turn), math.sin(turn)
    out = []
    for i in range(n):
        k = i % across
        side = (k + 1) // 2 * (1 if k % 2 else -1) * apart
        front = ahead + i // across * apart
        out.append((at[0] + fx * front - fy * side, at[1] + fy * front + fx * side, at[2]))
    return out


def _number(value, low, high):
    """A whole number from low to high, or None (not given, or not one)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != int(value) or not low <= value <= high:
        return None
    return int(value)


def loadout_run(loadout, at, yaw, catalog):
    """A scenario's loadout ({items: [{cls, count}], augs: [cls], skills: [{cls, level}], skillPoints, credits, health,
    cheat}) as what the runner does before JC gets the controls: dict(commands: the console commands it execs, steps:
    its 'spawn' steps for the items when the scenario puts JC at `at` (where he starts in the game, the game's summon
    puts them in front of him), lines: what the Play log says, the commands and what was left out). Classes not in
    `catalog` (loadout_catalog), counts and values out of range are left out and said, as Unity checks a scenario."""
    out = dict(commands=[], steps=[], lines=[])
    if not isinstance(loadout, dict) or not loadout:
        return out
    left = []
    names = {kind: {c['cls'].lower(): c['cls'] for c in catalog.get(kind, ())} for kind in ('items', 'augs', 'skills')}

    def known(kind, cls):
        found = names[kind].get(str(cls).lower())
        if not found:
            left.append('%s (not in the game or the mod)' % cls)
        return found
    items = []
    for row in loadout.get('items') or ():
        cls = known('items', (row or {}).get('cls', ''))
        count = _number((row or {}).get('count', 1), 1, MAX_COUNT)
        if cls and count is None:
            left.append('%s: %s is not a count from 1 to %d' % (cls, row.get('count'), MAX_COUNT))
        elif cls:
            room = MAX_ITEMS - len(items)
            if count > room:
                left.append('%s: %d of %d (at most %d items)' % (cls, count - room, count, MAX_ITEMS))
            items += [cls] * min(count, room)
    augs = [a for a in (known('augs', cls) for cls in loadout.get('augs') or ()) if a]
    skills = []
    for row in loadout.get('skills') or ():
        cls, level = known('skills', (row or {}).get('cls', '')), _number((row or {}).get('level'), 0, 3)
        if cls and level is None:
            left.append('%s: %s is not a level from 0 to 3' % (cls, row.get('level')))
        elif cls:
            skills.append((cls, level))
    values = {}
    for key, high, low in (('skillPoints', MAX_SKILL_POINTS, 0), ('credits', MAX_CREDITS, 0), ('health', 100, 1)):
        given = loadout.get(key)
        if given is not None:
            values[key] = _number(given, low, high)
            if values[key] is None:
                left.append('%s: %s is not a number from %d to %d' % (key, given, low, high))
    cheat = CHEATS.get(loadout.get('cheat') or '')
    summons = items if at is None else []
    commands = ['augadd %s' % a for a in augs] + ['set %s CurrentLevel %d' % s for s in skills]
    if values.get('skillPoints') is not None:
        commands.append('set DeusExPlayer SkillPointsAvail %d' % values['skillPoints'])
    if values.get('credits') is not None:
        commands.append('set DeusExPlayer Credits %d' % values['credits'])
    if values.get('health') is not None:
        commands += ['set DeusExPlayer %s %d' % (part, values['health']) for part in BODY]
    commands += ['summon %s' % cls for cls in summons] + ([cheat] if cheat else [])
    if augs or summons or cheat:
        commands.insert(0, CHEATS_ON)
    if at is not None:
        out['steps'] = ['i%d;spawn;%s;%.1f;%.1f;%.1f;%d' % (i, cls, x, y, z, int(yaw) % 65536)
                        for i, (cls, (x, y, z)) in enumerate(zip(items, drop_points(at, yaw, len(items))))]
    out['commands'] = commands
    if commands:
        out['lines'].append('Loadout: ' + ' | '.join(commands))
    if out['steps']:
        out['lines'].append('In front of JC: ' + ', '.join(cls.split('.')[-1] for cls in items))
    if left:
        out['lines'].append('Left out of the loadout: ' + '; '.join(left))
    return out
