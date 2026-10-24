// The Inspector's All properties (the last section of an object): every property UnrealEd's Properties window shows
// for its class (editor/props.py class_props, read from the game once per class), by group, with a filter. A value
// is UnrealEd's text (True, 0.5, (X=1,Y=2,Z=3), Texture'Pkg.Name'...); an empty field goes back to the map's value
// or the class default. Set here: edits.rawprops[object][property], applied after the Properties panel's own.
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./all-props.css', import.meta.url).href;
document.head.appendChild(css);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cache = new Map();                    // class -> Promise of its properties

// E: edits, actorProp, pushUndo, setDirty, status, requireUnlocked, section(key, title, body, open), api(path)
export function allPropsSection(E, a, p) {
  const cls = String(a.cls || '').split('.').pop();
  const html = E.section('allprops', 'All properties', `
    <div class="row"><input id="apfilter" placeholder="Filter properties" spellcheck="false" style="flex:1;min-width:0"></div>
    <div id="aplist" class="ap-list"><div class="hint">Every property of ${esc(cls)}, as UnrealEd shows them.</div></div>`, false);
  const wire = () => {
    const list = document.getElementById('aplist');
    if (!list) return;
    const box = list.closest('details');
    const load = async () => {
      if (list.dataset.loaded) return;
      list.dataset.loaded = '1';
      list.innerHTML = '<div class="hint">Reading the class (the first time a few seconds)...</div>';
      if (!cache.has(cls)) cache.set(cls, E.api('/api/class_props?cls=' + encodeURIComponent(cls)).catch((e) => { cache.delete(cls); throw e; }));
      try { render(await cache.get(cls)); } catch (e) { list.innerHTML = `<div class="hint bad">${esc(e.message)}</div>`; delete list.dataset.loaded; }
    };
    const render = (d) => {
      const own = (E.edits.rawprops || {})[a.name] || {};
      const groups = new Map();
      for (const q of d.props) {
        const key = q.index >= 0 ? `${q.name}(${q.index})` : q.name;
        (groups.get(q.group) || groups.set(q.group, []).get(q.group)).push({ ...q, key });
      }
      let h = '';
      for (const [g, rows] of groups) {
        h += `<div class="ap-group" data-group="${esc(g.toLowerCase())}">${esc(g === 'None' ? a.cls : g)}</div>`;
        for (const q of rows) {
          const set = q.key in own, value = set ? own[q.key] : (E.actorProp(a, q.key) ?? '');
          const title = `${q.key} · ${q.type.replace(/Property$/, '')} · class default: ${q.default || '(empty)'}`;
          let field;
          if (q.type === 'BoolProperty' || d.enums[q.name]) {
            const opts = q.type === 'BoolProperty' ? ['True', 'False'] : d.enums[q.name];
            const cur = String(value || '');
            field = `<select data-ap="${esc(q.key)}"><option value="">${esc(q.default || '—')} (default)</option>${opts.map((o) => `<option ${o.toLowerCase() === cur.toLowerCase() ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
          } else field = `<input data-ap="${esc(q.key)}" value="${esc(value)}" placeholder="${esc(q.default)}" spellcheck="false">`;
          h += `<label class="row ap-row${set ? ' ap-set' : ''}" data-name="${esc(q.key.toLowerCase())}" title="${esc(title)}"><span class="ap-name">${esc(q.key)}</span>${field}</label>`;
        }
      }
      list.innerHTML = h;
      for (const f of list.querySelectorAll('[data-ap]')) f.onchange = () => {
        if (!E.requireUnlocked(p)) return;
        const key = f.dataset.ap, v = f.value.trim();
        E.pushUndo();
        const all = E.edits.rawprops || (E.edits.rawprops = {}), mine = all[a.name] || (all[a.name] = {});
        if (v) mine[key] = v; else delete mine[key];
        if (!Object.keys(mine).length) delete all[a.name];
        if (!Object.keys(all).length) delete E.edits.rawprops;
        f.closest('.ap-row').classList.toggle('ap-set', !!v);
        E.setDirty();
        E.status(`${a.name}: ${key} ${v ? '= ' + v : 'as the map has it'}. Rebuild puts it in the game.`, 'ok');
      };
      filter();
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
