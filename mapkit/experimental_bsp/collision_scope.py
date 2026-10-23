"""Conservative proof that an entire collision probe cannot enter a BSP cell.

The cell is the intersection of positive plane half-spaces. A sweep is outside
only if ONE retained plane separates BOTH endpoints plus the full axis-aligned
extent. Endpoints outside different planes are not a proof.
"""
import math

# SDK THRESH_POINT_ON_PLANE is .1 world units. Native diagnostics show a .5
# world-unit line-contact backoff. One unit covers both plus .4 extra slack.
# This is a conservative scope guard, not a relaxed collision comparison.
WORLD_PADDING=1.0
FLOAT32_EPSILON=2.0**-23

def _numbers(value,count):
    try:
        if len(value)!=count or any(isinstance(x,bool) for x in value):return None
        result=tuple(float(x) for x in value)
        return result if all(math.isfinite(x) for x in result) else None
    except (TypeError,ValueError,OverflowError):return None

def separation_certificate(probe,planes):
    """Return an audit certificate; ``outside=False`` means use the Full check.

    The input is start XYZ, end XYZ, extent XYZ. Plane normals need not be unit
    length. Invalid data fails closed, including invalid unused cell planes.
    A float32 roundoff allowance covers the native engine's scalar arithmetic.
    """
    ray=_numbers(probe,9)
    if ray is None or min(ray[6:])<0:return dict(outside=False,reason='Invalid sweep or extent.')
    try:raw_planes=list(planes)
    except TypeError:return dict(outside=False,reason='Invalid cell planes.')
    if not raw_planes:return dict(outside=False,reason='No separating cell planes.')
    parsed=[]
    for index,value in enumerate(raw_planes):
        plane=_numbers(value,4)
        if plane is None:return dict(outside=False,reason='Invalid cell plane.')
        norm=math.hypot(*plane[:3])
        if not math.isfinite(norm) or norm==0:return dict(outside=False,reason='Invalid plane normal.')
        parsed.append((index,plane,norm))
    margins=[]
    try:
        for index,plane,norm in parsed:
            start_products=[ray[k]*plane[k] for k in range(3)]
            end_products=[ray[3+k]*plane[k] for k in range(3)]
            support=sum(abs(plane[k])*ray[6+k] for k in range(3))
            start=sum(start_products)-plane[3];end=sum(end_products)-plane[3]
            scale=max(sum(abs(x) for x in start_products),sum(abs(x) for x in end_products))+abs(plane[3])+support
            roundoff=8*FLOAT32_EPSILON*scale
            gap=-max(start,end)-support-WORLD_PADDING*norm-roundoff
            if not all(math.isfinite(x) for x in (support,start,end,scale,roundoff,gap)):
                return dict(outside=False,reason='Non-finite plane calculation.')
            margins.append((gap/norm,index,start/norm,end/norm,support/norm,roundoff/norm))
    except (ArithmeticError,ValueError):return dict(outside=False,reason='Invalid plane calculation.')
    gap,index,start,end,support,roundoff=max(margins)
    if gap<=0:return dict(outside=False,reason='Sweep may touch or enter the rebuilt cell.')
    return dict(outside=True,plane_index=index,clearance=gap,start_distance=start,
                end_distance=end,extent_support=support,padding=WORLD_PADDING,roundoff_guard=roundoff)

def sweep_outside_cell(probe,planes):
    return separation_certificate(probe,planes)['outside']

def point_certificate(point_extent,planes):
    point=_numbers(point_extent,6)
    if point is None:return dict(outside=False,reason='Invalid point/extent.')
    return separation_certificate((*point[:3],*point[:3],*point[3:]),planes)

def point_outside_cell(point_extent,planes):
    return point_certificate(point_extent,planes)['outside']
