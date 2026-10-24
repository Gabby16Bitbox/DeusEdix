"""Limited per-leaf transfer for disconnected original zones without portals.

Every zone must remain one positive-area connected component in the cell;
distinct zones must not become adjacent. Side labels cover full compiled faces
using exact convex slices, including the retained world outside the cell.
"""
from pathlib import Path
from collections import defaultdict
from zone_transfer import read_nodes, terminal_empty
from zone_connectivity import connectivity_witness, plane_key, positive_overlap
from zone_face_labels import side_labels
from convex_cells import box_cell, split_convex, native_float, leaf_cells, Budget, Refused


def visibility_nodes(path):
    nodes = read_nodes(path)
    # Zones use visibility rather than collision solidity. Invisible collision
    # hulls (NF_NotVisBlocking) allocate leaves on BOTH sides. Keep this adapted
    # representation private: collision certificates still use untouched flags.
    for n in nodes.values():
        if n['flags']&4:
            n['flags'] |= 1
    return nodes


def components(leaves):
    faces = defaultdict(list)
    parent = list(range(len(leaves)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, leaf in enumerate(leaves):
        for f in leaf['cell']:
            faces[plane_key(f)].append((i, f))
    pairs = 0
    for p, rows in faces.items():
        for i, (a, fa) in enumerate(rows):
            for b, fb in rows[i+1:]:
                if root(a) == root(b):
                    continue
                pairs += 1
                if pairs > 200000:
                    raise Refused('Zone component interface budget exceeded')
                if positive_overlap(fa, fb, p):
                    parent[root(b)] = root(a)
    groups = defaultdict(list)
    for i in range(len(leaves)):
        groups[root(i)].append(i)
    result = list(groups.values())
    return result, {i:c for c, g in enumerate(result) for i in g}, pairs


def certificate(before_path, after_path, planned, original_label_provider=None):
    before_path, after_path = Path(before_path), Path(after_path)
    old, new = visibility_nodes(before_path), visibility_nodes(after_path)
    old_empty = terminal_empty(old, planned['root'], planned['root_outside'])
    zones = {zone for zone, leaf in old_empty.values()}
    if not zones or 0 in zones or any(leaf < 0 for zone, leaf in old_empty.values()):
        raise Refused('Original empty space lacks zone/leaf identity')
    new_empty = terminal_empty(new, 0, planned['root_outside'])
    vv = [v for f in planned['cell'] for v in f]
    whole_scope = box_cell([min(v[k] for v in vv)-1 for k in range(3)],
                         [max(v[k] for v in vv)+1 for k in range(3)])
    scope = whole_scope
    cuts = [tuple(native_float(x) for x in p) for p in planned['planes']]
    for plane in cuts:
        scope = split_convex(scope, plane)[1]
    if not scope:
        raise Refused('Empty zone witness scope')
    budget = Budget(500000, 500000)
    leaves = leaf_cells(new, 0, planned['root_outside'], scope, budget, volumes_only=True)
    empty = [l for l in leaves if l['outside']]
    old_leaves = [l for l in leaf_cells(old, planned['root'], planned['root_outside'], scope, budget, volumes_only=True) if l['outside']]
    if {(l['node'], l['side']) for l in old_leaves} != set(old_empty):
        raise Refused('An old structural empty leaf lacks a full-dimensional witness')
    old_groups, old_component, old_pairs = components(old_leaves)
    old_ids = {(l['node'], l['side']):old_component[i] for i, l in enumerate(old_leaves)}
    groups, new_component, new_pairs = components(empty)
    anchors = defaultdict(set)
    old_to_new = defaultdict(set)
    for i, leaf in enumerate(empty):
        for l in leaf_cells(old, planned['root'], planned['root_outside'], leaf['cell'], budget, volumes_only=True):
            if not l['outside']:
                continue
            anchors[new_component[i]].add(l['zone'])
            old_to_new[old_ids[(l['node'], l['side'])]].add(new_component[i])
    if any(len(anchors[c]) != 1 or 0 in anchors[c] for c in range(len(groups))):
        raise Refused('A replacement connected component mixes old zones or has no old-zone anchor')
    if any(len(old_to_new[c]) != 1 for c in range(len(old_groups))):
        raise Refused('An original connected component disappears or splits into distinct replacement components')
    checked = set()
    leaf_zones = {}
    for i, leaf in enumerate(empty):
        zone = next(iter(anchors[new_component[i]]))
        leaf['assigned_zone'] = zone
        if leaf['leaf'] < 0:
            raise Refused('Native replacement has no empty leaf record')
        if leaf['leaf'] in leaf_zones and leaf_zones[leaf['leaf']] != zone:
            raise Refused('One native leaf would own two old zones')
        leaf_zones[leaf['leaf']] = zone
        checked.add((leaf['node'], leaf['side']))
    if checked != set(new_empty):
        raise Refused('A structural empty leaf lacks a full-dimensional witness')
    if set(leaf_zones.values()) != zones:
        raise Refused('An original zone disappears from the replacement')
    connectivity = {'old_components':len(old_groups), 'new_components':len(groups), 'old_face_pairs':old_pairs,
                  'new_face_pairs':new_pairs, 'component_zones':[next(iter(anchors[c])) for c in range(len(groups))]}
    # Complete side coverage must account for tiny native polygon overhangs
    # outside ancestor halfspaces using the retained world, not tolerance.
    sources = before_path.with_suffix('.sources').read_text().splitlines()
    root_rows = [x.split() for x in sources if x.startswith('ROOT ')]
    if len(root_rows) != 1 or root_rows[0][1] not in ('0', '1'):
        raise Refused('Missing world RootOutside')
    world_outside = int(root_rows[0][1])
    outer_count = 0
    for leaf in leaf_cells(old, 0, world_outside, whole_scope, budget, volumes_only=True):
        remaining = leaf['cell']
        for plane in cuts:
            if not remaining:
                break
            outer, remaining = split_convex(remaining, plane, budget)
            if outer:
                item = dict(leaf)
                item['cell'] = outer
                item['assigned_zone'] = leaf['zone']
                leaves.append(item)
                outer_count += 1
    polygons = {}
    for line in after_path.read_text().splitlines():
        f = line.split()
        if f[0] == 'N':
            index = int(f[1])
        if f[0] == 'P':
            polygons[index] = [tuple(native_float(x) for x in f[8+j*3:11+j*3]) for j in range(int(f[7]))]
    labels = side_labels(new, polygons, leaves)
    inherited = None
    if labels['errors'] and original_label_provider is not None:
        requested = {item['node'] for item in labels['errors']}
        inherited = original_label_provider(sorted(requested))
        replacements = inherited['labels']
        if not set(replacements) <= requested:
            raise Refused('Unrequested original zone labels')
        for i, pair in replacements.items():
            if len(pair) != 2 or any(type(z)is not int or z < 0 or z >= 64 for z in pair):
                raise Refused('Malformed original zone labels')
            labels['labels'][i] = pair
        labels['errors'] = [item for item in labels['errors'] if item['node'] not in replacements]
    if labels['errors']:
        raise Refused('A node side needs a zone split or has incomplete exact coverage: '+str(labels['errors'][:3]))
    side_zones = {z for pair in labels['labels'].values() for z in pair if z}
    if not side_zones <= zones:
        raise Refused('A face touches an external zone not represented by replacement leaves')
    return {'mode':'per_leaf', 'zones':sorted(zones), 'leaf_zones':leaf_zones, 'node_zones':labels['labels'],
            'inherited_original_face_labels':inherited,
            'classification':'visibility: IsCsg with NF_NotVisBlocking extra flag; collision semantics unchanged',
            'old_structural_empty_leaves':len(old_empty), 'new_structural_empty_leaves':len(new_empty),
            'connectivity':connectivity, 'retained_world_witness_cells':outer_count, 'exact_splits':budget.splits,
            'method':'exact per-leaf original anchors, disjoint connected zone components and complete areal side labels'}
