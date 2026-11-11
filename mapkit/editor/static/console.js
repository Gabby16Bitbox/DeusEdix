// The Console panel (a tab next to the Browser, like Unity's): the running game's log as it is written, and a
// line for the game's own console while Play runs (server: /api/console_log, /api/console; in the game:
// UCConsoleLink). Script lines (log() in UnrealScript) stand out; errors and warnings are coloured. The logic log
// (what the rules and the scripts do, editor/LOGIC.md) reads as sentences: a name selects its object, a rule's id
// opens its rule. As Unity's Console (G39): Collapse shows identical lines as one with how many came, Time the seconds
// since Play started, Copy (Ctrl+C in the log) the lines picked or every line shown, and the name of an object of the
// open map in any line selects it (the lines as data: console-lines.js).
import { LOGIC_TAG } from './logic-log.js';
import { playSeconds, timeText, singleRow, addLine, collapseLines, dropLine, nameIndex, lineView, copyText } from './console-lines.js';
const root = document.getElementById('console');
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./console.css', import.meta.url).href;
document.head.appendChild(css);

root.innerHTML = `
  <div class="cn-bar">
    <div class="cn-filters" role="group" aria-label="Show">
      <button type="button" data-filter="all" class="on" title="Every line of the game's log">All</button>
      <button type="button" data-filter="logic" title="What the rules (Interactions) and the scripts do: what ran, what did not and why">Logic</button>
      <button type="button" data-filter="script" title="Lines from scripts (log in UnrealScript) and from this Console">Scripts</button>
      <button type="button" data-filter="problems" title="Errors and warnings only">Problems <span class="cn-count" hidden></span></button>
    </div>
    <div class="cn-toggles" role="group" aria-label="View">
      <button type="button" data-view="collapse" aria-pressed="false" title="Identical lines as one, with how many came (×N)">Collapse</button>
      <button type="button" data-view="time" aria-pressed="false" title="Before each line, the seconds since Play started">Time</button>
    </div>
    <input type="search" class="cn-find" placeholder="Find in log" aria-label="Find in log">
    <span class="cn-gap"></span>
    <span class="cn-state hint"></span>
    <button type="button" class="cn-copy" title="Copy the lines picked (click a line; Ctrl+click, Shift+click: more), or every line shown (Ctrl+C in the log)">Copy</button>
    <button type="button" class="cn-clear" title="Clear the panel (the game's log file stays as it is)">Clear</button>
  </div>
  <div class="cn-out" tabindex="0" aria-label="Game log" aria-live="off" data-keys="Ctrl+C Ctrl+A Up Down Shift+Up Shift+Down Esc"></div>
  <form class="cn-line" autocomplete="off">
    <span class="cn-prompt" aria-hidden="true">&gt;</span>
    <input type="text" class="cn-input" spellcheck="false" aria-label="Console command"
      placeholder="A command for the game while Play runs: god, summon MedKit, set DeusExPlayer Health 100… (↑ ↓: history)">
  </form>`;

const out = root.querySelector('.cn-out'), input = root.querySelector('.cn-input'), stateEl = root.querySelector('.cn-state');
const find = root.querySelector('.cn-find'), count = root.querySelector('.cn-count');
const MAX = 4000;                      // lines kept in the panel
let offset = -1, filter = 'all', running = false, problems = 0, timer = 0, busy = false;
let lines = [], rows = null;           // the lines kept, as data (console-lines.js); with Collapse their rows by text
let playStart = null, playing = false; // when Play started (ms since 1970), for Time; Play on (its own event)
let anchor = null, cursor = null;      // the lines picked: the one Shift picks from, the one the arrows move from
let copyKey = false;                   // a copy event is awaited for the lines (Ctrl+C in the log, Copy refused by the browser)
const rowOf = new WeakMap(), elOf = new WeakMap();      // a line's element -> its row, and back
// Collapse and Time, kept in this browser (as Unity keeps them)
const VIEW = 'deusedix.console.view';
const view = { collapse: false, time: false };
try { const kept = JSON.parse(localStorage.getItem(VIEW) || '{}'); view.collapse = !!kept.collapse; view.time = !!kept.time; } catch (_) { /* no storage: as at first */ }
const history = [];
let historyAt = 0;
try { history.push(...JSON.parse(localStorage.getItem('deusedix.console.history') || '[]').slice(-50)); historyAt = history.length; } catch (_) { /* no storage: no history */ }

function kind(line) {
  if (line.startsWith(LOGIC_TAG)) return 'logic';          // before 'bad': a rule's label may say "Error"
  if (/^DeusEdix console [<>]/.test(line) || line.startsWith('> ')) return 'cmd';
  if (/Ogg File: '\.\.\\Music\\Nothing'/.test(line)) return 'engine';     // Revision's "no music here": harmless
  if (/(^|\s)(Critical|Error)[:,]|\bError\b.*\.uc\(\d+\)|Accessed None|Infinite (script )?recursion|runaway loop/i.test(line)) return 'bad';
  if (/(^|\s)Warning[:,]|ScriptWarning/i.test(line)) return 'warn';
  if (/^ScriptLog:/.test(line)) return 'script';
  return 'engine';
}
function visible(row) {
  const k = row.dataset.kind, q = find.value.trim().toLowerCase();
  const passes = filter === 'all' || (filter === 'script' && (k === 'script' || k === 'cmd')) || (filter === 'logic' && k === 'logic')
    || (filter === 'problems' && (k === 'bad' || k === 'warn'));
  return passes && (!q || row.textContent.toLowerCase().includes(q));
}
// lines that reached the panel at `at` (ms; null: read back from the log when the panel opened, their time unknown)
function add(texts, own = false, at = Date.now()) {
  if (!texts.length) return;
  const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 24;
  const frag = document.createDocumentFragment(), names = mapNames(), t = playSeconds(at, playStart);
  for (const text of texts) {
    const line = { text, kind: own ? 'cmd' : kind(text), t };
    lines.push(line);
    if (line.kind === 'bad' || line.kind === 'warn') problems++;
    const row = rows ? addLine(rows, line) : singleRow(line);
    if (row.count === 1) frag.appendChild(rowElement(row, names));
    else counted(row);                         // Collapse: one more of a line shown
  }
  out.appendChild(frag);
  // past MAX the oldest lines go: their rows, or with Collapse once less in their counts
  for (const old of lines.splice(0, Math.max(0, lines.length - MAX))) {
    if (!rows) { out.firstElementChild.remove(); continue; }
    const row = dropLine(rows, old);
    if (row?.count) counted(row); else elOf.get(row)?.remove();
  }
  count.hidden = !problems;
  count.textContent = problems;
  if (stick) out.scrollTop = out.scrollHeight;
}
// the names of the open map's objects: what a click on a name selects (__editor.selectActor)
function mapNames() { return nameIndex((window.__editor?.proxies?.children || []).map((p) => p.userData.actor?.name)); }
// a row's element: what it shows (console-lines.js lineView: a logic line as its sentence), a name or a rule's id as a
// link, its time and how many came (counted)
function rowElement(row, names) {
  const el = document.createElement('div'), shown = lineView(row.line, names, window.__editor?.mapName);
  el.className = 'cn-row cn-' + row.line.kind;
  el.dataset.kind = row.line.kind;
  if (shown.logic) el.dataset.logic = shown.logic;
  if (shown.unread) el.title = 'A logic line this editor does not read';
  el.append(...shown.parts.map((part) => (typeof part === 'string' ? part : link(part, shown.map))));
  rowOf.set(el, row);
  elOf.set(row, el);
  counted(row);
  el.hidden = !visible(el);
  return el;
}
// a name (a click selects its object) or a rule's id (opens its rule); map: the map they belong to ('' the open one)
function link(part, map) {
  const ref = document.createElement('a');
  ref.href = '#';
  ref.className = 'cn-ref';
  ref.dataset.map = map;
  if (part.rule) { ref.dataset.rule = part.rule; ref.textContent = part.rule; ref.title = 'Open this rule'; }
  else { ref.dataset.actor = part.name; ref.textContent = part.name; ref.title = 'Select it in the map'; }
  return ref;
}
// a row's time (shown with Time on) and how many came (Collapse) as data-time and data-n: console.css draws them, so
// that a text selected and copied by hand leaves them out
function counted(row) {
  const el = elOf.get(row);
  el.dataset.time = timeText(row.line.t);
  if (row.count < 2) {
    if (el.dataset.n) { delete el.dataset.n; el.removeAttribute('title'); }
    return;
  }
  el.dataset.n = row.count;
  el.title = `${row.count} times` + (row.last.t === null ? '' : `, the last ${timeText(row.last.t)} s after Play started`);
}
// every row again from the lines kept: Collapse switched, a map opened (its names), the panel cleared
function render() {
  const names = mapNames();
  rows = view.collapse ? collapseLines(lines) : null;
  anchor = cursor = null;
  out.replaceChildren(...(rows ? [...rows.values()] : lines.map(singleRow)).map((row) => rowElement(row, names)));
  out.scrollTop = out.scrollHeight;
}
// a click on a name selects its object; on a rule's id, the object the rule belongs to (its Interactions show it);
// elsewhere on a line it picks the line
out.addEventListener('click', (e) => {
  const ref = e.target.closest('.cn-ref');
  if (!ref) return pickAt(e);
  e.preventDefault();
  const ed = window.__editor;
  if (!ed) return;
  // a line of another map (Play went on to it, or an earlier session): its names are not this map's objects
  const sameMap = !ref.dataset.map || String(ed.mapName || '').toLowerCase() === ref.dataset.map.toLowerCase();
  if (ref.dataset.actor && !sameMap) return ed.log?.(`${ref.dataset.actor} is in the map ${ref.dataset.map}`);
  if (ref.dataset.actor) return ed.selectActor(ref.dataset.actor);
  const rule = sameMap && (ed.edits.links || []).find((l) => l.id === ref.dataset.rule);
  if (rule && rule.src) ed.selectActor(rule.src);
  else if (rule) ed.log?.(`Rule ${rule.id}: ${rule.label || ''} (Map > Logic shows the rules of the map start)`);
});
// the lines picked to copy, as in a list: a click picks one, Ctrl+click one more (or one less), Shift+click those in
// between; a drag still selects text (and Ctrl+C copies that text)
function pickAt(e) {
  const el = e.target.closest('.cn-row');
  if (el && getSelection().isCollapsed) pick(el, e.shiftKey ? 'range' : e.ctrlKey ? 'toggle' : 'one');
}
// Shift+click picks lines: the browser's own selection of the text from the last click is kept out
out.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !e.shiftKey || !e.target.closest('.cn-row') || e.target.closest('.cn-ref')) return;
  e.preventDefault();
  getSelection().removeAllRanges();
  out.focus({ preventScroll: true });
});
const shownRows = () => [...out.children].filter((el) => !el.hidden);
const textPicked = () => { const s = getSelection(); return !s.isCollapsed && out.contains(s.anchorNode); };
function pick(el, how) {
  const shown = shownRows();
  if (how !== 'toggle') unpick();
  if (how === 'range' && shown.includes(anchor)) {
    const a = shown.indexOf(anchor), b = shown.indexOf(el);
    for (const x of shown.slice(Math.min(a, b), Math.max(a, b) + 1)) x.classList.add('cn-picked');
  } else {
    el.classList.toggle('cn-picked', how !== 'toggle' || !el.classList.contains('cn-picked'));
    anchor = el;
  }
  cursor = el;
  el.scrollIntoView({ block: 'nearest' });
}
function unpick() { for (const el of out.querySelectorAll('.cn-picked')) el.classList.remove('cn-picked'); }
// Up / Down: the line before or after the last one moved to (none yet: the last line, the first)
function step(by, extend) {
  const shown = shownRows(), at = shown.indexOf(cursor);
  const to = shown[at < 0 ? (by < 0 ? shown.length - 1 : 0) : Math.max(0, Math.min(shown.length - 1, at + by))];
  if (to) pick(to, extend ? 'range' : 'one');
}
function pickAll() {
  const shown = shownRows();
  for (const el of shown) el.classList.add('cn-picked');
  anchor = shown[0] || null;
  cursor = shown[shown.length - 1] || null;
}
// what Copy copies: the lines picked, or every line shown (the filter, Find in log), as they read (console-lines.js
// copyText), and what the status bar says then; null with no line shown
function copied() {
  const shown = shownRows(), picked = shown.filter((el) => el.classList.contains('cn-picked'));
  const chosen = (picked.length ? picked : shown).map((el) => rowOf.get(el));
  if (!chosen.length) return null;
  return { text: copyText(chosen, { time: view.time }),
    note: `Copied ${chosen.length} line${chosen.length === 1 ? '' : 's'} of the Console${picked.length ? '' : ' (every line shown)'}.` };
}
// the Copy button (and Ctrl+C when the browser sends no copy event): through the Clipboard API, as Copy as T3D; where
// the page may not write there (a browser that refuses it the permission), through a copy event, as Ctrl+C
async function copy() {
  const ed = window.__editor, c = copied();
  if (!c) { ed?.status('Nothing to copy: the Console shows no line.', 'warn'); return; }
  try {
    await navigator.clipboard.writeText(c.text);
    ed?.status(c.note, 'ok');
  } catch (err) {
    copyKey = true;
    if (document.execCommand('copy') && !copyKey) return;         // the copy listener below copied them
    copyKey = false;
    ed?.status(`The Console could not copy (${err.message}): select the lines with the mouse, then Ctrl+C.`, 'warn');
  }
}
// Ctrl+C in the log goes through the browser's copy event, which reaches the clipboard without asking for permission
// (as the map editor's own Ctrl+C: app.js expectClipboardEvent); if the event does not come, copy() does it
document.addEventListener('copy', (e) => {
  if (!copyKey) return;
  copyKey = false;
  const c = copied();
  if (!c) { window.__editor?.status('Nothing to copy: the Console shows no line.', 'warn'); return; }
  e.preventDefault();
  e.clipboardData.setData('text/plain', c.text);
  window.__editor?.status(c.note, 'ok');
});
function copyByKey() {
  copyKey = true;
  setTimeout(() => { if (copyKey) { copyKey = false; copy(); } });
}
// the log's own keys (its data-keys: the menus' layer leaves them to it), kept from the map editor, whose Ctrl+C copies
// objects: Ctrl+C copies (a text selected: that text), Ctrl+A picks every line shown, Up / Down the line before or
// after (Shift: one more), Esc lets the lines go
out.addEventListener('keydown', (e) => {
  if (e.altKey || e.metaKey) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey && !e.shiftKey;
  if (ctrl && k === 'c') { e.stopPropagation(); if (!textPicked()) copyByKey(); return; }
  if (ctrl && k === 'a') { e.preventDefault(); e.stopPropagation(); pickAll(); return; }
  if (!e.ctrlKey && (k === 'arrowup' || k === 'arrowdown')) { e.preventDefault(); e.stopPropagation(); step(k === 'arrowup' ? -1 : 1, e.shiftKey); return; }
  if (k === 'escape' && out.querySelector('.cn-picked')) { e.stopPropagation(); unpick(); anchor = cursor = null; }
});
function refilter() {
  for (const row of out.children) row.hidden = !visible(row);
  out.scrollTop = out.scrollHeight;
}
// Collapse and Time as pressed
function showView() {
  for (const b of root.querySelectorAll('[data-view]')) {
    b.classList.toggle('on', view[b.dataset.view]);
    b.setAttribute('aria-pressed', String(view[b.dataset.view]));
  }
  root.classList.toggle('cn-timed', view.time);
}
function showState() {
  input.disabled = !running;
  stateEl.textContent = running ? 'Game running' : 'Not running: start Play';
  stateEl.title = running ? 'Commands go to the game' : 'Start Play to send commands to the game';
  stateEl.classList.toggle('on', running);
}
async function poll() {
  timer = 0;
  if (!busy && (root.offsetParent || playing)) {     // while the panel is on screen, and during Play (Time: when lines came)
    busy = true;
    try {
      const r = await fetch('/api/console_log?offset=' + offset);
      if (r.ok) {
        const j = await r.json(), first = offset < 0;
        if (j.offset < offset) {
          add(['— the game started again: a new log —'], true);
          window.dispatchEvent(new CustomEvent('deusedix:logic-restart'));
        }
        // when Play started, for Time: the game's own start as the server knows it, else when this panel saw it start
        if (j.started) playStart = j.started;
        else if (j.running && !running && !first) playStart = Date.now();
        offset = j.offset;
        add(j.lines || [], false, first ? null : Date.now());
        // the logic lines for the trails (logic-trails.js: the Logic window's graph, the 3D view's wires); read back
        // when the panel first looked (at: null) they have no time of their own
        const logic = (j.lines || []).filter((l) => l.startsWith(LOGIC_TAG));
        if (logic.length) window.dispatchEvent(new CustomEvent('deusedix:logic-lines', { detail: { lines: logic, at: first ? null : Date.now(), started: playStart } }));
        if (running !== !!j.running) { running = !!j.running; showState(); }
      }
    } catch (_) { /* the editor's server is restarting: try again later */ }
    busy = false;
  }
  timer = setTimeout(poll, running ? 400 : 1500);
}
// a command to the game: true when it went (the game runs it, at once or once its map has loaded)
async function send(command) {
  add(['> ' + command], true);
  window.dispatchEvent(new CustomEvent('deusedix:console-command', { detail: { command } }));
  try {
    const r = await fetch('/api/console', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command }) });
    const j = await r.json();
    if (!r.ok || j.error) { add(['! ' + (j.error || 'The command was not sent.')], true); return false; }
    if (j.queued) add(['… sent: the game runs it as soon as it is ready (a map loading).'], true);
    else if (j.answer) add(j.answer.split(/\r?\n/).map((l) => '< ' + l), true);
    return true;
  } catch (e) { add(['! ' + e.message], true); return false; }
}

root.querySelector('.cn-filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  filter = b.dataset.filter;
  for (const x of root.querySelectorAll('[data-filter]')) x.classList.toggle('on', x === b);
  refilter();
});
find.addEventListener('input', refilter);
// Collapse and Time: pressed or not, kept in this browser
root.querySelector('.cn-toggles').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  view[b.dataset.view] = !view[b.dataset.view];
  try { localStorage.setItem(VIEW, JSON.stringify(view)); } catch (_) { /* fine */ }
  showView();
  if (b.dataset.view === 'collapse') render();
});
root.querySelector('.cn-copy').onclick = () => copy();
root.querySelector('.cn-clear').onclick = () => { lines = []; render(); problems = 0; count.hidden = true; };
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
// Play on: the log is followed with the panel hidden too, so that each line has its time
window.addEventListener('deusedix:play-state', (e) => {
  playing = !!e.detail?.active;
  if (playing && !busy) { clearTimeout(timer); poll(); }
});
// another map open: the names in the lines are its objects'
window.addEventListener('deusedix:map-state', render);
showView();
render();
showState();
poll();
window.__console = { send: (c) => running && send(c), add: (lines) => add([].concat(lines), true) };
