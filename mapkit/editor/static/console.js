// The Console panel (a tab next to the Browser, like Unity's): the running game's log as it is written, and a
// line for the game's own console while Play runs (server: /api/console_log, /api/console; in the game:
// UCConsoleLink). Script lines (log() in UnrealScript) stand out; errors and warnings are coloured.
const root = document.getElementById('console');
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./console.css', import.meta.url).href;
document.head.appendChild(css);

root.innerHTML = `
  <div class="cn-bar">
    <div class="cn-filters" role="group" aria-label="Show">
      <button type="button" data-filter="all" class="on" title="Every line of the game's log">All</button>
      <button type="button" data-filter="script" title="Lines from scripts (log in UnrealScript) and from this Console">Scripts</button>
      <button type="button" data-filter="problems" title="Errors and warnings only">Problems <span class="cn-count" hidden></span></button>
    </div>
    <input type="search" class="cn-find" placeholder="Find in log" aria-label="Find in log">
    <span class="cn-gap"></span>
    <span class="cn-state hint"></span>
    <button type="button" class="cn-clear" title="Clear the panel (the game's log file stays as it is)">Clear</button>
  </div>
  <div class="cn-out" tabindex="0" aria-label="Game log" aria-live="off"></div>
  <form class="cn-line" autocomplete="off">
    <span class="cn-prompt" aria-hidden="true">&gt;</span>
    <input type="text" class="cn-input" spellcheck="false" aria-label="Console command"
      placeholder="A command for the game while Play runs: god, summon MedKit, set DeusExPlayer Health 100… (↑ ↓: history)">
  </form>`;

const out = root.querySelector('.cn-out'), input = root.querySelector('.cn-input'), stateEl = root.querySelector('.cn-state');
const find = root.querySelector('.cn-find'), count = root.querySelector('.cn-count');
const MAX = 4000;                      // lines kept in the panel
let offset = -1, filter = 'all', running = false, problems = 0, timer = 0, busy = false;
const history = [];
let historyAt = 0;
try { history.push(...JSON.parse(localStorage.getItem('deusedix.console.history') || '[]').slice(-50)); historyAt = history.length; } catch (_) { /* no storage: no history */ }

function kind(line) {
  if (/^DeusEdix console [<>]/.test(line) || line.startsWith('> ')) return 'cmd';
  if (/Ogg File: '\.\.\\Music\\Nothing'/.test(line)) return 'engine';     // Revision's "no music here": harmless
  if (/(^|\s)(Critical|Error)[:,]|\bError\b.*\.uc\(\d+\)|Accessed None|Infinite (script )?recursion|runaway loop/i.test(line)) return 'bad';
  if (/(^|\s)Warning[:,]|ScriptWarning/i.test(line)) return 'warn';
  if (/^ScriptLog:/.test(line)) return 'script';
  return 'engine';
}
function visible(row) {
  const k = row.dataset.kind, q = find.value.trim().toLowerCase();
  const passes = filter === 'all' || (filter === 'script' && (k === 'script' || k === 'cmd')) || (filter === 'problems' && (k === 'bad' || k === 'warn'));
  return passes && (!q || row.textContent.toLowerCase().includes(q));
}
function add(lines, own = false) {
  if (!lines.length) return;
  const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 24;
  const frag = document.createDocumentFragment();
  for (const text of lines) {
    const row = document.createElement('div');
    const k = own ? 'cmd' : kind(text);
    row.className = 'cn-row cn-' + k;
    row.dataset.kind = k;
    row.textContent = text.replace(/^ScriptLog: /, '');
    if (k === 'bad' || k === 'warn') problems++;
    row.hidden = !visible(row);
    frag.appendChild(row);
  }
  out.appendChild(frag);
  while (out.childElementCount > MAX) out.firstElementChild.remove();
  count.hidden = !problems;
  count.textContent = problems;
  if (stick) out.scrollTop = out.scrollHeight;
}
function refilter() {
  for (const row of out.children) row.hidden = !visible(row);
  out.scrollTop = out.scrollHeight;
}
function showState() {
  input.disabled = !running;
  stateEl.textContent = running ? 'Game running' : 'Not running: start Play';
  stateEl.title = running ? 'Commands go to the game' : 'Start Play to send commands to the game';
  stateEl.classList.toggle('on', running);
}
async function poll() {
  timer = 0;
  if (!busy && root.offsetParent) {           // only while the panel is on screen
    busy = true;
    try {
      const r = await fetch('/api/console_log?offset=' + offset);
      if (r.ok) {
        const j = await r.json();
        if (j.offset < offset) add(['— the game started again: a new log —'], true);
        offset = j.offset;
        add(j.lines || []);
        if (running !== !!j.running) { running = !!j.running; showState(); }
      }
    } catch (_) { /* the editor's server is restarting: try again later */ }
    busy = false;
  }
  timer = setTimeout(poll, running ? 400 : 1500);
}
async function send(command) {
  add(['> ' + command], true);
  window.dispatchEvent(new CustomEvent('deusedix:console-command', { detail: { command } }));
  try {
    const r = await fetch('/api/console', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command }) });
    const j = await r.json();
    if (!r.ok || j.error) add(['! ' + (j.error || 'The command was not sent.')], true);
    else if (j.queued) add(['… sent: the game runs it as soon as it is ready (a map loading).'], true);
    else if (j.answer) add(j.answer.split(/\r?\n/).map((l) => '< ' + l), true);
  } catch (e) { add(['! ' + e.message], true); }
}

root.querySelector('.cn-filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  filter = b.dataset.filter;
  for (const x of root.querySelectorAll('[data-filter]')) x.classList.toggle('on', x === b);
  refilter();
});
find.addEventListener('input', refilter);
root.querySelector('.cn-clear').onclick = () => { out.replaceChildren(); problems = 0; count.hidden = true; };
root.querySelector('.cn-line').addEventListener('submit', (e) => {
  e.preventDefault();
  const command = input.value.trim();
  if (!command || !running) return;
  if (history[history.length - 1] !== command) history.push(command);
  try { localStorage.setItem('deusedix.console.history', JSON.stringify(history.slice(-50))); } catch (_) { /* fine */ }
  historyAt = history.length;
  input.value = '';
  send(command);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    historyAt = Math.max(0, Math.min(history.length, historyAt + (e.key === 'ArrowUp' ? -1 : 1)));
    input.value = history[historyAt] || '';
  }
  e.stopPropagation();                         // the map editor's one-letter shortcuts stay out
});
root.addEventListener('keydown', (e) => { if (e.target.closest('input')) e.stopPropagation(); });
// a new look at the panel: catch up at once
new IntersectionObserver((seen) => { if (seen.some((x) => x.isIntersecting)) { clearTimeout(timer); poll(); } }).observe(out);
showState();
poll();
window.__console = { send: (c) => running && send(c), add: (lines) => add([].concat(lines), true) };
