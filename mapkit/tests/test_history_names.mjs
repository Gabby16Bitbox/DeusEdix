// The undo history's named steps (static/history-names.js): a name stays with its snapshot through undo, redo, a step
// taken back unused and the cap, and so does what the page keeps of its edits (page, given after the cap); Edit > Undo
// and Redo say the step they take; the History panel's rows (newest first, the map as opened at the bottom) and how far
// a click on one goes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_LIMIT, MAP_OPENED, OLDEST_KEPT, UNNAMED, createHistory, clearHistory, stepName, namedStep, propertyName,
  recordStep, dropStep, renameStep, travelStep, menuLabel, currentName, historyRows, stepsTo } from '../editor/static/history-names.js';

// a map whose edits are a number: each change adds one, as app.js does with its edits' JSON
function page() {
  const h = createHistory();
  let edits = 0;
  return {
    h, get edits() { return edits; },
    change(label) { recordStep(h, String(edits), label); edits++; },
    step(way) { const s = travelStep(h, way, String(edits)); if (s) edits = +s.state; return s; },
  };
}
const shown = (h) => historyRows(h).map((r) => `${r.current ? '>' : ' '}${r.redo ? '~' : ''}${r.label} ${r.at}`);

test('a name is one short line; none is Change', () => {
  assert.equal(stepName('  Move\n 3   objects '), 'Move 3 objects');
  assert.equal(stepName(''), UNNAMED);
  assert.equal(stepName(undefined), UNNAMED);
  assert.equal(stepName(null), UNNAMED);
  const long = stepName('Apply texture ' + 'x'.repeat(100));
  assert.equal(long.length, 60);
  assert.ok(long.endsWith('…'));
});

test('a step is named after what it did and to what', () => {
  assert.equal(namedStep('Move', ['Light4']), 'Move Light4');
  assert.equal(namedStep('Move', ['Light4', 'Light5', 'Barrel']), 'Move 3 objects');
  assert.equal(namedStep('Fill AI paths', []), 'Fill AI paths');
  assert.equal(namedStep('Align', ['Light4'], 'with the view'), 'Align Light4 with the view');
  assert.equal(namedStep('Align', ['A', 'B'], 'with the view'), 'Align 2 objects with the view');
  assert.equal(propertyName('LightBrightness'), 'Light brightness');
  assert.equal(propertyName('bHidden'), 'Hidden');
  assert.equal(propertyName('AIHorizon'), 'AI horizon');
  assert.equal(propertyName('MaxStepHeight'), 'Max step height');
  assert.equal(propertyName('Tag'), 'Tag');
  assert.equal(propertyName('MultiSkins[2]'), 'Multi skins[2]');
  assert.equal(propertyName('bIsSecretGoal'), 'Is secret goal');
});

test('undo and redo carry each name with its snapshot; a new change empties Redo', () => {
  const p = page();
  p.change('Move Light4'); p.change('Light brightness of Light4'); p.change('Delete Barrel');
  assert.equal(p.edits, 3);
  assert.equal(menuLabel(p.h, 'undo'), 'Undo Delete Barrel');
  assert.equal(menuLabel(p.h, 'redo'), 'Redo');
  assert.equal(p.step('undo').label, 'Delete Barrel');
  assert.equal(p.edits, 2);
  assert.equal(menuLabel(p.h, 'undo'), 'Undo Light brightness of Light4');
  assert.equal(menuLabel(p.h, 'redo'), 'Redo Delete Barrel');
  assert.equal(p.step('undo').label, 'Light brightness of Light4');
  assert.equal(p.step('redo').label, 'Light brightness of Light4');
  assert.equal(p.edits, 2);
  assert.equal(currentName(p.h), 'Light brightness of Light4');
  p.change('Fill AI paths');                                       // another past: Delete Barrel cannot come back
  assert.equal(p.h.redo.length, 0);
  assert.equal(menuLabel(p.h, 'redo'), 'Redo');
  assert.deepEqual(p.h.undo.map((s) => s.label), ['Move Light4', 'Light brightness of Light4', 'Fill AI paths']);
  while (p.step('undo'));
  assert.equal(p.edits, 0);
  assert.equal(currentName(p.h), MAP_OPENED);
  assert.equal(menuLabel(p.h, 'undo'), 'Undo');
  assert.equal(p.step('undo'), null);                              // nothing more: nothing changes
  assert.equal(p.edits, 0);
});

test('a step taken back unused takes its name with it, and so does the cap', () => {
  const p = page();
  p.change('Move Light4');
  recordStep(p.h, String(p.edits), 'Move cutscene key');           // a drag that is let go where it began
  assert.equal(dropStep(p.h).label, 'Move cutscene key');
  assert.equal(menuLabel(p.h, 'undo'), 'Undo Move Light4');
  assert.deepEqual(historyRows(p.h).map((r) => r.label), ['Move Light4', MAP_OPENED]);
  assert.equal(dropStep(createHistory()), null);
  const q = page();
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) q.change(`Step ${i}`);
  assert.equal(q.h.undo.length, HISTORY_LIMIT);
  assert.equal(q.h.undo[0].label, 'Step 5');                       // the oldest went with their snapshots
  assert.equal(q.h.undo[0].state, '5');
  const rows = historyRows(q.h);
  assert.equal(rows.at(-1).label, OLDEST_KEPT);                    // not the map as it was opened any more
  assert.equal(rows.at(-1).at, -HISTORY_LIMIT);
  while (q.step('undo'));
  assert.equal(q.edits, 5);
  assert.equal(currentName(q.h), OLDEST_KEPT);
  clearHistory(q.h);
  assert.deepEqual(q.h, createHistory());
});

test('a step taken back unused leaves the history as it was: Redo keeps its steps, the cap gives the oldest back', () => {
  const p = page();
  p.change('Move Light4'); p.change('Delete Barrel'); p.change('Fill AI paths');
  p.step('undo'); p.step('undo');
  const before = shown(p.h);
  recordStep(p.h, String(p.edits), 'Move an animation key');      // a click on a key, or on the gizmo, that moved nothing
  assert.equal(p.h.redo.length, 0);                                // (while it is held, a change would empty Redo)
  assert.equal(dropStep(p.h).label, 'Move an animation key');
  assert.deepEqual(shown(p.h), before);
  assert.equal(menuLabel(p.h, 'redo'), 'Redo Delete Barrel');
  assert.equal(p.step('redo').label, 'Delete Barrel');            // Ctrl+Y still brings them back
  assert.equal(p.edits, 2);
  // a step dropped after a step back or forward is only taken off: nothing older comes back with it
  p.change('Apply texture Wall_A');
  p.step('undo'); p.step('redo');
  assert.equal(dropStep(p.h).label, 'Apply texture Wall_A');
  assert.equal(p.h.redo.length, 0);
  // at the cap: the oldest step the click pushed out comes back, and the bottom is the map as opened again
  const q = page();
  for (let i = 0; i < HISTORY_LIMIT; i++) q.change(`Step ${i}`);
  const full = shown(q.h);
  recordStep(q.h, String(q.edits), 'Move Light4');
  assert.equal(q.h.undo[0].label, 'Step 1');
  assert.equal(historyRows(q.h).at(-1).label, OLDEST_KEPT);
  dropStep(q.h);
  assert.deepEqual(shown(q.h), full);
  assert.equal(historyRows(q.h).at(-1).label, MAP_OPENED);
});

test('an Alt copy that goes on to be moved is one step, renamed', () => {
  const p = page();
  p.change('Duplicate Light4');
  renameStep(p.h, 'Duplicate and move Light4');
  assert.deepEqual(p.h.undo.map((s) => s.label), ['Duplicate and move Light4']);
  renameStep(createHistory(), 'nothing to rename');                // no step: nothing happens
});

test('the rows: newest first, Redo\'s dimmed above the current one, the map as opened at the bottom', () => {
  const p = page();
  assert.deepEqual(shown(p.h), [`>${MAP_OPENED} 0`]);
  p.change('Move Light4'); p.change('Apply texture Wall_A'); p.change('Fill AI paths'); p.change('Delete Barrel');
  p.step('undo'); p.step('undo');
  assert.deepEqual(shown(p.h), [' ~Delete Barrel 2', ' ~Fill AI paths 1', '>Apply texture Wall_A 0', ' Move Light4 -1', ` ${MAP_OPENED} -2`]);
  const rows = historyRows(p.h);
  assert.equal(rows.filter((r) => r.current).length, 1);
  assert.ok(rows.at(-1).bottom && !rows[0].bottom);
  // a click on a row: that many steps, and the map is at that row
  for (const target of [...rows].reverse()) {
    const { way, count } = stepsTo(historyRows(p.h).find((r) => r.label === target.label).at);
    for (let i = 0; i < count; i++) p.step(way);
    assert.equal(currentName(p.h), target.label);
    assert.equal(historyRows(p.h).find((r) => r.current).label, target.label);
  }
  assert.equal(p.edits, 4);                                         // the top row: every step redone
  assert.deepEqual(stepsTo(0), { way: 'redo', count: 0 });
  assert.deepEqual(stepsTo(-3), { way: 'undo', count: 3 });
});

test('what the page keeps of each step\'s edits goes with them: undone, redone, a step taken back unused, the cap and what it gives back', () => {
  // the page's own state of the edits (app.js gives what the Texture Slip's slips know), an object per state as the
  // edits are a number: each change's step holds the page's state before it; a step back or forward gives back the one
  // its edits had, and its way back holds the state left; a step taken back unused and the cap keep them with their
  // snapshots
  const h = createHistory(), pages = [];
  let edits = 0, now = null;
  const change = (label) => { recordStep(h, String(edits), label, undefined, now); edits++; now = { edits }; pages[edits] = now; };
  const step = (way) => { const s = travelStep(h, way, String(edits), now); if (s) { edits = +s.state; now = s.page; } return s; };
  change('Slip the texture'); change('Pan the texture'); change('Slip the texture');
  assert.deepEqual(h.undo.map((s) => s.page), [null, pages[1], pages[2]]);
  step('undo');
  assert.deepEqual([edits, now], [2, pages[2]]);
  step('undo'); step('undo');
  assert.deepEqual([edits, now], [0, null]);
  step('redo'); step('redo'); step('redo');
  assert.deepEqual([edits, now], [3, pages[3]]);
  const plain = createHistory();
  recordStep(plain, '0', 'Move Light4');
  travelStep(plain, 'undo', '1');
  assert.deepEqual([plain.undo, plain.redo], [[], [{ state: '1', label: 'Move Light4', page: null }]], 'none given: null');
  // a click that moved nothing after two Undos: Redo keeps its steps and their pages
  step('undo'); step('undo');
  recordStep(h, String(edits), 'Move Light4', undefined, now);
  dropStep(h);
  step('redo');
  assert.deepEqual([edits, now], [2, pages[2]]);
  // the cap: the oldest steps go with their pages, a step taken back unused gives them back
  const q = createHistory();
  for (let i = 0; i < HISTORY_LIMIT; i++) recordStep(q, String(i), `Step ${i}`, undefined, { i });
  const oldest = q.undo[0];
  recordStep(q, String(HISTORY_LIMIT), 'Move Light4', undefined, { i: HISTORY_LIMIT });
  assert.equal(q.undo[0].page.i, 1);
  dropStep(q);
  assert.equal(q.undo[0], oldest);
});

test('the page comes after the cap: a caller that gives a cap as before still caps at it, and one that gives a page and leaves the cap keeps HISTORY_LIMIT steps', () => {
  // (app.js gives undefined for the cap, then the page: an older history-names.js, whose fourth parameter is the cap,
  // takes that undefined as its own cap and never sees the page. With the page fourth, a page given there was read as
  // the cap by an older module, and a cap given there as the page: no step kept, or every step kept)
  assert.equal(recordStep.length, 3);                               // (the cap and the page have defaults)
  const capped = createHistory(), paged = createHistory();
  for (let i = 0; i < HISTORY_LIMIT + 50; i++) {
    recordStep(capped, String(i), `Step ${i}`, 3);
    recordStep(paged, String(i), `Step ${i}`, undefined, new Map([['Brush2', i]]));
  }
  assert.deepEqual([capped.undo.length, capped.undo.at(-1).page], [3, null]);
  assert.deepEqual([paged.undo.length, paged.undo.at(-1).page.get('Brush2')], [HISTORY_LIMIT, HISTORY_LIMIT + 49]);
  const four = createHistory();
  for (let i = 0; i < HISTORY_LIMIT + 50; i++) recordStep(four, String(i), `Step ${i}`, HISTORY_LIMIT);
  assert.equal(four.undo.length, HISTORY_LIMIT, 'four arguments, the cap as before');
});
