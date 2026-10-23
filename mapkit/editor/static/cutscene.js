// Cutscenes of the map editor (editor/cutscenes.py builds them, src/UnatcoContinues/Classes/UCCutscene.uc plays
// them): a "Cutscene camera" (+ Cutscene, or Objects > Triggers) and its timeline at the bottom, like the camera
// paths of Premiere or of the Minecraft film mods.
//
// - Keys: fly the editor's camera where the shot should be (right mouse + WASD) and press K (or ◆ Key): a key at the
//   playhead with the camera's place, direction, roll and zoom. The camera flies through the keys without slowing
//   down at them (a spline in time); per key: smooth, stop there, linear to the next, hold. "Even speed" spaces
//   the keys so the camera moves at the same speed all along.
// - Look through: the 3D view becomes the cutscene's camera at the playhead (black bars, subtitles); ▶ plays it.
// - Shots: ✂ New shot cuts at the playhead (no movement between two shots: the film jumps).
// - Subtitles: who speaks, the line, how long, a sound. Events: what happens during it (a door opens at 3 s): the
//   Interactions "When it starts" of the cutscene, each action after its seconds; drag them on the timeline.
// Data: edits.cutscenes[<actor name>] (see cutscenes.py). Keys: p = where the eyes are (Unreal units), r = [pitch,
// yaw, roll] (65536 = a turn; the yaw does not wrap between keys), fov = degrees across the width, e = curve, s = shot.
import * as THREE from 'three';

const E = () => window.__editor;
const kit = () => window.__editor.cutKit;
const YAW = 65536;
const TURN = 2 * Math.PI;
const CURVES = [[1, 'Smooth (passes through)'], [2, 'Stop here (slows down to it)'], [0, 'Linear (straight, same speed)'], [4, 'Hold (jumps at the next key)']];
const SHOT_COLORS = [0xffd25a, 0x5ad1ff, 0xff7ad9, 0x8cff6a, 0xffa04a, 0xb48cff];
const FILM = 2.35;                       // the picture of the game's black bars: 2.35 times as wide as tall
const SCREEN = 16 / 9;                   // the game's screen (the field of view goes across its width)
const DEFAULT_FOV = 70;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r2 = (v) => Math.round(v * 100) / 100;
const clamp01 = (u) => Math.max(0, Math.min(1, u));
const $ = (s, el = document) => el.querySelector(s);

const box = document.createElement('div');
box.id = 'cutbox';
document.body.appendChild(box);
// what the game draws over the picture: the black bars, the subtitles, the fade (look through / play)
const film = document.createElement('div');
film.id = 'cutfilm';
film.innerHTML = '<div class="cf-bar cf-top"></div><div class="cf-bar cf-bot"></div><div class="cf-fade"></div><div class="cf-sub"><b></b><span></span></div><div class="cf-tag">CUTSCENE CAMERA</div>';
document.body.appendChild(film);

let cur = null;      // {name, t, sel: {kind, ref} | null, playing, look, free, fov, roll, lastEdits}
const pathGroup = new THREE.Group();
pathGroup.renderOrder = 12;
let pathKey = '';

// ---------------------------------------------------------------- data
function cutOf(name, create) {
  const ed = E().edits;
  if (!ed.cutscenes) ed.cutscenes = {};
  if (!ed.cutscenes[name] && create) {
    ed.cutscenes[name] = { title: 'Cutscene', keys: [], lines: [], fadeIn: 0.5, fadeOut: 0.5, bars: true, skip: true,
                           once: true, autoplay: false, showJC: true, straight: false, look: '' };
  }
  return ed.cutscenes[name] || null;
}
const shotOf = (k) => +k.s || 0;
function sortKeys(c) { c.keys.sort((a, b) => shotOf(a) - shotOf(b) || a.t - b.t); }
function lineLen(ln) { return +ln.d > 0 ? +ln.d : 2 + String(ln.text || '').length * 0.06; }
function lengthOf(c) {
  const ends = (c.keys || []).map((k) => +k.t).concat((c.lines || []).filter((l) => String(l.text || '').trim()).map((l) => +l.t + lineLen(l)));
  return Math.max(+c.length || 0, 0.5, ...ends);
}
// the camera at time t, as UCCutscene.Pose does in the game: a Catmull-Rom spline in time through the keys (it keeps
// its speed at a key), from rest at the first key and to rest at the last, moving across a cut; per key: 1 smooth,
// 2 (3) stop there, 0 linear to the next, 4 hold (jumps at the next key)
const comp = (k, c) => (c < 3 ? k.p[c] : c < 6 ? k.r[c - 3] : (+k.fov || DEFAULT_FOV));
function slope(ks, i, c) {
  const k = ks[i];
  if (k.e === 2 || k.e === 3) return 0;
  const prev = i > 0 && shotOf(ks[i - 1]) === shotOf(k), next = i + 1 < ks.length && shotOf(ks[i + 1]) === shotOf(k);
  if (prev && next) return (comp(ks[i + 1], c) - comp(ks[i - 1], c)) / Math.max(0.001, ks[i + 1].t - ks[i - 1].t);
  if (i === 0 || i === ks.length - 1) return 0;
  if (next) return (comp(ks[i + 1], c) - comp(k, c)) / Math.max(0.001, ks[i + 1].t - k.t);
  if (prev) return (comp(k, c) - comp(ks[i - 1], c)) / Math.max(0.001, k.t - ks[i - 1].t);
  return 0;
}
function value(ks, i, c, t, straight) {
  const a = ks[i], b = ks[i + 1], d = Math.max(0.001, b.t - a.t), u = clamp01((t - a.t) / d);
  if (straight || a.e === 0) return comp(a, c) + (comp(b, c) - comp(a, c)) * u;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * comp(a, c) + (u3 - 2 * u2 + u) * d * slope(ks, i, c)
    + (3 * u2 - 2 * u3) * comp(b, c) + (u3 - u2) * d * slope(ks, i + 1, c);
}
function pose(c, t) {
  const ks = c.keys || [];
  if (!ks.length) return null;
  let i = 0;
  while (i < ks.length - 1 && ks[i + 1].t <= t) i++;
  const k = ks[i];
  if (t <= ks[0].t || i >= ks.length - 1 || shotOf(ks[i + 1]) !== shotOf(k) || k.e === 4) return { p: k.p.slice(), r: k.r.slice(), fov: comp(k, 6), shot: shotOf(k) };
  const v = (j) => value(ks, i, j, t, c.straight);
  return { p: [v(0), v(1), v(2)], r: [v(3), v(4), v(5)], fov: v(6), shot: shotOf(k) };
}
// "always looks at": the direction from the camera to that actor (its eyes for a character)
function lookRot(c, p, r) {
  const q = c.look && kit().proxyOf(c.look);
  if (!q) return r;
  const a = q.userData.actor || {}, to = kit().UE(q.position);
  if (q.userData.kind === 'pawn') to[2] += (+a.height || 45) * 0.8;
  const d = [to[0] - p[0], to[1] - p[1], to[2] - p[2]], flat = Math.hypot(d[0], d[1]);
  return [Math.atan2(d[2], flat) * YAW / TURN, Math.atan2(d[1], d[0]) * YAW / TURN, r[2]];
}
function shotAt(c, t) {
  const ks = c.keys || [];
  let s = ks.length ? shotOf(ks[0]) : 0;
  for (const k of ks) if (k.t <= t) s = shotOf(k);
  return s;
}
function lineAt(c, t) {
  let now = null;
  for (const ln of c.lines || []) if (String(ln.text || '').trim() && t >= +ln.t && t < +ln.t + lineLen(ln)) now = ln;
  return now;
}
function startRule(name, create) {
  let l = kit().lkList().find((x) => x.src === name && x.when === 'cutstart');
  if (!l && create) {
    const ids = kit().lkList().map((x) => +String(x.id).replace(/\D/g, '') || 0);
    l = { id: 'L' + (Math.max(0, ...ids) + 1), src: name, when: 'cutstart', once: false, at: kit().UE(kit().proxyOf(name).position), do: [] };
    kit().lkList().push(l);
  }
  return l || null;
}

// ---------------------------------------------------------------- the editor's camera
// Looking through: the game's screen (16:9) fitted in the 3D view above the panel, the rest of the view dimmed
// around it; the camera shows exactly the game's picture in that rectangle (a view offset of three.js).
function screenRect() {
  const rc = kit().canvas.getBoundingClientRect();
  let bottom = rc.bottom;
  if (box.style.display === 'block') {
    const b = box.getBoundingClientRect();
    if (b.top > rc.top + 160 && b.top < bottom) bottom = b.top - 4;
  }
  const vw = rc.width - 16, vh = bottom - rc.top - 16;
  let w = vw, h = w / SCREEN;
  if (h > vh) { h = vh; w = h * SCREEN; }
  return { rc, x: rc.left + (rc.width - w) / 2, y: rc.top + 8 + (vh - h) / 2, w, h };
}
function applyFov(h) {
  const cam = E().camera, s = screenRect();
  const v = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(h) / 2) / SCREEN));
  const ox = s.x - s.rc.left, oy = s.y - s.rc.top, view = cam.view;
  if (Math.abs(cam.fov - v) < 0.01 && Math.abs(cam.aspect - SCREEN) < 1e-4 && view && view.enabled && Math.abs(view.fullWidth - s.w) < 0.5
    && Math.abs(view.fullHeight - s.h) < 0.5 && Math.abs(view.offsetX + ox) < 0.5 && Math.abs(view.offsetY + oy) < 0.5
    && Math.abs(view.width - s.rc.width) < 0.5 && Math.abs(view.height - s.rc.height) < 0.5) return s;
  cam.fov = v;
  cam.aspect = SCREEN;
  cam.setViewOffset(s.w, s.h, -ox, -oy, s.rc.width, s.rc.height);
  cam.updateProjectionMatrix();
  return s;
}
function freeFov() {                       // the editor's own view again (as app.js resize())
  const cam = E().camera, rc = kit().canvas.getBoundingClientRect();
  cam.clearViewOffset();
  cam.aspect = rc.width / Math.max(1, rc.height);
  cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(86) / 2) / cam.aspect));
  cam.updateProjectionMatrix();
}
function viewNow() {                       // the editor's view as a key: [p, r]
  const ed = E(), p = kit().UE(ed.camera.position);
  return [p, [ed.cam.pitch * YAW / TURN, ed.cam.yaw * YAW / TURN, (cur ? cur.roll : 0) * YAW / 360]];
}
function goTo(t) {                          // the editor's camera where the cutscene's is at time t
  const c = cutOf(cur.name);
  const q = c && pose(c, t);
  if (!q) return;
  const ed = E(), r = lookRot(c, q.p, q.r);
  ed.camera.position.copy(kit().T(q.p));
  ed.cam.pitch = Math.max(-1.55, Math.min(1.55, r[0] * TURN / YAW));
  ed.cam.yaw = r[1] * TURN / YAW;
  cur.roll = r2(r[2] * 360 / YAW);
  cur.fov = r2(q.fov);
  ed.cam.roll = cur.roll * Math.PI / 180;
  applyFov(cur.fov);
}
function setLook(on) {
  const ed = E();
  if (on && !cur.look) {
    cur.free = { p: ed.camera.position.clone(), yaw: ed.cam.yaw, pitch: ed.cam.pitch };
    cur.look = true;
    goTo(cur.t);
  } else if (!on && cur.look) {
    cur.look = false;
    stopPlay();
    ed.cam.roll = 0;
    freeFov();
    if (cur.free) { ed.camera.position.copy(cur.free.p); ed.cam.yaw = cur.free.yaw; ed.cam.pitch = cur.free.pitch; }
  }
  render();
}

// ---------------------------------------------------------------- editing
function change(fn) {
  kit().pushUndo();
  fn();
  const c = cutOf(cur.name);
  if (c && c.keys) sortKeys(c);
  kit().setDirty();
  cur.lastEdits = E().edits;
  render();
}
function recordKey() {
  if (!cur) return;
  const c = cutOf(cur.name, true), t = r2(cur.t);
  const [p, r] = viewNow();
  change(() => {
    const s = shotAt(c, t);
    const same = c.keys.filter((k) => shotOf(k) === s);
    const ref = same.length ? same.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)) : null;
    if (ref) r[1] = ref.r[1] + ((((r[1] - ref.r[1]) % YAW) + YAW * 1.5) % YAW - YAW / 2);   // the short way round
    const k = c.keys.find((x) => shotOf(x) === s && Math.abs(x.t - t) < 0.011);
    const v = { p, r: r.map(Math.round), fov: cur.fov };
    if (k) Object.assign(k, v);
    else c.keys.push(Object.assign({ t, e: 1, s }, v));
    cur.sel = { kind: 'key', ref: k || c.keys[c.keys.length - 1] };
  });
  kit().status(`Key at ${t.toFixed(2)} s.`, 'ok');
}
function newShot() {
  const c = cutOf(cur.name, true), t = r2(cur.t);
  if (!c.keys.length) { recordKey(); return; }
  change(() => {
    const s = shotAt(c, t), q = pose(c, t);
    // the shot so far ends here as it is; the keys after the playhead go to the new shot
    if (!c.keys.some((k) => shotOf(k) === s && Math.abs(k.t - t) < 0.011)) c.keys.push({ t, p: q.p, r: q.r.map(Math.round), fov: q.fov, e: 1, s });
    for (const k of c.keys) if (shotOf(k) > s || (shotOf(k) === s && k.t > t + 0.011)) k.s = shotOf(k) + 1;
    const [p, r] = cur.look ? viewNow() : [q.p, q.r];
    const first = { t, p, r: r.map(Math.round), fov: cur.fov || q.fov, e: 1, s: s + 1 };
    const there = c.keys.find((k) => shotOf(k) === s + 1 && Math.abs(k.t - t) < 0.011);
    if (there) Object.assign(there, first); else c.keys.push(first);
    cur.sel = { kind: 'key', ref: there || first };
  });
  kit().status('A new shot starts at the playhead: fly the camera to its first view and press K.', 'ok');
}
function joinShot(k) {                     // the shot of this key joins the one before it (no cut)
  const c = cutOf(cur.name), s = shotOf(k);
  if (!s) return;
  change(() => {
    const prev = c.keys.filter((x) => shotOf(x) === s - 1).pop();
    const first = c.keys.filter((x) => shotOf(x) === s)[0];
    if (prev && first && Math.abs(prev.t - first.t) < 0.011) c.keys.splice(c.keys.indexOf(prev), 1);
    for (const x of c.keys) if (shotOf(x) >= s) x.s = shotOf(x) - 1;
  });
}
function evenSpeed() {                     // in every shot: the keys spaced by the distance between them
  const c = cutOf(cur.name);
  if (!c || c.keys.length < 3) return;
  change(() => {
    for (const s of new Set(c.keys.map(shotOf))) {
      const ks = c.keys.filter((k) => shotOf(k) === s);
      if (ks.length < 3) continue;
      const d = [0];
      for (let i = 1; i < ks.length; i++) d.push(d[i - 1] + Math.hypot(...[0, 1, 2].map((j) => ks[i].p[j] - ks[i - 1].p[j])) + 1e-3);
      const t0 = ks[0].t, t1 = ks[ks.length - 1].t, tot = d[d.length - 1];
      ks.forEach((k, i) => { k.t = r2(t0 + (t1 - t0) * d[i] / tot); });
    }
  });
  kit().status('Keys spaced by distance: the camera keeps the same speed in each shot.', 'ok');
}

// ---------------------------------------------------------------- the 3D path
function disposePath() {
  for (const ch of [...pathGroup.children]) { pathGroup.remove(ch); ch.geometry.dispose(); ch.material.dispose(); }
}
function frustum(p, r, fov, size) {          // a small camera: the eye and the corners of what it sees
  const pit = r[0] * TURN / YAW, yw = r[1] * TURN / YAW, rl = r[2] * TURN / YAW;
  const f = new THREE.Vector3(Math.cos(pit) * Math.cos(yw), Math.cos(pit) * Math.sin(yw), Math.sin(pit));
  const right0 = new THREE.Vector3(-Math.sin(yw), Math.cos(yw), 0);
  const up0 = new THREE.Vector3().crossVectors(right0, f).normalize();
  const right = right0.clone().multiplyScalar(Math.cos(rl)).add(up0.clone().multiplyScalar(-Math.sin(rl)));
  const up = new THREE.Vector3().crossVectors(right, f).normalize();
  const w = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * size, h = w / 1.78;
  const eye = new THREE.Vector3(...p), mid = eye.clone().addScaledVector(f, size);
  const cs = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => mid.clone().addScaledVector(right, a * w).addScaledVector(up, b * h));
  const pts = [];
  for (const c of cs) pts.push(eye, c);
  for (let i = 0; i < 4; i++) pts.push(cs[i], cs[(i + 1) % 4]);
  pts.push(mid.clone().addScaledVector(up, h), mid.clone().addScaledVector(up, h * 1.5));       // which way is up
  return pts.map((v) => kit().T([v.x, v.y, v.z]));
}
function addLines(pts, color, opacity, segments) {
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
  const o = segments ? new THREE.LineSegments(g, m) : new THREE.Line(g, m);
  o.renderOrder = 12;
  pathGroup.add(o);
}
function drawPath(name, dim) {
  const c = name && cutOf(name);
  const key = c ? JSON.stringify([name, dim, c.keys, c.straight, cur && !dim && !cur.look ? r2(cur.t) : -1]) : '';
  if (key === pathKey && pathGroup.parent) return;
  pathKey = key;
  disposePath();
  if (!pathGroup.parent) E().scene.add(pathGroup);
  if (!c || !c.keys.length) return;
  const op = dim ? 0.45 : 0.95;
  for (const s of new Set(c.keys.map(shotOf))) {
    const ks = c.keys.filter((k) => shotOf(k) === s), col = SHOT_COLORS[s % SHOT_COLORS.length];
    if (ks.length > 1) {
      const pts = [];
      for (let t = ks[0].t; t <= ks[ks.length - 1].t + 1e-6; t += 1 / 30) {
        const q = pose({ keys: ks, straight: c.straight }, t);
        pts.push(kit().T(q.p));
      }
      addLines(pts, col, op, false);
    }
    for (const k of ks) addLines(frustum(k.p, lookRot(c, k.p, k.r), +k.fov || DEFAULT_FOV, 40), col, op, true);
  }
  if (cur && !dim && !cur.look) {             // the camera at the playhead
    const q = pose(c, cur.t);
    if (q) addLines(frustum(q.p, lookRot(c, q.p, q.r), q.fov, 90), 0xff5a5a, 1, true);
  }
}

// ---------------------------------------------------------------- the overlay (as the game draws it)
function drawFilm() {
  const c = cur && cutOf(cur.name);
  if (!cur || !cur.look || !c) { film.style.display = 'none'; return; }
  const rc = applyFov(cur.fov);
  Object.assign(film.style, { display: 'block', left: rc.x + 'px', top: rc.y + 'px', width: rc.w + 'px', height: rc.h + 'px', fontSize: Math.max(11, rc.w / 70) + 'px' });
  const bar = c.bars ? Math.max(0, (rc.h - rc.w / FILM) / 2) : 0;
  $('.cf-top', film).style.height = bar + 'px';
  $('.cf-bot', film).style.height = bar + 'px';
  const len = lengthOf(c);
  let fade = 0;
  if (cur.playing) {
    if (+c.fadeIn > 0 && cur.t < +c.fadeIn) fade = 1 - cur.t / +c.fadeIn;
    if (+c.fadeOut > 0 && cur.t > len - +c.fadeOut) fade = Math.max(fade, (cur.t - (len - +c.fadeOut)) / +c.fadeOut);
  }
  $('.cf-fade', film).style.opacity = clamp01(fade);
  const ln = lineAt(c, cur.t), sub = $('.cf-sub', film);
  sub.style.display = ln ? 'block' : 'none';
  if (ln) {
    $('b', sub).textContent = ln.who || '';
    $('span', sub).textContent = ln.text || '';
    const h = bar > 0 ? bar : rc.h * 0.16;
    Object.assign(sub.style, { top: (rc.h - h + 4) + 'px', background: bar > 0 ? 'none' : '#000c' });
  }
}

// ---------------------------------------------------------------- playing in the editor
let last = 0;
function startPlay() {
  const c = cutOf(cur.name);
  if (!c || !c.keys.length) { kit().status('Make a key first: fly the camera and press K.', 'warn'); return; }
  if (!cur.look) setLook(true);
  if (cur.t >= lengthOf(c) - 0.01) cur.t = 0;
  cur.playing = true;
  last = performance.now();
  render();
}
function stopPlay() { if (cur && cur.playing) { cur.playing = false; render(); } }

// ---------------------------------------------------------------- the panel
function curveName(e) { return (CURVES.find((x) => x[0] === (e === 3 ? 2 : e ?? 1)) || CURVES[0])[1]; }
function render() {
  if (!cur) return;
  const c = cutOf(cur.name, true), len = lengthOf(c), max = Math.max(8, Math.ceil(len + 3));
  const K = kit();
  const evRule = startRule(cur.name, false);
  const evs = evRule ? (evRule.do || []) : [];
  const sel = cur.sel;
  if (sel && sel.kind === 'key' && !c.keys.includes(sel.ref)) cur.sel = null;
  if (sel && sel.kind === 'line' && !c.lines.includes(sel.ref)) cur.sel = null;
  if (sel && sel.kind === 'ev' && !evs.includes(sel.ref)) cur.sel = null;
  const pawns = K.allActors().filter((a) => K.isCharacter(a)).map((a) => [a.name, `${K.hierLabel(a)} (${a.name})`]);
  if (c.look && !pawns.some((x) => x[0] === c.look)) pawns.unshift([c.look, c.look]);
  const pct = (t) => (t / max * 100) + '%';
  const shots = [...new Set(c.keys.map(shotOf))].map((s) => {
    const ks = c.keys.filter((k) => shotOf(k) === s), from = ks[0].t;
    const next = c.keys.find((k) => shotOf(k) > s);
    return { s, from, to: next ? next.t : len };
  });
  let selHtml = '<span class="hint" style="margin:0">Click a key, a line or an event on the timeline to change it.</span>';
  if (cur.sel && cur.sel.kind === 'key') {
    const k = cur.sel.ref;
    selHtml = `<b style="color:#${SHOT_COLORS[shotOf(k) % SHOT_COLORS.length].toString(16).padStart(6, '0')}">Key · shot ${shotOf(k) + 1} · ${k.t.toFixed(2)} s</b>
      <label>At this key</label><select id="cskcurve">${CURVES.map(([v, l]) => `<option value="${v}" ${v === (k.e === 3 ? 2 : k.e ?? 1) ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label>Zoom</label><input id="cskfov" type="number" min="10" max="120" step="1" value="${r2(+k.fov || DEFAULT_FOV)}" style="width:54px" title="Field of view in degrees, across the width (smaller = closer)">°
      <label>Roll</label><input id="cskroll" type="number" step="5" value="${r2(k.r[2] * 360 / YAW)}" style="width:54px" title="How much the camera is tilted (degrees)">°
      <button id="cskgo" title="Look through the camera at this key">Go there</button><button id="cskset" title="This key becomes the editor's view now">Set to the view</button>
      ${shotOf(k) && c.keys.filter((x) => shotOf(x) === shotOf(k))[0] === k ? '<button id="cskjoin" title="No cut: this shot goes on from the one before">Join with the shot before</button>' : ''}
      <button id="cskdel">Delete key</button>`;
  } else if (cur.sel && cur.sel.kind === 'line') {
    const ln = cur.sel.ref;
    selHtml = `<b>Subtitle · ${(+ln.t).toFixed(2)} s</b><label>Who</label><input id="cslwho" list="cswho" value="${esc(ln.who)}" style="width:120px" placeholder="(nobody)">
      <input id="csltext" value="${esc(ln.text)}" style="flex:1;min-width:160px" placeholder="the line">
      <label>Seconds</label><input id="csldur" type="number" min="0" step="0.1" value="${+ln.d || 0}" style="width:54px" title="0: as long as the text needs (${lineLen(Object.assign({}, ln, { d: 0 })).toFixed(1)} s)">
      <button id="cslsnd" title="A sound or a voice for this line">${ln.snd ? '♪ ' + esc(String(ln.snd).split('.').pop()) : 'Sound...'}</button>${ln.snd ? '<button id="cslplay">▶</button><button id="cslnosnd" title="No sound">✕</button>' : ''}
      <button id="csldel">Delete line</button>`;
  } else if (cur.sel && cur.sel.kind === 'ev') {
    const x = cur.sel.ref;
    selHtml = `<b>Event · ${(+x.delay || 0).toFixed(2)} s</b><span style="flex:1">${esc(K.lkActText(x))}</span>
      <button id="csevprops" title="Change it in the Interactions of the cutscene (Properties)">Change in Properties</button><button id="csevdel">Delete event</button>`;
  }
  const keyEls = c.keys.map((k, i) => `<span class="cs-key ${cur.sel && cur.sel.ref === k ? 'on' : ''}" data-csk="${i}" style="left:${pct(k.t)};background:#${SHOT_COLORS[shotOf(k) % SHOT_COLORS.length].toString(16).padStart(6, '0')}" title="${k.t.toFixed(2)} s · shot ${shotOf(k) + 1} · ${curveName(k.e)}"></span>`).join('');
  const shotEls = shots.map((x) => `<span class="cs-shot" style="left:${pct(x.from)};width:calc(${pct(Math.max(0.05, x.to - x.from))} - 2px);background:#${SHOT_COLORS[x.s % SHOT_COLORS.length].toString(16).padStart(6, '0')}33;border-color:#${SHOT_COLORS[x.s % SHOT_COLORS.length].toString(16).padStart(6, '0')}">Shot ${x.s + 1}</span>`).join('');
  const lineEls = (c.lines || []).map((ln, i) => `<span class="cs-line ${cur.sel && cur.sel.ref === ln ? 'on' : ''}" data-csl="${i}" style="left:${pct(+ln.t)};width:calc(${pct(lineLen(ln))} - 2px)" title="${esc((ln.who ? ln.who + ': ' : '') + ln.text)}">${esc((ln.who ? ln.who + ': ' : '') + (ln.text || ''))}</span>`).join('');
  const evEls = evs.map((x, i) => `<span class="cs-ev ${cur.sel && cur.sel.ref === x ? 'on' : ''}" data-cse="${i}" style="left:${pct(+x.delay || 0)}" title="${(+x.delay || 0).toFixed(2)} s · ${esc(K.lkActText(x))}">${esc(K.lkActText(x))}</span>`).join('');
  const ticks = Array.from({ length: max + 1 }, (_, s) => `<span style="left:${pct(s)}">${s}s</span>`).join('');
  box.innerHTML = `<div class="row" style="flex-wrap:wrap;row-gap:4px"><b>🎬</b><input id="cstitle" value="${esc(c.title || cur.name)}" style="width:170px" title="Its name in the editor">
      <button id="csplay" title="Play it (Space)">${cur.playing ? '❚❚' : '▶'}</button><button id="csstop" title="Stop, back to the start">■</button>
      <span id="cstime" class="hint" style="margin:0 4px;min-width:84px">${cur.t.toFixed(2)} / ${len.toFixed(1)} s</span>
      <button id="cslook" class="${cur.look ? 'primary' : ''}" title="The 3D view becomes the cutscene's camera at the playhead (black bars, subtitles). Fly around and press K for a key">🎥 Look through</button>
      <button id="cskey" title="A key at the playhead: the camera where the editor's view is now (K)">◆ Key (K)</button>
      <button id="cscut" title="A cut at the playhead: a new shot starts there">✂ New shot</button>
      <button id="cseven" title="Space the keys so the camera keeps the same speed in each shot">Even speed</button>
      <span style="flex:1"></span>
      <label style="width:auto">Zoom</label><input id="csfov" type="number" min="10" max="120" step="1" value="${r2(cur.fov)}" style="width:52px" title="Field of view of the next key (degrees across the width; smaller = closer)">°
      <label style="width:auto">Roll</label><input id="csroll" type="number" step="5" value="${r2(cur.roll)}" style="width:52px" title="Tilt of the next key (degrees)">°
      <button id="csclose">Close</button></div>
    <div class="row" style="flex-wrap:wrap;row-gap:4px;margin-top:4px">
      <label style="width:auto">Path</label><select id="cspath"><option value="0" ${c.straight ? '' : 'selected'}>Smooth through the keys</option><option value="1" ${c.straight ? 'selected' : ''}>Straight lines</option></select>
      <label style="width:auto">Looks at</label><select id="cslookat" style="max-width:220px"><option value="">where its keys look</option>${pawns.map(([n, l]) => `<option value="${esc(n)}" ${n === c.look ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <label style="width:auto">Fade in</label><input id="csfin" type="number" min="0" step="0.1" value="${+c.fadeIn || 0}" style="width:48px">
      <label style="width:auto">out</label><input id="csfout" type="number" min="0" step="0.1" value="${+c.fadeOut || 0}" style="width:48px">s
      <label style="width:auto">Length</label><input id="cslen" type="number" min="0" step="0.5" value="${r2(len)}" style="width:54px" title="Seconds (at least until its last key and line)">s
      <label style="width:auto"><input type="checkbox" id="csbars" ${c.bars !== false ? 'checked' : ''}> black bars</label>
      <label style="width:auto"><input type="checkbox" id="csskip" ${c.skip !== false ? 'checked' : ''}> can be skipped</label>
      <label style="width:auto"><input type="checkbox" id="csonce" ${c.once !== false ? 'checked' : ''}> only once</label>
      <label style="width:auto" title="It plays when the map starts (else an interaction or the Story plays it)"><input type="checkbox" id="csauto" ${c.autoplay ? 'checked' : ''}> at the start of the map</label>
      <label style="width:auto" title="A stand-in of JC stays where he was while the camera flies"><input type="checkbox" id="csjc" ${c.showJC !== false ? 'checked' : ''}> JC visible where he stands</label></div>
    <div class="row cs-sel">${selHtml}</div>
    <div class="cs-grid"><div class="cs-lefts"><div class="cs-pad"></div>
        <div class="cs-left">Camera</div><div class="cs-left">Shots</div>
        <div class="cs-left">Subtitles <button id="csaddline" title="A line at the playhead">+</button></div>
        <div class="cs-left">Events <button id="csaddev" title="Something that happens at the playhead: click a door, a character, a light...">+</button></div></div>
      <div id="cstl" class="cs-tl" data-max="${max}"><div class="cs-ticks">${ticks}</div>
        <div class="cs-track" data-cst="key">${keyEls}</div><div class="cs-track">${shotEls}</div>
        <div class="cs-track" data-cst="line">${lineEls}</div><div class="cs-track" data-cst="ev">${evEls}</div>
        <div id="csph" class="cs-ph" style="left:${pct(cur.t)}"></div></div></div>
    <datalist id="cswho">${[...new Set(K.allActors().filter((a) => K.isCharacter(a)).map((a) => K.hierLabel(a)).concat(['JC Denton']))].map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`;
  box.style.display = 'block';
  wire(c, max);
  drawPath(cur.name, false);
}
function wire(c, max) {
  const K = kit();
  const on = (id, ev, fn) => { const el = $(id, box); if (el) el[ev] = fn; };
  on('#cstitle', 'onchange', (e) => change(() => { c.title = e.target.value.trim() || cur.name; }));
  on('#csplay', 'onclick', () => (cur.playing ? stopPlay() : startPlay()));
  on('#csstop', 'onclick', () => { stopPlay(); cur.t = 0; if (cur.look) goTo(0); render(); });
  on('#cslook', 'onclick', () => setLook(!cur.look));
  on('#cskey', 'onclick', recordKey);
  on('#cscut', 'onclick', newShot);
  on('#cseven', 'onclick', evenSpeed);
  on('#csclose', 'onclick', close);
  on('#csfov', 'onchange', (e) => { cur.fov = Math.max(10, Math.min(120, +e.target.value || DEFAULT_FOV)); if (cur.look) applyFov(cur.fov); });
  on('#csroll', 'onchange', (e) => { cur.roll = +e.target.value || 0; if (cur.look) E().cam.roll = cur.roll * Math.PI / 180; });
  on('#cspath', 'onchange', (e) => change(() => { c.straight = e.target.value === '1'; }));
  on('#cslookat', 'onchange', (e) => change(() => { c.look = e.target.value; }));
  on('#csfin', 'onchange', (e) => change(() => { c.fadeIn = Math.max(0, +e.target.value || 0); }));
  on('#csfout', 'onchange', (e) => change(() => { c.fadeOut = Math.max(0, +e.target.value || 0); }));
  on('#cslen', 'onchange', (e) => change(() => { c.length = Math.max(0, +e.target.value || 0); }));
  for (const [id, k] of [['#csbars', 'bars'], ['#csskip', 'skip'], ['#csonce', 'once'], ['#csauto', 'autoplay'], ['#csjc', 'showJC']]) on(id, 'onchange', (e) => change(() => { c[k] = e.target.checked; }));
  // the selected key, line, event
  const k = cur.sel && cur.sel.kind === 'key' ? cur.sel.ref : null;
  if (k) {
    on('#cskcurve', 'onchange', (e) => change(() => { k.e = +e.target.value; }));
    on('#cskfov', 'onchange', (e) => change(() => { k.fov = Math.max(10, Math.min(120, +e.target.value || DEFAULT_FOV)); }));
    on('#cskroll', 'onchange', (e) => change(() => { k.r[2] = Math.round((+e.target.value || 0) * YAW / 360); }));
    on('#cskgo', 'onclick', () => { cur.t = k.t; if (!cur.look) setLook(true); else { goTo(cur.t); render(); } });
    on('#cskset', 'onclick', () => change(() => { const [p, r] = viewNow(); r[1] = k.r[1] + ((((r[1] - k.r[1]) % YAW) + YAW * 1.5) % YAW - YAW / 2); k.p = p; k.r = r.map(Math.round); k.fov = cur.fov; }));
    on('#cskjoin', 'onclick', () => joinShot(k));
    on('#cskdel', 'onclick', () => change(() => { c.keys.splice(c.keys.indexOf(k), 1); cur.sel = null; }));
  }
  const ln = cur.sel && cur.sel.kind === 'line' ? cur.sel.ref : null;
  if (ln) {
    on('#cslwho', 'onchange', (e) => change(() => { ln.who = e.target.value.trim(); }));
    on('#csltext', 'onchange', (e) => change(() => { ln.text = e.target.value; }));
    on('#csldur', 'onchange', (e) => change(() => { ln.d = Math.max(0, +e.target.value || 0); }));
    on('#cslsnd', 'onclick', () => K.pickSound(ln.snd || '', (name) => { if (name) change(() => { ln.snd = name; }); }));
    on('#cslplay', 'onclick', (e) => K.playSound(ln.snd, e.target));
    on('#cslnosnd', 'onclick', () => change(() => { ln.snd = ''; }));
    on('#csldel', 'onclick', () => change(() => { c.lines.splice(c.lines.indexOf(ln), 1); cur.sel = null; }));
  }
  const x = cur.sel && cur.sel.kind === 'ev' ? cur.sel.ref : null;
  if (x) {
    on('#csevprops', 'onclick', () => { const q = K.proxyOf(cur.name); if (q) K.select(q); });
    on('#csevdel', 'onclick', () => change(() => {
      const l = startRule(cur.name, false);
      l.do.splice(l.do.indexOf(x), 1);
      if (!l.do.length) K.lkList().splice(K.lkList().indexOf(l), 1); else l.label = K.lkSentence(l);
      cur.sel = null;
      refreshProps();
    }));
  }
  on('#csaddline', 'onclick', () => change(() => {
    c.lines = c.lines || [];
    const nl = { t: r2(cur.t), d: 0, who: '', text: '', snd: '' };
    c.lines.push(nl);
    c.lines.sort((a, b) => a.t - b.t);
    cur.sel = { kind: 'line', ref: nl };
  }));
  on('#csaddev', 'onclick', () => {
    const t = r2(cur.t), name = cur.name;
    K.lkStartPick({
      hint: `Click what happens at ${t.toFixed(2)} s of the cutscene (a door, a character, a light...); a message or a sound: + Then... in its Properties`,
      accept: (o) => (o.name === name ? 'Click another object.' : true),
      done: (o) => {
        if (!cur || cur.name !== name) return;
        change(() => {
          const l = startRule(name, true), act = K.lkNewAct(o, K.proxyOf(name).userData.actor);
          act.delay = t;
          l.do.push(act);
          l.label = K.lkSentence(l);
          cur.sel = { kind: 'ev', ref: act };
        });
        refreshProps();
      } });
  });
  // the timeline: the playhead (click or drag), keys / lines / events (click: select, drag: move in time)
  const tl = $('#cstl', box);
  const timeAt = (e) => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(max, (e.clientX - r.left) / r.width * max)); };
  const scrub = (e) => { stopPlay(); cur.t = Math.round(timeAt(e) * 20) / 20; if (cur.look) goTo(cur.t); playhead(); drawPath(cur.name, false); };
  tl.addEventListener('pointerdown', (e) => {
    if (e.target.dataset.csk || e.target.dataset.csl || e.target.dataset.cse) return;
    scrub(e);
    const up = () => { window.removeEventListener('pointermove', scrub); window.removeEventListener('pointerup', up); render(); };
    window.addEventListener('pointermove', scrub);
    window.addEventListener('pointerup', up);
  });
  const dragItem = (el, item, getT, setT, bounds) => el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    stopPlay();
    cur.sel = item;
    cur.t = getT();
    if (cur.look) goTo(cur.t);
    let moved = false;
    kit().pushUndo();
    const [lo, hi] = bounds();
    const move = (ev) => {
      const t = Math.max(lo, Math.min(hi, Math.round(timeAt(ev) * 20) / 20));
      if (Math.abs(t - getT()) < 0.001) return;
      moved = true;
      setT(t);
      el.style.left = (t / max * 100) + '%';
      cur.t = t;
      playhead();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) { kit().setDirty(); cur.lastEdits = E().edits; if (item.kind === 'ev') refreshProps(); } else kit().undoPop();
      if (c.keys) sortKeys(c);
      render();
      if (cur.look) goTo(cur.t);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  for (const el of box.querySelectorAll('[data-csk]')) {
    const key = c.keys[+el.dataset.csk];
    dragItem(el, { kind: 'key', ref: key }, () => key.t, (t) => { key.t = t; }, () => {
      const i = c.keys.indexOf(key), prev = c.keys[i - 1], next = c.keys[i + 1];
      const lo = prev ? prev.t + (shotOf(prev) === shotOf(key) ? 0.05 : 0) : 0;
      const hi = next ? next.t - (shotOf(next) === shotOf(key) ? 0.05 : 0) : max;
      return [lo, hi];
    });
  }
  for (const el of box.querySelectorAll('[data-csl]')) {
    const l2 = c.lines[+el.dataset.csl];
    dragItem(el, { kind: 'line', ref: l2 }, () => +l2.t, (t) => { l2.t = t; }, () => [0, max]);
  }
  const rule = startRule(cur.name, false);
  for (const el of box.querySelectorAll('[data-cse]')) {
    const a = rule.do[+el.dataset.cse];
    dragItem(el, { kind: 'ev', ref: a }, () => +a.delay || 0, (t) => { a.delay = t; rule.label = K.lkSentence(rule); }, () => [0, max]);
  }
}
function playhead() {
  const c = cur && cutOf(cur.name), ph = $('#csph', box), tl = $('#cstl', box);
  if (!c || !ph || !tl) return;
  ph.style.left = (cur.t / +tl.dataset.max * 100) + '%';
  const tt = $('#cstime', box);
  if (tt) tt.textContent = `${cur.t.toFixed(2)} / ${lengthOf(c).toFixed(1)} s`;
}
function refreshProps() {
  const sel = E().selected;
  if (sel) kit().showDetails();
}

// ---------------------------------------------------------------- open, close, a new one
function open(name, opts = {}) {
  if (cur && cur.name !== name) close();
  if (!cur) {
    cur = { name, t: 0, sel: null, playing: false, look: false, free: null, fov: DEFAULT_FOV, roll: 0, lastEdits: E().edits };
    const c = cutOf(name, true);
    if (c.keys.length) { cur.fov = +c.keys[0].fov || DEFAULT_FOV; }
  }
  if (window.__closeAnim) window.__closeAnim();
  render();
  if (opts.look) setLook(true);
}
function close() {
  if (!cur) return;
  if (cur.look) setLook(false);
  cur = null;
  box.style.display = 'none';
  box.innerHTML = '';
  film.style.display = 'none';
  pathKey = '';
  disposePath();
}
// + Cutscene: a camera in front of the view, its first key = the view now, and the panel looking through it
function addCutscene() {
  const K = kit(), ed = E();
  K.pushUndo();
  const name = K.nextName('UCCutscene');
  const loc = ed.cameraPoint(120);
  const e = { name, cls: 'UCCutscene', loc, rot: [0, 0, 0], props: {}, radius: 16, height: 16 };
  ed.edits.added.push(e);
  const n = Object.keys(ed.edits.cutscenes || {}).length + 1;
  const c = cutOf(name, true);
  c.title = 'Cutscene ' + n;
  cur = null;
  const [p, r] = (() => { const pp = K.UE(ed.camera.position); return [pp, [ed.cam.pitch * YAW / TURN, ed.cam.yaw * YAW / TURN, 0]]; })();
  c.keys.push({ t: 0, p, r: r.map(Math.round), fov: DEFAULT_FOV, e: 1, s: 0 });
  K.setDirty();
  K.select(K.makeProxy(Object.assign({ kind: 'logic' }, e), 'added'));
  open(name, { look: true });
  K.log(`${c.title}: the first key is the view you had. Move the playhead, fly the camera (right mouse + WASD) and press K for each key; ▶ plays it. Then play it from an interaction (a collision box: 🔗 Connect to... → the camera) or from the Story.`, 'ok');
}

// ---------------------------------------------------------------- every frame
function frame(now) {
  requestAnimationFrame(frame);
  if (!E() || !E().cutKit) return;
  if (cur) {
    if (E().edits !== cur.lastEdits) {            // Ctrl+Z, another map: read it again
      cur.lastEdits = E().edits;
      if (!(E().edits.added || []).some((a) => a.name === cur.name)) { close(); return; }
      render();
    }
    if (cur.playing) {
      const c = cutOf(cur.name), len = lengthOf(c);
      cur.t = Math.min(len, cur.t + Math.min(0.1, (now - last) / 1000));
      if (cur.t >= len) {
        cur.playing = false;
        window.dispatchEvent(new CustomEvent('deusedix:cutscene-preview', { detail: { name: cur.name, keys: JSON.stringify(c.keys) } }));
        render();
      }
      goTo(cur.t);
      playhead();
      if (E().wake) E().wake(250);                 // the view draws every frame while it plays (app.js)
    }
    last = now;
    drawFilm();
    drawPath(cur.name, false);
    pathGroup.visible = !cur.playing;              // playing: the picture alone, as in the game
  } else {
    const a = E().selected && E().selected.userData && E().selected.userData.actor;
    drawPath(a && a.cls === 'UCCutscene' ? a.name : null, true);
    pathGroup.visible = true;
    film.style.display = 'none';
  }
  const edges = document.getElementById('lkedge');  // the labels of far links (app.js): not over the picture
  if (edges) edges.style.visibility = cur && cur.look ? 'hidden' : '';
}
requestAnimationFrame(frame);

// keys while the panel is open: K a key, Space play / pause, Esc stop / stop looking through
window.addEventListener('keydown', (e) => {
  if (!cur || e.ctrlKey || e.altKey) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'k') { e.preventDefault(); e.stopImmediatePropagation(); recordKey(); }
  else if (k === ' ' && !E().cam.look) { e.preventDefault(); e.stopImmediatePropagation(); if (cur.playing) stopPlay(); else startPlay(); }
  else if (k === 'escape' && (cur.playing || cur.look)) { e.preventDefault(); e.stopImmediatePropagation(); if (cur.playing) stopPlay(); else setLook(false); }
}, true);

// Check map: cutscenes without keys, cutscenes nothing plays
function check(add) {
  const ed = E();
  for (const a of ed.edits.added || []) {
    if (a.cls !== 'UCCutscene' || (ed.edits.deleted || {})[a.name]) continue;
    const c = cutOf(a.name), title = `Cutscene "${(c && c.title) || a.name}"`;
    if (!c || !c.keys.length) { add('error', `${title}: no camera keys (open it and press K).`, a.name); continue; }
    const played = kit().lkList().some((l) => (l.do || []).some((x) => x.verb === 'cutplay' && x.target === a.name)) || c.autoplay
      || JSON.stringify(window.__story && window.__story.data ? window.__story.data() : {}).includes(`"${a.name}"`);
    if (!played) add('warn', `${title}: nothing plays it (an interaction "Play the cutscene", a Story action, or "at the start of the map").`, a.name);
  }
}

window.__cutscene = { open, close, add: addCutscene, check, get playing() { return !!cur?.playing; }, isOpen: (name) => !!cur && (!name || cur.name === name), pose: (name, t) => pose(cutOf(name), t), lengthOf: (name) => lengthOf(cutOf(name) || {}) };
const addBtn = document.getElementById('addcut');
if (addBtn) addBtn.onclick = addCutscene;
