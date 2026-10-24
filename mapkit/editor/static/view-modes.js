// UnrealEd's views of the map, next to the lighting in the 3D view's menu and in View: Wireframe, BSP cuts, Zones.
// Drawn from the map's last SDK pass (editor/data.py views(), fetched the first time one is chosen):
// - Wireframe: the outline of every surface, the textured world hidden (the objects stay as they are);
// - BSP cuts: the world as it is, with the edges of every BSP polygon on it: where the BSP split the surfaces;
// - Zones: the world's polygons in the colour of the zone in front of them, the legend names the zones.
// Each structure's lines and polygons are put in its object, so they go with it when it is moved before a Rebuild.
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./view-modes.css', import.meta.url).href;
document.head.appendChild(css);

export const VIEW_MODES = [['wire', 'Wireframe'], ['cuts', 'BSP cuts'], ['zones', 'Zones']];
const LINE_COLOUR = { wire: 0x9fb4d0, cuts: 0xffd166 };

// a colour per zone, each far from the one before (the golden angle round the hues); zone 0 (the level's own) grey
export function zoneColour(i) {
  if (!i) return [0.55, 0.55, 0.55];
  const h = (i * 137.508) % 360 / 60, x = 1 - Math.abs(h % 2 - 1), k = Math.floor(h);
  const [r, g, b] = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][k % 6];
  return [0.25 + r * 0.65, 0.25 + g * 0.65, 0.25 + b * 0.65];
}

// load(): the views of the map shown ({zoned, zones, structures: {name: {cuts, wire, tris, zone}}});
// place(name): where a structure's world polygons are ({holder, center, turn}: its object, the point its meshes are
// relative to, the quaternion that takes the built pose off them), null for one not in the view;
// worldMeshes(): the textured surfaces of the map (hidden in Wireframe and Zones)
export function createViewModes(THREE, { load, place, worldMeshes }) {
  let mode = null, data = null, drawn = [];
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
  // mode: one of VIEW_MODES' keys, or null for the textured world with its lighting
  async function set(next) {
    mode = next;
    clear();
    const hide = mode === 'wire' || mode === 'zones';
    for (const m of worldMeshes()) {            // their own visibility comes back as it was
      if (hide && !m.userData.viewHidden) { m.userData.viewHidden = true; m.userData.shownBefore = m.visible; m.visible = false; }
      else if (!hide && m.userData.viewHidden) { m.userData.viewHidden = false; m.visible = m.userData.shownBefore; }
    }
    if (!mode) return;
    if (!data) data = await load();
    if (mode !== next) return;               // another view was chosen while this one loaded
    overlay(mode);
    if (mode === 'zones') showLegend();
  }
  // the map was built again or another one opened: its views are read again when one is shown
  function reset() {
    data = null;
    if (mode) return set(mode);
    clear();
  }
  return { set, reset, get mode() { return mode; } };
}
