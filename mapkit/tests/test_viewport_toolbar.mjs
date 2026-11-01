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

// G25/G26: the views of the last rebuild are view-modes.js's (Lightmap detail with them), Effects a button pressed on and off
test('the views of the last rebuild come from VIEW_MODES, and Effects is pressed on and off', () => {
  let on = false;
  const fx = createViewportToolbar({ getMode: () => 'translate', getSnap: () => false, getSteps: () => ({ move: 16, rotate: 15 }),
    getIcons: () => true, getKinds: () => [], countKinds: () => ({}), getIconSize: () => 32, getNav: () => ({}), getSceneView: () => ({}),
    getLightMode: () => 'lit', viewModes: [['wire', 'Wireframe'], ['lightmap', 'Lightmap detail']],
    getEffects: () => ({ on, shown: on }), setEffects: (v) => { on = v; } });
  assert.match(fx.el.innerHTML, /<optgroup label="Views of the last rebuild"><option value="wire">Wireframe<\/option><option value="lightmap">Lightmap detail<\/option><\/optgroup>/);
  const effects = fx.el.querySelector('[data-vp="effects"]');
  assert.equal(effects.attrs['aria-pressed'], 'false');
  // what each game does (part B2 of batch 6): not "as their LightType, LightPeriod, LightPhase"
  assert.match(effects.title, /^Effects: in the Lit view, lamps pulse, blink, flicker and strobe as the project's game draws them \(a blink at random, a flickering lamp dark in Revision\), coronas glow/);
  effects.onclick();
  assert.equal(on, true);
  assert.equal(effects.attrs['aria-pressed'], 'true');
  effects.onclick();
  assert.equal(on, false);
});

// Hear the map is the speaker after Effects, pressed on and off
test('Hear the map is a button pressed on and off', () => {
  let on = false;
  const bar2 = createViewportToolbar({ getMode: () => 'translate', getSnap: () => false, getSteps: () => ({ move: 16, rotate: 15 }),
    getIcons: () => true, getKinds: () => [], countKinds: () => ({}), getIconSize: () => 32, getNav: () => ({}), getSceneView: () => ({}),
    getLightMode: () => 'shaded', getAudio: () => ({ on }), setAudio: (v) => { on = v; } });
  assert.match(bar2.el.innerHTML, /data-vp="effects"[^]*<button data-vp="audio" aria-label="Hear the map">/);
  const audio = bar2.el.querySelector('[data-vp="audio"]');
  assert.equal(audio.attrs['aria-pressed'], 'false');
  assert.match(audio.title, /^Hear the map: /);
  audio.onclick();
  assert.equal(on, true);
  assert.equal(audio.attrs['aria-pressed'], 'true');
  assert.match(audio.title, /On: press to stop$/);
  audio.onclick();
  assert.equal(on, false);
});
