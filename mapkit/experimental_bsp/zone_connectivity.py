"""Positive-area adjacency witnesses between exact convex empty BSP leaves.

Finite witness cells may establish connectivity of unbounded leaves. They may
never establish its absence or omit an unwitnessed structural empty leaf.
"""
from collections import defaultdict
from fractions import Fraction
from convex_cells import Refused, cross, dot, sub


def plane_key(face):
    if len(face) < 3:
        raise Refused('Degenerate connectivity face')
    normal = next((cross(sub(face[i], face[0]), sub(face[j], face[0]))
                   for i in range(1, len(face)) for j in range(i+1, len(face))
                   if any(cross(sub(face[i], face[0]), sub(face[j], face[0])))), None)
    if normal is None:
        raise Refused('Collinear connectivity face')
    p = normal + (dot(normal, face[0]),)
    scale = next(x for x in normal if x)
    p = tuple(x/scale for x in p)
    if any(dot(p[:3], v) != p[3] for v in face):
        raise Refused('Nonplanar connectivity face')
    return p


def cross2(a, b, c):
    return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])


def area2(poly):
    return sum(a[0]*b[1]-a[1]*b[0] for a, b in zip(poly, poly[1:]+poly[:1]))


def projected(face, p):
    drop = max(range(3), key=lambda i: abs(p[i]))
    axes = [i for i in range(3) if i != drop]
    result = [(v[axes[0]], v[axes[1]]) for v in face]
    if area2(result) < 0:
        result.reverse()
    return result


def positive_overlap(a, b, p):
    subject, clip = projected(a, p), projected(b, p)
    if not area2(subject) or not area2(clip):
        raise Refused('Zero-area connectivity face')
    for c, d in zip(clip, clip[1:]+clip[:1]):
        if not subject:
            return False
        out = []
        x = subject[-1]; dx = cross2(c, d, x)
        for y in subject:
            dy = cross2(c, d, y)
            if (dx < 0 < dy) or (dy < 0 < dx):
                t = dx/(dx-dy)
                out.append(tuple(x[k]+t*(y[k]-x[k]) for k in range(2)))
            if dy >= 0:
                out.append(y)
            x, dx = y, dy
        subject = list(dict.fromkeys(out))
    return bool(subject and area2(subject) > 0)


def connectivity_witness(cells, pair_budget=200000):
    """Require every supplied convex leaf in one positive-area component."""
    if not cells:
        raise Refused('No empty cells to connect')
    groups = defaultdict(list)
    for i, cell in enumerate(cells):
        for face in cell:
            groups[plane_key(face)].append((i, face))
    parent = list(range(len(cells)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    pairs = joins = 0
    for p, faces in groups.items():
        for x, (i, a) in enumerate(faces):
            for j, b in faces[x+1:]:
                if root(i) == root(j):
                    continue
                pairs += 1
                if pairs > pair_budget:
                    raise Refused('Connectivity face-pair budget exceeded')
                if positive_overlap(a, b, p):
                    parent[root(j)] = root(i)
                    joins += 1
    components = len({root(i) for i in range(len(cells))})
    if components != 1:
        raise Refused('Replacement empty leaves are not witnessed as one positive-area connected region (%d components)' % components)
    return {'components': components, 'leaves': len(cells), 'face_pairs': pairs,
            'positive_area_joins': joins,
            'method': 'exact rational polygon overlap; shared edges/points do not connect'}
