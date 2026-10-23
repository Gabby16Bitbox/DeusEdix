"""Strict parser and independent refusal guards for UC_CERT_DUMP evidence."""
from collections import Counter
from pathlib import Path
from fractions import Fraction
import convex_cells as c


def _floats(row):
    return tuple(c.native_float(v) for v in row)


def read_certificate(path):
    return parse_certificate_bytes(Path(path).read_bytes())


def parse_certificate_bytes(payload):
    """Parse the exact byte snapshot whose digest accompanies native evidence."""
    try:text=payload.decode('utf-8')
    except (AttributeError,UnicodeError) as error:
        raise c.Refused('Certificate is not valid UTF-8 bytes') from error
    rows=[line.split() for line in text.splitlines() if line.strip()]
    if not rows or rows[0]!=['CERT','2','float32-roundtrip'] or rows[-1][0]!='END':
        raise c.Refused('Incomplete or unsupported native certificate dump')
    data=dict(nodes={},surfs={},bounds={},hulls={},leaves={},zones={},brushes=[])
    current=None;meta=None
    try:
        for row in rows[1:-1]:
            tag=row[0]
            if tag=='M':
                if meta is not None or len(row)!=9:raise c.Refused('Malformed model header')
                meta=tuple(map(int,row[1:]));data['root_outside']=meta[0]
            elif tag=='N':
                idx=int(row[1]);count=int(row[6])
                if idx in data['nodes'] or len(row)!=19+3*count:raise c.Refused('Duplicate or malformed node')
                values=_floats(row[15:])
                data['nodes'][idx]=dict(children=list(map(int,row[2:5])),surf=int(row[5]),vertices=count,
                    flags=int(row[7]),collision_bound=int(row[8]),render_bound=int(row[9]),
                    zones=list(map(int,row[10:12])),leaves=list(map(int,row[12:14])),zone_mask=int(row[14]),
                    plane=values[:4],points=tuple(values[4+i*3:7+i*3] for i in range(count)))
            elif tag=='S':
                if len(row)!=21:raise c.Refused('Malformed surface')
                idx=int(row[1])
                if idx in data['surfs']:raise c.Refused('Duplicate surface')
                v=_floats(row[9:])
                data['surfs'][idx]=dict(actor=row[2],texture=row[3],flags=int(row[4]),face=int(row[5]),lightmap=int(row[6]),
                    pan=tuple(map(int,row[7:9])),base=v[:3],normal=v[3:6],u=v[6:9],v=v[9:12])
            elif tag in ('D','H','L','Z'):
                group={'D':'bounds','H':'hulls','L':'leaves','Z':'zones'}[tag];idx=int(row[1])
                if idx in data[group]:raise c.Refused('Duplicate native auxiliary record')
                if tag=='D':
                    if len(row)!=9:raise c.Refused('Malformed bounds')
                    data[group][idx]=dict(valid=int(row[2]),low=_floats(row[3:6]),high=_floats(row[6:9]))
                elif tag=='H':
                    if len(row)!=3:raise c.Refused('Malformed hull')
                    data[group][idx]=int(row[2])
                elif tag=='L':
                    if len(row)!=6:raise c.Refused('Malformed leaf')
                    data[group][idx]=dict(zone=int(row[2]),permeating=int(row[3]),volumetric=int(row[4]),visible=int(row[5]))
                else:
                    if len(row)!=6:raise c.Refused('Malformed zone')
                    data[group][idx]=dict(actor=row[2],cls=row[3],connectivity=int(row[4]),visibility=int(row[5]))
            elif tag=='B':
                if len(row)!=6:raise c.Refused('Malformed source brush')
                current=dict(order=int(row[1]),name=row[2],operation=int(row[3]),flags=int(row[4]),face_count=int(row[5]),faces=[])
                data['brushes'].append(current)
            elif tag=='F':
                if current is None:raise c.Refused('Source face without brush')
                count=int(row[7])
                if count<3 or len(row)!=21+count*3:raise c.Refused('Malformed source face')
                v=_floats(row[8:]);index=int(row[1])
                if index!=len(current['faces']):raise c.Refused('Missing/reordered source face')
                current['faces'].append(dict(index=index,link=int(row[2]),flags=int(row[3]),texture=row[4],
                    pan=tuple(map(int,row[5:7])),base=v[:3],normal=v[3:6],u=v[6:9],v=v[9:12],
                    plane=v[3:6]+(v[12],),points=tuple(v[13+i*3:16+i*3] for i in range(count))))
            else:raise c.Refused('Unknown certificate row '+tag)
        if meta is None or meta[0] not in (0,1):raise c.Refused('Missing/invalid native model header')
        for group,count in zip(('zones','nodes','surfs','bounds','hulls','leaves'),(meta[1],meta[2],meta[3],meta[4],meta[5],meta[6])):
            if set(data[group])!=set(range(count)):raise c.Refused('Incomplete '+group)
        if len(rows[-1])!=2 or int(rows[-1][1])!=len(data['brushes']):raise c.Refused('Incomplete source brushes')
        if len({b['name'] for b in data['brushes']})!=len(data['brushes']):raise c.Refused('Duplicate source brush')
        if any(len(b['faces'])!=b['face_count'] for b in data['brushes']):raise c.Refused('Incomplete source faces')
        if any(n['surf'] not in data['surfs'] for n in data['nodes'].values()):raise c.Refused('Invalid surface reference')
    except (IndexError,KeyError,ValueError,TypeError,OverflowError) as error:
        if isinstance(error,c.Refused):raise
        raise c.Refused('Malformed native certificate dump') from error
    return data


def source_plane_guard(data, selected, tolerance=Fraction(1,100)):
    """Reject newly generated selected faces deviating from their source plane.

    This is a necessary refusal guard, not a sufficient coverage certificate.
    Legacy unselected faces are deliberately excluded. No vertex is projected.
    """
    selected=set(selected);brushes={b['name']:b for b in data['brushes']}
    if not selected or not selected<=brushes.keys():raise c.Refused('Unknown selected source brush')
    checked=0;max_squared=Fraction(0)
    for i,n in data['nodes'].items():
        surface=data['surfs'][n['surf']]
        if surface['actor'] not in selected or not n['vertices']:continue
        b=brushes[surface['actor']];face=surface['face']
        if not 0<=face<len(b['faces']):raise c.Refused('Unknown source face on generated polygon')
        ref=b['faces'][face];p=c.plane(ref['plane']);norm2=c.dot(p[:3],p[:3])
        for v in n['points']:
            residual2=c.distance(v,p)**2/norm2
            max_squared=max(max_squared,residual2)
            if residual2>tolerance**2:
                raise c.Refused('Generated node '+str(i)+' ('+b['name']+' face '+str(face)+') leaves its source plane: squared distance='+str(residual2))
        checked+=1
    if not checked:raise c.Refused('No selected compiled faces to verify')
    return dict(checked_polygons=checked,max_plane_distance=float(max_squared)**.5,tolerance=float(tolerance),
                certificate='necessary_source_plane_guard_only',publication_authorized=False)


def source_convex_brush(brush):
    """Validate exact closed convex source input, refusing float-plane drift.

    The source's edge mesh and authoritative native planes must agree exactly.
    Rotations are supported when represented coherently; rounded/nonplanar
    legacy source faces require a different, explicitly bounded certificate.
    """
    if brush['operation'] not in (1,2) or brush['flags']!=0:raise c.Refused('Unsupported source operation/flags')
    edges=Counter();planes=[];all_points=[p for f in brush['faces'] for p in f['points']]
    for f in brush['faces']:
        if f['flags']!=0:raise c.Refused('Special source face flags')
        p=c.plane(f['plane']);planes.append(p);vv=f['points']
        if any(c.distance(v,p)!=0 for v in vv):raise c.Refused('Source face plane/vertices require a floating-point uncertainty model')
        if any(c.distance(v,p)>0 for v in all_points):raise c.Refused('Nonconvex or inward-wound source brush')
        for a,b in zip(vv,vv[1:]+vv[:1]):
            if a==b:raise c.Refused('Degenerate source edge')
            edges[(a,b)]+=1
    if not edges or any(count!=1 or edges[(b,a)]!=1 for (a,b),count in edges.items()):raise c.Refused('Source brush is not a closed two-manifold')
    c.bounded_cell(planes)
    return dict(name=brush['name'],operation=brush['operation'],flags=0,planes=planes)


def _surface_identity(s):
    return (s['actor'],s['texture'],s['flags'],s['face'],s['pan'],s['base'],s['normal'],s['u'],s['v'])


def outside_symmetric(before,after,before_ids,after_ids):
    """Exact bidirectional polygon/mapping check for independently owned nodes.

    The caller must prove the two node sets are the complete retained outside
    scope. This helper does not infer outside ownership from a face's AABB.
    """
    def records(data,ids):
        ids=list(ids)
        if len(set(ids))!=len(ids) or any(i not in data['nodes'] for i in ids):raise c.Refused('Invalid outside ownership set')
        result=[]
        for i in ids:
            n=data['nodes'][i];vv=n['points']
            if vv:vv=min(vv[k:]+vv[:k] for k in range(len(vv)))
            result.append((_surface_identity(data['surfs'][n['surf']]),n['plane'],n['vertices'],n['flags'],vv))
        return Counter(result)
    a,b=records(before,before_ids),records(after,after_ids)
    if a!=b:raise c.Refused('Outside equality failed: removed='+str(sum((a-b).values()))+', added='+str(sum((b-a).values())))
    return dict(outside_polygons=sum(a.values()),equality='bidirectional_exact')
