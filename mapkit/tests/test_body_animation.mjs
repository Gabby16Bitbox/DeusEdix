// A character's body animation in the Interactions (Gabby, 2 Nov 2026: "when JC presses that button, this character
// plays this animation"): how it plays, kept in the action's c as links.py body_how writes it, and its sentence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_VERBS, BLOCK_WHEN, blockActText, blockWhenText, blockDefaults, bodyHow, bodyHowText } from '../editor/static/interaction-blocks.js';

test('how it plays: read and written back, its speed last (the game finds it after the first x)', () => {
  assert.deepEqual(bodyHow(''), { mode: 'once', own: false, walk: false, rate: 1 });
  assert.deepEqual(bodyHow('loop own x1.5'), { mode: 'loop', own: true, walk: false, rate: 1.5 });
  assert.deepEqual(bodyHow('time walk x99'), { mode: 'time', own: false, walk: true, rate: 10 });
  assert.equal(bodyHowText({ mode: 'time', own: true, walk: true, rate: 0.5 }), 'time own walk x0.5');
  assert.equal(bodyHowText(bodyHow('nonsense')), 'once x1');
  for (const text of ['once x1', 'loop own x1.5', 'time walk x2']) assert.equal(bodyHowText(bodyHow(text)), text);
  assert.ok(!/x/.test(bodyHowText({ mode: 'loop', own: true, walk: true, rate: 1 }).replace(/x[\d.]+$/, '')), 'no x before the speed');
});

test('a new action: its defaults', () => {
  const x = { verb: 'body' };
  blockDefaults(x);
  assert.deepEqual(x, { verb: 'body', a: '', b: '0', c: 'once x1' });
});

test('its sentences and labels', () => {
  assert.equal(BLOCK_VERBS.body[1], 'character');
  assert.equal(blockActText({ verb: 'body', a: 'Wave', c: 'once x1' }, 'Guard1', String), 'Guard1 plays the animation Wave');
  assert.equal(blockActText({ verb: 'body', a: 'Dance', c: 'loop x1' }, 'Guard1', String), 'Guard1 plays the animation Dance over and over');
  assert.equal(blockActText({ verb: 'body', a: 'Wave', b: '6', c: 'time x1' }, 'Guard1', String), 'Guard1 plays the animation Wave for 6 s');
  assert.equal(blockActText({ verb: 'bodystop' }, 'Guard1', String), 'Guard1 stops its body animation');
  assert.ok(BLOCK_WHEN.bodydone);
  assert.equal(blockWhenText('bodydone', 'Guard1'), 'When Guard1 has finished its body animation');
});
