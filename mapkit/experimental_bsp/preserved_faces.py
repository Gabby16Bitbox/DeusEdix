"""Preserve compiled faces that cannot be affected by the edited brush volume.

The proof uses the complete authored source face, never only the currently
visible compiled polygons: a hidden portion could otherwise be revealed by an
edit. Returned polygons are copies; this helper performs no native mutation.
"""
import math
from selected_rebuild import Refused

TOLERANCE=.01  # Deus Ex SDK THRESH_SPLIT_POLY_PRECISELY.
COPLANAR_TOLERANCE=.1  # Deus Ex SDK THRESH_POINT_ON_PLANE.

def _points(values):
    try:
        points=[tuple(float(x) for x in value) for value in values]
        if not points or any(len(p)!=3 or not all(math.isfinite(x) for x in p) for p in points):return None
        return points
    except (TypeError,ValueError,OverflowError):return None

def _bounds(points):
    return tuple(min(p[k] for p in points) for k in range(3)),tuple(max(p[k] for p in points) for k in range(3))

def _separated(a,b):
    return any(a[1][k]<b[0][k]-TOLERANCE or a[0][k]>b[1][k]+TOLERANCE for k in range(3))

def _linked_face_points(faces,face_index):
    """Conservatively include every possibly linked coplanar source face.

    The source export does not expose FPoly.iLink. iBrushPoly may therefore
    name one representative of a larger coplanar group. Treat all coplanar
    faces as linked instead of trusting the one referenced visible face.
    """
    parsed=[_points(face) for face in faces]
    if any(face is None or len(face)<3 for face in parsed):return None
    target=parsed[face_index];origin=target[0];best=None;size=0.
    for i in range(1,len(target)-1):
        a=tuple(target[i][k]-origin[k] for k in range(3))
        b=tuple(target[i+1][k]-origin[k] for k in range(3))
        cross=(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
        length=math.sqrt(sum(x*x for x in cross))
        if length>size:best=cross;size=length
    if size<1e-9:return None
    normal=tuple(x/size for x in best)
    def coplanar(face):
        return all(abs(sum((vertex[k]-origin[k])*normal[k] for k in range(3)))<=COPLANAR_TOLERANCE
                   for vertex in face)
    if not coplanar(target):return None
    return [point for face in parsed if coplanar(face) for point in face]

def _poly_points(poly):
    try:
        count=int(poly[6])
        if count<3 or len(poly)!=7+3*count:return None
        return _points([poly[7+i*3:10+i*3] for i in range(count)])
    except (IndexError,TypeError,ValueError):return None

def collect_preserved_faces(before,scratch,old_sources,new_sources,selected,key_for_surface):
    """Map complete surface keys to ``source`` scratch nodes and old ``polys``.

    Selected brushes and faces whose complete old/new source bounds touch the
    selected volume are always rebuilt. Unmapped or malformed references are
    skipped conservatively; invalid selected bounds invalidate the proof.
    """
    selected=set(selected)
    if not selected:raise Refused('Face preservation requires selected brush bounds.')
    edited_points=[]
    for name in sorted(selected):
        for sources in (old_sources,new_sources):
            brush=sources.get(name)
            points=_points(brush.get('points',[])) if isinstance(brush,dict) else None
            if points is None:raise Refused('Cannot prove the edited volume for face preservation.')
            edited_points.extend(points)
    affected=_bounds(edited_points)

    old_polys={};invalid=set()
    for poly in before['polys']:
        try:
            surface=before['surfs'][int(poly[0])];key=key_for_surface(surface)
        except (KeyError,IndexError,TypeError,ValueError):continue
        points=_poly_points(poly)
        if points is None:
            # Zero-vertex BSP splitters have no surface coverage to preserve.
            if len(poly)>6 and str(poly[6])=='0':continue
            invalid.add(key);continue
        old_polys.setdefault(key,[]).append(poly)

    result={}
    for source_index,poly in enumerate(scratch['polys']):
        try:
            surface=scratch['surfs'][int(poly[0])];actor=surface[0];face_index=int(surface[3])
            key=key_for_surface(surface)
        except (KeyError,IndexError,TypeError,ValueError):continue
        if actor in selected or key in result or key in invalid or key not in old_polys:continue
        if _poly_points(poly) is None:continue  # bspNodeToFPoly needs a real face.
        old_brush=old_sources.get(actor);new_brush=new_sources.get(actor)
        if not isinstance(old_brush,dict) or not isinstance(new_brush,dict) or face_index<0:continue
        old_faces=old_brush.get('faces',[]);new_faces=new_brush.get('faces',[])
        if not isinstance(old_faces,(list,tuple)) or not isinstance(new_faces,(list,tuple)):continue
        if face_index>=len(old_faces) or face_index>=len(new_faces):continue
        if old_faces!=new_faces:continue
        complete_face=_linked_face_points(new_faces,face_index)
        if complete_face is None or not _separated(_bounds(complete_face),affected):continue
        # Also guard legacy compiled vertices that drift outside their source
        # face through native merging. Preservation must not cross the edit.
        if any(not _separated(_bounds(_poly_points(p)),affected) for p in old_polys[key]):continue
        result[key]=dict(source=source_index,polys=[list(p) for p in old_polys[key]],
                         actor=actor,face=face_index)
    return result
