// Tools > Scripts: write UnrealScript in the editor (server: editor/scripts.py). A script extends UCScript, an
// invisible object placed in the map, a block the rules (Interactions) use: they set it off, call the inputs it
// declares, start on its outputs (editor/LOGIC.md). Compile builds the scripts' own package in a few seconds and
// lists the problems by line (click one to go there).
import { attachToolWindow } from './tool-window.js';
import { parsePorts, writePorts, portsProblem, ARG_TYPES, ARG_WORDS, MAX_PORTS, PORT_ID } from './script-ports.js';

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
        <button type="button" class="sc-portsbtn" aria-expanded="false" title="The inputs the rules can call and the outputs that start rules: a table that writes them in defaultproperties">Inputs and outputs</button>
        <button type="button" class="sc-place" title="Place this script in the map, then click what sets it off (a button, a trigger...)">Place in map</button>
        <button type="button" class="sc-delete" title="Delete this script">Delete</button>
      </div>
      <div class="sc-ports" role="region" aria-label="Inputs and outputs" hidden></div>
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
  text.addEventListener('input', () => { repaint(); portsSoon(); });
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
  $('.sc-portsbtn', el).onclick = () => { portsOpen = !portsOpen; renderPorts(); };
  wirePorts();
  $('.sc-help', el).onclick = () => help();
  $('.sc-close', el).onclick = () => close();
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
  for (const b of el.querySelectorAll('.sc-save, .sc-place, .sc-delete, .sc-portsbtn')) b.disabled = !has;
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
  renderPorts();
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
// ---- the Ports table (P8 slice 5, script-ports.js): the inputs and outputs of the open script, written as its
// defaultproperties lines; the code stays the truth (typed there, the table follows)
let portsOpen = false, portsTimer = 0;
const portsNow = () => parsePorts($('.sc-text', el).value);
function portsSoon() {
  clearTimeout(portsTimer);
  portsTimer = setTimeout(() => { if (!$('.sc-ports', el).contains(document.activeElement)) renderPorts(); }, 300);
}
function renderPorts() {
  const box = $('.sc-ports', el), btn = $('.sc-portsbtn', el);
  btn.setAttribute('aria-expanded', String(portsOpen));
  btn.classList.toggle('on', portsOpen);
  box.hidden = !portsOpen || !current;
  if (box.hidden) return;
  const p = portsNow();
  const type = (t) => ARG_TYPES.map((k) => `<option value="${k}"${k === t ? ' selected' : ''}>${ARG_WORDS[k]}</option>`).join('');
  const row = (kind, x, i) => `<div class="sc-prow" data-kind="${kind}" data-i="${i}">
      <input class="sc-pid" value="${esc(x.id)}" aria-label="Its name in the code" title="Its name in the code (Input's InputName, Output(&quot;...&quot;)): letters, digits and _" spellcheck="false">
      <input class="sc-plabel" value="${esc(x.label === x.id ? '' : x.label)}" placeholder="${kind === 'inputs' ? 'what a rule says: Start it' : 'what a rule says: it is done'}" aria-label="What the rules say" spellcheck="false">
      ${kind === 'inputs' ? `<span class="sc-pargs">${(x.args || []).map((a, k) => `<span class="sc-parg" data-k="${k}"><input class="sc-paname" value="${esc(a.name)}" aria-label="The value's name" title="Its name: Arg(Args, &quot;${esc(a.name)}&quot;) in the code" spellcheck="false"><select class="sc-patype" aria-label="What it takes">${type(a.type)}</select><button type="button" class="sc-parm" title="Take this value away" aria-label="Take this value away">×</button></span>`).join('')}<button type="button" class="sc-paadd" title="A value the rule gives with it (ArgFloat, ArgBool, Arg...)">+ value</button></span>` : ''}
      ${kind === 'outputs' ? `<label class="sc-pcarry" title="The script says OutputValue(&quot;${esc(x.id)}&quot;, 3): the rules it starts read the 3 as Value (Alarms + Value)"><input type="checkbox" class="sc-pcarries"${x.carries ? ' checked' : ''}> with a number</label>` : ''}
      <button type="button" class="sc-prm" title="Take this ${kind === 'inputs' ? 'input' : 'output'} away (the code that uses it stays)" aria-label="Take it away">×</button></div>`;
  const part = (kind, word, list) => `<div class="sc-psec"><div class="sc-ph"><b>${word === 'input' ? 'Inputs' : 'Outputs'}</b><span class="hint">${word === 'input'
    ? 'what a rule can make it do: <code>Input(InputName, Args, Caller)</code>' : 'what it tells the rules: <code>Output("Name")</code> starts the rules on it, <code>OutputValue("Name", 3)</code> with a number'}</span></div>
    ${list.map((x, i) => row(kind, x, i)).join('') || `<div class="hint sc-pnone">No ${word}s.</div>`}
    <button type="button" class="sc-padd" data-kind="${kind}"${list.length >= MAX_PORTS ? ' disabled' : ''} title="At most ${MAX_PORTS}">+ ${word === 'input' ? 'Input' : 'Output'}</button></div>`;
  box.innerHTML = part('inputs', 'input', p.inputs) + part('outputs', 'output', p.outputs);
}
// the table changed: its ports written into the code (one step of the text's own undo), the table drawn again
function writeTable(change, focus) {
  const area = $('.sc-text', el), p = portsNow();
  change(p);
  const why = portsProblem(p);
  if (why) { output(`<div class="sc-bad">${esc(why)}</div>`); renderPorts(); return false; }
  const next = writePorts(area.value, p);
  if (next !== area.value) {
    area.focus();
    area.select();
    document.execCommand('insertText', false, next);      // Ctrl+Z in the code takes it back
    if (area.value !== next) area.value = next;
    el._repaint();
  }
  renderPorts();
  if (focus) $(focus, el)?.focus();
  return true;
}
function wirePorts() {
  const box = $('.sc-ports', el);
  const at = (t) => { const r = t.closest('.sc-prow'); return r ? { kind: r.dataset.kind, i: +r.dataset.i } : null; };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const w = at(b);
    if (b.classList.contains('sc-padd')) {
      const kind = b.dataset.kind;
      writeTable((p) => {
        const used = new Set([...p.inputs, ...p.outputs].map((x) => x.id.toLowerCase()));
        let n = p[kind].length + 1, id = (kind === 'inputs' ? 'Input' : 'Output') + n;
        while (used.has(id.toLowerCase())) id = (kind === 'inputs' ? 'Input' : 'Output') + ++n;
        p[kind].push(kind === 'inputs' ? { id, label: id, args: [] } : { id, label: id });
      }, `.sc-prow[data-kind="${kind}"]:last-of-type .sc-pid`);
    } else if (b.classList.contains('sc-prm') && w) writeTable((p) => { p[w.kind].splice(w.i, 1); });
    else if (b.classList.contains('sc-paadd') && w) writeTable((p) => {
      const args = p.inputs[w.i].args, names = new Set(args.map((a) => a.name.toLowerCase()));
      let n = args.length + 1;
      while (names.has('value' + n)) n++;
      args.push({ name: 'Value' + n, type: 'number' });
    }, `.sc-prow[data-kind="inputs"][data-i="${w.i}"] .sc-parg:last-of-type .sc-paname`);
    else if (b.classList.contains('sc-parm') && w) writeTable((p) => { p.inputs[w.i].args.splice(+b.closest('.sc-parg').dataset.k, 1); });
  });
  box.addEventListener('change', (e) => {
    const t = e.target, w = at(t);
    if (!w) return;
    const k = t.closest('.sc-parg') ? +t.closest('.sc-parg').dataset.k : -1;
    if (t.classList.contains('sc-pid')) {
      const from = portsNow()[w.kind][w.i]?.id, to = t.value.trim();
      if (!PORT_ID.test(to)) { output('<div class="sc-bad">A name has letters, digits and _ only, and starts with a letter.</div>'); renderPorts(); return; }
      if (writeTable((p) => { const x = p[w.kind][w.i]; if (x.label === x.id) x.label = to; x.id = to; }) && from && from !== to) renamed(w.kind, from, to);
    } else if (t.classList.contains('sc-plabel')) writeTable((p) => { const x = p[w.kind][w.i]; x.label = t.value.trim() || x.id; });
    else if (t.classList.contains('sc-paname') && k >= 0) writeTable((p) => { p.inputs[w.i].args[k].name = t.value.trim(); });
    else if (t.classList.contains('sc-patype') && k >= 0) writeTable((p) => { p.inputs[w.i].args[k].type = t.value; });
    else if (t.classList.contains('sc-pcarries')) writeTable((p) => { const x = p.outputs[w.i]; if (t.checked) x.carries = true; else delete x.carries; });
  });
}
// a port renamed: the rules of the map open that use it may follow (one undoable step of the map editor)
function renamed(kind, from, to) {
  const cls = `${info.package}.${current}`, word = kind === 'inputs' ? 'input' : 'output';
  const n = window.__editor?.scriptPortUses?.(cls, kind, from) || 0;
  const code = kind === 'inputs' ? `case "${from}":` : `Output("${from}")`;
  const note = `<div class="hint">Change the code too, where it says <code>${esc(code)}</code>.</div>`;
  if (!n) { output(`<div class="sc-ok">The ${word} "${esc(from)}" is now "${esc(to)}".</div>${note}`); return; }
  output(`<div class="sc-ok">The ${word} "${esc(from)}" is now "${esc(to)}". ${n} rule${n === 1 ? '' : 's'} of this map use${n === 1 ? 's' : ''} "${esc(from)}".
    <button type="button" class="sc-follow">Make ${n === 1 ? 'it' : 'them'} use "${esc(to)}"</button></div>${note}`);
  $('.sc-follow', el).onclick = () => {
    const done = window.__editor?.renameScriptPort?.(cls, kind, from, to) || 0;
    output(`<div class="sc-ok">${done} rule${done === 1 ? '' : 's'} of this map now use${done === 1 ? 's' : ''} "${esc(to)}" (Ctrl+Z in the map editor takes it back). Other maps keep "${esc(from)}".</div>${note}`);
  };
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
    <code>Output("Done")</code> starts the rules on it. An output declared with <code>Args="Value"</code> comes with a number:
    <code>OutputValue("Found", 3)</code> (and who did it: <code>OutputValue("Found", 3, Other)</code>); the rules it starts
    use the number as <i>Value</i> (Coins + Value). The template <i>A block</i> shows both.<br>
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
