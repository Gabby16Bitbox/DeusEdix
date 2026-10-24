"""Brush geometry for UE1 T3D: convex brushes with world-aligned, correctly scaled textures.

Conventions (checked against working T3D from this project):
- polygon vertices are ordered so that (v1-v0) x (v2-v0) is the outward normal of the brush;
- the texture Origin always lies on the face plane (the old SDK builds wrong planes otherwise);
- UV: u = (P - Origin) . TextureU, in texels. A texture whose base tile is 128 units with
  |TextureU| = 1 repeats every 128 world units.
- `inside=True` (subtracted rooms): faces are seen from inside, so U is mirrored to keep
  textures (and text) readable.
"""
import math
import re
from pathlib import Path

from vec3 import Vec3

CATALOG = Path(__file__).resolve().parent / 'catalog'
_SIZES = None


def tex_size(name):
    """Base tile size in world units (USize * DrawScale) of a texture, from the catalog."""
    global _SIZES
    if _SIZES is None:
        _SIZES = {}
        for path in CATALOG.glob('*.txt'):
            for line in path.read_text(encoding='utf-8').splitlines():
                m = re.match(r'\s*\d+\s+\S*?\.?([^.\s]+)\s+(\d+)x(\d+)(?:\s+scale=([0-9.]+))?', line)
                if m:
                    s = float(m.group(4)) if m.group(4) else 1.0
                    _SIZES.setdefault(m.group(1).lower(), (int(m.group(2)) * s, int(m.group(3)) * s))
    return _SIZES.get(name.lower(), (128.0, 128.0))


_GAME = None


def game_scale(name, kind=None):
    """World units per texel the original maps use for this texture (catalog/texusage.json):
    the dominant scale on that kind of surface (floor / wall / ceiling) when the game uses it
    there, else the overall one when it clearly dominates; 1.0 for textures the game never uses."""
    global _GAME
    if _GAME is None:
        import json
        try:
            _GAME = json.loads((CATALOG / 'texusage.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            _GAME = {}
    d = _GAME.get(name.lower())
    if not d or d['faces'] < 8:
        return 1.0
    by_kind = d.get('scale_by_kind', {})
    if kind in by_kind:
        return float(by_kind[kind])
    if d['scale_share'] >= 0.4:
        return float(d['scale'])
    return 1.0


def face_kind(n, inside=False):
    nz = -n[2] if inside else n[2]
    return 'floor' if nz > 0.7 else ('ceiling' if nz < -0.7 else 'wall')


def register(name, w, h):
    """Base tile size of a texture created for the map (generated textures)."""
    tex_size('x')
    _SIZES[name.lower()] = (float(w), float(h))


def fmt(v):
    def f(x):
        x = round(x, 5)
        if x == 0:
            x = 0.0
        s = ('%.5f' % x).rstrip('0').rstrip('.')
        return s if s not in ('', '-0') else '0'
    return ','.join(f(c) for c in v)


class Mat:
    """A surface material: texture + scale (world units per tile) + flags + mapping options."""

    def __init__(self, tex, tile=None, flags=0, offset=(0.0, 0.0), rot=0, planar=None, align=(0.0, 0.0, 0.0)):
        self.tex = tex
        self.tile = tile  # None: native size; number or (u, v) in world units
        self.flags = flags
        self.offset = offset  # pan in world units along U and V
        self.rot = rot  # 0/90/180/270 degrees
        self.planar = planar  # force 'x','y','z' projection
        self.align = align  # world point the texture grid is anchored to

    def with_(self, **kw):
        m = Mat(self.tex, self.tile, self.flags, self.offset, self.rot, self.planar, self.align)
        for k, v in kw.items():
            setattr(m, k, v)
        return m


def as_mat(m):
    if m is None:
        return None
    return m if isinstance(m, Mat) else Mat(m)


class Face:
    def __init__(self, verts, mat, normal=None, u=None, v=None, origin=None):
        self.verts = verts
        self.mat = as_mat(mat)
        a = Vec3.of(verts[0])
        self.normal = Vec3.of(normal) if normal else (Vec3.of(verts[1]) - a).cross(Vec3.of(verts[2]) - a).normalized()
        self.u, self.v, self.origin = u, v, origin


def mapping(face, inside):
    """World-aligned texture axes for a face (TextureU, TextureV, Origin)."""
    m = face.mat
    n = face.normal
    ax = m.planar
    if ax is None:
        a = [abs(n[0]), abs(n[1]), abs(n[2])]
        ax = 'z' if a[2] >= max(a[0], a[1]) - 1e-6 else ('x' if a[0] >= a[1] else 'y')
    up = (0.0, 0.0, 1.0)
    if ax == 'z':
        # U x V points toward the viewer (no mirrored text): +Y on floors, -Y on ceilings
        seen_up = (n[2] > 0) != bool(inside)
        u = Vec3(1.0, 0.0, 0.0)
        v = Vec3(0.0, 1.0, 0.0) if seen_up else Vec3(0.0, -1.0, 0.0)
    else:
        # walls: U to the right of a viewer facing the surface, V downwards
        horiz = Vec3(n[0], n[1], 0.0).normalized() if ax is None or abs(n[2]) < 0.999 else Vec3(1.0, 0.0, 0.0)
        if horiz == (0.0, 0.0, 0.0):
            horiz = Vec3(1.0, 0.0, 0.0) if ax == 'x' else Vec3(0.0, 1.0, 0.0)
        u = horiz.cross(up).normalized()
        if inside:
            u = -u
        v = Vec3(0.0, 0.0, -1.0)
        # slanted faces (roofs of ramps): project V on the face
        if abs(n[2]) > 1e-6 and abs(n[2]) < 0.999:
            v = n.cross(u).normalized() if not inside else u.cross(n).normalized()
            if v[2] > 0:
                v = -v
    for _ in range(m.rot // 90 % 4):
        u, v = v, -u
    tu, tv = tex_size(m.tex)
    if m.tile is None:
        g = game_scale(m.tex, face_kind(n, inside))
        su, sv = tu * g, tv * g
    elif isinstance(m.tile, (int, float)):
        su = sv = float(m.tile)
        if tv != tu:
            sv = float(m.tile) * tv / tu
    else:
        su, sv = float(m.tile[0]), float(m.tile[1])
    U = u * (tu / su)
    V = v * (tv / sv)
    # origin: the world anchor projected on the plane, shifted by the pan offset
    p0 = face.verts[0]
    anchor = Vec3.of(m.align) + (u * -m.offset[0] + v * -m.offset[1])
    origin = anchor - n * (anchor - p0).dot(n)
    return U, V, origin


def _scales(m, kind=None):
    tu, tv = tex_size(m.tex)
    if m.tile is None:
        g = game_scale(m.tex, kind)
        return tu, tv, tu * g, tv * g
    if isinstance(m.tile, (int, float)):
        return tu, tv, float(m.tile), float(m.tile) * tv / tu
    return tu, tv, float(m.tile[0]), float(m.tile[1])


def wrap_vertical(faces, inside=False):
    """Side faces of a vertical prism or box: U runs continuously around the outline (no seam
    at every edge), V downwards from the material's align height. Sets f.u, f.v, f.origin."""
    sides = [f for f in faces if abs(f.normal[2]) < 1e-3 and f.u is None]
    if not sides:
        return
    info = []
    for f in sides:
        n = f.normal
        u = Vec3(n[0], n[1], 0.0).normalized().cross((0.0, 0.0, 1.0)).normalized()
        if inside:
            u = -u
        lo = min(f.verts, key=u.dot)
        hi = max(f.verts, key=u.dot)
        info.append((f, u, (lo[0], lo[1]), u.dot(hi) - u.dot(lo)))
    # chain the faces: each one starts where the previous one ends
    start = {(round(s[0], 1), round(s[1], 1)): i for i, (_, _, s, _) in enumerate(info)}
    order, i, seen = [], 0, set()
    while i is not None and i not in seen:
        seen.add(i)
        order.append(i)
        f, u, s, w = info[i]
        end = (s[0] + u[0] * w, s[1] + u[1] * w)
        i = start.get((round(end[0], 1), round(end[1], 1)))
    order += [k for k in range(len(info)) if k not in seen]
    cum = 0.0
    for k in order:
        f, u, s, w = info[k]
        m = f.mat
        tu, tv, su, sv = _scales(m, "wall")
        f.u = u * (tu / su)
        f.v = Vec3(0.0, 0.0, -tv / sv)
        f.origin = Vec3(s[0] - u[0] * (cum - m.offset[0]), s[1] - u[1] * (cum - m.offset[0]), m.align[2] - m.offset[1])
        cum += w


def rotation_matrix(rot):
    """UE1 local axes in world space (Pitch, Yaw, Roll; 65536 units/turn)."""
    p, y, r = (float(v) * 2 * math.pi / 65536 for v in rot)
    cp, sp, cy, sy, cr, sr = math.cos(p), math.sin(p), math.cos(y), math.sin(y), math.cos(r), math.sin(r)
    return ((cp*cy, sr*sp*cy-cr*sy, -cr*sp*cy-sr*sy),
            (cp*sy, sr*sp*sy+cr*cy, -cr*sp*sy+sr*cy), (sp, -sr*cp, cr*cp))


def compose_rotation(left, right):
    a, b = rotation_matrix(left), rotation_matrix(right)
    m = [[sum(a[i][k]*b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    return matrix_rotation(m)


def matrix_rotation(m):
    p = math.asin(max(-1, min(1, m[2][0])))
    if abs(math.cos(p)) > 1e-7:
        y, r = math.atan2(m[1][0], m[0][0]), math.atan2(-m[2][1], m[2][2])
    else:
        y, r = math.atan2(-m[0][1], m[1][1]), 0
    return tuple(round(v * 65536 / (2*math.pi)) % 65536 for v in (p, y, r))


def rotation_between(old, new):
    a, b = rotation_matrix(new), rotation_matrix(old)
    return matrix_rotation([[sum(a[i][k]*b[j][k] for k in range(3)) for j in range(3)] for i in range(3)])


class XForm:
    """Placement of a group of brushes and actors (a structure moved in the map editor): stretch by
    scale along the structure's own axes, turn by yaw (Unreal units, 65536 = a full turn, same sense as
    an actor's Yaw) around pivot, then move by offset. Textures keep their size on stretched faces (they
    repeat more) unless stretch is True (they grow with the faces, like a picture)."""

    def __init__(self, pivot, offset=(0.0, 0.0, 0.0), yaw=0, scale=(1.0, 1.0, 1.0), stretch=False, pitch=0, roll=0):
        self.pivot = tuple(float(c) for c in pivot)
        self.offset = tuple(float(c) for c in offset)
        self.yaw = int(yaw) % 65536
        self.pitch, self.roll = int(pitch) % 65536, int(roll) % 65536
        self.rotation = (self.pitch, self.yaw, self.roll)
        self.matrix = rotation_matrix(self.rotation)
        self.scale = tuple(float(c) for c in (scale or (1.0, 1.0, 1.0)))
        self.stretch = bool(stretch)
        a = self.yaw * 2 * math.pi / 65536
        self.c, self.s = math.cos(a), math.sin(a)
        if self.yaw % 16384 == 0:          # quarter turns stay exact
            self.c, self.s = float(round(self.c)), float(round(self.s))

    @property
    def rotated(self):
        return any(self.rotation)

    def rot(self, value):
        return compose_rotation(self.rotation, value)

    @property
    def scaled(self):
        return any(abs(k - 1.0) > 1e-6 for k in self.scale)

    def vec(self, v):
        """A direction: turned only (where a sign faces, a snap direction)."""
        if not self.pitch and not self.roll:
            return (v[0] * self.c - v[1] * self.s, v[0] * self.s + v[1] * self.c, v[2])
        return tuple(sum(self.matrix[i][k] * v[k] for k in range(3)) for i in range(3))

    def normal(self, n):
        """A face normal: it bends the other way of the stretch."""
        if not self.scaled:
            return self.vec(n)
        return Vec3.of(self.vec(tuple(n[k] / self.scale[k] for k in range(3)))).normalized()

    def tex(self, v):
        """A texture axis (TextureU/V): turned; also stretched when the textures grow with the faces."""
        if self.stretch and self.scaled:
            return self.vec(tuple(v[k] / self.scale[k] for k in range(3)))
        return self.vec(v)

    def point(self, p):
        q = self.vec(tuple((p[k] - self.pivot[k]) * self.scale[k] for k in range(3)))
        return (q[0] + self.pivot[0] + self.offset[0], q[1] + self.pivot[1] + self.offset[1],
                q[2] + self.pivot[2] + self.offset[2])


class Brush:
    def __init__(self, faces, name='B', wrap=False):
        self.faces = faces
        self.name = name
        self.wrap = wrap

    def t3d(self, inside=False, xf=None):
        """xf (XForm): the brush placed elsewhere; the texture mapping moves and turns with it."""
        lines = ['Begin Brush Name=%s' % self.name, 'Begin PolyList']
        if self.wrap:
            wrap_vertical(self.faces, inside)
        for f in self.faces:
            if f.u is not None:
                U, V, O = f.u, f.v, f.origin
            else:
                U, V, O = mapping(f, inside)
            verts, N = f.verts, f.normal
            if xf is not None:
                verts, N = [xf.point(p) for p in verts], xf.normal(N)
                U, V, O = xf.tex(U), xf.tex(V), xf.point(O)
            lines += ['Begin Polygon Texture=%s Flags=%d' % (f.mat.tex, f.mat.flags),
                      'Origin   ' + fmt(O), 'Normal   ' + fmt(N),
                      'TextureU ' + fmt(U), 'TextureV ' + fmt(V)]
            lines += ['Vertex   ' + fmt(p) for p in verts]
            lines.append('End Polygon')
        lines += ['End PolyList', 'End Brush']
        return '\n'.join(lines) + '\n'

    def bounds(self):
        pts = [p for f in self.faces for p in f.verts]
        return (tuple(min(p[i] for p in pts) for i in range(3)), tuple(max(p[i] for p in pts) for i in range(3)))

    def transformed(self, xf, inside=False):
        """Bake a rigid/scale placement into geometry, preserving texture coordinates."""
        if self.wrap:
            wrap_vertical(self.faces, inside)
        faces = []
        for f in self.faces:
            u, v, origin = (f.u, f.v, f.origin) if f.u is not None else mapping(f, inside)
            faces.append(Face([xf.point(p) for p in f.verts], f.mat, xf.normal(f.normal),
                              xf.tex(u), xf.tex(v), xf.point(origin)))
        return Brush(faces, self.name)


def rotate_brush(brush, pivot, rot, inside=False):
    if not rot or not any(rot):
        return brush
    return brush.transformed(XForm(pivot, yaw=rot[1], pitch=rot[0], roll=rot[2]), inside)


# ----------------------------------------------------------------------------------- shapes
FACE_KEYS = ('-x', '+x', '-y', '+y', '-z', '+z')


def _pick(mats, key):
    """mats: a material for all faces, or a dict with keys -x +x -y +y -z +z / sides / top / bottom / all."""
    if not isinstance(mats, dict):
        return as_mat(mats)
    if key in mats:
        return as_mat(mats[key])
    if key == '+z' and 'top' in mats:
        return as_mat(mats['top'])
    if key == '-z' and 'bottom' in mats:
        return as_mat(mats['bottom'])
    if key[1] in 'xy' and 'sides' in mats:
        return as_mat(mats['sides'])
    return as_mat(mats.get('all', 'Marker'))


def box(lo, hi, mats, name='Box', wrap=False):
    x, y, z = lo
    X, Y, Z = hi
    assert X > x and Y > y and Z > z, (lo, hi)
    faces = [
        ('-x', (-1, 0, 0), [(x, y, z), (x, y, Z), (x, Y, Z), (x, Y, z)]),
        ('+x', (1, 0, 0), [(X, y, z), (X, Y, z), (X, Y, Z), (X, y, Z)]),
        ('-y', (0, -1, 0), [(x, y, z), (X, y, z), (X, y, Z), (x, y, Z)]),
        ('+y', (0, 1, 0), [(x, Y, z), (x, Y, Z), (X, Y, Z), (X, Y, z)]),
        ('-z', (0, 0, -1), [(x, y, z), (x, Y, z), (X, Y, z), (X, y, z)]),
        ('+z', (0, 0, 1), [(x, y, Z), (X, y, Z), (X, Y, Z), (x, Y, Z)]),
    ]
    out = []
    for key, n, vs in faces:
        m = _pick(mats, key)
        if m is None:
            continue
        out.append(Face(vs, m, tuple(float(c) for c in n)))
    return Brush(out, name, wrap)


def hull(points, mats, name='Hull'):
    """Convex brush from a point set (brute force: every plane through 3 points with all others behind)."""
    pts = [tuple(float(c) for c in p) for p in points]
    faces = []
    seen = []
    nps = len(pts)
    for i in range(nps):
        for j in range(i + 1, nps):
            for k in range(j + 1, nps):
                n = (Vec3.of(pts[j]) - pts[i]).cross(Vec3.of(pts[k]) - pts[i])
                if n.dot(n) < 1e-6:
                    continue
                n = n.normalized()
                d = n.dot(pts[i])
                side = [n.dot(p) - d for p in pts]
                if all(s <= 1e-3 for s in side):
                    pass
                elif all(s >= -1e-3 for s in side):
                    n = -n
                    d = -d
                else:
                    continue
                key = tuple(round(c, 4) for c in n) + (round(d, 2),)
                if key in seen:
                    continue
                seen.append(key)
                on = [p for p in pts if abs(n.dot(p) - d) < 1e-3]
                on = list(dict.fromkeys(on))
                # order counter-clockwise around the normal, then make (v1-v0)x(v2-v0) == n
                c = Vec3(*(sum(p[a] for p in on) for a in range(3))) * (1.0 / len(on))
                ref = (on[0] - c).normalized()
                other = n.cross(ref)
                on.sort(key=lambda p: math.atan2((p - c).dot(other), (p - c).dot(ref)))
                if (Vec3.of(on[1]) - on[0]).cross(Vec3.of(on[2]) - on[0]).dot(n) < 0:
                    on.reverse()
                faces.append((n, on))
    out = []
    for n, vs in faces:
        key = ('+' if max(n, key=abs) > 0 else '-') + 'xyz'[[abs(c) for c in n].index(max(abs(c) for c in n))]
        m = _pick(mats, key)
        if m is None:
            continue
        out.append(Face(vs, m, n))
    return Brush(out, name)



# ----------------------------------------------------------------------------------- convex subtraction
SLIVER = 1.0        # a piece thinner than this (world units) is not kept: the engine's BSP chokes on slivers


def _ordered(points, n):
    """Points on one plane, in order round it so that (v1-v0)x(v2-v0) points along n (as hull() orders a face)."""
    c = Vec3(*(sum(p[a] for p in points) / len(points) for a in range(3)))
    ref = (Vec3.of(points[0]) - c).normalized()
    other = n.cross(ref)
    return sorted(points, key=lambda p: math.atan2((Vec3.of(p) - c).dot(other), (Vec3.of(p) - c).dot(ref)))


def split(brush, n, d, cap, eps=0.01):
    """A convex brush cut by the plane n.p = d: (the piece in front, the piece behind), each a convex Brush or None
    (all of it on one side, or a sliver). The face each piece gets on the plane is in the material cap."""
    n = Vec3.of(n)
    dist = [n.dot(p) - d for f in brush.faces for p in f.verts]
    if min(dist) > -SLIVER:
        return brush, None
    if max(dist) < SLIVER:
        return None, brush
    if brush.wrap:                       # round sides keep the mapping they had before the cut
        wrap_vertical(brush.faces)
    halves = {1: [], -1: []}
    on_plane = []
    for f in brush.faces:
        sides = {1: [], -1: []}
        for a, b in zip(f.verts, f.verts[1:] + f.verts[:1]):
            da, db = n.dot(a) - d, n.dot(b) - d
            for s in (1, -1):
                if s * da >= -eps:
                    sides[s].append(tuple(a))
            if (da > eps and db < -eps) or (da < -eps and db > eps):
                t = da / (da - db)
                x = tuple(a[k] + (b[k] - a[k]) * t for k in range(3))
                sides[1].append(x)
                sides[-1].append(x)
                on_plane.append(x)
            elif abs(da) <= eps:
                on_plane.append(tuple(a))
        for s in (1, -1):
            if len(sides[s]) >= 3:
                halves[s].append(Face(sides[s], f.mat, f.normal, f.u, f.v, f.origin))
    ring = []                            # each crossing is met by the two faces of its edge: once
    for p in on_plane:
        if all(max(abs(p[k] - q[k]) for k in range(3)) > eps for q in ring):
            ring.append(p)
    out = []
    for s in (1, -1):
        faces = halves[s]
        if len(ring) >= 3:               # its face on the plane, turned out of the piece
            faces.append(Face(_ordered(ring, n * -s), cap, n * -s))
        out.append(Brush(faces, brush.name))
    return out[0], out[1]


def subtract(brush, cutter):
    """A convex brush less a convex cutter, as UnrealEd's CSG takes a subtract brush away: the convex pieces of the
    brush outside the cutter, cut along its faces ([brush] when they do not meet, [] when it is all inside). The faces
    made on the cutter's planes take the cutter's materials, as a subtracted brush gives its textures to the walls of
    the hole it makes."""
    pieces, rest = [], brush
    for f in cutter.faces:
        front, rest = split(rest, f.normal, f.normal.dot(f.verts[0]), f.mat)
        if rest is None:                 # wholly outside one face of the cutter: untouched
            return [brush]
        if front is not None:
            pieces.append(front)
    return pieces                        # what is left is inside the cutter

def prism(center, radius, z0, z1, mats, sides=12, phase=0.0, name='Prism', ry=None):
    """Vertical n-gon prism (cylinders, tanks, columns). ry: elliptic radius on Y."""
    cx, cy = center
    ry = radius if ry is None else ry
    ring = [(cx + radius * math.cos(phase + 2 * math.pi * i / sides), cy + ry * math.sin(phase + 2 * math.pi * i / sides))
            for i in range(sides)]
    faces = []
    bottom = [(x, y, z0) for x, y in reversed(ring)]
    top = [(x, y, z1) for x, y in ring]
    faces.append(Face(bottom, _pick(mats, '-z'), (0.0, 0.0, -1.0)))
    faces.append(Face(top, _pick(mats, '+z'), (0.0, 0.0, 1.0)))
    for i in range(sides):
        a, b = ring[i], ring[(i + 1) % sides]
        vs = [(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)]
        f = Face(vs, _pick(mats, 'sides'))
        faces.append(f)
    return Brush([f for f in faces if f.mat is not None], name, wrap=True)


def hprism(axis, center, radius, a0, a1, mats, sides=12, name='HPrism'):
    """Horizontal cylinder (pipes): axis 'x' or 'y', center = the other two coordinates (c, z).
    The texture runs along the pipe (U) and continuously around it (V): no seam per facet."""
    c, cz = center
    ring = [(c + radius * math.cos(2 * math.pi * i / sides), cz + radius * math.sin(2 * math.pi * i / sides))
            for i in range(sides)]

    def P(a, p, z):
        return (float(a), p, z) if axis == 'x' else (p, float(a), z)
    hb = hull([P(a, p, z) for p, z in ring for a in (a0, a1)], mats, name)
    ax = (1.0, 0.0, 0.0) if axis == 'x' else (0.0, 1.0, 0.0)
    arc = 2 * radius * math.sin(math.pi / sides)
    for f in hb.faces:
        n = f.normal
        if abs(n.dot(ax)) > 0.5:
            continue                      # end caps keep the default mapping
        # position of this facet around the axis (angle of its normal in the ring plane)
        ang = math.atan2(n[2], n[1] if axis == 'x' else n[0]) % (2 * math.pi)
        k = int(round(ang / (2 * math.pi / sides) - 0.5)) % sides
        p0 = ring[k]
        start = P(a0, p0[0], p0[1])
        around = (Vec3.of(P(a0, ring[(k + 1) % sides][0], ring[(k + 1) % sides][1])) - start).normalized()
        m = f.mat
        tu, tv, su, sv = _scales(m, "wall")
        f.u = Vec3.of(ax) * (tu / su)
        f.v = around * (tv / sv)
        f.origin = start - around * (k * arc)
    return hb


def wedge(lo, hi, rise_dir, mats, name='Wedge'):
    """Ramp: a box whose top slopes up toward rise_dir ('+x','-x','+y','-y')."""
    x, y, z = lo
    X, Y, Z = hi
    low = {'+x': [(x, y), (x, Y)], '-x': [(X, y), (X, Y)], '+y': [(x, y), (X, y)], '-y': [(x, Y), (X, Y)]}[rise_dir]
    # the low edge has no height: bottom quad + the two high top corners
    top = [(px, py, Z) for px, py in [(x, y), (X, y), (x, Y), (X, Y)] if (px, py) not in low]
    return hull([(x, y, z), (X, y, z), (x, Y, z), (X, Y, z)] + top, mats, name)


def stairs(lo, hi, steps, direction, mats, name='Stairs'):
    """Solid stairs rising toward direction; returns a list of boxes (one per step)."""
    x, y, z = lo
    X, Y, Z = hi
    out = []
    h = (Z - z) / steps
    for i in range(steps):
        if direction == '+x':
            d = (X - x) / steps
            b = box((x + i * d, y, z), (X, Y, z + (i + 1) * h), mats, '%s%d' % (name, i))
        elif direction == '-x':
            d = (X - x) / steps
            b = box((x, y, z), (X - i * d, Y, z + (i + 1) * h), mats, '%s%d' % (name, i))
        elif direction == '+y':
            d = (Y - y) / steps
            b = box((x, y + i * d, z), (X, Y, z + (i + 1) * h), mats, '%s%d' % (name, i))
        else:
            d = (Y - y) / steps
            b = box((x, y, z), (X, Y - i * d, z + (i + 1) * h), mats, '%s%d' % (name, i))
        out.append(b)
    return out


def sign_box(lo, hi, face, sign_tex, frame_mat, name='Sign', flags=0):
    """A thin box with a texture fitted exactly once on one face (posters, signs, labels)."""
    b = box(lo, hi, {k: (frame_mat if k != face else Mat(sign_tex, flags=flags)) for k in FACE_KEYS}, name)
    x, y, z = lo
    X, Y, Z = hi
    tu, tv = tex_size(sign_tex)
    for f in b.faces:
        if f.mat.tex != sign_tex:
            continue
        n = f.normal
        # right = normal x up (what a viewer facing the sign sees as "right")
        if face in ('-x', '+x'):
            width = Y - y
            right = (0.0, -1.0, 0.0) if face == '+x' else (0.0, 1.0, 0.0)
            start = (f.verts[0][0], Y if face == '+x' else y, Z)
        elif face in ('-y', '+y'):
            width = X - x
            right = (1.0, 0.0, 0.0) if face == '+y' else (-1.0, 0.0, 0.0)
            start = (x if face == '+y' else X, f.verts[0][1], Z)
        else:
            raise ValueError('sign faces are vertical')
        height = Z - z
        f.u = Vec3.of(right) * (tu / width)
        f.v = Vec3(0.0, 0.0, -tv / height)
        f.origin = start
    return b
