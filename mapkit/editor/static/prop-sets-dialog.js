// The windows of copy and paste of properties and of presets (prop-sets.js): the list of what a paste, a preset or
// a reset changes, ticked to choose (what stays an object's own is not ticked at first), a preset's name, and the
// presets of a class. app.js says what the properties are called and how their values show.
import { MIXED, shared } from './multi-edit.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CSS = `.prop-sets-dialog { width:min(620px, calc(100vw - 32px)); }
  .prop-sets-dialog .ps-list { display:flex; flex-direction:column; gap:2px; max-height:min(52vh, 460px); overflow:auto; margin:8px 0 0; }
  .prop-sets-dialog .ps-row { display:grid; grid-template-columns:auto minmax(90px, 1.2fr) minmax(0, 1fr) auto minmax(0, 1fr) auto; align-items:center; gap:6px; padding:3px 6px; border-radius:var(--radius-row, 4px); font-size:12px; }
  .prop-sets-dialog .ps-row:hover { background:var(--field); }
  .prop-sets-dialog .ps-row > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .prop-sets-dialog .ps-row.own .ps-name, .prop-sets-dialog .ps-from, .prop-sets-dialog small { color:var(--dim); }
  .prop-sets-dialog .ps-preset { display:flex; align-items:center; gap:6px; padding:4px 6px; }
  .prop-sets-dialog .ps-preset b { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }`;
let styled = false;                       // the windows' style, put in the page the first time one opens

// The list of changes (prop-sets.js changeRows): a row for each property, ticked (what stays an object's own: not),
// with what the objects show now and get ("—" when theirs differ) and how many it changes when more than one.
// label(key): what the property is called; shown(key, value): a value as a field shows it
export function changesHtml(rows, label, shown) {
  if (!rows.length) return '<p class="hint" role="status">Nothing changes: they already have these values.</p>';
  const text = (key, values) => (shared(values.map(String)).mixed ? MIXED : shown(key, values[0]));
  return `<div class="ps-list" role="group" aria-label="What changes">${rows.map((r, i) => {
    const from = text(r.key, r.from), to = text(r.key, r.to);
    return `<label class="ps-row${r.own ? ' own' : ''}" title="${esc(`${r.key}: ${from} → ${to}${r.own ? ' · stays each object\'s own unless ticked' : ''}`)}"><input type="checkbox" data-ps="${i}"${r.own ? '' : ' checked'}>`
      + `<span class="ps-name">${esc(label(r.key))}</span><span class="ps-from">${esc(from)}</span><span aria-hidden="true">→</span><span class="ps-to">${esc(to)}</span>`
      + `<small>${r.names.length > 1 ? `${r.names.length} objects` : ''}</small></label>`;
  }).join('')}</div>`;
}

// A window of the editor's (as Save as prefab's): a title, what is in it, Cancel and the action (none: Close); resolves
// with what done(dialog) gives when the action is pressed (an error thrown shows in it), with what wire's finish is
// given, or null
function ask({ title, body, action, done, wire = () => {} }) {
  if (!styled) { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); styled = true; }
  const dialog = document.createElement('dialog');
  dialog.className = 'map-dialog prop-sets-dialog';
  dialog.setAttribute('aria-label', title);
  dialog.innerHTML = `<header><h2>${esc(title)}</h2></header><form><main>${body}<p class="map-error" role="alert" data-ps-error></p></main>
    <footer><button type="button" data-ps-cancel>${action ? 'Cancel' : 'Close'}</button>${action ? `<button type="submit" class="primary" data-ps-ok>${esc(action)}</button>` : ''}</footer></form>`;
  return new Promise((resolve) => {
    const finish = (result) => { dialog.close(); dialog.remove(); resolve(result); };
    dialog.querySelector('[data-ps-cancel]').onclick = () => finish(null);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dialog.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      try { finish(done(dialog)); } catch (err) { dialog.querySelector('[data-ps-error]').textContent = err.message; }
    };
    wire(dialog, finish);
    document.body.appendChild(dialog);
    dialog.showModal();
    (dialog.querySelector('input:not([type=checkbox])') || dialog.querySelector('[data-ps-ok]') || dialog.querySelector('[data-ps-cancel]')).focus();
  });
}

// What to paste, apply or reset: the keys of the ticked rows (a Set), or null
export function askChanges({ title, intro, rows, label, shown, action }) {
  return ask({ title, action: rows.length ? action : '', body: `<p class="hint" style="margin:0">${esc(intro)}</p>${changesHtml(rows, label, shown)}`,
    done: (d) => new Set([...d.querySelectorAll('[data-ps]:checked')].map((b) => rows[+b.dataset.ps].key)),
    wire: (d) => {
      const ok = d.querySelector('[data-ps-ok]'), tick = () => { if (ok) ok.disabled = !d.querySelector('[data-ps]:checked'); };
      for (const b of d.querySelectorAll('[data-ps]')) b.onchange = tick;
      tick();
    } });
}

// A preset's name: check(name) gives it back as it is kept, or throws why not
export function askName({ title, hint, value = '', action, check }) {
  return ask({ title, action, body: `<label for="ps-name">Preset name</label><input id="ps-name" maxlength="60" autocomplete="off" required value="${esc(value)}" style="width:100%">
    <p class="hint">${esc(hint)}</p>`, done: (d) => check(d.querySelector('#ps-name').value) });
}

// The presets of a class: each with what it sets (describe(preset)), Apply (resolves with that preset) and Delete
// (remove(preset): true when it is deleted, then the list without it)
export function askPresets({ title, presets, describe, remove }) {
  const list = presets.slice();
  const body = () => (list.length ? list.map((p, i) => `<div class="ps-preset"><b title="${esc(p.name)}">${esc(p.name)}</b><small>${esc(describe(p))}</small>`
    + `<button type="button" data-ps-apply="${i}" title="See what it changes on the selection, then apply it">Apply…</button><button type="button" data-ps-del="${i}" title="Delete this preset of the project">Delete</button></div>`).join('')
    : '<p class="hint" role="status">No presets left for this class.</p>');
  return ask({ title, action: '', body: '<div class="ps-list" data-ps-presets></div>', done: () => null,
    wire: (d, finish) => {
      const box = d.querySelector('[data-ps-presets]');
      const draw = () => {
        box.innerHTML = body();
        for (const b of box.querySelectorAll('[data-ps-apply]')) b.onclick = () => finish(list[+b.dataset.psApply]);
        for (const b of box.querySelectorAll('[data-ps-del]')) b.onclick = () => { if (remove(list[+b.dataset.psDel])) { list.splice(+b.dataset.psDel, 1); draw(); } };
      };
      draw();
    } });
}
