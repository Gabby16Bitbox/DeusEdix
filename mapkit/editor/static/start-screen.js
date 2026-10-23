import { readProjectMapPrefs, writeProjectMapPref, isCustomProject, isTrainingProject } from './projects.js';
import { isTemporaryTutorial } from './tutorial-session.js';
import { doctorVoice } from './doctor-voice.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function createStartScreen({ open, create, refresh, save, clear, hasChanges, project: initialProject, openProjects, exitTutorial }) {
  const root = $('#startscreen');
  let project = initialProject;
  const prefs = () => readProjectMapPrefs(project);
  const setPref = (name, value) => writeProjectMapPref(name, value, project);
  let maps = [], missions = [], pickedFile = null, working = false, leavePending = null;
  root.innerHTML = `<div class="start-inner">
    <header class="start-brand"><svg viewBox="0 0 48 48" aria-hidden="true"><use href="/static/deusedix-mark.svg#mark"/></svg>
      <div><h1>DeusEdix</h1><p>Map editor for Deus Ex and Revision</p></div></header>
    <div class="start-projectbar"><div><b id="start-project-name"></b><span id="start-project-kind"></span></div><button id="start-projects">Projects…</button></div>
    <div class="start-actions"><button class="start-action" id="start-new">
      <svg class="start-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M19 3H7v26h18V9l-6-6Z M19 3v7h6 M11 19h10 M16 14v10"/></svg>
      <span class="start-action-copy"><b>NEW MAP</b><span>Start with an empty room or a copy of a level.</span></span></button>
      <button class="start-action" id="start-open">
        <svg class="start-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 25V7h10l3 4h12v5 M3 25l5-10h22l-5 10H3Z"/></svg>
        <span class="start-action-copy"><b>OPEN MAP</b><span id="start-open-description">Maps in this project and imported .dx files.</span></span></button></div>
    <p class="map-error" id="start-error" role="status"></p>
    <div class="start-lower">
      <section aria-labelledby="start-recent-title"><div class="start-recent-head"><h2 id="start-recent-title">Recent maps</h2><button id="start-clear-recent">Clear recent</button></div><div id="start-recent"></div></section></div></div>`;
  const picker = document.createElement('dialog');
  picker.id = 'map-picker'; picker.className = 'map-dialog'; picker.setAttribute('aria-labelledby','map-picker-title');
  picker.innerHTML = `<header><h2 id="map-picker-title">Open map</h2><button data-close>Close</button></header><main>
    <label for="map-search">Find a map</label><input type="search" id="map-search" placeholder="Name, location or mission" autocomplete="off">
    <div id="map-results"></div><p class="map-empty" id="map-copy-note"></p>
    <button id="map-browse">Browse for a .dx file...</button><input type="file" id="map-file" accept=".dx" hidden>
    <section class="map-import" hidden><label for="map-copy-name">Name of the project copy</label><div><input id="map-copy-name" maxlength="67"><button id="map-import-go">Import copy</button><button id="map-convert-go" hidden>Convert a copy for the original game</button></div>
    <p class="map-empty" id="map-import-file"></p></section><p class="map-error" id="map-picker-error" role="status"></p></main>`;
  document.body.appendChild(picker);
  const leave = document.createElement('dialog');
  leave.id = 'map-leave'; leave.className = 'map-dialog'; leave.setAttribute('aria-labelledby','map-leave-title');
  leave.innerHTML = `<header><h2 id="map-leave-title">Save changes before leaving?</h2></header><main><p>Save your map and Story changes, discard them, or keep working.</p><p class="map-error" role="status"></p></main>
    <footer><button data-leave="cancel">Cancel</button><button data-leave="discard">Discard</button><button data-leave="save" class="primary">Save changes</button></footer>`;
  document.body.appendChild(leave);

  function recent() {
    const saved = Array.isArray(prefs().recentMaps) ? prefs().recentMaps : [];
    return saved.map(entry => maps.find(m => m.script === entry.script)).filter(Boolean).slice(0,8);
  }
  function row(m) {
    const badge = m.kind === 'script' && !m.built ? 'Not built yet' : m.changed ? 'Changed, not installed' : m.kind === 'game' ? 'Original' : '';
    return `<button class="map-row" data-map="${esc(m.script)}"><span><b>${esc(m.label || m.map)}</b><small>${esc(m.map)}.dx</small></span>${badge ? `<span class="map-badge">${badge}</span>` : ''}</button>`;
  }
  function renderRecent() {
    $('#start-recent').innerHTML = recent().map(row).join('') || '<p class="map-empty">Maps you open will appear here.</p>';
    $('#start-clear-recent').hidden = !recent().length;
  }
  function renderResults() {
    const query = $('#map-search').value.trim().toLowerCase();
    const match = m => `${m.map} ${m.label} ${m.mission == null ? '' : String(m.mission).padStart(2,'0')} ${new Map(missions).get(m.mission) || ''}`.toLowerCase().includes(query);
    const group = (label, items) => `<section><h3>${label}</h3>${items.map(row).join('') || '<p class="map-empty">No matching maps.</p>'}</section>`;
    const original = maps.filter(m => m.kind === 'game' && match(m));
    const numbers = [...new Set(original.map(m=>m.mission))].sort((a,b)=>(a ?? 999)-(b ?? 999));
    $('#map-results').innerHTML = group('Recent',recent().filter(match)) + group('Project maps',maps.filter(m=>m.kind !== 'game' && match(m)))
      + (['original', 'legacy'].includes(project?.kind) ? '<section><h3>Original game</h3>' + (numbers.map(n => `<details${query ? ' open' : ''}><summary>${n == null ? 'Other levels' : String(n).padStart(2,'0') + ' · ' + esc(new Map(missions).get(n) || (n===97 ? 'Survival' : n===99 ? 'Endings' : 'Other levels'))}</summary>${original.filter(m=>m.mission===n).map(row).join('')}</details>`).join('') || '<p class="map-empty">No matching maps.</p>') + '</section>' : '');
  }
  function lock(on) {
    working = on;
    for (const el of document.querySelectorAll('#startscreen button, #map-picker button, #map-picker input')) el.disabled = on;
  }
  async function choose(script) {
    if (working) return;
    lock(true);
    $('#map-picker-error').textContent = 'Opening the map...';
    try { if (await open(script)) picker.close(); }
    catch (e) { $('#map-picker-error').textContent = e.message; $('#start-error').textContent = e.message; }
    finally { lock(false); if ($('#map-picker-error').textContent === 'Opening the map...') $('#map-picker-error').textContent = ''; }
  }
  for (const target of [root,picker]) target.addEventListener('click', e => {
    const b = e.target.closest('[data-map]');
    if (b) choose(b.dataset.map);
  });
  $('#start-new').onclick = () => create().catch(error);
  $('#start-projects').onclick = openProjects;
  $('#start-clear-recent').onclick = () => { setPref('recentMaps',[]); setPref('lastMap',null); renderRecent(); };
  $('#start-open').onclick = () => openPicker();
  $('[data-close]',picker).onclick = () => picker.close();
  picker.addEventListener('cancel', e => { if (working) e.preventDefault(); });
  $('#map-search').oninput = renderResults;
  $('#map-browse').onclick = () => $('#map-file').click();
  $('#map-file').onchange = () => {
    pickedFile = $('#map-file').files[0];
    if (!pickedFile) return;
    $('.map-import',picker).hidden = false;
    const stem = pickedFile.name.replace(/\.dx$/i,'').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,59) || 'ImportedMap';
    $('#map-copy-name').value = stem + '.dx';
    $('#map-import-file').textContent = `Source: ${pickedFile.name}. Saved only in this project's maps folder.`;
    $('#map-picker-error').textContent = '';
    $('#map-convert-go').hidden = true;
    $('#map-copy-name').focus();
  };
  $('#map-import-go').onclick = async () => {
    if (!pickedFile || working) return;
    lock(true); $('#map-picker-error').textContent = 'Importing the project copy...';
    try {
      if (pickedFile.size > 128*1024*1024) throw new Error('Choose a map no larger than 128 MB.');
      const r = await fetch('/api/map_import?name='+encodeURIComponent($('#map-copy-name').value.trim()), {method:'POST',headers:{'Content-Type':'application/octet-stream'},body:pickedFile});
      const j = await r.json();
      // a map made for Revision in a project of the original game: a converted copy can be imported instead
      if (!r.ok) { $('#map-convert-go').hidden = !/convert a copy for the original game/i.test(j.error || ''); throw new Error(j.error || 'The map could not be imported.'); }
      await refresh();
      $('#map-picker-error').textContent = 'Copy imported. Opening...';
      if (await open(j.script)) picker.close();
      else $('#map-picker-error').textContent = 'Copy imported. It is available under Project maps.';
    } catch(e) { $('#map-picker-error').textContent = e.message; }
    finally { lock(false); }
  };

  $('#map-convert-go').onclick = async () => {
    if (!pickedFile || working) return;
    lock(true); $('#map-picker-error').textContent = 'Converting a copy for the original game (a minute or two)...';
    try {
      const r = await fetch('/api/map_convert?name='+encodeURIComponent($('#map-copy-name').value.trim()), {method:'POST',headers:{'Content-Type':'application/octet-stream'},body:pickedFile});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'The map could not be converted.');
      $('#map-convert-go').hidden = true;
      await refresh();
      const c = j.conversion || {}, changed = Object.keys(c.replaced_classes || {}).length + Object.keys(c.retextured || {}).length;
      $('#map-picker-error').textContent = `Converted copy imported (${changed} kinds of objects and textures replaced by the original game's). Opening...`;
      if (await open(j.script)) picker.close();
      else $('#map-picker-error').textContent = 'Converted copy imported. It is available under Project maps.';
    } catch(e) { $('#map-picker-error').textContent = e.message; }
    finally { lock(false); }
  };

  function error(e) { $('#start-error').textContent = e.message || String(e); }
  async function openPicker() {
    doctorVoice.stop();
    if (!project) { openProjects(); return; }
    $('#map-picker-error').textContent = '';
    renderResults();
    if (!picker.open) picker.showModal();
    $('#map-search').focus();
    try { await refresh(); renderResults(); } catch(e) { $('#map-picker-error').textContent = e.message; }
  }
  function finishLeave(ok) { leave.close(); const resolve = leavePending; leavePending = null; resolve?.(ok); }
  leave.addEventListener('cancel', e => { e.preventDefault(); finishLeave(false); });
  for (const b of leave.querySelectorAll('[data-leave]')) b.onclick = async () => {
    if (b.dataset.leave === 'cancel') return finishLeave(false);
    if (b.dataset.leave === 'discard') return finishLeave(true);
    for (const button of leave.querySelectorAll('button')) button.disabled = true;
    try { await save(); finishLeave(true); }
    catch(e) { $('.map-error',leave).textContent = e.message; }
    finally { for (const button of leave.querySelectorAll('button')) button.disabled = false; }
  };
  async function confirmLeave() {
    if (!hasChanges()) return true;
    if (leavePending) return false;
    $('.map-error',leave).textContent = '';
    leave.showModal();
    $('[data-leave="cancel"]',leave).focus();
    return new Promise(resolve => { leavePending = resolve; });
  }
  function workspace(open) {
    doctorVoice.stop();
    document.body.classList.toggle('no-map',!open);
    root.hidden = open || !project || isTrainingProject(project);
    for (const id of ['left','right','bottom','view','lgrip','rgrip','bgrip']) {
      const el = document.getElementById(id);
      if (el) { el.inert = !open; el.setAttribute('aria-hidden',String(!open)); }
    }
    window.dispatchEvent(new CustomEvent('deusedix:map-state',{detail:{open}}));
  }
  function opened(script) {
    $('#start-error').textContent = '';
    workspace(true);
    if (!isTemporaryTutorial(project, script)) {
      setPref('recentMaps',[{script},...(Array.isArray(prefs().recentMaps) ? prefs().recentMaps : []).filter(m=>m.script !== script)].slice(0,8));
      setPref('lastMap',script);
    }
    renderRecent();
  }
  function show() { workspace(false); renderRecent(); }
  function setProject(next) {
    project = next;
    $('#start-project-name').textContent = project?.name || '';
    $('#start-project-kind').textContent = ({ custom: 'Independent campaign', original: 'Original campaign', tutorial: 'Training project', training: 'Training project', legacy: 'Existing workspace' })[project?.kind] || '';
    $('#start-open-description').textContent = project?.kind === 'original' ? 'Original levels and your edited copies.' : 'Maps in this project and imported .dx files.';
    $('#map-copy-note').textContent = isCustomProject(project)
      ? 'Copies use this project’s story; original mission scripts, conversations and map exits are disconnected.'
      : 'Original levels open for editing as a copy. The game’s files stay untouched.';
    if (!project) root.hidden = true;
    else if (document.body.classList.contains('no-map')) root.hidden = isTrainingProject(project);
    renderRecent();
  }
  async function closeMap() {
    if (working || !(await confirmLeave())) return false;
    working = true;
    try {
      if (await clear() === false) return false;
      if (isTrainingProject(project)) return await exitTutorial?.();
      show(); $('#start-new').focus(); return true;
    } catch (e) { error(e); return false; }
    finally { working = false; }
  }
  setProject(project); show();
  return { setMaps(data) { maps = data.maps; missions = data.missions; renderRecent(); if(picker.open) renderResults(); },
    show, opened, openPicker, closeMap, confirmLeave, setProject, error, get visible() { return !root.hidden; } };
}
