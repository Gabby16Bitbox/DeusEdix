// The node graph canvas (static/graph-canvas.js) on a stand-in page: drawing keyed by id (set() again draws nothing, a
// move routes only the moved node's wires), pins placed from the rows, the keys (Delete, never while typing, Ctrl+Z
// left to the editor and every other key stopped, Esc, data-keys, the zoom button's own keys and its mouse click giving
// the focus back, Space tapped or held, the arrows), the drags (box, node with Escape, a wire to a refusing pin or to
// empty space, the delay chip, a reroute dot, previews put back when the caller refuses), the typed delay and the
// focus, the pulse, the zoom levels with bundled wires and the titles' size on the screen (no restyle where the covers
// are blank); and the stylesheet's node layers and bottom-right corner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------- the few parts of a page the canvas uses
const page = { active: null, frames: [] };
const VOID = new Set(['input', 'br', 'img']);
const decode = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function styleOf() {
  const s = { props: {} };
  s.setProperty = (k, v) => { s.props[k] = v; };
  s.getPropertyValue = (k) => s.props[k] || '';
  return s;
}
class El {
  constructor(tag) {
    Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentElement: null, attrs: new Map(), dataset: {}, style: styleOf(),
      listeners: {}, cls: [], text: '', hidden: false, title: '', id: '', value: '' });
  }
  get className() { return this.cls.join(' '); }
  set className(v) { this.cls = String(v).split(/\s+/).filter(Boolean); }
  get classList() {
    const el = this;
    return {
      add: (...c) => { for (const x of c) if (!el.cls.includes(x)) el.cls.push(x); },
      remove: (...c) => { el.cls = el.cls.filter((x) => !c.includes(x)); },
      toggle: (c, on) => { const want = on === undefined ? !el.cls.includes(c) : !!on; el.classList[want ? 'add' : 'remove'](c); return want; },
      contains: (c) => el.cls.includes(c),
    };
  }
  setAttribute(k, v) {
    v = String(v);
    if (k === 'class') this.className = v;
    else if (k === 'id' || k === 'title') this[k] = v;
    else if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = v;
    else if (k === 'hidden') this.hidden = true;
    else this.attrs.set(k, v);
  }
  getAttribute(k) { return k === 'class' ? this.className : this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  appendChild(c) { c.remove(); c.parentElement = this; this.children.push(c); return c; }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter((x) => x !== this); this.parentElement = null; } }
  replaceChildren(...list) { for (const c of this.children) c.parentElement = null; this.children = []; this.text = ''; for (const c of list) this.appendChild(c); }
  get firstChild() { return this.children[0] || null; }
  set innerHTML(html) { this.replaceChildren(); parseInto(this, html); }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(); this.text = String(v); }
  matches(sel) { return sel.split(',').some((s) => s.trim().startsWith('.') && this.cls.includes(s.trim().slice(1))); }
  closest(sel) { for (let n = this; n; n = n.parentElement) if (n.matches(sel)) return n; return null; }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) { return this.all().filter((e) => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  fire(t, ev) { for (const fn of this.listeners[t] || []) fn(ev); }
  focus() { page.active = this; }
  select() {}
  get clientWidth() { return this.cls.includes('gc') ? 800 : 0; }
  get clientHeight() { return this.cls.includes('gc') ? 600 : 0; }
  // counted: a read of the layout forces the browser to lay the page out
  getBoundingClientRect() { this.layoutReads = (this.layoutReads || 0) + 1; return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  // Web Animations: kept, to be looked at
  animate(keyframes, timing) {
    const run = { keyframes, timing, cancelled: false, cancel() { this.cancelled = true; } };
    (this.animations ||= []).push(run);
    return run;
  }
  setPointerCapture() {}
  hasPointerCapture() { return false; }
  releasePointerCapture() {}
}
// the canvas's own markup: tags with attributes in double quotes, text between them
function parseInto(parent, html) {
  const stack = [parent];
  for (const m of html.matchAll(/<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g)) {
    const top = stack[stack.length - 1];
    if (m[1]) { stack.pop(); continue; }
    if (m[5] !== undefined) { if (m[5].trim()) top.text += decode(m[5]); continue; }
    const el = new El(m[2]);
    for (const a of m[3].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) el.setAttribute(a[1], decode(a[2] ?? ''));
    top.appendChild(el);
    if (!m[4] && !VOID.has(m[2])) stack.push(el);
  }
}
globalThis.document = { createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t), head: new El('head'), get activeElement() { return page.active; } };
globalThis.window = { devicePixelRatio: 1 };
globalThis.requestAnimationFrame = (fn) => { page.frames.push(fn); return page.frames.length; };
globalThis.cancelAnimationFrame = () => {};
const { createGraphCanvas } = await import('../editor/static/graph-canvas.js');

// ---------------------------------------------------------------- a graph, a canvas over it, events
const row = (id, text, more = {}) => ({ id, text, in: { id: 'in' }, out: { id: 'out' }, ...more });
function graph(extra = {}) {
  const nodes = [['A', [0, 0]], ['B', [400, 0]], ['C', [400, 200]], ['D', [800, 0]]].map(([id, at]) => ({ id, title: id, at, rows: [row('r', `${id} row`)] }));
  const end = (node, pin) => ({ node, pin });
  const wires = [
    { id: 'w1', from: end('A', 'out'), to: end('B', 'in'), label: 'used → open', delay: 2 },
    { id: 'w2', from: end('B', 'out'), to: end('C', 'in') },
    { id: 'w3', from: end('C', 'out'), to: end('D', 'in') },
  ];
  return { nodes, wires, ...extra };
}
function canvas(options = {}) {
  const host = new El('div'), calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); return options[name + 'Answer']; };
  const names = ['onConnect', 'onPinDrop', 'onMove', 'onDelay', 'onReroute', 'onSelect', 'onOpen', 'onRow', 'onWireOpen', 'onWireDelete',
    'onRetarget', 'onAdd', 'onDelete', 'onContext', 'onCommand'];
  const g = createGraphCanvas(host, { label: 'Logic', ...Object.fromEntries(names.map((n) => [n, record(n)])), ...options });
  g.set(graph());
  g.setView({ x: 0, y: 0, k: 1 });                 // the screen is the world: points below are both
  const root = g.element;
  const nodeEl = (id) => root.querySelectorAll('.gc-node').find((e) => e.getAttribute('aria-label') === id);
  const pinEl = (id, side) => nodeEl(id).querySelectorAll('.gc-pin').find((p) => p.cls.includes(side));
  const pointer = (type, target, [x, y], more = {}) => {
    const e = { target, clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...more };
    root.fire(type, e);
    return e;
  };
  const drag = (target, from, to, more) => { pointer('pointerdown', target, from, more); pointer('pointermove', root, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], more); pointer('pointermove', root, to, more); pointer('pointerup', root, to, more); };
  const key = (k, more = {}, type = 'keydown') => {
    const e = { key: k, code: '', target: root, repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...more };
    root.fire(type, e);
    return e;
  };
  const named = (name) => calls.filter((c) => c[0] === name);
  return { g, root, calls, named, nodeEl, pinEl, pointer, drag, key };
}
// the focus going from one element to another, as Chromium moves it: nothing has the focus while the old one's blur
// runs, and when a blur handler gives the focus to something, the move that caused the blur is dropped
function moveFocus(from, to) {
  page.active = null;
  from.fire('blur', {});
  if (page.active === null) to.focus();
}

test('drawing is keyed: set() again draws nothing; a move routes only that node\'s wires; a new look draws only it', () => {
  const c = canvas(), before = c.g.stats();
  assert.equal(before.nodes, 4);
  assert.equal(before.wires, 3);
  c.g.set(graph());                                // the same graph, new objects
  const same = c.g.stats();
  assert.equal(same.nodesDrawn, before.nodesDrawn);
  assert.equal(same.nodesMoved, before.nodesMoved);
  assert.equal(same.wiresRouted, before.wiresRouted);
  const moved = graph();
  moved.nodes[1].at = [420, 30];                   // B: its two wires (w1 in, w2 out), not w3
  c.g.set(moved);
  const after = c.g.stats();
  assert.equal(after.nodesMoved - same.nodesMoved, 1);
  assert.equal(after.wiresRouted - same.wiresRouted, 2);
  assert.equal(after.nodesDrawn, same.nodesDrawn);
  const renamed = graph();
  renamed.nodes[2].title = 'C renamed';
  c.g.set(renamed);
  assert.equal(c.g.stats().nodesDrawn - after.nodesDrawn, 1);
  assert.equal(c.root.querySelectorAll('.gc-node').length, 4);
  const fewer = graph();
  fewer.nodes.pop();
  fewer.wires.pop();
  c.g.set(fewer);
  assert.equal(c.root.querySelectorAll('.gc-node').length, 3);
  assert.equal(c.root.querySelector('.gc-wire-g').children.length, 2);
  assert.equal(c.g.stats().nodesMade, 4, 'no node was made again');
  c.g.destroy();
});

test('a wire starts and ends on its pins, placed from the rows (header 28 px, rows 22 px)', () => {
  const c = canvas(), path = c.root.querySelector('.gc-wire-g').children[0];
  assert.match(path.getAttribute('d'), /^M220,39 C.* 400,39$/);
  assert.equal(c.pinEl('A', 'out').cls.includes('on'), true, 'a pin with a wire is shown filled');
  assert.equal(c.pinEl('A', 'in').cls.includes('on'), false);
  c.g.destroy();
});

test('Delete gives the selection; in a field no key fires; Ctrl+Z goes on to the editor', () => {
  const c = canvas();
  c.drag(c.root, [-50, -50], [450, 60]);            // a box over A and B
  assert.deepEqual(c.named('onSelect').at(-1)[1].nodes.sort(), ['A', 'B']);
  const del = c.key('Delete');
  assert.deepEqual(c.named('onDelete')[0][1], { nodes: ['A', 'B'], wires: [], frames: [], notes: [] });
  assert.ok(del.stopped, 'the 3D view does not delete its own selection too');
  const typed = c.key('Delete', { target: new El('input') });
  assert.equal(c.named('onDelete').length, 1);
  assert.ok(!typed.stopped && !typed.prevented);
  const undo = c.key('z', { ctrlKey: true });
  assert.ok(!undo.stopped && !undo.prevented, 'Ctrl+Z reaches app.js: the global history');
  c.drag(c.root, [-50, -50], [-50, -50]);           // a click on empty space clears
  assert.deepEqual(c.named('onSelect').at(-1)[1].nodes, []);
  c.g.destroy();
});

test('a node dragged is one onMove where it ended; Escape mid-drag puts it back', () => {
  const c = canvas(), title = c.nodeEl('D').querySelector('.gc-t'), routed = c.g.stats().wiresRouted;
  c.drag(title, [900, 10], [930, 20]);
  assert.deepEqual(c.named('onMove'), [['onMove', { nodes: { D: [830, 10] } }]]);
  assert.equal(c.g.stats().wiresRouted - routed, 2, 'only D\'s wire, at each of the two moves');
  c.pointer('pointerdown', title, [900, 10]);
  c.pointer('pointermove', c.root, [960, 60]);
  assert.equal(c.nodeEl('D').style.transform, 'translate(890px,60px)');
  c.key('Escape');
  assert.equal(c.nodeEl('D').style.transform, 'translate(830px,10px)');
  c.pointer('pointerup', c.root, [960, 60]);
  assert.equal(c.named('onMove').length, 1);
  c.g.destroy();
});

test('a wire dragged onto a pin that refuses says why at the pointer; onto empty space it asks for the add menu', () => {
  const why = 'A light cannot Open: try Turn on';
  const c = canvas({ canConnect: (from, to) => (to.node === 'D' ? why : true) });
  c.pointer('pointerdown', c.pinEl('A', 'out'), [220, 39]);
  c.pointer('pointermove', c.root, [600, 30]);
  assert.ok(c.pinEl('D', 'in').cls.includes('no') && c.pinEl('C', 'in').cls.includes('ok'), 'the pins it could go to light up');
  c.pointer('pointermove', c.root, [805, 41]);      // near D's input
  const reason = c.root.querySelector('.gc-reason');
  assert.equal(reason.hidden, false);
  assert.equal(reason.textContent, why);
  c.pointer('pointerup', c.root, [805, 41]);
  assert.equal(c.named('onConnect').length, 0);
  assert.ok(!c.pinEl('D', 'in').cls.includes('no'), 'the lit pins are put back');
  c.drag(c.pinEl('A', 'out'), [220, 39], [398, 236]); // near C's input: it may
  assert.deepEqual(c.named('onConnect')[0].slice(1), [{ node: 'A', pin: 'out' }, { node: 'C', pin: 'in' }]);
  c.drag(c.pinEl('A', 'out'), [220, 39], [300, 330]);
  const [, from, at] = c.named('onPinDrop')[0];
  assert.deepEqual(from, { node: 'A', pin: 'out', side: 'out' });
  assert.deepEqual(at.world, [300, 330]);
  c.g.destroy();
});

test('without canConnect, a typed pin refuses another type, with why', () => {
  const c = canvas(), g = graph();
  g.nodes[0].rows[0].out = { id: 'out', label: 'count', type: 'number' };
  g.nodes[3].rows[0].in = { id: 'in', label: 'Open', type: 'event' };
  c.g.set(g);
  c.drag(c.pinEl('A', 'out'), [220, 39], [802, 40]);
  assert.equal(c.root.querySelector('.gc-reason').textContent, 'count gives number: Open takes event');
  assert.equal(c.named('onConnect').length, 0);
  c.drag(c.pinEl('A', 'out'), [220, 39], [402, 238]);    // C's input has no type: it fits
  assert.equal(c.named('onConnect').length, 1);
  c.g.destroy();
});

test('the delay chip dragged sideways is a new delay, 40 px a second', () => {
  const c = canvas(), span = c.root.querySelector('.gc-delay');
  assert.equal(span.textContent, '2 s');
  c.drag(span, [300, 40], [340, 42]);
  assert.deepEqual(c.named('onDelay'), [['onDelay', 'w1', 3]]);
  c.g.destroy();
});

test('zoomed out: titles under 50%, frames under 25% with the wires between them bundled and counted', () => {
  const c = canvas();
  const g = graph({ frames: [{ id: 'f1', title: 'Hall', rect: [-20, -40, 680, 140] }, { id: 'f2', title: 'Vault', rect: [380, 160, 700, 140] }] });
  g.wires.push({ id: 'w4', from: { node: 'A', pin: 'out' }, to: { node: 'C', pin: 'in' } });
  c.g.set(g);
  const routed = c.g.stats().wiresRouted;
  c.g.setView({ x: 0, y: 0, k: 0.4 });
  assert.ok(c.root.cls.includes('gc-show-titles') && !c.root.cls.includes('gc-show-frames'));
  assert.equal(c.g.stats().wiresRouted, routed, 'a change of zoom level routes no wire: the pins stay level with their rows');
  assert.equal(c.nodeEl('A').querySelector('.gc-big').textContent, 'A', 'the cover shown zoomed out has the title');
  c.g.setView({ x: 0, y: 0, k: 0.2 });
  assert.ok(c.root.cls.includes('gc-show-frames'));
  const counts = c.root.querySelector('.gc-bundles').children.filter((e) => e.tagName === 'TEXT').map((e) => e.textContent);
  assert.deepEqual(counts, ['2'], 'w2 and w4 go from the Hall to the Vault; w1 stays inside the Hall');
  assert.ok(c.nodeEl('A').cls.includes('framed') && !c.nodeEl('D').cls.includes('framed'), 'D is in no frame: it stays shown');
  c.g.setView({ x: 0, y: 0, k: 1 });
  assert.equal(c.root.querySelector('.gc-bundles').children.length, 0);
  c.g.destroy();
});

test('Space tapped adds; held while dragging it pans and adds nothing', () => {
  const c = canvas();
  c.key(' ');
  c.key(' ', {}, 'keyup');
  assert.equal(c.named('onAdd').length, 1);
  assert.deepEqual(c.named('onAdd')[0][1].world, [400, 300], 'with the pointer away: the middle of the view');
  c.key(' ');
  c.drag(c.root, [10, 10], [60, 10]);
  c.key(' ', {}, 'keyup');
  assert.equal(c.named('onAdd').length, 1);
  assert.equal(c.g.view().x, 50);
  c.g.destroy();
});

test('#12 keys the graph does not take stop at it (End, B, Alt+1...): only the editor\'s global ones go on', () => {
  const c = canvas();
  for (const [k, more] of [['End'], ['b'], ['e'], ['r'], ['g'], ['q'], ['v'], ['z'], ['x'], ['l'], ['p'], ['h'], ['1', { code: 'Digit1', altKey: true }],
    ['i', { ctrlKey: true }], ['F', { ctrlKey: true, shiftKey: true }], ['\\', { ctrlKey: true }], ['D', { shiftKey: true }]]) {
    const e = c.key(k, more);
    assert.ok(e.stopped, `${JSON.stringify([k, more])} does not reach the 3D view`);
    assert.ok(!e.prevented, `${k}: the browser's own default stays`);
  }
  for (const [k, more] of [['z', { ctrlKey: true }], ['Z', { ctrlKey: true, shiftKey: true }], ['y', { ctrlKey: true }], ['s', { ctrlKey: true }],
    ['u', { ctrlKey: true }], ['k', { ctrlKey: true }], [' ', { shiftKey: true }]]) {
    const e = c.key(k, more);
    assert.ok(!e.stopped && !e.prevented, `${JSON.stringify([k, more])} goes on to the editor`);
  }
  const leave = c.key('Tab', { shiftKey: true });
  assert.ok(!leave.prevented, 'Shift+Tab leaves the canvas');
  assert.equal(c.named('onCommand').length, 0);
  assert.equal(c.named('onAdd').length, 0);
  c.g.destroy();
});

test('#20 Esc with nothing to cancel goes on to the editor (a maximized panel back); with a selection it clears it', () => {
  const c = canvas();
  const idle = c.key('Escape');
  assert.ok(!idle.stopped && !idle.prevented, 'nothing to cancel: the editor\'s Esc');
  c.drag(c.root, [-50, -50], [450, 60]);            // A and B selected
  const clear = c.key('Escape');
  assert.ok(clear.stopped && clear.prevented, 'the graph\'s Esc');
  assert.deepEqual(c.named('onSelect').at(-1)[1].nodes, []);
  assert.ok(!c.key('Escape').stopped, 'and the next one is the editor\'s');
  c.g.destroy();
});

test('#21 the zoom button keeps Space, Enter and Tab: they press it or move on, never add or edit', () => {
  const c = canvas(), zoom = c.root.querySelector('.gc-zoom');
  const space = c.key(' ', { target: zoom });
  c.key(' ', { target: zoom }, 'keyup');
  const enter = c.key('Enter', { target: zoom });
  const tab = c.key('Tab', { target: zoom });
  for (const e of [space, enter, tab]) {
    assert.ok(!e.prevented, `${JSON.stringify(e.key)}: the button's own`);
    assert.ok(e.stopped, `${JSON.stringify(e.key)}: not the 3D view's either`);
  }
  assert.equal(c.named('onAdd').length, 0);
  assert.equal(c.named('onCommand').length, 0);
  c.g.destroy();
});

test('B the zoom button clicked with the mouse gives the focus back to the canvas, so its keys still work; pressed from the keyboard it keeps it', () => {
  const c = canvas(), zoom = c.root.querySelector('.gc-zoom');
  c.drag(c.root, [-50, -50], [450, 60]);            // A and B selected
  zoom.focus();                                     // the mouse press gives the button the focus (Chromium)
  zoom.fire('click', { target: zoom, detail: 1 });
  assert.equal(document.activeElement, c.root, 'the canvas has the focus again');
  c.key('Delete', { target: document.activeElement });
  assert.equal(c.named('onDelete').length, 1, 'Delete deletes the selection');
  zoom.focus();
  zoom.fire('click', { target: zoom, detail: 0 });  // Enter or Space on the button: a click with no mouse clicks
  assert.equal(document.activeElement, zoom, 'the button keeps it, for Tab to go on from it');
  c.g.destroy();
});

test('#19 the canvas keeps its keys from the menus\' layer (data-keys); a moved 3D shortcut sent to it does nothing there', () => {
  const c = canvas(), keys = (c.root.dataset.keys || '').split(' ');
  for (const k of ['Delete', 'F', 'Space', 'Tab', 'Esc', 'Ctrl+C', 'Ctrl+Shift+G', 'Shift+A', 'Left', '0', '9', 'Ctrl+9', 'F9']) assert.ok(keys.includes(k), k);
  c.drag(c.root, [-50, -50], [450, 60]);            // A and B selected
  // the user moved the 3D view's Delete to X: menubar.js sends X on as a Delete marked __deusedix
  const resent = c.key('Delete', { __deusedix: true });
  assert.equal(c.named('onDelete').length, 0, 'the graph\'s selection stays');
  assert.ok(resent.stopped, 'and the 3D view\'s selection too');
  const undo = c.key('z', { ctrlKey: true, __deusedix: true });     // the user's key for Undo, sent on as Ctrl+Z
  assert.ok(!undo.stopped, 'the editor\'s undo still runs');
  c.key('Delete');
  assert.equal(c.named('onDelete').length, 1, 'Delete pressed on the graph is the graph\'s');
  c.g.destroy();
});

test('#13 a delay typed, then a click on another panel\'s field: the focus goes there, the value is kept', () => {
  const c = canvas();
  c.drag(c.root.querySelector('.gc-delay'), [300, 40], [300, 40]);   // a click: typed in place
  const field = c.root.querySelector('.gc-field');
  assert.equal(document.activeElement, field);
  field.value = '4';
  const inspector = new El('input');
  moveFocus(field, inspector);
  assert.equal(document.activeElement, inspector, 'the next keys are the Inspector field\'s, not the canvas\'s');
  assert.deepEqual(c.named('onDelay'), [['onDelay', 'w1', 4]]);
  // Enter (or Esc) gives the focus back to the canvas
  c.drag(c.root.querySelector('.gc-delay'), [300, 40], [300, 40]);
  const again = c.root.querySelector('.gc-field');
  again.value = '5';
  again.fire('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(document.activeElement, c.root);
  assert.deepEqual(c.named('onDelay').at(-1), ['onDelay', 'w1', 5]);
  c.g.destroy();
});

test('#18 a drag\'s preview is put back when the caller refuses: the delay chip and a reroute dot show the caller\'s wire', () => {
  const g = graph();
  g.wires[1].via = [[600, 120]];                    // w2, B to C, through one reroute point
  const c = canvas();
  c.g.set(g);
  const path = c.root.querySelector('.gc-wire-g').children[1], d = path.getAttribute('d');
  // the delay dragged from 2 s to 3 s; the caller refuses (no set())
  c.drag(c.root.querySelector('.gc-delay'), [300, 40], [340, 42]);
  assert.deepEqual(c.named('onDelay'), [['onDelay', 'w1', 3]]);
  assert.equal(c.root.querySelector('.gc-delay').textContent, '2 s');
  c.g.set(g);
  assert.equal(c.root.querySelector('.gc-delay').textContent, '2 s', 'set() with the caller\'s wire draws its delay');
  // typed, refused
  c.drag(c.root.querySelector('.gc-delay'), [300, 40], [300, 40]);
  c.root.querySelector('.gc-field').value = '7';
  c.root.querySelector('.gc-field').fire('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(c.root.querySelector('.gc-delay').textContent, '2 s');
  // the reroute point dragged; the caller refuses: the wire goes back through the caller's point
  c.drag(c.root.querySelector('.gc-dot'), [600, 120], [650, 300]);
  assert.deepEqual(c.named('onReroute'), [['onReroute', 'w2', [[650, 300]]]]);
  assert.equal(path.getAttribute('d'), d);
  assert.equal(c.root.querySelector('.gc-dot').style.transform, 'translate(600px,120px) translate(-50%,-50%)');
  c.g.set(g);
  assert.equal(path.getAttribute('d'), d);
  // a caller that takes it gives the wire back with set() at once: it stays where it was let go
  const taker = canvas({ onReroute: (id, via) => { const next = graph(); next.wires[1].via = via; taker.g.set(next); } });
  taker.g.set(g);
  taker.drag(taker.root.querySelector('.gc-dot'), [600, 120], [650, 300]);
  assert.equal(taker.root.querySelector('.gc-dot').style.transform, 'translate(650px,300px) translate(-50%,-50%)');
  assert.notEqual(taker.root.querySelector('.gc-wire-g').children[1].getAttribute('d'), d);
  c.g.destroy();
  taker.g.destroy();
});

test('#14 a pulse is one animation that ends by itself: no class left on, nothing measured, again from the start', () => {
  const c = canvas(), path = c.root.querySelector('.gc-wire-g').children[0];
  const reads = path.layoutReads || 0;
  c.g.pulse(['w1', 'w2', 'gone']);
  assert.equal(path.getAttribute('class'), 'gc-wire', 'no class that stays after the animation');
  assert.equal(path.layoutReads || 0, reads, 'no forced layout per wire');
  assert.equal(path.animations.length, 1);
  const [run] = path.animations;
  assert.equal(run.timing.iterations, 2);
  assert.deepEqual(run.keyframes.map((k) => k.strokeDashoffset), ['36', '0']);
  assert.ok(run.keyframes.every((k) => k.stroke === 'var(--acc)'));
  c.g.set(graph());
  assert.equal(path.getAttribute('class'), 'gc-wire');
  c.g.pulse(['w1']);
  assert.ok(run.cancelled, 'pulsed again while it runs: the first one stops');
  // reduced motion: the accent for a moment, nothing moves
  globalThis.window.matchMedia = (q) => ({ matches: q.includes('reduce') });
  try {
    c.g.pulse(['w1']);
    const still = path.animations.at(-1);
    assert.ok(still.keyframes.every((k) => k.stroke === 'var(--acc)' && !('strokeDashoffset' in k) && !('strokeDasharray' in k)));
    assert.ok(!still.timing.iterations || still.timing.iterations === 1);
  } finally { delete globalThis.window.matchMedia; }
  c.g.destroy();
});

test('#26 zoomed out, a node\'s 13 px title is 11.4 to 13 px on the screen, never larger, in few restyles', () => {
  const c = canvas(), layer = c.root.querySelector('.gc-nodes'), steps = new Set();
  for (let k = 0.25; k < 0.5; k += 0.001) {
    c.g.setView({ x: 0, y: 0, k });
    const step = +layer.style.getPropertyValue('--gc-inv'), px = 13 * step * k;
    steps.add(step);
    assert.ok(px <= 13 + 1e-9 && px >= 11.3, `at ${(k * 100).toFixed(1)}%: ${px.toFixed(2)} px`);
  }
  assert.ok(steps.size <= 9, `${steps.size} restyles across the titles level`);
  c.g.setView({ x: 0, y: 0, k: 1 });
  assert.equal(layer.style.getPropertyValue('--gc-inv'), '1');
  c.g.destroy();
});

test('C under 25% the covers are blank: zooming further out restyles no node, and back at the titles level the steps come back', () => {
  const c = canvas(), layer = c.root.querySelector('.gc-nodes'), setProperty = layer.style.setProperty;
  c.g.setView({ x: 0, y: 0, k: 0.25 });
  const last = layer.style.getPropertyValue('--gc-inv');
  let restyles = 0;
  layer.style.setProperty = (k, v) => { if (k === '--gc-inv') restyles++; setProperty(k, v); };
  for (let k = 0.2499; k > 0.05; k -= 0.001) c.g.setView({ x: 0, y: 0, k });
  assert.equal(restyles, 0, 'no node restyled from 25% down to 5%');
  assert.equal(layer.style.getPropertyValue('--gc-inv'), last, 'the titles level\'s last step');
  layer.style.setProperty = setProperty;
  c.g.setView({ x: 0, y: 0, k: 0.3 });
  assert.equal(layer.style.getPropertyValue('--gc-inv'), '3.25', 'quarter steps at the titles level');
  c.g.destroy();
});

test('#28 the zoom and the minimap share the bottom-right corner, so without the minimap the zoom goes down', () => {
  const c = canvas(), zoom = c.root.querySelector('.gc-zoom'), mini = c.root.querySelector('.gc-mini');
  assert.ok(zoom.parentElement === mini.parentElement && zoom.parentElement.cls.includes('gc-corner'));
  const corner = cssOf('.gc-corner'), button = cssOf('.gc-zoom'), hover = cssOf('.gc-zoom:hover');
  assert.equal(corner.position, 'absolute');
  assert.equal(corner.display, 'flex');
  assert.equal(corner['flex-direction'], 'column');
  assert.equal(corner.bottom, '8px');
  assert.ok(!('bottom' in button) && !('position' in button), 'no place of its own above where the minimap was');
  assert.ok(!('position' in cssOf('.gc-mini')), 'the minimap is in the corner\'s column too');
  // DESIGN.md's button: surface with a line border, hover lifts to hover with the accent border
  assert.equal(button.background, 'var(--surface)');
  assert.match(button.border, /var\(--line\)/);
  assert.equal(hover.background, 'var(--hover)');
  assert.equal(hover['border-color'], 'var(--accent-border)');
  c.g.destroy();
});

// ---------------------------------------------------------------- the stylesheet
const CSS = readFileSync(new URL('../editor/static/graph-canvas.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// its plain rules, in order (an @media block is left out): [{selectors, decls: {property: value}}]
function cssRules() {
  const out = [];
  for (let i = 0; i < CSS.length;) {
    const open = CSS.indexOf('{', i);
    if (open < 0) break;
    const head = CSS.slice(i, open).trim();
    if (head.startsWith('@')) {                     // a block of rules: skipped whole
      let depth = 0, j = open;
      for (; j < CSS.length; j++) if (CSS[j] === '{') depth++; else if (CSS[j] === '}' && --depth === 0) break;
      i = j + 1;
      continue;
    }
    const close = CSS.indexOf('}', open);
    const decls = Object.fromEntries(CSS.slice(open + 1, close).split(';').map((d) => d.trim()).filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
    out.push({ selectors: head.split(',').map((s) => s.trim()), decls });
    i = close + 1;
  }
  return out;
}
// the declarations of the rules for exactly this selector, merged in order
const cssOf = (selector) => Object.assign({}, ...cssRules().filter((r) => r.selectors.includes(selector)).map((r) => r.decls));
// a node's style with these classes: the cascade of the .gc-node rules (more classes win, then the later rule), its
// own --gc-* properties put in where they are used
function nodeStyle(classes) {
  const won = {};
  cssRules().forEach((r) => {
    for (const s of r.selectors) {
      const m = /^\.gc-node((?:\.[\w-]+)*)$/.exec(s);
      if (!m) continue;
      const cls = m[1].split('.').filter(Boolean);
      if (!cls.every((x) => classes.includes(x))) continue;
      for (const [p, v] of Object.entries(r.decls)) if (!won[p] || won[p].spec <= cls.length) won[p] = { v, spec: cls.length };
    }
  });
  const raw = Object.fromEntries(Object.entries(won).map(([p, x]) => [p, x.v]));
  const resolve = (v) => v.replace(/var\((--gc-[\w-]+)\)/g, (_, n) => resolve(raw[n] ?? ''));
  return Object.fromEntries(Object.entries(raw).map(([p, v]) => [p, resolve(v)]));
}

test('#27 a node\'s status ring, a block\'s bar and the selection or lighting show together', () => {
  const plain = nodeStyle([]);
  assert.match(plain['box-shadow'], /0 0 0 1px var\(--line\)/);
  assert.ok(!plain.outline);
  const block = nodeStyle(['warn', 'bar', 'sel']);
  assert.match(block['box-shadow'], /0 0 0 1px var\(--warn\)/, 'the warn ring stays while selected');
  assert.match(block['box-shadow'], /inset 3px 0 0 var\(--dim\)/, 'and the block\'s bar');
  assert.match(block.outline, /var\(--acc\)/, 'the selection');
  assert.match(nodeStyle(['bad', 'sel'])['box-shadow'], /var\(--bad\)/);
  const lit = nodeStyle(['warn', 'hot']);
  assert.match(lit['box-shadow'], /var\(--warn\)/, 'lit by the pointer, the ring stays');
  assert.match(lit.outline, /var\(--accent-border\)/);
  assert.match(nodeStyle(['hot', 'sel']).outline, /var\(--acc\)/, 'selected over lit');
});

test('the arrows go from node to node, select it and tell a screen reader', () => {
  const c = canvas();
  c.key('ArrowRight');
  assert.equal(c.root.getAttribute('aria-activedescendant'), c.nodeEl('A').id);
  c.key('ArrowRight');
  assert.equal(c.root.getAttribute('aria-activedescendant'), c.nodeEl('B').id);
  assert.deepEqual(c.named('onSelect').at(-1)[1].nodes, ['B']);
  c.key('ArrowDown');
  assert.equal(c.root.getAttribute('aria-activedescendant'), c.nodeEl('C').id);
  assert.equal(c.root.querySelector('.gc-say').textContent, 'C');
  c.g.destroy();
});
