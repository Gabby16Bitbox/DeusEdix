import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTutorialSession, tutorialRequestHeaders, installTutorialSession, clearTutorialViewPreferences,
  isTemporaryTutorial, TUTORIAL_SCRIPT, TUTORIAL_HEADER } from '../editor/static/tutorial-session.js';

const ok = data => ({ ok: true, json: async () => data });
const fail = message => ({ ok: false, json: async () => ({ error: message }) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const capture = responder => {
  const calls = [];
  return { calls, fetch: async (path, init) => {
    const call = { path, ...init, body: JSON.parse(init.body) }; calls.push(call);
    return responder(call, calls.length);
  } };
};

test('first start creates a session; reopening the same guide and Rebuild reuse it', async () => {
  const transport = capture(call => ok({ session: call.body.session || 'A', fresh: !call.body.session }));
  const session = createTutorialSession(transport);
  assert.equal((await session.requestStart()).fresh, true);
  const revision = session.revision;
  assert.equal((await session.requestStart()).fresh, false);
  session.adopt('A'); // same-script scene reload after Rebuild
  assert.equal(session.revision, revision);
  assert.deepEqual(transport.calls.map(call => call.body), [{}, { session: 'A' }]);
  assert.equal(transport.calls[1].headers[TUTORIAL_HEADER], 'A');
});

test('rapid duplicate starts share the one build request', async () => {
  const waiting = deferred(), transport = capture(() => waiting.promise);
  const session = createTutorialSession(transport);
  const first = session.requestStart(), second = session.requestStart();
  assert.equal(first, second); assert.equal(transport.calls.length, 1);
  waiting.resolve(ok({ session: 'A', fresh: true }));
  await first; assert.equal(session.token, 'A'); assert.equal(session.preparing, false);
});

test('successful Close map forgets the token; next open has no previous session', async () => {
  let next = 0;
  const transport = capture(call => ok(call.path.endsWith('_start') ? { session: String(++next), fresh: true } : {}));
  const session = createTutorialSession(transport);
  await session.requestStart(); await session.end();
  assert.equal(session.token, null);
  await session.requestStart();
  assert.equal(session.token, '2');
  assert.deepEqual(transport.calls.map(call => call.body), [{}, { session: '1' }, {}]);
});

test('rejected Close map retains the active exercise token for retry and guide restore', async () => {
  const transport = capture(call => call.path.endsWith('_end') ? fail('Close the running game first') : ok({ session: 'A' }));
  const session = createTutorialSession(transport); session.adopt('A');
  await assert.rejects(session.end(), /running game/);
  assert.equal(session.token, 'A');
  await session.requestStart();
  assert.deepEqual(transport.calls[1].body, { session: 'A' });
});

test('a failed fresh-start cleanup also preserves the current exercise', async () => {
  const transport = capture(() => fail('Game is running'));
  const session = createTutorialSession(transport); session.adopt('A');
  await assert.rejects(session.requestStart({ fresh: true }), /running/);
  assert.equal(session.token, 'A'); assert.equal(session.preparing, false);
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].path, '/api/tutorial_end');
});

test('close during preparation discards its late result without replacing a newer session', async () => {
  const waiting = deferred();
  const transport = capture(call => call.path.endsWith('_start') ? waiting.promise : ok({}));
  const session = createTutorialSession(transport);
  const starting = session.requestStart();
  await session.end(); session.adopt('B');
  waiting.resolve(ok({ session: 'A', fresh: true }));
  await assert.rejects(starting, { name: 'AbortError' });
  assert.equal(session.token, 'B');
  assert.deepEqual(transport.calls.at(-1).body, { session: 'A' });
  assert.equal(transport.calls.at(-1).headers[TUTORIAL_HEADER], 'A');
});

test('a stale end request never clears a later session', async () => {
  const transport = capture(() => ok({})), session = createTutorialSession(transport);
  session.adopt('B'); const revision = session.revision;
  await session.end({ session: 'A' });
  assert.equal(session.token, 'B'); assert.equal(session.revision, revision);
  assert.deepEqual(transport.calls[0].body, { session: 'A' });
});

test('pending close completion does not erase a concurrently adopted session', async () => {
  const waiting = deferred(), session = createTutorialSession(capture(() => waiting.promise));
  session.adopt('A'); const closing = session.end(); session.adopt('B');
  waiting.resolve(ok({})); await closing;
  assert.equal(session.token, 'B');
});

test('authentication binds same-origin API requests and preserves explicit stale cleanup tokens', () => {
  const origin = 'http://localhost:8796/', init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
  const scoped = tutorialRequestHeaders('/api/edits?script=deusedix_tutorial', init, 'A', origin);
  assert.equal(scoped.headers.get(TUTORIAL_HEADER), 'A');
  assert.equal(scoped.body, '{}'); assert.equal(init.headers[TUTORIAL_HEADER], undefined);
  assert.equal(tutorialRequestHeaders('https://example.com/api/anything', init, 'A', origin), init);
  assert.equal(tutorialRequestHeaders('/static/app.js', init, 'A', origin), init);
  const old = tutorialRequestHeaders('/api/tutorial_end', { headers: { [TUTORIAL_HEADER]: 'old' } }, 'new', origin);
  assert.equal(old.headers.get(TUTORIAL_HEADER), 'old');
  const request = new Request(origin + 'api/scene', { headers: { Accept: 'application/json' } });
  assert.equal(tutorialRequestHeaders(request, {}, 'A', origin).headers.get('Accept'), 'application/json');
});

test('only the training map receives disposable-map behavior', () => {
  for (const kind of ['tutorial', 'training']) assert.equal(isTemporaryTutorial({ id: 'training', kind }, TUTORIAL_SCRIPT), true);
  for (const kind of ['custom', 'original', 'legacy']) assert.equal(isTemporaryTutorial({ id: 'training', kind }, TUTORIAL_SCRIPT), false);
  assert.equal(isTemporaryTutorial({ id: 'campaign', kind: 'training' }, TUTORIAL_SCRIPT), false);
  assert.equal(isTemporaryTutorial({ id: 'training', kind: 'training' }, 'my_map'), false);
  assert.equal(isTemporaryTutorial(null, TUTORIAL_SCRIPT), false);
});

test('fresh sessions clear only their exercise visibility/locks, clipboard and legacy progress', () => {
  const prefix = 'deusedix.project:training:', other = 'deusedix.project:campaign:';
  const values = new Map([[prefix + 'objects.' + TUTORIAL_SCRIPT, '{"hidden":["crate"]}'], [prefix + 'clipboard', 'old exercise'],
    [prefix + 'tutorial', '{"step":8,"map":"old","muted":true}'], [other + 'clipboard', 'my prop'], ['deusedix.workspace.v1', 'layout']]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  clearTutorialViewPreferences(storage, 'training');
  assert.equal(values.has(prefix + 'objects.' + TUTORIAL_SCRIPT), false);
  assert.equal(values.has(prefix + 'clipboard'), false);
  assert.deepEqual(JSON.parse(values.get(prefix + 'tutorial')), { muted: true });
  assert.equal(values.get(other + 'clipboard'), 'my prop'); assert.equal(values.get('deusedix.workspace.v1'), 'layout');
});

test('pagehide uses authenticated keepalive cleanup and BFCache cannot revive the discarded editor', async () => {
  const events = new Map(), navigations = [], transport = capture(() => ok({}));
  const target = { fetch: transport.fetch, location: { href: 'http://localhost:8796/', pathname: '/', replace: url => navigations.push(url) },
    __projectContext: { homeUrl: 'http://localhost:8790/' }, addEventListener: (type, handler) => events.set(type, handler) };
  const session = createTutorialSession({ fetch: (...args) => target.fetch(...args) });
  session.adopt('A'); installTutorialSession(target, session);
  const installed = target.fetch; installTutorialSession(target, session); assert.equal(target.fetch, installed);
  events.get('pagehide')();
  assert.equal(session.token, null);
  await Promise.resolve();
  assert.equal(transport.calls[0].keepalive, true);
  assert.equal(new Headers(transport.calls[0].headers).get(TUTORIAL_HEADER), 'A');
  events.get('pageshow')({ persisted: true });
  assert.deepEqual(navigations, ['http://localhost:8790/']);
});
