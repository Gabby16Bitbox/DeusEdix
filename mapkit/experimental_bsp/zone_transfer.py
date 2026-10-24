"""Exact homogeneous-zone anchors for a bounded local BSP replacement.

Research gate: every new empty convex leaf must overlap original empty space;
that convex leaf is connected, so its old-zone anchor extends to its entirety.
No inference is made for an unanchored new cavity or mixed-zone replacement.
"""
from pathlib import Path
from convex_cells import native_float, box_cell, split_convex, leaf_cells, validate_links, Budget, Refused
from zone_connectivity import connectivity_witness


def read_nodes(path):
    nodes = {}
    planes = []
    for line in Path(path).read_text().splitlines():
        f = line.split()
        if f[0] == 'N':
            nodes[int(f[1])] = {'children':list(map(int, f[2:5])), 'vertices':int(f[7]), 'flags':int(f[8]),
                             'zones':list(map(int, f[9:11])), 'leaves':list(map(int, f[11:13]))}
        elif f[0] == 'P':
            planes.append(tuple(native_float(v) for v in f[2:6]))
    if len(planes) != len(nodes):
        raise Refused('Missing BSP planes')
    for i, n in nodes.items():
        n['plane'] = planes[i]
    return nodes


def terminal_empty(nodes, root, outside):
    """Every structural empty terminal, including unbounded and tiny cells.

    Ignoring a zero-volume/infeasible path is unnecessary: requiring it to have
    a witness is conservative. iPlane chains do not partition BSP volume.
    """
    validate_links(nodes, root, volumes_only=True)
    result = {}
    stack = [(root, bool(outside))]
    while stack:
        i, out = stack.pop()
        n = nodes[i]
        csg = n['vertices'] > 0 and not n['flags']&0x21
        for side in (0, 1):
            next_out = (out or csg) if side == 0 else (out and not csg)
            child = n['children'][side]
            if child >= 0:
                stack.append((child, next_out))
            elif next_out:
                result[(i, side)] = (n['zones'][1-side], n['leaves'][1-side])
    return result


def certificate(before_path, after_path, planned):
    old, new = read_nodes(before_path), read_nodes(after_path)
    old_empty = terminal_empty(old, planned['root'], planned['root_outside'])
    zones = {value[0] for value in old_empty.values()}
    if len(zones) != 1 or next(iter(zones)) in (0, None):
        raise Refused('The old cell is not certified homogeneous empty-zone space')
    zone = next(iter(zones))
    if any(leaf is None or leaf < 0 for _, leaf in old_empty.values()):
        raise Refused('Original empty leaf lacks region identity')
    new_empty = terminal_empty(new, 0, planned['root_outside'])
    # This finite box searches for positive-volume witnesses ONLY. The complete
    # unbounded structural leaf set above must be witnessed, so absence outside
    # the box never silently approves an unchecked empty volume. Each global
    # leaf is convex and therefore connects all of its points to its anchor.
    vv = [v for face in planned['cell'] for v in face]
    low = [min(v[k] for v in vv)-1 for k in range(3)]
    high = [max(v[k] for v in vv)+1 for k in range(3)]
    scope = box_cell(low, high)
    for p in planned['planes']:
        scope = split_convex(scope, tuple(native_float(x) for x in p))[1]
        if not scope:
            raise Refused('Empty local zone scope')
    budget = Budget(max_splits=200000, max_fragments=200000)
    old_leaves = leaf_cells(old, planned['root'], planned['root_outside'], scope, budget, volumes_only=True)
    new_leaves = leaf_cells(new, 0, planned['root_outside'], scope, budget, volumes_only=True)
    checked = set()
    for leaf in new_leaves:
        if not leaf['outside']:
            continue
        overlap = leaf_cells(old, planned['root'], planned['root_outside'], leaf['cell'], budget, volumes_only=True)
        anchors = {x['zone'] for x in overlap if x['outside']}
        if anchors != {zone}:
            raise Refused('A new empty leaf has no unique original-zone volume anchor')
        checked.add((leaf['node'], leaf['side']))
    if not checked:
        raise Refused('No empty replacement zone volume')
    if checked != set(new_empty):
        raise Refused('A structural empty leaf has no positive-volume witness in the certified scope')
    connection = connectivity_witness([leaf['cell'] for leaf in new_leaves if leaf['outside']])
    return {'zone':zone, 'old_leaf_cells':len(old_leaves), 'new_leaf_cells':len(new_leaves),
            'old_structural_empty_leaves':len(old_empty), 'new_structural_empty_leaves':len(new_empty),
            'anchored_empty_leaf_cells':len(checked), 'exact_splits':budget.splits,
            'connectivity':connection,
            'method':'all structural empty leaves anchored by exact float32-plane volume overlap; finite box only finds witnesses, never limits the claimed domain'}
