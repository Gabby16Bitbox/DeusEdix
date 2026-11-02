"""First-person moments (static/fp-moments.js; in the game UCViewMoment): the weapon JC holds plays pieces of its own
animations, moves in the view, with its sounds and a shake, when an Interaction says so ("JC's weapon plays a moment").

edits['fpmoments'] = {name: {'weapon': its class ('' any), 'mesh': its first-person model,
                             'clips': [{'seq', 'from', 'to' (frames of the sequence: to past from plays it backwards),
                                        'frames' (how many the sequence has), 'secs'}],
                             'offsets': [{'t', 'x', 'y', 'z'}]   (added to the weapon's PlayerViewOffset),
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


def _num(v, default=0.0, lo=-1e6, hi=1e6):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return min(hi, max(lo, f)) if f == f else default


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
    offsets = sorted((o for o in m.get('offsets') or [] if isinstance(o, dict)), key=lambda o: _num(o.get('t')))[:OFFSETS]
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
