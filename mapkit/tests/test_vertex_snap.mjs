// Vertex snapping, as Unity's (static/vertex-snap.js): while V is held the corner of the selection nearest the pointer
// goes onto the corner of the rest nearest the pointer, only when one is within SNAP_PX pixels; behind the camera
// nothing counts. The view here is a plain one: a point [x, y, z] shows at pixel [x, y], and z < 0 is behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SNAP_PX, ringAround, nearestOnScreen, boxCorners, vertexSnap } from '../editor/static/vertex-snap.js';

const toScreen = (p) => (p[2] < 0 ? null : [p[0], p[1]]);

test('the rays round the pointer: the pointer first, then a ring inside the snapping distance', () => {
  const ring = ringAround();
  assert.deepEqual(ring[0], [0, 0]);
  assert.equal(ring.length, 7);
  for (const [x, y] of ring.slice(1)) assert.ok(Math.abs(Math.hypot(x, y) - SNAP_PX * 0.6) < 1e-9);
  assert.equal(ringAround(10, 4).length, 5);
});

test('the point nearest the pointer on the screen, within a distance, never one behind the camera', () => {
  const pts = [[10, 10, 5], [3, 4, 1], [0, 1, -2], [50, 50, 1]];
  assert.deepEqual(nearestOnScreen(pts, [0, 0], toScreen), { i: 1, d: 5 });
  assert.equal(nearestOnScreen(pts, [0, 0], toScreen, 4), null);
  assert.equal(nearestOnScreen([], [0, 0], toScreen), null);
  assert.equal(nearestOnScreen([[0, 0, -1]], [0, 0], toScreen), null);
});

test('the eight corners of a box', () => {
  const c = boxCorners([0, 0, 0], [1, 2, 3]);
  assert.equal(c.length, 8);
  assert.equal(new Set(c.map(String)).size, 8);
  assert.deepEqual(c[0], [0, 0, 0]);
  assert.deepEqual(c[7], [1, 2, 3]);
  for (const p of c) p.forEach((v, k) => assert.ok(v === 0 || v === [1, 2, 3][k]));
});

test("the selection's corner nearest the pointer goes onto the other corner near the pointer", () => {
  const block = boxCorners([100, 100, 0], [164, 164, 64]), wall = [[170, 95, 0], [300, 95, 0], [170, 95, 128]];
  // the pointer near the wall's corner: the block's corner nearest the pointer goes there
  const s = vertexSnap(block, wall, [168, 98], toScreen);
  assert.deepEqual(s.from, [164, 100, 0]);
  assert.deepEqual(s.to, [170, 95, 0]);
  // no corner of the rest near the pointer: no snap, the gizmo's own move goes on (the corner that would snap is shown)
  assert.deepEqual(vertexSnap(block, wall, [240, 200], toScreen), { from: [164, 164, 0], to: null });
  assert.equal(vertexSnap(block, wall, [170 + SNAP_PX + 1, 95], toScreen).to, null);
  assert.deepEqual(vertexSnap(block, wall, [170 + SNAP_PX, 95], toScreen).to, [170, 95, 0]);
  // nothing to snap by (none, or all behind the camera), or onto
  assert.equal(vertexSnap([], wall, [170, 95], toScreen), null);
  assert.equal(vertexSnap([[170, 95, -1]], wall, [170, 95], toScreen), null);
  assert.equal(vertexSnap(block, [], [170, 95], toScreen).to, null);
});
