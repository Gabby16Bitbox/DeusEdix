// "Characters" panel of the map editor (Character Creator): characters of your own, made of the bodies,
// faces and clothes of the game's characters (editor/characters.py reads them from the game), saved in
// tools/mapkit/characters/<id>.json, placed with Place in map or from the Browser (Objects > Custom
// characters). In the game they are UCCustomCivilian / UCCustomSoldier / UCCustomThug with the Mesh,
// MultiSkins and LookBody set here (src/<settings.PACKAGE>/Classes/UCCustomLook.uc): they keep that look, and
// so does their corpse.
import * as THREE from 'three';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const E = () => window.__editor;
const MASKS = ['pinkmasktex', 'graymasktex', 'blackmasktex'];
const hidden = (t) => !t || MASKS.includes(String(t).split('.').pop().toLowerCase());
const ref = (v) => { const m = /'([^']+)'/.exec(String(v || '')); return m ? m[1] : (v && !/['()]/.test(v) && v !== 'None' ? String(v) : null); };
const BEHAVIOURS = [
  ['civilian', 'Civilian', 'Goes about their business and runs away from fights'],
  ['soldier', 'Soldier', 'Trained: guards, takes cover, fights back'],
  ['thug', 'Criminal', 'Street fighter: attacks when provoked'],
];
const ORDERS = [['Standing', 'stands where you put them'], ['Wandering', 'walks around'], ['Sitting', 'sits down (on a seat nearby)'], ['Dancing', 'dances']];
const ATTITUDE = [['', '(as the faction says)'], ['1', 'friendly'], ['0', 'neutral'], ['-1', 'hostile']];
const MAX_ITEMS = 4;
const PF = { masked: 2, translucent: 4, modulated: 64 };

let cat = null, chars = [], cur = null, dirty = false, readyP = null, items = [];
const models = {};
let open = null;              // the group whose gallery is open

async function api(url, body) {
  const r = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

// the catalog, the saved characters and the 3D model of every body (once)
function ready() {
  if (!readyP) {
    readyP = (async () => {
      const r = await api('/api/characters');
      chars = r.characters || [];
      cat = await (await fetch(r.catalog)).json();
      await Promise.all(Object.entries(cat.bodies).map(async ([k, b]) => { models[k] = await (await fetch('/cache/_characters/' + b.model)).json(); }));
      if (E() && E().refreshPalette) E().refreshPalette();
      return true;
    })().catch((e) => { readyP = null; throw e; });
  }
  return readyP;
}

const bodyOfMesh = (mesh) => cat && Object.keys(cat.bodies).find((k) => cat.bodies[k].mesh.toLowerCase() === String(mesh || '').toLowerCase());
const person = (cls) => cat.people.find((p) => p.cls === cls);
const optionsOf = (g) => cat.options[g.key] || [];
const nameOf = (cls) => { const p = cat && person(cls); return p ? p.name : cls; };

// the parts of a body with the skins of a character (for the 3D view of the map and the preview)
function partsOf(key, skins) {
  const out = [], textures = {};
  for (const part of models[key].parts) {
    const t = skins[part.slot];
    if (hidden(t)) continue;
    textures[t] = { png: cat.textures[t] || null };
    out.push({ tex: t, flags: part.flags, slot: part.slot, pos: part.pos, uv: part.uv });
  }
  return { key: key + '|' + skins.join(','), parts: out, textures };
}
function partsOfActor(a) {
  if (!cat) return null;
  const p = a.props || {};
  const key = bodyOfMesh(ref(p.Mesh));
  if (!key || !models[key]) return null;
  const skins = [...Array(8)].map((_, i) => (`MultiSkins(${i})` in p ? ref(p[`MultiSkins(${i})`]) : cat.bodies[key].skins[i]));
  return partsOf(key, skins);
}

// the properties of a placed character (the T3D of the map); its BindName is given when it is placed
function propsOf(ch) {
  if (typeof ch === 'string') ch = chars.find((c) => c.id === ch);
  if (!ch || !cat || !cat.bodies[ch.body]) return {};
  const b = cat.bodies[ch.body], p = {};
  const name = String(ch.name || 'Stranger').replace(/"/g, '');
  p.Mesh = `LodMesh'${b.mesh}'`;
  ch.skins.forEach((t, i) => { if (t) p[`MultiSkins(${i})`] = `Texture'${t}'`; });
  if (ch.texture && ch.texture !== 'Engine.S_Pawn') p.Texture = `Texture'${ch.texture}'`;
  p.LookBody = `Class'${ch.lookPkg || 'DeusEx'}.${ch.lookBody || b.lookBody}'`;
  p.CollisionRadius = b.radius.toFixed(6);
  p.CollisionHeight = b.height.toFixed(6);
  if (Math.abs((b.drawScale || 1) - 1) > 1e-3) p.DrawScale = b.drawScale.toFixed(6);
  p.FamiliarName = `"${name}"`;
  p.UnfamiliarName = `"${String(ch.unfamiliar || name).replace(/"/g, '')}"`;
  if (ch.faction) p.Alliance = ch.faction.replace(/\W/g, '_');
  if (ch.toJC !== undefined && ch.toJC !== '') p['InitialAlliances(0)'] = `(AllianceName=Player,AllianceLevel=${(+ch.toJC).toFixed(6)},bPermanent=${ch.fixed ? 'True' : 'False'})`;
  (ch.inventory || []).slice(0, 8).forEach(([cls, n], i) => { if (cls) p[`InitialInventory(${i})`] = `(Inventory=Class'${cls}',Count=${Math.max(1, +n || 1)})`; });
  const hp = Math.round(+ch.health || 100);
  if (hp !== 100) for (const k of ['Health', 'HealthHead', 'HealthTorso', 'HealthArmLeft', 'HealthArmRight', 'HealthLegLeft', 'HealthLegRight']) p[k] = String(hp);
  if (ch.orders) p.Orders = ch.orders;
  return p;
}
function placeItem(ch) {
  const b = cat.bodies[ch.body];
  return { cls: cat.classes[ch.behaviour] || 'UCCustomCivilian', name: ch.name, radius: b.radius, height: b.height, custom: ch.id };
}

// ---------------------------------------------------------------- the panel
const box = document.createElement('div');
box.id = 'charbox';
document.body.appendChild(box);
box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
box.innerHTML = `<div class="ch-head"><b>Characters</b><span class="hint" style="margin:0 0 0 10px">Make your own characters from the faces, bodies and clothes of the game's characters. Save them, then place them with <i>Place in map</i>, or from the Browser (<i>Objects &gt; Custom characters</i>).</span>
    <a href="/guide#characters" target="_blank" style="margin-left:auto;color:var(--acc)">Guide</a><button id="ch-close">Close</button></div>
  <div class="ch-cols">
    <div class="ch-list"><div class="row"><button id="ch-new" class="primary">+ New</button><button id="ch-import" title="Load a character saved as a .json file (shared by someone else)">Import</button>
      <input type="file" id="ch-file" accept=".json,application/json" style="display:none"></div><div id="ch-items"></div></div>
    <div class="ch-view"><canvas id="ch-canvas"></canvas><div class="hint ch-viewhint">Drag to turn · wheel to zoom</div></div>
    <div class="ch-form" id="ch-form"></div>
  </div>`;
$('#ch-close', box).onclick = () => close();
$('#ch-new', box).onclick = () => { if (confirmLeave()) edit(newCharacter()); };
$('#ch-import', box).onclick = () => $('#ch-file', box).click();
$('#ch-file', box).onchange = async () => {
  const f = $('#ch-file', box).files[0];
  $('#ch-file', box).value = '';
  if (!f || !confirmLeave()) return;
  try {
    const ch = JSON.parse(await f.text());
    if (!ch || !cat.bodies[ch.body] || !Array.isArray(ch.skins)) throw new Error('not a character file of this editor');
    if (chars.some((c) => c.id === ch.id)) ch.id = '';                 // a copy: it gets its own file
    edit(ch, true);
    status(`Imported "${ch.name}": Save to keep it.`);
  } catch (e) { status('Import failed: ' + e.message, 'bad'); }
};

function status(text, cls = '') { const s = $('#ch-status', box); if (s) { s.textContent = text; s.className = 'hint ' + cls; } if (E() && E().log) E().log(text, cls || 'ok'); }
function confirmLeave() { return !dirty || window.confirm('The character has changes that are not saved. Leave them?'); }
let closeRevision = 0;
function close(force = false) { if (force !== true && !confirmLeave()) return; closeRevision++; dirty = false; box.style.display = 'none'; stopView(); }

function newCharacter() {
  const p = person('ThugMale') || cat.people[0];
  return fromPerson({ id: '', name: 'New character', faction: '', toJC: '', fixed: false, health: 100, orders: 'Standing' }, p, true);
}
function fromPerson(ch, p, all) {
  const b = cat.bodies[p.body];
  ch.body = p.body;
  ch.skins = p.skins.slice(0, 8);
  ch.texture = p.texture;
  ch.lookBody = p.cls;
  ch.lookPkg = p.pkg;
  ch.from = p.cls;
  if (all) {
    ch.behaviour = p.behaviour;
    ch.inventory = (p.inventory || []).slice(0, MAX_ITEMS);
    if (!ch.faction && p.alliance && p.alliance !== 'None') ch.faction = p.alliance;
  }
  if (!b) ch.body = Object.keys(cat.bodies)[0];
  return ch;
}
// another body: the pieces it shares with the old one stay (a face, the trousers...)
function setBody(key) {
  const old = cat.bodies[cur.body], b = cat.bodies[key];
  const skins = b.skins.slice(0, 8);
  for (const g of b.groups) {
    const og = old.groups.find((x) => x.key === g.key);
    if (!og) continue;
    if (g.kind === 'face') for (const s of g.slots) skins[s] = cur.skins[og.head];
    else g.slots.forEach((s, i) => { skins[s] = cur.skins[og.slots[i]]; });
  }
  cur.body = key;
  cur.skins = skins;
  cur.texture = b.texture;
  cur.lookBody = b.lookBody;
  cur.lookPkg = b.lookPkg;
}
function current(g) {
  const opts = optionsOf(g);
  return opts.findIndex((o) => (g.kind === 'face' ? o.tex[0] === cur.skins[g.head] : o.tex.every((t, i) => t === cur.skins[g.slots[i]])));
}
function apply(g, o) {
  if (g.kind === 'face') for (const s of g.slots) cur.skins[s] = o.tex[0];
  else g.slots.forEach((s, i) => { cur.skins[s] = o.tex[i]; });
}
function thumb(o, big) {
  const t = o.tex.find((x) => !hidden(x));
  const who = o.from.length ? `from ${o.from.slice(0, 3).map(nameOf).join(', ')}${o.from.length > 3 ? ` +${o.from.length - 3}` : ''}` : '';
  return t && cat.textures[t] ? `<img src="${cat.textures[t]}" alt="" title="${esc(who || t)}" class="${big ? 'big' : ''}">` : `<span class="none" title="${esc(who)}">none</span>`;
}
function randomize(which) {
  for (const g of cat.bodies[cur.body].groups) {
    if ((which === 'face') !== (g.kind === 'face')) continue;
    const opts = optionsOf(g);
    if (opts.length) apply(g, opts[Math.floor(Math.random() * opts.length)]);
  }
  changed();
}

function renderList() {
  $('#ch-items', box).innerHTML = chars.length ? chars.map((c) => `<button class="item ${cur && cur.id === c.id ? 'active' : ''}" data-id="${esc(c.id)}">${esc(c.name)}<small>${esc((cat.bodies[c.body] || {}).label || c.body)}</small></button>`).join('')
    : '<div class="hint">No characters yet: press <b>+ New</b>.</div>';
  for (const b of box.querySelectorAll('#ch-items [data-id]')) b.onclick = () => { if (confirmLeave()) edit(JSON.parse(JSON.stringify(chars.find((c) => c.id === b.dataset.id)))); };
}

function renderForm() {
  const b = cat.bodies[cur.body];
  const people = [...cat.people].sort((x, y) => x.name.localeCompare(y.name));
  const groupsHtml = b.groups.map((g) => {
    const opts = optionsOf(g), k = current(g);
    const o = opts[k];
    return `<div class="ch-group"><div class="row"><span class="ch-glabel">${esc(g.label)}</span>
      <button data-step="${g.id}:-1" title="previous">&#9664;</button>${o ? thumb(o) : '<span class="none">custom</span>'}<button data-step="${g.id}:1" title="next">&#9654;</button>
      <button data-gal="${g.id}" class="${open === g.id ? 'active' : ''}" title="every version the game has">${opts.length} &#9662;</button>
      <span class="hint ch-from">${o && o.from.length ? 'from ' + esc(nameOf(o.from[0])) + (o.from.length > 1 ? ` +${o.from.length - 1}` : '') : o ? 'none' : ''}</span></div>
      ${open === g.id ? `<div class="ch-gal">${opts.map((x, i) => `<button data-pick="${g.id}:${i}" class="${i === k ? 'on' : ''}">${thumb(x, true)}</button>`).join('')}</div>` : ''}</div>`;
  }).join('');
  const inv = (cur.inventory || []).map(([cls, n], i) => `<div class="row"><select data-inv="${i}" style="flex:1;min-width:0"><option value="">(nothing)</option>${[...new Set(items.map((x) => x.cat))].map((c) => `<optgroup label="${esc(c)}">${items.filter((x) => x.cat === c).map((x) => `<option value="${esc(x.cls)}" ${x.cls.toLowerCase() === String(cls).toLowerCase() ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}</select>
      <input type="number" data-count="${i}" value="${+n || 1}" min="1" max="99" style="width:56px" title="how many"><button data-delinv="${i}" title="remove">&#10005;</button></div>`).join('');
  $('#ch-form', box).innerHTML = `
    <div class="row"><label>Name</label><input type="text" id="ch-name" value="${esc(cur.name)}" style="flex:1;min-width:0" title="Shown in the game when JC looks at them or talks to them"></div>
    <div class="row"><label>Start from</label><select id="ch-from" style="flex:1;min-width:0"><option value="">a character of the game...</option>${BEHAVIOURS.map(([k, t]) => `<optgroup label="${t}s">${people.filter((p) => p.behaviour === k).map((p) => `<option value="${esc(p.cls)}">${esc(p.name)} (${esc(p.cls)})</option>`).join('')}</optgroup>`).join('')}</select></div>
    <div class="hint" style="margin:0 0 6px">Takes their whole look, behaviour and weapons; then change the pieces you want.</div>
    <div class="row"><label>Body</label><select id="ch-body" style="flex:1;min-width:0">${Object.entries(cat.bodies).sort((x, y) => x[1].label.localeCompare(y[1].label)).map(([k, x]) => `<option value="${k}" ${k === cur.body ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
    <div class="ch-sec">Look <button id="ch-rface" title="a random face of the game">Random face</button><button id="ch-rclothes" title="random clothes of the game for this body">Random clothes</button></div>
    ${groupsHtml}
    <div class="ch-sec">Behaviour</div>
    <div class="row" style="flex-wrap:wrap">${BEHAVIOURS.map(([k, t, h]) => `<label style="width:auto" title="${esc(h)}"><input type="radio" name="ch-beh" value="${k}" ${cur.behaviour === k ? 'checked' : ''}> ${t}</label>`).join('')}</div>
    <div class="row"><label>When placed</label><select id="ch-orders">${ORDERS.map(([k, t]) => `<option value="${k}" ${cur.orders === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="row"><label>Health</label><input type="number" id="ch-health" value="${+cur.health || 100}" min="1" max="2000" step="10" style="width:80px"><span class="hint" style="margin:0">100 = normal</span></div>
    <div class="ch-sec">Faction</div>
    <div class="row"><label>Faction</label><input type="text" id="ch-fac" list="factionlist" value="${esc(cur.faction || '')}" placeholder="none" style="flex:1;min-width:0" title="Characters of the same faction are always friends (e.g. a new gang: RedHand)"></div>
    <div class="row"><label>Towards JC</label><select id="ch-tojc">${ATTITUDE.map(([k, t]) => `<option value="${k}" ${String(cur.toJC ?? '') === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label style="width:auto" title="it never changes by itself (attacks do not make them hostile)"><input type="checkbox" id="ch-fixed" ${cur.fixed ? 'checked' : ''}> fixed</label></div>
    <div class="ch-sec">Carries</div>
    ${inv}${(cur.inventory || []).length < MAX_ITEMS ? '<div class="row"><button id="ch-addinv">+ weapon or item</button></div>' : ''}
    <div class="ch-sec"></div>
    <div class="row" style="flex-wrap:wrap"><button id="ch-save" class="primary">Save</button><button id="ch-place" class="primary" title="Save, then click a floor of the map to put the character there">Place in map</button>
      <button id="ch-player" title="Use this appearance as the player in the current map; gameplay and progress stay shared">Use as player</button><button id="ch-dup">Duplicate</button><button id="ch-export" title="Save as a .json file to share">Export</button><button id="ch-del">Delete</button></div>
    <div id="ch-status" class="hint" style="margin:6px 0">${dirty ? 'Not saved yet.' : ''}</div>`;
  wireForm();
}

function wireForm() {
  const f = $('#ch-form', box);
  $('#ch-name', f).oninput = () => { cur.name = $('#ch-name', f).value; dirty = true; };
  $('#ch-from', f).onchange = () => { const p = person($('#ch-from', f).value); if (p) { fromPerson(cur, p, true); changed(); } };
  $('#ch-body', f).onchange = () => { setBody($('#ch-body', f).value); changed(); };
  $('#ch-rface', f).onclick = () => randomize('face');
  $('#ch-rclothes', f).onclick = () => randomize('clothes');
  for (const r of f.querySelectorAll('[name=ch-beh]')) r.onchange = () => { cur.behaviour = r.value; dirty = true; };
  $('#ch-orders', f).onchange = () => { cur.orders = $('#ch-orders', f).value; dirty = true; };
  $('#ch-health', f).onchange = () => { cur.health = Math.max(1, Math.round(+$('#ch-health', f).value || 100)); dirty = true; };
  $('#ch-fac', f).onchange = () => { cur.faction = $('#ch-fac', f).value.trim().replace(/\W/g, '_'); dirty = true; };
  $('#ch-tojc', f).onchange = () => { cur.toJC = $('#ch-tojc', f).value; dirty = true; };
  $('#ch-fixed', f).onchange = () => { cur.fixed = $('#ch-fixed', f).checked; dirty = true; };
  const groups = cat.bodies[cur.body].groups;
  const byId = (id) => groups.find((g) => g.id === id);
  for (const b of f.querySelectorAll('[data-step]')) b.onclick = () => {
    const [id, d] = b.dataset.step.split(':');
    const g = byId(id), opts = optionsOf(g);
    if (!opts.length) return;
    apply(g, opts[(Math.max(0, current(g)) + +d + opts.length) % opts.length]);
    changed();
  };
  for (const b of f.querySelectorAll('[data-gal]')) b.onclick = () => { open = open === b.dataset.gal ? null : b.dataset.gal; renderForm(); };
  for (const b of f.querySelectorAll('[data-pick]')) b.onclick = () => { const [id, i] = b.dataset.pick.split(':'); apply(byId(id), optionsOf(byId(id))[+i]); changed(); };
  for (const s of f.querySelectorAll('[data-inv]')) s.onchange = () => { cur.inventory[+s.dataset.inv][0] = s.value; dirty = true; };
  for (const s of f.querySelectorAll('[data-count]')) s.onchange = () => { cur.inventory[+s.dataset.count][1] = Math.max(1, Math.round(+s.value || 1)); dirty = true; };
  for (const s of f.querySelectorAll('[data-delinv]')) s.onclick = () => { cur.inventory.splice(+s.dataset.delinv, 1); dirty = true; renderForm(); };
  if ($('#ch-addinv', f)) $('#ch-addinv', f).onclick = () => { (cur.inventory = cur.inventory || []).push(['DeusEx.WeaponPistol', 1]); dirty = true; renderForm(); };
  $('#ch-save', f).onclick = () => save().catch((e) => status('Save failed: ' + e.message, 'bad'));
  $('#ch-player', f).onclick = async () => {
    try {
      if (!E()?.mapName) throw new Error('Open a map first.');
      if (dirty || !cur.id) await save();
      await E().usePlayerCharacter(cur.id);
      status('Chosen for this map. Save and Rebuild to apply; player progress stays shared.');
    } catch (error) { status(error.message, 'bad'); }
  };
  $('#ch-place', f).onclick = async () => {
    try {
      if (dirty || !cur.id) await save();
      if (!E() || !E().mapName) { status('Open a map first.', 'warn'); return; }
      const item = placeItem(cur);
      dirty = false;
      close();
      E().startPlacing(item);
    } catch (e) { status('Save failed: ' + e.message, 'bad'); }
  };
  $('#ch-dup', f).onclick = () => { const c = JSON.parse(JSON.stringify(cur)); c.id = ''; c.name = cur.name + ' 2'; edit(c, true); status('A copy: change it, then Save.'); };
  $('#ch-export', f).onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cur, null, 1)], { type: 'application/json' }));
    a.download = (cur.id || 'character') + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#ch-del', f).onclick = async () => {
    if (!cur.id) { dirty = false; edit(chars[0] ? JSON.parse(JSON.stringify(chars[0])) : newCharacter()); return; }
    if (!window.confirm(`Delete "${cur.name}"? Characters already placed in maps stay as they are.`)) return;
    const r = await api('/api/characters_delete', { id: cur.id });
    chars = r.characters;
    dirty = false;
    edit(chars[0] ? JSON.parse(JSON.stringify(chars[0])) : newCharacter());
    E().refreshPalette();
  };
}

async function save() {
  const revision = closeRevision;
  cur.name = String(cur.name || '').trim() || 'Character';
  const r = await api('/api/characters', { character: cur });
  if (revision !== closeRevision) return;
  cur = JSON.parse(JSON.stringify(r.character));
  chars = r.characters;
  dirty = false;
  renderList();
  renderForm();
  // the copies already placed in the open map take the new look
  const n = E() && E().updateCustom ? E().updateCustom(cur.id, propsOf(cur), cat.bodies[cur.body], cat.classes[cur.behaviour]) : 0;
  E().refreshPalette();
  status(`Saved "${cur.name}"${n ? `: ${n} placed cop${n === 1 ? 'y' : 'ies'} in this map updated (Save the map, then Rebuild)` : ''}.`, 'ok');
}

function changed() { dirty = true; renderForm(); showModel(); }
function edit(ch, isDirty = false) {
  cur = ch;
  open = null;
  dirty = isDirty;
  renderList();
  renderForm();
  showModel();
}

// ---------------------------------------------------------------- 3D preview
let renderer = null, scene = null, camera = null, model = null, raf = 0;
const view = { yaw: 0.6, dist: 150, drag: null, auto: true };
const texLoader = new THREE.TextureLoader(), texCache = {};
function startView() {
  const canvas = $('#ch-canvas', box);
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x23262e);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444450, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(80, 120, 100);
    scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 40), new THREE.MeshLambertMaterial({ color: 0x30343d }));
    floor.rotation.x = -Math.PI / 2;
    floor.name = 'floor';
    scene.add(floor);
    camera = new THREE.PerspectiveCamera(35, 1, 1, 2000);
    canvas.addEventListener('pointerdown', (e) => { view.drag = { x: e.clientX, yaw: view.yaw }; view.auto = false; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (view.drag) view.yaw = view.drag.yaw - (e.clientX - view.drag.x) * 0.01; });
    canvas.addEventListener('pointerup', () => { view.drag = null; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.dist = Math.min(400, Math.max(60, view.dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
  }
  cancelAnimationFrame(raf);
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) { renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
    if (view.auto) view.yaw += 0.004;
    const b = cur && cat.bodies[cur.body];
    const mid = b ? b.height * 0.15 : 0;
    camera.position.set(Math.cos(view.yaw) * view.dist, mid + 12, Math.sin(view.yaw) * view.dist);
    camera.lookAt(0, mid, 0);
    renderer.render(scene, camera);
  };
  loop();
}
function stopView() { cancelAnimationFrame(raf); }
function material(url, flags) {
  let map = null;
  if (url) {
    map = texCache[url] || (texCache[url] = texLoader.load(url));
    map.flipY = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
  }
  const o = { map, side: THREE.DoubleSide, color: map ? 0xffffff : 0x888888 };
  if (flags & PF.masked) o.alphaTest = 0.5;
  if (flags & PF.translucent) Object.assign(o, { transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
  else if (flags & PF.modulated) Object.assign(o, { transparent: true, opacity: 0.5, depthWrite: false });
  return new THREE.MeshLambertMaterial(o);
}
function showModel() {
  if (!scene || !cur) return;
  if (model) { scene.remove(model); model.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  model = new THREE.Group();
  const b = cat.bodies[cur.body];
  for (const part of partsOf(cur.body, cur.skins).parts) {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(part.pos.length);
    for (let i = 0; i < pos.length; i += 3) { pos[i] = part.pos[i]; pos[i + 1] = part.pos[i + 2]; pos[i + 2] = part.pos[i + 1]; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(part.uv), 2));
    geo.computeVertexNormals();
    model.add(new THREE.Mesh(geo, material(cat.textures[part.tex], part.flags)));
  }
  model.scale.setScalar(b.drawScale || 1);
  scene.add(model);
  const floor = scene.getObjectByName('floor');
  if (floor) floor.position.y = -b.height;
}

async function openPanel(id) {
  box.style.display = 'flex';
  $('#ch-form', box).innerHTML = '<div class="hint">Reading the characters of the game (the first time, about a minute)...</div>';
  try {
    await ready();
    if (!items.length) { try { items = (await api('/api/props?cls=UCCustomSoldier')).items || []; } catch (e) { items = []; } }
    if (E() && E().loadFactions) E().loadFactions().catch(() => {});
    startView();
    const ch = (id && chars.find((c) => c.id === id)) || (cur && !id ? cur : null) || chars[0];
    edit(ch ? JSON.parse(JSON.stringify(ch)) : newCharacter(), !!(cur && !id && dirty));
  } catch (e) {
    $('#ch-form', box).innerHTML = `<div class="hint bad">Could not read the characters: ${esc(e.message)}</div>`;
  }
}

// A photo of a character's head as the game's InfoLink portraits are made (head and shoulders, turned a
// little, a dark background, a light from one side): a PNG data URL of `size` pixels. opts: yaw (degrees
// from the front, + = the face turned to its left), up (degrees the camera looks down), zoom (1 = head and
// shoulders), key (degrees of the light round the head), bg (two colours of the background).
async function portrait(ch, opts = {}) {
  await ready();
  const b = cat.bodies[ch.body];
  if (!b || !models[ch.body]) throw new Error('no body ' + ch.body);
  const size = opts.size || 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  const sc = new THREE.Scene();
  const bg = opts.bg || ['#3a3d42', '#0b0c0e'];
  const g = document.createElement('canvas');
  g.width = g.height = 64;
  const gc = g.getContext('2d'), grad = gc.createRadialGradient(24, 22, 4, 32, 32, 46);
  grad.addColorStop(0, bg[0]);
  grad.addColorStop(1, bg[1]);
  gc.fillStyle = grad;
  gc.fillRect(0, 0, 64, 64);
  sc.background = new THREE.CanvasTexture(g);
  sc.background.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  const pending = [];
  for (const part of partsOf(ch.body, ch.skins).parts) {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(part.pos.length);
    for (let i = 0; i < pos.length; i += 3) { pos[i] = part.pos[i]; pos[i + 1] = part.pos[i + 2]; pos[i + 2] = part.pos[i + 1]; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(part.uv), 2));
    geo.computeVertexNormals();
    const url = cat.textures[part.tex];
    let map = null;
    if (url) {
      map = await new Promise((res) => { texLoader.load(url, res, undefined, () => res(null)); pending.push(1); });
      if (map) { map.flipY = false; map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; }
    }
    const o = { map, side: THREE.DoubleSide, color: map ? 0xffffff : 0x888888 };
    if (part.flags & PF.masked) o.alphaTest = 0.5;
    if (part.flags & PF.translucent) Object.assign(o, { transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
    else if (part.flags & PF.modulated) Object.assign(o, { transparent: true, opacity: 0.5, depthWrite: false });
    group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial(o)));
  }
  group.scale.setScalar(b.drawScale || 1);
  sc.add(group);
  // the top of the head and the middle of the face (the models face +x)
  const box3 = new THREE.Box3().setFromObject(group), top = box3.max.y;
  const zoom = opts.zoom || 1, headY = top - 7.5;
  const yaw = THREE.MathUtils.degToRad(opts.yaw ?? 28), up = THREE.MathUtils.degToRad(opts.up ?? 4);
  const dist = 52 / zoom;
  const cam = new THREE.PerspectiveCamera(24, 1, 1, 500);
  cam.position.set(Math.cos(yaw) * Math.cos(up) * dist, headY + Math.sin(up) * dist, Math.sin(yaw) * Math.cos(up) * dist);
  cam.lookAt(0, headY - 2.5 / zoom, 0);
  sc.add(new THREE.HemisphereLight(0xb8c4d8, 0x1a1a20, 0.55));
  const key = new THREE.DirectionalLight(0xfff2e0, 2.4), k = THREE.MathUtils.degToRad(opts.key ?? 55);
  key.position.set(Math.cos(k) * 100, headY + 60, Math.sin(k) * 100);
  sc.add(key);
  const rim = new THREE.DirectionalLight(0x9fb4ff, 0.8);
  rim.position.set(-80, headY + 30, -Math.sin(k) * 90);
  sc.add(rim);
  r.render(sc, cam);
  const url = canvas.toDataURL('image/png');
  group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  r.dispose();
  return url;
}

// for the map editor (app.js): the Add list, the 3D models of placed characters, placing
window.__characters = {
  close,
  get dirty() { return dirty; },
  portrait: async (id, opts) => { await ready(); const c = typeof id === 'object' ? id : chars.find((x) => x.id === id); if (!c) throw new Error('no character ' + id); return portrait(c, opts); },
  ready,
  open: openPanel,
  parts: partsOfActor,
  propsOf,
  isCustom: (cls) => /^UCCustom(Civilian|Soldier|Thug)$/.test(cls || ''),
  paletteCategory() {
    if (!cat) return null;
    return { category: 'Custom characters', items: chars.map((c) => Object.assign(placeItem(c), { sub: (cat.bodies[c.body] || {}).label || '' })) };
  },
  item(id) { const c = chars.find((x) => x.id === id); return c ? placeItem(c) : null; },
  stamp(id) { const c = chars.find((x) => x.id === id); return c ? String([c.body].concat(c.skins).join(',').split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)) : ''; },
};
ready().catch(() => {});      // the Add list shows the saved characters as soon as the editor opens
