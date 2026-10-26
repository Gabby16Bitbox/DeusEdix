// The ranges a selected object shows in the 3D view as drag handles, as Unity's light, audio source and collider
// handles: a light's reach (a sphere), a spotlight's cone (its tip: the reach, its rim: how wide), how far a sound is
// heard, a trigger's cylinder, a collision box's sides. What each dot changes, in the units the game keeps it: a
// light's or a sound's radius is a byte (25 x (radius + 1) units), a cone a byte (256 is a quarter turn from the
// middle), the rest units. No page: app.js says which ranges an object has (rangesOf), drag-handles.js draws and drags.
// A range: { shape, centre (the game's x, y, z), props, ... } with
//   sphere   { size (units), props: [radius], unit: 'byte' or 'units', scale }
//   cylinder { radius, height (half, as CollisionHeight), props: [radius, height], scale }
//   cone     { dir (unit), size (the reach, units), angle (from the middle, radians), props: [radius, cone] }
//   box      { size, axes (block-handles.js), props: [x, y, z half sizes] or none (a block), scale }
// fields: each prop's Inspector field { label, kind } (the note shown while dragging says it as that field will);
// scale: the object's (its props are its sizes / scale).
import { faceHandles, moveFace, faceAway } from './block-handles.js';
import { propShown, propText } from './prop-kinds.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const along = (p, d, t) => p.map((v, k) => v + d[k] * t);
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const tenth = (v) => Math.round(v * 10) / 10;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const MIN_RANGE = 2;                // the smallest radius or half size in units (as the Inspector's sizes)
// a byte radius (LightRadius, SoundRadius) and the units it reaches in the engine, and back
export const byteReach = (v) => 25 * (Math.round(+v || 0) + 1);
export const reachByte = (units) => clamp(Math.round(units / 25 - 1), 0, 255);
// a spotlight's LightCone and its angle from the middle (radians), as the editor's lighting and the host's (UCEngineBridge lightAt)
export const coneAngle = (cone) => (+cone || 0) * Math.PI / 512;
export const angleCone = (angle) => clamp(Math.round(angle * 512 / Math.PI), 0, 255);
export const SPOT_EFFECTS = /^LE_(Spotlight|StaticSpot)$/i;

// two directions square to a unit vector and to each other: where a cone's rim dots go
function across(dir) {
  const u = norm(cross(dir, Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return [u, cross(dir, u)];
}
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// A spotlight's rim: the circle where its cone meets its reach, as { centre, radius, u, v } (u, v: its plane).
export function coneRim(range) {
  const [u, v] = across(range.dir);
  return { centre: along(range.centre, range.dir, range.size * Math.cos(range.angle)), radius: range.size * Math.sin(range.angle), u, v };
}

// The handles of a range: { part, origin, dir, t, at } (a dot `at`, dragged on the line from `origin` along `dir`,
// `t` out on it), and for a cone's rim its own radial direction.
export function rangeHandles(range) {
  const c = range.centre;
  if (range.shape === 'sphere') return AXES.map((d) => ({ part: 'radius', origin: c, dir: d, t: range.size, at: along(c, d, range.size) }));
  if (range.shape === 'cylinder') return AXES.map((d, i) => {
    const t = i < 4 ? range.radius : range.height;
    return { part: i < 4 ? 'radius' : 'height', origin: c, dir: d, t, at: along(c, d, t) };
  });
  if (range.shape === 'cone') {
    const rim = coneRim(range), out = [{ part: 'reach', origin: c, dir: range.dir, t: range.size, at: along(c, range.dir, range.size) }];
    for (const r of [rim.u, rim.v, rim.u.map((x) => -x), rim.v.map((x) => -x)]) {
      const at = along(rim.centre, r, rim.radius);
      // the rim dot slides where the cone opens: square to the line from the tip, in the plane of the middle and the dot
      const dir = norm(r.map((x, k) => x * Math.cos(range.angle) - range.dir[k] * Math.sin(range.angle)));
      out.push({ part: 'cone', origin: at, dir, t: 0, at, radial: r });
    }
    return out;
  }
  if (range.shape === 'box') return faceHandles(range);
  return [];
}

// How a view sees a handle: look is the unit direction from the view's eye to its dot (the 3D view: from its camera;
// an orthographic view: the way it looks, the same for every dot). null: its line runs (nearly) along the look, so it
// cannot be dragged there and is left out; else { dim }: a box's side facing away, drawn dimmer.
export const ALONG = 0.95;
export function seenFrom(handle, look) {
  if (Math.abs(dot(handle.dir, look)) > ALONG) return null;
  return { dim: handle.part === 'face' && faceAway(handle, look) };
}

// a radius or a half size from how far out its dot is: on the grid (step) or to a tenth of a unit, never under MIN_RANGE
const unitsAt = (t, step) => (step > 0 ? Math.max(Math.ceil(MIN_RANGE / step), Math.round(t / step)) * step : Math.max(MIN_RANGE, tenth(t)));
// a value as its Inspector field shows it (a collision box's half size as its whole width)
const field = (range, prop) => (range.fields && range.fields[prop]) || { label: prop, kind: 'float' };
const noteOf = (range, prop, v) => { const f = field(range, prop); return `${f.label} ${tenth(propShown(f.kind, v))}`; };
const SIDES = ['Width', 'Depth', 'Height'];
// the texts written for those values, as the Inspector's fields store them: a byte whole, units as UnrealEd's floats
const written = (values, kind) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, propText(kind, v)]));

// A handle of `range` dragged to `t` out on its line: { range (as it is now), props (the texts to write: what changed;
// null for a block), centre (the object's new middle, or null: it stays), note (what the view shows) }. opts: step
// (the grid, 0 off), angleStep (the rotation step in degrees, 0 off), alt and shift (a box's sides, block-handles.js).
export function rangeDrag(range, handle, t, opts = {}) {
  const step = opts.step || 0, scale = range.scale || 1;
  if (range.shape === 'box') {
    const box = moveFace(range, handle.face, t, { alt: opts.alt, shift: opts.shift, step });
    const half = (k) => box.size[k] / 2 / scale, axes = opts.shift ? [0, 1, 2] : [handle.face.axis];
    return { range: { ...range, centre: box.centre, size: box.size }, centre: box.centre,
      props: range.props ? written(Object.fromEntries(range.props.map((p, k) => [p, half(k)]).filter((_, k) => box.size[k] !== range.size[k])), 'float') : null,
      note: axes.map((k) => (range.props ? noteOf(range, range.props[k], half(k)) : `${SIDES[k]} ${tenth(box.size[k])}`)).join(' · ') };
  }
  // a reach in bytes: whole steps of 25 units (the grid cannot make them finer)
  const reach = (prop) => {
    const v = reachByte(t);
    return { value: v, size: byteReach(v), note: `${noteOf(range, prop, v)} (${byteReach(v)} units)` };
  };
  if (range.shape === 'cone' && handle.part === 'cone') {
    // the rim dot moved `t` along its line: the cone opens by the angle that makes from the tip, in rotation steps on the grid
    let angle = clamp(range.angle + Math.atan2(t, range.size), 0, coneAngle(255));
    if (opts.angleStep > 0) angle = clamp(Math.round(angle * 180 / Math.PI / opts.angleStep) * opts.angleStep * Math.PI / 180, 0, coneAngle(255));
    const v = angleCone(angle), prop = range.props[1];
    return { range: { ...range, angle: coneAngle(v) }, props: written({ [prop]: v }, 'byte'), centre: null,
      note: `${noteOf(range, prop, v)} (${Math.round(coneAngle(v) * 360 / Math.PI)}° wide)` };
  }
  if (range.shape === 'cone' || (range.shape === 'sphere' && range.unit === 'byte')) {
    const r = reach(range.props[0]);
    return { range: { ...range, size: r.size }, props: written({ [range.props[0]]: r.value }, 'byte'), centre: null, note: r.note };
  }
  // units: a sphere's radius, a cylinder's radius or half height (the object stays in the middle)
  const units = unitsAt(t, step), prop = range.shape === 'cylinder' && handle.part === 'height' ? range.props[1] : range.props[0];
  const now = range.shape === 'sphere' ? { size: units } : handle.part === 'height' ? { height: units } : { radius: units };
  return { range: { ...range, ...now }, props: written({ [prop]: units / scale }, 'float'), centre: null, note: `${noteOf(range, prop, units / scale)} units` };
}
