"""Complete native hull/solid-leaf consistency, independent of Full and probes.

This is one necessary gate, NOT a source-CSG or publication certificate. The
caller must additionally prove complete source occupancy (including strata),
surface coverage, region locality and zone/cache preservation. New hull bounds
must equal exactly representable extrema. Unbounded legacy hull bounds are
accepted only when their entire ordered plane/bounds record is unchanged from
Original. No ideal-Minkowski claim is made about the installed UE collider.
"""
from collections import Counter
from fractions import Fraction
import hashlib
import math
from pathlib import Path
import struct

from convex_cells import Refused, q, plane, bounded_cell, vertices, native_float

from native_engines import KNOWN as KNOWN_ENGINES


def verify_engine(engine_path):
    try:
        digest = hashlib.sha256(Path(engine_path).read_bytes()).hexdigest()
    except (OSError, TypeError, ValueError) as error:
        raise Refused('Missing native engine identity') from error
    if digest not in KNOWN_ENGINES:
        raise Refused('Unsupported native collision implementation')
    return digest


def _feasible(rows, limit=50000):
    """Exact Fourier-Motzkin with open as well as closed inequalities."""
    rows = [(tuple(q(v) for v in p), bool(strict)) for p, strict in rows]
    for count in range(3, 0, -1):
        reduced = {}
        for p, strict in rows:
            if not any(p[:-1]):
                if p[-1] < 0 or (strict and p[-1] == 0):
                    return False
                continue
            scale = abs(next(v for v in p[:-1] if v))
            key = tuple(v / scale for v in p)
            reduced[key] = reduced.get(key, False) or strict
        rows = list(reduced.items())
        if not rows:
            return True
        axis = min(range(count), key=lambda k: sum(p[k] > 0 for p, s in rows)*sum(p[k] < 0 for p, s in rows))
        positive = [(p, s) for p, s in rows if p[axis] > 0]
        negative = [(p, s) for p, s in rows if p[axis] < 0]
        new = [(p[:axis]+p[axis+1:], s) for p, s in rows if p[axis] == 0]
        if len(positive)*len(negative)+len(new) > limit:
            raise Refused('Hull implication complexity budget exceeded')
        for a, sa in positive:
            for b, sb in negative:
                new.append((tuple(q(a[k]/a[axis]-b[k]/b[axis]) for k in range(count+1) if k != axis), sa or sb))
        rows = new
    return all(p[0] > 0 if strict else p[0] >= 0 for p, strict in rows)


def implies(halfspaces, target):
    target = plane(target)
    if target in halfspaces:
        return True
    # H implies n.x<=w iff H intersect n.x>w is infeasible. Strictness matters:
    # treating the violation as >= would reject legal shared boundaries.
    return not _feasible([(plane(p), False) for p in halfspaces]+[(tuple(-v for v in target), True)])


def terminal_inventory(data):
    """All front/back terminals, without clipping away zero-volume strata."""
    nodes = data['nodes']
    if set(nodes) != set(range(len(nodes))) or not nodes or data['root_outside'] not in (0, 1):
        raise Refused('Incomplete native partition')
    seen = set()
    result = []
    stack = [(0, bool(data['root_outside']), ())]
    while stack:
        i, out, path = stack.pop()
        if i in seen or i not in nodes:
            raise Refused('Invalid, shared or cyclic partition')
        seen.add(i)
        n = nodes[i]
        plane(n['plane'])
        if n['flags'] != 0 or n['vertices'] < 3 or n['vertices'] > 24:
            raise Refused('Native hull proof currently requires ordinary solid nodes')
        if len(n['children']) != 3:
            raise Refused('Malformed native BSP children')
        # Collision routing visits the head's front/back children. Accept only
        # inert, exactly equal-plane solid render fragments in its iPlane list.
        # They cannot add a collider, a spatial child, or a distinct predicate.
        chain = n['children'][2]
        while chain != -1:
            if chain in seen or chain not in nodes:
                raise Refused('Invalid, shared or cyclic coplanar chain')
            seen.add(chain)
            linked = nodes[chain]
            if (linked['plane'] != n['plane'] or linked['flags'] != 0 or
                not 3 <= linked['vertices'] <= 24 or len(linked['children']) != 3 or
                linked['children'][:2] != [-1, -1] or linked['collision_bound'] != -1):
                raise Refused('Coplanar chain changes native collision semantics')
            chain = linked['children'][2]
        if len(path) >= 128:
            raise Refused('Native hull ancestry depth budget exceeded')
        for side in (0, 1):
            child = n['children'][side]
            next_path = path+((i, side),)
            next_out = (out or True) if side == 0 else False
            if child != -1:
                stack.append((child, next_out, next_path))
            else:
                halfspaces = tuple(tuple(-v for v in nodes[j]['plane']) if s == 0 else tuple(nodes[j]['plane']) for j, s in next_path)
                result.append(dict(node=i, side=side, outside=next_out, path=next_path, halfspaces=halfspaces))
    if seen != set(nodes):
        raise Refused('Unreachable native partition nodes')
    return result


def hull_inventory(data):
    records = {}
    occupied = set()
    for i, n in data['nodes'].items():
        start = n['collision_bound']
        if start == -1:
            continue
        if type(start) is not int or start < 0:
            raise Refused('Invalid native hull offset')
        cursor = start
        indices = []
        planes = []
        while data['hulls'].get(cursor, -2) >= 0:
            word = data['hulls'][cursor]
            if word > 0x7fffffff or len(indices) >= 64:
                raise Refused('Invalid or excessive native hull plane')
            index = word&~0x40000000
            flip = bool(word&0x40000000)
            if index not in data['nodes']:
                raise Refused('Native hull references a missing plane')
            p = plane(data['nodes'][index]['plane'])
            indices.append((index, flip))
            planes.append(tuple(-v for v in p) if flip else p)
            cursor += 1
        if not indices or data['hulls'].get(cursor) != -1 or any(cursor+k not in data['hulls'] for k in range(1, 7)):
            raise Refused('Truncated native hull record')
        words = tuple(data['hulls'][cursor+k] for k in range(1, 7))
        try:
            values = struct.unpack('<6f', struct.pack('<6i', *words))
        except (struct.error, OverflowError) as error:
            raise Refused('Invalid native hull bounds word') from error
        if not all(math.isfinite(v) for v in values):
            raise Refused('Non-finite native hull bounds')
        bounds = tuple(Fraction(v) for v in values)
        if any(bounds[k] >= bounds[k+3] for k in range(3)):
            raise Refused('Empty or inverted native hull bounds')
        span = set(range(start, cursor+7))
        if occupied&span:
            raise Refused('Aliased or overlapping native hull records')
        occupied |= span
        records[i] = dict(node=i, indices=tuple(indices), planes=tuple(planes), bounds=bounds, bound_words=words)
    return records, len(data['hulls'])-len(occupied)


def _validate_partition_hulls(data):
    terminals = terminal_inventory(data)
    hulls, unused = hull_inventory(data)
    solids = {(v['node'], v['side']):v for v in terminals if not v['outside']}
    if any(side != 1 for i, side in solids) or set(hulls) != {i for i, side in solids}:
        raise Refused('Native hull inventory does not cover every solid terminal exactly')
    for (i, side), leaf in solids.items():
        h = hulls[i]
        allowed = {(j, s == 0) for j, s in leaf['path']}
        if len(set(h['indices'])) != len(h['indices']) or not set(h['indices']) <= allowed:
            raise Refused('Native hull has a foreign, duplicate or incorrectly flipped ancestry plane')
        ordered = [(j, s == 0) for j, s in leaf['path']]
        positions = [ordered.index(p) for p in h['indices']]
        if positions != sorted(positions):
            raise Refused('Native hull plane order does not follow BSP ancestry')
        if not _feasible([(p, False) for p in leaf['halfspaces']]):
            raise Refused('Unreachable solid terminal has a native collision hull')
        if any(not implies(h['planes'], p) for p in leaf['halfspaces']):
            raise Refused('Native hull omitted a necessary ancestry halfspace')
        # Reverse implication follows from literal oriented-ancestry membership.
    return terminals, hulls, unused


def _signature(h):
    return h['planes'], h['bound_words']


def certify_hulls(before, after, outside_mapping, *, engine_path, editor_path=None):
    """Check every collider and mapped exterior against the trusted Original.

    outside_mapping is old-index -> new-index, supplied by the independently
    validated region proof. This function checks its injectivity and referenced
    collider records; the caller must establish its completeness/topology.
    """
    engine_sha = verify_engine(engine_path)
    bt, bh, bu = _validate_partition_hulls(before)
    at, ah, au = _validate_partition_hulls(after)
    if not isinstance(outside_mapping, dict) or len(set(outside_mapping.values())) != len(outside_mapping):
        raise Refused('Invalid retained node mapping')
    for old, new in outside_mapping.items():
        if old not in before['nodes'] or new not in after['nodes']:
            raise Refused('Retained node mapping references missing nodes')
        if (old in bh) != (new in ah):
            raise Refused('Retained collision hull ownership changed')
        if old in bh and _signature(bh[old]) != _signature(ah[new]):
            raise Refused('Retained native hull plane order or bounds changed')
    original = {_signature(h) for h in bh.values()}
    preserved = []
    new = []
    capped = []
    after_solids = {t['node']:t for t in at if not t['outside']}
    for i, h in ah.items():
        if _signature(h) in original:
            preserved.append(i)
            continue
        try:
            cell = bounded_cell(h['planes'])
        except Refused:
            if editor_path is None:
                raise
            from native_axial_bounds import certify_axial_cap
            capped.append(certify_axial_cap(after, after_solids[i], h, editor_path=editor_path))
            continue
        vv = vertices(cell)
        expected = tuple(min(v[k] for v in vv) for k in range(3))+tuple(max(v[k] for v in vv) for k in range(3))
        if any(native_float(v) != v for v in expected):
            raise Refused('New hull extrema require an unproved float rounding model')
        if h['bounds'] != expected:
            raise Refused('New native hull bounds are not exact polyhedron extrema')
        new.append(dict(node=i, planes=len(h['planes']), bounds=[str(v) for v in expected]))
    return dict(status='pass', certificate='complete_native_hull_ancestry_and_exact_bounds',
                full_reference_used=False, probe_sampling_used=False, publication_authorized=False,
                engine_sha256=engine_sha,
                before_terminals=len(bt), after_terminals=len(at), before_hulls=len(bh), after_hulls=len(ah),
                exact_new_hulls=new, native_axial_capped_hulls=capped, preserved_original_hulls=preserved,
                retained_hulls=sum(i in bh for i in outside_mapping), unreferenced_hull_words=[bu, au],
                scope='ordinary structural BSP; exact-plane inert coplanars only; source/routing/scope gates required',
                collision_basis='installed native engine consumes verified ordered planes and raw bounds; no ideal Minkowski or Full equivalence claim')


def verify_reload(after, reloaded):
    # CERT2 contains only observable semantic/native data, no object addresses.
    if after != reloaded:
        raise Refused('Native certificate changed during save/reload')
    return dict(status='pass', native_certificate_exact=True)
