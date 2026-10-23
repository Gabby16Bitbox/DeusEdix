const MINUTE = 60_000;
const POLL_DELAY = 1_000;
const RETRY_DELAY = 30_000;
const ERROR_NOTICE_DELAY = 60_000;
const SKIPPED = Symbol('autosave skipped');

/** Normalize persisted preferences and values from the settings form. */
export function normalizeAutosaveSettings({ autosave, autosaveMinutes } = {}) {
  const value = typeof autosaveMinutes === 'number' ||
    (typeof autosaveMinutes === 'string' && autosaveMinutes.trim() !== '')
    ? Number(autosaveMinutes) : NaN;
  return {
    enabled: autosave !== false,
    minutes: Number.isFinite(value) ? Math.max(1, Math.min(60, Math.round(value))) : 5,
  };
}

/**
 * Schedule saves without owning editor state or clearing dirty flags.
 *
 * getState(): {key, dirty, busy, tutorial, enabled, minutes}
 * save(key): Promise<boolean>; false means nothing was saved.
 * onError(error, key) is optional and limited to once a minute per context.
 * Call check() after a map/preferences change for immediate synchronization;
 * the timer also observes state changes. saved(key) records a manual save.
 */
export function createAutosave({
  getState,
  save,
  onError = () => {},
  now = () => Date.now(),
  setTimeout: setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: clearTimer = timer => globalThis.clearTimeout(timer),
} = {}) {
  if (typeof getState !== 'function' || typeof save !== 'function') {
    throw new TypeError('Autosave requires getState and save functions.');
  }

  let running = false, timer = null, timerAt = null;
  let context = null, deadline = null, revision = 0, pending = null;
  let lastErrorAt = -Infinity;

  function readState() {
    const state = getState() || {};
    const settings = normalizeAutosaveSettings({ autosave: state.enabled, autosaveMinutes: state.minutes });
    return {
      key: typeof state.key === 'string' && state.key ? state.key : null,
      dirty: !!state.dirty,
      busy: !!state.busy,
      tutorial: !!state.tutorial,
      ...settings,
    };
  }

  const eligible = state => !!state?.key && state.enabled && !state.tutorial;
  const sameContext = (a, b) => a && a.key === b.key && a.enabled === b.enabled &&
    a.minutes === b.minutes && a.tutorial === b.tutorial;

  function synchronize(state, time) {
    if (!sameContext(context, state)) {
      context = { key: state.key, enabled: state.enabled, minutes: state.minutes, tutorial: state.tutorial };
      revision++;
      deadline = eligible(state) ? time + state.minutes * MINUTE : null;
      lastErrorAt = -Infinity;
    }
  }

  function disarm() {
    if (timer !== null) clearTimer(timer);
    timer = timerAt = null;
  }

  function arm(state, time) {
    if (!running) return;
    let delay = POLL_DELAY;
    if (!pending && eligible(state) && state.dirty && !state.busy && deadline > time) {
      delay = Math.min(delay, deadline - time);
    }
    const target = time + Math.max(1, delay);
    if (timer !== null && timerAt <= target) return;
    disarm();
    timerAt = target;
    timer = setTimer(() => {
      timer = timerAt = null;
      check();
    }, target - time);
  }

  function finish(run, success, error, skipped = false) {
    if (pending === run) pending = null;
    if (!running) return success;

    // A save may finish before the next poll sees a changed map or settings.
    const state = readState(), time = now();
    synchronize(state, time);
    if (!skipped && run.revision === revision && run.key === state.key) {
      deadline = time + (success ? state.minutes * MINUTE : RETRY_DELAY);
      if (success) lastErrorAt = -Infinity;
      else if (error && time - lastErrorAt >= ERROR_NOTICE_DELAY) {
        lastErrorAt = time;
        try { onError(error, run.key); } catch { /* Reporting must not stop later saves. */ }
      }
    }
    arm(state, time);
    return success;
  }

  function launch(state) {
    const run = { key: state.key, revision, promise: null };
    pending = run;
    // Defer invocation so a synchronous save callback cannot reenter before
    // pending is assigned. Recheck the context before beginning any write.
    run.promise = Promise.resolve().then(() => {
      const current = readState();
      synchronize(current, now());
      if (!running || run.revision !== revision || !eligible(current) || !current.dirty || current.busy) {
        return SKIPPED;
      }
      return save(run.key);
    }).then(result => finish(run, result !== false && result !== SKIPPED, undefined, result === SKIPPED),
      error => finish(run, false, error));
    return run.promise;
  }

  function check() {
    if (!running) return Promise.resolve(false);
    const state = readState(), time = now();
    synchronize(state, time);
    let result = pending?.promise || Promise.resolve(false);
    if (!pending && eligible(state) && deadline !== null && time >= deadline) {
      if (!state.dirty) deadline = time + state.minutes * MINUTE;
      else if (!state.busy) result = launch(state);
      // Busy work keeps the overdue deadline; the next poll can save as soon
      // as the editor becomes available, without starting another full period.
    }
    arm(state, time);
    return result;
  }

  function start() {
    if (!running) {
      running = true;
      context = null;
      revision++;
    }
    return check();
  }

  function stop() {
    running = false;
    revision++;
    context = null;
    deadline = null;
    disarm();
    // An existing network write cannot be cancelled here. Retain pending so
    // stop/start cannot launch an overlapping write before it settles.
  }

  function saved(key) {
    if (!running) return false;
    const state = readState(), time = now();
    synchronize(state, time);
    if (!eligible(state) || key !== state.key) return false;
    revision++;
    deadline = time + state.minutes * MINUTE;
    lastErrorAt = -Infinity;
    arm(state, time);
    return true;
  }

  return { start, stop, check, saved };
}
