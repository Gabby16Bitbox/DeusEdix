"""Exact retained BSP mapping and contributor scope for one regional graft.

No geometry is inferred from samples. A caller must separately certify the
replacement cell's CSG, surfaces and native hulls. This module proves that the
other branches/ancestor splitters and their authored sources are unchanged.
"""
from fractions import Fraction
import itertools
from certificate_evidence import _surface_identity
import convex_cells as c

Refused = c.Refused


def inventory(data):
    nodes = data['nodes']
    parents = {0:None}
    stack = [0]
    if 0 not in nodes:
        raise Refused('Missing native BSP root')
    while stack:
        i = stack.pop()
        if len(nodes[i]['children']) != 3:
            raise Refused('Incomplete BSP links')
        for side, child in enumerate(nodes[i]['children']):
            if child == -1:
                continue
            if child not in nodes or child in parents:
                raise Refused('Shared, cyclic or invalid BSP node')
            parents[child] = (i, side)
            stack.append(child)
    if set(parents) != set(nodes):
        raise Refused('Unreachable BSP node outside the owned tree')
    return parents


def descendants(data, root):
    result = set()
    stack = [root]
    while stack:
        i = stack.pop()
        if i in result:
            raise Refused('Cyclic regional BSP')
        result.add(i)
        stack.extend(j for j in data['nodes'][i]['children'] if j != -1)
    return result


def payload(data, node):
    n = data['nodes'][node]
    # Surface/light/leaf indices may be renumbered; their semantic identities
    # are checked separately. The partition equation and vertex floats are exact.
    points = n['points']
    if points:
        points = min(points[k:]+points[:k] for k in range(len(points)))
    return (_surface_identity(data['surfs'][n['surf']]), n['vertices'], n['flags'],
            n['plane'], points, tuple(n['zones']), n['zone_mask'])


def required_contributors(brushes, planes):
    """Conservative finite source support, including contacts and float slivers.

    This is only an inventory bound. It does not prove a legacy open brush has
    the CSG semantics of its finite support; source-intent remains a separate
    gate. Inputs are the exact float32 rationals from CERT2, never plan EPS.
    """
    required = []
    excluded = {}
    for brush in brushes:
        name = brush['name']
        vv = [v for f in brush['faces'] for v in f['points']]
        if not vv:
            raise Refused('Empty authored brush has no certified support')
        lo = tuple(min(v[k] for v in vv) for k in range(3))
        hi = tuple(max(v[k] for v in vv) for k in range(3))
        corners = list(itertools.product(*zip(lo, hi)))
        witnesses = [i for i, p in enumerate(planes) if max(c.distance(v, p) for v in corners) < 0]
        if witnesses:
            excluded[name] = witnesses[0]
        else:
            required.append(name)
    return required, excluded


def complete_contributors(before, edited, planned):
    """Complete a proposed subset before compilation; never authorize output."""
    parents = inventory(before)
    root = planned['root']
    if type(root) is not int or root == 0 or root not in parents:
        raise Refused('A strict non-root BSP region is required')
    path = []
    at = root
    while at:
        parent, side = parents[at]
        if side == 2:
            raise Refused('Regional root has a coplanar ancestor')
        p = before['nodes'][parent]['plane']
        path.append(p if side == 0 else tuple(-x for x in p))
        at = parent
    path.reverse()
    required, excluded = required_contributors(edited['brushes'], path)
    requested = planned['contributors']
    all_names = [b['name'] for b in edited['brushes']]
    if len(requested) != len(set(requested)) or not set(requested) <= set(all_names):
        raise Refused('Malformed proposed contributor inventory')
    needed = set(required)|set(requested)
    if needed == set(all_names):
        raise Refused('Complete contributor support reaches all world sources')
    added = [b for b in edited['brushes'] if b['name'] in needed-set(requested)]
    if any(b['flags']&0x04000000 or any(f['flags']&0x04000000 for f in b['faces']) for b in added):
        raise Refused('Exact support introduces a portal requiring a separate boundary proof')
    result = dict(planned, contributors=[n for n in all_names if n in needed])
    result['exact_contributor_inventory'] = dict(added=[b['name'] for b in added],
        excluded_sources=excluded, source_count=len(all_names), publication_authorized=False)
    return result


def certify_scope(before, after, root, selected, contributors):
    bp = inventory(before)
    inventory(after)
    if type(root) is not int or root == 0 or root not in bp:
        raise Refused('A strict non-root BSP region is required')
    if before['root_outside'] != after['root_outside'] or before['zones'] != after['zones']:
        raise Refused('World root or zone connectivity/visibility changed')
    selected = set(selected)
    source_before = {b['name']:b for b in before['brushes']}
    source_after = {b['name']:b for b in after['brushes']}
    if not selected or not selected <= source_before.keys() or source_before.keys() != source_after.keys():
        raise Refused('Missing or changed authoritative source inventory')
    changed = {n for n in source_before if source_before[n] != source_after[n]}
    if changed != selected:
        raise Refused('Actual changed source inventory differs from selected edits')
    path = []
    at = root
    while at:
        parent, side = bp[at]
        if side == 2:
            raise Refused('Regional root cannot be reached through a coplanar continuation')
        path.append((parent, side))
        at = parent
    path.reverse()
    planes = []
    root_outside = bool(before['root_outside'])
    for i, side in path:
        n = before['nodes'][i]
        p = n['plane']
        # Cell conventions match native front (>=0), back (<0). Edits must be
        # strictly interior, so no boundary ownership assumption is needed here.
        planes.append(p if side == 0 else tuple(-x for x in p))
        csg = n['vertices'] > 0 and not n['flags']&0x21
        root_outside = (root_outside or csg) if side == 0 else (root_outside and not csg)
    edited_points = [v for data in (source_before, source_after) for name in selected for f in data[name]['faces'] for v in f['points']]
    if not edited_points or any(c.distance(v, p) <= 0 for p in planes for v in edited_points):
        raise Refused('Selected source support touches or crosses a retained ancestor plane')
    # Completeness is conservative, exact and independent of native plan EPS.
    # An omitted source must have its complete AABB strictly outside one cut.
    supplied = list(contributors)
    if len(supplied) != len(set(supplied)) or not selected <= set(supplied) or not set(supplied) < source_after.keys():
        raise Refused('Expected a strict source subset containing every selected brush')
    required, excluded = required_contributors(after['brushes'], planes)
    if not set(required) <= set(supplied):
        raise Refused('Regional replay omitted a potentially contributing source')
    if supplied != [b['name'] for b in after['brushes'] if b['name'] in supplied]:
        raise Refused('Regional replay changed authoritative CSG source order')
    owned_before = descendants(before, root)
    mapping = {}
    replacement = None
    stack = [(0, 0)]
    while stack:
        left, right = stack.pop()
        if left == root:
            if replacement is not None:
                raise Refused('Multiple replacement roots')
            replacement = right
            continue
        if payload(before, left) != payload(after, right):
            raise Refused('A retained partition or surface changed')
        mapping[left] = right
        for side, (a, b) in enumerate(zip(before['nodes'][left]['children'], after['nodes'][right]['children'])):
            if a == -1 or b == -1:
                if a != b:
                    raise Refused('A retained BSP branch appeared or disappeared')
                # Native terminal leaf identity may be reindexed, never altered.
                if side < 2:
                    # FBspNode.iLeaf is [back, front], unlike iFront/iBack.
                    li = before['nodes'][left]['leaves'][1-side]
                    ri = after['nodes'][right]['leaves'][1-side]
                    if (before['leaves'].get(li) if li != -1 else None) != (after['leaves'].get(ri) if ri != -1 else None):
                        raise Refused('Retained terminal leaf semantics changed')
                continue
            stack.append((a, b))
    if replacement is None:
        raise Refused('Replacement branch is missing')
    owned_after = descendants(after, replacement)
    if set(mapping) != set(before['nodes'])-owned_before or set(mapping.values()) != set(after['nodes'])-owned_after:
        raise Refused('Outside retained mapping is not complete and bijective')
    if any(before['surfs'][before['nodes'][i]['surf']]['actor'] in selected for i in mapping):
        raise Refused('Selected compiled surface exists outside regional ownership')
    return dict(status='pass', before_root=root, after_root=replacement, outside_map=mapping,
        before_owned=sorted(owned_before), after_owned=sorted(owned_after),
        ancestry=path, planes=planes, root_outside=int(root_outside),
        selected=sorted(selected), contributors=supplied, excluded_sources=excluded,
        scope='Exact retained topology/surfaces/zones and complete conservative source subset; replacement cell still needs certification')
