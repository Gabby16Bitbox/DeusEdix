// View > Effects (the 3D view's toolbar): the Lit view moves as the game does. The timing maths, no page: how bright a
// lamp is at a moment by its LightType, LightPeriod and LightPhase, how fast a panning texture moves, what the zone the
// camera is in does to the view, which lamps are animated first, how a corona is drawn, what a lamp's settings do not do.
// As the game's renderer does them: Render.dll's URender::GlobalLighting, read and measured in the game (batch 6's
// lights_research.md, 28 Oct 2026); the zone's view fog as DeusExPlayer.ViewFlash has it. Both games light their lamps
// with that code, but Revision draws with its RenderExt and the original game with the stock renderer, which differ
// (RENDERERS):
// - the engine's time is Level.TimeSeconds (a 32-bit float) * 35 ticks, and a round of its sine table is 65536;
// - LT_Pulse is 0.6 + 0.39 sin and LT_SubtlePulse 0.9 + 0.09 sin of its light, a round every LightPeriod ticks,
//   LightPhase / 256 of a round later;
// - LT_Blink is off when bit 0 of (int)(time * 35 * 65536 / (LightPeriod + 1) + LightPhase * 256) is set: on or off at
//   random in about half the frames whatever the period, and LightPhase (times 256: even) never changes that bit. Once
//   the sum has no fraction left the lamp stays on: in Revision from 2^(8 + a) s when LightPeriod + 1 is 2^a (0: 256 s),
//   in the original game, whose renderer works the sum out in 24 bits, from about 7.31 x (LightPeriod + 1) s;
// - LT_Flicker: Revision never lights it (RenderExt never refreshes the random values it reads: 0, every frame); the
//   original game turns it off when the frame's value is under 0.5, else lights that part of it, a new value every drawn
//   frame from a table of 256 that lamps share (here an entry by the lamp's own number);
// - LT_Strobe is one switch for every strobe lamp of the map, turned every drawn frame; LightPeriod and LightPhase do
//   nothing;
// - LT_TexturePaletteOnce / Loop take their colour and level from the palette of the lamp's Skin, which the editor does
//   not read: steady here (without a Skin they are steady in the game too), as LT_Steady, LT_BackdropLight and the light
//   effects (LightEffect: torch, searchlight...).
export const TICKS = 35;
const ROUND = 65536;
// the light types whose level is not their light's: they change with time, or (LT_Flicker in Revision) give none
export const MOVING_LIGHTS = new Set(['LT_Pulse', 'LT_Blink', 'LT_Flicker', 'LT_Strobe', 'LT_SubtlePulse']);
// what each game's renderer does its own way (by projects.js projectGame's names): the light types it never lights,
// whether it works LT_Blink's sum out in 24 bits (single) or in double precision, and the Skins whose palette gives a
// palette lamp no light (darkPalette, package.group.name in lower case: Revision's own Effects.Corona.Corona_G, measured
// at 0 for LT_TexturePaletteOnce and Loop with both renderers, lights_research.md runs 2 and 3)
export const RENDERERS = {
  revision: { unlit: ['LT_Flicker'], single: false, darkPalette: ['effects.corona.corona_g'] },
  vanilla: { unlit: [], single: true, darkPalette: [] },
};
const rendererOf = (game) => RENDERERS[game] || RENDERERS.revision;
const PALETTE = ['LT_TexturePaletteOnce', 'LT_TexturePaletteLoop'];
// a Skin as a map or All properties has it (Texture'Effects.Corona.Corona_G', or the name alone) as RENDERERS lists it
const skinName = (skin) => String(skin || '').replace(/^\w+'(.*)'$/, '$1').toLowerCase();
// does a lamp of this LightType give any light in that game (skin: its Skin, whose palette a palette lamp's light is)
export const givesLight = (type, game, skin = '') => type !== 'LT_None' && !rendererOf(game).unlit.includes(type)
  && !(PALETTE.includes(type) && rendererOf(game).darkPalette.includes(skinName(skin)));

// a number in [0, 1) for a lamp (seed) and a moment (n): the same every time it is asked
export function noise(seed, n) {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((n | 0) + 0x6d2b79f5, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
// a lamp's own number for its flicker (LT_Flicker in the original game), from its name
export function lampSeed(name) {
  let h = 0x811c9dc5;
  for (const ch of String(name)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

// LT_Blink lit at the game's time t (seconds): bit 0 of its sum clear. period: LightPeriod, ph: LightPhase x 256;
// single: the sum worked out in 24 bits a step (the original game's renderer), else in double (Revision's)
function blinkOn(period, ph, t, single) {
  const f = single ? Math.fround : (x) => x;
  return (Math.trunc(f(f(f(Math.fround(t) * TICKS * ROUND) / (period + 1)) + ph)) & 1) === 0;
}
// when a blinking lamp of this LightPeriod stays on for good in that game (seconds of the map), null: never. Revision: a
// period whose + 1 is 2^a, from 2^(8 + a) s (from then on the time, a 32-bit float, moves in steps that keep the sum
// even); the original game: once the sum passes 2^24, about 7.31 x (period + 1) s
export function blinkSteadyFrom(period, game) {
  const p = (Math.round(+period || 0) & 255) + 1;
  if (rendererOf(game).single) return 2 ** 24 * p / (TICKS * ROUND);
  return (p & (p - 1)) === 0 ? 2 ** (8 + Math.log2(p)) : null;
}

// How bright a lamp is at time t (seconds since the map started), for its steady light (0 to 1). type: its LightType's
// name; period, phase: LightPeriod and LightPhase (bytes); seed: the lamp's own number (its flicker); frame: the drawn
// frame, from 1 (LT_Strobe turns and LT_Flicker takes a new value each frame); game: the map's game (RENDERERS); skin:
// its Skin (a palette lamp's light).
export function lightLevel(type, period, phase, t, { seed = 0, frame = 0, game = 'revision', skin = '' } = {}) {
  if (!givesLight(type, game, skin)) return 0;
  const ticks = t * TICKS * ROUND, ph = (Math.round(+phase || 0) & 255) * 256;
  const sine = () => Math.sin((ticks / Math.max(1, Math.round(+period || 0)) + ph) * 2 * Math.PI / ROUND);
  switch (type) {
    case 'LT_Pulse': return 0.6 + 0.39 * sine();
    case 'LT_SubtlePulse': return 0.9 + 0.09 * sine();
    case 'LT_Blink': return blinkOn(Math.round(+period || 0) & 255, ph, t, rendererOf(game).single) ? 1 : 0;
    case 'LT_Flicker': { const r = noise(seed & 255, frame); return r < 0.5 ? 0 : r; }
    case 'LT_Strobe': return frame & 1 ? 0 : 1;
    default: return 1;
  }
}

// What a lamp's settings do not do in the game the map is for, each said under the property it is about (the
// Inspector): rows of { prop, types (its LightType among them; none: any), when (lamp, game), text (a text, or one made
// from the lamp and the game) }
const NOTES = [
  { prop: 'LightType', types: ['LT_Flicker'], when: (l, game) => !givesLight(l.type, game),
    text: 'Revision never lights a flickering lamp: its renderer never updates the random value LT_Flicker reads, so the lamp '
      + 'gives no light at all (the original maps\' too). For a flicker use LT_Blink, with a dimmer steady lamp beside it if the '
      + 'room must not go black.' },
  { prop: 'LightType', types: ['LT_Blink'],
    text: 'A blinking lamp keeps no time in the game: it is on or off at random, in about half the frames, whatever its Period; '
      + 'Phase does nothing.' },
  { prop: 'LightType', types: ['LT_Strobe'],
    text: 'Every strobe lamp of the map switches together, on one frame and off the next; Period and Phase do nothing.' },
  { prop: 'LightType', types: PALETTE,
    text: (l, game) => (!l.skin ? 'Without a Skin this lamp is steady in the game: its colour and level come from its Skin\'s palette.'
      : !givesLight(l.type, game, l.skin) ? 'Revision gives a palette lamp with this Skin no light (measured): it is dark here too.'
      : 'Its colour and level come from its Skin\'s palette, which the editor does not show (steady here)'
        + (game === 'revision' ? '; in Revision only Effects.Corona.Corona_G was measured (dark), this Skin was not' : '') + '.') },
  { prop: 'LightPeriod', types: ['LT_Blink'], when: (l, game) => blinkSteadyFrom(l.period, game) !== null,
    text: (l, game) => `With this Period the lamp stops blinking and stays on after ${duration(blinkSteadyFrom(l.period, game))} of the map`
      + (game === 'revision' ? ' (a Period + 1 that is a power of two: the default 32 never does).'
        : ' (in the original game every blinking lamp does, after about 7.3 x (Period + 1) seconds).') },
  { prop: 'LightPeriod', types: ['LT_Flicker', 'LT_Strobe', 'LT_TexturePaletteOnce'], when: (l, game) => givesLight(l.type, game, l.skin),
    text: 'Period does nothing for this type.' },
  { prop: 'LightPhase', types: ['LT_Blink', 'LT_Flicker', 'LT_Strobe', ...PALETTE], when: (l, game) => givesLight(l.type, game, l.skin),
    text: 'Phase does nothing for this type.' },
  { prop: 'bCorona', when: (l) => l.corona && !l.skin,
    text: 'No corona in the game without a Skin, the texture it draws (the original maps use Effects.Corona.Corona_E, F or G): '
      + 'give it one in All properties.' },
];
// the properties the notes are about: the Properties keep a place for a lamp's notes under each (app.js drawProps)
export const NOTE_PROPS = [...new Set(NOTES.map((n) => n.prop))];
// a time in seconds as the notes say it
const duration = (s) => (s < 600 ? `${Math.round(s)} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
// lamp: { type (LightType), period (LightPeriod), corona (bCorona on), skin (its Skin, '' for none) }; game as RENDERERS
export function lightNotes(lamp, game) {
  return NOTES.filter((n) => (!n.types || n.types.includes(lamp.type)) && (!n.when || n.when(lamp, game)))
    .map((n) => ({ prop: n.prop, text: typeof n.text === 'function' ? n.text(lamp, game) : n.text }));
}

// A corona as the game draws it (RenderExt; the stock renderer has a copy of the same): only for a lamp with bCorona
// and a Skin (whatever its brightness: the original maps' glows are lamps of brightness 0), that texture, translucent,
// its glow inside a square (CORONA_GLOW) of CORONA_SIZE x the view's width x the lamp's DrawScale on the screen
// at any distance, tinted by LightHue and LightSaturation only (not by its brightness, radius or type: a dark flickering
// lamp's corona shines), shown while the line from the eye to the lamp is clear, coming and going at CORONA_FADE a
// second, at most CORONA_MAX at once. The lines of sight looked along a frame (each a ray through the map's walls):
// CORONA_LOOKS, the coronas taken in turn
export const CORONA_SIZE = 0.2, CORONA_FADE = 3, CORONA_MAX = 32, CORONA_LOOKS = 4;
// three's scale of a sprite that keeps its size on the screen (sizeAttenuation off) for a corona of DrawScale `size`:
// such a sprite's side is scale x p00 (the projection's x scale) of half the view's width
export const coronaScale = (size, p00) => 2 * CORONA_SIZE * size / p00;
// How bright a corona is inside its square (0 to 1), r from its middle in halves of the square's side: the game draws the
// Skin's own picture, whose glow is smaller than the square, as measured on Revision's Effects.Corona.Corona_G (batch 6's
// lights_research.md, run 2: 128 of 255 out to 0.0875, 64 out to 0.21, 32 out to 0.36). CORONA_GLOW: [r, level], a
// straight line between two of them, nothing past the last
export const CORONA_GLOW = [[0, 1], [0.0875, 0.5], [0.2125, 0.25], [0.3625, 0.125], [0.5, 0]];
export function coronaGlow(r) {
  const i = CORONA_GLOW.findIndex(([x]) => x >= r);
  if (i < 0) return 0;
  if (i === 0) return CORONA_GLOW[0][1];
  const [x0, y0] = CORONA_GLOW[i - 1], [x1, y1] = CORONA_GLOW[i];
  return y0 + (y1 - y0) * (r - x0) / (x1 - x0);
}
// how much of a corona shows dt seconds later: more while its lamp is in sight (seen), less while it is not
export const coronaFade = (shown, seen, dt) => Math.max(0, Math.min(1, shown + (seen ? CORONA_FADE : -CORONA_FADE) * dt));
// which of n coronas have their line of sight looked along at drawn frame `frame`: CORONA_LOOKS of them, in turn
export function coronaTurn(n, frame) {
  return Array.from({ length: Math.min(n, CORONA_LOOKS) }, (_, i) => (frame * CORONA_LOOKS + i) % n);
}

// Auto U Pan and Auto V Pan (PolyFlags of a surface or its texture): how many textures a second it moves along U and V.
// pan: its zone's speeds in texels a second (data.zone_looks: TexUPanSpeed x 35, as measured in the game), size: the
// texture's width and height in texels.
export const PF_AUTOUPAN = 0x200, PF_AUTOVPAN = 0x400;
// a zone's speeds when the editor does not know it (a map read before the editor kept them): ZoneInfo's own, 1 x 35
export const ZONE_PAN = [35, 35];
export function panRate(flags, pan, size) {
  return [flags & PF_AUTOUPAN ? pan[0] / Math.max(1, +size[0] || 1) : 0, flags & PF_AUTOVPAN ? pan[1] / Math.max(1, +size[1] || 1) : 0];
}

// What the zone the camera is in does to the view (look: data.zone_looks' entry, null: nothing), as JC's view while his
// head is in the zone (DeusExPlayer.ViewFlash): the picture times scale (1 + ViewFlash.X), plus fog (ViewFog); the game
// takes a scale over 0.981 as 1 and a fog under 0.019 as none. haze: its FogColor (0-255) out to FogDistance, when it
// has one (what a renderer of the game does with them is its own). null: the view stays as it is.
export function zoneView(look) {
  if (!look) return null;
  let scale = 1 + (+(look.viewFlash || [])[0] || 0);
  if (scale > 0.981) scale = 1;
  const fog = [0, 1, 2].map((k) => { const v = +(look.viewFog || [])[k] || 0; return v < 0.019 ? 0 : v; });
  const haze = look.fogDistance > 0 ? { colour: [0, 1, 2].map((k) => (+(look.fogColour || [])[k] || 0) / 255), distance: +look.fogDistance } : null;
  if (scale === 1 && !fog.some((v) => v > 0) && !haze) return null;
  return { scale: Math.max(0, scale), fog, haze };
}

// The lamps animated first when there are more than the view takes (max): those whose reach is nearest to `at`
// (x y z). lights: [{ L, ... }] (L: light-reach.js's 12 numbers); the same objects come back, nearest first.
export function nearestLights(lights, at, max) {
  const gap = (L) => Math.max(0, Math.hypot(L[0] - at[0], L[1] - at[1], L[2] - at[2]) - L[6]);
  return lights.map((x) => [gap(x.L), x]).sort((a, b) => a[0] - b[0]).slice(0, max).map(([, x]) => x);
}
