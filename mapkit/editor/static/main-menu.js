// File > Main menu...: the project's own main menu, the one the game shows in place of its title screen and of its
// Esc menu when the project is played as a game of its own (its Play from the menu here, an exported mod). Kept by
// editor/main_menu.py; the game draws it with the project's UCMainMenu. The preview here is close to the game's, not
// the same (the game's own fonts, its screen size): "Play the menu" shows the real one. Loaded on demand by the menu.
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ACTION_LABELS = { new: 'New game', load: 'Load a game', save: 'Save the game', settings: 'Settings',
  back: 'Back to the game', mainmenu: 'Go to the main menu', exit: 'Exit the game', map: 'Start one of my maps' };
export const SHOW_LABELS = { always: 'Always', menu: 'Title screen only', game: 'During the game only' };
export const FONT_LABELS = { menu: 'Menu', title: 'Title', headers: 'Headers', large: 'Large', bold: 'Bold',
  location: 'Location', small: 'Small' };
// the game's fonts as the preview draws them (close, not the same)
export const FONT_CSS = { menu: '600 15px Tahoma, Verdana, sans-serif', title: '700 18px Tahoma, Verdana, sans-serif',
  headers: '700 13px Tahoma, Verdana, sans-serif', large: '700 30px "Arial Narrow", Arial, sans-serif',
  bold: '700 22px Georgia, serif', location: '600 20px "Courier New", monospace', small: '11px Tahoma, Verdana, sans-serif' };
// the screen the preview stands for: the game's sizes (button width, picture) are in its pixels
export const SCREEN = { w: 1024, h: 576 };
const MAX_BUTTONS = 12;

// the buttons of the menu in one place (the title screen, 'menu', or during the game, 'game'), as UCMainMenu
// chooses them: shown there, and the main menu's own button never on it. Each with whether it can be pressed now.
export function visibleButtons(menu, where) {
  const out = [];
  for (const b of menu.buttons || []) {
    if ((b.shows === 'menu' && where !== 'menu') || (b.shows === 'game' && where !== 'game')) continue;
    if (b.action === 'mainmenu' && where === 'menu') continue;
    out.push({ ...b, enabled: !(where === 'menu' && (b.action === 'save' || b.action === 'back')) });
  }
  return out;
}

// where UCMainMenu puts things on a screen of w x h (ConfigurationChanged): the block (picture, title, buttons) from
// x/y, aligned; it starts higher when the column would run off the bottom
export function layout(menu, w, h, count, sizes = {}) {
  const logoW = (sizes.logoW || 0) * menu.logoScale, logoH = sizes.logoW ? (sizes.logoH || 0) * menu.logoScale + 12 : 0;
  const titleH = menu.title ? (sizes.titleH || 30) + 14 : 0;
  const btnH = menu.look === 'text' ? (sizes.textH || 18) + 8 : 27, gap = menu.look === 'text' ? 4 : 9;
  const blockW = Math.max(menu.buttonWidth, logoW, sizes.titleW || 0);
  let blockY = menu.y * h;
  const blockX = menu.align === 'centre' ? (w - blockW) / 2 : menu.align === 'right' ? w - menu.x * w - blockW : menu.x * w;
  const bottom = blockY + logoH + titleH + count * (btnH + gap);
  if (bottom > h - 40) blockY = Math.max(10, blockY - (bottom - (h - 40)));
  const buttons = [];
  let y = blockY + logoH + titleH;
  for (let i = 0; i < count; i++) {
    const x = menu.align === 'centre' ? blockX + (blockW - menu.buttonWidth) / 2
      : menu.align === 'right' ? blockX + blockW - menu.buttonWidth : blockX;
    buttons.push({ x, y, w: menu.buttonWidth, h: btnH });
    y += btnH + gap;
  }
  return { blockX, blockY, blockW, logo: { w: logoW, h: logoH ? logoH - 12 : 0 }, titleY: blockY + logoH, titleH, buttons };
}

async function call(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The request failed.');
  return j;
}

// the 3D view as the background of the preview, when the open map is the one behind the menu
function viewPicture(mapName) {
  const ed = window.__editor, canvas = ed?.renderer?.domElement;
  const open = ed?.script ? String(ed.script).replace(/^.*[\\/]/, '').replace(/\.(py|dx)$/i, '') : '';
  if (!canvas || !open || open.toLowerCase() !== String(mapName || '').toLowerCase() || !canvas.width) return null;
  try {
    ed.renderer.render(ed.scene, ed.camera);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (_) { return null; }
}

let dialog = null;

function css() {
  const style = document.createElement('style');
  style.textContent = `body .map-dialog.main-menu { width:min(1180px, calc(100vw - 32px)); }
    .main-menu main { display:grid; grid-template-columns:minmax(330px, 400px) 1fr; gap:14px; min-height:0; }
    .main-menu .mm-side { overflow:auto; max-height:calc(100vh - 190px); padding-right:6px; }
    .main-menu fieldset { border:1px solid var(--line); border-radius:4px; margin:0 0 10px; padding:6px 10px 10px; min-width:0; }
    .main-menu fieldset:disabled { opacity:.5; }
    .main-menu legend { padding:0 4px; font-weight:600; }
    .main-menu label { display:block; margin:7px 0 3px; }
    .main-menu label.mm-check { display:flex; gap:6px; align-items:center; margin:7px 0 0; }
    .main-menu :is(input[type=text], select) { width:100%; }
    .main-menu .mm-row { display:flex; gap:8px; align-items:end; } .main-menu .mm-row > div { flex:1; min-width:0; }
    .main-menu .mm-colours { display:flex; gap:10px; flex-wrap:wrap; } .main-menu .mm-colours label { margin:6px 0 0; }
    .main-menu .mm-seg { display:flex; } .main-menu .mm-seg button { flex:1; border-radius:0; }
    .main-menu .mm-seg button:first-child { border-radius:3px 0 0 3px; } .main-menu .mm-seg button:last-child { border-radius:0 3px 3px 0; }
    .main-menu .mm-seg button[aria-pressed=true] { background:var(--accent); color:var(--accent-ink); }
    .main-menu .mm-btn { border:1px solid var(--line); border-radius:3px; padding:6px; margin:6px 0; }
    .main-menu .mm-btn .mm-row { align-items:center; } .main-menu .mm-btn .mm-tools { flex:0 0 auto; display:flex; gap:2px; }
    .main-menu .mm-btn .mm-tools button { padding:2px 6px; min-width:0; }
    .main-menu .mm-btn .mm-row + .mm-row { margin-top:5px; }
    .main-menu .mm-logo { display:flex; align-items:center; gap:8px; margin-top:6px; }
    .main-menu .mm-logo img { max-width:120px; max-height:48px; background:#222; border:1px solid var(--line); }
    .main-menu .mm-note { color:var(--dim); font-size:11px; margin:5px 0 0; }
    .main-menu .mm-bad { color:var(--warn); margin:4px 0 0; font-size:12px; }
    .main-menu .mm-view { display:flex; flex-direction:column; gap:6px; min-width:0; }
    .main-menu .mm-screen { position:relative; width:100%; aspect-ratio:16 / 9; overflow:hidden; border:1px solid var(--line);
      border-radius:3px; background:radial-gradient(ellipse at 60% 40%, #3a4250, #101318 75%); background-size:cover; background-position:center; }
    .main-menu .mm-screen > * { position:absolute; }
    .main-menu .mm-shade { top:0; bottom:0; background:linear-gradient(90deg, transparent, rgba(0,0,0,.5) 4%, rgba(0,0,0,.5) 96%, transparent); }
    .main-menu .mm-title { white-space:nowrap; overflow:hidden; }
    .main-menu .mm-b { display:flex; align-items:center; box-sizing:border-box; padding:0 10px; white-space:nowrap; overflow:hidden; }
    .main-menu .mm-b.game { background:linear-gradient(#2c3540cc, #161c24cc); border:1px solid #5d6b7a; border-left:4px solid #8aa3bf;
      justify-content:center; color:#d6dde6; }
    .main-menu .mm-b.game.off { color:#666; border-left-color:#444; }
    .main-menu .mm-b.text { padding:0; }
    .main-menu .mm-footer { right:1%; bottom:1.5%; color:#c8c8c8; }
    .main-menu .mm-hint { right:2%; top:2%; text-align:right; color:#ffffff66; font-size:11px; max-width:45%; }
    @media (max-width: 900px) {
      .main-menu main { grid-template-columns:minmax(0, 1fr); overflow:auto; max-height:calc(100vh - 170px); }
      .main-menu .mm-view { order:-1; }
      .main-menu .mm-side { max-height:none; overflow:visible; padding-right:0; }
    }`;
  document.head.appendChild(style);
}

function option(value, label, current) {
  return `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
}

export async function openMainMenu() {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'map-dialog main-menu'; dialog.setAttribute('aria-labelledby', 'main-menu-title');
    document.body.appendChild(dialog);
    css();
  }
  dialog.innerHTML = `<form method="dialog"><header><h2 id="main-menu-title">Main menu</h2><button type="button" data-close>Close</button></header>
    <main><p class="mm-note">Opening…</p></main>
    <footer><span class="mm-bad" role="status" style="margin-right:auto"></span><button type="button" data-close>Close</button>
    <button type="button" data-play>Play the menu</button><button type="submit" class="primary">Save</button></footer></form>`;
  const $ = (s) => dialog.querySelector(s);
  for (const b of dialog.querySelectorAll('[data-close]')) b.onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
  let snap;
  try { snap = await call('/api/main_menu'); } catch (e) { $('main').innerHTML = `<p class="mm-bad">${esc(e.message)}</p>`; return; }
  if (!snap.available) {
    $('main').innerHTML = '<p class="mm-bad">Only your own campaign projects have a main menu of their own (the original campaign and the tutorial use the game\'s).</p>';
    $('[data-play]').disabled = $('button[type=submit]').disabled = true;
    return;
  }
  const menu = structuredClone(snap.menu), maps = snap.maps;
  let revision = snap.revision, logo = null;                 // logo: null as saved, '' removed, a data: URL new
  let logoUrl = snap.hasLogo ? `/api/main_menu_logo?t=${Date.now()}` : '', logoSize = { w: 0, h: 0 };
  let where = 'menu', dirty = false;
  if (!menu.menuMap && maps.length) menu.menuMap = maps[0];
  if (!menu.startMap && maps.length) menu.startMap = maps.find((m) => m !== menu.menuMap) || maps[0];
  const mapOptions = (current) => (maps.length ? '' : '<option value="">(no installed maps)</option>')
    + maps.map((m) => option(m, m, current)).join('') + (current && !maps.includes(current) ? option(current, `${current} (not installed)`, current) : '');
  const fonts = (current) => snap.fonts.map((f) => option(f, FONT_LABELS[f] || f, current)).join('');
  const seg = (key, items) => `<div class="mm-seg" data-seg="${key}">${items.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${menu[key] === v}">${l}</button>`).join('')}</div>`;

  $('main').innerHTML = `<div class="mm-side">
    <label class="mm-check"><input type="checkbox" id="mm-on" ${menu.enabled ? 'checked' : ''}> Use this project's own main menu</label>
    <p class="mm-note">When the game is started as your mod (Play the menu, an exported mod), this menu takes the place of the game's title screen and of its menu on Esc.</p>
    <div id="mm-all">
    <fieldset><legend>Scene</legend>
      <label for="mm-map">The map behind the menu</label><select id="mm-map">${mapOptions(menu.menuMap)}</select>
      <p class="mm-note">The view is the one from its Player Start. Nobody can move there: it is the title screen.</p>
      <label>The view</label>${seg('camera', [['still', 'Still'], ['sway', 'Slowly moving']])}
    </fieldset>
    <fieldset><legend>New game</legend>
      <label for="mm-start">Starts on</label><select id="mm-start">${mapOptions(menu.startMap)}</select>
      <label class="mm-check"><input type="checkbox" id="mm-screens" ${menu.characterScreens ? 'checked' : ''}> The game's difficulty and character screens first</label>
    </fieldset>
    <fieldset><legend>Title</legend>
      <div class="mm-logo"><img id="mm-logo-img" alt="" hidden><button type="button" id="mm-logo-pick">Choose a picture…</button>
        <button type="button" id="mm-logo-del">Remove</button><input type="file" id="mm-logo-file" accept="image/png,image/jpeg" hidden></div>
      <label for="mm-logo-scale">Picture size <output id="mm-logo-scale-out"></output></label><input type="range" id="mm-logo-scale" min="0.25" max="2" step="0.05" value="${menu.logoScale}">
      <p class="mm-note">A PNG with a see-through background looks best. Up to 512 pixels across in the game.</p>
      <label for="mm-title">Title text</label><input type="text" id="mm-title" maxlength="80" value="${esc(menu.title)}" placeholder="Your game's name (or leave it to the picture)">
      <div class="mm-row"><div><label for="mm-tfont">Font</label><select id="mm-tfont">${fonts(menu.titleFont)}</select></div>
        <div style="flex:0 0 70px"><label for="mm-tcol">Colour</label><input type="color" id="mm-tcol" value="${menu.titleColor}"></div></div>
    </fieldset>
    <fieldset><legend>Layout</legend>
      ${seg('align', [['left', 'Left'], ['centre', 'Centre'], ['right', 'Right']])}
      <label for="mm-x">From the side <output id="mm-x-out"></output></label><input type="range" id="mm-x" min="0" max="0.6" step="0.01" value="${menu.x}">
      <label for="mm-y">From the top <output id="mm-y-out"></output></label><input type="range" id="mm-y" min="0.02" max="0.85" step="0.01" value="${menu.y}">
      <label class="mm-check"><input type="checkbox" id="mm-shade" ${menu.shade ? 'checked' : ''}> A dark band behind the buttons</label>
    </fieldset>
    <fieldset><legend>Buttons</legend>
      ${seg('look', [['game', 'The game\'s buttons'], ['text', 'Text only']])}
      <div class="mm-row"><div><label for="mm-bfont">Font</label><select id="mm-bfont">${fonts(menu.buttonFont)}</select></div>
        <div><label for="mm-bw">Width <output id="mm-bw-out"></output></label><input type="range" id="mm-bw" min="120" max="500" step="5" value="${menu.buttonWidth}"></div></div>
      <div class="mm-colours" id="mm-text-colours"><label>Text <input type="color" id="mm-c-text" value="${menu.textColor}"></label>
        <label>Under the mouse <input type="color" id="mm-c-hover" value="${menu.hoverColor}"></label>
        <label>Not available <input type="color" id="mm-c-off" value="${menu.disabledColor}"></label></div>
      <div id="mm-buttons"></div>
      <button type="button" id="mm-add">Add a button</button>
    </fieldset>
    <fieldset><legend>Corner text</legend>
      <input type="text" id="mm-footer" maxlength="80" value="${esc(menu.footer)}" placeholder="A version, your name… (bottom right)">
    </fieldset>
    </div>
    <div id="mm-problems"></div></div>
    <div class="mm-view"><div class="mm-seg" id="mm-where"><button type="button" data-w="menu" aria-pressed="true">On the title screen</button><button type="button" data-w="game" aria-pressed="false">On Esc during the game</button></div>
      <div class="mm-screen" id="mm-screen"></div>
      <p class="mm-note">Close to what the game shows (its own fonts and screen size differ): Play the menu to see the real one.</p></div>`;

  const field = (id) => $('#' + id);
  const set = (key, value) => { menu[key] = value; dirty = true; draw(); };
  const bind = (id, key, read = (el) => el.value) => { field(id).addEventListener('input', (e) => set(key, read(e.target))); };
  field('mm-on').onchange = (e) => set('enabled', e.target.checked);
  bind('mm-map', 'menuMap'); bind('mm-start', 'startMap');
  field('mm-screens').onchange = (e) => set('characterScreens', e.target.checked);
  bind('mm-title', 'title'); bind('mm-tfont', 'titleFont'); bind('mm-tcol', 'titleColor');
  bind('mm-logo-scale', 'logoScale', (el) => +el.value); bind('mm-x', 'x', (el) => +el.value); bind('mm-y', 'y', (el) => +el.value);
  field('mm-shade').onchange = (e) => set('shade', e.target.checked);
  bind('mm-bfont', 'buttonFont'); bind('mm-bw', 'buttonWidth', (el) => +el.value);
  bind('mm-c-text', 'textColor'); bind('mm-c-hover', 'hoverColor'); bind('mm-c-off', 'disabledColor');
  bind('mm-footer', 'footer');
  for (const s of dialog.querySelectorAll('[data-seg]')) {
    s.onclick = (e) => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      for (const o of s.querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
      set(s.dataset.seg, b.dataset.v);
    };
  }
  field('mm-where').onclick = (e) => {
    const b = e.target.closest('button[data-w]'); if (!b) return;
    where = b.dataset.w;
    for (const o of field('mm-where').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
    draw();
  };
  field('mm-logo-pick').onclick = () => field('mm-logo-file').click();
  field('mm-logo-file').onchange = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 8 * 1024 * 1024) { $('.mm-bad').textContent = 'The picture is too large (8 MB at most).'; return; }
    const reader = new FileReader();
    reader.onload = () => { logo = reader.result; logoUrl = logo; menu.logo = true; dirty = true; loadLogo(); };
    reader.readAsDataURL(file);
  };
  field('mm-logo-del').onclick = () => { logo = ''; logoUrl = ''; menu.logo = false; dirty = true; loadLogo(); };
  field('mm-add').onclick = () => {
    if (menu.buttons.length >= MAX_BUTTONS) return;
    menu.buttons.push({ label: 'New button', action: 'map', shows: 'menu', map: maps[0] || '' });
    dirty = true; drawButtons(); draw();
  };

  function loadLogo() {
    const img = field('mm-logo-img');
    img.hidden = !logoUrl; field('mm-logo-del').disabled = !logoUrl; field('mm-logo-scale').disabled = !logoUrl;
    if (!logoUrl) { logoSize = { w: 0, h: 0 }; draw(); return; }
    img.onload = () => {
      const k = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));      // as main_menu._logo_pcx fits it
      logoSize = { w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k) };
      draw();
    };
    img.src = logoUrl;
  }

  function drawButtons() {
    const box = field('mm-buttons');
    box.innerHTML = menu.buttons.map((b, i) => `<div class="mm-btn" data-i="${i}">
      <div class="mm-row"><div><input type="text" data-k="label" maxlength="40" value="${esc(b.label)}" aria-label="Button text"></div>
        <div class="mm-tools"><button type="button" data-do="up" title="Move up" ${i ? '' : 'disabled'}>↑</button>
        <button type="button" data-do="down" title="Move down" ${i < menu.buttons.length - 1 ? '' : 'disabled'}>↓</button>
        <button type="button" data-do="del" title="Remove">✕</button></div></div>
      <div class="mm-row"><div><select data-k="action" aria-label="What it does">${Object.entries(ACTION_LABELS).map(([v, l]) => option(v, l, b.action)).join('')}</select></div>
        <div><select data-k="shows" aria-label="Where it shows">${Object.entries(SHOW_LABELS).map(([v, l]) => option(v, l, b.shows)).join('')}</select></div></div>
      ${b.action === 'map' ? `<div class="mm-row"><div><select data-k="map" aria-label="The map it starts">${mapOptions(b.map)}</select></div></div>` : ''}</div>`).join('');
    field('mm-add').disabled = menu.buttons.length >= MAX_BUTTONS;
  }
  field('mm-buttons').addEventListener('input', (e) => {
    const row = e.target.closest('.mm-btn'), k = e.target.dataset.k; if (!row || !k) return;
    const b = menu.buttons[+row.dataset.i];
    b[k] = e.target.value;
    if (k === 'action') { if (b.action === 'map' && !b.map) b.map = maps[0] || ''; drawButtons(); }
    dirty = true; draw();
  });
  field('mm-buttons').addEventListener('click', (e) => {
    const t = e.target.closest('button[data-do]'), row = e.target.closest('.mm-btn'); if (!t || !row) return;
    const i = +row.dataset.i, list = menu.buttons;
    if (t.dataset.do === 'del') list.splice(i, 1);
    else { const j = t.dataset.do === 'up' ? i - 1 : i + 1; [list[i], list[j]] = [list[j], list[i]]; }
    dirty = true; drawButtons(); draw();
  });

  // the preview, drawn as UCMainMenu draws the menu, on SCREEN scaled to the box
  const measure = document.createElement('canvas').getContext('2d');
  function textSize(font, text) { measure.font = FONT_CSS[font]; const m = measure.measureText(text || 'Mg'); return { w: m.width, h: parseInt(FONT_CSS[font].match(/(\d+)px/)[1], 10) * 1.2 }; }
  function draw() {
    field('mm-all').querySelectorAll('fieldset').forEach((f) => { f.disabled = !menu.enabled; });
    field('mm-x').disabled = !menu.enabled || menu.align === 'centre';
    field('mm-text-colours').hidden = menu.look !== 'text';
    for (const [id, v] of [['mm-logo-scale', `${Math.round(menu.logoScale * 100)}%`], ['mm-x', `${Math.round(menu.x * 100)}%`],
      ['mm-y', `${Math.round(menu.y * 100)}%`], ['mm-bw', `${menu.buttonWidth}`]]) field(id + '-out').textContent = v;
    const screen = field('mm-screen'), k = screen.clientWidth / SCREEN.w || 0.5;
    const picture = viewPicture(menu.menuMap);
    screen.style.backgroundImage = picture ? `url(${picture})` : '';
    const list = visibleButtons(menu, where), title = textSize(menu.titleFont, menu.title), text = textSize(menu.buttonFont, 'Mg');
    const L = layout(menu, SCREEN.w, SCREEN.h, list.length, { logoW: logoUrl ? logoSize.w : 0, logoH: logoSize.h,
      titleW: menu.title ? title.w : 0, titleH: title.h, textH: text.h });
    const px = (v) => `${(v * k).toFixed(1)}px`, align = { left: 'left', centre: 'center', right: 'right' }[menu.align];
    let html = picture ? '' : '<div class="mm-hint">Open the map behind the menu to see its view here</div>';
    if (menu.shade && list.length) html += `<div class="mm-shade" style="left:${px(L.blockX - 40)};width:${px(L.blockW + 80)}"></div>`;
    if (logoUrl && L.logo.w) {
      const lx = menu.align === 'centre' ? L.blockX + (L.blockW - L.logo.w) / 2 : menu.align === 'right' ? L.blockX + L.blockW - L.logo.w : L.blockX;
      html += `<img src="${esc(logoUrl)}" alt="" style="left:${px(lx)};top:${px(L.blockY)};width:${px(L.logo.w)};height:${px(L.logo.h)}">`;
    }
    if (menu.title) html += `<div class="mm-title" style="left:${px(L.blockX)};top:${px(L.titleY)};width:${px(L.blockW)};text-align:${align};font:${FONT_CSS[menu.titleFont]};font-size:${px(title.h / 1.2)};color:${menu.titleColor}">${esc(menu.title)}</div>`;
    list.forEach((b, i) => {
      const r = L.buttons[i], base = `left:${px(r.x)};top:${px(r.y)};width:${px(r.w)};height:${px(r.h)};font:${FONT_CSS[menu.buttonFont]};font-size:${px(text.h / 1.2)};`;
      html += menu.look === 'text'
        ? `<div class="mm-b text" style="${base}justify-content:${{ left: 'flex-start', centre: 'center', right: 'flex-end' }[menu.align]};color:${b.enabled ? (i === 0 ? menu.hoverColor : menu.textColor) : menu.disabledColor}">${esc(b.label)}</div>`
        : `<div class="mm-b game${b.enabled ? '' : ' off'}" style="${base}">${esc(b.label)}</div>`;
    });
    if (menu.footer) html += `<div class="mm-footer" style="font:${FONT_CSS.small};font-size:${px(13)}">${esc(menu.footer)}</div>`;
    screen.innerHTML = html;
    const local = [];
    if (menu.enabled) {
      if (!menu.menuMap) local.push('Choose the map behind the menu.');
      if (!menu.startMap) local.push('Choose the map a new game starts on.');
      if (!menu.buttons.some((b) => b.action === 'new')) local.push('No button starts a new game.');
    }
    field('mm-problems').innerHTML = [...new Set([...local, ...(dirty ? [] : snap.problems)])].map((p) => `<p class="mm-bad">${esc(p)}</p>`).join('');
  }
  new ResizeObserver(() => draw()).observe(field('mm-screen'));
  drawButtons(); loadLogo(); draw();

  async function save() {
    const msg = $('.mm-bad[role=status]'); msg.textContent = '';
    const body = { menu: { ...menu }, revision };
    if (logo !== null) body.logo = logo;
    const r = await call('/api/main_menu', body);
    snap = r; revision = r.revision; logo = null; dirty = false;
    Object.assign(menu, r.menu);
    draw();
    return r;
  }
  $('form').onsubmit = async (e) => {
    e.preventDefault();
    const b = $('button[type=submit]'); b.disabled = true;
    try { const r = await save(); $('.mm-bad[role=status]').textContent = r.problems.length ? 'Saved, not ready yet.' : 'Saved.'; }
    catch (err) { $('.mm-bad[role=status]').textContent = err.message; }
    finally { b.disabled = false; }
  };
  $('[data-play]').onclick = async () => {
    const b = $('[data-play]'), msg = $('.mm-bad[role=status]'); b.disabled = true;
    try {
      if (!menu.enabled) { menu.enabled = true; field('mm-on').checked = true; }
      const saved = await save();
      if (saved.problems.length) { msg.textContent = 'Not ready yet: see below.'; return; }
      msg.textContent = 'Building the project and starting the game… it takes a little while.';
      const r = await call('/api/main_menu_play', { displayMode: 'external' });
      msg.textContent = r.ok ? 'The game is starting on your menu.' : (r.lines || []).slice(-3).join(' ');
    } catch (err) { msg.textContent = err.message; }
    finally { b.disabled = false; }
  };
}
if (typeof window !== 'undefined') window.__mainMenu = { open: openMainMenu };
