"""UnrealEd's clipboard: the editor's selection as the T3D text UnrealEd's Edit > Paste takes, and the T3D text
UnrealEd's Edit > Copy puts on the clipboard read back as blocks and objects (the editor's Edit > Copy as T3D,
Paste T3D, and Ctrl+V when the clipboard holds T3D).

UnrealEd copies actors as a map export: Begin Map, a Begin Actor block each, End Map. A brush is a Brush actor with
its CsgOper and PolyFlags, its polygons (Begin Brush) relative to its Location, and Brush=Model'MyLevel.<model>'.

- export(items, holes): the selection as the editor's own clipboard holds it (static/app.js clipboardItem: kinds
  'box', 'drawn', 'actor'). A block is a brush (a hole subtracts, a detail block is semisolid), a drawing the pieces
  the build makes of it (cut by the holes, semisolid: editor/drawn.py), an object its class, place, turn, size and
  properties (as the build writes it, Scene._block). The pieces of the map (structures) are its own brushes: they
  are copied in UnrealEd itself.
- read(text): brushes become blocks with their own corners, convex as a block is (a concave brush, a sheet and the
  builder brush are left out and said), the other actors objects. A mover is left out: its keys and its brush are
  more than a block holds.
"""
import re
from collections import Counter

import blocks
import drawn
import geom
import t3d
from scene import PF_INVISIBLE, PF_NOTSOLID, PF_SEMISOLID, Scene
from vec3 import Vec3

# an actor's lines that belong to the map it was in (its level, its zone, where it was), not to the actor
MAP_BOOKKEEPING = {'Level', 'Region', 'Name', 'Location', 'Rotation', 'OldLocation', 'ColLocation', 'DistanceFromPlayer',
                   'bSelected', 'Base', 'Owner', 'Instigator', 'Brush', 'PrePivot', 'MainScale', 'PostScale', 'TempScale',
                   'CsgOper', 'PolyFlags'}
CONVEX_TOLERANCE = 0.5      # world units a corner may stand out of a face's plane in a brush still taken as convex
SHEET = 1.0                 # a brush thinner than this is a sheet (a zone portal, a decal): not a block
POLYGON_TEXTURE = re.compile(r'(Begin Polygon[^\n]*?Texture=)(\S+)')


def _texture_refs(text):
    """Polygon textures by their full names where the catalog knows them: UnrealEd finds a texture of any loaded
    package by its full name, not always by its short one."""
    return POLYGON_TEXTURE.sub(lambda m: m.group(1) + (blocks.texture_ref(m.group(2)) or m.group(2)), text)


def _brush_actor(name, brush, csg, flags):
    """A Brush actor at the middle of the brush, its polygons relative to it."""
    lo, hi = brush.bounds()
    mid = tuple(round((lo[k] + hi[k]) / 2, 1) for k in range(3))
    body = brush.t3d(xf=geom.XForm((0.0, 0.0, 0.0), offset=tuple(-c for c in mid)))
    model = name + 'Model'
    body = body.replace('Begin Brush Name=%s' % brush.name, 'Begin Brush Name=%s' % model, 1)
    return ('Begin Actor Class=Brush Name=%s\n    CsgOper=%s\n    PolyFlags=%d\n    Location=(X=%.6f,Y=%.6f,Z=%.6f)\n'
            '%s    Brush=Model\'MyLevel.%s\'\nEnd Actor\n' % ((name, csg, flags) + mid + (_texture_refs(body), model)))


def export(items, holes=()):
    """T3D text of the selection for UnrealEd's Edit > Paste: {'text', 'skipped': [what was not, and why]}."""
    out, skipped = [], []
    for it in items:
        kind = it.get('kind')
        if kind == 'box':
            b = it['box']
            if b.get('mover') or b.get('water') or b.get('portal'):
                skipped.append('%s: water, zone portals and moving blocks are made of several actors' % b.get('name'))
                continue
            centre = [(b['lo'][k] + b['hi'][k]) / 2 for k in range(3)]
            csg = 'CSG_Subtract' if b.get('hole') else 'CSG_Add'
            flags = 0 if b.get('hole') or b.get('solid') else PF_SEMISOLID
            pieces = blocks.brushes(b, geom.Mat(b.get('tex') or 'ClenGreyCncrt_A'), b['name'])
            for i, br in enumerate(pieces):          # a hollow shape: its convex pieces, a brush each
                name = b['name'] if len(pieces) == 1 else '%s_%d' % (b['name'], i)
                out.append(_brush_actor(name, geom.rotate_brush(br, centre, b.get('rot')), csg, flags))
        elif kind == 'drawn':
            d = it['drawn']
            built, report = drawn.all_brushes({'drawn': [d], 'boxes': list(holes)})
            skipped += report
            for i, (_name, br) in enumerate(built):
                out.append(_brush_actor('%s_%d' % (d.get('name', 'Drawn'), i), br, 'CSG_Add', PF_SEMISOLID))
        elif kind == 'actor':
            props = {k: v for k, v in (it.get('props') or {}).items()
                     if k not in MAP_BOOKKEEPING and "'MyLevel." not in str(v)}
            scale = float(it.get('scale') or 1)
            if abs(scale - 1) > 1e-3 and 'DrawScale' not in props:
                props['DrawScale'] = '%.4f' % scale
            # a name of its own: UnrealEd frees the name for a pasted actor by renaming the map's actor that has it
            name = '%s_DeusEdix%d' % (it['cls'].split('.')[-1], len(out))
            out.append(Scene._block(it['cls'], tuple(it['loc']), name, tuple(int(v) for v in it.get('rot') or (0, 0, 0)), '', props))
        else:
            skipped.append('%s: a piece of the map, copy it in UnrealEd itself' % (it.get('label') or it.get('group') or kind))
    return dict(text='Begin Map\n' + ''.join(out) + 'End Map\n' if out else '', skipped=skipped)


def _normal(vs):
    """A polygon's normal (Newell's method: any winding, any number of corners)."""
    n = Vec3(0.0, 0.0, 0.0)
    for a, b in zip(vs, vs[1:] + vs[:1]):
        n = n + Vec3((a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1]))
    return n.normalized() if n.length() > 1e-9 else None


def _block(actor):
    """A block from a Brush actor: (block, what it did not keep or None), or (None, why it is not one)."""
    p = actor['props']
    csg = p.get('CsgOper', 'CSG_Active')
    if csg not in ('CSG_Add', 'CSG_Subtract'):
        return None, 'the builder brush (or a brush not added nor subtracted)'
    flags = int(p.get('PolyFlags') or 0)
    if flags & (PF_INVISIBLE | PF_NOTSOLID):
        return None, 'an invisible or non-solid brush'
    polys = [(poly, vs) for poly, vs in t3d.world_verts(actor) if len(vs) >= 3]
    pts = [v for _poly, vs in polys for v in vs]
    if not pts:
        return None, 'no polygons'
    lo = [min(v[k] for v in pts) for k in range(3)]
    hi = [max(v[k] for v in pts) for k in range(3)]
    if min(hi[k] - lo[k] for k in range(3)) < SHEET:
        return None, 'a sheet'
    middle = Vec3(*(sum(v[k] for v in pts) / len(pts) for k in range(3)))
    for _poly, vs in polys:                 # every corner behind every face (turned out of the middle): convex
        n = _normal(vs)
        if n is None:
            continue
        if n.dot(middle - vs[0]) > 0:
            n = -n
        if any(n.dot(Vec3.of(v) - vs[0]) > CONVEX_TOLERANCE for v in pts):
            return None, 'not convex (split it in UnrealEd, or rebuild it with blocks)'
    textures = Counter(str(poly['texture'] or '').split('.')[-1] for poly, _vs in polys)
    shares = []
    for v in pts:
        s = [round((v[k] - lo[k]) / (hi[k] - lo[k]), 4) for k in range(3)]
        if s not in shares:
            shares.append(s)
    box = dict(lo=[round(c, 1) for c in lo], hi=[round(c, 1) for c in hi], rot=[0, 0, 0],
               tex=textures.most_common(1)[0][0] or 'ClenGreyCncrt_A', verts=shares)
    if csg == 'CSG_Subtract':
        box['hole'] = True
    else:
        box['solid'] = not flags & PF_SEMISOLID
    return box, None if len(textures) == 1 else 'its faces had %d textures: the block takes %s' % (len(textures), box['tex'])


def read(text):
    """What UnrealEd copied: {'boxes': [blocks], 'added': [objects], 'skipped': [what was not taken, and why],
    'notes': [what a block did not keep]}, at the places they had in UnrealEd's map; the editor names them."""
    out = dict(boxes=[], added=[], skipped=[], notes=[])
    found = list(t3d.actors(text or ''))
    if not found:
        raise ValueError('No T3D here: copy actors or brushes in UnrealEd (Edit > Copy) first.')
    for a in found:
        cls, p = a['cls'], a['props']
        short = cls.split('.')[-1]
        if short == 'Brush':
            box, why = _block(a)
            if box:
                out['boxes'].append(box)
            if why:
                out['notes' if box else 'skipped'].append('%s: %s' % (a['name'], why))
        elif 'Mover' in short:
            out['skipped'].append('%s: a mover (a door, a lift): its brush and keys are more than a block holds' % a['name'])
        else:
            out['added'].append(dict(cls=cls, loc=list(t3d.vec(p.get('Location'))), rot=list(t3d.rot(p.get('Rotation'))),
                                     props={k: v for k, v in p.items() if k not in MAP_BOOKKEEPING and "'MyLevel." not in v}))
    return out
