// The command palette's search (Ctrl+K, as Unity's Search window; command-palette.js shows it): one query over the
// menus' commands, the map's objects, the Objects browser's classes, textures, sounds, the Settings pages and the
// panels. A query that starts with > looks only at the commands, with @ only at the map's objects; one with a token of
// the Hierarchy's search (t:, tag:, is:... scene-search.js) is a search of the map's objects too. The map's objects are
// found as the Hierarchy's search finds them (app.js), the words then only order them; the rest is found fuzzily: the
// letters of each word in their order (rbl finds Rebuild lighting), better at the start of a word and one after the
// other, and every word must be found. Each kind of result is a group, the best group first. And the last queries,
// kept per project. Without the page: the sources come from app.js and menubar.js.
import { SEARCH_KEYS, parseSearch, searchSuggestions, applySuggestion } from './scene-search.js';

// The kinds of results, in the order they come when they match as well. found: its source finds its own (the map's
// objects, by the Hierarchy's search), the words only order them; prefix: the one that shows only this kind
export const PALETTE_GROUPS = Object.freeze([
  { id: 'command', title: 'Commands', prefix: '>' },
  { id: 'object', title: 'In this map', prefix: '@', found: true },
  { id: 'class', title: 'Place an object' },
  { id: 'texture', title: 'Textures' },
  { id: 'sound', title: 'Sounds' },
  { id: 'setting', title: 'Settings' },
  { id: 'panel', title: 'Panels' },
].map(Object.freeze));
const BY_PREFIX = Object.fromEntries(PALETTE_GROUPS.filter((g) => g.prefix).map((g) => [g.prefix, g.id]));
// how many of a group a search of everything shows (a search of one kind shows every one it finds)
export const SHOWN = Object.freeze({ all: 5 });
export const RECENT_MAX = 20;
const RECENT_LENGTH = 200;                // a longer query is not kept

// what a score is made of: a letter found, more at the start of a word, after the letter before, at the start of
// the text; the whole text; a little less for each letter of a longer text (up to LONGEST); a word found in another
// text of an item than its label counts that much; the query at the start of the label (half: inside it)
const LETTER = 1, START = 5, NEXT = 3, FIRST = 2, WHOLE = 20, LENGTH = 0.05, LONGEST = 100, OTHER = 0.8, PHRASE = 15;

const TOKEN = /^-?([a-z]+)[:=]/i;
const isToken = (piece) => { const m = TOKEN.exec(piece); return !!m && SEARCH_KEYS.some((k) => k.key === m[1].toLowerCase()); };

// A query read: scope (all, command or object), text (the query without its prefix, from where it starts in the
// query), words (lower case, for the fuzzy search: a word with a - before it and the tokens are the Hierarchy
// search's alone) and empty (nothing to look for yet: a token still without its value is nothing yet)
export function readQuery(raw) {
  const s = String(raw ?? ''), lead = s.length - s.trimStart().length, prefix = BY_PREFIX[s[lead]];
  const from = prefix ? s.length - s.slice(lead + 1).trimStart().length : lead;
  const text = s.slice(from), search = parseSearch(text);
  const words = search.terms.filter((t) => t.word !== undefined && !t.not).map((t) => t.word);
  return { scope: prefix || (text.split(/\s+/).some(isToken) ? 'object' : 'all'), text, from, words, empty: search.empty };
}

const ALNUM = /[a-z0-9]/i, UPPER = /[A-Z]/, LOWER = /[a-z]/, DIGIT = /[0-9]/;
// where a word of a text starts: its first letter, after a space or a sign, a capital after a small letter
// (DeusExMover), a digit after a letter
function wordStart(s, i) {
  if (!i) return true;
  const a = s[i - 1], b = s[i];
  return !ALNUM.test(a) || (UPPER.test(b) && LOWER.test(a)) || (DIGIT.test(b) && !DIGIT.test(a));
}

// How well a word is found in a text: null when its letters are not all there in their order; else more for its
// letters at the start of the text's words and one after the other, the most for the whole text, a little less for
// a longer text. The best placing of the letters is looked for (rl in Rebuild lighting: its two capitals)
export function fuzzyScore(word, text) {
  const w = String(word ?? '').toLowerCase(), own = String(text ?? ''), t = own.toLowerCase(), n = t.length;
  const s = own.length === n ? own : t;     // a letter whose small form is longer: the capitals are not looked at
  if (!w) return 0;
  for (let i = 0, j = -1; i < w.length; i++) if ((j = t.indexOf(w[i], j + 1)) < 0) return null;   // most texts fail here
  // best[j]: the score of the letters so far, the last one at j
  let best = [];
  for (let i = 0; i < w.length; i++) {
    const next = new Array(n).fill(-Infinity);
    let far = -Infinity;                    // the best of the letter before, two places back or more
    for (let j = i; j < n; j++) {
      if (i && j >= 2) far = Math.max(far, best[j - 2]);
      if (t[j] !== w[i]) continue;
      const here = LETTER + (wordStart(s, j) ? START : 0);
      next[j] = i ? here + Math.max(far, best[j - 1] + NEXT) : here + (j ? 0 : FIRST);
    }
    best = next;
  }
  return Math.max(...best) / w.length * 10 + (t === w ? WHOLE : 0) - Math.min(n, LONGEST) * LENGTH;
}

// How well the words are found in an item's texts (the first one, its label, counts most): each word in its best
// text, null when one is in none; more when the label starts with the words as typed (less: has them inside)
export function itemScore(words, texts) {
  let total = 0;
  for (const w of words) {
    let best = null;
    texts.forEach((x, i) => {
      const s = fuzzyScore(w, x);
      if (s !== null && (best === null || s * (i ? OTHER : 1) > best)) best = s * (i ? OTHER : 1);
    });
    if (best === null) return null;
    total += best;
  }
  const label = String(texts[0] ?? '').toLowerCase(), phrase = words.join(' ');
  return total + (!phrase ? 0 : label.startsWith(phrase) ? PHRASE : label.includes(phrase) ? PHRASE / 2 : 0);
}

// The results of a query (readQuery) in its sources ({group id: [{texts: [label, other texts...], disabled}]}): each
// group it looks at with its items best first (what cannot run now after the rest; the order they came in for the
// same score), at most `limit` of them (more: how many are left out), the group with the best item first. A search of
// everything with nothing to look for finds nothing; a search of one kind has no limit, and its prefix alone lists its
// whole group in its own order.
export function rankPalette(query, sources, limit = query.scope === 'all' ? SHOWN.all : Infinity) {
  if (query.scope === 'all' && query.empty) return [];
  const out = [];
  PALETTE_GROUPS.forEach((g, order) => {
    if (query.scope !== 'all' && query.scope !== g.id) return;
    const found = [];
    (sources[g.id] || []).forEach((item, at) => {
      const score = query.words.length ? itemScore(query.words, item.texts || []) : 0;
      if (score !== null || g.found) found.push({ item, score: score ?? 0, at });
    });
    if (!found.length) return;
    found.sort((a, b) => !!a.item.disabled - !!b.item.disabled || b.score - a.score || a.at - b.at);
    const best = found[0].item.disabled ? -Infinity : found[0].score;
    out.push({ id: g.id, title: g.title, prefix: g.prefix || '', items: found.slice(0, limit).map((x) => x.item),
      more: Math.max(0, found.length - limit), best, order });
  });
  return out.sort((a, b) => b.best - a.best || a.order - b.order).map(({ best, order, ...g }) => g);
}

// What the Hierarchy's autocomplete offers (scene-search.js) in a search of the map's objects, at the caret of the
// whole query, values(key): what the map has for a key. null: nothing; else {items, put(item)}: the query and its
// caret with that one put in
export function paletteSuggestions(raw, caret, values = () => []) {
  const q = readQuery(raw), s = String(raw ?? '');
  if (q.scope !== 'object' || caret < q.from) return null;
  const offer = searchSuggestions(q.text, caret - q.from, values);
  if (!offer.items.length) return null;
  return { items: offer.items, put(item) {
    const r = applySuggestion(q.text, offer, item);
    return { text: s.slice(0, q.from) + r.text, caret: q.from + r.caret };
  } };
}

// The next row the arrows choose (step 1 or -1) from row `at` (-1: none yet) among rows that cannot all be chosen
// (off[i]: row i cannot), round again past the last; -1 when none can
export function stepRow(off, at, step) {
  const n = off.length;
  for (let k = 1; k <= n; k++) {
    const i = (((at < 0 && step < 0 ? n : at) + step * k) % n + n) % n;
    if (!off[i]) return i;
  }
  return -1;
}

// The last queries as kept (JSON): queries, at most RECENT_MAX, what is not one left out
export function readRecent(text) {
  let d;
  try { d = JSON.parse(text || '[]'); } catch { return []; }
  return Array.isArray(d) ? d.filter((q) => typeof q === 'string' && q.trim() && q.length <= RECENT_LENGTH).slice(0, RECENT_MAX) : [];
}
// The last queries with this one first (once, whatever its case), at most RECENT_MAX; an empty or too long one is
// not kept
export function withRecent(list, query) {
  const q = String(query ?? '').trim();
  if (!q || q.length > RECENT_LENGTH) return list;
  return [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
}
