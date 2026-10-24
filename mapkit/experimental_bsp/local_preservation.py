"""Local construction recipe: Original is authoritative for unchanged surfaces.

No Full input or precomputed Full evidence is accepted. This helper chooses a
recipe only; its AABB separation is NOT a certificate of the edited CSG volume.
Publication additionally requires independent source/CSG, hull and zone proofs.
"""
from collections import defaultdict
from exact_surface_identity import native, integer, groups, ring
from preserved_faces import _points, _bounds, _separated, _poly_points
from polygon_validation import triangles
from preserved_triangles import explicit_triangles
from selected_rebuild import Refused

MAX_TRIANGLE_PAIRS = 4096


def _mapping(s):
    if len(s) != 19:
        raise Refused('Incomplete local surface provenance.')
    return (s[0], s[1], *(integer(s[k]) for k in (2, 3, 5, 6)), *(native(x) for x in s[7:]))


def _certificate_mapping(s):
    return (s['actor'], s['texture'], s['flags'], s['face'], *s['pan'],
            *(native(x) for field in ('base', 'normal', 'u', 'v') for x in s[field]))


def _provenance(actor, face, certificate, surface):
    faces = certificate['faces']
    if certificate['face_count'] != len(faces) or [f['index'] for f in faces] != list(range(len(faces))):
        raise Refused('Incomplete authored face inventory.')
    if not 0 <= face < len(faces) or faces[face]['link'] != face or any(
            not 0 <= f['link'] < len(faces) or faces[f['link']]['link'] != f['link'] for f in faces):
        raise Refused('Ambiguous authored representative links.')


def collect_local_preserved_faces(before, scratch, old_sources, new_sources, selected,
        before_certificate, edited_certificate, key_for_surface, coverage, audit=None, scratch_coverage=None):
    if audit is None:
        audit = {}
    selected = set(selected)
    audit.update(reference='Original compiled geometry', full_input=False, construction_only=True,
                 independent_csg_volume_certificate_required=True, accepted=[], replayed=[])
    if not selected or not selected <= old_sources.keys() or old_sources.keys() != new_sources.keys():
        raise Refused('Incomplete local source selection.')
    old_cert = {b['name']:b for b in before_certificate['brushes']}
    new_cert = {b['name']:b for b in edited_certificate['brushes']}
    if len(old_cert) != len(before_certificate['brushes']) or len(new_cert) != len(edited_certificate['brushes']):
        raise Refused('Duplicate authoritative brush metadata.')
    edited = []
    for actor in selected:
        for sources in (old_sources, new_sources):
            pts = _points(sources[actor].get('points'))
            if pts is None or not pts:
                raise Refused('Cannot bound the complete edited source.')
            edited.extend(pts)
    envelope = _bounds(edited)
    audit['authored_edit_envelope'] = envelope
    original = defaultdict(list)
    current = defaultdict(list)
    for data, target in ((before, original), (scratch, current)):
        for i, p in enumerate(data['polys']):
            if int(p[6]):
                target[key_for_surface(data['surfs'][int(p[0])])].append((i, p))
    result = {}
    for key, entries in current.items():
        sid = int(entries[0][1][0])
        s = scratch['surfs'][sid]
        actor = s[0]
        def skip(reason):
            audit['replayed'].append(dict(actor=actor, face=s[3], reason=reason))
        if actor in selected or key not in original:
            continue
        old = old_sources.get(actor)
        new = new_sources.get(actor)
        if old is None or old != new or actor not in old_cert or old_cert[actor] != new_cert.get(actor):
            skip('Changed or incomplete entire authoritative source')
            continue
        source_points = _points(old.get('points'))
        if source_points is None or not source_points or not _separated(_bounds(source_points), envelope):
            skip('Whole authoritative source intersects the edit envelope')
            continue
        a = dict(polys=[p for _, p in original[key]], surfs={int(p[0]):before['surfs'][int(p[0])] for _, p in original[key]})
        b = dict(polys=[p for _, p in entries], surfs={int(p[0]):scratch['surfs'][int(p[0])] for _, p in entries})
        original_triangles = sum(int(p[6])-2 for p in a['polys'])
        if original_triangles*original_triangles > MAX_TRIANGLE_PAIRS:
            skip('Original validity proof exceeds bounded work budget')
            continue
        try:
            _provenance(actor, integer(s[3]), old_cert[actor], s)
            original_mappings = {_certificate_mapping(v) for v in before_certificate['surfs'].values()
                               if v['actor'] == actor and v['face'] == integer(s[3])}
            if original_mappings != {_mapping(a['surfs'][int(p[0])]) for p in a['polys']}:
                raise Refused('Original compiled provenance does not match the complete certificate.')
            if len({_mapping(d['surfs'][int(p[0])]) for d in (a, b) for p in d['polys']}) != 1:
                skip('Exact UV/normal/material/role provenance differs')
                continue
            if groups(a) == groups(b):
                skip('Exact Original/Scratch identity')
                continue
            rings = []
            for p in a['polys']:
                points = _poly_points(p)
                if points is None or not _separated(_bounds(points), envelope):
                    raise Refused('Compiled Original group intersects the edit envelope.')
                normal = list(map(float, a['surfs'][int(p[0])][10:13]))
                axis = max(range(3), key=lambda k:abs(normal[k]))
                if not triangles([tuple(v[k] for k in range(3) if k != axis) for v in points]):
                    raise Refused('Invalid complete Original ring.')
                # Recipe refusal is local to this whole group: do not inherit
                # a triangulation that would omit a real compiled corner.
                explicit_triangles(points, normal)
                rings.append(ring(p))
            if len(set(rings)) != len(rings):
                raise Refused('Duplicate Original polygon.')
            # Independently validate the entire Original group, including any
            # narrow authored-overlap proof. Never inherit a malformed group.
            coverage(a, a)
        except Refused as e:
            skip(str(e))
            continue
        if groups(a) == groups(b):
            skip('Exact Original/Scratch identity')
            continue
        pairs = sum(int(p[6])-2 for p in a['polys'])*sum(int(p[6])-2 for p in b['polys'])
        if pairs > MAX_TRIANGLE_PAIRS:
            skip('Complete comparison exceeds bounded work budget')
            continue
        try:
            (scratch_coverage or coverage)(a, b)
        except Refused as e:
            reason = str(e)
        else:
            skip('Scratch already preserves the complete Original surface')
            continue
        value = dict(source=entries[0][0], polys=[list(p) for p in a['polys']], actor=actor, face=int(s[3]),
                   whole_brush_bound=True, local_recipe_only=True)
        result[key] = value
        audit['accepted'].append(dict(actor=actor, face=int(s[3]), polygons=len(a['polys']), reason=reason,
            authority='Original', entire_source_metadata_unchanged=True, dependency_envelope_disjoint=True))
    return result
