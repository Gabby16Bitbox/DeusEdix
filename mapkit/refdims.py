"""Real sizes in the original levels: doors, lifts, rooms, desks, texture scale, uses of a texture.

    python tools/mapkit/refdims.py doors|rooms|desks|scale|lifts [maps...]
    python tools/mapkit/refdims.py tex <TextureName> [maps...]

Reads tools/mapkit/refs/<map>.t3d (see refscan.py). Use it before choosing the size of anything.
"""
import collections
import math
import re
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import classes  # noqa: E402
import polys  # noqa: E402
import t3d  # noqa: E402
import sizes  # noqa: E402

REFS = HERE / 'refs'
DEFAULT = ['06_HongKong_Helibase', '01_NYC_UNATCOHQ', '06_HongKong_VersaLife', '06_HongKong_WanChai_Market',
           '02_NYC_Warehouse', '09_NYC_Dockyard', '06_HongKong_WanChai_Canal', '03_NYC_Airfield']


def load(m):
    return list(t3d.actors(polys.ref_text(m)))


def dims(a):
    b = t3d.bounds(a)
    if not b:
        return None
    lo, hi = b
    return tuple(round(hi[i] - lo[i]) for i in range(3)), lo, hi


def doors(maps):
    out = collections.Counter()
    for m in maps:
        for a in load(m):
            if 'Mover' not in a['cls'] or 'Elevator' in a['cls']:
                continue
            d = dims(a)
            if not d:
                continue
            (x, y, z), lo, hi = d
            thin, wide = min(x, y), max(x, y)
            if thin <= 32 and 48 <= wide <= 600 and z >= 64:
                out[(wide // 8 * 8, z // 8 * 8)] += 1
    print('door width x height (rounded to 8), count:')
    for (w, h), n in out.most_common(25):
        print('  %4d x %4d  %d' % (w, h, n))


def rooms(maps):
    hs, ws = [], []
    for m in maps:
        for a in load(m):
            if a['cls'] != 'Brush' or 'CSG_Subtract' not in a['props'].get('CsgOper', ''):
                continue
            d = dims(a)
            if not d:
                continue
            (x, y, z), _, _ = d
            if min(x, y) >= 96 and z >= 64:
                hs.append(z)
                ws.append(min(x, y))
    print('subtracted spaces: %d' % len(hs))
    for name, v in (('height', hs), ('short side', ws)):
        q = statistics.quantiles(v, n=10)
        print('  %-10s median %d  10%% %d  90%% %d' % (name, statistics.median(v), q[0], q[-1]))
    print('  most common heights:', collections.Counter(h // 16 * 16 for h in hs).most_common(8))
    print('  most common short sides:', collections.Counter(w // 32 * 32 for w in ws).most_common(8))


def desks(maps):
    sz = sizes.load()
    tops = []
    for m in maps:
        acts = load(m)
        tree = classes.tree()
        chairs = [(t3d.vec(a['props'].get('Location', '')), a['cls']) for a in acts
                  if tree.is_a(a['cls'], 'Seat') and a['cls'] in sz]
        for a in acts:
            if not tree.is_a(a['cls'], 'Computers', 'Phone') or a['cls'] not in sz:
                continue
            p = t3d.vec(a['props'].get('Location', ''))
            near = [(math.hypot(c[0] - p[0], c[1] - p[1]), c, k) for c, k in chairs if abs(c[2] - p[2]) < 120]
            if not near:
                continue
            _, c, k = min(near)
            if _ > 220:
                continue
            floor = c[2] - sz[k][1]
            tops.append(round(p[2] - sz[a['cls']][1] - floor))
    print('desk / counter top above floor (computers and phones next to a chair): n=%d' % len(tops))
    print('  median %d, common %s' % (statistics.median(tops), collections.Counter(t // 4 * 4 for t in tops).most_common(6)))


def _faces(text):
    """Every Polygon block of a map's T3D."""
    return (b for b in t3d.walk(t3d.blocks(text)) if b.kind == 'Polygon' and b.tail is not None)


def scale(maps):
    c = collections.Counter()
    for m in maps:
        text = polys.ref_text(m)
        for face in _faces(text):
            v = face.numbers('TextureU')
            if v is None:
                continue
            k = math.sqrt(sum(x * x for x in v))
            if k > 0:
                c[round(1 / k, 2)] += 1
    tot = sum(c.values())
    print('world units per texel (1.0 = texture at its own size): %d faces' % tot)
    for k, n in c.most_common(10):
        print('  %5.2f  %4.1f%%' % (k, 100.0 * n / tot))


def tex(name, maps):
    for m in maps:
        text = polys.ref_text(m)
        rows = collections.Counter()
        for face in _faces(text):
            if face.fields.get('Texture') != name:
                continue
            vs = [[float(x) for x in s.split(None, 1)[1].replace('+', '').split(',')]
                  for s in face.lines if s.startswith('Vertex')]
            u, v = face.numbers('TextureU'), face.numbers('TextureV')
            ext = [round(max(p[i] for p in vs) - min(p[i] for p in vs)) for i in range(3)]
            rows[(tuple(ext), round(1 / math.sqrt(sum(x * x for x in u)), 2),
                  round(1 / math.sqrt(sum(x * x for x in v)), 2))] += 1
        if rows:
            print('==', m)
            for (ext, su, sv), n in rows.most_common(8):
                print('  face extent %s  units/texel U %.2f V %.2f  x%d' % (ext, su, sv, n))


def lifts(maps):
    for m in maps:
        for a in load(m):
            if 'Elevator' in a['cls']:
                d = dims(a)
                if d:
                    print('  %s %s %s' % (m, a['name'], d[0]))


if __name__ == '__main__':
    what, rest = sys.argv[1], sys.argv[2:]
    if what == 'tex':
        tex(rest[0], rest[1:] or DEFAULT)
    else:
        globals()[what](rest or DEFAULT)
