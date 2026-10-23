"""How the original game uses every texture: scale, surface kind, face sizes.

    python tools/mapkit/texusage.py                 # (re)build catalog/texusage.json from refs/*.t3d
    python tools/mapkit/texusage.py lockers ...     # show what the game does with these textures

The build (scene.py) compares every face of a new map with these numbers and warns when a texture
is drawn at another scale than the game's, or stretched over a face much bigger than the objects it
was painted for (lockers 96 high in the game, 190 in our first lobby). With no tile given, a
material uses the game's own scale for that texture (geom.game_scale).
"""
import collections
import json
import math
import re
import statistics
import sys

import polys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REFS = HERE / 'refs'
OUT = HERE / 'catalog' / 'texusage.json'
_poly = re.compile(r'Begin Polygon([^\n]*)\n(.*?)End Polygon', re.S)
_tex = re.compile(r'Texture=(\S+)')


def _v(s):
    return [float(x) for x in s.replace('+', '').split(',')]


def _len(v):
    return math.sqrt(sum(c * c for c in v))


def scan():
    data = collections.defaultdict(lambda: {'count': 0, 'scales': collections.Counter(), 'kind': collections.Counter(),
                                            'kscales': collections.defaultdict(collections.Counter),
                                            'long': [], 'short': [], 'height': [], 'maps': set()})
    maps = [m for m in polys.ref_names() if not m.startswith('MINE')]
    for i, path in enumerate(maps):
        text = polys.ref_text(path)
        for tex, n, vs, u, csg in polys.polygons(text):
            if _len(u) == 0:
                continue
            d = data[tex.lower()]
            d['maps'].add(path)
            # weights by area: what matters is the scale that covers most of the surface
            area = 0.0
            for k in range(1, len(vs) - 1):
                a = [vs[k][c] - vs[0][c] for c in range(3)]
                b = [vs[k + 1][c] - vs[0][c] for c in range(3)]
                area += 0.5 * _len([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]])
            w = max(area, 1.0)
            d['count'] += 1
            d['scales'][round(1.0 / _len(u), 2)] += w
            kind = 'floor' if n[2] > 0.7 else ('ceiling' if n[2] < -0.7 else 'wall')
            d['kind'][kind] += w
            d['kscales'][kind][round(1.0 / _len(u), 2)] += w
            ext = [max(p[k] for p in vs) - min(p[k] for p in vs) for k in range(3)]
            if kind == 'wall':
                long_, short_ = max(math.hypot(ext[0], ext[1]), ext[2]), min(math.hypot(ext[0], ext[1]), ext[2])
                d['height'].append(ext[2])
            else:
                long_, short_ = max(ext[0], ext[1]), min(ext[0], ext[1])
            d['long'].append(long_)
            d['short'].append(short_)
        print('%d/%d %s' % (i + 1, len(maps), path), flush=True)

    def pct(v, q):
        if not v:
            return 0
        v = sorted(v)
        return round(v[min(len(v) - 1, int(q * len(v)))], 1)
    out = {}
    for name, d in data.items():
        total = sum(d['scales'].values())
        mode, share = d['scales'].most_common(1)[0]
        out[name] = {
            'faces': d['count'], 'maps': len(d['maps']),
            'scale': mode, 'scale_share': round(share / total, 2),
            'scales': [[s, round(c / total, 2)] for s, c in d['scales'].most_common(4)],
            # dominant scale on each kind of surface that has at least a tenth of the area
            'scale_by_kind': {k: c.most_common(1)[0][0] for k, c in d['kscales'].items()
                              if sum(c.values()) >= 0.1 * total},
            'floor': round(d['kind']['floor'] / total, 2), 'wall': round(d['kind']['wall'] / total, 2),
            'ceiling': round(d['kind']['ceiling'] / total, 2),
            'long_p50': pct(d['long'], 0.5), 'long_p90': pct(d['long'], 0.9),
            'short_p50': pct(d['short'], 0.5), 'short_p90': pct(d['short'], 0.9),
            'height_p90': pct(d['height'], 0.9),
        }
    OUT.write_text(json.dumps(out, indent=0, sort_keys=True), encoding='utf-8')
    print('%d textures -> %s' % (len(out), OUT))
    return out


_CACHE = None


def load():
    global _CACHE
    if _CACHE is None:
        _CACHE = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    return _CACHE


def info(name):
    return load().get(name.lower())


def describe(name):
    d = info(name)
    if not d:
        return '%s: not used in the original maps' % name
    kinds = ', '.join('%s %d%%' % (k, d[k] * 100) for k in ('wall', 'floor', 'ceiling') if d[k] > 0.05)
    return ('%s: %d faces in %d maps; scale %.2f (%d%% of the area; others %s); %s; faces usually %d x %d '
            '(90%%: up to %d x %d)%s' % (
                name, d['faces'], d['maps'], d['scale'], d['scale_share'] * 100,
                ', '.join('%.2f' % s for s, _ in d['scales'][1:]) or 'none', kinds,
                d['long_p50'], d['short_p50'], d['long_p90'], d['short_p90'],
                ('; walls up to %d high' % d['height_p90']) if d['wall'] > 0.05 else ''))


def suggest(kind='floor', min_long=512, contains='', limit=15):
    """Textures the game really uses on big surfaces of that kind (floor / wall / ceiling)."""
    rows = []
    for name, d in load().items():
        if contains and contains.lower() not in name:
            continue
        if d[kind] >= 0.5 and d['long_p90'] >= min_long and d['faces'] >= 30 and d['maps'] >= 2:
            rows.append((d['faces'] * d[kind], name, d))
    rows.sort(reverse=True)
    return [(n, d) for _, n, d in rows[:limit]]


if __name__ == '__main__':
    if len(sys.argv) == 1:
        scan()
    elif sys.argv[1] == 'suggest':
        kind = sys.argv[2] if len(sys.argv) > 2 else 'floor'
        for n, d in suggest(kind, int(sys.argv[3]) if len(sys.argv) > 3 else 512,
                            sys.argv[4] if len(sys.argv) > 4 else ''):
            print(describe(n))
    else:
        for n in sys.argv[1:]:
            print(describe(n))
