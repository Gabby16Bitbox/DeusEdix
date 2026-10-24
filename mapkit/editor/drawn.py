"""Walls, roads, floors and ceilings drawn in the map editor (Tools > Draw wall / road / floor / ceiling): points
clicked on the map, then brushes at Rebuild. edits['drawn'] = [{name, kind, pts: [[x, y], ...], z, closed,
...its settings}], z = the ground where the first point was clicked.

- wall: a strip `thick` wide along the points, `height` high; corners mitred so two pieces meet exactly.
- road: the carriageway (`width`, a little above the ground so its texture shows) and a raised sidewalk
  each side (`walk` wide, `curb` high; 0 = none), the curb's face in curbTex.
- floor: the polygon of the points, its top `lift` above the ground, `thick` thick.
- ceiling: the polygon at `height` above the ground (the top of the walls: a room's ceiling, Gabby 16 Oct),
  `thick` thick, its underside in ceiling tiles (underTex), its top in tex.
- stairs (Gabby, 20 Oct 2026): from A (pts[0], at z) up to B (pts[1], `rise` above it), as Deus Ex makes them
  (the original maps: risers 16, treads 32, 128 wide, ClenGreyStair_A on the treads). shape: straight (A to B),
  curved (an arc of `curve` degrees turning `turn` left or right, as UnrealEd's Curved Staircase), spiral (A the
  centre, B on the floor it climbs to: its distance the outer radius; `inner` radius, `per360` steps a turn, a
  `column` in the middle, as UnrealEd's Spiral Staircase). form: steps (as many as the rise needs with risers
  near `riser`: the treads as long as the run allows, so the stairs are as steep as the two points make them)
  or ramp. base: solid (down to A's floor, as the game's) or floating (`thick` thick; a spiral always floats).
  `landing`: a flat part at the top. Each tread and riser has its texture anchored to its own front edge, along
  the stairs' own direction: the same strip of ClenGreyStair_A on every tread, also on a curve.
- roof: a slope from the eave A to the ridge B (`rise` above it, or `pitch` degrees when drawn on one level),
  `width` along the ridge, `thick` thick; gable: a second slope beyond the ridge, as far down. Its tiles run along
  the ridge, down the slope, from the ridge; underTex below, sideTex on the edges.
Every piece is a convex brush (geom.hull), added semisolid (solid to walk on and against, no BSP cuts). The map's
holes cut them before they are added (holes(): a door through a drawn wall, a stairwell through a drawn floor).
The editor (static/draw-tools.js) draws the same shapes from the same numbers (DEFAULTS mirrored there; the
parts of stairs and roofs come from the same arithmetic, tests/test_drawn_stairs.py compares both).
"""
import math

import blocks
import geom
import zones
from vec3 import Vec3

KINDS = ('wall', 'road', 'floor', 'ceiling', 'stairs', 'roof')
DEFAULTS = {
    'wall': dict(height=160, thick=16, tex='graycncrtwall_a'),
    'road': dict(width=256, walk=96, curb=8, tex='RoadBlacktop__C', walkTex='grungysdwlk_a', curbTex='ClenGreyCncrt_B'),
    'floor': dict(lift=2, thick=16, tex='flatconcrete_a', edgeTex='ClenGreyCncrt_B'),
    'ceiling': dict(height=160, thick=16, underTex='WhitCeilnTile_B', tex='flatconcrete_a', edgeTex='ClenGreyCncrt_B'),
    'stairs': dict(shape='straight', form='steps', width=128, riser=16, curve=90, turn='left', inner=32, per360=16,
                   base='solid', thick=16, landing=0, column=1, tex='ClenGreyStair_A', riserTex='SB_StairFrnt_A',
                   sideTex='flatconcrete_a'),
    'roof': dict(shape='shed', width=256, pitch=30, thick=16, tex='ClayBrwnRoofT_A', underTex='flatconcrete_a',
                 sideTex='flatconcrete_a'),
}
# ready looks for stairs (the editor offers them; the textures as the game uses them on its stairs)
STAIR_STYLES = {
    'concrete': dict(tex='ClenGreyStair_A', riserTex='SB_StairFrnt_A', sideTex='flatconcrete_a'),
    'metal': dict(tex='HevyMetlGrate_B', riserTex='ClenGrayMetal_B', sideTex='StanGrayMetal_A'),
    'marble': dict(tex='ClenGreyStair_B', riserTex='whitemarble_brk', sideTex='whitemarble_brk'),
    'industrial': dict(tex='Uob_StairTop', riserTex='mp_StairFront', sideTex='sub_beam_b'),
}
ROAD_LIFT = 2           # the carriageway's top above the ground


def settings_of(p):
    """The path's settings: its own over its kind's defaults (numbers clamped to sane sizes)."""
    out = dict(DEFAULTS[p['kind']])
    for k, v in p.items():
        if k in out:
            out[k] = v
    for k, v in list(out.items()):
        if isinstance(DEFAULTS[p['kind']][k], (int, float)):
            try:
                out[k] = max(0.0, min(8192.0, float(v)))
            except (TypeError, ValueError):
                out[k] = float(DEFAULTS[p['kind']][k])
    return out


# ------------------------------------------------------------------ 2D helpers

def _area(ring):
    return sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1]
               for i in range(len(ring))) / 2.0


def _clean(pts, closed):
    out = []
    for p in pts:
        p = (float(p[0]), float(p[1]))
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 1:
            out.append(p)
    if closed and len(out) > 2 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) <= 1:
        out.pop()
    return out


def offset(pts, d, closed):
    """The polyline moved sideways by d (positive: to the left of its direction), corners mitred (a sharp
    corner is capped at 4 times d)."""
    n = len(pts)
    out = []
    for i in range(n):
        prev = pts[i - 1] if (closed or i > 0) else None
        nxt = pts[(i + 1) % n] if (closed or i < n - 1) else None
        normals = []
        for a, b in ((prev, pts[i]), (pts[i], nxt)):
            if a is None or b is None:
                continue
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dy) or 1.0
            normals.append((-dy / L, dx / L))
        if len(normals) == 1:
            nx, ny = normals[0]
            out.append((pts[i][0] + nx * d, pts[i][1] + ny * d))
            continue
        (ax, ay), (bx, by) = normals
        mx, my = ax + bx, ay + by
        ml = math.hypot(mx, my)
        if ml < 1e-6:                                  # a U-turn: the plain normal
            out.append((pts[i][0] + ax * d, pts[i][1] + ay * d))
            continue
        mx, my = mx / ml, my / ml
        k = d / max(0.25, mx * ax + my * ay)
        out.append((pts[i][0] + mx * k, pts[i][1] + my * k))
    return out


def strips(pts, closed, d0, d1):
    """The quads between the offsets d0 and d1 of the polyline, one per segment."""
    a, b = offset(pts, d0, closed), offset(pts, d1, closed)
    n = len(pts)
    segs = range(n if closed else n - 1)
    return [[a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]] for i in segs]


def _convex(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 1e-6


def _inside(p, a, b, c):
    d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1])
    d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1])
    d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def convex_parts(ring):
    """A simple polygon (counter-clockwise) cut into convex pieces: ear clipping, then the triangles merged
    back while the result stays convex (Hertel-Mehlhorn). Returns lists of points."""
    idx = list(range(len(ring)))
    tris = []
    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = ring[i0], ring[i1], ring[i2]
            if not _convex(a, b, c):
                continue
            if any(_inside(ring[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append([i0, i1, i2])
            idx.pop(k)
            break
        else:
            raise ValueError('the shape crosses itself')
    tris.append(idx[:])
    polys = [t[:] for t in tris]

    def try_merge(p, q):
        for i in range(len(p)):
            a, b = p[i], p[(i + 1) % len(p)]
            for j in range(len(q)):
                if q[j] == b and q[(j + 1) % len(q)] == a:
                    merged = p[:i + 1] + [q[(j + 2 + t) % len(q)] for t in range(len(q) - 2)] + p[i + 1:]
                    pts = [ring[v] for v in merged]
                    if all(_convex(pts[m - 1], pts[m], pts[(m + 1) % len(pts)]) for m in range(len(pts))):
                        return merged
        return None
    changed = True
    while changed:
        changed = False
        for i in range(len(polys)):
            for j in range(i + 1, len(polys)):
                m = try_merge(polys[i], polys[j])
                if m:
                    polys[i] = m
                    polys.pop(j)
                    changed = True
                    break
            if changed:
                break
    return [[ring[v] for v in p] for p in polys]


# ------------------------------------------------------------------ stairs and roofs: their parts
# A part: {'poly': ring (counter-clockwise), 'z0', 'z1'} (a vertical prism: a step, the column) or {'pts': [x, y, z]
# points} (a convex hull: a ramp, a roof slope), with what its textures follow: 'run' (the way up, unit 2D), 'w'
# (across it, to the left), 'nose' (the front edge's middle: where a tread's and a riser's textures start), 'top';
# a slope has 'up' (unit 3D, up the slope) and 'anchor'. Mirrored by stairParts/roofParts in draw-tools.js.

def _ccw(ring):
    return ring if _area(ring) >= 0 else ring[::-1]


def _ends(p):
    """A and B ([x, y, z]) of a stairs or roof drawing; B is `rise` above A."""
    pts = p.get('pts') or []
    if len(pts) < 2:
        return None
    z = float(p.get('z', 0) or 0)
    a = (float(pts[0][0]), float(pts[0][1]), z)
    b = (float(pts[1][0]), float(pts[1][1]), z + float(p.get('rise', 0) or 0))
    return a, b


def stair_parts(p):
    s = settings_of(p)
    ends = _ends(p)
    if not ends:
        return []
    (ax, ay, az), (bx, by, bz) = ends
    shape = s['shape'] if s['shape'] in ('straight', 'curved', 'spiral') else 'straight'
    half = max(8.0, s['width']) / 2
    riser = max(4.0, s['riser'])
    if shape == 'spiral':
        return _spiral(s, (ax, ay, az), (bx, by, bz), riser)
    if bz < az:                                     # drawn from the top down: the same stairs
        (ax, ay, az), (bx, by, bz) = (bx, by, bz), (ax, ay, az)
    rise = bz - az
    dx, dy = bx - ax, by - ay
    chord = math.hypot(dx, dy)
    if chord < 1:
        return []
    ramp = s['form'] == 'ramp' or rise < riser / 2
    n = 1 if ramp else max(1, int(round(rise / riser)))
    h = rise / n
    if shape == 'curved' and s['curve'] >= 1:
        th = math.radians(min(s['curve'], 359.0)) * (1 if s['turn'] != 'right' else -1)
        R = chord / (2 * math.sin(abs(th) / 2))
        nx, ny = -dy / chord, dx / chord                 # the chord's left
        side = 1 if th > 0 else -1
        k = R * math.cos(abs(th) / 2) * side
        ox, oy = (ax + bx) / 2 + nx * k, (ay + by) / 2 + ny * k
        a0 = math.atan2(ay - oy, ax - ox)
        arc = abs(th) * R
        land = min(s['landing'], arc * 0.8)
        segs = max(n, int(math.ceil(abs(th) / math.radians(12)))) if ramp else n

        def at(t, r):                                # a point at a share t of the arc, at radius r
            a = a0 + th * t
            return (ox + math.cos(a) * r, oy + math.sin(a) * r)

        def tangent(t):
            a = a0 + th * t
            return (-math.sin(a) * side, math.cos(a) * side)
        out = []
        steps_t = (arc - land) / arc
        rin, rout = max(0.0, R - half), R + half
        for i in range(segs):
            t0, t1 = steps_t * i / segs, steps_t * (i + 1) / segs
            if i == segs - 1:
                t1 = 1.0
            run = tangent((t0 + min(t1, steps_t)) / 2)
            w = (-run[1], run[0])
            nose = at(t0, R)
            if ramp:
                z0, z1 = az + rise * i / segs, az + rise * (i + 1) / segs
                if i == segs - 1:
                    z1 = bz
                top = [(*at(t0, rin), z0), (*at(t0, rout), z0), (*at(t1, rout), z1), (*at(t1, rin), z1)]
                low = [(x, y, az if s['base'] == 'solid' else zz - s['thick']) for x, y, zz in top]
                up = _unit3((run[0] * arc / segs, run[1] * arc / segs, z1 - z0))
                out.append({'pts': top + low, 'run': run, 'w': w, 'up': up, 'anchor': (nose[0], nose[1], z0)})
            else:
                top = az + (i + 1) * h
                ring = [at(t0, rin), at(t0, rout), at(t1, rout), at(t1, rin)]
                out.append({'poly': _ccw(ring), 'z0': az if s['base'] == 'solid' else top - s['thick'], 'z1': top,
                            'run': run, 'w': w, 'nose': nose, 'top': top})
        return out
    ux, uy = dx / chord, dy / chord
    wx, wy = -uy, ux
    land = min(s['landing'], chord * 0.8)
    runlen = chord - land
    out = []
    if ramp:
        A0 = [(ax - wx * half, ay - wy * half), (ax + wx * half, ay + wy * half)]
        B0 = [(ax + ux * runlen - wx * half, ay + uy * runlen - wy * half), (ax + ux * runlen + wx * half, ay + uy * runlen + wy * half)]
        top = [(*A0[0], az), (*A0[1], az), (*B0[1], bz), (*B0[0], bz)]
        low = [(x, y, az if s['base'] == 'solid' else zz - s['thick']) for x, y, zz in top]
        out.append({'pts': top + low, 'run': (ux, uy), 'w': (wx, wy), 'up': _unit3((ux * runlen, uy * runlen, rise)), 'anchor': (ax, ay, az)})
        if land > 0.5:
            ring = [B0[0], (bx - wx * half, by - wy * half), (bx + wx * half, by + wy * half), B0[1]]
            out.append({'poly': _ccw(ring), 'z0': az if s['base'] == 'solid' else bz - s['thick'], 'z1': bz,
                        'run': (ux, uy), 'w': (wx, wy), 'nose': ((B0[0][0] + B0[1][0]) / 2, (B0[0][1] + B0[1][1]) / 2), 'top': bz})
        return out
    t = runlen / n
    for i in range(n):
        s0, s1 = i * t, (chord if i == n - 1 else (i + 1) * t)
        top = az + (i + 1) * h
        ring = [(ax + ux * s0 - wx * half, ay + uy * s0 - wy * half), (ax + ux * s1 - wx * half, ay + uy * s1 - wy * half),
                (ax + ux * s1 + wx * half, ay + uy * s1 + wy * half), (ax + ux * s0 + wx * half, ay + uy * s0 + wy * half)]
        out.append({'poly': _ccw(ring), 'z0': az if s['base'] == 'solid' else top - s['thick'], 'z1': top,
                    'run': (ux, uy), 'w': (wx, wy), 'nose': (ax + ux * s0, ay + uy * s0), 'top': top})
    return out


def _spiral(s, c, b, riser):
    cx, cy, cz = c
    rout = math.hypot(b[0] - cx, b[1] - cy)
    if rout < 24:
        return []
    rise = b[2] - cz
    if abs(rise) < riser / 2:
        return []
    up = 1 if rise > 0 else -1
    rise = abs(rise)
    rin = min(s['inner'], rout - 16)
    per = max(4, int(round(s['per360'])))
    n = max(1, int(round(rise / riser)))
    h = rise / n
    d = 2 * math.pi / per * (1 if s['turn'] != 'right' else -1)
    end = math.atan2(b[1] - cy, b[0] - cx)
    side = 1 if d > 0 else -1
    base = cz if up > 0 else cz - rise
    mid = (rin + rout) / 2
    out = []
    for i in range(n):
        a1 = end - d * (n - 1 - i)
        a0 = a1 - d
        top = base + (i + 1) * h
        ring = [(cx + math.cos(a) * r, cy + math.sin(a) * r) for a, r in ((a0, rin), (a0, rout), (a1, rout), (a1, rin))]
        am = (a0 + a1) / 2
        run = (-math.sin(am) * side, math.cos(am) * side)
        out.append({'poly': _ccw(ring), 'z0': top - max(2.0, s['thick']), 'z1': top, 'run': run, 'w': (-run[1], run[0]),
                    'nose': (cx + math.cos(a0) * mid, cy + math.sin(a0) * mid), 'top': top})
    if s['column'] and rin >= 4:
        ring = [(cx + math.cos(2 * math.pi * k / 12) * rin, cy + math.sin(2 * math.pi * k / 12) * rin) for k in range(12)]
        out.append({'poly': ring, 'z0': base, 'z1': base + rise, 'column': True})
    return out


def _unit3(v):
    L = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / L for c in v)


def roof_parts(p):
    s = settings_of(p)
    ends = _ends(p)
    if not ends:
        return []
    (ax, ay, az), (bx, by, bz) = ends
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy)
    if L < 1:
        return []
    ux, uy = dx / L, dy / L
    wx, wy = -uy, ux
    rise = bz - az
    if abs(rise) < 8:                                 # drawn on one level: its pitch
        rise = L * math.tan(math.radians(max(1.0, min(80.0, s['pitch']))))
    half = max(8.0, s['width']) / 2
    out = []
    for sgn in ((1,) if s['shape'] != 'gable' else (1, -1)):
        # this slope from its eave up to the ridge (the gable's second one beyond it, as far down)
        e = (ax, ay) if sgn > 0 else (ax + ux * 2 * L, ay + uy * 2 * L)
        r = (ax + ux * L, ay + uy * L)
        top = [(e[0] - wx * half, e[1] - wy * half, az), (e[0] + wx * half, e[1] + wy * half, az),
               (r[0] + wx * half, r[1] + wy * half, az + rise), (r[0] - wx * half, r[1] - wy * half, az + rise)]
        low = [(x, y, z - s['thick']) for x, y, z in top]
        run = (ux * sgn, uy * sgn)
        out.append({'pts': [(x, y, z + s['thick']) for x, y, z in top] + top, 'run': run, 'w': (wx * sgn, wy * sgn),
                    'up': _unit3((run[0] * L, run[1] * L, rise)), 'anchor': (r[0], r[1], az + rise + s['thick'])})
    return out


# ------------------------------------------------------------------ brushes

def _mat(s, setting):
    """The material of one of the path's texture settings ('tex', 'edgeTex'...), which remembers it: the editor's
    preview (look) tells which setting a texture dropped on a face changes."""
    m = geom.Mat(s[setting])
    m.setting = setting
    return m


def _axes(m, kind):
    tu, tv, su, sv = geom._scales(m, kind)
    return tu / su, tv / sv


def _textured(brush, part, s, kind):
    """The faces of a step (tread up, riser at its front) or of a slope (its top) with their textures along it."""
    run, w = part.get('run'), part.get('w')
    if not run:
        return brush
    for f in brush.faces:
        n = f.normal
        if kind == 'stairs' and 'poly' in part and n[2] > 0.99:                  # the tread
            m = _mat(s, 'tex')
            ku, kv = _axes(m, 'floor')
            f.mat = m
            f.u = (w[0] * ku, w[1] * ku, 0.0)
            f.v = (run[0] * kv, run[1] * kv, 0.0)
            f.origin = (part['nose'][0] - w[0] * s['width'] / 2, part['nose'][1] - w[1] * s['width'] / 2, part['top'])
        elif kind == 'stairs' and 'poly' in part and n[0] * run[0] + n[1] * run[1] < -0.7 and abs(n[2]) < 0.01:   # the riser
            m = _mat(s, 'riserTex')
            ku, kv = _axes(m, 'wall')
            right = (run[1], -run[0])                   # to the right of someone facing the stairs
            f.mat = m
            f.u = (right[0] * ku, right[1] * ku, 0.0)
            f.v = (0.0, 0.0, -kv)
            f.origin = (part['nose'][0] - right[0] * s['width'] / 2, part['nose'][1] - right[1] * s['width'] / 2, part['top'])
        elif 'up' in part and n[2] > 0.2:                                      # a ramp's or a roof's top
            m = _mat(s, 'tex')
            ku, kv = _axes(m, 'floor')
            up = part['up']
            f.mat = m
            f.u = (w[0] * ku, w[1] * ku, 0.0)
            vv = up if kind == 'stairs' else (-up[0], -up[1], -up[2])         # roof tiles: down from the ridge
            f.v = (vv[0] * kv, vv[1] * kv, vv[2] * kv)
            f.origin = part['anchor']
    return brush


def _parts_brushes(p, s, kind, parts, name):
    side = _mat(s, 'sideTex')
    under = _mat(s, 'underTex' if s.get('underTex') else 'sideTex')
    out = []
    for i, part in enumerate(parts):
        mats = {'top': _mat(s, 'tex'), 'bottom': under, 'all': side}
        if 'poly' in part:
            b = _prism(part['poly'], part['z0'], part['z1'], side if part.get('column') else mats, '%s_%d' % (name, i))
        else:
            b = geom.hull(part['pts'], mats, '%s_%d' % (name, i))
        out.append(_textured(b, part, s, kind))
    return out


def _prism(poly, z0, z1, mats, name):
    return geom.hull([(x, y, z) for x, y in poly for z in (z0, z1)], mats, name)


def brushes(p):
    """The brushes of one drawn path: [geom.Brush]."""
    kind = p.get('kind')
    if kind not in KINDS:
        return []
    s = settings_of(p)
    if kind == 'stairs':
        return _parts_brushes(p, s, kind, stair_parts(p), p.get('name', 'Stairs'))
    if kind == 'roof':
        return _parts_brushes(p, s, kind, roof_parts(p), p.get('name', 'Roof'))
    z = float(p.get('z', 0))
    closed = bool(p.get('closed')) or kind in ('floor', 'ceiling')
    pts = _clean(p.get('pts') or [], closed)
    name = p.get('name', 'Drawn')
    out = []
    if kind in ('wall', 'road'):
        if len(pts) < 2:
            return []
        if kind == 'wall':
            if s['thick'] <= 0 or s['height'] <= 0:
                return []
            mats = _mat(s, 'tex')
            for i, q in enumerate(strips(pts, closed, -s['thick'] / 2, s['thick'] / 2)):
                out.append(_prism(q, z, z + s['height'], mats, '%s_%d' % (name, i)))
            return out
        half = s['width'] / 2
        if half > 0:
            road = {'top': _mat(s, 'tex'), 'bottom': _mat(s, 'tex'), 'all': _mat(s, 'curbTex')}
            for i, q in enumerate(strips(pts, closed, -half, half)):
                out.append(_prism(q, z - 2, z + ROAD_LIFT, road, '%s_road%d' % (name, i)))
        if s['walk'] > 0 and s['curb'] > 0:
            walk = {'top': _mat(s, 'walkTex'), 'bottom': _mat(s, 'walkTex'), 'all': _mat(s, 'curbTex')}
            for side, (d0, d1) in (('L', (half, half + s['walk'])), ('R', (-half - s['walk'], -half))):
                for i, q in enumerate(strips(pts, closed, d0, d1)):
                    out.append(_prism(q, z - 2, z + s['curb'], walk, '%s_walk%s%d' % (name, side, i)))
        return out
    if len(pts) < 3:
        return []
    if _area(pts) < 0:
        pts = pts[::-1]
    parts = convex_parts(pts)
    if kind == 'floor':
        if s['thick'] <= 0:
            return []
        mats = {'top': _mat(s, 'tex'), 'bottom': _mat(s, 'edgeTex'), 'all': _mat(s, 'edgeTex')}
        top = z + s['lift']
        return [_prism(q, top - s['thick'], top, mats, '%s_%d' % (name, i)) for i, q in enumerate(parts)]
    # ceiling: its underside at `height`
    base = z + s['height']
    if s['thick'] <= 0:
        return []
    mats = {'top': _mat(s, 'tex'), 'bottom': _mat(s, 'underTex'), 'all': _mat(s, 'edgeTex')}
    return [_prism(q, base, base + s['thick'], mats, '%s_%d' % (name, i)) for i, q in enumerate(parts)]


_PACKAGE_OF = None


def package_of(tex):
    """The texture package a texture name is in (the catalog: catalog/<package>.txt), or None."""
    global _PACKAGE_OF
    if _PACKAGE_OF is None:
        _PACKAGE_OF = {}
        for path in sorted(geom.CATALOG.glob('*.txt')):
            for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
                parts = line.split()
                if len(parts) >= 2:
                    _PACKAGE_OF.setdefault(parts[1].split('.')[-1].lower(), path.stem)
    return _PACKAGE_OF.get(str(tex).split('.')[-1].lower())


def packages(edits):
    """The texture packages the drawn paths and the blocks use (a build loads them; it only loads its usual
    ones): a texture picked from any package in the editor's texture picker works after Rebuild."""
    out = []
    for b in edits.get('boxes') or []:
        pkg = package_of(b.get('tex')) if isinstance(b.get('tex'), str) and b.get('tex') else None
        if pkg and pkg not in out:
            out.append(pkg)
    for p in edits.get('drawn') or []:
        if p.get('kind') not in KINDS:
            continue
        s = settings_of(p)
        for k, v in s.items():
            if isinstance(v, str) and k.lower().endswith('tex'):
                pkg = package_of(v)
                if pkg and pkg not in out:
                    out.append(pkg)
    return out


def holes(edits):
    """The convex brushes of the map's hole blocks, turned as the build turns them. UnrealEd adds a semisolid brush
    after every subtraction, so its holes never cut one: the drawn pieces are cut by them here, before they are added
    (geom.subtract), the faces of the cut in the hole's texture as the hole's own walls. Water and zone portals carve
    their own way (zones.brush_ops)."""
    out = []
    for b in edits.get('boxes') or []:
        if not b.get('hole') or b.get('mover') or zones.is_zone_box(b) or not all(b['hi'][k] > b['lo'][k] for k in range(3)):
            continue
        centre = [(b['lo'][k] + b['hi'][k]) / 2 for k in range(3)]
        out += [geom.rotate_brush(br, centre, b.get('rot')) for br in blocks.brushes(b, zones.hole_mats(b), b.get('name', 'Hole'))]
    return out


def all_brushes(edits):
    """Every drawn path of the map, cut by its holes: [(path name, geom.Brush)]; a path that cannot be built is
    reported."""
    out, report = [], []
    cutters = holes(edits)
    own = {str(k).lower() for k in (edits.get('textures') or {})}
    for p in edits.get('drawn') or []:
        if p.get('kind') in KINDS:          # a texture name the game has not (a typo): said, not silently blank
            for k, v in settings_of(p).items():
                if isinstance(v, str) and k.lower().endswith('tex') and v.lower() not in own and not package_of(v):
                    report.append('  DRAWN %s: no texture called %s (the surface stays blank)' % (p.get('name'), v))
        try:
            for b in brushes(p):
                pts = p.get('pts') or []
                pivot = [sum(q[i] for q in pts) / max(1, len(pts)) for i in range(2)] + [float(p.get('z') or 0)]
                pieces = [geom.rotate_brush(b, pivot, p.get('rot'))]
                for cutter in cutters:
                    pieces = [piece for whole in pieces for piece in geom.subtract(whole, cutter)]
                out += [(p.get('name', ''), piece) for piece in pieces]
        except ValueError as e:
            report.append('  DRAWN %s not built: %s' % (p.get('name'), e))
    return out, report


def look(p, holes=()):
    """One drawn path as the build will make it and map its textures (the editor shows it so until a Rebuild, as it
    shows a block): [{'setting', 'tex', 'pos', 'uv'}], one entry a material. pos: triangles in world units; uv: in
    repeats of the texture, as geometry.json gives the map's own surfaces; setting: the path's texture setting those
    faces show ('' for the walls of a hole cut in it, which are in the hole's texture). holes: the map's hole blocks."""
    built, _report = all_brushes({'drawn': [p], 'boxes': list(holes)})
    groups = {}
    for _name, brush in built:
        if brush.wrap:                       # round sides: their texture runs on round them, as Brush.t3d writes it
            geom.wrap_vertical(brush.faces)
        for f in brush.faces:
            u, v, origin = (f.u, f.v, f.origin) if f.u is not None else geom.mapping(f, False)
            tu, tv = geom.tex_size(f.mat.tex)
            setting = getattr(f.mat, 'setting', '')
            g = groups.setdefault((setting, f.mat.tex), dict(setting=setting, tex=f.mat.tex, pos=[], uv=[]))
            for k in range(1, len(f.verts) - 1):         # a triangle fan, as the map's polygons
                for q in (f.verts[0], f.verts[k], f.verts[k + 1]):
                    d = Vec3.of(q) - origin
                    g['pos'] += [round(c, 2) for c in q]
                    g['uv'] += [round(d.dot(u) / tu, 4), round(d.dot(v) / tv, 4)]
    return list(groups.values())
