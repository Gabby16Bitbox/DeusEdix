// static/walk-layer.js: a body animation mixed over the walk and the run, when it leaves the legs still (14 Nov 2026)
import assert from 'node:assert/strict';
import test, { THREE } from './three.mjs';
import { layerPlan, legsOf, layerFrames, lowerShares, layerName, layerNameOk, LEGS_MAX_TURN } from '../editor/static/walk-layer.js';

test('the plan: whole strides under whole repeats, the legs near their own pace', () => {
  const walk = { frames: 10, rate: 10 }, run = { frames: 10, rate: 18 };
  // GestureLeft 0.45 s over a 1 s walk: twice the gesture to one stride (11% fast), not one stride in 0.45 s
  assert.deepEqual(layerPlan({ frames: 9, rate: 20 }, walk), { repeats: 2, strides: 1, frames: 18, per: 9, rate: 20, pace: 1.111 });
  // GestureBoth 1.06 s: once, one stride, the frames of a stride
  const both = layerPlan({ frames: 9, rate: 8.5 }, walk);
  assert.equal(both.repeats, 1); assert.equal(both.strides, 1); assert.equal(both.frames, 10);
  assert.ok(Math.abs(both.rate - 10 / (9 / 8.5)) < 1e-9);
  // PushButton 1.2 s: 3 times over 4 strides (3.6 s, 4 s)
  const push = layerPlan({ frames: 6, rate: 5 }, walk);
  assert.equal(push.repeats, 3); assert.equal(push.strides, 4); assert.equal(push.frames, 3 * Math.max(6, Math.ceil(40 / 3)));
  // over the run: two strides in GestureBoth
  assert.equal(layerPlan({ frames: 9, rate: 8.5 }, run).strides, 2);
  // a long idle: no more than 4 repeats, the closest pace
  const idle = layerPlan({ frames: 8, rate: 3 }, walk);
  assert.ok(idle.repeats >= 1 && idle.repeats <= 4 && idle.pace < 1.12);
});

test('names the game takes', () => {
  assert.equal(layerName('GestureBoth', 'W', 2), 'GestureBoth_W2');
  assert.ok(layerNameOk('GestureBoth_W2'));
  assert.ok(!layerNameOk('A'.repeat(40) + '_W1'));
});

// a fake skeleton: bone 0 the hips, 1 the belly, 2-7 the legs (the Studio's BI), poses by frame
const BONES = ['pelvis', 'spine', 'l_thigh', 'l_calf', 'l_foot', 'r_thigh', 'r_calf', 'r_foot'];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));
function fakeKit(poses) {
  return { THREE, BI, framePos: (m, f) => m.pos.subarray(f * m.FV * 3, (f + 1) * m.FV * 3),
    poseFromFrame: (rig, m, f) => { const p = poses[f]; return { rot: BONES.map((b) => p.rot?.[b] || new THREE.Quaternion()), root: new THREE.Vector3(...(p.root || [0, 0, 0])) }; } };
}
const turn = (deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), deg * Math.PI / 180);

test('the legs: still enough, or not; the hips low or bobbing', { skip: !THREE }, () => {
  const m = { FV: 1, pos: new Float32Array(30) }, rig = {};
  const seq = (start, frames) => ({ start, frames });
  const poses = [{}, { rot: { l_thigh: turn(LEGS_MAX_TURN - 2) } }, {}, { rot: { r_calf: turn(LEGS_MAX_TURN + 5) } },
    { root: [0, -14, 0] }, { root: [0, -14, 0] }, { root: [0, 0, 0] }, { root: [0, 4, 0] }];
  const kit = fakeKit(poses);
  assert.equal(legsOf(kit, rig, m, seq(0, 2)).free, true);                 // a gesture: a leg turns a little
  const dance = legsOf(kit, rig, m, seq(2, 2));
  assert.equal(dance.free, false); assert.equal(dance.turn, LEGS_MAX_TURN + 5);
  assert.equal(legsOf(kit, rig, m, seq(4, 2)).free, false);                // sitting: the hips low
  assert.equal(legsOf(kit, rig, m, seq(6, 2)).free, false);                // the hips bob 4
});

test('the mix: the legs from the walk, the body from the animation on the walk\'s hips, the waist shared', { skip: !THREE }, () => {
  // 3 vertices: a foot, a hand, the waist (half on the belly, half on the hips); frames 0-1 the gesture, 2-3 the walk
  const FV = 3, pos = new Float32Array(4 * FV * 3);
  const put = (f, i, v) => pos.set(v, (f * FV + i) * 3);
  put(0, 0, [0, 0, 0]); put(0, 1, [10, 50, 0]); put(0, 2, [0, 40, 0]);
  put(1, 0, [0, 0, 0]); put(1, 1, [12, 60, 0]); put(1, 2, [0, 40, 0]);
  put(2, 0, [5, 0, 0]); put(2, 1, [0, 45, 0]); put(2, 2, [0, 40, 0]);
  put(3, 0, [-5, 2, 0]); put(3, 1, [0, 45, 0]); put(3, 2, [0, 42, 0]);
  const m = { FV, pos };
  const rig = { joints: BONES.map(() => [0, 40, 0]), weights: [[BI.l_foot, 1, 0, 0], [BI.spine, 1, 0, 0], [BI.spine, 0.5, BI.pelvis, 0.5]] };
  assert.deepEqual([...lowerShares({ BI }, rig)], [1, 0, 0.5]);
  const kit = fakeKit([{}, {}, {}, { root: [0, 2, 0] }]);       // the walk's hips 2 higher in its second frame
  const a = { start: 0, frames: 2, rate: 2 }, l = { start: 2, frames: 2, rate: 2 };   // both 1 s: one stride
  const { plan, data } = layerFrames(kit, rig, m, a, l);
  assert.equal(plan.frames, 2); assert.equal(plan.repeats, 1);
  const at = (f, i) => [...data.subarray((f * FV + i) * 3, (f * FV + i) * 3 + 3)].map((x) => +x.toFixed(4));
  assert.deepEqual(at(0, 0), [5, 0, 0]);          // the foot: the walk's
  assert.deepEqual(at(0, 1), [10, 50, 0]);        // the hand: the gesture's
  assert.deepEqual(at(1, 0), [-5, 2, 0]);
  assert.deepEqual(at(1, 1), [12, 62, 0]);        // the gesture's, carried 2 up by the walk's hips
  assert.deepEqual(at(1, 2), [0, 42, 0]);         // the waist: half the walk's (42), half the gesture's lifted (42)
});
