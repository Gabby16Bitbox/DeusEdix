// The Rebuild in the background (static/build-progress.js): the chip's stage, time and estimate, the keys that still
// work while it runs (the others wait), and the Build report for Messages: time per stage, the counts of the build
// output, the warnings with their Check map link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_STAGES, MODE_NAMES, clock, chipView, LOOK_KEYS, waitsForBuild, browserKey, PRESSABLE, isWarning, countRows, buildReport }
  from '../editor/static/build-progress.js';

test('seconds read as a clock', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(7.4), '0:07');
  assert.equal(clock(65), '1:05');
  assert.equal(clock(760.2), '12:40');
  assert.equal(clock(-3), '0:00');
  assert.equal(clock(undefined), '0:00');
});

test('the chip says the stage, the time so far and the last build of the map', () => {
  assert.deepEqual(chipView({ label: 'Lighting', elapsed: 23.4, estimate: 41 }),
    { cancelling: false, stage: 'Lighting', time: '0:23 · last time 0:41',
      title: 'Rebuilding: Lighting (the last build of this map took 0:41). The view is look-only until it ends.' });
  const first = chipView({ label: PAGE_STAGES.save, elapsed: 0.3 });
  assert.equal(first.time, '0:00');                       // no build of this map yet: no estimate
  assert.equal(first.stage, 'Saving');
  const stopping = chipView({ label: 'CSG and BSP', elapsed: 9, estimate: 30, cancelling: true });
  assert.equal(stopping.stage, 'Cancelling…');
  assert.equal(stopping.cancelling, true);
  assert.match(stopping.title, /stays as it was/);
});

test('keys that only look go on during a build, the others wait', () => {
  for (const combo of ['F', 'Shift+F', 'Esc', 'Ctrl+A', 'Shift+D', 'Ctrl+C', 'Ctrl+K', 'Ctrl+Shift+[', 'Shift+Space', 'P', 'L',
    '3', 'Ctrl+3', 'Alt+7', 'Ctrl+Alt+9', 'Shift+1'])
    assert.equal(waitsForBuild(combo), false, combo);
  for (const combo of ['Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Ctrl+V', 'Ctrl+D', 'Ctrl+X', 'Ctrl+G', 'Delete', 'End', 'B', 'T', 'Q',
    'V', 'Enter', 'F2', 'Ctrl+S', 'Ctrl+\\', 'Ctrl+Shift+F', 'Ctrl+Alt+F', 'Shift+P', 'Backspace', '0'])
    assert.equal(waitsForBuild(combo), true, combo);
  assert.equal(waitsForBuild(''), false);                  // a modifier alone
  assert.ok(LOOK_KEYS.has('Ctrl+U'));
  // G30: Face selection's Grow selects (it goes on); Alt+0 puts a recent texture on faces (it waits)
  for (const combo of ['Alt+G', 'Alt+Shift+G']) assert.equal(waitsForBuild(combo), false, combo);
  assert.equal(waitsForBuild('Alt+0'), true);
});

test('the browser\'s own keys go on during a build: Tab always, Enter and Space on a button, a link or a fold', () => {
  for (const combo of ['Tab', 'Shift+Tab']) {
    assert.equal(waitsForBuild(combo), true, combo);         // (not a key of the editor's: the gate asks browserKey first)
    assert.equal(browserKey(combo, false), true, combo);
  }
  for (const combo of ['Enter', 'Space']) {
    assert.equal(browserKey(combo, true), true, combo);
    assert.equal(browserKey(combo, false), false, combo + ': on the 3D view it is the editor\'s (Enter renames a folder)');
  }
  for (const combo of ['Delete', 'Ctrl+Z', 'Ctrl+Tab', 'Alt+Tab', 'Shift+Enter']) assert.equal(browserKey(combo, true), false, combo);
  assert.deepEqual(PRESSABLE.split(', '), ['button', 'a[href]', 'summary', '[role="button"]']);
});

test('warnings are the lines that say something may be wrong', () => {
  for (const line of ['  IN SOLID: Light|Light3|0 0 0', '  ZONE Pool is not closed: it is part of the zone of the map',
    '  TEXTURE floor Brick_A: stretched (12 faces)', '  STRETCHED: Wall_B tile 64 on a 256x256 texture (x4.00)',
    '  DROP: Crate Crate0 found no surface below (1 2 3)', '  SNAP: Sign Sign1 found no wall toward east',
    '  EDIT skipped Barrel4 (not in the map any more)', '  DRAWN Road2 not built: too few points',
    'Prefab snapshot not available: gone. Rebuild before saving a prefab.', '  LIGHT APPLY crashed in the graphics driver: retry 2/4'])
    assert.equal(isWarning(line), true, line);
  for (const line of ['built 01_Lab in 12.3s  (rebuilt: geometry, lighting, paths)', '  EDIT block Box3', '  EDIT music: Song',
    '  REBUILD Forcing lighting, including unchanged data; required edits are also rebuilt.', '  paths kept as they are (edits: paths = false)'])
    assert.equal(isWarning(line), false, line);
});

test('the counts of the output, one row each', () => {
  assert.deepEqual(countRows({ nodes: 2577, surfaces: 1803, zones: 2, lights: 54, points: 120, reachspecs: 340, pruned: 12, kept: 5 }),
    ['BSP: 2577 nodes, 1803 surfaces, 2 zones', 'Lighting: 54 lights', "AI paths: 120 points, 340 reach specs (12 pruned), 5 of the map's own put back"]);
  assert.deepEqual(countRows({ lights: 1, zones: 1 }), ['BSP: 1 zone', 'Lighting: 1 light']);
  assert.deepEqual(countRows({ kept: 3 }), ["AI paths: 3 of the map's own put back"]);
  assert.deepEqual(countRows({}), []);
  assert.deepEqual(countRows(undefined), []);
});

test('total elapsed includes opening the map and request waits without double counting stages', () => {
  const rows = buildReport({ map: 'Example', mode: 'full', state: 'done', elapsed: 23.4,
    page: [{ label: 'Saving', seconds: 0.2 }], report: { stages: [{ label: 'Geometry', seconds: 17 }] },
    after: [{ label: 'Opening map', seconds: 4 }] });
  assert.match(rows[0].text, /in 0:23$/);
  assert.match(rows.at(-1).text, /Opening map: 4.0 s/);
  assert.match(rows[2].text, /Geometry/);
});

const page = [{ label: 'Saving', seconds: 0.4 }, { label: 'Walkable area', seconds: 0.02 }];
const report = { stages: [{ id: 'prepare', label: 'Preparing', seconds: 1.2 }, { id: 'bsp', label: 'CSG and BSP', seconds: 12 },
  { id: 'lights', label: 'Lighting', seconds: 61.5 }], counts: { nodes: 10, surfaces: 8, zones: 2, lights: 3 } };

test('the Build report: the time of each stage, the counts, the warnings with Check map', () => {
  const rows = buildReport({ map: '01_Lab', mode: 'full', state: 'done', page, report,
    lines: ['built 01_Lab in 74.7s', '  IN SOLID: Light|Light3|0 0 0', '  EDIT block Box3'] });
  assert.deepEqual(rows, [
    { text: 'Build report · 01_Lab: Full rebuild in 1:15', cls: 'ok' },
    { text: '  Saving: 0.4 s' }, { text: '  Preparing: 1.2 s' }, { text: '  CSG and BSP: 12.0 s' }, { text: '  Lighting: 1:02' },
    { text: '  BSP: 10 nodes, 8 surfaces, 2 zones' }, { text: '  Lighting: 3 lights' },
    { text: '  1 warning:', cls: 'warn' }, { text: '  IN SOLID: Light|Light3|0 0 0', cls: 'warn', check: true },
  ]);
  assert.equal(MODE_NAMES.auto, 'Rebuild');
  assert.equal(buildReport({ map: 'M', mode: 'nonsense', state: 'done' })[0].text, 'Build report · M: Rebuild in 0:00');
});

test('a failed build says it, a cancelled one gives its times only', () => {
  const failed = buildReport({ map: '01_Lab', mode: 'auto', state: 'failed', page, report: { stages: report.stages.slice(0, 2), counts: {} },
    lines: ['The rebuild failed: host run failed'] });
  assert.deepEqual(failed[0], { text: 'Build report · 01_Lab: Rebuild failed after 0:14', cls: 'bad' });
  assert.equal(failed.length, 4);                          // the head and three stages: no counts, no warnings in the lines
  const cancelled = buildReport({ map: '01_Lab', mode: 'lighting', state: 'cancelled', page, report,
    lines: ['  IN SOLID: Light|Light3|0 0 0'] });
  assert.deepEqual(cancelled[0], { text: 'Build report · 01_Lab: Rebuild lighting cancelled after 1:15, the map is as it was before it', cls: 'warn' });
  assert.equal(cancelled.length, 5);
  assert.ok(cancelled.every((r) => !r.check));
});
