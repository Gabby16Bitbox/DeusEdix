"""Connect editable blocks to their exported BSP brushes, never by proximity.

The snapshot is the state used by the build. Current unsaved edits must not be
used to decide where the old geometry is. Ambiguous matches remain unclaimed.
"""
from collections import Counter, defaultdict
from copy import deepcopy

import t3d


def _key(polygons):
    # Native exports can reorder polygons/vertices and drop the package prefix.
    # A millimetric tolerance in UE units absorbs the T3D decimal round trip.
    return tuple(sorted((
        (poly.get('texture') or '').rsplit('.', 1)[-1].casefold(),
        tuple(sorted(tuple(round(float(c), 3) for c in v) for v in vertices)),
    ) for poly, vertices in polygons))


class Collector:
    def __init__(self):
        self.entries = {}

    def add(self, snapshot, brush, drawn=False):
        kind = 'previewDrawn' if drawn else 'previewBox'
        name = ('drawn~' if drawn else 'block~') + snapshot['name']
        entry = self.entries.setdefault(name, dict(kind=kind, snapshot=deepcopy(snapshot), keys=[]))
        entry['keys'].append(_key((p, p['verts']) for p in t3d.polys(brush.t3d())))

    def resolve(self, exported):
        if not self.entries:
            return {}
        candidates = defaultdict(list)
        for actor in t3d.actors(exported):
            # Excludes the editor builder and Movers (independent actor meshes).
            if actor['cls'].rsplit('.', 1)[-1] != 'Brush' or actor['props'].get('CsgOper') != 'CSG_Add':
                continue
            key = _key(t3d.world_verts(actor))
            if key:
                candidates[key].append(actor['name'])
        uses = Counter(k for entry in self.entries.values() for k in entry['keys'])
        result = {}
        for name, entry in self.entries.items():
            keys = entry['keys']
            # Claim every convex part, or none. Never hide someone else's brush
            # when two objects have identical geometry/materials at one position.
            if not keys or any(uses[k] != 1 or len(candidates[k]) != 1 for k in keys):
                continue
            result[name] = dict(label=entry['snapshot']['name'], category='', actors=[],
                                brush_names=[candidates[k][0] for k in keys],
                                pivot=[0, 0, 0], placement=dict(offset=[0, 0, 0], yaw=0),
                                **{entry['kind']: entry['snapshot']})
        return result


def recover(edits, exported):
    """Old build receipts: caller must prove edits match the build fingerprint.

    Generated signs are intentionally excluded: recovery must not generate assets.
    """
    import blocks
    import drawn
    import geom
    import zones
    collector = Collector()
    for b in edits.get('boxes') or []:
        if b.get('mover') or b.get('hole') or b.get('sign') or zones.is_zone_box(b):
            continue
        lo, hi = b['lo'], b['hi']
        if not all(hi[k] > lo[k] for k in range(3)):
            continue
        for br in blocks.brushes(b, geom.Mat(b.get('tex') or 'ClenGreyCncrt_A'), 'Preview'):
            collector.add(b, geom.rotate_brush(br, [(lo[k] + hi[k]) / 2 for k in range(3)], b.get('rot'), False))
    drawings = {p['name']: p for p in edits.get('drawn') or []}
    for name, br in drawn.all_brushes(edits)[0]:
        collector.add(drawings[name], br, drawn=True)
    return collector.resolve(exported)
