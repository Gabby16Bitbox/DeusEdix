"""The conditions of the editor's rules and of the Story's events: one model for both (editor/LOGIC.md, "Conditions").

A condition is a dict. A state keeps the Story's own shape; the other kinds say what they are:

    {'flag': 'Crypt_Generator', 'is': True}                       a state (flag) is true / false
    {'type': 'item', 'item': 'DeusEx.Multitool', 'has': True}     JC carries / does not carry an object
    {'type': 'alive', 'actor': 'Guard1', 'is': True}              a character is alive (not killed, not knocked out)
    {'type': 'skill', 'skill': 'SkillLockpicking', 'level': 2}    JC's skill is at least: 1 trained ... 3 master
    {'type': 'counter', 'counter': 'Levers', 'op': '>=', 'value': 3}
    {'type': 'credits', 'op': '>=', 'value': 100}

check() validates a list; encode() is the string UCLink.Cond[i] holds and UCEditorStory.Holds() evaluates in the
game; unreal() is the UnrealScript a Story event compiles it into (a state stays GetF, the others call Holds).
A row the editor shows but nobody has filled in yet (unfinished) is fine in a draft and an error when building.
"""
import math
import re
import unicodedata

KINDS = ('flag', 'item', 'alive', 'skill', 'counter', 'credits')
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
    """flag, item, alive, skill, counter or credits; a state has no 'type' (the Story's {flag, is})."""
    return c.get('type') or ('flag' if 'flag' in c else None)


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
    key = {'item': 'item', 'alive': 'actor', 'counter': 'counter'}.get(kind(c)) if isinstance(c, dict) else None
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
        elif k in ('counter', 'credits'):
            if k == 'counter' and (not isinstance(c.get('counter'), str) or not c['counter'].strip()):
                raise ValueError('A counter condition needs the name of the counter.')
            if c.get('op') not in OPS:
                raise ValueError('A comparison must be one of %s.' % ' '.join(OPS))
            _int(c.get('value'), 'A ' + k + ' value')
    return list(conditions)


def _yes(c, key):
    return '1' if c.get(key, True) else '0'                  # as the Story always read it: anything true


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
        return 'count|%s|%s|%d' % (name_of(c['counter']), c['op'], int(c['value']))
    return 'credits|%s|%d' % (c['op'], int(c['value']))


def unreal(c):
    """The condition as an UnrealScript expression of a UCEditorStory subclass (the Story's generated code)."""
    if kind(c) == 'flag':
        return ("GetF('%s')" if c.get('is', True) else "!GetF('%s')") % ident(c['flag'])
    return 'Holds("%s")' % encode(c)
