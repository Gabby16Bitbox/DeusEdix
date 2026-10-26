// The gizmo's choices and Aim at a point (static/gizmo-tools.js): where a group's gizmo sits (Center / Pivot),
// the toggles' values as kept in Settings, Local's grid steps, and the turn that looks at a point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { GIZMO_CHOICES, gizmoChoice, nextGizmoChoice, gizmoOption, groupPivotAt, snapSteps, AIM_TILTS, aimRotation } from '../editor/static/gizmo-tools.js';
import { rotationToVector } from '../editor/static/surface-stick.js';

const TURN = 65536, DEG = TURN / 360;

test('the toggles: the first option is the default, a press goes to the next and wraps', () => {
  assert.equal(gizmoChoice('pivot', undefined), 'center');
  assert.equal(gizmoChoice('space', 'sideways'), 'global');          // an unknown preference
  assert.equal(gizmoChoice('space', 'local'), 'local');
  assert.equal(nextGizmoChoice('pivot', 'center'), 'pivot');
  assert.equal(nextGizmoChoice('pivot', 'pivot'), 'center');
  assert.equal(nextGizmoChoice('space', 'nonsense'), 'local');       // from the default
  assert.equal(gizmoOption('space', 'local').label, 'Local');
  assert.deepEqual(Object.values(GIZMO_CHOICES).map((c) => c.key), ['Z', 'X']);
  assert.deepEqual(Object.values(GIZMO_CHOICES).map((c) => c.pref), ['gizmoPivot', 'gizmoSpace']);
  assert.deepEqual(Object.values(GIZMO_CHOICES).map((c) => c.name), ['Gizmo pivot', 'Gizmo axes']);
});

test("the keys Z, X and T are the menu bar's (so they can be changed) and no other shortcut of the 3D view", () => {
  const source = readFileSync(new URL('../editor/static/menubar.js', import.meta.url), 'utf8');
  const from = source.indexOf('const ACTIONS = [');
  const table = source.slice(from, source.indexOf('\n];', from) + 3);
  const actions = vm.runInNewContext(table.replace('const ACTIONS =', 'ACTIONS ='), {});
  const key = Object.fromEntries(actions.map(([id, , def]) => [id, def]));
  assert.equal(key.pivot, GIZMO_CHOICES.pivot.key);
  assert.equal(key.space, GIZMO_CHOICES.space.key);
  assert.equal(key.aim, 'T');
  for (const ctx of ['edit', 'fly', 'cut']) {
    const keys = actions.filter((a) => a[3] === ctx || (ctx === 'cut' && a[3] === 'edit')).map((a) => a[2]);
    assert.deepEqual([...keys.filter((k, i) => keys.indexOf(k) !== i)], [], ctx);     // (an array of the vm's realm)
  }
});

test("Center is the middle of the members' bounds, not the average of their pivots; Pivot the last one's", () => {
  const items = [
    { at: [0, 0, 0], lo: [-10, -10, 0], hi: [10, 10, 20] },
    { at: [100, 0, 0], lo: [90, -5, 0], hi: [110, 5, 200] },          // tall: the middle goes up
    { at: [40, 0, 0] },                                               // a light: no bounds, its point
  ];
  assert.deepEqual(groupPivotAt('center', items), [50, 0, 100]);
  assert.deepEqual(groupPivotAt('pivot', items), [40, 0, 0]);
  assert.deepEqual(groupPivotAt('other', items), [50, 0, 100]);      // an unknown mode is Center
  assert.equal(groupPivotAt('center', []), null);
  const at = items[1].at;
  groupPivotAt('pivot', [items[1]])[0] = 5;
  assert.deepEqual(at, [100, 0, 0]);                                // a copy, never the member's own
});

test('Local snapping goes in whole steps from where the move began', () => {
  assert.deepEqual(snapSteps([17, -9, 0.2], 16), [16, -16, 0]);
  assert.deepEqual(snapSteps([7.9, 8.1, -0.1], 16), [0, 16, 0]);
  assert.ok(!Object.is(snapSteps([-1], 16)[0], -0));
});

const front = (r) => rotationToVector(r[0], r[1]);
const close = (a, b, eps = 0.01) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test('a light or a camera looks at the point: yaw and pitch, its roll stays', () => {
  const r = aimRotation([0, 0, 100], [100, 100, 0], [0, 0, 1234], false);
  assert.equal(r[1], Math.round(45 * DEG));
  assert.ok(Math.abs(r[0] - Math.atan2(-100, Math.hypot(100, 100)) * TURN / (2 * Math.PI)) <= 1);
  assert.equal(r[2], 1234);
  const len = Math.hypot(100, 100, 100);
  assert.ok(close(front(r), [100 / len, 100 / len, -100 / len]));
  assert.ok(close(front(aimRotation([0, 0, 0], [-50, 0, 0])), [-1, 0, 0]));          // behind it
  assert.equal(aimRotation([0, 0, 0], [0, 0, -300], [0, 9000, 0])[1], 9000);         // straight down: its yaw stays
  assert.equal(aimRotation([0, 0, 0], [0, 0, -300])[0], -TURN / 4);
});

test('the rest turns about the vertical only, keeping its pitch: a guard, a chair', () => {
  assert.deepEqual(aimRotation([0, 0, 40], [0, 300, 0], [0, 0, 0], true), [0, TURN / 4, 0]);
  assert.deepEqual(aimRotation([0, 0, 0], [-10, -10, 500], [700, 0, 50], true), [700, Math.round(225 * DEG), 50]);
  assert.equal(aimRotation([0, 0, 0], [0, 0, 300], [0, 0, 0], true), null);          // straight above: no side to face
  assert.equal(aimRotation([5, 5, 5], [5, 5, 5.5]), null);                           // its own place
});

test('what aims with its pitch too', () => {
  for (const k of ['light', 'camera', 'effectpoint']) assert.ok(AIM_TILTS.has(k), k);
  for (const k of ['character', 'player', 'object', 'item', 'path', 'other']) assert.ok(!AIM_TILTS.has(k), k);
});
