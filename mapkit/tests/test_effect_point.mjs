// The Effect point (editor/static/effect-point.js: gizmo, preview, preview settings) and Drop to floor /
// Stick to surface (editor/static/surface-stick.js: the maths). Run with Node, the editor's Three.js, no WebGL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { THREE, threeURL } from './three.mjs';   // without three.js 0.160.0 every test here is skipped
import { PLACE_MODES, loadPlaceMode, savePlaceMode, placeModeLabel, normalToRotation, rotationToVector, stickPoint,
  isFloor, signedRot } from '../editor/static/surface-stick.js';

const source = (await readFile(new URL('../editor/static/effect-point.js', import.meta.url), 'utf8'))
  .replace("from 'three'", `from '${threeURL}'`);
const fx = THREE ? await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`) : null;

const near = (a, b, eps = 2) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('the two placing modes, remembered per browser', () => {
  assert.deepEqual(PLACE_MODES.map((m) => m[0]), ['drop', 'stick']);
  assert.equal(placeModeLabel('stick'), 'Stick to surface');
  assert.equal(placeModeLabel('x'), 'Drop to floor');
  const store = new Map(), storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(loadPlaceMode(storage), 'drop');
  savePlaceMode(storage, 'stick');
  assert.equal(loadPlaceMode(storage), 'stick');
  savePlaceMode(storage, 'nonsense');
  assert.equal(loadPlaceMode(storage), 'drop');
  assert.equal(loadPlaceMode({ getItem() { throw new Error('blocked'); } }), 'drop');
  assert.equal(loadPlaceMode(null), 'drop');
});

test('a surface normal gives the rotation whose front points out of it', () => {
  assert.deepEqual(normalToRotation([1, 0, 0]), { pitch: 0, yaw: 0 });
  assert.deepEqual(normalToRotation([0, 1, 0]), { pitch: 0, yaw: 16384 });
  assert.deepEqual(normalToRotation([0, -1, 0]), { pitch: 0, yaw: 49152 });     // a north wall: facing south
  assert.deepEqual(normalToRotation([-1, 0, 0]), { pitch: 0, yaw: 32768 });
  assert.deepEqual(normalToRotation([0, 0, 1], 1234), { pitch: 16384, yaw: 1234 });   // a floor: its yaw stays
  assert.deepEqual(normalToRotation([0, 0, -1], 70000), { pitch: -16384, yaw: 4464 });
  const r = normalToRotation([1, 1, Math.SQRT2]);                                     // 45 deg up, north-east
  near(r.pitch, 8192); near(r.yaw, 8192);
  for (const n of [[0.3, -0.8, 0.52], [-0.6, 0.1, -0.79], [0, 1, 0]]) {             // and back again
    const len = Math.hypot(...n), v = rotationToVector(...Object.values(normalToRotation(n)));
    n.forEach((c, k) => near(v[k], c / len, 1e-3));
  }
  assert.equal(signedRot(65000), -536);
  assert.equal(signedRot(-70000), -4464);
});

test('the pivot goes out of the surface by the depth of its back', () => {
  assert.deepEqual(stickPoint([0, 522, 50], [0, -1, 0], 4.2), [0, 517.3, 50]);
  assert.deepEqual(stickPoint([10, 0, 0], [0, 0, 2], 0, 1), [10, 0, 1]);           // the normal need not be unit
  assert.deepEqual(stickPoint([0, 0, 0], [1, 0, 0], -5), [0.5, 0, 0]);            // never inside it
  assert.equal(isFloor([0, 0, 1]), true);
  assert.equal(isFloor([0.9, 0, 0.3]), false);
  assert.equal(isFloor([0, 0, -1]), false);
});

test('preview settings and the kind its interactions give', () => {
  assert.equal(fx.isEffectPoint({ cls: 'UCEffectPoint' }), true);
  assert.equal(fx.isEffectPoint({ cls: 'DeusEdix.UCEffectPoint' }), true);
  assert.equal(fx.isEffectPoint({ cls: 'UCEffect' }), false);
  assert.equal(fx.isEffectPoint(null), false);
  const links = [{ do: [{ verb: 'effect', target: 'P1', a: 'off' }, { verb: 'open', target: 'P1' }] },
                 { do: [{ verb: 'effect', target: 'P1', a: 'sparks' }, { verb: 'effect', target: 'P2', a: 'pulse', c: 'green beep' }] }];
  assert.deepEqual(fx.fxEffectsOn(links, 'P1'), [{ kind: 'sparks', colour: 'red' }]);
  assert.deepEqual(fx.fxEffectsOn(links, 'P2'), [{ kind: 'pulse', colour: 'green' }]);
  assert.deepEqual(fx.fxPreviewOf({}, 'P1'), { kind: 'auto', always: false });
  assert.deepEqual(fx.fxPreviewOf({ fxpreview: { P1: { kind: 'lava', always: 1 } } }, 'P1'), { kind: 'auto', always: true });
  assert.equal(fx.fxPreviewKind({ links }, 'P1'), 'sparks');                       // auto: its interactions
  assert.equal(fx.fxPreviewKind({ links }, 'P2'), 'light');
  assert.equal(fx.fxPreviewKind({ links }, 'P3'), 'mist');                         // none yet: mist
  assert.equal(fx.fxPreviewKind({ links, fxpreview: { P1: { kind: 'fire' } } }, 'P1'), 'fire');
  assert.equal(fx.fxPreviewKind({ fxpreview: { P1: { kind: 'none' } } }, 'P1'), 'none');
});

test('the gizmo: one big orange arrow along +X, small ones for the other axes; the preview flows along it', () => {
  const g = fx.createEffectPointGizmo();
  assert.equal(g.userData.fxGizmo, true);
  const arrows = g.children.filter((c) => c.isGroup);
  const len = (a) => { const b = new THREE.Box3().setFromObject(a), s = new THREE.Vector3(); b.getSize(s); return Math.max(s.x, s.y, s.z); };
  const big = arrows.filter((a) => a.children[0].material.color.getHex() === 0xff7a1a);
  const small = arrows.filter((a) => a.children[0].material.color.getHex() !== 0xff7a1a);
  assert.ok(big.length >= 1 && small.length === 2);
  for (const s of small) assert.ok(len(big[0]) > 3 * len(s), 'the effect arrow is much bigger');
  g.updateMatrixWorld(true);
  const tip = new THREE.Box3().setFromObject(big[0]);
  assert.ok(tip.max.x > 70 && Math.abs(tip.max.y) < 15 && Math.abs(tip.max.z) < 15, 'it points along +X');
  fx.setEffectPointTilt(g, Math.PI / 2);                                          // pitch 90: straight up
  g.updateMatrixWorld(true);
  assert.ok(new THREE.Box3().setFromObject(big[0]).max.y > 70);
  fx.setEffectPointTilt(g, 0);

  // the preview: needs a 2D canvas for its soft puff
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, set fillStyle(v) {} }) }) };
  const proxy = new THREE.Group(), root = new THREE.Group();
  proxy.add(g); proxy.userData.fxGizmo = g; proxy.visible = true; root.add(proxy);
  let want = { kind: 'mist', colour: 'red' };
  fx.stepEffectPreviews(root, 0.5, () => want);
  assert.equal(fx.effectPreviewsActive(), true);
  const pv = g.children.find((c) => c.userData.fxPreview);
  assert.equal(pv.userData.fxPreview, 'mist');
  fx.stepEffectPreviews(root, 0.7, () => want);
  const xs = pv.children.map((s) => s.position.x);
  assert.ok(xs.every((x) => x >= 0) && Math.max(...xs) > 50, 'the puffs move out along the arrow');
  want = { kind: 'fire', colour: 'red' };
  fx.stepEffectPreviews(root, 0.1, () => want);
  assert.equal(g.children.filter((c) => c.userData.fxPreview).map((c) => c.userData.fxPreview).join(), 'fire');
  fx.stepEffectPreviews(root, 0.1, () => null);
  assert.equal(fx.effectPreviewsActive(), false);
  assert.equal(g.children.some((c) => c.userData.fxPreview), false);
  fx.disposeEffectPoint(proxy);
});
