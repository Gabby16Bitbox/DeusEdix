"""Exact retained native collision inputs; not a source-intent certificate.

CERT2 resolves all node planes/vertices and surface vectors, and includes the
complete native hull, bound, leaf and zone arrays. Compare its tokens, rather
than parsed Fractions, so signed zero and all serialized float32 bits remain
distinguishable. The strict parser validates the very same byte snapshots.

The caller must separately bind snapshots to actual maps/native profiles and
prove authored edits, UV/lightmap changes, actor preservation, and rendering.
No Full rebuild or finite set of test queries is used or authorized here.
"""
from hashlib import sha256
from pathlib import Path

from certificate_evidence import parse_certificate_bytes
from convex_cells import Refused


_EXACT_TAGS = frozenset(('M', 'N', 'D', 'H', 'L', 'Z'))
# S = tag,index,actor,texture,flags,face,lightmap,panU,panV,
#     Base[3],Normal[3],U[3],V[3]. Only the fields below feed ownership,
# solidity/material semantics. UV and lightmap changes need a separate gate.
_SURFACE_FIELDS = (0, 1, 2, 3, 4, 5, 12, 13, 14)
KNOWN_ENGINE_SHA256 = 'd66b689bbe95d7350b9f348da2273383c642e22e53dd56bd1bcf76ec322aa848'


def _snapshot(payload, *, preserve_ring_points=True):
    if not isinstance(payload, bytes):
        raise Refused('Retained collision evidence must be an immutable byte snapshot')
    data = parse_certificate_bytes(payload)
    # Range checks make forged self-identical malformed snapshots fail closed;
    # equality itself does not reinterpret valid legacy geometry or CSG flags.
    for n in data['nodes'].values():
        if not 0 <= n['vertices'] <= 24 or not 0 <= n['flags'] <= 255:
            raise Refused('Invalid native node count/flags')
        if any(v != -1 and v not in data['nodes'] for v in n['children']):
            raise Refused('Invalid native node link')
        if any(v != -1 and v not in data['leaves'] for v in n['leaves']):
            raise Refused('Invalid native leaf link')
        if n['collision_bound'] != -1 and n['collision_bound'] not in data['hulls']:
            raise Refused('Invalid native hull link')
        if n['render_bound'] != -1 and n['render_bound'] not in data['bounds']:
            raise Refused('Invalid native render bound')
        # Zones is a fixed SDK array of 64 entries, even when NumZones is lower.
        # Legacy maps can retain zone 63 in nodes/leaves. CERT2 exports only
        # NumZones entries: equivalence of remaining ZoneActor slots is external.
        if any(not 0 <= v < 64 for v in n['zones']):
            raise Refused('Invalid native node zone')
        if not 0 <= n['zone_mask'] < 2**64:
            raise Refused('Invalid native zone mask')
    if any(not -2**31 <= v < 2**31 for v in data['hulls'].values()):
        raise Refused('Invalid native hull word')
    if any(not 0 <= s['flags'] < 2**32 for s in data['surfs'].values()):
        raise Refused('Invalid native surface flags')
    for leaf in data['leaves'].values():
        if not 0 <= leaf['zone'] < 64 or not 0 <= leaf['visible'] < 2**64:
            raise Refused('Invalid native leaf zone/visibility')
    for zone in data['zones'].values():
        if any(not 0 <= zone[k] < 2**64 for k in ('connectivity', 'visibility')):
            raise Refused('Invalid native zone masks')
    for bound in data['bounds'].values():
        if bound['valid'] not in (0, 1):
            raise Refused('Invalid native bounds state')
    records = []
    surface_exclusions = []
    for line in payload.decode('utf-8').splitlines():
        row = tuple(line.split())
        if not row:
            continue
        if row[0] in _EXACT_TAGS:
            records.append(row[:19] if row[0] == 'N' and not preserve_ring_points else row)
        elif row[0] == 'S':
            records.append(tuple(row[i] for i in _SURFACE_FIELDS))
            surface_exclusions.append(tuple(row[i] for i in range(len(row))
                                            if i not in _SURFACE_FIELDS))
    return data, tuple(records), tuple(surface_exclusions)


def _certify(before_bytes, after_bytes, reloaded_bytes, *, preserve_ring_points):
    """Necessary whole-model collider invariant, preserving every N token.

    Returns a successful collision gate or raises Refused. This deliberately
    does not authorize publishing a map: profile/source/UV/lightmap/actor gates
    are independent and mandatory. No caller-provided list can exempt nodes.
    """
    snapshots = tuple(_snapshot(p, preserve_ring_points=preserve_ring_points)
                      for p in (before_bytes, after_bytes, reloaded_bytes))
    reference = snapshots[0][1]
    for stage, (_, records, _) in zip(('after', 'reloaded'), snapshots[1:]):
        if records != reference:
            differing = next((i for i, (a, b) in enumerate(zip(reference, records)) if a != b),
                             min(len(reference), len(records)))
            tag = reference[differing][0] if differing < len(reference) else 'added-record'
            raise Refused('Retained collision state changed at '+stage+' '+tag+' record '+str(differing))
    data = snapshots[0][0]
    return {
        'valid': True,
        'certificate': 'retained_native_collision_inputs_exact_tokens_v1',
        'publication_authorized': False,
        'full_used': False,
        'sampled_queries_used': False,
        'snapshot_sha256': dict(zip(('before', 'after', 'reloaded'),
                                   (sha256(p).hexdigest() for p in (before_bytes, after_bytes, reloaded_bytes)))),
        'counts': {k: len(data[k]) for k in ('nodes', 'surfs', 'bounds', 'hulls', 'leaves', 'zones')},
        'exact_records': len(reference),
        'source_edit_not_certified': True,
        'render_ring_points_identical': preserve_ring_points,
        'surface_mapping_or_lightmap_changed': snapshots[0][2] != snapshots[1][2],
        'required_external_gates': ['native_profile_and_map_provenance', 'authored_edit_intent',
                                    'surface_mapping_and_lightmap', 'actor_and_baked_state',
                                    'all_64_native_zone_slots_for_point_region_result'],
    }


def certify_retained_collision_bytes(before_bytes, after_bytes, reloaded_bytes):
    """Strong retained-state gate, including every render-ring coordinate."""
    return _certify(before_bytes, after_bytes, reloaded_bytes, preserve_ring_points=True)


def certify_retained_collision_core_bytes(before_bytes, after_bytes, reloaded_bytes, *, engine_path):
    """Collider equality allowing only coordinates unused by the pinned engine.

    This is a different necessary gate, not an optional exception to the strong
    gate. Native PointCheck/LineCheck/PointRegion do not read the render rings;
    node counts/planes/links/flags/hulls remain exact. The pipeline must prove
    ring targets, all pool aliases, iSide/rendering and native/map provenance.
    """
    try:
        digest = sha256(Path(engine_path).read_bytes()).hexdigest()
    except (OSError, TypeError, ValueError) as error:
        raise Refused('Cannot verify native collider engine') from error
    if digest != KNOWN_ENGINE_SHA256:
        raise Refused('Unverified native engine for render-ring-independent collision')
    result = _certify(before_bytes, after_bytes, reloaded_bytes, preserve_ring_points=False)
    result['certificate'] = 'retained_native_collision_core_exact_tokens_pinned_engine_v1'
    result['engine_sha256'] = digest
    result['required_external_gates'] += ['independent_exact_render_ring_targets',
                                         'vertex_pool_alias_and_render_edge_state']
    return result


def _zone_pool_snapshot(payload):
    if not isinstance(payload, bytes):
        raise Refused('Zone pool evidence must be an immutable byte snapshot')
    try:
        rows = tuple(tuple(line.split()) for line in payload.decode('utf-8').splitlines() if line.strip())
        if len(rows) != 67 or rows[0] != ('ZONEPOOL', '1') or rows[-1] != ('END', '64'):
            raise Refused('Incomplete or unsupported native zone pool')
        if len(rows[1]) != 3 or rows[1][0] != 'M' or rows[1][2] != '64' or not 0 <= int(rows[1][1]) <= 64:
            raise Refused('Invalid native zone pool header')
        for index, row in enumerate(rows[2:-1]):
            if len(row) != 6 or row[0] != 'Z' or row[1] != str(index):
                raise Refused('Missing, duplicate or reordered native zone slot')
            if (row[2] == 'None') != (row[3] == 'None'):
                raise Refused('Inconsistent native zone actor/class')
            if any(not 0 <= int(row[k]) < 2**64 for k in (4, 5)):
                raise Refused('Invalid native zone connectivity/visibility')
    except (UnicodeError, ValueError, TypeError, OverflowError) as error:
        if isinstance(error, Refused):
            raise
        raise Refused('Malformed native zone pool') from error
    return rows


def certify_retained_zone_pool_bytes(before_bytes, after_bytes, reloaded_bytes):
    """All 64 ZoneActor/class/connectivity/visibility slots, not only NumZones.

    Snapshot provenance and live Actor membership belong to the native wrapper.
    This gate complements, and does not replace, retained collision equality.
    """
    snapshots = tuple(_zone_pool_snapshot(p) for p in (before_bytes, after_bytes, reloaded_bytes))
    if snapshots[1] != snapshots[0] or snapshots[2] != snapshots[0]:
        raise Refused('Retained native zone pool changed after edit or reload')
    return dict(valid=True, certificate='retained_native_zone_pool_all64_exact_tokens_v1',
                publication_authorized=False, full_used=False, slots=64,
                num_zones=int(snapshots[0][1][1]),
                snapshot_sha256=dict(zip(('before', 'after', 'reloaded'),
                                        (sha256(p).hexdigest() for p in (before_bytes, after_bytes, reloaded_bytes)))))
