"""Compare planar BSP tessellations, including concave source faces.

Coverage uses the Deus Ex SDK's distinct precisions: THRESH_POINTS_ARE_SAME
(0.002 world units) tangentially and THRESH_SPLIT_POLY_PRECISELY (0.01) along the
source plane normal. Legacy T-junction vertices need not be perfectly planar.
The maximum combined displacement is sqrt(.002**2 + .01**2), not .002. A relative
area tolerance alone cannot establish these bounds: it can hide a distant hole
in a large face. Neither triangulation nor tolerance modifies game geometry.
"""
import math
import selected_rebuild as base

Refused = base.Refused
WORLD_TOLERANCE = .002
NORMAL_TOLERANCE = .01
AREA_ROUNDOFF = 1e-8


def orient(a, b, c):
    return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])


def area(p):
    return base.signed_area(p)


def inside(p, t):
    return all(orient(a, b, p) >= -1e-9 for a, b in zip(t, t[1:]+t[:1]))


def _on_segment(p, a, b):
    return (abs(orient(a, b, p)) <= 1e-9 and
            min(a[0], b[0])-1e-9 <= p[0] <= max(a[0], b[0])+1e-9 and
            min(a[1], b[1])-1e-9 <= p[1] <= max(a[1], b[1])+1e-9)


def _intersect(a, b, c, d):
    ac, ad, ca, cb = orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)
    return ((ac*ad < 0 and ca*cb < 0) or
            _on_segment(c, a, b) or _on_segment(d, a, b) or
            _on_segment(a, c, d) or _on_segment(b, c, d))


def triangles(poly):
    if any(not math.isfinite(x) for q in poly for x in q):
        raise Refused('Non-finite BSP vertex.')
    p = []
    for q in poly:
        if not p or math.dist(q, p[-1]) > 1e-8:
            p.append(q)
    if len(p) > 1 and math.dist(p[0], p[-1]) < 1e-8:
        p.pop()
    if len(p) < 3:
        return []
    for i, (a, b) in enumerate(zip(p, p[1:]+p[:1])):
        for j, (c, d) in enumerate(zip(p, p[1:]+p[:1])):
            if j <= i+1 or (i == 0 and j == len(p)-1):
                continue
            if _intersect(a, b, c, d):
                raise Refused('Self-intersecting BSP polygon; result withheld.')
    if abs(area(p)) < 1e-9:
        return []
    if area(p) < 0:
        p.reverse()
    out = []
    original = area(p)
    while len(p) > 3:
        found = False
        for i in range(len(p)):
            a, b, c = p[i-1], p[i], p[(i+1)%len(p)]
            turn = orient(a, b, c)
            if abs(turn) < 1e-9:
                p.pop(i)
                found = True
                break
            if turn < 0:
                continue
            if any(inside(q, [a, b, c]) for j, q in enumerate(p) if j not in ((i-1)%len(p), i, (i+1)%len(p))):
                continue
            out.append([a, b, c])
            p.pop(i)
            found = True
            break
        if not found:
            raise Refused('BSP polygon cannot be triangulated without changing its boundary.')
    if len(p) == 3:
        out.append(p)
    if abs(sum(area(t) for t in out)-original) > max(1e-6, original*1e-9):
        raise Refused('Triangulation changed polygon area.')
    return out


def _half_plane(poly, a, b, keep_inside=True, inset=0.):
    """Clip without snapping intersection coordinates."""
    result = []
    if not poly:
        return result
    offset = inset*math.dist(a, b)
    start = poly[-1]
    ds = orient(a, b, start)-offset
    for end in poly:
        de = orient(a, b, end)-offset
        if (ds >= 0) != (de >= 0):
            t = ds/(ds-de)
            result.append((start[0]+t*(end[0]-start[0]), start[1]+t*(end[1]-start[1])))
        if (de >= 0) == keep_inside:
            result.append(end)
        start, ds = end, de
    return result


def _subtract(subject, clip):
    """Partition convex subject minus convex clip into disjoint convex pieces."""
    pieces = []
    for a, b in zip(clip, clip[1:]+clip[:1]):
        outside = _half_plane(subject, a, b, False)
        if abs(area(outside)) > AREA_ROUNDOFF:
            pieces.append(outside)
        subject = _half_plane(subject, a, b)
        if abs(area(subject)) <= AREA_ROUNDOFF:
            break
    return pieces


def _hull(points):
    points = sorted(set(points))
    lower = []
    upper = []
    for p in points:
        while len(lower) >= 2 and orient(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(points):
        while len(upper) >= 2 and orient(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1]+upper[:-1]


def _expanded(triangle, tolerance):
    # Minkowski sum with an inscribed square, not offset supporting planes:
    # even at an acute corner, displacement can never exceed tolerance.
    d = tolerance/math.sqrt(2)
    return _hull([(x+dx, y+dy) for x, y in triangle
                  for dx, dy in ((-d, -d), (-d, d), (d, -d), (d, d))])


def _uncovered(subject, clips):
    pieces = [subject]
    for clip in clips:
        pieces = [part for piece in pieces for part in _subtract(piece, clip)]
        if not pieces:
            return 0.
    return sum(abs(area(piece)) for piece in pieces)


def _dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def _cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def _sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def _expanded3d_planes(triangle, tolerance, normal, kernel='cube'):
    """Triangle + tangential kernel + bounded normal segment.

    Minkowski facets come from face normals of either summand or cross products
    of their edge directions. This avoids a general-purpose 3D hull dependency.
    Both tangential kernels are inscribed in the radius-.002 disk. Extruding
    along the unit source normal adds at most .01 normal displacement.
    """
    axes = [(1., 0., 0.), (0., 1., 0.), (0., 0., 1.)]
    edges = [_sub(b, a) for a, b in zip(triangle, triangle[1:]+triangle[:1])]
    projected_axes = [tuple(a[i]-normal[i]*_dot(a, normal) for i in range(3)) for a in axes]
    if kernel == 'cube':
        generators = [tuple(tolerance/math.sqrt(3)*x for x in a) for a in projected_axes]
        generators.append(tuple(NORMAL_TOLERANCE*x for x in normal))
        facets = [_cross(a, b) for i, a in enumerate(generators) for b in generators[i+1:]]
        kernel_edges = generators
        support = lambda n:sum(abs(_dot(n, g)) for g in generators)
    elif kernel == 'octahedron':
        # Project the six axial vertices of an octahedron to the source plane,
        # then extrude the resulting convex polygon along its normal.
        basis = max(projected_axes, key=lambda a:_dot(a, a))
        length = math.sqrt(_dot(basis, basis))
        u = tuple(x/length for x in basis)
        w = _cross(normal, u)
        vertices = [tuple(sign*tolerance*x for x in a) for a in projected_axes for sign in (-1, 1)]
        lookup = {(_dot(p, u), _dot(p, w)):p for p in vertices}
        hull = [lookup[p] for p in _hull(list(lookup))]
        kernel_edges = [_sub(b, a) for a, b in zip(hull, hull[1:]+hull[:1])]+[normal]
        facets = [normal]+[_cross(e, normal) for e in kernel_edges]
        support = lambda n:tolerance*max(abs(_dot(n, a)) for a in projected_axes)+NORMAL_TOLERANCE*abs(_dot(n, normal))
    else:
        raise ValueError('Unknown expansion kernel')
    candidates = facets+[_cross(edges[0], edges[1])]+[_cross(e, a) for e in edges for a in kernel_edges]
    normals = {}
    for candidate in candidates:
        length = math.sqrt(_dot(candidate, candidate))
        if length < 1e-12:
            continue
        for sign in (-1, 1):
            n = tuple(sign*x/length for x in candidate)
            normals.setdefault(tuple(round(x, 12) for x in n), n)
    return [(n, max(_dot(n, p) for p in triangle)+support(n))
            for n in normals.values()]


def _clip3d(poly, planes):
    for normal, w in planes:
        if not poly:
            break
        result = []
        start = poly[-1]
        ds = w-_dot(normal, start)
        for end in poly:
            de = w-_dot(normal, end)
            if (ds >= 0) != (de >= 0):
                t = ds/(ds-de)
                result.append(tuple(a+t*(b-a) for a, b in zip(start, end)))
            if de >= 0:
                result.append(end)
            start, ds = end, de
        poly = result
    return poly


def _check_overlaps(polys, tolerance, key):
    """Reject overlap extending past point-merge precision into either face."""
    for i, p in enumerate(polys):
        for q in polys[i+1:]:
            if sorted(p) == sorted(q):
                raise Refused(f'Surface {key} has duplicate polygons; result withheld.')
            overlap = base.intersection(p, q)
            if abs(area(overlap)) <= AREA_ROUNDOFF:
                continue
            # Independently rounded adjacent edges may overlap by <= tolerance.
            # Duplicate faces and substantial overlaps retain interior after
            # eroding either triangle and are rejected.
            for triangle in (p, q):
                interior = overlap
                for a, b in zip(triangle, triangle[1:]+triangle[:1]):
                    interior = _half_plane(interior, a, b, inset=tolerance)
                if abs(area(interior)) > AREA_ROUNDOFF:
                    raise Refused(f'Surface {key} has overlapping polygons; result withheld.')


def coverage(a, b, overlap_policy=None):
    def project(d):
        out = {}
        world = {}
        normals = {}
        tolerances = {}
        for p in d['polys']:
            count = int(p[6])
            if not count:
                continue  # Empty structural partition, not a surface.
            if count < 3:
                raise Refused('Malformed BSP face.')
            normal = [float(x) for x in p[1:4]]
            length = math.sqrt(sum(x*x for x in normal))
            if not math.isfinite(length) or not length:
                raise Refused('Invalid BSP surface normal.')
            axis = max(range(3), key=lambda k:abs(normal[k]))
            keep = [k for k in range(3) if k != axis]
            vertices = [tuple(float(p[7+3*i+k]) for k in range(3)) for i in range(count)]
            if any(not math.isfinite(x) for v in vertices for x in v):
                raise Refused('Non-finite BSP vertex.')
            plane_w = float(p[4])
            if not math.isfinite(plane_w):
                raise Refused('Invalid BSP surface plane.')
            poly = [tuple(v[k] for k in keep) for v in vertices]
            ts = triangles(poly)
            key = (int(p[0]), axis)
            if ts:
                out.setdefault(key, []).extend(ts)
                lookup = {}
                for q, v in zip(poly, vertices):
                    if q in lookup and math.dist(v, lookup[q]) > WORLD_TOLERANCE:
                        raise Refused('BSP face folds across the projection axis; result withheld.')
                    lookup[q] = v
                world.setdefault(key, []).extend([[lookup[q] for q in t] for t in ts])
                normals[key] = tuple(x/length for x in normal)
                # The inverse projection can stretch displacement by 1/cos(theta).
                tolerances[key] = WORLD_TOLERANCE*abs(normal[axis])/length
        return out, world, normals, tolerances
    (aa, aw, an, at), (bb, bw, bn, bt) = project(a), project(b)
    if aa.keys() != bb.keys():
        raise Refused('Changed surface identity/plane coverage; result withheld.')
    checks = 0
    bounded = 0
    max_error = 0.
    authored_overlap = []
    for key in aa:
        av, bv = aa[key], bb[key]
        tolerance = min(at[key], bt[key])
        if math.dist(an[key], bn[key]) > 1e-6:
            raise Refused('Source face orientation changed; result withheld.')
        for projected, world, normal in ((av, aw[key], an[key]), (bv, bw[key], bn[key])):
            try:
                _check_overlaps(projected, tolerance, key)
            except Refused:
                if overlap_policy is None:
                    raise
                certificate = overlap_policy(key, projected, world, normal, tolerance)
                if not isinstance(certificate, dict) or certificate.get('certificate') != 'unchanged_two_linked_authored_faces':
                    raise Refused('Missing authored overlap certificate.')
                authored_overlap.append(certificate)
        # Their tangential union covers axial and diagonal rounding directions
        # better than either kernel alone, with the same explicit SDK bounds.
        expanded_a = [_expanded3d_planes(p, WORLD_TOLERANCE, an[key], k) for p in aw[key]
                    for k in ('cube', 'octahedron')]
        expanded_b = [_expanded3d_planes(p, WORLD_TOLERANCE, bn[key], k) for p in bw[key]
                    for k in ('cube', 'octahedron')]
        keep = [k for k in range(3) if k != key[1]]
        for polys, world, other, expanded in ((av, aw[key], bv, expanded_b), (bv, bw[key], av, expanded_a)):
            for poly, source in zip(polys, world):
                amount = sum(abs(area(base.intersection(poly, q))) for q in other)
                expected = area(poly)
                error = abs(amount-expected)
                max_error = max(max_error, error)
                # Check actual coverage even when a hole's area is tiny relative
                # to its face: relative area alone is not a geometric bound.
                # Intersect each expanded target with the actual 3D source
                # triangle before projection. Original UE1 T-junctions need not
                # be exactly planar, and an omitted-axis displacement must not
                # disappear in the coverage comparison.
                clips = []
                for planes in expanded:
                    clipped = _clip3d(source, planes)
                    projected = [tuple(p[k] for k in keep) for p in clipped]
                    if area(projected) < 0:
                        projected.reverse()
                    if area(projected) > AREA_ROUNDOFF:
                        clips.append(projected)
                missing = _uncovered(poly, clips)
                if missing > AREA_ROUNDOFF:
                    raise Refused(f'Surface {key} coverage differs beyond SDK bounds '
                                  f'(tangent {WORLD_TOLERANCE:g}, normal {NORMAL_TOLERANCE:g} world units; '
                                  f'uncovered area {missing:.9g}); result withheld.')
                if error > max(.001, expected*1e-6):
                    bounded += 1
                checks += 1
    return dict(triangles_checked=checks, max_area_error=max_error,
                tangent_tolerance=WORLD_TOLERANCE, normal_tolerance=NORMAL_TOLERANCE,
                max_combined_displacement=math.hypot(WORLD_TOLERANCE, NORMAL_TOLERANCE),
                bounded_roundoff_triangles=bounded, authored_overlap_certificates=authored_overlap)
