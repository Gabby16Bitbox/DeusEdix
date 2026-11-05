// Particles of any colour (the Particles section's Colour). The game's smoke and sparks are moving pictures that
// cannot be painted over, so a colour is a texture of the map's own (MyLevel.Imported.UCT_Puff_ff3020_1): a still
// picture of the game's (a puff of smoke, the glow of a spark) with its light turned into the colour. The game draws
// its particles see-through, adding their light to what is behind them: the brighter a pixel, the thicker it looks,
// and black is not there at all. With no picture of the game (it could not be read) a soft puff or dot is drawn.
// The page's part, no canvas: the pixels in, the pixels out. Tested in tests/test_particle_colour.mjs.

// the looks a colour can have: the game's still picture it starts from, the game's texture a particle goes back to
// when its colour is taken off, how bright its brightest pixel is (1: the colour itself), its size
export const LOOKS = Object.freeze({
  puff: { label: 'Smoke, gas, mist', tex: 'Effects.Smoke.SmokePuff', back: 'Effects.Smoke.SmokePuff1', peak: 0.4, size: 64 },
  spark: { label: 'Sparks, glow', tex: 'Effects.Corona.Corona_A', back: 'Effects.Fire.SparkFX1', peak: 1, size: 32 },
});

// the look a texture has: sparks, glows and lights are dots, anything else is a puff
export function lookOf(texture) {
  const c = colourOf(texture);
  if (c) return c.look;
  return /spark|corona|laserspot|flare|glow/i.test(String(texture || '')) ? 'spark' : 'puff';
}

// the colour a particle texture of ours has ({look, hex}), or null (a texture of the game, a picture of the user's)
export function colourOf(texture) {
  const m = /(?:^|\.)UCT_(Puff|Spark)_([0-9a-f]{6})_\d+'?$/i.exec(String(texture || '').trim());
  return m ? { look: m[1].toLowerCase(), hex: '#' + m[2].toLowerCase() } : null;
}

// the name the texture is imported with (the map's textures are UCT_<base>_<n>)
export const baseName = (look, hex) => `${look === 'spark' ? 'Spark' : 'Puff'}_${normalHex(hex).slice(1)}`;

// an existing texture of the map with that look and colour (edits.textures' names), or ''
export function existingTexture(names, look, hex) {
  const re = new RegExp(`^UCT_${baseName(look, hex)}_\\d+$`, 'i');
  return (names || []).find((n) => re.test(n)) || '';
}

export function normalHex(hex) {
  const s = String(hex || '').trim().toLowerCase();
  if (/^#?[0-9a-f]{6}$/.test(s)) return s.startsWith('#') ? s : '#' + s;
  if (/^#?[0-9a-f]{3}$/.test(s)) return '#' + s.replace('#', '').split('').map((c) => c + c).join('');
  return '#ffffff';
}

// the picture in the colour: rgba (RGBA bytes of the game's picture), its light (the brightest of R, G, B, as the
// game adds it) scaled so that the brightest pixel is the colour at the look's peak; every pixel opaque (a see-through
// particle's black is its transparency)
export function tintPixels(rgba, hex, peak = 1) {
  const h = normalHex(hex), col = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  let top = 0;
  for (let i = 0; i < rgba.length; i += 4) top = Math.max(top, rgba[i], rgba[i + 1], rgba[i + 2]);
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const v = top ? Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) / top * peak : 0;
    out[i] = col[0] * v; out[i + 1] = col[1] * v; out[i + 2] = col[2] * v; out[i + 3] = 255;
  }
  return out;
}

// with no picture of the game: a soft puff (cloudy at its edge) or a dot with a glow, white, size x size
export function fallbackPixels(look, size = LOOKS[look]?.size || 64) {
  const out = new Uint8ClampedArray(size * size * 4), c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c) / (size / 2);
      let v;
      if (look === 'spark') v = Math.max(0, 1 - r) ** 3 + (r < 0.15 ? 0.5 : 0);
      else {
        const wobble = 0.12 * Math.sin(x * 0.7 + y * 0.3) * Math.cos(y * 0.5 - x * 0.2);   // the edge of a cloud
        v = Math.max(0, 1 - r + wobble) ** 2;
      }
      const b = Math.min(255, Math.round(v * 255)), i = (y * size + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = b; out[i + 3] = 255;
    }
  }
  return out;
}
