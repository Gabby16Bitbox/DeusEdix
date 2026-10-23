// The texture picker (Gabby, 17 Oct 2026: "the textures must have a preview"): every texture field of the
// Inspector (an input with list="texlist": blocks, holes, drawn walls and roads, signs...) gets a small picture
// of its texture next to it; clicking it opens a grid of pictures, like Unity's object picker: the textures of
// this map first, then every texture of the game by package (server: editor/texpicker.py, the pictures made
// from the player's own packages the first time a package is opened). A click tries the texture at once,
// a double click (or Enter) keeps it and closes, Esc closes.
const STYLE = `
.tp-swatch { flex:none; width:22px; height:22px; min-height:22px; padding:0; margin-left:4px; border:1px solid var(--line);
  border-radius:var(--radius-control); background:var(--field) center/cover no-repeat; cursor:pointer; }
.tp-swatch:hover, .tp-swatch:focus-visible { border-color:var(--accent-border); }
#texpicker { position:fixed; z-index:30; width:min(640px, calc(100vw - 32px)); height:min(520px, calc(100vh - 80px));
  display:flex; flex-direction:column; background:var(--panel); border:1px solid var(--line); border-radius:var(--radius-window);
  box-shadow:0 14px 30px #0009; color:var(--text); font-size:12px; }
#texpicker .tp-head { flex:none; height:28px; display:flex; align-items:center; gap:6px; padding:0 4px 0 10px; border-bottom:1px solid var(--line); }
#texpicker .tp-head b { font-size:13px; color:var(--heading); }
#texpicker .tp-head input { flex:1; min-width:0; height:22px; padding:0 6px; background:var(--field); color:var(--text);
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
`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shortName = (t) => String(t || '').split('.').pop();

export function createTexturePicker({ api, getMapTextures }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  let index = null, indexing = null;                 // {packages: [{name, textures: [[short, full, w, h]]}]}
  const thumbs = new Map();                          // short name (lower case) -> picture url
  const loadingPkg = new Map();
  let box = null, target = null, source = 'map', query = '';

  async function loadIndex() {
    if (index) return index;
    indexing = indexing || api('/api/texture_index').then((r) => (index = r)).finally(() => { indexing = null; });
    return indexing;
  }
  async function loadThumbs(pkg) {
    if (!loadingPkg.has(pkg)) loadingPkg.set(pkg, api('/api/texture_thumbs?pkg=' + encodeURIComponent(pkg)).then((r) => {
      for (const [k, v] of Object.entries(r.thumbs || {})) thumbs.set(k.toLowerCase(), v);
      return r;
    }).catch((e) => { loadingPkg.delete(pkg); throw e; }));
    return loadingPkg.get(pkg);
  }
  const mapList = () => (getMapTextures() || []).filter((t) => t && t.name);
  function urlOf(name) {
    const n = shortName(name).toLowerCase();
    const own = mapList().find((t) => t.name.toLowerCase() === n);
    return (own && own.url) || thumbs.get(n) || '';
  }
  // the package a texture is in (its picture comes with the package's pictures)
  async function pictureOf(name) {
    const u = urlOf(name);
    if (u || !name) return u;
    const ix = await loadIndex();
    const n = shortName(name).toLowerCase();
    const pkg = ix.packages.find((p) => p.textures.some((t) => t[0].toLowerCase() === n));
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
    target = locate(target);
    if (!target) return close();
    target.value = name;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    if (keep) close(); else render();
  }
  function open(input) {
    close();
    target = input;
    query = '';
    source = 'map';
    box = document.createElement('div');
    box.id = 'texpicker';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Texture picker');
    box.innerHTML = `<div class="tp-head"><b>Textures</b><input type="search" placeholder="Search textures" aria-label="Search textures">
        <button type="button" data-tp-close title="Close (Esc)" aria-label="Close">✕</button></div>
      <div class="tp-body"><div class="tp-src"></div><div class="tp-grid"></div></div>
      <div class="tp-foot">Click: try it · Double click or Enter: keep it · Esc: close</div>`;
    document.body.appendChild(box);
    const r = input.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = Math.max(16, Math.min(window.innerWidth - w - 16, r.right - w)) + 'px';
    box.style.top = Math.max(16, Math.min(window.innerHeight - h - 16, r.bottom + 6)) + 'px';
    const search = box.querySelector('.tp-head input');
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
    search.focus();
    renderSources();
    render();
    loadIndex().then(() => { if (box) renderSources(); }).catch((e) => { if (box) box.querySelector('.tp-foot').textContent = 'The game\'s textures could not be listed: ' + e.message; });
  }
  function renderSources() {
    if (!box) return;
    const el = box.querySelector('.tp-src');
    const rows = [['map', 'This map', mapList().length], ['all', 'All textures', index ? index.packages.reduce((n, p) => n + p.textures.length, 0) : '…']];
    let h = rows.map(([k, l, n]) => `<div data-src="${k}" class="${source === k ? 'on' : ''}"><span>${esc(l)}</span><small>${n}</small></div>`).join('') + '<hr>';
    if (index) h += index.packages.map((p) => `<div data-src="pkg:${esc(p.name)}" class="${source === 'pkg:' + p.name ? 'on' : ''}" title="${esc(p.name)}"><span>${esc(p.name)}</span><small>${p.textures.length}</small></div>`).join('');
    else h += '<div style="cursor:default;color:var(--dim)">reading the game…</div>';
    el.innerHTML = h;
    for (const d of el.querySelectorAll('[data-src]')) d.onclick = () => { source = d.dataset.src; renderSources(); render(); };
  }
  function tile(name, url, size, current) {
    return `<div class="tp-tile ${current ? 'on' : ''}" data-name="${esc(name)}" title="${esc(name)}${size ? ' · ' + size : ''}">
      <div class="tp-img">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : ''}</div><small>${esc(name)}</small>${size ? `<em>${esc(size)}</em>` : ''}</div>`;
  }
  async function render() {
    if (!box) return;
    const grid = box.querySelector('.tp-grid'), cur = shortName(target ? target.value : '').toLowerCase();
    const match = (n) => !query || n.toLowerCase().includes(query);
    let items = [], note = '';
    if (source === 'map') {
      items = mapList().filter((t) => match(t.name)).map((t) => ({ name: t.name, url: t.url, size: t.size || '' }));
      if (!items.length) note = query ? 'No texture of this map has that name. Try All textures.' : 'This map has no textures yet.';
    } else {
      const ix = index || await loadIndex().catch(() => null);
      if (!box || !ix) return;
      const pkgs = source === 'all' ? ix.packages : ix.packages.filter((p) => 'pkg:' + p.name === source);
      for (const p of pkgs) for (const t of p.textures) if (match(t[0])) items.push({ name: t[0], pkg: p.name, size: t[2] + '×' + t[3] });
      if (source === 'all' && !query) { items = []; note = 'Type a name to search every texture of the game, or pick a package on the left.'; }
      else if (!items.length) note = 'No texture with that name.';
      if (items.length > 240) { note = `${items.length} textures: the first 240 are shown, type more of the name.`; items = items.slice(0, 240); }
      const need = [...new Set(items.filter((i) => !thumbs.has(i.name.toLowerCase())).map((i) => i.pkg))].slice(0, 6);
      if (need.length) {
        box.querySelector('.tp-foot').textContent = `Making the pictures of ${need.join(', ')} (the first time only)…`;
        Promise.all(need.map(loadThumbs)).then(() => { if (box) { box.querySelector('.tp-foot').textContent = 'Click: try it · Double click or Enter: keep it · Esc: close'; render(); } })
          .catch((e) => { if (box) box.querySelector('.tp-foot').textContent = 'Pictures: ' + e.message; });
      }
      for (const i of items) i.url = thumbs.get(i.name.toLowerCase()) || '';
    }
    grid.innerHTML = (note ? `<div class="tp-note">${esc(note)}</div>` : '') + items.map((i) => tile(i.name, i.url, i.size, i.name.toLowerCase() === cur)).join('');
    for (const t of grid.querySelectorAll('.tp-tile')) {
      t.onclick = () => choose(t.dataset.name, false);
      t.ondblclick = () => choose(t.dataset.name, true);
    }
    grid.querySelector('.tp-tile.on')?.scrollIntoView({ block: 'nearest' });
  }
  return { open, close, attach, pictureOf };
}
