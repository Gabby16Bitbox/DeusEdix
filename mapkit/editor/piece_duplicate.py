"""Private, immutable duplication bundles for map-native scenery; no save or rebuild."""
import re
import uuid

import geom
import prefabs
import prefab_library as library
import t3d


def _pose(value):
    if not isinstance(value, dict):
        raise ValueError('Invalid piece placement.')
    out = {k: library._vector(value.get(k, default), 3, k)
           for k, default in [('offset', [0, 0, 0]), ('scale', [1, 1, 1])]}
    if any(v <= 0 or v > 1000 for v in out['scale']):
        raise ValueError('Invalid piece scale.')
    for key in ('yaw', 'pitch', 'roll'):
        v = value.get(key, 0)
        if not isinstance(v, (int, float)) or not -1e9 < v < 1e9:
            raise ValueError('Invalid piece rotation.')
        out[key] = int(v)
    out['stretch'] = bool(value.get('stretch'))
    return out


def _preview(group, xf):
    out = library._unplaced(group, xf)
    if group.get('uvFrames'):
        out['uvFrames'] = [None if f is None else
            [*xf.point(f[:3]), *xf.tex(f[3:6]), *xf.tex(f[6:9]), *f[9:]]
            for f in group['uvFrames']]
        uv = list(group['uv'])
        for i, frame in enumerate(out['uvFrames']):
            if frame is None:
                continue
            for vertex in range(3):
                p = out['pos'][i * 9 + vertex * 3:i * 9 + vertex * 3 + 3]
                for axis in range(2):
                    uv[i * 6 + vertex * 2 + axis] = sum(
                        (p[k] - frame[k]) * frame[3 + axis * 3 + k] for k in range(3)) + frame[9 + axis]
        out['uv'] = uv
    return out


def _block(raw, xf):
    """Bake brushes in world coordinates so tilted, non-uniform scale is exact.

    The general prefab scaler assumes quarter-turn brush axes. A native piece
    can already have arbitrary axes; using that shortcut would distort it.
    """
    actor = next(t3d.actors(raw))
    if actor['cls'].split('.')[-1] != 'Brush':
        return prefabs.xf_block(raw, xf)
    p = actor['props']
    for key in ('MainScale', 'PostScale'):
        scale = t3d.struct(p.get(key, ''))
        if abs(float(scale.get('SheerRate', 0))) > 1e-9:
            raise ValueError('This brush uses shear. Convert it to a prefab before duplicating.')
    main, post = t3d._scale(p, 'MainScale'), t3d._scale(p, 'PostScale')
    if any(abs(v) < 1e-9 for v in (*main, *post)):
        raise ValueError('This piece has a zero brush scale.')
    pre, loc = t3d.vec(p.get('PrePivot')), t3d.vec(p.get('Location'))
    rotation = geom.rotation_matrix(t3d.rot(p.get('Rotation')))
    def turn(v):
        return [sum(rotation[i][k] * v[k] for k in range(3)) for i in range(3)]
    def vector(match):
        key = match[1]
        v = [float(n) for n in match[2].split(',')]
        if key in ('Vertex', 'Origin'):
            v = turn([(v[k] - pre[k]) * main[k] for k in range(3)])
            v = xf.point([v[k] * post[k] + loc[k] for k in range(3)])
        else:
            v = turn([v[k] / main[k] for k in range(3)])
            v = [v[k] / post[k] for k in range(3)]
            v = xf.normal(v) if key == 'Normal' else xf.tex(v)
        return '    ' + key + ' ' + ','.join('%+.9f' % x for x in v)
    raw = re.sub(r'(?m)^\s*(Vertex|Origin|Normal|TextureU|TextureV)\s+([^\r\n]+)', vector, raw)
    raw = re.sub(r'(?m)^[ \t]*(?:Location|Rotation|PrePivot|MainScale|PostScale)=.*\n?', '', raw)
    return raw.replace('End Actor', '    Location=(X=0,Y=0,Z=0)\n    Rotation=(Pitch=0,Yaw=0,Roll=0)\n'
                       '    PrePivot=(X=0,Y=0,Z=0)\n    MainScale=(Scale=(X=1,Y=1,Z=1))\n'
                       '    PostScale=(Scale=(X=1,Y=1,Z=1))\nEnd Actor')


def capture(map_name, folder, structures, name, pose):
    """Capture the native piece at its current full pose, retaining all scenery members.

    _capture rejects gameplay/movers instead of silently dropping them. A private
    bundle uses the regular paste/build path and is independent from later moves
    or deletion of its source. No edits, map or library entry is changed here.
    """
    st = structures.get(name)
    if not st:
        raise ValueError('This piece is no longer in the map. Reopen it before duplicating.')
    target, built = _pose(pose), _pose(st.get('placement') or {})
    captured = library._capture(map_name, {'structures': [name]}, folder, structures)
    xf = prefabs.entry_xform(st['pivot'], built)
    # Inverse order matters: undo built rotation/translation, then built scale.
    steps = [library._inverse(xf), geom.XForm(st['pivot'], scale=[1 / v for v in xf.scale], stretch=xf.stretch),
             prefabs.entry_xform(st['pivot'], target)]
    for transform in steps:
        if not (any(transform.offset) or transform.rotated or transform.scaled):
            continue
        for block in captured['blocks']:
            block['raw'] = _block(block['raw'], transform)
        captured['groups'] = [_preview(group, transform) for group in captured['groups']]
    ident = 'dup_' + uuid.uuid4().hex
    prefab = dict(id=ident, label=st.get('label') or 'Map piece', source=map_name, structure=name,
                  pivot=[st['pivot'][k] + target['offset'][k] for k in range(3)],
                  blocks=captured['blocks'], packages=captured['packages'], rotatable=True,
                  facing=None, counts=captured['counts'])
    # _publish validates preview paths and atomically publishes the whole bundle.
    # dup_ bundles deliberately are not library versions (usr_).
    library._publish(prefab, captured, ident, 1, len(prefab['blocks']))
    return library._descriptor(prefab) | {'members': {
        block['name']: i for i, block in enumerate(prefab['blocks']) if not block['brush']}}
