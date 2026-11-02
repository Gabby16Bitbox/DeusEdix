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
import { SKY_TEXTURES, backgroundSettings, skyProjection } from './sky-background.js';

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

// refuseWhileBuilding(what): throws while a Rebuild runs (app.js: the map waits for it), saying so with `what`
export function createSkyTool({ THREE, scene, getEdits, getScript, pushUndo, setDirty, rebuildProxies, api, log, escapeHtml, nextName,
  warnHiddenKinds, proxyOf, refuseWhileBuilding, onPreview = () => {} }) {
  let dialog = null, frame = 0, look = null, field = null, began = 0, skyRequest = 0;
  let previewMessage = '', savedLook = null, applying = false, sunChanged = false, cloudsChanged = false;
  const state = {
    time: 'day', sky: 'made', clouds: 40, seed: 7, picture: null, sun: true, sunYaw: 135, sunHigh: 60, sunPower: 100, ambient: true,
    cloudLook: 'soft', cloudTex: 'ClenCloudBank_B', cloudSize: 25, cloudHigh: 8, cloudBright: 90, cloudSpeed: 25, wind: 135, viewYaw: 0, viewPitch: 5,
    background: backgroundSettings(), backgroundPicture: null,
  };
  const initialState = structuredClone(state);
  let viewportSignature = '', viewportScript = null, savedCloudTex = null, disposed = false;
  function publishPreview() {
    if (!disposed) onPreview(look ? { look, field, layer: layerOf(state), background: { ...state.background } } : null);
  }
  // Loading, Undo and Apply all go through this. The open dialog owns its temporary preview until closed.
  function syncViewport(force = false) {
    const script = getScript(), lv = getEdits().level || {};
    if (disposed || (dialog?.open && viewportScript === script && !force)) return;
    if (dialog?.open && viewportScript !== script) dialog.close();
    const signature = JSON.stringify([script, lv.sky, lv.skyKind, lv.skyLook, lv.skyBackground, lv.clouds, lv.time]);
    if (!force && signature === viewportSignature) return;
    viewportSignature = signature; viewportScript = script;
    ++skyRequest; look = null; field = null; publishPreview();
    if (!script || !lv.sky) return;
    restore(lv);
    return Promise.all([remakeSky(), remakeClouds()]);
  }
  const layered = () => state.cloudLook !== 'none';
  function holes(edits) { return (edits.boxes || []).filter((b) => b.hole && b.sky); }
  // what the preview samples: the sky's walls and top (painted, the picture, or none for the game's) and the clouds
  const textureImages = new Map();
  async function textureImage(name) {
    const script = getScript(), key = script + ':' + name;
    if (!textureImages.has(key)) textureImages.set(key, (async () => {
      const own = getEdits().textures?.[name];
      const tile = own ? { ref: name } : await api('/api/texture_tile?tex=' + encodeURIComponent(name));
      const info = await api('/api/texture_source?tex=' + encodeURIComponent(tile.ref || name) + '&script=' + encodeURIComponent(script));
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Could not read ' + name)); i.src = info.url; });
      const cv = document.createElement('canvas'); cv.width = Math.min(1024, info.w); cv.height = Math.max(1, Math.round(cv.width * info.h / info.w));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      return pixels(cv);
    })().catch(e => { textureImages.delete(key); throw e; }));
    return textureImages.get(key);
  }
  const fromPicture = (picture) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    cv.getContext('2d').drawImage(picture, 0, 0, 512, 512); return pixels(cv);
  };
  async function remakeSky() {
    const request = ++skyRequest;
    previewMessage = 'Loading background…';
    const slot = (image, tile, painted = false) => ({ image, tile, width: image.width, height: image.height, painted });
    try {
      let next;
      if (state.sky === 'made') {
        next = [slot(pixels(paintWalls(256, 256, state.time, layered() ? state.clouds : 0, state.seed, edgeRow(state))), [SKY_SIZE, SKY_SIZE], true),
          slot(pixels(paintTop(64, state.time, 0, state.seed)), 2048), slot(pixels(paintBottom(state.time)), 2048)];
      } else if (state.sky === 'picture' && state.picture) {
        next = [slot(fromPicture(state.picture), [SKY_SIZE, SKY_SIZE], true), slot(pixels(paintTop(64, state.time, 0, state.seed)), 2048), slot(pixels(paintBottom(state.time)), 2048)];
      } else if ((state.sky === 'picture' || state.sky === 'saved') && savedLook?.walls) {
        next = await Promise.all([savedLook.walls, savedLook.top || savedLook.walls, savedLook.bottom || savedLook.top || savedLook.walls]
          .map(async (name, i) => slot(await textureImage(name), i ? 2048 : [SKY_SIZE, SKY_SIZE], !i)));
      } else if (SKY_TEXTURES[state.sky]) {
        next = await Promise.all(SKY_TEXTURES[state.sky].map(async ([name, tile]) => slot(await textureImage(name), tile)));
      } else throw new Error('Choose a sky picture.');
      if (state.backgroundPicture) next[0] = slot(fromPicture(state.backgroundPicture), [SKY_SIZE, SKY_SIZE], true);
      else if (state.background.texture) next[0] = slot(await textureImage(state.background.texture), [SKY_SIZE, SKY_SIZE], true);
      if (request !== skyRequest) return;
      look = next; previewMessage = '';
    } catch (e) {
      if (request !== skyRequest) return;
      look = null; previewMessage = 'Preview unavailable: ' + e.message;
    }
    publishPreview();
    if (dialog) dialog.querySelector('[data-preview-status]')?.replaceChildren(document.createTextNode(previewMessage));
  }
  // what each texel of the layer adds to the sky: the painted clouds in the colour of the time, or the game's texture
  async function gameCloud(name) {
    const image = await textureImage(name);
    const src = document.createElement('canvas'); src.width = image.width; src.height = image.height;
    src.getContext('2d').putImageData(image, 0, 0);
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    cv.getContext('2d').drawImage(src, 0, 0, 128, 128);
    return pixels(cv).data;
  }
  async function remakeClouds() {
    field = null;
    if (!layered()) { publishPreview(); return; }
    const target = field = new Float32Array(128 * 128 * 3);
    const name = !cloudsChanged && savedCloudTex ? savedCloudTex : state.cloudLook === 'game' ? state.cloudTex : null;
    if (name) {
      let px = null;
      try { px = await gameCloud(name); } catch { /* texture unavailable: soft clouds as in the dialog */ }
      if (field !== target) return;
      const d = px ? null : cloudField(128, 'soft', 50, 1);
      for (let i = 0; i < 128 * 128; i++) for (let c = 0; c < 3; c++) target[i*3+c] = px ? px[i*4+c] : 200*d[i];
      field = target.slice(); // new data identity: upload to the GPU once, not on every slider move
    } else {
      const d = cloudField(128, state.cloudLook, state.clouds, state.seed), rgb = LAYER_RGB[state.time], b = state.cloudBright / 100;
      for (let i = 0; i < 128 * 128; i++) for (let c = 0; c < 3; c++) field[i*3+c] = rgb[c]*d[i]*b;
    }
    publishPreview();
  }
  function sample(img, u, v) {
    const x = Math.floor(((u % 1 + 1) % 1) * img.width), y = Math.floor(((v % 1 + 1) % 1) * img.height);
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }
  // the preview: what JC sees looking up a little, with the clouds where the game puts them, moving
  function drawPreview(now) {
    const cv = dialog && dialog.querySelector('#sky-prev');
    if (!cv) return;
    const W = 384, H = 160, g = cv.getContext('2d'), img = g.createImageData(W, H);
    const L = layerOf(state), P = PALETTE[state.time];
    const gone = L.tile > 0 ? ((now - began) / 1000 * L.speed) % L.tile : 0;
    const yaw = state.viewYaw * Math.PI / 180, pitch = state.viewPitch * Math.PI / 180, fx = Math.tan(50 * Math.PI / 180), fy = fx * H / W;
    const fwd = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
    const right = [-Math.sin(yaw), Math.cos(yaw), 0], up = [-Math.sin(pitch) * Math.cos(yaw), -Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch)];
    const ca = Math.cos(-Math.atan2(L.dir[1], L.dir[0])), sa = Math.sin(-Math.atan2(L.dir[1], L.dir[0]));
    const mappings = look && [0, 1, 2, 3, 4, 5].map(face => skyProjection(face, look[face < 4 ? 0 : face === 4 ? 2 : 1], state.background));
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const a = (px / (W - 1) * 2 - 1) * fx, b = (1 - py / (H - 1) * 2) * fy;
      const d = [fwd[0] + right[0] * a + up[0] * b, fwd[1] + right[1] * a + up[1] * b, fwd[2] + right[2] * a + up[2] * b];
      const n = Math.hypot(d[0], d[1], d[2]); d[0] /= n; d[1] /= n; d[2] /= n;
      // the sky box, from its centre
      const m = Math.max(Math.abs(d[0]), Math.abs(d[1])), tw = m > 1e-6 ? HALF / m : 1e9, zw = tw * d[2];
      let col;
      if (look) {
        const wall = zw < HALF && zw > -HALF;
        const face = wall ? (Math.abs(d[0]) > Math.abs(d[1]) ? (d[0] < 0 ? 0 : 1) : (d[1] < 0 ? 2 : 3)) : (d[2] < 0 ? 4 : 5);
        const t = wall ? tw : HALF / Math.abs(d[2]), slot = look[wall ? 0 : d[2] > 0 ? 1 : 2];
        const p = mappings[face], u = p[0] + t*(p[1]*d[0] + p[2]*d[1] + p[3]*d[2]), v = p[4] + t*(p[5]*d[0] + p[6]*d[1] + p[7]*d[2]);
        col = sample(slot.image, u, v);
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
  }
  let lastFrame = 0;
  function loop(now) {
    if (!dialog || !dialog.open) { frame = 0; return; }
    if (now - lastFrame >= 1000 / 30 && dialog.querySelector('.sky-background')?.open) { drawPreview(now); lastFrame = now; }
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
        ${state.sky === 'saved' ? '<label class="sky-opt"><input type="radio" name="sky" value="saved" checked> Current custom sky</label>' : ''}
        <label class="sky-opt"><input type="radio" name="sky" value="made" ${state.sky === 'made' ? 'checked' : ''}> Painted for this time</label>
        <label class="sky-opt"><input type="radio" name="sky" value="picture" ${state.sky === 'picture' ? 'checked' : ''}> Your picture <button type="button" data-pic>Choose…</button><input type="file" accept="image/*" hidden data-file></label>
        ${GAME_SKIES.filter(([, , t]) => t === state.time).map(([k, l]) => `<label class="sky-opt"><input type="radio" name="sky" value="${k}" ${state.sky === k ? 'checked' : ''}> ${escapeHtml(l)} <small>(the game's)</small></label>`).join('')}
      </div>
      <details class="sky-background" open><summary>Background</summary>
        <div class="row"><label for="sky-background-texture">Texture</label>
          <select id="sky-background-texture" title="The distant background on the sides of the sky">
            <option value="">Same as sky</option>
            ${[['HK_City_A_A', 'Hong Kong skyline'], ['NY_1', 'New York skyline'], ['ColorStars_A', 'Stars']]
              .map(([k, l]) => `<option value="${k}" ${state.background.texture === k ? 'selected' : ''}>${l}</option>`).join('')}
            ${state.background.texture && !['HK_City_A_A', 'NY_1', 'ColorStars_A'].includes(state.background.texture) ? `<option value="${escapeHtml(state.background.texture)}" selected>Your picture</option>` : ''}
          </select><button type="button" data-background-picture title="Use a picture for the distant background">Import…</button>
          <input type="file" accept="image/*" hidden data-background-file>
        </div>
        ${[['height', 'Height', -100, 100, 'Lower the value to lower the skyline. Percentage of one texture repeat.'],
          ['scale', 'Size', 25, 200, 'Size of the background picture. 100% keeps its original size.'],
          ['horizontal', 'Horizontal', -100, 100, 'Move the picture left or right. Percentage of one texture repeat.']].map(([k,l,min,max,tip]) =>
          `<div class="row"><label for="sky-background-${k}" title="${tip}">${l}</label><input id="sky-background-${k}" type="range" data-background="${k}" min="${min}" max="${max}" step="0.5" value="${state.background[k]}" title="${tip}"><input type="number" data-background-number="${k}" min="${min}" max="${max}" step="0.5" value="${state.background[k]}" aria-label="${l} percent" title="${tip}"><span class="sky-unit">%</span></div>`).join('')}
        <div class="sky-preview-heading"><span>Live preview</span><button type="button" data-background-reset title="Reset background position and size">Reset</button></div>
        <canvas id="sky-prev" width="768" height="320" class="sky-prev" title="Drag to look around; arrow keys turn the preview" tabindex="0" aria-label="Sky preview. Drag or use arrow keys to look around."></canvas>
        <p class="hint" data-preview-status role="status">${escapeHtml(previewMessage)}</p>
      </details>
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
      ${lit ? `<label class="sky-check"><input type="checkbox" data-k="sun" ${state.sun ? 'checked' : ''}> Sunlight (big lights high in the openings to the sky)</label>
      <div class="sky-grid" ${state.sun ? '' : 'hidden'}>
        ${slider('sunYaw', 'Sun from', 0, 359, 'Where the sun is')}${slider('sunHigh', 'Sun height', 10, 90, 'How high the sun is')}
        ${slider('sunPower', 'Strength', 20, 100, 'How bright the sun is')}</div>` : ''}
      <label class="sky-check"><input type="checkbox" data-k="ambient" ${state.ambient ? 'checked' : ''}> The light of the ${TIMES[state.time].label.toLowerCase()} for the whole map (ambient)</label>
      <p class="hint">${n ? 'Preview updates while you adjust. Apply, then Rebuild for the game.' : 'Add a Hole with “open to the sky” to show this sky in the map.'}</p>
      <p class="sky-msg" role="status"></p></main><footer><button type="button" data-close>Cancel</button><button type="submit" class="primary">Apply</button></footer></form>`;
    for (const b of dialog.querySelectorAll('[data-close]')) b.onclick = () => dialog.close();
    for (const b of dialog.querySelectorAll('[data-time]')) b.onclick = () => {
      state.time = b.dataset.time; sunChanged = true; cloudsChanged = true;
      if (!['made', 'picture', 'saved'].includes(state.sky)) state.sky = 'made';
      remakeSky(); remakeClouds(); render();
    };
    const ctex = dialog.querySelector('[data-ctex]'); if (ctex) ctex.onchange = () => { cloudsChanged = true; state.cloudTex = ctex.value; remakeClouds(); };
    for (const b of dialog.querySelectorAll('[data-look]')) b.onclick = () => { cloudsChanged = true; state.cloudLook = b.dataset.look; remakeSky(); remakeClouds(); render(); };
    for (const r of dialog.querySelectorAll('input[name=sky]')) r.onchange = () => { state.sky = r.value; remakeSky(); render(); };
    for (const i of dialog.querySelectorAll('[data-k]')) i.oninput = () => {
      const k = i.dataset.k;
      if (k.startsWith('sun')) sunChanged = true;
      if (k.startsWith('cloud') || k === 'wind') cloudsChanged = true;
      state[k] = i.type === 'checkbox' ? i.checked : +i.value;
      if (i.type === 'checkbox') { render(); return; }
      const s = i.parentElement.querySelector('.hint'); if (s && SHOW[k]) s.textContent = SHOW[k](i.value);
      if (k === 'clouds') { remakeClouds(); remakeSky(); } else if (k === 'cloudHigh') remakeSky(); else if (k === 'cloudBright') remakeClouds();
      publishPreview();
    };
    const seed = dialog.querySelector('[data-seed]'); if (seed) seed.onclick = () => { cloudsChanged = true; state.seed = (state.seed * 7 + 13) % 997; remakeSky(); remakeClouds(); };
    for (const input of dialog.querySelectorAll('[data-background], [data-background-number]')) input.oninput = () => {
      if (input.value === '' || !Number.isFinite(input.valueAsNumber)) return;
      const key = input.dataset.background || input.dataset.backgroundNumber;
      state.background = backgroundSettings({ ...state.background, [key]: input.valueAsNumber });
      publishPreview();
      for (const peer of dialog.querySelectorAll(`[data-background="${key}"], [data-background-number="${key}"]`)) if (peer !== input) peer.value = state.background[key];
    };
    dialog.querySelector('#sky-background-texture').onchange = e => {
      state.background.texture = e.target.value; state.backgroundPicture = null; remakeSky();
    };
    dialog.querySelector('[data-background-reset]').onclick = () => {
      state.background = { ...state.background, height: 0, horizontal: 0, scale: 100 }; publishPreview(); render();
    };
    const readPicture = async (file) => {
      const url = URL.createObjectURL(file);
      try { return await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('This picture could not be read.')); i.src = url; }); }
      finally { URL.revokeObjectURL(url); }
    };
    dialog.querySelector('[data-background-picture]').onclick = () => dialog.querySelector('[data-background-file]').click();
    dialog.querySelector('[data-background-file]').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      try { state.backgroundPicture = await readPicture(file); state.background.texture = 'pending_picture'; remakeSky(); render(); }
      catch (err) { dialog.querySelector('.sky-msg').textContent = err.message; }
    };
    dialog.querySelector('[data-pic]').onclick = (e) => { e.preventDefault(); dialog.querySelector('[data-file]').click(); };
    dialog.querySelector('[data-file]').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { state.picture = await readPicture(f); state.sky = 'picture'; remakeSky(); render(); }
      catch (err) { dialog.querySelector('.sky-msg').textContent = err.message; }
    };
    const prev = dialog.querySelector('#sky-prev');
    prev.onpointerdown = (e) => {
      const x0 = e.clientX, y0 = e.clientY, yaw0 = state.viewYaw, pitch0 = state.viewPitch; prev.setPointerCapture(e.pointerId);
      prev.onpointermove = (m) => {
        state.viewYaw = ((yaw0 - (m.clientX - x0) * 0.4) % 360 + 360) % 360;
        state.viewPitch = Math.max(-80, Math.min(80, pitch0 + (m.clientY - y0) * 0.3));
      };
      prev.onpointerup = prev.onpointercancel = () => { prev.onpointermove = null; };
    };
    prev.onkeydown = e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      state.viewYaw += e.key === 'ArrowLeft' ? -5 : e.key === 'ArrowRight' ? 5 : 0;
      state.viewPitch = Math.max(-80, Math.min(80, state.viewPitch + (e.key === 'ArrowUp' ? 5 : e.key === 'ArrowDown' ? -5 : 0)));
    };
    dialog.querySelector('form').onsubmit = async (e) => {
      e.preventDefault(); if (applying) return;
      applying = true;
      const submit = dialog.querySelector('[type=submit]'); submit.disabled = true;
      dialog.querySelector('main').inert = true;
      try { await apply(); } catch (err) { dialog.querySelector('.sky-msg').textContent = err.message; }
      finally { applying = false; submit.disabled = false; dialog.querySelector('main').inert = false; }
    };
    if (!frame) frame = requestAnimationFrame(loop);
  }
  // a picture made a texture of the map, named apart from `taken` (the map's other textures) and from those made before
  // it: its name, and its entry in `made` (put in the edits with the rest of the sky, apply)
  async function importCanvas(cv, base, taken, made) {
    const info = await api('/api/texture_import?script=' + encodeURIComponent(getScript()), { png: cv.toDataURL('image/png'), base, world: null, existing: [...taken, ...Object.keys(made)] });
    refuseWhileBuilding('the sky waits');              // a Rebuild started meanwhile: nothing is changed
    made[info.name] = { pcx: info.pcx, png: info.png, w: info.w, h: info.h, masked: false, scale: 1, from: 'sky' };
    return info.name;
  }
  // The sky: its pictures imported first, then the edits changed in one go (one Ctrl+Z), so a Rebuild that starts while
  // they are imported finds the map as it was. Not while a Rebuild runs: the dialog says so
  async function apply() {
    const edits = getEdits(), msg = dialog.querySelector('.sky-msg'), on = layered();
    if (state.sky === 'picture' && !state.picture && !savedLook?.walls) throw new Error('Choose your picture first.');
    if (!look || previewMessage) throw new Error(previewMessage || 'Wait for the background preview to load.');
    refuseWhileBuilding('the sky waits');
    msg.textContent = 'Making the sky…';
    const own = edits.textures || {}, made = {};
    const taken = Object.keys(own); // Never overwrite an image still used by Undo or a saved custom sky.
    let skyLook = state.sky === 'saved' || (state.sky === 'picture' && !state.picture) ? savedLook : null;
    let cloudTex = state.cloudTex;
    const background = { ...state.background };
    if (state.backgroundPicture) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1024;
      cv.getContext('2d').drawImage(state.backgroundPicture, 0, 0, 1024, 1024);
      background.texture = await importCanvas(cv, 'SkyBackground', taken, made);
      made[background.texture].from = 'sky-background';
    }
    if (state.sky === 'made' || (state.sky === 'picture' && state.picture)) {
      let walls;
      // the clouds overhead are the layer's; the painted walls keep only the far ones, under its edge
      if (state.sky === 'made') walls = paintWalls(1024, 1024, state.time, on ? state.clouds : 0, state.seed, edgeRow(state));
      else { walls = document.createElement('canvas'); walls.width = walls.height = 1024; walls.getContext('2d').drawImage(state.picture, 0, 0, 1024, 1024); }
      skyLook = { walls: await importCanvas(walls, 'SkyWalls', taken, made), top: await importCanvas(paintTop(512, state.time, 0, state.seed), 'SkyTop', taken, made),
        bottom: await importCanvas(paintBottom(state.time), 'SkyBottom', taken, made) };
    }
    if (state.cloudLook !== 'game' && on) cloudTex = !cloudsChanged && edits.level?.clouds?.tex
      ? edits.level.clouds.tex : await importCanvas(paintClouds(512, state), 'SkyClouds', taken, made);
    if (getEdits() !== edits) throw new Error('The map was opened again while its sky was made: press Apply again.');
    pushUndo('Sky & time of day');
    edits.level = edits.level || {};
    edits.textures = Object.assign(edits.textures || {}, made);
    delete edits.level.skyLook;
    if (skyLook) { edits.level.skyLook = skyLook; edits.level.sky = 'mine'; } else edits.level.sky = state.sky;
    if (state.sky !== 'saved') edits.level.skyKind = state.sky;
    edits.level.skyBackground = backgroundSettings(background);
    edits.level.time = state.time;
    if (cloudsChanged || !edits.level.clouds) {
      edits.level.clouds = { look: state.cloudLook, amount: state.clouds, size: state.cloudSize, height: state.cloudHigh, bright: state.cloudBright,
        speed: state.cloudSpeed, wind: state.wind, seed: state.seed };
      if (on) edits.level.clouds.tex = cloudTex;
    }
    if (state.ambient) {
      const [b, hue, sat] = TIMES[state.time].ambient;
      edits.level.ambient = { AmbientBrightness: b, AmbientHue: hue, AmbientSaturation: sat };
    }
    // the sun: made again each time (its lights are ordinary objects of the map, Tag UCSun)
    if (sunChanged) edits.added = (edits.added || []).filter((a) => !(a.props && a.props.Tag === 'UCSun'));
    const sun = TIMES[state.time].sun, opens = holes(edits);
    const suns = [];                                   // their names: what the Show menu hides of them is said (app.js)
    if (sunChanged && sun && state.sun) {
      const a = state.sunYaw * Math.PI / 180;
      for (const b of opens) {
        const c = [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2], half = [(b.hi[0] - b.lo[0]) / 2, (b.hi[1] - b.lo[1]) / 2];
        // towards the sun's side of the opening, high: the light comes from there (lower sun: further out)
        const out = 0.85 - 0.6 * (state.sunHigh / 90);
        const loc = [Math.round(c[0] + Math.cos(a) * half[0] * out), Math.round(c[1] + Math.sin(a) * half[1] * out), Math.round(b.hi[2] - 48)];
        const light = { name: nextName('UCEdit'), cls: 'Light', loc, rot: [0, 0, 0], radius: 8, height: 8,
          props: { Tag: 'UCSun', LightBrightness: Math.round(sun.bright * state.sunPower / 100), LightHue: sun.hue, LightSaturation: sun.sat, LightRadius: 255 } };
        edits.added.push(light);
        suns.push(light.name);
      }
    }
    setDirty(); rebuildProxies();
    scene.background = new THREE.Color(TIMES[state.time].bg);
    const where = opens.length ? '' : ' (the map has no opening to the sky yet: make a Hole "open to the sky")';
    const what = state.sky === 'made' ? 'painted sky' : ['picture', 'saved'].includes(state.sky) ? 'your picture as the sky' : 'the game\'s sky';
    const clouds = on ? `, ${state.cloudLook} clouds${state.cloudSpeed ? ' in the wind' : ''}` : '';
    log(`${TIMES[state.time].label}: ${what}${clouds}${suns.length ? `, the sun in ${suns.length} opening${suns.length > 1 ? 's' : ''}` : ''}${state.ambient ? ', the light of the ' + TIMES[state.time].label.toLowerCase() : ''}${where}. Rebuild to apply in game.`, 'ok');
    dialog.close();
    warnHiddenKinds(suns.map(proxyOf), 'Added');
  }
  // the dialog opens as the map's sky was left (the picture itself is not kept: choose it again)
  function restore(lv) {
    Object.assign(state, structuredClone(initialState));
    savedLook = lv.skyLook ? { ...lv.skyLook } : null;
    savedCloudTex = lv.clouds?.tex || null;
    sunChanged = false; cloudsChanged = false;
    state.ambient = !lv.sky;
    state.time = TIMES[lv.time] ? lv.time : (GAME_SKIES.find(([k]) => k === lv.sky)?.[2] || 'day');
    const kind = lv.skyKind || (lv.sky === 'mine' ? 'made' : lv.sky);
    if (lv.sky === 'mine' && savedLook?.walls) state.sky = 'saved';
    else if (kind === 'made') state.sky = kind;
    else if (GAME_SKIES.some(([k, , t]) => k === kind && t === state.time)) state.sky = kind;
    state.background = backgroundSettings(lv.skyBackground);
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
      dialog.addEventListener('close', () => { if (!disposed) syncViewport(true); });
      const css = document.createElement('style');
      css.textContent = `.map-dialog.sky-dialog { width:min(600px, calc(100vw - 32px)); max-height:calc(100vh - 32px); }
        .sky-dialog form { display:flex; flex-direction:column; max-height:calc(100vh - 36px); }
        .sky-dialog header, .sky-dialog footer { flex:none; }
        .sky-dialog main { min-height:0; overflow:auto; }
        .sky-dialog main > label { display:block; margin:12px 0 4px; }
        .sky-times { display:flex; gap:6px; } .sky-times button { flex:1; height:22px; padding:0 8px; } .sky-times button.on, .sky-seg button.on { background:var(--accent-soft); border-color:var(--acc); }
        .sky-seg { display:flex; gap:4px; } .sky-seg button { flex:1; height:22px; padding:0 8px; } .sky-seg [data-seed] { flex:0 0 28px; padding:0; }
        .sky-list { display:flex; flex-direction:column; gap:4px; } .sky-opt { display:flex; align-items:center; gap:6px; } .sky-opt small { color:var(--dim); }
        .sky-opt button { height:22px; padding:0 8px; }
        .sky-prev { display:block; box-sizing:border-box; width:100%; height:auto; margin:8px 0; border:1px solid var(--line); border-radius:var(--radius-control); cursor:grab; touch-action:none; }
        .sky-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(260px, 100%), 1fr)); column-gap:12px; margin-top:4px; }
        .sky-grid[hidden] { display:none; }
        .sky-dialog .row { display:flex; align-items:center; gap:8px; margin:4px 0; height:22px; } .sky-dialog .row > label { flex:0 0 76px; }
        .sky-dialog .row select { flex:1; min-width:0; height:22px; }
        .sky-dialog .row input[type=range] { flex:1; min-width:0; padding:0; border:0; background:transparent; }   /* not the dialog's boxed inputs */ .sky-dialog .row .hint { flex:0 0 40px; text-align:right; font-variant-numeric:tabular-nums; }
        .sky-check { display:flex !important; align-items:center; gap:6px; margin:8px 0 4px !important; }
        .sky-background { margin:12px 0 8px; border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:4px 0; }
        .sky-background summary { height:22px; line-height:22px; color:var(--heading); font-weight:600; cursor:pointer; }
        .sky-background button { height:22px; min-height:22px; padding:0 6px; line-height:20px; white-space:nowrap; }
        .sky-background input[type=number] { flex:0 0 56px; width:56px; min-width:0; height:22px; padding:0 4px; font-variant-numeric:tabular-nums; }
        .sky-unit { flex:0 0 12px; color:var(--dim); font-size:11px; }
        .sky-preview-heading { display:flex; align-items:center; justify-content:space-between; margin-top:8px; color:var(--dim); font-size:11px; }
        .sky-background [data-preview-status]:empty { display:none; }
        .sky-msg { color:var(--warn); min-height:1em; }`;
      document.head.appendChild(css);
    }
    viewportScript = getScript();
    restore(getEdits().level || {});
    remakeSky(); remakeClouds();
    began = performance.now();
    render();
    if (!dialog.open) dialog.showModal();
  }
  // the colour the 3D view gives the faces that show the sky: the time of day chosen for the map (null: none chosen)
  const backdrop = (lv) => (lv && lv.time && TIMES[lv.time] ? TIMES[lv.time].bg : null);
  return { open, backdrop, syncViewport,
    dispose() { disposed = true; ++skyRequest; field = look = null; cancelAnimationFrame(frame); dialog?.close(); dialog?.remove(); onPreview(null); },
  };
}
