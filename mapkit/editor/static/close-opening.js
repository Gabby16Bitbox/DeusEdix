// Tools > Close an opening (Gabby, 13 Nov 2026: "we can open walls, can we close them, taking the texture around?"):
// a click inside a doorway, a window, a pit or a hole in a ceiling finds the wall round it, measures the opening
// (its sides, its depth through the wall) and gives the block that fills it. Its front and its back take the
// texture of the wall in front and behind, laid exactly as there (the same TextureU, TextureV and origin), so the
// patch does not show. All in Unreal units, with cast(from, dir, far): the nearest surface of the map facing a ray,
// { d, n, p } (distance, normal, point) or null. No page code here: app.js casts and makes the block.

export const MAX_SIDE = 4096;     // how far a side of the opening may be from the click
export const MAX_DEPTH = 1024;    // an opening deeper than this is a passage: draw a block instead
export const MARGIN = 1;          // the fill goes this far into the sides (solid already: no crack at the edges)
const RADII = [8, 16, 32, 64, 128, 256, 512, 1024];
const SECTORS = 16;
const INSIDE = 2;                 // the sides are measured this far behind the wall's face

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// a measure on the grid when it is that close to it (the maps are built on whole units)
const tidy = (x) => (Math.abs(x - Math.round(x)) < 0.06 ? Math.round(x) : Math.round(x * 100) / 100);

// two directions square to d and to each other
function across(d) {
  const a = norm(cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return [a, norm(cross(d, a))];
}

// The wall the opening is in: rays beside the click, on rings ever wider, meet surfaces facing back nearer than
// what the click itself meets (seen through the opening). The wall is the plane met all round the click (in the
// most directions); a side of the opening (a jamb seen at a slant) only on one side.
export function wallAround(cast, from, dir) {
  dir = norm(dir);
  const centre = cast(from, dir, Infinity), far = centre ? centre.d : Infinity;
  const [a, b] = across(dir), planes = [];
  for (const r of RADII) {
    for (let k = 0; k < SECTORS; k++) {
      const t = (2 * Math.PI * k) / SECTORS, start = add(add(from, a, r * Math.cos(t)), b, r * Math.sin(t));
      const h = cast(start, dir, Infinity);
      if (!h || h.d > far - 4 || dot(h.n, dir) > -0.2) continue;
      const d = dot(h.n, h.p);
      let pl = planes.find((q) => dot(q.n, h.n) > 0.999 && Math.abs(q.d - d) < 1);
      if (!pl) planes.push(pl = { n: h.n, d, sectors: new Set(), first: r, hits: 0 });
      pl.sectors.add(k); pl.hits++;
    }
    if (planes.some((q) => q.sectors.size >= SECTORS - 2)) break;
  }
  planes.sort((p, q) => q.sectors.size - p.sectors.size || p.first - q.first || q.hits - p.hits);
  return { plane: planes[0] || null, centre };
}

// the wall's own axes: n out of it, u across it, v up it (on a floor or a ceiling: x and y); null when slanted
export function wallAxes(n) {
  if (Math.abs(n[2]) > 0.95) return { n: [0, 0, Math.sign(n[2])], u: [1, 0, 0], v: [0, 1, 0], kind: n[2] > 0 ? 'floor' : 'ceiling' };
  if (Math.abs(n[2]) > 0.05) return null;
  let h = norm([n[0], n[1], 0]);
  // nearly on an axis: on it (a wall of the grid turned by a rounding)
  if (Math.abs(h[0]) > 0.99996) h = [Math.sign(h[0]), 0, 0];
  else if (Math.abs(h[1]) > 0.99996) h = [0, Math.sign(h[1]), 0];
  return { n: h, u: norm(cross(h, [0, 0, 1])), v: [0, 0, 1], kind: 'wall' };
}

// how far along dir from p the side of the opening is: a surface facing back within MAX_SIDE, else null
function sideAt(cast, p, dir) {
  const h = cast(p, dir, MAX_SIDE);
  return h && dot(h.n, dir) < -0.5 ? h.d : null;
}

// how deep the side at distance e along dir goes behind the wall's face: the depth where it stops being there
// (Infinity when it goes on, as the floor under a doorway); to a quarter of a unit
function sideDepth(cast, C, n, dir, e) {
  const there = (depth) => { const h = cast(add(C, n, -depth), dir, e + 4); return !!h && Math.abs(h.d - e) < 1 && dot(h.n, dir) < -0.5; };
  let ok = INSIDE, step = 4;
  while (there(ok + step)) { ok += step; step *= 2; if (ok > MAX_DEPTH) return Infinity; }
  let gone = ok + step;
  while (gone - ok > 0.25) { const mid = (ok + gone) / 2; if (there(mid)) ok = mid; else gone = mid; }
  return (ok + gone) / 2;
}

// the depth most sides agree on (to a unit), the smaller one when they do not
function agreed(depths) {
  const f = depths.filter(Number.isFinite).sort((x, y) => x - y);
  if (!f.length) return null;
  let best = f[0], most = 0;
  for (const x of f) { const k = f.filter((y) => Math.abs(y - x) <= 1).length; if (k > most) { most = k; best = x; } }
  return best;
}

// The opening under a click: { ok: true, n, u, v, kind, front (the wall's plane, n.p), C (the click on it), sides
// { left, right, down, up } (from C along -u, u, -v, v), depth, frontHit, backHit } or { ok: false, why }.
export function measureOpening(cast, from, dir) {
  dir = norm(dir);
  const { plane, centre } = wallAround(cast, from, dir);
  if (!plane) {
    return { ok: false, why: centre && dot(centre.n, dir) < -0.2
      ? 'That is the wall itself: click inside the opening (where you see through it).'
      : 'No wall round the click: click in the middle of a doorway, a window or a hole in a floor or ceiling.' };
  }
  const ax = wallAxes(plane.n);
  if (!ax) return { ok: false, why: 'This opening is in a slanted surface: only walls, floors and ceilings can be closed this way.' };
  const { n, u, v } = ax;
  const front = tidy(dot(n, plane.n) > 0 ? plane.d / dot(n, plane.n) : plane.d);
  const t = (front - dot(n, from)) / dot(n, dir);
  if (!(t > 0)) return { ok: false, why: 'The wall is behind the camera: look at the opening.' };
  const C = add(from, dir, t);
  if (centre && centre.d < t + 1) return { ok: false, why: 'That is the wall itself: click inside the opening (where you see through it).' };
  const Q = add(C, n, -INSIDE);
  const ways = { left: scale(u, -1), right: u, down: scale(v, -1), up: v };
  const sides = {};
  for (const [k, w] of Object.entries(ways)) {
    sides[k] = sideAt(cast, Q, w);
    if (sides[k] === null) return { ok: false, why: `The opening has no ${k === 'down' || k === 'up' ? (ax.kind === 'wall' ? (k === 'up' ? 'top' : 'bottom') : 'side') : 'side'} within ${MAX_SIDE} units (${k}): it is not closed all round.` };
  }
  // an arch, a round window: the box round all of it, measured across it at a few places
  for (const f of [0.15, 0.35, 0.65, 0.85]) {
    const s = -sides.down + f * (sides.down + sides.up), at = add(Q, v, s);
    for (const k of ['left', 'right']) { const e = sideAt(cast, at, ways[k]); if (e !== null) sides[k] = Math.max(sides[k], e); }
    const s2 = -sides.left + f * (sides.left + sides.right), at2 = add(Q, u, s2);
    for (const k of ['down', 'up']) { const e = sideAt(cast, at2, ways[k]); if (e !== null) sides[k] = Math.max(sides[k], e); }
  }
  const depths = {};
  for (const k of Object.keys(ways)) depths[k] = sideDepth(cast, C, n, ways[k], sideAt(cast, Q, ways[k]));
  const depth = agreed(Object.values(depths));
  if (depth === null) return { ok: false, why: `The opening goes on for more than ${MAX_DEPTH} units: it is a passage. Draw a block across it instead.` };
  // what is in front of the wall and behind it, just beside the opening: the faces the fill continues
  let frontHit = null, backHit = null;
  for (const k of Object.keys(ways)) {
    for (const off of [8, 24, 64]) {
      const P = add(C, ways[k], sides[k] + off);
      if (!frontHit) { const h = cast(add(P, n, 8), scale(n, -1), 16); if (h && Math.abs(h.d - 8) < 1 && dot(h.n, n) > 0.99) frontHit = h; }
      if (!backHit) { const h = cast(add(P, n, -(depth + 8)), n, 16); if (h && Math.abs(h.d - 8) < 1.5 && dot(h.n, n) < -0.99) backHit = h; }
    }
  }
  // the back as the wall behind has it (the sides' search ends within a quarter of a unit: the fill's back would
  // stand out of the wall behind by that much)
  let exact = depth;
  if (backHit) { const e = dot(n, C) - dot(n, backHit.p); if (Math.abs(e - depth) < 1) exact = e; }
  return { ok: true, n, u, v, kind: ax.kind, front, C, sides: Object.fromEntries(Object.entries(sides).map(([k, x]) => [k, tidy(x)])),
    depth: tidy(exact), depths, frontHit, backHit };
}

// The fill block for a measured opening: its box (lo, hi) about its centre, before its turn rot ([pitch, yaw, roll],
// 65536 a whole turn), as the editor's blocks are. A wall off the axes is a block turned by its yaw.
export function fillBox(m, yawUnits = 65536) {
  const { n, u, v, C, sides, depth } = m;
  const a = -(sides.left + MARGIN), b = sides.right + MARGIN, c = -(sides.down + MARGIN), d = sides.up + MARGIN;
  // the centre: half way into the wall, in the middle of the opening
  const centre = add(add(add(C, n, -depth / 2), u, (a + b) / 2), v, (c + d) / 2);
  const half = { n: depth / 2, u: (b - a) / 2, v: (d - c) / 2 };
  const r2 = (x) => tidy(Math.round(x * 100) / 100);     // on the grid when that close to it: no sliver left at the wall
  let size, rot = null;
  if (m.kind !== 'wall') size = [2 * half.u, 2 * half.v, 2 * half.n];            // x, y across; z the depth
  else if (Math.abs(n[0]) === 1) size = [2 * half.n, 2 * half.u, 2 * half.v];    // a wall facing x
  else if (Math.abs(n[1]) === 1) size = [2 * half.u, 2 * half.n, 2 * half.v];    // a wall facing y
  else {                                                                         // a wall at an angle: turned
    size = [2 * half.n, 2 * half.u, 2 * half.v];
    rot = [0, Math.round((((Math.atan2(n[1], n[0]) / (2 * Math.PI)) * yawUnits) % yawUnits + yawUnits) % yawUnits), 0];
  }
  return { lo: centre.map((x, k) => r2(x - size[k] / 2)), hi: centre.map((x, k) => r2(x + size[k] / 2)), rot };
}

// A face's mapping as the T3D writes it (geom.py: Origin, TextureU, TextureV; the pan in the origin) from the 13
// numbers the build dumps for it (data.py: base, U, V, pan U, pan V, texture width, height): u = (P - base).U + panU.
export function mappingFromNums(nums) {
  const B = nums.slice(0, 3), U = nums.slice(3, 6), V = nums.slice(6, 9);
  const x = inPlane(U, V, nums[9], nums[10]);
  if (!x) return null;
  return { o: add(B, x, -1), u: U, v: V, w: nums[11] || 128, h: nums[12] || 128 };
}
// the same from a triangle the 3D view draws: its corners P and their texture coordinates t (in tiles), the
// texture's size w x h
export function mappingFromTriangle(P, t, w, h) {
  const e1 = add(P[1], P[0], -1), e2 = add(P[2], P[0], -1);
  // the gradient of each coordinate: in the plane, it grows along each edge as the coordinate does
  const grad = (k) => inPlane(e1, e2, t[1][k] - t[0][k], t[2][k] - t[0][k]);
  const gu = grad(0), gv = grad(1);
  if (!gu || !gv) return null;
  const U = scale(gu, w), V = scale(gv, h), x = inPlane(U, V, t[0][0] * w, t[0][1] * h);
  if (!x) return null;
  return { o: add(P[0], x, -1), u: U, v: V, w, h };
}
// the x in the plane of A and B (x = a A + b B) with x.A = p and x.B = q; null when A and B are parallel
function inPlane(A, B, p, q) {
  const aa = dot(A, A), ab = dot(A, B), bb = dot(B, B), det = aa * bb - ab * ab;
  if (Math.abs(det) < 1e-12) return null;
  const a = (p * bb - q * ab) / det, b = (q * aa - p * ab) / det;
  return add(scale(A, a), B, b);
}
// a texture coordinate (in tiles) of a world point by a mapping
export function uvAt(m, P) {
  const d = add(P, m.o, -1);
  return [dot(d, m.u) / m.w, dot(d, m.v) / m.h];
}

// The look of a face that matters to the fill: masked, translucent, modulated, two-sided, unlit, the shadows' and
// the smoothing's flags, mirror, special lit... (not the editor's own bits: selected, memorized, cut).
export const LOOK_FLAGS = 0x2 | 0x4 | 0x40 | 0x100 | 0x200 | 0x400 | 0x800 | 0x1000 | 0x2000 | 0x4000 | 0x8000 | 0x20000
  | 0x40000 | 0x80000 | 0x100000 | 0x200000 | 0x400000 | 0x800000 | 0x8000000;
