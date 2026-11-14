// What is made in the page (static/app.js, its functions run as they are on a stand-in page) of a kind the 3D view's
// Show menu hides or locks says so, whatever made it: placing from the browser (an object, a block, a prefab, a hole),
// the Hierarchy's + (a cube...), the 2D Shape Editor, a drawing, a hole's light, Fill AI paths, Clip / Intersect, a
// point of a patrol route (pasting, Duplicate and Replace with: test_clipboard, test_scene_transforms,
// test_replace_with). The statuses of placing name the keys as Settings binds them.
import test, { THREE } from './three.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DRAW_LABELS } from '../editor/static/draw-tools.js';
import { namedStep } from '../editor/static/history-names.js';
import { isParticleClass } from '../editor/static/particles.js';
import { linkFields } from '../editor/static/prefab-links.js';

const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
const body = (name) => { const start = source.indexOf(`function ${name}(`); assert.ok(start >= 0, name); return source.slice(start, source.indexOf('\n}', start) + 2); };
// the keys of the 3D view: from the flying keys to the end of the handler
const keysSource = source.slice(source.indexOf('const MOVE = {'), source.indexOf("$('#lightmode').onchange"));
// what a thing is called: an object's, a block's, a drawing's, a structure's name
const nameOf = (p) => p?.userData.actor?.name ?? p?.userData.box?.name ?? p?.userData.drawn?.name ?? p?.userData.name ?? null;
const keyOf = (p) => (p.userData.box ? 'b:' + p.userData.box.name : p.userData.drawn ? 'd:' + p.userData.drawn.name : 'a:' + p.userData.actor.name);

// a stand-in page: the map's edits, its proxies (rebuilt from the edits as the page does), the selection; what the
// status said (said), the Messages (logged) and warnHiddenKinds (warned: [the names of what it got, its word])
function page(extra = {}) {
  const proxies = { children: [] }, used = {};
  const proxy = (userData) => ({ userData, position: new THREE.Vector3() });
  const c = vm.createContext({ isParticleClass,
    THREE, YAW: 65536, proxies, structures: {}, edits: { added: [], boxes: [], drawn: [], prefabs: [], nests: [] },
    selected: null, said: [], logged: [], warned: [], mapName: 'Lab', script: 'lab', snap: false, lastBlockTex: 'Tex', hierOpen: new Set(),
    buildJob: null, waitsForRebuild: () => false,       // no Rebuild running (rebuildMap)
    T: (a) => new THREE.Vector3(a[0], a[2], a[1]), UE: (v) => [v.x, v.z, v.y], r1: (v) => Math.round(v * 10) / 10,
    nextName: (prefix) => prefix + (used[prefix] = (used[prefix] ?? -1) + 1),
    pushUndo() {}, dropUndo() {}, namedStep, objectLabel: (p) => [nameOf(p), ''], itemLabel: (it) => it.cls, setDirty() {}, intoDefaultFolder() {}, folderForNew: () => null, cancelPlacing() {}, focusSelected() {},
    select: (p) => { c.selected = p; }, status: (text, kind) => c.said.push([text, kind]), log: (text, kind) => c.logged.push([text, kind]),
    menuKey: (id) => ({ move: 'W', rotate: 'E', scale: 'J' }[id]),             // the Scale tool bound to J in Settings
    warnHiddenKinds: (list, done) => c.warned.push([[...list].map(nameOf), done]),
    makeBoxProxy: (b) => { const p = proxy({ box: b, kind: 'box' }); proxies.children.push(p); return p; },
    makeProxy: (a) => { const p = proxy({ actor: a, kind: a.kind }); proxies.children.push(p); return p; },
    rebuildProxies: () => {
      proxies.children = [...c.edits.added.map((a) => proxy({ actor: a, kind: a.kind })), ...c.edits.boxes.map((b) => proxy({ box: b, kind: 'box' })),
        ...c.edits.drawn.map((d) => proxy({ drawn: d, kind: 'drawn' }))];
    },
    proxyOf: (name) => proxies.children.find((p) => p.userData.actor?.name === name),
    objOf: (key) => proxies.children.find((p) => keyOf(p) === key) || null,
    ...extra,
  });
  vm.runInContext(['placingName', 'stepOf'].map(body).join('\n'), c);     // the names of the undo steps (history-names.js)
  return c;
}
const load = (c, ...names) => vm.runInContext(names.map(body).join('\n'), c);
const PIECE = [[0, 0, 0], [64, 0, 0], [0, 64, 0], [0, 0, 64]];

test('placing from the browser: an object, a block, a prefab, a hole; the hole\'s Messages name the Scale tool\'s key', () => {
  const c = page({ drawTools: {}, placing: { box: true, size: [128, 128, 16], tex: 'Tex' } });
  load(c, 'placeWith');
  const r = { p: new THREE.Vector3(0, 8, 0), n: new THREE.Vector3(0, 1, 0), hit: new THREE.Vector3() };
  c.placeWith(r);
  assert.deepEqual(c.warned, [[['UCEditBox0'], 'Placed']]);
  Object.assign(c, { placing: { cls: 'AmbientSound', radius: 16, height: 16 }, cam: { yaw: 0 }, radToYaw: () => 0, itemProps: () => ({}),
    addedKind: () => 'logic' });
  c.placeWith(r, { quiet: true });
  assert.deepEqual(c.warned.at(-1), [['UCEdit0'], 'Placed']);
  Object.assign(c, { placing: { prefab: { id: 'pf', label: 'Booth', source: 'Other', pivot: [0, 0, 0] } }, prefabYaw: () => 0, nextPid: () => 'p1',
    moverFields: () => ({}), linkFields, rebuildProxies: () => { c.structures['paste~p1'] = { obj: { userData: { kind: 'structure', name: 'paste~p1' } } }; } });
  c.placeWith(r);
  assert.deepEqual(c.warned.at(-1), [['paste~p1'], 'Placed'], 'a prefab: its structure');
  assert.equal(c.edits.prefabs.at(-1).line, undefined, 'not one of the library: not linked');
  c.placing = { prefab: { id: 'usr_22222222222222222222222222222222', line: 'usr_11111111111111111111111111111111', version: 2, label: 'Desk', source: 'Office', pivot: [0, 0, 0] } };
  c.placeWith(r);
  assert.deepEqual([c.edits.prefabs.at(-1).prefab, c.edits.prefabs.at(-1).line, c.edits.prefabs.at(-1).version], ['usr_22222222222222222222222222222222', 'usr_11111111111111111111111111111111', 2],
    'a prefab of the library: the copy is linked to it, at its newest version');
  c.edits.prefabs.pop(); c.warned.pop();
  Object.assign(c, { placing: { box: true, hole: true, size: [1, 1, 1] }, holeBox: () => ({ name: 'UCEditBox9', lo: [0, 0, 0], hi: [64, 64, 112], tex: 'Tex', hole: true }),
    holeFloorAuto: () => false });                   // (its floor: the floor round it, none here)
  c.placeWith(r);
  assert.deepEqual(c.warned.at(-1), [['UCEditBox9'], 'Placed']);
  assert.match(c.logged.at(-1)[0], /resize it with J or in the panel/);
  assert.equal(c.warned.length, 4);
});

test('the Hierarchy\'s + (a cube, a wedge...): said, and the tools\' keys as Settings binds them', () => {
  const c = page({ camera: new THREE.PerspectiveCamera(), world: new THREE.Group(), visibleHits: (hits) => hits, blockLabel: () => 'Cube' });
  load(c, 'createSolid');
  c.createSolid('box');
  assert.deepEqual(c.warned, [[['UCEditBox0'], 'Added']]);
  assert.match(c.said.at(-1)[0], /^Cube added: W moves it, E turns it, J resizes it;/);
});

test('the 2D Shape Editor\'s blocks, a drawing, a hole\'s light', () => {
  const shape = page({ newNest() {}, selectNest() {} });
  load(shape, 'addShapeBlocks');
  shape.addShapeBlocks([PIECE], { label: 'Shape' });
  assert.deepEqual(shape.warned, [[['UCEditBox0'], 'Added']]);
  const wall = { name: 'UCDrawn0', kind: 'wall', pts: [[0, 0], [128, 0]] };
  const draw = page({ drawTools: { finish: () => wall }, DRAW_LABELS });
  load(draw, 'finishDraw');
  draw.finishDraw();
  assert.deepEqual(draw.warned, [[['UCDrawn0'], 'Drawn']]);
  const light = page({ lightProps: () => ({ LightBrightness: 128 }) });
  load(light, 'addHoleLight');
  light.addHoleLight({ lo: [0, 0, 0], hi: [256, 256, 128] });
  assert.deepEqual(light.warned, [[['UCEdit0'], 'Added']]);
  assert.deepEqual([...light.edits.added[0].loc], [128, 128, 104]);
  assert.match(source, /\$\('#blight'\)\.onclick = \(\) => addHoleLight\(d\.box\)/, 'its button in the hole\'s panel');
});

test('Fill AI paths, Clip / Intersect, a point of a patrol route', async () => {
  const fill = page({ mapLoading: false, navNodes: () => [], pathData: null, navKey: () => 'lab', navBlockers: () => [], palette: [], navLayers() {},
    navView: { fill: async () => ({ added: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }], bridges: 0, apart: 0, full: false }), show: async () => {} },
    $: () => ({ classList: { add() {} } }) });
  vm.runInContext('async ' + body('fillPaths'), fill);
  await fill.fillPaths();
  assert.deepEqual(fill.warned, [[['UCEdit0', 'UCEdit1'], 'Added']]);
  const old = { name: 'Old', tex: 'Tex', solid: true }, clip = page({ parentNest: () => null, nests: () => [], dropEmptyNests() {}, setMulti() {} });
  clip.edits.boxes.push(old);
  load(clip, 'replaceBlocks');
  clip.replaceBlocks([{ userData: { box: old, kind: 'box' } }], [PIECE, PIECE.map(([x, y, z]) => [x + 64, y, z])], 'Clip');
  assert.deepEqual(clip.warned, [[['UCEditBox0', 'UCEditBox1'], 'Made']]);
  const guard = { name: 'Guard', cls: 'MJ12Troop', kind: 'pawn', props: {} };
  const route = page({ routeOf: () => ({ points: [] }), nextTag: (prefix) => prefix + '1', putProp() {}, faceToward() {}, renderProps() {} });
  route.makeProxy(guard);
  load(route, 'addRoutePoint');
  route.addRoutePoint(guard, [0, 0, 0]);
  assert.deepEqual(route.warned, [[['UCEdit0'], 'Added']]);
});

test('R while placing turns it: the status names the Scale tool\'s key as Settings binds it', () => {
  const c = page({ placing: { cls: 'Barrel1' }, lastPlacingMove: null, movePlacing() {}, gameView: null, projectHub: null, textureTransfer: null,
    propertySlider: null, inspectorDrag: null, cancelNumberScrub: null, cam: { look: false, keys: {} }, document: { querySelector: () => null },
    surfaceTools: { mode: false },                       // (Face selection off: its Alt keys are not these)
    window: { addEventListener: (type, fn) => { if (type === 'keydown') c.keydown = fn; } } });
  vm.runInContext(body('turnPlacing') + '\n' + body('buildKeyGate') + '\n' + keysSource, c);     // (buildKeyGate: the keys during a Rebuild)
  c.keydown({ key: 'r', code: 'KeyR', ctrlKey: false, shiftKey: false, altKey: false, target: { tagName: 'CANVAS' }, preventDefault() {} });
  assert.equal(c.placing.turn, 16384);
  assert.equal(c.said.at(-1)[0], 'Turned 90° (J turns it again). Click where it goes.');
  // no status of placing names the tools' keys as they were at first
  assert.doesNotMatch(source, /\(R turns it again\)|W moves it, E turns it, R resizes it|[Rr]esize it with R\b/);
});
