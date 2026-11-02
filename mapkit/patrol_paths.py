"""Walking support for long legs of editor-drawn patrols.

Nextpatrol still owns the numbered stop order. Ordinary PathNodes only fill gaps
in UE1's reach-spec graph; PATHS DEFINE checks clearance, steps and obstacles.
Nothing here forces a link through a wall or changes an original game's route.
"""
import hashlib
import math
import re

import t3d

TAG = 'UCEdRoutePath'
PREFIX = 'UCRoutePath_'
SPACING = 384.0
MIN_LEG = 640.0


def _name(value):
    return str(value or '').strip('\"\'').casefold()


def owned(actor):
    p = {k.casefold(): v for k, v in actor.get('props', {}).items()}
    return (actor.get('cls', '').split('.')[-1].casefold() == 'pathnode'
            and re.fullmatch(PREFIX + r'[0-9a-f]{12}_\d+', actor.get('name', ''), re.I) is not None
            and re.fullmatch(TAG + r'_[0-9a-f]{12}', str(p.get('tag', '')), re.I) is not None)


def _owner_tag(name):
    return TAG + '_' + hashlib.sha256(_name(name).encode()).hexdigest()[:12]


def prepare(actors, edits):
    """Return (helper actors, old helper names, report), without mutating inputs.

    actors is the effective source/import actor list. Property overrides are
    applied case-insensitively in the same order as props.commands. Added route
    metadata identifies the owners, so unrelated stock patrols stay untouched.
    """
    actors = list(actors)
    old = [a['name'] for a in actors if owned(a)]
    removed = {_name(n) for n in edits.get('deleted', {})}
    removed.update(_name(n) for n, disabled in edits.get('disabled', {}).items() if disabled)
    table = {}
    for a in actors:
        if _name(a['name']) in removed or owned(a):
            continue
        p = {k.casefold(): v for k, v in a.get('props', {}).items()}
        table[_name(a['name'])] = dict(a, props=p)
    for section in ('props', 'rawprops'):
        for n, values in edits.get(section, {}).items():
            if _name(n) in table:
                table[_name(n)]['props'].update({k.casefold(): v for k, v in values.items()})
    for n, move in edits.get('moved', {}).items():
        if _name(n) in table and 'loc' in move:
            table[_name(n)]['loc'] = move['loc']
    tags = {}
    for a in table.values():
        if a['cls'].split('.')[-1].casefold() == 'patrolpoint':
            tags.setdefault(_name(a['props'].get('tag')), []).append(a)
    owners = {_name(a.get('route')) for a in edits.get('added', []) if a.get('route')}
    # Installed .dx maps bake the edits into their source. Retain ownership after
    # that bake, including short routes which have never needed helper nodes.
    old_tags = {_name(v) for a in actors if owned(a) for k, v in a['props'].items() if k.casefold() == 'tag'}
    for name, a in table.items():
        tag = _name(a['props'].get('ordertag'))
        first = tags.get(tag, [])
        generated = (re.fullmatch(re.escape(name) + r'_patrol\d+', tag) is not None
                     and len(first) == 1 and first[0]['name'].casefold().startswith('ucedit'))
        if generated or _name(_owner_tag(name)) in old_tags:
            owners.add(name)
    owners = sorted(owners)
    nodes, report, used = [], [], set()
    for owner in owners:
        pawn = table.get(owner)
        if not pawn or _name(pawn['props'].get('orders')) != 'patrolling':
            continue
        route, seen, tag = [], set(), _name(pawn['props'].get('ordertag'))
        while tag and tag != 'none' and tag not in seen:
            seen.add(tag)
            choices = tags.get(tag, [])
            if len(choices) != 1:
                report.append('  PATROL %s: %s tag %s; check the route points.' %
                              (pawn['name'], 'ambiguous' if choices else 'missing', tag))
                break
            a = choices[0]
            route.append(a)
            tag = _name(a['props'].get('nextpatrol'))
        if tag in seen and route and len(tags.get(tag, [])) == 1:
            route.append(tags[tag][0])
        count = 0
        for a, b in zip(route, route[1:]):
            edge = tuple(sorted((_name(a['name']), _name(b['name']))))
            if edge in used:
                continue
            used.add(edge)
            locs = [x.get('loc', t3d.vec(x['props'].get('location'))) for x in (a, b)]
            if any(len(p) != 3 or not all(math.isfinite(float(v)) for v in p) for p in locs):
                continue
            p, q = ([float(v) for v in loc] for loc in locs)
            distance = math.dist(p, q)
            if distance <= MIN_LEG:
                continue
            # Guard corrupt/extreme coordinates; never generate an unbounded map.
            steps = math.ceil(distance / SPACING)
            if steps > 128:
                report.append('  PATROL %s: route leg %s -> %s is too long; add intermediate route points.' %
                              (pawn['name'], a['name'], b['name']))
                continue
            key = hashlib.sha256(('\0'.join(edge)).encode()).hexdigest()[:12]
            for i in range(1, steps):
                name = '%s%s_%d' % (PREFIX, key, i)
                if _name(name) in table:
                    raise ValueError('Patrol helper name conflicts with an existing object: ' + name)
                nodes.append(dict(name=name, cls='PathNode', loc=[float(p[k]) + (float(q[k])-float(p[k]))*i/steps for k in range(3)],
                                  props={'Tag': _owner_tag(owner), 'bHiddenEd': 'True'}))
                count += 1
        if count:
            report.append('  PATROL %s: %d walking nodes for long route legs (numbered stops unchanged).' % (pawn['name'], count))
    return nodes, old, report
