// The walkable area (Gabby, 17 Oct 2026; idea from a C++ developer on Discord: "navigation meshes would be
// ideal, Recast is what production engines use; what would help most is visualization in the editor").
//
// A navigation mesh made from the map with Recast (recast-navigation-js 0.43.1, MIT; Recast/Detour zlib:
// WebAssembly; the three files are in this folder, recast-navigation-*.js, unchanged, loaded when the view is
// first turned on: no internet needed) for a character
// of Deus Ex: 20 units of radius, 95 high, steps up to 25 (the engine's MaxStepHeight), floors up to 45
// degrees (the engine walks on a floor whose normal is at least 0.7 up). The map's solid surfaces make it
// (not the non-solid ones, not glass), the doors are left open. Decorations can be added as cylinders
// (walkerGeometry's obstacles), but the editor does not pass them for now: their collision cylinders close
// gaps JC gets through in the game (app.js, getObstacles).
//
// What it shows, laid on the floor like the AI paths: where the game's AI can go, compared with the network
// of path nodes it really walks on (the engine finds its way from node to node, not on this mesh):
//   green   near the network: a character can be sent there
//   amber   walkable but far from any path node (more than about 8 m on foot): add a node there
//   red     a walkable place no path node reaches at all (an island of floor without nodes)
// and, with Test route, the way a character would take on the walkable area itself (the funnel of Detour):
// the straight, natural line, next to the node-to-node one the game's AI uses today.
//
// The view changes nothing. Fill AI paths (fillPathNodes, below) proposes path nodes where the network has none;
// app.js adds them to the map. Coordinates are three.js (x, y up, z = Unreal Y).

const RECAST = '0.43.1';
const NEAR = 450, FAR = 900;          // Unreal units of walking from the nearest path node: green / amber / red
const PF_NOTSOLID = 8;

// Deus Ex's walker in Recast's terms (cells of 8 units, 4 high)
export const NAV_CONFIG = {
  cs: 8, ch: 4,
  walkableSlopeAngle: 45,
  walkableHeight: 24,        // 95 units
  walkableClimb: 6,          // 25 units (Pawn.MaxStepHeight)
  walkableRadius: 3,         // 20 units (a man's CollisionRadius)
  maxEdgeLen: 32,            // 256 units
  maxSimplificationError: 1.3,
  minRegionArea: 64,         // 8 x 8 cells: smaller scraps of floor are not places
  mergeRegionArea: 400,
  maxVertsPerPoly: 6,
  detailSampleDist: 6,       // x cs
  detailSampleMaxError: 1,   // x ch
  tileSize: 64,              // 512 units a tile (big maps are built tile by tile)
};

let recastReady = null;
function loadRecast() {
  // the import map of index.html gives the three packages; the core loads the WebAssembly itself
  recastReady ||= (async () => {
    const core = await import('@recast-navigation/core');
    const gen = await import('@recast-navigation/generators');
    await core.init();
    return { core, gen };
  })().catch((e) => { recastReady = null; throw e; });
  return recastReady;
}

// The triangles that block a walker: the map's solid surfaces and the blocking decorations (as 8-sided
// prisms from their collision cylinders). Returns { positions: Float32Array, indices: Uint32Array }.
export function walkerGeometry(THREE, meshes, obstacles, T, boxes = []) {
  const pos = [], idx = [];
  const v = new THREE.Vector3();
  for (const m of meshes) {
    if ((m.userData.flags || 0) & PF_NOTSOLID) continue;
    const g = m.geometry, p = g && g.attributes.position;
    if (!p) continue;
    m.updateWorldMatrix(true, false);
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      pos.push(v.x, v.y, v.z);
    }
    // Unreal -> three swaps Y and Z: a mirror, so every triangle turns over (the editor draws both sides and
    // never notices). Recast finds floors by the triangles' facing: they are turned back here, or floors
    // look like ceilings to it (and the undersides of things like floors)
    if (g.index) for (let i = 0; i + 2 < g.index.count; i += 3) idx.push(base + g.index.getX(i), base + g.index.getX(i + 2), base + g.index.getX(i + 1));
    else for (let i = 0; i + 2 < p.count; i += 3) idx.push(base + i, base + i + 2, base + i + 1);
  }
  const SIDES = 8;
  for (const o of obstacles) {
    const c = T(o.loc), r = o.radius, h = o.height;          // Unreal: loc is the centre, height the half height
    const base = pos.length / 3;
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      pos.push(x, c.y - h, z, x, c.y + h, z);
    }
    pos.push(c.x, c.y + h, c.z);                              // the top's centre
    const top = base + SIDES * 2;
    for (let k = 0; k < SIDES; k++) {
      const a0 = base + k * 2, a1 = base + ((k + 1) % SIDES) * 2;
      idx.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1);           // the side
      idx.push(a0 + 1, a1 + 1, top);                          // the top (walkable, as the top of a crate is)
    }
  }
  // solid boxes (three.js min / max): the doors characters cannot open (bakePolys), top facing up
  for (const b of boxes) {
    const base = pos.length / 3, [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    pos.push(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1);
    for (const f of [[4, 6, 5], [4, 7, 6], [0, 1, 2], [0, 2, 3], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]])
      idx.push(base + f[0], base + f[1], base + f[2]);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

// How far each triangle of the navigation mesh is, on foot, from the nearest path node: Detour's own
// search (findPolysAroundCircle: the polygons reachable from a node within FAR, with their cost along the
// mesh) from every node, then each triangle takes the cost of its polygon. Not reached: Infinity.
// Only where JC can walk counts: the floor reachable from the map's starts (PlayerStart, arrival points);
// roofs, the outside of the map and other unreachable floors get -1 (not shown).
// nodes, starts: three.js positions (path nodes stand about 40 units above their floor).
export function coverage(query, positions, indices, nodes, starts = []) {
  const n = indices.length / 3;
  const ext = { halfExtents: { x: 96, y: 160, z: 96 } };
  const cost = new Map(), reach = new Set();
  for (const p of starts) {
    const s = query.findNearestPoly({ x: p.x, y: p.y, z: p.z }, ext);
    if (!s.success || !s.nearestRef || reach.has(s.nearestRef)) continue;
    const r = query.findPolysAroundCircle(s.nearestRef, s.nearestPoint, 1e7, { maxPolys: 65535 });
    if (r.success) for (let i = 0; i < r.resultCount; i++) reach.add(r.resultRefs[i]);
  }
  let seeds = 0;
  for (const p of nodes) {
    const s = query.findNearestPoly({ x: p.x, y: p.y, z: p.z }, ext);
    if (!s.success || !s.nearestRef) continue;
    seeds++;
    const r = query.findPolysAroundCircle(s.nearestRef, s.nearestPoint, FAR + 1, { maxPolys: 4096 });
    if (!r.success) continue;
    for (let i = 0; i < r.resultCount; i++) {
      const ref = r.resultRefs[i], c = r.resultCost[i];
      if (!(cost.get(ref) <= c)) cost.set(ref, c);
    }
  }
  const dist = new Float32Array(n).fill(Infinity), area = new Float32Array(n);
  const near = { halfExtents: { x: 4, y: 32, z: 4 } };      // its own polygon (a floor above or below is 95+ away)
  for (let t = 0; t < n; t++) {
    const a = indices[3 * t], b = indices[3 * t + 1], c = indices[3 * t + 2];
    const cx = (positions[3 * a] + positions[3 * b] + positions[3 * c]) / 3;
    const cy = (positions[3 * a + 1] + positions[3 * b + 1] + positions[3 * c + 1]) / 3;
    const cz = (positions[3 * a + 2] + positions[3 * b + 2] + positions[3 * c + 2]) / 3;
    const ux = positions[3 * b] - positions[3 * a], uz = positions[3 * b + 2] - positions[3 * a + 2];
    const wx = positions[3 * c] - positions[3 * a], wz = positions[3 * c + 2] - positions[3 * a + 2];
    area[t] = Math.abs(ux * wz - uz * wx) / 2;
    const r = query.findNearestPoly({ x: cx, y: cy, z: cz }, near);
    if (reach.size && !(r.success && reach.has(r.nearestRef))) dist[t] = -1;     // JC never walks there
    else if (r.success && cost.has(r.nearestRef)) dist[t] = cost.get(r.nearestRef);
  }
  return { n, dist, area, seeds, nodes: nodes.length, starts: reach.size > 0, reach };
}

// ---------------------------------------------------------------- Fill AI paths (Gabby, 17 Oct 2026)
// Path nodes where the walkable area has none, put the way a level designer would:
// - every place JC can walk on gets a node it can walk to in a straight line within FILL.spacing (so the
//   whole floor turns green), away from the walls and outside the decorations; the places are tried from
//   the network outwards, so a new node stands about FILL.spacing from the last one and sees it;
// - then every new node must reach the network: Paths Define links two nodes up to 1000 units apart when a
//   man can walk straight from one to the other. A group of new nodes that sees no node of the network gets
//   more nodes at the corners of Detour's way to the nearest one (where the straight line breaks).
// Nothing of the engine's own is needed: the nodes are plain PathNodes, the game's Paths Define links them
// (so it works for Revision and the original Deus Ex alike).
export const FILL = {
  spacing: NEAR,      // a place is served by a node it can walk to straight within this (the view's green)
  link: 900,          // nodes this close that see each other: Paths Define links them (it goes up to 1000)
  cell: 96,           // the places tried: about one every 96 x 96 units of floor
  wall: 20,           // a new node keeps this far from walls (on top of the mesh's own 20 units)
  corner: 120,        // a bridging node is not put this close to another node
  max: 800,           // at most this many in one go
};
const FAR_T = 1e30;     // Detour's raycast: t is FLT_MAX when the ray gets to the end

function rng(seed) {                       // the same nodes every time for the same map (mulberry32)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Can a man walk in a straight line from a to b (both { ref, q } on the mesh)? Detour's raycast follows the
// floor a stands on; points along the line must also lie on a floor at the line's height (not a floor
// above or below: a balcony over a hall is not a straight walk).
function straight(query, a, b) {
  const r = query.raycast(a.ref, a.q, b.q);
  if (!r.success || !(r.t > 1e6)) return false;
  const d = Math.hypot(b.q.x - a.q.x, b.q.z - a.q.z), steps = Math.min(4, Math.floor(d / 200));
  for (let k = 1; k <= steps; k++) {
    const f = k / (steps + 1);
    const p = { x: a.q.x + (b.q.x - a.q.x) * f, y: a.q.y + (b.q.y - a.q.y) * f, z: a.q.z + (b.q.z - a.q.z) * f };
    const s = query.findNearestPoly(p, { halfExtents: { x: 8, y: 40, z: 8 } });
    if (!s.success || !s.nearestRef || Math.abs(s.nearestPoint.y - p.y) > 40) return false;
  }
  return true;
}

// The decorations (collision cylinders, three.js: x, z, y0..y1, r) a node must not stand in, or a link cross.
function inBlocker(blockers, q) {
  for (const b of blockers) {
    if (q.y + 10 < b.y0 || q.y > b.y1) continue;
    const dx = q.x - b.x, dz = q.z - b.z, r = b.r + 24;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}
function crossesBlocker(blockers, a, b) {
  const lo = Math.min(a.q.y, b.q.y), hi = Math.max(a.q.y, b.q.y) + 90;      // the walker's body along the way
  const ux = b.q.x - a.q.x, uz = b.q.z - a.q.z, l2 = ux * ux + uz * uz || 1;
  for (const o of blockers) {
    if (o.y1 < lo + 24 || o.y0 > hi) continue;                              // stepped over, or overhead
    const t = Math.max(0, Math.min(1, ((o.x - a.q.x) * ux + (o.z - a.q.z) * uz) / l2));
    const dx = a.q.x + ux * t - o.x, dz = a.q.z + uz * t - o.z, r = o.r + 14;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

// nodes: the network's points [{ p: three position }] (path nodes stand about 40 units above their floor);
// links: index pairs of nodes the last rebuild linked; blockers as above.
// Returns { added: [three positions on the floor], bridges, groups (new groups still apart), tried }.
export function fillPathNodes(query, positions, indices, info, nodes, links, blockers) {
  const ext = { halfExtents: { x: 96, y: 160, z: 96 } }, own = { halfExtents: { x: 4, y: 32, z: 4 } };
  const all = nodes.map((n) => {
    const s = query.findNearestPoly({ x: n.p.x, y: n.p.y, z: n.p.z }, ext);
    return { old: true, ref: s.success ? s.nearestRef : 0, q: s.success && s.nearestRef ? s.nearestPoint : null };
  });
  // a grid of the nodes by x/z, cells of FILL.link
  const G = FILL.link, grid = new Map();
  const cellOf = (q) => `${Math.floor(q.x / G)},${Math.floor(q.z / G)}`;
  const put = (i) => { const k = cellOf(all[i].q); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); };
  const around = (q, fn) => {
    const cx = Math.floor(q.x / G), cz = Math.floor(q.z / G);
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) for (const i of grid.get(`${x},${z}`) || []) if (fn(i)) return true;
    return false;
  };
  all.forEach((n, i) => { if (n.q) put(i); });

  // the places to try: spread over every triangle JC can walk on, the ones nearest the network first
  const rand = rng(1234567), cand = [];
  for (let t = 0; t < info.n; t++) {
    const d = info.dist[t];
    if (d < 0) continue;
    const want = info.area[t] / (FILL.cell * FILL.cell);
    let k = Math.floor(want) + (rand() < want - Math.floor(want) ? 1 : 0);
    const a = indices[3 * t], b = indices[3 * t + 1], c = indices[3 * t + 2];
    while (k-- > 0) {
      let u = rand(), v = rand();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const at = (i) => positions[3 * a + i] + u * (positions[3 * b + i] - positions[3 * a + i]) + v * (positions[3 * c + i] - positions[3 * a + i]);
      cand.push({ q: { x: at(0), y: at(1), z: at(2) }, order: Number.isFinite(d) ? d + rand() : 1e9 + rand() });
    }
  }
  cand.sort((x, y) => x.order - y.order);

  const added = [];
  const covered = (c) => around(c.q, (i) => {
    const n = all[i];
    const dx = n.q.x - c.q.x, dy = n.q.y - c.q.y, dz = n.q.z - c.q.z;
    return dx * dx + dy * dy + dz * dz <= FILL.spacing * FILL.spacing && straight(query, n, c);
  });
  const nearWall = (c) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const r = query.raycast(c.ref, c.q, { x: c.q.x + Math.cos(a) * FILL.wall, y: c.q.y, z: c.q.z + Math.sin(a) * FILL.wall });
      if (!r.success || !(r.t > 1e6)) return true;
    }
    return false;
  };
  for (const c of cand) {
    if (added.length >= FILL.max) break;
    if (inBlocker(blockers, c.q) || covered(c)) continue;
    const s = query.findNearestPoly(c.q, own);
    if (!s.success || !s.nearestRef) continue;
    c.ref = s.nearestRef; c.q = s.nearestPoint;
    if (nearWall(c)) continue;
    all.push({ old: false, ref: c.ref, q: c.q });
    put(all.length - 1);
    added.push(all.length - 1);
  }

  // joined to the network? groups of nodes that see each other (the rebuild's links for the old ones)
  const up = all.map((_, i) => i);
  const find = (i) => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
  const join = (i, j) => { up[find(i)] = find(j); };
  for (const [i, j] of links) if (i < all.length && j < all.length) join(i, j);
  const linkable = (i, j) => {
    const a = all[i], b = all[j];
    const dx = a.q.x - b.q.x, dy = a.q.y - b.q.y, dz = a.q.z - b.q.z;
    return dx * dx + dy * dy + dz * dz <= FILL.link * FILL.link && !crossesBlocker(blockers, a, b) && straight(query, a, b);
  };
  for (const i of added) around(all[i].q, (j) => { if (j !== i && all[j].q && find(i) !== find(j) && linkable(i, j)) join(i, j); return false; });

  // the network: the group with most of the old nodes (or, with no network yet, the biggest new group)
  const count = new Map();
  for (let i = 0; i < all.length; i++) if (all[i].q && (all[i].old || !nodes.length)) count.set(find(i), (count.get(find(i)) || 0) + 1);
  let main = null, best = -1;
  for (const [g, n] of count) if (n > best) { best = n; main = g; }
  // every group apart from it (the map's own too, when the last rebuild left them apart), on floor JC walks on
  const reached = (g) => !info.reach || !info.reach.size || all.some((n, k) => n.ref && find(k) === g && info.reach.has(n.ref));
  let bridges = 0, apart = 0;
  if (main !== null) {
    const done = new Set();
    for (let i = 0; i < all.length; i++) {
      if (!all[i].q) continue;
      const g = find(i);
      if (g === find(main) || done.has(g)) continue;
      done.add(g);
      if (!reached(g)) continue;
      // the nearest pair of the group and the network, and Detour's way between them
      let pair = null, pd = Infinity;
      for (let a = 0; a < all.length; a++) {
        if (find(a) !== g || !all[a].q) continue;
        for (let b = 0; b < all.length; b++) {
          if (find(b) !== find(main) || !all[b].q) continue;
          const d = (all[a].q.x - all[b].q.x) ** 2 + (all[a].q.y - all[b].q.y) ** 2 + (all[a].q.z - all[b].q.z) ** 2;
          if (d < pd) { pd = d; pair = [a, b]; }
        }
      }
      if (!pair) { apart++; continue; }
      const r = query.computePath(all[pair[0]].q, all[pair[1]].q, { halfExtents: { x: 32, y: 64, z: 32 }, maxPathPolys: 4096, maxStraightPathPoints: 256 });
      if (!r.success || !r.path || r.path.length < 2) { apart++; continue; }
      // its corners, and points along the legs longer than a link
      const way = [];
      for (let k = 1; k < r.path.length; k++) {
        const p0 = r.path[k - 1], p1 = r.path[k], l = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
        const parts = Math.ceil(l / (FILL.link * 0.8));
        for (let s = 1; s < parts; s++) way.push({ x: p0.x + (p1.x - p0.x) * s / parts, y: p0.y + (p1.y - p0.y) * s / parts, z: p0.z + (p1.z - p0.z) * s / parts });
        if (k < r.path.length - 1) way.push(p1);
      }
      let laid = 0;
      for (const p of way) {
        if (added.length >= FILL.max) break;
        const s = query.findNearestPoly(p, own);
        if (!s.success || !s.nearestRef) continue;
        const q = s.nearestPoint;
        if (inBlocker(blockers, q) || around(q, (j) => { const n = all[j]; return Math.hypot(n.q.x - q.x, n.q.y - q.y, n.q.z - q.z) < FILL.corner; })) continue;
        all.push({ old: false, ref: s.nearestRef, q });
        put(all.length - 1);
        added.push(all.length - 1);
        join(all.length - 1, g);
        bridges++; laid++;
      }
      // nodes there already (a fill before this one) and still apart: the game does not link that way
      if (laid) join(g, main); else apart++;
    }
  }
  return { added: added.map((i) => all[i].q), bridges, apart, tried: cand.length, full: added.length >= FILL.max };
}

// ---------------------------------------------------------------- the walkable area in the game (phase 3)
// The polygons of the map for the game's scripts (UCNavMesh: A* over them, then the funnel; editor/navbake.py
// puts them into the map at Rebuild). A solo Recast mesh with no limit on the edges' length (fewer, bigger
// polygons than the view's), only the polygons joined to a seed: where JC starts, the characters, the path
// nodes, the places characters are sent to. Each polygon a string "nv x y z ... n ...": its corners in Unreal
// units (on the floor) and, for each edge (corner k to k+1), the polygon across it or -1.
// obstacles: what stops a character though not JC (crates, barricades: he jumps and squeezes, they cannot),
// as walkerGeometry takes them (Unreal loc, radius, half height), T: Unreal -> three.js.
export const BAKE_MAX = 2048;           // UCNavMesh.Poly[2048]
export async function bakePolys(THREE, meshes, seeds, obstacles = [], T = null, boxes = []) {
  const { gen } = await loadRecast();
  const geo = walkerGeometry(THREE, meshes, obstacles, T, boxes);
  if (!geo.indices.length) throw new Error('the map has no solid surfaces yet');
  const cfg = Object.assign({}, NAV_CONFIG, { maxEdgeLen: 0 });
  delete cfg.tileSize;
  const r = gen.generateSoloNavMesh(geo.positions, geo.indices, cfg, true);
  if (!r.success || !r.intermediates || !r.intermediates.polyMesh) throw new Error('Recast could not make it (' + (r.error || 'unknown error') + ')');
  const pm = r.intermediates.polyMesh, nvp = pm.nvp(), np = pm.npolys(), cs = pm.cs(), ch = pm.ch(), b = pm.bmin();
  const vert = (i) => ({ x: b.x + pm.verts(3 * i) * cs, y: b.y + pm.verts(3 * i + 1) * ch, z: b.z + pm.verts(3 * i + 2) * cs });
  const polys = [];
  for (let p = 0; p < np; p++) {
    const vs = [], nb = [];
    for (let k = 0; k < nvp; k++) {
      const v = pm.polys(p * 2 * nvp + k);
      if (v === 0xffff) break;
      vs.push(vert(v));
      const n = pm.polys(p * 2 * nvp + nvp + k);
      nb.push(n & 0x8000 ? -1 : n);                  // 0xffff: no polygon there (and tile borders, none in a solo mesh)
    }
    let lo = Infinity, hi = -Infinity, minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const v of vs) { lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); minx = Math.min(minx, v.x); maxx = Math.max(maxx, v.x); minz = Math.min(minz, v.z); maxz = Math.max(maxz, v.z); }
    polys.push({ vs, nb, lo, hi, minx, maxx, minz, maxz });
  }
  r.navMesh?.destroy?.();
  // a point (three.js) over a polygon: inside it seen from above, its floor up to 160 below
  const inside = (P, x, z) => {
    let pos = 0, neg = 0;
    for (let k = 0; k < P.vs.length; k++) {
      const a = P.vs[k], c = P.vs[(k + 1) % P.vs.length];
      const s = (c.x - a.x) * (z - a.z) - (c.z - a.z) * (x - a.x);
      if (s > 0.5) pos++; else if (s < -0.5) neg++;
    }
    return !pos || !neg;
  };
  // how far a point is from a polygon, seen from above (0 inside): a seed by a wall is just off the mesh
  const away = (P, x, z) => {
    if (inside(P, x, z)) return 0;
    let best = Infinity;
    for (let k = 0; k < P.vs.length; k++) {
      const a = P.vs[k], c = P.vs[(k + 1) % P.vs.length], ex = c.x - a.x, ez = c.z - a.z, l = ex * ex + ez * ez;
      const f = l > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l)) : 0;
      best = Math.min(best, Math.hypot(a.x + ex * f - x, a.z + ez * f - z));
    }
    return best;
  };
  const keep = new Uint8Array(polys.length), queue = [];
  for (const s of seeds) {
    let best = -1, bd = Infinity, near = -1, nd = 120;
    polys.forEach((P, i) => {
      if (s.y < P.lo - 40 || s.y > P.hi + 160 || s.x < P.minx - nd || s.x > P.maxx + nd || s.z < P.minz - nd || s.z > P.maxz + nd) return;
      const d = away(P, s.x, s.z);
      if (d === 0) { const dz = Math.abs(s.y - P.hi - 45); if (dz < bd) { bd = dz; best = i; } }
      else if (d < nd) { nd = d; near = i; }
    });
    if (best < 0) best = near;
    if (best >= 0 && !keep[best]) { keep[best] = 1; queue.push(best); }
  }
  while (queue.length) {
    const p = queue.pop();
    for (const n of polys[p].nb) if (n >= 0 && n < polys.length && !keep[n]) { keep[n] = 1; queue.push(n); }
  }
  const index = new Int32Array(polys.length).fill(-1), out = [];
  polys.forEach((P, i) => { if (keep[i]) index[i] = out.push(i) - 1; });
  if (out.length > BAKE_MAX) throw new Error(`the walkable area has ${out.length} polygons, more than the ${BAKE_MAX} the game's side takes`);
  const strings = out.map((i) => {
    const P = polys[i];
    // Unreal: x, y = three z, z = three y
    return [P.vs.length, ...P.vs.flatMap((v) => [Math.round(v.x), Math.round(v.z), Math.round(v.y)]), ...P.nb.map((n) => (n >= 0 ? index[n] : -1))].join(' ');
  });
  return { polys: strings, all: polys.length };
}

export function createNavmeshView({ THREE, scene, getMeshes, getObstacles, getNodes, getStarts = () => [], note = () => '', T, status, colors }) {
  const group = new THREE.Group();
  group.name = 'walkable area';
  scene.add(group);
  let state = null;          // { key, navMesh, query, positions, indices, info, summary }
  let routeObj = null, on = false, building = null;

  function dispose(o) {
    o.traverse((c) => { c.geometry?.dispose(); c.material?.dispose(); });
  }
  function clear() {
    for (const c of [...group.children]) { group.remove(c); dispose(c); }
    routeObj = null;
  }

  // key: the map's geometry (the mesh is made again when it changes); the colours follow the path nodes
  // (added, moved or deleted ones too) without making the mesh again
  async function build(key) {
    if (!state || state.key !== key) {
      status('Walkable area: making the navigation mesh of the map...');
      const { core, gen } = await loadRecast();
      const geo = walkerGeometry(THREE, getMeshes(), getObstacles(), T);
      if (!geo.indices.length) throw new Error('the map has no solid surfaces yet');
      const t0 = performance.now();
      let r = gen.generateTiledNavMesh(geo.positions, geo.indices, NAV_CONFIG);
      if (!r.success) r = gen.generateTiledNavMesh(geo.positions, geo.indices, Object.assign({}, NAV_CONFIG, { tileSize: 128 }));
      if (!r.success) throw new Error('Recast could not make it (' + (r.error || 'unknown error') + ')');
      if (state) { state.query?.destroy?.(); state.navMesh?.destroy?.(); }
      const [positions, indices] = core.getNavMeshPositionsAndIndices(r.navMesh);
      const query = new core.NavMeshQuery(r.navMesh);
      state = { key, navMesh: r.navMesh, query, positions, indices, info: null, sig: null,
                ms: Math.round(performance.now() - t0), tris: geo.indices.length / 3 };
    }
    const nodes = getNodes(), starts = getStarts();
    const sig = [nodes, starts].map((l) => l.length + ':' + Math.round(l.reduce((s, p) => s + p.x * 3 + p.y * 5 + p.z * 7, 0))).join('|');
    if (state.sig !== sig) { state.info = coverage(state.query, state.positions, state.indices, nodes, starts); state.sig = sig; }
    return state;
  }

  // Fill AI paths: the new nodes for this map (fillPathNodes), the mesh made first if needed.
  // nodes [{ p }], links [[i, j]], blockers as fillPathNodes takes them.
  async function fill(key, nodes, links, blockers) {
    await build(key);
    const t0 = performance.now();
    const r = fillPathNodes(state.query, state.positions, state.indices, state.info, nodes, links, blockers);
    r.ms = Math.round(performance.now() - t0);
    return r;
  }

  function draw() {
    clear();
    if (!on || !state) return;
    const { positions, indices, info } = state;
    const near = new THREE.Color(colors().ok), far = new THREE.Color(colors().warn), none = new THREE.Color(colors().bad);
    const pos = new Float32Array(info.n * 9), col = new Float32Array(info.n * 9);
    let m = 0;
    for (let t = 0; t < info.n; t++) {
      const d = info.dist[t];
      if (d < 0) continue;                                         // a floor JC never walks on
      const c = d <= NEAR ? near : d <= FAR ? far : none;
      for (let k = 0; k < 3; k++) {
        const i = indices[3 * t + k];
        pos[9 * m + 3 * k] = positions[3 * i];
        pos[9 * m + 3 * k + 1] = positions[3 * i + 1] + 2;      // just over the floor
        pos[9 * m + 3 * k + 2] = positions[3 * i + 2];
        col[9 * m + 3 * k] = c.r; col[9 * m + 3 * k + 1] = c.g; col[9 * m + 3 * k + 2] = c.b;
      }
      m++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, m * 9), 3));
    g.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, m * 9), 3));
    const area = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.28,
      depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    area.renderOrder = 2;
    group.add(area);
  }

  function summary() {
    const { info } = state;
    let all = 0, green = 0, amber = 0, red = 0, away = 0;
    for (let t = 0; t < info.n; t++) {
      const a = info.area[t];
      if (info.dist[t] < 0) { away += a; continue; }
      all += a;
      if (info.dist[t] <= NEAR) green += a; else if (info.dist[t] <= FAR) amber += a; else red += a;
    }
    const pc = (x) => Math.round(100 * x / Math.max(1, all));
    const m2 = Math.round(all * 0.01905 * 0.01905);          // 1 unit = 1.905 cm
    return { all, m2, green: pc(green), amber: pc(amber), red: pc(red), away: Math.round(away * 0.01905 * 0.01905), starts: info.starts };
  }

  async function show(key) {
    on = true;
    if (building) return building;
    building = (async () => {
      try {
        await build(key);
        if (!on) return;
        draw();
        const s = summary();
        status(`Walkable area: about ${s.m2} m² ${s.starts ? 'JC can walk on' : 'a man can walk on'}. Green ${s.green}%: near the AI paths. `
          + `Amber ${s.amber}%: walkable but far from any path node (add one there). Red ${s.red}%: no path node reaches it. `
          + (s.amber + s.red > 5 ? 'Map > Fill AI paths adds path nodes there. ' : '')
          + (s.starts && s.away ? `Not shown: about ${s.away} m² of floor JC never reaches (roofs, outside). ` : '')
          + note()
          + `(${state.tris} triangles of the map, made in ${state.ms} ms.)`, s.red > 5 ? 'warn' : 'ok');
      } catch (e) {
        on = false;
        status('Walkable area: ' + (e.message || e) + '.', 'bad');
      } finally {
        building = null;
      }
    })();
    return building;
  }

  function hide() { on = false; clear(); }

  // Test route on the walkable area: Detour's way between two places (three.js positions), drawn as a line
  // over the floor. Returns its length in units, or null.
  function route(a, b) {
    if (!state || !on) return null;
    if (routeObj) { group.remove(routeObj); dispose(routeObj); routeObj = null; }
    // the places clicked are on the floor or a little above it (Detour's default search box is 1 unit)
    const r = state.query.computePath({ x: a.x, y: a.y, z: a.z }, { x: b.x, y: b.y, z: b.z },
      { halfExtents: { x: 96, y: 160, z: 96 }, maxPathPolys: 4096, maxStraightPathPoints: 1024 });
    if (!r.success || !r.path || r.path.length < 2) return null;
    const pts = r.path.map((p) => new THREE.Vector3(p.x, p.y + 6, p.z));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    routeObj = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(colors().acc), depthTest: false, transparent: true }));
    routeObj.renderOrder = 5;
    group.add(routeObj);
    return len;
  }
  function clearRoute() { if (routeObj) { group.remove(routeObj); dispose(routeObj); routeObj = null; } }

  return { show, hide, route, clearRoute, fill, get on() { return on; }, invalidate() { state = null; if (on) clear(); } };
}
