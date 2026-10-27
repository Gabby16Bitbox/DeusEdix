// Properties… windows (static/inspector-windows.js), as Unity's floating Inspector: one window per object of a map, the
// one asked again brought to the front, at most MAX_WINDOWS (one more closes the one used longest ago), opened left of
// the Inspector panel inside the editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WINDOWS, INSPECTOR_EVENTS, windowFor, toFront, cascade } from '../editor/static/inspector-windows.js';

const win = (key, generation = 1) => ({ key, generation });

test('an object with a window open gets that window back, not a second one', () => {
  const list = [win('a:Keypad1'), win('a:DeusExMover3')];
  assert.deepEqual(windowFor(list, 'a:DeusExMover3', 1), { open: list[1], close: null });
  assert.deepEqual(windowFor(list, 'a:Trigger2', 1), { open: null, close: null });
});

test('the same key in another map (another generation) is another object', () => {
  const list = [win('a:Light4', 1)];
  assert.equal(windowFor(list, 'a:Light4', 2).open, null);
});

test('one more than MAX_WINDOWS closes the one used longest ago', () => {
  assert.equal(MAX_WINDOWS, 3);
  let list = [win('a:A'), win('a:B'), win('a:C')];
  assert.equal(windowFor(list, 'a:D', 1).close, list[0]);
  list = toFront(list, list[0]);                       // A used again: B is the oldest now
  assert.deepEqual(list.map((w) => w.key), ['a:B', 'a:C', 'a:A']);
  assert.equal(windowFor(list, 'a:D', 1).close.key, 'a:B');
  assert.equal(windowFor(list, 'a:C', 1).close, null, 'its own window: nothing closes');
});

test('the windows open left of the Inspector panel, each a step lower, always inside the editor', () => {
  const room = { width: 1280, height: 720, panel: 272, top: 28 };
  const at = [0, 1, 2].map((n) => cascade(n, room));
  assert.ok(at.every((p) => p.x + 300 <= room.width - room.panel), 'not over the panel');
  assert.ok(at[1].x < at[0].x && at[1].y > at[0].y);
  assert.deepEqual(cascade(3, room), at[0], 'the fourth where the first was');
  for (const small of [{ width: 320, height: 240, panel: 272, top: 28 }, { width: 200, height: 100 }]) {
    const p = cascade(2, small);
    assert.ok(p.x >= 0 && p.y >= (small.top || 0) && p.y <= small.height, JSON.stringify(p));
  }
});

test('the events that put a window\'s Inspector at work include what its fields and drags use', () => {
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click', 'contextmenu', 'keydown', 'input', 'change', 'focusin', 'toggle', 'drop'])
    assert.ok(INSPECTOR_EVENTS.includes(type), type);
  assert.equal(new Set(INSPECTOR_EVENTS).size, INSPECTOR_EVENTS.length);
});
