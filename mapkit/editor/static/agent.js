// An AI assistant at the editor (Tools > AI assistant...). The assistant's MCP server (deusedix_mcp.py) posts its
// calls to the project's server (editor/agent_bridge.py); this page asks for them (/api/agent/next, a long poll), runs
// each with the editor's own steps (window.__editor.agentKit, window.__story) and posts the answer back. So what it
// changes is in the editor at once, unsaved and undoable like a click's change. OPS is what it can do; the server
// keeps the same list (agent_bridge.OPS).
import * as THREE from 'three';
import { ensureIds, graphOf } from './story-graph.js';
import { createPlay } from './story-sim.js';

const E = () => window.__editor, K = () => window.__editor?.agentKit;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (v) => Math.round(v * 10) / 10;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// the page's last errors, for editor_state (an assistant cannot see the browser's console)
const errors = [];
function remember(text) { errors.push(String(text).slice(0, 400)); if (errors.length > 30) errors.shift(); }
window.addEventListener('error', (e) => remember(e.message + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '')));
window.addEventListener('unhandledrejection', (e) => remember('Unhandled: ' + (e.reason?.message || e.reason)));

function need() {
  if (!K()) throw new Error('The editor is still starting.');
  if (!E().mapName) throw new Error('No map is open: open_map first (list_maps gives their names).');
  if (E().playing) throw new Error('The game is running in the editor: stop it first.');
  return K();
}
const nameOf = (p) => p.userData.actor?.name || p.userData.box?.name || p.userData.drawn?.name || p.userData.name || '';
function proxyNamed(name) {
  return E().proxies.children.find((p) => nameOf(p) === name) || E().structures?.[name]?.obj || null;
}
function proxyOrFail(name) {
  const p = proxyNamed(name);
  if (!p) throw new Error(`${name}: not in the map (find_objects gives the names).`);
  return p;
}
function messages(n) {          // the Messages panel, newest first
  return [...(document.getElementById('log')?.children || [])].slice(0, n)
    .map((d) => (d.className ? d.className + ': ' : '') + d.textContent);
}
function dialogueOf(story, id) {
  const d = story.dialogues.find((x) => x.id === id) || story.dialogues.find((x) => x.title === id);
  if (!d) throw new Error(`No dialogue "${id}" in this map's story (story_list gives them).`);
  return d;
}
async function story() {
  if (!window.__story) throw new Error('The Story is still starting.');
  need();
  if (!(await window.__story.ensure())) throw new Error('The story of this map could not be read.');
  return window.__story.data();
}
// a picture at most `width` wide (the canvas is as big as the view)
function scaled(url, width) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.width <= width) return resolve(url);
      const c = document.createElement('canvas');
      c.width = width; c.height = Math.round(img.height * width / img.width);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => reject(new Error('The picture of the view could not be made.'));
    img.src = url;
  });
}
function paletteItem(cls) {
  const want = String(cls).toLowerCase(), items = K().palette().flatMap((c) => c.items || []);
  return items.find((it) => String(it.cls).toLowerCase() === want)
    || items.find((it) => String(it.cls).toLowerCase().split('.').pop() === want.split('.').pop()) || null;
}

const OPS = {
  state() {
    const ed = E(), k = K(), sel = ed?.selected;
    if (!ed) return { starting: true };
    return { project: ed.project?.name || null, map: ed.mapName, script: ed.script, dirty: ed.dirty,
      storyDirty: !!window.__story?.dirty, playing: ed.playing, viewMode: ed.viewMode,
      selected: !sel ? [] : sel.userData.members?.length ? sel.userData.members.map(nameOf) : [nameOf(sel)],
      camera: k ? k.UE(ed.camera.position) : null, yaw: k ? k.radToYaw(-ed.cam.yaw) : null, pitch: Math.round(ed.cam.pitch * 1000) / 1000,
      undo: k?.undoDepth ?? 0, redo: k?.redoDepth ?? 0, placing: !!k?.placing,
      status: document.getElementById('status')?.textContent || '', messages: messages(12), errors: errors.slice(-10) };
  },
  maps() {
    if (!K()) throw new Error('The editor is still starting.');
    return K().mapList().map((m) => ({ script: m.script, name: m.name ?? m.map ?? m.title, kind: m.kind, built: m.built }));
  },
  async open_map({ script, save = false, discard = false }) {
    const ed = E(), k = K();
    if (!k) throw new Error('The editor is still starting.');
    const want = String(script).toLowerCase(), found = k.mapList().find((m) => m.script === script)
      || k.mapList().find((m) => [m.script, m.name, m.map].some((x) => String(x ?? '').toLowerCase() === want));
    if (!found) throw new Error(`No map "${script}" in this project (list_maps gives them).`);
    script = found.script;                       // its script, or its map's name
    if (ed.script === script) return OPS.state();
    const changes = ed.dirty || !!window.__story?.dirty;
    if (changes && save && !(await k.save())) throw new Error('Saving the open map failed (editor_state has its messages).');
    if (changes && !save && !discard) throw new Error('The open map has unsaved changes: call again with save true, or discard true to lose them.');
    const opening = k.openMap(script);
    if (changes && !save) { await sleep(60); document.querySelector('[data-leave="discard"]')?.click(); }
    if (!(await opening)) throw new Error(`${script} did not open: it is not one of list_maps, or the editor is busy.`);
    return OPS.state();
  },
  find({ text = '', cls = '', near = null, radius = 512, limit = 50 }) {
    const k = need(), ed = E(), out = [];
    for (const a of k.allActors()) {
      if (ed.edits.deleted?.[a.name]) continue;
      const p = k.proxyOf(a.name);
      out.push({ name: a.name, cls: a.cls, label: k.hierLabel(a), loc: p ? k.UE(p.position) : a.loc });
    }
    for (const b of ed.edits.boxes || [])
      out.push({ name: b.name, cls: 'block', label: k.boxKind(b), loc: b.lo.map((v, i) => r1((v + b.hi[i]) / 2)), size: b.hi.map((v, i) => r1(v - b.lo[i])) });
    for (const d of ed.edits.drawn || []) out.push({ name: d.name, cls: 'drawn', label: d.kind, loc: d.pts?.[0] || null });
    const t = text.toLowerCase(), c = cls.toLowerCase();
    let hits = out.filter((o) => (!t || `${o.name} ${o.cls} ${o.label}`.toLowerCase().includes(t)) && (!c || String(o.cls).toLowerCase() === c));
    if (near) {
      const dist = (o) => (o.loc ? Math.hypot(o.loc[0] - near[0], o.loc[1] - near[1], o.loc[2] - near[2]) : Infinity);
      hits = hits.filter((o) => dist(o) <= radius).sort((a, b) => dist(a) - dist(b));
    }
    return { count: hits.length, objects: hits.slice(0, Math.max(1, Math.min(500, limit))) };
  },
  object({ name }) {
    const k = need(), ed = E();
    const a = k.allActors().find((x) => x.name === name);
    if (a) {
      const moved = ed.edits.moved?.[name], p = k.proxyOf(name);
      return { name, cls: a.cls, label: k.hierLabel(a), loc: p ? k.UE(p.position) : (moved || a).loc, rot: (moved || a).rot || [0, 0, 0],
        scale: (moved || a).scale || 1, props: Object.assign({}, a.props, ed.edits.props?.[name]), changed: ed.edits.props?.[name] || {},
        added: ed.edits.added.some((x) => x.name === name), moved: !!moved, deleted: !!ed.edits.deleted?.[name],
        character: k.isCharacter(a), classes: k.chainOf(a.cls), structure: k.structureOf(name) };
    }
    const b = (ed.edits.boxes || []).find((x) => x.name === name);
    if (b) return Object.assign({ kind: k.boxKind(b) }, JSON.parse(JSON.stringify(b)));
    const d = (ed.edits.drawn || []).find((x) => x.name === name);
    if (d) return JSON.parse(JSON.stringify(d));
    throw new Error(`${name}: not in the map (find_objects gives the names).`);
  },
  select({ names, focus = false }) {
    const k = need(), ps = names.map(proxyOrFail);
    if (ps.length === 1) k.select(ps[0]); else k.setMulti(ps);
    if (focus) k.focusSelected();
    return { selected: OPS.state().selected };
  },
  place({ cls, at, toward = [0, 0, -1], exact = false, yaw, props, size, tex }) {
    const k = need(), ed = E(), block = cls === 'block';
    const item = block ? { box: true, size: size || [128, 128, 128], tex: tex || 'ClenGreyCncrt_A' }
      : paletteItem(cls) || { cls, name: cls, radius: 16, height: 16 };
    k.startPlacing(item);
    const r = exact ? { p: k.T(at), n: new THREE.Vector3(0, 1, 0), hit: k.T(at), tex: null }
      : k.placeOnRay(new THREE.Raycaster(k.T(at), k.T(toward).normalize()));
    if (!r) { k.cancelPlacing(); throw new Error(`Nothing to place it on from [${at}] along [${toward}]: give exact true, or another point.`); }
    k.placeWith(r, { quiet: true });
    k.cancelPlacing();
    const p = ed.selected, name = p ? nameOf(p) : '';
    if (!name) throw new Error('It could not be placed there.');
    const e = ed.edits.added.find((x) => x.name === name);
    if (e && (yaw !== undefined || props)) {      // part of the placement's own undo step
      if (yaw !== undefined) e.rot = [e.rot?.[0] || 0, ((Math.round(yaw) % k.YAW) + k.YAW) % k.YAW, e.rot?.[2] || 0];
      if (props) for (const [key, v] of Object.entries(props)) (e.props = e.props || {})[key] = String(v);
      k.rebuildProxies(); k.select(k.proxyOf(name)); k.setDirty();
    }
    return OPS.object({ name });
  },
  move({ name, loc, yaw, scale, size }) {
    const k = need(), p = proxyOrFail(name);
    if (p.userData.kind === 'structure') throw new Error(`${name} is a structure: move it with the gizmo, or run_js.`);
    k.pushUndo();
    if (loc) p.position.copy(k.T(loc));
    if (yaw !== undefined) p.rotation.y = k.yawToRad(yaw);
    if (size && p.userData.box) p.scale.set(size[0], size[2], size[1]);
    if (scale !== undefined && !p.userData.box) p.scale.setScalar(scale / k.builtScale(name));
    k.commit(p);
    return OPS.object({ name });
  },
  set({ name, props }) {
    const k = need(), a = k.allActors().find((x) => x.name === name);
    if (!a) throw new Error(`${name}: no object with properties of that name (blocks: move_object for their size, run_js for the rest).`);
    for (const [key, v] of Object.entries(props)) { if (v === null) k.unsetProp(a, key); else k.setProp(a, key, String(v)); }
    k.rebuildProxies();
    const p = k.proxyOf(name);
    if (p) k.select(p); else k.showDetails();
    return OPS.object({ name });
  },
  delete({ names }) {
    const k = need(), deleted = [], kept = [];
    for (const n of names) {
      const p = proxyNamed(n);
      if (!p) { kept.push(n); continue; }
      k.select(p); k.deleteSelected();
      (proxyNamed(n) && !E().edits.deleted?.[n] ? kept : deleted).push(n);
    }
    return { deleted, notDeleted: kept };
  },
  undo({ steps = 1 }) { const k = need(); let n = 0; while (n < steps && k.undoStep()) n++; return { undone: n, left: k.undoDepth }; },
  redo({ steps = 1 }) { const k = need(); let n = 0; while (n < steps && k.redoStep()) n++; return { redone: n, left: k.redoDepth }; },
  async save() {
    const k = need(), saved = await k.save();
    return { saved, dirty: E().dirty, storyDirty: !!window.__story?.dirty, messages: messages(4) };
  },
  async rebuild({ mode = 'auto' }) {
    need();
    const before = document.getElementById('log')?.children.length || 0;
    await E().rebuild(mode);
    const after = document.getElementById('log')?.children.length || 0;
    return { messages: messages(Math.max(0, after - before)), dirty: E().dirty };
  },
  async view({ from, look_at: lookAt, focus, width = 960, keep = false }) {
    const k = need(), shot = k.viewShot({ from, lookAt, focus: focus ? proxyOrFail(focus) : null, keep });
    const image = await scaled(shot.url, Math.max(160, Math.min(1600, width | 0 || 960)));
    return { image, camera: shot.camera, yaw: shot.yaw, pitch: shot.pitch };
  },
  async story_list() {
    const s = await story();
    return { dialogues: s.dialogues.map((d) => ({ id: d.id, title: d.title, owner: d.owner, start: d.start, once: d.once, steps: (d.steps || []).length })),
      events: (s.events || []).length, infolinks: (s.infolinks || []).length, unsaved: !!window.__story.dirty };
  },
  async story_get({ dialogue }) {
    const d = dialogueOf(await story(), dialogue);
    d.steps = d.steps || [];
    ensureIds(d.steps);                  // as the Graph view does: ids are not a change
    const g = graphOf(d.steps);
    return { dialogue: JSON.parse(JSON.stringify(d)),
      graph: { start: g.start, nodes: g.nodes.map((n) => ({ id: n.id, type: n.step.type, outs: n.outs.map((o) => Object.assign({ port: o.port, to: o.to }, o.text ? { text: o.text } : {}, o.broken ? { broken: true } : {})) })),
        unreachable: g.nodes.filter((n) => !g.reachable.has(n.id)).map((n) => n.id) } };
  },
  async story_write({ dialogue, owner, fields, steps }) {
    await story();
    if (!dialogue) {
      if (!owner) throw new Error('Give the dialogue to change, or the owner (a character\'s name) of a new one.');
      dialogue = (await window.__story.newDialogue(owner)).id;
    }
    if (steps && (!Array.isArray(steps) || steps.some((s) => !s || typeof s.type !== 'string')))
      throw new Error('steps: the whole list of steps, each with its type (as story_get gives them).');
    await window.__story.edit((s) => {
      const d = dialogueOf(s, dialogue);
      for (const [key, v] of Object.entries(fields || {})) {
        if (key === 'id' || key === 'steps') continue;
        if (v === null) delete d[key]; else d[key] = v;
      }
      if (steps) d.steps = JSON.parse(JSON.stringify(steps));
    });
    return OPS.story_get({ dialogue });
  },
  async story_play({ dialogue, state = {}, choices = [] }) {
    const d = dialogueOf(await story(), dialogue);
    d.steps = d.steps || [];
    ensureIds(d.steps);                  // the ids story_get shows, on what is said
    const play = createPlay(d.steps, state), said = [], queue = [...choices];
    const now = () => ({ flags: play.state.flags, credits: play.state.credits, health: play.state.health,
      skillpoints: play.state.skillpoints, items: [...play.state.items] });
    for (let i = 0; i < 500; i++) {
      const e = play.next();
      if (e.type === 'line') said.push({ who: e.who, text: e.text, id: e.id });
      else if (e.type === 'effect') said.push({ effect: e.text, id: e.id });
      else if (e.type === 'choice') {
        if (!queue.length) return { said, waiting: { id: e.id, options: e.options }, state: now() };
        const k = queue.shift(), o = e.options.find((x) => x.k === k);
        if (!o || !o.shown) throw new Error(`Answer ${k} is not shown at ${e.id}: ${JSON.stringify(e.options)}`);
        said.push({ jc: o.text, answer: k, id: e.id });
        play.choose(k);
      } else return { said, end: e.why, at: e.id, state: now() };
    }
    return { said, end: 'Stopped after 500 steps', state: now() };
  },
  async run_js({ code }) { return await new AsyncFunction(code)(); },
};

// one call: the editor's own confirm() questions are answered (args.confirm, else no) and told in the answer
async function run({ op, args }) {
  const fn = OPS[op];
  if (!fn) return { ok: false, error: `This page cannot do "${op}": reload it (it may be older than the server).` };
  const asked = [], saved = [window.confirm, window.alert, window.prompt];
  window.confirm = (q) => { asked.push(String(q)); return args.confirm === true; };
  window.alert = (q) => { asked.push(String(q)); };
  window.prompt = (q) => { asked.push(String(q)); return null; };
  try {
    let value = await fn(args || {});
    value = JSON.parse(JSON.stringify(value ?? null));
    if (asked.length) value = value && typeof value === 'object' && !Array.isArray(value) ? Object.assign(value, { asked }) : { value, asked };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: (e?.message || String(e)) + (asked.length ? ` (the editor asked: ${asked.join(' | ')})` : '') };
  } finally {
    [window.confirm, window.alert, window.prompt] = saved;
  }
}

async function loop() {
  for (;;) {
    let job;
    try {
      const r = await fetch('/api/agent/next');
      if (r.status === 409) return;             // not a project's page, or its project was closed
      job = r.ok ? await r.json() : null;
    } catch (_) { job = null; }
    if (!job || job.off) { await sleep(job?.off ? 4000 : 10000); continue; }
    if (!job.id) continue;
    const answer = await run(job);
    let body;
    try { body = JSON.stringify(Object.assign({ id: job.id }, answer)); }
    catch (e) { body = JSON.stringify({ id: job.id, ok: false, error: 'The answer could not be sent: ' + e.message }); }
    await fetch('/api/agent/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
  }
}
if (window.__projectContext?.id) loop();

// ---------------------------------------------------------------- Tools > AI assistant...
let dialog = null;
async function call(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The request failed.');
  return j;
}
const quote = (part) => (/[\s"]/.test(part) ? `"${part}"` : part);
async function render() {
  const $ = (s) => dialog.querySelector(s);
  let info;
  try { info = await call('/api/agent/status'); } catch (e) { $('main').innerHTML = `<p class="as-bad">${esc(e.message)}</p>`; return; }
  const command = 'claude mcp add deusedix -- ' + info.command.map(quote).join(' ');
  const seen = info.lastCall === null ? 'No assistant has called yet.' : info.lastCall < 90 ? `Connected: last call ${info.lastCall} s ago.` : `Last call ${Math.round(info.lastCall / 60)} min ago.`;
  $('main').innerHTML = `<label class="as-switch"><input type="checkbox" id="as-allow" ${info.allowed ? 'checked' : ''}> Let an AI assistant use this editor</label>
    <p class="as-note">An assistant connected through MCP (Claude Code, or any other MCP client) can then look at the open map and change it
      as you would: its changes are unsaved and undoable (Ctrl+Z) until it, or you, saves. It works on the project open here.</p>
    ${info.allowed ? `<p class="as-state">${esc(seen)}</p>` : ''}
    <label for="as-cmd">To connect Claude Code, run this once in a terminal:</label>
    <div class="as-row"><input type="text" id="as-cmd" readonly value="${esc(command)}"><button type="button" id="as-copy">Copy</button></div>
    <p class="as-note">Other assistants: start <code>${esc(info.command.map(quote).join(' '))}</code> as an MCP server (stdio).</p>`;
  $('#as-allow').onchange = async (e) => {
    try { await call('/api/projects/assistant', { allow: e.target.checked }); } catch (err) { e.target.checked = !e.target.checked; alert(err.message); }
    render();
  };
  $('#as-copy').onclick = () => { navigator.clipboard?.writeText(command); $('#as-copy').textContent = 'Copied'; };
}
function open() {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'map-dialog assistant-dialog'; dialog.setAttribute('aria-labelledby', 'as-title');
    document.body.appendChild(dialog);
    const css = document.createElement('style');
    css.textContent = `.assistant-dialog main { max-width:560px; }
      .assistant-dialog .as-switch { display:flex; gap:8px; align-items:center; font-weight:600; margin:4px 0 8px; }
      .assistant-dialog .as-note { color:var(--dim); font-size:11px; margin:6px 0 10px; }
      .assistant-dialog .as-state { color:var(--ok); margin:0 0 10px; }
      .assistant-dialog .as-bad { color:var(--bad); }
      .assistant-dialog .as-row { display:flex; gap:6px; margin-top:4px; } .assistant-dialog .as-row input { flex:1; min-width:0; font-family:monospace; font-size:11px; }`;
    document.head.appendChild(css);
  }
  dialog.innerHTML = `<form method="dialog"><header><h2 id="as-title">AI assistant</h2><button type="button" data-close>Close</button></header>
    <main><p class="as-note">Reading…</p></main><footer><button type="button" data-close class="primary">Done</button></footer></form>`;
  for (const b of dialog.querySelectorAll('[data-close]')) b.onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
  render();
}
window.__assistant = { open, ops: Object.keys(OPS) };
