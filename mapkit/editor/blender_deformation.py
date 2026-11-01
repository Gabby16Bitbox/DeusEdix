"""Hidden joint corrections matching Studio's partial-turn shoulder/elbow skin.

The 17 authored bones and their keys stay unchanged. Each correction shares the
child joint's rest frame and follows a fraction of its local quaternion turn.
The existing Studio control evaluator updates these alongside the authored bones.
"""
import math


def corrections(data):
    """Group UV wedges by the exact parent/child/turn fraction from Studio."""
    groups = {}
    for vertex, parent, child, weight in data['body'].get('seams', []):
        groups.setdefault((parent, child, weight), []).append(vertex)
    return [(f'DX_SEAM_{i:03d}', data['bones'][parent]['name'],
             data['bones'][child]['name'], weight, vertices)
            for i, ((parent, child, weight), vertices) in enumerate(groups.items())]


def build_bones(arm, data):
    """Called in edit mode, after the original bones have been created."""
    for name, parent, child, weight, _ in corrections(data):
        original = arm.data.edit_bones[child]
        bone = arm.data.edit_bones.new(name)
        bone.matrix = original.matrix.copy()
        bone.length = original.length
        bone.parent = arm.data.edit_bones[parent]
        bone.use_connect = False
        bone.use_deform = True


def bind(arm, body, data):
    for name, _, child, weight, vertices in corrections(data):
        # A seam replaces the linear blend, including duplicate UV vertices.
        for group in body.vertex_groups:
            group.remove(vertices)
        group = body.vertex_groups.new(name=name)
        group.add(vertices, 1.0, 'REPLACE')
        bone = arm.pose.bones[name]
        bone.rotation_mode = 'QUATERNION'
        bone.lock_location = bone.lock_rotation = bone.lock_scale = (True, True, True)
        bone.bone.hide = True


def update(arm, bridge, pose):
    for name, _, child, weight, _ in corrections(bridge.DATA):
        if name not in arm.pose.bones:
            raise ValueError('A joint correction is missing. Send a new Blender session.')
        # Slerp the authored quaternion before converting through bone matrices.
        # Matrix->quaternion can choose the other arc at exactly 180 degrees,
        # which is equivalent for the child but not for a partial-turn vertex.
        q = pose['rot'][child]
        length = math.sqrt(sum(v*v for v in q))
        q = [v / length * (-1 if q[3] < 0 else 1) for v in q]
        sine = math.sqrt(sum(v*v for v in q[:3]))
        angle = math.atan2(sine, q[3]) * weight
        partial = [v * math.sin(angle) / sine for v in q[:3]] + [math.cos(angle)] if sine > 1e-12 else [0,0,0,1]
        rest = arm.data.bones[name].matrix_local.to_quaternion()
        arm.pose.bones[name].rotation_quaternion = rest.conjugated() @ bridge.rotation(partial) @ rest
