import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// the page's window: Play flushes the project's preferences through it before the launch
globalThis.window ??= {};
const source = await readFile(new URL('../editor/static/game-view.js', import.meta.url), 'utf8');
const { createPlaySessionController, createGameView } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const { PLAY_CONTROLS, pressedAtStart } = await import('../editor/static/play-scenarios.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const closed = (error = '') => ({ owned: false, launching: false, running: false, stopping: false, pid: null, created: null, token: 'game-a', error });
const launching = () => ({ ...closed(), owned: true, launching: true });
const running = () => ({ ...closed(), owned: true, running: true, pid: 123, created: '134056048549014988' });
function setup(options = {}) {
  const requests = [], events = [], logs = [], timers = new Map(), handlers = new Map();
  let sequence = 0, script = 'test_room', session = closed();
  const api = async (url, body) => {
    requests.push({ url, body });
    const path = url.split('?')[0];
    if (handlers.has(path)) return await handlers.get(path)(url, body);
    if (path === '/api/play_prepare') return { ok: true, token: 'prepared-copy', lines: ['Prepared'] };
    if (path === '/api/play') { session = launching(); return { ok: true, session, lines: ['Launched'] }; }
    if (path === '/api/play_session') return { ...session };
    if (path === '/api/live_stop') { session = closed(); return { ok: true }; }
    throw new Error('Unexpected endpoint: ' + url);
  };
  const controller = createPlaySessionController({ api, getScript: () => script, getSession: () => 'worker-session',
    getStart: () => ({ from: 'camera', pos: [1, 2, 3] }), save: async () => true,
    onState: state => events.push(state), onLog: lines => logs.push(...lines),
    setTimeout: (fn, ms) => { timers.set(++sequence, { fn, ms }); return sequence; },
    clearTimeout: id => timers.delete(id), ...options });
  return { controller, requests, events, logs, timers, handlers,
    setScript: value => { script = value; }, setSession: value => { session = value; },
    count: path => requests.filter(r => r.url.split('?')[0] === path).length,
    async timer() {
      const next = timers.entries().next().value;
      if (!next) return;
      timers.delete(next[0]); next[1].fn(); await tick();
    } };
}

test('prepares once and launches with the issued token, camera start and overrides', async () => {
  const f = setup();
  assert.equal(await f.controller.start('external', { from: 'start', previewToken: 'forged' }), true);
  assert.deepEqual(f.requests.slice(0, 2).map(r => r.url.split('?')[0]), ['/api/play_prepare', '/api/play']);
  assert.deepEqual(f.requests[1].body, { from: 'start', pos: [1, 2, 3], displayMode: 'external', previewToken: 'prepared-copy' });
  assert.equal(f.controller.state.mode, 'external');
  assert.equal(f.controller.state.phase, 'launching');
  assert.deepEqual(f.logs, ['Prepared', 'Launched']);
  assert.equal(f.timers.size, 1);
  f.controller.dispose();
});

test('browser capability failure does not save, prepare, launch or leave editor locked', async () => {
  let saves = 0;
  const f = setup({ save: async () => { saves++; }, canStart: async () => { throw new Error('Desktop app required'); } });
  assert.equal(await f.controller.start('embedded'), false);
  assert.equal(saves, 0); assert.equal(f.requests.length, 0);
  assert.equal(f.controller.active, false); assert.equal(f.timers.size, 0);
  assert.match(f.controller.state.error, /Desktop/);
});

test('failed save prevents all game operations', async () => {
  const f = setup({ save: async () => false });
  assert.equal(await f.controller.start(), false);
  assert.equal(f.requests.length, 0); assert.equal(f.controller.active, false);
});

test('Stop while saving cancels before the backend is touched', async () => {
  const save = deferred(), f = setup({ save: () => save.promise });
  const start = f.controller.start(); await tick();
  const stop = f.controller.stop(); save.resolve(true);
  assert.equal(await start, false); assert.equal(await stop, true);
  assert.equal(f.requests.length, 0); assert.equal(f.controller.active, false);
});

test('Stop during preparation waits for it, cleans up and never launches', async () => {
  const prepared = deferred(), f = setup();
  f.handlers.set('/api/play_prepare', () => prepared.promise);
  const start = f.controller.start(); await tick();
  const stop = f.controller.stop(); await tick();
  assert.equal(f.controller.state.phase, 'stopping');
  assert.equal(f.count('/api/live_stop'), 0, 'Do not race cleanup against ongoing preparation');
  prepared.resolve({ ok: true, token: 'prepared-copy' });
  assert.equal(await start, false); assert.equal(await stop, true);
  assert.equal(f.count('/api/play'), 0); assert.equal(f.count('/api/live_stop'), 1);
  assert.equal(f.controller.active, false); assert.equal(f.timers.size, 0);
});

test('Stop during launch waits and closes exactly the newly launched session', async () => {
  const launched = deferred(), f = setup();
  f.handlers.set('/api/play', () => launched.promise);
  const start = f.controller.start(); await tick();
  const stop = f.controller.stop(); await tick();
  assert.equal(f.count('/api/live_stop'), 0);
  f.setSession(running()); launched.resolve({ ok: true, session: running() });
  assert.equal(await start, false); assert.equal(await stop, true);
  const request = f.requests.find(r => r.url === '/api/live_stop');
  // embedded (start's default): the game is first only asked to close, inside the panel
  assert.deepEqual(request.body, { token: 'game-a', force: false });
  assert.equal(f.controller.active, false);
});

test('Steam startup remains launching until a verified process arrives', async () => {
  const f = setup(); await f.controller.start();
  for (let i = 0; i < 20; i++) {
    await f.timer(); assert.equal(f.controller.state.phase, 'launching'); assert.equal(f.controller.active, true);
  }
  f.setSession(running()); await f.timer();
  assert.equal(f.controller.state.phase, 'running'); assert.equal(f.controller.state.session.pid, 123);
  f.controller.dispose();
});

test('only one status request can be in flight', async () => {
  const status = deferred(), f = setup(); await f.controller.start();
  f.handlers.set('/api/play_session', () => status.promise);
  const one = f.controller.poll(), two = f.controller.poll();
  assert.equal(one, two); assert.equal(f.count('/api/play_session'), 1);
  status.resolve(running()); await one;
  assert.equal(f.controller.state.phase, 'running'); f.controller.dispose();
});

test('natural exit releases editor and stops polling', async () => {
  const f = setup(); await f.controller.start();
  f.setSession(running()); await f.timer();
  f.setSession(closed()); await f.timer();
  assert.equal(f.controller.active, false); assert.equal(f.controller.state.phase, 'idle');
  assert.equal(f.timers.size, 0); assert.equal(f.count('/api/live_stop'), 0);
});

test('a replacement process is never attached or stopped through an old session', async () => {
  const f = setup(); await f.controller.start();
  f.setSession({ ...running(), token: 'game-b', pid: 456 });
  assert.equal(await f.controller.stop(), false);
  assert.equal(f.count('/api/live_stop'), 0); assert.equal(f.controller.active, false);
  assert.match(f.controller.state.error, /replacement/); assert.equal(f.timers.size, 0);
});

test('status polling also detects replacement identities without continuing to poll', async () => {
  const f = setup(); await f.controller.start();
  f.setSession({ ...running(), token: 'game-b' }); await f.timer();
  assert.equal(f.controller.active, false); assert.equal(f.timers.size, 0);
  assert.equal(f.count('/api/live_stop'), 0);
});

test('Stop failure keeps session active and offers a successful retry', async () => {
  const f = setup(); await f.controller.start(); f.setSession(running());
  f.handlers.set('/api/live_stop', () => { throw new Error('Process did not close'); });
  assert.equal(await f.controller.stop(), false); assert.equal(f.controller.active, true);
  assert.equal(f.controller.state.phase, 'error'); assert.match(f.controller.state.error, /did not close/);
  await f.controller.poll();
  assert.equal(f.controller.state.phase, 'error', 'Polling must not erase failed Stop');
  f.handlers.delete('/api/live_stop');
  assert.equal(await f.controller.stop(), true); assert.equal(f.controller.active, false);
});

test('late Steam process cancellation stays active until backend confirms closure', async () => {
  const f = setup(); await f.controller.start();
  f.handlers.set('/api/live_stop', () => { f.setSession({ ...launching(), stopping: true }); return { ok: true }; });
  assert.equal(await f.controller.stop(), false);
  assert.equal(f.controller.active, true); assert.equal(f.controller.state.phase, 'stopping');
  f.setSession(closed()); await f.timer();
  assert.equal(f.controller.active, false); assert.equal(f.timers.size, 0);
});

test('cleanup failure after game exit stays active until Stop restores configuration', async () => {
  const f = setup(); await f.controller.start();
  f.setSession(closed('Temporary configuration could not be restored')); await f.timer();
  assert.equal(f.controller.active, true); assert.equal(f.controller.state.phase, 'error');
  assert.equal(await f.controller.stop(), true); assert.equal(f.controller.active, false);
});

test('map switch during preparation cleans up and cannot launch another map', async () => {
  const prepared = deferred(), f = setup(); f.handlers.set('/api/play_prepare', () => prepared.promise);
  const start = f.controller.start(); await tick(); f.setScript('different_room');
  prepared.resolve({ ok: true, token: 'prepared-copy' });
  assert.equal(await start, false); assert.equal(f.count('/api/play'), 0);
  assert.equal(f.count('/api/live_stop'), 1); assert.equal(f.controller.active, false);
  assert.match(f.controller.state.error, /map changed/);
});

test('double Play cannot create a second preparation', async () => {
  const prepared = deferred(), f = setup(); f.handlers.set('/api/play_prepare', () => prepared.promise);
  const one = f.controller.start(); await tick();
  assert.equal(await f.controller.start('external'), false);
  prepared.resolve({ ok: true, token: 'prepared-copy' }); await one;
  assert.equal(f.count('/api/play_prepare'), 1); assert.equal(f.count('/api/play'), 1);
  f.controller.dispose();
});

test('duplicate Stop shares one operation and external fallback does not relaunch', async () => {
  const stopped = deferred(), f = setup(); await f.controller.start();
  f.controller.setMode('external'); assert.equal(f.count('/api/play'), 1);
  f.handlers.set('/api/live_stop', () => stopped.promise);
  const one = f.controller.stop(), two = f.controller.stop(); assert.equal(one, two); await tick();
  f.setSession(closed()); stopped.resolve({ ok: true });
  assert.equal(await one, true); assert.equal(f.count('/api/live_stop'), 1);
});

test('native detach completes after cancellation and before the stop request', async () => {
  const detached = deferred(), f = setup({ beforeStop: () => detached.promise });
  await f.controller.start();
  const stop = f.controller.stop(); await tick();
  assert.equal(f.controller.state.phase, 'stopping'); assert.equal(f.count('/api/live_stop'), 0);
  detached.resolve(); assert.equal(await stop, true); assert.equal(f.count('/api/live_stop'), 1);
});

test('an embedded Stop first only asks the game to close; one still open is handed back, then closed from outside', async () => {
  const handed = [], bodies = f => f.requests.filter(r => r.url === '/api/live_stop').map(r => r.body);
  // it closes by itself, still in the panel: one request, nothing handed back
  const f = setup({ beforeForce: async () => { handed.push(f.count('/api/live_stop')); } });
  await f.controller.start('embedded'); f.setSession(running()); await f.timer();
  f.handlers.set('/api/live_stop', () => { f.setSession(closed()); return { ok: true, session: closed() }; });
  assert.equal(await f.controller.stop(), true);
  assert.deepEqual(bodies(f), [{ token: 'game-a', force: false }]);
  assert.deepEqual(handed, []);
  // still open after the ask: handed back (beforeForce) between the ask and the Stop that may close it from outside
  const g = setup({ beforeForce: async () => { handed.push(g.count('/api/live_stop')); } });
  await g.controller.start('embedded'); g.setSession(running()); await g.timer();
  g.handlers.set('/api/live_stop', (_url, body) => {
    if (body.force === false) return { ok: true, answer: 'The game was asked to close and is still open.', session: running() };
    g.setSession(closed()); return { ok: true, session: closed() };
  });
  assert.equal(await g.controller.stop(), true);
  assert.deepEqual(bodies(g), [{ token: 'game-a', force: false }, { token: 'game-a' }]);
  assert.deepEqual(handed, [1]);
  assert.equal(g.controller.active, false);
  // in the game window, or a game already being closed: one Stop, as before
  for (const [mode, answer] of [['external', closed()], ['embedded', { ...running(), stopping: true }]]) {
    const h = setup({ beforeForce: async () => { handed.push(mode); } });
    await h.controller.start(mode); h.setSession(running()); await h.timer();
    h.handlers.set('/api/live_stop', () => { h.setSession(closed()); return { ok: true, session: answer }; });
    assert.equal(await h.controller.stop(), true);
    assert.deepEqual(bodies(h), [mode === 'external' ? { token: 'game-a' } : { token: 'game-a', force: false }], mode);
  }
  assert.deepEqual(handed, [1]);
});

test('an embedded Stop of a game that can no longer answer (askFirst false) is sent at once, with no hand-back', async () => {
  const handed = [];
  const f = setup({ askFirst: () => false, beforeForce: async () => { handed.push('detach'); } });
  await f.controller.start('embedded'); f.setSession(running()); await f.timer();
  assert.equal(await f.controller.stop(), true);
  assert.deepEqual(f.requests.filter(r => r.url === '/api/live_stop').map(r => r.body), [{ token: 'game-a', ask: false }]);
  assert.deepEqual(handed, []);
});

test('failed preparation does not stop a game belonging to another Play request', async () => {
  const f = setup(); f.setSession({ ...running(), token: 'other-game' });
  f.handlers.set('/api/play_prepare', () => { throw new Error('A game is already running'); });
  assert.equal(await f.controller.start(), false);
  assert.equal(f.count('/api/live_stop'), 0); assert.equal(f.controller.active, false);
});

test('reload recovers a running owned game without an open map or relaunching it', async () => {
  const f = setup(); f.setScript(null); f.setSession(running());
  assert.equal(await f.controller.resume(), true);
  assert.equal(f.controller.state.mode, 'external'); assert.equal(f.controller.state.phase, 'running');
  assert.equal(f.count('/api/play_prepare'), 0); assert.equal(f.count('/api/play'), 0);
  assert.equal(f.count('/api/live_stop'), 0, 'Recovery must not stop the game automatically');
  assert.equal(await f.controller.stop(), true);
  assert.deepEqual(f.requests.find(r => r.url === '/api/live_stop').body, { token: 'game-a' });
});

test('reload recovers a delayed launch and follows its eventual natural exit', async () => {
  const f = setup({ resolveResumeMode: async () => 'embedded' }); f.setSession(launching());
  assert.equal(await f.controller.resume(), true); assert.equal(f.controller.state.phase, 'launching');
  assert.equal(f.controller.state.mode, 'embedded');
  f.setSession(running()); await f.timer(); assert.equal(f.controller.state.phase, 'running');
  f.setSession(closed()); await f.timer(); assert.equal(f.controller.active, false);
  assert.equal(f.timers.size, 0); assert.equal(f.count('/api/live_stop'), 0);
});

test('reload preserves startup or cleanup errors until the user retries Stop', async () => {
  const f = setup(); f.setSession(closed('Game startup failed'));
  assert.equal(await f.controller.resume(), true); assert.equal(f.controller.state.phase, 'error');
  assert.match(f.controller.state.error, /startup failed/); assert.equal(f.count('/api/live_stop'), 0);
  assert.equal(await f.controller.stop(), true); assert.equal(f.controller.active, false);
});

test('reload recovers a prepared preview and cancels only its exact token', async () => {
  const f = setup(); f.setScript(null);
  f.setSession({ ...closed(), token: null, prepared: true, previewToken: 'prepared-before-reload' });
  assert.equal(await f.controller.resume(), true); assert.equal(f.controller.state.phase, 'prepared');
  assert.equal(f.count('/api/play'), 0); assert.equal(f.timers.size, 0);
  assert.equal(await f.controller.stop(), true);
  assert.deepEqual(f.requests.find(r => r.url === '/api/live_stop').body, { previewToken: 'prepared-before-reload' });
});

test('resumed preparation cannot stop a game launched by a later request', async () => {
  const f = setup(); f.setSession({ ...closed(), prepared: true, previewToken: 'prepared-before-reload' });
  await f.controller.resume(); f.setSession(running());
  assert.equal(await f.controller.stop(), false); assert.equal(f.count('/api/live_stop'), 0);
  assert.match(f.controller.state.error, /replacement/); assert.equal(f.timers.size, 0);
});

test('prepared cancellation is still token-protected if a launch races the Stop request', async () => {
  const f = setup(); f.setSession({ ...closed(), prepared: true, previewToken: 'prepared-before-reload' });
  await f.controller.resume();
  f.handlers.set('/api/live_stop', (_url, body) => {
    assert.deepEqual(body, { previewToken: 'prepared-before-reload' });
    f.setSession(running()); return { ok: false, error: 'Preview is stale; a game has started' };
  });
  assert.equal(await f.controller.stop(), false); assert.equal(f.controller.active, true);
  await f.timer(); assert.equal(f.controller.active, false); assert.match(f.controller.state.error, /replacement/);
  assert.equal(f.count('/api/live_stop'), 1);
});

test('late recovery response cannot replace a fresh Play session', async () => {
  const recovered = deferred(), f = setup();
  f.handlers.set('/api/play_session', () => recovered.promise);
  const resume = f.controller.resume('external');
  assert.equal(await f.controller.start('embedded'), true);
  recovered.resolve({ ...running(), token: 'previous-game' });
  assert.equal(await resume, false); assert.equal(f.controller.state.mode, 'embedded');
  assert.equal(f.controller.state.session.token, 'game-a'); assert.equal(f.count('/api/live_stop'), 0);
  f.controller.dispose();
});

test('Stop or disposal invalidates recovery while native status is pending', async () => {
  for (const cancel of ['stop', 'dispose']) {
    const mode = deferred(), f = setup({ resolveResumeMode: () => mode.promise }); f.setSession(running());
    const resume = f.controller.resume(); await tick();
    await f.controller[cancel](); mode.resolve('embedded');
    assert.equal(await resume, false); assert.equal(f.controller.active, false);
    assert.equal(f.count('/api/live_stop'), 0); assert.equal(f.timers.size, 0);
  }
});

test('recovery ignores closed sessions and sessions without an ownership token', async () => {
  for (const session of [closed(), { ...running(), token: null }, { ...closed(), prepared: true }]) {
    const f = setup(); f.setSession(session);
    assert.equal(await f.controller.resume(), false); assert.equal(f.controller.active, false);
    assert.equal(f.timers.size, 0); assert.equal(f.count('/api/live_stop'), 0);
  }
});

// The Game view's header (createGameView) on a stand-in page: its parts made when first asked for, the header's
// buttons read from its markup; the globals it needs are put back after
function gamePage() {
  class Part {
    constructor(tag = 'div') { Object.assign(this, { tagName: tag.toUpperCase(), dataset: {}, attrs: {}, on: {}, style: {}, hidden: false, disabled: false, textContent: '' }); this.parts = new Map(); }
    set innerHTML(html) { this.html = html; this.parts.clear(); }
    get innerHTML() { return this.html || ''; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(type, fn) { this.on[type] = fn; }
    closest(sel) { return (sel === '[data-control]' && this.dataset.control) || (sel === '[data-game]' && this.dataset.game) ? this : null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 400 }; }
    remove() {}
    querySelectorAll(sel) {
      if (!this.parts.has(sel)) {
        const kind = sel === '[data-control]' ? 'control' : /^\[data-game="(\w+)"\]$/.exec(sel)?.[1];
        const ids = kind === 'control' ? [...this.innerHTML.matchAll(/data-control="([^"]+)"/g)].map((m) => m[1]) : [kind || sel];
        this.parts.set(sel, ids.map((id) => Object.assign(new Part('button'), { dataset: kind === 'control' ? { control: id } : kind ? { game: id } : {} })));
      }
      return this.parts.get(sel);
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0]; }
  }
  const saved = Object.fromEntries(['document', 'ResizeObserver', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']
    .map((k) => [k, globalThis[k]]));
  const savedWindow = { ...window };
  class Observer { observe() {} disconnect() {} }
  Object.assign(globalThis, { document: { createElement: (tag) => new Part(tag), body: { append() {} }, hidden: false, querySelectorAll: () => [],
    documentElement: { classList: { toggle() {}, remove() {} } }, addEventListener() {}, removeEventListener() {} },
    ResizeObserver: Observer, MutationObserver: Observer, requestAnimationFrame: (fn) => setTimeout(fn), cancelAnimationFrame: clearTimeout,
    getComputedStyle: () => ({ display: 'block' }) });
  Object.assign(window, { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, devicePixelRatio: 1 });
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
    for (const k of Object.keys(window)) delete window[k];
    Object.assign(window, savedWindow);
  };
  return { Part, restore };
}

test('the header\'s Pause, Slow motion, Ghost and God: a command each way, pressed as the game has it, waiting outside running', async () => {
  const { Part, restore } = gamePage();
  let session = closed(), answer = true, reply = null, panel = null;
  const sent = [], statuses = [];
  const api = async (url) => {
    const path = url.split('?')[0];
    if (path === '/api/play_prepare') return { ok: true, token: 'prepared-copy' };
    if (path === '/api/play') { session = running(); return { ok: true, session }; }
    if (path === '/api/play_session') return { ...session };
    if (path === '/api/live_stop') { session = closed(); return { ok: true }; }
    throw new Error('Unexpected endpoint: ' + url);
  };
  const append = document.body.append;
  document.body.append = (el) => { panel = el; };
  const view = createGameView({ api, getScript: () => 'room', getSession: () => 's', getStart: () => ({}), save: async () => true,
    status: (text, kind) => statuses.push([text, kind]), viewport: new Part('section'), controls: PLAY_CONTROLS,
    sendCommand: (command) => { sent.push(command); return reply ? reply.promise : answer; } });
  document.body.append = append;
  try {
    const buttons = () => Object.fromEntries(panel.querySelectorAll('[data-control]').map((b) => [b.dataset.control, b]));
    const pressed = () => Object.fromEntries(Object.entries(buttons()).map(([id, b]) => [id, b.getAttribute('aria-pressed')]));
    const click = async (id) => { panel.on.click({ target: buttons()[id] }); await tick(); };
    assert.deepEqual(Object.keys(buttons()), ['pause', 'slomo', 'ghost', 'god']);
    const starting = view.start('external', {}, pressedAtStart({ cheat: 'god' }));
    assert.ok(Object.values(buttons()).every((b) => b.disabled), 'preparing: the buttons wait for the game');
    await click('pause');
    assert.deepEqual(sent, [], 'nothing is sent before the game runs');
    assert.equal(await starting, true);
    assert.equal(view.state.phase, 'running');
    assert.ok(Object.values(buttons()).every((b) => !b.disabled));
    assert.deepEqual(pressed(), { pause: 'false', slomo: 'false', ghost: 'false', god: 'true' }, 'God starts pressed: the scenario gives it');
    // each button: its command on, then its command off
    for (const c of PLAY_CONTROLS) {
      const before = pressed()[c.id] === 'true';
      await click(c.id);
      await click(c.id);
      assert.deepEqual(sent.slice(-2), before ? [c.off, c.on] : [c.on, c.off], c.id);
      assert.equal(pressed()[c.id], String(before), c.id);
    }
    assert.deepEqual(sent, ['pause', 'pause', 'slomo 0.25', 'slomo 1', 'ghost', 'walk', 'god', 'god']);
    // a command on its way: every button waits, a second click is not sent
    let resolve;
    reply = { promise: new Promise((r) => { resolve = r; }) };
    panel.on.click({ target: buttons().slomo });
    assert.ok(Object.values(buttons()).every((b) => b.disabled));
    await click('ghost');
    assert.deepEqual(sent.slice(-1), ['slomo 0.25']);
    resolve(true); reply = null; await tick();
    assert.equal(pressed().slomo, 'true');
    assert.ok(Object.values(buttons()).every((b) => !b.disabled));
    // the game not taking it: the button stays as it was, and the status says so
    answer = false;
    await click('ghost');
    assert.equal(pressed().ghost, 'false');
    assert.deepEqual(statuses.at(-1), ['The game did not take the command: wait until it has loaded the map, then try again.', 'warn']);
    assert.deepEqual(view.state.pressed, { god: true, pause: false, slomo: true, ghost: false });
    answer = true;
    // stopping: the buttons wait again
    const stopping = view.stop();
    assert.ok(Object.values(buttons()).every((b) => b.disabled));
    const count = sent.length;
    await click('pause');
    assert.equal(sent.length, count);
    await stopping;
    assert.equal(view.active, false);
  } finally { view.dispose(); restore(); }
});

// The desktop app's bridge (window.pywebview.api) answering as the launcher does, and the editor's API with one game
// (token game-a): `native` is the launcher's state (attached, windowMode, error; stillOpen: an ask to close, force
// false, leaves the game open); `events` the bridge's calls by name ('hide': a resize that hides the panel; 'cover' /
// 'uncover': game_cover asked with true / false) and the live_stop requests with their bodies, in order.
function playStandIn() {
  const events = [], native = { attached: false, windowMode: '', error: '', stillOpen: false };
  let session = closed();
  const answer = name => {
    events.push(name);
    return { supported: true, captured: false, pid: 123, attached: native.attached, windowMode: native.windowMode, error: native.error };
  };
  window.pywebview = { api: {
    game_capabilities: async () => ({ supported: true }),
    game_embed: async () => { native.attached = !native.windowMode; return answer('embed'); },
    game_resize: async placement => answer(placement.visible ? 'resize' : 'hide'),
    game_status: async () => answer('status'),
    game_release: async () => answer('release'),
    game_detach: async () => { Object.assign(native, { attached: false, windowMode: '', error: '' }); return answer('detach'); },
    game_cover: async on => { events.push(on === true ? 'cover' : on === false ? 'uncover' : 'cover ' + JSON.stringify(on));
      return { covered: on === true, error: '' }; },
  } };
  const api = async (url, body) => {
    const path = url.split('?')[0];
    if (path === '/api/play_prepare') return { ok: true, token: 'prepared-copy' };
    if (path === '/api/play') { session = running(); return { ok: true, session }; }
    if (path === '/api/play_session') return { ...session };
    if (path === '/api/live_stop') {
      events.push('live_stop ' + JSON.stringify(body));
      // closed (in the panel when it was asked there): the launcher's own tick lets the window go
      if (!(body.force === false && native.stillOpen)) { session = closed(); native.attached = false; }
      return { ok: true, session: { ...session } };
    }
    throw new Error('Unexpected endpoint: ' + url);
  };
  return { events, native, api };
}
function gameViewOn(Part, api, statuses, options = {}) {
  let panel = null;
  const append = document.body.append;
  document.body.append = (el) => { panel = el; };
  const view = createGameView({ api, getScript: () => 'room', getSession: () => 's', getStart: () => ({}), save: async () => true,
    status: (text, kind) => statuses.push([text, kind]), viewport: new Part('section'), ...options });
  document.body.append = append;
  return { view, panel };
}
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };
// the launcher's error of a game whose window closed while it ran on (native_play.py WINDOW_ERRORS['crashed'])
const CRASHED = 'The game stopped with an error: its window closed while the game ran on. Its error box or log says why '
  + '(full screen turned on inside the editor is one cause). Stop Play, then play again.';
// the launcher's error of a game window whose game kept restyling it in the panel (native_play.py WINDOW_ERRORS['unsettled'])
const UNSETTLED = 'The game keeps changing its window inside the editor, so the editor cannot show it. Play it in its '
  + 'own window, or Stop Play.';
const nativePoll = () => new Promise(resolve => setTimeout(resolve, 600));     // the Game view's 0.5 s native timer

test('an embedded Stop: the game closes inside the panel with nothing detached before, or is detached once it stays open', async () => {
  const { Part, restore } = gamePage();
  const { events, native, api } = playStandIn();
  const { view } = gameViewOn(Part, api, []);
  try {
    assert.equal(await view.start('embedded'), true); await settle();
    assert.equal(view.state.attached, true);
    assert.equal(await view.stop(), true); await settle();
    const asked = events.indexOf('live_stop {"token":"game-a","force":false}');
    assert.ok(asked > 0, events.join(', '));
    assert.ok(events.slice(0, asked).includes('release'), events.join(', '));
    assert.ok(!events.slice(0, asked).includes('detach'), 'nothing detached before the game ended: ' + events.join(', '));
    assert.ok(!events.slice(0, asked).includes('hide'), 'the game stays shown while it closes: ' + events.join(', '));
    assert.equal(events.filter(e => e.startsWith('live_stop')).length, 1);
    assert.equal(view.active, false);
    // still open after the ask: detached between the ask and the Stop that closes it from outside
    events.length = 0; native.stillOpen = true;
    assert.equal(await view.start('embedded'), true); await settle();
    assert.equal(await view.stop(), true); await settle();
    const stops = events.map((e, i) => [e, i]).filter(([e]) => e.startsWith('live_stop'));
    assert.deepEqual(stops.map(([e]) => e), ['live_stop {"token":"game-a","force":false}', 'live_stop {"token":"game-a"}']);
    const detached = events.indexOf('detach');
    assert.ok(stops[0][1] < detached && detached < stops[1][1], events.join(', '));
    assert.equal(view.active, false);
  } finally { view.dispose(); restore(); }
});

test('a game window the launcher left alone: said in plain words, never detached, only safe actions offered', async () => {
  const { Part, restore } = gamePage();
  const { events, native, api } = playStandIn();
  const statuses = [];
  const { view, panel } = gameViewOn(Part, api, statuses);
  const message = panel.querySelector('.game-view-message'), actions = message.querySelector('.game-view-actions');
  const offered = () => ['retry', 'external', 'stop'].filter(name => !actions.querySelector(`[data-game="${name}"]`).hidden);
  try {
    // it opened in full screen: never in the panel
    Object.assign(native, { windowMode: 'fullscreen', error: 'The game is in full screen, which the editor cannot show.' });
    assert.equal(await view.start('embedded'), true); await settle();
    assert.equal(view.state.attached, false);
    assert.equal(message.querySelector('strong').textContent, 'The game opened in full screen');
    assert.match(view.state.attachmentError, /Alt\+Enter.*Retry embedding.*Continue in game window/);
    assert.ok(statuses.some(([text, kind]) => text === view.state.attachmentError && kind === 'bad'));
    assert.equal(actions.hidden, false);
    assert.deepEqual(offered(), ['retry', 'external', 'stop']);
    // made windowed in the game (Alt+Enter): Retry embedding takes it in
    Object.assign(native, { windowMode: '', error: '' });
    panel.on.click({ target: actions.querySelector('[data-game="retry"]') }); await settle();
    assert.equal(view.state.attached, true);
    assert.equal(view.state.attachmentError, '');
    // then it minimizes itself in the panel: the panel hides to show why, only Stop is offered, still attached
    Object.assign(native, { windowMode: 'minimized', error: 'The game window is minimized.' });
    events.length = 0;
    await nativePoll(); await settle();
    assert.equal(message.querySelector('strong').textContent, 'The game window was minimized');
    assert.match(view.state.attachmentError, /Choose Stop/);
    assert.deepEqual(offered(), ['stop']);
    assert.equal(view.state.attached, true);
    assert.ok(events.includes('hide'), events.join(', '));
    assert.ok(!events.includes('detach'), events.join(', '));
    // Stop asks it to close where it is
    assert.equal(await view.stop(), true); await settle();
    const asked = events.indexOf('live_stop {"token":"game-a","force":false}');
    assert.ok(asked >= 0 && !events.slice(0, asked).includes('detach'), events.join(', '));
    assert.equal(view.active, false);
  } finally { view.dispose(); restore(); }
});

test('a game that Retry embedding cannot show after full screen: Continue in game window and Stop only, and it says why', async () => {
  // D6 of the game test (29 Oct 2026): the original game, switched to a window after it opened full screen, never showed
  // once Retry embedding took it in; the launcher says so of the game (retryFromFullScreen false, its GAMES)
  const { Part, restore } = gamePage();
  const { events, native, api } = playStandIn();
  const { view, panel } = gameViewOn(Part, api, []);
  const message = panel.querySelector('.game-view-message'), actions = message.querySelector('.game-view-actions');
  const offered = () => ['retry', 'external', 'stop'].filter(name => !actions.querySelector(`[data-game="${name}"]`).hidden);
  const embed = window.pywebview.api.game_embed;
  window.pywebview.api.game_embed = async () => ({ ...await embed(), retryFromFullScreen: false });
  try {
    Object.assign(native, { windowMode: 'fullscreen', error: 'The game is in full screen, which the editor cannot show.' });
    assert.equal(await view.start('embedded'), true); await settle();
    await nativePoll(); await settle();                                         // reported again: the same message
    assert.equal(view.state.attached, false);
    assert.equal(message.querySelector('strong').textContent, 'The game opened in full screen');
    assert.match(view.state.attachmentError, /once it has opened in full screen, not even after you switch it to a window\. Choose Continue in game window/);
    assert.doesNotMatch(view.state.attachmentError, /Retry/);
    assert.deepEqual(offered(), ['external', 'stop']);
    // Continue in game window: it plays on in its own window, nothing stopped
    panel.on.click({ target: actions.querySelector('[data-game="external"]') }); await settle();
    assert.equal(view.state.mode, 'external');
    assert.equal(view.active, true);
    assert.ok(!events.some(e => e.startsWith('live_stop')), events.join(', '));
  } finally { view.dispose(); restore(); }
});

test('a game that keeps changing its window in the panel: said in plain words, Continue in game window or Stop', async () => {
  // D6 of the game test (29 Oct 2026): the launcher stops repairing a window whose game keeps putting its frame back and
  // reports it, still attached (windowMode unsettled); its console still runs
  const { Part, restore } = gamePage();
  const { events, native, api } = playStandIn();
  const { view, panel } = gameViewOn(Part, api, []);
  const message = panel.querySelector('.game-view-message'), actions = message.querySelector('.game-view-actions');
  const offered = () => ['retry', 'external', 'stop'].filter(name => !actions.querySelector(`[data-game="${name}"]`).hidden);
  try {
    for (const choice of ['stop', 'external']) {
      Object.assign(native, { windowMode: '', error: '' });
      assert.equal(await view.start('embedded'), true); await settle();
      assert.equal(view.state.attached, true, choice);
      Object.assign(native, { windowMode: 'unsettled', error: UNSETTLED });
      events.length = 0;
      await nativePoll(); await settle();
      assert.equal(message.querySelector('strong').textContent, 'The game keeps changing its window', choice);
      assert.match(view.state.attachmentError, /keeps changing its window inside the editor.*Continue in game window.*Stop/);
      assert.deepEqual(offered(), ['external', 'stop'], choice);
      assert.equal(view.state.attached, true, choice);
      assert.ok(events.includes('hide') && !events.includes('detach'), choice + ': ' + events.join(', '));
      panel.on.click({ target: actions.querySelector(`[data-game="${choice}"]`) }); await settle();
      if (choice === 'stop') {
        // asked to close where it is, as every window left alone
        const asked = events.indexOf('live_stop {"token":"game-a","force":false}');
        assert.ok(asked >= 0 && !events.slice(0, asked).includes('detach'), events.join(', '));
        assert.equal(view.active, false);
      } else {
        // handed back (detach), then it plays on in its own window
        assert.equal(view.state.mode, 'external');
        assert.ok(events.includes('detach'), events.join(', '));
        assert.ok(!events.some(e => e.startsWith('live_stop')), events.join(', '));
      }
    }
  } finally { view.dispose(); restore(); }
});

test('Continue in game window asks the launcher to bring the game window to the front, and no other detach does', async () => {
  // review su3 #5 (31 Oct 2026): a game window never taken into the panel (here an attach that failed) stayed under
  // the editor's window after Continue in game window, and its player had to find it with Alt+Tab
  const { Part, restore } = gamePage();
  const { api } = playStandIn();
  const { view, panel } = gameViewOn(Part, api, []);
  const actions = panel.querySelector('.game-view-actions');
  const detaches = [], detach = window.pywebview.api.game_detach, embed = window.pywebview.api.game_embed;
  window.pywebview.api.game_detach = async (...args) => { detaches.push(args); return await detach(); };
  window.pywebview.api.game_embed = async () => ({ ...await embed(), attached: false, pending: false });
  try {
    assert.equal(await view.start('embedded'), true); await settle();
    assert.match(view.state.attachmentError, /could not be attached\. Retry, continue in the game window/);
    assert.deepEqual(detaches, [[]], 'the detach of the error brings nothing to the front');
    panel.on.click({ target: actions.querySelector('[data-game="external"]') }); await settle();
    assert.equal(view.state.mode, 'external');
    assert.deepEqual(detaches[1], [true], JSON.stringify(detaches));
    assert.ok(detaches.slice(2).every(args => args.length === 0), JSON.stringify(detaches));
  } finally { view.dispose(); restore(); }
});

test('a launcher error while an embedded Stop waits never detaches the closing game', async () => {
  // review 2b #10 (G4): one failed answer during the ask would hand the closing game back, flash and all
  const { Part, restore } = gamePage();
  const stand = playStandIn();
  const { events, native } = stand;
  let closes;
  const closing = new Promise(resolve => { closes = resolve; });
  const api = async (url, body) => {
    if (url.split('?')[0] === '/api/live_stop' && body?.force === false) await closing;     // the game takes its time
    return stand.api(url, body);
  };
  const { view } = gameViewOn(Part, api, []);
  try {
    assert.equal(await view.start('embedded'), true); await settle();
    assert.equal(view.state.attached, true);
    events.length = 0;
    const stopping = view.stop();
    await settle();
    native.error = 'Game panel: a status call failed';                          // a tick failed while it closes
    await nativePoll(); await settle();
    native.error = '';
    closes();
    assert.equal(await stopping, true); await settle();
    const asked = events.indexOf('live_stop {"token":"game-a","force":false}');
    assert.ok(asked >= 0, events.join(', '));
    assert.ok(!events.slice(0, asked).includes('detach'), 'detached while it was closing: ' + events.join(', '));
  } finally { view.dispose(); restore(); }
});

test('a reload with a window left alone in the panel resumes embedded, so that its Stop closes it there', async () => {
  // review 2b #10 (G5)
  const { Part, restore } = gamePage();
  const stand = playStandIn();
  const { events, native } = stand;
  const api = async (url, body) => url.split('?')[0] === '/api/play_session' ? { ...running() } : stand.api(url, body);
  Object.assign(native, { attached: true, windowMode: 'minimized', error: 'The game window is minimized and cannot be shown in the editor again.' });
  const { view } = gameViewOn(Part, api, []);
  try {
    assert.equal(await view.resume(), true); await settle();
    assert.equal(view.state.mode, 'embedded', events.join(', '));
    assert.ok(!events.includes('detach'), events.join(', '));
  } finally { view.dispose(); restore(); }
});

test('releasing the mouse of a window left alone is no failure', async () => {
  // review 2b #10 (G6): the header's Release mouse, or Shift+F1
  const { Part, restore } = gamePage();
  const { native, api } = playStandIn();
  const statuses = [];
  const { view } = gameViewOn(Part, api, statuses);
  try {
    assert.equal(await view.start('embedded'), true); await settle();
    Object.assign(native, { windowMode: 'minimized', error: 'The game window is minimized and cannot be shown in the editor again.' });
    statuses.length = 0;
    assert.equal(await view.release(), true);
    assert.ok(!statuses.some(([text]) => text === native.error), JSON.stringify(statuses));
  } finally { view.dispose(); restore(); }
});

test('Alt+Enter in the game in the panel: it goes on in its own window and is asked there for full screen', async () => {
  // the launcher keeps the key from the game (full screen in the panel ends it with a D3D error, game test
  // 29 Oct 2026) and says so (windowMode fullscreenAsked); the console command goes once it is out of the panel
  const { Part, restore } = gamePage();
  const { events, native, api } = playStandIn();
  const sendCommand = async command => { events.push('command ' + command); return true; };
  const { view } = gameViewOn(Part, api, [], { sendCommand });
  try {
    assert.equal(await view.start('embedded'), true); await settle();
    assert.equal(view.state.attached, true);
    events.length = 0;
    native.windowMode = 'fullscreenAsked';
    await nativePoll(); await settle();
    assert.equal(view.state.mode, 'external');
    const detached = events.indexOf('detach'), asked = events.indexOf('command ToggleFullscreen');
    assert.ok(detached >= 0 && detached < asked, events.join(', '));
    assert.equal(events.filter(e => e === 'command ToggleFullscreen').length, 1, events.join(', '));
    assert.ok(!events.some(e => e.startsWith('live_stop')), events.join(', '));
    assert.equal(view.active, true);
    // its Stop is then the game window's: one request, as for every Play in its own window
    assert.equal(await view.stop(), true);
    assert.deepEqual(events.filter(e => e.startsWith('live_stop')), ['live_stop {"token":"game-a"}']);
  } finally { view.dispose(); restore(); }
});

test('Alt+Enter while an embedded Stop waits: the closing game stays in the panel and is asked nothing', async () => {
  // review 2c #9: the move to its own window and ToggleFullscreen are for a game that runs; one being asked to close in
  // the panel would flash out of it, and its console no longer takes commands
  const { Part, restore } = gamePage();
  const stand = playStandIn();
  const { events, native } = stand;
  let closes;
  const closing = new Promise(resolve => { closes = resolve; });
  const api = async (url, body) => {
    if (url.split('?')[0] === '/api/live_stop' && body?.force === false) await closing;     // the game takes its time
    return stand.api(url, body);
  };
  const sendCommand = async command => { events.push('command ' + command); return true; };
  const { view } = gameViewOn(Part, api, [], { sendCommand });
  try {
    assert.equal(await view.start('embedded'), true); await settle();
    assert.equal(view.state.attached, true);
    events.length = 0;
    const stopping = view.stop();
    await settle();
    native.windowMode = 'fullscreenAsked';                                      // the player's Alt+Enter, reported
    await nativePoll(); await settle();
    assert.ok(events.includes('status'), 'still polled while it closes: ' + events.join(', '));
    native.windowMode = '';
    closes();
    assert.equal(await stopping, true); await settle();
    const asked = events.indexOf('live_stop {"token":"game-a","force":false}');
    assert.ok(asked >= 0, events.join(', '));
    assert.ok(!events.slice(0, asked).includes('detach'), 'moved out while it was closing: ' + events.join(', '));
    assert.ok(!events.includes('command ToggleFullscreen'), events.join(', '));
  } finally { view.dispose(); restore(); }
});

test('a game that does not take full screen in its own window: the status says to press Alt+Enter there', async () => {
  // review 2c #9: moved out of the panel after the player's Alt+Enter, then ToggleFullscreen refused
  const { Part, restore } = gamePage();
  const { events, native, api } = playStandIn();
  const statuses = [];
  const sendCommand = async command => { events.push('command ' + command); return false; };
  const { view } = gameViewOn(Part, api, statuses, { sendCommand });
  try {
    assert.equal(await view.start('embedded'), true); await settle();
    native.windowMode = 'fullscreenAsked';
    await nativePoll(); await settle();
    assert.equal(view.state.mode, 'external');
    assert.ok(events.includes('command ToggleFullscreen'), events.join(', '));
    assert.ok(statuses.some(([text, kind]) =>
      text === 'The game did not take full screen: press Alt+Enter in its window.' && kind === 'warn'), JSON.stringify(statuses));
  } finally { view.dispose(); restore(); }
});

test('a game whose window closed with an error: said so, only Stop offered, and that Stop does not ask it first', async () => {
  // full screen turned on in the panel by the game's video settings (c3, c7c of the game test, 29 Oct 2026): its window
  // is gone, its error box is up, its console no longer runs
  const { Part, restore } = gamePage();
  const { events, native, api } = playStandIn();
  const { view, panel } = gameViewOn(Part, api, []);
  const message = panel.querySelector('.game-view-message'), actions = message.querySelector('.game-view-actions');
  const offered = () => ['retry', 'external', 'stop'].filter(name => !actions.querySelector(`[data-game="${name}"]`).hidden);
  try {
    assert.equal(await view.start('embedded'), true); await settle();
    Object.assign(native, { attached: false, windowMode: 'crashed', stillOpen: true, error: CRASHED });
    events.length = 0;
    await nativePoll(); await settle();
    assert.equal(message.querySelector('strong').textContent, 'The game stopped with an error');
    // worded by what was seen (review 2c #12): any critical error of the game looks so; full screen is one cause
    assert.match(view.state.attachmentError, /window closed while the game ran on\. Full screen .* any critical error/);
    assert.deepEqual(offered(), ['stop']);
    const embeds = events.filter(e => e === 'embed').length;
    await nativePoll(); await settle();
    assert.equal(events.filter(e => e === 'embed').length, embeds, 'no longer waiting for its window: ' + events.join(', '));
    assert.equal(await view.stop(), true); await settle();
    assert.deepEqual(events.filter(e => e.startsWith('live_stop')), ['live_stop {"token":"game-a","ask":false}']);
    assert.equal(view.active, false);
  } finally { view.dispose(); restore(); }
});

test('a game window gone from the panel with no report is looked for again, not shown as an attach failure', async () => {
  // review 2c #3: a launcher tick that raced the vanishing window left its error on the next answers (attached false, no
  // windowMode), and game_resize answers so once the tick has let the window go; the next embed says what became of it
  const crashed = { supported: true, captured: false, pid: 123, attached: false, pending: false, windowMode: 'crashed', error: CRASHED };
  for (const via of ['status', 'resize']) {
    const { Part, restore } = gamePage();
    const { events, native, api } = playStandIn();
    const { view, panel } = gameViewOn(Part, api, []);
    const title = panel.querySelector('.game-view-message').querySelector('strong');
    try {
      assert.equal(await view.start('embedded'), true); await settle();
      assert.equal(view.state.attached, true, via);
      await nativePoll(); await settle();                                       // its placement sent (game_resize)
      const bridge = window.pywebview.api;
      bridge.game_embed = async () => { events.push('embed'); return { ...crashed }; };
      if (via === 'status') Object.assign(native, { attached: false, error: 'Game panel: [WinError 1400] Invalid window handle.' });
      else {
        bridge.game_resize = async () => { events.push('resize');
          return { supported: true, captured: false, pid: 123, attached: false, windowMode: '', error: 'The embedded Play session has ended' }; };
        window.devicePixelRatio = 2;                                            // a layout change: the next sync resizes
      }
      events.length = 0;
      await nativePoll(); await settle();
      await nativePoll(); await settle();
      assert.ok(events.includes('embed'), via + ': ' + events.join(', '));
      assert.equal(title.textContent, 'The game stopped with an error', via);
      assert.equal(await view.stop(), true);
      assert.deepEqual(events.filter(e => e.startsWith('live_stop')), ['live_stop {"token":"game-a","ask":false}'], via);
    } finally { view.dispose(); restore(); }
  }
});

test('a game window lost after more than 5 minutes in the panel is still looked for, not shown as an attach failure', async () => {
  // review 2d #3: lost() starts the 5-minute attach limit again; counted from the Play's first embed, the next embed of
  // a long Play (pending: no error box yet, GONE_WAIT not over) was an attach failure and the crashed report never came
  const { Part, restore } = gamePage();
  const { events, native, api } = playStandIn();
  const { view } = gameViewOn(Part, api, []);
  const realNow = Date.now;
  try {
    assert.equal(await view.start('embedded'), true); await settle();
    assert.equal(view.state.attached, true);
    await nativePoll(); await settle();                                         // its placement sent (game_resize)
    Date.now = () => realNow() + 6 * 60 * 1000;                                 // six minutes of play
    window.pywebview.api.game_embed = async () => { events.push('embed');
      return { supported: true, captured: false, pid: 123, attached: false, pending: true, windowMode: '', error: '' }; };
    native.attached = false;                                                    // the tick let the gone window go
    events.length = 0;
    await nativePoll(); await settle();
    await nativePoll(); await settle();
    assert.ok(events.includes('embed'), events.join(', '));
    assert.equal(view.state.attachmentError, '');
  } finally { Date.now = realNow; view.dispose(); restore(); }
});

// the cover's calls among a Play's events, with the embeds (the launch, /api/play, is logged as 'play')
const covers = events => events.filter(e => /^(cover|uncover|embed)/.test(e));
const launchLogged = (events, api) => async (url, body) => {
  if (url.split('?')[0] === '/api/play') events.push('play');
  return api(url, body);
};

test('an embedded Play asks for the cover at its launch, before its first embed, and lets it go once the game is in the panel', async () => {
  // the start-up investigation (29 Oct 2026): the game's splash and its window, white until its first frame, showed
  // until the window was in the panel; kept above them, the app's window hides them (S6b)
  const { Part, restore } = gamePage();
  const { events, api } = playStandIn();
  const { view } = gameViewOn(Part, launchLogged(events, api), []);
  try {
    assert.equal(await view.start('embedded'), true); await settle();
    assert.equal(view.state.attached, true);
    assert.deepEqual(covers(events), ['cover', 'embed', 'uncover']);
    assert.ok(events.includes('play'), events.join(', '));
    await nativePoll(); await settle();
    assert.equal(await view.stop(), true); await settle();
    assert.deepEqual(covers(events), ['cover', 'embed', 'uncover'], 'once a Play');
    events.length = 0;
    assert.equal(await view.start('embedded'), true); await settle();
    assert.deepEqual(covers(events), ['cover', 'embed', 'uncover'], 'again for the next Play');
  } finally { view.dispose(); restore(); }
});

test('Play in game window never asks for the cover', async () => {
  const { Part, restore } = gamePage();
  const { events, api } = playStandIn();
  const { view } = gameViewOn(Part, launchLogged(events, api), []);
  try {
    assert.equal(await view.start('external'), true); await settle();
    await nativePoll(); await settle();
    assert.equal(await view.stop(), true); await settle();
    assert.deepEqual(covers(events), []);
    assert.ok(events.includes('play'), events.join(', '));
  } finally { view.dispose(); restore(); }
});

test('the cover is always let go: Stop while the game starts, its window left alone, a game that ends first, the view gone', async () => {
  const starting = { ...closed(), owned: true, launching: true };
  const ends = {
    'Stop while Steam starts the game': async (view) => { assert.equal(await view.stop(), true); },
    // the backend keeps the Stop until Steam's late process is found and closed: launching again, no cover again
    'Stop while Steam starts the game, the backend still waiting for it': async (view, stand, session) => {
      session.kept = true;
      assert.equal(await view.stop(), false);
      session.kept = false; session.now = closed(); await nativePoll(); await settle();
      assert.equal(view.active, false);
    },
    'its window left alone outside the panel': async (view, stand, session) => {
      session.now = running();
      Object.assign(stand.native, { windowMode: 'fullscreen', error: 'The game is in full screen, which the editor cannot show.' });
      await nativePoll(); await settle();
      assert.equal(view.state.attachmentError !== '', true);
    },
    'the game ended before its window showed': async (view, stand, session) => {
      session.now = closed(); await nativePoll(); await settle();
      assert.equal(view.active, false);
    },
    'the Game view gone (dispose)': async (view) => { view.dispose(); await settle(); },
  };
  for (const [name, end] of Object.entries(ends)) {
    const { Part, restore } = gamePage();
    const stand = playStandIn();
    const session = { now: starting };
    const api = async (url, body) => {
      const path = url.split('?')[0];
      if (path === '/api/play') { stand.events.push('play'); return { ok: true, session: { ...session.now } }; }
      if (path === '/api/play_session') return { ...session.now };
      if (path === '/api/live_stop') { if (!session.kept) session.now = closed(); return { ok: true, session: { ...session.now } }; }
      return stand.api(url, body);
    };
    const { view } = gameViewOn(Part, api, []);
    try {
      assert.equal(await view.start('embedded'), true); await settle();
      assert.equal(view.state.phase, 'launching', name);
      assert.deepEqual(covers(stand.events), ['cover'], name);
      await end(view, stand, session);
      assert.deepEqual(covers(stand.events).filter(e => e !== 'embed'), ['cover', 'uncover'], name + ': ' + stand.events.join(', '));
    } finally { view.dispose(); restore(); }
  }
});

test('an answer that says when the game window may be taken in is followed by an embed then, not at the next half second', async () => {
  // the launcher asks a starting game without waiting and takes its window in SETTLE after its answer (readyIn)
  const { Part, restore } = gamePage();
  const { events, native, api } = playStandIn();
  const embeds = [];
  window.pywebview.api.game_embed = async () => {
    embeds.push(Date.now()); events.push('embed');
    if (embeds.length === 1) return { supported: true, captured: false, pid: 123, attached: false, pending: true, windowMode: '', error: '', readyIn: .15 };
    native.attached = true;
    return { supported: true, captured: false, pid: 123, attached: true, windowMode: '', error: '' };
  };
  const { view } = gameViewOn(Part, api, []);
  try {
    assert.equal(await view.start('embedded'), true); await settle();
    for (let i = 0; i < 20 && !view.state.attached; i++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(view.state.attached, true);
    const gap = embeds[1] - embeds[0];
    assert.ok(gap >= 100 && gap < 400, 'the second embed ' + gap + ' ms after the first');
  } finally { view.dispose(); restore(); }
});

test('real toolbar and Game view browser integration', { skip: !process.env.DEUSEDIX_BROWSER_TEST }, async () => {
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const { writeFile } = await import('node:fs/promises');
  const require = createRequire(import.meta.url);
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  // Playwright: DEUSEDIX_PLAYWRIGHT, else where the Codex runtime keeps it in the user's home
  const { chromium } = require(process.env.DEUSEDIX_PLAYWRIGHT || join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  const root = new URL('../editor/static/', import.meta.url);
  let html = (await readFile(new URL('index.html', root), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const browser = await chromium.launch({ executablePath: process.env.DEUSEDIX_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('http://deusedix.test/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (!path.startsWith('/static/') || path.includes('..')) return route.fulfill({ status: 404, body: '' });
      try {
        const body = await readFile(new URL(path.slice(8), root));
        const contentType = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
        return route.fulfill({ contentType, body });
      } catch { return route.fulfill({ status: 404, body: '' }); }
    });
    await page.goto('http://deusedix.test/');
    await page.evaluate(async () => {
      window.__proof = { api: [], native: [], rebuilds: [], playSettings: 0, sequence: 0, pendingPrepare: false, script: 'proof_room',
        session: { owned: false, running: false, launching: false, stopping: false, token: '', error: '' },
        nativeState: { supported: true, attached: false, captured: false, pid: null, error: '' } };
      const proof = window.__proof;
      window.__projectContext = { id: 'game-view-proof', kind: 'custom', name: 'Play prototype', session: 'worker-http-token' };
      window.pywebview = { api: {
        async game_capabilities() { return { supported: true, releaseShortcut: 'Shift+F1' }; },
        async game_embed(payload) { proof.native.push(['embed', payload]); if (proof.embedError) return { supported: true, attached: false, error: proof.embedError };
          proof.nativeState = { supported: true, attached: true, captured: false, pid: proof.session.pid, error: '' }; return proof.nativeState; },
        async game_resize(payload) { proof.native.push(['resize', payload]); return proof.nativeState; },
        async game_status() { return proof.nativeState; },
        async game_release() { proof.native.push(['release']); if (proof.releaseError) throw new Error(proof.releaseError);
          proof.nativeState.captured = false; return proof.nativeState; },
        async game_detach() { proof.native.push(['detach']); if (proof.detachError) return { ...proof.nativeState, error: proof.detachError };
          proof.nativeState.attached = false; return proof.nativeState; },
      } };
      const api = async (url, body) => {
        proof.api.push([url, body]);
        if (url.startsWith('/api/play_prepare')) {
          if (proof.pendingPrepare) await new Promise(resolve => { proof.resolvePrepare = resolve; });
          return { ok: true, token: 'prepared-copy' };
        }
        if (url.startsWith('/api/play?')) {
          proof.session = { owned: true, running: true, launching: false, stopping: false, pid: 1234,
            created: '134056048549014988', token: 'play-' + (++proof.sequence), error: '' };
          return { ok: true, session: proof.session };
        }
        if (url === '/api/play_session') return { ...proof.session };
        if (url === '/api/live_stop') {
          proof.session = { ...proof.session, owned: false, running: false, launching: false, stopping: false,
            prepared: false, previewToken: null, pid: null, error: '' };
          proof.nativeState.attached = false;
          return { ok: true };
        }
        throw new Error('Unexpected API ' + url);
      };
      document.querySelector('#busy').style.display = 'none';
      document.querySelector('#startscreen').hidden = true;
      const { createGameView } = await import('/static/game-view.js');
      window.__createGameProof = () => createGameView({ api, getScript: () => proof.script, getSession: () => 'worker-http-token',
        save: async () => true, getStart: () => ({ from: 'camera' }), viewport: document.querySelector('#view'),
        status: (text, cls) => { document.querySelector('#status').textContent = text; document.querySelector('#status').className = cls || ''; } });
      window.__gameProof = window.__createGameProof();
      window.__editor = { script: 'proof_room', cam: { look: false }, SNAP: {}, surfaceTools: { mode: false }, configureAutosave() {},
        get playing() { return window.__gameProof.active; }, play: mode => window.__gameProof.start(mode),
        rebuild: mode => proof.rebuilds.push(mode), playSettings: () => proof.playSettings++ };
      document.querySelector('#playhere').onclick = () => window.__gameProof.active ? window.__gameProof.stop() : window.__gameProof.start('embedded');
      document.querySelector('#build').onclick = () => proof.rebuilds.push('auto');
      document.querySelector('#stopgame').onclick = () => window.__gameProof.stop();
      await import('/static/menubar.js');
    });
    const arrow = page.getByRole('button', { name: 'Rebuild and Play options', exact: true });
    const main = page.locator('[data-play-main]');
    const arrowBox = await arrow.boundingBox(), mainBox = await main.boundingBox();
    assert.ok(arrowBox.x < mainBox.x, 'Play dropdown belongs to the left of main Play');
    const rebuildBox = await page.locator('[data-q="build"]').boundingBox();
    assert.ok(rebuildBox.x < arrowBox.x, 'one button: Rebuild, the options, Play');
    await arrow.click();
    await page.getByRole('menuitem', { name: 'Play settings...', exact: true }).click();
    await page.waitForFunction(() => window.__proof.playSettings === 1);
    assert.equal(await page.evaluate(() => window.__proof.playSettings), 1);
    await arrow.click();
    await page.getByRole('menuitem', { name: 'Full · rebuild unchanged BSP too', exact: true }).click();
    await page.waitForFunction(() => window.__proof.rebuilds.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__proof.rebuilds), ['full']);
    await arrow.click();
    await page.getByRole('menuitem', { name: 'Play in game window', exact: true }).click();
    await page.waitForFunction(() => window.__gameProof.state.phase === 'running');
    assert.equal(await page.locator('#game-view').isVisible(), false);
    assert.match(await main.innerText(), /Stop/);
    assert.equal(await page.evaluate(() => window.__proof.native.filter(c => c[0] === 'embed').length), 0);
    await main.click(); await page.waitForFunction(() => !window.__gameProof.active);
    await main.click(); await page.waitForFunction(() => window.__gameProof.state.attached);
    assert.equal(await page.locator('#game-view').isVisible(), true);
    const geometry = await page.evaluate(() => {
      const proof = window.__proof, embed = proof.native.filter(c => c[0] === 'embed').at(-1)[1];
      const header = document.querySelector('.game-view-header').getBoundingClientRect();
      const stage = document.querySelector('.game-view-stage').getBoundingClientRect();
      return { embed, headerBottom: header.bottom, stage: { x: stage.left, y: stage.top, width: stage.width, height: stage.height } };
    });
    assert.equal(geometry.embed.session, 'worker-http-token');
    assert.ok(geometry.embed.processToken.startsWith('play-'));
    assert.ok(geometry.embed.rect.y >= geometry.headerBottom, 'Native viewport never covers Game header');
    assert.deepEqual(geometry.embed.rect, geometry.stage);
    await page.keyboard.press('Shift+F1');
    assert.ok(await page.evaluate(() => window.__proof.native.some(c => c[0] === 'release')));
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.waitForFunction(() => window.__proof.native.filter(c => c[0] === 'resize').at(-1)?.[1].visible === false);
    await page.waitForTimeout(650);
    assert.equal(await page.locator('#menubar .mb-menu.open').count(), 1, 'Status polling must leave the open menu usable');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__menubar.openSettings('general'));
    await page.waitForFunction(() => window.__proof.native.some(c => c[0] === 'resize' && c[1].visible === false));
    await page.locator('#mb-dialog .mb-close').first().click();
    await page.waitForFunction(() => window.__proof.native.filter(c => c[0] === 'resize').at(-1)?.[1].visible === true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => window.__proof.native.filter(c => c[0] === 'resize').at(-1)?.[1].rect.width === document.querySelector('.game-view-stage').getBoundingClientRect().width);
    const visibleHeader = await page.evaluate(() => {
      const header = document.querySelector('.game-view-header').getBoundingClientRect();
      const at = document.elementFromPoint(header.left + 20, header.top + header.height / 2);
      return { header: header.toJSON(), element: at?.outerHTML.slice(0, 250), panel: document.querySelector('#game-view').getBoundingClientRect().toJSON(), body: document.body.className };
    });
    assert.ok(visibleHeader.element?.includes('Game'), JSON.stringify(visibleHeader));
    await page.screenshot({ path: fileURLToPath(new URL('proofs/game-view-browser.png', import.meta.url)) });
    await main.click(); await page.waitForFunction(() => !window.__gameProof.active);
    await page.evaluate(() => { window.__proof.embedError = 'The renderer could not be embedded.'; });
    await main.click(); await page.waitForFunction(() => !!window.__gameProof.state.attachmentError);
    assert.equal(await page.getByRole('button', { name: 'Retry embedding', exact: true }).isVisible(), true);
    const failedLaunches = await page.evaluate(() => window.__proof.api.filter(c => c[0].startsWith('/api/play?')).length);
    await page.getByRole('button', { name: 'Continue in game window', exact: true }).click();
    await page.waitForFunction(() => window.__gameProof.state.mode === 'external');
    assert.equal(await page.locator('#game-view').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__proof.api.filter(c => c[0].startsWith('/api/play?')).length), failedLaunches);
    await main.click(); await page.waitForFunction(() => !window.__gameProof.active);
    await page.evaluate(() => { window.__proof.embedError = ''; });
    await page.evaluate(() => { window.__proof.pendingPrepare = true; });
    await main.click(); await page.waitForFunction(() => !!window.__proof.resolvePrepare);
    const launches = await page.evaluate(() => window.__proof.api.filter(c => c[0].startsWith('/api/play?')).length);
    await main.click();
    await page.evaluate(() => { window.__proof.pendingPrepare = false; window.__proof.resolvePrepare(); });
    await page.waitForFunction(() => !window.__gameProof.active);
    assert.equal(await page.evaluate(() => window.__proof.api.filter(c => c[0].startsWith('/api/play?')).length), launches);
    const stopCountBeforeRecovery = await page.evaluate(() => window.__proof.api.filter(c => c[0] === '/api/live_stop').length);
    await page.evaluate(async () => {
      window.__gameProof.dispose(); await new Promise(resolve => setTimeout(resolve, 0));
      const proof = window.__proof;
      proof.script = window.__editor.script = null;
      document.querySelector('#startscreen').hidden = false;
      proof.session = { owned: true, running: true, launching: false, stopping: false, pid: 1234,
        token: 'recovered-game', created: '134056048549014988', error: '' };
      proof.nativeState = { supported: true, attached: true, captured: false, pid: 1234, error: '' };
      window.__gameProof = window.__createGameProof();
      await window.__gameProof.resume();
    });
    await page.waitForFunction(() => window.__gameProof.state.attached && window.__gameProof.state.mode === 'embedded');
    assert.equal(await page.locator('#game-view').isVisible(), true);
    assert.equal(await page.locator('#startscreen').isVisible(), false, 'Start screen cannot cover the recovered Game controls');
    assert.match(await main.innerText(), /Stop/); assert.equal(await main.isEnabled(), true);
    assert.equal(await page.evaluate(() => window.__proof.api.filter(c => c[0] === '/api/live_stop').length), stopCountBeforeRecovery);
    await page.evaluate(() => { window.__proof.releaseError = 'Native release bridge failed'; window.__proof.detachError = 'Native detach bridge failed'; });
    await main.click(); await page.waitForFunction(() => !window.__gameProof.active);
    assert.equal(await page.evaluate(() => window.__proof.api.filter(c => c[0] === '/api/live_stop').length), stopCountBeforeRecovery + 1,
      'Native presentation failures cannot prevent the owned backend Stop');
    assert.equal(await page.locator('#startscreen').isVisible(), true);
    await page.evaluate(async () => {
      window.__proof.releaseError = window.__proof.detachError = '';
      window.__proof.session = { ...window.__proof.session, prepared: true, previewToken: 'recovered-preparation' };
      await window.__gameProof.resume();
    });
    assert.equal(await page.evaluate(() => window.__gameProof.state.phase), 'prepared');
    assert.match(await main.innerText(), /Stop/); await main.click();
    await page.waitForFunction(() => !window.__gameProof.active);
    assert.deepEqual(await page.evaluate(() => window.__proof.api.filter(c => c[0] === '/api/live_stop').at(-1)[1]), { previewToken: 'recovered-preparation' });
    await page.evaluate(async () => {
      window.pywebview = undefined;
      window.__proof.session = { owned: true, running: true, launching: false, stopping: false, pid: 1234,
        token: 'recovered-external-game', created: '134056048549014988', error: '' };
      await window.__gameProof.resume();
    });
    assert.equal(await page.evaluate(() => window.__gameProof.state.mode), 'external');
    assert.equal(await page.locator('#game-view').isVisible(), false);
    assert.match(await main.innerText(), /Stop/); await main.click();
    await page.waitForFunction(() => !window.__gameProof.active);
    assert.deepEqual(errors, []);
    await writeFile(new URL('proofs/game-view-browser.json', import.meta.url), JSON.stringify({ ok: true, checks: [
      'left Play dropdown', 'external Play', 'Play settings', 'Full rebuild', 'Play to Stop', 'body-only embed bounds',
      'worker/game tokens', 'Shift+F1', 'native hidden for menus/Settings', 'menus survive status polling', 'resize',
      'attachment error external fallback without relaunch', 'cancel during preparation', 'reload restores embedded Stop without map',
      'native release/detach failure still permits backend Stop', 'prepared preview recovery uses exact token', 'external browser recovery'], errors }, null, 2));
  } finally { await browser.close(); }
});
