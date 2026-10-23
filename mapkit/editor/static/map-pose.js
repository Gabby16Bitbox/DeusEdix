// Pose here (Gabby, 18 Oct 2026): a character posed where it stands in the map, against the map around it (a
// hand on a railing, the back on a wall), instead of in the Animation Studio's empty room.
// The character is shown with the Studio's skeleton and IK (window.__studio.kit) at its own place. Handles:
// the hands (orange) and the feet (blue) stick to whatever is under the pointer (the map's surfaces and objects:
// a hand lies on it, the palm against it; a foot stands on it); the hips (green) move in the floor's plane
// (Shift: up and down; Ctrl: the whole character moves in the map, as its gizmo would). Alt: move freely,
// without sticking. Out of reach, a handle turns red. The panel leans, turns and bends the body, closes
// the hands (Grip) and keeps it breathing. Save: a Studio animation (anim.pose_here keeps the panel's values,
// to come back to it), baked on the character's models and given to it as what it does when idle, with Stays
// put (it never turns away from what it leans on). Esc or Cancel: nothing changes. Animate in the Studio: the pose
// saved as a new animation of its own and opened in the Animation Studio, to go on animating it from there.
// A hand that sticks closes by itself as on what it holds: round a railing or an edge (the surface ends just past
// the fingers), relaxed on a wide top; the Grip sliders override it. Start from (step b): a ready pose placed on
// what is clicked next: Railing (both hands on it), Elbows (leaning on it), Wall (the back against it), Table
// (both hands on the top), Sit (on an edge, facing the camera): the character turns, comes to the right distance
// (its place in the map moves: one undo) and puts its hands and feet down.
// Ctrl+Z / Ctrl+Y (and the arrows in the panel) step back and forth through the changes made while posing, the
// character's place in the map included; Reset is one of them. A stuck hand's or foot's handle stays where it
// touches (not on the wrist, which hangs in the air past the railing), and grabbing a handle never moves it: the
// limb only follows once the pointer moves.
const CHAINS = { l_arm: 'hand', r_arm: 'hand', l_leg: 'foot', r_leg: 'foot' };
const COLORS = { hand: 0xffa040, foot: 0x40a8ff, hips: 0x50d070 };
const PARAMS = { lean: 0, turn: 0, side: 0, gripL: null, gripR: null, breath: true };
const PRESETS = [['railing', 'Railing', 'Both hands on a railing: click its top'], ['elbows', 'Elbows', 'Leaning on a railing on the forearms: click its top'],
  ['wall', 'Wall', 'The back against a wall: click the wall'], ['table', 'Table', 'Both hands on a table: click its top'],
  ['sit', 'Sit', 'Sitting on an edge (a crate, a low wall, a bench), facing the camera: click its top'],
  ['floor', 'Floor', 'Sitting on the floor, the legs ahead, facing the camera: click the floor']];
const deg = (x) => x * Math.PI / 180;

const CSS = `.mp-panel { position:fixed; z-index:5; width:280px; box-sizing:border-box; padding:8px; color:var(--text);
    background:var(--panel); border:1px solid var(--accent-border, var(--line)); border-radius:var(--radius-window, 4px); box-shadow:0 14px 30px #0009; font-size:12px; }
  .mp-head { font-size:13px; font-weight:600; margin-bottom:4px; }
  .mp-hint, .mp-msg { font-size:11px; color:var(--dim); line-height:1.35; margin:0 0 6px; }
  .mp-msg { color:var(--warn); min-height:0; margin:4px 0; }
  .mp-dot { display:inline-block; width:8px; height:8px; border-radius:50%; vertical-align:middle; }
  .mp-dot.hand { background:#ffa040; } .mp-dot.foot { background:#40a8ff; } .mp-dot.hips { background:#50d070; border-radius:1px; }
  .mp-row { display:flex; align-items:center; gap:6px; height:22px; margin:2px 0; }
  .mp-row label { flex:0 0 64px; } .mp-row input[type=range] { flex:1; min-width:0; } .mp-row span { flex:0 0 36px; text-align:right; font-variant-numeric:tabular-nums; }
  .mp-check { display:flex; align-items:center; gap:6px; height:22px; }
  .mp-foot { display:flex; gap:4px; margin-top:6px; } .mp-foot button { height:22px; padding:0 8px; }
  .mp-presets { display:flex; gap:4px; margin:2px 0 6px; } .mp-presets button { flex:1; height:22px; padding:0 4px; min-width:0; }
  .mp-presets button.on { background:var(--primary-soft, #1f3b63); border-color:var(--acc); }`;

export function createMapPose(d) {
  const { THREE } = d;
  let S = null;
  if (!document.getElementById('map-pose-css')) {
    const st = document.createElement('style'); st.id = 'map-pose-css'; st.textContent = CSS; document.head.appendChild(st);
  }                  // the session: {g, a, info, grp, m, rig, anim, params, handles, drag, panel, ...}

  // ------------------------------------------------------------- the animation the panel and the handles make
  // two whole-body keys (0, and 15 a breath in), the limbs on IK keyed once (they stay where they were put)
  function rebuildKeys() {
    const K = S.K, p = S.params, f = S.rig.front || 1;
    const body = (breath) => {
      const pose = K.restPose();
      const lean = deg(p.lean) + (breath ? deg(1.2) : 0), turn = deg(p.turn), side = deg(p.side);
      const q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
      pose.rot[K.BI.spine] = q(f * side * 0.5, turn * 0.5, -f * lean * 0.45);
      pose.rot[K.BI.chest] = q(f * side * 0.5, turn * 0.5, -f * lean * 0.45 + (breath ? f * deg(2.2) : 0));
      pose.rot[K.BI.neck] = q(-f * side * 0.4, -turn * 0.3, f * lean * 0.35);          // the head keeps looking ahead
      pose.root.fromArray(S.root).add(new THREE.Vector3(0, breath && p.breath ? 0.3 : 0, 0));
      return pose;
    };
    S.anim.keys = [K.keyOf(0, body(false))];
    if (p.breath) S.anim.keys.push(K.keyOf(15, body(true)));
    delete S.anim.tracks; delete S.anim.curves;
    for (const [s, v] of [['l', p.gripL], ['r', p.gripR]]) {
      if (v == null) { if (S.anim.grip) delete S.anim.grip[s]; } else K.setGripKey(S.anim, s, 0, v);
    }
  }
  function poseNow(t = 0) {
    const f = S.params.breath ? (t * S.anim.fps) % S.anim.frames : 0;
    return S.K.fullPose(S.rig, S.anim, f);
  }
  // the character on screen in a pose, and the handles where its limbs and hips are
  function show(pose) {
    const out = S.out;
    S.K.skin(S.rig, S.m, pose, out);
    for (const { geo, idx } of S.grp.userData.anim.parts) {
      const arr = geo.attributes.position.array;
      for (let i = 0; i < idx.length; i++) { const v = idx[i] * 3; arr[3 * i] = out[v]; arr[3 * i + 1] = out[v + 1]; arr[3 * i + 2] = out[v + 2]; }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    }
    if (S.drag) return;
    const W = S.K.worldOf(S.rig, pose);
    for (const [chain, h] of Object.entries(S.handles)) {
      const at = chain === 'hips' ? W.Jw[S.K.BI.pelvis] : S.contact[chain] || new THREE.Vector3().fromArray(S.anim.ik[chain].keys[0].v);
      h.position.copy(S.grp.localToWorld(at.clone()));
    }
  }

  // ------------------------------------------------------------- sticking to the map
  function hitUnder(e) { return hitAt(e.clientX, e.clientY); }
  function hitAt(x, y) {
    const ray = d.mouseRay({ clientX: x, clientY: y });
    const hits = d.visibleHits(ray.intersectObjects([...d.world.children, ...d.proxies.children.filter((c) => c !== S.g)], true));
    const h = hits.find((x) => x.face);
    if (!h) return null;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    if (n.dot(ray.ray.direction) > 0) n.negate();                  // the side we see
    return { point: h.point.clone(), normal: n, dist: h.distance };
  }
  // what a dragged hand or foot lands on. A railing is thin: a pixel past its edge the ray finds the floor
  // behind it. So 16 rays round the pointer (up to 10 px, a quarter of a millisecond each) look round it: when
  // the pointer slips off what the limb was on onto something behind it (or onto nothing), the limb stays on it
  // until the pointer is clearly away; otherwise something just in front of the pointer wins (the railing over the
  // floor it stands out against: dragged along the floor towards a railing, the hand gets onto it)
  function hitNear(x, y, prev) {
    const H = worldH(), c = hitAt(x, y), ring = [];
    for (const r of [5, 10]) for (let i = 0; i < 8; i++) {
      const h = hitAt(x + r * Math.cos(i * Math.PI / 4), y + r * Math.sin(i * Math.PI / 4));
      if (h) ring.push(h);
    }
    if (prev && (!c || c.dist > d.camera.position.distanceTo(prev) + 0.05 * H)) {
      let stay = null;
      for (const h of ring) if (h.point.distanceTo(prev) < 0.1 * H && (!stay || h.point.distanceTo(prev) < stay.point.distanceTo(prev))) stay = h;
      if (stay) return stay;
    }
    let front = null;
    for (const h of ring) if (!front || h.dist < front.dist) front = h;
    return front && (!c || front.dist < c.dist - 0.1 * H) ? front : c;
  }
  function hitRay(origin, dir, far) {
    const rc = new THREE.Raycaster(origin, dir.clone().normalize(), 0, far);
    rc.camera = d.camera;                                      // the icons (sprites) need it
    const h = d.visibleHits(rc.intersectObjects([...d.world.children, ...d.proxies.children.filter((c) => c !== S.g)], true)).find((x) => x.face);
    if (!h) return null;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    if (n.dot(dir) > 0) n.negate();
    return { point: h.point.clone(), normal: n };
  }
  const worldH = () => S.rig.H * S.grp.getWorldScale(new THREE.Vector3()).x;
  const dirToWorld = (v) => S.grp.localToWorld(v.clone()).sub(S.grp.localToWorld(new THREE.Vector3())).normalize();
  // how the hand closes on what it is put on: the surface ends just past the fingers (a railing, an edge) or not
  function autoGrip(s, hit, along) {
    if (S.gripManual[s]) return;
    const H = worldH(), n = hit.normal;
    let missed = 0;
    for (const k of [0.04, 0.08, 0.12]) {
      const o = hit.point.clone().addScaledVector(along, k * H).addScaledVector(n, 0.03 * H);
      if (!hitRay(o, n.clone().negate(), 0.06 * H)) missed++;
    }
    const key = s === 'l' ? 'gripL' : 'gripR';
    S.params[key] = missed >= 2 ? 0.8 : missed === 1 ? 0.45 : 0.12;
    const input = S.panel?.querySelector(`[data-grip="${key}"]`);
    if (input) { input.value = Math.round(100 * S.params[key]); input.nextElementSibling.textContent = input.value + '%'; }
    rebuildKeys();
  }
  const toLocal = (v) => S.grp.worldToLocal(v.clone());
  const dirToLocal = (n) => toLocal(S.grp.localToWorld(new THREE.Vector3()).add(n)).normalize();
  // a hand on a surface: the palm against it, the fingers along it away from the shoulder, the wrist back
  function handOn(chain, hit) {
    const s = chain[0], key = S.anim.ik[chain].keys[0];
    const n = dirToLocal(hit.normal), point = toLocal(hit.point);
    S.contact[chain] = point.clone();                          // where it touches: its handle stays there
    const q0 = new THREE.Quaternion().fromArray(key.q);
    // the fingers go on away from the shoulder, along the surface, as when reaching for it. (The way the hand
    // pointed before is only a fallback: a hanging hand's fingers point down, and what is left of that way along
    // a top is noise, so they pointed sideways, and kept it when the hand slid from the floor onto a railing)
    const W = S.K.worldOf(S.rig, poseNow()), sh = W.Jw[S.K.BI[S.K.CHAINS[chain].bones[0]]];
    let a1 = point.clone().sub(sh);
    a1.addScaledVector(n, -a1.dot(n));
    if (a1.lengthSq() < 0.04 * point.distanceToSquared(sh)) {      // right under the shoulder: the hand's own way
      a1 = S.hand[s].along.clone().applyQuaternion(q0);
      a1.addScaledVector(n, -a1.dot(n));
    }
    if (a1.lengthSq() < 1e-4) a1 = new THREE.Vector3(S.rig.front || 1, 0, 0).addScaledVector(n, -n.x * (S.rig.front || 1));
    a1.normalize();
    const p1 = n.clone().negate();
    const M0 = new THREE.Matrix4().makeBasis(S.hand[s].along, S.hand[s].palm, S.hand[s].along.clone().cross(S.hand[s].palm));
    const M1 = new THREE.Matrix4().makeBasis(a1, p1, a1.clone().cross(p1));
    const q = new THREE.Quaternion().setFromRotationMatrix(M1.multiply(M0.transpose()));
    const wrist = point.addScaledVector(n, S.hand[s].thick).addScaledVector(a1, -S.hand[s].palmAt);
    setLimb(chain, wrist, q);
    S.stuck.add(chain);                                        // it holds on: it stays there if the character moves
    autoGrip(s, hit, dirToWorld(a1));
  }
  function footOn(chain, hit) {
    const point = toLocal(hit.point), up = dirToLocal(hit.normal);
    S.contact[chain] = point.clone();
    setLimb(chain, point.addScaledVector(up.y > 0.5 ? new THREE.Vector3(0, 1, 0) : up, S.ankle), null);
  }
  // a limb's controller moved: its pole follows (the knee keeps pointing the same way). An elbow points down, out
  // and a little back, square to the arm: the arm's own offset as it hangs points back, along the arm once the hand
  // is forward at chest height, and the elbow then flipped round
  function setLimb(chain, v, q) {
    const key = S.anim.ik[chain].keys[0], W = S.K.worldOf(S.rig, poseNow());
    const top = W.Jw[S.K.BI[S.K.CHAINS[chain].bones[0]]];
    const mid = top.clone().add(v).multiplyScalar(0.5);
    let off = S.poleOff[chain];
    if (CHAINS[chain] === 'hand') {
      const dir = v.clone().sub(top).normalize(), f = S.rig.front || 1;
      const out = Math.sign(S.rig.joints[S.K.BI[chain[0] + '_hand']][2]) || (chain[0] === 'l' ? 1 : -1);
      const want = new THREE.Vector3(-0.4 * f, -1, 0.6 * out);
      want.addScaledVector(dir, -want.dot(dir));
      if (want.lengthSq() < 1e-4) want.set(-f, 0, 0).addScaledVector(dir, -dir.x * -f);
      off = want.setLength(Math.max(off.length(), 0.1 * S.rig.H));
    }
    S.K.writeIKKey(S.anim, chain, 0, { v: v.toArray(), q: q ? q.toArray() : key.q, pole: mid.add(off).toArray() });
    // too far for the arm or the leg: the handle turns red and the panel says what to do
    const [a, b, c] = S.K.CHAINS[chain].bones.map((n) => new THREE.Vector3().fromArray(S.rig.joints[S.K.BI[n]]));
    const reach = a.distanceTo(b) + b.distanceTo(c), far = top.distanceTo(v);
    S.handles[chain].material.color.set(far > reach * 1.02 ? 0xff3b3b : COLORS[CHAINS[chain]]);
    status(far > reach * 1.02 ? `Out of reach (${Math.round(far)} units, the ${CHAINS[chain] === 'hand' ? 'arm' : 'leg'} reaches ${Math.round(reach)}): move the character closer in the map, or its hips.` : '');
  }

  // ------------------------------------------------------------- the handles
  function makeHandles() {
    const H = S.rig.H, out = {};
    for (const [chain, kind] of [...Object.entries(CHAINS), ['hips', 'hips']]) {
      const geo = kind === 'hips' ? new THREE.BoxGeometry(H * 0.07, H * 0.07, H * 0.07) : new THREE.SphereGeometry(H * 0.03, 16, 12);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COLORS[kind], transparent: true, opacity: 0.85, depthTest: false }));
      m.renderOrder = 20;
      m.userData.poseHandle = chain;
      m.scale.setScalar(S.grp.getWorldScale(new THREE.Vector3()).x);
      d.scene.add(m);
      out[chain] = m;
    }
    return out;
  }
  // the handle under the pointer, on the screen (14 px round it): a hand or a foot before the hips, which hang
  // by them when the arms are down
  function handleUnder(e) {
    let best = null, bestD = 14;
    for (const pass of ['limbs', 'hips']) {
      for (const chain of Object.keys(S.handles)) {
        if ((chain === 'hips') !== (pass === 'hips')) continue;
        const [x, y] = handleScreen(chain), dist = Math.hypot(x - e.clientX, y - e.clientY);
        if (dist < bestD) { best = chain; bestD = dist; }
      }
      if (best) return best;
    }
    return null;
  }
  function onDown(e) {
    if (!S || e.button !== 0) return;
    const chain = handleUnder(e);
    e.stopImmediatePropagation(); e.preventDefault();          // no selecting other objects while posing
    if (S.preset && !chain) {
      const hit = hitUnder(e), kind = S.preset;
      if (hit) { S.preset = null; markPreset(); applyPreset(kind, hit); }
      return;
    }
    if (!chain) return;
    d.canvas.setPointerCapture(e.pointerId);
    const h = S.handles[chain], [hx, hy] = handleScreen(chain);
    S.drag = { chain, start: h.position.clone(), y: e.clientY, root: S.root.slice(), moveChar: chain === 'hips' && e.ctrlKey, at: S.g.position.clone(),
      x0: e.clientX, y0: e.clientY, off: [hx - e.clientX, hy - e.clientY],   // the ray from the handle's own spot, not the pointer's
      prev: S.contact[chain] ? h.position.clone() : null, before: snapshot() };
    if (S.drag.moveChar) {                                         // the character's place in the map: one undo
      d.pushUndo();
      // the hands stay where they hold (in the map), the feet go with the body
      S.drag.hands = Object.fromEntries(['l_arm', 'r_arm'].filter((c) => S.stuck.has(c)).map((c) => [c, S.grp.localToWorld(new THREE.Vector3().fromArray(S.anim.ik[c].keys[0].v))]));
      S.drag.touch = Object.fromEntries(Object.keys(S.drag.hands).filter((c) => S.contact[c]).map((c) => [c, S.grp.localToWorld(S.contact[c].clone())]));
    }
    status(S.drag.moveChar ? 'Moving the character in the map.' : chain === 'hips' ? 'Move the hips (Shift: up and down).' : `Drag onto a surface: the ${CHAINS[chain]} sticks to it (Alt: no sticking).`);
  }
  function onMove(e) {
    if (!S) return;
    if (!S.drag) { d.canvas.style.cursor = handleUnder(e) ? 'grab' : ''; return; }
    e.stopImmediatePropagation();
    if (!S.drag.moved && Math.hypot(e.clientX - S.drag.x0, e.clientY - S.drag.y0) < 3) return;   // a click on a handle moves nothing
    S.drag.moved = true;
    const { chain } = S.drag, h = S.handles[chain];
    const x = e.clientX + S.drag.off[0], y = e.clientY + S.drag.off[1], ray = d.mouseRay({ clientX: x, clientY: y }).ray;
    if (chain === 'hips' && S.drag.moveChar) {                 // the whole character, in the floor's plane
      const to = new THREE.Vector3();
      if (!ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -S.drag.start.y), to)) return;
      const delta = to.sub(S.drag.start).setY(0);
      if (delta.length() > S.rig.H * 4) delta.setLength(S.rig.H * 4);
      S.g.position.copy(S.drag.at).add(delta);
      S.g.updateMatrixWorld(true);
      for (const [c, w] of Object.entries(S.drag.hands)) setLimb(c, toLocal(w), null);
      for (const [c, w] of Object.entries(S.drag.touch)) S.contact[c] = toLocal(w);
      S.drag.start2 = true;
    } else if (chain === 'hips') {
      let to;
      if (e.shiftKey) to = S.drag.start.clone().setY(S.drag.start.y + (S.drag.y - e.clientY) * S.rig.H / 300);
      else { to = new THREE.Vector3(); if (!ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -S.drag.start.y), to)) return; }
      const far = S.rig.H * 0.6 * S.grp.getWorldScale(new THREE.Vector3()).x;   // the hips stay over the feet
      if (to.distanceTo(S.drag.start) > far) to.sub(S.drag.start).setLength(far).add(S.drag.start);
      h.position.copy(to);
      const delta = toLocal(to).sub(toLocal(S.drag.start));
      S.root = S.drag.root.map((x, i) => x + delta.getComponent(i));
      rebuildKeys();
    } else {
      const hit = !e.altKey && hitNear(x, y, S.drag.prev);
      if (hit) {
        h.position.copy(hit.point);
        if (CHAINS[chain] === 'hand') handOn(chain, hit); else footOn(chain, hit);
        S.drag.prev = hit.point.clone();
      } else {                                                   // free: in the plane facing the camera
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(d.camera.getWorldDirection(new THREE.Vector3()).negate(), h.position);
        const to = new THREE.Vector3();
        if (!ray.intersectPlane(plane, to)) return;
        h.position.copy(to);
        setLimb(chain, toLocal(to), null);
        S.stuck.delete(chain);
        delete S.contact[chain];
        S.drag.prev = null;
      }
    }
    show(poseNow());
    d.wake();
  }
  function onUp(e) {
    if (!S || e.button !== 0) return;
    e.stopImmediatePropagation();                              // no picking on the way up either
    if (!S.drag) return;
    if (S.drag.moveChar && S.drag.start2) { d.commit(S.g); status(''); }
    if (S.drag.moved) remember(S.drag.before);
    S.drag = null;
    show(poseNow());
  }
  const swallow = (e) => { if (S && e.button === 0) { e.stopImmediatePropagation(); e.preventDefault(); } };
  function onKey(e) {
    if (!S) return;
    if (e.key === 'Escape') {
      e.stopImmediatePropagation(); e.preventDefault();
      if (S.preset) { S.preset = null; markPreset(); status(''); } else close();
      return;
    }
    // while posing, Ctrl+Z / Ctrl+Y are the pose's own (the map's undo would take the character's pose away)
    const k = e.key.toLowerCase();
    if (e.ctrlKey && (k === 'z' || k === 'y')) {
      e.stopImmediatePropagation(); e.preventDefault();
      if (!S.drag) step(k === 'y' || e.shiftKey ? 'redo' : 'undo');
    }
  }

  // ------------------------------------------------------------- undo and redo, while posing
  // the whole state of the pose (the animation's keys, the panel, the hips, what the hands hold) and the
  // character's place and turn in the map (the presets and Ctrl move it)
  function snapshot() {
    return JSON.stringify({ anim: S.anim, params: S.params, root: S.root, stuck: [...S.stuck], gripManual: S.gripManual,
      contact: Object.fromEntries(Object.entries(S.contact).map(([c, v]) => [c, v.toArray()])),
      pos: S.g.position.toArray(), rot: S.g.rotation.y });
  }
  function remember(before) {
    if (before === snapshot()) return;
    S.undo.push(before);
    if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
    markHistory();
  }
  function restore(json) {
    const s = JSON.parse(json), moved = !S.g.position.equals(new THREE.Vector3().fromArray(s.pos)) || S.g.rotation.y !== s.rot;
    Object.assign(S, { anim: s.anim, params: s.params, root: s.root, stuck: new Set(s.stuck), gripManual: s.gripManual });
    S.contact = Object.fromEntries(Object.entries(s.contact).map(([c, v]) => [c, new THREE.Vector3().fromArray(v)]));
    if (moved) {
      S.g.position.fromArray(s.pos); S.g.rotation.y = s.rot;
      S.g.updateMatrixWorld(true);
      d.commit(S.g);
    }
    for (const [chain, h] of Object.entries(S.handles)) h.material.color.set(COLORS[CHAINS[chain] || 'hips']);
    S.panel.replaceWith(panel());
    placePanel();
    show(poseNow());
    d.wake();
  }
  function step(way) {
    const from = way === 'undo' ? S.undo : S.redo, to = way === 'undo' ? S.redo : S.undo;
    if (!from.length) { status(way === 'undo' ? 'Nothing to undo in this pose.' : 'Nothing to redo.'); return; }
    to.push(snapshot());
    restore(from.pop());
    status(way === 'undo' ? 'Undone.' : 'Redone.');
  }
  function markHistory() {
    const u = S?.panel?.querySelector('[data-undo]'), r = S?.panel?.querySelector('[data-redo]');
    if (u) u.disabled = !S.undo.length;
    if (r) r.disabled = !S.redo.length;
  }

  // ------------------------------------------------------------- the panel
  function status(t) { const el = S?.panel?.querySelector('.mp-msg'); if (el) el.textContent = t; }
  function panel() {
    const el = document.createElement('div');
    el.className = 'mp-panel';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Pose here');
    const p = S.params, sl = (k, label, min, max, tip, unit = '°') =>
      `<div class="mp-row" title="${tip}"><label>${label}</label><input type="range" min="${min}" max="${max}" value="${p[k]}" data-p="${k}"><span>${p[k]}${unit}</span></div>`;
    const grip = (k, label, s) => {
      const shape = S.grips[s], v = Math.round(100 * (p[k] ?? shape?.rest ?? 0));
      return `<div class="mp-row" title="How far the hand is closed (as the game closes this model's hands)"><label>${label}</label><input type="range" min="0" max="100" value="${v}" data-grip="${k}" ${shape ? '' : 'disabled'}><span>${v}%</span></div>`;
    };
    el.innerHTML = `<div class="mp-head"><b>Pose here · ${esc(S.a.name)}</b></div>
      <div class="mp-hint">Drag the <i class="mp-dot hand"></i> hands and the <i class="mp-dot foot"></i> feet onto the map: they stick to what is under the pointer (Alt: free). <i class="mp-dot hips"></i> moves the hips (Shift: up and down; Ctrl: the whole character, to bring it closer).</div>
      <div class="mp-presets" role="group" aria-label="Start from a pose">${PRESETS.map(([k, l, tip]) => `<button type="button" data-preset="${k}" title="${tip}">${l}</button>`).join('')}</div>
      ${sl('lean', 'Lean', -40, 60, 'Lean forward (or back)')}${sl('turn', 'Turn', -60, 60, 'Turn the upper body')}${sl('side', 'Bend', -30, 30, 'Bend to a side')}
      ${grip('gripL', 'Left grip', 'l')}${grip('gripR', 'Right grip', 'r')}
      <label class="mp-check" title="The chest rises and falls a little, so that it does not look like a statue"><input type="checkbox" data-breath ${p.breath ? 'checked' : ''}> Breathing</label>
      <div class="mp-msg" role="status"></div>
      <div class="mp-foot"><button type="button" data-animate style="flex:1" title="Save the pose as a new animation of the Animation Studio and open it there, to go on animating it (${esc(S.a.name)} does not change)">Animate in the Studio…</button></div>
      <div class="mp-foot"><button type="button" data-undo title="Undo the last change to the pose (Ctrl+Z)" aria-label="Undo">↶</button><button type="button" data-redo title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
        <button type="button" data-reset title="Stand up again (the hands and feet as the model stands). Ctrl+Z brings the pose back">Reset</button><span style="flex:1"></span>
        <button type="button" data-cancel title="Leave without changing anything (Esc)">Cancel</button>
        <button type="button" class="primary" data-save title="Save it as an animation of the Animation Studio and give it to ${esc(S.a.name)} for when idle">Save</button></div>`;
    // a slider's drag is one step back for Ctrl+Z: the state before its first move, kept until it is let go
    const slid = () => { if (!S.slideBefore) S.slideBefore = snapshot(); };
    for (const i of el.querySelectorAll('[data-p], [data-grip]')) i.addEventListener('change', () => { if (S.slideBefore) remember(S.slideBefore); S.slideBefore = null; });
    for (const i of el.querySelectorAll('[data-p]')) i.oninput = () => { slid(); S.params[i.dataset.p] = +i.value; i.nextElementSibling.textContent = i.value + '°'; rebuildKeys(); show(poseNow()); d.wake(); };
    for (const b of el.querySelectorAll('[data-preset]')) b.onclick = () => {
      S.preset = S.preset === b.dataset.preset ? null : b.dataset.preset;
      markPreset();
      status(S.preset ? PRESETS.find((p) => p[0] === S.preset)[2] + ' (Esc: no).' : '');
    };
    for (const i of el.querySelectorAll('[data-grip]')) i.oninput = () => { slid(); S.params[i.dataset.grip] = +i.value / 100; S.gripManual[i.dataset.grip === 'gripL' ? 'l' : 'r'] = true; i.nextElementSibling.textContent = i.value + '%'; rebuildKeys(); show(poseNow()); d.wake(); };
    el.querySelector('[data-breath]').onchange = (e) => { const before = snapshot(); S.params.breath = e.target.checked; rebuildKeys(); remember(before); };
    el.querySelector('[data-reset]').onclick = () => { const before = snapshot(); start(true); el.replaceWith(panel()); placePanel(); remember(before); status('Standing again (Ctrl+Z: the pose back).'); };
    el.querySelector('[data-undo]').onclick = () => step('undo');
    el.querySelector('[data-redo]').onclick = () => step('redo');
    el.querySelector('[data-cancel]').onclick = () => close();
    el.querySelector('[data-save]').onclick = () => save().catch((err) => status('Save: ' + err.message));
    el.querySelector('[data-animate]').onclick = () => animate().catch((err) => status('Animate: ' + err.message));
    S.panel = el;
    markHistory();
    return el;
  }
  function markPreset() {
    for (const b of S?.panel?.querySelectorAll('[data-preset]') || []) { const on = b.dataset.preset === S.preset; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------- open, save, close
  async function open(g) {
    const a = g?.userData?.actor;
    if (!a) return;
    if (S) close();
    const St = window.__studio;
    if (!St?.rigFor) { d.log('Pose here: the Animation Studio is not loaded (restart DeusEdix).', 'bad'); return; }
    d.stopPreview();
    d.select(null);                                            // its gizmo away: the handles take the clicks
    const info = await d.animsOf(a.cls, d.meshOf(a));
    if (!info) { d.log(`${a.name} has no animated model to pose.`, 'warn'); return; }
    const dmap = await d.animFrames(info);
    const grp = d.animatedModel(g, info, dmap);
    if (!grp.children.length) { d.log('This character has no model to pose here.', 'warn'); return; }
    d.fitAnimated(g, info, dmap, grp);
    const mesh = info.mesh || d.meshOf(a);
    d.status(`Pose here: reading ${a.name}'s skeleton...`);
    const m = await St.loadModel(mesh), rig = await St.rigFor(mesh, m);
    S = { g, a, info, grp, m, rig, K: St.kit, St, out: new Float32Array(m.FV * 3), mesh, stuck: new Set(), gripManual: {}, contact: {}, undo: [], redo: [] };
    S.grips = St.kit.gripsOf(rig, m);
    measureBody();
    // what it did when idle, if it was posed here before: back to that pose
    const e = (d.edits().anims || {})[a.name] || {};
    let before = null;
    if (e.own && e.idle) before = await d.api('/api/studio_anim?name=' + encodeURIComponent(e.idle)).catch(() => null);
    if (before?.pose_here) {
      S.anim = before; S.params = Object.assign({}, PARAMS, before.pose_here.params); S.root = before.pose_here.root || [0, 0, 0];
      S.name = before.name;
      for (const [c, v] of Object.entries(before.pose_here.contact || {})) {   // what the hands and feet touched
        S.contact[c] = new THREE.Vector3().fromArray(v);
        if (CHAINS[c] === 'hand') S.stuck.add(c);
      }
    } else start(false);
    S.poleOff = {};
    {
      const W = S.K.worldOf(S.rig, S.K.fullPose(S.rig, S.anim, 0));
      for (const chain of Object.keys(CHAINS)) {
        const k = S.anim.ik[chain].keys[0], top = W.Jw[S.K.BI[S.K.CHAINS[chain].bones[0]]];
        S.poleOff[chain] = new THREE.Vector3().fromArray(k.pole).sub(top.clone().add(new THREE.Vector3().fromArray(k.v)).multiplyScalar(0.5));
      }
    }
    g.add(grp);
    if (g.userData.model) g.userData.model.visible = false;
    S.handles = makeHandles();
    S.g.updateMatrixWorld(true);
    show(poseNow());                                           // in place at once, before the first frame
    document.body.appendChild(panel());
    placePanel();
    window.addEventListener('resize', placePanel);
    for (const [ev, fn] of [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['click', swallow], ['dblclick', swallow]]) d.canvas.addEventListener(ev, fn, true);
    window.addEventListener('keydown', onKey, true);
    const t0 = performance.now();
    const tick = (now) => {
      if (!S || S.g !== g) return;
      if (!S.drag) show(poseNow((now - t0) / 1000));
      d.wake(300);
      S.raf = requestAnimationFrame(tick);
    };
    S.raf = requestAnimationFrame(tick);
    d.status(`Posing ${a.name}: drag its hands and feet onto the map. Save gives it the pose; Esc leaves.`);
  }
  // a new pose: standing as the model stands, each limb on IK where it is
  function start(reset) {
    S.stuck?.clear();
    S.contact = {};
    S.gripManual = {};
    S.params = Object.assign({}, PARAMS);
    S.root = [0, 0, 0];
    S.anim = { name: S.name || '', fps: 15, frames: 30, loop: true, interp: 'smooth', source: 'made', made_on: S.mesh, rig: S.St.RIG_VERSION, keys: [] };
    rebuildKeys();
    const pose = S.K.fullPose(S.rig, S.anim, 0);
    for (const chain of Object.keys(CHAINS)) S.K.writeIKKey(S.anim, chain, 0, S.K.ikFromPose(S.rig, pose, chain));
    if (reset) {
      for (const [chain, h] of Object.entries(S.handles || {})) h.material.color.set(COLORS[CHAINS[chain] || 'hips']);
      status('');
      show(poseNow());
    }
  }
  // the hands' own axes (as they hang: fingers down the hand, the palm towards the body), the ankle's height
  function measureBody() {
    const K = S.K, J = (n) => new THREE.Vector3().fromArray(S.rig.joints[K.BI[n]]);
    S.hand = {};
    for (const s of ['l', 'r']) {
      const w = J(s + '_hand'), tip = new THREE.Vector3().fromArray(S.rig.tails[K.BI[s + '_hand']]);
      const along = tip.clone().sub(w), L = along.length();
      along.normalize();
      const palm = J('pelvis').sub(w); palm.addScaledVector(along, -palm.dot(along)).normalize();
      S.hand[s] = { along, palm, palmAt: 0.45 * L, thick: 0.18 * L };
    }
    const P = K.framePos(S.m, S.rig.ref);
    let minY = Infinity;
    for (let i = 1; i < P.length; i += 3) minY = Math.min(minY, P[i]);
    S.ankle = Math.max(1, J('l_foot').y - minY);
  }
  async function save() {
    const a = S.a;
    status('Saving...');
    if (!S.name) {
      const list = await d.api('/api/studio');
      const used = new Set((list.anims || []).map((x) => x.name.toLowerCase()));
      const base = 'Pose' + String(a.name).replace(/\W/g, '').slice(0, 30);
      let name = base, i = 2;
      while (used.has(name.toLowerCase())) name = base + i++;
      S.name = name;
    }
    rebuildKeys();
    const anim = JSON.parse(JSON.stringify(S.anim));
    anim.name = S.name;
    anim.pose_here = { char: a.name, params: S.params, root: S.root,
      contact: Object.fromEntries(Object.entries(S.contact).map(([c, v]) => [c, v.toArray()])) };
    await S.St.store(anim, a.cls, (t) => status(t));
    d.pushUndo();
    const edits = d.edits();
    edits.anims = edits.anims || {};
    edits.anims[a.name] = Object.assign({}, edits.anims[a.name], { idle: anim.name, rate: 1, own: true, still: true, loc: d.UE(S.g.position) });
    window.__editor?.standForIdle?.(a.name);       // the pose plays while they stand (a scientist wanders by default)
    d.setDirty();
    const name = anim.name;
    close();
    d.animsChanged();
    d.status(`${a.name} keeps the pose ${name} when idle, and stays put: Rebuild to put it in the map.`, 'ok');
  }
  // Animate: the pose as the start of an animation of its own, opened in the Animation Studio to go on with it
  // (Gabby, 20 Oct 2026). The character plays it when idle; it carries no pose_here: Pose here would rebuild its
  // keys from the panel and lose what is animated in the Studio.
  async function animate() {
    const a = S.a, cls = a.cls;
    const list = await d.api('/api/studio');
    const used = new Set((list.anims || []).map((x) => x.name.toLowerCase()));
    const base = 'Anim' + String(a.name).replace(/\W/g, '').slice(0, 30);
    let name = base, i = 2;
    while (used.has(name.toLowerCase())) name = base + i++;
    const typed = prompt('Name of the new animation (letters, digits, _). It starts from this pose and opens in the Animation Studio:', name);
    if (typed == null) return;
    name = typed.trim().replace(/\W/g, '');
    if (!name) { status('A name is needed (letters, digits, _).'); return; }
    if (used.has(name.toLowerCase())) { status(`There is an animation called ${name} already: choose another name.`); return; }
    status('Saving...');
    rebuildKeys();
    const anim = JSON.parse(JSON.stringify(S.anim));
    anim.name = name;
    anim.source = 'made';
    delete anim.pose_here;
    await d.api('/api/studio_anim', anim);
    // it is the character's animation when idle at once (Crypt Test, 20 Oct 2026: it had to be picked by hand
    // afterwards); the Studio's Save bakes it on the character's models
    d.pushUndo();
    const edits = d.edits();
    edits.anims = edits.anims || {};
    edits.anims[a.name] = Object.assign({}, edits.anims[a.name], { idle: name, rate: 1, own: true, still: true, loc: d.UE(S.g.position) });
    window.__editor?.standForIdle?.(a.name);
    d.setDirty();
    close();
    d.animsChanged();
    if (!window.__studio?.editAnim) { d.status(`The animation ${name} is saved and ${a.name} plays it when idle: open it in the Animation Studio.`, 'ok'); return; }
    await window.__studio.open(cls);
    await window.__studio.editAnim(name);
    d.status(`${name} starts from the pose and ${a.name} plays it when idle: animate it, then Save in the Studio.`, 'ok');
  }
  function close() {
    if (!S) return;
    cancelAnimationFrame(S.raf);
    for (const [ev, fn] of [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['click', swallow], ['dblclick', swallow]]) d.canvas.removeEventListener(ev, fn, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', placePanel);
    for (const h of Object.values(S.handles || {})) { d.scene.remove(h); h.geometry.dispose(); h.material.dispose(); }
    S.g.remove(S.grp);
    if (S.g.userData.model) S.g.userData.model.visible = true;
    S.panel?.remove();
    d.canvas.style.cursor = '';
    S = null;
    d.wake();
  }
  // ------------------------------------------------------------- ready poses, put on what was clicked
  // the character turned so that its front looks along F (world, level)
  function face(F) {
    const cur = dirToWorld(new THREE.Vector3(S.rig.front || 1, 0, 0)).setY(0).normalize();
    const ang = Math.atan2(cur.z * F.x - cur.x * F.z, cur.dot(F));
    S.g.rotation.y += ang;
    S.g.updateMatrixWorld(true);
  }
  function sideOf(s) {                                        // a side of the body, in the map
    return dirToWorld(new THREE.Vector3(0, 0, Math.sign(S.rig.joints[S.K.BI[s + '_hand']][2]) || (s === 'l' ? 1 : -1))).setY(0).normalize();
  }
  function topNear(p, H) {                                    // the top of what is under a point (a railing, a table)
    return hitRay(p.clone().add(new THREE.Vector3(0, 0.12 * H, 0)), new THREE.Vector3(0, -1, 0), 0.3 * H) || { point: p.clone(), normal: new THREE.Vector3(0, 1, 0) };
  }
  function applyPreset(kind, hit) {
    const H = worldH(), top = hit.normal.y > 0.5;
    if ((kind === 'wall') === top || (kind === 'wall' && Math.abs(hit.normal.y) > 0.5)) {
      status(kind === 'wall' ? 'Click the wall itself (a vertical surface).' : 'Click the top of it (a surface facing up).');
      S.preset = kind; markPreset();
      return;
    }
    const before = snapshot();
    d.pushUndo();
    start(true);
    const p = S.params;
    S.front = null;                                           // set by railing, table and elbows only
    if (kind === 'wall') {
      const F = hit.normal.clone().setY(0).normalize();        // looking away from the wall
      face(F);
      S.g.position.set(hit.point.x + F.x * 0.17 * H, S.g.position.y, hit.point.z + F.z * 0.17 * H);
      p.lean = -5;
    } else if (kind === 'sit' || kind === 'floor') {
      const F = d.camera.position.clone().sub(hit.point).setY(0).normalize();
      face(F);
      S.g.position.set(hit.point.x - F.x * 0.03 * H, S.g.position.y, hit.point.z - F.z * 0.03 * H);
      p.lean = kind === 'floor' ? -8 : 6;
    } else {
      const F = hit.point.clone().sub(S.g.position).setY(0).normalize();
      face(F);
      const dist = { railing: 0.3, table: 0.3, elbows: 0.25 }[kind] * H;
      S.g.position.set(hit.point.x - F.x * dist, S.g.position.y, hit.point.z - F.z * dist);
      p.lean = { railing: 8, table: 18, elbows: 38 }[kind];
      // never into what is held: its front face, found from outside just under the top, keeps the body away
      // (Crypt Test, 20 Oct 2026: clicked deep on an altar, the priest stood inside it)
      const probe = hit.point.clone().addScaledVector(F, -1.2 * H).add(new THREE.Vector3(0, -0.06 * H, 0));
      const front = hitRay(probe, F, 1.4 * H);
      S.front = front ? front.point.dot(F) : null;
      if (S.front !== null) {
        const over = S.g.position.dot(F) - (S.front - 0.17 * H);
        if (over > 0) { S.g.position.addScaledVector(F, -over); S.g.updateMatrixWorld(true); }
      }
    }
    S.g.updateMatrixWorld(true);
    rebuildKeys();
    if (kind === 'sit' || kind === 'floor') {                 // the hips down on the seat (or the floor), the feet ahead
      const W = S.K.worldOf(S.rig, poseNow());
      const hips = S.grp.localToWorld(W.Jw[S.K.BI.pelvis].clone());
      const drop = Math.min(0, (hit.point.y + (kind === 'floor' ? 0.06 : 0.04) * H - hips.y) / S.grp.getWorldScale(new THREE.Vector3()).x);   // never up
      S.root = [0, drop, 0];
      rebuildKeys();
      const f = S.rig.front || 1, Hc = S.rig.H;
      const fk = S.St.poseAt(S.anim, 0);                     // the hands come down with the body, onto the thighs
      for (const s of ['l', 'r']) {
        const t = S.K.ikFromPose(S.rig, fk, s + '_arm'), v = new THREE.Vector3().fromArray(t.v);
        if (kind === 'floor') { v.x -= f * 0.04 * Hc; v.y -= 0.16 * Hc; }        // the hands on the floor, by the hips
        else { v.x += f * 0.12 * Hc; v.y += 0.03 * Hc; }
        S.K.writeIKKey(S.anim, s + '_arm', 0, { v: v.toArray(), q: t.q, pole: t.pole });
      }
      for (const s of ['l', 'r']) {                          // the feet ahead, on the model's own floor
        const k = S.anim.ik[s + '_leg'].keys[0], v = new THREE.Vector3().fromArray(k.v);
        v.x += f * (kind === 'floor' ? 0.5 : 0.32) * Hc;
        v.z += Math.sign(v.z || (s === 'l' ? 1 : -1)) * 0.03 * Hc;
        setLimb(s + '_leg', v, null);
      }
    }
    if (kind !== 'wall' && kind !== 'sit') {                  // the hands on the top, either side of the point clicked
      const spread = { railing: 0.1, table: 0.09, elbows: 0.05 }[kind] * H;
      const F = dirToWorld(new THREE.Vector3(S.rig.front || 1, 0, 0)).setY(0).normalize();
      const tops = {};
      for (const s of ['l', 'r']) tops[s] = topNear(hit.point.clone().addScaledVector(sideOf(s), spread).addScaledVector(F, kind === 'elbows' ? -0.02 * H : 0), H);
      approach(tops, F, H);
      for (const s of ['l', 'r']) handOn(s + '_arm', tops[s]);
      if (kind === 'elbows') { p.gripL = 0.3; p.gripR = 0.3; }            // forearms on it: the hands relaxed
    }
    rebuildKeys();
    d.commit(S.g);                                            // its place and its turn in the map
    S.panel.replaceWith(panel());
    placePanel();
    show(poseNow());
    remember(before);
    const seat = kind === 'sit' && S.root[1] > -0.12 * S.rig.H;          // the hips hardly go down: a seat too high
    status(seat ? 'Too high to sit on with the feet on the floor: pick something lower (a crate, a low wall, a bench).'
      : `${PRESETS.find((x) => x[0] === kind)[1]}: adjust the handles if needed, then Save.`);
  }

  // close enough for the arms to reach the points (the hand's palm where the wrist ends), never into what is held
  // (the body keeps 0.17 of its height from the points); leaning more when it cannot come closer
  function approach(tops, F, H) {
    const K = S.K, scale = S.grp.getWorldScale(new THREE.Vector3()).x;
    const J = (n) => new THREE.Vector3().fromArray(S.rig.joints[K.BI[n]]);
    const reach = (J('l_upperarm').distanceTo(J('l_forearm')) + J('l_forearm').distanceTo(J('l_hand'))) * scale * 0.92;
    for (let tries = 0; tries < 4; tries++) {
      const W = K.worldOf(S.rig, poseNow());
      let shift = 0, room = Infinity;
      for (const s of ['l', 'r']) {
        const sh = S.grp.localToWorld(W.Jw[K.BI[s + '_upperarm']].clone());
        const wrist = tops[s].point.clone().addScaledVector(tops[s].normal, S.hand[s].thick * scale).addScaledVector(F, -S.hand[s].palmAt * scale);
        const v = wrist.y - sh.y, ahead = wrist.clone().sub(sh).dot(F);
        const can = Math.sqrt(Math.max(0, reach * reach - v * v));
        shift = Math.max(shift, ahead - can);
        room = Math.min(room, tops[s].point.clone().sub(S.g.position).dot(F) - 0.17 * H);
        if (S.front != null) room = Math.min(room, S.front - 0.17 * H - S.g.position.dot(F));     // not past its front face
      }
      if (shift <= 0.5) return;
      const step = Math.max(0, Math.min(shift, room));
      S.g.position.addScaledVector(F, step);
      S.g.updateMatrixWorld(true);
      if (step >= shift - 0.5) return;
      if (S.params.lean >= 50) return;                          // as far as it goes: the handles say what is left
      S.params.lean = Math.min(50, S.params.lean + 10);
      rebuildKeys();
    }
  }

  // over the 3D view's top right corner, under its toolbar
  function placePanel() {
    if (!S?.panel) return;
    const r = d.canvas.getBoundingClientRect();
    Object.assign(S.panel.style, { top: Math.round(r.top + 36) + 'px', left: Math.round(Math.max(r.left + 8, r.right - 288)) + 'px' });
  }
  // for tests: where a handle is on the screen (client pixels)
  function handleScreen(chain) {
    const v = S.handles[chain].position.clone().project(d.camera), r = d.canvas.getBoundingClientRect();
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
  }
  return { open, close, handleScreen, get active() { return !!S; }, get session() { return S; } };
}
