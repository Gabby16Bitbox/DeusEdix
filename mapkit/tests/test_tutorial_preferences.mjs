import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../editor/static/project-storage.js', import.meta.url), 'utf8');
const prefix = 'deusedix.project:training:';
const key = name => prefix + name;
const json = JSON.stringify;

function bootstrap({ kind = 'tutorial', preferences = {}, stored = {} } = {}) {
  class Storage {
    constructor(values) { this.values = new Map(Object.entries(values)); }
    get length() { return this.values.size; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    getItem(key) { return this.values.get(String(key)) ?? null; }
    setItem(key, value) { this.values.set(String(key), String(value)); }
    removeItem(key) { this.values.delete(String(key)); }
  }
  const storage = new Storage(stored), requests = [], timers = new Map();
  let nextTimer = 0;
  const window = {
    __projectContext: { id: 'training', kind },
    __projectPreferences: preferences,
    fetch: async (input, init) => {
      requests.push({ input, init });
      return { ok: true, json: async () => ({}) };
    },
  };
  vm.runInNewContext(source, {
    window, Storage, localStorage: storage, URL,
    location: { href: 'http://localhost:8790/', origin: 'http://localhost:8790' },
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id),
  });
  return { storage, requests, window, timers, async snapshot() {
    await window.__flushProjectPreferences();
    return JSON.parse(requests.at(-1).init.body);
  } };
}

test('bootstrap removes old exercise state while preserving interface and other maps', () => {
  const app = bootstrap({
    stored: { [key('clipboard')]: '{"old":true}', [key('objects.deusedix_tutorial')]: '{"hidden":["Light0"]}' },
    preferences: {
      [key('tutorial')]: json({ muted: true, offered: true, step: 8, map: '00_DeusEdix_Tutorial', done: true }),
      [key('clipboard')]: json({ kind: 'actor', actor: 'Crate0' }),
      [key('objects.deusedix_tutorial')]: json({ hidden: ['Crate0'], locked: ['Light0'] }),
      [key('maps')]: json({ lastMap: 'deusedix_tutorial', recentMaps: [{ script: 'deusedix_tutorial' }, { script: 'my_room' }], customChoice: 'keep' }),
      [key('objects.my_room')]: json({ hidden: ['Crate1'] }),
      'deusedix.workspace.v1': '{"inspector":240}',
    },
  });
  assert.equal(app.storage.getItem(key('clipboard')), null);
  assert.equal(app.storage.getItem(key('objects.deusedix_tutorial')), null);
  assert.deepEqual(JSON.parse(app.storage.getItem(key('tutorial'))), { muted: true, offered: true });
  assert.deepEqual(JSON.parse(app.storage.getItem(key('maps'))), {
    lastMap: null, recentMaps: [{ script: 'my_room' }], customChoice: 'keep',
  });
  assert.deepEqual(JSON.parse(app.storage.getItem(key('objects.my_room'))), { hidden: ['Crate1'] });
  assert.equal(app.storage.getItem('deusedix.workspace.v1'), '{"inspector":240}');
});

test('snapshot excludes exercise data without breaking clipboard and object state during the session', async () => {
  const app = bootstrap();
  app.storage.setItem(key('clipboard'), json({ kind: 'actor', actor: 'Crate0' }));
  app.storage.setItem(key('objects.deusedix_tutorial'), json({ hidden: ['Crate0'] }));
  app.storage.setItem(key('tutorial'), json({ muted: false, step: 4, map: '00_DeusEdix_Tutorial', completed: ['first'] }));
  app.storage.setItem(key('maps'), json({ lastMap: 'my_room', recentMaps: ['deusedix_tutorial', { script: 'my_room' }] }));
  const snapshot = await app.snapshot();
  assert.equal(key('clipboard') in snapshot, false);
  assert.equal(key('objects.deusedix_tutorial') in snapshot, false);
  assert.deepEqual(JSON.parse(snapshot[key('tutorial')]), { muted: false });
  assert.deepEqual(JSON.parse(snapshot[key('maps')]), { lastMap: 'my_room', recentMaps: [{ script: 'my_room' }] });
  assert.equal(JSON.parse(app.storage.getItem(key('clipboard'))).actor, 'Crate0');
  assert.deepEqual(JSON.parse(app.storage.getItem(key('objects.deusedix_tutorial'))), { hidden: ['Crate0'] });
});

test('a fresh page cannot resume exercise state from either browser storage or project preferences', async () => {
  const first = bootstrap();
  first.storage.setItem(key('clipboard'), '{"kind":"group"}');
  first.storage.setItem(key('objects.deusedix_tutorial'), '{"hidden":["Door0"]}');
  first.storage.setItem(key('tutorial'), '{"muted":true,"step":7,"map":"00_DeusEdix_Tutorial"}');
  first.storage.setItem(key('maps'), '{"lastMap":"deusedix_tutorial","recentMaps":[{"script":"deusedix_tutorial"}]}');
  const second = bootstrap({ preferences: await first.snapshot(), stored: Object.fromEntries(first.storage.values) });
  assert.equal(second.storage.getItem(key('clipboard')), null);
  assert.equal(second.storage.getItem(key('objects.deusedix_tutorial')), null);
  assert.deepEqual(JSON.parse(second.storage.getItem(key('tutorial'))), { muted: true });
  assert.deepEqual(JSON.parse(second.storage.getItem(key('maps'))), { lastMap: null, recentMaps: [] });
});

test('custom and legacy projects preserve their data even with a map named deusedix_tutorial', async () => {
  const preferences = {
    [key('objects.deusedix_tutorial')]: '{"hidden":["Crate0"]}',
    [key('clipboard')]: '{"kind":"actor"}',
    [key('tutorial')]: '{"step":9}',
    [key('maps')]: '{"lastMap":"deusedix_tutorial","recentMaps":[{"script":"deusedix_tutorial"}]}',
  };
  for (const kind of ['custom', 'legacy', 'original']) {
    const app = bootstrap({ kind, preferences });
    assert.deepEqual(Object.fromEntries(app.storage.values), preferences);
    assert.deepEqual(await app.snapshot(), preferences);
  }
});

test('the training project alias has the same disposable preferences', async () => {
  const app = bootstrap({ kind: 'training', preferences: {
    [key('clipboard')]: '{}', [key('tutorial')]: '{"muted":false,"step":2}',
  } });
  assert.equal(app.storage.getItem(key('clipboard')), null);
  assert.deepEqual(await app.snapshot(), { [key('tutorial')]: '{"muted":false}' });
});

test('invalid exercise preferences do not block valid preferences or preserve malformed progress', async () => {
  for (const value of ['{broken', '[]', 'null', '"step 7"']) {
    const app = bootstrap({ preferences: {
      [key('tutorial')]: value, [key('maps')]: value, [key('custom')]: value,
    } });
    assert.equal(app.storage.getItem(key('tutorial')), null);
    assert.equal(app.storage.getItem(key('maps')), null);
    assert.equal(app.storage.getItem(key('custom')), value);
    app.storage.setItem(key('tutorial'), value);
    app.storage.setItem(key('maps'), value);
    assert.deepEqual(await app.snapshot(), { [key('custom')]: value });
  }
});

test('project navigation flushes filtered preferences before switching and retains global UI settings', async () => {
  const app = bootstrap();
  app.storage.setItem(key('clipboard'), '{"kind":"actor"}');
  app.storage.setItem(key('tutorial'), '{"muted":true,"step":3}');
  app.storage.setItem('deusedix.prefs', '{"density":"compact"}');
  app.storage.setItem('deusedix.project:another:maps', '{"lastMap":"private"}');
  await app.window.fetch('/api/projects/open', { method: 'POST', body: '{"id":"another"}' });
  assert.deepEqual(app.requests.map(r => r.input), ['/api/project/preferences', '/api/projects/open']);
  assert.deepEqual(JSON.parse(app.requests[0].init.body), {
    [key('tutorial')]: '{"muted":true}', 'deusedix.prefs': '{"density":"compact"}',
  });
  assert.equal(app.timers.size, 0);
});
