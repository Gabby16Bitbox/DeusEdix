"""Exact comparison-domain partition for a certified, closed CSG edit.

This changes no map geometry and grants no tolerance. Ordered CSG occupancy
can change only in the old/new edited volumes. Their enlarged bounding boxes
therefore choose Full inside; Original is the reference outside every box.
All positive-area fragments are retained, including arbitrarily small ones.
An unrepresentable fragment is refused rather than silently discarded.
"""
from fractions import Fraction as Q
import math
from collision_scope import WORLD_PADDING,FLOAT32_EPSILON
from selected_rebuild import Refused
from polygon_validation import triangles


def number(value):
    if isinstance(value,bool):raise Refused('Boolean surface-scope coordinate.')
    try:
        if not math.isfinite(float(value)):raise ValueError()
        return Q(str(value))
    except (ValueError,TypeError,OverflowError,ZeroDivisionError):
        raise Refused('Non-finite or malformed surface-scope coordinate.')


def orient(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def area2(poly):return sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(poly,poly[1:]+poly[:1]))
def projection(poly,axis):return [tuple(v[k] for k in range(3) if k!=axis) for v in poly]
def _on(p,a,b):return orient(a,b,p)==0 and all(min(a[k],b[k])<=p[k]<=max(a[k],b[k]) for k in range(2))
def _intersects(a,b,c,d):
    return (orient(a,b,c)*orient(a,b,d)<0 and orient(c,d,a)*orient(c,d,b)<0 or
            _on(a,c,d) or _on(b,c,d) or _on(c,a,b) or _on(d,a,b))


def _dedup(poly):
    out=[]
    for p in poly:
        if not out or p!=out[-1]:out.append(p)
    if len(out)>1 and out[0]==out[-1]:out.pop()
    return out


def triangulate(poly,axis):
    """Exact projected ear clipping; refuse folds, crossings, and zero area."""
    poly=_dedup(poly);pp=projection(poly,axis)
    if len(poly)<3 or not area2(pp):raise Refused('Degenerate crossing surface-scope polygon.')
    for i,(a,b) in enumerate(zip(pp,pp[1:]+pp[:1])):
        for j,(c,d) in enumerate(zip(pp,pp[1:]+pp[:1])):
            if j<=i+1 or i==0 and j==len(pp)-1:continue
            if _intersects(a,b,c,d):raise Refused('Self-intersecting crossing surface-scope polygon.')
    if area2(pp)<0:poly.reverse();pp.reverse()
    original=area2(pp);out=[]
    while len(poly)>3:
        found=False
        for i in range(len(poly)):
            a,b,c=pp[i-1],pp[i],pp[(i+1)%len(pp)];turn=orient(a,b,c)
            if turn==0 and _on(b,a,c):poly.pop(i);pp.pop(i);found=True;break
            if turn<=0:continue
            skipped={(i-1)%len(pp),i,(i+1)%len(pp)}
            if any(all(orient(x,y,p)>=0 for x,y in ((a,b),(b,c),(c,a)))
                   for j,p in enumerate(pp) if j not in skipped):continue
            out.append([poly[i-1],poly[i],poly[(i+1)%len(poly)]])
            poly.pop(i);pp.pop(i);found=True;break
        if not found:raise Refused('Crossing surface-scope polygon has no exact triangulation.')
    if len(poly)==3:out.append(poly)
    if sum(area2(projection(p,axis)) for p in out)!=original:
        raise Refused('Exact surface-scope triangulation lost area.')
    return out


def _split(poly,axis,bound,sign):
    # Inside is sign * (coordinate - bound) <= 0. Boundary belongs inside.
    distances=[sign*(p[axis]-bound) for p in poly]
    if max(distances)<=0:return poly,[]
    if min(distances)>=0:return [],poly
    inside=[];outside=[];start=poly[-1];ds=distances[-1]
    for end,de in zip(poly,distances):
        if ds*de<0:
            t=ds/(ds-de);point=tuple(start[k]+t*(end[k]-start[k]) for k in range(3))
            inside.append(point);outside.append(point)
        if de<=0:inside.append(end)
        if de>=0:outside.append(end)
        start,ds=end,de
    return _dedup(inside),_dedup(outside)


def _positive(poly,axis):return len(poly)>=3 and area2(projection(poly,axis))!=0


def _subtract_box(poly,box,axis):
    inside=poly;outside=[]
    for k in range(3):
        for bound,sign in ((box[0][k],-1),(box[1][k],1)):
            inside,piece=_split(inside,k,bound,sign)
            if _positive(piece,axis):outside.append(piece)
            if not _positive(inside,axis):return [],outside
    return inside,outside


def partition_polygon(poly,boxes,axis):
    """Return (inside union, outside union) with exact area conservation.

    Boxes and vertices are rational XYZ values. Overlapping old/new bounds
    are a UNION: a fragment assigned to Full is never counted a second time.
    """
    if not boxes:raise Refused('Missing closed-edit surface scope.')
    if any(all(all(lo[k]<=v[k]<=hi[k] for k in range(3)) for v in poly) for lo,hi in boxes):
        return [poly],[]
    if all(any(max(v[k] for v in poly)<lo[k] or min(v[k] for v in poly)>hi[k]
               for k in range(3)) for lo,hi in boxes):return [],[poly]
    pending=triangulate(poly,axis);expected=sum(abs(area2(projection(p,axis))) for p in pending);inside=[]
    for box in boxes:
        remaining=[]
        for piece in pending:
            retained,remainder=_subtract_box(piece,box,axis)
            if retained:inside.append(retained)
            remaining.extend(remainder)
        pending=remaining
        if not pending:break
    actual=sum(abs(area2(projection(p,axis))) for p in inside+pending)
    if actual!=expected:raise Refused('Exact surface-scope partition lost or duplicated area.')
    return inside,pending


def raw_vertices(poly):
    try:
        count=int(poly[6])
        if count<0 or len(poly)!=7+3*count:raise ValueError()
        return [tuple(number(x) for x in poly[7+i*3:10+i*3]) for i in range(count)]
    except (IndexError,TypeError,ValueError):raise Refused('Malformed surface-scope polygon.')


def scoped_boxes(certificate,datasets):
    if not isinstance(certificate,dict) or not certificate.get('valid'):
        raise Refused('Surface scope requires certified closed source volumes.')
    selected=certificate.get('selected',[]);raw=certificate.get('boxes',[])
    expected={(name,stage) for name in selected for stage in ('old','new')}
    if not expected or len(raw)!=len(expected) or {(b.get('brush'),b.get('stage')) for b in raw}!=expected:
        raise Refused('Incomplete closed source volume bounds.')
    # Same conservative point-plane scale as collision_scope. Axis-aligned
    # planes reduce dot-product magnitude to |coordinate|. The bound encloses
    # every comparison vertex; clipped/interpolated vertices cannot exceed it.
    maxima=[Q(0),Q(0),Q(0)]
    for data in datasets:
        for poly in data['polys']:
            for vertex in raw_vertices(poly):
                maxima=[max(maxima[k],abs(vertex[k])) for k in range(3)]
    boxes=[];audit=[]
    for entry in raw:
        low=tuple(number(x) for x in entry['minimum']);high=tuple(number(x) for x in entry['maximum'])
        if len(low)!=3 or len(high)!=3 or any(low[k]>=high[k] for k in range(3)):
            raise Refused('Degenerate closed source volume bounds.')
        guards=tuple(number(WORLD_PADDING)+8*number(FLOAT32_EPSILON)*(maxima[k]+max(abs(low[k]),abs(high[k]))) for k in range(3))
        lo=tuple(low[k]-guards[k] for k in range(3));hi=tuple(high[k]+guards[k] for k in range(3))
        boxes.append((lo,hi));audit.append(dict(brush=entry['brush'],stage=entry['stage'],
            minimum=list(map(str,lo)),maximum=list(map(str,hi)),padding=list(map(str,guards))))
    return boxes,audit


def partition_data(data,boxes):
    inside=[];outside=[];crossing=0
    for raw in data['polys']:
        vertices=raw_vertices(raw)
        if not vertices:continue # Zero-vertex BSP splitters have no surface area.
        if len(vertices)<3:raise Refused('Malformed surface-scope face.')
        try:normal=tuple(number(v) for v in data['surfs'][int(raw[0])][10:13])
        except (KeyError,ValueError,TypeError):raise Refused('Missing surface-scope source mapping.')
        if len(normal)!=3 or not any(normal):raise Refused('Missing surface-scope source normal.')
        axis=max(range(3),key=lambda k:abs(normal[k]))
        a,b=partition_polygon(vertices,boxes,axis)
        if a and b:crossing+=1
        for pieces,target in ((a,inside),(b,outside)):
            for piece in pieces:
                if piece is vertices:target.append(raw);continue
                # Exact tiny areas must not disappear in downstream float
                # triangulation. Refuse rather than let its minimum area gate
                # silently omit a newly created scope fragment.
                serialized=[format(float(x),'.17g') for p in piece for x in p]
                rounded=[tuple(number(x) for x in serialized[i:i+3]) for i in range(0,len(serialized),3)]
                if abs(area2(projection(rounded,axis)))<=Q('2e-9'):
                    raise Refused('Positive surface-scope fragment is below comparison precision; result withheld.')
                # The existing cell comparator subsequently serializes at .9g
                # and merges vertices by six-decimal keys. Prove that these
                # conversions and its triangulator retain this whole fragment;
                # a long, very thin sliver can otherwise disappear despite
                # having more than the minimum total area.
                native=[tuple(float(format(float(x),'.9g')) for x in v) for v in rounded]
                if len({tuple(round(x,6) for x in v) for v in native})!=len(native):
                    raise Refused('Positive surface-scope fragment collapses at comparison precision; result withheld.')
                projected=[tuple(v[k] for k in range(3) if k!=axis) for v in native]
                expected=abs(area2([tuple(number(x) for x in v) for v in projected]))
                actual=sum(abs(area2([tuple(number(x) for x in v) for v in t])) for t in triangles(projected))
                if not expected or actual!=expected:
                    raise Refused('Comparison triangulation would omit positive surface-scope area; result withheld.')
                target.append(raw[:6]+[str(len(piece))]+serialized)
    return dict(data,polys=inside),dict(data,polys=outside),dict(crossing_polygons=crossing,
        inside_fragments=len(inside),outside_fragments=len(outside))


def _mapping_keys(data,selected):
    keys=set()
    for poly in data['polys']:
        s=data['surfs'][int(poly[0])]
        if s[0] in selected:raise Refused('Edited source geometry escaped its certified comparison domain.')
        if len(s)!=19:raise Refused('Incomplete outside surface identity or UV mapping.')
        # Lightmap cache is explicitly stale. All other provenance is exact:
        # actor, texture, flags, source face, pan, plane, origin and UV vectors.
        keys.add(tuple(s[:4])+tuple(s[5:7])+tuple(number(x) for x in s[7:]))
    return keys


def compare_scoped_coverage(before,after,full,dependencies,planes,compare):
    boxes,audit=scoped_boxes(dependencies,(before,after,full))
    inside_before,outside_before,before_stats=partition_data(before,boxes)
    inside_after,outside_after,after_stats=partition_data(after,boxes)
    inside_full,outside_full,full_stats=partition_data(full,boxes)
    original_keys=_mapping_keys(outside_before,set(dependencies['selected']))
    if _mapping_keys(outside_after,set(dependencies['selected']))!=original_keys:
        raise Refused('Outside-domain surface identity/UV provenance changed.')
    # Every piece is compared, in both directions, with the existing 3D gate.
    # No whitelist of surfaces or tiny residual areas is used.
    original_check=compare(outside_after,outside_before,planes)
    full_check=compare(inside_after,inside_full,planes)
    return dict(original_preserved_coverage=original_check,full_affected_coverage=full_check,
        certificate=dict(source_faces=len(original_keys),source_dependencies=dependencies,
            criterion='Exact complete polygon-domain partition: Original outside certified old/new closed volumes expanded by SDK halo; Full inside.',
            selected=dependencies['selected'],scope_boxes=audit,world_padding=WORLD_PADDING,
            float32_guard_multiplier=8,partition=dict(before=before_stats,after=after_stats,full=full_stats),
            outside_uv_and_identity_exact=True))
