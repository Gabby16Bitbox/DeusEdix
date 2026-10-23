// The editor's microphone: giving a line of the Story its own voice (story.js), and choosing the microphone
// (Settings > Microphone, or the gear next to Record). A take is recorded in the browser, cleaned (the silence
// before and after cut, its level raised to the game's), made mono 16 bit 44.1 kHz like the imported sounds,
// and handed back as a WAV; the server makes it a sound of the editor's package (editor/sounds.py dub), which
// the game plays from the speaker's mouth: the lips follow it (UCVoice.Dub, UCVoiceDriver).

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const RATE = 44100;

// ---------------------------------------------------------------- the microphone chosen
function micId() { try { return (window.__menubar && window.__menubar.prefs.mic) || JSON.parse(localStorage.getItem('deusedix.prefs') || '{}').mic || ''; } catch (e) { return ''; } }
function setMic(id) {
  if (window.__menubar && window.__menubar.setPref) { window.__menubar.setPref('mic', id); return; }
  try { const p = JSON.parse(localStorage.getItem('deusedix.prefs') || '{}'); p.mic = id; localStorage.setItem('deusedix.prefs', JSON.stringify(p)); } catch (e) { /* no storage */ }
}
async function inputs() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
}
async function openMic() {
  const base = { echoCancellation: false, noiseSuppression: true, autoGainControl: false, channelCount: 1 };
  const id = micId();
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: id ? Object.assign({ deviceId: { exact: id } }, base) : base });
  } catch (e) {
    if (id && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError'))     // that one is unplugged: the default
      return navigator.mediaDevices.getUserMedia({ audio: base });
    throw e;
  }
}
function micError(e) {
  if (!navigator.mediaDevices) return 'This window has no access to microphones.';
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return 'The microphone is not allowed: allow it for the editor (the question at the top of the window, or Windows Settings > Privacy > Microphone).';
  if (e && e.name === 'NotFoundError') return 'No microphone found: plug one in, then choose it in Settings > Microphone.';
  return 'The microphone did not start: ' + ((e && (e.message || e.name)) || e);
}
// a <select> of the microphones (Settings, the gear): Windows' default first; names show once allowed
async function fillMicSelect(sel) {
  let list = await inputs().catch(() => []);
  if (list.length && !list.some((d) => d.label)) {
    try { const s = await openMic(); s.getTracks().forEach((t) => t.stop()); list = await inputs(); } catch (e) { /* names stay hidden */ }
  }
  const cur = micId();
  sel.innerHTML = `<option value="">Windows' default microphone</option>` + list.map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === cur ? ' selected' : ''}>${esc(d.label || 'Microphone ' + (i + 1))}</option>`).join('');
  if (cur && !list.some((d) => d.deviceId === cur)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(cur)}" selected>(the one chosen before: not plugged in)</option>`);
  sel.onchange = () => setMic(sel.value);
  return list.length;
}
async function micName() {
  const id = micId(), list = await inputs().catch(() => []);
  const d = list.find((x) => x.deviceId === id);
  return id ? (d && d.label) || 'the microphone chosen' : 'Windows\' default microphone';
}

// ---------------------------------------------------------------- sound as the game wants it
function wavBlob(samples, rate = RATE) {            // mono, 16 bit
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true); }
  return new Blob([buf], { type: 'audio/wav' });
}
const dataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
async function monoOf(arrayBuffer) {               // any file the browser decodes -> one channel at 44.1 kHz
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(arrayBuffer);
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * RATE)), RATE);
    const src = off.createBufferSource();
    src.buffer = buf; src.connect(off.destination); src.start();
    return (await off.startRendering()).getChannelData(0);
  } finally { ctx.close(); }
}
// a voice take: the silence before and after cut (a little kept), quiet takes raised to the level of the game's voices
function clean(x) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak < 0.01) return null;                      // nothing was heard
  const gate = Math.max(0.015, peak * 0.06), pad = Math.round(0.12 * RATE);
  let a = 0, b = x.length - 1;
  while (a < x.length && Math.abs(x[a]) < gate) a++;
  while (b > a && Math.abs(x[b]) < gate) b--;
  const out = x.slice(Math.max(0, a - pad), Math.min(x.length, b + pad));
  const gain = Math.min(4, 0.89 / peak);
  if (gain > 1.05) for (let i = 0; i < out.length; i++) out[i] *= gain;
  const fade = Math.min(out.length >> 1, Math.round(0.01 * RATE));           // no click at the cuts
  for (let i = 0; i < fade; i++) { out[i] *= i / fade; out[out.length - 1 - i] *= i / fade; }
  return out;
}
async function fileToVoice(file) {
  const mono = await monoOf(await file.arrayBuffer());
  return { wav: await dataUrl(wavBlob(mono)), seconds: mono.length / RATE, source: file.name };
}

// ---------------------------------------------------------------- the recording window
const style = document.createElement('style');
style.textContent = `
#vrec { position:fixed; z-index:95; display:none; width:min(460px, calc(100vw - 24px)); padding:12px 14px; background:var(--panel); color:var(--text);
  border:1px solid var(--accent-border, var(--line)); border-radius:var(--radius-window, 8px); box-shadow:0 14px 40px rgba(0,0,0,.6); font-size:13px; }
#vrec.open { display:block; }
#vrec .vr-head { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
#vrec .vr-head b { flex:1; color:var(--heading, var(--text)); }
#vrec .vr-text { background:var(--field); border-radius:var(--radius-row, 4px); padding:8px 10px; margin:4px 0 8px; font-size:15px; line-height:1.45; max-height:150px; overflow:auto; }
#vrec .vr-mic { display:flex; align-items:center; gap:6px; color:var(--dim); font-size:11px; margin-bottom:8px; }
#vrec .vr-mic select { flex:1; min-width:0; }
#vrec .vr-meter { height:8px; border-radius:4px; background:var(--field); overflow:hidden; margin:6px 0; }
#vrec .vr-meter i { display:block; height:100%; width:0; background:var(--ok, #6bd68a); transition:width .05s linear; }
#vrec .vr-row { display:flex; align-items:center; gap:6px; margin-top:8px; }
#vrec .vr-row .grow { flex:1; }
#vrec .vr-rec { color:#ff6b6b; font-weight:600; }
#vrec .vr-time { font-variant-numeric:tabular-nums; color:var(--dim); }
#vrec .vr-msg { color:var(--dim); font-size:12px; margin-top:6px; }
#vrec .vr-bad { color:#ff8a7a; }`;
document.head.appendChild(style);
const box = document.createElement('div');
box.id = 'vrec';
document.body.appendChild(box);

let session = null;          // { stream, rec, chunks, ctx, raf, t0, take, audio }
function stopAll() {
  if (!session) return;
  cancelAnimationFrame(session.raf);
  try { if (session.rec && session.rec.state !== 'inactive') session.rec.stop(); } catch (e) { /* stopped */ }
  if (session.stream) session.stream.getTracks().forEach((t) => t.stop());
  if (session.ctx) session.ctx.close().catch(() => {});
  if (session.audio) session.audio.pause();
  session = null;
}
function place(anchor) {
  box.classList.add('open');
  window.__tutorialMusic?.hush('voice', true);          // no music in the takes
  const r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2 - 230, bottom: innerHeight / 3 };
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  box.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - h - 8)) + 'px';
}
function close() { stopAll(); box.classList.remove('open'); window.__tutorialMusic?.hush('voice', false); }
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box.classList.contains('open')) { e.stopPropagation(); close(); } }, true);

// record({who, text, anchor}) -> Promise of {wav (data URL), seconds, source} or null (cancelled)
function record({ who, text, anchor }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
    const head = `<div class="vr-head"><b>Voice of ${esc(who || 'this line')}</b><button data-v="close" title="Close (Esc)">✕</button></div>
      <div class="vr-text">${esc(text || '')}</div>
      <div class="vr-mic">🎙 <select data-v="mic" title="The microphone (also in Settings > Microphone)"></select></div>`;
    const draw = (state, extra = '') => {
      if (state === 'ready') box.innerHTML = head + `<div class="vr-msg">Read the line as the character, as in a dubbing room: press Record, speak, then Stop. The silence before and after is cut by itself.</div>
        <div class="vr-row"><button data-v="rec" class="primary">● Record</button><span class="grow"></span><button data-v="close">Cancel</button></div>${extra}`;
      else if (state === 'rec') box.innerHTML = head + `<div class="vr-meter"><i></i></div>
        <div class="vr-row"><span class="vr-rec">● REC</span><span class="vr-time">0.0 s</span><span class="grow"></span><button data-v="stop" class="primary">■ Stop</button></div>`;
      else if (state === 'take') box.innerHTML = head + `<div class="vr-msg">The take: ${session.take.seconds.toFixed(1)} s.</div>
        <div class="vr-row"><button data-v="play">▶ Listen</button><button data-v="again">● Again</button><span class="grow"></span><button data-v="close">Cancel</button><button data-v="use" class="primary">Use this take</button></div>`;
      const sel = box.querySelector('[data-v="mic"]');
      if (sel) fillMicSelect(sel).catch(() => {});
      for (const b of box.querySelectorAll('button[data-v]')) b.onclick = () => act(b.dataset.v, b);
    };
    const start = async () => {
      stopAll();
      let stream;
      try { stream = await openMic(); } catch (e) { draw('ready', `<div class="vr-msg vr-bad">${esc(micError(e))}</div>`); return; }
      const ctx = new AudioContext(), an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      session = { stream, rec, chunks: [], ctx, t0: performance.now(), raf: 0 };
      rec.ondataavailable = (e) => { if (e.data && e.data.size) session && session.chunks.push(e.data); };
      rec.start(250);
      draw('rec');
      const data = new Float32Array(an.fftSize), bar = box.querySelector('.vr-meter i'), time = box.querySelector('.vr-time');
      const tick = () => {
        if (!session || session.rec !== rec) return;
        an.getFloatTimeDomainData(data);
        let pk = 0;
        for (const v of data) pk = Math.max(pk, Math.abs(v));
        if (bar) { bar.style.width = Math.min(100, pk * 110) + '%'; bar.style.background = pk > 0.97 ? '#ff6b6b' : ''; }
        if (time) time.textContent = ((performance.now() - session.t0) / 1000).toFixed(1) + ' s';
        if (performance.now() - session.t0 > 120000) { act('stop'); return; }           // two minutes at most
        session.raf = requestAnimationFrame(tick);
      };
      tick();
    };
    const act = async (what, btn) => {
      if (what === 'close') return finish(null);
      if (what === 'rec' || what === 'again') return start();
      if (what === 'stop' && session && session.rec) {
        const s = session, rec = s.rec;
        cancelAnimationFrame(s.raf);
        await new Promise((r) => { rec.onstop = r; rec.stop(); });
        s.stream.getTracks().forEach((t) => t.stop());
        s.ctx.close().catch(() => {});
        box.querySelector('.vr-row').innerHTML = '<span class="vr-msg">Cleaning the take...</span>';
        try {
          const mono = clean(await monoOf(await new Blob(s.chunks, { type: rec.mimeType || 'audio/webm' }).arrayBuffer()));
          if (!mono) { session = null; draw('ready', '<div class="vr-msg vr-bad">Nothing was heard: is the right microphone chosen? Speak closer, then Record again.</div>'); return; }
          session = { take: { mono, seconds: mono.length / RATE } };
          draw('take');
        } catch (e) { session = null; draw('ready', `<div class="vr-msg vr-bad">The take could not be read: ${esc(e.message || e)}</div>`); }
        return;
      }
      if (what === 'play' && session && session.take) {
        if (session.audio && !session.audio.paused) { session.audio.pause(); btn.textContent = '▶ Listen'; return; }
        session.audio = new Audio(URL.createObjectURL(wavBlob(session.take.mono)));
        session.audio.onended = () => { btn.textContent = '▶ Listen'; };
        btn.textContent = '■ Stop';
        session.audio.play();
        return;
      }
      if (what === 'use' && session && session.take) {
        const t = session.take;
        btn.disabled = true;
        finish({ wav: await dataUrl(wavBlob(t.mono)), seconds: t.seconds, source: 'microphone' });
      }
    };
    draw('ready');
    place(anchor);
  });
}

// the gear next to Record: only the microphone
async function chooseMic(anchor) {
  close();
  box.innerHTML = `<div class="vr-head"><b>Microphone</b><button data-v="close">✕</button></div>
    <div class="vr-mic">🎙 <select data-v="mic"></select></div>
    <div class="vr-msg">Kept for every recording (also in Settings > Microphone). Its name shows once the editor may use it.</div>`;
  box.querySelector('[data-v="close"]').onclick = close;
  place(anchor);
  await fillMicSelect(box.querySelector('[data-v="mic"]')).catch(() => {});
}

window.__voice = { record, chooseMic, fillMicSelect, fileToVoice, micName, close };
