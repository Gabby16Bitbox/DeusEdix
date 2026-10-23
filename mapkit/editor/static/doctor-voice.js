// Dr. Hale's own, pre-generated public-library voice. No runtime TTS or OS voice fallback.
export const DOCTOR_WELCOME = 'Welcome to DeusEdix. I am Doctor Elias Hale. Open a map to begin, or choose the interactive tutorial and I will guide you through the training rooms.';
export const DOCTOR_MUTE_KEY = 'ucmap.doctorAudioMuted';
const MANIFEST = '/static/audio/doctor/manifest.json';
const CLIP = /^\/static\/audio\/doctor\/[A-Za-z0-9_-]+\.(?:mp3|wav|ogg)$/;
const browserStorage = () => { try { return globalThis.localStorage; } catch (_) { return null; } };

export function createDoctorVoice({ transport = (...args) => globalThis.fetch(...args),
  makeAudio = url => new Audio(url), storage = browserStorage(),
  win = globalThis.window, doc = globalThis.document, hush = on => win?.__tutorialMusic?.hush('doctor', on) } = {}) {
  let muted = false;
  try {
    const shared = storage?.getItem(DOCTOR_MUTE_KEY);
    const legacy = `deusedix.project:${encodeURIComponent(win?.__projectContext?.id || 'manager')}:tutorial`;
    const old = JSON.parse(storage?.getItem(legacy) || 'null');
    muted = shared === null || shared === undefined ? !!old?.muted : shared === 'true';
    if ((shared === null || shared === undefined) && typeof old?.muted === 'boolean')
      storage?.setItem(DOCTOR_MUTE_KEY, String(muted));
  } catch (_) { /* optional preferences */ }
  let clips = null, manifestPending = null, epoch = 0, player = null, job = null, queued = [], retry = null;
  const listeners = new Set(), waiters = new Set();
  const visible = () => !doc || (doc.visibilityState === 'visible' && (!doc.hasFocus || doc.hasFocus()));
  const valid = item => item && item.epoch === epoch && !muted && visible() && item.active();
  const publish = () => { for (const listener of listeners) listener(muted); };
  const settle = () => {
    if (job || queued.length) return;
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  function clearRetry() {
    if (!retry) return;
    win?.removeEventListener('pointerdown', retry, true);
    win?.removeEventListener('keydown', retry, true);
    retry = null;
  }
  function stop() {
    epoch++; clearRetry(); queued = []; job = null;
    if (player) {
      player.onended = player.onerror = null;
      player.pause();
      try { player.currentTime = 0; } catch (_) { /* media not loaded yet */ }
      player = null;
    }
    hush(false); settle();
  }
  function setMuted(value) {
    muted = !!value;
    try { storage?.setItem(DOCTOR_MUTE_KEY, String(muted)); } catch (_) { /* optional preferences */ }
    // Even unmuting invalidates an old promise/gesture retry; it never revives stale speech.
    stop(); publish();
    return muted;
  }
  async function manifest() {
    if (clips) return clips;
    if (!manifestPending) manifestPending = Promise.resolve().then(() => transport(MANIFEST)).then(async response => {
      if (!response.ok) return new Map();
      const data = await response.json(), result = new Map();
      if (data?.version !== 1 || data.voice !== 'EliasHale' || !Array.isArray(data.clips)) return result;
      for (const clip of data.clips) if (typeof clip?.text === 'string' && clip.text &&
        typeof clip.url === 'string' && CLIP.test(clip.url)) result.set(clip.text, clip.url);
      return result;
    }).catch(() => new Map()).then(result => (clips = result));
    return manifestPending;
  }
  function next() {
    player = null; job = null; hush(false); clearRetry();
    const item = queued.shift();
    if (item && valid(item)) void play(item);
    else { queued = []; settle(); }
  }
  async function play(item) {
    if (!valid(item)) { settle(); return false; }
    job = item;
    const available = await manifest();
    if (job !== item) return false;
    if (!valid(item)) { stop(); return false; }
    const url = available.get(item.text);
    if (!url) { next(); return false; } // Missing assets keep the existing text-only tutorial.
    let audio;
    try { audio = makeAudio(url); } catch (_) { next(); return false; }
    player = audio;
    audio.preload = 'auto'; audio.volume = 1;
    audio.onended = audio.onerror = () => { if (job === item && player === audio) next(); };
    async function start() {
      if (player !== audio) return false;
      if (!valid(item)) { stop(); return false; }
      clearRetry(); hush(true);
      try {
        await audio.play();
        if (!valid(item) || player !== audio) {
          audio.pause(); if (job === item) stop(); return false;
        }
        return true;
      } catch (error) {
        if (player !== audio) return false;
        if (!valid(item)) { stop(); return false; }
        hush(false);
        if (error?.name !== 'NotAllowedError') { next(); return false; }
        // Only a current user-opened lesson may resume when autoplay permission arrives.
        retry = () => { if (valid(item) && player === audio) void start(); else clearRetry(); };
        win?.addEventListener('pointerdown', retry, true);
        win?.addEventListener('keydown', retry, true);
        return false;
      }
    }
    return start();
  }
  function speak(text, { owner = 'guide', active = () => true } = {}) {
    stop();
    if (typeof text !== 'string' || !text || muted || !visible() || !active()) return Promise.resolve(false);
    return play({ text, owner, active, epoch });
  }
  function enqueue(text, { owner = 'guide', active = () => true } = {}) {
    if (typeof text !== 'string' || !text || muted || !visible() || !active()) return;
    const item = { text, owner, active, epoch };
    if (job && job.owner === owner) queued.push(item);
    else if (!job) void play(item);
  }
  function whenIdle(owner, timeout = 120000) {
    // A browser-blocked or unavailable voice must never stall the existing lesson flow.
    if (!job || job.owner !== owner || !player || player.paused || retry) return Promise.resolve();
    return new Promise(resolve => {
      let timer;
      const done = () => { clearTimeout(timer); waiters.delete(done); resolve(); };
      waiters.add(done); timer = setTimeout(done, timeout);
    });
  }
  const away = () => stop();
  win?.addEventListener('blur', away);
  win?.addEventListener('pagehide', away);
  doc?.addEventListener('visibilitychange', () => { if (!visible()) stop(); });
  win?.addEventListener('deusedix:map-state', away);
  win?.addEventListener('deusedix:play-state', event => { if (event.detail?.phase !== 'idle') stop(); });
  win?.addEventListener('storage', event => {
    if (event.key === DOCTOR_MUTE_KEY) { muted = event.newValue === 'true'; stop(); publish(); }
  });
  return { speak, enqueue, stop, whenIdle, setMuted, toggle: () => setMuted(!muted),
    has: async text => (await manifest()).has(text),
    get muted() { return muted; },
    state: () => ({ muted, playing: !!player && !player.paused, pending: !!job, owner: job?.owner || null }),
    subscribe(listener) { listeners.add(listener); listener(muted); return () => listeners.delete(listener); } };
}

export const doctorVoice = createDoctorVoice();
