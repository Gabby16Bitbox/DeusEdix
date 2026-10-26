// The Inspector's All properties (the last section of an object): every property UnrealEd's Properties window shows
// for its class (editor/props.py class_props, read from the game once per class), by group, with a filter. A value
// is UnrealEd's text (True, 0.5, (X=1,Y=2,Z=3), Texture'Pkg.Name'...); an empty field goes back to the map's value
// or the class default. Set here: edits.rawprops[object][property], applied after the Properties panel's own.
// Several objects of one class at once (the multi-object Inspector): a field shows a dim "—" where they differ
// (multi-edit.js) and sets each of them; a number takes a sum on each one's own value, L and R over them
// (app.js's number fields, through E.multiField), and right click > Set all to one's value.
import { numberField, plainNumber, fieldText } from './number-expr.js';
import { MIXED, shared } from './multi-edit.js';
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./all-props.css', import.meta.url).href;
document.head.appendChild(css);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cache = new Map();                    // class -> Promise of its properties
// the numbers of UnrealEd's types take maths (number-expr.js), whole for Int and Byte; the other fields stay its text
const NUMBERS = { IntProperty: true, ByteProperty: true, FloatProperty: false };

// The properties of a class as UnrealEd shows them (editor/props.py class_props), read once: these fields, and a
// paste of what was set here on the classes it goes on (app.js)
export function classProps(E, cls) {
  const name = String(cls || '').split('.').pop();
  if (!cache.has(name)) cache.set(name, E.api('/api/class_props?cls=' + encodeURIComponent(name)).catch((e) => { cache.delete(name); throw e; }));
  return cache.get(name);
}

// E: edits, actorProp, pushUndo, setDirty, status, requireUnlocked, section(key, title, body, open), api(path),
// multiField(field, {names, values, apply}), rawField(field, {key, type, def, category, options (an enum's), apply})
// (its right click: Copy value, Paste value, Reset); actors: the object, or several of one class; p: what is selected
export function allPropsSection(E, actors, p) {
  const a = actors[0], cls = String(a.cls || '').split('.').pop(), many = actors.length > 1, names = actors.map((x) => x.name);
  const html = E.section('allprops', 'All properties', `
    <div class="row"><input id="apfilter" placeholder="Filter properties" spellcheck="false" style="flex:1;min-width:0"></div>
    <div id="aplist" class="ap-list"><div class="hint">Every property of ${esc(cls)}, as UnrealEd shows them${many ? `, for the ${actors.length} at once` : ''}.</div></div>`, false);
  const wire = () => {
    const list = document.getElementById('aplist');
    if (!list) return;
    const box = list.closest('details');
    const load = async () => {
      if (list.dataset.loaded) return;
      list.dataset.loaded = '1';
      list.innerHTML = '<div class="hint">Reading the class (the first time a few seconds)...</div>';
      try { render(await classProps(E, cls)); } catch (e) { list.innerHTML = `<div class="hint bad">${esc(e.message)}</div>`; delete list.dataset.loaded; }
    };
    let shown = null;                     // the class's properties, to draw the fields again
    const render = (d) => {
      shown = d;
      const owns = actors.map((x) => (E.edits.rawprops || {})[x.name] || {});
      const fields = new Map();            // property -> {q, each: each object's text (as set here, else the map's)}
      const groups = new Map();
      for (const q of d.props) {
        const key = q.index >= 0 ? `${q.name}(${q.index})` : q.name;
        (groups.get(q.group) || groups.set(q.group, []).get(q.group)).push({ ...q, key });
      }
      let h = '';
      for (const [g, rows] of groups) {
        h += `<div class="ap-group" data-group="${esc(g.toLowerCase())}">${esc(g === 'None' ? a.cls : g)}</div>`;
        for (const q of rows) {
          const each = actors.map((x, i) => (q.key in owns[i] ? owns[i][q.key] : (E.actorProp(x, q.key) ?? '')));
          const set = owns.some((o) => q.key in o), same = shared(each), value = same.mixed ? '' : same.value;
          fields.set(q.key, { q, each });
          const title = `${q.key} · ${q.type.replace(/Property$/, '')} · class default: ${q.default || '(empty)'}`;
          let field;
          if (q.type === 'BoolProperty' || d.enums[q.name]) {
            const opts = q.type === 'BoolProperty' ? ['True', 'False'] : d.enums[q.name];
            const cur = String(value || '');
            field = `<select data-ap="${esc(q.key)}">${same.mixed ? `<option value="" disabled selected>${MIXED} (they differ)</option>` : ''}<option value="">${esc(q.default || '—')} (default)</option>${opts.map((o) => `<option ${o.toLowerCase() === cur.toLowerCase() ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
          } else field = `<input ${q.type in NUMBERS ? numberField(NUMBERS[q.type]) : 'spellcheck="false"'} data-ap="${esc(q.key)}" value="${esc(value)}" placeholder="${esc(same.mixed ? MIXED : q.default)}">`;
          h += `<label class="row ap-row${set ? ' ap-set' : ''}" data-name="${esc(q.key.toLowerCase())}" title="${esc(title)}"><span class="ap-name">${esc(q.key)}</span>${field}</label>`;
        }
      }
      list.innerHTML = h;
      for (const f of list.querySelectorAll('[data-ap]')) {
        const key = f.dataset.ap, { q, each } = fields.get(key);
        // several objects: their values for the sums (a number: its own, else the class default) and Set all to
        if (many) E.multiField(f, q.type in NUMBERS
          ? { names, values: each.map((v) => plainNumber(v === '' ? q.default : v)), apply: (ns) => write(key, ns.map((n) => fieldText(n, NUMBERS[q.type]))) }
          : { names, values: each, apply: (texts) => write(key, texts) });
        f.onchange = () => write(key, actors.map(() => f.value), f);
        // its right click (app.js): a value given shows in the field (several objects: the fields are drawn again)
        E.rawField(f, { key, type: q.type, def: q.default, category: q.group, options: d.enums[q.name], apply: (texts) => { if (!many) f.value = texts[0]; return write(key, texts, f); } });
      }
      filter();
    };
    // a property's text for each object (empty: as the map has it), one Ctrl+Z; several objects: the fields again
    const write = (key, texts, f) => {
      if (!E.requireUnlocked(p)) return false;
      const vs = texts.map((t) => String(t ?? '').trim());
      E.pushUndo();
      const all = E.edits.rawprops || (E.edits.rawprops = {});
      actors.forEach((x, i) => {
        const mine = all[x.name] || (all[x.name] = {});
        if (vs[i]) mine[key] = vs[i]; else delete mine[key];
        if (!Object.keys(mine).length) delete all[x.name];
      });
      if (!Object.keys(all).length) delete E.edits.rawprops;
      if (many) render(shown); else f.closest('.ap-row').classList.toggle('ap-set', !!vs[0]);
      E.setDirty();
      const what = vs.every((v) => !v) ? 'as the map has it' : '= ' + (new Set(vs).size === 1 ? vs[0] : 'a value each');
      E.status(`${many ? actors.length + ' objects' : a.name}: ${key} ${what}. Rebuild puts it in the game.`, 'ok');
      return true;
    };
    const filter = () => {
      const t = (document.getElementById('apfilter')?.value || '').trim().toLowerCase();
      for (const r of list.querySelectorAll('.ap-row')) r.hidden = !!t && !r.dataset.name.includes(t);
      for (const g of list.querySelectorAll('.ap-group')) {
        let n = g.nextElementSibling, any = false;
        while (n && !n.classList.contains('ap-group')) { if (!n.hidden) any = true; n = n.nextElementSibling; }
        g.hidden = !any;
      }
    };
    document.getElementById('apfilter').oninput = () => { load(); filter(); };
    if (box) { box.addEventListener('toggle', () => { if (box.open) load(); }); if (box.open) load(); }
  };
  return { html, wire };
}
