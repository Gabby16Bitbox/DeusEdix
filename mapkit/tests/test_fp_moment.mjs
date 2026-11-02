// First-person moments (static/fp-moment.js): what the weapon shows and where it is at each moment, as UCViewMoment
// plays it in the game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newMoment, clipOf, momentLength, offsetAt, frameAt, soundsBetween, momentProblem, MOMENT_NAME } from '../editor/static/fp-moment.js';

const SEQS = [{ name: 'All', start: 0, frames: 60 }, { name: 'Still', start: 0, frames: 1 }, { name: 'Select', start: 1, frames: 10, rate: 20 },
  { name: 'Reload', start: 11, frames: 24, rate: 12 }];
const M = { clips: [{ seq: 'Reload', from: 0, to: 12, frames: 24, secs: 1.5 }, { seq: 'Reload', from: 12, to: 0, frames: 24, secs: 1 }],
  offsets: [{ t: 0.5, x: 0, y: 2, z: 4 }, { t: 2.5, x: 0, y: 0, z: 0 }], sounds: [{ t: 0.2, sound: 'A.B.C' }, { t: 3, sound: '' }],
  shake: { t: 2.8, secs: 0.5 } };

test('a new moment starts with its weapon\'s Select, whole, at the game\'s speed', () => {
  const m = newMoment('WeaponPistol', 'DeusExItems.Glock', [20, -10, -14], SEQS);
  assert.deepEqual(m.clips, [{ seq: 'Select', from: 0, to: 9, frames: 10, secs: 0.5 }]);
  assert.deepEqual(clipOf(SEQS[3]), { seq: 'Reload', from: 0, to: 23, frames: 24, secs: 2 });
  assert.deepEqual(newMoment('', '', null, []).clips, []);
});

test('its length: the clips, or a later move, sound or the end of its shake', () => {
  assert.equal(momentLength(M), 3.3);
  assert.equal(momentLength({ clips: [{ secs: 1 }], offsets: [], sounds: [] }), 1);
});

test('the frame: each clip in its time, backwards when to is before from, the last frame held', () => {
  assert.deepEqual(frameAt(M, 0), { clip: 0, seq: 'Reload', frame: 0 });
  assert.deepEqual(frameAt(M, 0.75), { clip: 0, seq: 'Reload', frame: 6 });
  assert.deepEqual(frameAt(M, 2), { clip: 1, seq: 'Reload', frame: 6 });
  assert.deepEqual(frameAt(M, 10), { clip: 1, seq: 'Reload', frame: 0 });
  assert.equal(frameAt({ clips: [] }, 1), null);
});

test('the weapon\'s place: from where it is to the first key, then key to key, then the last', () => {
  assert.deepEqual(offsetAt(M.offsets, 0), [0, 0, 0]);
  assert.deepEqual(offsetAt(M.offsets, 0.25), [0, 1, 2]);
  assert.deepEqual(offsetAt(M.offsets, 1.5), [0, 1, 2]);
  assert.deepEqual(offsetAt(M.offsets, 9), [0, 0, 0]);
  assert.deepEqual(offsetAt([], 1), [0, 0, 0]);
});

test('sounds as the playhead passes them; what the game cannot play', () => {
  assert.deepEqual(soundsBetween(M, 0, 0.3).map((s) => s.sound), ['A.B.C']);
  assert.deepEqual(soundsBetween(M, 0.2, 5), [], 'one without a sound plays nothing');
  assert.equal(momentProblem(M, ['Reload']), '');
  assert.match(momentProblem(M, ['Select']), /no animation Reload/);
  assert.match(momentProblem({ clips: [], offsets: [] }), /does nothing/);
  assert.ok(MOMENT_NAME.test('Inspect_2') && !MOMENT_NAME.test('2Inspect') && !MOMENT_NAME.test('In spect'));
});
