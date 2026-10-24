// The menu bar: File, Edit, View, Map, Tools, Settings, Help in one row at the top, like a Windows
// program, instead of the two rows of buttons (they stay in the page, hidden: the menus press them, so
// what they do does not change). And the Settings window: theme, keyboard shortcuts, camera, grid, the
// 3D view's resolution, kept in this browser (localStorage), never in a map.
//
// Shortcuts: the editor's own keys stay in its code (app.js, cutscene.js). A layer in front of them
// (this module is loaded first, so its listener runs first) turns the key the user chose into the
// editor's own one, and silences the old key of an action that was moved.

import { normalizeAutosaveSettings } from './autosave.js';

const $ = (s, el = document) => el.querySelector(s);
const PREFS = 'deusedix.prefs';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch (e) { return {}; } })();
prefs.keys = prefs.keys || {};
function store() { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) { /* no storage */ } }
const desktop = () => !!(window.pywebview && window.pywebview.api);
const ed = () => window.__editor;

// ---------------------------------------------------------------- shortcuts
// [id, what it does, the editor's own key, when it works: edit (the 3D view), fly (right mouse held), cut (cutscene panel)]
const ACTIONS = [
  ['save', 'Save', 'Ctrl+S', 'edit'], ['undo', 'Undo', 'Ctrl+Z', 'edit'], ['redo', 'Redo', 'Ctrl+Y', 'edit'], ['copy', 'Copy', 'Ctrl+C', 'edit'],
  ['paste', 'Paste', 'Ctrl+V', 'edit'], ['duplicate', 'Duplicate', 'Ctrl+D', 'edit'], ['delete', 'Delete', 'Delete', 'edit'],
  ['move', 'Move tool', 'W', 'edit'], ['rotate', 'Rotate tool', 'E', 'edit'], ['scale', 'Scale tool', 'R', 'edit'],
  ['snap', 'Grid snap on / off', 'G', 'edit'], ['drop', 'Drop to floor / Stick to surface (the mode chosen last)', 'End', 'edit'], ['focus', 'Focus the selection', 'F', 'edit'],
  ['block', 'Add a block', 'B', 'edit'], ['paths', 'AI paths', 'P', 'edit'], ['light', 'Lighting of the view', 'L', 'edit'],
  ['faces', 'Face selection on / off', 'Q', 'edit'], ['vertices', 'Edit vertices of a block on / off', 'V', 'edit'],
  ['measure', 'Measure distances on / off', 'M', 'edit'],
  ['nest', 'Nest the selection', 'Ctrl+G', 'edit'], ['unnest', 'Un-nest', 'Ctrl+Shift+G', 'edit'],
  ['help', 'Quick help', 'H', 'edit'],
  ['fwd', 'Fly forward', 'W', 'fly'], ['back', 'Fly back', 'S', 'fly'], ['left', 'Fly left', 'A', 'fly'],
  ['right', 'Fly right', 'D', 'fly'], ['down', 'Fly down', 'Q', 'fly'], ['up', 'Fly up', 'E', 'fly'],
  ['cutkey', 'Cutscene: add a key', 'K', 'cut'], ['cutplay', 'Cutscene: play / pause', 'Space', 'cut'],
  ['studioprevkey', 'Previous keyframe (selected control)', 'Down', 'studio'],
  ['studionextkey', 'Next keyframe (selected control)', 'Up', 'studio'],
];
const ACTION = Object.fromEntries(ACTIONS.map(([id, label, def, ctx]) => [id, { id, label, def, ctx }]));
const CONTEXTS = { edit: 'In the 3D view', fly: 'Flying (right mouse held)', cut: 'Cutscene panel open', studio: 'Animation Studio' };
const keyOf = (id) => prefs.keys[id] || ACTION[id].def;

const NAMES = { ' ': 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
function keyName(e) {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  return NAMES[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
}
function comboOf(e, fly) {
  const k = keyName(e);
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return '';
  return (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && !fly ? 'Shift+' : '') + k;
}
// the event the editor's code expects for one of its own keys
function eventFor(combo, src, type) {
  const parts = combo.split('+'), k = parts.pop();
  let key = k, code = k;
  if (/^[A-Z]$/.test(k)) { key = k.toLowerCase(); code = 'Key' + k; } else if (/^\d$/.test(k)) code = 'Digit' + k;
  else if (Object.values(NAMES).includes(k)) { key = Object.keys(NAMES).find(x => NAMES[x] === k); code = k === 'Space' ? 'Space' : key; }
  const ev = new KeyboardEvent(type || 'keydown', { key, code, bubbles: true, cancelable: true,
    ctrlKey: parts.includes('Ctrl'), altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift') });
  ev.__deusedix = true;
  return ev;
}

let byUser = {}, silenced = {};
function remapTables() {
  byUser = Object.fromEntries(Object.keys(CONTEXTS).map(c => [c, {}]));
  silenced = Object.fromEntries(Object.keys(CONTEXTS).map(c => [c, new Set()]));
  for (const a of ACTIONS.map((x) => ACTION[x[0]])) {
    const user = keyOf(a.id);
    if (user !== a.def) { byUser[a.ctx][user] = a; silenced[a.ctx].add(a.def); }
  }
  for (const ctx in byUser) for (const k of Object.keys(byUser[ctx])) silenced[ctx].delete(k);
  window.dispatchEvent(new Event('deusedix:shortcuts'));
}
remapTables();

let recording = null;                 // the Settings window waiting for a key
const typing = (t) => t && (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable);
function contextNow() {
  if (window.__studio?.state.open) return 'studio';
  const e = ed();
  if (e && e.cam.look) return 'fly';
  return window.__cutscene && window.__cutscene.isOpen() ? 'cut' : 'edit';
}
function remap(e) {
  if (e.__deusedix) return;
  if (ed()?.playing) return;
  if (window.__projects?.visible) return;
  if (recording) { recordKey(e); return; }
  if (dialog?.classList.contains('open')) return;
  const ctx = contextNow();
  if (e.type === 'keyup') {                               // only flying keys are held
    if (ctx !== 'fly') return;
    const a = byUser.fly[keyName(e)];
    if (a) { e.stopImmediatePropagation(); e.target.dispatchEvent(eventFor(a.def, e, 'keyup')); }
    else if (silenced.fly.has(keyName(e))) e.stopImmediatePropagation();
    return;
  }
  if (ctx !== 'fly' && typing(e.target)) return;
  const combo = comboOf(e, ctx === 'fly');
  if (!combo) return;
  for (const c of ctx === 'cut' ? ['cut', 'edit'] : [ctx]) {
    const a = byUser[c][combo];
    if (a) { e.preventDefault(); e.stopImmediatePropagation(); e.target.dispatchEvent(eventFor(a.def, e)); return; }
    if (silenced[c].has(combo) && !(c === 'edit' && ctx === 'cut' && byUser.cut[combo])) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  }
}
window.addEventListener('keydown', remap, true);
window.addEventListener('keyup', remap, true);
function press(id) {                                       // a menu item doing what a key does
  if (typing(document.activeElement)) document.activeElement.blur();
  document.body.dispatchEvent(eventFor(ACTION[id].def));
}

// ---------------------------------------------------------------- menus
const click = (id) => () => { const b = document.getElementById(id); if (b) b.click(); };
const sep = { sep: true };
const experimentalGeometryItem = () => ({
  label: 'Local geometry… (Experimental)', map: true,
  visible: () => pref('experimentalLocalGeometry') === true,
  enabled: () => !ed()?.temporaryTutorial && !ed()?.playing,
  run: () => ed()?.openExperimentalBsp(),
});
function themes() {
  return [['classic', 'Deus Ex · Classic'], ['classic-rounded', 'Deus Ex · Classic Rounded'], ['mankind', 'Mankind Divided'],
    ['mankind-rounded', 'Mankind Divided · Rounded']].map(([v, label]) => ({
    label, checked: () => ($('#uitheme') || {}).value === v,
    run: () => { const t = $('#uitheme'); if (t) { t.value = v; t.dispatchEvent(new Event('change')); } } }));
}
const lightItem = (mode, label) => ({ label, checked: () => !ed()?.viewMode && ($('#lightmode') || {}).value === mode,
  run: () => { const s = $('#lightmode'); s.value = mode; s.dispatchEvent(new Event('change')); } });
// UnrealEd's views of the map (view-modes.js): the lighting items bring the textured world back
const viewItem = (mode, label) => ({ label, map: true, checked: () => ed()?.viewMode === mode, run: () => ed()?.setViewMode(mode) });
const MENUS = [
  ['File', [
    { label: 'Projects...', run: () => window.__projects?.show() },
    { label: 'New project...', run: () => window.__projects?.create() },
    { label: 'Open project...', run: () => window.__projects?.open() },
    { label: 'Close project', run: () => window.__projects?.close(), enabled: () => !!window.__projects?.current },
    sep,
    { label: 'New map...', project: true, enabled: () => !['training', 'tutorial'].includes(window.__projects?.current?.kind), run: click('newmap') },
    { label: 'Open map...', project: true, enabled: () => !['training', 'tutorial'].includes(window.__projects?.current?.kind), run: () => ed()?.openMapPicker() },
    { label: 'Close map', run: () => ed()?.closeMap(), enabled: () => !!ed()?.script },
    { label: 'Save', key: 'save', enabled: () => !ed()?.temporaryTutorial, run: click('save') },
    { label: 'Revert all changes', run: click('resetall'), enabled: () => !!document.getElementById('resetall') },
    sep,
    { label: 'Install map...', map: true, run: click('install') },
    { label: 'Export mod...', project: true, enabled: () => window.__projects?.current?.kind === 'custom',
      run: () => import('./mod-export.js').then((m) => m.openModExport()) },
    { label: 'Mod packages...', project: true, run: click('bpkgs') },
    sep,
    { label: 'Exit', run: () => window.pywebview.api.exit(), visible: desktop },
  ]],
  ['Edit', [
    { label: 'Undo', key: 'undo', run: () => press('undo') },
    { label: 'Redo', key: 'redo', run: () => press('redo') },
    sep,
    { label: 'Copy', key: 'copy', run: () => press('copy') },
    { label: 'Paste', key: 'paste', run: () => press('paste') },
    // UnrealEd's clipboard: T3D text both ways (Ctrl+V also takes T3D copied in UnrealEd)
    { label: 'Copy as T3D (UnrealEd)', map: true, run: () => ed()?.copyAsT3D() },
    { label: 'Paste T3D (UnrealEd)', map: true, run: () => ed()?.pasteT3D() },
    { label: 'Duplicate', key: 'duplicate', run: () => press('duplicate') },
    { label: 'Delete', key: 'delete', run: () => press('delete') },
    sep,
    { label: 'Nest', key: 'nest', run: () => press('nest') },
    { label: 'Un-nest', key: 'unnest', run: () => press('unnest') },
    sep,
    { label: 'Move tool', key: 'move', run: () => press('move') },
    { label: 'Rotate tool', key: 'rotate', run: () => press('rotate') },
    { label: 'Scale tool', key: 'scale', run: () => press('scale') },
    { label: 'Face selection', key: 'faces', checked: () => !!ed()?.surfaceTools.mode, run: () => press('faces') },
    { label: 'Edit vertices', key: 'vertices', map: true, checked: () => !!ed()?.vertexEdit?.active, run: () => press('vertices') },
    { label: 'Select all of this class', map: true, run: () => ed()?.selectAllOfClass() },
    // UnrealEd's brush clipping, on the editor's blocks (brush-ops.js)
    { label: 'Clip block', map: true, run: () => ed()?.armClip() },
    { label: 'Intersect blocks', map: true, run: () => ed()?.intersectBlocks() },
    { label: 'Deintersect blocks', map: true, run: () => ed()?.deintersectBlocks() },
    // UnrealEd's Order: the blocks are built in their order (a hole cuts the solid blocks before it)
    { label: 'Order: to first', map: true, run: () => ed()?.orderBlocks(true) },
    { label: 'Order: to last', map: true, run: () => ed()?.orderBlocks(false) },
    // UnrealEd's Transform > Mirror, about the middle of the selection (mirror.js)
    { label: 'Mirror X', map: true, run: () => ed()?.mirrorSelection(0) },
    { label: 'Mirror Y', map: true, run: () => ed()?.mirrorSelection(1) },
    { label: 'Mirror Z', map: true, run: () => ed()?.mirrorSelection(2) },
    { label: 'Grid snap', key: 'snap', run: () => press('snap') },
    // Drop to floor / Stick to surface: the one checked is what End (and the Drop button) does
    { label: 'Drop to floor', get key() { return ed()?.placeMode === 'stick' ? '' : 'drop'; }, checked: () => ed()?.placeMode !== 'stick', run: () => ed()?.placeSelected('drop') },
    { label: 'Stick to surface', get key() { return ed()?.placeMode === 'stick' ? 'drop' : ''; }, checked: () => ed()?.placeMode === 'stick', run: () => ed()?.placeSelected('stick') },
    sep,
    { label: 'Find object...', run: () => { window.__workspace?.show('hierarchy'); const s = $('#hsearch'); if (s) { s.focus(); s.select(); } } },
  ]],
  ['View', [
    lightItem('shaded', 'Shaded'), lightItem('lit', 'Game lighting'), lightItem('unlit', 'Unlit'),
    viewItem('wire', 'Wireframe'), viewItem('cuts', 'BSP cuts'), viewItem('zones', 'Zones'),
    { label: 'Next lighting', key: 'light', run: () => press('light') },
    sep,
    { label: 'AI paths', key: 'paths', checked: () => !!document.getElementById('pathsbtn')?.classList.contains('on'), run: click('pathsbtn') },
    { label: 'Test a route', map: true, run: () => { const p = document.getElementById('pathsbtn'), n = document.getElementById('navbtn'); if (p && n && !p.classList.contains('on') && !n.classList.contains('on')) p.click(); click('routebtn')(); } },
    { label: 'Walkable area', map: true, checked: () => !!document.getElementById('navbtn')?.classList.contains('on'), run: click('navbtn') },
    { label: 'Frame selection', key: 'focus', map: true, run: () => press('focus') },
    { label: 'Show all objects', map: true, run: () => ed()?.showAllObjects() },
    { label: 'Unlock all objects', map: true, run: () => ed()?.unlockAllObjects() },
    sep,
    { label: 'Measure', key: 'measure', map: true, checked: () => !!ed()?.measure?.active, run: () => press('measure') },
    { label: 'Keep this view (Ctrl+1…9, back with 1…9)', map: true, run: () => ed()?.keepView('1') },
    // UnrealEd's orthographic views, each a pane at the right of the 3D view (ortho-views.js); off at first
    ...[['top', 'Top view'], ['front', 'Front view'], ['side', 'Side view']].map(([k, label]) => ({
      label, checked: () => !!ed()?.orthoViews?.has(k), run: () => ed()?.orthoViews?.toggle(k) })),
    sep,
    { label: 'Full screen', run: () => (desktop() ? window.pywebview.api.fullscreen()
      : (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())) },
  ]],
  ['Map', [
    { label: 'Rebuild', run: click('build') },
    { label: 'Full rebuild (including unchanged)', run: () => ed()?.rebuild('full') },
    { label: 'Rebuild lighting', run: () => ed()?.rebuild('lighting') },
    { label: 'Rebuild AI paths', run: () => ed()?.rebuild('paths') },
    { label: 'Fill AI paths', map: true, run: () => ed()?.fillPaths() },
    experimentalGeometryItem(),
    sep,
    { label: 'Play in editor', run: () => ed()?.play('embedded') },
    { label: 'Play in game window', run: () => ed()?.play('external') },
    { label: 'Play settings...', run: () => ed()?.playSettings() },
    { label: 'Game screenshot', run: click('play') },
    { label: 'Stop game', map: false, duringPlay: true, run: click('stopgame') },
    { label: 'Install map...', run: click('install') },
    sep,
    { label: 'Story...', run: click('storybtn') },
    { label: 'Map settings...', run: click('mapsetbtn') },
    { label: 'Sky & time of day...', run: () => ed()?.openSky() },
    { label: 'Map links...', run: click('linksbtn') },
    { label: 'Factions...', run: click('factionsbtn') },
    { label: 'Interactions...', run: click('logicbtn') },
    { label: 'Check map', run: click('checkbtn') },
  ]],
  ['Tools', [
    { label: 'Character Creator...', run: click('charbtn') },
    { label: 'Animation Studio...', run: click('studiobtn') },
    { label: 'Weapons...', run: () => window.__weapons?.open() },
    { label: 'Import a mod...', run: () => window.__modImport?.open() },
    { label: 'Scripts...', map: true, run: () => window.__scriptsPanel?.open() },
    { label: 'Import assets...', run: () => { window.__workspace?.show('browser'); click('bimportany')(); } },
    sep,
    { label: 'Add a block', key: 'block', run: () => press('block') },
    { label: 'Add a hole', run: click('addhole') },
    { label: '2D Shape Editor...', map: true, run: () => ed()?.shapeEditor?.open() },
    { label: 'Draw wall', map: true, run: () => ed()?.startDraw('wall') },
    { label: 'Draw road', map: true, run: () => ed()?.startDraw('road') },
    { label: 'Draw floor', map: true, run: () => ed()?.startDraw('floor') },
    { label: 'Draw ceiling', map: true, run: () => ed()?.startDraw('ceiling') },
    { label: 'Draw stairs', map: true, run: () => ed()?.startDraw('stairs') },
    { label: 'Draw roof', map: true, run: () => ed()?.startDraw('roof') },
    { label: 'Add a sign', run: click('addsign') },
    { label: 'Add a cutscene camera', run: click('addcut') },
  ]],
  ['Window', [
    ...[['hierarchy', 'Hierarchy'], ['inspector', 'Inspector'], ['browser', 'Asset browser'], ['console', 'Console']].map(([id, label]) => ({
      label, checked: () => !!window.__workspace?.isVisible(id), run: () => window.__workspace?.toggle(id),
    })),
    sep,
    { label: 'Default layout', run: () => window.__workspace?.preset('default') },
    { label: 'Scene layout', run: () => window.__workspace?.preset('scene') },
    { label: 'Inspect layout', run: () => window.__workspace?.preset('inspect') },
    sep,
    { label: 'Reset layout', run: () => window.__workspace?.reset() },
  ]],
  ['Settings', [
    { label: 'Settings...', run: () => openSettings('general') },
    { label: 'Keyboard shortcuts...', run: () => openSettings('keys') },
    sep,
    ...themes(),
  ]],
  ['Help', [
    { label: 'Quick help', key: 'help', run: click('helpbtn') },
    { label: 'Guide', run: () => openUrl(location.origin + '/guide') },
    { label: 'Keyboard shortcuts', run: () => openSettings('keys') },
    // in the training its panel again, at the step reached (closed with ✕, it said to come here: 24 Oct 2026 the
    // item was gone); in another project the training
    { label: 'Interactive tutorial...', project: true,
      run: () => (['training', 'tutorial'].includes(window.__projects?.current?.kind) ? window.__tutorial?.start() : window.__projects?.training()) },
    sep,
    { label: 'About DeusEdix', run: openAbout },
  ]],
];

// Browser and desktop menus share commands and availability. Native callbacks are
// checked again here, so stale menu state cannot edit a closed map or a modal tool.
const commands = new Map();
MENUS.forEach(([title, items], mi) => items.forEach((item, ii) => {
  if (!item.sep) { item.id = `m${mi}_${ii}`; commands.set(item.id, { title, item }); }
}));
function commandEnabled(title, it) {
  if (ed()?.playing && !it.duringPlay && ['Edit', 'Map', 'Tools'].includes(title)) return false;
  if (ed()?.playing && title === 'File' && !['Exit', 'Close project', 'Close map'].includes(it.label)) return false;
  const requiresMap = it.map ?? (title === 'Edit' || title === 'Map'
    || (title === 'Tools' && it.label.startsWith('Add '))
    || (title === 'File' && ['Save', 'Revert all changes', 'Close map'].includes(it.label)));
  const requiresProject = it.project || requiresMap || title === 'Tools' || title === 'Map';
  const project = window.__projects?.current || window.__projectContext;
  return !(requiresProject && (!project?.id || window.__projects?.visible)) && !(requiresMap && !ed()?.script)
    && (!it.visible || it.visible()) && (!it.enabled || it.enabled());
}
function nativeModalOpen() {
  return [...document.querySelectorAll('dialog[open], #mission-graph, #studio, #charbox, #texedit, #story, #mb-dialog.open, #newbox, #mapbox, #facbox, #linkbox, #pkgbox, #mimportbox, #logicbox, #soundbox, #checkbox')]
    .some(el => el.getClientRects().length && getComputedStyle(el).display !== 'none');
}
function runCommand(id) {
  const command = commands.get(id);
  if (!command || !commandEnabled(command.title, command.item) || nativeModalOpen()) return false;
  closeMenus(); command.item.run(); return true;
}
function describeMenu() {
  const blocked = nativeModalOpen();
  return MENUS.map(([title, items]) => ({ title, items: items.filter(it => !it.visible || it.visible()).map(it => it.sep ? { sep: true } : {
    id: it.id, label: it.label, enabled: !blocked && commandEnabled(title, it), checked: !!it.checked?.(), shortcut: it.key ? keyOf(it.key) : '',
  }) }));
}
let nativeInstalled = false, nativeInstalling = false, nativeState = '', nativeStructure = '';
const menuStructure = snapshot => JSON.stringify(snapshot.map(menu => [menu.title, menu.items.map(item => item.id || null)]));
async function installNativeMenus(force = false) {
  if ((nativeInstalled && !force) || nativeInstalling || !window.pywebview?.api?.install_menus) return;
  nativeInstalling = true;
  try {
    const snapshot = describeMenu();
    if (await window.pywebview.api.install_menus(snapshot)) {
      nativeInstalled = true; closeMenus();
      nativeStructure = menuStructure(snapshot); nativeState = '';
      document.documentElement.classList.add('native-menubar');
      window.dispatchEvent(new Event('resize'));
    }
  } catch (_) { /* The complete HTML menu remains available on failure. */ }
  finally { nativeInstalling = false; }
}
async function syncNativeMenus() {
  if (!nativeInstalled || nativeInstalling) return;
  const snapshot = describeMenu();
  if (menuStructure(snapshot) !== nativeStructure) { await installNativeMenus(true); return; }
  const states = snapshot.flatMap(menu => menu.items).filter(item => !item.sep);
  const state = JSON.stringify(states);
  if (state === nativeState) return;
  try { if (await window.pywebview.api.update_menus(states)) nativeState = state; } catch (_) { /* retry next tick */ }
}

function openUrl(url) {
  if (desktop()) window.pywebview.api.open_url(url);
  else window.open(url, '_blank');
}

let bar = null, openMenu = null, altMode = false;
function buildBar() {
  const top = $('#top');
  if (!top || $('#menubar')) return;
  bar = document.createElement('div');
  bar.id = 'menubar';
  bar.setAttribute('role', 'menubar');
  bar.innerHTML = `<span class="mb-brand"><svg viewBox="0 0 48 48" aria-hidden="true"><use href="/static/deusedix-mark.svg#mark"/></svg><b>Deus<span>Edix</span></b></span>`;
  for (const [title, items] of MENUS) {
    const m = document.createElement('div');
    m.className = 'mb-menu';
    m.dataset.menu = title;                 // the tutorial's ring can point at a menu ("Tools") and an item
    m.innerHTML = `<button class="mb-title" aria-haspopup="true"><u>${title[0]}</u>${title.slice(1)}</button><div class="mb-list" role="menu"></div>`;
    m.items = items;
    const t = $('.mb-title', m);
    t.onclick = () => (openMenu === m ? closeMenus() : showMenu(m));
    t.onmouseenter = () => { if (openMenu && openMenu !== m) showMenu(m); };
    bar.appendChild(m);
  }
  const project = document.createElement('button');
  project.id = 'project-menu-button'; project.title = 'Projects';
  project.textContent = window.__projectContext?.name || 'Projects';
  project.onclick = () => window.__projects?.show();
  bar.appendChild(project);
  const map = document.createElement('div');
  map.className = 'mb-map';
  bar.appendChild(map);
  for (const id of ['map']) { const el = document.getElementById(id); if (el) map.appendChild(el); }
  const spacer = document.createElement('span');
  spacer.className = 'mb-spacer';
  bar.appendChild(spacer);
  for (const id of ['lightgain', 'status']) { const el = document.getElementById(id); if (el) bar.appendChild(el); }
  const quick = document.createElement('div');
  quick.className = 'mb-quick';
  quick.innerHTML = `<button data-q="save" title="Save (${keyOf('save')})">Save</button>`;
  quick.firstChild.onclick = click('save');
  // Rebuild and Play: one button split in half, the arrow between them opens the options of both (one
  // menu: the left half's, then the right half's). Play's arrow stays on its left, as in Unity and Unreal.
  const pair = document.createElement('div'); pair.className = 'mb-menu mb-split mb-pair';
  pair.menuTitle = 'Map';           // its items follow the Map menu's rules (none while the game is played)
  pair.items = [
    { heading: 'Rebuild' },
    { label: 'Automatic · changed data', map: true, run: () => ed()?.rebuild('auto') },
    { label: 'Full · rebuild unchanged BSP too', map: true, run: () => ed()?.rebuild('full') },
    { label: 'Lighting', map: true, run: () => ed()?.rebuild('lighting') },
    { label: 'AI paths', map: true, run: () => ed()?.rebuild('paths') },
    experimentalGeometryItem(),
    { heading: 'Play' },
    { label: 'Play in editor', map: true, run: () => ed()?.play('embedded') },
    { label: 'Play in game window', map: true, run: () => ed()?.play('external') },
    { label: 'Play settings...', map: true, run: () => ed()?.playSettings() },
  ];
  const half = (id, label, title) => {
    const b = document.createElement('button'); b.dataset.q = id; b.textContent = label; b.title = title; b.onclick = click(id);
    b.oncontextmenu = e => { e.preventDefault(); if (!arrow.disabled) showMenu(pair); };     // right-click: the options too
    return b;
  };
  const build = half('build', 'Rebuild', 'Save and rebuild changed data · the arrow: rebuild and play options');
  const play = half('playhere', 'Play', 'Play inside the editor · Shift+F1 releases the mouse');
  play.className = 'primary'; play.dataset.playMain = '';
  const arrow = document.createElement('button'); arrow.className = 'mb-title mb-options'; arrow.title = 'Rebuild and Play options';
  arrow.setAttribute('aria-label', 'Rebuild and Play options'); arrow.setAttribute('aria-haspopup', 'menu'); arrow.setAttribute('aria-expanded', 'false');
  arrow.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  arrow.onclick = () => openMenu === pair ? closeMenus() : showMenu(pair);
  const list = document.createElement('div'); list.className = 'mb-list'; list.setAttribute('role', 'menu');
  pair.append(build, arrow, play, list); quick.appendChild(pair);
  bar.appendChild(quick);
  top.insertBefore(bar, top.firstChild);
  document.documentElement.classList.add('has-menubar');
  updateQuick();
  window.dispatchEvent(new Event('resize'));               // the 3D view gets the space of the old row
}

function showMenu(m) {
  closeMenus(true);
  openMenu = m;
  m.classList.add('open');
  $('.mb-title', m)?.setAttribute('aria-expanded', 'true');
  const list = $('.mb-list', m);
  list.innerHTML = '';
  let heading = '';
  for (const it of m.items) {
    if (it.visible && !it.visible()) continue;
    if (it.sep) { if (list.lastChild && !list.lastChild.classList.contains('mb-sep')) list.appendChild(Object.assign(document.createElement('div'), { className: 'mb-sep' })); continue; }
    if (it.heading) { heading = it.heading; list.appendChild(Object.assign(document.createElement('div'), { className: 'mb-head', textContent: it.heading, role: 'presentation' })); continue; }
    const b = document.createElement('button');
    b.className = 'mb-item' + (it.checked && it.checked() ? ' checked' : '');
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `<span></span>${it.key ? `<span class="mb-key">${keyOf(it.key)}</span>` : ''}`;
    b.firstChild.textContent = it.label;
    b.dataset.label = it.label;
    if (heading) b.setAttribute('aria-label', heading + ': ' + it.label);
    const title = m.menuTitle || $('.mb-title', m).textContent;
    if (!commandEnabled(title, it)) b.disabled = true;
    b.onclick = () => { closeMenus(); setTimeout(it.run, 0); };
    list.appendChild(b);
  }
  if (list.lastChild && list.lastChild.classList.contains('mb-sep')) list.lastChild.remove();
}
function closeMenus(keepAlt) {
  if (openMenu) { openMenu.classList.remove('open'); $('.mb-title', openMenu)?.setAttribute('aria-expanded', 'false'); }
  openMenu = null;
  if (!keepAlt) setAlt(false);
}
function setAlt(on) { altMode = on; if (bar) bar.classList.toggle('mb-alt', on); }
// Run before tool listeners that stop propagation at window (orbit, sliders, key drags).
window.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenus(); }, true);
window.addEventListener('blur', () => closeMenus());
window.addEventListener('deusedix:studio-state', () => { closeMenus(); void syncNativeMenus(); });
// Alt + the underlined letter opens a menu; the arrows move in it, Esc closes it
window.addEventListener('keydown', (e) => {
  if (!bar || nativeInstalled || e.__deusedix || recording) return;
  // Alt-drag and Alt+R/G belong to animation tools, not the main menu bar.
  if (window.__studio?.state.open && !openMenu) { setAlt(false); return; }
  if (e.key === 'Alt') { setAlt(true); return; }
  if (e.altKey && !e.ctrlKey && /^Key[A-Z]$/.test(e.code)) {
    const m = [...bar.querySelectorAll('.mb-menu')].find((x) => $('.mb-title u', x)?.textContent === e.code.slice(3));
    if (m) { e.preventDefault(); e.stopImmediatePropagation(); showMenu(m); const f = $('.mb-item:not(:disabled)', m); if (f) f.focus(); return; }
  }
  if (!openMenu) return;
  const items = [...openMenu.querySelectorAll('.mb-item:not(:disabled)')], i = items.indexOf(document.activeElement);
  const menus = [...bar.querySelectorAll('.mb-menu')], mi = menus.indexOf(openMenu);
  const go = (m) => { showMenu(m); const f = $('.mb-item:not(:disabled)', m); if (f) f.focus(); };
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeMenus(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); (items[(i + 1) % items.length] || items[0]).focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); (items[(i - 1 + items.length) % items.length] || items[0]).focus(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); go(menus[(mi + 1) % menus.length]); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); go(menus[(mi - 1 + menus.length) % menus.length]); }
}, true);
window.addEventListener('keyup', (e) => { if (e.key === 'Alt') setAlt(false); }, true);

// ---------------------------------------------------------------- settings
const DEFAULTS = { speed: 600, sens: 0.0035, invertY: false, gridMove: 16, gridRotate: 15, quality: 'sharp', startup: 'start', autosave: true, autosaveMinutes: 5, experimentalLocalGeometry: false };
const pref = (k) => (prefs[k] === undefined ? DEFAULTS[k] : prefs[k]);
function applyPrefs() {
  const e = ed();
  if (!e) return false;
  e.cam.speed = +pref('speed');
  e.cam.sens = +pref('sens');
  e.cam.invertY = !!pref('invertY');
  if (e.SNAP) { e.SNAP.move = +pref('gridMove'); e.SNAP.rotate = +pref('gridRotate'); if (e.applySnap) e.applySnap(); }
  if (e.renderer) {
    const ratio = { sharp: window.devicePixelRatio || 1, balanced: 1, fast: 0.75 }[pref('quality')] || 1;
    if (Math.abs(e.renderer.getPixelRatio() - ratio) > 1e-3) { e.renderer.setPixelRatio(ratio); window.dispatchEvent(new Event('resize')); }
  }
  e.configureAutosave?.();
  return true;
}
function setPref(k, v) {
  if (k === 'autosave' || k === 'autosaveMinutes') {
    const settings = normalizeAutosaveSettings({ ...prefs, [k]: v });
    v = k === 'autosave' ? settings.enabled : settings.minutes;
  }
  prefs[k] = v; store(); applyPrefs();
}

let dialog = null, page = 'general', warnText = '';
function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('div');
  dialog.id = 'mb-dialog';
  dialog.addEventListener('pointerdown', (e) => { if (e.target === dialog) closeDialog(); });
  document.body.appendChild(dialog);
  return dialog;
}
function closeDialog() { if (dialog) dialog.classList.remove('open'); recording = null; }
window.addEventListener('keydown', (e) => {
  if (dialog && dialog.classList.contains('open') && e.key === 'Escape' && !recording) { e.preventDefault(); e.stopImmediatePropagation(); closeDialog(); }
}, true);

function openSettings(which) {
  page = which || page;
  ensureDialog();
  renderSettings();
  dialog.classList.add('open');
}
function row(label, control, hint) {
  return `<div class="mb-row"><label>${label}</label>${control}</div>${hint ? `<div class="mb-hint">${hint}</div>` : ''}`;
}
function renderSettings() {
  const pages = [['general', 'General'], ['camera', 'Camera'], ['editing', 'Editing'], ['mic', 'Microphone'], ['keys', 'Keyboard shortcuts']];
  let body = '';
  if (page === 'general') {
    const theme = ($('#uitheme') || {}).value;
    const autosave = normalizeAutosaveSettings(prefs);
    body = `<h3>General</h3>`
      + row('When a project opens', `<select data-p="startup" aria-label="When a project opens"><option value="start"${pref('startup') === 'start' ? ' selected' : ''}>Project overview</option><option value="last"${pref('startup') === 'last' ? ' selected' : ''}>Last map</option></select>`)
      + row('Autosave', `<input type="checkbox" data-p="autosave" aria-label="Autosave"${autosave.enabled ? ' checked' : ''}><label for="mb-autosave-minutes">Every</label><input id="mb-autosave-minutes" type="number" data-p="autosaveMinutes" aria-label="Autosave interval in minutes" min="1" max="60" step="1" value="${autosave.minutes}" style="width:64px"${autosave.enabled ? '' : ' disabled'}><span>minutes</span>`,
        'Saves map changes and Story. Training is excluded. Rebuild is separate.')
      + row('Theme', `<select data-p="theme">${themes().map((t, i) => `<option value="${['classic', 'classic-rounded', 'mankind', 'mankind-rounded'][i]}"${['classic', 'classic-rounded', 'mankind', 'mankind-rounded'][i] === theme ? ' selected' : ''}>${t.label}</option>`).join('')}</select>`)
      + row('3D view resolution', `<select data-p="quality">${[['sharp', 'Sharp (the screen\'s own)'], ['balanced', 'Balanced'], ['fast', 'Fast (a slow PC)']]
        .map(([v, l]) => `<option value="${v}"${pref('quality') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`,
      'Fewer pixels draw faster: Fast for an old graphics card or a large monitor.');
  } else if (page === 'camera') {
    body = `<h3>Camera</h3>`
      + row('Flying speed', `<input type="range" data-p="speed" min="100" max="3000" step="50" value="${pref('speed')}"><output>${pref('speed')}</output>`, 'Units per second with the right mouse button and WASD; Shift is three times faster.')
      + row('Mouse sensitivity', `<input type="range" data-p="sens" min="0.001" max="0.01" step="0.0005" value="${pref('sens')}"><output>${(pref('sens') / 0.0035).toFixed(2)}x</output>`)
      + row('Invert the mouse', `<label><input type="checkbox" data-p="invertY"${pref('invertY') ? ' checked' : ''}> moving the mouse up looks down</label>`);
  } else if (page === 'editing') {
    body = `<h3>Editing</h3>`
      + row('Grid step', `<select data-p="gridMove">${[...new Set([1, 2, 4, 8, 16, 32, 64, 128, 256, +pref('gridMove')])].sort((a, b) => a - b).map((v) => `<option${+pref('gridMove') === v ? ' selected' : ''}>${v}</option>`).join('')}</select> <span class="mb-hint" style="margin:0">units (a door is 64 wide)</span>`)
      + row('Rotation step', `<select data-p="gridRotate">${[...new Set([1, 5, 10, 15, 22.5, 30, 45, 90, +pref('gridRotate')])].sort((a, b) => a - b).map((v) => `<option${+pref('gridRotate') === v ? ' selected' : ''}>${v}</option>`).join('')}</select> <span class="mb-hint" style="margin:0">degrees</span>`,
        `With grid snap on (${keyOf('snap')}), objects move and turn by these steps.`)
      + row('Local geometry (Experimental)', `<input type="checkbox" data-p="experimentalLocalGeometry" aria-label="Local geometry (Experimental)"${pref('experimentalLocalGeometry') ? ' checked' : ''}>`,
        'Adds a separate tool to the Rebuild menu. It works on a private copy of the last built map; Rebuild first to include pending edits.');
  } else if (page === 'mic') {
    body = `<h3>Microphone</h3>`
      + row('Microphone', '<select data-mic style="flex:1;min-width:0"><option>...</option></select>',
        'The one the Story records the voices of the lines with (● Record next to a line). Its name shows once the editor may use the microphone.');
  } else {
    let rows = '';
    for (const ctx of Object.keys(CONTEXTS)) {
      rows += `<tr><td class="mb-group" colspan="3">${CONTEXTS[ctx]}</td></tr>`;
      for (const a of ACTIONS.map((x) => ACTION[x[0]]).filter((a) => a.ctx === ctx)) {
        const custom = keyOf(a.id) !== a.def;
        rows += `<tr><td>${a.label}</td><td><button class="mb-bind${custom ? ' custom' : ''}${recording && recording.id === a.id ? ' wait' : ''}" data-bind="${a.id}">${recording && recording.id === a.id ? 'press a key...' : keyOf(a.id)}</button></td>`
          + `<td>${custom ? `<button data-reset="${a.id}" title="Back to ${a.def}">Reset</button>` : ''}</td></tr>`;
      }
    }
    body = `<h3>Keyboard shortcuts</h3><div class="mb-hint" style="margin:0 0 8px">Click a key, then press the new one (Esc cancels). Text fields keep their keys. Studio keyframe jumps can use Up and Down.</div>`
      + `<div class="mb-warn">${warnText}</div><table>${rows}</table>`;
  }
  dialog.innerHTML = `<div class="mb-win" role="dialog" aria-label="Settings"><div class="mb-head">Settings<button class="mb-close">Close</button></div>
    <div class="mb-body"><nav>${pages.map(([id, l]) => `<button data-page="${id}" class="${id === page ? 'on' : ''}">${l}</button>`).join('')}</nav>
    <div class="mb-page">${body}</div></div>
    <div class="mb-foot">${page === 'keys' ? '<button data-resetkeys>Reset every shortcut</button>' : '<button data-resetall>Back to the defaults</button>'}<button class="primary mb-close">Done</button></div></div>`;
  for (const b of dialog.querySelectorAll('.mb-close')) b.onclick = closeDialog;
  const mic = dialog.querySelector('[data-mic]');            // the microphones (voice.js)
  if (mic && window.__voice) window.__voice.fillMicSelect(mic).catch(() => {});
  for (const b of dialog.querySelectorAll('[data-page]')) b.onclick = () => { page = b.dataset.page; recording = null; warnText = ''; renderSettings(); };
  for (const el of dialog.querySelectorAll('[data-p]')) {
    const k = el.dataset.p;
    const update = () => {
      if (k === 'theme') { const t = $('#uitheme'); t.value = el.value; t.dispatchEvent(new Event('change')); return; }
      const v = el.type === 'checkbox' ? el.checked : (k === 'autosaveMinutes' || (el.tagName === 'SELECT' && ['quality','startup'].includes(k)) ? el.value : +el.value);
      setPref(k, v);
      if (k === 'autosave' || k === 'autosaveMinutes') {
        const control = dialog.querySelector('[data-p="autosaveMinutes"]');
        const settings = normalizeAutosaveSettings(prefs);
        control.value = settings.minutes;
        control.disabled = !settings.enabled;
      }
      const out = el.parentElement.querySelector('output');
      if (out) out.textContent = k === 'sens' ? (v / 0.0035).toFixed(2) + 'x' : v;
    };
    el.addEventListener(el.type === 'range' ? 'input' : 'change', update);
  }
  for (const b of dialog.querySelectorAll('[data-bind]')) b.onclick = () => { recording = ACTION[b.dataset.bind]; warnText = ''; renderSettings(); };
  for (const b of dialog.querySelectorAll('[data-reset]')) b.onclick = () => { delete prefs.keys[b.dataset.reset]; store(); remapTables(); renderSettings(); };
  const rk = dialog.querySelector('[data-resetkeys]');
  if (rk) rk.onclick = () => { prefs.keys = {}; store(); remapTables(); warnText = ''; renderSettings(); };
  const ra = dialog.querySelector('[data-resetall]');
  if (ra) ra.onclick = () => { for (const k of Object.keys(DEFAULTS)) delete prefs[k]; store(); applyPrefs(); renderSettings(); };
}
function recordKey(e) {
  if (e.type !== 'keydown') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (recording?.ctx === 'studio' && (e.code?.startsWith('Numpad') || (e.shiftKey && e.code === 'Backquote'))) {
    warnText = 'This shortcut is kept for viewport navigation.'; renderSettings(); return;
  }
  const a = recording;
  if (e.key === 'Escape') { recording = null; renderSettings(); return; }
  const combo = comboOf(e, a.ctx === 'fly');
  if (!combo) return;                                       // a modifier alone: wait for the key
  if (['Tab', 'Enter'].includes(combo.split('+').pop()) || (a.ctx !== 'studio' && ['Up', 'Down', 'Left', 'Right'].includes(combo.split('+').pop()))) { warnText = combo + ' is kept for the menus and the text fields.'; renderSettings(); return; }
  if (a.ctx === 'studio' && !['Up', 'Down'].includes(combo) && /^(?:G|R|S|W|E|F|I|K|X|A|T|H|Space|Home|End|Delete|Left|Right|Shift\+I|Shift\+K|Shift\+D|Shift\+Left|Shift\+Right|Ctrl\+[SCVZY]|Ctrl\+Shift\+[ZV]|Ctrl\+Space|Alt\+[GRSIA]|(?:Ctrl\+)?Numpad\w+)$/.test(combo)) {
    warnText = combo + ' is already used by an animation or navigation tool.'; renderSettings(); return;
  }
  const same = ACTIONS.map((x) => ACTION[x[0]]).find((o) => o.id !== a.id && keyOf(o.id) === combo
    && (o.ctx === a.ctx || (o.ctx === 'edit' && a.ctx === 'cut') || (o.ctx === 'cut' && a.ctx === 'edit')));
  if (same) { warnText = `${combo} already does "${same.label}": change that one first.`; recording = null; renderSettings(); return; }
  if (combo === a.def) delete prefs.keys[a.id]; else prefs.keys[a.id] = combo;
  store();
  remapTables();
  recording = null;
  warnText = '';
  renderSettings();
}

async function openAbout() {
  ensureDialog();
  let version = '';
  try { if (desktop()) version = await window.pywebview.api.version(); } catch (e) { /* not installed */ }
  dialog.innerHTML = `<div class="mb-win" role="dialog" aria-label="About DeusEdix" style="width:min(520px,94vw)"><div class="mb-head">About DeusEdix<button class="mb-close">Close</button></div>
    <div class="mb-page mb-about"><p><b>DeusEdix</b>${version ? ' ' + version : ''}: a map editor for Deus Ex and Deus Ex: Revision.</p>
    <p class="mb-red">A fan-made tool, not affiliated with, endorsed or supported by the Deus Ex: Revision team (Caustic Creative), Eidos, Square Enix or Ion Storm.</p>
    <p>It works on your own copy of the games and ships nothing of theirs. Deus Ex and its characters belong to their owners.</p>
    <p>Made with three.js, Python, pywebview and the editor engine that comes with the game.</p></div>
    <div class="mb-foot"><button class="primary mb-close">OK</button></div></div>`;
  for (const b of dialog.querySelectorAll('.mb-close')) b.onclick = closeDialog;
  dialog.classList.add('open');
}

// ---------------------------------------------------------------- start
buildBar();
(function waitEditor() { if (!applyPrefs()) setTimeout(waitEditor, 200); })();
window.__menubar = { openSettings, prefs, keyOf, ACTIONS, setPref, describeMenu, runCommand, closeMenus,
  get settingsOpen() { return !!dialog?.classList.contains('open'); } };
window.addEventListener('pywebviewready', installNativeMenus);
installNativeMenus();
setInterval(syncNativeMenus, 600);
function updateQuick() {
  const active = !!ed()?.playing;
  for (const b of document.querySelectorAll('.mb-quick button')) b.disabled = active || !ed()?.script;
  const main = document.querySelector('[data-play-main]');
  if (main) {
    main.disabled = !active && !ed()?.script;
    main.innerHTML = active ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4h8v8H4z"/></svg>Stop'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5z"/></svg>Play';
    main.title = active ? 'Stop this Play session' : 'Play inside the editor · Shift+F1 releases the mouse';
  }
}
window.addEventListener('deusedix:map-state', updateQuick);
window.addEventListener('deusedix:play-state', () => { closeMenus(); updateQuick(); });
window.addEventListener('keydown', e => {
  if (!openMenu?.classList.contains('mb-split')) return;
  if (e.key === 'Escape') { const arrow = $('.mb-title', openMenu); closeMenus(); arrow.focus(); e.preventDefault(); }
  else if (nativeInstalled && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
    const items = [...openMenu.querySelectorAll('.mb-item:not(:disabled)')];
    const i = items.indexOf(document.activeElement), step = e.key === 'ArrowDown' ? 1 : -1;
    items[(i + step + items.length) % items.length]?.focus(); e.preventDefault();
  }
}, true);
window.addEventListener('deusedix:project-state', e => {
  const project = e.detail.project;
  const button = document.getElementById('project-menu-button');
  if (button) { button.textContent = project?.name || 'Projects'; button.title = project ? `${project.name} · Projects` : 'Projects'; }
  document.title = project ? `${project.name} — DeusEdix` : 'DeusEdix — Projects';
});
