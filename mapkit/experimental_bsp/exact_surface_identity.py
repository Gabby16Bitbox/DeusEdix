"""Identity certificate for complete legacy surface groups, never fragments.

An identical full multiset of native float32 rings is an equality proof even
when an old authored polygon is non-simple and cannot be triangulated. Use
this only as a fallback after the normal 3D validator refused. Winding,
source identity, UV mapping, planes, node flags and multiplicity all matter.
Unmatched complete groups still undergo the normal bidirectional validator.
"""
from collections import Counter,defaultdict
import math,struct
from selected_rebuild import Refused


def native(value):
    if isinstance(value,bool):raise Refused('Boolean native surface value.')
    try:
        f=float(value)
        if not math.isfinite(f):raise ValueError()
        packed=struct.pack('<f',f);rounded=struct.unpack('<f',packed)[0]
        if not math.isfinite(rounded):raise ValueError()
        return 0 if rounded==0 else struct.unpack('<I',packed)[0]
    except (ValueError,TypeError,OverflowError,struct.error):raise Refused('Non-finite native surface value.')


def integer(value):
    try:
        result=int(value)
        if str(result)!=str(value):raise ValueError()
        return result
    except (ValueError,TypeError):raise Refused('Malformed exact surface integer.')


def mapping(surface):
    if len(surface)!=19:raise Refused('Incomplete exact surface mapping.')
    return (surface[0],surface[1],integer(surface[2]),integer(surface[3]),
            integer(surface[5]),integer(surface[6]),*(native(x) for x in surface[7:]))


def ring(poly):
    count=integer(poly[6])
    if count<3 or len(poly)!=7+3*count:raise Refused('Malformed exact surface ring.')
    points=tuple(tuple(native(x) for x in poly[7+3*i:10+3*i]) for i in range(count))
    # A cyclic start index has no geometric meaning. Reversal is NOT allowed.
    canonical=min(points[i:]+points[:i] for i in range(count))
    return (*(native(v) for v in poly[1:5]),integer(poly[5]),canonical)


def groups(data):
    result=defaultdict(Counter)
    for poly in data['polys']:
        count=integer(poly[6])
        if not count:continue
        try:key=mapping(data['surfs'][integer(poly[0])])
        except (KeyError,IndexError):raise Refused('Missing exact surface provenance.')
        result[key][ring(poly)]+=1
    return dict(result)


def compare_with_exact_groups(a,b,planes,compare):
    try:return compare(a,b,planes)
    except Refused as original_error:
        aa,bb=groups(a),groups(b)
        matched={key for key in aa if key in bb and aa[key]==bb[key]}
        if not matched:raise original_error
        def remainder(data):
            return dict(data,polys=[p for p in data['polys'] if int(p[6]) and mapping(data['surfs'][int(p[0])]) not in matched])
        checked=compare(remainder(a),remainder(b),planes)
        return dict(checked,exact_native_group_identity=dict(groups=len(matched),
            polygons=sum(sum(aa[key].values()) for key in matched),
            criterion='Complete surface multiset; exact native float32 rings, winding, UV/identity, planes, flags and multiplicity.',
            initial_refusal=str(original_error),
            source_faces=sorted({(key[0],key[3]) for key in matched})))
