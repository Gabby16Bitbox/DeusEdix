"""Keep a mover's native base and all eight motion keys with its editor placement.

UE1 KeyPos is a world-space offset; KeyRot is component-wise relative to BaseRot,
not a local-axis rotation. Rotate each endpoint before deriving its new offset.
"""
import re
import geom
import t3d


def properties(props, xf):
    base = t3d.rot(props.get('BaseRot', props.get('Rotation')))
    new_base = xf.rot(base)
    out = {'BasePos': '(X=%.3f,Y=%.3f,Z=%.3f)' % xf.point(t3d.vec(props.get('BasePos', props.get('Location')))),
           'BaseRot': '(Pitch=%d,Yaw=%d,Roll=%d)' % new_base}
    for i in range(8):
        pk, rk = 'KeyPos(%d)' % i, 'KeyRot(%d)' % i
        if pk in props:
            v = t3d.vec(props[pk]); out[pk] = '(X=%.3f,Y=%.3f,Z=%.3f)' % xf.vec(tuple(v[k]*xf.scale[k] for k in range(3)))
        if rk in props:
            key = t3d.rot(props[rk]); end = xf.rot(tuple(base[k]+key[k] for k in range(3)))
            turn = tuple((end[k]-new_base[k]+32768)%65536-32768 for k in range(3))
            out[rk] = '(Pitch=%d,Yaw=%d,Roll=%d)' % turn
    return out


def apply(raw, props, xf):
    for key, value in properties(props, xf).items():
        line = '    %s=%s' % (key, value)
        raw, count = re.subn(r'(?m)^\s*'+re.escape(key)+r'=[^\r\n]*', lambda m: line, raw, count=1)
        if not count: raw = raw.replace('End Actor', line+'\nEnd Actor')
    return raw


def relocation(props, location, rotation):
    start = t3d.vec(props.get('Location'))
    r = geom.rotation_between(t3d.rot(props.get('Rotation')), rotation)
    return geom.XForm(start, tuple(location[k]-start[k] for k in range(3)), yaw=r[1], pitch=r[0], roll=r[2])
