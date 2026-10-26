// The window of the object tables (Window > Lights table, Doors table, Characters table; object-table.js), as
// Unity's Light Explorer: a window floating over the 3D view, the editor still usable around it. A
// heading sorts (again: the other way); a cell edits the object's property, and when its row is selected every
// selected row shown that has it (one the filter hides is left as it is; one Ctrl+Z); a click on a row selects it
// (Ctrl: one more or one less, Shift: the rows in between), a double click frames it. The filter keeps the rows
// with all its words; Only the selection keeps what was selected when it was ticked. It follows the editor's
// edits, undo and selection (the deusedix:edits and deusedix:selection events) and the original conversations once
// read (deusedix:original-conversations: a dialogue name they use is read only).
// api: escapeHtml, status(text, cls), rows(table) (a promise of object-table.js's rows), write(names, column,
// values) (false: nothing was written), picked() (the names selected), pick(names), toggle(name), frame(name)
import { TABLES, columnKey, tableOf, listed, cellText, sortRows, filterRows, rangeNames, editTargets, typedValues } from './object-table.js';
import { numberField, plainNumber, stepped } from './number-expr.js';
import { valuesText } from './multi-edit.js';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./object-table.css', import.meta.url).href;
document.head.appendChild(css);

const NUMBER = new Set(['int', 'number']);
const STEP_KEYS = { ArrowUp: 1, ArrowDown: -1 };

export function createObjectTables(api) {
  const esc = api.escapeHtml;
  const root = document.createElement('div');
  root.id = 'objtables';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Object tables');
  root.style.display = 'none';
  root.innerHTML = `<div class="ot-head"><b class="ot-title"></b><span class="ot-tabs" role="tablist">${TABLES.map((t) =>
    `<button type="button" role="tab" data-table="${t.id}" title="Every ${t.title.toLowerCase().replace(/s$/, '')} of the map">${esc(t.title)}</button>`).join('')}</span>
    <span class="ot-sp"></span><button type="button" class="ot-close" title="Close the table" aria-label="Close">×</button></div>
    <div class="ot-bar"><input type="search" class="ot-filter" placeholder="Filter: name, class or value" aria-label="Filter the rows" spellcheck="false">
      <label title="Keep only what is selected now in the table; tick it again to take a new selection"><input type="checkbox" class="ot-only"> Only the selection</label>
      <span class="ot-count"></span></div>
    <div class="ot-scroll"><table class="ot-table"><thead></thead><tbody></tbody></table></div>
    <div class="ot-note"></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const thead = $('thead'), tbody = $('tbody'), filter = $('.ot-filter'), only = $('.ot-only');

  let table = TABLES[0];
  let rows = [], shown = [];                // all the objects of the table; those shown, in their order
  let sort = { key: 'name', dir: 1 };
  let kept = null;                          // Only the selection: the names it keeps
  let anchor = null;                        // the row clicked last (Shift+click: from it)
  let heads = new Map();                    // column key -> its heading, as drawn last
  let loading = false;                      // the rows are being read
  let typing = null;                        // the cell typed in since its last change
  let serial = 0, timer = 0, waiting = false;

  const isOpen = () => root.style.display === 'flex';
  const columnOf = (key) => table.columns.find((c) => columnKey(c) === key);
  const rowOf = (name) => shown.find((r) => r.name === name);
  // a column's heading: its own label, else the Inspector's for that field (the first object that has it)
  const headingOf = (c) => c.label || rows.find((r) => r.cells[columnKey(c)])?.cells[columnKey(c)].label || c.prop;
  const headOf = (c) => heads.get(columnKey(c));

  function cellHtml(row, c) {
    const key = columnKey(c), cell = row.cells[key];
    if (!cell) return '<td class="ot-na"></td>';
    if (key === 'name') return `<td class="ot-name"><button type="button" class="ot-pick" title="Click: select · double click: frame it">${esc(row.label)}<small>${esc(row.name)}</small></button></td>`;
    const at = `data-k="${esc(key)}" aria-label="${esc(`${headOf(c)} of ${row.name}`)}" title="${esc(cell.title || headOf(c))}"`;
    const v = esc(cell.value);
    if (cell.row === 'bool') return `<td class="ot-bool"><input type="checkbox" ${at}${cell.value ? ' checked' : ''}></td>`;
    if (NUMBER.has(cell.row)) {
      const limits = ['step', 'min', 'max'].filter((k) => cell[k] != null).map((k) => ` ${k}="${cell[k]}"`).join('');
      return `<td class="ot-num"><input ${numberField(cell.row === 'int')} ${at} value="${v}"${limits}></td>`;
    }
    if (cell.row === 'text') return `<td><input type="text" ${at} value="${v}" placeholder="${esc(cell.placeholder || '')}"${cell.list ? ` list="${esc(cell.list)}"` : ''} spellcheck="false"></td>`;
    if (cell.row === 'color') return `<td class="ot-colour"><input type="color" ${at} value="${v}"></td>`;
    if (cell.row === 'choice') {             // its options, a value the object has that is not among them first
      const own = cell.options || [], options = [...(own.includes(String(cell.value)) ? [] : [String(cell.value)]), ...own];
      return `<td><select ${at}>${options.map((o) => `<option${o === String(cell.value) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></td>`;
    }
    // read only: what it says, and why when the cell says (a name the original conversations use)
    return `<td class="ot-text" title="${esc(cell.title ? `${cellText(cell)} · ${cell.title}` : cellText(cell))}">${esc(cellText(cell))}</td>`;
  }

  // the rows again, as sorted, filtered and kept; the cell that had the focus has it again
  function draw() {
    const active = document.activeElement, at = tbody.contains(active) && { name: active.closest('tr')?.dataset.n, key: active.dataset.k };
    shown = filterRows(sortRows(kept ? rows.filter((r) => kept.has(r.name)) : rows, sort.key, sort.dir), filter.value);
    heads = new Map(table.columns.map((c) => [columnKey(c), headingOf(c)]));
    $('.ot-title').textContent = table.title;
    for (const b of root.querySelectorAll('[data-table]')) b.setAttribute('aria-selected', String(b.dataset.table === table.id));
    thead.innerHTML = `<tr>${table.columns.map((c) => {
      const key = columnKey(c), on = sort.key === key;
      return `<th aria-sort="${on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${esc(key)}" title="${esc(c.title || `Sort by ${headOf(c)}`)}">${esc(headOf(c))}${on ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    }).join('')}</tr>`;
    tbody.innerHTML = shown.map((r) => `<tr data-n="${esc(r.name)}"${r.cells.enabled?.value === false ? ' class="ot-off"' : ''}>${table.columns.map((c) => cellHtml(r, c)).join('')}</tr>`).join('')
      || `<tr><td class="ot-empty" colspan="${table.columns.length}">${loading ? 'Reading the objects of the map…' : rows.length ? 'No row has what the filter says.' : `No ${table.title.toLowerCase()} in this map.`}</td></tr>`;
    $('.ot-note').textContent = table.note;
    markPicked();
    const tr = at && [...tbody.rows].find((x) => x.dataset.n === at.name);
    const back = tr && (at.key ? [...tr.querySelectorAll('[data-k]')].find((x) => x.dataset.k === at.key) : tr.querySelector('.ot-pick'));
    if (back) back.focus({ preventScroll: true });
  }
  // the rows selected in the editor, and how many there are
  function markPicked() {
    const picked = api.picked();
    for (const tr of tbody.rows) tr.classList.toggle('on', picked.has(tr.dataset.n));
    const on = shown.filter((r) => picked.has(r.name)).length;
    $('.ot-count').textContent = `${shown.length} of ${rows.length}${on ? ` · ${on} selected` : ''}`;
  }
  // the objects again from the editor; while a cell is being typed in, once it is left
  async function refresh() {
    if (!isOpen()) return;
    if (typing && typing === document.activeElement) { waiting = true; return; }
    const mine = ++serial, got = await api.rows(table);
    if (mine !== serial || !isOpen()) return;
    rows = got.filter((r) => listed(table, r));
    loading = false;
    draw();
  }
  function later() { if (isOpen()) { clearTimeout(timer); timer = setTimeout(refresh, 60); } }

  function open(id) {
    table = tableOf(id) || table;
    root.style.display = 'flex';
    if (!table.columns.some((c) => columnKey(c) === sort.key)) sort = { key: 'name', dir: 1 };
    kept = null; only.checked = false; anchor = null;
    rows = []; loading = true; draw();
    refresh();
  }
  function close() { root.style.display = 'none'; rows = shown = []; tbody.innerHTML = ''; }
  function toggle(id) { if (isOpen() && table.id === id) close(); else open(id); }

  // what is typed or picked in a cell: on its row, or on every selected row shown that has it (not one the filter hides)
  function edit(el) {
    const name = el.closest('tr').dataset.n, key = el.dataset.k, c = columnOf(key), row = rowOf(name);
    const kind = row?.cells[key]?.row;
    if (!kind) return;
    const typed = kind === 'bool' ? el.checked : el.value;
    if (NUMBER.has(kind) && !String(typed).trim()) { el.value = el.defaultValue; return; }      // emptied: its value again
    const targets = editTargets(shown, name, key, api.picked()), what = headOf(c);
    const r = typedValues(typed, kind, targets.map((t) => t.cells[key].value));
    if (r.error) { api.status(`${what}: "${typed}": ${r.error}; nothing changes.`, 'bad'); draw(); return; }
    if (api.write(targets.map((t) => t.name), c, r.values) === false) { draw(); return; }
    api.status(`${what}: ${valuesText(r.values)}${targets.length > 1 ? ` on ${targets.length} ${table.title.toLowerCase()}` : ` (${name})`}.`, 'ok');
  }
  // a click on a row: it alone, Ctrl one more or one less, Shift the rows from the one clicked before
  function pick(name, e) {
    if (e.shiftKey && anchor) { api.pick(rangeNames(shown.map((r) => r.name), anchor, name)); return; }
    anchor = name;
    if (e.ctrlKey || e.metaKey) api.toggle(name); else api.pick([name]);
  }

  $('.ot-close').onclick = close;
  for (const b of root.querySelectorAll('[data-table]')) b.onclick = () => open(b.dataset.table);
  filter.oninput = draw;
  only.onchange = () => {
    const picked = api.picked(), mine = rows.filter((r) => picked.has(r.name));
    if (only.checked && !mine.length) { only.checked = false; api.status(`Select some ${table.title.toLowerCase()} first (in the table, the 3D view or the Hierarchy).`, 'warn'); return; }
    kept = only.checked ? new Set(mine.map((r) => r.name)) : null;
    draw();
  };
  thead.onclick = (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    sort = { key: b.dataset.sort, dir: sort.key === b.dataset.sort ? -sort.dir : 1 };
    draw();
  };
  const onControl = (e) => !!e.target.closest('input, select');
  tbody.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-n]'); if (tr && !onControl(e)) pick(tr.dataset.n, e); });
  tbody.addEventListener('dblclick', (e) => { const tr = e.target.closest('tr[data-n]'); if (tr && !onControl(e)) api.frame(tr.dataset.n); });
  // a cell of a row not selected: that row is selected first (its Inspector shows), as a click on it does
  tbody.addEventListener('focusin', (e) => {
    const tr = e.target.closest('tr[data-n]');
    if (tr && onControl(e) && !api.picked().has(tr.dataset.n)) { anchor = tr.dataset.n; api.pick([tr.dataset.n]); }
  });
  tbody.addEventListener('input', (e) => { typing = e.target; });
  tbody.addEventListener('change', (e) => { typing = null; if (e.target.dataset.k) edit(e.target); });
  // Esc puts back the value the cell has; the arrow keys step a number, as the Inspector's fields
  tbody.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!el.dataset.k || !el.matches('input[data-expr], input[type=text]')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); el.value = el.defaultValue; el.blur(); return; }
    const v = plainNumber(el.value);
    if (!STEP_KEYS[e.key] || !el.matches('[data-expr]') || !Number.isFinite(v)) return;
    e.preventDefault();
    el.value = stepped(v, STEP_KEYS[e.key], { step: parseFloat(el.step) || 1, min: el.min, max: el.max });
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  root.addEventListener('focusout', () => { typing = null; if (waiting) { waiting = false; later(); } });
  // dragging the title bar moves the window (inside the page)
  $('.ot-head').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (m) => {
      root.style.left = Math.max(0, Math.min(innerWidth - 80, m.clientX - dx)) + 'px';
      root.style.top = Math.max(0, Math.min(innerHeight - 40, m.clientY - dy)) + 'px';
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    e.preventDefault();
  });
  addEventListener('deusedix:edits', later);
  addEventListener('deusedix:original-conversations', later);
  addEventListener('deusedix:selection', () => { if (isOpen()) markPicked(); });

  return { open, close, toggle, refresh, get shown() { return isOpen() ? table.id : null; } };
}
