// The routes on the walkable area of a map (DeusEdixNav.dll, for UCNavMesh): A* over its polygons, then the funnel
// (the straight line that cuts the corners, as Detour does). Plain C++, no engine header: nav_test.cpp builds it alone.
//
// The steps are the ones the UnrealScript version had, in the same order and in 32-bit floats as UnrealScript
// computes, so a character takes the same route as before. The polygons are read where UCNavMesh keeps them:
// polygon p has Sides[p] corners (3 to 6), corner k at p * MaxSides + k, and Across[p * MaxSides + k] is the
// polygon across its edge from corner k to k + 1, or -1.
#pragma once

#include <algorithm>
#include <cmath>
#include <vector>

namespace nav {

const int MaxSides = 6;         // the most corners a polygon has
const int MaxPolys = 2048;      // the most polygons a walkable area has (UCNavMesh.Sides[2048])
const int MaxCorners = 64;      // the most corners a route has (UCNavMesh.Corner[64])
const int MaxSteps = 4096;      // the most polygons the search takes from its open list

struct Vec {
    float X, Y, Z;
};

// A walkable area where UCNavMesh keeps it (the arrays are its own, read in place)
struct Polygons {
    int Count;
    const unsigned char* Sides;
    const float* CornerX;
    const float* CornerY;
    const float* CornerZ;
    const int* Across;
};

class Router {
public:
    explicit Router(const Polygons& mesh) : m(mesh) {
        count = std::min(std::max(m.Count, 0), MaxPolys);
        sides.assign(count, 0);
        centre.assign(count, Vec{0, 0, 0});
        lo.assign(count, Vec{0, 0, 0});
        hi.assign(count, Vec{0, 0, 0});
        for (int p = 0; p < count; p++) {
            int n = m.Sides[p];
            if (n < 3 || n > MaxSides)
                continue;                       // left out of the search
            sides[p] = n;
            int b = p * MaxSides;
            Vec c = {0, 0, 0};
            for (int k = 0; k < n; k++) {
                c.X += m.CornerX[b + k];
                c.Y += m.CornerY[b + k];
                c.Z += m.CornerZ[b + k];
                if (k == 0 || m.CornerX[b + k] < lo[p].X) lo[p].X = m.CornerX[b + k];
                if (k == 0 || m.CornerX[b + k] > hi[p].X) hi[p].X = m.CornerX[b + k];
                if (k == 0 || m.CornerY[b + k] < lo[p].Y) lo[p].Y = m.CornerY[b + k];
                if (k == 0 || m.CornerY[b + k] > hi[p].Y) hi[p].Y = m.CornerY[b + k];
                if (k == 0 || m.CornerZ[b + k] < lo[p].Z) lo[p].Z = m.CornerZ[b + k];
                if (k == 0 || m.CornerZ[b + k] > hi[p].Z) hi[p].Z = m.CornerZ[b + k];
            }
            centre[p] = Vec{c.X / n, c.Y / n, c.Z / n};
        }
    }

    // The route from a to b: its corners into out (at most MaxCorners, b the last); 0 when there is no way on the
    // walkable area (a or b off it, or no polygons between them).
    int Route(const Vec& a, const Vec& b, Vec* out) {
        int s = findPoly(a), t = findPoly(b);
        if (s < 0 || t < 0)
            return 0;
        if (s == t) {
            out[0] = b;
            return 1;
        }
        if (!findWay(s, t))
            return 0;
        return makeCorners(a, b, out);
    }

private:
    const Polygons& m;
    int count;
    std::vector<int> sides;             // 0: a polygon left out
    std::vector<Vec> centre, lo, hi;    // the middle of each polygon and its box
    // the search: the cost of the way to a polygon, the estimate of the whole way through it, where it was reached
    // from, whether it was seen and closed; the open polygons in a heap by estimate
    std::vector<float> cost, estimate;
    std::vector<int> cameFrom, heap, heapPos;
    std::vector<char> seen, closed;
    int heapN = 0;
    std::vector<int> way;               // the polygons from the start to the end
    std::vector<Vec> left, right;       // the portals between them: the ends of the edge each one crosses

    float cornerX(int at) const { return m.CornerX[at]; }
    float cornerY(int at) const { return m.CornerY[at]; }
    Vec corner(int at) const { return Vec{m.CornerX[at], m.CornerY[at], m.CornerZ[at]}; }

    // x, y inside polygon i (seen from above; either winding)
    bool inside(int i, float x, float y) const {
        int b = i * MaxSides, n = sides[i], pos = 0, neg = 0;
        for (int k = 0; k < n; k++) {
            int k2 = k + 1 == n ? 0 : k + 1;
            float c = (cornerX(b + k2) - cornerX(b + k)) * (y - cornerY(b + k))
                    - (cornerY(b + k2) - cornerY(b + k)) * (x - cornerX(b + k));
            if (c > 0.5f)
                pos++;
            else if (c < -0.5f)
                neg++;
        }
        return pos == 0 || neg == 0;
    }

    // how far x, y is from polygon i, seen from above (0: inside it)
    float polyDist(int i, float x, float y) const {
        if (inside(i, x, y))
            return 0;
        int b = i * MaxSides, n = sides[i];
        float best = 100000000;
        for (int k = 0; k < n; k++) {
            int k2 = k + 1 == n ? 0 : k + 1;
            float ex = cornerX(b + k2) - cornerX(b + k), ey = cornerY(b + k2) - cornerY(b + k);
            float f = ex * ex + ey * ey;
            if (f > 0)
                f = std::min(std::max(((x - cornerX(b + k)) * ex + (y - cornerY(b + k)) * ey) / f, 0.f), 1.f);
            float dx = cornerX(b + k) + ex * f - x, dy = cornerY(b + k) + ey * f - y;
            float d = dx * dx + dy * dy;
            if (d < best)
                best = d;
        }
        return std::sqrt(best);
    }

    // The polygon under p (a character's feet, or a place up to 140 units over its floor), or -1. Just off the mesh
    // (it keeps 20 units from the walls: a place by a wall), the nearest polygon within 200 units.
    int findPoly(const Vec& p) const {
        int best = -1, nearest = -1;
        float bestD = 1000000, nearD = 200;
        for (int i = 0; i < count; i++) {
            if (sides[i] == 0 || p.Z < lo[i].Z - 40 || p.Z > hi[i].Z + 140)
                continue;
            if (p.X < lo[i].X - nearD || p.X > hi[i].X + nearD || p.Y < lo[i].Y - nearD || p.Y > hi[i].Y + nearD)
                continue;
            float d = polyDist(i, p.X, p.Y);
            if (d == 0) {
                d = std::fabs(p.Z - (centre[i].Z + 45));
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            } else if (best < 0 && d < nearD) {
                nearD = d;
                nearest = i;
            }
        }
        return best >= 0 ? best : nearest;
    }

    float centreDist(int a, int b) const {
        float dx = centre[a].X - centre[b].X, dy = centre[a].Y - centre[b].Y, dz = centre[a].Z - centre[b].Z;
        return std::sqrt(dx * dx + dy * dy + dz * dz);
    }

    void heapUp(int i) {
        int p = heap[i];
        while (i > 0) {
            int parent = (i - 1) / 2;
            if (estimate[heap[parent]] <= estimate[p])
                break;
            heap[i] = heap[parent];
            heapPos[heap[i]] = i;
            i = parent;
        }
        heap[i] = p;
        heapPos[p] = i;
    }

    void heapPush(int p) {
        heap[heapN] = p;
        heapPos[p] = heapN;
        heapN++;
        heapUp(heapN - 1);
    }

    int heapPop() {
        int top = heap[0];
        heapN--;
        if (heapN > 0) {
            int p = heap[heapN], i = 0;
            while (true) {
                int c = i * 2 + 1;
                if (c >= heapN)
                    break;
                if (c + 1 < heapN && estimate[heap[c + 1]] < estimate[heap[c]])
                    c++;
                if (estimate[heap[c]] >= estimate[p])
                    break;
                heap[i] = heap[c];
                heapPos[heap[i]] = i;
                i = c;
            }
            heap[i] = p;
            heapPos[p] = i;
        }
        return top;
    }

    // the polygons from s to t into way, or false when t cannot be reached from s
    bool findWay(int s, int t) {
        cost.assign(count, 0);
        estimate.assign(count, 0);
        cameFrom.assign(count, -1);
        heap.assign(count, 0);
        heapPos.assign(count, 0);
        seen.assign(count, 0);
        closed.assign(count, 0);
        heapN = 0;
        cost[s] = 0;
        estimate[s] = centreDist(s, t);
        cameFrom[s] = -1;
        seen[s] = 1;
        heapPush(s);
        for (int steps = 0; heapN > 0 && steps < MaxSteps; steps++) {
            int p = heapPop();
            if (p == t)
                break;
            closed[p] = 1;
            int b = p * MaxSides, n = sides[p];
            for (int k = 0; k < n; k++) {
                int q = m.Across[b + k];
                if (q < 0 || q >= count || sides[q] == 0 || closed[q])
                    continue;
                float c = cost[p] + centreDist(p, q);
                if (!seen[q]) {
                    seen[q] = 1;
                    cost[q] = c;
                    estimate[q] = c + centreDist(q, t);
                    cameFrom[q] = p;
                    heapPush(q);
                } else if (c < cost[q]) {
                    cost[q] = c;
                    estimate[q] = c + centreDist(q, t);
                    cameFrom[q] = p;
                    heapUp(heapPos[q]);
                }
            }
        }
        if (!seen[t])
            return false;
        way.clear();
        for (int p = t; p >= 0 && (int)way.size() < MaxPolys; p = cameFrom[p])
            way.push_back(p);
        std::reverse(way.begin(), way.end());       // the start first
        return true;
    }

    static float area2(float px, float py, float qx, float qy, float sx, float sy) {
        return (sx - px) * (qy - py) - (qx - px) * (sy - py);    // twice the signed area of p, q, s seen from above
    }

    // portal i: the edge shared by way[i - 1] and way[i], its left and right ends as one walks through it
    bool portal(int i) {
        int a = way[i - 1], c = way[i], b = a * MaxSides, n = sides[a], k;
        for (k = 0; k < n; k++)
            if (m.Across[b + k] == c)
                break;
        if (k == n)
            return false;
        int k2 = k + 1 == n ? 0 : k + 1;
        float dx = centre[c].X - centre[a].X, dy = centre[c].Y - centre[a].Y;
        float mx = (cornerX(b + k) + cornerX(b + k2)) / 2, my = (cornerY(b + k) + cornerY(b + k2)) / 2;
        if (dx * (cornerY(b + k) - my) - dy * (cornerX(b + k) - mx) > 0) {     // corner k on the left
            left[i] = corner(b + k);
            right[i] = corner(b + k2);
        } else {
            left[i] = corner(b + k2);
            right[i] = corner(b + k);
        }
        return true;
    }

    // a corner of the route at an end of portal i (atLeft: its left end), 20 units into the portal (off the wall)
    void addCorner(int i, bool atLeft, Vec* out, int& n) const {
        if (n >= MaxCorners - 1)
            return;
        Vec c = atLeft ? left[i] : right[i], o = atLeft ? right[i] : left[i];
        float wx = o.X - c.X, wy = o.Y - c.Y;
        float w = std::sqrt(wx * wx + wy * wy + 0.f);
        if (w > 1) {
            float f = std::min(20.f, w / 2) / w;
            c = Vec{c.X + (o.X - c.X) * f, c.Y + (o.Y - c.Y) * f, c.Z + (o.Z - c.Z) * f};
        }
        out[n++] = c;
    }

    // the corners of the way from a to b (b the last one; the others on the floor)
    int makeCorners(const Vec& a, const Vec& b, Vec* out) {
        int numWay = (int)way.size(), last = numWay + 1, n = 0;
        left.assign(numWay + 1, Vec{0, 0, 0});
        right.assign(numWay + 1, Vec{0, 0, 0});
        left[0] = right[0] = a;              // portal 0: the start, 1..numWay-1: the edges, numWay: the end
        left[numWay] = right[numWay] = b;
        for (int i = 1; i < numWay; i++)
            if (!portal(i))
                left[i] = right[i] = centre[way[i]];
        float apexX = a.X, apexY = a.Y, leftX = left[0].X, leftY = left[0].Y, rightX = right[0].X, rightY = right[0].Y;
        int apex = 0, l = 0, r = 0;
        for (int i = 1; i < last && n < MaxCorners - 1; i++) {
            // the right side of the funnel
            if (area2(apexX, apexY, rightX, rightY, right[i].X, right[i].Y) <= 0) {
                if ((apexX == rightX && apexY == rightY) || area2(apexX, apexY, leftX, leftY, right[i].X, right[i].Y) > 0) {
                    rightX = right[i].X;
                    rightY = right[i].Y;
                    r = i;
                } else {
                    addCorner(l, true, out, n);         // the right side crossed the left: turn at the left
                    apex = l;
                    apexX = leftX;
                    apexY = leftY;
                    rightX = apexX;
                    rightY = apexY;
                    r = apex;
                    i = apex;
                    continue;
                }
            }
            // the left side
            if (area2(apexX, apexY, leftX, leftY, left[i].X, left[i].Y) >= 0) {
                if ((apexX == leftX && apexY == leftY) || area2(apexX, apexY, rightX, rightY, left[i].X, left[i].Y) < 0) {
                    leftX = left[i].X;
                    leftY = left[i].Y;
                    l = i;
                } else {
                    addCorner(r, false, out, n);
                    apex = r;
                    apexX = rightX;
                    apexY = rightY;
                    leftX = apexX;
                    leftY = apexY;
                    l = apex;
                    i = apex;
                    continue;
                }
            }
        }
        if (n > 0) {
            float dx = out[n - 1].X - b.X, dy = out[n - 1].Y - b.Y, dz = out[n - 1].Z - b.Z;
            if (std::sqrt(dx * dx + dy * dy + dz * dz) < 2)
                n--;                            // the funnel's last turn was at the place itself
        }
        out[n++] = b;
        return n;
    }
};

}  // namespace nav
