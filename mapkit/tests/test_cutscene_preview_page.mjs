// app.js's own code for G32 (a cutscene's events previewed), run as it is on stand-ins: what an object is for the
// preview (previewTarget: a door's keys from its properties, an animated moving block's from its animation, an
// elevator, a lamp, a character's speeds, an animated object), the way a character walks (walkWay: the AI paths' route,
// straight on the walkable area), a lamp a preview has turned off (lampKind, setLampsOff), an object it has vanish kept
// hidden (applyObjectVisibility), the Animation panel's pose shared with it (motionPose, applyMotion, moverPose).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { moverFromProps } from '../editor/static/cutscene-preview.js';
import { findRoute, nearestPoint } from '../editor/static/ai-paths.js';
import { baseOf } from '../editor/static/prop-sets.js';

const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = (name) => {                     // a function of one line, or up to its closing brace
  const at = source.indexOf(`function ${name}(`), first = source.slice(at, source.indexOf('\n', at));
  assert.ok(at >= 0, name);
  return first.trimEnd().endsWith('}') ? first : source.slice(at, source.indexOf('\n}', at) + 2);
};
const constLine = (name) => {                // a const of one line (const isFill = ...), as a var of the context
  const at = source.indexOf(`const ${name} = `);
  assert.ok(at >= 0, name);
  return source.slice(at, source.indexOf('\n', at)).replace(/^const /, 'var ');
};
const plain = (v) => JSON.parse(JSON.stringify(v));
const vec = (x, y, z) => ({ x, y, z, copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }, setScalar(s) { this.x = this.y = this.z = s; } });
const MOTION = ['animComp', 'animCloses', 'animSlope', 'animValue', 'sampleTrack', 'animLinear', 'moverGlide', 'moverKeys', 'moverPose',
  'motionLength', 'motionPose', 'applyMotion', 'animIsMover'];

function page() {
  const proxy = (actor, at, more = {}) => ({ position: vec(...at), rotation: { x: 0, y: 0, z: 0 }, scale: vec(1, 1, 1), userData: { actor, ...more } });
  const door = proxy({ name: 'Door1', cls: 'DeusExMover', props: { 'KeyPos(1)': '(Y=-64.000000)', 'KeyRot(1)': '(Yaw=16384)', MoveTime: '2.0' } }, [0, 0, 0], { kind: 'mover' });
  const lift = proxy({ name: 'Lift2', cls: 'ElevatorMover', props: { NumKeys: '3' } }, [0, 0, 0], { kind: 'mover' });
  const lamp = proxy({ name: 'Light3', cls: 'Light', kind: 'light', props: {} }, [0, 0, 0], { kind: 'light' });
  const guard = proxy({ name: 'Guard4', cls: 'UNATCOTroop', kind: 'pawn', props: {}, height: 47.5 }, [10, 47.5, 20], { kind: 'pawn' });   // three's axes: y up
  guard.rotation.y = Math.PI / 2;
  const crate = proxy({ name: 'Crate5', cls: 'CrateUnbreakableSmall', props: {} }, [0, 0, 0], { kind: 'prop' });
  const block = { position: vec(0, 0, 0), rotation: { x: 0, y: 0, z: 0 }, scale: vec(64, 64, 8), userData: { box: { name: 'UCEditBox7', mover: true }, kind: 'box' } };
  const all = [door, lift, lamp, guard, crate, block];
  const c = vm.createContext({
    Math, moverFromProps, findRoute, nearestPoint, YAW: 65536,
    edits: { motions: {
      UCEditBox7: { pos: [{ t: 0, v: [0, 0, 0], e: 1 }, { t: 2, v: [0, 0, 160], e: 1 }], rot: [], scale: [], mode: 'once' },
      Crate5: { pos: [{ t: 0, v: [0, 0, 0], e: 0 }, { t: 4, v: [40, 0, 0], e: 0 }], rot: [], scale: [], mode: 'loop' },
    } },
    proxyOf: (name) => all.find((p) => p.userData.actor && p.userData.actor.name === name),
    objOf: (key) => all.find((p) => p.userData.box && 'b:' + p.userData.box.name === key) || null,
    actorProp: (a, key) => a.props[key], baseOf,
    // the class's values (keyValue: the Properties' field and its default)
    fieldOf: (a, prop) => {
      const value = ({ UNATCOTroop: { GroundSpeed: '200.000000', WalkingSpeed: '0.296000' }, Light: { LightType: 'LT_Steady' } }[a.cls] || {})[prop];
      return value === undefined ? null : { prop, default: [value] };
    },
    chainNow: { ElevatorMover: ['ElevatorMover', 'Mover'] },
    lkElevator: (a) => (a && a.cls === 'ElevatorMover' ? 'elevator' : ''),
    isCharacter: (a) => a.kind === 'pawn',
    liveLight: () => ({ b: 64 }), lampSeed: () => 7, lampsOff: new Set(), fxLamps: { at: 0 }, woke: 0, wake() { c.woke++; },
    UE: (v) => [v.x, v.z, v.y], T: (a) => vec(a[0], a[2], a[1]), radToYaw: (r) => Math.round(r * 65536 / (2 * Math.PI)), yawToRad: (y) => y * 2 * Math.PI / 65536,
    pathData: null,
    // the visibility of the objects
    proxies: { children: all }, keyOf: () => 'a:x', objectHidden: () => false, isIcon: () => false, structures: {}, selected: null,
    sceneObjects: () => [], objectEyeOff: () => false, vpBar: null,
    // a hole the Rebuild has cut (holeTucked): as the last build has it
    builtBoxes: new Map(), boxSig: (b) => JSON.stringify([b.lo, b.hi]), groupPivot: { userData: {} }, selectionLocked: () => false, selectionHidden: () => false,
  });
  vm.runInContext([...MOTION, 'keyValue', 'previewTarget', 'walkWay', 'builtValue', 'lampType', 'lampSkin', 'lampKind', 'setLampsOff', 'holeTucked', 'applyObjectVisibility'].map(body).join('\n')
    + '\n' + constLine('isFill'), c);
  return { c, door, lift, lamp, guard, crate, block };
}

test('previewTarget: a door\'s keys from its properties, an elevator, a lamp, a character\'s speeds, an animated object', () => {
  const { c, door } = page();
  const d = c.previewTarget('Door1');
  assert.equal(d.p, door);
  assert.deepEqual(plain(d.mover.keys), [{ pos: [0, 0, 0], rot: [0, 0, 0] }, { pos: [0, -64, 0], rot: [0, 16384, 0] }]);
  assert.deepEqual(plain(d.mover.seg), [2]);
  assert.equal(d.elevator, false);
  assert.equal(d.motion, undefined);
  assert.equal(c.previewTarget('Lift2').elevator, true);
  assert.equal(c.previewTarget('Lift2').mover.keys.length, 3);
  assert.deepEqual(plain(c.previewTarget('Light3').light), { on: true });
  const g = c.previewTarget('Guard4').walker;
  assert.deepEqual(plain(g.from), [10, 20, 47.5]);
  assert.equal(g.yaw, 16384);
  assert.ok(Math.abs(g.walk - 200 * 0.296) < 1e-9, 'GroundSpeed x WalkingSpeed');
  assert.equal(g.run, 200);
  assert.equal(g.height, 47.5);
  const crate = c.previewTarget('Crate5');
  assert.deepEqual({ len: crate.motion.len, mode: crate.motion.mode }, { len: 4, mode: 'loop' });
  assert.equal(crate.mover, undefined);
  assert.equal(c.previewTarget('Nobody'), null);
});

test('an animated moving block moves through its animation\'s keys, each step its own time', () => {
  const { c, block } = page();
  const b = c.previewTarget('UCEditBox7');
  assert.equal(b.p, block);
  assert.deepEqual(plain(b.mover.keys), [{ pos: [0, 0, 0], rot: [0, 0, 0] }, { pos: [0, 0, 160], rot: [0, 0, 0] }]);
  assert.deepEqual(plain(b.mover.seg), [2]);
  assert.equal(b.mover.at, 0); assert.equal(b.mover.glide, true); assert.equal(b.mover.stay, null);
  // the Animation panel's pose of it, the same keys
  assert.deepEqual(plain(c.motionPose(c.edits.motions.UCEditBox7, 1, true)), { pos: [0, 0, 80], rot: [0, 0, 0], scale: 1 });
  assert.deepEqual(plain(c.motionPose(c.edits.motions.Crate5, 1, false).pos), [10, 0, 0]);
  // put there from where it stands, its size kept (a mover)
  c.applyMotion(block, { pos: [100, 0, 0], yaw: 0, scale: 1 }, { pos: [0, 0, 80], rot: [0, 16384, 0], scale: 1 }, true);
  assert.deepEqual([block.position.x, block.position.y, block.position.z], [100, 80, 0]);
  assert.ok(Math.abs(block.rotation.y - Math.PI / 2) < 1e-9);
  assert.equal(block.scale.x, 64);
});

test('walkWay: along the AI paths of the last rebuild, at the height it has above the first node; straight on the walkable area or with none', () => {
  const { c } = page();
  assert.deepEqual(plain(c.walkWay([0, 0, 48], [500, 0, 48], false)), [[0, 0, 48], [500, 0, 48]], 'no AI paths known');
  c.pathData = { points: { A: ['PathNode', 10, 0, 40], B: ['PathNode', 200, 300, 40], C: ['PathNode', 480, 0, 40] },
    links: [['A', 'B', 1], ['B', 'C', 1]] };
  assert.deepEqual(plain(c.walkWay([0, 0, 48], [500, 0, 48], false)), [[0, 0, 48], [10, 0, 48], [200, 300, 48], [480, 0, 48], [500, 0, 48]]);
  assert.deepEqual(plain(c.walkWay([0, 0, 48], [500, 0, 48], true)), [[0, 0, 48], [500, 0, 48]], 'on the walkable area');
  assert.deepEqual(plain(c.walkWay([200, 300, 48], [210, 310, 48], false)), [[200, 300, 48], [210, 310, 48]], 'the same node at both ends');
});

test('a lamp a cutscene\'s preview turns off: off for View > Effects, picked again at once; on again when it ends', () => {
  const { c, lamp } = page();
  assert.equal(c.lampKind(lamp.userData.actor).off, false);
  c.fxLamps.at = 1234;
  c.setLampsOff(['Light3']);
  assert.equal(c.lampKind(lamp.userData.actor).off, true);
  assert.equal(c.fxLamps.at, -Infinity);
  assert.equal(c.woke, 1);
  c.setLampsOff([]);
  assert.equal(c.lampKind(lamp.userData.actor).off, false);
});

// startPreview and stopPreview (the walk a cutscene's preview shows): each character with its model, its animations read
// at once or when the test says (slow), their frames too (slowFrames)
function walkPage(slow = [], slowFrames = []) {
  const character = (name) => ({ parent: {}, kids: [], userData: { actor: { name, cls: name }, model: { visible: true } },
    add(x) { this.kids.push(x); }, remove(x) { this.kids = this.kids.filter((k) => k !== x); } });
  const waiting = {};
  const anims = (cls) => ({ cls, seqs: [{ name: 'Walk', start: 0, frames: 8, rate: 10 }] });
  const later = (cls, value) => new Promise((resolve) => { waiting[cls] = () => resolve(value); });
  const c = vm.createContext({
    document: { querySelectorAll: () => [] }, log() {}, meshOf: () => 'mesh', poseModel() {},
    animFrames: (info) => (slowFrames.includes(info.cls) ? later(info.cls, {}) : Promise.resolve({})),
    animsOf: (cls) => (slow.includes(cls) ? later(cls, anims(cls)) : Promise.resolve(anims(cls))),
    animatedModel: (g) => ({ children: [1], of: g.userData.actor.name }),
    fitAnimated: (g) => { g.userData.model.visible = false; },
  });
  const line = (start) => { const at = source.indexOf(start); assert.ok(at >= 0, start); return source.slice(at, source.indexOf('\n', at)); };
  vm.runInContext([line('let previewing = null;'), line('let previewSerial = 0;'), body('stopPreview'), 'async ' + body('startPreview')].join('\n'), c);
  return { c, A: character('GuardA'), B: character('GuardB'), resolve: (cls) => waiting[cls](), previewing: () => vm.runInContext('previewing', c) };
}

test('a walk asked for while another character\'s still loads: only the last one shows, the first leaves its model as it is', async () => {
  const { c, A, B, resolve, previewing } = walkPage(['GuardA']);
  const first = c.startPreview(A, 'GuardA', 'Walk');              // its animations not read yet
  const second = c.startPreview(B, 'GuardB', 'Walk');             // read already: it shows first
  assert.equal(await second, true);
  resolve('GuardA');
  assert.equal(await first, false);
  assert.equal(previewing().g, B);
  assert.deepEqual([A.kids.length, A.userData.model.visible], [0, true]);
  assert.deepEqual([B.kids.length, B.userData.model.visible], [1, false]);
  c.stopPreview();                                                // the walk ends: B as it was
  assert.deepEqual([B.kids.length, B.userData.model.visible], [0, true]);
});

test('a walk asked for while another character\'s animation frames still load: only the last one shows (batch 6 gap #4)', async () => {
  const { c, A, B, resolve, previewing } = walkPage([], ['GuardA']);
  const first = c.startPreview(A, 'GuardA', 'Walk');
  await new Promise((done) => setImmediate(done));                // its animations read: it waits for their frames
  const second = c.startPreview(B, 'GuardB', 'Walk');
  assert.equal(await second, true);
  resolve('GuardA');
  assert.equal(await first, false);
  assert.equal(previewing().g, B);
  assert.deepEqual([A.kids.length, A.userData.model.visible], [0, true]);
  assert.deepEqual([B.kids.length, B.userData.model.visible], [1, false]);
});

test('a walk stopped while its animations load never shows', async () => {
  const { c, A, resolve, previewing } = walkPage(['GuardA']);
  const going = c.startPreview(A, 'GuardA', 'Walk');
  c.stopPreview();
  resolve('GuardA');
  assert.equal(await going, false);
  assert.equal(previewing(), null);
  assert.deepEqual([A.kids.length, A.userData.model.visible], [0, true]);
});

test('an object a cutscene\'s preview has vanish stays hidden when the objects are shown again; then back', () => {
  const { c, crate, door } = page();
  crate.userData.cutHidden = true;
  c.applyObjectVisibility();
  assert.equal(crate.visible, false);
  assert.equal(door.visible, true);
  delete crate.userData.cutHidden;
  c.applyObjectVisibility();
  assert.equal(crate.visible, true);
});

// Gabby, 14 Nov 2026: once the Rebuild has cut the wall, the hole's box goes from the 3D view; selected, it shows
test('a hole the Rebuild has cut is hidden, shown while selected, and shown again once moved', () => {
  const { c } = page();
  const box = { name: 'UCEditBox9', hole: true, lo: [0, 0, 0], hi: [64, 64, 112] };
  const hole = { position: vec(0, 0, 0), scale: vec(64, 112, 64), userData: { box, kind: 'box' } };
  c.proxies.children.push(hole);
  c.applyObjectVisibility();
  assert.equal(hole.visible, true);                    // not built yet: the red box shows where it will cut
  c.builtBoxes.set(box.name, c.boxSig(box));
  c.applyObjectVisibility();
  assert.deepEqual([hole.visible, hole.userData.tucked], [false, true]);
  c.selected = hole;
  c.applyObjectVisibility();
  assert.equal(hole.visible, true);                    // picked in the Hierarchy
  c.selected = null;
  box.hi = [64, 64, 128];                              // made taller: shown until the next Rebuild
  c.applyObjectVisibility();
  assert.equal(hole.visible, true);
});

test('a Fill block the Rebuild has built is hidden as a hole is; a solid block is not', () => {
  const { c } = page();
  const fill = { name: 'UCEditBox8', solid: true, fill: true, lo: [0, 0, 0], hi: [16, 64, 112] };
  const wall = { name: 'UCEditBox7', solid: true, lo: [0, 0, 0], hi: [16, 256, 256] };
  const pf = { position: vec(0, 0, 0), scale: vec(16, 112, 64), userData: { box: fill, kind: 'box' } };
  const pw = { position: vec(0, 0, 0), scale: vec(16, 256, 256), userData: { box: wall, kind: 'box' } };
  c.proxies.children.push(pf, pw);
  c.builtBoxes.set(fill.name, c.boxSig(fill));
  c.builtBoxes.set(wall.name, c.boxSig(wall));
  c.applyObjectVisibility();
  assert.deepEqual([pf.visible, pf.userData.tucked, pw.visible], [false, true, true]);
  fill.solid = false;                                  // made a detail block: no Fill block any more
  c.applyObjectVisibility();
  assert.equal(pf.visible, true);
});
