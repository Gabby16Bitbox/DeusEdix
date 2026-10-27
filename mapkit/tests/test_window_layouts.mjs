// Saved window layouts and Maximize panel (static/window-layouts.js), as Unity's Layout menu and Shift+Space: names kept
// clean and once, at most MAX_LAYOUTS, the stored list and imported files checked by workspace.js's own validateLayout,
// Export's file read back by Import, and the layout shown while the 3D view is maximized.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LAYOUTS, NAME_LENGTH, layoutName, findLayout, withLayout, withoutLayout, readLayouts, layoutsFile, importLayouts,
  nextMaximized, shownLayout, uncovered } from '../editor/static/window-layouts.js';
import { defaultLayout, validateLayout, fitLayout } from '../editor/static/workspace.js';

const story = () => { const l = defaultLayout(); l.panels.browser.hidden = true; l.sizes.right = 400; return l; };

test('a name is trimmed, its spaces one, cut at NAME_LENGTH; an empty one is refused', () => {
  assert.equal(layoutName('  Story   writing '), 'Story writing');
  assert.equal(layoutName('x'.repeat(80)).length, NAME_LENGTH);
  for (const bad of ['', '   ', null, undefined]) assert.throws(() => layoutName(bad), /name/);
});

test('saving under a name used (in any case) replaces it in its place; a new one goes last; at most MAX_LAYOUTS', () => {
  let list = withLayout([], 'Story', story());
  list = withLayout(list, 'Lighting', defaultLayout());
  list = withLayout(list, 'story', defaultLayout());
  assert.deepEqual(list.map((l) => l.name), ['story', 'Lighting']);
  assert.equal(findLayout(list, 'STORY').state.sizes.right, defaultLayout().sizes.right);
  for (let i = list.length; i < MAX_LAYOUTS; i++) list = withLayout(list, 'L' + i, defaultLayout());
  assert.equal(list.length, MAX_LAYOUTS);
  assert.throws(() => withLayout(list, 'One more', defaultLayout()), /At most/);
  assert.equal(withLayout(list, 'lighting', story()).length, MAX_LAYOUTS, 'replacing one is still allowed');
  assert.deepEqual(withoutLayout(list, 'LIGHTING').map((l) => l.name), list.map((l) => l.name).filter((n) => n !== 'Lighting'));
});

test('the stored list is read back checked: broken entries left out, each state a valid layout, names once', () => {
  const kept = [{ name: 'Story', state: story() }, { name: 'story', state: defaultLayout() }, { name: '', state: defaultLayout() },
    { name: 'No state' }, null, 'junk', { name: 'Odd', state: { version: 1, sizes: { left: 99999 } } }];
  const list = readLayouts(JSON.parse(JSON.stringify(kept)), validateLayout);
  assert.deepEqual(list.map((l) => l.name), ['Story', 'Odd']);
  assert.deepEqual(list[0].state, validateLayout(story()));
  assert.equal(list[1].state.sizes.left, 700, 'a size out of range is brought back in');
  for (const value of [null, {}, 'x', 3]) assert.deepEqual(readLayouts(value, validateLayout), []);
});

test('Export writes every layout, Import reads it back into another list (same names replaced)', () => {
  const mine = withLayout(withLayout([], 'Story', story()), 'Lighting', defaultLayout());
  const theirs = withLayout([], 'lighting', story());
  const { list, names } = importLayouts(theirs, layoutsFile(mine), validateLayout, 'deusedix-layouts.json');
  assert.deepEqual(names, ['Story', 'Lighting']);
  assert.deepEqual(list.map((l) => l.name), ['Lighting', 'Story']);
  assert.deepEqual(findLayout(list, 'lighting').state, validateLayout(defaultLayout()));
});

test('Import takes a single layout as getState gives it, named after its file; a file of anything else is refused', () => {
  const { list, names } = importLayouts([], JSON.stringify(story()), validateLayout, 'Texture work.json');
  assert.deepEqual(names, ['Texture work']);
  assert.equal(list[0].state.panels.browser.hidden, true);
  assert.throws(() => importLayouts([], 'not json', validateLayout), /not JSON/);
  for (const text of ['{}', '[]', '{"kind":"deusedix-layouts","layouts":[]}', '{"version":2,"panels":{}}'])
    assert.throws(() => importLayouts([], text, validateLayout), /no window layout/, text);
  const full = Array.from({ length: MAX_LAYOUTS }, (_, i) => ({ name: 'L' + i, state: defaultLayout() }));
  assert.throws(() => importLayouts(full, JSON.stringify(story()), validateLayout, 'New'), /At most/);
});

test('Shift+Space maximizes what is under the pointer, pressed again it is back whatever is under it', () => {
  assert.equal(nextMaximized(null, 'right'), 'right');
  assert.equal(nextMaximized(null, 'view'), 'view');
  assert.equal(nextMaximized(null, null), null, 'nothing to maximize there');
  assert.equal(nextMaximized('right', 'view'), null);
  assert.equal(nextMaximized('view', null), null);
});

test('the 3D view maximized hides every docked panel, floating ones stay; a dock maximized changes nothing', () => {
  const layout = defaultLayout();
  layout.panels.console.dock = 'float';
  const shown = shownLayout(layout, 'view');
  assert.deepEqual(fitLayout(shown, 1280, 720).sizes, { left: 0, right: 0, bottom: 0 });
  assert.equal(shown.panels.console.hidden, false);
  assert.equal(layout.panels.hierarchy.hidden, false, 'the real layout is not changed');
  for (const target of [null, 'left', 'right', 'bottom']) assert.equal(shownLayout(layout, target), layout);
});

test('what a maximized panel covers: the other docks; the 3D view maximized, every docked panel; never a floating one', () => {
  const right = { dock: 'right' }, float = { dock: 'float' };
  assert.equal(uncovered(right, null), true);
  assert.equal(uncovered(right, 'right'), true);
  for (const covering of ['left', 'bottom', 'view']) assert.equal(uncovered(right, covering), false, covering);
  for (const covering of [null, 'left', 'right', 'bottom', 'view']) assert.equal(uncovered(float, covering), true, covering);
});
