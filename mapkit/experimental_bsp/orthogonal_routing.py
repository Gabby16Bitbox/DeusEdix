"""Exhaustive, exact BSP routing comparison on a deliberately narrow class.

This is a proof about the SDK ChildOutside recurrence with explicit tie rules,
NOT a replacement for UE PointCheck/LineCheck or a map-publication certificate.
Every real point belongs to one Cartesian stratum induced by the axis planes.
All plane signs are constant on each stratum, including zero-dimensional ones.
Therefore one representative is exhaustive here, not sampled testing.

Unsupported flags, oblique/scaled normals, coplanar lists, malformed graphs and
resource exhaustion refuse. No tolerance, Full rebuild or native call is used.
"""
from collections import Counter
from fractions import Fraction
from itertools import product
import math
import struct


class Refused(ValueError):
    pass


def _integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise Refused('Missing or malformed integer metadata')
    return value


def _float32(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise Refused('Non-finite or malformed native coordinate')
    try:
        result = struct.unpack('<f', struct.pack('<f', value))[0]
    except (OverflowError, struct.error) as error:
        raise Refused('Invalid float32 coordinate') from error
    # Evidence must already be a reconstructed native float, never quietly
    # quantize a caller's edited coordinate into a passing native coordinate.
    if result != value or abs(result) > 2**20:
        raise Refused('Coordinate is not exact supported native float32')
    return Fraction(result)


def _model(data):
    if not isinstance(data, dict) or type(data.get('root_outside')) is not bool:
        raise Refused('Missing model or root classification')
    raw = data.get('nodes')
    if not isinstance(raw, dict) or not raw or len(raw) > 4096:
        raise Refused('Missing or excessive BSP nodes')
    if any(type(k) is not int for k in raw) or set(raw) != set(range(len(raw))):
        raise Refused('Node inventory is not contiguous')
    if data.get('root') != 0 or type(data.get('root')) is not int:
        raise Refused('Only a complete root-zero BSP is supported')
    nodes = {}
    cuts = [set(), set(), set()]
    for i, n in raw.items():
        if not isinstance(n, dict):
            raise Refused('Malformed node')
        p = n.get('plane')
        if not isinstance(p, (list, tuple)) or len(p) != 4:
            raise Refused('Missing plane')
        p = tuple(_float32(v) for v in p)
        axes = [k for k in range(3) if p[k]]
        if len(axes) != 1 or abs(p[axes[0]]) != 1:
            raise Refused('Only exact axis-aligned unit planes are supported')
        axis = axes[0]
        children = n.get('children')
        if not isinstance(children, (list, tuple)) or len(children) != 3:
            raise Refused('Missing BSP children')
        children = tuple(_integer(v, -1, len(raw)-1) for v in children)
        if children[2] != -1:
            raise Refused('Coplanar chains require a separate semantics proof')
        count = _integer(n.get('vertices'), 0, 24)
        if count not in (0, *range(3, 25)):
            raise Refused('Invalid native node vertex count')
        flags = _integer(n.get('flags'), 0, 255)
        if flags not in (0, 1):
            raise Refused('Unsupported BSP semantic flags')
        zones = n.get('zones')
        if not isinstance(zones, (list, tuple)) or len(zones) != 2:
            raise Refused('Missing SDK back/front leaf zones')
        zones = tuple(_integer(v, 0, 63) for v in zones)
        nodes[i] = dict(plane=p, axis=axis, coordinate=p[3]/p[axis],
                        children=children, csg=count > 0 and not flags & 1,
                        zones=zones)
        cuts[axis].add(p[3]/p[axis])
    seen = set()
    stack = [0]
    while stack:
        i = stack.pop()
        if i in seen:
            raise Refused('Cycle or shared BSP child')
        seen.add(i)
        stack.extend(v for v in nodes[i]['children'][:2] if v >= 0)
    if seen != set(nodes):
        raise Refused('Unreachable nodes in complete model evidence')
    return nodes, cuts, data['root_outside']


def _atoms(cuts):
    cuts = sorted(cuts)
    if not cuts:
        return [(Fraction(0), 1, 'all real coordinates')]
    out = [(cuts[0]-1, 1, 'below '+str(cuts[0]))]
    for index, value in enumerate(cuts):
        out.append((value, 0, 'equal '+str(value)))
        if index+1 < len(cuts):
            out.append(((value+cuts[index+1])/2, 1,
                        'between '+str(value)+' and '+str(cuts[index+1])))
    out.append((cuts[-1]+1, 1, 'above '+str(cuts[-1])))
    return out


def _route(nodes, outside, point, ties_front):
    i = 0
    path = []
    while True:
        node = nodes[i]
        p = node['plane']
        d = p[node['axis']]*point[node['axis']]-p[3]
        front = d > 0 or d == 0 and ties_front
        side = 0 if front else 1  # serializer order: front, back, coplanar
        outside = outside or node['csg'] if front else outside and not node['csg']
        path.append((i, 'front' if front else 'back', str(d)))
        child = node['children'][side]
        if child == -1:
            return (outside, node['zones'][1-side]), path
        i = child


def compare(left, right, *, max_strata=200000):
    """Compare classifications AND terminal zone for all real point strata.

    Both global tie conventions are required to agree; this does not assert
    which one any particular native routine uses, or certify its epsilon tests.
    A successful return always leaves publication_authorized and full_removable
    false. Finite polygon surfaces, hulls, bounds, render/zone caches, native
    trace tie breaking/backoff, source CSG fidelity and ownership are unproved.
    """
    if type(max_strata) is not int or max_strata <= 0:
        raise Refused('Invalid exact partition budget')
    ln, lc, lo = _model(left)
    rn, rc, ro = _model(right)
    axes = [_atoms(lc[k] | rc[k]) for k in range(3)]
    total = math.prod(len(a) for a in axes)
    if total > max_strata:
        raise Refused('Exact Cartesian partition exceeds resource budget')
    dimensions = Counter()
    for atoms in product(*axes):
        p = tuple(a[0] for a in atoms)
        dimension = sum(a[1] for a in atoms)
        dimensions[dimension] += 1
        for tie in (False, True):
            ls, lp = _route(ln, lo, p, tie)
            rs, rp = _route(rn, ro, p, tie)
            if ls != rs:
                error = Refused('Exact routing or zone mismatch on dimension '+str(dimension))
                error.witness = dict(point=[str(v) for v in p], dimension=dimension,
                                     strata=[a[2] for a in atoms], ties_front=tie,
                                     left=list(ls), right=list(rs), left_path=lp, right_path=rp)
                raise error
    return dict(status='pass', certificate='exact_orthogonal_sdk_recurrence_all_point_strata',
                strata=total, dimension_counts=dict(sorted(dimensions.items())),
                tie_conventions_checked=['zero_to_back', 'zero_to_front'],
                source_csg='unverified', polygon_surfaces='unverified',
                native_collision='unverified', native_rounding='not_modelled',
                hulls_bounds_and_zone_cache='unverified', outside_ownership='unverified',
                full_removable=False, publication_authorized=False)
