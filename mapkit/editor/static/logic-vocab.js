// The one vocabulary of the level logic (editor/LOGIC.md): what each output and verb is called, the sentence it
// makes, its arguments, the verb that undoes it, the games and the level it belongs to, the words of a mover and the
// first choices of Connect. The data is config/logic.json v2 (logic_catalog.py reads the same); here it becomes the
// sentences the Inspector, the Logic panel, the log and Check map show. Pure: tests/test_logic_vocab.mjs checks every
// sentence against the ones app.js made before (LK_WHEN, LK_VERBS, lkWhenText, lkActText, lkSentence).
//
// The page passes what only it knows, ctx:
//   name(n)            an object as a sentence names it (app.js lkName)
//   family(n)          its family in logic.json ('other' when unknown: lkCatOf)
//   word(n)            what a mover is ('bridge', 'lift'...; none: its family's own words)
//   usable(n)          the player uses it through its Usable settings ("has used")
//   optionText(l)      the text of the computer's option a rule waits for
//   portLabel(n, key)  a script's port ('output:<Id>', 'input:<Id>') as the script names it
//   itemName(cls)      an item as the game names it (the conditions' "JC carries")
import { conditionText } from './conditions.js';
import { EFFECT_KINDS, effectOptions } from './interaction-blocks.js';
import { parseFate, stateLabel } from './state-model.js';

const own = (table, key) => (table && Object.hasOwn(table, key) ? table[key] : undefined);    // not 'constructor'...

// A whole number as links.py builds it (_whole): empty is its default, a fraction is cut, int32 at most.
export function wholeOf(v, dflt) {
  if (v === undefined || v === null || String(v).trim() === '') return dflt;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(-2147483648, Math.min(2147483647, n)) : dflt;
}
// A state's, a counter's or a goal's name as links.py writes it (_game_name, conditions.ident, which conditions.encode
// uses too): an accent dropped (città -> citta), anything but an ASCII letter, a digit or _ made _, a leading digit
// after the fallback and _ (X_3rd_door), 60 characters at most. A blank name stays blank: the game says noname.
export function gameName(s, fallback = 'X') {
  const text = String(s || '').trim();
  if (!text) return '';
  let name = [...text.normalize('NFKD')].filter((ch) => !combining(ch)).join('').replace(/[^A-Za-z0-9_]/gu, '_');
  if (!name || /^[0-9]/.test(name)) name = fallback + '_' + name;
  return name.slice(0, 60);
}
// a character with a combining class, which ident drops (Python's unicodedata.combining; a mark of class 0 becomes _):
// normalising moves it past a mark of the lowest class (U+0334) or of the highest (U+0345), never one of class 0
const combining = (ch) => (ch + '\u0334').normalize('NFD') !== ch + '\u0334' || ('\u0345' + ch).normalize('NFD') !== '\u0345' + ch;
// the select's value of a rule's output and of an action's input: a script's ports are 'output:<Id>' / 'input:<Id>'
export const whenKey = (l) => (l.when === 'output' ? 'output:' + (l.port || '') : l.when);
export const verbKey = (x) => (x.verb === 'input' ? 'input:' + (x.a || '') : x.verb);

// How an argument of each type is read (value: what tests compare) and shown in a sentence (text). bool and place
// are never in a sentence: their text is empty. The types are described in logic.json "types".
const TEXT = { value: (v) => v || '', text: (v) => String(v) };
const TYPES = {
  text: TEXT, state: TEXT, counter: TEXT, goal: TEXT, map: TEXT, tag: TEXT, port: TEXT, choice: TEXT, toggle: TEXT,
  yesno: TEXT, look: TEXT,
  line: { value: TEXT.value, text: (v) => String(v).slice(0, 60) },
  args: { value: TEXT.value, text: (v) => String(v).replace(/;/g, ', ') },
  sound: { value: TEXT.value, text: (v) => String(v).split('.').pop() },
  object: { value: TEXT.value, text: (v, ctx) => ctx.name(v) },
  effect: { value: TEXT.value, text: (v) => String((EFFECT_KINDS.find((e) => e[0] === v) || [v, v])[1]).toLowerCase() },
  colour: { value: TEXT.value, text: (v) => effectOptions(v).colour },
  whole: { value: (v, arg) => wholeOf(v, arg.default ?? 0), text: (n) => String(n) },
  amount: { value: (v, arg) => wholeOf(v, arg.default ?? 0), text: (n) => String(Math.abs(n)) },
  floor: { value: (v) => Math.max(0, wholeOf(v, 0)), text: (n) => String(n) },
  number: { value: (v, arg) => +v || (arg.default ?? 0), text: (n) => String(n) },
  seconds: { value: (v) => +v || 0, text: (n) => (n > 0 ? String(n) : '') },
  button: { value: (v) => +v || 0, text: (n) => String(n + 1) },
  bool: { value: (v, arg) => (v === undefined ? !!arg.default : !!v), text: () => '' },
  place: { value: (v) => (Array.isArray(v) ? v : null), text: () => '' },
};
export const ARG_TYPES = Object.keys(TYPES);

// The words a sentence takes from the page (besides the arguments): of a rule's output, and of an action
const PORT = (ctx, name, key) => (ctx.portLabel ? ctx.portLabel(name, key) : key.split(':')[1] || '?');
const wordOf = (ctx, name) => (ctx.word && ctx.word(name)) || '';
const OUTPUT_WORDS = {
  src: (l, ctx) => ctx.name(l.src),
  port: (l, ctx) => PORT(ctx, l.src, whenKey(l)),
  optionText: (l, ctx) => (ctx.optionText && ctx.optionText(l)) || '',
  usable: (l, ctx) => !!(ctx.usable && ctx.usable(l.src)),
};
const VERB_WORDS = {
  // the object it acts on; objects with a scripting tag are many (its 'many' sentence)
  t: (x, ctx, vocab) => (x.targetTag ? fill(vocab.sentenceParts.tagged, { tag: x.targetTag }) : ctx.name(x.target)),
  family: (x, ctx) => ctx.family(x.target),
  // its label, as the object's family words it: "play it", "sound the alarm"
  verb: (x, ctx, vocab) => vocab.verbLabel(x.verb, ctx.family(x.target), wordOf(ctx, x.target)).toLowerCase(),
  port: (x, ctx) => PORT(ctx, x.target, verbKey(x)),
  // a character's fate in words ("Guard1 · Was killed"), '' for any other state
  fate: (x) => (parseFate(x.a) ? stateLabel({ flag: x.a, is: x.b !== '0' }) : ''),
};
export const SENTENCE_WORDS = { output: Object.keys(OUTPUT_WORDS), verb: Object.keys(VERB_WORDS) };

// A template: {name} is a value ({name:type}: shown as another type), [...] is left out when a value in it is
// empty. values: a function (name, type) -> text, or an object of texts.
export function fill(template, values) {
  const text = typeof values === 'function' ? values : (key) => (own(values, key) === undefined ? '' : String(values[key]));
  const slot = /\{(\w+)(?::(\w+))?\}/g;
  return String(template).replace(/\[([^\]]*)\]|\{(\w+)(?::(\w+))?\}/g, (whole, piece, key, type) => {
    if (piece === undefined) return text(key, type);
    let empty = false;
    const out = piece.replace(slot, (m, k, t) => { const s = text(k, t); if (s === '') empty = true; return s; });
    return empty ? '' : out;
  });
}

// Whether a variant's "if" holds: each name's value is true/false (set or not), equal, one of a list, more ('>')
// or less ('<') than a number, or has a word ('has': a light effect's "red beep exact").
function holds(test, valueOf) {
  return Object.entries(test).every(([key, want]) => {
    const v = valueOf(key);
    if (want === true || want === false) return !!v === want;
    if (Array.isArray(want)) return want.includes(v);
    if (want && typeof want === 'object') {
      if (Object.hasOwn(want, '>')) return Number(v) > want['>'];
      if (Object.hasOwn(want, '<')) return Number(v) < want['<'];
      if (Object.hasOwn(want, 'has')) return String(v).toLowerCase().split(/\s+/).includes(want.has);
      return false;
    }
    return v === want;
  });
}
// a 'say' (or a 'many', a piece): a template, or variants [{if, say}] of which the first that holds is taken
function choose(say, valueOf) {
  if (!Array.isArray(say)) return say ?? '';
  return (say.find((v) => !v.if || holds(v.if, valueOf)) || {}).say ?? '';
}

// The sentence of an entry (an output or a verb) for one rule or action: its words, its arguments by type, its pieces.
function render(entry, say, item, words, ctx, vocab) {
  const argOf = (key) => (entry.args || []).find((a) => a.id === key);
  const valueOf = (key) => {
    if (own(words, key)) return words[key](item, ctx, vocab);
    const arg = argOf(key);
    return arg ? (TYPES[arg.type] || TEXT).value(item[key], arg) : item[key];
  };
  const textOf = (key, type) => {
    const piece = own(entry.pieces, key);
    if (piece !== undefined) return fill(choose(piece, valueOf), textOf);
    if (own(words, key)) return String(words[key](item, ctx, vocab));
    const arg = argOf(key) || {};
    const kind = TYPES[type || arg.type] || TEXT, value = kind.value(item[key], arg);
    if ((value === '' || value === null || value === undefined) && arg.empty !== undefined) return arg.empty;
    return kind.text(value, ctx);
  };
  return fill(choose(say, valueOf), textOf);
}

// the names in a condition's sentence (conditions.js): the map's objects, the states (a character's fate in words),
// the game's items
export function conditionNames(ctx) {
  return { actor: (n) => ctx.name(n), state: (c) => (parseFate(c.flag) ? stateLabel(c) : conditionText(c)), item: ctx.itemName };
}

// The vocabulary of a logic.json v2 (the parsed file).
export function vocabulary(data) {
  const S = data.sentence, LEVELS = data.levels || [], words = (data.movers || {}).words || [];
  const tables = { output: data.outputs || {}, verb: data.inputs || {} };
  const mover = (id) => words.find((w) => w.id === id);
  const family = (id) => (data.families || []).find((f) => f.id === id);
  // an output's or a verb's entry, as a mover word says it when it has one (a bridge: "Lower", not "Open")
  const entry = (kind, id, word) => {
    const base = own(tables[kind], id);
    const over = base && word ? own((mover(word) || {})[kind === 'output' ? 'outputs' : 'verbs'], id) : undefined;
    return over ? { ...base, ...over } : base;
  };
  const vocab = {
    levels: LEVELS, games: data.games || [], sentenceParts: S,
    entry,
    // the menus' and chips' words: LK_WHEN, lkVerbLabel (a family may say a verb its own way: "Play it")
    outputLabel: (when, word) => (entry('output', when, word) || {}).label || when,
    verbLabel(v, family, word) {
      const e = entry('verb', v, word);
      return (e && (own(e.labels, family) || e.label)) || v;
    },
    // the same for a select's value, a script's ports included (the Inspector's "When it..." and "It can...": a
    // script's own output says 'it says "..."')
    whenLabel: (key, src, ctx) => (key.startsWith('output:') ? fill(entry('output', 'output').port, { port: PORT(ctx, src, key) })
      : vocab.outputLabel(key, wordOf(ctx, src))),
    inputLabel: (key, target, ctx) => (key.startsWith('input:') ? PORT(ctx, target, key)
      : vocab.verbLabel(key, ctx.family(target), wordOf(ctx, target))),
    // the kind of object a verb acts on ('' none: LK_VERBS[v][1]), and a family's kind as a sentence names it
    acts: (v) => (entry('verb', v) || {}).acts || '',
    noun: (id, word) => (word && (mover(word) || {}).noun) || (family(id) || {}).noun || '',
    // "When the player uses Button1", "open Door3", the whole rule
    whenText(l, ctx) {
      const e = entry('output', l.when, wordOf(ctx, l.src)) || entry('output', 'any');
      return fill(S.when, { say: render(e, e.say, l, OUTPUT_WORDS, ctx, vocab) });
    },
    actText(x, ctx) {
      if (x.area) {
        const a = x.area;
        return fill(S.area, { verb: vocab.verbLabel(x.verb, a.kind).toLowerCase(), count: a.members.length,
          members: own(S.members, a.kind) ?? S.members.object, radius: a.dynamic ? String(a.radius) : '' });
      }
      const e = entry('verb', x.verb, wordOf(ctx, x.target));
      if (!e) return x.verb || '';
      return render(e, x.targetTag && e.many ? e.many : e.say, x, VERB_WORDS, ctx, vocab);
    },
    // a list of actions in the order the game runs them (links.blocks sorts them by delay): "after 2 s open Door3, ..."
    // ('' for none); a rule's "do", its "otherwise" (the Logic window's Read view)
    steps: (acts, ctx) => [...(acts || [])].sort((x, y) => (+x.delay || 0) - (+y.delay || 0))
      .map((x) => fill(S.step, { delay: +x.delay > 0 ? +x.delay : '', act: vocab.actText(x, ctx) })).join(S.steps),
    sentence(l, ctx) {
      const names = conditionNames(ctx);
      return fill(S.rule, { when: vocab.whenText(l, ctx), checks: (l.requires || []).map((c) => conditionText(c, names)).join(S.checks),
        steps: vocab.steps(l.do, ctx) || S.nothing, once: l.once ? S.once : '' });
    },
    // the verb that undoes it ('' none), what an output or a verb takes
    inverse: (v) => (entry('verb', v) || {}).inverse || '',
    args: (kind, id) => (entry(kind, id) || {}).args || [],
    // the disclosure level and the games of an output or a verb ('verb' | 'output'); one the catalogue does not
    // know is advanced
    levelOf: (kind, id) => (entry(kind, id) || {}).level || LEVELS[LEVELS.length - 1] || '',
    gamesOf: (kind, id) => (entry(kind, id) || {}).games || [],
    worksIn: (kind, id, game) => vocab.gamesOf(kind, id).includes(game),
    shownAt: (kind, id, level) => LEVELS.indexOf(vocab.levelOf(kind, id)) <= LEVELS.indexOf(level),
    // Outputs and verbs whose label, keywords or id have every word typed ("kill" finds Attack JC), shown at the
    // level and working in the game asked for: [{kind, id, label}], outputs first, in the catalogue's order.
    search(text, { level = LEVELS[LEVELS.length - 1], game = '' } = {}) {
      const want = String(text).toLowerCase().split(/\s+/).filter(Boolean);
      const found = (id, e) => { const hay = [e.label, ...(e.kw || []), id].join(' ').toLowerCase(); return want.every((w) => hay.includes(w)); };
      return Object.entries(tables).flatMap(([kind, table]) => Object.entries(table)
        .filter(([id, e]) => vocab.shownAt(kind, id, level) && (!game || vocab.worksIn(kind, id, game)) && found(id, e))
        .map(([id, e]) => ({ kind, id, label: e.label || id })));
    },
    // The first choices of Connect from an object of one family to one of another, the likeliest first:
    // [{when, do: [verbs], ask: [ids of data.asks]}]. A pair with no 'when' takes the source's first output; a pair
    // the families do not offer is left out. [] when none: Connect keeps its own first output and first input.
    pairs(from, to) {
      const src = family(from), dst = family(to);
      if (!src || !dst) return [];
      const listed = [...(own(own(data.pairs, from), to) || []), ...(own(own(data.pairs, 'any'), to) || [])]
        .map((p) => ({ ...p, when: p.when || src.outputs[0] }))
        .filter((p) => p.when && src.outputs.includes(p.when) && p.do.every((v) => dst.inputs.includes(v)));
      const same = (p, q) => p.when === q.when && p.do.length === q.do.length && p.do.every((v, j) => v === q.do[j]);
      return listed.filter((p, i) => listed.findIndex((q) => same(p, q)) === i);
    },
    ask: (id) => own(data.asks, id) || null,
    // what a mover can be (the Inspector's "This mover is a..."), the first the usual one, and the families that ask
    movers: () => words,
    moverFamilies: () => (data.movers || {}).families || [],
  };
  return vocab;
}
