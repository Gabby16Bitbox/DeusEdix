// The views of the map's last Rebuild, next to the lighting in the 3D view's menu and in View: UnrealEd's Wireframe,
// BSP cuts and Zones, and Lightmap detail (as Unity's lightmap resolution view).
// Drawn from the map's last SDK pass (editor/data.py views(), fetched the first time one is chosen):
// - Wireframe: the outline of every surface, the textured world hidden (the objects stay as they are);
// - BSP cuts: the world as it is, with the edges of every BSP polygon on it: where the BSP split the surfaces;
// - Zones: the world's polygons in the colour of the zone in front of them, the legend names the zones;
// - Lightmap detail: every surface in the colour of how big its lightmap's samples are (lightmap-detail.js), a check a
//   sample, the legend with the bands and the map's lightmaps. From the world's own meshes (where their corners fall in
//   the lightmaps' atlas) and the map's lightmap.json, not the SDK pass's views.
// Each structure's lines and polygons are put in its object, so they go with it when it is moved before a Rebuild.
import { DETAIL_BANDS, NO_LIGHTMAP, detailBand, sampleSizes, lightmapTotals } from './lightmap-detail.js';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./view-modes.css', import.meta.url).href;
document.head.appendChild(css);

export const VIEW_MODES = [['wire', 'Wireframe'], ['cuts', 'BSP cuts'], ['zones', 'Zones'], ['lightmap', 'Lightmap detail']];
const LINE_COLOUR = { wire: 0x9fb4d0, cuts: 0xffd166 };

// a colour per zone, each far from the one before (the golden angle round the hues); zone 0 (the level's own) grey
export function zoneColour(i) {
  if (!i) return [0.55, 0.55, 0.55];
  const h = (i * 137.508) % 360 / 60, x = 1 - Math.abs(h % 2 - 1), k = Math.floor(h);
  const [r, g, b] = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][k % 6];
  return [0.25 + r * 0.65, 0.25 + g * 0.65, 0.25 + b * 0.65];
}
// Lightmap detail's surfaces: the colour of their band, a check a sample (a pixel of the lightmaps' atlas)
const DETAIL_SHADER = {
  vertexShader: `attribute vec2 lmuv;
attribute vec3 band;
varying vec2 vCell;
varying vec3 vBand;
void main() { vCell = lmuv; vBand = band; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec2 atlas;
varying vec2 vCell;
varying vec3 vBand;
void main() { vec2 cell = floor(vCell * atlas); gl_FragColor = vec4(vBand * (0.8 + 0.2 * mod(cell.x + cell.y, 2.0)), 1.0); }`,
};
const kib = (bytes) => (bytes < 1048576 ? `${Math.round(bytes / 1024).toLocaleString('en')} KB` : `${(bytes / 1048576).toFixed(1)} MB`);

// load(): the views of the map shown ({zoned, zones, structures: {name: {cuts, wire, tris, zone}}});
// place(name): where a structure's world polygons are ({holder, center, turn}: its object, the point its meshes are
// relative to, the quaternion that takes the built pose off them), null for one not in the view;
// worldMeshes(): the textured surfaces of the map (hidden in Wireframe, Zones and Lightmap detail);
// lightmaps(): the map's lightmaps as its last Rebuild made them (lightmap.json), null for a map without lighting
export function createViewModes(THREE, { load, place, worldMeshes, lightmaps }) {
  let mode = null, data = null, drawn = [], lightmapData, ticket = 0;      // ticket: the last set()'s
  const legend = document.createElement('div');
  legend.id = 'zone-legend';
  legend.hidden = true;
  document.body.appendChild(legend);

  function positions(posUE, center, turn) {
    const out = new Float32Array(posUE.length), [cx, cy, cz] = center;
    for (let i = 0; i < posUE.length; i += 3) { out[i] = posUE[i] - cx; out[i + 1] = posUE[i + 2] - cz; out[i + 2] = posUE[i + 1] - cy; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
    if (turn) geo.applyQuaternion(turn);
    return geo;
  }
  function overlay(kind) {
    for (const [name, v] of Object.entries(data.structures)) {
      const at = place(name);
      if (!at) continue;
      let obj;
      if (kind === 'zones') {
        const geo = positions(v.tris, at.center, at.turn), colour = new Float32Array(v.tris.length);
        v.zone.forEach((z, t) => { const c = zoneColour(z); for (let k = 0; k < 9; k++) colour[t * 9 + k] = c[k % 3]; });
        geo.setAttribute('color', new THREE.BufferAttribute(colour, 3));
        obj = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
        obj.add(new THREE.LineSegments(positions(v.wire, at.center, at.turn), new THREE.LineBasicMaterial({ color: 0x1b2230 })));
      } else {
        obj = new THREE.LineSegments(positions(v[kind], at.center, at.turn),
          new THREE.LineBasicMaterial({ color: LINE_COLOUR[kind], depthTest: kind === 'cuts' }));
      }
      obj.raycast = () => {};                 // drawn on top of the world, never picked instead of it
      obj.renderOrder = 2;
      at.holder.add(obj);
      drawn.push(obj);
    }
  }
  // a copy of every surface of the world, in the same place, coloured by its units a sample (the world's own is hidden)
  function detail(lm) {
    const atlas = lm?.size || [1, 1];
    const material = new THREE.ShaderMaterial({ ...DETAIL_SHADER, side: THREE.DoubleSide, uniforms: { atlas: { value: new THREE.Vector2(...atlas) } } });
    for (const m of worldMeshes()) {
      const pos = m.geometry.getAttribute('position'), uv1 = m.geometry.getAttribute('uv1');
      if (!pos || m.geometry.index) continue;
      const sizes = lm && uv1 ? sampleSizes(pos.array, uv1.array, m.userData.faces, atlas) : null, band = new Float32Array(pos.count * 3);
      for (let t = 0; t < pos.count / 3; t++) {
        const c = detailBand(sizes ? sizes[t] : 0).colour;
        for (let k = 0; k < 9; k++) band[t * 9 + k] = c[k % 3];
      }
      const geo = new THREE.BufferGeometry();          // its own buffers on the same arrays: disposing it leaves the world's
      geo.setAttribute('position', new THREE.BufferAttribute(pos.array, 3));
      geo.setAttribute('lmuv', new THREE.BufferAttribute(uv1 ? uv1.array : new Float32Array(pos.count * 2), 2));
      geo.setAttribute('band', new THREE.BufferAttribute(band, 3));
      const obj = new THREE.Mesh(geo, material);
      obj.position.copy(m.position); obj.quaternion.copy(m.quaternion); obj.scale.copy(m.scale);
      obj.visible = m.userData.shownBefore !== false;  // what was hidden before the view stays hidden
      obj.raycast = () => {};
      m.parent.add(obj);
      drawn.push(obj);
    }
  }
  function showDetailLegend(lm) {
    legend.hidden = false;
    if (!lm) { legend.textContent = 'Lightmap detail: this map has no lighting yet. Rebuild it to see its lightmaps.'; return; }
    const { lightmaps: count, samples, bytes } = lightmapTotals(lm);
    const row = (b) => `<div><span style="background:rgb(${b.colour.map((c) => Math.round(c * 255)).join(',')})"></span>${b.label}</div>`;
    legend.innerHTML = '<b>Lightmap detail: units a sample</b>' + [...DETAIL_BANDS, NO_LIGHTMAP].map(row).join('')
      + `<p>${count.toLocaleString('en')} lightmaps, ${samples.toLocaleString('en')} samples (the last Rebuild): about ${kib(bytes)} as the game's `
      + '32-bit lightmaps, an estimate. A check is a sample. Shadow detail changes show after a Rebuild.</p>';
  }
  function clear() {
    for (const o of drawn) {
      o.parent?.remove(o);
      o.traverse((c) => { c.geometry?.dispose(); c.material?.dispose(); });
    }
    drawn = [];
    legend.hidden = true;
  }
  function showLegend() {
    legend.hidden = false;
    if (!data.zoned) { legend.textContent = 'Zones: Rebuild the map once to see them (it was read before DeusEdix showed zones).'; return; }
    const used = new Set(Object.values(data.structures).flatMap((v) => v.zone));     // the zones that have surfaces
    legend.innerHTML = '<b>Zones</b>' + data.zones.map((name, i) => {
      if (!used.has(i)) return '';
      const [r, g, b] = zoneColour(i).map((c) => Math.round(c * 255));
      return `<div><span style="background:rgb(${r},${g},${b})"></span>${name || `Zone ${i} (no ZoneInfo)`}</div>`;
    }).join('');
  }
  // mode: one of VIEW_MODES' keys, or null for the textured world with its lighting. A call overtaken by another while
  // it read the views or the lightmaps (reset: another geometry) draws nothing and keeps nothing it read
  async function set(next) {
    const mine = ++ticket;
    mode = next;
    clear();
    const hide = mode === 'wire' || mode === 'zones' || mode === 'lightmap';
    for (const m of worldMeshes()) {            // their own visibility comes back as it was
      if (hide && !m.userData.viewHidden) { m.userData.viewHidden = true; m.userData.shownBefore = m.visible; m.visible = false; }
      else if (!hide && m.userData.viewHidden) { m.userData.viewHidden = false; m.visible = m.userData.shownBefore; }
    }
    if (!mode) return;
    if (mode === 'lightmap') {
      if (lightmapData === undefined) {
        const read = await lightmaps();
        if (mine !== ticket) return;
        lightmapData = read;
      }
      detail(lightmapData);
      return showDetailLegend(lightmapData);
    }
    if (!data) {
      const read = await load();
      if (mine !== ticket) return;           // another view was chosen, or the map read again, while this one loaded
      data = read;
    }
    overlay(mode);
    if (mode === 'zones') showLegend();
  }
  // the map was built again or another one opened: its views are read again when one is shown
  function reset() {
    data = null;
    lightmapData = undefined;
    if (mode) return set(mode);
    clear();
  }
  return { set, reset, get mode() { return mode; } };
}
