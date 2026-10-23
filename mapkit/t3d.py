"""Read UE1 T3D map exports (MAP EXPORT): actors, their properties and brush polygons."""
import math
import re

def import_text(blocks):
    """MAP IMPORTADD payload that cannot consume a real piece as the builder.

    UE1 reserves the first plain Brush actor for its editor builder brush. A
    brush-only prefab would otherwise exist as an actor but never enter BSP.
    The empty model MUST precede Brush=Model: reversing this crashes PrepBrush.
    Actor-only and Movers-only imports retain their existing behaviour.
    """
    text = ''.join(block if block.endswith('\n') else block + '\n' for block in blocks)
    if re.search(r'^[ \t]*Begin Actor Class=(?:[A-Za-z_]\w*\.)?Brush\b', text, re.M | re.I):
        names = {name.casefold() for name in re.findall(r'\bName=([A-Za-z_]\w*)', text, re.I)}
        suffix = 0
        while True:
            name = 'UCImportBuilder' + (str(suffix) if suffix else '')
            model = name + 'Model'
            if name.casefold() not in names and model.casefold() not in names:
                break
            suffix += 1
        sentinel = ("Begin Actor Class=Brush Name=%s\n"
                    "    Location=(X=0,Y=0,Z=0)\n"
                    "    Begin Brush Name=%s\n"
                    "        Begin PolyList\n"
                    "        End PolyList\n"
                    "    End Brush\n"
                    "    Brush=Model'MyLevel.%s'\n"
                    "End Actor\n") % (name, model, model)
        text = sentinel + text
    return 'Begin Map\n' + text + 'End Map\n'


_actor_re = re.compile(r'^Begin Actor Class=(\S+) Name=(\S+)\s*$(.*?)^End Actor\s*$', re.M | re.S)


def actors(text):
    """Yield dicts: cls, name, body (raw text), props (top-level key -> raw value)."""
    for m in _actor_re.finditer(text):
        cls, name, body = m.group(1), m.group(2), m.group(3)
        props = {}
        depth = 0
        for line in body.splitlines():
            s = line.strip()
            if s.startswith('Begin '):
                depth += 1
                continue
            if s.startswith('End '):
                depth -= 1
                continue
            if depth == 0 and '=' in s:
                k, v = s.split('=', 1)
                props[k] = v
        yield dict(cls=cls, name=name, body=body, props=props, raw=m.group(0))


def vec(value, default=(0.0, 0.0, 0.0)):
    if not value:
        return default
    d = dict(re.findall(r'([XYZ])=([-0-9.eE+]+)', value))
    return (float(d.get('X', 0)), float(d.get('Y', 0)), float(d.get('Z', 0)))


def rot(value):
    if not value:
        return (0, 0, 0)
    d = dict(re.findall(r'(Pitch|Yaw|Roll)=([-0-9]+)', value))
    return (int(d.get('Pitch', 0)), int(d.get('Yaw', 0)), int(d.get('Roll', 0)))


def polys(body):
    """Brush polygons of an actor body: list of dicts (texture, flags, verts, raw)."""
    out = []
    for m in re.finditer(r'Begin Polygon([^\n]*)\n(.*?)End Polygon', body, re.S):
        head, inner = m.group(1), m.group(2)
        tex = re.search(r'Texture=(\S+)', head)
        flags = re.search(r'Flags=(\d+)', head)
        verts = [tuple(float(x) for x in v.split(',')) for v in re.findall(r'Vertex\s+([-0-9.eE+,]+)', inner)]
        out.append(dict(texture=tex.group(1) if tex else None, flags=int(flags.group(1)) if flags else 0,
                        verts=verts, raw=m.group(0)))
    return out


def _scale(props, key):
    v = props.get(key)
    if not v:
        return (1.0, 1.0, 1.0)
    d = dict(re.findall(r'([XYZ])=([-0-9.eE+]+)', v))
    return (float(d.get('X', 1)), float(d.get('Y', 1)), float(d.get('Z', 1)))


def _rotate(p, r):
    pitch, yaw, roll = (a * math.pi / 32768.0 for a in r)
    x, y, z = p
    # UE1 order: roll (X), pitch (Y), yaw (Z)
    cr, sr = math.cos(roll), math.sin(roll)
    y, z = y * cr - z * sr, y * sr + z * cr
    cp, sp = math.cos(pitch), math.sin(pitch)
    x, z = x * cp - z * sp, x * sp + z * cp
    cy, sy = math.cos(yaw), math.sin(yaw)
    x, y = x * cy - y * sy, x * sy + y * cy
    return (x, y, z)


def world_verts(actor):
    """Brush polygon vertices in world space (approximate: MainScale, Rotation, PostScale)."""
    p = actor['props']
    loc = vec(p.get('Location'))
    pre = vec(p.get('PrePivot'))
    main = _scale(p, 'MainScale')
    post = _scale(p, 'PostScale')
    r = rot(p.get('Rotation'))
    res = []
    for poly in polys(actor['body']):
        vs = []
        for v in poly['verts']:
            q = tuple((v[i] - pre[i]) * main[i] for i in range(3))
            q = _rotate(q, r)
            q = tuple(q[i] * post[i] + loc[i] for i in range(3))
            vs.append(q)
        res.append((poly, vs))
    return res


def bounds(actor):
    pts = [v for _, vs in world_verts(actor) for v in vs]
    if not pts:
        return None
    return (tuple(min(p[i] for p in pts) for i in range(3)), tuple(max(p[i] for p in pts) for i in range(3)))
