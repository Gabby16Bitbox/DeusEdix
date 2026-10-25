import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../editor/static/app.js', import.meta.url), 'utf8');
async function moduleFrom(path) {
  const text = await readFile(new URL(path, import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
}
const { createSaveQueue } = await moduleFrom('../editor/static/save-state.js');
const { createAutosave, normalizeAutosaveSettings } = await moduleFrom('../editor/static/autosave.js');
const { exerciseOnly } = await moduleFrom('../editor/static/published-layout.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Run the actual map save methods and autosave callback, replacing only scene,
// network and time boundaries. Story's own revision handling has separate tests.
function setup({ automaticResponses = false } = {}) {
  let now = 10_000, timer = 0;
  const requests = [], statuses = [], logs = [], storyCalls = [], events = [], notices = [];
  const busy = { style: { display: 'none' } }, timers = new Map();
  const story = { dirty: false, saving: false, async save(options) {
    storyCalls.push(options); events.push('story'); story.dirty = false; return true;
  } };
  const context = vm.createContext({
    script: 'map_a', mapName: '01_A', projectContext: { id: 'project-a', kind: 'custom' },
    mapGeneration: 1, edits: { moved: { Crate0: [1, 2, 3] } }, editRevision: 1,
    dirty: true, mapLoading: false, lastEditingInput: 0, projectHub: { visible: false }, gameView: null, openingExperimentalBsp: false,
    tc: { dragging: false }, inspectorDrag: null, propertySlider: null, moveStart: null, placing: null,
    tutorialSession: { revision: 1 }, mapSaveQueue: createSaveQueue(), autosave: null,
    window: { __story: story, __menubar: { prefs: {} }, __projectNavigation: false },
    document: { querySelector: () => null }, $: () => busy,
    Date: class extends Date { static now() { return now; } },
    normalizeAutosaveSettings, exerciseOnly, publishedLayout: null,
    isTemporaryTutorial: (project, script) => project?.kind === 'tutorial' && script === 'deusedix_tutorial',
    showChanges: () => notices.push('changes'), buildStructList() {}, buildHierarchy() {},
    status: (...args) => statuses.push(args), log: (...args) => logs.push(args),
    api: (url, body) => {
      const gate = deferred();
      requests.push({ url, body, ...gate }); events.push('map');
      if (automaticResponses) gate.resolve({ ok: true });
      return gate.promise;
    },
    createAutosave: options => createAutosave({ ...options, now: () => now,
      setTimeout: (fn, delay) => { timers.set(++timer, { fn, delay }); return timer; },
      clearTimeout: id => timers.delete(id),
    }),
  });
  const sections = [
    source.slice(source.indexOf('async function saveWorkspace('), source.indexOf('\nasync function confirmProjectLeave(')),
    source.slice(source.indexOf('function temporaryTutorial()'), source.indexOf('\nfunction resetTutorialView(')),
    source.slice(source.indexOf('function setDirty()'), source.indexOf('\n', source.indexOf('function setDirty()'))),
    source.slice(source.indexOf('function autosaveKey()'), source.indexOf("\n$('#save').onclick")),
    source.slice(source.indexOf('autosave = createAutosave({'), source.indexOf("\ndocument.addEventListener('input', () => { lastEditingInput")),
  ];
  for (const section of sections) assert.ok(section.length > 30, 'Expected actual app function section');
  vm.runInContext(sections.join('\n') + '\nthis.functions = { save, saveWorkspace, autosaveKey, autosaveState, setDirty };', context);
  return { state: context, ...context.functions, requests, statuses, logs, storyCalls, events, notices, busy, story,
    controller: context.autosave,
    advance(ms) { now += ms; },
    changeMap(script = 'map_b') {
      context.script = script; context.mapName = '02_B'; context.mapGeneration++;
      context.edits = { moved: { Light1: [4, 5, 6] } }; context.editRevision++; context.dirty = true;
    },
  };
}

test('map keys separate projects, reopened maps and a closed workspace', () => {
  const app = setup(), initial = app.autosaveKey();
  app.state.mapGeneration++;
  assert.notEqual(app.autosaveKey(), initial);
  app.state.mapGeneration--;
  app.state.projectContext.id = 'project-b';
  assert.notEqual(app.autosaveKey(), initial);
  app.state.script = null;
  assert.equal(app.autosaveKey(), null);
});

test('autosave state includes Story drafts and defers around active editor work', () => {
  const app = setup();
  assert.equal(app.autosaveState().busy, false);
  app.state.dirty = false; app.story.dirty = true;
  assert.equal(app.autosaveState().dirty, true);
  for (const key of ['mapLoading', 'inspectorDrag', 'propertySlider', 'moveStart', 'placing']) {
    app.state[key] = true;
    assert.equal(app.autosaveState().busy, true, key);
    app.state[key] = false;
  }
  app.story.saving = true; assert.equal(app.autosaveState().busy, true); app.story.saving = false;
  app.state.tc.dragging = true; assert.equal(app.autosaveState().busy, true); app.state.tc.dragging = false;
  app.busy.style.display = 'flex'; assert.equal(app.autosaveState().busy, true); app.busy.style.display = 'none';
  app.state.window.__projectNavigation = true; assert.equal(app.autosaveState().busy, true);
  app.state.window.__projectNavigation = false;
  app.state.projectHub.visible = true; assert.equal(app.autosaveState().busy, true); app.state.projectHub.visible = false;
  app.state.document.querySelector = () => ({}); assert.equal(app.autosaveState().busy, true);
  app.state.document.querySelector = () => null;
  app.state.lastEditingInput = app.state.Date.now(); assert.equal(app.autosaveState().busy, true);
  app.advance(1501); assert.equal(app.autosaveState().busy, false);
});

test('disabled autosave and temporary training never write through the actual controller integration', async () => {
  for (const training of [false, true]) {
    const app = setup({ automaticResponses: true });
    app.story.dirty = true;
    if (training) { app.state.script = 'deusedix_tutorial'; app.state.projectContext.kind = 'tutorial'; }
    else app.state.window.__menubar.prefs.autosave = false;
    await app.controller.start(); app.advance(3_600_000); await app.controller.check();
    assert.equal(app.requests.length, 0);
    assert.equal(app.storyCalls.length, 0);
    if (training) assert.equal(await app.saveWorkspace({ automatic: true }), false);
    app.controller.stop();
  }
});

test('actual autosave callback saves both map and Story as drafts without a rebuild', async () => {
  const app = setup({ automaticResponses: true });
  app.story.dirty = true;
  await app.controller.start(); app.advance(300_000); await app.controller.check();
  assert.deepEqual(app.events, ['map', 'story']);
  assert.match(app.requests[0].url, /^\/api\/edits\?script=map_a&automatic=1$/);
  assert.equal(app.storyCalls[0].automatic, true);
  assert.equal(app.state.dirty, false);
  assert.equal(app.story.dirty, false);
  assert.match(app.statuses.at(-1)[0], /01_A: autosaved at/);
  app.controller.stop();
});

test('an edit made during a save remains dirty and cannot mutate the request snapshot', async () => {
  const app = setup();
  const saving = app.save({ automatic: true }); await tick();
  app.state.edits.moved.Crate0[0] = 99; app.setDirty();
  assert.equal(app.requests[0].body.moved.Crate0[0], 1);
  app.requests[0].resolve({ ok: true });
  assert.equal(await saving, true);
  assert.equal(app.state.dirty, true);
  assert.equal(app.notices.length, 1, 'Only the live edit should update the changes panel');
  assert.equal(app.statuses.some(([text]) => text.endsWith(': saved')), false);
});

test('queued manual and automatic saves run in order and take the latest queued snapshot', async () => {
  const app = setup();
  const first = app.save({ automatic: true }); await tick();
  app.state.edits.moved.Crate0[0] = 42; app.setDirty();
  const second = app.save(); await tick();
  assert.equal(app.requests.length, 1);
  assert.equal(app.autosaveState().busy, true);
  app.requests[0].resolve({ ok: true }); await first; await tick();
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[1].body.moved.Crate0[0], 42);
  assert.equal(app.requests[1].url, '/api/edits?script=map_a');
  app.requests[1].resolve({ ok: true }); assert.equal(await second, true);
  assert.equal(app.state.dirty, false);
  assert.equal(app.state.mapSaveQueue.pending, 0);
});

test('map changes invalidate pending completions and queued writes for the old map', async () => {
  const app = setup();
  const first = app.save(); await tick();
  const queued = app.save({ automatic: true });
  app.changeMap();
  app.requests[0].resolve({ ok: true });
  assert.equal(await first, false);
  assert.equal(await queued, false);
  assert.equal(app.requests.length, 1);
  assert.equal(app.state.dirty, true);
  assert.equal(app.notices.length, 0);
  assert.equal(app.statuses.length, 0);
});

test('changing maps during workspace save never saves the new maps Story on behalf of the old one', async () => {
  const app = setup(); app.story.dirty = true;
  const saving = app.saveWorkspace({ automatic: true }); await tick();
  app.changeMap(); app.requests[0].resolve({ ok: true });
  assert.equal(await saving, false);
  assert.equal(app.storyCalls.length, 0);
  assert.equal(app.story.dirty, true);
});

test('a closed tutorial session invalidates a pending manual save response', async () => {
  const app = setup();
  app.state.projectContext.kind = 'tutorial'; app.state.script = 'deusedix_tutorial';
  const saving = app.save(); await tick();
  app.state.tutorialSession.revision++;
  app.requests[0].resolve({ ok: true });
  assert.equal(await saving, false);
  assert.equal(app.state.dirty, true);
});

test('failed autosave preserves both dirty states and reports an error without attempting Story', async () => {
  const app = setup(); app.story.dirty = true;
  await app.controller.start(); app.advance(300_000);
  const saving = app.controller.check(); await tick();
  app.requests[0].reject(new Error('disk unavailable'));
  assert.equal(await saving, false);
  assert.equal(app.state.dirty, true); assert.equal(app.story.dirty, true);
  assert.equal(app.storyCalls.length, 0);
  assert.match(app.statuses.at(-1)[0], /Autosave failed/);
  assert.match(app.logs.at(-1)[0], /disk unavailable/);
  app.controller.stop();
});

test('a failed map write does not poison the next manual or automatic save', async () => {
  const app = setup();
  const first = app.save(); const failed = assert.rejects(first, /network/); await tick();
  const second = app.save({ automatic: true });
  app.requests[0].reject(new Error('network')); await failed; await tick();
  assert.equal(app.requests.length, 2);
  app.requests[1].resolve({ ok: true }); assert.equal(await second, true);
  assert.equal(app.state.dirty, false);
});

test('manual map save does not postpone a dirty Story; full workspace save restarts the interval', async () => {
  const app = setup({ automaticResponses: true }); app.story.dirty = true;
  const saved = [];
  app.state.autosave = { saved: key => saved.push(key) };
  assert.equal(await app.save(), true);
  assert.equal(saved.length, 0);
  assert.equal(await app.saveWorkspace(), true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0], app.autosaveKey());
});
