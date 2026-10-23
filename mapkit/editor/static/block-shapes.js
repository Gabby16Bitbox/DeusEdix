// The editor's blocks: a cube, a wedge (a ramp, high at +X), a cylinder, a cone, a sphere and a dome (UnrealEd's
// brush builders as blocks, 20 Oct 2026: sides, hollow, a cone's top, align to side), built at Rebuild as
// editor/blocks.py makes them. A block shows its texture before a Rebuild the way the build will map it
// (geom.py: world-aligned faces, the sides of a cylinder wrapped round, the game's own scale per surface).
export const BLOCK_SHAPES = [['box', 'Cube'], ['wedge', 'Wedge'], ['cylinder', 'Cylinder'], ['cone', 'Cone'], ['sphere', 'Sphere'], ['dome', 'Dome']];
export const CYLINDER_SIDES = 16;
export const ROUND_SHAPES = ['cylinder', 'cone', 'sphere', 'dome'];
// sides, hollow (the wall's thickness, 0 solid), top (a cone's top radius share), align (as blocks.py options)
export function blockOptions(b) {
  const num = (k, d, lo, hi) => { const v = +b[k]; return Number.isFinite(v) && b[k] !== undefined && b[k] !== '' ? Math.max(lo, Math.min(hi, v)) : d; };
  return { sides: Math.round(num('sides', CYLINDER_SIDES, 3, 64)), hollow: num('hollow', 0, 0, 4096), top: num('top', 0, 0, 0.95), align: !!b.align };
}

// water, zone portals, moving blocks and signs are always boxes (as in blocks.py)
export function blockShape(b) {
  if (!b || b.mover || b.water || b.portal || b.sign) return 'box';
  return BLOCK_SHAPES.some(([k]) => k === b.shape) ? b.shape : 'box';
}
// its name in the Hierarchy: the blocks made before shapes existed stay "Block"
export function blockLabel(b) {
  if (!b || !b.shape) return 'Block';
  return BLOCK_SHAPES.find(([k]) => k === blockShape(b))[1];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const ringOf = (n, rx, ry, align) => Array.from({ length: n }, (_, i) => { const a = (align ? Math.PI / n : 0) + 2 * Math.PI * i / n; return [rx * Math.cos(a), ry * Math.sin(a)]; });
// a convex piece's faces from its points (blocks.py uses geom.hull): each plane with every point on one side
function hullFaces(pts) {
  const out = [], seen = new Set();
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) for (let k = j + 1; k < pts.length; k++) {
    let n = cross(sub(pts[j], pts[i]), sub(pts[k], pts[i]));
    if (Math.hypot(...n) < 1e-6) continue;
    n = norm(n);
    let d = dot(n, pts[i]);
    const side = pts.map((q) => dot(n, q) - d);
    if (side.every((v) => v >= -1e-3)) { n = n.map((c) => -c); d = -d; } else if (!side.every((v) => v <= 1e-3)) continue;
    const key = n.map((c) => Math.round(c * 1e4) / 1e4 || 0).join() + '|' + (Math.round(d * 100) / 100 || 0);   // as geom.hull's (no -0)
    if (seen.has(key)) continue;
    seen.add(key);
    const on = [...new Map(pts.filter((q) => Math.abs(dot(n, q) - d) < 1e-3).map((q) => [q.join(), q])).values()];
    const c = [0, 1, 2].map((a) => on.reduce((s, q) => s + q[a], 0) / on.length), ref = sub(on[0], c), other = cross(n, ref);
    on.sort((p1, p2) => Math.atan2(dot(sub(p1, c), other), dot(sub(p1, c), ref)) - Math.atan2(dot(sub(p2, c), other), dot(sub(p2, c), ref)));
    out.push({ n, pts: on });
  }
  return out;
}
// faces given as point lists, turned to face out from the middle of `all`
function outward(polys) {
  const all = polys.flat(), c = [0, 1, 2].map((a) => all.reduce((s, q) => s + q[a], 0) / all.length), out = [];
  for (let poly of polys) {
    let n = cross(sub(poly[1], poly[0]), sub(poly[2], poly[0]));
    if (Math.hypot(...n) < 1e-9) continue;
    const mid = [0, 1, 2].map((a) => poly.reduce((s, q) => s + q[a], 0) / poly.length);
    if (dot(n, sub(mid, c)) < 0) { poly = [...poly].reverse(); n = n.map((x) => -x); }
    out.push({ n: norm(n), pts: poly });
  }
  return out;
}
// a sphere's (or its top half's) rings of points, bottom to top, and the cells between them (blocks.py)
function sphereRings(c, r, n, dome) {
  const rings = dome ? Math.max(1, Math.floor(n / 4)) : Math.max(2, Math.floor(n / 2)), lat0 = dome ? 0 : -Math.PI / 2, out = [];
  for (let k = 0; k <= rings; k++) {
    const lat = lat0 + (Math.PI / 2 - lat0) * k / rings;
    if (Math.abs(Math.abs(lat) - Math.PI / 2) < 1e-9) { out.push([[c[0], c[1], c[2] + r[2] * Math.sin(lat)]]); continue; }
    out.push(Array.from({ length: n }, (_, i) => [c[0] + r[0] * Math.cos(lat) * Math.cos(2 * Math.PI * i / n), c[1] + r[1] * Math.cos(lat) * Math.sin(2 * Math.PI * i / n), c[2] + r[2] * Math.sin(lat)]));
  }
  return out;
}
function sphereCells(rings) {
  const cells = [];
  for (let k = 0; k + 1 < rings.length; k++) {
    const lo = rings[k], hi = rings[k + 1], n = Math.max(lo.length, hi.length);
    for (let i = 0; i < n; i++) {
      const cell = [lo[i % lo.length], lo[(i + 1) % lo.length], hi[(i + 1) % hi.length], hi[i % hi.length]];
      cells.push(cell.filter((q, j) => q !== cell[(j + 3) % 4]));
    }
  }
  return cells;
}
// [[z, s]] down a line of points from the top, s the distance from the top (blocks.py _meridian, _slant)
function meridian(pts) {
  let s = 0;
  return pts.map((p, k) => { if (k) s += Math.hypot(...sub(p, pts[k - 1])); return [p[2], s]; });
}
function slant(mer, z) {
  for (let k = 0; k + 1 < mer.length; k++) {
    const [z0, s0] = mer[k], [z1, s1] = mer[k + 1];
    if (z >= z1 - 1e-6 && z <= z0 + 1e-6) return Math.abs(z0 - z1) < 1e-9 ? s0 : s0 + (s1 - s0) * (z0 - z) / (z0 - z1);
  }
  return z < mer[mer.length - 1][0] ? mer[mer.length - 1][1] : 0;
}
// the sides' texture as one skin round the shape, band by band (blocks.py wrap_round): f.round for rounded()
function wrapRound(faces, outer, inner = null) {
  const bands = new Map();
  for (const f of faces) {
    const n = f.n, vs = f.pts;
    if (Math.abs(n[2]) > 0.999) continue;
    const h = norm([n[0], n[1], 0]);
    let best = null;
    vs.forEach((a, i) => {
      const e = vs[(i + 1) % vs.length];
      if (Math.abs(a[2] - e[2]) >= 1e-3) return;
      const len = Math.round(Math.hypot(...sub(e, a)) * 1000) / 1000;
      if (!best || len > best.len || (len === best.len && a[2] < best.a[2])) best = { a, e, len };     // the widest, the lower of two alike
    });
    if (!best) continue;
    const { a, e } = best, mid = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2], r = Math.hypot(...mid), along = mid[0] * h[0] + mid[1] * h[1];
    if (r < 1e-6 || Math.abs(along) < 0.5 * r) continue;                       // a wall between pieces
    const out = along > 0, u = norm(cross(h, [0, 0, 1]));
    let v = norm(cross(n, u));
    if (v[2] > 0) v = v.map((x) => -x);
    const P = dot(a, u) <= dot(e, u) ? a : e, above = vs.reduce((s, q) => s + q[2], 0) / vs.length > P[2], phi = Math.atan2(mid[1], mid[0]);
    const key = `${Math.round(P[2] * 10) / 10}|${out}|${above}`;
    if (!bands.has(key)) bands.set(key, []);
    bands.get(key).push({ order: out ? -phi : phi, f, u, v, P, w: Math.abs(dot(sub(e, a), u)), out });
  }
  for (const items of bands.values()) {
    items.sort((x, y) => x.order - y.order);
    const total = items.reduce((s, it) => s + it.w, 0);
    let cum = 0;
    for (const it of items) {
      it.f.round = { u: it.u, v: it.v, P: it.P, cum, total, cv: slant(it.out || !inner ? outer : inner, it.P[2]) };
      cum += it.w;
    }
  }
  return faces;
}
// a cylinder's, a cone's, a sphere's or a dome's faces about the block's centre (hollow: every piece's)
function roundFaces(shape, size, o) {
  const [hx, hy, hz] = size.map((v) => v / 2), h = o.hollow, hollow = h > 0 && h < Math.min(hx, hy), n = o.sides;
  if (shape === 'cylinder' || shape === 'cone') {
    const t = shape === 'cylinder' ? 1 : o.top, outer = ringOf(n, hx, hy, o.align);
    if (!hollow) {
      const bottom = outer.map(([x, y]) => [x, y, -hz]);
      if (t < 0.01) return wrapRound(outward([bottom, ...bottom.map((q, i) => [q, bottom[(i + 1) % n], [0, 0, hz]])]), meridian([[0, 0, hz], bottom[0]]));
      const top = outer.map(([x, y]) => [x * t, y * t, hz]);
      return wrapRound(outward([bottom, top, ...bottom.map((q, i) => [q, bottom[(i + 1) % n], top[(i + 1) % n], top[i]])]), meridian([top[0], bottom[0]]));
    }
    const inner = ringOf(n, hx - h, hy - h, o.align), out = [];
    let mers = [];
    for (let i = 0; i < n; i++) {
      const pts = [];
      for (const [ring, shrink] of [[outer, 0], [inner, h]]) for (const k of [i, (i + 1) % n]) {
        pts.push([ring[k][0], ring[k][1], -hz]);
        // the top ring: the bottom's scaled (flat faces), a hollow cone's wall as thick where it is narrowest
        const f = shrink === 0 ? t : Math.max(0, (Math.min(hx, hy) * t - h) / (Math.min(hx, hy) - h));
        pts.push([ring[k][0] * f, ring[k][1] * f, hz]);
      }
      out.push(...hullFaces(pts));
      if (i === 0) mers = [meridian([pts[1], pts[0]]), meridian([pts[5], pts[4]])];
    }
    return wrapRound(out, ...mers);
  }
  const dome = shape === 'dome', c = dome ? [0, 0, -hz] : [0, 0, 0], rz = dome ? 2 * hz : hz;
  const rings = sphereRings(c, [hx, hy, rz], n, dome);
  const down = (rs) => meridian(rs.slice().reverse().map((r) => r[0]));
  if (!hollow) { const polys = sphereCells(rings); if (dome) polys.push(rings[0]); return wrapRound(outward(polys), down(rings)); }
  const innerRings = sphereRings(c, [hx - h, hy - h, Math.max(1, rz - h)], n, dome), inner = sphereCells(innerRings), out = [];
  sphereCells(rings).forEach((cell, i) => out.push(...hullFaces([...new Map([...cell, ...inner[i]].map((q) => [q.join(), q])).values()])));
  return wrapRound(out, down(rings), down(innerRings));
}

// the faces about the block's centre, in the game's axes (outward normals)
function faces(shape, size, b = {}) {
  const [hx, hy, hz] = size.map((v) => v / 2);
  const o = blockOptions(b);
  if (shape === 'cone' || shape === 'sphere' || shape === 'dome' || (shape === 'cylinder' && (o.hollow > 0 && o.hollow < Math.min(hx, hy)))) return roundFaces(shape, size, o);
  if (shape === 'wedge') return [
    { n: [0, 0, -1], pts: [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]] },
    { n: [1, 0, 0], pts: [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]] },
    { n: norm([-size[2], 0, size[0]]), pts: [[-hx, -hy, -hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, -hz]] },
    { n: [0, -1, 0], pts: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]] },
    { n: [0, 1, 0], pts: [[-hx, hy, -hz], [hx, hy, hz], [hx, hy, -hz]] },
  ];
  if (shape === 'cylinder') {
    const N = o.sides, ring = ringOf(N, hx, hy, o.align);
    const out = [
      { n: [0, 0, -1], pts: ring.slice().reverse().map(([x, y]) => [x, y, -hz]) },
      { n: [0, 0, 1], pts: ring.map(([x, y]) => [x, y, hz]) },
    ];
    // the sides: the texture runs round them clockwise from ring[1] (geom.wrap_vertical's chain)
    const side = [];
    for (let i = 0; i < N; i++) {
      const a = ring[i], b = ring[(i + 1) % N], d = norm([b[0] - a[0], b[1] - a[1], 0]);
      side.push({ n: [d[1], -d[0], 0], pts: [[a[0], a[1], -hz], [b[0], b[1], -hz], [b[0], b[1], hz], [a[0], a[1], hz]],
        wrap: { start: [b[0], b[1], 0], u: norm([a[0] - b[0], a[1] - b[1], 0]), w: Math.hypot(a[0] - b[0], a[1] - b[1]) } });
    }
    let cum = 0;
    for (const i of [0, ...Array.from({ length: N - 1 }, (_, k) => N - 1 - k)]) { side[i].wrap.cum = cum; cum += side[i].wrap.w; }
    return out.concat(side);
  }
  return [
    { n: [-1, 0, 0], pts: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { n: [1, 0, 0], pts: [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]] },
    { n: [0, -1, 0], pts: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
    { n: [0, 1, 0], pts: [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]] },
    { n: [0, 0, -1], pts: [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]] },
    { n: [0, 0, 1], pts: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
  ];
}

// geom.mapping for a face of normal n: U and V in world units per repeat (tile: {wall, floor, ceiling})
function planar(n, tile) {
  const a = n.map(Math.abs);
  let u, v;
  if (a[2] >= Math.max(a[0], a[1]) - 1e-6) { u = [1, 0, 0]; v = n[2] > 0 ? [0, 1, 0] : [0, -1, 0]; }
  else {
    const h = norm([n[0], n[1], 0]);
    u = norm(cross(h, [0, 0, 1]));
    v = [0, 0, -1];
    if (a[2] > 1e-6 && a[2] < 0.999) { v = norm(cross(n, u)); if (v[2] > 0) v = v.map((x) => -x); }
  }
  const [su, sv] = tile[n[2] > 0.7 ? 'floor' : n[2] < -0.7 ? 'ceiling' : 'wall'];
  return (P) => [dot(P, u) / su, -dot(P, v) / sv];
}
// a round shape's side (wrapRound): a whole number of repeats round its band, V down from the top
function rounded(f, c, tile) {
  const [su0, sv] = tile.wall, R = f.round, su = R.total > 1e-6 ? R.total / Math.max(1, Math.round(R.total / su0)) : su0;
  const P = [R.P[0] + c[0], R.P[1] + c[1], R.P[2] + c[2]];
  return (X) => [(R.cum + dot(sub(X, P), R.u)) / su, -(R.cv + dot(sub(X, P), R.v)) / sv];
}
function wrapped(f, c, tile) {
  const [su, sv] = tile.wall, s = [c[0] + f.wrap.start[0], c[1] + f.wrap.start[1], 0];
  return (P) => [(f.wrap.cum + dot(sub([P[0], P[1], 0], s), f.wrap.u)) / su, P[2] / sv];
}

// the block's geometry in the proxy's own space (a unit block, scaled by its size), with the texture
// coordinates of the game when tile is given
export function blockGeometry(THREE, b, tile = null) {
  const size = [0, 1, 2].map((k) => Math.max(1, b.hi[k] - b.lo[k])), c = [0, 1, 2].map((k) => (b.lo[k] + b.hi[k]) / 2);
  const pos = [], uv = [];
  const three = (p) => [p[0] / size[0], p[2] / size[2], p[1] / size[1]];
  for (const f of faces(blockShape(b), size, b)) {
    const uvOf = tile ? (f.round ? rounded(f, c, tile) : f.wrap ? wrapped(f, c, tile) : planar(f.n, tile)) : () => [0, 0];
    const q = f.pts.map(three);
    // the winding that faces out in three.js (its axes are the game's mirrored)
    const n3 = [f.n[0], f.n[2], f.n[1]], flip = dot(cross(sub(q[1], q[0]), sub(q[2], q[0])), n3) < 0;
    for (let i = 1; i + 1 < q.length; i++) for (const k of flip ? [0, i + 1, i] : [0, i, i + 1]) {
      pos.push(...q[k]);
      uv.push(...uvOf(f.pts[k].map((x, j) => x + c[j])));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
