// UnrealEd's Clip, Intersect and Deintersect on the editor's blocks, as point sets: every block is the convex hull of
// its corners (block-shapes.js), so a cut by a plane is again a convex hull (the corners on the kept side and the
// points where the edges cross the plane), the part two blocks share is the first cut by every face of the second,
// and the part of a block outside another is one convex piece per face of that one (each outside its face, inside
// the faces before it). Points are [x, y, z] in the game's units; planes {n, d}: n·x = d, n pointing out.
import { hullPolygons, hullCorners } from './block-shapes.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const EPS = 0.01;

// the part of a convex point set on the side n·x <= d of a plane (null when nothing solid is left)
export function clipBelow(pts, n, d) {
  const s = pts.map((p) => dot(n, p) - d);
  if (s.every((v) => v <= EPS)) return pts.slice();
  if (s.every((v) => v >= -EPS)) return null;
  const out = pts.filter((_, i) => s[i] <= EPS);
  const seen = new Set();
  for (const f of hullPolygons(pts)) {
    for (let i = 0; i < f.pts.length; i++) {
      const a = f.pts[i], b = f.pts[(i + 1) % f.pts.length], sa = dot(n, a) - d, sb = dot(n, b) - d;
      if ((sa < -EPS && sb > EPS) || (sa > EPS && sb < -EPS)) {
        const t = sa / (sa - sb), q = a.map((x, k) => Math.round((x + (b[k] - x) * t) * 100) / 100);
        const key = q.join();
        if (!seen.has(key)) { seen.add(key); out.push(q); }
      }
    }
  }
  return solid(out);
}
// a convex set worth a block: its hull's corners, with a volume (not flat, not a sliver left by rounding)
const MIN_VOLUME = 64;
export function solid(pts) {
  if (!pts || pts.length < 4) return null;
  const c = hullCorners(pts);
  if (c.length < 4) return null;
  let v = 0;                    // the volume: each face's area times its distance from the origin, a third
  for (const f of hullPolygons(c)) {
    const a = [0, 0, 0];
    for (let i = 1; i + 1 < f.pts.length; i++) {
      const u = f.pts[i].map((x, k) => x - f.pts[0][k]), w = f.pts[i + 1].map((x, k) => x - f.pts[0][k]);
      a[0] += u[1] * w[2] - u[2] * w[1]; a[1] += u[2] * w[0] - u[0] * w[2]; a[2] += u[0] * w[1] - u[1] * w[0];
    }
    v += dot(f.n, f.pts[0]) * Math.hypot(...a) / 2 / 3;
  }
  return v >= MIN_VOLUME ? c : null;
}
// Clip: both sides of a plane through `at` with normal n
export function split(pts, n, at) {
  const d = dot(n, at);
  return [clipBelow(pts, n, d), clipBelow(pts, n.map((x) => -x), -d)].filter(Boolean);
}
const planes = (pts) => hullPolygons(pts).map((f) => ({ n: f.n, d: dot(f.n, f.pts[0]) }));
// Intersect: what a and the cutter share
export function intersect(a, cutter) {
  let r = a;
  for (const { n, d } of planes(cutter)) { r = clipBelow(r, n, d); if (!r) return null; }
  return r;
}
// Deintersect: a without the cutter, in convex pieces
export function subtract(a, cutter) {
  const out = [];
  let r = a;
  for (const { n, d } of planes(cutter)) {
    const outside = clipBelow(r, n.map((x) => -x), -d);
    if (outside) out.push(outside);
    r = clipBelow(r, n, d);
    if (!r) break;
  }
  return out;
}
