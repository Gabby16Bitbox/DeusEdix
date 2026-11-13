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
import { conditionText, comesText, AUGS } from './conditions.js';
import { FLOW, flowText, stepsText } from './action-list.js';
import { EFFECT_KINDS, effectOptions } from './interaction-blocks.js';
import { parseFate, stateLabel } from './state-model.js';
import { gameName, isFormula, valueText } from './logic-numbers.js';

const own = (table, key) => (table && Object.hasOwn(table, key) ? table[key] : undefined);    // not 'constructor'...

// A whole number as links.py builds it (_whole): empty is its default, a fraction is cut, int32 at most.
export function wholeOf(v, dflt) {
  if (v === undefined || v === null || String(v).trim() === '') return dflt;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(-2147483648, Math.min(2147483647, n)) : dflt;
}
// A state's, a counter's or a goal's name as links.py writes it: logic-numbers.js (the formulas' names are the same)
export { gameName };
// the select's value of a rule's output and of an action's input: a script's ports are 'output:<Id>' / 'input:<Id>'
export const whenKey = (l) => (l.when === 'output' ? 'output:' + (l.port || '') : l.when);
export const verbKey = (x) => (x.verb === 'input' ? 'input:' + (x.a || '') : x.verb);

// How an argument of each type is read (value: what tests compare) and shown in a sentence (text). bool and place
// are never in a sentence: their text is empty. The types are described in logic.json "types".
const TEXT = { value: (v) => v || '', text: (v) => String(v) };
const TYPES = {
  text: TEXT, state: TEXT, counter: TEXT, goal: TEXT, map: TEXT, tag: TEXT, port: TEXT, choice: TEXT, toggle: TEXT,
  yesno: TEXT, look: TEXT,
  line: { value: TEXT.value, text: (v) => clipLine(v) },
  args: { value: TEXT.value, text: (v) => String(v).replace(/;/g, ', ') },
  sound: { value: TEXT.value, text: (v) => String(v).split('.').pop() },
  object: { value: TEXT.value, text: (v, ctx) => ctx.name(v) },
  effect: { value: TEXT.value, text: (v) => String((EFFECT_KINDS.find((e) => e[0] === v) || [v, v])[1]).toLowerCase() },
  colour: { value: TEXT.value, text: (v) => effectOptions(v).colour },
  // a whole number, or (P9 slice 5) a formula of counters kept as its text ("Alarms + 1")
  whole: { value: (v, arg) => (isFormula(v) ? valueText(v) : wholeOf(v, arg.default ?? 0)), text: (n) => String(n) },
  amount: { value: (v, arg) => (isFormula(v) ? valueText(v) : wholeOf(v, arg.default ?? 0)), text: (n) => (typeof n === 'string' ? n : String(Math.abs(n))) },
  floor: { value: (v) => Math.max(0, wholeOf(v, 0)), text: (n) => String(n) },
  number: { value: (v, arg) => +v || (arg.default ?? 0), text: (n) => String(n) },
  seconds: { value: (v) => +v || 0, text: (n) => (n > 0 ? String(n) : '') },
  button: { value: (v) => +v || 0, text: (n) => String(n + 1) },
  bool: { value: (v, arg) => (v === undefined ? !!arg.default : !!v), text: () => '' },
  place: { value: (v) => (Array.isArray(v) ? v : null), text: () => '' },
  // P4: a share of a whole, a class of the game (Package.Class: its own name), a crate's items with their weights,
  // a colour #rrggbb, another rule, a kind of harm
  percent: { value: (v, arg) => Math.max(0, Math.min(100, wholeOf(v, arg.default ?? 0))), text: (n) => String(n) },
  itemclass: { value: TEXT.value, text: (v) => className(v) },
  pawnclass: { value: TEXT.value, text: (v) => className(v) },
  song: { value: TEXT.value, text: (v) => className(v) },
  items: { value: TEXT.value, text: (v) => String(v).split(';').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [c, w] = s.split(':'); return className(c) + (w && +w !== 1 ? ` (×${+w || 0} as likely)` : ''); }).join(', ') },
  hex: { value: TEXT.value, text: (v) => colourName(v) },
  rule: { value: TEXT.value, text: (v, ctx) => (ctx.ruleLabel ? ctx.ruleLabel(v) : String(v)) },
  hurtkind: { value: TEXT.value, text: (v) => ({ fire: 'fire', poison: 'poison gas', shock: 'electricity', radiation: 'radiation' })[v] || String(v) },
  // P3: a signal's name (any rule sends it, any rule waits for it)
  signal: { value: TEXT.value, text: (v) => String(v) },
  // P5: a dialogue, an InfoLink of the map's Story by its id: its title (ctx.storyTitle(key, id))
  dialogue: { value: TEXT.value, text: (v, ctx) => `"${ctx.storyTitle ? ctx.storyTitle('dialogues', v) : v}"` },
  infolink: { value: TEXT.value, text: (v, ctx) => `"${ctx.storyTitle ? ctx.storyTitle('infolinks', v) : v}"` },
  // P9 slice 4: an augmentation by its class's name (its name on the augmentation screen), a faction (Player: the
  // player), a property of the safe list (its words, vocabulary() reads them from the table), its value (yes / no)
  aug: { value: TEXT.value, text: (v) => (AUGS.find((x) => x[0].toLowerCase() === String(v).toLowerCase()) || [v, className(v)])[1] },
  faction: { value: TEXT.value, text: (v) => (String(v).toLowerCase() === 'player' ? 'the player' : String(v)) },
  prop: { value: TEXT.value, text: (v) => PROP_WORDS.get(String(v).toLowerCase()) || className(String(v).replace(/^b(?=[A-Z])/, '')).toLowerCase() },
  propvalue: { value: TEXT.value, text: (v) => ({ true: 'yes', false: 'no', 1: 'yes', 0: 'no' })[String(v).toLowerCase()] || String(v) },
};
// a safe property's words by its name, any case (config/logic.json safeProps, set by vocabulary())
const PROP_WORDS = new Map();
// "DeusEx.WeaponPistol" -> "Weapon Pistol"
function className(v) {
  const n = String(v || '').split('.').pop();
  return n.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}
// a colour as a word when it is near one ("red"), else its #rrggbb
function colourName(v) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim());
  if (!m) return String(v || '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const NAMED = [['red', 255, 48, 32], ['orange', 255, 140, 0], ['yellow', 255, 230, 40], ['green', 40, 220, 60], ['cyan', 40, 220, 230],
    ['blue', 40, 80, 255], ['purple', 160, 60, 230], ['pink', 255, 100, 190], ['white', 255, 255, 255]];
  const near = NAMED.map(([n, R, G, B]) => [n, (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2]).sort((x, y) => x[1] - y[1])[0];
  return near[1] < 3600 ? near[0] : '#' + m[1].toLowerCase();
}
export const ARG_TYPES = Object.keys(TYPES);

// The words a sentence takes from the page (besides the arguments): of a rule's output, and of an action
const PORT = (ctx, name, key) => (ctx.portLabel ? ctx.portLabel(name, key) : key.split(':')[1] || '?');
// a line of text in a sentence: a long one cut after a whole word, with "…" (12 Nov 2026: 'Find the reset button in
// the sec"', cut in the middle of a word with nothing to say so)
function clipLine(v, max = 60) {
  const s = String(v ?? '');
  if (s.length <= max + 4) return s;
  const cut = s.slice(0, max), space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '') + '…';
}
const wordOf = (ctx, name) => (ctx.word && ctx.word(name)) || '';
const OUTPUT_WORDS = {
  // a rule started by any of a named group (P3: l.group, edits.logic.groups): the group, not its first member
  src: (l, ctx, vocab) => (l.group ? fill(vocab.sentenceParts.anyOfGroup, { group: groupName(l.group, ctx) }) : ctx.name(l.src)),
  port: (l, ctx) => PORT(ctx, l.src, whenKey(l)),
  optionText: (l, ctx) => (ctx.optionText && ctx.optionText(l)) || '',
  usable: (l, ctx) => !!(ctx.usable && ctx.usable(l.src)),
  // what a "becomes true" / "changes" rule watches: a condition, or a state or a counter
  watch: (l, ctx) => {
    const w = l.watch && typeof l.watch === 'object' ? l.watch : null;
    if (!w) return '?';
    if (l.when === 'changes') return w.counter ? `the counter ${w.counter}` : w.flag ? `the state ${w.flag}` : '?';
    return conditionText(w, ctx.names || {});
  },
};
// a named group's name as the page knows it (ctx.groupName), else its id
const groupName = (id, ctx) => (ctx.groupName && ctx.groupName(id)) || String(id);
// words ending "the <noun>" ("sound the alarm") and an object whose name has that noun ("Vault alarm", "the alarm")
export const namesItself = (words, name) => {
  const noun = /\bthe (\w+)$/.exec(String(words));
  return !!noun && String(name).toLowerCase().split(/\W+/).includes(noun[1].toLowerCase());
};
const VERB_WORDS = {
  // the object it acts on; objects with a scripting tag are many (its 'many' sentence)
  // a named group (P3: x.group) is many too
  t: (x, ctx, vocab) => (x.group ? fill(vocab.sentenceParts.grouped, { group: groupName(x.group, ctx) })
    : x.targetTag ? fill(vocab.sentenceParts.tagged, { tag: x.targetTag }) : ctx.name(x.target)),
  family: (x, ctx) => ctx.family(x.target),
  // its label, as the object's family words it: "play it", "sound the alarm"
  verb: (x, ctx, vocab) => vocab.verbLabel(x.verb, ctx.family(x.target), wordOf(ctx, x.target)).toLowerCase(),
  port: (x, ctx) => PORT(ctx, x.target, verbKey(x)),
  // the phase a Phases block is sent to, as its list writes it ("Chase"), '' for any other input (13 Nov 2026: steps
  // said "Phases: Go to the phase 'Chase'"; now "move NavarreHunt phases to 'Chase'")
  phaseto: (x, ctx) => {
    if (x.verb !== 'input' || !/^GoTo_/.test(x.a || '') || ctx.family(x.target) !== 'phases') return '';
    const m = /'(.*)'$/.exec(PORT(ctx, x.target, verbKey(x)) || '');
    return m ? m[1] : String(x.a).slice(5);
  },
  // where it is sent, by what stands there ("Path Node 2", ctx.placeName), else "a place" (13 Nov 2026: the graph's
  // cards said "runs to a place" for every run)
  where: (x, ctx) => (Array.isArray(x.at) && ctx.placeName && ctx.placeName(x.at)) || 'a place',
  // a character's fate in words ("Guard1 · Was killed"), '' for any other state
  fate: (x) => (parseFate(x.a) ? stateLabel({ flag: x.a, is: x.b !== '0' }) : ''),
  // the verb and its object as one phrase: "switch on Vault alarm", "play Siren1" (a family's "Play it"); "sound the
  // alarm: Alarm1" when its words have no place for the object (12 Nov 2026: "switch on: Vault alarm")
  verbt: (x, ctx, vocab) => {
    const v = VERB_WORDS.verb(x, ctx, vocab), t = VERB_WORDS.t(x, ctx, vocab);
    if (/\bit$/.test(v)) return v.replace(/\bit$/, t);
    if (/^(switch|turn) (on|off)$/.test(v)) return `${v} ${t}`;
    // an object named for what the words say already: "sound Vault alarm", not "sound the alarm: Vault alarm" (13 Nov 2026)
    if (namesItself(v, t)) return v.replace(/\bthe \w+$/, t);
    return `${v}: ${t}`;
  },
  // a goal by what the player reads, from the step that gave it (ctx.goalText), else by its name (12 Nov 2026: 'the
  // goal "Goal1" completed')
  goaltext: (x, ctx) => clipLine((ctx.goalText && ctx.goalText(x.a)) || String(x.a ?? '')),
};
// a goal's text by its name, from the rules' steps that give it (logic.json "goal": a its name, b what the player reads)
export function goalTexts(rules) {
  const texts = new Map();
  for (const l of rules || []) {
    for (const x of [...(l.do || []), ...(l.else || [])]) {
      if (x && x.verb === 'goal' && x.a && String(x.b || '').trim() && !texts.has(x.a)) texts.set(x.a, String(x.b).trim());
    }
  }
  return (name) => texts.get(name) || '';
}
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
  return { actor: (n) => ctx.name(n), state: (c) => (parseFate(c.flag) ? stateLabel(c) : conditionText(c)), item: ctx.itemName,
    place: ctx.names?.place || ctx.place };
}

// The vocabulary of a logic.json v2 (the parsed file).
export function vocabulary(data) {
  const S = data.sentence, LEVELS = data.levels || [], words = (data.movers || {}).words || [];
  for (const props of Object.values(data.safeProps || {})) for (const [n, w] of props) PROP_WORDS.set(n.toLowerCase(), w);
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
      // a rule that holds "while" (P3) says the lasting state: "While the player is in Zone1"
      if (l.while && e.while && vocab.untilOf(l)) return fill(S.while, { say: render(e, e.while, l, OUTPUT_WORDS, ctx, vocab) });
      // a script's or a logic block's output has no lasting state: "From when Counter1 says "..." until it says "...""
      const until = l.while && l.when === 'output' && S.whileport ? vocab.untilOf(l) : null;
      if (until) return fill(S.whileport, { say: render(e, e.say, l, OUTPUT_WORDS, ctx, vocab), until: PORT(ctx, l.src, 'output:' + until.port) });
      // a condition that says how it comes true: the player coming near a point (P5: "When the player comes within 256
      // units of the point by Door2"), the player's own (P9: "When the player's energy falls below 20")
      const comes = l.when === 'becomes' && !l.while && l.watch ? comesText(l.watch, ctx.names || {}) : null;
      if (comes) return fill(S.when, { say: comes });
      return fill(S.when, { say: render(e, e.say, l, OUTPUT_WORDS, ctx, vocab) });
    },
    // What ends a "while" on a cause (links.py until_of): {when, port} of the same object, {when: 'becomes'} for a
    // condition (its opposite: action-list.js negate), null when nothing does
    untilOf(c) {
      if (!c || !c.when) return null;
      if (c.when === 'output') {
        const port = String(c.port || '');
        for (const [start, end] of Object.entries(data.untilPorts || {})) {
          if (start.endsWith('*') && port.startsWith(start.slice(0, -1)) && port.length > start.length - 1) return { when: 'output', port: end.slice(0, -1) + port.slice(start.length - 1) };
          if (port === start) return { when: 'output', port: end };
        }
        return null;
      }
      const until = (own(tables.output, c.when) || {}).until;
      return until ? { when: until, port: c.port } : null;
    },
    actText(x, ctx) {
      // a step of a list of steps (If, Otherwise, End, Wait until): action-list.js says it
      if (FLOW.has(x.verb)) return flowText(x, { name: (n) => ctx.name(n), cond: (c) => conditionText(c, conditionNames(ctx)), storyTitle: ctx.storyTitle });
      if (x.area) {
        const a = x.area;
        return fill(S.area, { verb: vocab.verbLabel(x.verb, a.kind).toLowerCase(), count: a.members.length,
          members: own(S.members, a.kind) ?? S.members.object, radius: a.dynamic ? String(a.radius) : '' });
      }
      const e = entry('verb', x.verb, wordOf(ctx, x.target));
      if (!e) return x.verb || '';
      return render(e, (x.targetTag || x.group) && e.many ? e.many : e.say, x, VERB_WORDS, ctx, vocab);
    },
    // a list of actions in the order the game runs them (links.blocks sorts them by delay): "after 2 s open Door3, ..."
    // ('' for none); a rule's "do", its "otherwise" (the Logic window's Read view)
    steps: (acts, ctx) => [...(acts || [])].sort((x, y) => (+x.delay || 0) - (+y.delay || 0))
      .map((x) => fill(S.step, { delay: +x.delay > 0 ? +x.delay : '', act: vocab.actText(x, ctx) })).join(S.steps),
    sentence(l, ctx) {
      const names = conditionNames(ctx);
      return fill(S.rule, { when: vocab.whenText(l, ctx), checks: (l.requires || []).map((c) => conditionText(c, names)).join(S.checks),
        steps: (l.steps ? stepsText(l, (x) => vocab.actText(x, ctx), { name: (n) => ctx.name(n), cond: (c) => conditionText(c, names), storyTitle: ctx.storyTitle })
          : vocab.steps(l.do, ctx)) || S.nothing, once: l.once ? S.once : '' });
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
      const found = (id, e) => { const hay = [e.label, ...(e.kw || []), id].join(' ').toLowerCase().split(/[^a-z0-9]+/); return want.every((w) => hay.some((h) => h.startsWith(w))); };   // a word's start: "kill" not "skill"
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
