// Map > Sky & time of day: how the sky of the map looks and how bright its day is.
// - The sky: one of the game's (edits.level.sky = key of editor/zones.py SKIES) or the map's own ('mine'),
//   painted here (day, sunset, night: a gradient, stars) or from a picture of the user's, imported as
//   textures of the map (edits.textures, from 'sky') and named in edits.level.skyLook {walls, top, bottom}.
//   It shows where the map is open to the sky (a Hole "open to the sky"); zones.skybox builds the sky box.
// - The clouds, for any of those skies: a cloud layer over the sky box (edits.level.clouds: look, amount,
//   size, height, brightness, wind speed and direction, and tex: the clouds painted here, or the game's own).
//   In the game it is made as the game's levels make it (zones.cloud_sheet): a sheet of the sky box whose
//   texture the engine pans (Auto U Pan, at the sky zone's TexUPanSpeed), in Deus Ex and Revision alike; the
//   painted sky gets the far clouds under its edge. The preview shows it as the game will, moving: drag it.
// - The light of the time of day: the map's ambient light (edits.level.ambient, as Map settings) and, by day
//   or at sunset, a sun: Deus Ex has no sunlight, so big lights high in every opening to the sky, set towards
//   the sun's side (added objects with Tag UCSun, made again each time).
const TIMES = {
  day: { label: 'Day', ambient: [56, 150, 40], sun: { bright: 255, hue: 32, sat: 230 }, bg: 0x8fb4dc },
  sunset: { label: 'Sunset', ambient: [28, 16, 120], sun: { bright: 210, hue: 16, sat: 90 }, bg: 0xc8784a },
  night: { label: 'Night', ambient: [10, 160, 150], sun: null, bg: 0x10141e },
};
const GAME_SKIES = [
  ['brightclouds', 'Bright clouds', 'day'], ['clouds', 'Grey clouds', 'day'], ['orangehaze', 'Orange haze', 'sunset'], ['sunset', 'Sunset', 'sunset'],
  ['hongkong', 'Hong Kong at night', 'night'], ['newyork', 'New York at night', 'night'], ['stars', 'Stars', 'night'],
];
const LOOKS = [
  ['none', 'None', 'No cloud layer'], ['soft', 'Soft', 'Hazy, soft-edged clouds'], ['puffy', 'Puffy', 'Separate round clouds'],
  ['streaks', 'Streaks', 'Long wisps along the wind'], ['game', "Game's", "The game's own clouds (CoreTexSky: the same in Deus Ex and Revision)"],
];
// the game's clouds (zones.GAME_CLOUDS)
const GAME_CLOUDS = [['ClenCloudBank_B', 'Cloud bank (Hong Kong)'], ['ClenCloudBank_A', 'Cloud bank, wide'], ['FlufBlueCloud_A', 'Fluffy blue'],
  ['FlufBlueCloud_B', 'Fluffy blue, thin'], ['SubtleCloud', 'Subtle']];
// the sky box as zones.py builds it: a cube SKY_SIZE wide seen from its centre; its painted walls have the
// zenith at the top row and the horizon at 62% of their height
const SKY_SIZE = 2048, HALF = SKY_SIZE / 2, HORIZON = 0.62;
// the cloud layer in world units, as zones.cloud_settings: keep the two in step
function layerOf(s) {
  const high = HALF * Math.tan(Math.min(30, Math.max(3, s.cloudHigh)) * Math.PI / 180);
  const goes = (s.wind + 180) * Math.PI / 180;
  return { high, tile: high * 2 * 2 ** (s.cloudSize / 100 * 3), speed: high * 0.1 * s.cloudSpeed / 100, dir: [Math.cos(goes), Math.sin(goes)] };
}
// the row of the painted walls where the layer meets them (their top row 0, the bottom 1)
const edgeRow = (s) => (1 - Math.tan(Math.min(30, Math.max(3, s.cloudHigh)) * Math.PI / 180)) / 2;

// periodic value noise (tiles every px by py cells)
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function noise(x, y, px, py, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const v = (i, j) => hash(((i % px) + px) % px, ((j % py) + py) % py, s);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
}
function fbm(u, v, bu, s, bv = bu) {     // u, v in 0..1 (periodic), bu cells along u, bv along v
  let a = 0, amp = 0.55, f = 1;
  for (let o = 0; o < 5; o++) { a += amp * noise(u * bu * f, v * bv * f, bu * f, bv * f, s + o); amp *= 0.5; f *= 2; }
  return a;
}
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const ramp = (x, a, w) => { const t = Math.max(0, Math.min(1, (x - a) / w)); return t * t * (3 - 2 * t); };
const PALETTE = {
  day: { zenith: [62, 112, 196], mid: [118, 164, 224], horizon: [206, 222, 238], ground: [150, 158, 166], cloud: [250, 250, 252], shade: [178, 188, 204] },
  sunset: { zenith: [40, 36, 84], mid: [150, 70, 92], horizon: [250, 150, 70], ground: [70, 50, 52], cloud: [255, 196, 150], shade: [120, 70, 90] },
  night: { zenith: [6, 8, 18], mid: [12, 16, 34], horizon: [34, 36, 58], ground: [10, 10, 14], cloud: [60, 62, 82], shade: [26, 28, 40] },
};
// the colour the layer adds (it is translucent: added to the sky behind it, black adds nothing)
const LAYER_RGB = { day: [255, 255, 255], sunset: [255, 192, 150], night: [96, 100, 128] };

// the clouds of the layer: density 0..1 on an n x n tile that repeats (u along the wind)
function cloudField(n, look, amount, seed) {
  const k = amount / 100, out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n;
    let d;
    // cells per tile: the layer is low (its far edge a few degrees over the horizon), so a cloud overhead is
    // big; with 5 cells one filled half the sky in the game (photos, 18 Oct 2026)
    if (look === 'streaks') d = ramp(fbm(u, v, 4, seed + 21, 20), 0.64 - 0.36 * k, 0.14);
    else if (look === 'puffy') { const f = fbm(u, v, 10, seed + 17); d = ramp(f, 0.66 - 0.3 * k, 0.08) * (0.75 + 0.25 * ramp(f, 0.7 - 0.3 * k, 0.15)); }
    else d = ramp(fbm(u, v, 6, seed + 13), 0.66 - 0.38 * k, 0.22) * 0.9;
    out[y * n + x] = d * Math.min(1, k * 10);       // none at 0
  }
  return out;
}
function paintClouds(n, s) {
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d'), img = g.createImageData(n, n), f = cloudField(n, s.cloudLook, s.clouds, s.seed);
  const rgb = LAYER_RGB[s.time], b = s.cloudBright / 100;
  for (let i = 0; i < n * n; i++) {
    img.data[i * 4] = rgb[0] * f[i] * b; img.data[i * 4 + 1] = rgb[1] * f[i] * b; img.data[i * 4 + 2] = rgb[2] * f[i] * b; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}
// the walls of the sky box: sky above the horizon, haze under it; tiles left-right. Clouds only under row
// `fromRow` (the far clouds, under the layer's edge; 0 = everywhere, 1 = none)
function paintWalls(w, h, time, clouds, seed, fromRow = 0) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), img = g.createImageData(w, h), P = PALETTE[time], k = clouds / 100;
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1), hz = HORIZON, band = ramp(t, fromRow - 0.02, 0.05);
    let c = t < 0.35 ? mix(P.zenith, P.mid, t / 0.35) : t < hz ? mix(P.mid, P.horizon, (t - 0.35) / (hz - 0.35)) : mix(P.horizon, P.ground, Math.min(1, (t - hz) / 0.12));
    // the last rows (under the ground, never seen) back to the zenith: the texture wraps, and filtering its top
    // row took the ground's grey from the bottom one (a pale line round the sky in the game, 18 Oct 2026)
    if (t > 0.94) c = mix(P.ground, P.zenith, (t - 0.94) / 0.06);
    for (let x = 0; x < w; x++) {
      let col = c;
      if (t < hz && k > 0 && band > 0) {
        // clouds flatter and denser towards the horizon (perspective)
        const persp = 1 - (hz - t) / hz;
        const n = fbm(x / w, (y / h) * (1.5 + persp * 2.5), 6, seed);
        const cover = Math.max(0, Math.min(1, (n - (0.62 - 0.32 * k)) / 0.18)) * (0.55 + 0.45 * persp) * band;
        col = mix(col, mix(P.cloud, P.shade, Math.max(0, n - 0.6) * 1.6), cover);
      }
      if (time === 'night' && t < hz && hash(x, y, seed + 9) > 0.9975) col = [235, 235, 245];     // stars
      const i = (y * w + x) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}
function paintTop(n, time, clouds, seed) {
  const cv = document.createElement('canvas'); cv.width = n; cv.height = n;
  const g = cv.getContext('2d'), img = g.createImageData(n, n), P = PALETTE[time], k = clouds / 100;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let col = P.zenith;
    if (k > 0) {
      const v = fbm(x / n, y / n, 4, seed + 3);
      col = mix(col, P.cloud, Math.max(0, Math.min(1, (v - (0.66 - 0.3 * k)) / 0.2)) * 0.85);
    }
    if (time === 'night' && hash(x, y, seed + 11) > 0.997) col = [235, 235, 245];
    const i = (y * n + x) * 4;
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}
function paintBottom(time) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'); g.fillStyle = `rgb(${PALETTE[time].ground.join(',')})`; g.fillRect(0, 0, 64, 64);
  return cv;
}
const pixels = (cv) => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);

export function createSkyTool({ THREE, scene, getEdits, getScript, pushUndo, setDirty, rebuildProxies, api, log, escapeHtml, nextName }) {
  let dialog = null, frame = 0, look = null, field = null, began = 0;
  const state = {
    time: 'day', sky: 'made', clouds: 40, seed: 7, picture: null, sun: true, sunYaw: 135, sunHigh: 60, sunPower: 100, ambient: true,
    cloudLook: 'soft', cloudTex: 'ClenCloudBank_B', cloudSize: 25, cloudHigh: 8, cloudBright: 90, cloudSpeed: 25, wind: 135, viewYaw: 0, viewPitch: 35,
  };
  const layered = () => state.cloudLook !== 'none';
  function holes(edits) { return (edits.boxes || []).filter((b) => b.hole && b.sky); }
  // what the preview samples: the sky's walls and top (painted, the picture, or none for the game's) and the clouds
  function remakeSky() {
    look = null;
    if (state.sky === 'made') look = { walls: pixels(paintWalls(256, 128, state.time, layered() ? state.clouds : 0, state.seed, edgeRow(state))), top: pixels(paintTop(64, state.time, 0, state.seed)) };
    else if (state.sky === 'picture' && state.picture) {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; cv.getContext('2d').drawImage(state.picture, 0, 0, 256, 128);
      look = { walls: pixels(cv), top: pixels(paintTop(64, state.time, 0, state.seed)) };
    }
  }
  // what each texel of the layer adds to the sky: the painted clouds in the colour of the time, or the game's texture
  let gameImages = {};
  async function gameCloud(name) {
    if (!(name in gameImages)) {
      gameImages[name] = null;
      try {
        const tile = await api('/api/texture_tile?tex=' + encodeURIComponent(name));
        const info = await api('/api/texture_source?tex=' + encodeURIComponent(tile.ref || name) + '&script=' + encodeURIComponent(getScript()));
        const img = new Image();
        await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = info.url; });
        const cv = document.createElement('canvas'); cv.width = cv.height = 128; cv.getContext('2d').drawImage(img, 0, 0, 128, 128);
        gameImages[name] = cv.getContext('2d').getImageData(0, 0, 128, 128).data;
      } catch (_) { /* no picture: the preview shows soft clouds instead */ }
    }
    return gameImages[name];
  }
  function remakeClouds() {
    field = null;
    if (!layered()) return;
    field = new Float32Array(128 * 128 * 3);
    if (state.cloudLook === 'game') {
      const name = state.cloudTex;
      gameCloud(name).then((px) => {
        if (state.cloudLook !== 'game' || state.cloudTex !== name) return;
        const d = px ? null : cloudField(128, 'soft', 50, 1);
        for (let i = 0; i < 128 * 128; i++) for (let c = 0; c < 3; c++) field[i * 3 + c] = px ? px[i * 4 + c] : 200 * d[i];
      });
      return;
    }
    const d = cloudField(128, state.cloudLook, state.clouds, state.seed), rgb = LAYER_RGB[state.time], b = state.cloudBright / 100;
    for (let i = 0; i < 128 * 128; i++) for (let c = 0; c < 3; c++) field[i * 3 + c] = rgb[c] * d[i] * b;
  }
  function sample(img, u, v) {
    const x = Math.min(img.width - 1, Math.max(0, Math.floor(u * img.width))), y = Math.min(img.height - 1, Math.max(0, Math.floor(v * img.height)));
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }
  // the preview: what JC sees looking up a little, with the clouds where the game puts them, moving
  function drawPreview(now) {
    const cv = dialog && dialog.querySelector('#sky-prev');
    if (!cv) return;
    const W = 256, H = 80, g = cv.getContext('2d'), img = g.createImageData(W, H);
    const L = layerOf(state), P = PALETTE[state.time];
    const gone = L.tile > 0 ? ((now - began) / 1000 * L.speed) % L.tile : 0;
    const yaw = state.viewYaw * Math.PI / 180, pitch = state.viewPitch * Math.PI / 180, fx = Math.tan(50 * Math.PI / 180), fy = fx * H / W;
    const fwd = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
    const right = [-Math.sin(yaw), Math.cos(yaw), 0], up = [-Math.sin(pitch) * Math.cos(yaw), -Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch)];
    const ca = Math.cos(-Math.atan2(L.dir[1], L.dir[0])), sa = Math.sin(-Math.atan2(L.dir[1], L.dir[0]));
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const a = (px / (W - 1) * 2 - 1) * fx, b = (1 - py / (H - 1) * 2) * fy;
      const d = [fwd[0] + right[0] * a + up[0] * b, fwd[1] + right[1] * a + up[1] * b, fwd[2] + right[2] * a + up[2] * b];
      const n = Math.hypot(d[0], d[1], d[2]); d[0] /= n; d[1] /= n; d[2] /= n;
      // the sky box, from its centre
      const m = Math.max(Math.abs(d[0]), Math.abs(d[1])), tw = m > 1e-6 ? HALF / m : 1e9, zw = tw * d[2];
      let col;
      if (look && zw < HALF && zw > -HALF) {
        // each wall shows the picture once, its top row on the top edge (as zones.skybox maps it)
        const along = Math.abs(d[0]) > Math.abs(d[1]) ? tw * d[1] * Math.sign(d[0]) : -tw * d[0] * Math.sign(d[1]);
        col = sample(look.walls, (along + HALF) / SKY_SIZE, (HALF - zw) / SKY_SIZE);
      } else if (look && d[2] > 0) {
        const t = HALF / d[2];
        col = sample(look.top, ((t * d[0] / SKY_SIZE + 0.5) % 1 + 1) % 1, ((t * d[1] / SKY_SIZE + 0.5) % 1 + 1) % 1);
      } else {
        const t = Math.max(0, Math.min(1, 0.5 - d[2] * 0.9));       // the game's sky: just its colours
        col = t < HORIZON ? mix(P.zenith, P.horizon, t / HORIZON) : P.ground;
      }
      // the cloud layer: hit from below, inside the box
      if (field && d[2] > 0) {
        const t = L.high / d[2], x = t * d[0], y = t * d[1];
        if (Math.abs(x) < HALF && Math.abs(y) < HALF) {
          const lx = x * ca - y * sa - gone, ly = x * sa + y * ca;
          const u = ((lx / L.tile) % 1 + 1) % 1, v = ((ly / L.tile) % 1 + 1) % 1;
          // filtered, as the game draws a texture
          const gx = u * 128, gy = v * 128, x0 = Math.floor(gx) & 127, y0 = Math.floor(gy) & 127, x1 = (x0 + 1) & 127, y1 = (y0 + 1) & 127;
          const ax = gx - Math.floor(gx), ay = gy - Math.floor(gy);
          const at = (x, y, c) => field[(y * 128 + x) * 3 + c];
          // the game's translucency comes out close to a screen blend (measured on Revision photos, 18 Oct 2026)
          col = col.map((v, c) => {
            const k = (at(x0, y0, c) * (1 - ax) + at(x1, y0, c) * ax) * (1 - ay) + (at(x0, y1, c) * (1 - ax) + at(x1, y1, c) * ax) * ay;
            return v + k * (1 - v / 255);
          });
        }
      }
      const i = (py * W + px) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    }
    if (!drawPreview.cv) { drawPreview.cv = document.createElement('canvas'); drawPreview.cv.width = W; drawPreview.cv.height = H; }
    drawPreview.cv.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(drawPreview.cv, 0, 0, cv.width, cv.height);
    if (!look) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, cv.height - 22, cv.width, 22); g.fillStyle = '#ddd'; g.font = '11px sans-serif'; g.fillText("The game's sky shows after Rebuild; the clouds are as here", 8, cv.height - 7); }
  }
  function loop(now) {
    if (!dialog || !dialog.open) { frame = 0; return; }
    drawPreview(now);
    frame = requestAnimationFrame(loop);
  }
  const SHOW = { clouds: (v) => v + '%', cloudSize: (v) => v + '%', cloudHigh: (v) => v + '°', cloudBright: (v) => v + '%',
    cloudSpeed: (v) => (+v ? v + '%' : 'Still'), wind: (v) => v + '°', sunYaw: (v) => v + '°', sunHigh: (v) => v + '°', sunPower: (v) => v + '%' };
  const slider = (k, label, min, max, tip) => `<div class="row"><label title="${tip}">${label}</label><input type="range" min="${min}" max="${max}" value="${state[k]}" data-k="${k}" title="${tip}"><span class="hint">${SHOW[k](state[k])}</span></div>`;
  function render() {
    const edits = getEdits(), n = holes(edits).length, lit = state.time !== 'night', on = layered(), game = state.cloudLook === 'game';
    dialog.innerHTML = `<form method="dialog"><header><h2 id="sky-title">Sky &amp; time of day</h2><button type="button" data-close>Close</button></header><main>
      <div class="sky-times">${Object.entries(TIMES).map(([k, t]) => `<button type="button" data-time="${k}" class="${state.time === k ? 'on' : ''}" aria-pressed="${state.time === k}">${t.label}</button>`).join('')}</div>
      <label>Sky</label>
      <div class="sky-list">
        <label class="sky-opt"><input type="radio" name="sky" value="made" ${state.sky === 'made' ? 'checked' : ''}> Painted for this time</label>
        <label class="sky-opt"><input type="radio" name="sky" value="picture" ${state.sky === 'picture' ? 'checked' : ''}> Your picture <button type="button" data-pic>Choose…</button><input type="file" accept="image/*" hidden data-file></label>
        ${GAME_SKIES.filter(([, , t]) => t === state.time).map(([k, l]) => `<label class="sky-opt"><input type="radio" name="sky" value="${k}" ${state.sky === k ? 'checked' : ''}> ${escapeHtml(l)} <small>(the game's)</small></label>`).join('')}
      </div>
      <label>Clouds</label>
      <div class="sky-seg" role="group" aria-label="Clouds">${LOOKS.map(([k, l, tip]) => `<button type="button" data-look="${k}" class="${state.cloudLook === k ? 'on' : ''}" aria-pressed="${state.cloudLook === k}" title="${tip}">${l}</button>`).join('')}
        <button type="button" data-seed title="Other clouds" ${on && !game ? '' : 'disabled'}>↻</button></div>
      <div class="sky-grid" ${on ? '' : 'hidden'}>
        ${game ? `<div class="row"><label>Texture</label><select data-ctex title="The game's cloud texture">${GAME_CLOUDS.map(([k, l]) => `<option value="${k}" ${state.cloudTex === k ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></div>`
          : slider('clouds', 'Amount', 0, 100, 'How much of the sky the clouds cover')}
        ${slider('cloudSize', 'Size', 0, 100, 'How big the clouds are')}
        ${slider('cloudHigh', 'Height', 3, 30, 'How high the layer is: its far edge, in degrees over the horizon (low clouds reach down to it)')}
        ${game ? '' : slider('cloudBright', 'Brightness', 20, 100, 'How bright the clouds are')}
        ${slider('cloudSpeed', 'Wind', 0, 100, 'How fast the wind moves them (0: still)')}
        ${slider('wind', 'Wind from', 0, 359, 'Where the wind comes from, as the sun')}
      </div>
      <canvas id="sky-prev" width="512" height="160" class="sky-prev" title="Drag to look round"></canvas>
      ${lit ? `<label class="sky-check"><input type="checkbox" data-k="sun" ${state.sun ? 'checked' : ''}> Sunlight (big lights high in the openings to the sky)</label>
      <div class="sky-grid" ${state.sun ? '' : 'hidden'}>
        ${slider('sunYaw', 'Sun from', 0, 359, 'Where the sun is')}${slider('sunHigh', 'Sun height', 10, 90, 'How high the sun is')}
        ${slider('sunPower', 'Strength', 20, 100, 'How bright the sun is')}</div>` : ''}
      <label class="sky-check"><input type="checkbox" data-k="ambient" ${state.ambient ? 'checked' : ''}> The light of the ${TIMES[state.time].label.toLowerCase()} for the whole map (ambient)</label>
      <p class="hint">${n ? `The sky shows through the ${n} opening${n > 1 ? 's' : ''} to the sky of this map.` : 'This map has no opening to the sky yet: make a Hole and tick "open to the sky" (the sun goes in it too).'} Rebuild to see it.</p>
      <p class="sky-msg" role="status"></p></main><footer><button type="button" data-close>Cancel</button><button type="submit" class="primary">Apply</button></footer></form>`;
    for (const b of dialog.querySelectorAll('[data-close]')) b.onclick = () => dialog.close();
    for (const b of dialog.querySelectorAll('[data-time]')) b.onclick = () => {
      state.time = b.dataset.time;
      if (!['made', 'picture'].includes(state.sky)) state.sky = 'made';
      remakeSky(); remakeClouds(); render();
    };
    const ctex = dialog.querySelector('[data-ctex]'); if (ctex) ctex.onchange = () => { state.cloudTex = ctex.value; remakeClouds(); };
    for (const b of dialog.querySelectorAll('[data-look]')) b.onclick = () => { state.cloudLook = b.dataset.look; remakeSky(); remakeClouds(); render(); };
    for (const r of dialog.querySelectorAll('input[name=sky]')) r.onchange = () => { state.sky = r.value; remakeSky(); render(); };
    for (const i of dialog.querySelectorAll('[data-k]')) i.oninput = () => {
      const k = i.dataset.k;
      state[k] = i.type === 'checkbox' ? i.checked : +i.value;
      if (i.type === 'checkbox') { render(); return; }
      const s = i.parentElement.querySelector('.hint'); if (s && SHOW[k]) s.textContent = SHOW[k](i.value);
      if (k === 'clouds') { remakeClouds(); remakeSky(); } else if (k === 'cloudHigh') remakeSky(); else if (k === 'cloudBright') remakeClouds();
    };
    const seed = dialog.querySelector('[data-seed]'); if (seed) seed.onclick = () => { state.seed = (state.seed * 7 + 13) % 997; remakeSky(); remakeClouds(); };
    dialog.querySelector('[data-pic]').onclick = (e) => { e.preventDefault(); dialog.querySelector('[data-file]').click(); };
    dialog.querySelector('[data-file]').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      state.picture = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(); i.src = URL.createObjectURL(f); });
      state.sky = 'picture'; remakeSky(); render();
    };
    const prev = dialog.querySelector('#sky-prev');
    prev.onpointerdown = (e) => {
      const x0 = e.clientX, y0 = e.clientY, yaw0 = state.viewYaw, pitch0 = state.viewPitch; prev.setPointerCapture(e.pointerId);
      prev.onpointermove = (m) => {
        state.viewYaw = ((yaw0 - (m.clientX - x0) * 0.4) % 360 + 360) % 360;
        state.viewPitch = Math.max(0, Math.min(80, pitch0 + (m.clientY - y0) * 0.3));
      };
      prev.onpointerup = () => { prev.onpointermove = null; };
    };
    dialog.querySelector('form').onsubmit = (e) => { e.preventDefault(); apply().catch((err) => { dialog.querySelector('.sky-msg').textContent = err.message; }); };
    if (!frame) frame = requestAnimationFrame(loop);
  }
  async function importCanvas(cv, base) {
    const edits = getEdits();
    const info = await api('/api/texture_import?script=' + encodeURIComponent(getScript()), { png: cv.toDataURL('image/png'), base, world: null, existing: Object.keys(edits.textures || {}) });
    edits.textures = edits.textures || {};
    edits.textures[info.name] = { pcx: info.pcx, png: info.png, w: info.w, h: info.h, masked: false, scale: 1, from: 'sky' };
    return info.name;
  }
  async function apply() {
    const edits = getEdits(), msg = dialog.querySelector('.sky-msg'), on = layered();
    if (state.sky === 'picture' && !state.picture) throw new Error('Choose your picture first.');
    msg.textContent = 'Making the sky…';
    pushUndo();
    edits.level = edits.level || {};
    for (const [k, t] of Object.entries(edits.textures || {})) if (t.from === 'sky') delete edits.textures[k];     // the old painted sky
    delete edits.level.skyLook;
    if (state.sky === 'made' || state.sky === 'picture') {
      let walls;
      // the clouds overhead are the layer's; the painted walls keep only the far ones, under its edge
      if (state.sky === 'made') walls = paintWalls(1024, 1024, state.time, on ? state.clouds : 0, state.seed, edgeRow(state));
      else { walls = document.createElement('canvas'); walls.width = walls.height = 1024; walls.getContext('2d').drawImage(state.picture, 0, 0, 1024, 1024); }
      edits.level.skyLook = { walls: await importCanvas(walls, 'SkyWalls'), top: await importCanvas(paintTop(512, state.time, 0, state.seed), 'SkyTop'),
        bottom: await importCanvas(paintBottom(state.time), 'SkyBottom') };
      edits.level.sky = 'mine';
    } else edits.level.sky = state.sky;
    edits.level.skyKind = state.sky;
    edits.level.time = state.time;
    edits.level.clouds = { look: state.cloudLook, amount: state.clouds, size: state.cloudSize, height: state.cloudHigh, bright: state.cloudBright,
      speed: state.cloudSpeed, wind: state.wind, seed: state.seed };
    if (state.cloudLook === 'game') edits.level.clouds.tex = state.cloudTex;          // the game's: nothing to import
    else if (on) edits.level.clouds.tex = await importCanvas(paintClouds(512, state), 'SkyClouds');
    if (state.ambient) {
      const [b, hue, sat] = TIMES[state.time].ambient;
      edits.level.ambient = { AmbientBrightness: b, AmbientHue: hue, AmbientSaturation: sat };
    }
    // the sun: made again each time (its lights are ordinary objects of the map, Tag UCSun)
    edits.added = (edits.added || []).filter((a) => !(a.props && a.props.Tag === 'UCSun'));
    const sun = TIMES[state.time].sun, opens = holes(edits);
    let made = 0;
    if (sun && state.sun) {
      const a = state.sunYaw * Math.PI / 180;
      for (const b of opens) {
        const c = [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2], half = [(b.hi[0] - b.lo[0]) / 2, (b.hi[1] - b.lo[1]) / 2];
        // towards the sun's side of the opening, high: the light comes from there (lower sun: further out)
        const out = 0.85 - 0.6 * (state.sunHigh / 90);
        const loc = [Math.round(c[0] + Math.cos(a) * half[0] * out), Math.round(c[1] + Math.sin(a) * half[1] * out), Math.round(b.hi[2] - 48)];
        edits.added.push({ name: nextName('UCEdit'), cls: 'Light', loc, rot: [0, 0, 0], radius: 8, height: 8,
          props: { Tag: 'UCSun', LightBrightness: Math.round(sun.bright * state.sunPower / 100), LightHue: sun.hue, LightSaturation: sun.sat, LightRadius: 255 } });
        made++;
      }
    }
    setDirty(); rebuildProxies();
    scene.background = new THREE.Color(TIMES[state.time].bg);
    const where = opens.length ? '' : ' (the map has no opening to the sky yet: make a Hole "open to the sky")';
    const what = state.sky === 'made' ? 'painted sky' : state.sky === 'picture' ? 'your picture as the sky' : 'the game\'s sky';
    const clouds = on ? `, ${state.cloudLook} clouds${state.cloudSpeed ? ' in the wind' : ''}` : '';
    log(`${TIMES[state.time].label}: ${what}${clouds}${made ? `, the sun in ${made} opening${made > 1 ? 's' : ''}` : ''}${state.ambient ? ', the light of the ' + TIMES[state.time].label.toLowerCase() : ''}${where}. Rebuild to see it.`, 'ok');
    dialog.close();
  }
  // the dialog opens as the map's sky was left (the picture itself is not kept: choose it again)
  function restore(lv) {
    if (lv.time && TIMES[lv.time]) state.time = lv.time;
    const kind = lv.skyKind || (lv.sky === 'mine' ? 'made' : lv.sky);
    if (kind === 'made' || (kind === 'picture' && state.picture)) state.sky = kind;
    else if (GAME_SKIES.some(([k, , t]) => k === kind && t === state.time)) state.sky = kind;
    const c = lv.clouds;
    if (c) Object.assign(state, { cloudLook: LOOKS.some(([k]) => k === c.look) ? c.look : 'none', clouds: c.amount ?? state.clouds, cloudSize: c.size ?? state.cloudSize,
      cloudHigh: c.height ?? state.cloudHigh, cloudBright: c.bright ?? state.cloudBright, cloudSpeed: c.speed ?? state.cloudSpeed, wind: c.wind ?? state.wind, seed: c.seed ?? state.seed,
      cloudTex: c.look === 'game' && GAME_CLOUDS.some(([k]) => k === c.tex) ? c.tex : state.cloudTex });
    else if (lv.sky) state.cloudLook = 'none';           // a sky made before the cloud layer: no layer
  }
  function open() {
    if (!getScript()) return;
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.className = 'map-dialog sky-dialog'; dialog.setAttribute('aria-labelledby', 'sky-title');
      document.body.appendChild(dialog);
      const css = document.createElement('style');
      css.textContent = `.sky-dialog main > label { display:block; margin:10px 0 4px; }
        .sky-times { display:flex; gap:6px; } .sky-times button { flex:1; height:22px; padding:0 8px; } .sky-times button.on, .sky-seg button.on { background:var(--primary-soft, #1f3b63); border-color:var(--acc); }
        .sky-seg { display:flex; gap:4px; } .sky-seg button { flex:1; height:22px; padding:0 8px; } .sky-seg [data-seed] { flex:0 0 28px; padding:0; }
        .sky-list { display:flex; flex-direction:column; gap:4px; } .sky-opt { display:flex; align-items:center; gap:6px; } .sky-opt small { color:var(--dim); }
        .sky-opt button { height:22px; padding:0 8px; }
        .sky-prev { display:block; width:100%; height:auto; margin:8px 0; border:1px solid var(--line); border-radius:var(--radius-input, 2px); cursor:grab; touch-action:none; }
        .sky-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); column-gap:12px; margin-top:4px; }
        .sky-grid[hidden] { display:none; }
        .sky-dialog .row { display:flex; align-items:center; gap:8px; margin:4px 0; height:22px; } .sky-dialog .row > label { flex:0 0 76px; }
        .sky-dialog .row select { flex:1; min-width:0; height:22px; }
        .sky-dialog .row input[type=range] { flex:1; min-width:0; padding:0; border:0; background:transparent; }   /* not the dialog's boxed inputs */ .sky-dialog .row .hint { flex:0 0 40px; text-align:right; font-variant-numeric:tabular-nums; }
        .sky-check { display:flex !important; align-items:center; gap:6px; margin:8px 0 4px !important; }
        .sky-msg { color:var(--warn); min-height:1em; }`;
      document.head.appendChild(css);
    }
    restore(getEdits().level || {});
    remakeSky(); remakeClouds();
    began = performance.now();
    render();
    if (!dialog.open) dialog.showModal();
  }
  // the colour the 3D view gives the faces that show the sky: the time of day chosen for the map (null: none chosen)
  const backdrop = (lv) => (lv && lv.time && TIMES[lv.time] ? TIMES[lv.time].bg : null);
  return { open, backdrop };
}
