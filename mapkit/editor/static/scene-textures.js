// A visible map always goes ahead of browser previews. Keep the same Texture
// object on every material, but reallocate its GPU storage when the pixels arrive.
export function createSceneTextures({ createTexture, loadImage, placeholder, wake = () => {},
  failed = () => {}, limit = 6, previewLimit = 2, timeout = 15000, retries = 2 }) {
  const jobs = new Set();
  let active = 0, previewActive = 0, scheduled = false;
  function pumpSoon() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; pump(); });
  }
  function pump() {
    while (active < limit) {
      const waiting = [...jobs].filter(j => !j.running);
      const j = waiting.find(j => j.scope === 'scene') ||
        (previewActive < previewLimit && waiting.find(j => j.scope === 'preview'));
      if (!j) return;
      j.running = true; active++;
      if (j.scope === 'preview') previewActive++;
      const attempt = ++j.attempt;
      let settled = false;
      const finish = (image) => {
        if (settled || !jobs.has(j) || j.attempt !== attempt) return;
        settled = true; clearTimeout(j.timer); active--;
        if (j.scope === 'preview') previewActive--;
        j.running = false;
        if (image) {
          // WebGL2 allocates immutable storage for the 1px placeholder. A mere
          // needsUpdate cannot grow it: dispose tells BOTH renderers to allocate
          // the actual image size, without changing any material's map reference.
          j.texture.dispose();
          j.texture.image = image;
          j.texture.userData.pending = false;
          j.texture.userData.failed = false;
          j.texture.needsUpdate = true;
          jobs.delete(j);
        } else if (attempt > retries) {
          j.texture.userData.pending = false;
          j.texture.userData.failed = true;
          jobs.delete(j); failed(j.url, j.scope);
        }
        wake(); pumpSoon();
      };
      j.timer = setTimeout(() => finish(null), timeout);
      try { loadImage(j.url, image => finish(image), () => finish(null)); }
      catch { finish(null); }
    }
  }
  return {
    load(url, scope = 'scene') {
      const texture = createTexture();
      texture.image = placeholder; texture.userData.pending = true; texture.needsUpdate = true;
      jobs.add({ url, scope, texture, attempt: 0, running: false }); pumpSoon();
      return texture;
    },
    pending(scope = 'scene') { return [...jobs].some(j => j.scope === scope); },
    clear() {
      for (const j of jobs) clearTimeout(j.timer);
      jobs.clear(); active = previewActive = 0;
    },
  };
}
