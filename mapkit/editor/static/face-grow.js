// Face selection's Grow, as ProBuilder's Grow Selection: the faces that share an edge with the selected ones join
// them, only those in the same plane (within GROW_ANGLE of the face they touch) or all of them. A piece of an edge
// is enough: a wall split by BSP cuts meets its neighbours at T-junctions, where one long edge meets two short ones.
// From the triangles the 3D view draws (surface-ui.js: of each built mesh its positions, the face of each triangle
// and its world matrix), so a structure moved since the last Rebuild grows where it is seen. And the sides two faces
// share (sharedSides), the Texture Slip's edges, and the one rule that puts a face's polygons together again from those
// triangles (piecesFromFans). No page code here.

export const GROW_ANGLE = 5;          // degrees between two faces still in one plane
export const EDGE_TOLERANCE = 0.5;    // Unreal units: how far apart two edges may lie and still be one
const CELL = 256;                     // the side of the cells the selected faces are filed in, in Unreal units
const MAX_CELLS = 4096;               // a face whose box covers more cells is checked against every selected face
const SAME_POINT = 1e-3;              // two corners of one face this close are one
const SAME_END = 0.05;                // Unreal units: two overlaps on one line that end this near along it end together

// a corner of a mesh in the world: m, a 4x4 matrix as three.js keeps it (column by column), or none
function place(m, pos, i) {
  const x = pos[i], y = pos[i + 1], z = pos[i + 2];
  if (!m) return [x, y, z];
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
const samePoint = (a, b) => Math.abs(a[0] - b[0]) < SAME_POINT && Math.abs(a[1] - b[1]) < SAME_POINT && Math.abs(a[2] - b[2]) < SAME_POINT;
const sameSide = (s, o) => (samePoint(s[0], o[0]) && samePoint(s[1], o[1])) || (samePoint(s[0], o[1]) && samePoint(s[1], o[0]));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// A face's polygons put together again from its triangles ([[a, b, c], ...], in their order): data.py writes each
// polygon as a fan from its first corner, so a triangle whose first corner is the polygon's first and whose second is
// its last goes on it; any other starts a polygon of its own (two BSP pieces fanned from one corner stay two). The one
// rule for the view's triangles: Grow's outlines (faceShapes) and the Texture Slip's pieces (texture-slip.js piecesOf,
// with no piece numbers).
export function piecesFromFans(triangles) {
  const pieces = [];
  for (const [a, b, c] of triangles) {
    const last = pieces[pieces.length - 1];
    if (last && samePoint(a, last[0]) && samePoint(b, last[last.length - 1])) last.push(c);
    else pieces.push([a, b, c]);
  }
  return pieces;
}

// The faces as the meshes draw them: Map face id -> { tris: [[a, b, c], ...] in the world, lo and hi: its box, normal:
// a unit vector (its triangles weighed by their area; [0, 0, 0] when they have none), pieces: its polygons when its mesh
// gives them (else put together again from its triangles the first time its outline is asked for: piecesFromFans) }.
// meshes: [{ pos: x y z of every corner (three a triangle, in a row), faces: the face of each triangle (-1: none),
// matrix: the mesh's world matrix or null, pieces: none, or for a mesh with no matrix Map face id -> its polygons (each
// the list of its corners), taken as they are (the Texture Slip's BSP pieces) }]
export function faceShapes(meshes) {
  const shapes = new Map();
  for (const { pos, faces, matrix, pieces } of meshes) {
    for (let t = 0; t < faces.length; t++) {
      const id = faces[t];
      if (!(id >= 0)) continue;
      let s = shapes.get(id);
      if (!s) shapes.set(id, s = { tris: [], lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], normal: [0, 0, 0] });
      const a = place(matrix, pos, t * 9), b = place(matrix, pos, t * 9 + 3), c = place(matrix, pos, t * 9 + 6);
      s.tris.push([a, b, c]);
      for (const p of [a, b, c]) for (let k = 0; k < 3; k++) { if (p[k] < s.lo[k]) s.lo[k] = p[k]; if (p[k] > s.hi[k]) s.hi[k] = p[k]; }
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      s.normal[0] += u[1] * v[2] - u[2] * v[1]; s.normal[1] += u[2] * v[0] - u[0] * v[2]; s.normal[2] += u[0] * v[1] - u[1] * v[0];
    }
    for (const [id, polygons] of pieces || []) if (shapes.has(id)) shapes.get(id).pieces = polygons;
  }
  for (const s of shapes.values()) {
    const n = Math.hypot(...s.normal);
    if (n > 0) s.normal = s.normal.map((x) => x / n);
  }
  return shapes;
}

// a face's outline: the sides of its polygons (its mesh's, or put together again from its triangles and kept on the
// shape: only the faces Grow and the Texture Slip look at) that have a length and that no other side of it has (two
// pieces of a BSP cut share theirs; a piece that lists a corner twice runs back over a side of its own), worked out the
// first time it is asked for. Not from the fans' triangles: a piece that lists a corner twice has triangles with no area
// whose sides are its real sides again, which took those out (UNATCO Island's Brush284 face 164: a 152-unit side lost)
function outline(s) {
  if (s.edges) return s.edges;
  s.pieces ||= piecesFromFans(s.tris);
  const sides = s.pieces.flatMap((p) => p.map((c, i) => [c, p[(i + 1) % p.length]])).filter(([a, b]) => !samePoint(a, b));
  return (s.edges = sides.filter((side, i) => !sides.some((o, j) => j !== i && sameSide(side, o))));
}

// how far point p lies along a line (from a, dir a unit vector) and off it: [along, off] (the numbers one by one: it
// runs for every pair of edges compared)
function onLine(p, a, dir) {
  const x = p[0] - a[0], y = p[1] - a[1], z = p[2] - a[2], t = x * dir[0] + y * dir[1] + z * dir[2];
  return [t, Math.hypot(x - dir[0] * t, y - dir[1] * t, z - dir[2] * t)];
}
const lengthOf = (e) => Math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1], e[1][2] - e[0][2]);
const directionOf = (e) => e[1].map((x, k) => (x - e[0][k]) / lengthOf(e));
// Where two edges lie on one line and overlap by more than tol (touching at a corner is not enough): the overlap on
// each, [[from, to] on e, [from, to] on f], the points of the two side by side (along the longer from its first corner
// on), which may lie up to tol apart (the view's rounding, a corner the engine left a little off); null where they do not.
function overlap(e, f, tol) {
  const longer = lengthOf(e) >= lengthOf(f), [long, short] = longer ? [e, f] : [f, e];
  const a = long[0], len = lengthOf(long);
  if (len <= tol) return null;
  const dir = long[1].map((x, k) => (x - a[k]) / len), along = [];
  for (const p of short) {
    const [t, off] = onLine(p, a, dir);
    if (off > tol) return null;                     // off the line
    along.push(t);
  }
  const from = Math.max(0, Math.min(...along)), to = Math.min(len, Math.max(...along));
  if (to - from <= tol) return null;
  // the longer edge's point at t along it, and the shorter's beside it
  const onLong = (t) => a.map((x, k) => x + dir[k] * t);
  const onShort = (t) => short[0].map((x, k) => x + (short[1][k] - x) * (t - along[0]) / (along[1] - along[0]));
  const sides = [[onLong(from), onLong(to)], [onShort(from), onShort(to)]];
  return longer ? sides : sides.reverse();
}

const boxesMeet = (s, o, tol) => [0, 1, 2].every((k) => s.lo[k] <= o.hi[k] + tol && o.lo[k] <= s.hi[k] + tol);
// the edges of o's outline whose box meets face s's box (grown by tol): the only ones that can lie on an edge of s
const edgesNear = (o, s, tol) => outline(o).filter((f) => boxesMeet({ lo: f[0].map((x, k) => Math.min(x, f[1][k])), hi: f[0].map((x, k) => Math.max(x, f[1][k])) }, s, tol));

// whether faces s and o (faceShapes') share a piece of an edge longer than tol (it stops at the first)
export function touching(s, o, tol = EDGE_TOLERANCE) {
  if (!boxesMeet(s, o, tol)) return false;
  const near = edgesNear(o, s, tol);
  return near.length > 0 && outline(s).some((e) => near.some((f) => overlap(e, f, tol)));
}
// The sides faces s and o (faceShapes') share, one for each line their outlines' edges overlap on (a face set in
// another shares four), in the order of their longest overlap: each [[from, to] on s's outline, [from, to] on o's], the
// points of their edges side by side, the overlaps on its line from the first end to the last (a T-junction cuts it
// where one face has two edges along the other's one, a doorway leaves a gap: the whole of it; where several end
// together (SAME_END), the one whose two points lie nearest each other: a face may have two edges a hair apart there);
// none when they share no piece of an edge longer than tol. An overlap goes on a line only when its points lie on it as
// each face has it, so a seam kinked on one face and straight on the other is two sides either way; the other sides may
// still depend on which face is s (the lines are made from the overlaps in the order of their length on s). Every pair
// of edges looked at (touching stops at the first).
export function sharedSides(s, o, tol = EDGE_TOLERANCE) {
  if (!boxesMeet(s, o, tol)) return [];
  const near = edgesNear(o, s, tol);
  const all = edgesNear(s, o, tol).flatMap((e) => near.map((f) => overlap(e, f, tol)).filter(Boolean));
  all.sort((x, y) => lengthOf(y[0]) - lengthOf(x[0]));
  // each line from its longest overlap (a corner and a direction on s's edge, b and dirB on o's), and the overlaps' ends
  // on it, [how far along it, on s, on o]: the first and the last (way -1 and 1: an end beyond, or as far with its two
  // points nearer each other)
  const gap = (end) => lengthOf([end[1], end[2]]);
  const beyond = (end, than, way) => way * (end[0] - than[0]) > SAME_END || (Math.abs(end[0] - than[0]) <= SAME_END && gap(end) < gap(than));
  const lines = [];
  for (const [[s0, s1], [o0, o1]] of all) {
    const on = (line) => onLine(s0, line.a, line.dir)[1] <= tol && onLine(s1, line.a, line.dir)[1] <= tol
      && onLine(o0, line.b, line.dirB)[1] <= tol && onLine(o1, line.b, line.dirB)[1] <= tol;
    let line = lines.find(on);
    if (!line) lines.push(line = { a: s0, dir: directionOf([s0, s1]), b: o0, dirB: directionOf([o0, o1]), first: null, last: null });
    for (const end of [[onLine(s0, line.a, line.dir)[0], s0, o0], [onLine(s1, line.a, line.dir)[0], s1, o1]]) {
      if (!line.first || beyond(end, line.first, -1)) line.first = end;
      if (!line.last || beyond(end, line.last, 1)) line.last = end;
    }
  }
  return lines.map(({ first, last }) => [[first[1], last[1]], [first[2], last[2]]]);
}

// the cells of CELL units a face's box (grown by tol) covers, by number; null when they are more than MAX_CELLS
function cellsOf(s, tol) {
  const lo = s.lo.map((x) => Math.floor((x - tol) / CELL)), hi = s.hi.map((x) => Math.floor((x + tol) / CELL));
  if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > MAX_CELLS) return null;
  const out = [];
  // a cell's number: its three places, each moved to be positive, side by side (a million units each way fit)
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++)
    out.push(((x + 4096) * 8192 + (y + 4096)) * 8192 + (z + 4096));
  return out;
}

// One step of Grow: the faces of `shapes` (faceShapes') not in `chosen` (a Set of face ids) that share an edge with
// a chosen face, within maxAngle degrees of it (180 or more: any angle). [their ids], in the order of `shapes`
export function growFaces(shapes, chosen, { maxAngle = GROW_ANGLE, tol = EDGE_TOLERANCE } = {}) {
  const least = maxAngle >= 180 ? -Infinity : Math.cos(maxAngle * Math.PI / 180) - 1e-9;
  const filed = new Map(), wide = [];                    // the chosen faces by cell; those too big to file
  for (const id of chosen) {
    const s = shapes.get(id);
    if (!s) continue;
    const cells = cellsOf(s, tol);
    if (!cells) { wide.push(s); continue; }
    for (const c of cells) { if (!filed.has(c)) filed.set(c, []); filed.get(c).push(s); }
  }
  const all = [...chosen].map((id) => shapes.get(id)).filter(Boolean), out = [];
  for (const [id, s] of shapes) {
    if (chosen.has(id)) continue;
    const cells = cellsOf(s, tol), seen = new Set();
    const near = cells ? [...wide, ...cells.flatMap((c) => filed.get(c) || [])] : all;
    for (const o of near) {
      if (seen.has(o)) continue;
      seen.add(o);
      if (dot(s.normal, o.normal) >= least && touching(s, o, tol)) { out.push(id); break; }
    }
  }
  return out;
}
