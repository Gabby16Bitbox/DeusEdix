"""Animations made in the map editor's Animation panel (keyframes of position, rotation and scale of any
object, like Premiere's Motion or Unity's Animation window), and the moving blocks and collision boxes.

edits['motions'] = {'<object name>': {
    'pos':   [{'t': seconds, 'v': [x, y, z] (offset from where it is), 'e': curve}],
    'rot':   [{'t': seconds, 'v': [pitch, yaw, roll] (rotation units: 65536 = a turn), 'e': curve}],
    'scale': [{'t': seconds, 'v': times its size, 'e': curve}],
    'mode': 'once' | 'loop' | 'pingpong', 'autoplay': False}}
curves: 0 linear, 1 smooth, 2 ease in, 3 ease out, 4 hold.

In the game (src/UnatcoContinues/Classes/UCMotion.uc) an object is moved every frame, through its keys with the
speed it has at each (a smooth key does not stop it); a MOVER (a door, an elevator, a moving block) gets the keys
as its own KeyPos/KeyRot (up to 8: the engine moves it and carries who stands on it) and UCMotion gives it the
time of each step. The engine moves a mover one way through all its keys (mover_glide): gliding (easing in and
out, so it stops at every key) or at a constant speed (Linear keys). Interactions play them (links.py: anim,
animback, animstop) and can start when one has finished ('animdone').

A block with 'mover' is built as a DeusExMover (a block that can move); a UCTriggerBox with bSolidBox gets an
invisible solid brush of its size (an invisible wall).
"""
import re

import geom

PF_INVISIBLE = 1
PF_SEMISOLID = 32
MODES = {'once': 0, 'loop': 1, 'pingpong': 2}
MAX_KEYS = 16
MAX_MOVER_KEYS = 8


def _name(s):
    s = str(s or '').strip()
    return s if re.fullmatch(r'\w+', s) else ''


def _track(m, key):
    keys = [k for k in (m.get(key) or []) if isinstance(k, dict) and 't' in k]
    keys.sort(key=lambda k: float(k['t']))
    return keys[:MAX_KEYS]


def _sample(keys, t, size):
    """A track's value at time t, linear between keys (for the keys of a mover: the engine glides)."""
    zero = [0.0] * size if size > 1 else 1.0
    if not keys:
        return zero
    if t <= float(keys[0]['t']):
        return keys[0]['v']
    for a, b in zip(keys, keys[1:]):
        ta, tb = float(a['t']), float(b['t'])
        if ta <= t <= tb:
            u = 0.0 if tb <= ta else (t - ta) / (tb - ta)
            if size > 1:
                return [float(a['v'][i]) + (float(b['v'][i]) - float(a['v'][i])) * u for i in range(size)]
            return float(a['v']) + (float(b['v']) - float(a['v'])) * u
    return keys[-1]['v']


CURVE_NAMES = {0: 'Linear', 1: 'Smooth', 2: 'Ease in', 3: 'Ease out', 4: 'Hold'}


def mover_glide(m):
    """How the engine moves a mover through its keys, one way for all of them: (glide, notes). Glide
    (MV_GlideByTime) eases in and out at every key, so it stops at each; else (MV_MoveByTime) a constant speed.
    Linear keys ask for the constant speed, any other curve for the glide; when they differ, the one that rules
    most of its time wins. notes: what its keys ask for that the game cannot do (the editor shows the game's way)."""
    eased = linear = 0.0
    curves = set()
    for key in ('pos', 'rot'):
        tr = _track(m, key)
        for a, b in zip(tr, tr[1:]):
            e = int(a.get('e', 1))
            curves.add(e)
            if e == 0:
                linear += max(0.0, float(b['t']) - float(a['t']))
            else:
                eased += max(0.0, float(b['t']) - float(a['t']))
    glide = eased >= linear
    notes = []
    if 0 in curves and curves - {0}:
        notes.append('Linear and other curves mixed')
    if curves & {2, 3, 4}:
        notes.append(' / '.join(CURVE_NAMES[e] for e in sorted(curves & {2, 3, 4})))
    times = [{round(float(k['t']), 3) for k in _track(m, key)} for key in ('pos', 'rot')]
    if glide and all(times) and times[0] != times[1]:
        notes.append('position and rotation keys at different times (it stops at each)')
    if len({0.0} | times[0] | times[1]) > MAX_MOVER_KEYS:
        notes.append('more than %d key times (the later ones are left out)' % MAX_MOVER_KEYS)
    return glide, notes


def length(m):
    return max([float(k['t']) for key in ('pos', 'rot', 'scale') for k in _track(m, key)] + [0.0])


def movers_of(edits, known_movers):
    """Names of the animated objects that are movers: the map's (known_movers), raw movers added, moving blocks."""
    out = set(known_movers or ())
    out |= {a['name'] for a in edits.get('added') or [] if 'Mover' in str(a.get('cls', ''))}
    out |= {b['name'] for b in edits.get('boxes') or [] if b.get('mover')}
    return out


def mover_keys(m):
    """[(t, pos, rot)] of a mover: one key at every time of its tracks (at most 8, the first at 0)."""
    pos, rot = _track(m, 'pos'), _track(m, 'rot')
    times = sorted({0.0} | {round(float(k['t']), 3) for k in pos + rot})[:MAX_MOVER_KEYS]
    return [(t, _sample(pos, t, 3), _sample(rot, t, 3)) for t in times]


def _vec(v):
    return '(X=%.3f,Y=%.3f,Z=%.3f)' % tuple(float(c) for c in v)


def _rot(v):
    return '(Pitch=%d,Yaw=%d,Roll=%d)' % tuple(int(round(float(c))) for c in v)


def blocks(edits, known_movers=()):
    """UCMotion actors: [{'cls', 'name', 'loc', 'props'}], like edits['added']."""
    out = []
    movers = movers_of(edits, known_movers)
    deleted = edits.get('deleted') or {}
    for name, m in sorted((edits.get('motions') or {}).items()):
        if not _name(name) or name in deleted or not isinstance(m, dict):
            continue
        props = {'Target': '"%s"' % name, 'Mode': str(MODES.get(m.get('mode'), 0))}
        if m.get('autoplay'):
            props['bAutoPlay'] = 'True'
        if name in movers:
            keys = mover_keys(m)
            if len(keys) < 2:
                continue
            for i in range(len(keys) - 1):
                props['Seg(%d)' % i] = '%.4f' % max(0.05, keys[i + 1][0] - keys[i][0])
            props['Length'] = '%.4f' % keys[-1][0]
        else:
            n = 0
            for key, arr in (('pos', 'Pos'), ('rot', 'Rot'), ('scale', 'Scale')):
                tr = _track(m, key)
                for i, k in enumerate(tr):
                    props['%sT(%d)' % (arr, i)] = '%.4f' % float(k['t'])
                    props['%sV(%d)' % (arr, i)] = (_vec(k['v']) if key == 'pos' else _rot(k['v']) if key == 'rot'
                                                   else '%.4f' % float(k['v']))
                    props['%sE(%d)' % (arr, i)] = str(int(k.get('e', 1)))
                if tr:
                    props['Num%s' % arr] = str(len(tr))
                    n += len(tr)
            if not n:
                continue
            props['Length'] = '%.4f' % max(0.05, length(m))
        out.append(dict(cls='UCMotion', name='UCMotion_' + name, loc=[0.0, 0.0, 0.0], props=props))
    return out


def commands(edits, known_movers=(), lights=()):
    """After the import: the keys of the animated movers (their KeyPos/KeyRot, NumKeys, glide), and the
    lights that move made non-static."""
    cmds = []
    movers = movers_of(edits, known_movers)
    for name, m in sorted((edits.get('motions') or {}).items()):
        if not _name(name) or name in (edits.get('deleted') or {}) or not isinstance(m, dict):
            continue
        if name in movers:
            keys = mover_keys(m)
            if len(keys) < 2:
                continue
            cmds.append('UC_PROP %s NumKeys %d' % (name, len(keys)))
            for i, (t, p, r) in enumerate(keys):
                cmds.append('UC_PROP %s KeyPos(%d) %s' % (name, i, _vec(p)))
                cmds.append('UC_PROP %s KeyRot(%d) %s' % (name, i, _rot(r)))
            cmds.append('UC_PROP %s MoveTime %.4f' % (name, max(0.05, keys[1][0] - keys[0][0])))
            glide = mover_glide(m)[0]
            cmds.append('UC_PROP %s MoverGlideType %s' % (name, 'MV_GlideByTime' if glide else 'MV_MoveByTime'))
            # lit where it is, not with the light of where it was built (a door turned 90 degrees was dark)
            cmds.append('UC_PROP %s bDynamicLightMover True' % name)
        elif name in lights:
            cmds.append('UC_PROP %s bStatic False' % name)
    return cmds


def report(edits, known_movers=()):
    lines = []
    movers = movers_of(edits, known_movers)
    for n, m in sorted((edits.get('motions') or {}).items()):
        if n in (edits.get('deleted') or {}) or not isinstance(m, dict):
            continue
        how = ''
        if n in movers:
            glide, notes = mover_glide(m)
            how = ', a mover: %s' % ('it glides, stopping at every key' if glide else 'at a constant speed')
            if notes:
                how += ' (the game cannot do: %s)' % '; '.join(notes)
        lines.append('  EDIT animation of %s: %.1f s, %s%s%s' % (n, length(m), m.get('mode', 'once'),
                                                                ', at the start' if m.get('autoplay') else '', how))
    return lines


# ---------------------------------------------------------------- moving blocks, collision boxes
def moving_block(b):
    """A block that can move: (center, Brush relative to it, props) of a DeusExMover."""
    lo, hi = [float(v) for v in b['lo']], [float(v) for v in b['hi']]
    c = [(lo[k] + hi[k]) / 2 for k in range(3)]
    brush = geom.box(tuple(lo[k] - c[k] for k in range(3)), tuple(hi[k] - c[k] for k in range(3)),
                     geom.Mat(b.get('tex') or 'ClenGreyCncrt_A', align=tuple(-v for v in c)), name=b['name'])
    brush = geom.rotate_brush(brush, (0, 0, 0), b.get('rot'))
    props = dict(InitialState='TriggerControl', bFrobbable='False', bIsDoor='False', bBreakable='False',
                 bHighlight='False', bPickable='False', MoveTime='1.000000')
    return c, brush, props


def mover_block_t3d(b):
    """The T3D of a moving block (for the builds of existing maps: dxmaps)."""
    from scene import Scene
    c, brush, props = moving_block(b)
    model = 'UCMdl' + b['name']
    body = geom.Brush(brush.faces, model).t3d() + "    Brush=Model'MyLevel.%s'" % model
    props = dict(props, BasePos='(X=%.3f,Y=%.3f,Z=%.3f)' % tuple(c))
    return Scene._block('DeusExMover', tuple(c), b['name'], None, body, props)


def wall_ops(edits):
    """Invisible walls: [('add', Brush, flags)] for added solid box/cylinder volumes."""
    ops = []
    for a in edits.get('added') or []:
        # its properties: as added, then as changed in the Properties panel (edits['props'])
        p = dict(a.get('props') or {}, **((edits.get('props') or {}).get(a['name']) or {}))
        if a.get('cls') != 'UCTriggerBox' or str(p.get('bSolidBox', 'False')) != 'True':
            continue
        scale = max(0.01, float(a.get('scale') or 1))
        x, y, z = (float(v) for v in a['loc'])
        mat = geom.Mat('ClenGreyCncrt_A', flags=PF_INVISIBLE)
        name = 'UCWall_' + a['name']
        if str(p.get('bCylinder', 'False')).lower() == 'true':
            radius = max(2, float(p.get('CylinderRadius', 64))) * scale
            height = max(2, float(p.get('CylinderHeight', 64))) * scale
            brush = geom.prism((x, y), radius, z - height, z + height, mat, sides=32, name=name)
        else:
            e = [max(2, float(p.get(k, 64))) * scale for k in ('BoxX', 'BoxY', 'BoxZ')]
            lo, hi = (x - e[0], y - e[1], z - e[2]), (x + e[0], y + e[1], z + e[2])
            brush = geom.box(lo, hi, mat, name=name)
        ops.append(('add', brush, PF_INVISIBLE | PF_SEMISOLID))
    return ops
