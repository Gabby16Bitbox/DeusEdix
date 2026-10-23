// Animation Studio of the map editor: the characters' animations made, imported and put in the game.
//
// Deus Ex animates its characters frame by frame (every vertex has a position in every frame, no
// skeleton). The Studio gives each model a skeleton made from the game's own animations (the vertices
// that move together belong to the same bone: rigid fits of every bone in every frame, then each vertex to
// the bone that explains its motion best, then the joints where two bones turn about), poses that
// skeleton (key frames, or a file of motion capture: BVH, FBX such as Mixamo's, glTF) and bakes the
// animation into frames of the model like the game's. editor/anims.py keeps the animations
// (tools/mapkit/anims) and packs the models with them into UCAnims.u; the mod's UCAnimSet gives a
// character that model in the game (its own or the HDTP one).
//
// Space: three.js (Y up). The game's actor space (X forward, Y right, Z up) is mapped (x, z, y), so the
// characters face +x and their right is +z. The swap turns the triangles' winding round: their corners are
// taken in the other order (buildModel), or the inside of the far side is drawn (the back seen from the front).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { sampleCurve, upsertKey, continuousAngle } from './studio-curves.js';
import { migrateTracks, sampleTrack, upsertTrackKey, moveTrackKey, deleteTrackKey } from './studio-tracks.js';
import { createCurveEditor } from './studio-graph.js';
import { createPropPreview, renderPropPanel, bakeProps } from './studio-props.js';
import { createStudioNavigation } from './studio-navigation.js';
import { attachToolWindow } from './tool-window.js';
import { attachNumberScrub } from './number-scrub.js';
import { GRIP_SIDES, gripChannel, gripSide, gripKeys, gripAt, setGripKey, removeGripKey, moveGripKey, trimGrip, gripShapes, gripRest } from './studio-grip.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
}
const YAW = 65536;
// sequences that are not motions of the body (faces, the whole table): left out of the rig's fits
const NOT_BODY = /^(All|Still|Mouth\w*|Blink|Head(Up|Down|Left|Right))$/;

// ---------------------------------------------------------------- the skeleton
// [name, parent, label]; the tail of a bone is its first child's joint (or its own tip)
const BONES = [
  ['pelvis', null, 'Hips'], ['spine', 'pelvis', 'Belly'], ['chest', 'spine', 'Chest'], ['neck', 'chest', 'Neck'], ['head', 'neck', 'Head'],
  ['l_upperarm', 'chest', 'Left arm'], ['l_forearm', 'l_upperarm', 'Left forearm'], ['l_hand', 'l_forearm', 'Left hand'],
  ['r_upperarm', 'chest', 'Right arm'], ['r_forearm', 'r_upperarm', 'Right forearm'], ['r_hand', 'r_forearm', 'Right hand'],
  ['l_thigh', 'pelvis', 'Left thigh'], ['l_calf', 'l_thigh', 'Left leg'], ['l_foot', 'l_calf', 'Left foot'],
  ['r_thigh', 'pelvis', 'Right thigh'], ['r_calf', 'r_thigh', 'Right leg'], ['r_foot', 'r_calf', 'Right foot'],
];
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
const PARENT = BONES.map((b) => (b[1] ? BI[b[1]] : -1));
const NB = BONES.length;
// the first child that continues the bone (for its direction): chest -> neck, pelvis -> spine
const NEXT = { pelvis: 'spine', spine: 'chest', chest: 'neck', neck: 'head', l_upperarm: 'l_forearm', l_forearm: 'l_hand',
  r_upperarm: 'r_forearm', r_forearm: 'r_hand', l_thigh: 'l_calf', l_calf: 'l_foot', r_thigh: 'r_calf', r_calf: 'r_foot' };

// ---------------------------------------------------------------- the model's frames
function parseModel(info, buf, custom) {
  const c = info.counts, dv = new DataView(buf);
  let o = info.offset;
  const faces = new Uint16Array(c.faces * 4), wedges = new Uint16Array(c.wedges), uvs = new Float32Array(c.wedges * 2);
  for (let i = 0; i < c.faces * 4; i++, o += 2) faces[i] = dv.getUint16(o, true);
  for (let i = 0; i < c.wedges; i++, o += 4) { wedges[i] = dv.getUint16(o, true); uvs[2 * i] = dv.getUint8(o + 2) / 256; uvs[2 * i + 1] = dv.getUint8(o + 3) / 256; }
  o += c.specialFaces * 8;
  const FV = c.frameVerts;
  const extra = custom.reduce((n, x) => n + x.data.byteLength / 6, 0);
  const raw = new Int16Array(c.verts * 3 + extra * 3);
  for (let i = 0; i < c.verts * 3; i++, o += 2) raw[i] = dv.getInt16(o, true);
  let at = c.verts * 3;
  const seqs = info.seqs.map((s) => Object.assign({}, s));
  let frame = c.frames;
  for (const x of custom) {
    raw.set(new Int16Array(x.data), at);
    at += x.data.byteLength / 2;
    seqs.push({ name: x.name, group: 'Animation Studio', start: frame, frames: x.frames, rate: x.rate, custom: true });
    frame += x.frames;
  }
  const n = raw.length / 3, pos = new Float32Array(n * 3);
  const [kx, ky, kz] = info.scale, [ox, oy, oz] = info.origin, yaw = info.rot[1] * 2 * Math.PI / YAW, cs = Math.cos(yaw), sn = Math.sin(yaw);
  for (let i = 0; i < n; i++) {          // actor space (as the engine's GetFrame), then three.js (x, z, y)
    const x = (raw[3 * i] - ox) * kx, y = (raw[3 * i + 1] - oy) * ky, z = (raw[3 * i + 2] - oz) * kz;
    pos[3 * i] = x * cs - y * sn; pos[3 * i + 1] = z; pos[3 * i + 2] = x * sn + y * cs;
  }
  return { info, faces, wedges, uvs, pos, FV, SV: c.specialVerts, frames: frame, seqs };
}
// three.js positions -> the model's raw units (int16), for the baked frames
function toRaw(info, P, out, at) {
  const [kx, ky, kz] = info.scale, [ox, oy, oz] = info.origin, yaw = info.rot[1] * 2 * Math.PI / YAW, cs = Math.cos(yaw), sn = Math.sin(yaw);
  const clamp = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
  for (let i = 0; i < P.length / 3; i++) {
    const X = P[3 * i], Y = P[3 * i + 2], Z = P[3 * i + 1];       // actor space
    const x = X * cs + Y * sn, y = -X * sn + Y * cs;                // turned back by RotOrigin's yaw
    out[at + 3 * i] = clamp(x / kx + ox); out[at + 3 * i + 1] = clamp(y / ky + oy); out[at + 3 * i + 2] = clamp(Z / kz + oz);
  }
}
async function loadModel(mesh) {
  const info = await api('/api/anims?mesh=' + encodeURIComponent(mesh));
  const [buf, ...custom] = await Promise.all([fetch(info.url).then((r) => r.arrayBuffer()),
    ...(info.custom || []).map((x) => fetch(x.url).then((r) => r.arrayBuffer()).then((data) => Object.assign({}, x, { data })))]);
  return parseModel(info, buf, custom);
}
const framePos = (m, f) => m.pos.subarray(f * m.FV * 3, (f + 1) * m.FV * 3);

// ---------------------------------------------------------------- rigid fits (Horn's quaternion method)
function eigSym4(A) {                        // Jacobi: eigenvalues and eigenvectors (columns) of a symmetric 4x4
  const a = A.slice(), v = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 40; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) off += a[p * 4 + q] * a[p * 4 + q];
    if (off < 1e-20) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) {
      const apq = a[p * 4 + q];
      if (Math.abs(apq) < 1e-30) continue;
      const theta = (a[q * 4 + q] - a[p * 4 + p]) / (2 * apq);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) { const kp = a[k * 4 + p], kq = a[k * 4 + q]; a[k * 4 + p] = c * kp - s * kq; a[k * 4 + q] = s * kp + c * kq; }
      for (let k = 0; k < 4; k++) { const pk = a[p * 4 + k], qk = a[q * 4 + k]; a[p * 4 + k] = c * pk - s * qk; a[q * 4 + k] = s * pk + c * qk; }
      for (let k = 0; k < 4; k++) { const kp = v[k * 4 + p], kq = v[k * 4 + q]; v[k * 4 + p] = c * kp - s * kq; v[k * 4 + q] = s * kp + c * kq; }
    }
  }
  return { vals: [a[0], a[5], a[10], a[15]], vecs: v };
}
// the rotation and translation taking the points idx of X (rest) onto Y: {q: [x, y, z, w], t: [x, y, z]}
function rigidFit(X, Y, idx) {
  const n = idx.length;
  let cx = 0, cy = 0, cz = 0, dx = 0, dy = 0, dz = 0;
  for (const i of idx) { cx += X[3 * i]; cy += X[3 * i + 1]; cz += X[3 * i + 2]; dx += Y[3 * i]; dy += Y[3 * i + 1]; dz += Y[3 * i + 2]; }
  cx /= n; cy /= n; cz /= n; dx /= n; dy /= n; dz /= n;
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (const i of idx) {
    const ax = X[3 * i] - cx, ay = X[3 * i + 1] - cy, az = X[3 * i + 2] - cz;
    const bx = Y[3 * i] - dx, by = Y[3 * i + 1] - dy, bz = Y[3 * i + 2] - dz;
    Sxx += ax * bx; Sxy += ax * by; Sxz += ax * bz; Syx += ay * bx; Syy += ay * by; Syz += ay * bz; Szx += az * bx; Szy += az * by; Szz += az * bz;
  }
  const N = [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx,
    Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz,
    Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy,
    Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz];
  const { vals, vecs } = eigSym4(N);
  let best = 0;
  for (let k = 1; k < 4; k++) if (vals[k] > vals[best]) best = k;
  const q = new THREE.Quaternion(vecs[4 + best], vecs[8 + best], vecs[12 + best], vecs[best]).normalize();
  return fitOf(q, cx, cy, cz, dx, dy, dz);
}
// a fit {q, t, m: rotation matrix row by row} from its rotation and the two centres
function fitOf(q, cx = 0, cy = 0, cz = 0, dx = 0, dy = 0, dz = 0) {
  const c = new THREE.Vector3(cx, cy, cz).applyQuaternion(q);
  const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;          // column-major
  return { q, t: new THREE.Vector3(dx - c.x, dy - c.y, dz - c.z), m: [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]] };
}
const IDENT = fitOf(new THREE.Quaternion());

// ---------------------------------------------------------------- the automatic rig
function band(P, FV, lo, hi) { const out = []; for (let i = 0; i < FV; i++) { const y = P[3 * i + 1]; if (y >= lo && y <= hi) out.push(i); } return out; }
function centroid(P, idx) { const c = new THREE.Vector3(); for (const i of idx) c.add(new THREE.Vector3(P[3 * i], P[3 * i + 1], P[3 * i + 2])); return idx.length ? c.multiplyScalar(1 / idx.length) : null; }
function segDist(p, a, b) {
  const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}
// the frames the fits use: every motion of the body, evenly over the model's sequences
function sampleFrames(m, max = 140) {
  const all = [];
  for (const s of m.seqs) if (!s.custom && !NOT_BODY.test(s.name)) for (let f = 0; f < s.frames; f++) all.push(s.start + f);
  const step = Math.max(1, all.length / max), out = [];
  for (let k = 0; k < all.length; k += step) out.push(all[Math.floor(k)]);
  return out;
}
function refFrame(m) {
  const s = m.seqs.find((x) => x.name === 'BreatheLight') || m.seqs.find((x) => x.name === 'Still') || m.seqs[0];
  return s ? s.start : 0;
}
// the first guess of the joints from the shape of a standing body (fractions of its height)
function guessJoints(m, P) {
  const FV = m.FV;
  let minY = Infinity, maxY = -Infinity, cx = 0, cz = 0;
  for (let i = 0; i < FV; i++) { minY = Math.min(minY, P[3 * i + 1]); maxY = Math.max(maxY, P[3 * i + 1]); cx += P[3 * i]; cz += P[3 * i + 2]; }
  cx /= FV; cz /= FV;
  const H = maxY - minY, Y = (k) => minY + k * H;
  // the right hand holds the weapon triangle (the special vertices): its side is the right
  let side = 1;
  if (m.SV) { let z = 0; for (let i = 0; i < m.SV; i++) z += P[3 * i + 2]; side = z / m.SV >= cz ? 1 : -1; }
  const sh = band(P, FV, Y(0.76), Y(0.84));
  let wS = 0;
  for (const i of sh) wS = Math.max(wS, Math.abs(P[3 * i + 2] - cz));
  wS = wS || 0.12 * H;
  const J = {};
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  J.pelvis = v(cx, Y(0.52), cz); J.spine = v(cx, Y(0.62), cz); J.chest = v(cx, Y(0.73), cz); J.neck = v(cx, Y(0.85), cz);
  J.head = v(cx, Y(0.895), cz);
  // the top of the head straight above it (the centre of the whole body leant it backwards)
  J.head_tip = centroid(P, band(P, FV, Y(0.97), maxY)) || v(cx, maxY, cz);
  J.head_tip.y = maxY;
  // the front: the shoes stick out in front of the legs (+x for the game's models)
  let fs = 0;
  for (const k of [side, -side]) {
    const foot = centroid(P, band(P, FV, Y(0.0), Y(0.06)).filter((i) => k * (P[3 * i + 2] - cz) > 0.02 * H));
    const calf = centroid(P, band(P, FV, Y(0.26), Y(0.30)).filter((i) => k * (P[3 * i + 2] - cz) > 0.02 * H));
    if (foot && calf) fs += foot.x - calf.x;
  }
  fs = fs > 0 ? 1 : -1;
  for (const [s, k] of [['r', side], ['l', -side]]) {
    const arm = (lo, hi) => centroid(P, band(P, FV, Y(lo), Y(hi)).filter((i) => k * (P[3 * i + 2] - cz) > 0.55 * wS));
    J[s + '_upperarm'] = v(cx, Y(0.815), cz + k * 0.72 * wS);
    J[s + '_forearm'] = arm(0.60, 0.66) || v(cx, Y(0.63), cz + k * 0.85 * wS);
    J[s + '_hand'] = arm(0.45, 0.50) || v(cx, Y(0.475), cz + k * 0.85 * wS);
    const tip = band(P, FV, Y(0.30), Y(0.47)).filter((i) => k * (P[3 * i + 2] - cz) > 0.55 * wS);
    J[s + '_hand_tip'] = tip.length ? centroid(P, tip) : J[s + '_hand'].clone().add(v(0, -0.08 * H, 0));
    const leg = (lo, hi) => centroid(P, band(P, FV, Y(lo), Y(hi)).filter((i) => k * (P[3 * i + 2] - cz) > 0.02 * H));
    J[s + '_thigh'] = v(cx, Y(0.50), cz + k * 0.09 * H);
    J[s + '_calf'] = leg(0.26, 0.30) || v(cx, Y(0.28), cz + k * 0.09 * H);
    J[s + '_foot'] = leg(0.04, 0.08) || v(cx, Y(0.06), cz + k * 0.09 * H);
    let toe = null;
    for (const i of band(P, FV, minY, Y(0.06))) if (k * (P[3 * i + 2] - cz) > 0 && (!toe || fs * P[3 * i] > fs * toe.x)) toe = v(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    J[s + '_foot_tip'] = toe || J[s + '_foot'].clone().add(v(fs * 0.12 * H, -0.04 * H, 0));
  }
  return { J, H, side, minY, front: fs };
}
// The hands: the game's characters hold them still on the forearm in every animation, so the fits cannot tell
// them apart (the hand bone took the forearm and the wrist landed on the elbow). Their skin is the head's
// texture and the sleeve has its own: those vertices of the lower arm are the hand. A model whose hands share
// the sleeve's texture (gloves) or whose whole forearm is bare gets what lies past the wrist's guess.
function handVertices(m, P, assign, J) {
  const slots = Array.from({ length: m.FV }, () => new Set());
  for (let k = 0; k < m.info.counts.faces; k++) {
    const mat = m.info.mats[m.faces[4 * k + 3]] || [0, 0];
    for (let c = 0; c < 3; c++) { const v = m.wedges[m.faces[4 * k + c]] + m.SV; if (v < m.FV) slots[v].add(mat[0]); }
  }
  const count = new Map();
  for (let i = 0; i < m.FV; i++) if (assign[i] === BI.head) for (const s of slots[i]) count.set(s, (count.get(s) || 0) + 1);
  const skin = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  const out = { by: 'skin' };
  let nb_ = null;
  for (const s of ['l', 'r']) {
    const fore = BI[s + '_forearm'], hand = BI[s + '_hand'], elbow = J[s + '_forearm'];
    const axis = J[s + '_hand_tip'].clone().sub(elbow).normalize();
    const along = (i) => (P[3 * i] - elbow.x) * axis.x + (P[3 * i + 1] - elbow.y) * axis.y + (P[3 * i + 2] - elbow.z) * axis.z;
    const lower = [];
    for (let i = 0; i < m.FV; i++) if (assign[i] === fore || assign[i] === hand) lower.push(i);
    let set = skin === undefined ? [] : lower.filter((i) => slots[i].size === 1 && slots[i].has(skin));
    if (set.length < 3 || set.length > 0.8 * lower.length) {
      const cut = J[s + '_hand'].clone().sub(elbow).dot(axis);
      set = lower.filter((i) => along(i) >= cut);
      // but not a coat's or a skirt's vertices beside the hanging hand: most of their neighbours on the mesh are
      // the body's (HDTP JC: a raised arm drew a strip of the coat from the hip, 18 Oct 2026)
      const nb = nb_ || (nb_ = meshNeighbours(m)), arm = new Set(lower);
      for (let changed = true; changed;) {
        changed = false;
        for (const i of set) if (arm.has(i) && 2 * [...nb[i]].filter((j) => arm.has(j)).length < nb[i].size) { arm.delete(i); changed = true; }
      }
      set = set.filter((i) => arm.has(i));
      out.by = 'shape';
    }
    const sorted = set.slice().sort((a, b) => along(a) - along(b)), n = Math.max(1, Math.ceil(sorted.length * 0.2));
    out[s] = new Set(set);
    out[s + '_wrist'] = centroid(P, sorted.slice(0, n)) || J[s + '_hand'].clone();
    out[s + '_tip'] = centroid(P, sorted.slice(-n)) || J[s + '_hand_tip'].clone();
  }
  return out;
}
// the vertices each vertex shares a face with
function meshNeighbours(m) {
  const nb = Array.from({ length: m.FV }, () => new Set());
  for (let k = 0; k < m.info.counts.faces; k++) {
    const t = [0, 1, 2].map((c) => m.wedges[m.faces[4 * k + c]] + m.SV);
    for (const a of t) for (const b of t) if (a !== b && a < m.FV && b < m.FV) nb[a].add(b);
  }
  return nb;
}
const HAND_PAIRS = new Set(['l', 'r'].flatMap((s) => [`${BI[s + '_forearm']},${BI[s + '_hand']}`, `${BI[s + '_hand']},${BI[s + '_forearm']}`]));
function tailOf(J, name) {
  if (NEXT[name]) return J[NEXT[name]];
  return J[name + '_tip'] || J[name].clone().add(new THREE.Vector3(0, 0.05, 0));
}
// One skeleton for every human of the game: the limbs' joints stay at a human's proportions (fractions of the
// model's own height, so a child is a smaller human), only refined inside these bands by the game's motion. Left
// free, the motion put a suit's knee at 0.39 of its height and a trench coat's at 0.49 (its flaps move with the
// legs); in the bands the game's animations are copied as well (Studio bench, 18 Oct 2026).
const BANDS = { upperarm: [0.76, 0.84], forearm: [0.58, 0.67], thigh: [0.45, 0.53], calf: [0.24, 0.32], foot: [0.02, 0.09] };
// rig: {mesh, ref, H, side, joints: {bone: [x, y, z]}, tails, bone: per vertex [b1, w1, b2, w2], error}
function autoRig(m, mesh, progress = () => {}) {
  const ref = refFrame(m), P = framePos(m, ref), FV = m.FV;
  const { J, H, side, front, minY } = guessJoints(m, P);
  const joints = BONES.map(([n]) => J[n].clone()), tails = BONES.map(([n]) => tailOf(J, n).clone());
  const vp = (i) => new THREE.Vector3(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
  // the bones each vertex may belong to: the nearest ones
  const cand = [], assign = new Int32Array(FV);
  for (let i = 0; i < FV; i++) {
    const p = vp(i), d = BONES.map((b, k) => [segDist(p, joints[k], tails[k]), k]).sort((x, y) => x[0] - y[0]);
    cand.push(d.filter((x, j) => j < 5 && x[0] < d[0][0] + 0.14 * H).map((x) => x[1]));
    assign[i] = d[0][1];
  }
  // the hands and their wrists, kept through the fits (the motion alone puts them on the forearm)
  const hands = handVertices(m, P, assign, J);
  const keepHands = () => {
    for (const s of ['l', 'r']) {
      const fore = BI[s + '_forearm'], hand = BI[s + '_hand'];
      for (let i = 0; i < FV; i++) { if (hands[s].has(i)) assign[i] = hand; else if (assign[i] === hand) assign[i] = fore; }
    }
  };
  for (const s of ['l', 'r']) {
    joints[BI[s + '_hand']].copy(hands[s + '_wrist']); tails[BI[s + '_hand']].copy(hands[s + '_tip']);
    tails[BI[s + '_forearm']].copy(hands[s + '_wrist']);
  }
  keepHands();
  const frames = sampleFrames(m);
  const fits = frames.map(() => new Array(NB));
  let err = new Float64Array(FV);
  const fitAll = () => {
    const members = BONES.map(() => []);
    for (let i = 0; i < FV; i++) members[assign[i]].push(i);
    frames.forEach((f, k) => {
      const Y = framePos(m, f);
      for (let b = 0; b < NB; b++) {
        if (members[b].length >= 3) fits[k][b] = rigidFit(P, Y, members[b]);
        else fits[k][b] = null;
      }
      for (let b = 0; b < NB; b++) if (!fits[k][b]) { let p = PARENT[b]; while (p >= 0 && !fits[k][p]) p = PARENT[p]; fits[k][b] = p >= 0 ? fits[k][p] : IDENT; }
    });
    return members;
  };
  const Ys = frames.map((f) => framePos(m, f));
  const residual = (i, b) => {
    let e = 0;
    const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
    for (let k = 0; k < frames.length; k++) {
      const F = fits[k][b], R = F.m, Y = Ys[k];
      const px = R[0] * x + R[1] * y + R[2] * z + F.t.x - Y[3 * i];
      const py = R[3] * x + R[4] * y + R[5] * z + F.t.y - Y[3 * i + 1];
      const pz = R[6] * x + R[7] * y + R[8] * z + F.t.z - Y[3 * i + 2];
      e += px * px + py * py + pz * pz;
    }
    return e / frames.length;
  };
  for (let it = 0; it < 6; it++) {
    progress(`fitting the skeleton ${it + 1}/6`);
    fitAll();
    for (let i = 0; i < FV; i++) {
      let best = assign[i], be = Infinity;
      for (const b of cand[i]) { const e = residual(i, b); if (e < be) { be = e; best = b; } }
      assign[i] = best; err[i] = be;
    }
    keepHands();
    // the joints: the point both bones carry the same way (least squares, held near the guess)
    if (it >= 2) {
      for (let c = 1; c < NB; c++) {
        if (c === BI.l_hand || c === BI.r_hand) continue;       // the wrists stay where the skin begins
        const p = PARENT[c];
        const M = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0), rhs = new THREE.Vector3();
        const A = new Array(9).fill(0);
        const lam = 0.15 * frames.length;
        frames.forEach((f, k) => {
          const Rp = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(fits[k][p].q)).elements;
          const Rc = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(fits[k][c].q)).elements;
          const D = Rp.map((v, j) => v - Rc[j]);            // column-major 3x3
          const b = fits[k][c].t.clone().sub(fits[k][p].t);
          // A += D^T D, rhs += D^T b
          for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) {
            let sum = 0;
            for (let t = 0; t < 3; t++) sum += D[r * 3 + t] * D[s * 3 + t];      // (D^T D)[r][s] with D column-major
            A[r * 3 + s] += sum;
          }
          rhs.x += D[0] * b.x + D[1] * b.y + D[2] * b.z;
          rhs.y += D[3] * b.x + D[4] * b.y + D[5] * b.z;
          rhs.z += D[6] * b.x + D[7] * b.y + D[8] * b.z;
        });
        for (let r = 0; r < 3; r++) A[r * 3 + r] += lam;
        rhs.addScaledVector(joints[c], lam);
        M.set(A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8]);
        if (Math.abs(M.determinant()) < 1e-9) continue;
        const x = rhs.applyMatrix3(M.invert());
        const band = BANDS[BONES[c][0].replace(/^[lr]_/, '')];
        if (band) x.y = Math.max(minY + band[0] * H, Math.min(minY + band[1] * H, x.y));
        if (x.distanceTo(joints[c]) < 0.12 * H) joints[c].copy(x);
      }
      BONES.forEach(([n], k) => { if (NEXT[n]) tails[k].copy(joints[BI[NEXT[n]]]); });
    }
  }
  // the knees on the line from the hip to the ankle, a little forward as a body stands: the middle of a coat's
  // or a skirt's band put one 10 units aside or behind, and IK bent it the wrong way
  for (const s of ['l', 'r']) {
    const hip = joints[BI[s + '_thigh']], knee = joints[BI[s + '_calf']], ankle = joints[BI[s + '_foot']];
    const t = Math.max(0, Math.min(1, (hip.y - knee.y) / Math.max(1e-6, hip.y - ankle.y)));
    knee.x = hip.x + (ankle.x - hip.x) * t + 0.02 * H; knee.z = hip.z + (ankle.z - hip.z) * t;
    tails[BI[s + '_thigh']].copy(knee);
  }
  fitAll();
  // two bones blend where both explain a vertex's motion nearly as well (around the joints)
  const weights = [];
  let total = 0;
  for (let i = 0; i < FV; i++) {
    const b1 = assign[i], e1 = Math.max(1e-6, residual(i, b1));
    total += e1;
    let b2 = -1, e2 = Infinity;
    for (const b of cand[i]) if (b !== b1 && (PARENT[b] === b1 || PARENT[b1] === b) && !HAND_PAIRS.has(`${b1},${b}`)) { const e = residual(i, b); if (e < e2) { e2 = e; b2 = b; } }
    const r = b2 >= 0 ? e1 / e2 : 0, w2 = 0.5 * Math.max(0, (r - 0.45) / 0.55);
    weights.push(w2 > 0.02 ? [b1, 1 - w2, b2, w2] : [b1, 1, b1, 0]);
  }
  progress('');
  return { version: RIG_VERSION, hands: hands.by, mesh, ref, H, side, front, joints: joints.map((v) => v.toArray().map((x) => +x.toFixed(3))),
    tails: tails.map((v) => v.toArray().map((x) => +x.toFixed(3))), weights, error: +Math.sqrt(total / FV).toFixed(3) };
}

// ---------------------------------------------------------------- poses: local rotations from the rest pose
// pose: {rot: [Quaternion per bone], root: Vector3 (offset of the hips)}
const restPose = () => ({ rot: BONES.map(() => new THREE.Quaternion()), root: new THREE.Vector3() });
function worldOf(rig, pose) {               // world rotation and joint of every bone
  const J = rig.joints.map((a) => new THREE.Vector3().fromArray(a));
  const Rw = [], Jw = [];
  for (let b = 0; b < NB; b++) {
    const p = PARENT[b];
    if (p < 0) { Rw[b] = pose.rot[b].clone(); Jw[b] = J[b].clone().add(pose.root); }
    else { Rw[b] = Rw[p].clone().multiply(pose.rot[b]); Jw[b] = J[b].clone().sub(J[p]).applyQuaternion(Rw[p]).add(Jw[p]); }
  }
  return { Rw, Jw, J };
}
function skin(rig, m, pose, out) {          // the model's vertices in a pose (linear blend of two bones)
  const { Rw, Jw, J } = worldOf(rig, pose), P = handsOf(rig, m, pose);
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < m.FV; i++) {
    const [b1, w1, b2, w2] = rig.weights[i];
    v.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    a.copy(v).sub(J[b1]).applyQuaternion(Rw[b1]).add(Jw[b1]).multiplyScalar(w1);
    if (w2 > 0) { b.copy(v).sub(J[b2]).applyQuaternion(Rw[b2]).add(Jw[b2]).multiplyScalar(w2); a.add(b); }
    out[3 * i] = a.x; out[3 * i + 1] = a.y; out[3 * i + 2] = a.z;
  }
  // the shoulders and the elbows: their vertices turn part of the way with the arm (seamsOf)
  const S = seamsOf(rig, m), q = new THREE.Quaternion(), I = new THREE.Quaternion();
  for (let k = 0; k < S.v.length; k++) {
    const i = S.v[k], p = S.p[k], c = S.c[k];
    v.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    partialTurn(v, J, p, c, q.copy(I).slerp(pose.rot[c], S.w[k]), Rw[p], Jw[p]);
    out[3 * i] = v.x; out[3 * i + 1] = v.y; out[3 * i + 2] = v.z;
  }
  return out;
}
// The shoulders and the elbows. The fits give the top of a sleeve to the chest (the game's animations hardly
// raise an arm sideways): a raised arm stretched the sleeve from it and its faces turned inside out (Male1 and
// JC's trench coat, 18 Oct 2026). Near these joints a vertex turns about the joint by a share of the arm's turn
// (slerp: no shrinking as with a blend of two bones): the share that follows the game's own frames best, kept
// close to its neighbours' on the mesh, so that a face never spans a jump. With the arm still nothing moves;
// made when a rig is first skinned, not kept in its file.
const SEAM_BONES = ['l_upperarm', 'r_upperarm', 'l_forearm', 'r_forearm'];
const SEAM_STEPS = 20, SEAM_SMOOTH = 8;
const seamCache = new WeakMap();
// v (rest) turned by q (a share of the child c's turn) about c's joint, then carried by the parent p
function partialTurn(v, J, p, c, q, Rp, Jp) {
  return v.sub(J[c]).applyQuaternion(q).add(J[c]).sub(J[p]).applyQuaternion(Rp).add(Jp);
}
function seamsOf(rig, m) {
  let S = seamCache.get(rig);
  if (S && S.m === m) return S;
  const FV = m.FV, P = framePos(m, rig.ref), J = rig.joints.map((a) => new THREE.Vector3().fromArray(a));
  const frames = sampleFrames(m), poses = frames.map((f) => poseFromFrame(rig, m, f)), worlds = poses.map((p) => worldOf(rig, p));
  const below = (c) => { const set = new Set([c]); for (let b = c + 1; b < NB; b++) if (set.has(PARENT[b])) set.add(b); return set; };
  const near = new Map();          // vertex -> {p, c, kids, d, E: error per share}
  const v = new THREE.Vector3(), x = new THREE.Vector3(), q = new THREE.Quaternion(), I = new THREE.Quaternion();
  for (const n of SEAM_BONES) {
    const c = BI[n], p = PARENT[c], kids = below(c), L = J[c].distanceTo(new THREE.Vector3().fromArray(rig.tails[c]));
    for (let i = 0; i < FV; i++) {
      const [b1, , b2, w2] = rig.weights[i];
      if ((b1 !== p && b1 !== c) || (w2 > 0 && b2 !== p && b2 !== c)) continue;
      const d = v.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]).distanceTo(J[c]);
      if (d > 0.6 * L || (near.has(i) && near.get(i).d < d)) continue;
      const E = [];
      for (let s = 0; s <= SEAM_STEPS; s++) {
        let e = 0;
        frames.forEach((f, k) => {
          const Y = framePos(m, f);
          partialTurn(x.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]), J, p, c, q.copy(I).slerp(poses[k].rot[c], s / SEAM_STEPS), worlds[k].Rw[p], worlds[k].Jw[p]);
          e += (x.x - Y[3 * i]) ** 2 + (x.y - Y[3 * i + 1]) ** 2 + (x.z - Y[3 * i + 2]) ** 2;
        });
        E.push(e / frames.length);
      }
      near.set(i, { p, c, kids, d, E, w: E.indexOf(Math.min(...E)) / SEAM_STEPS });
    }
  }
  // close to the neighbours' shares (a vertex outside the seams: 1 if it hangs on the arm below the joint)
  const nb = meshNeighbours(m);
  const share = (j, s) => {
    const o = near.get(j);
    if (o && o.c === s.c) return o.w;
    const w = rig.weights[j];
    return (s.kids.has(w[0]) ? w[1] : 0) + (w[3] > 0 && s.kids.has(w[2]) ? w[3] : 0);
  };
  for (let it = 0; it < 30; it++) for (const [i, s] of near) {
    let best = s.w, be = Infinity;
    for (let st = 0; st <= SEAM_STEPS; st++) {
      const w = st / SEAM_STEPS;
      let e = s.E[st];
      for (const j of nb[i]) e += SEAM_SMOOTH * (w - share(j, s)) ** 2;
      if (e < be) { be = e; best = w; }
    }
    s.w = best;
  }
  const list = [...near].filter(([i, s]) => { const w = rig.weights[i]; return !(w[3] === 0 && s.w === (w[0] === s.c ? 1 : 0)); });
  S = { m, v: Int32Array.from(list, ([i]) => i), p: Int32Array.from(list, ([, s]) => s.p), c: Int32Array.from(list, ([, s]) => s.c),
    w: Float32Array.from(list, ([, s]) => s.w) };
  seamCache.set(rig, S);
  return S;
}
// the rest frame with the hands closed as the pose's grip says (its keys only: none, the hands as before)
const gripsOf = (rig, m) => gripShapes(rig, m, framePos, BI, () => sampleFrames(m));
function handsOf(rig, m, pose) {
  const P = framePos(m, rig.ref);
  return pose.grip && (pose.grip.l != null || pose.grip.r != null) ? gripRest(P, gripsOf(rig, m), pose.grip) : P;
}
// the pose of a frame of the game (or of any frame of the model): every bone's rigid fit
function poseFromFrame(rig, m, f) {
  const P = framePos(m, rig.ref), Y = framePos(m, f);
  const members = BONES.map(() => []);
  rig.weights.forEach((w, i) => { if (w[1] >= 0.5) members[w[0]].push(i); });
  const world = [], J = rig.joints.map((a) => new THREE.Vector3().fromArray(a));
  for (let b = 0; b < NB; b++) world[b] = members[b].length >= 3 ? rigidFit(P, Y, members[b]) : null;
  for (let b = 0; b < NB; b++) if (!world[b]) world[b] = PARENT[b] >= 0 ? world[PARENT[b]] : IDENT;
  const pose = restPose();
  for (let b = 0; b < NB; b++) {
    const p = PARENT[b];
    pose.rot[b] = p < 0 ? world[b].q.clone() : world[p].q.clone().invert().multiply(world[b].q);
  }
  pose.root = J[0].clone().applyQuaternion(world[0].q).add(world[0].t).sub(J[0]);
  return pose;
}
// key frames <-> poses: keys [{f, rot: {bone: [x, y, z, w]}, root: [x, y, z]}]
function keyOf(f, pose) {
  const rot = {};
  BONES.forEach(([n], b) => { const q = pose.rot[b]; if (Math.abs(q.w) < 0.99999) rot[n] = q.toArray().map((x) => +x.toFixed(5)); });
  return { f, rot, root: pose.root.toArray().map((x) => +x.toFixed(2)) };
}
function poseOfKey(k) {
  const p = restPose();
  BONES.forEach(([n], b) => { if (k.rot[n]) p.rot[b].fromArray(k.rot[n]); });
  p.root.fromArray(k.root || [0, 0, 0]);
  return p;
}
const ease = (t) => t * t * (3 - 2 * t);
function legacyPoseAt(anim, f) {            // Preserve existing quaternion animation exactly.
  const keys = anim.keys;
  if (!keys.length) return restPose();
  let i = 0;
  while (i < keys.length && keys[i].f <= f) i++;
  const a = keys[Math.max(0, i - 1)], b = keys[Math.min(keys.length - 1, i)];
  let next = b, span;
  if (i >= keys.length) {                   // after the last key: back to the first (loop) or held
    if (!anim.loop || keys.length < 2) return poseOfKey(a);
    next = Object.assign({}, keys[0], { f: keys[0].f + anim.frames });
  }
  if (i === 0) return poseOfKey(b);
  span = next.f - a.f;
  if (span <= 0 || next === a) return poseOfKey(a);
  let t = (f - a.f) / span;
  if (anim.interp !== 'linear' && anim.source !== 'import') t = ease(t);
  const pa = poseOfKey(a), pb = poseOfKey(next);
  for (let k = 0; k < NB; k++) pa.rot[k].slerp(pb.rot[k], t);
  pa.root.lerp(pb.root, t);
  return pa;
}

function poseAt(anim, f) {
  const pose = legacyPoseAt(anim, f);
  for (const [name, track] of Object.entries(anim.tracks || {})) {
    const value = sampleTrack(track, f, anim, name);
    if (name === '$root') pose.root.fromArray(value);
    else if (BI[name] !== undefined) pose.rot[BI[name]].fromArray(value);
  }
  for (const [name, group] of Object.entries(anim.curves || {})) {
    const values = ['x', 'y', 'z'].map((axis) => sampleCurve(group[axis], f, anim));
    if (name === '$root') pose.root.fromArray(values);
    else if (BI[name] !== undefined) pose.rot[BI[name]].setFromEuler(new THREE.Euler(...values.map(THREE.MathUtils.degToRad), 'XYZ'));
  }
  return pose;
}

// ---------------------------------------------------------------- IK: a hand or a foot moved, the arm or the leg follows
// A chain is three bones (upper, lower, end). Its controller is the end joint (wrist, ankle) with the end bone's
// turn, and a pole the elbow or the knee points at: anim.ik[chain].keys [{f, v: [x, y, z], q: [x, y, z, w],
// pole: [x, y, z], mode}], in the character's own space (a foot keyed on the floor stays there while the hips
// move). The bones of a chain with keys are solved every frame (two bones, the law of cosines), over their own
// keys; switched back to bones (FK), the solved turns are keyed where the controller had keys.
const CHAINS = {
  l_arm: { label: 'Left hand IK', short: 'L hand', bones: ['l_upperarm', 'l_forearm', 'l_hand'], bend: -1 },
  r_arm: { label: 'Right hand IK', short: 'R hand', bones: ['r_upperarm', 'r_forearm', 'r_hand'], bend: -1 },
  l_leg: { label: 'Left foot IK', short: 'L foot', bones: ['l_thigh', 'l_calf', 'l_foot'], bend: 1 },
  r_leg: { label: 'Right foot IK', short: 'R foot', bones: ['r_thigh', 'r_calf', 'r_foot'], bend: 1 },
};
function limbIcon(chain) {
  const hand = '<path d="M5 9V4a1 1 0 0 1 2 0v4-6a1 1 0 0 1 2 0v6-5a1 1 0 0 1 2 0v5-3a1 1 0 0 1 2 0v5c0 3-2 5-5 5-2 0-3-1-4-3L2 9a1 1 0 0 1 2-1l1 1Z"/>';
  const foot = '<path d="M6 2h5v6l3 3c1 1 0 3-2 3H4c-1 0-2-1-1-3l3-3V2Z"/><path d="M6 5h5"/>';
  return `<svg viewBox="0 0 16 16" aria-hidden="true" class="st-limb-icon${chain.startsWith('r_') ? ' right' : ''}">${chain.endsWith('arm') ? hand : foot}</svg>`;
}
const chainOfBone = (name) => Object.keys(CHAINS).find((c) => CHAINS[c].bones.includes(name)) || null;
const ikOn = (anim, chain) => !!anim?.ik?.[chain]?.keys?.length;
const r2 = (x) => +x.toFixed(2), r5 = (x) => +x.toFixed(5);
// elbows bend backwards, knees forwards: the game's characters face +x (rig.front guesses it from the shoes,
// and a woman's feet hardly stick out: it said -1 for two of them)
function bendOf(rig, chain, along) {
  const n = new THREE.Vector3(CHAINS[chain].bend, 0, 0);
  n.addScaledVector(along, -n.dot(along));
  return n.lengthSq() > 1e-6 ? n.normalize() : new THREE.Vector3(0, 0, 1);
}
function sampleIK(data, f, anim) {
  const keys = Array.isArray(data) ? data : data.keys;
  const track = (field, name) => sampleTrack({ keys: keys.map((k) => ({ f: k.f, [field === 'q' ? 'q' : 'v']: k[field], mode: k.mode })) }, f, anim, name);
  const value = { v: track('v', '$root'), q: track('q', ''), pole: track('pole', '$root') };
  for (const [field, group] of Object.entries(data.curves || {})) {
    const xyz = ['x', 'y', 'z'].map(axis => sampleCurve(group[axis], f, anim));
    value[field] = field === 'q' ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...xyz.map(THREE.MathUtils.degToRad))).toArray() : xyz;
  }
  return value;
}
// the controller a pose gives a chain: where its end is, how it is turned, the side its middle joint bends to
// (a limb almost straight bends the way a body does: its own slight bend could point a knee backwards)
function ikFromPose(rig, pose, chain) {
  const [a, b, c] = CHAINS[chain].bones.map((n) => BI[n]), W = worldOf(rig, pose);
  const A = W.Jw[a], B = W.Jw[b], C = W.Jw[c], along = C.clone().sub(A).normalize();
  let n = B.clone().sub(A);
  n.addScaledVector(along, -n.dot(along));
  const straight = new THREE.Vector3().subVectors(B, A).angleTo(new THREE.Vector3().subVectors(C, B)) < THREE.MathUtils.degToRad(20);
  n = !straight && n.length() > 0.01 * rig.H ? n.normalize() : bendOf(rig, chain, along);
  const reach = A.distanceTo(B) + B.distanceTo(C);
  return { v: C.toArray().map(r2), q: W.Rw[c].toArray().map(r5), pole: B.clone().addScaledVector(n, reach * 0.6).toArray().map(r2) };
}
// a turn from the axes (aim, hinge): the bone's direction and the axis its middle joint bends about
function frameOf(aim, hinge) {
  const x = aim.clone().normalize(), y = hinge.clone().addScaledVector(x, -hinge.dot(x)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)));
}
// two bones solved for the controller: the middle joint where both lengths meet in the plane of the pole, each
// bone turned from its rest so that the hinge of the knee (or elbow) is square to that plane (no stray twist)
function solveChain(rig, pose, W, chain, t) {
  const [a, b, c] = CHAINS[chain].bones.map((n) => BI[n]), J = W.J;
  const A = W.Jw[a], l1 = J[b].distanceTo(J[a]), l2 = J[c].distanceTo(J[b]);
  const T = new THREE.Vector3().fromArray(t.v), toT = T.clone().sub(A);
  const d = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min((l1 + l2) * 0.9999, toT.length()));
  const along = toT.lengthSq() > 1e-9 ? toT.normalize() : new THREE.Vector3(0, -1, 0);
  let n = new THREE.Vector3().fromArray(t.pole).sub(A);
  n.addScaledVector(along, -n.dot(along));
  n = n.lengthSq() > 1e-9 ? n.normalize() : bendOf(rig, chain, along);
  const cosA = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const M = A.clone().addScaledVector(along, l1 * cosA).addScaledVector(n, l1 * Math.sqrt(1 - cosA * cosA));
  const E = A.clone().addScaledVector(along, d);
  // the hinge at rest: square to the limb and to the way a body bends it; now: square to the plane of the pole
  const restAlong = J[c].clone().sub(J[a]).normalize();
  const restHinge = new THREE.Vector3().crossVectors(restAlong, bendOf(rig, chain, restAlong)).normalize();
  const hinge = new THREE.Vector3().crossVectors(along, n).normalize();
  const turn = (restAim, aim) => frameOf(aim, hinge).multiply(frameOf(restAim, restHinge).invert());
  const R1 = turn(J[b].clone().sub(J[a]), M.clone().sub(A)), R2 = turn(J[c].clone().sub(J[b]), E.clone().sub(M));
  const R3 = new THREE.Quaternion().fromArray(t.q).normalize();
  const parent = PARENT[a] >= 0 ? W.Rw[PARENT[a]] : new THREE.Quaternion();
  pose.rot[a] = parent.clone().invert().multiply(R1);
  pose.rot[b] = R1.clone().invert().multiply(R2);
  pose.rot[c] = R2.clone().invert().multiply(R3);
}
function solveIK(rig, pose, anim, f) {
  const chains = Object.keys(CHAINS).filter((c) => ikOn(anim, c));
  if (!chains.length) return pose;
  const W = worldOf(rig, pose);                // the chains hang from the spine and the hips, not from each other
  for (const c of chains) solveChain(rig, pose, W, c, sampleIK(anim.ik[c], f, anim));
  return pose;
}
const fullPose = (rig, anim, f) => Object.assign(solveIK(rig, poseAt(anim, f), anim, f), { grip: { l: gripAt(anim, 'l', f), r: gripAt(anim, 'r', f) } });
function writeIKKey(anim, chain, f, t) {
  anim.ik ||= {};
  const keys = anim.ik[chain]?.keys || [], previous = keys.filter((k) => k.f <= f).at(-1);
  const mode = keys.find((k) => k.f === f)?.mode || previous?.mode || (anim.interp === 'linear' || anim.source === 'import' ? 'linear' : 'smooth');
  const key = { f, v: t.v.map(r2), q: t.q.map(r5), pole: t.pole.map(r2), mode };
  const data = anim.ik[chain] ||= {};
  data.keys = [...keys.filter((k) => k.f !== f), key].sort((x, y) => x.f - y.f);
  for (const [field, group] of Object.entries(data.curves || {})) {
    const reference = ['x', 'y', 'z'].map(axis => sampleCurve(group[axis], f, anim));
    const values = field === 'q' ? rotationValues(new THREE.Quaternion().fromArray(t.q), reference) : t[field];
    ['x', 'y', 'z'].forEach((axis, i) => { group[axis] = upsertKey(group[axis], { f, v: values[i], mode: group[axis].find(k => k.f === f)?.mode || mode }); });
  }
}
// a pose that replaced the bones' (mirror, paste, a game frame): the IK controllers follow it
function keyIKOfPose(pose, f) {
  for (const c of Object.keys(CHAINS)) if (ikOn(ST.anim, c)) writeIKKey(ST.anim, c, f, ikFromPose(ST.rig, pose, c));
}
// IK on: a controller key wherever the chain's bones have keys (their motion kept there), and on this frame;
// off: the solved bones keyed where the controller had keys
function setIK(chain, on) {
  const a = ST.anim;
  if (!a || on === ikOn(a, chain)) return;
  stopPlay(); beginEdit();
  if (on) {
    const frames = new Set([Math.max(0, Math.min(a.frames - 1, Math.round(ST.frame)))]);
    for (const n of CHAINS[chain].bones) for (const f of channelFrames(a, n)) frames.add(f);
    for (const f of [...frames].sort((x, y) => x - y)) writeIKKey(a, chain, f, ikFromPose(ST.rig, fullPose(ST.rig, a, f), chain));
  } else {
    // Curves can change between sparse controller keys: retain every baked pose on FK conversion.
    const frames = a.ik[chain].curves ? Array.from({ length: a.frames }, (_, f) => f) : channelFrames(a, 'ik:' + chain);
    for (const f of frames) writePoseKeys(a, fullPose(ST.rig, a, f), f, CHAINS[chain].bones);
    delete a.ik[chain];
    if (!Object.keys(a.ik).length) delete a.ik;
    if (ST.sel === 'ik' && ST.ikChain === chain) { ST.sel = 'bone'; ST.bone = BI[CHAINS[chain].bones[2]]; }
  }
  commitEdit();
  if (on) selectIK(chain);
  status(on ? `${CHAINS[chain].label}: move the controller (G) and the ${chain.endsWith('arm') ? 'arm' : 'leg'} follows; R turns the ${chain.endsWith('arm') ? 'hand' : 'foot'}.`
    : `${CHAINS[chain].short} turned by its bones again (FK): their keys hold the IK's poses.`);
}

// Curves are enabled per bone, never by merely opening an existing animation.
// Sample each game frame on conversion, retaining the motion that will be baked.
function rotationValues(q, previous = [0, 0, 0]) {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const direct = [e.x, e.y, e.z].map(THREE.MathUtils.radToDeg);
  // The second Euler solution avoids artificial 180-degree jumps across a gimbal boundary.
  const alternate = [direct[0] + 180, 180 - direct[1], direct[2] + 180];
  const near = (v) => v.map((x, i) => continuousAngle(x, previous[i]));
  const a = near(direct), b = near(alternate);
  const distance = (v) => v.reduce((s, x, i) => s + (x - previous[i]) ** 2, 0);
  return distance(a) <= distance(b) ? a : b;
}
function curvesFromMotion(anim, name) {
  const group = { x: [], y: [], z: [] };
  let previous = [0, 0, 0];
  for (let f = 0; f < anim.frames; f++) {
    const p = poseAt(anim, f);
    const values = name === '$root' ? p.root.toArray() : rotationValues(p.rot[BI[name]], previous);
    previous = values;
    ['x', 'y', 'z'].forEach((axis, i) => group[axis].push({ f, v: values[i], mode: 'linear' }));
  }
  // Static axes need just one key. Moving axes keep exact baked poses, including imported motion.
  for (const axis of ['x', 'y', 'z']) if (group[axis].every((k) => Math.abs(k.v - group[axis][0].v) < 1e-7)) group[axis] = [group[axis][0]];
  return group;
}

// ---------------------------------------------------------------- import (motion capture, other games)
// the names of the bones in the usual skeletons (Mixamo, CMU/BVH, Blender rigs, Unreal Mannequin...)
const MAP = [
  ['pelvis', [/^(hips?|pelvis|root_?hip)$/]],
  ['spine', [/^spine$/, /^lowerback$/, /^abdomen$/, /^spine_?0?1$/, /^torso$/]],
  ['chest', [/^spine_?0?2$/, /^(upper_?)?chest$/, /^spine1$/, /^spine_?03$/]],
  ['neck', [/^neck$/, /^neck_?0?1$/]],
  ['head', [/^head$/]],
  ['l_upperarm', [/^(left_?arm|l_?upper_?arm|upper_?arm_?l|lshldr|arm_?l|upper_?arm\.l|l_?arm)$/]],
  ['l_forearm', [/^(left_?fore_?arm|l_?fore_?arm|lower_?arm_?l|fore_?arm_?l|fore_?arm\.l|l_?lower_?arm|left_?lower_?arm)$/]],
  ['l_hand', [/^(left_?hand|l_?hand|hand_?l|hand\.l)$/]],
  ['r_upperarm', [/^(right_?arm|r_?upper_?arm|upper_?arm_?r|rshldr|arm_?r|upper_?arm\.r|r_?arm)$/]],
  ['r_forearm', [/^(right_?fore_?arm|r_?fore_?arm|lower_?arm_?r|fore_?arm_?r|fore_?arm\.r|r_?lower_?arm|right_?lower_?arm)$/]],
  ['r_hand', [/^(right_?hand|r_?hand|hand_?r|hand\.r)$/]],
  ['l_thigh', [/^(left_?up_?leg|l_?thigh|thigh_?l|left_?thigh|thigh\.l|l_?up_?leg|left_?upper_?leg)$/]],
  ['l_calf', [/^(left_?leg|l_?calf|calf_?l|l_?shin|shin_?l|shin\.l|left_?shin|left_?lower_?leg|l_?lower_?leg|left_?knee)$/]],
  ['l_foot', [/^(left_?foot|l_?foot|foot_?l|foot\.l|left_?ankle)$/]],
  ['r_thigh', [/^(right_?up_?leg|r_?thigh|thigh_?r|right_?thigh|thigh\.r|r_?up_?leg|right_?upper_?leg)$/]],
  ['r_calf', [/^(right_?leg|r_?calf|calf_?r|r_?shin|shin_?r|shin\.r|right_?shin|right_?lower_?leg|r_?lower_?leg|right_?knee)$/]],
  ['r_foot', [/^(right_?foot|r_?foot|foot_?r|foot\.r|right_?ankle)$/]],
];
const clean = (n) => String(n).toLowerCase().replace(/^.*[:|]/, '').replace(/^(mixamorig\d*|bip\d*|def[-_]?|cc_base_)/, '')
  .replace(/[\s-]+/g, '_').replace(/^_+|_+$/g, '');
function mapBones(bones) {                  // our bone -> the source's bone
  const out = {}, used = new Set();
  for (const [ours, list] of MAP) {
    for (const re of list) {
      const hit = bones.find((b) => !used.has(b) && (re.test(clean(b.name)) || re.test(clean(b.name).replace(/_/g, ''))));
      if (hit) { out[ours] = hit; used.add(hit); break; }
    }
  }
  return out;
}
async function readMotion(file) {           // {bones: [THREE.Bone], root: Object3D, clip}
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'bvh') {
    const { BVHLoader } = await import('three/addons/loaders/BVHLoader.js');
    const r = new BVHLoader().parse(await file.text());
    const root = new THREE.Group();
    root.add(r.skeleton.bones[0]);
    return { bones: r.skeleton.bones, root, clip: r.clip };
  }
  const buf = await file.arrayBuffer();
  let scene, clips;
  if (ext === 'fbx') {
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    scene = new FBXLoader().parse(buf, '');
    clips = scene.animations;
  } else if (ext === 'glb' || ext === 'gltf') {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const g = await new Promise((res, rej) => new GLTFLoader().parse(ext === 'gltf' ? new TextDecoder().decode(buf) : buf, '', res, rej));
    scene = g.scene; clips = g.animations;
  } else throw new Error('Files the Studio reads: .bvh, .fbx, .glb, .gltf');
  const bones = [];
  scene.traverse((o) => { if (o.isBone) bones.push(o); });
  if (!bones.length) scene.traverse((o) => { if (o !== scene && !o.isMesh && !o.isCamera && !o.isLight) bones.push(o); });
  if (!clips || !clips.length) throw new Error('This file has no animation in it.');
  return { bones, root: scene, clip: clips[0], clips };
}
// the source's motion on our skeleton: each bone keeps the source bone's direction and its twist
// (frames made from the bone's direction and the body's forward, at rest and at every moment)
function retarget(rig, motion, fps, opts = {}) {
  const map = mapBones(motion.bones);
  const missing = BONES.map(([n]) => n).filter((n) => !map[n]);
  if (!map.pelvis || !map.l_thigh || !map.r_thigh) throw new Error('The skeleton of this file was not recognised (no hips or legs).');
  const root = motion.root;
  root.updateMatrixWorld(true);
  const wp = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
  const src = {};                            // the source's rest
  for (const [n] of BONES) if (map[n]) src[n] = { p: wp(map[n]), q: wq(map[n]) };
  const srcDir = (n, get) => {               // direction of a source bone (to the source bone mapped to our next)
    const nx = NEXT[n];
    if (nx && map[nx]) return get(map[nx]).p.clone().sub(get(map[n]).p);
    const child = map[n].children.find((c) => c.isBone || c.type === 'Bone' || c.children);
    if (child) return get(child).p.clone().sub(get(map[n]).p);
    return null;
  };
  const restGet = (o) => ({ p: wp(o), q: wq(o) });
  // the body's frame (up, right, forward) of the source at rest and of our rig
  const body = (pL, pR, pHip, pHead) => {
    const right = pR.clone().sub(pL).normalize(), up0 = pHead.clone().sub(pHip);
    const up = up0.sub(right.clone().multiplyScalar(up0.dot(right))).normalize();
    return { up, right, fwd: new THREE.Vector3().crossVectors(up, right).normalize() };
  };
  // up: to the top of the head as our rig's (the head's tail) when the file has it (Mixamo's HeadTop_End, a BVH's
  // end site, the head_end of the Studio's export), else to the head's joint
  const srcHead = map.head || map.neck || map.chest;
  const headTop = map.head && map.head.children.find((c) => /end|top/i.test(c.name));
  const sb = body(src.l_thigh.p, src.r_thigh.p, src.pelvis.p, headTop ? wp(headTop) : srcHead ? wp(srcHead) : src.pelvis.p.clone().add(new THREE.Vector3(0, 1, 0)));
  const J = rig.joints.map((a) => new THREE.Vector3().fromArray(a)), T = rig.tails.map((a) => new THREE.Vector3().fromArray(a));
  const tb = body(J[BI.l_thigh], J[BI.r_thigh], J[BI.pelvis], T[BI.head]);
  const basis = (dir, ref) => {             // a rotation whose x axis is dir, y the part of ref across it
    const x = dir.clone().normalize();
    let y = ref.clone().sub(x.clone().multiplyScalar(ref.dot(x)));
    if (y.lengthSq() < 1e-6) y = new THREE.Vector3(0, 1, 0).sub(x.clone().multiplyScalar(x.y));
    y.normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  };
  const refFor = (n, b) => (/foot/.test(n) ? b.up : b.fwd);
  // C: the source's world into ours (its body's forward, up and right onto our body's)
  const frameOf = (b) => new THREE.Matrix4().makeBasis(b.fwd, b.up, b.right);
  const C = new THREE.Quaternion().setFromRotationMatrix(frameOf(tb).multiply(frameOf(sb).invert()));
  // at rest: our bones' frames A, the source's frames B (from the same rule)
  const A = {}, B = {};
  for (const [n] of BONES) {
    if (!map[n]) continue;
    const k = BI[n], d = T[k].clone().sub(J[k]), ds = srcDir(n, restGet);
    if (!ds || ds.lengthSq() < 1e-8) continue;
    A[n] = basis(d, refFor(n, tb));
    B[n] = { frame: basis(ds, refFor(n, sb)), q0: src[n].q.clone() };
  }
  // sample the clip
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(motion.clip);
  action.play();
  const dur = motion.clip.duration, frames = Math.max(2, Math.min(opts.maxFrames || 240, Math.round(dur * fps)));
  // the hips move from where the clip starts (BVH adds the root's channels to its offset: not the rest); the
  // Studio's own skeleton (its Export .glb, also back from Blender) from its rest, all their motion kept
  const ours = BONES.every(([n]) => map[n] && map[n].name === n);
  mixer.setTime(0);
  root.updateMatrixWorld(true);
  const hip0 = ours ? src.pelvis.p.clone() : wp(map.pelvis), whole = ours || opts.inPlace === false;
  // the size of the source against ours: hips above the feet
  const srcFoot = map.l_foot ? src.l_foot.p : src.l_thigh.p;
  const srcLeg = Math.max(1e-3, src.pelvis.p.clone().sub(srcFoot).dot(sb.up));
  const ourLeg = Math.max(1e-3, J[BI.pelvis].clone().sub(J[BI.l_foot]).dot(tb.up));
  const scale = ourLeg / srcLeg;
  const keys = [];
  for (let f = 0; f < frames; f++) {
    mixer.setTime(Math.min(dur, f / fps));
    root.updateMatrixWorld(true);
    const world = BONES.map(() => null);
    for (const [n] of BONES) {
      if (!A[n]) continue;
      const D = wq(map[n]).multiply(B[n].q0.clone().invert());       // the source bone's turn since its rest
      world[BI[n]] = C.clone().multiply(D).multiply(B[n].frame).multiply(A[n].clone().invert());
    }
    // our rest is not the source's rest: what is not mapped follows its parent
    for (let b = 0; b < NB; b++) if (!world[b]) world[b] = PARENT[b] >= 0 ? world[PARENT[b]].clone() : new THREE.Quaternion();
    // A maps our rest to the source's rest frame: world rotations relative to our rest pose
    const pose = restPose();
    for (let b = 0; b < NB; b++) pose.rot[b] = PARENT[b] < 0 ? world[b].clone() : world[PARENT[b]].clone().invert().multiply(world[b]);
    // the hips: up and down (and forward/sideways unless in place), in our size
    const d = wp(map.pelvis).sub(hip0);
    const up = d.dot(sb.up) * scale, fw = whole ? d.dot(sb.fwd) * scale : 0, rt = whole ? d.dot(sb.right) * scale : 0;
    pose.root.copy(tb.up.clone().multiplyScalar(up)).addScaledVector(tb.fwd, fw).addScaledVector(tb.right, rt);
    keys.push(keyOf(f, pose));
  }
  action.stop();
  return { keys, frames, missing };
}

// ---------------------------------------------------------------- the Studio window
const ST = {
  open: false, cls: null, models: [], mesh: null, m: null, rig: null, anim: null, playing: null, frame: 0,
  bone: 0, list: { anims: [], baked: {}, rigs: [] }, dirty: false, mats: {},
  undo: [], redo: [], pending: null, saved: null, graphTarget: 'rotation', graphRevision: 0,
  graphVisible: false, channelFilter: '', onlySelected: false, folded: new Set(), graphAxis: 'x',
};
let renderer, scene, camera, orbit, gizmo, handle, modelObj, skel, clock, navigation, raf = 0;
let curveEditor, graphCache, keyDrag, propPreview, propBox;
const tmpPos = { arr: null };

const cloneAnimation = (a) => JSON.parse(JSON.stringify(a));
function snapshot() { return { anim: cloneAnimation(ST.anim), frame: ST.frame }; }
function beginEdit() { if (ST.anim && !ST.pending) ST.pending = snapshot(); }
function commitEdit() {
  if (!ST.pending) return;
  if (JSON.stringify(ST.pending.anim) !== JSON.stringify(ST.anim)) {
    ST.undo.push(ST.pending); if (ST.undo.length > 80) ST.undo.shift();
    ST.redo = []; ST.dirty = JSON.stringify(ST.anim) !== ST.saved;
  }
  ST.pending = null; ST.graphRevision++; graphCache = null;
  refreshAnimation();
}
function restoreSnapshot(s) {
  ST.anim = cloneAnimation(s.anim); ST.dirty = JSON.stringify(ST.anim) !== ST.saved;
  ST.frame = Math.min(ST.anim.frames - 1, s.frame); ST.graphRevision++; graphCache = null;
  refreshAnimation();
}
function cancelEdit() { if (ST.pending) { const s = ST.pending; ST.pending = null; restoreSnapshot(s); } }
function historyStep(redo = false) {
  if (!ST.anim || ST.pending) return;
  stopPlay();
  const from = redo ? ST.redo : ST.undo, to = redo ? ST.undo : ST.redo;
  if (!from.length) return;
  to.push(snapshot()); restoreSnapshot(from.pop());
}
function refreshAnimation() {
  if (!ST.anim) return;
  ST.timeline = { frames: ST.anim.frames, anim: ST.anim };
  $('#as-frame').max = ST.anim.frames - 1;
  setFrame(Math.min(ST.frame, ST.anim.frames - 1)); drawKeys(); renderPanel();
  curveEditor?.refresh();
}
function graphKey() { return ST.graphTarget === 'position' ? '$root' : BONES[ST.bone][0]; }
const ikField = () => ST.ikPart === 'pole' ? 'pole' : ST.graphTarget === 'rotation' ? 'q' : 'v';
function ikCurveGroup(anim, chain, field) {
  const data = anim.ik[chain], group = { x: [], y: [], z: [] };
  let previous = [0, 0, 0];
  // Vector interpolation is identical to the key track. Rotations sample the baked frames
  // before converting quaternion interpolation to Euler curves.
  const frames = field === 'q' ? Array.from({ length: anim.frames }, (_, f) => f) : data.keys.map(k => k.f);
  for (const f of frames) {
    const t = sampleIK(data, f, anim);
    const v = field === 'q' ? rotationValues(new THREE.Quaternion().fromArray(t.q), previous) : t[field];
    previous = v;
    const mode = field === 'q' ? 'linear' : data.keys.find(k => k.f === f)?.mode || (anim.interp === 'linear' || anim.source === 'import' ? 'linear' : 'smooth');
    ['x', 'y', 'z'].forEach((axis, i) => group[axis].push({ f, v: v[i], mode }));
  }
  return group;
}
function setGraphTarget(target) {
  if (ST.sel !== 'ik') return selectChannel(target === 'position' ? '$root' : BONES[ST.bone][0]);
  if (target === 'pole') { ST.ikPart = 'pole'; ST.graphTarget = 'position'; }
  else { ST.ikPart = 'target'; ST.graphTarget = target; }
  gizmo.setMode(ST.graphTarget === 'rotation' ? 'rotate' : 'translate');
  attachGizmo(); renderPanel(); drawKeys(); curveEditor?.refresh();
}
function previewGraph(group) {
  if (ST.sel === 'ik') (ST.anim.ik[ST.ikChain].curves ||= {})[ikField()] = group;
  else (ST.anim.curves ||= {})[graphKey()] = group;
  ST.graphRevision++; setFrame(ST.frame);
}
function graphState() {
  if (ST.sel === 'ik' && ST.anim && ikOn(ST.anim, ST.ikChain)) {
    const a = ST.anim, field = ikField(), name = 'ik:' + ST.ikChain + ':' + field;
    if (!graphCache || graphCache.anim !== a || graphCache.name !== name || graphCache.rev !== ST.graphRevision)
      graphCache = { anim: a, name, rev: ST.graphRevision, group: a.ik[ST.ikChain].curves?.[field] || ikCurveGroup(a, ST.ikChain, field) };
    return { active: true, animationId: ST.animationId || 0, group: a.ik[ST.ikChain].curves?.[field] || null,
      displayGroup: graphCache.group, groupKey: name, label: CHAINS[ST.ikChain].label,
      unit: field === 'q' ? 'degrees' : 'units', frame: ST.frame, frames: a.frames, ik: true,
      loop: a.loop !== false, target: field === 'pole' ? 'pole' : ST.graphTarget, canUndo: !!ST.undo.length, canRedo: !!ST.redo.length };
  }
  const name = graphKey(), a = ST.anim;
  if (!a) graphCache = null;
  if (a && (!graphCache || graphCache.anim !== a || graphCache.name !== name || graphCache.rev !== ST.graphRevision)) {
    graphCache = { anim: a, name, rev: ST.graphRevision, group: a.curves?.[name] || curvesFromMotion(a, name) };
  }
  return { active: !!a, animationId: ST.animationId || 0, group: a?.curves?.[name] || null, displayGroup: graphCache?.group,
    groupKey: name, label: name === '$root' ? 'Body position' : BONES[ST.bone][2],
    unit: name === '$root' ? 'units' : 'degrees', frame: ST.frame, frames: a?.frames || 1,
    loop: a?.loop !== false, target: ST.graphTarget, canUndo: !!ST.undo.length, canRedo: !!ST.redo.length };
}
function enableCurves() {
  if (ST.sel === 'ik') {
    const data = ST.anim?.ik?.[ST.ikChain];
    if (!data || data.curves?.[ikField()]) return;
    stopPlay(); beginEdit();
    (data.curves ||= {})[ikField()] = ikCurveGroup(ST.anim, ST.ikChain, ikField());
    commitEdit(); return;
  }
  if (!ST.anim || ST.anim.curves?.[graphKey()]) return;
  stopPlay(); beginEdit();
  const group = curvesFromMotion(ST.anim, graphKey());
  (ST.anim.curves ||= {})[graphKey()] = group;
  commitEdit();
  status('Curves ready. Existing frame poses are preserved; select keys to shape the movement.');
}
function updatePoseCurves(anim, pose, f, scope) {
  for (const [name, group] of Object.entries(anim.curves || {})) {
    if (scope && !scope.includes(name)) continue;
    const reference = ['x', 'y', 'z'].map((axis) => sampleCurve(group[axis], f, anim));
    const values = name === '$root' ? pose.root.toArray() : rotationValues(pose.rot[BI[name]], reference);
    ['x', 'y', 'z'].forEach((axis, i) => {
      const old = group[axis].find((k) => k.f === f);
      const previous = group[axis].filter((k) => k.f <= f).at(-1);
      group[axis] = upsertKey(group[axis], { f, v: values[i], mode: old?.mode || previous?.mode || 'smooth' });
    });
  }
}

const CHANNELS = ['$root', ...BONES.map(([name]) => name)];
function channelFrames(anim, name) {
  if (gripSide(name)) return gripKeys(anim, gripSide(name)).map((k) => k.f);
  if (name.startsWith('ik:')) {
    const data = anim.ik?.[name.slice(3)];
    return [...new Set([...(data?.keys || []), ...Object.values(data?.curves || {}).flatMap(g => Object.values(g).flat())].map(k => k.f))].sort((a, b) => a - b);
  }
  const group = anim.curves?.[name];
  const frames = group ? Object.values(group).flat().map((k) => k.f)
    : (anim.tracks?.[name]?.keys ?? anim.keys).map((k) => k.f);
  return [...new Set(frames)].sort((a, b) => a - b);
}
// Shared by the viewport, Keys and tests: each edit has an explicit channel scope.
function writePoseKeys(anim, pose, f, scope) {
  migrateTracks(anim, BONES.map(([name]) => name));
  const key = keyOf(f, pose);
  for (const name of scope) {
    if (anim.curves?.[name]) continue;
    const previous = anim.tracks[name].keys.filter((k) => k.f <= f).at(-1);
    upsertTrackKey(anim, name, { f, ...(name === '$root' ? { v: key.root } : { q: key.rot[name] || [0, 0, 0, 1] }), mode: previous?.mode });
  }
  updatePoseCurves(anim, pose, f, scope);
}
function canDeleteChannelKey(anim, name, f) {
  if (gripSide(name)) return gripKeys(anim, gripSide(name)).some((k) => k.f === f);
  if (name.startsWith('ik:')) { const data = anim.ik?.[name.slice(3)]; return [data?.keys || [], ...Object.values(data?.curves || {}).flatMap(g => Object.values(g))].some(keys => keys.length > 1 && keys.some(k => k.f === f)); }
  const group = anim.curves?.[name];
  return group ? Object.values(group).some((keys) => keys.length > 1 && keys.some((k) => k.f === f))
    : channelFrames(anim, name).length > 1 && channelFrames(anim, name).includes(f);
}
function removeChannelKey(anim, name, f) {
  if (!canDeleteChannelKey(anim, name, f)) return false;
  if (gripSide(name)) return removeGripKey(anim, gripSide(name), f);
  if (name.startsWith('ik:')) {
    const c = anim.ik[name.slice(3)];
    if (c.keys.length > 1) c.keys = c.keys.filter(k => k.f !== f);
    for (const g of Object.values(c.curves || {})) for (const axis of ['x', 'y', 'z']) if (g[axis].length > 1) g[axis] = g[axis].filter(k => k.f !== f);
    return true;
  }
  if (anim.curves?.[name]) {
    const group = anim.curves[name];
    for (const axis of ['x', 'y', 'z']) if (group[axis].length > 1) group[axis] = group[axis].filter((k) => k.f !== f);
  } else {
    migrateTracks(anim, BONES.map(([n]) => n));
    deleteTrackKey(anim, name, f);
  }
  return true;
}
function moveChannelKeys(anim, name, from, to) {
  if (from === to || !channelFrames(anim, name).includes(from)) return false;
  if (!Number.isInteger(to) || to < 0 || to >= anim.frames) throw new Error('Choose a frame inside the animation.');
  if (gripSide(name)) return moveGripKey(anim, gripSide(name), from, to);
  if (name.startsWith('ik:')) {
    const c = anim.ik[name.slice(3)];
    if (channelFrames(anim, name).includes(to)) throw new Error(`A key already occupies frame ${to + 1}.`);
    c.keys = c.keys.map((k) => (k.f === from ? { ...k, f: to } : k)).sort((x, y) => x.f - y.f);
    for (const g of Object.values(c.curves || {})) for (const axis of ['x', 'y', 'z']) g[axis] = g[axis].map(k => k.f === from ? { ...k, f: to } : k).sort((a, b) => a.f - b.f);
    return true;
  }
  const group = anim.curves?.[name];
  if (group) {
    // Validate every axis before changing any of them.
    for (const keys of Object.values(group)) if (keys.some((k) => k.f === from) && keys.some((k) => k.f === to)) throw new Error(`A key already occupies frame ${to + 1}.`);
    for (const axis of ['x', 'y', 'z']) group[axis] = group[axis].map((k) => k.f === from ? { ...k, f: to } : k).sort((a, b) => a.f - b.f);
  } else {
    if (channelFrames(anim, name).includes(to)) throw new Error(`A key already occupies frame ${to + 1}.`);
    migrateTracks(anim, BONES.map(([n]) => n));
    moveTrackKey(anim, name, from, to);
  }
  return true;
}
function resizeAnimation(anim, frames) {
  anim.frames = frames;
  const trim = (keys) => {
    const kept = keys.filter((k) => k.f < frames);
    return kept.length || !keys.length ? kept : [{ ...keys[0], f: 0 }];
  };
  anim.keys = trim(anim.keys);
  for (const track of Object.values(anim.tracks || {})) track.keys = trim(track.keys);
  for (const group of Object.values(anim.curves || {})) for (const axis of ['x', 'y', 'z']) group[axis] = trim(group[axis]);
  for (const data of Object.values(anim.ik || {})) {
    data.keys = trim(data.keys);
    for (const group of Object.values(data.curves || {})) for (const axis of ['x', 'y', 'z']) group[axis] = trim(group[axis]);
  }
  trimGrip(anim, frames);
}

function ensureDom() {
  if ($('#studio')) return;
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = new URL('./studio-channels.css', import.meta.url).href;
  document.head.appendChild(css);
  const el = document.createElement('div');
  el.id = 'studio';
  el.innerHTML = `
  <div class="st-top"><b>Animation Studio</b>
    <label>Character <select id="as-cls"></select></label>
    <label>Model <select id="as-model"></select></label>
    <span id="as-status" class="hint"></span><span style="flex:1"></span>
    <button id="as-help" title="How the Studio works">Help</button>
    <button id="as-close">Close</button></div>
  <div class="st-left">
    <div class="st-h">My animations</div><div id="as-mine"></div>
    <div class="st-row"><button id="as-new" title="A new animation, made by posing the skeleton">+ New</button>
      <button id="as-import" title="An animation from a file: BVH (motion capture), FBX (Mixamo...), glTF">Import file</button>
      <input type="file" id="as-file" accept=".bvh,.fbx,.glb,.gltf" style="display:none"></div>
    <div class="st-row"><button id="as-export" title="The character with its skeleton, and the animation open, as a .glb for Blender (or any program that reads glTF). Import file brings the animation back.">Export .glb</button></div>
    <div class="st-h" title="Click one to play it; Copy (on the row under the pointer) to make your own version to edit">Game animations</div><div id="as-game"></div>
  </div>
  <canvas id="as-view"></canvas>
  <div class="st-time">
    <!-- a transport bar like a video editor's: the timeline itself is the ruler over the keys below -->
    <div class="st-transport" role="group" aria-label="Playback">
      <button id="as-first" title="First frame (Home, Shift+Left)" aria-label="First frame"><svg viewBox="0 0 16 16"><path d="M3 3h2v10H3zM13 3v10L6 8z"/></svg></button>
      <button id="as-prevkey" title="Previous key (Down arrow)" aria-label="Previous key"><svg viewBox="0 0 16 16"><path d="M12 3v10L5 8z"/><path d="M3.5 5.5 6 8l-2.5 2.5L1 8z"/></svg></button>
      <button id="as-play" title="Play / pause (Space)">▶</button>
      <button id="as-nextkey" title="Next key (Up arrow)" aria-label="Next key"><svg viewBox="0 0 16 16"><path d="M4 3v10l7-5z"/><path d="M12.5 5.5 15 8l-2.5 2.5L10 8z"/></svg></button>
      <button id="as-last" title="Last frame (End, Shift+Right)" aria-label="Last frame"><svg viewBox="0 0 16 16"><path d="M11 3h2v10h-2zM3 3v10l7-5z"/></svg></button>
    </div>
    <span id="as-fno" class="st-timecode" title="Frame / frames">0 / 30</span>
    <input type="range" id="as-frame" min="0" max="29" value="0" step="0.01" hidden>
    <span class="st-time-gap"></span>
    <button id="as-keybone" class="st-keybtn" title="Key the selected bone, IK controller or body position (I, K)">Key bone</button>
    <button id="as-keypose" class="st-keybtn" title="Key every bone and body position (Shift+I, Shift+K)">Key pose</button>
    <button id="as-tween" title="Create a pose between the previous and next keys">Inbetween…</button>
    <button id="as-graph-toggle" aria-pressed="false" title="Show or hide the Graph editor">Graph</button>
  </div>
  <div id="as-editors">
    <section id="as-channels" aria-label="Animation channels">
      <div class="st-tl-head">
        <div class="st-channel-tools"><input id="as-channel-search" type="search" placeholder="Find bone" aria-label="Find bone">
          <label title="Show only the selected bone"><input id="as-channel-selected" type="checkbox">Selected</label></div>
        <div class="st-ruler" id="as-ruler" title="Click or drag to move the playhead"></div>
      </div>
      <div id="as-keys" tabindex="0" aria-label="Bone keyframes"></div>
    </section>
    <div id="as-graph" hidden></div>
  </div>
  <div class="st-right" id="as-panel"></div>`;
  document.body.appendChild(el);
  attachToolWindow(el, $('.st-top'), $('#as-close'));
  curveEditor = createCurveEditor($('#as-graph'), {
    getState: graphState,
    onTarget: setGraphTarget,
    onAxis: (axis) => { ST.graphAxis = axis; drawKeys(); },
    onEnable: enableCurves,
    onSeek: (f) => { stopPlay(); setFrame(Math.max(0, Math.min((ST.timeline?.frames || 1) - 1, f))); },
    onBegin: () => { stopPlay(); beginEdit(); },
    onPreview: previewGraph,
    onCommit: commitEdit, onCancel: cancelEdit,
    onUndo: () => historyStep(), onRedo: () => historyStep(true),
    onMaximize: () => toggleGraphMax(),
  });
  renderer = new THREE.WebGLRenderer({ canvas: $('#as-view'), antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151922);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404452, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(2, 3, 1.5);
  scene.add(sun);
  const grid = new THREE.GridHelper(400, 25, 0x3a4252, 0x252b36);
  scene.add(grid);
  ST.grid = grid;
  camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
  orbit = new OrbitControls(camera, $('#as-view'));
  orbit.enableDamping = true;
  gizmo = new TransformControls(camera, $('#as-view'));
  gizmo.setMode('rotate');
  gizmo.setSpace('local');
  gizmo.setSize(0.75);
  navigation = createStudioNavigation($('#as-view'), orbit, () => camera, c => { camera = c; gizmo.camera = c; },
    () => ST.rig?.H || 80, frameAll, frameSelected);
  handle = new THREE.Object3D();
  propBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffd25a);
  propBox.visible = false;
  scene.add(handle, gizmo, propBox);
  gizmo.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
    if (ST.sel === 'prop' || ST.sel === 'ik') { if (e.value) { stopPlay(); beginEdit(); } else commitEdit(); return; }   // one undo step a drag
    if (!e.value) afterEdit([gizmo.mode === 'translate' ? '$root' : BONES[ST.bone][0]]);
  });
  gizmo.addEventListener('objectChange', onGizmo);
  clock = new THREE.Clock();
  $('#as-close').onclick = close;
  $('#as-help').onclick = () => help();
  $('#as-cls').onchange = () => openClass($('#as-cls').value);
  $('#as-model').onchange = () => openModel($('#as-model').value);
  $('#as-new').onclick = () => newAnim();
  $('#as-import').onclick = () => $('#as-file').click();
  $('#as-export').onclick = () => exportGLB();
  $('#as-file').onchange = () => { const f = $('#as-file').files[0]; $('#as-file').value = ''; if (f) importFile(f); };
  $('#as-play').onclick = () => togglePlay();
  $('#as-frame').oninput = () => { stopPlay(); setFrame(+$('#as-frame').value); };
  $('#as-first').onclick = () => gotoFrame(0);
  $('#as-last').onclick = () => gotoFrame(Infinity);
  $('#as-prevkey').onclick = () => gotoKey(-1);
  $('#as-nextkey').onclick = () => gotoKey(1);
  $('#as-ruler').onpointerdown = (e) => scrub(e);
  new ResizeObserver(() => drawRuler()).observe($('#as-ruler'));
  $('#as-keybone').onclick = () => afterEdit();
  $('#as-keypose').onclick = () => afterEdit(CHANNELS);
  $('#as-tween').onclick = openInbetweener;
  $('#as-graph-toggle').onclick = () => setGraphVisible(!ST.graphVisible);
  $('#as-channel-search').oninput = (e) => { ST.channelFilter = e.target.value; drawKeys(); };
  $('#as-channel-selected').onchange = (e) => { ST.onlySelected = e.target.checked; drawKeys(); };
  try { ST.graphVisible = localStorage.getItem('deusedix.studio.graph') === 'true'; } catch {}
  setGraphVisible(ST.graphVisible);
  $('#as-view').addEventListener('pointerdown', pickBone);
  // hold a number's label (X, Y, Z, Scale, Frames...) and drag: the value follows, faster with a faster mouse
  attachNumberScrub($('#as-panel'), { onStart: () => { stopPlay(); beginEdit(); }, onCancel: () => cancelEdit() });
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('deusedix:shortcuts', updateKeyHints);
  updateKeyHints();
}
function updateKeyHints() {
  for (const [id, action, label, fallback] of [['as-prevkey', 'studioprevkey', 'Previous key', 'Down'], ['as-nextkey', 'studionextkey', 'Next key', 'Up']])
    if ($('#' + id)) $('#' + id).title = label + ' (' + (window.__menubar?.keyOf(action) || fallback) + ')';
}
function status(t, cls = '') { const s = $('#as-status'); if (s) { s.textContent = t; s.className = 'hint ' + cls; } }
function resize() {
  if (!ST.open) return;
  const c = $('#as-view'), w = c.clientWidth, h = c.clientHeight;
  if (w && h) {                              // (none while the Graph editor fills the Studio)
    renderer.setSize(w, h, false);
    navigation.resize();
  }
  curveEditor?.refresh();
}
function loop() {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (ST.playing) {
    const p = ST.playing;
    p.t += dt;
    const len = p.frames;
    let f = p.t * p.rate;
    f = p.loop ? f % len : Math.min(f, len - 1);
    setFrame(f, true);
    if (!p.loop && f >= len - 1) stopPlay();
  }
  navigation.update(dt);
  if (!navigation.flying) orbit.update();
  renderer.render(scene, camera);
}

// the characters the Studio offers: those of the open map first, then every character of the game
function classList() {
  const E = window.__editor, seen = new Set();
  const inMap = [];
  const pal = (E && E.palette || []).find((c) => c.category === 'Characters');
  const all = pal ? pal.items.map((i) => [i.cls, i.name]) : [];
  const known = new Set(all.map(([c]) => c));
  for (const a of (E && E.baseActors || []).concat(E && E.added || [])) {
    if ((known.has(a.cls) || /^UCCustom/.test(a.cls)) && !seen.has(a.cls)) { seen.add(a.cls); inMap.push(a.cls); }
  }
  return { inMap, all: all.filter(([c]) => !seen.has(c)), names: Object.fromEntries(all) };
}
async function open(cls) {
  ensureDom();
  ST.open = true;
  $('#studio').style.display = 'grid';
  window.dispatchEvent(new Event('deusedix:studio-state'));
  resize();
  if (!raf) loop();
  const { inMap, all, names } = classList();
  const label = (c) => names[c] && names[c] !== c ? `${names[c]} · ${c}` : c.replace(/^UCCustom_?/, '');
  $('#as-cls').innerHTML = (inMap.length ? `<optgroup label="In this map">${inMap.map((c) => `<option value="${c}">${esc(label(c))}</option>`).join('')}</optgroup>` : '')
    + `<optgroup label="Every character">${all.map(([c]) => `<option value="${c}">${esc(label(c))}</option>`).join('')}</optgroup>`;
  const want = cls || ST.cls || inMap[0] || 'UNATCOTroop';
  if (![...$('#as-cls').options].some((o) => o.value === want)) $('#as-cls').add(new Option(label(want), want));
  $('#as-cls').value = want;
  await refreshList();
  await openClass(want);
}
function close(force = false) {
  keyDrag?.cancel();
  if (force !== true && ST.dirty && !confirm('The animation has unsaved changes. Close anyway?')) return;
  if (force === true) { ST.dirty = false; ST.animationId++; }
  stopPlay();
  navigation?.stop(false);
  ST.open = false;
  if ($('#studio')) $('#studio').style.display = 'none';
  window.dispatchEvent(new Event('deusedix:studio-state'));
  cancelAnimationFrame(raf); raf = 0;
}
async function refreshList() { ST.list = await api('/api/studio'); }
async function openClass(cls) {
  propPreview?.clear();
  ST.cls = cls;
  status('reading the models of ' + cls + '...');
  const { models } = await api('/api/studio_models?cls=' + encodeURIComponent(cls));
  ST.models = models;
  if (!models.length) { status('This character has no model the Studio can animate.', 'bad'); return; }
  $('#as-model').innerHTML = models.map((m, i) => `<option value="${m}">${esc(m.split('.').pop())}${models.length > 1 ? (i ? ' (HDTP: as the game shows it)' : ' (original)') : ''}</option>`).join('');
  const pick = models[models.length - 1];       // HDTP's when it has one: what the game shows
  $('#as-model').value = pick;
  ST.palette = await fetch(`/cache/_palette/models/${encodeURIComponent(cls)}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  ST.paletteTex = await fetch('/cache/_palette/index.json').then((r) => (r.ok ? r.json() : {})).then((j) => j._textures || {}).catch(() => ({}));
  await openModel(pick);
}
async function openModel(mesh) {
  stopPlay();
  ST.mesh = mesh;
  status('loading ' + mesh.split('.').pop() + '...');
  ST.m = await loadModel(mesh);
  ST.rigCurrent = ST.rig = await rigFor(mesh, ST.m);
  ST.rig = await rigOfAnim(ST.anim, mesh, ST.rigCurrent);
  buildModel();
  frameCamera();
  renderLists();
  if (ST.anim) showAnim(false); else { setPose(restPose()); renderPanel(); curveEditor?.refresh(); }
  status(`${mesh.split('.').pop()}: ${ST.m.FV} vertices, ${ST.m.seqs.length} animations · skeleton fit ${ST.rig.error} units`);
}
// 2: the toes found towards the front, the head's tip straight up; 3: hands of their own (the wrist where the
// skin begins); 4: a hand found by its shape leaves out the coat beside it. A rig made again is saved; the one
// before it stays for the animations made with it.
const RIG_VERSION = 4;
const RIG_SAME_FROM = 3;          // the animations made on a rig from this version on are shown on the current one
async function rigFor(mesh, m) {
  const r = (await api('/api/studio_rig?mesh=' + encodeURIComponent(mesh))).rig;
  if (r && r.version === RIG_VERSION) return r;
  if (r && (r.version || 0) < RIG_SAME_FROM) {  // kept for the animations made with it, before it is replaced
    try { await api('/api/studio_rig_legacy', r); }
    catch (e) { status('Restart DeusEdix to give the skeleton its hands (its server is older than this page).', 'warn'); return r; }
  }
  const rig = autoRig(m, mesh, (t) => t && status(t));
  await api('/api/studio_rig', rig);
  return rig;
}
// an animation made before the hands (no rig version): the skeleton it was made with, so that it stays the same
const legacyRigs = new Map();
async function rigOfAnim(anim, mesh, current) {
  if (!anim || (anim.rig || 0) >= RIG_SAME_FROM) return current;
  if (!legacyRigs.has(mesh)) legacyRigs.set(mesh, await api('/api/studio_rig_legacy?mesh=' + encodeURIComponent(mesh)).then((j) => j.rig || null).catch(() => null));
  return legacyRigs.get(mesh) || current;
}
async function useRigOf(anim) {               // ST.rig: the skeleton the animation shown is posed on
  const rig = await rigOfAnim(anim, ST.mesh, ST.rigCurrent);
  if (rig !== ST.rig) { ST.rig = rig; if (skel) buildModel(); }
}

// ---------------------------------------------------------------- the model and its skeleton on screen
function skinMaterial(slot, flags) {
  const own = ST.m.info.skins && ST.m.info.skins[String(slot)];
  let url = null;
  const hdtp = /^HDTP/.test(ST.mesh.split('.').pop());
  const part = ST.palette && ST.palette.parts && ST.palette.parts.find((p) => p.slot === slot);
  if (!hdtp && part && ST.paletteTex[part.tex] && ST.paletteTex[part.tex].png) url = '/cache/_palette/' + ST.paletteTex[part.tex].png;
  if (!url && own) url = own;
  const key = url + '|' + flags;
  if (ST.mats[key]) return ST.mats[key];
  const opts = { color: 0xffffff, side: flags & 256 ? THREE.DoubleSide : THREE.FrontSide };
  // flipY false: the game's texture coordinates start at the top of the picture (as in the map view and the
  // Character Creator); flipped, the guard's shirt and tie were drawn at his waist and his face was dark
  if (url) { const t = new THREE.TextureLoader().load(url); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.flipY = false; opts.map = t; }
  else opts.color = 0x9aa3b5;
  if (flags & 2) opts.alphaTest = 0.5;
  if (flags & 4) { opts.transparent = true; opts.blending = THREE.AdditiveBlending; opts.depthWrite = false; }
  return (ST.mats[key] = new THREE.MeshLambertMaterial(opts));
}
function facesBySlot(m) {                   // 'slot|flags' -> the faces drawn with that material
  const bySlot = {};
  // the parts the character shows in the game (the palette leaves out the slots its MultiSkins hide with a
  // mask texture: the hat of the agents' body, drawn grey on the head, made it look bent backwards)
  const hdtp = /^HDTP/.test(ST.mesh.split('.').pop());
  const shown = !hdtp && ST.palette && ST.palette.parts && ST.palette.parts.length ? new Set(ST.palette.parts.map((p) => p.slot)) : null;
  for (let k = 0; k < m.info.counts.faces; k++) {
    const mat = m.info.mats[m.faces[4 * k + 3]] || [0, 0];
    if (mat[1] & 1) continue;
    if (shown && !shown.has(mat[0])) continue;
    const key = mat[0] + '|' + (mat[1] & (2 | 4 | 256));
    (bySlot[key] || (bySlot[key] = [])).push(k);
  }
  return bySlot;
}
function buildModel() {
  if (modelObj) { scene.remove(modelObj); modelObj.traverse((o) => o.geometry && o.geometry.dispose()); }
  const m = ST.m, bySlot = facesBySlot(m);
  modelObj = new THREE.Group();
  modelObj.userData.parts = [];
  for (const [key, list] of Object.entries(bySlot)) {
    const [slot, flags] = key.split('|').map(Number);
    const idx = new Uint32Array(list.length * 3), uv = new Float32Array(list.length * 6);
    // corners 0, 2, 1: the game's winding in our axes (see Space at the top)
    list.forEach((k, i) => { [0, 2, 1].forEach((c, j) => { const w = m.faces[4 * k + c]; idx[3 * i + j] = m.wedges[w] + m.SV; uv[6 * i + 2 * j] = m.uvs[2 * w]; uv[6 * i + 2 * j + 1] = m.uvs[2 * w + 1]; }); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(list.length * 9), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(geo, skinMaterial(slot, flags));
    modelObj.add(mesh);
    modelObj.userData.parts.push({ geo, idx });
  }
  scene.add(modelObj);
  tmpPos.arr = new Float32Array(m.FV * 3);
  // the skeleton: a ball at each joint, a line along each bone
  if (skel) scene.remove(skel);
  skel = new THREE.Group();
  const r = Math.max(1.2, ST.rig.H * 0.018);
  skel.userData.balls = BONES.map((b, k) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color: 0x5aa2ff, depthTest: false, transparent: true, opacity: 0.85 }));
    s.renderOrder = 20; s.userData.bone = k; skel.add(s); return s;
  });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NB * 6), 3));
  skel.userData.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffd25a, depthTest: false, transparent: true, opacity: 0.8 }));
  skel.userData.lines.renderOrder = 19;
  skel.add(skel.userData.lines);
  scene.add(skel);
  buildIK();
}
// the IK controllers: a box at each hand and foot with IK, a diamond its elbow or knee points at
let ikGroup = null;
function buildIK() {
  if (ikGroup) scene.remove(ikGroup);
  ikGroup = new THREE.Group();
  const s = ST.rig.H * 0.05, color = 0xffb347;
  for (const c of Object.keys(CHAINS)) {
    const mat = () => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), Object.assign(mat(), { wireframe: true }));
    const pole = new THREE.Mesh(new THREE.OctahedronGeometry(s * 0.32), mat());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]),
      new THREE.LineDashedMaterial({ color, dashSize: s * 0.25, gapSize: s * 0.2, depthTest: false, transparent: true }));
    box.userData = { chain: c, part: 'target' }; pole.userData = { chain: c, part: 'pole' };
    for (const o of [box, pole, line]) { o.renderOrder = 22; ikGroup.add(o); }
    ikGroup.userData[c] = { box, pole, line };
  }
  scene.add(ikGroup);
}
function showIK() {
  if (!ikGroup) return;
  const a = ST.anim;
  ikGroup.visible = !!a && !!ST.pose && !!skel?.visible;
  if (!ikGroup.visible) return;
  const W = worldOf(ST.rig, ST.pose);
  for (const c of Object.keys(CHAINS)) {
    const { box, pole, line } = ikGroup.userData[c], on = ikOn(a, c);
    box.visible = pole.visible = line.visible = on;
    if (!on) continue;
    const t = sampleIK(a.ik[c], ST.frame, a), picked = ST.sel === 'ik' && ST.ikChain === c;
    box.position.fromArray(t.v); box.quaternion.fromArray(t.q).normalize();
    pole.position.fromArray(t.pole);
    box.material.color.set(picked && ST.ikPart !== 'pole' ? 0xff6b6b : 0xffb347);
    pole.material.color.set(picked && ST.ikPart === 'pole' ? 0xff6b6b : 0xffb347);
    line.geometry.setFromPoints([W.Jw[BI[CHAINS[c].bones[1]]], pole.position.clone()]);
    line.computeLineDistances();
  }
}
function showPositions(P) {
  for (const { geo, idx } of modelObj.userData.parts) {
    const a = geo.attributes.position.array;
    for (let i = 0; i < idx.length; i++) { const v = idx[i] * 3; a[3 * i] = P[v]; a[3 * i + 1] = P[v + 1]; a[3 * i + 2] = P[v + 2]; }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }
}
function setPose(pose) {
  ST.pose = pose;
  showPositions(skin(ST.rig, ST.m, pose, tmpPos.arr));
  const { Rw, Jw } = worldOf(ST.rig, pose);
  propPreview ||= createPropPreview(scene, () => ST.paletteTex || {}, message => status(message, 'bad'));
  propPreview.sync(ST.anim?.props, { Rw, Jw }, BI, !!ST.anim);
  const T = ST.rig.tails.map((a) => new THREE.Vector3().fromArray(a)), J = ST.rig.joints.map((a) => new THREE.Vector3().fromArray(a));
  const la = skel.userData.lines.geometry.attributes.position.array;
  for (let b = 0; b < NB; b++) {
    skel.userData.balls[b].position.copy(Jw[b]);
    skel.userData.balls[b].material.color.set(b === ST.bone ? 0xff6b6b : 0x5aa2ff);
    const tail = T[b].clone().sub(J[b]).applyQuaternion(Rw[b]).add(Jw[b]);
    Jw[b].toArray(la, 6 * b); tail.toArray(la, 6 * b + 3);
  }
  skel.userData.lines.geometry.attributes.position.needsUpdate = true;
  if (ST.anim && !ST.playing && ST.sel !== 'prop' && ST.sel !== 'ik') { handle.position.copy(Jw[ST.bone]); handle.quaternion.copy(Rw[ST.bone]); }
  showIK();
}
function frameCamera() {
  const H = ST.rig.H, J = new THREE.Vector3().fromArray(ST.rig.joints[0]);
  ST.grid.position.y = J.y - 0.52 * H;
  orbit.target.copy(J);
  camera.position.copy(J).add(new THREE.Vector3(H * 1.35, H * 0.25, H * 0.9));    // in front of them, on their right
  camera.near = H * 0.02; camera.far = H * 60; camera.updateProjectionMatrix();
}
function showGameFrame(f) { stopGizmo(); propPreview?.hide(); showPositions(framePos(ST.m, f)); }

// ---------------------------------------------------------------- lists
function renderLists() {
  const mine = ST.list.anims || [], baked = ST.list.baked[ST.mesh] || [];
  $('#as-mine').innerHTML = mine.length ? mine.map((a) => `<div class="st-item ${ST.anim && ST.anim.name === a.name ? 'on' : ''}" data-mine="${esc(a.name)}">
      <span>${esc(a.name)}</span><small title="${a.frames || '?'} frames at ${a.fps || '?'} fps">${a.frames && a.fps ? (a.frames / a.fps).toFixed(1) + ' s' : ''}${baked.includes(a.name) ? ' · in game' : ''}</small>
      <button class="st-hover" data-del="${esc(a.name)}" title="Delete this animation">✕</button></div>`).join('')
    : '<div class="hint">None yet: + New, or Import a file (Mixamo, motion capture...).</div>';
  const seqs = ST.m.seqs.filter((s) => !s.custom && !/^(All|Mouth\w*|Blink)$/.test(s.name));
  $('#as-game').innerHTML = seqs.map((s) => `<div class="st-item" data-seq="${esc(s.name)}"><span>${esc(s.name)}</span><small title="${s.frames} frames">${(s.frames / s.rate).toFixed(1)} s</small>
      <button class="st-hover" data-copy="${esc(s.name)}" title="A new animation of yours starting from this one (to change it)">Copy</button></div>`).join('');
  for (const d of document.querySelectorAll('[data-mine]')) d.onclick = (e) => { if (!e.target.dataset.del) editAnim(d.dataset.mine); };
  for (const d of document.querySelectorAll('[data-del]')) d.onclick = async () => {
    if (!confirm(`Delete the animation "${d.dataset.del}"? Characters using it go back to breathing.`)) return;
    ST.list = (await api('/api/studio_delete', { name: d.dataset.del })).list;
    if (ST.anim && ST.anim.name === d.dataset.del) { stopPlay(); stopGizmo(); ST.anim = null; ST.dirty = false; ST.undo = []; ST.redo = []; ST.pending = null; ST.timeline = null; graphCache = null; renderPanel(); drawKeys(); curveEditor?.refresh(); }
    await api('/api/studio_pack', {});
    renderLists();
  };
  for (const d of document.querySelectorAll('[data-seq]')) d.onclick = (e) => { if (!e.target.dataset.copy) playSeq(d.dataset.seq); };
  for (const d of document.querySelectorAll('[data-copy]')) d.onclick = () => copySeq(d.dataset.copy);
}
function playSeq(name) {
  const s = ST.m.seqs.find((x) => x.name === name);
  if (!s) return;
  if (ST.anim && ST.dirty && !confirm('Leave the animation you are editing (unsaved changes)?')) return;
  ST.anim = null; ST.dirty = false;
  ST.undo = []; ST.redo = []; graphCache = null;
  stopGizmo();
  skel.visible = false;                     // the game's frames have no skeleton
  ST.playing = { seq: s, frames: s.frames, rate: s.rate, loop: true, t: 0 };
  ST.timeline = { frames: s.frames, game: s };
  $('#as-frame').max = Math.max(0, s.frames - 1e-3);
  $('#as-play').textContent = '❚❚';
  drawKeys();
  renderPanel();
  curveEditor?.refresh();
  for (const d of document.querySelectorAll('.st-item')) d.classList.toggle('on', d.dataset.seq === name);
}

// ---------------------------------------------------------------- editing an animation
function newAnim(base) {
  if (ST.anim && ST.dirty && !confirm('Leave the animation you are editing (unsaved changes)?')) return;
  const used = new Set((ST.list.anims || []).map((a) => a.name.toLowerCase()));
  let i = 1, name;
  do name = (base || 'MyAnim') + (i > 1 || base ? i : ''); while (used.has(name.toLowerCase()) && ++i);
  ST.anim = { name, fps: 15, frames: 30, loop: true, interp: 'smooth', source: 'made', made_on: ST.mesh, rig: RIG_VERSION, keys: [keyOf(0, restPose())] };
  ST.dirty = true;
  if (ST.rig !== ST.rigCurrent) { ST.rig = ST.rigCurrent; buildModel(); }
  showAnim();
}
function copySeq(seqName) {
  const s = ST.m.seqs.find((x) => x.name === seqName);
  if (!s) return;
  if (ST.anim && ST.dirty && !confirm('Leave the animation you are editing (unsaved changes)?')) return;
  const used = new Set((ST.list.anims || []).map((a) => a.name.toLowerCase()));
  let name = 'My' + s.name, i = 2;
  while (used.has(name.toLowerCase())) name = 'My' + s.name + i++;
  if (ST.rig !== ST.rigCurrent) { ST.rig = ST.rigCurrent; buildModel(); }
  const keys = [];
  for (let f = 0; f < s.frames; f++) keys.push(keyOf(f, poseFromFrame(ST.rig, ST.m, s.start + f)));
  ST.anim = { name, fps: s.rate, frames: s.frames, loop: true, interp: 'linear', source: 'copy:' + s.name, made_on: ST.mesh, rig: RIG_VERSION, keys };
  ST.dirty = true;
  showAnim();
  status(`A copy of ${s.name} on the skeleton: change the poses, then Save.`);
}
async function editAnim(name) {
  if (ST.anim && ST.dirty && !confirm('Leave the animation you are editing (unsaved changes)?')) return;
  ST.anim = await api('/api/studio_anim?name=' + encodeURIComponent(name));
  ST.dirty = false;
  await useRigOf(ST.anim);
  if (ST.rig !== ST.rigCurrent) status(`${ST.anim.name} was made before the hands had bones: it keeps its old skeleton (hand and forearm move together).`);
  showAnim();
}
function showAnim(resetHistory = true) {
  keyDrag?.cancel();
  stopPlay();
  if (resetHistory) { ST.undo = []; ST.redo = []; ST.pending = null; ST.saved = ST.dirty ? null : JSON.stringify(ST.anim); ST.animationId = (ST.animationId || 0) + 1; }
  ST.graphRevision++; graphCache = null;
  ST.sel = 'bone';
  skel.visible = true;
  ST.timeline = { frames: ST.anim.frames, anim: ST.anim };
  $('#as-frame').max = Math.max(0, ST.anim.frames - 1);
  setFrame(0);
  renderPanel();
  renderLists();
  drawKeys();
}
function setFrame(f, playing) {
  ST.frame = Math.max(0, Math.min(f, (ST.timeline?.frames || 1) - (playing ? 0.001 : 1)));
  f = ST.frame;
  $('#as-frame').value = f;
  const tl = ST.timeline;
  $('#as-fno').textContent = tl ? `${Math.floor(f) + 1} / ${tl.frames}` : '';
  syncKeyCursor();
  if (tl && tl.game) {
    const i = Math.floor(f), n = tl.game.frames, t = f - i;
    if (t < 1e-3) return showGameFrame(tl.game.start + i);
    // between two frames, both during playback and while scrubbing the timeline
    const a = framePos(ST.m, tl.game.start + i), b = framePos(ST.m, tl.game.start + (i + 1) % n);
    for (let k = 0; k < a.length; k++) tmpPos.arr[k] = a[k] + (b[k] - a[k]) * t;
    showPositions(tmpPos.arr);
    return;
  }
  if (ST.anim) {
    setPose(fullPose(ST.rig, ST.anim, f));
    if (!playing) attachGizmo();
    if (!playing) renderPanel();
  }
  curveEditor?.refresh();
}
function togglePlay() {
  if (ST.playing) return stopPlay();
  const tl = ST.timeline;
  if (!tl) return;
  stopGizmo();
  ST.playing = tl.game ? { frames: tl.frames, rate: tl.game.rate, loop: true, t: ST.frame / tl.game.rate }
    : { frames: ST.anim.frames, rate: ST.anim.fps, loop: ST.anim.loop !== false, t: ST.frame / ST.anim.fps };
  $('#as-play').textContent = '❚❚';
}
function stopPlay() {
  if (!ST.playing) return;
  ST.playing = null;
  $('#as-play').textContent = '▶';
  if (ST.anim) { ST.frame = Math.round(ST.frame); setFrame(ST.frame); }
}
function drawKeys() {
  const el = $('#as-keys');
  if (!el) return;
  const tl = ST.timeline;
  $('#as-keybone').disabled = $('#as-keypose').disabled = !tl?.anim;
  $('#as-keybone').textContent = ST.sel === 'ik' && tl?.anim && ikOn(tl.anim, ST.ikChain) ? 'Key controller' : graphKey() === '$root' ? 'Key position' : 'Key bone';
  if (!tl || !tl.anim) { el.innerHTML = '<div class="st-channel-empty hint">New or Copy an animation to edit its bone keys.</div>'; drawRuler(); syncKeyCursor(); return; }
  const n = Math.max(1, tl.frames - 1);
  const query = ST.channelFilter.trim().toLowerCase(), selected = ST.sel === 'ik' ? 'ik:' + ST.ikChain : graphKey();
  const label = (name) => name === '$root' ? 'Body position' : gripSide(name) ? GRIP_LABEL[gripSide(name)] : name.startsWith('ik:') ? CHAINS[name.slice(3)].label : BONES[BI[name]][2];
  const matches = (name) => (!ST.onlySelected || name === selected) && (!query || (label(name) + ' ' + name).toLowerCase().includes(query));
  const shown = new Set([...CHANNELS, ...Object.keys(CHAINS).map((c) => 'ik:' + c), ...GRIP_SIDES.map(gripChannel)].filter(matches));
  // Keep parent context in search results, while bypassing collapsed ancestors.
  if (query && !ST.onlySelected) for (const name of [...shown]) {
    let parent = BONES[BI[name]]?.[1];
    while (parent) { shown.add(parent); parent = BONES[BI[parent]][1]; }
  }
  const scroll = el.scrollTop, rows = [];
  const row = (name, depth) => {
    const children = BONES.filter((b) => b[1] === name), folded = ST.folded.has(name);
    if (shown.has(name)) {
      const frames = channelFrames(tl.anim, name);
      rows.push(`<div class="st-channel-row ${name === selected ? 'selected' : ''}" data-channel="${name}">
        <div class="st-channel-label" style="--depth:${depth}">
          ${children.length ? `<button class="st-fold" data-fold="${name}" aria-label="${folded ? 'Expand' : 'Collapse'} ${label(name)}" aria-expanded="${!folded}">${folded ? '▸' : '▾'}</button>` : '<span class="st-fold-space"></span>'}
          <button class="st-channel-name" data-channel-select="${name}" title="${label(name)} ${name === '$root' ? '' : 'rotation'}">${label(name)}</button>
          <span class="st-channel-count">${frames.length}</span></div>
        <div class="st-channel-lane" data-lane="${name}">${frames.map((f) => `<button type="button" class="st-key" style="left:${f / n * 100}%" data-key="${f}" data-bone="${name}" aria-label="${label(name)} key at frame ${f + 1}" title="${label(name)} · frame ${f + 1} — drag to move"></button>`).join('')}</div></div>`);
      if (ST.graphVisible && name === selected) for (const axis of ['x', 'y', 'z']) {
        rows.push(`<div class="st-channel-axis"><button data-axis="${axis}" style="--depth:${depth + 1}" class="axis-${axis} ${ST.graphAxis === axis ? 'on' : ''}">${axis.toUpperCase()} ${name === '$root' ? 'position' : 'rotation'}</button></div>`);
      }
    }
    if (!folded || query || ST.onlySelected) for (const [child] of children) row(child, depth + 1);
  };
  row('$root', 0);
  for (const c of Object.keys(CHAINS)) {
    const name = 'ik:' + c;
    if (!ikOn(tl.anim, c) || !shown.has(name)) continue;
    const frames = channelFrames(tl.anim, name);
    rows.push(`<div class="st-channel-row st-ik-channel ${name === selected ? 'selected' : ''}" data-channel="${name}">
      <div class="st-channel-label" style="--depth:0"><span class="st-fold-space"></span>
        <button class="st-channel-name" data-channel-select="${name}" title="${CHAINS[c].label}: where the ${c.endsWith('arm') ? 'hand' : 'foot'} is, its turn and its pole">${CHAINS[c].label}</button>
        <span class="st-channel-count">${frames.length}</span></div>
      <div class="st-channel-lane" data-lane="${name}">${frames.map((f) => `<button type="button" class="st-key" style="left:${f / n * 100}%" data-key="${f}" data-bone="${name}" aria-label="${CHAINS[c].label} key at frame ${f + 1}" title="${CHAINS[c].label} · frame ${f + 1} — drag to move"></button>`).join('')}</div></div>`);
  }
  // the grip of a hand: shown with keys, or while its hand (or its arm's IK) is selected
  for (const s of GRIP_SIDES) {
    const name = gripChannel(s);
    if (!shown.has(name) || (!gripKeys(tl.anim, s).length && handSide() !== s)) continue;
    const frames = channelFrames(tl.anim, name);
    rows.push(`<div class="st-channel-row st-ik-channel ${handSide() === s ? 'selected' : ''}" data-channel="${name}">
      <div class="st-channel-label" style="--depth:0"><span class="st-fold-space"></span>
        <button class="st-channel-name" data-channel-select="${name}" title="${GRIP_LABEL[s]}: how far the hand is closed">${GRIP_LABEL[s]}</button>
        <span class="st-channel-count">${frames.length}</span></div>
      <div class="st-channel-lane" data-lane="${name}">${frames.map((f) => `<button type="button" class="st-key" style="left:${f / n * 100}%" data-key="${f}" data-bone="${name}" aria-label="${GRIP_LABEL[s]} key at frame ${f + 1}" title="${GRIP_LABEL[s]} · frame ${f + 1} — drag to move"></button>`).join('')}</div></div>`);
  }
  row('pelvis', 0);
  el.innerHTML = rows.join('') || '<div class="st-channel-empty hint">No matching bones.</div>';
  el.scrollTop = scroll;
  for (const button of el.querySelectorAll('[data-channel-select]')) button.onclick = () => selectChannel(button.dataset.channelSelect);
  for (const button of el.querySelectorAll('[data-fold]')) button.onclick = () => {
    const name = button.dataset.fold;
    if (ST.folded.has(name)) ST.folded.delete(name); else ST.folded.add(name);
    drawKeys();
  };
  for (const button of el.querySelectorAll('[data-axis]')) button.onclick = () => curveEditor?.setAxis(button.dataset.axis);
  for (const key of el.querySelectorAll('[data-key]')) {
    key.onpointerdown = startKeyDrag;
    key.onclick = (e) => { if (!e.detail) { stopPlay(); selectChannel(key.dataset.bone); setFrame(+key.dataset.key); } };
  }
  for (const lane of el.querySelectorAll('[data-lane]')) lane.onpointerdown = (e) => {
    if (e.button !== 0 || e.target.closest('[data-key]')) return;
    selectChannel(lane.dataset.lane);
    scrub(e);
  };
  drawRuler();
  syncKeyCursor();
}
// The ruler over the key lanes, like a video editor's: a tick per frame (or per few frames when they are
// close), numbers where they fit, and the playhead's head; click or drag it to move through the animation.
function drawRuler() {
  const r = $('#as-ruler'), keys = $('#as-keys'), tl = ST.timeline;
  if (!r) return;
  if (!tl || ST.graphVisible) { r.innerHTML = ''; return; }
  r.parentElement.style.setProperty('--sbw', `${keys.offsetWidth - keys.clientWidth}px`);
  const frames = tl.frames, n = Math.max(1, frames - 1), px = (r.clientWidth || 1) / n;
  const steps = [1, 2, 5, 10, 15, 20, 30, 50, 60, 100, 150, 300, 600];
  const label = steps.find((s) => s * px >= 40) || 1200;
  const minor = steps.find((s) => s * px >= 6 && label % s === 0) || label;
  // frames are counted from 1 (as everywhere in the Studio): marks at 1, then every `minor`th frame
  const marks = [1];
  for (let num = minor; num <= frames; num += minor) if (num > 1) marks.push(num);
  r.innerHTML = marks.map((num) => {
    const major = num === 1 || num % label === 0;
    return `<span class="st-tick${major ? ' major' : ''}" style="left:${(num - 1) / n * 100}%">${major ? `<b>${num}</b>` : ''}</span>`;
  }).join('') + '<span class="st-ph-head"></span>';
}
// click or drag on the ruler or a lane: the playhead follows the pointer, a frame at a time. Measured on
// the ruler (it lines up with the lanes, and a lane can be redrawn under the pointer when its bone is chosen).
function scrub(e) {
  if (e.button !== 0 || !ST.timeline) return;
  e.preventDefault();
  stopPlay();
  const n = Math.max(1, ST.timeline.frames - 1);
  const at = (event) => {
    const r = $('#as-ruler').getBoundingClientRect();
    if (r.width < 2) return;
    const f = Math.max(0, Math.min(n, Math.round((event.clientX - r.left) / r.width * n)));
    if (f !== Math.round(ST.frame) || event === e) setFrame(f);
  };
  at(e);
  const move = (event) => { if (event.pointerId === e.pointerId) at(event); };
  const end = (event) => {
    if (event.pointerId !== e.pointerId) return;
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
}
function gotoFrame(f) {
  if (!ST.timeline) return;
  stopPlay();
  setFrame(Math.max(0, Math.min(ST.timeline.frames - 1, f)));
}
// the previous / next frame with a key on any channel (a game animation: every frame is one)
function gotoKey(dir) {
  const tl = ST.timeline;
  if (!tl) return;
  const now = Math.round(ST.frame);
  const frames = tl.anim ? channelFrames(tl.anim, ST.sel === 'ik' ? 'ik:' + ST.ikChain : graphKey())
    : Array.from({ length: tl.frames }, (_, i) => i);
  const f = dir < 0 ? frames.filter((x) => x < now).pop() : frames.find((x) => x > now);
  gotoFrame(f ?? (dir < 0 ? 0 : tl.frames - 1));
}
// Explicitly create a breakdown; selecting or scrubbing never changes saved motion.
function inbetweenAnimation(anim, rig, scope, f, weight) {
  if (!Number.isInteger(f) || f < 0 || f >= anim.frames || !Number.isFinite(weight) || weight < 0 || weight > 1)
    throw new Error('Choose a frame and a weight from 0 to 100%.');
  const result = cloneAnimation(anim), pose = poseAt(anim, f), fk = [];
  const ranges = scope.map(name => {
    const frames = channelFrames(anim, name), left = frames.filter(x => x < f).at(-1), right = frames.find(x => x > f);
    if (left === undefined || right === undefined) throw new Error('Place the playhead between two keys on each selected control.');
    return { name, left, right };
  });
  for (const { name, left, right } of ranges) {
    if (name.startsWith('ik:')) {
      const chain = name.slice(3), a = sampleIK(anim.ik[chain], left, anim), b = sampleIK(anim.ik[chain], right, anim);
      writeIKKey(result, chain, f, { v: a.v.map((v, i) => v + (b.v[i] - v) * weight), pole: a.pole.map((v, i) => v + (b.pole[i] - v) * weight),
        q: new THREE.Quaternion().fromArray(a.q).slerp(new THREE.Quaternion().fromArray(b.q), weight).toArray() });
    } else {
      const a = poseAt(anim, left), b = poseAt(anim, right);
      if (name === '$root') pose.root.copy(a.root).lerp(b.root, weight);
      else pose.rot[BI[name]].copy(a.rot[BI[name]]).slerp(b.rot[BI[name]], weight);
      fk.push(name);
    }
  }
  if (fk.length) writePoseKeys(result, pose, f, fk);
  return result;
}
function openInbetweener() {
  if (!ST.anim || ST.pending || ST.sel === 'prop') { status('Select a bone or IK controller between two keys.', 'warn'); return; }
  stopPlay();
  const original = ST.anim, f = Math.round(ST.frame), selected = ST.sel === 'ik' ? 'ik:' + ST.ikChain : graphKey();
  const dialog = document.createElement('dialog'); dialog.id = 'as-inbetween';
  dialog.setAttribute('aria-label', 'Inbetweener');
  dialog.innerHTML = `<h3>Inbetweener</h3><label class="st-tween-scope">Controls <select aria-label="Inbetween scope"><option value="selected">Selected control</option><option value="pose">Whole pose</option></select></label>
    <label class="st-tween-weight">Weight <output>50%</output><input type="range" min="0" max="100" value="50" aria-label="Inbetween weight"></label>
    <div class="st-tween-ends"><span>Previous pose</span><span>Next pose</span></div><p role="status"></p>
    <footer><button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-apply>Create key</button></footer>`;
  $('#studio').append(dialog);
  const slider = $('input', dialog), choice = $('select', dialog), apply = $('[data-apply]', dialog);
  let preview = null, applied = false;
  const update = () => {
    $('output', dialog).textContent = slider.value + '%';
    slider.style.setProperty('--fill', slider.value + '%');
    const scope = choice.value === 'pose' ? [...CHANNELS, ...Object.keys(original.ik || {}).map(c => 'ik:' + c)]
      .filter(name => channelFrames(original, name).some(x => x < f) && channelFrames(original, name).some(x => x > f)) : [selected];
    try {
      if (!scope.length) throw new Error('Place the playhead between two keys.');
      preview = inbetweenAnimation(original, ST.rig, scope, f, Number(slider.value) / 100);
      setPose(fullPose(ST.rig, preview, f)); stopGizmo(); apply.disabled = false;
      $('p', dialog).textContent = `Frame ${f + 1} · ${scope.length} ${scope.length === 1 ? 'control' : 'controls'}`;
    } catch (error) { preview = null; apply.disabled = true; $('p', dialog).textContent = error.message; }
  };
  slider.oninput = choice.onchange = update;
  $('[data-cancel]', dialog).onclick = () => dialog.close();
  apply.onclick = () => { if (!preview || ST.anim !== original) return; beginEdit(); ST.anim = preview; applied = true; dialog.close(); commitEdit(); };
  dialog.onclose = () => { dialog.remove(); if (!applied) { setFrame(f); attachGizmo(); } };
  dialog.showModal(); update(); slider.focus();
}
function syncKeyCursor() {
  const el = $('#as-keys');
  if (!el) return;
  $('#as-channels').style.setProperty('--playhead', `${ST.frame / Math.max(1, (ST.timeline?.frames || 1) - 1) * 100}%`);
  if (!ST.playing) for (const key of el.querySelectorAll('[data-key]')) key.classList.toggle('at-frame', +key.dataset.key === Math.round(ST.frame));
}
function setGraphVisible(visible) {
  ST.graphVisible = !!visible;
  $('#studio').classList.toggle('has-graph', ST.graphVisible);
  $('#as-editors').classList.toggle('graph-open', ST.graphVisible);
  $('#as-graph').hidden = !ST.graphVisible;
  $('#as-graph-toggle').setAttribute('aria-pressed', String(ST.graphVisible));
  $('#as-graph-toggle').textContent = ST.graphVisible ? 'Hide Graph' : 'Graph';
  try { localStorage.setItem('deusedix.studio.graph', String(ST.graphVisible)); } catch {}
  drawKeys(); requestAnimationFrame(resize);
}
const GRIP_LABEL = { l: 'Left grip', r: 'Right grip' };
// the hand being worked on: its bone selected, or its arm's IK controller ('l', 'r' or null)
function handSide() {
  if (ST.sel === 'ik') return ST.ikChain === 'l_arm' ? 'l' : ST.ikChain === 'r_arm' ? 'r' : null;
  if (ST.sel === 'bone') return ST.bone === BI.l_hand ? 'l' : ST.bone === BI.r_hand ? 'r' : null;
  return null;
}
function selectChannel(name) {
  if (gripSide(name)) { selectBone(BI[gripSide(name) + '_hand']); return; }       // its hand (or its arm's IK)
  if (name.startsWith('ik:')) { selectIK(name.slice(3)); return; }
  if (name === '$root') {
    ST.sel = 'bone';
    ST.graphTarget = 'position'; ST.bone = 0; gizmo?.setMode('translate');
    if (ST.pose) setPose(ST.pose);
    attachGizmo(); renderPanel(); drawKeys(); curveEditor?.refresh();
  } else selectBone(BI[name]);
}
function startKeyDrag(e) {
  if (e.button !== 0) return;
  keyDrag?.cancel();
  e.preventDefault(); e.stopPropagation(); stopPlay();
  const anim = ST.anim, pointer = e.pointerId;
  const button = e.currentTarget, name = button.dataset.bone, from = +button.dataset.key;
  const bounds = button.parentElement.getBoundingClientRect(), x = e.clientX;
  selectChannel(name); setFrame(from);
  let to = from;
  const move = (event) => {
    if (event.pointerId !== pointer) return;
    to = Math.max(0, Math.min(ST.anim.frames - 1, from + Math.round((event.clientX - x) / bounds.width * (ST.anim.frames - 1))));
    const key = $('#as-keys').querySelector(`[data-bone="${name}"][data-key="${from}"]`);
    if (key) { key.style.left = `${to / Math.max(1, ST.anim.frames - 1) * 100}%`; key.title = `Move to frame ${to + 1}`; }
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
    keyDrag = null;
  };
  const end = (event) => {
    if (event.pointerId !== pointer) return;
    cleanup();
    if (!ST.open || ST.anim !== anim) { drawKeys(); return; }
    if (event.type === 'pointercancel' || from === to) { drawKeys(); return; }
    beginEdit();
    try { moveChannelKeys(ST.anim, name, from, to); ST.frame = to; commitEdit(); }
    catch (error) { cancelEdit(); status(error.message, 'warn'); }
  };
  keyDrag = { cancel: () => { cleanup(); drawKeys(); } };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
}
// the gizmo turns the selected bone (the hips also move: W / E)
function attachGizmo() {
  if (!ST.anim || ST.playing) return stopGizmo();
  if (ST.sel === 'prop') {                   // a prop: moved, turned and scaled in the 3D view (G, R, S)
    const o = propObject();
    if (!o || !o.visible) { propBox.visible = false; return stopGizmo(); }
    handle.position.copy(o.position); handle.quaternion.copy(o.quaternion); handle.scale.copy(o.scale);
    handle.updateMatrixWorld();
    if (gizmo.object !== handle) gizmo.attach(handle);
    gizmo.setSpace(gizmo.mode === 'translate' ? 'world' : 'local');
    propBox.setFromObject(o); propBox.visible = true;
    return;
  }
  propBox.visible = false;
  handle.scale.set(1, 1, 1);
  if (ST.sel === 'ik') {                     // an IK controller: G moves it, R turns the hand or the foot
    if (!ikOn(ST.anim, ST.ikChain)) { ST.sel = 'bone'; return attachGizmo(); }
    const t = sampleIK(ST.anim.ik[ST.ikChain], ST.frame, ST.anim);
    if (ST.ikPart === 'pole') { handle.position.fromArray(t.pole); handle.quaternion.identity(); if (gizmo.mode !== 'translate') gizmo.setMode('translate'); }
    else { handle.position.fromArray(t.v); handle.quaternion.fromArray(t.q).normalize(); if (gizmo.mode === 'scale') gizmo.setMode('translate'); }
    handle.updateMatrixWorld();
    if (gizmo.object !== handle) gizmo.attach(handle);
    gizmo.setSpace(gizmo.mode === 'translate' ? 'world' : 'local');
    return;
  }
  if (gizmo.mode === 'scale') gizmo.setMode('rotate');
  gizmo.setSpace('local');
  const { Rw, Jw } = worldOf(ST.rig, ST.pose);
  handle.position.copy(Jw[ST.bone]);
  handle.quaternion.copy(Rw[ST.bone]);
  handle.updateMatrixWorld();
  if (gizmo.object !== handle) gizmo.attach(handle);
  if (ST.bone !== 0 && gizmo.mode === 'translate') gizmo.setMode('rotate');
}
function stopGizmo() { if (gizmo && gizmo.object) gizmo.detach(); }
function onGizmo() {
  if (!ST.anim || !ST.pose) return;
  if (ST.sel === 'prop') return propFromHandle();
  if (ST.sel === 'ik') return ikFromHandle();
  const b = ST.bone, pose = ST.pose;
  const { Rw } = worldOf(ST.rig, pose);
  if (gizmo.mode === 'translate' && b === 0) {
    pose.root.copy(handle.position).sub(new THREE.Vector3().fromArray(ST.rig.joints[0]));
  } else {
    pose.rot[b] = PARENT[b] < 0 ? handle.quaternion.clone() : Rw[PARENT[b]].clone().invert().multiply(handle.quaternion);
  }
  solveIK(ST.rig, pose, ST.anim, ST.frame);  // the hands and feet with IK stay where they are while the body moves
  showPositions(skin(ST.rig, ST.m, pose, tmpPos.arr));
  showIK();
  const { Rw: R2, Jw } = worldOf(ST.rig, pose);
  const T = ST.rig.tails.map((a) => new THREE.Vector3().fromArray(a)), J = ST.rig.joints.map((a) => new THREE.Vector3().fromArray(a));
  const la = skel.userData.lines.geometry.attributes.position.array;
  for (let k = 0; k < NB; k++) {
    skel.userData.balls[k].position.copy(Jw[k]);
    Jw[k].toArray(la, 6 * k); T[k].clone().sub(J[k]).applyQuaternion(R2[k]).add(Jw[k]).toArray(la, 6 * k + 3);
  }
  skel.userData.lines.geometry.attributes.position.needsUpdate = true;
}
// ---------------------------------------------------------------- props picked in the 3D view
const currentProp = () => (ST.anim?.props || []).find((p) => p.id === ST.propId) || null;
const propObject = () => (propPreview && ST.propId ? propPreview.objectOf(ST.propId) : null);
function selectProp(id) {
  if (!ST.anim) return;
  if (ST.sel !== 'prop') gizmo.setMode('translate');         // from a bone: the prop first moves
  ST.sel = 'prop'; ST.propId = id; ST.propsOpen = true;
  attachGizmo(); renderPanel();
  status('Prop: G moves, R rotates, S scales (W/E too). ' + (currentProp()?.space === 'scene' ? 'Stays in the scene.' : 'Follows its bone.'));
}
// the gizmo's place back into the prop: an offset, a turn and a size in its bone's frame (as the game bakes it)
function propFromHandle() {
  const p = currentProp(), b = p && BI[p.bone];
  if (!p || (p.space !== 'scene' && b === undefined)) return;
  const { Rw, Jw } = worldOf(ST.rig, ST.pose), inv = p.space === 'scene' ? new THREE.Quaternion() : Rw[b].clone().invert();
  p.position = handle.position.clone().sub(p.space === 'scene' ? new THREE.Vector3() : Jw[b]).applyQuaternion(inv).toArray().map((v) => +v.toFixed(2));
  const e = new THREE.Euler().setFromQuaternion(inv.multiply(handle.quaternion), 'XYZ');
  p.rotation = [e.x, e.y, e.z].map((v) => +(v * 180 / Math.PI).toFixed(1));
  if (gizmo.mode === 'scale') {               // one size: the axis dragged the most
    const s = handle.scale.toArray(), k = s.reduce((a, v) => (Math.abs(v - p.scale) > Math.abs(a - p.scale) ? v : a), s[0]);
    p.scale = Math.max(0.01, Math.min(10, +k.toFixed(3)));
    handle.scale.setScalar(p.scale);
  }
  setPose(ST.pose);
  const o = propObject();
  if (o) propBox.setFromObject(o);
}
// the gizmo's place back into the IK controller: a key on this frame, the limb solved at once
function ikFromHandle() {
  const a = ST.anim, c = ST.ikChain, f = Math.max(0, Math.min(a.frames - 1, Math.round(ST.frame)));
  const t = sampleIK(a.ik[c], f, a);
  if (ST.ikPart === 'pole') t.pole = handle.position.toArray();
  else { t.v = handle.position.toArray(); t.q = handle.quaternion.toArray(); }
  writeIKKey(a, c, f, t);
  ST.frame = f;
  setPose(fullPose(ST.rig, a, f));
}
function selectIK(chain, part = 'target') {
  if (!ST.anim || !ikOn(ST.anim, chain)) return;
  if (ST.sel !== 'ik') gizmo.setMode('translate');
  ST.sel = 'ik'; ST.ikChain = chain; ST.ikPart = part;
  ST.graphTarget = part === 'pole' || gizmo.mode !== 'rotate' ? 'position' : 'rotation';
  if (part === 'pole' && gizmo.mode !== 'translate') gizmo.setMode('translate');
  setPose(ST.pose); attachGizmo(); renderPanel(); drawKeys(); curveEditor?.refresh();
  const arm = chain.endsWith('arm');
  status(part === 'pole' ? `${CHAINS[chain].label}: the ${arm ? 'elbow' : 'knee'} points at this pole (G moves it).`
    : `${CHAINS[chain].label}: G moves it, R turns the ${arm ? 'hand' : 'foot'}, the ${arm ? 'arm' : 'leg'} follows; Alt+G / Alt+R: back to the bones' pose.`);
}
// G / R / S as in Blender (W / E as in Unity): the gizmo moves, turns or scales what is selected
function moveMode(mode) {
  if (!ST.anim) return;
  if (ST.sel === 'ik') {
    if (mode === 'scale') { status('IK controllers have no size.', 'warn'); return; }
    if (mode === 'rotate' && ST.ikPart === 'pole') { status('A pole only moves (G).', 'warn'); return; }
    gizmo.setMode(mode); ST.graphTarget = mode === 'rotate' ? 'rotation' : 'position';
    attachGizmo(); drawKeys(); curveEditor?.refresh(); return;
  }
  if (ST.sel === 'prop') { gizmo.setMode(mode); attachGizmo(); return; }
  if (mode === 'translate') { selectChannel('$root'); status('G moves the whole body (the hips); R turns the selected bone.'); return; }
  if (mode === 'scale') { status('Bones keep their size: select a prop to scale it.', 'warn'); return; }
  if (graphKey() === '$root') selectBone(0); else selectBone(ST.bone);
}
// Alt+G / Alt+R / Alt+S: the selection's place, turn or size back to rest, keyed
function clearTransform(kind) {
  if (!ST.anim || !ST.pose) return;
  if (ST.sel === 'ik') {                     // back to where the chain's own bones put it
    if (kind === 'scale') { status('IK controllers have no size.', 'warn'); return; }
    const c = ST.ikChain, f = Math.max(0, Math.min(ST.anim.frames - 1, Math.round(ST.frame)));
    const fk = ikFromPose(ST.rig, poseAt(ST.anim, f), c), t = sampleIK(ST.anim.ik[c], f, ST.anim);
    beginEdit();
    if (kind === 'turn') t.q = fk.q; else if (ST.ikPart === 'pole') t.pole = fk.pole; else t.v = fk.v;
    writeIKKey(ST.anim, c, f, t);
    commitEdit();
    return;
  }
  if (ST.sel === 'prop') {
    const p = currentProp();
    if (!p) return;
    beginEdit();
    if (kind === 'move') p.position = [0, 0, 0]; else if (kind === 'turn') p.rotation = [0, 0, 0]; else p.scale = 1;
    commitEdit();
    return;
  }
  if (kind === 'move') { ST.pose.root.set(0, 0, 0); setPose(ST.pose); afterEdit(['$root']); }
  else if (kind === 'turn') { ST.pose.rot[ST.bone] = new THREE.Quaternion(); setPose(ST.pose); afterEdit([BONES[ST.bone][0]]); }
  attachGizmo();
}
// Ctrl+C / Ctrl+V the pose (Ctrl+Shift+V mirrored, as Blender's flipped paste); pasted, it is keyed on this frame
function copyPose() {
  if (!ST.anim || !ST.pose) return;
  ST.clip = { rot: ST.pose.rot.map((q) => q.toArray()), root: ST.pose.root.toArray() };
  status('Pose copied: Ctrl+V pastes it on a frame, Ctrl+Shift+V mirrored.');
}
function pastePose(mirror) {
  if (!ST.anim || !ST.clip) return;
  const pose = restPose();
  ST.clip.rot.forEach((a, b) => pose.rot[b].fromArray(a));
  pose.root.fromArray(ST.clip.root);
  ST.pose = pose;
  if (!mirror) { beginEdit(); keyIKOfPose(pose, Math.max(0, Math.min(ST.anim.frames - 1, Math.round(ST.frame)))); }
  setPose(pose);
  if (mirror) mirrorPose(); else afterEdit(CHANNELS);
  attachGizmo();
}
// Blender's numpad views (Ctrl: from the other side) and F / Numpad . to look at the selection
function viewFrom(side) {
  if (!ST.rig) return;
  const c = orbit.target.clone(), d = Math.max(camera.position.distanceTo(c), ST.rig.H * 0.5);
  const dir = { front: [1, 0, 0], back: [-1, 0, 0], right: [0, 0, 1], left: [0, 0, -1], top: [0.001, 1, 0], bottom: [0.001, -1, 0] }[side];
  camera.position.copy(c).addScaledVector(new THREE.Vector3(...dir).normalize(), d);
  camera.lookAt(c);
}
function frameSelected() {
  if (!ST.rig) return;
  const o = ST.sel === 'prop' ? propObject() : null;
  const ik = ST.sel === 'ik' && ikOn(ST.anim, ST.ikChain) ? sampleIK(ST.anim.ik[ST.ikChain], ST.frame, ST.anim) : null;
  const target = ik ? new THREE.Vector3().fromArray(ST.ikPart === 'pole' ? ik.pole : ik.v)
    : o ? new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())
    : ST.pose && ST.anim ? worldOf(ST.rig, ST.pose).Jw[ST.bone].clone() : new THREE.Vector3().fromArray(ST.rig.joints[0]);
  const off = camera.position.clone().sub(orbit.target);
  off.setLength(Math.min(off.length(), ST.rig.H * (o ? 0.35 : 0.7)));
  orbit.target.copy(target); camera.position.copy(target).add(off);
  navigation.frameOrtho(off.length());
}
function frameAll() {
  if (!ST.rig || !modelObj) return;
  const box = new THREE.Box3().setFromObject(modelObj);
  if (propPreview?.root.visible) box.union(new THREE.Box3().setFromObject(propPreview.root));
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const aspect = $('#as-view').clientWidth / Math.max(1, $('#as-view').clientHeight);
  const distance = Math.max(size.y, Math.max(size.x, size.z) / Math.min(1, aspect), ST.rig.H) * 1.8;
  const offset = camera.position.clone().sub(orbit.target).setLength(distance);
  orbit.target.copy(center); camera.position.copy(center).add(offset); navigation.frameOrtho(distance);
}
// Ctrl+Space, as Blender's maximize area: the Graph editor fills the Studio (again: the view comes back)
function toggleGraphMax(on = !ST.graphMax) {
  if (on && !ST.graphVisible) setGraphVisible(true);
  ST.graphMax = !!on;
  $('#studio').classList.toggle('graph-max', ST.graphMax);
  curveEditor?.setMaximized(ST.graphMax);
  requestAnimationFrame(() => { resize(); curveEditor?.fit(); });
}
function afterEdit(scope = [ST.sel === 'ik' ? 'ik:' + ST.ikChain : graphKey()]) {  // Auto key only the channel that was changed.
  if (!ST.anim || !ST.pose) return;
  beginEdit();
  const f = Math.max(0, Math.min(ST.anim.frames - 1, Math.round(ST.frame)));
  writePoseKeys(ST.anim, ST.pose, f, scope.filter((n) => !n.startsWith('ik:')));
  // the IK controllers keyed where they are (with the whole pose, or the one selected)
  for (const c of Object.keys(CHAINS)) if (ikOn(ST.anim, c) && (scope === CHANNELS || scope.includes('ik:' + c)))
    writeIKKey(ST.anim, c, f, sampleIK(ST.anim.ik[c], f, ST.anim));
  ST.frame = f; commitEdit();
}
function pickBone(e) {
  if (!ST.anim || ST.playing || gizmo.dragging || e.button !== 0) return;
  const r = $('#as-view').getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const ik = ikGroup?.visible ? ray.intersectObjects(ikGroup.children.filter((o) => o.visible && o.userData.chain), false)[0] : null;
  if (ik) { selectIK(ik.object.userData.chain, ik.object.userData.part); return; }
  const hit = ray.intersectObjects(skel.userData.balls, false)[0];
  if (hit) { selectBone(hit.object.userData.bone); return; }
  // a prop held by the character (it is picked before the body it is in front of)
  const ph = propPreview?.root.visible ? ray.intersectObject(propPreview.root, true).find((h) => h.object.visible) : null;
  if (ph) {
    let o = ph.object;
    while (o.parent && o.parent !== propPreview.root) o = o.parent;
    if (o.userData.id) { selectProp(o.userData.id); return; }
  }
  // a click on the body: the bone of the nearest vertex
  const hb = ray.intersectObject(modelObj, true)[0];
  if (!hb) return;
  let best = -1, bd = Infinity;
  for (let i = 0; i < ST.m.FV; i++) {
    const d = (tmpPos.arr[3 * i] - hb.point.x) ** 2 + (tmpPos.arr[3 * i + 1] - hb.point.y) ** 2 + (tmpPos.arr[3 * i + 2] - hb.point.z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  if (best >= 0) selectBone(ST.rig.weights[best][0]);
}
function selectBone(b) {
  const chain = chainOfBone(BONES[b][0]);
  if (ST.anim && chain && ikOn(ST.anim, chain)) {        // a bone with IK: its controller moves it
    selectIK(chain);
    status(`${BONES[b][2]} follows its IK controller: move the controller, or turn IK off for ${CHAINS[chain].short} in the panel.`);
    return;
  }
  ST.sel = 'bone';
  ST.bone = b; ST.graphTarget = 'rotation'; gizmo?.setMode('rotate');
  let parent = BONES[b][1];
  while (parent) { ST.folded.delete(parent); parent = BONES[BI[parent]][1]; }
  setPose(ST.pose);
  attachGizmo();
  renderPanel();
  drawKeys();
  $('#as-keys')?.querySelector(`[data-channel="${BONES[b][0]}"]`)?.scrollIntoView({ block: 'nearest' });
  curveEditor?.refresh();
}
function onKey(e) {
  if (!ST.open) return;
  if ($('#as-inbetween')?.open) return;
  if (window.__menubar?.settingsOpen || e.target.isContentEditable) return;
  if (keyDrag) {
    if (e.key === 'Escape') keyDrag.cancel();
    e.preventDefault(); e.stopPropagation(); return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if (navigation.flying) { navigation.key(e, viewFrom); e.preventDefault(); e.stopImmediatePropagation(); return; }
  if (ctrl && e.code === 'Space') { e.preventDefault(); e.stopPropagation(); toggleGraphMax(); return; }
  if (ST.graphVisible && curveEditor?.keyDown(e)) { e.preventDefault(); e.stopPropagation(); return; }
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) { e.stopPropagation(); return; }
  if (navigation.key(e, viewFrom)) { e.preventDefault(); e.stopPropagation(); return; }
  const k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase(), alt = e.altKey, shift = e.shiftKey;
  // Blender's keys (and the Studio's own: W / E, K, Home / End)
  let used = true;
  if (ctrl && k === 'z') historyStep(shift);
  else if (ctrl && k === 'y') historyStep(true);
  else if (ctrl && k === 's') { if (ST.anim) save(false); }
  else if (ctrl && k === 'c') copyPose();
  else if (ctrl && k === 'v') pastePose(shift);
  else if (ctrl) used = false;
  else if (k === ' ') togglePlay();
  else if (k === 'escape') close();
  else if (alt && k === 'g') clearTransform('move');
  else if (alt && k === 'r') clearTransform('turn');
  else if (alt && k === 's') clearTransform('scale');
  else if (alt && k === 'i') { if (ST.anim) deleteKey(); }
  else if (alt) used = false;
  else if (k === 'g' || k === 'w') moveMode('translate');
  else if (k === 'r' || k === 'e') moveMode('rotate');
  else if (k === 's') moveMode('scale');
  else if (k === 'f' || e.code === 'NumpadDecimal') frameSelected();
  else if (e.code === 'Numpad1') viewFrom(ctrl ? 'back' : 'front');
  else if (e.code === 'Numpad3') viewFrom(ctrl ? 'left' : 'right');
  else if (e.code === 'Numpad7') viewFrom(ctrl ? 'bottom' : 'top');
  else if (k === 'arrowright' && shift) gotoFrame(Infinity);
  else if (k === 'arrowleft' && shift) gotoFrame(0);
  else if (k === 'arrowright') { stopPlay(); setFrame(Math.min((ST.timeline ? ST.timeline.frames : 1) - 1, Math.round(ST.frame) + 1)); }
  else if (k === 'arrowleft') { stopPlay(); setFrame(Math.max(0, Math.round(ST.frame) - 1)); }
  else if (k === 'arrowup') gotoKey(1);       // Blender: up, the next key
  else if (k === 'arrowdown') gotoKey(-1);
  else if (k === 'home') gotoFrame(0);
  else if (k === 'end') gotoFrame(Infinity);
  else if ((k === 'k' || k === 'i') && ST.anim) afterEdit(shift ? CHANNELS : undefined);
  else if ((k === 'delete' || k === 'x') && ST.anim) deleteKey();
  else used = false;
  if (used) e.preventDefault();
  e.stopPropagation();                      // the map editor behind does not get the Studio's keys
}
function deleteKey() {
  const f = Math.round(ST.frame), name = ST.sel === 'ik' ? 'ik:' + ST.ikChain : graphKey();
  if (!ST.anim || !canDeleteChannelKey(ST.anim, name, f)) return;
  beginEdit();
  removeChannelKey(ST.anim, name, f);
  commitEdit();
}
function mirrorPose() {                     // left <-> right (mirror across the body's middle plane: z)
  const p = ST.pose, out = restPose();
  const mir = (q) => new THREE.Quaternion(-q.x, -q.y, q.z, q.w);      // reflection z -> -z of a rotation
  BONES.forEach(([n], b) => {
    const other = n.startsWith('l_') ? 'r_' + n.slice(2) : n.startsWith('r_') ? 'l_' + n.slice(2) : n;
    out.rot[BI[other]] = mir(p.rot[b]);
  });
  out.root.set(p.root.x, p.root.y, -p.root.z);
  ST.pose = out;
  beginEdit(); keyIKOfPose(out, Math.max(0, Math.min(ST.anim.frames - 1, Math.round(ST.frame))));
  setPose(out);
  afterEdit(CHANNELS);
}

// ---------------------------------------------------------------- the right panel
function renderPanel() {
  const el = $('#as-panel');
  if (!el) return;
  const fromSequence = $('#as-fromseq')?.value, fromFrame = $('#as-fromf')?.value;
  const a = ST.anim;
  if (!a) {
    propPreview?.hide();
    el.innerHTML = `<div class="st-h">The skeleton</div>
      <div class="hint">The Studio found ${NB} bones in this model from the game's own animations (fit: ${ST.rig ? ST.rig.error : '?'} units on average).
      Play a game animation on the left, or make your own: <b>+ New</b>, <b>Copy</b> a game animation to change it, or <b>Import file</b>.</div>
      <div class="st-row"><button id="as-rerig" title="Make the skeleton again from the game's animations">Make the skeleton again</button></div>`;
    $('#as-rerig').onclick = async () => { ST.rigCurrent = ST.rig = autoRig(ST.m, ST.mesh, (t) => t && status(t)); await api('/api/studio_rig', ST.rig); buildModel(); setPose(restPose()); status('skeleton made again: fit ' + ST.rig.error + ' units'); renderPanel(); };
    return;
  }
  const f = Math.round(ST.frame), channel = ST.sel === 'ik' && ikOn(a, ST.ikChain) ? 'ik:' + ST.ikChain : graphKey(), isKey = channelFrames(a, channel).includes(f);
  const ikNow = channel.startsWith('ik:') ? sampleIK(a.ik[ST.ikChain], ST.frame, a) : null;
  const seqs = ST.m.seqs.filter((s) => !s.custom && !NOT_BODY.test(s.name));
  el.innerHTML = `<div class="st-h">Animation</div>
    <div class="st-row"><label>Name</label><input id="as-name" value="${esc(a.name)}" title="Its name in the game (letters, digits, _)"></div>
    <div class="st-row"><label>Frames</label><input type="number" id="as-frames" value="${a.frames}" min="2" max="600" style="width:64px">
      <label style="width:auto">fps</label><input type="number" id="as-fps" value="${a.fps}" min="1" max="60" step="1" style="width:52px"></div>
    <div class="st-row"><label style="width:auto"><input type="checkbox" id="as-loop" ${a.loop !== false ? 'checked' : ''}> loops</label>
      <span class="hint">${(a.frames / a.fps).toFixed(1)} s</span></div>
    <div class="st-h">${channel === '$root' ? 'Body position' : ikNow ? CHAINS[ST.ikChain].label : BONES[ST.bone][2]} · frame ${f + 1} ${isKey ? '<span style="color:#ffd25a">(key)</span>' : ''}</div>
    <div class="st-row st-ik-row" role="group" aria-label="IK limbs" title="IK: move a hand or a foot and the arm or the leg follows (the controller has keys of its own). Off: turn the bones one by one (FK).">
      <label>IK</label>${Object.entries(CHAINS).map(([c, d]) => `<button type="button" data-ik="${c}" aria-label="${d.label}" aria-pressed="${ikOn(a, c)}" class="${ikOn(a, c) ? 'on' : ''}" title="${d.label}: ${ikOn(a, c) ? 'on (click: back to FK, its poses kept)' : 'off (click: move the ' + (c.endsWith('arm') ? 'hand' : 'foot') + ' and the limb follows)'}">${limbIcon(c)}</button>`).join('')}</div>
    ${ikNow ? `<div class="st-prop-transform st-ik-fields"><span>${ST.ikPart === 'pole' ? 'Pole' : 'Controller'} (character space)</span>${['X', 'Y', 'Z'].map((ax, i) => `<label title="Hold and drag, or type">${ax}<input type="number" step="0.5" data-ik-axis="${i}" value="${(ST.ikPart === 'pole' ? ikNow.pole : ikNow.v)[i].toFixed(1)}"></label>`).join('')}</div>` : ''}
    ${gripRow(a, f)}
    <div class="st-row"><label>Bone</label><select id="as-bone">${BONES.map(([n, , l], k) => `<option value="${k}" ${k === ST.bone ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    ${ST.anim && ST.pose ? (() => {      // the bone's turn typed in degrees, as the rings turn it (0 0 0: as the model stands)
      const e = new THREE.Euler().setFromQuaternion(ST.pose.rot[ST.bone] || new THREE.Quaternion(), 'XYZ');
      const deg = (r) => Math.round(r * 180 / Math.PI * 10) / 10;
      return `<div class="st-row" title="The selected bone's turn in degrees on its own axes (0 0 0 as the model stands). Typing keys it at this frame."><label>Turn °</label>${['x', 'y', 'z'].map((k, i) => `<input type="number" id="as-r${k}" step="5" value="${deg([e.x, e.y, e.z][i])}" style="width:56px" aria-label="Turn ${k.toUpperCase()}">`).join('')}</div>`;
    })() : ''}
    <div class="hint" style="margin:2px 0 6px">Pick a bone and turn its rings (R), or turn IK on for a limb and move its controller (G). Hips: G moves the body. Changes key only what moved; drag keys to retime.</div>
    <div class="st-row"><button id="as-resetb" title="Reset only the selected channel">Reset ${channel === '$root' ? 'position' : 'bone'}</button><button id="as-mirror" title="Swap left and right and key the whole pose">Mirror pose</button>
      <button id="as-delkey" ${canDeleteChannelKey(a, channel, f) ? '' : 'disabled'} title="Delete only this channel's key (Delete); keep its final key">Delete key</button></div>
    <div class="st-row"><label>From game</label><select id="as-fromseq">${seqs.map((s) => `<option>${esc(s.name)}</option>`).join('')}</select>
      <input type="number" id="as-fromf" value="1" min="1" style="width:46px" title="frame of that animation"><button id="as-frompose" title="This frame takes the pose of that frame of the game">Pose</button></div>
    <div id="as-props-host"></div>
    <div class="st-h">In the game</div>
    <div class="hint" style="margin:0 0 6px">Save makes the frames of the model for the game (also the HDTP one). Then choose it in a character's Properties, under Animation.</div>
    <div class="st-row"><button id="as-save" class="primary" title="Save and put it in the game (Ctrl+S)">Save</button>
      <button id="as-test" title="Save, then watch it on this character in the game">Save and view in game</button></div>
    <div id="as-msg" class="hint"></div>`;
  if (seqs.some((s) => s.name === fromSequence)) $('#as-fromseq').value = fromSequence;
  if (fromFrame) $('#as-fromf').value = fromFrame;
  $('#as-name').onchange = () => { const v = $('#as-name').value.trim().replace(/\W/g, ''); if (/^[A-Za-z]\w{0,40}$/.test(v)) { beginEdit(); a.name = v; commitEdit(); } else $('#as-name').value = a.name; };
  $('#as-frames').onchange = () => {
    const frames = Math.max(2, Math.min(600, Math.round(+$('#as-frames').value || 30)));
    beginEdit(); resizeAnimation(a, frames);
    commitEdit();
  };
  $('#as-fps').onchange = () => { beginEdit(); a.fps = Math.max(1, Math.min(60, Math.round(+$('#as-fps').value || 15))); commitEdit(); };
  $('#as-loop').onchange = () => { beginEdit(); a.loop = $('#as-loop').checked; commitEdit(); };
  $('#as-bone').onchange = () => selectBone(+$('#as-bone').value);
  for (const k of ['x', 'y', 'z']) {
    const inp = $('#as-r' + k);
    if (!inp) continue;
    inp.onchange = () => {
      if (!ST.anim || !ST.pose) return;
      const r = (id) => (+$('#as-r' + id).value || 0) * Math.PI / 180;
      beginEdit();
      ST.pose.rot[ST.bone] = new THREE.Quaternion().setFromEuler(new THREE.Euler(r('x'), r('y'), r('z'), 'XYZ'));
      solveIK(ST.rig, ST.pose, ST.anim, ST.frame);
      setPose(ST.pose);
      afterEdit([BONES[ST.bone][0]]);
    };
  }
  for (const b of el.querySelectorAll('[data-ik]')) b.onclick = () => setIK(b.dataset.ik, !ikOn(a, b.dataset.ik));
  for (const input of el.querySelectorAll('[data-ik-axis]')) {
    const value = () => { const t = sampleIK(a.ik[ST.ikChain], Math.round(ST.frame), a), v = Number(input.value);
      if (!Number.isFinite(v)) return null; (ST.ikPart === 'pole' ? t.pole : t.v)[+input.dataset.ikAxis] = v; return t; };
    input.oninput = () => { const t = value(); if (!t) return; stopPlay(); beginEdit(); writeIKKey(a, ST.ikChain, Math.round(ST.frame), t); setPose(fullPose(ST.rig, a, Math.round(ST.frame))); attachGizmo(); };
    input.onchange = () => { const t = value(); if (!t) return; beginEdit(); writeIKKey(a, ST.ikChain, Math.round(ST.frame), t); commitEdit(); };
  }
  wireGrip(a);
  $('#as-resetb').onclick = () => { if (channel === '$root') ST.pose.root.set(0, 0, 0); else ST.pose.rot[ST.bone] = new THREE.Quaternion(); setPose(ST.pose); afterEdit([channel]); attachGizmo(); };
  $('#as-mirror').onclick = () => mirrorPose();
  $('#as-delkey').onclick = () => deleteKey();
  $('#as-frompose').onclick = () => {
    const s = ST.m.seqs.find((x) => x.name === $('#as-fromseq').value);
    if (!s) return;
    const fr = Math.max(0, Math.min(s.frames - 1, (+$('#as-fromf').value || 1) - 1));
    ST.pose = poseFromFrame(ST.rig, ST.m, s.start + fr);
    beginEdit(); keyIKOfPose(ST.pose, Math.max(0, Math.min(ST.anim.frames - 1, Math.round(ST.frame))));
    setPose(ST.pose); afterEdit(CHANNELS); attachGizmo();
  };
  $('#as-save').onclick = () => save(false);
  $('#as-test').onclick = () => save(true);
  renderPropPanel($('#as-props-host'), ST, BONES, change => { stopPlay(); beginEdit(); change(); commitEdit(); }, status,
    { world: () => worldOf(ST.rig, ST.pose), begin: () => { stopPlay(); beginEdit(); }, preview: () => { setPose(ST.pose); if (ST.sel === 'prop') attachGizmo(); } });
}

// the grip of the hand selected: 0 open, 100 closed as the game closes this model's hands
function gripRow(a, f) {
  const s = handSide();
  if (!s) return '';
  const shape = gripsOf(ST.rig, ST.m)[s], keyed = gripAt(a, s, f), isKey = gripKeys(a, s).some((k) => k.f === f);
  const v = Math.round(100 * (keyed ?? shape?.rest ?? 0));
  const tip = !shape ? "This model's hand does not change shape" : shape.by === 'game'
    ? 'How far the hand is closed, as the game closes this model\'s hands (0 open, 100 gripping a rifle). Keyed on its own row'
    : 'How far the fingers fold (this model\'s animations never close its hands: the fingers bend at the knuckles). Keyed on its own row';
  return `<div class="st-row" title="${tip}" style="flex-wrap:nowrap"><label>Grip</label><input type="range" id="as-grip" min="0" max="100" value="${v}" ${shape ? '' : 'disabled'} style="flex:1;min-width:0">
    <span class="hint" id="as-gripv" style="flex:0 0 34px;text-align:right;font-variant-numeric:tabular-nums">${v}%</span>
    <button type="button" id="as-gripdel" ${isKey ? '' : 'disabled'} title="Delete the grip key at this frame">×</button></div>`;
}
function wireGrip(a) {
  const input = $('#as-grip'), s = handSide();
  if (!input || !s) return;
  input.oninput = () => {
    const f = Math.round(ST.frame);
    stopPlay(); beginEdit(); setGripKey(a, s, f, +input.value / 100);
    $('#as-gripv').textContent = input.value + '%';
    setPose(fullPose(ST.rig, a, f));
  };
  input.onchange = () => { commitEdit(); };
  $('#as-gripdel').onclick = () => { beginEdit(); removeGripKey(a, s, Math.round(ST.frame)); commitEdit(); };
}

// ---------------------------------------------------------------- export (to animate it in Blender, Cascadeur...)
// The character as glTF: the model in its rest frame, our skeleton (with a tip on the head, the hands and the feet,
// for the way they point), each vertex on its one or two bones, the skin textures; with an animation open, that too
// (every frame, its IK solved, and the first pose again at the end of a loop). In metres (52.5 units, as Import
// model reads them), the feet on the ground, facing +Z as glTF wants it. Import file reads it back by the bones' names.
const GLTF_UNIT = 1 / 52.5;
const TIPS = ['head', 'l_hand', 'r_hand', 'l_foot', 'r_foot'];
function characterScene(rig, m, bySlot, anim, materialOf, name = 'Character') {
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);   // +x (forward) to +z
  const P = framePos(m, rig.ref);
  let ground = Infinity;
  for (const list of Object.values(bySlot)) for (const k of list) for (let c = 0; c < 3; c++) ground = Math.min(ground, P[3 * (m.wedges[m.faces[4 * k + c]] + m.SV) + 1]);
  const place = (x, y, z) => new THREE.Vector3(x, y - ground, z).applyQuaternion(turn).multiplyScalar(GLTF_UNIT);
  // the vertices: one per wedge (a corner with its texture coordinate), on the bones of the model's vertex
  const at = new Map(), pos = [], uv = [], bones4 = [], weights4 = [], index = [], groups = [], seams = seamsOf(rig, m);
  for (const [key, list] of Object.entries(bySlot)) {
    const start = index.length;
    for (const k of list) for (const c of [0, 2, 1]) {          // corners 0, 2, 1 as in buildModel
      const w = m.faces[4 * k + c];
      if (!at.has(w)) {
        const v = m.wedges[w] + m.SV, k = seams.v.indexOf(v), [b1, w1, b2, w2] = k >= 0 ? [seams.p[k], 1 - seams.w[k], seams.c[k], seams.w[k]] : rig.weights[v];
        at.set(w, at.size);
        pos.push(...place(P[3 * v], P[3 * v + 1], P[3 * v + 2]).toArray());
        uv.push(m.uvs[2 * w], m.uvs[2 * w + 1]);
        bones4.push(b1, w2 > 0 ? b2 : b1, 0, 0); weights4.push(w2 > 0 ? w1 : 1, w2 > 0 ? w2 : 0, 0, 0);
      }
      index.push(at.get(w));
    }
    groups.push({ start, count: index.length - start, key });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(bones4, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights4, 4));
  geo.setIndex(index);
  groups.forEach((g, i) => geo.addGroup(g.start, g.count, i));
  geo.computeVertexNormals();
  // the bones: at rest every one is turned as the world (the rig's rest), so a joint is only an offset
  const J = rig.joints.map((a) => place(...a));
  const bones = BONES.map(([n]) => Object.assign(new THREE.Bone(), { name: n }));
  BONES.forEach((_, k) => { const p = PARENT[k]; bones[k].position.copy(p < 0 ? J[k] : J[k].clone().sub(J[p])); if (p >= 0) bones[p].add(bones[k]); });
  const tips = TIPS.map((n) => { const k = BI[n], t = Object.assign(new THREE.Bone(), { name: n + '_end' }); t.position.copy(place(...rig.tails[k]).sub(J[k])); bones[k].add(t); return t; });
  const mesh = new THREE.SkinnedMesh(geo, groups.map((g) => materialOf(...g.key.split('|').map(Number))));
  mesh.name = name + '_body';
  const root = new THREE.Group();
  root.name = name;
  root.add(bones[BI.pelvis], mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([...bones, ...tips]));
  if (!anim) return { root, mesh, clip: null, place, turn };
  // the animation: every frame (as the game plays it), the bones' turns in the turned space
  const inTurn = (q) => turn.clone().multiply(q).multiply(turn.clone().invert());
  const times = [], hips = [], turns = BONES.map(() => []), J0 = new THREE.Vector3().fromArray(rig.joints[BI.pelvis]);
  const last = BONES.map(() => null);
  const frames = [...Array(anim.frames).keys(), anim.loop !== false ? 0 : anim.frames - 1];
  frames.forEach((f, i) => {
    const pose = fullPose(rig, anim, f);
    times.push(i / anim.fps);
    hips.push(...place(...J0.clone().add(pose.root).toArray()).toArray());
    BONES.forEach((_, k) => {
      const q = inTurn(pose.rot[k]);
      if (last[k] && last[k].dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);   // the short way from the frame before
      last[k] = q; turns[k].push(...q.toArray());
    });
  });
  const tracks = [new THREE.VectorKeyframeTrack('pelvis.position', times, hips)];
  BONES.forEach(([n], k) => tracks.push(new THREE.QuaternionKeyframeTrack(n + '.quaternion', times, turns[k])));
  return { root, mesh, clip: new THREE.AnimationClip(anim.name, -1, tracks), place, turn };
}
async function exportGLB() {
  try {
    if (!ST.m || !ST.rig) return;
    status('making the .glb...');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const short = ST.mesh.split('.').pop(), a = ST.anim;
    const materialOf = (slot, flags) => {
      const s = skinMaterial(slot, flags);
      return new THREE.MeshStandardMaterial({ name: short + '_skin' + slot, map: s.map || null, color: s.color, roughness: 1, metalness: 0,
        side: s.side, alphaTest: s.alphaTest, transparent: s.transparent });
    };
    const { root, clip } = characterScene(ST.rig, ST.m, facesBySlot(ST.m), a, materialOf, short);
    const glb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false, animations: clip ? [clip] : [] });
    const file = short + (a ? '_' + a.name : '') + '.glb';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    link.download = file;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
    status(`${file}: open it in Blender (File > Import > glTF 2.0)${a ? ', set the frame rate to ' + a.fps + ' fps' : ''}; Import file brings the animation back.`);
  } catch (e) { status('The export failed: ' + e.message, 'bad'); }
}

// ---------------------------------------------------------------- import
function clipRate(clip) {                    // the frames per second of a clip keyed on every frame (1 to 60), else 15
  const t = clip.tracks.reduce((a, b) => (b.times.length > a.times.length ? b : a), { times: [] }).times;
  if (t.length < 3) return 15;
  const steps = Array.from(t.slice(1), (x, i) => x - t[i]).sort((a, b) => a - b), rate = Math.round(1 / steps[steps.length >> 1]);
  return rate >= 1 && rate <= 60 ? rate : 15;
}
async function importFile(file) {
  try {
    status('reading ' + file.name + '...');
    const motion = await readMotion(file);
    // a file on the Studio's skeleton (Export .glb, also back from Blender) keeps its frame rate; any other: 15 fps
    const fps = BONES.every(([n]) => motion.bones.some((b) => b.name === n)) ? clipRate(motion.clip) : 15;
    if (ST.rig !== ST.rigCurrent) { ST.rig = ST.rigCurrent; buildModel(); }
    const { keys, frames, missing } = retarget(ST.rig, motion, fps, { inPlace: true });
    if (ST.anim && ST.dirty && !confirm('Leave the animation you are editing (unsaved changes)?')) return;
    const used = new Set((ST.list.anims || []).map((a) => a.name.toLowerCase()));
    let name = file.name.replace(/\.[^.]+$/, '').replace(/\W+/g, '_').replace(/^[^A-Za-z]+/, '') || 'Imported';
    name = name.slice(0, 32);
    let n = name, i = 2;
    while (used.has(n.toLowerCase())) n = name + i++;
    ST.anim = { name: n, fps, frames, loop: true, interp: 'linear', source: 'import', file: file.name, made_on: ST.mesh, rig: RIG_VERSION, keys };
    ST.dirty = true;
    showAnim();
    status(`Imported ${file.name}: ${frames} frames at ${fps} fps${missing.length ? ' · not in the file (they follow their parent): ' + missing.join(', ') : ''}. Save to put it in the game.`, missing.length > 4 ? 'warn' : '');
    togglePlay();
  } catch (e) {
    status('Import: ' + e.message, 'bad');
  }
}

// ---------------------------------------------------------------- bake and save
function bakeOn(rig, m, anim) {             // the animation as frames of a model (int16 raw units)
  const out = new Int16Array(anim.frames * m.FV * 3), P = new Float32Array(m.FV * 3);
  for (let f = 0; f < anim.frames; f++) { skin(rig, m, fullPose(rig, anim, f), P); toRaw(m.info, P, out, f * m.FV * 3); }
  return out;
}
function b64(bytes) {
  let s = '';
  const u = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
// bake one animation on the models of a character class (its own and HDTP's), then pack UCAnims.u
async function bakeFor(models, anim, log = status) {
  for (const mesh of models) {
    const m = mesh === ST.mesh && ST.m ? ST.m : await loadModel(mesh);
    const current = mesh === ST.mesh && ST.rigCurrent ? ST.rigCurrent : await rigFor(mesh, m);
    const rig = await rigOfAnim(anim, mesh, current);
    log(`baking ${anim.name} on ${mesh.split('.').pop()}...`);
    const data = bakeOn(rig, m, anim);
    await api('/api/studio_bake', { mesh, name: anim.name, frames: anim.frames, rate: anim.fps, group: 'UCAnim', data: b64(data),
      props: bakeProps(anim, rig, BI, (a, f) => fullPose(rig, a, f), worldOf) });
  }
}
async function save(view) {
  if (!ST.anim || ST.saving) return;
  const a = cloneAnimation(ST.anim), animationId = ST.animationId, cls = ST.cls, models = new Set(ST.models);
  ST.saving = true;
  try {
    status('saving ' + a.name + '...');
    ST.list = (await api('/api/studio_anim', a)).list;
    // every model it was already baked on, and the models of this character
    for (const [mesh, names] of Object.entries(ST.list.baked || {})) if (names.includes(a.name)) models.add(mesh);
    await bakeFor([...models], a);
    status('packing the models for the game...');
    const r = await api('/api/studio_pack', {});
    if (!r.ok) throw new Error((r.lines || ['The animation package could not be built.']).slice(-6).join(' '));
    ST.list = await api('/api/studio');
    const stillCurrent = ST.anim && ST.animationId === animationId;
    if (stillCurrent) { ST.saved = JSON.stringify(a); ST.dirty = JSON.stringify(ST.anim) !== ST.saved; }
    renderLists();
    const msg = $('#as-msg');
    if (msg) msg.innerHTML = r.lines.map(esc).join('<br>');
    status(`${a.name} saved and baked on ${models.size} model(s).`, r.ok ? 'ok' : 'bad');
    if (window.__editor && window.__editor.animsChanged) window.__editor.animsChanged();
    if (view && stillCurrent && !ST.dirty && ST.cls === cls) viewInGame(a);
  } catch (e) {
    status('Save: ' + e.message, 'bad');
  } finally {
    ST.saving = false;
    curveEditor?.refresh();
  }
}
async function viewInGame(a) {
  const E = window.__editor;
  const who = E && (E.baseActors || []).concat(E.added || []).find((x) => x.cls === ST.cls);
  if (!who) { status(`${a.name} is in the game. Give it to a character in its Properties (Animation) to see it there.`, 'ok'); return; }
  E.useStudioAnim(who.name, a.name);
  status(`${a.name} given to ${who.name} (its Properties). Rebuild the map and Play from here to watch it.`, 'ok');
}
// a character of a map uses an animation of the Studio: make sure it is baked on its models
// an animation saved and baked on every model of a character class and on the models it was baked on before,
// then packed for the game: the map's Pose here (map-pose.js) saves through this, without the Studio open
async function store(anim, cls, log = () => {}) {
  const { list } = await api('/api/studio_anim', anim);
  const { models } = await api('/api/studio_models?cls=' + encodeURIComponent(cls));
  const all = new Set(models);
  for (const [mesh, names] of Object.entries(list?.baked || {})) if (names.includes(anim.name)) all.add(mesh);
  await bakeFor([...all], anim, log);
  log('packing the models for the game...');
  const r = await api('/api/studio_pack', {});
  if (!r.ok) throw new Error((r.lines || ['The animation package could not be built.']).slice(-6).join(' '));
  return r;
}
async function ensure(cls, name, log = () => {}) {
  const { models } = await api('/api/studio_models?cls=' + encodeURIComponent(cls));
  const list = await api('/api/studio');
  const todo = models.filter((m) => !(list.baked[m] || []).includes(name));
  if (!todo.length) return false;
  const anim = await api('/api/studio_anim?name=' + encodeURIComponent(name));
  await bakeFor(todo, anim, log);
  log('packing the models for the game...');
  const packed = await api('/api/studio_pack', {});
  if (!packed.ok) throw new Error((packed.lines || ['Animation package build failed.']).slice(-6).join(' '));
  return true;
}
function help() {
  alert(`Animation Studio

Deus Ex animates its characters frame by frame. The Studio gives each model a skeleton found from the game's own animations, so you can:
- play every animation of the game on the character;
- Copy one of them and change it;
- make a new one: pick a bone in the channel list or viewport, turn its rings, move to another frame and pose again. Each bone has independent keys. Space plays, the arrows step frame by frame, K keys the selected bone, Shift+K keys the whole pose, Delete removes only the selected bone's key;
- Import a file: BVH (motion capture), FBX (Mixamo: download "Without skin", or with skin), glTF/GLB.

IK: the buttons L hand, R hand, L foot, R foot turn IK on for an arm or a leg. A box at the hand or foot is then its controller: G moves it and the limb follows, R turns the hand or foot; the diamond (the pole) is where the elbow or knee points. The controller has keys of its own (its row in the list). A foot on IK stays where it is while the body moves. Click the button again to go back to FK: the bones get keys with the IK's poses.

Export .glb: the character, its skeleton and the animation open, for Blender (set the scene to the animation's fps, then File > Import > glTF 2.0) or any program that reads glTF. Animate there, export glTF again and Import file here: the animation comes back as it was made, at its frame rate.

Keys: expand or collapse bone groups, search, or filter to the selected bone. Drag a key to change its frame. Body position is a separate track. Mirror pose and From game > Pose key the whole body.

Props: + Add prop finds bottles, cigarettes and other game objects. Choose In scene for a stationary object beside the character, or Attached to bone for a grip. Placement can be changed later without moving the object; Snap to bone resets the grip. Adjust Position/Offset, Rotation and Scale with numbers or the gizmo. Scene props stay at the actor's starting position during this animation, even while the actor moves. Props are visual only, with no collision or inventory changes, and exist for the duration of the animation. Save and Rebuild to use them in game. Pickup/drop keys are not supported yet.

Graph: show or hide it beside the playback controls; Ctrl+Space (or Maximize) fills the Studio with it. Pick a bone and click its curves to edit X/Y/Z rotation, or select Body position. Existing game-frame poses are retained when curves are enabled. The eyes hide curves only; they never mute motion. Select and drag keys, or enter Frame and Value. Smooth eases between poses, Linear keeps a constant speed, Hold keeps a pose until the next key. Fit frames the curve; the mouse wheel zooms. Ctrl+Z undoes; Ctrl+Shift+Z or Ctrl+Y redoes.

Save bakes it into frames of the model for the game (the original model and the HDTP one), in UCAnims.u. Then in the map, a character's Properties > Animation > When idle: your animation.

Skeleton: every human has the same 17 bones, with the joints where a body has them (shoulders, elbows, hips, knees, ankles at their usual heights) fitted to the model's own motion; children are the same, smaller. The hands start where the skin of the wrist begins. Animations made before keep their old skeleton (hand and forearm together).

Numbers: hold a label (X, Y, Z, Scale, Frames...) and drag left or right; a faster mouse makes bigger steps, Shift is fine, Esc puts it back.

Keys (as Blender): G move (the body, or a prop), R rotate, S scale (props), Alt+G / Alt+R / Alt+S reset; I key the bone, Shift+I the pose, Alt+I or X delete the key; Up / Down next and previous key, Shift+Left / Right first and last frame; Ctrl+C / Ctrl+V copy and paste a pose (Ctrl+Shift+V mirrored); F or Numpad . look at the selection; Numpad 1 / 3 / 7 front, right and top (Ctrl: the other side). In the Graph: A select all, Alt+A none, G move keys (click or Enter places them), X delete, Shift+D duplicate, I add a key, T easing, Home fit, F fit selected.

Navigation: MMB orbit, Shift+MMB pan, Ctrl+MMB or wheel zoom; Numpad 2/4/6/8 orbit (Ctrl pans), 5 perspective/orthographic, 9 opposite view, +/− zoom. Home over the viewport frames everything; Numpad . or F frames the selection. Shift+Backquote enters walk: mouse looks, WASD moves, Q/E down/up, Shift faster, click or Enter confirms, Esc/right-click restores the view.

Inbetween: put the playhead between two keys, choose Inbetween, adjust Weight toward the previous or next pose, then Create key. Selected control and Whole pose support FK and IK; Cancel changes nothing and Undo restores the previous animation.

Graph follows the selected bone or IK controller. IK offers Position, Rotation and Pole curves. Previous/next key shortcuts can be changed under Settings > Keyboard shortcuts > Animation Studio.

An animation works on every human character: the Studio bakes it on the models of the characters that use it.`);
}

window.__studio = { open, close, ensure, store, rigFor, RIG_VERSION, retarget, autoRig, loadModel, poseAt, editAnim, get state() { return ST; },
  // for tests and videos: the skeleton's own functions, to make poses and keys from a script
  kit: { THREE, BONES, BI, PARENT, worldOf, poseFromFrame, restPose, keyOf, setPose, setFrame, afterEdit, newAnim, showAnim, framePos,
    selectBone, renderPanel, drawKeys, togglePlay, stopPlay, save, legacyPoseAt, curvesFromMotion, rotationValues,
    enableCurves, graphState, historyStep, beginEdit, commitEdit, cancelEdit, bakeOn, bakeProps, inbetweenAnimation, openInbetweener, gotoKey,
    writePoseKeys, channelFrames, removeChannelKey, moveChannelKeys, resizeAnimation, deleteKey, selectChannel, setGraphVisible,
    selectProp, propFromHandle, moveMode, clearTransform, copyPose, pastePose, toggleGraphMax, frameSelected, frameAll, viewFrom,
    gripsOf, setGripKey, gripAt, handSide,
    CHAINS, setIK, selectIK, ikFromHandle, ikFromPose, solveIK, fullPose, sampleIK, writeIKKey, ikCurveGroup, setGraphTarget, previewGraph, characterScene, facesBySlot, exportGLB, skin, seamsOf,
    get gizmo() { return gizmo; }, get handle() { return handle; }, get camera() { return camera; }, get orbit() { return orbit; }, get curveEditor() { return curveEditor; } },
  // for tests and videos: the camera at an angle around the model (degrees from the front), at a distance (heights)
  // (bone: the joint looked at, where the pose has it; the hips by default)
  view(deg = 0, dist = 1.9, up = 0.15, bone = 0) {
    const H = ST.rig.H, a = deg * Math.PI / 180;
    const c = bone && ST.pose ? worldOf(ST.rig, ST.pose).Jw[bone].clone() : new THREE.Vector3().fromArray(ST.rig.joints[0]);
    orbit.target.copy(c);
    camera.position.set(c.x + Math.cos(a) * H * dist, c.y + up * H, c.z + Math.sin(a) * H * dist);
  } };
