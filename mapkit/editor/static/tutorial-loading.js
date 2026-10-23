// Loaded before the editor modules: keep feedback visible across the project
// switch, runtime preparation and the first training-map build.
(() => {
  const style = document.createElement('style');
  style.textContent = `
    #tutorial-loading { position:fixed; inset:0; margin:auto; width:min(440px,calc(100vw - 32px));
      padding:24px; box-sizing:border-box; color:var(--text,#d9dde5); background:var(--panel,#1d2027);
      border:1px solid var(--line,#2c313b); border-radius:var(--radius-window,6px);
      font:13px/1.5 "Segoe UI",system-ui,sans-serif; box-shadow:0 18px 60px #0009; }
    #tutorial-loading::backdrop { background:#080b12bd; }
    #tutorial-loading h2 { display:flex; gap:12px; align-items:center; margin:0 0 12px; font-size:17px; }
    #tutorial-loading p { margin:8px 0; overflow-wrap:anywhere; }
    #tutorial-loading .tutorial-spinner { display:inline-block; flex:none; width:20px; height:20px;
      border:2px solid var(--line,#2c313b); border-top-color:var(--acc,#5aa2ff); border-radius:50%;
      animation:tutorial-loading-spin .8s linear infinite; }
    #tutorial-loading .tutorial-loading-note, #tutorial-loading .tutorial-loading-time { color:var(--dim,#8b93a3); font-size:12px; }
    #tutorial-loading .tutorial-loading-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:18px; }
    #tutorial-loading .tutorial-loading-actions[hidden], #tutorial-loading .tutorial-spinner[hidden] { display:none; }
    #tutorial-loading[data-failed] .tutorial-loading-stage { color:var(--warn,#ffb347); }
    #tutorial-loading button { font:inherit; padding:5px 12px; }
    @keyframes tutorial-loading-spin { to { transform:rotate(360deg); } }
    @media(prefers-reduced-motion:reduce) { #tutorial-loading .tutorial-spinner { animation:none; } }
  `;
  document.head.appendChild(style);
  const box = document.createElement('dialog');
  box.id = 'tutorial-loading';
  box.setAttribute('aria-labelledby', 'tutorial-loading-title');
  box.setAttribute('aria-describedby', 'tutorial-loading-stage');
  box.innerHTML = `<h2 id="tutorial-loading-title"><span class="tutorial-spinner" aria-hidden="true"></span><span data-loading-title>Opening interactive tutorial</span></h2>
    <p id="tutorial-loading-stage" class="tutorial-loading-stage" role="status" aria-live="polite"></p>
    <p class="tutorial-loading-note">The first launch can take a minute while the training map is prepared. Please wait.</p>
    <p class="tutorial-loading-time"></p>
    <div class="tutorial-loading-actions" hidden><button type="button" data-retry>Try again</button><button type="button" data-dismiss>Close</button></div>`;
  document.body.appendChild(box);
  const stage = box.querySelector('.tutorial-loading-stage');
  const spinner = box.querySelector('.tutorial-spinner');
  const actions = box.querySelector('.tutorial-loading-actions');
  const elapsed = box.querySelector('.tutorial-loading-time');
  const title = box.querySelector('[data-loading-title]'), note = box.querySelector('.tutorial-loading-note');
  let timer = null, started = 0, retry = null, failed = false, previousFocus = null;
  const tick = () => { elapsed.textContent = `Elapsed: ${Math.floor((performance.now() - started) / 1000)} s`; };
  function open() {
    if (box.open) return;
    previousFocus = document.activeElement;
    box.showModal();
  }
  function show(message = 'Loading the tutorial editor…') {
    if (!box.open || failed) {
      started = performance.now();
      if (timer !== null) clearInterval(timer);
      timer = setInterval(tick, 1000);
    }
    failed = false; retry = null;
    box.removeAttribute('data-failed'); box.setAttribute('aria-busy', 'true');
    spinner.hidden = false; actions.hidden = true;
    title.textContent = 'Opening interactive tutorial'; note.hidden = false; elapsed.hidden = false;
    stage.textContent = message;
    tick(); open();
  }
  function hide() {
    if (timer !== null) clearInterval(timer);
    timer = null; retry = null; failed = false;
    box.removeAttribute('aria-busy');
    if (box.open) {
      box.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    }
  }
  function fail(error, again = () => window.location.reload()) {
    if (timer !== null) clearInterval(timer);
    timer = null; failed = true; retry = again;
    box.setAttribute('data-failed', ''); box.setAttribute('aria-busy', 'false');
    spinner.hidden = true; actions.hidden = false;
    const gameRunning = error?.code === 'game_running';
    title.textContent = gameRunning ? 'Game is still running' : 'Could not open interactive tutorial';
    note.hidden = true; elapsed.hidden = true;
    stage.textContent = gameRunning ? 'Close the game to open the interactive tutorial, then choose Try again.'
      : error?.message || String(error || 'The tutorial could not be opened.');
    open();
  }
  box.addEventListener('cancel', event => { if (!failed) event.preventDefault(); else hide(); });
  // A modal blocks pointer input, but the editor also has window capture
  // shortcuts. Leave native Tab/Enter behavior intact and stop those handlers.
  for (const type of ['keydown', 'keyup', 'paste']) window.addEventListener(type, event => {
    if (box.open) event.stopImmediatePropagation();
  }, true);
  box.querySelector('[data-dismiss]').onclick = hide;
  box.querySelector('[data-retry]').onclick = () => {
    const again = retry;
    show('Retrying the interactive tutorial…');
    Promise.resolve().then(() => again?.()).then(result => {
      if (result === false && !failed) hide(); // A cancelled confirmation is not a failed launch.
    }).catch(error => fail(error, again));
  };
  window.__tutorialLoading = { show, hide, fail, get visible() { return box.open; } };
  if (['tutorial', 'training'].includes(window.__projectContext?.kind)) show();
})();
