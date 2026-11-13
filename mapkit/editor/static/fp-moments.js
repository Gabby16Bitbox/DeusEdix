// Tools > First-person moments (Gabby, 2 Nov 2026: "an animation of a weapon when you pick it up, press a key or walk
// into a collision"): the moments of the map, each made and seen here as the player sees it. A moment is clips of the
// weapon's own animations (any part of one, at any speed, backwards too), moves of the weapon in the view, sounds and a
// shake (fp-moment.js has its rules, editor/fpmoments.py writes it, UCViewMoment plays it); the Interactions play it
// ("JC's weapon plays a moment") when JC presses a key, uses a button, walks into a collision box, picks something up.
// The view: the weapon's first-person model (its class's PlayerViewMesh, read from the game) from the player's eye
// (its PlayerViewOffset scaled as DeusExWeapon.CalcDrawOffset does, seen with the player's field of view), playing the
// moment on its timeline.
// 13 Nov 2026 (Gabby: "improve the first person animator, things are missing"): the map's moments to choose, copy and
// delete; a timeline of tracks (clips, moves, sounds, shake) whose keys drag in time; the weapon dragged in the view
// makes the move at the playhead; eased moves; the shake seen on a floor round the eye; Space, Home/End, arrows, K;
// the player's field of view; a move to the right shown to the right (the game adds it after the hand's flip).
import * as THREE from 'three';
import { exportModel, framesFromGlb, base64 } from './fp-blender.js';
import { newMoment, clipOf, clipTimes, momentLength, offsetAt, keyNear, frameAt, soundsBetween, shakeAt, endJump, rulesPlaying,
  momentProblem, MOMENT_NAME, MAX_CLIPS, MAX_OFFSETS, MAX_SOUNDS, EASES } from './fp-moment.js';

// DeusExWeapon.CalcDrawOffset scales PlayerViewOffset by 0.9 / the player's default FOVAngle, never the one in use
const OFFSET_FOV = 75;
const SNAP = 0.05;
const PF_MASKED = 0x2, PF_TRANSLUCENT = 0x4;        // a mesh face's flags, as the game's PolyFlags                     // seconds a key dragged on the timeline snaps to (Shift: free)
const STYLE = `
.fpm { width:min(1180px, 96vw); max-height:94vh; overflow:auto; }
.fpm form { display:flex; flex-direction:column; gap:8px; min-height:0; }
.fpm .fpm-top { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.fpm .fpm-body { display:flex; flex-wrap:wrap; gap:8px; min-height:0; }
.fpm .fpm-left { flex:1 1 440px; min-width:0; display:flex; flex-direction:column; gap:6px; }
.fpm .fpm-view { position:relative; aspect-ratio:16/10; background:var(--viewport); border-radius:var(--radius-control); overflow:hidden; cursor:grab; }
.fpm .fpm-view.drag { cursor:grabbing; }
.fpm .fpm-view canvas { width:100%; height:100%; display:block; }
.fpm .fpm-note { position:absolute; inset:auto 8px 8px 8px; color:var(--text); font-size:11px; text-shadow:0 1px 2px #000; pointer-events:none; }
.fpm .fpm-right { flex:1 1 400px; min-width:0; overflow:auto; max-height:66vh; display:flex; flex-direction:column; gap:4px; }
.fpm .fpm-right .cat { margin-top:6px; }
.fpm .row { display:flex; flex-wrap:wrap; gap:4px; align-items:center; }
.fpm .fpm-right [data-k="seq"] { min-width:110px; }
.fpm input[type=number] { width:56px; }
.fpm .fpm-time { display:flex; gap:6px; align-items:center; }
.fpm .bad { color:var(--bad); }
.fpm .fpm-tracks { display:grid; grid-template-columns:58px 1fr; row-gap:3px; user-select:none; font-size:11px; }
.fpm .fpm-tracks .lab { opacity:.7; align-self:center; white-space:nowrap; }
.fpm .fpm-lane { position:relative; height:20px; border-radius:4px; background:rgba(127,127,127,.14); cursor:text; overflow:hidden; }
.fpm .fpm-lane.ruler { height:15px; background:transparent; }
.fpm .fpm-tick { position:absolute; top:0; bottom:0; padding-left:3px; font-size:10px; opacity:.55; pointer-events:none; }
.fpm .fpm-tick::before { content:''; position:absolute; left:0; top:2px; bottom:2px; width:1px; background:currentColor; opacity:.5; }
.fpm .fpm-clip { position:absolute; top:2px; bottom:2px; box-sizing:border-box; padding:0 4px; border-radius:3px; overflow:hidden; white-space:nowrap;
  text-overflow:ellipsis; line-height:15px; background:rgba(90,140,200,.45); border:1px solid rgba(120,170,230,.8); cursor:pointer; }
.fpm .fpm-clip.on { border-color:var(--accent, #ffd25a); }
.fpm .fpm-key { position:absolute; top:5px; width:9px; height:9px; margin-left:-5px; transform:rotate(45deg); background:#e0b84a; border:1px solid #0006; cursor:ew-resize; }
.fpm .fpm-key.linear { border-radius:0; transform:none; top:6px; width:8px; height:8px; margin-left:-4px; }
.fpm .fpm-snd { position:absolute; top:3px; bottom:3px; width:5px; margin-left:-3px; border-radius:2px; background:#7fc67f; cursor:ew-resize; }
.fpm .fpm-snd.none { background:#7fc67f55; }
.fpm .fpm-shk { position:absolute; top:5px; bottom:5px; border-radius:3px; background:rgba(210,120,90,.75); cursor:ew-resize; }
.fpm .fpm-head { position:absolute; top:0; bottom:0; width:2px; margin-left:-1px; background:var(--accent, #ffd25a); pointer-events:none; }
.fpm .fpm-end { position:absolute; top:0; bottom:0; right:0; background:rgba(0,0,0,.22); pointer-events:none; }
`;

export function createFpMoments({ api, edits, change, status, pickSound, playSound, weapons, escapeHtml, loadModel, fov = () => 75 }) {
  const esc = (s) => escapeHtml(String(s ?? ''));
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const infos = new Map();              // weapon class -> Promise {mesh, view}
  let dlg = null, st = null;

  // a weapon's first-person model and its place in the view, as its class has them in the game
  function infoOf(cls) {
    if (!infos.has(cls)) infos.set(cls, api('/api/class_props?cls=' + encodeURIComponent(cls.split('.').pop())).then((d) => {
      const prop = (n) => (d.props || []).find((p) => p.name.toLowerCase() === n.toLowerCase())?.default || '';
      const mesh = (/'([^']+)'/.exec(prop('PlayerViewMesh')) || [])[1] || '';
      const v = /X=([-\d.]+),Y=([-\d.]+),Z=([-\d.]+)/.exec(prop('PlayerViewOffset'));
      if (!mesh) throw new Error(`${cls} has no first-person model.`);
      return { mesh, view: v ? v.slice(1).map(Number) : [20, -10, -14] };
    }).catch((e) => { infos.delete(cls); throw e; }));
    return infos.get(cls);
  }

  const changed = () => !!st && JSON.stringify(st.m) !== st.saved;
  function close(force = false) {
    if (!dlg) return true;
    if (!force && changed() && !confirm('Close without saving the changes to this moment?')) return false;
    st?.stop?.();
    dlg.close(); dlg.remove();
    dlg = null; st = null;
    return true;
  }

  // open(name): the moment called so (none: a new one); done(name): called with its name once saved
  function open(name = '', done = null, copyOf = null) {
    if (dlg && !close()) return;
    const all = edits().fpmoments || {};
    const src = copyOf ? all[copyOf] : all[name];
    const m = src ? JSON.parse(JSON.stringify(src)) : newMoment();
    m.shake = Object.assign({ t: 0, secs: 0, roll: 200, vert: 4 }, m.shake || {});
    m.offsets = m.offsets || []; m.sounds = m.sounds || []; m.clips = m.clips || [];
    st = { name: copyOf ? '' : name, m, done, model: null, t: 0, playing: false, loading: '', saved: copyOf ? '' : JSON.stringify(m), frame: 0 };
    const suggested = copyOf ? freeName(copyOf + '_2') : name;
    dlg = document.createElement('dialog');
    dlg.className = 'map-dialog fpm';
    dlg.innerHTML = `<header><h2>First-person moment</h2></header>
      <form method="dialog" novalidate><div class="fpm-top">
        <select data-f="pick" title="The first-person moments of this map">${momentOptions()}</select>
        <button type="button" data-f="dup" title="A copy of this moment, to change">Duplicate</button>
        <button type="button" data-f="delete" title="Delete this moment from the map">Delete</button>
        <label>Name</label><input data-f="name" value="${esc(suggested)}" maxlength="41" placeholder="Inspect" style="width:130px">
        <label>Weapon</label><select data-f="weapon" style="flex:1;min-width:0"><option value="">(choose the weapon it is made for)</option>
          ${weapons().map((w) => `<option value="${esc(w.cls)}" ${w.cls === m.weapon ? 'selected' : ''}>${esc(w.label)}</option>`).join('')}</select>
      </div>
      <div class="hint" data-f="rules" style="margin:0"></div>
      <div class="fpm-body"><div class="fpm-left"><div class="fpm-view"><div class="fpm-note"></div></div>
        <div class="fpm-time"><button type="button" data-f="play" title="Play the moment (Space)">▶</button><span data-f="tl">0.00 s</span>
          <span class="hint" style="margin:0">Drag the weapon: the move at the playhead (wheel: nearer/farther). Space plays, ← → step, K a move.</span></div>
        <div class="fpm-tracks"></div>
        <div class="row"><span class="hint" style="margin:0">Blender</span><button type="button" data-f="export" disabled title="The weapon's first-person model at rest, to animate in Blender">Export the model (.glb)</button>
          <button type="button" data-f="import" disabled title="An animation of the exported model, made in Blender (.glb): a new animation of the weapon">Import an animation (.glb)…</button><input type="file" accept=".glb,.gltf" data-f="file" hidden></div>
        <div class="hint" style="margin:0">In the game: the weapon JC holds plays it when an Interaction says "JC's weapon plays a moment" (when JC presses a key, uses a button, walks into a collision box...). Only with this weapon in hand; firing, reloading or putting it away ends it.</div></div>
        <div class="fpm-right"></div></div>
      <p class="map-error" role="alert" data-f="err"></p>
      <footer><button type="button" data-f="cancel">Cancel</button><button type="submit" class="primary">Save</button></footer></form>`;
    document.body.appendChild(dlg);
    const $ = (f) => dlg.querySelector(`[data-f="${f}"]`);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dlg.addEventListener('keydown', keys);
    $('cancel').onclick = () => close();
    dlg.querySelector('form').onsubmit = (e) => { e.preventDefault(); save(); };
    $('weapon').onchange = (e) => chooseWeapon(e.target.value, true);
    $('pick').value = copyOf ? '' : name;
    $('pick').onchange = (e) => { const v = e.target.value; e.target.value = st.name; open(v, null); };
    $('dup').onclick = () => { if (st.name) open('', null, st.name); };
    $('delete').onclick = () => remove();
    $('play').onclick = () => togglePlay();
    $('export').onclick = () => exportGlb();
    $('import').onclick = () => $('file').click();
    $('file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importGlb(f); };
    dlg.showModal();
    startView();
    renderLists();
    if (m.weapon) chooseWeapon(m.weapon, false);
  }
  function momentOptions() {
    const names = Object.keys(edits().fpmoments || {}).sort();
    return `<option value="">New moment</option>${names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}`;
  }
  function freeName(base) {
    const all = edits().fpmoments || {};
    let n = base.replace(/[^A-Za-z0-9_]/g, '').slice(0, 38) || 'Moment', k = 2;
    while (all[n]) n = `${base.replace(/_\d+$/, '').slice(0, 36)}_${k++}`;
    return n;
  }
  // the rules that play it: what the top says, and what deleting it leaves behind
  function rulesNote() {
    const el = dlg?.querySelector('[data-f="rules"]');
    if (!el) return;
    const n = st.name ? rulesPlaying(edits(), st.name).length : 0;
    el.textContent = !st.name ? 'A new moment: once saved, an Interaction plays it ("JC\'s weapon plays a moment").'
      : n ? `Played by ${n} rule${n > 1 ? 's' : ''} of this map.` : 'No rule of this map plays it yet: an Interaction "JC\'s weapon plays a moment" does.';
    dlg.querySelector('[data-f="delete"]').disabled = !st.name;
    dlg.querySelector('[data-f="dup"]').disabled = !st.name;
  }
  function remove() {
    const name = st.name;
    if (!name) return;
    const n = rulesPlaying(edits(), name).length;
    if (!confirm(n ? `Delete the moment ${name}? ${n} rule${n > 1 ? 's play' : ' plays'} it: they will play nothing until you choose another.` : `Delete the moment ${name}?`)) return;
    change(`Delete first-person moment ${name}`, (e) => { if (e.fpmoments) delete e.fpmoments[name]; });
    status(`First-person moment ${name} deleted${n ? `: ${n} rule${n > 1 ? 's' : ''} still name it (Logic shows ${n > 1 ? 'them' : 'it'})` : ''}.`, n ? 'warn' : 'ok');
    close(true);
  }

  async function chooseWeapon(cls, fresh) {
    st.m.weapon = cls;
    st.model = null; st.loading = cls ? 'Reading the weapon from the game…' : 'Choose the weapon it is made for.';
    renderLists(); note();
    if (!cls) return;
    const mine = st;
    try {
      const info = await infoOf(cls);
      const model = await loadModel(info.mesh);
      if (st !== mine) return;
      const opened = JSON.stringify(st.m) === st.saved;
      st.m.mesh = info.mesh; st.m.view = info.view; st.model = model; st.loading = '';
      if (fresh || !st.m.clips.length) Object.assign(st.m, { clips: newMoment(cls, info.mesh, info.view, model.seqs).clips });
      if (opened) st.saved = JSON.stringify(st.m);        // read from the game, not a change of the user's
      buildModel();
    } catch (e) {
      if (st === mine) st.loading = e.message || String(e);
    }
    if (st === mine) { renderLists(); note(); }
  }
  const seqsOf = () => (st.model ? st.model.seqs.filter((s) => !/^all$/i.test(s.name)) : []);
  const seqNamed = (n) => seqsOf().find((s) => s.name === n);

  // ---------------------------------------------------------------- the lists: clips, moves, sounds, shake
  function renderLists() {
    if (!dlg) return;
    const m = st.m, seqs = seqsOf(), host = dlg.querySelector('.fpm-right'), keep = host.scrollTop;
    const n = (k, v, step = 0.1, min = '', max = '') => `<input type="number" data-k="${k}" value="${+(+v || 0).toFixed(3)}" step="${step}"${min !== '' ? ` min="${min}"` : ''}${max !== '' ? ` max="${max}"` : ''}>`;
    let h = '<div class="cat">Clips of its animations, one after another</div>';
    m.clips.forEach((c, i) => {
      const s = seqNamed(c.seq), last = s ? Math.max(0, (s.frames ?? s.count ?? 1) - 1) : Math.max(0, (c.frames || 1) - 1);
      h += `<div class="row" data-clip="${i}"><select data-k="seq" style="flex:1;min-width:0">${seqs.map((x) => `<option ${x.name === c.seq ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}${s ? '' : `<option selected>${esc(c.seq)}</option>`}</select>
        <span class="hint" style="margin:0">frames</span>${n('from', c.from, 1, 0, last)}<span>→</span>${n('to', c.to, 1, 0, last)}
        <span class="hint" style="margin:0">in</span>${n('secs', c.secs, 0.05, 0.01)}<span>s</span>
        <button type="button" data-a="flip" title="Backwards (swap from and to)">⇄</button><button type="button" data-a="up" title="Earlier">▲</button><button type="button" data-a="del" title="Remove">✕</button></div>`;
    });
    h += `<div class="row"><button type="button" data-add="clip" ${!seqs.length || m.clips.length >= MAX_CLIPS ? 'disabled' : ''}>+ Clip</button><span class="hint" style="margin:0">frames to before from: it plays backwards</span></div>`;
    h += '<div class="cat">Moves of the weapon in the view (added to its place)</div>';
    m.offsets.forEach((o, i) => {
      h += `<div class="row" data-off="${i}"><span class="hint" style="margin:0">at</span>${n('t', o.t, 0.05, 0)}<span>s</span>
        <span class="hint" style="margin:0" title="Away from the eye">fwd</span>${n('x', o.x, 0.5)}<span class="hint" style="margin:0">right</span>${n('y', o.y, 0.5)}<span class="hint" style="margin:0">up</span>${n('z', o.z, 0.5)}
        <select data-k="ease" title="How it gets there from the move before (the game makes a smooth way of a few straight steps)">${EASES.map(([k, l]) => `<option value="${k}" ${(o.ease || 'linear') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button type="button" data-a="del" title="Remove">✕</button></div>`;
    });
    const jump = endJump(m);
    h += `<div class="row"><button type="button" data-add="off" ${m.offsets.length >= MAX_OFFSETS ? 'disabled' : ''} title="A move at the playhead, where the weapon is now (K); then drag the weapon in the view">+ Move at the playhead</button>
      ${jump ? `<button type="button" data-add="back" ${m.offsets.length >= MAX_OFFSETS ? 'disabled' : ''} title="A move back to 0 0 0, a third of a second after the last">+ Bring it back</button>` : ''}</div>
      ${jump ? `<div class="hint bad" style="margin:0">${esc(jump)}</div>` : ''}`;
    h += '<div class="cat">Sounds</div>';
    m.sounds.forEach((s, i) => {
      h += `<div class="row" data-snd="${i}"><span class="hint" style="margin:0">at</span>${n('t', s.t, 0.05, 0)}<span>s</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.sound)}">${esc(s.sound ? s.sound.split('.').slice(1).join(' · ') : '(no sound)')}</span>
        <button type="button" data-a="pick">Choose…</button><button type="button" data-a="hear" ${s.sound ? '' : 'disabled'} title="Hear it">♪</button><button type="button" data-a="del" title="Remove">✕</button></div>`;
    });
    h += `<div class="row"><button type="button" data-add="snd" ${m.sounds.length >= MAX_SOUNDS ? 'disabled' : ''}>+ Sound at the playhead</button></div>`;
    h += `<div class="cat">Shake of the view</div><div class="row" data-shake><span class="hint" style="margin:0">at</span>${n('t', m.shake.t, 0.05, 0)}<span>s for</span>${n('secs', m.shake.secs, 0.05, 0, 10)}<span>s</span>
      <span class="hint" style="margin:0">roll</span>${n('roll', m.shake.roll, 50, 0)}<span class="hint" style="margin:0">up/down</span>${n('vert', m.shake.vert, 1, 0)}</div>
      <div class="row">${+m.shake.secs > 0 ? '' : '<button type="button" data-add="shake" title="A short shake at the playhead">+ Shake at the playhead</button>'}<span class="hint" style="margin:0">${+m.shake.secs > 0 ? 'The view shows it on the floor round the eye: in the game the world shakes, the weapon stays.' : '0 s: none.'}</span></div>`;
    host.innerHTML = h;
    host.scrollTop = keep;
    const num = (el) => +el.value || 0;
    for (const row of host.querySelectorAll('[data-clip]')) {
      const c = m.clips[+row.dataset.clip];
      row.querySelector('[data-k="seq"]').onchange = (e) => { const s = seqNamed(e.target.value); if (s) Object.assign(c, clipOf(s)); renderLists(); };
      for (const k of ['from', 'to', 'secs']) row.querySelector(`[data-k="${k}"]`).onchange = (e) => { c[k] = k === 'secs' ? Math.max(0.01, num(e.target)) : Math.max(0, Math.round(num(e.target))); renderLists(); };
      row.querySelector('[data-a="flip"]').onclick = () => { [c.from, c.to] = [c.to, c.from]; renderLists(); };
      row.querySelector('[data-a="up"]').onclick = () => { const i = +row.dataset.clip; if (i > 0) [m.clips[i - 1], m.clips[i]] = [m.clips[i], m.clips[i - 1]]; renderLists(); };
      row.querySelector('[data-a="del"]').onclick = () => { m.clips.splice(+row.dataset.clip, 1); renderLists(); };
    }
    for (const row of host.querySelectorAll('[data-off]')) {
      const o = m.offsets[+row.dataset.off];
      for (const k of ['t', 'x', 'y', 'z']) row.querySelector(`[data-k="${k}"]`).onchange = (e) => { o[k] = k === 't' ? Math.max(0, num(e.target)) : num(e.target); sortKeys(); renderLists(); };
      row.querySelector('[data-k="ease"]').onchange = (e) => { o.ease = e.target.value; renderLists(); };
      row.querySelector('[data-a="del"]').onclick = () => { m.offsets.splice(+row.dataset.off, 1); renderLists(); };
    }
    for (const row of host.querySelectorAll('[data-snd]')) {
      const s = m.sounds[+row.dataset.snd];
      row.querySelector('[data-k="t"]').onchange = (e) => { s.t = Math.max(0, num(e.target)); renderLists(); };
      row.querySelector('[data-a="pick"]').onclick = () => pickSound(s.sound || '', (picked) => { if (picked && st?.m === m) { s.sound = picked; renderLists(); } });
      row.querySelector('[data-a="hear"]').onclick = () => { if (s.sound) playSound(s.sound); };
      row.querySelector('[data-a="del"]').onclick = () => { m.sounds.splice(+row.dataset.snd, 1); renderLists(); };
    }
    const shake = host.querySelector('[data-shake]');
    for (const k of ['t', 'secs', 'roll', 'vert']) shake.querySelector(`[data-k="${k}"]`).onchange = (e) => { m.shake[k] = Math.max(0, num(e.target)); renderLists(); };
    host.querySelector('[data-add="clip"]').onclick = () => { const s = seqNamed(m.clips.at(-1)?.seq) || seqs[0]; if (s) m.clips.push(clipOf(s)); renderLists(); };
    host.querySelector('[data-add="off"]').onclick = () => { keyAtPlayhead(); renderLists(); };
    const back = host.querySelector('[data-add="back"]');
    if (back) back.onclick = () => { const last = Math.max(0, ...m.offsets.map((o) => +o.t || 0)); m.offsets.push({ t: +(last + 0.3).toFixed(2), x: 0, y: 0, z: 0, ease: 'smooth' }); sortKeys(); renderLists(); };
    host.querySelector('[data-add="snd"]').onclick = () => { m.sounds.push({ t: +st.t.toFixed(2), sound: '' }); renderLists(); };
    const addShake = host.querySelector('[data-add="shake"]');
    if (addShake) addShake.onclick = () => { Object.assign(m.shake, { t: +st.t.toFixed(2), secs: 0.4 }); renderLists(); };
    dlg.querySelector('[data-f="err"]').textContent = st.model ? momentProblem(m, seqs.map((s) => s.name)) : '';
    rulesNote();
    renderTracks();
    showTime();
  }
  const sortKeys = () => st.m.offsets.sort((a, b) => (+a.t || 0) - (+b.t || 0));
  // the move at the playhead (made where the weapon is now, if there is none): the key the view's drag and K change
  function keyAtPlayhead() {
    const m = st.m;
    let i = keyNear(m.offsets, st.t);
    if (i < 0) {
      if (m.offsets.length >= MAX_OFFSETS) { status(`At most ${MAX_OFFSETS} moves.`, 'warn'); return null; }
      const [x, y, z] = offsetAt(m.offsets, st.t), r = (v) => Math.round(v * 100) / 100;
      m.offsets.push({ t: +st.t.toFixed(2), x: r(x), y: r(y), z: r(z), ease: 'smooth' });
      sortKeys();
      i = keyNear(m.offsets, st.t);
    }
    return m.offsets[i];
  }

  // ---------------------------------------------------------------- the timeline: tracks of clips, moves, sounds, shake
  // Its span: the moment's length and a little more, so a key can be dragged past the end; it stays put while a key is
  // dragged (st.span), then follows the moment.
  const span = () => st.span || Math.max(1, momentLength(st.m) * 1.2 + 0.2);
  const pct = (t) => `${(100 * t / span()).toFixed(3)}%`;
  function renderTracks() {
    const host = dlg?.querySelector('.fpm-tracks');
    if (!host) return;
    const m = st.m, L = span(), len = momentLength(m), step = L > 8 ? 2 : L > 3 ? 1 : 0.5;
    let ticks = '';
    for (let t = 0; t <= L + 1e-6; t += step) ticks += `<span class="fpm-tick" style="left:${pct(t)}">${+t.toFixed(1)}</span>`;
    const end = `<span class="fpm-end" style="left:${pct(len)}"></span>`, head = '<span class="fpm-head"></span>';
    const times = clipTimes(m), at = frameAt(m, st.t)?.clip;
    const clips = m.clips.map((c, i) => `<span class="fpm-clip ${i === at ? 'on' : ''}" data-tclip="${i}" style="left:${pct(times[i].start)};width:${pct(times[i].secs)}" title="${esc(c.seq)} ${c.from}→${c.to} in ${c.secs} s (click: go to it)">${esc(c.seq)}</span>`).join('');
    const keys = m.offsets.map((o, i) => `<span class="fpm-key ${(o.ease || 'linear') === 'linear' ? 'linear' : ''}" data-tkey="${i}" style="left:${pct(+o.t || 0)}" title="Move at ${(+o.t || 0).toFixed(2)} s: ${o.x || 0} ${o.y || 0} ${o.z || 0} (drag: when; right-click: remove)"></span>`).join('');
    const snds = m.sounds.map((s, i) => `<span class="fpm-snd ${s.sound ? '' : 'none'}" data-tsnd="${i}" style="left:${pct(+s.t || 0)}" title="${esc(s.sound || '(no sound)')} at ${(+s.t || 0).toFixed(2)} s (drag: when; right-click: remove)"></span>`).join('');
    const shk = +m.shake.secs > 0 ? `<span class="fpm-shk" data-tshk style="left:${pct(+m.shake.t || 0)};width:${pct(+m.shake.secs)}" title="Shake ${m.shake.secs} s (drag: when)"></span>` : '';
    host.innerHTML = `<span></span><div class="fpm-lane ruler" data-lane>${ticks}${head}</div>
      <span class="lab">Clips</span><div class="fpm-lane" data-lane>${end}${clips}${head}</div>
      <span class="lab">Moves</span><div class="fpm-lane" data-lane>${end}${keys}${head}</div>
      <span class="lab">Sounds</span><div class="fpm-lane" data-lane>${end}${snds}${head}</div>
      <span class="lab">Shake</span><div class="fpm-lane" data-lane>${end}${shk}${head}</div>`;
    for (const lane of host.querySelectorAll('[data-lane]')) lane.onpointerdown = (e) => trackDown(e, lane);
    for (const el of host.querySelectorAll('[data-tkey],[data-tsnd]')) el.oncontextmenu = (e) => {
      e.preventDefault();
      if (el.dataset.tkey !== undefined) m.offsets.splice(+el.dataset.tkey, 1); else m.sounds.splice(+el.dataset.tsnd, 1);
      renderLists();
    };
    showHead();
  }
  function timeOf(e, lane) {
    const r = lane.getBoundingClientRect();
    return Math.max(0, Math.min(span(), ((e.clientX - r.left) / Math.max(1, r.width)) * span()));
  }
  // a press on the timeline: on a key, a sound or the shake, it moves it in time; on a clip, the playhead goes to it;
  // elsewhere the playhead follows the pointer
  function trackDown(e, lane) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.target.closest('[data-tkey],[data-tsnd],[data-tshk],[data-tclip]'), m = st.m;
    st.playing = false;
    st.span = span();
    let item = null, field = 't';
    if (el?.dataset.tkey !== undefined) item = m.offsets[+el.dataset.tkey];
    else if (el?.dataset.tsnd !== undefined) item = m.sounds[+el.dataset.tsnd];
    else if (el?.dataset.tshk !== undefined) item = m.shake;
    else if (el?.dataset.tclip !== undefined) { st.t = clipTimes(m)[+el.dataset.tclip].start; st.span = null; showTime(); return; }
    const grab = item ? timeOf(e, lane) - (+item[field] || 0) : 0;
    const move = (ev) => {
      let t = timeOf(ev, lane) - grab;
      if (!ev.shiftKey) t = Math.round(t / SNAP) * SNAP;
      t = Math.max(0, +t.toFixed(3));
      if (item) { item[field] = t; if (el) el.style.left = pct(t); st.t = t; }
      else st.t = Math.min(t, momentLength(m));
      showTime();
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      st.span = null;
      if (item) { if (item !== m.shake && m.offsets.includes(item)) sortKeys(); if (m.sounds.includes(item)) m.sounds.sort((a, b) => (+a.t || 0) - (+b.t || 0)); renderLists(); }
      else renderTracks();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    move(e);
  }
  function showHead() {
    if (!dlg) return;
    for (const h of dlg.querySelectorAll('.fpm-head')) h.style.left = pct(st.t);
    const at = frameAt(st.m, st.t)?.clip;
    for (const c of dlg.querySelectorAll('[data-tclip]')) c.classList.toggle('on', +c.dataset.tclip === at);
  }

  // ---------------------------------------------------------------- playing, keys
  function togglePlay() {
    st.playing = !st.playing;
    if (st.playing && st.t >= momentLength(st.m) - 1e-3) st.t = 0;
    st.from = st.playing && st.t === 0 ? -1 : st.t;          // a sound at 0 s plays too
    showTime();
  }
  function seek(t) { st.playing = false; st.t = Math.max(0, Math.min(momentLength(st.m), t)); showTime(); }
  function keys(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'Home') { e.preventDefault(); seek(0); }
    else if (e.key === 'End') { e.preventDefault(); seek(momentLength(st.m)); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(st.t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.5 : 1 / 30)); }
    else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); if (keyAtPlayhead()) renderLists(); }
  }

  // ---------------------------------------------------------------- the view: the model from the player's eye
  function startView() {
    const host = dlg.querySelector('.fpm-view');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1b1f24);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404048, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(-1, 2, 1.5);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(60, 1, 1, 5000);
    const group = new THREE.Group();
    scene.add(group);
    // a floor round the eye (JC's eye is about 40 units over his feet), to see the view shake: in the game the world
    // shakes, the weapon stays where it is on the screen
    const world = new THREE.Group(), grid = new THREE.GridHelper(1600, 40, 0x56606c, 0x343b44);
    grid.position.y = -40;
    world.add(grid);
    scene.add(world);
    st.view = { renderer, scene, camera, group, world, parts: [] };
    const resize = () => {
      const w = host.clientWidth || 600, h = host.clientHeight || 375;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    viewDrag(renderer.domElement, host);
    let last = performance.now(), raf = 0;
    const tick = (now) => {
      if (!st || !dlg) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      st.frame++;
      if (st.playing) {
        const len = momentLength(st.m), t0 = st.from ?? st.t;
        st.t = Math.min(len, st.t + dt);
        st.from = st.t;
        for (const s of soundsBetween(st.m, t0, st.t)) playSound(s.sound);
        if (st.t >= len) st.playing = false;
        showTime();
      }
      pose();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    st.stop = () => { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); for (const p of st?.view?.parts || []) p.geometry.dispose(); };
  }
  // Drag the weapon in the view: the move at the playhead (made if there is none) follows the pointer, right and up;
  // the wheel takes it nearer or farther. Shift: finer.
  function viewDrag(canvas, host) {
    const PER_PIXEL = 0.06;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !st?.model) return;
      e.preventDefault();
      st.playing = false;
      const key = keyAtPlayhead();
      if (!key) return;
      const x0 = e.clientX, y0 = e.clientY, start = { y: +key.y || 0, z: +key.z || 0 };
      host.classList.add('drag');
      canvas.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const k = PER_PIXEL * (ev.shiftKey ? 0.25 : 1);
        key.y = Math.round((start.y + (ev.clientX - x0) * k) * 100) / 100;
        key.z = Math.round((start.z - (ev.clientY - y0) * k) * 100) / 100;
        renderTracks();
      };
      const up = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); host.classList.remove('drag'); renderLists(); };
      canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
      renderTracks();
    });
    canvas.addEventListener('wheel', (e) => {
      if (!st?.model) return;
      e.preventDefault();
      st.playing = false;
      const key = keyAtPlayhead();
      if (!key) return;
      key.x = Math.round(((+key.x || 0) - Math.sign(e.deltaY) * (e.shiftKey ? 0.25 : 1)) * 100) / 100;
      clearTimeout(st.wheelDone);
      st.wheelDone = setTimeout(() => renderLists(), 250);
      renderTracks();
    }, { passive: false });
  }
  function buildModel() {
    const { group } = st.view, m = st.model;
    for (const p of st.view.parts) { group.remove(p); p.geometry.dispose(); }
    st.view.parts = [];
    const bySlot = new Map(), flagsOf = new Map(), nf = m.faces.length / 4;
    for (let f = 0; f < nf; f++) {
      const [slot, flags] = m.info.mats[m.faces[f * 4 + 3]] || [0, 0];
      if (!bySlot.has(slot)) { bySlot.set(slot, []); flagsOf.set(slot, flags || 0); }
      bySlot.get(slot).push(f);
    }
    for (const [slot, faces] of bySlot) {
      const g = new THREE.BufferGeometry(), uv = new Float32Array(faces.length * 6);
      let o = 0;
      for (const f of faces) for (let j = 0; j < 3; j++) { const w = m.faces[f * 4 + j]; uv[o++] = m.uvs[2 * w]; uv[o++] = m.uvs[2 * w + 1]; }
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(faces.length * 9), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      // a translucent part adds its light (the muzzle flash: BlackMaskTex until the weapon fires, so nothing shows); a
      // masked one has holes
      const t = m.info.skins?.[slot] || m.info.tex?.[slot], url = t && String(t).startsWith('/') ? t : '', flags = flagsOf.get(slot);
      const glow = !!(flags & PF_TRANSLUCENT), masked = !!(flags & PF_MASKED);
      const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, color: url ? 0xffffff : glow ? 0x000000 : 0x9aa0a8 });
      if (glow) Object.assign(material, { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
      if (masked) material.alphaTest = 0.5;
      if (url) { const tex = new THREE.TextureLoader().load(url); tex.colorSpace = THREE.SRGBColorSpace; material.map = tex; }
      const mesh = new THREE.Mesh(g, material);
      mesh.userData.faces = faces;
      group.add(mesh); st.view.parts.push(mesh);
    }
  }
  // The model at the playhead: its frame (between two), and the eye where the game puts it. The class's
  // PlayerViewOffset.Y is flipped by the player's hand (Weapon.SetHand: Y x Hand, the default hand -1); the moment's
  // moves are added after that (UCViewMoment: SavedOffset + OffV), so a move to the right goes right.
  function pose() {
    const v = st.view, m = st.model;
    const o = st.m.view || [20, -10, -14], d = offsetAt(st.m.offsets, st.t), k = 0.9 / OFFSET_FOV * 100;
    const ox = o[0] + d[0], right = -o[1] + d[1], oz = o[2] + d[2];
    const eye = new THREE.Vector3(-k * ox, -k * oz, -k * right);          // three: x forward, y up, z right
    const playerFov = Math.max(60, Math.min(130, +fov() || 75));
    v.camera.fov = 2 * Math.atan(Math.tan(playerFov * Math.PI / 360) / v.camera.aspect) * 180 / Math.PI;
    v.camera.position.copy(eye);
    v.camera.lookAt(eye.x + 1, eye.y, eye.z);
    v.camera.updateProjectionMatrix();
    // the shake: the world turns and bobs round the eye
    const sh = shakeAt(st.m, st.t, st.frame);
    v.world.position.set(eye.x, eye.y + sh.up, eye.z);
    v.world.rotation.set(sh.roll * Math.PI / 180, 0, 0);
    if (!m || !v.parts.length) return;
    const at = frameAt(st.m, st.t), s = at && seqNamed(at.seq);
    let f0 = 0, f1 = 0, u = 0;
    if (s) {
      const n = Math.max(1, s.frames ?? s.count ?? 1), x = Math.min(n - 1, Math.max(0, at.frame));
      f0 = s.start + Math.floor(x); f1 = s.start + Math.min(n - 1, Math.floor(x) + 1); u = x - Math.floor(x);
    } else {
      const still = m.seqs.find((q) => /^still$/i.test(q.name));
      f0 = f1 = still ? still.start : 0;
    }
    const A = m.pos.subarray(f0 * m.FV * 3, (f0 + 1) * m.FV * 3), B = m.pos.subarray(f1 * m.FV * 3, (f1 + 1) * m.FV * 3);
    for (const mesh of v.parts) {
      const a = mesh.geometry.attributes.position.array;
      let p = 0;
      for (const face of mesh.userData.faces) for (let j = 0; j < 3; j++) {
        const i = m.wedges[m.faces[face * 4 + j]] * 3;
        a[p++] = A[i] + (B[i] - A[i]) * u; a[p++] = A[i + 1] + (B[i + 1] - A[i + 1]) * u; a[p++] = A[i + 2] + (B[i + 2] - A[i + 2]) * u;
      }
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
    }
  }
  function showTime() {
    if (!dlg) return;
    dlg.querySelector('[data-f="tl"]').textContent = `${st.t.toFixed(2)} / ${momentLength(st.m).toFixed(2)} s`;
    dlg.querySelector('[data-f="play"]').textContent = st.playing ? '❚❚' : '▶';
    showHead();
  }
  function note() {
    const el = dlg?.querySelector('.fpm-note');
    if (el) el.textContent = st.loading || (st.model ? `${st.m.mesh} · as the player sees it (field of view ${Math.round(+fov() || 75)})` : '');
    for (const k of ['export', 'import']) { const b = dlg?.querySelector(`[data-f="${k}"]`); if (b) b.disabled = !st.model || !!st.busy; }
  }

  // ---------------------------------------------------------------- Blender (fp-blender.js)
  async function exportGlb() {
    if (!st.model) return;
    try {
      const buf = await exportModel(THREE, st.model, st.m.mesh.split('.').pop());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
      a.download = `${st.m.mesh.split('.').pop()}_FirstPerson.glb`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      status(`${a.download}: animate it in Blender (keep its points where they are in edit mode), export it as .glb with its animation, then Import an animation.`, 'ok');
    } catch (e) { status('Export: ' + (e.message || e), 'bad'); }
  }
  async function importGlb(file) {
    const mine = st, mesh = st.m.mesh;
    const name = (prompt('Name of the new animation of this weapon (letters, digits, _):', file.name.replace(/\.(glb|gltf)$/i, '').replace(/\W/g, '_').slice(0, 24)) || '').trim();
    if (!name) return;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,24}$/.test(name)) { status('Use a name of letters, digits and _, starting with a letter.', 'warn'); return; }
    const rate = Math.max(5, Math.min(60, +(prompt('Frames a second (the game plays the model frame by frame: 30 is smooth):', '30') || 30)));
    st.busy = true; st.loading = 'Reading the animation…'; note();
    try {
      const got = await framesFromGlb(THREE, await file.arrayBuffer(), st.model, rate);
      st.loading = `Saving ${got.frames} frames as FP_${name}…`; note();
      await api('/api/studio_bake', { mesh, name: 'FP_' + name, frames: got.frames, rate: got.rate, data: base64(new Uint8Array(got.data.buffer)), props: [], group: 'FirstPerson' });
      st.loading = 'Making the weapon\'s model with its new animations (DeusEdixAnims)…'; note();
      const packed = await api('/api/studio_pack', {});
      if (packed && packed.ok === false) throw new Error((packed.lines || []).slice(-3).join(' ') || 'The models could not be made.');
      const model = await loadModel(mesh);
      if (st !== mine) return;
      st.model = model; buildModel();
      const seq = model.seqs.find((q) => q.name === 'FP_' + name);
      if (seq) st.m.clips.push(clipOf(seq));
      status(`FP_${name}: a new animation of ${mesh} (${got.frames} frames), its clip added. In the game the moment wears the copy of the model with it.`, 'ok');
    } catch (e) {
      status('Import: ' + (e.message || e), 'bad');
    } finally {
      if (st === mine) { st.busy = false; st.loading = ''; renderLists(); note(); }
    }
  }

  function save() {
    const name = dlg.querySelector('[data-f="name"]').value.trim(), err = dlg.querySelector('[data-f="err"]');
    if (!MOMENT_NAME.test(name)) { err.textContent = 'A name of letters, digits and _, starting with a letter (Inspect, RaiseGun_2).'; return; }
    if (!st.m.weapon) { err.textContent = 'Choose the weapon it is made for.'; return; }
    const problem = st.model ? momentProblem(st.m, seqsOf().map((s) => s.name)) : momentProblem(st.m);
    if (problem) { err.textContent = problem; return; }
    const all = edits().fpmoments || {};
    if (name !== st.name && all[name] && !confirm(`There is a moment called ${name} already: replace it?`)) return;
    const custom = new Set(seqsOf().filter((q) => q.custom).map((q) => q.name));
    st.m.viewMesh = st.m.clips.some((c) => custom.has(c.seq)) ? 'DeusEdixAnims.' + st.m.mesh.split('.').pop() : '';
    const m = JSON.parse(JSON.stringify(st.m)), old = st.name, done = st.done;
    change(`First-person moment ${name}`, (e) => {
      e.fpmoments = e.fpmoments || {};
      if (old && old !== name) {
        delete e.fpmoments[old];
        for (const l of e.links || []) for (const x of [...(l.do || []), ...(l.else || [])]) if (x.verb === 'fpmoment' && x.a === old) x.a = name;     // its rules follow it
      }
      e.fpmoments[name] = m;
    });
    status(`First-person moment ${name} saved: an Interaction plays it ("JC's weapon plays a moment"). Rebuild to put it in the game.`, 'ok');
    close(true);
    if (done) done(name);
  }

  return { open, close: () => close(true), list: () => Object.keys(edits().fpmoments || {}).sort(), get state() { return st; } };
}
