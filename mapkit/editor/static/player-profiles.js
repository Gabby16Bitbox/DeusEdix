// The map owns an optional identity override; spawn points own position only.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function playerOptions(catalog, current, inherit = false) {
  const options = [...catalog.characters];
  if (current && !options.some(ch => ch.id === current)) options.push({id:current, name:`Missing: ${current}`, supported:false});
  return (inherit ? `<option value="" ${current === '' ? 'selected' : ''}>Use project default</option>` : '') + options.map(ch =>
    `<option value="${esc(ch.id)}" ${current === ch.id ? 'selected' : ''} ${ch.supported ? '' : 'disabled'}>${esc(ch.name)}${ch.supported ? '' : ' (unavailable)'}</option>`).join('');
}

export function mapPlayerFields(catalog, override) {
  const current = override ?? '';
  return `<section class="player-settings" aria-label="Player character">
    <b>Player character</b>
    <div class="row"><label for="msplayer">This map</label><select id="msplayer">${playerOptions(catalog, current, true)}</select></div>
    <div class="hint">Appearance only: inventory, skills and augmentations stay shared. Rebuild to apply.</div>
    <details><summary>Project default</summary>
      <div class="row"><label for="msplayerdefault">Character</label><select id="msplayerdefault" ${catalog.temporary ? 'disabled' : ''}>${playerOptions(catalog, catalog.config.default)}</select><button type="button" id="msplayersave" ${catalog.temporary ? 'disabled title="Tutorial settings are temporary"' : ''}>Set default</button></div>
      <div class="hint">Used by rebuilt maps without an override. Separate protagonist progress is not enabled yet.</div>
    </details><div class="hint" id="msplayerstatus" role="status"></div>
  </section>`;
}

export function applyMapPlayer(level, value) {
  const next = {...level};
  if (value) next.player = value; else delete next.player;
  return next;
}

export function wireProjectPlayer(root, initial, api) {
  let catalog = initial;
  const button = root.querySelector('#msplayersave'), status = root.querySelector('#msplayerstatus');
  button.onclick = async () => {
    const selected = root.querySelector('#msplayerdefault').value;
    button.disabled = true;
    status.className = 'hint'; status.textContent = 'Saving project default…';
    try {
      catalog = await api('/api/player_profiles', {config:{...catalog.config, default:selected}, revision:catalog.revision});
      status.textContent = 'Project default saved. Rebuild each affected map to apply it.';
    } catch (error) {
      status.className = 'hint bad'; status.textContent = error.message;
    } finally { button.disabled = false; }
  };
}
