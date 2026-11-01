// Exercise the actual Studio evaluator and bake with its production Three.js version.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import test, { threeURL as three } from './three.mjs';
import { migrateTracks, upsertTrackKey } from '../editor/static/studio-tracks.js';
const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Tests never download dependencies, start WebGL, or write animation/game packages.
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
const current = three ? await loadStudio(path.join(modules, 'studio.js')) : { kit: {} };
const { THREE, BI, BONES, restPose, keyOf, curvesFromMotion, rotationValues, bakeOn } = current.kit;
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

test('independent-track migration preserves legacy fractional poses and exact game vertices', () => {
  for (const source of ['made', 'copy:Walk', 'import']) for (const interp of ['smooth', 'linear']) {
    for (const loop of [true, false]) {
      const original = animation(source, interp, loop), migrated = structuredClone(original);
      migrateTracks(migrated, BONES.map(([name]) => name));
      const effective = source === 'import' ? 'linear' : interp;
      assert.equal(poseFingerprint(migrated), legacyFingerprints[`${effective}/${loop}`],
        `migrated ${source}/${interp}/${loop}`);
      assert.deepEqual(migrated.keys, original.keys, 'Legacy source poses remain available unchanged');
      for (const hd of [false, true]) {
        const fixture = syntheticModel(hd);
        assert.deepEqual(bakeOn(fixture.rig, fixture.model, migrated), bakeOn(fixture.rig, fixture.model, original),
          `migrated ${hd ? 'HDTP-shaped' : 'original-shaped'} ${source}/${interp}/${loop}`);
      }
    }
  }
});

test('a partial or explicitly empty track overrides only its own legacy channel', () => {
  const original = animation(), changed = structuredClone(original);
  changed.tracks = {
    head: { keys: [{ f: 0, q: [0, 0, 0, 1], mode: 'hold' },
                   { f: 20, q: [0, 0, Math.SQRT1_2, Math.SQRT1_2], mode: 'linear' }] },
    $root: { keys: [] },
  };
  for (let f = 0; f < 20; f += 0.125) {
    const before = current.poseAt(original, f), after = current.poseAt(changed, f);
    assert.deepEqual(after.rot[BI.head].toArray(), [0, 0, 0, 1], 'Edited head holds its own first key');
    assert.deepEqual(after.root.toArray(), [0, 0, 0], 'Empty root track explicitly resets root motion');
    for (let b = 0; b < BONES.length; b++) if (b !== BI.head) {
      assert.deepEqual(after.rot[b].toArray(), before.rot[b].toArray(), `Untracked ${BONES[b][0]}`);
    }
  }
  changed.tracks.head.keys = [];
  assert.deepEqual(current.poseAt(changed, 23).rot[BI.head].toArray(), [0, 0, 0, 1]);
});

test('curve overrides remain authoritative above independent quaternion and position tracks', () => {
  const original = animation(), curved = structuredClone(original);
  curved.curves = { head: curvesFromMotion(original, 'head'), $root: curvesFromMotion(original, '$root') };
  const migrated = structuredClone(curved);
  migrateTracks(migrated, BONES.map(([name]) => name));
  upsertTrackKey(migrated, 'head', { f: 7, q: [0, 0, 0, 1], mode: 'hold' });
  upsertTrackKey(migrated, '$root', { f: 7, v: [500, 600, 700], mode: 'hold' });
  for (let f = 0; f < original.frames; f += 0.125) samePose(current.poseAt(migrated, f), current.poseAt(curved, f));
  for (const hd of [false, true]) {
    const fixture = syntheticModel(hd);
    assert.deepEqual(bakeOn(fixture.rig, fixture.model, migrated), bakeOn(fixture.rig, fixture.model, curved));
  }
});

test('independent tracks bake known head and root motion into correct original and HDTP vertices', () => {
  const angles = { linear: [0, 22.5, 45, 67.5, 90], smooth: [0, 14.0625, 45, 75.9375, 90], hold: [0, 0, 0, 0, 90] };
  for (const hd of [false, true]) for (const [mode, degrees] of Object.entries(angles)) {
    const fixture = syntheticModel(hd), anim = {
      name: 'SyntheticTrackBake', frames: 5, fps: 15, loop: false, source: 'made', interp: 'smooth',
      keys: [keyOf(0, restPose())],
      tracks: {
        head: { keys: [{ f: 0, q: [0, 0, 0, 1], mode }, { f: 4, q: [0, 0, Math.SQRT1_2, Math.SQRT1_2], mode }] },
        $root: { keys: [{ f: 0, v: [0, 2, 0], mode: 'linear' }, { f: 4, v: [4, 2, 6], mode: 'linear' }] },
      },
    };
    const before = structuredClone(anim), baked = bakeOn(fixture.rig, fixture.model, anim);
    for (let f = 0; f < anim.frames; f++) {
      const start = f * fixture.model.FV * 3;
      assert.deepEqual(Array.from(baked.subarray(start, start + fixture.model.FV * 3)), expectedRawFrame(fixture, degrees[f], f),
        `track ${hd ? 'HDTP-shaped' : 'original-shaped'} ${mode} frame ${f}`);
    }
    assert.deepEqual(anim, before, 'Baking tracks does not mutate the animation');
  }
});

function assertOtherChannelsUntouched(actual, expected, changed) {
  assert.deepEqual(actual.keys, expected.keys, 'Stored legacy poses are never overwritten by an independent edit');
  for (const name of ['$root', ...BONES.map(([name]) => name)]) if (!changed.includes(name)) {
    assert.deepEqual(actual.tracks?.[name], expected.tracks?.[name], `${name} track`);
    assert.deepEqual(actual.curves?.[name], expected.curves?.[name], `${name} curves`);
  }
}

test('viewport pose writes, timeline moves and deletion affect only the selected bone or position track', () => {
  const { writePoseKeys, channelFrames, moveChannelKeys, removeChannelKey } = current.kit;
  for (const target of ['head', 'l_upperarm', '$root']) {
    const a = animation(); migrateTracks(a, BONES.map(([name]) => name));
    // An unrelated existing curve must survive every operation unchanged.
    a.curves = { r_upperarm: curvesFromMotion(a, 'r_upperarm') };
    const before = structuredClone(a), pose = current.poseAt(a, 11);
    pose.rot[BI.head].setFromEuler(new THREE.Euler(0.5, 0.4, 0.3));
    pose.rot[BI.l_upperarm].setFromEuler(new THREE.Euler(-0.5, 0.8, -0.6));
    pose.root.set(10, 20, 30);
    writePoseKeys(a, pose, 11, [target]);
    assert.deepEqual(channelFrames(a, target), [0, 7, 11, 19, 29]);
    assertOtherChannelsUntouched(a, before, [target]);
    const stored = a.tracks[target].keys.find((k) => k.f === 11), expected = keyOf(11, pose);
    assert.deepEqual(target === '$root' ? stored.v : stored.q, target === '$root' ? expected.root : expected.rot[target]);
    assert.equal(moveChannelKeys(a, target, 11, 13), true);
    assert.deepEqual(channelFrames(a, target), [0, 7, 13, 19, 29]);
    assertOtherChannelsUntouched(a, before, [target]);
    assert.equal(removeChannelKey(a, target, 13), true);
    assert.deepEqual(channelFrames(a, target), [0, 7, 19, 29]);
    assertOtherChannelsUntouched(a, before, [target]);
    assert.deepEqual(a, before, 'Deleting the inserted key restores every prior channel exactly');
  }
});

test('scoped pose writes update existing curves and leave their legacy quaternion track untouched', () => {
  const { writePoseKeys } = current.kit;
  for (const target of ['head', 'l_upperarm', '$root']) {
    const a = animation(); migrateTracks(a, BONES.map(([name]) => name));
    a.curves = Object.fromEntries(['head', 'l_upperarm', '$root'].map((name) => [name, curvesFromMotion(a, name)]));
    const before = structuredClone(a), pose = current.poseAt(a, 13);
    pose.rot[BI.head].setFromEuler(new THREE.Euler(0.8, 0.2, -0.4));
    pose.rot[BI.l_upperarm].setFromEuler(new THREE.Euler(-0.6, 0.5, -0.2));
    pose.root.set(50, 60, 70);
    writePoseKeys(a, pose, 13, [target]);
    assert.deepEqual(a.tracks, before.tracks, 'Curves own this channel; stale quaternion data is not edited');
    assertOtherChannelsUntouched(a, before, [target]);
    const result = current.poseAt(a, 13);
    if (target === '$root') assert.deepEqual(result.root.toArray(), pose.root.toArray());
    else assert.ok(1 - Math.abs(result.rot[BI[target]].dot(pose.rot[BI[target]])) < 1e-8);
  }
});

test('timeline collisions reject atomically for both independent and multi-axis curve keys', () => {
  const { moveChannelKeys, channelFrames } = current.kit;
  const a = animation(); migrateTracks(a, BONES.map(([name]) => name));
  const before = structuredClone(a);
  assert.throws(() => moveChannelKeys(a, 'head', 7, 19), /already occupies/);
  assert.deepEqual(a, before);
  assert.throws(() => moveChannelKeys(a, '$root', 7, a.frames), /inside/);
  assert.deepEqual(a, before);
  const scalar = (frames) => frames.map((f) => ({ f, v: f, mode: 'linear' }));
  a.curves = { head: { x: scalar([0, 7, 29]), y: scalar([0, 7, 19]), z: scalar([0]) } };
  const curvedBefore = structuredClone(a);
  // X could move successfully; Y collides. Neither axis may change.
  assert.throws(() => moveChannelKeys(a, 'head', 7, 19), /already occupies/);
  assert.deepEqual(a, curvedBefore);
  assert.equal(moveChannelKeys(a, 'head', 7, 11), true);
  assert.deepEqual(channelFrames(a, 'head'), [0, 11, 19, 29]);
  assert.deepEqual(a.tracks, curvedBefore.tracks);
  assert.deepEqual(a.curves.head.z, curvedBefore.curves.head.z);
  assert.equal(moveChannelKeys(a, 'head', 7, 11), false);
});

test('last keys are protected and resizing keeps explicit rest tracks without restoring old motion', () => {
  const { removeChannelKey, resizeAnimation, channelFrames } = current.kit;
  const a = animation(); migrateTracks(a, BONES.map(([name]) => name));
  for (const f of [7, 19, 29]) assert.equal(removeChannelKey(a, 'head', f), true);
  const last = structuredClone(a);
  assert.equal(removeChannelKey(a, 'head', 0), false);
  assert.deepEqual(a, last);
  const scalar = [{ f: 7, v: 15, mode: 'hold' }];
  a.curves = { l_upperarm: { x: structuredClone(scalar), y: structuredClone(scalar), z: structuredClone(scalar) } };
  const lastCurved = structuredClone(a);
  assert.equal(removeChannelKey(a, 'l_upperarm', 7), false);
  assert.deepEqual(a, lastCurved);
  a.tracks.$root.keys = [];
  a.tracks.r_upperarm.keys = [{ f: 29, q: [0, 0, 0, 1], mode: 'hold' }];
  resizeAnimation(a, 4);
  assert.equal(a.frames, 4);
  assert.deepEqual(a.tracks.$root.keys, [], 'Empty root track keeps its explicit reset semantics');
  assert.deepEqual(channelFrames(a, 'r_upperarm'), [0], 'A track whose keys were beyond the new duration retains its initial value');
  assert.deepEqual(channelFrames(a, 'l_upperarm'), [0]);
  for (const name of ['$root', ...BONES.map(([name]) => name)]) assert.ok(channelFrames(a, name).every((f) => f < 4));
  assert.deepEqual(current.poseAt(a, 3).root.toArray(), [0, 0, 0]);
});
