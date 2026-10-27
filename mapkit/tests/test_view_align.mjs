// The selection and the 3D view's camera (static/view-align.js): the view as a rotation of the game, a character's
// eyes, what tips and what stays standing, the whole selection carried with the object that goes to the view, and
// looking through an object (Align with view, Move to view, Align view to selected, Pilot).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { THREE, noThree } from './three.mjs';
import { TURN, viewRotation, viewPitch, EYE_SHARE, eyeHeight, alignedRotation, sameRotation, turnsPart, planStays, SAME_PLACE, carryParts,
  alignPlan, lookThrough } from '../editor/static/view-align.js';
import { PITCH_LIMIT } from '../editor/static/view-camera.js';

const Q = TURN / 4;                     // a quarter turn
const near = (a, b, msg) => a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < 1e-6, `${msg}: ${a} vs ${b}`));

test('the view as a rotation of the game: its yaw on one turn, its pitch either way, no roll', () => {
  assert.deepEqual(viewRotation(Math.PI / 2, 0), [0, Q, 0]);
  assert.deepEqual(viewRotation(-Math.PI / 2, -Math.PI / 4), [-Q / 2, 3 * Q, 0]);       // down and to the right
  assert.deepEqual(viewRotation(5 * Math.PI, 0.25), [Math.round(0.25 * TURN / (2 * Math.PI)), 2 * Q, 0]);   // turned round twice and a half
});

test("an object's pitch as the camera's: up is up, straight up or down stops where the mouse look stops", () => {
  assert.ok(Math.abs(viewPitch(Q / 2) - Math.PI / 4) < 1e-9);
  assert.equal(viewPitch(Q), PITCH_LIMIT);
  assert.equal(viewPitch(-Q), -PITCH_LIMIT);
  assert.equal(viewPitch(3 * Q), -PITCH_LIMIT);          // 49152 is a quarter turn down
  assert.ok(Math.abs(viewPitch(TURN - 2048) + 2048 * 2 * Math.PI / TURN) < 1e-9);
});

test("a character's eyes: its BaseEyeHeight, else 0.8 of its CollisionHeight (the engine's), else its middle", () => {
  assert.equal(eyeHeight(47.5, 40), 40);
  assert.equal(eyeHeight(47.5, undefined), EYE_SHARE * 47.5);
  assert.equal(eyeHeight('43', '0'), 0.8 * 43);           // values as the map keeps them, 0 = none set
  assert.equal(eyeHeight(undefined, undefined), 0);
});

test('what tips takes the whole view, roll 0 included; the rest turns about the vertical and stays as it stands', () => {
  const view = [-3000, 20000, 0], now = [1200, 5, 900];
  assert.deepEqual(alignedRotation(now, view, true), [-3000, 20000, 0]);
  assert.deepEqual(alignedRotation(now, view, false), [1200, 20000, 900]);
  assert.deepEqual(alignedRotation([], view, false), [0, 20000, 0]);
});

test('two rotations alike when they are whole turns apart', () => {
  assert.ok(sameRotation([0, -Q, 0], [TURN, 3 * Q, 0]));
  assert.ok(sameRotation([0, 0, 0], []));
  assert.ok(!sameRotation([1, 0, 0], [0, 0, 0]));
});

test('a plan that leaves the parts as they are: within a hundredth of a unit, not turned (what cannot turn only moves)', () => {
  const parts = [{ at: [100, 200, 300], rot: [0, Q, 0] }, { at: [0, 0, 0], rot: [0, 0, 0], fixed: true }];
  assert.ok(planStays(parts, [{ at: [100.004, 199.996, 300], rot: [0, Q - TURN, 0] }, { at: [0, 0, 0], rot: [0, Q, 0] }]));
  assert.ok(!planStays(parts, [{ at: [100 + SAME_PLACE, 200, 300], rot: [0, Q, 0] }, { at: [0, 0, 0], rot: [0, 0, 0] }]));
  assert.ok(!planStays(parts, [{ at: [100, 200, 300], rot: [1, Q, 0] }, { at: [0, 0, 0], rot: [0, 0, 0] }]));
  assert.equal(turnsPart(parts[0], [0, 2 * Q, 0]), true);
  assert.equal(turnsPart(parts[1], [0, 2 * Q, 0]), false);         // a structure with doors moves but does not turn
});

test('the selection is carried as one: the others keep their place about the lead, turned with it about the vertical', () => {
  const parts = [{ at: [100, 0, 50], rot: [0, 0, 0] }, { at: [164, 0, 30], rot: [500, 1000, 200] }, { at: [100, -32, 50], rot: [0, TURN - 100, 0] }];
  const plan = carryParts(parts, 0, { at: [0, 0, 200], rot: [-2000, Q, 0] });
  assert.deepEqual(plan[0], { at: [0, 0, 200], rot: [-2000, Q, 0] });
  near(plan[1].at, [0, 64, 180], 'the one in front of it is in front of it still');
  assert.deepEqual(plan[1].rot, [500, Q + 1000, 200]);         // its yaw turned as much, its pitch and roll kept
  near(plan[2].at, [32, 0, 200], 'the one at its left (the game\'s Y is to the right) is at its left still');
  assert.deepEqual(plan[2].rot, [0, Q - 100, 0]);
  assert.deepEqual(parts[1].at, [164, 0, 30]);                  // the parts given are left as they were
});

test('a turn the other way round the circle (from 65000 to 100) is a small one', () => {
  const plan = carryParts([{ at: [0, 0, 0], rot: [0, 65000, 0] }, { at: [10, 0, 0], rot: [0, 64000, 0] }], 0, { at: [0, 0, 0], rot: [0, 100, 0] });
  const turned = (636 / TURN) * 2 * Math.PI;
  near(plan[1].at, [10 * Math.cos(turned), 10 * Math.sin(turned), 0], 'about 3.5 degrees');
  assert.equal(plan[1].rot[1], 64636);
});

test('Align with view: a character goes with its eyes where the camera is, a camera takes the whole view', () => {
  const view = { at: [500, 600, 700], rot: viewRotation(Math.PI, -0.3) };
  const guard = alignPlan([{ at: [0, 0, 0], rot: [0, 1234, 0] }], 0, view, { eye: 40 });
  assert.deepEqual(guard[0], { at: [500, 600, 660], rot: [0, 2 * Q, 0] });
  const camera = alignPlan([{ at: [0, 0, 0], rot: [100, 1234, 300] }], 0, view, { tilts: true });
  assert.deepEqual(camera[0], { at: [500, 600, 700], rot: view.rot });
});

test('looking through what was aligned with the view gives the view back', () => {
  const yaw = 2.2, pitch = -0.4, view = { at: [10, -20, 300], rot: viewRotation(yaw, pitch) };
  const [placed] = alignPlan([{ at: [0, 0, 0], rot: [0, 0, 0] }], 0, view, { eye: 38, tilts: true });
  const back = lookThrough(placed.at, placed.rot, 38);
  assert.deepEqual(back.at, view.at);
  assert.equal(back.yaw, Math.round(yaw * TURN / (2 * Math.PI)));
  assert.ok(Math.abs(back.pitch - pitch) < 2 * Math.PI / TURN);
  assert.deepEqual(lookThrough([1, 2, 3], [], 0), { at: [1, 2, 3], yaw: 0, pitch: 0 });
});

// ---- Pilot in the page (static/app.js, its functions and its key handler run as they are)
const app = readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
const body = (name) => { const i = app.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return app.slice(i, app.indexOf('\n}', i) + 2); };
const lineOf = (start) => { const i = app.indexOf(start); assert.ok(i >= 0, start); return app.slice(i, app.indexOf('\n', i)); };
// the keys of the 3D view, from the flying keys to the end of the handler
const keys = (() => {
  const i = app.indexOf('const MOVE = {'), j = app.indexOf("$('#lightmode').onchange", i);
  assert.ok(i >= 0 && j > i, 'the keydown handler');
  return app.slice(i, j);
})();
function pilotPage() {
  // three's TransformControls as r160 has them: attach shows it on an object, detach hides it and drops it
  const tc = { enabled: true, visible: false, object: undefined, attach(o) { this.object = o; this.visible = true; },
    detach() { this.object = undefined; this.visible = false; } };
  const lamp = { visible: true, parent: {} }, view = () => ({ pos: new THREE.Vector3(), yaw: 0, pitch: 0 });
  const c = vm.createContext({ THREE, tc, lamp, camera: { position: new THREE.Vector3() }, cam: { yaw: 0, pitch: 0, look: false, keys: { w: false, shift: false } },
    selected: lamp, mapGeneration: 1, pilot: null, flight: null, drag: null, vpBar: null, undos: 0, ended: [],
    script: 'fixture', gameView: null, projectHub: null, document: { querySelector: () => null }, textureTransfer: null, propertySlider: null, inspectorDrag: null,
    window: { addEventListener: (type, fn) => { if (type === 'keydown') c.keydown = fn; } },
    status: (t) => c.ended.push(t), viewLabel: () => 'Lamp', wake() {}, pushUndo: () => c.undos++, applyObjectVisibility() {}, placeParts() {}, writeParts() {}, viewPlan: () => [], putBack() {} });
  vm.runInContext([lineOf('const viewMoved ='), body('stepPilot'), body('endPilot'), body('resetInput'), keys].join('\n'), c);
  // as togglePilot leaves it: the lead looked through, the gizmo off
  c.fly = () => { tc.attach(lamp); c.pilot = { parts: [{ p: lamp }], lead: 0, selected: lamp, generation: 1, back: view(), start: view(), keep: null }; tc.enabled = tc.visible = false; };
  return c;
}
const key = (key, code, shiftKey = false) => ({ key, code, shiftKey, ctrlKey: false, altKey: false, target: { tagName: 'CANVAS' }, preventDefault() {} });

test('a pilot ended on an empty selection leaves no gizmo drawn; on the same object it comes back', { skip: noThree }, () => {
  const c = pilotPage();
  c.fly();
  c.selected = null; c.tc.detach();                     // a click on empty space during the pilot
  c.stepPilot();                                         // the next frame ends it
  assert.equal(c.pilot, null);
  assert.deepEqual([c.tc.enabled, c.tc.visible, c.tc.object], [true, false, undefined]);
  c.selected = c.lamp; c.fly();
  c.pilot.start.yaw = 1;                                 // the view moved: it is written
  c.stepPilot();
  assert.equal(c.tc.visible, false);
  c.endPilot();
  assert.deepEqual([c.tc.enabled, c.tc.visible, c.tc.object], [true, true, c.lamp]);
  assert.equal(c.undos, 1);
});

test('picking the piloted object again keeps the gizmo off while the pilot goes on', { skip: noThree }, () => {
  const c = pilotPage();
  c.fly();
  c.tc.attach(c.lamp);                                   // select() of the same object, from the Hierarchy
  c.stepPilot();
  assert.ok(c.pilot);
  assert.equal(c.tc.visible, false);
  assert.equal(c.lamp.visible, false);                   // the view is inside it
});

test('Esc or Shift+P ends a pilot while flying (the right button held); the flying keys still fly', { skip: noThree }, () => {
  for (const press of [key('Escape', 'Escape'), key('P', 'KeyP', true)]) {
    const c = pilotPage();
    c.fly();
    c.cam.look = true;
    c.keydown(key('w', 'KeyW'));
    assert.equal(c.cam.keys.w, true);
    assert.ok(c.pilot);
    c.keydown(press);
    assert.equal(c.pilot, null, press.key);
    assert.deepEqual([c.cam.look, c.cam.keys.w], [false, false]);       // the view went back: it no longer flies on
  }
  const c = pilotPage();
  c.cam.look = true;
  c.keydown(key('Escape', 'Escape'));                    // no pilot: Esc while flying does nothing
  assert.equal(c.cam.look, true);
  c.keydown(key('P', 'KeyP', true));
  assert.equal(c.ended.length, 0);
});

test('Align with view and Move to view, the selection already there: a status line, no Ctrl+Z step', { skip: noThree }, async () => {
  const lamp = { position: new THREE.Vector3(100, 300, 200), userData: {} }, done = [];
  const v = { parts: [{ p: lamp, at: [100, 200, 300], rot: [0, Q, 0] }], lead: 0, keep: null };
  const c = vm.createContext({ THREE, planStays, SAME_PLACE, VIEW_REACH: 4000, VIEW_AHEAD: 400, lamp, selected: lamp, groupPivot: {}, camera: { position: new THREE.Vector3() },
    viewParts: async () => v, viewPlan: () => c.plan, viewLabel: () => 'Lamp', objectLabel: () => ['Lamp'], requireUnlocked: () => true,
    selectionParts: () => ({ list: [lamp], ignored: new Set() }), forward: () => new THREE.Vector3(0, 0, -1), surfaceHit: () => null, restOffset: () => c.shift,
    partNow: (p) => ({ p, from: p.position.clone(), rot: [0, Q, 0] }), UE: (q) => [q.x, q.z, q.y], selKeys: () => [], gridSnap: () => false,
    pushUndo: () => done.push('undo'), placeParts: () => done.push('place'), writeParts: () => done.push('write'), status: (t) => done.push(t) });
  vm.runInContext(['async ' + body('alignWithView'), body('moveToView')].join('\n'), c);
  c.plan = [{ at: [100, 200, 300], rot: [0, Q, 0] }];
  await c.alignWithView();
  c.shift = new THREE.Vector3(0.004, 0, 0);
  c.moveToView();
  assert.deepEqual(done, ['Lamp: already where the view looks from, nothing changed.', 'Lamp: already where the view looks, nothing changed.']);
  done.length = 0;
  c.plan = [{ at: [100, 200, 300], rot: [0, 2 * Q, 0] }];             // turned another way: one Ctrl+Z
  await c.alignWithView();
  c.shift = new THREE.Vector3(0, 0, 16);
  c.moveToView();
  assert.deepEqual(done.filter((x) => !x.includes(' ')), ['undo', 'place', 'write', 'undo', 'place', 'write']);
});

test("the four commands are the menu bar's, so they can be changed, and their keys are no other shortcut's", () => {
  const source = readFileSync(new URL('../editor/static/menubar.js', import.meta.url), 'utf8');
  const from = source.indexOf('const ACTIONS = [');
  const actions = vm.runInNewContext(source.slice(from, source.indexOf('\n];', from) + 3).replace('const ACTIONS =', 'ACTIONS ='), {});
  const key = Object.fromEntries(actions.map(([id, , def]) => [id, def]));
  assert.deepEqual(['alignview', 'movetoview', 'viewtoselected', 'pilot'].map((id) => key[id]), ['Ctrl+Shift+F', 'Ctrl+Alt+F', 'Shift+F', 'Shift+P']);
  for (const ctx of new Set(actions.map((a) => a[3]))) {
    const keys = actions.filter((a) => a[3] === ctx).map((a) => a[2]);
    for (const id of ['alignview', 'movetoview', 'viewtoselected', 'pilot'])
      if (actions.find((a) => a[0] === id)[3] === ctx) assert.equal(keys.filter((k) => k === key[id]).length, 1, `${key[id]} twice in ${ctx}`);
  }
});
