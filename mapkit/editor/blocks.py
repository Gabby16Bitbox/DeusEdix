"""The shapes of the editor's blocks (Hierarchy > +: cube, wedge, cylinder, cone, sphere, dome). b['shape'] chooses
the brushes made from the block's box (lo, hi); the editor draws the same shapes (static/block-shapes.js). Water,
zone portals, moving blocks and signs stay boxes.

UnrealEd's brush builders, as blocks (Gabby, 20 Oct 2026): Cylinder (Sides, Align to side, Hollow with the wall's
thickness), Cone (Sides, a cap: `top` the radius at the top as a share of the bottom's, 0 a point; hollow too) and
Tetrahedron, its sphere: here a sphere of `sides` round and sides/2 rings, the faces flat quads (straight rows for
the textures), a dome its top half on a flat base, both hollow too (a shell). Better than UnrealEd's: they are
blocks, so the box stretches them (an elliptic cylinder, an egg, a low dome), E turns them any way, the
texture shows before Rebuild and runs round the shape as one skin (wrap_round); a hollow one is cut into convex pieces by itself (UnrealEd's hollow builders
leave that to the brush). b['sides'] 3..64 (16), b['hollow'] the wall's thickness (0: solid), b['top'] 0..0.95,
b['align'] a flat side facing +X instead of a corner.
"""
import math

import geom

SHAPES = ('box', 'wedge', 'cylinder', 'cone', 'sphere', 'dome')
CYLINDER_SIDES = 16
HOLLOW = ('cylinder', 'cone', 'sphere', 'dome')
_REFS = None


def texture_ref(tex):
    """A texture's full name (Package.Group.Name) from the catalog for a short one, '' when unknown: the
    editor reads its picture with it (textures.source) to show a new block with its texture."""
    global _REFS
    tex = str(tex or '')
    if '.' in tex:
        return tex
    if _REFS is None:
        _REFS = {}
        for path in sorted(geom.CATALOG.glob('*.txt')):
            for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
                parts = line.split()
                if len(parts) >= 2:
                    _REFS.setdefault(parts[1].split('.')[-1].lower(), path.stem + '.' + parts[1])
    return _REFS.get(tex.lower(), '')


def shape_of(b):
    if b.get('mover') or b.get('water') or b.get('portal') or b.get('sign'):
        return 'box'
    s = b.get('shape') or 'box'
    return s if s in SHAPES else 'box'


def options(b):
    """sides, hollow (wall thickness, 0 = solid), top (cone), align: the block's own or the defaults."""
    def num(k, d, lo, hi):
        try:
            return max(lo, min(hi, float(b.get(k, d))))
        except (TypeError, ValueError):
            return d
    return dict(sides=int(round(num('sides', CYLINDER_SIDES, 3, 64))), hollow=num('hollow', 0, 0, 4096),
                top=num('top', 0, 0, 0.95), align=bool(b.get('align')))


def _brush(polys, mats, name):
    """A convex brush from its faces (each a list of points), turned to face out from the shape's middle."""
    pts = [p for poly in polys for p in poly]
    c = tuple(sum(p[k] for p in pts) / len(pts) for k in range(3))
    faces = []
    for poly in polys:
        n = geom.cross(geom.sub(poly[1], poly[0]), geom.sub(poly[2], poly[0]))
        if geom.dot(n, n) < 1e-9:
            continue
        mid = tuple(sum(p[k] for p in poly) / len(poly) for k in range(3))
        if geom.dot(n, geom.sub(mid, c)) < 0:
            poly = poly[::-1]
            n = geom.mul(n, -1)
        n = geom.norm(n)
        key = ('+' if max(n, key=abs) > 0 else '-') + 'xyz'[[abs(x) for x in n].index(max(abs(x) for x in n))]
        m = geom._pick(mats, key)
        if m is not None:
            faces.append(geom.Face(list(poly), m, n))
    return geom.Brush(faces, name)


def _ring(n, rx, ry, cx, cy, align):
    ph = math.pi / n if align else 0.0
    return [(cx + rx * math.cos(ph + 2 * math.pi * i / n), cy + ry * math.sin(ph + 2 * math.pi * i / n)) for i in range(n)]


def _sphere_points(c, r, n, dome):
    """Rings of points (bottom to top) of a sphere (or its top half) of radii r about c, n round."""
    rings = max(2, n // 2) if not dome else max(1, n // 4)
    lat0 = -math.pi / 2 if not dome else 0.0
    out = []
    for k in range(rings + 1):
        lat = lat0 + (math.pi / 2 - lat0) * k / rings
        if abs(abs(lat) - math.pi / 2) < 1e-9:
            out.append([(c[0], c[1], c[2] + r[2] * math.sin(lat))])
            continue
        out.append([(c[0] + r[0] * math.cos(lat) * math.cos(2 * math.pi * i / n),
                     c[1] + r[1] * math.cos(lat) * math.sin(2 * math.pi * i / n),
                     c[2] + r[2] * math.sin(lat)) for i in range(n)])
    return out


def _sphere_cells(rings):
    """The quads (triangles at a pole) between the rings: [[p, ...]]."""
    cells = []
    for lo, hi in zip(rings, rings[1:]):
        n = max(len(lo), len(hi))
        for i in range(n):
            a, b = lo[i % len(lo)], lo[(i + 1) % len(lo)]
            d, e = hi[i % len(hi)], hi[(i + 1) % len(hi)]
            cell = [a, b, e, d]
            cells.append([p for j, p in enumerate(cell) if p != cell[j - 1]])     # a pole's point once
    return cells


def _meridian(pts):
    """[(z, s)] down a line of points from the top: s the distance along it from the top."""
    out, s = [], 0.0
    for k, p in enumerate(pts):
        if k:
            s += math.dist(pts[k - 1], p)
        out.append((p[2], s))
    return out


def _slant(mer, z):
    for (z0, s0), (z1, s1) in zip(mer, mer[1:]):
        if z1 - 1e-6 <= z <= z0 + 1e-6:
            return s0 if abs(z0 - z1) < 1e-9 else s0 + (s1 - s0) * (z0 - z) / (z0 - z1)
    return mer[-1][1] if z < mer[-1][0] else 0.0


def wrap_round(pieces, c, outer, inner=None):
    """The textures of a round shape's sides as one skin (20 Oct 2026): U runs round the shape band by band,
    each face starting where the one before ends, V down its slope from the top (outer, inner: _meridian
    lines), so a cone, a sphere or a dome is not a patchwork of faces each mapped its own way; the texture is
    stretched a little so a whole number of repeats goes round (no seam at the back). Flat caps
    keep the world-aligned mapping."""
    bands = {}
    for br in pieces:
        for f in br.faces:
            n = f.normal
            if abs(n[2]) > 0.999 or f.u is not None:
                continue
            h = geom.norm((n[0], n[1], 0.0))
            vs = f.verts
            flat = [(vs[i], vs[(i + 1) % len(vs)]) for i in range(len(vs)) if abs(vs[i][2] - vs[(i + 1) % len(vs)][2]) < 1e-3]
            if not flat:
                continue
            a, e = max(flat, key=lambda ed: (round(math.dist(ed[0], ed[1]), 3), -ed[0][2]))      # the widest, the lower of two alike
            mid = ((a[0] + e[0]) / 2 - c[0], (a[1] + e[1]) / 2 - c[1])
            r = math.hypot(*mid)
            if r < 1e-6 or abs(mid[0] * h[0] + mid[1] * h[1]) < 0.5 * r:      # a wall between pieces
                continue
            out = mid[0] * h[0] + mid[1] * h[1] > 0
            u = geom.norm(geom.cross(h, (0.0, 0.0, 1.0)))
            v = geom.norm(geom.cross(n, u))
            if v[2] > 0:
                v = geom.mul(v, -1)
            P = min((a, e), key=lambda q: geom.dot(q, u))
            above = sum(q[2] for q in vs) / len(vs) > P[2]
            phi = math.atan2(mid[1], mid[0])
            bands.setdefault((round(P[2], 1), out, above), []).append((-phi if out else phi, f, u, v, P, abs(geom.dot(geom.sub(e, a), u))))
    for (_z, out, _above), items in bands.items():
        items.sort(key=lambda it: it[0])
        total = sum(it[5] for it in items)
        cum = 0.0
        for _, f, u, v, P, w in items:
            m = f.mat
            tu, tv, su, sv = geom._scales(m, 'wall')
            if total > 1e-6:          # a whole number of repeats round: no seam where the band closes
                su = total / max(1, round(total / su))
            cu = cum - m.offset[0]
            cv = _slant(outer if out or not inner else inner, P[2]) - m.offset[1]
            f.u, f.v = geom.mul(u, tu / su), geom.mul(v, tv / sv)
            f.origin = geom.sub(geom.sub(P, geom.mul(u, cu)), geom.mul(v, cv))
            cum += w
    return pieces


def brushes(b, mats, name):
    """The block's brushes before its turn (geom.rotate_brush turns them about its centre): one, or the convex
    pieces of a hollow one."""
    lo, hi = tuple(b['lo']), tuple(b['hi'])
    s = shape_of(b)
    o = options(b)
    if s == 'wedge':                  # a ramp, high at +X (E turns it any way)
        return [geom.wedge(lo, hi, '+x', mats, name=name)]
    if s == 'box':
        return [geom.box(lo, hi, mats, name=name)]
    c = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)
    rx, ry, h = (hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, o['hollow']
    hollow = 0 < h < min(rx, ry)
    n = o['sides']
    if s in ('cylinder', 'cone'):
        t = 1.0 if s == 'cylinder' else o['top']
        if not hollow:
            if s == 'cylinder':       # an upright cylinder, elliptic when its width and depth differ
                return [geom.prism((c[0], c[1]), rx, lo[2], hi[2], mats, sides=n, ry=ry, name=name,
                                   phase=math.pi / n if o['align'] else 0.0)]
            ring = _ring(n, rx, ry, c[0], c[1], o['align'])
            bottom = [(x, y, lo[2]) for x, y in ring]
            if t < 0.01:              # a point
                apex = (c[0], c[1], hi[2])
                polys = [bottom] + [[bottom[i], bottom[(i + 1) % n], apex] for i in range(n)]
                mer = _meridian([apex, bottom[0]])
            else:                     # a cap
                top = [(c[0] + (x - c[0]) * t, c[1] + (y - c[1]) * t, hi[2]) for x, y in ring]
                polys = [bottom, top] + [[bottom[i], bottom[(i + 1) % n], top[(i + 1) % n], top[i]] for i in range(n)]
                mer = _meridian([top[0], bottom[0]])
            return wrap_round([_brush(polys, mats, name)], c, mer)
        outer, inner = _ring(n, rx, ry, c[0], c[1], o['align']), _ring(n, rx - h, ry - h, c[0], c[1], o['align'])
        out, mers = [], []
        for i in range(n):            # a hollow one: a convex piece per side
            j = (i + 1) % n
            pts = []
            for ring, shrink in ((outer, 0.0), (inner, h)):
                for k in (i, j):
                    x, y = ring[k]
                    pts.append((x, y, lo[2]))
                    # at the top a cone's ring is its bottom's scaled (flat faces), the wall at least as
                    # thick where the cone is narrowest (never past the middle)
                    f = t if shrink == 0 else max(0.0, (min(rx, ry) * t - h) / (min(rx, ry) - h))
                    pts.append((c[0] + (x - c[0]) * f, c[1] + (y - c[1]) * f, hi[2]))
            out.append(geom.hull(pts, mats, '%s_%d' % (name, i)))
            if i == 0:                # the lines down the outside and the inside: bottom, top of each
                mers = [_meridian([pts[1], pts[0]]), _meridian([pts[5], pts[4]])]
        return wrap_round(out, c, *mers)
    # sphere, dome: a sphere's centre in the box's middle; a dome's on its floor, its top the box's top
    dome = s == 'dome'
    centre = (c[0], c[1], lo[2]) if dome else c
    rz = (hi[2] - lo[2]) if dome else (hi[2] - lo[2]) / 2
    rings = _sphere_points(centre, (rx, ry, rz), n, dome)
    if not hollow:
        polys = _sphere_cells(rings)
        if dome:
            polys.append(rings[0])    # the flat base
        return wrap_round([_brush(polys, mats, name)], c, _meridian([r[0] for r in rings[::-1]]))
    inner = _sphere_points(centre, (rx - h, ry - h, max(1.0, rz - h)), n, dome)
    out = []
    for i, (a, b2) in enumerate(zip(_sphere_cells(rings), _sphere_cells(inner))):
        out.append(geom.hull(list(dict.fromkeys(a + b2)), mats, '%s_%d' % (name, i)))
    return wrap_round(out, c, _meridian([r[0] for r in rings[::-1]]), _meridian([r[0] for r in inner[::-1]]))


def brush(b, mats, name):
    """The block's brush (the first piece of a hollow one)."""
    return brushes(b, mats, name)[0]
