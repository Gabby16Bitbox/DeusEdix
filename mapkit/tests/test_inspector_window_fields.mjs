// A Properties window repeats the Inspector panel's markup, ids too (app.js's code, run as it is, on stand-in fields):
// a label's click works on the field of its own Inspector (wireLabelClicks), and a sign's font or background picture
// uploaded from a window ends in that window's fields and sign, not in the panel's (the Inspector at work is the panel
// again once the event is over).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = (name) => {                     // a function of one line, or up to its closing brace
  const at = source.indexOf(`function ${name}(`), first = source.slice(at, source.indexOf('\n', at));
  assert.ok(at >= 0, name);
  return first.trimEnd().endsWith('}') ? first : source.slice(at, source.indexOf('\n}', at) + 2);
};
const line = (start) => { const at = source.indexOf(start); assert.ok(at >= 0, start); return source.slice(at, source.indexOf('\n', at)); };
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- labels
function field(type = 'text') { return { type, focused: 0, clicked: 0, focus() { this.focused++; }, click() { this.clicked++; } }; }
function inspector(fields) {
  const on = {};
  return { on, addEventListener: (type, fn) => { (on[type] ||= []).push(fn); }, querySelector: (sel) => fields[sel.slice(1)] || null };
}
const click = (details, label, prevented = false) => {
  const e = { target: { closest: (sel) => (sel === 'label[for]' ? label : null) }, defaultPrevented: prevented, preventDefault() { this.defaultPrevented = true; } };
  for (const fn of details.on.click) fn(e);
  return e;
};

test('a label clicked in a Properties window works on that window\'s field, not on the panel\'s of the same id', () => {
  const c = vm.createContext({ CSS: { escape: (s) => s } });
  vm.runInContext(body('wireLabelClicks'), c);
  const panel = { scriptingtag: field(), pp5: field('range'), pg: field('checkbox') }, own = { scriptingtag: field(), pp5: field('range'), pg: field('checkbox') };
  const win = inspector(own), main = inspector(panel);
  c.wireLabelClicks(win); c.wireLabelClicks(main);
  // the browser's label.control: the first field of that id in the page, the panel's
  const label = (id) => ({ htmlFor: id, control: panel[id] });
  assert.ok(click(win, label('scriptingtag')).defaultPrevented);
  assert.deepEqual([own.scriptingtag.focused, panel.scriptingtag.focused], [1, 0], 'Tag: the window\'s field');
  click(win, label('pp5'));
  assert.deepEqual([own.pp5.focused, panel.pp5.focused], [1, 0], 'Hue: the window\'s slider');
  click(win, label('pg'));
  assert.deepEqual([own.pg.clicked, panel.pg.clicked], [1, 0], 'a box: ticked in the window');
  // in the panel the browser's own is right; a click a drag took (X, Y, Z) is left alone
  assert.equal(click(main, label('scriptingtag')).defaultPrevented, false);
  assert.equal(panel.scriptingtag.focused, 0);
  click(win, label('pp5'), true);
  assert.equal(own.pp5.focused, 1);
  assert.equal(click(win, { htmlFor: 'gone', control: null }).defaultPrevented, false, 'no such field: nothing');
});

test('every Inspector is wired for it: the panel and each Properties window', () => {
  const c = vm.createContext({}), wired = [];
  for (const name of ['wireTransformScrub', 'wireNumberScrub', 'wireNumberMaths', 'wirePropMenu', 'wireLabelClicks']) c[name] = (el) => wired.push([name, el]);
  vm.runInContext(body('wireInspectorBody'), c);
  c.wireInspectorBody('details');
  assert.deepEqual(wired.at(-1), ['wireLabelClicks', 'details']);
});

// ---- a sign's uploads
// an Inspector's fields by id, made when first asked for; text: what its sign's text field holds
function fields(text) {
  const all = new Map();
  const make = (sel) => ({ id: sel, value: { '#sgtext': text, '#sgw': '128', '#sgh': '64', '#sgsize': 'auto', '#sgwear': '0', '#sgoutw': '0' }[sel] ?? '',
    checked: false, files: [], innerHTML: '', classList: { contains: () => false, toggle() {} }, setAttribute() {}, addEventListener() {}, click() {},
    querySelectorAll: () => [], getContext: () => ({ drawImage() {} }) });
  return { get: (sel) => all.get(sel) || all.set(sel, make(sel)).get(sel), find(sel) { return this.get(sel); } };
}
function signPage() {
  const calls = [], panel = fields('PANEL TEXT'), win = fields('WINDOW TEXT'), waits = {};
  const later = (key) => new Promise((resolve) => { waits[key] = resolve; });
  class Image { set src(v) { setTimeout(() => this.onload()); } get width() { return 64; } get height() { return 32; } }
  const c = vm.createContext({
    inspectorView: null, buildJob: null, mapLoading: false, script: 'dx:01_Lab', edits: { textures: {}, boxes: [] },
    document: { querySelector: (sel) => panel.get(sel), body: { contains: () => true },
      createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/png;base64,' }) },
    URL: { createObjectURL: () => 'blob:' }, Image, setTimeout,
    pushUndo: (label) => calls.push(['step', label]), setDirty: () => calls.push('dirty'), log: (...a) => calls.push(['log', ...a]),
    updateSignTexture: async () => calls.push('texture'), signShape() {}, signCanvas: async () => ({}), signLook: () => ({}),
    fontOptions: (family) => `options:${family}`, fontFamilies: async () => {}, importFont: () => later('font'),
    api: (path) => { calls.push(['api', path]); return later('picture'); },
  });
  vm.runInContext([line('const $ = (s) =>').replace(/^const /, 'var '), body('inInspector'), body('rebuildWaits'), body('refuseWhileBuilding')].join('\n'), c);
  const start = source.indexOf("  if (d.kind === 'box' && d.box.sign) {"), end = source.indexOf("  if ($('#blight'))", start);
  vm.runInContext(`function wireSign(d, el, view) {\n${source.slice(start, end)}}`, c);
  const sign = { name: 'UCEditBox3', lo: [0, -64, 0], hi: [8, 64, 64], sign: { text: 'OLD', face: '+x' } };
  return { c, calls, panel, win, waits, sign, wire(view, own) { c.inspectorView = view; c.wireSign({ kind: 'box', box: sign }, { querySelector: () => own.get('.sg-panel') }, view); c.inspectorView = null; } };
}
// a file chosen in an Inspector's file field: its change event (that Inspector at work while it is handled), then the
// next task (the panel at work again) before the upload answers
async function choose(p, view, own, id) {
  own.get(id).files = [{ name: 'file' }];
  p.c.inspectorView = view;
  const done = own.get(id).onchange();
  p.c.inspectorView = null;
  await tick(); await tick();
  return done;
}

test('a font imported in a Properties window goes into that window\'s list and sign, not the panel\'s', async () => {
  const p = signPage(), view = { find: (sel) => p.win.get(sel) };
  p.wire(view, p.win);
  await tick();
  const done = choose(p, view, p.win, '#sgfontfile');
  await tick();
  p.waits.font('Comic Neue');
  await done;
  assert.equal(p.win.get('#sgfont').innerHTML, 'options:Comic Neue');
  assert.equal(p.panel.get('#sgfont').innerHTML, '', 'the panel\'s list is left alone');
  assert.equal(p.sign.sign.text, 'WINDOW TEXT', 'the sign takes the window\'s fields');
  assert.deepEqual(p.calls.filter((x) => x[0] === 'step'), [['step', 'Sign text']]);
});

test('a background picture imported in a Properties window goes into that window\'s field; a Rebuild started meanwhile changes nothing', async () => {
  const p = signPage(), view = { find: (sel) => p.win.get(sel) };
  p.wire(view, p.win);
  let done = choose(p, view, p.win, '#sgbgfile');
  await tick(); await tick();
  p.waits.picture({ name: 'UCT_SignPicture_1', pcx: 'a.pcx', png: 'a.png', w: 64, h: 32 });
  await done;
  assert.equal(p.win.get('#sgbgtex').value, 'UCT_SignPicture_1');
  assert.equal(p.panel.get('#sgbgtex').value, '');
  assert.equal(p.sign.sign.look.bgTex, 'UCT_SignPicture_1');
  assert.equal(p.c.edits.textures.UCT_SignPicture_1.from, 'sign-picture');
  // again, with a Rebuild pressed while the picture is imported
  done = choose(p, view, p.win, '#sgbgfile');
  await tick(); await tick();
  p.c.buildJob = { map: '01_Lab' };
  p.waits.picture({ name: 'UCT_SignPicture_2', pcx: 'b.pcx', png: 'b.png', w: 64, h: 32 });
  await done;
  assert.equal(p.c.edits.textures.UCT_SignPicture_2, undefined);
  assert.equal(p.win.get('#sgbgtex').value, 'UCT_SignPicture_1');
  assert.match(p.calls.at(-1)[1], /^Picture: Rebuilding 01_Lab: the picture waits until it ends/);
});
