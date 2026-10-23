// BSP faces are addressed by their source brush and polygon, not by the BSP's temporary index.
// Edits are queued for Rebuild: UV changes require new lightmaps in Deus Ex.
export function createSurfaceTools({ THREE, getEdits, pushUndo, setDirty, deselect, status, log, escapeHtml, textures,
  canShowPanel = () => true, canEditFace = () => true, onChange = () => {} }) {
  let faces = [], meshes = [], chosen = new Set(), overlays = [], mode = false;
  const target = f => ({ brush: f.brush, poly: f.poly });
  const selected = () => [...chosen].map(i => faces[i]).filter(Boolean);
  const dispose = () => { for (const o of overlays) { o.removeFromParent(); o.geometry.dispose(); o.material.dispose(); } overlays = []; };
  function clear() { chosen.clear(); dispose(); }
  function highlight() {
    dispose();
    for (const mesh of meshes) {
      const positions = [], attr = mesh.geometry.getAttribute('position');
      (mesh.userData.faces || []).forEach((id, triangle) => {
        if (chosen.has(id)) for (let j = triangle * 3; j < triangle * 3 + 3; j++) positions.push(attr.getX(j), attr.getY(j), attr.getZ(j));
      });
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: .18,
        depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xffd25a, depthWrite: false }));
      for (const o of [fill, edge]) { o.raycast = () => {}; mesh.add(o); overlays.push(o); }
    }
  }
  function effective(f, prop) {
    let value = prop === 'texture' ? f.tex : f.flags & 0x800000 ? 'high' : f.flags & 0x8000 ? 'low' : 'normal';
    for (const row of getEdits().surfaces || []) if (row.op === prop && row.targets.some(t => t.brush === f.brush && (t.poly === '*' || t.poly === f.poly))) value = row.args[0];
    return value;
  }
  function queue(op, args = [], targets = selected().map(target)) {
    if (!targets.length) return;
    if (op === 'texture' && (args.length !== 1 || typeof args[0] !== 'string' || args[0].length > 240 || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(args[0]))) {
      status('Choose a valid local texture.', 'warn'); return false;
    }
    if (targets.some(t => faces.some(f => f.brush === t.brush && (t.poly === '*' || t.poly === f.poly) && !canEditFace(f)))) {
      status('Unlock the target structure before editing its surfaces.', 'warn'); return false;
    }
    if ((op === 'pan' || op === 'scale') && (args.some(v => !Number.isFinite(v)) ||
      (op === 'scale' ? args.some(v => v < .001 || v > 1000) : args.some(v => !Number.isInteger(v) || Math.abs(v) > 32767)))) {
      status(op === 'scale' ? 'Scale factors must be between 0.001 and 1000.' : 'Pan uses whole texels between -32767 and 32767.', 'warn'); return;
    }
    pushUndo();
    const edits = getEdits();
    (edits.surfaces ||= []).push({ op, args, targets });
    setDirty();
    onChange(op);
    log(`${op === 'shadows' ? 'Shadow detail: ' + args[0] : 'Surface ' + op}: ${targets.length} face target${targets.length === 1 ? '' : 's'}. Rebuild to apply${op === 'texture' ? '.' : ' and recalculate lighting.'}`);
    if (chosen.size) panel();
    return true;
  }
  function selectIds(ids) {
    deselect(); chosen = new Set(ids); highlight(); panel();
    document.querySelector('#right').scrollTop = 0;
  }
  function panel() {
    if (!canShowPanel()) return;
    const el = document.querySelector('#details'), list = selected();
    if (!list.length) return;
    const texValues = new Set(list.map(f => effective(f, 'texture'))), shadowValues = new Set(list.map(f => effective(f, 'shadows')));
    const texture = texValues.size === 1 ? [...texValues][0] : '', shadow = shadowValues.size === 1 ? [...shadowValues][0] : '';
    const options = [...new Set([...textures(), ...list.map(f => f.tex), ...texValues])].filter(t => t && t !== 'none').sort();
    const pending = (getEdits().surfaces || []).filter(r => r.targets.some(t => list.some(f => t.brush === f.brush && (t.poly === '*' || t.poly === f.poly)))).length;
    const brushes = [...new Set(list.map(f => f.brush))];
    const source = list.length === 1 ? `${list[0].brush} · face ${list[0].poly}` : brushes.length === 1 ? brushes[0] : `${brushes.length} brushes`;
    el.innerHTML = `<div class="box surface-panel"><b>Surface · ${list.length} face${list.length === 1 ? '' : 's'}</b>
      <div class="hint surface-source" title="${escapeHtml(list.map(f => f.brush + ' · face ' + f.poly).join(', '))}">${escapeHtml(source)}</div>
      <div class="hint">Alt+click to select · Shift to add/remove</div>
      <label class="surface-label" for="sf-texture">Texture${texture ? '' : ' (mixed)'}</label>
      <div class="row"><select id="sf-texture" aria-label="Surface texture"><option value="">Choose texture…</option>${options.map(t => `<option value="${escapeHtml(t)}" ${t === texture ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select><button id="sf-set-texture">Apply</button></div>
      <label class="surface-label" for="sf-align">Align</label><div class="row"><select id="sf-align"><option value="floor">Floor</option><option value="wall">Wall</option><option value="tile">One Tile</option><option value="tile-u">One Tile U (keep proportions)</option><option value="tile-v">One Tile V (keep proportions)</option><option value="cylinder">Around a cylinder (all sides)</option></select><button id="sf-set-align">Align</button></div>
      <div id="sf-cylinder-hint" class="hint" hidden>Wraps all side faces of each brush. Requires a closed vertical outline and the same texture on every side.</div>
      <div class="surface-values"><label for="sf-pan-u">Pan U</label><input id="sf-pan-u" type="number" value="0" step="1" min="-32767" max="32767"><label for="sf-pan-v">Pan V</label><input id="sf-pan-v" type="number" value="0" step="1" min="-32767" max="32767"><button id="sf-pan">Pan</button></div>
      <div class="surface-values"><label for="sf-scale-u">Scale U</label><input id="sf-scale-u" type="number" value="1" step="0.25" min="0.001" max="1000"><label for="sf-scale-v">Scale V</label><input id="sf-scale-v" type="number" value="1" step="0.25" min="0.001" max="1000"><button id="sf-scale">Scale</button></div>
      <div class="hint">Pan adds texels. Scale multiplies the tile size: 2 = twice as large; 0.5 = half.</div>
      <div class="row"><button data-sf-op="rotate">Rotate 90°</button><button data-sf-op="flip-u">Flip U</button><button data-sf-op="flip-v">Flip V</button></div>
      <label class="surface-label" for="sf-shadows">Shadows</label><select id="sf-shadows">${shadow ? '' : '<option value="">Mixed</option>'}${['low','normal','high'].map(s => `<option value="${s}" ${s === shadow ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>
      <div class="hint">High: finer shadows, larger lightmaps.</div>
      <div class="surface-notice"><b>Save</b> stores edits. <b>Rebuild</b> applies them to the view and map.<br>${pending} stored operation${pending === 1 ? '' : 's'} on this selection.</div>
      <div class="row"><button id="sf-brush">Select whole brush</button><button id="sf-clear">Clear selection</button></div></div>`;
    const $ = id => document.getElementById(id);
    $('sf-set-texture').onclick = () => { const t = $('sf-texture').value; if (t) queue('texture', [t]); };
    $('sf-set-align').onclick = () => { const op = $('sf-align').value; queue(op, [], op === 'cylinder' ? [...new Set(list.map(f => f.brush))].map(brush => ({ brush, poly: '*' })) : list.map(target)); };
    $('sf-align').onchange = () => { $('sf-cylinder-hint').hidden = $('sf-align').value !== 'cylinder'; };
    for (const op of ['pan', 'scale']) $('sf-' + op).onclick = () => queue(op, [+$('sf-' + op + '-u').value, +$('sf-' + op + '-v').value]);
    for (const b of el.querySelectorAll('[data-sf-op]')) b.onclick = () => queue(b.dataset.sfOp);
    $('sf-shadows').onchange = () => { if ($('sf-shadows').value) queue('shadows', [$('sf-shadows').value]); };
    $('sf-brush').onclick = () => { const brushes = new Set(list.map(f => f.brush)); selectIds(faces.map((f, i) => brushes.has(f.brush) ? i : -1).filter(i => i >= 0)); };
    $('sf-clear').onclick = () => deselect();
  }
  return {
    get mode() { return mode; }, get hasSelection() { return chosen.size > 0; }, get geometry() { return meshes.slice(); }, clear, panel,
    faceAt(hit) {
      if (!hit || !meshes.includes(hit.object)) return null; // Unbuilt copies share their source's face IDs.
      const id = hit?.object.userData.faces?.[hit.faceIndex];
      return id !== undefined && id >= 0 && faces[id] ? faces[id] : null;
    },
    applyTextureAtHit(hit, texture) {
      const face = this.faceAt(hit);
      if (!face) { status('Drop on a built wall, floor or ceiling. Rebuild new blocks first.', 'warn'); return false; }
      return queue('texture', [texture], [target(face)]);
    },
    load(data, geometry) { clear(); faces = data; meshes = geometry; },
    toggle() { mode = !mode; deselect(); status(mode ? 'Face selection: click a face, Shift+click to add. Alt+click also works in object mode.' : 'Object selection. Alt+click selects a face.'); },
    pick(hit, add) {
      const id = hit?.object.userData.faces?.[hit.faceIndex];
      if (id === undefined || id < 0 || !faces[id]) { status('Select a built wall, floor or ceiling. Rebuild newly added geometry first.', 'warn'); return; }
      const ids = add ? new Set(chosen) : new Set();
      if (add && ids.has(id)) ids.delete(id); else ids.add(id);
      if (!ids.size) { deselect(); return; }
      selectIds(ids);
    },
    structurePanel(name) {
      const ids = faces.map((f, i) => f.structure === name ? i : -1).filter(i => i >= 0);
      if (!ids.length) return;
      const box = document.createElement('div'); box.className = 'box surface-panel';
      box.innerHTML = `<b>Surfaces</b><div class="row"><button id="sf-structure">Select ${ids.length} faces</button></div><label class="surface-label" for="sf-structure-shadow">Shadows for the whole structure</label><select id="sf-structure-shadow"><option value="">Choose detail…</option><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select><div class="hint">Applies to every face of its brushes. Rebuild recalculates the lighting.</div>`;
      document.querySelector('#details').appendChild(box);
      box.querySelector('button').onclick = () => selectIds(ids);
      box.querySelector('select').onchange = e => {
        if (!e.target.value) return;
        queue('shadows', [e.target.value], [...new Set(ids.map(i => faces[i].brush))].map(brush => ({ brush, poly: '*' })));
        e.target.value = '';
      };
    },
  };
}
