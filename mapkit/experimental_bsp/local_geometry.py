"""Experimental cell rebuild from edited source brushes; isolated copies only."""
import argparse
from collections import Counter
import copy
import itertools
import json
import math
from pathlib import Path
import re
import sys
import time
import uuid
import selected_rebuild as base
from implementation import CODE
import nonsolid_update
import multi_region
import shutil
from verified_output import copy_verified
import polygon_validation
from portal_analysis import read_sources, retained_portal_certificate
from boundary_welding import collect_boundary_anchors, weld_vertices
from preserved_faces import collect_preserved_faces
from preserved_reference import compare_preserved_coverage
from collision_scope import sweep_outside_cell, point_outside_cell
from edited_collision_scope import source_edit_certificate, sweep_outside_edits, point_outside_edits
from phantom_normal import certify_phantom_normal, verify_native_backoff, Refused as PhantomNormalRefused

ROOT = base.ROOT
Refused = base.Refused
# Deus Ex SDK THRESH_SPLIT_POLY_PRECISELY. The compiled originals contain
# ~0.003-unit plane/vertex drift; treating it as a new cell makes sliver zones.
EPS = .01


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def distance(p, plane):
    return dot(p, plane[:3])-plane[3]


def negate(p):
    return tuple(-x for x in p)


def unique(points):
    return list({tuple(round(x, 6) for x in p):p for p in points}.values())


def vertices(poly):
    return [tuple(map(float, poly[7+i*3:10+i*3])) for i in range(int(poly[6]))]


def plane(data, i):
    return tuple(map(float, data['polys'][i][1:5]))


def clip_polygon(poly, p):
    """Native-precision classification; exact intersections for real crossings.

    Retain existing on-plane vertices. Recutting their floating-point drift as
    real geometry introduces slivers absent from both the original and Full.
    """
    if not poly:
        return []
    out = []
    a = poly[-1]
    da = distance(a, p)
    if abs(da) <= EPS:
        da = 0.
    for b in poly:
        db = distance(b, p)
        if abs(db) <= EPS:
            db = 0.
        if (da >= 0) != (db >= 0):
            t = da/(da-db)
            out.append(tuple(a[k]+t*(b[k]-a[k]) for k in range(3)))
        if db >= 0:
            out.append(b)
        a, da = b, db
    return unique(out)


def box_faces(lo, hi):
    v = list(itertools.product(*zip(lo, hi)))
    return [[v[i] for i in face] for face in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3))]


def clip_cell(faces, p):
    pts = unique([v for face in faces for v in face])
    if not pts:
        return []
    ds = [distance(v, p) for v in pts]
    if min(ds) >= -EPS:
        return faces
    if max(ds) <= EPS:
        return []
    out = [q for face in faces if len(q:=clip_polygon(face, p)) >= 3]
    cap = unique([v for face in out for v in face if abs(distance(v, p)) < EPS])
    if len(cap) >= 3:
        center = tuple(sum(v[k] for v in cap)/len(cap) for k in range(3))
        u = sub(cap[0], center)
        v = cross(p[:3], u)
        cap.sort(key=lambda x:math.atan2(dot(sub(x, center), v), dot(sub(x, center), u)))
        out.append(cap)
    return out


def sources(s, tag):
    s.cmd('UC_REGION_SOURCES ..\\Output\\'+tag+'.sources')
    result, root = read_sources(s.folder/'Output'/f'{tag}.sources')
    for b in result.values():
        if not b['points']:
            raise Refused('An empty source brush needs Full rebuild.')
    return result, root


def preview(data):
    return [dict(brush=data['surfs'][int(p[0])][0], vertices=vertices(p)) for p in data['polys'] if int(p[6]) >= 3]


def inspect(path):
    s, source, digest = base.open_map(path, 'local-inspect')
    try:
        data = base.snapshots(s, 'inspect')
        brushes, _ = sources(s, 'inspect')
        rows = []
        for name, b in brushes.items():
            pts = b['points']
            lo = [min(p[k] for p in pts) for k in range(3)]
            hi = [max(p[k] for p in pts) for k in range(3)]
            rows.append(dict(name=name, operation=b['operation'], flags=b['flags'], bounds=[lo, hi]))
        return dict(source=str(source), sha256=digest, nodes=len(data['nodes']), brushes=rows, polygons=preview(data))
    finally:
        s.close()


def descendants(data, root):
    seen = set()
    stack = [root]
    while stack:
        i = stack.pop()
        if i in seen or i not in data['nodes']:
            raise Refused('Malformed BSP links.')
        seen.add(i)
        stack.extend(c for c in data['nodes'][i]['children'] if c != -1)
    return seen


def plan(data, old, new, names, root_outside, expand_parents=0):
    if not names or not set(names) <= old.keys() or old.keys() != new.keys():
        raise Refused('Choose existing static brushes.')
    points = [p for n in names for b in (old[n], new[n]) for p in b['points']]
    if any(not math.isfinite(x) for p in points for x in p):
        raise Refused('Non-finite brush coordinates.')
    allpoints = [p for b in list(old.values())+list(new.values()) for p in b['points']]
    lo = [min(p[k] for p in allpoints)-1024 for k in range(3)]
    hi = [max(p[k] for p in allpoints)+1024 for k in range(3)]
    cell = box_faces(lo, hi)
    planes = []
    i = 0
    outside = root_outside
    visited = set()
    ancestors = []
    while True:
        if i in visited:
            raise Refused('Cyclic BSP.')
        visited.add(i)
        node = data['nodes'][i]
        ancestors.append((i, list(planes), copy.deepcopy(cell), outside))
        if node['actor'] in names:
            break
        p = plane(data, i)
        ds = [distance(v, p) for v in points]
        # Touching a partition is affected too: moving a wall off the floor
        # reveals the floor's previous cut-out. Include that ancestor polygon.
        if min(ds) > EPS:
            side = 0
            keep = p
        elif max(ds) < -EPS:
            side = 1
            keep = negate(p)
        else:
            break
        child = node['children'][side]
        if child < 0:
            break
        planes.append(keep)
        cell = clip_cell(cell, keep)
        csg = node['vertices'] > 0 and not node['flags']&0x21
        outside = (outside or csg) if side == 0 else (outside and not csg)
        i = child
    if isinstance(expand_parents, bool) or not isinstance(expand_parents, int) or not 0 <= expand_parents < len(ancestors):
        raise Refused('Invalid local cell expansion.')
    if expand_parents:
        i, planes, cell, outside = ancestors[-1-expand_parents]
    if i == 0:
        raise Refused('This edit reaches the world root. A local rebuild cannot isolate it; use Full.')
    owned = descendants(data, i)
    if any(int(data['surfs'][data['nodes'][j]['surf']][2]) & 0x04000000 for j in owned):
        raise Refused('The affected cell contains a zone portal. Use Full.')
    if any(n['actor'] in names and j not in owned for j, n in data['nodes'].items()):
        raise Refused('The edited brush crosses an unaffected BSP branch; use Full.')
    contributors = []
    retained_portals = []
    for name, b in new.items():
        # Bounds are conservative: false positives cost time; false negatives
        # could lose hidden/revealed geometry and must never be accepted.
        low = [min(v[k] for v in b['points']) for k in range(3)]
        high = [max(v[k] for v in b['points']) for k in range(3)]
        corners = list(itertools.product(*zip(low, high)))
        separation = [max(distance(v, p) for v in corners) for p in planes]
        if any(d <= EPS for d in separation):
            if b['flags'] & 0x04000000 and not any(d < 0 for d in separation):
                certificate = retained_portal_certificate(data, b, planes, owned, EPS)
                if not certificate['safe']:
                    raise Refused('A boundary portal cannot be certified unchanged; use Full.')
                retained_portals.append(dict(brush=name, **certificate))
            continue
        if b['flags'] & 0x04000000:
            raise Refused('Contributing portal brush requires Full rebuild.')
        contributors.append(name)
    return dict(root=i, old_nodes=sorted(owned), total_nodes=len(data['nodes']), planes=planes, cell=cell,
                contributors=contributors, total_brushes=len(new), root_outside=int(outside), selected=sorted(names),
                retained_portals=retained_portals, expanded_parents=expand_parents)


def write_recipe(path, planned, rows):
    cert = planned['zone_certificate']
    if cert.get('mode') == 'per_leaf':
        lines = [f"{planned['root']} {len(rows)} -2", str(len(cert['zones'])), ' '.join(map(str, cert['zones']))]
        lines.append(str(len(cert['leaf_zones'])))
        lines.extend(f'{i} {z}' for i, z in sorted(cert['leaf_zones'].items()))
        lines.append(str(len(cert['node_zones'])))
        lines.extend(f'{i} {z[0]} {z[1]}' for i, z in sorted(cert['node_zones'].items()))
    else:
        lines = [f"{planned['root']} {len(rows)} {cert['zone']}"]
    for r in rows:
        lines.append(' '.join(map(str, [r['source'], *r['children'], len(r['vertices'])])))
        lines.extend(' '.join(format(v, '.9g') for v in p) for p in r['vertices'])
    path.write_text('\n'.join(lines)+'\n')


def compile_clipped(s, scratch, planned, before, old_sources, new_sources, preserve_unaffected, ordered=False, preservation_reference=None, authored_overlap_policy=None, local_preservation_data=None):
    polys = []
    anchors = collect_boundary_anchors(before, planned, surface_key)
    from retained_fragment_scope import retained_intrusions
    from retained_overlap import remove as remove_retained_overlap
    intrusion_groups = {}
    for witness in (retained_intrusions(before, set(planned['old_nodes']), planned['planes'], vertices, EPS) if ordered else []):
        p = before['polys'][witness['node']]
        surface = before['surfs'][int(p[0])]
        actor = surface[0]
        if actor in planned['selected'] or actor not in old_sources or old_sources[actor] != new_sources.get(actor):
            continue
        intrusion_groups.setdefault(surface_key(surface), []).append(vertices(p))
    overlap_repairs = []
    if local_preservation_data is not None:
        if preservation_reference is not None or ordered or not preserve_unaffected:
            raise Refused('Local selection requires its isolated construction strategy.')
        from local_preservation import collect_local_preserved_faces
        preserved = collect_local_preserved_faces(before, scratch, old_sources, new_sources, planned['selected'],
            *local_preservation_data, surface_key, lambda a, b:equivalent_coverage(a, b, authored_overlap_policy=authored_overlap_policy),
            planned.setdefault('local_preservation', {}), lambda a, b:equivalent_coverage(a, b, planned['planes'], authored_overlap_policy))
    elif preservation_reference is not None:
        if not preserve_unaffected or ordered:
            raise Refused('Full-certified preservation requires its explicit independent strategy.')
        from reference_preservation import collect_reference_preserved_faces
        reference_coverage = lambda a, b:equivalent_coverage(a, b, authored_overlap_policy=authored_overlap_policy)
        preserved = collect_reference_preserved_faces(before, scratch, old_sources, new_sources, planned['selected'], surface_key,
                                                   preservation_reference, reference_coverage, planned.setdefault('full_assisted_preservation', {}),
                                                   lambda a, b:equivalent_coverage(a, b, planned['planes'], authored_overlap_policy))
    else:
        preserved = collect_preserved_faces(before, scratch, old_sources, new_sources, planned['selected'], surface_key) if preserve_unaffected else {}
    candidates = []
    for i, p in enumerate(scratch['polys']):
        key = surface_key(scratch['surfs'][int(p[0])])
        if key not in preserved:
            candidates.append((i, vertices(p), key, False))
    for key, face in preserved.items():
        for p in face['polys']:
            vv = vertices(p)
            if preservation_reference is not None or local_preservation_data is not None:
                from preserved_triangles import explicit_triangles
                normal = list(map(float, before['surfs'][int(p[0])][10:13]))
                candidates.extend((face['source'], t, key, True) for t in explicit_triangles(vv, normal))
            else:
                candidates.append((face['source'], vv, key, True))
    welded = 0
    max_weld = 0.
    retained_keys = set()
    retained_polys = 0
    for i, vv, key, retained in candidates:
        for cut in planned['planes']:
            vv = clip_polygon(vv, cut)
        if len(vv) < 3:
            continue
        # Surfaces exactly on a retained ancestor plane belong to the ancestor,
        # not to the inserted subtree (do not duplicate boundary polygons).
        if any(max(abs(distance(v, cut)) for v in vv) < EPS for cut in planned['planes']):
            continue
        vv, audit = weld_vertices(vv, anchors.get(key, ()), planned['planes'])
        welded += audit['count']
        max_weld = max(max_weld, audit['max_distance'])
        if len(vv) > 16:
            raise Refused('Clipping created a face beyond this prototype vertex limit.')
        pieces = [vv]
        if key in intrusion_groups:
            normal = tuple(map(float, scratch['surfs'][int(scratch['polys'][i][0])][10:13]))
            pieces, removed = remove_retained_overlap(vv, intrusion_groups[key], normal)
            if removed:
                overlap_repairs.append(dict(source=scratch['surfs'][int(scratch['polys'][i][0])][:4],
                removed_projected_area=str(removed), pieces=len(pieces), retained_polygons=len(intrusion_groups[key])))
        for piece in pieces:
            if len(piece) > 16:
                raise Refused('Retained overlap subtraction exceeds native polygon limit')
            polys.append((i, piece))
        if retained:
            retained_keys.add(key)
            retained_polys += 1
    if ordered:
        from ordered_partition import prioritize
        polys = prioritize(polys, scratch, before, planned)
    lines = [f"{planned['root_outside']} {len(polys)}"]
    for i, vv in polys:
        lines.append(f'{i} {len(vv)}')
        lines.extend(' '.join(format(x, '.9g') for x in v) for v in vv)
    (s.folder/'Output/clipped.txt').write_text('\n'.join(lines)+'\n')
    if ordered:
        from ordered_partition import compile_ordered
        compile_ordered(s, planned['root'], len(polys))
    else:
        s.cmd((r'UC_REGION_CLIP_PLANES ..\Output\clipped.txt') if preservation_reference is not None or local_preservation_data is not None else (r'UC_REGION_CLIP ..\Output\clipped.txt'))
    s.cmd(r'UC_REGION_DUMP ..\Output\clipped.tree')
    clipped = base.tree(s.folder/'Output/clipped.tree')
    rows = [dict(source=i, children=n['children'], vertices=vertices(clipped['polys'][i])) for i, n in clipped['nodes'].items()]
    # FBspNode allows zero-vertex splitters. Preserve their classification/links.
    if any(0 < len(r['vertices']) < 3 for r in rows):
        raise Refused('The clipped compiler produced a malformed face.')
    planned['retained_overlap_repairs'] = overlap_repairs
    planned['boundary_welding'] = dict(vertices=welded, max_distance=max_weld)
    planned['preserved_unaffected_faces'] = dict(source_faces=len(retained_keys), input_polygons=retained_polys)
    from zone_transfer_multi import certificate
    from zone_preserved_labels import certified_original_labels
    def original_label_provider(indices):
        return certified_original_labels(s.folder/'Output/before.tree', s.folder/'Output/clipped.tree',
            old_sources, new_sources, planned, surface_key, equivalent_coverage, indices)
    planned['zone_certificate'] = certificate(s.folder/'Output/before.tree', s.folder/'Output/clipped.tree', planned,
                                            original_label_provider)
    return rows


def edits(s, old, changes):
    commands = []
    if not isinstance(changes, dict) or not changes:
        raise Refused('Provide at least one brush edit.')
    for name, edit in changes.items():
        if not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*', name) or name not in old:
            raise Refused('Unknown static brush: '+str(name))
        if not isinstance(edit, dict) or set(edit)-{'move', 'scale', 'rotation'}:
            raise Refused('Supported edits: move, scale, rotation.')
        values = {}
        for k, default in (('move', (0, 0, 0)), ('scale', (1, 1, 1)), ('rotation', (0, 0, 0))):
            value = edit.get(k, default)
            if not isinstance(value, (list, tuple)) or len(value) != 3 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in value):
                raise Refused('Each transform must contain three finite numbers.')
            if any(abs(v) > 65536 for v in value):
                raise Refused('Transform out of range.')
            values[k] = value
        if any(v < .05 or v > 20 for v in values['scale']):
            raise Refused('Scale must be between 0.05 and 20.')
        if tuple(values['scale']) != (1, 1, 1):
            commands.append('UC_REGION_SCALE '+name+' '+' '.join(map(str, values['scale'])))
        loc = [a+b for a, b in zip(old[name]['location'], values['move'])]
        rot = [a+round(b*65536/360) for a, b in zip(old[name]['rotation'], values['rotation'])]
        commands.append('UC_SET '+name+' '+' '.join(map(str, loc+rot)))
    for cmd in commands:
        s.cmd(cmd)
    return commands


def surface_key(s):
    # iLightMap is intentionally invalidated; surface identity includes texture,
    # source face, flags, mapping and plane, not transient array indices.
    return tuple(s[:4])+tuple(s[5:7])+tuple(round(float(x), 4) for x in s[7:])


def authored_snapshot(path):
    # Moving geometry legitimately changes the derived zone at an actor origin.
    return {k:re.sub(r'(?m)^    (?:HeadRegion|FootRegion|Region)=.*\n', '', v)
            for k, v in base.actor_snapshot(path).items()}


def cell_geometry(data, planes):
    result = dict(data, polys=[])
    for p in data['polys']:
        vv = vertices(p)
        for cut in planes:
            vv = clip_polygon(vv, cut)
        if len(vv) < 3 or any(max(abs(distance(v, cut)) for v in vv) < EPS for cut in planes):
            continue
        result['polys'].append(p[:6]+[str(len(vv))]+[format(x, '.9g') for v in vv for x in v])
    return result


def equivalent_coverage(a, b, planes=(), authored_overlap_policy=None):
    a, b = cell_geometry(a, planes), cell_geometry(b, planes)
    keys = sorted({surface_key(s) for d in (a, b) for s in d['surfs'].values()})
    ids = {k:i for i, k in enumerate(keys)}
    reference = {}
    for d in (a, b):
        for s in d['surfs'].values():
            reference.setdefault(surface_key(s), s)
    def remap(d):
        q = copy.deepcopy(d)
        q['surfs'] = {i:['All'] for i in ids.values()}
        for p in q['polys']:
            key = surface_key(d['surfs'][int(p[0])])
            p[0] = str(ids[key])
            # Use the same source normal on both sides. Near 45 degrees, float
            # drift in independently compiled node planes can switch axes.
            ref = reference[key]
            normal = list(map(float, ref[10:13]))
            origin = list(map(float, ref[7:10]))
            p[1:4] = ref[10:13]
            p[4] = str(dot(normal, origin))
        return q
    policy = None
    if authored_overlap_policy is not None:
        policy = lambda key, projected, world, normal, tolerance:authored_overlap_policy.check(
            reference[keys[key[0]]], key, projected, world, normal, tolerance)
    return polygon_validation.coverage(remap(a), remap(b), overlap_policy=policy)


def useful_rays(before, after, brushes, names):
    probes = base.rays(before, names)+base.rays(after, names)
    points = [v for n in names for v in brushes[n]['points']]
    low = [min(v[k] for v in points)-64 for k in range(3)]
    high = [max(v[k] for v in points)+64 for k in range(3)]
    seeds = [tuple(low[k]+t[k]*(high[k]-low[k]) for k in range(3)) for t in itertools.product((.1, .3, .5, .7, .9), repeat=3)]
    for b in brushes.values():
        if b['operation'] != 2:
            continue
        lo = [min(v[k] for v in b['points']) for k in range(3)]
        hi = [max(v[k] for v in b['points']) for k in range(3)]
        seeds.extend(tuple(lo[k]+t[k]*(hi[k]-lo[k]) for k in range(3)) for t in itertools.product((.25, .75), repeat=3))
        if len(seeds) > 600:
            break
    for p in seeds:
        for axis in range(3):
            for direction in (-1, 1):
                end = list(p)
                end[axis] += direction*2048
                for extent in ((0, 0, 0), (16, 16, 39)):
                    probes.append((*p, *end, *extent))
    return list(dict.fromkeys(probes))


def occupancy(s, probes):
    points = list(dict.fromkeys((*p[:3], *p[6:]) for p in probes))
    text = s.batch(['UC_REGION_POINT '+' '.join(format(x, '.9g') for x in p) for p in points])
    rows = re.findall(r'^UCMapKit\|region point\|([01] [01])$', text, re.M)
    if len(rows) != len(points):
        raise Refused('Point/volume occupancy probe did not finish.')
    return dict(zip(points, rows))


def compare_collisions(probes, a, b, occupied_a, occupied_b, planes=(), original=None, original_occupancy=None, edit_certificate=None,
                       normal_context=None, normal_audits=None):
    scoped = original is not None
    if scoped != (original_occupancy is not None):
        raise Refused('Incomplete original collision/occupancy reference pair.')
    if len(a) != len(probes) or len(b) != len(probes) or (scoped and len(original) != len(probes)):
        raise Refused('Incomplete collision reference.')
    try:
        if any(row != 'clear' and (len(row.split()) != 7 or any(not math.isfinite(float(v)) for v in row.split()))
               for rows in (a, b, original if scoped else []) for row in rows):
            raise Refused('Invalid collision trace reference.')
    except (TypeError, ValueError, AttributeError):
        raise Refused('Invalid collision trace reference.')
    if occupied_a.keys() != occupied_b.keys() or (scoped and (original_occupancy is None or occupied_a.keys() != original_occupancy.keys())):
        raise Refused('Incomplete occupancy reference.')
    if any(len(p) != 9 or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in p) or min(p[6:]) < 0 for p in probes):
        raise Refused('Invalid collision probe.')
    if set(occupied_a) != {(*p[:3], *p[6:]) for p in probes}:
        raise Refused('Occupancy reference does not cover exactly the probe starts.')
    if any(value not in ('0 0', '0 1', '1 0', '1 1') for values in (occupied_a, occupied_b, original_occupancy if scoped else {}) for value in values.values()):
        raise Refused('Invalid occupancy reference.')
    for point, value in occupied_a.items():
        use_original = scoped and (point_outside_cell(point, planes) or point_outside_edits(point, edit_certificate))
        expected = (original_occupancy if use_original else occupied_b)[point]
        if value != expected:
            error = Refused('Point or player-volume occupancy differs from '+('the original in a certified unchanged region.' if use_original else 'Full rebuild.'))
            error.local_order_retry = True
            raise error
    # UE1 returns arbitrary hit normals/times for sweeps beginning inside solid.
    # Check occupancy there, and compare complete sweeps only from free space.
    differences = []
    tested = 0
    for index, (p, x, y) in enumerate(zip(probes, a, b)):
        if occupied_a[(*p[:3], *p[6:])] != '1 1':
            continue
        tested += 1
        use_original = scoped and (sweep_outside_cell(p, planes) or sweep_outside_edits(p, edit_certificate))
        expected = original[index] if use_original else y
        if not base.traces_equal([x], [expected]):
            difference = dict(ray=p, local=x, full=y, expected=expected, reference='original' if use_original else 'full')
            if not use_original and occupied_b[(*p[:3], *p[6:])] == '1 1' and normal_context is not None and normal_audits is not None:
                try:
                    certificate = certify_phantom_normal(p, x, y, reference='full', **normal_context)
                except PhantomNormalRefused as error:
                    difference['normal_certificate_refusal'] = str(error)
                else:
                    normal_audits.append(dict(probe_index=index, ray=p, local=x, full=y, **certificate))
                    continue
            differences.append(difference)
    if not tested:
        raise Refused('No collision sweeps started in free space.')
    return differences, tested


def _rebuild(path, changes, expected_sha=None, validate_full=True, progress=print, expand_parents=0, preserve_unaffected=False, ordered=False, reference_preservation=False):
    started = time.monotonic()
    s, source, hash_before = base.open_map(path, 'local-geometry')
    report = dict(success=False, source=str(source), source_sha256=hash_before, changes=changes, run=str(s.folder),
                full_reference_requested=validate_full, lighting='stale: rebuild lighting before final use', paths='stale: rebuild paths after geometry edits')
    report['local_strategy'] = 'preserve_unaffected_faces' if preserve_unaffected else 'replay_cell'
    if ordered:
        report['local_strategy'] = 'replay_original_partition'
    report['implementation_sha256'] = {n:base.sha(ROOT/n) for n in CODE}
    output = None
    try:
        if reference_preservation and (not preserve_unaffected or not validate_full or ordered):
            raise Refused('Full-certified preservation requires a separate Full and preservation strategy.')
        if expected_sha and expected_sha != hash_before:
            raise Refused('Map changed since inspection. Open it again.')
        before = base.snapshots(s, 'before')
        old, root_out = sources(s, 'before')
        old_baked = base.baked(s.folder/'Input/source.dx')
        authored_overlap_policy = None
        if reference_preservation:
            from certificate_evidence import read_certificate
            s.cmd(r'UC_CERT_DUMP ..\Output\authored-before.cert')
            authored_before = read_certificate(s.folder/'Output/authored-before.cert')
        report['uv_original_snapshot'] = s.cmd('UC_REGION_UV_SNAPSHOT')
        if 'UCMapKit|region UV snapshot|' not in report['uv_original_snapshot']:
            raise Refused('Original UV source snapshot was not acknowledged.')
        report['edit_commands'] = edits(s, old, changes)
        new, _ = sources(s, 'edited')
        edited = base.snapshots(s, 'edited')
        report['source_edit_volume'] = source_edit_certificate(old, new, set(changes))
        if reference_preservation:
            from authored_overlap import AuthoredOverlapPolicy
            s.cmd(r'UC_CERT_DUMP ..\Output\authored-edited.cert')
            authored_edited = read_certificate(s.folder/'Output/authored-edited.cert')
            authored_overlap_policy = AuthoredOverlapPolicy(authored_before, authored_edited, set(changes))
        if ordered:
            certificate = report['source_edit_volume']
            if not certificate.get('valid'):
                raise Refused('Original-partition strategy requires closed authoritative source volumes.')
            if preserve_unaffected or not validate_full:
                raise Refused('Original-partition strategy requires independent replay with Full.')
        try:
            planned = nonsolid_update.plan(before, old, new, set(changes), root_out)
        except Refused:
            if not validate_full:
                raise
            planned = None
        special = planned is not None
        if not special and not validate_full:
            raise Refused('Only a certified non-solid update can omit Full validation; this edit requires Full.')
        branches = []
        scratches = []
        if not special:
            try:
                if expand_parents:
                    raise Refused('An explicit expansion requires one cell.')
                branches, proof = multi_region.plans(before, old, new, set(changes), root_out)
            except Refused as error:
                report['multi_region_unavailable'] = str(error)
            if branches:
                planned = dict(root=None, old_nodes=sorted({i for p in branches for i in p['old_nodes']}),
                    total_nodes=len(before['nodes']), contributors=list(dict.fromkeys(n for p in branches for n in p['contributors'])),
                    total_brushes=len(new), selected=sorted(changes), planes=[], branches=branches, scope_proof=proof)
                report['local_strategy'] = 'disjoint_detail_cells'
            else:
                planned = plan(before, old, new, set(changes), root_out, expand_parents)
        report['plan'] = planned
        progress(f"Local cell: {len(planned['old_nodes'])}/{planned['total_nodes']} nodes; {len(planned['contributors'])}/{planned['total_brushes']} source brushes.")
        preservation_reference = None
        if reference_preservation:
            if special or branches:
                raise Refused('Full-certified preservation currently supports one ordinary local cell.')
            report['local_strategy'] = 'full_assisted_preservation'
            progress('Building the mandatory independent Full before selecting unchanged Original groups.')
            full_started = time.monotonic()
            s.cmd(r'MAP LOAD FILE="..\Input\source.dx"')
            from precise_full_reference import rebuild as rebuild_precise_reference
            report['precise_full_reference'] = rebuild_precise_reference(s, report['edit_commands'], root_out)
            preservation_reference = base.snapshots(s, 'preservation-full')
            s.cmd(r'MAP SAVE FILE="..\Output\preservation-full.dx"')
            report['preservation_full_sha256'] = base.sha(s.folder/'Output/preservation-full.dx')
            report['full_assisted_preservation'] = dict(oracle_free=False, mandatory_full=True,
                source_sha256=hash_before, edit_commands=list(report['edit_commands']),
                host_sha256=base.sha(ROOT/'bin/UCMapKitHost.exe'), editor_sha256=report['precise_full_reference']['editor_sha256'],
                full_map_sha256=report['preservation_full_sha256'], full_preparation_seconds=round(time.monotonic()-full_started, 3))
            s.cmd(r'MAP LOAD FILE="..\Input\source.dx"')
            acknowledgement = s.cmd('UC_REGION_UV_SNAPSHOT')
            if 'UCMapKit|region UV snapshot|' not in acknowledgement:
                raise Refused('Missing Original UV snapshot after Full.')
            if edits(s, old, changes) != report['edit_commands']:
                raise Refused('Edit commands changed after Full.')
            replay_sources, replay_out = sources(s, 'preservation-edited')
            if replay_sources != new or replay_out != root_out:
                raise Refused('Source replay changed after Full.')
        if special:
            report['local_strategy'] = 'preserve_non_solid_partitions'
            report['replacement_nodes'] = len(planned['non_solid_rows'])
            original_structure = nonsolid_update.structural_state(s, 'original')
            report['native_graft'] = nonsolid_update.apply(s, planned)
            if nonsolid_update.structural_state(s, 'updated') != original_structure:
                raise Refused('Non-solid update changed collision or visibility structure.')
        else:
            report['replacement_nodes'] = 0
            report['native_regions'] = []
            for index, region in enumerate(branches or [planned]):
                names = s.folder/'Output/contributors.txt'
                names.write_text('\n'.join(region['contributors']))
                native_build = s.cmd(r'UC_REGION_BUILD ..\Output\contributors.txt')
                if preservation_reference is not None:
                    prepared = s.cmd('UC_REGION_PREPARE_PRESERVE')
                    if 'UCMapKit|region UV original|' not in prepared:
                        raise Refused('Scratch UV preparation not acknowledged.')
                    report['preservation_uv_preparation'] = prepared
                s.cmd(r'UC_REGION_DUMP ..\Output\scratch.tree')
                scratch = base.tree(s.folder/'Output/scratch.tree')
                scratches.append(scratch)
                clipping_started = time.monotonic()
                rows = compile_clipped(s, scratch, region, before, old, new, preserve_unaffected, ordered, preservation_reference, authored_overlap_policy)
                if preservation_reference is not None:
                    report['full_assisted_preservation']['selection_clipping_zones_seconds'] = round(time.monotonic()-clipping_started, 3)
                report['replacement_nodes'] += len(rows)
                write_recipe(s.folder/'Output/recipe.txt', region, rows)
                command = 'UC_REGION_GRAFT_DEFER' if branches else 'UC_REGION_GRAFT'
                native_graft = s.cmd(command+r' ..\Output\recipe.txt')
                if 'UCMapKit|region zone transfer|' not in native_graft:
                    raise Refused('Native region graft did not acknowledge its complete zone transfer.')
                report['native_regions'].append(dict(root=region['root'], build=native_build, graft=native_graft))
                if branches:
                    for filename in ('scratch.tree', 'clipped.tree', 'recipe.txt'):
                        shutil.copy2(s.folder/'Output'/filename, s.folder/'Output'/f'branch-{index}-{filename}')
            if branches:
                report['native_finish'] = s.cmd('UC_REGION_FINISH')
                if 'UCMapKit|region multi finish|complete' not in report['native_finish']:
                    raise Refused('Deferred regions did not finish.')
            report['leaf_light_cache'] = 'local cache; external lighting equivalence not certified, rebuild lighting before use'
        after = base.snapshots(s, 'after')
        outside = Counter(base.polygon_key(p) for i, p in enumerate(before['polys']) if i not in planned['old_nodes'])
        if outside-base.geometry(after):
            raise Refused('An untouched polygon changed; result withheld.')
        outside_sids = {before['nodes'][i]['surf'] for i in before['nodes'] if i not in planned['old_nodes']}
        for i in outside_sids:
            # Shared surfaces may lose their old lighting binding, but never UVs.
            left, right = before['surfs'][i], after['surfs'][i]
            if left[:4]+left[5:] != right[:4]+right[5:]:
                raise Refused('An untouched surface mapping changed.')
        if before['zones'] != after['zones']:
            error = Refused('Zone connectivity/visibility changed; use Full.')
            error.local_order_retry = True
            raise error
        authored = authored_snapshot(s.folder/'Output/edited.t3d')
        if authored != authored_snapshot(s.folder/'Output/after.t3d'):
            raise Refused('Local build changed authored actor data.')
        probes = useful_rays(before, after, new, changes)
        local_traces = base.trace(s, probes)
        local_occupancy = occupancy(s, probes)
        s.cmd(r'MAP SAVE FILE="..\Output\candidate.dx"')
        report['verified_candidate_sha256'] = base.sha(s.folder/'Output/candidate.dx')
        s.cmd(r'MAP LOAD FILE="..\Output\candidate.dx"')
        reloaded = base.snapshots(s, 'reloaded')
        if base.geometry(after) != base.geometry(reloaded) or after['surfs'] != reloaded['surfs']:
            raise Refused('Saved copy did not retain its geometry.')
        if authored != authored_snapshot(s.folder/'Output/reloaded.t3d'):
            raise Refused('Save/reload changed authored properties.')
        report['verified_exports_sha256'] = {n:base.sha(s.folder/'Output'/n) for n in ('reloaded.t3d', 'reloaded.tree')}
        if base.sha(s.folder/'Output/candidate.dx') != report['verified_candidate_sha256']:
            raise Refused('Saved candidate changed during reload.')
        if not base.traces_equal(local_traces, base.trace(s, probes)):
            raise Refused('Collision changed after reload.')
        lighting = base.baked(s.folder/'Output/candidate.dx')
        if any(old_baked[k] != lighting[k] for k in ('lightmaps', 'bits', 'sources')):
            raise Refused('Stored lighting data was damaged.')
        checks = dict(untouched_polygons=sum(outside.values()), untouched_surface_mappings=len(outside_sids),
                    authored_properties=True, reload=True, collision_reload=len(probes), zones=True, stored_lighting_data=True)
        if special:
            if nonsolid_update.structural_state(s, 'reloaded') != original_structure:
                raise Refused('Reload changed non-solid collision or visibility structure.')
            checks['source_surface_coverage'] = nonsolid_update.validate_surface_coverage(after, planned)
            checks['reloaded_source_surface_coverage'] = nonsolid_update.validate_surface_coverage(reloaded, planned)
            s.cmd(r'MAP LOAD FILE="..\Input\source.dx"')
            original_traces = base.trace(s, probes)
            original_occupancy = occupancy(s, probes)
            if not base.traces_equal(local_traces, original_traces) or local_occupancy != original_occupancy:
                raise Refused('Non-solid edit changed original collision.')
            checks['original_collision_rays'] = len(probes)
            checks['original_point_volume_occupancy'] = len(original_occupancy)
            checks['unchanged_partition_planes_and_hulls'] = True
            checks['serialized_collision_and_visibility_exact'] = True
            report['full_reference_used'] = False
            report['validation_mode'] = 'source-face coverage within SDK bounds and exact unchanged BSP collision structure'
        elif validate_full:
            # Full reorders unrelated BSP too. A sweep certified wholly outside
            # the edited cell must retain the ORIGINAL collision, including edge
            # normals; the globally recompiled map is not its preservation oracle.
            # Crossing/touching/ambiguous sweeps still use mandatory Full.
            s.cmd(r'MAP LOAD FILE="..\Input\source.dx"')
            original_traces = base.trace(s, probes)
            original_occupancy = occupancy(s, probes)
            progress('Validation only: comparing a separate Full rebuild with the local result.')
            if preservation_reference is not None:
                if base.sha(s.folder/'Output/preservation-full.dx') != report['preservation_full_sha256']:
                    raise Refused('Mandatory Full reference changed during local compilation.')
                s.cmd(r'MAP LOAD FILE="..\Output\preservation-full.dx"')
            else:
                from precise_full_reference import rebuild as rebuild_precise_reference
                report['precise_full_reference'] = rebuild_precise_reference(s, report['edit_commands'], root_out)
            full = base.snapshots(s, 'full-reference')
            if preservation_reference is not None and (base.geometry(full) != base.geometry(preservation_reference) or
                    full['surfs'] != preservation_reference['surfs'] or full['zones'] != preservation_reference['zones']):
                raise Refused('Mandatory Full reference changed on reload.')
            try:
                final_coverage = lambda a, b, p:equivalent_coverage(a, b, p, authored_overlap_policy=authored_overlap_policy)
                coverage = [compare_preserved_coverage(
                    before, after, full, reference, old, new, set(changes), region['planes'],
                    surface_key, final_coverage, preserve_unaffected)
                    for region, reference in zip(branches or [planned], scratches)]
                checks['scoped_cell_surface_coverage'] = coverage if branches else coverage[0]
                if branches:
                    checks['global_selected_surface_coverage'] = multi_region.selected_surface_coverage(after, full, set(changes))
            except Refused as e:
                e.local_coverage_retry = True
                raise
            full_traces = base.trace(s, probes)
            full_occupancy = occupancy(s, probes)
            edit_certificate = report['source_edit_volume']
            checks['collision_source_scope'] = edit_certificate
            normal_context = dict(local_tree=after, full_tree=full, old_sources=old, new_sources=new,
                                selected=set(changes), root_outside=root_out,
                                engine=verify_native_backoff(s.folder/'System/Engine.dll'))
            normal_audits = []
            differences, tested = compare_collisions(probes, local_traces, full_traces, local_occupancy, full_occupancy,
                                                  planned['planes'], original_traces, original_occupancy, edit_certificate,
                                                  normal_context, normal_audits)
            checks['full_phantom_normal_certificates'] = normal_audits
            extent_audits = []
            if differences and ordered:
                from extent_reference import certify_differences
                differences, extent_audits = certify_differences(s, differences, probes, local_traces, original_traces,
                    local_occupancy, full_occupancy, original_occupancy, old, new, set(changes))
                checks['native_extent_preservation_certificates'] = extent_audits
            (s.folder/'Output/collision-differences.json').write_text(json.dumps(differences, indent=2))
            if differences:
                error = Refused(f'Local collision differs from its scoped reference ({len(differences)} probes).')
                error.local_order_retry = True
                raise error
            outside_rays = sum(sweep_outside_cell(p, planned['planes']) or sweep_outside_edits(p, edit_certificate)
                             for p in probes if local_occupancy[(*p[:3], *p[6:])] == '1 1')
            checks['original_collision_rays_disjoint_edit_inside_cell'] = sum(
                not sweep_outside_cell(p, planned['planes']) and sweep_outside_edits(p, edit_certificate)
                for p in probes if local_occupancy[(*p[:3], *p[6:])] == '1 1')
            checks['original_collision_rays_native_prefix'] = len(extent_audits)
            checks['full_collision_rays'] = tested-outside_rays-len(extent_audits)
            checks['original_collision_rays'] = outside_rays+len(extent_audits)
            checks['original_point_volume_occupancy'] = sum(point_outside_cell(p, planned['planes']) or point_outside_edits(p, edit_certificate) for p in local_occupancy)
            checks['full_point_volume_occupancy'] = len(local_occupancy)-checks['original_point_volume_occupancy']
            if not checks['full_collision_rays']:
                raise Refused('No free-space collision sweep verifies the edited cell against Full.')
            # The full reference is never saved over the local candidate.
        if base.sha(source) != hash_before:
            raise Refused('The source changed during the operation.')
        if base.sha(s.folder/'Output/candidate.dx') != report['verified_candidate_sha256'] or any(
                base.sha(s.folder/'Output'/n) != h for n, h in report['verified_exports_sha256'].items()):
            raise Refused('Verified candidate or reload exports changed before publication.')
        dest = ROOT/'results'
        dest.mkdir(exist_ok=True)
        output = dest/(source.stem+'-local-'+uuid.uuid4().hex[:8]+'.dx')
        output_sha = copy_verified(s.folder/'Output/candidate.dx', output, report['verified_candidate_sha256'])
        report.update(success=True, output=str(output), output_sha256=output_sha, checks=checks,
                      seconds=round(time.monotonic()-started, 3))
        return report
    except Exception as e:
        report['error'] = str(e)
        e.local_report = report
        raise
    finally:
        s.close()
        (s.folder/'report.json').write_text(json.dumps(report, indent=2))
        if output and report['success']:
            output.with_suffix('.json').write_text(json.dumps(report, indent=2))


def rebuild(path, changes, expected_sha=None, validate_full=True, progress=print, expand_parents=0):
    """At most three independent local attempts, always with the same source SHA.

    Retained faces can repair coverage. The final attempt uses original splitter
    priority for closed source volumes, or Full-assisted preservation for open
    source faces. Every gate remains mandatory; input/host/save failures never retry.
    """
    queue = [(False, False, False)]
    history = []
    pinned = expected_sha
    while queue:
        preserve, ordered, reference = queue.pop(0)
        try:
            result = _rebuild(path, changes, pinned, validate_full, progress, expand_parents, preserve, ordered, reference)
        except Exception as error:
            # Preserve the earlier geometric reason even if the final compiler
            # strategy is unsupported or the native child subsequently fails.
            previous = getattr(error, 'local_report', None)
            if history and isinstance(previous, dict):
                previous['previous_local_attempts'] = list(history)
                previous['previous_local_attempt'] = history[0]
                report_path = Path(previous['run'])/'report.json'
                if report_path.is_file() and report_path.resolve().is_relative_to((ROOT/'runs').resolve()):
                    report_path.write_text(json.dumps(previous, indent=2))
            coverage = isinstance(error, Refused) and getattr(error, 'local_coverage_retry', False)
            boundary = isinstance(error, Refused) and getattr(error, 'local_order_retry', False)
            if not (coverage or boundary) or ordered or reference or not validate_full:
                raise
            previous = error.local_report
            pinned = pinned or previous['source_sha256']
            history.append(dict(run=previous['run'], strategy=previous['local_strategy'], error=previous['error']))
            if coverage and not preserve:
                queue.append((True, False, False))
                progress('Local coverage differs: retrying with unaffected source faces retained.')
            else:
                if previous.get('source_edit_volume', {}).get('valid') is False:
                    queue.append((True, False, True))
                    progress('Open source faces: retrying with Full-certified preservation.')
                else:
                    queue.append((False, True, False))
                    progress('Local boundaries differ: retrying with original splitter priority.')
            continue
        if history:
            result['previous_local_attempts'] = history
            result['previous_local_attempt'] = history[0]
            text = json.dumps(result, indent=2)
            (Path(result['run'])/'report.json').write_text(text)
            Path(result['output']).with_suffix('.json').write_text(text)
        return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('map', type=Path)
    parser.add_argument('--edits', required=True, type=Path)
    parser.add_argument('--validate-full', action='store_true', default=True)
    a = parser.parse_args()
    try:
        print(json.dumps(rebuild(a.map, json.loads(a.edits.read_text()), validate_full=a.validate_full), indent=2))
    except (Refused, RuntimeError, OSError) as e:
        print('REFUSED:', e)
        sys.exit(2)
