"""Exact preservation obligations, separate from source/CSG correctness.

Inputs are complete parsed CERT2 snapshots bound to native bytes by the caller.
This module neither builds nor reads Full. A pass certifies the described
representation only; it NEVER authorizes an authored edit or publication.
"""
from collections import Counter
import itertools
import hashlib
import struct
import convex_cells as c
from certificate_evidence import _surface_identity, parse_certificate_bytes
from scope_mapping import inventory, descendants

Refused = c.Refused


def _integer(value, low=0):
    if type(value) is not int or value < low:
        raise Refused('Malformed native integer')
    return value


def _validate(data):
    if type(data['root_outside']) is not int or data['root_outside'] not in (0, 1):
        raise Refused('Invalid root classification')
    for index, n in data['nodes'].items():
        _integer(index)
        if len(n['children']) != 3 or len(n['zones']) != 2 or len(n['leaves']) != 2:
            raise Refused('Incomplete native node metadata')
        for child in n['children']:
            _integer(child, -1)
        _integer(n['vertices'])
        _integer(n['flags'])
        _integer(n['zone_mask'])
        if len(n['points']) != n['vertices'] or n['vertices'] in (1, 2):
            raise Refused('Malformed native polygon inventory')
        c.plane(n['plane'])
        for point in n['points']:
            c.point(point)
        if n['surf'] not in data['surfs']:
            raise Refused('Unknown native surface')
        for zone in n['zones']:
            # Original maps retain the native unassigned label 63 on some
            # render surfaces. Invariance preserves it; it does not assert that
            # every stored label denotes a live world-zone record.
            if type(zone) is not int or not 0 <= zone < 64:
                raise Refused('Invalid native zone byte')
        for leaf in n['leaves']:
            _integer(leaf, -1)
            if leaf != -1 and leaf not in data['leaves']:
                raise Refused('Unknown native leaf')
        _integer(n['collision_bound'], -1)
        _integer(n['render_bound'], -1)
    for surf in data['surfs'].values():
        _surface_identity(surf)
        if len(surf['pan']) != 2:
            raise Refused('Malformed surface panning')
        for field in ('base', 'normal', 'u', 'v'):
            c.point(surf[field])
    parents = inventory(data)
    brushes = data['brushes']
    if len({b['name'] for b in brushes}) != len(brushes):
        raise Refused('Duplicate source ownership')
    for b in brushes:
        if b['face_count'] != len(b['faces']):
            raise Refused('Incomplete authoritative face inventory')
        if [f['index'] for f in b['faces']] != list(range(b['face_count'])):
            raise Refused('Reordered authoritative face inventory')
        for f in b['faces']:
            if type(f['link']) is not int or not 0 <= f['link'] < b['face_count']:
                raise Refused('Invalid source representative link')
            if b['faces'][f['link']]['link'] != f['link']:
                raise Refused('Noncanonical source representative link')
            for point in f['points']:
                c.point(point)
    return parents


def _source_inventory(before, after, selected):
    selected = list(selected)
    if not selected or len(set(selected)) != len(selected):
        raise Refused('Missing or duplicate selected source')
    a, b = before['brushes'], after['brushes']
    if [(x['order'], x['name']) for x in a] != [(x['order'], x['name']) for x in b]:
        raise Refused('Authoritative source inventory/order changed')
    old = {x['name']: x for x in a}
    new = {x['name']: x for x in b}
    if not set(selected) <= old.keys():
        raise Refused('Unknown selected source')
    if {name for name in old if old[name] != new[name]} != set(selected):
        raise Refused('Changed authored sources differ from selected sources')
    return old, new, set(selected)


def _ring(points):
    return min(points[k:] + points[:k] for k in range(len(points))) if points else points


def _source_uv(surf, brush):
    face = surf['face']
    if type(face) is not int or not 0 <= face < len(brush['faces']):
        raise Refused('Selected surface lacks an authoritative source face')
    f = brush['faces'][face]
    if f['link'] != face:
        raise Refused('Selected surface has an ambiguous representative')
    if surf['texture'] != f['texture'] or surf['flags'] != (f['flags'] | brush['flags']):
        raise Refused('Selected compiled material/role differs from source')
    if surf['pan'] != f['pan'] or any(surf[k] != f[k] for k in ('base', 'normal', 'u', 'v')):
        raise Refused('Selected compiled mapping differs from authoritative source')
    return f


def _surface_pair(a, b, old, new, selected, allow_selected_uv):
    equal = _surface_identity(a) == _surface_identity(b)
    if not allow_selected_uv or a['actor'] not in selected:
        if not equal:
            raise Refused('Retained surface mapping changed')
        return False
    if b['actor'] != a['actor']:
        raise Refused('Selected surface ownership changed')
    # A UV update is derived here from complete source metadata. The caller
    # cannot authorize arbitrary changed surfaces by passing their new values.
    oa = _source_uv(a, old[a['actor']])
    nb = _source_uv(b, new[a['actor']])
    if any(a[k] != b[k] for k in ('actor', 'face', 'texture', 'flags', 'normal')):
        raise Refused('Selected UV update altered material, owner or normal')
    if any(oa[k] != nb[k] for k in ('index', 'link', 'flags', 'texture', 'normal')):
        raise Refused('Selected UV update altered authored geometric role')
    return not equal


def certify_retained_bsp(before, after, selected, root=None, allow_selected_uv=False):
    """Prove the entire retained map, or the entire BSP for a source-only edit.

    With root=None, all node indices, bounds, hulls, leaves and lighting bindings
    must remain exactly unchanged. A regional call certifies the complete
    retained topology/surfaces/zone metadata; replacement and hull correctness
    require separate proofs. Exact authored UV updates are whole-BSP only.
    """
    try:
        return _certify(before, after, selected, root, allow_selected_uv)
    except (KeyError, IndexError, TypeError, ValueError, OverflowError) as error:
        if isinstance(error, Refused):
            raise
        raise Refused('Malformed retained-BSP evidence') from error


def _certify(before, after, selected, root, allow_selected_uv):
    bp = _validate(before)
    _validate(after)
    old, new, selected = _source_inventory(before, after, selected)
    whole = root is None
    if type(allow_selected_uv) is not bool or allow_selected_uv and not whole:
        raise Refused('Source-derived UV updates require an otherwise unchanged entire BSP')
    if not whole and (type(root) is not int or root <= 0 or root not in bp):
        raise Refused('A strict non-root replacement is required')
    if before['root_outside'] != after['root_outside'] or before['zones'] != after['zones']:
        raise Refused('World root or zone connectivity/visibility changed')
    path = []
    at = root
    while at:
        parent, side = bp[at]
        if side == 2:
            raise Refused('Regional root is reached through an iPlane continuation')
        path.append((parent, side))
        at = parent
    path.reverse()
    planes = [before['nodes'][i]['plane'] if side == 0 else
              tuple(-x for x in before['nodes'][i]['plane']) for i, side in path]
    mapping = {}
    replacement = None
    stack = [(0, 0)]
    uv_updates = set()
    while stack:
        left, right = stack.pop()
        if not whole and left == root:
            if replacement is not None:
                raise Refused('Multiple replacement branches')
            replacement = right
            continue
        a, b = before['nodes'][left], after['nodes'][right]
        if any(a[k] != b[k] for k in ('vertices', 'flags', 'plane', 'zones', 'zone_mask')) or _ring(a['points']) != _ring(b['points']):
            raise Refused('A retained native partition, polygon or zone label changed at node '+str(left))
        sa, sb = before['surfs'][a['surf']], after['surfs'][b['surf']]
        if _surface_pair(sa, sb, old, new, selected, allow_selected_uv):
            uv_updates.add((sa['actor'], sa['face']))
        light_ok = sa['lightmap'] == sb['lightmap'] or (allow_selected_uv and sa['actor'] in selected and sb['lightmap'] == -1)
        if whole and (left != right or any(a[k] != b[k] for k in ('collision_bound', 'render_bound', 'leaves')) or not light_ok):
            raise Refused('Whole-BSP update changed native storage, bounds or lighting binding')
        if not whole and sa['actor'] in selected:
            raise Refused('Selected compiled surface exists outside replacement ownership')
        mapping[left] = right
        for side, (x, y) in enumerate(zip(a['children'], b['children'])):
            if x == -1 or y == -1:
                if x != y:
                    raise Refused('A retained branch appeared or disappeared')
                if side < 2:
                    la, lb = a['leaves'][1-side], b['leaves'][1-side]
                    if before['leaves'].get(la) != after['leaves'].get(lb):
                        raise Refused('A retained terminal leaf changed')
            else:
                stack.append((x, y))
    owned_before = set() if whole else descendants(before, root)
    owned_after = set() if whole else descendants(after, replacement)
    if set(mapping) != before['nodes'].keys()-owned_before or set(mapping.values()) != after['nodes'].keys()-owned_after:
        raise Refused('Retained mapping is not complete and bijective')
    if whole and any(before[k] != after[k] for k in ('bounds', 'hulls', 'leaves')):
        raise Refused('Whole-BSP native collision/leaf caches changed')
    if whole:
        if before['surfs'].keys() != after['surfs'].keys():
            raise Refused('Whole-BSP surface inventory changed')
        for sid, sa in before['surfs'].items():
            sb = after['surfs'][sid]
            if _surface_pair(sa, sb, old, new, selected, allow_selected_uv):
                uv_updates.add((sa['actor'], sa['face']))
            if sa['lightmap'] != sb['lightmap'] and not (allow_selected_uv and sa['actor'] in selected and sb['lightmap'] == -1):
                raise Refused('Whole-BSP lighting binding changed without authorization')
    return dict(status='pass', publication_authorized=False, source_intent_certified=False,
        parsed_representation_only=True,
        scope='entire_BSP' if whole else 'retained_outside', outside_map=mapping,
        before_owned=sorted(owned_before), after_owned=sorted(owned_after), after_root=replacement,
        ancestry=path, planes=planes, selected=sorted(selected), source_uv_updates=sorted(uv_updates),
        remaining_obligations=['authored edit intent and complete affected source support']+
        (['raw native collision/state equality including signed zeros', 'all 64 native zone-pool slots'] if whole else
         ['replacement surfaces/zone semantics', 'native collision hulls']),
        lighting_note='CERT2 exposes leaf light-list indices, not the pointed-to actor lists',
        zone_note='CERT2 contains the NumZones prefix; referenced native slot 63 may require a separate complete zone-pool snapshot')


def _raw_surfaces_and_sources(payload):
    surfaces = {}
    sources = {}
    current = None
    for line in payload.decode('utf-8').splitlines():
        row = line.split()
        if not row:
            continue
        if row[0] == 'S':
            surfaces[int(row[1])] = row
        elif row[0] == 'B':
            current = row[2]
            sources[current] = {'rows':[row], 'faces':{}}
        elif row[0] == 'F':
            sources[current]['rows'].append(row)
            sources[current]['faces'][int(row[1])] = row
    return surfaces, sources


def _float_bits(tokens):
    return tuple(struct.pack('<f', float(x)) for x in tokens)


def certify_retained_bsp_bytes(before_bytes, after_bytes, selected, allow_selected_uv=False):
    """Whole-BSP source/UV gate on the exact native byte snapshots.

    Collision must additionally pass certify_retained_collision_bytes. This
    wrapper preserves signed-zero distinctions for source/UV fields; it never
    substitutes decimal/rational equality for a native mapping-bit comparison.
    """
    before = parse_certificate_bytes(before_bytes)
    after = parse_certificate_bytes(after_bytes)
    proof = certify_retained_bsp(before, after, selected, allow_selected_uv=allow_selected_uv)
    a, old = _raw_surfaces_and_sources(before_bytes)
    b, new = _raw_surfaces_and_sources(after_bytes)
    selected = set(selected)
    for name in old:
        if name not in selected and old[name]['rows'] != new[name]['rows']:
            raise Refused('An unselected raw authored source changed')
    for sid, left in a.items():
        right = b[sid]
        actor = left[2]
        if not allow_selected_uv or actor not in selected:
            if left != right:
                raise Refused('A raw retained surface record changed')
            continue
        # Parsed checks already bind ownership, face/link, material, role and
        # the only permitted lightmap transition. Repeat mapping comparison
        # at float32 bit level so -0 cannot masquerade as +0.
        f = new[actor]['faces'][int(right[5])]
        # Base/U/V are newly appended from the edited FPoly and must match its
        # bits. Normal is NOT rewritten: the old vector pool may already have
        # canonicalized an authored -0 to +0. Preserve those original normal
        # bits instead of pretending to repair the native representation.
        if _float_bits(right[9:12]+right[15:21]) != _float_bits(f[8:11]+f[14:20]):
            raise Refused('Selected native UV mapping bits differ from authoritative source')
        if _float_bits(left[12:15]) != _float_bits(right[12:15]):
            raise Refused('Selected native normal bits changed')
    proof['raw_source_and_surface_bits'] = 'pass'
    proof['before_sha256'] = hashlib.sha256(before_bytes).hexdigest()
    proof['after_sha256'] = hashlib.sha256(after_bytes).hexdigest()
    return proof


def contributor_obligations(data, planes, contributors):
    """Exact conservative support test; touching is deliberately not excluded."""
    try:
        cuts = [c.plane(p) for p in planes]
        names = list(contributors)
        ordered = [b['name'] for b in data['brushes']]
        if not cuts or len(names) != len(set(names)) or not set(names) < set(ordered):
            raise Refused('Malformed or nonlocal contributor inventory')
        if names != [n for n in ordered if n in names]:
            raise Refused('Contributors changed authored order')
        excluded = {}
        unresolved = []
        for b in data['brushes']:
            if b['name'] in names:
                continue
            points = [c.point(v) for f in b['faces'] for v in f['points']]
            if not points:
                raise Refused('An omitted source has no complete support')
            low = tuple(min(v[k] for v in points) for k in range(3))
            high = tuple(max(v[k] for v in points) for k in range(3))
            corners = list(itertools.product(*zip(low, high)))
            distances = [max(c.distance(v, p) for v in corners) for p in cuts]
            witnesses = [i for i, value in enumerate(distances) if value < 0]
            if witnesses:
                excluded[b['name']] = witnesses[0]
            else:
                unresolved.append(dict(actor=b['name'], kind='boundary_contact' if 0 in distances else 'potential_interior',
                    max_cut_distances=tuple(distances), operation=b['operation'], flags=b['flags']))
        return dict(status='pass' if not unresolved else 'refused', publication_authorized=False,
                    excluded=excluded, unresolved=unresolved, contributors=names,
                    contract='Complete AABB strictly outside at least one exact ancestor halfspace; no epsilon')
    except (KeyError, IndexError, TypeError, ValueError, OverflowError) as error:
        if isinstance(error, Refused):
            raise
        raise Refused('Malformed contributor evidence') from error
