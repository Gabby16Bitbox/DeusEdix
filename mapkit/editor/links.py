"""Interactions made in the map editor (Properties > Interactions, the Logic panel): "when this happens
to an object, do these things", without writing a Tag or an Event by hand. Saved in the map's edits:

edits['links'] = [{
    'id': 'L1', 'src': '<actor name>' ('' for the start of the map), 'when': WHEN, 'option': 0 (a computer's
    special option), 'near': 256 (when = 'near'), 'once': False, 'at': [x, y, z] (where the source is),
    'port': 'Sabotaged' (when = 'output': which output of a script, Tools > Scripts),
    'requires': [<conditions: conditions.py>],   # all must hold when it fires, or it does nothing that time
    'label': 'When JC uses Button1: open the door DeusExMover3',     # the sentence of the editor
    'do': [{'verb': VERB, 'target': '<actor name>' or '', 'delay': 0.0, 'a': '', 'b': '', 'c': ''}, ...]}]

The outputs and inputs each kind of object offers, and how the game hears each output, are data:
config/logic.json (logic_catalog.py). editor/LOGIC.md describes the whole: rules, conditions, scripts as blocks,
the logic log.

Each one becomes a UCLink actor of the editor's package (src/<settings.PACKAGE>/Classes/UCLink.uc): it hooks itself to its
object when the map starts (the object's Event becomes the link's Tag, the old event is still triggered)
and runs its actions, each after its delay. Lights a link turns on or off become non-static.

The building blocks of the Interactions (any model, any idea: a bomb to defuse, a generator to sabotage,
a hostage to free in time):
- Timer: a placed UCTimer (Objects > Triggers); verbs timerstart (a: seconds, empty = its own), timerstop,
  timerpause, timerresume; whens 'finished' (it ran out) and 'stopped' (an action stopped it).
- Usable object: edits['usable'] = {'<object name>': {'text': 'Defuse', 'secs': 3, 'crouch': False,
  'item': 'DeusEx.Multitool', 'consume': False, 'uses': 1, 'hidden': False, 'at': [x, y, z]}}, one UCUsable
  actor each; its 'used' rules run when JC has finished using it.
- A character uses an object: verb npcuse (target the character, a the object, b seconds, c 'crouch' or
  'stand'); the object's when 'npcused'. A character sent with goto/run: when 'arrived'.
- Effects: verb effect (target the object, a mist/smoke/sparks/fire/blinklight/pulse or off, b seconds,
  0 = until stopped, c colour and 'beep' for the lights, 'exact': exactly on the object, no offsets).
- Effect point: a placed UCEffectPoint (Objects > Triggers), the target of an effect: the effect sits exactly
  on the point and goes along its rotation (the editor's big arrow); edits['fxpreview'] = {'<point>': {'kind':
  'mist', 'always': False}} is the editor's preview only (nothing of it goes into the map).
"""
import re
import math
import activation
import conditions
import formula
import gametext
import logic_catalog
import logicpatterns
import logicruntime
import object_tags
import statecatalog

# what can start an interaction (how the link hears it) and what one can do: the logic catalogue's
WHEN = {when: entry['hears'] for when, entry in logic_catalog.OUTPUTS.items()}
VERBS = set(logic_catalog.INPUTS)
OPTIONS = 4                                  # a computer's special options (Computers.specialOptions[4])
EFFECTS = ('mist', 'smoke', 'sparks', 'fire', 'blinklight', 'pulse', 'off')
LIGHT_VERBS = {'lighton', 'lightoff', 'lighttoggle'}
LIGHT_CHANGES = {'flicker', 'lightcolour', 'lightbright'}     # P4: the light changes too (non-static)
MAX_ACTS = 24

AREA_VERBS = {
    'light': LIGHT_VERBS,
    'character': {'friend', 'neutral', 'hostile', 'attack', 'stand', 'wander', 'follow', 'goto', 'run', 'leave', 'appear'},
    'object': {'hide', 'show', 'on', 'off'},
}


def area_data(action, excluded=()):
    area = action.get('area')
    if area is None:
        return None
    if not isinstance(area, dict) or action.get('verb') not in AREA_VERBS.get(area.get('kind'), ()):
        raise ValueError('Invalid Connect area type or action')
    at = area.get('at')
    radius = area.get('radius')
    if (not isinstance(at, list) or len(at) != 3
            or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in at)
            or not isinstance(radius, (int, float)) or not math.isfinite(radius) or not 1 <= radius <= 65536):
        raise ValueError('Connect area needs a finite center and a radius from 1 to 65536 units')
    object_tags.value(area.get('tag',''))
    members = area.get('members', [])
    if not isinstance(members, list) or any(not isinstance(n, str) or not _name(n) for n in members):
        raise ValueError('Invalid Connect area members')
    return dict(area, members=list(dict.fromkeys(n for n in members if n not in excluded)), dynamic=area.get('dynamic') is True)


def area_fields(area):
    return ['area+', area['kind'], '%g' % area['radius'], *['%.6f' % v for v in area['at']]] if area['dynamic'] else ['group', area['kind'], '%g' % area['radius'], *['%.6f' % v for v in area['at']]]



def _name(s):
    s = str(s or '').strip()
    return s if re.fullmatch(r'\w+', s, re.ASCII) else ''          # the map's names are ASCII


def _text(s):
    """A text the game shows (gametext.plain), with no quotes or bars inside: they end the value or the field. Written
    into the T3D through _quoted."""
    return gametext.plain(str(s or '').replace('\r', ' ').replace('\n', ' ')).replace('"', "'").replace('|', '/')


def _quoted(s):
    """A string property of the T3D: in quotes, its backslashes as the engine's reader takes them (gametext.t3d)."""
    return '"%s"' % gametext.t3d(s)


def _game_name(s, fallback='X'):
    """A state's, a counter's or a goal's name as the Story and the conditions write it (conditions.ident); none
    stays none, and the game says so (UCLink: fail noname, for a state, a counter and a goal)."""
    return conditions.ident(s, fallback) if str(s or '').strip() else ''


def option_of(link):
    """A computer's special option: 0 to OPTIONS - 1 (its Tag and its property must name the same one)."""
    try:
        return max(0, min(OPTIONS - 1, int(link.get('option') or 0)))
    except (TypeError, ValueError):
        return 0


def tag_of(link, usable=()):
    """The Tag the link waits for: the one its object's event becomes (config/logic.json), or UCLW_<id> for a link
    that is watched or set off directly (near, the map's start, a script's output)."""
    src, when = _name(link.get('src')), link.get('when')
    if when == 'used' and src in usable:       # JC has finished using it: its UCUsable triggers this
        return 'UCL_%s_Used' % src
    if when == 'signal':                       # a signal: "Send a signal" triggers UCS_<name> (UCLink.DoMore)
        return 'UCS_' + _game_name(link.get('signal'))
    if when == 'ended':                        # a dialogue of the Story has ended: UCEditorStory.EndWatch (story.end_tag)
        return 'UCD_' + _game_name(link.get('dialogue'))
    if when == 'heard':                        # an InfoLink of the Story has been heard: UCEdInfoLink.Heard (story.heard_tag)
        return 'UCI_' + _game_name(link.get('infolink'))
    if WHEN.get(when) == 'gametag' and _name(link.get('gameTag')):     # the game's own Tag: what triggers it, triggers this
        return _name(link['gameTag'])
    if every_of(link):                         # anyone of a set (P9): looked at, hooked to nothing
        return 'UCLW_' + _name(link.get('id') or 'x')
    return logic_catalog.tag(when, src, option_of(link), key_of(link)) or 'UCLW_' + _name(link.get('id') or 'x')


# The keys a rule can wait for (When JC presses a key), by the engine's names for them (EInputKey: Play binds them
# to "mutate UCKey <key>" in its copy of the player's settings: live._set_keys)
KEYS = tuple([chr(c) for c in range(ord('A'), ord('Z') + 1)] + [str(d) for d in range(10)] + ['F%d' % n for n in range(1, 13)]
             + ['Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'] + ['NumPad%d' % d for d in range(10)])


def key_of(link):
    """The key of a rule "When JC presses a key" ('' for any other, or a key the engine does not name)."""
    k = str(link.get('key') or '')
    return next((x for x in KEYS if x.lower() == k.lower()), '')


def keys_in(edits):
    """The keys the map's rules wait for."""
    return sorted({key_of(l) for l in edits.get('links') or [] if isinstance(l, dict) and l.get('when') == 'keypress'} - {''})


def act_string(a):
    verb = str(a.get('verb') or '')
    target_tag = object_tags.value(a.get('targetTag',''))
    if target_tag and (verb not in object_tags.TAG_VERBS or a.get('area') is not None):
        raise ValueError('Invalid scripting-tag action.')
    target = a.get('target')
    target = target if target in SPECIAL_TARGETS else '' if target_tag else _name(target)
    fields = ['%g' % max(0.0, float(a.get('delay') or 0)), verb, target]
    if verb in ('goto', 'run') and a.get('nav') and not target_tag:
        fields[1] = 'nav' + ('go' if verb == 'goto' else 'run')    # on the walkable area (navbake.py, UCNavMesh)
    if verb in ('goto', 'run'):
        at = list(a.get('at') or [0, 0, 0]) + [0, 0, 0]
        fields += ['%.1f' % float(v) for v in at[:3]]
    elif verb == 'travel':
        url = str(a.get('a') or '').strip()
        if a.get('b'):
            url += '#' + str(a['b']).strip()
        fields += [_text(url), '', '']
    elif verb == 'body':                        # a character's body animation (a), b seconds, c how (body_how)
        fields += [_name(a.get('a')), '%g' % _secs(a.get('b'), 0), body_how(a.get('c'))]
    elif verb == 'npcuse':                      # the character goes to the object (a), b seconds, c pose
        fields += [_name(a.get('a')), '%g' % _secs(a.get('b'), 3), 'stand' if a.get('c') == 'stand' else 'crouch']
    elif verb == 'sit':                         # exact Seat actor, not its shared engine Tag
        fields += [_name(a.get('a')), '', '']
    elif verb == 'effect':                      # a kind, b seconds (0 = until stopped), c colour (+ beep)
        kind = str(a.get('a') or 'mist').strip().lower()
        fields += [kind if kind in EFFECTS else 'mist', '%g' % _secs(a.get('b'), 0), _text(a.get('c')).lower()]
    elif verb == 'timerstart':                  # a: seconds of this run (empty: the timer's own)
        fields += ['%g' % _secs(a.get('a'), 0) if _secs(a.get('a'), 0) > 0 else '', '', '']
    elif verb == 'input':                       # a script's input (a), its arguments (b: "Seconds=10;Mode=red")
        fields += [_name(a.get('a')), _args(a.get('b')), '']
    elif verb == 'count':                       # a counter (a) changes by b, or is set to b (c = 'set')
        fields += [_game_name(a.get('a')), _amount(a.get('b'), 1), 'set' if a.get('c') == 'set' else '']
    elif verb == 'floor':                       # an elevator goes to its floor a (its sequence: SetSeq)
        fields += ['%d' % max(0, _whole(a.get('a'), 0)), '', '']
    elif verb in P4_FIELDS:                     # the verbs of P4 (UCLink.DoMore)
        fields += P4_FIELDS[verb](a)
    else:
        fields += [_text(a.get(k)) for k in ('a', 'b', 'c')]
        if verb in ('flag', 'goal'):            # the names of the Story and of the conditions (conditions.ident)
            fields[3] = _game_name(a.get('a'), 'G' if verb == 'goal' else 'X')
    area = area_data(a)
    if area is not None:
        fields += area_fields(area) + [_name(a.get('_group'))]
        if area.get('tag'):fields.append(area['tag'])
    elif a.get('_every'):                       # a group of a kind or a faction (P9): each one living then (UCRule.DoEvery)
        fields[2] = ''
        fields += ['every', str(a['_every']), _text(a.get('_groupName') or a['_every'])]
    elif a.get('_groupName') is not None:       # a named group (P3): its members, each if it can (UCLink.DoMembers)
        fields[2] = ''
        fields += ['members', a['_groupName'], _name(a.get('_group'))]
    elif target_tag:
        fields += ['tag',target_tag]
    result = '|'.join(fields)
    if len(result) > 900:
        raise ValueError('Interaction text is too long for the engine; shorten this action')
    return result


# The objects a rule of the Logic runtime v2 names by what happened (UCRule.DoAct): who set it off, what it happened to
SPECIAL_TARGETS = ('@by', '@it')
_CLASS = re.compile(r'\w+\.\w+', re.ASCII)
_CLASS_NAME = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$', re.ASCII)     # a class's or an alliance's name (P9 sets)


def _cls(v):
    """A class of the game, Package.Class ('' when it is not one)."""
    v = str(v or '').strip()
    return v if _CLASS.fullmatch(v) else ''


def _at(a):
    """A place [x, y, z] as three fields."""
    at = list(a.get('at') or [0, 0, 0]) + [0, 0, 0]
    return ['%.1f' % (float(v) if isinstance(v, (int, float)) and math.isfinite(v) else 0.0) for v in at[:3]]


def hue_sat(hexcolour):
    """A colour #rrggbb as a light of the engine takes it: its hue (0-255 round the wheel) and its saturation (0: the
    full colour, 255: white)."""
    import colorsys
    m = re.fullmatch(r'#?([0-9a-fA-F]{6})', str(hexcolour or '').strip())
    rgb = [int(m.group(1)[i:i + 2], 16) / 255.0 for i in (0, 2, 4)] if m else [1.0, 1.0, 1.0]
    h, sat, _v = colorsys.rgb_to_hsv(*rgb)
    return int(round(h * 255)) % 256, int(round((1 - sat) * 255))


def _items(v):
    """A crate's items and how likely each is: "Package.Class:weight;..." (no weight: 1), only real classes."""
    out = []
    for part in str(v or '').split(';'):
        cls, _, w = part.partition(':')
        if _cls(cls):
            weight = _secs(w, 1) if w.strip() else 1.0
            out.append('%s:%g' % (_cls(cls), weight))
    return ';'.join(out)


HURT_KINDS = ('fire', 'poison', 'shock', 'radiation')
# a P4 verb's fields after delay|verb|target: a, b, c and, for some, a place (fields 6-8) and how (field 9)
P4_FIELDS = {
    'skillpoints': lambda a: [_amount(a.get('a'), 100), '', ''],
    'credits': lambda a: [_amount(a.get('a'), 100), '', ''],
    'health': lambda a: [_amount(a.get('a'), 25), '', ''],
    'giveitem': lambda a: [_cls(a.get('a')), '%d' % min(20, max(1, _whole(a.get('b'), 1))), ''],
    'takeitem': lambda a: [_cls(a.get('a')), '%d' % max(0, _whole(a.get('b'), 1)), ''],
    'shake': lambda a: ['%g' % (_secs(a.get('a'), 1) or 1), '%g' % (_secs(a.get('b'), 1) or 1), ''],
    'fade': lambda a: ['in' if a.get('a') == 'in' else 'out', '%g' % _secs(a.get('b'), 1), ''],
    'flash': lambda a: [_name(a.get('a')).lower() or 'white', '%g' % (_secs(a.get('b'), 1) or 1), ''],
    'flicker': lambda a: ['%g' % _secs(a.get('a'), 2), '', ''],
    'lightcolour': lambda a: ['%d' % hue_sat(a.get('a'))[0], '%d' % hue_sat(a.get('a'))[1], ''],
    'lightbright': lambda a: ['%d' % min(255, max(0, _whole(a.get('a'), 64))), '', ''],
    'music': lambda a: [_cls(a.get('a')), '%d' % min(255, max(0, _whole(a.get('b'), 0))), ''],
    'patrol': lambda a: [_name(a.get('a')), '', ''],
    'ownorders': lambda a: ['', '', ''],
    'teleport': lambda a: _at(a),
    'moveplayer': lambda a: _at(a),
    'spawn': lambda a: [_cls(a.get('a')), '%d' % min(12, max(1, _whole(a.get('b'), 2))), object_tags.value(str(a.get('c') or ''))]
                       + _at(a) + ['attack' if a.get('attack', True) else ''],
    'hurtzone': lambda a: ['%g' % _secs(a.get('a'), 10), '%g' % (_secs(a.get('b'), 192) or 192), '%g' % _secs(a.get('c'), 10)]
                          + _at(a) + [a.get('kind') if a.get('kind') in HURT_KINDS else 'fire'],
    'autosave': lambda a: [_text(a.get('a'))[:60], '', ''],
    'endgame': lambda a: ['death' if a.get('a') == 'death' else 'credits', '', ''],
    'fillcrate': lambda a: [_items(a.get('a')), '%d' % min(3, max(1, _whole(a.get('b'), 1))), ''],
    'nextfloor': lambda a: ['down' if a.get('a') == 'down' else 'up', '', ''],
    'animturn': lambda a: ['', '', ''],
    'cancel': lambda a: [_name(a.get('a')), '', ''],
    'signal': lambda a: [_game_name(a.get('a')), '', ''],     # P3: the rules on "the signal a is sent" run
    # P5: a dialogue started, an InfoLink played, by its id in the map's Story (UCLink.StoryAction)
    'talk': lambda a: [_name(a.get('a')), '', ''],
    'infolink': lambda a: [_name(a.get('a')), '', ''],
    # P9 slice 4 (UCLink.DoMore): the player's energy; an augmentation (a its class's name, b how, c a level 1-4); two
    # factions (a sees b as c, "... both": b sees a so too); a property of the safe list (a) and its value (b)
    'energy': lambda a: [_amount(a.get('a'), 25), '', ''],
    'aug': lambda a: [_ident(a.get('a') or 'AugSpeed'), a.get('b') if a.get('b') in AUG_HOW else 'give',
                      '%d' % min(4, max(1, _whole(a.get('c'), 2)))],
    'allies': lambda a: [_ident(a.get('a')), _ident(a.get('b')),
                         (a.get('c') if a.get('c') in ATTITUDES else 'hostile') + (' both' if a.get('both', True) else '')],
    'setprop': lambda a: _safe_prop(a.get('a'), a.get('b')),
}
AUG_HOW = ('give', 'raise', 'level', 'on', 'off')
ATTITUDES = ('hostile', 'neutral', 'friendly')


def _ident(v):
    """A class's or a faction's name ('' when it is not one)."""
    v = str(v or '').strip()
    return v if _CLASS_NAME.fullmatch(v) else ''


def _safe_prop(name, value):
    """A property of the safe list (config/logic.json safeProps) and its value as the game takes it: a whole number, a
    number, True / False. Not one of them: no name (the game says noprop)."""
    p = logic_catalog.safe_prop(name)
    if not p:
        return ['', '', '']
    v = str(value if value is not None else '').strip()
    if p[1] == 'whole':
        v = '%d' % _whole(v, 0)
    elif p[1] == 'number':
        v = '%g' % max(0.0, _number(v))
    else:
        v = 'True' if v.lower() in ('1', 'true', 'yes', 'on') else 'False'
    return [p[0], v, '']


def _number(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0.0
    return n if math.isfinite(n) else 0.0


BODY_MODES = ('once', 'loop', 'time')


def body_how(c):
    """How a body animation plays (UCAnimSet.PlayBody): its words in this order, its speed last ("x1.5": the game finds
    the speed after the first x): once, loop (until "Stop its body animation") or time (looped for its seconds); own
    (an animation of the Animation Studio: the model with the Studio's animations); walk (it may keep walking)."""
    words = str(c or '').lower().split()
    mode = next((w for w in words if w in BODY_MODES), 'once')
    rate = 1.0
    for w in words:
        if w.startswith('x'):
            try:
                rate = float(w[1:])
            except ValueError:
                pass
    rate = min(10.0, max(0.05, rate)) if math.isfinite(rate) else 1.0
    return ' '.join([mode] + [w for w in ('own', 'walk') if w in words] + ['x%g' % rate])


def _args(v):
    """A script input's arguments, "Key=Value;Key=Value": no bars or quotes (they end a field or the value)."""
    pairs = []
    for part in str(v or '').split(';'):
        key, _, value = part.partition('=')
        if _name(key):
            pairs.append('%s=%s' % (_name(key), _text(value).strip()))
    return ';'.join(pairs)


def _amount(v, default):
    """An amount: a whole number, or (Advanced, P9 slice 5) a formula of counters the game works out when the action
    runs ("Alarms + 1": '=@Alarms,1,+', UCEditorStory.NumberOf); a bad formula takes the default."""
    return formula.game_number(v, default)


def _whole(v, default):
    """A whole number the game's int holds (a counter's change, a floor)."""
    try:
        return max(-2 ** 31, min(2 ** 31 - 1, int(float(v))))
    except (TypeError, ValueError, OverflowError):
        return default


def _secs(v, default):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return float(default)
    return max(0.0, f) if math.isfinite(f) else float(default)


def usable_entries(edits, deleted=()):
    """The usable objects of the map (edits['usable']): {name: settings}, without deleted ones."""
    out = {}
    for name, u in sorted((edits.get('usable') or {}).items()):
        if _name(name) and name not in deleted and isinstance(u, dict):
            out[name] = u
    return out


def usable_block(name, u):
    """The UCUsable actor of one usable object."""
    props = {'Tag': 'UCU_' + name, 'Target': '"%s"' % name, 'UseText': _quoted(_text(u.get('text') or 'Use')),
             'UseTime': '%.6f' % _secs(u.get('secs'), 0), 'Uses': str(max(0, int(_secs(u.get('uses'), 0)))),
             'UseEvent': 'UCL_%s_Used' % name}
    if u.get('crouch'):
        props['bCrouch'] = 'True'
    item = str(u.get('item') or '').strip()
    if re.fullmatch(r'\w+\.\w+', item):
        props['NeedItem'] = '"%s"' % item
        if u.get('consume'):
            props['bConsume'] = 'True'
        if u.get('needtext'):
            props['NeedText'] = _quoted(_text(u['needtext']))
    if u.get('hidden'):
        props['bHiddenAtStart'] = 'True'
    at = u.get('at') if isinstance(u.get('at'), list) and len(u['at']) == 3 else [0, 0, 0]
    return dict(cls='UCUsable', name='UCUse_' + name, loc=[float(v) for v in at], props=props)


# the ways of hearing an output that need no object (the map's start, a key, P4's conditions, states, the game's Tags)
NO_OBJECT = ('start', 'key', 'becomes', 'changes', 'gametag', 'world')

# P9 slice 3, the world: what a rule of these hears (UCRule.WorldArg), the noises UCGameEars tells apart
NOISES = ('loud', 'gunshot', 'alarm', 'cry')
APPEARS = ('character', 'body')


def world_arg(c):
    """What a cause of the world needs (UCRule.WorldArg): a goal's name as the game names it ('' any goal), the kind
    of noise, a character or a body; '' for the others (a saved game loaded, coming back to the map)."""
    when = c.get('when')
    if when == 'goaldone':
        return _game_name(c.get('goal'), 'G') if str(c.get('goal') or '').strip() else ''
    if when == 'noise':
        return c.get('noise') if c.get('noise') in NOISES else 'loud'
    if when == 'appears':
        return c.get('what') if c.get('what') in APPEARS else 'character'
    return ''


# ---------------------------------------------------------------- anyone of a set (P9 "Game rules", UCRule.Every)
# what can happen to anyone of a set of characters (a group of a kind or a faction, or of picked characters for the
# happenings only a set has), as UCRule looks at them
EVERY_WHENS = ('killed', 'knockedout', 'dies', 'hurt', 'sees', 'turnshostile', 'findsbody')


def every_set(f):
    """A group filter of characters (P9): {'kind': 'MJ12Troop'} -> 'class:MJ12Troop', {'faction': 'MJ12'} ->
    'faction:MJ12', anything else ''."""
    if not isinstance(f, dict):
        return ''
    if set(f) == {'kind'} and _CLASS_NAME.match(str(f['kind'] or '')):
        return 'class:' + str(f['kind'])
    if set(f) == {'faction'} and _CLASS_NAME.match(str(f['faction'] or '')):
        return 'faction:' + str(f['faction'])
    return ''


def every_of(c):
    """The set a cause is heard on (UCRule.Every), '' for an ordinary cause: the rule's own `every` (written by
    expand_groups from a group of a kind or a faction, or of picked characters), or its one character for a happening
    only the game rules hear ('names:Guard1')."""
    if c.get('every'):
        return str(c['every'])
    if WHEN.get(c.get('when')) == 'every' and _name(c.get('src')):
        return 'names:' + _name(c['src'])
    return ''


def cause_ok(c):
    """Whether a cause can set a rule off: an output the catalogue knows, with what it needs (its object, key, port...)."""
    when = c.get('when')
    if when not in WHEN:
        return False
    hears = WHEN[when]
    if c.get('every'):                           # anyone of a set (P9): a happening of characters
        return when in EVERY_WHENS
    if hears == 'every':
        return bool(_name(c.get('src')))
    if hears == 'key':                           # a key: no object, a key the engine names
        return bool(key_of(c))
    if hears == 'becomes':
        return isinstance(c.get('watch'), dict) and bool(conditions.complete([c['watch']]))
    if hears == 'changes':
        return bool(watch_name(c))
    if when == 'signal':                         # a signal: which one
        return bool(str(c.get('signal') or '').strip())
    if when in ('ended', 'heard'):               # a dialogue, an InfoLink of the Story: which one
        return bool(str(c.get('dialogue' if when == 'ended' else 'infolink') or '').strip())
    if hears == 'gametag':
        return bool(_name(c.get('gameTag')))
    if hears == 'prop' and logic_catalog.OUTPUTS[when].get('of') == 'player':
        return True
    if hears not in NO_OBJECT and not _name(c.get('src')):
        return False
    if hears == 'port' and not _name(c.get('port')):     # a script's output: which one
        return False
    return True


def valid(link):
    return cause_ok(link) and any(str(a.get('verb')) in VERBS for a in link.get('do') or [])


def watch_name(c):
    """When = changes: the state or the counter it watches, as UCLink.Watch has it ("flag|Name", "count|Name"), or ''."""
    w = c.get('watch') if isinstance(c.get('watch'), dict) else {}
    if str(w.get('counter') or '').strip():
        return 'count|' + _game_name(w['counter'])
    if str(w.get('flag') or '').strip():
        return 'flag|' + _game_name(w['flag'])
    return ''


def watch_test(c):
    """When = a watched property (hears 'prop'): its tests (UCLink.TestsHold), the cause's arguments put in: an argument
    of 0 or none takes the output's testNone when it has one ("Health down": any wound)."""
    entry = logic_catalog.OUTPUTS[c['when']]
    args = {x['id']: x for x in entry.get('args', [])}
    values = {}
    for key, arg in args.items():
        v = _whole(c.get(key), arg.get('default', 0))
        values[key] = max(0, min(100, v)) if arg.get('type') == 'percent' else max(0, v)
    test = entry['test']
    if entry.get('testNone') and any(not values.get(k) for k in re.findall(r'\{(\w+)\}', test)):
        test = entry['testNone']
    return re.sub(r'\{(\w+)\}', lambda m: str(values.get(m.group(1), 0)), test)


def cause_props(c, usable, rule):
    """What a UCLink (or a UCRuleAlso) needs to hear one cause: its Tag, When, Source and what the output needs."""
    when = c['when']
    props = {'Tag': tag_of(c, usable), 'When': when, 'Rule': '"%s"' % rule}
    every = every_of(c)
    if every:                                   # anyone of a set (P9): UCRule looks at each, no Source
        props['Every'] = _quoted(every)
        if when == 'hurt' and _whole(c.get('below'), 0) > 0:
            props['EveryArg'] = str(max(0, min(100, _whole(c.get('below'), 0))))
        return props
    if _name(c.get('src')):
        props['Source'] = '"%s"' % _name(c['src'])
    if when == 'option':
        props['Option'] = str(option_of(c))
    if WHEN[when] == 'port':
        props['Port'] = '"%s"' % _name(c['port'])
    if when == 'near':
        props['NearDist'] = '%.6f' % max(32.0, float(c.get('near') or 256))
    if WHEN[when] == 'prop':
        props['bWatchProp'] = 'True'
        props['Watch'] = _quoted(watch_test(c))
    elif WHEN[when] == 'becomes':
        props['Watch'] = '"%s"' % conditions.encode(conditions.check([c['watch']], limit=1)[0])
        if c.get('watchStart'):                 # a "while" (P3): it already holds when the map starts
            props['bWatchStart'] = 'True'
    elif WHEN[when] == 'changes':
        props['Watch'] = '"%s"' % watch_name(c)
    elif WHEN[when] == 'world':                 # the world (P9): UCRule hears it itself
        arg = world_arg(c)
        if arg:
            props['WorldArg'] = _quoted(arg)
        if when == 'noise':                     # within so many units of the player, 0 anywhere it is heard
            props['NearDist'] = '%.6f' % max(0.0, _secs(c.get('within'), 0))
    return props


# ---------------------------------------------------------------- the Logic runtime v2 (UCRule: P6)
AGAIN = ('restart', 'each')                  # 'ignore' (none): as UCLink, a cause while it runs is let go
TALK_BUSY = ('wait', 'giveup')


def causes(link):
    """A rule's other causes ("Or when..."): its `also`, those that can set it off."""
    return [c for c in link.get('also') or [] if isinstance(c, dict) and cause_ok(c)]


def _all_actions(link):
    return [a for key in ('do', 'else') for a in link.get(key) or [] if isinstance(a, dict)]


def v2_reasons(link):
    """What a rule has that only the Logic runtime v2 (a UCRule) does, in the editor's words ([] nothing): another
    cause, any of its conditions, an Otherwise, set off again while it runs (restart, each), at most N runs, a
    cooldown, the player talking, an action on what set it off."""
    reqs = conditions.complete(link.get('requires') or [])
    out = []
    if causes(link):
        out.append('another cause ("Or when...")')
    if link.get('match') == 'any' and len(reqs) > 1:
        out.append('"any of these" conditions')
    if _else_of(link):
        out.append('an Otherwise')
    if link.get('again') in AGAIN:
        out.append('"set off again while it runs: %s"' % link['again'])
    if _whole(link.get('max'), 0) > 0:
        out.append('"at most %d times"' % _whole(link['max'], 0))
    if _secs(link.get('cooldown'), 0) > 0:
        out.append('a cooldown')
    if link.get('talkBusy') in TALK_BUSY:
        out.append('what it does while the player talks')
    if any(a.get('target') in SPECIAL_TARGETS for a in _all_actions(link)):
        out.append('an action on what set it off')
    if link.get('every') or WHEN.get(link.get('when')) == 'every':
        out.append('a happening of the game rules (anyone of a set, sees the player, turns hostile, finds a body)')
    if any(a.get('_every') for a in _all_actions(link)):
        out.append('an action on anyone of a kind or a faction')
    if WHEN.get(link.get('when')) == 'world':
        out.append('a happening of the world (a saved game loaded, coming back to the map, a goal, a noise, someone'
                   ' appearing)')
    return out


def needs_rule(link):
    """Whether a rule needs the Logic runtime v2 (a UCRule): v2_reasons has something."""
    return bool(v2_reasons(link))


def classic_refusal(rule, link):
    """What stops the build of a rule with the classic rules on (logicruntime.py): '' when it has nothing new"""
    why = v2_reasons(link)
    if not why:
        return ''
    return ('Interaction %s (%s) has %s, which the classic rules do not have: turn off Map > Classic rules, or take it'
            ' away' % (rule, _text(link.get('label') or link.get('src')), ', '.join(why)))


def _else_of(link):
    return [a for a in link.get('else') or [] if isinstance(a, dict) and str(a.get('verb')) in VERBS | FLOW]


def as_steps(actions):
    """Actions at their times (each delay from the start) as a list of steps (each delay from the one before), in the
    order the game runs them (by time, then as listed): UCLink waits from one to the next the same way."""
    acts = sorted(enumerate(actions), key=lambda p: (_secs(p[1].get('delay'), 0), p[0]))
    out, t = [], 0.0
    for _j, a in acts:
        at = _secs(a.get('delay'), 0)
        out.append(dict(a, delay=round(at - t, 4)))
        t = at
    return out


FLOW = {'if', 'else', 'end', 'wait'}       # the steps of a list that are not actions (UCLink bSteps)
MAX_STEP_CONDITIONS = 16                   # UCLink.StepCond[16]


def is_steps(link):
    """A rule that is a list of steps (the editor's lists: If / Otherwise / End, Wait until): run in its order."""
    return bool(link.get('steps'))


# "Wait until" the Story (P5): the until's type -> the Tag's prefix (story.end_tag, heard_tag) and the id's key
STORY_UNTIL = {'ended': ('UCD_', 'dialogue'), 'heard': ('UCI_', 'infolink')}


def step_items(link, deleted, rule, conds=None, ids=None):
    """A list of steps as UCLink runs it (bSteps): [action dict | fields list], and the StepCond strings. If becomes a
    check step that fails to its Otherwise (or its End), Otherwise a goto to its End; an If left open ends with the
    list; Wait until an until step (a character arriving, or a condition, at most `max` seconds). An action with its own
    `requires` (P6: checked again just before it) gets a check step before it that skips it alone. conds: the StepCond
    of the steps before (an Otherwise's list follows its rule's); ids: filled with each step's editor id."""
    items, open_ifs = [], []
    conds = [] if conds is None else conds
    ids = [] if ids is None else ids

    class _Items(list):                         # each step appended with its editor id (ids stays beside items)
        sid = ''

        def append(self, item):
            list.append(self, item)
            ids.append(_name(self.sid) or '')

    items = _Items()

    def cond_slots(reqs):
        k = len(conds)
        conds.extend(conditions.encode(c) for c in reqs)
        if len(conds) > MAX_STEP_CONDITIONS:
            raise ValueError('Interaction %s: its If and Wait until steps have more than %d conditions in all.' % (rule, MAX_STEP_CONDITIONS))
        return k

    for a in link.get('do') or []:
        verb = str(a.get('verb') or '')
        delay = '%g' % _secs(a.get('delay'), 0)
        items.sid = a.get('id') or ''
        if verb == 'if':
            try:
                reqs = conditions.check(a.get('requires'), limit=conditions.MAX_CONDITIONS)
            except ValueError as exc:
                raise ValueError('Interaction %s, an If step: %s' % (rule, exc)) from exc
            k = cond_slots(reqs)
            items.append([delay, 'check', 'any' if a.get('match') == 'any' else 'all', str(k), str(len(reqs)), 'stop'])
            open_ifs.append({'check': len(items) - 1, 'goto': None})
        elif verb == 'else':
            if not open_ifs or open_ifs[-1]['goto'] is not None:
                raise ValueError('Interaction %s: an Otherwise step with no If before it.' % rule)
            items.append([delay, 'jump', '', '', 'stop', ''])
            open_ifs[-1]['goto'] = len(items) - 1
            items[open_ifs[-1]['check']][5] = str(len(items))           # the check fails to the other branch
        elif verb == 'end':
            if not open_ifs:
                raise ValueError('Interaction %s: an End step with no If before it.' % rule)
            block, here = open_ifs.pop(), len(items)
            if block['goto'] is None:
                items[block['check']][5] = str(here)                   # no other branch: past the If
            else:
                items[block['goto']][4] = str(here)                    # the first branch goes past the other one
            if _secs(a.get('delay'), 0) > 0:
                items.append([delay, 'wait', '', '', '', ''])
        elif verb == 'wait':
            until, most = a.get('until') or {}, '%g' % _secs(a.get('max'), 0)
            if until.get('type') == 'arrived':
                who = _name(until.get('actor'))
                if not who or who in deleted:
                    continue
                items.append([delay, 'until', who, 'arrived', most, ''])
            elif until.get('type') in STORY_UNTIL:     # P5: a dialogue's end, an InfoLink heard (the Tags of tag_of)
                prefix, key = STORY_UNTIL[until['type']]
                sid = _game_name(until.get(key))
                if not sid:                             # none chosen: no wait (Check map says so)
                    continue
                items.append([delay, 'until', prefix + sid, until['type'], most, ''])
            elif until:
                try:
                    reqs = conditions.check([until], limit=1)
                except ValueError as exc:
                    raise ValueError('Interaction %s, a Wait until step: %s' % (rule, exc)) from exc
                if reqs:
                    items.append([delay, 'until', '', 'cond', most, str(cond_slots(reqs))])
            elif _secs(a.get('delay'), 0) > 0:
                items.append([delay, 'wait', '', '', '', ''])
        elif verb in VERBS and not (a.get('target') and a['target'] in deleted) \
                and not (verb in ('npcuse', 'sit') and (not _name(a.get('a')) or a['a'] in deleted)):
            try:
                own = conditions.check(a.get('requires'), limit=conditions.MAX_CONDITIONS)
            except ValueError as exc:
                raise ValueError('Interaction %s, an action: %s' % (rule, exc)) from exc
            if own:                             # checked again just before it: when it fails, only it is skipped
                k = cond_slots(own)
                items.append([delay, 'check', 'any' if a.get('match') == 'any' else 'all', str(k), str(len(own)),
                              str(len(items) + 2)])
                a = dict(a, delay=0)
            items.append(dict(a, area=area_data(a, deleted | {link.get('src')})) if a.get('area') is not None else a)
    for block in open_ifs:                     # an If with no End: its branches end with the list
        if block['goto'] is None:
            items[block['check']][5] = 'stop'
        else:
            items[block['goto']][4] = 'stop'
    return list(items), conds


def _plain_acts(link, deleted):
    """A rule's actions that are built: not on a deleted or disabled object, a character's use with its object."""
    acts = [a for a in link.get('do') or [] if str(a.get('verb')) in VERBS
            and not (a.get('target') and a['target'] in deleted)
            and not (a.get('verb') in ('npcuse', 'sit') and (not _name(a.get('a')) or a['a'] in deleted))]
    return [dict(a, area=area_data(a, deleted | {link.get('src')})) if a.get('area') is not None else a for a in acts]


def _has_own_checks(link):
    """An action with its own conditions: the rule is built as a list of steps (a check before that action)."""
    return any(a.get('verb') not in FLOW and conditions.complete(a.get('requires') or []) for a in _all_actions(link))


def _group_blocks(rule, i, a, out):
    """An area action's or a named group's saved members: UCLinkGroup actors (128 a chunk); the action names the first."""
    area = a.get('area')
    if a.get('_members') is not None:
        area = {'members': a['_members'], 'at': a.get('_at') or [0, 0, 0]}
    if not (area and area['members']):
        return a
    stem = 'UCLG_' + rule + '_' + str(i)
    chunks = [area['members'][j:j + 128] for j in range(0, len(area['members']), 128)]
    for j, members in enumerate(chunks):
        group_props = {'Member(%d)' % k: n for k, n in enumerate(members)}
        if j + 1 < len(chunks):
            group_props['NextGroup'] = stem + '_' + str(j + 1)
        out.append(dict(cls='UCLinkGroup', name=stem + '_' + str(j), loc=list(area['at']), props=group_props))
    return dict(a, _group=stem + '_0')


def group_filter(g):
    """A named group's filter (P3 slice 11), None for a group of picked objects:
    {'tag': T}: every object with the scripting tag T when a step runs (as a step on "objects tagged T");
    {'area': {kind, at, radius, tag, dynamic}}: its saved members (the group's members), and with dynamic the newcomers
    within the radius too (as a step on "objects within a radius");
    {'kind': 'MJ12Troop'}, {'faction': 'MJ12'} (P9): the living characters of that class (and its subclasses), of that
    alliance, when a step runs or a rule looks (UCRule.Every)."""
    f = g.get('filter')
    if f is None:
        return None
    if isinstance(f, dict) and set(f) == {'tag'}:
        return {'tag': object_tags.value(f['tag'], False)}
    if every_set(f):                         # characters of a kind or of a faction (P9): whoever is of it then
        return dict(f)
    if isinstance(f, dict) and set(f) == {'area'} and isinstance(f['area'], dict) and f['area'].get('kind') in AREA_VERBS:
        area = {k: v for k, v in f['area'].items() if k in ('kind', 'at', 'radius', 'tag', 'dynamic')}
        area_data({'verb': next(iter(AREA_VERBS[area['kind']])), 'area': dict(area, members=[])})    # checks it
        return {'area': area}
    raise ValueError('Invalid filter of the group %s' % g.get('id'))


def logic_groups(edits):
    """The map's named groups (P3, edits['logic']['groups']: [{'id', 'name', 'members', 'filter'?}]) by id: {id:
    {'name', 'members', 'filter'}}. Not edits['groups']: that holds the poses of the map's structures."""
    logic = edits.get('logic') if isinstance(edits.get('logic'), dict) else {}
    out = {}
    for g in logic.get('groups') or []:
        if not isinstance(g, dict) or not _name(g.get('id')) or not isinstance(g.get('members', []), list):
            raise ValueError('Invalid group in the logic of the map')
        members = [n for n in dict.fromkeys(g.get('members') or []) if isinstance(n, str) and _name(n)]
        out[g['id']] = {'name': _text(g.get('name') or g['id']).strip() or g['id'], 'members': members, 'filter': group_filter(g)}
    return out


def expand_groups(edits, deleted=()):
    """The rules with their groups written out (P3): an action on a group gets the group's members (those not deleted)
    and its name, and is left out when none is left (a verb no group can do, GROUP_VERBS, forgets the group); a rule set off
    by any of a group's members becomes a rule on the first, with the others as its other causes (also)."""
    groups = logic_groups(edits)
    if not groups:
        return edits
    deleted = set(deleted)

    def members(gid):
        g = groups.get(gid)
        return [n for n in g['members'] if n not in deleted] if g else []

    def act(a):
        if not isinstance(a, dict) or not a.get('group') or a.get('verb') in FLOW:
            return a
        if a.get('verb') not in GROUP_VERBS:   # (a verb that takes no object: the group means nothing to it)
            return {k: v for k, v in a.items() if k != 'group'}
        f = (groups.get(a['group']) or {}).get('filter') or {}
        if every_set(f):                       # a group of a kind or a faction (P9): whoever is of it then
            if a['verb'] not in AREA_VERBS['character']:
                return None
            return dict(a, target='', targetTag='', area=None, _every=every_set(f), _groupName=groups[a['group']]['name'])
        if f.get('tag'):                       # a group by tag (slice 11): a step on the objects tagged so
            return dict(a, target='', targetTag=f['tag'], area=None)
        area = f.get('area')
        if area and a['verb'] in AREA_VERBS[area['kind']] and (area.get('dynamic') or members(a['group'])):
            # a group by radius: its saved members and, with dynamic, the newcomers (a verb its kind cannot do: only
            # the saved members that can, as a group of picked objects)
            return dict(a, target='', targetTag='', area=dict(area, members=members(a['group'])))
        kept = members(a['group'])
        if not kept:
            return None
        return dict(a, target='', targetTag='', area=None, _members=kept, _groupName=groups[a['group']]['name'])

    out = []
    for link in edits.get('links') or []:
        if not isinstance(link, dict):
            out.append(link)
            continue
        link = dict(link, **{k: [x for x in (act(a) for a in link.get(k) or []) if x is not None]
                             for k in ('do', 'else') if link.get(k)})
        for k in ('do', 'else'):
            for a in link.get(k) or []:
                if isinstance(a, dict) and a.get('area') is None:
                    a.pop('area', None)
        g = groups.get(link.get('group')) if link.get('group') else None
        if g and every_set(g.get('filter')):    # anyone of a kind or a faction (P9): one rule that looks at each
            link = dict(link, src='', group=None, every=every_set(g['filter']), everyName=g['name'])
        elif g and WHEN.get(link.get('when')) == 'every':     # a happening only a set has, on picked characters
            kept = members(link['group'])
            if not kept:
                continue
            link = dict(link, src='', group=None, every='names:' + ','.join(kept), everyName=g['name'])
        if link.get('group'):                   # set off by any of them: the first, the others its other causes
            kept = members(link['group'])
            if not kept:
                continue
            cause = {k: link[k] for k in CAUSE_KEYS if k in link}
            link = dict(link, src=kept[0], group=None,
                        also=[dict(cause, src=n) for n in kept[1:]] + list(link.get('also') or []))
        out.append(link)
    return dict(edits, links=out)


# ---------------------------------------------------------------- "while" (P3): undone when it stops
def until_of(c):
    """The cause that ends a 'while' on this one (the same object, the same group), or None when it has none: an
    output's 'until' (the player walks out, the door starts closing...), a script's paired port (untilPorts), a
    condition's opposite (a skill has none)."""
    if not isinstance(c, dict):
        return None
    when = c.get('when')
    if when == 'output':
        port = logic_catalog.until_port(c.get('port'))
        return dict(c, port=port) if port else None
    if when == 'becomes':
        w = c.get('watch')
        chosen = isinstance(w, dict) and not conditions.unfinished(w) and (conditions.kind(w) != 'flag' or str(w.get('flag') or '').strip())
        neg = conditions.negate(w) if chosen else None
        return dict(c, watch=neg) if neg else None
    until = (logic_catalog.OUTPUTS.get(when) or {}).get('until')
    return dict(c, when=until) if until else None


def undo_of(a):
    """The action that undoes one ('' verb: none): its inverse verb on the same object, a state set back."""
    if not isinstance(a, dict) or a.get('verb') in FLOW:
        return None
    rest = {k: v for k, v in a.items() if k not in ('requires', 'match', 'delay', 'id')}
    if a.get('id'):
        rest['id'] = 'u' + str(a['id'])            # the log names the undoing step after the step
    if a.get('verb') == 'flag':
        if FATE.match(str(a.get('a') or '')):     # a character's fate is a record, not a state to set back
            return None
        return dict(rest, b='1' if str(a.get('b', '1')) == '0' else '0', delay=0)
    inverse = logic_catalog.inverse_of(a.get('verb'))
    return dict(rest, verb=inverse, delay=0) if inverse else None


FATE = re.compile(r'^UCFate[0-9a-f]{6}_\w+_(Dead|KO|Down)$', re.I)       # static/state-model.js FATE_RE
WHILE_KEYS = ('src', 'group', 'once', 'at') + ('when', 'port', 'option', 'near', 'key', 'signal', 'dialogue', 'infolink', 'watch', 'gameTag')


def while_end(link):
    """The rule that undoes a 'while' rule when it stops: its paired cause (and its other causes' pairs), what the rule
    still has to do stopped (cancel, when it waits), its actions undone in the opposite order, at once, with no checks;
    None when nothing can end it or nothing can be undone."""
    cause = until_of({k: link[k] for k in WHILE_KEYS if k in link})
    if cause is None:
        return None
    undo = [u for u in (undo_of(a) for a in reversed(list(link.get('do') or []))) if u]
    if not undo:
        return None
    if link.get('steps') or any(_secs(a.get('delay'), 0) > 0 for a in link.get('do') or [] if isinstance(a, dict)):
        undo.insert(0, {'verb': 'cancel', 'a': link['id'], 'target': '', 'delay': 0, 'id': 'ucancel'})   # what is still to come
    also = [u for u in (until_of(c) for c in link.get('also') or []) if u is not None]
    end = dict(cause, id='%s_until' % link['id'], do=undo, label='%s (undone)' % str(link.get('label') or link['id'])[:80])
    if also:
        end['also'] = also
    if cause.get('when') == 'becomes':
        end['watchStart'] = True
    return end


def expand_while(edits):
    """The rules with their 'while' written out (P3): each one that holds while gets a second rule, `<id>_until`,
    that undoes it (while_end); a 'while' on a condition also runs at the map's start when the condition already holds
    (bWatchStart), and so does its end, so what it sets is right from the start."""
    out, changed = [], False
    for link in edits.get('links') or []:
        end = while_end(link) if isinstance(link, dict) and link.get('while') and valid(link) else None
        if end is None:
            out.append(link)
            continue
        changed = True
        out.append(dict(link, watchStart=True) if link.get('when') == 'becomes' else link)
        out.append(end)
    return dict(edits, links=out) if changed else edits


# ---------------------------------------------------------------- phases (P3): a rule that works only in some
def phase_gate(phase, sets):
    """UCLink.PhaseGate for a rule's phase ({set: a Phases block's name, in: its phases' flag names}): "<its
    counter>|<the numbers of those phases>", '' when it has none. A block not in the map, or no phase of its list:
    "<counter>|" (or "?|"), which no phase is, so the rule never runs (the Logic window's "To check" says why)."""
    if not isinstance(phase, dict) or not phase.get('set'):
        return ''
    s = sets.get(str(phase['set']))
    if s is None:
        return '?|'
    want = {str(p).lower() for p in phase.get('in') or []}
    return '%s|%s' % (s['root'], ','.join(str(i + 1) for i, p in enumerate(s['phases']) if p.lower() in want))


# what a group can be told to do: what a scripting tag can (UCLink.TagKind picks the members that can)
GROUP_VERBS = object_tags.TAG_VERBS
# what makes a cause, copied to each member of a group that sets a rule off
CAUSE_KEYS = ('when', 'port', 'option', 'near', 'key', 'signal', 'dialogue', 'infolink', 'watch', 'gameTag')


def blocks(edits):
    """The UCLink actors of the map: [{'cls', 'name', 'loc', 'props'}], like edits['added']. Each rule a UCLink, or a
    UCRule when it needs one; the project's Logic runtime (edits['logicRuntime'], logicruntime.py) may say every rule
    a UCLink (classic: a rule that needs a UCRule stops the build) or every rule a UCRule (all)."""
    runtime = logicruntime.of(edits)
    edits = without_replaced(logicpatterns.expand(edits))     # the patterns placed in the map, written out (P8)
    object_tags.validate(edits)
    deleted = set(edits.get('deleted') or {}) | activation.names(edits)
    edits = expand_groups(expand_while(edits), deleted)
    out = object_tags.blocks(edits,deleted)
    usable = usable_entries(edits, deleted)
    for name, u in usable.items():
        out.append(usable_block(name, u))
    phases = {n: s for n, s in statecatalog.phase_sets(edits).items() if n not in deleted}
    names = set()
    for link in edits.get('links') or []:
        if not valid(link) or link.get('src') in deleted:
            continue
        rule = _name(link.get('id'))
        if not rule or rule in names:          # the actor's name and the logic log's: one per rule
            raise ValueError('Each interaction needs its own id (letters, digits, underscores): %r' % link.get('id'))
        names.add(rule)
        try:
            reqs = conditions.check(link.get('requires'), limit=conditions.MAX_CONDITIONS)
        except ValueError as exc:               # name the rule: the Rebuild stops on it
            raise ValueError('Interaction %s (%s): %s' % (rule, _text(link.get('label') or link.get('src')), exc)) from exc
        v2 = needs_rule(link)
        if runtime == 'classic' and v2:
            raise ValueError(classic_refusal(rule, link))
        v2 = v2 or runtime == 'all'
        stepconds, ids, else_at = [], [], -1
        steps = is_steps(link) or v2 or _has_own_checks(link)
        if steps:                               # a list of steps: in its order, If / Otherwise / Wait until (bSteps)
            main = link if is_steps(link) else dict(link, do=as_steps(_plain_acts(link, deleted)))
            acts, stepconds = step_items(main, deleted, rule, stepconds, ids)
            other = _else_of(link) if v2 else []
            if other:                           # its Otherwise: after the end of the main list (UCRule.ElseAt)
                acts.append(['0', 'jump', '', '', 'stop', ''])
                ids.append('')
                else_at = len(acts)
                # a rule that is a list of steps has its Otherwise as one too (each delay from the step before);
                # a rule of actions at their times, its Otherwise the same, unless it has an If or a Wait
                flow = is_steps(link) or any(a.get('verb') in FLOW for a in other)
                more, stepconds = step_items({'do': other if flow else as_steps(_plain_acts({'do': other}, deleted)),
                                              'src': link.get('src')}, deleted, rule, stepconds, ids)
                acts += more
        else:
            acts = _plain_acts(link, deleted)
        if len(acts) > MAX_ACTS:
            raise ValueError('An interaction supports at most 24 actions; create another rule')
        if not any(isinstance(a, dict) for a in acts):   # nothing it does (only checks and waits): not built
            continue
        if not steps:
            acts.sort(key=lambda a: float(a.get('delay') or 0))       # the link waits from one to the next
        props = cause_props(link, usable, rule)
        props['Label'] = _quoted(_text(link.get('label') or link['when']))
        gate = phase_gate(link.get('phase'), phases)
        if gate:
            props['PhaseGate'] = '"%s"' % gate
        for i, c in enumerate(reqs):
            props['Cond(%d)' % i] = '"%s"' % conditions.encode(c)
        if link.get('once'):
            props['bOnce'] = 'True'
        if steps:
            props['bSteps'] = 'True'
            for i, c in enumerate(stepconds):
                props['StepCond(%d)' % i] = '"%s"' % c
        for i, a in enumerate(acts[:MAX_ACTS]):
            if isinstance(a, list):                 # a step of the list: check, goto, until, wait
                props['Act(%d)' % i] = _quoted('|'.join(a))
                continue
            props['Act(%d)' % i] = _quoted(act_string(_group_blocks(rule, i, a, out)))
        cls = 'UCLink'
        if v2:                                  # the Logic runtime v2: a UCRule, a UCRuleAlso for each other cause
            cls = 'UCRule'
            if link.get('match') == 'any' and len(reqs) > 1:
                props['bAny'] = 'True'
            if else_at >= 0:
                props['ElseAt'] = str(else_at)
            if link.get('again') in AGAIN:
                props['Again'] = link['again']
            elif every_of(link):                # anyone of a set: each one's happening its own run (two at once)
                props['Again'] = 'each'
            if _whole(link.get('max'), 0) > 0:
                props['MaxRuns'] = str(_whole(link['max'], 0))
            if _secs(link.get('cooldown'), 0) > 0:
                props['Cooldown'] = '%.6f' % _secs(link['cooldown'], 0)
            if link.get('talkBusy') in TALK_BUSY:
                props['TalkBusy'] = link['talkBusy']
            for i, sid in enumerate(ids[:MAX_ACTS]):
                if sid:
                    props['ActId(%d)' % i] = '"%s"' % sid
            for k, c in enumerate(causes(link)):
                if c.get('src') in deleted:
                    continue
                if every_of(c) or WHEN.get(c.get('when')) == 'world':     # (a UCRuleAlso hears one object's event;
                    # it looks at no set, and hears nothing of the world)
                    raise ValueError('Interaction %s (%s): "Or when..." cannot be a happening of the game rules (%s): make'
                                     ' it a rule of its own' % (rule, _text(link.get('label') or link.get('src')), c.get('when')))
                also = cause_props(dict(c, id='%s_%d' % (rule, k + 1)), usable, rule)   # its own Tag (a watched one)
                also['Main'] = '"UCLink_%s"' % rule
                also['Label'] = props['Label']
                out.append(dict(cls='UCRuleAlso', name='UCRuleAlso_%s_%d' % (rule, k + 1),
                                loc=[float(v) for v in (c.get('at') or link.get('at') or [0, 0, 0])][:3], props=also))
        out.append(dict(cls=cls, name='UCLink_' + rule,
                        loc=[float(v) for v in (link.get('at') or [0, 0, 0])][:3], props=props))
    return out


HUB = 'UCLogicHub0'
MAX_WATCH = 32                               # UCLogicHub.Watch[32]


def watched(edits):
    """The states and counters pinned in the Logic window's list (edits['logic']['watch']: their names), as the game
    names them, each once, at most MAX_WATCH."""
    logic = edits.get('logic') if isinstance(edits.get('logic'), dict) else {}
    names = [_game_name(n) for n in logic.get('watch') or [] if isinstance(n, str)]
    seen, out = set(), []
    for n in names:
        if n and n.lower() not in seen:          # the game's names have no case
            seen.add(n.lower())
            out.append(n)
    return out[:MAX_WATCH]


def starts(edits):
    """The start values of states and counters (edits['logic']['start'] = {name: True / False (a state) or a whole
    number (a counter)}), as the game names them, each once, at most MAX_WATCH: [(name, 'b' or 'i', value)].
    Anything else (a text, a fraction) is left out."""
    logic = edits.get('logic') if isinstance(edits.get('logic'), dict) else {}
    given = logic.get('start') if isinstance(logic.get('start'), dict) else {}
    seen, out = set(), []
    for n, v in given.items():
        g = _game_name(n) if isinstance(n, str) else ''
        if not g or g.lower() in seen:
            continue
        if isinstance(v, bool):
            out.append((g, 'b', 1 if v else 0))
        elif isinstance(v, int) or (isinstance(v, float) and v.is_integer() and abs(v) < 2 ** 31):
            out.append((g, 'i', int(v)))
        else:
            continue
        seen.add(g.lower())
    return out[:MAX_WATCH]


def hub(edits):
    """The map's UCLogicHub (P5): one, UCLogicHub0, when the map has something for it (states watched while playing,
    start values), else None. {'cls', 'name', 'loc', 'props'} as blocks()."""
    names, given = watched(edits), starts(edits)
    if not names and not given:
        return None
    props = {'Watch(%d)' % i: _quoted(n) for i, n in enumerate(names)}
    props.update({'Start(%d)' % i: _quoted('%s|%s|%d' % s) for i, s in enumerate(given)})
    return dict(cls='UCLogicHub', name=HUB, loc=[0.0, 0.0, 0.0], props=props)


def hub_report(edits):
    """The build's line for the map's hub ('' with none): '  EDIT logic hub: 2 watched while playing, 1 start value'."""
    names, given = watched(edits), starts(edits)
    parts = (['%d watched while playing' % len(names)] if names else []) + (
        ['%d start value%s' % (len(given), '' if len(given) == 1 else 's')] if given else [])
    return '  EDIT logic hub: ' + ', '.join(parts) if parts else ''


def light_targets(edits, map_lights=()):
    edits = logicpatterns.expand(edits)
    deleted = set(edits.get('deleted') or {}) | activation.names(edits)
    edits = expand_groups(expand_while(edits), deleted)
    names = set()
    for link in edits.get('links') or []:
        if not valid(link) or link.get('src') in deleted:
            continue
        for a in _all_actions(link):
            area = area_data(a, deleted | {link.get('src')})
            if area is not None and a.get('verb') in LIGHT_VERBS | LIGHT_CHANGES:
                candidates=object_tags.matching_lights(map_lights,area.get('tag',''),edits)
                names.update(set(area['members']) & candidates if isinstance(map_lights,dict) else area['members'])
                if area['dynamic']:
                    names.update(candidates - deleted - {link.get('src')})
            if a.get('verb') in LIGHT_VERBS | LIGHT_CHANGES and a.get('targetTag'):
                names.update(object_tags.matching_lights(map_lights,a['targetTag'],edits) - deleted - {link.get('src')})
            if a.get('verb') in LIGHT_VERBS | LIGHT_CHANGES and _name(a.get('target')) and a['target'] not in deleted:
                names.add(a['target'])
            if a.get('verb') in LIGHT_VERBS | LIGHT_CHANGES and a.get('_members'):      # a group's: its lights
                candidates = object_tags.matching_lights(map_lights, '', edits)
                names.update(set(a['_members']) & candidates if isinstance(map_lights, dict) else a['_members'])
    return sorted(names)


def commands(edits, map_lights=()):
    """After the import: the lights the interactions turn on and off can change (non-static)."""
    return ['UC_PROP %s bStatic False' % n for n in light_targets(edits, map_lights)]


def without_replaced(edits):
    """The rules a script does now (Turn into script, P8: `replacedBy`, rulescript.py) left out: their causes are the
    thin rules that call the script."""
    rules = edits.get('links') or []
    if not any(isinstance(l, dict) and l.get('replacedBy') for l in rules):
        return edits
    return dict(edits, links=[l for l in rules if not (isinstance(l, dict) and l.get('replacedBy'))])


def report(edits):
    edits = logicpatterns.expand(edits)
    lines = []
    disabled = activation.names(edits)
    for name, u in usable_entries(edits, set(edits.get('deleted') or {}) | disabled).items():
        lines.append('  EDIT usable %s: "%s"%s' % (name, _text(u.get('text') or 'Use'),
                                                     ', %g s' % _secs(u.get('secs'), 0) if _secs(u.get('secs'), 0) else ''))
    placed = {i['id']: i['name'] for i in logicpatterns.instances(edits)}
    try:                                            # as the build sees them: a rule on anyone of a kind has no object
        built = {l.get('id'): l for l in expand_groups(edits).get('links') or [] if isinstance(l, dict)}
    except ValueError:
        built = {}
    for link in edits.get('links') or []:
        if link.get('replacedBy'):                  # Turn into script: the script does it now
            lines.append('  EDIT interaction %s: done by the script %s' % (link.get('id'), _name(link['replacedBy'].get('script'))))
            continue
        refs = ({link.get('src')} | {a.get('target') for a in link.get('do') or []}) & disabled
        if refs:
            lines.append('  EDIT interaction %s: disabled objects excluded (%s)' % (link.get('id'), ', '.join(sorted(refs))))
        if valid(built.get(link.get('id'), link)):
            said = link.get('label') or ' '.join(str(x) for x in (link.get('src'), link.get('when')) if x)
            if link.get('instance') in placed:         # a placed pattern's rule has no sentence of its own
                said = 'the pattern "%s": %s' % (placed[link['instance']], said)
            lines.append('  EDIT interaction %s: %s' % (link.get('id'), _text(said)))
        else:
            lines.append('  EDIT skipped interaction %s (no object or no action)' % link.get('id'))
    return lines
