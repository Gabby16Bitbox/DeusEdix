// Tools > Weapons (server: editor/weapons.py): a model of the user's made a weapon of the game.
// Deus Ex draws a held weapon as one model with the player's arms in it (its PlayerViewMesh), with frames for
// Select, Shoot, Reload, Idle... The editor takes a weapon of the game as the base: it keeps the base's arms
// (the texture slots the game fills with the player's hands) and the muzzle flash, leaves its gun out and puts the
// new model where the old gun was. In every frame the new gun moves as the old one did (a rigid fit of the old gun's
// points: the hands hold it through the reload too). Save bakes arms and gun into one model of the project
// (<Name>FP), imports the model alone for the ground (<Name>) and writes the weapon's class (weapons.py).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { attachToolWindow } from './tool-window.js';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./weapon-editor.css', import.meta.url).href;
document.head.appendChild(css);

const $ = (s, root = el) => root.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FOV = 75;                     // the player's field of view (horizontal), as the weapon is seen in the game
const GUN_TRIS = 3000;              // a new gun bigger than this is simplified (the arms and frames come on top)
const STAT_UI = {
  HitDamage: ['Damage', 1], ReloadCount: ['Clip', 1], PickupAmmoCount: ['Ammo when found', 1], ShotTime: ['Time between shots (s)', 0.01],
  reloadTime: ['Reload time (s)', 0.1], BaseAccuracy: ['Inaccuracy (0 = exact)', 0.05], maxRange: ['Range', 100],
  AccurateRange: ['Accurate range', 100], recoilStrength: ['Recoil', 0.05], bAutomatic: ['Automatic', 0],
  bHasScope: ['Scope', 0], ScopeFOV: ['Scope view (°, less = more zoom)', 1],
};

let el = null, info = null, view = null;
// the weapon being edited
let W = null;
const bases = new Map();             // base id -> prepared base (arms, frames, fits)

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'The editor did not answer (' + r.status + ').');
  return j;
}
const say = (t, cls = '') => { const m = $('.we-msg'); if (m) { m.className = 'we-msg hint ' + cls; m.textContent = t; } };

// ---------------------------------------------------------------- rigid fits (Horn's quaternion method)
function eig4(A) {                    // Jacobi: eigenvalues and eigenvectors (columns) of a symmetric 4x4
  const a = A.slice(), v = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) off += a[p * 4 + q] * a[p * 4 + q];
    if (off < 1e-24) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) {
      const apq = a[p * 4 + q];
      if (Math.abs(apq) < 1e-30) continue;
      const th = (a[q * 4 + q] - a[p * 4 + p]) / (2 * apq), t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) { const kp = a[k * 4 + p], kq = a[k * 4 + q]; a[k * 4 + p] = c * kp - s * kq; a[k * 4 + q] = s * kp + c * kq; }
      for (let k = 0; k < 4; k++) { const pk = a[p * 4 + k], qk = a[q * 4 + k]; a[p * 4 + k] = c * pk - s * qk; a[q * 4 + k] = s * pk + c * qk; }
      for (let k = 0; k < 4; k++) { const kp = v[k * 4 + p], kq = v[k * 4 + q]; v[k * 4 + p] = c * kp - s * kq; v[k * 4 + q] = s * kp + c * kq; }
    }
  }
  return { vals: [a[0], a[5], a[10], a[15]], vecs: v };
}
// the rotation and move that carry points idx of A onto the same points of B (both xyz arrays): a Matrix4
function rigidFit(A, B, idx) {
  const ca = [0, 0, 0], cb = [0, 0, 0];
  for (const i of idx) for (let k = 0; k < 3; k++) { ca[k] += A[3 * i + k]; cb[k] += B[3 * i + k]; }
  for (let k = 0; k < 3; k++) { ca[k] /= idx.length; cb[k] /= idx.length; }
  const S = new Array(9).fill(0);                       // S[a*3+b] = sum (A_a)(B_b), both centred
  for (const i of idx) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) S[a * 3 + b] += (A[3 * i + a] - ca[a]) * (B[3 * i + b] - cb[b]);
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S;
  const N = [xx + yy + zz, yz - zy, zx - xz, xy - yx,
    yz - zy, xx - yy - zz, xy + yx, zx + xz,
    zx - xz, xy + yx, -xx + yy - zz, yz + zy,
    xy - yx, zx + xz, yz + zy, -xx - yy + zz];
  const { vals, vecs } = eig4(N);
  let best = 0;
  for (let k = 1; k < 4; k++) if (vals[k] > vals[best]) best = k;
  const q = new THREE.Quaternion(vecs[4 + best], vecs[8 + best], vecs[12 + best], vecs[best]).normalize();
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const c = new THREE.Vector3(...ca).applyMatrix4(m);
  m.setPosition(cb[0] - c.x, cb[1] - c.y, cb[2] - c.z);
  return m;
}
// the same, leaving out the points that move on their own (a slide, a magazine): the 70% that fit best
function trimmedFit(A, B, idx) {
  let m = rigidFit(A, B, idx);
  const v = new THREE.Vector3();
  const err = idx.map((i) => [i, v.set(A[3 * i], A[3 * i + 1], A[3 * i + 2]).applyMatrix4(m).distanceTo(new THREE.Vector3(B[3 * i], B[3 * i + 1], B[3 * i + 2]))]);
  err.sort((x, y) => x[1] - y[1]);
  const keep = err.slice(0, Math.max(4, Math.round(err.length * 0.7))).map((x) => x[0]);
  return rigidFit(A, B, keep);
}

// ---------------------------------------------------------------- the base: the game's weapon, its arms and moves
async function prepareBase(b) {
  if (bases.has(b.id)) return bases.get(b.id);
  const m = await window.__studio.loadModel(b.mesh);
  const nf = m.faces.length / 4, slotOf = (f) => (m.info.mats[m.faces[f * 4 + 3]] || [0])[0];
  const arm = [], muzzle = [], gun = [], keep = b.keep || [];
  for (let f = 0; f < nf; f++) {
    const s = slotOf(f);
    (b.hands.includes(s) || keep.includes(s) ? arm : s === b.muzzle ? muzzle : b.gun.includes(s) ? gun : arm).push(f);
  }
  if (!gun.length) throw new Error('Mark the slot of the old gun (Old gun): the new one follows its moves.');
  // the kept parts' own pictures (sleeves, gloves... of the model chosen), for the baked model
  const keepPng = {};
  for (const s of keep) { const url = texUrl(m, s); keepPng[s] = url ? await pngData(url) : ''; }
  const vertsOf = (faces) => [...new Set(faces.flatMap((f) => [0, 1, 2].map((j) => m.wedges[m.faces[f * 4 + j]])))];
  const gunVerts = vertsOf(gun), muzzleVerts = vertsOf(muzzle);
  const still = m.seqs.find((s) => /^still$/i.test(s.name)), ref = still ? still.start : 0;
  const frame = (f) => m.pos.subarray(f * m.FV * 3, (f + 1) * m.FV * 3);
  // the old gun at rest: its box
  const R = frame(ref), box = new THREE.Box3(), v = new THREE.Vector3(), w = new THREE.Vector3();
  for (const i of gunVerts) box.expandByPoint(v.set(R[3 * i], R[3 * i + 1], R[3 * i + 2]));
  // How the new gun moves in each frame: as the old gun, where it moves in one piece (thousandths of a unit off);
  // in an animation where it does not (the pistol's Shoot: the slide flies back 9 units, the gun grows from 19 to
  // 27), as the hand holding it (the hand's points on the grip: a tenth of a unit off). One way per animation.
  const grip = vertsOf(arm).filter((i) => box.distanceToPoint(v.set(R[3 * i], R[3 * i + 1], R[3 * i + 2])) < 1);
  const off = (m4, idx, F) => {
    const e = idx.map((i) => v.set(R[3 * i], R[3 * i + 1], R[3 * i + 2]).applyMatrix4(m4).distanceTo(w.set(F[3 * i], F[3 * i + 1], F[3 * i + 2]))).sort((x, y) => x - y);
    return e[Math.floor(e.length * 0.7)] || 0;
  };
  const fits = new Array(m.frames), how = {};
  const seqs = m.seqs.filter((s) => !s.custom && !/^all$/i.test(s.name));
  const covered = new Set();
  for (const s of seqs) {
    const n = s.frames ?? s.count ?? 1, gunFits = [];
    let worst = 0;
    for (let f = s.start; f < s.start + n; f++) { const g = trimmedFit(R, frame(f), gunVerts); gunFits.push(g); worst = Math.max(worst, off(g, gunVerts, frame(f))); }
    const byHand = worst > 0.5 && grip.length >= 4;
    for (let f = s.start; f < s.start + n; f++) { fits[f] = byHand ? trimmedFit(R, frame(f), grip) : gunFits[f - s.start]; covered.add(f); }
    how[s.name] = byHand ? 'hand' : 'gun';
  }
  for (let f = 0; f < m.frames; f++) if (!covered.has(f)) fits[f] = trimmedFit(R, frame(f), gunVerts);
  fits[ref] = new THREE.Matrix4();
  // the old gun's front (its farthest point forward: the muzzle): the flash keeps its distance from it
  const front = new THREE.Vector3(-Infinity, 0, 0);
  for (const i of gunVerts) if (R[3 * i] > front.x) front.set(R[3 * i], R[3 * i + 1], R[3 * i + 2]);
  const p = { b, m, arm, muzzle, gun, gunVerts, muzzleVerts, ref, frame, fits, how, grip, box, front, keepPng };
  bases.set(b.id, p);
  return p;
}

async function pngData(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ok(''); r.readAsDataURL(blob); });
}
// The baked model's texture slots: the flash on 2 (DeusExWeapon swaps MultiSkins[2] when it fires), the hands and
// the kept parts on the others, the new gun's materials after them (8 slots at most: the last ones share one).
function slotPlan(b, nGun) {
  const free = [0, 1, 3, 4, 5, 6, 7], map = new Map();
  if (b.muzzle >= 0) map.set(b.muzzle, 2);
  for (const s of [...b.hands, ...(b.keep || [])]) map.set(s, free.length > 1 ? free.shift() : free[0]);
  const gun = [];
  for (let k = 0; k < nGun; k++) gun.push(free.length > 1 ? free.shift() : free[0]);
  return { map, gun, hands: b.hands.map((s) => map.get(s)) };
}
// the base as the weapon has it: the held-like weapon of the game, or its values with the arms of another model
function baseFor() {
  const pre = info.bases.find((b) => b.id === W.base) || info.bases[0];
  if (!W.arms) return pre;
  const r = W.arms.roles, slots = Object.keys(r).map(Number), is = (k) => slots.filter((s) => r[s] === k);
  return Object.assign({}, pre, { id: `${pre.id}|${W.arms.mesh}|${JSON.stringify(r)}`, mesh: W.arms.mesh,
    hands: is('hands'), keep: is('keep'), gun: is('gun'), muzzle: is('muzzle')[0] ?? -1, view: W.arms.view });
}
// A first-person model's slots, as the game's own are made: the arms wear the hands' picture (WeaponHandsTex...),
// the flash is the slot drawn see-through with no picture of its own (or a black stand-in); the rest is the old gun.
async function detectRoles(mesh) {
  const m = await window.__studio.loadModel(mesh), roles = {};
  let flash = false;
  for (const [s, flags] of m.info.mats || []) {
    if (s in roles) continue;
    const tex = texName(m.info.tex?.[s]);
    if (/hand|arm|sleeve|glove/i.test(tex)) roles[s] = 'hands';
    else if (!flash && ((!tex && (flags & 4)) || /BlackMask|Muzzle|Flash/i.test(tex))) { roles[s] = 'muzzle'; flash = true; }   // HDTP: a BlackMaskTex stand-in
    else roles[s] = 'gun';
  }
  return { roles, tex: Object.fromEntries(Object.keys(roles).map((s) => [s, texName(m.info.tex?.[s])])), seqs: m.seqs.map((s) => s.name) };
}
// a slot's picture: info.tex has its name (or, once the Studio showed the model, its picture's address), info.skins the picture
function texName(t) { return t && t !== 'None' ? decodeURIComponent(String(t).split('/').pop()).replace(/\.png$/i, '') : ''; }
function texUrl(m, s) { const t = m.info.skins?.[s] || m.info.tex?.[s]; return t && String(t).startsWith('/') ? t : ''; }

// ---------------------------------------------------------------- the new gun (a model file, as Import reads it)
async function readGun(files) {
  const M = window.__editor.modelImport;
  const read = await M.readModelFiles(files);
  M.modelParts(read.root);
  if (M.modelTris(read.root) > GUN_TRIS) M.simplifyModel(read.root, GUN_TRIS);
  // its points as Import makes them (Unreal axes, centred), 100 units on its tallest side: the placement scales it
  const p = M.modelPayload(read.root, { name: 'gun', height: 100, turn: 0, standUp: false, twoSided: false, flip: false, skinned: false });
  // in three's axes (x forward, y up, z right) for the view and the fits
  const pos = new Float32Array(p.positions.length);
  for (let i = 0; i < p.positions.length; i += 3) { pos[i] = p.positions[i]; pos[i + 1] = p.positions[i + 2]; pos[i + 2] = p.positions[i + 1]; }
  return { payload: p, pos, name: read.name };
}
// where the gun first goes: on the old gun (box), as long as it, its longest side along the old one's
function firstPlacement(base, gun) {
  const box = base.box || base;
  const g = new THREE.Box3().setFromArray(gun.pos), gs = g.getSize(new THREE.Vector3()), os = box.getSize(new THREE.Vector3());
  const longest = (s) => (s.x >= s.y && s.x >= s.z ? 'x' : s.y >= s.z ? 'y' : 'z');
  const turn = { x: [0, 0, 0], y: [0, 0, 90], z: [0, 90, 0] }[longest(gs)];     // [roll, yaw, pitch] to lay it along x
  const want = longest(os), lay = want === 'x' ? turn : [0, 0, 0];
  const c = box.getCenter(new THREE.Vector3());
  return { x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2), roll: lay[0], yaw: lay[1], pitch: lay[2],
    scale: +(Math.max(os.x, os.y, os.z) / Math.max(gs.x, gs.y, gs.z, 1e-6)).toFixed(4) };
}
function placementMatrix(P) {
  const d = Math.PI / 180;
  return new THREE.Matrix4().compose(new THREE.Vector3(P.x, P.y, P.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(P.roll * d, P.yaw * d, P.pitch * d, 'YZX')),
    new THREE.Vector3(P.scale, P.scale, P.scale));
}

// ---------------------------------------------------------------- the parts: held, in others' hands, on the ground
// The game draws a weapon with three models: held (the arms and the gun, animated), in a character's hand
// (ThirdPersonMesh, its origin at the hand) and lying on the ground (PickupViewMesh). Each is lined up with the
// base's own: its model shows in blue, the new one goes where it is.
let PART = 'fp';
const PARTS = { fp: 'place', third: 'place3', ground: 'placeG' };
const curPlace = () => (W ? W[PARTS[PART]] : null);
async function loadRef(mesh) {
  const m = await window.__studio.loadModel(mesh);
  const P = m.pos.subarray(0, m.FV * 3), pos = [], box = new THREE.Box3(), v = new THREE.Vector3();
  for (let f = 0; f < m.faces.length / 4; f++) {
    if (((m.info.mats[m.faces[f * 4 + 3]] || [0, 0])[1] & 0x400000)) continue;         // a muzzle flash quad
    for (let j = 0; j < 3; j++) { const i = m.wedges[m.faces[f * 4 + j]]; pos.push(P[3 * i], P[3 * i + 1], P[3 * i + 2]); box.expandByPoint(v.set(P[3 * i], P[3 * i + 1], P[3 * i + 2])); }
  }
  return { mesh, pos, box };
}
async function refOf(part) {
  const b = W.baseP.b, mesh = part === 'third' ? b.third : b.pickup;
  W.refs = W.refs || {};
  if (!W.refs[mesh]) W.refs[mesh] = await loadRef(mesh);
  return W.refs[mesh];
}

// ---------------------------------------------------------------- the view
function texOf(url) {
  if (!url) return null;
  const t = new THREE.TextureLoader().load(url);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function gunMeshes(gun) {
  // one mesh for each material, the payload's corners (UVs on the corners, as the game keeps them)
  const p = gun.payload, out = new THREE.Group();
  p.materials.forEach((mat, k) => {
    const pos = [], uv = [];
    for (let t = 0; t < p.triMaterials.length; t++) {
      if (p.triMaterials[t] !== k) continue;
      for (let j = 0; j < 3; j++) {
        const i = p.indices[t * 3 + j];
        pos.push(gun.pos[3 * i], gun.pos[3 * i + 1], gun.pos[3 * i + 2]);
        uv.push(p.uvs[(t * 3 + j) * 2], p.uvs[(t * 3 + j) * 2 + 1]);
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const c = mat.color || [0.7, 0.7, 0.7];
    out.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: texOf(mat.png), color: mat.png ? 0xffffff : new THREE.Color(c[0], c[1], c[2]), side: THREE.DoubleSide })));
  });
  return out;
}
function facesMesh(base, faces, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(faces.length * 9), 3));
  const mesh = new THREE.Mesh(g, material);
  mesh.userData.faces = faces;
  return mesh;
}
function setFrame(mesh, base, f) {
  const P = base.frame(f), a = mesh.geometry.attributes.position.array, m = base.m;
  let o = 0;
  for (const face of mesh.userData.faces) for (let j = 0; j < 3; j++) {
    const i = m.wedges[m.faces[face * 4 + j]];
    a[o++] = P[3 * i]; a[o++] = P[3 * i + 1]; a[o++] = P[3 * i + 2];
  }
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
}
function ensureView() {
  if (view) return;
  const host = $('.we-view');
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1f24);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404048, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(-1, 2, 1.5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enabled = false;
  const holder = new THREE.Group();               // the frame's fit: the gun moves with the old gun
  holder.matrixAutoUpdate = false;
  scene.add(holder);
  const pivot = new THREE.Group();                // the placement (the gizmo moves this)
  holder.add(pivot);
  const tc = new TransformControls(camera, renderer.domElement);
  tc.setSize(0.7);
  tc.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value && view.mode === 'orbit'; if (!e.value) { fromPivot(); iconSoon(); } });
  tc.addEventListener('objectChange', () => fromPivot(true));
  scene.add(tc.getHelper ? tc.getHelper() : tc);
  view = { renderer, scene, camera, orbit, holder, pivot, tc, arms: null, oldGun: null, ref: null, gunObj: null, frame: 0, play: false, mode: 'fp' };
  const resize = () => {
    const w = host.clientWidth || 600, h = host.clientHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    applyCamera();
  };
  new ResizeObserver(resize).observe(host);
  resize();
  let last = performance.now();
  const tick = (now) => {
    if (!el || el.style.display === 'none') { view.raf = 0; return; }
    if (view.play && W && W.baseP) {
      const s = currentSeq();
      const rate = s ? (s.rate || 15) : 15;
      view.acc = (view.acc || 0) + (now - last) / 1000 * rate;
      if (view.acc >= 1) {
        const steps = Math.floor(view.acc); view.acc -= steps;
        const n = s ? (s.frames ?? s.count ?? 1) : W.baseP.m.frames, start = s ? s.start : 0;
        showFrame(start + ((view.frame - start + steps) % Math.max(1, n) + n) % n);
      }
    }
    last = now;
    renderer.render(scene, camera);
    view.raf = requestAnimationFrame(tick);
  };
  view.start = () => { if (!view.raf) { last = performance.now(); view.raf = requestAnimationFrame(tick); } };
}
function applyCamera() {
  const { camera, orbit } = view;
  if (view.mode === 'fp' && PART === 'fp') {
    // the player's eye, in the held model's own space: the game draws the model 0.9/75 x 100 x PlayerViewOffset
    // from it (Inventory: PlayerViewOffset *= 100; the right hand turns its side: Weapon.SetHand)
    const o = W?.baseP?.b.view || [22, -10, -14], k = 0.9 / FOV * 100;
    const eye = new THREE.Vector3(-k * o[0], -k * o[2], k * o[1]);          // three: x forward, y up, z right
    camera.fov = 2 * Math.atan(Math.tan(FOV * Math.PI / 360) / camera.aspect) * 180 / Math.PI;
    camera.near = 1;
    camera.position.copy(eye);
    camera.up.set(0, 1, 0);
    camera.lookAt(eye.x + 1, eye.y, eye.z);
    orbit.enabled = false;
  } else {
    camera.fov = 40;
    camera.near = 0.1;
    if (!view.orbited) {
      const box = PART === 'fp' ? W?.baseP?.box : view.refBox, c = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(20, -5, 5);
      const r = box ? Math.max(8, box.getSize(new THREE.Vector3()).length()) : 40;
      camera.position.set(c.x - r * 0.25, c.y + r * 0.6, c.z + r * 1.2);
      orbit.target.copy(c);
      view.orbited = true;
    }
    orbit.enabled = true;
    orbit.update();
  }
  camera.updateProjectionMatrix();
}
function currentSeq() {
  const name = $('.we-seq')?.value;
  return W?.baseP?.m.seqs.find((s) => s.name === name) || null;
}
function showFrame(f) {
  if (!W?.baseP || PART !== 'fp') return;
  const B = W.baseP;
  view.frame = Math.max(0, Math.min(B.m.frames - 1, f));
  setFrame(view.arms, B, view.frame);
  setFrame(view.oldGun, B, view.frame);
  view.holder.matrix.copy(B.fits[view.frame]);
  view.holder.matrixWorldNeedsUpdate = true;
  const s = currentSeq(), n = s ? (s.frames ?? s.count ?? 1) : 1, at = view.frame - (s ? s.start : 0);
  const ruler = $('.we-ruler');
  if (ruler) {
    ruler.style.setProperty('--ticks', String(n));
    ruler.style.setProperty('--playhead', `${(at + 0.5) / n * 100}%`);
  }
  $('.we-fno').textContent = `${at + 1} / ${n}`;
}
async function rebuildScene() {
  const B = W.baseP;
  for (const k of ['arms', 'oldGun', 'ref']) if (view[k]) { view.scene.remove(view[k]); view[k].geometry.dispose(); view[k] = null; }
  for (const c of el.querySelectorAll('.we-seq, .we-transport, .we-fno, .we-ruler')) c.hidden = PART !== 'fp';
  if (PART !== 'fp') {
    // the base's model for this part, in blue, and the new one on it (no animation); a part changed meanwhile wins
    const part = PART, R = await refOf(part), g = new THREE.BufferGeometry();
    if (PART !== part) return;
    g.setAttribute('position', new THREE.Float32BufferAttribute(R.pos, 3));
    view.ref = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x4aa3ff, wireframe: true, transparent: true, opacity: 0.45 }));
    view.ref.visible = $('.we-old').checked;
    view.scene.add(view.ref);
    view.refBox = R.box;
    if (W.gun && !curPlace()) W[PARTS[PART]] = firstPlacement(R.box, W.gun);
    view.holder.matrix.identity();
    view.holder.matrixWorldNeedsUpdate = true;
    if (view.gunObj) view.pivot.remove(view.gunObj);
    view.gunObj = W.gun ? gunMeshes(W.gun) : null;
    if (view.gunObj) view.pivot.add(view.gunObj);
    toPivot();
    if (W.gun && $('.we-gizmo').value !== 'off') view.tc.attach(view.pivot); else view.tc.detach();
    return;
  }
  view.arms = facesMesh(B, B.arm, new THREE.MeshLambertMaterial({ color: 0xb08a72, side: THREE.DoubleSide }));
  view.oldGun = facesMesh(B, B.gun, new THREE.MeshBasicMaterial({ color: 0x4aa3ff, wireframe: true, transparent: true, opacity: 0.35 }));
  view.oldGun.visible = $('.we-old').checked;
  view.scene.add(view.arms, view.oldGun);
  if (view.gunObj) view.pivot.remove(view.gunObj);
  view.gunObj = W.gun ? gunMeshes(W.gun) : null;
  if (view.gunObj) view.pivot.add(view.gunObj);
  toPivot();
  if (W.gun && $('.we-gizmo').value !== 'off') view.tc.attach(view.pivot); else view.tc.detach();
  showFrame(view.frame);
}
// the placement fields <-> the gizmo
function toPivot() {
  const P = curPlace();
  if (!P) return;
  placementMatrix(P).decompose(view.pivot.position, view.pivot.quaternion, view.pivot.scale);
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'scale']) { const i = $(`.we-p-${k}`); if (i && document.activeElement !== i) i.value = P[k]; }
}
function fromPivot(live) {
  const P = curPlace();
  if (!P) return;
  const p = view.pivot, e = new THREE.Euler().setFromQuaternion(p.quaternion, 'YZX'), d = 180 / Math.PI, r = (v, n = 2) => +v.toFixed(n);
  Object.assign(P, { x: r(p.position.x), y: r(p.position.y), z: r(p.position.z), roll: r(e.x * d, 1), yaw: r(e.y * d, 1), pitch: r(e.z * d, 1), scale: r(p.scale.x, 4) });
  if (!live) toPivot(); else for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'scale']) { const i = $(`.we-p-${k}`); if (i) i.value = P[k]; }
  W.dirty = true;
}

// ---------------------------------------------------------------- bake: the arms and the new gun, one model
function bake() {
  const B = W.baseP, m = B.m, G = W.gun, p = G.payload, P = placementMatrix(W.place);
  const keepFaces = B.arm.concat(B.muzzle);
  const old = [...new Set(keepFaces.flatMap((f) => [0, 1, 2].map((j) => m.wedges[m.faces[f * 4 + j]])))];
  const index = new Map(old.map((v, k) => [v, k]));
  const nArm = old.length, nGun = G.pos.length / 3, nv = nArm + nGun;
  if (nv > 8191) throw new Error(`${nv} points: Deus Ex takes 8191 at most (simplify the model more)`);
  // the muzzle flash goes from the old gun's front to the new one's: the new gun's farthest point forward, placed
  const front = new THREE.Vector3(-Infinity, 0, 0), v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 0; i < nGun; i++) { v.set(G.pos[3 * i], G.pos[3 * i + 1], G.pos[3 * i + 2]).applyMatrix4(P); if (v.x > front.x) front.copy(v); }
  const shift = front.clone().sub(B.front);
  const muzzleSet = new Set(B.muzzleVerts);
  const frames = new Float32Array(m.frames * nv * 3), rot = new THREE.Matrix4();
  for (let f = 0; f < m.frames; f++) {
    const F = B.frame(f), fit = B.fits[f], at = f * nv * 3;
    rot.extractRotation(fit);
    const s = w.copy(shift).applyMatrix4(rot);
    old.forEach((i, k) => {
      let x = F[3 * i], y = F[3 * i + 1], z = F[3 * i + 2];
      if (muzzleSet.has(i)) { x += s.x; y += s.y; z += s.z; }
      frames[at + 3 * k] = x; frames[at + 3 * k + 1] = z; frames[at + 3 * k + 2] = y;          // three -> Unreal
    });
    const M = new THREE.Matrix4().multiplyMatrices(fit, P);
    for (let i = 0; i < nGun; i++) {
      v.set(G.pos[3 * i], G.pos[3 * i + 1], G.pos[3 * i + 2]).applyMatrix4(M);
      const o = at + 3 * (nArm + i);
      frames[o] = v.x; frames[o + 1] = v.z; frames[o + 2] = v.y;
    }
  }
  // the texture slots (slotPlan): the game fills the hands' and the flash's, the kept parts keep their pictures
  const plan = slotPlan(B.b, p.materials.length), gunSlot = plan.gun;
  const nSlots = Math.max(2, ...plan.map.values(), ...gunSlot) + 1, materials = [];
  for (let s = 0; s < nSlots; s++) materials.push({ name: 'unused', color: [0.5, 0.5, 0.5], twosided: false, png: '' });
  for (const s of B.b.hands) materials[plan.map.get(s)] = { name: 'hands (the player\'s)', color: [0.72, 0.56, 0.46], twosided: false, png: '' };
  for (const s of B.b.keep || []) materials[plan.map.get(s)] = { name: 'arms ' + s, color: [0.6, 0.6, 0.6], twosided: false, png: B.keepPng[s] || '' };
  if (B.b.muzzle >= 0) materials[2] = { name: 'muzzle flash', color: [0, 0, 0], twosided: true, png: '', blend: 'translucent' };
  p.materials.forEach((mat, k) => { materials[gunSlot[k]] = Object.assign({}, mat); });
  const indices = [], uvs = [], triMaterials = [];
  for (const f of keepFaces) {
    for (let j = 0; j < 3; j++) { const wg = m.faces[f * 4 + j]; indices.push(index.get(m.wedges[wg])); uvs.push(m.uvs[2 * wg], m.uvs[2 * wg + 1]); }
    triMaterials.push(plan.map.get((m.info.mats[m.faces[f * 4 + 3]] || [0])[0]) ?? 0);
  }
  for (let t = 0; t < p.indices.length / 3; t++) {
    for (let j = 0; j < 3; j++) { indices.push(nArm + p.indices[t * 3 + j]); uvs.push(p.uvs[(t * 3 + j) * 2], p.uvs[(t * 3 + j) * 2 + 1]); }
    triMaterials.push(gunSlot[p.triMaterials[t]]);
  }
  const positions = Array.from(frames.subarray(B.ref * nv * 3, (B.ref + 1) * nv * 3));
  const sequences = m.seqs.filter((s) => !s.custom && !/^all$/i.test(s.name))
    .map((s) => ({ name: s.name, start: s.start, count: s.frames ?? s.count ?? 1, rate: s.rate || 15 }));
  return { positions, uvs, indices, triMaterials, materials, frames, sequences, hands: plan.hands };
}
async function setPart(part) {
  PART = part;
  $('.we-part').value = part;
  view.mode = PART === 'fp' ? $('.we-mode').value : 'orbit';
  $('.we-mode').disabled = PART !== 'fp';
  view.orbited = false;
  await rebuildScene();
  applyCamera();
  say({ fp: 'Held: put the new gun where the blue one is, in the hands; play the animations to check.',
    third: "In other characters' hands: the model's origin is where the hand holds it. Put the new one on the blue one.",
    ground: 'On the ground: as it lies when dropped or found. Put the new one on the blue one.' }[PART]);
}
// a part that is not held: the gun alone where it was put (no frames), in Unreal's axes
function bakeStatic(P) {
  const p = W.gun.payload, M = placementMatrix(P), v = new THREE.Vector3(), positions = [];
  for (let i = 0; i < W.gun.pos.length / 3; i++) {
    v.set(W.gun.pos[3 * i], W.gun.pos[3 * i + 1], W.gun.pos[3 * i + 2]).applyMatrix4(M);
    positions.push(v.x, v.z, v.y);
  }
  return { positions, uvs: p.uvs, indices: p.indices, triMaterials: p.triMaterials, materials: p.materials };
}
// The inventory pictures, as the game's own: the gun seen from its left side, the muzzle to the left, on a
// see-through ground, in the top left corner of a power-of-two picture (the belt draws 42x37 of it, the
// inventory the base's largeIconWidth x largeIconHeight)
function iconPng(w, h, texW, texH) {
  if (W.icon) return pictureIcon(W.icon, w, h, texW, texH);
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(w * 2, h * 2, false);
  r.setClearColor(0x000000, 0);
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x303038, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(0.5, 1, -1);
  sc.add(sun);
  const g = gunMeshes(W.gun), q = new THREE.Quaternion();
  placementMatrix(W.place).decompose(new THREE.Vector3(), q, new THREE.Vector3());
  g.quaternion.copy(q);                           // as it is held: the barrel forward (+x), the top up
  sc.add(g);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  // from its left (-z, three's z is the right): +x shows to the left
  const k = Math.max(s.x / w, s.y / h) * 1.08 / 2, cam = new THREE.OrthographicCamera(-w * k, w * k, h * k, -h * k, 0.01, 1000);
  cam.position.set(c.x, c.y, c.z - Math.max(s.x, s.y, s.z) * 2);
  cam.lookAt(c);
  r.render(sc, cam);
  const out = document.createElement('canvas');
  out.width = texW; out.height = texH;
  out.getContext('2d').drawImage(r.domElement, 0, 0, w, h);
  r.dispose();
  r.forceContextLoss();                 // the browser keeps few WebGL contexts: give this one back at once
  return out.toDataURL('image/png');
}
// a picture of the person's own: fitted inside w x h (its proportions kept), at the top left as the game draws icons
function pictureIcon(img, w, h, texW, texH) {
  const out = document.createElement('canvas'), k = Math.min(w / img.width, h / img.height);
  out.width = texW; out.height = texH;
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k);
  return out.toDataURL('image/png');
}
function showIcon() {
  const c = $('.we-icon'), [iw, ih] = W?.baseP?.b.icon || [46, 28];
  c.width = iw; c.height = ih;
  const g = c.getContext('2d');
  g.clearRect(0, 0, iw, ih);
  $('.we-icon-auto').disabled = !W?.icon;
  if (!W || (!W.icon && !W.gun)) return;
  const img = new Image();
  img.onload = () => g.drawImage(img, 0, 0);
  img.src = iconPng(iw, ih, iw, ih);
}
// the scope's sight: the picture fitted in a square (the game draws it as tall as the screen, black at its sides)
function sightPng(img, n) {
  const c = document.createElement('canvas'), k = Math.min(n / img.width, n / img.height);
  c.width = c.height = n;
  c.getContext('2d').drawImage(img, (n - img.width * k) / 2, (n - img.height * k) / 2, img.width * k, img.height * k);
  return c.toDataURL('image/png');
}
function showSight() {
  const c = $('.we-sight'), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  $('.we-sight-game').disabled = !W?.sight;
  if (W?.sight) g.drawImage(W.sight, 0, 0, c.width, c.height);
}
function loadSight(file) {
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    W.sight = img; W.dirty = true; showSight();
    if (!el.querySelector('[data-stat="bHasScope"]').checked) { const s = el.querySelector('[data-stat="bHasScope"]'); s.checked = true; s.dataset.touched = '1'; }
  };
  img.onerror = () => say('That picture could not be read.', 'bad');
  img.src = URL.createObjectURL(file);
}
let iconTimer = 0;
function iconSoon() { clearTimeout(iconTimer); iconTimer = setTimeout(showIcon, 300); }
// the picture kept with the weapon: at most 256 pixels a side
function pictureData(img) {
  const k = Math.min(1, 256 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
function loadIcon(file) {
  if (!file) return;
  const img = new Image();
  img.onload = () => { W.icon = img; W.dirty = true; showIcon(); };
  img.onerror = () => say('That picture could not be read.', 'bad');
  img.src = URL.createObjectURL(file);
}
function fillSounds(chosen = {}) {
  const list = (info.sounds || []);
  for (const s of el.querySelectorAll('.we-snd')) {
    s.innerHTML = '<option value="">as the base</option>' + list.map((n) => `<option>${esc(n)}</option>`).join('');
    s.value = chosen[s.dataset.snd] || '';
  }
}
async function loadSounds() {
  if (info.sounds) return;
  try {
    const cat = await api('/api/sounds'), own = cat.package || '';
    info.sounds = cat.sounds.map((s) => s.name).filter((n) => /\.Weapons\./.test(n) || (own && n.startsWith(own + '.'))).sort();
  } catch (e) { info.sounds = []; }
}
function placeInMap() {
  if (!W?.name) { say('Save the weapon first, then place it.', 'bad'); return; }
  const E = window.__editor;
  if (!E?.placeClass || !E.mapName) { say('Open a map first: the weapon goes into the map open in the editor.', 'bad'); return; }
  const cls = `${info.scripts}.UCW_${W.name}`;
  el.style.display = 'none';
  const rifle = W.base === 'rifle';     // the game's own pickup sizes (WeaponPistol, WeaponAssaultGun): it lies on the floor
  E.placeClass(cls, W.name, { Mesh: `LodMesh'${info.models}.UCM_${W.name}'` }, rifle ? { radius: 15, height: 1.1 } : { radius: 7, height: 1 });
}
function placeAmmo() {
  const a = $('.we-ammo').value, E = window.__editor;
  if (!a.startsWith('UCA_')) { say('Choose ammunition of your own to place it.', 'bad'); return; }
  if (!E?.placeClass || !E.mapName) { say('Open a map first.', 'bad'); return; }
  el.style.display = 'none';
  E.placeClass(`${info.scripts}.${a}`, a.slice(4), { Mesh: `LodMesh'${info.models}.UCM_${a.slice(4)}'` }, { radius: 8.5, height: 3.77 });   // as Ammo10mm
}
function base64Of(buffer) {
  const u = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
async function save() {
  if (!W?.gun) { say('Choose the model of the weapon first.', 'bad'); return; }
  const name = $('.we-name').value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{1,30}$/.test(name)) { say('A name of letters, digits and _ (no spaces), starting with a letter.', 'bad'); return; }
  const btn = $('.we-save');
  btn.disabled = true;
  try {
    say('Baking the arms and the weapon into one model...');
    await new Promise((r) => setTimeout(r, 20));
    const fp = bake();
    say('Making the held model with the game\'s importer...');
    let r = await api('/api/model_import', { name: name + 'FP', source: 'Weapon editor: ' + W.gun.name, positions: fp.positions, uvs: fp.uvs,
      indices: fp.indices, triMaterials: fp.triMaterials, materials: fp.materials, frames: base64Of(fp.frames.buffer), sequences: fp.sequences, idle: '' });
    if (!r.ok) throw new Error((r.lines || []).join(' ') || 'the held model was not made');
    // the other two: on the ground (with the inventory pictures) and in other characters' hands, each lined up
    // with the base's own (the ones not lined up yet start where the editor first puts them)
    for (const part of ['ground', 'third']) if (!W[PARTS[part]]) W[PARTS[part]] = firstPlacement((await refOf(part)).box, W.gun);
    const [iw, ih] = W.baseP.b.icon || [46, 28], pow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(8, n)));
    const icons = { belt: iconPng(42, 37, 64, 64), large: iconPng(iw, ih, pow2(iw), pow2(ih)) };
    if (W.sight) icons.scope = sightPng(W.sight, 512);
    say('Making the model for the ground and its pictures...');
    r = await api('/api/model_import', Object.assign({ name, source: 'Weapon editor: ' + W.gun.name, icons }, bakeStatic(W.placeG)));
    if (!r.ok) throw new Error((r.lines || []).join(' ') || 'the model was not made');
    say("Making the model for other characters' hands...");
    r = await api('/api/model_import', Object.assign({ name: name + '3rd', source: 'Weapon editor: ' + W.gun.name }, bakeStatic(W.place3)));
    if (!r.ok) throw new Error((r.lines || []).join(' ') || 'the model was not made');
    say('Writing and compiling the weapon\'s class...');
    const stats = {};
    // only the values given: an empty one (or a box not touched) stays as the base has it
    for (const i of el.querySelectorAll('[data-stat]')) {
      if (i.type === 'checkbox') { if (i.dataset.touched || i.dataset.saved) stats[i.dataset.stat] = i.checked; }
      else if (i.value.trim() !== '' && isFinite(+i.value)) stats[i.dataset.stat] = +i.value;
    }
    const sounds = {};
    for (const s of el.querySelectorAll('.we-snd')) if (s.value) sounds[s.dataset.snd] = s.value;
    const gp = W.gun.payload;
    r = await api('/api/weapon_save', { name, base: W.base, label: $('.we-label').value.trim() || name, description: $('.we-desc').value.trim(),
      ammo: $('.we-ammo').value, stats, sounds, placement: { fp: W.place, third: W.place3, ground: W.placeG }, icon: W.icon ? pictureData(W.icon) : '',
      scope_pic: W.sight ? sightPng(W.sight, 512) : '', hands: fp.hands, arms: W.arms ? { mesh: W.arms.mesh, roles: W.arms.roles, view: W.arms.view } : null,
      gun: { name: W.gun.name, positions: gp.positions, uvs: gp.uvs, indices: gp.indices, triMaterials: gp.triMaterials, materials: gp.materials } });
    W.name = name; W.dirty = false;
    if (!r.ok) {
      say('The class was not compiled: ' + (r.problems || []).map((p) => `${p.script}.uc(${p.line}): ${p.message}`).join('; ') + ' ' + (r.lines || []).join(' '), 'bad');
      return;
    }
    say(`${name} is ready: ${r.cls}. ${r.note || ''} Give it in the game with the Console: summon ${r.cls.split('.').pop()}`, 'ok');
    info = await api('/api/weapons');
    renderList();
  } catch (e) { say(e.message, 'bad'); } finally { btn.disabled = false; }
}

// ---------------------------------------------------------------- ammunition of the project's own
function fillAmmo(pick) {
  const now = pick ?? $('.we-ammo').value;
  $('.we-ammo').innerHTML = '<option value="">as the base</option>'
    + (info.ownAmmo || []).map((a) => `<option value="UCA_${esc(a)}">${esc(a)} (yours)</option>`).join('')
    + info.ammo.map((a) => `<option>${a}</option>`).join('');
  $('.we-ammo').value = now || '';
  ammoPlaceable();
}
// only the project's own ammunition can be placed from here (the game's are in the palette)
function ammoPlaceable() { $('.we-ammo-place').disabled = !$('.we-ammo').value.startsWith('UCA_'); }
async function makeAmmo() {
  const name = $('.we-a-name').value.trim(), files = [...$('.we-a-file').files];
  if (!/^[A-Za-z][A-Za-z0-9_]{1,30}$/.test(name)) { say('Ammunition: a name of letters, digits and _, starting with a letter.', 'bad'); return; }
  if (!files.length) { say('Ammunition: choose its model.', 'bad'); return; }
  const btn = $('.we-a-make');
  btn.disabled = true;
  try {
    say("Reading the ammunition's model...");
    const M = window.__editor.modelImport, read = await M.readModelFiles(files);
    M.modelParts(read.root);
    if (M.modelTris(read.root) > 1500) M.simplifyModel(read.root, 1500);
    // its longest side as asked: Import's height is its tallest side, so scaled after
    const p = M.modelPayload(read.root, { name, height: 100, turn: 0, standUp: false, twoSided: false, flip: false, skinned: false });
    const k = (+$('.we-a-size').value || 8) / Math.max(...p.size, 1e-6);
    say("Making its model with the game's importer...");
    let r = await api('/api/model_import', { name, source: 'Weapon editor (ammunition): ' + read.name, positions: p.positions.map((v) => v * k),
      uvs: p.uvs, indices: p.indices, triMaterials: p.triMaterials, materials: p.materials });
    if (!r.ok) throw new Error((r.lines || []).join(' ') || 'the model was not made');
    say("Writing and compiling the ammunition's class...");
    r = await api('/api/ammo_save', { name, base: $('.we-a-base').value, label: $('.we-a-label').value.trim() || name,
      amount: +$('.we-a-amount').value || 10, max: +$('.we-a-max').value || 100 });
    if (!r.ok) { say('The ammunition was not compiled: ' + (r.problems || []).map((p) => `${p.script}.uc(${p.line}): ${p.message}`).join('; '), 'bad'); return; }
    info = await api('/api/weapons');
    fillAmmo('UCA_' + name);
    $('.we-ammo-form').hidden = true;
    W.dirty = true;
    say(`Ammunition ${name} is ready (${r.cls.split('.').pop()}): this weapon now takes it; Save the weapon.`, 'ok');
  } catch (e) { say(e.message, 'bad'); } finally { btn.disabled = false; }
}

// ---------------------------------------------------------------- the window
function ensureDom() {
  if (el) return;
  el = document.createElement('div');
  el.id = 'weapons';
  el.innerHTML = `
    <div class="we-top"><b>Weapons</b><span style="flex:1"></span>
      <button type="button" class="we-close">Close</button></div>
    <div class="we-left">
      <div class="we-h">Weapons</div>
      <div class="we-list"></div>
      <button type="button" class="we-new">+ New weapon</button>
      <div class="we-h">This weapon</div>
      <label class="we-row">Name <input class="we-name" placeholder="Shotgun2" spellcheck="false"></label>
      <label class="we-row">Shown as <input class="we-label" placeholder="Sawn-off shotgun"></label>
      <label class="we-row" title="Its values, its model on the ground and in others' hands, and (with Arms as it) its arms and moves">Held like <select class="we-base"></select></label>
      <label class="we-row" title="The arms and moves: the held-like weapon's, or any first-person model of the game or of other mods' packages (Packages... in the Models tab)">Arms <select class="we-arms"></select></label>
      <div class="we-slots" hidden></div>
      <div class="we-row">Model <button type="button" class="we-pick" data-for="we-file" title="The model and its textures (glTF/GLB, FBX, OBJ...)">Choose…</button><span class="we-fname">none</span>
        <input type="file" class="we-file" multiple accept=".glb,.gltf,.fbx,.obj,.mtl,.dae,.bin,.png,.jpg,.jpeg,.tga,.bmp,.webp" hidden></div>
      <div class="we-h">In the game</div>
      <label class="we-row">Ammunition <select class="we-ammo"></select><button type="button" class="we-ammo-new" title="Ammunition of your own, with its model">+ New</button><button type="button" class="we-ammo-place" title="Put a box of this ammunition into the open map" disabled>Place</button></label>
      <div class="we-ammo-form" hidden>
        <label class="we-row">Name <input class="we-a-name" placeholder="HeavySlugs" spellcheck="false"></label>
        <label class="we-row">Shown as <input class="we-a-label" placeholder="Heavy slugs"></label>
        <label class="we-row" title="Its icons and shell casings: the game's ammunition it is made from">Like <select class="we-a-base"></select></label>
        <label class="we-row">Rounds in a box <input type="number" class="we-a-amount" value="10" min="1" max="999"></label>
        <label class="we-row">Most carried <input type="number" class="we-a-max" value="100" min="1" max="9999"></label>
        <div class="we-row">Model <button type="button" class="we-pick" data-for="we-a-file" title="The ammunition's model and its textures">Choose…</button><span class="we-fname">none</span>
          <input type="file" class="we-a-file" multiple accept=".glb,.gltf,.fbx,.obj,.mtl,.dae,.bin,.png,.jpg,.jpeg,.tga,.bmp,.webp" hidden></div>
        <label class="we-row" title="Its longest side, in units (a 10mm box is about 8)">Size <input type="number" class="we-a-size" value="8" min="1" max="200"></label>
        <div class="we-row we-end"><button type="button" class="we-a-cancel">Cancel</button><button type="button" class="we-a-make">Make ammunition</button></div>
      </div>
      <div class="we-stats"></div>
      <div class="we-h">Sounds</div>
      ${[['fire', 'Shot'], ['reload', 'Reload'], ['select', 'Taken out']].map(([k, l]) => `<label class="we-row">${l} <select class="we-snd" data-snd="${k}"></select></label>`).join('')}
      <div class="we-h">Icon</div>
      <div class="we-row" title="The picture in the inventory and on the belt: the model seen from its left, or a picture of yours">
        <canvas class="we-icon"></canvas>
        <button type="button" class="we-icon-pick">Picture…</button><button type="button" class="we-icon-auto" title="Back to the model seen from its left">Auto</button>
        <input type="file" class="we-icon-file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden></div>
      <div class="we-h">Scope sight</div>
      <div class="we-row" title="What JC sees through the scope (with Scope on): a square picture, see-through where the view shows (PNG); none: the game's own sight">
        <canvas class="we-sight" width="64" height="64"></canvas>
        <button type="button" class="we-sight-pick">Picture…</button><button type="button" class="we-sight-game" title="Back to the game's own sight">Game's</button>
        <input type="file" class="we-sight-file" accept="image/png,image/webp" hidden></div>
      <label class="we-row we-col">Description <textarea class="we-desc" rows="3"></textarea></label>
    </div>
    <div class="we-main">
      <div class="we-bar">
        <select class="we-part" title="Which of the weapon's three models"><option value="fp">Held</option><option value="third">In others' hands</option><option value="ground">On the ground</option></select>
        <select class="we-seq" title="The base's animation"></select>
        <span class="we-transport">
          <button type="button" class="we-first" title="First frame" aria-label="First frame"><svg viewBox="0 0 16 16"><path d="M3 3h2v10H3zM13 3v10L6 8z"/></svg></button>
          <button type="button" class="we-play" title="Play / pause" aria-label="Play / pause"><svg viewBox="0 0 16 16"><path d="M4 3v10l9-5z"/></svg></button>
          <button type="button" class="we-last" title="Last frame" aria-label="Last frame"><svg viewBox="0 0 16 16"><path d="M11 3h2v10h-2zM3 3v10l7-5z"/></svg></button>
        </span>
        <span class="we-fno"></span>
        <div class="we-ruler" title="Click or drag to move the playhead"><span class="we-ph"></span></div>
        <select class="we-mode" title="How you look at it"><option value="fp">As the player sees it</option><option value="orbit">Around it</option></select>
        <select class="we-gizmo" title="The gizmo"><option value="translate">Move (W)</option><option value="rotate">Turn (E)</option><option value="scale">Size (R)</option><option value="off">No gizmo</option></select>
        <label class="hint" title="The game's own gun, to put the new one where it was"><input type="checkbox" class="we-old" checked> old gun</label>
      </div>
      <div class="we-view"></div>
      <div class="we-place">
        ${['x', 'y', 'z'].map((k) => `<label>${k.toUpperCase()} <input type="number" step="0.5" class="we-p-${k}"></label>`).join('')}
        ${['yaw', 'pitch', 'roll'].map((k) => `<label>${k[0].toUpperCase() + k.slice(1)} <input type="number" step="5" class="we-p-${k}"></label>`).join('')}
        <label>Size <input type="number" step="0.01" min="0.001" class="we-p-scale"></label>
        <button type="button" class="we-flip" title="Turn it round (the muzzle the other way)">↺ 180°</button>
        <span style="flex:1"></span>
        <button type="button" class="we-place-map" title="Place the saved weapon in the map open in the editor">Place in map</button>
        <button type="button" class="we-save primary">Save weapon</button>
      </div>
      <div class="we-msg hint">Choose how it is held and the model of the weapon: it goes in the hands, where the game's own gun was.</div>
    </div>`;
  document.body.appendChild(el);
  attachToolWindow(el, $('.we-top'), $('.we-close'));
  $('.we-close').onclick = () => close();
  $('.we-new').onclick = () => newWeapon();
  $('.we-base').onchange = () => setBase($('.we-base').value).catch((e) => say(e.message, 'bad'));
  $('.we-arms').onchange = () => setArms($('.we-arms').value).catch((e) => say(e.message, 'bad'));
  $('.we-file').onchange = () => loadFile([...$('.we-file').files]);
  $('.we-seq').onchange = () => { const s = currentSeq(); if (s) showFrame(s.start); };
  const PLAY = '<svg viewBox="0 0 16 16"><path d="M4 3v10l9-5z"/></svg>', PAUSE = '<svg viewBox="0 0 16 16"><path d="M4 3h3v10H4zM9 3h3v10H9z"/></svg>';
  const setPlay = (on) => { view.play = on; $('.we-play').innerHTML = on ? PAUSE : PLAY; $('.we-play').classList.toggle('on', on); };
  $('.we-play').onclick = () => setPlay(!view.play);
  $('.we-first').onclick = () => { setPlay(false); const s = currentSeq(); if (s) showFrame(s.start); };
  $('.we-last').onclick = () => { setPlay(false); const s = currentSeq(); if (s) showFrame(s.start + (s.frames ?? s.count ?? 1) - 1); };
  // the ruler: click or drag to scrub, frame by frame (as the Studio's)
  const ruler = $('.we-ruler');
  const scrub = (e) => {
    const s = currentSeq(); if (!s) return;
    const n = s.frames ?? s.count ?? 1, r = ruler.getBoundingClientRect();
    setPlay(false);
    showFrame(s.start + Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left) / r.width * n))));
  };
  ruler.onpointerdown = (e) => { ruler.setPointerCapture(e.pointerId); scrub(e); ruler.onpointermove = scrub; };
  ruler.onpointerup = () => { ruler.onpointermove = null; };
  $('.we-mode').onchange = () => { view.mode = $('.we-mode').value; applyCamera(); };
  $('.we-gizmo').onchange = () => { const g = $('.we-gizmo').value; if (g === 'off' || !W?.gun) view.tc.detach(); else { view.tc.setMode(g); view.tc.attach(view.pivot); } };
  $('.we-old').onchange = () => { if (view.oldGun) view.oldGun.visible = $('.we-old').checked; if (view.ref) view.ref.visible = $('.we-old').checked; };
  $('.we-flip').onclick = () => { const P = curPlace(); if (!P) return; P.yaw = ((P.yaw + 180 + 180) % 360) - 180; toPivot(); W.dirty = true; iconSoon(); };
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'scale']) $(`.we-p-${k}`).onchange = () => {
    const P = curPlace();
    if (!P) return;
    P[k] = +$(`.we-p-${k}`).value || (k === 'scale' ? 1 : 0);
    toPivot(); W.dirty = true; iconSoon();
  };
  $('.we-part').onchange = () => setPart($('.we-part').value);
  $('.we-place-map').onclick = () => placeInMap();
  $('.we-save').onclick = () => save();
  // the file pickers: a 22px button and the chosen file's name (the browser's own field is taller)
  for (const b of el.querySelectorAll('.we-pick')) {
    const input = $('.' + b.dataset.for), label = b.nextElementSibling;
    b.onclick = () => input.click();
    input.addEventListener('change', () => { label.textContent = input.files.length ? [...input.files].map((f) => f.name).join(', ') : 'none'; });
  }
  $('.we-ammo').addEventListener('change', ammoPlaceable);
  $('.we-icon-pick').onclick = () => $('.we-icon-file').click();
  $('.we-icon-file').onchange = () => { loadIcon($('.we-icon-file').files[0]); $('.we-icon-file').value = ''; };
  $('.we-icon-auto').onclick = () => { W.icon = null; W.dirty = true; showIcon(); };
  $('.we-sight-pick').onclick = () => $('.we-sight-file').click();
  $('.we-sight-file').onchange = () => { loadSight($('.we-sight-file').files[0]); $('.we-sight-file').value = ''; };
  $('.we-sight-game').onclick = () => { W.sight = null; W.dirty = true; showSight(); };
  $('.we-ammo-place').onclick = (e) => { e.preventDefault(); placeAmmo(); };
  $('.we-ammo-new').onclick = () => { $('.we-ammo-form').hidden = false; $('.we-a-name').focus(); };
  $('.we-a-cancel').onclick = () => { $('.we-ammo-form').hidden = true; };
  $('.we-a-make').onclick = () => makeAmmo();
  el.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const mode = { w: 'translate', e: 'rotate', r: 'scale' }[e.key.toLowerCase()];
    if (mode && W?.gun) { $('.we-gizmo').value = mode; view.tc.setMode(mode); view.tc.attach(view.pivot); e.preventDefault(); }
  });
  el.tabIndex = -1;
  ensureView();
}
// the first-person models to take the arms from: animated models with the moves of one (not pickups, bodies, people)
async function fillArms() {
  if (!info.armsList) {
    const ml = await api('/api/models').catch(() => ({ meshes: [] }));
    info.armsList = (ml.meshes || []).filter((x) => x.seqs >= 5 && x.frames >= 10 && x.pkg !== info.models
      && !/Pickup|3rd|Carcass|Corpse/i.test(x.mesh) && !/Character|Pawn|Deco|Anims$/i.test(x.pkg));
  }
  const by = {};
  for (const x of info.armsList) (by[x.pkg] = by[x.pkg] || []).push(x);
  const now = W?.arms?.mesh || '';
  const known = info.armsList.some((x) => x.mesh === now);
  $('.we-arms').innerHTML = '<option value="">As held like</option>'
    + (now && !known ? `<option value="${esc(now)}">${esc(now)}</option>` : '')
    + Object.entries(by).map(([pkg, list]) => `<optgroup label="${esc(pkg)}">${list.map((x) =>
      `<option value="${esc(x.mesh)}">${esc(x.mesh.split('.').pop())}</option>`).join('')}</optgroup>`).join('');
  $('.we-arms').value = now;
}
const ROLE_UI = { hands: "Player's hands", keep: 'Kept as it is', muzzle: 'Muzzle flash', gun: 'Old gun' };
function renderSlots() {
  const box = $('.we-slots');
  box.hidden = !W?.arms;
  if (!W?.arms) { box.innerHTML = ''; return; }
  const A = W.arms;
  box.innerHTML = Object.keys(A.roles).map((s) => `<label class="we-row" title="${esc(A.tex?.[s] || 'no picture of its own')}">Slot ${s}
      <select data-slot="${s}">${Object.entries(ROLE_UI).map(([k, l]) => `<option value="${k}" ${A.roles[s] === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`).join('')
    + `<div class="we-row" title="PlayerViewOffset: where the game draws the held model from the eye (the weapon class's own, X forward, Y right, Z up)">View
      ${[0, 1, 2].map((k) => `<input type="number" class="we-v" data-k="${k}" step="0.5" value="${A.view[k]}">`).join('')}</div>`;
  for (const sel of box.querySelectorAll('select')) sel.onchange = () => {
    A.roles[sel.dataset.slot] = sel.value; W.dirty = true;
    setBase(W.base).catch((e) => say(e.message, 'bad'));
  };
  for (const inp of box.querySelectorAll('.we-v')) inp.onchange = () => {
    A.view[+inp.dataset.k] = +inp.value || 0; W.dirty = true;
    W.baseP.b.view = A.view; applyCamera();
  };
}
async function setArms(mesh) {
  if (!mesh) W.arms = null;
  else {
    say('Reading the arms...');
    const d = await detectRoles(mesh);
    if (!d.seqs.some((n) => /^(select|shoot|fire)/i.test(n))) say(`${mesh} has no Select or Shoot: it may not be a first-person model.`, 'bad');
    const pre = info.bases.find((b) => b.id === W.base) || info.bases[0];
    W.arms = { mesh, roles: d.roles, tex: d.tex, view: [...pre.view] };
  }
  W.placedOn = null; W.dirty = true;                    // the new gun goes again where the old one is
  renderSlots();
  await setBase(W.base);
}
function renderList() {
  const list = $('.we-list');
  list.innerHTML = info.weapons.length ? info.weapons.map((n) => `<div class="we-item ${W && n === W.name ? 'on' : ''}" data-name="${esc(n)}">${esc(n)}</div>`).join('')
    : '<div class="hint">None yet.</div>';
  for (const i of list.querySelectorAll('[data-name]')) i.onclick = () => openWeapon(i.dataset.name);
}
function renderStats(stats = {}) {
  $('.we-stats').innerHTML = Object.entries(STAT_UI).filter(([k]) => info.stats.includes(k)).map(([k, [label, step]]) => step
    ? `<label class="we-row">${label} <input type="number" data-stat="${k}" step="${step}" value="${stats[k] ?? ''}" placeholder="as the base"></label>`
    : `<label class="we-row">${label} <input type="checkbox" data-stat="${k}" ${stats[k] ? 'checked' : ''} ${k in stats ? 'data-saved="1"' : ''}></label>`).join('');
  for (const c of el.querySelectorAll('.we-stats input[type=checkbox]')) c.onchange = () => { c.dataset.touched = '1'; };
}
async function setBase(id) {
  W.base = id;
  say('Reading the base weapon...');
  const b = baseFor();
  W.baseP = Object.assign({}, await prepareBase(b), { b });     // the eye can change without reading it again
  const seqs = W.baseP.m.seqs.filter((s) => !s.custom && !/^all$/i.test(s.name));
  $('.we-seq').innerHTML = seqs.map((s) => `<option>${esc(s.name)}</option>`).join('');
  $('.we-seq').value = seqs.some((s) => s.name === 'Idle1') ? 'Idle1' : seqs[0]?.name;
  if (W.gun && !W.placedOn) { W.place = firstPlacement(W.baseP, W.gun); W.placedOn = id; }
  view.orbited = false;
  applyCamera();
  rebuildScene();
  const s = currentSeq();
  showFrame(s ? s.start : 0);
  showIcon();
  say(W.gun ? 'Put it in the hands: drag the gizmo (W move, E turn, R size) or type the numbers, then play the animations to check.'
    : 'Now choose the model of the weapon (glTF/GLB, FBX, OBJ...).');
}
async function loadFile(files) {
  if (!files.length) return;
  say('Reading the model...');
  try {
    W.gun = await readGun(files);
    W.placedOn = W.base;
    W.place = firstPlacement(W.baseP, W.gun);
    showIcon();
    if (!$('.we-name').value) $('.we-name').value = W.gun.name.replace(/\W+/g, '_').replace(/^[^A-Za-z]+/, '').slice(0, 30);
    rebuildScene();
    say(`${W.gun.payload.indices.length / 3} triangles. Put it in the hands: drag the gizmo (W move, E turn, R size) or type the numbers; ↺ 180° if the muzzle points back.`);
  } catch (e) { say(e.message, 'bad'); }
}
async function newWeapon() {
  W = { name: '', base: info.bases[0].id, gun: null, place: null, stats: {}, arms: null, sight: null };
  showSight();
  fillArms(); renderSlots();
  $('.we-name').value = ''; $('.we-label').value = ''; $('.we-desc').value = ''; $('.we-file').value = ''; for (const n of el.querySelectorAll('.we-fname')) n.textContent = 'none';
  $('.we-base').value = W.base;
  $('.we-ammo').value = ''; ammoPlaceable();
  renderStats();
  fillSounds();
  PART = 'fp'; $('.we-part').value = 'fp';
  renderList();
  await setBase(W.base);
}
async function openWeapon(name) {
  const w = await api('/api/weapon?name=' + encodeURIComponent(name));
  const pl = w.placement || {}, held = pl.fp || (pl.x !== undefined ? pl : null);      // older weapons: the held one only
  W = { name, base: w.base, gun: null, place: held, place3: pl.third || null, placeG: pl.ground || null, placedOn: w.base, stats: w.stats || {}, icon: null };
  if (w.arms) W.arms = Object.assign({ tex: {} }, w.arms, { tex: (await detectRoles(w.arms.mesh).catch(() => ({}))).tex || {} });
  await fillArms(); renderSlots();
  if (w.scope_pic) W.sight = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = w.scope_pic; });
  showSight();
  if (w.icon) W.icon = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = w.icon; });
  try {
    const g = await api('/api/weapon_gun?name=' + encodeURIComponent(name));
    if (g.positions) {
      const pos = new Float32Array(g.positions.length);
      for (let i = 0; i < pos.length; i += 3) { pos[i] = g.positions[i]; pos[i + 1] = g.positions[i + 2]; pos[i + 2] = g.positions[i + 1]; }
      W.gun = { name: g.name || name, pos, payload: g };
    }
  } catch (e) { /* kept from before the editor kept models: choose the file again */ }
  $('.we-name').value = name; $('.we-label').value = w.label || ''; $('.we-desc').value = w.description || '';
  $('.we-base').value = w.base; $('.we-ammo').value = w.ammo || ''; ammoPlaceable();
  renderStats(w.stats);
  fillSounds(w.sounds || {});
  PART = 'fp'; $('.we-part').value = 'fp';
  renderList();
  await setBase(w.base);
  say(W.gun ? `${name}: its model, where it goes and its values, as saved.` : `${name}: choose its model file again (it was saved before the editor kept models).`);
}
async function open() {
  ensureDom();
  el.style.display = 'grid';
  view.start();
  try {
    info = await api('/api/weapons');
    $('.we-base').innerHTML = info.bases.map((b) => `<option value="${b.id}">${esc(b.label)}</option>`).join('');
    await loadSounds();
    fillAmmo();
    $('.we-a-base').innerHTML = info.ammo.map((a) => `<option>${a}</option>`).join('');
    if (!W) await newWeapon(); else renderList();
  } catch (e) { say(e.message, 'bad'); }
  el.focus();
}
function close() {
  if (W?.dirty && !confirm('Close the Weapons window? The changes not saved are lost.')) return;
  el.style.display = 'none';
}
window.__weapons = { open, get state() { return W; }, bake, prepareBase, trimmedFit };
