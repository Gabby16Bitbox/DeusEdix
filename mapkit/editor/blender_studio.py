"""Bundled Blender 4.3+ bridge, launched in its own instance with a project exchange.

No global add-on installation, embedded scripts, networking, or game-file writes.
"""
import base64
import copy
import json
import math
from pathlib import Path
import sys
import traceback
from types import SimpleNamespace
# Blender executes --python scripts without adding their folder to sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import blender_controls
import blender_deformation

import bpy
from mathutils import Matrix, Quaternion, Vector

UNIT = 1 / 52.5
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
CQ = C.to_quaternion()
DIRECTORY = None
DATA = None


def control_bridge():
    return SimpleNamespace(DATA=DATA,point=point,raw=raw,rotation=rotation,raw_rotation=raw_rotation,world_sample=world_sample,UNIT=UNIT)


def point(v):
    return C @ Vector(v) * UNIT


def raw(v):
    return list(C.transposed() @ v / UNIT)


def rotation(q):
    return CQ @ Quaternion((q[3], *q[:3])).normalized() @ CQ.conjugated()


def raw_rotation(q):
    q = CQ.conjugated() @ q @ CQ
    q.normalize()
    return [q.x, q.y, q.z, q.w]


def write(name, value):
    p = DIRECTORY / name
    temp = p.with_suffix('.tmp')
    temp.write_text(json.dumps(value, allow_nan=False, separators=(',', ':')), encoding='utf-8')
    temp.replace(p)


def material(data, index):
    m = bpy.data.materials.new('Studio material ' + str(index))
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = tuple(data.get('color', [1, 1, 1])) + (1,)
    bsdf.inputs['Roughness'].default_value = 1
    if data.get('png'):
        image_path = DIRECTORY / ('texture_%s.png' % index)
        image_path.write_bytes(base64.b64decode(data['png'].split(',', 1)[1], validate=True))
        image = bpy.data.images.load(str(image_path), check_existing=True)
        image.pack()
        node = m.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = image
        node.interpolation = 'Closest'
        m.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
        if data.get('alpha'):
            m.node_tree.links.new(node.outputs['Alpha'], bsdf.inputs['Alpha'])
    return m


def mesh_object(data, name, materials):
    mesh = bpy.data.meshes.new(name)
    positions = [point(data['position'][i:i+3]) for i in range(0, len(data['position']), 3)]
    indices = data.get('index') or list(range(len(positions)))
    mesh.from_pydata(positions, [], [indices[i:i+3] for i in range(0, len(indices), 3)])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for mat in materials:
        mesh.materials.append(mat)
    uv = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        i = loop.vertex_index * 2
        uv.data[loop.index].uv = data['uv'][i:i+2]
    for group in data.get('groups', []):
        for i in range(group['start'] // 3, (group['start'] + group['count']) // 3):
            mesh.polygons[i].material_index = group['materialIndex']
    return obj


def world_sample(sample):
    transforms = {}
    for bone in DATA['bones']:
        n, parent = bone['name'], bone['parent']
        r = rotation(sample['rot'][n])
        j = point(bone['head'])
        if parent:
            p = transforms[parent]
            rest_parent = next(b for b in DATA['bones'] if b['name'] == parent)
            j = p.translation + p.to_quaternion() @ (j - point(rest_parent['head']))
            r = p.to_quaternion() @ r
        else:
            j += point(sample['root'])
        transforms[n] = Matrix.Translation(j) @ r.to_matrix().to_4x4()
    return transforms


def has_keys(animation):
    def keyed(value):
        if isinstance(value, list):
            return any(isinstance(k, dict) and 'f' in k for k in value)
        return isinstance(value, dict) and any(keyed(v) for v in value.values())
    return any(keyed(animation.get(k)) for k in ('keys', 'tracks', 'curves', 'ik', 'grip'))


def ground_character():
    """Presentation offset only: leave the game rig and exported root motion intact."""
    sc = bpy.context.scene
    arm = next(o for o in sc.objects if o.get('deusedix_rig'))
    body = next(o for o in sc.objects if o.get('deusedix_body'))
    bpy.context.view_layer.update()
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    lowest = min((evaluated.matrix_world @ v.co).z for v in evaluated.data.vertices)
    delta = Vector((0, 0, -lowest))
    arm.location += delta
    for obj in sc.objects:
        if obj.get('deusedix_prop') and obj.parent is None:
            obj.location += delta
    sc['deusedix_origin_offset'] = list(Vector(sc.get('deusedix_origin_offset', (0,0,0))) + delta)
    bpy.context.view_layer.update()
    return delta


def key_pose(context):
    arm = next(o for o in context.scene.objects if o.get('deusedix_rig'))
    frame = context.scene.frame_current
    if arm.get('deusedix_controls'):
        blender_controls.key_all(arm,frame)
        return
    for pb in arm.pose.bones:
        channel = 'rotation_quaternion' if pb.rotation_mode == 'QUATERNION' else ('rotation_axis_angle' if pb.rotation_mode == 'AXIS_ANGLE' else 'rotation_euler')
        pb.keyframe_insert(channel, frame=frame, group=pb.name)
        if not pb.parent:
            pb.keyframe_insert('location', frame=frame, group=pb.name)
    body = next(o for o in context.scene.objects if o.get('deusedix_body'))
    if body.data.shape_keys:
        for side in ('L', 'R'):
            key = body.data.shape_keys.key_blocks.get('Grip ' + side)
            if key: key.keyframe_insert('value', frame=frame)


def action_frames(obj):
    """Explicit keys on this object's active action (legacy and layered actions)."""
    data = obj.animation_data
    action = data.action if data else None
    if not action: return set()
    if hasattr(action, 'fcurves'):
        curves = action.fcurves
    else:
        slot = getattr(data, 'action_slot_handle', None)
        curves = [fc for layer in action.layers for strip in layer.strips
                  for bag in getattr(strip, 'channelbags', [])
                  if slot is None or bag.slot_handle == slot for fc in bag.fcurves]
    return {int(round(key.co.x)) for fc in curves for key in fc.keyframe_points}


def build():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, DATA['animation']['frames']
    sc.render.fps = round(DATA['animation']['fps']) or 1
    sc.render.fps_base = sc.render.fps / DATA['animation']['fps']
    sc['deusedix_session'] = DATA['session']
    sc['deusedix_exchange'] = str(DIRECTORY)
    sc['deusedix_loop'] = DATA['animation'].get('loop', True)
    sc['deusedix_origin_offset'] = (0.0, 0.0, 0.0)
    sc.tool_settings.use_keyframe_insert_auto = False
    include_keys = DATA.get('includeKeys', True) and has_keys(DATA['animation'])
    sc['deusedix_imported_keys'] = include_keys
    initial_frame = max(0, min(sc.frame_end-1, DATA.get('frame', 0)))
    samples = list(enumerate(DATA['samples'])) if include_keys else [(initial_frame, DATA['samples'][initial_frame])]
    arm = bpy.data.objects.new('DeusEdix rig', bpy.data.armatures.new('DeusEdix skeleton'))
    bpy.context.collection.objects.link(arm)
    arm['deusedix_rig'] = True
    arm.show_in_front = True
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    # Connect the display endpoints to the actual child joints. Pivots/weights
    # stay in the game's fitted rest pose; no straightening of existing motion.
    children = {b['name']: [c for c in DATA['bones'] if c['parent'] == b['name']] for b in DATA['bones']}
    primary = {'pelvis': 'spine', 'chest': 'neck'}
    for entry in DATA['bones']:
        b = arm.data.edit_bones.new(entry['name'])
        b.head = point(entry['head'])
        b.tail = point(entry['tail'])
        child = next((c for c in children[b.name] if c['name'] == primary.get(b.name)), None)
        if child is None and len(children[b.name]) == 1: child = children[b.name][0]
        if child: b.tail = point(child['head'])
        if (b.tail - b.head).length < .005:
            b.tail = b.head + Vector((0, .04, 0))
        if entry['parent']:
            b.parent = arm.data.edit_bones[entry['parent']]
        b.use_connect = bool(b.parent and (b.head-b.parent.tail).length < .00001)
    blender_deformation.build_bones(arm, DATA)
    bpy.ops.object.mode_set(mode='OBJECT')
    body_data = DATA['body']
    materials = [material(m, i) for i, m in enumerate(body_data['materials'])]
    body = mesh_object(body_data, 'Character', materials)
    body['deusedix_body'] = True
    body.parent = arm
    groups = [body.vertex_groups.new(name=b['name']) for b in DATA['bones']]
    for i in range(len(body.data.vertices)):
        for j in range(4):
            w = body_data['weights'][i*4+j]
            if w > 0:
                groups[body_data['bones'][i*4+j]].add([i], w, 'REPLACE')
    blender_deformation.bind(arm, body, DATA)
    modifier = body.modifiers.new('Studio skeleton', 'ARMATURE')
    modifier.object = arm
    # Grip is a shape key because the game's hands are vertex animations, not finger bones.
    if body_data.get('grip'):
        body.shape_key_add(name='Basis')
        for side, shape in body_data['grip'].items():
            # Each hand starts from Basis, not from the other hand's active grip.
            key = body.shape_key_add(name='Grip ' + side.upper(), from_mix=False)
            key.slider_min, key.slider_max = -1, 1
            for i, delta in enumerate(shape['delta']):
                key.data[i].co += point(delta)
            for f, sample in samples:
                value = sample.get('grip', {}).get(side)
                key.value = 0 if value is None else value - shape['rest']
                if include_keys: key.keyframe_insert('value', frame=f+1)
    rests = {b.name: b.matrix_local.copy() for b in arm.data.bones}
    for b in arm.data.bones:
        b['deusedix_rest'] = [v for row in b.matrix_local for v in row]
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    for f, sample in samples:
        w = world_sample(sample)
        desired = {n: m @ rests[n].to_quaternion().to_matrix().to_4x4() for n, m in w.items()}
        for entry in DATA['bones']:
            n, p = entry['name'], entry['parent']
            pb = arm.pose.bones[n]
            basis = rests[n].inverted() @ desired[n] if not p else rests[n].inverted() @ rests[p] @ desired[p].inverted() @ desired[n]
            pb.matrix_basis = basis
            if include_keys: pb.keyframe_insert('rotation_quaternion', frame=f+1, group=n)
            if not p and include_keys:
                pb.keyframe_insert('location', frame=f+1, group=n)
    sc.frame_set(1)
    for prop in DATA.get('props', []):
        p, geometry = prop['definition'], prop['geometry']
        obj = mesh_object(geometry, p['cls'], [material(m, 'p_' + p['id'] + '_' + str(i)) for i, m in enumerate(geometry['materials'])])
        obj['deusedix_prop'] = p['id']
        obj['deusedix_enabled'] = p.get('enabled', True)
        obj.hide_render = not p.get('enabled', True)
        q = rotation(prop['quaternion'])
        obj.rotation_mode = 'QUATERNION'
        obj.scale = (p['scale'],)*3
        if p.get('space') == 'scene':
            obj.location = point(p['position'])
            obj.rotation_quaternion = q
        else:
            bone = arm.data.bones[p['bone']]
            inv = bone.matrix_local.to_quaternion().conjugated()
            obj.parent, obj.parent_type, obj.parent_bone = arm, 'BONE', p['bone']
            obj.location = inv @ point(p['position']) - Vector((0, bone.length, 0))
            obj.rotation_quaternion = inv @ q
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    sc.frame_set(initial_frame + 1)
    ground_character()
    if DATA.get('controls'):
        blender_controls.build(control_bridge())
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.shading.color_type = 'TEXTURE'
                area.spaces.active.overlay.show_floor = True
                area.spaces.active.show_region_ui = True
                region = area.spaces.active.region_3d
                region.view_distance = 3.7
                region.view_location = arm.matrix_world @ arm.pose.bones['pelvis'].head
                region.view_rotation = Quaternion((.8, .3, .2, .4)).normalized()
    bpy.ops.wm.save_as_mainfile(filepath=str(DIRECTORY / 'animation.blend'))


def collect():
    sc = bpy.context.scene
    if sc.get('deusedix_session') != DATA['session']:
        raise ValueError('Open the Blender scene for this DeusEdix session.')
    arms = [o for o in sc.objects if o.get('deusedix_rig')]
    if len(arms) != 1:
        raise ValueError('Keep one DeusEdix rig in the scene.')
    arm = arms[0]
    bpy.context.view_layer.update()
    names = {b['name'] for b in DATA['bones']}
    if not names <= set(arm.pose.bones.keys()):
        raise ValueError('A Studio bone is missing. Restore its original name.')
    for entry in DATA['bones']:
        bone = arm.data.bones[entry['name']]
        if (bone.parent.name if bone.parent else None) != entry['parent'] or (bone.head_local-point(entry['head'])).length > .0001:
            raise ValueError('Keep the original skeleton hierarchy and rest positions; animate it in Pose Mode.')
        saved_rest = bone.get('deusedix_rest')
        if not saved_rest or max(abs(v-saved_rest[i]) for i,v in enumerate(v for row in bone.matrix_local for v in row)) > .0001:
            raise ValueError('The skeleton rest pose changed. Restore it and animate in Pose Mode.')
    frames = sc.frame_end - sc.frame_start + 1
    if not 1 <= frames <= 10000:
        raise ValueError('Choose a frame range from 1 to 10,000 frames.')
    samples, props, first_props = [], [], None
    controls={'schema':1,'fkSamples':[],'ik':{c:{'enabled':bool(arm.get('ik_'+c)),'samples':[]} for c in blender_controls.CHAINS}} if arm.get('deusedix_controls') else None
    current = sc.frame_current
    origin = Vector(sc.get('deusedix_origin_offset', (0,0,0)))
    if controls is not None and ((arm.matrix_world.translation-origin).length > .0001 or arm.matrix_world.to_quaternion().angle > .0001):
        raise ValueError('Keep the rig object in place. Move Root, Hips or the hand/foot controls in Pose Mode.')
    baseline = {p['id']: p for p in DATA['animation'].get('props', [])}
    prop_objects = {o.get('deusedix_prop'): o for o in sc.objects if o.get('deusedix_prop')}
    if set(prop_objects) != set(baseline):
        raise ValueError('Add or remove game props in Animation Studio, then send again.')
    body = next((o for o in sc.objects if o.get('deusedix_body')), None)
    try:
        for f in range(sc.frame_start, sc.frame_end+1):
            sc.frame_set(f)
            bpy.context.view_layer.update()
            if controls is not None:
                blender_controls.update(True);bpy.context.view_layer.update()
                values=blender_controls.collect();controls['fkSamples'].append(values['fk'])
                for c,t in values['ik'].items():
                    if t['enabled']!=controls['ik'][c]['enabled']:raise ValueError('Use one IK/FK mode for each limb throughout the clip.')
                    controls['ik'][c]['samples'].append({k:t[k] for k in ('v','q','pole','twist')})
            evaluated = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
            world, joints = {}, {}
            for entry in DATA['bones']:
                n = entry['name']
                pb = evaluated.pose.bones[n]
                if entry['parent'] and pb.location.length > .0001:
                    raise ValueError('A bone was translated or stretched. Move the pelvis; rotate limbs or use non-stretching IK.')
                m = evaluated.matrix_world @ pb.matrix
                if max(abs(v - 1) for v in m.to_scale()) > .0001:
                    raise ValueError('Bone scaling is not supported. Use rotations and move the pelvis.')
                world[n] = m.to_quaternion() @ arm.data.bones[n].matrix_local.to_quaternion().conjugated()
                joints[n] = m.translation
            sample = {'root': [a-b for a, b in zip(raw(joints['pelvis'] - origin), DATA['bones'][0]['head'])], 'rot': {}, 'grip': {}}
            for entry in DATA['bones']:
                n, parent = entry['name'], entry['parent']
                if parent:
                    parent_entry = next(b for b in DATA['bones'] if b['name'] == parent)
                    expected = joints[parent] + world[parent] @ (point(entry['head']) - point(parent_entry['head']))
                    if (joints[n] - expected).length > .0001:
                        raise ValueError('A bone was translated or stretched. Move the pelvis; rotate limbs or use non-stretching IK.')
                q = world[n] if not parent else world[parent].conjugated() @ world[n]
                sample['rot'][n] = raw_rotation(q)
            for side, shape in DATA['body'].get('grip', {}).items():
                key = body.data.shape_keys.key_blocks.get('Grip ' + side.upper()) if body and body.data.shape_keys else None
                if not key:
                    raise ValueError('Keep the character grip shape keys.')
                value = max(0, min(1, key.value + shape['rest']))
                unkeyed = all(s.get('grip', {}).get(side) is None for s in DATA['samples'])
                sample['grip'][side] = None if unkeyed and abs(key.value) < .0001 else value
            samples.append(sample)
            transforms = []
            for pid, obj in prop_objects.items():
                m = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).matrix_world
                p = copy.deepcopy(baseline[pid])
                scale = m.to_scale()
                if max(scale) - min(scale) > .0001 or min(scale) <= 0:
                    raise ValueError('Props need a positive, uniform scale.')
                p['scale'], p['enabled'] = sum(scale)/3, bool(obj.get('deusedix_enabled', True))
                pos, q = m.translation.copy(), m.to_quaternion()
                if obj.parent == arm and obj.parent_type == 'BONE' and obj.parent_bone in names:
                    p['space'], p['bone'] = 'bone', obj.parent_bone
                    inv = world[p['bone']].conjugated()
                    pos, q = inv @ (pos - joints[p['bone']]), inv @ q
                elif obj.parent is None:
                    p['space'] = 'scene'
                    pos -= origin
                else:
                    raise ValueError('Parent a prop to a Studio bone, or clear its parent to keep it in the scene.')
                p['position'] = raw(pos)
                # Return quaternion; the browser converts with Three's XYZ convention.
                p['quaternion'] = raw_rotation(q)
                transforms.append(p)
            if first_props is None:
                first_props = transforms
            else:
                for p, before in zip(transforms, first_props):
                    numeric = ['position', 'quaternion']
                    different = any(max(abs(x-y) for x,y in zip(p[k], before[k])) > .0001 for k in numeric)
                    if different or abs(p['scale']-before['scale']) > .0001 or p['space'] != before['space']:
                        raise ValueError('Props can follow bones or stay in the scene. Independent prop keyframes cannot return to this Studio version.')
        props = first_props or []
        output = dict(schema=1, session=DATA['session'], mesh=DATA['mesh'], frames=frames,
                      fps=sc.render.fps / sc.render.fps_base, loop=bool(sc['deusedix_loop']), samples=samples, props=props)
        if sc.get('deusedix_imported_keys') is False or sc.get('deusedix_imported_keys') == 0:
            output['poseKeys'] = sorted(f-sc.frame_start for f in action_frames(arm) if sc.frame_start <= f <= sc.frame_end)
        if controls is not None:output['controls']=controls
        return output
    finally:
        sc.frame_set(current)


class DEUSEDIX_OT_key_pose(bpy.types.Operator):
    bl_idname = 'deusedix.key_pose'
    bl_label = 'Key pose'
    bl_description = 'Key the whole pose, including Root, hips, active IK targets, foot pivots and hand grips'
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        try:
            key_pose(context)
            self.report({'INFO'}, 'Pose keyed at frame %d' % context.scene.frame_current)
            return {'FINISHED'}
        except Exception as exc:
            self.report({'ERROR'}, str(exc))
            return {'CANCELLED'}


class DEUSEDIX_OT_return(bpy.types.Operator):
    bl_idname = 'deusedix.send_back'
    bl_label = 'Send to DeusEdix'
    bl_description = 'Prepare changes for Bring changes back in Animation Studio'

    def execute(self, context):
        try:
            output = collect()
            # This is the dedicated exchange file; user maps and Studio saves are untouched.
            bpy.ops.wm.save_as_mainfile(filepath=str(DIRECTORY / 'animation.blend'))
            write('result.json', output)
            write('status.json', {'ready': True, 'message': 'Return ready. In Animation Studio choose Blender > Bring changes back.'})
            self.report({'INFO'}, 'Return ready: Blender > Bring changes back in DeusEdix')
            return {'FINISHED'}
        except Exception as exc:
            self.report({'ERROR'}, str(exc))
            return {'CANCELLED'}


class DEUSEDIX_PT_bridge(bpy.types.Panel):
    bl_label = 'DeusEdix animation'
    bl_idname = 'DEUSEDIX_PT_bridge'
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'DeusEdix'

    def draw(self, context):
        layout = self.layout
        layout.label(text=DATA['animation']['name'], icon='ACTION')
        layout.operator('deusedix.send_back', icon='EXPORT')
        if blender_controls.armature():blender_controls.draw(layout,context)
        else:layout.operator('deusedix.key_pose', icon='KEY_HLT')
        layout.prop(context.scene, '["deusedix_loop"]', text='Loop')
        layout.label(text='Root moves all; Hips leave IK planted.' if blender_controls.armature() else 'Pose bones; move the pelvis.')
        layout.label(text='IK targets remain editable on return.' if blender_controls.armature() else 'Motion returns as sampled keys.')
        layout.label(text='Save this file to resume later.')


def main(directory):
    global DIRECTORY, DATA
    DIRECTORY = Path(directory).resolve()
    DATA = json.loads((DIRECTORY / 'input.json').read_text(encoding='utf-8'))
    if DATA.get('schema') != 1 or DIRECTORY.name != DATA.get('session'):
        raise ValueError('Invalid DeusEdix exchange.')
    bpy.utils.register_class(DEUSEDIX_OT_return)
    bpy.utils.register_class(DEUSEDIX_OT_key_pose)
    bpy.utils.register_class(DEUSEDIX_PT_bridge)
    if (DIRECTORY / 'animation.blend').is_file():
        bpy.ops.wm.open_mainfile(filepath=str(DIRECTORY / 'animation.blend'), use_scripts=False)
        if blender_controls.armature():blender_controls.install(control_bridge());blender_controls.sample_frame(bpy.context.scene.frame_current)
    else:
        build()
    write('status.json', {'message': 'Blender is ready. Use the DeusEdix sidebar to send changes back.'})


if __name__ == '__main__':
    try:
        main(sys.argv[sys.argv.index('--') + 1])
    except Exception as exc:
        if DIRECTORY:
            write('status.json', {'error': str(exc)})
        traceback.print_exc()
        raise
