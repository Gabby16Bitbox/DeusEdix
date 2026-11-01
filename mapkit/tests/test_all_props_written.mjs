// All properties (static/all-props.js) tells the editor which objects it wrote values of (E.written), so what else the
// Inspector says of them is said again: a lamp's notes (part B2 of batch 6, 1 Nov 2026: app.js behaveApi.written
// writes them again, tests/test_lighting_page.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';

// the few parts of a page the section uses: its stylesheet's link, the list of fields, a field and its row
const element = (more = {}) => ({ dataset: {}, innerHTML: '', value: '', classList: { toggle() {} }, addEventListener() {}, ...more });
globalThis.document = { createElement: () => element(), head: { appendChild() {} } };
const { allPropsSection } = await import('../editor/static/all-props.js');

test('a value written in All properties is told to the editor, with the objects it was written for', async () => {
  const written = [], row = element(), field = element({ dataset: { ap: 'LightPeriod' }, closest: () => row });
  const list = element({ closest: () => ({ open: true, addEventListener() {} }), querySelectorAll: (sel) => (sel === '[data-ap]' ? [field] : []) });
  const E = { edits: {}, actorProp: () => undefined, pushUndo() {}, setDirty() {}, status() {}, requireUnlocked: () => true,
    section: (key, title, body) => body, multiField() {}, rawField() {}, written: (actors) => written.push(actors.map((a) => a.name)),
    api: async () => ({ props: [{ name: 'LightPeriod', index: -1, group: 'Lighting', type: 'ByteProperty', default: '32' }], enums: {} }),
    find: (sel) => ({ '#aplist': list, '#apfilter': element() }[sel] || null) };
  allPropsSection(E, [{ name: 'Light1', cls: 'Engine.Light' }], {}).wire();
  for (let i = 0; i < 5 && !field.onchange; i++) await new Promise((done) => setImmediate(done));       // the class read
  field.value = '0';
  field.onchange();
  assert.deepEqual(E.edits.rawprops, { Light1: { LightPeriod: '0' } });
  assert.deepEqual(written, [['Light1']]);
});
