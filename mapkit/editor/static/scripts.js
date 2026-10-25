// Tools > Scripts: write UnrealScript in the editor (server: editor/scripts.py). A script extends UCScript, an
// invisible object placed in the map, a block the rules (Interactions) use: they set it off, call the inputs it
// declares, start on its outputs (editor/LOGIC.md). Compile builds the scripts' own package in a few seconds and
// lists the problems by line (click one to go there).
import { attachToolWindow } from './tool-window.js';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./scripts.css', import.meta.url).href;
document.head.appendChild(css);

const KEYWORDS = new Set(('class extends var local function event if else for foreach while do until return break continue switch case default ' +
  'state begin goto stop new none self super true false static final simulated native latent singular iterator const enum struct ' +
  'defaultproperties abstract config transient placeable optional out coerce private protected localized replication reliable ' +
  'unreliable ignores auto exec').split(' '));
const TYPES = new Set('int float bool byte string name vector rotator actor pawn class object'.split(' '));
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let el = null, info = null, current = null, saved = '', problems = [];

function highlight(text) {
  // comments, strings, names, numbers, words: one pass
  return text.replace(/(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?)|('(?:[^'\n])*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|([<>&])/g,
    (m, comment, str, nm, num, word, sym) => {
      if (comment) return `<span class="sc-c">${esc(comment)}</span>`;
      if (str) return `<span class="sc-s">${esc(str)}</span>`;
      if (nm) return `<span class="sc-n">${esc(nm)}</span>`;
      if (num) return `<span class="sc-num">${num}</span>`;
      if (word) {
        const w = word.toLowerCase();
        return KEYWORDS.has(w) ? `<span class="sc-k">${word}</span>` : TYPES.has(w) ? `<span class="sc-t">${word}</span>` : word;
      }
      return esc(sym);
    }) + '\n';
}

function ensureDom() {
  if (el) return;
  el = document.createElement('div');
  el.id = 'scripts';
  el.innerHTML = `
    <div class="sc-top"><b>Scripts</b><span class="sc-pkg hint"></span><span style="flex:1"></span>
      <button type="button" class="sc-import" title="UnrealScript files (.uc), or a whole mod (its folder or .zip): what each file is, then installed as far as it can be">Import…</button>
      <button type="button" class="sc-help" title="How scripts work">Help</button>
      <button type="button" class="sc-close">Close</button></div>
    <div class="sc-left">
      <div class="sc-h">Scripts</div>
      <div class="sc-list" role="listbox" aria-label="Scripts"></div>
      <form class="sc-new" autocomplete="off">
        <input class="sc-name" placeholder="NewScript" aria-label="Name of a new script" spellcheck="false">
        <select class="sc-kind" aria-label="Start from"></select>
        <button type="submit" title="A new script from the chosen template">+ New</button>
      </form>
    </div>
    <div class="sc-main">
      <div class="sc-bar">
        <span class="sc-title">No script open</span><span class="sc-dirty" hidden>●</span><span style="flex:1"></span>
        <button type="button" class="sc-save" title="Save (Ctrl+S)">Save</button>
        <button type="button" class="sc-compile primary" title="Save every script and compile them (Ctrl+B)">Compile</button>
        <button type="button" class="sc-place" title="Place this script in the map, then click what sets it off (a button, a trigger...)">Place in map</button>
        <button type="button" class="sc-delete" title="Delete this script">Delete</button>
      </div>
      <div class="sc-code">
        <div class="sc-gutter" aria-hidden="true"></div>
        <div class="sc-edit">
          <pre class="sc-hl" aria-hidden="true"></pre>
          <textarea class="sc-text" spellcheck="false" wrap="off" aria-label="Script code" disabled></textarea>
        </div>
      </div>
      <div class="sc-out" aria-live="polite"><div class="hint">Compile shows here what the compiler says. Your log("...") lines appear in the Console while the game runs.</div></div>
    </div>`;
  document.body.appendChild(el);
  attachToolWindow(el, $('.sc-top', el), $('.sc-close', el));
  const text = $('.sc-text', el), hl = $('.sc-hl', el), gutter = $('.sc-gutter', el);
  const repaint = () => {
    hl.innerHTML = highlight(text.value);
    const n = text.value.split('\n').length;
    if (gutter.childElementCount !== n) gutter.innerHTML = Array.from({ length: n }, (_, i) => `<div data-line="${i + 1}">${i + 1}</div>`).join('');
    for (const p of problems) gutter.querySelector(`[data-line="${p.line}"]`)?.classList.add(p.kind === 'error' ? 'sc-gerr' : 'sc-gwarn');
    $('.sc-dirty', el).hidden = text.value === saved;
  };
  text.addEventListener('input', repaint);
  text.addEventListener('scroll', () => { hl.scrollTop = text.scrollTop; hl.scrollLeft = text.scrollLeft; gutter.scrollTop = text.scrollTop; });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {                       // a tab, not the next control
      e.preventDefault();
      document.execCommand('insertText', false, '\t');
    } else if (e.key === 'Enter') {              // keep the indentation of the line
      const before = text.value.slice(0, text.selectionStart), indent = before.slice(before.lastIndexOf('\n') + 1).match(/^\s*/)[0];
      const extra = /\{\s*$/.test(before) ? '\t' : '';
      e.preventDefault();
      document.execCommand('insertText', false, '\n' + indent + extra);
    }
  });
  el.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); compile(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();                          // the map editor's shortcuts stay out while writing
  });
  $('.sc-save', el).onclick = () => save();
  $('.sc-compile', el).onclick = () => compile();
  $('.sc-place', el).onclick = () => place();
  $('.sc-delete', el).onclick = () => remove();
  $('.sc-help', el).onclick = () => help();
  $('.sc-import', el).onclick = () => window.__modImport?.open();
  $('.sc-new', el).addEventListener('submit', (e) => { e.preventDefault(); create(); });
  el._repaint = repaint;
}

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'The editor did not answer (' + r.status + ').');
  return j;
}
function output(html) { $('.sc-out', el).innerHTML = html; }
function renderList() {
  const list = $('.sc-list', el);
  list.innerHTML = info.scripts.length ? info.scripts.map((n) => `<div class="sc-item ${n === current ? 'on' : ''}" role="option" data-name="${n}" aria-selected="${n === current}">${n}</div>`).join('')
    : '<div class="hint sc-empty">No scripts yet: name one below and press + New.</div>';
  for (const item of list.querySelectorAll('[data-name]')) item.onclick = () => openScript(item.dataset.name);
  const text = $('.sc-text', el), has = !!current;
  text.disabled = !has;
  for (const b of el.querySelectorAll('.sc-save, .sc-place, .sc-delete')) b.disabled = !has;
  $('.sc-compile', el).disabled = !info.scripts.length;
  $('.sc-title', el).textContent = has ? `${current}.uc` : 'No script open';
}
async function load() {
  info = await api('/api/scripts');
  $('.sc-pkg', el).textContent = `package ${info.package} · scripts extend ${info.base}`;
  $('.sc-kind', el).innerHTML = info.templates.map((t) => `<option value="${t.id}">${t.label}</option>`).join('');
  window.__scripts = { package: info.package };
  renderList();
}
async function openScript(name) {
  if (current && current !== name && $('.sc-text', el).value !== saved) await save(true);
  const j = await api('/api/script?name=' + encodeURIComponent(name));
  current = name; saved = j.text; problems = problems.filter((p) => p.script === name);
  $('.sc-text', el).value = j.text;
  el._repaint();
  renderList();
  $('.sc-text', el).focus();
}
async function save(quiet) {
  if (!current) return true;
  try {
    const area = $('.sc-text', el), sent = area.value;
    const r = await api('/api/script_save', { name: current, text: sent });
    // the file as the game reads it (typographic quotes and dashes made plain): what the editor shows too, unless
    // something was typed meanwhile (it stays, and shows as not saved)
    const back = typeof r?.text === 'string' ? r.text : sent;
    if (area.value === sent && back !== sent.replace(/\r\n/g, '\n')) {
      const from = area.selectionStart, to = area.selectionEnd;
      area.value = back;
      area.setSelectionRange(Math.min(from, back.length), Math.min(to, back.length));
    }
    saved = area.value === sent && back === sent.replace(/\r\n/g, '\n') ? sent : back;
    portsChanged();                     // its declarations are read from the saved text, before any compile
    el._repaint();
    if (!quiet) output(`<div class="sc-ok">Saved ${current}.uc</div>`);
    return true;
  } catch (e) { output(`<div class="sc-bad">${esc(e.message)}</div>`); return false; }
}
async function create() {
  const name = $('.sc-name', el).value.trim();
  if (!name) { $('.sc-name', el).focus(); return; }
  try {
    if (current && $('.sc-text', el).value !== saved) await save(true);
    await api('/api/script_new', { name, kind: $('.sc-kind', el).value });
    $('.sc-name', el).value = '';
    await load();
    await openScript(name);
    output(`<div class="sc-ok">${name}.uc made from "${esc($('.sc-kind', el).selectedOptions[0].textContent)}". Change it, then Compile.</div>`);
  } catch (e) { output(`<div class="sc-bad">${esc(e.message)}</div>`); }
}
async function compile() {
  if (!(await save(true))) return;
  const button = $('.sc-compile', el);
  button.disabled = true; button.textContent = 'Compiling…';
  output('<div class="hint">Compiling…</div>');
  try {
    const r = await api('/api/scripts_compile', {});
    problems = r.problems || [];
    const rows = problems.map((p, i) => `<div class="sc-prob sc-${p.kind}" data-i="${i}" title="${p.line ? 'Go to the line' : ''}">${p.script ? `<b>${esc(p.script)}</b>${p.line ? ` line ${p.line}` : ''}: ` : ''}${esc(p.message)}</div>`).join('');
    output(`<div class="${r.ok ? 'sc-ok' : 'sc-bad'}">${esc((r.lines || []).join(' '))}${r.note ? ' ' + esc(r.note) : ''}</div>${rows}`);
    for (const row of el.querySelectorAll('.sc-prob')) row.onclick = () => goTo(problems[+row.dataset.i]);
    if (r.ok) portsChanged();
    el._repaint();
    if (!r.ok && problems[0]) goTo(problems[0]);
  } catch (e) { output(`<div class="sc-bad">${esc(e.message)}</div>`); }
  button.textContent = 'Compile'; button.disabled = false;
}
async function goTo(p) {
  if (!p || !p.script) return;
  if (p.script !== current) await openScript(info.scripts.find((n) => n.toLowerCase() === p.script.toLowerCase()) || p.script);
  const text = $('.sc-text', el), lines = text.value.split('\n');
  const start = lines.slice(0, Math.max(0, p.line - 1)).reduce((n, l) => n + l.length + 1, 0);
  text.focus();
  text.setSelectionRange(start, start + (lines[p.line - 1] || '').length);
  const lh = parseFloat(getComputedStyle(text).lineHeight) || 18;
  text.scrollTop = Math.max(0, (p.line - 4) * lh);
}
async function remove() {
  if (!current || !confirm(`Delete the script ${current}? Objects of it placed in maps stop working at their next Rebuild.`)) return;
  try {
    await api('/api/script_delete', { name: current });
    current = null; saved = '';
    $('.sc-text', el).value = '';
    el._repaint();
    await load();
    output('<div class="hint">Deleted. Compile to update the package.</div>');
  } catch (e) { output(`<div class="sc-bad">${esc(e.message)}</div>`); }
}
function place() {
  if (!current || !window.__editor?.placeClass) return;
  const cls = `${info.package}.${current}`;
  close();
  window.__editor.placeClass(cls, current);
}
// the scripts' inputs and outputs may have changed: the editor asks for them again (its rules, the Inspector)
function portsChanged() {
  for (const name of info?.scripts || []) window.__editor?.forgetClass?.(`${info.package}.${name}`);
}
function help() {
  output(`<div class="sc-help-text">
    <b>A script</b> is an invisible object of the map, written in UnrealScript: a block the rules use like a door or a keypad.
    Write the events you need: <code>Started()</code> once when the map is running, <code>Triggered(Other, EventInstigator)</code>
    when a rule switches it on, <code>Untriggered</code> when it switches it off, <code>Repeat()</code> every <code>RepeatEvery</code> seconds,
    and <code>Input(InputName, Args, Caller)</code> for the inputs it declares.<br>
    <b>Inputs and outputs</b> are declared in <code>defaultproperties</code>: <code>Inputs(0)=(Id="Start",Label="Start it",Args="Seconds")</code>,
    <code>Outputs(0)=(Id="Done",Label="it is done")</code>. A rule calls an input (with its arguments: <code>ArgFloat(Args, "Seconds")</code>);
    <code>Output("Done")</code> starts the rules on it. The template <i>A block</i> shows both.<br>
    Helpers: <code>Player()</code>, <code>Say("...")</code>, <code>FindNamed("Light29")</code>, <code>GetFlag('Name')</code>, <code>SetFlag('Name', True)</code>,
    <code>Give(class'Medkit')</code>. <code>log("...")</code> writes to the Console, where the Logic filter shows what the rules and scripts do.<br>
    <b>Steps:</b> + New, change it, Compile (Ctrl+B), Place in map and click what sets it off, Rebuild, Play.
    A <code>var()</code> value of your script can be set per object in the Inspector.</div>`);
}
async function open() {
  ensureDom();
  el.style.display = 'grid';
  try { await load(); } catch (e) { output(`<div class="sc-bad">${esc(e.message)}</div>`); }
  if (!current && info?.scripts.length) openScript(info.scripts[0]);
  else $('.sc-name', el).focus();
}
async function close() {
  if (current && $('.sc-text', el).value !== saved) await save(true);
  el.style.display = 'none';
}
window.__scriptsPanel = { open, reload: () => (el && el.style.display !== 'none' ? load() : null) };
// the scripts' package name for the rest of the editor (a placed script is a logic object)
fetch('/api/scripts').then((r) => r.ok ? r.json() : null).then((j) => { if (j) window.__scripts = { package: j.package }; }).catch(() => {});
