"""Closed, including lower-dimensional, Original BSP domain certificate.

All active divisions must be exact native unit-axis predicates. Oblique nodes
may only prune a complete bounded interval box when their sign is separated
by a conservative x87 gamma6/PC24 rounding bound. No zero-volume strata are
discarded. Native profile verification is a mandatory separate wrapper gate.
"""
from itertools import product
import convex_cells as c
from stratified_csg import X87_GAMMA6

Refused = c.Refused


def _axis(plane):
    axes = [k for k in range(3) if plane[k]]
    return axes[0] if len(axes) == 1 and abs(plane[axes[0]]) == 1 else None


def _intervals(lo, hi):
    lo, hi = c.point(lo), c.point(hi)
    if any(a > b for a, b in zip(lo, hi)):
        raise Refused('Invalid closed domain')
    return tuple((a, b, True, True) for a, b in zip(lo, hi))


def _bound(box, axis, coordinate, lower, closed):
    lo, hi, lc, hc = box[axis]
    if lower:
        if coordinate > lo:
            lo, lc = coordinate, closed
        elif coordinate == lo:
            lc = lc and closed
    else:
        if coordinate < hi:
            hi, hc = coordinate, closed
        elif coordinate == hi:
            hc = hc and closed
    if lo > hi or (lo == hi and not(lc and hc)):
        return None
    result = list(box)
    result[axis] = (lo, hi, lc, hc)
    return tuple(result)


def _axis_parts(box, p, tie_front):
    axis = _axis(p)
    coordinate = p[3]/p[axis]
    # Front is positive (and optionally zero); back is negative. Even a
    # singleton boundary is retained, and never counted as empty volume.
    return ((0, _bound(box, axis, coordinate, p[axis] > 0, tie_front)),
            (1, _bound(box, axis, coordinate, p[axis] < 0, not tie_front)))


def _oblique_side(box, p):
    minimum = -p[3]
    maximum = -p[3]
    magnitude = abs(p[3])
    for k, (lo, hi, _, _) in enumerate(box):
        terms = (p[k]*lo, p[k]*hi)
        minimum += min(terms)
        maximum += max(terms)
        magnitude += abs(p[k])*max(abs(lo), abs(hi))
    error = X87_GAMMA6*magnitude
    if minimum > error:
        return 0
    if maximum < -error:
        return 1
    raise Refused('A nonaxial native predicate intersects or is uncertain in the closed domain')


def _corners(box):
    return tuple(product(*[(lo, hi) for lo, hi, _, _ in box]))


def _allowed_boundary(box, faces):
    for normal, ring in faces:
        normal = c.point(normal)
        ring = tuple(c.point(v) for v in ring)
        if len(ring) < 3:
            raise Refused('Invalid finite boundary witness')
        w = c.dot(normal, ring[0])
        p = normal+(w,)
        axis = _axis(p)
        if axis is None:
            raise Refused('Boundary witness is not unit axial')
        lo, hi, _, _ = box[axis]
        if lo != hi or normal[axis]*lo != w:
            continue
        inside = True
        for a, b in zip(ring, ring[1:]+ring[:1]):
            edge = c.sub(b, a)
            inward = c.cross(normal, edge)
            if any(c.dot(inward, c.sub(v, a)) < 0 for v in _corners(box)):
                inside = False
                break
        if inside:
            return True
    return False


def certify_closed_domain(data, lo, hi, neutral_actor=None, allowed_boundaries=(), max_steps=20000, extra_flags=0):
    """Every closed stratum must be solid, or an explicit finite support face.

    Both deterministic zero tie conventions are checked. The real PointRegion
    implementation uses front on zero; the second convention is an additional
    conservative boundary check, not a claim about its implementation.
    """
    if data.get('root_outside') not in (0, 1) or 0 not in data.get('nodes', {}):
        raise Refused('Invalid original model')
    if extra_flags not in (0, 4):
        raise Refused('Unsupported routing predicate')
    original = _intervals(lo, hi)
    counts = []
    allvisited = set()
    for tie in (True, False):
        stack = [(0, bool(data['root_outside']), original, ())]
        steps = terminals = air = degenerate = 0
        while stack:
            index, outside, box, path = stack.pop()
            if index == -1:
                terminals += 1
                degenerate += any(a == b for a, b, _, _ in box)
                if outside:
                    if not _allowed_boundary(box, allowed_boundaries):
                        error = Refused('Unaccounted air stratum in the closed source domain')
                        error.witness = dict(box=box, path=path, tie_front=tie)
                        raise error
                    air += 1
                continue
            if index in path:
                raise Refused('Cyclic original branch')
            n = data['nodes'].get(index)
            if n is None or len(n['children']) != 3 or n['flags']&~31 or not 0 <= n['vertices'] <= 24 or len(n['points']) != n['vertices']:
                raise Refused('Unsupported original routing record')
            surf = data['surfs'].get(n['surf'])
            if surf is None:
                raise Refused('Missing original native surface')
            p = c.plane(n['plane'])
            steps += 1
            allvisited.add(index)
            if steps > max_steps:
                raise Refused('Closed source domain budget exceeded')
            csg = n['vertices'] > 0 and not(n['flags']&(1|extra_flags)) and surf['actor'] != neutral_actor
            branches = _axis_parts(box, p, tie) if _axis(p) is not None else ((_oblique_side(box, p), box),)
            for side, part in branches:
                if part is None:
                    continue
                child = n['children'][side]
                if type(child)is not int or child < -1:
                    raise Refused('Malformed original child')
                child_out = (outside or csg) if side == 0 else (outside and not csg)
                stack.append((child, child_out, part, path+(index,)))
        counts.append(dict(tie_front=tie, terminal_strata=terminals, finite_support_air_strata=air, lower_dimensional_strata=degenerate))
    return dict(status='pass', method='closed interval partition; exact unit-axis native cuts; gamma6 oblique pruning',
                tie_policies=counts, visited_nodes=len(allvisited), profile_required=True)
