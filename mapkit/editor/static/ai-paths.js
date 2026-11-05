// AI paths (Gabby, 16 Oct; thin lines since 5 Nov: path-lines.js draws the network, coloured by who can walk each
// link, ai-paths.js says who). A link's kind: walk, door, jump, water/air, lift/teleporter. "Test a route": the
// shortest way between two places on the same network the game's AI uses (ScriptedPawn finds its way from point to point along these links).
// Pure helpers plus the three.js drawing; app.js gives THREE, the Unreal -> three conversion and a floor finder.

// UE1 reach flags (FReachSpec.reachFlags)
export const R_WALK = 1, R_FLY = 2, R_SWIM = 4, R_JUMP = 8, R_DOOR = 16, R_SPECIAL = 32, R_PLAYERONLY = 64;

export const PATH_KINDS = {
  walk: { color: '#5fd38a', label: 'walk' },
  door: { color: '#f2cf4a', label: 'through a door' },
  jump: { color: '#ff9a3c', label: 'jump or drop' },
  water: { color: '#4fc3f7', label: 'swim or fly' },
  special: { color: '#c08cff', label: 'lift, teleporter' },
  problem: { color: '#ff5a5a', label: 'not linked' },
};

export function linkKind(flags) {
  const f = Number(flags) || 0;
  if (f & R_SPECIAL) return 'special';
  if (f & R_DOOR) return 'door';
  if (f & R_JUMP) return 'jump';
  if (f & (R_SWIM | R_FLY)) return 'water';
  return 'walk';
}

// links of paths.json: [start, end, flags, radius?, height?, distance?] (older caches stop at flags)
export function normLinks(pathData) {
  const pts = (pathData && pathData.points) || {};
  const out = [];
  for (const l of (pathData && pathData.links) || []) {
    const [a, b, flags = R_WALK, radius = 0, height = 0, dist = 0] = l;
    if (!pts[a] || !pts[b]) continue;
    out.push({ a, b, flags: Number(flags) || 0, radius: Number(radius) || 0, height: Number(height) || 0,
               dist: Number(dist) || distance(pts[a], pts[b]) });
  }
  return out;
}

function distance(pa, pb) {
  return Math.hypot(pa[1] - pb[1], pa[2] - pb[2], pa[3] - pb[3]);
}

// one strip per pair of points: two-way when both directions exist (arrows both ways), one-way otherwise
export function pathStrips(pathData) {
  const links = normLinks(pathData);
  const by = new Map(links.map((l) => [l.a + '>' + l.b, l]));
  const strips = [];
  for (const l of links) {
    const back = by.get(l.b + '>' + l.a);
    if (back && l.a > l.b) continue;
    strips.push({ a: l.a, b: l.b, two: !!back, kind: linkKind(l.flags | (back ? back.flags : 0)),
                  radius: Math.max(l.radius, back ? back.radius : 0), height: Math.max(l.height, back ? back.height : 0) });
  }
  return strips;
}

// points with no link at all: characters cannot use them
export function loosePoints(pathData) {
  const used = new Set();
  for (const l of normLinks(pathData)) { used.add(l.a); used.add(l.b); }
  return Object.keys((pathData && pathData.points) || {}).filter((n) => !used.has(n));
}

// Who can walk a link (Gabby, 5 Nov 2026: colours by the kind of character). The engine gives each link the room a
// character has there (its reach spec's collision radius and height, PATHS DEFINE); a character walks it when it is
// no wider and no taller. The kinds of character by size, from the game's own classes (their collision cylinders):
// a military bot 80 x 79, a Karkian 54 x 37 (dogs 35-38, Gunther 24 x 53 under it), a person 20 x 47.5, a rat, a
// cat or a cleaner bot 18 x 12 at most. Each box holds the next one.
export const SIZE_KINDS = [
  { key: 'huge', radius: 80, height: 79, color: '#89b9e8', label: 'military bots' },
  { key: 'large', radius: 54, height: 58, color: '#7fd6c8', label: 'Karkians and dogs' },
  { key: 'person', radius: 20, height: 47.5, color: '#e3b96b', label: 'people' },
  { key: 'small', radius: 18, height: 12, color: '#ff9a3c', label: 'rats, cats and small bots' },
];
export const EVERYONE = { key: 'everyone', color: '#5fd38a', label: 'every character of this map' };
export const NOBODY = { key: 'nobody', color: '#f28780', label: 'too narrow for any walking character' };

// a character {radius, height} fits a link {radius, height} (an older cache has no room: everyone fits)
export function fitsLink(c, s) {
  if (!s || !s.radius) return true;
  return c.radius <= s.radius + 0.5 && (!s.height || c.height <= s.height + 0.5);
}
// the biggest kind that fits a link: an index of SIZE_KINDS, SIZE_KINDS.length when even the smallest does not
export function linkSize(s) {
  const i = SIZE_KINDS.findIndex((k) => fitsLink(k, s));
  return i < 0 ? SIZE_KINDS.length : i;
}
// the kind a character is (the smallest box it fits in; bigger than all: the biggest)
export function characterSize(c) {
  let at = 0;
  SIZE_KINDS.forEach((k, i) => { if (c.radius <= k.radius + 0.5 && c.height <= k.height + 0.5) at = i; });
  return at;
}
// what a link says, for the characters of a map ([{radius, height}]; none: people are assumed): EVERYONE when
// all of them fit, else the biggest kind that does (or NOBODY): the colours show only where someone cannot pass
export function linkWho(s, characters) {
  const need = (characters && characters.length) ? Math.min(...characters.map(characterSize)) : SIZE_KINDS.findIndex((k) => k.key === 'person');
  const size = linkSize(s);
  if (size <= need && (!characters || characters.every((c) => fitsLink(c, s)))) return EVERYONE;
  return SIZE_KINDS[size] || NOBODY;
}

// the nav point nearest to a place (Unreal coordinates); role 'from': one the AI can leave (it has links
// out), 'to': one it can get to (links in) - a PlayerStart, say, often has links out only
export function nearestPoint(pathData, xyz, maxDist = 1200, role = '') {
  let best = null, bd = maxDist;
  const ok = new Set();
  if (role) for (const l of normLinks(pathData)) ok.add(role === 'from' ? l.a : l.b);
  for (const [name, p] of Object.entries((pathData && pathData.points) || {})) {
    if (role && !ok.has(name)) continue;
    const d = Math.hypot(p[1] - xyz[0], p[2] - xyz[1], (p[3] - xyz[2]) * 1.5);
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

// Dijkstra on the directed links: the points in order, or null. Also what can be reached from `from`.
export function findRoute(pathData, from, to) {
  const links = normLinks(pathData);
  const adj = new Map();
  for (const l of links) (adj.get(l.a) || adj.set(l.a, []).get(l.a)).push(l);
  const dist = new Map([[from, 0]]), prev = new Map(), done = new Set();
  while (true) {
    let cur = null, cd = Infinity;
    for (const [n, d] of dist) if (!done.has(n) && d < cd) { cd = d; cur = n; }
    if (cur === null) break;
    if (cur === to) break;
    done.add(cur);
    for (const l of adj.get(cur) || []) {
      const nd = cd + l.dist;
      if (nd < (dist.has(l.b) ? dist.get(l.b) : Infinity)) { dist.set(l.b, nd); prev.set(l.b, l); }
    }
  }
  if (!dist.has(to)) return { route: null, reached: [...dist.keys()] };
  const route = [to], kinds = [];
  for (let n = to; n !== from;) { const l = prev.get(n); kinds.unshift(linkKind(l.flags)); n = l.a; route.unshift(n); }
  return { route, kinds, length: dist.get(to), reached: [...dist.keys()] };
}

// ---------------------------------------------------------------- drawing (three.js)
// The way Unreal shows its navigation (Gabby, 16 Oct): one faint area where the links run, not strips piled
// up on one another (each layer is drawn once per pixel: the stencil buffer keeps what is already tinted),
// lying on the floor's real shape, with thin arrows of their own along the middle.

// The floor's shape from the map's own triangles: height(x, z, top, bottom) -> the highest floor between
// top and bottom (three coordinates), or null. Walls are left out; a grid keeps it quick.
export function floorField(THREE, meshes) {
  const CELL = 64, cells = new Map(), tris = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  for (const mesh of meshes) {
    const g = mesh.geometry, p = g && g.attributes && g.attributes.position;
    if (!p) continue;
    mesh.updateWorldMatrix(true, false);
    const ix = g.index, count = ix ? ix.count : p.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const i0 = ix ? ix.getX(i) : i, i1 = ix ? ix.getX(i + 1) : i + 1, i2 = ix ? ix.getX(i + 2) : i + 2;
      a.fromBufferAttribute(p, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(p, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(p, i2).applyMatrix4(mesh.matrixWorld);
      n.subVectors(b, a).cross(e.subVectors(c, a));
      const len = n.length();
      if (len < 1e-6 || Math.abs(n.y) / len < 0.5) continue;    // a wall, or nothing
      const k = tris.length;
      tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      const x0 = Math.floor(Math.min(a.x, b.x, c.x) / CELL), x1 = Math.floor(Math.max(a.x, b.x, c.x) / CELL);
      const z0 = Math.floor(Math.min(a.z, b.z, c.z) / CELL), z1 = Math.floor(Math.max(a.z, b.z, c.z) / CELL);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const key = x + ',' + z;
        (cells.get(key) || cells.set(key, []).get(key)).push(k);
      }
    }
  }
  return {
    height(x, z, top, bottom) {
      const list = cells.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
      if (!list) return null;
      let best = null;
      for (const k of list) {
        const ax = tris[k], ay = tris[k + 1], az = tris[k + 2], bx = tris[k + 3], by = tris[k + 4], bz = tris[k + 5];
        const cx = tris[k + 6], cy = tris[k + 7], cz = tris[k + 8];
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const w = 1 - u - v;
        if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
        const y = u * ay + v * by + w * cy;
        if (y <= top && y >= bottom && (best === null || y > best)) best = y;
      }
      return best;
    },
  };
}

const texCache = new Map();
function arrowTexture(THREE, color, two) {
  const key = color + (two ? '2' : '1');
  if (texCache.has(key)) return texCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 64;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 32, 64);
  g.strokeStyle = color; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round';
  const chevron = (y, up) => { g.beginPath(); g.moveTo(5, y + (up ? 7 : -7)); g.lineTo(16, y + (up ? -5 : 5)); g.lineTo(27, y + (up ? 7 : -7)); g.stroke(); };
  if (two) { chevron(16, true); chevron(48, false); } else chevron(32, true);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  t.userData = { two };
  texCache.set(key, t);
  return t;
}

// a see-through material drawn once per pixel of its layer (stencil `ref`): where strips cross, no pile-up
function layerMaterial(THREE, opts, ref) {
  return new THREE.MeshBasicMaterial(Object.assign({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    stencilWrite: true, stencilRef: ref, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.ReplaceStencilOp,
  }, opts));
}

// a strip from A to B (three coordinates on the floor), `width` wide, `inset` short of both ends, lying on
// the floor: every STEP units its middle and both edges take the floor's height there (field), the edges
// staying with the middle where the floor drops away (a ledge) and the middle going straight where there
// is no floor at all (a jump)
const STEP = 8;
function stripMesh(THREE, A, B, width, material, lift, renderOrder, field, inset = 0, uvEvery = 0) {
  const d = new THREE.Vector3().subVectors(B, A); d.y = 0;
  const full = Math.max(d.length(), 1);
  const t0 = Math.min(0.45, inset / full), t1 = 1 - t0;
  const len = full * (t1 - t0);
  const side = new THREE.Vector3(-d.z, 0, d.x).normalize().multiplyScalar(width / 2);
  const n = Math.max(1, Math.ceil(len / STEP));
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * i / n, P = A.clone().lerp(B, t);
    if (field && t > 0 && t < 1) { const y = field.height(P.x, P.z, P.y + 28, P.y - 48); if (y !== null) P.y = y; }
    const l = P.clone().add(side), r = P.clone().sub(side);
    if (field) {
      const yl = field.height(l.x, l.z, P.y + 10, P.y - 10), yr = field.height(r.x, r.z, P.y + 10, P.y - 10);
      if (yl !== null) l.y = yl;
      if (yr !== null) r.y = yr;
    }
    pos.push(l.x, l.y + lift, l.z, r.x, r.y + lift, r.z);
    const v = uvEvery ? (len * i / n) / uvEvery : 0;
    uv.push(0, v, 1, v);
    if (i) { const k = 2 * i; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, material);
  mesh.renderOrder = renderOrder;
  return mesh;
}

function ring(THREE, at, color, r, order = 7) {
  const g = new THREE.RingGeometry(r * 0.7, r, 24);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide,
                                                             polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
  m.position.copy(at); m.position.y += 1;
  m.renderOrder = order;
  return m;
}

// stencil layers of a tested route: its area, its arrows (the network itself: path-lines.js, thin lines)
const ST_ROUTE = 2, ST_ROUTE_ARROWS = 4;

// A tested route: a bright line over the network, arrows sliding along it.
export function buildRouteView(THREE, pathData, route, T, floorAt, field) {
  const grp = new THREE.Group();
  const pts = (pathData && pathData.points) || {};
  const area = layerMaterial(THREE, { color: '#5fe3ff', opacity: 0.45 }, ST_ROUTE);
  const arrows = layerMaterial(THREE, { map: arrowTexture(THREE, '#e8fbff', false), opacity: 0.95, alphaTest: 0.05 }, ST_ROUTE_ARROWS);
  for (let i = 0; i + 1 < route.length; i++) {
    const A = floorAt(T(pts[route[i]].slice(1))), B = floorAt(T(pts[route[i + 1]].slice(1)));
    grp.add(stripMesh(THREE, A, B, 28, area, 1.0, 8, field));
    grp.add(stripMesh(THREE, A, B, 14, arrows, 1.2, 9, field, 0, 40));
  }
  if (route.length) {                                    // start and end
    grp.add(ring(THREE, floorAt(T(pts[route[0]].slice(1))), '#5fe3ff', 20, 10));
    grp.add(ring(THREE, floorAt(T(pts[route[route.length - 1]].slice(1))), '#ffffff', 20, 10));
  }
  return grp;
}

// arrows slide (one way: forward; two ways: still, they point both ways)
export function stepPathView(dt) {
  for (const t of texCache.values()) if (!t.userData.two) t.offset.y = (t.offset.y - dt * 1.2) % 1;
}
