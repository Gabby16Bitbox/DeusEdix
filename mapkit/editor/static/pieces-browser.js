// Local, on-demand scan of installed maps. Nothing here ships game content.
export function createPiecesBrowser({
  api, escapeHtml, onPlace, canPlace = () => true, isVisible = () => true,
  onThumbnails = () => {}, onCatalog = () => {}, pollMs = 2000,
  containerSelector = '#pieces', searchSelector = '#psearch',
  filterItem = () => true, categoryLabel = value => value, searchTerms = [],
  getContext = () => null, noun = 'pieces',
}) {
  const $ = selector => document.querySelector(selector);
  const esc = value => escapeHtml(String(value ?? ''));
  const number = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  let catalog = null, request = null, generation = 0, autoAttempted = false, scanning = false, pausing = false;
  let timer = 0, thumbFrame = 0, disposed = false, shell = null, searchInput = null;
  let listStamp = null, scanError = '', readError = '', placeError = '', openedFirst = false;
  const openCategories = new Set(), preparing = new Set();
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '/static/pieces-browser.css';
  if (!$('link[href="/static/pieces-browser.css"]')) document.head.appendChild(link);

  function stopPolling() { clearTimeout(timer); timer = 0; }
  function thumbnails() {
    if (thumbFrame || disposed || !isVisible()) return;
    thumbFrame = requestAnimationFrame(() => {
      thumbFrame = 0;
      if (!disposed && isVisible()) onThumbnails();
    });
  }
  function poll() {
    stopPolling();
    if (disposed || !isVisible() || !['running', 'pausing'].includes(catalog?.scan?.state)) return;
    timer = setTimeout(() => { timer = 0; if (!disposed && isVisible()) void render(); }, Math.max(50, pollMs));
  }
  const search = () => { if (!disposed) draw(); };
  function ensureShell() {
    const container = $(containerSelector);
    if (!container) return null;
    if (shell !== container || !container.querySelector('[data-pieces-progress]')) {
      shell = container; listStamp = null;
      container.innerHTML = '<div data-pieces-progress></div><div class="pieces-placement-error hint bad" data-pieces-error role="alert"></div><div data-pieces-list></div>';
    }
    const input = $(searchSelector);
    if (input && input !== searchInput) {
      searchInput?.removeEventListener('input', search);
      searchInput = input; searchInput.addEventListener('input', search);
    }
    return container;
  }

  function progressHtml() {
    if (!catalog && !readError) return '<div class="hint" role="status">Reading the local library…</div>';
    const scan = catalog?.scan || {}, state = scan.state || 'idle';
    const active = ['running', 'pausing'].includes(state) || scanning || pausing;
    const processed = number(scan.processed), total = number(scan.total), found = number(scan.items ?? catalog?.items?.length);
    const gameName = catalog?.gameName || ({ vanilla: 'Deus Ex', revision: 'Deus Ex: Revision' })[catalog?.game] || 'Selected game';
    const failure = readError || scanError || (state === 'error' ? scan.message || 'The local scan could not finish.' : '');
    let html = `<div class="pieces-scan-toolbar"><button data-pieces-scan ${active ? 'disabled' : ''}>${active ? 'Scanning…' : state === 'paused' ? 'Resume scan' : failure ? 'Retry scan' : 'Refresh scan'}</button>
      ${['running', 'pausing'].includes(state) ? `<button data-pieces-pause ${pausing || state === 'pausing' ? 'disabled' : ''}>${pausing || state === 'pausing' ? 'Pausing…' : 'Pause scan'}</button>` : ''}<span class="hint">${esc(gameName)} · from your installed maps · project-local cache</span></div>`;
    if (active) {
      html += `<div class="pieces-scan-progress" role="status" aria-live="polite"><span>${total ? `${processed} / ${total} maps` : 'Finding installed maps…'} · ${found} pieces found</span>
        <progress ${total ? `value="${Math.min(processed, total)}" max="${total}"` : ''} aria-label="Local map scan progress"></progress>
        ${scan.current ? `<small>Scanning: ${esc(scan.current)}</small>` : ''}${scan.message ? `<small>${esc(scan.message)}</small>` : ''}</div>`;
    } else if (scan.message && !failure) html += `<div class="hint pieces-scan-message">${esc(scan.message)}</div>`;
    else if (state === 'paused') html += `<div class="hint pieces-scan-message">Scan paused · ${processed}${total ? ' / ' + total : ''} maps · ${found} pieces. Resume continues from the existing cache.</div>`;
    if (failure) html += `<div class="hint bad" role="alert">${esc(failure)} ${readError ? '<button data-pieces-retry>Retry library</button>' : ''}</div>`;
    const errors = Array.isArray(scan.errors) ? scan.errors : [];
    if (errors.length) html += `<details class="pieces-scan-errors"><summary>${errors.length} map${errors.length === 1 ? '' : 's'} could not be read</summary><ul>${errors.slice(0, 20).map(error => `<li>${esc(typeof error === 'string' ? error : `${error.map || error.path || 'Map'}: ${error.message || error.error || 'unreadable'}`)}</li>`).join('')}</ul></details>`;
    return html;
  }

  function draw() {
    const container = ensureShell();
    if (!container || disposed) return;
    container.querySelector('[data-pieces-progress]').innerHTML = progressHtml();
    container.querySelector('[data-pieces-error]').textContent = placeError;
    const scanButton = container.querySelector('[data-pieces-scan]');
    if (scanButton) scanButton.onclick = () => { void scan(false); };
    const pauseButton = container.querySelector('[data-pieces-pause]');
    if (pauseButton) pauseButton.onclick = () => { void pause(); };
    const retry = container.querySelector('[data-pieces-retry]');
    if (retry) retry.onclick = () => { void render(); };
    const query = String(searchInput?.value || '').trim().toLowerCase();
    const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
    const items = Array.isArray(catalog?.items) ? catalog.items.filter(filterItem) : [];
    const syncPreparing = () => {
      for (const button of container.querySelectorAll('[data-piece]')) {
        const pending = preparing.has(button.dataset.piece);
        button.disabled = pending;
        if (pending) button.setAttribute('aria-busy', 'true'); else button.removeAttribute('aria-busy');
        const label = button.querySelector('[data-piece-loading]');
        if (pending && !label) {
          const text = document.createElement('small'); text.dataset.pieceLoading = ''; text.textContent = 'Preparing…'; button.appendChild(text);
        } else if (!pending && label) label.remove();
      }
    };
    const stamp = JSON.stringify([query, categories, items, items.length ? '' : catalog?.scan?.state, items.length ? false : scanning]);
    if (stamp === listStamp) { syncPreparing(); return; }
    listStamp = stamp;
    const target = container.querySelector('[data-pieces-list]');
    const firstCategory = categories.find(category => items.some(item => item.cat === category));
    if (!openedFirst && firstCategory) { openCategories.add(firstCategory); openedFirst = true; }
    let html = '';
    for (const category of categories) {
      const shown = items.filter(item => item.cat === category && (!query || [item.label, item.cat, item.map, ...searchTerms, ...(Array.isArray(item.tex) ? item.tex : [])]
        .some(value => String(value || '').toLowerCase().includes(query))));
      if (!shown.length) continue;
      html += `<details data-cat="${esc(category)}" ${query || openCategories.has(category) ? 'open' : ''}><summary>${esc(categoryLabel(category))} <small>${shown.length}</small></summary>`;
      for (const item of shown.slice(0, query ? 300 : 600)) {
        const maps = Array.isArray(item.maps) ? item.maps : [], size = Array.isArray(item.size) ? item.size.join(' x ') : '';
        const where = maps.length > 1 ? `${maps.length} levels` : item.map || '';
        html += `<button class="item" data-piece="${esc(item.id)}" ${preparing.has(item.id) ? 'disabled aria-busy="true"' : ''}
          title="${esc(item.label)} · ${esc(size)} · used ${number(item.count)} time${item.count === 1 ? '' : 's'} (${esc(where)})${item.operation ? ' · ' + esc(item.operation) + '. Rebuild to play. No original mission links.' : ''}">
          <span class="th" data-th="piece:${esc(item.id)}${item.revision ? '|' + esc(item.revision) : ''}"></span><span class="tl">${esc(item.label)}</span>${preparing.has(item.id) ? '<small data-piece-loading>Preparing…</small>' : ''}</button>`;
      }
      html += '</details>';
    }
    if (!html) {
      const running = ['running', 'pausing'].includes(catalog?.scan?.state) || scanning;
      const text = items.length ? `No ${noun} match these words.` : running
        ? `Scanning installed maps. ${noun[0].toUpperCase() + noun.slice(1)} will appear here as they are found; you can keep working.`
        : `No ${noun} are cached yet. Check the selected game installation, then refresh the scan.`;
      html = `<div class="hint pieces-empty">${text}</div>`;
    }
    target.innerHTML = html;
    for (const detail of target.querySelectorAll('details')) detail.addEventListener('toggle', () => {
      if (!query) (detail.open ? openCategories.add(detail.dataset.cat) : openCategories.delete(detail.dataset.cat));
      thumbnails();
    });
    // Drag/drop awaits preparation before placing the asset in the viewport.
    for (const button of target.querySelectorAll('[data-piece]')) button.onclick = () => place(button.dataset.piece);
    syncPreparing();
    thumbnails();
  }

  async function read() {
    if (request) return request;
    const revision = generation;
    const pending = Promise.resolve().then(() => api('/api/pieces')).then(value => {
      if (!value || !Array.isArray(value.items) || !Array.isArray(value.categories)) throw new Error('The local Pieces library could not be read.');
      if (!disposed && revision === generation) {
        catalog = value; readError = '';
        onCatalog(value);
      }
      return value;
    }).finally(() => { if (request === pending) request = null; });
    request = pending;
    return pending;
  }

  async function scan(automatic) {
    if (disposed || scanning || !isVisible()) return;
    autoAttempted = true; scanning = true; scanError = ''; stopPolling(); draw();
    const revision = generation;
    try {
      await api('/api/pieces_scan', automatic ? {} : { force: false });
      if (disposed || revision !== generation) return;
      await read();
    } catch (error) {
      if (!disposed && revision === generation) scanError = error?.message || String(error);
    } finally {
      if (!disposed && revision === generation) { scanning = false; draw(); poll(); }
    }
  }

  async function pause() {
    if (disposed || pausing || catalog?.scan?.state !== 'running') return;
    pausing = true; scanError = ''; draw();
    const revision = generation;
    try {
      await api('/api/pieces_stop', {});
      if (!disposed && revision === generation) await read();
    } catch (error) {
      if (!disposed && revision === generation) scanError = error?.message || String(error);
    } finally {
      if (!disposed && revision === generation) { pausing = false; draw(); poll(); }
    }
  }

  async function render() {
    if (disposed || !isVisible()) { stopPolling(); return; }
    const revision = generation;
    ensureShell(); if (!catalog) draw();
    try { await read(); }
    catch (error) { if (!disposed && revision === generation) readError = error?.message || String(error); }
    if (disposed || revision !== generation) return;
    draw();
    const state = catalog?.scan?.state || 'idle';
    if (catalog && !autoAttempted && !['running', 'error', 'paused', 'pausing'].includes(state) && (!catalog.items.length || catalog.scan?.stale))
      await scan(true);
    else poll();
  }

  async function place(id) {
    if (disposed || preparing.has(id)) return;
    if (!canPlace()) { placeError = 'Open a map and stop Play before placing a piece.'; draw(); return; }
    preparing.add(id); placeError = ''; draw();
    const context = getContext(), revision = generation;
    try {
      const clip = await api('/api/piece_prefab?id=' + encodeURIComponent(id), {});
      if (disposed || revision !== generation || context !== getContext()) return;
      if (!canPlace()) throw new Error('Open a map and stop Play before placing the prepared piece.');
      const button = [...(shell?.querySelectorAll('[data-piece]') || [])].find(item => item.dataset.piece === id);
      await onPlace(clip, button);
    } catch (error) { if (!disposed) placeError = 'Piece: ' + (error?.message || error); }
    finally { preparing.delete(id); if (!disposed) draw(); }
  }

  function invalidate() {
    generation++; request = null; catalog = null; autoAttempted = false; scanning = false; pausing = false;
    readError = ''; scanError = ''; listStamp = null; stopPolling();
  }
  function dispose() {
    disposed = true; generation++; stopPolling(); cancelAnimationFrame(thumbFrame); thumbFrame = 0;
    searchInput?.removeEventListener('input', search);
  }
  return { render, invalidate, dispose, suspend: stopPolling };
}
