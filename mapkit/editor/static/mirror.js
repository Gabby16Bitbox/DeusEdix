// Mirror X / Y / Z (UnrealEd's Transform > Mirror): the selection mirrored about its middle along one of the game's
// axes (0 x, 1 y, 2 z). Arithmetic on the edits' own numbers: places in world units, rotators [pitch, yaw, roll] in
// 65536ths of a turn as geom.rotation_matrix reads them (R: the thing's own axes in the world). app.js applies it to
// the selection; tests/test_mirror.py checks it against what the build makes of the same numbers (geom.py).
import { blockPoints, blockVerts } from './block-shapes.js';

const TURN = 65536, HALF = TURN / 2;
const signed = (v) => { const r = ((Math.round(v) % TURN) + TURN) % TURN; return r > HALF ? r - TURN : r; };
// as the editor writes a rotator (rotation.js): pitch and roll signed, yaw 0..65535
const rotator = ([p, y, r]) => [signed(p), ((Math.round(y) % TURN) + TURN) % TURN, signed(r)];

// A mirror M is not a turn, so a turned thing R takes its mirror image in one of two ways, each a turn again:
// - MIRRORED, M R M: its own shape mirrored on the same axis of its own (a block with its own corners, a drawing);
//   when the shape is alike on both sides of that axis (a cube, a cylinder across its height) that is all it takes.
// - FACING, M R Y (Y: its own left-right mirror): its shape as it is, when its left and its right are alike. Every
//   block shape of the editor is (a wedge is high at +X on both sides) and so is every model as the game draws it
//   (they face +X): it then faces the mirrored way and keeps its up (mirrored on Z it hangs the other way up).
// Both written as what they do to the rotator: the signs of [pitch, yaw, roll] and a half turn added.
// tests/test_mirror.py derives them from geom.rotation_matrix.
const MIRRORED = [
  { sign: [-1, -1, 1], add: [0, 0, 0] },        // x
  { sign: [1, -1, -1], add: [0, 0, 0] },        // y
  { sign: [-1, 1, -1], add: [0, 0, 0] },        // z
];
const FACING = [
  { sign: [1, -1, -1], add: [0, HALF, 0] },     // x: it looks back across the mirror
  { sign: [1, -1, -1], add: [0, 0, 0] },        // y: the same as MIRRORED (Y is that mirror)
  { sign: [-1, 1, -1], add: [0, 0, HALF] },     // z: upside down
];
const apply = (t, rot = [0, 0, 0]) => rotator([0, 1, 2].map((k) => t.sign[k] * (+rot[k] || 0) + t.add[k]));

export const mirrorTurn = (rot, axis) => apply(MIRRORED[axis], rot);
export const faceMirrored = (rot, axis) => apply(FACING[axis], rot);

// as the editor keeps places: to a tenth of a unit
export function mirrorPoint(p, axis, about) {
  return p.map((v, k) => (k === axis ? Math.round((2 * about[k] - v) * 10) / 10 : v));
}

// is the block's shape the same on both sides of its own axis k? (a wedge is not across X, a cone not across Z)
function alikeAcross(b, k) {
  const pts = blockPoints({ ...b, hollow: 0 });         // a hollow shape's outside is the solid one's
  if (!pts) return true;                                // water, portals, moving blocks and signs: boxes
  const near = (p, q) => Math.abs(p[0] - q[0]) < 0.01 && Math.abs(p[1] - q[1]) < 0.01 && Math.abs(p[2] - q[2]) < 0.01;
  return pts.every((p) => { const q = p.map((v, i) => (i === k ? -v : v)); return pts.some((r) => near(q, r)); });
}

// a block: {lo, hi, rot} where its mirror image is, and its corners (Edit vertices) mirrored when it has its own;
// a sign keeps its text readable, on the face that is now on the other side
export function mirrorBlock(b, axis, about) {
  const mid = [0, 1, 2].map((k) => (b.lo[k] + b.hi[k]) / 2), to = mirrorPoint(mid, axis, about);
  const out = { lo: b.lo.map((v, k) => v + to[k] - mid[k]), hi: b.hi.map((v, k) => v + to[k] - mid[k]) };
  const own = blockVerts(b);
  if (own) {
    out.rot = mirrorTurn(b.rot, axis);
    out.verts = own.map((f) => f.map((v, k) => (k === axis ? 1 - v : v)));
  } else if (alikeAcross(b, axis)) {
    out.rot = mirrorTurn(b.rot, axis);
    if (b.sign && b.sign.face[1] === 'xyz'[axis]) out.sign = { ...b.sign, face: (b.sign.face[0] === '+' ? '-' : '+') + b.sign.face[1] };
  } else {
    out.rot = faceMirrored(b.rot, axis);
  }
  return out;
}

// a drawing (Tools > Draw ...): its points mirrored and its turn with them. Mirrored on Z it would hang under its
// floor, so that axis is not offered (null). Stairs that curve or wind turn the other way.
export function mirrorDrawing(d, axis, about) {
  if (axis === 2) return null;
  const out = { pts: d.pts.map(([x, y]) => { const q = mirrorPoint([x, y, 0], axis, about); return [q[0], q[1]]; }) };
  if (d.rot) out.rot = mirrorTurn(d.rot, axis);
  if (d.kind === 'stairs') out.turn = d.turn === 'right' ? 'left' : 'right';
  return out;
}

// an animation (edits.motions[name], editor/motions.py): its moves are offsets in the world, its turns are added to
// the rotator (UCMotion: BaseRot + r, a mover's KeyRot), so they take the signs of the turn the thing took: a moving
// block is a box (mirrored as itself), an object faces the mirrored way
export function mirrorMotion(m, axis, isBlock) {
  const sign = (isBlock ? MIRRORED : FACING)[axis].sign, out = { ...m };
  const keys = (track, f) => track.map((k) => (Array.isArray(k?.v) ? { ...k, v: k.v.map(f) } : k));
  if (Array.isArray(m.pos)) out.pos = keys(m.pos, (v, i) => (i === axis ? -v : v));
  if (Array.isArray(m.rot)) out.rot = keys(m.rot, (v, i) => sign[i] * v);
  return out;
}
