// A library mover is a brush-backed prefab, not a static piece. Its closed pose uses
// the normal structure gizmo; native movement and sounds remain in the prefab.
export function moverFields(clip) {
  if (!['door', 'elevator'].includes(clip?.mover?.kind)) return {};
  return JSON.parse(JSON.stringify({ mover: clip.mover, moverSettings: clip.moverSettings || {} }));
}

export function moverPanel(entry, { escapeHtml, section, built = false }) {
  if (!entry?.mover) return '';
  const lift = entry.mover.kind === 'elevator', value = { ...entry.mover, ...entry.moverSettings };
  if (built) return section('library-mover', lift ? 'Elevator' : 'Door', true) + '<button id="mover-details" title="Select the built mover for its sounds, tags, interactions and animation">Edit mover…</button></div></details>';
  const options = lift ? [['stand', 'Step on / return'], ['trigger', 'Trigger / toggle']]
    : [['use', 'Use / toggle'], ['use-timed', 'Use / auto close'], ['trigger', 'Trigger / toggle']];
  const esc = v => escapeHtml(String(v));
  const label = 'style="flex:0 0 96px;width:auto;min-width:96px"';
  return section('library-mover', lift ? 'Elevator' : 'Door', true) + `<div data-mover-settings>
    <div class="row"><label ${label} for="mover-mode">Activation</label><select id="mover-mode" data-mover-setting="mode" style="flex:1;min-width:0;padding:0 8px">${options.map(([id, text]) => `<option value="${id}" ${value.mode === id ? 'selected' : ''}>${text}</option>`).join('')}</select></div>
    <div class="row"><label ${label} for="mover-time">Move time (s)</label><input id="mover-time" data-mover-setting="moveTime" type="number" min="0.05" max="3600" step="any" value="${esc(value.moveTime)}" style="flex:1;min-width:0"></div>
    <div class="row"><label ${label} for="mover-wait">Wait (s)</label><input id="mover-wait" data-mover-setting="stayOpenTime" type="number" min="0" max="3600" step="any" value="${esc(value.stayOpenTime)}" style="flex:1;min-width:0" title="Used by auto-close doors and returning elevators"></div>
    ${!lift ? `<div class="row"><label style="width:auto"><input data-mover-setting="locked" type="checkbox" ${value.locked ? 'checked' : ''}> Locked</label></div>` : ''}
    <div class="hint">Original movement and sounds retained. Rebuild to play.</div>
    <div class="hint">Rebuild once to edit sounds, tags and animation.</div>
    </div></div></details>`;
}

export function wireMoverPanel(root, { getEntry, change }) {
  for (const input of root.querySelectorAll('[data-mover-setting]')) input.onchange = () => {
    const key = input.dataset.moverSetting;
    const value = key === 'locked' ? input.checked : key === 'mode' ? input.value : Number(input.value);
    if (input.type === 'number' && (!input.value.trim() || !Number.isFinite(value) || !input.checkValidity())) {
      input.reportValidity(); return;
    }
    if (!getEntry()) return;
    change(entry => { entry.moverSettings = { ...entry.moverSettings, [key]: value }; });
  };
}
