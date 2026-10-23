// Drop to floor / Stick to surface (the Drop button's menu, the right-click menu, Edit menu; End does the
// mode chosen last). Stick to surface sends the object toward the surface behind it as the camera sees it
// (the ray from the camera through the object: what you see behind the object is where it goes; when
// nothing is there, behind its own back), up to the first wall, floor, door or other object, and turns it so
// its back sits flush on that surface: its front (Unreal +X) along the surface's normal. Pure maths here
// (Unreal units: yaw and pitch 65536 a turn); app.js does the rays (tests/test_effect_point.mjs).

export const PLACE_MODES = [['drop', 'Drop to floor'], ['stick', 'Stick to surface']];
const KEY = 'deusedix.placeMode';
export function loadPlaceMode(storage) {
  try { const v = storage && storage.getItem(KEY); return v === 'stick' ? 'stick' : 'drop'; } catch (e) { return 'drop'; }
}
export function savePlaceMode(storage, mode) {
  try { if (storage) storage.setItem(KEY, mode === 'stick' ? 'stick' : 'drop'); } catch (e) { /* no storage */ }
}
export const placeModeLabel = (m) => (PLACE_MODES.find((x) => x[0] === m) || PLACE_MODES[0])[1];

const TURN = 65536;
export const signedRot = (v) => { const r = ((Math.round(v) % TURN) + TURN) % TURN; return r > TURN / 2 ? r - TURN : r; };

// a surface's normal (Unreal x, y, z) -> the rotation whose front points along it; on a floor or a ceiling
// (no side to face) the yaw stays the one it had
export function normalToRotation(n, keepYaw = 0) {
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  const x = n[0] / len, y = n[1] / len, z = n[2] / len, flat = Math.hypot(x, y);
  const yaw = flat < 0.02 ? ((Math.round(keepYaw) % TURN) + TURN) % TURN : ((Math.round(Math.atan2(y, x) * TURN / (2 * Math.PI)) % TURN) + TURN) % TURN;
  return { pitch: signedRot(Math.atan2(z, flat) * TURN / (2 * Math.PI)), yaw };
}
// the front of a rotation (Unreal): pitch up, yaw round
export function rotationToVector(pitch, yaw) {
  const p = pitch * 2 * Math.PI / TURN, y = yaw * 2 * Math.PI / TURN;
  return [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)];
}
// where its pivot goes: the point hit, out along the normal by the depth of its back (+ a hair)
export function stickPoint(hit, n, back, gap = 0.5) {
  const len = Math.hypot(n[0], n[1], n[2]) || 1, d = Math.max(0, back) + gap;
  return [0, 1, 2].map((k) => Math.round((hit[k] + n[k] / len * d) * 10) / 10);
}
// a floor (its top faces up): the game's decorations stay up by themselves only there
export const isFloor = (n) => n[2] / (Math.hypot(n[0], n[1], n[2]) || 1) > 0.7;
