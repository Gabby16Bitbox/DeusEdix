"""Make the already Full-certified Original surface explicit before BSP cuts.

The validator defines a deterministic triangulation of each compiled ring.
Replaying those 3D triangles prevents a later split of a nonplanar FPoly from
implicitly choosing a different surface. No new point, plane, UV or tolerance
is introduced. All ordinary final Full and native gates remain mandatory.
"""
import math
from polygon_validation import triangles,area
from selected_rebuild import Refused

def explicit_triangles(points,normal):
    points=[tuple(p) for p in points]
    if not 3<=len(points)<=16 or len(normal)!=3 or any(len(p)!=3 for p in points) or any(isinstance(x,bool) or not math.isfinite(x) for p in points for x in p) or any(isinstance(x,bool) or not math.isfinite(x) for x in normal):
        raise Refused('Malformed preserved polygon triangulation.')
    axis=max(range(3),key=lambda k:abs(normal[k]))
    if not normal[axis]:raise Refused('Preserved polygon has no projection normal.')
    projected=[tuple(x for k,x in enumerate(p) if k!=axis) for p in points]
    lookup={}
    for q,p in zip(projected,points):
        if q in lookup:raise Refused('Preserved polygon projection is ambiguous.')
        lookup[q]=p
    result=[[lookup[q] for q in t] for t in triangles(projected)]
    if not result:raise Refused('Preserved polygon has no explicit triangles.')
    if area(projected)<0:
        for t in result:t.reverse()
    # The selected subset keeps all authored compiled corners. A simplification
    # tolerated by a comparison is not permission to remove a real 3D corner.
    if set(points)!={p for t in result for p in t}:
        raise Refused('Explicit triangulation would omit a preserved corner.')
    return result
