"""Disjoint original subtrees for bounded edits to additive detail brushes.

All source bounds before and after must be covered by the union of these
retained-ancestor cells. Every unchanged original node outside the subtrees
can then keep its exact partition order. This is not a license to skip Full.
"""
import itertools
from fractions import Fraction
import convex_cells as c
import local_geometry as g
from edited_collision_scope import source_edit_certificate


def plans(data,old,new,names,root_outside):
    names=set(names);dependency=source_edit_certificate(old,new,names)
    if not dependency['valid']:raise g.Refused('Multi-region needs closed edited source volumes.')
    if any(old[n]['operation']!=1 or not old[n]['flags']&0x28 or old[n]['flags']&0x04000000 for n in names):
        raise g.Refused('Multi-region currently requires additive detail brushes.')
    parents={};roots=[];stack=[(0,None)]
    while stack:
        i,parent=stack.pop()
        if i in parents or i not in data['nodes']:raise g.Refused('Invalid original tree')
        parents[i]=parent
        node=data['nodes'][i]
        if node['actor'] in names:roots.append(i)
        for side,child in enumerate(node['children']):
            if child>=0:stack.append((child,(i,side)))
    chosen=[]
    for root in roots:
        i=root
        while parents[i] and parents[i][0] not in roots:i=parents[i][0]
        if parents[i] is None:chosen.append(root)
    if not 1<=len(chosen)<=64:raise g.Refused('Unsupported subtree count')
    if 0 in chosen:raise g.Refused('The edit reaches the world root.')
    allpoints=[p for b in old.values() for p in b['points']]+[p for b in new.values() for p in b['points']]
    low=[min(p[k] for p in allpoints)-1024 for k in range(3)];high=[max(p[k] for p in allpoints)+1024 for k in range(3)]
    result=[]
    for root in chosen:
        chain=[];i=root
        while parents[i]:
            parent,side=parents[i]
            if side==2:raise g.Refused('Coplanar subtree entrance unsupported')
            chain.append((parent,side));i=parent
        cuts=[];outside=bool(root_outside);cell=g.box_faces(low,high)
        for i,side in reversed(chain):
            p=g.plane(data,i);cut=p if side==0 else g.negate(p);cuts.append(cut);cell=g.clip_cell(cell,cut)
            n=data['nodes'][i];solid=n['vertices']>0 and not n['flags']&0x21
            outside=(outside or solid) if side==0 else (outside and not solid)
        owned=g.descendants(data,root)
        if any(int(data['surfs'][data['nodes'][i]['surf']][2])&0x04000000 for i in owned):raise g.Refused('Portal in subtree')
        contributors=[]
        for name,b in new.items():
            corners=itertools.product(*[(min(v[k] for v in b['points']),max(v[k] for v in b['points'])) for k in range(3)])
            corners=list(corners)
            if any(max(g.distance(v,p) for v in corners)<=g.EPS for p in cuts):continue
            if b['flags']&0x04000000:raise g.Refused('Contributing portal')
            contributors.append(name)
        result.append(dict(root=root,old_nodes=sorted(owned),total_nodes=len(data['nodes']),planes=cuts,cell=cell,
            contributors=contributors,total_brushes=len(new),root_outside=int(outside),selected=sorted(names),retained_portals=[]))
    proofs=[]
    for box in dependency['boxes']:
        pending=[c.box_cell([c.native_float(x) for x in box['minimum']],[c.native_float(x) for x in box['maximum']])]
        initial=c.volume(pending[0]);covered=Fraction(0)
        for plan in result:
            cuts=[tuple(-c.native_float(x) for x in p) for p in plan['planes']]
            next_parts=[]
            for part in pending:
                remainder,inside=c.partition_brush(part,cuts);next_parts.extend(remainder)
                if inside:covered+=c.volume(inside)
            pending=next_parts
        if pending or covered!=initial:raise g.Refused('Edited bounds leave the union of retained subtree cells.')
        proofs.append(dict(brush=box['brush'],stage=box['stage'],volume=str(initial),covered=str(covered)))
    return result,dict(dependencies=dependency,coverage=proofs,roots=chosen)

def selected_surface_coverage(local,full,names):
    """Check selected faces globally, including faces on branch boundaries.

    Per-cell clipping excludes polygons coplanar with an ancestor. Exact volume
    coverage of the union does not prove these positive-area faces survived.
    """
    def selected(data):
        return dict(data,polys=[p for p in data['polys']
                    if data['surfs'][int(p[0])][0] in names])
    return g.equivalent_coverage(selected(local),selected(full),())
