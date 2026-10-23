"""Exact local domain proof against trusted Original, never a Full oracle.

This checks every positive-volume piece of a bounded query domain against the
original BSP's ChildOutside semantics. Boundary/routing equivalence, finite
source-face filtering, UV, collision cache and persistence are separate gates.
It is deliberately NOT publication authorization by itself.
"""
from fractions import Fraction as F
import convex_cells as c
from stratified_csg import X87_GAMMA6,X87_U

Refused=c.Refused

def native_base_interval(normal,base):
    """Contain FLOAT-intermediate and x87 evaluation of FPlane(Base, Normal).

    Three products, two sums, and a possible final FLOAT rounding need at most
    six roundings. The absolute term also covers FLOAT subnormal operations;
    x87 has a wider exponent range. Nearest and masked exceptions are required
    by the external native profile. Unit-axis predicates are exactly stored.
    No normal welding/renormalization is inferred from this interval.
    """
    normal,base=c.point(normal),c.point(base)
    if any(c.native_float(v)!=v for v in normal+base):raise Refused('Source plane inputs are not native FLOAT')
    w=c.dot(normal,base);nonzero=[v for v in normal if v]
    if len(nonzero)==1 and abs(nonzero[0])==1:return w,F(0)
    magnitude=sum(abs(a*b) for a,b in zip(normal,base))
    if magnitude>2**120:raise Refused('Source plane arithmetic may overflow the supported FLOAT envelope')
    error=X87_GAMMA6*magnitude+6*F(1,2**150)/(1-6*X87_U)
    return w,error

def bounds(points):
    points=tuple(c.point(v) for v in points)
    if not points:raise Refused('Empty finite support')
    return tuple(min(v[k] for v in points) for k in range(3)),tuple(max(v[k] for v in points) for k in range(3))

def _finite_face(face):
    """Hidden legacy quads may be nonplanar, but may not fold or reverse.

    This validates the projected finite ring without moving a point. No claim
    is made that it equals a planar FPoly; all nonplanar faces must later be
    proved entirely buried in an open structural-solid neighbourhood.
    """
    normal=c.point(face['normal']);points=tuple(c.point(v) for v in face['points'])
    if not any(normal) or len(points)!=4 or len(set(points))!=4:raise Refused('Invalid finite source quad')
    axis=max(range(3),key=lambda k:abs(normal[k]));unit=[F(0)]*3;unit[axis]=1 if normal[axis]>0 else -1
    for a,b in zip(points,points[1:]+points[:1]):
        distances=[c.dot(c.cross(c.sub(b,a),c.sub(v,a)),unit) for v in points]
        if min(distances)<0 or max(distances)<=0:raise Refused('Finite source quad folds, degenerates or reverses orientation')

def source_envelope(old,new):
    """Support both Base-anchored cells and actual finite authored vertices.

    FPoly.Base may differ from Vertex0. Both are retained as distinct evidence;
    this enclosing-domain proof does not pretend they define identical planes.
    """
    for b in (old,new):
        if b['operation']!=1 or not b['flags']&32 or b['flags']&~34 or len(b['faces'])!=6 or b['face_count']!=6:
            raise Refused('Expected one opaque/masked additive semisolid six-face brush')
    if (old['name'],old['order'],old['operation'],old['flags'])!=(new['name'],new['order'],new['operation'],new['flags']):
        raise Refused('Source operation/order/role changed')
    support=[];cells=[];rounded_cells=[];source_planes=[];expanded=[];contracted=[]
    for b in (old,new):
        pp=[];outer=[];inner=[]
        for i,f in enumerate(b['faces']):
            if f['index']!=i or f['link']!=i or len(f['points'])!=4:raise Refused('Unsupported source face inventory')
            if f['flags']&~0x00800022:raise Refused('Unsupported selected per-face visibility/CSG role')
            _finite_face(f)
            normal=c.point(f['normal']);base=c.point(f['base'])
            if not any(normal):raise Refused('Zero authored normal')
            support.extend(c.point(v) for v in f['points'])
            # Exact rational dot is used for conservative support. Native stored
            # FPlane rounds W; include that body's vertices as well.
            w,error=native_base_interval(normal,base)
            pp.append(normal+(w,));outer.append(normal+(w+error,));inner.append(normal+(w-error,))
        cell=c.bounded_cell(pp);rounded=c.bounded_cell([p[:3]+(c.native_float(p[3]),) for p in pp])
        support.extend(c.vertices(cell));support.extend(c.vertices(rounded));cells.append(cell)
        rounded_cells.append(rounded);source_planes.append(pp)
        outer_cell=c.bounded_cell(outer);c.bounded_cell(inner)
        support.extend(c.vertices(outer_cell));expanded.append(outer_cell);contracted.append(inner)
    for old_cell,new_planes in ((cells[0],source_planes[1]),
            (rounded_cells[0],[p[:3]+(c.native_float(p[3]),) for p in source_planes[1]])):
        if any(c.distance(v,p)>0 for v in c.vertices(old_cell) for p in new_planes):
            raise Refused('Source edit is not an exact monotone expansion')
    if any(c.distance(v,p)>0 for v in c.vertices(expanded[0]) for p in contracted[1]):
        raise Refused('Native source plane roundoff cannot certify monotone expansion')
    return c.box_cell(*bounds(support)),cells

def partition_original(data,domain,neutral_actor=None,max_nodes=10000,extra_flags=0):
    """Full-dimensional cell partition with explicit source-owned neutral nodes."""
    if data.get('root_outside') not in (0,1) or 0 not in data.get('nodes',{}):raise Refused('Invalid original model')
    if not c.full_dimension(domain):raise Refused('Query domain must have volume')
    stack=[(0,bool(data['root_outside']),domain,())];terminals=[];visited=set();splits=0
    while stack:
        index,outside,cell,path=stack.pop()
        if index==-1:
            terminals.append(dict(outside=outside,cell=cell,path=path));continue
        if index in dict(path):raise Refused('Cyclic original branch')
        n=data['nodes'].get(index)
        if n is None or len(n['children'])!=3 or n['flags']&~31 or not 0<=n['vertices']<=24 or len(n['points'])!=n['vertices']:
            raise Refused('Unsupported original routing record')
        p=c.plane(n['plane']);surface=data['surfs'].get(n['surf'])
        if surface is None:raise Refused('Missing native surface')
        if extra_flags not in (0,4):raise Refused('Unsupported routing predicate')
        is_csg=n['vertices']>0 and not n['flags']&(1|extra_flags) and surface['actor']!=neutral_actor
        visited.add(index);splits+=1
        if splits>max_nodes:raise Refused('Bounded partition complexity exceeded')
        back,front=c.split_convex(cell,p)
        for side,part in ((0,front),(1,back)):
            if not part:continue
            child=n['children'][side]
            if type(child) is not int or child<-1:raise Refused('Malformed native child')
            child_out=(outside or is_csg) if side==0 else (outside and not is_csg)
            stack.append((child,child_out,part,path+((index,side),)))
    if sum(c.volume(t['cell']) for t in terminals)!=c.volume(domain):raise Refused('Incomplete bounded partition')
    return terminals,visited

def certify_domain(before,old,new):
    domain,cells=source_envelope(old,new)
    terminals,visited=partition_original(before,domain)
    air=[t for t in terminals if t['outside']]
    if air:
        error=Refused('Edited finite support contains original air')
        error.air_volume=sum(c.volume(t['cell']) for t in air)
        error.witness=c.vertices(air[0]['cell'])
        raise error
    return dict(status='pass',certificate='entire_edited_finite_support_in_original_solid',
        original_nodes_visited=len(visited),terminal_pieces=len(terminals),domain_bounds=bounds(c.vertices(domain)),
        domain_volume=c.volume(domain),air_volume=F(0),full_reference_used=False,
        monotonicity='old outer Base-plane cell contained in new inner Base-plane cell for every allowed W rounding',
        base_plane_envelope='gamma6 PC24 nearest plus 6*2^-150/(1-6u) for FLOAT subnormal rounding; unit-axis exact',
        proof_scope='positive-volume support only; boundary and finite surface gates still mandatory',
        publication_authorized=False)
