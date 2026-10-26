// The selection's logic (static/selection-tools.js): what is under the pointer and the click that cycles
// through it, Invert selection, and Edit > Previous / Next selection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROXY_LEAD, stackKeys, createPickCycle, invertPick, createSelectionHistory } from '../editor/static/selection-tools.js';

const live = () => true;

test('under the pointer: nearest first, each thing once, an icon just behind a wall still in front', () => {
  const hits = [
    { key: 's:Room', distance: 100, proxy: false },
    { key: 'a:Light3', distance: 100 + PROXY_LEAD - 1, proxy: true },       // inside the wall's face: as a click has it
    { key: 'a:Lamp', distance: 60, proxy: true },
    { key: 'a:Lamp', distance: 64, proxy: true },                           // its other side
    { key: 's:Far', distance: 900, proxy: false },
  ];
  assert.deepEqual(stackKeys(hits), ['a:Lamp', 'a:Light3', 's:Room', 's:Far']);
  assert.deepEqual(stackKeys([]), []);
});

test("the map's own walls are one step of their own (nothing to select), where they are", () => {
  const hits = [{ key: 'a:Crate', distance: 300, proxy: true }, { key: null, distance: 120 }, { key: null, distance: 500 }];
  assert.deepEqual(stackKeys(hits), [null, 'a:Crate']);                     // a click on the wall: nothing, again: the crate
  const cycle = createPickCycle();
  const keys = stackKeys(hits);
  assert.equal(cycle.next([5, 5], keys, null), 0);
  assert.equal(cycle.next([5, 5], keys, null), 1);                          // nothing selected was the wall's step
  assert.equal(cycle.next([5, 5], keys, 'a:Crate'), 0);
  assert.deepEqual(stackKeys([{ key: 'a:Lamp', distance: 10, proxy: true }, { key: undefined, distance: 20 }], () => 'n:n1'), ['n:n1', 'a:Lamp', null]);
});

test('the nearest thing in a nest: the nest first (what a click picks), then the thing itself', () => {
  const nestOf = (k) => (k === 'a:Lamp' || k === 'a:Light3' ? 'n:n1' : null);
  const hits = [{ key: 'a:Lamp', distance: 10, proxy: true }, { key: 'a:Light3', distance: 12, proxy: true }, { key: 's:Room', distance: 50 }];
  assert.deepEqual(stackKeys(hits, nestOf), ['n:n1', 'a:Lamp', 'a:Light3', 's:Room']);
  // a nest further back is not promoted: its things are reached one by one
  assert.deepEqual(stackKeys([{ key: 's:Room', distance: 5 }, ...hits], nestOf), ['s:Room', 'a:Lamp', 'a:Light3']);
});

test('click again on the same spot: the next one behind the selected, and round again', () => {
  const cycle = createPickCycle(4), keys = ['a:Lamp', 'a:Light3', 's:Room'];
  assert.equal(cycle.next([100, 100], keys, null), 0);
  assert.equal(cycle.next([102, 101], keys, 'a:Lamp'), 1);
  assert.equal(cycle.next([101, 99], keys, 'a:Light3'), 2);
  assert.equal(cycle.next([100, 100], keys, 's:Room'), 0);                 // wraps
  assert.equal(cycle.next([100, 100], keys, 'a:Other'), 0);                // the selection is not under it: the nearest
});

test('click again after Esc, or with several selected: the nearest, not past the walls', () => {
  const cycle = createPickCycle(4), keys = ['s:Room', 'b:Box1', null, 'a:Lamp'];
  assert.equal(cycle.next([50, 50], keys, null), 0);                       // the room
  assert.equal(cycle.next([50, 50], keys, null), 0);                       // Esc since: the room again, not 'a:Lamp'
  assert.equal(cycle.next([50, 50], keys, undefined), 0);                  // several selected
  assert.equal(cycle.next([50, 50], keys, 's:Room'), 1);
});

test("a double click's second click keeps the pick; a later click goes on", () => {
  const cycle = createPickCycle(4, 500), keys = ['a:Lamp', 's:Room'];
  assert.equal(cycle.next([10, 10], keys, null, 1000), 0);
  assert.equal(cycle.next([10, 10], keys, 'a:Lamp', 1200), 0);             // 200 ms: the double click
  assert.equal(cycle.next([10, 10], keys, 'a:Lamp', 2000), 1);             // 800 ms: click again
});

test('a click elsewhere, or over other things, starts from the nearest again', () => {
  const cycle = createPickCycle(4), keys = ['a:Lamp', 'a:Light3'];
  cycle.next([100, 100], keys, null);
  assert.equal(cycle.next([110, 100], keys, 'a:Lamp'), 0);                 // 10 pixels away
  assert.equal(cycle.next([110, 100], ['a:Light3', 'a:Lamp'], 'a:Light3'), 0);   // the view moved: another stack
  assert.equal(cycle.next([110, 100], [], 'a:Light3'), -1);                // nothing there
  assert.equal(cycle.next([110, 100], ['a:Light3', 'a:Lamp'], null), 0);   // after nothing: the nearest
});

test('invert: what can be picked and is not taken', () => {
  assert.deepEqual(invertPick(['a', 'b', 'c', 'd'], ['b', 'd']), ['a', 'c']);
  assert.deepEqual(invertPick(['a', 'b'], []), ['a', 'b']);
  assert.deepEqual(invertPick(['a', 'b'], ['a', 'b']), []);
});

test('history: back and forward through the selections, a new one drops what was ahead', () => {
  const h = createSelectionHistory();
  h.record('map', ['a:A']); h.record('map', ['a:B']); h.record('map', ['a:C', 'a:D']);
  assert.equal(h.canStep('map', 1, ['a:C', 'a:D']), false);
  assert.deepEqual(h.step('map', -1, ['a:C', 'a:D'], live), ['a:B']);
  h.record('map', ['a:B']);                                                 // selecting it again is no new step
  assert.deepEqual(h.step('map', -1, ['a:B'], live), ['a:A']);
  assert.equal(h.step('map', -1, ['a:A'], live), null);
  assert.deepEqual(h.step('map', 1, ['a:A'], live), ['a:B']);
  h.record('map', ['a:E']);                                                 // after going back: C+D are gone
  assert.equal(h.canStep('map', 1, ['a:E']), false);
  assert.deepEqual(h.step('map', -1, ['a:E'], live), ['a:B']);
});

test('history: the same keys in another order are the same selection; nothing selected is no step', () => {
  const h = createSelectionHistory();
  h.record('map', ['a:A', 'a:B']); h.record('map', ['a:B', 'a:A']); h.record('map', []);
  assert.equal(h.canStep('map', -1, ['a:A', 'a:B']), false);
  // Esc deselected: Back brings the last selection back
  assert.equal(h.canStep('map', -1, []), true);
  assert.deepEqual(h.step('map', -1, [], live), ['a:A', 'a:B']);
});

test('history: deleted things are dropped, a selection with nothing left is skipped', () => {
  const h = createSelectionHistory(), gone = new Set(['a:B', 'a:C']);
  h.record('map', ['a:A', 'a:X']); h.record('map', ['a:B']); h.record('map', ['a:C', 'a:X']); h.record('map', ['a:D']);
  const alive = (k) => !gone.has(k);
  assert.deepEqual(h.step('map', -1, ['a:D'], alive), ['a:X']);             // C went, X is left of it
  assert.deepEqual(h.step('map', -1, ['a:X'], alive), ['a:A', 'a:X']);      // B: nothing left, skipped
  assert.deepEqual(h.step('map', 1, ['a:A', 'a:X'], alive), ['a:X']);
});

test('history: at most `limit` selections, one map at a time', () => {
  const h = createSelectionHistory(3);
  for (const k of ['a:1', 'a:2', 'a:3', 'a:4']) h.record('map', [k]);
  assert.deepEqual(h.step('map', -1, ['a:4'], live), ['a:3']);
  assert.deepEqual(h.step('map', -1, ['a:3'], live), ['a:2']);
  assert.equal(h.step('map', -1, ['a:2'], live), null);                     // a:1 fell out
  assert.equal(h.canStep('other', -1, []), false);                          // another map has its own
  assert.equal(h.step('other', -1, [], live), null);
  h.record('other', ['a:Z']);
  assert.equal(h.step('map', -1, ['a:2'], live), null);                     // back to the first: started anew
});
