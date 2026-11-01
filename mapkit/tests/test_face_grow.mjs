// Face selection's Grow (static/face-grow.js): the faces that share a piece of an edge with the selected ones join
// them, those in their plane (within GROW_ANGLE) or all of them; the sides two faces share (the Texture Slip's edges).
// The faces as the 3D view has them: the triangles data.py writes (geometry.json: each polygon a fan from its first
// corner, the face of each triangle, -1 for none) and each mesh's world matrix, each face's polygons put together again
// from its fans when its outline is first asked for (piecesFromFans: two pieces fanned from one corner stay two) or as
// its mesh gives them (its outline from their sides, one that lists a corner twice too); one test on a real room of the
// Feature Lab map, with its BSP cuts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { faceShapes, growFaces, touching, sharedSides, piecesFromFans, GROW_ANGLE, EDGE_TOLERANCE } from '../editor/static/face-grow.js';

// a mesh as data.py's _assemble writes a group: each polygon [face id, corners] a fan of triangles
function group(polys, matrix = null) {
  const pos = [], faces = [];
  for (const [id, pts] of polys) for (let k = 1; k < pts.length - 1; k++) { faces.push(id); for (const j of [0, k, k + 1]) pos.push(...pts[j]); }
  return { pos, faces, matrix };
}
const grow = (meshes, chosen, opts) => growFaces(faceShapes(meshes), new Set(chosen), opts).sort((a, b) => a - b);
const tan = (deg) => Math.tan(deg * Math.PI / 180);
const square = (x0, y0, x1, y1, z = 0) => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];

// a floor (face 1) cut by the BSP in two, the floor beyond half of one side, a wall, ramps of 3 and 10 degrees, a
// floor touching it at a corner only, one 2 units away, and triangles of no face
const ROOM = group([
  [1, square(0, 0, 128, 256)], [1, square(128, 0, 256, 256)],
  [2, square(256, 0, 512, 128)],                                                           // shares 128 of the 256 of x = 256
  [3, [[0, 0, 0], [0, 0, 128], [256, 0, 128], [256, 0, 0]]],                               // the wall along y = 0
  [4, square(256, 256, 384, 384)],                                                         // only the corner (256, 256)
  [5, square(0, 258, 256, 512)],                                                           // 2 units away
  [6, [[0, 0, 0], [0, 256, 0], [-128, 256, 128 * tan(3)], [-128, 0, 128 * tan(3)]]],      // 3 degrees up along x = 0
  [7, [[0, 256, 0], [256, 256, 0], [256, 384, 128 * tan(10)], [0, 384, 128 * tan(10)]]],  // 10 degrees up along y = 256
  [-1, square(0, -256, 256, 0)],                                                           // no face of its own
]);

test('a floor cut by the BSP grows into the floor beyond it and a gentle ramp; the wall and a steeper ramp at any angle', () => {
  assert.equal(GROW_ANGLE, 5);
  assert.deepEqual(grow([ROOM], [1]), [2, 6]);
  assert.deepEqual(grow([ROOM], [1], { maxAngle: 180 }), [2, 3, 6, 7]);
  // from the floor beyond: back into the cut floor (a T-junction: its one side against the floor's two pieces)
  assert.deepEqual(grow([ROOM], [2]), [1]);
  // from the wall: nothing in its plane, the floor at any angle
  assert.deepEqual(grow([ROOM], [3]), []);
  assert.deepEqual(grow([ROOM], [3], { maxAngle: 180 }), [1]);
  // a wider angle takes the 10 degrees ramp too
  assert.deepEqual(grow([ROOM], [1], { maxAngle: 12 }), [2, 6, 7]);
});

test('the selection itself, faces of no face and ids not in the meshes are left out; grown again it goes on', () => {
  assert.deepEqual(grow([ROOM], [1, 2, 999]), [6]);
  assert.deepEqual(grow([ROOM], [1, 2, 6], { maxAngle: 180 }), [3, 7]);
  assert.deepEqual(grow([ROOM], []), []);
  assert.ok(!faceShapes([ROOM]).has(-1));
});

test('a face as the 3D view shows it: its triangles, its box, its normal from them; its polygons once its outline is asked for', () => {
  const shapes = faceShapes([ROOM]), s = shapes.get(1);
  assert.equal(s.tris.length, 4);
  assert.deepEqual([s.lo, s.hi], [[0, 0, 0], [256, 256, 0]]);
  assert.deepEqual(s.normal, [0, 0, 1]);
  assert.deepEqual(shapes.get(3).normal, [0, 1, 0]);
  // its polygons (the two squares) put together again from its fans only when its outline is asked for: a Grow press
  // looks at the faces near the selection, not at every face of the map
  assert.equal(s.pieces, undefined);
  assert.equal(touching(s, shapes.get(3)), true);
  assert.deepEqual(s.pieces, [square(0, 0, 128, 256), square(128, 0, 256, 256)]);
  // a mesh that gives a face's polygons (the Texture Slip's BSP pieces): taken as they are, two halves of a square
  // whose fans would make one polygon
  const halves = [[[0, 0, 0], [256, 0, 0], [256, 256, 0]], [[0, 0, 0], [256, 256, 0], [0, 256, 0]]];
  const given = faceShapes([{ ...group([[1, square(0, 0, 256, 256)]]), pieces: new Map([[1, halves]]) }]).get(1);
  assert.equal(given.pieces, halves);
  assert.deepEqual(piecesFromFans(given.tris), [square(0, 0, 256, 256)]);
});

test('edges a little apart still meet, 2 units apart they do not; a corner is not an edge', () => {
  const near = faceShapes([group([[1, square(0, 0, 256, 256)], [2, square(256, 0, 512, 256, 0.3)], [3, square(256, 0, 512, 256, 2)]])]);
  assert.equal(EDGE_TOLERANCE, 0.5);
  assert.equal(touching(near.get(1), near.get(2)), true);
  assert.equal(touching(near.get(1), near.get(3)), false);
  assert.equal(touching(near.get(1), near.get(3), 3), true);
  // two edges on one line, end to end: they meet at a point only
  const line = faceShapes([group([[1, square(0, 0, 256, 256)], [2, [[256, 0, 0], [512, 0, 0], [512, -256, 0]]]])]);
  assert.equal(touching(line.get(1), line.get(2)), false);
});

test('the sides two faces share, on each one\'s own edge: one a line, stretched over a T-junction and a doorway', () => {
  // a side: its two ends on the first face's edge, then the points beside them on the second's, [[from, to], [from,
  // to]]; compared here as the ends of each in order along it, the first's end beside the second's
  const ends = (side) => [0, 1].map((i) => [side[0][i], side[1][i]]).sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1] || a[0][2] - b[0][2]);
  const shapes = faceShapes([ROOM]);
  // the floor cut in two along the wall at y 0: its two edges against the wall's one, the whole of it
  assert.deepEqual(sharedSides(shapes.get(1), shapes.get(3)).map(ends), [[[[0, 0, 0], [0, 0, 0]], [[256, 0, 0], [256, 0, 0]]]]);
  // the floor beyond along half of the cut floor's side at x 256
  assert.deepEqual(sharedSides(shapes.get(2), shapes.get(1)).map(ends), [[[[256, 0, 0], [256, 0, 0]], [[256, 128, 0], [256, 128, 0]]]]);
  // a corner, or 2 units away: none
  assert.deepEqual(sharedSides(shapes.get(1), shapes.get(4)), []);
  assert.deepEqual(sharedSides(shapes.get(1), shapes.get(5)), []);
  // edges 0.3 apart: each face's own (a corner the engine left a little off stays where it is)
  const near = faceShapes([group([[1, square(0, 0, 256, 256)], [2, square(256, 0, 512, 256, 0.3)]])]);
  assert.deepEqual(sharedSides(near.get(1), near.get(2)).map(ends), [[[[256, 0, 0], [256, 0, 0.3]], [[256, 256, 0], [256, 256, 0.3]]]]);
  // the same where the first face's edge is the shorter, both ways round: a floor 128 wide, a wall's foot 256 long 0.3 up
  const foot = faceShapes([group([[1, square(0, 0, 128, 128)], [2, [[0, 0, 0.3], [0, 0, 128.3], [256, 0, 128.3], [256, 0, 0.3]]]])]);
  assert.deepEqual(sharedSides(foot.get(1), foot.get(2)).map(ends), [[[[0, 0, 0], [0, 0, 0.3]], [[128, 0, 0], [128, 0, 0.3]]]]);
  assert.deepEqual(sharedSides(foot.get(2), foot.get(1)).map(ends), [[[[0, 0, 0.3], [0, 0, 0]], [[128, 0, 0.3], [128, 0, 0]]]]);
  // a wall with a doorway (x 100 to 156) on the floor's edge at y 256: its two edges and the gap, the whole of it
  const doorway = faceShapes([group([[1, square(0, 0, 256, 256)], [6, [[0, 256, 0], [100, 256, 0], [100, 256, 128], [0, 256, 128]]],
    [6, [[156, 256, 0], [256, 256, 0], [256, 256, 128], [156, 256, 128]]], [6, [[100, 256, 96], [156, 256, 96], [156, 256, 128], [100, 256, 128]]]])]);
  assert.deepEqual(sharedSides(doorway.get(6), doorway.get(1)).map(ends), [[[[0, 256, 0], [0, 256, 0]], [[256, 256, 0], [256, 256, 0]]]]);
  // a sign (x 128 to 192, z 16 to 144) set in a wall cut round it: its four sides, in the order of their longest overlap
  const inset = faceShapes([group([[7, [[128, 0, 16], [192, 0, 16], [192, 0, 144], [128, 0, 144]]],
    [8, [[0, 0, 0], [256, 0, 0], [256, 0, 16], [0, 0, 16]]], [8, [[0, 0, 144], [256, 0, 144], [256, 0, 256], [0, 0, 256]]],
    [8, [[0, 0, 16], [128, 0, 16], [128, 0, 144], [0, 0, 144]]], [8, [[192, 0, 16], [256, 0, 16], [256, 0, 144], [192, 0, 144]]]])]);
  const sides = sharedSides(inset.get(7), inset.get(8)).map((side) => ends(side).map(([p]) => p));
  assert.deepEqual(sides.map(([p, q]) => Math.hypot(...p.map((x, k) => q[k] - x))), [128, 128, 64, 64]);
  assert.deepEqual(sides.map((side) => JSON.stringify(side)).sort(), [[[128, 0, 16], [128, 0, 144]], [[128, 0, 16], [192, 0, 16]],
    [[128, 0, 144], [192, 0, 144]], [[192, 0, 16], [192, 0, 144]]].map((side) => JSON.stringify(side)).sort());
  // that order, not the sides' length: two strips by a doorway along y 256 (100 each, the side 256 over them) after a
  // strip of 150 along x 0
  const strips = faceShapes([group([[1, square(0, 0, 256, 256)], [2, square(0, 256, 100, 300)], [2, square(156, 256, 256, 300)], [2, square(-50, 0, 0, 150)]])]);
  assert.deepEqual(sharedSides(strips.get(1), strips.get(2)).map(([on]) => Math.hypot(...on[1].map((x, k) => x - on[0][k]))), [150, 256]);
});

test('a face with two edges a hair apart along the seam: the side on the one beside the other face, both ways round', () => {
  // a floor and a ledge 0.37 wide along its edge at y 256 (as NYC Ship Below's Brush3056 face 7), its corners from its
  // far edge on: both of the ledge's long edges lie within tol of the floor's, and end with it. Taken by the order found,
  // the ledge's side was its far edge (a texture 8 texels a unit across it: 3 texels of drift)
  const shapes = faceShapes([group([[1, square(0, 0, 256, 256)], [2, [[256, 256.37, 0], [0, 256.37, 0], [0, 256, 0], [256, 256, 0]]]])]);
  const ledge = (side) => side.map((p) => p[1]);
  const [floorFirst] = sharedSides(shapes.get(1), shapes.get(2)), [ledgeFirst] = sharedSides(shapes.get(2), shapes.get(1));
  assert.deepEqual([ledge(floorFirst[1]), ledge(ledgeFirst[0])], [[256, 256], [256, 256]]);
});

test('a seam kinked on one face and straight on the other: the same sides whichever face comes first', () => {
  // a floor whose edge at y 256 has a corner 0.32 off it at its middle (as UNATCO Island's Brush289 faces 165 and 137,
  // their corners at z -116.68 and -117 by turns) against a floor beyond it, straight. Lines made from the first face's
  // points alone: the straight edge first, one side (0.67 texel of drift over the kink there, refused); the kinked one
  // first, two (one running on), so the walk's verdict hung on the order of their boxes
  const shapes = faceShapes([group([[1, [[0, 0, 0], [256, 0, 0], [256, 256, 0], [128, 256.32, 0], [0, 256, 0]]], [2, square(0, 256, 256, 512)]])]);
  // each side as [on the kinked floor, on the straight one], each from its lower x
  const sides = (s, o) => sharedSides(shapes.get(s), shapes.get(o)).map((side) => (s === 1 ? side : [side[1], side[0]]))
    .map((side) => side.map((on) => [...on].sort((p, q) => p[0] - q[0]))).sort((a, b) => a[0][0][0] - b[0][0][0]);
  assert.deepEqual(sides(1, 2), [[[[0, 256, 0], [128, 256.32, 0]], [[0, 256, 0], [128, 256, 0]]], [[[128, 256.32, 0], [256, 256, 0]], [[128, 256, 0], [256, 256, 0]]]]);
  assert.deepEqual(sides(2, 1), sides(1, 2));
});

test('two BSP pieces fanned from one corner: two polygons, each side of theirs kept', () => {
  // a floor of two pieces whose fans start at the same corner, A = P0 P1 P2 then B = P0 P3 P4 (B's second corner is not
  // A's last), and a wall along P3 P4. Put on A by its first corner alone, B's triangle made one polygon P0 P1 P2 P4,
  // which lost P3 and the side P3 P4: no side shared with the wall
  const [P0, P1, P2, P3, P4] = [[0, 0, 0], [256, 0, 0], [256, 128, 0], [128, 256, 0], [0, 256, 0]];
  assert.deepEqual(piecesFromFans([[P0, P1, P2], [P0, P3, P4]]), [[P0, P1, P2], [P0, P3, P4]]);
  assert.deepEqual(piecesFromFans([[P0, P1, P2], [P0, P2, P3]]), [[P0, P1, P2, P3]]);          // a fan going on: one
  const shapes = faceShapes([group([[1, [P0, P1, P2]], [1, [P0, P3, P4]], [2, [P4, P3, [128, 256, 128], [0, 256, 128]]]])]);
  assert.deepEqual(sharedSides(shapes.get(1), shapes.get(2)).map(([on]) => [...on].sort((p, q) => p[0] - q[0])), [[P4, P3]]);
  // the other half of the rule: B fanned from another corner, its first triangle's second corner A's last (A = A0 A1 A2
  // A3, B = Q0 A3 Q2 Q3), and a wall along Q0 A3. Put on A by its second corner alone, B's corners went on A's polygon,
  // which lost Q0 and the side Q0 A3: no side shared with the wall
  const [A0, A1, A2, A3] = [[0, 16, 0], [0, 0, 0], [128, 0, 0], [128, 16, 0]], [Q0, Q2, Q3] = [[128, 128, 0], [256, 16, 0], [256, 128, 0]];
  assert.deepEqual(piecesFromFans([[A0, A1, A2], [A0, A2, A3], [Q0, A3, Q2], [Q0, Q2, Q3]]), [[A0, A1, A2, A3], [Q0, A3, Q2, Q3]]);
  const beside = faceShapes([group([[1, [A0, A1, A2, A3]], [1, [Q0, A3, Q2, Q3]], [2, [Q0, A3, [128, 16, 128], [128, 128, 128]]]])]);
  assert.deepEqual(sharedSides(beside.get(1), beside.get(2)).map(([on]) => [...on].sort((p, q) => p[1] - q[1])), [[A3, Q0]]);
});

test('two overlaps on a line that end 0.3 apart do not end together: the side runs to the farther end', () => {
  // a floor and, along its edge at y 0, a face of two pieces: a wall whose foot lies 0.4 up all along it, and a strip
  // under the wall on the edge from x 100 to 255.7. Ends within SAME_END (0.05) are one, the one whose points lie
  // nearest each other kept; these are not one: the side runs to x 256, not to the strip's end
  const shapes = faceShapes([group([[1, square(0, 0, 256, 256)], [2, [[0, 0, 0.4], [256, 0, 0.4], [256, 0, 128], [0, 0, 128]]],
    [2, [[100, 0, 0], [255.7, 0, 0], [255.7, 0, 0.4], [100, 0, 0.4]]]])]);
  const [[onFloor]] = sharedSides(shapes.get(1), shapes.get(2));
  assert.deepEqual(onFloor.map((p) => p[0]).sort((a, b) => a - b), [0, 256]);
});

test('a BSP piece that lists a corner twice: its outline from its sides, the one it goes back over kept', () => {
  // a floor of one piece going round its corners and back over two of them (P1 P2 P3 P4 P2 P4 P7, as UNATCO Island's
  // Brush1614 face 163) and a wall along its edge at y 0. Its fan has triangles over P1 P2 P4 both ways round, whose
  // sides took that edge out of the outline: no side shared with the wall, no Grow into it
  const floor = [[0, 0, 0], [256, 0, 0], [256, 128, 0], [128, 128, 0], [256, 0, 0], [128, 128, 0], [0, 128, 0]];
  const mesh = group([[1, floor], [2, [[0, 0, 0], [0, 0, 128], [256, 0, 128], [256, 0, 0]]]]), shapes = faceShapes([mesh]);
  assert.deepEqual(piecesFromFans(shapes.get(1).tris), [floor]);
  assert.deepEqual(sharedSides(shapes.get(1), shapes.get(2)).map(([on]) => [...on].sort((p, q) => p[0] - q[0])), [[[0, 0, 0], [256, 0, 0]]]);
  assert.deepEqual(grow([mesh], [2], { maxAngle: 180 }), [1]);
});

test('the two sides of a sheet share every edge but face away: only at any angle', () => {
  const sheet = group([[1, square(0, 0, 256, 256)], [2, square(0, 0, 256, 256).reverse()]]);
  assert.deepEqual(grow([sheet], [1]), []);
  assert.deepEqual(grow([sheet], [1], { maxAngle: 180 }), [2]);
});

test('a structure moved since the Rebuild grows where it is seen (its mesh\'s world matrix)', () => {
  const floor = group([[1, square(0, 0, 256, 256)]]);
  const moved = (matrix) => group([[2, square(512, 0, 768, 256)]], matrix);
  assert.deepEqual(grow([floor, moved(null)], [1]), []);
  // three.js keeps a matrix column by column: 256 to the left
  assert.deepEqual(grow([floor, moved([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -256, 0, 0, 1])], [1]), [2]);
  // a quarter turn round z, then (512, -512): (512..768, 0..256) turns to (-256..0, 512..768) and lands on (256..512, 0..256)
  assert.deepEqual(grow([floor, moved([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 512, -512, 0, 1])], [1]), [2]);
  // turned the other way, the same move leaves it far off
  assert.deepEqual(grow([floor, moved([0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 512, -512, 0, 1])], [1]), []);
});

test('a face too big to file by cells is still found, chosen or not', () => {
  const huge = group([[1, square(0, 0, 40000, 40000)], [2, square(40000, 100, 40300, 400)], [3, square(-300, 39000, 0, 39500)]]);
  assert.deepEqual(grow([huge], [1]), [2, 3]);
  assert.deepEqual(grow([huge], [2]), [1]);
});

// The room of the Feature Lab test map (Brush2, the editor's cache of 01_Feature_Lab, Unreal's axes): its four walls
// and the ceiling as data.py wrote them, cut by the BSP (the wall at x = 1024 has a doorway, the ceiling eight
// triangles meeting the walls' tops at T-junctions). The floor is left out.
const FEATURE_LAB = {
  4: [[64, 1024, 0, 1024, 1024, 0, 1024, 1024, 73.77], [64, 1024, 0, 1024, 1024, 73.77, 476.33, 1024, 384], [64, 1024, 0, 476.33, 1024, 384, 64, 1024, 384],
    [64, 1024, 0, 64, 1024, 384, -1024, 1024, 384], [64, 1024, 0, -1024, 1024, 384, -1024, 1024, 0], [1024, 1024, 73.77, 1024, 1024, 384, 476.33, 1024, 384]],
  6: [[1024, 1024, 73.77, 1024, 1024, 0, 1024, 829.09, 0], [1024, -1024, 384, 1024, -96, 384, 1024, -96, 0], [1024, -1024, 384, 1024, -96, 0, 1024, -1024, 0],
    [1024, 96, 384, 1024, 1024, 384, 1024, 1024, 73.77], [1024, 96, 384, 1024, 1024, 73.77, 1024, 829.09, 0], [1024, 96, 384, 1024, 829.09, 0, 1024, 96, 0],
    [1024, -96, 160, 1024, -96, 384, 1024, 96, 384], [1024, -96, 160, 1024, 96, 384, 1024, 96, 160]],
  140: [[-1024, 267.93, 0, -1024, 1024, 0, -1024, 1024, 384], [-1024, 267.93, 0, -1024, 1024, 384, -1024, 267.93, 384],
    [-1024, 267.93, 192, -1024, 267.93, 384, -1024, -1024, 384], [-1024, 267.93, 192, -1024, -1024, 384, -1024, -1024, 192],
    [-1024, 267.93, 0, -1024, 267.93, 192, -1024, -1024, 192], [-1024, 267.93, 0, -1024, -1024, 192, -1024, -1024, 0]],
  171: [[-892.1, -1024, 384, -553.15, -1024, 192, -1024, -1024, 192], [-892.1, -1024, 384, -1024, -1024, 192, -1024, -1024, 384],
    [-553.15, -1024, 192, -214.2, -1024, 0, -1024, -1024, 0], [-553.15, -1024, 192, -1024, -1024, 0, -1024, -1024, 192],
    [-892.1, -1024, 384, 1024, -1024, 384, 1024, -1024, 0], [-892.1, -1024, 384, 1024, -1024, 0, -214.2, -1024, 0]],
  5: [[64, 1024, 384, 476.33, 1024, 384, 64, 406.9, 384], [64, 995.3, 384, 64, 406.9, 384, -336.02, -191.77, 384],
    [64, 995.3, 384, -336.02, -191.77, 384, -607.82, -10.15, 384], [64, 1024, 384, 64, 995.3, 384, -607.82, -10.15, 384],
    [64, 1024, 384, -607.82, -10.15, 384, -1024, 267.93, 384], [64, 1024, 384, -1024, 267.93, 384, -1024, 1024, 384],
    [-336.02, -191.77, 384, -892.1, -1024, 384, -1024, -1024, 384], [-336.02, -191.77, 384, -1024, -1024, 384, -1024, 267.93, 384],
    [476.33, 1024, 384, 1024, 1024, 384, 1024, -1024, 384], [476.33, 1024, 384, 1024, -1024, 384, -892.1, -1024, 384]],
};
test('the Feature Lab room: a wall grows into the walls beside it and the ceiling, never the wall across', () => {
  const ids = Object.keys(FEATURE_LAB).map(Number);
  const room = { pos: ids.flatMap((id) => FEATURE_LAB[id].flat()), faces: ids.flatMap((id) => FEATURE_LAB[id].map(() => id)), matrix: null };
  assert.deepEqual(grow([room], [4]), []);                                     // nothing in its plane
  assert.deepEqual(grow([room], [4], { maxAngle: 180 }), [5, 6, 140]);
  assert.deepEqual(grow([room], [6], { maxAngle: 180 }), [4, 5, 171]);         // the wall with the doorway
  assert.deepEqual(grow([room], [5], { maxAngle: 180 }), [4, 6, 140, 171]);    // the ceiling: every wall at its edges
  assert.deepEqual(grow([room], [4, 6], { maxAngle: 180 }), [5, 140, 171]);
});
