import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateTracks, sampleTrack, sampleTracks, keyTrackFrames, upsertTrackKey, moveTrackKey, deleteTrackKey } from '../editor/static/studio-tracks.js';

const IDENTITY = [0, 0, 0, 1], ZERO = [0, 0, 0];
const qz = (degrees) => [0, 0, Math.sin(degrees * Math.PI / 360), Math.cos(degrees * Math.PI / 360)];
const near = (actual, expected, tolerance = 1e-10) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((x, i) => assert.ok(Math.abs(x - expected[i]) <= tolerance, `${actual} != ${expected}`));
};
function legacy(options = {}) {
  return { frames: 20, loop: false, keys: [
    { f: 2, rot: { arm: qz(0) }, root: [2, 0, 1] },
    { f: 10, rot: { arm: qz(90), head: qz(20) }, root: [10, 4, 1] },
    { f: 16, rot: { arm: qz(30) }, root: [16, -2, 1] },
  ], ...options };
}

test('migration preserves keys, curves, sparse identity rotations and copied arrays', () => {
  const anim = legacy({ curves: { head: { x: [{ f: 0, v: 8 }] } } });
  const before = structuredClone(anim), oldKeys = anim.keys, oldCurves = anim.curves;
  migrateTracks(anim, ['arm', 'head', 'hand']);
  assert.equal(anim.keys, oldKeys); assert.equal(anim.curves, oldCurves);
  assert.deepEqual(anim.keys, before.keys); assert.deepEqual(anim.curves, before.curves);
  assert.deepEqual(keyTrackFrames(anim, 'arm'), [2, 10, 16]);
  assert.deepEqual(anim.tracks.head.keys.map((k) => k.q), [IDENTITY, qz(20), IDENTITY]);
  assert.deepEqual(anim.tracks.hand.keys.map((k) => k.q), [IDENTITY, IDENTITY, IDENTITY]);
  anim.tracks.arm.keys[1].q[0] = 123;
  assert.deepEqual(anim.keys[1].rot.arm, before.keys[1].rot.arm);
});

test('every legacy playback frame and subframe retains smooth/linear/import interpolation', () => {
  for (const loop of [false, true]) for (const options of [{}, { interp: 'linear' }, { source: 'import' }]) {
    const anim = legacy({ loop, ...options });
    migrateTracks(anim, ['arm', 'head']);
    const smooth = !options.interp && !options.source;
    for (let f = -1; f < anim.frames; f += 0.125) {
      const poses = [{ f: 2, angle: 0, root: [2, 0, 1] }, { f: 10, angle: 90, root: [10, 4, 1] }, { f: 16, angle: 30, root: [16, -2, 1] }];
      const a = f < 2 ? poses[0] : f < 10 ? poses[0] : f < 16 ? poses[1] : poses[2];
      const b = f < 2 ? a : f < 10 ? poses[1] : f < 16 ? poses[2] : loop ? { ...poses[0], f: 22 } : a;
      let t = a === b ? 0 : (f - a.f) / (b.f - a.f);
      if (smooth) t = t * t * (3 - 2 * t);
      const result = sampleTracks(anim, f, ['arm', 'head']);
      near(result.rot.arm, qz(a.angle + (b.angle - a.angle) * t));
      near(result.root, a.root.map((x, i) => x + (b.root[i] - x) * t));
      if (f < 2) near(result.root, [2, 0, 1]); // A loop never wraps before the first legacy pose.
    }
  }
});

test('one-key loops hold values and rounded legacy keys are not normalized', () => {
  const q = [0.12345, 0, 0, 0.99235];
  const anim = legacy({ loop: true, keys: [{ f: 5, rot: { arm: q } }] });
  migrateTracks(anim, ['arm']);
  for (const f of [-2, 0, 5, 12, 19]) {
    assert.deepEqual(sampleTracks(anim, f).rot.arm, q);
    assert.deepEqual(sampleTracks(anim, f).root, ZERO);
  }
  const sampled = sampleTracks(anim, 5); sampled.rot.arm[0] = 100;
  assert.equal(anim.tracks.arm.keys[0].q[0], q[0]);
});

test('adding or replacing an arm key never keys the head, other bones or root', () => {
  const anim = legacy(); migrateTracks(anim, ['arm', 'head', 'hand']);
  const before = structuredClone(anim), head = anim.tracks.head, root = anim.tracks.$root;
  upsertTrackKey(anim, 'arm', { f: 7, q: qz(45), mode: 'hold' });
  assert.deepEqual(keyTrackFrames(anim, 'arm'), [2, 7, 10, 16]);
  assert.equal(anim.tracks.head, head); assert.equal(anim.tracks.$root, root);
  assert.deepEqual(anim.tracks.hand, before.tracks.hand);
  assert.deepEqual(anim.keys, before.keys);
  upsertTrackKey(anim, 'arm', { f: 7, q: qz(50) });
  assert.equal(anim.tracks.arm.keys[1].mode, 'hold');
  near(sampleTracks(anim, 9).rot.arm, qz(50));
  near(sampleTracks(anim, 10).rot.arm, qz(90));
});

test('moving rejects collisions atomically and never alters another bone or stale pose keys', () => {
  const anim = legacy(); migrateTracks(anim, ['arm', 'head']);
  const before = structuredClone(anim), head = anim.tracks.head;
  assert.throws(() => moveTrackKey(anim, 'arm', 10, 16), /already occupies/);
  assert.deepEqual(anim, before);
  assert.throws(() => moveTrackKey(anim, 'arm', 10, 20), /inside/);
  assert.deepEqual(anim, before);
  assert.equal(moveTrackKey(anim, 'arm', 10, 11), true);
  assert.deepEqual(keyTrackFrames(anim, 'arm'), [2, 11, 16]);
  assert.equal(anim.tracks.head, head);
  assert.deepEqual(anim.keys, before.keys);
  assert.equal(moveTrackKey(anim, 'arm', 10, 8), false);
  assert.equal(moveTrackKey(anim, 'arm', 11, 11), false);
});

test('deletion protects the last key, and optional empty tracks never resurrect legacy motion', () => {
  const anim = legacy(); migrateTracks(anim, ['arm', 'head']);
  const head = structuredClone(anim.tracks.head);
  assert.equal(deleteTrackKey(anim, 'arm', 10), true);
  assert.equal(deleteTrackKey(anim, 'arm', 2), true);
  assert.equal(deleteTrackKey(anim, 'arm', 16), false);
  assert.equal(deleteTrackKey(anim, 'arm', 16, { allowEmpty: true }), true);
  assert.deepEqual(anim.tracks.arm.keys, []);
  migrateTracks(anim, ['arm', 'head']);
  near(sampleTracks(anim, 12).rot.arm, IDENTITY);
  assert.deepEqual(anim.tracks.head, head);
  for (const f of [2, 10, 16]) deleteTrackKey(anim, '$root', f, { allowEmpty: true });
  near(sampleTracks(anim, 12).root, ZERO);
  near(sampleTrack(anim.tracks.$root, 12, anim, '$root'), ZERO);
});

test('independent position keys and per-segment modes interpolate correctly', () => {
  const anim = { frames: 20, loop: false, interp: 'linear', tracks: {} };
  upsertTrackKey(anim, '$root', { f: 0, v: ZERO });
  upsertTrackKey(anim, '$root', { f: 10, v: [10, 20, 30], mode: 'hold' });
  upsertTrackKey(anim, '$root', { f: 18, v: [2, 3, 4] });
  near(sampleTrack(anim.tracks.$root, 5, anim), [5, 10, 15]);
  near(sampleTrack(anim.tracks.$root, 17.99, anim), [10, 20, 30]);
  near(sampleTrack(anim.tracks.$root, 18, anim), [2, 3, 4]);
  assert.deepEqual(Object.keys(anim.tracks), ['$root']);
});

test('antipodal quaternions take the short arc and remain finite', () => {
  const q = qz(80), anim = { frames: 12, interp: 'linear' };
  const track = { keys: [{ f: 0, q }, { f: 10, q: q.map((v) => -v) }] };
  for (let f = 0; f < 10; f += 0.25) near(sampleTrack(track, f, anim), q);
  near(sampleTrack(track, 10, anim), q.map((v) => -v));
});

test('an explicit key-all operation keys each named track once, without removing existing keys', () => {
  const anim = legacy(); migrateTracks(anim, ['arm', 'head']);
  const pose = sampleTracks(anim, 6);
  for (const [name, q] of Object.entries(pose.rot)) upsertTrackKey(anim, name, { f: 6, q });
  upsertTrackKey(anim, '$root', { f: 6, v: pose.root });
  for (const name of ['arm', 'head', '$root']) assert.deepEqual(keyTrackFrames(anim, name), [2, 6, 10, 16]);
  near(sampleTracks(anim, 6).rot.arm, pose.rot.arm);
});

test('invalid edits do not partially mutate the animation', () => {
  const anim = legacy(); migrateTracks(anim, ['arm']);
  const before = structuredClone(anim);
  for (const key of [{ f: -1, q: IDENTITY }, { f: 20, q: IDENTITY }, { f: 1.5, q: IDENTITY },
    { f: 2, q: [0, 0, NaN, 1] }, { f: 2, q: [0, 0, 1] }, { f: 2, q: IDENTITY, mode: 'magic' }]) {
    assert.throws(() => upsertTrackKey(anim, 'arm', key));
    assert.deepEqual(anim, before);
  }
  assert.throws(() => sampleTrack(anim.tracks.arm, NaN, anim), /finite/);
});
