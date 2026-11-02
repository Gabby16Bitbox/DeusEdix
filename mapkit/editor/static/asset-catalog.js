const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function catalogMatches(item, query, extras = []) {
  const source = typeof item.source === 'string' ? item.source : item.source?.map || item.source?.label || '';
  const text = [item.label, item.cat, item.original_label, item.original_cat,
    ...(item.keywords || []), ...(item.materials || []), ...(item.tex || []), ...extras].join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return String(query || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).every(word => {
    if (word.startsWith('map:')) return [item.map, ...(item.maps || []), source].join(' ').toLowerCase().includes(word.slice(4));
    if (word.startsWith('id:')) return String(item.id).toLowerCase().includes(word.slice(3));
    if (word.startsWith('material:')) return (item.materials || []).join(' ').toLowerCase().includes(word.slice(9));
    if (/^\d\d_/.test(word) || word.includes('~')) return [item.id, item.map, source].join(' ').toLowerCase().includes(word);
    return text.includes(word);
  });
}

export function editCatalogDetails({ item, api, categories = [], onSaved = () => {} }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'catalog-dialog'; dialog.setAttribute('aria-label', 'Catalog details');
  const style = document.createElement('style');
  style.textContent = `.catalog-dialog{width:min(420px,calc(100vw - 32px));box-sizing:border-box;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:var(--radius-window);padding:12px;font:12px/1.35 "Segoe UI",sans-serif;box-shadow:0 14px 30px #0009}
    .catalog-dialog h3{font-size:13px;margin:0 0 12px;color:var(--heading)}.catalog-dialog label{display:grid;gap:4px;margin:0 0 8px}.catalog-dialog input{width:100%;box-sizing:border-box;height:22px;padding:0 6px;min-width:0}.catalog-dialog footer{display:flex;gap:6px;justify-content:flex-end;margin-top:12px}.catalog-dialog button{height:22px;min-height:22px;padding:0 8px;line-height:18px}.catalog-dialog .catalog-original{color:var(--dim);font-size:11px;overflow-wrap:anywhere;margin-bottom:12px}.catalog-dialog [role=alert]{color:var(--bad);font-size:11px}`;
  dialog.append(style);
  const form = document.createElement('form');
  form.innerHTML = `<h3>Catalog details</h3><div class="catalog-original" title="Original name and asset ID stay unchanged">${esc(item.original_label || item.label)} · ${esc(item.id)}</div>
    <label>Name<input name="label" maxlength="80" required value="${esc(item.label)}"></label>
    <label>Category<input name="category" list="catalog-categories" maxlength="80" required value="${esc(item.cat)}"></label>
    <datalist id="catalog-categories">${[...new Set(categories)].map(c=>`<option value="${esc(c)}">`).join('')}</datalist>
    <label>Search keywords<input name="keywords" value="${esc((item.keywords || []).join(', '))}" title="Separate keywords with commas. These are library keywords, independent from scripting tags."></label>
    <div role="alert"></div><footer><button type="button" data-reset title="Restore the suggested catalog details">Reset</button><span style="flex:1"></span><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">Save</button></footer>`;
  dialog.append(form); document.body.append(dialog); dialog.showModal(); form.elements.label.focus();
  let busy = false;
  const close = () => { if (!busy) { dialog.close(); dialog.remove(); } };
  form.querySelector('[data-cancel]').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  const submit = async reset => {
    if (busy || (!reset && !form.reportValidity())) return;
    busy = true; for (const b of form.querySelectorAll('button')) b.disabled = true;
    try {
      const result = await api('/api/catalog_metadata', {kind:item.catalog_kind || 'piece',id:item.id,reset,
        label:form.elements.label.value.trim(),category:form.elements.category.value.trim(),
        keywords:form.elements.keywords.value.split(',').map(v=>v.trim()).filter(Boolean)});
      busy = false; close(); await onSaved(result.item);
    } catch(error) { form.querySelector('[role=alert]').textContent = error.message || String(error); }
    finally { busy = false; for (const b of form.querySelectorAll('button')) b.disabled = false; }
  };
  form.onsubmit = event => { event.preventDefault(); void submit(false); };
  form.querySelector('[data-reset]').onclick = () => { void submit(true); };
  return dialog;
}
