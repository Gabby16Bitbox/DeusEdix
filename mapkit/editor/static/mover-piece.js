// A library mover is a brush-backed prefab, not a static piece. Its closed pose uses
// the normal structure gizmo; native movement and sounds remain in the prefab.
export function moverFields(clip) {
  if (!['door', 'elevator'].includes(clip?.mover?.kind)) return {};
  return JSON.parse(JSON.stringify({ mover: clip.mover, moverSettings: clip.moverSettings || {} }));
}

// Which way a hinged door opens (17 Nov 2026, Gabby: a door opened toward JC from one side and hit him; moving_pieces
// OPENS): as in the map it came from, the other way, or away from whoever opens it (each time, from where they stand).
// "Into a room" is the assistant's (place_door): the way that takes it into the room a point is in.
const OPENS = [['built', 'One way, as in its map'], ['other', 'One way, the other side'], ['away', 'Away from who opens it']];
function opensRow(value, esc, label) {
  if (value.kind === 'elevator' || value.turn === 0) return '';          // a lift, a door that slides
  const now = value.opens || 'built';
  const options = now === 'into' ? [...OPENS, ['into', 'Into the room chosen by the assistant']] : OPENS;
  return `<div class="row"><label ${label} for="mover-opens">Opens</label><select id="mover-opens" data-mover-setting="opens" style="flex:1;min-width:0;padding:0 8px" title="Away from who opens it: the door swings away from the player or character opening it, from either side. One way: it always swings the same way (the original game's doors); a door opened from the side it swings to pushes the player aside.">${options.map(([id, text]) => `<option value="${id}" ${now === id ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></div>`
    + '<div class="warn" id="mover-room" hidden style="overflow-wrap:anywhere"></div>';     // no room to open (app.js, door-room.js)
}

// What a door does when it meets someone on its way (17 Nov 2026, the game's MoverEncroachType; moving_pieces MEETS):
// Ignore goes on through them, as 1549 of Revision's 1654 hinged doors; Stop waits; Return goes back; Crush hurts.
const MEETS = [['ignore', 'Goes through them'], ['stop', 'Stops until they move'], ['return', 'Goes back'], ['crush', 'Hurts them']];
function meetsRow(value, esc, label) {
  if (value.kind === 'elevator') return '';
  const now = value.meets || 'ignore';
  return `<div class="row"><label ${label} for="mover-meets">Meets someone</label><select id="mover-meets" data-mover-setting="meets" style="flex:1;min-width:0;padding:0 8px" title="What the door does when someone is in its way while it moves. Goes through them: as almost all the original game's doors (it never shuts in the player's face). Stops: waits until they move. Goes back: returns where it came from. Hurts them: goes on and damages them (big doors, presses).">${MEETS.map(([id, text]) => `<option value="${id}" ${now === id ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></div>`;
}

export function moverPanel(entry, { escapeHtml, section, built = false }) {
  if (!entry?.mover) return '';
  const lift = entry.mover.kind === 'elevator', value = { ...entry.mover, ...entry.moverSettings };
  const label0 = 'style="flex:0 0 96px;width:auto;min-width:96px"';
  if (built) return section('library-mover', lift ? 'Elevator' : 'Door', true) + `<div data-mover-settings>${opensRow(value, v => escapeHtml(String(v)), label0)}${meetsRow(value, v => escapeHtml(String(v)), label0)}</div>`
    + '<button id="mover-details" title="Select the built mover for its properties, sounds, tags, interactions and animation">Edit mover…</button>'
    + (lift ? '' : '<div class="hint">Key ID and Locked are in the mover’s Door section.</div>') + '</div></details>';
  const options = lift ? [['stand', 'Step on / return'], ['trigger', 'Trigger / toggle']]
    : [['use', 'Use / toggle'], ['use-timed', 'Use / auto close'], ['trigger', 'Trigger / toggle']];
  const esc = v => escapeHtml(String(v));
  const label = 'style="flex:0 0 96px;width:auto;min-width:96px"';
  return section('library-mover', lift ? 'Elevator' : 'Door', true) + `<div data-mover-settings>
    <div class="row"><label ${label} for="mover-mode">Activation</label><select id="mover-mode" data-mover-setting="mode" style="flex:1;min-width:0;padding:0 8px">${options.map(([id, text]) => `<option value="${id}" ${value.mode === id ? 'selected' : ''}>${text}</option>`).join('')}</select></div>
    ${opensRow(value, esc, label)}
    ${meetsRow(value, esc, label)}
    <div class="row"><label ${label} for="mover-time">Move time (s)</label><input id="mover-time" data-mover-setting="moveTime" type="number" min="0.05" max="3600" step="any" value="${esc(value.moveTime)}" style="flex:1;min-width:0"></div>
    <div class="row"><label ${label} for="mover-wait">Wait (s)</label><input id="mover-wait" data-mover-setting="stayOpenTime" type="number" min="0" max="3600" step="any" value="${esc(value.stayOpenTime)}" style="flex:1;min-width:0" title="Used by auto-close doors and returning elevators"></div>
    ${!lift ? `<div class="row"><label style="width:auto"><input data-mover-setting="locked" type="checkbox" ${value.locked ? 'checked' : ''}> Locked</label></div>
    <div class="row"><label ${label} for="mover-key">Key ID</label><input id="mover-key" data-mover-setting="keyId" type="text" value="${esc(value.keyId ?? '')}" placeholder="None" maxlength="63" pattern="[A-Za-z0-9_]+" style="flex:1;min-width:0" title="Use the same Key ID as the NanoKey, e.g. 2 or ApartmentDoor. Letters, digits and underscores; empty or None means no key."></div>
    <div class="hint" style="overflow-wrap:anywhere">Use the same Key ID on the NanoKey, e.g. 2. Enable Locked to require it. Empty or None means no key can unlock this door.</div>
    <div class="row"><label style="width:auto" title="The player can open the lock with lockpicks"><input data-mover-setting="pickable" type="checkbox" ${value.pickable ? 'checked' : ''}> Lockpickable</label></div>
    <div class="row"><label ${label} for="mover-lock">Lock strength</label><input id="mover-lock" data-mover-setting="lockStrength" type="number" min="0" max="1" step="0.05" value="${esc(value.lockStrength ?? 0.2)}" style="flex:1;min-width:0" title="0 = easy to pick, 1 = very hard (the game: 0.2). Only with Lockpickable and Locked." ${value.pickable ? '' : 'disabled'}></div>
    <div class="row"><label style="width:auto" title="Explosives, weapons and blows can break it"><input data-mover-setting="breakable" type="checkbox" ${value.breakable ? 'checked' : ''}> Breakable</label></div>
    <div class="row"><label ${label} for="mover-door">Door strength</label><input id="mover-door" data-mover-setting="doorStrength" type="number" min="0" max="1" step="0.05" value="${esc(value.doorStrength ?? 0.25)}" style="flex:1;min-width:0" title="0 = weak, 1 = strong (the game: 0.25). Each hit takes 1% per point of damage." ${value.breakable ? '' : 'disabled'}></div>
    <div class="row"><label ${label} for="mover-min">Min. damage</label><input id="mover-min" data-mover-setting="minDamage" type="number" min="0" max="1000" step="1" value="${esc(value.minDamage ?? 10)}" style="flex:1;min-width:0" title="A hit below this damage does not count (the game: 10)" ${value.breakable ? '' : 'disabled'}></div>
    <div class="hint" style="overflow-wrap:anywhere">Lock strength: 0 easy to pick, 1 very hard. Door strength: 0 weak, 1 strong.</div>` : ''}
    <div class="hint">Original movement and sounds retained. Rebuild to play.</div>
    <div class="hint">Rebuild once to edit sounds, tags and animation.</div>
    </div></div></details>`;
}

export function wireMoverPanel(root, { getEntry, change }) {
  for (const input of root.querySelectorAll('[data-mover-setting]')) input.onchange = () => {
    const key = input.dataset.moverSetting;
    const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value.trim();
    if ((input.type === 'number' && (!input.value.trim() || !Number.isFinite(value))) || !input.checkValidity()) {
      input.reportValidity(); return;
    }
    if (!getEntry()) return;
    change(entry => { entry.moverSettings = { ...entry.moverSettings, [key]: value }; });
    // the strengths only count with lock picking or breaking on (the panel is not drawn again)
    const ties = { pickable: ['#mover-lock'], breakable: ['#mover-door', '#mover-min'] };
    for (const sel of ties[key] || []) { const f = root.querySelector(sel); if (f) f.disabled = !value; }
  };
}
