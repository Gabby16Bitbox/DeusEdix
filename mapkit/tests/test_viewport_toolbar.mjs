// The 3D view's toolbar (static/viewport-toolbar.js, on a stand-in page): Esc closes the list open (the Show menu, the
// Navigation menu, a step's list), and only it: the editor's own Esc (the end of a placing, an empty selection) waits
// for the next one.
import test from 'node:test';
import assert from 'node:assert/strict';

// the few parts of a page the toolbar uses: an element finds the same element again for a selector
function element() {
  const found = new Map();
  return { dataset: {}, style: {}, attrs: {}, children: [], innerHTML: '', textContent: '', value: '', title: '', hidden: false,
    classList: { add() {}, remove() {}, toggle() {} }, firstElementChild: { textContent: '' },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener() {},
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this); this.parentElement = null; },
    contains(x) { for (let n = x; n; n = n.parentElement) if (n === this) return true; return false; },
    querySelector(sel) { if (!found.has(sel)) found.set(sel, Object.assign(element(), { parentElement: this })); return found.get(sel); },
    querySelectorAll: () => [] };
}
const listeners = {};
globalThis.document = { createElement: element, head: element(), body: element(), querySelector: () => null, activeElement: null,
  addEventListener() {} };
globalThis.window = { addEventListener(type, fn, capture) { (listeners[type] ||= []).push({ fn, capture }); } };
const { createViewportToolbar } = await import('../editor/static/viewport-toolbar.js');

const kinds = [{ id: 'light', label: 'Lights', icons: true, hidden: false, locked: false, noIcons: false }];
const bar = createViewportToolbar({ getMode: () => 'translate', getSnap: () => true, getSteps: () => ({ move: 16, rotate: 15 }), getIcons: () => true,
  getKinds: () => kinds, countKinds: () => ({ light: 3 }), getIconSize: () => 32, getNav: () => ({}), getSceneView: () => ({}), getLightMode: () => 'shaded' });
const button = (k) => bar.el.querySelector(`[data-vp="${k}"]`);
const holder = (k) => bar.el.querySelector(`[data-combo="${k}"]`);
// Esc pressed: what the 3D view's toolbar let through to the editor
function esc() {
  const e = { key: 'Escape', stopped: false, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  for (const { fn, capture } of listeners.keydown || []) if (capture && !e.stopped) fn(e);
  return e;
}

test('Esc closes the Show menu, the Navigation menu and a step\'s list, and the editor does not see it', () => {
  for (const [open, k] of [[() => button('kinds').onclick({ stopPropagation() {} }), 'kinds'], [() => button('nav').onclick({ stopPropagation() {} }), 'nav'],
    [() => holder('move').querySelector('button').onclick({ stopPropagation() {} }), 'move']]) {
    open();
    assert.equal(holder(k).children.length, 1, `${k}: open`);
    const first = esc();
    assert.equal(holder(k).children.length, 0, `${k}: closed`);
    assert.ok(first.stopped && first.prevented, `${k}: the placing and the selection stay`);
    const second = esc();
    assert.equal(second.stopped, false, `${k}: nothing open, the next Esc is the editor's`);
  }
});

test('other keys go on to the editor while a list is open', () => {
  button('kinds').onclick({ stopPropagation() {} });
  const e = { key: 'Delete', stopped: false, stopImmediatePropagation() { this.stopped = true; }, preventDefault() {} };
  for (const { fn } of listeners.keydown || []) fn(e);
  assert.equal(e.stopped, false);
  assert.equal(holder('kinds').children.length, 1);
  esc();
});
