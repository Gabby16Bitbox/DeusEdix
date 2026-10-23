import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAutosave, normalizeAutosaveSettings } from '../editor/static/autosave.js';

const minute = 60_000;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fakeClock() {
  let time = 0, nextId = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout: (callback, delay) => {
      const id = ++nextId;
      timers.set(id, { callback, at: time + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    get count() { return timers.size; },
    async advance(duration) {
      const end = time + duration;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        time = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      time = end;
      await flush();
    },
  };
}

function fixture(initial = {}, saveResult = () => true, onError) {
  const clock = fakeClock();
  const state = { key: 'project/map-a', dirty: true, busy: false, tutorial: false, enabled: true, minutes: 1, ...initial };
  const calls = [];
  const controller = createAutosave({
    ...clock,
    getState: () => state,
    save: key => { calls.push({ key, at: clock.now() }); return saveResult(key, calls.length); },
    onError,
  });
  controller.start();
  return { clock, state, calls, controller };
}

test('settings default to five minutes and normalize finite integer limits', () => {
  assert.deepEqual(normalizeAutosaveSettings(), { enabled: true, minutes: 5 });
  assert.deepEqual(normalizeAutosaveSettings({ autosave: false, autosaveMinutes: '2.6' }), { enabled: false, minutes: 3 });
  for (const value of [null, undefined, '', '  ', 'oops', NaN, Infinity, -Infinity, true, {}]) {
    assert.equal(normalizeAutosaveSettings({ autosaveMinutes: value }).minutes, 5);
  }
  for (const [value, expected] of [[-10, 1], [0, 1], [1.3, 1], ['60', 60], [100, 60]]) {
    assert.equal(normalizeAutosaveSettings({ autosaveMinutes: value }).minutes, expected);
  }
});

test('default interval waits five minutes; repeated start/check do not postpone it', async () => {
  const f = fixture({ minutes: undefined });
  await f.clock.advance(4 * minute);
  await f.controller.start();
  await f.controller.check();
  await f.clock.advance(minute - 1);
  assert.equal(f.calls.length, 0);
  await f.clock.advance(1);
  assert.deepEqual(f.calls, [{ key: 'project/map-a', at: 5 * minute }]);
  assert.equal(f.state.dirty, true, 'the controller never clears editor dirty state');
  f.controller.stop();
});

test('no map, temporary tutorial, clean map and disabled preference never save', async () => {
  for (const excluded of [{ key: null }, { key: '' }, { tutorial: true }, { dirty: false }, { enabled: false }]) {
    const f = fixture(excluded);
    await f.clock.advance(3 * minute);
    assert.equal(f.calls.length, 0, JSON.stringify(excluded));
    f.controller.stop();
    assert.equal(f.clock.count, 0);
  }
});

test('changing map or closing it cancels the former deadline', async () => {
  const f = fixture();
  await f.clock.advance(30_000);
  f.state.key = 'project/map-b'; await f.controller.check();
  await f.clock.advance(59_999);
  assert.equal(f.calls.length, 0);
  await f.clock.advance(1);
  assert.deepEqual(f.calls, [{ key: 'project/map-b', at: 90_000 }]);
  f.state.key = null; await f.controller.check();
  await f.clock.advance(2 * minute);
  assert.equal(f.calls.length, 1);
  f.state.key = 'project/map-a'; await f.controller.check();
  await f.clock.advance(minute);
  assert.equal(f.calls.at(-1).key, 'project/map-a');
  f.controller.stop();
});

test('only normalized settings changes reset the interval, including disabling and reenabling', async () => {
  const f = fixture();
  await f.clock.advance(30_000);
  f.state.minutes = '1'; await f.controller.check();
  await f.clock.advance(30_000);
  assert.equal(f.calls.length, 1, 'equivalent settings preserve the deadline');
  f.state.minutes = 2; await f.controller.check();
  await f.clock.advance(minute);
  assert.equal(f.calls.length, 1);
  f.state.enabled = false; await f.controller.check();
  await f.clock.advance(3 * minute);
  assert.equal(f.calls.length, 1);
  f.state.enabled = true; await f.controller.check();
  await f.clock.advance(2 * minute - 1);
  assert.equal(f.calls.length, 1);
  await f.clock.advance(1);
  assert.equal(f.calls.length, 2);
  f.controller.stop();
});

test('an overdue busy editor saves as soon as it becomes available', async () => {
  const f = fixture({ busy: true });
  await f.clock.advance(90_000);
  assert.equal(f.calls.length, 0);
  f.state.busy = false;
  await f.clock.advance(1_000);
  assert.deepEqual(f.calls, [{ key: 'project/map-a', at: 91_000 }]);
  f.controller.stop();
});

test('a slow save cannot overlap another and its success starts the next interval', async () => {
  const saving = deferred(), f = fixture({}, () => saving.promise);
  await f.clock.advance(minute);
  const first = f.controller.check();
  assert.equal(f.controller.check(), first);
  await f.clock.advance(2 * minute);
  assert.equal(f.calls.length, 1);
  saving.resolve(true); await first;
  await f.clock.advance(minute - 1);
  assert.equal(f.calls.length, 1);
  await f.clock.advance(1);
  assert.equal(f.calls.length, 2);
  f.controller.stop();
});

test('false save result retries in thirty seconds without treating it as a successful save', async () => {
  const errors = [], f = fixture({}, (key, call) => call > 1, error => errors.push(error));
  await f.clock.advance(minute);
  await f.clock.advance(29_999);
  assert.equal(f.calls.length, 1);
  await f.clock.advance(1);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(errors, []);
  assert.equal(f.state.dirty, true);
  f.controller.stop();
});

test('errors keep edits and retry, but notifications are throttled to once a minute', async () => {
  const errors = [], issue = new Error('Disk unavailable');
  const f = fixture({}, (key, call) => { if (call <= 3) throw issue; return true; },
    (error, key) => errors.push({ error, key, at: f.clock.now() }));
  await f.clock.advance(150_000);
  assert.deepEqual(f.calls.map(call => call.at), [60_000, 90_000, 120_000, 150_000]);
  assert.deepEqual(errors, [
    { error: issue, key: 'project/map-a', at: 60_000 },
    { error: issue, key: 'project/map-a', at: 120_000 },
  ]);
  assert.equal(f.state.dirty, true);
  f.controller.stop();
});

test('an old map finishing a save cannot delay the new map or report its stale error', async () => {
  const saving = deferred(), errors = [];
  const f = fixture({}, (key, call) => call === 1 ? saving.promise : true, error => errors.push(error));
  await f.clock.advance(minute);
  await f.clock.advance(5_000);
  f.state.key = 'project/map-b'; f.controller.check();
  await f.clock.advance(15_000);
  saving.reject(new Error('Old map failure')); await flush();
  await f.clock.advance(44_999);
  assert.equal(f.calls.length, 1);
  await f.clock.advance(1);
  assert.deepEqual(f.calls.at(-1), { key: 'project/map-b', at: 125_000 });
  assert.deepEqual(errors, []);
  f.controller.stop();
});

test('save completion observes a map change even before the next timer poll', async () => {
  const saving = deferred(), f = fixture({}, (key, call) => call === 1 ? saving.promise : true);
  await f.clock.advance(minute);
  f.state.key = 'project/map-b';
  saving.resolve(true); await flush();
  await f.clock.advance(minute);
  assert.deepEqual(f.calls.at(-1), { key: 'project/map-b', at: 120_000 });
  f.controller.stop();
});

test('settings changed during a save retain their new deadline after the old save completes', async () => {
  const saving = deferred(), f = fixture({}, (key, call) => call === 1 ? saving.promise : true);
  await f.clock.advance(minute);
  f.state.minutes = 2; f.controller.check();
  await f.clock.advance(20_000);
  saving.resolve(true); await flush();
  await f.clock.advance(99_999);
  assert.equal(f.calls.length, 1);
  await f.clock.advance(1);
  assert.deepEqual(f.calls.at(-1), { key: 'project/map-a', at: 180_000 });
  f.controller.stop();
});

test('a manual save resets only its matching map and stale autosave completion cannot override it', async () => {
  const saving = deferred(), f = fixture({}, (key, call) => call === 1 ? saving.promise : true);
  await f.clock.advance(30_000);
  assert.equal(f.controller.saved('project/other-map'), false);
  await f.clock.advance(30_000);
  assert.equal(f.calls.length, 1);
  await f.clock.advance(10_000);
  assert.equal(f.controller.saved('project/map-a'), true);
  await f.clock.advance(10_000);
  saving.resolve(true); await flush();
  await f.clock.advance(49_999);
  assert.equal(f.calls.length, 1);
  await f.clock.advance(1);
  assert.deepEqual(f.calls.at(-1), { key: 'project/map-a', at: 130_000 });
  f.controller.stop();
});

test('stop removes timers and restart cannot overlap a still-running old save', async () => {
  const saving = deferred(), f = fixture({}, (key, call) => call === 1 ? saving.promise : true);
  await f.clock.advance(minute);
  f.controller.stop();
  assert.equal(f.clock.count, 0);
  await f.clock.advance(30_000);
  f.controller.start();
  await f.clock.advance(minute);
  assert.equal(f.calls.length, 1);
  saving.resolve(true); await flush();
  await f.controller.check();
  assert.equal(f.calls.length, 2);
  f.controller.stop();
  assert.equal(f.clock.count, 0);
  assert.equal(await f.controller.check(), false);
});

test('rapid changes between scheduling and the actual write cannot save the wrong map', async () => {
  const f = fixture({ busy: true });
  await f.clock.advance(minute);
  f.state.busy = false;
  const scheduled = f.controller.check();
  f.state.key = 'project/map-b';
  await scheduled;
  assert.equal(f.calls.length, 0);
  await f.clock.advance(minute);
  assert.deepEqual(f.calls, [{ key: 'project/map-b', at: 120_000 }]);
  f.controller.stop();
});

test('a last-moment busy operation defers the write without imposing an error retry delay', async () => {
  const f = fixture({ busy: true });
  await f.clock.advance(minute);
  f.state.busy = false;
  const scheduled = f.controller.check();
  f.state.busy = true;
  await scheduled;
  assert.equal(f.calls.length, 0);
  f.state.busy = false;
  await f.clock.advance(1_000);
  assert.deepEqual(f.calls, [{ key: 'project/map-a', at: 61_000 }]);
  f.controller.stop();
});

test('an error reporter throwing does not stop later autosave attempts', async () => {
  const f = fixture({}, (key, call) => { if (call === 1) throw new Error('Save failed'); return true; },
    () => { throw new Error('Notification failed'); });
  await f.clock.advance(90_000);
  assert.equal(f.calls.length, 2);
  f.controller.stop();
});
