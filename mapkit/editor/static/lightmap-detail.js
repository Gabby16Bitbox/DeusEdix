// View > Lightmap detail (view-modes.js), as Unity's lightmap resolution view: every surface in the colour of how big
// its lightmap's samples are, from the map's last Rebuild. A sample is a point of the lattice the engine lights a
// surface on (its shadows are as sharp as that); Shadow detail (Surface > Shadows: Ultra Low, Low, Normal, High) and the size of
// the surface set how far apart they are. No page.
//
// What the editor has: every surface's lightmap packed in an atlas (data.py lightmap_atlas: lightmap.json, its size
// and each surface's w x h samples) and, on every corner of the map's polygons, where it falls in that atlas (the
// geometry's uv1: a sample is a pixel of the atlas; a surface without a lightmap has every corner on the atlas's
// full-bright corner, pixel 1.5, 1.5). A face's sample size is the side of the square of world it takes per sample:
// its area in the world over its area in samples. The atlas places are kept to 5 decimals: a face only a few samples
// big gets an estimate.

// the bands of the view: up to `upTo` units a sample, the colour (r g b, 0 to 1) and the legend's words
export const DETAIL_BANDS = [
  { upTo: 12, colour: [0.86, 0.22, 0.58], label: 'up to 12: very sharp, the most memory' },
  { upTo: 24, colour: [0.96, 0.56, 0.16], label: '12 to 24: sharp' },
  { upTo: 48, colour: [0.32, 0.76, 0.36], label: '24 to 48: the usual (about 32)' },
  { upTo: 96, colour: [0.22, 0.6, 0.92], label: '48 to 96: soft' },
  { upTo: Infinity, colour: [0.42, 0.34, 0.86], label: 'over 96: very soft, the least memory' },
];
export const NO_LIGHTMAP = { colour: [0.42, 0.42, 0.42], label: 'no lightmap: unlit, sky, invisible' };

export function detailBand(size) {
  return size > 0 ? DETAIL_BANDS.find((b) => size <= b.upTo) : NO_LIGHTMAP;
}

// Units a sample of every triangle of a mesh, its face's triangles taken together (0: no lightmap). pos: x y z a
// corner (the world's units, three corners a triangle, in a row), uv1: where each corner falls in the atlas (0 to 1),
// faces: the face of each triangle (-1: none of its own), atlas: [width, height] in pixels (= samples).
export function sampleSizes(pos, uv1, faces, atlas) {
  const [aw, ah] = atlas, n = Math.floor(pos.length / 9), keys = new Array(n), of = new Map();
  for (let t = 0; t < n; t++) {
    const p = t * 9, u = t * 6;
    const ax = pos[p + 3] - pos[p], ay = pos[p + 4] - pos[p + 1], az = pos[p + 5] - pos[p + 2];
    const bx = pos[p + 6] - pos[p], by = pos[p + 7] - pos[p + 1], bz = pos[p + 8] - pos[p + 2];
    const s1 = (uv1[u + 2] - uv1[u]) * aw, t1 = (uv1[u + 3] - uv1[u + 1]) * ah, s2 = (uv1[u + 4] - uv1[u]) * aw, t2 = (uv1[u + 5] - uv1[u + 1]) * ah;
    const key = faces && faces[t] >= 0 ? faces[t] : -1 - t;
    keys[t] = key;
    let f = of.get(key);
    if (!f) of.set(key, f = { world: 0, cells: 0, along: null, lit: false });
    f.world += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
    f.cells += Math.abs(s1 * t2 - s2 * t1) / 2;
    for (let k = 0; k < 3; k++)            // a corner off the full-bright pixel: the surface has a lightmap
      if (Math.abs(uv1[u + 2 * k] * aw - 1.5) > 0.25 || Math.abs(uv1[u + 2 * k + 1] * ah - 1.5) > 0.25) f.lit = true;
    // a lightmap one sample across (a thin trim) has no area in the atlas: its samples along the longest edge instead
    for (const [w, l] of [[Math.hypot(ax, ay, az), Math.hypot(s1, t1)], [Math.hypot(bx, by, bz), Math.hypot(s2, t2)]])
      if (l > 0.5 && (!f.along || l > f.along[1])) f.along = [w, l];
  }
  // a face smaller than a sample, with neither: one sample for the whole of it
  const size = (f) => (!f.lit ? 0 : f.cells > 0.01 ? Math.sqrt(f.world / f.cells) : f.along ? f.along[0] / f.along[1] : Math.max(1, Math.sqrt(f.world)));
  return Float32Array.from(keys, (k) => size(of.get(k)));
}

// The map's lightmaps as the last Rebuild made them (lightmap.json: { surfs: { surface: [x, y, w, h, ...] } }):
// how many, how many samples, and an estimate of their memory as the 32-bit lightmaps the game's renderer makes of
// them (4 bytes a sample; the map file keeps a bit a sample a light for the shadows instead, which the editor does not count)
export function lightmapTotals(lm) {
  const rects = Object.values(lm?.surfs || {});
  const samples = rects.reduce((s, r) => s + r[2] * r[3], 0);
  return { lightmaps: rects.length, samples, bytes: samples * 4 };
}
