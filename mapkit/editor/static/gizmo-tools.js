// The gizmo's choices and Aim at a point, without the page (app.js does the rays and drives the gizmo), as
// Unity's: where a group's gizmo sits (Center / Pivot, Z), which way its handles point (Global / Local, X),
// the steps of a snapped move in Local, and the turn that makes an object look at a point (its look-at).
import { normalToRotation } from './surface-stick.js';

// the 3D view toolbar's two toggles: their options in turn (the first is the default), the preference that
// keeps the choice (Settings, menubar.js), the key, its name, and what each option does (tooltip, status bar)
export const GIZMO_CHOICES = {
  pivot: { pref: 'gizmoPivot', key: 'Z', name: 'Gizmo pivot', options: [
    { id: 'center', label: 'Center', tip: 'a group turns and scales about the middle of its bounds' },
    { id: 'pivot', label: 'Pivot', tip: 'a group turns and scales about the pivot of the last object picked' }] },
  space: { pref: 'gizmoSpace', key: 'X', name: 'Gizmo axes', options: [
    { id: 'global', label: 'Global', tip: "the handles point along the map's axes" },
    { id: 'local', label: 'Local', tip: "the handles follow the object's own turn (a group's: the last object picked); a snapped move goes in grid steps from where it was" }] },
};
const ids = (name) => GIZMO_CHOICES[name].options.map((o) => o.id);
// a kept value as it can be used: an unknown one (an old or edited preference) is the default
export const gizmoChoice = (name, value) => (ids(name).includes(value) ? value : ids(name)[0]);
export const nextGizmoChoice = (name, value) => { const all = ids(name); return all[(all.indexOf(gizmoChoice(name, value)) + 1) % all.length]; };
export const gizmoOption = (name, value) => GIZMO_CHOICES[name].options.find((o) => o.id === gizmoChoice(name, value));

// Where a group's gizmo sits. items: each member as {at: its pivot, lo, hi: its bounds when it has some}
// (any one frame of axes); 'center' the middle of all their bounds, 'pivot' the pivot of the last one.
export function groupPivotAt(mode, items) {
  if (!items.length) return null;
  if (gizmoChoice('pivot', mode) === 'pivot') return [...items[items.length - 1].at];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const it of items) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], (it.lo || it.at)[k]);
    hi[k] = Math.max(hi[k], (it.hi || it.at)[k]);
  }
  return lo.map((v, k) => (v + hi[k]) / 2);
}

// a Local move's offset (in the object's own axes) in whole grid steps: Unity's incremental snap
export const snapSteps = (offset, step) => offset.map((v) => Math.round(v / step) * step || 0);

// What tips up or down to look at a point, by the kind of object (tagCategory in app.js): what shines or
// watches along its front. The rest turns about the vertical only and stays standing (characters, the
// player start, AI path points, furniture, items).
export const AIM_TILTS = new Set(['light', 'camera', 'effectpoint']);

// The rotation [pitch, yaw, roll] (Unreal, 65536 a turn) whose front (+X) looks from `from` at `to`
// (Unreal x, y, z). level: only the yaw turns and its pitch stays. Its roll always stays (it turns about the
// front). null when there is no way to look: the point is its own place, or straight above or below a level one.
export function aimRotation(from, to, rot = [0, 0, 0], level = false) {
  const d = [0, 1, 2].map((k) => to[k] - from[k]), flat = Math.hypot(d[0], d[1]);
  if (Math.hypot(flat, d[2]) < 1 || (level && flat < 1)) return null;
  const r = normalToRotation(d, rot[1] || 0);
  return [level ? rot[0] || 0 : r.pitch, r.yaw, rot[2] || 0];
}
