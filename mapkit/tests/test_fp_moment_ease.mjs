// First-person moments (editor/static/fp-moment.js): eased moves laid as the game's straight steps (the same numbers
// as editor/fpmoments.py game_offsets, tests/test_fpmoments_ease.py), the shake, the end, the rules that play it. The
// basics (clips, frames, sounds): test_fp_moment.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ease, gameOffsets, offsetAt, keyNear, shakeAt, endJump, rulesPlaying, clipTimes, momentLength, MAX_OFFSETS } from '../editor/static/fp-moment.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
const KEYS = [{ t: 0.5, x: 10, y: 0, z: 0, ease: 'smooth' }, { t: 1, x: 0, y: 4, z: -2 }];
// what the game gets: four steps on the smooth way to 0.5 s, then the straight one to 1 s
const GAME = [[0.1, 1.04, 0, 0], [0.2, 3.52, 0, 0], [0.3, 6.48, 0, 0], [0.4, 8.96, 0, 0], [0.5, 10, 0, 0], [1, 0, 4, -2]];

test('ease: the shapes of a way', () => {
  for (const k of ['smooth', 'in', 'out', 'linear']) { near(ease(k, 0), 0); near(ease(k, 1), 1); }
  near(ease('smooth', 0.5), 0.5); near(ease('in', 0.5), 0.25); near(ease('out', 0.5), 0.75); near(ease('linear', 0.3), 0.3);
  near(ease('in', 2), 1); near(ease('out', -1), 0);
});

test('gameOffsets: an eased way laid as straight steps', () => {
  const g = gameOffsets(KEYS);
  assert.equal(g.length, GAME.length);
  g.forEach((k, i) => GAME[i].forEach((v, j) => near([k.t, k.x, k.y, k.z][j], v)));
  // keys made before easing (no ease) go straight, as before
  assert.deepEqual(gameOffsets([{ t: 1, x: 2, y: 3, z: 4 }]), [{ t: 1, x: 2, y: 3, z: 4 }]);
  // out of order, sorted
  assert.deepEqual(gameOffsets([{ t: 2, x: 1 }, { t: 1, x: 5 }]).map((k) => k.t), [1, 2]);
});

test('gameOffsets: never more than the game has', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ t: (i + 1) * 0.2, x: i % 2 ? 5 : -5, ease: 'smooth' }));
  const g = gameOffsets(many);
  assert.ok(g.length <= MAX_OFFSETS, `${g.length}`);
  assert.equal(g.length, 10);               // 6 free keys shared by 10 eased ways: none gets a step
  const few = Array.from({ length: 3 }, (_, i) => ({ t: (i + 1) * 0.3, x: i, ease: 'in' }));
  assert.equal(gameOffsets(few).length, 3 + 3 * 4);
  const two = Array.from({ length: 5 }, (_, i) => ({ t: (i + 1) * 0.3, x: i, ease: 'out' }));
  assert.equal(gameOffsets(two).length, 5 + 5 * 2);        // floor(11 / 5) = 2 each
  // keys at the same time have no way to ease
  assert.equal(gameOffsets([{ t: 0, x: 3, ease: 'smooth' }]).length, 1);
});

test('offsetAt: the preview goes as the game does', () => {
  near(offsetAt(KEYS, 0.25)[0], (3.52 + 6.48) / 2);         // halfway between two steps
  near(offsetAt(KEYS, 0.5)[0], 10);
  near(offsetAt(KEYS, 0.75)[1], 2);
  near(offsetAt(KEYS, 5)[2], -2);
  assert.deepEqual(offsetAt([], 1), [0, 0, 0]);
  // a smooth way starts slower than a straight one
  assert.ok(offsetAt(KEYS, 0.1)[0] < offsetAt([{ t: 0.5, x: 10 }], 0.1)[0]);
});

test('keyNear: the move at the playhead', () => {
  assert.equal(keyNear(KEYS, 0.51), 0);
  assert.equal(keyNear(KEYS, 0.7), -1);
  assert.equal(keyNear(KEYS, 1), 1);
});

test('shakeAt: only while it lasts, dying away', () => {
  const m = { shake: { t: 1, secs: 0.5, roll: 200, vert: 4 } };
  assert.deepEqual(shakeAt(m, 0.9, 1), { roll: 0, up: 0 });
  assert.deepEqual(shakeAt(m, 1.5, 1), { roll: 0, up: 0 });
  const a = shakeAt(m, 1, 0), b = shakeAt(m, 1, 1), late = shakeAt(m, 1.4, 1);
  assert.ok(a.roll < 0 && b.roll > 0, 'the roll flips side every frame');
  near(Math.abs(b.up), 4.4);
  assert.ok(Math.abs(late.up) < Math.abs(b.up));
  assert.ok(Math.abs(late.roll) < Math.abs(b.roll));
  assert.deepEqual(shakeAt({ shake: { t: 0, secs: 0 } }, 0, 1), { roll: 0, up: 0 });
});

test('endJump: a moment that leaves the weapon away', () => {
  assert.equal(endJump({ offsets: [] }), '');
  assert.equal(endJump({ offsets: KEYS }).length > 0, true);
  assert.equal(endJump({ offsets: [...KEYS, { t: 1.3, x: 0, y: 0, z: 0, ease: 'smooth' }] }), '');
  assert.equal(endJump({ offsets: [{ t: 2, x: 0 }, { t: 1, x: 5 }] }), '');       // the last in time counts
});

test('rulesPlaying, clipTimes, momentLength', () => {
  const edits = { links: [{ do: [{ verb: 'fpmoment', a: 'Inspect' }] }, { do: [], else: [{ verb: 'fpmoment', a: 'Inspect' }] },
    { do: [{ verb: 'fpmoment', a: 'Other' }] }, { do: [{ verb: 'say', a: 'Inspect' }] }] };
  assert.equal(rulesPlaying(edits, 'Inspect').length, 2);
  assert.equal(rulesPlaying({}, 'Inspect').length, 0);
  const m = { clips: [{ secs: 0.5 }, { secs: 1 }], offsets: KEYS, sounds: [{ t: 2.2 }], shake: { t: 1, secs: 0.5 } };
  assert.deepEqual(clipTimes(m), [{ start: 0, secs: 0.5 }, { start: 0.5, secs: 1 }]);
  near(momentLength(m), 2.2);
});
