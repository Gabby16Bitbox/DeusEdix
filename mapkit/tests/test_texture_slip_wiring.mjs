// The Texture Slip in the page (static/app.js, its functions run as they are with the page's few parts stood in for): Y
// starts it at the pointer (not with Ctrl, Alt or while typing), the shortcut helper knows it; Save (its button and
// Ctrl+S alike), Undo and Redo, a change, a map opened or closed end it first, and another map opened makes it forget
// its kept slips (not the same map opened again by a Rebuild); the map's built surface rows read from
// /api/scene, a queued row Save refuses said when the map opens, one the Rebuild would fail on said once and again after
// Save; a texture's size for the preview, drawn again once when structures are let go; a face mesh's frame where the
// last Rebuild built it (moved, turned, resized since); the face under the pointer (a block not built in front of it);
// why it cannot start now; what the page gives it (the queue) and the Surface panel (its Slip: Edit > Slip the texture's).
// The Undo history and the slip: each step keeps what the slips know (their exact mappings and each face's mapping
// before the first of them), a step back or forward and Revert all changes give it back (not while a Rebuild runs), and
// every place app.js puts edits in place wholesale says what the slip does.
import test, { THREE } from './three.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { HISTORY_LIMIT, createHistory, recordStep, dropStep, travelStep, stepsTo, currentName } from '../editor/static/history-names.js';
import { createRotations } from '../editor/static/rotation.js';
import { sameFrame } from '../editor/static/texture-slip-ui.js';
import { queueProblem } from '../editor/static/texture-slip.js';
import { slotOfDigit } from '../editor/static/recent-textures.js';
import { waitsForBuild, browserKey, PRESSABLE } from '../editor/static/build-progress.js';

const app = readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
const body = (name) => { const i = app.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return app.slice(i, app.indexOf('\n}', i) + 2); };
const between = (from, to) => { const i = app.indexOf(from); assert.ok(i >= 0, from); return app.slice(i, app.indexOf(to, i)); };
// a function app.js writes on one line ("function setDirty() { ... }"), as it is; where a function starting at at ends
const oneLine = (start) => between(start, '\n');
const ends = (at) => { const line = app.slice(at, app.indexOf('\n', at)).trim(); return line.endsWith('}') ? at + line.length : app.indexOf('\n}', at) + 2; };
const T = (a) => new THREE.Vector3(a[0], a[2], a[1]);

test('Y starts it at the pointer, not with Ctrl, Alt or while typing; the shortcut helper knows it', () => {
  const done = [], hoverAt = { clientX: 30, clientY: 40 };
  const c = vm.createContext({ script: 'fixture', mapName: 'fixture', gameView: null, projectHub: null, textureTransfer: null, propertySlider: null,
    inspectorDrag: null, cancelNumberScrub: null, buildJob: null, placing: null, cam: { look: false, keys: {} }, document: { querySelector: () => null }, slotOfDigit,
    waitsForBuild, browserKey, PRESSABLE, status: (text) => done.push('status ' + text), hoverAt,
    textureSlip: { start: (at) => done.push(['slip', at]), active: false }, redoStep: () => done.push('redo'),
    surfaceTools: { mode: true, applyRecent() {}, grow() {} },
    window: { addEventListener: (type, fn) => { if (type === 'keydown') c.keydown = fn; },
      __menubar: { comboOf: (e) => (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + e.code.replace(/^Key/, '') } } });
  vm.runInContext([body('rebuildWaits'), body('waitsForRebuild'), body('buildKeyGate'), between('const MOVE = {', "$('#lightmode').onchange")].join('\n'), c);
  const press = (mods = {}, target = { tagName: 'CANVAS' }) => {
    done.length = 0;
    c.keydown({ key: 'y', code: 'KeyY', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods, target, preventDefault() {} });
    return done.map((x) => (Array.isArray(x) ? [x[0], x[1] === hoverAt] : x));
  };
  assert.deepEqual(press(), [['slip', true]]);
  assert.deepEqual(press({ shiftKey: true }), [['slip', true]]);
  assert.deepEqual(press({ ctrlKey: true }), ['redo']);                 // Ctrl+Y stays Redo
  assert.deepEqual(press({ altKey: true }), []);
  assert.deepEqual(press({}, { tagName: 'INPUT' }), []);
  assert.deepEqual(press({}, { tagName: 'DIV', isContentEditable: true }), []);
  c.buildJob = { map: 'fixture' };                                      // a Rebuild running: it waits at the gate
  assert.match(press()[0], /^status Rebuilding fixture/);
  // the shortcut helper's mode
  const s = vm.createContext({ script: 'x', gameView: null, projectHub: null, cam: { look: false }, pilot: null, aimPicking: false, placing: null,
    vertexEdit: null, measure: null, surfaceTools: { mode: true }, window: {}, selected: null, tc: { mode: 'translate' }, textureSlip: { active: true } });
  vm.runInContext(body('shortcutState'), s);
  assert.equal(s.shortcutState().slip, true);
  s.textureSlip = null;
  assert.equal(s.shortcutState().slip, false);
});

test('a change, Undo or Redo, Save, a map opened or closed: a Texture Slip ends first', async () => {
  const ended = [], textureSlip = { cancel: () => ended.push('slip ends') };
  // a change (pushUndo): before its step is kept
  const steps = vm.createContext({ textureSlip, logicSwapped: false, buildJob: null, edits: {}, recordStep: () => ended.push('step'), undoHistory: {}, historyChanged() {} });
  vm.runInContext(body('pushUndo'), steps);
  steps.pushUndo('Move');
  assert.deepEqual(ended, ['slip ends', 'step']);
  // Undo and Redo (also from a desktop menu, the assistant), even while a Rebuild makes them wait
  ended.length = 0;
  const history = vm.createContext({ textureSlip, waitsForRebuild: () => { ended.push('waits'); return true; } });
  vm.runInContext(body('historyStep'), history);
  assert.equal(history.historyStep('undo'), false);
  assert.deepEqual(ended, ['slip ends', 'waits']);
  // Save (its button and File > Save): ended, saved; a row the Rebuild would fail on said again
  ended.length = 0;
  const said = [], page = vm.createContext({ textureSlip, waitsForRebuild: () => false, temporaryTutorial: () => false, log() {},
    save: async () => { ended.push('save'); return true; }, status: (t, k) => said.push([t, k]), surfacePreview: { refused: [] },
    $: () => ({ set onclick(fn) { page.onSave = fn; } }) });
  vm.runInContext([body('saveFromUser'), between("$('#save').onclick = ", '\n'), body('rebuildRefusal')].join('\n'), page);
  page.onSave();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([ended, said], [['slip ends', 'save'], []]);
  page.surfacePreview.refused = [{ stage: 'rebuild', refused: 'Cannot fit this face: degenerate UVs or no texture' }];
  page.onSave();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(said.at(-1), ['Saved. The Rebuild would fail: Cannot fit this face: degenerate UVs or no texture (1 face). Undo or fix that change.', 'warn']);
  // a map opened (the same again after a Rebuild): ended before the server is asked; the map closed (clearMap)
  ended.length = 0;
  const open = vm.createContext({ textureSlip, mapLoading: false, temporaryTutorial: () => false, tutorialSession: { revision: 0 }, busy() {},
    api: async () => { ended.push('asked'); throw new Error('the rest is not this test\'s'); }, log() {}, status() {}, startScreen: null });
  vm.runInContext('async ' + body('loadScene'), open);
  assert.equal(await open.loadScene('B'), false);
  assert.deepEqual(ended, ['slip ends', 'asked']);
  assert.match(body('clearMap'), /mapLoading = true;\s+try \{\s+textureSlip\?\.cancel\(\);/);
  // the Rebuild, Close map and the menus: test_rebuild_page.mjs and test_menubar_contract.mjs
});

test('Ctrl+S saves as the Save button does: the slip ends, not in the tutorial, a row the Rebuild would fail on said again', async () => {
  const done = [], said = [];
  const c = vm.createContext({ script: 'fixture', mapName: 'fixture', gameView: null, projectHub: null, textureTransfer: null, propertySlider: null,
    inspectorDrag: null, cancelNumberScrub: null, buildJob: null, placing: null, cam: { look: false, keys: {} }, document: { querySelector: () => null }, slotOfDigit,
    waitsForBuild, browserKey, PRESSABLE, hoverAt: null, surfaceTools: { mode: false }, log() {}, temporaryTutorial: () => false,
    textureSlip: { cancel: () => done.push('slip ends') }, save: async () => { done.push('save'); return true; }, status: (t, k) => said.push([t, k]),
    surfacePreview: { refused: [{ stage: 'rebuild', refused: "Pan exceeds the engine's signed 16-bit range" }] },
    window: { addEventListener: (type, fn) => { if (type === 'keydown') c.keydown = fn; },
      __menubar: { comboOf: (e) => (e.ctrlKey ? 'Ctrl+' : '') + e.code.replace(/^Key/, '') } } });
  vm.runInContext([body('rebuildWaits'), body('waitsForRebuild'), body('buildKeyGate'), body('rebuildRefusal'), body('saveFromUser'),
    between('const MOVE = {', "$('#lightmode').onchange")].join('\n'), c);
  const ctrlS = async () => {
    done.length = 0; said.length = 0;
    c.keydown({ key: 's', code: 'KeyS', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, target: { tagName: 'CANVAS' }, preventDefault() {} });
    await new Promise((r) => setTimeout(r, 0));
  };
  await ctrlS();
  assert.deepEqual([done, said], [['slip ends', 'save'],
    [["Saved. The Rebuild would fail: Pan exceeds the engine's signed 16-bit range (1 face). Undo or fix that change.", 'warn']]]);
  c.temporaryTutorial = () => true;                                     // the temporary tutorial: not saved, as by the button
  await ctrlS();
  assert.deepEqual([done, said], [['slip ends'], [['The tutorial cannot be saved. Rebuild/Play use a temporary copy; Close map discards it.', undefined]]]);
});

test('opening a map: its built surface rows from /api/scene, a queued row Save refuses said at once', async () => {
  const logged = [];
  const scene = (extra) => ({ script: 'dx:01_Lab', map: '01_Lab', actors: [], palette: [], kind: 'dx-game', edits: { surfaces: [{ op: 'pan', args: [0.5, 0], targets: [{ brush: 'Brush1', poly: 0 }] }] }, ...extra });
  const c = vm.createContext({ textureSlip: null, mapLoading: false, temporaryTutorial: () => false, tutorialSession: { revision: 0 }, busy() {},
    TUTORIAL_SCRIPT: 'deusedix_tutorial', isTrainingProject: () => false, projectContext: {}, textureTransfer: null, surfaceTexturePreview: null,
    texturePreviewInfo: new Map(), texturePreviewPending: new Set(), window: {}, closeAnim() {}, stopPreview() {}, resetInput() {}, cancelPlacing() {},
    soundBrowser: null, endAimPick() {}, script: 'dx:01_Lab', sceneView: { reset() {} }, endMapSearch() {}, PACKAGE: '', MODELS_PKG: '',
    EMPTY: () => ({}), withPublishedLayout: (e) => e, queueProblem, log: (text, kind) => logged.push([text, kind]), status() {}, startScreen: null,
    mapGeneration: 0, builtScale: null, boxSig: () => '', drawnSig: () => '', undoHistory: {}, clearHistory: () => { throw new Error('stop here'); } });
  vm.runInContext('async ' + body('loadScene'), c);
  c.api = async () => scene({ builtSurfaces: [{ op: 'pan', args: [4, 0], targets: [{ brush: 'Brush1', poly: 0 }] }] });
  await c.loadScene('dx:01_Lab');
  assert.deepEqual(c.builtSurfaces[0].args, [4, 0]);
  assert.deepEqual(logged, [["This map's queued surface changes cannot be saved: Pan uses whole texels, between -32767 and 32767.", 'bad'],
    ['Error: stop here', 'bad']]);
  c.api = async () => scene({ builtSurfaces: null });                  // not known: the rows it opened with may be built
  await c.loadScene('dx:01_Lab');
  assert.deepEqual(JSON.parse(JSON.stringify(c.builtSurfaces)), { maybe: scene({}).edits.surfaces });
  assert.notEqual(c.builtSurfaces.maybe, c.edits.surfaces);           // a copy: a row queued since is not one of them
  c.api = async () => scene({});                                       // an older server: the same
  await c.loadScene('dx:01_Lab');
  assert.deepEqual(JSON.parse(JSON.stringify(c.builtSurfaces)), { maybe: scene({}).edits.surfaces });
});

test('another map opened: the Texture Slip forgets what its kept slips knew of the faces; the same map again (a Rebuild) keeps it', async () => {
  const done = [];
  const c = vm.createContext({ textureSlip: { cancel: () => done.push('slip ends'), forget: () => done.push('slips forgotten') }, mapLoading: false,
    temporaryTutorial: () => false, tutorialSession: { revision: 0 }, busy() {}, TUTORIAL_SCRIPT: 'deusedix_tutorial', isTrainingProject: () => false,
    projectContext: {}, textureTransfer: null, surfaceTexturePreview: null, texturePreviewInfo: new Map(), texturePreviewPending: new Set(), window: {},
    closeAnim() {}, stopPreview() {}, resetInput() {}, cancelPlacing() {}, soundBrowser: null, endAimPick() {}, script: 'dx:01_Lab',
    sceneView: { reset() {} }, endMapSearch() {}, PACKAGE: '', MODELS_PKG: '', EMPTY: () => ({}), withPublishedLayout: (e) => e, queueProblem,
    log() {}, status() {}, startScreen: null, mapGeneration: 0, builtScale: null, boxSig: () => '', drawnSig: () => '', undoHistory: {},
    clearHistory: () => { throw new Error('stop here'); } });
  vm.runInContext('async ' + body('loadScene'), c);
  const open = async (map) => {
    done.length = 0;
    c.api = async () => ({ script: map, map, actors: [], palette: [], kind: 'dx-game', edits: { surfaces: [] }, builtSurfaces: [] });
    await c.loadScene(map);
    return [...done];
  };
  assert.deepEqual(await open('dx:01_Lab'), ['slip ends']);                         // the same map again, as a Rebuild opens it
  assert.deepEqual(await open('dx:02_Other'), ['slip ends', 'slips forgotten']);    // another map
  assert.deepEqual(await open('dx:02_Other'), ['slip ends']);
});

test('the preview drawn again with the built rows; a row the Rebuild would fail on said once', () => {
  const said = [], applied = [];
  const c = vm.createContext({ geoFaces: ['faces'], edits: { surfaces: [] }, builtSurfaces: ['built'], refusalSaid: '', textureInfoFor: () => null,
    surfaceTools: { geometry: ['mesh'] }, status: (t, k) => said.push([t, k]), script: null, surfacePreview: null,
    surfaceTexturePreview: { apply: (...args) => { applied.push(args); return c.report; } }, report: { later: [], refused: [] } });
  vm.runInContext(body('refreshSurfaceTexturePreview') + '\n' + body('rebuildRefusal'), c);
  c.refreshSurfaceTexturePreview();
  assert.deepEqual(JSON.parse(JSON.stringify(applied[0])), [['mesh'], ['faces'], { surfaces: [] }, ['built']]);
  assert.deepEqual(said, []);
  c.report = { later: [], refused: [{ id: 2, stage: 'rebuild', refused: "Pan exceeds the engine's signed 16-bit range" }] };
  c.refreshSurfaceTexturePreview();
  c.refreshSurfaceTexturePreview();
  assert.deepEqual(said, [["The Rebuild would fail: Pan exceeds the engine's signed 16-bit range (1 face). Undo or fix that change.", 'warn']]);
  c.report = { later: [], refused: [] };
  c.refreshSurfaceTexturePreview();
  assert.equal(c.refusalSaid, '');
});

test('structures let go (moved, turned, resized): the queued alignment drawn again after texture-scale.js, once for all', () => {
  const calls = [], frames = [], pose = { offset: [64, 0, 0], yaw: 0, scale: [1.5, 1, 1] };
  const room = { name: 'Room', obj: {}, placement: {}, actors: [] }, desk = { name: 'Desk', obj: {}, placement: {}, actors: [] };
  const c = vm.createContext({ edits: { groups: {}, moved: {}, surfaces: [{ op: 'pan', args: [4, 0], targets: [{ brush: 'Brush1', poly: 0 }] }] },
    livePose: () => ({ ...pose }), textureScale: { incomplete: () => false, update: () => calls.push('texture-scale') }, scaleOf: (p) => p.scale || [1, 1, 1],
    poseToPose: () => (x) => x, movedPose: () => true, setPose: (entry, p) => Object.assign(entry, p), keptPlaces: () => [], moveStart: null,
    surfaceFrame: 0, requestAnimationFrame: (fn) => frames.push(fn), refreshSurfaceTexturePreview: () => calls.push('preview'), wake() {},
    setDirty: () => calls.push('dirty'), showDetails() {}, log() {} });
  vm.runInContext(body('commitStructure'), c);
  const frame = () => { for (const fn of frames.splice(0)) fn(); };
  const letGo = (st, quiet) => c.commitStructure({ st, pose: { offset: [0, 0, 0], yaw: 0 } }, quiet);
  letGo(room);
  frame();
  assert.deepEqual(calls, ['texture-scale', 'dirty', 'preview']);
  // a group's move lets go of each one quietly, one after the other: one preview, at the next frame
  calls.length = 0;
  letGo(room, true); letGo(desk, true);
  assert.deepEqual(calls, ['texture-scale', 'texture-scale']);
  frame();
  assert.deepEqual(calls, ['texture-scale', 'texture-scale', 'preview']);
  calls.length = 0;                                                               // the next one let go: drawn again
  letGo(desk, true); frame();
  assert.deepEqual(calls, ['texture-scale', 'preview']);
  calls.length = 0;
  c.edits.surfaces = [];                                                          // nothing queued: nothing to draw
  letGo(room); frame();
  assert.deepEqual(calls, ['texture-scale', 'dirty']);
});

test('a texture\'s size for the preview: the map\'s, by its short name too; one it does not have, not known', () => {
  const c = vm.createContext({ mapTex: { 'Pkg.Group.Wall': { w: 128, h: 64 }, 'Pkg.Odd': { w: 0, h: 0 } }, texFull: { Wall: 'Pkg.Group.Wall' } });
  vm.runInContext(body('textureTile'), c);
  const tile = (ref) => JSON.stringify(c.textureTile(ref));
  assert.deepEqual([tile('Pkg.Group.Wall'), tile('Wall')], ['[128,64]', '[128,64]']);
  assert.deepEqual([tile('Other.Wall'), tile('Pkg.Odd'), tile('MyLevel.Imported')], ['null', 'null', 'null']);
});

test('a face mesh\'s frame: back where the last Rebuild built it, moved or turned since; resized since', () => {
  const rotations = createRotations(THREE), world = new THREE.Group(), obj = new THREE.Group();
  const st = { name: 'Room', obj, center: [512, 256, 64], pivot: [500, 250, 60], placement: { offset: [12, 6, 4], yaw: 16384 } };
  obj.userData = { kind: 'structure', name: 'Room' };
  obj.position.copy(T(st.center));
  obj.quaternion.copy(rotations.pose(st.placement));
  world.add(obj);
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()), loose = new THREE.Mesh();
  obj.add(mesh); world.add(loose);
  let pose = { offset: [12, 6, 4], yaw: 16384, scale: [1, 1, 1] };
  const c = vm.createContext({ THREE, T, rotations, sameFrame, structures: { Room: st }, world, scene: null,
    poseOf: () => pose, relScale: (s, p) => p.scale });
  vm.runInContext(body('structureOf') + '\n' + body('builtFrame'), c);
  const at = (frame, p) => T(p).applyMatrix4(frame.toBuilt).toArray().map((x) => Math.round(x * 1000) / 1000);
  // as built: the view is where it was built
  let f = c.builtFrame(mesh);
  assert.deepEqual([f.moved, f.resized], [false, false]);
  assert.deepEqual(at(f, [600, 300, 80]), T([600, 300, 80]).toArray());
  // moved 100 along x and turned a quarter more since: a point of it in the view goes back where it was built
  const built = T([600, 300, 80]), local = obj.worldToLocal(built.clone());
  obj.position.add(T([100, 0, 0]));
  obj.quaternion.copy(rotations.pose({ yaw: 32768 }));
  obj.updateMatrixWorld(true);
  const seen = obj.localToWorld(local.clone());
  f = c.builtFrame(mesh);
  assert.equal(f.moved, true);
  assert.deepEqual(at(f, [seen.x, seen.z, seen.y]), built.toArray().map((x) => Math.round(x * 1000) / 1000));
  // resized since; the map's own faces (no structure) as they are
  pose = { ...pose, scale: [1.5, 1, 1] };
  assert.equal(c.builtFrame(mesh).resized, true);
  assert.deepEqual([c.builtFrame(loose).moved, c.builtFrame(loose).resized], [false, false]);
});

test('the face under the pointer: a built one, or why not (a block not built in front of it, nothing)', () => {
  const world = new THREE.Group(), proxies = new THREE.Group(), meshes = [];
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(256, 256).toNonIndexed(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  wall.position.set(0, 0, -100); wall.userData.faces = [7, 7]; world.add(wall); meshes.push(wall);
  world.updateMatrixWorld(true);
  const c = vm.createContext({ THREE, world, proxies, visibleHits: (h) => h, surfaceTools: { faceAt: (hit) => (hit && meshes.includes(hit.object) ? {} : null) },
    mouseRay: (e) => new THREE.Raycaster(new THREE.Vector3(e.x, e.y, 0), new THREE.Vector3(0, 0, -1)) });
  vm.runInContext(body('slipTarget'), c);
  const hit = c.slipTarget({ x: 10, y: 20 });
  assert.equal(hit.id, 7);
  assert.equal(hit.mesh, wall);
  assert.deepEqual(hit.point.toArray(), [10, 20, -100]);
  assert.deepEqual(hit.normal.toArray().map(Math.abs), [0, 0, 1]);
  assert.match(c.slipTarget({ x: 500, y: 0 }).why, /^No built wall, floor or ceiling under the pointer/);
  const block = new THREE.Mesh(new THREE.BoxGeometry(64, 64, 64), new THREE.MeshBasicMaterial());
  block.position.set(0, 0, -50); block.userData.box = { name: 'UCEditBox0' }; proxies.add(block); proxies.updateMatrixWorld(true);
  assert.equal(c.slipTarget({ x: 10, y: 20 }).why, 'A block or a drawing not built yet is in front: Rebuild new blocks first.');
  assert.equal(c.slipTarget({ x: 100, y: 100 }).id, 7);                 // beside the block: the wall
});

test('why it cannot start now: no map, a Rebuild, the game, a cutscene panel, no faces selected (the Surface tools\' words, in Face selection or not)', () => {
  const asked = [];
  // noFaces: the Surface tools' words for no face selected, in Face selection and outside it (test_surface_faces.mjs
  // tests them); here a marker of what it was asked for, which slipWaits gives back as it is
  const c = vm.createContext({ script: 'x', mapLoading: false, buildJob: null, gameView: null, window: { __cutscene: { isOpen: () => false } },
    surfaceTools: { mode: false, hasSelection: true, noFaces: (what) => { asked.push(what); return `noFaces(${what})`; } } });
  vm.runInContext(body('slipWaits') + '\n' + body('rebuildWaits'), c);
  assert.equal(c.slipWaits(), '');
  c.surfaceTools.hasSelection = false;                                // in object selection, none selected
  assert.equal(c.slipWaits(), 'noFaces(faces)');
  c.surfaceTools.mode = true;                                         // in Face selection, none selected yet: the same words' maker
  assert.equal(c.slipWaits(), 'noFaces(faces)');
  assert.deepEqual(asked, ['faces', 'faces']);
  c.surfaceTools.hasSelection = true;
  assert.equal(c.slipWaits(), '');
  c.window.__cutscene.isOpen = () => true;
  assert.match(c.slipWaits(), /^Close the cutscene panel first/);
  c.gameView = { active: true };
  assert.match(c.slipWaits(), /^Stop the game first/);
  c.buildJob = { map: '01_Lab' };
  assert.match(c.slipWaits(), /^Rebuilding 01_Lab: the Texture Slip waits/);
  c.mapLoading = true;
  assert.equal(c.slipWaits(), 'Open a map first.');
});

test('what the page gives the Texture Slip (the queue as it is now) and the Surface panel (its Slip: Edit > Slip the texture\'s)', () => {
  const given = {}, pressed = [];
  const c = vm.createContext({ createTextureSlip: (o) => { given.slip = o; return {}; }, createSurfaceTools: (o) => { given.panel = o; return {}; },
    THREE: {}, window: { __menubar: { press: (id) => pressed.push(id) } }, canvas: {}, camera: {}, floatingLabel: () => ({}), status() {}, wake() {},
    slipWaits() {}, builtFrame() {}, slipTarget() {}, surfaceTexturePreview: {}, ROW_LIMIT: 4096, edits: {}, textureSlip: null,
    pushUndo() {}, setDirty() {}, log() {}, escapeHtml: String, canEditFace() {}, recentTextures() {}, keepRecentTexture() {} });
  vm.runInContext([between('const surfaceTools = createSurfaceTools({', '\nfunction textureInfoFor('),
    between('textureSlip = createTextureSlip({', '\ntextureTransfer = ')].join('\n'), c);
  assert.deepEqual([...given.slip.queued()], []);                       // none queued
  c.edits = { surfaces: [{ op: 'pan', args: [4, 0], targets: [{ brush: 'Brush1', poly: 0 }] }] };
  assert.equal(given.slip.queued(), c.edits.surfaces);                  // the rows as they are now, not a copy
  assert.equal(given.slip.room(), 4095);
  // the panel's Slip: the menus' press of faceslip, what Edit > Slip the texture runs (test_menubar_contract.mjs)
  given.panel.slip();
  assert.deepEqual(pressed, ['faceslip']);
});

test('Undo, Redo and a History panel jump give the Texture Slip what the slips know of the edits they put in place; a change\'s step holds what they knew before it', () => {
  // app.js's history functions run as they are, with history-names.js: three changes (a slip kept: what the slips know
  // then, A; a Pan: it stays; a slip kept: B), two Undos, jumps of the History panel, a Redo, a click that moved
  // nothing, two Redos. The step of each change holds what the slips knew before it; each step back or forward gives
  // the slip what the step taken held, and its way back holds what it left; a click that moved nothing keeps Redo's
  // steps.
  // The cap is the history's own (pushUndo gives none: an older history-names.js, whose fourth parameter is the cap,
  // keeps its own too)
  const said = [];
  let held = null;
  const textureSlip = { cancel() {}, get held() { return held; }, hold: (x) => { held = x; said.push(x?.at ?? 'none'); } };
  const c = vm.createContext({ undoHistory: createHistory(), recordStep, dropStep, travelStep, stepsTo, currentName, textureSlip, logicSwapped: false, buildJob: null,
    edits: { at: 0 }, status() {}, waitsForRebuild: () => false, rebuildProxies() {}, setDirty() {}, showDetails() {}, logicBox: { style: {} },
    renderLogic() {}, historyPanel: null, script: 'fixture', gameView: null, tc: { dragging: false }, inspectorDrag: null, propertySlider: null,
    mapPose: { active: false } });
  vm.runInContext([body('pushUndo'), body('dropUndo'), body('afterHistory'), body('travel'), body('historyStep'), body('jumpHistory'),
    oneLine('function historyChanged()')].join('\n'), c);
  c.pushUndo('Slip the texture'); c.edits = { at: 1 }; held = { at: 'A' };
  c.pushUndo('Pan the texture'); c.edits = { at: 2 };
  c.pushUndo('Slip the texture'); c.edits = { at: 3 }; held = { at: 'B' };
  assert.deepEqual(c.undoHistory.undo.map((s) => s.page?.at ?? 'none'), ['none', 'A', 'A']);
  c.historyStep('undo'); c.historyStep('undo');
  assert.deepEqual([c.edits.at, said], [1, ['A', 'A']]);
  assert.deepEqual(c.undoHistory.redo.map((s) => s.page.at), ['B', 'A'], 'their way back holds the ones left');
  c.jumpHistory(2);
  assert.deepEqual([c.edits.at, said.at(-1)], [3, 'B']);
  c.jumpHistory(-3);
  assert.deepEqual([c.edits.at, said.at(-1)], [0, 'none']);
  c.historyStep('redo');
  assert.deepEqual([c.edits.at, held.at], [1, 'A']);
  c.pushUndo('Move Light4'); c.dropUndo();                          // a click that moved nothing: Redo kept
  c.historyStep('redo'); c.historyStep('redo');
  assert.deepEqual([c.edits.at, held.at], [3, 'B']);
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) c.pushUndo('Move Light4');
  assert.equal(c.undoHistory.undo.length, HISTORY_LIMIT, 'the cap');
});

test('Revert all changes: what the Texture Slip\'s slips know goes with the edits it takes away, its step holding it (Ctrl+Z gives it back), but not while a Rebuild runs, which takes the Revert back', () => {
  // app.js's own handler, pushUndo, setDirty, keepBuiltEdits and its history's travel, historyStep and afterHistory,
  // run as they are with history-names.js. The Inspector's Changes footer is not locked while a Rebuild runs: there
  // Revert all makes no step (pushUndo) and setDirty puts the edits back as the build has them (keepBuiltEdits), so what
  // the slips know (their exact mappings and each face's mapping before the first of them) stays, theirs. (Dropped
  // there, every face slipped started its next slip from its rounded pan after the Rebuild.) With none running, the
  // Revert's step holds what the slips knew of the edits it takes away, kept before it goes, and Ctrl+Z gives it back
  // with the edits. (Dropped before its step, Ctrl+Z gave the edits back without it: every face slipped started its
  // next slip from its rounded pan; round 13's review, #2.) The slip's held stood in for by a value of its form, { kept,
  // exacts }
  const known = { kept: { known: new Map() }, exacts: new Map([['Brush2', new Map()]]) };
  const built = { surfaces: [{ op: 'pan', args: [2, 0], targets: [{ brush: 'Brush2', poly: 3 }] }] };
  let held = known;
  const textureSlip = { cancel() {}, get held() { return held; }, hold: (x) => { held = x ?? null; } };
  const c = vm.createContext({ textureSlip, logicSwapped: false, buildJob: { edits: JSON.stringify(built), map: 'Lab' }, edits: JSON.parse(JSON.stringify(built)),
    undoHistory: createHistory(), recordStep, travelStep, historyChanged() {}, rebuildProxies() {}, showDetails() {}, log() {}, waitsForRebuild: () => false,
    forgetGoneDefault() {}, EMPTY: () => ({ surfaces: [] }), withPublishedLayout: (e) => e, publishedLayout: null, confirm: () => true, editRevision: 0,
    dirty: false, showChanges() {}, buildStructList() {}, buildHierarchy() {}, logicChanged() {}, status() {}, mapName: 'Lab', logicBox: { style: {} },
    renderLogic() {} });
  vm.runInContext([body('pushUndo'), body('keepBuiltEdits'), oneLine('function setDirty()'), body('afterHistory'), body('travel'),
    body('historyStep'), `const r = {};\n${between('if (r) r.onclick = ', '\n')}\nthis.revert = r.onclick;`].join('\n'), c);
  c.revert();
  assert.deepEqual([JSON.parse(JSON.stringify(c.edits)), c.undoHistory.undo.length], [built, 0], 'while a Rebuild runs');
  assert.equal(held, known, 'while a Rebuild runs: what the slips know stays');
  c.buildJob = null;
  c.revert();
  assert.deepEqual([JSON.parse(JSON.stringify(c.edits)), held, c.undoHistory.undo.length], [{ surfaces: [] }, null, 1], 'no Rebuild running');
  assert.equal(c.undoHistory.undo.at(-1).page, known, 'the Revert\'s step holds what the slips knew of the edits it takes away');
  assert.equal(c.historyStep('undo'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(c.edits)), built, 'Ctrl+Z: the edits back');
  assert.equal(held, known, 'Ctrl+Z: what the slips knew back');
});

// Every place app.js puts edits in place wholesale, by the function it is in (null: none), and what becomes there of
// what the Texture Slip's slips know (their exact mappings and each face's mapping before the first of them: held, which
// only hold takes back). The next test finds them as written: an assignment to edits or to its queue of surface rows
// (edits.surfaces), an Object.assign into either, a splice of the queue or its length set. It fails on one not written
// here, until it is, with what the slip does there (hold for the edits of another state, or why none), and on one
// written here whose line no longer holds its code (changed or split: write its code as it is now). Edits put in
// place another way (their keys deleted, rows set one by one) are not found: such code must call hold too
const WHOLESALE = [
  { in: null, code: 'let edits = EMPTY();', slip: 'the page opens: no slip kept yet, none' },
  { in: 'clearMap', code: 'edits = EMPTY(); clearHistory(undoHistory);',
    slip: 'no map open, no slip can start; the next map opened forgets them (script is null then: loadScene calls forget, the same map too)' },
  { in: 'loadScene', code: 'edits = Object.assign(EMPTY(), withPublishedLayout(j.edits, publishedLayout));',
    slip: 'another map: forget; the same one again (a Rebuild): kept, each face checked by value against its numbers read back from the dump' },
  { in: 'travel', code: 'edits = JSON.parse(step.state); textureSlip?.hold?.(step.page);', slip: 'hold: those the step held' },
  { in: 'showChanges', code: 'edits = Object.assign(EMPTY(), withPublishedLayout({}, publishedLayout)); if (!buildJob) textureSlip?.hold?.(null);',
    slip: 'Revert all changes: none, not while a Rebuild runs (setDirty puts the edits back: keepBuiltEdits)' },
  { in: 'logicWithEdits', code: 'edits = e; logicSwapped = true;',
    slip: 'nothing: the AI assistant\'s proposal is read with its own edits for a moment, in which no change is made (pushUndo refuses one)' },
  { in: 'logicWithEdits', code: 'finally { edits = real; logicSwapped = false; }', slip: 'nothing: the edits as they were, the same object, put back' },
  { in: 'keepBuiltEdits', code: 'edits = JSON.parse(buildJob.edits);',
    slip: 'nothing: a change made while a Rebuild runs made no step (pushUndo) and no slip starts then (slipWaits), so the edits it puts back go with what the slips know as it is' },
];

test('every assignment, Object.assign, splice or length set by which app.js puts edits or their queue in place wholesale says what becomes there of what the Texture Slip\'s slips know', () => {
  // each found: its line, and the top-level function it is in (the last starting before it, not ended there)
  const starts = [...app.matchAll(/^(?:async )?function (\w+)\(/gm)].map((m) => ({ name: m[1], at: m.index, end: ends(m.index) }));
  const wholesale = /(?<![\w$.])edits(?:\.surfaces)?\s*=(?!=)|Object\.assign\(\s*edits(?:\.surfaces)?\s*,|(?<![\w$.])edits\.surfaces\.(?:splice\(|length\s*=(?!=))/g;
  const found = [...app.matchAll(wholesale)].map((m) => ({
    in: starts.filter((f) => f.at < m.index && m.index < f.end).at(-1)?.name ?? null,
    line: app.slice(app.lastIndexOf('\n', m.index) + 1, app.indexOf('\n', m.index)).trim(),
    number: app.slice(0, m.index).split('\n').length }));
  for (const f of found) {
    assert.ok(WHOLESALE.some((w) => w.in === f.in && f.line.includes(w.code)),
      `app.js line ${f.number}${f.in ? ` (${f.in})` : ''} puts edits in place wholesale: write in WHOLESALE what becomes there of what the Texture Slip's slips know (hold, or why none): ${f.line.slice(0, 160)}`);
  }
  for (const w of WHOLESALE) assert.equal(found.filter((f) => f.in === w.in && f.line.includes(w.code)).length, 1, `${w.in}: ${w.code}`);
});
