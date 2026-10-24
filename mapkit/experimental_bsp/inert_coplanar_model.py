"""Structural routing proof with explicitly inert native coplanar fragments.

PointRegion follows front/back links. Surface coverage, masks and bounds must
still validate every original node, including fragments omitted from this
routing-only proxy. The independent hull certificate must also pass.
"""
import stratified_csg as v1
Refused = v1.Refused


def model(data):
    nodes = data['nodes']
    if not nodes or len(nodes) > 1024 or set(nodes) != set(range(len(nodes))):
        raise Refused('Invalid complete node inventory')
    visited = set()
    structural = []
    stack = [0]
    while stack:
        i = stack.pop()
        if i not in nodes or i in visited:
            raise Refused('Cyclic, shared or invalid BSP routing link')
        visited.add(i)
        structural.append(i)
        head = nodes[i]
        if len(head['children']) != 3:
            raise Refused('Invalid structural child inventory')
        stack.extend(j for j in head['children'][:2] if j != -1)
        fragment = head['children'][2]
        while fragment != -1:
            if fragment not in nodes or fragment in visited:
                raise Refused('Cyclic, shared or invalid coplanar chain')
            visited.add(fragment)
            n = nodes[fragment]
            if (len(n['children']) != 3 or n['children'][:2] != [-1, -1] or
                    n['plane'] != head['plane'] or n['flags'] != head['flags'] or
                    n['zones'] != head['zones'] or n['leaves'] != [-1, -1] or n['collision_bound'] != -1 or
                    not 3 <= n['vertices'] <= 24 or len(n['points']) != n['vertices']):
                raise Refused('Coplanar fragment is not structurally inert')
            fragment = n['children'][2]
    if visited != set(nodes):
        raise Refused('Unreachable native nodes')
    remap = {old:new for new, old in enumerate(structural)}
    proxy = dict(data, nodes={remap[i]:dict(nodes[i], children=[
        remap[j] if j != -1 else -1 for j in nodes[i]['children'][:2]]+[-1]) for i in structural})
    terminals = v1._model(proxy)
    for terminal in terminals:
        terminal['node'] = structural[terminal['node']]
        terminal['path'] = tuple((structural[i], side) for i, side in terminal['path'])
    return terminals
