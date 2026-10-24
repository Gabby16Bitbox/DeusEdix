"""Polygons of an exported map (T3D) as the player sees them.

A carved room (CSG_Subtract brush) stores its faces with normals pointing out of the brush:
its floor is stored facing down. polygons() flips those, so 'floor' means a surface you stand on.
"""
import gzip
from pathlib import Path

import t3d

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

def polygons(text):
    """Yield (texture, normal_seen, vertices, textureU, csg) for every brush polygon of the map."""
    for actor in t3d.walk(t3d.blocks(text)):
        if actor.kind != 'Actor':
            continue
        faces = [b for b in t3d.walk(actor.children) if b.kind == 'Polygon']
        if not faces:
            continue
        csg = next((s.split('=', 1)[1] for s in actor.lines if s.startswith('CsgOper=')), None)
        csg = csg or ('CSG_Add' if actor.fields.get('Class', '').split('.')[-1] == 'Brush' else 'Mover')
        for face in faces:
            tex = face.fields.get('Texture')
            if not tex:
                continue
            try:
                n, u = face.numbers('Normal'), face.numbers('TextureU')
                vs = [[float(x) for x in s.split(None, 1)[1].replace('+', '').split(',')] for s in face.lines
                      if s.startswith('Vertex')]
            except (IndexError, ValueError):
                continue
            if n is None or u is None or len(vs) < 3:
                continue
            if csg == 'CSG_Subtract':
                n = [-c for c in n]
            yield tex, n, vs, u, csg


def kind(n):
    return 'floor' if n[2] > 0.7 else ('ceiling' if n[2] < -0.7 else 'wall')
