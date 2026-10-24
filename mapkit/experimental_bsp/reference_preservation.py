"""Experimental compiler recipe certified against the mandatory independent Full.

Authored nonplanar FPolys do not specify an unambiguous 3D triangulation. This
helper therefore makes NO source-only claim: it preserves only COMPLETE Original
surface groups which agree with the freshly compiled Full in geometry and UVs.
The complete final candidate still passes all ordinary Full/zone/collision gates.
"""
from collections import defaultdict
from preserved_faces import collect_preserved_faces, _points, _bounds, _separated, _poly_points
from polygon_validation import triangles
from selected_rebuild import Refused
from exact_surface_identity import native, integer, groups, ring

MAX_TRIANGLE_PAIRS = 4096


def uv_signature(surface):
    if len(surface) != 19:
        raise Refused('Incomplete preservation surface mapping.')
    # Normal compatibility is proven separately by the native unchanged-source
    # UV preparation; retain EXACT texture axes/base/pan and ownership here.
    return (surface[0], surface[1], *(integer(surface[k]) for k in (2, 3, 5, 6)),
            *(native(surface[k]) for k in (*range(7, 10), *range(13, 19))))


def collect_reference_preserved_faces(before, scratch, old_sources, new_sources, selected, key_for_surface, full, coverage, audit=None, scratch_coverage=None):
    if audit is None:
        audit = {}
    audit.update(oracle_free=False, criterion='Complete Original group against mandatory Full',
                 triangle_pair_budget=MAX_TRIANGLE_PAIRS, accepted=[], replayed=[])
    selected = set(selected)
    result = collect_preserved_faces(before, scratch, old_sources, new_sources, selected, key_for_surface)
    grouped = defaultdict(list)
    invalid = set()
    for poly in before['polys']:
        surface = before['surfs'][int(poly[0])]
        key = key_for_surface(surface)
        if str(poly[6]) == '0':
            continue
        points = _poly_points(poly)
        if points is None:
            invalid.add(key)
            continue
        grouped[key].append(poly)
        try:
            normal = list(map(float, surface[10:13]))
            axis = max(range(3), key=lambda k:abs(normal[k]))
            if not triangles([tuple(v[k] for k in range(3) if k != axis) for v in points]):
                invalid.add(key)
        except (Refused, ValueError, IndexError):
            invalid.add(key)
    edited = []
    for actor in selected:
        for sources in (old_sources, new_sources):
            points = _points(sources[actor].get('points'))
            if points is None:
                raise Refused('Cannot bound the edited brush for selective preservation.')
            edited.extend(points)
    affected = _bounds(edited)
    eligible = {}
    for source_index, poly in enumerate(scratch['polys']):
        surface = scratch['surfs'][int(poly[0])]
        actor = surface[0]
        key = key_for_surface(surface)
        if actor in selected or key in invalid or key in result or key not in grouped or _poly_points(poly) is None:
            continue
        try:
            face_index = int(surface[3])
        except (ValueError, TypeError, IndexError):
            continue
        source = new_sources.get(actor)
        if not isinstance(source, dict) or not isinstance(source.get('faces'), (list, tuple)) or not 0 <= face_index < len(source['faces']):
            continue
        if actor not in eligible:
            a = old_sources.get(actor)
            b = new_sources.get(actor)
            points = []
            if isinstance(a, dict) and isinstance(b, dict) and a.get('faces') == b.get('faces') and isinstance(b.get('faces'), (list, tuple)):
                for face in b['faces']:
                    parsed = _points(face)
                    if parsed is None or len(parsed) < 3:
                        points = []
                        break
                    points.extend(parsed)
            eligible[actor] = bool(points) and _separated(_bounds(points), affected)
        if not eligible[actor]:
            continue
        if any(not _separated(_bounds(_poly_points(p)), affected) for p in grouped[key]):
            continue
        # Whole authored brush is a superset of every possible linked face.
        result[key] = dict(source=source_index, polys=[list(p) for p in grouped[key]], actor=actor, face=int(surface[3]), whole_brush_bound=True)
    full_groups = defaultdict(list)
    scratch_groups = defaultdict(list)
    for poly in full['polys']:
        if int(poly[6]):
            full_groups[key_for_surface(full['surfs'][int(poly[0])])].append(poly)
    for poly in scratch['polys']:
        if int(poly[6]):
            scratch_groups[key_for_surface(scratch['surfs'][int(poly[0])])].append(poly)
    accepted = {}
    for key, value in result.items():
        def replay(reason):
            audit['replayed'].append(dict(actor=value['actor'], face=value['face'], reason=reason))
        if key in invalid or key not in full_groups:
            replay('Invalid or absent complete group')
            continue
        if old_sources.get(value['actor']) != new_sources.get(value['actor']):
            replay('Changed authoritative source')
            continue
        # No clipping, fragment cancellation or individual-polygon exemption:
        # the complete Original group must match the complete Full group.
        # The coverage API needs only the complete group and its referenced
        # mappings. Avoid deep-copying tens of thousands of unrelated BSP nodes
        # for EACH group; no polygon of the selected group is omitted.
        original = dict(polys=grouped[key], surfs={int(p[0]):before['surfs'][int(p[0])] for p in grouped[key]})
        reference = dict(polys=full_groups[key], surfs={int(p[0]):full['surfs'][int(p[0])] for p in full_groups[key]})
        try:
            mappings = {uv_signature(d['surfs'][int(p[0])]) for d in (original, reference) for p in d['polys']}
            mappings.add(uv_signature(scratch['surfs'][int(scratch['polys'][value['source']][0])]))
            if len(mappings) != 1:
                replay('Exact UV metadata mismatch')
                continue
            original_rings = [ring(p) for p in original['polys']]
            full_rings = [ring(p) for p in reference['polys']]
            if len(set(original_rings)) != len(original_rings) or len(set(full_rings)) != len(full_rings):
                replay('Duplicate complete-group polygon')
                continue
            if groups(original) == groups(reference):
                certificate = dict(exact_native_group_identity=True)
            else:
                pair_count = sum(int(p[6])-2 for p in original['polys'])*sum(int(p[6])-2 for p in reference['polys'])
                if pair_count > MAX_TRIANGLE_PAIRS:
                    replay('Preservation comparison work budget; normal replay required')
                    continue
                certificate = coverage(original, reference)
        except Refused as error:
            replay(str(error))
            continue
        # Keep ordinary CSG output and its ordering whenever it already agrees
        # with Full. Preservation is a geometry repair, not a blanket reorder
        # of hundreds of unrelated valid groups. The certificate above still
        # compares the ENTIRE Original group; only this recipe-choice check may
        # restrict Scratch/Full to the compilation cell.
        current = dict(polys=scratch_groups.get(key, []), surfs={int(p[0]):scratch['surfs'][int(p[0])] for p in scratch_groups.get(key, [])})
        try:
            if groups(current) != groups(reference):
                pair_count = sum(int(p[6])-2 for p in current['polys'])*sum(int(p[6])-2 for p in reference['polys'])
                if pair_count > MAX_TRIANGLE_PAIRS:
                    replay('Scratch comparison work budget; normal replay required')
                    continue
                (scratch_coverage or coverage)(current, reference)
        except Refused as error:
            need_reason = str(error)
        else:
            replay('Scratch already agrees with Full; preserve original compiler ordering')
            continue
        accepted[key] = dict(value, full_group_certificate=certificate)
        audit['accepted'].append(dict(actor=value['actor'], face=value['face'], polygons=len(grouped[key]), certificate=certificate, repair_reason=need_reason))
    return accepted
