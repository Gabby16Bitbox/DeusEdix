// Tools > Draw wall / road / floor / ceiling: click points on the map, Enter (or click the first point again, or
// double-click) to finish. edits.drawn = [{name, kind, pts: [[x, y], ...], z, closed, ...settings}] in Unreal
// units; editor/drawn.py makes the brushes at Rebuild from the same numbers (DRAW_DEFAULTS mirrors DEFAULTS there).
// Shown here like the blocks: a translucent volume with its edges, dressed (dress(g), app.js) with its textures as the
// build will map them until a Rebuild, the real surfaces after it.
// Stairs and roofs (20 Oct 2026): two clicks, A and B, each at its own height (B is `rise` above A); B snaps onto
// the floor of a ledge near it. While drawing: [ and ] make them narrower or wider, , and . lower or raise the
// steps. stairParts/roofParts are drawn.py's stair_parts/roof_parts in JavaScript (tests/test_drawn_stairs.py).
import { createRotations } from './rotation.js';
export const DRAW_DEFAULTS = {
  wall: { height: 160, thick: 16, tex: 'graycncrtwall_a' },
  road: { width: 256, walk: 96, curb: 8, tex: 'RoadBlacktop__C', walkTex: 'grungysdwlk_a', curbTex: 'ClenGreyCncrt_B' },
  floor: { lift: 2, thick: 16, tex: 'flatconcrete_a', edgeTex: 'ClenGreyCncrt_B' },
  ceiling: { height: 160, thick: 16, underTex: 'WhitCeilnTile_B', tex: 'flatconcrete_a', edgeTex: 'ClenGreyCncrt_B' },
  stairs: { shape: 'straight', form: 'steps', width: 128, riser: 16, curve: 90, turn: 'left', inner: 32, per360: 16,
    base: 'solid', thick: 16, landing: 0, column: 1, tex: 'ClenGreyStair_A', riserTex: 'SB_StairFrnt_A', sideTex: 'flatconcrete_a' },
  roof: { shape: 'shed', width: 256, pitch: 30, thick: 16, tex: 'ClayBrwnRoofT_A', underTex: 'flatconcrete_a', sideTex: 'flatconcrete_a' },
};
export const STAIR_STYLES = {
  concrete: { tex: 'ClenGreyStair_A', riserTex: 'SB_StairFrnt_A', sideTex: 'flatconcrete_a' },
  metal: { tex: 'HevyMetlGrate_B', riserTex: 'ClenGrayMetal_B', sideTex: 'StanGrayMetal_A' },
  marble: { tex: 'ClenGreyStair_B', riserTex: 'whitemarble_brk', sideTex: 'whitemarble_brk' },
  industrial: { tex: 'Uob_StairTop', riserTex: 'mp_StairFront', sideTex: 'sub_beam_b' },
};
export const DRAW_LABELS = { wall: 'Wall', road: 'Road', floor: 'Floor', ceiling: 'Ceiling', stairs: 'Stairs', roof: 'Roof' };
const TWO_CLICKS = new Set(['stairs', 'roof']);
const HELP = {
  wall: 'Click the floor point after point along the wall. Enter or double-click ends it; click its first point to close a room.',
  road: 'Click the ground along the middle of the road. Enter or double-click ends it.',
  floor: 'Click the corners of the floor all round, then click the first one again (or Enter).',
  ceiling: 'Click the corners of the room on its floor, then the first one again (or Enter). The ceiling goes on top of walls of its Height.',
  stairs: 'Click where they start, then where they arrive (an upper floor: near its edge they snap onto it). [ ] narrower or wider, , . lower or higher steps; the Inspector makes them curved or a spiral.',
  roof: 'Click the eave, then the ridge (the top of the slope). [ ] narrower or wider.',
};
const COLORS = { wall: 0xd9c49b, road: 0x7b8594, floor: 0x9fb4d9, ceiling: 0xd99f9f, stairs: 0xb7d99f, roof: 0xd9a37b };
const ROAD_LIFT = 2;
const CLOSING = 32;                   // a click this close to the first point closes the shape
const SLIVER = 32;                    // how long the shape under the cursor is before the first click

export function settingsOf(p) {
  const out = { ...DRAW_DEFAULTS[p.kind] };
  for (const k of Object.keys(out)) if (p[k] !== undefined && p[k] !== '') out[k] = typeof out[k] === 'number' ? Math.max(0, Math.min(8192, +p[k] || 0)) : p[k];
  return out;
}
const area = (r) => r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2;
function clean(pts, closed) {
  const out = [];
  for (const p of pts) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 1) out.push([+p[0], +p[1]]);
  if (closed && out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1) out.pop();
  return out;
}
// the polyline moved sideways by d (positive: to its left), corners mitred (as drawn.py offset)
function offset(pts, d, closed) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const prev = closed || i > 0 ? pts[(i - 1 + n) % n] : null, next = closed || i < n - 1 ? pts[(i + 1) % n] : null;
    const normals = [];
    for (const [a, b] of [[prev, pts[i]], [pts[i], next]]) {
      if (!a || !b) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      normals.push([-dy / L, dx / L]);
    }
    if (normals.length === 1) { out.push([pts[i][0] + normals[0][0] * d, pts[i][1] + normals[0][1] * d]); continue; }
    const [[ax, ay], [bx, by]] = normals;
    let mx = ax + bx, my = ay + by;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { out.push([pts[i][0] + ax * d, pts[i][1] + ay * d]); continue; }
    mx /= ml; my /= ml;
    const k = d / Math.max(0.25, mx * ax + my * ay);
    out.push([pts[i][0] + mx * k, pts[i][1] + my * k]);
  }
  return out;
}
function strips(pts, closed, d0, d1) {
  const a = offset(pts, d0, closed), b = offset(pts, d1, closed), n = pts.length, out = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) out.push([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]]);
  return out;
}
// ------------------------------------------------------------------ stairs and roofs (drawn.py's arithmetic)
const ccw = (r) => (area(r) >= 0 ? r : [...r].reverse());
const unit3 = (v) => { const L = Math.hypot(...v) || 1; return v.map((c) => c / L); };
function ends(p) {
  const pts = p.pts || [];
  if (pts.length < 2) return null;
  const z = +p.z || 0;
  return [[+pts[0][0], +pts[0][1], z], [+pts[1][0], +pts[1][1], z + (+p.rise || 0)]];
}
export function stairParts(p) {
  const s = settingsOf(p), e = ends(p);
  if (!e) return [];
  let [[ax, ay, az], [bx, by, bz]] = e;
  const shape = ['straight', 'curved', 'spiral'].includes(s.shape) ? s.shape : 'straight';
  const half = Math.max(8, s.width) / 2, riser = Math.max(4, s.riser);
  if (shape === 'spiral') return spiral(s, [ax, ay, az], [bx, by, bz], riser);
  if (bz < az) [[ax, ay, az], [bx, by, bz]] = [[bx, by, bz], [ax, ay, az]];
  const rise = bz - az, dx = bx - ax, dy = by - ay, chord = Math.hypot(dx, dy);
  if (chord < 1) return [];
  const ramp = s.form === 'ramp' || rise < riser / 2;
  const n = ramp ? 1 : Math.max(1, Math.round(rise / riser)), h = rise / n;
  const out = [];
  if (shape === 'curved' && s.curve >= 1) {
    const th = Math.min(s.curve, 359) * Math.PI / 180 * (s.turn !== 'right' ? 1 : -1);
    const R = chord / (2 * Math.sin(Math.abs(th) / 2)), nx = -dy / chord, ny = dx / chord, side = th > 0 ? 1 : -1;
    const k = R * Math.cos(Math.abs(th) / 2) * side, ox = (ax + bx) / 2 + nx * k, oy = (ay + by) / 2 + ny * k;
    const a0 = Math.atan2(ay - oy, ax - ox), arc = Math.abs(th) * R, land = Math.min(s.landing, arc * 0.8);
    const segs = ramp ? Math.max(n, Math.ceil(Math.abs(th) / (12 * Math.PI / 180))) : n;
    const at = (t, r) => { const a = a0 + th * t; return [ox + Math.cos(a) * r, oy + Math.sin(a) * r]; };
    const tangent = (t) => { const a = a0 + th * t; return [-Math.sin(a) * side, Math.cos(a) * side]; };
    const stepsT = (arc - land) / arc, rin = Math.max(0, R - half), rout = R + half;
    for (let i = 0; i < segs; i++) {
      const t0 = stepsT * i / segs, t1 = i === segs - 1 ? 1 : stepsT * (i + 1) / segs;
      const run = tangent((t0 + Math.min(t1, stepsT)) / 2), w = [-run[1], run[0]], nose = at(t0, R);
      if (ramp) {
        const z0 = az + rise * i / segs, z1 = i === segs - 1 ? bz : az + rise * (i + 1) / segs;
        const top = [[...at(t0, rin), z0], [...at(t0, rout), z0], [...at(t1, rout), z1], [...at(t1, rin), z1]];
        const low = top.map(([x, y, zz]) => [x, y, s.base === 'solid' ? az : zz - s.thick]);
        out.push({ pts: [...top, ...low], run, w, up: unit3([run[0] * arc / segs, run[1] * arc / segs, z1 - z0]), anchor: [nose[0], nose[1], z0] });
      } else {
        const top = az + (i + 1) * h;
        out.push({ poly: ccw([at(t0, rin), at(t0, rout), at(t1, rout), at(t1, rin)]), z0: s.base === 'solid' ? az : top - s.thick, z1: top, run, w, nose, top });
      }
    }
    return out;
  }
  const ux = dx / chord, uy = dy / chord, wx = -uy, wy = ux, land = Math.min(s.landing, chord * 0.8), runlen = chord - land;
  if (ramp) {
    const A0 = [[ax - wx * half, ay - wy * half], [ax + wx * half, ay + wy * half]];
    const B0 = [[ax + ux * runlen - wx * half, ay + uy * runlen - wy * half], [ax + ux * runlen + wx * half, ay + uy * runlen + wy * half]];
    const top = [[...A0[0], az], [...A0[1], az], [...B0[1], bz], [...B0[0], bz]];
    const low = top.map(([x, y, zz]) => [x, y, s.base === 'solid' ? az : zz - s.thick]);
    out.push({ pts: [...top, ...low], run: [ux, uy], w: [wx, wy], up: unit3([ux * runlen, uy * runlen, rise]), anchor: [ax, ay, az] });
    if (land > 0.5) out.push({ poly: ccw([B0[0], [bx - wx * half, by - wy * half], [bx + wx * half, by + wy * half], B0[1]]), z0: s.base === 'solid' ? az : bz - s.thick, z1: bz,
      run: [ux, uy], w: [wx, wy], nose: [(B0[0][0] + B0[1][0]) / 2, (B0[0][1] + B0[1][1]) / 2], top: bz });
    return out;
  }
  const t = runlen / n;
  for (let i = 0; i < n; i++) {
    const s0 = i * t, s1 = i === n - 1 ? chord : (i + 1) * t, top = az + (i + 1) * h;
    const ring = [[ax + ux * s0 - wx * half, ay + uy * s0 - wy * half], [ax + ux * s1 - wx * half, ay + uy * s1 - wy * half],
      [ax + ux * s1 + wx * half, ay + uy * s1 + wy * half], [ax + ux * s0 + wx * half, ay + uy * s0 + wy * half]];
    out.push({ poly: ccw(ring), z0: s.base === 'solid' ? az : top - s.thick, z1: top, run: [ux, uy], w: [wx, wy], nose: [ax + ux * s0, ay + uy * s0], top });
  }
  return out;
}
function spiral(s, [cx, cy, cz], b, riser) {
  const rout = Math.hypot(b[0] - cx, b[1] - cy);
  if (rout < 24) return [];
  let rise = b[2] - cz;
  if (Math.abs(rise) < riser / 2) return [];
  const up = rise > 0 ? 1 : -1;
  rise = Math.abs(rise);
  const rin = Math.min(s.inner, rout - 16), per = Math.max(4, Math.round(s.per360)), n = Math.max(1, Math.round(rise / riser)), h = rise / n;
  const d = 2 * Math.PI / per * (s.turn !== 'right' ? 1 : -1), end = Math.atan2(b[1] - cy, b[0] - cx), side = d > 0 ? 1 : -1;
  const base = up > 0 ? cz : cz - rise, mid = (rin + rout) / 2, out = [];
  for (let i = 0; i < n; i++) {
    const a1 = end - d * (n - 1 - i), a0 = a1 - d, top = base + (i + 1) * h, am = (a0 + a1) / 2;
    const ring = [[a0, rin], [a0, rout], [a1, rout], [a1, rin]].map(([a, r]) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    const run = [-Math.sin(am) * side, Math.cos(am) * side];
    out.push({ poly: ccw(ring), z0: top - Math.max(2, s.thick), z1: top, run, w: [-run[1], run[0]], nose: [cx + Math.cos(a0) * mid, cy + Math.sin(a0) * mid], top });
  }
  if (s.column && rin >= 4) out.push({ poly: Array.from({ length: 12 }, (_, k) => [cx + Math.cos(2 * Math.PI * k / 12) * rin, cy + Math.sin(2 * Math.PI * k / 12) * rin]), z0: base, z1: base + rise, column: true });
  return out;
}
export function roofParts(p) {
  const s = settingsOf(p), e = ends(p);
  if (!e) return [];
  const [[ax, ay, az], [bx, by, bz]] = e, dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  if (L < 1) return [];
  const ux = dx / L, uy = dy / L, wx = -uy, wy = ux, half = Math.max(8, s.width) / 2;
  let rise = bz - az;
  if (Math.abs(rise) < 8) rise = L * Math.tan(Math.max(1, Math.min(80, s.pitch)) * Math.PI / 180);
  const out = [];
  for (const sgn of s.shape !== 'gable' ? [1] : [1, -1]) {
    const eave = sgn > 0 ? [ax, ay] : [ax + ux * 2 * L, ay + uy * 2 * L], r = [ax + ux * L, ay + uy * L];
    const top = [[eave[0] - wx * half, eave[1] - wy * half, az], [eave[0] + wx * half, eave[1] + wy * half, az],
      [r[0] + wx * half, r[1] + wy * half, az + rise], [r[0] - wx * half, r[1] - wy * half, az + rise]];
    const run = [ux * sgn, uy * sgn];
    out.push({ pts: [...top.map(([x, y, z]) => [x, y, z + s.thick]), ...top], run, w: [wx * sgn, wy * sgn], up: unit3([run[0] * L, run[1] * L, rise]), anchor: [r[0], r[1], az + rise + s.thick] });
  }
  return out;
}
// the faces of a convex point set (a ramp, a roof slope): each plane with every point on one side
function hullTriangles(pts) {
  const tris = [], seen = new Set(), sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) for (let k = j + 1; k < pts.length; k++) {
    let n = cross(sub(pts[j], pts[i]), sub(pts[k], pts[i]));
    const L = Math.hypot(...n);
    if (L < 1e-6) continue;
    n = n.map((c) => c / L);
    let d = dot(n, pts[i]);
    const side = pts.map((q) => dot(n, q) - d);
    if (side.every((v) => v >= -1e-3)) { n = n.map((c) => -c); d = -d; } else if (!side.every((v) => v <= 1e-3)) continue;
    const key = n.map((c) => Math.round(c * 1e4) / 1e4 || 0).join() + '|' + (Math.round(d * 100) / 100 || 0);   // as geom.hull's (no -0)
    if (seen.has(key)) continue;
    seen.add(key);
    const on = pts.filter((q) => Math.abs(dot(n, q) - d) < 1e-3), c = on.reduce((a, q) => [a[0] + q[0] / on.length, a[1] + q[1] / on.length, a[2] + q[2] / on.length], [0, 0, 0]);
    const ref = sub(on[0], c), other = cross(n, ref);
    on.sort((p1, p2) => Math.atan2(dot(sub(p1, c), other), dot(sub(p1, c), ref)) - Math.atan2(dot(sub(p2, c), other), dot(sub(p2, c), ref)));
    for (let m = 1; m + 1 < on.length; m++) tris.push([on[0], on[m], on[m + 1]]);
  }
  return tris;
}

// the volumes of a path: [{poly: [[x, y]...], z0, z1, tone}]
export function volumes(p) {
  if (p.kind === 'stairs' || p.kind === 'roof') {
    return (p.kind === 'stairs' ? stairParts(p) : roofParts(p)).map((q, i) => (q.pts ? { pts: q.pts, tone: 1 } : { poly: q.poly, z0: q.z0, z1: q.z1, tone: q.column ? 0.7 : 0.9 + 0.2 * (i % 2) }));
  }
  const s = settingsOf(p), z = +p.z || 0, closed = !!p.closed || p.kind === 'floor' || p.kind === 'ceiling';
  const pts = clean(p.pts || [], closed), out = [];
  if (p.kind === 'wall') {
    if (pts.length < 2) return out;
    for (const q of strips(pts, closed, -s.thick / 2, s.thick / 2)) out.push({ poly: q, z0: z, z1: z + s.height });
  } else if (p.kind === 'road') {
    if (pts.length < 2) return out;
    const half = s.width / 2;
    if (half > 0) for (const q of strips(pts, closed, -half, half)) out.push({ poly: q, z0: z - 2, z1: z + ROAD_LIFT, tone: 0.75 });
    if (s.walk > 0 && s.curb > 0) for (const [d0, d1] of [[half, half + s.walk], [-half - s.walk, -half]])
      for (const q of strips(pts, closed, d0, d1)) out.push({ poly: q, z0: z - 2, z1: z + s.curb, tone: 1.1 });
  } else {
    if (pts.length < 3) return out;
    const ring = area(pts) < 0 ? [...pts].reverse() : pts;
    if (p.kind === 'floor') out.push({ poly: ring, z0: z + s.lift - s.thick, z1: z + s.lift });
    else out.push({ poly: ring, z0: z + s.height, z1: z + s.height + s.thick });       // a ceiling
  }
  return out;
}

// before the first click: a sliver of what the tool makes, where the cursor is, so it shows the tool has started (a wall
// as long as it is thick, a slice of the road, a tile of the floor or the ceiling, the first step, a roof's eave)
function sliverOf(kind, [x, y], z, opts) {
  const s = settingsOf({ kind, ...opts }), h = SLIVER / 2;
  const across = (len) => [[x - len / 2, y], [x + len / 2, y]];
  if (kind === 'wall') return { kind, pts: across(Math.max(4, s.thick)), z, ...opts };
  if (kind === 'road') return { kind, pts: across(SLIVER), z, ...opts };
  if (kind === 'floor' || kind === 'ceiling') return { kind, pts: [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]], z, ...opts };
  return { kind, pts: [[x, y], [x + SLIVER, y]], z, rise: kind === 'stairs' ? s.riser : 0, ...opts };
}

// ------------------------------------------------------------------ the module
export function createDrawTools({ THREE, T, scene, getEdits, status, escapeHtml, getSnap, texList, probe, dress }) {
  const rotations = createRotations(THREE);
  let session = null;                 // {kind, pts, z, hover}
  const preview = new THREE.Group();
  scene.add(preview);
  const centroid = (p) => {
    const pts = p.pts || [];
    const c = pts.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]).map((v) => v / Math.max(1, pts.length));
    return [c[0], c[1], +p.z || 0];
  };
  // a THREE object of the path's volumes, its coordinates relative to `origin` (Unreal [x, y, z])
  function meshOf(p, origin, opacity = 0.28) {
    const g = new THREE.Group(), color = new THREE.Color(COLORS[p.kind] || 0xcccccc);
    // Unreal (x, y, z) -> three (x, z, y) around the origin
    const V = (x, y, zz) => new THREE.Vector3(x - origin[0], zz - origin[2], y - origin[1]);
    const add = (positions, tone = 1) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(tone), transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
      g.add(new THREE.Mesh(geo, mat));
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: 0xe8edf5 })));
    };
    for (const v of volumes(p)) {
      const pos = [];
      const push = (...vs) => { for (const q of vs) pos.push(q.x, q.y, q.z); };
      if (v.pts) {                                   // a convex shape (a ramp, a roof slope)
        for (const tri of hullTriangles(v.pts)) push(...tri.map((q) => V(q[0], q[1], q[2])));
        add(pos, v.tone || 1);
        continue;
      }
      const ring = v.poly, n = ring.length;
      // top and bottom: triangulated (THREE's ear clipping), the sides as quads
      const tris = THREE.ShapeUtils.triangulateShape(ring.map((q) => new THREE.Vector2(q[0], q[1])), []);
      for (const [i, j, k] of tris) {
        push(V(ring[i][0], ring[i][1], v.z1), V(ring[j][0], ring[j][1], v.z1), V(ring[k][0], ring[k][1], v.z1));
        push(V(ring[i][0], ring[i][1], v.z0), V(ring[k][0], ring[k][1], v.z0), V(ring[j][0], ring[j][1], v.z0));
      }
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        push(V(a[0], a[1], v.z0), V(b[0], b[1], v.z0), V(b[0], b[1], v.z1), V(a[0], a[1], v.z0), V(b[0], b[1], v.z1), V(a[0], a[1], v.z1));
      }
      add(pos, v.tone || 1);
    }
    return g;
  }
  function proxy(p) {
    const c = centroid(p), g = new THREE.Group();
    g.add(meshOf(p, c));
    g.position.copy(T(c));
    g.quaternion.copy(rotations.quat(p.rot));
    g.userData = { drawn: p, source: 'drawn', kind: 'drawn', origin: c };
    dress?.(g);
    return g;
  }
  // the proxy drawn again after a change of its settings (same object, same selection)
  function refresh(g) {
    const p = g.userData.drawn, c = centroid(p);
    for (const ch of [...g.children]) { g.remove(ch); ch.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); }
    g.add(meshOf(p, c));
    g.position.copy(T(c)); g.quaternion.copy(rotations.quat(p.rot));
    g.userData.origin = c;
    dress?.(g);
  }
  // the gizmo moved or turned it: its points follow (about the point it was shown at)
  function commitMove(g) {
    const p = g.userData.drawn, o = g.userData.origin;
    const pos = g.position, nc = [pos.x, pos.z, pos.y];
    const r1 = (v) => Math.round(v * 10) / 10;
    // three's turn about +y moves (x, z) to (x cos + z sin, -x sin + z cos); Unreal's (x, y) are three's (x, z)
    p.pts = p.pts.map(([x, y]) => [r1(x + nc[0] - o[0]), r1(y + nc[1] - o[1])]);
    p.rot = rotations.rot(g.quaternion);
    p.z = r1(nc[2]);
    refresh(g);
  }
  // ---------------------------------------------------------------- drawing
  function snapPoint(q, shift) {
    let [x, y] = q;
    if (getSnap()) { x = Math.round(x / 8) * 8; y = Math.round(y / 8) * 8; }
    if (session && session.pts.length) {
      const f = session.pts[0];
      if (session.pts.length > 1 && Math.hypot(x - f[0], y - f[1]) < CLOSING) return { pt: [f[0], f[1]], closes: true };
      if (shift) {                       // Shift: the angle in steps of 45 degrees from the last point
        const l = session.pts[session.pts.length - 1], dx = x - l[0], dy = y - l[1], L = Math.hypot(dx, dy);
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        x = l[0] + Math.cos(a) * L; y = l[1] + Math.sin(a) * L;
        if (getSnap()) { x = Math.round(x / 8) * 8; y = Math.round(y / 8) * 8; }
      }
    }
    return { pt: [x, y], closes: false };
  }
  function showPreview() {
    for (const ch of [...preview.children]) { preview.remove(ch); ch.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); }
    if (!session) return;
    const pts = session.hover && !session.hover.closes ? [...session.pts, session.hover.pt] : [...session.pts];
    const closing = session.hover?.closes;
    const p = { kind: session.kind, pts, z: session.z, closed: closing && (session.kind === 'wall' || session.kind === 'road'), ...session.opts };
    if (TWO_CLICKS.has(session.kind) && session.hover) p.rise = Math.round((session.hover.z - session.z) * 10) / 10;
    if (pts.length >= 2) { const m = meshOf(p, [0, 0, 0], 0.4); preview.add(m); }
    else if (!session.pts.length && session.hover) preview.add(meshOf(sliverOf(session.kind, session.hover.pt, session.z, session.opts), [0, 0, 0], 0.4));
    // the points clicked, the first one bigger (click it to close the shape)
    session.pts.forEach((q, i) => {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(i === 0 ? 7 : 5, 10, 8), new THREE.MeshBasicMaterial({ color: i === 0 && closing ? 0x5aff8a : 0xffd25a, depthTest: false }));
      dot.position.copy(T([q[0], q[1], session.z + 2]));
      dot.renderOrder = 10;
      preview.add(dot);
    });
  }
  function begin(kind) {
    session = { kind, pts: [], z: 0, hover: null, opts: {} };
    showPreview();
    status(`${DRAW_LABELS[kind]}: ${HELP[kind]} Backspace removes the last point, Esc cancels.`);
  }
  // B of stairs and roofs: onto the floor of a ledge near it (probe: app.js, rays down round the point)
  function onLedge(ue, up) {
    if (!TWO_CLICKS.has(session.kind) || !session.pts.length || up || !probe) return ue;
    return probe(ue, 48) || ue;
  }
  function hover(ue, shift, up) {
    if (!session) return;
    if (!ue) { session.hover = null; showPreview(); return; }
    if (!session.pts.length) session.z = ue[2];
    ue = onLedge(ue, up);
    session.hover = { ...snapPoint(ue, shift), z: ue[2] };
    showPreview();
  }
  // while drawing stairs or a roof: [ ] narrower / wider, , . lower / higher steps (true: the key was used)
  function key(k) {
    if (!session || !TWO_CLICKS.has(session.kind)) return false;
    const s = { ...settingsOf({ kind: session.kind, ...session.opts }) };
    if (k === '[' || k === ']') session.opts.width = Math.max(32, Math.min(2048, s.width + (k === ']' ? 16 : -16)));
    else if ((k === ',' || k === '.') && session.kind === 'stairs') session.opts.riser = Math.max(6, Math.min(32, s.riser + (k === '.' ? 2 : -2)));
    else return false;
    showPreview();
    status(`${DRAW_LABELS[session.kind]}: ${session.opts.width || s.width} wide${session.kind === 'stairs' ? `, steps about ${session.opts.riser || s.riser} high` : ''}. ${HELP[session.kind]}`);
    return true;
  }
  // one more point; 'done' when the shape is finished (its first point clicked again, or a double-click)
  function addPoint(ue, shift, up) {
    if (!session) return null;
    if (!session.pts.length) session.z = Math.round(ue[2] * 10) / 10;
    if (TWO_CLICKS.has(session.kind)) {             // A, then B (its height too): done
      ue = onLedge(ue, up);
      const { pt } = snapPoint(ue, shift);
      if (session.pts.length && Math.hypot(pt[0] - session.pts[0][0], pt[1] - session.pts[0][1]) < 8) return null;
      session.pts.push(pt);
      if (session.pts.length === 2) { session.rise = Math.round((ue[2] - session.z) * 10) / 10; return 'done'; }
      showPreview();
      status(`${DRAW_LABELS[session.kind]}: now click where ${session.kind === 'stairs' ? 'they arrive' : 'the ridge is'}. ${HELP[session.kind]}`);
      return null;
    }
    const { pt, closes } = snapPoint(ue, shift);
    if (closes) { session.closed = true; return 'done'; }
    const last = session.pts[session.pts.length - 1];
    if (last && Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 4) return 'done';          // a double-click
    session.pts.push(pt);
    showPreview();
    status(`${DRAW_LABELS[session.kind]}: ${session.pts.length} point${session.pts.length > 1 ? 's' : ''}. Enter or double-click ends it${session.kind !== 'road' ? ', click the first point to close it' : ''}; Backspace removes the last point.`);
    return null;
  }
  function undoPoint() {
    if (!session || !session.pts.length) return;
    session.pts.pop();
    showPreview();
  }
  // the finished path (not yet in the edits), or null with the reason in the status bar
  function finish(names) {
    if (!session) return null;
    const s = session;
    session = null;
    showPreview();
    const need = s.kind === 'floor' || s.kind === 'ceiling' ? 3 : 2;
    if (s.pts.length < need) { status(`${DRAW_LABELS[s.kind]}: it needs at least ${need} points. Nothing was made.`, 'warn'); return null; }
    let i = 0;
    while (names.has('UCDrawn' + i)) i++;
    const p = { name: 'UCDrawn' + i, kind: s.kind, pts: s.pts, z: s.z };
    if (s.closed && (s.kind === 'wall' || s.kind === 'road')) p.closed = true;
    if (TWO_CLICKS.has(s.kind)) Object.assign(p, s.opts, s.rise ? { rise: s.rise } : {});
    return p;
  }
  function cancel() { session = null; showPreview(); }
  // ---------------------------------------------------------------- the Inspector
  const FIELDS = {
    wall: [['height', 'Height', 'From the ground to its top'], ['thick', 'Thickness', 'Deus Ex walls: 16'], ['tex', 'Texture']],
    road: [['width', 'Width', 'The carriageway (two lanes: 256)'], ['walk', 'Sidewalk', 'Each side (0: none)'], ['curb', 'Curb height', 'How high the sidewalk stands'],
      ['tex', 'Road texture'], ['walkTex', 'Sidewalk texture'], ['curbTex', 'Curb texture']],
    floor: [['lift', 'Height', 'Its top above the ground where you drew it'], ['thick', 'Thickness'], ['tex', 'Texture'], ['edgeTex', 'Edge texture', 'Its sides and underside']],
    ceiling: [['height', 'Height', 'Its underside above the floor: the height of the walls'], ['thick', 'Thickness'], ['underTex', 'Ceiling texture', 'Seen from inside the room'],
      ['tex', 'Top texture', 'Seen from above (an upper floor)'], ['edgeTex', 'Edge texture']],
    stairs: [['shape', 'Shape', 'Straight from A to B, curved on the way, or a spiral round A'], ['form', 'Form', 'Steps, or a smooth ramp'],
      ['width', 'Width', 'Deus Ex: 128'], ['riser', 'Step height', 'About how high each step is (Deus Ex: 16); the steps share the height exactly. A player climbs up to 24'],
      ['curve', 'Curve', 'Degrees the curved stairs turn'], ['turn', 'Turns', 'Which way a curve or a spiral turns going up'],
      ['inner', 'Inner radius', 'Spiral: the hole (or the column) in the middle'], ['per360', 'Steps a turn', 'Spiral: steps in a whole turn'],
      ['column', 'Column', 'Spiral: a column in the middle'], ['base', 'Base', 'Solid down to the floor (as the game), or floating steps'],
      ['thick', 'Step thickness', 'Floating steps and spirals'], ['landing', 'Landing', 'A flat part at the top this long'],
      ['tex', 'Tread texture'], ['riserTex', 'Riser texture', 'The front of each step'], ['sideTex', 'Side texture']],
    roof: [['shape', 'Shape', 'One slope, or two (a gable): the second beyond the ridge'], ['width', 'Width', 'Along the ridge'],
      ['pitch', 'Pitch', 'Degrees of the slope when A and B are on one level'], ['thick', 'Thickness'],
      ['tex', 'Roof texture'], ['underTex', 'Underside texture'], ['sideTex', 'Edge texture']],
  };
  const SELECTS = { shape: { stairs: ['straight', 'curved', 'spiral'], roof: ['shed', 'gable'] }, form: ['steps', 'ramp'], turn: ['left', 'right'], base: ['solid', 'floating'] };
  const ONLY = { curve: ['curved'], inner: ['spiral'], per360: ['spiral'], column: ['spiral'], base: ['straight', 'curved'], landing: ['straight', 'curved'], form: ['straight', 'curved'], turn: ['curved', 'spiral'] };
  // what the stairs come out as: steps, their height and depth (steep ones said)
  function summary(p) {
    if (p.kind !== 'stairs') return '';
    const parts = stairParts(p).filter((q) => q.nose), s = settingsOf(p);
    if (!parts.length) return stairParts(p).length ? 'A ramp.' : 'Too short: move B further.';
    const h = parts.length > 1 ? parts[1].top - parts[0].top : parts[0].top - (+p.z || 0);
    const depth = parts.length > 1 ? Math.hypot(parts[1].nose[0] - parts[0].nose[0], parts[1].nose[1] - parts[0].nose[1]) : 0;
    const warn = Math.abs(h) > 24 ? ' <b style="color:var(--bad)">Too high to climb (a player steps up to 24): lower Step height or move B.</b>'
      : depth && depth < Math.abs(h) * 1.2 ? ' <span style="color:var(--warn)">Very steep.</span>' : '';
    return `${parts.length} steps ${Math.abs(h).toFixed(1)} high${depth ? `, ${depth.toFixed(0)} deep` : ''}.${warn}`;
  }
  function inspector(el, p, { change, remove }) {
    const s = settingsOf(p), list = texList();
    const field = ([k, label, tip]) => (ONLY[k] && p.kind === 'stairs' && !ONLY[k].includes(s.shape)) ? ''
      : SELECTS[k] ? `<div class="row"><label title="${escapeHtml(tip || '')}">${label}</label><select data-dw="${k}">${(Array.isArray(SELECTS[k]) ? SELECTS[k] : SELECTS[k][p.kind]).map((o) => `<option ${o === s[k] ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`
      : k === 'column' ? `<div class="row"><label title="${escapeHtml(tip || '')}">${label}</label><input type="checkbox" data-dw="${k}" ${s[k] ? 'checked' : ''}></div>`
      : typeof DRAW_DEFAULTS[p.kind][k] === 'number'
      ? `<div class="row"><label title="${escapeHtml(tip || '')}">${label}</label><input type="number" data-dw="${k}" value="${s[k]}" step="8" min="0"></div>`
      : `<div class="row"><label title="${escapeHtml(tip || '')}">${label}</label><input data-dw="${k}" list="texlist" value="${escapeHtml(s[k])}"></div>`;
    const fields = FIELDS[p.kind];
    if (!document.getElementById('dw-style')) {         // labels on one line ("Ceiling texture", "Ridge height")
      const css = document.createElement('style'); css.id = 'dw-style';
      css.textContent = '.dw-panel .row > label { flex: 0 0 104px; width: 104px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .dw-panel .row > :is(input, select) { flex: 1; min-width: 0; }';
      document.head.appendChild(css);
    }
    el.innerHTML = `<div class="box inspector-object dw-panel"><b>${DRAW_LABELS[p.kind]}</b> <small>${escapeHtml(p.name)}</small>
      <div class="hint" style="margin:4px 0">${TWO_CLICKS.has(p.kind) ? `From ${Math.round(p.z)} to ${Math.round((+p.z || 0) + (+p.rise || 0))} high. ${summary(p)}` : `${p.pts.length} points · drawn on the ground at ${Math.round(p.z)}.`} Move or turn it with the gizmo (W, E); it becomes part of the map with Rebuild.</div>
      ${TWO_CLICKS.has(p.kind) ? `<div class="row"><label title="How much higher B is than A">Rise</label><input type="number" data-dw="rise" value="${+p.rise || 0}" step="8"></div>` : ''}
      ${p.kind === 'stairs' ? `<div class="row"><label title="Ready textures as the game uses them on its stairs">Look</label><select data-dw-style><option value="">choose...</option>${Object.keys(STAIR_STYLES).map((k) => `<option>${k}</option>`).join('')}</select></div>` : ''}
      ${p.kind === 'wall' || p.kind === 'road' ? `<div class="row"><label title="The last point joins the first">Closed loop</label><input type="checkbox" data-dw="closed" ${p.closed ? 'checked' : ''}></div>` : ''}
      ${fields.map(field).join('')}
      <datalist id="texlist">${list.map((t) => `<option value="${escapeHtml(t)}">`).join('')}</datalist>
      <div class="row actions"><button type="button" data-dw-del class="danger" title="Delete it (Del)">Delete</button></div></div>`;
    for (const input of el.querySelectorAll('[data-dw]')) input.onchange = () => change(() => {
      const k = input.dataset.dw;
      if (k === 'closed') { if (input.checked) p.closed = true; else delete p.closed; return; }
      if (k === 'rise') { const v = +input.value || 0; if (v) p.rise = v; else delete p.rise; return; }
      if (k === 'column') { if (input.checked) delete p.column; else p.column = 0; return; }
      const v = input.type === 'number' ? Math.max(0, +input.value || 0) : input.value.trim();
      if (v === '' || v === DRAW_DEFAULTS[p.kind][k]) delete p[k]; else p[k] = v;
    });
    el.querySelector('[data-dw-del]').onclick = remove;
    const look = el.querySelector('[data-dw-style]');
    if (look) look.onchange = () => { if (STAIR_STYLES[look.value]) change(() => Object.assign(p, STAIR_STYLES[look.value])); };
  }
  return { begin, hover, addPoint, undoPoint, finish, cancel, proxy, refresh, commitMove, inspector, key, get active() { return !!session; }, get kind() { return session?.kind; } };
}
