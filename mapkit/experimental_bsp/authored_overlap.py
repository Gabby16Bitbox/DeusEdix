"""Narrow certificate for overlap already present in two linked authored faces.

This is not an oracle-free validator. It only explains a rejected overlap;
complete bidirectional Full coverage and all native gates remain mandatory.
No third compiled layer, duplicate triangle, changed source or displaced overlap
is accepted. Geometry and the existing SDK distance bounds are never changed.
"""
import copy,itertools,math
from fractions import Fraction
import polygon_validation as v
from exact_surface_identity import native
from selected_rebuild import Refused

MAX_TRIANGLES=32

def _dot(a,b):return sum(x*y for x,y in zip(a,b))
def _sub(a,b):return tuple(x-y for x,y in zip(a,b))
def _project(p,axis):return tuple(x for k,x in enumerate(p) if k!=axis)

def _lift(q,triangle,axis):
    a,b,c=triangle;n=v._cross(_sub(b,a),_sub(c,a));w=_dot(n,a)
    if not math.isfinite(n[axis]) or abs(n[axis])<1e-14:raise Refused('Authored overlap has an ambiguous projection.')
    keep=[k for k in range(3) if k!=axis];p=[0.,0.,0.]
    for k,x in zip(keep,q):p[k]=x
    p[axis]=(w-sum(n[k]*p[k] for k in keep))/n[axis]
    return tuple(p)

def _triangles(points,axis):
    projected=[_project(p,axis) for p in points];lookup={}
    for q,p in zip(projected,points):
        if q in lookup and lookup[q]!=p:raise Refused('Authored face folds across its projection.')
        lookup[q]=p
    return [[lookup[q] for q in t] for t in v.triangles(projected)]

def _variants(points,axis):
    """All admissible diagonal choices, never an arbitrary nonplanar fan.

    FPoly does not author a diagonal. For quads both simple triangulations must
    prove the witness independently. Larger rings are outside this certificate.
    Exact projected predicates decide admissibility, without a geometry epsilon.
    """
    if len(points) not in (3,4):raise Refused('Authored overlap supports only triangles and quads.')
    _triangles(points,axis) # Existing simple-ring validation remains mandatory.
    points=list(points);q=[tuple(Fraction(x) for x in _project(p,axis)) for p in points]
    def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    area=sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(q,q[1:]+q[:1]))
    if area<0:points.reverse();q.reverse();area=-area
    if not area:raise Refused('Authored overlap has a zero-area source ring.')
    choices=(((0,1,2),),) if len(points)==3 else (((0,1,2),(0,2,3)),((0,1,3),(1,2,3)))
    variants=[]
    for choice in choices:
        areas=[cross(*(q[i] for i in indices)) for indices in choice]
        if all(a>0 for a in areas) and sum(areas)==area:
            variants.append([[points[i] for i in indices] for indices in choice])
    if not variants:raise Refused('Authored overlap has no unambiguous simple triangulation.')
    return variants

def _uv(face):return (face['texture'],face['flags'],face['pan'],face['base'],face['u'],face['v'])
def _surface_uv(surface):
    if len(surface)!=19:raise Refused('Incomplete overlap surface provenance.')
    return (surface[1],int(surface[2]),tuple(map(int,surface[5:7])),
            tuple(native(x) for x in surface[7:10]),tuple(native(x) for x in surface[13:16]),tuple(native(x) for x in surface[16:19]))
def _original_uv(s):
    return (s['texture'],s['flags'],s['pan'],tuple(native(x) for x in s['base']),
            tuple(native(x) for x in s['u']),tuple(native(x) for x in s['v']))

class AuthoredOverlapPolicy:
    def __init__(self,before,edited,selected):
        before=copy.deepcopy(before);edited=copy.deepcopy(edited)
        self.old={b['name']:b for b in before['brushes']};self.new={b['name']:b for b in edited['brushes']}
        if len(self.old)!=len(before['brushes']) or len(self.new)!=len(edited['brushes']):raise Refused('Duplicate authored brush provenance.')
        self.original_surfs=before['surfs'];self.selected=set(selected);self.cache={}

    def _source(self,surface,axis,normal):
        actor=surface[0];face_index=int(surface[3]);cache_key=(actor,face_index,axis,_surface_uv(surface),tuple(native(x) for x in surface[10:13]))
        if cache_key in self.cache:return self.cache[cache_key]
        old=self.old.get(actor);new=self.new.get(actor)
        if actor in self.selected or old is None or old!=new:raise Refused('Authored overlap requires the entire unchanged source brush.')
        faces=old['faces']
        if old['face_count']!=len(faces) or [f['index'] for f in faces]!=list(range(len(faces))):raise Refused('Incomplete authored face provenance.')
        if not 0<=face_index<len(faces) or faces[face_index]['link']!=face_index:raise Refused('Unknown authored representative link.')
        if any(not 0<=f['link']<len(faces) or faces[f['link']]['link']!=f['link'] for f in faces):raise Refused('Malformed authored links.')
        linked=[f for f in faces if f['link']==face_index]
        if len(linked)!=2 or _uv(linked[0])!=_uv(linked[1]):raise Refused('Only two completely linked, identically mapped authored faces are supported.')
        originals=[s for s in self.original_surfs.values() if s['actor']==actor and s['face']==face_index]
        signatures={_original_uv(s) for s in originals}
        normals={tuple(native(x) for x in s['normal']) for s in originals}
        if signatures!={_surface_uv(surface)} or normals!={tuple(native(x) for x in surface[10:13])}:
            raise Refused('Compiled overlap mapping/normal differs from its unambiguous Original provenance.')
        if (surface[1],int(surface[2]),tuple(map(int,surface[5:7])))!=(linked[0]['texture'],linked[0]['flags'],linked[0]['pan']):
            raise Refused('Authored overlap material/role differs from compiled provenance.')
        variants=[]
        for f in linked:
            points=[tuple(map(float,p)) for p in f['points']]
            if not 3<=len(points)<=16 or any(not math.isfinite(x) for p in points for x in p):raise Refused('Malformed authored overlap geometry.')
            variants.append(_variants(points,axis))
        witness_sets=[]
        for first,second in itertools.product(*variants):
            witnesses=[]
            for a,b in itertools.product(first,second):
                overlap=v.base.intersection([_project(p,axis) for p in a],[_project(p,axis) for p in b])
                if abs(v.area(overlap))<=v.AREA_ROUNDOFF:continue
                aa=[_lift(q,a,axis) for q in overlap];bb=[_lift(q,b,axis) for q in overlap]
                for pa,pb in zip(aa,bb):
                    delta=_sub(pa,pb);depth=_dot(delta,normal);tangent=_sub(delta,tuple(depth*x for x in normal))
                    if abs(depth)>v.NORMAL_TOLERANCE or math.sqrt(_dot(tangent,tangent))>v.WORLD_TOLERANCE:
                        raise Refused('Authored projected layers are not within the existing SDK 3D bounds.')
                kernels=[]
                for ring in (aa,bb):
                    fan=[[ring[0],ring[i],ring[i+1]] for i in range(1,len(ring)-1)]
                    kernels.append([v._expanded3d_planes(t,v.WORLD_TOLERANCE,normal,k) for t in fan for k in ('cube','octahedron')])
                witnesses.append(dict(projected=overlap,kernels=kernels))
            if not witnesses:raise Refused('No positive-area overlap is present in an authored triangulation.')
            witness_sets.append(witnesses)
        result=dict(actor=actor,face=face_index,source_faces=[f['index'] for f in linked],witness_sets=witness_sets)
        self.cache[cache_key]=result;return result

    def check(self,surface,key,projected,world,normal,tolerance):
        if not 2<=len(world)<=MAX_TRIANGLES or len(world)!=len(projected):raise Refused('Authored overlap exceeds the bounded proof budget.')
        axis=key[1];source=self._source(surface,axis,normal)
        # Exact duplicates remain invalid even if the source has two layers.
        canonical=[tuple(sorted(p)) for p in projected]
        if len(set(canonical))!=len(canonical):raise Refused('Duplicate compiled triangle is not an authored overlap certificate.')
        # Two source faces can never authorize a third compiled layer. This is
        # an exact positive-area check, not a sampling or relative-area bound.
        for a,b,c in itertools.combinations(projected,3):
            pair=v.base.intersection(a,b)
            if abs(v.area(pair))>v.AREA_ROUNDOFF and abs(v.area(v.base.intersection(pair,c)))>v.AREA_ROUNDOFF:
                raise Refused('Three compiled layers exceed the two authored source faces.')
        checked=0
        for i,a in enumerate(projected):
            for j in range(i+1,len(projected)):
                b=projected[j]
                try:v._check_overlaps([a,b],tolerance,key)
                except Refused:pass
                else:continue
                overlap=v.base.intersection(a,b)
                # Universal quantification: never pool evidence from different
                # source diagonal choices to cover one compiled overlap.
                for witnesses in source['witness_sets']:
                    clips=[]
                    for witness in witnesses:
                        for first,second in (witness['kernels'],list(reversed(witness['kernels']))):
                            left=[[_project(p,axis) for p in v._clip3d(world[i],planes)] for planes in first]
                            right=[[_project(p,axis) for p in v._clip3d(world[j],planes)] for planes in second]
                            for pa in left:
                                if v.area(pa)<0:pa.reverse()
                                if v.area(pa)<=v.AREA_ROUNDOFF:continue
                                for pb in right:
                                    if v.area(pb)<0:pb.reverse()
                                    if v.area(pb)<=v.AREA_ROUNDOFF:continue
                                    shared=v.base.intersection(pa,pb)
                                    if v.area(shared)>v.AREA_ROUNDOFF:clips.append(shared)
                    missing=v._uncovered(overlap,clips)
                    if missing>v.AREA_ROUNDOFF:raise Refused('Compiled overlap extends beyond an authored 3D diagonal witness; uncovered area '+str(missing))
                checked+=1
        if not checked:raise Refused('No complete authored overlap proof was produced.')
        return dict(certificate='unchanged_two_linked_authored_faces',actor=source['actor'],face=source['face'],
                    source_faces=source['source_faces'],overlap_pairs=checked,max_layers=2,triangulation_combinations=len(source['witness_sets']),
                    tangent_tolerance=v.WORLD_TOLERANCE,normal_tolerance=v.NORMAL_TOLERANCE,
                    complete_group=True,oracle_free=False)
