// The 3D view's own toolbar, like Unity's tool overlay: Move / Rotate / Scale (W, E, R), where the gizmo sits
// and which way it points (Unity's Center / Pivot, Z, and Global / Local, X), the previous and
// next selection (Unity's selection history arrows), grid snap (G)
// with how far a step goes and how much a turn snaps, the grid of the 3D view (at the floor of the selection, a cell a
// grid step: view-grid.js), the icons of lights, AI paths and logic points
// shown or hidden (Unity's Gizmos button), the Show menu (Unity's Layers and Gizmos menus: each kind of thing shown,
// locked and with its icons, and the icons' size: scene-kinds.js), and the Navigation menu: the two layers of navigation each on
// or off (AI paths, the walkable area), Test route and Fill AI paths, then Isolate the selection (Shift+H),
// Show hidden with how many objects the eye hid (Unity's scene visibility) and Pilot the selection (Shift+P, Unity's
// first person control of a camera: view-align.js), each with a flag while it is on.
// The steps are the same as File > Settings (gridMove, gridRotate).
import { GIZMO_CHOICES, gizmoOption, nextGizmoChoice } from './gizmo-tools.js';
import { GRID_LIMITS } from './grid-snap.js';
import { ICON_SIZE } from './scene-kinds.js';

// the bulb, the eye and the padlock of the views' states, and the stroke across one that is off
const BULB = '<path d="M7.5 15h5M8.5 18h3M10 2a5.5 5.5 0 0 0-3.3 9.9c.5.4.8 1 .8 1.6V15h5v-1.5c0-.6.3-1.2.8-1.6A5.5 5.5 0 0 0 10 2z"/>';
const EYE = '<path d="M2.5 10S5 5 10 5s7.5 5 7.5 5-2.5 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2"/>';
const PADLOCK = '<rect x="4.5" y="9" width="11" height="8.5" rx="1.5"/>', OFF = '<path d="M3.5 16.5l13-13"/>';

const PATHS = {
  move: '<path d="M10 2v16M2 10h16M10 2 7.5 4.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5"/>',
  rotate: '<path d="M16.5 10A6.5 6.5 0 1 1 14.6 5.4"/><path d="M15.5 1.8v4h-4"/>',
  scale: '<rect x="2.5" y="9.5" width="8" height="8"/><path d="M8.5 11.5 17 3M12 3h5v5"/>',
  snap: '<path d="M4 3h4v7a2 2 0 0 0 4 0V3h4v7a6 6 0 0 1-12 0z"/><path d="M4 7h4M12 7h4"/>',
  grid: '<path d="M6 4.5h8L18 16H2zM3.6 11.5h12.8M5.2 7.8h9.6M8.7 4.5 7.3 16M11.3 4.5l1.4 11.5"/>',
  icons: BULB,
  iconsoff: BULB + OFF,
  eye: EYE,
  lock: PADLOCK + '<path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
  unlock: PADLOCK + '<path d="M7 9V6.5a3 3 0 0 1 6 0"/>',
  layers: '<path d="M10 2.5 17.5 6 10 9.5 2.5 6ZM2.5 10l7.5 3.5 7.5-3.5M2.5 14l7.5 3.5 7.5-3.5"/>',
  nav: '<circle cx="4" cy="16" r="2"/><circle cx="16" cy="4" r="2"/><path d="M6 16h5.5a3 3 0 0 0 0-6h-3a3 3 0 0 1 0-6H14"/>',
  check: '<path d="m4 10.5 4 4 8-9"/>',
  selback: '<path d="M16 10H4M9 5l-5 5 5 5"/>',
  selnext: '<path d="M4 10h12M11 5l5 5-5 5"/>',
  isolate: '<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/><rect x="7.5" y="7.5" width="5" height="5"/>',
  eyeoff: EYE + OFF,
  pilot: '<rect x="2.5" y="6" width="10" height="8" rx="1.5"/><path d="m12.5 9 5-2.5v7l-5-2.5"/>',
  // the gizmo's options (GIZMO_CHOICES): a dot in the middle of the bounds or on a corner, the globe, a box of its own
  center: '<rect x="3" y="3" width="14" height="14" rx="1.5" stroke-dasharray="2.5 2"/><circle cx="10" cy="10" r="2"/>',
  pivot: '<rect x="3" y="3" width="14" height="14" rx="1.5" stroke-dasharray="2.5 2"/><circle cx="6" cy="14" r="2"/>',
  global: '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2.6 2.4 2.6 11.6 0 14M10 3c-2.6 2.4-2.6 11.6 0 14"/>',
  local: '<path d="M10 2.5 16.5 6v8L10 17.5 3.5 14V6z"/><path d="M3.5 6 10 9.5 16.5 6M10 9.5v8"/>',
};
// the selection history's arrows: the step each one takes
const SELECTION_STEPS = { selback: -1, selnext: 1 };
const objects = (n) => `${n} ${n === 1 ? 'object' : 'objects'}`;
// the view's temporary states (v: api.getSceneView()): while one is on, its flag says so, and its button ends it
const VIEW_FLAGS = {
  isolated: { on: (v) => v.isolated > 0, text: (v) => `Isolated: ${objects(v.isolated)}`, exit: 'Exit',
    tip: 'Show the whole map again (Shift+H)', end: (api) => api.toggleIsolation() },
  reveal: { on: (v) => v.reveal, text: (v) => `Hidden shown: ${v.hidden}`, exit: 'Hide',
    tip: 'Hide again what the eye hid', end: (api) => api.toggleReveal() },
  pilot: { on: (v) => !!v.pilot, text: (v) => `Piloting ${v.pilot}`, exit: 'Exit',
    tip: 'Stop piloting: the selection stays where the view took it, the view goes back', end: (api) => api.togglePilot() },
};
const icon = (n) => `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[n]}</svg>`;
export const MOVE_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256];
export const TURN_STEPS = [1, 5, 10, 15, 22.5, 30, 45, 90];

const CSS = `
#vptools { position:fixed; top:52px; left:calc(var(--lw) + 8px); z-index:5; display:flex; flex-wrap:wrap; align-items:center; gap:2px 4px;
  min-height:28px; padding:2px 4px; box-sizing:border-box; background:var(--panel); border:1px solid var(--line); border-radius:var(--radius-control); box-shadow:0 14px 30px #0009;
  font-size:12px; color:var(--text); user-select:none; }
#vptools .vp-sep { width:1px; height:16px; background:var(--line); margin:0 4px; }
#vptools button { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; min-height:24px; padding:0;
  border:0; border-radius:var(--radius-control); background:transparent; color:var(--dim); line-height:1; }
#vptools button:hover, #vptools button:focus-visible { color:var(--text); background:var(--hover); }
#vptools button[aria-pressed=true] { color:var(--heading); background:var(--accent-soft); }
#vptools button:disabled { opacity:.4; background:transparent; color:var(--dim); cursor:default; }
#vptools .vp-combo { position:relative; display:inline-flex; align-items:center; height:22px; background:var(--field);
  border:1px solid var(--line); border-radius:var(--radius-control); }
#vptools .vp-combo:focus-within { border-color:var(--accent-border); }
#vptools .vp-combo input { width:38px; height:20px; padding:0 0 0 6px; border:0; background:transparent; color:var(--text);
  font-size:12px; font-variant-numeric:tabular-nums; outline:none; }
#vptools .vp-combo span { color:var(--dim); padding-right:2px; }
#vptools .vp-combo input[data-vp=turn] { width:30px; }
#vptools .vp-combo button { width:16px; height:20px; min-height:20px; border-radius:0; }
#vptools .vp-combo button svg { width:9px; height:9px; }
#vptools .vp-combo.off { opacity:.45; }
#vptools .vp-count { width:auto; min-width:24px; gap:3px; padding:0 4px; font-variant-numeric:tabular-nums; }
#vptools .vp-text { width:auto; min-width:62px; gap:4px; padding:0 6px; justify-content:flex-start; color:var(--text); font-size:12px; }
#vptools .vp-flag { display:inline-flex; align-items:center; gap:6px; height:22px; padding:0 2px 0 8px; white-space:nowrap;
  border:1px solid var(--accent-border); border-radius:var(--radius-control); background:var(--accent-soft); color:var(--heading); }
#vptools .vp-flag[hidden] { display:none; }
#vptools .vp-flag button { width:auto; height:18px; min-height:18px; padding:0 6px; font-size:12px; color:var(--text); }
#vptools .vp-shading { display:inline-flex; align-items:center; flex:none; height:24px; margin-left:4px; padding-left:8px; border-left:1px solid var(--line); }
#vptools select.vp-lighting { width:88px; min-height:22px; height:22px; margin:0; padding:0 4px; font:inherit; line-height:18px;
  border:1px solid var(--line); border-radius:var(--radius-control); background:var(--field); color:var(--text); }
#vptools select.vp-lighting:focus-visible { border-color:var(--accent-border); }

#vptools .vp-list { position:absolute; top:24px; left:-1px; min-width:calc(100% + 2px); padding:2px 0; background:var(--panel);
  border:1px solid var(--line); border-radius:var(--radius-control); box-shadow:0 14px 30px #0009; z-index:7; }
#vptools .vp-list div { height:22px; line-height:22px; padding:0 8px; white-space:nowrap; font-variant-numeric:tabular-nums; cursor:pointer; }
#vptools .vp-list div:hover, #vptools .vp-list div.on { background:var(--hover); }
#vptools .vp-menu { position:relative; display:inline-flex; }
#vptools .vp-menu .vp-list { left:0; min-width:170px; }
#vptools .vp-list div[data-a] { display:flex; align-items:center; gap:6px; }
#vptools .vp-list .vp-check { display:inline-flex; width:13px; color:var(--acc); }
#vptools .vp-list .vp-key { margin-left:auto; padding-left:16px; color:var(--dim); }
#vptools .vp-list .vp-hr { height:1px; padding:0; margin:2px 0; background:var(--line); cursor:default; }
#vptools .vp-list .vp-hr:hover { background:var(--line); }
#vptools:has(.vp-list) { z-index:6; }
#vptools .vp-menu .vp-kinds { min-width:272px; }
#vptools .vp-list .vp-krow { display:flex; align-items:center; gap:1px; padding:0 3px 0 8px; cursor:default; }
#vptools .vp-krow .vp-kname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; cursor:pointer; }
#vptools .vp-krow .vp-kname:hover { color:var(--heading); }
#vptools .vp-krow.none .vp-kname { color:var(--dim); }
#vptools .vp-krow .vp-kn { min-width:24px; padding:0 4px; text-align:right; color:var(--dim); font-variant-numeric:tabular-nums; }
#vptools .vp-krow button { width:20px; height:20px; min-height:20px; }
#vptools .vp-krow .vp-kgap { flex:none; width:20px; }
#vptools .vp-kinds.vp-bulboff [data-state=noIcons] { opacity:.45; }
#vptools .vp-list .vp-ksize { display:flex; align-items:center; gap:8px; height:28px; cursor:default; }
#vptools .vp-list .vp-ksize:hover { background:none; }
#vptools .vp-ksize input { flex:1; min-width:90px; }
#vptools .vp-ksize span:last-child { min-width:2ch; text-align:right; color:var(--dim); font-variant-numeric:tabular-nums; }
`;
const CHEVRON = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 4 3 3 3-3"/></svg>';

// api: getMode() / setMode(m), getGizmo() -> {pivot, space} / toggleGizmo('pivot' | 'space'),
// getSnap() / setSnap(on), getSteps() -> {move, rotate}, setStep(kind, value), getGrid() / setGrid(on) (the 3D view's grid),
// getIcons() / setIcons(on), getLightMode() / setLightMode(mode), getNav() -> {paths, walk}, setNavLayer('paths' | 'walk'),
// testRoute(), fillPaths(), stepSelection(dir) / canStepSelection(dir) (dir -1 back, 1 forward),
// getSceneView() -> {isolated: how many objects Isolate shows (0: off), hidden: how many the eye hid, reveal, canIsolate,
// pilot: what Pilot takes along ('': off), canPilot}, toggleIsolation(), toggleReveal(), togglePilot(),
// getKinds() -> the Show menu's rows ({id, label, icons, hidden, locked, noIcons}), countKinds() -> {id: how many},
// setKind(id, state, on), soloKind(id), resetKinds(), getIconSize() / setIconSize(size, keep) -> the size set
export function createViewportToolbar(api) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'vptools';
  // a shortcut as it is bound now (Settings > Keyboard shortcuts), else its default
  const key = (id, fallback) => (api.keyOf && api.keyOf(id)) || fallback;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Tools');
  bar.innerHTML = `
    <button data-vp="translate" title="Move (W)" aria-label="Move">${icon('move')}</button>
    <button data-vp="rotate" title="Rotate (E): objects turn every way, the rest about the vertical axis" aria-label="Rotate">${icon('rotate')}</button>
    <button data-vp="scale" title="Scale (R): drag the middle square to resize evenly" aria-label="Scale">${icon('scale')}</button>
    ${Object.keys(GIZMO_CHOICES).map((k) => `<button data-vp="${k}" class="vp-text"></button>`).join('')}
    <span class="vp-sep"></span>
    <button data-vp="selback" title="Previous selection (${key('selback', 'Ctrl+Shift+[')})" aria-label="Previous selection">${icon('selback')}</button>
    <button data-vp="selnext" title="Next selection (${key('selnext', 'Ctrl+Shift+]')})" aria-label="Next selection">${icon('selnext')}</button>
    <span class="vp-sep"></span>
    <button data-vp="snap" title="Grid snap (G)" aria-label="Grid snap">${icon('snap')}</button>
    <span class="vp-combo" data-combo="move" title="Grid step: how far a snapped move goes (units; a door is 64 wide). Type it, or pick one with the arrow">
      <input data-vp="move" inputmode="decimal" aria-label="Grid step"><button tabindex="-1" aria-label="Grid steps">${CHEVRON}</button></span>
    <span class="vp-combo" data-combo="turn" title="Rotation step: how much a snapped turn goes (degrees). Type it, or pick one with the arrow">
      <input data-vp="turn" inputmode="decimal" aria-label="Rotation step"><span>°</span><button tabindex="-1" aria-label="Rotation steps">${CHEVRON}</button></span>
    <button data-vp="grid" title="Grid in the 3D view: at the floor of the selection (else under the camera), a cell a grid step (${key('gridless', 'Ctrl+[')} / ${key('gridmore', 'Ctrl+]')} halve or double it)" aria-label="Grid in the 3D view">${icon('grid')}</button>
    <span class="vp-sep"></span>
    <button data-vp="icons" title="Icons of lights, AI paths and logic points: all of them (each kind's are in the Show menu)" aria-label="Icons">${icon('icons')}</button>
    <span class="vp-menu" data-combo="kinds"><button data-vp="kinds" aria-haspopup="true" aria-label="Show">${icon('layers')}</button></span>
    <span class="vp-menu" data-combo="nav"><button data-vp="nav" aria-haspopup="true" aria-label="Navigation"
      title="Navigation: AI paths (the nodes' network) and the walkable area, each shown or hidden; Test route; Fill AI paths">${icon('nav')}</button></span>
    <span class="vp-sep"></span>
    <button data-vp="isolate" aria-label="Isolate the selection">${icon('isolate')}</button>
    <button data-vp="reveal" class="vp-count" aria-label="Show hidden objects">${icon('eyeoff')}<span data-vp="hiddencount"></span></button>
    <button data-vp="pilot" aria-label="Pilot the selection">${icon('pilot')}</button>
    ${Object.entries(VIEW_FLAGS).map(([k, f]) => `<span class="vp-flag" data-flag="${k}" hidden><span></span><button title="${f.tip}">${f.exit}</button></span>`).join('')}
    <span class="vp-shading"><select class="vp-lighting" data-vp="lighting" aria-label="View: lighting, or an UnrealEd view"
      title="View (L: the lighting): Shaded = editor lights; Lit = game lighting from the last rebuild; Unlit = textures without lighting; UnrealEd's Wireframe, BSP cuts and Zones of the last rebuild">
      <option value="shaded">Shaded</option><option value="lit">Lit</option><option value="unlit">Unlit</option>
      <optgroup label="UnrealEd views"><option value="wire">Wireframe</option><option value="cuts">BSP cuts</option><option value="zones">Zones</option></optgroup></select></span>`;
  document.body.appendChild(bar);
  // it sits in the 3D view's top left corner, wherever the docked panels put the view, and wraps when narrow
  const view = document.querySelector('#view');
  const place = () => {
    const r = view && view.getBoundingClientRect();
    if (!r || !r.width) return;
    Object.assign(bar.style, { left: r.left + 8 + 'px', top: r.top + 8 + 'px', maxWidth: Math.max(120, r.width - 16) + 'px' });
    bar.style.display = r.height < 60 ? 'none' : '';
  };
  if (view) new ResizeObserver(place).observe(view);
  window.addEventListener('resize', place);
  place();
  const $ = (k) => bar.querySelector(`[data-vp="${k}"]`);
  for (const m of ['translate', 'rotate', 'scale']) $(m).onclick = () => { api.setMode(m); refresh(); };
  for (const k of Object.keys(GIZMO_CHOICES)) $(k).onclick = () => { api.toggleGizmo(k); refresh(); };
  $('snap').onclick = () => { api.setSnap(!api.getSnap()); refresh(); };
  $('grid').onclick = () => { api.setGrid(!api.getGrid()); refresh(); };
  for (const [k, dir] of Object.entries(SELECTION_STEPS)) $(k).onclick = () => { api.stepSelection(dir); refresh(); };
  $('icons').onclick = () => { api.setIcons(!api.getIcons()); refresh(); };
  $('isolate').onclick = () => { api.toggleIsolation(); refresh(); };
  $('reveal').onclick = () => { api.toggleReveal(); refresh(); };
  $('pilot').onclick = () => { api.togglePilot(); refresh(); };
  const flags = Object.entries(VIEW_FLAGS).map(([k, f]) => ({ f, el: bar.querySelector(`[data-flag="${k}"]`) }));
  for (const { f, el } of flags) el.querySelector('button').onclick = () => { f.end(api); refresh(); };
  $('lighting').onchange = () => { api.setLightMode($('lighting').value); refresh(); };
  // the Navigation menu: its two layers are ticks (each on or off), then the two actions
  $('nav').onclick = (e) => {
    e.stopPropagation();
    if (list && list.dataset.k === 'nav') return closeList();
    closeList();
    const nav = api.getNav();
    const tick = (on) => `<span class="vp-check">${on ? icon('check') : ''}</span>`;
    list = document.createElement('div');
    list.className = 'vp-list'; list.dataset.k = 'nav';
    list.innerHTML = `<div data-a="paths">${tick(nav.paths)}AI paths<span class="vp-key">P</span></div>
      <div data-a="walk">${tick(nav.walk)}Walkable area</div><div class="vp-hr"></div>
      <div data-a="route"><span class="vp-check"></span>Test route</div><div data-a="fill"><span class="vp-check"></span>Fill AI paths</div>`;
    list.onclick = (ev) => {
      const a = ev.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      closeList();
      if (a === 'paths' || a === 'walk') api.setNavLayer(a);
      else if (a === 'route') api.testRoute();
      else api.fillPaths();
      refresh();
    };
    bar.querySelector('[data-combo="nav"]').appendChild(list);
  };
  // the Show menu (Unity's Layers and Gizmos menus, scene-kinds.js): a row a kind, with how many the map has, its eye,
  // its padlock and, for the kinds drawn as icons, its icons; a click on a name shows only that kind. Then the icons'
  // size and every kind back. It stays open while it changes things.
  const KIND_SWITCHES = [
    { state: 'hidden', on: 'eyeoff', off: 'eye', word: 'hidden',
      tip: (k, on) => (on ? `${k}: hidden. Show them` : `Hide ${k} in the 3D view (each one's own eye stays)`) },
    { state: 'locked', on: 'lock', off: 'unlock', word: 'locked',
      tip: (k, on) => (on ? `${k}: locked. Unlock them` : `Lock ${k}: not picked, marquee-selected, snapped to or edited`) },
    { state: 'noIcons', on: 'iconsoff', off: 'icons', word: 'without icons', icons: true,
      tip: (k, on) => (on ? `${k}: icons hidden. Show them` : `Hide the icons of ${k}`) },
  ];
  let kindCounts = {};                 // how many of each kind the map has, counted when the menu opens
  const kindRow = (k) => `<span class="vp-kname" data-solo="${k.id}" title="Show only ${k.label} (click again: every kind)">${k.label}</span><span class="vp-kn">${kindCounts[k.id] ?? ''}</span>`
    + KIND_SWITCHES.map((s) => (s.icons && !k.icons ? '<span class="vp-kgap"></span>'
      : `<button data-kind="${k.id}" data-state="${s.state}" aria-pressed="${k[s.state]}" title="${s.tip(k.label, k[s.state])}" aria-label="${s.tip(k.label, k[s.state])}">${icon(k[s.state] ? s.on : s.off)}</button>`)).join('');
  // the rows as the kinds are now (kinds: api.getKinds(), in the rows' order)
  const paintKinds = (kinds) => {
    list.querySelectorAll('.vp-krow').forEach((row, i) => { row.innerHTML = kindRow(kinds[i]); row.classList.toggle('none', !kindCounts[kinds[i].id]); });
    list.classList.toggle('vp-bulboff', !api.getIcons());       // the bulb hides every icon now
  };
  $('kinds').onclick = (e) => {
    e.stopPropagation();
    if (list && list.dataset.k === 'kinds') return closeList();
    closeList();
    const kinds = api.getKinds(), size = api.getIconSize();
    kindCounts = api.countKinds();
    list = document.createElement('div');
    list.className = 'vp-list vp-kinds'; list.dataset.k = 'kinds';
    list.innerHTML = kinds.map(() => '<div class="vp-krow"></div>').join('') + `<div class="vp-hr"></div>
      <div class="vp-ksize" title="How big the icons are in the 3D view (units across)"><span>Icon size</span><input type="range" data-a="iconsize"
        min="${ICON_SIZE.min}" max="${ICON_SIZE.max}" step="${ICON_SIZE.step}" value="${size}" aria-label="Icon size"><span>${size}</span></div>
      <div class="vp-hr"></div><div data-a="kindsreset"><span class="vp-check"></span>Show, unlock and draw every kind</div>`;
    paintKinds(kinds);
    const slider = list.querySelector('[data-a="iconsize"]');
    slider.oninput = () => { slider.nextElementSibling.textContent = api.setIconSize(slider.value, false); };
    slider.onchange = () => api.setIconSize(slider.value, true);
    slider.onkeydown = (ev) => ev.stopPropagation();
    list.onclick = (ev) => {
      const t = ev.target.closest('[data-state], [data-solo], [data-a="kindsreset"]');
      if (!t) return;
      if (t.dataset.state) api.setKind(t.dataset.kind, t.dataset.state, t.getAttribute('aria-pressed') !== 'true');
      else if (t.dataset.solo) api.soloKind(t.dataset.solo);
      else api.resetKinds();
      refresh();
    };
    bar.querySelector('[data-combo="kinds"]').appendChild(list);
  };
  $('lighting').onkeydown = e => e.stopPropagation();
  // a step is typed (Enter or leaving the field sets it, Esc puts the old one back) or picked from the arrow's list
  const LIMITS = { move: GRID_LIMITS, turn: [0.5, 180] };
  let list = null;
  const closeList = () => { if (list) { list.remove(); list = null; } };
  const setStep = (k, raw) => {
    const v = parseFloat(String(raw).replace(',', '.'));
    if (Number.isFinite(v) && v > 0) api.setStep(k === 'move' ? 'move' : 'rotate', Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], Math.round(v * 100) / 100)));
    refresh();
  };
  for (const k of ['move', 'turn']) {
    const input = $(k), combo = bar.querySelector(`[data-combo="${k}"]`);
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { setStep(k, input.value); input.blur(); }
      else if (e.key === 'Escape') { refresh(); input.blur(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const steps = k === 'move' ? MOVE_STEPS : TURN_STEPS, cur = +input.value || 0;
        const next = e.key === 'ArrowUp' ? steps.find((s) => s > cur) : [...steps].reverse().find((s) => s < cur);
        if (next !== undefined) setStep(k, next);
      }
    };
    input.onchange = () => setStep(k, input.value);
    input.onfocus = () => input.select();
    input.onblur = () => setTimeout(refresh);
    combo.querySelector('button').onclick = (e) => {
      e.stopPropagation();
      if (list && list.dataset.k === k) return closeList();
      closeList();
      const steps = k === 'move' ? MOVE_STEPS : TURN_STEPS, cur = +input.value;
      list = document.createElement('div');
      list.className = 'vp-list'; list.dataset.k = k;
      list.innerHTML = steps.map((s) => `<div data-v="${s}" class="${s === cur ? 'on' : ''}">${s}${k === 'turn' ? '°' : ''}</div>`).join('');
      list.onclick = (ev) => { const v = ev.target.dataset.v; if (v) { setStep(k, v); closeList(); } };
      combo.appendChild(list);
    };
  }
  document.addEventListener('pointerdown', (e) => { if (list && !list.parentElement.contains(e.target)) closeList(); }, true);
  // Esc closes the list open, and only it: the placing, the selection and the rest wait for the next Esc
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !list) return;
    e.preventDefault(); e.stopImmediatePropagation();
    closeList();
  }, true);
  function refresh() {
    const mode = api.getMode(), on = api.getSnap(), steps = api.getSteps();
    for (const m of ['translate', 'rotate', 'scale']) $(m).setAttribute('aria-pressed', String(mode === m));
    const g = api.getGizmo ? api.getGizmo() : {};
    for (const [k, c] of Object.entries(GIZMO_CHOICES)) {       // each shows its option now; a press goes to the next
      const o = gizmoOption(k, g[k]), b = $(k);
      if (b.dataset.v !== o.id) { b.dataset.v = o.id; b.innerHTML = `${icon(o.id)}<span>${o.label}</span>`; }
      b.title = `${o.label} (${key(k, c.key)}): ${o.tip}. Press for ${gizmoOption(k, nextGizmoChoice(k, o.id)).label}`;
      b.setAttribute('aria-label', `${c.name}: ${o.label}`);
    }
    $('snap').setAttribute('aria-pressed', String(on));
    $('grid').setAttribute('aria-pressed', String(!!api.getGrid?.()));
    for (const [k, dir] of Object.entries(SELECTION_STEPS)) $(k).disabled = !api.canStepSelection?.(dir);
    $('icons').setAttribute('aria-pressed', String(api.getIcons()));
    const kinds = api.getKinds ? api.getKinds() : [];
    const off = KIND_SWITCHES.map((s) => [kinds.filter((k) => k[s.state]).length, s.word]).filter(([n]) => n);
    $('kinds').setAttribute('aria-pressed', String(off.length > 0));
    $('kinds').title = 'Show: which kinds of things the 3D view shows, locks and draws icons for, and the icons\' size'
      + (off.length ? `. Now ${off.map(([n, w]) => `${n} ${w}`).join(', ')}` : '');
    if (list?.dataset.k === 'kinds') paintKinds(kinds);
    const nav = api.getNav ? api.getNav() : {};
    $('nav').setAttribute('aria-pressed', String(!!(nav.paths || nav.walk)));
    const v = api.getSceneView ? api.getSceneView() : {};
    $('isolate').setAttribute('aria-pressed', String(v.isolated > 0));
    $('isolate').disabled = !v.isolated && !v.canIsolate;
    $('isolate').title = v.isolated ? `Isolated: ${objects(v.isolated)}. Press again (${key('isolate', 'Shift+H')}) to show the whole map`
      : `Isolate the selection (${key('isolate', 'Shift+H')}): only it is shown, with what it holds and the structures it stands in`;
    $('reveal').setAttribute('aria-pressed', String(!!v.reveal));
    $('reveal').disabled = !v.hidden && !v.reveal;
    $('reveal').title = v.reveal ? 'Hidden objects shown for now: press again to hide them'
      : v.hidden ? `${objects(v.hidden)} hidden with the eye: show them for now (their eye stays off)` : 'No object is hidden with the eye';
    $('hiddencount').textContent = v.hidden ? String(v.hidden) : '';
    $('pilot').setAttribute('aria-pressed', String(!!v.pilot));
    $('pilot').disabled = !v.pilot && !v.canPilot;
    $('pilot').title = v.pilot ? `Piloting ${v.pilot}: flying the view takes it along. Press again (${key('pilot', 'Shift+P')}) or Esc to stop`
      : `Pilot the selection (${key('pilot', 'Shift+P')}): the view looks through it (a camera, a spotlight, a character) and flying the view takes it along`;
    for (const { f, el } of flags) { el.hidden = !f.on(v); if (!el.hidden) el.firstElementChild.textContent = f.text(v); }
    $('lighting').value = api.getLightMode();
    if (document.activeElement !== $('move')) $('move').value = String(steps.move);
    if (document.activeElement !== $('turn')) $('turn').value = String(steps.rotate);
    for (const c of bar.querySelectorAll('.vp-combo')) c.classList.toggle('off', !on);
  }
  refresh();
  return { refresh, el: bar };
}
