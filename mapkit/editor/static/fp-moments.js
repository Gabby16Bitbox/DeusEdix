// Tools > First-person moments (Gabby, 2 Nov 2026: "an animation of a weapon when you pick it up, press a key or walk
// into a collision"): the moments of the map, each made and seen here as the player sees it. A moment is clips of the
// weapon's own animations (any part of one, at any speed, backwards too), moves of the weapon in the view, sounds and a
// shake (fp-moment.js has its rules, editor/fpmoments.py writes it, UCViewMoment plays it); the Interactions play it
// ("JC's weapon plays a moment") when JC presses a key, uses a button, walks into a collision box, picks something up.
// The view: the weapon's first-person model (its class's PlayerViewMesh, read from the game) from the player's eye
// (FOV 75, its PlayerViewOffset, as Tools > Weapons shows it), playing the moment on its timeline.
import * as THREE from 'three';
import { exportModel, framesFromGlb, base64 } from './fp-blender.js';
import { newMoment, clipOf, momentLength, offsetAt, frameAt, soundsBetween, momentProblem, MOMENT_NAME, MAX_CLIPS, MAX_OFFSETS, MAX_SOUNDS } from './fp-moment.js';

const FOV = 75;
const STYLE = `
.fpm { width:min(1100px, 96vw); max-height:92vh; }
.fpm form { display:flex; flex-direction:column; gap:8px; min-height:0; }
.fpm .fpm-top { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.fpm .fpm-body { display:flex; gap:10px; min-height:0; }
.fpm .fpm-left { flex:1 1 55%; min-width:0; display:flex; flex-direction:column; gap:6px; }
.fpm .fpm-view { position:relative; aspect-ratio:16/10; background:#1b1f24; border-radius:var(--radius-control, 4px); overflow:hidden; }
.fpm .fpm-view canvas { width:100%; height:100%; display:block; }
.fpm .fpm-note { position:absolute; inset:auto 8px 8px 8px; color:#cfd5de; font-size:11px; text-shadow:0 1px 2px #000; }
.fpm .fpm-right { flex:1 1 45%; min-width:0; overflow:auto; max-height:62vh; display:flex; flex-direction:column; gap:4px; }
.fpm .fpm-right .cat { margin-top:6px; }
.fpm .row { display:flex; gap:4px; align-items:center; }
.fpm input[type=number] { width:56px; }
.fpm .fpm-time { display:flex; gap:6px; align-items:center; }
.fpm .fpm-time input[type=range] { flex:1; }
.fpm .bad { color:var(--bad, #e66); }
`;

export function createFpMoments({ api, edits, change, status, pickSound, playSound, weapons, escapeHtml, loadModel }) {
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

  function close() {
    if (!dlg) return;
    st?.stop?.();
    dlg.close(); dlg.remove();
    dlg = null; st = null;
  }

  // open(name): the moment called so (none: a new one); done(name): called with its name once saved
  function open(name = '', done = null) {
    close();
    const all = edits().fpmoments || {};
    const m = all[name] ? JSON.parse(JSON.stringify(all[name])) : newMoment();
    st = { name, m, done, model: null, t: 0, playing: false, loading: '' };
    dlg = document.createElement('dialog');
    dlg.className = 'map-dialog fpm';
    dlg.innerHTML = `<header><h2>First-person moment</h2></header>
      <form method="dialog" novalidate><div class="fpm-top">
        <label>Name</label><input data-f="name" value="${esc(name)}" maxlength="41" placeholder="Inspect" style="width:140px">
        <label>Weapon</label><select data-f="weapon" style="flex:1;min-width:0"><option value="">(choose the weapon it is made for)</option>
          ${weapons().map((w) => `<option value="${esc(w.cls)}" ${w.cls === m.weapon ? 'selected' : ''}>${esc(w.label)}</option>`).join('')}</select>
      </div>
      <div class="fpm-body"><div class="fpm-left"><div class="fpm-view"><div class="fpm-note"></div></div>
        <div class="fpm-time"><button type="button" data-f="play" title="Play the moment (Space)">▶</button><input type="range" data-f="t" min="0" max="1" step="0.01" value="0"><span data-f="tl">0.00 s</span></div>
        <div class="row"><span class="hint" style="margin:0">Blender</span><button type="button" data-f="export" disabled title="The weapon's first-person model at rest, to animate in Blender">Export the model (.glb)</button>
          <button type="button" data-f="import" disabled title="An animation of the exported model, made in Blender (.glb): a new animation of the weapon">Import an animation (.glb)…</button><input type="file" accept=".glb,.gltf" data-f="file" hidden></div>
        <div class="hint" style="margin:0">In the game: the weapon JC holds plays it when an Interaction says "JC's weapon plays a moment" (when JC presses a key, uses a button, walks into a collision box...). Only with this weapon in hand; firing, reloading or putting it away ends it.</div></div>
        <div class="fpm-right"></div></div>
      <p class="map-error" role="alert" data-f="err"></p>
      <footer><button type="button" data-f="cancel">Cancel</button><button type="submit" class="primary">Save</button></footer></form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dlg.querySelector('[data-f="cancel"]').onclick = close;
    dlg.querySelector('form').onsubmit = (e) => { e.preventDefault(); save(); };
    dlg.querySelector('[data-f="weapon"]').onchange = (e) => chooseWeapon(e.target.value, true);
    dlg.querySelector('[data-f="play"]').onclick = () => {
      st.playing = !st.playing;
      if (st.playing && st.t >= momentLength(st.m)) st.t = 0;
      st.from = st.playing && st.t === 0 ? -1 : st.t;          // a sound at 0 s plays too
      showTime();
    };
    dlg.querySelector('[data-f="export"]').onclick = () => exportGlb();
    dlg.querySelector('[data-f="import"]').onclick = () => dlg.querySelector('[data-f="file"]').click();
    dlg.querySelector('[data-f="file"]').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importGlb(f); };
    dlg.querySelector('[data-f="t"]').oninput = (e) => { st.playing = false; st.t = +e.target.value; showTime(); };
    dlg.showModal();
    startView();
    renderLists();
    if (m.weapon) chooseWeapon(m.weapon, false);
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
      st.m.mesh = info.mesh; st.m.view = info.view; st.model = model; st.loading = '';
      if (fresh || !st.m.clips.length) Object.assign(st.m, { clips: newMoment(cls, info.mesh, info.view, model.seqs).clips });
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
    const m = st.m, seqs = seqsOf(), host = dlg.querySelector('.fpm-right');
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
        <button type="button" data-a="del" title="Remove">✕</button></div>`;
    });
    h += `<div class="row"><button type="button" data-add="off" ${m.offsets.length >= MAX_OFFSETS ? 'disabled' : ''}>+ Move at the playhead</button><span class="hint" style="margin:0">its last move: where it ends (0 0 0: back)</span></div>`;
    h += '<div class="cat">Sounds</div>';
    m.sounds.forEach((s, i) => {
      h += `<div class="row" data-snd="${i}"><span class="hint" style="margin:0">at</span>${n('t', s.t, 0.05, 0)}<span>s</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.sound)}">${esc(s.sound ? s.sound.split('.').slice(1).join(' · ') : '(no sound)')}</span>
        <button type="button" data-a="pick">Choose…</button><button type="button" data-a="del" title="Remove">✕</button></div>`;
    });
    h += `<div class="row"><button type="button" data-add="snd" ${m.sounds.length >= MAX_SOUNDS ? 'disabled' : ''}>+ Sound at the playhead</button></div>`;
    h += `<div class="cat">Shake of the view</div><div class="row" data-shake><span class="hint" style="margin:0">at</span>${n('t', m.shake.t, 0.05, 0)}<span>s for</span>${n('secs', m.shake.secs, 0.05, 0, 10)}<span>s</span>
      <span class="hint" style="margin:0">roll</span>${n('roll', m.shake.roll, 50, 0)}<span class="hint" style="margin:0">up/down</span>${n('vert', m.shake.vert, 1, 0)}</div>
      <div class="hint" style="margin:0">0 s: none. The shake shows in the game only.</div>`;
    host.innerHTML = h;
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
      for (const k of ['t', 'x', 'y', 'z']) row.querySelector(`[data-k="${k}"]`).onchange = (e) => { o[k] = k === 't' ? Math.max(0, num(e.target)) : num(e.target); renderLists(); };
      row.querySelector('[data-a="del"]').onclick = () => { m.offsets.splice(+row.dataset.off, 1); renderLists(); };
    }
    for (const row of host.querySelectorAll('[data-snd]')) {
      const s = m.sounds[+row.dataset.snd];
      row.querySelector('[data-k="t"]').onchange = (e) => { s.t = Math.max(0, num(e.target)); renderLists(); };
      row.querySelector('[data-a="pick"]').onclick = () => pickSound(s.sound || '', (picked) => { if (picked && st?.m === m) { s.sound = picked; renderLists(); } });
      row.querySelector('[data-a="del"]').onclick = () => { m.sounds.splice(+row.dataset.snd, 1); renderLists(); };
    }
    const shake = host.querySelector('[data-shake]');
    for (const k of ['t', 'secs', 'roll', 'vert']) shake.querySelector(`[data-k="${k}"]`).onchange = (e) => { m.shake[k] = Math.max(0, num(e.target)); renderLists(); };
    host.querySelector('[data-add="clip"]').onclick = () => { const s = seqNamed(m.clips.at(-1)?.seq) || seqs[0]; if (s) m.clips.push(clipOf(s)); renderLists(); };
    host.querySelector('[data-add="off"]').onclick = () => { m.offsets.push({ t: +st.t.toFixed(2), x: 0, y: 0, z: 0 }); m.offsets.sort((a, b) => a.t - b.t); renderLists(); };
    host.querySelector('[data-add="snd"]').onclick = () => { m.sounds.push({ t: +st.t.toFixed(2), sound: '' }); renderLists(); };
    const range = dlg.querySelector('[data-f="t"]');
    range.max = String(Math.max(0.1, momentLength(m)));
    dlg.querySelector('[data-f="err"]').textContent = st.model ? momentProblem(m, seqs.map((s) => s.name)) : '';
    showTime();
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
    st.view = { renderer, scene, camera, group, parts: [] };
    const resize = () => {
      const w = host.clientWidth || 600, h = host.clientHeight || 375;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    let last = performance.now(), raf = 0;
    const tick = (now) => {
      if (!st || !dlg) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
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
  function buildModel() {
    const { group } = st.view, m = st.model;
    for (const p of st.view.parts) { group.remove(p); p.geometry.dispose(); }
    st.view.parts = [];
    const bySlot = new Map(), nf = m.faces.length / 4;
    for (let f = 0; f < nf; f++) {
      const slot = (m.info.mats[m.faces[f * 4 + 3]] || [0])[0];
      if (!bySlot.has(slot)) bySlot.set(slot, []);
      bySlot.get(slot).push(f);
    }
    for (const [slot, faces] of bySlot) {
      const g = new THREE.BufferGeometry(), uv = new Float32Array(faces.length * 6);
      let o = 0;
      for (const f of faces) for (let j = 0; j < 3; j++) { const w = m.faces[f * 4 + j]; uv[o++] = m.uvs[2 * w]; uv[o++] = m.uvs[2 * w + 1]; }
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(faces.length * 9), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const t = m.info.skins?.[slot] || m.info.tex?.[slot], url = t && String(t).startsWith('/') ? t : '';
      const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, color: url ? 0xffffff : 0x9aa0a8 });
      if (url) { const tex = new THREE.TextureLoader().load(url); tex.colorSpace = THREE.SRGBColorSpace; material.map = tex; }
      const mesh = new THREE.Mesh(g, material);
      mesh.userData.faces = faces;
      group.add(mesh); st.view.parts.push(mesh);
    }
  }
  // the model at the playhead: its frame (between two), and the eye where the game puts it
  function pose() {
    const v = st.view, m = st.model;
    const o = st.m.view || [20, -10, -14], d = offsetAt(st.m.offsets, st.t), k = 0.9 / FOV * 100;
    const ox = o[0] + d[0], oy = o[1] + d[1], oz = o[2] + d[2];
    const eye = new THREE.Vector3(-k * ox, -k * oz, k * oy);          // three: x forward, y up, z right
    v.camera.fov = 2 * Math.atan(Math.tan(FOV * Math.PI / 360) / v.camera.aspect) * 180 / Math.PI;
    v.camera.position.copy(eye);
    v.camera.lookAt(eye.x + 1, eye.y, eye.z);
    v.camera.updateProjectionMatrix();
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
    dlg.querySelector('[data-f="t"]').value = String(st.t);
    dlg.querySelector('[data-f="tl"]').textContent = `${st.t.toFixed(2)} / ${momentLength(st.m).toFixed(2)} s`;
    dlg.querySelector('[data-f="play"]').textContent = st.playing ? '❚❚' : '▶';
  }
  function note() {
    const el = dlg?.querySelector('.fpm-note');
    if (el) el.textContent = st.loading || (st.model ? `${st.m.mesh} · as the player sees it` : '');
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
        for (const l of e.links || []) for (const x of l.do || []) if (x.verb === 'fpmoment' && x.a === old) x.a = name;     // its rules follow it
      }
      e.fpmoments[name] = m;
    });
    status(`First-person moment ${name} saved: an Interaction plays it ("JC's weapon plays a moment"). Rebuild to put it in the game.`, 'ok');
    close();
    if (done) done(name);
  }

  return { open, close, list: () => Object.keys(edits().fpmoments || {}).sort() };
}
