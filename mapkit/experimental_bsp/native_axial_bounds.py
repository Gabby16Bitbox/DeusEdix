"""Necessary bound-encoding proof for the installed editor's axial hull cap.

This is NOT a query-domain restriction, a standalone collision certificate, or
a general emulation of bspBuildBounds. Its caller first verifies all ordered
hull planes against the complete solid terminal ancestry. Source/CSG, native
routing, region ownership, caches and serialization require separate gates.
"""
from fractions import Fraction
import hashlib
from pathlib import Path

from convex_cells import Refused, plane, q

EDITOR_SHA256 = '93e31b3e401880ab17ab4561c3fd4d2baa530fbe25ccb5154911ebad60fff035'
NATIVE_SEED_HALF_SIZE = 32768


def verify_editor(editor_path):
    try:
        digest = hashlib.sha256(Path(editor_path).read_bytes()).hexdigest()
    except (OSError, TypeError, ValueError) as error:
        raise Refused('Missing native bounds-builder identity') from error
    if digest != EDITOR_SHA256:
        raise Refused('Unsupported native bounds-builder implementation')
    return digest


def axial_cap_bounds(data, terminal):
    """Expected six floats for one unbounded integral axial solid terminal.

    All ancestors must use unit axial predicates at integral coordinates
    strictly inside the native seed cube. Surface Base/Normal are checked
    separately: FilterBound calls FPoly::SplitWithPlane using these fields,
    while LeafHulls later references the node's stored Plane. No geometric
    vertex, UV value, bound or plane is changed by this verifier.
    """
    if terminal.get('outside') is not False or terminal.get('side') != 1:
        raise Refused('Axial cap requires a solid back terminal')
    path = terminal.get('path')
    if not path or path[0][0] != 0 or len(path) > 128:
        raise Refused('Missing complete axial cap ancestry')
    low = [None]*3
    high = [None]*3
    seen = set()
    for position, (index, side) in enumerate(path):
        if type(index) is not int or type(side) is not int or side not in (0, 1) or index in seen:
            raise Refused('Malformed axial cap ancestry')
        seen.add(index)
        n = data['nodes'].get(index)
        if n is None or n['flags'] != 0 or not 3 <= n['vertices'] <= 24:
            raise Refused('Axial cap requires ordinary structural ancestors')
        child = n['children'][side]
        if (position+1 < len(path) and child != path[position+1][0]) or (position+1 == len(path) and child != -1):
            raise Refused('Axial cap ancestry does not reach its terminal')
        p = plane(n['plane'])
        axes = [k for k in range(3) if p[k]]
        if len(axes) != 1 or abs(p[axes[0]]) != 1:
            raise Refused('Native cap proof currently requires unit axial ancestry')
        axis = axes[0]
        coordinate = p[3]/p[axis]
        if coordinate.denominator != 1 or not -NATIVE_SEED_HALF_SIZE < coordinate < NATIVE_SEED_HALF_SIZE:
            raise Refused('Native axial cut is not an interior integral seed coordinate')
        s = data['surfs'].get(n['surf'])
        if (s is None or len(s['base']) != 3 or len(s['normal']) != 3 or
                tuple(q(v) for v in s['normal']) != p[:3] or
                tuple(q(v) for v in s['base'])[axis] != coordinate):
            raise Refused('Bounds-builder surface predicate differs from node Plane')
        # FilterBound selects front/back using the same oriented spatial link.
        sign = p[axis] if side == 1 else -p[axis]
        if sign > 0:
            high[axis] = coordinate if high[axis] is None else min(high[axis], coordinate)
        else:
            low[axis] = coordinate if low[axis] is None else max(low[axis], coordinate)
    if path[-1] != (terminal.get('node'), terminal.get('side')):
        raise Refused('Axial cap terminal identity mismatch')
    if all(v is not None for v in low+high):
        raise Refused('Axial cap fallback only applies to truly unbounded leaves')
    capped_low = tuple(Fraction(-NATIVE_SEED_HALF_SIZE) if v is None else v for v in low)
    capped_high = tuple(Fraction(NATIVE_SEED_HALF_SIZE) if v is None else v for v in high)
    if any(a >= b for a, b in zip(capped_low, capped_high)):
        raise Refused('Empty or lower-dimensional native cap')
    return capped_low+capped_high


def certify_axial_cap(data, terminal, hull, *, editor_path):
    editor_sha = verify_editor(editor_path)
    if hull.get('node') != terminal.get('node'):
        raise Refused('Native axial hull ownership differs from terminal')
    expected = axial_cap_bounds(data, terminal)
    if tuple(hull['bounds']) != expected:
        raise Refused('Native axial capped bounds differ from seed/ancestry intersection')
    return dict(node=terminal['node'], bounds=[str(v) for v in expected],
        certificate='installed_editor_integral_axial_seed_cube_bound_encoding',
        editor_sha256=editor_sha, native_seed_half_size=NATIVE_SEED_HALF_SIZE,
        query_domain_restricted=False, full_reference_used=False,
        scope='Necessary bounds gate only; complete source/routing/hull/scope proof remains mandatory')
