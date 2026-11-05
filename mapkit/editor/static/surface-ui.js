// BSP faces are addressed by their source brush and polygon, not by the BSP's temporary index.
// Edits are queued for Rebuild: UV changes require new lightmaps in Deus Ex.
import { faceShapes, growFaces, GROW_ANGLE } from './face-grow.js';
import { RECENT_ACTIONS } from './recent-textures.js';
import { indexRows, rowsFor, foldRows, queueProblem, splitTargets, ROW_LIMIT } from './texture-slip.js';
import { PF_AUTOUPAN, PF_AUTOVPAN } from './light-effects.js';
const SHADOW_LEVELS = [['ultra-low', 'Ultra Low'], ['low', 'Low'], ['normal', 'Normal'], ['high', 'High']];
const shadowOptions = (selected = '') => SHADOW_LEVELS.map(([value, label]) =>
  `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
// the Look of a face: UnrealEd's surface properties (editor/surfaces.py FLAGS, the host's UC_SURFACE flags)
const FLAGS = [[0x400000, 'Unlit', 'Full brightness, no light or shadow on it (screens, lamps, signs)'],
  [0x4, 'Translucent', 'See-through, adding its colours (glass glare, holograms, light beams)'],
  [0x2, 'Masked', 'Its texture\'s first colour is a hole (fences, grates, foliage)'],
  [0x40, 'Modulated', 'Darkens and tints what is behind it (dirty glass, stains)'],
  [0x100, 'Two-sided', 'Drawn from both sides'],
  [0x8000000, 'Mirror', 'Reflects the room (a mirror, polished floors)'],
  [0x1, 'Invisible', 'Not drawn, still solid (invisible walls)'],
  [0x80, 'Fake backdrop', 'Shows the sky (the map\'s sky box) instead of its texture'],
  [0x100000, 'Special lit', 'Lit only by lights set to Special Lit'],
  [0x800, 'No smooth', 'Its texture pixels stay sharp (no filtering)'],
  [PF_AUTOUPAN, 'Auto U Pan', 'Moves the texture along U. Set the zone\'s Inspector > Texture panning > U speed (shared by its surfaces). View > Effects shows it after Rebuild.'],
  [PF_AUTOVPAN, 'Auto V Pan', 'Moves the texture along V. Set the zone\'s Inspector > Texture panning > V speed (shared by its surfaces). View > Effects shows it after Rebuild.']];
// onlyAfterRebuild(ids): how many of these faces show their queued alignment only after a Rebuild (the preview cannot);
// slip(): the Texture Slip started as Edit > Slip the texture starts it (the panel's Slip)
export function createSurfaceTools({ THREE, getEdits, pushUndo, setDirty, deselect, status, log, escapeHtml, textures,
  canShowPanel = () => true, canEditFace = () => true, onChange = () => {},
  recent = { list: () => [], add: () => {} }, picture = () => '', keyOf = () => '', onlyAfterRebuild = () => 0, slip = () => {},
  onMode = () => {} }) {
  let faces = [], meshes = [], chosen = new Set(), overlays = [], mode = false;
  const target = f => ({ brush: f.brush, poly: f.poly });
  const selected = () => [...chosen].map(i => faces[i]).filter(Boolean);
  // the queued rows by face (texture-slip.js indexRows), made again when the queue changes: a face's rows found without
  // going through them all (a big slip queues thousands)
  let indexed = { rows: null, length: -1, index: null };
  function queued() {
    const rows = getEdits().surfaces || [];
    if (indexed.rows !== rows || indexed.length !== rows.length) indexed = { rows, length: rows.length, index: indexRows(rows) };
    return indexed.index;
  }
  // whether a target is a face of a locked structure (a face by its number, a whole brush by '*'): each face looked at once,
  // found as a row's faces are (indexRows)
  function lockedIn(targets) {
    const index = indexRows([{ targets }]);
    return faces.some(f => rowsFor(f, index).length && !canEditFace(f));
  }
  // why Save would refuse the queue with rows added (next: the queue then; surfaces.py), in the user's words, '' when
  // it takes it: the rows it had were checked when they were queued
  function refusal(next, before) {
    if (next.length > ROW_LIMIT) return `The map can hold ${ROW_LIMIT} queued surface changes; this would make ${next.length}: take some back first.`;
    const old = new Set(before);
    return queueProblem(next.filter(row => !old.has(row)));
  }
  const dispose = () => { for (const o of overlays) { o.removeFromParent(); o.geometry.dispose(); o.material.dispose(); } overlays = []; };
  // a mesh the 3D view shows, or only a view mode hides (Wireframe, Zones and Lightmap detail draw copies of it)
  const shown = m => { for (let o = m; o; o = o.parent) if (!o.visible && !(o === m && m.userData.viewHidden && m.userData.shownBefore !== false)) return false; return true; };
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
    // UnrealEd's Ultra Low is both detail bits together, not High with an extra flag.
    let value = prop === 'texture' ? f.tex : (f.flags & 0x808000) === 0x808000 ? 'ultra-low' :
      f.flags & 0x800000 ? 'high' : f.flags & 0x8000 ? 'low' : 'normal';
    for (const row of rowsFor(f, queued())) if (row.op === prop) value = row.args[0];
    return value;
  }
  // a face's flags with the queued Look changes on top (in their order)
  function flagsOf(f) {
    let v = f.flags || 0;
    for (const row of rowsFor(f, queued())) if (row.op === 'flags') v = (v | row.args[0]) & ~row.args[1];
    return v;
  }
  // what each change of the faces is called as an undo step (the History panel, Edit > Undo); the rest are Align's modes
  const OP_STEPS = { texture: 'Face texture', flags: 'Face flags', shadows: 'Shadow detail', pan: 'Pan the texture',
    scale: 'Scale the texture', rotate: 'Rotate the texture', 'flip-u': 'Flip the texture U', 'flip-v': 'Flip the texture V' };
  // the Pan and the Scale that change nothing: not queued (a row would only take room in the map's queue)
  const NO_CHANGE = { pan: { args: [0, 0], say: 'Nothing to pan: type the texels in Pan U or Pan V first.' },
    scale: { args: [1, 1], say: 'Nothing to scale: type a factor other than 1 in Scale U or Scale V first.' } };
  // fromStrip: a texture put from the strip of recent textures, which keeps its place there. Refused, saying why, when a
  // face is locked, it changes nothing, or Save would refuse the rows (surfaces.py's checks in its words: refusal): true
  // when queued, else false
  function queue(op, args = [], targets = selected().map(target), fromStrip = false) {
    if (!targets.length) return false;
    if (lockedIn(targets)) {
      status('Unlock the target structure before editing its surfaces.', 'warn'); return false;
    }
    const none = NO_CHANGE[op];
    if (none && args.length === none.args.length && args.every((v, i) => v === none.args[i])) { status(none.say, 'warn'); return false; }
    // more faces than one row may name (Replace in whole map): rows of 8192, one undo step
    const edits = getEdits(), before = edits.surfaces || [], rows = splitTargets(targets).map(part => ({ op, args, targets: part }));
    const why = refusal([...before, ...rows], before);
    if (why) { status(why, 'warn'); return false; }
    pushUndo(OP_STEPS[op] || `Align the texture: ${op}`);
    (edits.surfaces ||= []).push(...rows);
    setDirty();
    if (op === 'texture' && !fromStrip) recent.add(args[0]);
    onChange(op);
    const look = op === 'flags' ? FLAGS.filter(([bit]) => (args[0] | args[1]) & bit).map(([bit, label]) => (args[0] & bit ? '' : 'not ') + label).join(', ') : '';
    log(`${op === 'shadows' ? 'Shadow detail: ' + args[0] : op === 'flags' ? 'Look: ' + look : 'Surface ' + op}: ${targets.length} face target${targets.length === 1 ? '' : 's'}. Rebuild to apply${op === 'texture' ? '.' : ' and recalculate lighting.'}`);
    if (chosen.size) panel();
    return true;
  }
  // Rows made elsewhere (the Texture Slip: texture-slip.js slipResult), queued as one undo step named label, folded into
  // the pan and scale rows before them where that takes fewer (foldRows: the map holds ROW_LIMIT rows for good);
  // refused, saying why, when a face is locked or Save would refuse the queue. line: what the log says of them. It gives
  // { left: the rows the map can still take }, or false.
  function queueRows(rows, label, line) {
    if (!rows.length) return false;
    if (lockedIn(rows.flatMap(row => row.targets))) { status('Unlock the target structure before editing its surfaces.', 'warn'); return false; }
    const edits = getEdits(), before = edits.surfaces || [], next = foldRows(before, rows), why = refusal(next, before);
    if (why) { status(why, 'warn'); return false; }
    pushUndo(label);
    edits.surfaces = next;
    setDirty();
    onChange('slip');
    log(line);
    if (chosen.size) panel();
    return { left: ROW_LIMIT - next.length };
  }
  function selectIds(ids) {
    deselect(); chosen = new Set(ids); highlight(); panel();
    document.querySelector('#right').scrollTop = 0;
  }
  // what to do with no face selected (what: 'faces', 'a face'): in Face selection a click; outside it Alt+click or Face
  // selection's key (Settings > Keyboard shortcuts may have moved it), which in Face selection would turn it off
  const noFaces = (what) => mode ? `Select ${what} first: click one (Shift+click adds).`
    : `Select ${what} first: Alt+click one, or ${keyOf('faces') || 'Q'} and click.`;
  // the texture in place `slot` of the strip (0 the first) on the selected faces: one undo step, as Apply
  function applyRecent(slot) {
    const ref = recent.list()[slot];
    if (!chosen.size) { status(noFaces('faces'), 'warn'); return false; }
    if (!ref) { status(`No recent texture ${slot + 1} yet: apply a texture from the list, the picker or a drag first.`, 'warn'); return false; }
    const n = chosen.size, done = queue('texture', [ref], undefined, true);
    if (done) status(`${ref.split('.').pop()} on ${n} face${n === 1 ? '' : 's'}: Rebuild to see it in the game.`, 'ok');
    return done;
  }
  // Grow, as ProBuilder's Grow Selection (face-grow.js): the faces next to the selected ones join them, in their plane
  // or at any angle; the faces as the 3D view shows them now
  function grow(anyAngle) {
    if (!chosen.size) { status(noFaces('a face'), 'warn'); return; }
    const shapes = faceShapes(meshes.filter(shown).map(m => {
      m.updateWorldMatrix(true, false);
      return { pos: m.geometry.getAttribute('position').array, faces: m.userData.faces || [], matrix: m.matrixWorld.elements };
    }));
    const more = growFaces(shapes, chosen, { maxAngle: anyAngle ? 180 : GROW_ANGLE });
    if (!more.length) {
      status(anyAngle ? 'No face shown shares an edge with the selection.'
        : `No face next to the selection lies in its plane (within ${GROW_ANGLE}°): Grow (any angle) takes every neighbour.`, 'warn');
      return;
    }
    selectIds([...chosen, ...more]);
    status(`${more.length} face${more.length === 1 ? '' : 's'} added: ${chosen.size} selected.`, 'ok');
  }
  // the strip of recent textures: each with its picture (or its name) and its key
  function recentStrip() {
    const list = recent.list();
    if (!list.length) return `<div class="hint">The textures you apply show here: ${escapeHtml(keyOf(RECENT_ACTIONS[0]))}, ${escapeHtml(keyOf(RECENT_ACTIONS[1]))}… put them on the selected faces in Face selection.</div>`;
    return `<div class="surface-recent">${list.map((ref, i) => {
      const key = keyOf(RECENT_ACTIONS[i]), url = picture(ref);
      return `<button data-sf-recent="${i}" title="${escapeHtml(ref)}${key ? ` (${escapeHtml(key)} in Face selection)` : ''}" aria-label="Recent texture ${i + 1}: ${escapeHtml(ref)}">`
        + (url ? `<img src="${escapeHtml(url)}" alt="">` : `<span class="surface-recent-name">${escapeHtml(ref.split('.').pop())}</span>`)
        + (key ? `<span class="surface-recent-key">${escapeHtml(key.split('+').pop())}</span>` : '') + '</button>';
    }).join('')}</div>`;
  }
  function panel() {
    if (!canShowPanel()) return;
    const el = document.querySelector('#details'), list = selected();
    if (!list.length) return;
    const texValues = new Set(list.map(f => effective(f, 'texture'))), shadowValues = new Set(list.map(f => effective(f, 'shadows')));
    const texture = texValues.size === 1 ? [...texValues][0] : '', shadow = shadowValues.size === 1 ? [...shadowValues][0] : '';
    const options = [...new Set([...textures(), ...list.map(f => f.tex), ...texValues])].filter(t => t && t !== 'none').sort();
    const pending = new Set(list.flatMap(f => rowsFor(f, queued()))).size, later = onlyAfterRebuild([...chosen]);
    const brushes = [...new Set(list.map(f => f.brush))], slipKey = keyOf('faceslip');
    const source = list.length === 1 ? `${list[0].brush} · face ${list[0].poly}` : brushes.length === 1 ? brushes[0] : `${brushes.length} brushes`;
    // a Look flag's checkbox: ticked when every selected face has it, mixed when some do
    const flagBox = ([bit, label, title]) => { const n = list.filter(f => flagsOf(f) & bit).length;
      return `<label title="${escapeHtml(title)}"><input type="checkbox" data-sf-flag="${bit}" ${n === list.length ? 'checked' : ''} ${n && n < list.length ? 'data-mixed="1"' : ''}> ${label}</label>`; };
    el.innerHTML = `<div class="box surface-panel"><b>Surface · ${list.length} face${list.length === 1 ? '' : 's'}</b>
      <div class="hint surface-source" title="${escapeHtml(list.map(f => f.brush + ' · face ' + f.poly).join(', '))}">${escapeHtml(source)}</div>
      <div class="hint">Alt+click to select · Shift to add/remove</div>
      <label class="surface-label" for="sf-texture">Texture${texture ? '' : ' (mixed)'}</label>
      <div class="row"><select id="sf-texture" aria-label="Surface texture"><option value="">Choose texture…</option>${options.map(t => `<option value="${escapeHtml(t)}" ${t === texture ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select><button id="sf-set-texture">Apply</button></div>
      ${texture ? `<div class="row"><button id="sf-same" title="Every face of the map with this texture">Select same texture</button><button id="sf-replace" title="The texture chosen above on every face of the map that has ${escapeHtml(texture)}">Replace in whole map</button></div>` : ''}
      <label class="surface-label">Recent textures</label>${recentStrip()}
      <label class="surface-label" for="sf-align">Align</label><div class="row"><select id="sf-align"><option value="floor">Floor</option><option value="wall">Wall</option><option value="tile">One Tile</option><option value="tile-u">One Tile U (keep proportions)</option><option value="tile-v">One Tile V (keep proportions)</option><option value="cylinder">Around a cylinder (all sides)</option></select><button id="sf-set-align">Align</button></div>
      <div id="sf-cylinder-hint" class="hint" hidden>Wraps all side faces of each brush. Requires a closed vertical outline and the same texture on every side.</div>
      <div class="surface-values"><label for="sf-pan-u">Pan U</label><input id="sf-pan-u" type="number" value="0" step="1" min="-32767" max="32767"><label for="sf-pan-v">Pan V</label><input id="sf-pan-v" type="number" value="0" step="1" min="-32767" max="32767"><button id="sf-pan">Pan</button></div>
      <div class="surface-values"><label for="sf-scale-u">Scale U</label><input id="sf-scale-u" type="number" value="1" step="0.25" min="0.001" max="1000"><label for="sf-scale-v">Scale V</label><input id="sf-scale-v" type="number" value="1" step="0.25" min="0.001" max="1000"><button id="sf-scale">Scale</button></div>
      <div class="hint">Pan adds texels. Scale multiplies the tile size: 2 = twice as large; 0.5 = half.</div>
      <div class="row"><button id="sf-slip" title="Roll the texture with the pointer and size it with the wheel, live: it starts over one of these faces (Edit &gt; Slip the texture)">Slip${slipKey ? ` (${escapeHtml(slipKey)})` : ''}</button></div>
      <div class="row"><button data-sf-op="rotate">Rotate 90°</button><button data-sf-op="flip-u">Flip U</button><button data-sf-op="flip-v">Flip V</button></div>
      <label class="surface-label" for="sf-shadows">Shadows</label><select id="sf-shadows">${shadow ? '' : '<option value="">Mixed</option>'}${shadowOptions(shadow)}</select>
      <div class="hint">Ultra Low: coarsest shadows, smallest lightmaps. High: finest, largest.</div>
      <label class="surface-label">Look</label>
      <div class="surface-flags">${FLAGS.map(flagBox).join('')}</div>
      <div class="surface-notice"><b>Save</b> stores edits; the view shows them at once. <b>Rebuild</b> applies them to the map and its lighting.<br>${pending} stored operation${pending === 1 ? '' : 's'} on this selection.${later ? ` ${later} of these faces show${later === 1 ? 's' : ''} it only after a Rebuild.` : ''}</div>
      <div class="row"><button id="sf-grow" title="Adds the faces that share an edge with these and lie in their plane (${escapeHtml(keyOf('facegrow'))} in Face selection)">Grow</button><button id="sf-grow-all" title="Adds every face that shares an edge with these (${escapeHtml(keyOf('facegrowall'))} in Face selection)">Grow (any angle)</button></div>
      <div class="row"><button id="sf-brush">Select whole brush</button><button id="sf-clear">Clear selection</button></div></div>`;
    const $ = id => document.getElementById(id);
    $('sf-set-texture').onclick = () => { const t = $('sf-texture').value; if (t) queue('texture', [t]); };
    // the same texture in the whole map: picked, or replaced (one operation, one undo)
    const sameIds = () => faces.map((f, i) => effective(f, 'texture') === texture ? i : -1).filter(i => i >= 0);
    if ($('sf-same')) $('sf-same').onclick = () => { const ids = sameIds(); selectIds(ids); status(`${ids.length} face${ids.length === 1 ? '' : 's'} with ${texture}.`); };
    if ($('sf-replace')) $('sf-replace').onclick = () => {
      const t = $('sf-texture').value, ids = sameIds();
      if (!t || t === texture) { status('Choose the new texture in the list first, then Replace in whole map.', 'warn'); return; }
      if (queue('texture', [t], ids.map(i => target(faces[i])))) { selectIds(ids); status(`${texture} replaced by ${t} on ${ids.length} face${ids.length === 1 ? '' : 's'}: Rebuild to see it in the game.`, 'ok'); }
    };
    $('sf-set-align').onclick = () => { const op = $('sf-align').value; queue(op, [], op === 'cylinder' ? [...new Set(list.map(f => f.brush))].map(brush => ({ brush, poly: '*' })) : list.map(target)); };
    $('sf-align').onchange = () => { $('sf-cylinder-hint').hidden = $('sf-align').value !== 'cylinder'; };
    for (const op of ['pan', 'scale']) $('sf-' + op).onclick = () => queue(op, [+$('sf-' + op + '-u').value, +$('sf-' + op + '-v').value]);
    for (const b of el.querySelectorAll('[data-sf-op]')) b.onclick = () => queue(b.dataset.sfOp);
    $('sf-shadows').onchange = () => { if ($('sf-shadows').value) queue('shadows', [$('sf-shadows').value]); };
    for (const c of el.querySelectorAll('[data-sf-flag]')) {
      if (c.dataset.mixed) c.indeterminate = true;
      c.onchange = () => { const bit = +c.dataset.sfFlag; queue('flags', c.checked ? [bit, 0] : [0, bit]); };
    }
    $('sf-brush').onclick = () => { const brushes = new Set(list.map(f => f.brush)); selectIds(faces.map((f, i) => brushes.has(f.brush) ? i : -1).filter(i => i >= 0)); };
    for (const b of el.querySelectorAll('[data-sf-recent]')) b.onclick = () => applyRecent(+b.dataset.sfRecent);
    $('sf-grow').onclick = () => grow(false);
    $('sf-grow-all').onclick = () => grow(true);
    $('sf-slip').onclick = () => slip();
    $('sf-clear').onclick = () => deselect();
  }
  return {
    get mode() { return mode; }, get hasSelection() { return chosen.size > 0; }, get geometry() { return meshes.slice(); }, clear, panel,
    applyRecent, grow, queueRows,
    noFaces,                                  // what to do with no face selected (the Texture Slip says it too)
    queue,                                    // an operation of the panel on targets (the selected faces), one undo step
    // the faces selected: [{ id: its place in the faces loaded, face, tex: its texture now (a queued one, else as built) }]
    selectedFaces: () => [...chosen].filter(i => faces[i]).map(id => ({ id, face: faces[id], tex: effective(faces[id], 'texture') })),
    textureOf: (face) => effective(face, 'texture'),          // a face's texture now (a queued one, else as built)
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
    toggle() {
      mode = !mode; deselect(); onMode(mode);
      status(mode ? 'Face selection: click a face, Shift+click to add. Q, or Esc with no face selected, goes back to objects.'
        : 'Object selection. Alt+click selects a face.');
    },
    // Face selection left (Esc with no face selected): -> whether it was on
    exit() { if (!mode) return false; this.toggle(); return true; },
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
      box.innerHTML = `<b>Surfaces</b><div class="row"><button id="sf-structure">Select ${ids.length} faces</button></div><label class="surface-label" for="sf-structure-shadow">Shadows for the whole structure</label><select id="sf-structure-shadow"><option value="">Choose detail…</option>${shadowOptions()}</select><div class="hint">Applies to every face of its brushes. Rebuild recalculates the lighting.</div>`;
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
