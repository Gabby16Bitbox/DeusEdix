"""Exact bounded convex-cell operations for independent BSP checks.

All halfspaces use n.dot(p) <= w. Fractions preserve the supplied numbers;
native_float() reconstructs the exact IEEE float32 written with nine digits.
No geometric epsilon, raster grid, random ray, or Full rebuild is used here.
This module proves statements about bounded cells, not about native hull caches.
"""
from dataclasses import dataclass
from fractions import Fraction
from itertools import combinations
import math
import struct


class Refused(ValueError):
    pass


def q(x):
    if isinstance(x, bool):
        raise Refused('Boolean is not a coordinate')
    try:
        value = x if isinstance(x, Fraction) else Fraction(str(x))
    except (ValueError, TypeError, ZeroDivisionError, OverflowError) as error:
        raise Refused('Non-finite or malformed coordinate') from error
    if value.numerator.bit_length() + value.denominator.bit_length() > 4096:
        raise Refused('Exact-arithmetic complexity budget exceeded')
    return value


def native_float(x):
    try:
        value = struct.unpack('<f', struct.pack('<f', float(x)))[0]
    except (ValueError, TypeError, OverflowError, struct.error) as error:
        raise Refused('Invalid native float32') from error
    if not math.isfinite(value):
        raise Refused('Non-finite native float32')
    return Fraction.from_float(value)


def point(x):
    if not isinstance(x, (tuple, list)) or len(x) != 3:
        raise Refused('Expected three coordinates')
    return tuple(q(v) for v in x)


def plane(x):
    if not isinstance(x, (tuple, list)) or len(x) != 4:
        raise Refused('Expected four plane coefficients')
    p = tuple(q(v) for v in x)
    if not any(p[:3]):
        raise Refused('Zero plane normal')
    return p


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def distance(v, p):
    return dot(v, p[:3])-p[3]


def vertices(cell):
    return tuple(dict.fromkeys(v for face in cell for v in face))


def full_dimension(cell):
    vv = vertices(cell)
    if len(vv) < 4:
        return False
    a = vv[0]
    b = next((v for v in vv[1:] if v != a), None)
    if b is None:
        return False
    c = next((v for v in vv[1:] if any(cross(sub(b, a), sub(v, a)))), None)
    if c is None:
        return False
    normal = cross(sub(b, a), sub(c, a))
    return any(dot(normal, sub(v, a)) != 0 for v in vv)


def box_cell(low, high):
    low, high = point(low), point(high)
    if any(a >= b for a, b in zip(low, high)):
        raise Refused('Degenerate bounding box')
    vv = [(x, y, z) for x in (low[0], high[0]) for y in (low[1], high[1]) for z in (low[2], high[2])]
    return tuple(tuple(vv[i] for i in face) for face in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)))


def _planar_hull(vv, normal):
    drop = max(range(3), key=lambda i: abs(normal[i]))
    axes = [i for i in range(3) if i != drop]
    projected = {(v[axes[0]], v[axes[1]]): v for v in vv}
    pp = sorted(projected)
    if len(pp) < 3:
        return ()
    def turn(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    def chain(seq):
        out = []
        for v in seq:
            while len(out) >= 2 and turn(out[-2], out[-1], v) <= 0:
                out.pop()
            out.append(v)
        return out
    hull = chain(pp)[:-1] + chain(reversed(pp))[:-1]
    return tuple(projected[p] for p in hull)


def _clip(cell, p):
    vv = vertices(cell)
    dd = [distance(v, p) for v in vv]
    if not dd or min(dd) >= 0:
        return ()
    if max(dd) <= 0:
        return cell
    faces, cap = [], set()
    for face in cell:
        out = []
        a = face[-1]
        da = distance(a, p)
        for b in face:
            db = distance(b, p)
            if (da < 0 and db > 0) or (da > 0 and db < 0):
                t = da/(da-db)
                hit = tuple(q(a[k]+t*(b[k]-a[k])) for k in range(3))
                out.append(hit)
                cap.add(hit)
            if db <= 0:
                out.append(b)
                if db == 0:
                    cap.add(b)
            a, da = b, db
        out = tuple(dict.fromkeys(out))
        if len(out) >= 3:
            faces.append(out)
    cap_face = _planar_hull(cap, p[:3])
    if len(cap_face) >= 3:
        faces.append(cap_face)
    result = tuple(faces)
    return result if full_dimension(result) else ()


@dataclass
class Budget:
    max_splits: int = 10000
    max_fragments: int = 10000
    splits: int = 0
    fragments: int = 0

    def split(self):
        self.splits += 1
        if self.splits > self.max_splits:
            raise Refused('Convex split budget exceeded')

    def fragment(self, count=1):
        self.fragments += count
        if self.fragments > self.max_fragments:
            raise Refused('Convex fragment budget exceeded')


def split_convex(cell, cut, budget=None):
    """Return full-dimensional negative and positive closed pieces.

    Shared boundaries have zero volume. Surface coverage must be checked
    separately before any result is considered a complete geometry certificate.
    """
    cut = plane(cut)
    if budget:
        budget.split()
    return _clip(cell, cut), _clip(cell, tuple(-v for v in cut))


def volume(cell):
    vv = vertices(cell)
    if not full_dimension(cell):
        return Fraction(0)
    center = tuple(sum(v[k] for v in vv)/len(vv) for k in range(3))
    return sum(abs(dot(sub(face[0], center), cross(sub(face[i], center), sub(face[i+1], center))))/6
               for face in cell for i in range(1, len(face)-1))


def halfspace_feasible(planes, limit=50000):
    """Exact Fourier–Motzkin feasibility, including lower-dimensional sets."""
    rows = [tuple(q(v) for v in p) for p in planes]
    dimensions = len(rows[0])-1 if rows else 3
    for count in range(dimensions, 0, -1):
        if any(not any(r[:-1]) and r[-1] < 0 for r in rows):
            return False
        rows = list(dict.fromkeys(r for r in rows if any(r[:-1])))
        if not rows:
            return True
        axis = min(range(count), key=lambda k:sum(r[k] > 0 for r in rows)*sum(r[k] < 0 for r in rows))
        plus = [r for r in rows if r[axis] > 0]
        minus = [r for r in rows if r[axis] < 0]
        new = [r[:axis]+r[axis+1:] for r in rows if r[axis] == 0]
        if len(plus)*len(minus)+len(new) > limit:
            raise Refused('Halfspace feasibility budget exceeded')
        for a in plus:
            for b in minus:
                row = tuple(q(a[k]/a[axis]-b[k]/b[axis]) for k in range(count+1) if k != axis)
                new.append(row)
        rows = new
    return not any(r[0] < 0 for r in rows)


def bounded_cell(planes, limit=50000):
    """Construct a bounded halfspace intersection, refusing unbounded scopes.

    A nonzero recession direction is detected exhaustively using six exact
    feasibility problems. Enumerating all triple-plane vertices then supplies
    every face of a bounded, full-dimensional convex polyhedron.
    """
    planes = tuple(plane(p) for p in planes)
    if not planes:
        raise Refused('Unbounded cell: no ancestor planes')
    if len(planes) > 80:
        raise Refused('Ancestor-plane complexity budget exceeded')
    recession = [p[:3]+(Fraction(0),) for p in planes]
    cube = []
    for axis in range(3):
        for sign in (-1, 1):
            n = [Fraction(0)]*3
            n[axis] = sign
            cube.append(tuple(n)+(Fraction(1),))
    for axis in range(3):
        for sign in (-1, 1):
            n = [Fraction(0)]*3
            n[axis] = -sign
            if halfspace_feasible(recession+cube+[tuple(n)+(Fraction(-1),)], limit):
                raise Refused('Unbounded ancestor cell requires a separate outside proof')
    vv = set()
    for a, b, c in combinations(planes, 3):
        bc = cross(b[:3], c[:3])
        det = dot(a[:3], bc)
        if not det:
            continue
        ca = cross(c[:3], a[:3])
        ab = cross(a[:3], b[:3])
        v = tuple(q((a[3]*bc[k]+b[3]*ca[k]+c[3]*ab[k])/det) for k in range(3))
        if all(distance(v, p) <= 0 for p in planes):
            vv.add(v)
    faces = []
    for p in planes:
        ring = _planar_hull([v for v in vv if distance(v, p) == 0], p[:3])
        if len(ring) >= 3 and frozenset(ring) not in [frozenset(f) for f in faces]:
            faces.append(ring)
    result = tuple(faces)
    if not full_dimension(result):
        raise Refused('Empty or lower-dimensional ancestor cell')
    return result


def partition_brush(cell, planes, budget=None):
    """Disjoint interiors: pieces outside a convex brush, then its intersection."""
    if not planes:
        raise Refused('Missing convex brush planes')
    inside, outside = cell, []
    for p in planes:
        if not inside:
            break
        inside, part = split_convex(inside, p, budget)
        if part:
            outside.append(part)
            if budget:
                budget.fragment()
    return tuple(outside), inside


def validate_links(nodes, root, volumes_only=False):
    if root not in nodes:
        raise Refused('Missing BSP root')
    seen, stack = set(), [root]
    while stack:
        i = stack.pop()
        if i in seen or i not in nodes:
            raise Refused('Cyclic, shared, or invalid BSP link')
        seen.add(i)
        n = nodes[i]
        plane(n['plane'])
        if len(n['children']) != 3 or n['vertices'] not in (0, *range(3, 25)):
            raise Refused('Malformed BSP node')
        if n['flags'] & ~0xFF:
            raise Refused('Unknown BSP flags')
        chain = n['children'][2]
        if chain != -1:
            if chain not in nodes or nodes[chain]['children'][:2] != [-1, -1]:
                raise Refused('Coplanar list has spatial children')
            a, b = plane(n['plane']), plane(nodes[chain]['plane'])
            pivot = next(k for k in range(3) if a[k])
            if not volumes_only and (b[pivot] == 0 or any(a[k]*b[pivot] != b[k]*a[pivot] for k in range(4))):
                raise Refused('Coplanar list contains a different plane')
            if not volumes_only and bool(n['vertices'] and not n['flags'] & 0x21) != bool(nodes[chain]['vertices'] and not nodes[chain]['flags'] & 0x21):
                raise Refused('Mixed CSG semantics in coplanar list')
        stack.extend(c for c in n['children'] if c != -1)
    return seen


def leaf_cells(nodes, root, outside, cell, budget=None, volumes_only=False):
    """Exhaustive BSP leaves clipped to a caller-supplied bounded convex cell.

    children are [front, back, coplanar]; zones/leaves arrays use SDK [back,front].
    The caller must independently prove this bounded cell covers its edit scope.
    """
    # Native point-region classification only visits front/back of chain heads.
    # A zone-only caller may defer coplanar surface agreement to another guard.
    # Structural children/cycles/finite planes are still validated in that mode.
    validate_links(nodes, root, volumes_only=volumes_only)
    if outside not in (False, True, 0, 1) or not full_dimension(cell):
        raise Refused('Invalid root classification or bounded scope')
    budget = budget or Budget()
    result, stack = [], [(root, bool(outside), cell, ())]
    while stack:
        i, out, part, path = stack.pop()
        n = nodes[i]
        negative, positive = split_convex(part, n['plane'], budget)
        csg = n['vertices'] > 0 and not n['flags'] & 0x21
        for side, piece in ((0, positive), (1, negative)):
            if not piece:
                continue
            child = n['children'][side]
            next_out = (out or csg) if side == 0 else (out and not csg)
            next_path = path + ((i, side),)
            if child != -1:
                stack.append((child, next_out, piece, next_path))
            else:
                budget.fragment()
                result.append(dict(cell=piece, outside=next_out, node=i, side=side, path=next_path,
                                   zone=n.get('zones', [None, None])[1-side],
                                   leaf=n.get('leaves', [None, None])[1-side]))
    return result


def certify_leaf_csg(nodes, root, root_outside, scope, brushes, source_root_outside, budget=None):
    """Prove every nonzero-volume fragment of every candidate leaf matches CSG.

    brushes: ordered {'name', 'operation':1(add)/2(subtract), 'planes':outward}.
    Unsupported flags, invalid fields and resource exhaustion refuse. A return
    value certifies volumetric geometry only, never native collision caches.
    """
    budget = budget or Budget()
    if source_root_outside not in (0, 1, False, True):
        raise Refused('Unknown source root state')
    for b in brushes:
        if b.get('operation') not in (1, 2) or b.get('flags', 0) != 0:
            raise Refused('Only ordinary solid additive/subtractive convex brushes are supported')
        if not b.get('planes'):
            raise Refused('Missing brush planes')
    if any(n['flags'] & 0xE7 for n in nodes.values()):
        raise Refused('Non-ordinary BSP semantics require a separate certificate')
    leaves = leaf_cells(nodes, root, root_outside, scope, budget)
    comparisons = 0
    for leaf in leaves:
        states = [(leaf['cell'], bool(source_root_outside), ())]
        for brush in brushes:
            updated = []
            for region, outside, lineage in states:
                pieces, inside = partition_brush(region, brush['planes'], budget)
                updated.extend((p, outside, lineage) for p in pieces)
                if inside:
                    budget.fragment()
                    updated.append((inside, brush['operation'] == 2, lineage+(brush['name'],)))
            states = updated
        for fragment, outside, lineage in states:
            comparisons += 1
            if outside != leaf['outside']:
                raise Refused('Volumetric CSG mismatch at leaf '+str((leaf['node'], leaf['side']))+' after '+str(lineage)+'; positive volume='+str(volume(fragment)))
    return dict(volumetric_geometry='certified_exact_within_bounded_scope', leaves=len(leaves),
                fragments_compared=comparisons, splits=budget.splits,
                native_collision='unverified', publication_authorized=False)
