// Grip: how far each hand is closed (0 open, 1 closed), keyed like a bone on its own timeline row ('grip:l', 'grip:r').
// The game's models have about ten vertices a hand and no fingers of their own, so a finger skeleton would tear
// them. The closing comes from the game itself: in a model's own animations its hands change shape in one way
// (87-93% of the change, Studio bench 18 Oct 2026), the rifle gripped in Walk2H/Strafe2H at one end, the hand
// relaxed in Tread/SitBreathe at the other; that change, measured in the hand's own frame, is the grip. HDTP's
// hands never change shape in their animations: their fingers fold round the knuckles instead.
// anim.grip = {l: {keys: [{f, v: [0..1], mode}]}, r: ...}; no keys: the hand as the bones carry it (as before).
import * as THREE from 'three';
import { sampleTrack } from './studio-tracks.js';

export const GRIP_SIDES = ['l', 'r'];
export const gripChannel = (s) => 'grip:' + s;
export const gripSide = (name) => (/^grip:[lr]$/.test(name) ? name.slice(5) : null);

// ---------------------------------------------------------------- the animation's grip keys
export function gripKeys(anim, s) { return anim?.grip?.[s]?.keys || []; }
export function gripAt(anim, s, f) {
  const keys = gripKeys(anim, s);
  return keys.length ? Math.max(0, Math.min(1, sampleTrack({ keys }, f, anim, '$root')[0])) : null;
}
export function setGripKey(anim, s, f, v, mode) {
  const keys = gripKeys(anim, s).filter((k) => k.f !== f), old = gripKeys(anim, s).find((k) => k.f === f);
  const previous = gripKeys(anim, s).filter((k) => k.f <= f).at(-1);
  keys.push({ f, v: [+Math.max(0, Math.min(1, v)).toFixed(3)], mode: mode || old?.mode || previous?.mode || 'smooth' });
  anim.grip = Object.assign(anim.grip || {}, { [s]: { keys: keys.sort((a, b) => a.f - b.f) } });
}
export function removeGripKey(anim, s, f) {
  const keys = gripKeys(anim, s);
  if (!keys.some((k) => k.f === f)) return false;
  anim.grip[s].keys = keys.filter((k) => k.f !== f);          // the last one too: the hand goes back to the bones
  return true;
}
export function moveGripKey(anim, s, from, to) {
  const keys = gripKeys(anim, s);
  if (from === to || !keys.some((k) => k.f === from)) return false;
  if (keys.some((k) => k.f === to)) throw new Error(`A key already occupies frame ${to + 1}.`);
  anim.grip[s].keys = keys.map((k) => (k.f === from ? { ...k, f: to } : k)).sort((a, b) => a.f - b.f);
  return true;
}
export function trimGrip(anim, frames) {
  for (const s of GRIP_SIDES) if (anim.grip?.[s]) anim.grip[s].keys = anim.grip[s].keys.filter((k) => k.f < frames);
}

// ---------------------------------------------------------------- the hands' shapes of a model
// shapes(rig, m): {l, r}: {idx: vertex numbers, dir: offset per vertex (rest space) from open to closed,
// rest: the grip of the rest pose (where the offset is nothing), by: 'game' | 'fingers'}
const cache = new WeakMap();
export function gripShapes(rig, m, framePos, BI, bodyFrames) {
  let byModel = cache.get(rig);
  if (!byModel) cache.set(rig, (byModel = new WeakMap()));
  if (!byModel.has(m)) byModel.set(m, measure(rig, m, framePos, BI, typeof bodyFrames === 'function' ? bodyFrames() : bodyFrames));
  return byModel.get(m);
}
function measure(rig, m, framePos, BI, bodyFrames) {
  const P = framePos(m, rig.ref), out = {};
  for (const s of GRIP_SIDES) {
    const b = BI[s + '_hand'], idx = [];
    rig.weights.forEach((w, i) => { if (w[0] === b && w[1] >= 0.99) idx.push(i); });
    if (idx.length < 3) { out[s] = null; continue; }
    out[s] = fromGame(P, idx, bodyFrames.map((f) => framePos(m, f))) || fingers(rig, P, idx, BI, s);
  }
  return out;
}
// the main change of the hand's shape in the game's frames (after taking out the hand's own move and turn)
function fromGame(P, idx, Ys) {
  const n = idx.length * 3, D = [];
  for (const Y of Ys) {
    const { q, t } = fit(P, Y, idx), qi = q.clone().invert(), d = new Float64Array(n), v = new THREE.Vector3();
    idx.forEach((i, k) => {
      v.set(Y[3 * i], Y[3 * i + 1], Y[3 * i + 2]).sub(t).applyQuaternion(qi);
      d[3 * k] = v.x - P[3 * i]; d[3 * k + 1] = v.y - P[3 * i + 1]; d[3 * k + 2] = v.z - P[3 * i + 2];
    });
    D.push(d);
  }
  if (D.length < 8) return null;
  const mean = new Float64Array(n);
  for (const d of D) for (let j = 0; j < n; j++) mean[j] += d[j] / D.length;
  let pc = new Float64Array(n).map((_, j) => Math.sin(j * 12.9898 + 1) || 0.1);            // deterministic start
  for (let it = 0; it < 80; it++) {
    const nx = new Float64Array(n);
    for (const d of D) { let c = 0; for (let j = 0; j < n; j++) c += (d[j] - mean[j]) * pc[j]; for (let j = 0; j < n; j++) nx[j] += c * (d[j] - mean[j]); }
    const len = Math.hypot(...nx) || 1;
    pc = nx.map((x) => x / len);
  }
  let total = 0;
  for (const d of D) for (let j = 0; j < n; j++) total += (d[j] - mean[j]) ** 2;
  const c = D.map((d) => { let x = 0; for (let j = 0; j < n; j++) x += (d[j] - mean[j]) * pc[j]; return x; }).sort((a, b) => a - b);
  const lo = c[Math.floor(c.length * 0.03)], hi = c[Math.floor(c.length * 0.97)];
  // a hand that never changes (HDTP), or barely (under a tenth of a unit): no grip from the game
  if (Math.sqrt(total / D.length / idx.length) < 0.1 || hi - lo < 0.3) return null;
  // which end is closed: there the hand is smaller round its own centre (the fingers folded in)
  const extent = (cv) => {
    const pts = idx.map((i, k) => [0, 1, 2].map((a) => P[3 * i + a] + mean[3 * k + a] + cv * pc[3 * k + a]));
    const o = [0, 1, 2].map((a) => pts.reduce((s, p) => s + p[a], 0) / pts.length);
    return pts.reduce((s, p) => s + Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]), 0);
  };
  const [open, closed] = extent(lo) > extent(hi) ? [lo, hi] : [hi, lo];
  // the offset along the change only, nothing at the rest frame's own grip: an animation without grip keys and
  // one keyed at that grip look the same
  let c0 = 0;
  for (let j = 0; j < n; j++) c0 -= mean[j] * pc[j];
  const span = closed - open;
  return { by: 'game', idx, dir: Float32Array.from(pc, (x) => x * span), rest: Math.max(0, Math.min(1, (c0 - open) / span)) };
}
// HDTP: the fingers fold round the knuckles, towards the palm (the side of the body, as the arms hang at rest)
function fingers(rig, P, idx, BI, s) {
  const J = (name) => new THREE.Vector3().fromArray(rig.joints[BI[name]]);
  const W = J(s + '_hand'), T = new THREE.Vector3().fromArray(rig.tails[BI[s + '_hand']]);
  const a = T.clone().sub(W), L = a.length();
  if (L < 1e-3) return null;
  a.normalize();
  const towards = J('pelvis').sub(W);
  const palm = towards.sub(a.clone().multiplyScalar(towards.dot(a)));
  if (palm.lengthSq() < 1e-6) return null;
  palm.normalize();
  const hinge = a.clone().cross(palm).normalize(), knuckle = 0.45 * L;
  const dir = new Float32Array(idx.length * 3), v = new THREE.Vector3(), q = new THREE.Quaternion();
  const pivot = W.clone().addScaledVector(a, knuckle);
  idx.forEach((i, k) => {
    v.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    const t = v.clone().sub(W).dot(a);
    if (t <= knuckle) return;
    const ang = THREE.MathUtils.degToRad(70) * Math.min(1, (t - knuckle) / Math.max(1e-3, L - knuckle));
    const moved = v.clone().sub(pivot).applyQuaternion(q.setFromAxisAngle(hinge, ang)).add(pivot);
    dir[3 * k] = moved.x - v.x; dir[3 * k + 1] = moved.y - v.y; dir[3 * k + 2] = moved.z - v.z;
  });
  return { by: 'fingers', idx, dir, rest: 0 };
}
// rigid fit of the hand vertices (rotation by Horn's method through small steps, as the bench measured)
function fit(P, Y, idx) {
  let cx = 0, cy = 0, cz = 0, dx = 0, dy = 0, dz = 0;
  for (const i of idx) { cx += P[3 * i]; cy += P[3 * i + 1]; cz += P[3 * i + 2]; dx += Y[3 * i]; dy += Y[3 * i + 1]; dz += Y[3 * i + 2]; }
  const n = idx.length; cx /= n; cy /= n; cz /= n; dx /= n; dy /= n; dz /= n;
  let norm = 0;
  for (const i of idx) norm += (P[3 * i] - cx) ** 2 + (P[3 * i + 1] - cy) ** 2 + (P[3 * i + 2] - cz) ** 2;
  let q = new THREE.Quaternion();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), w = new THREE.Vector3();
  for (let it = 0; it < 30; it++) {
    w.set(0, 0, 0);
    for (const i of idx) {
      a.set(P[3 * i] - cx, P[3 * i + 1] - cy, P[3 * i + 2] - cz).applyQuaternion(q);
      b.set(Y[3 * i] - dx, Y[3 * i + 1] - dy, Y[3 * i + 2] - dz);
      w.add(a.cross(b));
    }
    w.multiplyScalar(1 / Math.max(1e-6, norm));
    const ang = w.length();
    if (ang < 1e-7) break;
    q = new THREE.Quaternion().setFromAxisAngle(w.normalize(), ang).multiply(q);
  }
  const c = new THREE.Vector3(cx, cy, cz).applyQuaternion(q);
  return { q, t: new THREE.Vector3(dx - c.x, dy - c.y, dz - c.z) };
}

// the rest positions with the hands closed as the pose says: a copy of P, or P itself when no hand is keyed
export function gripRest(P, shapes, grip) {
  if (!shapes || !grip || (grip.l == null && grip.r == null)) return P;
  const out = Float32Array.from(P);
  for (const s of GRIP_SIDES) {
    const g = grip[s], sh = shapes[s];
    if (g == null || !sh) continue;
    const k = g - sh.rest;
    sh.idx.forEach((i, j) => { out[3 * i] += sh.dir[3 * j] * k; out[3 * i + 1] += sh.dir[3 * j + 1] * k; out[3 * i + 2] += sh.dir[3 * j + 2] * k; });
  }
  return out;
}
