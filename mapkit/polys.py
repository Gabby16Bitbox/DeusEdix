"""Polygons of an exported map (T3D) as the player sees them.

A carved room (CSG_Subtract brush) stores its faces with normals pointing out of the brush:
its floor is stored facing down. polygons() flips those, so 'floor' means a surface you stand on.
"""
import gzip
import re
from pathlib import Path

REFS = Path(__file__).resolve().parent / 'refs'


def ref_path(map_name):
    """The exported original map: refs/<map>.t3d.gz (compressed) or refs/<map>.t3d."""
    for p in (REFS / (map_name + '.t3d.gz'), REFS / (map_name + '.t3d')):
        if p.exists():
            return p
    return None


def ref_text(map_name):
    p = ref_path(map_name)
    if p is None:
        raise FileNotFoundError('no exported reference for %s (run refscan.py / export_all.py)' % map_name)
    if p.suffix == '.gz':
        with gzip.open(p, 'rt', encoding='latin1', errors='replace') as f:
            return f.read()
    return p.read_text(encoding='latin1', errors='replace')


def ref_names():
    return sorted({p.name.split('.')[0] for p in REFS.glob('*.t3d*')})

_actor = re.compile(r'Begin Actor Class=(\w+)[^\n]*\n(.*?)\nEnd Actor', re.S)
_poly = re.compile(r'Begin Polygon([^\n]*)\n(.*?)End Polygon', re.S)


def _v(s):
    return [float(x) for x in s.replace('+', '').split(',')]


def polygons(text):
    """Yield (texture, normal_seen, vertices, textureU, csg) for every brush polygon of the map."""
    for a in _actor.finditer(text):
        cls, body = a.group(1), a.group(2)
        if 'Begin Polygon' not in body:
            continue
        csg = re.search(r'CsgOper=(\w+)', body)
        csg = csg.group(1) if csg else ('CSG_Add' if cls == 'Brush' else 'Mover')
        flip = csg == 'CSG_Subtract'
        for m in _poly.finditer(body):
            t = re.search(r'Texture=(\S+)', m.group(1))
            if not t:
                continue
            pb = m.group(2)
            try:
                n = _v(re.search(r'Normal\s+([^\n]+)', pb).group(1))
                u = _v(re.search(r'TextureU\s+([^\n]+)', pb).group(1))
                vs = [_v(l.split(None, 1)[1]) for l in pb.splitlines() if l.strip().startswith('Vertex')]
            except (AttributeError, ValueError):
                continue
            if len(vs) < 3:
                continue
            if flip:
                n = [-c for c in n]
            yield t.group(1), n, vs, u, csg


def kind(n):
    return 'floor' if n[2] > 0.7 else ('ceiling' if n[2] < -0.7 else 'wall')
