// First-person animations from Blender (static/fp-blender.js): each point of the model is the nearest point of the
// import at rest, and the frames come back in the model's own units. (The whole round trip, export, animation in a
// glTF, import, was tried in Chromium with three.js 0.160.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPoints, toRaw, usedPoints, restFrame } from '../editor/static/fp-blender.js';

test('the nearest point of the import, for each point of the model', () => {
  const pool = [[0, 0, 0], [10, 0, 0], [10.2, 0.1, 0], [0, 10, 0], [0, 10, 0]];      // a seam: one place, two points
  const got = matchPoints([[0, [0.05, 0, 0]], [1, [10.15, 0.1, 0]], [2, [0, 10, 0]]], pool);
  assert.equal(got.map.get(0), 0);
  assert.equal(got.map.get(1), 2);
  assert.ok([3, 4].includes(got.map.get(2)));
  assert.ok(got.median < 0.06 && got.worst < 0.06);
  const far = matchPoints([[0, [100, 0, 0]]], pool);
  assert.equal(far.map.get(0), 2);
  assert.ok(far.worst > 80, 'far away: found anyway, and said how far');
});

test('the model\'s own units, as the Studio\'s bake (scale, origin, its turn)', () => {
  const out = new Int16Array(3);
  toRaw({ scale: [2, 2, 1], origin: [10, 20, 30], rot: [0, 0, 0] }, new Float32Array([4, 6, 8]), out, 0);   // three: x, y up, z
  assert.deepEqual(Array.from(out), [12, 24, 36]);
  toRaw({ scale: [1, 1, 1], origin: [0, 0, 0], rot: [0, 16384, 0] }, new Float32Array([1, 0, 0]), out, 0);
  assert.deepEqual(Array.from(out), [0, -1, 0]);
});

test('the points its faces use, and its frame at rest', () => {
  assert.deepEqual(usedPoints({ wedges: new Uint16Array([3, 1, 1, 0]) }), [0, 1, 3]);
  assert.equal(restFrame({ seqs: [{ name: 'All', start: 0 }, { name: 'Still', start: 7 }] }), 7);
  assert.equal(restFrame({ seqs: [{ name: 'Select', start: 0 }] }), 0);
});
