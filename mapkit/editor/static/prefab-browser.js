import { catalogMatches, rankCatalog, editCatalogDetails } from './asset-catalog.js';
// Project-local, baked prefabs. Placement and capturing map edits stay with app.js.
// favourites: the stars of the cards and their group at the top (browser-tiles.js favouriteShelf), or none.
// Linked prefabs (prefab-links.js): a card is a prefab (its line), placed as its newest version; its ⋯ (or a right
// click) renames it, deletes it, gives it the 3D view as its picture, and selects or updates its copies in the open map.
// capture: the 3D view as a JPEG data URL (null with no map open); copiesHere(item): {count, older} of its copies in the
// open map (null with none open); placedHere: the versions the open map places (kept by a Delete); menu(x, y, items):
// the editor's right-click menu; onSelect/onUpdate(item): Select instances, Update instances; onChange: the list was
// read again or changed (the Hierarchy's badges, the Inspector).
// warm(item): get a prefab ready before Place is clicked (its preview and textures), so its ghost shows at once: asked
// when the pointer or the focus reaches its card, and for the cards in view, one at a time while the page is idle.
import { createSearch, rank } from './search-rank.js';

export function createPrefabBrowser({
  api, escapeHtml, onPlace, onSave, getDefaultName = () => '',
  canSave = () => true, isTemporary = () => false, status = () => {}, onSaved = () => {}, favourites = null,
  capture = () => null, copiesHere = () => null, placedHere = () => [], menu = null, onSelect = () => {}, onUpdate = () => {},
  onChange = () => {}, warm = () => null,
}) {
  const $ = selector => document.querySelector(selector);
  const esc = value => escapeHtml(String(value ?? ''));
  let items = null, loading = null, generation = 0, rendered = 0, modal = null, saving = false, favouritesOpen = true, failed = false;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '/static/prefab-browser.css';
  if (!$('link[href="/static/prefab-browser.css"]')) document.head.appendChild(link);

  function unavailable() {
    if (isTemporary()) return 'Tutorial maps are temporary. Open a project map to save reusable prefabs.';
    if (!canSave()) return 'Select a structure or a group of structures in an open map first.';
    return '';
  }

  function invalidate() { items = null; loading = null; generation++; failed = false; onChange(); }

  // Getting prefabs ready before their Place: those asked for once are not asked for again (warm keeps what it made)
  const warmed = new Set(), waiting = [];
  let warming = false, observer = null;
  const idle = callback => (window.requestIdleCallback ? window.requestIdleCallback(callback, { timeout: 1500 }) : setTimeout(callback, 200));
  function warmNow(item) {
    if (!item || warmed.has(item.id)) return;
    warmed.add(item.id);
    Promise.resolve().then(() => warm(item)).then(ready => { if (!ready) warmed.delete(item.id); }, () => warmed.delete(item.id));
  }
  function warmLater(item) {
    if (!item || warmed.has(item.id) || waiting.includes(item)) return;
    waiting.push(item);
    if (warming) return;
    warming = true;
    const next = () => idle(() => {
      const it = waiting.shift();
      if (!it) { warming = false; return; }
      if (warmed.has(it.id)) { next(); return; }
      warmed.add(it.id);
      Promise.resolve().then(() => warm(it)).then(ready => { if (!ready) warmed.delete(it.id); }, () => warmed.delete(it.id)).finally(next);
    });
    next();
  }
  favourites?.subscribe(() => { void render(); });   // a star clicked: drawn again from the list it has

  function list() {
    if (items) return Promise.resolve(items);
    if (loading) return loading;
    const revision = generation;
    const request = Promise.resolve().then(() => api('/api/prefab_library')).then(result => {
      if (!result || !Array.isArray(result.items)) throw new Error('The prefab library could not be read.');
      const value = result.items.filter(item => item && item.kind === 'prefab' && typeof item.id === 'string');
      if (revision === generation) { items = value; onChange(); }
      return value;
    }).finally(() => { if (loading === request) loading = null; });
    loading = request;
    return request;
  }

  // the list as last read, without waiting: null while it is read (asked for then; onChange says when it is there) and
  // after a failure, until the next change
  function cached() {
    if (!items && !loading && !failed) list().catch(() => { failed = true; });
    return items;
  }

  const count = n => Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  const sourceName = source => typeof source === 'string' ? source : source?.label || source?.map || source?.script || '';
  const lineOf = item => item.line || item.id;          // the prefab (its first version's id), whatever its version

  async function render() {
    const container = $('#prefabs');
    if (!container) return;
    const ticket = ++rendered, revision = generation;
    const search = $('#pfsearch');
    if (search) search.oninput = () => { void render(); };
    const query = createSearch(search?.value || '');
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
    // the search (search-rank.js): its name first, then its source map; best match first
    const matches = text => !query || query.score([{ text, weight: 1 }]) > 0;
    const shown = query ? rankCatalog(entries, search?.value || '', item => [{ text: item.label || '', weight: 3 }, { text: [item.original_label, ...(item.keywords || []), ...(item.materials || [])].join(' '), weight: 2 }, { text: sourceName(item.source), weight: 1 }]) : entries;
    // Favourites first (kept per project, by prefab: a new version keeps its star); a prefab deleted from the library
    // shows as missing
    const favs = (favourites?.entries(id => entries.find(item => lineOf(item) === id)) || [])
      .filter(({ fav, item }) => item ? (!query || shown.includes(item)) : matches(fav.label));
    const reason = unavailable();
    const intro = `<div class="prefab-toolbar"><button data-pf-save class="primary" ${reason ? 'disabled' : ''} title="${esc(reason || 'Save the selected structure or nested group')}">Save selection as prefab…</button></div>
      <div class="hint sintro">Project library. Each prefab is a baked structure, including nested groups and their objects. Its copies stay linked to it: Apply to prefab (right click a copy) saves a new version, Update instances brings the others to it. Rebuild the source map before saving to capture the latest geometry. Placing or saving does not change your clipboard.</div>`;
    const card = item => {
      const counts = item.counts || {}, here = copiesHere(item), line = lineOf(item);
      return `<article class="prefab-card" data-pf-card="${esc(line)}">${item.thumb ? `<img class="prefab-thumb" src="${esc(item.thumb)}" alt="" loading="lazy">` : '<span class="prefab-thumb" aria-hidden="true"></span>'}<div class="prefab-copy"><b title="${esc(item.original_label || item.label || item.id)}">${esc(item.label || item.id)}</b>
        <small>${esc(item.cat || 'Project prefabs')} · Version ${count(item.version) || 1} · source: ${esc(sourceName(item.source) || 'Project map')}</small>
        <small>${count(counts.structures)} structures · ${count(counts.brushes)} brushes · ${count(counts.actors)} objects</small>
        ${here?.count ? `<small class="prefab-here${here.older ? ' old' : ''}">In this map: ${here.count} ${here.count === 1 ? 'copy' : 'copies'}${here.older ? `, ${here.older} on an older version` : ''}</small>` : ''}</div>
        ${favourites ? favourites.star(line, item.label || item.id) : ''}<button data-pf-place="${esc(item.id)}" title="Place a copy, linked to this prefab">Place</button>${menu ? `<button class="prefab-more" data-pf-more="${esc(line)}" title="Rename, delete, picture, its copies in this map" aria-label="More for ${esc(item.label || item.id)}">⋯</button>` : ''}</article>`;
    };
    const gone = fav => `<article class="prefab-card fav-missing" title="${esc(favourites.goneTitle(fav))}"><div class="prefab-copy"><b>${esc(fav.label)}</b>
        <small>Missing: no longer in this project's library</small></div>${favourites.star(fav.id, fav.label)}</article>`;
    const favouritesHtml = favs.length ? `<details class="prefab-favourites" ${favouritesOpen ? 'open' : ''}><summary>${esc(favourites.group)} <small>${favs.length}</small></summary>
      <div class="prefab-cards">${favs.map(({ fav, item }) => (item ? card(item) : gone(fav))).join('')}</div></details>` : '';
    container.innerHTML = intro + favouritesHtml + (shown.length ? `<div class="prefab-cards">${shown.map(card).join('')}</div>` : `<div class="hint" role="status">${entries.length ? 'No prefabs match these words.' : 'No prefabs saved yet. Select a built nest or structure → Save selection as prefab. Rebuild after geometry changes.'}</div>`);
    container.setAttribute('aria-busy', 'false');
    container.querySelector('[data-pf-save]').onclick = () => { void save(); };
    const group = container.querySelector('.prefab-favourites');
    if (group) group.addEventListener('toggle', () => { favouritesOpen = group.open; });
    for (const button of container.querySelectorAll('[data-pf-place]')) button.onclick = async () => {
      try { await onPlace(entries.find(item => item.id === button.dataset.pfPlace)); }
      catch (error) { status('Cannot place prefab: ' + (error?.message || error), 'bad'); }
    };
    const itemOf = line => entries.find(item => lineOf(item) === line);
    for (const button of container.querySelectorAll('[data-pf-more]')) button.onclick = event => {
      const r = event.currentTarget.getBoundingClientRect();
      more(itemOf(button.dataset.pfMore), r.left, r.bottom);
    };
    if (menu) for (const article of container.querySelectorAll('[data-pf-card]')) article.addEventListener('contextmenu', event => {
      event.preventDefault();
      more(itemOf(article.dataset.pfCard), event.clientX, event.clientY);
    });
    // ready before Place: at once when the pointer or the focus reaches a card, while idle for the cards in view (asked
    // again at each drawing: another map may be open, with its own materials; what was read stays with warm)
    waiting.length = 0; warmed.clear();
    observer?.disconnect();
    observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(seen => {
      for (const entry of seen) if (entry.isIntersecting) { observer?.unobserve(entry.target); warmLater(itemOf(entry.target.dataset.pfCard)); }
    }) : null;
    for (const article of container.querySelectorAll('[data-pf-card]')) {
      const ready = () => warmNow(itemOf(article.dataset.pfCard));
      article.addEventListener('pointerenter', ready);
      article.addEventListener('focusin', ready);
      observer?.observe(article);
    }
  }

  // a card's menu (its ⋯ or a right click): its copies in the open map, then the prefab itself
  function more(item, x, y) {
    if (!item) return;
    const here = copiesHere(item);
    menu(x, y, [
      { label: 'Select instances', off: !here?.count, run: () => onSelect(item) },
      { label: 'Update instances', off: !here?.older, run: () => onUpdate(item) },
      { sep: true },
      { label: 'Edit catalog details…', run: () => editCatalogDetails({ item, api, categories: (items || []).map(i => i.cat),
        onSaved: () => { invalidate(); return render(); } }) },
      { label: 'Rename…', run: () => rename(item) },
      { label: 'Use the current view as its picture', off: !here, run: () => picture(item) },
      { sep: true },
      { label: 'Delete…', run: () => remove(item) },
    ]);
  }

  // a dialog asking for a prefab's name (Save selection as prefab, Rename): run(label) does the work (a failure stays
  // in the dialog); resolves with what run gave, null when cancelled
  function askName({ title, hint, submitText, busyText, value, run }) {
    if (modal) return modal.promise;
    const dialog = document.createElement('dialog');
    dialog.className = 'map-dialog prefab-dialog';
    dialog.setAttribute('aria-labelledby', 'prefab-dialog-title');
    dialog.innerHTML = `<header><h2 id="prefab-dialog-title">${esc(title)}</h2></header>
      <form><main><label for="prefab-name">Prefab name</label>
        <input id="prefab-name" name="label" maxlength="80" autocomplete="off" required>
        <p class="hint">${esc(hint)}</p>
        <p class="map-error" role="alert" data-pf-error></p></main>
        <footer><button type="button" data-pf-cancel>Cancel</button><button type="submit" class="primary" data-pf-submit>${esc(submitText)}</button></footer></form>`;
    const input = dialog.querySelector('#prefab-name'), error = dialog.querySelector('[data-pf-error]');
    const submit = dialog.querySelector('[data-pf-submit]'), cancel = dialog.querySelector('[data-pf-cancel]');
    input.value = String(value || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80);
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
      const label = input.value.trim();
      if (!label || label.length > 80 || /[\x00-\x1f\x7f]/.test(label)) {
        error.textContent = 'Use a name of 1–80 printable characters.';
        input.focus(); return;
      }
      saving = true; submit.disabled = true; cancel.disabled = true; input.disabled = true;
      submit.textContent = busyText; error.textContent = '';
      let result;
      try { result = await run(label); }
      catch (failure) {
        error.textContent = failure?.message || String(failure);
        saving = false; submit.disabled = false; cancel.disabled = false; input.disabled = false;
        submit.textContent = submitText; return;
      }
      finish(result);
    };
    document.body.appendChild(dialog);
    dialog.showModal(); input.focus(); input.select();
    return promise;
  }

  // the 3D view made small for a card (320×180, its middle): a JPEG data URL
  function shrink(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const out = document.createElement('canvas'); out.width = 320; out.height = 180;
        const k = Math.max(320 / image.width, 180 / image.height), w = image.width * k, h = image.height * k;
        out.getContext('2d').drawImage(image, (320 - w) / 2, (180 - h) / 2, w, h);
        resolve(out.toDataURL('image/jpeg', 0.85));
      };
      image.onerror = () => reject(new Error('The picture of the 3D view could not be read.'));
      image.src = url;
    });
  }

  function save() {
    const reason = unavailable();
    if (reason) { status(reason, 'warn'); return Promise.resolve(null); }
    if (modal) return modal.promise;
    const view = capture();             // the 3D view as it is now: the new prefab's picture
    return askName({
      title: 'Save selection as prefab', submitText: 'Save prefab', busyText: 'Saving…', value: getDefaultName(),
      hint: 'Saves a baked copy as one structure in this project, with the 3D view as its picture. The copies you place stay linked to it. Rebuild first if the source geometry has changed. Mission logic and doors cannot be included.',
      run: async label => {
        const currentReason = unavailable();
        if (currentReason) throw new Error(currentReason);
        const descriptor = await onSave(label, view ? await shrink(view).catch(() => '') : '');
        if (!descriptor || descriptor.kind !== 'prefab' || typeof descriptor.id !== 'string')
          throw new Error('The server did not return a saved prefab.');
        return descriptor;
      },
    }).then(async descriptor => {
      if (!descriptor) return null;
      invalidate();
      status(`Saved prefab “${descriptor.label}”.`, 'ok');
      try { await onSaved(descriptor); }
      catch (failure) { status('Prefab saved, but the library could not be refreshed: ' + (failure?.message || failure), 'warn'); }
      void render();
      return descriptor;
    });
  }

  // Rename… (Unity's Project window): every version of the prefab; its copies' structures take the name at their next
  // Rebuild
  function rename(item) {
    return askName({
      title: 'Rename prefab', submitText: 'Rename', busyText: 'Renaming…', value: item.label,
      hint: 'The prefab keeps its versions and its copies stay linked to it. Copies already built show the new name after the next Rebuild.',
      run: label => api('/api/prefab_rename', { line: lineOf(item), label }),
    }).then(renamed => {
      if (!renamed) return;
      invalidate(); void render();
      status(`Prefab renamed “${renamed.label}”.`, 'ok');
    });
  }

  // its picture: the 3D view as it is now (without the editor's marks)
  async function picture(item) {
    const view = capture();
    if (!view) { status('Open a map: the picture of a prefab is taken from its 3D view.', 'warn'); return; }
    try { await api('/api/prefab_thumb', { line: lineOf(item), picture: await shrink(view) }); }
    catch (error) { status('Cannot change the picture: ' + (error?.message || error), 'bad'); return; }
    invalidate(); void render();
    status(`The 3D view is the picture of “${item.label}” now.`, 'ok');
  }

  // Delete…: asked first, with where it is placed. Out of the library, its versions stay on disk (copies are built from
  // them, Undo or the clipboard may place one again) until the project is opened again and nothing saved places them
  async function remove(item) {
    let used;
    try { used = await api('/api/prefab_usage?line=' + encodeURIComponent(lineOf(item))); }
    catch (error) { status('Cannot delete the prefab: ' + (error?.message || error), 'bad'); return; }
    const where = used.copies ? `It is placed ${used.copies} ${used.copies === 1 ? 'time' : 'times'} (${used.places.join(', ')}). Those copies stay in their maps and are still built, but can no longer be updated.`
      : 'No saved map places it.';
    if (!confirm(`Delete the prefab “${item.label}” from this project's library?\n\n${where}\n\nThis cannot be undone.`)) return;
    let result;
    try { result = await api('/api/prefab_delete', { line: lineOf(item), open: placedHere() }); }
    catch (error) { status('Cannot delete the prefab: ' + (error?.message || error), 'bad'); return; }
    invalidate(); void render();
    status(`Deleted the prefab “${item.label}”${result.places?.length ? `: the copies in ${result.places.join(', ')} are still built` : ''}. Its files go when the project is opened again, if nothing saved places it then.`, 'ok');
  }

  return { render, save, invalidate, list, cached };
}
