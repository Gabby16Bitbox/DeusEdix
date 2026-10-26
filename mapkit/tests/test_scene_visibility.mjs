// Isolate and Show hidden (static/scene-visibility.js): what the 3D view shows for the moment, on the keys the
// eye and nests use (an object's own key first, then its structure's and its nests').
import test from 'node:test';
import assert from 'node:assert/strict';
import { isolationOutside, createSceneVisibility } from '../editor/static/scene-visibility.js';

// a room (a structure) with a desk and a keypad in it, a guard in a folder, a crate on its own
const ROOM = ['s:Room'], DESK = ['a:Desk', 's:Room'], KEYPAD = ['a:Keypad', 's:Room'], GUARD = ['a:Guard', 'n:n1'], CRATE = ['a:Crate'];
const ALL = [ROOM, DESK, KEYPAD, GUARD, CRATE];
const sorted = (set) => [...set].sort();

test('an object picked alone: shown with the structure it stands in, its neighbours hidden', () => {
  assert.deepEqual(sorted(isolationOutside(ALL, [DESK])), ['a:Crate', 'a:Guard', 'a:Keypad']);
});

test('a structure picked: its objects come with it', () => {
  assert.deepEqual(sorted(isolationOutside(ALL, [ROOM])), ['a:Crate', 'a:Guard']);
});

test('several picked, and a nest holding the picked object is not shown whole', () => {
  assert.deepEqual(sorted(isolationOutside(ALL, [GUARD, CRATE])), ['a:Desk', 'a:Keypad', 's:Room']);
  assert.deepEqual(sorted(isolationOutside([...ALL, ['a:Lamp', 'n:n1']], [GUARD])), ['a:Crate', 'a:Desk', 'a:Keypad', 'a:Lamp', 's:Room']);
});

test('objects without a key are never hidden by Isolate', () => {
  assert.deepEqual(sorted(isolationOutside([[], CRATE, GUARD], [CRATE])), ['a:Guard']);
});

test('Isolate: how many it shows, exit once, objects added later are shown', () => {
  const view = createSceneVisibility();
  assert.equal(view.isolated, 0);
  assert.equal(view.exit(), false);
  assert.equal(view.isolate(ALL, [DESK]), 2);
  assert.equal(view.isolated, 2);
  assert.equal(view.hides('a:Keypad', false), true);
  assert.equal(view.hides('a:Desk', false), false);
  assert.equal(view.hides('s:Room', false), false);
  assert.equal(view.hides('a:Copy', false), false, 'a copy made while isolated is shown');
  assert.equal(view.exit(), true);
  assert.equal(view.exit(), false);
  assert.equal(view.hides('a:Keypad', false), false);
});

test('Show hidden reveals what the eye hid, never what Isolate hides; reset ends both', () => {
  const view = createSceneVisibility();
  assert.equal(view.hides('a:Desk', true), true);
  view.setReveal(true);
  assert.equal(view.reveal, true);
  assert.equal(view.hides('a:Desk', true), false);
  view.isolate(ALL, [DESK]);
  assert.equal(view.hides('a:Keypad', true), true);
  assert.equal(view.hides('a:Desk', true), false);
  view.setReveal(false);
  assert.equal(view.hides('a:Desk', true), true, 'inside the isolation the eye still hides');
  view.setReveal(true);
  view.reset();
  assert.equal(view.reveal, false);
  assert.equal(view.isolated, 0);
  assert.equal(view.hides('a:Keypad', false), false);
});
