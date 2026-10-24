"""Append-only render-ring storage and shared-side invalidation certificate.

Independent source geometry and renderer bounds are deliberately separate.
The native SDK defines iSide=INDEX_NONE (-1) for an unshared edge. New rings
must use that state instead of reusing cached intersections of changed edges.
"""
from hashlib import sha256


class Refused(ValueError):
    pass


def parse_vertex_pool(payload):
    try:
        rows = [r.split() for r in payload.decode('ascii').splitlines() if r.strip()]
        if len(rows) < 3 or rows[0] != ['VERTPOOL', '1'] or len(rows[1]) != 5 or rows[1][0] != 'M':
            raise Refused('Invalid vertex-pool evidence header')
        shared, nv, nn, np = map(int, rows[1][1:])
        if min(shared, nv, nn, np) < 0 or max(shared, nv, nn, np) > 10000000 or rows[-1] != ['END', str(nv), str(nn)]:
            raise Refused('Invalid vertex-pool counts or terminator')
        vertices = {}
        nodes = {}
        for row in rows[2:-1]:
            if len(row) != 4 or row[0] not in ('V', 'N'):
                raise Refused('Unexpected vertex-pool row')
            idx, a, b = map(int, row[1:])
            group = vertices if row[0] == 'V' else nodes
            if idx in group or idx < 0:
                raise Refused('Duplicate vertex-pool row')
            if row[0] == 'V':
                # Legacy pools contain stale, unreachable records. Preserve
                # every such word, but validate references only where a node
                # actually consumes the record; no old orphan may be reused.
                if not all(-2**31 <= v < 2**31 for v in (a, b)):
                    raise Refused('Invalid native vertex word')
            elif not 0 <= b <= 24 or (b and not 0 <= a <= nv-b):
                raise Refused('Invalid native ring range')
            group[idx] = (a, b)
        if set(vertices) != set(range(nv)) or set(nodes) != set(range(nn)):
            raise Refused('Incomplete native vertex inventory')
        for start, count in nodes.values():
            for index in range(start, start+count):
                point, side = vertices[index]
                if not 0 <= point < np or side < -1 or (side != -1 and side >= shared):
                    raise Refused('Invalid active point or shared-side reference')
        return dict(shared=shared, point_count=np, vertices=vertices, nodes=nodes)
    except (UnicodeError, AttributeError, ValueError, IndexError, TypeError) as error:
        if isinstance(error, Refused):
            raise
        raise Refused('Malformed vertex-pool evidence') from error


def certify_retained_vertex_pool(before_bytes, after_bytes, reloaded_bytes, targets):
    before = parse_vertex_pool(before_bytes)
    after = parse_vertex_pool(after_bytes)
    reload = parse_vertex_pool(reloaded_bytes)
    if after != reload:
        raise Refused('Vertex/side storage changed on save/reload')
    if before['shared'] != after['shared'] or before['nodes'].keys() != after['nodes'].keys():
        raise Refused('Shared-side count or native node inventory changed')
    targets = set(targets)
    if not targets or not targets <= before['nodes'].keys():
        raise Refused('Missing source-derived ring targets')
    old_count = len(before['vertices'])
    if after['point_count'] < before['point_count'] or any(after['vertices'].get(i) != v for i, v in before['vertices'].items()):
        raise Refused('Original vertex storage was changed or removed')
    used = set()
    points = set()
    for index, (start, count) in before['nodes'].items():
        new_start, new_count = after['nodes'][index]
        if index not in targets:
            if (start, count) != (new_start, new_count):
                raise Refused('An unselected ring changed its storage')
            continue
        if new_count != count or count < 3 or new_start < old_count:
            raise Refused('Selected ring count changed or aliases old storage')
        for i in range(new_start, new_start+count):
            if i in used or i not in after['vertices']:
                raise Refused('Selected rings alias or leave the native vertex pool')
            point, side = after['vertices'][i]
            if side != -1:
                raise Refused('Changed ring reused a shared-side cache identity')
            if point < before['point_count'] or point in points:
                raise Refused('Changed ring aliases an old/shared point entry')
            used.add(i)
            points.add(point)
    if used != set(after['vertices'])-set(before['vertices']):
        raise Refused('Extra or missing appended render vertices')
    return dict(status='pass', certificate='append_only_render_rings_unshared_sides',
                original_vertices=old_count, appended_vertices=len(used), changed_rings=len(targets),
                source_geometry_certified=False, renderer_bounds_certified=False, publication_authorized=False,
                evidence_sha256=[sha256(p).hexdigest() for p in (before_bytes, after_bytes, reloaded_bytes)])
