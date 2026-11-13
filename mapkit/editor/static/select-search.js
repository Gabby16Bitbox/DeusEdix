// Long drop-down lists with a search field (Gabby, 13 Nov 2026: "una search bar quando ci sono liste lunghe"). Every
// <select> of the editor with more than LONG choices opens this list instead of the system one: a search field on top
// has the focus and filters word by word as the Browser's search does (search-rank.js: other words, typos), the
// choices keep their groups and their order until something is typed, the current one is highlighted, the arrows move,
// Enter takes, Esc closes. Typing on a long list that has the keys opens it with what was typed. Picking sets the
// select's value and fires input and change, as a pick from the system list does, so the code that listens to the
// select needs nothing new. Short lists, multiple selects and lists marked data-nosearch keep the system list.
//
// itemsOf and filterOptions are pure (tests/test_select_search.mjs); the rest draws it.
import { createSearch, rank } from './search-rank.js';

export const LONG = 12;

// a select's choices: [{value, label, group, hint, index}] (hidden and disabled ones left out, and a first empty choice
// that only says what to do, "+ Add a step...")
export function itemsOf(select) {
  const out = [];
  [...select.options].forEach((o, index) => {
    if (o.hidden || o.disabled) return;
    const label = (o.label || o.text || '').trim();
    if (index === 0 && o.value === '' && /(\.\.\.|…)$/.test(label)) return;
    const g = o.parentNode && o.parentNode.tagName === 'OPTGROUP' ? o.parentNode.label || '' : '';
    out.push({ value: o.value, label, group: g, hint: o.title || '', index });
  });
  return out;
}
export const isLong = (select) => !!select && !select.multiple && !(select.size > 1) && !select.disabled
  && !('nosearch' in (select.dataset || {})) && itemsOf(select).length > LONG;

// -> [{group, items}] in the order shown: as the list has them when nothing was typed (a group again each time it
// starts again), else one list, best match first
export function filterOptions(items, text = '') {
  const search = createSearch(text);
  if (search) {
    const found = rank(items, search, (it) => [{ text: it.label, weight: 3 }, { text: it.value, weight: 1 },
      { text: it.group, weight: 1 }, { text: it.hint, weight: 0.5 }]);
    return found.length ? [{ group: null, items: found }] : [];
  }
  const out = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.group === (it.group || null)) last.items.push(it);
    else out.push({ group: it.group || null, items: [it] });
  }
  return out;
}

const STYLE = `
.ssel { position:fixed; z-index:100000; display:flex; flex-direction:column; min-width:240px;
  background:var(--panel, #232833); border:1px solid var(--line, #3a4150); border-radius:var(--radius-menu, 8px);
  box-shadow:0 10px 26px #000a; overflow:hidden; color:var(--text, #dde); font-size:13px; }
.ssel-q { margin:6px; padding:5px 8px; border:1px solid var(--line, #3a4150); border-radius:var(--radius-control, 6px);
  background:var(--field, #171a20); color:inherit; font:inherit; }
.ssel-q:focus { outline:none; border-color:var(--accent-border, #5a7fc0); }
.ssel-list { overflow:auto; padding:0 4px 4px; flex:1; min-height:0; }
.ssel-g { padding:6px 8px 2px; font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--dim, #8b93a3); }
.ssel-i { display:block; width:100%; padding:4px 8px; border:0; border-radius:var(--radius-row, 5px); background:transparent;
  color:inherit; font:inherit; text-align:left; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ssel-i.on { background:var(--hover, #2d3442); }
.ssel-i.cur { color:var(--heading, inherit); font-weight:600; }
.ssel-none { padding:8px 10px; color:var(--dim, #8b93a3); }
.ssel-hint { padding:5px 10px; border-top:1px solid var(--line, #343a46); font-size:11px; color:var(--dim, #8b93a3); }
`;
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let open = null, reclick = null;   // reclick: the select whose click just closed its own list (it stays shut)

// the list for `select`, under it (above when there is no room below); typed: what starts the search
export function openSelectSearch(select, typed = '') {
  open?.close();
  if (!document.getElementById('ssel-style')) {
    const s = document.createElement('style'); s.id = 'ssel-style'; s.textContent = STYLE; document.head.appendChild(s);
  }
  const items = itemsOf(select);
  const hints = items.some((it) => it.hint);
  const el = document.createElement('div');
  el.className = 'ssel';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `<input class="ssel-q" type="text" placeholder="Search ${items.length} choices" aria-label="Search the choices" autocomplete="off" spellcheck="false">
    <div class="ssel-list" role="listbox"></div>${hints ? '<div class="ssel-hint"></div>' : ''}`;
  document.body.appendChild(el);
  const q = el.querySelector('.ssel-q'), list = el.querySelector('.ssel-list'), hint = el.querySelector('.ssel-hint');
  let shown = [], on = 0, closed = false;

  function render(first) {
    const parts = filterOptions(items, q.value);
    shown = parts.flatMap((p) => p.items);
    if (first) on = Math.max(0, shown.findIndex((it) => it.index === select.selectedIndex));
    on = Math.max(0, Math.min(on, shown.length - 1));
    let k = 0;
    list.innerHTML = parts.map((p) => (p.group ? `<div class="ssel-g">${esc(p.group)}</div>` : '')
      + p.items.map((it) => `<button type="button" tabindex="-1" class="ssel-i${it.index === select.selectedIndex ? ' cur' : ''}" data-k="${k++}" role="option"`
        + `${it.hint ? ` title="${esc(it.hint)}"` : ''}>${esc(it.label)}</button>`).join('')).join('')
      || '<div class="ssel-none">Nothing matches.</div>';
    say(first ? 'center' : 'nearest');
  }
  function say(block = 'nearest') {
    for (const b of list.querySelectorAll('.ssel-i')) b.classList.toggle('on', +b.dataset.k === on);
    if (hint) hint.textContent = shown[on]?.hint || ' ';
    list.querySelector(`.ssel-i[data-k="${on}"]`)?.scrollIntoView?.({ block });
  }
  function place() {
    const r = select.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth;
    const below = vh - r.bottom - 8, above = r.top - 8;
    const down = below >= 260 || below >= above;
    const h = Math.min(440, Math.max(160, down ? below : above));
    const w = Math.min(vw - 16, Math.max(r.width, 260));
    el.style.width = w + 'px';
    el.style.maxHeight = h + 'px';
    el.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px';
    if (down) { el.style.top = (r.bottom + 2) + 'px'; el.style.bottom = ''; }
    else { el.style.bottom = (vh - r.top + 2) + 'px'; el.style.top = ''; }
  }
  function close(picked) {
    if (closed) return;
    closed = true;
    open = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escAnywhere, true);
    window.removeEventListener('scroll', moved, true);
    window.removeEventListener('resize', moved);
    el.remove();
    select.focus({ preventScroll: true });
    if (picked && picked.index !== select.selectedIndex) {
      select.selectedIndex = picked.index;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  const outside = (e) => { if (!el.contains(e.target)) { if (e.target === select) reclick = select; close(null); } };
  const escAnywhere = (e) => { if (e.key === 'Escape' && !el.contains(e.target)) { e.preventDefault(); e.stopPropagation(); close(null); } };
  // the page or a panel scrolled under the list: it would float away from its select
  const moved = (e) => { if (!(e && e.target && e.target.nodeType === 1 && el.contains(e.target))) close(null); };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', escAnywhere, true);
  window.addEventListener('scroll', moved, true);
  window.addEventListener('resize', moved);
  q.addEventListener('input', () => { on = 0; render(false); });
  // the search field's own input and change stay in the list: the editor's listeners are for the select
  for (const type of ['input', 'change']) el.addEventListener(type, (e) => e.stopPropagation());
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();                         // the graph's keys and the editor's are not for this
    const n = shown.length;
    if (e.key === 'Escape') { e.preventDefault(); close(null); }
    else if (e.key === 'Tab') close(null);
    else if (n && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault(); on = (on + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; say();
    } else if (n && (e.key === 'PageDown' || e.key === 'PageUp')) {
      e.preventDefault(); on = Math.max(0, Math.min(n - 1, on + (e.key === 'PageDown' ? 10 : -10))); say();
    } else if (e.key === 'Enter') { e.preventDefault(); if (shown[on]) close(shown[on]); }
  });
  list.addEventListener('pointermove', (e) => { const b = e.target.closest?.('.ssel-i'); if (b && +b.dataset.k !== on) { on = +b.dataset.k; say(); } });
  list.addEventListener('mousedown', (e) => e.preventDefault());   // the search field keeps the keys
  list.addEventListener('click', (e) => { const b = e.target.closest?.('.ssel-i'); if (b) close(shown[+b.dataset.k]); });
  q.value = typed;
  place();
  render(!typed);
  q.focus();
  q.setSelectionRange(q.value.length, q.value.length);
  open = { el, select, close: () => close(null) };
  return open;
}

if (typeof document !== 'undefined') {
  // a click opens ours in place of the system list (preventDefault on mousedown keeps the system one shut)
  document.addEventListener('mousedown', (e) => {
    const s = e.target;
    if (e.button !== 0 || !(s instanceof HTMLSelectElement) || !isLong(s)) return;
    e.preventDefault();
    if (reclick === s) { reclick = null; return; }
    reclick = null;
    s.focus({ preventScroll: true });
    openSelectSearch(s);
  }, true);
  // the keys of a long list that has the focus: the ones that open a list open ours; a letter opens it searching
  document.addEventListener('keydown', (e) => {
    const s = e.target;
    if (!(s instanceof HTMLSelectElement) || e.ctrlKey || e.metaKey || !isLong(s)) return;
    const opens = e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) || e.key === ' ' || e.key === 'Enter';
    const letter = !e.altKey && e.key.length === 1 && e.key !== ' ';
    if (!opens && !letter) return;
    e.preventDefault();
    e.stopPropagation();
    openSelectSearch(s, letter ? e.key : '');
  }, true);
}
