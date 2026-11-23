"""Climbable areas ("+ Ladder", a block with 'climb'): the walls inside the box can be climbed like the game's ladders.

Deus Ex has no ladder object. The engine (Engine.dll, the player's walking physics) looks at the walls round JC's feet
and, when the texture of one is in a group called "Ladder" (CoreTexMetal.Ladder.ladder_a; MolePeople and
area51textures have such a group too), JC goes up and down it as on a ladder; DeusEx.u only plays the metal steps for
that group. So a ladder of the game climbs only when it is a brush with such a texture: a ladder model, or a ladder
texture of another group, is only to look at.

A climbable area keeps the walls as they look. At Rebuild every piece of wall inside its box (the map as last built:
the editor's cache, polys.json) gets a skin: a thin brush, invisible and semisolid, from 1 unit inside the wall to
SKIN units in front of it, with the ladder texture. Only inside the box: the skin is the wall cut by the box's sides.
JC stops climbing where the box ends, as at the top of the game's ladders."""
import json
import math
from pathlib import Path

import geom

LADDER_TEX = 'ladder_a'               # CoreTexMetal.Ladder.ladder_a, in Deus Ex and in Revision (it reads ..\..\Textures)
LADDER_PACKAGE = 'CoreTexMetal'
PF_INVISIBLE = 1
PF_NOTSOLID = 8
PF_FAKEBACKDROP = 128
PF_SEMISOLID = 0x20
PF_PORTAL = 0x04000000
SKIP = PF_INVISIBLE | PF_NOTSOLID | PF_FAKEBACKDROP | PF_PORTAL   # not walls to climb (and our own skins: invisible)
SKIN = 2.0                             # how far in front of the wall the skin's face is
BACK = 1.0                             # how far into the wall it goes
WALL = 0.7                             # a face with |normal z| up to this is a wall (a ladder may lean a little)
MIN_AREA = 16.0                        # a piece smaller than this (square units) is not kept
CACHE = Path(__file__).resolve().parent / 'cache'


def is_climb(b):
    return bool(b.get('climb'))


def world_polys(map_name, cache=None):
    """The map's surfaces as last built: [(verts [(x, y, z)], flags)], [] without a cache yet."""
    import packed
    folder = Path(cache or CACHE) / map_name
    try:
        polys = json.loads(packed.read_text(folder / 'polys.json', encoding='utf-8'))
    except (OSError, ValueError):
        return []
    return [([tuple(v[i:i + 3]) for i in range(0, len(v), 3)], int(flags)) for _tex, flags, _nums, v, _b in polys]


def _normal(pts):
    """The normal of a polygon of the cache: (v1-v0)x(v2-v0) points to the side it is seen from (the open space)."""
    best = (0.0, 0.0, 0.0)
    a = pts[0]
    for i in range(1, len(pts) - 1):       # the largest corner: a thin first triangle gives a poor normal
        u = [pts[i][k] - a[k] for k in range(3)]
        w = [pts[i + 1][k] - a[k] for k in range(3)]
        n = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
        if sum(c * c for c in n) > sum(c * c for c in best):
            best = n
    length = math.sqrt(sum(c * c for c in best))
    return None if length < 1e-6 else tuple(c / length for c in best)


def _clip(pts, n, d):
    """A convex polygon cut by the plane n.p = d: the part behind it (n.p <= d)."""
    out = []
    count = len(pts)
    for i in range(count):
        a, c = pts[i], pts[(i + 1) % count]
        da = d - sum(n[k] * a[k] for k in range(3))
        dc = d - sum(n[k] * c[k] for k in range(3))
        if da >= 0:
            out.append(a)
        if (da >= 0) != (dc >= 0) and abs(da - dc) > 1e-9:
            t = da / (da - dc)
            out.append(tuple(a[k] + (c[k] - a[k]) * t for k in range(3)))
    clean = []
    for p in out:                          # no corner twice
        if not clean or max(abs(p[k] - clean[-1][k]) for k in range(3)) > 0.01:
            clean.append(p)
    if len(clean) > 1 and max(abs(clean[0][k] - clean[-1][k]) for k in range(3)) <= 0.01:
        clean.pop()
    return clean


def box_planes(b):
    """The sides of the box b as planes [(outward normal, d)], turned as the block is (its 'rot')."""
    lo, hi = [float(v) for v in b['lo']], [float(v) for v in b['hi']]
    br = geom.rotate_brush(geom.box(tuple(lo), tuple(hi), 'Marker'), [(lo[k] + hi[k]) / 2 for k in range(3)], b.get('rot'))
    return [(tuple(f.normal), sum(f.normal[k] * f.verts[0][k] for k in range(3))) for f in br.faces]


def _area(pts, n):
    s = [0.0, 0.0, 0.0]
    for i in range(len(pts)):
        a, c = pts[i], pts[(i + 1) % len(pts)]
        s[0] += a[1] * c[2] - a[2] * c[1]
        s[1] += a[2] * c[0] - a[0] * c[2]
        s[2] += a[0] * c[1] - a[1] * c[0]
    return abs(sum(s[k] * n[k] for k in range(3))) / 2


def pieces(b, polys):
    """The walls inside the box b: [(polygon, normal)], each wall polygon cut by the box's sides."""
    planes = box_planes(b)
    corners = [p for f in geom.rotate_brush(geom.box(tuple(b['lo']), tuple(b['hi']), 'Marker'),
                                             [(b['lo'][k] + b['hi'][k]) / 2 for k in range(3)], b.get('rot')).faces
               for p in f.verts]
    lo = [min(p[k] for p in corners) for k in range(3)]
    hi = [max(p[k] for p in corners) for k in range(3)]
    out = []
    for pts, flags in polys:
        if flags & SKIP or len(pts) < 3:
            continue
        if any(max(p[k] for p in pts) < lo[k] or min(p[k] for p in pts) > hi[k] for k in range(3)):
            continue
        n = _normal(pts)
        if n is None or abs(n[2]) > WALL:
            continue
        cut = list(pts)
        for pn, pd in planes:
            cut = _clip(cut, pn, pd)
            if len(cut) < 3:
                break
        if len(cut) >= 3 and _area(cut, n) >= MIN_AREA:
            out.append((cut, n))
    return out


def _merged(group):
    """Pieces on one plane: one polygon when together they are convex (the wall of a room cut by the BSP), else as they
    are (a doorway between them stays open)."""
    if len(group) < 2:
        return group
    n = group[0][1]
    pts = [p for poly, _n in group for p in poly]
    # the plane's own axes, and the convex hull of the corners on it
    ref = (1.0, 0.0, 0.0) if abs(n[0]) < 0.9 else (0.0, 1.0, 0.0)
    ax = geom.Vec3.of(n).cross(geom.Vec3.of(ref)).normalized()
    ay = geom.Vec3.of(n).cross(ax).normalized()
    flat = sorted({(round(ax.dot(p), 3), round(ay.dot(p), 3)): p for p in pts}.items())

    def turn(o, a, c):
        return (a[0][0] - o[0][0]) * (c[0][1] - o[0][1]) - (a[0][1] - o[0][1]) * (c[0][0] - o[0][0])
    lower, upper = [], []
    for q in flat:
        while len(lower) >= 2 and turn(lower[-2], lower[-1], q) <= 1e-6:
            lower.pop()
        lower.append(q)
    for q in reversed(flat):
        while len(upper) >= 2 and turn(upper[-2], upper[-1], q) <= 1e-6:
            upper.pop()
        upper.append(q)
    hull = [p for _k, p in lower[:-1] + upper[:-1]]
    if len(hull) < 3:
        return group
    whole = _area(hull, n)
    if abs(whole - sum(_area(poly, n) for poly, _n in group)) > max(1.0, whole * 0.005):
        return group
    return [(hull, n)]


def walls(b, polys):
    """The pieces of wall of the climbable area b, those on one plane merged when they can be: [(polygon, normal)]."""
    planes = {}
    for poly, n in pieces(b, polys):
        d = sum(n[k] * poly[0][k] for k in range(3))
        planes.setdefault(tuple(round(c, 3) for c in n) + (round(d * 2) / 2,), []).append((poly, n))
    return [w for key in sorted(planes) for w in _merged(planes[key])]


def _slab(poly, n, front, back):
    return [tuple(p[k] + n[k] * front for k in range(3)) for p in poly] + \
           [tuple(p[k] + n[k] * back for k in range(3)) for p in poly]


def brushes(b, polys):
    """The skins of the climbable area b on the walls polys (world_polys): [Brush], semisolid and invisible."""
    mat = geom.Mat(LADDER_TEX, flags=PF_INVISIBLE)
    return [geom.hull(_slab(poly, n, SKIN, -BACK), mat, name='%s_%d' % (b.get('name', 'Climb'), j))
            for j, (poly, n) in enumerate(walls(b, polys))]


# An area the rules turn on and off (UCClimbArea, the template's): its slabs (UCClimbBlock movers) cover the skins
# while it is off. The engine's ladder trace (round the player's feet, Level and movers) stops on the first thing it
# meets: out, a slab's face is OUT_FRONT in front of the wall (past the skin's, SKIN); in, it goes IN_DEPTH units back
# along the wall's normal, its face then behind the skin's, inside the wall.
AREA_CLASS = 'UCClimbArea'
SLAB_CLASS = 'UCClimbBlock'
OUT_FRONT, OUT_BACK = SKIN + 0.5, SKIN - 1.5
IN_DEPTH = 4.0
SLAB_TEX = 'ClenGreyCncrt_A'          # the blocks' own texture (the build loads its package)


def _says(value, low):
    """Whether a rule (a dict of the edits' links, with its steps) names the object low anywhere."""
    if isinstance(value, str):
        return value.lower() == low
    if isinstance(value, dict):
        return any(_says(v, low) for v in value.values())
    if isinstance(value, list):
        return any(_says(v, low) for v in value)
    return False


def switched(b, edits):
    """Whether the climbable area b is built to be turned on and off: it starts off, or a rule names it."""
    if not is_climb(b):
        return False
    if b.get('climbOff'):
        return True
    low = str(b.get('name') or '').lower()
    return bool(low) and _says(edits.get('links') or [], low)


def switch_parts(b, polys):
    """What an area turned on and off adds to the map: (its UCClimbArea (loc, props), its slabs [(name, loc, Brush
    relative to loc, props)]), the slabs where the area is on (key 0) with their way out (KeyPos(1))."""
    name = b.get('name') or 'Climb'
    off = bool(b.get('climbOff'))
    lo, hi = [float(v) for v in b['lo']], [float(v) for v in b['hi']]
    centre = tuple((lo[k] + hi[k]) / 2 for k in range(3))
    area = (centre, {'bOff': 'True'} if off else {})
    mat = geom.Mat(SLAB_TEX, flags=PF_INVISIBLE)       # never the ladder's: a slab must not be one
    slabs = []
    for j, (poly, n) in enumerate(walls(b, polys)):
        pts = [tuple(p[k] - n[k] * IN_DEPTH for k in range(3)) for p in _slab(poly, n, OUT_FRONT, OUT_BACK)]
        c = tuple(sum(p[k] for p in pts) / len(pts) for k in range(3))
        rel = geom.hull([tuple(p[k] - c[k] for k in range(3)) for p in pts], mat, name='%s_Off%d' % (name, j))
        # never KeyNum 1 for an area that starts off: the editor would take the slab's place as key 1's (no way
        # out); its UCClimbArea brings them out when the map starts
        props = {'Tag': name, 'KeyPos(1)': tuple(round(n[k] * IN_DEPTH, 3) for k in range(3))}
        slabs.append(('%s_Off%d' % (name, j), c, rel, props))
    return area, slabs


def switch_line(b, n):
    """What the build says about an area turned on and off with n slabs."""
    return '  EDIT climbable area %s can be turned on and off by the rules (%d slab%s, starts %s)' % (
        b.get('name'), n, '' if n == 1 else 's', 'off' if b.get('climbOff') else 'on')


def slab_t3d(name, loc, rel, props):
    """The T3D of a slab (the builds of existing maps: dxmaps), as motions.mover_block_t3d writes a moving block."""
    from scene import Scene
    model = 'UCMdl' + name
    body = geom.Brush(rel.faces, model).t3d() + "    Brush=Model'MyLevel.%s'" % model
    return Scene._block(SLAB_CLASS, tuple(loc), name, None, body, dict(props, BasePos=tuple(float(v) for v in loc)))


def packages(edits):
    """The ladder texture's package, when the map has a climbable area."""
    return ['OBJ LOAD FILE="%s.utx"' % LADDER_PACKAGE] if any(is_climb(b) for b in edits.get('boxes') or []) else []


def report_line(b, n, polys):
    """What the build says about a climbable area with n skins."""
    if not polys:
        return '  CLIMB %s: the walls of the map are not known yet (the editor shows them after this build): Rebuild ' \
               'once more to make them climbable' % b.get('name')
    if not n:
        return '  CLIMB %s has no wall inside it: put its box across the wall to climb' % b.get('name')
    return '  EDIT climbable area %s (%d piece%s of wall)' % (b.get('name'), n, '' if n == 1 else 's')
