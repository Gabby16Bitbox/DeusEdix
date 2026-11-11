// Mission phases shared by the project (P3 slice 7, editor/LOGIC.md "Mission phases"): phase sets declared once
// (Map > Mission phases..., kept in tools/mapkit/logic/phases.json by editor/missionphases.py) and Phases blocks of
// several maps linked to one of them (edits.logic.mission = {<block name>: <set id>}). A linked block's Phases and
// StateName are the set's: the server writes them into what the builds read (missionphases.apply); syncMission does
// the same in the page, so the Inspector, Try it and the Logic window see the set as the game will.

// a Phases block's settings as a set says them (edits' property texts)
export function setProps(s) {
  return { Phases: `"${(s.phases || []).join(', ')}"`, StateName: `"${s.name}"` };
}

// {block name: set id} of a map's edits
export function missionLinks(edits) {
  const m = edits && edits.logic && edits.logic.mission;
  if (!m || typeof m !== 'object') return {};
  return Object.fromEntries(Object.entries(m).filter(([k, v]) => k && v).map(([k, v]) => [String(k), String(v)]));
}

// the set a block is linked to (null: none, or one the project no longer has); names as the engine: any case
export function linkedSet(edits, name, sets) {
  const low = String(name || '').toLowerCase();
  const id = Object.entries(missionLinks(edits)).find(([k]) => k.toLowerCase() === low)?.[1];
  return id ? (sets || []).find((s) => s.id === id) || null : null;
}

// the id a block is linked to, kept even when the set is gone ('' none)
export function linkedId(edits, name) {
  const low = String(name || '').toLowerCase();
  return Object.entries(missionLinks(edits)).find(([k]) => k.toLowerCase() === low)?.[1] || '';
}

// Link a block to a set (id '' unlinks it); the block takes the set's settings. The edits are changed in place.
export function linkBlock(edits, name, id, sets) {
  const logic = edits.logic && typeof edits.logic === 'object' ? edits.logic : (edits.logic = {});
  const mission = logic.mission && typeof logic.mission === 'object' ? logic.mission : (logic.mission = {});
  for (const k of Object.keys(mission)) if (k.toLowerCase() === String(name).toLowerCase()) delete mission[k];
  if (id) mission[name] = id;
  if (!Object.keys(mission).length) delete logic.mission;
  if (!Object.keys(logic).length) delete edits.logic;
  if (id) syncMission(edits, sets);
}

// Each linked block takes its set's settings (edits.props); the names of the blocks that changed. A block linked to a
// set the project no longer has keeps what the map says.
export function syncMission(edits, sets) {
  const changed = [];
  for (const [name, id] of Object.entries(missionLinks(edits))) {
    const s = (sets || []).find((x) => x.id === id);
    if (!s) continue;
    edits.props = edits.props || {};
    const key = Object.keys(edits.props).find((k) => k.toLowerCase() === name.toLowerCase()) || name;
    const e = edits.props[key] || (edits.props[key] = {});
    let moved = false;
    for (const [k, v] of Object.entries(setProps(s))) if (e[k] !== v) { e[k] = v; moved = true; }
    const raw = edits.rawprops && Object.entries(edits.rawprops).find(([k]) => k.toLowerCase() === name.toLowerCase());
    if (raw && raw[1]) for (const k of Object.keys(raw[1])) if (/^(phases|statename)$/i.test(k)) { delete raw[1][k]; moved = true; }   // nor All properties
    if (moved) changed.push(key);
  }
  return changed;
}

// as editor/missionphases.py _clean: no quote, backslash, comma or bar
export function cleanText(text) {
  return String(text ?? '').replace(/[",\\|]/g, '').trim().slice(0, 60);
}

// ------------------------------------------------------------------------------------------- the window
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let dialog = null;

// Map > Mission phases...: add, rename and remove the project's sets and their phases.
//   sets   the sets as kept now; used(id): the maps' blocks linked to it here ("Phases block in this map")
//   save(sets) -> the sets as kept (with their ids); it throws with the reason when they cannot be kept
export function openMissionPhases({ sets, used = () => '', save }) {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'map-dialog mission-phases'; dialog.setAttribute('aria-labelledby', 'mission-phases-title');
    document.body.appendChild(dialog);
    const style = document.createElement('style');
    style.textContent = `.mission-phases{width:min(620px,94vw)} .mission-phases main{display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow:auto}
      .mission-phases .mp-set{display:grid;grid-template-columns:minmax(110px,1fr) 2fr auto;gap:6px;align-items:center}
      .mission-phases .mp-note{opacity:.75;font-size:12px;margin:0} .mission-phases .mp-bad{color:var(--bad,#e66)}
      .mission-phases .mp-used{grid-column:1 / -1;opacity:.7;font-size:11px;margin:-2px 0 4px}`;
    document.head.appendChild(style);
  }
  let rows = (sets || []).map((s) => ({ id: s.id, name: s.name, phases: (s.phases || []).join(', ') }));
  const $ = (s) => dialog.querySelector(s);
  const draw = () => {
    dialog.innerHTML = `<form method="dialog"><header><h2 id="mission-phases-title">Mission phases</h2><button type="button" data-close>Close</button></header>
      <main><p class="mp-note">The phases of a mission that goes on over several maps. Link a Phases block of each map to the same set
      (its Inspector, Mission phases): every map then reads and moves the same phase, and the phase the player left a map in is the one
      the next map starts in.</p>
      ${rows.map((r, k) => `<div class="mp-set" data-k="${k}"><input type="text" data-name maxlength="60" aria-label="Name of the phase set" placeholder="Name (e.g. Raid)" value="${esc(r.name)}">
        <input type="text" data-phases aria-label="Its phases, in order" placeholder="Its phases in order (e.g. Calm, Alarm, Escape)" value="${esc(r.phases)}">
        <button type="button" data-del title="Remove this phase set. The blocks linked to it keep the phases they have.">Remove</button>
        ${r.id && used(r.id) ? `<p class="mp-used">${esc(used(r.id))}</p>` : ''}</div>`).join('') || '<p class="mp-note">This project has no mission phases yet.</p>'}
      <div><button type="button" data-add>Add a phase set</button></div></main>
      <footer><span class="mp-bad" role="status" style="margin-right:auto"></span><button type="button" data-close>Close</button><button type="submit" class="primary">Save</button></footer></form>`;
    for (const b of dialog.querySelectorAll('[data-close]')) b.onclick = () => dialog.close();
    for (const el of dialog.querySelectorAll('.mp-set')) {
      const r = rows[+el.dataset.k];
      el.querySelector('[data-name]').oninput = (e) => { r.name = e.target.value; };
      el.querySelector('[data-phases]').oninput = (e) => { r.phases = e.target.value; };
      el.querySelector('[data-del]').onclick = () => { rows.splice(+el.dataset.k, 1); draw(); };
    }
    $('[data-add]').onclick = () => { rows.push({ id: '', name: '', phases: '' }); draw(); dialog.querySelector('.mp-set:last-of-type [data-name]')?.focus(); };
    $('form').onsubmit = async (e) => {
      e.preventDefault();
      const out = rows.map((r) => ({ id: r.id, name: cleanText(r.name), phases: r.phases.split(',').map(cleanText).filter(Boolean) }));
      try {
        const kept = await save(out);
        rows = kept.map((s) => ({ id: s.id, name: s.name, phases: s.phases.join(', ') }));
        dialog.close();
      } catch (err) { $('.mp-bad').textContent = err.message; }
    };
  };
  draw();
  if (!dialog.open) dialog.showModal();
}
