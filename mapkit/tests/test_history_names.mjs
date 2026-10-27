// The undo history's named steps (static/history-names.js): a name stays with its snapshot through undo, redo, a step
// taken back unused and the cap; Edit > Undo and Redo say the step they take; the History panel's rows (newest first,
// the map as opened at the bottom) and how far a click on one goes.
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
