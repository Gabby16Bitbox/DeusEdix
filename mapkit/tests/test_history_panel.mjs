// The History panel (static/history-panel.js) on a stand-in page: after a jump the keyboard focus is on the step gone
// to (now the current one), so Enter again does nothing, and Up / Down go on from there; the note says what starts the
// history again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, recordStep, travelStep, historyRows, stepsTo, currentName } from '../editor/static/history-names.js';

// the few parts of a page the panel uses: elements with children, attributes, focus and listeners
const page = { activeElement: null, frames: [] };
class Element {
  constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentElement: null, dataset: {}, attrs: {}, on: {}, className: '', textContent: '', title: '' }); }
  get firstElementChild() { return this.children[0] || null; }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  replaceChildren(...list) { this.children = []; for (const c of list) this.appendChild(c); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(type, fn) { this.on[type] = fn; }
  focus() { page.activeElement = this; }
  scrollIntoView() {}
  contains(x) { for (let n = x; n; n = n.parentElement) if (n === this) return true; return false; }
  closest(sel) { for (let n = this; n; n = n.parentElement) if (n.matches(sel)) return n; return null; }
  matches(sel) { return sel === '.hs-step' && this.className.split(' ').includes('hs-step'); }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) { return this.all().filter((e) => e.matches(sel)); }
  querySelector(sel) {
    if (sel === '[aria-current]') return this.all().find((e) => e.hasAttribute('aria-current')) || null;
    const at = /^\[data-at="(.*)"\]$/.exec(sel);
    return at ? this.all().find((e) => e.dataset.at === at[1]) || null : this.querySelectorAll(sel)[0] || null;
  }
}
globalThis.document = { createElement: (tag) => new Element(tag), head: new Element('head'),
  get activeElement() { return page.activeElement; } };
globalThis.requestAnimationFrame = (fn) => page.frames.push(fn);
const { createHistoryPanel } = await import('../editor/static/history-panel.js');
const frames = () => { while (page.frames.length) page.frames.shift()(); };

// a map of ten steps, the panel over its history (a jump: undone or redone that many steps, as app.js jumpHistory)
function panel() {
  const h = createHistory(), list = new Element('ol'), count = new Element('span');
  let edits = 0;
  for (let i = 0; i < 10; i++) { recordStep(h, String(edits), `Step ${i}`); edits++; }
  const root = { innerHTML: '', offsetParent: null, querySelector: (sel) => (sel === '.hs-list' ? list : count) };
  const view = createHistoryPanel({ root, rows: () => historyRows(h), jump(at) {
    const { way, count: n } = stepsTo(at);
    for (let i = 0; i < n; i++) { const s = travelStep(h, way, String(edits)); if (s) edits = +s.state; }
    view.refresh();
  } });
  const row = (label) => list.children.map((li) => li.firstElementChild).find((b) => b.textContent === label);
  // a key or a click on the focused row, as the browser gives them (Enter: the button's own click)
  const press = (key) => {
    const target = page.activeElement, e = { key, target, preventDefault() {}, stopPropagation() {} };
    list.on.keydown(e);
    if (key === 'Enter') list.on.click({ target });
    frames();
  };
  return { h, root, list, row, press, view, get edits() { return edits; } };
}

test('after a jump the focus is on the step gone to: Enter again does nothing, the arrows go on from there', () => {
  const p = panel();
  p.row('Step 6').focus();                         // three steps back (Down three times)
  p.press('Enter');
  assert.equal(currentName(p.h), 'Step 6');
  assert.equal(page.activeElement.textContent, 'Step 6', 'not the row three steps further back');
  assert.equal(page.activeElement.getAttribute('aria-current'), 'step');
  p.press('Enter');                                // the step the map is at: nothing happens
  assert.equal(currentName(p.h), 'Step 6');
  assert.equal(p.edits, 7);
  p.press('ArrowUp');                              // the next step up: one redo
  assert.equal(page.activeElement.textContent, 'Step 7');
  p.press('Enter');
  assert.equal(currentName(p.h), 'Step 7');
  assert.equal(page.activeElement.textContent, 'Step 7');
  // forward too: two rows up, the redo side
  p.row('Step 9').focus();
  p.press('Enter');
  assert.equal(currentName(p.h), 'Step 9');
  assert.equal(page.activeElement.textContent, 'Step 9');
  // and down to the bottom: the map as it was opened
  p.list.children.at(-1).firstElementChild.focus();
  p.press('Enter');
  assert.equal(p.edits, 0);
  assert.equal(page.activeElement, p.list.children.at(-1).firstElementChild);
});

test('a redraw without the focus in the list moves no focus', () => {
  const p = panel(), outside = new Element('button');
  outside.focus();
  recordStep(p.h, '10', 'Step 10');
  p.view.refresh();
  frames();
  assert.equal(p.list.children[0].firstElementChild.textContent, 'Step 10');
  assert.equal(page.activeElement, outside);
});

test('the note says the history starts again after a Rebuild or a reload', () => {
  const root = { innerHTML: '', offsetParent: null, querySelector: () => new Element('ol') };
  createHistoryPanel({ root, rows: () => historyRows(createHistory()), jump() {} });
  assert.match(root.innerHTML, /Not kept after a Rebuild or a reload/);
});
