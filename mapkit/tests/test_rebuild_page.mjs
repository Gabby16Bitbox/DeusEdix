// The page's side of the Rebuild in the background (app.js rebuildMap and its helpers, run as they are): the server's
// job started with the mode, asked about until it is over, the chip shown meanwhile; the look-only view (a change made
// while it runs is taken back, no undo step, another Rebuild refused); Cancel sent with the job's token, or before the
// server has the build; the Build report in Messages and the map loaded again only after a build that finished.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PAGE_STAGES, chipView, waitsForBuild, browserKey, PRESSABLE, isWarning, buildReport } from '../editor/static/build-progress.js';

const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('// Rebuild in the background (editor/build_job.py)'), source.indexOf("$('#build').onclick = () => rebuildMap();"));
const line = (start) => { const at = source.indexOf(start); return source.slice(at, source.indexOf('\n', at)); };
const body = (name) => { const at = source.indexOf(`function ${name}(`); return source.slice(at, source.indexOf('\n}', at) + 2); };

// a stand-in server: the job runs through `stages` (one a question), then ends 'done', unless Cancel came first
function server({ stages = ['load', 'bsp', 'lights'], gate = null } = {}) {
  // clock: the page's own (performance.now), which the Build report's total is taken from (build-progress.js)
  const s = { calls: [], asked: 0, cancelled: false, token: 'job-1', clock: 0 };
  const status = (state, extra = {}) => ({ state, token: s.token, map: '01_Lab', stage: 'prepare', label: 'Preparing', elapsed: s.asked, estimate: 40, ...extra });
  s.api = async (path, body) => {
    s.calls.push([path, body]);
    if (gate) await gate;
    if (path.startsWith('/api/build_start')) return status('running');
    if (path === '/api/build_cancel') {
      if (body.token !== s.token) throw new Error('This Rebuild has changed.');
      s.cancelled = true;
      return status('cancelling');
    }
    if (path === '/api/build_status') {
      s.asked++;
      if (s.cancelled) { s.clock = 3000; return status('cancelled', { ok: false, lines: [], report: { stages: [{ label: 'Lighting', seconds: 3 }], counts: {} } }); }
      if (s.asked <= stages.length) return status('running', { stage: stages[s.asked - 1], label: stages[s.asked - 1] });
      s.clock = 12000;
      return status('done', { ok: true, lines: ['built 01_Lab in 12.0s', '  IN SOLID: Light|Light3|0 0 0'],
        report: { stages: [{ label: 'CSG and BSP', seconds: 4 }, { label: 'Lighting', seconds: 8 }], counts: { lights: 3 } } });
    }
    throw new Error('unexpected ' + path);
  };
  return s;
}

function page(srv) {
  const calls = [], rows = [], chip = { shown: [], hidden: 0 }, classes = new Set();
  const c = vm.createContext({
    script: 'dx:01_Lab', mapName: '01_Lab', edits: { moved: {}, added: [] }, buildJob: null, logicSwapped: false, selected: null, gameView: null,
    camera: { position: { clone: () => ({}), copy() {} } }, cam: { yaw: 0, pitch: 0 },
    api: srv.api, PAGE_STAGES, chipView, waitsForBuild, browserKey, PRESSABLE, isWarning, buildReport, performance: { now: () => srv.clock }, setTimeout, setInterval, clearInterval,
    mapLoading: false, startScreen: { closeMap: () => { calls.push('closeMap'); return true; } }, window: { __menubar: { comboOf: (e) => e.combo } },
    createBuildChip: () => ({ el: {}, show: (v) => chip.shown.push(v), hide: () => chip.hidden++ }),
    $: () => ({ after() {} }),
    document: { documentElement: { classList: { toggle: (k, on) => (on ? classes.add(k) : classes.delete(k)) } } },
    status: (text, cls) => calls.push(['status', text, cls]), log: (lines, cls) => calls.push(['log', lines, cls]), logRows: (r) => rows.push(...r),
    save: async () => { calls.push('save'); return true; }, navBakeIfNeeded: async () => calls.push('navmesh'), walkLayersIfNeeded: async () => {},
    fillAutoAll: () => calls.push('fill blocks'),     // the Fill blocks and the holes' floors take what is around them
    loadScene: async () => calls.push('loadScene'), navCheckAfterBuild: async () => calls.push('navcheck'),
    cancelPlacing: () => calls.push('cancelPlacing'), applyObjectVisibility() {}, buildHierarchy() {}, showDetails() {}, select() {},
    rebuildProxies: () => calls.push('rebuildProxies'), recordStep: () => calls.push('step'), historyChanged() {}, undoHistory: {},
    forgetGoneDefault() {}, editRevision: 0, dirty: false, showChanges() {}, buildStructList() {},
    // the Texture Slip (ended first), what the preview says the Rebuild would fail on, the question asked then
    textureSlip: { cancel: () => calls.push('slip ends') }, surfacePreview: { later: [], refused: [] },
    confirm: (text) => { calls.push(['confirm', text]); return c.answer; }, answer: true,
  });
  vm.runInContext(block + '\n' + body('pushUndo') + '\n' + line('function setDirty()') + '\n' + line('function closeMap()'), c);
  return { c, calls, rows, chip, classes };
}
const statuses = (calls) => calls.filter((x) => x[0] === 'status').map((x) => x[1]);
const plain = (x) => JSON.parse(JSON.stringify(x));      // what the page's realm made, as plain values

test('a Rebuild: saved, its walkable area, the job started and followed to its end, then the map loaded again', async () => {
  const srv = server(), { c, calls, rows, chip, classes } = page(srv);
  const running = c.rebuildMap('full');
  assert.ok(c.buildJob, 'the look-only view starts at once');
  assert.ok(classes.has('map-building'));
  assert.equal(chip.shown[0].stage, 'Saving');
  await running;
  assert.equal(c.buildJob, null);
  assert.ok(!classes.has('map-building'));
  assert.deepEqual(plain(srv.calls[0]), ['/api/build_start?script=dx%3A01_Lab', { mode: 'full' }]);
  assert.equal(srv.calls.filter((x) => x[0] === '/api/build_status').length, 4);
  assert.deepEqual(calls.filter((x) => typeof x === 'string'), ['slip ends', 'fill blocks', 'cancelPlacing', 'save', 'navmesh', 'loadScene', 'navcheck']);
  assert.ok(chip.shown.some((v) => v.stage === 'lights' && /last time 0:40/.test(v.time)));
  assert.ok(chip.hidden >= 1);
  assert.match(rows[0].text, /^Build report · 01_Lab: Full rebuild in 0:12/);
  assert.deepEqual(plain(rows.at(-1)), { text: '  IN SOLID: Light|Light3|0 0 0', cls: 'warn', check: true });
  assert.deepEqual(plain(calls.find((x) => x[0] === 'log')), ['log', ['built 01_Lab in 12.0s'], '']);    // the warnings are in the report
  assert.equal(statuses(calls).at(-1), '01_Lab: rebuilt');
});

test('while it runs a change is taken back, keeps no step, and another Rebuild waits', async () => {
  let open;
  const srv = server({ gate: new Promise((r) => { open = r; }) }), { c, calls } = page(srv);
  const running = c.rebuildMap();
  await new Promise((r) => setTimeout(r, 20));
  const built = JSON.stringify(c.edits);
  c.pushUndo('Move Crate0');
  c.edits = { moved: { Crate0: { loc: [1, 2, 3] } }, added: [] };
  c.setDirty();
  assert.equal(JSON.stringify(c.edits), built);
  assert.equal(c.dirty, false);
  assert.ok(!calls.includes('step'));
  assert.ok(calls.includes('rebuildProxies'));
  assert.match(statuses(calls).at(-1), /^Rebuilding 01_Lab: editing waits until it ends \(or Cancel it in the status bar\)\.$/);
  const takenBack = () => calls.filter((x) => x[0] === 'log' && /was taken back/.test(x[1]));
  assert.equal(takenBack().length, 1, 'Messages say a change was taken back');
  assert.equal(takenBack()[0][2], 'warn');
  c.setDirty();                                       // nothing changed since: nothing more to say
  assert.equal(takenBack().length, 1);
  await c.rebuildMap();
  assert.match(statuses(calls).at(-1), /another Rebuild waits/);
  assert.equal(c.waitsForRebuild('Play waits'), true);
  open();
  await running;
  assert.equal(c.waitsForRebuild(), false);
  assert.equal(srv.calls.filter((x) => x[0].startsWith('/api/build_start')).length, 1);
});

test('Cancel names the job; the map is not loaded again and the status says it is as it was', async () => {
  const srv = server({ stages: ['load', 'bsp', 'lights', 'lights', 'lights', 'lights'] }), { c, calls, rows, chip } = page(srv);
  const running = c.rebuildMap('lighting');
  while (!srv.asked) await new Promise((r) => setTimeout(r, 20));
  await c.cancelBuild();
  assert.ok(chip.shown.some((v) => v.cancelling && v.stage === 'Cancelling…'));
  await running;
  assert.deepEqual(plain(srv.calls.find((x) => x[0] === '/api/build_cancel')), ['/api/build_cancel', { token: 'job-1' }]);
  assert.ok(!calls.includes('loadScene'));
  assert.equal(statuses(calls).at(-1), '01_Lab: Rebuild cancelled, the map is as it was before it.');
  assert.match(rows[0].text, /Rebuild lighting cancelled after 0:03/);
});

test('Close map waits for the build; the end of a build loads the map again only when it is still the one open', async () => {
  let open;
  const srv = server({ gate: new Promise((r) => { open = r; }) }), { c, calls } = page(srv);
  const running = c.rebuildMap();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(c.closeMap(), false);
  assert.ok(!calls.includes('closeMap'));
  assert.match(statuses(calls).at(-1), /^Rebuilding 01_Lab: closing the map waits/);
  c.script = null; c.mapName = null;                  // (were the map closed all the same)
  open();
  await running;
  assert.ok(!calls.includes('loadScene'), 'no map named null is asked for');
  assert.ok(!calls.includes('navcheck'));
  assert.equal(statuses(calls).at(-1), '01_Lab: rebuilt');
  c.script = 'dx:01_Lab';
  assert.equal(c.closeMap(), true);                   // no build: it closes
  assert.ok(calls.includes('closeMap'));
});

test('a queued surface row the host refuses: the Rebuild asks first, and stops when told to', async () => {
  const srv = server(), { c, calls } = page(srv);
  c.surfacePreview.refused = [{ id: 3, stage: 'rebuild', refused: "Pan exceeds the engine's signed 16-bit range" },
    { id: 4, stage: 'rebuild', refused: "Pan exceeds the engine's signed 16-bit range" }, { id: 5, stage: 'save', refused: 'Pan uses whole texels.' }];
  const said = "The Rebuild would fail: Pan exceeds the engine's signed 16-bit range (2 faces). Undo or fix that change.";
  assert.equal(c.rebuildRefusal(), said);
  c.answer = false;
  await c.rebuildMap();
  assert.deepEqual(plain(calls.filter((x) => x[0] === 'confirm')), [['confirm', `${said}\n\nRebuild anyway?`]]);
  assert.deepEqual([srv.calls.length, calls.includes('save'), c.buildJob], [0, false, null]);
  assert.deepEqual(plain(calls.filter((x) => x[0] === 'status').at(-1)), ['status', said, 'warn']);
  c.answer = true;                                    // anyway: it goes on as always (the host says it again)
  await c.rebuildMap();
  assert.ok(calls.includes('save') && srv.calls.length > 0);
  c.surfacePreview.refused = [c.surfacePreview.refused[2]];      // a row Save refuses: its save stops it, no question
  assert.equal(c.rebuildRefusal(), '');
});

test('a save that fails stops the Rebuild before the server builds anything, and says so', async () => {
  const srv = server(), { c, calls } = page(srv);
  c.save = async () => { calls.push('save'); return false; };
  await c.rebuildMap();
  assert.equal(srv.calls.length, 0);
  assert.equal(c.buildJob, null);
  assert.deepEqual(plain(calls.find((x) => x[0] === 'log')), ['log', '01_Lab: the changes could not be saved, so nothing was built.', 'bad']);
  assert.equal(statuses(calls).at(-1), 'rebuild failed: see Messages');
});

test('the keys during a build: the ones that look and the browser\'s own go on, the others wait', async () => {
  let open;
  const srv = server({ gate: new Promise((r) => { open = r; }) }), { c, calls } = page(srv);
  const key = (combo, target = { tagName: 'BODY', closest: () => null }) => {
    const e = { combo, target, prevented: false, preventDefault() { this.prevented = true; } };
    return { left: c.buildKeyGate(e), prevented: e.prevented };
  };
  assert.deepEqual(key('Delete'), { left: false, prevented: false }, 'no build: the editor has every key');
  const running = c.rebuildMap();
  await new Promise((r) => setTimeout(r, 20));
  const button = { tagName: 'BUTTON', closest: (sel) => (sel === PRESSABLE ? button : null) };
  assert.deepEqual(key('Tab'), { left: true, prevented: false }, 'Tab moves the focus');
  assert.deepEqual(key('Shift+Tab'), { left: true, prevented: false });
  assert.deepEqual(key('Enter', button), { left: true, prevented: false }, 'the chip\'s Cancel is pressed');
  assert.deepEqual(key('Space', button), { left: true, prevented: false });
  assert.deepEqual(key('F'), { left: false, prevented: false }, 'a key that looks: the editor does it');
  const before = statuses(calls).length;
  assert.deepEqual(key('Enter'), { left: true, prevented: true }, 'Enter on the 3D view waits (it renames a folder)');
  assert.deepEqual(key('Delete', button), { left: true, prevented: true });
  assert.equal(statuses(calls).length, before + 2);
  assert.match(statuses(calls).at(-1), /editing waits/);
  assert.deepEqual(key('Tab', { tagName: 'DIV', isContentEditable: true, closest: () => null }), { left: false, prevented: false });
  open();
  await running;
});

// the edits that wait for an answer of the server, run as they are: refused while a Rebuild runs, before they ask and
// when the answer comes (a Rebuild started meanwhile), so nothing lands to be taken back
function tools() {
  const calls = [], pending = [];
  const c = vm.createContext({ script: 'dx:01_Lab', mapName: '01_Lab', edits: { textures: {}, retexture: [], boxes: [], added: [] }, buildJob: null,
    mapLoading: false, gameView: null, tutorialSession: { revision: 1 }, structures: {}, proxyOf: () => null, requireUnlocked: () => true,
    api: (path) => new Promise((resolve) => { calls.push(['api', path]); pending.push({ path, resolve }); }),
    pushUndo: (label) => calls.push(['step', label]), setDirty: () => calls.push('dirty'), rebuildProxies() {}, log: (...a) => calls.push(['log', ...a]),
    status: (...a) => calls.push(['status', ...a]), shortTex: (t) => t, nextName: (p) => p + '9', addedKind: () => 'prop', intoDefaultFolder() {},
    selectKeys() {}, warnHiddenKinds() {}, objOf: (k) => k, selected: null, signSize: () => [128, 64],
    signCanvas: async () => ({ toDataURL: () => 'data:image/png;base64,' }), navigator: { clipboard: { readText: async () => 'Begin Map' } } });
  vm.runInContext(line('function rebuildWaits(') + '\n' + body('waitsForRebuild') + '\n' + body('refuseWhileBuilding') + '\n'
    + 'async ' + body('applyTexture') + '\nasync ' + body('pasteT3D') + '\nasync ' + body('updateSignTexture'), c);
  // the server answers every question asked: a T3D read, or a texture imported
  const answerAll = () => { for (const q of pending.splice(0)) q.resolve(q.path.startsWith('/api/t3d_import') ? t3d : texture); };
  return { c, calls, pending, answerAll };
}
const texture = { name: 'UCT_Wall_1', pcx: 'a.pcx', png: 'a.png', w: 64, h: 64, masked: false, scale: 1 };
const t3d = { boxes: [{ lo: [0, 0, 0], hi: [8, 8, 8] }], added: [], skipped: [], notes: [] };
const ctx = { kind: 'structure', target: 'room', orig: 'Wall_A', label: 'the room', size: [64, 64] };

test('a texture, a T3D paste or a sign\'s picture asked for during a Rebuild is refused before the server is asked', async () => {
  const { c, calls } = tools(), before = JSON.stringify(c.edits);
  c.buildJob = { map: '01_Lab' };
  await assert.rejects(c.applyTexture(ctx, 'png', 'one'), /^Error: Rebuilding 01_Lab: applying a texture waits until it ends/);
  await assert.rejects(c.updateSignTexture({ sign: { text: 'EXIT' } }), /Rebuilding 01_Lab: the sign's picture waits/);
  await c.pasteT3D('Begin Map');
  assert.ok(!calls.some((x) => x[0] === 'api'), 'nothing is sent');
  assert.match(calls.filter((x) => x[0] === 'status').at(-1)[1], /^Rebuilding 01_Lab: pasting waits/);
  assert.equal(JSON.stringify(c.edits), before);
});

test('a Rebuild that starts while the server answers: the answer changes nothing, and the caller is told', async () => {
  const { c, calls, pending, answerAll } = tools(), before = JSON.stringify(c.edits);
  const applying = c.applyTexture(ctx, 'png', 'one');
  const signing = c.updateSignTexture({ sign: { text: 'EXIT', tex: '' } });
  const pasting = c.pasteT3D('Begin Map');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pending.length, 3, 'each one has asked the server');
  c.buildJob = { map: '01_Lab' };                       // Rebuild pressed meanwhile (the native menu, the assistant)
  answerAll();
  await assert.rejects(applying, /applying a texture waits/);
  await assert.rejects(signing, /the sign's picture waits/);
  await pasting;
  assert.equal(JSON.stringify(c.edits), before);
  assert.ok(!calls.some((x) => x[0] === 'step' || x === 'dirty'));
  assert.match(calls.filter((x) => x[0] === 'status').at(-1)[1], /pasting waits/);
  // with no Rebuild they go through
  c.buildJob = null;
  const again = c.applyTexture(ctx, 'png', 'one');
  answerAll();
  assert.equal((await again).name, 'UCT_Wall_1');
  assert.deepEqual(calls.find((x) => x[0] === 'step'), ['step', 'Apply texture UCT_Wall_1']);
});

test('an answer that comes while the map is opened again after a Rebuild changes nothing, and the caller is told', async () => {
  // a build that ended 'done' opens its map again (loadScene replaces the edits): what lands meanwhile would be lost
  const { c, calls, pending, answerAll } = tools(), before = JSON.stringify(c.edits);
  const applying = c.applyTexture(ctx, 'png', 'one');
  const signing = c.updateSignTexture({ sign: { text: 'EXIT', tex: '' } });
  const pasting = c.pasteT3D('Begin Map');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pending.length, 3);
  c.mapLoading = true;                                  // the build has ended (buildJob null), its map is loading
  answerAll();
  await assert.rejects(applying, /^Error: The map is being opened: applying a texture waits until it is\. Make the change again then\.$/);
  await assert.rejects(signing, /The map is being opened: the sign's picture waits/);
  await pasting;
  assert.equal(JSON.stringify(c.edits), before);
  assert.ok(!calls.some((x) => x[0] === 'step' || x === 'dirty' || (x[0] === 'log' && x[2] === 'ok')), 'nothing is reported as done');
  assert.match(calls.filter((x) => x[0] === 'status').at(-1)[1], /^The map is being opened: pasting waits/);
});

test('a Rebuild pressed while a sign\'s picture is drawn, or while the clipboard is read: nothing is sent', async () => {
  const { c, calls } = tools();
  let drawn, read;
  c.signCanvas = () => new Promise((r) => { drawn = () => r({ toDataURL: () => 'data:image/png;base64,' }); });
  c.navigator.clipboard.readText = () => new Promise((r) => { read = () => r('Begin Map'); });
  const signing = c.updateSignTexture({ sign: { text: 'EXIT', tex: '' } });
  const pasting = c.pasteT3D();
  await new Promise((r) => setTimeout(r, 0));
  c.buildJob = { map: '01_Lab' };
  drawn(); read();
  const refused = assert.rejects(signing, /Rebuilding 01_Lab: the sign's picture waits/);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(!calls.some((x) => x[0] === 'api'), 'the server is not asked');
  await refused;
  await pasting;
  assert.match(calls.filter((x) => x[0] === 'status').at(-1)[1], /^Rebuilding 01_Lab: pasting waits/);
});

test('Cancel before the server has the build: nothing is started', async () => {
  const srv = server(), { c, calls } = page(srv);
  const running = c.rebuildMap();
  c.cancelBuild();                                   // while the map is being saved
  await running;
  assert.equal(srv.calls.length, 0);
  assert.equal(c.buildJob, null);
  assert.equal(statuses(calls).at(-1), '01_Lab: Rebuild cancelled before the build started, nothing was built.');
});
