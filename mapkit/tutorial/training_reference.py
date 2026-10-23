"""Read chosen architecture from the player's 00_Training, preserving its UVs and scale.

Only scenery is copied. Story triggers, pawns, pickups and the original mission logic
never enter the training map. The original map and its extracted data stay local.
"""
import functools
import re

import geom
import polys
import refscan
import t3d

SCENERY = {'Light', 'Spotlight', 'OfficeChair', 'Plant2', 'ChairLeather', 'Lamp1',
           'WHDeskLibrarySmall', 'WaterCooler'}


@functools.lru_cache(maxsize=1)
def actors():
    refscan.export('00_Training')
    return list(t3d.actors(polys.ref_text('00_Training')))


def vector(raw, key):
    match = re.search(r'^\s*' + key + r'\s+([-+\d.eE,]+)', raw, re.M)
    return tuple(float(v) for v in match[1].split(','))


def brush(actor, offset=(0, 0, 0), materials=None):
    """Bake the original brush transform and UV axes into world-space polygons."""
    props = actor['props']
    main, post = t3d._scale(props, 'MainScale'), t3d._scale(props, 'PostScale')
    rotation = t3d.rot(props.get('Rotation'))
    pre, loc = t3d.vec(props.get('PrePivot')), t3d.vec(props.get('Location'))

    def point(p):
        p = t3d._rotate(tuple((p[k]-pre[k])*main[k] for k in range(3)), rotation)
        return tuple(p[k]*post[k]+loc[k]+offset[k] for k in range(3))

    def axis(v):
        v = t3d._rotate(tuple(v[k]/main[k] for k in range(3)), rotation)
        return tuple(v[k]/post[k] for k in range(3))

    faces = []
    for poly in t3d.polys(actor['body']):
        raw = poly['raw']
        u, v, origin = axis(vector(raw, 'TextureU')), axis(vector(raw, 'TextureV')), point(vector(raw, 'Origin'))
        pan = re.search(r'Pan\s+U=(-?\d+)\s+V=(-?\d+)', raw)
        if pan:
            # Absorb the source's Pan into Origin, including non-orthogonal texture axes.
            uu, vv, uv = geom.dot(u, u), geom.dot(v, v), geom.dot(u, v)
            det = uu*vv-uv*uv
            if abs(det) > 1e-12:
                pu, pv = int(pan[1]), int(pan[2])
                a, b = (pu*vv-pv*uv)/det, (pv*uu-pu*uv)/det
                origin = tuple(origin[k]-a*u[k]-b*v[k] for k in range(3))
        tex = (materials or {}).get(poly['texture'], poly['texture'])
        faces.append(geom.Face([point(p) for p in poly['verts']], geom.Mat(tex, flags=poly['flags']),
                               normal=geom.norm(axis(vector(raw, 'Normal'))), u=u, v=v, origin=origin))
    return geom.Brush(faces)


def transformed(shape, xf):
    return geom.Brush([geom.Face([xf.point(p) for p in f.verts], f.mat,
                                normal=xf.normal(f.normal), u=xf.tex(f.u), v=xf.tex(f.v),
                                origin=xf.point(f.origin)) for f in shape.faces])


def room(scene, lo, hi, pivot, at, materials=None, skip=(), yaw=0):
    """Copy whole brushes inside the chosen bounds in their original CSG order."""
    offset = tuple(at[k]-pivot[k] for k in range(3))
    xf = geom.XForm(pivot, offset=offset, yaw=yaw)
    count = 0
    for actor in actors():
        if actor['name'] in skip:
            continue
        bounds = t3d.bounds(actor) if actor['cls'] == 'Brush' else None
        if bounds and all(bounds[0][k] >= lo[k]-.01 and bounds[1][k] <= hi[k]+.01 for k in range(3)):
            shape = transformed(brush(actor, materials=materials), xf)
            if actor['props'].get('CsgOper') == 'CSG_Subtract':
                scene.sub(shape)
            elif actor['props'].get('CsgOper') == 'CSG_Add':
                scene.add(shape, flags=int(actor['props'].get('PolyFlags', '0')))
            count += 1
        elif actor['cls'] in SCENERY:
            pos = t3d.vec(actor['props'].get('Location'))
            if all(lo[k] <= pos[k] <= hi[k] for k in range(3)):
                # Re-create just rendering/physical properties, with no links into the source map.
                props = {k: v for k, v in actor['props'].items() if k.startswith('Light') or k in
                         ('Skin', 'DrawScale', 'bMovable', 'bInvincible', 'CollisionRadius', 'CollisionHeight')}
                rot = t3d.rot(actor['props'].get('Rotation'))
                scene.actor(actor['cls'], xf.point(pos),
                            rot=(rot[0], (rot[1]+yaw) % 65536, rot[2]), **props)
    if not count:
        raise ValueError('The installed 00_Training has no architecture in the requested region')
    return count


def door_shape():
    """The tutorial's 8 x 64 x 128 leaf, with its original texture alignment."""
    actor = next(a for a in actors() if a['name'] == 'DeusExMover16')
    lo, hi = t3d.bounds(actor)
    centre = tuple((lo[k]+hi[k])/2 for k in range(3))
    shape = brush(actor, tuple(-v for v in centre))
    dims = tuple(hi[k]-lo[k] for k in range(3))
    if any(abs(dims[k]-expected) > .05 for k, expected in enumerate((8, 64, 128))):
        raise ValueError('Unexpected tutorial door dimensions: %r' % (dims,))
    return shape
