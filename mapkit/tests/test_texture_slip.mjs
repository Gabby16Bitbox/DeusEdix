// Texture Slip (static/texture-slip.js): a face's mapping after the Surface panel's queued operations exactly as the
// host's UC_SURFACE leaves it (UCEngineBridge.cpp editSurface), or the refusal that fails Save (surfaces.py) or the
// Rebuild (the host), a face's normal from its BSP pieces, the rows a Rebuild has not shown yet (indexed once for many
// faces), and the slip itself: the texture following the pointer on walls, floors, ceilings and slopes, scaled round
// the point under the pointer (each face its own pan, so one texture over several faces stays one, round a room's
// corners and a column too, carried round the edges where it runs on, a whole room or crate selected), the snaps, the
// rows it queues (within the map's room) and the preview of every face selected. The faces are real ones of the
// Feature Lab map (Feature Test project: polys.json, brushes.json and the UVs data.py wrote in geometry.json, the
// room's floor and ceiling in fixtures/texture_slip_lab_room.json), with mappings turned, flipped, panned and of other
// tiles made from them, and of the Tutorial and NYC Underground maps; seams of original maps whose texture runs on over
// them in fixtures/texture_slip_real_seams.json (NYC Ship Below, Underground, UNATCO HQ and Island, Wan Chai Market),
// slipped once and slipped again and again, each slip from the exact mappings the one before left (a ring parting again
// where it parted while its texture still steps there, a corner lined up since staying closed, a face set in another
// parting where its texture steps, a side's drift judged at the scale the faces were built at, whatever is queued or
// rebuilt between the slips, a structure moved too; an Undo takes back what the slips it undoes knew; the exact
// mappings of the map's state now, each face's moved by a Pan of it, dropped by any other change to it); the walk's
// heap on its own.
// Then the page's side: slips folded into the rows before them (the map holds 4096: the room counts what a slip adds
// after the fold), its room said, faces grouped by value, the arrows and the wheel (its notch learnt after a pause), a
// face's pieces from the view's triangles and every face's mapping as its queued rows leave it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mappingOf, numsOf, texelOf, uvOf, faceNormal, piecesNormal, sourceNormal, mappingAfter, indexRows, rowsFor, mappingNow,
  pendingRows, isRefusal, rowProblem, queueProblem, startSlip, rayPoint, slipPan, slipNudge, slipScale, slipMods,
  slipResult, slipHud, snapStep, PAN_LIMIT, SCALE_MIN, SCALE_MAX, SNAP_PARTS, FINE_DRAG, ROW_LIMIT, TARGET_LIMIT, SLIP_ROWS,
  slipSummary, splitTargets, roomNote, ROOM_WARN, foldRows, arrowNudge, wheelNotches, learnNotch, piecesOf, pendingMappings,
  groupBy, heapOf, crossedFirst, exactAgain, exactsNow, exactsKept, keptBefore, keptSlip,
} from '../editor/static/texture-slip.js';

// ---------------------------------------------------------------- real faces and helpers

// data.py's 13 numbers of the polygon, its corners, its brush's csg and the UVs of its first triangle (corners 0 1 2)
const LAB = {
  // the side of a ramp (an added brush): sloped, its base off its plane
  slope: { brush: 'Brush41', poly: 0, csg: 1,
    nums: [68.1352, -192.855, 154.655, 0.50342, 0.75342, 0, 0.68716, -0.45914, -0.56303, 0, 0, 128, 128],
    points: [[252, -252, 28.1178], [274.023, -274.023, 7.30756], [266.059, -285.941, 7.30756], [237.285, -274.023, 28.1178]],
    uv: [[0.375, 1.7558], [0.332, 2.0446], [0.2305, 2.0446]] },
  // a wall of an added brush, facing +x
  wall: { brush: 'Brush212', poly: 1, csg: 1, nums: [64, 400, 0, -0, -1, -0, -0, -0, -1, 0, 0, 128, 128],
    points: [[64, 528, 0], [64, 528, 96], [64, 272, 0]], uv: [[-1, 0], [-1, -0.75], [1, 0]] },
  // the room (a subtractive brush): its floor, a wall with its texture twice as large, its ceiling half as large
  floor: { brush: 'Brush2', poly: 4, csg: 2, nums: [0, 0, 0, 1, -0, -0, -0, 1, -0, 0, 0, 128, 128],
    points: [[149.014, 200, 0], [209.49, 290.51, 0], [74.0329, 200, 0]], uv: [[1.1642, 1.5625], [1.6366, 2.2696], [0.5784, 1.5625]] },
  roomWall: { brush: 'Brush2', poly: 3, csg: 2, nums: [0, 1024, 0, -0.5, 0, 0, 0, 0, -0.5, 0, 0, 128, 128],
    points: [[64, 1024, 0], [1024, 1024, 0], [1024, 1024, 73.7717], [476.333, 1024, 384], [64, 1024, 384]],
    uv: [[-0.25, 0], [-4, 0], [-4, -0.2882]] },
  ceiling: { brush: 'Brush2', poly: 5, csg: 2, nums: [0, 0, 384, 2, 0, 0, 0, -2, 0, 0, 0, 128, 128],
    points: [[64, 1024, 384], [476.333, 1024, 384], [64, 406.9, 384]], uv: [[1, -16], [7.4427, -16], [1, -6.3578]] },
};
const face = (name, id = name) => ({ id, brush: LAB[name].brush, poly: LAB[name].poly, mapping: mappingOf(LAB[name].nums) });
// the same plane, another mapping: a door frame texture (64 x 128) panned on the wall; the wall's mapping turned; the
// floor's mirrored; a 128 texture with Scale 2 (a tile of 256) and a 64 one with Scale 1/3 (21.3333, as the dump's %g)
const DOOR = { ...face('wall', 'door'), poly: 7, mapping: mappingOf([64, 400, 0, 0, -1, 0, 0, 0, -1, 16, -40, 64, 128]) };
const TURNED = { ...face('wall', 'turned'), mapping: mappingAfter(face('wall').mapping, [{ op: 'rotate' }]) };
const MIRRORED = { ...face('floor', 'mirrored'), mapping: mappingAfter(face('floor').mapping, [{ op: 'flip-u' }]) };
const BIG = { ...face('floor', 'big'), poly: 9, mapping: mappingOf([0, 0, 0, 1, 0, 0, 0, 1, 0, 30, 0, 256, 256]) };
const THIRD = { ...face('floor', 'third'), poly: 10, mapping: mappingOf([0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 5, 21.3333, 21.3333]) };
// a U that leaves the wall's plane (the engine allows it: only its part along the plane shows)
const OBLIQUE = { ...face('wall', 'oblique'), mapping: mappingOf([64, 400, 0, 0.5, -1, 0, 0, 0, -1, 0, 0, 128, 128]) };
// each face of a case: its corners (to find points on it) and its mapping
const CASES = [
  ['an added wall', face('wall'), LAB.wall.points], ['a room wall (texture twice as large)', face('roomWall'), LAB.roomWall.points],
  ['a floor', face('floor'), LAB.floor.points], ['a ceiling (half as large)', face('ceiling'), LAB.ceiling.points],
  ['a slope', face('slope'), LAB.slope.points], ['a non-square texture, panned', DOOR, LAB.wall.points],
  ['a turned mapping', TURNED, LAB.wall.points], ['a flipped mapping', MIRRORED, LAB.floor.points],
  ['a texture with Scale 2', BIG, LAB.floor.points], ['a texture with Scale 1/3', THIRD, LAB.floor.points],
  ['a U leaving the plane', OBLIQUE, LAB.wall.points],
];

const add = (a, b) => a.map((x, k) => x + b[k]);
const sub = (a, b) => a.map((x, k) => x - b[k]);
const times = (a, f) => a.map((x) => x * f);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => times(a, 1 / Math.hypot(...a));
const near = (a, b, tol = 1e-9, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b} (within ${tol})`);
const nearList = (a, b, tol = 1e-9, what = '') => { assert.equal(a.length, b.length, what); a.forEach((x, k) => near(x, b[k], tol, `${what}[${k}]`)); };
const nearMapping = (a, b, tol = 1e-9, what = 'mapping') => nearList(numsOf(a), numsOf(b), tol, what);
// a point of a face: from its first corner, a parts of the way to the second and b to the last
const pointOn = (points, a, b) => add(points[0], add(times(sub(points[1], points[0]), a), times(sub(points[points.length - 1], points[0]), b)));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// a step on a face's plane: x along its first side, y across it (Unreal units)
function step(points, x, y) {
  const n = faceNormal(points), side = sub(points[1], points[0]), e1 = unit(sub(side, times(n, dot(side, n)))), e2 = cross(n, e1);
  return add(times(e1, x), times(e2, y));
}
// how far apart two texels show, whole repeats of the tile apart
const apart = (a, b, tile) => { const tiles = (a - b) / tile; return Math.abs(tiles - Math.round(tiles)) * tile; };
// texel shows within tol texels of want, give or take whole repeats of m's texture
function showsTexel(m, p, want, tol, what = '') {
  const a = texelOf(m, p);
  for (let k = 0; k < 2; k++) {
    const off = apart(a[k], want[k], m.tile[k]);
    assert.ok(off <= tol, `${what} axis ${k}: texel ${a[k]} vs ${want[k]} (${off} texels apart, tile ${m.tile[k]})`);
  }
}
// m1 shows at p1 the texel m0 showed at p0: give or take tol texels and whole repeats of the texture
const sameTexel = (m1, p1, m0, p0, tol, what = '') => showsTexel(m1, p1, texelOf(m0, p0), tol, what);
const slipOn = (f, points, at = pointOn(points, 0.3, 0.3), faces = [f], ref = 0) =>
  startSlip({ faces, ref, point: at, normal: faceNormal(points) });
// the host as UCEngineBridge.cpp's editSurface does pan and scale, on the 13 numbers (an oracle apart from the module)
function host(nums, row) {
  const n = nums.slice(), [x, y] = row.args;
  if (row.op === 'scale') { for (let k = 3; k < 6; k++) n[k] /= x; for (let k = 6; k < 9; k++) n[k] /= y; }
  if (row.op === 'pan') { n[9] += Math.trunc(x); n[10] += Math.trunc(y); }
  return n;
}
// surfaces.py's checks of a pan or scale row
function valid(row) {
  if (row.op === 'pan') return row.args.every((v) => Number.isInteger(v) && Math.abs(v) <= PAN_LIMIT);
  if (row.op === 'scale') return row.args.every((v) => Number.isFinite(v) && v >= SCALE_MIN && v <= SCALE_MAX);
  return false;
}
const keyOf = (t) => `${t.brush}|${t.poly}`;
// The Feature Lab room's four walls (Brush2, a subtractive brush: seen from inside, a doorway in the east one), their
// mappings and their BSP pieces as the 3D view has them (geometry.json): one texture running round the room, whole tiles
// apart at each corner (8), 32 tiles round it
const ROOM = {
  north: { poly: 3, nums: [0, 1024, 0, -0.5, 0, 0, 0, 0, -0.5, 0, 0, 128, 128], pieces: [
    [[64, 1024, 0], [1024, 1024, 0], [1024, 1024, 73.77], [476.33, 1024, 384], [64, 1024, 384]],
    [[64, 1024, 0], [64, 1024, 384], [-1024, 1024, 384], [-1024, 1024, 0]], [[1024, 1024, 73.77], [1024, 1024, 384], [476.33, 1024, 384]]] },
  east: { poly: 1, nums: [1024, 0, 0, 0, 0.5, 0, 0, 0, -0.5, 0, 0, 128, 128], pieces: [
    [[1024, 1024, 73.77], [1024, 1024, 0], [1024, 829.09, 0]], [[1024, -1024, 384], [1024, -96, 384], [1024, -96, 0], [1024, -1024, 0]],
    [[1024, 96, 384], [1024, 1024, 384], [1024, 1024, 73.77], [1024, 829.09, 0], [1024, 96, 0]],
    [[1024, -96, 160], [1024, -96, 384], [1024, 96, 384], [1024, 96, 160]]] },
  south: { poly: 2, nums: [0, -1024, 0, 0.5, 0, 0, 0, 0, -0.5, 0, 0, 128, 128], pieces: [
    [[-892.1, -1024, 384], [-553.15, -1024, 192], [-1024, -1024, 192], [-1024, -1024, 384]],
    [[-553.15, -1024, 192], [-214.2, -1024, 0], [-1024, -1024, 0], [-1024, -1024, 192]],
    [[-892.1, -1024, 384], [1024, -1024, 384], [1024, -1024, 0], [-214.2, -1024, 0]]] },
  west: { poly: 0, nums: [-1024, 0, 0, 0, -0.5, 0, 0, 0, -0.5, 0, 0, 128, 128], pieces: [
    [[-1024, 267.93, 0], [-1024, 1024, 0], [-1024, 1024, 384], [-1024, 267.93, 384]],
    [[-1024, 267.93, 192], [-1024, 267.93, 384], [-1024, -1024, 384], [-1024, -1024, 192]],
    [[-1024, 267.93, 0], [-1024, 267.93, 192], [-1024, -1024, 192], [-1024, -1024, 0]]] },
};
const wallOf = (name) => ({ id: name, brush: 'Brush2', poly: ROOM[name].poly, mapping: mappingOf(ROOM[name].nums), pieces: ROOM[name].pieces });
// how far two faces' textures part at a point of the edge they share: the more of their two axes, give or take whole
// repeats
const parting = (a, b, p) => Math.max(...[0, 1].map((k) => apart(texelOf(a, p)[k], texelOf(b, p)[k], a.tile[k])));
// the room's floor and ceiling as the 3D view has them (their BSP pieces: 66 and 5), and its six faces in the order
// Select whole brush lists them, by the view's face id (floor 2, north 4, ceiling 5, east 6, west 140, south 171); its
// corners: the walls either side, a point of the edge on the floor
const LAB_ROOM = JSON.parse(readFileSync(new URL('./fixtures/texture_slip_lab_room.json', import.meta.url), 'utf8'));
const roomFace = (name) => (ROOM[name] ? wallOf(name)
  : { id: name, brush: LAB_ROOM[name].brush, poly: LAB_ROOM[name].poly, mapping: mappingOf(LAB_ROOM[name].map), pieces: LAB_ROOM[name].pieces });
const WHOLE_ROOM = ['floor', 'north', 'ceiling', 'east', 'west', 'south'];
const CORNERS = [['north', 'east', [1024, 1024]], ['east', 'south', [1024, -1024]], ['south', 'west', [-1024, -1024]], ['west', 'north', [-1024, 1024]]];
// a face of these corners aligned as the panel's Floor or Wall aligns it (op: 'floor' or 'wall'), from a blank mapping
const BLANK = mappingOf([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 128, 128]);
const aligned = (id, brush, poly, points, op) => ({ id, brush, poly, pieces: [points], mapping: mappingAfter(BLANK, [{ op }], { normal: faceNormal(points), points }) });
// a column of 12 sides (Brush70, faces 0 to 11, ids their numbers), seen from outside, 64 texels a side (6 tiles round),
// 128 high; its caps (faces 12 and 13, ids 'top' and 'bottom') aligned with Floor
const SIDES = 12, columnCorner = (i) => [200 * Math.cos(2 * Math.PI * i / SIDES), 200 * Math.sin(2 * Math.PI * i / SIDES), 0];
const columnSides = () => Array.from({ length: SIDES }, (_, i) => {
  const a = columnCorner(i), b = columnCorner(i + 1), along = sub(b, a), length = Math.hypot(...along);
  return { id: i, brush: 'Brush70', poly: i, pieces: [[a, b, add(b, [0, 0, 128]), add(a, [0, 0, 128])]],
    mapping: mappingOf([...a, ...times(along, 64 / length / length), 0, 0, -1, 64 * i, 0, 128, 128]) };
});
const columnCaps = () => [aligned('top', 'Brush70', SIDES, Array.from({ length: SIDES }, (_, i) => add(columnCorner(i), [0, 0, 128])), 'floor'),
  aligned('bottom', 'Brush70', SIDES + 1, Array.from({ length: SIDES }, (_, i) => columnCorner(SIDES - i)), 'floor')];
// a crate, an added box 128 a side (Brush50), each face's corners seen from outside: Floor on its top and bottom, Wall on
// its sides, as the panel aligns them. The sides' texture runs on round it, and onto the top and the bottom over the
// north side's edges only, its V meeting theirs mirrored there.
const CRATE = {
  top: [[0, 0, 128], [128, 0, 128], [128, 128, 128], [0, 128, 128]], bottom: [[0, 0, 0], [0, 128, 0], [128, 128, 0], [128, 0, 0]],
  south: [[0, 0, 0], [128, 0, 0], [128, 0, 128], [0, 0, 128]], east: [[128, 0, 0], [128, 128, 0], [128, 128, 128], [128, 0, 128]],
  north: [[128, 128, 0], [0, 128, 0], [0, 128, 128], [128, 128, 128]], west: [[0, 128, 0], [0, 0, 0], [0, 0, 128], [0, 128, 128]],
};
const crateFace = (name, poly) => aligned(name, 'Brush50', poly, CRATE[name], name === 'top' || name === 'bottom' ? 'floor' : 'wall');
// how far the seam of two faces moved after a slip (mappings before [a, b] and after), at points of the side they share
// (side: [from, to] on a's edge, then on b's: the points of the two side by side), whole repeats taken off: the more of
// its two axes, at its ends and its middle
function seamMoved([a0, b0], [a1, b1], side) {
  return Math.max(...[0, 0.5, 1].flatMap((t) => {
    const on = (s) => add(s[0], times(sub(s[1], s[0]), t));
    const before = sub(texelOf(a0, on(side[0])), texelOf(b0, on(side[1]))), after = sub(texelOf(a1, on(side[0])), texelOf(b1, on(side[1])));
    return [0, 1].map((k) => apart(after[k], before[k], a1.tile[k]));
  }));
}
// A slip kept as the page keeps it (texture-slip-ui.js): from the mappings the queue leaves the faces, what the slips
// kept before know of them (keptBefore) and the exact mappings of the state now (exactsNow), its preview asked for as
// the page asks for the slip it keeps, its rows folded into the queue, what it leaves known (keptSlip) and the exact
// mappings of the state it makes (exactsKept, with the queue folded; nothing when it has no rows). page: { faces: as
// built, queue, kept: keptSlip's, none; exacts: exactsKept's, none }; slip: [ref, point, notches, normal (none: the
// face's pieces'), drag (none: the pointer still; a step on the plane from the point)]; plain: one pan for all (P). {
// page: as it leaves it, r: slipResult's, faces: the slip's (startSlip's) }. An Undo is the page before (the history
// gives back its queue and what the slips knew, kept and exacts, together)
function keepSlip(page, [ref, point, notches, normal = piecesNormal(page.faces[ref].pieces), drag], plain = false) {
  const now = page.faces.map((f) => ({ ...f, mapping: mappingNow(f, page.queue) })), exacts = exactsNow(page.exacts, now, page.queue);
  const faces = now.map((f, k) => ({ ...f, exact: exacts[k], ...keptBefore(page.kept, f, page.faces[k].mapping) }));
  const s = startSlip({ faces, ref, point, normal });
  const r = slipResult(slipScale(drag ? slipPan(s, add(point, drag)) : s, notches), { queue: page.queue, exact: true, plain });
  const queue = foldRows(page.queue, r.rows), slipped = r.rows.length > 0;
  return { page: { ...page, queue, kept: slipped ? keptSlip(page.kept, faces) : page.kept,
    exacts: slipped ? exactsKept(page.exacts, faces, r.preview, queue) : page.exacts }, r, faces };
}
// Slips kept one after the other (keepSlip). slips: keepSlip's, in turn; after(queue, result, i, faces, from): called
// after each (faces: the faces as built then, from: their mappings the slip started from); queue: the rows queued
// before the first; between(page, i): what the page does after slip i, given { faces, queue, kept, exacts } and giving
// them as they are then (undoRedo, pushed, rebuilt). The page at the end.
function keepSlips(faces, slips, after = () => {}, { queue = [], between = (page) => page } = {}) {
  let page = { faces, queue, kept: null, exacts: null };
  slips.forEach((slip, i) => {
    const kept = keepSlip(page, slip);
    after(kept.page.queue, kept.r, i, kept.page.faces, kept.faces.map((f) => f.mapping));
    page = between(kept.page, i);
  });
  return page;
}
// what the page may do between two slips kept (keepSlips' between): an Undo and a Redo (the queue made again, the
// history's exact mappings of it the same); a row of the Surface panel on every face pushed onto the queue; a Rebuild
// (each face built as the queue leaves it, its numbers to the dump's 6 digits, nothing queued; what the slips know of
// the faces and the exact mappings of the state now stay, by their brushes and polygons)
const undoRedo = (page) => ({ ...page, queue: JSON.parse(JSON.stringify(page.queue)) });
const pushed = (row) => (page) => ({ ...page, queue: [...page.queue, { ...row, targets: page.faces.map(({ brush, poly }) => ({ brush, poly })) }] });
const rebuilt = (page) => ({ ...page, queue: [], faces: page.faces.map((f) => ({ ...f,
  mapping: mappingOf(numsOf(mappingNow(f, page.queue)).map((x) => Number(x.toPrecision(6))), f.tex) })) });
// faces of original maps whose texture runs on over the side they share, as the view has them (fix5_fixture.mjs)
const REAL = JSON.parse(readFileSync(new URL('./fixtures/texture_slip_real_seams.json', import.meta.url), 'utf8'));

// ---------------------------------------------------------------- mappings

test('the UVs of real faces are those data.py wrote for the 3D view', () => {
  for (const [name, f] of Object.entries(LAB)) {
    const m = mappingOf(f.nums);
    f.uv.forEach((uv, j) => nearList(uvOf(m, f.points[j]), uv, 1e-3, `${name} corner ${j}`));
    assert.deepEqual(numsOf(m), f.nums);
  }
  // a face without a texture: data.py's tile of 128; the dump names its texture 'none', which One Tile cannot fit
  assert.deepEqual(mappingOf([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0]).tile, [128, 128]);
  assert.equal(mappingOf(LAB.wall.nums, 'none').bare, true);
  assert.equal(mappingOf(LAB.wall.nums, 'Pkg.Wall').bare, undefined);
  // a tile kept to the dump's 6 digits is the fraction it stands for (64 at Scale 1/3: 64 / 3); one off it by more
  // than the dump's rounding, or that makes no whole texels within 64 repeats, stays as it is
  const tiles = (w, h) => mappingOf([...LAB.wall.nums.slice(0, 11), w, h]).tile;
  assert.deepEqual(tiles(21.3333, 42.6667), [64 / 3, 128 / 3]);
  assert.deepEqual(tiles(6.4, 1228.8), [32 / 5, 6144 / 5]);
  assert.deepEqual(tiles(21.3335, 13.7913), [21.3335, 13.7913]);
  // the texel: the base point shows the pan
  nearList(texelOf(DOOR.mapping, [64, 400, 0]), [16, -40]);
  nearList(texelOf(DOOR.mapping, [64, 380, 10]), [36, -50]);
  // a texture 64 wide and 128 high: each texel over its own side
  nearList(uvOf(DOOR.mapping, [64, 380, 10]), [36 / 64, -50 / 128]);
  // what is not a mapping (null: only a Rebuild shows the face; a refusal) says so
  assert.throws(() => texelOf(null, [0, 0, 0]), /texelOf: null is not a mapping/);
  assert.throws(() => uvOf({ refused: 'Pan exceeds', row: {} }, [0, 0, 0]), /a refusal \(Pan exceeds\) is not a mapping/);
});

test('pan, scale, rotate and flips do what the host does to a face, or the refusal that fails Save or the Rebuild', () => {
  const m = DOOR.mapping, p = [64, 431, 57];
  const panned = mappingAfter(m, [{ op: 'pan', args: [16, -8] }]);
  assert.deepEqual(panned.pan, [32, -48]);
  assert.deepEqual([panned.base, panned.u, panned.v, panned.tile], [m.base, m.u, m.v, m.tile]);
  // beyond the engine's 16 bits the host refuses the face, and the whole Rebuild fails: a refusal with its reason, row
  // and stage
  const far = { ...m, pan: [32760, 0] }, over = { op: 'pan', args: [10, 0] };
  assert.deepEqual(mappingAfter(far, [over]), { refused: "Pan exceeds the engine's signed 16-bit range", row: over, stage: 'rebuild' });
  assert.ok(isRefusal(mappingAfter(far, [over])));
  assert.ok(isRefusal(mappingAfter({ ...m, pan: [0, -32760] }, [{ op: 'pan', args: [0, -8] }])));
  assert.deepEqual(mappingAfter(far, [{ op: 'pan', args: [7, 0] }]).pan, [32767, 0]);
  assert.deepEqual(mappingAfter({ ...m, pan: [-32760, 0] }, [{ op: 'pan', args: [-7, 0] }]).pan, [-32767, 0]);
  // a refusal stays one: given back, and after more rows
  const refusal = mappingAfter(far, [over]);
  assert.equal(mappingAfter(refusal, [{ op: 'flip-u' }]), refusal);
  assert.equal(mappingAfter(far, [over, { op: 'pan', args: [-20, 0] }]).row, over);
  // surfaces.py refuses (before any face) a pan not of whole texels or beyond the bits, a scale out of its range: the
  // map cannot be saved with it
  assert.match(mappingAfter(m, [{ op: 'pan', args: [2.7, -2.7] }]).refused, /whole texels/);
  assert.equal(mappingAfter(m, [{ op: 'pan', args: [2.7, -2.7] }]).stage, 'save');
  assert.match(mappingAfter(m, [{ op: 'pan', args: [32768, 0] }]).refused, /whole texels/);
  assert.deepEqual(mappingAfter({ ...m, pan: [0, 0] }, [{ op: 'pan', args: [32767, -32767] }]).pan, [32767, -32767]);
  // scale: U and V divided, round the base point (its texel stays the pan)
  const scaled = mappingAfter(m, [{ op: 'scale', args: [2, 0.5] }]);
  nearList(scaled.u, [0, -0.5, 0]); nearList(scaled.v, [0, 0, -2]);
  assert.deepEqual([scaled.base, scaled.pan], [m.base, m.pan]);
  nearList(texelOf(scaled, m.base), m.pan);
  for (const bad of [[0, 1], [1, 1001], [0.0009, 1]]) {
    const r = mappingAfter(m, [{ op: 'scale', args: bad }]);
    assert.equal(r.refused, 'Scale factors must be between 0.001 and 1000.', JSON.stringify(bad));
  }
  nearList(mappingAfter(m, [{ op: 'scale', args: [SCALE_MIN, SCALE_MAX] }]).u, [0, -1000, 0]);
  assert.match(mappingAfter(m, [{ op: 'scale', args: [2] }]).refused, /finite numbers/);
  // a quarter turn: U takes V and V takes -U, the pans with them; what showed at t now shows at s
  const turned = mappingAfter(m, [{ op: 'rotate' }]);
  assert.deepEqual([turned.u, turned.v, turned.pan], [m.v, [0, 1, 0], [-40, -16]]);
  nearList(texelOf(turned, p), [texelOf(m, p)[1], -texelOf(m, p)[0]]);
  nearMapping(mappingAfter(m, Array(4).fill({ op: 'rotate' })), m);
  assert.match(mappingAfter(m, [{ op: 'rotate', args: [1] }]).refused, /takes no arguments/);
  // flips: one axis and its pan the other way: the texel mirrored
  const fu = mappingAfter(m, [{ op: 'flip-u' }]), fv = mappingAfter(m, [{ op: 'flip-v' }]);
  assert.deepEqual([fu.u, fu.pan], [[0, 1, 0], [-16, -40]]);
  assert.deepEqual([fv.v, fv.pan], [[0, 0, 1], [16, 40]]);
  nearList(texelOf(fu, p), [-texelOf(m, p)[0], texelOf(m, p)[1]]);
  nearMapping(mappingAfter(m, [{ op: 'flip-v' }, { op: 'flip-v' }]), m);
  // no -0 in a mapping: a flip of a pan of 0
  assert.ok(!Object.is(mappingAfter(face('wall').mapping, [{ op: 'flip-u' }]).pan[0], -0));
  // shadows and Look leave the mapping
  assert.deepEqual(mappingAfter(m, [{ op: 'shadows', args: ['high'] }, { op: 'flags', args: [4, 0] }]), m);
});

test('Floor, Wall and One Tile as the host aligns them, from the source polygon', () => {
  // the source polygon's normal: the visible one, the other way on a subtractive brush (the CSG reversed it)
  nearList(sourceNormal(LAB.wall.points, 1), [1, 0, 0]);
  nearList(faceNormal(LAB.floor.points), [0, 0, 1]);
  nearList(sourceNormal(LAB.floor.points, 2), [0, 0, -1]);
  nearList(faceNormal(LAB.ceiling.points), [0, 0, -1]);
  nearList(sourceNormal(LAB.ceiling.points, 2), [0, 0, 1]);
  nearList(faceNormal(LAB.roomWall.points), [0, -1, 0]);
  nearList(sourceNormal(LAB.roomWall.points, 2), [0, 1, 0]);
  const shape = (name) => ({ normal: sourceNormal(LAB[name].points, LAB[name].csg), points: LAB[name].points });
  const align = (name, op) => mappingAfter({ ...mappingOf(LAB[name].nums), pan: [5, 6] }, [{ op }], shape(name));
  // Wall on an added wall: along it, V down, the base where the plane meets the x axis
  const wall = align('wall', 'wall');
  nearMapping(wall, mappingOf([64, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 128, 128]));
  // Floor on the room's floor: U along x, V along y
  nearMapping(align('floor', 'floor'), mappingOf([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 128, 128]));
  // Wall on the room's wall: from its source normal (+y), U along +x (the map script had it along -x)
  nearMapping(align('roomWall', 'wall'), mappingOf([0, 1024, 0, 1, 0, 0, 0, 0, -1, 0, 0, 128, 128]));
  // Wall on a ceiling (level): as Floor
  nearMapping(align('ceiling', 'wall'), mappingOf([0, 0, 384, 1, 0, 0, 0, 1, 0, 0, 0, 128, 128]));
  // Floor on a wall facing x: no x axis on it, U along y
  nearMapping(align('wall', 'floor'), mappingOf([64, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 128, 128]));
  // a normal of any length: the host's SafeNormal
  const long = { normal: times(sourceNormal(LAB.slope.points, 1), 5), points: LAB.slope.points };
  nearMapping(mappingAfter(face('slope').mapping, [{ op: 'wall' }], long), align('slope', 'wall'), 1e-12);
  // Floor on the slope: U the x axis laid on the plane, V = U x n, the base on the plane along the normal
  const n = sourceNormal(LAB.slope.points, 1), slope = align('slope', 'floor');
  near(dot(slope.u, n), 0); near(Math.hypot(...slope.u), 1);
  nearList(slope.u, unit([1 - n[0] * n[0], -n[0] * n[1], -n[0] * n[2]]));
  nearList(slope.v, cross(slope.u, n));
  nearList(slope.base, times(n, dot(LAB.slope.points[2], n)), 1e-3);
  assert.deepEqual(slope.pan, [0, 0]);
  // One Tile on the room's wall (960 x 384): one tile over it, V down its height, from its top corner
  const tiled = align('roomWall', 'tile');
  nearMapping(tiled, mappingOf([1024, 1024, 384, -128 / 960, 0, 0, 0, 0, -128 / 384, 0, 0, 128, 128]), 1e-9);
  const corners = LAB.roomWall.points.map((p) => uvOf(tiled, p));
  for (let k = 0; k < 2; k++) {
    near(Math.min(...corners.map((c) => c[k])), 0, 1e-9); near(Math.max(...corners.map((c) => c[k])), 1, 1e-9);
  }
  near(align('roomWall', 'tile-u').v[2], -128 / 960);          // V as U: the texture's proportions
  near(align('roomWall', 'tile-v').u[0], -128 / 384);
  // a mapping whose U runs along the face's normal: U along the first side, V square to it (96 x 256 on the wall)
  const across = mappingOf([64, 400, 0, 1, 0, 0, 0, 0, -1, 7, 7, 128, 128]);
  nearMapping(mappingAfter(across, [{ op: 'tile' }], shape('wall')), mappingOf([64, 272, 0, 0, 0, 128 / 96, 0, 0.5, 0, 0, 0, 128, 128]));
  // what the view cannot know: no corners, no normal
  assert.equal(mappingAfter(face('wall').mapping, [{ op: 'tile' }], { normal: [1, 0, 0], points: LAB.wall.points.slice(0, 2) }), null);
  assert.equal(mappingAfter(face('wall').mapping, [{ op: 'floor' }], { points: LAB.wall.points }), null);
  // what the host refuses, failing the Rebuild: corners in a line; a face with no texture (until a texture row gives one)
  const line = [[64, 0, 0], [64, 100, 0], [64, 200, 0]], fit = { op: 'tile' };
  assert.deepEqual(mappingAfter(face('wall').mapping, [fit], { normal: [1, 0, 0], points: line }),
    { refused: 'Cannot fit this face: degenerate UVs or no texture', row: fit, stage: 'rebuild' });
  // ... no height along V (above), or no width along U: corners in a line down the wall
  const upright = [[64, 400, 0], [64, 400, 100], [64, 400, 200]];
  assert.deepEqual(mappingAfter(face('wall').mapping, [fit], { normal: [1, 0, 0], points: upright }),
    { refused: 'Cannot fit this face: degenerate UVs or no texture', row: fit, stage: 'rebuild' });
  const bare = mappingOf(LAB.roomWall.nums, 'none'), tileOf = (ref) => ({ 'Pkg.Door': [64, 128], 'Pkg.Third': [21.3333, 42.6667] })[ref];
  assert.match(mappingAfter(bare, [{ op: 'tile-u' }], shape('roomWall')).refused, /no texture/);
  const given = mappingAfter(bare, [{ op: 'texture', args: ['Pkg.Door'] }, { op: 'tile' }], { ...shape('roomWall'), tileOf });
  assert.deepEqual([given.tile, given.bare], [[64, 128], undefined]);
  nearList(given.u, [-64 / 960, 0, 0]);
  // Around a cylinder: a side only after a Rebuild, a cap keeps its mapping, a face whose plane is not known (it may be
  // a side) only after a Rebuild
  assert.equal(mappingAfter(face('wall').mapping, [{ op: 'cylinder' }], shape('wall')), null);
  assert.deepEqual(mappingAfter(face('floor').mapping, [{ op: 'cylinder' }], shape('floor')), face('floor').mapping);
  assert.equal(mappingAfter(face('floor').mapping, [{ op: 'cylinder' }], {}), null);
  // another texture: its tile (as the fraction the digits stand for), when the page knows it
  assert.deepEqual(mappingAfter(face('wall').mapping, [{ op: 'texture', args: ['Pkg.Door'] }], { tileOf }).tile, [64, 128]);
  assert.deepEqual(mappingAfter(face('wall').mapping, [{ op: 'texture', args: ['Pkg.Third'] }], { tileOf }).tile, [64 / 3, 128 / 3]);
  assert.equal(mappingAfter(face('wall').mapping, [{ op: 'texture', args: ['Pkg.Other'] }], { tileOf }), null);
  assert.equal(mappingAfter(face('wall').mapping, [{ op: 'texture', args: ['Pkg.Door'] }]), null);
  assert.equal(mappingAfter(face('wall').mapping, [{ op: 'unknown', args: [] }]), null);
  assert.equal(mappingAfter(face('wall').mapping, [{ op: 'cylinder' }, { op: 'pan', args: [1, 1] }], shape('wall')), null);
  // an operation the host does not have: refused; a row surfaces.py refuses fails the Rebuild even after one only a
  // Rebuild shows (it checks them all before the build)
  assert.deepEqual(mappingAfter(face('wall').mapping, [{ op: 'spin' }]), { refused: 'Unknown surface operation.', row: { op: 'spin' }, stage: 'save' });
  assert.match(mappingAfter(face('wall').mapping, [{ op: 'cylinder' }, { op: 'scale', args: [0, 1] }], shape('wall')).refused, /Scale factors/);
  assert.match(mappingAfter(null, [{ op: 'pan', args: [0.5, 0] }]).refused, /whole texels/);
  assert.equal(mappingAfter(null, [{ op: 'pan', args: [1, 0] }]), null);
});

test('a row as surfaces.py checks it: one refused fails every Save of the map (and so every Rebuild)', () => {
  const at = [{ brush: 'Brush2', poly: 4 }], all = [{ brush: 'Brush2', poly: '*' }];
  const ok = [
    { op: 'pan', args: [16, -8], targets: at }, { op: 'pan', args: [32767, -32767], targets: at }, { op: 'pan', args: [2.0, 0], targets: at },
    { op: 'scale', args: [0.001, 1000], targets: at }, { op: 'rotate', args: [], targets: at }, { op: 'rotate', targets: at },
    { op: 'shadows', args: ['high'], targets: at }, { op: 'flags', args: [0x8000000 | 0x4, 0x400000], targets: at },
    { op: 'flags', args: [0, 0x1 | 0x2 | 0x40 | 0x80 | 0x100 | 0x800 | 0x100000], targets: at },
    { op: 'texture', args: ['Pkg.Group.Name'], targets: at }, { op: 'texture', args: ['MyTex'], targets: at },
    { op: 'cylinder', args: [], targets: all }, { op: 'tile', args: [], targets: [{ brush: 'B_1', poly: 65535 }, ...all] },
    { op: 'floor', targets: [{ brush: 'B'.repeat(127), poly: 0 }] },
    { op: 'pan', args: [1, 1], targets: Array(TARGET_LIMIT).fill(at[0]) }, { op: 'pan', args: [1, 1], targets: [{ ...at[0], extra: 1 }] },
  ];
  for (const row of ok) assert.equal(rowProblem(row), '', JSON.stringify(row));
  const bad = [
    [{ op: 'spin', targets: at }, 'Unknown surface operation.'], [null, 'Unknown surface operation.'],
    // surfaces.py's order: the operation, the targets, the arguments, each target
    [{ op: 'spin' }, 'Unknown surface operation.'], [{ op: 'scale', args: [0, 1] }, 'Select one or more source faces.'],
    [{ op: 'pan', args: 3, targets: at }, 'Invalid surface arguments.'],
    [{ op: 'pan', args: [1], targets: at }, 'U and V must be finite numbers.'],
    [{ op: 'pan', args: [1, NaN], targets: at }, 'U and V must be finite numbers.'],
    [{ op: 'pan', args: [true, 1], targets: at }, 'U and V must be finite numbers.'],
    [{ op: 'scale', args: ['2', 2], targets: at }, 'U and V must be finite numbers.'],
    [{ op: 'pan', args: [1.5, 0], targets: at }, 'Pan uses whole texels, between -32767 and 32767.'],
    [{ op: 'pan', args: [0, -32768], targets: at }, 'Pan uses whole texels, between -32767 and 32767.'],
    [{ op: 'scale', args: [1, 1000.5], targets: at }, 'Scale factors must be between 0.001 and 1000.'],
    [{ op: 'shadows', args: ['max'], targets: at }, 'Shadow detail must be Ultra Low, Low, Normal or High.'],
    [{ op: 'shadows', args: [], targets: at }, 'Shadow detail must be Ultra Low, Low, Normal or High.'],
    [{ op: 'flags', args: [0x8, 0], targets: at }, 'Surface flags: set and clear are bits of the Look list, never the same one.'],
    [{ op: 'flags', args: [4, 4], targets: at }, 'Surface flags: set and clear are bits of the Look list, never the same one.'],
    [{ op: 'flags', args: [2 ** 32 + 4, 0], targets: at }, 'Surface flags: set and clear are bits of the Look list, never the same one.'],
    [{ op: 'flags', args: [-1, 0], targets: at }, 'Surface flags: set and clear are bits of the Look list, never the same one.'],
    [{ op: 'flags', args: [4], targets: at }, 'Surface flags: set and clear are bits of the Look list, never the same one.'],
    [{ op: 'texture', args: ['Pkg..Name'], targets: at }, 'Choose a loaded texture by its package and name.'],
    [{ op: 'texture', args: [5], targets: at }, 'Choose a loaded texture by its package and name.'],
    [{ op: 'texture', args: ['P.' + 'a'.repeat(239)], targets: at }, 'Choose a loaded texture by its package and name.'],
    [{ op: 'rotate', args: [1], targets: at }, 'This surface operation takes no arguments.'],
    [{ op: 'pan', args: [1, 1] }, 'Select one or more source faces.'],
    [{ op: 'pan', args: [1, 1], targets: [] }, 'Select one or more source faces.'],
    [{ op: 'pan', args: [1, 1], targets: [null] }, 'Invalid source face target.'],
    [{ op: 'pan', args: [1, 1], targets: [{ brush: 'Brush 2', poly: 1 }] }, 'Invalid source brush name.'],
    [{ op: 'pan', args: [1, 1], targets: [{ brush: 'B'.repeat(128), poly: 1 }] }, 'Invalid source brush name.'],
    [{ op: 'pan', args: [1, 1], targets: [{ poly: 1 }] }, 'Invalid source brush name.'],
    [{ op: 'pan', args: [1, 1], targets: [{ brush: 'Brush2', poly: -1 }] }, 'Invalid source face index.'],
    [{ op: 'pan', args: [1, 1], targets: [{ brush: 'Brush2', poly: 65536 }] }, 'Invalid source face index.'],
    [{ op: 'pan', args: [1, 1], targets: [{ brush: 'Brush2', poly: '3' }] }, 'Invalid source face index.'],
    [{ op: 'cylinder', targets: [{ brush: 'Brush2', poly: 3 }] }, 'Cylinder alignment applies to all the brush side faces.'],
    // no args is none, args null is not a list (row.get('args', [])), whatever the operation
    [{ op: 'rotate', args: null, targets: at }, 'Invalid surface arguments.'],
    [{ op: 'pan', args: null, targets: at }, 'Invalid surface arguments.'],
    [{ op: 'shadows', args: null, targets: at }, 'Invalid surface arguments.'],
    // a target that is a list is no target; one with a bad brush and a bad index: the brush is said; more than
    // TARGET_LIMIT targets, or targets that are not a list
    [{ op: 'pan', args: [1, 1], targets: [['Brush2', 4]] }, 'Invalid source face target.'],
    [{ op: 'pan', args: [1, 1], targets: [{ brush: 'Brush 2', poly: -1 }] }, 'Invalid source brush name.'],
    [{ op: 'pan', args: [1, 1], targets: Array(TARGET_LIMIT + 1).fill(at[0]) }, 'Select one or more source faces.'],
    [{ op: 'pan', args: [1, 1], targets: at[0] }, 'Select one or more source faces.'],
  ];
  for (const [row, why] of bad) assert.equal(rowProblem(row), why, JSON.stringify(row).slice(0, 200));
  for (const [row] of bad.slice(-7, -4)) {
    assert.deepEqual(mappingAfter(face('floor').mapping, [row]), { refused: 'Invalid surface arguments.', row, stage: 'save' });
  }
  // the whole queue as surfaces.py takes it on Save: a list (none: none) of no more than ROW_LIMIT rows, each taken
  assert.deepEqual([ROW_LIMIT, TARGET_LIMIT], [4096, 8192]);
  const fine = ok[0], full = Array(ROW_LIMIT).fill(fine);
  for (const rows of [[], undefined, null, ok, full]) assert.equal(queueProblem(rows), '', String(rows?.length));
  for (const rows of [[...full, fine], 'rows', 5]) assert.equal(queueProblem(rows), 'Surface edits must be a list (up to 4096 operations).');
  assert.equal(queueProblem([fine, bad[9][0], bad[0][0]]), 'Pan uses whole texels, between -32767 and 32767.');
  // the same checks refuse a face's rows in mappingAfter (the targets apart: those are the page's)
  for (const [row, why] of bad.slice(4, 23)) assert.equal(mappingAfter(face('floor').mapping, [row]).refused, why, JSON.stringify(row));
});

test('the rows of a face: its own and its whole brush\'s, in order, once per target that names it', () => {
  const rows = [
    { op: 'pan', args: [8, 0], targets: [{ brush: 'Brush2', poly: 4 }] },
    { op: 'scale', args: [2, 2], targets: [{ brush: 'Brush2', poly: '*' }] },
    { op: 'pan', args: [0, 8], targets: [{ brush: 'Brush212', poly: 1 }, { brush: 'Brush41', poly: 0 }] },
  ];
  assert.deepEqual(rowsFor(face('floor'), rows), rows.slice(0, 2));
  assert.deepEqual(rowsFor(face('roomWall'), rows), [rows[1]]);
  assert.deepEqual(rowsFor(face('wall'), rows), [rows[2]]);
  const now = mappingNow(face('floor'), rows);
  assert.deepEqual([now.pan, now.u], [[8, 0], [0.5, 0, 0]]);
  assert.equal(mappingNow({ ...face('floor'), mapping: null }, rows), null);
  // a row aimed at the face and at its whole brush, or at the face twice, edits it twice (surfaces.py: a UC_SURFACE per
  // target)
  const both = { op: 'pan', args: [5, 0], targets: [{ brush: 'Brush2', poly: '*' }, { brush: 'Brush2', poly: 4 }] };
  const twice = { op: 'scale', args: [2, 2], targets: [{ brush: 'Brush2', poly: 5 }, { brush: 'Brush2', poly: 5 }] };
  assert.deepEqual(rowsFor(face('floor'), [both, twice]), [both, both]);
  assert.deepEqual(rowsFor(face('ceiling'), [both, twice]), [both, twice, twice]);
  assert.deepEqual(mappingNow(face('floor'), [both]).pan, [10, 0]);
  nearList(mappingNow(face('ceiling'), [twice]).u, [0.5, 0, 0]);
  // a refusal on the way, for that face only
  const high = { ...face('floor'), mapping: { ...face('floor').mapping, pan: [32760, 0] } };
  assert.ok(isRefusal(mappingNow(high, [both])));
  assert.ok(!isRefusal(mappingNow(face('ceiling'), [both])));
});

test('the rows a Rebuild has not shown: those added, and those taken back after it undone', () => {
  const faces = [face('floor'), face('roomWall'), face('wall'), DOOR];
  const all = (poly = '*') => [{ brush: 'Brush2', poly }, { brush: 'Brush212', poly: 1 }, { brush: 'Brush212', poly: 7 }];
  const built = [
    { op: 'pan', args: [16, -8], targets: all() },
    { op: 'rotate', args: [], targets: all(4) },
    { op: 'scale', args: [2, 0.5], targets: all() },
  ];
  // the view's mappings: the source maps after every built row (a Rebuild replays them all); pending, after them,
  // must give what the current rows give the source
  const against = (rows) => {
    const shown = faces.map((f) => ({ ...f, mapping: mappingNow(f, rows) }));
    return (current) => {
      const pending = pendingRows(rows, current);
      shown.forEach((f, i) => nearMapping(mappingNow(f, pending), mappingNow(faces[i], current), 1e-9, `${f.id} after ${JSON.stringify(current.map((r) => r.op))}`));
      return pending;
    };
  };
  const check = against(built);
  // added after the Rebuild
  const added = [{ op: 'flip-u', args: [], targets: all(4) }, { op: 'pan', args: [3, 0], targets: all() }];
  assert.deepEqual(check([...built, ...added]), added);
  // Undo twice after the Rebuild: the scale, then the turn, taken back (a quarter turn back is three more)
  const undone = check(built.slice(0, 1));
  assert.deepEqual(undone.map((r) => [r.op, r.args]), [['scale', [0.5, 2]], ['rotate', []], ['rotate', []], ['rotate', []]]);
  // one taken back, another added: the pan back, the new one
  check([...built.slice(0, 2), { op: 'flip-v', args: [], targets: all() }]);
  check([]);
  // the same rows (also read back from JSON) leave nothing
  assert.deepEqual(pendingRows(built, JSON.parse(JSON.stringify(built))), []);
  // a row told apart by its arguments, and by its targets: the built one taken back, the current one after it
  const pan = [{ op: 'pan', args: [16, -8], targets: all() }];
  const other = against(pan);
  assert.deepEqual(other([{ op: 'pan', args: [3, 0], targets: all() }]).map((r) => [r.op, r.args]), [['pan', [-16, 8]], ['pan', [3, 0]]]);
  assert.deepEqual(other([{ op: 'pan', args: [16, -8], targets: all(4) }]).map((r) => [r.args, r.targets.length]),
    [[[-16, 8], 3], [[16, -8], 3]]);
  assert.deepEqual(other([{ op: 'pan', args: [16, -8], targets: all().slice(1) }]).map((r) => [r.args, r.targets.length]),
    [[[-16, 8], 3], [[16, -8], 2]]);
  // flips taken back: each by itself, the last first
  const flipped = [...built, { op: 'flip-u', args: [], targets: all() }, { op: 'flip-v', args: [], targets: all(4) }];
  assert.deepEqual(against(flipped)(built).map((r) => r.op), ['flip-v', 'flip-u']);
  // shadows and Look taken back: nothing on the mapping, the faces still known
  const looks = [...built, { op: 'shadows', args: ['low'], targets: all() }, { op: 'flags', args: [0x4, 0], targets: all() }];
  assert.deepEqual(against(looks)(built), []);
  // an alignment or a texture taken back: only a Rebuild shows its faces; the others still are known
  const shown = faces.map((f) => ({ ...f, mapping: mappingNow(f, built) }));
  const aligned = [...built, { op: 'floor', args: [], targets: [{ brush: 'Brush2', poly: 4 }] },
    { op: 'texture', args: ['Pkg.Tex'], targets: [{ brush: 'Brush212', poly: 1 }] }];
  const pending = pendingRows(aligned, built);
  assert.deepEqual(pending.map((r) => r.op), ['unknown', 'unknown']);
  assert.equal(mappingNow(shown[0], pending), null);
  assert.equal(mappingNow(shown[2], pending), null);
  nearMapping(mappingNow(shown[1], pending), shown[1].mapping);
});

// ---------------------------------------------------------------- the slip

test('the texture follows the pointer on walls, floors, ceilings and slopes, whatever their mapping', () => {
  for (const [what, f, points] of CASES) {
    const p0 = pointOn(points, 0.3, 0.25), m0 = f.mapping;
    let s = slipOn(f, points, p0);
    assert.ok(!s.error, what);
    // two moves on the plane, the second ending where the texel grabbed must be
    const p1 = add(p0, step(points, 37.3, 11.9)), p2 = add(p1, step(points, -5.4, 23.6));
    s = slipPan(slipPan(s, p1), p2);
    let r = slipResult(s);
    assert.deepEqual(r.rows.map((row) => row.op), ['pan'], what);
    assert.ok(r.rows.every(valid), what);
    sameTexel(r.preview[0].mapping, p2, m0, p0, 0.5, what);
    // it did move: the texel at p2 before the slip was another
    assert.ok(Math.hypot(...sub(texelOf(m0, p2), texelOf(m0, p0))) > 5, what);
    // a point off the plane counts where it is on it; no point (a ray along the plane) moves nothing
    const n = faceNormal(points);
    sameTexel(slipResult(slipPan(s, add(p2, times(n, 40)))).preview[0].mapping, p2, m0, p0, 0.5, `${what} off the plane`);
    assert.deepEqual(slipResult(slipPan(s, null)).rows, r.rows);
    assert.deepEqual(slipResult(slipPan(s, [1, NaN, 2])).rows, r.rows);
    // Shift: an eighth of the way, then (let go) the whole way again from where it is
    const p3 = add(p2, step(points, 64, -32));
    s = slipPan(s, p3, { shift: true });
    assert.equal(s.fine, true);
    r = slipResult(s);
    sameTexel(r.preview[0].mapping, add(p2, times(sub(p3, p2), FINE_DRAG)), m0, p0, 0.5, `${what} fine`);
    const p4 = add(p3, step(points, 10, 10));
    r = slipResult(slipPan(s, p4));
    sameTexel(r.preview[0].mapping, add(add(p2, times(sub(p3, p2), FINE_DRAG)), sub(p4, p3)), m0, p0, 0.5, `${what} after fine`);
  }
});

test('the wheel scales round the point under the pointer, which keeps its texel', () => {
  for (const [what, f, points] of CASES) {
    const p0 = pointOn(points, 0.2, 0.3), m0 = f.mapping, p1 = add(p0, step(points, 20.5, -14.25));
    const before = slipPan(slipOn(f, points, p0), p1);
    let s = slipScale(before, 3);
    let r = slipResult(s);
    assert.equal(r.scale, 1.68179, what);                             // 2 ** (3 / 4), to 6 digits as the row has it
    assert.deepEqual(r.rows.map((row) => row.op), ['scale', 'pan'], what);
    assert.deepEqual(r.rows[0].args, [1.68179, 1.68179]);
    assert.ok(r.rows.every(valid), what);
    const m1 = r.preview[0].mapping;
    nearList(m1.u, times(m0.u, 1 / 1.68179), 1e-12, what);
    nearList(m1.v, times(m0.v, 1 / 1.68179), 1e-12, what);
    // the texel under the pointer is the one it had (each rounded to whole texels), the one grabbed at the start
    sameTexel(m1, p1, slipResult(before).preview[0].mapping, p1, 1, `${what} kept`);
    sameTexel(m1, p1, m0, p0, 0.5, `${what} grabbed`);
    // and away from the pointer the texture is larger: a step of 30 units goes over fewer texels
    const far = add(p1, step(points, 30, 0));
    near(Math.hypot(...sub(texelOf(m1, far), texelOf(m1, p1))), Math.hypot(...sub(texelOf(m0, far), texelOf(m0, p1))) / 1.68179, 1e-6, what);
    // a drag after the scale still follows the pointer
    const p2 = add(p1, step(points, -9, 31));
    sameTexel(slipResult(slipPan(s, p2)).preview[0].mapping, p2, m0, p0, 0.5, `${what} drag after scale`);
    // back down three notches: as before, the texel under the pointer still the same
    s = slipScale(s, -3);
    r = slipResult(s);
    assert.equal(r.scale, 1, what);
    assert.deepEqual(r.rows.map((row) => row.op), ['pan'], what);
    sameTexel(r.preview[0].mapping, p1, m0, p0, 0.5, `${what} back`);
  }
});

test('notches: four double it, Shift sixteen, Ctrl goes from power of two to power of two, within the host\'s range', () => {
  const s = slipOn(face('floor'), LAB.floor.points);
  const scales = (start, list) => list.map(([notches, mods]) => (start = slipScale(start, notches, mods)).k);
  assert.deepEqual(scales(s, [[1], [1], [1], [1]]), [1.18921, 1.41421, 1.68179, 2]);
  assert.deepEqual(scales(s, [[16, { shift: true }]]), [2]);
  assert.deepEqual(scales(s, [[1, { shift: true }]]), [1.04427]);
  assert.deepEqual(scales(s, [[1, { ctrl: true }], [1, { ctrl: true }], [-3, { ctrl: true }]]), [2, 4, 0.5]);
  assert.deepEqual(scales(s, [[1], [1, { ctrl: true }], [-1], [-1, { ctrl: true }]]), [1.18921, 2, 1.68179, 1]);
  assert.deepEqual(scales(s, [[3], [1, { ctrl: true }]]), [1.68179, 2]);
  assert.deepEqual(scales(s, [[200]]), [SCALE_MAX]);
  assert.deepEqual(scales(s, [[200], [-4]]), [SCALE_MAX, 500]);     // at the top, a doubling down is at once half
  assert.deepEqual(scales(s, [[-200]]), [SCALE_MIN]);
  assert.deepEqual(scales(s, [[0]]), [1]);
  // with Ctrl only whole notches count (the page adds up a trackpad's fractions): powers of two only
  assert.deepEqual(scales(s, [[0.3, { ctrl: true }], [1.7, { ctrl: true }], [-2.9, { ctrl: true }]]), [1, 2, 0.5]);
  assert.deepEqual(scales(s, [[0.3]]), [1.05336]);
  assert.deepEqual(scales(s, [[NaN], [Infinity], [-Infinity, { ctrl: true }]]), [1, 1, 1]);
  // the modes held come with the wheel
  assert.deepEqual([slipScale(s, 1, { shift: true }).fine, slipScale(s, 1, { ctrl: true }).snap], [true, true]);
  // at the base point the texel is the pan: scaling there needs no pan
  const atBase = startSlip({ faces: [face('floor')], point: [0, 0, 0], normal: [0, 0, 1] });
  assert.deepEqual(slipResult(slipScale(atBase, 2)).rows.map((r) => r.op), ['scale']);
});

test('Ctrl snaps the pan to an eighth of the tile, arrows nudge it', () => {
  const points = LAB.wall.points, p0 = pointOn(points, 0.4, 0.3);
  let s = slipOn(DOOR, points, p0);
  assert.deepEqual(snapStep(s), [64 / SNAP_PARTS, 128 / SNAP_PARTS]);
  s = slipPan(s, add(p0, step(points, 29.3, -13.7)), { ctrl: true });
  assert.equal(s.snap, true);
  let r = slipResult(s);
  const pan = r.preview[0].mapping.pan;
  assert.deepEqual([pan[0] % 8, pan[1] % 16].map(Math.abs), [0, 0]);  // the door's own pan [16, -40] on the snap
  assert.ok(r.rows.every(valid));
  // let go of Ctrl: the free pan again (not on the snap here)
  const free = slipResult(slipMods(s, {}));
  assert.notDeepEqual(free.pan, r.pan);
  sameTexel(free.preview[0].mapping, add(p0, step(points, 29.3, -13.7)), DOOR.mapping, p0, 0.5);
  // arrows: a texel, with Ctrl a snap step
  s = slipOn(DOOR, points, p0);
  assert.deepEqual(slipResult(slipNudge(s, 1, -1)).pan, [1, -1]);
  assert.deepEqual(slipResult(slipNudge(slipNudge(s, 1, 0), 0, 2)).pan, [1, 2]);
  assert.deepEqual(slipResult(slipNudge(slipNudge(s, NaN, 3), 2, 0)).pan, [2, 3]);
  // a snap step each, and on the snap: V -40 + 16 is half way, to -16 (the door's pan was off the snap)
  r = slipResult(slipNudge(s, -1, 1, { ctrl: true }));
  assert.deepEqual(r.pan, [-8, 24]);
  assert.deepEqual(r.preview[0].mapping.pan, [8, -16]);
  // Ctrl+wheel: a power of two, and the pan on the snap
  r = slipResult(slipScale(slipPan(slipOn(DOOR, points, p0), add(p0, step(points, 3, 3))), 1, { ctrl: true }));
  assert.equal(r.scale, 2);
  assert.deepEqual([r.preview[0].mapping.pan[0] % 8, r.preview[0].mapping.pan[1] % 16].map(Math.abs), [0, 0]);
  // the face under the pointer is the one given as ref: with the floor first and the door under the pointer, the
  // door's snap, the door's texel kept
  const both = [face('floor'), DOOR];
  let t = startSlip({ faces: both, ref: 1, point: p0, normal: faceNormal(points) });
  assert.deepEqual(snapStep(t), [8, 16]);
  const p1 = add(p0, step(points, 21.3, 7.9));
  t = slipScale(slipPan(t, p1), 2);
  r = slipResult(t);
  sameTexel(r.preview[1].mapping, p1, DOOR.mapping, p0, 0.5, 'the door under the pointer');
  assert.deepEqual(r.pan, r.rows.find((row) => row.op === 'pan' && row.targets.some((x) => x.poly === 7)).args);   // the door's row
  r = slipResult(slipMods(t, { ctrl: true }));
  assert.deepEqual([r.preview[1].mapping.pan[0] % 8, r.preview[1].mapping.pan[1] % 16].map(Math.abs), [0, 0]);
});

test('the rows it queues: a scale then a pan, only what changed, as surfaces.py and the host take them', () => {
  const points = LAB.slope.points, f = face('slope'), p0 = pointOn(points, 0.5, 0.4);
  const s = slipOn(f, points, p0);
  // nothing done: no rows (no undo step)
  assert.deepEqual(slipResult(s).rows, []);
  assert.equal(slipHud(s), 'U 0 · V 0 · x1');
  // dragged back where it began: nothing either
  assert.deepEqual(slipResult(slipPan(slipPan(s, add(p0, step(points, 40, 9))), p0)).rows, []);
  const done = slipScale(slipPan(s, add(p0, step(points, 17.2, -8.1))), -2, { shift: true });
  const r = slipResult(done);
  assert.deepEqual(r.rows.map((row) => row.op), ['scale', 'pan']);
  assert.deepEqual(r.rows[0].targets, [{ brush: 'Brush41', poly: 0 }]);
  assert.ok(r.rows.every(valid));
  assert.ok(r.rows.every((row) => rowProblem(row) === ''));
  // the preview is what the host leaves (its own way of doing it, and the rows read back from JSON)
  const nums = r.rows.reduce(host, numsOf(f.mapping));
  nearList(numsOf(r.preview[0].mapping), nums, 1e-12);
  nearMapping(mappingAfter(f.mapping, JSON.parse(JSON.stringify(r.rows))), r.preview[0].mapping, 0);
  // the rows of the Surface panel would do the same
  nearMapping(mappingNow(f, r.rows), r.preview[0].mapping, 0);
});

test('several faces: one scale for all, each face its own pan, each shown as the host will leave it', () => {
  const unknown = { id: 'later', brush: 'Brush99', poly: 2, mapping: null };
  // another brush's face with the wall's polygon number: a row names a face by both
  const twin = { ...face('wall', 'twin'), brush: 'Brush213' };
  const faces = [face('wall'), DOOR, face('floor'), face('ceiling'), BIG, THIRD, unknown, { ...face('wall'), id: 'again' }, twin];
  const all = [{ brush: 'Brush212', poly: 1 }, { brush: 'Brush212', poly: 7 }, { brush: 'Brush2', poly: 4 }, { brush: 'Brush2', poly: 5 },
    { brush: 'Brush2', poly: 9 }, { brush: 'Brush2', poly: 10 }, { brush: 'Brush213', poly: 1 }];
  const points = LAB.wall.points, p0 = pointOn(points, 0.6, 0.2), p1 = add(p0, step(points, 51.7, 22.2));
  // a drag only: the same pan for every face (each once, in the order chosen), one row; the face only a Rebuild shows
  // left out
  const dragged = slipPan(slipOn(faces[0], points, p0, faces, 0), p1);
  let r = slipResult(dragged);
  assert.deepEqual(r.rows, [{ op: 'pan', args: r.pan, targets: all }]);
  assert.deepEqual([r.targets, r.left], [all, ['later']]);
  // the floor got the wall's pan, which on it moves its own way
  assert.deepEqual(r.preview[2].mapping.pan, r.pan);
  sameTexel(r.preview[0].mapping, p1, faces[0].mapping, p0, 0.5);
  // then the wheel: one scale for all, then pans
  const s = slipScale(dragged, -5);
  r = slipResult(s);
  assert.deepEqual(r.rows[0], { op: 'scale', args: [r.scale, r.scale], targets: all });
  const pans = r.rows.slice(1);
  assert.ok(pans.length > 1 && pans.every((row) => row.op === 'pan' && valid(row) && rowProblem(row) === ''));
  // each face in one pan row at most, each row its own pan
  const named = pans.flatMap((row) => row.targets.map(keyOf));
  assert.equal(new Set(named).size, named.length);
  assert.equal(new Set(pans.map((row) => row.args.join())).size, pans.length);
  r.preview.forEach((p, i) => {
    const f = faces[i];
    assert.equal(p.id, f.id);
    if (!f.mapping) { assert.equal(p.mapping, null); return; }
    nearMapping(p.mapping, mappingNow(f, r.rows), 0);
    nearList(numsOf(p.mapping), rowsFor(f, r.rows).reduce(host, numsOf(f.mapping)), 1e-9);
    // each face scaled round the pointer's point: the texel there as the drag left it, within a texel (each rounded by
    // the offset of the face under the pointer, which is within half)
    showsTexel(p.mapping, p1, add(texelOf(f.mapping, p1), dragged.drag), 1, `${f.id} round the pointer`);
  });
  sameTexel(r.preview[0].mapping, p1, faces[0].mapping, p0, 0.5, 'the face under the pointer');
  nearMapping(r.preview[7].mapping, r.preview[0].mapping, 0);
  assert.equal(slipHud(s).split(' · ').slice(3).join(' · '), '7 faces · 1 left out: Rebuild first');
});

test('faces showing one texture from different base points stay one texture when scaled', () => {
  // two walls of different brushes in one plane, one continuous texture: B's base 64 units along, its pan making up for
  // it; C mapped as A (the same base): A and C always share their pan row
  const wall = (id, brush, base, pan) => ({ id, brush, poly: 1, mapping: mappingOf([64, base, 0, 0, -1, 0, 0, 0, -1, pan, 0, 128, 128]) });
  const faces = [wall('A', 'Brush1', 400, 0), wall('B', 'Brush2', 336, 64), wall('C', 'Brush3', 400, 0)];
  const plane = [[64, 528, 0], [64, 528, 96], [64, 272, 0]], X = [[64, 272, 50], [64, 500, 10], [64, -900, 3000]];
  const seam = (r) => Math.max(...X.flatMap((p) => [0, 1].map((k) => apart(texelOf(r.preview[0].mapping, p)[k], texelOf(r.preview[1].mapping, p)[k], 128))));
  // (a whole factor: none; another: the pans are whole texels, rounded as the face under the pointer's, half a texel)
  for (const [notches, mods, most] of [[4, {}, 0], [8, {}, 0], [-4, { ctrl: true }, 0], [1, {}, 0.5], [-3, {}, 0.5], [7, { shift: true }, 0.5]]) {
    let s = startSlip({ faces, point: [64, 350, 50], normal: [1, 0, 0] });
    s = slipScale(slipPan(slipScale(s, notches, mods), [64, 341.3, 61.7]), notches, mods);
    const r = slipResult(s), what = `${notches} notches ${JSON.stringify(mods)}`;
    assert.ok(seam(r) <= most + 1e-9, `${what}: a seam of ${seam(r)} texels`);
    assert.ok(r.rows.every(valid), what);
    const rowOf = (id) => r.rows.findIndex((row) => row.op === 'pan' && row.targets.some((t) => t.brush === { A: 'Brush1', B: 'Brush2', C: 'Brush3' }[id]));
    assert.equal(rowOf('A'), rowOf('C'), what);
    assert.notEqual(rowOf('A'), rowOf('B'), what);
  }
  // x2 round a point on A: A pans 25, -25, B -7, -25 (the verifier's case: one pan for all opened a seam of 32 texels)
  const r = slipResult(slipScale(startSlip({ faces, point: [64, 350, 50], normal: [1, 0, 0] }), 4));
  assert.deepEqual(r.rows.map((row) => [row.op, row.args, row.targets.map(keyOf)]), [
    ['scale', [2, 2], ['Brush1|1', 'Brush2|1', 'Brush3|1']], ['pan', [25, -25], ['Brush1|1', 'Brush3|1']], ['pan', [-7, -25], ['Brush2|1']]]);
  assert.equal(seam(r), 0);
  // nearly one texture, as two walls of NYC Street (U 0.999838 texels a unit: 0.02 texels apart): x2 gives them pans of
  // 45.49 and -18.50, which rounded each on its own part them by a texel; rounded as the face under the pointer, 0.01
  const street = (id, brush, y) => ({ id, brush, poly: 28, mapping: mappingOf([2416, y, -352, 0, 0.999838, 0, 0, 0, -1, 0, 0, 64, 64]) });
  const pair = [street('A', 'Brush1317', -2032), street('B', 'Brush1324', -1904)], X0 = [2416, -1941, -352];
  const gap = (a, b) => apart(texelOf(a, X0)[0], texelOf(b, X0)[0], 64);
  near(gap(pair[0].mapping, pair[1].mapping), 0.0207, 1e-4, 'before');
  const rs = slipResult(slipScale(startSlip({ faces: pair, point: X0, normal: [1, 0, 0] }), 4));
  assert.deepEqual(rs.rows.slice(1).map((row) => row.args), [[45, 0], [-19, 0]]);
  near(gap(rs.preview[0].mapping, rs.preview[1].mapping), 0.0104, 1e-4, 'after');
  // walls of one texture stacked: the same base along U, 64 units apart along V (D's V pan making up for it). x2 round
  // a point on A gives them the same U pan, not the same V pan: a row each (one row for both opened a seam of 32 texels)
  const stacked = [faces[0], { id: 'D', brush: 'Brush4', poly: 1, mapping: mappingOf([64, 400, 64, 0, -1, 0, 0, 0, -1, 0, -64, 128, 128]) }];
  const rd = slipResult(slipScale(startSlip({ faces: stacked, point: [64, 350, 30], normal: [1, 0, 0] }), 4));
  assert.deepEqual(rd.rows.map((row) => [row.op, row.args, row.targets.map(keyOf)]), [
    ['scale', [2, 2], ['Brush1|1', 'Brush4|1']], ['pan', [25, -15], ['Brush1|1']], ['pan', [25, 17], ['Brush4|1']]]);
  assert.equal(seam(rd), 0);
});

test('the wheel at a room\'s corner: the walls\' texture stays together, the one beside scaling round the point carried round', () => {
  // the review's case: the north wall under the pointer, 440 units from the corner, the east wall selected too
  const north = wallOf('north'), east = wallOf('east'), A = [584, 1024, 200];
  const corner = [0, 73.77, 200, 384].map((z) => [1024, 1024, z]);
  for (const p of corner) near(parting(north.mapping, east.mapping, p), 0, 1e-9, 'before');
  const s = startSlip({ faces: [north, east], point: A, normal: [0, -1, 0] });
  for (const [notches, mods, drag] of [[1, {}, [0, 0, 0]], [3, {}, [-37.5, 0, 21.25]], [-2, {}, [12, 0, -40]], [5, { shift: true }, [0, 0, 0]],
    [-1, { ctrl: true }, [64, 0, 0]], [8, {}, [0, 0, 0]]]) {
    const what = `${notches} notches ${JSON.stringify(mods)}`, r = slipResult(slipScale(slipPan(s, add(A, drag)), notches, mods));
    const [n1, e1] = r.preview.map((p) => p.mapping);
    for (const p of corner) assert.ok(parting(n1, e1, p) <= 0.5 + 1e-9, `${what}: ${parting(n1, e1, p)} texels apart at ${p}`);
    if (!mods.ctrl) sameTexel(n1, add(A, drag), north.mapping, A, 0.5, `${what}: the texel under the pointer`);
    assert.ok(r.rows.every((row) => valid(row) && rowProblem(row) === ''), what);
    nearMapping(e1, mappingAfter(east.mapping, rowsFor(east, r.rows)), 0, what);
  }
  // the east wall scales round the pointer's point carried round the corner: 732 texels, not 512 (the point on its own
  // axes, the corner itself: one notch parted the walls by 35 texels)
  nearList(texelOf(s.carried[1], A), [732, -100], 1e-9);
  nearMapping(s.carried[0], north.mapping, 0);
  // three walls, two corners: carried on round both
  const west = wallOf('west'), three = slipResult(slipScale(startSlip({ faces: [east, north, west], ref: 1, point: A, normal: [0, -1, 0] }), 2));
  const [e2, n2, w2] = three.preview.map((p) => p.mapping);
  for (const z of [10, 300]) {
    assert.ok(parting(n2, e2, [1024, 1024, z]) <= 0.5 + 1e-9);
    assert.ok(parting(n2, w2, [-1024, 1024, z]) <= 0.5 + 1e-9);
  }
});

test('a closed ring, the room\'s walls or a column\'s sides: every edge kept but the one reached last from both ways', () => {
  // the room's four walls, 32 tiles round: scaled by k they would be 32 / k round, so one corner parts, the one the walk
  // from the north wall reaches last (south and west, both two walls on); the others within a texel (half of one beside
  // the face under the pointer)
  const walls = ['north', 'east', 'south', 'west'].map(wallOf), corners = [[1024, 1024], [1024, -1024], [-1024, -1024], [-1024, 1024]];
  const room = slipResult(slipScale(startSlip({ faces: walls, point: [584, 1024, 200], normal: [0, -1, 0] }), 1)).preview.map((p) => p.mapping);
  const parted = (mappings, edges) => edges.map(([a, b, p]) => [a, b, parting(mappings[a], mappings[b], p)]).filter(([, , x]) => x > 1 + 1e-9);
  const roomEdges = corners.map(([x, y], i) => [i, (i + 1) % 4, [x, y, 100]]);
  assert.deepEqual(parted(room, roomEdges).map(([a, b]) => [a, b]), [[2, 3]]);
  near(parted(room, roomEdges)[0][2], apart(4096 / 1.18921, 4096, 128), 1, 'the corner that closes the ring');
  for (const [a, b, p] of roomEdges.filter(([a, b]) => a === 0 || b === 0)) assert.ok(parting(room[a], room[b], p) <= 0.5 + 1e-9, `${a}-${b}`);
  // the east wall's top a hundredth lower, as the view may round it: the same corner (the sides weighed in whole units)
  const lower = walls.map((f) => (f.id === 'east' ? { ...f, pieces: f.pieces.map((piece) => piece.map(([x, y, z]) => [x, y, z === 384 ? 383.99 : z])) } : f));
  const rounded = slipResult(slipScale(startSlip({ faces: lower, point: [584, 1024, 200], normal: [0, -1, 0] }), 1)).preview.map((p) => p.mapping);
  assert.deepEqual(parted(rounded, roomEdges).map(([a, b]) => [a, b]), [[2, 3]]);
  // a column of 12 sides, 6 tiles round
  const sides = columnSides(), edges = sides.map((_, i) => [i, (i + 1) % SIDES, add(columnCorner(i + 1), [0, 0, 50])]);
  assert.deepEqual(parted(sides.map((f) => f.mapping), edges), []);
  const middle = add(times(add(columnCorner(0), columnCorner(1)), 0.5), [0, 0, 64]);
  for (const notches of [1, -3, 4]) {
    const r = slipResult(slipScale(startSlip({ faces: sides, point: middle, normal: faceNormal(sides[0].pieces[0]) }), notches));
    const open = parted(r.preview.map((p) => p.mapping), edges);
    assert.equal(open.length, notches === 4 ? 0 : 1, `${notches} notches: ${JSON.stringify(open)}`);  // (x2: 3 tiles round, whole)
    if (open.length) assert.ok(open[0][0] === 6 || open[0][1] === 6, `${notches} notches: the side across from the pointer's (${open[0]})`);
  }
});

test('a ring of one texture with a shorter side (a wall lower than the others): it closes there, not farthest round', () => {
  // the room's four walls (32 tiles round), the east one 128 high, so its corners are 128 long and the others 384, the
  // pointer on the north wall: the longer sides crossed first, the ring closes at a corner of the east wall, the south
  // one (of the two as long, the one offered last). Walked in the order offered, it closed farthest round, south-west
  const wall = (id, poly, nums, piece) => ({ id, brush: 'Brush2', poly, mapping: mappingOf(nums), pieces: [piece] });
  const walls = [wall('north', 3, ROOM.north.nums, [[-1024, 1024, 0], [1024, 1024, 0], [1024, 1024, 384], [-1024, 1024, 384]]),
    wall('east', 1, ROOM.east.nums, [[1024, -1024, 0], [1024, -1024, 128], [1024, 1024, 128], [1024, 1024, 0]]),
    wall('south', 2, ROOM.south.nums, [[1024, -1024, 0], [-1024, -1024, 0], [-1024, -1024, 384], [1024, -1024, 384]]),
    wall('west', 0, ROOM.west.nums, [[-1024, 1024, 0], [-1024, 1024, 384], [-1024, -1024, 384], [-1024, -1024, 0]])];
  const corners = [[0, 1, [1024, 1024]], [1, 2, [1024, -1024]], [2, 3, [-1024, -1024]], [3, 0, [-1024, 1024]]];
  for (const notches of [1, -3]) {
    const after = slipResult(slipScale(startSlip({ faces: walls, point: [584, 1024, 100], normal: [0, -1, 0] }), notches)).preview.map((p) => p.mapping);
    const open = corners.filter(([a, b, [x, y]]) => [10, 100].some((z) => parting(after[a], after[b], [x, y, z]) > 1 + 1e-9));
    assert.deepEqual(open.map(([a, b]) => [walls[a].id, walls[b].id]), [['east', 'south']], `${notches} notches`);
  }
});

test('a ring of one texture that already steps at a side: it parts there, its seamless corners kept; a step along a side before one across it; all along: the farthest round', () => {
  // the room's four walls, the east one's U panned 32 texels: its texture steps by 32 across both its corners (U runs
  // across them), the pointer on the north or the south wall. Weighed by texture and length alone, the ring closed at a
  // seamless corner, south-west with the pointer on the north wall: 11.9 texels apart at +1 notch, 23.9 at -3
  const walls = ['north', 'east', 'south', 'west'].map(wallOf);
  walls[1] = { ...walls[1], mapping: mappingOf([1024, 0, 0, 0, 0.5, 0, 0, 0, -0.5, 32, 0, 128, 128]) };
  const up = (x, y) => [[x, y, 0], [x, y, 384]], corners = [[0, 1, up(1024, 1024)], [1, 2, up(1024, -1024)], [2, 3, up(-1024, -1024)], [3, 0, up(-1024, 1024)]];
  // how far each corner (north-east, east-south, south-west, west-north) moves in a slip
  const moved = (ref, point, notches) => {
    const r = slipResult(slipScale(startSlip({ faces: walls, ref, point, normal: piecesNormal(walls[ref].pieces) }), notches));
    return corners.map(([a, b, side]) => seamMoved([walls[a].mapping, walls[b].mapping], [r.preview[a].mapping, r.preview[b].mapping], [side, side]));
  };
  for (const [ref, point] of [[0, [584, 1024, 200]], [2, [-300, -1024, 200]]]) {
    for (const notches of [1, -3]) {
      const [, , southWest, westNorth] = moved(ref, point, notches);
      assert.ok(southWest <= 0.5 + 1e-9 && westNorth <= 0.5 + 1e-9, `on the ${walls[ref].id}, ${notches} notches: ${southWest} and ${westNorth} texels`);
    }
  }
  // the west wall's V panned 32 too: its texture steps along its corners (V runs along them), so the ring parts at one
  // of those and the east wall's are kept (with the pointer on the west wall, it parted at the east-south corner)
  walls[3] = { ...walls[3], mapping: mappingOf([-1024, 0, 0, 0, -0.5, 0, 0, 0, -0.5, 0, 32, 128, 128]) };
  for (const [ref, point] of [[3, [-1024, -300, 200]], [2, [-300, -1024, 200]]]) {
    for (const notches of [1, -3]) {
      const [northEast, eastSouth, southWest, westNorth] = moved(ref, point, notches);
      assert.ok(northEast <= 0.5 + 1e-9 && eastSouth <= 0.5 + 1e-9 && Math.max(southWest, westNorth) > 1,
        `on the ${walls[ref].id}, ${notches} notches: ${[northEast, eastSouth, southWest, westNorth]} texels`);
    }
  }
  // a step is more than a texel: the east wall's U panned 2 texels, the ring parts at one of its corners; its base a
  // unit along it (half a texel), it parts where it would with no step, at the south-west corner (pointer on the north)
  walls[3] = wallOf('west');
  for (const [nums, closes] of [[[1024, 0, 0, 0, 0.5, 0, 0, 0, -0.5, 2, 0, 128, 128], 'east'], [[1024, 1, 0, 0, 0.5, 0, 0, 0, -0.5, 0, 0, 128, 128], 'south-west']]) {
    walls[1] = { ...walls[1], mapping: mappingOf(nums) };
    const [northEast, eastSouth, southWest, westNorth] = moved(0, [584, 1024, 200], 1);
    const parted = closes === 'east' ? Math.max(northEast, eastSouth) > 1 && Math.max(southWest, westNorth) <= 0.5 + 1e-9
      : southWest > 1 && Math.max(northEast, eastSouth, westNorth) <= 0.5 + 1e-9;
    assert.ok(parted, `the east wall ${nums}: ${[northEast, eastSouth, southWest, westNorth]} texels, not parted at ${closes}`);
  }
  // a step only the exact mappings show: the east wall's U pan queued as 1, left at 1.4 by a slip before (its exact
  // mapping), parts the ring at an east corner, the west ones within half a texel; left at 0.9 (no step), at the
  // south-west corner, as with no step. Measured on the exact mappings, before and after. (Weighed on the queued
  // mappings, or with a step of 1.5 or 1.9 texels, both parted at the south-west corner; of 0.6, both at an east one)
  const queuedEast = { ...wallOf('east'), mapping: mappingOf([1024, 0, 0, 0, 0.5, 0, 0, 0, -0.5, 1, 0, 128, 128]) };
  const exactOf = (f) => f.exact || f.mapping;
  for (const [pan, closes] of [[1.4, 'east'], [0.9, 'south-west']]) {
    const list = [wallOf('north'), { ...queuedEast, exact: { ...queuedEast.mapping, pan: [pan, 0] } }, wallOf('south'), wallOf('west')];
    const r = slipResult(slipScale(startSlip({ faces: list, point: [584, 1024, 200], normal: [0, -1, 0] }), 1), { exact: true });
    const [northEast, eastSouth, southWest, westNorth] = corners.map(([a, b, side]) =>
      seamMoved([exactOf(list[a]), exactOf(list[b])], [r.preview[a].exact, r.preview[b].exact], [side, side]));
    const parted = closes === 'east' ? Math.max(northEast, eastSouth) > 1 && Math.max(southWest, westNorth) <= 0.5 + 1e-9
      : southWest > 1 && Math.max(northEast, eastSouth, westNorth) <= 0.5 + 1e-9;
    assert.ok(parted, `the east wall's exact U pan ${pan}: ${[northEast, eastSouth, southWest, westNorth]} texels, not parted at ${closes}`);
  }
  // walls 16 and 4 high, V changing 8 and 2 texels along a corner (a step on an axis that changes a texel or more along
  // the side is along it): the west wall's step along its corners still parts the ring before the east wall's across
  // them, the pointer on the west wall. (Along only from 9 texels on, the walls 16 high parted at the east-south corner;
  // from 2.5, those 4 high)
  for (const height of [16, 4]) {
    const low = (f, [[x0, y0], [x1, y1]]) => ({ ...f, pieces: [[[x0, y0, 0], [x1, y1, 0], [x1, y1, height], [x0, y0, height]]] });
    const room = [low(wallOf('north'), [[-1024, 1024], [1024, 1024]]),
      low({ ...wallOf('east'), mapping: mappingOf([1024, 0, 0, 0, 0.5, 0, 0, 0, -0.5, 32, 0, 128, 128]) }, [[1024, 1024], [1024, -1024]]),
      low(wallOf('south'), [[1024, -1024], [-1024, -1024]]),
      low({ ...wallOf('west'), mapping: mappingOf([-1024, 0, 0, 0, -0.5, 0, 0, 0, -0.5, 0, 32, 128, 128]) }, [[-1024, -1024], [-1024, 1024]])];
    const sides = corners.map(([a, b, [[x, y]]]) => [a, b, [[x, y, 0], [x, y, height]]]);
    for (const notches of [1, -3]) {
      const r = slipResult(slipScale(startSlip({ faces: room, ref: 3, point: [-1024, -300, height / 2], normal: piecesNormal(room[3].pieces) }), notches));
      const [northEast, eastSouth, southWest, westNorth] = sides.map(([a, b, side]) =>
        seamMoved([room[a].mapping, room[b].mapping], [r.preview[a].mapping, r.preview[b].mapping], [side, side]));
      assert.ok(northEast <= 0.5 + 1e-9 && eastSouth <= 0.5 + 1e-9 && Math.max(southWest, westNorth) > 1,
        `walls ${height} high, ${notches} notches: ${[northEast, eastSouth, southWest, westNorth]} texels`);
    }
  }
  // a pinwheel of four floor faces round a square hole (Brush10 to Brush13, one texture, each side 128 long), U along x
  // on all, V mirrored on two (the walk carries the texture round, not each face its own), their pans 3 texels apart:
  // every side steps along it (rank 1). The side that parts is the one farthest round from the face under the pointer
  // (not one of its own), whichever face that is and whatever order the faces are listed in. (Ordered by their brushes
  // and polygons, as the sides between two textures are, it parted between the last two, C and D, wherever the pointer)
  const square = (x0, y0, x1, y1) => [[[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]]];
  const pinwheel = [['A', square(0, 0, 384, 128), 1, 0], ['B', square(256, 128, 384, 384), -1, 3], ['C', square(0, 256, 256, 384), -1, 6],
    ['D', square(0, 128, 128, 256), 1, 9]].map(([id, pieces, v, pan], i) => ({ id, brush: `Brush${10 + i}`, poly: 0, tex: 'Pkg.Floor', pieces,
    mapping: mappingOf([0, 0, 0, 0.5, 0, 0, 0, 0.5 * v, 0, pan, 0, 128, 128]) }));
  const ringSides = [['A', 'B', [256, 128, 0], [384, 128, 0]], ['B', 'C', [256, 256, 0], [256, 384, 0]], ['C', 'D', [0, 256, 0], [128, 256, 0]],
    ['D', 'A', [0, 128, 0], [128, 128, 0]]];
  for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]]) {
    const list = order.map((i) => pinwheel[i]), named = (id) => list.findIndex((f) => f.id === id);
    list.forEach((under, ref) => {
      for (const notches of [3, -3]) {
        const r = slipResult(slipScale(startSlip({ faces: list, ref, point: add(under.pieces[0][0], [50, 40, 0]), normal: [0, 0, 1] }), notches), { exact: true });
        const parts = ringSides.filter(([a, b, from, to]) => seamMoved([list[named(a)].mapping, list[named(b)].mapping],
          [r.preview[named(a)].exact, r.preview[named(b)].exact], [[from, to], [from, to]]) > 1).map(([a, b]) => [a, b]);
        assert.ok(parts.length === 1 && !parts[0].includes(under.id),
          `listed ${list.map((f) => f.id).join('')}, on ${under.id}, ${notches} notches: ${parts.map((pair) => pair.join(''))}`);
      }
    });
  }
});

test('a ring slipped again with the pointer elsewhere, kept one after the other: it parts where it parted, and closes at the scale it had', () => {
  // the room's four walls: -3 notches on the north wall, +2 on the south one, +1 on the east one (the scale back to 1);
  // the column with its caps: -3 on side 0, +2 on side 6, +1 on the top. The side the slip before parted steps across:
  // the next slip parts the ring there again, not at the side farthest round from its pointer (the room's corners parted
  // at two, the column's sides at three). The room with its east wall of another texture (the Surface panel's Texture on
  // it): one of its two sides between the textures parts, the same after each slip, whatever the page does between the
  // slips (an Undo and Redo, a Pan of every wall, a Rebuild, the panel's Scale on every wall queued first): the one the
  // slip before parted ranks below the other (partedSince, against each wall's mapping before the first slip kept), and
  // two alike are crossed in the order of their walls' brushes and polygons, whichever wall the walk starts from. (Both
  // ranked alike after a Rebuild, or with the panel's Scale first, where the walk started decided: the second slip parted
  // the other side too, and at the scale back to 1 both stood 24 to 61 texels off)
  // the sides more than a texel apart after each slip (moved: by that slip alone, against the mappings it started from)
  const open = (faces, slips, edges, options, moved = false) => {
    const out = [];
    keepSlips(faces, slips, (queue, r, i, now, from) => {
      const after = now.map((f) => mappingNow(f, queue));
      const apartBy = ([a, b, p]) => (moved ? seamMoved([from[a], from[b]], [after[a], after[b]], [[p, p], [p, p]]) : parting(after[a], after[b], p));
      out.push(edges.filter((edge) => apartBy(edge) > 1 + 1e-9).map(([a, b]) => [faces[a].id, faces[b].id]));
    }, options);
    return out;
  };
  const walls = ['north', 'east', 'south', 'west'].map(wallOf), at = (name) => walls.findIndex((f) => f.id === name);
  const corners = CORNERS.map(([a, b, [x, y]]) => [at(a), at(b), [x, y, 100]]);
  const roomSlips = [[0, [-500, 1024, 200], -3], [2, [500, -1024, 200], 2], [1, [1024, -500, 250], 1]];
  assert.deepEqual(open(walls, roomSlips, corners), [[['south', 'west']], [['south', 'west']], []]);
  const retextured = walls.map((f) => ({ ...f, tex: f.id === 'east' ? 'Pkg.Panel' : 'Pkg.Wall' }));
  const scale = (k) => [{ op: 'scale', args: [k, k], targets: walls.map(({ brush, poly }) => ({ brush, poly })) }];
  const betweenTextures = (sides) => sides.length === 1 && sides[0].includes('east') && !sides[0].includes('west');
  for (const [what, options] of [['kept', {}], ['an Undo and Redo between', { between: undoRedo }],
    ['a Pan of every wall between', { between: pushed({ op: 'pan', args: [7, 0] }) }], ['a Rebuild between', { between: rebuilt }],
    ['the panel\'s Scale 2 first', { queue: scale(2) }], ['the panel\'s Scale 0.5 first', { queue: scale(0.5) }]]) {
    const out = open(retextured, roomSlips, corners, options);
    assert.ok(betweenTextures(out[0]), `${what}: ${JSON.stringify(out)}`);
    assert.deepEqual(out, [out[0], out[0], []], what);
  }
  // the panel's Scale 2 on every wall queued between the first slip and the second (each wall round its own base point:
  // the corners step then): each slip moves that side alone, against the mappings it starts from (the walk's start
  // decided, the second slip moved the other one)
  const scaledBetween = open(retextured, roomSlips, corners, { between: (page, i) => (i ? page : pushed({ op: 'scale', args: [2, 2] })(page)) }, true);
  assert.ok(betweenTextures(scaledBetween[0]), JSON.stringify(scaledBetween));
  assert.deepEqual(scaledBetween, [scaledBetween[0], scaledBetween[0], scaledBetween[0]]);
  // one slip from each wall in turn: the same side parts, wherever the walk starts (in the order offered, the one the walk
  // reached last: north-east from the south wall, east-south from the others)
  const fromEach = [[-500, 1024, 200], [1024, -500, 250], [500, -1024, 200], [-1024, 500, 200]].map((point, ref) => open(retextured, [[ref, point, -3]], corners)[0]);
  assert.ok(betweenTextures(fromEach[0]), JSON.stringify(fromEach));
  assert.deepEqual(fromEach, [fromEach[0], fromEach[0], fromEach[0], fromEach[0]]);
  // the walls listed in another order (selected otherwise): the same side, their places by brush and polygon, not by the
  // order given; walls of four brushes: of the two sides alike, the one whose walls come last by brush, then polygon,
  // parts (the east wall Brush9 and the south one Brush8: east-south; by polygon alone, north-east)
  const reversed = [...retextured].reverse(), named = (id) => reversed.findIndex((f) => f.id === id);
  assert.deepEqual(open(reversed, roomSlips.map(([ref, point, notches]) => [named(retextured[ref].id), point, notches]),
    CORNERS.map(([a, b, [x, y]]) => [named(a), named(b), [x, y, 100]])), open(retextured, roomSlips, corners));
  const brushes = { north: 'Brush7', east: 'Brush9', south: 'Brush8', west: 'Brush6' };
  assert.deepEqual(open(retextured.map((f) => ({ ...f, brush: brushes[f.id] })), roomSlips, corners), [[['east', 'south']], [['east', 'south']], []]);
  // the north and east walls slipped up 1.4 texels before, alone (queued as 1, their exact mappings left at 1.4), the
  // pointer on the south wall: the side between the two textures that slip parted (east-south) parts again, the other
  // (north-east) within half a texel, measured on the exact mappings. (Weighed on the queued mappings, 1 texel apart,
  // neither was taken as parted: the walk crossed east-south first and parted north-east)
  const raised = retextured.map((f) => ({ ...f, built: f.mapping, before: f.mapping, ...(f.id === 'north' || f.id === 'east'
    ? { mapping: { ...f.mapping, pan: [0, 1] }, exact: { ...f.mapping, pan: [0, 1.4] } } : {}) }));
  const up = ([x, y]) => [[x, y, 0], [x, y, 384]], south = at('south');
  for (const notches of [1, -3]) {
    const r = slipResult(slipScale(startSlip({ faces: raised, ref: south, point: [500, -1024, 200], normal: piecesNormal(raised[south].pieces) }),
      notches), { exact: true });
    const [northEast, eastSouth] = CORNERS.slice(0, 2).map(([a, b, p]) => seamMoved([at(a), at(b)].map((i) => raised[i].exact || raised[i].mapping),
      [r.preview[at(a)].exact, r.preview[at(b)].exact], [up(p), up(p)]));
    assert.ok(northEast <= 0.5 + 1e-9 && eastSouth > 1, `north and east raised, ${notches} notches: ${northEast} and ${eastSouth} texels`);
  }
  // the east wall 0.4 out from the others (x 1024.4: its edges as an original map may leave them), the texture made 9.5
  // times smaller on the north wall (-13 notches), then 2 notches on the south one: parted where the first parted
  const outEast = retextured.map((f) => (f.id === 'east' ? { ...f, pieces: f.pieces.map((piece) => piece.map(([x, y, z]) => [x + 0.4, y, z])) } : f));
  const outOpen = open(outEast, [[0, [-500, 1024, 200], -13], [2, [500, -1024, 200], 2]], corners);
  assert.ok(betweenTextures(outOpen[0]), JSON.stringify(outOpen));
  assert.deepEqual(outOpen, [outOpen[0], outOpen[0]]);
  // -4 notches on the north wall (the ring 64 tiles round: whole, no corner open, the south-west corner a whole number
  // of tiles off where it was, no step), then +2 on the west wall: the corner farthest round from the pointer parts
  // (east-south), as in a ring never slipped. (Round 14's: its whole tiles counted, south-west was taken as parted since
  // and parted again, beside the pointer; since sideRank a side that shows no step ranks as one whatever steppedSince
  // says, and the next case pins the whole tiles)
  assert.deepEqual(open(walls, [[0, [-500, 1024, 200], -4], [3, [-1024, 500, 200], 2]], corners), [[], [['east', 'south']]]);
  // the east wall's base 2.4 along it (its corners step 1.2 texels as built), -4 notches on the north wall (east-south
  // parts, a whole number of tiles off where it was: its step as it was, nothing moved that shows), then +2 on the south
  // wall: north-east moves, the corner the same slip moves with no slip before it (of two corners that step alike, the
  // one the walk reaches last). (Its whole tiles counted, east-south was taken as parted since, ranked below north-east,
  // and parted again)
  const stepped = walls.map((f) => (f.id === 'east' ? { ...f, mapping: { ...f.mapping, base: [1024, 2.4, 0] } } : f));
  const fromSouth = [2, [500, -1024, 200], 2];
  assert.deepEqual(open(stepped, [fromSouth], corners, {}, true), [[['north', 'east']]], 'the east wall 2.4 along, +2 on the south wall');
  assert.deepEqual(open(stepped, [[0, [-500, 1024, 200], -4], fromSouth], corners, {}, true), [[], [['north', 'east']]], 'the same after -4');
  // the north and east walls alone rolled (kept: their corners with the south and west walls a few texels apart), then
  // the four slipped from each wall in turn, up or down: the same corner takes the slip's parting, east-south (of the
  // two a slip parted, the one whose walls come later by brush and polygon), whichever wall the pointer is on. (In the
  // order offered, where the walk started decided: west-north with the pointer on the east or the south wall)
  const rolled = keepSlip({ faces: walls.slice(0, 2), queue: [], kept: null, exacts: null }, [0, [-500, 1024, 200], 0, undefined, [-5.3, 0, 1.7]]).page;
  const from = walls.map((f) => mappingNow(f, rolled.queue));
  for (const [ref, point] of [[0, [-500, 1024, 200]], [1, [1024, -500, 250]], [2, [500, -1024, 200]], [3, [-1024, 500, 200]]]) {
    for (const notches of [2, -3]) {
      const now = walls.map((f) => mappingNow(f, keepSlip({ ...rolled, faces: walls }, [ref, point, notches]).page.queue));
      const moved = corners.filter(([a, b, p]) => seamMoved([from[a], from[b]], [now[a], now[b]], [up(p), up(p)]) > 1);
      assert.deepEqual(moved.map(([a, b]) => [walls[a].id, walls[b].id]), [['east', 'south']], `on the ${walls[ref].id} wall, ${notches} notches`);
    }
  }
  const column = [...columnSides(), ...columnCaps()], sides = Array.from({ length: SIDES }, (_, i) => [i, (i + 1) % SIDES, add(columnCorner(i + 1), [0, 0, 50])]);
  const middle = (i) => add(times(add(columnCorner(i), columnCorner(i + 1)), 0.5), [0, 0, 64]);
  assert.deepEqual(open(column, [[0, middle(0), -3], [6, middle(6), 2], [SIDES, [30, -40, 128], 1]], sides), [[[6, 7]], [[6, 7]], []]);
});

test('a corner a roll of one wall alone lined up, then the four slipped: it stays lined up, within a texel', () => {
  // the room's four walls, the east wall's base 4 units along it (its two corners step 2 texels as built); the north
  // wall alone rolled 4 units (north-east lined up, west-north 2 texels open), kept; then -3 notches on the north wall
  // or +2 on the west one, the four: north-east within a texel. (Ranked as a side a slip parted since the first slip kept
  // on its faces, though it showed no step, north-east parted again, 23 and 47 texels)
  const walls = ['north', 'east', 'south', 'west'].map(wallOf).map((f) => (f.id === 'east' ? { ...f, mapping: { ...f.mapping, base: [1024, 4, 0] } } : f));
  const at = (name) => walls.findIndex((f) => f.id === name), [a, b, [x, y]] = CORNERS[0];
  const northEast = (page) => parting(mappingNow(walls[at(a)], page.queue), mappingNow(walls[at(b)], page.queue), [x, y, 100]);
  const rolled = keepSlip({ faces: walls.slice(0, 1), queue: [], kept: null, exacts: null }, [0, [-500, 1024, 200], 0, undefined, [-4, 0, 0]]).page;
  assert.ok(northEast(rolled) <= 1e-9, `the roll: ${northEast(rolled)}`);
  for (const [ref, point, notches] of [[0, [-500, 1024, 200], -3], [3, [-1024, 500, 200], 2]]) {
    const page = keepSlip({ ...rolled, faces: walls }, [ref, point, notches]).page;
    assert.ok(northEast(page) <= 1, `on the ${walls[ref].id} wall, ${notches} notches: north-east ${northEast(page).toFixed(2)}`);
  }
});

test('a ring whose texture steps by exactly a texel at a side: the float noise of the exact pans decides nothing, the same rows', () => {
  // the room's four walls, the east one's base 2 units along it: its corners step by exactly 1 texel (STEP) as built,
  // as original maps' whole pans and grid bases often leave a side. x2 on the north wall kept (four notches, or Ctrl
  // and one), then -6 notches on it, from the exact mappings that slip left and from the same with each exact pan 1e-12
  // texel off (what a Pan, an Undo or a Rebuild's read-back leaves in its last bits; U and V of each wall with one,
  // signed as review13_slip_stepnoise.mjs drew them for the walls in turn): the same rows. (Weighed against STEP alone,
  // the noise decided whether a corner stepped and so where the ring parted, a side a slip parted since ranked apart or
  // not: the south wall's pan came out 3744 texels other, 32 texels off; review13_slip_stepnoise.mjs, 1183 of about
  // 9000 slips). A step of exactly a texel is none: -3 notches on the north wall from the walls as built part the ring
  // at south-west, as in a room whose corners do not step, the east wall's corners within a texel of their step (counted
  // as a step, the ring parted at east-south; round 14's review, #6). And between two textures (partedSince): the east
  // wall of another texture, the four rolled (kept: no corner parted), the panel's Pan of the east wall by -1 texel (its
  // two corners exactly a texel off what the slip left: neither parted since), then -2 notches on the south wall, the
  // south wall's exact pan 1e-12 up and the others' down: the same rows (the noise decided which of the east wall's
  // corners parted), and the ring parts where it parts with no Pan between, neither corner parted since; so with the
  // Pan of the south wall instead, whose corner with the east wall is then exactly a texel off (counted as parted, the
  // ring parted there)
  const walls = ['north', 'east', 'south', 'west'].map(wallOf), north = [-500, 1024, 200], south = [500, -1024, 200];
  walls[1] = { ...walls[1], mapping: mappingOf([1024, 2, 0, 0, 0.5, 0, 0, 0, -0.5, 0, 0, 128, 128]) };
  // a table of exact mappings with each exact pan 1e-12 texel off, signed: U and V of each wall in turn
  const wall = (poly) => walls.findIndex((f) => f.poly === poly);
  const noisy = (table, signs) => new Map([...table].map(([brush, polys]) => [brush, new Map([...polys].map(([poly, kept]) => [poly,
    { ...kept, exact: { ...kept.exact, pan: kept.exact.pan.map((p, k) => p + signs[2 * wall(poly) + k] * 1e-12) } }]))]));
  const one = keepSlip({ faces: walls, queue: [], kept: null, exacts: null }, [0, north, 4]).page;
  const signs = [-1, 1, -1, 1, -1, -1, -1, -1];
  assert.deepEqual(keepSlip({ ...one, exacts: noisy(one.exacts, signs) }, [0, north, -6]).r.rows, keepSlip(one, [0, north, -6]).r.rows);
  // the corners a slip moved more than a texel (from: the page it started from, to: the page it left), on the walls'
  // mappings, whole repeats off
  const up = ([x, y]) => [[x, y, 0], [x, y, 384]], at = (page, id) => page.faces.findIndex((f) => f.id === id);
  const parts = (from, to) => CORNERS.filter(([a, b, p]) => seamMoved([a, b].map((id) => mappingNow(from.faces[at(from, id)], from.queue)),
    [a, b].map((id) => mappingNow(to.faces[at(to, id)], to.queue)), [up(p), up(p)]) > 1).map(([a, b]) => `${a}-${b}`);
  const fresh = { faces: walls, queue: [], kept: null, exacts: null };
  assert.deepEqual(parts(fresh, keepSlip(fresh, [0, north, -3]).page), ['south-west'], 'a step of exactly a texel');
  const textures = ['north', 'east', 'south', 'west'].map((name) => ({ ...wallOf(name), tex: name === 'east' ? 'Pkg.Panel' : 'Pkg.Wall' }));
  const rolled = keepSlip({ faces: textures, queue: [], kept: null, exacts: null }, [0, north, 0, undefined, [-5.3, 0, 1.7]]).page;
  const panned = { ...rolled, queue: [...rolled.queue, { op: 'pan', args: [-1, 0], targets: [{ brush: 'Brush2', poly: 1 }] }] };
  assert.deepEqual(keepSlip({ ...panned, exacts: noisy(panned.exacts, [-1, -1, -1, -1, 1, 1, -1, -1]) }, [2, south, -2]).r.rows,
    keepSlip(panned, [2, south, -2]).r.rows, 'between two textures');
  const unpanned = parts(rolled, keepSlip(rolled, [2, south, -2]).page);
  assert.equal(unpanned.length, 1, `between two textures, no Pan: ${unpanned}`);
  for (const poly of [1, 2]) {
    const pan = { ...rolled, queue: [...rolled.queue, { op: 'pan', args: [-1, 0], targets: [{ brush: 'Brush2', poly }] }] };
    assert.deepEqual(parts(pan, keepSlip(pan, [2, south, -2]).page), unpanned, `between two textures, the Pan of Brush2 face ${poly}`);
  }
});

test('faces in the plane of the face under the pointer, or joined to it by no edge, scale round the pointer\'s point as ever', () => {
  // the three walls of one texture from different bases, side by side, and the room's floor and ceiling (no edge with
  // them): the same rows with their pieces as without
  const wall = (id, brush, base, pan, from, to) => ({ id, brush, poly: 1, mapping: mappingOf([64, base, 0, 0, -1, 0, 0, 0, -1, pan, 0, 128, 128]),
    pieces: [[[64, to, 0], [64, to, 96], [64, from, 96], [64, from, 0]]] });
  const faces = [wall('A', 'Brush1', 400, 0, 272, 400), wall('B', 'Brush2', 336, 64, 400, 528), wall('C', 'Brush3', 400, 0, 528, 656),
    { ...face('floor'), pieces: [LAB.floor.points] }, { ...face('ceiling'), pieces: [LAB.ceiling.points] }];
  const bare = faces.map(({ pieces, ...f }) => f);
  for (const [notches, point] of [[3, [64, 350, 50]], [-5, [64, 600, 10]], [1, [64, 410, 90]]]) {
    const ref = faces.findIndex((f) => f.pieces[0][2][1] <= point[1] && point[1] <= f.pieces[0][0][1]);
    const run = (list) => slipResult(slipScale(slipPan(startSlip({ faces: list, ref, point, normal: [1, 0, 0] }), add(point, [0, 7.5, -3])), notches));
    const [joined, apartFrom] = [run(faces), run(bare)];
    assert.deepEqual(joined.rows, apartFrom.rows, `${notches} notches`);
    joined.preview.forEach((p, i) => nearMapping(p.mapping, apartFrom.preview[i].mapping, 0, `${notches} notches, face ${i}`));
  }
});

test('a whole room selected, floor and ceiling too: one corner of its walls parts, the one farthest round, wherever the pointer is', () => {
  // the six faces as Select whole brush lists them, the floor first. The floor's and the ceiling's textures run on into
  // no wall: the walls go round together from the wall under the pointer, or from the one nearest the pointer on the
  // floor or the ceiling, and the ring closes at a corner across from it (carried over the floor, the walls parted at
  // two corners, and at all four with the pointer on the floor)
  const room = WHOLE_ROOM.map(roomFace);
  for (const [on, point, normal, corner] of [['north', [584, 1024, 200], [0, -1, 0], ['south', 'west']], ['east', [1024, -300, 100], [-1, 0, 0], ['south', 'west']],
    ['floor', [300, 900, 0], [0, 0, 1], ['south', 'west']], ['floor', [0, -900, 0], [0, 0, 1], ['west', 'north']], ['floor', [-900, 0, 0], [0, 0, 1], ['east', 'south']],
    ['ceiling', [-300, 500, 384], [0, 0, -1], ['south', 'west']]]) {
    for (const notches of [1, -3]) {
      const r = slipResult(slipScale(startSlip({ faces: room, ref: WHOLE_ROOM.indexOf(on), point, normal }), notches));
      const mapping = (name) => r.preview[WHOLE_ROOM.indexOf(name)].mapping;
      const parted = CORNERS.filter(([a, b, [x, y]]) => [10, 300].some((z) => parting(mapping(a), mapping(b), [x, y, z]) > 1 + 1e-9));
      assert.deepEqual(parted.map(([a, b]) => [a, b]), [corner], `on the ${on} at ${point}, ${notches} notches`);
      assert.ok(r.rows.every((row) => valid(row) && rowProblem(row) === ''));
    }
  }
});

test('walls of one texture over a floor of another that runs on into two of them: the ring closes at the floor, no wall corner parts', () => {
  // the room's north, east and south walls (the south one's U mirrored, running the north one's way along x) and a floor
  // of another texture whose U runs on into the north and south walls along their bases, the pointer on the floor. The
  // walls do not go round (three of them), but through the floor they make a ring 8 tiles round: walked breadth-first
  // from the floor, the south wall was reached from it and the ring closed at the east-south corner, 35 texels apart a
  // notch. The sides between walls of one texture are crossed first, so it closes at the floor's edge, between textures:
  // the same edge wherever the pointer is, on the floor or on a wall (the floor's two edges rank alike, crossed in the
  // order of their faces' brushes and polygons; in the order offered, the pointer on the north wall parted the south
  // edge, on the south wall the north one). No pans: the texture steps at none of the ring's sides, so the textures alone
  // say where it closes
  const floor = { id: 'floor', brush: 'Brush2', poly: 4, tex: 'Floor', mapping: mappingOf([0, 0, 0, -0.5, 0, 0, 0, 0.5, 0, 0, 0, 128, 128]),
    pieces: [[[-1024, -1024, 0], [1024, -1024, 0], [1024, 1024, 0], [-1024, 1024, 0]]] };
  const south = { ...wallOf('south'), mapping: mappingOf([0, -1024, 0, -0.5, 0, 0, 0, 0, -0.5, 0, 0, 128, 128]) };
  const faces = [floor, ...[wallOf('north'), wallOf('east'), south].map((f) => ({ ...f, tex: 'Wall' }))];
  const up = (x, y) => [[x, y, 0], [x, y, 384]], base = (y) => [[-1024, y, 0], [1024, y, 0]];
  const sides = [[1, 2, up(1024, 1024)], [2, 3, up(1024, -1024)], [0, 1, base(1024)], [0, 3, base(-1024)]];
  const moved = (list, r) => sides.map(([a, b, side]) => seamMoved([list[a].mapping, list[b].mapping], [r.preview[a].mapping, r.preview[b].mapping], [side, side]));
  const partedEdges = [];
  for (const [ref, point] of [[0, [300, 200, 0]], [0, [-700, -800, 0]], [1, [0, 1024, 200]], [3, [0, -1024, 200]]]) {
    for (const notches of [1, -3]) {
      const what = `at ${point}, ${notches} notches`, normal = piecesNormal(faces[ref].pieces);
      const r = slipResult(slipScale(startSlip({ faces, ref, point, normal }), notches));
      const [northEast, eastSouth, floorNorth, floorSouth] = moved(faces, r);
      assert.ok(northEast <= 1 + 1e-9 && eastSouth <= 1 + 1e-9, `${what}: the wall corners ${northEast} and ${eastSouth} texels`);
      assert.ok(Math.min(floorNorth, floorSouth) <= 0.5 + 1e-9 && Math.max(floorNorth, floorSouth) > 1, `${what}: the floor's edges ${floorNorth} and ${floorSouth} texels`);
      partedEdges.push(floorNorth > 1 ? 'north' : 'south');
      if (ref) continue;
      // given no texture, every face counts as one texture: the floor's long sides first, the ring closed at a corner
      const bare = faces.map(({ tex, ...f }) => f);
      assert.ok(moved(bare, slipResult(slipScale(startSlip({ faces: bare, point, normal }), notches)))[1] > 1, what);
    }
  }
  assert.deepEqual(partedEdges, partedEdges.map(() => partedEdges[0]), 'the floor\'s edge that parts');
});

test('a column with its caps: one side edge parts, the caps listed first or last, the pointer on a side or on a cap', () => {
  // the caps' Floor runs on into no side: the sides go round from the one under the pointer, or from the one nearest
  // the pointer on a cap (carried over a cap, 8 to 12 side edges parted)
  const middle = add(times(add(columnCorner(0), columnCorner(1)), 0.5), [0, 0, 64]);
  for (const capsFirst of [false, true]) {
    const column = capsFirst ? [...columnCaps(), ...columnSides()] : [...columnSides(), ...columnCaps()];
    const at = (id) => column.findIndex((f) => f.id === id);
    const edges = Array.from({ length: SIDES }, (_, i) => [i, (i + 1) % SIDES, add(columnCorner(i + 1), [0, 0, 50])]);
    for (const [on, point, notches] of [[0, middle, 1], [0, middle, -3], ['top', [30, -40, 128], 1], ['bottom', [-60, 20, 0], -2]]) {
      const s = startSlip({ faces: column, ref: at(on), point, normal: faceNormal(column[at(on)].pieces[0]) });
      const after = slipResult(slipScale(s, notches)).preview.map((p) => p.mapping);
      const open = edges.filter(([a, b, p]) => parting(after[at(a)], after[at(b)], p) > 1 + 1e-9);
      const what = `caps ${capsFirst ? 'first' : 'last'}, on ${on}, ${notches} notches: ${JSON.stringify(open.map(([a, b]) => [a, b]))}`;
      assert.equal(open.length, 1, what);
      if (on === 0) assert.ok(open[0][0] === 6 || open[0][1] === 6, `${what}: the side across from the pointer's`);
    }
  }
});

test('a texture meeting mirrored over an edge (a box\'s Floor and Wall): the edge exactly as it was; a whole crate round as one', () => {
  // the crate's top and its north side show the same texel along their edge, V running away from it on both. Scaling
  // round the pointer's point turned onto the side (the box unfolded) parted them by 20 texels a notch
  const top = crateFace('top', 0), north = crateFace('north', 4), edge = [0, 37, 64, 128].map((x) => [x, 128, 128]);
  for (const p of edge) assert.equal(parting(top.mapping, north.mapping, p), 0);
  for (const point of [[64, 64, 128], [64, 120, 128], [20, 8, 128]]) {
    for (const notches of [1, 4, -2]) {
      const r = slipResult(slipScale(startSlip({ faces: [top, north], point, normal: [0, 0, 1] }), notches));
      for (const p of edge) assert.equal(parting(r.preview[0].mapping, r.preview[1].mapping, p), 0, `at ${point}, ${notches} notches, edge point ${p}`);
    }
  }
  // all six faces: the edges whole before (the four of the sides' ring, top and bottom with the north side) stay so
  // but the one that closes the ring, across from the side under the pointer or the north side (from the top)
  const crate = Object.keys(CRATE).map(crateFace), names = Object.keys(CRATE), edges = [];
  names.forEach((a, i) => names.forEach((b, j) => {
    const shared = CRATE[a].filter((p) => CRATE[b].some((q) => q.every((x, k) => x === p[k])));
    if (i < j && shared.length === 2) edges.push([i, j, [0.1, 0.5, 0.9].map((t) => add(shared[0], times(sub(shared[1], shared[0]), t)))]);
  }));
  const seam = (maps, [a, b, points]) => Math.max(...points.map((p) => parting(maps[a], maps[b], p)));
  const whole = edges.filter((edge) => seam(crate.map((f) => f.mapping), edge) === 0);
  const named = (list) => list.map(([a, b]) => [names[a], names[b]]);
  assert.deepEqual(named(whole), [['top', 'north'], ['bottom', 'north'], ['south', 'east'], ['south', 'west'], ['east', 'north'], ['north', 'west']]);
  for (const [on, point, normal, closing] of [['south', [40, 0, 90], [0, -1, 0], ['north', 'west']], ['top', [40, 30, 128], [0, 0, 1], ['south', 'west']]]) {
    for (const notches of [1, -2]) {
      const maps = slipResult(slipScale(startSlip({ faces: crate, ref: names.indexOf(on), point, normal }), notches)).preview.map((p) => p.mapping);
      const open = named(whole.filter((edge) => seam(maps, edge) > 1 + 1e-9));
      assert.deepEqual(open, [closing], `on the ${on}, ${notches} notches`);
    }
  }
});

test('a floor and a wall whose texture does not run on round their edge: each scales round the pointer\'s point on its own axes', () => {
  // the room's floor (U along x) and north wall (U along -x, at half the rate): the same rows with their pieces as
  // without, the pointer on either (turned onto the wall, the floor's point parted their V by 55 texels in 2 notches)
  const faces = ['floor', 'north'].map(roomFace), bare = faces.map(({ pieces, ...f }) => f);
  for (const [ref, point, normal] of [[0, [898, 898, 0], [0, 0, 1]], [1, [300, 1024, 100], [0, -1, 0]]]) {
    for (const notches of [2, -1]) {
      const run = (list) => slipResult(slipScale(startSlip({ faces: list, ref, point, normal }), notches));
      assert.deepEqual(run(faces).rows, run(bare).rows, `on face ${ref}, ${notches} notches`);
    }
  }
});

test('walls whose corners the view rounds (NYC Ship Below), one 0.17 off its wall: their texture still runs on round the side they share', () => {
  // two walls of a corridor of the ship (Brush608 faces 3 and 4), one corner of the first 0.17 off its plane in the
  // view's 2 decimals: the side they share judged on each wall's own edge, where the texture runs on (taken as not
  // running on, the second wall scaled round its own point: 50 texels apart after a notch)
  const ship = [
    { id: 'a', brush: 'Brush608', poly: 3, mapping: mappingOf([-4480, 1152, -96, -1, 0, 0, 0, 0, -1, 0, 25, 128, 256]), pieces: [[[-5504, 1152, -96],
      [-5504, 1152, -64], [-5064, 1152, -64], [-4943, 1152, -64], [-4920, 1152.17, -64], [-4880, 1152, -64], [-4480, 1152, -64], [-4480, 1152, -96]]] },
    { id: 'b', brush: 'Brush608', poly: 4, mapping: mappingOf([-4480, 1536, -96, 0, -1, 0, 0, 0, -1, 0, 25, 128, 256]),
      pieces: [[[-4480, 1344, -96], [-4480, 1152, -96], [-4480, 1152, -64], [-4480, 1536, -64], [-4480, 1536, -96]]] },
  ];
  const corner = [-96, -80, -64].map((z) => [-4480, 1152, z]);
  for (const p of corner) assert.equal(parting(ship[0].mapping, ship[1].mapping, p), 0);
  for (const notches of [1, -2]) {
    const r = slipResult(slipScale(startSlip({ faces: ship, point: [-5000, 1152, -80], normal: piecesNormal(ship[0].pieces) }), notches));
    for (const p of corner) assert.ok(parting(r.preview[0].mapping, r.preview[1].mapping, p) <= 0.5 + 1e-9, `${notches} notches at ${p}`);
  }
});

test('a face reached over another plane is carried on from the one before it: every edge on the way kept', () => {
  // the crate's top and its north side cut in two, the upper half on the top's edge and the lower one only on the
  // upper's, panned a tile (whole tiles apart, as one texture); the lower listed first
  const top = crateFace('top', 0), upper = aligned('upper', 'Brush50', 4, [[128, 128, 64], [0, 128, 64], [0, 128, 128], [128, 128, 128]], 'wall');
  const below = aligned('lower', 'Brush50', 6, [[128, 128, 0], [0, 128, 0], [0, 128, 64], [128, 128, 64]], 'wall');
  const lower = { ...below, mapping: mappingAfter(below.mapping, [{ op: 'pan', args: [0, 128] }]) };
  const faces = [lower, top, upper], edges = [[1, 2, [0, 37, 128].map((x) => [x, 128, 128])], [2, 0, [0, 37, 128].map((x) => [x, 128, 64])]];
  for (const [a, b, points] of edges) for (const p of points) assert.equal(parting(faces[a].mapping, faces[b].mapping, p), 0);
  for (const point of [[64, 64, 128], [20, 8, 128]]) {
    const s = startSlip({ faces, ref: 1, point, normal: [0, 0, 1] });
    for (const notches of [1, -2]) {
      const maps = slipResult(slipScale(s, notches)).preview.map((p) => p.mapping);
      for (const [a, b, points] of edges) for (const p of points) assert.equal(parting(maps[a], maps[b], p), 0, `at ${point}, ${notches} notches, ${a}-${b} at ${p}`);
    }
    // the lower one scales round the top's texel at the pointer, and what the upper half shows more on the top's edge
    // (none), and what the lower one shows more on theirs (a tile)
    nearList(texelOf(s.carried[0], point), add(texelOf(top.mapping, point), [0, 128]), 1e-9);
  }
});

test('a face only a Rebuild shows (no mapping) joins no other: the walls round it are carried the other way', () => {
  // the room's four walls, the east one with a change queued that only a Rebuild shows: left out, the south wall
  // reached round the west one (through the east one, the ring closed at the south-west corner, by 12 texels a notch)
  const walls = ['north', 'east', 'south', 'west'].map(wallOf);
  walls[1] = { ...walls[1], mapping: null };
  for (const notches of [1, -3]) {
    const r = slipResult(slipScale(startSlip({ faces: walls, point: [584, 1024, 200], normal: [0, -1, 0] }), notches));
    const [north, east, south, west] = r.preview.map((p) => p.mapping);
    assert.deepEqual([r.left, east], [['east'], null]);
    for (const z of [10, 300]) {
      assert.ok(parting(north, west, [-1024, 1024, z]) <= 0.5 + 1e-9, `${notches} notches: north-west at z ${z}`);
      assert.ok(parting(west, south, [-1024, -1024, z]) <= 1 + 1e-9, `${notches} notches: south-west at z ${z}`);
    }
  }
});

test('a corner the engine left a little off its plane: the edge judged and kept on the side the faces share', () => {
  // the crate's top and north side, their texture meeting mirrored over the edge, the top's corner (0, 0) 0.3 above its
  // plane as the view has it (NYC Underground's Brush519 face 8 has one at z -536.03): taken from the planes' line,
  // turned off the edge, the edge was refused and parted by 10 texels a notch, 44 in -3
  const top = crateFace('top', 0), north = crateFace('north', 4), edge = [[0, 128, 128], [128, 128, 128]];
  const tilted = { ...top, pieces: [[[0, 0, 128.3], ...CRATE.top.slice(1)]] };
  for (const [ref, point, normal] of [[0, [64, 64, 128], [0, 0, 1]], [0, [20, 100, 128], [0, 0, 1]], [1, [64, 128, 30], [0, 1, 0]]]) {
    for (const notches of [1, -3]) {
      const r = slipResult(slipScale(startSlip({ faces: [tilted, north], ref, point, normal }), notches));
      const moved = seamMoved([top.mapping, north.mapping], r.preview.map((p) => p.mapping), [edge, edge]);
      assert.ok(moved <= 0.5 + 1e-9, `on face ${ref} at ${point}, ${notches} notches: ${moved} texels`);
    }
  }
});

test('faces in one plane whose texture runs on over their seam, mirrored or stretched across it: the seam kept', () => {
  // two faces of a floor (Brush60: A x 0..64, B x 64..128), 2 texels a unit: B's V mirrored over the seam at x 64 (4 tiles
  // apart there), or B's U 1.66 against A's 2 (UNATCO HQ's Brush1941 and Brush775); each scaled round its own texel at
  // the pointer's point, the seam parted by 28 texels a notch. Then the mirrored pair turned 30 degrees, its corners as
  // the view rounds them (2 decimals: the seam's ends a hair across it, 0.08 texel of drift along it)
  const floor = (id, poly, from, nums) => ({ id, brush: 'Brush60', poly, mapping: mappingOf(nums),
    pieces: [[[from, 0, 0], [from + 64, 0, 0], [from + 64, 64, 0], [from, 64, 0]]] });
  const mirrored = [floor('A', 0, 0, [0, 0, 0, 0, -2, 0, 2, 0, 0, 0, 0, 64, 64]), floor('B', 1, 64, [0, 0, 0, 0, -2, 0, -2, 0, 0, 0, 0, 64, 64])];
  const stretched = [floor('A', 0, 0, [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 128, 128]), floor('B', 1, 64, [64, 0, 0, 1.66, 0, 0, 0, 2, 0, 128, 0, 128, 128])];
  const turn = (p) => [p[0] * Math.cos(Math.PI / 6) - p[1] * Math.sin(Math.PI / 6), p[0] * Math.sin(Math.PI / 6) + p[1] * Math.cos(Math.PI / 6), p[2]];
  const round = (p) => p.map((x) => Math.round(x * 100) / 100);
  const turned = mirrored.map((f) => ({ ...f, pieces: f.pieces.map((piece) => piece.map((p) => round(turn(p)))),
    mapping: { ...f.mapping, base: turn(f.mapping.base), u: turn(f.mapping.u), v: turn(f.mapping.v) } }));
  for (const [what, faces, at] of [['mirrored', mirrored, (p) => p], ['stretched', stretched, (p) => p], ['mirrored, turned', turned, turn]]) {
    const seam = [at([64, 0, 0]), at([64, 64, 0])];
    for (const [ref, point] of [[0, at([20, 30, 0])], [1, at([100, 40, 0])]]) {
      for (const notches of [1, -3]) {
        const r = slipResult(slipScale(startSlip({ faces, ref, point, normal: [0, 0, 1] }), notches));
        const moved = seamMoved(faces.map((f) => f.mapping), r.preview.map((p) => p.mapping), [seam, seam]);
        assert.ok(moved <= 0.5 + 1e-9, `${what}, on ${faces[ref].id}, ${notches} notches: ${moved} texels`);
      }
    }
  }
});

test('a sign set in a wall, its U mirrored: of the two sides it runs on over, both stepping, the one nearest the pointer kept', () => {
  // a sign (Brush679, x 128 to 192, z 16 to 144: 64 x 128 texels) in a concrete wall cut round it (Brush243: 128 x 64),
  // as in Wan Chai Market: the texture runs on over the sign's left and right sides (160 and 32 texels apart there, a
  // step at both), not over its top and bottom. A ring of two faces: one of those sides parts, the one farther from the
  // pointer
  const sign = { id: 'sign', brush: 'Brush679', poly: 2, mapping: mappingOf([128, 0, 16, 1, 0, 0, 0, 0, -1, 0, 0, 64, 128]),
    pieces: [[[128, 0, 16], [192, 0, 16], [192, 0, 144], [128, 0, 144]]] };
  const wall = { id: 'wall', brush: 'Brush243', poly: 3, mapping: mappingOf([240, 0, 0, -1, 0, 0, 0, 0, -1, 48, 44, 128, 64]),
    pieces: [[[0, 0, 0], [256, 0, 0], [256, 0, 16], [0, 0, 16]], [[0, 0, 144], [256, 0, 144], [256, 0, 256], [0, 0, 256]],
      [[0, 0, 16], [128, 0, 16], [128, 0, 144], [0, 0, 144]], [[192, 0, 16], [256, 0, 16], [256, 0, 144], [192, 0, 144]]] };
  const left = [[128, 0, 16], [128, 0, 144]], right = [[192, 0, 16], [192, 0, 144]];
  for (const [ref, point, kept] of [[0, [135, 0, 80], left], [1, [230, 0, 80], right], [0, [185, 0, 30], right], [1, [40, 0, 200], left]]) {
    for (const notches of [1, -3]) {
      const r = slipResult(slipScale(startSlip({ faces: [sign, wall], ref, point, normal: [0, -1, 0] }), notches));
      const moved = seamMoved([sign.mapping, wall.mapping], r.preview.map((p) => p.mapping), [kept, kept]);
      assert.ok(moved <= 1, `on the ${['sign', 'wall'][ref]} at ${point}, ${notches} notches: the side at x ${kept[0][0]} parted by ${moved}`);
    }
  }
});

test('a walk of its own (a floor apart from the wall under the pointer): its first face keeps its mapping, the others carried', () => {
  // the floor's two faces run on into each other, not into the wall under the pointer; F2's U leaves the floor (as the
  // engine allows: only its part along the floor shows). Each kept its own mapping and scaled round its texel at the
  // pointer's point, 128 above the floor, where their U differ: the seam parted by 11 texels a notch, 44 in -3
  const wall = { id: 'N', brush: 'Brush61', poly: 0, mapping: mappingOf([0, 512, 0, -1, 0, 0, 0, 0, -1, 0, 0, 128, 128]),
    pieces: [[[512, 512, 0], [-512, 512, 0], [-512, 512, 256], [512, 512, 256]]] };
  const f1 = { id: 'F1', brush: 'Brush61', poly: 1, mapping: mappingOf([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 128, 128]),
    pieces: [[[-512, -512, 0], [0, -512, 0], [0, 512, 0], [-512, 512, 0]]] };
  const f2 = { id: 'F2', brush: 'Brush61', poly: 2, mapping: mappingOf([0, 0, 0, 1, 0, 0.5, 0, 1, 0, 0, 0, 128, 128]),
    pieces: [[[0, -512, 0], [512, -512, 0], [512, 512, 0], [0, 512, 0]]] };
  const seam = [[0, -512, 0], [0, 512, 0]];
  for (const notches of [1, -3]) {
    const s = startSlip({ faces: [wall, f1, f2], ref: 0, point: [300, 512, 128], normal: [0, -1, 0] });
    const r = slipResult(slipScale(s, notches));
    const moved = seamMoved([f1.mapping, f2.mapping], [r.preview[1].mapping, r.preview[2].mapping], [seam, seam]);
    assert.ok(moved <= 0.5 + 1e-9, `${notches} notches: ${moved} texels`);
    nearMapping(s.carried[2], f2.mapping, 0, 'the first face of the floor\'s walk (the nearest the pointer): its own');
  }
});

test('pipe facets in one plane as the view rounds them, V flipped on one: not joined, each round its own point', () => {
  // two segments of a pipe (NYC Ship Below's Brush1679 and Brush1678, faces 7), a facet 5.7 wide at 45 degrees each, the
  // second 0.003 and 0.004 off the first, their corners rounded to 2 decimals: normals 1.3e-3 apart. Taken as meeting
  // at an angle on a line of that noise, the second was carried from the first, 3 texels in V off its own point
  const facet = (y0, y1, c) => {
    const at = (deg, y) => [c[0] + 7.39 * Math.cos(deg * Math.PI / 180), y, c[2] + 7.39 * Math.sin(deg * Math.PI / 180)];
    return [at(292.5, y0), at(337.5, y0), at(337.5, y1), at(292.5, y1)];
  };
  const mapping = (corners, flip) => {
    const across = sub(corners[1], corners[0]), length = Math.hypot(...across);
    return mappingOf([...corners[0], 0, 1, 0, ...times(across, (flip ? -4 : 4) / length), 0, 0, 128, 128]);
  };
  const round = (p) => p.map((x) => Math.round(x * 100) / 100);
  const a = facet(-1184, -1120, [-1824, 0, -367.791]), b = facet(-1120, -1056, [-1824 + 0.003, 0, -367.791 + 0.004]);
  const faces = [{ id: 'a', brush: 'Brush1679', poly: 7, mapping: mapping(a, false), pieces: [a.map(round)] },
    { id: 'b', brush: 'Brush1678', poly: 7, mapping: mapping(b, true), pieces: [b.map(round)] }];
  const point = [(a[0][0] + a[1][0]) / 2, -1130, (a[0][2] + a[1][2]) / 2], normal = piecesNormal(faces[0].pieces);
  const s = startSlip({ faces, point, normal });
  nearMapping(s.carried[1], faces[1].mapping, 0, 'the second facet scales round its own point');
  const alone = slipResult(slipScale(startSlip({ faces: [faces[1]], point, normal: piecesNormal(faces[1].pieces) }), 1)).preview[0].mapping;
  sameTexel(slipResult(slipScale(s, 1)).preview[1].mapping, point, alone, point, 1, 'the second facet, as slipped alone');
});

test('a ramp off the floor under the pointer, its axes the floor\'s along the floor: carried, not its own, on and on', () => {
  // the floor (Brush64, 256 a side) under the pointer, a ramp at 45 degrees on its north edge in two faces, the texture
  // running on over both edges: the ramp's V the floor's along the floor (and up the slope), the upper face's leaving
  // the ramp's plane (as the engine allows: only its part along the plane shows). Kept as its own mapping, the ramp's
  // lower face made the upper one keep its own too, scaled round its texel at the pointer's point, off their plane: their
  // seam parted by 5 texels a notch
  const square = (y0, y1, z0, z1) => [[0, y0, z0], [256, y0, z0], [256, y1, z1], [0, y1, z1]];
  const floor = { id: 'floor', brush: 'Brush64', poly: 0, mapping: mappingOf([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 128, 128]), pieces: [square(0, 256, 0, 0)] };
  const lower = { id: 'lower', brush: 'Brush64', poly: 1, mapping: mappingOf([0, 0, 0, 1, 0, 0, 0, 1, 0.5, 0, 0, 128, 128]), pieces: [square(256, 384, 0, 128)] };
  const n = faceNormal(lower.pieces[0]), off = times(n, 0.3), v = add([0, 1, 0.5], off);
  const upper = { id: 'upper', brush: 'Brush64', poly: 2, mapping: mappingOf([0, 0, 0, 1, 0, 0, ...v, 0, -dot(off, [0, 256, 0]), 128, 128]),
    pieces: [square(384, 512, 128, 256)] };
  const edges = [[0, 1, [[0, 256, 0], [256, 256, 0]]], [1, 2, [[0, 384, 128], [256, 384, 128]]]], faces = [floor, lower, upper];
  for (const notches of [1, -3]) {
    const r = slipResult(slipScale(startSlip({ faces, point: [128, 100, 0], normal: [0, 0, 1] }), notches));
    for (const [a, b, edge] of edges) {
      const moved = seamMoved([faces[a].mapping, faces[b].mapping], [r.preview[a].mapping, r.preview[b].mapping], [edge, edge]);
      assert.ok(moved <= 0.5 + 1e-9, `${faces[a].id}-${faces[b].id}, ${notches} notches: ${moved} texels`);
    }
  }
  // the lower face's V the floor's over the ramp's plane too (half its normal more, which shows nowhere on it): still
  // carried, the faces at an angle (judged in the ramp's plane alone, it kept its own mapping and scaled round its own
  // texel off its plane: 8.4 texels a notch)
  const level = { ...lower, mapping: mappingOf([0, 0, 0, 1, 0, 0, ...add([0, 1, 0], times(n, 0.5)), 0, 0, 128, 128]) };
  for (const notches of [1, -3]) {
    const r = slipResult(slipScale(startSlip({ faces: [floor, level], point: [128, 100, 0], normal: [0, 0, 1] }), notches));
    const moved = seamMoved([floor.mapping, level.mapping], r.preview.map((p) => p.mapping), [edges[0][2], edges[0][2]]);
    assert.ok(moved <= 0.5 + 1e-9, `the ramp level with the floor's V, ${notches} notches: ${moved} texels`);
  }
});

test('a sheet\'s two sides, back to back as the view rounds them: not joined, each round its own point', () => {
  // a pane (Brush62) seen from both sides, the back's U mirrored as a two-sided sheet has it, one of its corners 0.01 off
  // the plane in the view: normals 8e-5 from opposite. Taken as faces at an angle, the back was carried round the edge
  // from the front and scaled round the front's texel, not its own at the pointer's point
  const front = { id: 'front', brush: 'Brush62', poly: 0, mapping: mappingOf([0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 128, 128]),
    pieces: [[[0, 0, 0], [0, 128, 0], [0, 128, 128], [0, 0, 128]]] };
  const back = { id: 'back', brush: 'Brush62', poly: 1, mapping: mappingOf([0, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 128, 128]),
    pieces: [[[0, 0, 0], [0, 0, 128], [0, 128, 128], [0.01, 128, 0]]] };
  const s = startSlip({ faces: [front, back], point: [0, 40, 70], normal: [1, 0, 0] });
  nearMapping(s.carried[1], back.mapping, 0, 'the back keeps its own mapping');
});

test('a floor and a face going up 1 degree off its edge are not one plane: carried, though their axes agree over it', () => {
  // a floor (Brush65) and a face rising off its north edge at 1 degree, its V the floor's and half its own normal (the
  // same as the floor's over its plane, as the engine allows), the pointer on the floor 1250 units off. Faces within
  // FLAT (the sine 2e-3) are one plane, and one whose axes agree over it keeps its own mapping: the rising face scaled
  // round its own texel at the pointer's point, 22 units off its plane, and their edge went apart
  const floor = { id: 'floor', brush: 'Brush65', poly: 0, mapping: mappingOf([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 128, 128]),
    pieces: [[[0, 0, 0], [256, 0, 0], [256, 256, 0], [0, 256, 0]]] };
  const far = [256 * Math.cos(Math.PI / 180), 256 * Math.sin(Math.PI / 180)];
  const pieces = [[[0, 256, 0], [256, 256, 0], [256, 256 + far[0], far[1]], [0, 256 + far[0], far[1]]]], n = faceNormal(pieces[0]);
  const rising = { id: 'rising', brush: 'Brush65', poly: 1, mapping: mappingOf([0, 0, 0, 1, 0, 0, ...add([0, 1, 0], times(n, 0.5)), 0, 0, 128, 128]), pieces };
  const edge = [[0, 256, 0], [256, 256, 0]];
  for (const notches of [1, -3, -8]) {
    const r = slipResult(slipScale(startSlip({ faces: [floor, rising], point: [128, -1000, 0], normal: [0, 0, 1] }), notches));
    const moved = seamMoved([floor.mapping, rising.mapping], r.preview.map((p) => p.mapping), [edge, edge]);
    assert.ok(moved <= 0.5 + 1e-9, `${notches} notches: ${moved} texels`);
  }
});

test('walls whose V does not run on round their corner (the east one\'s twice the north\'s): each round its own point', () => {
  // the room's north and east walls, the east wall's V scaled to twice the rate: U runs on round the corner, V does not
  // (384 texels apart along it). The same rows with their pieces as without, the pointer on either wall
  const north = wallOf('north'), east = { ...wallOf('east'), mapping: mappingAfter(wallOf('east').mapping, [{ op: 'scale', args: [1, 0.5] }]) };
  const faces = [north, east], bare = faces.map(({ pieces, ...f }) => f);
  for (const [ref, point, normal] of [[0, [300, 1024, 100], [0, -1, 0]], [1, [1024, 300, 100], [-1, 0, 0]]]) {
    for (const notches of [2, -1]) {
      const run = (list) => slipResult(slipScale(startSlip({ faces: list, ref, point, normal }), notches));
      assert.deepEqual(run(faces).rows, run(bare).rows, `on face ${ref}, ${notches} notches`);
    }
  }
});

test('a texture that goes apart along an edge by up to half a texel still runs on round it (0.45 texel), more does not (0.55)', () => {
  // the room's north and east walls, the east wall's V a hair off the north's: 0.45 texel apart from the floor to the
  // ceiling along their corner (the walls joined, the corner kept within a texel and what that drift does at its ends),
  // or 0.55 (each round its own point: the same rows with their pieces as without)
  const north = wallOf('north'), point = [584, 1024, 200], corner = [[1024, 1024, 0], [1024, 1024, 384]];
  const eastWith = (drift) => ({ ...wallOf('east'), mapping: mappingOf([1024, 0, 0, 0, 0.5, 0, 0, 0, -0.5 - drift / 384, 0, 0, 128, 128]) });
  const run = (faces, notches) => slipResult(slipScale(startSlip({ faces, point, normal: [0, -1, 0] }), notches));
  for (const notches of [1, -3]) {
    const near = [north, eastWith(0.45)], r = run(near, notches);
    const moved = seamMoved(near.map((f) => f.mapping), r.preview.map((p) => p.mapping), [corner, corner]);
    assert.ok(moved <= 1 + 0.225 * Math.abs(1 - 1 / r.scale) + 1e-9, `0.45 texel, ${notches} notches: ${moved} texels`);
    const far = [north, eastWith(0.55)];
    assert.deepEqual(run(far, notches).rows, run(far.map(({ pieces, ...f }) => f), notches).rows, `0.55 texel, ${notches} notches`);
  }
  // 0.3 and 0.42 texel, slips kept one after the other (-3 notches on the north wall, -2 on the east one, -2 on the
  // north one): the drift judged at the scale the walls were built at, the corner within a texel and its drift's share
  // after each. The first made the texture smaller (x0.59), so on the mappings the second starts from the corner went
  // 0.5 and 0.7 texel apart: taken as not running on, each wall scaled round its own point, 53.5 apart
  for (const drift of [0.3, 0.42]) {
    const faces = [north, eastWith(drift)];
    let scale = 1;
    keepSlips(faces, [[0, point, -3], [1, [1024, -600, 300], -2], [0, [-300, 1024, 100], -2]], (queue, r, i) => {
      scale *= r.scale;
      const moved = seamMoved(faces.map((f) => f.mapping), faces.map((f) => mappingNow(f, queue)), [corner, corner]);
      assert.ok(moved <= 1 + drift / 2 * Math.abs(1 - 1 / scale) + 1e-9, `${drift} texel, slip ${i + 1} kept: ${moved} texels`);
    });
  }
  // the run broken between two slips as the page breaks it: an Undo (the queue made again: no exact mappings), the
  // Surface panel's Pan pushed onto the queue (its length changed: none either), the north wall alone nudged a texel
  // between (the east wall left out: its exact mapping lost). -3 notches on the north wall kept, then -2 on the east
  // one: the corner within a texel and its drift's share. Judged at the scale of the exact mappings, or at today's when
  // they were lost, the walls scaled each round its own point, 53.5 texels apart
  for (const drift of [0.3, 0.42]) {
    const faces = [north, eastWith(drift)].map((f) => ({ ...f, built: f.mapping }));
    // a slip of faces[which] kept, each from the queue and its exact mapping (exact[k], or none): the queue after it, the
    // exact mappings it leaves them (none for the others) and its scale
    const keep = (queue, exact, which, ref, at, notches, nudge = 0) => {
      const list = which.map((k) => ({ ...faces[k], mapping: mappingNow(faces[k], queue), exact: exact[k] }));
      const s = slipNudge(slipScale(startSlip({ faces: list, ref, point: at, normal: piecesNormal(list[ref].pieces) }), notches), nudge, 0);
      const r = slipResult(s, { queue, exact: true }), left = faces.map(() => null);
      which.forEach((k, j) => { left[k] = r.preview[j].exact; });
      return { queue: foldRows(queue, r.rows), exact: left, k: r.scale };
    };
    const first = keep([], [null, null], [0, 1], 0, point, -3), nudged = keep(first.queue, first.exact, [0], 0, point, 0, 1);
    const pan = { op: 'pan', args: [5, 0], targets: faces.map(({ brush, poly }) => ({ brush, poly })) };
    for (const [what, queue, exact] of [['an Undo', [...first.queue], [null, null]], ['a Pan', [...first.queue, pan], [null, null]],
      ['the north wall alone between', nudged.queue, nudged.exact]]) {
      const last = keep(queue, exact, [0, 1], 1, [1024, -600, 300], -2);
      const moved = seamMoved(faces.map((f) => f.mapping), faces.map((f) => mappingNow(f, last.queue)), [corner, corner]);
      assert.ok(moved <= 1 + drift / 2 * Math.abs(1 - 1 / (first.k * last.k)) + 1e-9, `${drift} texel, ${what}: ${moved} texels`);
    }
  }
  // a texture made larger or smaller: 0.55 texel, +4 notches on the north wall kept (x2) then +2 on the east one, or -3
  // then -2, each from the queue and the exact mappings. On the mappings the second slip starts from, the corner goes
  // 0.275 or 0.925 texel apart, 0.55 at the scale built: each wall round its own point both times, the same rows as the
  // walls without their pieces. (Judged at the scale now when larger, or at the scale's square when smaller, the second
  // slip ran on round the corner)
  const far = [north, eastWith(0.55)], bare = far.map(({ pieces, ...f }) => f);
  const queuedRows = (faces, slips) => { const out = []; keepSlips(faces, slips, (queue, r) => out.push(r.rows)); return out; };
  for (const [first, second] of [[4, 2], [-3, -2]]) {
    const slips = [[0, point, first, [0, -1, 0]], [1, [1024, -600, 300], second, [-1, 0, 0]]];
    assert.deepEqual(queuedRows(far, slips), queuedRows(bare, slips), `${first} then ${second} notches`);
  }
  // the Surface panel's Scale queued on both walls before a slip, U twice as large and V half as large (2, 0.5): their V
  // goes 0.6 and 0.84 texel apart along the corner now, 0.3 and 0.42 at the scale built, and U by none. Each axis judged
  // at its own scale built, the walls run on round the corner. (Both judged at U's, or at the scale now, they scaled
  // each round its own point: 52.9 texels apart)
  for (const drift of [0.3, 0.42]) {
    const faces = [north, eastWith(drift)], queue = [{ op: 'scale', args: [2, 0.5], targets: faces.map(({ brush, poly }) => ({ brush, poly })) }];
    const now = faces.map((f) => ({ ...f, mapping: mappingNow(f, queue), built: f.mapping }));
    const r = slipResult(slipScale(startSlip({ faces: now, point, normal: [0, -1, 0] }), -3));
    const moved = seamMoved(now.map((f) => f.mapping), faces.map((f) => mappingNow(f, foldRows(queue, r.rows))), [corner, corner]);
    assert.ok(moved <= 1 + drift / 0.5 / 2 * Math.abs(1 - 1 / r.scale) + 1e-9, `${drift} texel, the panel's Scale 2, 0.5 queued: ${moved} texels`);
  }
  // the same with the walls' axes turned, U up the walls (along their corner), the east wall's U drifting, the panel's
  // Scale (0.5, 2) queued: U half as large, its drift 0.6 and 0.84 now, 0.3 and 0.42 as built. (U judged at V's scale,
  // the walls scaled each round its own point: 52.9 texels apart)
  for (const drift of [0.3, 0.42]) {
    const faces = [{ ...north, mapping: mappingOf([0, 1024, 0, 0, 0, -0.5, -0.5, 0, 0, 0, 0, 128, 128]) },
      { ...wallOf('east'), mapping: mappingOf([1024, 0, 0, 0, 0, -0.5 - drift / 384, 0, 0.5, 0, 0, 0, 128, 128]) }];
    const queue = [{ op: 'scale', args: [0.5, 2], targets: faces.map(({ brush, poly }) => ({ brush, poly })) }];
    const now = faces.map((f) => ({ ...f, mapping: mappingNow(f, queue), built: f.mapping }));
    const r = slipResult(slipScale(startSlip({ faces: now, point, normal: [0, -1, 0] }), -3));
    const moved = seamMoved(now.map((f) => f.mapping), faces.map((f) => mappingNow(f, foldRows(queue, r.rows))), [corner, corner]);
    assert.ok(moved <= 1 + drift / 0.5 / 2 * Math.abs(1 - 1 / r.scale) + 1e-9, `${drift} texel on U, the panel's Scale 0.5, 2 queued: ${moved} texels`);
  }
  // the walls' U 1 texel a unit and V 0.5, the east wall's V drifting 0.3 texel, the panel's Rotate queued on both (U
  // takes V: the drift now on U, along the corner, nothing scaled), then -3 notches: the corner within a texel and its
  // drift's share. (Each axis now paired with the one as built of its name, U read a scale of 2 and V of 0.5: the drift
  // taken as 0.6, each wall round its own point, 44.3 texels apart)
  const turned = [{ ...north, mapping: mappingOf([0, 1024, 0, -1, 0, 0, 0, 0, -0.5, 0, 0, 128, 128]) },
    { ...wallOf('east'), mapping: mappingOf([1024, 0, 0, 0, 1, 0, 0, 0, -0.5 - 0.3 / 384, 0, 0, 128, 128]) }];
  const rotated = [{ op: 'rotate', args: [], targets: turned.map(({ brush, poly }) => ({ brush, poly })) }];
  const turnedNow = turned.map((f) => ({ ...f, mapping: mappingNow(f, rotated), built: f.mapping }));
  const afterTurn = slipResult(slipScale(startSlip({ faces: turnedNow, point, normal: [0, -1, 0] }), -3));
  const turnMoved = seamMoved(turnedNow.map((f) => f.mapping), turned.map((f) => mappingNow(f, foldRows(rotated, afterTurn.rows))), [corner, corner]);
  assert.ok(turnMoved <= 1 + 0.3 / 2 * Math.abs(1 - 1 / afterTurn.scale) + 1e-9, `0.3 texel, the panel's Rotate queued: ${turnMoved} texels`);
  // the same with skewed axes as built: U 4 texels a unit along the walls, V 0.58 leaning toward U, the panel's Rotate
  // queued: the U now (V as built) takes the scale of the axis as built it lies along by direction, 1. (By their dot
  // product the long U as built won: a scale of 6.9, the drift taken as 2, each wall round its own point, 48 texels apart)
  const skewed = [{ ...north, mapping: mappingOf([0, 1024, 0, -4, 0, 0, -0.3, 0, -0.5, 0, 0, 128, 128]) },
    { ...wallOf('east'), mapping: mappingOf([1024, 0, 0, 0, 4, 0, 0, 0.3, -0.5 - 0.3 / 384, 0, 0, 128, 128]) }];
  const skewedNow = skewed.map((f) => ({ ...f, mapping: mappingNow(f, rotated), built: f.mapping }));
  const afterSkew = slipResult(slipScale(startSlip({ faces: skewedNow, point, normal: [0, -1, 0] }), -3));
  const skewMoved = seamMoved(skewedNow.map((f) => f.mapping), skewed.map((f) => mappingNow(f, foldRows(rotated, afterSkew.rows))), [corner, corner]);
  assert.ok(skewMoved <= 1 + 0.3 / 2 * Math.abs(1 - 1 / afterSkew.scale) + 1e-9, `skewed axes, the panel's Rotate queued: ${skewMoved} texels`);
});

test('walls in one plane whose axes are not the same to the dump\'s digits: carried, their seam kept however far the pointer', () => {
  // two walls side by side at x 64 (Brush1, Brush2), the second's U 1.0009 or 1.0004 a unit against 1 (UNATCO HQ's
  // Brush1389 and Brush1548: V 1.99918 against 2, 4.1e-4 apart), the pointer 2000 units from their seam: the texture
  // runs on over it. Taken as the same axes, each kept its own mapping and scaled round its own texel at the pointer's
  // point, and the seam went apart by their difference times that distance: 5.5 texels at -8 notches (U 1.0004 with
  // axes taken as the same within 5e-4: 2.5)
  const A = { id: 'A', brush: 'Brush1', poly: 1, mapping: mappingOf([64, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 128, 128]),
    pieces: [[[64, 0, 0], [64, 0, 128], [64, -2048, 128], [64, -2048, 0]]] };
  const wallB = (u) => ({ id: 'B', brush: 'Brush2', poly: 1, mapping: mappingOf([64, 2048, 0, 0, -u, 0, 0, 0, -1, 37, 0, 128, 128]),
    pieces: [[[64, 2048, 0], [64, 2048, 128], [64, 0, 128], [64, 0, 0]]] });
  const seam = [[64, 0, 0], [64, 0, 128]], start = (B) => startSlip({ faces: [A, B], point: [64, -2000, 64], normal: [-1, 0, 0] });
  for (const u of [1.0009, 1.0004]) {
    const B = wallB(u);
    for (const notches of [-8, -4, -2, 1, 3]) {
      const moved = seamMoved([A.mapping, B.mapping], slipResult(slipScale(start(B), notches)).preview.map((p) => p.mapping), [seam, seam]);
      assert.ok(moved <= 0.5 + 1e-9, `U ${u}, ${notches} notches: ${moved} texels`);
    }
  }
  // U 1.000004 and 1.000001: the same axes within the dump's 6 digits, each wall keeps its own mapping; U 1.00002, past
  // them, is carried. This pins SAME_AXES's definition (the dump's digits), not what shows: the seam is the same either
  // way at these
  for (const u of [1.000004, 1.000001]) nearMapping(start(wallB(u)).carried[1], wallB(u).mapping, 0, `U ${u}`);
  const past = wallB(1.00002);
  assert.notDeepEqual(start(past).carried[1], past.mapping);
});

test('real seams of original maps, their faces as the view has them: each kept within half a texel', () => {
  // NYC Ship Below, Underground, UNATCO HQ and Island, Wan Chai Market (fixtures/texture_slip_real_seams.json): corners
  // the engine left off their plane, nearly parallel planes, floors mirrored or stretched over a seam, two textures in
  // one plane, edges a little apart or skewed. They parted by 5 to 680 texels. Two faces may share several sides the
  // texture runs on over (a board between two pieces of another): of one texture, a side where it shows no step is kept
  // before one where it steps, then the one nearest the pointer (the nearest alone, the boards parted by 5). A BSP piece
  // that lists a corner twice (Island's Brush284 face 164) kept the walk from the side it shares with face 137: with a
  // third face selected, the pointer on it, the two parted by 4 texels
  const middle = (side, on = 0) => times(add(side[on][0], side[on][1]), 0.5);
  for (const c of REAL.cases) {
    const faces = c.faces.map((f, i) => ({ id: i, brush: f.brush, poly: f.poly, tex: f.tex, mapping: mappingOf(f.nums, f.tex), pieces: f.pieces }));
    // a side where the texture steps: of one texture, its two faces more than a texel apart at its middle, whole tiles off
    const steps = (side) => faces[0].tex === faces[1].tex && [0, 1].some((k) =>
      apart(texelOf(faces[0].mapping, middle(side))[k], texelOf(faces[1].mapping, middle(side, 1))[k], faces[0].mapping.tile[k]) > 1);
    for (const ref of c.points.keys()) {
      const point = c.points[ref], away = (side) => Math.hypot(...sub(middle(side), point));
      const kept = c.sides.reduce((x, y) => (steps(x) !== steps(y) ? (steps(x) ? y : x) : away(y) < away(x) ? y : x));
      for (const notches of [1, -3]) {
        const r = slipResult(slipScale(startSlip({ faces, ref, point, normal: piecesNormal(faces[ref].pieces) }), notches));
        const moved = seamMoved(faces.map((f) => f.mapping), r.preview.map((p) => p.mapping), kept);
        assert.ok(moved <= 0.5 + 1e-9, `${c.map} ${c.what}, on face ${ref}, ${notches} notches: ${moved} texels`);
      }
    }
  }
});

test('slips kept one after the other on the same faces: each rounded once, the seam within a texel however many', () => {
  // two walls at a corner (Brush9, 0.6 texel a unit along them, 0.45 down), then the real seams of original maps that
  // share one side: twelve slips kept one after the other, each from the mappings the queue leaves and the exact ones
  // the slip before left (slipResult's preview, as the page gives them again: keepSlip), the
  // pointer on either face in turn. Each slip kept the seam the one before had left, its rounding with it: 1.38 texels
  // at the corner after the twelfth, 2.63 on NYC Ship Below's ledge
  const corner = [[256, 256, 0], [256, 256, 256]];
  const walls = { faces: [{ id: 'N', brush: 'Brush9', poly: 0, mapping: mappingOf([0, 256, 0, 0.6, 0, 0, 0, 0, -0.45, 0, 0, 128, 128]),
    pieces: [[[0, 256, 0], [256, 256, 0], [256, 256, 256], [0, 256, 256]]] },
  { id: 'E', brush: 'Brush9', poly: 1, mapping: mappingOf([256, 256, 0, 0, -0.6, 0, 0, 0, -0.45, 0, 0, 128, 128]),
    pieces: [[[256, 256, 0], [256, 0, 0], [256, 0, 256], [256, 256, 256]]] }], points: [[40, 256, 200], [256, 30, 60]], side: [corner, corner] };
  const real = REAL.cases.filter((c) => c.sides.length === 1).map((c) => ({ points: c.points, side: c.sides[0],
    faces: c.faces.map((f, i) => ({ id: i, brush: f.brush, poly: f.poly, tex: f.tex, mapping: mappingOf(f.nums, f.tex), pieces: f.pieces })) }));
  for (const [what, { faces, points, side }] of [['the corner', walls], ...real.map((c, i) => [`real seam ${i}`, c])]) {
    keepSlips(faces, [1, -3, 2, -1, 3, -2, 1, 1, -3, 2, -2, -1].map((notches, i) => [i % 2, points[i % 2], notches]), (queue, r, i) => {
      const moved = seamMoved(faces.map((f) => f.mapping), faces.map((f) => mappingNow(f, queue)), side);
      assert.ok(moved <= 1 + 1e-9, `${what}, slip ${i + 1}: ${moved} texels`);
    });
  }
});

test('a face set in another slipped again and again, the pointer by each side in turn: it parts where its texture steps, its seamless side kept', () => {
  // Wan Chai Market's boards (fixtures/texture_slip_real_seams.json): Brush1381 face 1 round the board face 5, V mirrored
  // over the seams, seamless at z 16 and 32 texels apart at z 32. UNATCO HQ's strip Brush2032 face 1 (160 x 16, U 2.4
  // texels a unit) set in the wall Brush430 face 3 (U 2, its 9 BSP pieces as the view has them): seamless at x -32 (3
  // whole tiles apart), 64 texels apart at x 128. Slips kept one after the other, the pointer by the stepped side, by the
  // seamless one, by the stepped one: the seamless side within a texel after each. The side nearest the pointer kept, the
  // seamless one parted by 22 and 43.6 texels at the first slip, and the second slip opened the other side too
  const boards = REAL.cases.find((c) => c.what.startsWith('boards in one plane'));
  const board = boards.faces.map((f, i) => ({ id: i, brush: f.brush, poly: f.poly, tex: f.tex, mapping: mappingOf(f.nums, f.tex), pieces: f.pieces }));
  const tex = 'UNATCO.Stone.LowrLevWall_B';
  const wall = { id: 0, brush: 'Brush430', poly: 3, tex, mapping: mappingOf([192, -1168, 0, -2, 0, 0, 0, 0, -2, 0, 0, 128, 256], tex), pieces: [
    [[-62, -1168, 128], [-32, -1168, 128], [-32, -1168, 112], [-32, -1168, 10], [-62, -1168, 10]],
    [[128, -1168, 10], [128, -1168, 112], [128, -1168, 128], [192, -1168, 128], [192, -1168, 10]],
    [[128, -1168, 112], [128, -1168, 10], [6, -1168, 10], [-32, -1168, 10], [-32, -1168, 112]],
    [[6, -1168, 10], [128, -1168, 10], [192, -1168, 10], [192, -1168, -64], [6, -1168, -64]],
    [[-240, -1168, 128], [-240, -1168, 10], [-624, -1168, 10], [-624, -1168, 128]],
    [[-240, -1168, 10], [-240, -1168, -24], [-240, -1168, -64], [-432, -1168, -64], [-624, -1168, -64], [-624, -1168, 10]],
    [[-240, -1168, 128], [-62, -1168, 128], [-62, -1168, 10], [-64, -1168, 10], [-134, -1168, 10], [-240, -1168, 10]],
    [[-240, -1168, -24], [-240, -1168, 10], [-134, -1168, 10], [-134, -1168, -24]],
    [[-240, -1168, -24], [-134, -1168, -24], [-134, -1168, -64], [-240, -1168, -64]]] };
  const strip = { id: 1, brush: 'Brush2032', poly: 1, tex, mapping: mappingOf([-32, -1168, 5.72431e-20, -2.4, 0, 0, 0, 0, -2, 64, 0, 128, 256], tex),
    pieces: [[[-32, -1168, 112], [-32, -1168, 128], [128, -1168, 128], [128, -1168, 112]]] };
  const seamless = [[-32, -1168, 112], [-32, -1168, 128]];
  for (const [what, faces, side, slips] of [
    ['the boards', board, boards.sides.find((s) => s[0][0][2] === 16), [[0, [1104, -385.99, 72], -3], [1, [1104, -385.99, 18], 2], [0, [1104, -385.99, 72], -2]]],
    ['the strip', [wall, strip], [seamless, seamless], [[1, [110, -1168, 120], -3], [1, [-20, -1168, 120], 2], [0, [150, -1168, 60], -2]]]]) {
    keepSlips(faces, slips, (queue, r, i) => {
      const moved = seamMoved(faces.map((f) => f.mapping), faces.map((f) => mappingNow(f, queue)), side);
      assert.ok(moved <= 1 + 1e-9, `${what}, slip ${i + 1}: the seamless side moved ${moved} texels`);
    });
  }
});

test('two textures sharing two sides slipped again, rebuilt, scaled or with the exact mappings lost between: parted where the first parted', () => {
  // UNATCO HQ's hexagon tiles and glass (fixtures/texture_slip_real_seams.json): two faces of two textures in one plane
  // sharing two sides the texture runs on over. -3 notches by the first side, +2 by the second, +1 by the first (the
  // scale back to 1), and +3, -2, -1, kept as the page keeps them: the side the first slip kept stays within a texel at
  // the second, and both are back within a texel at the third (against the mappings the first started from), whatever
  // the page did: nothing, a Rebuild between (the faces built as the queue left them: what the slips kept know of them
  // stays), the Surface panel's Scale 2 on both first (each face round its own base point: both sides step), or the
  // exact mappings lost between (a face's mapping changed otherwise), with a Pan of both pushed too: the side the first
  // slip crossed then reads up to a texel off, short of a step (STEP), and the two slips' rounding adds up (a texel and a
  // half allowed at the end: 1.0003). (Against the mappings as the last Rebuild built them, both sides counted as parted
  // after a Rebuild or with the panel's Scale first, and the one nearest the pointer was kept: 9 to 17 texels off at the
  // end; parted at 0.1 or 0.4 texel off, both counted as parted once the exact mappings were lost: 17 too; counted
  // parted one way only, +3 then -2 left both 9 texels off)
  const pair = REAL.cases.find((c) => c.what.startsWith('faces in one plane, a long seam'));
  const faces = pair.faces.map((f, i) => ({ id: i, brush: f.brush, poly: f.poly, tex: f.tex, mapping: mappingOf(f.nums, f.tex), pieces: f.pieces }));
  assert.notEqual(faces[0].tex, faces[1].tex);
  const lost = (page) => ({ ...page, exacts: null });
  const scaledFirst = [{ op: 'scale', args: [2, 2], targets: faces.map(({ brush, poly }) => ({ brush, poly })) }];
  for (const notches of [[-3, 2, 1], [3, -2, -1]]) {
    const slips = [[0, pair.points[0], notches[0]], [1, pair.points[1], notches[1]], [0, pair.points[0], notches[2]]];
    const lostPanned = (page) => lost(pushed({ op: 'pan', args: [5, -3] })(page));
    for (const [what, options, most = 1] of [['kept', {}], ['a Rebuild between', { between: rebuilt }], ['the panel\'s Scale 2 first', { queue: scaledFirst }],
      ['the exact mappings lost between', { between: lost }, 1.5], ['a Pan of both, the exact mappings lost', { between: lostPanned }, 1.5]]) {
      const moved = [], said = `${what}, ${notches} notches`;
      let start = null;
      keepSlips(faces, slips, (queue, r, i, now, from) => {
        start ||= from;
        moved.push(pair.sides.map((side) => seamMoved(start, now.map((f) => mappingNow(f, queue)), side)));
      }, options);
      const keptSide = moved[0].findIndex((x) => x <= 1 + 1e-9);
      assert.ok(keptSide >= 0 && moved[0][1 - keptSide] > 1, `${said}, slip 1: ${moved[0]}`);
      assert.ok(moved[1][keptSide] <= 1 + 1e-9, `${said}, slip 2: the side the first kept moved ${moved[1][keptSide]} texels`);
      assert.ok(moved[2].every((x) => x <= most + 1e-9), `${said}, slip 3 (the scale back to 1): ${moved[2]}`);
    }
  }
  // a sign of another texture set in a wall (test 30's, U 3 texels a unit, the wall's 1), its edges 0.4 out of its hole
  // as an original map may leave them, the pointer on the sign: -13 notches by its left side, then +2 by its right one:
  // the left side, which the first kept (moved 10.5 texels: its edges apart), moves no more than a texel further; -3 by
  // the left side, +2 by the right, +1 by the left: back within a texel at the end. (Each face's texel taken elsewhere
  // than at the middle of the side on its own edge, the faces swapped, or the change counted one way only: the second
  // slip kept the right side and moved the left 34.6 texels, or left both 63 texels off at the end)
  const sign = { id: 'sign', brush: 'Brush679', poly: 2, tex: 'Pkg.Sign', mapping: mappingOf([128, 0, 16, 3, 0, 0, 0, 0, -1, 0, 0, 128, 128]),
    pieces: [[[128.4, 0, 16], [192.4, 0, 16], [192.4, 0, 144], [128.4, 0, 144]]] };
  const wall = { id: 'wall', brush: 'Brush243', poly: 3, tex: 'Pkg.Concrete', mapping: mappingOf([240, 0, 0, 1, 0, 0, 0, 0, -1, 48, 44, 128, 128]),
    pieces: [[[0, 0, 0], [256, 0, 0], [256, 0, 16], [0, 0, 16]], [[0, 0, 144], [256, 0, 144], [256, 0, 256], [0, 0, 256]],
      [[0, 0, 16], [128, 0, 16], [128, 0, 144], [0, 0, 144]], [[192, 0, 16], [256, 0, 16], [256, 0, 144], [192, 0, 144]]] };
  const signSides = [128, 192].map((x) => [[[x, 0, 16], [x, 0, 144]], [[x, 0, 16], [x, 0, 144]]]), left = [135.4, 0, 80], right = [185.4, 0, 80];
  const signMoved = (slips) => {
    const out = [];
    keepSlips([sign, wall], slips, (queue, r, i, now) => out.push(signSides.map((side) => seamMoved([sign.mapping, wall.mapping], now.map((f) => mappingNow(f, queue)), side))));
    return out;
  };
  const far = signMoved([[0, left, -13], [0, right, 2]]);
  assert.ok(far[0][1] > 1 && far[1][0] <= far[0][0] + 1 + 1e-9, `the sign 0.4 out, -13 then +2: ${far}`);
  const back = signMoved([[0, left, -3], [0, right, 2], [0, left, 1]]);
  assert.ok(back[1][0] <= 1 + 1e-9 && back[2].every((x) => x <= 1 + 1e-9), `the sign 0.4 out, -3, +2, +1: ${back}`);
});

test('the exact mapping a kept slip left a face, again: while its mapping is the one the slip left, by value', () => {
  // a wall slipped a notch with the pointer 7.3 units along it: its mapping as the slip left it and its exact one. Again
  // for its mapping now when that is the one the slip left: as the rows left it, read back from the dump after a Rebuild
  // (6 digits: not the same numbers), with a Pan queued since (whole texels: its exact pan moved as much); none after a
  // Scale (a ten-thousandth), an alignment, another texture, a pan of part of a texel, without a mapping (a refusal,
  // null) or without what the slip left. (Of one face alone it cannot tell a Pan from a slip's own rounding: undone to
  // before a slip that only rolled it, the face is whole texels off that slip's end too; the page asks it of the state
  // the history put in place, see the next test)
  const wall = (pan) => ({ id: 0, brush: 'Brush1', poly: 0, mapping: mappingOf([64, 0, 0, 0, -1, 0, 0, 0, -1, pan, 0, 128, 128]),
    pieces: [[[64, 0, 0], [64, 0, 128], [64, -256, 128], [64, -256, 0]]] });
  const point = [64, -100, 64];
  const kept = (face, notches, drag) => slipResult(slipScale(slipPan(startSlip({ faces: [face], point, normal: [-1, 0, 0] }), add(point, drag)), notches),
    { exact: true }).preview[0];
  const { mapping: left, exact } = kept(wall(0), 1, [0, -7.3, 0]);
  assert.notDeepEqual(exact.pan, left.pan);
  nearMapping(exactAgain(left, exact, left), exact, 0, 'as the rows left it');
  const dumped = mappingOf(numsOf(left).map((x) => Number(x.toPrecision(6))));
  assert.notDeepEqual(dumped.u, left.u);
  const again = exactAgain(left, exact, dumped);
  assert.deepEqual({ ...again, pan: dumped.pan }, dumped, 'read back from the dump: its mapping now');
  nearList(again.pan, exact.pan, 1e-9, 'read back from the dump: the exact pan');
  nearList(exactAgain(left, exact, mappingAfter(left, [{ op: 'pan', args: [5, -3] }])).pan, [exact.pan[0] + 5, exact.pan[1] - 3], 1e-9, 'a Pan since');
  for (const [what, now] of [['a Scale', mappingAfter(left, [{ op: 'scale', args: [1.0001, 1.0001] }])],
    ['an alignment', mappingAfter(left, [{ op: 'wall' }], { normal: [-1, 0, 0], points: wall(0).pieces[0] })],
    ['a pan of part of a texel', { ...left, pan: [left.pan[0] + 0.5, left.pan[1]] }], ['a refusal', { refused: 'no', row: {}, stage: 'save' }],
    ['another texture (its tile)', mappingAfter(left, [{ op: 'texture', args: ['Pkg.Big'] }], { tileOf: () => [256, 256] })],
    ['no mapping', null]]) {
    assert.equal(exactAgain(left, exact, now), null, what);
  }
  assert.equal(exactAgain(null, null, left), null, 'nothing kept');
  assert.equal(exactAgain(left, null, left), null, 'no exact mapping (the plain slip)');
});

test('the exact mappings of the state now: each face the one the slip kept last on it left it, moved by a Pan of it, dropped by any other change to it', () => {
  // the room's four walls (Brush2): -3 notches on the north wall kept (slip 1), +2 on the south one (slip 2), as the
  // page keeps them (keepSlip: exactsKept after each). What exactsNow gives each wall of slip 2's state for its mapping
  // now: the queue made again (an Undo and Redo: the history gives the same exact mappings back) or the map rebuilt
  // (read back from the dump), slip 2's end; after a Pan of the four, of the north wall alone, or each wall its own,
  // each wall's end moved by its own Pan (whole texels: its seams stay where the slip left them); a Scale of the north
  // wall drops its own, the others keep theirs (and a Scale back to where it was is no change by value: its own again,
  // as if both were undone); the north wall only a Rebuild shows: none for it. Slip 1's state (the step an Undo puts
  // back) gives slip 1's ends, moved as much by a Pan; the walls as opened (nothing kept: two Undos), none. (By value
  // from the records of the slips kept, a Pan of one wall alone, or each its own, fit no state of a slip, and every wall
  // started from its rounded pan; a Scale of the north wall alone lost all four)
  const walls = ['north', 'east', 'south', 'west'].map(wallOf), targets = walls.map(({ brush, poly }) => ({ brush, poly }));
  const one = keepSlip({ faces: walls, queue: [], kept: null, exacts: null }, [0, [-500, 1024, 200], -3]);
  const two = keepSlip(one.page, [2, [500, -1024, 200], 2]), { exacts } = two.page;
  const firstEnds = one.r.preview.map((p) => p.exact), ends = two.r.preview.map((p) => p.exact);
  const again = (held, queue, faces = walls) => exactsNow(held, faces.map((f) => ({ ...f, mapping: mappingNow(f, queue) })), queue);
  const row = (op, args, on = targets) => ({ op, args, targets: on });
  const panned = (list, pans) => list.map((m, i) => m && { ...m, pan: [m.pan[0] + pans[i][0], m.pan[1] + pans[i][1]] });
  const same = (got, want, what) => got.forEach((m, i) => {
    if (!want[i]) { assert.equal(m, null, `${what}: the ${walls[i].id} wall`); return; }
    assert.ok(m, `${what}: the ${walls[i].id} wall has no exact mapping`);
    nearMapping(m, want[i], 1e-9, `${what}: the ${walls[i].id} wall`);
  });
  const queue = two.page.queue;
  same(again(exacts, JSON.parse(JSON.stringify(queue))), ends, 'an Undo and Redo');
  same(again(exacts, [...queue, row('pan', [5, -3])]), panned(ends, walls.map(() => [5, -3])), 'a Pan of the four');
  same(again(exacts, [...queue, row('pan', [2, 0], targets.slice(0, 1))]), panned(ends, [[2, 0], [0, 0], [0, 0], [0, 0]]), 'a Pan of the north wall alone');
  same(again(exacts, [...queue, row('pan', [0, 3], targets.slice(0, 1)), row('pan', [1, -1], targets.slice(1))]),
    panned(ends, [[0, 3], [1, -1], [1, -1], [1, -1]]), 'each wall its own Pan');
  const scaled = [...queue, row('scale', [2, 2], targets.slice(0, 1))];
  same(again(exacts, scaled), [null, ...ends.slice(1)], 'a Scale of the north wall');
  same(again(exacts, [...scaled, row('scale', [0.5, 0.5], targets.slice(0, 1))]), ends, 'a Scale of the north wall, then back');
  same(again(exacts, [...queue, { op: 'unknown', targets: targets.slice(0, 1) }]), [null, ...ends.slice(1)], 'the north wall only a Rebuild shows');
  const built = rebuilt(two.page).faces;
  again(exacts, [], built).forEach((m, i) => {
    assert.deepEqual({ ...m, pan: built[i].mapping.pan }, built[i].mapping, `a Rebuild: the ${walls[i].id} wall's mapping now`);
    nearList(m.pan, ends[i].pan, 1e-9, `a Rebuild: the ${walls[i].id} wall's exact pan`);
  });
  same(again(one.page.exacts, one.page.queue), firstEnds, 'an Undo: slip 1\'s state');
  same(again(one.page.exacts, [...one.page.queue, row('pan', [5, -3])]), panned(firstEnds, walls.map(() => [5, -3])), 'an Undo, then a Pan of the four');
  same(again(null, []), [null, null, null, null], 'two Undos: the walls as opened');
  // a state the history holds keeps its own: a slip kept after an Undo (slip 1's state) makes a new one, and slip 2's,
  // which the Redo would have brought back, is as it was; a brush the slip did not touch is shared, not copied
  const other = keepSlip(one.page, [1, [1024, -500, 200], 1]);
  assert.notEqual(other.page.exacts, one.page.exacts);
  same(again(exacts, queue), ends, 'slip 2\'s state after another slip from slip 1\'s');
  same(again(one.page.exacts, one.page.queue), firstEnds, 'slip 1\'s state after another slip from it');
  const apart = exactsKept(new Map([['Brush9', new Map([[0, { left: walls[0].mapping, exact: walls[0].mapping, resets: 0 }]])]]), two.faces, two.r.preview, queue);
  assert.equal(apart.get('Brush9').size, 1);
  assert.equal(exactsKept(apart, two.faces, two.r.preview, queue).get('Brush9'), apart.get('Brush9'), 'a brush the slip did not touch');
  // two slips that bring the walls back to the scale they had (n notches on one wall, then -n on another), both undone:
  // the walls as opened, none; a slip that moves nothing from there queues nothing
  const points = [[-500, 1024, 200], [1024, -500, 200], [500, -1024, 200], [-1024, 500, 200]];
  for (const [a, b, n] of [[0, 1, -1], [0, 2, -1], [1, 3, 1], [2, 0, 2]]) {
    const what = `${walls[a].id} ${n}, ${walls[b].id} ${-n}, two Undos`;
    const first = keepSlip({ faces: walls, queue: [], kept: null, exacts: null }, [a, points[a], n]).page;
    const back = keepSlip(first, [b, points[b], -n]).page;
    assert.deepEqual(keepSlip({ ...back, queue: [], exacts: null }, [a, points[a], 0]).r.rows, [], `${what}, then a slip that moves nothing`);
  }
  // slip 3: the north and east walls alone rolled (no notch: one pan row, U -3 and V +1 on both), kept: those two get
  // its end, the south and west walls keep slip 2's end; undone (slip 2's state), slip 2's ends; after a Pan of the
  // four, slip 3's ends moved as much
  const three = keepSlip({ ...two.page, faces: walls.slice(0, 2) }, [0, [-500, 1024, 200], 0, undefined, [-5.3, 0, 1.7]]);
  assert.deepEqual(three.r.rows, [{ op: 'pan', args: [-3, 1], targets: targets.slice(0, 2) }]);
  const threeEnds = [...three.r.preview.map((p) => p.exact), ends[2], ends[3]];
  same(again(three.page.exacts, three.page.queue), threeEnds, 'slip 3 kept');
  same(again(three.page.exacts, [...three.page.queue, row('pan', [5, -3])]), panned(threeEnds, walls.map(() => [5, -3])), 'a Pan of the four after slip 3');
  same(again(two.page.exacts, two.page.queue), ends, 'slip 3 undone');
  // the plain slip (P: one pan for all) rolling the four after slip 2: its end's exact mappings are its start's moved by
  // its one pan (it did not scale them), slip 2's end moved as much; a notch with one pan for all (scaled) leaves no
  // part of a texel: none kept (see the next test but one)
  const flat = keepSlip(two.page, [1, [1024, -500, 200], 0, undefined, [0, 7.3, 2.2]], true);
  assert.deepEqual(flat.r.rows.map((r) => r.targets.length), [4]);
  same(again(flat.page.exacts, flat.page.queue), panned(ends, walls.map(() => flat.r.pan)), 'the plain slip');
  const plainUp = keepSlip({ faces: walls, queue: [], kept: null, exacts: null }, [0, points[0], 1], true);
  assert.deepEqual(plainUp.r.rows.map((r) => [r.op, r.targets.length]), [['scale', 4], ['pan', 4]]);
  same(again(plainUp.page.exacts, plainUp.page.queue), [null, null, null, null], 'the plain slip, scaled');
  // a face left out (no mapping: only a Rebuild shows it) keeps what it had
  const leftOut = exactsKept(exacts, [{ ...walls[0], mapping: null }], [{ mapping: null, exact: null }], queue);
  assert.equal(leftOut.get('Brush2').get(walls[0].poly), exacts.get('Brush2').get(walls[0].poly));
  // what the slips know of each wall (keptBefore): its mapping before the first slip kept on it and as built then,
  // whatever its mapping now; with nothing kept, its mapping now and as built. A slip kept does not change what was
  // kept before it; a face left out (no mapping) is not in it
  const { kept } = two.page;
  walls.forEach((f, i) => assert.deepEqual(keptBefore(kept, { ...f, mapping: ends[i] }, null), { before: f.mapping, built: f.mapping }, f.id));
  assert.deepEqual(keptBefore(null, { ...walls[0], mapping: ends[0] }, walls[0].mapping), { before: ends[0], built: walls[0].mapping });
  const added = { ...walls[0], poly: 9 };
  const more = keptSlip(kept, [{ ...added, before: added.mapping, built: added.mapping }, two.faces[1]]);
  assert.deepEqual(keptBefore(kept, { ...added, mapping: ends[0] }, null), { before: ends[0], built: null }, 'a face of the same brush kept after');
  // a face it knew keeps its entry, and a slip of faces all known gives back what was known: the Undo history holds a
  // value for each step (copied anew for each slip, 100 slips of one pan for all of 30,000 faces held 260 MB)
  assert.equal(more.known.get('Brush2').get(walls[1].poly), kept.known.get('Brush2').get(walls[1].poly), 'a face it knew');
  assert.deepEqual(keptBefore(more, { ...added, mapping: ends[0] }, null), { before: added.mapping, built: added.mapping });
  assert.equal(keptSlip(kept, two.faces), kept, 'faces all known');
  assert.deepEqual(Object.keys(keptSlip(null, [{ brush: 'Brush5', poly: 0, mapping: null }])), ['known']);
  assert.equal(keptSlip(null, [{ brush: 'Brush5', poly: 0, mapping: null }]).known.size, 0);
});

test('what the slips know of a face after its structure was moved and rebuilt: its mapping before goes with it while its axes point the same way; other BSP pieces change nothing; turned, it is a face no slip kept on', () => {
  // the room's four walls, -3 notches on the north wall kept (the north wall scaled, its base where it was built). The
  // room moved 16 units along x and rebuilt: the host moves each wall's texture base with the brush (UCEngineBridge.cpp
  // surfaceWorld), U and V as they were, and its pieces with it: keptBefore gives the wall's mapping before the slip with
  // the base it has now, and its mapping as built then as it was (its scale). A Rebuild that cut it into other BSP
  // pieces (a door) and moved nothing: the entry as it is (the middle of its pieces moved, its texture did not). Turned
  // 180 degrees (U the other way): as a face no slip kept on, its mapping now and as built now. With a refusal now
  // (startSlip refuses the face): the entry. (Read where it was before the move, the mapping before made each corner
  // whose walls' U or V differ along the move seem parted since, and a ring parted at a second corner; round 14's
  // review, #0. Followed by the middle of its pieces, a door cut by a Rebuild moved it too)
  const walls = ['north', 'east', 'south', 'west'].map(wallOf), north = walls[0];
  const { page } = keepSlip({ faces: walls, queue: [], kept: null, exacts: null }, [0, [-500, 1024, 200], -3]);
  const entry = page.kept.known.get('Brush2').get(north.poly), scaled = mappingNow(north, page.queue);
  assert.notDeepEqual(scaled.u, north.mapping.u, 'the north wall scaled');
  const by = (c) => add(c, [16, 0, 0]), moved = { ...scaled, base: by(scaled.base) }, built = { ...north.mapping, base: by(north.mapping.base) };
  assert.deepEqual(keptBefore(page.kept, { ...north, mapping: moved, pieces: north.pieces.map((piece) => piece.map(by)) }, built),
    { before: { ...north.mapping, base: moved.base }, built: north.mapping }, 'moved and rebuilt');
  const door = [[[1024, 1024, 0], [-672, 1024, 0], [-672, 1024, 384], [1024, 1024, 384]], [[-800, 1024, 0], [-1024, 1024, 0], [-1024, 1024, 384],
    [-800, 1024, 384]], [[-672, 1024, 128], [-800, 1024, 128], [-800, 1024, 384], [-672, 1024, 384]]];
  assert.equal(keptBefore(page.kept, { ...north, mapping: scaled, pieces: door }, north.mapping), entry, 'other BSP pieces');
  const turn = ([x, y, z]) => [-x, -y, z], turned = { ...scaled, base: turn(scaled.base), u: turn(scaled.u), v: turn(scaled.v) };
  assert.deepEqual(keptBefore(page.kept, { ...north, mapping: turned, pieces: north.pieces.map((piece) => piece.map(turn)) }, built),
    { before: turned, built }, 'turned 180 degrees');
  assert.equal(keptBefore(page.kept, { ...north, mapping: { refused: 'no', row: {}, stage: 'save' } }, null), entry, 'a refusal');
});

test('an alignment, One Tile, Around a cylinder (not on a cap), Rotate or a flip queued on a face since a slip kept drops its exact mapping, even where by value it is a Pan; a Pan moves it; an Undo of them, folding and a Rebuild keep it', () => {
  // the room's north and east walls aligned as Wall aligns them (U level, V down, the base where the plane meets the
  // normal through the origin, no pan), a slip kept on both: each rolled 2.49 texels along and 0.13 up (its rows leave
  // them 2 along). Wall on the north wall again takes its pan back to 0 and keeps its base, U and V: by value a Pan of
  // -2 texels of what the slip left, but the slip's fraction is gone (exactsNow counts the rows of those operations on
  // the face: one more than when it was kept), and the east wall keeps its own; so for Floor, One Tile (and U, V) done
  // again where they were done before the slip, two flips, four Rotates (each the mapping as it was by value), and
  // Around a cylinder (its whole brush) on the north wall, a side it wraps, though a Rebuild wrapped it back to the
  // mapping the slip left; not on the room's ceiling, a cap, whose mapping it keeps: its own kept. A Pan of the north
  // wall moves its own as much; a Scale there and back is judged by value (kept, as if both were undone); a Pan folded
  // into the slip's own row moves both; the queue the slip saw given back (an Undo of the Wall) keeps it again; a
  // Rebuild (the queue kept: the build has it; the walls built as it leaves them, read back from the dump) keeps it.
  // (By value alone, a Wall or One Tile on a face aligned so before kept the slip's fraction: the next slip landed a
  // texel away from where the pointer put it, 34 of 69 slips of the ring room; undo_design_result.json, the correctness
  // critique. Counted on the ceiling too, the cylinder dropped a cap's fraction no row changed: round 13's review, #3)
  const NORTH = { brush: 'Brush2', poly: 3 }, EAST = { brush: 'Brush2', poly: 1 }, CEILING = { brush: 'Brush2', poly: 5 };
  const shapes = { 3: { normal: [0, -1, 0], points: [[1024, 1024, 0], [-1024, 1024, 0], [-1024, 1024, 384], [1024, 1024, 384]] },
    1: { normal: [-1, 0, 0], points: [[1024, -1024, 0], [1024, 1024, 0], [1024, 1024, 384], [1024, -1024, 384]] },
    5: { normal: [0, 0, -1], points: [[-1024, -1024, 384], [1024, -1024, 384], [1024, 1024, 384], [-1024, 1024, 384]] } };
  const asBuilt = { 3: mappingOf(ROOM.north.nums), 1: mappingOf(ROOM.east.nums), 5: mappingOf(LAB_ROOM.ceiling.map) };
  const nowOf = (f, rows) => mappingAfter(asBuilt[f.poly], rowsFor(f, rows), shapes[f.poly]);
  // a face as the page gives it (its mapping, and its pieces where the last Rebuild built them: whether Around a
  // cylinder wraps it)
  const faceOf = (f, mapping) => ({ ...f, mapping, pieces: [shapes[f.poly].points] });
  const panned = (m, [x, y]) => ({ ...m, pan: [m.pan[0] + x, m.pan[1] + y] });
  // the queue before the slip (start), then the slip kept on the faces: { table, rows: the queue with its row folded in }
  const slipOn = (start, faces) => {
    const now = faces.map((f) => faceOf(f, nowOf(f, start))), rows = foldRows(start, [{ op: 'pan', args: [2, 0], targets: faces }]);
    return { rows, table: exactsKept(null, now, now.map((f) => ({ mapping: panned(f.mapping, [2, 0]), exact: panned(f.mapping, [2.49, 0.13]) })), rows) };
  };
  const panOf = (m) => m && m.pan.map((x) => Number(x.toFixed(6)));
  const pans = (table, rows, faces = [NORTH, EAST]) => exactsNow(table, faces.map((f) => faceOf(f, nowOf(f, rows))), rows).map(panOf);
  const walled = slipOn([{ op: 'wall', args: [], targets: [NORTH, EAST] }], [NORTH, EAST]);
  assert.deepEqual(pans(walled.table, walled.rows), [[2.49, 0.13], [2.49, 0.13]], 'the state the slip made');
  const wallAgain = [...walled.rows, { op: 'wall', args: [], targets: [NORTH] }];
  assert.deepEqual(nowOf(NORTH, wallAgain).pan, [0, 0]);
  const byValue = (table, rows) => { const { left, exact } = table.get('Brush2').get(3); return exactAgain(left, exact, nowOf(NORTH, rows)); };
  assert.ok(byValue(walled.table, wallAgain), 'Wall again: by value, a Pan');
  assert.deepEqual(pans(walled.table, wallAgain), [null, [2.49, 0.13]], 'Wall on the north wall again');
  // (times 1: done again where it was done before the slip; more: repeated back to the mapping the slip left)
  for (const [op, times] of [['floor', 1], ['tile', 1], ['tile-u', 1], ['tile-v', 1], ['flip-u', 2], ['flip-v', 2], ['rotate', 4]]) {
    const { table, rows } = times === 1 ? slipOn([{ op, args: [], targets: [NORTH, EAST] }], [NORTH, EAST]) : walled;
    const after = [...rows, ...Array.from({ length: times }, () => ({ op, args: [], targets: [NORTH] }))];
    assert.ok(byValue(table, after), `${op} x${times}: by value, a Pan`);
    assert.deepEqual(pans(table, after), [null, [2.49, 0.13]], `${op} x${times} on the north wall`);
  }
  const capped = slipOn([], [CEILING, NORTH]), around = [...capped.rows, { op: 'cylinder', args: [], targets: [{ brush: 'Brush2', poly: '*' }] }];
  assert.deepEqual(nowOf(CEILING, around), nowOf(CEILING, capped.rows), 'Around a cylinder keeps the ceiling\'s mapping');
  assert.equal(nowOf(NORTH, around), null, 'Around a cylinder: the north wall, a side, only a Rebuild shows');
  const wrapped = exactsNow(capped.table, [CEILING, NORTH].map((f) => faceOf(f, nowOf(f, capped.rows))), around);
  assert.deepEqual(wrapped.map(panOf), [[2.49, 0.13], null], 'Around a cylinder: the ceiling keeps its own, the north wall loses its own');
  assert.deepEqual(pans(walled.table, [...walled.rows, { op: 'pan', args: [-3, 1], targets: [NORTH] }]), [[-0.51, 1.13], [2.49, 0.13]], 'a Pan of the north wall');
  const back = [...walled.rows, { op: 'scale', args: [2, 2], targets: [NORTH] }, { op: 'scale', args: [0.5, 0.5], targets: [NORTH] }];
  assert.deepEqual(pans(walled.table, back), [[2.49, 0.13], [2.49, 0.13]], 'a Scale there and back');
  const folded = foldRows(walled.rows, [{ op: 'pan', args: [1, 0], targets: [NORTH, EAST] }]);
  assert.equal(folded.length, walled.rows.length, 'folded into the slip\'s row');
  assert.deepEqual(pans(walled.table, folded), [[3.49, 0.13], [3.49, 0.13]], 'a Pan of both, folded');
  assert.deepEqual(pans(walled.table, JSON.parse(JSON.stringify(walled.rows))), [[2.49, 0.13], [2.49, 0.13]], 'the Wall undone');
  // a Rebuild: each wall built as the queue leaves it (to the dump's 6 digits), the queue kept, nothing pending
  const built = Object.fromEntries([NORTH, EAST].map((f) => [f.poly, mappingOf(numsOf(nowOf(f, walled.rows)).map((x) => Number(x.toPrecision(6))))]));
  const sinceBuilt = (f, rows) => mappingAfter(built[f.poly], rowsFor(f, pendingRows(walled.rows, rows)), shapes[f.poly]);
  const rebuiltPans = (rows) => exactsNow(walled.table, [NORTH, EAST].map((f) => faceOf(f, sinceBuilt(f, rows))), rows).map(panOf);
  assert.deepEqual(rebuiltPans(walled.rows), [[2.49, 0.13], [2.49, 0.13]], 'a Rebuild');
  assert.deepEqual(rebuiltPans(wallAgain), [null, [2.49, 0.13]], 'a Rebuild, then Wall on the north wall again');
});

test('a face whose exact pan is the pan the slip left keeps no exact mapping, and loses the one it had: the next slip starts from its mapping, the same numbers', () => {
  // the room's four walls: one pan for all (P) a notch up from the walls as built leaves no wall a part of a texel (its
  // exact mapping is its mapping): the table keeps none, its brush not even copied. -3 notches on the north wall (each
  // its own pan) keep all four; then one pan for all a notch up again: their exact mappings go from the new table (the
  // one before as it was); one pan for all that only rolls them keeps theirs, moved by its pan. A table that held each
  // wall's mapping as its exact one gives the next slip what none gives: the same rows. (Kept, 100 slips of one pan for
  // all of NYC Ship Below's 30,000 faces held about 1 GB in the Undo history's steps; left out, 5 MB: the coupling
  // critique of undo_design_result.json)
  const walls = ['north', 'east', 'south', 'west'].map(wallOf), points = [[-500, 1024, 200], [1024, -500, 200], [500, -1024, 200], [-1024, 500, 200]];
  const page = { faces: walls, queue: [], kept: null, exacts: null };
  const plainUp = keepSlip(page, [0, points[0], 1], true);
  assert.deepEqual([plainUp.r.rows.length > 0, plainUp.page.exacts.size], [true, 0], 'one pan for all from the walls as built');
  const one = keepSlip(page, [0, points[0], -3]), entries = (table) => table.get('Brush2')?.size ?? 0;
  assert.equal(entries(one.page.exacts), 4);
  const plainAgain = keepSlip(one.page, [0, points[0], 1], true);
  assert.deepEqual([entries(plainAgain.page.exacts), entries(one.page.exacts)], [0, 4], 'one pan for all a notch up: theirs go, from a new table');
  const rolled = keepSlip(one.page, [1, points[1], 0, undefined, [0, 7.3, 2.2]], true);
  assert.equal(entries(rolled.page.exacts), 4, 'one pan for all, a roll');
  // the same rows from a table of whole entries as from none
  const queue = one.page.queue, whole = new Map([['Brush2', new Map(walls.map((f) => {
    const m = mappingNow(f, queue);
    return [f.poly, { left: m, exact: m, resets: 0 }];
  }))]]);
  for (const slip of [[0, points[0], 2], [2, points[2], 0, undefined, [3.3, 0, -1.7]]]) {
    assert.deepEqual(keepSlip({ ...one.page, exacts: whole }, slip).r.rows, keepSlip({ ...one.page, exacts: null }, slip).r.rows, `${slip}`);
  }
});

test('each face\'s exact mapping only when asked for (the slip kept): the same rows and mappings either way', () => {
  // three walls of one texture (Brush1), from bases 40.3 and 90.7 texels apart, dragged 7.3 units and scaled a notch with
  // the pointer on the first. Asked for ({ exact: true }: the page asks when it keeps a slip), each face's exact mapping
  // is its mapping with its pan before the slip, the drag and its own compensation, not rounded, and nothing else; not
  // asked for (each frame the page draws), none. Made for every frame, they slowed a pointer move by 60% (NYC Ship
  // Below's whole map)
  const wall = (poly, y0, pan) => ({ id: poly, brush: 'Brush1', poly, mapping: mappingOf([64, y0, 0, 0, -1, 0, 0, 0, -1, pan, 0, 128, 128]),
    pieces: [[[64, y0, 0], [64, y0, 128], [64, y0 - 256, 128], [64, y0 - 256, 0]]] });
  const faces = [wall(0, 0, 0), wall(1, 1000.3, 40), wall(2, 2000.7, 90)], point = [64, -100, 64];
  const s = slipScale(slipPan(startSlip({ faces, point, normal: [-1, 0, 0] }), add(point, [0, -7.3, 0])), 1);
  const [drawn, kept] = [slipResult(s), slipResult(s, { exact: true })];
  assert.deepEqual(drawn.rows, kept.rows);
  assert.deepEqual(drawn.preview.map((p) => p.mapping), kept.preview.map((p) => p.mapping));
  assert.deepEqual(drawn.preview.map((p) => p.exact), [null, null, null]);
  kept.preview.forEach((p, i) => {
    assert.deepEqual({ ...p.exact, pan: p.mapping.pan }, p.mapping, `face ${i}: its exact mapping but for the pan`);
    nearList(p.exact.pan, [0, 1].map((k) => faces[i].mapping.pan[k] + s.drag[k] + s.comp[i][k]), 1e-9, `face ${i}'s exact pan`);
  });
});

test('a slip kept after the plain one starts from the queued mappings: the plain slip gives no exact mapping', () => {
  // three walls of one texture side by side (Brush1), from bases 40.3 and 90.7 texels apart, one pan for all (P) a
  // notch with the pointer on the first; then the third wall alone a notch, given the plain slip's exact mappings as the
  // page gives them. Each face's own exact pan there, not the one pan the plain slip gave, moved its texture 63 texels
  const wall = (poly, y0, pan) => ({ id: poly, brush: 'Brush1', poly, mapping: mappingOf([64, y0, 0, 0, -1, 0, 0, 0, -1, pan, 0, 128, 128]),
    pieces: [[[64, y0, 0], [64, y0, 128], [64, y0 - 256, 128], [64, y0 - 256, 0]]] });
  const faces = [wall(0, 0, 0), wall(1, 1000.3, 40), wall(2, 2000.7, 90)];
  const plain = slipResult(slipScale(startSlip({ faces, point: [64, -100, 64], normal: [-1, 0, 0] }), 1), { plain: true, exact: true });
  assert.deepEqual([plain.rows.map((row) => row.op), plain.preview.map((p) => p.exact)], [['scale', 'pan'], [null, null, null]]);
  const queue = foldRows([], plain.rows), at = [64, 1900, 64];
  const third = { ...faces[2], mapping: mappingNow(faces[2], queue), exact: plain.preview[2].exact };
  const r = slipResult(slipScale(startSlip({ faces: [third], point: at, normal: [-1, 0, 0] }), 1));
  sameTexel(mappingNow(faces[2], foldRows(queue, r.rows)), at, third.mapping, at, 0.5, 'the third wall under the pointer');
});

test('pans stay within the engine\'s 16 bits: whole repeats taken off only when needed', () => {
  const at = [64, 400, 0], onWall = (faces) => startSlip({ faces, point: at, normal: [1, 0, 0] });
  const wallWith = (pan, tile = [128, 128], id = 'w', brush = 'Brush212') =>
    ({ ...face('wall', id), brush, mapping: { ...face('wall').mapping, pan, tile } });
  // a drag of 100 texels on a 128 texture stays 100 (a wrap to -28 would move a detail texture, or another texture
  // queued later)
  let r = slipResult(slipNudge(onWall([face('wall')]), 100, -300));
  assert.deepEqual(r.rows.map((x) => [x.op, x.args]), [['pan', [100, -300]]]);
  // a face whose pan would pass the bits: whole repeats of its tile taken off, near 0
  r = slipResult(slipNudge(onWall([wallWith([32700, 0])]), 100, 0));
  assert.deepEqual([r.rows[0].args, r.preview[0].mapping.pan], [[100 - 256 * 128, 0], [32, 0]]);
  // the row's own pan within the bits too, though the face's would fit (-30000 + 60000)
  r = slipResult(slipNudge(onWall([wallWith([-30000, 0])]), 60000, 0));
  assert.deepEqual([r.rows[0].args, r.preview[0].mapping.pan], [[60000 - 234 * 128, 0], [48, 0]]);
  // ... and with no whole repeat to take off, no rows but the reason
  r = slipResult(slipNudge(onWall([wallWith([-30000, 0], [13.7913, 128])]), 60000, 0));
  assert.deepEqual([r.rows, r.error], [[], "The pan would go beyond the engine's 32767 texels."]);
  // a face's pan landing on the bits' very end stays: no wrap (32700 + 67 = 32767); a texel more wraps
  r = slipResult(slipNudge(onWall([wallWith([32700, 0])]), 67, 0));
  assert.deepEqual([r.rows.map((x) => x.args), r.preview[0].mapping.pan], [[[67, 0]], [32767, 0]]);
  r = slipResult(slipNudge(onWall([wallWith([32700, 0])]), 68, 0));
  assert.deepEqual([r.rows.map((x) => x.args), r.preview[0].mapping.pan], [[[68 - 256 * 128, 0]], [0, 0]]);
  // three faces of one pan, -32000, -31990 and 32000, nudged 40000: one row, moved to the middle of the room their
  // pans leave it ([-767, 767]: on the middle of their range, not on their mean, which no one wrap fits)
  r = slipResult(slipNudge(onWall([wallWith([-32000, 0], [128, 128], 'a', 'Ba'), wallWith([-31990, 0], [128, 128], 'b', 'Bb'),
    wallWith([32000, 0], [128, 128], 'c', 'Bc')]), 40000, 0));
  assert.deepEqual([r.rows.map((x) => [x.args, x.targets.length]), r.preview.map((p) => p.mapping.pan[0])], [[[[64, 0], 3]], [-31936, -31926, 32064]]);
  // faces of one pan row with pans far apart: the row's pan centres theirs on 0
  r = slipResult(slipNudge(onWall([wallWith([-32000, 0], [128, 128], 'a'), wallWith([32000, 0], [128, 128], 'b', 'Brush300')]), 1000, 0));
  assert.deepEqual([r.rows.length, r.rows[0].args, r.preview.map((p) => p.mapping.pan[0])], [1, [-24, 0], [-32024, 31976]]);
  // faces of one pan at both ends of the bits, their tiles repeating together only every 32640 texels (255 and 128):
  // no one wrap brings both within, so each is wrapped on its own (two rows)
  r = slipResult(slipNudge(onWall([wallWith([-32700, 0], [255, 128], 'a'), wallWith([32700, 0], [128, 128], 'b', 'Brush300')]), 100, 0));
  assert.deepEqual(r.rows.map((x) => [x.args, x.targets.map(keyOf)]), [[[100, 0], ['Brush212|1']], [[100 - 256 * 128, 0], ['Brush300|1']]]);
  // tiles that repeat together only every 65280 texels (255 and 256) still wrap
  r = slipResult(slipNudge(onWall([wallWith([0, 0], [255, 128], 'a'), wallWith([0, 0], [256, 128], 'b', 'Brush300')]), 40000, 0));
  assert.deepEqual([r.error, r.rows.map((x) => x.args)], ['', [[40000 - 65280, 0]]]);
  // two faces whose own pans are a repeat apart (bases 256 units apart, x2), both past the bits: wrapped to one pan,
  // one row
  const pastAt = (id, brush, y) => ({ id, brush, poly: 1, mapping: mappingOf([64, y, 0, 0, -1, 0, 0, 0, -1, 32700, 0, 128, 128]) });
  r = slipResult(slipNudge(slipScale(onWall([pastAt('a', 'Brush1', 400), pastAt('b', 'Brush2', 656)]), 4), 100, 0));
  assert.deepEqual(r.rows.map((x) => [x.op, x.args, x.targets.map(keyOf)]),
    [['scale', [2, 2], ['Brush1|1', 'Brush2|1']], ['pan', [-32668, 0], ['Brush1|1', 'Brush2|1']]]);
  // 64 times smaller round a point 3000 units from the floor's base: a pan of about 190000 texels, wrapped
  const far = [3000, 2500, 0], f = face('floor');
  const s = slipScale(startSlip({ faces: [f], point: far, normal: [0, 0, 1] }), -24);
  r = slipResult(s);
  assert.equal(r.scale, 1 / 64);
  assert.ok(Math.abs(s.comp[0][0]) > PAN_LIMIT);
  assert.ok(r.pan.every((p) => Math.abs(p) <= 64), JSON.stringify(r.pan));
  assert.ok(r.rows.every(valid));
  sameTexel(r.preview[0].mapping, far, f.mapping, far, 0.5);
  // faces with pans far apart: each its own pan, each within the bits, each its texel at the pointer
  const high = { ...face('ceiling'), mapping: { ...face('ceiling').mapping, pan: [32740, -32740] } };
  r = slipResult(slipScale(startSlip({ faces: [f, high], point: far, normal: [0, 0, 1] }), -24));
  assert.equal(r.error, '');
  for (const p of r.preview) assert.ok(p.mapping.pan.every((x) => Math.abs(x) <= PAN_LIMIT), JSON.stringify(p.mapping.pan));
  sameTexel(r.preview[0].mapping, far, f.mapping, far, 0.5);
  sameTexel(r.preview[1].mapping, far, high.mapping, far, 0.5);
  // a tile of 21.3333 (64 at Scale 1/3) at x0.001, 20000 units from its base: about 300000 repeats taken off, and the
  // pointer's texel still where it was (the tile as 64 / 3: no drift)
  const third = { id: 't', brush: 'B', poly: 0, mapping: mappingOf([-15000, 9000, 0, 1, 0, 0, 0, 1, 0, 300, -200, 21.3333, 21.3333]) };
  const there = [5000.37, -11000.81, 0];
  r = slipResult(slipScale(startSlip({ faces: [third], point: there, normal: [0, 0, 1] }), -200));
  assert.equal(r.scale, SCALE_MIN);
  assert.ok(r.rows.every(valid));
  sameTexel(r.preview[0].mapping, there, third.mapping, there, 0.5, 'x0.001');
  // a tile that repeats on no whole texel: no wrap, no rows, the reason
  const odd = { ...f, mapping: { ...f.mapping, tile: [13.7913, 13.7913] } };
  const stuck = slipScale(startSlip({ faces: [odd], point: far, normal: [0, 0, 1] }), -24);
  r = slipResult(stuck);
  assert.deepEqual(r.rows, []);
  assert.match(r.error, /32767/);
  nearMapping(r.preview[0].mapping, odd.mapping, 0);
  assert.match(slipHud(stuck), /32767/);
});

test('the pointer\'s ray meets the face\'s plane; along it or behind, nothing', () => {
  const s = slipOn(face('wall'), LAB.wall.points, [64, 400, 50]);
  nearList(rayPoint(s, [300, 400, 50], [-1, 0.1, 0]), [64, 423.6, 50], 1e-9);
  nearList(rayPoint(s, [300, 400, 50], [-10, 1, 0]), [64, 423.6, 50], 1e-9);
  assert.equal(rayPoint(s, [300, 400, 50], [-0.001, 1, 0]), null);    // in front, along the plane
  assert.equal(rayPoint(s, [300, 400, 50], [-0.1, 10, 0]), null);     // the same, a longer ray
  nearList(rayPoint(s, [300, 400, 50], [-0.03, 1, 0]), [64, 400 + 236 / 0.03, 50], 1e-6);
  assert.equal(rayPoint(s, [300, 400, 50], [1, 0, 0]), null);
  assert.equal(rayPoint(s, [300, 400, 50], [0, 0, 0]), null);
  assert.equal(rayPoint(s, [300, NaN, 50], [-1, 0, 0]), null);
  assert.equal(rayPoint(s, [300, 400, 50]), null);                    // no direction
  // a slope: the point is on its plane
  const slope = slipOn(face('slope'), LAB.slope.points), n = faceNormal(LAB.slope.points);
  const hit = rayPoint(slope, add(LAB.slope.points[0], times(n, 200)), add(times(n, -1), [0.2, -0.1, 0]));
  near(dot(sub(hit, slope.plane.point), slope.plane.normal), 0, 1e-9);
});

test('a slip needs a selected face, known, with a point and a plane; an error stays one', () => {
  const at = [0, 0, 0], up = [0, 0, 1];
  assert.equal(startSlip({ faces: [], point: at, normal: up }).error, 'Select faces first.');     // (the page names its keys)
  assert.match(startSlip().error, /Select faces/);
  assert.match(startSlip({ faces: [face('floor')], ref: 3, point: at, normal: up }).error, /selected faces/);
  assert.match(startSlip({ faces: [face('floor')], ref: 0.5, point: at, normal: up }).error, /selected faces/);
  assert.match(startSlip({ faces: [face('floor')], ref: '0', point: at, normal: up }).error, /selected faces/);
  assert.match(startSlip({ faces: [{ ...face('floor'), mapping: null }], point: at, normal: up }).error, /Rebuild first/);
  for (const point of [undefined, [0, 0], [0, NaN, 0], 'here']) {
    assert.match(startSlip({ faces: [face('floor')], point, normal: up }).error, /No point/, JSON.stringify(point));
  }
  assert.match(startSlip({ faces: [face('floor')], point: at, normal: [0, 0, 0] }).error, /plane/);
  assert.match(startSlip({ faces: [face('floor')], point: at, normal: [0, NaN, 1] }).error, /plane/);
  // a selected face whose queued rows the build refuses: the Rebuild would fail, said before anything slips; or that
  // Save refuses
  const refused = { ...face('wall', 'refused'), mapping: mappingAfter({ ...face('wall').mapping, pan: [32760, 0] }, [{ op: 'pan', args: [10, 0] }]) };
  assert.equal(startSlip({ faces: [face('floor'), refused], point: at, normal: up }).error,
    "The Rebuild would fail on a selected face (Pan exceeds the engine's signed 16-bit range): take that change back first.");
  const unsaved = { ...face('wall', 'unsaved'), mapping: mappingAfter(face('wall').mapping, [{ op: 'pan', args: [0.5, 0] }]) };
  assert.equal(startSlip({ faces: [face('floor'), unsaved], point: at, normal: up }).error,
    'The map could not be saved with a change queued on a selected face (Pan uses whole texels, between -32767 and 32767): take that change back first.');
  const s = startSlip({ faces: [face('floor')], point: at, normal: [0, 0, 3] });
  assert.deepEqual([s.error, s.plane.normal, s.k, s.drag, s.comp], [undefined, [0, 0, 1], 1, [0, 0], [[0, 0]]]);
  // the error used as a session: nothing moves, the result and the HUD say it
  const bad = startSlip({ faces: [], point: at, normal: up });
  for (const same of [slipPan(bad, [1, 1, 0]), slipScale(bad, 1), slipNudge(bad, 1, 1), slipMods(bad, { ctrl: true })]) assert.equal(same, bad);
  assert.deepEqual(slipResult(bad), { rows: [], targets: [], preview: [], left: [], scale: 1, pan: [0, 0], moved: [0, 0], needed: 0,
    added: 0, plain: false, plainFits: false, error: bad.error });
  assert.equal(slipHud(bad), bad.error);
  assert.equal(rayPoint(bad, [0, 0, 1], [0, 0, -1]), null);
  assert.equal(snapStep(bad), null);
  // what is neither: a TypeError that says so
  for (const notOne of [undefined, null, {}, { faces: [] }, 'session']) {
    assert.throws(() => slipResult(notOne), /Texture Slip: not a session/);
    assert.throws(() => slipPan(notOne, at), /Texture Slip: not a session/);
  }
});

test('the HUD: the pan the pointer gave, the scale, the modes held, the faces', () => {
  // on the wall (U along -y, V down) the pointer 12 units along +y and 4 down: Pan U +12, V -4, as the panel's fields
  const at = [64, 400, 0];
  let s = startSlip({ faces: [face('wall')], point: at, normal: [1, 0, 0] });
  s = slipPan(s, add(at, [0, 12, -4]));
  assert.equal(slipHud(s), 'U +12 · V -4 · x1');
  assert.deepEqual(slipResult(s).rows, [{ op: 'pan', args: [12, -4], targets: [{ brush: 'Brush212', poly: 1 }] }]);
  assert.equal(slipHud(slipPan(s, add(at, [0, -12, 4]))), 'U -12 · V +4 · x1');
  // whole texels: a half up, and a millionth short of one too (sums that should give a half come a hair either side)
  const short = startSlip({ faces: [face('wall')], point: at, normal: [1, 0, 0] });
  assert.deepEqual(slipResult(slipPan(short, add(at, [0, 0.4999995, 0]))).pan, [1, 0]);
  assert.deepEqual(slipResult(slipPan(short, add(at, [0, 0.499998, 0]))).pan, [0, 0]);
  // a notch: the scale, the pan the pointer gave stays what the HUD says (the scale's own pan apart)
  assert.equal(slipHud(slipScale(s, 1)), 'U +12 · V -4 · x1.19');
  // Ctrl: on the snap (16 texels of 128)
  assert.equal(slipHud(slipMods(s, { ctrl: true })), 'U +16 · V 0 · x1 · snap');
  assert.equal(slipHud(slipMods(s, { shift: true })), 'U +12 · V -4 · x1 · fine');
  // given the result the page has, the HUD says it as it is (it is not worked out again)
  const r = slipResult(s);
  assert.equal(slipHud(s, r), slipHud(s));
  assert.equal(slipHud(s, { ...r, error: 'Too many.' }), 'U +12 · V -4 · x1 · Too many.');
  assert.equal(slipHud(s, slipResult(s, { plain: true })), 'U +12 · V -4 · x1 · one pan');
  // several faces, the same one twice counted once, one left out
  const two = startSlip({ faces: [face('wall'), face('floor'), face('wall', 'again'), { id: 'x', brush: 'B9', poly: 0, mapping: null }], point: at, normal: [1, 0, 0] });
  assert.equal(slipHud(two), 'U 0 · V 0 · x1 · 2 faces · 1 left out: Rebuild first');
});

test('a face of several BSP pieces: its normal the sum of theirs, unknown when one faces away', () => {
  // a wall of the Tutorial map's room (a subtractive brush, Brush65 face 2) cut in two by a doorway: both pieces face
  // +y, the room's inside; their corners in one list make a polygon facing -y
  const cut = [[[-432, 123, 0], [-432, 123, 128], [-375, 123, 128], [-375, 123, 0]], [[-617, 123, 128], [-560, 123, 128], [-560, 123, 0], [-617, 123, 0]]];
  nearList(faceNormal(cut[0]), [0, 1, 0]);
  nearList(faceNormal(cut[1]), [0, 1, 0]);
  nearList(faceNormal(cut.flat()), [0, -1, 0]);
  nearList(piecesNormal(cut), [0, 1, 0]);
  // the source polygon: the other way on a subtractive brush, as from one polygon
  nearList(sourceNormal(cut, 2), [0, -1, 0]);
  nearList(sourceNormal(cut, 1), [0, 1, 0]);
  nearList(sourceNormal([LAB.roomWall.points], 2), sourceNormal(LAB.roomWall.points, 2));
  nearList(piecesNormal([LAB.slope.points]), faceNormal(LAB.slope.points), 1e-12);
  // pieces of other sizes count by their area: a 10 x 10 floor and a small piece tilted 45 degrees
  const tilted = [[[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], [[0, 0, 0], [2, 0, 0], [0, 1, 1]]];
  nearList(piecesNormal(tilted), unit([0, -2, 202]), 1e-12);
  // a piece facing away from the others (more than a right angle from their sum) makes the face unknown: NYC
  // Underground's Brush72 face 37, one piece on the other side of a brush moved since; a sliver just past standing
  // across the plane; none with any area
  const stale = [[[-4552, 1428, -996], [-4550, 1428, -996], [-4490, 1428, -996], [-4488, 1428, -996], [-4488, 1428, -1004], [-4552, 1428, -1004]],
    [[-4212, 716.009, -996], [-4214, 716.009, -996], [-4274, 716.009, -996], [-4276, 716.009, -996], [-4276, 716.009, -1004], [-4212, 716.009, -1004]]];
  nearList(faceNormal(stale[0]), [0, 1, 0]);
  nearList(faceNormal(stale[1]), [0, -1, 0]);
  assert.equal(piecesNormal(stale), null);
  assert.equal(sourceNormal(stale, 1), null);
  assert.equal(sourceNormal(stale, 2), null);
  const square = tilted[0];
  assert.equal(piecesNormal([square, [[0, 0, 0], [1, 0, 0], [0, -0.01, -1]]]), null);
  nearList(piecesNormal([square, [[0, 0, 0], [1, 0, 0], [0, 0.01, 1]]]), unit([0, -1, 200.01]), 1e-12);
  for (const none of [[], [[[0, 0, 0], [1, 0, 0], [2, 0, 0]]], undefined, 'pieces']) assert.equal(piecesNormal(none), null, JSON.stringify(none));
  // a face unknown so: Floor, Wall and One Tile on it only after a Rebuild; on the cut wall, from its pieces as from
  // one of them
  const m = face('roomWall').mapping;
  for (const op of ['floor', 'wall', 'tile']) assert.equal(mappingAfter(m, [{ op }], { normal: sourceNormal(stale, 1), points: stale.flat() }), null, op);
  nearMapping(mappingAfter(m, [{ op: 'wall' }], { normal: sourceNormal(cut, 2), points: cut.flat() }),
    mappingAfter(m, [{ op: 'wall' }], { normal: sourceNormal(cut[1], 2), points: cut[1] }), 1e-9);
  nearList(mappingAfter(m, [{ op: 'tile' }], { normal: sourceNormal(cut, 2), points: cut.flat() }).u, [-128 / 242, 0, 0], 1e-9);
});

test('a slip queues no more rows than the map has room for, nor than one slip may; a row names 8192 faces at most', () => {
  assert.equal(SLIP_ROWS, ROW_LIMIT / 8);
  // walls of one plane, their bases 3 units apart along U: x2 round a point gives each its own pan (a row each)
  const walls = (n) => Array.from({ length: n }, (_, i) => ({ id: i, brush: `Brush${i}`, poly: 1,
    mapping: mappingOf([64, 400 + 3 * i, 0, 0, -1, 0, 0, 0, -1, 0, 0, 128, 128]) }));
  const at = [64, 350, 30], up = (faces) => slipScale(startSlip({ faces, point: at, normal: [1, 0, 0] }), 4);
  const ten = up(walls(10)), each = slipResult(ten);
  assert.deepEqual([each.rows.length, each.needed, each.error, each.plain, each.plainFits], [11, 11, '', false, false]);
  // the room: what the map can still take (ROW_LIMIT less the rows queued); just enough takes the rows
  assert.deepEqual(slipResult(ten, { room: 11 }), each);
  const instead = 'slip fewer faces at once, or slip them all with one pan (the face under the pointer keeps its place; seams may show between the others)';
  let r = slipResult(ten, { room: 10 });
  assert.deepEqual([r.rows, r.needed, r.plainFits, r.error], [[], 11, true,
    `This slip needs 11 queued surface changes and the map has room for 10 more (4096 at most): ${instead}.`]);
  // nothing slips then: every face as it was, the HUD says why
  r.preview.forEach((p, i) => nearMapping(p.mapping, ten.faces[i].mapping, 0, `face ${i}`));
  assert.equal(slipHud(ten, r), `U 0 · V 0 · x2 · 10 faces · ${r.error}`);
  // no room at all (or less than none); room for one row: not even the plain slip (a scale and a pan)
  for (const room of [0, -5]) {
    assert.equal(slipResult(ten, { room }).error, 'The map already has 4096 queued surface changes, the most it can save: take some back before slipping.');
  }
  r = slipResult(ten, { room: 1 });
  assert.deepEqual([r.rows, r.plainFits, r.error], [[], false,
    'This slip needs 11 queued surface changes and the map has room for 1 more (4096 at most): take some queued changes back first.']);
  assert.match(slipResult(ten, { room: 2, most: 2 }).error, /: slip fewer faces at once, or slip them all with one pan/);
  assert.equal(slipResult(ten, { room: 3, plain: true, most: 1 }).error,
    "This slip needs 2 queued surface changes, more than one slip may add (1 of the map's 4096): slip fewer faces at once.");
  // room not a number: the map's whole room; more than ROW_LIMIT: no more than it (4096 faces of their own pans need
  // 4097 rows); a slip that changes nothing needs none
  assert.deepEqual(slipResult(ten, { room: NaN }), each);
  r = slipResult(up(walls(ROW_LIMIT)), { room: 10 ** 6, most: Infinity });
  assert.deepEqual([r.rows.length, r.needed, r.plainFits], [0, 4097, true]);
  assert.ok(r.error.startsWith('This slip needs 4097 queued surface changes and the map has room for 4096 more'), r.error);
  assert.equal(slipResult(startSlip({ faces: walls(3), point: at, normal: [1, 0, 0] }), { room: -5 }).error, '');
  assert.equal(slipResult(up(walls(600)), { room: 10 ** 6, most: Infinity }).needed, 601);
  assert.ok(slipResult(up(walls(600)), { room: 500, most: Infinity }).error
    .startsWith('This slip needs 601 queued surface changes and the map has room for 500 more (4096 at most)'));
  // one slip's share: more is refused though the map has room
  r = slipResult(ten, { most: 10 });
  assert.deepEqual([r.rows, r.needed, r.plainFits, r.error], [[], 11, true,
    `Keeping each face's texture in place needs 11 queued surface changes, more than one slip may add (10 of the map's 4096): ${instead}.`]);
  assert.equal(slipResult(ten, { most: 1 }).error.endsWith('(1 of the map\'s 4096): slip fewer faces at once.'), true);
  assert.deepEqual(slipResult(ten, { most: NaN }), each);
  // by default SLIP_ROWS: 600 such faces need 601 rows
  const many = up(walls(600));
  r = slipResult(many);
  assert.deepEqual([r.rows.length, r.needed, r.plainFits], [0, 601, true]);
  assert.equal(r.error,
    `Keeping each face's texture in place needs 601 queued surface changes, more than one slip may add (512 of the map's 4096): ${instead}.`);
  assert.equal(slipResult(many, { most: 601 }).rows.length, 601);
  // the plain slip: a scale and one pan for all, the face under the pointer's (it keeps its texel; the others move
  // with it)
  r = slipResult(many, { plain: true });
  assert.deepEqual([r.rows.map((x) => [x.op, x.targets.length]), r.needed, r.plain, r.plainFits, r.error],
    [[['scale', 600], ['pan', 600]], 2, true, false, '']);
  assert.deepEqual(r.rows[1].args, slipResult(many, { most: Infinity }).rows.find((x) => x.op === 'pan' && x.targets.some((t) => t.brush === 'Brush0')).args);
  sameTexel(r.preview[0].mapping, at, many.faces[0].mapping, at, 0.5, 'plain: the face under the pointer');
  r.preview.forEach((p, i) => nearMapping(p.mapping, mappingAfter(many.faces[i].mapping, r.rows), 0, `plain ${i}`));
  assert.equal(slipHud(many, r), 'U 0 · V 0 · x2 · one pan · 600 faces');
  r = slipResult(many, { plain: true, room: 1 });
  assert.deepEqual([r.rows, r.needed, r.plainFits, r.error], [[], 2, false,
    'This slip needs 2 queued surface changes and the map has room for 1 more (4096 at most): take some queued changes back first.']);
  // a drag only: one pan for all however many faces (the plain slip is the same)
  assert.deepEqual(slipResult(slipNudge(startSlip({ faces: walls(600), point: at, normal: [1, 0, 0] }), 3, 0)).rows.map((x) => x.args), [[3, 0]]);
  // more than TARGET_LIMIT faces: rows of 8192 faces at most, each face in one scale row and one pan row
  const crowd = Array.from({ length: TARGET_LIMIT + 3 }, (_, i) => ({ id: i, brush: 'Brush9', poly: i, mapping: face('wall').mapping }));
  r = slipResult(slipNudge(slipScale(startSlip({ faces: crowd, point: at, normal: [1, 0, 0] }), 4), 3, 0));
  assert.deepEqual(r.rows.map((x) => [x.op, x.targets.length]), [['scale', TARGET_LIMIT], ['scale', 3], ['pan', TARGET_LIMIT], ['pan', 3]]);
  assert.ok(r.rows.every((x) => rowProblem(x) === ''));
  assert.equal(queueProblem(r.rows), '');
  const named = new Map();
  for (const x of r.rows) for (const t of x.targets) named.set(`${x.op} ${t.poly}`, (named.get(`${x.op} ${t.poly}`) || 0) + 1);
  assert.deepEqual([named.size, Math.max(...named.values())], [2 * crowd.length, 1]);
  nearMapping(r.preview[TARGET_LIMIT + 2].mapping, r.preview[0].mapping, 0);
  nearMapping(r.preview[0].mapping, mappingAfter(face('wall').mapping, [r.rows[0], r.rows[2]]), 0);
});

test('many faces: rows indexed once give each face its rows as the list does, without going through them all', () => {
  // rows of every kind of target: a face, a whole brush, two brushes, a brush and its face, a face twice, others named
  // otherwise (a polygon number as text, a brush as a number), rows with no targets
  const rows = [
    { op: 'pan', args: [8, 0], targets: [{ brush: 'Brush2', poly: 4 }] },
    { op: 'scale', args: [2, 2], targets: [{ brush: 'Brush2', poly: '*' }] },
    { op: 'pan', args: [0, 8], targets: [{ brush: 'Brush212', poly: 1 }, { brush: 'Brush41', poly: 0 }] },
    { op: 'pan', args: [5, 0], targets: [{ brush: 'Brush2', poly: '*' }, { brush: 'Brush2', poly: 4 }] },
    { op: 'scale', args: [2, 2], targets: [{ brush: 'Brush2', poly: 5 }, { brush: 'Brush2', poly: 5 }] },
    { op: 'rotate', args: [], targets: [{ brush: 'Brush2', poly: '4' }, { brush: 2, poly: 4 }, null] },
    { op: 'flip-u', args: [], targets: null }, null, { op: 'pan', args: [1, 1], targets: { brush: 'Brush2', poly: 4 } },
    { op: 'flip-v', args: [], targets: [{ brush: 'Brush2', poly: 4 }, { brush: 'Brush2', poly: '*' }] },
  ];
  const index = indexRows(rows), list = (f) => rows.flatMap((r) => (Array.isArray(r?.targets) ? r.targets : [])
    .filter((t) => t && t.brush === f.brush && (t.poly === '*' || t.poly === f.poly)).map(() => r));
  const faces = [face('floor'), face('roomWall'), face('wall'), face('ceiling'), face('slope'), DOOR, { id: 'x', brush: 'Brush3', poly: 4, mapping: null }];
  for (const f of faces) {
    assert.deepEqual(rowsFor(f, index), list(f), f.id);
    assert.deepEqual(rowsFor(f, rows), list(f), f.id);
    assert.deepEqual(mappingNow(f, index), mappingNow(f, rows), f.id);
  }
  assert.deepEqual(rowsFor(face('floor'), index), [rows[0], rows[1], rows[3], rows[3], rows[9], rows[9]]);
  assert.deepEqual(rowsFor(face('ceiling'), index), [rows[1], rows[3], rows[4], rows[4], rows[9]]);
  assert.deepEqual([rowsFor(face('floor'), indexRows([])), rowsFor(face('floor'), indexRows()), rowsFor(face('floor'), undefined)], [[], [], []]);
  // a face's rows from the index: only its own read, however many faces ask
  let reads = 0;
  const counted = indexRows(new Proxy(rows, { get: (o, k) => { if (typeof k === 'string' && /^\d+$/.test(k)) reads++; return o[k]; } }));
  reads = 0;
  for (let i = 0; i < 50; i++) mappingNow(face('floor'), counted);
  assert.equal(reads, 50 * 6);
  // a slip of 4000 faces, each its own pan row: the preview quick (each face's rows found once, not by going through
  // the 4001 rows for each face: seconds)
  const walls = Array.from({ length: 4000 }, (_, i) => ({ id: i, brush: `Brush${i}`, poly: 1,
    mapping: mappingOf([64, 400 + 3 * i, 0, 0, -1, 0, 0, 0, -1, 0, 0, 128, 128]) }));
  const s = slipScale(startSlip({ faces: walls, point: [64, 350, 30], normal: [1, 0, 0] }), 4);
  const t0 = performance.now(), r = slipResult(s, { most: Infinity }), took = performance.now() - t0;
  assert.equal(r.rows.length, 4001);
  assert.ok(took < 500, `slipResult took ${Math.round(took)} ms on 4000 faces`);
  for (const k of [0, 1234, 3999]) nearMapping(r.preview[k].mapping, mappingAfter(walls[k].mapping, rowsFor(walls[k], r.rows)), 0, `face ${k}`);
  // the faces of a whole big map (30000: NYC Ship Below has 30,584) slipped with one pan: rows of 8192 faces, as quick
  // (each face's rows found once, not by going through every row's faces for each face: seconds)
  const all = Array.from({ length: 30000 }, (_, i) => ({ id: i, brush: `Brush${i >> 12}`, poly: i & 4095, mapping: face('wall').mapping }));
  const t1 = performance.now();
  const big = slipResult(slipNudge(slipScale(startSlip({ faces: all, point: [64, 350, 30], normal: [1, 0, 0] }), 4), 3, 0));
  const tookAll = performance.now() - t1;
  assert.deepEqual(big.rows.map((x) => [x.op, x.targets.length]), [['scale', 8192], ['scale', 8192], ['scale', 8192], ['scale', 5424],
    ['pan', 8192], ['pan', 8192], ['pan', 8192], ['pan', 5424]]);
  assert.ok(tookAll < 1000, `slipResult took ${Math.round(tookAll)} ms on 30000 faces`);
  nearMapping(big.preview[29999].mapping, mappingAfter(face('wall').mapping, [big.rows[3], big.rows[7]]), 0);
});

// ---------------------------------------------------------------- the last edge cases

test('corners on a line make no plane: Floor and Wall wait for a Rebuild; a sliver beside good pieces faces no way', () => {
  const line = [[64, 0, 0], [64, 100, 0], [64, 200, 0]];
  assert.equal(sourceNormal(line, 1), null);
  assert.equal(sourceNormal(line, 2), null);
  assert.equal(sourceNormal([line], 1), null);
  assert.equal(mappingAfter(face('wall').mapping, [{ op: 'wall' }], { normal: sourceNormal(line, 1), points: line }), null);
  // a piece of no area next to good ones: the face stays known, with their normal
  const good = LAB.roomWall.points;
  nearList(piecesNormal([good, line]), faceNormal(good));
  nearList(sourceNormal([[[64, 1024, 0], [64, 1024, 0], [500, 1024, 9]], good], 2), faceNormal(good).map((c) => -c));
});

test('the plain slip, scaled by a fraction: every pan row whole texels', () => {
  const faces = [face('wall'), DOOR, face('floor'), BIG, THIRD, face('slope')];
  const points = LAB.wall.points, p0 = pointOn(points, 0.6, 0.2);
  const s = slipScale(slipPan(slipOn(faces[0], points, p0, faces, 0), add(p0, step(points, 13.37, -7.71))), 1);
  assert.equal(s.k, 1.18921);
  for (const plain of [true, false]) {
    const pans = slipResult(s, { plain }).rows.filter((row) => row.op === 'pan');
    assert.ok(pans.length >= 1);
    for (const row of pans) {
      assert.ok(row.args.every(Number.isInteger), `${plain ? 'plain' : 'each its own'}: ${row.args}`);
      assert.equal(rowProblem(row), '');
    }
  }
});

test('a row pan exactly on the 16 bits stays as it is', () => {
  for (const [pan, nudge] of [[-5, PAN_LIMIT], [5, -PAN_LIMIT], [0, PAN_LIMIT]]) {
    const f = { ...face('wall'), mapping: mappingOf([...LAB.wall.nums.slice(0, 9), pan, 0, 128, 128]) };
    const r = slipResult(slipNudge(slipOn(f, LAB.wall.points), nudge, 0));
    assert.deepEqual(r.rows, [{ op: 'pan', args: [nudge, 0], targets: [{ brush: f.brush, poly: f.poly }] }], `${pan} + ${nudge}`);
    assert.equal(r.preview[0].mapping.pan[0], pan + nudge);
  }
});

// ---------------------------------------------------------------- the map's room

test('slips folded into the pan and scale rows before them: fewer rows, each face as the rows unfolded leave it', () => {
  const faces = [face('wall'), DOOR, face('floor'), face('ceiling'), BIG, THIRD, face('slope'), face('roomWall'), TURNED, MIRRORED];
  const points = LAB.wall.points, p0 = pointOn(points, 0.6, 0.2);
  // rows before them that the fold keeps as they are: a turn, then a pan of a whole brush
  const before = [{ op: 'rotate', args: [], targets: [{ brush: 'Brush2', poly: 4 }] },
    { op: 'pan', args: [3, 0], targets: [{ brush: 'Brush2', poly: '*' }] }];
  let unfolded = [...before], folded = [...before];
  for (const [notches, x, y, mods] of [[1, 20.5, -3.25], [-3, -7, 11], [2, 0.5, 0.5, { ctrl: true }], [-1, 13, 13], [5, -40, 2], [-4, 9, 0]]) {
    const now = faces.map((f) => ({ ...f, mapping: mappingNow(f, unfolded) }));
    const rows = slipResult(slipScale(slipPan(slipOn(now[0], points, p0, now, 0), add(p0, step(points, x, y))), notches, mods)).rows;
    assert.ok(rows.length >= 2);
    unfolded = [...unfolded, ...rows];
    const queue = folded;
    folded = foldRows(queue, rows);
    assert.notEqual(folded, queue);
  }
  assert.deepEqual(folded.slice(0, 2), before);
  assert.ok(folded.length < unfolded.length / 3, `${folded.length} rows folded, ${unfolded.length} unfolded`);
  assert.equal(queueProblem(folded), '');
  assert.equal(folded.filter((row) => row.op === 'scale').length, 1);       // every face scaled alike: one row
  // every face as the host leaves it after the rows unfolded: the same pan, the same axes to the last digits
  for (const f of faces) {
    const a = mappingNow(f, unfolded), b = mappingNow(f, folded);
    assert.deepEqual(b.pan, a.pan, f.id);
    nearList(numsOf(b), numsOf(a), 1e-12, f.id);
    nearList(numsOf(b), rowsFor(f, folded.slice(before.length)).reduce(host, numsOf(mappingNow(f, before))), 1e-12, `${f.id} (the host's way)`);
  }
});

test('the fold: only when it takes fewer rows that surfaces.py takes; the rest as they are', () => {
  const A = { brush: 'Brush1', poly: 0 }, B = { brush: 'Brush1', poly: 1 }, C = { brush: 'Brush2', poly: 0 };
  const pan = (args, targets) => ({ op: 'pan', args, targets }), scale = (args, targets) => ({ op: 'scale', args, targets });
  // the same faces panned twice: one row; panned back where they were: none left
  assert.deepEqual(foldRows([pan([4, 0], [A, B])], [pan([3, -2], [A, B])]), [pan([7, -2], [A, B])]);
  assert.deepEqual(foldRows([pan([4, 0], [A])], [pan([-4, 0], [A])]), []);
  // a scale and its pans with the next slip's: one scale (the factors multiplied), a pan per face's sum
  assert.deepEqual(foldRows([scale([2, 2], [A, B]), pan([1, 0], [A]), pan([2, 0], [B])], [scale([0.5, 2], [A, B]), pan([1, 0], [B])]),
    [scale([1, 4], [A, B]), pan([1, 0], [A]), pan([3, 0], [B])]);
  // a face a row names twice is edited twice
  assert.deepEqual(foldRows([pan([1, 1], [A, A])], [pan([1, 0], [A])]), [pan([3, 2], [A])]);
  // no fewer rows: added as they are (sums of overlapping groups make as many rows)
  const q = [pan([1, 0], [A, B])], rows = [pan([1, 0], [B, C])];
  assert.deepEqual(foldRows(q, rows), [...q, ...rows]);
  // a factor beyond what surfaces.py takes, or a pan beyond the 16 bits: added as they are
  assert.deepEqual(foldRows([scale([0.002, 1], [A])], [scale([0.4, 1], [A])]), [scale([0.002, 1], [A]), scale([0.4, 1], [A])]);
  assert.deepEqual(foldRows([pan([30000, 0], [A])], [pan([30000, 0], [A])]), [pan([30000, 0], [A]), pan([30000, 0], [A])]);
  // rows before a turn, a texture, a whole brush's row are kept; nothing added, the queue as it is (a copy)
  const turned = [pan([1, 0], [A]), { op: 'rotate', args: [], targets: [A] }];
  assert.deepEqual(foldRows(turned, [pan([1, 0], [A])]), [...turned, pan([1, 0], [A])]);
  const whole = [pan([1, 0], [A]), pan([1, 0], [{ brush: 'Brush1', poly: '*' }])];
  assert.deepEqual(foldRows(whole, [pan([2, 0], [A]), pan([5, 0], [A])]), [...whole, pan([7, 0], [A])]);
  const queue = [pan([1, 0], [A])];
  assert.deepEqual(foldRows(queue, []), queue);
  assert.notEqual(foldRows(queue, []), queue);
  assert.deepEqual(queue, [pan([1, 0], [A])]);
  // more faces than a row may name: rows of 8192
  const crowd = Array.from({ length: TARGET_LIMIT + 5 }, (_, i) => ({ brush: 'Brush7', poly: i % 65536 }));
  assert.deepEqual(foldRows([pan([1, 0], crowd), pan([1, 0], crowd)], [pan([1, 0], crowd)]).map((row) => [row.args, row.targets.length]),
    [[[3, 0], TARGET_LIMIT], [[3, 0], 5]]);
  assert.deepEqual(splitTargets(crowd).map((part) => part.length), [TARGET_LIMIT, 5]);
});

test('the room left: said in the HUD and the status below 1024 rows, as the log line', () => {
  assert.equal(ROOM_WARN, 1024);
  assert.equal(roomNote(1024), '');
  assert.equal(roomNote(1023), 'room for 1023 more queued surface changes (of 4096)');
  assert.equal(roomNote(1), 'room for 1 more queued surface change (of 4096)');
  assert.equal(roomNote(-3), 'room for 0 more queued surface changes (of 4096)');
  const at = [64, 400, 0], s = slipPan(startSlip({ faces: [face('wall')], point: at, normal: [1, 0, 0] }), add(at, [0, 12, -4]));
  const r = slipResult(s);
  assert.equal(slipHud(s, r, ROW_LIMIT), 'U +12 · V -4 · x1');
  assert.equal(slipHud(s, r, 1025), 'U +12 · V -4 · x1');                      // 1024 left after its row: plenty
  assert.equal(slipHud(s, r, 1024), 'U +12 · V -4 · x1 · room for 1023 more queued surface changes (of 4096)');
  assert.equal(slipHud(s, r, 101), 'U +12 · V -4 · x1 · room for 100 more queued surface changes (of 4096)');
  assert.equal(slipHud(s, r), 'U +12 · V -4 · x1');
  // the log: the factor, the pan of the face under the pointer, the faces, the plain slip, those left out
  assert.equal(slipSummary(r), 'Texture slip: x1, pan U +12 V -4 on 1 face. Rebuild to apply and recalculate lighting.');
  const many = startSlip({ faces: [face('wall'), face('floor'), { id: 'x', brush: 'B9', poly: 0, mapping: null }], point: at, normal: [1, 0, 0] });
  assert.equal(slipSummary(slipResult(slipScale(slipNudge(many, -3, 2), 1), { plain: true })),
    'Texture slip: x1.19, pan U -3 V +2 on 2 faces, one pan, 1 left out (only a Rebuild shows it). Rebuild to apply and recalculate lighting.');
});

test('the room counts what a slip adds after the fold: the same faces slipped again on a full queue take no more', () => {
  // the review's case: 300 walls, each its own pan, made twice as large (301 rows) at the end of a queue of 4086 rows
  // (room for 10), then 4096 (none); the same faces slipped back one notch: their rows folded into those before them
  const walls = (queue) => {
    const index = indexRows(queue);
    return Array.from({ length: 300 }, (_, i) => {
      const f = { id: i, brush: `Brush${i}`, poly: 1, mapping: mappingOf([64, 400 + 3 * i, 0, 0, -1, 0, 0, 0, -1, 0, 0, 128, 128]) };
      return { ...f, mapping: mappingNow(f, index) };
    });
  };
  const at = [64, 350, 30], slip = (faces, notches) => slipScale(startSlip({ faces, point: at, normal: [1, 0, 0] }), notches);
  const first = slipResult(slip(walls([]), 4)).rows;
  assert.equal(first.length, 301);
  const shadows = (n) => Array.from({ length: n }, (_, i) => ({ op: 'shadows', args: ['low'], targets: [{ brush: 'Brush999', poly: i }] }));
  for (const queue of [[...shadows(ROW_LIMIT - 10 - first.length), ...first], [...shadows(ROW_LIMIT - first.length), ...first]]) {
    const room = ROW_LIMIT - queue.length, back = slip(walls(queue), -1), r = slipResult(back, { room, queue });
    assert.deepEqual([r.error, r.rows.length], ['', r.needed], `room ${room}`);
    assert.ok(r.needed > 10, `${r.needed} rows`);                      // more than the room left
    // counted unfolded, it would not fit
    assert.ok(slipResult(back, { room }).error.startsWith(room ? `This slip needs ${r.needed} queued surface changes and the map has room for 10 more`
      : 'The map already has 4096'), `room ${room}`);
    const after = foldRows(queue, r.rows);
    assert.ok(r.added <= 0 && after.length === queue.length + r.added, `room ${room}: ${r.added} rows added`);
    assert.equal(queueProblem(after), '');
    // the HUD says the room after it
    assert.ok(slipHud(back, r, room).endsWith(` · room for ${room - r.added} more queued surface changes (of 4096)`), slipHud(back, r, room));
    // one slip's share stays on its rows unfolded
    assert.ok(slipResult(back, { room, queue, most: r.needed - 1 }).error
      .startsWith(`Keeping each face's texture in place needs ${r.needed} queued surface changes, more than one slip may add (${r.needed - 1} of`));
  }
  // rows that do not fold (other faces, another size) still need their room
  const others = walls([]).map((f) => ({ ...f, brush: `Other${f.id}` })), full = [...shadows(ROW_LIMIT - 10 - first.length), ...first];
  assert.match(slipResult(slip(others, 2), { room: 10, queue: full }).error, /^This slip needs \d+ queued surface changes and the map has room for 10 more/);
  // worked out only when the room is short or would be left under ROOM_WARN: with plenty, the queue is not read
  let reads = 0;
  const watched = new Proxy(full, { get: (o, k) => { reads++; return o[k]; } });
  const small = slip(walls([]).slice(0, 3), 4);
  assert.equal(slipResult(small, { room: ROOM_WARN + 4, queue: watched }).added, 4);
  assert.equal(reads, 0);
  slipResult(small, { room: ROOM_WARN + 3, queue: watched });
  assert.ok(reads > 0);
});

test('faces grouped by a pair of values, compared by value: each pair once, in the order first seen; rows of 8192 faces', () => {
  const items = [[1, 2], [3, 4], [1, 2], ['Brush2', 4], ['Brush2', '4'], [0, -0], [-0, 0], null, [1, 3], [3, 4]].map((pair, i) => ({ pair, i }));
  assert.deepEqual(groupBy(items, (x) => x.pair).map(({ key, items: them }) => [key, them.map((x) => x.i)]),
    [[[1, 2], [0, 2]], [[3, 4], [1, 9]], [['Brush2', 4], [3]], [['Brush2', '4'], [4]], [[0, -0], [5, 6]], [[1, 3], [8]]]);
  assert.deepEqual(groupBy([], (x) => x), []);
  // the fold and the slip group with it: faces by brush and polygon, rows by their arguments, each group's faces in rows
  // of TARGET_LIMIT (the pans of two groups past it: first seen first)
  const crowd = (brush, n) => Array.from({ length: n }, (_, i) => ({ brush, poly: i }));
  const pan = (args, targets) => ({ op: 'pan', args, targets });
  const pans = (args, faces) => splitTargets(faces).map((targets) => pan(args, targets));
  assert.deepEqual(foldRows(pans([2, 0], crowd('B', TARGET_LIMIT + 1)), [...pans([1, 0], crowd('A', TARGET_LIMIT + 2)), ...pans([1, 0], crowd('B', TARGET_LIMIT + 1))])
    .map((row) => [row.args, row.targets.length, row.targets[0].brush]), [[[3, 0], TARGET_LIMIT, 'B'], [[3, 0], 1, 'B'], [[1, 0], TARGET_LIMIT, 'A'], [[1, 0], 2, 'A']]);
});

// ---------------------------------------------------------------- the pointer and the keys

test('the arrows move the picture on the screen that way, along the texture axis nearest it', () => {
  // the wall facing +x seen from in front: the view's right is -y, its up +z; U runs along -y, V down. The room's wall
  // (texture twice as large: a texel 2 units) seen with x to the right
  const right = [0, -1, 0], up = [0, 0, 1], at = [64, 400, 30];
  for (const [f, normal, side, scale, point] of [[face('wall'), [1, 0, 0], right, 1, at], [face('roomWall'), [0, 1, 0], [1, 0, 0], 0.5, [300, 1024, 100]]]) {
    const s = startSlip({ faces: [f], point, normal });
    for (const [key, way] of [['ArrowRight', side], ['ArrowLeft', times(side, -1)], ['ArrowUp', up], ['ArrowDown', times(up, -1)]]) {
      const [du, dv] = arrowNudge(s, key, side, up), after = slipResult(slipNudge(s, du, dv)).preview[0].mapping;
      // what showed at the point now shows one texel along the screen's way
      nearList(texelOf(after, add(point, times(way, 1 / scale))), texelOf(f.mapping, point), 1e-9, `${f.id} ${key}`);
    }
  }
  // a turned mapping: Right moves it along V; a slope seen from above: the nearest axis on its plane
  assert.deepEqual(arrowNudge(startSlip({ faces: [TURNED], point: at, normal: [1, 0, 0] }), 'ArrowRight', right, up), [0, 1]);
  // a U leaving the plane: what counts is how it lies on the face (along the screen's right, though mostly out of it)
  const leaving = { ...face('wall', 'leaving'), mapping: mappingOf([64, 400, 0, 0.99, -0.14, 0, 0, -0.5, -1, 0, 0, 128, 128]) };
  assert.deepEqual(arrowNudge(startSlip({ faces: [leaving], point: at, normal: [1, 0, 0] }), 'ArrowRight', right, up), [-1, 0]);
  const slope = startSlip({ faces: [face('slope')], point: LAB.slope.points[0], normal: faceNormal(LAB.slope.points) });
  const nudge = arrowNudge(slope, 'ArrowUp', [1, 0, 0], [0, 1, 0]);
  assert.equal(nudge.filter((x) => x).length, 1);
  // another key, a view along the plane, no session: none
  const s = startSlip({ faces: [face('wall')], point: at, normal: [1, 0, 0] });
  assert.equal(arrowNudge(s, 'Enter', right, up), null);
  assert.equal(arrowNudge(s, 'ArrowUp', [1, 0, 0], [1, 0, 0]), null);
  assert.equal(arrowNudge(startSlip({ faces: [] }), 'ArrowUp', right, up), null);
  assert.throws(() => arrowNudge(null, 'ArrowUp', right, up), /not a session/);
});

test('wheel notches: a mouse wheel one a turn, up larger, its notch learnt; merged steps several; a trackpad in parts; Shift sideways', () => {
  // a page's events one after another, the notch learnt from them (the smallest step of 50 or more after a pause: Linux
  // 53, Windows 100, a screen scaled up 125). A step: its deltaY, after a pause of 400 ms; or { deltaY, quiet: the
  // milliseconds since the event before, ctrlKey }
  const turns = (steps) => {
    let notch = null;
    return steps.map((step) => {
      const { quiet = 400, ...e } = typeof step === 'number' ? { deltaY: step } : step;
      notch = learnNotch(notch, e, quiet);
      return wheelNotches(e, notch);
    });
  };
  assert.deepEqual(turns([-100, 120, 53]), [1, -1, -1]);
  assert.deepEqual(turns([53, 106]), [-1, -2]);
  assert.deepEqual(turns([-100, -300]), [1, 3]);
  assert.deepEqual(turns([125, 250, -125]), [-1, -2, 1]);
  assert.deepEqual(turns([-120, -53]), [1, 1]);
  assert.deepEqual(turns([{ deltaY: -100, quiet: Infinity }, -300]), [1, 3]);          // the very first event
  assert.deepEqual(turns([-30, -12, -100]), [0.3, 0.12, 1]);           // a trackpad's parts do not teach it
  // nor a swipe's or a pinch's (Ctrl) larger steps, close together: a mouse's notch after them is still one
  assert.deepEqual(turns([{ deltaY: -57, quiet: 8 }, -100]), [0.57, 1]);
  assert.deepEqual(turns([-100, { deltaY: -57, quiet: 8 }, -100]), [1, 0.57, 1]);
  assert.deepEqual(turns([{ deltaY: -12, quiet: Infinity }, { deltaY: -31, quiet: 16 }, { deltaY: -57, quiet: 16 }, -100]), [0.12, 0.31, 0.57, 1]);
  assert.deepEqual(turns([{ deltaY: -64, ctrlKey: true, quiet: 8 }, -100]), [0.64, 1]);
  // a mouse's notch with Ctrl held (Ctrl snaps the size), after a pause: it teaches it (53 a notch: one each)
  assert.deepEqual(turns([{ deltaY: -53, ctrlKey: true, quiet: Infinity }, { deltaY: -53, ctrlKey: true }]), [1, 1]);
  assert.equal(learnNotch(null, { deltaY: -3, deltaMode: 1 }, 400), null);
  assert.equal(learnNotch(80, { deltaY: NaN }, 400), 80);
  assert.equal(learnNotch(null, { deltaY: -53 }), null);                // no pause known: nothing learnt
  assert.equal(learnNotch(null, { deltaY: -53 }, Infinity), 53);
  assert.equal(wheelNotches({ deltaY: -100 }), 1);                      // none learnt: 100 pixels
  assert.equal(wheelNotches({ deltaY: -53 }, 53), 1);
  assert.equal(wheelNotches({ deltaY: -3, deltaMode: 1 }), 1);
  assert.equal(wheelNotches({ deltaY: 9, deltaMode: 1 }), -3);           // three notches merged, in lines
  assert.equal(wheelNotches({ deltaY: 1, deltaMode: 2 }), -1);
  assert.equal(wheelNotches({ deltaY: -12 }), 0.12);
  assert.equal(wheelNotches({ deltaY: 4.5 }), -0.045);
  assert.equal(wheelNotches({ deltaX: 100, shiftKey: true }), -1);
  assert.equal(wheelNotches({ deltaX: 100 }), 0);
  assert.equal(wheelNotches({ deltaY: NaN }), 0);
  assert.equal(wheelNotches(), 0);
  // four notches up: twice as large; Ctrl adds up a trackpad's parts (the page) and takes whole notches
  const s = slipOn(face('floor'), LAB.floor.points);
  assert.equal([1, 2, 3, 4].reduce((x) => slipScale(x, wheelNotches({ deltaY: -100 })), s).k, 2);
});

test('the walk\'s heap gives the sides on offer in crossedFirst\'s order: the higher rank, then the longer, then the one offered first', () => {
  // 20 seeded rounds of 64 offers, ties on every key (ranks 0 to 3, 8 lengths, each offered once), pushed in a shuffled
  // order: popped all at the end, and popped by turns as the walk does (each pop the best of those pushed so far), in
  // the order a sort by those keys gives
  let seed = 4242;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const byKeys = (a, b) => b.rank - a.rank || b.length - a.length || a.order - b.order;
  for (let round = 0; round < 20; round++) {
    const offers = Array.from({ length: 64 }, (_, order) => ({ rank: Math.floor(random() * 4), length: Math.floor(random() * 8), order }));
    const shuffled = offers.map((x) => [random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
    const all = heapOf(crossedFirst), popped = [];
    for (const x of shuffled) all.push(x);
    while (all.size) popped.push(all.pop());
    assert.deepEqual(popped.map((x) => x.order), [...offers].sort(byKeys).map((x) => x.order), `round ${round}, popped at the end`);
    const turns = heapOf(crossedFirst), waiting = [];
    shuffled.forEach((x, i) => {
      turns.push(x);
      waiting.push(x);
      if (i % 3 !== 2) return;
      waiting.sort(byKeys);
      assert.equal(turns.pop(), waiting.shift(), `round ${round}, popped after ${i + 1} pushed`);
    });
    assert.equal(turns.size, waiting.length);
  }
});

// ---------------------------------------------------------------- the view's faces

test('a face\'s pieces from the view\'s triangles: each BSP polygon whole again, its corners', () => {
  // a mesh of two faces: face 0 cut by the BSP into a quad (2 triangles) and a triangle, face 1 between them
  const quad = [[0, 0, 0], [128, 0, 0], [128, 64, 0], [0, 64, 0]], tri = [[128, 0, 0], [256, 0, 0], [128, 64, 0]];
  const other = [[0, 0, 64], [0, 64, 64], [64, 0, 64]];
  const fan = (pts) => pts.slice(1, -1).flatMap((_, k) => [pts[0], pts[k + 1], pts[k + 2]]);
  const pos = [...fan(quad), ...fan(other), ...fan(tri)].flat();
  const piece = [7, 7, 8, 9];                   // the BSP polygon of each triangle (geometry.json's piece)
  const { pieces, points } = piecesOf(pos, piece, [0, 1, 3]);
  assert.deepEqual(pieces, [quad, tri]);
  assert.deepEqual(points, [...quad, ...tri]);
  // the normal of the face from its pieces, as from its polygon
  nearList(piecesNormal(pieces), faceNormal(quad));
  // an older geometry with no piece: a triangle starting where the one before it started goes on its polygon
  assert.deepEqual(piecesOf(pos, undefined, [0, 1, 3]).pieces, [quad, tri]);
  // two BSP pieces from the same corner: their own polygons with the pieces named, one without
  const halves = [...fan([quad[0], quad[1], quad[2]]), ...fan([quad[0], quad[2], quad[3]])].flat();
  assert.deepEqual(piecesOf(halves, [4, 5], [0, 1]).pieces, [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]]);
  assert.deepEqual(piecesOf(halves, null, [0, 1]).pieces, [quad]);
  // two quads side by side, each fanned into two triangles (pieces 4, 4, 5, 5): a triangle goes on the piece of the one
  // before it (on the face's first one's, the second quad came out as two triangles)
  const beside = [[128, 0, 0], [256, 0, 0], [256, 64, 0], [128, 64, 0]];
  assert.deepEqual(piecesOf([...fan(quad), ...fan(beside)].flat(), [4, 4, 5, 5], [0, 1, 2, 3]).pieces, [quad, beside]);
  // two pieces fanned from one corner, the second not going on from the first's last corner: two without the pieces
  // named too (by the first corner alone, one polygon that lost the second's middle corner)
  const notch = [[0, 0, 0], [256, 0, 0], [256, 128, 0], [128, 256, 0], [0, 256, 0]];
  const apartFans = [...fan(notch.slice(0, 3)), ...fan([notch[0], notch[3], notch[4]])].flat();
  assert.deepEqual(piecesOf(apartFans, null, [0, 1]).pieces, [notch.slice(0, 3), [notch[0], notch[3], notch[4]]]);
  // a real face: the room's wall of 5 corners, its fan
  const wall = piecesOf(fan(LAB.roomWall.points).flat(), [3, 3, 3], [0, 1, 2]);
  assert.deepEqual(wall.pieces, [LAB.roomWall.points]);
  nearList(sourceNormal(wall.pieces, 2), sourceNormal(LAB.roomWall.points, 2));
});

test('every face as its queued rows leave it: the rows indexed once, a shape asked only when needed', () => {
  const faces = [face('wall'), face('floor'), face('ceiling'), DOOR, { id: 'x', brush: 'Brush9', poly: 0, mapping: null }, face('slope')];
  const rows = [{ op: 'pan', args: [5, 0], targets: [{ brush: 'Brush212', poly: 1 }] },
    { op: 'scale', args: [2, 2], targets: [{ brush: 'Brush2', poly: '*' }] },
    { op: 'floor', args: [], targets: [{ brush: 'Brush2', poly: 4 }] },
    { op: 'texture', args: ['Pkg.Big'], targets: [{ brush: 'Brush212', poly: 7 }, { brush: 'Brush9', poly: 0 }] },
    { op: 'flags', args: [0x4, 0], targets: [{ brush: 'Brush41', poly: 0 }] }];
  const asked = [];
  const shapeOf = (i, its) => {
    asked.push([i, its.map((r) => r.op)]);
    return { normal: faceNormal(LAB.floor.points), points: LAB.floor.points, tileOf: (ref) => (ref === 'Pkg.Big' ? [256, 512] : null) };
  };
  const now = pendingMappings(faces, [], rows, shapeOf);
  assert.deepEqual([...now.keys()], [0, 1, 2, 3, 4, 5]);
  faces.forEach((f, i) => {
    if (!f.mapping) { assert.equal(now.get(i), null); return; }
    assert.deepEqual(now.get(i), mappingNow(f, rows, i === 1 || i === 3 ? shapeOf(i, []) : {}));
  });
  assert.deepEqual(now.get(3).tile, [256, 512]);
  assert.equal(now.get(5), faces[5].mapping);                // its Look only: its mapping as it was
  assert.deepEqual(asked.slice(0, 2), [[1, ['scale', 'floor']], [3, ['texture']]]);
  // a shape not known (Floor on a structure moved since the Rebuild): null; the rows built already: none pending
  assert.equal(pendingMappings(faces, [], rows, () => null).get(1), null);
  assert.equal(pendingMappings(faces, rows, rows, shapeOf).size, 0);
  // taken back after the Rebuild: undone on the view's mapping
  nearMapping(pendingMappings(faces, rows.slice(0, 1), [], shapeOf).get(0), mappingAfter(faces[0].mapping, [{ op: 'pan', args: [-5, 0] }]), 0);
  // what the view was built with not known: every face a row names waits for a Rebuild, the others stay out
  const unknown = pendingMappings(faces, null, rows, shapeOf);
  assert.deepEqual([...unknown.entries()], [[0, null], [1, null], [2, null], [3, null], [4, null], [5, null]]);
  assert.equal(pendingMappings(faces, null, [], shapeOf).size, 0);
  // known but for the rows the map had when it opened (an older build): their faces wait, the rows queued since show
  const opened = rows.slice(0, 2), since = [...opened, { op: 'pan', args: [0, 7], targets: [{ brush: 'Brush212', poly: 7 }, { brush: 'Brush2', poly: 4 }] }];
  const maybe = pendingMappings(faces, { maybe: opened }, since, shapeOf);
  assert.deepEqual([...maybe.keys()], [0, 1, 2, 3]);
  assert.deepEqual([maybe.get(0), maybe.get(1), maybe.get(2)], [null, null, null]);       // the pan of face 0, Brush2's scale
  nearMapping(maybe.get(3), mappingAfter(faces[3].mapping, [since[2]]), 0);                // the door: only the row since
  assert.deepEqual([...pendingMappings(faces, { maybe: opened }, opened, shapeOf).entries()], [[0, null], [1, null], [2, null]]);
  assert.equal(pendingMappings(faces, { maybe: [] }, [], shapeOf).size, 0);
  // a slip folded into the rows it opened with: their faces still wait, the others show
  const folded = pendingMappings(faces, { maybe: [rows[0]] }, [{ op: 'pan', args: [6, 0], targets: [{ brush: 'Brush212', poly: 1 }, { brush: 'Brush212', poly: 7 }] }], shapeOf);
  assert.equal(folded.get(0), null);
  nearMapping(folded.get(3), mappingAfter(faces[3].mapping, [{ op: 'pan', args: [6, 0] }]), 0);
  // a big map: quick (rows indexed once)
  const many = Array.from({ length: 30000 }, (_, i) => ({ brush: `Brush${i >> 6}`, poly: i & 63, mapping: face('wall').mapping }));
  const queue = Array.from({ length: 3000 }, (_, i) => ({ op: 'pan', args: [1, 0], targets: [{ brush: `Brush${i >> 6}`, poly: i & 63 }] }));
  const t0 = performance.now(), all = pendingMappings(many, [], queue), took = performance.now() - t0;
  assert.equal(all.size, 3000);
  assert.ok(took < 500, `${Math.round(took)} ms for 30000 faces`);
});
