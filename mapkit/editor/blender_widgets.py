"""Anatomical widgets for the fixed DeusEdix rig. No changes to deformation bones.

Follows Rigify's control conventions (root, body, FK rings, IK extremities,
pole directions); widget geometry is fitted to this character, not copied.
"""
import math
import bpy
from mathutils import Matrix, Vector

COLORS={'left':(.32,.64,.95),'right':(.95,.38,.32),'body':(.92,.72,.28)}


def region(data,index,point):
    body=data['body'];out=[]
    for i in range(len(body['position'])//3):
        weight=sum(body['weights'][i*4+j] for j in range(4) if body['bones'][i*4+j]==index)
        if weight>=.35:out.append(point(body['position'][i*3:i*3+3]))
    return out or [point(data['bones'][index][k]) for k in ('head','tail')]


def bounds(points):
    return Vector([min(p[i] for p in points) for i in range(3)]),Vector([max(p[i] for p in points) for i in range(3)])


def loop(points):return points,[(i,(i+1)%len(points)) for i in range(len(points))]


def ellipse(center,u,v,rx,ry):
    return loop([center+u*(rx*math.cos(i*math.tau/40))+v*(ry*math.sin(i*math.tau/40)) for i in range(40)])


def box(points,orientation,margin):
    inv=orientation.inverted();lo,hi=bounds([inv@p for p in points]);lo-=Vector((margin,)*3);hi+=Vector((margin,)*3)
    verts=[orientation@Vector((x,y,z)) for x in (lo.x,hi.x) for y in (lo.y,hi.y) for z in (lo.z,hi.z)]
    return verts,[(i,j) for i in range(8) for j in range(i+1,8) if (i^j) in (1,2,4)]


def assign(arm,pb,geometry,space,collection):
    points,edges=geometry;inv=space.inverted()
    mesh=bpy.data.meshes.new('DXW '+pb.name);mesh.from_pydata([inv@Vector(p) for p in points],edges,[])
    widget=bpy.data.objects.new('DXW '+pb.name,mesh);collection.objects.link(widget)
    widget.hide_render=True;widget.hide_set(True)
    pb.custom_shape=widget;pb.custom_shape_transform=None;pb.use_custom_shape_bone_size=False
    pb.custom_shape_scale_xyz=(1,1,1);pb.custom_shape_translation=(0,0,0);pb.custom_shape_rotation_euler=(0,0,0)
    if hasattr(pb,'custom_shape_wire_width'):pb.custom_shape_wire_width=2
    kind='left' if '_l_' in pb.name else 'right' if '_r_' in pb.name else 'body'
    color=COLORS[kind];pb.color.palette='CUSTOM';pb.color.custom.normal=color
    pb.color.custom.select=tuple(min(1,v+.15) for v in color);pb.color.custom.active=(1,.95,.65)


def fit(arm,bridge):
    data=bridge.DATA;H=data['height']*bridge.UNIT
    collection=bpy.data.collections.new('DeusEdix control shapes');bpy.context.scene.collection.children.link(collection)
    collection.hide_render=True
    names={b['name']:i for i,b in enumerate(data['bones'])};pivots={}
    for name,index in names.items():
        pb=arm.pose.bones['FK_'+name];rest=arm.data.bones[pb.name].matrix_local
        points=region(data,index,bridge.point);lo,hi=bounds(points);center=(lo+hi)*.5
        if name in ('pelvis','spine','chest','neck','head'):
            geometry=ellipse(center,Vector((1,0,0)),Vector((0,1,0)),max((hi.x-lo.x)*.5,H*.035)+H*.012,max((hi.y-lo.y)*.5,H*.035)+H*.012)
        elif name.endswith(('hand','foot')):geometry=box(points,rest,H*.009)
        else:
            axis=(arm.data.bones[pb.name].tail_local-rest.translation).normalized()
            # Skin bounds determine the visual center. A guessed joint may be
            # off the mesh centerline; moving the widget must not move its pivot.
            u=axis.cross(Vector((1,0,0)))
            if u.length<.01:u=axis.cross(Vector((0,1,0)))
            u.normalize();v=axis.cross(u).normalized()
            geometry=ellipse(center,u,v,max(abs((p-center).dot(u)) for p in points)+H*.009,max(abs((p-center).dot(v)) for p in points)+H*.009)
        assign(arm,pb,geometry,rest,collection)
        if not name.endswith(('hand','foot')):continue
        side=name[0];chain=side+('_arm' if name.endswith('hand') else '_leg')
        target=arm.pose.bones['IK_'+chain];space=Matrix.Translation(bridge.point(data['bones'][index]['head']))
        if name.endswith('foot'):
            # The female and HDTP reference poses need not face the same axis.
            forward=bridge.point(data['bones'][index]['tail'])-space.translation;forward.z=0
            if forward.length<.0001:forward=Vector((1,0,0))
            forward.normalize();side_axis=Vector((0,0,1)).cross(forward)
            axes=Matrix((forward,side_axis,Vector((0,0,1)))).transposed()
            lo,hi=bounds([axes.transposed()@(p-space.translation) for p in points])
            z=lo.z+H*.003;pad=H*.012
            footprint=[(lo.x-pad,lo.y-pad,z),(hi.x,lo.y-pad,z),(hi.x+pad,(lo.y+hi.y)*.5,z),(hi.x,hi.y+pad,z),(lo.x-pad,hi.y+pad,z)]
            geometry=loop([space.translation+axes@Vector(p) for p in footprint])
            center=(lo+hi)*.5
            pivots[chain]={k:list(axes@Vector(p)) for k,p in {
                'heel':(lo.x,center.y,lo.z),'toe':(hi.x,center.y,lo.z),
                'inner':(center.x,lo.y,lo.z),'outer':(center.x,hi.y,lo.z)}.items()}
            pivots[chain].update(forward=list(forward),side=list(side_axis))
        assign(arm,target,geometry,space,collection)
        pole=arm.pose.bones['POLE_'+chain];size=H*.028
        # A small 3D diamond stays readable from every viewing angle.
        verts=[Vector(p)*size for p in ((1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1))]
        edges=[(i,j) for i in range(6) for j in range(i+1,6) if i//2!=j//2]
        assign(arm,pole,(verts,edges),Matrix.Identity(4),collection)
    arm['deusedix_foot_pivots']=pivots
    root=arm.pose.bones['ROOT'];center=arm.data.bones['ROOT'].head_local
    root_shape=ellipse(center,Vector((1,0,0)),Vector((0,1,0)),H*.24,H*.24)
    verts,edges=root_shape
    for angle in range(4):
        u=Vector((math.cos(angle*math.pi/2),math.sin(angle*math.pi/2),0));v=Vector((-u.y,u.x,0));at=len(verts)
        verts.extend([center+u*H*.24-v*H*.025,center+u*H*.29,center+u*H*.24+v*H*.025]);edges.extend([(at,at+1),(at+1,at+2)])
    assign(arm,root,(verts,edges),arm.data.bones['ROOT'].matrix_local,collection)
