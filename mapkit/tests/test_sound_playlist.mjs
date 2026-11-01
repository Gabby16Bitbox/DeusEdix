// A sound effect's playlist (static/sound-playlist.js), as UCSoundFX plays it: the list packed from FXSound, one at
// random never the same twice in a row or in sequence, volume and pitch varied either way, the wait before it repeats,
// one sound and no variation as it always played, and the Preview's few picks and their times.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIST_KEYS, listWith, listWithout, listMoved, listChanges, nextPick, varied, nextWait, previewPicks, timesOf, PREVIEW_GAP }
  from '../editor/static/sound-playlist.js';

// the game's FRand from a list of numbers, over and over
const rolls = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
const places = (...names) => LIST_KEYS.map((_, i) => names[i] || '');

test('the list: FXSound first, then the 7 FXSounds; added in the first empty place, packed when one goes or moves', () => {
  assert.deepEqual(LIST_KEYS, ['FXSound', 'FXSounds(0)', 'FXSounds(1)', 'FXSounds(2)', 'FXSounds(3)', 'FXSounds(4)', 'FXSounds(5)', 'FXSounds(6)']);
  assert.deepEqual(listWith(places('A.Dog1'), 'A.Dog2'), places('A.Dog1', 'A.Dog2'));
  assert.deepEqual(listWith(places('', 'A.Dog2'), 'A.Dog1'), places('A.Dog1', 'A.Dog2'));     // FXSound empty: it goes there
  assert.equal(listWith(LIST_KEYS.map((_, i) => 'A.S' + i), 'A.More'), null);                  // 8: full
  assert.deepEqual(listWithout(places('A.1', 'A.2', 'A.3'), 0), places('A.2', 'A.3'));
  assert.deepEqual(listWithout(places('A.1', '', 'A.3'), 1), places('A.1'));                   // gaps left out first
  assert.deepEqual(listMoved(places('A.1', 'A.2', 'A.3'), 2, 0), places('A.3', 'A.1', 'A.2'));
  assert.deepEqual(listMoved(places('A.1', 'A.2'), 0, 9), places('A.2', 'A.1'));
});

test('what a change writes: only the places that changed, a sound as UnrealEd writes it, an empty place None', () => {
  assert.deepEqual(listChanges(places('A.1', 'A.2'), places('A.2', 'A.1')), [['FXSound', "Sound'A.2'"], ['FXSounds(0)', "Sound'A.1'"]]);
  assert.deepEqual(listChanges(places('A.1', 'A.2'), places('A.1')), [['FXSounds(0)', 'None']]);
  assert.deepEqual(listChanges(places('A.1'), places('A.1')), []);
});

test('in sequence: one after the other, then the first again', () => {
  let last = -1;
  const seq = [];
  for (let i = 0; i < 7; i++) seq.push(last = nextPick(3, last, 1, rolls(0.9)));
  assert.deepEqual(seq, [0, 1, 2, 0, 1, 2, 0]);
});

test('at random: never the same one twice in a row, every one can come', () => {
  let last = -1, seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;     // a plain generator, as FRand
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const k = nextPick(4, last, 0, rand);
    assert.ok(k >= 0 && k < 4);
    assert.notEqual(k, last);
    seen.add(k);
    last = k;
  }
  assert.equal(seen.size, 4);
  assert.equal(nextPick(1, 0, 0, rolls(0.99)), 0);          // one sound: always it
  assert.equal(nextPick(0, -1, 0, rolls(0.5)), -1);
});

test('volume and pitch varied up to their spread either way; no spread: exactly as they are (old effects)', () => {
  assert.equal(varied(0.8, 0, rolls(0.99)), 0.8);
  assert.ok(Math.abs(varied(1, 0.1, rolls(0)) - 0.9) < 1e-9);
  assert.ok(Math.abs(varied(1, 0.1, rolls(0.5)) - 1) < 1e-9);
  assert.ok(Math.abs(varied(2, 3, rolls(0)) - 0) < 1e-9);    // a spread over 1 is 1 (the game's FMin)
});

test('the wait before it repeats: between min and max; max 0 never repeats; min over max is max', () => {
  assert.equal(nextWait(2, 0, rolls(0.5)), 0);
  assert.equal(nextWait(2, 6, rolls(0)), 2);
  assert.equal(nextWait(2, 6, rolls(0.5)), 4);
  assert.equal(nextWait(9, 6, rolls(0.5)), 6);
  assert.equal(nextWait(-3, 4, rolls(0.5)), 2);
});

test('a preview: picks as the game makes them, at the times it would play them', () => {
  const fx = { sounds: ['A.Dog1', 'A.Dog2', 'A.Dog3'], order: 1, volume: 1, pitch: 1, randomVolume: 0, randomPitch: 0, repeatMin: 0, repeatMax: 0 };
  const picks = previewPicks(fx, 4, rolls(0.5));
  assert.deepEqual(picks.map((p) => p.sound), ['A.Dog1', 'A.Dog2', 'A.Dog3', 'A.Dog1']);
  assert.ok(picks.every((p) => p.volume === 1 && p.pitch === 1 && p.wait === 0));
  // it does not repeat by itself: each after the one before has ended (its length at its pitch) and a gap
  assert.deepEqual(timesOf(picks, () => 2).map((t) => Math.round(t * 100) / 100), [0, 2 + PREVIEW_GAP, 2 * (2 + PREVIEW_GAP), 3 * (2 + PREVIEW_GAP)].map((t) => Math.round(t * 100) / 100));
  const repeating = previewPicks({ ...fx, order: 0, randomPitch: 0.2, repeatMin: 3, repeatMax: 5 }, 3, rolls(0.5));
  assert.deepEqual(timesOf(repeating, () => 9), [0, 4, 8]);             // after its wait, however long the sound
  assert.deepEqual(previewPicks({ ...fx, sounds: [] }), []);
});
