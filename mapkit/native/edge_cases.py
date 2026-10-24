"""Walkable areas made to find the edges of the routes (native/README.md, "Tests"): places exactly on shared edges and
corners, on the border and just off it, floors over floors, polygons with no area, wrong data, islands, a spiral
with more turns than a route holds, more polygons than UCNavMesh holds. For each: the C++ (nav_test.exe) and the
UnrealScript steps (check_routes.ScriptRouter) give the same corners, and every route ends at its place, has at
most 64 corners and no NaN.

    python edge_cases.py
"""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_routes import ScriptRouter, f, run  # noqa: E402


def poly(corners, across):
    """A polygon as the editor bakes it: 'n x y z ... a ...'."""
    return ' '.join(str(int(v)) for v in [len(corners)] + [c for p in corners for c in p] + list(across))


def grid(w, h, cell, z=lambda i, j, x, y: 0, x0=0, y0=0, reverse=lambda i, j: False):
    """w x h quads, each linked to its neighbours (reverse: that cell's corners clockwise instead)."""
    polys = []
    for j in range(h):
        for i in range(w):
            pts = [(x0 + i * cell, y0 + j * cell), (x0 + (i + 1) * cell, y0 + j * cell),
                   (x0 + (i + 1) * cell, y0 + (j + 1) * cell), (x0 + i * cell, y0 + (j + 1) * cell)]
            nb = [(i, j - 1), (i + 1, j), (i, j + 1), (i - 1, j)]      # across edge k: corner k to k + 1
            ids = [b * w + a if 0 <= a < w and 0 <= b < h else -1 for a, b in nb]
            corners = [(x, y, z(i, j, x, y)) for x, y in pts]
            if reverse(i, j):
                # corners k..k+1 reversed: corner order 0,3,2,1, edge 0-3 is old edge 3, 3-2 old 2, 2-1 old 1, 1-0 old 0
                corners = [corners[0], corners[3], corners[2], corners[1]]
                ids = [ids[3], ids[2], ids[1], ids[0]]
            polys.append(poly(corners, ids))
    return polys


def fan(n=6, r=200):
    """n triangles round one corner shared by all of them."""
    out = []
    for k in range(n):
        a, b = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        pts = [(0, 0, 0), (round(r * math.cos(a)), round(r * math.sin(a)), 0), (round(r * math.cos(b)), round(r * math.sin(b)), 0)]
        out.append(poly(pts, [(k - 1) % n, -1, (k + 1) % n]))
    return out


def stacked():
    """A floor under another, joined by a ramp that turns back (a switchback): polygons over polygons."""
    A = [(0, 0, 0), (800, 0, 0), (800, 200, 0), (0, 200, 0)]            # 0: the lower floor
    S1 = [(800, 0, 0), (1000, 0, 0), (1000, 200, 0), (800, 200, 0)]      # 1: the bottom landing
    S2 = [(800, 200, 0), (1000, 200, 0), (1000, 600, 256), (800, 600, 256)]   # 2: the ramp
    S3 = [(800, 600, 256), (1000, 600, 256), (1000, 800, 256), (800, 800, 256)]   # 3: the top landing
    S5 = [(800, 200, 256), (1000, 200, 256), (1000, 600, 256), (800, 600, 256)]   # 4: over the ramp
    S4 = [(800, 0, 256), (1000, 0, 256), (1000, 200, 256), (800, 200, 256)]   # 5: over the bottom landing
    U = [(0, 0, 256), (800, 0, 256), (800, 200, 256), (0, 200, 256)]     # 6: the upper floor, over the lower one
    return [poly(A, [-1, 1, -1, -1]), poly(S1, [-1, -1, 2, 0]), poly(S2, [1, -1, 3, -1]), poly(S3, [2, -1, -1, 4]),
            poly(S5, [5, -1, 3, -1]), poly(S4, [-1, -1, 4, 6]), poly(U, [-1, 5, -1, -1])]


def degenerate():
    """Polygons with no area, a repeated corner, a sliver one unit wide between two rooms, a huge one."""
    return [
        poly([(0, 0, 0), (300, 0, 0), (300, 300, 0), (0, 300, 0)], [-1, 1, -1, 4]),          # 0: a room
        poly([(300, 149, 0), (500, 149, 0), (500, 150, 0), (300, 150, 0)], [-1, 2, -1, 0]),  # 1: a sliver 1 wide
        poly([(500, 0, 0), (800, 0, 0), (800, 300, 0), (500, 300, 0)], [-1, 3, -1, 1]),      # 2: a room
        poly([(800, 0, 0), (100800, 0, 0), (100800, 100000, 0), (800, 100000, 0)], [-1, -1, -1, 2]),   # 3: huge
        poly([(0, 300, 0), (0, 300, 0), (300, 300, 0), (150, 450, 0)], [-1, -1, -1, 0]),     # 4: a repeated corner
        poly([(0, 600, 0), (100, 600, 0), (200, 600, 0)], [-1, -1, -1]),                     # 5: no area (a line)
        poly([(1, 1, 1), (1, 1, 1), (1, 1, 1)], [-1, -1, -1]),                               # 6: a point
    ]


def bad_data():
    """Wrong numbers: 2 and 7 sides, links to nowhere, to itself, to a polygon left out, one way only."""
    q = [(0, 0, 0), (200, 0, 0), (200, 200, 0), (0, 200, 0)]
    out = [poly(q, [-5, 1, 9999, 0])]                                       # 0: -5, 9999 and itself
    out.append(poly([(x + 200, y, z) for x, y, z in q], [-1, 2, -1, 0]))   # 1
    out.append(poly([(400, 0, 0), (600, 0, 0)], [1, -1]))                   # 2: two sides: left out
    out.append(poly([(x + 600, y, z) for x, y, z in q], [-1, -1, -1, 2]))  # 3: linked to the left-out one only
    out.append('7 ' + ' '.join(['0'] * 21) + ' ' + ' '.join(['-1'] * 7))    # 4: seven sides: left out
    out.append(poly([(x + 800, y, z) for x, y, z in q], [-1, -1, -1, 3]))  # 5: links to 3, 3 not back to it
    return out


def islands():
    q = [(0, 0, 0), (200, 0, 0), (200, 200, 0), (0, 200, 0)]
    return [poly(q, [-1, -1, -1, -1]), poly([(x + 5000, y, z) for x, y, z in q], [-1, -1, -1, -1])]


def spiral(turns=40, cell=64):
    """A corridor one cell wide that winds round in a square spiral: far more turns than 63 corners."""
    cells, x, y, d = [], 0, 0, 0
    length, dirs = 1, [(1, 0), (0, 1), (-1, 0), (0, -1)]
    while len(cells) < turns * 6:
        for _ in range(2):
            for _ in range(length):
                cells.append((x, y))
                x, y = x + dirs[d][0] * 2, y + dirs[d][1] * 2        # every other cell: walls between the rings
            d = (d + 1) % 4
        length += 1
    path = []
    for (ax, ay), (bx, by) in zip(cells, cells[1:]):
        path.append((ax, ay))
        path.append(((ax + bx) // 2, (ay + by) // 2))
    path.append(cells[-1])
    index = {c: i for i, c in enumerate(path)}
    polys = []
    for i, (cx, cy) in enumerate(path):
        pts = [(cx * cell, cy * cell), ((cx + 1) * cell, cy * cell), ((cx + 1) * cell, (cy + 1) * cell), (cx * cell, (cy + 1) * cell)]
        nb = [(cx, cy - 1), (cx + 1, cy), (cx, cy + 1), (cx - 1, cy)]
        ids = [index.get(c, -1) if abs(index.get(c, -10) - i) == 1 else -1 for c in nb]
        polys.append(poly([(px, py, 0) for px, py in pts], ids))
    return polys[:2048]


def serpentine(bends=45, length=8, cell=64):
    """A corridor that goes back and forth: a turn at both ends of every leg, far more than 63 corners."""
    cells = []
    for leg in range(bends):
        row = [(x, leg * 2) for x in range(length)]
        cells += row if leg % 2 == 0 else row[::-1]
        if leg + 1 < bends:
            cells.append((cells[-1][0], leg * 2 + 1))      # the step up to the next leg
    index = {c: i for i, c in enumerate(cells)}
    polys = []
    for i, (cx, cy) in enumerate(cells):
        pts = [(cx * cell, cy * cell), ((cx + 1) * cell, cy * cell), ((cx + 1) * cell, (cy + 1) * cell), (cx * cell, (cy + 1) * cell)]
        nb = [(cx, cy - 1), (cx + 1, cy), (cx, cy + 1), (cx - 1, cy)]
        ids = [index[c] if c in index and abs(index[c] - i) == 1 else -1 for c in nb]
        polys.append(poly([(px, py, 0) for px, py in pts], ids))
    return polys


def centre(p):
    nums = [int(v) for v in p.split()]
    n = nums[0]
    pts = [nums[1 + 3 * k:4 + 3 * k] for k in range(n)]
    return [sum(c[k] for c in pts) / n for k in range(3)]


def q(a, b):
    return [round(v * 4) / 4 for v in list(a) + list(b)]


def cases():
    rng = random.Random(7)
    out = []
    strip = grid(10, 1, 100)
    edges = []
    for y in (0, -1, -19, -21, -199, -201, -500, 100, 101, 299, 301):            # on, just off and far off the border
        edges.append(q((50, y, 20), (950, 50, 20)))
    for z in (-41, -39, 139.75, 140.25, 400):                                    # under and over the floor
        edges.append(q((50, 50, z), (950, 50, 20)))
    for x in (100, 200, 500):                                                    # on the edges between the quads
        edges.append(q((x, 50, 20), (x, 0, 20)))
        edges.append(q((x, 0, 20), (950, 100, 20)))
    edges.append(q((0, 0, 0), (1000, 100, 0)))                                   # corner to corner
    edges.append(q((-150, 50, 10), (1150, 50, 10)))                              # both ends off it, within 200
    out.append(('strip: border, edges, heights', strip, edges))
    g = grid(8, 8, 100)
    out.append(('grid: shared corners', g, [q((i * 100, j * 100, 0), ((7 - i) * 100 + 50, (7 - j) * 100 + 50, 0))
                                             for i in range(9) for j in range(0, 9, 2)]))
    mixed = grid(8, 8, 100, reverse=lambda i, j: (i + j) % 2 == 0)
    out.append(('grid: mixed winding', mixed, [q((rng.uniform(0, 800), rng.uniform(0, 800), 10),
                                                (rng.uniform(0, 800), rng.uniform(0, 800), 10)) for _ in range(200)]))
    fq = [q((0, 0, 0), centre(p)) for p in fan()] + [q(centre(a), centre(b)) for a in fan() for b in fan()]
    fq += [q((200, 0, 0), (-200, 0, 0)), q((100, 0, 0), (-100, 0, 0))]       # vertex to vertex, along the edges
    out.append(('fan: one corner for all', fan(), fq))
    sq = [q((100, 100, 10), (100, 100, 266)), q((100, 100, 266), (100, 100, 10)), q((900, 100, 10), (900, 100, 266)),
          q((100, 100, 128), (900, 700, 260)), q((100, 100, 215.75), (950, 100, 10)), q((100, 100, 216.25), (950, 100, 10)),
          q((900, 400, 128), (100, 100, 266)), q((900, 400, 300), (100, 100, 10))]
    out.append(('floors over floors (switchback)', stacked(), sq))
    dq = [q((150, 150, 0), (650, 150, 0)), q((150, 150, 0), (50000, 50000, 0)), q((400, 149.5, 0), (650, 150, 0)),
          q((150, 350, 0), (650, 150, 0)), q((100, 600, 0), (150, 150, 0)), q((1, 1, 1), (150, 150, 0)),
          q((150, 150, 0), (150, 150, 0)), q((100750, 50000, 0), (150, 150, 0))]
    out.append(('degenerate polygons', degenerate(), dq))
    bq = [q((100, 100, 0), (300, 100, 0)), q((100, 100, 0), (700, 100, 0)), q((100, 100, 0), (900, 100, 0)),
          q((900, 100, 0), (100, 100, 0)), q((500, 100, 0), (100, 100, 0)), q((700, 100, 0), (900, 100, 0))]
    out.append(('wrong data', bad_data(), bq))
    out.append(('islands', islands(), [q((100, 100, 0), (5100, 100, 0)), q((100, 100, 0), (150, 150, 0)),
                                         q((2600, 100, 0), (100, 100, 0))]))
    sp = spiral()
    out.append(('spiral: more turns than 63', sp, [q(centre(sp[0]), centre(sp[-1])), q(centre(sp[-1]), centre(sp[0])),
                                                   q(centre(sp[0]), centre(sp[len(sp) // 2]))]))
    zz = serpentine()
    out.append(('serpentine: 90 turns', zz, [q(centre(zz[0]), centre(zz[-1])), q(centre(zz[-1]), centre(zz[0]))]))
    narrow = grid(10, 1, 10, z=lambda i, j, x, y: 0)
    out.append(('a corridor 10 wide', narrow, [q((5, 5, 0), (95, 5, 0)), q((0, 0, 0), (100, 10, 0)), q((5, 5, 0), (5, 5, 0))]))
    ramp = grid(6, 6, 128, z=lambda i, j, x, y: x // 4)
    out.append(('ramps: a slope under the corners', ramp, [q((10, 10, 5), (760, 760, 200)), q((760, 10, 200), (10, 760, 5))]))
    big = grid(64, 40, 64)
    out.append(('2560 polygons (UCNavMesh keeps 2048)', big, [q((32, 32, 0), (4000, 2000, 0)), q((32, 32, 0), (4000, 2500, 0)),
                                                               q((32, 32, 0), (32, 2000, 0)), q((4000, 2400, 0), (32, 32, 0))]))
    out.append(('no polygons', [], [q((0, 0, 0), (100, 100, 0))]))
    return out


def properties(routes, qs):
    """Every route ends at its place, has at most 64 corners, no NaN; a route of one corner is the place itself."""
    bad = []
    for qq, r in zip(qs, routes):
        if not r:
            continue
        b = tuple(f(v) for v in qq[3:])
        if len(r) > 64 or tuple(r[-1]) != b or any(math.isnan(v) for c in r for v in c):
            bad.append((qq, len(r)))
    return bad


def main():
    failures = 0
    print('%-40s %8s %7s %8s %8s  %s' % ('walkable area', 'polygons', 'queries', 'no way', 'corners', 'C++ = UnrealScript'))
    for name, polys, qs in cases():
        native = run(polys, qs) if polys else [[] for _ in qs]
        script = ScriptRouter(polys)
        want = [[tuple(c) for c in script.Route(tuple(f(v) for v in qq[:3]), tuple(f(v) for v in qq[3:]))] for qq in qs]
        same = sum(1 for a, b in zip(want, native) if a == b)
        problems = properties(native, qs)
        failures += (len(qs) - same) + len(problems)
        print('%-40s %8d %7d %8d %8d  %s%s' % (name, min(len(polys), 2048), len(qs), sum(1 for r in native if not r),
                                              max([len(r) for r in native] or [0]),
                                              'same' if same == len(qs) else '%d DIFFERENT' % (len(qs) - same),
                                              ('; bad routes: %s' % problems[:2]) if problems else ''))
    print('ALL GOOD' if not failures else '%d problems' % failures)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
