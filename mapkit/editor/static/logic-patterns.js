// Patterns (P8 slice 2, editor/LOGIC.md "Patterns"): a block of the Logic window saved to be placed again, in this map
// or another (Save as pattern...; the project's logic/patterns, editor/logicpatterns.py). Pure: tests/test_logic_patterns.mjs.
//
// A pattern's version: {rules, pieces, objects, slots, ports, states}
//   rules    the block's rules (its inner blocks' too), ids R1, R2... (their "If not" links and step ids follow)
//   pieces   the logic items of the map's edits they use (edits.logic groups, points, phase sets, blocks), ids B1...
//   objects  the logic blocks the map added (an All of these, a Counter, a Timer...): they come with the pattern,
//            {slot, cls, props, at: where, from the first one}
//   slots    the map objects its rules name, in order: {id, words ("the door"), family (what it must be), carried}.
//            Where the rules named one, they say {<slot id>}
//   ports    the block's ports, their keys with {slot}s, and the names given to them (null: none, its pin's words)
//   states   the states and counters its rules set or read ({name, type})
import { rulesInside, BLOCK_FAMILIES, BOX } from './logic-boxes.js';

const list = (v) => (Array.isArray(v) ? v : []);
const own = (t, k) => (t && Object.hasOwn(t, k) ? t[k] : undefined);
// the logic blocks a map adds as objects (logic.json families): they go with a pattern
export const CARRIED_FAMILIES = BLOCK_FAMILIES;
// the logic items of edits.logic a block can hold (logic-graph-model.js PIECE_KINDS): their node prefix, their list
const ITEM_KINDS = [['blk:', 'blocks'], ['ph:', 'phases'], ['grp:', 'groups'], ['pt:', 'points']];
// keys whose values are never an object's name
const NOT_NAMES = new Set(['id', 'label', 'verb', 'when', 'by', 'name', 'title', 'otherwiseOf']);
const SLOT = /^\{([a-z][a-z0-9_]*)\}$/;
export const slotText = (id) => `{${id}}`;
export const slotOf = (v) => { const m = SLOT.exec(String(v ?? '')); return m ? m[1] : null; };

// a slot's id from words: "the door" -> door, "Officer Rossi" -> character (its family when its words are a name)
function slotId(word, family, taken) {
  const base = String(word || family || 'thing').toLowerCase().replace(/^(the|a|an) /, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'n$1') || 'thing';
  let id = base.slice(0, 24), n = 2;
  while (taken.has(id)) id = `${base.slice(0, 21)}${n++}`;
  taken.add(id);
  return id;
}
// every string of a value, the names of map objects in it replaced (deep, a copy); names: Map name -> replacement
function renamed(value, names, key = '') {
  if (typeof value === 'string') return !NOT_NAMES.has(key) && names.has(value) ? names.get(value) : value;
  if (Array.isArray(value)) return value.map((v) => renamed(v, names, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renamed(v, names, k)]));
  return value;
}
// the map objects named in a value, in order (the strings that are names of `objects`, outside NOT_NAMES)
function namesIn(value, objects, out = [], key = '') {
  if (typeof value === 'string') { if (!NOT_NAMES.has(key) && objects.has(value) && !out.includes(value)) out.push(value); }
  else if (Array.isArray(value)) value.forEach((v) => namesIn(v, objects, out, key));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) namesIn(v, objects, out, k);
  return out;
}

// A block as a pattern's version. edits: the map's; boxes: logic-boxes.js boxesOf(edits); actors: the Logic window's
// (logic-graph-model.js logicIndex(...).actors: {name: {family, word, label}}); nouns: {name: what the graph calls
// it ("door", "All of these block")}; ports: the block's (boxedView(graph, boxes, id).ports); states: [{name, type,
// rules: [rule ids]}] (from the index). Throws when it has no rules.
export function patternOf({ edits, boxes, id, actors = {}, nouns = {}, ports = [], states = [] }) {
  const inside = new Set(rulesInside(boxes, id));
  const links = list(edits && edits.links).filter((l) => l && inside.has(l.id));
  if (!links.length) throw new Error('This block has no rules to save.');
  const subtree = new Set([id]);
  for (let grew = true; grew;) { grew = false; for (const b of boxes) if (b.parent && subtree.has(b.parent) && !subtree.has(b.id)) { subtree.add(b.id); grew = true; } }
  const pieceIds = boxes.filter((b) => subtree.has(b.id)).flatMap((b) => b.pieces);
  // the map's objects: names of things that are no logic item, Story part or signal (a qualified key has a prefix)
  const objects = new Set(Object.keys(actors).filter((n) => !/^[a-z]+:/.test(n) && n !== 'world'));
  const logic = (edits && edits.logic) || {};
  // the logic items held, and the logic blocks the map added (as objects) held: new ids B1...
  const items = [], itemIds = new Map();
  for (const pid of pieceIds) {
    const kind = ITEM_KINDS.find(([prefix]) => pid.startsWith(prefix));
    const item = kind && list(own(logic, kind[1])).find((x) => x && x.id === pid.slice(kind[0].length));
    if (item) { const nid = 'B' + (items.length + 1); itemIds.set(item.id, nid); items.push({ kind: kind[1], item: { ...structuredClone(item), id: nid } }); }
  }
  const added = new Map(list(edits && edits.added).filter((a) => a && a.name).map((a) => [a.name, a]));
  const carried = pieceIds.filter((pid) => pid.startsWith('obj:')).map((pid) => pid.slice(4))
    .filter((n) => added.has(n) && CARRIED_FAMILIES.has((own(actors, n) || {}).family));
  // the objects named, in the order the rules name them (the carried ones and what their settings name too)
  const named = namesIn([links, items.map((x) => x.item), carried.map((n) => added.get(n).props || {})], objects);
  for (const n of carried) if (!named.includes(n)) named.push(n);
  const taken = new Set(), slots = [], names = new Map();
  for (const n of named) {
    const a = own(actors, n) || {};
    const word = own(nouns, n) || a.word || a.family || 'thing';
    const sid = slotId(word, a.family, taken);
    slots.push({ id: sid, words: `the ${String(word).replace(/^(the|a|an) /i, '')}`, family: a.family || 'other', carried: carried.includes(n), was: n });
    names.set(n, slotText(sid));
  }
  // the rules: ids R1..., their "If not" and step ids following, the objects their slots, the items their new ids
  const ruleIds = new Map(links.map((l, i) => [l.id, 'R' + (i + 1)]));
  const step = (old, nid) => (s) => (typeof s === 'string' && s.startsWith(old + '_') ? nid + s.slice(old.length) : s);
  const rules = links.map((l) => {
    const nid = ruleIds.get(l.id), r = renamed(structuredClone(l), names);
    r.id = nid;
    delete r.label;                                     // its words come back from its new objects when placed
    if (r.otherwiseOf) r.otherwiseOf = ruleIds.get(r.otherwiseOf) || r.otherwiseOf;
    for (const key of ['do', 'else']) for (const x of list(r[key])) {
      if (x && typeof x.id === 'string') x.id = step(l.id, nid)(x.id);
      if (x && x.group && itemIds.has(x.group)) x.group = itemIds.get(x.group);
    }
    return r;
  });
  const pieces = items.map((x) => ({ kind: x.kind, item: renamed(x.item, names) }));
  // the carried objects: where they are from the first one, their settings with slots
  const first = carried.length ? list(added.get(carried[0]).loc) : [];
  const objectsOut = carried.map((n) => {
    const a = added.get(n), loc = list(a.loc);
    return { slot: slotOf(names.get(n)), cls: a.cls, props: renamed(structuredClone(a.props || {}), names),
      at: loc.length === 3 && first.length === 3 ? loc.map((v, k) => Math.round(v - first[k])) : [0, 0, 0] };
  });
  // a port's key: obj:<name> its slot, rule:<id> its new id
  const keyOf = (k) => String(k).replace(/obj:([^|]+)/g, (m, n) => (names.has(n) ? names.get(n) : m))
    .replace(/rule:([^|]+)/g, (m, r) => (ruleIds.has(r) ? 'rule:' + ruleIds.get(r) : m))
    .replace(/act:([^/|]+)\/([^|]+)/g, (m, r, s) => (ruleIds.has(r) ? `act:${ruleIds.get(r)}/${step(r, ruleIds.get(r))(s)}` : m));
  // A port: by its outside end when that is one of the pattern's objects or a state ("in:{button}|out:used"), else by
  // its inside end ("in:inside:{all_of_these_block}|in:input:Add"): what is outside is the map's, not the pattern's.
  // ends: the inside ends it reaches; a name given to it kept (null: its pin's words, said again where it is placed)
  const given = (boxes.find((b) => b.id === id) || {}).ports || {};
  const portsOut = [];
  for (const p of list(ports)) {
    const outside = /^(in|out):(obj:([^|]+)|state:)/.exec(String(p.key));
    const ends = list(p.ends).map(keyOf);
    const key = outside && (outside[2] === 'state:' || names.has(outside[3])) ? keyOf(p.key) : `${p.side}:inside:${ends[0] || ''}`;
    const name = typeof given[p.key] === 'string' && given[p.key].trim() ? given[p.key].trim() : null;
    const had = portsOut.find((x) => x.key === key);
    if (had) { for (const e of ends) if (!had.ends.includes(e)) had.ends.push(e); if (!had.name) had.name = name; continue; }
    portsOut.push({ key, side: p.side, name, ends });
  }
  const statesOut = list(states).filter((s) => list(s.rules).some((r) => inside.has(r))).map((s) => ({ name: s.name, type: s.type === 'int' ? 'int' : 'bool' }));
  return { rules, pieces, objects: objectsOut, slots: slots.map(({ was, ...s }) => s), ports: portsOut, states: statesOut,
    was: Object.fromEntries(slots.map((s) => [s.id, s.was])) };
}

// A pattern's version in words, for the status line: "3 rules, 2 slots (the door, the button), 1 logic block"
export function patternWords(p) {
  const n = (k, one, many = one + 's') => (k ? `${k} ${k === 1 ? one : many}` : '');
  const slots = list(p.slots).filter((s) => !s.carried);
  return [n(list(p.rules).length, 'rule'), slots.length ? `${n(slots.length, 'object')} to choose (${slots.map((s) => s.words).join(', ')})` : '',
    n(list(p.objects).length, 'logic block') && `${n(list(p.objects).length, 'logic block')} it brings`, n(list(p.pieces).length, 'logic item')].filter(Boolean).join(', ');
}
export { BOX };

// ---------------------------------------------------------------- patterns placed in a map (P8 slice 3)
// edits.logic.instances = [{id: 'P1', pattern: <slug>, v, slots: {<slot id>: <object name>}, name}], the versions
// they use in edits.logicPatterns ({'<slug>@<v>': version}: the server's loaders put them there, the page when it
// places one). As editor/logicpatterns.py expand does for the build (tests/fixtures/logic_patterns: both give the same).
export const PATTERNS_KEY = 'logicPatterns';
const INSTANCE = /^P\d+$/;
const PATTERN_SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const EXPAND_KINDS = new Set(['blocks', 'phases', 'groups', 'points']);
export function instancesOf(edits) {
  const raw = list(edits && edits.logic && edits.logic.instances), seen = new Set(), out = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object' || !INSTANCE.test(String(x.id)) || seen.has(x.id)) continue;
    if (typeof x.pattern !== 'string' || !PATTERN_SLUG.test(x.pattern) || !Number.isInteger(x.v)) continue;
    seen.add(x.id);
    const slots = x.slots && typeof x.slots === 'object' && !Array.isArray(x.slots) ? x.slots : {};
    out.push({ id: x.id, pattern: x.pattern, v: x.v, name: String(x.name || x.pattern),
      slots: Object.fromEntries(Object.entries(slots).filter(([, v]) => typeof v === 'string').map(([k, v]) => [String(k), v])) });
  }
  return out;
}
export const versionKey = (slug, v) => `${slug}@${v}`;
// a free id: no placed pattern has it, and no rule or logic item an unpacked one left (P1_B1...) starts with it
export const nextInstanceId = (edits) => {
  const used = new Set(instancesOf(edits).map((x) => x.id));
  const logic = (edits && edits.logic) || {};
  for (const x of [...list(edits && edits.links), ...[...EXPAND_KINDS].flatMap((k) => list(logic[k]))]) {
    const m = x && /^(P\d+)_/.exec(String(x.id));
    if (m) used.add(m[1]);
  }
  let n = 1;
  while (used.has('P' + n)) n++;
  return 'P' + n;
};
const filled = (value, slots) => {
  if (typeof value === 'string') { const m = SLOT.exec(value); return m && Object.hasOwn(slots, m[1]) ? slots[m[1]] : value; }
  if (Array.isArray(value)) return value.map((v) => filled(v, slots));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, filled(v, slots)]));
  return value;
};
// a copy of value with each '{slot}' string the object placed in that slot (a slot not given stays '{slot}')
export const fillSlots = (value, slots) => filled(value, slots || {});
// the edits with each placed pattern written out (a copy; the same edits when none is): rules P1_R1... ('instance':
// 'P1'), logic items P1_B1..., its slots the objects the instance names ('' when none is)
export function expandInstances(edits) {
  const insts = instancesOf(edits), versions = edits && edits[PATTERNS_KEY] && typeof edits[PATTERNS_KEY] === 'object' ? edits[PATTERNS_KEY] : {};
  if (!insts.length || !Object.keys(versions).length) return edits;
  const links = [...list(edits.links)], logic = { ...(edits.logic || {}) };
  for (const inst of insts) {
    const ver = own(versions, versionKey(inst.pattern, inst.v));
    if (!ver || typeof ver !== 'object') continue;
    const pid = inst.id;
    const slots = Object.fromEntries(list(ver.slots).filter((s) => s && typeof s.id === 'string').map((s) => [s.id, own(inst.slots, s.id) || '']));
    const rules = list(ver.rules).filter((r) => r && typeof r.id === 'string');
    const ruleIds = new Map(rules.map((r) => [r.id, `${pid}_${r.id}`]));
    const pieces = list(ver.pieces).filter((p) => p && EXPAND_KINDS.has(p.kind) && p.item && typeof p.item === 'object');
    const itemIds = new Map(pieces.map((p) => [p.item.id, `${pid}_${p.item.id}`]));
    for (const r of rules) {
      const x = filled(r, slots);
      x.id = ruleIds.get(r.id);
      x.instance = pid;
      if (ruleIds.has(x.otherwiseOf)) x.otherwiseOf = ruleIds.get(x.otherwiseOf);
      for (const key of ['do', 'else']) for (const a of list(x[key])) {
        if (!a || typeof a !== 'object') continue;
        if (typeof a.id === 'string' && a.id.startsWith(r.id + '_')) a.id = `${pid}_${a.id}`;
        if (itemIds.has(a.group)) a.group = itemIds.get(a.group);
      }
      links.push(x);
    }
    for (const p of pieces) {
      const item = filled(p.item, slots);
      item.id = itemIds.get(p.item.id);
      if (Array.isArray(item.members)) item.members = item.members.filter((m) => m !== '');     // a slot left empty is no member
      logic[p.kind] = [...list(logic[p.kind]), item];
    }
  }
  return { ...edits, links, logic };
}

// The placed patterns as blocks of the Logic window (read-only: they are the pattern's, not the map's): edits written
// out by expandInstances. {id: 'P1', name, rules: [P1_R1...], pieces: [the logic items it wrote, the logic blocks it
// brought], parent: null, ports: {}, instance: {pattern, v, newest}}. newest: {slug: its newest version} (an update
// when it is past the instance's)
export function instanceBoxes(edits, newest = {}) {
  const insts = instancesOf(edits), versions = (edits && edits[PATTERNS_KEY]) || {};
  if (!insts.length) return [];
  const logic = (edits && edits.logic) || {};
  return insts.map((inst) => {
    const ver = own(versions, versionKey(inst.pattern, inst.v)) || {};
    const rules = list(edits.links).filter((l) => l && l.instance === inst.id).map((l) => String(l.id));
    const items = ITEM_KINDS.flatMap(([prefix, kind]) => list(logic[kind])
      .filter((x) => x && String(x.id).startsWith(inst.id + '_')).map((x) => prefix + x.id));
    const carried = list(ver.objects).map((o) => o && own(inst.slots, o.slot)).filter(Boolean).map((n) => 'obj:' + n);
    const top = own(newest, inst.pattern);
    return { id: inst.id, name: inst.name, rules, pieces: [...items, ...carried], parent: null, ports: {},
      instance: { pattern: inst.pattern, v: inst.v, missing: !own(versions, versionKey(inst.pattern, inst.v)), newest: Number.isInteger(top) && top > inst.v ? top : null } };
  });
}

// What a newer version changes, for its Update: rules by id (R1...), new places to fill, logic blocks it brings more.
// {added, removed, changed, slots: [words of new non-carried slots], objects: [words of new carried ones], words}
export function versionChanges(older, newer) {
  const key = (r) => JSON.stringify(r);
  const was = new Map(list(older && older.rules).filter((r) => r && r.id).map((r) => [r.id, key(r)]));
  const now = new Map(list(newer && newer.rules).filter((r) => r && r.id).map((r) => [r.id, key(r)]));
  const added = [...now.keys()].filter((id) => !was.has(id)), removed = [...was.keys()].filter((id) => !now.has(id));
  const changed = [...now.keys()].filter((id) => was.has(id) && was.get(id) !== now.get(id));
  const hadSlot = new Set(list(older && older.slots).map((s) => s && s.id));
  const fresh = list(newer && newer.slots).filter((s) => s && !hadSlot.has(s.id));
  const slots = fresh.filter((s) => !s.carried).map((s) => s.words), objects = fresh.filter((s) => s.carried).map((s) => s.words);
  const n = (k, one, many = one + 's') => `${k} ${k === 1 ? one : many}`;
  const parts = [changed.length && `${n(changed.length, 'rule')} changed`, added.length && n(added.length, 'new rule'),
    removed.length && `${n(removed.length, 'rule')} gone`, slots.length && `${slots.length === 1 ? 'a new place' : n(slots.length, 'new place')} to fill (${slots.join(', ')})`,
    objects.length && `it brings ${objects.join(', ')} too`].filter(Boolean);
  return { added, removed, changed, slots, objects, words: parts.length ? parts.join(', ') : 'nothing its rules do' };
}
