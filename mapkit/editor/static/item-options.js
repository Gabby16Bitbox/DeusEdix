// One inventory picker for rules, dialogue, conditions, characters and test loadouts.
// Technical classes remain readable in saved maps; they are not offered as new player rewards.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const key = (s) => String(s ?? '').trim().toLowerCase();
export const isNanoKey = (value) => ['deusex.nanokey', 'nanokey'].includes(key(value));
export const isKeyReward = (s) => isNanoKey(s.item) && ('keyId' in s || !s.from);
export function keyIdError(value) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_]{1,63}$/.test(id) && id.toLowerCase() !== 'none' ? ''
    : 'Set Key ID to match the door, e.g. 2 or ApartmentDoor (1–63 letters, digits or underscores).';
}
export const KEY_HELP = 'Use the same Key ID on the key and in the door’s Inspector > Door. For example, 2 opens doors with ID 2. Enable Locked on the door to require a key.';
export function keyFieldsHtml(value, attrs, wrap = (html) => `<div class="f">${html}</div>`) {
  return wrap(`<label style="width:auto">Key ID</label><input type="text" ${attrs('keyId')} value="${esc(value.keyId ?? '')}" placeholder="e.g. 2 or ApartmentDoor" maxlength="63" style="flex:1;min-width:0" title="${esc(KEY_HELP)}">`)
    + wrap(`<label style="width:auto">Description</label><input type="text" ${attrs('keyDescription')} value="${esc(value.keyDescription ?? '')}" placeholder="Key ${esc(value.keyId || '')}" maxlength="160" style="flex:1;min-width:0" title="Optional name shown in the player’s keyring">`)
    + wrap(`<span class="hint" style="margin:0;flex:1;min-width:0;overflow-wrap:anywhere">${esc(KEY_HELP)}</span>`);
}

export function itemWarningText(items, value) {
  return (items || []).find((i) => key(i.cls) === key(value))?.warning || '';
}

export function itemOptionsHtml(items, value, { empty = '(choose an item)', fallback = true, configureKey = false } = {}) {
  const selected = key(value), groups = new Map(), seen = new Set();
  for (const item of items || []) {
    const id = key(item.cls);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const restricted = item.internal || (item.needsSetup && !(configureKey && isNanoKey(item.cls)));
    if (restricted && id !== selected) continue;
    const group = restricted ? 'Saved special item' : item.group || item.cat || 'Items';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  const order = [...new Set(['Weapons', 'Grenades', 'Ammo', 'Pickups', ...groups.keys()])]
    .filter((g) => groups.has(g) && g !== 'Saved special item');
  if (groups.has('Saved special item')) order.push('Saved special item');
  return (empty === null ? '' : `<option value="" ${!selected ? 'selected' : ''}>${esc(empty)}</option>`)
    + order.map((g) => `<optgroup label="${esc(g)}">${groups.get(g).map((i) => {
      const isSelected = key(i.cls) === selected;
      // Keep the exact serialized spelling of an existing reference, even if the catalog changes its case.
      return `<option value="${esc(isSelected ? value : i.cls)}" ${isSelected ? 'selected' : ''} title="${esc([i.cls, i.warning || i.hint].filter(Boolean).join(' — '))}">${esc(i.name || i.cls)}</option>`;
    }).join('')}</optgroup>`).join('')
    + (fallback && value && !seen.has(selected) ? `<option selected value="${esc(value)}">${esc(value)} (unavailable in this catalog)</option>` : '');
}
