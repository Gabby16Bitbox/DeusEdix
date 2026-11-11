"""The conditions of the editor's rules and of the Story's events: one model for both (editor/LOGIC.md, "Conditions").

A condition is a dict. A state keeps the Story's own shape; the other kinds say what they are:

    {'flag': 'Crypt_Generator', 'is': True}                       a state (flag) is true / false
    {'type': 'item', 'item': 'DeusEx.Multitool', 'has': True}     JC carries / does not carry an object
    {'type': 'alive', 'actor': 'Guard1', 'is': True}              a character is alive (not killed, not knocked out)
    {'type': 'skill', 'skill': 'SkillLockpicking', 'level': 2}    JC's skill is at least: 1 trained ... 3 master
    {'type': 'counter', 'counter': 'Levers', 'op': '>=', 'value': 3}
    {'type': 'credits', 'op': '>=', 'value': 100}
    {'type': 'near', 'at': [x, y, z], 'radius': 256, 'is': True}  the player is / is not within radius of a point
    {'type': 'health', 'op': '<', 'value': 30}                    the player's health, energy, skill points to spend
    {'type': 'energy', 'op': '<', 'value': 20}                    (P9 slice 2, as credits)
    {'type': 'skillpoints', 'op': '>=', 'value': 2000}
    {'type': 'aug', 'aug': 'AugSpeed', 'how': 'on', 'is': True}   an augmentation the player has ('has'), has turned on
                                                                  ('on') or has at a level or more ('level', 'level': 1-4)
    {'type': 'water', 'is': True}                                 the player is in water (a water zone)
    {'type': 'zone', 'zone': 'WaterZone0', 'is': True}            the player is in a zone of the map (its name)
    {'type': 'items', 'item': 'DeusEx.DeusExWeapon', 'op': '>=', 'value': 1}   how many things of a kind the player
                                                                  carries: the class or any class under it, a stack
                                                                  of pickups counting its copies

check() validates a list; encode() is the string UCLink.Cond[i] holds and UCEditorStory.Holds() evaluates in the
game; unreal() is the UnrealScript a Story event compiles it into (a state stays GetF, the others call Holds).
A row the editor shows but nobody has filled in yet (unfinished) is fine in a draft and an error when building.
"""
import math
import re
import unicodedata

KINDS = ('flag', 'item', 'alive', 'skill', 'counter', 'credits', 'near',
         'health', 'energy', 'skillpoints', 'aug', 'water', 'zone', 'items')
NUMBERS = ('credits', 'health', 'energy', 'skillpoints')      # the player's numbers: {op, value}
AUG_HOW = ('has', 'on', 'level')
OPS = ('<', '<=', '==', '!=', '>=', '>')
MAX_CONDITIONS = 8                    # a rule's: UCLink.Cond[8] (the Story compiles its own, without a limit)
_NAME = re.compile(r'\w+', re.ASCII)  # the map's own names: what the game writes in a map (latin-1 text, ASCII names)
_CLASS = re.compile(r'\w+\.\w+', re.ASCII)


def ident(s, fallback='X'):
    """A valid UnrealScript name: what the game will call a state, a counter, a goal or a character. ASCII letters,
    digits and underscores only (the script compiler takes nothing else in a name): an accented letter loses its
    accent (città -> citta), anything else becomes _."""
    s = ''.join(c for c in unicodedata.normalize('NFKD', str(s or '').strip()) if not unicodedata.combining(c))
    s = re.sub(r'[^A-Za-z0-9_]', '_', s)
    if not s or s[0] in '0123456789':
        s = fallback + '_' + s
    return s[:60]


def name_of(s):
    """A state's or a counter's name as the game writes it, the same for a rule, its conditions and the Story."""
    return ident(s)


def kind(c):
    """The kind (KINDS); a state has no 'type' (the Story's {flag, is})."""
    return c.get('type') or ('flag' if 'flag' in c else None)


def _value(v, what):
    """A compared value: a whole number, or (Advanced, P9 slice 5) a formula of counters such as "Alarms + 1"."""
    import formula
    if isinstance(v, str) and formula.is_formula(v):
        try:
            formula.tokens(v)
        except formula.FormulaError as exc:
            raise ValueError('%s: %s.' % (what, exc)) from exc
        return
    if isinstance(v, str):
        try:
            v = float(v.strip().replace(',', '.'))
        except ValueError:
            pass
    _int(v, what)


def _number(v):
    """The compared value as the game reads it (formula.game_number): '3', or '=@Alarms,1,+'."""
    import formula
    return formula.game_number(v)


def _int(v, what, lo=-2 ** 31, hi=2 ** 31 - 1):
    if (isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not math.isfinite(v))
            or v != int(v) or not lo <= v <= hi):
        raise ValueError('%s must be a whole number from %d to %d.' % (what, lo, hi))
    return int(v)


def _named(c, key, what):
    if not isinstance(c.get(key), str) or not _NAME.fullmatch(c[key]):
        raise ValueError('%s needs a name (letters, digits, underscores).' % what)
    return c[key]


def complete(conditions):
    """Without the rows left empty (a state row added in the editor and never filled, a row with nothing in it): the
    Story has always skipped them, and saved stories may hold some."""
    if not isinstance(conditions, list):
        return conditions
    return [c for c in conditions if not (isinstance(c, dict) and (kind(c) is None and not any(c.values())
                                                                   or kind(c) == 'flag' and not str(c.get('flag') or '').strip()))]


def unfinished(c):
    """A row added in the editor whose object, item or counter is not chosen yet (conditions.js conditionProblem)."""
    key = {'item': 'item', 'alive': 'actor', 'counter': 'counter', 'items': 'item', 'zone': 'zone',
           'aug': 'aug'}.get(kind(c)) if isinstance(c, dict) else None
    return bool(key) and not str(c.get(key) or '').strip()


def check(conditions, kinds=KINDS, limit=None):
    """The conditions, validated (empty state rows left out: complete): a list of the given kinds, at most `limit`
    long (a rule's: MAX_CONDITIONS). Raises ValueError with what is wrong (the editor shows it)."""
    if conditions is None:
        return []
    if not isinstance(conditions, list):
        raise ValueError('The conditions must be a list.')
    conditions = complete(conditions)
    if limit is not None and len(conditions) > limit:
        raise ValueError('A rule can have at most %d conditions.' % limit)
    for c in conditions:
        k = kind(c) if isinstance(c, dict) else None
        if k not in kinds:
            raise ValueError('Unknown condition: %r. It can be: %s.' % (k, ', '.join(kinds)))
        if k == 'flag':
            if not isinstance(c.get('flag'), str) or not c['flag'].strip():
                raise ValueError('A state condition needs the name of the state.')
        elif k == 'item':
            if not isinstance(c.get('item'), str) or not _CLASS.fullmatch(c['item']):
                raise ValueError('An item condition needs a class like DeusEx.Multitool.')
        elif k == 'alive':
            _named(c, 'actor', 'An alive condition')
        elif k == 'skill':
            _named(c, 'skill', 'A skill condition')
            _int(c.get('level'), 'A skill level', 1, 3)
        elif k in ('counter', 'items') or k in NUMBERS:
            if k == 'counter' and (not isinstance(c.get('counter'), str) or not c['counter'].strip()):
                raise ValueError('A counter condition needs the name of the counter.')
            if k == 'items' and (not isinstance(c.get('item'), str) or not _CLASS.fullmatch(c['item'])):
                raise ValueError('A "things of a kind" condition needs a class like DeusEx.DeusExWeapon.')
            if c.get('op') not in OPS:
                raise ValueError('A comparison must be one of %s.' % ' '.join(OPS))
            _value(c.get('value'), 'A ' + k + ' value')
        elif k == 'near':
            at = c.get('at')
            if (not isinstance(at, list) or len(at) != 3
                    or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or abs(v) > 1e6 for v in at)):
                raise ValueError('A "near a point" condition needs the point (x, y, z).')
            r = c.get('radius', 256)
            if isinstance(r, bool) or not isinstance(r, (int, float)) or not math.isfinite(r) or not 1 <= r <= 65536:
                raise ValueError('A "near a point" condition needs a distance from 1 to 65536 units.')
        elif k == 'aug':
            _named(c, 'aug', 'An augmentation condition')
            if c.get('how', 'has') not in AUG_HOW:
                raise ValueError('An augmentation condition is one of: %s.' % ', '.join(AUG_HOW))
            if c.get('how') == 'level':
                _int(c.get('level'), 'An augmentation level', 1, 4)
        elif k == 'zone':
            _named(c, 'zone', 'A zone condition')
    return list(conditions)


def _yes(c, key):
    return '1' if c.get(key, True) else '0'                  # as the Story always read it: anything true


OPPOSITE = {'>=': '<', '<': '>=', '>': '<=', '<=': '>', '==': '!=', '!=': '=='}


def negate(c):
    """The condition that holds exactly when this one does not, or None when the game cannot say it (a skill);
    static/action-list.js negate is the same."""
    if not isinstance(c, dict):
        return None
    k = kind(c)
    if k in ('flag', 'alive', 'near', 'aug', 'water', 'zone'):
        return dict(c, **{'is': _yes(c, 'is') == '0'})
    if k == 'item':
        return dict(c, has=_yes(c, 'has') == '0')
    if (k in ('counter', 'items') or k in NUMBERS) and c.get('op') in OPPOSITE:
        return dict(c, op=OPPOSITE[c['op']])
    return None


def encode(c):
    """The string the game evaluates (UCEditorStory.Holds): kind|arguments, no quotes, no spaces."""
    k = kind(c)
    if k == 'flag':
        return 'flag|%s|%s' % (name_of(c['flag']), _yes(c, 'is'))
    if k == 'item':
        return 'item|%s|%s' % (c['item'], _yes(c, 'has'))
    if k == 'alive':
        return 'alive|%s|%s' % (c['actor'], _yes(c, 'is'))
    if k == 'skill':
        return 'skill|%s|%d' % (c['skill'], int(c['level']))
    if k == 'counter':
        return 'count|%s|%s|%s' % (name_of(c['counter']), c['op'], _number(c['value']))
    if k == 'near':                                          # whole units: the game reads them back with float()
        x, y, z = (int(round(v)) for v in c['at'])
        return 'near|%d|%d|%d|%d|%s' % (x, y, z, int(round(c.get('radius', 256))), _yes(c, 'is'))
    if k == 'aug':                                           # aug|AugSpeed|on|0|1, aug|AugSpeed|level|2|1
        how = c.get('how', 'has')
        return 'aug|%s|%s|%d|%s' % (c['aug'], how, int(c['level']) if how == 'level' else 0, _yes(c, 'is'))
    if k == 'water':
        return 'water|%s' % _yes(c, 'is')
    if k == 'zone':
        return 'zone|%s|%s' % (c['zone'], _yes(c, 'is'))
    if k == 'items':
        return 'items|%s|%s|%s' % (c['item'], c['op'], _number(c['value']))
    return '%s|%s|%s' % (k, c['op'], _number(c['value']))  # credits, health, energy, skillpoints


def unreal(c):
    """The condition as an UnrealScript expression of a UCEditorStory subclass (the Story's generated code)."""
    if kind(c) == 'flag':
        return ("GetF('%s')" if c.get('is', True) else "!GetF('%s')") % ident(c['flag'])
    return 'Holds("%s")' % encode(c)
