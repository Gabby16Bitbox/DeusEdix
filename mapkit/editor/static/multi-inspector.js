// The Inspector's fields for several objects selected together (app.js showDetails), as Unity's multi-object
// editing: a row for each field they share, with its value when they all have the same and a dim "—" when they
// differ (multi-edit.js). What is picked or typed is set on each of them, one Ctrl+Z; a number takes a sum, on
// each one's own value with +=, -=, *=, /=, spread with L(a,b) or at random with R(a,b) (app.js's number fields
// work it out with number-expr.js evaluateAll), and right click > Set all to <object>'s value. app.js says what
// the fields are and how each is written.
import { MIXED, shared } from './multi-edit.js';
import { numberField } from './number-expr.js';

// A row: {id, label, aria (its name to a screen reader and the status bar, else its label), title, row: 'bool' | 'int' | 'number' | 'text' | 'choice' | 'color', names, values (as shown,
// in the objects' order), apply(values) (one for each object), of (how many are selected: "3 of 5" when fewer have
// it), step, min, max, placeholder, list (a datalist), options (choice: its values) or optionsHtml(value), prop (its
// property: the label's right click copies, pastes and resets it, app.js)}.
// E: escapeHtml, multiField(element, {names, values, apply}) (what app.js's number fields and right click use)
export function multiRows(E, rows) {
  const esc = E.escapeHtml;
  const one = (r) => {
    const same = shared(r.values), v = same.mixed ? '' : same.value, mixed = same.mixed ? ' data-mixed="1"' : '';
    const title = esc(r.title || r.label) + (same.mixed ? ' · the objects differ (—): what is set here is set on all of them' : '');
    const some = r.of && r.names.length < r.of ? `<span class="hint" style="margin:0" title="Only these have it">${r.names.length} of ${r.of}</span>` : '';
    const prop = r.prop ? ` data-prop="${esc(r.prop)}"` : '';
    const label = `<label for="${r.id}" style="width:auto;min-width:96px" title="${title}"${prop}>${esc(r.label)}</label>`;
    const limits = ['step', 'min', 'max'].filter((k) => r[k] != null).map((k) => ` ${k}="${r[k]}"`).join('');
    if (r.row === 'bool') return `<div class="row"><label style="width:auto" title="${title}"${prop}><input type="checkbox" id="${r.id}"${v === true ? ' checked' : ''}${mixed}> ${esc(r.label)}</label>${some}</div>`;
    if (r.row === 'int' || r.row === 'number')
      return `<div class="row">${label}<input ${numberField(r.row === 'int')} id="${r.id}" aria-label="${esc(r.aria || r.label)}" value="${esc(v)}" placeholder="${same.mixed ? MIXED : ''}"${limits}${mixed} style="width:80px">${some}</div>`;
    if (r.row === 'text')
      return `<div class="row">${label}<input type="text" id="${r.id}" value="${esc(v)}" placeholder="${same.mixed ? MIXED : esc(r.placeholder || '')}"${r.list ? ` list="${r.list}"` : ''}${mixed} spellcheck="false" style="flex:1;min-width:0">${some}</div>`;
    if (r.row === 'color')        // a colour picker always shows one: the first object's, dimmed when they differ
      return `<div class="row">${label}<input type="color" id="${r.id}" value="${esc(same.mixed ? r.values[0] : v)}"${mixed} title="${title}" style="width:46px;height:28px;padding:1px${same.mixed ? ';opacity:.5' : ''}">${some}</div>`;
    // a choice: its options (with the values the objects have that are not among them), "—" first when they differ
    const options = r.optionsHtml ? r.optionsHtml(same.mixed ? null : v)
      : [...new Set([...r.values.map(String).filter((x) => !r.options.includes(x)), ...r.options])]
        .map((o) => `<option ${!same.mixed && o === String(v) ? 'selected' : ''}>${esc(o)}</option>`).join('');
    return `<div class="row">${label}<select id="${r.id}" style="flex:1;min-width:0"${mixed}>${same.mixed ? `<option value="" disabled selected>${MIXED}</option>` : ''}${options}</select>${some}</div>`;
  };
  const html = rows.map(one).join('');
  const wire = (root) => {
    for (const r of rows) {
      const el = root.querySelector('#' + r.id);
      if (!el) continue;
      E.multiField(el, { names: r.names, values: r.values, apply: r.apply });
      // a number: app.js's number fields work out the sum and apply it; emptied, it shows its value again
      if (r.row === 'int' || r.row === 'number') { el.onchange = () => { if (!el.value.trim()) el.value = el.defaultValue; }; continue; }
      if (r.row === 'bool') el.indeterminate = el.hasAttribute('data-mixed');
      el.onchange = () => r.apply(r.names.map(() => (r.row === 'bool' ? el.checked : el.value)));
    }
  };
  return { html, wire };
}

// Narrow the selection (Unity's): a button for each kind of thing selected, with how many; a click keeps only those.
// kinds: [{kind, count, label}] (multi-edit.js kindCounts); keep(kind)
export function narrowRows(E, kinds, keep) {
  const esc = E.escapeHtml;
  const html = kinds.length < 2 ? '' : `<div class="row" style="flex-wrap:wrap;gap:4px" role="group" aria-label="Narrow the selection">${kinds.map((k, i) =>
    `<button type="button" data-narrow="${i}" title="Keep only the ${k.count} ${esc(k.label)} in the selection">${esc(k.label)} <small>${k.count}</small></button>`).join('')}</div>`;
  const wire = (root) => { for (const b of root.querySelectorAll('[data-narrow]')) b.onclick = () => keep(kinds[+b.dataset.narrow].kind); };
  return { html, wire };
}
