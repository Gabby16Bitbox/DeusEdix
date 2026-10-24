"""Conservative collision scope from unchanged ordered CSG source dependencies.

With CSG order, operation and flags unchanged, transformed primitives can
change occupied space only in their old/new volumes. Their AABBs overbound
those volumes. A whole swept AABB separated from every old and new box cannot
see the edit. Existing SDK halo and float32 guards apply to every separation.
Uncertain probes continue to use Full; this does not relax trace comparisons.
"""
import math
from collision_scope import separation_certificate, point_certificate
from source_volume import closed_volume_certificate


def source_edit_certificate(old, new, selected):
    invalid = lambda reason:dict(valid=False, reason=reason, boxes=[])
    try:
        selected = set(selected)
        if not selected or not isinstance(old, dict) or not isinstance(new, dict):
            return invalid('Missing source edit.')
        if list(old) != list(new) or not selected <= old.keys():
            return invalid('Brush set/order changed.')
        boxes = []
        volume_proofs = []
        for name in old:
            a, b = old[name], new[name]
            if not isinstance(a, dict) or not isinstance(b, dict):
                return invalid('Malformed source brush.')
            for field in ('operation', 'flags'):
                if type(a.get(field)) is not int or a.get(field) != b.get(field):
                    return invalid('CSG operation or flags changed.')
            if a['operation'] not in (1, 2) or a['flags'] < 0:
                return invalid('Unsupported CSG operation/flags.')
            if name not in selected:
                if a != b:
                    return invalid('An unlisted source dependency changed.')
                continue
            for stage, source in (('old', a), ('new', b)):
                volume = closed_volume_certificate(source)
                if not volume['valid']:
                    return invalid('Selected '+name+' '+stage+' volume: '+volume['reason'])
                volume_proofs.append(dict(brush=name, stage=stage, **volume))
                points = source.get('points')
                if not isinstance(points, (tuple, list)) or not points:
                    return invalid('Missing source bounds.')
                if any(not isinstance(p, (tuple, list)) or len(p) != 3 or
                       any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in p)
                       for p in points):
                    return invalid('Non-finite or malformed source bounds.')
                lo = [min(p[k] for p in points) for k in range(3)]
                hi = [max(p[k] for p in points) for k in range(3)]
                planes = []
                for axis in range(3):
                    n = [0., 0., 0.]
                    n[axis] = 1.
                    planes.append([*n, lo[axis]])
                    n[axis] = -1.
                    planes.append([*n, -hi[axis]])
                boxes.append(dict(brush=name, stage=stage, minimum=lo, maximum=hi, planes=planes))
        return dict(valid=True, selected=sorted(selected), boxes=boxes,
                    source_order_unchanged=True, operation_and_flags_unchanged=True,
                    unselected_source_dependencies_unchanged=True, selected_volume_proofs=volume_proofs)
    except (TypeError, ValueError, OverflowError, KeyError):
        return invalid('Malformed source dependencies.')


def edit_separation_certificate(probe, certificate, point=False):
    if not isinstance(certificate, dict) or not certificate.get('valid'):
        return dict(outside=False, reason='No source edit locality certificate.')
    boxes = certificate.get('boxes')
    if not isinstance(boxes, list) or not boxes:
        return dict(outside=False, reason='No edited volume bounds.')
    if any(not isinstance(box, dict) for box in boxes):
        return dict(outside=False, reason='Malformed volume certificate.')
    expected = {(name, stage) for name in certificate.get('selected', []) for stage in ('old', 'new')}
    if not expected or len(boxes) != len(expected) or {(box.get('brush'), box.get('stage')) for box in boxes} != expected:
        return dict(outside=False, reason='Incomplete old/new volume certificate.')
    checks = []
    for box in boxes:
        check = (point_certificate if point else separation_certificate)(probe, box.get('planes', ()))
        if not check['outside']:
            return dict(outside=False, reason='Probe may meet an edited volume.', checks=checks+[check])
        checks.append(dict(brush=box.get('brush'), stage=box.get('stage'), **check))
    return dict(outside=True, checks=checks)


def sweep_outside_edits(probe, certificate):
    return edit_separation_certificate(probe, certificate)['outside']


def point_outside_edits(probe, certificate):
    return edit_separation_certificate(probe, certificate, point=True)['outside']
