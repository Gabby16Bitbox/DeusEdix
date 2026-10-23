"""Independent selected-ring target for an occluded semisolid expansion.

No candidate or rebuilt model is an input. Trusted Original supplies unchanged
structural space; edited finite source faces supply the new exposed geometry.
Only exact axial active cuts are accepted. Imperfect hidden source faces need
a full one-unit solid neighbourhood, not a widened geometric tolerance.
"""
from collections import defaultdict
from fractions import Fraction as F
import convex_cells as c
import stratified_csg as s
import ordered_convex_csg as polygons
from retained_solid_domain import source_envelope,partition_original,certify_domain,bounds
from closed_native_domain import certify_closed_domain, _oblique_side

Refused=c.Refused

def _axis(p):
    axes=[k for k in range(3) if p[k]]
    return len(axes)==1 and abs(p[axes[0]])==1

def _node(data,index):
    n=data['nodes'].get(index)
    if n is None or len(n['children'])!=3 or n['flags']&~31 or not 0<=n['vertices']<=24 or len(n['points'])!=n['vertices']:
        raise Refused('Unsupported original routing record')
    p=c.plane(n['plane']);surface=data['surfs'].get(n['surf'])
    if surface is None:raise Refused('Missing original surface')
    return n,p,surface

def _canonical(ring):return min(ring[k:]+ring[:k] for k in range(len(ring)))

def _structural_routes(before,visited,selected,brushes):
    for i in visited:
        actor=before['surfs'][before['nodes'][i]['surf']]['actor']
        if actor not in brushes:raise Refused('Missing native node source owner')
        if actor!=selected and brushes[actor]['flags']&40:raise Refused('Foreign detail in structural visibility proof')

def _align(target,original):
    candidates=[]
    for k in range(len(target)):
        rotated=target[k:]+target[:k]
        score=sum(c.dot(c.sub(a,b),c.sub(a,b)) for a,b in zip(rotated,original))
        candidates.append((score,k,rotated))
    candidates.sort(key=lambda item:item[:2])
    if len(candidates)>1 and candidates[0][0]==candidates[1][0]:raise Refused('Ambiguous original vertex correspondence')
    return candidates[0][2]

def _visible_face(data,face,selected,max_steps=10000):
    normal=c.point(face['normal']);p=normal+(c.dot(normal,c.point(face['base'])),)
    if not _axis(p):raise Refused('Exposed source face must have an exact unit axial normal')
    ring=s._ring(face['points'],p)
    stack=[(0,bool(data['root_outside']),ring,())];visible={};visited=set();active_cuts=set();steps=0
    brushes={b['name']:b for b in data['brushes']}
    while stack:
        index,outside,part,path=stack.pop()
        if index==-1:
            if outside:visible[_canonical(part)]=part
            continue
        if index in path:raise Refused('Cyclic native branch')
        n,cut,surf=_node(data,index);visited.add(index);steps+=1
        if steps>max_steps:raise Refused('Source-face filtering budget exceeded')
        owner=brushes.get(surf['actor'])
        if owner is None:raise Refused('Missing native node source owner')
        if surf['actor']!=selected and owner['flags']&40:raise Refused('Another detail contributes in the finite-source route')
        distances=[c.distance(v,cut) for v in part]
        is_csg=n['vertices']>0 and not n['flags']&5 and surf['actor']!=selected
        if min(distances)<0<max(distances):
            if not _axis(cut) or tuple(surf['normal'])!=cut[:3] or c.dot(surf['normal'],surf['base'])!=cut[3]:
                raise Refused('Active structural cut has no exact axial native predicate')
            active_cuts.add(index)
            choices=[(0,polygons.clip(part,tuple(-v for v in cut))),(1,polygons.clip(part,cut))]
        elif min(distances)==max(distances)==0:
            # A face on a selected plane is checked against both neighbouring
            # regions; exact equal output pieces are deduplicated, not added.
            if surf['actor']!=selected:raise Refused('Exposed source is coplanar with an unrelated structural face')
            choices=[(0,part),(1,part)]
        else:
            side=0 if max(distances)>0 else 1
            # Apart from exact axial edge contacts, pruning must be separated
            # from the native split-thickness band by at least one world unit.
            near=min(abs(v) for v in distances)
            if not _axis(cut) and near*near<c.dot(cut[:3],cut[:3]):
                raise Refused('Nonaxial pruning requires a robust separation')
            if not _axis(cut):
                lo,hi=bounds(part)
                if _oblique_side(tuple((a,b,True,True) for a,b in zip(lo,hi)),cut)!=side:
                    raise Refused('Exact and native pruning disagree')
            choices=[(side,part)]
        for side,piece in choices:
            if not polygons.area(piece,normal):continue
            out=(outside or is_csg) if side==0 else (outside and not is_csg)
            stack.append((n['children'][side],out,piece,path+(index,)))
    return list(visible.values()),visited,active_cuts

def expected_selected_rings(before,edited_sources,selected):
    """Return exact targets, derived solely from Original + edited source.

    The caller must bind every field to immutable native dumps; execute the
    exact requested source edit; preserve all other native model fields except
    these rings and explicitly source-derived selected UV; verify renderer
    bounds and shared-side encoding; and validate save/reload and hashes.
    """
    if not isinstance(selected,str):raise Refused('One selected brush required')
    old_by={b['name']:b for b in before['brushes']}
    rows=edited_sources['brushes'] if isinstance(edited_sources,dict) else edited_sources
    new_by={b['name']:b for b in rows}
    if len(old_by)!=len(before['brushes']) or len(new_by)!=len(rows) or set(old_by)!=set(new_by) or selected not in old_by:
        raise Refused('Source inventory changed or ambiguous')
    if [b['name'] for b in before['brushes']]!=[b['name'] for b in rows]:raise Refused('Source inventory order changed')
    if any(old_by[n]!=new_by[n] for n in old_by if n!=selected):raise Refused('Another authored source changed')
    old,new=old_by[selected],new_by[selected]
    domain_info=certify_domain(before,old,new)
    for a,b in zip(old['faces'],new['faces']):
        if any(a[k]!=b[k] for k in ('index','link','flags','texture','pan','u','v')):
            raise Refused('This path only changes source geometry and UV origin')
    groups=defaultdict(list)
    for i,n in before['nodes'].items():
        sf=before['surfs'][n['surf']]
        if sf['actor']==selected:
            if not 0<=sf['face']<len(new['faces']) or n['vertices']<3:raise Refused('Invalid selected compiled surface')
            groups[sf['face']].append(i)
    if not groups:raise Refused('No original selected surface')
    selected_nodes={i for ids in groups.values() for i in ids}
    if any(before['nodes'][i]['children'][2]!=-1 for i in selected_nodes) or any(
            n['children'][2] in selected_nodes for n in before['nodes'].values()):
        raise Refused('Selected contribution participates in a coplanar chain')
    targets={};hidden=[];visible=[];visited=set();cuts=set();mapping={}
    for face in new['faces']:
        index=face['index'];lo,hi=bounds(face['points'])
        halo=c.box_cell(tuple(v-1 for v in lo),tuple(v+1 for v in hi))
        pieces,used=partition_original(before,halo,selected,extra_flags=4)
        _structural_routes(before,used,selected,old_by)
        if all(not p['outside'] for p in pieces):
            if index in groups:raise Refused('An originally visible selected face would disappear')
            closed=certify_closed_domain(before,tuple(v-1 for v in lo),tuple(v+1 for v in hi),selected,extra_flags=4)
            hidden.append(dict(face=index,solid_neighbourhood=1,visited=len(used),closed_domain=closed))
            continue
        expected,used,active=_visible_face(before,face,selected)
        visited|=used;cuts|=active
        if not expected or len(expected)!=1 or len(groups.get(index,[]))!=1:
            raise Refused('Exposed source requires one original node and one exact target polygon')
        node_index=groups[index][0];node=before['nodes'][node_index];surf=before['surfs'][node['surf']]
        plane=tuple(face['normal'])+(c.dot(face['normal'],face['base']),)
        if tuple(node['plane'])!=plane or tuple(surf['normal'])!=plane[:3]:raise Refused('Selected support plane would change')
        target=s._ring(expected[0],plane);original=s._ring(node['points'],plane)
        if len(target)!=node['vertices']:raise Refused('Selected ring count would change')
        if any(c.native_float(v)!=v for point in target for v in point):raise Refused('Target intersection is not exactly representable native FLOAT')
        if not polygons.covered([original],[target],plane[:3]):raise Refused('New source would remove previously visible selected area')
        target=_align(target,original)
        targets[node_index]=target
        mapping[node['surf']]={k:face[k] for k in ('base','normal','u','v','pan','texture')}
        visible.append(dict(face=index,node=node_index,source_polygon_exact=True,
            old_area=polygons.area(original,plane[:3]),new_area=polygons.area(target,plane[:3]),
            complete_target_coverage='exact finite source clipping through Original with only selected nodes neutralized'))
    if set(groups)!={v['face'] for v in visible}:raise Refused('Unaccounted selected surface group')
    lo,hi=domain_info['domain_bounds']
    domain_info['closed_domain']=certify_closed_domain(before,lo,hi,
        allowed_boundaries=[(before['nodes'][i]['plane'][:3],ring) for i,ring in targets.items()])
    domain_info['proof_scope']='closed finite source support including all lower-dimensional strata; only explicit selected finite support faces may be air'
    return dict(status='pass',certificate='occluded_detail_expansion_exact_selected_finite_source',
        targets=targets,selected_mapping=mapping,visible=visible,hidden=hidden,domain=domain_info,
        active_structural_cuts=sorted(cuts),source_route_nodes=sorted(visited),
        full_reference_used=False,publication_authorized=False,
        remaining_gates=['all unchanged native topology/planes/hulls/zones/caches','renderer bounds and vertex-side encoding','exact UV ownership','source edit identity and persistence'])
