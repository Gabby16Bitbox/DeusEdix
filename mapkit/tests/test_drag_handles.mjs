// Drag handles (static/drag-handles.js, run with the editor's three.js, no WebGL): every view has its own dots, a dot
// whose line runs toward one view's eye is left out in that view only, so the Top, Front and Side views pick and draw
// the dots square to them whatever the 3D view looks at.
import test, { THREE, threeURL } from './three.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const own = (name) => new URL(`../editor/static/${name}`, import.meta.url).href;
const source = (await readFile(new URL('../editor/static/drag-handles.js', import.meta.url), 'utf8'))
  .replace("from 'three'", `from '${threeURL}'`)
  .replace("from './range-handles.js'", `from '${own('range-handles.js')}'`)
  .replace("from './block-handles.js'", `from '${own('block-handles.js')}'`);
globalThis.window = { addEventListener() {} };
const { createDragHandles } = THREE ? await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`) : {};

const G = (v) => [v.x, v.z, v.y];                        // three -> the game's axes
const BLOCK = { of: 'block', shape: 'box', centre: [0, 0, 64], size: [128, 128, 128], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
const FRONT = THREE && new THREE.Vector3(0, 0, -1), TOP = THREE && new THREE.Vector3(0, -1, 0);       // the panes' looks (ortho-views.js KINDS)
// the controller over one selected block, its 3D camera at `eye` (the game's axes) looking at the block
function page(eye) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1, 1, 100000);
  camera.position.set(eye[0], eye[2], eye[1]);
  if (!eye[0] && !eye[1]) camera.up.set(0, 0, -1);        // straight down: the screen's up is the map's -Y, as Top's
  camera.lookAt(0, 64, 0);
  camera.updateMatrixWorld();
  const canvas = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), addEventListener() {} };
  const target = { name: 'UCEditBox0' };
  const h = createDragHandles({ scene, camera, canvas, SNAP: { move: 16, rotate: 15 }, wake() {}, snapOn: () => false, note() {},
    target: () => target, ranges: () => [structuredClone(BLOCK)], editable: () => true, begin: () => ({}), preview() {}, end() {}, cancel() {} });
  h.update();
  const points = scene.children.find((o) => o.isPoints);
  // the dots one view drew: where they are (the game's axes)
  const drawn = () => Array.from({ length: points.geometry.drawRange.count }, (_, i) => G(new THREE.Vector3().fromBufferAttribute(points.geometry.attributes.position, i)));
  return { h, points, drawn };
}
const heights = (list) => list.filter((at) => !at[0] && !at[1]).map((at) => at[2]).sort((a, b) => a - b);
// a pane's ray: from far in front of the pane, along its look, through a point of the map
const paneRay = (look, at) => ({ ray: new THREE.Ray(new THREE.Vector3(at[0], at[2], at[1]).addScaledVector(look, -5000), look.clone()) });

test('the 3D view looking straight down leaves out the top and bottom dots; the Front view still drags them', () => {
  const { h, drawn } = page([0, 0, 2000]);
  assert.equal(h.dots.length, 4);
  assert.deepEqual(heights(h.dots.map((d) => d.at)), []);
  assert.deepEqual(heights(drawn()), []);                          // the 3D view's buffer
  h.drawFor(FRONT);                                                // the Front pane about to be drawn
  assert.equal(drawn().length, 4);
  assert.deepEqual(heights(drawn()), [0, 128]);                    // its top and bottom, square to it
  h.drawFor();
  assert.deepEqual(heights(drawn()), []);                          // the 3D view's again
  assert.equal(h.pressRay(paneRay(FRONT, [0, 0, 128]), 2), true);  // grabbed in the pane
  h.release(true);
});

test('the 3D view looking along X leaves out the X sides; the Top view still drags them', () => {
  const { h, drawn } = page([2000, 0, 64]);
  assert.ok(h.dots.every((d) => d.at[0] === 0));
  h.drawFor(TOP);
  assert.deepEqual(drawn().filter((at) => at[0]).map((at) => at[0]).sort((a, b) => a - b), [-64, 64]);
  assert.equal(h.pressRay(paneRay(TOP, [64, 0, 64]), 2), true);
  h.release(true);
  assert.equal(h.pressRay(paneRay(TOP, [0, 0, 128]), 2), false);    // the top runs into the Top view: nothing to drag there
});

// ---- a drag in the page (static/app.js: its handle functions and its undo, run as they are)
const app = await readFile(new URL('../editor/static/app.js', import.meta.url), 'utf8');
const body = (name) => { const i = app.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return app.slice(i, app.indexOf('\n}', i) + 2); };
function handlePage() {
  const T = (a) => new THREE.Vector3(a[0], a[2], a[1]);
  const lamp = { name: 'Light1', cls: 'Light', props: { LightRadius: '8' } }, calls = [];
  const box = { name: 'UCEditBox0', lo: [0, 0, 0], hi: [128, 128, 128] };
  const c = vm.createContext({ THREE, T, edits: { props: { Light1: { Tag: 'Lamp' } }, boxes: [box] }, undo: ['earlier'], redoStack: ['undone'],
    requireUnlocked: () => true, putProp: (a, k, text) => { (c.edits.props[a.name] ||= {})[k] = text; }, refreshLight() {}, showSoundRange() {}, wake() {},
    commit: () => calls.push('commit'), setDirty: () => calls.push('dirty'), showDetails() {}, status() {}, dressBlock() {} });
  vm.runInContext(['pushUndo', 'beginHandleDrag', 'previewHandleDrag', 'endHandleDrag', 'cancelHandleDrag', 'ownPropsBack'].map(body).join('\n'), c);
  const light = { userData: { actor: lamp }, position: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1) };
  const block = { userData: { box }, position: T([64, 64, 64]), scale: new THREE.Vector3(128, 128, 128) };
  return { c, light, block, calls, radius: (text) => ({ range: {}, props: { LightRadius: text }, centre: null, note: `Radius ${text}` }) };
}
const history = (c) => JSON.parse(JSON.stringify([c.undo, c.redoStack]));

test('Esc, or a drag let go where it began, leaves Ctrl+Z and Ctrl+Y as they were', () => {
  const { c, light, block, radius } = handlePage(), before = JSON.stringify(c.edits);
  let saved = c.beginHandleDrag(light);
  c.previewHandleDrag(light, radius('12'), saved);
  assert.equal(c.edits.props.Light1.LightRadius, '12');           // written as it goes
  c.cancelHandleDrag(light, saved);                                 // Esc
  assert.equal(JSON.stringify(c.edits), before);
  assert.deepEqual(history(c), [['earlier'], ['undone']]);
  saved = c.beginHandleDrag(light);
  c.previewHandleDrag(light, radius('12'), saved);
  c.previewHandleDrag(light, radius('8'), saved);
  c.endHandleDrag(light, radius('8'), saved);                       // back where it was: nothing changed
  assert.deepEqual(history(c), [['earlier'], ['undone']]);
  saved = c.beginHandleDrag(block);
  c.endHandleDrag(block, { range: { centre: [64, 64, 64], size: [128, 128, 128] }, props: null, centre: [64, 64, 64], note: '' }, saved);
  assert.deepEqual(history(c), [['earlier'], ['undone']]);
  assert.equal(JSON.stringify(c.edits), before);
});

test('a drag that changed something is one Ctrl+Z: the edits as it found them; Ctrl+Y is emptied then', () => {
  const { c, light, block, radius, calls } = handlePage(), before = JSON.stringify(c.edits);
  let saved = c.beginHandleDrag(light);
  c.previewHandleDrag(light, radius('12'), saved);
  c.endHandleDrag(light, radius('12'), saved);
  assert.deepEqual(history(c), [['earlier', before], []]);
  assert.deepEqual(JSON.parse(JSON.stringify(c.edits.props.Light1)), { Tag: 'Lamp', LightRadius: '12' });
  assert.deepEqual(calls, ['dirty']);
  const lit = JSON.stringify(c.edits);
  saved = c.beginHandleDrag(block);
  c.endHandleDrag(block, { range: { centre: [80, 64, 64], size: [160, 128, 128] }, props: null, centre: [80, 64, 64], note: 'Width 160' }, saved);
  assert.deepEqual(history(c), [['earlier', before, lit], []]);
  assert.deepEqual(JSON.parse(JSON.stringify([c.edits.boxes[0].lo, c.edits.boxes[0].hi])), [[0, 0, 0], [160, 128, 128]]);
  c.undo.length = 100;
  saved = c.beginHandleDrag(light);
  c.cancelHandleDrag(light, saved);
  assert.equal(c.undo.length, 100);                                 // the oldest step is not lost to a cancelled drag
});

test('in a pane the sides seen edge on are not dimmed; the one facing away from the 3D camera is', () => {
  const { h, points } = page([600, -900, 400]);
  const colours = () => Array.from({ length: points.geometry.drawRange.count }, (_, i) => points.geometry.attributes.color.getX(i));
  assert.equal(new Set(colours().map((v) => v.toFixed(3))).size, 2);       // bright and dim, from the 3D camera
  h.drawFor(FRONT);
  const front = colours();
  assert.equal(front.filter((v) => v < front[0] - 1e-6 || v > front[0] + 1e-6).length, 0);    // all alike: none faces away
  h.drawFor();
});
