// The selection and the 3D view's camera, as Unity's GameObject menu: Align with view (the selection where the view
// looks from, turned the way it looks), Move to view (onto what the view looks at; app.js does the ray), Align view to
// selected (the view looks from the object along its front) and Pilot (the view looks through it, and flying the view
// takes it along: Align with view each frame). No page: app.js moves the camera and writes the edits.
// The game's units and axes: points [x, y, z] (z up), rotations [pitch, yaw, roll], 65536 a turn. The camera's
// yaw and pitch (app.js cam) are radians, as view-camera.js has them.
import { PITCH_LIMIT } from './view-camera.js';

export const TURN = 65536;
const RAD = TURN / (2 * Math.PI);
const wrap = (v) => ((Math.round(v) % TURN) + TURN) % TURN;
const signed = (v) => { const w = wrap(v); return w > TURN / 2 ? w - TURN : w; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// the way the camera looks as a rotation of the game (the editor's camera has no roll)
export const viewRotation = (yaw, pitch) => [signed(pitch * RAD), wrap(yaw * RAD), 0];
// an object's pitch as the camera's, which tips up or down as far as the mouse look goes
export const viewPitch = (pitch) => clamp(signed(pitch) / RAD, -PITCH_LIMIT, PITCH_LIMIT);

// A character's eyes above its middle: its BaseEyeHeight, else the engine's own when none is set (0.8 of its
// CollisionHeight, Engine.Pawn PostBeginPlay). What is not a character looks from its middle (eye 0).
export const EYE_SHARE = 0.8;
export const eyeHeight = (collisionHeight, baseEyeHeight) => (+baseEyeHeight > 0 ? +baseEyeHeight : EYE_SHARE * (+collisionHeight || 0));

// The rotation that looks the view's way, by what the object is (as Aim at a point's, gizmo-tools.js): what tips
// (lights, cameras, turrets, effect points) takes the view's whole rotation, roll 0 included; the rest turns about
// the vertical only and keeps its pitch and roll (a character stays standing).
export const alignedRotation = (now, view, tilts) => (tilts ? [view[0], view[1], view[2] || 0] : [now[0] || 0, view[1], now[2] || 0]);

// two rotations alike, whole turns apart or not
export const sameRotation = (a, b) => [0, 1, 2].every((k) => wrap(a[k] || 0) === wrap(b[k] || 0));
// a plan's turn of a part ({rot, fixed}): none when it is the part's own turn, nor for what moves but cannot turn
// (fixed: a structure with doors or a lift, as in a group's turn)
export const turnsPart = (part, rot) => !part.fixed && !sameRotation(rot, part.rot);
// Whether a plan ([{at, rot}]) leaves every part ([{at, rot, fixed}]) as it is: within SAME_PLACE units of where it
// stands, not turned. Then there is nothing to do, nor a Ctrl+Z to add.
export const SAME_PLACE = 0.01;
export const planStays = (parts, plan) => parts.every((part, i) =>
  Math.hypot(...part.at.map((v, k) => v - plan[i].at[k])) < SAME_PLACE && !turnsPart(part, plan[i].rot));

// The whole selection moved as one. parts: [{at, rot}]; parts[lead] goes to `to` ({at, rot}); each other part keeps
// its place about it, turned with it about the vertical by as much as its yaw turned, its own yaw turned as much (a
// rotation of the game turns its yaw last, about the map's vertical) and its pitch and roll kept.
export function carryParts(parts, lead, to) {
  const from = parts[lead], dyaw = wrap(to.rot[1]) - wrap(from.rot[1]);
  const c = Math.cos(dyaw / RAD), s = Math.sin(dyaw / RAD);
  return parts.map((p, i) => {
    if (i === lead) return { at: to.at.slice(), rot: to.rot.slice() };
    const dx = p.at[0] - from.at[0], dy = p.at[1] - from.at[1];
    return { at: [to.at[0] + dx * c - dy * s, to.at[1] + dx * s + dy * c, to.at[2] + p.at[2] - from.at[2]],
      rot: [p.rot[0] || 0, wrap((p.rot[1] || 0) + dyaw), p.rot[2] || 0] };
  });
}

// Align with view: the lead where the view looks from (a character with its eyes there), turned the view's way
// (alignedRotation), the rest of the selection carried with it. view: {at: the camera, rot: viewRotation}.
export function alignPlan(parts, lead, view, { eye = 0, tilts = false } = {}) {
  const at = [view.at[0], view.at[1], view.at[2] - eye];
  return carryParts(parts, lead, { at, rot: alignedRotation(parts[lead].rot, view.rot, tilts) });
}

// Align view to selected: the camera at the object's eyes (eye: eyeHeight, 0 for what is not a character) looking
// along its front: {at, yaw (the game's units), pitch (the camera's, radians)}
export const lookThrough = (at, rot, eye = 0) => ({ at: [at[0], at[1], at[2] + eye], yaw: wrap(rot[1] || 0), pitch: viewPitch(rot[0] || 0) });
