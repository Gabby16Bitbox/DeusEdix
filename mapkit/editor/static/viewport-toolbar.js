// The 3D view's own toolbar, like Unity's tool overlay: Move / Rotate / Scale (W, E, R), grid snap (G)
// with how far a step goes and how much a turn snaps, the icons of lights, AI paths and logic points
// shown or hidden (Unity's Gizmos button), and the Navigation menu: the two layers of navigation each on
// or off (AI paths, the walkable area), Test route and Fill AI paths. The steps are the same as File >
// Settings (gridMove, gridRotate).
const PATHS = {
  move: '<path d="M10 2v16M2 10h16M10 2 7.5 4.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5"/>',
  rotate: '<path d="M16.5 10A6.5 6.5 0 1 1 14.6 5.4"/><path d="M15.5 1.8v4h-4"/>',
  scale: '<rect x="2.5" y="9.5" width="8" height="8"/><path d="M8.5 11.5 17 3M12 3h5v5"/>',
  snap: '<path d="M4 3h4v7a2 2 0 0 0 4 0V3h4v7a6 6 0 0 1-12 0z"/><path d="M4 7h4M12 7h4"/>',
  icons: '<path d="M7.5 15h5M8.5 18h3M10 2a5.5 5.5 0 0 0-3.3 9.9c.5.4.8 1 .8 1.6V15h5v-1.5c0-.6.3-1.2.8-1.6A5.5 5.5 0 0 0 10 2z"/>',
  nav: '<circle cx="4" cy="16" r="2"/><circle cx="16" cy="4" r="2"/><path d="M6 16h5.5a3 3 0 0 0 0-6h-3a3 3 0 0 1 0-6H14"/>',
  check: '<path d="m4 10.5 4 4 8-9"/>',
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
`;
const CHEVRON = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 4 3 3 3-3"/></svg>';

// api: getMode() / setMode(m), getSnap() / setSnap(on), getSteps() -> {move, rotate}, setStep(kind, value),
// getIcons() / setIcons(on), getLightMode() / setLightMode(mode), getNav() -> {paths, walk}, setNavLayer('paths' | 'walk'),
// testRoute(), fillPaths()
export function createViewportToolbar(api) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'vptools';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Tools');
  bar.innerHTML = `
    <button data-vp="translate" title="Move (W)" aria-label="Move">${icon('move')}</button>
    <button data-vp="rotate" title="Rotate (E): objects turn every way, the rest about the vertical axis" aria-label="Rotate">${icon('rotate')}</button>
    <button data-vp="scale" title="Scale (R): drag the middle square to resize evenly" aria-label="Scale">${icon('scale')}</button>
    <span class="vp-sep"></span>
    <button data-vp="snap" title="Grid snap (G)" aria-label="Grid snap">${icon('snap')}</button>
    <span class="vp-combo" data-combo="move" title="Grid step: how far a snapped move goes (units; a door is 64 wide). Type it, or pick one with the arrow">
      <input data-vp="move" inputmode="decimal" aria-label="Grid step"><button tabindex="-1" aria-label="Grid steps">${CHEVRON}</button></span>
    <span class="vp-combo" data-combo="turn" title="Rotation step: how much a snapped turn goes (degrees). Type it, or pick one with the arrow">
      <input data-vp="turn" inputmode="decimal" aria-label="Rotation step"><span>°</span><button tabindex="-1" aria-label="Rotation steps">${CHEVRON}</button></span>
    <span class="vp-sep"></span>
    <button data-vp="icons" title="Icons of lights, AI paths and logic points" aria-label="Icons">${icon('icons')}</button>
    <span class="vp-menu" data-combo="nav"><button data-vp="nav" aria-haspopup="true" aria-label="Navigation"
      title="Navigation: AI paths (the nodes' network) and the walkable area, each shown or hidden; Test route; Fill AI paths">${icon('nav')}</button></span>
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
  $('snap').onclick = () => { api.setSnap(!api.getSnap()); refresh(); };
  $('icons').onclick = () => { api.setIcons(!api.getIcons()); refresh(); };
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
  $('lighting').onkeydown = e => e.stopPropagation();
  // a step is typed (Enter or leaving the field sets it, Esc puts the old one back) or picked from the arrow's list
  const LIMITS = { move: [0.5, 4096], turn: [0.5, 180] };
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
  function refresh() {
    const mode = api.getMode(), on = api.getSnap(), steps = api.getSteps();
    for (const m of ['translate', 'rotate', 'scale']) $(m).setAttribute('aria-pressed', String(mode === m));
    $('snap').setAttribute('aria-pressed', String(on));
    $('icons').setAttribute('aria-pressed', String(api.getIcons()));
    const nav = api.getNav ? api.getNav() : {};
    $('nav').setAttribute('aria-pressed', String(!!(nav.paths || nav.walk)));
    $('lighting').value = api.getLightMode();
    if (document.activeElement !== $('move')) $('move').value = String(steps.move);
    if (document.activeElement !== $('turn')) $('turn').value = String(steps.rotate);
    for (const c of bar.querySelectorAll('.vp-combo')) c.classList.toggle('off', !on);
  }
  refresh();
  return { refresh, el: bar };
}
