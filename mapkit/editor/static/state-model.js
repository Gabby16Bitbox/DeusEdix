// One representation for story flags and the character memories written by UCFateWatch.
export const FATE_PREDICATES = Object.freeze([
  { id: 'Dead:true', kind: 'Dead', is: true, label: 'Was killed' },
  { id: 'Dead:false', kind: 'Dead', is: false, label: 'Was not killed' },
  { id: 'KO:true', kind: 'KO', is: true, label: 'Was knocked out' },
  { id: 'KO:false', kind: 'KO', is: false, label: 'Was not knocked out' },
  { id: 'Down:true', kind: 'Down', is: true, label: 'Was killed or knocked out' },
  { id: 'Down:false', kind: 'Down', is: false, label: 'Not killed or knocked out' },
]);
const FATE_RE = /^UCFate([0-9a-f]{6})_(\w+)_(Dead|KO|Down)$/i;
export function fateCode(map) {
  let hash = 0;
  for (const ch of String(map).toUpperCase()) hash = (hash * 31 + ch.charCodeAt(0)) & 0xFFFFFF;
  return hash.toString(16).padStart(6, '0');
}
export function fateFlag(map, actor, kind) { return `UCFate${fateCode(map)}_${actor}_${kind}`; }
export function parseFate(flag, maps = []) {
  const m = FATE_RE.exec(String(flag || ''));
  if (!m) return null;
  return { code: m[1].toLowerCase(), actor: m[2], kind: { dead: 'Dead', ko: 'KO', down: 'Down' }[m[3].toLowerCase()],
    map: maps.find(map => fateCode(map) === m[1].toLowerCase()) || '' };
}
export function stateLabel(flagOrObject, is = true, maps = []) {
  const value = typeof flagOrObject === 'object' && flagOrObject !== null ? flagOrObject : { flag: flagOrObject, is };
  const fate = parseFate(value.flag, maps);
  if (!fate) return String(value.flag || 'Choose state');
  const predicate = FATE_PREDICATES.find(p => p.kind === fate.kind && p.is === (value.is !== false));
  return `${fate.actor} · ${predicate.label}${fate.map ? ' · ' + fate.map : ''}`;
}
export function validFlagName(value) { return /^[A-Za-z_]\w*$/.test(String(value || '')); }
export function flagCategory(entry) {
  if (parseFate(entry.name || entry.flag)) return 'character';
  const cat = String(entry.category || '').toLowerCase();
  const source = typeof entry.source === 'string' ? entry.source : '';
  if (/original|mission|game/.test(cat) || /original|mission script/i.test(source)) return 'original';
  if (/dialogue|infolink|conversation/.test(cat) || /dialogue|infolink|conversation|completion|automatic/i.test(source) || /_(Played|Heard)$/i.test(entry.name || entry.flag || '')) return 'dialogue';
  return 'story';
}
export function normalizeCatalog(entries = []) {
  const byName = new Map();
  const booleanTypes = new Set(['bool', 'boolean']);
  const keyOf = value => {
    if (Array.isArray(value)) return '[' + value.map(keyOf).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + keyOf(value[key])).join(',') + '}';
    return JSON.stringify(value);
  };
  const mergeReferences = (...groups) => [...new Map(groups.flat().map(reference => [keyOf(reference), reference])).values()];
  for (const raw of entries) {
    const entry = typeof raw === 'string' ? { name: raw } : raw || {};
    const name = String(entry.name || entry.flag || '');
    if (!name) continue;
    const type = String(entry.type || 'boolean').toLowerCase();
    const references = mergeReferences(Array.isArray(entry.uses) ? entry.uses : [], Array.isArray(entry.references) ? entry.references : []);
    const uses = Math.max(references.length, Array.isArray(entry.uses) ? 0 : Math.max(0, Number(entry.uses) || 0));
    const value = { ...entry, name, label: String(entry.label || name), type, uses,
      references, category: flagCategory(entry), selectable: entry.selectable !== false && booleanTypes.has(type) };
    const key = name.toLowerCase();
    // Prefer the richer catalog row, but never lose a known non-boolean type.
    const previous = byName.get(key);
    if (previous) {
      const mergedReferences = mergeReferences(previous.references, references);
      byName.set(key, { ...previous, ...value,
        // A plain name from autocomplete must not erase catalog metadata.
        label: entry.label ? value.label : previous.label,
        description: entry.description || previous.description,
        source: entry.source || previous.source,
        category: entry.category || entry.source ? value.category : previous.category,
        type: !booleanTypes.has(previous.type) ? previous.type : type,
        references: mergedReferences, uses: Math.max(previous.uses, uses, mergedReferences.length),
        selectable: previous.selectable && value.selectable });
    } else byName.set(key, value);
  }
  return [...byName.values()].sort((a, b) => a.label.localeCompare(b.label));
}
export function filterCatalog(entries, query = '', category = 'all') {
  const words = String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(entry => (category === 'all' || entry.category === category) && words.every(word =>
    `${entry.name} ${entry.label} ${entry.description || ''} ${typeof entry.source === 'string' ? entry.source : ''}`.toLowerCase().includes(word)));
}
// Deliberately patch only the fields this control owns. Imported metadata survives.
export function applyStateValue(target, patch, { allowEmpty = false, expiration = false } = {}) {
  if ('flag' in patch) {
    const name = String(patch.flag ?? '').trim();
    if (!(allowEmpty && !name) && !validFlagName(name)) throw new Error('Use letters, numbers and underscores; start with a letter or underscore.');
  }
  if (expiration && 'expiration' in patch && (!Number.isInteger(patch.expiration) || patch.expiration < 0 || patch.expiration > 99))
    throw new Error('Expiration must be a mission number from 0 to 99.');
  if ('flag' in patch) target.flag = String(patch.flag ?? '').trim();
  if ('is' in patch) target.is = patch.is !== false;
  if (expiration && 'expiration' in patch) target.expiration = patch.expiration;
  return target;
}
