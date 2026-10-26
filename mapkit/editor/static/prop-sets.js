// Copy and paste of an object's properties, Reset to the class default and property presets, as Unity's
// component menu (Copy Component, Paste Component Values, Reset), its right click on a field (Copy, Paste, Reset)
// and its Presets: a set of properties as UnrealEd text, what it changes on the objects it is pasted on, the
// presets of a project. The logic only: app.js says what an object's properties are and writes them, one Ctrl+Z.
//
// A set: {cls, from (the object it was copied from), props: {key: text, or null: no value of its own}, raw: {key:
// text}, declared: {key: the class of the game that declares it, where known}}: the Properties' values
// (edits.props) and All properties' (edits.rawprops). A key is a property, or property(index) for one of several
// values (InitialInventory(0)...). Pasted, a set knows its class's All properties too (rawNames, as an object).
// An object as the plans read it: {name, props: {key: state} for each key its class has, raw: its All properties,
// rawNames: the properties of its class as All properties has them (a Map: name -> its category; null: not
// known)}; a state: {raw (All properties' value), edited (the value set in the editor), base (the map's own, else
// the class default; undefined: the game's), def (the class default; null: the game's), declared (the class of the
// game that declares it: editor/props.py fields_for), readOnly (true: it stays as it is on this object, read only
// in its Inspector, so nothing is pasted or reset on it)}.

// what stays an object's own unless asked: the names other objects and the story find it by, its texts
export const OWN = new Set(['Tag', 'Event', 'BindName', 'textTag', 'TextPackage', 'bulletinTag']);
// fields that are no values to copy: a model (Replace...), hidden ones, texts kept apart (edits.documents, edits.texts),
// a patrol point's animation (its own field sets up the characters patrolling there to play it)
const SKIP = new Set(['mesh', 'hidden', 'text', 'emails', 'bulletins', 'anim']);
// a field that sets another property with its own: a light's colour its saturation, a map exit whether it is on
const COMPANIONS = { lightcolor: ['LightSaturation'], mapurl: ['bEnabled'] };
// a property, or one of several values of one (UnrealEd's text: 64 characters, at most 2 digits of index)
const KEY = /^[A-Za-z_]\w{0,63}(\(\d{1,2}\))?$/;
// the kinds whose values go into any property of that kind (Paste value): the Properties' numbers, names, classes
// and sounds (editor/props.py), All properties' numbers (UnrealEd's types; a Byte that is an enum has options)
const SCALARS = new Set(['bool', 'int', 'float', 'byte', 'name', 'string', 'faction', 'item', 'sound', 'half', 'radius',
  'IntProperty', 'FloatProperty', 'ByteProperty']);

export const baseOf = (key) => String(key).split('(')[0];
// two declarations of a property the same, where both are known: one name declared in two classes apart is two
// properties (an ATM's accounts are not a computer's)
const sameDeclaration = (a, b) => a == null || b == null || a === b;
// a change put in a plan's changes: its key, whether it is one of OWN; none when nothing changes
const add = (changes, key, c) => { if (c) changes.push({ key, own: OWN.has(baseOf(key)), ...c }); };

// The keys of a field of the Properties (editor/props.py fields_for): one for each of its values
export function fieldKeys(f) {
  const n = Array.isArray(f.default) ? f.default.length : 0;
  return n > 1 ? f.default.map((_, i) => `${f.prop}(${i})`) : [f.prop];
}

// Every key of a class's Properties with its field and its class default
export function classKeys(fields) {
  const keys = new Map();
  for (const f of fields) if (!SKIP.has(f.kind))
    fieldKeys(f).forEach((key, i) => keys.set(key, { field: f, def: (Array.isArray(f.default) ? f.default[i] : '') ?? '' }));
  return keys;
}

// The keys Copy value and Paste value take for a field: its own, and those it sets with them that its class has
export function valueKeys(f, keys) { return fieldKeys(f).concat((COMPANIONS[f.kind] || []).filter((k) => keys.has(k))); }

// Two UnrealEd texts the same value: numbers as numbers (0.5 and 0.500000), True and False in any case; no value
// (null, undefined) is only the same as no value
export function sameText(a, b) {
  if (a == null || b == null) return a == null && b == null;
  const x = String(a).trim(), y = String(b).trim();
  if (x === y) return true;
  if (x !== '' && y !== '' && Number.isFinite(Number(x)) && Number.isFinite(Number(y))) return Number(x) === Number(y);
  return /^(true|false)$/i.test(x) && x.toLowerCase() === y.toLowerCase();
}

// What an object shows for a key: All properties' value, else the one set in the editor, else the map's or the class's
export const shownOf = (s) => s.raw ?? s.edited ?? s.base;

// The change that gives a key of an object a value (null: no value of its own, the map's or the class's): what each
// store gets (props, raw: a text to put, null to take it away), from and to as shown (null: the game's); null when
// it shows that value already or it is read only there. All properties' value goes: it would win in the game.
export function keyChange(s, wanted) {
  const from = shownOf(s) ?? null, to = wanted ?? s.base ?? null;
  if (s.readOnly || sameText(from, to)) return null;
  const c = { from, to };
  if (s.raw !== undefined) c.raw = null;
  if (wanted != null && !sameText(s.base, wanted)) c.props = wanted;
  else if (s.edited !== undefined) c.props = null;
  return c;
}

// The change of a value of All properties (to empty: it goes, the object is as the map has it)
export function rawChange(now, to) {
  if (sameText(now ?? '', to ?? '')) return null;
  return { from: now ?? null, to: to || null, raw: to || null };
}

// Copy: an object's set; only: the keys of one section (a Set), all of them without it. A key of the Properties
// keeps what it shows (as text: an object placed in the editor may hold numbers) and the class that declares it,
// All properties' own keys come as they are.
export function copySet(o, only = null) {
  const props = {}, raw = {}, declared = {};
  for (const [key, s] of Object.entries(o.props)) if (!only || only.has(key)) {
    const v = shownOf(s);
    props[key] = v == null ? null : String(v);
    if (s.declared) declared[key] = s.declared;
  }
  for (const [key, v] of Object.entries(o.raw || {})) if ((!only || only.has(key)) && !(key in o.props)) raw[key] = v;
  return { cls: o.cls, from: o.name, props, raw, declared };
}

// Copy of the section All properties: what was set there, as it is
export function rawSet(o) { return { cls: o.cls, from: o.name, props: {}, raw: { ...(o.raw || {}) } }; }

// Paste: what a set changes on each object, only the keys its class has, of the same declaration (props.py's class,
// All properties' category), and not those read only there; only(o): the keys of a section of it (a Set), all of
// them without it. [{name, changes: [{key, own (one of OWN: not pasted unless ticked), from, to, props?, raw?}]}]
export function pastePlan(set, objects, only = () => null) {
  return objects.map((o) => {
    const keys = only(o), changes = [], take = (key) => !keys || keys.has(key);
    for (const [key, v] of Object.entries(set.props))
      if (key in o.props && take(key) && sameDeclaration(set.declared?.[key], o.props[key].declared)) add(changes, key, keyChange(o.props[key], v));
    for (const [key, v] of Object.entries(set.raw || {})) {
      const name = baseOf(key);
      if (o.rawNames?.has(name) && take(key) && sameDeclaration(set.rawNames?.get(name), o.rawNames.get(name)) && !o.props[key]?.readOnly)
        add(changes, key, rawChange(o.raw?.[key], v));
    }
    return { name: o.name, changes };
  });
}

// Reset: each key (of only(o), all of them without it) back to its class default (Movement: the game's); the whole
// object: what was set in All properties goes too
export function resetPlan(objects, only = () => null) {
  return objects.map((o) => {
    const keys = only(o), changes = [];
    for (const [key, s] of Object.entries(o.props)) if (!keys || keys.has(key)) add(changes, key, keyChange(s, s.def));
    if (!keys) for (const [key, v] of Object.entries(o.raw || {})) if (!(key in o.props)) add(changes, key, rawChange(v, ''));
    return { name: o.name, changes };
  });
}

// Clear All properties: each of its values goes (the objects as the map has them)
export function clearRawPlan(objects) {
  return objects.map((o) => {
    const changes = [];
    for (const [key, v] of Object.entries(o.raw || {})) add(changes, key, rawChange(v, ''));
    return { name: o.name, changes };
  });
}

// The list of what changes: one row for each key, in the order met, with the objects it changes, what each shows
// now and gets; own: not ticked at first
export function changeRows(plans) {
  const rows = new Map();
  for (const p of plans) for (const c of p.changes) {
    const r = rows.get(c.key) || rows.set(c.key, { key: c.key, own: c.own, names: [], from: [], to: [] }).get(c.key);
    r.names.push(p.name); r.from.push(c.from); r.to.push(c.to);
  }
  return [...rows.values()];
}

// The plans with the ticked keys only, without the objects nothing changes on
export function chosenPlans(plans, keys) {
  return plans.map((p) => ({ ...p, changes: p.changes.filter((c) => keys.has(c.key)) })).filter((p) => p.changes.length);
}

// Paste value: a value copied from a field ({prop, kind, values: one for each of its keys, declared or category,
// options: a choice's}) goes into a field ({prop, kind, keys, declared or category, options}) with as many values:
// of the same property (of the same declaration where both say it: an ATM's accounts are not a computer's), else of
// the same kind that takes any value (SCALARS: a brightness into a radius), a choice's only into a choice that has
// it (a light's type is no effect); its values for the field's keys, else null
export function fieldPaste(clip, target) {
  if (!clip || clip.values.length !== target.keys.length || !fits(clip, target)) return null;
  return target.keys.map((key, i) => [key, clip.values[i]]);
}
function fits(clip, target) {
  if (clip.prop === target.prop && sameDeclaration(clip.declared, target.declared) && sameDeclaration(clip.category, target.category)) return true;
  if (clip.kind !== target.kind) return false;
  if (clip.options || target.options) return !!target.options && clip.values.every((v) => target.options.includes(String(v)));
  return SCALARS.has(target.kind);
}

// ---------------------------------------------------------------- presets
// A preset: {name, cls, section (the section it was saved from, empty: the whole object), props, raw}, kept in the
// project (app.js: projectStorageKey 'presets'), for objects of its class and of the classes under it.
const NAME = /^[^\x00-\x1f\x7f]{1,60}$/;
const CLS = /^[A-Za-z_][\w.]{0,127}$/;
const texts = (o, nulls) => o && typeof o === 'object' && !Array.isArray(o)
  && Object.entries(o).every(([k, v]) => KEY.test(k) && (typeof v === 'string' ? v.length <= 2000 : nulls && v === null));

// The presets of a project from what is kept (JSON), what is not one left out
export function readPresets(text) {
  let d;
  try { d = JSON.parse(text || 'null'); } catch { return []; }
  if (!d || d.version !== 1 || !Array.isArray(d.presets)) return [];
  return d.presets.filter((p) => p && presetName(p.name) && typeof p.cls === 'string' && CLS.test(p.cls)
    && typeof (p.section ?? '') === 'string' && texts(p.props, true) && texts(p.raw, false))
    .map((p) => ({ name: presetName(p.name), cls: p.cls, section: String(p.section || '').slice(0, 60), props: p.props, raw: p.raw }));
}
export const presetsText = (list) => JSON.stringify({ version: 1, presets: list });

// A name for a preset: 1 to 60 characters that print, else null
export function presetName(name) { const n = typeof name === 'string' ? name.trim() : ''; return NAME.test(n) ? n : null; }

// The presets with one saved from a set (without what stays an object's own: a preset is for other objects), in
// place of the one of that class with that name
export function withPreset(list, name, set, section = '') {
  const keep = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !OWN.has(baseOf(k))));
  const p = { name: presetName(name), cls: set.cls, section, props: keep(set.props), raw: keep(set.raw) };
  if (!p.name || !CLS.test(String(p.cls))) throw new Error('A preset needs a name (1 to 60 characters) and a class.');
  return list.filter((x) => !samePreset(x, p.cls, p.name)).concat(p).sort((a, b) => a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name));
}
// The presets without that one
export function withoutPreset(list, cls, name) { return list.filter((x) => !samePreset(x, cls, name)); }
const samePreset = (p, cls, name) => p.cls === cls && p.name.toLowerCase() === String(name).trim().toLowerCase();

// The presets that fit objects of these classes (chains: each one's class and its parents), those of their own
// class first
export function presetsFor(list, chains) {
  const fit = list.filter((p) => chains.length && chains.every((c) => c.includes(p.cls)));
  return fit.sort((a, b) => Number(b.cls === chains[0][0]) - Number(a.cls === chains[0][0]) || a.name.localeCompare(b.name));
}
