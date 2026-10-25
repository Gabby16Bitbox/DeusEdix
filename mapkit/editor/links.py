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
import gametext
import logic_catalog
import object_tags

# what can start an interaction (how the link hears it) and what one can do: the logic catalogue's
WHEN = {when: entry['hears'] for when, entry in logic_catalog.OUTPUTS.items()}
VERBS = set(logic_catalog.INPUTS)
OPTIONS = 4                                  # a computer's special options (Computers.specialOptions[4])
EFFECTS = ('mist', 'smoke', 'sparks', 'fire', 'blinklight', 'pulse', 'off')
LIGHT_VERBS = {'lighton', 'lightoff', 'lighttoggle'}
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
    return logic_catalog.tag(when, src, option_of(link)) or 'UCLW_' + _name(link.get('id') or 'x')


def act_string(a):
    verb = str(a.get('verb') or '')
    target_tag = object_tags.value(a.get('targetTag',''))
    if target_tag and (verb not in object_tags.TAG_VERBS or a.get('area') is not None):
        raise ValueError('Invalid scripting-tag action.')
    fields = ['%g' % max(0.0, float(a.get('delay') or 0)), verb, '' if target_tag else _name(a.get('target'))]
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
    elif verb == 'npcuse':                      # the character goes to the object (a), b seconds, c pose
        fields += [_name(a.get('a')), '%g' % _secs(a.get('b'), 3), 'stand' if a.get('c') == 'stand' else 'crouch']
    elif verb == 'effect':                      # a kind, b seconds (0 = until stopped), c colour (+ beep)
        kind = str(a.get('a') or 'mist').strip().lower()
        fields += [kind if kind in EFFECTS else 'mist', '%g' % _secs(a.get('b'), 0), _text(a.get('c')).lower()]
    elif verb == 'timerstart':                  # a: seconds of this run (empty: the timer's own)
        fields += ['%g' % _secs(a.get('a'), 0) if _secs(a.get('a'), 0) > 0 else '', '', '']
    elif verb == 'input':                       # a script's input (a), its arguments (b: "Seconds=10;Mode=red")
        fields += [_name(a.get('a')), _args(a.get('b')), '']
    elif verb == 'count':                       # a counter (a) changes by b, or is set to b (c = 'set')
        fields += [_game_name(a.get('a')), '%d' % _whole(a.get('b'), 1), 'set' if a.get('c') == 'set' else '']
    elif verb == 'floor':                       # an elevator goes to its floor a (its sequence: SetSeq)
        fields += ['%d' % max(0, _whole(a.get('a'), 0)), '', '']
    else:
        fields += [_text(a.get(k)) for k in ('a', 'b', 'c')]
        if verb in ('flag', 'goal'):            # the names of the Story and of the conditions (conditions.ident)
            fields[3] = _game_name(a.get('a'), 'G' if verb == 'goal' else 'X')
    area = area_data(a)
    if area is not None:
        fields += area_fields(area) + [_name(a.get('_group'))]
        if area.get('tag'):fields.append(area['tag'])
    elif target_tag:
        fields += ['tag',target_tag]
    result = '|'.join(fields)
    if len(result) > 900:
        raise ValueError('Interaction text is too long for the engine; shorten this action')
    return result


def _args(v):
    """A script input's arguments, "Key=Value;Key=Value": no bars or quotes (they end a field or the value)."""
    pairs = []
    for part in str(v or '').split(';'):
        key, _, value = part.partition('=')
        if _name(key):
            pairs.append('%s=%s' % (_name(key), _text(value).strip()))
    return ';'.join(pairs)


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


def valid(link):
    when = link.get('when')
    if when not in WHEN:
        return False
    if WHEN[when] != 'start' and not _name(link.get('src')):
        return False
    if WHEN[when] == 'port' and not _name(link.get('port')):     # a script's output: which one
        return False
    return any(str(a.get('verb')) in VERBS for a in link.get('do') or [])


def blocks(edits):
    """The UCLink actors of the map: [{'cls', 'name', 'loc', 'props'}], like edits['added']."""
    object_tags.validate(edits)
    deleted = set(edits.get('deleted') or {}) | activation.names(edits)
    out = object_tags.blocks(edits,deleted)
    usable = usable_entries(edits, deleted)
    for name, u in usable.items():
        out.append(usable_block(name, u))
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
        acts = [a for a in link.get('do') or [] if str(a.get('verb')) in VERBS
                and not (a.get('target') and a['target'] in deleted)
                and not (a.get('verb') == 'npcuse' and (not _name(a.get('a')) or a['a'] in deleted))]
        acts = [dict(a, area=area_data(a, deleted | {link.get('src')})) if a.get('area') is not None else a for a in acts]
        if len(acts) > MAX_ACTS:
            raise ValueError('An interaction supports at most 24 actions; create another rule')
        if not acts:
            continue
        acts.sort(key=lambda a: float(a.get('delay') or 0))       # the link waits from one to the next
        props = {'Tag': tag_of(link, usable), 'When': link['when'], 'Rule': '"%s"' % rule,
                 'Label': _quoted(_text(link.get('label') or link['when']))}
        if _name(link.get('src')):
            props['Source'] = '"%s"' % _name(link['src'])
        if link['when'] == 'option':
            props['Option'] = str(option_of(link))
        if WHEN[link['when']] == 'port':
            props['Port'] = '"%s"' % _name(link['port'])
        for i, c in enumerate(reqs):
            props['Cond(%d)' % i] = '"%s"' % conditions.encode(c)
        if link['when'] == 'near':
            props['NearDist'] = '%.6f' % max(32.0, float(link.get('near') or 256))
        if link.get('once'):
            props['bOnce'] = 'True'
        for i, a in enumerate(acts[:MAX_ACTS]):
            area = a.get('area')
            if area and area['members']:
                stem = 'UCLG_' + rule + '_' + str(i)
                chunks = [area['members'][j:j + 128] for j in range(0, len(area['members']), 128)]
                for j, members in enumerate(chunks):
                    group_props = {'Member(%d)' % k: n for k, n in enumerate(members)}
                    if j + 1 < len(chunks):
                        group_props['NextGroup'] = stem + '_' + str(j + 1)
                    out.append(dict(cls='UCLinkGroup', name=stem + '_' + str(j),
                                    loc=list(area['at']), props=group_props))
                a = dict(a, _group=stem + '_0')
            props['Act(%d)' % i] = _quoted(act_string(a))
        out.append(dict(cls='UCLink', name='UCLink_' + rule,
                        loc=[float(v) for v in (link.get('at') or [0, 0, 0])][:3], props=props))
    return out


def light_targets(edits, map_lights=()):
    deleted = set(edits.get('deleted') or {}) | activation.names(edits)
    names = set()
    for link in edits.get('links') or []:
        if not valid(link) or link.get('src') in deleted:
            continue
        for a in link.get('do') or []:
            area = area_data(a, deleted | {link.get('src')})
            if area is not None and a.get('verb') in LIGHT_VERBS:
                candidates=object_tags.matching_lights(map_lights,area.get('tag',''),edits)
                names.update(set(area['members']) & candidates if isinstance(map_lights,dict) else area['members'])
                if area['dynamic']:
                    names.update(candidates - deleted - {link.get('src')})
            if a.get('verb') in LIGHT_VERBS and a.get('targetTag'):
                names.update(object_tags.matching_lights(map_lights,a['targetTag'],edits) - deleted - {link.get('src')})
            if a.get('verb') in LIGHT_VERBS and _name(a.get('target')) and a['target'] not in deleted:
                names.add(a['target'])
    return sorted(names)


def commands(edits, map_lights=()):
    """After the import: the lights the interactions turn on and off can change (non-static)."""
    return ['UC_PROP %s bStatic False' % n for n in light_targets(edits, map_lights)]


def report(edits):
    lines = []
    disabled = activation.names(edits)
    for name, u in usable_entries(edits, set(edits.get('deleted') or {}) | disabled).items():
        lines.append('  EDIT usable %s: "%s"%s' % (name, _text(u.get('text') or 'Use'),
                                                     ', %g s' % _secs(u.get('secs'), 0) if _secs(u.get('secs'), 0) else ''))
    for link in edits.get('links') or []:
        refs = ({link.get('src')} | {a.get('target') for a in link.get('do') or []}) & disabled
        if refs:
            lines.append('  EDIT interaction %s: disabled objects excluded (%s)' % (link.get('id'), ', '.join(sorted(refs))))
        if valid(link):
            lines.append('  EDIT interaction %s: %s' % (link.get('id'), _text(link.get('label') or link.get('when'))))
        else:
            lines.append('  EDIT skipped interaction %s (no object or no action)' % link.get('id'))
    return lines
