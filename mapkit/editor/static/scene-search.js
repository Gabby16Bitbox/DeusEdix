// The Hierarchy's search, as Unity's scene search: plain words find a name, a label or a class as before, and tokens
// look at one thing of an object: t: (or class:) its class or kind, tag:, event:, label:, name:, snd: (a sound it
// uses), tex: (a texture), mesh: (its model), is: (hidden, locked, disabled, added, original, nested, selected) and
// ref:<name> (that object, what points at it and what it points at). key:value finds a part of it, key=value the
// whole of it (or its last part after a dot: snd=Hum for Ambient.Hum); a value in quotes may have spaces; a - before
// a word or a token leaves out what it finds; every word and token must hold. Without the page: app.js says what
// each thing is (its facts, read only when a token asks) and what a name refers to; search-box.js and
// search-view.js show the result.
import { SHOW_KINDS, SHOW_KIND, showKindOf } from './scene-kinds.js';

// The tokens, in the order the autocomplete offers them. field: the fact of a thing it looks at; alias: another
// name for a token, understood but not offered.
export const SEARCH_KEYS = Object.freeze([
  { key: 't', field: 'types', hint: 'class or kind: t:light, t:door, t:ScriptedPawn' },
  { key: 'tag', field: 'tag', hint: 'its Tag' },
  { key: 'event', field: 'event', hint: 'its Event' },
  { key: 'name', field: 'name', hint: 'its name in the map' },
  { key: 'label', field: 'label', hint: 'the name the Hierarchy shows' },
  { key: 'snd', field: 'sounds', hint: 'a sound it uses: its ambient sound, a door\'s, a sound effect\'s, its rules\'' },
  { key: 'tex', field: 'textures', hint: 'a texture it uses: its skins, its faces, a block\'s' },
  { key: 'mesh', field: 'meshes', hint: 'its model' },
  { key: 'is', field: 'is', hint: 'hidden, locked, disabled, added, original, nested, selected' },
  { key: 'ref', field: 'ref', hint: 'that object, what points at it and what it points at' },
  { key: 'class', field: 'types', alias: 't' },
].map(Object.freeze));
const KEY = Object.fromEntries(SEARCH_KEYS.map((k) => [k.key, k]));
export const IS_STATES = Object.freeze(['hidden', 'locked', 'disabled', 'added', 'original', 'nested', 'selected']);
// the words of each row of the Show menu (scene-kinds.js), as a thing of it is called: t:character and t=character
// find the characters (a row's id and name find it too: t=pawn, t:characters)
export const KIND_WORDS = Object.freeze({ structure: ['structure'], pawn: ['character'], light: ['light'], prop: ['object'],
  mover: ['door', 'elevator'], logic: ['trigger'], path: ['path'], box: ['block'], sound: ['sound'], camera: ['camera'],
  zone: ['zone'] });
// what t: offers before the map's classes: the rows' words, in the menu's order
export const TYPE_WORDS = Object.freeze(SHOW_KINDS.flatMap((k) => KIND_WORDS[k.id]));

const lower = (s) => String(s ?? '').toLowerCase();
const present = (s) => !!s && s !== 'none';                  // a name the game leaves empty is None
const unquote = (s) => s.replace(/"/g, '');
// a value as the query writes it: in quotes when it has a space
export function quoteValue(v) {
  const s = unquote(String(v ?? ''));
  return /\s/.test(s) || !s ? `"${s}"` : s;
}
// a token for a name (Find references: ref, Find in map: snd, tex, mesh); exact: the whole of it
export function searchToken(key, value, exact = false) { return `${key}${exact ? '=' : ':'}${quoteValue(value)}`; }

// The pieces of a query, split at the spaces outside quotes: {text, from, to} (to: just after its last letter)
function pieces(text) {
  const out = [];
  let from = 0, quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    if (i < text.length && (quoted || !/\s/.test(c))) continue;
    if (i > from) out.push({ text: text.slice(from, i), from, to: i });
    from = i + 1;
  }
  return out;
}
// a piece read: a token {key, field, value, exact, not} when it starts with a known key, else a word {word, not}
function termOf(raw) {
  const m = /^(-?)([a-z]+)([:=])(.*)$/i.exec(raw), k = m && KEY[m[2].toLowerCase()];
  if (k) return { key: k.alias || k.key, field: k.field, value: lower(unquote(m[4])), exact: m[3] === '=', not: m[1] === '-' };
  const not = raw.length > 1 && raw[0] === '-';
  return { word: lower(unquote(not ? raw.slice(1) : raw)), not };
}
// A query: its words and tokens (terms). A token still without its value (tag: as it is typed) asks nothing yet,
// nor does an empty word. empty: nothing to look for (the whole map); plain: what it looks for is words only (a folder
// found by its name shows all of it; a - token there only leaves out: room -t:light).
export function parseSearch(text) {
  const terms = pieces(String(text ?? '')).map((p) => termOf(p.text)).filter((t) => (t.word !== undefined ? t.word : t.value));
  return { terms, empty: !terms.length, plain: terms.every((t) => t.not || t.word !== undefined) };
}

// A fact of a thing, as a list of names in lower case without the empty ones: a fact is a value, a list or a
// function that gives one (asked only when a token looks at it)
function factList(facts, field) {
  const v = typeof facts[field] === 'function' ? facts[field]() : facts[field];
  return [].concat(v ?? []).map(lower).filter(present);
}
const lastPart = (s) => s.slice(s.lastIndexOf('.') + 1);

// The test of a query on a thing's facts: {name, label, cls, types, tag, event, sounds, textures, meshes} (values,
// lists or functions) and is(state). refs(name): the names a ref: finds (the page's: that object, what points at it
// and what it points at), asked once per name.
export function searchMatcher(query, { refs = () => [] } = {}) {
  const found = new Map();
  const refsOf = (v) => found.get(v) || found.set(v, new Set([...refs(v)].map(lower))).get(v);
  const holds = (t, f) => {
    if (t.word !== undefined) return ['name', 'label', 'cls'].some((k) => lower(f[k]).includes(t.word));
    if (t.key === 'is') return !!f.is?.(t.value);
    if (t.key === 'ref') return refsOf(t.value).has(lower(f.name));
    return factList(f, t.field).some((s) => (t.exact ? s === t.value || lastPart(s) === t.value : s.includes(t.value)));
  };
  return (facts) => query.terms.every((t) => holds(t, facts) !== t.not);
}

// The search over what holds things (a folder, a structure), found by its name with words only (it has no class, tag
// or sound; a - token leaves out only what it holds): named(label) a folder or a piece found by its own name; a folder
// or a structure whose name has a word looked for (not a - word alone: every folder is no crate) opens: it shows all
// it holds, the folders and structures in it too with what they hold, but what a - word or token leaves out,
// wherever it is.
// opens(label, within): that folder or structure opens (within: one that holds it did); shows(open, it): a thing in a
// folder or structure (open: it opened), it = {match: its own test, facts}; piece(label, open): a piece of a
// structure; listed(open, own): a folder or structure with nothing to show in it is listed all the same, when it opened
// or was found itself (own: a structure by its own facts) by something looked for (a - word alone would list every
// folder, empty).
export function folderSearch(query, ctx) {
  const matches = searchMatcher(query, ctx), kept = searchMatcher({ terms: query.terms.filter((t) => t.not) }, ctx);
  const looks = query.terms.some((t) => !t.not);              // a word or a token looked for, not only left out
  const named = (label) => query.plain && matches({ name: label, label });
  return {
    named,
    opens: (label, within = false) => within || (looks && named(label)),
    shows: (open, it) => it.match || (open && kept(it.facts)),
    piece: (label, open) => named(label) || (open && kept({ name: label, label })),
    listed: (open, own = false) => open || (looks && own),
  };
}

// What t: finds a thing by, each once: its class and the classes it comes from, its kind, and the Show menu's row it
// is in (the Hierarchy's folder) by its id, its name and its words (kind: the object's, 'structure' or 'drawn';
// chain: its parent classes, when known)
export function typesOf(kind, cls, chain = []) {
  const show = showKindOf(kind, cls);
  return [...new Set([cls, ...(chain || []), kind, show, SHOW_KIND[show].label, ...KIND_WORDS[show]].filter(Boolean))];
}

// The sounds, textures and models the values of an object's properties name: Sound'Pkg.Group.Name',
// Texture'...' (FireTexture, WetTexture... too), LodMesh'...', each once
export function assetsOf(values) {
  const out = { sounds: [], textures: [], meshes: [] };
  for (const v of values || []) {
    const m = /^\s*(\w+)'([^']+)'\s*$/.exec(String(v ?? ''));
    const list = !m ? null : /^sound$/i.test(m[1]) ? out.sounds : /texture$/i.test(m[1]) ? out.textures : /mesh$/i.test(m[1]) ? out.meshes : null;
    if (list && !list.includes(m[2])) list.push(m[2]);
  }
  return out;
}

// The values the map has for a key, for its autocomplete: from each thing's facts (t: their classes, ref: and name:
// their names), each once whatever its case, in order
export function fieldValues(factsList, key) {
  const k = KEY[key], field = !k ? null : k.field === 'types' ? 'cls' : k.field === 'ref' ? 'name' : k.field;
  if (!field || field === 'is') return [];
  const seen = new Map();
  for (const f of factsList) {
    const v = typeof f[field] === 'function' ? f[field]() : f[field];
    for (const s of [].concat(v ?? [])) if (present(lower(s)) && !seen.has(lower(s))) seen.set(lower(s), String(s));
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// What the autocomplete offers for the piece of the query the caret is in: the tokens while a key is typed (all of
// them in an empty box), then the values of that key (is: its states, t: the kinds' words then values('t'), the
// others values(key)), those starting with what is typed first, at most max. {from, to, items: [{text, label, hint}]}
export function searchSuggestions(text, caret, values = () => [], max = 8) {
  const s = String(text ?? ''), at = Math.max(0, Math.min(s.length, caret ?? s.length));
  const piece = pieces(s).find((p) => p.from <= at && at <= p.to) || { text: '', from: at, to: at };
  const m = /^(-?)([a-z]*)([:=]?)(.*)$/is.exec(piece.text), not = m[1], typed = lower(m[2]);
  const none = { from: piece.from, to: piece.to, items: [] };
  if (!m[3]) {
    if (m[4] || (!typed && s.trim())) return none;             // a word, not a key; after a term, a letter first
    return { ...none, items: SEARCH_KEYS.filter((k) => !k.alias && k.key.startsWith(typed))
      .map((k) => ({ text: `${not}${k.key}:`, label: `${k.key}:`, hint: k.hint })) };
  }
  const k = KEY[typed];
  if (!k) return none;
  const key = k.alias || k.key, want = lower(unquote(m[4]));
  const offered = key === 'is' ? IS_STATES : key === 't' ? [...TYPE_WORDS, ...values('t')] : values(key);
  const seen = new Set(), items = [];
  for (const v of offered) {
    const l = lower(v);
    if (seen.has(l) || !l.includes(want) || l === want) continue;
    seen.add(l);
    items.push({ text: `${not}${k.key}${m[3]}${quoteValue(v)} `, label: String(v), hint: '', first: l.startsWith(want) });
  }
  items.sort((a, b) => b.first - a.first);
  return { ...none, items: items.slice(0, max).map(({ first, ...it }) => it) };
}
// A suggestion put in the query in place of the piece it was for: the new text and where the caret goes (after it;
// a value's space is not doubled when one follows)
export function applySuggestion(text, suggestion, item) {
  const s = String(text ?? ''), after = s.slice(suggestion.to);
  const put = after.startsWith(' ') && item.text.endsWith(' ') ? item.text.slice(0, -1) : item.text;
  const out = s.slice(0, suggestion.from) + put + after;
  return { text: out, caret: suggestion.from + put.length + (put === item.text ? 0 : 1) };
}
