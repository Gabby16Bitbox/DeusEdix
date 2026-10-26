// The 3D view's camera without the page (app.js moves it, view-axes.js draws the axis widget), as Unity's scene
// view: turning about a point (Alt+drag) and going toward it (Alt+right drag), the fly speed's steps (the wheel
// while flying), Frame's flight and its second, closer press (F twice), the field of view and the near and far
// planes (Settings > Camera), the views from the ends of an axis and where the camera faces in the game's units.
// Three.js space throughout: y up; Unreal's X is x, Y is z, Z is y. yaw, pitch: the camera's (app.js cam), radians.

// how far the view tips up or down: mouse look, an orbit, the views from above and below
export const PITCH_LIMIT = 1.5;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const add = (a, b) => a.map((v, k) => v + b[k]);
const sub = (a, b) => a.map((v, k) => v - b[k]);
const scale = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a) => Math.hypot(a[0], a[1], a[2]);

// where the camera looks, and its right (level: the camera has no roll)
export const lookDir = (yaw, pitch) => [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
const rightOf = (yaw) => [-Math.sin(yaw), 0, Math.cos(yaw)];

// v turned by `angle` about the unit axis `axis` (Rodrigues)
function turnAbout(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), k = dot(axis, v) * (1 - c);
  const cross = [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]];
  return v.map((x, i) => x * c + cross[i] * s + axis[i] * k);
}

// Alt+drag: the camera turns by dyaw, dpitch (the mouse look's own directions) and goes round `pivot` with the view,
// so the pivot keeps its place on the screen. pos, pivot: [x, y, z]. The pitch stops at PITCH_LIMIT.
export function orbitStep(pos, pivot, yaw, pitch, dyaw, dpitch) {
  const tipped = clamp(pitch + dpitch, -PITCH_LIMIT, PITCH_LIMIT), turned = yaw + dyaw;
  const [x, y, z] = sub(pos, pivot), c = Math.cos(dyaw), s = Math.sin(dyaw);
  const level = [x * c - z * s, y, x * s + z * c];                        // about the vertical, as the view turns
  return { pos: add(pivot, turnAbout(level, rightOf(turned), tipped - pitch)), yaw: turned, pitch: tipped };
}

// Alt+right drag: toward the pivot (amount > 0: the mouse right or down) or away, along the line to it (the pivot
// keeps its place on the screen); toward it the camera stops MIN_PIVOT_DISTANCE units before it
export const MIN_PIVOT_DISTANCE = 8;
const DOLLY_PER_PIXEL = 0.006;
export const dragDolly = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? dx : dy) * DOLLY_PER_PIXEL;
export function dollyStep(pos, pivot, amount) {
  const v = sub(pos, pivot), d = length(v);
  if (d < 1e-6) return pos.slice();
  const to = d * Math.exp(-amount);
  return add(pivot, scale(v, (amount > 0 ? Math.max(Math.min(d, MIN_PIVOT_DISTANCE), to) : to) / d));
}

// the fly speeds the wheel steps through while the right button is held (units a second): Settings > Camera's
// range, on its slider's steps. From a speed between two (typed in Settings), the next one that way.
export const FLY_SPEEDS = [100, 150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000];
export function nextFlySpeed(speed, dir) {
  if (dir > 0) return FLY_SPEEDS.find((s) => s > speed) ?? FLY_SPEEDS[FLY_SPEEDS.length - 1];
  return [...FLY_SPEEDS].reverse().find((s) => s < speed) ?? FLY_SPEEDS[0];
}

// Frame (F): how far the camera stands from the middle of the selection, in its size; F again on the same
// selection, the camera not moved since, goes to the next (closer) one and stays at the last
export const FRAME_DISTANCES = [1.4, 0.6];
export const frameStep = (last, same) => (same ? Math.min(last + 1, FRAME_DISTANCES.length - 1) : 0);

// A flight of the camera (Frame, the axis widget): {from: {pos, yaw, pitch}, to: {pos} or {yaw, pitch}, pivot}, at u
// (0..1 of FLIGHT_SECONDS), eased. About a pivot it is an orbit (the pivot keeps its place on the screen) to the
// direction asked, the short way round; without one the camera goes straight to `to.pos`, its direction kept.
export const FLIGHT_SECONDS = 0.25;
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(2 - 2 * u, 3) / 2);
const shortTurn = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
export function flightPose(flight, u) {
  const { from, to, pivot } = flight, k = ease(clamp(u, 0, 1));
  if (pivot) return orbitStep(from.pos, pivot, from.yaw, from.pitch, shortTurn(to.yaw - from.yaw) * k, (to.pitch - from.pitch) * k);
  return { pos: add(from.pos, scale(sub(to.pos, from.pos), k)), yaw: from.yaw, pitch: from.pitch };
}
// does the camera still look at `point` (within about 9 degrees of the middle of the view)?
export function looksAt(pos, yaw, pitch, point) {
  const d = sub(point, pos), n = length(d);
  return n > 1e-6 && dot(d, lookDir(yaw, pitch)) / n > Math.cos(0.15);
}

// Settings > Camera: the field of view (degrees across the width, as the game's), the near and far planes (units).
// A setting of 0, or none, is `fallback` (the field of view: the player's own in the game); any other is kept
// inside its limits.
export const CAMERA_SETTINGS = {
  fov: { min: 60, max: 120 },
  near: { min: 1, max: 64, def: 2 },
  far: { min: 20000, max: 250000, def: 120000 },
};
export function cameraSetting(name, value, fallback = CAMERA_SETTINGS[name].def) {
  const s = CAMERA_SETTINGS[name], v = +value > 0 ? +value : +fallback;
  return Number.isFinite(v) && v > 0 ? clamp(v, s.min, s.max) : s.def ?? s.min;
}
// three.js wants the field of view up the height; the game's goes across the width
export const verticalFov = (degrees, aspect) => 2 * Math.atan(Math.tan(degrees * Math.PI / 360) / aspect) * 180 / Math.PI;

// The axis widget's ends (Unity's scene gizmo), on the view's axes as the Inspector and the gizmo show them (Y is
// the height: Unreal's Z). A click looks from that end toward the middle: Y from above, as steep as the mouse look
// goes, with X to the right as the Top pane; X and Z level. pane: the orthographic pane (ortho-views.js) along that axis.
export const VIEW_AXES = [
  { id: '+X', axis: 'X', dir: [1, 0, 0], yaw: Math.PI, pitch: 0, pane: 'side' },
  { id: '-X', axis: 'X', dir: [-1, 0, 0], yaw: 0, pitch: 0, pane: 'side' },
  { id: '+Y', axis: 'Y', dir: [0, 1, 0], yaw: -Math.PI / 2, pitch: -PITCH_LIMIT, pane: 'top' },
  { id: '-Y', axis: 'Y', dir: [0, -1, 0], yaw: -Math.PI / 2, pitch: PITCH_LIMIT, pane: 'top' },
  { id: '+Z', axis: 'Z', dir: [0, 0, 1], yaw: -Math.PI / 2, pitch: 0, pane: 'front' },
  { id: '-Z', axis: 'Z', dir: [0, 0, -1], yaw: Math.PI / 2, pitch: 0, pane: 'front' },
];
// each end as the camera sees it: x right and y down the screen (-1..1), depth toward the far side (> 0 behind the
// middle); the farthest first, the order they are drawn in
export function axisLayout(yaw, pitch) {
  const f = lookDir(yaw, pitch), r = rightOf(yaw);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return VIEW_AXES.map((a) => ({ id: a.id, x: dot(a.dir, r), y: -dot(a.dir, u), depth: dot(a.dir, f) }))
    .sort((a, b) => b.depth - a.depth);
}

// Where the camera faces in the game's units: its yaw (65536 a turn) and the letter the game's compass shows,
// North at the map's TrueNorth (DeusExLevelInfo, HUDCompassDisplay)
const TURN = 65536;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function heading(yaw, north = 0) {
  const units = ((Math.round(yaw * TURN / (2 * Math.PI)) % TURN) + TURN) % TURN;
  const from = (((units - north) % TURN) + TURN) % TURN;
  return { yaw: units, compass: COMPASS[Math.round(from / (TURN / 8)) % 8] };
}
