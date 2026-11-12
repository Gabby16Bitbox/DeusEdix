// Quick add: the one popup of the node graphs (the Story Graph's, and the Logic window's next) for what to add, opened
// where it was asked: a right click on empty space, Tab, a double click, a wire let go on empty space. A search field
// has the focus: typing filters word by word as the Browser's search does (search-rank.js: other words, typos), the
// arrows move, Enter takes, Esc closes. Unfiltered, the items come in their groups, the ones used last first; the
// highlighted one says what it does at the bottom.
//
// items: [{id, label, group?, hint?, words? (other words it is found by), data? (anything, given back)}]
// groups: the groups' order (others after them); lead: groups shown before the recent ones (what fits where it was
// asked); recent: a key under which the last picked ids are kept (localStorage)
// filterItems is pure (tests/test_graph_quick_add.mjs); openQuickAdd draws it.
import { createSearch, rank } from './search-rank.js';

export const RECENT_MAX = 5;
const RECENT_GROUP = 'Recent';

// -> [{group, items}] in the order shown: the `lead` groups, the recent ones (only when nothing was typed), then each
// group in `groups` order; typed text: one list, best match first (group null)
export function filterItems(items, text = '', { groups = [], recent = [], lead = [] } = {}) {
  const search = createSearch(text);
  if (search) {
    const used = new Map(recent.map((id, i) => [id, i]));
    const found = rank(items, search, (it) => [{ text: it.label, weight: 3 }, { text: (it.words || []).join(' '), weight: 2 },
      { text: it.group || '', weight: 1 }, { text: it.hint || '', weight: 0.5 }], (it) => (used.has(it.id) ? 2 - used.get(it.id) * 0.2 : 0));
    return found.length ? [{ group: null, items: found }] : [];
  }
  const out = [];
  for (const g of lead) {
    const list = items.filter((it) => it.group === g);
    if (list.length) out.push({ group: g, items: list });
  }
  const first = recent.map((id) => items.find((it) => it.id === id && !lead.includes(it.group))).filter(Boolean);
  if (first.length) out.push({ group: RECENT_GROUP, items: first });
  const order = [...groups, ...new Set(items.map((it) => it.group || ''))].filter((g, i, all) => all.indexOf(g) === i && !lead.includes(g));
  for (const g of order) {
    const list = items.filter((it) => (it.group || '') === g);
    if (list.length) out.push({ group: g || null, items: list });
  }
  return out;
}
// the ids of the last picked, newest first, `id` added
export function remember(list, id, max = RECENT_MAX) {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}
// where a box of `size` goes for a point `at` in a room [w, h]: below and right of it, else moved in to fit
export function placeBox(at, size, room, gap = 4) {
  const x = Math.max(gap, Math.min(at[0], room[0] - size[0] - gap));
  const below = at[1] + size[1] + gap <= room[1];
  const y = below ? at[1] : Math.max(gap, Math.min(at[1] - size[1], room[1] - size[1] - gap));
  return [Math.round(x), Math.round(y)];
}

function readRecent(key) {
  if (!key) return [];
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}
function writeRecent(key, list) {
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* no storage: this session only */ }
}

const STYLE = `
.gqa { position:absolute; z-index:20; width:290px; display:flex; flex-direction:column; max-height:min(420px, calc(100% - 8px));
  background:var(--panel, #232833); border:1px solid var(--line, #3a4150); border-radius:8px; box-shadow:0 10px 26px #000a; overflow:hidden; }
.gqa-title { padding:7px 10px 0; font-size:11px; color:var(--dim, #8b93a3); }
.gqa-q { margin:6px 8px; padding:5px 8px; border:1px solid var(--line, #3a4150); border-radius:6px; background:var(--bg, #171a20); color:inherit; font:inherit; }
.gqa-q:focus { outline:none; border-color:var(--accent-border, #5a7fc0); }
.gqa-list { overflow:auto; padding:0 4px 4px; flex:1; min-height:0; }
.gqa-g { padding:6px 8px 2px; font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--dim, #8b93a3); }
.gqa-i { display:flex; align-items:center; gap:8px; width:100%; padding:4px 8px; border:0; border-radius:5px; background:transparent; color:inherit;
  font:inherit; text-align:left; cursor:pointer; }
.gqa-i .gqa-dot { width:8px; height:8px; border-radius:50%; flex:none; background:var(--gqa-c, transparent); }
.gqa-i.on { background:var(--hover, #2d3442); }
.gqa-none { padding:8px 10px; color:var(--dim, #8b93a3); }
.gqa-hint { padding:6px 10px; border-top:1px solid var(--line, #343a46); font-size:11px; color:var(--dim, #8b93a3); min-height:30px; }
`;
let styled = false;
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// host: a positioned element the popup goes in; at: [x, y] in it; onPick(item) after it closes; onClose() when it closes
// without a pick. -> {close(), el}
export function openQuickAdd({ host, at, items, groups = [], lead = [], recent: recentKey = '', title = '', placeholder = 'Search',
  onPick, onClose = () => {} }) {
  if (!styled && typeof document !== 'undefined') {
    const s = document.createElement('style'); s.textContent = STYLE; document.head.appendChild(s); styled = true;
  }
  const el = document.createElement('div');
  el.className = 'gqa';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', title || 'Add');
  el.innerHTML = `${title ? `<div class="gqa-title">${esc(title)}</div>` : ''}<input class="gqa-q" type="text" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">
    <div class="gqa-list" role="listbox"></div><div class="gqa-hint"></div>`;
  host.appendChild(el);
  const q = el.querySelector('.gqa-q'), list = el.querySelector('.gqa-list'), hint = el.querySelector('.gqa-hint');
  let shown = [], on = 0, closed = false;
  const recent = readRecent(recentKey).filter((id) => items.some((it) => it.id === id));

  function render() {
    const parts = filterItems(items, q.value, { groups, recent, lead });
    shown = parts.flatMap((p) => p.items);
    on = Math.max(0, Math.min(on, shown.length - 1));
    let k = 0;
    list.innerHTML = parts.map((p) => (p.group ? `<div class="gqa-g">${esc(p.group)}</div>` : '')
      + p.items.map((it) => `<button type="button" class="gqa-i${k === on ? ' on' : ''}" data-k="${k++}" role="option"${it.colour ? ` style="--gqa-c:${esc(it.colour)}"` : ''}>`
        + `<i class="gqa-dot"></i><span>${esc(it.label)}</span></button>`).join('')).join('')
      || '<div class="gqa-none">Nothing matches.</div>';
    say();
  }
  function say() {
    for (const b of list.querySelectorAll('.gqa-i')) b.classList.toggle('on', +b.dataset.k === on);
    hint.textContent = shown[on]?.hint || '';
    list.querySelector(`.gqa-i[data-k="${on}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }
  function close(picked) {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escAnywhere, true);
    el.remove();
    if (picked) {
      writeRecent(recentKey, remember(readRecent(recentKey), picked.id));
      onPick(picked);
    } else onClose();
  }
  const outside = (e) => { if (!el.contains(e.target)) close(null); };
  document.addEventListener('pointerdown', outside, true);
  // Esc with the keys outside the menu (a click on its title or its scroll bar took them): the menu closes, and only
  // the menu (12 Nov 2026: the maximized layout went back and the menu stayed open over the graph)
  const escAnywhere = (e) => { if (e.key === 'Escape' && !el.contains(e.target)) { e.preventDefault(); e.stopPropagation(); close(null); } };
  document.addEventListener('keydown', escAnywhere, true);
  q.addEventListener('input', () => { on = 0; render(); });
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();                         // the graph's keys and the editor's are not for this
    if (e.key === 'Escape') { e.preventDefault(); close(null); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) { on = (on + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length; say(); }
    } else if (e.key === 'Enter') { e.preventDefault(); if (shown[on]) close(shown[on]); }
  });
  list.addEventListener('pointermove', (e) => { const b = e.target.closest?.('.gqa-i'); if (b && +b.dataset.k !== on) { on = +b.dataset.k; say(); } });
  list.addEventListener('click', (e) => { const b = e.target.closest?.('.gqa-i'); if (b) close(shown[+b.dataset.k]); });
  render();
  const room = [host.clientWidth || 600, host.clientHeight || 400];
  const p = placeBox(at || [20, 20], [el.offsetWidth || 290, el.offsetHeight || 300], room);
  el.style.left = p[0] + 'px';
  el.style.top = p[1] + 'px';
  q.focus();
  return { el, close: () => close(null) };
}
