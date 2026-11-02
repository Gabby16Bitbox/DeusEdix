// Skybox UVs shared by the Sky preview and its tests against zones.skybox.
export const SKY_CENTER = [-24000, -24000, -24000];
export const SKY_EXTENT = 2048;
export const SKY_TEXTURES = {
  hongkong: [['HK_City_A_A', 2048], ['starslesser', 1024], ['starslesser', 1024]],
  newyork: [['NY_1', 2048], ['starslesser', 1024], ['starslesser', 1024]],
  stars: [['ColorStars_A', 1024], ['ColorStars_A', 1024], ['ColorStars_A', 1024]],
  sunset: [['SunsetskyA_B', 2048], ['ClenCloudBank_B', 2048], ['ClenCloudBank_B', 2048]],
  clouds: [['ClenCloudBank_B', 2048], ['ClenCloudBank_B', 2048], ['ClenCloudBank_B', 2048]],
  brightclouds: [['FlufBlueCloud_B', 1024], ['FlufBlueCloud_A', 1024], ['FlufBlueCloud_A', 1024]],
  orangehaze: [['ClenOrngeHaze_A', 2048], ['ClenCloudBank_B', 2048], ['ClenCloudBank_B', 2048]],
};
export function backgroundSettings(value = {}) {
  const number = (key, fallback, lo, hi) => {
    const v = Number(value?.[key] ?? fallback);
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  };
  const texture = typeof value?.texture === 'string' && /^[\w.]+$/.test(value.texture) ? value.texture : '';
  return { height: number('height', 0, -100, 100), horizontal: number('horizontal', 0, -100, 100),
    scale: number('scale', 100, 25, 200), texture };
}
// point is relative to the SkyZoneInfo. face is 0..5 (-x,+x,-y,+y,-z,+z).
// Texture dimensions matter: the game's scalar tile preserves the texture's aspect ratio.
export function skyProjection(face, { tile, width, height, painted = false }, background = {}) {
  const wall = face < 4, half = SKY_EXTENT / 2, c = SKY_CENTER;
  const dirs = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [1, 0, 0], [1, 0, 0]];
  const u = dirs[face], v = wall ? [0, 0, -1] : [0, face === 4 ? 1 : -1, 0];
  const align = wall && painted ? [c[0] - half, c[1] - half, c[2] + half] : [0, 0, 0];
  const su = Array.isArray(tile) ? tile[0] : tile;
  const sv = Array.isArray(tile) ? tile[1] : tile * height / width;
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  const anchor = c.map((x, i) => x - align[i]);
  const centerU = dot(anchor, u) / su;
  const centerV = (dot(anchor, v) + (wall && painted ? 2 : 0)) / sv;
  const s = wall ? backgroundSettings(background) : { scale: 100, height: 0, horizontal: 0 };
  return [centerU - s.horizontal / 100, ...u.map(x => x / su * 100 / s.scale),
    centerV + s.height / 100, ...v.map(x => x / sv * 100 / s.scale)];
}
export function skyUV(point, face, recipe, background = {}) {
  const p = skyProjection(face, recipe, background);
  return [p[0] + p[1]*point[0] + p[2]*point[1] + p[3]*point[2],
    p[4] + p[5]*point[0] + p[6]*point[1] + p[7]*point[2]];
}
