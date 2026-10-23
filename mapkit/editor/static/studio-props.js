/* Visual accessories: the same bone-space transform in the preview and game bake. */
import * as THREE from 'three';

export function propTransform(prop, bone, world) {
  const local = new THREE.Quaternion().setFromEuler(new THREE.Euler(...prop.rotation.map(v => v * Math.PI / 180), 'XYZ'));
  if (prop.space === 'scene') return { position: new THREE.Vector3(...prop.position), quaternion: local };
  return {
    position: new THREE.Vector3(...prop.position).applyQuaternion(world.Rw[bone]).add(world.Jw[bone]),
    quaternion: world.Rw[bone].clone().multiply(local),
  };
}

// Changing the parent keeps the visible pose, rather than teleporting to the new bone.
export function reparentProp(prop, space, bone, boneIndex, world) {
  const t = propTransform(prop, boneIndex[prop.bone], world);
  if (space !== 'scene') {
    const b = boneIndex[bone], inv = world.Rw[b].clone().invert();
    t.position.sub(world.Jw[b]).applyQuaternion(inv);
    t.quaternion.premultiply(inv);
  }
  const e = new THREE.Euler().setFromQuaternion(t.quaternion, 'XYZ');
  prop.space = space; prop.bone = bone;
  prop.position = t.position.toArray();
  prop.rotation = [e.x, e.y, e.z].map(v => v * 180 / Math.PI);
}

// Three uses (forward, up, right); Unreal uses (forward, right, up).
export function unrealTransform(transform) {
  const q = transform.quaternion;
  const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const y = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const z = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const unit = 65536 / (2 * Math.PI);
  const pitch = Math.atan2(x.y, Math.hypot(x.x, x.z));
  const yaw = Math.atan2(x.z, x.x);
  const roll = Math.atan2(-y.y, z.y);
  return { position: [transform.position.x, transform.position.z, transform.position.y],
    rotation: [pitch, yaw, roll].map(v => Math.round(v * unit)) };
}

export function bakeProps(anim, rig, boneIndex, poseAt, worldOf) {
  const props = (anim.props || []).filter(p => p.enabled !== false);
  const tracks = props.map(p => ({ id: p.id, cls: p.cls, scale: p.scale, space: p.space || 'bone', samples: [] }));
  for (let f = 0; props.length && f < anim.frames; f++) {
    const world = worldOf(rig, poseAt(anim, f));
    props.forEach((p, i) => tracks[i].samples.push(unrealTransform(propTransform(p, boneIndex[p.bone], world))));
  }
  return tracks;
}

export function createPropPreview(scene, textures, onError) {
  const root = new THREE.Group(); scene.add(root);
  const models = new Map();
  let generation = 0;
  let current = [], world = null, boneIndex = null, active = false;
  function dispose(group) {
    group.traverse(o => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  }
  async function load(cls) {
    const token = generation;
    models.set(cls, null);
    try {
      const r = await fetch(`/cache/_palette/models/${encodeURIComponent(cls)}.json`);
      if (!r.ok) throw new Error('Model is not available in this game');
      const data = await r.json();
      if (!data.parts?.length) throw new Error('This object has no visible model');
      const group = new THREE.Group();
      for (const part of data.parts) {
        if (part.flags & 1) continue;
        const a = part.pos, pos = new Float32Array(a.length);
        for (let i = 0; i < a.length; i += 3) { pos[i] = a[i]; pos[i + 1] = a[i + 2]; pos[i + 2] = a[i + 1]; }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(part.uv, 2)); g.computeVertexNormals();
        const opts = { color: 0xffffff, side: part.flags & 256 ? THREE.DoubleSide : THREE.FrontSide };
        const png = textures()[part.tex]?.png;
        if (png) {
          opts.map = new THREE.TextureLoader().load('/cache/_palette/' + png);
          opts.map.colorSpace = THREE.SRGBColorSpace; opts.map.flipY = false; opts.map.magFilter = THREE.NearestFilter;
        }
        if (part.flags & 2) opts.alphaTest = .5;
        if (part.flags & 4) { opts.transparent = true; opts.blending = THREE.AdditiveBlending; opts.depthWrite = false; }
        group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial(opts)));
      }
      // clear() may have run while a request was in flight.
      if (token !== generation) { dispose(group); return; }
      models.set(cls, group); sync(current, world, boneIndex, active);
    } catch (e) {
      if (token !== generation) return;
      onError(`${cls}: ${e.message}. Choose another prop or remove it.`);
    }
  }
  function sync(props, w, bones, visible = true) {
    current = props || []; world = w; boneIndex = bones; active = visible;
    root.visible = !!visible && !!w;
    const wanted = new Map(current.map(p => [p.id, p]));
    for (const child of [...root.children]) {
      if (!wanted.has(child.userData.id) || wanted.get(child.userData.id).cls !== child.userData.cls) root.remove(child);
    }
    if (!root.visible) return;
    for (const p of current) {
      let child = root.children.find(o => o.userData.id === p.id);
      if (!child && !models.has(p.cls)) void load(p.cls);
      if (!child && models.get(p.cls)) { child = models.get(p.cls).clone(); child.userData = { id: p.id, cls: p.cls }; root.add(child); }
      if (!child) continue;
      child.visible = p.enabled !== false;
      if (p.space !== 'scene' && bones[p.bone] === undefined) { child.visible = false; continue; }
      const t = propTransform(p, bones[p.bone], w);
      child.position.copy(t.position); child.quaternion.copy(t.quaternion); child.scale.setScalar(p.scale);
    }
  }
  // the prop's object in the 3D view (the Studio selects it and puts the gizmo on it)
  const objectOf = (id) => root.children.find(o => o.userData.id === id) || null;
  return { root, sync, objectOf, hide() { active = false; root.visible = false; }, clear() {
    generation++; active = false; current = []; root.clear(); for (const g of models.values()) if (g) dispose(g); models.clear();
  } };
}

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// live: { begin(), preview() } — a number typed or dragged (its label) shows at once; the change it ends with
// is kept as one undo step (begin is the step's start)
export function renderPropPanel(host, state, bones, edit, status, live = null) {
  const anim = state.anim, props = anim.props || [];
  const section = document.createElement('details'); section.className = 'st-props';
  section.open = state.propsOpen ?? props.length > 0;
  section.innerHTML = `<summary>Props <span>${props.length}</span></summary><div class="st-props-body"></div>`;
  section.ontoggle = () => { state.propsOpen = section.open; };
  host.append(section);
  const body = section.querySelector('.st-props-body');
  const catalog = (window.__editor?.palette || []).filter(g => ['Decorations', 'Pickups', 'Weapons', 'Ammo'].includes(g.category))
    .flatMap(g => g.items).filter(p => !p.nomodel);
  const all = [...new Map(catalog.map(p => [p.cls, p])).values()];
  const byClass = Object.fromEntries(all.map(p => [p.cls, p.name || p.cls]));
  if (!props.some(p => p.id === state.propId)) state.propId = props[0]?.id;
  const p = props.find(p => p.id === state.propId);
  body.innerHTML = `<div class="st-prop-row"><select aria-label="Prop" class="st-prop-list">${props.map(p => `<option value="${escape(p.id)}" ${p.id === state.propId ? 'selected' : ''}>${escape(byClass[p.cls] || p.cls)}</option>`).join('')}</select><button class="st-prop-add" ${props.length >= 8 ? 'disabled' : ''}>+ Add prop</button></div>
    <div class="st-prop-picker" hidden><input type="search" aria-label="Find game prop" placeholder="Find a bottle, cigarette…"><select size="5" aria-label="Game props"></select><select class="st-prop-placement" aria-label="New prop placement"><option value="scene">In scene</option><option value="bone">Attached to bone</option></select><button class="st-prop-attach">Add prop</button></div>
    ${p ? `<div class="st-prop-row"><label>Placement</label><select class="st-prop-space" aria-label="Prop placement"><option value="scene" ${p.space === 'scene' ? 'selected' : ''}>In scene</option><option value="bone" ${p.space !== 'scene' ? 'selected' : ''}>Attached to bone</option></select></div>
    <div class="st-prop-row" ${p.space === 'scene' ? 'hidden' : ''}><label>Bone</label><select class="st-prop-bone" aria-label="Prop bone">${bones.map(([name,,label]) => `<option value="${name}" ${p.bone === name ? 'selected' : ''}>${escape(label)}</option>`).join('')}</select></div>
    ${['position', 'rotation'].map(kind => `<div class="st-prop-transform"><span>${kind === 'position' ? (p.space === 'scene' ? 'Position' : 'Offset') : 'Rotation °'}</span>${['X','Y','Z'].map((axis,i) => `<label title="${p.space === 'scene' ? 'Scene' : 'Bone-local'} ${axis}${kind === 'position' ? ' (Y up)' : ''}">${axis}<input type="number" step="${kind === 'position' ? '.25' : '1'}" data-prop-kind="${kind}" data-axis="${i}" value="${p[kind][i]}" aria-label="Prop ${kind} ${axis}"></label>`).join('')}</div>`).join('')}
    <div class="st-prop-row"><label>Scale %</label><input type="number" class="st-prop-scale" min="1" max="1000" step="1" value="${p.scale * 100}" aria-label="Prop scale"><label class="st-prop-enabled"><input type="checkbox" ${p.enabled !== false ? 'checked' : ''}>Enabled</label></div>
    <div class="st-prop-row"><button class="st-prop-snap" title="${p.space === 'scene' ? 'Reset beside the character' : 'Reset the offset and rotation at this bone'}">${p.space === 'scene' ? 'Reset position' : 'Snap to bone'}</button><button class="st-prop-remove">Remove</button></div>` : '<div class="hint">Add a game object in the scene or on a bone.</div>'}
    <div class="hint">Visual only. Follows this animation; Save, then Rebuild to use in game.</div>`;
  const picker = body.querySelector('.st-prop-picker'), search = picker.querySelector('input'), choices = picker.querySelector('select');
  const fill = () => {
    const q = search.value.toLowerCase();
    choices.innerHTML = all.filter(a => `${a.name} ${a.cls}`.toLowerCase().includes(q)).map(a => `<option value="${escape(a.cls)}">${escape(a.name || a.cls)} · ${escape(a.cls)}</option>`).join('');
    if (choices.options.length) choices.selectedIndex = 0;
    picker.querySelector('button').disabled = !choices.options.length;
  };
  body.querySelector('.st-prop-add').onclick = () => { picker.hidden = !picker.hidden; if (!picker.hidden) { fill(); search.focus(); } };
  search.oninput = fill;
  picker.querySelector('button').onclick = () => {
    const cls = choices.value; if (!cls || props.length >= 8) return;
    const id = 'prop_' + crypto.randomUUID().replaceAll('-', '');
    state.propId = id; state.propsOpen = true;
    const space = picker.querySelector('.st-prop-placement').value;
    edit(() => (anim.props ||= []).push({ id, cls, space, bone: bones[state.bone || 0][0] === 'pelvis' ? 'r_hand' : bones[state.bone][0],
      position: space === 'scene' ? [0, 0, (state.rig?.H || 80) * .5] : [0,0,0], rotation: [0,0,0], scale: 1, enabled: true }));
    status(space === 'scene' ? `${byClass[cls] || cls} placed beside the character. Move it with G.` : `${byClass[cls] || cls} attached. Adjust Offset and Rotation to fit the grip.`);
  };
  body.querySelector('.st-prop-list').onchange = e => { state.propId = e.target.value; edit(() => {}); };
  if (!p) return;
  const reparent = (space, bone) => edit(() => reparentProp(p, space, bone, Object.fromEntries(bones.map(([n],i) => [n,i])), live.world()));
  body.querySelector('.st-prop-bone').onchange = e => reparent('bone', e.target.value);
  body.querySelector('.st-prop-space').onchange = e => reparent(e.target.value, p.bone || 'r_hand');
  for (const input of body.querySelectorAll('[data-prop-kind]')) input.oninput = () => {
    const v = Number(input.value), limit = input.dataset.propKind === 'position' ? 4096 : 36000;
    if (!live || !input.value || !Number.isFinite(v) || Math.abs(v) > limit) return;
    live.begin(); p[input.dataset.propKind][+input.dataset.axis] = v; live.preview();
  };
  body.querySelector('.st-prop-scale').oninput = e => {
    const v = Number(e.target.value);
    if (!live || !Number.isFinite(v) || v < 1 || v > 1000) return;
    live.begin(); p.scale = v / 100; live.preview();
  };
  for (const input of body.querySelectorAll('[data-prop-kind]')) input.onchange = () => {
    const v = Number(input.value), limit = input.dataset.propKind === 'position' ? 4096 : 36000;
    if (!input.value || !Number.isFinite(v) || Math.abs(v) > limit) { input.value = p[input.dataset.propKind][+input.dataset.axis]; return; }
    edit(() => { p[input.dataset.propKind][+input.dataset.axis] = v; });
  };
  body.querySelector('.st-prop-scale').onchange = e => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 1 || v > 1000) { e.target.value = p.scale * 100; return; }
    edit(() => { p.scale = v / 100; });
  };
  body.querySelector('.st-prop-enabled input').onchange = e => edit(() => { p.enabled = e.target.checked; });
  body.querySelector('.st-prop-snap').onclick = () => edit(() => { p.position = p.space === 'scene' ? [0,0,(state.rig?.H || 80) * .5] : [0,0,0]; p.rotation = [0,0,0]; });
  body.querySelector('.st-prop-remove').onclick = () => edit(() => { anim.props = props.filter(a => a !== p); });
}
