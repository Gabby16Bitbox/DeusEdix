// Walking legs under a body animation (Gabby, 14 Nov 2026: "if the animation does not touch the legs, they move with
// the default one"). A rule's "Play a body animation" with "may keep walking" played a gesture on a character that
// walked on: the gesture has no leg motion, so it slid along with its legs still.
//
// Deus Ex animates its characters frame by frame (vertices, no bones), so the game cannot mix the arms of one
// sequence with the legs of another while it plays. The editor makes the mix beforehand, on the Studio's skeleton
// of the model: for a sequence A whose legs stay still (legsOf), the sequences A_W<n> (over Walk) and A_R<n> (over
// Run). In them the hips and the legs are the walk's own frames, and everything above them is A's own frames, carried
// by the walk's hips: the walk's bobbing and swaying (half of its turn), not A's. A vertex shared by the belly and the
// hips is mixed by its share of the two. Nothing of A or of the walk is refitted: their frames are used as they are.
//
// The legs keep their own pace: the mix repeats A n times (n, 1 to 4, the suffix of its name) to fit a whole number
// of strides, so a loop has no jump and the legs go at most about 12% faster or slower than the walk's.
// UCAnimSet (the game) plays A_W<n> or A_R<n> instead of A while the character moves, at the same place in A, and
// stops a "once" after the first of the n.
//
// Pure: the Studio's kit (THREE, BI, poseFromFrame, framePos) is passed in (window.__studio.kit in the page).

export const LEG_BONES = ['l_thigh', 'l_calf', 'l_foot', 'r_thigh', 'r_calf', 'r_foot'];
export const LOWER_BONES = ['pelvis', ...LEG_BONES];
// measured on GM_Trench, GM_Jumpsuit, GFM_SuitSkirt (14 Nov 2026): gestures, PushButton, RubEyes, Reload, Shoot
// turn a leg bone by 0-16 degrees within the sequence; Dance 21, Idle1 25, Walk and Run 40-90
export const LEGS_MAX_TURN = 18;
// the hips lower than standing (sitting 14-23, crouching 21-28, swimming about 50; shooting with a rifle about 9),
// or bobbing within the sequence (a walk about 1, a run about 6; gestures 0-1)
export const HIPS_MAX_DROP = 10, HIPS_MAX_BOB = 3;
export const LAYERS = [['Walk', 'W'], ['Run', 'R']];
export const MAX_REPEATS = 4, PACE_SLACK = 0.12;
// the hips' turn of the walk the body above them takes (all of it would turn the shoulders with the hips)
export const SWAY_SHARE = 0.5;

const findSeq = (m, name) => m.seqs.find((s) => s.name.toLowerCase() === String(name).toLowerCase()) || null;
export { findSeq };

// how much a sequence moves the legs: {free, turn (degrees), drop, bob (units of the model)}
export function legsOf(kit, rig, m, seq) {
  const legs = LEG_BONES.map((n) => kit.BI[n]);
  const p0 = kit.poseFromFrame(rig, m, seq.start);
  let turn = 0, low = Infinity, high = -Infinity;
  for (let f = 0; f < seq.frames; f++) {
    const p = f ? kit.poseFromFrame(rig, m, seq.start + f) : p0;
    for (const b of legs) turn = Math.max(turn, p.rot[b].angleTo(p0.rot[b]) * 180 / Math.PI);
    low = Math.min(low, p.root.y); high = Math.max(high, p.root.y);
  }
  const drop = Math.max(0, -low), bob = high - low;
  return { free: turn <= LEGS_MAX_TURN && drop <= HIPS_MAX_DROP && bob <= HIPS_MAX_BOB,
    turn: Math.round(turn), drop: +drop.toFixed(1), bob: +bob.toFixed(1) };
}

// how many times A is repeated (n) over how many strides (k), and the frames of the mix: the fewest repeats whose
// pace is within PACE_SLACK of the walk's, else the closest
export function layerPlan(a, l) {
  const tA = a.frames / a.rate, tL = l.frames / l.rate;
  let best = null;
  for (let n = 1; n <= MAX_REPEATS; n++) {
    const k = Math.max(1, Math.round(n * tA / tL)), off = Math.abs(k * tL / (n * tA) - 1);
    if (!best || off < best.off - 1e-9) best = { n, k, off };
    if (off <= PACE_SLACK) { best = { n, k, off }; break; }
  }
  const per = Math.max(a.frames, Math.ceil(best.k * l.frames / best.n));    // frames of each repeat
  const frames = best.n * per;
  return { repeats: best.n, strides: best.k, frames, per, rate: frames / (best.n * tA), pace: +(1 + best.off).toFixed(3) };
}

// each vertex's share on the hips and the legs (rig.weights: [bone1, weight1, bone2, weight2])
export function lowerShares(kit, rig) {
  const lower = new Set(LOWER_BONES.map((n) => kit.BI[n]));
  return Float32Array.from(rig.weights, ([b1, w1, b2, w2]) => (lower.has(b1) ? w1 : 0) + (w2 > 0 && lower.has(b2) ? w2 : 0));
}

// the hips at a frame: their turn (quaternion) and their joint (where the skeleton has them in that frame)
function hipsAt(kit, rig, m, f) {
  const p = kit.poseFromFrame(rig, m, f);
  return { q: p.rot[kit.BI.pelvis].clone(), j: new kit.THREE.Vector3().fromArray(rig.joints[kit.BI.pelvis]).add(p.root) };
}

// a sequence's vertices and hips at a fractional frame (looped: after the last frame comes the first)
function sampler(kit, rig, m, seq) {
  const hips = [];
  for (let f = 0; f < seq.frames; f++) hips.push(hipsAt(kit, rig, m, seq.start + f));
  const FV = m.FV, P = new Float32Array(FV * 3), THREE = kit.THREE;
  return (x) => {
    const i = Math.floor(x) % seq.frames, j = (i + 1) % seq.frames, t = x - Math.floor(x);
    const a = kit.framePos(m, seq.start + i), b = kit.framePos(m, seq.start + j);
    for (let v = 0; v < FV * 3; v++) P[v] = a[v] + (b[v] - a[v]) * t;
    return { P, q: hips[i].q.clone().slerp(hips[j].q, t), j: hips[i].j.clone().lerp(hips[j].j, t), THREE };
  };
}

// the mix of A over a walk L: {plan, data: Float32Array frames x FV x 3 (three.js positions, as framePos)}
export function layerFrames(kit, rig, m, a, l) {
  const plan = layerPlan(a, l), FV = m.FV, THREE = kit.THREE;
  const share = lowerShares(kit, rig), atA = sampler(kit, rig, m, a), atL = sampler(kit, rig, m, l);
  const data = new Float32Array(plan.frames * FV * 3);
  const I = new THREE.Quaternion(), R = new THREE.Quaternion(), v = new THREE.Vector3();
  for (let f = 0; f < plan.frames; f++) {
    const A = atA((f % plan.per) * a.frames / plan.per);
    const Ap = A.P.slice(), qA = A.q, jA = A.j;
    const L = atL(f * plan.strides * l.frames / plan.frames);
    // A's body above the hips carried from A's hips to the walk's (their place, and a share of their turn)
    R.copy(I).slerp(L.q.clone().multiply(qA.clone().invert()), SWAY_SHARE);
    const out = data.subarray(f * FV * 3, (f + 1) * FV * 3);
    for (let i = 0; i < FV; i++) {
      v.set(Ap[3 * i], Ap[3 * i + 1], Ap[3 * i + 2]).sub(jA).applyQuaternion(R).add(L.j);
      const w = share[i];
      out[3 * i] = L.P[3 * i] * w + v.x * (1 - w);
      out[3 * i + 1] = L.P[3 * i + 1] * w + v.y * (1 - w);
      out[3 * i + 2] = L.P[3 * i + 2] * w + v.z * (1 - w);
    }
  }
  return { plan, data };
}

// the name of a mix in the model: GestureBoth_W2 (its repeats last, read back by UCAnimSet)
export const layerName = (a, letter, repeats) => `${a}_${letter}${repeats}`;
// a name the game takes (anims.py _name_ok: a letter, then letters, digits and _, 41 at most)
export const layerNameOk = (name) => /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name);
