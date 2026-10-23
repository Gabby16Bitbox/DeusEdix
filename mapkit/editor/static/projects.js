import { mountMods } from './mods-hub.js';
import { doctorVoice, DOCTOR_WELCOME } from './doctor-voice.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const isTrainingProject = project => ['tutorial', 'training'].includes(project?.kind);
export const isCustomProject = project => project?.kind === 'custom';
export function projectStorageKey(name, project = globalThis.window?.__projectContext) {
  return `deusedix.project:${encodeURIComponent(project?.id || 'manager')}:${name}`;
}
export function readProjectMapPrefs(project = window.__projectContext) {
  try {
    const raw = localStorage.getItem(projectStorageKey('maps', project));
    if (raw) { const data = JSON.parse(raw); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; }
    // Existing workspace preferences remain available after the first upgrade.
    if (project?.kind === 'legacy') {
      const old = window.__menubar?.prefs || {};
      return { recentMaps: old.recentMaps || [], lastMap: old.lastMap || null };
    }
  } catch (_) { /* optional browser preferences */ }
  return {};
}
export function writeProjectMapPref(name, value, project = window.__projectContext) {
  try { localStorage.setItem(projectStorageKey('maps', project), JSON.stringify({ ...readProjectMapPrefs(project), [name]: value })); }
  catch (_) { /* map editing also works without browser storage */ }
}
export function unsavedProjectTools(tools = window) {
  return [tools.__studio?.state?.dirty && 'Animator', tools.__texedit?.state?.dirty && 'Texture Editor',
    tools.__characters?.dirty && 'Character Creator'].filter(Boolean);
}
export function projectFolder(name, base) {
  const folder = String(name).trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  if (!base || !folder) return '';
  return String(base).replace(/[\\/]+$/, '') + (String(base).includes('\\') ? '\\' : '/') + folder;
}

const ICONS = {
  original: '<path d="M4 4h7c2 0 3 1 3 2v16c0-1-1-2-3-2H4V4Zm20 0h-7c-2 0-3 1-3 2v16c0-1 1-2 3-2h7V4Z"/>',
  tutorial: '<path d="m2 10 12-6 12 6-12 6-12-6Zm5 3v7c4 3 10 3 14 0v-7m5-3v9"/>',
  legacy: '<path d="M4 8h20v15H4V8Zm-1-5h22v5H3V3Zm8 10h6"/>',
  custom: '<path d="M3 7h9l3 3h10v14H3V7Zm0 4h22"/>',
};
const icon = kind => `<svg viewBox="0 0 28 28" aria-hidden="true">${ICONS[kind] || ICONS.custom}</svg>`;
const description = project => ({ original: 'The original campaign, edited on private copies.', tutorial: 'Learn the editor with Dr. Hale.',
  training: 'Learn the editor with Dr. Hale.', legacy: 'Your maps and assets from the existing workspace.',
  workspace: 'Existing mod workspace. Files stay in their original folder.', custom: 'Independent campaign' }[project.kind] || 'Campaign project');
// the game a project is made for: Revision unless it says otherwise (every project made before had none)
export const projectGame = project => project?.target || 'revision';
export const trainingProjectId = project => !project?.id ? null : projectGame(project) === 'vanilla' ? 'training-vanilla' : 'training-revision';
export const trainingProjectForGame = game => ({ revision: 'training-revision', vanilla: 'training-vanilla' })[game] || null;
export function projectNavigationUrl(value, { tutorial = false, current = null, fromHome = false, base = globalThis.location?.href } = {}) {
  if (!value) throw new Error('The project did not return an editor address.');
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The project returned an invalid editor address.');
  if (tutorial) {
    url.searchParams.set('tutorial', '1');
    const parent = fromHome ? 'home' : isTrainingProject(current) ? new URL(base).searchParams.get('tutorialFrom') : current?.id;
    if (parent) url.searchParams.set('tutorialFrom', parent);
  }
  return url;
}
const GAME_LABELS = { revision: 'Deus Ex: Revision', vanilla: 'Deus Ex (original game)' };
const HALF_LABELS = { revision: 'Revision', vanilla: 'Original game' };

export function createProjectHub({ confirmLeave, onCurrent, onVisibility }) {
  let current = window.__projectContext?.id ? window.__projectContext : null, projects = [], defaultLocation = '', working = false, ready = false, games = [];
  let trainingGame = projectGame(current), doctorAvailable = false;
  try { trainingGame = localStorage.getItem('deusedix.trainingGame') || trainingGame; } catch (_) { /* optional preference */ }
  const gameName = id => games.find(g => g.id === id)?.name || GAME_LABELS[id] || id;
  const installed = id => !games.length || games.some(g => g.id === id && g.installed);
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/static/projects.css'; document.head.appendChild(css);
  const root = document.createElement('section'); root.id = 'projecthub'; root.hidden = !!current;
  root.setAttribute('aria-labelledby', 'projects-title');
  root.innerHTML = `<div class="projects-inner"><header class="projects-heading">
    <div class="projects-brand"><svg viewBox="0 0 48 48" aria-hidden="true"><use href="/static/deusedix-mark.svg#mark"/></svg><div><span>DeusEdix</span><h1 id="projects-title">Projects</h1></div></div>
    <button id="projects-back" hidden>Back to project</button></header>
    <div class="projects-toolbar"><label class="projects-search"><span class="sr-project">Search projects</span><input type="search" id="projects-search" placeholder="Search projects" autocomplete="off"></label>
    <button id="projects-open">Open project…</button><button id="projects-new" class="primary">New project</button></div>
    <p id="projects-error" role="status"></p><div class="projects-featured"><div id="projects-builtins"></div>
    <section id="projects-training" class="project-row project-builtin project-training" aria-labelledby="projects-training-title">
      ${icon('tutorial')}<div class="project-copy"><b id="projects-training-title">Interactive tutorial</b><span>Training with Dr. Hale</span>
      <div class="projects-training-controls"><label class="sr-project" for="projects-training-game">Tutorial game</label>
        <select id="projects-training-game" aria-describedby="projects-training-note"></select><button id="projects-training-start">Start tutorial</button></div>
      <small id="projects-training-note">Temporary session · changes are not saved.</small>
      <div class="projects-doctor-audio"><button type="button" id="projects-doctor-listen" disabled>Listen to Dr. Hale</button><button type="button" id="projects-doctor-mute">Mute audio</button></div>
      <small id="projects-doctor-status" role="status"></small></div></section></div>
    <section class="projects-owned"><h2>Your campaigns</h2><div id="projects-list"></div></section>
    <section class="projects-owned projects-mods" id="projects-mods" aria-label="Mods"></section>
    <div class="projects-foot"><span id="projects-location"></span><button id="projects-retry">Refresh</button></div></div>`;
  document.body.appendChild(root);
  mountMods(root.querySelector('#projects-mods'));           // installed mods: Play, Remove, Install mod... (mods-hub.js)
  const $ = selector => root.querySelector(selector);
  const dialog = document.createElement('dialog'); dialog.id = 'project-dialog'; dialog.className = 'map-dialog project-dialog';
  dialog.setAttribute('aria-labelledby', 'project-dialog-title'); document.body.appendChild(dialog);
  const background = new Map();
  function isolate(open) {
    if (open) {
      for (const el of document.body.children) {
        if (el === root || el === dialog || ['SCRIPT', 'LINK', 'STYLE', 'DIALOG'].includes(el.tagName) || ['top', 'menubar', 'mb-dialog'].includes(el.id)) continue;
        if (!background.has(el)) background.set(el, el.inert);
        el.inert = true;
      }
    } else {
      for (const [el, inert] of background) el.inert = inert;
      background.clear();
    }
    onVisibility?.(open);
  }
  function error(e) { $('#projects-error').textContent = e?.message || String(e || ''); }
  function render() {
    const query = $('#projects-search').value.trim().toLowerCase();
    // One shared tutorial launcher in the home; training workspaces are not campaigns.
    const items = projects.filter(p => !isTrainingProject(p) && `${p.name || ''} ${p.path || ''} ${description(p)} ${gameName(projectGame(p))} ${HALF_LABELS[projectGame(p)] || ''}`.toLowerCase().includes(query));
    const order = { original: 0, legacy: 1, tutorial: 2, training: 2 };
    const builtins = items.filter(p => p.kind in order).sort((a, b) => order[a.kind] - order[b.kind]);
    const own = items.filter(p => !builtins.includes(p));
    const row = (p, builtin) => {
      const game = projectGame(p), missing = !installed(game);
      return `<button class="project-row${builtin ? ' project-builtin' : ''}" data-project="${esc(p.id)}"${missing ? ' data-unavailable="1"' : ''}>
      ${icon(p.kind)}<span class="project-copy"><b>${esc(p.name)}</b><span>${esc(description(p))}</span>
      <span class="project-game">${missing ? `Needs ${esc(gameName(game))}, not installed` : esc(gameName(game))}</span>${p.path ? `<small>${esc(p.path)}</small>` : ''}</span>
      ${p.id === current?.id ? '<span class="project-current">Open</span>' : ''}</button>`;
    };
    // the original campaign of each game: one card split in half, a half for each game
    const stories = builtins.filter(p => p.kind === 'original').sort((a, b) => (projectGame(a) === 'revision' ? 0 : 1) - (projectGame(b) === 'revision' ? 0 : 1));
    const half = p => {
      const game = projectGame(p), missing = !installed(game);
      return `<button class="project-half" data-project="${esc(p.id)}"${missing ? ' data-unavailable="1"' : ''} title="${esc(p.path || '')}"
        aria-label="Deus Ex story · ${esc(gameName(game))}${missing ? ' · not installed' : p.id === current?.id ? ' · open now' : ''}"><b>${esc(HALF_LABELS[game] || gameName(game))}</b>
        ${missing ? '<span>Not installed</span>' : p.id === current?.id ? '<span>Open now</span>' : ''}</button>`;
    };
    const storyCard = stories.length > 1 ? `<div class="project-row project-builtin project-pair">${icon('original')}<span class="project-copy">
      <b>Deus Ex story</b><span>${esc(description(stories[0]))}</span><span class="project-halves">${stories.map(half).join('')}</span></span></div>` : '';
    $('#projects-builtins').innerHTML = storyCard + builtins.filter(p => !(storyCard && p.kind === 'original')).map(p => row(p, true)).join('');
    $('#projects-list').innerHTML = own.map(p => row(p, false)).join('') || `<p class="projects-empty">${!ready ? 'Loading projects…' : query ? 'No matching campaigns.' : 'Create a project to start an independent campaign.'}</p>`;
    $('#projects-back').hidden = !current;
    $('#projects-back').textContent = current ? `Back to ${current.name}` : 'Back to project';
    $('#projects-location').textContent = defaultLocation ? `Default folder: ${defaultLocation}` : '';
    for (const button of root.querySelectorAll('button')) button.disabled = working || button.dataset.unavailable === '1';
    const choices = Object.keys(GAME_LABELS), available = choices.filter(installed);
    if (!available.includes(trainingGame)) trainingGame = available[0] || 'revision';
    $('#projects-training-game').innerHTML = choices.map(game => `<option value="${game}"${game === trainingGame ? ' selected' : ''}${installed(game) ? '' : ' disabled'}>${esc(gameName(game))}${installed(game) ? '' : ' (not installed)'}</option>`).join('');
    $('#projects-training-note').textContent = ready && !available.length ? 'Install Revision or Deus Ex to start.' : 'Temporary session · changes are not saved.';
    syncTrainingControls();
  }
  function show() { root.hidden = false; document.body.classList.add('project-hub-open'); isolate(true); render(); $('#projects-search').focus(); }
  function hide() {
    if (!current) return;
    doctorVoice.stop();
    root.hidden = true; document.body.classList.remove('project-hub-open');
    isolate(false);
    document.getElementById('project-menu-button')?.focus();
  }
  async function api(path, body, { signal } = {}) {
    const response = await fetch(path, body === undefined ? { signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'The project could not be opened.'),
      { code: result.code, retryable: result.retryable === true });
    return result;
  }
  async function init() {
    try {
      const data = await api('/api/projects');
      current = data.current || null; projects = data.projects || []; defaultLocation = data.defaultLocation || ''; games = data.games || []; ready = true;
      onCurrent?.(current); error(''); render(); if (!current) show();
      return current;
    } catch (e) { ready = true; error(e); render(); if (!current) show(); return current; }
  }
  function lock(on) {
    working = on;
    for (const el of [...root.querySelectorAll('button, input, select'), ...dialog.querySelectorAll('button, input, select')]) el.disabled = on || el.dataset.unavailable === '1';
    syncTrainingControls();
  }
  function syncTrainingControls() {
    const unavailable = working || !ready || !installed(trainingGame);
    $('#projects-training-game').disabled = unavailable;
    $('#projects-training-start').disabled = unavailable;
    $('#projects-doctor-listen').disabled = working || !doctorAvailable;
  }
  function navigate(value, tutorial = false, fromHome = false) {
    const url = projectNavigationUrl(value, { tutorial, current, fromHome, base: window.location.href });
    window.__projectNavigation = true;
    window.location.assign(url.href);
  }
  async function openProject(project, tutorial = false, fromHome = false) {
    if (working) return false;
    if (project.id && project.id === current?.id) {
      if (tutorial) {
        if (!(await confirmLeave()) || working) return false;
        if (fromHome) history.replaceState(null, '', projectNavigationUrl(window.location.href, { tutorial, current, fromHome }));
      }
      hide(); if (tutorial) return startTutorialHere(); return true;
    }
    if (!(await confirmLeave())) return false;
    if (working) return false; // Another click may have opened it while confirmation was pending.
    lock(true); error('Opening project…');
    if (tutorial) window.__tutorialLoading?.show(`Preparing the ${gameName(projectGame(project))} tutorial workspace…`);
    const opening = new AbortController(), leave = () => opening.abort();
    window.addEventListener('pagehide', leave, { once: true });
    try {
      const descriptor = { ...project };
      const attempt = () => api('/api/projects/open', descriptor, { signal: opening.signal });
      const result = tutorial ? await waitForProjectTransition(attempt, { signal: opening.signal, timeoutMs: 120000,
        onWait: () => window.__tutorialLoading?.show('Finishing the current operation before opening the tutorial…') }) : await attempt();
      if (opening.signal.aborted) return false;
      if (tutorial) window.__tutorialLoading?.show('Opening the tutorial editor…');
      navigate(result.url, tutorial, fromHome); return true;
    }
    catch (e) {
      if (e.name === 'AbortError') return false;
      error(e);
      if (tutorial) window.__tutorialLoading?.fail(e, () => openProject(project, true, fromHome));
      if (dialog.open) dialog.querySelector('.project-error').textContent = e.message;
      return false;
    }
    finally { window.removeEventListener('pagehide', leave); lock(false); }
  }
  function openDialog(mode) {
    if (working) return;
    const create = mode === 'create';
    dialog.innerHTML = `<form><header><h2 id="project-dialog-title">${create ? 'New project' : 'Open project'}</h2><button type="button" data-cancel>Close</button></header><main>
      ${create ? '<label for="project-name">Name</label><input id="project-name" required maxlength="80" autocomplete="off" placeholder="My campaign">' : ''}
      ${create ? `<label for="project-game">Game</label><select id="project-game">${(games.length ? games : [{ id: 'revision', name: GAME_LABELS.revision, installed: true }])
        .map(g => `<option value="${esc(g.id)}"${g.installed ? '' : ' disabled'}>${esc(g.name)}${g.installed ? '' : ' (not installed)'}</option>`).join('')}</select>
      <p class="project-note">The game its maps are made for and played in. It cannot be changed later.</p>` : ''}
      <label for="project-path">${create ? 'Project folder' : 'Existing project folder'}</label><input id="project-path" ${create ? '' : 'required'} autocomplete="off" spellcheck="false" placeholder="${esc(create ? defaultLocation : 'C:\\Projects\\My campaign')}">
      <p class="project-note">${create ? 'A separate campaign with its own maps, story and assets. The folder is created for this project.' : 'Paste the path to a DeusEdix project or existing editor workspace.'}</p>
      <p class="project-error" role="status"></p></main><footer><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">${create ? 'Create project' : 'Open project'}</button></footer></form>`;
    for (const b of dialog.querySelectorAll('[data-cancel]')) b.onclick = () => dialog.close();
    let automaticPath = true;
    const path = dialog.querySelector('#project-path');
    if (create) {
      path.oninput = () => { automaticPath = !path.value; };
      dialog.querySelector('#project-name').oninput = e => { if (automaticPath) path.value = projectFolder(e.target.value, defaultLocation); };
    }
    dialog.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      if (working) return;
      if (!create) { await openProject({ path: path.value.trim() }); return; }
      if (!(await confirmLeave())) return;
      lock(true);
      const message = dialog.querySelector('.project-error'); message.textContent = 'Creating project…';
      try {
        const result = await api('/api/projects/create', { name: dialog.querySelector('#project-name').value.trim(), location: path.value.trim() || undefined,
          target: dialog.querySelector('#project-game')?.value || undefined });
        const opened = result.url ? result : await api('/api/projects/open', { id: result.project.id });
        navigate(opened.url);
      } catch (err) { message.textContent = err.message; }
      finally { lock(false); }
    };
    const game = dialog.querySelector('#project-game');
    if (game && game.selectedOptions[0]?.disabled) game.value = [...game.options].find(o => !o.disabled)?.value || game.value;
    if (game && !game.value) {          // no game of the folder can be used: nothing to create
      dialog.querySelector('button[type=submit]').disabled = true;
      dialog.querySelector('.project-error').textContent = 'Deus Ex is not installed in the game folder.';
    }
    if (!dialog.open) dialog.showModal();
    dialog.querySelector(create ? '#project-name' : '#project-path').focus();
  }
  async function closeProject() {
    if (!current) { show(); return; }
    if (working || !(await confirmLeave())) return;
    lock(true);
    try { const result = await api('/api/projects/close', {}); navigate(result.url); }
    catch (e) { show(); error(e); }
    finally { lock(false); }
  }
  async function startTutorialHere() {
    doctorVoice.stop();
    window.__tutorialLoading?.show('Loading the tutorial tools…');
    for (let i = 0; !window.__tutorial && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 100));
    if (!window.__tutorial) {
      const message = 'The tutorial tools could not be loaded. Try again.';
      error(message); window.__tutorialLoading?.fail(message, startTutorialHere); return false;
    }
    try { return await window.__tutorial.start(); }
    catch (e) { error(e); window.__tutorialLoading?.fail(e, startTutorialHere); return false; }
  }
  async function training(target = $('#projects-training-game').value) {
    const id = trainingProjectForGame(target);
    if (working) return false;
    if (!ready || !id || !installed(target)) { error('Choose an installed game for the tutorial.'); return false; }
    doctorVoice.stop();
    return openProject({ id, target }, true, true);
  }
  async function leaveTraining() {
    if (!isTrainingProject(current)) return false;
    const parent = new URL(location.href).searchParams.get('tutorialFrom');
    if (parent === 'home') return closeProject();
    const previous = projects.find(p => p.id === parent && !isTrainingProject(p) && projectGame(p) === projectGame(current));
    const id = previous?.id || (projectGame(current) === 'vanilla' ? 'deusex-goty' : 'deusex-story');
    const returned = await openProject({ id });
    if (!returned) show();
    return returned;
  }
  root.addEventListener('click', e => { const row = e.target.closest('[data-project]'); if (row) openProject({ id: row.dataset.project }); });
  $('#projects-new').onclick = () => openDialog('create'); $('#projects-open').onclick = () => openDialog('open');
  $('#projects-back').onclick = hide; $('#projects-retry').onclick = init; $('#projects-search').oninput = render;
  $('#projects-training-start').onclick = () => training();
  $('#projects-training-game').onchange = event => {
    trainingGame = event.target.value; doctorVoice.stop();
    try { localStorage.setItem('deusedix.trainingGame', trainingGame); } catch (_) { /* optional preference */ }
    syncTrainingControls();
  };
  $('#projects-doctor-listen').onclick = () => {
    if (doctorVoice.muted) doctorVoice.setMuted(false);
    void doctorVoice.speak(DOCTOR_WELCOME, { owner: 'menu', active: () => !root.hidden });
  };
  $('#projects-doctor-mute').onclick = () => doctorVoice.toggle();
  doctorVoice.has(DOCTOR_WELCOME).then(available => {
    doctorAvailable = available;
    $('#projects-doctor-listen').title = available ? "Listen to Dr. Hale's introduction" : 'Voice not installed yet.';
    $('#projects-doctor-status').textContent = available ? '' : 'Voice not installed yet.';
    syncTrainingControls();
  });
  doctorVoice.subscribe(muted => {
    const button = $('#projects-doctor-mute'); button.textContent = muted ? 'Unmute audio' : 'Mute audio';
    button.setAttribute('aria-label', muted ? 'Unmute tutorial audio' : 'Mute tutorial audio'); button.setAttribute('aria-pressed', String(muted));
  });
  root.addEventListener('click', event => {
    if (event.target.closest('button') && !event.target.closest('.projects-doctor-audio')) doctorVoice.stop();
  }, true);
  dialog.addEventListener('cancel', e => { if (working) e.preventDefault(); });
  // Installed before tool modules register their global shortcuts. Stop their
  // capture listeners too; default text input, Tab and form submission still work.
  for (const type of ['keydown', 'keyup', 'paste']) window.addEventListener(type, e => {
    if (root.hidden) return;
    if (type === 'keydown' && e.key === 'Escape' && current && !working && root.contains(e.target)) { e.preventDefault(); hide(); }
    e.stopImmediatePropagation();
  }, true);
  if (!current) document.body.classList.add('project-hub-open');
  render();
  const controller = { init, show, hide, create: () => openDialog('create'), open: () => openDialog('open'), close: closeProject,
    training, leaveTraining, startTutorialHere, error, get current() { return current; }, get visible() { return !root.hidden; } };
  window.__projects = controller;
  return controller;
}
import { waitForProjectTransition } from './project-transition.js';
