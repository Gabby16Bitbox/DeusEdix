// Project-local, baked prefabs. Placement and capturing map edits stay with app.js.
export function createPrefabBrowser({
  api, escapeHtml, onPlace, onSave, getDefaultName = () => '',
  canSave = () => true, isTemporary = () => false, status = () => {}, onSaved = () => {},
}) {
  const $ = selector => document.querySelector(selector);
  const esc = value => escapeHtml(String(value ?? ''));
  let items = null, loading = null, generation = 0, rendered = 0, modal = null, saving = false;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '/static/prefab-browser.css';
  if (!$('link[href="/static/prefab-browser.css"]')) document.head.appendChild(link);

  function unavailable() {
    if (isTemporary()) return 'Tutorial maps are temporary. Open a project map to save reusable prefabs.';
    if (!canSave()) return 'Select a structure or a group of structures in an open map first.';
    return '';
  }

  function invalidate() { items = null; loading = null; generation++; }

  function list() {
    if (items) return Promise.resolve(items);
    if (loading) return loading;
    const revision = generation;
    const request = Promise.resolve().then(() => api('/api/prefab_library')).then(result => {
      if (!result || !Array.isArray(result.items)) throw new Error('The prefab library could not be read.');
      const value = result.items.filter(item => item && item.kind === 'prefab' && typeof item.id === 'string');
      if (revision === generation) items = value;
      return value;
    }).finally(() => { if (loading === request) loading = null; });
    loading = request;
    return request;
  }

  const count = n => Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  const sourceName = source => typeof source === 'string' ? source : source?.label || source?.map || source?.script || '';

  async function render() {
    const container = $('#prefabs');
    if (!container) return;
    const ticket = ++rendered, revision = generation;
    const search = $('#pfsearch');
    if (search) search.oninput = () => { void render(); };
    const query = String(search?.value || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    container.setAttribute('aria-busy', 'true');
    container.innerHTML = '<div class="hint" role="status">Loading project prefabs…</div>';
    let entries;
    try { entries = await list(); }
    catch (error) {
      if (ticket !== rendered || revision !== generation) return;
      container.setAttribute('aria-busy', 'false');
      container.innerHTML = `<div class="hint bad" role="alert">${esc(error?.message || error)}</div><button data-pf-retry>Retry</button>`;
      container.querySelector('[data-pf-retry]').onclick = () => { invalidate(); void render(); };
      return;
    }
    if (ticket !== rendered || revision !== generation) return;
    const shown = entries.filter(item => query.every(word => `${item.label || ''} ${sourceName(item.source)}`.toLowerCase().includes(word)));
    const reason = unavailable();
    const intro = `<div class="prefab-toolbar"><button data-pf-save class="primary" ${reason ? 'disabled' : ''} title="${esc(reason || 'Save the selected structure or nested group')}">Save selection as prefab…</button></div>
      <div class="hint sintro">Project library. Each prefab is a baked, independent structure, including nested groups and their objects. Rebuild the source map before saving to capture the latest geometry. Placing or saving does not change your clipboard.</div>`;
    container.innerHTML = intro + (shown.length ? `<div class="prefab-cards">${shown.map((item, index) => {
      const counts = item.counts || {};
      return `<article class="prefab-card"><div class="prefab-copy"><b>${esc(item.label || item.id)}</b>
        <small>Source: ${esc(sourceName(item.source) || 'Project map')}</small>
        <small>${count(counts.structures)} structures · ${count(counts.brushes)} brushes · ${count(counts.actors)} objects</small></div>
        <button data-pf-place="${index}" title="Place an independent copy">Place</button></article>`;
    }).join('')}</div>` : `<div class="hint" role="status">${entries.length ? 'No prefabs match these words.' : 'No prefabs saved yet. Select a built nest or structure → Save selection as prefab. Rebuild after geometry changes.'}</div>`);
    container.setAttribute('aria-busy', 'false');
    container.querySelector('[data-pf-save]').onclick = () => { void save(); };
    for (const button of container.querySelectorAll('[data-pf-place]')) button.onclick = async () => {
      try { await onPlace(shown[Number(button.dataset.pfPlace)]); }
      catch (error) { status('Cannot place prefab: ' + (error?.message || error), 'bad'); }
    };
  }

  function save() {
    const reason = unavailable();
    if (reason) { status(reason, 'warn'); return Promise.resolve(null); }
    if (modal) return modal.promise;
    const dialog = document.createElement('dialog');
    dialog.className = 'map-dialog prefab-dialog';
    dialog.setAttribute('aria-labelledby', 'prefab-dialog-title');
    dialog.innerHTML = `<header><h2 id="prefab-dialog-title">Save selection as prefab</h2></header>
      <form><main><label for="prefab-name">Prefab name</label>
        <input id="prefab-name" name="label" maxlength="80" autocomplete="off" required>
        <p class="hint">Saves a baked copy as one independent structure in this project. Rebuild first if the source geometry has changed. Mission logic and doors cannot be included.</p>
        <p class="map-error" role="alert" data-pf-error></p></main>
        <footer><button type="button" data-pf-cancel>Cancel</button><button type="submit" class="primary" data-pf-submit>Save prefab</button></footer></form>`;
    const input = dialog.querySelector('#prefab-name'), error = dialog.querySelector('[data-pf-error]');
    const submit = dialog.querySelector('[data-pf-submit]'), cancel = dialog.querySelector('[data-pf-cancel]');
    input.value = String(getDefaultName() || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80);
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    modal = { dialog, promise };
    function finish(result) {
      if (modal?.dialog !== dialog) return;
      modal = null; saving = false;
      dialog.close(); dialog.remove();
      resolve(result);
    }
    cancel.onclick = () => { if (!saving) finish(null); };
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!saving) finish(null); });
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      if (saving) return;
      const currentReason = unavailable(), label = input.value.trim();
      if (currentReason) { error.textContent = currentReason; return; }
      if (!label || label.length > 80 || /[\x00-\x1f\x7f]/.test(label)) {
        error.textContent = 'Use a name of 1–80 printable characters.';
        input.focus(); return;
      }
      saving = true; submit.disabled = true; cancel.disabled = true; input.disabled = true;
      submit.textContent = 'Saving…'; error.textContent = '';
      let descriptor;
      try {
        descriptor = await onSave(label);
        if (!descriptor || descriptor.kind !== 'prefab' || typeof descriptor.id !== 'string')
          throw new Error('The server did not return a saved prefab.');
      } catch (failure) {
        error.textContent = failure?.message || String(failure);
        saving = false; submit.disabled = false; cancel.disabled = false; input.disabled = false;
        submit.textContent = 'Save prefab'; return;
      }
      invalidate(); finish(descriptor);
      status(`Saved prefab “${descriptor.label || label}”.`, 'ok');
      try { await onSaved(descriptor); }
      catch (failure) { status('Prefab saved, but the library could not be refreshed: ' + (failure?.message || failure), 'warn'); }
      void render();
    };
    document.body.appendChild(dialog);
    dialog.showModal(); input.focus(); input.select();
    return promise;
  }

  return { render, save, invalidate };
}
