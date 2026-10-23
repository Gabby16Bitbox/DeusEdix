// Import a mod (Tools > Import a mod..., Scripts > Import...): another mod's folder, .zip or files brought into the
// project as far as they can be (editor/modimport.py): the files are uploaded, the editor says what each one is
// and whether this project's game loads it, then installs what is ticked; what it cannot do, Help explains.
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./mod-import.css', import.meta.url).href;
document.head.appendChild(css);
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KIND = { code: 'Classes and models', textures: 'Textures', sounds: 'Sounds', music: 'Music' };
const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
let el = null, plan = null, busy = false;

async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'The editor did not answer (' + r.status + ').');
  return j;
}
function ensureDom() {
  if (el) return;
  el = document.createElement('div');
  el.id = 'modimport';
  el.innerHTML = `
    <div class="mi-top"><b>Import a mod</b><span class="mi-sp"></span><button type="button" class="mi-help">Help</button><button type="button" class="mi-close">Close</button></div>
    <div class="mi-body">
      <div class="mi-drop">
        <div>Drop the mod here: its folder, its .zip, or some of its files (.u .utx .uax .umx .dx .uc .int)</div>
        <div class="mi-pick"><button type="button" class="mi-folder">Folder…</button><button type="button" class="mi-files">Files or .zip…</button></div>
        <input type="file" class="mi-in-folder" webkitdirectory hidden><input type="file" class="mi-in-files" multiple hidden
          accept=".zip,.u,.utx,.uax,.umx,.dx,.uc,.int,.txt,.md">
      </div>
      <div class="mi-plan"></div>
    </div>
    <div class="mi-foot"><span class="mi-msg"></span><span class="mi-sp"></span><button type="button" class="mi-cancel">Cancel</button><button type="button" class="mi-go primary" disabled>Install</button></div>`;
  document.body.appendChild(el);
  $('.mi-close', el).onclick = close;
  $('.mi-cancel', el).onclick = close;
  $('.mi-help', el).onclick = help;
  $('.mi-folder', el).onclick = () => $('.mi-in-folder', el).click();
  $('.mi-files', el).onclick = () => $('.mi-in-files', el).click();
  for (const inp of [$('.mi-in-folder', el), $('.mi-in-files', el)]) inp.onchange = () => { const f = [...inp.files]; inp.value = ''; upload(f.map((x) => [x, x.webkitRelativePath || x.name])); };
  const drop = $('.mi-drop', el);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('on'); };
  drop.ondragleave = () => drop.classList.remove('on');
  drop.ondrop = async (e) => { e.preventDefault(); drop.classList.remove('on'); upload(await dropped(e.dataTransfer)); };
  $('.mi-go', el).onclick = install;
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
// a dropped folder: every file in it, with its path inside the folder
async function dropped(dt) {
  const out = [], walk = async (entry, path) => {
    if (entry.isFile) out.push([await new Promise((ok, no) => entry.file(ok, no)), path + entry.name]);
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((ok, no) => reader.readEntries(ok, no));
        if (!batch.length) break;
        for (const e of batch) await walk(e, path + entry.name + '/');
      }
    }
  };
  for (const item of [...dt.items]) { const e = item.webkitGetAsEntry?.(); if (e) await walk(e, ''); }
  return out;
}
function say(t, cls = '') { const m = $('.mi-msg', el); m.textContent = t; m.className = 'mi-msg ' + cls; }
async function upload(list) {
  list = list.filter(([f, p]) => /\.(zip|u|utx|uax|umx|dx|uc|int|txt|md)$/i.test(p));
  if (!list.length || busy) { if (!busy) say('No files of a mod there (.u .utx .uax .umx .dx .uc .int or a .zip).', 'bad'); return; }
  busy = true;
  try {
    if (plan) await api('/api/mod_discard', { id: plan.id }).catch(() => {});
    const { id } = await api('/api/mod_new');
    let k = 0;
    for (const [file, path] of list) {
      say(`Reading the mod: ${++k} of ${list.length} (${file.name})`);
      const r = await fetch(`/api/mod_file?id=${id}&path=${encodeURIComponent(path)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `${file.name} was not read`);
    }
    say('Looking at what it has...');
    plan = await api('/api/mod_scan', { id });
    render();
  } catch (e) { say(e.message, 'bad'); }
  busy = false;
}
function render() {
  const P = plan, box = $('.mi-plan', el);
  const row = (group, value, on, label, note, bad) => `<label class="mi-row${bad ? ' bad' : ''}" title="${esc(note)}"><input type="checkbox" data-group="${group}" value="${esc(value)}" ${on ? 'checked' : ''}>
    <span class="mi-label">${label}</span>${note ? `<span class="mi-note">${esc(note)}</span>` : ''}</label>`;
  let h = `<div class="mi-row"><span class="mi-label">Name</span><input class="mi-name" value="${esc(P.name)}" spellcheck="false" title="The mod's folder in the project (letters, digits, _)"></div>`;
  if (P.packages.length) h += '<div class="mi-h">Packages</div>' + P.packages.map((p) => row('packages', p.file, p.loads && !p.skip && !p.added,
    `${esc(p.file.split('/').pop())} <span class="mi-dim">${KIND[p.kind]} · ${size(p.size)}${p.added ? ' · added already' : ''}</span>`,
    p.skip ? p.note : p.loads ? '' : p.note, !p.loads)).join('');
  if (P.sources.length) h += '<div class="mi-h">UnrealScript sources</div>' + P.sources.map((g) => row('sources', g.package, !g.compiled,
    `${esc(g.package)} <span class="mi-dim">${g.classes.length} class${g.classes.length === 1 ? '' : 'es'}: ${esc(g.classes.slice(0, 6).map((c) => c.cls).join(', '))}${g.classes.length > 6 ? '…' : ''}</span>`,
    g.note || 'Made scripts of this project and compiled; taken out again if they do not compile', false)).join('');
  if (P.maps.length) h += '<div class="mi-h">Maps</div>' + P.maps.map((m) => row('maps', m.file, true,
    `${esc(m.file.split('/').pop())} <span class="mi-dim">${size(m.size)}</span>`, 'Imported as a copy of this project (Open a map)', false)).join('');
  if (!P.packages.length && !P.sources.length && !P.maps.length) h += '<div class="mi-empty">Nothing the editor can use: no packages, maps or sources in it.</div>';
  if (P.readme) h += `<details class="mi-readme"><summary>The mod's own instructions</summary><pre>${esc(P.readme)}</pre></details>`;
  box.innerHTML = h;
  const bad = P.packages.filter((p) => !p.loads).length;
  say(bad ? `${bad} package${bad === 1 ? '' : 's'} ${P.game} cannot load (red): see why on each, and Help.` : `Ready for ${P.game}: untick what you do not want, then Install.`, bad ? 'warn' : '');
  $('.mi-go', el).disabled = false;
}
async function install() {
  if (!plan || busy) return;
  const ticked = (g) => [...el.querySelectorAll(`[data-group="${g}"]:checked`)].map((c) => c.value);
  busy = true;
  $('.mi-go', el).disabled = true;
  say('Installing...');
  try {
    const r = await api('/api/mod_install', { id: plan.id, name: $('.mi-name', el).value.trim(), packages: ticked('packages'), sources: ticked('sources'), maps: ticked('maps') });
    const probs = (r.problems || []).map((p) => `<li>${p.script ? esc(p.script) + '.uc(' + p.line + '): ' : ''}${esc(p.message)}</li>`).join('');
    $('.mi-plan', el).innerHTML = `<div class="mi-h">${r.ok ? 'Done' : 'Done in part'}</div><ul class="mi-done">${(r.lines || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
      + (probs ? `<div class="mi-h bad">What did not work</div><ul class="mi-done bad">${probs}</ul><button type="button" class="mi-help2">How to do it by hand</button>` : '');
    if ($('.mi-help2', el)) $('.mi-help2', el).onclick = help;
    say(r.ok ? 'Installed: its objects are in the Browser (Objects), its maps in Open a map, its scripts in Tools > Scripts.' : 'Some parts could not be installed: see below.', r.ok ? 'ok' : 'bad');
    if (r.ok) plan = null;
    window.__scriptsPanel?.reload?.();
    window.__editor?.loadMaps?.();
  } catch (e) { say(e.message, 'bad'); $('.mi-go', el).disabled = false; }
  busy = false;
}
function help() {
  $('.mi-plan', el).innerHTML = `<div class="mi-help-text">
    <div class="mi-h">What the editor does with a mod</div>
    <p><b>Packages</b> (.u .utx .uax .umx) are kept in the project (tools/mapkit/mods/&lt;name&gt;): the editor loads them,
    their objects appear in the Browser, and they are installed next to your maps, so the game finds them when you Play.</p>
    <p><b>Red packages</b> were made for another game or need a package that is not here (the reason is on the row).
    Add the missing package too (it often comes with the mod or with another mod it needs), or use a version made for this project's game.</p>
    <p><b>Sources</b> (.uc) of a package that came without its .u become scripts of this project and are compiled.
    If they do not compile, they are taken out again and the errors are listed: usually a class they use is in a package
    that is missing (add it first), or two classes have the same name as yours (rename yours).</p>
    <p><b>Maps</b> (.dx) become copies in this project; a map that uses the mod's packages opens once those are added.</p>
    <div class="mi-h">By hand</div>
    <p>Packages: the Browser's Packages… button adds a .u that is in the game's System folder or anywhere on the disk.
    Sources: Tools &gt; Scripts, + New, paste the class. Maps: Open a map &gt; Browse for a .dx file.</p>
    <p>Mods that replace the game's own classes or its menus (total conversions, new HUDs) are not maps or objects:
    install those as their own instructions say; the editor can still use their packages.</p></div>`;
}
function open(files) {
  ensureDom();
  el.style.display = 'grid';
  $('.mi-go', el).disabled = !plan;
  if (!plan) { $('.mi-plan', el).innerHTML = ''; say(''); }
  el.tabIndex = -1;
  el.focus();
  if (files?.length) upload(files.map((f) => [f, f.webkitRelativePath || f.name]));
}
async function close() {
  if (busy) return;
  if (plan) await api('/api/mod_discard', { id: plan.id }).catch(() => {});
  plan = null;
  el.style.display = 'none';
}
window.__modImport = { open };
