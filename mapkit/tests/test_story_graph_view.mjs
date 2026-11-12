// The Story Graph view (static/story-graph-view.js) on the node canvas, on a stand-in page: the dialogue's nodes drawn
// on graph-canvas.js; a line written in its node (double click: Enter goes on to the next line said by the other
// speaker, Tab gives it to another speaker, Esc is done and the node shows its text again); an answer written in its
// row; Enter on a step adds a line beside it; a wire dragged from a dot onto empty space adds the step picked there
// (the quick add, what fits first, or a step already there); a wire onto another step connects them; Delete; the
// right-click menus of a node, a wire and the empty space; a value of a node changed in its box; copy, paste and
// duplicate; the graph's own Undo; Tidy; Play-test lighting the step it is at; the view kept for the next one (zoom,
// selection, the keys' focus).
import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------- the few parts of a page the view and canvas use
const page = { active: null, frames: [] };
const VOID = new Set(['input', 'br', 'img']);
const decode = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function styleOf() {
  const s = { props: {} };
  s.setProperty = (k, v) => { s.props[k] = v; };
  s.getPropertyValue = (k) => s.props[k] || '';
  s.removeProperty = (k) => { delete s.props[k]; };
  return s;
}
// one simple selector: tag, .classes, [attr] and [attr="value"] (data-* read from the dataset)
function simple(el, sel) {
  const m = sel.match(/^([a-z0-9-]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i);
  if (!m) return false;
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  for (const c of m[2].split('.').filter(Boolean)) if (!el.cls.includes(c)) return false;
  for (const a of m[3].matchAll(/\[([\w-]+)(?:="?([^"\]]*)"?)?\]/g)) {
    const name = a[1], v = name.startsWith('data-') ? el.dataset[camel(name.slice(5))] : name === 'type' ? el.type : el.attrs.get(name);
    if (v === undefined || v === null || (a[2] !== undefined && String(v) !== a[2])) return false;
  }
  return true;
}
class El {
  constructor(tag) {
    Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentElement: null, attrs: new Map(), dataset: {}, style: styleOf(),
      listeners: {}, cls: [], text: '', hidden: false, title: '', id: '', value: '', type: '' });
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
    else if (k === 'id' || k === 'title' || k === 'type') this[k] = v;
    else if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = v;
    else if (k === 'hidden') this.hidden = true;
    else this.attrs.set(k, v);
  }
  getAttribute(k) { return k === 'class' ? this.className : k === 'title' ? this.title : this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  appendChild(c) { c.remove(); c.parentElement = this; this.children.push(c); return c; }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter((x) => x !== this); this.parentElement = null; } }
  replaceChildren(...list) { for (const c of this.children) c.parentElement = null; this.children = []; this.text = ''; for (const c of list) this.appendChild(c); }
  get childNodes() { return [...this.children]; }
  get nodeType() { return 1; }
  get parentNode() { return this.parentElement; }
  get firstChild() { return this.children[0] || null; }
  set innerHTML(html) { this.replaceChildren(); parseInto(this, html); }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(); this.text = String(v); }
  matches(sel) { return sel.split(',').some((s) => simple(this, s.trim())); }
  closest(sel) { for (let n = this; n; n = n.parentElement) if (n.matches(sel)) return n; return null; }
  contains(o) { for (let n = o; n; n = n.parentElement) if (n === this) return true; return false; }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) { return this.all().filter((e) => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  fire(t, ev) { for (const fn of this.listeners[t] || []) fn(ev); }
  focus() { const was = page.active; page.active = this; if (was && was !== this) was.fire('blur', {}); }
  select() {}
  setSelectionRange() {}
  get clientWidth() { return this.cls.includes('gc') || this.cls.includes('sg-canvas') ? 800 : 0; }
  get clientHeight() { return this.cls.includes('gc') || this.cls.includes('sg-canvas') ? 600 : 0; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  get offsetLeft() { return parseFloat(this.style.left) || 0; }
  get offsetTop() { return parseFloat(this.style.top) || 0; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture() {}
  hasPointerCapture() { return false; }
  releasePointerCapture() {}
}
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
const docListeners = {};
globalThis.document = {
  createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t), head: new El('head'),
  get activeElement() { return page.active; }, hasFocus: () => true,
  addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); },
  removeEventListener: (t, fn) => { docListeners[t] = (docListeners[t] || []).filter((f) => f !== fn); },
};
globalThis.window = { devicePixelRatio: 1 };
globalThis.requestAnimationFrame = (fn) => { page.frames.push(fn); return page.frames.length; };
globalThis.cancelAnimationFrame = () => {};
const { createGraphView } = await import('../editor/static/story-graph-view.js');
const { START } = await import('../editor/static/story-graph-nodes.js');

// ---------------------------------------------------------------- a dialogue, a view of it, events
function dialogue() {
  return { id: 'd1', title: 'Gate talk', owner: 'Guard', steps: [
    { id: 'n1', type: 'line', who: 'npc', text: 'Halt.' },
    { id: 'n2', type: 'choice', options: [{ text: 'Sorry', goto: '' }, { text: 'Make me', goto: '' }] },
    { id: 'n3', type: 'end' },
  ] };
}
function view(over = {}) {
  const host = new El('div'), d = over.dialogue || dialogue(), layout = over.layout || {}, calls = [];
  const v = createGraphView({
    host, dialogue: d, layout,
    speaker: (s) => (s.who === 'jc' ? { name: 'JC Denton', colour: '#5aa2ff' } : { name: 'Guard', colour: '#afa9ec' }),
    speakers: () => [{ who: 'npc', name: 'Guard' }, { who: 'jc', name: 'JC Denton' }, { who: 'actor:Bob', name: 'Bob' }],
    face: () => Promise.resolve(null),
    summary: { title: (s) => s.type, text: () => '' },
    inspect: (el, i) => { el.textContent = `fields of step ${i}`; },
    changed: () => calls.push('changed'),
    newStep: (type, who) => (type === 'line' ? { type, who, text: '' } : type === 'choice' ? { type, options: [{ text: '', goto: '' }] } : { type }),
    menu: [['line', 'Line: Guard'], ['line', 'Line: JC', 'jc'], ['if', 'Condition (flags)'], '-', ['end', 'End of dialogue']],
    ...over.options,
  });
  const root = host.querySelector('.gc');
  const nodeEl = (label) => root.querySelectorAll('.gc-node').find((e) => e.getAttribute('aria-label').startsWith(label));
  const nodeOf = (id) => root.querySelectorAll('.gc-node').find((e) => e.getAttribute('aria-label') === labelOf(d, id));
  const ev = (more = {}) => ({ clientX: 0, clientY: 0, button: 0, pointerId: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    repeat: false, code: '', preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...more });
  const pointer = (type, target, [x, y]) => root.fire(type, ev({ target, clientX: x, clientY: y }));
  const click = (target, at = [5, 5]) => { pointer('pointerdown', target, at); pointer('pointerup', root, at); };
  const key = (k, target = root, more = {}) => { const e = ev({ key: k, target, ...more }); (target === root ? root : target).fire('keydown', e); return e; };
  const field = () => root.querySelector('textarea');
  const menu = () => host.querySelector('.sg-menu');
  const pick = (label) => menu().querySelectorAll('button').find((b) => b.textContent === label).onclick();
  // the quick add (graph-quick-add.js): its groups and items as shown, and a click on one
  const quick = () => host.querySelector('.gqa');
  const shown = () => quick().querySelector('.gqa-list').children.map((e) => (e.cls.includes('gqa-g') ? '# ' + e.textContent : e.textContent));
  const choose = (label) => {
    const list = quick().querySelector('.gqa-list'), b = list.querySelectorAll('.gqa-i').find((x) => x.textContent === label);
    assert.ok(b, `"${label}" in the quick add: ${shown().join(', ')}`);
    list.fire('click', { target: b });
  };
  const type = (text) => { const q = quick().querySelector('.gqa-q'); q.value = text; q.fire('input', {}); };
  return { v, host, root, d, layout, calls, nodeEl, nodeOf, pointer, click, key, field, menu, pick, quick, shown, choose, type, ev,
    side: host.querySelector('.sg-side') };
}
const labelOf = (d, id) => {
  const s = d.steps.find((x) => x.id === id);
  return s.type === 'line' ? (s.who === 'jc' ? 'JC Denton' : 'Guard') : s.type === 'choice' ? "JC's answers" : s.type === 'end' ? 'End' : s.type;
};
const types = (d) => d.steps.filter((s) => s.type !== 'label' && s.type !== 'goto').map((s) => `${s.type}${s.who ? ':' + s.who : ''}${s.text !== undefined ? ':' + s.text : ''}`);

// ---------------------------------------------------------------- the tests

test('the dialogue on the node canvas: Start, a line with its text, the answers as rows, the End', () => {
  const t = view();
  const labels = t.root.querySelectorAll('.gc-node').map((e) => e.getAttribute('aria-label'));
  assert.deepEqual(labels, ['Start of the dialogue', 'Guard', "JC's answers", 'End']);
  assert.equal(t.nodeEl('Guard').querySelector('.gc-body').textContent, 'Halt.');
  assert.deepEqual(t.nodeEl("JC's answers").querySelectorAll('.gc-r').map((r) => r.querySelector('.gc-tx').textContent), ['Sorry', 'Make me']);
  assert.match(t.side.textContent, /3 steps · 1 not reached/);    // the answers go nowhere yet: the End is not reached
  assert.ok(t.host.querySelector('[data-do="play"]'));
});

test('a line written in its node: Enter goes on to the next line, said by the other speaker, written in turn', () => {
  const t = view();
  t.pointer('dblclick', t.nodeEl('Guard').querySelector('.gc-body'), [10, 40]);
  let box = t.field();
  assert.ok(box, 'a field in the node');
  assert.equal(box.value, 'Halt.');
  assert.equal(page.active, box);
  box.value = 'Halt! Who goes there?';
  t.key('Enter', box);
  assert.deepEqual(types(t.d), ['line:npc:Halt! Who goes there?', 'line:jc:', 'choice', 'end']);
  // the new line is beside the first, written now; its place kept
  const added = t.d.steps[1].id;
  assert.ok(t.layout[added], 'placed beside the line');
  box = t.field();
  assert.ok(box && t.nodeOf(added).querySelector('.gc-body').contains(box));
  box.value = 'A friend.';
  t.key('Escape', box);
  assert.equal(t.field(), null);
  assert.equal(t.nodeOf(added).querySelector('.gc-body').textContent, 'A friend.');
  assert.equal(page.active, t.root);                  // the keys are the graph's again
});

test('Esc with nothing changed puts the node back as it was; Tab gives the line to the next speaker', () => {
  const t = view();
  t.pointer('dblclick', t.nodeEl('Guard'), [10, 10]);
  t.key('Escape', t.field());
  assert.equal(t.field(), null);
  assert.equal(t.nodeEl('Guard').querySelector('.gc-body').textContent, 'Halt.');
  assert.deepEqual(t.calls, []);                     // nothing changed
  t.pointer('dblclick', t.nodeEl('Guard'), [10, 10]);
  t.key('Tab', t.field());
  assert.equal(t.d.steps[0].who, 'jc');
  assert.ok(t.field(), 'still written, by the new speaker');
  t.key('Tab', t.field(), { shiftKey: true });
  assert.equal(t.d.steps[0].who, 'npc');
  t.key('Escape', t.field());
});

test("an answer written in its row: Enter goes to the next answer, from the last a new one", () => {
  const t = view();
  const rows = t.nodeEl("JC's answers").querySelectorAll('.gc-r');
  t.pointer('dblclick', rows[1], [10, 10]);
  let box = t.field();
  assert.equal(box.value, 'Make me');
  box.value = 'Make me, then.';
  t.key('Enter', box);
  assert.deepEqual(t.d.steps[1].options.map((o) => o.text), ['Sorry', 'Make me, then.', '']);
  box = t.field();
  assert.ok(t.nodeEl("JC's answers").querySelectorAll('.gc-r')[2].contains(box));
  box.value = 'Bye.';
  t.key('Escape', box);
  assert.equal(t.d.steps[1].options[2].text, 'Bye.');
});

test('the window losing the focus does not end the writing; a click elsewhere on the page does', () => {
  const t = view();
  t.pointer('dblclick', t.nodeEl('Guard'), [10, 10]);
  const box = t.field();
  document.hasFocus = () => false;
  box.fire('blur', {});
  assert.equal(t.field(), box);
  document.hasFocus = () => true;
  box.value = 'Stop.';
  box.fire('blur', {});
  assert.equal(t.field(), null);
  assert.equal(t.d.steps[0].text, 'Stop.');
});

test('Enter on a selected step adds a line after it; Delete removes the selection; the Start stays', () => {
  const t = view();
  t.click(t.nodeEl('Guard'));
  t.key('Enter');
  assert.deepEqual(types(t.d), ['line:npc:Halt.', 'line:jc:', 'choice', 'end']);
  t.key('Escape', t.field());
  t.click(t.nodeEl("JC's answers"));
  t.key('Delete');
  assert.deepEqual(types(t.d), ['line:npc:Halt.', 'line:jc:', 'end']);
  t.click(t.nodeEl('Start'));
  t.key('Delete');
  assert.equal(t.root.querySelectorAll('.gc-node').length, 4);
});

test('a wire from a dot onto empty space: the menu, and the step picked goes there, connected; onto a step: connected', () => {
  const t = view({ layout: { [START]: [0, 0], n1: [200, 0], n2: [500, 0], n3: [800, 0] } });
  // Guard's out pin (right edge, header) to far below
  const pin = t.nodeEl('Guard').querySelector('.gc-pin.out');
  t.pointer('pointerdown', pin, [440, 14]);
  t.pointer('pointermove', t.root, [450, 200]);
  t.pointer('pointermove', t.root, [460, 400]);
  t.pointer('pointerup', t.root, [460, 400]);
  assert.ok(t.quick(), 'the quick add');
  // after a line of the Guard: JC's line and the End first, then a step already there
  assert.deepEqual(t.shown().slice(0, 4), ['# Fits here', 'Line: JC', 'End of dialogue', 'Connect to an existing step…']);
  t.choose('Condition (flags)');
  assert.equal(t.quick(), null);
  assert.deepEqual(types(t.d), ['line:npc:Halt.', 'if', 'choice', 'end']);
  const cond = t.d.steps[1].id;
  assert.deepEqual(t.layout[cond], [420, 346]);   // where it was let go (the view starts at 40, 40), its header there
  // the condition's Yes (free) onto the End's in pin: connected by a label
  const yes = t.nodeOf(cond).querySelectorAll('.gc-r')[0].querySelector('.gc-pin.out');
  const endIn = t.nodeEl('End').querySelector('.gc-pin.in');
  const endAt = [840, 54];                           // its in pin at [800, 14] in the world, 40, 40 on the screen
  t.pointer('pointerdown', yes, [680, 386 + 28 + 11]);
  t.pointer('pointermove', t.root, [750, 100]);
  t.pointer('pointermove', t.root, endAt);
  t.pointer('pointerup', endIn, endAt);
  const s = t.d.steps.find((x) => x.id === cond);
  assert.ok(s.goto, 'its Yes jumps');
  const label = t.d.steps.find((x) => x.type === 'label' && x.name === s.goto);
  assert.equal(t.d.steps[t.d.steps.indexOf(label) + 1].type, 'end');
});

test('the right-click menu of a line: write it, who says it, a line after it, delete it', () => {
  const t = view();
  const guard = t.nodeEl('Guard');
  t.root.fire('contextmenu', { target: guard, clientX: 30, clientY: 30, preventDefault() {} });
  assert.deepEqual(t.menu().querySelectorAll('button').map((b) => b.textContent), ['Write the line', 'Who says it…', 'Everything of it at the side',
    'Add a step after it…', 'Duplicate', 'Copy', 'Cut', 'Disconnect its way on', 'Delete step']);
  t.pick('Who says it…');
  assert.deepEqual(t.menu().querySelectorAll('button').map((b) => b.textContent), ['Guard', 'JC Denton', 'Bob']);
  t.pick('Bob');
  assert.equal(t.d.steps[0].who, 'actor:Bob');
  t.root.fire('contextmenu', { target: t.nodeEl("JC's answers"), clientX: 30, clientY: 30, preventDefault() {} });
  t.pick('Delete step');
  assert.deepEqual(types(t.d), ['line:actor:Bob:Halt.', 'end']);
  // on empty space: what to add there, on its own, found by typing
  t.root.fire('contextmenu', { target: t.root, clientX: 300, clientY: 300, preventDefault() {} });
  assert.ok(t.shown().includes('# View') && t.shown().includes('Tidy the graph'));
  t.type('line jc');
  assert.equal(t.shown()[0], 'Line: JC');
  t.choose('Line: JC');
  assert.deepEqual(types(t.d), ['line:actor:Bob:Halt.', 'end', 'line:jc:']);
});

test('a value of a node clicked: the List\'s field of it alone, in a box there; Esc puts it back', () => {
  const t = view({ options: {
    inspect: (el, i) => { el.innerHTML = `<div class="card"><div class="f"><select data-k="who"></select><button>where</button><textarea data-k="text"></textarea></div><div class="f"><input data-k="mood"></div></div>`; el.dataset.step = i; },
    valueField: (s, v) => [`[data-k="${v}"]`],
  } });
  const who = t.nodeEl('Guard').querySelector('.gc-v');
  assert.equal(who.dataset.value, 'who', 'who speaks is a value of the line');
  t.click(who);
  const box = t.host.querySelector('.gve');
  assert.ok(box, 'the box');
  assert.match(box.textContent, /Who says it/);
  const rows = box.querySelectorAll('.f');
  assert.ok(box.querySelector('.gve-b').cls.includes('gve-only'));
  assert.ok(rows[0].cls.includes('gve-keep') && !rows[1].cls.includes('gve-keep'), 'only its row kept');
  assert.ok(box.querySelector('textarea').cls.includes('gve-off'), 'the other fields of the row hidden');
  assert.ok(box.querySelector('.gve-b').querySelector('button').cls.includes('gve-off'));
  assert.ok(!box.querySelector('select').cls.includes('gve-off'));
  // changed in the box, then Esc: as it was
  t.d.steps[0].who = 'jc';
  box.fire('change', { target: box.querySelector('select') });     // as it bubbles up in a page
  box.fire('keydown', t.ev({ key: 'Escape', target: box }));
  assert.equal(t.host.querySelector('.gve'), null);
  assert.equal(t.d.steps[0].who, 'npc');
  // the node's menu opens it too
  t.root.fire('contextmenu', { target: t.nodeEl("JC's answers"), clientX: 30, clientY: 30, preventDefault() {} });
  t.pick('Answer 2…');
  assert.match(t.host.querySelector('.gve').textContent, /Answer 2/);
});

test('copy, paste and duplicate steps with the arrows among them; cut', () => {
  const t = view({ layout: { [START]: [0, 0], n1: [200, 0], n2: [500, 0], n3: [800, 0] } });
  t.key('a', t.root, { ctrlKey: true });
  t.key('c', t.root, { ctrlKey: true });
  const before = t.calls.length;
  t.key('v', t.root, { ctrlKey: true });
  assert.deepEqual(types(t.d), ['line:npc:Halt.', 'choice', 'end', 'line:npc:Halt.', 'choice', 'end']);
  assert.equal(t.calls.length - before, 1, 'one change: one Ctrl+Z takes the paste back');
  const pasted = t.d.steps.filter((s) => s.type !== 'label' && s.type !== 'goto').slice(3).map((s) => s.id);
  assert.ok(pasted.every((id) => !['n1', 'n2', 'n3'].includes(id)), 'new ids');
  assert.deepEqual(t.layout[pasted[1]].map((v, k) => v - t.layout[pasted[0]][k]), [300, 0], 'the same places among them');
  // only one, duplicated: beside it
  t.click(t.nodeOf('n3'));
  t.key('d', t.root, { ctrlKey: true });
  assert.deepEqual(types(t.d).slice(-1), ['end']);
  assert.equal(types(t.d).length, 7);
  // cut: gone, and pasted back
  t.root.fire('contextmenu', { target: t.nodeOf('n1'), clientX: 30, clientY: 30, preventDefault() {} });
  t.pick('Cut');
  assert.ok(!t.d.steps.some((s) => s.id === 'n1'));
  t.root.fire('contextmenu', { target: t.root, clientX: 300, clientY: 300, preventDefault() {} });
  assert.equal(t.shown()[0], '# Edit');
  t.choose('Paste the step');
  assert.equal(types(t.d).filter((x) => x === 'line:npc:Halt.').length, 2);
});

test('a wire: a step inserted in it; a wire let go connects to a step already there', () => {
  const t = view({ layout: { [START]: [0, 0], n1: [200, 0], n2: [500, 0], n3: [800, 0] } });
  // the Start's wire to the Guard's line: from [100, 14] to [200, 14] in the world, 40, 40 more on the screen
  t.root.fire('contextmenu', { target: t.root, clientX: 190, clientY: 54, preventDefault() {} });
  assert.deepEqual(t.menu().querySelectorAll('button').map((b) => b.textContent), ['Insert a step here…', 'Connect it to another step…', 'Disconnect']);
  t.pick('Insert a step here…');
  assert.deepEqual(t.shown().slice(0, 2), ['# Fits here', 'Line: Guard'], 'after the Start: a line of the Guard first');
  t.choose('Condition (flags)');
  assert.deepEqual(types(t.d), ['if', 'line:npc:Halt.', 'choice', 'end'], 'the Start goes to the condition, its No to the line');
  // from the choice's first answer (free) onto empty space: to the End already there
  const answer = t.nodeOf('n2').querySelectorAll('.gc-r')[0].querySelector('.gc-pin.out');
  t.pointer('pointerdown', answer, [760, 80]);
  t.pointer('pointermove', t.root, [770, 300]);
  t.pointer('pointermove', t.root, [780, 500]);
  t.pointer('pointerup', t.root, [780, 500]);
  t.choose('Connect to an existing step…');
  t.type('end');
  t.choose('end');
  const choice = t.d.steps.find((s) => s.id === 'n2');
  assert.ok(choice.options[0].goto, 'the answer jumps');
  const label = t.d.steps.find((s) => s.type === 'label' && s.name === choice.options[0].goto);
  assert.equal(t.d.steps[t.d.steps.indexOf(label) + 1].id, 'n3');
});

test("without the editor's history the graph's own Undo puts the steps and places back; with it, the editor's", () => {
  const t = view();
  t.click(t.nodeEl('Guard'));
  t.key('Enter');
  t.key('Escape', t.field());
  assert.equal(t.d.steps.length, 4);
  t.host.querySelector('[data-do="undo"]').onclick();
  assert.deepEqual(types(t.d), ['line:npc:Halt.', 'choice', 'end']);
  const asked = [];
  const h = view({ options: { undo: () => asked.push('undo'), redo: () => asked.push('redo') } });
  h.host.querySelector('[data-do="undo"]').onclick();
  assert.deepEqual(asked, ['undo']);
});

test('Tidy lays the nodes out again and keeps their places; Play-test lights the step it is at', () => {
  const t = view({ layout: { n1: [0, 900], n3: [5, 5] } });
  t.host.querySelector('[data-do="tidy"]').onclick();
  assert.ok(Object.keys(t.layout).length >= 2);
  assert.notDeepEqual(t.layout.n1, [0, 900]);
  t.host.querySelector('[data-do="play"]').onclick();
  assert.match(t.side.textContent, /Play-test/);
  assert.match(t.side.textContent, /Halt\./);
  assert.ok(t.nodeEl("JC's answers").cls.includes('hot'), 'at the answers, lit');
  assert.ok(t.root.cls.includes('gc-lit'));
  t.side.querySelector('[data-play="stop"]').onclick();
  assert.ok(!t.root.cls.includes('gc-lit'));
});

test('the view for the next one: zoom, selection and the keys\' focus kept', () => {
  const t = view();
  t.click(t.nodeEl('Guard'));
  t.root.focus();
  const kept = t.v.getView();
  assert.equal(kept.selected, 'n1');
  assert.equal(kept.focused, true);
  t.v.destroy();
  const again = view({ options: { start: { ...kept, view: { x: 3, y: 4, k: 0.6 } } } });
  assert.deepEqual(again.v.getView().view, { x: 3, y: 4, k: 0.6 });
  assert.equal(again.v.getView().selected, 'n1');
  assert.equal(page.active, again.root);
  assert.match(again.side.textContent, /fields of step 0/);
});

test('zoomed out, writing a line brings it to 100% in the middle (under 50% the node is only its cover)', () => {
  const t = view({ layout: { n1: [1000, 500] }, options: { start: { view: { x: 0, y: 0, k: 0.4 } } } });
  t.pointer('dblclick', t.nodeEl('Guard'), [400, 200]);
  assert.ok(t.field());
  const v = t.v.getView().view, size = [240, 28 + 3 * 17 + 10];
  assert.deepEqual(v, { k: 1, x: 400 - 1000 - size[0] / 2, y: Math.round(300 - 500 - size[1] / 2) });
  t.key('Escape', t.field());
  // near enough already: the view stays
  t.v.destroy();
  const u = view({ options: { start: { view: { x: 5, y: 6, k: 0.9 } } } });
  u.pointer('dblclick', u.nodeEl('Guard'), [10, 10]);
  assert.deepEqual(u.v.getView().view, { x: 5, y: 6, k: 0.9 });
});
