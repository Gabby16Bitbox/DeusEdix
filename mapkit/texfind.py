"""Which textures the original maps put on large surfaces of one kind, map by map.

    python tools/mapkit/texfind.py floor 512 06_HongKong_Helibase 02_NYC_Street
    python tools/mapkit/texfind.py ceiling 384 06_HongKong_WanChai_Market

Prints, per map, the textures covering the largest total area of that kind (floor / wall / ceiling)
on faces at least <min> long, with their scale. Use it to copy what the game does in a similar place.
"""
import collections
import math
import re
import sys
from pathlib import Path

import polys

REFS = Path(__file__).resolve().parent / 'refs'
_poly = re.compile(r'Begin Polygon([^\n]*)\n(.*?)End Polygon', re.S)


def _v(s):
    return [float(x) for x in s.replace('+', '').split(',')]


def find(kind, min_long, maps, top=8):
    for m in maps:
        text = polys.ref_text(m)
        area = collections.Counter()
        scale = collections.defaultdict(collections.Counter)
        for tex, n, vs, u, csg in polys.polygons(text):
            k = polys.kind(n)
            if k != kind:
                continue
            ext = [max(p[i] for p in vs) - min(p[i] for p in vs) for i in range(3)]
            long_ = max(ext[0], ext[1]) if k != 'wall' else max(math.hypot(ext[0], ext[1]), ext[2])
            if long_ < min_long:
                continue
            a = (ext[0] * ext[1]) if k != 'wall' else (math.hypot(ext[0], ext[1]) * ext[2])
            area[tex] += a
            ul = math.sqrt(sum(c * c for c in u))
            if ul:
                scale[tex][round(1 / ul, 2)] += 1
        print('== %s (%s, faces >= %d)' % (m, kind, min_long))
        for tex, a in area.most_common(top):
            print('  %-24s %8.0f k-units2  scale %s' % (tex, a / 1000, scale[tex].most_common(1)[0][0]))


if __name__ == '__main__':
    find(sys.argv[1], int(sys.argv[2]), sys.argv[3:])
