// The sides of a box as drag handles (static/block-handles.js): a side dragged alone with the opposite one fixed,
// Alt about the middle, Shift by the same share, never inside out, on the map's grid or in whole steps when turned,
// and the line a dot slides on, picked from the pointer's ray.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lineParam, FACES, faceHandle, faceHandles, moveFace, faceAway, MIN_SIDE } from '../editor/static/block-handles.js';

const ID = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const near = (a, b, msg) => { assert.equal(a.length, b.length, msg); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${msg}: ${a} vs ${b}`)); };
// a box's two sides along an axis of the map (for a box on the map's axes)
const sides = (r, k) => [r.centre[k] - r.size[k] / 2, r.centre[k] + r.size[k] / 2];
const wall = { centre: [0, 0, 0], size: [100, 64, 32], axes: ID };
const PX = FACES.find((f) => f.axis === 0 && f.sign === 1), NX = FACES.find((f) => f.axis === 0 && f.sign === -1);

test('six dots, one in the middle of each side, each on a line out from the middle', () => {
  const hs = faceHandles(wall);
  assert.equal(hs.length, 6);
  const px = faceHandle(wall, PX);
  near(px.at, [50, 0, 0], '+X'); near(px.dir, [1, 0, 0], '+X dir'); assert.equal(px.t, 50);
  near(faceHandle(wall, FACES.find((f) => f.axis === 2 && f.sign === -1)).at, [0, 0, -16], '-Z');
  // a block turned a quarter round: its +X side faces the map's +Y
  const turned = { centre: [10, 20, 0], size: [100, 64, 32], axes: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]] };
  near(faceHandle(turned, PX).at, [10, 70, 0], 'turned +X');
});

test('dragging a side moves it alone: the opposite side stays', () => {
  const r = moveFace(wall, PX, 70);
  near(sides(r, 0), [-50, 70], 'x sides'); near(r.size, [120, 64, 32], 'size'); assert.equal(r.t, 70);
  near(sides(moveFace(wall, NX, 80), 0), [-80, 50], '-X dragged out');
  near(sides(moveFace(wall, PX, 20), 0), [-50, 20], 'pulled in');
});

test('Alt: both sides move, the middle stays; Shift: the other sides grow by the same share', () => {
  const a = moveFace(wall, PX, 70, { alt: true });
  near(sides(a, 0), [-70, 70], 'alt'); near(a.centre, [0, 0, 0], 'alt middle'); assert.equal(a.t, 70);
  const s = moveFace(wall, PX, 150, { shift: true });          // 100 wide -> 200: everything doubles
  near(s.size, [200, 128, 64], 'shift'); near(sides(s, 0), [-50, 150], 'shift keeps the opposite side');
  near([s.centre[1], s.centre[2]], [0, 0], 'the other axes grow about their middle');
});

test('it never turns inside out: past the opposite side it keeps the thinnest size', () => {
  near(sides(moveFace(wall, PX, -500), 0), [-50, -50 + MIN_SIDE], 'min');
  near(sides(moveFace(wall, PX, -500, { min: 8 }), 0), [-50, -42], 'own min');
  near(sides(moveFace(wall, PX, -500, { alt: true }), 0), [-2, 2], 'alt min');
});

test("on the grid a side facing the map's axes lands on the map's grid, from wherever the opposite one is", () => {
  const off = { centre: [3, 0, 0], size: [100, 64, 32], axes: ID };       // sides at -47 and 53: off the grid
  near(sides(moveFace(off, PX, 60, { step: 16 }), 0), [-47, 64], '63 -> 64');
  near(sides(moveFace(off, PX, 70, { step: 16 }), 0), [-47, 80], '73 -> 80');
  near(sides(moveFace(off, NX, 70, { step: 16 }), 0), [-64, 53], '-67 -> -64');
  near(sides(moveFace(off, PX, 60, { step: 16, alt: true }), 0), [-58, 64], 'alt: the side dragged on the grid');
  // too near the opposite side: the next grid line out instead (never thinner than the minimum)
  near(sides(moveFace(wall, PX, -48, { step: 16 }), 0), [-50, -32], 'next line out');
  near(sides(moveFace(wall, NX, -48, { step: 16 }), 0), [32, 50], 'next line out, -X');
  // a block turned a quarter round faces the map's axes too
  const q = { centre: [0, 0, 0], size: [100, 64, 32], axes: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]] };
  const r = moveFace(q, PX, 75, { step: 16 });
  assert.equal(r.size[0], 130);                                           // its +X side (the map's +Y) at 80
  near(r.centre, [0, 15, 0], 'quarter turn');
});

test('a turned side goes in whole steps of thickness', () => {
  const c = Math.SQRT1_2, slant = { centre: [0, 0, 0], size: [100, 64, 32], axes: [[c, c, 0], [-c, c, 0], [0, 0, 1]] };
  assert.equal(moveFace(slant, PX, 63, { step: 16 }).size[0], 112);       // 113 -> 112
  assert.equal(moveFace(slant, PX, -48, { step: 16 }).size[0], 16);       // never under one step (the minimum 4)
  assert.equal(moveFace(slant, PX, 63, { step: 16, alt: true }).size[0], 128);
});

test('the line a dot slides on, from the pointer ray', () => {
  // the line is the X axis; a ray straight down through x = 40 meets it there
  assert.equal(lineParam([0, 0, 0], [1, 0, 0], [40, 0, 500], [0, 0, -1]), 40);
  // a slanted ray through (60, 0, 0) meets the line there
  const l = Math.hypot(60, 100, 100), t = lineParam([0, 0, 0], [1, 0, 0], [0, -100, 100], [60 / l, 100 / l, -100 / l]);
  assert.ok(Math.abs(t - 60) < 1e-6, String(t));
  assert.equal(lineParam([0, 0, 0], [1, 0, 0], [-500, 0, 0], [1, 0, 0]), null);       // the ray runs along the line
  assert.equal(lineParam([0, 0, 0], [1, 0, 0], [40, 0, 500], [0, 0, 1]), null);        // the line is behind the camera
});

test('sides facing away from a view, by the way it looks at them; edge on is not away', () => {
  const px = faceHandle(wall, PX), nx = faceHandle(wall, NX), py = faceHandle(wall, FACES.find((f) => f.axis === 1 && f.sign === 1));
  const fromX = [-1, 0, 0];                                       // from an eye out along +X, toward the wall
  assert.equal(faceAway(px, fromX), false);
  assert.equal(faceAway(nx, fromX), true);
  assert.equal(faceAway(py, fromX), false);                         // an orthographic view along X sees it edge on
});
