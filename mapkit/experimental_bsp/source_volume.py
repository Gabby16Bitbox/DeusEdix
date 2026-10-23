"""Fail-closed finite, oriented source-volume guard for collision locality.

Uses exact native float32 vertices. Every edge is split at existing EXACT
collinear vertices, then must occur once in each direction. Each connected
surface component must have positive signed volume (SDK outward winding).
Native source normals must be present, finite, concordant with winding, and
within the existing SDK .01 face-plane bound anchored at Vertex[0], never UV
Base. Projected faces must be simple. Historical normals are never inferred.
No weld epsilon closes a crack. Inverted, open, zero-volume, incomplete or
excessively complex source data cannot authorize Original outside edit bounds.
"""
from collections import Counter,defaultdict
from fractions import Fraction
import math,struct


def _point(value):
    if not isinstance(value,(tuple,list)) or len(value)!=3:raise ValueError('Malformed source vertex')
    out=[]
    for x in value:
        if isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x):raise ValueError('Non-finite source vertex')
        v=struct.unpack('<f',struct.pack('<f',x))[0]
        if not math.isfinite(v):raise ValueError('Non-finite native source vertex')
        out.append(Fraction(v))
    return tuple(out)


def _sub(a,b):return tuple(x-y for x,y in zip(a,b))
def _dot(a,b):return sum(x*y for x,y in zip(a,b))
def _cross(a,b):return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def _orient(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def _on(a,b,p):return _orient(a,b,p)==0 and all(min(a[k],b[k])<=p[k]<=max(a[k],b[k]) for k in (0,1))
def _intersect(a,b,c,d):
    x,y,u,v=_orient(a,b,c),_orient(a,b,d),_orient(c,d,a),_orient(c,d,b)
    return x*y<0 and u*v<0 or _on(a,b,c) or _on(a,b,d) or _on(c,d,a) or _on(c,d,b)


def closed_volume_certificate(source):
    try:
        raw=source.get('faces');points=source.get('points');normals=source.get('face_normals')
        if not isinstance(raw,(list,tuple)) or not raw or not isinstance(points,(list,tuple)) or not points:
            raise ValueError('Missing source faces or points')
        if not isinstance(normals,(tuple,list)) or len(normals)!=len(raw):
            raise ValueError('Missing authoritative native source normals')
        faces=[]
        for index,face in enumerate(raw):
            if not isinstance(face,(tuple,list)) or len(face)<3:raise ValueError('Incomplete source face')
            ring=tuple(_point(p) for p in face)
            if len(set(ring))!=len(ring):raise ValueError('Degenerate source face')
            area=tuple(sum(_cross(_sub(ring[i],ring[0]),_sub(ring[i+1],ring[0]))[k]
                           for i in range(1,len(ring)-1)) for k in range(3))
            if not any(area):raise ValueError('Zero-area source face')
            normal=_point(normals[index]);norm2=_dot(normal,normal)
            if not norm2 or _dot(normal,area)<=0:raise ValueError('Source normal disagrees with outward winding')
            if any(_dot(normal,_sub(v,ring[0]))**2>Fraction(1,10000)*norm2 for v in ring):
                raise ValueError('Source face exceeds SDK precise normal-plane bound')
            axis=max(range(3),key=lambda k:abs(normal[k]));keep=[k for k in range(3) if k!=axis]
            projected=[tuple(v[k] for k in keep) for v in ring]
            if len(set(projected))!=len(projected):raise ValueError('Degenerate projected source face')
            for i,(a,b) in enumerate(zip(projected,projected[1:]+projected[:1])):
                for j,(p,q) in enumerate(zip(projected,projected[1:]+projected[:1])):
                    if j<=i+1 or i==0 and j==len(projected)-1:continue
                    if _intersect(a,b,p,q):raise ValueError('Self-intersecting source face')
            faces.append(ring)
        flat=[v for face in faces for v in face]
        if Counter(flat)!=Counter(_point(p) for p in points):raise ValueError('Source face/point bounds disagree')
        vertices=set(flat)
        if len(flat)*len(vertices)>250000:raise ValueError('Source closure complexity limit')
        directed=defaultdict(list)
        for face_id,ring in enumerate(faces):
            for a,b in zip(ring,ring[1:]+ring[:1]):
                direction=_sub(b,a);length2=_dot(direction,direction)
                if not length2:raise ValueError('Degenerate source edge')
                cuts=[]
                for v in vertices:
                    delta=_sub(v,a);along=_dot(delta,direction)
                    if 0<=along<=length2 and not any(_cross(direction,delta)):cuts.append((along,v))
                ordered=[v for _,v in sorted(cuts)]
                for x,y in zip(ordered,ordered[1:]):directed[x,y].append(face_id)
        if not directed or any(len(ids)!=1 or len(directed.get((b,a),()))!=1 for (a,b),ids in directed.items()):
            raise ValueError('Source mesh is open or non-manifold')
        adjacency=[set() for _ in faces]
        for (a,b),ids in directed.items():
            left,right=ids[0],directed[b,a][0]
            if left==right:raise ValueError('Self-paired source edge')
            adjacency[left].add(right)
        unseen=set(range(len(faces)));volumes=[]
        while unseen:
            seed=unseen.pop();component={seed};stack=[seed]
            while stack:
                for nxt in adjacency[stack.pop()]:
                    if nxt in unseen:unseen.remove(nxt);component.add(nxt);stack.append(nxt)
            origin=faces[seed][0]
            volume=sum(_dot(_sub(faces[i][0],origin),_cross(_sub(faces[i][j],origin),_sub(faces[i][j+1],origin)))
                       for i in component for j in range(1,len(faces[i])-1))/6
            if volume<=0:raise ValueError('Source component has inverted or zero-volume winding')
            volumes.append(str(volume))
        return dict(valid=True,components=len(volumes),positive_signed_volumes=volumes,
                    faces=len(faces),split_edges=len(directed)//2,exact_float32_closure=True,
                    authoritative_normals=True,normal_plane_bound=.01,simple_projected_faces=True)
    except (TypeError,ValueError,KeyError,AttributeError,OverflowError,struct.error) as error:
        return dict(valid=False,reason=str(error))
