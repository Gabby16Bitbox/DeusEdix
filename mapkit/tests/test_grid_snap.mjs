// The grid as Unity's grid snapping has it (static/grid-snap.js): Push to grid, the step halved and doubled, Ctrl
// turning grid snap the other way while the gizmo drags, a slide over a surface on the grid along it, and where the
// 3D view's grid lies and how fine it shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_LIMITS, GRID_MAJOR, onGrid, nextGridStep, dragSnap, surfaceOnGrid, pushMove, gridView } from '../editor/static/grid-snap.js';

test('a point goes onto the nearest grid point along the axes asked, never to -0', () => {
  assert.deepEqual(onGrid([7, 9, -7], 16), [0, 16, 0]);
  assert.ok(!Object.is(onGrid([-7, 0, 0], 16)[0], -0));
  assert.deepEqual(onGrid([7, 9, 33], 16, [0, 1]), [0, 16, 33]);
  assert.deepEqual(onGrid([100.4, -100.4, 3], 0.5), [100.5, -100.5, 3]);
});

test('Ctrl+[ halves the grid step and Ctrl+] doubles it, within the limits of the toolbar', () => {
  assert.equal(nextGridStep(16, -1), 8);
  assert.equal(nextGridStep(16, 1), 32);
  assert.equal(nextGridStep(22.5, -1), 11.25);
  assert.equal(nextGridStep(GRID_LIMITS[0], -1), GRID_LIMITS[0]);
  assert.equal(nextGridStep(GRID_LIMITS[1], 1), GRID_LIMITS[1]);
  assert.equal(nextGridStep(3000, 1), GRID_LIMITS[1]);
});

test('Ctrl while the gizmo drags turns grid snap the other way; Ctrl+Shift (surface snapping) does not', () => {
  assert.equal(dragSnap(true, {}), true);
  assert.equal(dragSnap(true, { ctrlKey: true }), false);
  assert.equal(dragSnap(false, { ctrlKey: true }), true);
  assert.equal(dragSnap(false, { ctrlKey: true, shiftKey: true }), false);
  assert.equal(dragSnap(true, { ctrlKey: true, shiftKey: true }), true);
  assert.equal(dragSnap(true, { shiftKey: true }), true);
});

test('a slide over a surface goes on the grid along the surface and keeps its place across it', () => {
  // a floor (its normal up the second axis): the two others round, the height stays where the floor is
  assert.deepEqual(surfaceOnGrid([7, 3.3, 41], [0, 1, 0], 16), [0, 3.3, 48]);
  // a wall facing along the first axis, and a slope: the axis most across it stays
  assert.deepEqual(surfaceOnGrid([101.7, 9, 25], [-1, 0, 0], 16), [101.7, 16, 32]);
  assert.deepEqual(surfaceOnGrid([9, 9, 9], [0.3, -0.8, 0.5], 8), [8, 9, 8]);
});

test('Push to grid: the move that puts the anchor on the grid, none when it is there; an object keeps its height', () => {
  assert.deepEqual(pushMove([3, -5, 20], 16), [-3, 5, -4]);
  assert.deepEqual(pushMove([3, -5, 20], 16, true), [-3, 5, 0]);
  assert.equal(pushMove([32, -64, 20], 16, true), null);
  assert.equal(pushMove([32, -64, 16], 16), null);
  // a block 128 long with its lowest corner a few units off: every side comes onto the grid
  const lo = [-61, 3, 0], d = pushMove(lo, 16), hi = [67, 131, 128];
  assert.deepEqual(lo.map((v, k) => v + d[k]), [-64, 0, 0]);
  assert.deepEqual(hi.map((v, k) => v + d[k]), [64, 128, 128]);
});

test("the 3D view's grid lies at the floor on the grid, shows further from higher up, never too fine", () => {
  const g = gridView(16, 37, 237);
  assert.equal(g.level, 32);
  assert.equal(g.radius, 205 * 12);
  assert.equal(g.cell, 32);                         // 2460 / 16 is over 96 cells: doubled once
  assert.equal(g.major, 32 * GRID_MAJOR);
  assert.equal(gridView(16, 0, 10).radius, 1024);     // close to the floor: still a room's width
  assert.equal(gridView(16, 0, 1e6).radius, 32768);
  for (const [step, eye] of [[1, 5000], [0.5, 1e5], [256, 40], [4096, 0]]) {
    const v = gridView(step, 0, eye);
    assert.ok(v.radius / v.cell <= 96 && v.cell >= step && Number.isInteger(Math.log2(v.cell / step)), `${step} ${eye}`);
  }
});
