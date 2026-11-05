// Face selection's recent textures and Grow in the Surface tools (static/surface-ui.js), on three.js meshes as the
// editor builds them (positions three a triangle, userData.faces the face of each): a texture put by a drag or the
// Texture list comes first on the strip, one put from the strip keeps its place; each is one undo step; Grow takes the
// faces next to the selection as the 3D view shows them (a hidden mesh's are left out, a view mode's copies are not
// needed), in their plane or at any angle. The rows of the Texture Slip queued as one step, folded into those before
// them, refused when a face is locked or Save would refuse them; an operation on more faces than a row may name; the
// panel's operations refused in surfaces.py's words (a Pan of 0, 0 and a Scale of 1, 1 too); the panel's Slip; what to
// do with no face selected, in Face selection and outside it; each selected face's texture now (the Texture Slip's).
import test, { THREE } from './three.mjs';
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createSurfaceTools } from '../editor/static/surface-ui.js';
import { withRecent, slotOfDigit } from '../editor/static/recent-textures.js';
import { waitsForBuild, browserKey, PRESSABLE } from '../editor/static/build-progress.js';
import { ROW_LIMIT } from '../editor/static/texture-slip.js';

globalThis.document = { querySelector: () => ({ scrollTop: 0 }) };      // selectIds scrolls the right panel up
const square = (x0, y0, x1, y1, z = 0) => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
// a mesh of polygons [face id, corners], each a fan as data.py writes them
function mesh(polys) {
  const pos = [], faces = [];
  for (const [id, pts] of polys) for (let k = 1; k < pts.length - 1; k++) { faces.push(id); for (const j of [0, k, k + 1]) pos.push(...pts[j]); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  m.userData = { world: true, faces };
  return m;
}
// a floor (0) cut in two, the floor beyond it (1), a wall on its edge (2); in another mesh a floor beside it (3); panel:
// the Surface panel drawn (see panelPage), keyOf and slip as the page gives them
function setup({ canEditFace, panel = false, keyOf, slip } = {}) {
  const scene = new THREE.Scene(), room = mesh([[0, square(0, 0, 128, 256)], [0, square(128, 0, 256, 256)], [1, square(256, 0, 512, 256)],
    [2, [[0, 0, 0], [0, 0, 128], [256, 0, 128], [256, 0, 0]]]]), side = mesh([[3, square(0, 256, 256, 512)]]);
  scene.add(room, side);
  const faces = [0, 1, 2, 3].map((i) => ({ brush: 'Brush' + i, poly: 0, tex: 'Pkg.Old', flags: 0, structure: '' }));
  const edits = {}, steps = [], said = [], logged = [], changed = [];
  let list = [];
  const tools = createSurfaceTools({ THREE, getEdits: () => edits, pushUndo: (label) => steps.push(label), setDirty() {}, deselect() {},
    status: (text, kind) => said.push([text, kind]), log: (line) => logged.push(line), escapeHtml: (s) => String(s), textures: () => [],
    canShowPanel: () => panel, canEditFace, onChange: (op) => changed.push(op), keyOf, slip,
    recent: { list: () => list, add: (ref) => { list = withRecent(list, ref); } } });
  tools.load(faces, [room, side]);
  // the triangle of each face: what a click on it hits
  const hit = (id) => { for (const m of [room, side]) { const t = m.userData.faces.indexOf(id); if (t >= 0) return { object: m, faceIndex: t }; } };
  const targets = () => edits.surfaces.at(-1).targets.map((t) => t.brush).sort();
  return { tools, edits, steps, said, logged, changed, hit, targets, room, side, faces, recent: () => list };
}

test('a texture put by a drag comes first on the strip; one put from the strip keeps its place; one undo step each', () => {
  const s = setup();
  s.tools.pick(s.hit(0), false);
  assert.equal(s.tools.applyRecent(0), false);                                  // nothing on the strip yet
  assert.match(s.said.at(-1)[0], /No recent texture 1/);
  for (const ref of ['Pkg.Floor', 'Pkg.Wall', 'Pkg.Trim']) assert.equal(s.tools.applyTextureAtHit(s.hit(0), ref), true);
  assert.deepEqual(s.recent(), ['Pkg.Trim', 'Pkg.Wall', 'Pkg.Floor']);
  assert.deepEqual(s.steps, ['Face texture', 'Face texture', 'Face texture']);
  s.tools.pick(s.hit(1), true);                                                 // faces 0 and 1
  assert.equal(s.tools.applyRecent(2), true);
  assert.deepEqual(s.edits.surfaces.at(-1).args, ['Pkg.Floor']);
  assert.deepEqual(s.targets(), ['Brush0', 'Brush1']);
  assert.equal(s.steps.length, 4);
  assert.deepEqual(s.recent(), ['Pkg.Trim', 'Pkg.Wall', 'Pkg.Floor']);           // the strip as it was
  assert.match(s.said.at(-1)[0], /^Floor on 2 faces/);
  assert.equal(s.tools.applyRecent(7), false);                                  // an empty place: nothing done
  assert.equal(s.steps.length, 4);
  s.tools.clear();
  assert.equal(s.tools.applyRecent(0), false);                                  // no faces selected
  assert.equal(s.steps.length, 4);
});

test('Grow: the faces next to the selection in its plane, every neighbour at any angle, as the 3D view shows them', () => {
  const s = setup();
  s.tools.grow(false);
  assert.match(s.said.at(-1)[0], /Select a face first/);
  s.tools.pick(s.hit(0), false);
  s.tools.grow(false);
  assert.equal(s.said.at(-1)[0], '2 faces added: 3 selected.');                  // the floor beyond, the floor beside
  s.tools.applyTextureAtHit(s.hit(0), 'Pkg.Floor');
  s.tools.applyRecent(0);
  assert.deepEqual(s.targets(), ['Brush0', 'Brush1', 'Brush3']);
  s.tools.grow(false);
  assert.match(s.said.at(-1)[0], /No face next to the selection lies in its plane/);
  s.tools.grow(true);
  assert.equal(s.said.at(-1)[0], '1 face added: 4 selected.');                   // the wall
  // each face's texture now, which the Texture Slip's walk takes: a queued one, else the one built
  assert.deepEqual(s.tools.selectedFaces().map(({ id, tex }) => [id, tex]), [[0, 'Pkg.Floor'], [1, 'Pkg.Floor'], [3, 'Pkg.Floor'], [2, 'Pkg.Old']]);
  // a mesh hidden (Isolate, the Show menu) is left out; one a view mode hides (Wireframe...) is not
  s.tools.pick(s.hit(0), false);
  s.side.visible = false;
  s.tools.grow(false);
  assert.equal(s.said.at(-1)[0], '1 face added: 2 selected.');
  s.side.userData.viewHidden = true; s.side.userData.shownBefore = true;
  s.tools.pick(s.hit(0), false);
  s.tools.grow(false);
  assert.equal(s.said.at(-1)[0], '2 faces added: 3 selected.');
  // moved since the Rebuild: where it is seen now
  s.side.visible = true; s.side.userData.viewHidden = false;
  s.side.position.set(0, 0, 64);
  s.tools.pick(s.hit(0), false);
  s.tools.grow(true);
  assert.equal(s.said.at(-1)[0], '2 faces added: 3 selected.');                  // the floor beyond, the wall; not the side
});

test('the Texture Slip\'s rows: one undo step, folded into the pan and scale rows before them, refused when locked or too many', () => {
  const s = setup(), A = { brush: 'Brush0', poly: 0 }, C = { brush: 'Brush2', poly: 0 };
  s.tools.pick(s.hit(0), false);
  s.tools.pick(s.hit(2), true);
  assert.deepEqual(s.tools.selectedFaces().map(({ id, face }) => [id, face.brush]), [[0, 'Brush0'], [2, 'Brush2']]);
  const slip = [{ op: 'scale', args: [2, 2], targets: [A, C] }, { op: 'pan', args: [3, 1], targets: [A] }, { op: 'pan', args: [5, 0], targets: [C] }];
  assert.deepEqual(s.tools.queueRows(slip, 'Slip the texture', 'Texture slip: x2.'), { left: ROW_LIMIT - 3 });
  assert.deepEqual([s.steps, s.logged, s.changed, s.edits.surfaces], [['Slip the texture'], ['Texture slip: x2.'], ['slip'], slip]);
  // the same faces slipped back to their size: folded into one pan row each, the map's room back
  const back = [{ op: 'scale', args: [0.5, 0.5], targets: [A, C] }, { op: 'pan', args: [1, 0], targets: [A] }];
  assert.deepEqual(s.tools.queueRows(back, 'Slip the texture', 'Texture slip: x0.5.'), { left: ROW_LIMIT - 2 });
  assert.deepEqual(s.edits.surfaces, [{ op: 'pan', args: [4, 1], targets: [A] }, { op: 'pan', args: [5, 0], targets: [C] }]);
  assert.equal(s.steps.length, 2);
  assert.equal(s.tools.queueRows([], 'Slip the texture', ''), false);
  // a row Save would refuse, a queue past 4096 rows: refused, nothing queued, no undo step
  assert.equal(s.tools.queueRows([{ op: 'pan', args: [0.5, 0], targets: [A] }], 'Slip the texture', ''), false);
  assert.equal(s.said.at(-1)[0], 'Pan uses whole texels, between -32767 and 32767.');
  s.edits.surfaces = Array.from({ length: ROW_LIMIT - 1 }, () => ({ op: 'rotate', args: [], targets: [C] }));
  assert.equal(s.tools.queueRows(slip.slice(0, 2), 'Slip the texture', ''), false);
  assert.deepEqual(s.said.at(-1), ['The map can hold 4096 queued surface changes; this would make 4097: take some back first.', 'warn']);
  assert.equal(s.tools.queue('flip-u', [], [A]), true);                  // one more still fits
  assert.equal(s.tools.applyTextureAtHit(s.hit(0), 'Pkg.Floor'), false);
  assert.match(s.said.at(-1)[0], /^The map can hold 4096 queued surface changes; this would make 4097/);
  assert.equal(s.steps.length, 3);
  // a face of a locked structure: refused before anything is queued
  const locked = setup({ canEditFace: (f) => f.brush !== 'Brush2' });
  assert.equal(locked.tools.queueRows(slip, 'Slip the texture', ''), false);
  assert.deepEqual([locked.said.at(-1)[0], locked.steps, locked.edits.surfaces], ['Unlock the target structure before editing its surfaces.', [], undefined]);
  assert.equal(locked.tools.queue('flip-v', [], [{ brush: 'Brush2', poly: '*' }]), false);
  assert.equal(locked.tools.queue('flip-v', [], [A]), true);
});

test('no face selected: the recent textures and Grow say how to select some: a click in Face selection, its key outside it', () => {
  const s = setup({ keyOf: (id) => (id === 'faces' ? 'J' : '') });            // Settings > Keyboard shortcuts gave it J
  assert.equal(s.tools.applyRecent(0), false);                                  // object selection
  assert.deepEqual(s.said.at(-1), ['Select faces first: Alt+click one, or J and click.', 'warn']);
  s.tools.grow(false);
  assert.deepEqual(s.said.at(-1), ['Select a face first: Alt+click one, or J and click.', 'warn']);
  assert.equal(s.tools.noFaces('faces'), 'Select faces first: Alt+click one, or J and click.');   // the same on the tools object
  s.tools.toggle();                                                             // Face selection: its key would turn it off
  assert.equal(s.tools.applyRecent(0), false);
  assert.deepEqual(s.said.at(-1), ['Select faces first: click one (Shift+click adds).', 'warn']);
  s.tools.grow(true);
  assert.deepEqual(s.said.at(-1), ['Select a face first: click one (Shift+click adds).', 'warn']);
  assert.equal(s.tools.noFaces('faces'), 'Select faces first: click one (Shift+click adds).');      // what the Texture Slip says
  const plain = setup();                                                       // no key given: the editor's own
  plain.tools.grow(true);
  assert.equal(plain.said.at(-1)[0], 'Select a face first: Alt+click one, or Q and click.');
});

test('the panel\'s operations: refused in surfaces.py\'s words with false, a Pan of 0, 0 and a Scale of 1, 1 not queued', () => {
  const s = setup(), A = { brush: 'Brush0', poly: 0 };
  // checked once, as Save checks them (queueProblem), whatever refuses them: false, nothing queued
  for (const [op, args, why] of [['pan', [1.5, 0], 'Pan uses whole texels, between -32767 and 32767.'],
    ['pan', [NaN, 0], 'U and V must be finite numbers.'], ['scale', [0, 1], 'Scale factors must be between 0.001 and 1000.'],
    ['texture', ['Pkg.Bad name'], 'Choose a loaded texture by its package and name.']]) {
    assert.equal(s.tools.queue(op, args, [A]), false, op);
    assert.deepEqual(s.said.at(-1), [why, 'warn']);
  }
  // a Pan of 0, 0 and a Scale of 1, 1 change nothing: not a row taking room in the map's queue
  assert.equal(s.tools.queue('pan', [0, 0], [A]), false);
  assert.deepEqual(s.said.at(-1), ['Nothing to pan: type the texels in Pan U or Pan V first.', 'warn']);
  assert.equal(s.tools.queue('scale', [1, 1], [A]), false);
  assert.deepEqual(s.said.at(-1), ['Nothing to scale: type a factor other than 1 in Scale U or Scale V first.', 'warn']);
  assert.equal(s.tools.queue('pan', [3, 0], []), false);                         // no faces
  assert.deepEqual([s.steps, s.edits.surfaces], [[], undefined]);
  // one of the two is enough
  assert.equal(s.tools.queue('pan', [0, 4], [A]), true);
  assert.equal(s.tools.queue('scale', [1, 2], [A]), true);
  assert.deepEqual(s.edits.surfaces.map((row) => [row.op, row.args]), [['pan', [0, 4]], ['scale', [1, 2]]]);
});

// the Surface panel in a stand-in page: #details takes its HTML, each element by its id kept (what the panel sets on it)
function panelPage() {
  const details = { innerHTML: '', querySelectorAll: () => [] }, byId = new Map();
  const element = (id) => { if (!byId.has(id)) byId.set(id, { id, value: '', hidden: false }); return byId.get(id); };
  return { details, element, document: { querySelector: (sel) => (sel === '#details' ? details : { scrollTop: 0 }), getElementById: element } };
}
test('Ultra Low reads both native shadow bits and can be changed from the face panel', () => {
  const page = panelPage(), before = globalThis.document;
  globalThis.document = page.document;
  try {
    const s = setup({ panel: true });
    for (const [bits, level] of [[0, 'normal'], [0x8000, 'low'], [0x800000, 'high'], [0x808000, 'ultra-low']]) {
      s.faces[0].flags = bits | 0x800; // No Smooth must not affect the detail readout.
      s.tools.pick(s.hit(0), false);
      assert.ok(page.details.innerHTML.includes(`value="${level}" selected`));
    }
    for (const level of ['normal', 'ultra-low']) {
      page.element('sf-shadows').value = level;
      page.element('sf-shadows').onchange();
      assert.deepEqual(s.edits.surfaces.at(-1), { op: 'shadows', args: [level], targets: [{ brush: 'Brush0', poly: 0 }] });
      assert.ok(page.details.innerHTML.includes(`value="${level}" selected`));
    }
    assert.deepEqual(s.steps, ['Shadow detail', 'Shadow detail']);
    s.tools.pick(s.hit(1), true);
    assert.ok(page.details.innerHTML.includes('<option value="">Mixed</option>'));
  } finally { globalThis.document = before; }
});

test('Ultra Low on a structure targets each complete brush, including its hidden faces', () => {
  const page = panelPage(), before = globalThis.document;
  const select = {}, button = {}, box = { innerHTML: '', querySelector: tag => tag === 'select' ? select : button };
  page.document.createElement = () => box;
  page.details.appendChild = () => {};
  globalThis.document = page.document;
  try {
    const s = setup();
    s.faces[0].structure = s.faces[1].structure = 'Wall';
    s.tools.structurePanel('Wall');
    assert.ok(box.innerHTML.includes('<option value="ultra-low">Ultra Low</option>'));
    select.value = 'ultra-low';
    select.onchange({ target: select });
    assert.deepEqual(s.edits.surfaces, [{ op: 'shadows', args: ['ultra-low'],
      targets: [{ brush: 'Brush0', poly: '*' }, { brush: 'Brush1', poly: '*' }] }]);
    assert.equal(select.value, '');
    assert.deepEqual(s.steps, ['Shadow detail']);
  } finally { globalThis.document = before; }
});
test('the panel\'s Slip, with its key, starts the Texture Slip as Edit > Slip the texture does', () => {
  const page = panelPage(), before = globalThis.document, started = [];
  let key = 'Y';
  globalThis.document = page.document;
  try {
    const s = setup({ panel: true, keyOf: (id) => (id === 'faceslip' ? key : ''), slip: () => started.push('slip') });
    s.tools.pick(s.hit(0), false);
    assert.match(page.details.innerHTML, /<button id="sf-slip" title="[^"]*Edit &gt; Slip the texture\)">Slip \(Y\)<\/button>/);
    page.element('sf-slip').onclick();
    assert.deepEqual(started, ['slip']);
    key = 'J';                                                                   // Settings > Keyboard shortcuts gave it J
    s.tools.panel();
    assert.match(page.details.innerHTML, />Slip \(J\)<\/button>/);
  } finally { globalThis.document = before; }
});

test('an operation on more faces than a row may name: rows of 8192, one undo step', () => {
  const s = setup(), many = Array.from({ length: 8197 }, (_, i) => ({ brush: 'Brush9', poly: i }));
  assert.equal(s.tools.queue('shadows', ['high'], many), true);
  assert.deepEqual(s.edits.surfaces.map((row) => [row.op, row.targets.length]), [['shadows', 8192], ['shadows', 5]]);
  assert.deepEqual(s.steps, ['Shadow detail']);
  assert.match(s.logged.at(-1), /^Shadow detail: high: 8197 face targets/);
});

// app.js's keyboard handler (from its flying keys to its end) with the page's few things it reads: in Face selection
// Alt+1…9 and Alt+0 put a recent texture on (not while a Rebuild runs), Alt+G and Alt+Shift+G grow; outside it Alt+1…9
// are the selection slots' still; Ctrl+Alt+digit keeps a selection in both; nothing while typing
nodeTest('the keys of Face selection in the 3D view, and the selection slots outside it', () => {
  const app = readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
  const body = (name) => { const i = app.indexOf(`function ${name}(`); return app.slice(i, app.indexOf('\n}', i) + 2); };
  const i = app.indexOf('const MOVE = {'), j = app.indexOf("$('#lightmode').onchange", i);
  const done = [];
  const c = vm.createContext({ script: 'fixture', mapName: 'fixture', gameView: null, projectHub: null, textureTransfer: null, propertySlider: null,
    inspectorDrag: null, cancelNumberScrub: null, buildJob: null, placing: null, cam: { look: false, keys: {} }, document: { querySelector: () => null }, slotOfDigit,
    waitsForBuild, browserKey, PRESSABLE, status: (text) => done.push('status ' + text),
    surfaceTools: { mode: true, applyRecent: (slot) => done.push('texture ' + slot), grow: (any) => done.push('grow ' + any) },
    recallSelection: (n) => done.push('recall ' + n), keepSelection: (n) => done.push('keep ' + n),
    window: { addEventListener: (type, fn) => { if (type === 'keydown') c.keydown = fn; },
      __menubar: { comboOf: (e) => (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + e.code.replace(/^(Digit|Key)/, '') } } });
  vm.runInContext([body('rebuildWaits'), body('waitsForRebuild'), body('buildKeyGate'), app.slice(i, j)].join('\n'), c);
  const press = (code, mods = {}, target = { tagName: 'CANVAS' }) => {
    done.length = 0;
    c.keydown({ key: code.startsWith('Digit') ? code.slice(5) : code.slice(3).toLowerCase(), code, ctrlKey: false, altKey: false, shiftKey: false,
      ...mods, target, preventDefault() {} });
    return [...done];
  };
  assert.deepEqual(press('Digit3', { altKey: true }), ['texture 2']);
  assert.deepEqual(press('Digit0', { altKey: true }), ['texture 9']);
  assert.deepEqual(press('KeyG', { altKey: true }), ['grow false']);
  assert.deepEqual(press('KeyG', { altKey: true, shiftKey: true }), ['grow true']);
  assert.deepEqual(press('Digit3', { altKey: true, ctrlKey: true }), ['keep 3']);
  assert.deepEqual(press('Digit3', { altKey: true }, { tagName: 'DIV', isContentEditable: true }), ['recall 3']);   // not Face selection's
  assert.deepEqual(press('Digit3', { altKey: true }, { tagName: 'INPUT' }), []);
  // a Rebuild running: a recent texture waits for it (Alt+0 waits at the gate), Grow only selects
  c.buildJob = { map: 'fixture' };
  assert.match(press('Digit3', { altKey: true })[0], /^status Rebuilding fixture: applying a texture waits/);
  assert.match(press('Digit0', { altKey: true })[0], /^status Rebuilding fixture: editing waits/);
  assert.deepEqual(press('KeyG', { altKey: true }), ['grow false']);
  c.buildJob = null;
  // Face selection off: the selection slots
  c.surfaceTools.mode = false;
  assert.deepEqual(press('Digit3', { altKey: true }), ['recall 3']);
  assert.deepEqual(press('Digit0', { altKey: true }), []);
});
