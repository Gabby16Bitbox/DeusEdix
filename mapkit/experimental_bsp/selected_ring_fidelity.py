"""Finite selected-ring fidelity against an independently derived source target.

There is no allowed-rings argument. The target generator consumes Original and
the edited source snapshot only; the candidate is never an input to it. Full
is neither read nor built. Collision, complete zone pool and native FVert/iSide
proofs remain mandatory separate gates.
"""
import hashlib
import struct
import convex_cells as c
from certificate_evidence import parse_certificate_bytes
from retained_bsp_certificate import certify_retained_bsp_bytes, _raw_surfaces_and_sources
from scope_mapping import inventory

Refused = c.Refused


def certify_render_bounds(before, targets):
    """Every target corner must remain inside each unchanged render bound."""
    parents = inventory(before)
    checked = set()
    target_count = 0
    if not targets:
        raise Refused('No independently derived selected targets')
    for index, points in targets.items():
        if type(index) is not int or index not in parents:
            raise Refused('Unknown target node')
        vv = tuple(c.point(p) for p in points)
        if len(vv) != before['nodes'][index]['vertices'] or len(vv) < 3:
            raise Refused('Target would change the native polygon count/role')
        if any(c.native_float(x) != x for p in vv for x in p):
            raise Refused('Target cannot be represented exactly as native FLOAT')
        current = index
        while True:
            bound = before['nodes'][current]['render_bound']
            if bound != -1:
                if bound not in before['bounds']:
                    raise Refused('Missing ancestor render bound')
                box = before['bounds'][bound]
                if box['valid'] != 1:
                    raise Refused('Assigned ancestor render bound is invalid')
                low, high = c.point(box['low']), c.point(box['high'])
                if any(low[k] > high[k] for k in range(3)) or any(not low[k] <= p[k] <= high[k] for p in vv for k in range(3)):
                    raise Refused('Exact selected target escapes an unchanged render bound')
                checked.add((current, bound))
            if parents[current] is None:
                break
            current = parents[current][0]
        target_count += len(vv)
    return dict(status='pass', target_corners=target_count, ancestor_bounds=sorted(checked),
                predicate='exact inclusive containment; no bound reconstruction or epsilon')


def _nodes(payload):
    return {int(row[1]):row for line in payload.decode('utf-8').splitlines()
            if (row:=line.split()) and row[0] == 'N'}


def _bits(tokens):
    return tuple(struct.pack('<f', float(x)) for x in tokens)


def _expected_bytes(before_bytes, targets):
    lines = []
    for line in before_bytes.decode('utf-8').splitlines():
        row = line.split()
        if row and row[0] == 'N' and int(row[1]) in targets:
            row[19:] = [format(float(x), '.9g') for point in targets[int(row[1])] for x in point]
            line = ' '.join(row)
        lines.append(line)
    return ('\n'.join(lines)+'\n').encode('utf-8')


def _check_ring_tokens(before_bytes, after_bytes, targets):
    """Internal fidelity predicate; target authority belongs to the caller above."""
    left, right = _nodes(before_bytes), _nodes(after_bytes)
    if left.keys() != right.keys() or not set(targets) <= left.keys():
        raise Refused('Native node inventory changed or target is unknown')
    for index, row in left.items():
        if index not in targets:
            if row[19:] != right[index][19:]:
                raise Refused('An unselected raw polygon changed')
            continue
        expected = [format(float(x), '.9g') for point in targets[index] for x in point]
        if _bits(right[index][19:]) != _bits(expected):
            raise Refused('Selected native ring differs from the complete source target')


def certify_selected_rings_bytes(before_bytes, edited_bytes, after_bytes, selected):
    """Validate every final polygon/mapping against a source-derived target.

    This proof consumes the independently implemented target generator directly;
    accepting a caller's asserted list would only prove a faithful arbitrary
    recipe. This function deliberately has no such argument.
    """
    from occluded_detail_expansion import expected_selected_rings
    before = parse_certificate_bytes(before_bytes)
    edited = parse_certificate_bytes(edited_bytes)
    after = parse_certificate_bytes(after_bytes)
    if not isinstance(selected, str):
        raise Refused('One selected source name is required')
    # Source-only edit snapshot must precede any mesh/UV mutation.
    certify_retained_bsp_bytes(before_bytes, edited_bytes, [selected])
    target_proof = expected_selected_rings(before, edited, selected)
    if target_proof.get('status') != 'pass' or target_proof.get('full_reference_used') is not False:
        raise Refused('Missing independent source target proof')
    targets = target_proof['targets']
    expected_nodes = {i for i, n in before['nodes'].items() if before['surfs'][n['surf']]['actor'] == selected}
    if set(targets) != expected_nodes:
        raise Refused('Independent target omits/adds a compiled selected polygon')
    if _raw_surfaces_and_sources(edited_bytes)[1] != _raw_surfaces_and_sources(after_bytes)[1]:
        raise Refused('Candidate authored sources differ from the pinned edited snapshot')
    render = certify_render_bounds(before, targets)
    _check_ring_tokens(before_bytes, after_bytes, targets)
    # Construct an explicit expectation, never an alternative native build.
    # The strong gate then checks every other partition/metadata/UV obligation.
    expected_bytes = _expected_bytes(before_bytes, targets)
    fidelity = certify_retained_bsp_bytes(expected_bytes, after_bytes, [selected], allow_selected_uv=True)
    return dict(status='pass', certificate='complete_source_derived_selected_rings_and_retained_model',
        full_reference_used=False, publication_authorized=False,
        before_sha256=hashlib.sha256(before_bytes).hexdigest(),
        edited_sha256=hashlib.sha256(edited_bytes).hexdigest(),
        after_sha256=hashlib.sha256(after_bytes).hexdigest(),
        constructed_expectation_sha256=hashlib.sha256(expected_bytes).hexdigest(),
        source_target=target_proof, render_bounds=render, retained_model=fidelity,
        remaining_gates=['native collision core bytes and pinned implementation',
                         'all 64 native zone-pool slots',
                         'append-only native vertex pool and exact shared-side policy',
                         'source edit request identity, saved-map binding and reload'])
