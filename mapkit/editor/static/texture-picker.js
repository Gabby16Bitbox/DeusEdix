// The texture picker (Gabby, 17 Oct 2026: "the textures must have a preview"): every texture field of the
// Inspector (an input with list="texlist": blocks, holes, drawn walls and roads, signs...) gets a small picture
// of its texture next to it; clicking it opens a grid of pictures, like Unity's object picker: the textures of
// this map first, then every texture of the game by package (server: editor/texpicker.py, the pictures made
// from the player's own packages the first time a package is opened). A click tries the texture at once,
// a double click (or Enter) keeps it and closes, Esc closes. The star of a texture keeps it in Favourites (the first
// source on the left, for this project); the slider at the top, or Ctrl+wheel over the grid, sizes the pictures.
import { mountTileSize } from './browser-tiles.js';

const STYLE = `
.tp-swatch { flex:none; width:22px; height:22px; min-height:22px; padding:0; margin-left:4px; border:1px solid var(--line);
  border-radius:var(--radius-control); background:var(--field) center/cover no-repeat; cursor:pointer; }
.tp-swatch:hover, .tp-swatch:focus-visible { border-color:var(--accent-border); }
#texpicker { position:fixed; z-index:30; width:min(640px, calc(100vw - 32px)); height:min(520px, calc(100vh - 80px));
  display:flex; flex-direction:column; background:var(--panel); border:1px solid var(--line); border-radius:var(--radius-window);
  box-shadow:0 14px 30px #0009; color:var(--text); font-size:12px; }
#texpicker .tp-head { flex:none; height:28px; display:flex; align-items:center; gap:6px; padding:0 4px 0 10px; border-bottom:1px solid var(--line); }
#texpicker .tp-head b { font-size:13px; color:var(--heading); }
#texpicker .tp-head input[type=search] { flex:1; min-width:0; height:22px; padding:0 6px; background:var(--field); color:var(--text);
  border:1px solid var(--line); border-radius:var(--radius-control); font-size:12px; }
#texpicker .tp-head button { width:24px; height:24px; min-height:24px; padding:0; border:0; background:transparent; color:var(--dim); }
#texpicker .tp-head button:hover { color:var(--text); background:var(--hover); }
#texpicker .tp-body { flex:1; min-height:0; display:flex; }
#texpicker .tp-src { flex:none; width:168px; overflow:auto; border-right:1px solid var(--line); padding:4px 0; }
#texpicker .tp-src div { height:22px; line-height:22px; padding:0 8px; display:flex; gap:6px; cursor:pointer; white-space:nowrap; }
#texpicker .tp-src div span { flex:1; overflow:hidden; text-overflow:ellipsis; }
#texpicker .tp-src div small { color:var(--dim); font-size:11px; font-variant-numeric:tabular-nums; }
#texpicker .tp-src div:hover { background:var(--hover); }
#texpicker .tp-src div.on { background:var(--accent-soft); color:var(--heading); }
#texpicker .tp-src hr { border:0; border-top:1px solid var(--line); margin:4px 0; }
#texpicker .tp-grid { flex:1; min-width:0; overflow:auto; padding:6px; display:grid; grid-template-columns:repeat(auto-fill, minmax(84px, 1fr));
  gap:6px; align-content:start; }
#texpicker .tp-tile { display:flex; flex-direction:column; gap:2px; padding:3px; border:1px solid transparent; border-radius:var(--radius-control);
  cursor:pointer; min-width:0; }
#texpicker .tp-tile:hover { background:var(--hover); }
#texpicker .tp-tile.on { border-color:var(--acc); background:var(--accent-soft); }
#texpicker .tp-img { aspect-ratio:1; border-radius:var(--radius-row); background:#2c3038 center/contain no-repeat;
  background-image:linear-gradient(45deg,#3a3e47 25%,transparent 25%,transparent 75%,#3a3e47 75%),linear-gradient(45deg,#3a3e47 25%,transparent 25%,transparent 75%,#3a3e47 75%);
  background-size:12px 12px; background-position:0 0,6px 6px; position:relative; overflow:hidden; }
#texpicker .tp-img img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }
#texpicker .tp-tile small { font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#texpicker .tp-tile em { font-style:normal; font-size:11px; color:var(--dim); font-variant-numeric:tabular-nums; }
#texpicker .tp-note { grid-column:1/-1; color:var(--dim); padding:8px 4px; }
#texpicker .tp-foot { flex:none; height:28px; display:flex; align-items:center; padding:0 10px; border-top:1px solid var(--line); color:var(--dim); font-size:11px; }
#texpicker .tp-size { flex:none; width:64px; }
#texpicker .tp-tile { position:relative; }
#texpicker[data-tiles="small"] .tp-grid { grid-template-columns:repeat(auto-fill, minmax(60px, 1fr)); gap:4px; }
#texpicker[data-tiles="large"] .tp-grid { grid-template-columns:repeat(auto-fill, minmax(128px, 1fr)); }
#texpicker[data-tiles="list"] .tp-grid { grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:2px 6px; }
#texpicker[data-tiles="list"] .tp-tile { flex-direction:row; align-items:center; gap:6px; padding:2px 22px 2px 3px; }
#texpicker[data-tiles="list"] .tp-img { flex:none; width:24px; }
#texpicker[data-tiles="list"] .tp-tile small { flex:1; }
#texpicker .tp-tile.fav-missing { border:1px dashed var(--line); opacity:.75; cursor:default; }
#texpicker .tp-tile.fav-missing .tp-img { display:flex; align-items:center; justify-content:center; color:var(--dim); font-size:18px; }
#texpicker .tp-tile.fav-missing em { color:var(--warn); }
`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shortName = (t) => String(t || '').split('.').pop();

// menu(x, y, items): the editor's right-click menu; findInMap(name): the objects of the map that use a texture;
// favourites: the stars of the textures (browser-tiles.js favouriteShelf), or none; storage(): the editor's storage
// (the tile size is kept there)
export function createTexturePicker({ api, getMapTextures, menu, findInMap, favourites = null, storage }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  let index = null, indexing = null;                 // {packages: [{name, textures: [[short, full, w, h]]}]}
  let named = null;                                  // the index by lower-case short name (the favourites' lookup)
  const thumbs = new Map();                          // short name (lower case) -> picture url
  const loadingPkg = new Map();
  let box = null, target = null, source = 'map', query = '';
  let browsed = '';                                  // the texture shown when there is no field to fill (browse)

  async function loadIndex() {
    if (index) return index;
    indexing = indexing || api('/api/texture_index').then((r) => (index = r)).finally(() => { indexing = null; });
    return indexing;
  }
  async function loadThumbs(pkg) {
    if (!loadingPkg.has(pkg)) loadingPkg.set(pkg, api('/api/texture_thumbs?pkg=' + encodeURIComponent(pkg)).then((r) => {
      for (const [k, v] of Object.entries(r.thumbs || {})) {
        thumbs.set(k.toLowerCase(), v);
        const entry = index?.packages.find(p => p.name === pkg)?.textures.find(t => t[0] === k);
        if (entry) thumbs.set(entry[1].toLowerCase(), v);
      }
      return r;
    }).catch((e) => { loadingPkg.delete(pkg); throw e; }));
    return loadingPkg.get(pkg);
  }
  const mapList = () => (getMapTextures() || []).filter((t) => t && t.name);
  function urlOf(name) {
    const n = shortName(name).toLowerCase();
    const own = mapList().find((t) => t.name.toLowerCase() === n);
    return String(name).includes('.') ? (thumbs.get(String(name).toLowerCase()) || '') : ((own && own.url) || thumbs.get(n) || '');
  }
  // a favourite texture by its name: this map's, else the game's (null: neither has it, ix: the game's index)
  function textureNamed(name, ix) {
    const n = name.toLowerCase(), own = mapList().find((t) => t.name.toLowerCase() === n);
    if (own) return { name: own.name, url: own.url, size: own.size || '' };
    if (!named) {
      named = new Map();
      for (const p of ix.packages) for (const t of p.textures) {
        const item = { name: p.kind === 'skins' ? t[1] : t[0], pkg: p.name, size: t[2] + '×' + t[3] };
        if (!named.has(t[0].toLowerCase())) named.set(t[0].toLowerCase(), item);
        named.set(t[1].toLowerCase(), item);
      }
    }
    return named.get(n) ? { ...named.get(n) } : null;
  }
  function packageOf(value, ix) {
    const ref = String(value || '').replace(/^\w+'([^']+)'$/, '$1').toLowerCase();
    return ix.packages.find(p => p.textures.some(t => t[1].toLowerCase() === ref)) ||
      ix.packages.find(p => p.textures.some(t => t[0].toLowerCase() === shortName(ref)));
  }
  // the package a texture is in (its picture comes with the package's pictures)
  async function pictureOf(name) {
    const u = urlOf(name);
    if (u || !name) return u;
    const ix = await loadIndex();
    const n = shortName(name).toLowerCase();
    const pkg = packageOf(name, ix);
    if (!pkg) return '';
    await loadThumbs(pkg.name);
    return urlOf(name);
  }

  // ---------------------------------------------------------------- the small picture next to every texture field
  function attach(input) {
    if (input.dataset.tp) return;
    input.dataset.tp = '1';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tp-swatch';
    b.title = 'Pick a texture with pictures (the textures of this map, then every texture of the game)';
    b.setAttribute('aria-label', 'Pick a texture');
    input.insertAdjacentElement('afterend', b);
    const paint = async () => {
      const value = input.value.trim();
      try { const u = await pictureOf(value); if (input.value.trim() === value) b.style.backgroundImage = u ? `url("${u}")` : ''; } catch { /* no picture */ }
    };
    input.addEventListener('change', paint);
    input.addEventListener('focus', () => input.select());     // typing replaces the suggested texture at once
    b.onclick = (e) => { e.preventDefault(); open(input); };
    paint();
  }
  new MutationObserver(() => { for (const i of document.querySelectorAll('input[list="texlist"]:not([data-tp])')) attach(i); })
    .observe(document.body, { childList: true, subtree: true });

  // ---------------------------------------------------------------- the picker window
  function close() {
    if (box) box.remove();
    box = null; target = null;
    document.removeEventListener('pointerdown', outside, true);
  }
  function outside(e) { if (box && !box.contains(e.target) && !(e.target.classList && e.target.classList.contains('tp-swatch'))) close(); }
  // the field again after the Inspector drew itself anew (a change redraws it): by its id or its data-* key
  function locate(i) {
    if (!i || i.isConnected) return i;
    if (i.id) return document.getElementById(i.id);
    for (const [k, v] of Object.entries(i.dataset)) {
      if (k === 'tp') continue;
      const attr = 'data-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
      const el = [...document.querySelectorAll('input[list="texlist"]')].find((x) => x.getAttribute(attr) === v);
      if (el) return el;
    }
    return null;
  }
  function choose(name, keep) {
    if (!target) { browsed = name; return keep ? close() : render(); }       // only looking: it is marked
    target = locate(target);
    if (!target) return close();
    target.value = name;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    if (keep) close(); else render();
  }
  // what the foot says: how to choose with a field to fill, else how to find it in the map
  const hint = () => (target ? 'Click: try it · Double click or Enter: keep it · Esc: close' : `${findInMap ? 'Right click: Find in map · ' : ''}Esc: close`);
  // input: the field it fills (none: only looking, browse); name: what it searches for first
  function open(input, name = '') {
    close();
    target = input;
    browsed = name;
    query = '';
    source = 'map';
    const initialTexture = input?.value || name;
    box = document.createElement('div');
    box.id = 'texpicker';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Texture picker');
    box.innerHTML = `<div class="tp-head"><b>Textures</b><input type="search" placeholder="Search textures" aria-label="Search textures">
        <input type="range" class="tp-size" aria-label="Tile size"><button type="button" data-tp-close title="Close (Esc)" aria-label="Close">✕</button></div>
      <div class="tp-body"><div class="tp-src"></div><div class="tp-grid"></div></div>
      <div class="tp-foot">${hint()}</div>`;
    document.body.appendChild(box);
    // under its field, else in the middle of the window, a third of the way down
    const w = box.offsetWidth, h = box.offsetHeight;
    const r = input ? input.getBoundingClientRect() : { right: (window.innerWidth + w) / 2, bottom: (window.innerHeight - h) / 3 };
    box.style.left = Math.max(16, Math.min(window.innerWidth - w - 16, r.right - w)) + 'px';
    box.style.top = Math.max(16, Math.min(window.innerHeight - h - 16, r.bottom + 6)) + 'px';
    const search = box.querySelector('.tp-head input[type=search]');
    mountTileSize({ root: box, slider: box.querySelector('.tp-size'), grid: '.tp-grid', tile: '.tp-tile', key: 'ucmap.tptiles', storage });
    search.oninput = () => {
      query = search.value.trim().toLowerCase();
      // a name this map has not: the whole game is searched at once (it said "Try All textures": one more click)
      if (query && source === 'map' && !mapList().some((t) => t.name.toLowerCase().includes(query))) { source = 'all'; renderSources(); }
      render();
    };
    box.querySelector('[data-tp-close]').onclick = close;
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter') close();
    });
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
    search.value = name;
    search.focus();
    search.select();
    renderSources();
    search.oninput();
    const openedBox = box;
    loadIndex().then(ix => {
      if (!box || box !== openedBox) return;
      const pkg = packageOf(initialTexture, ix);
      if (pkg && source === 'map' && !query) { source = 'pkg:' + pkg.name; render(); }
      renderSources();
      box.querySelector('.tp-src .on')?.scrollIntoView({ block: 'nearest' });
    }).catch((e) => { if (box) box.querySelector('.tp-foot').textContent = 'The game\'s textures could not be listed: ' + e.message; });
  }
  function renderSources() {
    if (!box) return;
    const el = box.querySelector('.tp-src');
    const rows = [...(favourites ? [['favs', favourites.group, favourites.list().length]] : []), ['map', 'This map', mapList().length],
      ['all', 'All textures', index ? index.packages.reduce((n, p) => n + p.textures.length, 0) : '…']];
    let h = rows.map(([k, l, n]) => `<div data-src="${k}" class="${source === k ? 'on' : ''}"><span>${esc(l)}</span><small>${n}</small></div>`).join('') + '<hr>';
    if (index) h += index.packages.map((p) => `<div data-src="pkg:${esc(p.name)}" class="${source === 'pkg:' + p.name ? 'on' : ''}" title="${esc(p.name)}"><span>${esc(p.name)}</span><small>${p.textures.length}</small></div>`).join('');
    else h += '<div style="cursor:default;color:var(--dim)">reading the game…</div>';
    el.innerHTML = h;
    for (const d of el.querySelectorAll('[data-src]')) d.onclick = () => { source = d.dataset.src; renderSources(); render(); };
  }
  // missing: a favourite no package nor the map has now (its star unstars it)
  function tile(name, url, size, current, missing) {
    const star = favourites ? favourites.star(name, name) : '';
    if (missing) return `<div class="tp-tile fav-missing" title="${esc(favourites.goneTitle({ label: name }))}"><div class="tp-img">?</div><small>${esc(shortName(name))}</small><em>Missing</em>${star}</div>`;
    return `<div class="tp-tile ${current ? 'on' : ''}" data-name="${esc(name)}" title="${esc(name)}${size ? ' · ' + size : ''}${findInMap ? ' · Right click: Find in map' : ''}">
      <div class="tp-img">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : ''}</div><small>${esc(shortName(name))}</small>${size ? `<em>${esc(size)}</em>` : ''}${star}</div>`;
  }
  async function render() {
    if (!box) return;
    const grid = box.querySelector('.tp-grid'), cur = shortName(target ? target.value : browsed).toLowerCase();
    const match = (n) => !query || n.toLowerCase().includes(query);
    let items = [], note = '';
    if (source === 'map') {
      items = mapList().filter((t) => match(t.name)).map((t) => ({ name: t.name, url: t.url, size: t.size || '' }));
      if (!items.length) note = query ? 'No texture of this map has that name. Try All textures.' : 'This map has no textures yet.';
    } else {
      const ix = index || await loadIndex().catch(() => null);
      if (!box || (!ix && source !== 'favs')) return;
      if (source === 'favs') {
        // the starred ones, in the order they were starred: gone from the map and the game, missing (the game's
        // textures not read: no picture yet, none called missing)
        for (const { fav, item } of favourites.entries((id) => (ix ? textureNamed(id, ix) : { name: id }))) {
          if (match(fav.label)) items.push(item || { name: fav.id, missing: true });
        }
        if (!items.length) note = query ? 'No favourite texture has that name.' : 'No favourite textures yet: the star of a texture keeps it here, for this project.';
      } else {
        const pkgs = source === 'all' ? ix.packages : ix.packages.filter((p) => 'pkg:' + p.name === source);
        for (const p of pkgs) for (const t of p.textures) if (match(t[0])) items.push({ name: p.kind === 'skins' ? t[1] : t[0], pkg: p.name, size: t[2] + '×' + t[3] });
        if (source === 'all' && !query) { items = []; note = 'Type a name to search every texture of the game, or pick a package on the left.'; }
        else if (!items.length) note = 'No texture with that name.';
      }
      if (items.length > 240) { note = `${items.length} textures: the first 240 are shown, type more of the name.`; items = items.slice(0, 240); }
      // only packages not asked for yet: one whose pictures came without some of its textures asked again for ever
      // (each answer drew the grid, which asked again: the page froze, 24 Oct 2026)
      const need = [...new Set(items.filter((i) => i.pkg && !thumbs.has(i.name.toLowerCase())).map((i) => i.pkg))]
        .filter((p) => !loadingPkg.has(p)).slice(0, 6);
      if (need.length) {
        box.querySelector('.tp-foot').textContent = `Making the pictures of ${need.join(', ')} (the first time only)…`;
        Promise.all(need.map(loadThumbs)).then(() => { if (box) { box.querySelector('.tp-foot').textContent = hint(); render(); } })
          .catch((e) => { if (box) box.querySelector('.tp-foot').textContent = 'Pictures: ' + e.message; });
      }
      for (const i of items) i.url = i.url || thumbs.get(i.name.toLowerCase()) || '';
    }
    grid.innerHTML = (note ? `<div class="tp-note">${esc(note)}</div>` : '') + items.map((i) => tile(i.name, i.url, i.size, shortName(i.name).toLowerCase() === cur, i.missing)).join('');
    for (const t of grid.querySelectorAll('.tp-tile[data-name]')) {
      t.onclick = () => choose(t.dataset.name, false);
      t.ondblclick = (e) => { if (!e.target.closest('.fav-star')) choose(t.dataset.name, true); };   // a star's: two stars
      // right click: where the map uses it (the picker closes; the field keeps its texture)
      if (findInMap) t.oncontextmenu = (e) => { e.preventDefault(); menu(e.clientX, e.clientY, [{ label: 'Find in map', run: () => { close(); findInMap(t.dataset.name); } }]); };
    }
    grid.querySelector('.tp-tile.on')?.scrollIntoView({ block: 'nearest' });
  }
  // a texture shown with no field to fill (the command palette's Enter): the picker opened on its name, its picture
  // marked; right click finds it in the map
  function browse(name) { open(null, shortName(name)); }
  favourites?.subscribe(() => { if (box) { renderSources(); render(); } });   // a star clicked: the count, the grid
  return { open, close, attach, pictureOf, browse, index: loadIndex };
}
