// Linked prefabs, as Unity's prefab instances: a copy of a prefab of the project's library placed in a map (an
// entry of edits.prefabs) stays linked to its prefab, by the prefab's line (the id of its first version,
// prefab_library.py) and the version it was placed at or last updated to. The objects of a copy are named after the
// copy and their slot in the prefab (prefabs.py place): an object keeps its name in every version, so what the user
// changed on one copy (moved, deleted, replaced, its properties) stays with that object when the copy is updated.
// Pure, no DOM: tests/test_prefab_links.mjs.

// a version saved in the library (prefab_library.py _ID); the Pieces' prefabs and structures pasted from other maps are
// not linked
const LIBRARY_ID = /^usr_[a-f0-9]{32}$/;
export const isLibraryVersion = (id) => LIBRARY_ID.test(String(id || ''));

// what the user changed on an object of a copy, by the edits field that keeps it (each one keyed by the object's name)
export const OVERRIDES = { moved: 'moved', deleted: 'deleted', props: 'changed', rawprops: 'changed', disabled: 'off in game' };
// the changes the build puts into the objects themselves: a version taken from the built map has them (Apply to prefab),
// with the objects given another class (Replace with..., edits.added[].replaces)
export const BAKED = ['moved', 'deleted', 'props', 'rawprops'];

const version = (n) => (Number.isInteger(n) && n > 0 ? n : 1);
// a record that changes its object (an object switched on again keeps false in edits.disabled: no change)
const changes = (value) => value !== false && value != null;

// the link of a placed copy, { line, version }; null for a copy of anything else or an unpacked one
export function linkOf(entry) {
  if (!entry || entry.unpacked || !LIBRARY_ID.test(String(entry.prefab || ''))) return null;
  return { line: LIBRARY_ID.test(String(entry.line || '')) ? entry.line : entry.prefab, version: version(entry.version) };
}

// what a new copy of a library item (the browser's newest version of a prefab) records of its link; {} for a prefab of
// the Pieces or a structure copied from another map
export function linkFields(item) {
  if (!item || !LIBRARY_ID.test(String(item.id || ''))) return {};
  return { line: LIBRARY_ID.test(String(item.line || '')) ? item.line : item.id, version: version(item.version) };
}

// the copies of a prefab (its line) among the edits' entries
export function copiesOf(entries, line) { return (entries || []).filter((e) => linkOf(e)?.line === line); }

// a copy behind its prefab's newest version (the library's item of its line)
export function outdated(entry, newest) {
  const link = linkOf(entry);
  return !!(link && newest && link.line === (newest.line || newest.id) && link.version < version(newest.version));
}

// the start of the names of a copy's objects (prefabs.py member_tag): UCPf and its pid, without other characters than
// letters, digits and _
export function memberTag(pid) { return 'UCPf' + String(pid).replace(/\W/g, ''); }

// is `name` an object of the copy `pid`: its tag, then B (a brush) or A (an object) and its slot (prefabs.py member_slot)
export function isMember(name, pid) {
  const tag = memberTag(pid), text = String(name);
  return text.startsWith(tag) && /^[AB]\d+$/.test(text.slice(tag.length));
}

// a text that names a copy p<n>: its structure (paste~p<n>, the Hierarchy's s:paste~p<n>) or one of its objects
// (UCPfp<n>A<slot>, a:UCPfp<n>A<slot>...)
const NAMES_A_COPY = /paste~(p\d+)(?!\w)|UCPf(p\d+)[AB]\d+(?!\w)/g;
// The pid of a new copy (app.js nextPid): the first p<n> nothing in the edits names, as a key or a text anywhere in them
// (an entry's pid, the moved, deleted, changed... records of a deleted copy's objects, which Undo brings back with it, a
// cutscene's or a rule's target, a folder's item), nor any of `keys` (the Hierarchy's hidden and locked objects). A
// copy's objects are named after its pid, so a pid given again would make what was done to the old copy's objects the
// new copy's (its overrides; Update instances would move them onto it)
export function freePid(edits, keys = []) {
  const used = new Set((edits?.prefabs || []).map((e) => String(e?.pid)));
  const note = (text) => { for (const m of String(text).matchAll(NAMES_A_COPY)) used.add(m[1] || m[2]); };
  const walk = (value) => {
    if (typeof value === 'string') note(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { note(key); walk(item); }
  };
  walk(edits);
  for (const key of keys) note(key);
  let i = 1;
  while (used.has('p' + i)) i++;
  return 'p' + i;
}

// the objects given another class on a copy (Replace with...): their entries in edits.added (app.js moves them with
// their copy)
export const replacedOn = (edits, pid) => (edits.added || []).filter((a) => a?.replaces && isMember(a.name, pid));

// what the user changed on the objects of a copy (Unity's overrides): [{ name, kinds }] in the order of the names
export function overridesOf(edits, entry) {
  const found = new Map();
  const add = (name, kind) => { if (!found.has(name)) found.set(name, new Set()); found.get(name).add(kind); };
  for (const [field, kind] of Object.entries(OVERRIDES))
    for (const [name, value] of Object.entries(edits?.[field] || {}))
      if (changes(value) && isMember(name, entry.pid)) add(name, kind);
  for (const a of replacedOn(edits || {}, entry.pid)) add(a.name, 'replaced');
  return [...found].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).map(([name, kinds]) => ({ name, kinds: [...kinds] }));
}

// What the user changed on a copy's objects, apart from the copy, for another copy of it (Duplicate, Copy and Paste):
// { field: { slot: record } } for OVERRIDES' fields, and `added`: the entries of the objects given another class, each by
// its object's slot (A0, B1...: its name after the copy's tag). A copy of the records, not the records
export function overridesData(edits, pid) {
  const slot = (name) => String(name).slice(memberTag(pid).length), clone = (v) => JSON.parse(JSON.stringify(v)), data = {};
  for (const field of Object.keys(OVERRIDES))
    for (const [name, record] of Object.entries(edits?.[field] || {}))
      if (isMember(name, pid)) (data[field] ||= {})[slot(name)] = clone(record);
  const added = replacedOn(edits || {}, pid).map((a) => ({ ...clone(a), name: slot(a.name) }));
  if (added.length) data.added = added;
  return data;
}
// a record with the places it keeps (where the build finds its object, orig, and where it goes, loc; a replacing
// object's replaced one too) `delta` (x y z) away
function shifted(record, delta) {
  const out = JSON.parse(JSON.stringify(record));
  if (!out || typeof out !== 'object') return out;
  for (const key of ['orig', 'loc']) if (Array.isArray(out[key])) out[key] = out[key].map((v, i) => v + (delta[i] || 0));
  if (out.replaces) out.replaces = shifted(out.replaces, delta);
  return out;
}
// A copy's changes (overridesData) given to the copy `pid`, placed `delta` (x y z) from the one they were taken from,
// with the same turn: named after its objects, their places moved with it. Changes edits in place (the caller took the
// undo step); the new copy's pid is a free one (freePid), so nothing of it is there to overwrite
export function putOverrides(edits, data, pid, delta) {
  const tag = memberTag(pid);
  for (const field of Object.keys(OVERRIDES))
    for (const [slot, record] of Object.entries(data?.[field] || {})) (edits[field] ||= {})[tag + slot] = shifted(record, delta);
  for (const a of data?.added || []) (edits.added ||= []).push({ ...shifted(a, delta), name: tag + a.name });
}

// where the build looks for an object a change is about (its place before the change, `orig`), moved to where the
// object now stands in its version
function rebase(record, member) { if (record && Array.isArray(record.orig)) record.orig = member.loc.slice(); }

// Update instances: the copy `entry` put on the version `target` of its prefab (the library's item: {id, version,
// label}), keeping its place, turn and size. members: where each object of the copy stands in that version
// (prefab_library.py members). A change to an object the version still has stays; one to an object it no longer has
// goes (the object it replaced: the replacing one stays, as an object of its own). Changes edits in place (the caller
// took the undo step); returns the names of the objects whose changes went.
export function updateCopy(edits, entry, target, members) {
  const link = linkOf(entry);
  if (!link) throw new Error('This copy is not linked to a prefab of the library.');
  const gone = new Set();
  for (const field of Object.keys(OVERRIDES)) {
    const records = edits[field];
    if (!records || typeof records !== 'object') continue;
    for (const name of Object.keys(records)) {
      if (!isMember(name, entry.pid)) continue;
      if (members[name]) { rebase(records[name], members[name]); continue; }
      if (changes(records[name])) gone.add(name);
      delete records[name];
    }
  }
  for (const a of replacedOn(edits, entry.pid)) {
    if (members[a.name]) rebase(a.replaces, members[a.name]);
    else { delete a.replaces; gone.add(a.name); }
  }
  Object.assign(entry, { prefab: target.id, line: link.line, version: version(target.version) });
  if (target.label) entry.label = target.label;
  return [...gone].sort();
}

// Apply to prefab: the copy saved as the new version `saved` ({id, line, version}) of its prefab, taken from the built
// map, so the changes the build put into its objects are that version's now and no longer the copy's own (an object
// switched off in game stays so: the build takes it out of the map, not out of the version). Changes edits in place;
// returns the names of the objects whose changes went into the prefab.
export function appliedCopy(edits, entry, saved) {
  const cleared = new Set();
  for (const field of BAKED)
    for (const name of Object.keys(edits[field] || {}))
      if (isMember(name, entry.pid)) { delete edits[field][name]; cleared.add(name); }
  const replaced = replacedOn(edits, entry.pid);
  for (const a of replaced) cleared.add(a.name);
  if (replaced.length) edits.added = edits.added.filter((a) => !replaced.includes(a));
  Object.assign(entry, { prefab: saved.id, line: saved.line, version: version(saved.version) });
  return [...cleared].sort();
}

// Unpack (Unity's Unpack Prefab): the copy forgets its prefab. It stays in the map as it is (it is still built from
// the version it places); Update instances and Apply to prefab leave it alone
export function unpack(entry) {
  delete entry.line;
  delete entry.version;
  entry.unpacked = true;
}

// a prefab's copies in a map, for its card in the Prefabs browser: how many, how many behind its newest version
export function copyCounts(entries, newest) {
  const copies = copiesOf(entries, newest.line || newest.id);
  return { count: copies.length, older: copies.filter((e) => outdated(e, newest)).length };
}
