"""Offline-only proof of side-zone labels against exact convex leaf boundaries.

This does not mutate the native model or relax the production candidate gates.
Every projected face side must be completely covered by leaf interfaces and
touch one unique zone; otherwise it requires subdivision and is rejected.
"""
from collections import defaultdict
from convex_cells import Refused, native_float, vertices, dot
from zone_connectivity import plane_key, projected, cross2, area2


def intersection_area2(a, b, p):
    subject, clip = projected(a, p), projected(b, p)
    for c, d in zip(clip, clip[1:]+clip[:1]):
        if not subject:
            return 0
        out = []
        x = subject[-1]
        dx = cross2(c, d, x)
        for y in subject:
            dy = cross2(c, d, y)
            if (dx < 0 < dy) or (dy < 0 < dx):
                t = dx/(dx-dy)
                out.append(tuple(x[k]+t*(y[k]-x[k]) for k in range(2)))
            if dy >= 0:
                out.append(y)
            x, dx = y, dy
        subject = list(dict.fromkeys(out))
    return abs(area2(subject)) if subject else 0


def project_face_footprint(face, plane):
    """Lift the exact dominant-axis footprint onto the BSP partition plane.

    FBspNode vertices can be slightly off their stored float32 plane. Moving
    along its normal would also change the two coordinates used for all area
    calculations, inventing small strips across a retained boundary. Preserve
    those coordinates exactly and solve only the dominant coordinate instead.
    This is analytical ownership only; native vertices remain unchanged.
    """
    axis = max(range(3), key=lambda k:abs(plane[k]))
    if not plane[axis]:
        raise Refused('A face has no nonzero partition normal')
    return [tuple((plane[3]-sum(v[j]*plane[j] for j in range(3) if j != axis))/plane[axis]
                  if k == axis else v[k] for k in range(3)) for v in face]


def side_labels(nodes, polygons, leaves):
    boundaries = defaultdict(list)
    volumes = []
    for leaf in leaves:
        vv = vertices(leaf['cell'])
        center = tuple(sum(v[k] for v in vv)/len(vv) for k in range(3))
        planes = []
        for face in leaf['cell']:
            fp = plane_key(face)
            boundaries[fp].append((leaf, face, center))
            if dot(center, fp[:3]) > fp[3]:
                fp = tuple(-x for x in fp)
            planes.append(fp)
        volumes.append((leaf, vv, planes, tuple(min(v[k] for v in vv) for k in range(3)), tuple(max(v[k] for v in vv) for k in range(3))))
    # The head defines volume. iPlane records are render surfaces, even where
    # their stored planes differ slightly due to native float normalization.
    head = {i:i for i in nodes}
    chained = {n['children'][2] for n in nodes.values() if n['children'][2] >= 0}
    for i, n in nodes.items():
        if i in chained:
            continue
        c = n['children'][2]
        while c >= 0:
            head[c] = i
            c = nodes[c]['children'][2]
    result = {}
    errors = []
    for i, n in nodes.items():
        if not n['vertices']:
            result[i] = [0, 0]
            continue
        p = nodes[head[i]]['plane']
        # This projection is for analytical ownership only; vertices are never
        # changed. The separate geometry gate owns SDK plane-distance bounds.
        face = project_face_footprint(polygons[i], p)
        key = plane_key(face)
        target = abs(area2(projected(face, key)))
        areas = [0, 0]
        zones = [set(), set()]
        low = tuple(min(v[k] for v in face) for k in range(3))
        high = tuple(max(v[k] for v in face) for k in range(3))
        for leaf, vv, planes, ll, hh in volumes:
            if any(high[k] < ll[k] or low[k] > hh[k] for k in range(3)):
                continue
            cut = face
            for fp in planes:
                if not cut:
                    break
                out = []
                x = cut[-1]
                dx = dot(x, fp[:3])-fp[3]
                for y in cut:
                    dy = dot(y, fp[:3])-fp[3]
                    if (dx < 0 < dy) or (dy < 0 < dx):
                        t = dx/(dx-dy)
                        out.append(tuple(x[k]+t*(y[k]-x[k]) for k in range(3)))
                    if dy <= 0:
                        out.append(y)
                    x, dx = y, dy
                cut = list(dict.fromkeys(out))
            a = abs(area2(projected(cut, key))) if cut else 0
            if not a:
                continue
            dd = [dot(v, p[:3])-p[3] for v in vv]
            sides = ([0] if min(dd) < 0 else [])+([1] if max(dd) > 0 else [])
            for side in sides:
                areas[side] += a
                zones[side].add(leaf['assigned_zone'] if leaf['outside'] else 0)
        positive = [z-{0} for z in zones]
        if areas != [target, target] or any(len(z) > 1 for z in positive):
            errors.append({'node':i, 'head':head[i], 'coverage':[float(a/target) for a in areas],
                           'zones':[sorted(z) for z in zones]})
        else:
            result[i] = [next(iter(z)) if z else 0 for z in positive]
    return {'labels':result, 'errors':errors}
