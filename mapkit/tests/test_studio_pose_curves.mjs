// Exercise the actual Studio evaluator and bake with its production Three.js version.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Override with a local Three.js 0.160.0 ESM file on another checkout. Tests never
// download dependencies, start WebGL, or write animation/game packages.
const threeFile = process.env.DEUSEDIX_THREE_MODULE || path.resolve(kit, '../research/rea-blender/three.module.mjs');
const three = pathToFileURL(path.resolve(threeFile)).href;
const modules = path.join(kit, 'editor/static');
const stub = (name) => 'data:text/javascript,' + encodeURIComponent(`export class ${name} {}`);
// The page's import map, for the Studio and the modules it imports (studio-props.js uses three as well): a
// module that names three, or one of the page's modules, is rewritten; the others load as they are.
const loaded = new Map();
async function moduleUrl(file) {
  if (loaded.has(file)) return loaded.get(file);
  let text = await readFile(file, 'utf8');
  if (!/from '(three|\.\/)/.test(text)) { loaded.set(file, pathToFileURL(file).href); return loaded.get(file); }
  text = text.replaceAll("from 'three'", `from '${three}'`)
    .replaceAll("from 'three/addons/controls/OrbitControls.js'", `from '${stub('OrbitControls')}'`)
    .replaceAll("from 'three/addons/controls/TransformControls.js'", `from '${stub('TransformControls')}'`);
  for (const rel of new Set([...text.matchAll(/from '(\.\/[^']+)'/g)].map(m => m[1])))
    text = text.split(`from '${rel}'`).join(`from '${await moduleUrl(path.resolve(path.dirname(file), rel))}'`);
  loaded.set(file, 'data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
  return loaded.get(file);
}
async function loadStudio(file) {
  globalThis.window = {};
  await import(await moduleUrl(file));
  return window.__studio;
}
const current = await loadStudio(path.join(modules, 'studio.js'));
const { THREE, BI, BONES, restPose, keyOf, curvesFromMotion, rotationValues, bakeOn } = current.kit;
assert.equal(THREE.REVISION, '160', 'Use the application\'s Three.js 0.160.0 module for regression tests');
function animation(source = 'made', interp = 'smooth', loop = true) {
  const keys = [0, 7, 19, 29].map((f, i) => {
    const p = restPose();
    p.rot[BI.head].setFromEuler(new THREE.Euler((i - 1) * 0.6, i * 0.8, 2.8 + i * 0.2));
    p.rot[BI.l_upperarm].setFromEuler(new THREE.Euler(i * 0.3, -i * 0.5, 0.2));
    p.root.set(i * 3, 5 - i, -2 * i);
    return keyOf(f, p);
  });
  return { name: 'SyntheticCurve', frames: 36, fps: 15, source, interp, loop, keys };
}
function samePose(a, b, tolerance = 1e-8) {
  assert.ok(a.root.distanceTo(b.root) < tolerance);
  for (let i = 0; i < BONES.length; i++) assert.ok(1 - Math.abs(a.rot[i].clone().normalize().dot(b.rot[i].clone().normalize())) < tolerance, `bone ${BONES[i][0]}`);
}
// Recorded from the pre-curve evaluator (editor_20261014_curves_194359), rather
// than loading a machine-specific backup or implementing the evaluator again.
// Every eighth-frame sample contains root XYZ and all normalized quaternions,
// rounded to nine decimals with equivalent quaternion signs made consistent.
const legacyFingerprints = {
  'smooth/true': 'd2cf00df2c83ec2d7eec91b8e050dbe0292894545bc6af3d59b881695a72d73e',
  'smooth/false': 'a933848c535995d9c14c78c1060aaf0b518e07d395552f903b290195de5dab6d',
  'linear/true': 'b9897fa446ed3178500477bb705a3b92a5082703a58e1cc23c132103ac58f43e',
  'linear/false': 'e4878d668eb27cb406d778b372c5f1c6bbf017edf1aa1265a0a92da4618d5703',
};
function poseFingerprint(a) {
  const values = [], number = (v) => Number(v.toFixed(9));
  for (let f = 0; f < a.frames; f += 0.125) {
    const pose = current.poseAt(a, f);
    values.push(...pose.root.toArray().map(number));
    for (const rotation of pose.rot) {
      const q = rotation.clone().normalize();
      values.push(...q.toArray().map((v) => number(q.w < 0 ? -v : v)));
    }
  }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
test('legacy made, copied and imported motion keeps every sampled pose', () => {
  for (const source of ['made', 'copy:Walk', 'import']) for (const interp of ['smooth', 'linear']) for (const loop of [true, false]) {
    const a = animation(source, interp, loop);
    const effective = source === 'import' ? 'linear' : interp;
    assert.equal(poseFingerprint(a), legacyFingerprints[`${effective}/${loop}`], `${source}/${interp}/${loop}`);
  }
});
test('enabling bone and body curves preserves every baked frame and unrelated bones', () => {
  for (const loop of [true, false]) {
    const a = animation('import', 'linear', loop), original = JSON.stringify(a);
    const head = curvesFromMotion(a, 'head'), position = curvesFromMotion(a, '$root');
    assert.equal(JSON.stringify(a), original);
    const converted = { ...a, curves: { head, $root: position } };
    for (let f = 0; f < a.frames; f++) samePose(current.poseAt(converted, f), current.poseAt(a, f), 1e-7);
  }
});
test('Euler display follows equivalent orientations through angle wraps and gimbal crossings', () => {
  let last = [0, 0, 0];
  for (let i = 0; i <= 100; i++) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, (80 + i / 5) * Math.PI / 180, (170 + i) * Math.PI / 180));
    const values = rotationValues(q, last), reconstructed = new THREE.Quaternion().setFromEuler(new THREE.Euler(...values.map(THREE.MathUtils.degToRad)));
    assert.ok(1 - Math.abs(q.dot(reconstructed)) < 1e-7);
    assert.ok(values.every((v, n) => Math.abs(v - last[n]) <= 180.001));
    last = values;
  }
});
test('one curve edits only its bone while the same evaluator drives integer game frames', () => {
  const a = animation(), group = curvesFromMotion(a, 'head');
  group.x = [{ f: 0, v: 0, mode: 'hold' }, { f: 15, v: 90, mode: 'linear' }];
  group.y = [{ f: 0, v: 0, mode: 'linear' }]; group.z = [{ f: 0, v: 0, mode: 'linear' }];
  const b = { ...a, curves: { head: group } };
  for (let f = 0; f < 15; f++) assert.ok(current.poseAt(b, f).rot[BI.head].angleTo(new THREE.Quaternion()) < 1e-7);
  const unchanged = current.poseAt(a, 15), changed = current.poseAt(b, 15);
  assert.ok(changed.rot[BI.head].angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)) < 1e-7);
  assert.deepEqual(changed.rot[BI.l_upperarm].toArray(), unchanged.rot[BI.l_upperarm].toArray());
  assert.deepEqual(changed.root.toArray(), unchanged.root.toArray());
});

// Two tiny original/HDTP-shaped fixtures exercise different vertex counts and
// raw mesh transforms. The third vertex blends the head and body at a joint.
function syntheticModel(hd = false) {
  const vertices = [[10, 5, 0], [0, 10, 0], [10, 5, 0], [0, 5, 4], [-6, 5, -2]].slice(0, hd ? 5 : 3);
  const headWeights = [1, 0, 0.5, 1, 1].slice(0, vertices.length);
  const joints = BONES.map(() => [0, 0, 0]);
  joints[BI.head] = [0, 5, 0];
  return {
    hd, vertices, headWeights,
    // bones of no length (tails on the joints): no vertex near a shoulder or an elbow, no seam
    rig: { ref: 0, joints, tails: joints.map((j) => [...j]), weights: headWeights.map((weight) => [BI.head, weight, BI.pelvis, 1 - weight]) },
    // no game frames and no faces: no seams to fit or to smooth
    model: { FV: vertices.length, SV: 0, pos: new Float32Array(vertices.flat()), seqs: [], faces: new Uint16Array(0), wedges: new Uint16Array(0),
      info: { counts: { faces: 0 }, ...(hd
        ? { scale: [2, 0.5, 4], origin: [5, -3, 7], rot: [0, 16384, 0] }
        : { scale: [1, 1, 1], origin: [0, 0, 0], rot: [0, 0, 0] }) } },
  };
}
function knownCurveMotion(mode) {
  const scalar = (v) => [{ f: 0, v, mode: 'hold' }];
  return {
    name: 'SyntheticBake', frames: 5, fps: 15, loop: false, source: 'made', interp: 'smooth',
    keys: [keyOf(0, restPose())],
    curves: {
      head: { x: scalar(0), y: scalar(0), z: [{ f: 0, v: 0, mode }, { f: 4, v: 90, mode }] },
      $root: {
        x: [{ f: 0, v: 0, mode: 'linear' }, { f: 4, v: 4, mode: 'linear' }],
        y: scalar(2),
        z: [{ f: 0, v: 0, mode: 'linear' }, { f: 4, v: 6, mode: 'linear' }],
      },
    },
  };
}
function expectedRawFrame(fixture, degrees, f) {
  // Analytic head rotation about (0,5,0), then blend and translation. This
  // oracle uses neither the production pose evaluator nor its skinning helper.
  const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return fixture.vertices.flatMap(([x, y, z], i) => {
    const w = fixture.headWeights[i];
    const position = [
      w * (x * c - (y - 5) * s) + (1 - w) * x + f,
      w * (5 + x * s + (y - 5) * c) + (1 - w) * y + 2,
      z + f * 1.5,
    ].map(Math.fround);
    const [px, py, pz] = position;
    // Original: game Y/Z swap. HDTP fixture: undo 90-degree mesh yaw, then
    // its distinct scale/origin. All expected values are safely inside int16.
    return (fixture.hd ? [pz / 2 + 5, -px / 0.5 - 3, py / 4 + 7] : [px, pz, py]).map(Math.round);
  });
}

test('actual bake produces the expected int16 game vertices for both model sizes and all curve modes', () => {
  const angles = {
    linear: [0, 22.5, 45, 67.5, 90],
    smooth: [0, 14.0625, 45, 75.9375, 90],
    hold: [0, 0, 0, 0, 90],
  };
  for (const hd of [false, true]) for (const [mode, degrees] of Object.entries(angles)) {
    const fixture = syntheticModel(hd), anim = knownCurveMotion(mode), before = JSON.stringify(anim);
    const baked = bakeOn(fixture.rig, fixture.model, anim);
    assert.ok(baked instanceof Int16Array);
    assert.equal(baked.length, anim.frames * fixture.model.FV * 3);
    assert.equal(baked.byteLength, anim.frames * fixture.model.FV * 6);
    for (let f = 0; f < anim.frames; f++) {
      const start = f * fixture.model.FV * 3;
      assert.deepEqual(Array.from(baked.subarray(start, start + fixture.model.FV * 3)), expectedRawFrame(fixture, degrees[f], f),
        `${hd ? 'HDTP-shaped' : 'original-shaped'} ${mode} frame ${f}`);
    }
    assert.equal(JSON.stringify(anim), before, 'baking must not rewrite the animation or its curves');
  }
});

test('enabling curves preserves actual baked bytes for legacy, copied and imported motion on both models', () => {
  for (const hd of [false, true]) for (const source of ['made', 'copy:Walk', 'import']) {
    for (const interp of ['linear', 'smooth']) for (const loop of [false, true]) {
      const fixture = syntheticModel(hd), a = animation(source, interp, loop);
      const converted = { ...a, curves: Object.fromEntries(['head', 'l_upperarm', '$root'].map((name) => [name, curvesFromMotion(a, name)])) };
      const before = bakeOn(fixture.rig, fixture.model, a), after = bakeOn(fixture.rig, fixture.model, converted);
      assert.deepEqual(after, before, `${hd ? 'HDTP-shaped' : 'original-shaped'} ${source}/${interp}/${loop}`);
    }
  }
});
