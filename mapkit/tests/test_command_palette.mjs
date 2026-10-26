// The command palette on its page (static/command-palette.js, on a stand-in page): the caret moved in the box asks
// only for its tokens again, not for the map's objects; > and @ alone list every one, drawn a page at a time, more as
// the list is scrolled or chosen down; a panel is listed once.
import test from 'node:test';
import assert from 'node:assert/strict';

// the few parts of a page the palette uses
function element() {
  const on = {};
  return { on, hidden: false, innerHTML: '', value: '', selectionStart: 0, attrs: {}, scrollTop: 0, clientHeight: 300, scrollHeight: 0,
    classList: { add() {}, remove() {} }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(type, f) { (on[type] ||= []).push(f); },
    fire(type, e = {}) { for (const f of on[type] || []) f({ target: this, preventDefault() {}, stopPropagation() {}, ...e }); },
    appendChild: (child) => child, focus() {}, blur() {}, setSelectionRange(a) { this.selectionStart = a; },
    insertAdjacentHTML(where, html) { this.innerHTML += html; }, querySelectorAll: () => [] };
}
const input = element(), list = element(), root = element();
list.querySelector = (sel) => (list.innerHTML.includes(`id="${sel.slice(1)}"`) ? { id: sel.slice(1), ...element(), scrollIntoView() {} } : null);
root.querySelector = (sel) => (sel === 'input' ? input : list);
globalThis.document = { createElement: (tag) => (tag === 'div' ? root : element()), head: element(), body: element(), activeElement: null };
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { createCommandPalette } = await import('../editor/static/command-palette.js');

const asked = [];
const objects = Array.from({ length: 450 }, (_, i) => ({ texts: [`Crate ${i}`], label: `Crate ${i}`, detail: 'Objects', run() {} }));
const palette = createCommandPalette({ escapeHtml: (s) => String(s), status() {}, recentKey: () => 'recent', busy: () => false,
  objects: (text) => { asked.push(text); return objects; }, tokenValues: () => [], classes: () => [], sections: () => [],
  textures: () => [], sounds: () => [] });
const typed = async (text) => { input.value = text; input.selectionStart = text.length; input.fire('input'); await new Promise((r) => setTimeout(r, 120)); };
const rowsDrawn = () => (list.innerHTML.match(/class="cp-row/g) || []).length;

test('the caret moved in the box asks only for its tokens: the map is not walked again', async () => {
  assert.equal(palette.open(), true);
  await new Promise((r) => setTimeout(r, 0));              // the textures and the sounds come
  assert.deepEqual(asked, [], 'an empty box: the recent searches');
  await typed('@');
  assert.deepEqual(asked, ['']);
  input.selectionStart = 0; input.fire('keyup', { key: 'ArrowLeft' }); input.fire('keyup', { key: 'Home' }); input.fire('click');
  assert.deepEqual(asked, [''], 'the same text: the same results');
  await typed('@ crate');
  assert.deepEqual(asked, ['', 'crate']);
});

test('@ alone lists every object, a page at a time, more as the list is scrolled or chosen down', async () => {
  await typed('@');
  assert.equal(rowsDrawn(), 100);
  assert.doesNotMatch(list.innerHTML, /more ·/, 'nothing left out');
  list.scrollHeight = 3000; list.scrollTop = 2800; list.fire('scroll');
  assert.equal(rowsDrawn(), 200);
  list.scrollTop = 0; list.fire('scroll');
  assert.equal(rowsDrawn(), 200, 'not near the end: no more');
  // the tokens offered come first (10 of them), then the objects: from the first object up past the tokens, round to
  // the last row
  for (let i = 0; i <= 10; i++) input.fire('keydown', { key: 'ArrowUp' });
  assert.equal(rowsDrawn(), 460);
  assert.equal(input.attrs['aria-activedescendant'], 'cp-o459');
  palette.close();
});

// the headings and the rows' labels drawn, in order
const drawn = () => (list.innerHTML.match(/cp-head" role="presentation">[^<]+|cp-label">[^<]+/g) || []).map((s) => s.slice(s.indexOf('>') + 1));
test('a panel is listed once, under Panels: the Window menu\'s item for it is not among the commands', async () => {
  window.__menubar = { panels: [['console', 'Console']], settingsPages: [], runCommand() {},
    describeMenu: () => [{ title: 'Window', items: [{ id: 'm1', label: 'Console', enabled: true, checked: true }, { sep: true },
      { id: 'm2', label: 'Lights table', enabled: true }] }, { title: 'Edit', items: [{ id: 'm3', label: 'Console log', enabled: true }] }] };
  assert.equal(palette.open(), true);
  await typed('console');
  const rows = drawn();
  assert.deepEqual(rows.filter((s) => s === 'Console'), ['Console']);          // once, under Panels
  assert.equal(rows[rows.indexOf('Console') - 1], 'Panels');
  assert.ok(rows.includes('Console log'));
  await typed('>');
  assert.deepEqual(drawn().sort(), ['Commands', 'Console log', 'Lights table']);      // > alone: every command, no panel
  palette.close();
  delete window.__menubar;
});
