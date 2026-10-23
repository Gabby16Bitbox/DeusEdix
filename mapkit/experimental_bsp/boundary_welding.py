"""Join a rebuilt cell to retained vertices of the same unchanged surface.

This repairs native float clipping drift at the seam; it does not enlarge the
coverage validator's tolerance. Anchors are actual vertices outside the edited
subtree, and no retained geometry is changed.
"""
import math
from selected_rebuild import Refused

# Local Deus Ex SDK UnMath.h: THRESH_SPLIT_POLY_PRECISELY and
# THRESH_POINTS_ARE_NEAR, respectively. They are engine geometry tolerances.
BOUNDARY_TOLERANCE=.01
WELD_DISTANCE=.015

def _point(value):
    value=tuple(float(x) for x in value)
    if len(value)!=3 or not all(math.isfinite(x) for x in value):
        raise Refused('Invalid vertex in boundary welding.')
    return value

def _distances(vertex,planes):
    return [sum(vertex[k]*plane[k] for k in range(3))-plane[3] for plane in planes]

def _boundary_faces(vertex,planes):
    distances=_distances(vertex,planes)
    if not distances or min(distances)<-BOUNDARY_TOLERANCE:return set()
    return {i for i,distance in enumerate(distances) if abs(distance)<=BOUNDARY_TOLERANCE}

def collect_boundary_anchors(before,planned,key_for_surface):
    """Return independent vertex tuples indexed by the complete surface key.

    Only surviving nodes of unchanged source brushes may supply anchors. A
    vertex must be near a retained ancestor plane and within the other cell
    planes, so vertices elsewhere on an infinite plane cannot attract it.
    """
    owned=set(planned['old_nodes']);selected=set(planned['selected'])
    planes=planned['planes'];result={}
    for index,poly in enumerate(before['polys']):
        if index in owned:continue
        surface=before['surfs'][int(poly[0])]
        if surface[0] in selected:continue
        key=key_for_surface(surface)
        for i in range(int(poly[6])):
            vertex=_point(poly[7+i*3:10+i*3])
            if _boundary_faces(vertex,planes):result.setdefault(key,set()).add(vertex)
    return {key:tuple(sorted(points)) for key,points in result.items()}

def weld_vertices(vertices,anchors,planes):
    """Return a new polygon plus its weld audit; never modify either input.

    The caller selects anchors by the full surface key from
    collect_boundary_anchors. Multiple distinct eligible anchors are refused:
    a nearly coincident corner is not sufficient evidence to guess topology.
    """
    points=[_point(vertex) for vertex in vertices]
    anchor_points=sorted({_point(vertex) for vertex in anchors})
    anchor_faces={vertex:_boundary_faces(vertex,planes) for vertex in anchor_points}
    result=[];count=0;maximum=0.
    for vertex in points:
        faces=_boundary_faces(vertex,planes)
        if not faces or vertex in anchor_faces:
            result.append(vertex);continue
        candidates=[anchor for anchor in anchor_points
                    if faces & anchor_faces[anchor] and math.dist(vertex,anchor)<=WELD_DISTANCE]
        if len(candidates)>1:
            raise Refused('Ambiguous retained boundary vertices; use Full rebuild.')
        if candidates:
            anchor=candidates[0];count+=1;maximum=max(maximum,math.dist(vertex,anchor))
            result.append(anchor)
        else:result.append(vertex)
    # Never collapse a real polygon into a line or silently remove a vertex.
    if len(set(points))>=3 and len(set(result))<3:
        raise Refused('Boundary welding would collapse a polygon; use Full rebuild.')
    return result,dict(count=count,max_distance=maximum)
