// This classic script runs before the editor modules read their preferences.
(() => {
  const context = window.__projectContext || {}, prefix = context.id ? `deusedix.project:${encodeURIComponent(context.id)}:` : null;
  const globalKeys = new Set(['deusedix.prefs', 'deusedix.workspace.v1', 'deusedix.inspector.folds']);
  const allowed = key => globalKeys.has(key) || key.startsWith('ucmap.') || (prefix && key.startsWith(prefix));
  const training = ['tutorial', 'training'].includes(context.kind);
  // Training edits live only in the open exercise. Keep interface choices, but
  // never restore hidden props, copied objects or a half-finished lesson.
  function persistedValue(key, value) {
    if (!training || !prefix || !key.startsWith(prefix)) return value;
    const name = key.slice(prefix.length);
    if (name === 'objects.deusedix_tutorial' || name === 'clipboard') return null;
    if (name !== 'tutorial' && name !== 'maps') return value;
    let prefs;
    try { prefs = JSON.parse(value); } catch (_) { return null; }
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return null;
    if (name === 'tutorial') {
      return JSON.stringify(Object.fromEntries(['muted', 'offered']
        .filter(key => typeof prefs[key] === 'boolean').map(key => [key, prefs[key]])));
    }
    if (prefs.lastMap === 'deusedix_tutorial') prefs.lastMap = null;
    if (Array.isArray(prefs.recentMaps)) {
      prefs.recentMaps = prefs.recentMaps.filter(map => (typeof map === 'string' ? map : map?.script) !== 'deusedix_tutorial');
    }
    return JSON.stringify(prefs);
  }
  const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
  try {
    if (prefix) {
      const stale = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(prefix)) stale.push(key);
      }
      for (const key of stale) remove.call(localStorage, key);
    }
    for (const [key, value] of Object.entries(window.__projectPreferences || {})) {
      if (!allowed(key)) continue;
      const kept = persistedValue(key, value);
      if (kept !== null) set.call(localStorage, key, kept);
    }
  } catch (_) { /* The editor also works with browser storage disabled. */ }
  const fetch = window.fetch.bind(window);
  let timer = 0, pending = Promise.resolve();
  function snapshot() {
    const result = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!allowed(key)) continue;
      const kept = persistedValue(key, localStorage.getItem(key));
      if (kept !== null) result[key] = kept;
    }
    return result;
  }
  async function flush() {
    clearTimeout(timer); timer = 0;
    let values;
    try { values = snapshot(); } catch (_) { return; }
    pending = pending.catch(() => {}).then(async () => {
      const response = await fetch('/api/project/preferences', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(values)});
      if (!response.ok) throw new Error((await response.json()).error || 'Could not save project preferences.');
    });
    return pending;
  }
  function changed(storage, key) {
    if (storage !== localStorage || !allowed(String(key))) return;
    clearTimeout(timer); timer = setTimeout(() => flush().catch(() => {}), 350);
  }
  Storage.prototype.setItem = function(key, value) { set.call(this, key, value); changed(this, key); };
  Storage.prototype.removeItem = function(key) { remove.call(this, key); changed(this, key); };
  window.__flushProjectPreferences = flush;
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === location.origin && /^\/api\/projects\/(open|create|close)$/.test(url.pathname) && init.method === 'POST') {
      return flush().then(() => fetch(input, init));
    }
    return fetch(input, init);
  };
})();
