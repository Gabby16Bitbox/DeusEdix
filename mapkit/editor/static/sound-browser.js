// Sound assets use the same Inspector as scene objects, without editing a map.
// Preview data is read lazily; only compact wave envelopes are retained.
const esc = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const speaker = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM17 8c2 2 2 6 0 8M20 5c4 4 4 10 0 14"/></svg>';
const transportIcon = kind => `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
  play: '<path d="m6 3 10 7-10 7z"/>', pause: '<path d="M7 3v14M13 3v14"/>',
  stop: '<rect x="4" y="4" width="12" height="12"/>', start: '<path d="M4 3v14M15 3 6 10l9 7z"/>',
}[kind]}</svg>`;
const timeText = value => Number.isFinite(value) ? (value >= 60 ? Math.floor(value / 60) + ':' + String(Math.floor(value % 60)).padStart(2, '0') : value.toFixed(1) + ' s') : '—';

export function waveformEnvelope(channels, bins = 96) {
  const count = channels[0]?.length || 0;
  if (!count || !channels.length) return [];
  bins = Math.min(count, Math.max(1, Math.round(bins)));
  const result = [];
  for (let b = 0; b < bins; b++) {
    const start = Math.floor(b * count / bins), end = Math.max(start + 1, Math.floor((b + 1) * count / bins));
    let lo = 0, hi = 0;
    for (const channel of channels) for (let i = start; i < end; i++) {
      const value = Number.isFinite(channel[i]) ? Math.max(-1, Math.min(1, channel[i])) : 0;
      lo = Math.min(lo, value); hi = Math.max(hi, value);
    }
    result.push([lo, hi]);
  }
  return result;
}

export function waveformPath(peaks) {
  return peaks.map(([lo, hi], i) => {
    const x = ((i + .5) / peaks.length * 100).toFixed(2);
    return `M${x},${(50 - hi * 44).toFixed(2)}V${(50 - lo * 44).toFixed(2)}`;
  }).join('');
}

export function createSoundBrowser({ api, container, inspector, onSelect, onClear, onError, deleteSound, getCatalog }) {
  let catalog = [], current = null, token = 0, audio = null, playingName = '', pendingName = '', playToken = 0, animation = 0;
  let volume = .7, loop = false, selectionBusy = false;
  let deferredSeek = null, seeking = false, refreshAfterSeek = false;
  const entries = new Map(), waves = new Map(), tiles = new Map(), cursors = new Map();
  const currentEntry = () => current ? entries.get(current.name) : null;
  const validDuration = value => Number.isFinite(value) && value > 0;
  const durationOf = name => {
    const live = playingName === name ? audio?.duration : null;
    const known = entries.get(name)?.seconds ?? catalog.find(item => item.name === name)?.seconds;
    return validDuration(live) ? live : validDuration(known) ? known : null;
  };
  const positionOf = name => playingName === name && audio ? (deferredSeek ?? audio.currentTime ?? 0) : (cursors.get(name) || 0);
  const remember = (map, key, value, limit) => {
    map.delete(key); map.set(key, value);
    while (map.size > limit) { const old = map.keys().next().value; if (old === current?.name || old === playingName) { const keep = map.get(old); map.delete(old); map.set(old, keep); } else map.delete(old); }
    return value;
  };
  function waveHtml(name, playhead = true) {
    const wave = waves.get(name);
    return wave?.peaks?.length ? `<svg class="sound-wave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Audio waveform"><path d="${waveformPath(wave.peaks)}"/>${playhead ? '<line class="sound-playhead" x1="0" y1="0" x2="0" y2="100"/>' : ''}</svg>` : `<span class="sound-symbol">${speaker}</span>`;
  }
  function tileHtml(asset) {
    const short = asset.short || asset.name.split('.').pop();
    const seconds = entries.get(asset.name)?.seconds ?? asset.seconds;
    return `<div class="srow sound-tile${current?.name === asset.name ? ' on' : ''}" draggable="true" data-snd="${esc(asset.name)}" role="option" aria-selected="${current?.name === asset.name}" tabindex="0" title="${esc(asset.name)} · Drag into the scene or onto a sound field">
      <div class="sound-thumbnail" data-wave-for="${esc(asset.name)}">${waveHtml(asset.name)}</div>
      <button type="button" class="sound-play" data-splay="${esc(asset.name)}" aria-label="Play ${esc(short)}" title="Play preview">${transportIcon('play')}</button>
      <span class="sn">${esc(short)}</span><small class="sound-length">${Number.isFinite(seconds) ? timeText(seconds) : 'Sound'}</small></div>`;
  }
  function updateButtons() {
    for (const button of document.querySelectorAll('[data-splay]')) {
      const pending = pendingName === button.dataset.splay;
      const active = playingName === button.dataset.splay && audio && !audio.paused;
      button.innerHTML = transportIcon(pending ? 'stop' : active ? 'pause' : 'play');
      button.title = pending ? 'Loading preview… Click to cancel' : active ? 'Pause preview' : 'Play from cursor';
      button.setAttribute('aria-busy', String(pending));
      button.setAttribute('aria-label', (pending ? 'Stop ' : active ? 'Pause ' : 'Play ') + button.dataset.splay.split('.').pop());
    }
  }
  function updateTiles() {
    for (const [name, tile] of tiles) {
      tile.classList.toggle('on', current?.name === name);
      tile.setAttribute('aria-selected', String(current?.name === name));
      const thumb = tile.querySelector('.sound-thumbnail');
      const seconds = entries.get(name)?.seconds ?? catalog.find(asset => asset.name === name)?.seconds;
      const length = tile.querySelector('.sound-length');
      if (length) length.textContent = Number.isFinite(seconds) ? timeText(seconds) : 'Sound';
      const hasWave = !!waves.get(name)?.peaks;
      if (thumb.dataset.loaded !== String(hasWave)) { thumb.innerHTML = waveHtml(name); thumb.dataset.loaded = String(hasWave); }
    }
    updateButtons(); updateProgress();
  }
  function updateProgress() {
    for (const [name, root] of [[playingName, tiles.get(playingName)], [current?.name, current ? inspector() : null]]) {
      if (!root) continue;
      const duration = durationOf(name), position = Math.max(0, Math.min(duration || Infinity, positionOf(name)));
      const progress = duration ? position / duration * 100 : 0;
      const line = root.querySelector('.sound-playhead');
      if (line) { line.setAttribute('x1', String(progress)); line.setAttribute('x2', String(progress)); }
      const seek = root.querySelector('[data-sound-seek]');
      if (seek) {
        seek.style.setProperty('--sound-position', progress + '%');
        seek.setAttribute('aria-disabled', String(!duration));
        seek.setAttribute('aria-valuemax', String(duration || 0));
        seek.setAttribute('aria-valuenow', String(position));
        seek.setAttribute('aria-valuetext', timeText(position) + ' / ' + timeText(duration));
      }
      const stamp = root.querySelector('[data-sound-time]');
      if (stamp) stamp.textContent = timeText(position) + ' / ' + timeText(duration);
      const start = root.querySelector('[data-sound-start]');
      if (start) start.disabled = !duration;
    }
  }
  function seekTo(name, seconds) {
    const duration = durationOf(name);
    if (!duration || !Number.isFinite(seconds)) return false;
    const position = Math.max(0, Math.min(duration, seconds));
    remember(cursors, name, position, 48);
    if (audio && playingName === name) {
      deferredSeek = position;
      if (validDuration(audio.duration)) try { audio.currentTime = position; deferredSeek = null; } catch (_) { /* Wait for metadata. */ }
    }
    updateProgress(); return true;
  }
  function animateProgress() {
    animation = 0; updateProgress();
    if (audio && !audio.paused) animation = requestAnimationFrame(animateProgress);
  }
  function stop() {
    const previous = playingName;
    playToken++;
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
    if (audio) {
      audio.onended = audio.onerror = audio.onloadedmetadata = audio.ontimeupdate = audio.onpause = null;
      audio.pause(); try { audio.currentTime = 0; } catch (_) { /* Not loaded yet. */ }
    }
    if (previous) cursors.delete(previous);
    deferredSeek = null;
    updateProgress(); audio = null; playingName = ''; pendingName = ''; updateButtons();
    if (previous && current?.name === previous) renderInspector();
  }
  async function prepare(asset) {
    const existing = entries.get(asset.name);
    if (existing?.promise) return existing.promise;
    if (existing?.url) return existing;
    const entry = { ...asset };
    entry.promise = api('/api/sound_play?name=' + encodeURIComponent(asset.name)).then(result => {
      Object.assign(entry, result); delete entry.promise;
      if (!entry.url) throw new Error('No preview is available for this sound.');
      remember(entries, asset.name, entry, 48);
      return entry;
    }).catch(error => { entries.delete(asset.name); throw error; });
    entries.set(asset.name, entry); return entry.promise;
  }
  async function decodeWave(name, entry) {
    if (waves.has(name)) return waves.get(name);
    if (entry.bytes > 64 * 1024 * 1024) throw new Error('This sound is too large to draw a waveform. Playback is still available.');
    const response = await fetch(entry.url);
    if (!response.ok) throw new Error('Could not read the waveform.');
    const data = await response.arrayBuffer();
    if (data.byteLength > 64 * 1024 * 1024) throw new Error('This sound is too large to draw a waveform.');
    const Context = window.AudioContext || window.webkitAudioContext;
    const context = new Context();
    try {
      const buffer = await context.decodeAudioData(data);
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      const wave = { peaks: waveformEnvelope(channels), seconds: buffer.duration, sample_rate: buffer.sampleRate, channels: buffer.numberOfChannels };
      Object.assign(entry, { seconds: entry.seconds ?? wave.seconds, preview_sample_rate: wave.sample_rate, channels: entry.channels ?? wave.channels });
      return remember(waves, name, wave, 32);
    } finally { await context.close(); }
  }
  async function play(name) {
    if (name && playingName === name && audio) {
      if (!audio.paused) {
        playToken++; audio.pause();
        if (animation) cancelAnimationFrame(animation);
        animation = 0; updateButtons(); updateProgress(); return;
      }
      if (durationOf(name) && positionOf(name) >= durationOf(name)) seekTo(name, 0);
      return startPlayback(audio, name, entries.get(name), ++playToken);
    }
    const same = pendingName === name;
    stop();
    if (!name || same) return;
    const serial = playToken;
    pendingName = name; updateButtons();
    const asset = catalog.find(item => item.name === name) || { name };
    try {
      const entry = await prepare(asset);
      if (serial !== playToken) return;
      const player = new Audio(entry.url); audio = player; playingName = name; pendingName = '';
      deferredSeek = cursors.get(name) || 0;
      updateButtons();
      player.volume = volume; player.loop = loop;
      player.onended = () => {
        if (audio !== player) return;
        if (animation) cancelAnimationFrame(animation);
        animation = 0; updateButtons(); updateProgress();
      };
      player.onerror = () => { if (audio === player) { stop(); onError?.('Could not play this sound.'); } };
      player.onloadedmetadata = () => {
        if (audio !== player) return;
        if (validDuration(player.duration)) {
          entry.seconds = player.duration;
          if (deferredSeek !== null) seekTo(name, deferredSeek);
        }
        updateTiles();
        if (current?.name === name) renderInspector();
      };
      player.ontimeupdate = () => { if (audio === player) updateProgress(); };
      player.onpause = () => { if (audio === player) { updateButtons(); updateProgress(); } };
      if (validDuration(player.duration)) seekTo(name, deferredSeek);
      await startPlayback(player, name, entry, serial);
    } catch (error) {
      if (serial !== playToken) return;
      stop(); onError?.(error.message);
      if (current?.name === name) { const entry = entries.get(name) || { name }; entry.error = error.message; entries.set(name, entry); renderInspector(); }
    }
  }
  async function startPlayback(player, name, entry, serial) {
    try {
      window.__tutorialMusic?.hushWhile(player);
      await player.play();
      if (serial !== playToken) { if (audio !== player) player.pause(); return; }
      updateButtons(); updateProgress();
      if (!animation) animation = requestAnimationFrame(animateProgress);
      if (current?.name === name) renderInspector();
      loadWave(name, entry);
    } catch (error) {
      if (serial !== playToken) return;
      stop(); onError?.(error.message);
    }
  }
  function loadWave(name, entry) {
    if (!entry || waves.has(name) || entry.wavePromise || entry.waveError) return;
    entry.wavePromise = decodeWave(name, entry).catch(error => { entry.waveError = error.message; }).finally(() => {
      delete entry.wavePromise;
      updateTiles(); if (current?.name === name) renderInspector();
    });
  }
  function wireSeek(track, name) {
    const move = event => {
      if (current?.name !== name) return;
      const bounds = track.getBoundingClientRect();
      if (bounds.width > 0) seekTo(name, (event.clientX - bounds.left) / bounds.width * (durationOf(name) || 0));
    };
    let pointer = null;
    track.onpointerdown = event => {
      if (event.button !== 0 || !durationOf(name)) return;
      event.preventDefault(); event.stopPropagation();
      pointer = event.pointerId; seeking = true; track.focus(); track.setPointerCapture(pointer); move(event);
    };
    track.onpointermove = event => { if (pointer === event.pointerId) { event.stopPropagation(); move(event); } };
    const finish = event => {
      if (pointer === null || pointer !== event.pointerId) return;
      const id = pointer; pointer = null; seeking = false;
      if (track.hasPointerCapture(id)) track.releasePointerCapture(id);
      if (refreshAfterSeek) { refreshAfterSeek = false; renderInspector(); inspector().querySelector('[data-sound-seek]')?.focus(); }
    };
    track.onpointerup = track.onpointercancel = track.onlostpointercapture = finish;
    track.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', ' '].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === ' ') { play(name); return; }
      const step = event.shiftKey ? 1 : .1;
      seekTo(name, event.key === 'Home' ? 0 : event.key === 'End' ? durationOf(name) : positionOf(name) + (event.key === 'ArrowLeft' ? -step : step));
    };
  }
  function renderInspector() {
    if (!current) return;
    if (seeking) { refreshAfterSeek = true; return; }
    const el = inspector(), entry = currentEntry() || current;
    const restoreSeekFocus = el.contains?.(document.activeElement) && document.activeElement?.matches?.('[data-sound-seek]');
    const row = (label, value) => `<dt>${label}</dt><dd>${esc(value ?? '—')}</dd>`;
    const format = entry.format || ({ 'audio/wav': 'WAV', 'audio/ogg': 'OGG', 'audio/mpeg': 'MP3' }[entry.type]) || 'Sound';
    const short = current.short || current.name.split('.').pop(), bytes = entry.bytes ?? (entry.kb != null ? entry.kb * 1024 : entry.size);
    const wav = waves.get(current.name), decoded = entry.url;
    el.innerHTML = `<div class="box sound-inspector" data-sound-inspector="${esc(current.name)}">
      <div class="sound-asset-head"><span>${speaker}</span><div><b>${esc(short)}</b><small>${current.own ? 'Imported sound' : 'Game sound'}</small></div></div>
      <div class="sound-inspector-wave" data-sound-seek role="slider" tabindex="0" aria-label="Preview position" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" title="Click or drag to choose the playback position. Left/Right: 0.1 s; Shift: 1 s; Home/End: start/end; Space: play/pause.">
        <div class="sound-time-ruler" aria-hidden="true"><span>0</span><span>${timeText(durationOf(current.name) ? durationOf(current.name) / 2 : null)}</span><span>${timeText(durationOf(current.name))}</span></div>
        <div class="sound-seek-wave">${waveHtml(current.name, false)}<span class="sound-wave-hint">${wav ? '' : entry.waveError ? esc(entry.waveError) : 'Reading waveform…'}</span></div><i class="sound-cursor" aria-hidden="true"></i></div>
      <div class="sound-preview-controls"><button type="button" data-splay="${esc(current.name)}" title="Play from cursor">${transportIcon('play')}</button><button type="button" data-sound-start title="Go to start" aria-label="Go to start">${transportIcon('start')}</button><span data-sound-time>${timeText(0)} / ${timeText(entry.seconds)}</span></div>
      <div class="sound-preview-options"><label>Preview volume<input type="range" data-sound-volume min="0" max="1" step=".05" value="${volume}" aria-label="Preview volume"></label><label><input type="checkbox" data-sound-loop ${loop ? 'checked' : ''}> Loop preview</label></div>
      <dl class="sound-metadata">${row('Length', timeText(entry.seconds))}${row('Format', format)}${row('Channels', entry.channels === 1 ? 'Mono' : entry.channels === 2 ? 'Stereo' : entry.channels)}${row(entry.sample_rate ? 'Sample rate' : entry.preview_sample_rate ? 'Preview rate' : 'Sample rate', (entry.sample_rate || entry.preview_sample_rate) ? ((entry.sample_rate || entry.preview_sample_rate) / 1000) + ' kHz' : null)}${row('Bit depth', entry.bits ? entry.bits + ' bit' : null)}${row('Size', Number.isFinite(bytes) && bytes > 0 ? (bytes / 1024).toFixed(1) + ' KB' : null)}${row('Package', current.name.split('.')[0])}${row('Source', entry.source || (current.own ? 'Imported file' : 'Installed game'))}</dl>
      <label class="sound-reference">Sound reference<input type="text" readonly value="${esc(current.name)}" aria-label="Sound reference"></label>
      ${current.own ? `<div class="sound-asset-actions">${decoded ? `<a class="ib" href="${esc(entry.url)}" download="${esc(short)}.wav">Download WAV</a>` : ''}<button type="button" data-sound-delete>Delete sound…</button></div>` : ''}
      <p class="hint sound-use-hint">Drag this tile into the scene or onto an object's sound field. Preview volume and looping only affect listening here.</p>
      ${selectionBusy ? '<p class="hint">Reading sound details…</p>' : entry.error ? `<p class="hint bad">${esc(entry.error)}</p>` : ''}</div>`;
    el.querySelector('[data-splay]').onclick = () => play(current.name);
    el.querySelector('[data-sound-volume]').oninput = event => { volume = +event.target.value; if (audio) audio.volume = volume; };
    el.querySelector('[data-sound-loop]').onchange = event => { loop = event.target.checked; if (audio) audio.loop = loop; };
    wireSeek(el.querySelector('[data-sound-seek]'), current.name);
    el.querySelector('[data-sound-start]').onclick = () => seekTo(current.name, 0);
    const remove = el.querySelector('[data-sound-delete]'); if (remove) remove.onclick = () => deleteSound?.(current.name);
    updateButtons();
    updateProgress();
    if (restoreSeekFocus) el.querySelector('[data-sound-seek]').focus({ preventScroll: true });
  }
  function selectAsset(asset) {
    if (current?.name === asset.name) { current = asset; renderInspector(); return; }
    onSelect?.();
    current = asset; const serial = ++token; selectionBusy = true;
    window.__workspace?.show('inspector'); renderInspector(); updateTiles();
    prepare(asset).then(entry => {
      if (serial !== token || current?.name !== asset.name) return;
      selectionBusy = false; renderInspector(); updateTiles();
      loadWave(asset.name, entry);
    }).catch(error => {
      if (serial !== token || current?.name !== asset.name) return;
      selectionBusy = false; entries.set(asset.name, { ...asset, error: error.message }); renderInspector();
    });
  }
  function clearSelection(redraw = true) {
    const had = !!current; current = null; selectionBusy = false; seeking = false; refreshAfterSeek = false; token++; stop(); cursors.clear(); updateTiles();
    if (had && redraw) onClear?.();
  }
  function wireTiles() {
    tiles.clear(); container.setAttribute('role', 'listbox'); container.setAttribute('aria-label', 'Sound assets');
    for (const tile of container.querySelectorAll('.sound-tile')) {
      const name = tile.dataset.snd; tiles.set(name, tile);
      const choose = () => { const asset = catalog.find(item => item.name === name); if (asset) selectAsset(asset); };
      tile.onclick = event => { if (!event.target.closest('button')) choose(); };
      tile.onkeydown = event => {
        if (event.target !== tile) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Enter' || current?.name !== name) choose();
          if (event.key === ' ') play(name);
        }
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          const visible = [...tiles.values()].filter(item => item.getClientRects().length), at = visible.indexOf(tile);
          const columns = Math.max(1, Math.floor(container.clientWidth / 104));
          const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns;
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, at + step));
          visible[next]?.focus();
        }
      };
      tile.querySelector('[data-splay]').onclick = event => { event.stopPropagation(); if (current?.name !== name) choose(); play(name); };
    }
    updateTiles();
  }
  function setCatalog(data, invalidateOwn = false) {
    catalog = data?.sounds || [];
    if (invalidateOwn) for (const [name, entry] of entries) if (entry.own) { entries.delete(name); waves.delete(name); }
    if (current) {
      const latest = catalog.find(item => item.name === current.name);
      if (!latest) clearSelection(); else current = latest;
    }
  }
  async function selectByName(name) {
    let asset = catalog.find(item => item.name === name);
    if (!asset && getCatalog) { setCatalog(await getCatalog()); asset = catalog.find(item => item.name === name); }
    if (asset) selectAsset(asset);
    return !!asset;
  }
  function getDragData(name) {
    const asset = catalog.find(item => item.name === name), entry = entries.get(name);
    if (!asset?.own || !entry?.url) return null;
    return { url: new URL(entry.url, location.href).href, filename: (asset.short || name.split('.').pop()) + '.wav' };
  }
  window.addEventListener('deusedix:map-state', () => clearSelection());
  return { tileHtml, wireTiles, setCatalog, selectByName, getDragData, play, stop, seek: seekTo, clearSelection, renderInspector, selection: () => current };
}
