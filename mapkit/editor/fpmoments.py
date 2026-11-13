"""First-person moments (static/fp-moments.js; in the game UCViewMoment): the weapon JC holds plays pieces of its own
animations, moves in the view, with its sounds and a shake, when an Interaction says so ("JC's weapon plays a moment").

edits['fpmoments'] = {name: {'weapon': its class ('' any), 'mesh': its first-person model,
                             'clips': [{'seq', 'from', 'to' (frames of the sequence: to past from plays it backwards),
                                        'frames' (how many the sequence has), 'secs'}],
                             'offsets': [{'t', 'x', 'y', 'z', 'ease'}]   (added to the weapon's PlayerViewOffset;
                                         ease: the way to the key, laid as straight steps: game_offsets),
                             'sounds': [{'t', 'sound' (Package.Group.Name)}],
                             'shake': {'t', 'secs', 'roll', 'vert'},
                             'viewMesh': a copy of its model with imported animations ('' none)}}
Each becomes a UCViewMoment actor (UCFP_<name>); only the moments a rule of the map plays are written.
"""
import re

NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,40}$')
SEQ = re.compile(r'^[A-Za-z_]\w{0,62}$')
CLASS = re.compile(r'^[A-Za-z_]\w{0,62}$')
OBJ = re.compile(r'^[A-Za-z_]\w*(\.[A-Za-z_]\w*){1,2}$')
CLIPS, OFFSETS, SOUNDS = 16, 16, 8
EASES = ('smooth', 'in', 'out')
STEPS_MAX = 4


def _num(v, default=0.0, lo=-1e6, hi=1e6):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return min(hi, max(lo, f)) if f == f else default


def ease(kind, u):
    """A way's shape (static/fp-moment.js ease): u (0..1 of the time) -> how far along."""
    u = min(1.0, max(0.0, u))
    if kind == 'smooth':
        return u * u * (3 - 2 * u)
    if kind == 'in':
        return u * u
    if kind == 'out':
        return 1 - (1 - u) * (1 - u)
    return u


def game_offsets(offsets):
    """The keys as the game has them (static/fp-moment.js gameOffsets, the same numbers): UCViewMoment goes straight
    from key to key, so a way eased to a key (13 Nov 2026) is laid as straight steps before it, the game's 16 keys
    shared out among the eased ways (at most STEPS_MAX each). A key with no ease goes straight."""
    keys = sorted((o for o in offsets or [] if isinstance(o, dict)), key=lambda o: _num(o.get('t')))[:OFFSETS]
    kind = lambda o: o.get('ease') if o.get('ease') in EASES else 'linear'
    eased = sum(1 for o in keys if kind(o) != 'linear')
    steps = min(STEPS_MAX, (OFFSETS - len(keys)) // eased) if eased else 0
    out, prev = [], dict(t=0.0, x=0.0, y=0.0, z=0.0)
    r = lambda x: round(x * 1e6) / 1e6
    for o in keys:
        k = {c: _num(o.get(c)) for c in 'txyz'}
        if kind(o) != 'linear' and steps > 0 and k['t'] - prev['t'] > 0.02:
            for j in range(1, steps + 1):
                u = j / (steps + 1)
                f = ease(kind(o), u)
                out.append(dict(t=r(prev['t'] + (k['t'] - prev['t']) * u),
                                **{c: r(prev[c] + (k[c] - prev[c]) * f) for c in 'xyz'}))
        out.append(k)
        prev = k
    return out


def used(edits):
    """The moments a rule of the map plays."""
    out = set()
    for l in edits.get('links') or []:
        for a in (l.get('do') or []) + (l.get('else') or []) if isinstance(l, dict) else []:
            if isinstance(a, dict) and a.get('verb') == 'fpmoment' and NAME.match(str(a.get('a') or '')):
                out.add(a['a'])
    return out


def props_of(name, m):
    """The UCViewMoment's properties of a moment (its values as the map writes them)."""
    p = {'MomentName': '"%s"' % name}
    weapon = str(m.get('weapon') or '').split('.')[-1]
    if CLASS.match(weapon):
        p['WeaponClass'] = '"%s"' % weapon
    clips = [c for c in m.get('clips') or [] if isinstance(c, dict) and SEQ.match(str(c.get('seq') or ''))][:CLIPS]
    for i, c in enumerate(clips):
        n = max(1, int(_num(c.get('frames'), 1, 1, 100000)))
        p['Seq(%d)' % i] = c['seq']
        p['SeqFrom(%d)' % i] = '%.6f' % (_num(c.get('from'), 0, 0, n) / n)
        p['SeqTo(%d)' % i] = '%.6f' % (_num(c.get('to'), n - 1, 0, n) / n)
        p['SeqTime(%d)' % i] = '%.6f' % _num(c.get('secs'), 1, 0.01, 600)
    p['NumSeq'] = str(len(clips))
    offsets = game_offsets(m.get('offsets'))[:OFFSETS]
    for i, o in enumerate(offsets):
        p['OffT(%d)' % i] = '%.6f' % _num(o.get('t'), 0, 0, 600)
        p['OffV(%d)' % i] = '(X=%.6f,Y=%.6f,Z=%.6f)' % tuple(_num(o.get(k), 0, -200, 200) for k in 'xyz')
    p['NumOff'] = str(len(offsets))
    sounds = sorted((s for s in m.get('sounds') or [] if isinstance(s, dict) and OBJ.match(str(s.get('sound') or ''))),
                    key=lambda s: _num(s.get('t')))[:SOUNDS]
    for i, s in enumerate(sounds):
        p['SndT(%d)' % i] = '%.6f' % _num(s.get('t'), 0, 0, 600)
        p['Snd(%d)' % i] = "Sound'%s'" % s['sound']
    p['NumSnd'] = str(len(sounds))
    shake = m.get('shake') if isinstance(m.get('shake'), dict) else {}
    if _num(shake.get('secs')) > 0:
        p['ShakeAt'] = '%.6f' % _num(shake.get('t'), 0, 0, 600)
        p['ShakeTime'] = '%.6f' % _num(shake.get('secs'), 0, 0, 10)
        p['ShakeRoll'] = '%.6f' % _num(shake.get('roll'), 200, 0, 10000)
        p['ShakeVert'] = '%.6f' % _num(shake.get('vert'), 4, 0, 1000)
    if OBJ.match(str(m.get('viewMesh') or '')):       # loaded by name in the game (DeusEdixAnims: installed with it)
        p['ViewMeshName'] = '"%s"' % m['viewMesh']
    return p


def blocks(edits):
    """The UCViewMoment actors of the map: [{'cls', 'name', 'loc', 'props'}], like edits['added']."""
    moments = edits.get('fpmoments') if isinstance(edits.get('fpmoments'), dict) else {}
    return [dict(cls='UCViewMoment', name='UCFP_' + name, loc=[0, 0, 0], props=props_of(name, moments[name]))
            for name in sorted(used(edits)) if isinstance(moments.get(name), dict)]


def packages(edits):
    """The packages its moments' sounds and models come from (for prefabs.package_commands: 'sound:<pkg>' a sound's)."""
    out = set()
    for a in blocks(edits):
        for k, v in a['props'].items():
            m = re.match(r"Sound'([A-Za-z_]\w*)\.", str(v))
            if m:
                out.add('sound:' + m.group(1))
    return sorted(out)


def report(edits):
    moments = edits.get('fpmoments') if isinstance(edits.get('fpmoments'), dict) else {}
    lines = ['  EDIT first-person moment %s' % n for n in sorted(used(edits)) if n in moments]
    lines += ['  A rule plays the first-person moment %s, which this map does not have: left out' % n
              for n in sorted(used(edits) - set(moments))]
    return lines
