// The local game keeps its own process. This controller owns the preparation /
// launch / stop sequence; the view below only hosts the verified native window.
const messageOf = error => error?.message || String(error || 'Play failed.');
const checked = result => {
  if (!result || result.ok === false) throw new Error(result?.error || result?.lines?.join('\n') || 'The game request failed.');
  return result;
};
const ownsProcess = session => !!(session?.owned || session?.running || session?.launching || session?.stopping);
// a game that an embedded Stop only asked to close (live_stop with force false), still open and not being closed
const stillOpen = session => !!(session?.running && !session?.stopping);

export function createPlaySessionController({ api, getScript, getSession = () => '', getStart = () => ({}),
  save = async () => true, canStart = async () => {}, beforeStop = async () => {}, beforeForce = async () => {},
  askFirst = () => true, resolveResumeMode = async mode => mode,
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
        const target = expectedPreparationToken ? { previewToken: expectedPreparationToken } : expectedToken ? { token: expectedToken } : {};
        // An embedded game is first only asked to close (force false), still in the editor's panel: it ends there as a
        // child window, with no flash and nothing restored around a closing game. Only a game still open after that is
        // handed back (beforeForce) and closed from outside, as every Stop did before (29 Oct 2026). askFirst() false:
        // the game can no longer answer (it stopped with an error), so the Stop that may close it is sent at once,
        // unasked (ask false: the server does not wait for a console that no longer runs).
        const inPlace = state.mode === 'embedded' && !!target.token && askFirst();
        const unasked = !!target.token && !askFirst();
        let stopped = checked(await api('/api/live_stop', inPlace ? { ...target, force: false }
          : unasked ? { ...target, ask: false } : target));
        lines(stopped);
        if (inPlace && stillOpen(stopped.session)) {
          await beforeForce();
          stopped = checked(await api('/api/live_stop', target));
          lines(stopped);
        }
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

// What the Game view says about a game window that the launcher leaves alone (its answers' windowMode): taken into the
// panel or given back from it, a full-screen or minimized game window crashed the game (28 Oct 2026). `outside`: it
// is not in the panel (never was, or vanished from it); `inside`: it changed there. actions: the message's buttons
// offered (data-game). Nothing is detached: Stop closes the game where it is. ask false: Stop does not first ask the
// game to close. outsideNoRetry: `outside` for a game that Retry embedding cannot show once it has opened full screen
// (the answer's retryFromFullScreen false: the original game, D6 of the game test, 29 Oct 2026).
const LEFT_ALONE = {
  fullscreen: {
    outside: { title: 'The game opened in full screen', actions: ['retry', 'external', 'stop'],
      detail: 'A full-screen game cannot be shown inside the editor. To play it here, switch the game to a window (Alt+Enter in the game), then choose Retry embedding. To play it full screen, choose Continue in game window.' },
    outsideNoRetry: { title: 'The game opened in full screen', actions: ['external', 'stop'],
      detail: 'This game cannot be shown inside the editor once it has opened in full screen, not even after you switch it to a window. Choose Continue in game window to play it full screen (Alt+Enter in the game makes it a window), or Stop to close it.' },
    inside: { title: 'The game switched to full screen', actions: ['stop'],
      detail: 'Full screen does not work inside the editor, so the game was left as it is. Choose Stop to close it and return to editing. To play full screen, use Play in game window.' },
  },
  // its window vanished while the game ran on, then its error box showed (or no window came back): how any critical
  // error of the game looks from outside, full screen asked for in the panel among them (the game's video settings, the
  // console's ToggleFullscreen: both games die of it there, game test 29 Oct 2026), so the detail names no single
  // cause. Its console no longer runs, so Stop does not ask it first.
  crashed: {
    outside: { title: 'The game stopped with an error', actions: ['stop'], ask: false,
      detail: 'Its window closed while the game ran on. Full screen turned on inside the editor does this, and so does any critical error of the game: its error box or its log says which. Choose Stop to close it and return to editing.' },
  },
  // its game keeps putting back the frame of its window in the panel, which the launcher stops taking away after a few
  // tries (the original game switched to a window after it opened full screen: its picture never showed, D6 of the
  // game test, 29 Oct 2026); in a window of its own it plays
  unsettled: {
    inside: { title: 'The game keeps changing its window', actions: ['external', 'stop'],
      detail: 'The game keeps changing its window inside the editor, so it cannot be shown here. Choose Continue in game window to play it in its own window, or Stop to close it.' },
  },
  minimized: {
    outside: { title: 'The game window is minimized', actions: ['stop'],
      detail: 'A minimized game cannot be shown inside the editor. Choose Stop to close it, then Play again.' },
    inside: { title: 'The game window was minimized', actions: ['stop'],
      detail: 'The game minimized itself and cannot be brought back into the editor safely. Choose Stop to close it, then Play again.' },
  },
};
// the error of a launcher answer, but not its report of a window left alone (the view says that one: LEFT_ALONE)
const nativeError = result => LEFT_ALONE[result?.windowMode] ? '' : result?.error || '';
// the launcher's windowMode while it keeps the player's Alt+Enter from the game in the panel, and what the game is then
// asked in its own window (its console command)
const FULL_SCREEN_ASKED = 'fullscreenAsked', FULL_SCREEN = 'ToggleFullscreen';

// controls: the header's buttons while the game runs ([{id, label, title, on, off}]: the console commands sent when one is
// pressed and when it is let go, play-scenarios.js PLAY_CONTROLS); sendCommand(command): sends one to the game (the
// Console's channel, console.js), true when it went
export function createGameView({ api, getScript, getSession, getStart, save, validate = async () => {}, resetInput = () => {},
  log = () => {}, status = () => {}, viewport, controls = [], sendCommand = async () => false } = {}) {
  const view = typeof viewport === 'string' ? document.querySelector(viewport) : viewport || document.querySelector('#view');
  const panel = document.createElement('section');
  panel.id = 'game-view'; panel.hidden = true; panel.setAttribute('aria-label', 'Game preview');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  panel.innerHTML = `<header class="game-view-header"><strong>Game</strong><span class="game-view-hint">Shift+F1 releases the mouse</span>
    <span class="game-view-controls" role="group" aria-label="Game controls">${controls.map((c) =>
      `<button type="button" data-control="${esc(c.id)}" aria-pressed="false" title="${esc(c.title)}">${esc(c.label)}</button>`).join('')}</span>
    <button type="button" data-game="release">Release mouse</button><button type="button" data-game="stop">Stop</button></header>
    <div class="game-view-stage"><div class="game-view-message" role="status" aria-live="polite"><strong></strong><p></p>
    <div class="game-view-actions" hidden><button type="button" data-game="retry">Retry embedding</button><button type="button" data-game="external">Continue in game window</button><button type="button" data-game="stop">Stop</button></div></div></div>`;
  document.body.append(panel);
  const stage = panel.querySelector('.game-view-stage'), message = panel.querySelector('.game-view-message');
  const title = message.querySelector('strong'), detail = message.querySelector('p'), actions = message.querySelector('.game-view-actions');
  const releaseButton = panel.querySelector('[data-game="release"]');
  // the message's buttons, by their data-game (LEFT_ALONE's actions)
  const actionButtons = { retry: actions.querySelector('[data-game="retry"]'), external: actions.querySelector('[data-game="external"]'),
    stop: actions.querySelector('[data-game="stop"]') };
  // leftAlone: what the view says about a game window the launcher left alone (LEFT_ALONE), null while there is none
  let attached = false, captured = false, attachError = '', attachSince = 0, capabilities = null, leftAlone = null;
  let nativeTail = Promise.resolve(), syncing = false, syncAgain = false, nativeTimer = null, disposed = false;
  let lastNativePlacement = '', lastState = null, lastError = '', layoutFrame = null, nativeBusySince = 0;
  // the header's buttons pressed in this game (by id), those pressed when it starts (start's third argument), a
  // command on its way (the buttons wait for it: the game takes one at a time)
  let pressed = {}, pressedAtStart = {}, commanding = false;
  // the game is being moved into its own window to play full screen (askFullScreen)
  let goingFullScreen = false;
  // the launcher keeps the app's window above the others while an embedded Play starts, when the app is in front, so
  // that the game's start-up windows stay behind it until its window is in the panel (all of them only when the app is
  // maximized; game_cover): '' not asked in this Play yet, 'on' asked, 'off' let go (never asked again in this Play,
  // not even by Retry embedding); the one-off sync at the time the launcher said the game window may be taken in
  // (syncAt)
  let cover = '', readyTimer = null;
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
  // the game window handed back by the launcher; front: also made the foreground window (Continue in game window: a
  // window never taken into the panel lay under the editor's, review su3 #5, 31 Oct 2026)
  async function detach(front = false) {
    if (bridge()?.game_detach) {
      const result = await native('game_detach', front ? true : undefined);
      if (result?.error) throw new Error(result.error);
    }
    attached = captured = false; lastNativePlacement = '';
  }
  function display(state = controller.state) {
    panel.hidden = !state.active || state.mode !== 'embedded';
    document.documentElement.classList.toggle('game-playing', state.active);
    panel.dataset.phase = state.phase;
    actions.hidden = !attachError || state.phase === 'stopping';
    for (const [name, button] of Object.entries(actionButtons)) button.hidden = !!leftAlone && !leftAlone.actions.includes(name);
    releaseButton.disabled = !attached || state.phase === 'stopping';
    panel.querySelectorAll('[data-control]').forEach(button => {
      button.disabled = state.phase !== 'running' || commanding;
      button.setAttribute('aria-pressed', String(!!pressed[button.dataset.control]));
    });
    panel.querySelectorAll('[data-game="stop"]').forEach(button => { button.disabled = state.phase === 'stopping'; });
    panel.querySelector('.game-view-hint').textContent = captured ? 'Shift+F1 releases the mouse' : 'Click the game to play · Shift+F1 releases the mouse';
    message.hidden = attached && !attachError && state.phase === 'running';
    const phaseText = { preparing: ['Preparing Play', 'Saving changes and building a temporary playable map…'],
      prepared: ['Prepared Play recovered', 'Use Stop to discard this preview and return to editing.'],
      launching: ['Starting the game', 'Waiting for your installed game. Steam may take a moment…'],
      stopping: ['Stopping Play', 'Waiting for the game to close and restoring the editor…'],
      running: ['Opening Game view', 'Waiting for the game window…'], error: ['Play needs attention', ''] };
    const text = phaseText[state.phase] || ['', ''];
    title.textContent = attachError ? leftAlone?.title || 'Game view could not be attached' : text[0];
    detail.textContent = attachError || state.error || text[1];
    if (!panel.hidden) layout();
    syncCover(state);
  }
  // The cover asked for at the launch of an embedded Play (Play in game window is never covered), and let go as soon as
  // it is no longer wanted: the game window in the panel, a report or an error about it, the Play stopping, failing or
  // ended, or the Game view gone (dispose). The launcher lets it go by itself too (native_play.py COVER_LIMIT).
  function syncCover(state) {
    const wanted = state.active && state.mode === 'embedded' && ['launching', 'running'].includes(state.phase) && !attached && !attachError;
    if (cover === '' && wanted && state.phase === 'launching') setCover('on');
    else if (cover === 'on' && !wanted) setCover('off');
  }
  function setCover(value) {
    cover = value;
    if (bridge()?.game_cover) void native('game_cover', value === 'on').catch(() => {});
  }
  function nativeFailure(error) {
    attachError = messageOf(error); captured = false; leftAlone = null;
    display();
    status(attachError, 'bad');
    // while stopping the window stays where it is until the game has closed (or the Stop hands it back)
    if (controller.state.phase !== 'stopping') void detach().catch(() => {});
  }
  // A launcher answer about a game window it left alone (windowMode, LEFT_ALONE): said in plain words; nothing is
  // detached (the window may still be in the panel) and Stop closes the game where it is. A new one is synced again at
  // once, which hides the panel so that the message shows. -> whether the answer was one
  function leaveAlone(result) {
    const entry = LEFT_ALONE[result?.windowMode];
    const said = entry && (result.attached ? entry.inside : result.retryFromFullScreen === false && entry.outsideNoRetry || entry.outside);
    if (!said) return false;
    if (leftAlone !== said) { status(said.detail, 'bad'); syncAgain = true; }
    leftAlone = said; attachError = said.detail; attached = !!result.attached; captured = false;
    display();
    return true;
  }
  // A launcher answer while the player's Alt+Enter, which it kept from the game in the panel, waits (FULL_SCREEN_ASKED:
  // full screen there ends the game with a D3D error, game test 29 Oct 2026): the game goes on in its own window
  // (Continue in game window) and is asked there for full screen through its console. -> whether the answer was one
  function askFullScreen(result) {
    if (result?.windowMode !== FULL_SCREEN_ASKED || controller.state.phase !== 'running') return false;
    if (!goingFullScreen) {
      goingFullScreen = true;
      void (async () => {
        try {
          if (await continueExternal() && !await sendCommand(FULL_SCREEN))
            status('The game did not take full screen: press Alt+Enter in its window.', 'warn');
        } finally { goingFullScreen = false; }
      })();
    }
    return true;
  }
  // an answer that says something about the game window instead of an error: Alt+Enter, or a window left alone
  const reported = result => askFullScreen(result) || leaveAlone(result);
  // An answer that says the game window is no longer in the panel and reports nothing about it: the window vanished (its
  // game ended, or stopped with an error), and an error of the launcher about that window may come with it (a tick that
  // raced it). It is looked for again (embed), which says what became of it. -> whether the answer was one
  function lost(result) {
    if (result?.attached !== false || result.windowMode) return false;
    attached = captured = false; lastNativePlacement = ''; attachSince = 0;
    display();
    return true;
  }
  // a sync at the time the launcher said the game window may be taken in (its embed answer's readyIn, seconds), not at
  // the next of the timer's half seconds
  function syncAt(seconds) {
    if (readyTimer !== null) clearTimeout(readyTimer);
    readyTimer = setTimeout(() => { readyTimer = null; void syncNative(); }, Math.max(0, seconds) * 1000);
  }
  async function syncNative() {
    if (disposed) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    try {
      const state = controller.state;
      if (!state.active || state.mode !== 'embedded') {
        if (attached) await detach();
        return;
      }
      // Stop closes an embedded game where it is: while stopping the window stays in the panel (the controller's
      // beforeForce hands it back only when the game did not close by itself), and no window is embedded
      if (state.phase === 'stopping' && !attached) return;
      const placement = layout();
      if (!placement) return;
      const visible = ['running', 'stopping'].includes(state.phase) && !attachError && !obstructed();
      if (attached) {
        const signature = JSON.stringify({ ...placement, visible });
        if (signature !== lastNativePlacement) {
          const resized = await native('game_resize', { ...placement, visible });
          if (reported(resized)) { lastNativePlacement = signature; return; }
          if (lost(resized)) return;
          if (resized?.error) throw new Error(resized.error);
          lastNativePlacement = signature;
        }
        const result = await native('game_status');
        if (reported(result) || lost(result)) return;
        if (result?.error) throw new Error(result.error);
        if (result?.pid && state.session?.pid && Number(result.pid) !== Number(state.session.pid))
          throw new Error('The game process changed. Stop Play before attaching another window.');
        attached = !!result?.attached; captured = !!result?.captured;
      } else if (visible) {
        attachSince ||= Date.now();
        const result = await native('game_embed', placement);
        if (reported(result)) return;
        if (result?.error || result?.supported === false) throw new Error(result.error || 'Embedding is unavailable for this game window.');
        if (result?.pid && state.session?.pid && Number(result.pid) !== Number(state.session.pid))
          throw new Error('The game process changed. Stop Play before attaching another window.');
        attached = !!result?.attached; captured = !!result?.captured;
        if (!attached && (!result?.pending || Date.now() - attachSince > 300000))
          throw new Error('The game is running, but its window could not be attached. Retry, continue in the game window, or stop Play.');
        if (!attached && typeof result?.readyIn === 'number') syncAt(result.readyIn);
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
    if (state.active && !wasActive) { resetInput(); attachError = ''; leftAlone = null; attachSince = 0; pressed = { ...pressedAtStart }; pressedAtStart = {}; cover = ''; }
    if (!state.active || state.mode === 'external') {
      if (nativeTimer !== null) clearTimeout(nativeTimer);
      if (readyTimer !== null) clearTimeout(readyTimer);
      nativeTimer = readyTimer = null;
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
    askFirst: () => leftAlone?.ask !== false,
    async resolveResumeMode(_mode, session) {
      if (bridge()?.game_status) {
        try {
          const result = await native('game_status');
          // a window left alone in the panel resumes embedded too, so that its Stop closes it there
          if (!nativeError(result) && result?.attached && session.running && Number(result.pid) === Number(session.pid)) return 'embedded';
        } catch { /* The backend still owns this game; external mode retains Stop. */ }
      }
      return 'external';
    },
    async beforeStop() {
      // Native presentation failure must never prevent the backend from
      // closing the verified owned process and restoring its configuration.
      // Only the mouse is released: the game is asked to close while still in the panel.
      try {
        if (bridge()?.game_release) {
          const result = await native('game_release');
          if (nativeError(result)) throw new Error(result.error);
        }
      } catch (error) { log(['Mouse release: ' + messageOf(error)], 'bad'); }
    },
    async beforeForce() {
      // The game did not close by itself: handed back as a window of its own, which the
      // backend's WM_CLOSE reaches (a child of the panel never gets it).
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
      if (nativeError(result)) throw new Error(result.error);
      captured = false; resetInput(); display(); return true;
    } catch (error) { status(messageOf(error), 'bad'); return false; }
  }
  async function stop() {
    // Invalidate preparation immediately, before waiting for native UI calls.
    return await controller.stop();
  }
  async function continueExternal() {
    try { await detach(true); attachError = ''; leftAlone = null; controller.setMode('external'); return true; }
    catch (error) { nativeFailure(error); return false; }
  }
  function retryEmbed() { attachError = ''; leftAlone = null; attachSince = 0; display(); void syncNative(); }
  // a header button: its command (pressed: the one that lets it go) to the game, then the button as the game has it
  async function control(id) {
    const c = controls.find(x => x.id === id);
    if (!c || commanding || controller.state.phase !== 'running') return;
    commanding = true; display();
    try {
      if (await sendCommand(pressed[id] ? c.off : c.on)) pressed = { ...pressed, [id]: !pressed[id] };
      else status('The game did not take the command: wait until it has loaded the map, then try again.', 'warn');
    } finally { commanding = false; display(); }
  }
  // Play, with the header's buttons pressed at the start that the scenario turns on (God)
  function start(mode, overrides, pressedFirst = {}) {
    pressedAtStart = { ...pressedFirst };
    return controller.start(mode, overrides);
  }
  panel.addEventListener('click', event => {
    const id = event.target.closest('[data-control]')?.dataset.control;
    if (id) void control(id);
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
  return { start, resume: controller.resume, stop, release, retryEmbed, continueExternal, capabilities: readCapabilities,
    get active() { return controller.active; }, get preparing() { return controller.preparing; },
    get state() { return { ...controller.state, attached, captured, attachmentError: attachError, pressed: { ...pressed } }; },
    dispose() {
      disposed = true; controller.dispose(); observer.disconnect(); mutations.disconnect();
      if (nativeTimer !== null) clearTimeout(nativeTimer);
      if (readyTimer !== null) clearTimeout(readyTimer);
      if (cover === 'on') setCover('off');
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
      document.removeEventListener('visibilitychange', refresh); window.removeEventListener('resize', refresh);
      window.visualViewport?.removeEventListener('resize', refresh);
      window.visualViewport?.removeEventListener('scroll', refresh);
      window.removeEventListener('keydown', keydown, true);
      void detach().catch(() => {}); panel.remove(); document.documentElement.classList.remove('game-playing');
    },
  };
}
