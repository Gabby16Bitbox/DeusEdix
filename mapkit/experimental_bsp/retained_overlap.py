"""Exact planar subtraction of unchanged retained fragments from replacement faces.

No projection drift is permitted: all input points must lie on exactly the same
native-float source plane. Existing world polygons are never changed. This only
prevents counting their coverage twice; Full and every other gate remain required.
"""
from fractions import Fraction
from collections import Counter
import convex_cells as c
from selected_rebuild import Refused

def turn(a,b,p):return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
def area(p):return sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(p,p[1:]+p[:1]))/2
def clean(p):
    out=[]
    for v in p:
        if not out or v!=out[-1]:out.append(v)
    if len(out)>1 and out[0]==out[-1]:out.pop()
    return out
def on(p,a,b):return turn(a,b,p)==0 and all(min(a[k],b[k])<=p[k]<=max(a[k],b[k]) for k in (0,1))
def intersect(a,b,x,y):
    return (turn(a,b,x)*turn(a,b,y)<0 and turn(x,y,a)*turn(x,y,b)<0) or on(x,a,b) or on(y,a,b) or on(a,x,y) or on(b,x,y)
def triangulate(poly):
    p=clean(poly)
    if len(p)<3:return []
    for i,(a,b) in enumerate(zip(p,p[1:]+p[:1])):
        for j,(x,y) in enumerate(zip(p,p[1:]+p[:1])):
            if j<=i+1 or (i==0 and j==len(p)-1):continue
            if intersect(a,b,x,y):raise Refused('Retained overlap input is not a simple polygon')
    if not area(p):return []
    if area(p)<0:p.reverse()
    initial=area(p);triangles=[]
    while len(p)>3:
        for i,b in enumerate(p):
            a,z=p[i-1],p[(i+1)%len(p)];cross=turn(a,b,z)
            if cross==0 and on(b,a,z):p.pop(i);break
            if cross<=0:continue
            if any(all(turn(x,y,q)>=0 for x,y in ((a,b),(b,z),(z,a))) for j,q in enumerate(p)
                   if j not in ((i-1)%len(p),i,(i+1)%len(p))):continue
            triangles.append([a,b,z]);p.pop(i);break
        else:raise Refused('Retained overlap input cannot be triangulated exactly')
    if len(p)==3 and area(p):triangles.append(p)
    if sum(area(t) for t in triangles)!=initial:raise Refused('Exact retained overlap triangulation changed area')
    return triangles
def half(poly,a,b,inside=True):
    if not poly:return []
    out=[];s=poly[-1];ds=turn(a,b,s)
    for e in poly:
        de=turn(a,b,e)
        if ds*de<0:
            t=ds/(ds-de);out.append(tuple(s[k]+t*(e[k]-s[k]) for k in (0,1)))
        if (de>=0 if inside else de<=0):out.append(e)
        s,ds=e,de
    return clean(out)
def subtract(subject,clip):
    pieces=[]
    for a,b in zip(clip,clip[1:]+clip[:1]):
        outside=half(subject,a,b,False)
        if len(outside)>=3 and area(outside):pieces.append(outside)
        subject=half(subject,a,b)
        if len(subject)<3 or not area(subject):break
    return pieces
def simplify(p):
    p=clean(p)
    while len(p)>3:
        for i in range(len(p)):
            if on(p[i],p[i-1],p[(i+1)%len(p)]):p.pop(i);break
        else:break
    return p
def joined(a,b):
    for i,(x,y) in enumerate(zip(a,a[1:]+a[:1])):
        for j,(u,v) in enumerate(zip(b,b[1:]+b[:1])):
            if x!=v or y!=u:continue
            candidate=simplify(a[i+1:]+a[:i+1]+b[j+2:]+b[:j])
            if len(set(candidate))!=len(candidate):continue
            if any(turn(candidate[k-1],candidate[k],candidate[(k+1)%len(candidate)])<0 for k in range(len(candidate))):continue
            if area(candidate)==area(a)+area(b):return candidate
    return None
def coalesce(pieces):
    # Recover the exact boundary, splitting edges at exact T-junctions only.
    # A component with holes keeps its already valid convex decomposition.
    points=set(v for p in pieces for v in p);edges=Counter()
    for p in pieces:
        for a,b in zip(p,p[1:]+p[:1]):
            axis=max(range(2),key=lambda k:abs(b[k]-a[k]))
            cuts=sorted((v for v in points if on(v,a,b)),key=lambda v:(v[axis]-a[axis])/(b[axis]-a[axis]))
            for x,y in zip(cuts,cuts[1:]):edges[x,y]+=1
    boundary={e:count-edges[e[::-1]] for e,count in edges.items() if count>edges[e[::-1]]}
    if any(count!=1 for count in boundary.values()):raise Refused('Retained overlap has non-manifold boundary')
    following={}
    for a,b in boundary:
        if a in following:return pieces
        following[a]=b
    loops=[]
    while following:
        start=next(iter(following));p=[start];at=following.pop(start)
        while at!=start:
            if at not in following:raise Refused('Retained overlap has an open boundary')
            p.append(at);at=following.pop(at)
        loops.append(simplify(p))
    if any(area(p)<=0 for p in loops):return pieces
    minimal=[t for p in loops for t in triangulate(p)]
    while True:
        found=False
        for i,a in enumerate(minimal):
            for j in range(i+1,len(minimal)):
                result=joined(a,minimal[j])
                if result is not None and len(result)<=16:
                    minimal[i]=result;minimal.pop(j);found=True;break
            if found:break
        if not found:break
    if sum(area(p) for p in minimal)!=sum(area(p) for p in pieces):raise Refused('Retained overlap coalescing changed area')
    return minimal
def remove(ring,retained,normal):
    q=lambda p:tuple(c.native_float(x) for x in p)
    ring=[q(p) for p in ring];retained=[[q(p) for p in r] for r in retained];n=q(normal)
    axis=max(range(3),key=lambda k:abs(n[k]));other=[k for k in range(3) if k!=axis]
    if not n[axis] or not ring:raise Refused('Retained overlap needs a source plane')
    w=c.dot(n,ring[0])
    if any(c.dot(n,p)!=w for r in [ring,*retained] for p in r):
        raise Refused('Retained overlap faces are not exactly coplanar')
    project=lambda p:tuple(p[k] for k in other)
    projected=[project(p) for p in ring];reverse=area(projected)<0
    pieces=triangulate(projected);before=sum(area(p) for p in pieces)
    for r in retained:
        for triangle in triangulate([project(p) for p in r]):
            pieces=[part for p in pieces for part in subtract(p,triangle)]
            if len(pieces)>4096:raise Refused('Retained overlap partition budget exceeded')
    remaining=sum(area(p) for p in pieces)
    if remaining==before:return [[tuple(float(x) for x in p) for p in ring]],Fraction(0)
    if not 0<=remaining<before:raise Refused('Retained overlap subtraction increased area')
    pieces=coalesce(pieces)
    result=[]
    for piece in pieces:
        output=[]
        for v in piece:
            p=[Fraction(0)]*3
            for k,x in zip(other,v):p[k]=x
            p[axis]=(w-sum(n[k]*p[k] for k in other))/n[axis]
            output.append(tuple(float(x) for x in p))
        result.append(list(reversed(output)) if reverse else output)
    return result,before-remaining
