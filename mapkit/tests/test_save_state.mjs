import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

const queueSource = await readFile(new URL('../editor/static/save-state.js', import.meta.url), 'utf8');
const {createSaveQueue} = await import('data:text/javascript;base64,' + Buffer.from(queueSource).toString('base64'));
const storySource = (await readFile(new URL('../editor/static/story.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

test('save queue is FIFO and pending includes both active and queued writes', async () => {
  const queue = createSaveQueue(), gate = deferred(), calls = [];
  const first = queue.run(async () => { calls.push('first'); await gate.promise; return 1; });
  const second = queue.run(async () => { calls.push('second'); return 2; });
  assert.equal(queue.pending, 2);
  await tick();
  assert.deepEqual(calls, ['first']);
  gate.resolve();
  assert.equal(await first, 1);
  assert.equal(await second, 2);
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(queue.pending, 0);
});

test('save queue recovers after asynchronous and synchronous failures', async () => {
  const queue = createSaveQueue();
  const first = queue.run(async () => { throw Error('network'); });
  const second = queue.run(() => { throw Error('snapshot'); });
  const errors = [assert.rejects(first, /network/), assert.rejects(second, /snapshot/)];
  const third = queue.run(() => 'saved');
  assert.equal(queue.pending, 3);
  await Promise.all(errors);
  assert.equal(await third, 'saved');
  assert.equal(queue.pending, 0);
});

function fixture(text = 'Original line') {
  return {route: 'unatco', dialogues: [{id: 'd1', owner: 'Guard0', steps: [
    {type: 'line', who: 'npc', text, voice: 'old_voice'},
  ]}], events: [], infolinks: []};
}

// Execute the real panel save/apply functions. The DOM fixture only replaces
// rendering; request bodies, revisions, context guards and response handling
// all come from story.js rather than a mirrored test implementation.
function storyHarness() {
  const elements = new Map(), requests = [];
  const getElement = selector => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  function element() {
    return {innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
      classList: {add() {}, remove() {}, contains() { return false; }},
      appendChild() {}, addEventListener() {}, querySelector: getElement,
      querySelectorAll() { return []; }, closest() { return this; }};
  }
  const window = {addEventListener() {}, __editor: {script: 'map_a', baseActors: [], added: []}};
  const document = {createElement: element, querySelector: getElement, querySelectorAll: () => [],
    getElementById: id => getElement('#' + id), head: element(), body: element()};
  const context = vm.createContext({window, document, createSaveQueue,
    configureStateEditor() {}, conditionProblems: () => [],
    fetch(url, options) {
      const gate = deferred();
      requests.push({url, body: JSON.parse(options.body), gate});
      return gate.promise;
    },
  });
  vm.runInContext(storySource, context, {filename: 'story.js'});
  const api = vm.runInContext(`({
    save, apply, changed,
    load(data, script = 'map_a') {
      window.__story.reset();
      window.__editor.script = script;
      story = data; mapLoaded = script;
      $('#st-route').value = data.route;
      renderLists = () => {};
      changed();
    },
    get story() { return story; }, get dirty() { return dirty; },
    get saving() { return window.__story.saving; },
    reset() { window.__story.reset(); },
  })`, context);
  api.load(fixture());
  return {api, window, requests, element: getElement,
    reply(index, body = {voices: ['new_voice'], ok: true}, ok = true) {
      requests[index].gate.resolve({ok, json: async () => body});
    },
  };
}

test('automatic story save snapshots its source map, skips rekey and clears only its own revision', async () => {
  const h = storyHarness(), save = h.api.save({automatic: true});
  assert.equal(h.api.saving, 1);
  await tick();
  assert.match(h.requests[0].url, /^\/api\/story\?script=map_a&automatic=1$/);
  assert.equal(h.requests[0].body.dialogues[0].bind, 'UCEd_Guard0');
  assert.equal(h.api.story.dialogues[0].bind, undefined, 'Snapshot normalization must not edit the live draft');
  h.reply(0, {voices: null});
  assert.equal(await save, true);
  assert.equal(h.api.dirty, false);
  assert.equal(h.api.story.dialogues[0].steps[0].voice, 'old_voice');
  assert.equal(h.api.saving, 0);
  assert.equal(await h.api.save({automatic: true}), true);
  assert.equal(h.requests.length, 1);
});

test('editing and reordering during save preserves the newer draft and its voice associations', async () => {
  const h = storyHarness();
  h.api.story.dialogues[0].steps.push({type: 'line', who: 'jc', text: 'Second', voice: 'second_voice'});
  const save = h.api.save();
  await tick();
  h.api.story.dialogues[0].steps.reverse();
  h.api.story.dialogues[0].steps[1].text = 'Changed while saving';
  h.api.changed();
  h.reply(0, {voices: ['renamed_first', 'renamed_second']});
  assert.equal(await save, true);
  assert.equal(h.api.dirty, true);
  assert.equal(h.api.story.dialogues[0].steps[0].voice, 'second_voice');
  assert.equal(h.api.story.dialogues[0].steps[1].voice, 'old_voice');
  assert.equal(h.api.story.dialogues[0].steps[1].text, 'Changed while saving');
  assert.equal(h.element('#st-save').textContent, 'Save *');
  assert.equal(h.requests[0].body.dialogues[0].steps[0].text, 'Original line');
});

test('queued save captures the latest draft when it starts, after earlier save completes', async () => {
  const h = storyHarness(), first = h.api.save();
  await tick();
  const second = h.api.save({automatic: true});
  h.api.story.dialogues[0].steps[0].text = 'Latest text'; h.api.changed();
  assert.equal(h.api.saving, 2);
  assert.equal(h.requests.length, 1);
  h.reply(0); await first; await tick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].body.dialogues[0].steps[0].text, 'Latest text');
  h.reply(1, {voices: null}); await second;
  assert.equal(h.api.dirty, false);
});

for (const script of ['map_b', 'map_a']) {
  test(`map switch/reload (${script}) rejects late responses and skips already queued saves`, async () => {
    const h = storyHarness(), first = h.api.save();
    await tick();
    const queued = h.api.save();
    h.api.load(fixture('New map draft'), script);
    const logBefore = h.element('#st-log').innerHTML;
    h.reply(0); await first;
    assert.equal(await queued, false);
    assert.equal(h.requests.length, 1);
    assert.equal(h.api.dirty, true);
    assert.equal(h.api.story.dialogues[0].steps[0].text, 'New map draft');
    assert.equal(h.api.story.dialogues[0].steps[0].voice, 'old_voice');
    assert.equal(h.element('#st-log').innerHTML, logBefore);
    assert.equal(h.api.saving, 0);
  });
}

test('story save failure preserves dirty state and allows the next queued save', async () => {
  const h = storyHarness(), first = h.api.save();
  const rejected = assert.rejects(first, /Disk full/);
  await tick();
  const second = h.api.save();
  h.reply(0, {error: 'Disk full'}, false); await rejected; await tick();
  assert.equal(h.api.dirty, true);
  assert.equal(h.requests.length, 2);
  h.reply(1); await second;
  assert.equal(h.api.dirty, false);
  assert.equal(h.api.story.dialogues[0].steps[0].voice, 'new_voice');
});

test('Apply waits for Save, sees its rekeyed voices, and does not clear newer edits', async () => {
  const h = storyHarness(), save = h.api.save();
  await tick();
  const apply = h.api.apply();
  assert.equal(h.api.saving, 2);
  assert.equal(h.requests.length, 1);
  h.reply(0); await save; await tick();
  assert.match(h.requests[1].url, /^\/api\/story_apply\?script=map_a$/);
  assert.equal(h.requests[1].body.story.dialogues[0].steps[0].voice, 'new_voice');
  h.api.story.dialogues[0].steps[0].text = 'After Apply started'; h.api.changed();
  h.reply(1, {ok: true, voices: ['applied_voice']});
  assert.equal((await apply).clean, false);
  assert.equal(h.api.dirty, true);
  assert.equal(h.api.story.dialogues[0].steps[0].voice, 'new_voice');
  assert.equal(h.element('#busy').style.display, 'none');
});

test('late Apply completion cannot change a new map or hide its loading overlay', async () => {
  const h = storyHarness(), apply = h.api.apply();
  await tick();
  h.api.load(fixture('Another map'), 'map_b');
  h.element('#busytext').textContent = 'Opening another map...';
  const logBefore = h.element('#st-log').innerHTML;
  h.reply(0); await apply;
  assert.equal(h.api.dirty, true);
  assert.equal(h.api.story.dialogues[0].steps[0].voice, 'old_voice');
  assert.equal(h.element('#st-log').innerHTML, logBefore);
  assert.equal(h.element('#busy').style.display, 'flex');
});

test('queued Apply validates the latest draft rather than an earlier valid snapshot', async () => {
  const h = storyHarness(), save = h.api.save();
  await tick();
  const apply = h.api.apply();
  h.api.story.dialogues[0].steps[0].text = ''; h.api.changed();
  h.reply(0); await save;
  assert.equal((await apply).saved, false);
  assert.equal(h.requests.length, 1, 'An invalid latest draft must not be compiled');
  assert.equal(h.api.dirty, true);
  assert.match(h.element('#st-log').innerHTML, /a line is empty/);
});

test('closing a story before a queued Apply starts prevents its request', async () => {
  const h = storyHarness(), save = h.api.save();
  await tick();
  const apply = h.api.apply();
  h.api.reset(); h.reply(0); await save;
  assert.equal((await apply).skipped, true);
  assert.equal(h.requests.length, 1);
  assert.equal(await h.api.save(), false);
  assert.equal(h.api.saving, 0);
});
