"""Independent acceptance for isolated native cuboid updates, never uses Full.

First supported world class: finite exact axis-aligned subtractive rooms, all
disjoint, and ordinary additive cuboids strictly isolated inside those rooms.
Every authored and compiled face must be its entire exact rectangle. This is
intentionally much narrower than the general local CSG prototype.
"""
from collections import Counter
from fractions import Fraction
from itertools import product
import math
import struct
import orthogonal_routing as routing

Refused = routing.Refused


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def axis_plane(plane):
    if len(plane) != 4 or any(not isinstance(x, Fraction) for x in plane):
        raise Refused('Plane must come from authoritative exact native dump')
    axes = [k for k in range(3) if plane[k]]
    if len(axes) != 1 or abs(plane[axes[0]]) != 1:
        raise Refused('Only exact axial unit source planes are eligible')
    return axes[0]


def rectangle(points, plane):
    axis = axis_plane(plane)
    if len(points) != 4 or len(set(points)) != 4 or any(dot(p, plane[:3]) != plane[3] for p in points):
        raise Refused('Expected complete planar four-corner rectangle')
    axes = [k for k in range(3) if k != axis]
    low = tuple(min(p[k] for p in points) for k in range(3))
    high = tuple(max(p[k] for p in points) for k in range(3))
    if any(low[k] >= high[k] for k in axes):
        raise Refused('Degenerate rectangular face')
    expected = set(product(*[(low[k], high[k]) if k != axis else (low[k],) for k in range(3)]))
    if set(points) != expected:
        raise Refused('Face is not the full rectangle')
    for a, b in zip(points, points[1:]+points[:1]):
        if sum(x != y for x, y in zip(a, b)) != 1:
            raise Refused('Rectangle has a diagonal/self-crossing edge')
    area = cross(sub(points[1], points[0]), sub(points[2], points[0]))
    if dot(area, plane[:3]) <= 0:
        raise Refused('Rectangle has wrong winding')
    return low, high


def source_boxes(data):
    if data.get('root_outside') != 0:
        raise Refused('Expected a world initially solid')
    brushes = data.get('brushes')
    if not brushes or len(brushes) > 24:
        raise Refused('Unsupported source inventory/complexity')
    boxes = {}
    for b in brushes:
        if b['name'] in boxes or b['operation'] not in (1, 2) or b['flags'] or len(b['faces']) != 6:
            raise Refused('Source must be an ordinary six-face additive/subtractive cuboid')
        points = [v for f in b['faces'] for v in f['points']]
        if any(x.denominator != 1 or abs(x) > 16384 for p in points for x in p):
            raise Refused('Source coordinates must be exact integer-grid world units')
        low = tuple(min(v[k] for v in points) for k in range(3))
        high = tuple(max(v[k] for v in points) for k in range(3))
        if any(high[k]-low[k] < 1 for k in range(3)):
            raise Refused('Degenerate source volume')
        wanted = set()
        for k in range(3):
            for sign in (-1, 1):
                normal = tuple(Fraction(sign if j == k else 0) for j in range(3))
                wanted.add(normal+(sign*(low[k] if sign < 0 else high[k]),))
        found = set()
        for index, f in enumerate(b['faces']):
            if f['index'] != index or f['flags'] or f['plane'] in found or f['normal'] != f['plane'][:3]:
                raise Refused('Source face identity, normal or flags unsupported')
            found.add(f['plane'])
            lo, hi = rectangle(f['points'], f['plane'])
            axis = axis_plane(f['plane'])
            if any((lo[k], hi[k]) != (low[k], high[k]) for k in range(3) if k != axis):
                raise Refused('Source face does not span its cuboid')
        if found != wanted:
            raise Refused('Missing or inward source cuboid face')
        boxes[b['name']] = dict(source=b, low=low, high=high, planes=found)
    rooms = {n:b for n, b in boxes.items() if b['source']['operation'] == 2}
    solids = {n:b for n, b in boxes.items() if b['source']['operation'] == 1}
    if not rooms or not solids:
        raise Refused('Expected room and isolated solid source')
    def separated(a, b):
        return any(a['high'][k]+1 <= b['low'][k] or b['high'][k]+1 <= a['low'][k] for k in range(3))
    for items in (list(rooms.items()), list(solids.items())):
        for index, (name, a) in enumerate(items):
            if any(not separated(a, b) for _, b in items[index+1:]):
                raise Refused('Rooms or additive boxes touch/intersect')
    for name, b in solids.items():
        containing = [n for n, r in rooms.items() if all(r['low'][k]+1 <= b['low'][k] and b['high'][k]+1 <= r['high'][k] for k in range(3))]
        if len(containing) != 1:
            raise Refused('Box is not strictly isolated inside one room')
        b['room'] = containing[0]
        if rooms[b['room']]['source']['order'] >= b['source']['order']:
            raise Refused('Containing subtraction follows its additive box')
    return boxes, rooms, solids


def _uv(mapping):
    return (mapping['texture'], mapping['flags'], mapping['u'], mapping['v'],
            Fraction(mapping['pan'][0])-dot(mapping['u'], mapping['base']),
            Fraction(mapping['pan'][1])-dot(mapping['v'], mapping['base']))


def validate_world(data):
    boxes, rooms, solids = source_boxes(data)
    counts = Counter()
    room_zones = {}
    for n in data['nodes'].values():
        s = data['surfs'][n['surf']]
        if s['actor'] not in boxes:
            raise Refused('Compiled node has unknown source owner')
        b = boxes[s['actor']]
        source = b['source']
        index = s['face']
        if not 0 <= index < 6:
            raise Refused('Invalid source face identity')
        f = source['faces'][index]
        p = f['plane'] if source['operation'] == 1 else tuple(-v for v in f['plane'])
        if n['flags'] or n['vertices'] != 4 or n['plane'] != p or s['normal'] != p[:3]:
            raise Refused('Compiled cuboid plane/normal/flags changed')
        rectangle(n['points'], p)
        if set(n['points']) != set(f['points']):
            raise Refused('Compiled rectangle differs from source')
        if _uv(s) != _uv(f):
            raise Refused('Compiled material or affine UV differs from source')
        counts[s['actor'], index] += 1
        if source['operation'] == 2:
            zones = n['zones']
            if zones[0] != 0 or not 0 < zones[1] < 64:
                raise Refused('Room has inconsistent front/back zones')
            if s['actor'] in room_zones and room_zones[s['actor']] != zones[1]:
                raise Refused('Room has multiple zones')
            room_zones[s['actor']] = zones[1]
    expected = Counter((name, index) for name in boxes for index in range(6))
    if counts != expected:
        raise Refused('Missing, duplicated, fragmented or extra compiled source face')
    if set(room_zones) != set(rooms) or len(set(room_zones.values())) != len(rooms):
        raise Refused('Rooms do not have distinct complete zone labels')
    raw_model = dict(root=0, root_outside=bool(data['root_outside']), nodes={
        i:dict(n, plane=tuple(float(x) for x in n['plane'])) for i, n in data['nodes'].items()})
    nodes, cuts, outside = routing._model(raw_model)
    axes = [routing._atoms(v) for v in cuts]
    total = math.prod(len(a) for a in axes)
    if total > 200000:
        raise Refused('Exact source/routing certificate complexity exceeded')
    def inside(point, b, inclusive):
        if inclusive:
            return all(b['low'][k] <= point[k] <= b['high'][k] for k in range(3))
        return all(b['low'][k] < point[k] < b['high'][k] for k in range(3))
    dimensions = Counter()
    solid_terminals = {name:set() for name in solids}
    for atoms in product(*axes):
        point = tuple(a[0] for a in atoms)
        dimensions[sum(a[1] for a in atoms)] += 1
        for ties_front in (False, True):
            containing = [name for name, b in rooms.items() if inside(point, b, ties_front)]
            air = bool(containing)
            if any(inside(point, b, not ties_front) for b in solids.values()):
                air = False
            zone = room_zones[containing[0]] if air else 0
            actual, path = routing._route(nodes, outside, point, ties_front)
            if actual != (air, zone):
                error = Refused('BSP differs from analytic source CSG including boundary strata')
                error.witness = dict(point=list(map(str, point)), expected=[air, zone], actual=actual, path=path, ties_front=ties_front)
                raise error
            for name, box in solids.items():
                if inside(point, box, not ties_front):
                    solid_terminals[name].add((path[-1][0], path[-1][1]))
    # Check native leaf labels, physical surface-side labels, visibility masks,
    # and all present render bounds against their complete descendant geometry.
    order = []
    stack = [0]
    while stack:
        i = stack.pop()
        order.append(i)
        stack.extend(v for v in data['nodes'][i]['children'] if v >= 0)
    masks = {}
    points = {}
    for i in reversed(order):
        n = data['nodes'][i]
        s = data['surfs'][n['surf']]
        b = boxes[s['actor']]
        room = s['actor'] if b['source']['operation'] == 2 else b['room']
        if n['zones'] != [0, room_zones[room]]:
            raise Refused('Physical surface zone mismatch')
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
            raise Refused('Stale or incorrect subtree ZoneMask')
        bound = n['render_bound']
        if bound != -1:
            if bound not in data['bounds']:
                raise Refused('Missing render bound')
            bnd = data['bounds'][bound]
            if bnd['valid'] != 1 or any(not bnd['low'][k] <= v[k] <= bnd['high'][k] for v in vv for k in range(3)):
                raise Refused('Render bound may cull descendant geometry')
    return dict(boxes=boxes, rooms=rooms, solids=solids, room_zones=room_zones,
                strata=total, dimension_counts=dict(dimensions), solid_terminals=solid_terminals)


def hull_records(data):
    records = []
    for i, n in data['nodes'].items():
        start = n['collision_bound']
        if start == -1:
            continue
        if type(start) is not int or start < 0:
            raise Refused('Invalid native hull start')
        planes = []
        indices = []
        cursor = start
        while cursor in data['hulls'] and data['hulls'][cursor] >= 0:
            word = data['hulls'][cursor]
            index = word&~0x40000000
            if index not in data['nodes'] or len(planes) >= 64:
                raise Refused('Invalid/excessive hull plane reference')
            ref = data['nodes'][index]
            if ref['flags'] or ref['vertices'] != 4:
                raise Refused('Hull references unsupported node semantics')
            p = ref['plane']
            axis_plane(p)
            if word&0x40000000:
                p = tuple(-v for v in p)
            planes.append(p)
            indices.append((index, bool(word&0x40000000)))
            cursor += 1
        if data['hulls'].get(cursor) != -1 or any(cursor+k not in data['hulls'] for k in range(1, 7)):
            raise Refused('Truncated hull or missing sentinel')
        try:
            raw = struct.unpack('<6f', struct.pack('<6i', *[data['hulls'][cursor+k] for k in range(1, 7)]))
        except (OverflowError, struct.error) as error:
            raise Refused('Malformed hull bounds') from error
        if not all(math.isfinite(v) for v in raw):
            raise Refused('Non-finite hull bounds')
        bounds = tuple(Fraction(v) for v in raw)
        if any(bounds[k] >= bounds[k+3] for k in range(3)):
            raise Refused('Empty/inverted native hull bounds')
        surface = data['surfs'][n['surf']]
        records.append(dict(owner=(surface['actor'], surface['face']), planes=tuple(planes), bounds=bounds, indices=indices, node=i))
    return records


def certify(before, after, selected):
    a = validate_world(before)
    b = validate_world(after)
    if selected not in a['solids'] or selected not in b['solids']:
        raise Refused('Select one existing ordinary additive box')
    old = {v['name']:v for v in before['brushes']}
    new = {v['name']:v for v in after['brushes']}
    if old.keys() != new.keys() or any(old[n] != new[n] for n in old if n != selected):
        raise Refused('An unselected authoritative source changed')
    if old[selected]['order'] != new[selected]['order'] or old[selected]['operation'] != new[selected]['operation']:
        raise Refused('Selected CSG order/operation changed')
    if a['solids'][selected]['room'] != b['solids'][selected]['room']:
        raise Refused('Box moved to a different room')
    if a['room_zones'] != b['room_zones'] or before['zones'] != after['zones'] or before['leaves'] != after['leaves']:
        raise Refused('Zone/leaf connectivity cache changed')
    if set(before['nodes']) != set(after['nodes']):
        raise Refused('Partition node inventory changed')
    for i, left in before['nodes'].items():
        right = after['nodes'][i]
        for key in ('children', 'flags', 'vertices', 'zones', 'leaves', 'zone_mask'):
            if left[key] != right[key]:
                raise Refused('Partition topology or metadata changed')
        if (left['collision_bound'] == -1) != (right['collision_bound'] == -1):
            raise Refused('Native hull ownership moved between partition nodes')
        ls = before['surfs'][left['surf']]
        rs = after['surfs'][right['surf']]
        if (ls['actor'], ls['face']) != (rs['actor'], rs['face']):
            raise Refused('Node source owner changed')
        if ls['actor'] != selected:
            if left['plane'] != right['plane'] or left['points'] != right['points'] or _uv(ls) != _uv(rs) or ls['normal'] != rs['normal']:
                raise Refused('Untouched BSP geometry or surface mapping changed')
    summaries = []
    outside = []
    for data, proof in ((before, a), (after, b)):
        hulls = hull_records(data)
        owned = [h for h in hulls if h['owner'][0] == selected]
        if len(owned) != 1:
            raise Refused('Isolated box must own exactly one native solid hull')
        hull = owned[0]
        box = proof['solids'][selected]
        if proof['solid_terminals'][selected] != {(hull['node'], 'back')}:
            raise Refused('Native box hull does not belong to every certified solid terminal')
        if len(hull['planes']) != 6 or set(hull['planes']) != box['planes'] or hull['bounds'] != box['low']+box['high']:
            raise Refused('Native hull is not exactly the six authoritative box planes and bounds')
        summaries.append(dict(node=hull['node'], planes=6, bounds=list(map(str, hull['bounds']))))
        outside.append(Counter((h['node'], h['owner'], h['planes'], h['bounds']) for h in hulls if h['owner'][0] != selected))
    if outside[0] != outside[1]:
        raise Refused('Untouched native hull plane order or bounds changed')
    return dict(status='pass', certificate='isolated_integer_axis_box_exact_source_routing_surfaces_hulls',
                original_strata=a['strata'], candidate_strata=b['strata'],
                candidate_dimension_counts=b['dimension_counts'], native_box_hulls=summaries,
                unchanged_external_hulls=sum(outside[0].values()), unchanged_partition_links=True,
                outside_geometry='exact_all_unselected_nodes_and_source_mappings',
                source_world_class='disjoint cuboid rooms with strictly isolated ordinary solid cuboids',
                native_collision_basis='trusted installed engine operating on certified six-plane axial hull; no sampled-ray equivalence',
                full_reference_used=False, eligible=True)
