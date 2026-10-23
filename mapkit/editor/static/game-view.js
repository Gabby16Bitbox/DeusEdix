// The local game keeps its own process. This controller owns the preparation /
// launch / stop sequence; the view below only hosts the verified native window.
const messageOf = error => error?.message || String(error || 'Play failed.');
const checked = result => {
  if (!result || result.ok === false) throw new Error(result?.error || result?.lines?.join('\n') || 'The game request failed.');
  return result;
};
const ownsProcess = session => !!(session?.owned || session?.running || session?.launching || session?.stopping);

export function createPlaySessionController({ api, getScript, getSession = () => '', getStart = () => ({}),
  save = async () => true, canStart = async () => {}, beforeStop = async () => {}, resolveResumeMode = async mode => mode,
  onState = () => {}, onLog = () => {},
  setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout } = {}) {
  let state = { active: false, phase: 'idle', mode: 'embedded', session: null, error: '' };
  let generation = 0, timer = null, starting = null, stopping = null, polling = null;
  let expectedToken = null, expectedPreparationToken = null;
  let touchedServer = false, launchRequested = false, stopFailed = false, disposed = false;
  const publish = values => { state = { ...state, ...values }; onState({ ...state }); };
  const clearPoll = () => { if (timer !== null) cancel(timer); timer = null; };
  const context = () => `${getSession()}\n${getScript() || ''}`;
  const valid = ticket => ticket === generation && !disposed;
  const lines = result => { if (result?.lines?.length) onLog(result.lines); };
  function schedule() {
    if (!disposed && state.active && launchRequested && !stopping && timer === null && !polling)
      timer = later(() => { timer = null; void poll(); }, 500);
  }
  function changedSession(session) {
    if (expectedPreparationToken && (ownsProcess(session) || session.prepared && session.previewToken !== expectedPreparationToken)) return true;
    return (ownsProcess(session) || session.error) && expectedToken && session.token && session.token !== expectedToken;
  }
  function refuseReplacement(session) {
    generation++; clearPoll(); launchRequested = touchedServer = false;
    publish({ active: false, phase: 'error', session, error: 'The Play session changed. This window will not control the replacement game.' });
  }
  function receive(session) {
    if (changedSession(session)) { refuseReplacement(session); return; }
    if (!expectedToken && session.token && ownsProcess(session)) expectedToken = session.token;
    if (!ownsProcess(session)) {
      clearPoll();
      if (session.prepared && session.previewToken === expectedPreparationToken && !session.error) {
        publish({ active: true, phase: stopFailed ? 'error' : 'prepared', session, error: stopFailed ? state.error : '' });
      } else if (session.error) {
        // The process may have closed while restoration of its temporary game
        // configuration failed. Keep Stop available until cleanup succeeds.
        stopFailed = true;
        publish({ active: true, phase: 'error', session, error: session.error });
      } else {
        expectedPreparationToken = null;
        launchRequested = touchedServer = stopFailed = false;
        publish({ active: false, phase: 'idle', session, error: '' });
      }
      return;
    }
    const phase = session.stopping ? 'stopping' : session.launching ? 'launching' : 'running';
    publish({ active: true, phase: stopFailed ? 'error' : phase, session,
      error: stopFailed ? state.error : session.error || '' });
  }
  function poll() {
    if (polling) return polling;
    if (!state.active || !launchRequested || disposed) return Promise.resolve(state);
    const ticket = generation;
    const task = (async () => {
      try {
        const session = checked(await api('/api/play_session'));
        if (valid(ticket)) receive(session);
      } catch (error) {
        if (valid(ticket)) publish({ phase: 'error', error: messageOf(error) });
      }
      return state;
    })();
    polling = task;
    void task.finally(() => { if (polling === task) polling = null; schedule(); });
    return task;
  }
  async function resume(mode = 'external') {
    if (!['embedded', 'external'].includes(mode)) throw new Error('Unknown Play mode.');
    if (state.active || starting || stopping || disposed) return false;
    const ticket = ++generation, owner = getSession();
    try {
      const session = checked(await api('/api/play_session'));
      if (!valid(ticket) || getSession() !== owner) return false;
      const processToken = typeof session.token === 'string' && session.token && (ownsProcess(session) || session.error) ? session.token : null;
      const preparationToken = !ownsProcess(session) && session.prepared && typeof session.previewToken === 'string' && session.previewToken ? session.previewToken : null;
      if (!processToken && !preparationToken) return false;
      const resumedMode = await resolveResumeMode(mode, session);
      if (!valid(ticket) || getSession() !== owner) return false;
      if (!['embedded', 'external'].includes(resumedMode)) throw new Error('Unknown resumed Play mode.');
      expectedToken = preparationToken ? null : processToken;
      expectedPreparationToken = preparationToken;
      touchedServer = true; launchRequested = !preparationToken; stopFailed = false;
      state = { ...state, mode: resumedMode };
      receive(session); schedule();
      return state.active;
    } catch (error) {
      if (valid(ticket)) publish({ phase: 'error', error: 'Could not recover Play: ' + messageOf(error) });
      return false;
    }
  }
  function start(mode = 'embedded', overrides = {}) {
    if (!['embedded', 'external'].includes(mode)) return Promise.reject(new Error('Unknown Play mode.'));
    if (state.active || starting || stopping || disposed) return Promise.resolve(false);
    const script = getScript();
    if (!script) return Promise.resolve(false);
    const owner = context(), ticket = ++generation;
    let preparedToken = null;
    expectedToken = expectedPreparationToken = null; touchedServer = launchRequested = stopFailed = false;
    publish({ active: true, phase: 'preparing', mode, session: null, error: '' });
    const task = (async () => {
      try {
        await canStart(mode);
        if (!valid(ticket)) return false;
        if (await save() === false) throw new Error('Save the map and Story before playing.');
        if (!valid(ticket)) return false;
        if (context() !== owner) throw new Error('The open map changed before Play was ready.');
        touchedServer = true;
        const prepared = checked(await api('/api/play_prepare?script=' + encodeURIComponent(script), {}));
        preparedToken = prepared.token;
        expectedPreparationToken = preparedToken || null;
        lines(prepared);
        if (!valid(ticket)) return false;
        if (context() !== owner) throw new Error('The open map changed during Play preparation.');
        if (typeof prepared.token !== 'string' || !prepared.token) throw new Error('Play preparation returned no launch token.');
        publish({ phase: 'launching' });
        launchRequested = true;
        expectedPreparationToken = null;
        await window.__flushProjectPreferences?.(); // Persist tutorial mute before the game reads it.
        const result = checked(await api('/api/play?script=' + encodeURIComponent(script),
          { ...getStart(), ...overrides, displayMode: mode, previewToken: prepared.token }));
        lines(result);
        // Adopt the exact launch identity even if Stop was pressed while the
        // request was in flight, so that Stop can retire this process only.
        const session = result.session && typeof result.session === 'object' ? result.session : null;
        expectedToken = session?.token || (typeof result.session === 'string' ? result.session : null);
        if (!valid(ticket)) return false;
        if (session) receive(session);
        else publish({ phase: 'launching' });
        return true;
      } catch (error) {
        if (!valid(ticket)) return false;
        if (!launchRequested) {
          let cleanupError = '';
          if (preparedToken) {
            try {
              const current = checked(await api('/api/play_session'));
              if (ownsProcess(current)) { refuseReplacement(current); return false; }
              checked(await api('/api/live_stop', { previewToken: preparedToken }));
              const cleanup = checked(await api('/api/play_session'));
              if (ownsProcess(cleanup) || cleanup.error) cleanupError = cleanup.error || 'Play preparation is still being cancelled.';
            } catch (cleanup) { cleanupError = messageOf(cleanup); }
          }
          if (!valid(ticket)) return false;
          touchedServer = launchRequested = !!cleanupError;
          stopFailed = !!cleanupError;
          publish({ active: !!cleanupError, phase: 'error', error: messageOf(error) + (cleanupError ? '\nCleanup: ' + cleanupError : '') });
        } else publish({ active: true, phase: 'error', error: messageOf(error) });
        return false;
      }
    })();
    starting = task;
    void task.finally(() => { if (starting === task) starting = null; schedule(); });
    return task;
  }
  function stop() {
    if (stopping) return stopping;
    if (!state.active && !starting) { ++generation; return Promise.resolve(true); }
    ++generation; clearPoll(); stopFailed = false;
    publish({ phase: 'stopping', error: '' });
    const pendingStart = starting;
    const task = (async () => {
      try {
        if (pendingStart) await pendingStart;
        if (!touchedServer && !launchRequested) {
          publish({ active: false, phase: 'idle', error: '' }); return true;
        }
        const current = checked(await api('/api/play_session'));
        if (changedSession(current)) { refuseReplacement(current); return false; }
        if (ownsProcess(current) && !expectedToken && !launchRequested) { refuseReplacement(current); return false; }
        await beforeStop();
        const stopped = checked(await api('/api/live_stop', expectedPreparationToken ? { previewToken: expectedPreparationToken }
          : expectedToken ? { token: expectedToken } : {}));
        lines(stopped);
        const session = checked(await api('/api/play_session'));
        if (changedSession(session)) { refuseReplacement(session); return false; }
        receive(session);
        if (ownsProcess(session)) {
          // Steam may still be starting the owned game. The backend retains
          // cancellation until that process is found and closed.
          launchRequested = true;
          publish({ active: true, phase: session.error ? 'error' : 'stopping', error: session.error || '' });
        }
        return !state.active;
      } catch (error) {
        stopFailed = true; launchRequested = true;
        publish({ active: true, phase: 'error', error: 'Could not stop Play: ' + messageOf(error) });
        return false;
      }
    })();
    stopping = task;
    void task.finally(() => { if (stopping === task) stopping = null; schedule(); });
    return task;
  }
  return {
    start, stop, poll, resume,
    setMode(mode) {
      if (!['embedded', 'external'].includes(mode)) throw new Error('Unknown Play mode.');
      publish({ mode });
    },
    dispose() { disposed = true; ++generation; clearPoll(); },
    get active() { return state.active; },
    get preparing() { return state.phase === 'preparing'; },
    get state() { return { ...state }; },
  };
}

export function createGameView({ api, getScript, getSession, getStart, save, validate = async () => {}, resetInput = () => {},
  log = () => {}, status = () => {}, viewport } = {}) {
  const view = typeof viewport === 'string' ? document.querySelector(viewport) : viewport || document.querySelector('#view');
  const panel = document.createElement('section');
  panel.id = 'game-view'; panel.hidden = true; panel.setAttribute('aria-label', 'Game preview');
  panel.innerHTML = `<header class="game-view-header"><strong>Game</strong><span class="game-view-hint">Shift+F1 releases the mouse</span>
    <button type="button" data-game="release">Release mouse</button><button type="button" data-game="stop">Stop</button></header>
    <div class="game-view-stage"><div class="game-view-message" role="status" aria-live="polite"><strong></strong><p></p>
    <div class="game-view-actions" hidden><button type="button" data-game="retry">Retry embedding</button><button type="button" data-game="external">Continue in game window</button><button type="button" data-game="stop">Stop</button></div></div></div>`;
  document.body.append(panel);
  const stage = panel.querySelector('.game-view-stage'), message = panel.querySelector('.game-view-message');
  const title = message.querySelector('strong'), detail = message.querySelector('p'), actions = message.querySelector('.game-view-actions');
  const releaseButton = panel.querySelector('[data-game="release"]');
  let attached = false, captured = false, attachError = '', attachSince = 0, capabilities = null;
  let nativeTail = Promise.resolve(), syncing = false, syncAgain = false, nativeTimer = null, disposed = false;
  let lastNativePlacement = '', lastState = null, lastError = '', layoutFrame = null, nativeBusySince = 0;
  const bridge = () => window.pywebview?.api;
  function native(method, argument) {
    const call = nativeTail.catch(() => {}).then(async () => {
      const fn = bridge()?.[method];
      if (!fn) throw new Error('Play in the editor requires the DeusEdix desktop app. Use Play in game window in a browser.');
      return await (argument === undefined ? fn() : fn(argument));
    });
    nativeTail = call;
    return call;
  }
  async function readCapabilities() {
    if (!bridge()?.game_capabilities) return { supported: false, error: 'Play in the editor requires the DeusEdix desktop app. Use Play in game window in a browser.' };
    capabilities = await native('game_capabilities');
    return capabilities;
  }
  function obstructed() {
    if (document.hidden) return true;
    return [...document.querySelectorAll('dialog[open], .mb-menu.open, .ws-menu, details.tool-menu[open], #mb-dialog.open, #studio, #charbox, #texedit, #story, #newbox, #mapbox, #facbox, #linkbox, #pkgbox, #mimportbox, #logicbox, #soundbox, #checkbox, #playbox, #help')]
      .some(element => element.getClientRects().length && getComputedStyle(element).display !== 'none');
  }
  function layout() {
    if (!view) return null;
    const rect = view.getBoundingClientRect();
    Object.assign(panel.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    const body = stage.getBoundingClientRect();
    return { session: getSession(), processToken: controller.state.session?.token,
      rect: { x: body.left, y: body.top, width: Math.max(1, body.width), height: Math.max(1, body.height) },
      dpr: window.devicePixelRatio || 1 };
  }
  async function detach() {
    if (bridge()?.game_detach) {
      const result = await native('game_detach');
      if (result?.error) throw new Error(result.error);
    }
    attached = captured = false; lastNativePlacement = '';
  }
  function display(state = controller.state) {
    panel.hidden = !state.active || state.mode !== 'embedded';
    document.documentElement.classList.toggle('game-playing', state.active);
    panel.dataset.phase = state.phase;
    actions.hidden = !attachError || state.phase === 'stopping';
    releaseButton.disabled = !attached || state.phase === 'stopping';
    panel.querySelectorAll('[data-game="stop"]').forEach(button => { button.disabled = state.phase === 'stopping'; });
    panel.querySelector('.game-view-hint').textContent = captured ? 'Shift+F1 releases the mouse' : 'Click the game to play · Shift+F1 releases the mouse';
    message.hidden = attached && !attachError && state.phase === 'running';
    const phaseText = { preparing: ['Preparing Play', 'Saving changes and building a temporary playable map…'],
      prepared: ['Prepared Play recovered', 'Use Stop to discard this preview and return to editing.'],
      launching: ['Starting the game', 'Waiting for your installed game. Steam may take a moment…'],
      stopping: ['Stopping Play', 'Waiting for the game to close and restoring the editor…'],
      running: ['Opening Game view', 'Waiting for the game window…'], error: ['Play needs attention', ''] };
    const text = phaseText[state.phase] || ['', ''];
    title.textContent = attachError ? 'Game view could not be attached' : text[0];
    detail.textContent = attachError || state.error || text[1];
    if (!panel.hidden) layout();
  }
  function nativeFailure(error) {
    attachError = messageOf(error); captured = false;
    display();
    status(attachError, 'bad');
    void detach().catch(() => {});
  }
  async function syncNative() {
    if (disposed) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    try {
      const state = controller.state;
      if (!state.active || state.mode !== 'embedded' || state.phase === 'stopping') {
        if (attached) await detach();
        return;
      }
      const placement = layout();
      if (!placement) return;
      const visible = state.phase === 'running' && !attachError && !obstructed();
      if (attached) {
        const signature = JSON.stringify({ ...placement, visible });
        if (signature !== lastNativePlacement) {
          const resized = await native('game_resize', { ...placement, visible });
          if (resized?.error) throw new Error(resized.error);
          lastNativePlacement = signature;
        }
        const result = await native('game_status');
        if (result?.error) throw new Error(result.error);
        if (result?.pid && state.session?.pid && Number(result.pid) !== Number(state.session.pid))
          throw new Error('The game process changed. Stop Play before attaching another window.');
        attached = !!result?.attached; captured = !!result?.captured;
      } else if (visible) {
        attachSince ||= Date.now();
        const result = await native('game_embed', placement);
        if (result?.error || result?.supported === false) throw new Error(result.error || 'Embedding is unavailable for this game window.');
        if (result?.pid && state.session?.pid && Number(result.pid) !== Number(state.session.pid))
          throw new Error('The game process changed. Stop Play before attaching another window.');
        attached = !!result?.attached; captured = !!result?.captured;
        if (!attached && (!result?.pending || Date.now() - attachSince > 300000))
          throw new Error('The game is running, but its window could not be attached. Retry, continue in the game window, or stop Play.');
        lastNativePlacement = '';
      }
      nativeBusySince = 0;
      display();
    } catch (error) {
      // WinForms can still be completing a queued attach/resize. Do not detach
      // that very same game because a short bridge deadline elapsed.
      if (/desktop window is busy/i.test(messageOf(error)) && Date.now() - (nativeBusySince ||= Date.now()) < 300000)
        status('Waiting for the game window to finish updating…', 'warn');
      else nativeFailure(error);
    }
    finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; queueMicrotask(() => void syncNative()); }
    }
  }
  function scheduleNative() {
    if (nativeTimer !== null || disposed || !controller.active) return;
    nativeTimer = setTimeout(async () => {
      nativeTimer = null; await syncNative(); scheduleNative();
    }, 500);
  }
  function onState(state) {
    const previous = lastState, wasActive = previous?.active;
    lastState = state;
    if (state.active && !wasActive) { resetInput(); attachError = ''; attachSince = 0; }
    if (!state.active || state.mode === 'external') {
      if (nativeTimer !== null) clearTimeout(nativeTimer);
      nativeTimer = null;
      if (attached || previous?.active && previous.mode === 'embedded')
        void detach().catch(error => status(messageOf(error), 'bad'));
    }
    display(state);
    if (state.error && state.error !== lastError) { status(state.error, 'bad'); log([state.error], 'bad'); }
    lastError = state.error;
    if (state.active && !state.error) {
      if (attachError && state.mode === 'embedded') status(attachError, 'bad');
      else status(state.phase === 'running'
        ? state.mode === 'external' ? 'Playing in the game window. Use Stop to return to editing.' : 'Playing in the editor · Shift+F1 releases the mouse.'
        : state.phase === 'stopping' ? 'Stopping Play…' : state.phase === 'launching' ? 'Starting the game…'
          : state.phase === 'prepared' ? 'Prepared Play recovered. Use Stop to return to editing.' : 'Preparing Play…');
    }
    if (!state.active && wasActive && !state.error) { resetInput(); status('Play stopped. Map edits are unchanged by the game.'); }
    if (!previous || ['active', 'phase', 'mode', 'error'].some(key => previous[key] !== state[key]))
      window.dispatchEvent(new CustomEvent('deusedix:play-state', { detail: { ...state } }));
    if (state.active && state.mode === 'embedded') { void syncNative(); scheduleNative(); }
  }
  const controller = createPlaySessionController({ api, getScript, getSession, getStart, save, onState, onLog: log,
    async resolveResumeMode(_mode, session) {
      if (bridge()?.game_status) {
        try {
          const result = await native('game_status');
          if (!result?.error && result?.attached && session.running && Number(result.pid) === Number(session.pid)) return 'embedded';
        } catch { /* The backend still owns this game; external mode retains Stop. */ }
      }
      return 'external';
    },
    async beforeStop() {
      // Native presentation failure must never prevent the backend from
      // closing the verified owned process and restoring its configuration.
      try {
        if (bridge()?.game_release) {
          const result = await native('game_release');
          if (result?.error) throw new Error(result.error);
        }
      } catch (error) { log(['Mouse release: ' + messageOf(error)], 'bad'); }
      try { await detach(); }
      catch (error) { log(['Game window detach: ' + messageOf(error)], 'bad'); }
    },
    async canStart(mode) {
      await validate(); // Both embedded and external Play, before saving/building or starting a process.
      if (mode === 'embedded') {
        const supported = await readCapabilities();
        if (!supported?.supported) throw new Error(supported?.error || 'Play in the editor requires the DeusEdix desktop app.');
        if (!view) throw new Error('The editor viewport is unavailable.');
      }
    } });
  async function release() {
    try {
      const result = await native('game_release');
      if (result?.error) throw new Error(result.error);
      captured = false; resetInput(); display(); return true;
    } catch (error) { status(messageOf(error), 'bad'); return false; }
  }
  async function stop() {
    // Invalidate preparation immediately, before waiting for native UI calls.
    return await controller.stop();
  }
  async function continueExternal() {
    try { await detach(); attachError = ''; controller.setMode('external'); return true; }
    catch (error) { nativeFailure(error); return false; }
  }
  function retryEmbed() { attachError = ''; attachSince = 0; display(); void syncNative(); }
  panel.addEventListener('click', event => {
    const action = event.target.closest('[data-game]')?.dataset.game;
    if (action === 'stop') void stop();
    if (action === 'release') void release();
    if (action === 'retry') retryEmbed();
    if (action === 'external') void continueExternal();
  });
  const refresh = () => {
    if (!controller.active || disposed || layoutFrame !== null) return;
    layoutFrame = requestAnimationFrame(() => { layoutFrame = null; void syncNative(); });
  };
  const keydown = event => {
    if (controller.active && event.shiftKey && event.code === 'F1') { event.preventDefault(); event.stopImmediatePropagation(); void release(); }
  };
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('resize', refresh);
  window.addEventListener('keydown', keydown, true);
  const observer = new ResizeObserver(refresh);
  if (view) observer.observe(view);
  observer.observe(stage);
  window.visualViewport?.addEventListener('resize', refresh);
  window.visualViewport?.addEventListener('scroll', refresh);
  const mutations = new MutationObserver(rows => {
    if (rows.some(row => !panel.contains(row.target))) refresh();
  });
  mutations.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style', 'class', 'open'] });
  return { start: controller.start, resume: controller.resume, stop, release, retryEmbed, continueExternal, capabilities: readCapabilities,
    get active() { return controller.active; }, get preparing() { return controller.preparing; },
    get state() { return { ...controller.state, attached, captured, attachmentError: attachError }; },
    dispose() {
      disposed = true; controller.dispose(); observer.disconnect(); mutations.disconnect();
      if (nativeTimer !== null) clearTimeout(nativeTimer);
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
      document.removeEventListener('visibilitychange', refresh); window.removeEventListener('resize', refresh);
      window.visualViewport?.removeEventListener('resize', refresh);
      window.visualViewport?.removeEventListener('scroll', refresh);
      window.removeEventListener('keydown', keydown, true);
      void detach().catch(() => {}); panel.remove(); document.documentElement.classList.remove('game-playing');
    },
  };
}
