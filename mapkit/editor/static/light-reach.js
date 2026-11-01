// How much of a lamp's light a point takes, as the engine lights a surface or a vertex, and as the host's lightAt
// (host/UCEngineBridge.cpp) made the Lit view's lightmaps: its falloff over its radius, the angle it meets the surface
// at (not for LE_NonIncidence) and a spotlight's cone. Shared by the Lit view's light on the objects (app.js
// vertexColours), Lights here (Ctrl+Alt+click a surface) and the Effects. No page.
//
// A light is kept as the lighting dump keeps it (UCEngineBridge lightList), 12 numbers: x y z, its colour (r g b, the
// brightness curve in it), its reach in units, its LightEffect's number, the way it faces (x y z), its LightCone.
import { coneAngle } from './range-handles.js';

// LightEffect's values in their order (Actor.uc ELightEffect, the same in Deus Ex and Revision): the dump keeps the number
export const LIGHT_EFFECTS = ['LE_None', 'LE_TorchWaver', 'LE_FireWaver', 'LE_WateryShimmer', 'LE_Searchlight', 'LE_SlowWave',
  'LE_FastWave', 'LE_CloudCast', 'LE_StaticSpot', 'LE_Shock', 'LE_Disco', 'LE_Warp', 'LE_Spotlight', 'LE_NonIncidence', 'LE_Shell',
  'LE_OmniBumpMap', 'LE_Interference', 'LE_Cylinder', 'LE_Rotor', 'LE_Unused'];
// LE_StaticSpot and LE_Spotlight light a cone; LE_NonIncidence lights a surface at any angle
export const SPOT_LIGHTS = [8, 12], NON_INCIDENCE = 13;

// The share of a light's colour a point takes (0: none): (px, py, pz) the point, (nx, ny, nz) the surface's normal there
export function lightReach(L, px, py, pz, nx, ny, nz) {
  const dx = L[0] - px, dy = L[1] - py, dz = L[2] - pz, dist = Math.hypot(dx, dy, dz);
  if (dist >= L[6]) return 0;
  let f = 1 - dist / L[6];
  if (L[7] !== NON_INCIDENCE && dist > 0.01) {
    const inc = (dx * nx + dy * ny + dz * nz) / dist;
    if (inc <= 0) return 0;
    f *= inc;
  }
  if ((L[7] === SPOT_LIGHTS[0] || L[7] === SPOT_LIGHTS[1]) && dist > 0.01) {
    const cs = -(dx * L[8] + dy * L[9] + dz * L[10]) / dist, edge = Math.cos(coneAngle(L[11]));
    if (cs <= edge) return 0;
    f *= Math.min(1, (cs - edge) / Math.max(0.05, 1 - edge) * 2);
  }
  return f;
}

// UnrealEd's light colour before its brightness: hue 0 red, 85 green, 170 blue; saturation 255 = white (FGetHSV)
export function lightHue(hue, sat) {
  const h = hue < 86 ? [(85 - hue) / 85, hue / 85, 0] : hue < 171 ? [0, (170 - hue) / 85, (hue - 85) / 85] : [(hue - 170) / 85, 0, (255 - hue) / 85];
  return h.map((x) => x + (1 - x) * sat / 255);
}
// A light's colour as the engine lights with it (the host's lightColour): its hue, and its brightness on the engine's
// curve, where dim lights count for much more than LightBrightness / 255
export function engineColour(hue, sat, brightness) {
  let b = brightness * 1.4 / 255;
  b *= 0.70 / (0.01 + Math.sqrt(b));
  b = Math.min(1, Math.max(0, b));
  return lightHue(hue, sat).map((x) => x * b);
}

// how bright a colour looks (Rec. 601), to rank the lights
const luma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

// Lights here: lights ([{ id, L }]) reaching the point `at` on a surface facing `normal` (both [x, y, z], the normal
// toward where it is seen from). blocked(L): a wall is between the point and that light (the caller's ray). Returns
// { lit: [{ id, light: [r, g, b] it adds there (doubled, as on the surfaces), share: of what all of them add }],
// brightest first, blocked: [id] the lights in reach that a wall hides }.
export function lightsHere(lights, at, normal, blocked) {
  const lit = [], hidden = [];
  for (const { id, L } of lights) {
    const f = lightReach(L, at[0], at[1], at[2], normal[0], normal[1], normal[2]);
    if (f <= 0) continue;
    if (blocked(L)) { hidden.push(id); continue; }
    lit.push({ id, light: [2 * L[3] * f, 2 * L[4] * f, 2 * L[5] * f] });
  }
  const sum = lit.reduce((s, r) => s + luma(r.light), 0);
  for (const r of lit) r.share = sum > 0 ? luma(r.light) / sum : 0;
  lit.sort((a, b) => b.share - a.share);
  return { lit, blocked: hidden };
}
