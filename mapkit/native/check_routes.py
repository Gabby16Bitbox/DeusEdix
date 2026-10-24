"""The C++ routes (NavRoute.h, through nav_test.exe) against the UnrealScript steps they replace, written again here
line for line from UCNavMesh.uc as it was (ScriptRouter), every operation rounded to a 32-bit float as UnrealScript
computes it: the corners must be the same floats.

Walkable areas: every one baked in a map's edits found under the folders given (edits['navmesh']), and mazes made
here (grids with holes, ramps, cells cut into triangles), up to 2048 polygons.

    python check_routes.py [folder ...]
"""
import json
import random
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAV_TEST = HERE.parent / 'bin' / 'nav_test.exe'


def f(x):
    """x as a 32-bit float."""
    return struct.unpack('<f', struct.pack('<f', x))[0]


def sqrt(x):
    return f(x ** 0.5)


class ScriptRouter:
    """UCNavMesh's search and funnel as UnrealScript ran them (Load, Inside, PolyDist, FindPoly, the heap, FindWay,
    Portal, AddCorner, MakeCorners, Route), same names."""

    def __init__(self, polys):
        self.NumPolys = min(len(polys), 2048)
        self.NV = [0] * self.NumPolys
        self.VX, self.VY, self.VZ, self.NB = {}, {}, {}, {}
        self.CX, self.CY, self.CZ = [0.0] * self.NumPolys, [0.0] * self.NumPolys, [0.0] * self.NumPolys
        self.MinX, self.MaxX = [0.0] * self.NumPolys, [0.0] * self.NumPolys
        self.MinY, self.MaxY = [0.0] * self.NumPolys, [0.0] * self.NumPolys
        self.MinZ, self.MaxZ = [0.0] * self.NumPolys, [0.0] * self.NumPolys
        for p in range(self.NumPolys):
            nums = [int(v) for v in polys[p].split()]
            n = nums[0]
            if n < 3 or n > 6 or len(nums) != 1 + 4 * n:
                continue
            self.NV[p] = n
            b = p * 6
            for k in range(n):
                self.VX[b + k], self.VY[b + k], self.VZ[b + k] = (f(v) for v in nums[1 + 3 * k:4 + 3 * k])
                self.NB[b + k] = nums[1 + 3 * n + k]
                self.CX[p] = f(self.CX[p] + self.VX[b + k])
                self.CY[p] = f(self.CY[p] + self.VY[b + k])
                self.CZ[p] = f(self.CZ[p] + self.VZ[b + k])
                if k == 0 or self.VX[b + k] < self.MinX[p]: self.MinX[p] = self.VX[b + k]
                if k == 0 or self.VX[b + k] > self.MaxX[p]: self.MaxX[p] = self.VX[b + k]
                if k == 0 or self.VY[b + k] < self.MinY[p]: self.MinY[p] = self.VY[b + k]
                if k == 0 or self.VY[b + k] > self.MaxY[p]: self.MaxY[p] = self.VY[b + k]
                if k == 0 or self.VZ[b + k] < self.MinZ[p]: self.MinZ[p] = self.VZ[b + k]
                if k == 0 or self.VZ[b + k] > self.MaxZ[p]: self.MaxZ[p] = self.VZ[b + k]
            self.CX[p] = f(self.CX[p] / n)
            self.CY[p] = f(self.CY[p] / n)
            self.CZ[p] = f(self.CZ[p] / n)

    def Inside(self, i, x, y):
        b, n, pos, neg = i * 6, self.NV[i], 0, 0
        VX, VY = self.VX, self.VY
        for k in range(n):
            k2 = 0 if k + 1 == n else k + 1
            c = f(f(f(VX[b + k2] - VX[b + k]) * f(y - VY[b + k])) - f(f(VY[b + k2] - VY[b + k]) * f(x - VX[b + k])))
            if c > 0.5:
                pos += 1
            elif c < -0.5:
                neg += 1
        return pos == 0 or neg == 0

    def PolyDist(self, i, x, y):
        if self.Inside(i, x, y):
            return 0.0
        b, n, best = i * 6, self.NV[i], 100000000.0
        VX, VY = self.VX, self.VY
        for k in range(n):
            k2 = 0 if k + 1 == n else k + 1
            ex, ey = f(VX[b + k2] - VX[b + k]), f(VY[b + k2] - VY[b + k])
            fr = f(f(ex * ex) + f(ey * ey))
            if fr > 0:
                fr = min(max(f(f(f(f(x - VX[b + k]) * ex) + f(f(y - VY[b + k]) * ey)) / fr), 0.0), 1.0)
            dx = f(f(VX[b + k] + f(ex * fr)) - x)
            dy = f(f(VY[b + k] + f(ey * fr)) - y)
            d = f(f(dx * dx) + f(dy * dy))
            if d < best:
                best = d
        return sqrt(best)

    def FindPoly(self, p):
        best, near, bestD, nearD = -1, -1, 1000000.0, 200.0
        for i in range(self.NumPolys):
            if self.NV[i] == 0 or p[2] < f(self.MinZ[i] - 40) or p[2] > f(self.MaxZ[i] + 140):
                continue
            if (p[0] < f(self.MinX[i] - nearD) or p[0] > f(self.MaxX[i] + nearD) or p[1] < f(self.MinY[i] - nearD)
                    or p[1] > f(self.MaxY[i] + nearD)):
                continue
            d = self.PolyDist(i, p[0], p[1])
            if d == 0:
                d = abs(f(p[2] - f(self.CZ[i] + 45)))
                if d < bestD:
                    bestD, best = d, i
            elif best < 0 and d < nearD:
                nearD, near = d, i
        return best if best >= 0 else near

    def HeapUp(self, i):
        Heap, HeapPos, F = self.Heap, self.HeapPos, self.F
        p = Heap[i]
        while i > 0:
            par = (i - 1) // 2
            if F[Heap[par]] <= F[p]:
                break
            Heap[i] = Heap[par]
            HeapPos[Heap[i]] = i
            i = par
        Heap[i] = p
        HeapPos[p] = i

    def HeapPush(self, p):
        self.Heap[self.HeapN] = p
        self.HeapPos[p] = self.HeapN
        self.HeapN += 1
        self.HeapUp(self.HeapN - 1)

    def HeapPop(self):
        Heap, HeapPos, F = self.Heap, self.HeapPos, self.F
        top = Heap[0]
        self.HeapN -= 1
        if self.HeapN > 0:
            p, i = Heap[self.HeapN], 0
            while True:
                c = i * 2 + 1
                if c >= self.HeapN:
                    break
                if c + 1 < self.HeapN and F[Heap[c + 1]] < F[Heap[c]]:
                    c += 1
                if F[Heap[c]] >= F[p]:
                    break
                Heap[i] = Heap[c]
                HeapPos[Heap[i]] = i
                i = c
            Heap[i] = p
            HeapPos[p] = i
        return top

    def CentreDist(self, a, b):
        dx, dy, dz = f(self.CX[a] - self.CX[b]), f(self.CY[a] - self.CY[b]), f(self.CZ[a] - self.CZ[b])
        return sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz)))

    def FindWay(self, s, t):
        n = self.NumPolys
        self.G, self.F, self.From = [0.0] * n, [0.0] * n, [0] * n
        self.Seen, self.Done, self.Heap, self.HeapPos = [False] * n, [False] * n, [0] * n, [0] * n
        self.HeapN = 0
        self.G[s] = 0.0
        self.F[s] = self.CentreDist(s, t)
        self.From[s] = -1
        self.Seen[s] = True
        self.HeapPush(s)
        steps = 0
        while self.HeapN > 0 and steps < 4096:
            steps += 1
            p = self.HeapPop()
            if p == t:
                break
            self.Done[p] = True
            b = p * 6
            for k in range(self.NV[p]):
                q = self.NB[b + k]
                if q < 0 or q >= self.NumPolys or self.NV[q] == 0 or self.Done[q]:
                    continue
                cost = f(self.G[p] + self.CentreDist(p, q))
                if not self.Seen[q]:
                    self.Seen[q] = True
                    self.G[q] = cost
                    self.F[q] = f(cost + self.CentreDist(q, t))
                    self.From[q] = p
                    self.HeapPush(q)
                elif cost < self.G[q]:
                    self.G[q] = cost
                    self.F[q] = f(cost + self.CentreDist(q, t))
                    self.From[q] = p
                    self.HeapUp(self.HeapPos[q])
        if not self.Seen[t]:
            return False
        self.Way = []
        p = t
        while p >= 0 and len(self.Way) < 2048:
            self.Way.append(p)
            p = self.From[p]
        self.Way.reverse()
        return True

    @staticmethod
    def Area2(px, py, qx, qy, sx, sy):
        return f(f(f(sx - px) * f(qy - py)) - f(f(qx - px) * f(sy - py)))

    def Portal(self, i):
        a, c = self.Way[i - 1], self.Way[i]
        b, n = a * 6, self.NV[a]
        k = next((k for k in range(n) if self.NB[b + k] == c), n)
        if k == n:
            return False
        k2 = 0 if k + 1 == n else k + 1
        dx, dy = f(self.CX[c] - self.CX[a]), f(self.CY[c] - self.CY[a])
        mx = f(f(self.VX[b + k] + self.VX[b + k2]) / 2)
        my = f(f(self.VY[b + k] + self.VY[b + k2]) / 2)
        ck = (self.VX[b + k], self.VY[b + k], self.VZ[b + k])
        ck2 = (self.VX[b + k2], self.VY[b + k2], self.VZ[b + k2])
        if f(f(dx * f(self.VY[b + k] - my)) - f(dy * f(self.VX[b + k] - mx))) > 0:
            self.L[i], self.R[i] = ck, ck2
        else:
            self.L[i], self.R[i] = ck2, ck
        return True

    def AddCorner(self, i, bLeft):
        if len(self.Corner) >= 63:
            return
        c, o = (self.L[i], self.R[i]) if bLeft else (self.R[i], self.L[i])
        d = (f(o[0] - c[0]), f(o[1] - c[1]), f(o[2] - c[2]))
        w = sqrt(f(f(f(d[0] * d[0]) + f(d[1] * d[1])) + f(f(d[2] * 0) * f(d[2] * 0))))
        if w > 1:
            s = f(min(20.0, f(w / 2)) / w)
            c = tuple(f(c[k] + f(d[k] * s)) for k in range(3))
        self.Corner.append(c)

    def MakeCorners(self, a, b):
        NumWay = len(self.Way)
        n = NumWay + 1
        self.L, self.R = [None] * (NumWay + 1), [None] * (NumWay + 1)
        self.L[0] = self.R[0] = a
        self.L[NumWay] = self.R[NumWay] = b
        for i in range(1, NumWay):
            if not self.Portal(i):
                c = (self.CX[self.Way[i]], self.CY[self.Way[i]], self.CZ[self.Way[i]])
                self.L[i] = self.R[i] = c
        self.Corner = []
        apexX, apexY = a[0], a[1]
        leftX, leftY = self.L[0][0], self.L[0][1]
        rightX, rightY = self.R[0][0], self.R[0][1]
        apex = left = right = 0
        i = 1
        while i < n and len(self.Corner) < 63:
            R, L = self.R[i], self.L[i]
            if self.Area2(apexX, apexY, rightX, rightY, R[0], R[1]) <= 0:
                if (apexX == rightX and apexY == rightY) or self.Area2(apexX, apexY, leftX, leftY, R[0], R[1]) > 0:
                    rightX, rightY, right = R[0], R[1], i
                else:
                    self.AddCorner(left, True)
                    apex = left
                    apexX, apexY = leftX, leftY
                    rightX, rightY = apexX, apexY
                    right = apex
                    i = apex + 1
                    continue
            if self.Area2(apexX, apexY, leftX, leftY, L[0], L[1]) >= 0:
                if (apexX == leftX and apexY == leftY) or self.Area2(apexX, apexY, rightX, rightY, L[0], L[1]) < 0:
                    leftX, leftY, left = L[0], L[1], i
                else:
                    self.AddCorner(right, False)
                    apex = right
                    apexX, apexY = rightX, rightY
                    leftX, leftY = apexX, apexY
                    left = apex
                    i = apex + 1
                    continue
            i += 1
        if self.Corner:
            last = self.Corner[-1]
            d = (f(last[0] - b[0]), f(last[1] - b[1]), f(last[2] - b[2]))
            if sqrt(f(f(f(d[0] * d[0]) + f(d[1] * d[1])) + f(d[2] * d[2]))) < 2:
                self.Corner.pop()
        self.Corner.append(b)

    def Route(self, a, b):
        if self.NumPolys <= 0:
            return []
        s, t = self.FindPoly(a), self.FindPoly(b)
        if s < 0 or t < 0:
            return []
        if s == t:
            return [b]
        if not self.FindWay(s, t):
            return []
        self.MakeCorners(a, b)
        return self.Corner


def maze(rng, w, h, cell=96, holes=0.25, ramps=True, cut=0.3):
    """A grid of w x h cells (some taken out), floors that rise and fall, some cells cut into two triangles; the
    polygons as the editor bakes them."""
    keep = {(i, j) for i in range(w) for j in range(h) if rng.random() > holes}
    zs = {}

    def z(i, j):
        if (i, j) not in zs:
            zs[(i, j)] = int(24 * ((i // 3) % 3) - 16 * ((j // 4) % 2)) if ramps else 0
        return zs[(i, j)]
    polys, index = [], {}
    for (i, j) in sorted(keep):
        x0, y0, x1, y1 = i * cell, j * cell, (i + 1) * cell, (j + 1) * cell
        zc = z(i, j)
        corners = [(x0, y0, zc), (x1, y0, zc), (x1, y1, zc), (x0, y1, zc)]
        if rng.random() < cut:
            index[(i, j)] = (len(polys), len(polys) + 1)
            polys.append([corners[0], corners[1], corners[2]])
            polys.append([corners[0], corners[2], corners[3]])
        else:
            index[(i, j)] = (len(polys),)
            polys.append(corners)
    out = []
    for (i, j) in sorted(keep):
        ids = index[(i, j)]
        for slot, p in enumerate(ids):
            n = len(polys[p])
            across = []
            for k in range(n):
                a, b = polys[p][k], polys[p][(k + 1) % n]
                q = -1
                if len(ids) == 2 and {a[:2], b[:2]} == {polys[ids[0]][0][:2], polys[ids[0]][2][:2]}:
                    q = ids[1 - slot]                    # the diagonal between the two triangles
                else:                                    # the cell across this side
                    di = 1 if a[0] == b[0] == (i + 1) * cell else -1 if a[0] == b[0] == i * cell else 0
                    dj = 1 if a[1] == b[1] == (j + 1) * cell else -1 if a[1] == b[1] == j * cell else 0
                    other = index.get((i + di, j + dj)) if (di or dj) else None
                    if other:
                        q = next((o for o in other if any(set([a[:2], b[:2]]) <= {c[:2] for c in polys[o]} for _ in [0])),
                                 other[0])
                across.append(q)
            out.append(' '.join(str(v) for v in [n] + [c for corner in polys[p] for c in corner] + across))
    return out


def queries(rng, polys, count):
    """Places on the polygons (a little over the floor, as a character's feet), and some off them."""
    out = []
    parsed = [[int(v) for v in p.split()] for p in polys]

    def place():
        nums = rng.choice(parsed)
        n = nums[0]
        pts = [nums[1 + 3 * k:4 + 3 * k] for k in range(n)]
        wts = [rng.random() for _ in pts]
        s = sum(wts)
        x, y, z = (sum(p[k] * w for p, w in zip(pts, wts)) / s for k in range(3))
        if rng.random() < 0.1:                           # off the area, or high over it
            x, y, z = x + rng.uniform(-300, 300), y + rng.uniform(-300, 300), z + rng.uniform(-60, 200)
        # quarters of a unit: numbers a float holds exactly, so the text read by nav_test is the same number here
        return [round(x * 4) / 4, round(y * 4) / 4, round((z + rng.uniform(0, 60)) * 4) / 4]
    for _ in range(count):
        out.append(place() + place())
    return out


def run(polys, qs):
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / 'nav.txt'
        path.write_text('%d\n%s\n%d\n%s\n' % (len(polys), '\n'.join(polys), len(qs),
                                              '\n'.join(' '.join(repr(v) for v in q) for q in qs)), encoding='ascii')
        r = subprocess.run([str(NAV_TEST), str(path)], capture_output=True, text=True, check=True)
    routes = []
    for line in r.stdout.splitlines():
        nums = [float(v) for v in line.split()]
        n = int(nums[0])
        routes.append([tuple(f(v) for v in nums[1 + 3 * k:4 + 3 * k]) for k in range(n)])
    return routes


def check(name, polys, qs):
    script = ScriptRouter(polys)
    native = run(polys, qs)
    bad = 0
    corners = 0
    for q, got in zip(qs, native):
        a, b = tuple(f(v) for v in q[:3]), tuple(f(v) for v in q[3:])
        want = [tuple(c) for c in script.Route(a, b)]
        corners += len(want)
        if want != got:
            bad += 1
            if bad <= 3:
                print('  different:', q, '\n    script', want[:4], '\n    native', got[:4])
    print('%-28s %4d polygons %5d routes %6d corners  %s' % (name, len(polys), len(qs), corners,
                                                               'same' if not bad else '%d DIFFERENT' % bad))
    return bad


def main():
    rng = random.Random(2026)
    bad = 0
    for folder in sys.argv[1:]:
        for edits in sorted(Path(folder).rglob('*.edits.json')):
            polys = (json.loads(edits.read_text(encoding='utf-8')).get('navmesh') or {}).get('polys') or []
            if polys:
                bad += check(edits.name, polys, queries(rng, polys, 400))
    for w, h, holes, cut in ((6, 5, 0.1, 0.3), (20, 15, 0.25, 0.3), (40, 30, 0.3, 0.2), (45, 40, 0.35, 0.15)):
        polys = maze(rng, w, h, holes=holes, cut=cut)[:2048]
        bad += check('maze %dx%d' % (w, h), polys, queries(rng, polys, 600))
    print('ALL THE SAME' if not bad else '%d routes differ' % bad)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
