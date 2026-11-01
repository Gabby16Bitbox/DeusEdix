"""DeusEdix humanoid controls. The analytic IK matches Animation Studio exactly.

Bundled with the bridge; only the dedicated Blender process loads these handlers.
No neural model, external add-on or global Blender preference is needed.
"""
import copy
import math
import bpy
from bpy.app.handlers import persistent
from mathutils import Matrix, Quaternion, Vector
import blender_widgets
import blender_deformation

CHAINS = {s+'_'+limb: (s+'_'+a,s+'_'+b,s+'_'+c) for s in ('l','r')
          for limb,a,b,c in (('arm','upperarm','forearm','hand'),('leg','thigh','calf','foot'))}
BRIDGE=None
BUSY=False
LAST=None
REGISTERED=False


def frame_of(aim, hinge):
    x=aim.normalized(); y=(hinge-x*hinge.dot(x)).normalized()
    return Matrix((x,y,x.cross(y))).transposed().to_quaternion()


def world(bones, pose):
    joints={}; turns={}; rest={b['name']:Vector(b['head']) for b in bones}
    for b in bones:
        n,p=b['name'],b['parent']; q=pose['rot'][n]; q=Quaternion((q[3],*q[:3])).normalized()
        turns[n]=turns[p]@q if p else q
        joints[n]=joints[p]+turns[p]@(rest[n]-rest[p]) if p else rest[n]+Vector(pose['root'])
    return joints,turns,rest


def solve(bones, pose, ik):
    out=copy.deepcopy(pose)
    joints,turns,rest=world(bones,pose)
    parents={b['name']:b['parent'] for b in bones}
    for chain,t in ik.items():
        a,b,c=CHAINS[chain]; A=joints[a]; l1=(rest[b]-rest[a]).length; l2=(rest[c]-rest[b]).length
        target=Vector(t['v'])-A
        d=max(abs(l1-l2)+.001,min((l1+l2)*.9999,target.length))
        along=target.normalized() if target.length_squared>1e-9 else Vector((0,-1,0))
        def bend(direction):
            n=Vector((-1 if chain.endswith('arm') else 1,0,0)); n-=direction*n.dot(direction)
            return n.normalized() if n.length_squared>1e-6 else Vector((0,0,1))
        n=Vector(t['pole'])-A; n-=along*n.dot(along)
        n=n.normalized() if n.length_squared>1e-9 else bend(along)
        ca=max(-1,min(1,(l1*l1+d*d-l2*l2)/(2*l1*d)))
        middle=A+along*(l1*ca)+n*(l1*math.sqrt(1-ca*ca)); end=A+along*d
        rest_along=(rest[c]-rest[a]).normalized(); rest_hinge=rest_along.cross(bend(rest_along)).normalized()
        hinge=along.cross(n).normalized()
        r1=frame_of(middle-A,hinge)@frame_of(rest[b]-rest[a],rest_hinge).conjugated()
        r2=frame_of(end-middle,hinge)@frame_of(rest[c]-rest[b],rest_hinge).conjugated()
        # Preserve authored axial turns when snapping FK to IK. Older clips
        # have no twist sample and retain their original solver unchanged.
        twist=t.get('twist',(0.,0.))
        r1=Quaternion((middle-A).normalized(),twist[0])@r1
        r2=Quaternion((end-middle).normalized(),twist[1])@r2
        r3=Quaternion((t['q'][3],*t['q'][:3])).normalized()
        qs={a:(turns[parents[a]].conjugated()@r1 if parents[a] else r1),b:r1.conjugated()@r2,c:r2.conjugated()@r3}
        for name,q in qs.items():out['rot'][name]=[q.x,q.y,q.z,q.w]
    return out


def armature():
    return next((o for o in bpy.context.scene.objects if o.get('deusedix_controls')==1),None)


def control_chain(name):
    if name.startswith(('IK_','POLE_')):
        chain=name.split('_',1)[1]
        return chain if chain in CHAINS else None
    if name.startswith('FK_'):
        return next((c for c,names in CHAINS.items() if name[3:] in names),None)
    return None


def control_enabled(arm,name):
    if name=='ROOT':return True
    if name.startswith('FK_') and name[3:] in {b['name'] for b in BRIDGE.DATA['bones']}:
        chain=control_chain(name)
        return not chain or not bool(arm.get('ik_'+chain))
    chain=control_chain(name)
    return bool(chain and arm.get('ik_'+chain))


def selection_target(arm,name):
    """A limb has one set of editable controls, just as a Rigify IK/FK limb."""
    chain=control_chain(name)
    if chain and not control_enabled(arm,name):
        return 'IK_'+chain if arm.get('ik_'+chain) else 'FK_'+CHAINS[chain][2]
    return name


def set_selected(pb,value):
    # Blender 5 moved pose selection from Bone to PoseBone.
    selectable=pb if hasattr(pb,'select') else pb.bone
    if selectable.select!=value:selectable.select=value


def sync_controls(arm):
    active=arm.data.bones.active
    selected=active.name if active else ''
    target=selection_target(arm,selected)
    if target!=selected:
        set_selected(arm.pose.bones[selected],False)
        set_selected(arm.pose.bones[target],True)
        arm.data.bones.active=arm.data.bones[target]
        selected=target
    for pb in arm.pose.bones:
        name=pb.name;chain=control_chain(name)
        visible=control_enabled(arm,name)
        if name.startswith('POLE_'):visible=visible and selected in ('IK_'+chain,'POLE_'+chain)
        if name in ('FK_spine','FK_neck'):visible=bool(arm.get('advanced_controls'))
        if name=='ROOT' or name.startswith(('FK_','IK_','POLE_')):
            if pb.bone.hide==visible:pb.bone.hide=not visible
            if pb.bone.hide_select==visible:pb.bone.hide_select=not visible
            if not visible:
                set_selected(pb,False)
                if arm.data.bones.active==pb.bone:arm.data.bones.active=None
        else:
            # Showing the deformation skeleton is for inspection only.
            if not pb.bone.hide_select:pb.bone.hide_select=True
            set_selected(pb,False)


def fk_pose(arm):
    bones=BRIDGE.DATA['bones']; rest={b['name']:Vector(b['head']) for b in bones}; joints={};turns={};out={'root':[],'rot':{}}
    for b in bones:
        n,p=b['name'],b['parent']; pb=arm.pose.bones['FK_'+n]; m=pb.matrix
        if max(abs(v-1) for v in m.to_scale())>.0001 or (p and pb.location.length>.0001):
            raise ValueError('Controls keep bone lengths. Move Hips or an IK hand/foot; rotate the other controls.')
        turns[n]=m.to_quaternion()@arm.data.bones['FK_'+n].matrix_local.to_quaternion().conjugated()
        joints[n]=m.translation
        if p:
            expected=joints[p]+turns[p]@(BRIDGE.point(rest[n])-BRIDGE.point(rest[p]))
            if (joints[n]-expected).length>.0001:raise ValueError('A control changed a limb length. Reset its position/scale.')
        q=turns[p].conjugated()@turns[n] if p else turns[n]
        # Prefer the authored quaternion when equivalent to the evaluated pose.
        # Matrix decomposition can flip the chosen arc at an exact half-turn,
        # which changes Studio's shoulder correction even though the bone agrees.
        rest_turn=arm.data.bones['FK_'+n].matrix_local.to_quaternion()
        authored=rest_turn@pb.rotation_quaternion@rest_turn.conjugated()
        if not p and 'ROOT' in arm.pose.bones:
            root=arm.pose.bones['ROOT']
            authored=root.matrix.to_quaternion()@root.bone.matrix_local.to_quaternion().conjugated()@authored
        if pb.rotation_mode=='QUATERNION' and abs(q.normalized().dot(authored.normalized()))>1-1e-8:
            q=authored.normalized()
            if abs(q.w)<1e-7:q.w=0.;q.normalize()
        out['rot'][n]=BRIDGE.raw_rotation(q)
    out['root']=[a-b for a,b in zip(BRIDGE.raw(joints['pelvis']),rest['pelvis'])]
    return out


def foot_adjustment(arm,chain):
    if not chain.endswith('leg'):return Matrix.Identity(4)
    pivots=arm.get('deusedix_foot_pivots',{}).get(chain)
    if not pivots:return Matrix.Identity(4)
    roll=float(arm.get('roll_'+chain[0],0));rock=float(arm.get('rock_'+chain[0],0))
    def around(p,angle,axis):
        p=Vector(p);return Matrix.Translation(p)@Matrix.Rotation(angle,4,axis)@Matrix.Translation(-p)
    return around(pivots['toe' if roll>=0 else 'heel'],roll,Vector(pivots['side']))@around(pivots['inner' if rock>=0 else 'outer'],rock,Vector(pivots['forward']))


def ik_pose(arm,chain):
    target=arm.pose.bones['IK_'+chain]; pole=arm.pose.bones['POLE_'+chain]
    matrix=target.matrix@foot_adjustment(arm,chain)
    return {'v':BRIDGE.raw(matrix.translation),'q':BRIDGE.raw_rotation(matrix.to_quaternion()),'pole':BRIDGE.raw(pole.matrix.translation),'twist':list(target.get('twist',(0.,0.)))}


def signature(arm):
    values=[]
    for b in arm.pose.bones:
        if b.name=='ROOT' or b.name.startswith(('FK_','IK_','POLE_')):values.extend(v for row in b.matrix for v in row)
    values.extend(float(arm.get('ik_'+c,False)) for c in CHAINS)
    values.extend(float(arm.get('grip_'+s,0)) for s in ('l','r'))
    values.extend(float(arm.get(prop+'_'+s,0)) for s in ('l','r') for prop in ('roll','rock'))
    values.extend(float(v) for c in CHAINS for v in arm.pose.bones['IK_'+c].get('twist',(0.,0.)))
    values.append(bpy.context.scene.frame_current_final)
    return tuple(values)


def update(force=False):
    global BUSY,LAST
    if BUSY or not BRIDGE:return
    arm=armature()
    if not arm:return
    BUSY=True
    try:
        sync_controls(arm)
        sig=signature(arm)
        if not force and sig==LAST:return
        pose=fk_pose(arm)
        enabled={c:ik_pose(arm,c) for c in CHAINS if arm.get('ik_'+c)}
        pose=solve(BRIDGE.DATA['bones'],pose,enabled)
        matrices=BRIDGE.world_sample(pose)
        rests={b['name']:arm.data.bones[b['name']].matrix_local for b in BRIDGE.DATA['bones']}
        desired={n:m@rests[n].to_quaternion().to_matrix().to_4x4() for n,m in matrices.items()}
        for entry in BRIDGE.DATA['bones']:
            n,p=entry['name'],entry['parent']
            basis=rests[n].inverted()@desired[n] if not p else rests[n].inverted()@rests[p]@desired[p].inverted()@desired[n]
            arm.pose.bones[n].matrix_basis=basis
        blender_deformation.update(arm,BRIDGE,pose)
        for c in ('l_leg','r_leg'):
            # The selectable footprint follows the heel/toe pivot as well as the ankle.
            offset=foot_adjustment(arm,c);target=arm.pose.bones['IK_'+c]
            target.custom_shape_translation=offset.translation
            target.custom_shape_rotation_euler=offset.to_euler()
        for body in bpy.context.scene.objects:
            if body.get('deusedix_body') and body.data.shape_keys:
                for s,shape in BRIDGE.DATA['body'].get('grip',{}).items():
                    body.data.shape_keys.key_blocks['Grip '+s.upper()].value=arm.get('grip_'+s,shape['rest'])-shape['rest']
        LAST=sig
        arm['deusedix_control_error']=''
    except Exception as exc:
        arm['deusedix_control_error']=str(exc)
    finally:BUSY=False


@persistent
def changed(*args):update()


def sample_frame(frame):
    bpy.context.scene.frame_set(frame);bpy.context.view_layer.update();update(True);bpy.context.view_layer.update()


def configure(arm):
    """Upgrade only helper bones/widgets; preserve authored channels and skinning."""
    if arm.get('deusedix_widget_version',0)>=2:return
    previous_mode=arm.mode
    if previous_mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.objects.active=arm
    bpy.ops.object.mode_set(mode='EDIT')
    if 'ROOT' not in arm.data.edit_bones:
        points=[BRIDGE.point(BRIDGE.DATA['body']['position'][i:i+3]) for i in range(0,len(BRIDGE.DATA['body']['position']),3)]
        lo,hi=blender_widgets.bounds(points)
        root=arm.data.edit_bones.new('ROOT');root.head=((lo.x+hi.x)*.5,(lo.y+hi.y)*.5,lo.z)
        root.tail=root.head+Vector((0,BRIDGE.DATA['height']*BRIDGE.UNIT*.1,0));root.use_deform=False
        for name in ['FK_pelvis']+[prefix+c for c in CHAINS for prefix in ('IK_','POLE_')]:
            arm.data.edit_bones[name].parent=root
    bpy.ops.object.mode_set(mode='OBJECT')
    groups={name:arm.data.collections.get(name) or arm.data.collections.new(name) for name in ('Body','Arms','Legs','Bend directions','Deformation bones')}
    for bone in arm.data.bones:
        for collection in list(bone.collections):collection.unassign(bone)
        if bone.name.startswith('POLE_'):group='Bend directions'
        elif bone.name=='ROOT':group='Body'
        elif bone.name.startswith(('FK_','IK_')):
            group='Legs' if any(part in bone.name for part in ('thigh','calf','foot','leg')) else 'Arms' if any(part in bone.name for part in ('upperarm','forearm','hand','arm')) else 'Body'
        else:group='Deformation bones'
        groups[group].assign(bone)
    groups['Deformation bones'].is_visible=False
    old=arm.data.collections.get('Animation controls')
    if old and not old.bones:arm.data.collections.remove(old)
    for pb in arm.pose.bones:
        pb.rotation_mode='QUATERNION';pb.lock_scale=(True,)*3
        if pb.name.startswith('FK_') and pb.name!='FK_pelvis':pb.lock_location=(True,)*3
    for side in ('l','r'):
        for prop,label in (('roll','Heel / toe roll'),('rock','Side rock')):
            key=prop+'_'+side
            if key not in arm:arm[key]=0.
            arm.id_properties_ui(key).update(min=-math.pi/2,max=math.pi/2,soft_min=-math.pi/3,soft_max=math.pi/3,subtype='ANGLE',description=label+' around the sole; keyed with the IK foot')
    blender_widgets.fit(arm,BRIDGE)
    arm['deusedix_widget_version']=2
    if previous_mode!='OBJECT':bpy.ops.object.mode_set(mode=previous_mode)


def set_base(arm,pose):
    transforms=BRIDGE.world_sample(pose)
    for entry in BRIDGE.DATA['bones']:
        n,p=entry['name'],entry['parent']; pb=arm.pose.bones['FK_'+n]
        rest=arm.data.bones['FK_'+n].matrix_local
        desired=transforms[n]@rest.to_quaternion().to_matrix().to_4x4()
        if p:
            pr=arm.data.bones['FK_'+p].matrix_local
            pd=transforms[p]@pr.to_quaternion().to_matrix().to_4x4()
            pb.matrix_basis=rest.inverted()@pr@pd.inverted()@desired
        else:pb.matrix_basis=rest.inverted()@desired
        # Preserve the source half-turn sign; matrix_basis alone loses it.
        r=rest.to_quaternion()
        pb.rotation_quaternion=r.conjugated()@BRIDGE.rotation(pose['rot'][n])@r


def set_target(arm,chain,t):
    arm.pose.bones['IK_'+chain]['twist']=list(t.get('twist',(0.,0.)))
    arm.pose.bones['IK_'+chain].matrix=Matrix.Translation(BRIDGE.point(t['v']))@BRIDGE.rotation(t['q']).to_matrix().to_4x4()@foot_adjustment(arm,chain).inverted()
    arm.pose.bones['POLE_'+chain].matrix=Matrix.Translation(BRIDGE.point(t['pole']))


def key_control(arm,name,frame):
    if not control_enabled(arm,name):raise ValueError('This control is inactive. Switch this limb to '+('FK' if name.startswith('FK_') else 'IK')+' first.')
    b=arm.pose.bones[name]
    if name.startswith('POLE_'):b.keyframe_insert('location',frame=frame,group=name)
    else:
        b.keyframe_insert('rotation_quaternion',frame=frame,group=name)
        if name in ('ROOT','FK_pelvis') or name.startswith('IK_'):b.keyframe_insert('location',frame=frame,group=name)
        if name.startswith('IK_') and 'twist' in b:b.keyframe_insert('["twist"]',frame=frame,group=name)
        if name in ('IK_l_leg','IK_r_leg'):
            for prop in ('roll','rock'):arm.keyframe_insert('["'+prop+'_'+name[3]+'"]',frame=frame,group=name)


def key_all(arm,frame):
    if 'ROOT' in arm.pose.bones:key_control(arm,'ROOT',frame)
    for b in BRIDGE.DATA['bones']:
        name='FK_'+b['name']
        if control_enabled(arm,name):key_control(arm,name,frame)
    for c in CHAINS:
        if arm.get('ik_'+c):
            key_control(arm,'IK_'+c,frame);key_control(arm,'POLE_'+c,frame)
    for s in BRIDGE.DATA['body'].get('grip',{}):arm.keyframe_insert('["grip_'+s+'"]',frame=frame,group='Grip')


def snap_target(arm,chain,pose):
    J,R,_=world(BRIDGE.DATA['bones'],pose);a,b,c=CHAINS[chain];A,B,C=J[a],J[b],J[c]
    along=(C-A).normalized();n=B-A;n-=along*n.dot(along)
    # Keep the actual bend when snapping back from FK. Replacing a shallow but
    # valid bend with a default direction makes the elbow jump at the IK switch.
    if n.length<.000001*BRIDGE.DATA['height']:
        n=Vector((-1 if chain.endswith('arm') else 1,0,0));n-=along*n.dot(along)
    n=n.normalized() if n.length_squared>1e-9 else Vector((0,0,1))
    q=R[c]
    target={'v':list(C),'q':[q.x,q.y,q.z,q.w],'pole':list(B+n*((B-A).length+(C-B).length)*.6)}
    snapped=solve(BRIDGE.DATA['bones'],pose,{chain:target})
    _,canonical,_=world(BRIDGE.DATA['bones'],snapped)
    twists=[]
    for bone,axis in ((a,(B-A).normalized()),(b,(C-B).normalized())):
        delta=R[bone]@canonical[bone].conjugated()
        angle=2*math.atan2(Vector((delta.x,delta.y,delta.z)).dot(axis),delta.w)
        twists.append((angle+math.pi)%(2*math.pi)-math.pi)
    target['twist']=twists
    return target


def build(bridge):
    global BRIDGE,BUSY,LAST
    BRIDGE=bridge;BUSY=True;LAST=None
    sc=bpy.context.scene; arm=next(o for o in sc.objects if o.get('deusedix_rig'))
    data=bridge.DATA; payload=data['controls'];active=bool(sc.get('deusedix_imported_keys'))
    frames=list(range(data['animation']['frames'])) if active else [max(0,min(data['animation']['frames']-1,data.get('frame',0)))]
    if arm.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
    # Start clean: all authored motion now belongs to the control armature channels.
    arm.animation_data_clear()
    for obj in sc.objects:
        if obj.get('deusedix_body') and obj.data.shape_keys:obj.data.shape_keys.animation_data_clear()
    bpy.context.view_layer.objects.active=arm;bpy.ops.object.mode_set(mode='EDIT')
    for entry in data['bones']:
        original=arm.data.edit_bones[entry['name']]; b=arm.data.edit_bones.new('FK_'+entry['name'])
        b.matrix=original.matrix.copy();b.length=original.length;b.use_deform=False
        if entry['parent']:b.parent=arm.data.edit_bones['FK_'+entry['parent']]
    for c,(_,_,end) in CHAINS.items():
        for prefix in ('IK_','POLE_'):
            b=arm.data.edit_bones.new(prefix+c);b.head=bridge.point(next(x['head'] for x in data['bones'] if x['name']==end))
            b.tail=b.head+Vector((0,max(.03,data['height']*bridge.UNIT*.06),0));b.use_deform=False
    bpy.ops.object.mode_set(mode='OBJECT')
    configure(arm)
    arm.lock_location=arm.lock_rotation=arm.lock_scale=(True,True,True)
    arm['deusedix_controls']=1
    arm['advanced_controls']=False
    for c in CHAINS:arm['ik_'+c]=bool(payload['ik'].get(c,{}).get('enabled'))
    for s,entry in data['body'].get('grip',{}).items():
        arm['grip_'+s]=float(entry['rest']);arm.id_properties_ui('grip_'+s).update(min=0.,max=1.,soft_min=0.,soft_max=1.,description='Open to closed hand')
    for f in frames:
        set_base(arm,payload['fkSamples'][f])
        for c in CHAINS:
            t=payload['ik'][c]['samples'][f] if c in payload['ik'] else snap_target(arm,c,payload['fkSamples'][f])
            set_target(arm,c,t)
        for s,entry in data['body'].get('grip',{}).items():
            value=data['samples'][f].get('grip',{}).get(s)
            # JSON 0/1 must not turn this into an integer Blender property;
            # otherwise intermediate hand poses round to fully open/closed.
            arm['grip_'+s]=float(value if value is not None else entry['rest'])
        if active:key_all(arm,f+1)
    for pb in arm.pose.bones:
        if pb.name!='ROOT' and not pb.name.startswith(('FK_','IK_','POLE_')):pb.lock_location=pb.lock_rotation=pb.lock_scale=(True,True,True)
    BUSY=False;install(bridge)
    sample_frame(max(1,min(sc.frame_end,data.get('frame',0)+1)))
    bpy.ops.object.mode_set(mode='POSE');select('FK_pelvis')


def collect():
    arm=armature()
    if not arm:return None
    if arm.get('deusedix_control_error'):raise ValueError(arm['deusedix_control_error'])
    base=fk_pose(arm)
    return {'fk':base,'ik':{c:{'enabled':bool(arm.get('ik_'+c)),**ik_pose(arm,c)} for c in CHAINS}}


def select(name):
    arm=armature()
    if not arm:return
    name=selection_target(arm,name)
    if not control_enabled(arm,name):return
    if name in ('FK_spine','FK_neck'):arm['advanced_controls']=True
    for b in arm.pose.bones:set_selected(b,False)
    selected=arm.pose.bones[name]
    set_selected(selected,True)
    arm.data.bones.active=arm.data.bones[name]
    update()


def toggle(chain):
    arm=armature();on=not bool(arm['ik_'+chain]);sc=bpy.context.scene;current=sc.frame_current
    animated=bool(arm.animation_data and arm.animation_data.action)
    records=[]
    previous_twist=None
    for f in range(sc.frame_start,sc.frame_end+1) if animated else [current]:
        sample_frame(f);base=fk_pose(arm);iks={c:ik_pose(arm,c) for c in CHAINS if arm.get('ik_'+c)}
        pose=solve(BRIDGE.DATA['bones'],base,iks)
        value=snap_target(arm,chain,pose) if on else pose
        if on:
            if previous_twist is not None:
                value['twist']=[angle+round((old-angle)/(2*math.pi))*2*math.pi for old,angle in zip(previous_twist,value['twist'])]
            previous_twist=value['twist']
        records.append((f,value))
    arm['ik_'+chain]=on
    for f,value in records:
        sc.frame_set(f)
        if on:
            set_target(arm,chain,value)
            if animated:
                key_control(arm,'IK_'+chain,f);key_control(arm,'POLE_'+chain,f)
        else:
            # Only this limb is baked to FK; all other controls remain editable.
            for n in CHAINS[chain]:
                pb=arm.pose.bones['FK_'+n];rest=arm.data.bones['FK_'+n].matrix_local.to_quaternion()
                q=BRIDGE.rotation(value['rot'][n]);pb.rotation_quaternion=rest.conjugated()@q@rest
                if animated:key_control(arm,'FK_'+n,f)
    sample_frame(current);select(('IK_'+chain) if on else 'FK_'+CHAINS[chain][0])


class DXRIG_OT_select(bpy.types.Operator):
    bl_idname='deusedix.select_control';bl_label='Select control';bl_options={'INTERNAL'}
    control:bpy.props.StringProperty()
    def execute(self,context):select(self.control);return {'FINISHED'}


class DXRIG_OT_ik(bpy.types.Operator):
    bl_idname='deusedix.switch_ik';bl_label='Switch IK / FK';bl_options={'REGISTER','UNDO'}
    bl_description='Switch this limb between joint rotations (FK) and hand/foot targets (IK), keeping its poses. Only active controls can be selected or keyed'
    chain:bpy.props.StringProperty()
    def execute(self,context):
        try:toggle(self.chain);return {'FINISHED'}
        except Exception as exc:self.report({'ERROR'},str(exc));return {'CANCELLED'}


class DXRIG_OT_key(bpy.types.Operator):
    bl_idname='deusedix.key_control';bl_label='Key control';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        arm=armature();bone=context.active_pose_bone
        if bone and control_enabled(arm,bone.name):key_control(arm,bone.name,context.scene.frame_current);return {'FINISHED'}
        self.report({'WARNING'},'Select a control first.');return {'CANCELLED'}


def reset_control(arm,name):
    if not control_enabled(arm,name):raise ValueError('Select an active FK or IK control first.')
    if name=='ROOT' or name.startswith('FK_'):arm.pose.bones[name].matrix_basis=Matrix.Identity(4)
    elif name.startswith(('IK_','POLE_')):
        chain=name.split('_',1)[1]
        if name.startswith('IK_'):
            if chain.endswith('leg'):arm['roll_'+chain[0]]=arm['rock_'+chain[0]]=0.
            set_target(arm,chain,snap_target(arm,chain,fk_pose(arm)))
        else:
            t=snap_target(arm,chain,solve(BRIDGE.DATA['bones'],fk_pose(arm),{c:ik_pose(arm,c) for c in CHAINS if arm.get('ik_'+c)}))
            arm.pose.bones[name].matrix=Matrix.Translation(BRIDGE.point(t['pole']))
    else:raise ValueError('Select an animation control first.')
    bpy.context.view_layer.update();update(True);bpy.context.view_layer.update()


class DXRIG_OT_reset(bpy.types.Operator):
    bl_idname='deusedix.reset_control';bl_label='Reset control';bl_options={'REGISTER','UNDO'}
    bl_description='Reset selected FK control to rest, or snap the IK control to its FK pose; does not add a key'
    def execute(self,context):
        if not context.active_pose_bone:self.report({'WARNING'},'Select a control first.');return {'CANCELLED'}
        try:reset_control(armature(),context.active_pose_bone.name);return {'FINISHED'}
        except Exception as exc:self.report({'ERROR'},str(exc));return {'CANCELLED'}


class DXRIG_OT_focus(bpy.types.Operator):
    bl_idname='deusedix.focus_control';bl_label='Frame control';bl_description='Center the view on the selected control'
    def execute(self,context):
        arm=armature();bone=context.active_pose_bone
        if not bone or context.area.type!='VIEW_3D':return {'CANCELLED'}
        view=context.space_data.region_3d;view.view_location=arm.matrix_world@bone.matrix.translation
        view.view_distance=BRIDGE.DATA['height']*BRIDGE.UNIT*(1.8 if bone.name=='ROOT' else .65)
        return {'FINISHED'}


def draw(layout,context):
    arm=armature()
    if not arm:return
    layout.label(text='Body controls')
    layout.operator('deusedix.select_control',text='Root · move the whole character').control='ROOT'
    row=layout.row(align=True)
    for name,label in (('pelvis','Hips'),('chest','Chest'),('head','Head')):
        row.operator('deusedix.select_control',text=label).control='FK_'+name
    for limb in ('arm','leg'):
        row=layout.row(align=True)
        for side in ('l','r'):
            c=side+'_'+limb;label=side.upper()+' '+('hand' if limb=='arm' else 'foot');on=bool(arm['ik_'+c])
            col=row.column(align=True)
            col.operator('deusedix.select_control',text=label).control='IK_'+c if on else 'FK_'+CHAINS[c][2]
            col.operator('deusedix.switch_ik',text='IK' if on else 'FK',icon='ARROW_LEFTRIGHT',depress=on).chain=c
    active=context.active_pose_bone
    if active and control_enabled(arm,active.name) and active.name.startswith(('IK_','POLE_')):
        c=active.name.split('_',1)[1]
        layout.operator('deusedix.select_control',text='Bend direction').control='POLE_'+c
        if c.endswith('leg'):
            row=layout.row(align=True)
            row.prop(arm,'["roll_'+c[0]+'"]',text='Roll');row.prop(arm,'["rock_'+c[0]+'"]',text='Rock')
        if arm.get('advanced_controls'):
            target=arm.pose.bones['IK_'+c]
            if 'twist' in target:
                row=layout.row(align=True)
                row.prop(target,'["twist"]',index=0,text='Upper twist')
                row.prop(target,'["twist"]',index=1,text='Lower twist')
    row=layout.row(align=True);row.operator('deusedix.key_control');row.operator('deusedix.key_pose')
    row=layout.row(align=True);row.operator('deusedix.reset_control',text='Reset');row.operator('deusedix.focus_control',text='Frame')
    for s in BRIDGE.DATA['body'].get('grip',{}):layout.prop(arm,'["grip_'+s+'"]',text=s.upper()+' grip',slider=True)
    layout.prop(arm.data.collections['Deformation bones'],'is_visible',text='Show bones')
    layout.prop(arm,'["advanced_controls"]',text='More controls')
    if arm.get('deusedix_control_error'):layout.label(text=arm['deusedix_control_error'],icon='ERROR')


def install(bridge):
    global BRIDGE,LAST,REGISTERED
    BRIDGE=bridge;LAST=None
    arm=armature()
    if arm:
        configure(arm)
        for c in CHAINS:
            target=arm.pose.bones['IK_'+c]
            if 'twist' not in target:target['twist']=[0.,0.]
            target.id_properties_ui('twist').update(min=-math.pi*2,max=math.pi*2,soft_min=-math.pi,soft_max=math.pi,subtype='ANGLE',description='Axial turn of upper and lower limb; preserves the FK pose when switching to IK')
    if not REGISTERED:
        for cls in (DXRIG_OT_select,DXRIG_OT_ik,DXRIG_OT_key,DXRIG_OT_reset,DXRIG_OT_focus):bpy.utils.register_class(cls)
        REGISTERED=True
    for handlers in (bpy.app.handlers.depsgraph_update_post,bpy.app.handlers.frame_change_post):
        if changed not in handlers:handlers.append(changed)
