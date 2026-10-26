// The 3D view's camera (static/view-camera.js), as Unity's scene view: an orbit keeps its pivot on the screen, Alt+right
// drag goes toward it, the wheel's fly speeds, Frame's steps and flight, Settings > Camera's lens, the axis widget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PITCH_LIMIT, lookDir, orbitStep, dragDolly, dollyStep, MIN_PIVOT_DISTANCE, FLY_SPEEDS, nextFlySpeed, FRAME_DISTANCES,
  frameStep, flightPose, looksAt, CAMERA_SETTINGS, cameraSetting, verticalFov, VIEW_AXES, axisLayout, heading } from '../editor/static/view-camera.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const nearAll = (a, b, eps = 1e-6) => a.forEach((v, i) => near(v, b[i], eps));
const sub = (a, b) => a.map((v, k) => v - b[k]);
const dist = (a, b) => Math.hypot(...sub(a, b));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// where a point is in the camera's own frame (right, up, ahead): the same before and after an orbit means the
// point did not move on the screen
function inView(pos, yaw, pitch, point) {
  const f = lookDir(yaw, pitch), r = [-Math.sin(yaw), 0, Math.cos(yaw)];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]], d = sub(point, pos);
  return [dot(d, r), dot(d, u), dot(d, f)];
}

test('an orbit turns the view as the mouse look would and keeps the pivot where it is on the screen', () => {
  const pivot = [100, 50, -40], pos = [-400, 300, 200], yaw = 0.3, pitch = -0.4;
  const p = orbitStep(pos, pivot, yaw, pitch, 0.7, 0.25);
  near(p.yaw, 1.0); near(p.pitch, -0.15);
  near(dist(p.pos, pivot), dist(pos, pivot));
  nearAll(inView(p.pos, p.yaw, p.pitch, pivot), inView(pos, yaw, pitch, pivot));
  // off the middle of the view too (a selection at the side)
  const side = [300, 0, 500], q = orbitStep(pos, side, yaw, pitch, -1.2, 0.3);
  nearAll(inView(q.pos, q.yaw, q.pitch, side), inView(pos, yaw, pitch, side));
});

test('an orbit stops tipping at the pitch limit, and turning back undoes it', () => {
  const pivot = [0, 0, 0], pos = [-500, 0, 0];
  const up = orbitStep(pos, pivot, 0, 1.4, 0, 0.5);
  near(up.pitch, PITCH_LIMIT);
  nearAll(inView(up.pos, up.yaw, up.pitch, pivot), inView(pos, 0, 1.4, pivot));
  const back = orbitStep(up.pos, pivot, up.yaw, up.pitch, -0.4, -(PITCH_LIMIT - 1.4));
  const there = orbitStep(back.pos, pivot, back.yaw, back.pitch, 0.4, 0);
  nearAll(there.pos, pos, 1e-6);
});

test('Alt+right drag: right or down comes closer, never through the pivot; the pivot keeps its place', () => {
  assert.ok(dragDolly(10, 2) > 0 && dragDolly(2, 10) > 0 && dragDolly(-10, 3) < 0 && dragDolly(1, -6) < 0);
  const pivot = [0, 0, 0], pos = [300, 400, 0];
  const closer = dollyStep(pos, pivot, 0.5);
  near(dist(closer, pivot), 500 * Math.exp(-0.5));
  nearAll(closer.map((v) => v / dist(closer, pivot)), [0.6, 0.8, 0]);          // on the same line: same place on the screen
  near(dist(dollyStep(pos, pivot, 100), pivot), MIN_PIVOT_DISTANCE);
  near(dist(dollyStep([3, 0, 0], pivot, 1), pivot), 3);                         // already nearer: it stays
  near(dist(dollyStep([3, 0, 0], pivot, -1), pivot), 3 * Math.E);
  assert.deepEqual(dollyStep(pivot, pivot, 1), pivot);
});

test("the wheel's fly speeds: steps of Settings' slider, from a speed between two, stopping at the ends", () => {
  assert.equal(FLY_SPEEDS[0], 100);
  assert.equal(FLY_SPEEDS.at(-1), 3000);
  assert.ok(FLY_SPEEDS.every((s, i) => s % 50 === 0 && (!i || s > FLY_SPEEDS[i - 1])));
  assert.equal(nextFlySpeed(600, 1), 800);
  assert.equal(nextFlySpeed(600, -1), 500);
  assert.equal(nextFlySpeed(650, 1), 800);
  assert.equal(nextFlySpeed(650, -1), 600);
  assert.equal(nextFlySpeed(3000, 1), 3000);
  assert.equal(nextFlySpeed(100, -1), 100);
  assert.equal(nextFlySpeed(5000, -1), 3000);
});

test('Frame: the first press frames, the same selection again comes closer and stays there', () => {
  assert.ok(FRAME_DISTANCES[1] < FRAME_DISTANCES[0]);
  assert.equal(frameStep(undefined, false), 0);
  assert.equal(frameStep(0, true), 1);
  assert.equal(frameStep(1, true), 1);
  assert.equal(frameStep(1, false), 0);
});

test("a flight: Frame goes straight, eased, its direction kept; the axis widget's goes round the pivot the short way", () => {
  const frame = { from: { pos: [0, 0, 0], yaw: 2, pitch: 0.1 }, to: { pos: [100, 0, -50] } };
  assert.deepEqual(flightPose(frame, 0), { pos: [0, 0, 0], yaw: 2, pitch: 0.1 });
  nearAll(flightPose(frame, 0.5).pos, [50, 0, -25]);
  nearAll(flightPose(frame, 1).pos, [100, 0, -50]);
  nearAll(flightPose(frame, 7).pos, [100, 0, -50]);
  assert.ok(flightPose(frame, 0.1).pos[0] < 10);                              // eased: slow at first
  const pivot = [0, 0, 0], start = { pos: [-600, 0, 0], yaw: 0, pitch: 0 };
  const top = VIEW_AXES.find((a) => a.id === '+Y');
  const look = { from: start, to: { yaw: top.yaw, pitch: top.pitch }, pivot };
  const end = flightPose(look, 1);
  near(end.pitch, -PITCH_LIMIT); near(end.yaw, -Math.PI / 2);
  near(dist(end.pos, pivot), 600);
  assert.ok(end.pos[1] > 590);                                                 // above it, looking down
  for (const u of [0.25, 0.5, 0.75]) {                                         // the pivot stays in the middle all along
    const p = flightPose(look, u);
    nearAll(inView(p.pos, p.yaw, p.pitch, pivot).slice(0, 2), [0, 0]);
  }
  const round = flightPose({ from: { pos: [0, 0, -600], yaw: 3, pitch: 0 }, to: { yaw: -3, pitch: 0 }, pivot }, 1);
  near(round.yaw, 2 * Math.PI - 3);                                            // 0.28 rad on, not 6 back
});

test('a pivot still counts while the view looks at it (about 9 degrees), not behind or aside', () => {
  assert.ok(looksAt([0, 0, 0], 0, 0, [500, 40, 0]));
  assert.ok(!looksAt([0, 0, 0], 0, 0, [500, 120, 0]));
  assert.ok(!looksAt([0, 0, 0], 0, 0, [-500, 0, 0]));
  assert.ok(!looksAt([0, 0, 0], 0, 0, [0, 0, 0]));
});

test("Settings > Camera's lens: 0 or nothing is the fallback (the game's field of view), the rest inside its limits", () => {
  assert.equal(cameraSetting('fov', 0, 86), 86);
  assert.equal(cameraSetting('fov', undefined, 75), 75);
  assert.equal(cameraSetting('fov', 95, 86), 95);
  assert.equal(cameraSetting('fov', 170, 86), CAMERA_SETTINGS.fov.max);
  assert.equal(cameraSetting('fov', 0, 30), CAMERA_SETTINGS.fov.min);
  assert.equal(cameraSetting('near', 0), 2);
  assert.equal(cameraSetting('near', 'x'), 2);
  assert.equal(cameraSetting('near', 500), 64);
  assert.equal(cameraSetting('far', 0), 120000);
  assert.equal(cameraSetting('far', 5), 20000);
  near(verticalFov(90, 1), 90);
  near(verticalFov(86, 16 / 9), 2 * Math.atan(Math.tan(43 * Math.PI / 180) * 9 / 16) * 180 / Math.PI);
});

test("Settings' defaults are the lens' own (menubar.js reads CAMERA_SETTINGS) and the fly slider's range is the wheel's", () => {
  const source = readFileSync(new URL('../editor/static/menubar.js', import.meta.url), 'utf8');
  assert.match(source, /near: CAMERA_SETTINGS\.near\.def, far: CAMERA_SETTINGS\.far\.def/);
  assert.match(source, new RegExp(`data-p="speed" min="${FLY_SPEEDS[0]}" max="${FLY_SPEEDS.at(-1)}" step="50"`));
  const from = source.indexOf('const DEFAULTS = {'), defaults = source.slice(from, source.indexOf('};', from) + 2);
  const d = vm.runInNewContext(defaults.replace('const DEFAULTS =', 'DEFAULTS =') + ';DEFAULTS',
    { CAMERA_SETTINGS });
  assert.deepEqual([d.fov, d.near, d.far], [0, 2, 120000]);
});

test('the axis widget: what faces the camera is drawn last, Y up the screen, the ends look as the panes do', () => {
  // looking along +X (yaw 0): X points away, Y up, Z to the right
  const flat = Object.fromEntries(axisLayout(0, 0).map((e) => [e.id, e]));
  near(flat['+X'].depth, 1); near(flat['+Y'].y, -1); near(flat['+Z'].x, 1);
  assert.equal(axisLayout(0, 0).at(-1).id, '-X');                            // the nearest on top
  assert.equal(axisLayout(0, 0)[0].id, '+X');
  // every end's view looks along minus its own direction (from that side toward the middle)
  for (const a of VIEW_AXES) assert.ok(-dot(lookDir(a.yaw, a.pitch), a.dir) > 0.99, a.id);
  // from above: X to the right, Z down the screen, as the Top pane (ortho-views.js)
  const top = VIEW_AXES.find((a) => a.id === '+Y'), seen = Object.fromEntries(axisLayout(top.yaw, top.pitch).map((e) => [e.id, e]));
  near(seen['+X'].x, 1); assert.ok(seen['+Z'].y > 0.99);
  assert.deepEqual(VIEW_AXES.map((a) => a.pane), ['side', 'side', 'top', 'top', 'front', 'front']);
});

test("the heading in the game's units: the yaw (65536 a turn) and the letter of the game's compass at the map's North", () => {
  assert.deepEqual(heading(0), { yaw: 0, compass: 'N' });
  assert.deepEqual(heading(Math.PI / 2), { yaw: 16384, compass: 'E' });
  assert.deepEqual(heading(-Math.PI / 2), { yaw: 49152, compass: 'W' });
  assert.deepEqual(heading(Math.PI / 4 + 4 * Math.PI), { yaw: 8192, compass: 'NE' });
  assert.deepEqual(heading(Math.PI / 2, 16384), { yaw: 16384, compass: 'N' });   // TrueNorth=16384: +Y is North
  assert.deepEqual(heading(0, 49152), { yaw: 0, compass: 'E' });
});
