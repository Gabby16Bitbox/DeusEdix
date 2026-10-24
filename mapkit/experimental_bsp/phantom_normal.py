"""Certify a Full point-trace normal from a remote, nonphysical BSP splitter.

This does not ignore normals. Both models must have identical finite polygons,
UVs and planes around an interior contact and exactly the same volumetric
halfspace there. The candidate normal must be that unique physical normal;
the Full normal must belong to a common ancestor with no polygon there.
Currently supports only unclamped, axis-aligned zero-extent traces. Original
preservation comparisons and contacts at real edges always remain strict.
"""
from collections import Counter
from fractions import Fraction as Q
from pathlib import Path
import hashlib, math, struct
import convex_cells as c
from edited_collision_scope import source_edit_certificate

Refused = c.Refused
TOL = Q(1, 500)  # existing trace comparison, never increased
RADIUS = Q(1, 8)
INNER_RADIUS = Q(1, 16)
_SEAL = object()
# Exact SDK DLL used by kit sessions. Its entire point LineCheck function and
# .5 backoff constant were compared against the installed vanilla binary.
ENGINE_SHA256 = 'd66b689bbe95d7350b9f348da2273383c642e22e53dd56bd1bcf76ec322aa848'


class NativeBackoff:
    __slots__ = ('path', 'sha256', '_seal')

    def __init__(self, *args, **kwargs):
        raise TypeError('Use verify_native_backoff on the actual session DLL')


def verify_native_backoff(path):
    path = Path(path).resolve()
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != ENGINE_SHA256:
        raise Refused('Unknown native collision backoff implementation')
    evidence = object.__new__(NativeBackoff)
    evidence.path = path
    evidence.sha256 = ENGINE_SHA256
    evidence._seal = _SEAL
    return evidence


def _engine(evidence):
    if type(evidence) is not NativeBackoff or evidence._seal is not _SEAL:
        raise Refused('Missing typed native backoff evidence')
    if evidence.sha256 != ENGINE_SHA256 or hashlib.sha256(evidence.path.read_bytes()).hexdigest() != ENGINE_SHA256:
        raise Refused('Native collision DLL changed after verification')


def _q(value):
    if isinstance(value, bool):
        raise Refused('Boolean is not a native float')
    return c.native_float(value)


def _point(value):
    if not isinstance(value, (tuple, list)) or len(value) != 3:
        raise Refused('Malformed 3-D point')
    return tuple(_q(v) for v in value)


def _dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def _sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def _cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def _area(p):
    return sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(p, p[1:]+p[:1]))/2 if len(p) >= 3 else Q(0)


def _orient(a, b, p):
    return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])


def _on(a, b, p):
    return _orient(a, b, p) == 0 and all(min(a[k], b[k]) <= p[k] <= max(a[k], b[k]) for k in (0, 1))


def _intersects(a, b, d, e):
    return (_orient(a, b, d)*_orient(a, b, e) < 0 and _orient(d, e, a)*_orient(d, e, b) < 0 or
            _on(a, b, d) or _on(a, b, e) or _on(d, e, a) or _on(d, e, b))


def _convex(poly):
    if len(poly) < 3 or len(set(poly)) != len(poly) or not _area(poly):
        raise Refused('Degenerate projected polygon')
    for i, (a, b) in enumerate(zip(poly, poly[1:]+poly[:1])):
        for j, (d, e) in enumerate(zip(poly, poly[1:]+poly[:1])):
            if j <= i+1 or i == 0 and j == len(poly)-1:
                continue
            if _intersects(a, b, d, e):
                raise Refused('Self-crossing projected polygon')
    signs = {1 if turn > 0 else -1 for i in range(len(poly)) if (turn:=_orient(poly[i-1], poly[i], poly[(i+1)%len(poly)]))}
    if len(signs) != 1:
        raise Refused('Nonconvex BSP polygon is unsupported by the normal certificate')


def _clip(poly, n, w):
    if not poly:
        return []
    out = []
    a = poly[-1]
    da = _dot(a, n)-w
    for b in poly:
        db = _dot(b, n)-w
        if da*db < 0:
            t = da/(da-db)
            out.append(tuple(a[k]+t*(b[k]-a[k]) for k in range(len(a))))
        if db <= 0:
            out.append(b)
        a, da = b, db
    return list(dict.fromkeys(out))


def _subtract(poly, cutter):
    if _area(cutter) < 0:
        cutter = list(reversed(cutter))
    residual = poly
    out = []
    for a, b in zip(cutter, cutter[1:]+cutter[:1]):
        n = (b[1]-a[1], a[0]-b[0])
        w = _dot(n, a)
        outside = _clip(residual, tuple(-x for x in n), -w)
        if _area(outside):
            out.append(outside)
        residual = _clip(residual, n, w)
        if not _area(residual):
            break
    return out


def _ring_key(ring):
    ring = tuple(ring)
    return min(ring[i:]+ring[:i] for i in range(len(ring)))


def _parse_tree(tree):
    if not isinstance(tree, dict) or not isinstance(tree.get('nodes'), dict) or not isinstance(tree.get('surfs'), dict):
        raise Refused('Incomplete model evidence')
    raw = tree.get('polys')
    if not isinstance(raw, list) or len(raw) != len(tree['nodes']) or len(raw) > 100000 or set(tree['nodes']) != set(range(len(raw))):
        raise Refused('Incomplete or excessive BSP polygon evidence')
    nodes = {}
    polygons = []
    for i, p in enumerate(raw):
        n = tree['nodes'][i]
        if len(p) < 7 or int(p[0]) != n['surf'] or int(p[5]) != n['flags'] or int(p[6]) != n['vertices'] or len(p) != 7+3*n['vertices']:
            raise Refused('BSP node/polygon evidence disagrees')
        plane = tuple(_q(v) for v in p[1:5])
        if not any(plane[:3]):
            raise Refused('Zero native BSP normal')
        ring = [tuple(_q(x) for x in p[7+3*j:10+3*j]) for j in range(n['vertices'])]
        surface = tree['surfs'].get(n['surf'])
        if not isinstance(surface, (list, tuple)) or len(surface) != 19 or surface[0] != n['actor']:
            raise Refused('Incomplete surface ownership/UV evidence')
        # Exclude only the lightmap slot: it is not geometry or material mapping.
        key = (surface[0], surface[1], int(surface[2]), int(surface[3]), int(surface[5]), int(surface[6]),
             *tuple(_q(v) for v in surface[7:]))
        nodes[i] = dict(n, plane=plane)
        polygons.append(dict(index=i, ring=ring, plane=plane, key=key, flags=n['flags']))
    c.validate_links(nodes, 0, volumes_only=True)
    return nodes, polygons


def _near(polygons, point):
    result = []
    for p in polygons:
        vv = p['ring']
        if not vv:
            continue
        if any(min(v[k] for v in vv) > point[k]+RADIUS or max(v[k] for v in vv) < point[k]-RADIUS for k in range(3)):
            continue
        ring = vv
        for k in range(3):
            n = tuple(Q(j == k) for j in range(3))
            ring = _clip(ring, n, point[k]+RADIUS)
            ring = _clip(ring, tuple(-x for x in n), -point[k]+RADIUS)
        # Even a touching different surface is refused conservatively.
        if ring:
            result.append(dict(p, clipped=ring))
    if not result or len(result) > 128:
        raise Refused('Missing or excessive finite contact neighborhood')
    return result


def _footprint(near, point, plane):
    axis = max(range(3), key=lambda k:abs(plane[k]))
    keep = [k for k in range(3) if k != axis]
    # Require the entire square on the target plane to fit inside the cube.
    r = INNER_RADIUS
    if sum(abs(plane[k])*r for k in keep) > abs(plane[axis])*RADIUS:
        raise Refused('Projected neighborhood exceeds bounded cube')
    x, y = [point[k] for k in keep]
    square = [(x-r, y-r), (x+r, y-r), (x+r, y+r), (x-r, y+r)]
    residual = [square]
    pieces = []
    for p in near:
        projected = [tuple(v[k] for k in keep) for v in p['ring']]
        _convex(projected)
        clipped = [tuple(v[k] for k in keep) for v in p['clipped']]
        if len(clipped) < 3 or not _area(clipped):
            continue
        intersection = clipped
        for a, b in zip(square, square[1:]+square[:1]):
            n = (b[1]-a[1], a[0]-b[0])
            intersection = _clip(intersection, n, _dot(n, a))
        if _area(intersection):
            pieces.append(intersection)
        residual = [piece for region in residual for piece in _subtract(region, clipped)]
        if len(residual) > 4096:
            raise Refused('Footprint proof complexity limit')
    if residual:
        raise Refused('Contact is at an edge or a gap in the finite physical footprint')
    for i, piece in enumerate(pieces):
        for other in pieces[i+1:]:
            if _area(other) < 0:
                other = list(reversed(other))
            overlap = piece
            for a, b in zip(other, other[1:]+other[:1]):
                n = (b[1]-a[1], a[0]-b[0])
                overlap = _clip(overlap, n, _dot(n, a))
            if _area(overlap):
                raise Refused('Duplicate or overlapping physical contact fragments')
    return dict(projected_axes=keep, interior_half_size=float(r), exact_uncovered_area='0')


def _volume(nodes, root_outside, point, plane):
    scope = c.box_cell(tuple(v-RADIUS for v in point), tuple(v+RADIUS for v in point))
    leaves = c.leaf_cells(nodes, 0, root_outside, scope, c.Budget(max_splits=20000, max_fragments=4096), volumes_only=True)
    volume = Q(0)
    for leaf in leaves:
        negative, positive = c.split_convex(leaf['cell'], plane)
        if negative and leaf['outside'] or positive and not leaf['outside']:
            raise Refused('Contact neighborhood is not the same physical solid/empty halfspace')
        volume += c.volume(leaf['cell'])
    if volume != c.volume(scope):
        raise Refused('Incomplete volumetric neighborhood')
    common = set(i for i, _ in leaves[0]['path'])
    for leaf in leaves[1:]:
        common.intersection_update(i for i, _ in leaf['path'])
    return dict(leaves=len(leaves), exact_volume=str(volume), physical_halfspace=True), common


def _hit(row):
    if not isinstance(row, str) or row == 'clear' or len(row.split()) != 7:
        raise Refused('Expected two finite collision hits')
    return tuple(_q(v) for v in row.split())


def certify_phantom_normal(probe, local_hit, full_hit, local_tree, full_tree, *, old_sources, new_sources,
                           selected, root_outside, engine, reference='full'):
    """Return explicit certified audit or refuse; never rewrites a native hit."""
    try:
        if reference != 'full':
            raise Refused('Original collision preservation cannot use this certificate')
        _engine(engine)
        if type(root_outside) is not int or root_outside not in (0, 1):
            raise Refused('Unknown model root classification')
        if not isinstance(probe, (list, tuple)) or len(probe) != 9:
            raise Refused('Malformed point sweep')
        p = tuple(_q(x) for x in probe)
        if any(p[6:]):
            raise Refused('Only zero-extent collision is supported')
        start, end = p[:3], p[3:6]
        delta = _sub(end, start)
        axes = [i for i in range(3) if delta[i]]
        if len(axes) != 1:
            raise Refused('Only nonzero axis-aligned point sweeps have exact backoff inversion')
        axis = axes[0]
        length = abs(delta[axis])
        direction = 1 if delta[axis] > 0 else -1
        x, y = _hit(local_hit), _hit(full_hit)
        if any(abs(a-b) > TOL for a, b in zip(x[:4], y[:4])):
            raise Refused('Contact time or location differs beyond existing comparison')
        if all(abs(a-b) <= TOL for a, b in zip(x[4:], y[4:])):
            raise Refused('There is no normal-only mismatch to certify')
        raw = []
        for hit in (x, y):
            if not Q(0) < hit[0] < Q(1) or not Q(0) < hit[0]+Q(1, 2)/length < Q(1):
                raise Refused('Clamped or time-zero contact is unsupported')
            if abs(_dot(hit[4:], hit[4:])-1) > Q(1, 10000):
                raise Refused('Invalid native unit normal')
            if _dot(hit[4:], delta) >= 0:
                raise Refused('Collision normal does not oppose the sweep')
            if any(abs(hit[1+k]-(start[k]+delta[k]*hit[0])) > TOL for k in range(3)):
                raise Refused('Native hit time and location are inconsistent')
            point = list(hit[1:4])
            point[axis] += direction*Q(1, 2)
            raw.append(tuple(point))
        if any(abs(a-b) > TOL for a, b in zip(*raw)):
            raise Refused('Raw contacts differ beyond existing comparison')
        edit = source_edit_certificate(old_sources, new_sources, set(selected))
        if not edit.get('valid'):
            raise Refused('Selected closed source evidence failed: '+str(edit.get('reason')))
        local_nodes, local_polys = _parse_tree(local_tree)
        full_nodes, full_polys = _parse_tree(full_tree)
        first = _near(local_polys, raw[0])
        plane = first[0]['plane']
        if tuple(x[4:]) != plane[:3]:
            raise Refused('Candidate normal is not the authoritative physical surface normal')
        denominator = _dot(plane[:3], delta)
        if not denominator:
            raise Refused('Sweep is parallel to the physical surface')
        t = (plane[3]-_dot(plane[:3], start))/denominator
        if not Q(0) < t-Q(1, 2)/length < Q(1):
            raise Refused('Physical contact is clamped or outside the sweep')
        center = tuple(start[k]+delta[k]*t for k in range(3))
        if any(abs(point[k]-center[k]) > TOL for point in raw for k in range(3)):
            raise Refused('Reconstructed raw contact misses the physical surface')
        local_near, full_near = _near(local_polys, center), _near(full_polys, center)
        owner, face = local_near[0]['key'][0], local_near[0]['key'][3]
        if owner not in set(selected):
            raise Refused('Physical contact is not owned by a certified selected source')
        source = new_sources[owner]
        if source['operation'] != 1 or source['flags'] != 0:
            raise Refused('Only an ordinary solid additive source is supported')
        if not 0 <= face < len(source['faces']) or tuple(_q(v) for v in source['face_normals'][face]) != plane[:3]:
            raise Refused('Physical normal does not match authoritative source normal')
        source_vertex = _point(source['faces'][face][0])
        norm2 = _dot(plane[:3], plane[:3])
        if (_dot(plane[:3], source_vertex)-plane[3])**2 > Q(1, 10000)*norm2:
            raise Refused('Physical plane disagrees with source geometry beyond SDK bound')
        for near in (local_near, full_near):
            for poly in near:
                if poly['plane'] != plane or poly['flags']&0x21 or poly['key'][0] != owner or poly['key'][3] != face:
                    raise Refused('Multiple physical normals, sources, or noncollision faces meet the neighborhood')
                if poly['key'][2]&0x04000028:
                    raise Refused('Special physical surface semantics')
                if tuple(poly['key'][9:12]) != plane[:3]:
                    raise Refused('Surface vector and BSP plane normals disagree')
                if any((_dot(v, plane[:3])-plane[3])**2 > Q(1, 10000)*norm2 for v in poly['ring']):
                    raise Refused('Physical polygon exceeds SDK normal-plane bound')
        signature = lambda near:Counter((p['plane'], p['key'], p['flags'], _ring_key(p['ring'])) for p in near)
        if signature(local_near) != signature(full_near):
            raise Refused('Physical rings, UVs, or planes differ between Local and Full')
        footprint = _footprint(local_near, center, plane)
        _footprint(full_near, center, plane)
        local_volume, _ = _volume(local_nodes, root_outside, center, plane)
        full_volume, common = _volume(full_nodes, root_outside, center, plane)
        phantom = []
        near_indices = {poly['index'] for poly in full_near}
        for i in sorted(common):
            n = full_nodes[i]
            normal = n['plane'][:3]
            if normal != y[4:] and tuple(-v for v in normal) != y[4:]:
                continue
            if i in near_indices or not n['vertices']:
                continue
            if ( _dot(center, normal)-n['plane'][3])**2 > TOL*TOL*_dot(normal, normal):
                continue
            phantom.append(dict(node=i, owner=n['actor'], plane=[float(v) for v in n['plane']]))
        if not phantom:
            raise Refused('Full normal is not explained by a remote common-ancestor splitter')
        return dict(status='certified_full_phantom_normal', reference='full', engine_sha256=engine.sha256,
                    supported_probe='axis-aligned zero-extent unclamped point sweep', native_backoff=.5,
                    raw_contact=[float(v) for v in center], surface=dict(owner=owner, face=face, normal=[float(v) for v in plane[:3]]),
                    local_nodes=[p['index'] for p in local_near], full_nodes=[p['index'] for p in full_near],
                    identical_rings_uv_planes=True, footprint=footprint, local_volume=local_volume, full_volume=full_volume,
                    phantom_splitters=phantom, selected_source_volumes=edit['selected_volume_proofs'],
                    unchanged_position_time_tolerance=float(TOL), corrected_oracle_component='normal_only')
    except (KeyError, IndexError, TypeError, ValueError, OverflowError, OSError, AttributeError) as error:
        if isinstance(error, Refused):
            raise
        raise Refused('Malformed or incomplete phantom-normal evidence: '+str(error)) from error
