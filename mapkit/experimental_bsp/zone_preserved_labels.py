"""Inherit render-face zones only from completely certified original pieces.

The volume/component certificate remains separate and mandatory. This helper
handles old compiled render polygons that already overhang an ancestor plane.
It never derives a zone from a sample, approximate area, or a surface key alone.
"""
from collections import defaultdict
from selected_rebuild import tree, Refused as GeometryRefused
from convex_cells import native_float
from zone_transfer import read_nodes
from zone_connectivity import projected, area2, cross2
from preserved_faces import collect_preserved_faces
from edited_collision_scope import source_edit_certificate


def _convex(poly):
    return len(poly) >= 3 and area2(poly) > 0 and all(
        cross2(a, b, p) >= 0 for a, b in zip(poly, poly[1:]+poly[:1]) for p in poly)


def _intersection(subject, clip):
    for a, b in zip(clip, clip[1:]+clip[:1]):
        if not subject:
            return []
        out = []
        x = subject[-1]
        dx = cross2(a, b, x)
        for y in subject:
            dy = cross2(a, b, y)
            if dx < 0 < dy or dy < 0 < dx:
                t = dx/(dx-dy)
                out.append(tuple(x[k]+t*(y[k]-x[k]) for k in range(2)))
            if dy >= 0:
                out.append(y)
            x, dx = y, dy
        subject = list(dict.fromkeys(out))
    return subject


def covered_labels(face, plane, candidates):
    """Exact full, disjoint footprint coverage on an identical partition plane."""
    target = projected(face, plane)
    if not _convex(target):
        return None
    pieces = []
    labels = set()
    ids = []
    for item in candidates:
        if item['plane'] != plane:
            continue
        polygon = projected(item['face'], plane)
        if not _convex(polygon):
            return None
        part = _intersection(target, polygon)
        if not part or not area2(part):
            continue
        pair = tuple(item['zones'])
        if len(pair) != 2 or any(type(z)is not int or z < 0 or z >= 64 for z in pair):
            return None
        if any(area2(_intersection(part, previous)) for previous in pieces):
            return None
        pieces.append(part)
        labels.add(pair)
        ids.append(item['node'])
    if len(labels) != 1 or sum(area2(part) for part in pieces) != area2(target):
        return None
    return {'zones':list(next(iter(labels))), 'original_nodes':ids}


def _vertices(poly):
    return [tuple(native_float(x) for x in poly[7+3*i:10+3*i]) for i in range(int(poly[6]))]


def _raw_surface(surface):
    # Only baked-lightmap index may differ after a geometry compilation.
    return tuple(surface[:4]+surface[5:])


def certified_original_labels(before_path, after_path, old_sources, new_sources,
                              planned, key_for_surface, compare_coverage, requested):
    """Return only labels with dependency, complete source and 3D proofs.

    ``compare_coverage`` is the existing SDK-bounded 3D coverage validator;
    a footprint match is never sufficient by itself. It checks the complete
    candidate surface inside the cell against Original before any label is
    returned. Normal post-graft/full/collision gates still run afterwards.
    """
    report = {'labels':{}, 'proofs':{}, 'coverage':{}, 'refused_surfaces':0}
    dependencies = source_edit_certificate(old_sources, new_sources, planned['selected'])
    report['source_dependencies'] = dependencies
    if not dependencies['valid']:
        return report
    before, after = tree(before_path), tree(after_path)
    old_nodes, new_nodes = read_nodes(before_path), read_nodes(after_path)
    heads = {i:i for i in new_nodes}
    chained = {n['children'][2] for n in new_nodes.values() if n['children'][2] >= 0}
    for i, node in new_nodes.items():
        if i in chained:
            continue
        c = node['children'][2]
        seen = {i}
        while c >= 0:
            if c not in new_nodes or c in seen:
                raise GeometryRefused('Invalid preserved face coplanar chain')
            seen.add(c)
            heads[c] = i
            c = new_nodes[c]['children'][2]
    protected = collect_preserved_faces(before, after, old_sources, new_sources,
                                      planned['selected'], key_for_surface)
    requested = set(requested)
    if not requested <= new_nodes.keys():
        return report
    old_by_key = defaultdict(list)
    for i, node in old_nodes.items():
        if not node['vertices']:
            continue
        poly = before['polys'][i]
        surface = before['surfs'][int(poly[0])]
        old_by_key[key_for_surface(surface)].append((i, poly, surface))
    proposals = {}
    proposed_keys = {}
    for i in sorted(requested):
        node = new_nodes[i]
        if not node['vertices']:
            continue
        if node['plane'] != new_nodes[heads[i]]['plane']:
            continue
        poly = after['polys'][i]
        surface = after['surfs'][int(poly[0])]
        key = key_for_surface(surface)
        if key not in protected:
            continue
        candidates = []
        for j, old_poly, old_surface in old_by_key[key]:
            if _raw_surface(surface) != _raw_surface(old_surface):
                continue
            old_node = old_nodes[j]
            candidates.append({'node':j, 'face':_vertices(old_poly), 'plane':old_node['plane'],
                               'zones':old_node['zones']})
        proof = covered_labels(_vertices(poly), node['plane'], candidates)
        if proof is not None:
            proposals[i] = proof
            proposed_keys[i] = key
    # A whole-surface 3D check is cached per key; an invalid surface cannot
    # contribute labels for an otherwise attractive subset of its fragments.
    accepted = set()
    for key in set(proposed_keys.values()):
        def only(data):
            return dict(data, polys=[p for p in data['polys']
                if key_for_surface(data['surfs'][int(p[0])]) == key])
        try:
            check = compare_coverage(only(after), only(before), planned['planes'])
        except (GeometryRefused, ValueError):
            report['refused_surfaces'] += 1
            continue
        if not isinstance(check, dict) or type(check.get('triangles_checked'))is not int or check['triangles_checked'] <= 0:
            report['refused_surfaces'] += 1
            continue
        accepted.add(key)
        report['coverage'][str(key)] = check
    for i, proof in proposals.items():
        if proposed_keys[i] not in accepted:
            continue
        report['labels'][i] = proof['zones']
        report['proofs'][i] = proof
    report['method'] = 'unchanged source dependencies and complete source AABB separation; identical raw surface/plane; exact disjoint original footprint cover; mandatory existing 3D coverage'
    return report
