"""V2 research: ordered convex CSG, exact partial faces, no Full input.

This imports the frozen v1 arithmetic/routing kernel and adds independently
derived visible face pieces. It does not authorize publication by itself.
"""
from collections import Counter, defaultdict
from fractions import Fraction as F
from functools import lru_cache
from itertools import combinations
import convex_cells as c
import certificate_evidence as evidence
import stratified_csg as v1

Refused = c.Refused


def area(ring, normal):
    if len(ring) < 3:
        return F(0)
    return abs(sum(c.dot(c.cross(c.sub(ring[i], ring[0]), c.sub(ring[i+1], ring[0])), normal)
                   for i in range(1, len(ring)-1)))


def clip(ring, plane):
    if not ring:
        return ()
    out = []
    a = ring[-1]
    da = c.distance(a, plane)
    for b in ring:
        db = c.distance(b, plane)
        if (da < 0 < db) or (db < 0 < da):
            t = da/(da-db)
            out.append(tuple(a[k]+t*(b[k]-a[k]) for k in range(3)))
        if db <= 0:
            out.append(b)
        a, da = b, db
    dedup = []
    for p in out:
        if not dedup or p != dedup[-1]:
            dedup.append(p)
    if len(dedup) > 1 and dedup[0] == dedup[-1]:
        dedup.pop()
    return tuple(dedup)


def edge_planes(ring, normal):
    # Ring is oriented to normal. Interior lies left of every edge.
    for a, b in zip(ring, ring[1:]+ring[:1]):
        n = c.cross(c.sub(b, a), normal)
        yield n+(c.dot(n, a),)


def intersection(a, b, normal):
    out = a
    for p in edge_planes(b, normal):
        out = clip(out, p)
    return out


def difference(a, b, normal):
    remaining = a
    outside = []
    for p in edge_planes(b, normal):
        part = clip(remaining, tuple(-v for v in p))
        if area(part, normal):
            outside.append(part)
        remaining = clip(remaining, p)
        if not area(remaining, normal):
            break
    return outside


def covered(source, targets, normal, budget=20000):
    todo = list(source)
    for target in targets:
        todo = [part for p in todo for part in difference(p, target, normal)]
        if len(todo) > budget:
            raise Refused('Exact surface subtraction budget exceeded')
        if not todo:
            return True
    return not any(area(p, normal) for p in todo)


def geometric_plane(plane):
    """Geometric identity only; never used to merge native routing classifiers."""
    pivot = next(v for v in plane[:3] if v)
    return tuple(v/pivot for v in plane), 1 if pivot > 0 else -1


def sources(data):
    if data.get('root_outside') != 0 or not 2 <= len(data.get('brushes', [])) <= 24:
        raise Refused('Unsupported source inventory')
    brushes = {}
    previous = -1
    for b in data['brushes']:
        if b['order'] <= previous or b['name'] in brushes or not 4 <= len(b['faces']) <= 32:
            raise Refused('Source order/identity/count invalid')
        previous = b['order']
        evidence.source_convex_brush(b)
        for i, f in enumerate(b['faces']):
            if f['index'] != i or f['link'] != i or f['normal'] != f['plane'][:3]:
                raise Refused('Unsupported source face linkage')
            v1._ring(f['points'], f['plane'])
        pp = tuple(dict.fromkeys(v for f in b['faces'] for v in f['points']))
        if any(abs(x) > 16384 for p in pp for x in p):
            raise Refused('Source outside supported geometry bounds')
        brushes[b['name']] = dict(source=b, points=pp, planes=tuple(f['plane'] for f in b['faces']))
    def inside(a, b):
        return all(c.distance(v, p) < 0 and c.distance(v, p)**2 >= c.dot(p[:3], p[:3]) for v in a['points'] for p in b['planes'])
    rooms = {}
    for name, b in brushes.items():
        if b['source']['operation'] == 2 and not any(inside(b, r) for r in rooms.values()):
            rooms[name] = b
    if not rooms or len(rooms) == len(brushes):
        raise Refused('Expected room and CSG contents')
    for a, b in combinations(rooms.values(), 2):
        if c.halfspace_feasible(a['planes']+b['planes']):
            raise Refused('Background rooms touch/intersect')
    for name, b in brushes.items():
        if name in rooms:
            b['room'] = name
            continue
        owners = [n for n, r in rooms.items() if inside(b, r) and r['source']['order'] < b['source']['order']]
        if len(owners) != 1:
            raise Refused('Content touches or leaves its background room')
        b['room'] = owners[0]
    # Coplanar authored overlap has ambiguous material/ownership. Disjoint
    # coplanar room walls are fine; overlapping coplanar pieces are refused.
    faces = [(name, f) for name, b in brushes.items() for f in b['source']['faces']]
    for (an, a), (bn, b) in combinations(faces, 2):
        if an == bn:
            continue
        pa, sa = geometric_plane(a['plane'])
        pb, sb = geometric_plane(b['plane'])
        if pa != pb:
            continue
        br = b['points'] if sa == sb else tuple(reversed(b['points']))
        if area(intersection(a['points'], br, a['normal']), a['normal']):
            raise Refused('Authored coplanar overlap requires a material ownership proof')
    return brushes, rooms


def source_visible_faces(brushes, max_fragments=20000):
    """Partition each finite face, then compare CSG on its two infinitesimal sides."""
    all_planes = list(dict.fromkeys(p for b in brushes.values() for p in b['planes']))
    result = {}
    fragment_count = 0
    def solid_at(center, direction, side):
        solid = True
        for b in brushes.values():
            inside = True
            for p in b['planes']:
                dist = c.distance(center, p)
                derivative = side*c.dot(direction, p[:3])
                if dist > 0 or dist == 0 and derivative >= 0:
                    inside = False
                    break
            if inside:
                solid = b['source']['operation'] == 1
        return solid
    for name, b in brushes.items():
        for f in b['source']['faces']:
            normal = f['normal']
            parts = [f['points']]
            for p in all_planes:
                new = []
                for ring in parts:
                    dd = [c.distance(v, p) for v in ring]
                    if min(dd) < 0 < max(dd):
                        new.extend(r for r in (clip(ring, p), clip(ring, tuple(-v for v in p))) if area(r, normal))
                    else:
                        new.append(ring)
                parts = new
                if len(parts)+fragment_count > max_fragments:
                    raise Refused('Authored surface arrangement budget exceeded')
            visible = []
            for ring in parts:
                center = tuple(sum(v[k] for v in ring)/len(ring) for k in range(3))
                minus = solid_at(center, normal, -1)
                plus = solid_at(center, normal, 1)
                if minus == plus:
                    continue
                if (minus, plus) != ((True, False) if b['source']['operation'] == 1 else (False, True)):
                    raise Refused('Boundary ownership differs from source operation')
                visible.append(ring if b['source']['operation'] == 1 else tuple(reversed(ring)))
            result[name, f['index']] = visible
            fragment_count += len(parts)
    return result, fragment_count


def surface_proof(data, brushes, expected):
    actual = defaultdict(list)
    room_zones = {}
    for n in data['nodes'].values():
        s = data['surfs'][n['surf']]
        if s['actor'] not in brushes:
            raise Refused('Unknown compiled source owner')
        b = brushes[s['actor']]['source']
        index = s['face']
        if type(index)is not int or not 0 <= index < len(b['faces']):
            raise Refused('Invalid source face association')
        f = b['faces'][index]
        p = f['plane'] if b['operation'] == 1 else tuple(-v for v in f['plane'])
        if n['plane'] != p or s['normal'] != p[:3]:
            raise Refused('Compiled/source plane or normal disagreement')
        v1._ring(n['points'], p)
        if v1._uv(s) != v1._uv(f):
            raise Refused('Compiled material/affine UV disagreement')
        actual[s['actor'], index].append(n['points'])
    for key, wanted in expected.items():
        name, index = key
        b = brushes[name]['source']
        f = b['faces'][index]
        normal = f['normal'] if b['operation'] == 1 else tuple(-v for v in f['normal'])
        found = actual.get(key, [])
        if any(area(intersection(a, b, normal), normal) for a, b in combinations(found, 2)):
            raise Refused('Positive-area overlap/duplicate compiled face')
        if not covered(wanted, found, normal) or not covered(found, wanted, normal):
            error = Refused('Exact finite surface differs from ordered source CSG')
            error.surface = key
            raise error
    return dict(surface_groups=len(expected), compiled_polygons=sum(map(len, actual.values())),
                proof='complete bidirectional exact rational CSG face coverage and multiplicity')


def _air_connectivity(data, rooms, brushes, terminals, room_zones):
    """Every air cell in each room must connect by nonzero-area common facets."""
    stats = {}
    for room, r in rooms.items():
        initial = tuple(f['points'] for f in r['source']['faces'])
        cells = []
        for terminal in terminals:
            if not terminal['outside']:
                continue
            part = initial
            for p in terminal['planes']:
                part = c._clip(part, p)
                if not part:
                    break
            if part:
                if terminal['zone'] != room_zones[room]:
                    raise Refused('Air component zone mismatch')
                cells.append((terminal, part))
        if not cells:
            raise Refused('Background room has no air cells')
        edges = defaultdict(set)
        for i, (a, ac) in enumerate(cells):
            ap = dict(a['path'])
            for j in range(i+1, len(cells)):
                b, bc = cells[j]
                opposing = [node for node, side in b['path'] if node in ap and ap[node] != side]
                if len(opposing) != 1:
                    continue
                p = data['nodes'][opposing[0]]['plane']
                face = c._planar_hull([v for v in c.vertices(ac) if c.distance(v, p) == 0], p[:3])
                for plane in b['planes']+r['planes']:
                    face = clip(face, plane)
                if area(face, p[:3]):
                    edges[i].add(j)
                    edges[j].add(i)
        seen = {0}
        todo = [0]
        while todo:
            for j in edges[todo.pop()]-seen:
                seen.add(j)
                todo.append(j)
        if len(seen) != len(cells):
            raise Refused('Source air has multiple disconnected components in one native zone')
        stats[room] = dict(air_cells=len(cells), connected_components=1, facet_links=sum(map(len, edges.values()))//2)
    return stats


def validate_world(data):
    from inert_coplanar_model import model
    v1._native_coordinates(data)
    brushes, rooms = sources(data)
    terminals = model(data)
    if any(s['lightmap'] != -1 for s in data['surfs'].values()):
        raise Refused('Lightmap caches unsupported')
    if any(l['permeating'] != -1 or l['volumetric'] != -1 or l['visible'] != 2**64-1 for l in data['leaves'].values()):
        raise Refused('Leaf lighting/visibility caches unsupported')
    expected, fragments = source_visible_faces(brushes)
    surface = surface_proof(data, brushes, expected)
    room_zones = {}
    for n in data['nodes'].values():
        s = data['surfs'][n['surf']]
        room = brushes[s['actor']]['room']
        z = n['zones']
        if z[0] != 0 or z[1] <= 0 or room_zones.get(room, z[1]) != z[1]:
            raise Refused('Inconsistent physical surface zones')
        room_zones[room] = z[1]
    if set(room_zones) != set(rooms) or len(set(room_zones.values())) != len(rooms):
        raise Refused('Room zone inventory inconsistent')
    if set(data['zones']) != {0, *room_zones.values()} or any(z['actor'] != 'None' or z['cls'] != 'None' or
        z['connectivity'] != 1<<i or z['visibility'] != 2**64-1 for i, z in data['zones'].items()):
        raise Refused('Nontrivial native zone configuration unsupported')
    if any(l['zone'] not in room_zones.values() for l in data['leaves'].values()):
        raise Refused('Unassigned native leaf zone')
    dd = v1.DD([p for b in brushes.values() for p in b['planes']]+[n['plane'] for n in data['nodes'].values()])
    comparisons = []
    for tie in (False, True):
        solid = 1
        for b in brushes.values():
            add = b['source']['operation'] == 1
            signs = {-1, 0} if (not tie if add else tie) else {-1}
            inside = dd.all(dd.literal(p, signs) for p in b['planes'])
            solid = dd.apply('or', solid, inside) if add else dd.apply('and', solid, dd.negate(inside))
        expected_zone = {0:solid}
        for name, r in rooms.items():
            inside = dd.all(dd.literal(p, {-1, 0} if tie else {-1}) for p in r['planes'])
            expected_zone[room_zones[name]] = dd.apply('and', inside, dd.negate(solid))
        for zone, wanted in expected_zone.items():
            @lru_cache(None)
            def route(i):
                n = data['nodes'][i]
                values = [route(n['children'][s]) if n['children'][s] >= 0 else int(n['zones'][1-s] == zone) for s in (0, 1)]
                return dd.select(n['plane'], values[1], values[0], tie)
            comparisons.append(dict(zone=zone, ties_front=tie, **dd.equal(wanted, route(0))))
        @lru_cache(None)
        def actual_solid(i):
            n = data['nodes'][i]
            values = [actual_solid(n['children'][s]) if n['children'][s] >= 0 else s for s in (0, 1)]
            return dd.select(n['plane'], values[1], values[0], tie)
        comparisons.append(dict(solid_classification=True, ties_front=tie, **dd.equal(solid, actual_solid(0))))
    connectivity = _air_connectivity(data, rooms, brushes, terminals, room_zones)
    order = []
    stack = [0]
    while stack:
        i = stack.pop()
        order.append(i)
        stack.extend(j for j in data['nodes'][i]['children'] if j >= 0)
    masks = {}
    points = {}
    for i in reversed(order):
        n = data['nodes'][i]
        s = data['surfs'][n['surf']]
        room = brushes[s['actor']]['room']
        for side, leaf in enumerate(n['leaves']):
            if leaf != -1 and (leaf not in data['leaves'] or data['leaves'][leaf]['zone'] != n['zones'][side]):
                raise Refused('Native leaf zone mismatch')
        mask = 1<<room_zones[room]
        vv = list(n['points'])
        for child in n['children']:
            if child >= 0:
                mask |= masks[child]
                vv += points[child]
        masks[i] = mask
        points[i] = vv
        if n['zone_mask'] != mask:
            raise Refused('Incorrect descendant ZoneMask')
        if n['render_bound'] != -1:
            bound = data['bounds'].get(n['render_bound'])
            if not bound or bound['valid'] != 1 or any(not bound['low'][k] <= v[k] <= bound['high'][k] for v in vv for k in range(3)):
                raise Refused('Render bound excludes descendant geometry')
    return dict(status='pass', certificate='ordered_convex_CSG_exact_partial_surfaces_and_robust_all_strata_routing',
        source_face_arrangement_fragments=fragments, surface=surface, comparisons=comparisons,
        terminals=terminals, room_zones=room_zones, air_connectivity=connectivity, full_reference_used=False,
        required_profile=dict(engine_sha256=v1.ENGINE_SHA256, rounding='nearest', exceptions='masked'),
        native_collision='separate certificate required', publication_authorized=False)
