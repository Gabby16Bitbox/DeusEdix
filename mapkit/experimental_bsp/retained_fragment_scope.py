"""Locate retained polygon fragments entering a proposed replacement cell.

Legacy compiled vertices can cross their own BSP ancestor plane. Replacing
only the mathematical subtree can then overlap a polygon retained outside it.
This helper changes scope, never a polygon or a tolerance. The caller must
replan and validate from the returned ancestor, including every portal gate.
"""
import math


def retained_intrusions(data, owned, planes, vertices, epsilon):
    """Conservative geometric witnesses; exact identity/indices are retained."""
    if not planes:
        return []
    if not math.isfinite(epsilon) or epsilon < 0:
        raise ValueError('Invalid scope precision')
    def distance(v, p):
        return sum(v[k]*p[k] for k in range(3))-p[3]
    def clip(ring, plane):
        if not ring:
            return []
        result = []
        a = ring[-1]
        da = distance(a, plane)
        if abs(da) <= epsilon:
            da = 0.
        for b in ring:
            db = distance(b, plane)
            if abs(db) <= epsilon:
                db = 0.
            if (da >= 0) != (db >= 0):
                t = da/(da-db)
                result.append(tuple(a[k]+t*(b[k]-a[k]) for k in range(3)))
            if db >= 0:
                result.append(b)
            a, da = b, db
        return result
    witnesses = []
    for index, p in enumerate(data['polys']):
        if index in owned or int(p[6]) == 0:
            continue
        if index not in data['nodes']:
            raise ValueError('Incomplete polygon/node mapping')
        ring = vertices(p)
        if len(ring) < 3 or any(not math.isfinite(x) for v in ring for x in v):
            raise ValueError('Malformed retained polygon')
        if any(max(distance(v, plane) for v in ring) < -epsilon for plane in planes):
            continue
        for plane in planes:
            ring = clip(ring, plane)
        if len(ring) < 3:
            continue
        # Boundary-only faces belong to an ancestor, as in the ordinary local
        # compiler; they do not establish an interior overlap.
        margins = [max(distance(v, plane) for v in ring) for plane in planes]
        if any(margin <= epsilon for margin in margins):
            continue
        origin = ring[0]
        area = [0., 0., 0.]
        for i in range(1, len(ring)-1):
            a = [ring[i][k]-origin[k] for k in range(3)]
            b = [ring[i+1][k]-origin[k] for k in range(3)]
            c = (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
            area = [x+y for x, y in zip(area, c)]
        if not any(area):
            continue
        witnesses.append(dict(node=index, source=data['nodes'][index]['actor'],
                              clipped_vertices=ring, interior_margins=margins))
    return witnesses


def enclosing_ancestor(data, root, witnesses, node_limit=1024):
    """Unique smallest tree ancestor; no guessed sequence of expansions."""
    if not isinstance(node_limit, int) or isinstance(node_limit, bool) or node_limit < 1:
        raise ValueError('Invalid local scope limit')
    parents = {0:None}
    for index, node in data['nodes'].items():
        for child in node['children']:
            if child < 0:
                continue
            if child not in data['nodes'] or child in parents:
                raise ValueError('Malformed BSP parentage')
            parents[child] = index
    if set(parents) != set(data['nodes']):
        raise ValueError('Disconnected BSP')
    def chain(index):
        seen = []
        while index is not None:
            if index not in parents or index in seen:
                raise ValueError('Cyclic BSP')
            seen.append(index)
            index = parents[index]
        return seen
    ancestors = chain(root)
    common = set(ancestors)
    for witness in witnesses:
        common.intersection_update(chain(witness['node']))
    chosen = next(index for index in ancestors if index in common)
    if chosen == 0:
        raise ValueError('Crossing retained fragments reach world root')
    included = set()
    stack = [chosen]
    while stack:
        index = stack.pop()
        if index in included:
            raise ValueError('Cyclic BSP')
        included.add(index)
        stack.extend(c for c in data['nodes'][index]['children'] if c >= 0)
    if len(included) > node_limit:
        raise ValueError('Crossing retained fragments exceed local scope limit')
    return dict(root=chosen, expand_parents=ancestors.index(chosen), nodes=len(included),
                witnesses=witnesses, proof='Every reported retained fragment enters the proposed cell; scope is their unique lowest common ancestor.')
