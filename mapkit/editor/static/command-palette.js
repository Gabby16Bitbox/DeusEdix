// The command palette (Ctrl+K, or Edit > Search everything…), as Unity's Search window: one box over the menus'
// commands, the map's objects, the Objects browser's classes, textures, sounds, the Settings pages and the panels,
// found and ranked by command-search.js, under a heading for each kind. Up / Down choose, Enter runs what is chosen (a
// command through the menus' own runCommand: what a menu greys out is greyed here and does not run; an object is
// selected and framed; a class starts placing; a texture or a sound opens in its browser), Esc closes. It opens only
// over the editor itself: not over a window that holds it (the menus' list of them), the projects, the game played
// or the camera flying, nor while a text field has the keys (Ctrl+K there stays the field's). An empty box offers the
// last 20 searches (kept per project).
// api (app.js): escapeHtml, status(text, cls), recentKey() (where this project keeps the searches), busy(),
// objects(text) (the map's objects the Hierarchy's search finds), tokenValues(key) (what its autocomplete offers),
// classes(), textures() and sounds() (promises), sections() (the asset browser's): items {texts, label, detail,
// icon(), run} for command-search.js
import { readQuery, rankPalette, paletteSuggestions, stepRow, readRecent, withRecent } from './command-search.js';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./command-palette.css', import.meta.url).href;
document.head.appendChild(css);

const WAIT = 80;                         // ms of a pause in typing before the search (it reads every object of the map)
const PAGE = 100;                        // rows drawn at a time: a long list (> or @ alone lists all) grows as it is
                                         // scrolled or chosen down
const typing = (t) => !!t && (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable);

export function createCommandPalette(api) {
  const esc = api.escapeHtml;
  const root = document.createElement('div');
  root.id = 'cmdpal';
  root.hidden = true;
  root.innerHTML = `<div class="cp-win" role="dialog" aria-label="Search everything">
    <div class="cp-bar"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></svg>
      <input type="text" role="combobox" aria-expanded="true" aria-controls="cp-list" aria-autocomplete="list" aria-label="Search everything"
        placeholder="Search commands, objects, classes, textures, sounds…" spellcheck="false" autocomplete="off"></div>
    <div class="cp-list" id="cp-list" role="listbox" aria-label="Results"></div>
    <div class="cp-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span>
      <span><b>&gt;</b> commands</span><span><b>@</b> this map</span><span><b>t:</b> <b>tag:</b> <b>is:</b>… the Hierarchy's tokens</span></div></div>`;
  document.body.appendChild(root);
  const input = root.querySelector('input'), list = root.querySelector('.cp-list');

  let rows = [], at = -1;                  // the rows shown ({item, token, recent, label, detail, disabled}), the one chosen
  let heads = new Map(), drawn = 0;        // the headings before the rows that start a section; how many rows are drawn
  let found = null;                        // what the text searched last found ({text, objects, groups}): the caret
                                           // moved in it asks only for its tokens again
  let fixed = {};                          // what stays while it is open: the commands (with their state then), classes, pages, panels
  const assets = { texture: [], sound: [] };   // the textures and the sounds, once read
  let timer = 0, before = null, loads = 0;
  const isOpen = () => !root.hidden;

  const recent = () => { try { return readRecent(localStorage.getItem(api.recentKey())); } catch { return []; } };
  function remember(text) {
    try { localStorage.setItem(api.recentKey(), JSON.stringify(withRecent(recent(), text))); } catch { /* no storage */ }
  }

  // the menus' commands (menubar.js describeMenu: enabled and ticked as their menu would be now) but the Window menu's
  // panels, which are under Panels once (Enter there brings one to the front; the menu's item hides it when shown), the
  // Settings pages, the panels; the classes and the asset browser's sections (app.js)
  function gather() {
    const mb = window.__menubar, panels = mb?.panels || [];
    const isPanel = (menu, it) => menu === 'Window' && panels.some(([, label]) => label === it.label);
    return {
      command: (mb?.describeMenu() || []).flatMap((m) => m.items.filter((it) => !it.sep && !isPanel(m.title, it)).map((it) => ({ texts: [it.label, m.title],
        label: it.label, detail: m.title, key: it.shortcut, checked: it.checked, disabled: !it.enabled, run: () => mb.runCommand(it.id) }))),
      class: api.classes(),
      setting: (mb?.settingsPages || []).map(([id, label, about]) => ({ texts: [label, 'Settings', about], label,
        detail: `Settings · ${about}`, run: () => mb.openSettings(id) })),
      panel: [...panels.map(([id, label]) => ({ texts: [label, 'Window'], label, detail: 'Window',
        run: () => window.__workspace?.show(id) })), ...api.sections()],
    };
  }
  // the textures and the sounds, asked for each time it opens (the first time the game's lists take a while): the
  // results again when they come
  function load() {
    const serial = ++loads;
    for (const [id, get] of [['texture', api.textures], ['sound', api.sounds]]) {
      Promise.resolve().then(get).then((items) => {
        if (serial !== loads) return;
        assets[id] = items;
        if (found) found.groups = null;      // ranked again with them (the map's objects are the same)
        if (isOpen()) search(true);
      }).catch(() => { /* not this kind, then */ });
    }
  }

  const rowKey = (r) => (r.item ? `${r.group}\n${r.label}\n${r.detail}` : r.token ? `token\n${r.token.text}` : `recent\n${r.recent}`);
  // what the text in the box finds, ranked in its groups: the map's objects walked once for a text, ranked again
  // when the textures or the sounds come
  function results(q) {
    if (found?.text !== input.value) {
      found = { text: input.value, objects: q.scope === 'object' || (q.scope === 'all' && !q.empty) ? api.objects(q.text) : [] };
    }
    found.groups ||= rankPalette(q, { ...fixed, ...assets, object: found.objects });
    return found.groups;
  }
  // the results of what is typed, under their headings, with the tokens offered at the caret; keep: the row chosen
  // stays chosen (new results came, or the caret moved), else the best result is
  function search(keep = false) {
    clearTimeout(timer);
    timer = 0;
    const q = readQuery(input.value), kept = keep && rows[at] ? rowKey(rows[at]) : null;
    const offer = paletteSuggestions(input.value, input.selectionStart ?? input.value.length, api.tokenValues);
    const sections = [];
    if (offer) sections.push({ title: 'Search tokens', rows: offer.items.map((token) => ({ token, offer, label: token.label, detail: token.hint })) });
    if (q.scope === 'all' && q.empty) sections.push({ title: 'Recent searches', rows: recent().map((text) => ({ recent: text, label: text, detail: '' })) });
    for (const g of results(q)) {
      const more = !g.more ? '' : g.prefix && q.scope === 'all' ? `${g.more} more · start with ${g.prefix} for all of them` : `${g.more} more · type more of the name`;
      sections.push({ title: g.title, more, rows: g.items.map((item) => ({ item, group: g.id, label: item.label, detail: item.detail || '', disabled: !!item.disabled })) });
    }
    rows = [];
    heads = new Map();
    for (const s of sections.filter((x) => x.rows.length)) {
      heads.set(rows.length, `<div class="cp-head" role="presentation">${esc(s.title)}${s.more ? `<small>${esc(s.more)}</small>` : ''}</div>`);
      rows = rows.concat(s.rows);
    }
    const again = kept ? rows.findIndex((r) => rowKey(r) === kept) : -1;
    at = again >= 0 ? again : rows.findIndex((r) => r.item && !r.disabled);
    drawn = 0;
    list.innerHTML = rows.length ? ''
      : `<div class="cp-empty">${q.scope === 'all' && q.empty ? 'Type the name of a command, an object of this map, a class to place, a texture or a sound.'
        : 'Nothing matches. Start with &gt; for the commands only, with @ for the objects of this map only.'}</div>`;
    draw(0);
    mark();
  }
  // the rows drawn up to row i, a page at least, after those drawn already (with the headings of their sections)
  function draw(i) {
    const end = Math.min(rows.length, Math.max(i + 1, drawn + PAGE));
    let html = '';
    for (let k = drawn; k < end; k++) html += (heads.get(k) || '') + rowHtml(rows[k], k);
    if (html) list.insertAdjacentHTML('beforeend', html);
    drawn = Math.max(drawn, end);
  }
  function rowHtml(r, i) {
    const key = r.item?.key ? `<kbd>${esc(r.item.key)}</kbd>` : '';
    const tip = r.disabled ? ' aria-disabled="true" title="Not available now (greyed in its menu too)"' : r.token ? ` title="${esc(r.token.hint || r.token.text)}"` : '';
    return `<div class="cp-row${r.disabled ? ' off' : ''}${r.item?.checked ? ' checked' : ''}" role="option" id="cp-o${i}" data-i="${i}" aria-selected="false"${tip}>`
      + `${r.item?.icon ? r.item.icon() : ''}<span class="cp-label">${esc(r.label)}</span><span class="cp-detail">${esc(r.detail)}</span>${key}</div>`;
  }
  // the chosen row lit and in sight (drawn first, when the list has not come so far)
  function mark() {
    for (const el of list.querySelectorAll('.cp-row.on')) { el.classList.remove('on'); el.setAttribute('aria-selected', 'false'); }
    if (at >= drawn) draw(at);
    const el = at >= 0 ? list.querySelector(`#cp-o${at}`) : null;
    if (!el) { input.removeAttribute('aria-activedescendant'); return; }
    el.classList.add('on');
    el.setAttribute('aria-selected', 'true');
    el.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', el.id);
  }

  // a row taken: a token or a past search goes in the box; a result runs once the palette is shut (the search kept)
  async function act(i) {
    const r = rows[i];
    if (!r || r.disabled) return;
    if (r.token) {
      const next = r.offer.put(r.token);
      input.value = next.text;
      input.setSelectionRange(next.caret, next.caret);
      search();
      return;
    }
    if (r.recent) { input.value = r.recent; search(); return; }
    remember(input.value);
    close();
    try { await r.item.run(); } catch (e) { api.status(`${r.label}: ${e.message}`, 'bad'); }
  }

  // a window that holds the editor (the menus' list of them), the projects, the game played or the camera flying
  const blocked = () => api.busy() || !!window.__menubar?.modalOpen?.();
  function open() {
    if (isOpen() || blocked()) return false;
    before = document.activeElement;
    window.__menubar?.closeMenus?.();
    fixed = gather();
    input.value = '';
    found = null;                          // the map and the menus may have changed since
    root.hidden = false;
    input.focus();
    search();
    load();
    return true;
  }
  function close() {
    if (!isOpen()) return;
    clearTimeout(timer);
    timer = 0;
    input.blur();                          // hidden, the box would keep the keys until the page is drawn again
    root.hidden = true;
    list.innerHTML = '';
    rows = []; at = -1; fixed = {}; found = null; heads = new Map(); drawn = 0;
    if (before?.isConnected && before !== document.body) before.focus({ preventScroll: true });
    before = null;
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, WAIT); });
  // the caret in another piece of the query: its tokens
  input.addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) search(true); });
  input.addEventListener('click', () => search(true));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();                   // the editor's own keys stay out of the box
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      at = stepRow(rows.map((r) => r.disabled), at, e.key === 'ArrowDown' ? 1 : -1);
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (timer) search();                 // what was typed last, not the results before it
      act(at);
    } else if (e.key === 'Tab') {          // a token offered goes in (the chosen one, else the first); the keys stay here
      e.preventDefault();
      act(rows[at]?.token ? at : rows.findIndex((r) => r.token));
    }
  });
  list.addEventListener('pointerdown', (e) => e.preventDefault());      // the box keeps the keys
  // near the end of what is drawn: the next page
  list.addEventListener('scroll', () => {
    if (drawn < rows.length && list.scrollTop + list.clientHeight > list.scrollHeight - list.clientHeight / 2) draw(drawn);
  });
  list.addEventListener('click', (e) => { const el = e.target.closest('[data-i]'); if (el) act(+el.dataset.i); });
  list.addEventListener('pointermove', (e) => {
    const el = e.target.closest('[data-i]'), i = el ? +el.dataset.i : -1;
    if (i >= 0 && i !== at && !rows[i].disabled) { at = i; mark(); }
  });
  root.addEventListener('click', (e) => { if (e.target === root) close(); });   // a click beside it
  // Ctrl+K (Settings > Keyboard shortcuts may move it: the menus turn the key chosen into this one)
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyK' || !e.ctrlKey || e.altKey || e.shiftKey || typing(e.target)) return;
    if (isOpen() || open()) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('deusedix:map-state', close);
  window.addEventListener('deusedix:play-state', close);
  return { open, close, isOpen };
}
