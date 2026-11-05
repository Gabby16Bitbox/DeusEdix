// What the Logic window draws (editor/LOGIC.md; the design: backup/20261027_logic_graph/final_design.json, "data_model"
// and "ux_walkthrough" C, D, H): a projection of the map's rules (edits.links) and of the logic's own items
// (edits.logic), never a second store. Thing nodes show only the pins in use, rule cards their cause, badges, "only
// if" chips and "do" rows; a simple rule is a labelled wire; the Story and the original game wiring are read only.
// Pure: tests/test_logic_graph_model.mjs. logic-graph-problems.js finds what is wrong, logic-graph-read.js says it
// all as prose.
//
// The page passes plain data, input:
//   catalog     config/logic.json v2, parsed (logic_catalog.vocabulary())
//   edits       the map's edits, read only: links, logic, usable, disabled, deleted
//   actors      {name: {family, outputs, inputs, labels, title, label, word, at, locked, frobbable, options}} for the
//               objects the rules, the Story and the game wiring name: outputs, what can start a rule on it (app.js
//               lkEventsOf); inputs, what a rule can make it do (its animation verbs first, as lkRuleHtml offers them);
//               labels, a script's ports as it names them; title, the object as a sentence names it (lkName); label,
//               its own name (FamiliarName); word, what a mover is; locked and frobbable, a door's bLocked and
//               bFrobbable; options, a computer's option texts
//   items       {cls: name}: the game's items as the conditions name them
//   story       the map's Story {dialogues, infolinks, events}; storyFlags {playedFlag(d), heardFlag(il)} (story.js)
//   wiring      the original game wiring: [{from, to, why}] (app.js linksOf, its 'out' links)
//   tags        {TAG: [names]}: the objects a scripting tag reaches (lkTagTargets)
//   external    the project's state catalog (/api/state_catalog): [{flag, source, type, uses: [{map, context, kind}]}]
//   map         the map's name
import { vocabulary, fill, whenKey, verbKey, conditionNames, gameName } from './logic-vocab.js';
import { conditionText, conditionProblem, kindOf, CONDITION_KINDS } from './conditions.js';
import { collectDraftStates } from './story-state.js';
import { parseFate, flagCategory, stateLabel } from './state-model.js';
import { graphIndex, neighbourhood } from './mission-graph-model.js';

const own = (table, key) => (table && Object.hasOwn(table, key) ? table[key] : undefined);    // not 'constructor'...
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

// ---------------------------------------------------------------- ids
// Node keys are always qualified (the design's "References"): obj:Door3, rule:L7, the logic's own items (PIECE_KINDS:
// blk:B1, grp:G1, sig:Alarm, ph:Base, pt:P1), the Story's (STORY_KINDS: dlg:d4, info:i2, story:e3), world; a group a
// rule makes on the spot (GROUP_KINDS: area:L7/a2 a radius, tag:MONSTER a scripting tag). An action's wire is
// act:L7/a2, a collapsed rule's wire rule:L7. The prefixes are written once, in these tables.
// edits.logic's lists, the prefix of their node keys and the kind of node they make
export const PIECE_KINDS = { blocks: ['blk:', 'block'], phases: ['ph:', 'phase'], signals: ['sig:', 'signal'], groups: ['grp:', 'group'], points: ['pt:', 'point'] };
// the Story's lists, the prefix of their node keys, the kind of node, how a sentence names one
export const STORY_KINDS = [['dialogues', 'dlg:', 'dialogue', 'dialogue'], ['infolinks', 'info:', 'infolink', 'InfoLink'], ['events', 'story:', 'storyrule', 'Story event']];
// the groups an action makes on the spot: the prefix of their node keys
export const GROUP_KINDS = { area: 'area:', tag: 'tag:' };
const OBJECT = 'obj:';
const PREFIXES = [...Object.values(PIECE_KINDS).map(([prefix]) => prefix), ...STORY_KINDS.map(([, prefix]) => prefix), ...Object.values(GROUP_KINDS)];
const QUALIFIED = new RegExp(`^(${PREFIXES.map((p) => p.replace(/\W/g, '\\$&')).join('|')})`);
export const thingId = (name) => (!name ? 'world' : QUALIFIED.test(name) ? name : OBJECT + name);
export const ruleId = (id) => 'rule:' + id;
export const actId = (rule, act) => `act:${rule}/${act}`;
// the node key of an item of edits.logic ('blocks', 'B1'), of the Story ('dialogues', 'd1')
export const pieceId = (key, id) => PIECE_KINDS[key][0] + id;
export const storyId = (key, id) => STORY_KINDS.find(([k]) => k === key)[1] + id;
const isGroup = (id) => Object.values(GROUP_KINDS).some((prefix) => id.startsWith(prefix));

// The ids of a list of actions (a1, a2... the "otherwise" list e1, e2...): one keeps the id it has, one without takes
// the first free, in order, as the Story Graph gives its steps theirs (story-graph.js ensureIds).
export function actionIds(acts, prefix = 'a') {
  const used = new Set(acts.map((x) => x.id).filter(Boolean));
  let k = 1;
  return acts.map((x) => {
    if (x.id) return x.id;
    while (used.has(prefix + k)) k++;
    used.add(prefix + k);
    return prefix + k;
  });
}
// writes them: every action of every rule gets its id (the first time a map opens: they are saved with it)
export function ensureActionIds(links) {
  for (const l of list(links)) {
    for (const [key, prefix] of [['do', 'a'], ['else', 'e']]) {
      const acts = list(l[key]);
      actionIds(acts, prefix).forEach((id, j) => { acts[j].id = id; });
    }
  }
  return links;
}

// ---------------------------------------------------------------- what a field away from its default shows
// Every field a rule can have (links.py: its docstring, blocks() and act_string(); editor/LOGIC.md; the design's
// version 2 fields), where a value away from its default shows: 'cause' (the cause's words; on a collapsed wire a
// badge), 'chips' (the only-if row), 'rows' (the do rows), a badge (its text), or nowhere, with the reason. needs: the
// runtime that runs it ('' today's UCLink; until then the badge is greyed out and Check map says so). absent: the
// value links.py builds when the rule leaves the field out, shown as that.
const V2 = 'Logic runtime v2';
export const RULE_FIELDS = {
  id: { shown: 'the dim id beside the cause' },
  src: { shown: 'cause' },
  when: { shown: 'cause' },
  // a computer's option and how near: in the cause's words, and a badge on a collapsed wire
  option: { shown: 'cause', applies: (l) => l.when === 'option', absent: 0, wire: (v, l, ix) => ix.ctx.optionText(l) || `button ${(+v || 0) + 1}` },
  near: { shown: 'cause', applies: (l) => l.when === 'near', absent: 256, wire: (v) => `within ${+v || 256}` },
  port: { shown: 'cause', applies: (l) => l.when === 'output' },
  requires: { shown: 'chips' },
  do: { shown: 'rows' },
  once: { dflt: false, badge: () => '1×', title: 'Only once' },
  label: { none: 'made again from the rule (lkFixLabels), saved for the log' },
  // where links.py places the rule's actor (the source's place when the rule was made; none: the map's origin): it
  // shows only when something happens there
  at: { applies: (l) => happensAtRule(l), absent: [0, 0, 0], badge: (v) => 'at ' + placeText(v), title: 'Where its explosion or its sound with no object happens' },
  also: { dflt: [], shown: 'cause', needs: V2, word: '"or as soon as"' },
  match: { dflt: 'all', badge: () => 'any of these', title: 'Only if any of these holds', needs: V2, word: '"any of these"' },
  phase: { dflt: null, badge: (v) => 'phase: ' + ((v && v.in) || []).join(' or '), needs: V2, word: 'a phase' },
  max: { dflt: 0, badge: (v) => `${+v}×`, title: 'At most this many times', needs: V2, word: '"at most"' },
  cooldown: { dflt: 0, badge: (v) => `cooldown ${+v} s`, title: 'Not again for this long', needs: V2, word: 'a cooldown' },
  again: { dflt: 'ignore', badge: (v) => ({ restart: 'again: start over', each: 'again: run another' })[v] || 'again: ' + v,
    title: 'If it happens again while its steps run', needs: V2, word: '"if it happens again"' },
  talkBusy: { dflt: 'wait', badge: () => 'in a conversation: give up', needs: V2, word: '"in a conversation"' },
  else: { dflt: [], shown: 'rows', needs: V2, word: '"otherwise"' },
  while: { dflt: false, badge: () => 'while', title: 'Undone when it stops holding', needs: V2, word: '"while"' },
  mute: { dflt: false, badge: () => 'muted', title: 'Kept in the editor, not built' },
  note: { dflt: '', badge: () => 'note', title: (v) => String(v) },
  origin: { dflt: null, badge: () => 'from the Story', title: (v) => 'Moved from the Story event ' + (v.story || '') },
};
// Every field of an action: its object and verb are the row's (or the wire's ends and label), its time the row's time
// (a badge on a collapsed wire), its values the verb's arguments in logic.json (args below).
export const ACTION_FIELDS = {
  id: { none: "the action's id: its wire, the log and the history name it" },
  verb: { shown: 'rows' },
  target: { shown: 'rows' },
  targetTag: { shown: 'rows' },
  area: { shown: 'rows' },
  delay: { dflt: 0, shown: 'the row\'s time', wire: (v) => `${+v} s` },
  requires: { dflt: [], badge: () => 'if', title: (v, ix) => 'Only if ' + checksText(v, ix), needs: V2, word: 'a check before a step' },
  until: { shown: 'its section\'s title', needs: V2 },
  max: { shown: 'its section\'s title', needs: V2 },
  _group: { none: 'written by links.blocks only' },
};
const WAIT = { field: 'wait', word: '"wait until"' };   // a wait step (its verb is Logic runtime v2's)
// the ids of the verbs' arguments (logic.json inputs[verb].args): on an action of a verb that does not take one, it
// changes nothing it does
const argIdsOf = (catalog) => new Set(Object.values(catalog.inputs || {}).flatMap((v) => (v.args || []).map((a) => a.id)));

// A rule whose explosion, or sound heard within a radius (c), has no object: it happens where the rule's actor is
// (UCLink.DoAct: Boom(Location), PlaySound from the link)
function happensAtRule(l) {
  return [...list(l.do), ...list(l.else)].some((x) => !x.target && !x.area && !x.targetTag && (x.verb === 'explode' || (x.verb === 'sound' && +x.c > 0)));
}

// What a rule uses that today's UCLink does not run (Logic runtime v2): [{field, word}], each once, in the tables' order
export function laterFields(l) {
  const acts = [...list(l.do), ...list(l.else)];
  return [...Object.entries(RULE_FIELDS).filter(([field, f]) => f.needs && !isDefault(l[field], f.dflt)).map(([field, f]) => ({ field, word: f.word })),
    ...(acts.some((x) => !isDefault(x.requires, [])) ? [{ field: 'step-requires', word: ACTION_FIELDS.requires.word }] : []),
    ...(acts.some((x) => x.verb === 'wait') ? [WAIT] : [])];
}

// a value that is its default: none, empty, or the same as it; a yes or no as links.py reads it (if link.get('once'):
// once 0 is no, once 'false' yes), as the sentence does
function isDefault(v, dflt) {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return true;
  if (dflt === undefined || dflt === null) return false;
  if (typeof dflt === 'boolean') return !!v === dflt;
  return typeof dflt === 'number' ? Number(v) === dflt : String(v) === String(dflt);
}
const checksText = (reqs, ix) => list(reqs).map((c) => conditionText(c, conditionNames(ix.ctx))).join(' and ');
const shortLabel = (label) => String(label || '').replace(/\s*\(.*\)$/, '');
// a point in words: "1573, -208, 40" ('?' when it is not one)
const placeText = (v) => (Array.isArray(v) ? v.map((n) => Math.round(+n || 0)).join(', ') : '?');
// an argument's value as a badge: a toggle its word ("alone"), a place its point, yes/no its label or "not" it
function argText(arg, v) {
  if (arg.type === 'toggle') return arg.value || String(v);
  if (arg.type === 'place') return 'to ' + placeText(v);
  if (arg.type === 'bool') return (v ? '' : 'not ') + shortLabel(arg.label);
  return `${shortLabel(arg.label)}: ${Array.isArray(v) ? v.join(', ') : v}`;
}
// another value of the same kind, to see whether a sentence says the value (it changes with it)
function probe(v) {
  if (Array.isArray(v)) return v.map((n) => (+n || 0) + 1);
  if (typeof v === 'boolean') return !v;
  if (String(v).trim() !== '' && Number.isFinite(Number(v))) return typeof v === 'number' ? v + 1 : String(Number(v) + 1);
  return String(v) + 'x';
}

// The badges of a rule's own fields: on its card's header, or (wire) on its collapsed wire, where the cause's details
// show too. A field this table does not know is a badge with its name: nothing is hidden. A field left out that the
// build fills in (absent) shows as what it gets, after the rule's own.
export function ruleBadges(l, ix, wire = false) {
  const out = [];
  const absent = Object.entries(RULE_FIELDS).filter(([field, f]) => f.absent !== undefined && !Object.hasOwn(l, field)).map(([field, f]) => [field, f.absent]);
  for (const [field, value] of [...Object.entries(l), ...absent]) {
    const f = own(RULE_FIELDS, field);
    if (!f) { out.push({ field, text: field, title: `${field}: ${JSON.stringify(value)}` }); continue; }
    if (f.applies && !f.applies(l)) continue;
    if (wire && f.wire) out.push({ field, text: f.wire(value, l, ix) });
    if (!f.badge || isDefault(value, f.dflt)) continue;
    const title = typeof f.title === 'function' ? f.title(value) : f.title || '';
    out.push({ field, text: f.badge(value, l, ix), title, needs: f.needs || '' });
  }
  return out;
}

// The badges of an action's own values away from their defaults, those the words drawn for it do not say: a card's row
// says its sentence, a collapsed wire only its verb (they say a value when they change with it). On a wire its time is
// a badge too.
export function actionBadges(x, ix, wire = false) {
  const out = [];
  const say = (y) => (wire ? ix.vocab.inputLabel(verbKey(y), y.target, ix.ctx) : ix.vocab.actText(y, ix.ctx));
  const args = ix.vocab.args('verb', x.verb), said = say(x);
  for (const [field, value] of Object.entries(x)) {
    const f = own(ACTION_FIELDS, field), arg = args.find((a) => a.id === field);
    if (arg) {
      if (isDefault(value, arg.default) || say({ ...x, [field]: probe(value) }) !== said) continue;
      out.push({ field, text: argText(arg, value), title: arg.label });
    } else if (f) {
      if (wire && f.wire && !isDefault(value, f.dflt)) out.push({ field, text: f.wire(value) });
      if (f.badge && !isDefault(value, f.dflt)) out.push({ field, text: f.badge(value), title: f.title(value, ix), needs: f.needs || '' });
    } else if (!ix.argIds.has(field)) out.push({ field, text: field, title: `${field}: ${JSON.stringify(value)}` });
  }
  if (x.area && x.area.tag) out.push({ field: 'area', text: fill(ix.catalog.sentence.tagged, { tag: x.area.tag }), title: 'Only these' });
  return out;
}

// A rule drawn as a labelled wire instead of a card: one cause, no checks, one action on one object, no otherwise and
// no wait. Its other fields away from their defaults are badges on the wire (ruleBadges, actionBadges).
export function isSimple(l) {
  const acts = list(l.do);
  return !list(l.requires).length && !list(l.also).length && !list(l.else).length && acts.length === 1
    && !!acts[0].target && !acts[0].area && !acts[0].targetTag && !list(acts[0].requires).length && acts[0].verb !== 'wait';
}

// ---------------------------------------------------------------- the index every view reads
const vocabs = new WeakMap();
const vocabOf = (catalog) => vocabs.get(catalog) || vocabs.set(catalog, vocabulary(catalog)).get(catalog);

// an item's ports on one side: {key ('input:<port>' / 'output:<port>'), label, of (the port of logic.json it comes
// from), n or name (which input, output or phase it is)}
function portsOf(spec, item, side) {
  const key = (id) => (side === 'in' ? 'input:' : 'output:') + id;
  return list(spec[side]).flatMap((p) => {
    if (p.many === 'list') return (Array.isArray(item.list) ? item.list : []).map((name) => ({ key: key(`${p.id}_${String(name).replace(/\W/g, '_')}`), label: fill(p.label, { name }), of: p.id, name }));
    if (p.many) return Array.from({ length: Math.max(0, +item[p.many] || 0) }, (_, k) => ({ key: key(p.id + (k + 1)), label: fill(p.label, { n: k + 1 }), of: p.id, n: k + 1 }));
    return [{ key: key(p.id), label: fill(p.label, item), of: p.id }];
  });
}
// The logic's own items as objects with ports (logic.json "pieces"): a block, a phase set, a signal, a group, a point.
// Their inputs and outputs are a script's ('input:<port>', 'output:<port>'), so a rule reaches them the same way.
function pieceActors(logic, catalog) {
  const out = {};
  for (const [key, [, kind]] of Object.entries(PIECE_KINDS)) {
    for (const item of list(own(logic, key))) {
      const family = key === 'blocks' ? item.kind : kind, spec = own(catalog.pieces, family) || { in: [], out: [] };
      const name = pieceId(key, key === 'signals' ? item.name : item.id), ports = { in: portsOf(spec, item, 'in'), out: portsOf(spec, item, 'out') };
      out[name] = { family, kind, item, ports, label: item.name || item.id, title: `${spec.noun || family} "${item.name || item.id}"`,
        format: spec.value || '', inputs: ports.in.map((p) => p.key), outputs: ports.out.map((p) => p.key),
        labels: Object.fromEntries([...ports.in, ...ports.out].map((p) => [p.key, p.label])),
        members: key === 'groups' ? [...(item.members || [])] : undefined };
    }
  }
  return out;
}

// The Story's dialogues, InfoLinks and events as things a sentence names ("the dialogue "Gate talk"")
function storyActors(story) {
  const out = {};
  for (const [key, prefix, kind, word] of STORY_KINDS) {
    for (const item of list((story || {})[key]).filter((x) => x.id)) {
      out[prefix + item.id] = { family: kind, kind, word, label: item.title || item.id, title: `the ${word} "${item.title || item.id}"` };
    }
  }
  return out;
}

// What the vocabulary asks of the page (logic-vocab.js ctx), from the plain data
function contextOf(input, actors) {
  const edits = input.edits || {}, actor = (n) => own(actors, n);
  return {
    name: (n) => (!n ? 'nothing' : actor(n) ? actor(n).title || n : `${String(n).replace(QUALIFIED, '')} (missing)`),
    family: (n) => (actor(n) && actor(n).family) || 'other',
    word: (n) => own(own(edits.logic, 'words'), n) || (actor(n) && actor(n).word) || '',
    usable: (n) => !!own(edits.usable, n),
    optionText: (l) => ((actor(l.src) || {}).options || [])[+l.option || 0] || '',
    portLabel: (n, key) => own(actor(n) && actor(n).labels, key) || key.split(':')[1] || '?',
    itemName: (cls) => own(input.items, cls) || String(cls).split('.').pop(),
  };
}

// A rule's causes (its own and its "also"), each a thing's output pin; its actions, each its id, its wire and the pin
// of what it acts on
function causesOf(l) {
  return [l, ...list(l.also)].map((c) => ({ src: c.when === 'start' ? '' : c.src || '', key: whenKey(c), cause: c,
    node: thingId(c.when === 'start' ? '' : c.src), pin: 'out:' + whenKey(c) }));
}
function targetOf(rule, x, id) {
  if (x.area) return `${GROUP_KINDS.area}${rule}/${id}`;
  if (x.targetTag) return GROUP_KINDS.tag + x.targetTag;
  return x.target ? thingId(x.target) : null;
}
function actsOf(l, acts, prefix) {
  const ids = actionIds(acts, prefix);
  return acts.map((x, j) => ({ x, j, id: ids[j], wire: actId(l.id, ids[j]), node: targetOf(l.id, x, ids[j]),
    pin: targetOf(l.id, x, ids[j]) ? 'in:' + verbKey(x) : null }));
}
function ruleEntry(l) {
  return { l, id: l.id, node: ruleId(l.id), causes: causesOf(l), acts: actsOf(l, list(l.do), 'a'), otherwise: actsOf(l, list(l.else), 'e'),
    simple: isSimple(l) };
}

// The Story's dialogues, InfoLinks and events as read-only nodes: their states (story-state.js reads them, one item
// at a time so each use keeps its node) and the actions they take, as a rule's (logic.json "story": their words).
function storyActions(item) {
  const steps = list(item.steps).filter((s) => s.type === 'do').flatMap((s) => list(s.do));
  const walk = (acts) => list(acts).flatMap((a) => (a.type === 'do' ? walk(a.do) : [a]));
  return walk([...steps, ...list(item.do)]);
}
function storyAct(a, alias) {
  switch (a.type) {
    case 'door': case 'npc': return { verb: own(alias, a.act) || a.act, target: a.actor || '', ...(a.act === 'sit' ? { a: a.seat || '' } : {}) };
    case 'cutscene': return { verb: 'cutplay', target: a.cutscene || '' };
    case 'flag': return { verb: 'flag', a: a.flag || '', b: a.is === false ? '0' : '1' };
    case 'goal': return { verb: 'goal', a: a.goal || '', b: a.text || '', c: a.done ? 'done' : '' };
    case 'note': case 'message': return { verb: a.type, a: a.text || '' };
    case 'travel': return { verb: 'travel', a: a.map || '', b: a.tag || '' };
    case 'talk': return { verb: 'talk', target: a.dialogue ? storyId('dialogues', a.dialogue) : '' };
    case 'infolink': return { verb: 'play', target: a.infolink ? storyId('infolinks', a.infolink) : '' };
    default: return { verb: a.type || '?' };
  }
}
function storyEntries(input) {
  const story = input.story || {}, flags = input.storyFlags || { playedFlag: () => '', heardFlag: () => '' };
  const alias = own(input.catalog, 'story') || {};
  return STORY_KINDS.flatMap(([key, , kind]) => list(story[key]).filter((item) => item.id).map((item) => {
    const one = { dialogues: [], infolinks: [], events: [], [key]: [item] };
    return { kind, item, node: storyId(key, item.id), acts: storyActions(item).map((a, j) => ({ a, x: storyAct(a, alias), id: 's' + (j + 1) })),
      states: collectDraftStates(one, input.map || '', flags, []) };
  }));
}

// The key of a state or a counter: its name as the game writes it (gameName: 'Keys found' and 'Keys_found' are one),
// whatever the case (the game's names ignore it)
export const stateKey = (name) => gameName(name).toLowerCase();

// Every state and counter the logic reads or sets: who sets it, who reads it ({node, pin, text, rule}), and whether
// the game or another map may set it (a character's fate, a mission state, the original game's). Each is named as
// it was first typed.
function stateIndex(ix) {
  const states = new Map();
  const entry = (name, type) => {
    const key = stateKey(name);
    if (!states.has(key)) states.set(key, { name: String(name).trim(), type, setters: [], readers: [], elsewhere: [] });
    return states.get(key);
  };
  const add = (name, type, side, use) => {
    if (!String(name || '').trim()) return;
    const uses = entry(name, type)[side], same = uses.find((u) => u.node === use.node && u.pin === use.pin);
    if (same) same.auto = same.auto && use.auto;            // once per pin; set by the author too: not only automatic
    else uses.push(use);
  };
  for (const r of ix.rules) {
    const who = `${r.causes[0].src ? ix.ctx.name(r.causes[0].src) : 'the map start'} (${r.id})`;
    list(r.l.requires).forEach((c, i) => {
      const use = { node: r.node, pin: 'if:' + i, rule: r.id, text: who };
      if (kindOf(c) === 'flag') add(c.flag, 'bool', 'readers', use);
      if (kindOf(c) === 'counter') add(c.counter, 'int', 'readers', use);
    });
    for (const act of [...r.acts, ...r.otherwise]) {
      const use = { node: r.node, pin: act.wire, rule: r.id, text: who };
      if (act.x.verb === 'flag') add(act.x.a, 'bool', 'setters', use);
      if (act.x.verb === 'count') add(act.x.a, 'int', 'setters', use);
    }
  }
  for (const s of ix.story) {
    // (a dialogue's Played and an InfoLink's Heard are set by the game itself: auto)
    const text = ix.ctx.name(s.node);
    for (const st of s.states) for (const u of st.uses) add(st.flag, st.type, u.kind === 'read' ? 'readers' : 'setters', { node: s.node, pin: null, text, auto: u.kind === 'automatic' });
  }
  for (const st of list(ix.input.external)) {
    const elsewhere = list(st.uses).filter((u) => u.map !== (ix.input.map || ''));
    if (!elsewhere.length && flagCategory(st) !== 'original') continue;
    const e = entry(st.flag || st.name, st.type === 'int' ? 'int' : 'bool');
    for (const u of elsewhere) e.elsewhere.push({ kind: u.kind === 'read' ? 'read' : 'write', text: `${u.context} (${u.map})` });
    if (!elsewhere.length) e.elsewhere.push({ kind: 'write', text: 'the original game' });
  }
  for (const st of list(own(ix.logic, 'states'))) {
    if (st.scope === 'mission' || st.scope === 'game') entry(st.name, st.type === 'int' ? 'int' : 'bool').elsewhere.push({ kind: 'write', text: `another map of the ${st.scope}` });
    if (st.derived) entry(st.name, 'bool').setters.push({ node: null, pin: null, text: 'mirrors ' + conditionText(st.derived) });
  }
  for (const e of states.values()) {
    // a character's fate: the game sets it ("the game (Guard1 · Was killed)", as the state field says it)
    if (parseFate(e.name)) e.elsewhere.push({ kind: 'write', text: `the game (${stateLabel(e.name)})` });
  }
  return states;
}

// The index the graph, the problems and the Read view share. input: above.
export function logicIndex(input) {
  const edits = input.edits || {}, logic = edits.logic || {};
  const actors = { ...pieceActors(logic, input.catalog), ...storyActors(input.story), ...(input.actors || {}) };
  const ix = { input, catalog: input.catalog, vocab: vocabOf(input.catalog), argIds: argIdsOf(input.catalog), edits, logic, actors, ctx: contextOf(input, actors),
    gone: new Set(Object.keys(edits.deleted || {})), off: new Set(Object.keys(edits.disabled || {}).filter((n) => edits.disabled[n])),
    rules: list(edits.links).filter((l) => l.id).map(ruleEntry), story: storyEntries(input) };
  ix.states = stateIndex(ix);
  return ix;
}
// an object of the map (or an item of the logic) that is there: not deleted, known
export const present = (ix, name) => !!own(ix.actors, name) && !ix.gone.has(name);

// ---------------------------------------------------------------- the graph
// A condition chip: its words, the state or counter it reads and who sets it ({node, text}); amber (unset) when
// nothing sets it; a kind conditions.js does not know says so.
function chipOf(c, i, ix) {
  const kind = kindOf(c), name = kind === 'flag' ? c.flag : kind === 'counter' ? c.counter : '';
  const st = name ? ix.states.get(stateKey(name)) : null;
  const known = CONDITION_KINDS.some(([k]) => k === kind);
  return { pin: 'if:' + i, kind, name: name || '', known,
    text: known ? conditionText(c, conditionNames(ix.ctx)) : `${c.type || '?'}: ${Object.entries(c).filter(([k]) => k !== 'type').map(([, v]) => v).join(' ')}`,
    setBy: st ? [...st.setters.map(({ node, text }) => ({ node, text })), ...st.elsewhere.filter((u) => u.kind === 'write').map(({ text }) => ({ node: null, text }))] : [],
    unset: !!st && !st.setters.length && !st.elsewhere.some((u) => u.kind === 'write'),
    problem: known ? conditionProblem(c) : 'a kind of condition the game classes do not know' };
}
// A do row: its time from the start of its section, its sentence, its pin to the object it acts on (key: the input
// it takes there), its badges
function rowOf(act, ix) {
  return { id: act.wire, act: act.id, index: act.j, time: +act.x.delay || 0, timeText: `${+act.x.delay || 0} s`,
    text: ix.vocab.actText(act.x, ix.ctx), target: act.node, pin: act.pin, key: verbKey(act.x), badges: actionBadges(act.x, ix) };
}
// "After Guard2 arrives (at most 20 s):" (a wait step, Logic runtime v2)
function sectionTitle(x, ix) {
  const u = x.until || {};
  const what = u.type === 'arrived' ? `${ix.ctx.name(u.actor)} arrives` : u.type === 'ended' ? `${ix.ctx.name(u.actor)} has ended`
    : kindOf(u) ? conditionText(u, conditionNames(ix.ctx)) : 'the wait';
  return `After ${what}${+x.max > 0 ? ` (at most ${+x.max} s)` : ''}:`;
}
// the rows of a list in sections: a wait starts one, the rows of each in time order (links.blocks sorts them so)
function sectionsOf(acts, ix) {
  const out = [{ title: '', rows: [] }];
  for (const act of acts) {
    if (act.x.verb === 'wait') out.push({ title: sectionTitle(act.x, ix), wait: act.wire, needs: V2, rows: [] });
    else out[out.length - 1].rows.push(rowOf(act, ix));
  }
  for (const s of out) s.rows.sort((p, q) => p.time - q.time);
  return out.filter((s, k) => k === 0 || s.rows.length || s.title);
}
// A rule card (an articy fragment crossed with a PlayMaker state)
function cardOf(r, ix) {
  const l = r.l;
  return { id: r.node, kind: 'rule', rule: r.id, readOnly: false, muted: !!l.mute,
    causes: r.causes.map((c) => ({ node: c.node, pin: c.pin, text: ix.vocab.whenText(c.cause, ix.ctx), short: ix.vocab.whenLabel(c.key, c.src, ix.ctx) })),
    badges: ruleBadges(l, ix), match: l.match === 'any' ? 'any' : 'all', checks: list(l.requires).map((c, i) => chipOf(c, i, ix)),
    sections: sectionsOf(r.acts, ix), otherwise: sectionsOf(r.otherwise, ix)[0].rows, sentence: ix.vocab.sentence(l, ix.ctx),
    pos: posOf(ix, r.node) };
}
// A simple rule as a wire from its cause's pin to its object's input: "the player uses it → Open", its badges
function collapsedOf(r, ix) {
  const c = r.causes[0], act = r.acts[0];
  return { id: r.node, kind: kindOfWire(c.node, act.node), part: 'rule', rule: r.id, act: act.id, muted: !!r.l.mute,
    from: { node: c.node, pin: c.pin }, to: { node: act.node, pin: act.pin },
    label: `${ix.vocab.whenLabel(c.key, c.src, ix.ctx)} → ${ix.vocab.inputLabel(verbKey(act.x), act.x.target, ix.ctx)}`,
    badges: [...ruleBadges(r.l, ix, true), ...actionBadges(act.x, ix, true)], sentence: ix.vocab.sentence(r.l, ix.ctx) };
}
const kindOfWire = (from, to) => ([from, to || ''].some((id) => id.startsWith(PIECE_KINDS.signals[0])) ? 'signal' : 'causes');
const posOf = (ix, id) => own(own(own(ix.logic, 'view'), 'pos'), id) || null;

// A node for a thing (a map object, the World, an item of the logic, a group made on the spot), its pins added as
// they are used
function thingNode(ix, id) {
  if (id === 'world') return { id, kind: 'world', name: '', label: 'The map', word: '', family: 'world', pins: { out: [], in: [] }, pos: posOf(ix, id) };
  if (isGroup(id)) return { id, kind: 'group', unnamed: true, name: id, label: '', word: 'group', family: 'group', members: [], pins: { out: [], in: [] }, pos: posOf(ix, id) };
  const name = id.startsWith(OBJECT) ? id.slice(OBJECT.length) : id, a = own(ix.actors, name) || {};
  return { id, kind: a.kind || 'thing', name, label: a.label || name, family: a.family || 'other',
    word: a.kind ? (own(ix.catalog.pieces, a.family) || {}).label || a.word || '' : ix.vocab.noun(a.family || 'other', ix.ctx.word(name)) || ix.ctx.word(name),
    missing: !present(ix, name), disabled: ix.off.has(name), at: a.at || null, members: a.members, item: a.item,
    format: a.format || '', pins: { out: [], in: [] }, pos: posOf(ix, id) };
}
// a block's or a phase set's live value in words ("2 / 3", "Phase: Alarm": logic.json pieces' value), from what Try it
// or the game's log knows of it; '' when nothing
export const liveValue = (node, live) => (node.format && live ? fill(node.format, { ...(node.item || {}), ...live }) : '');
// a pin of a node: once, with its words ('out:<when>' the output, 'in:<verb>' the input, 'game:out' / 'game:in' the
// original wiring, 'story:<how>' a Story start)
function usePin(node, side, key, label) {
  const id = `${side}:${key}`;
  if (!node.pins[side].some((p) => p.id === id)) node.pins[side].push({ id, key, label, used: true });
  return id;
}
// a pin's words: an item of the logic's own port words ("all done"), the vocabulary's for the rest
const pieceLabel = (ix, key, name) => { const a = own(ix.actors, name); return a && a.ports ? own(a.labels, key) : undefined; };
const outLabel = (ix, key, name) => pieceLabel(ix, key, name) || ix.vocab.whenLabel(key, name, ix.ctx);
const inLabel = (ix, key, name) => pieceLabel(ix, key, name) || ix.vocab.inputLabel(key, name, ix.ctx);
// the pins not in use, for "+ Show all": what it offers at the disclosure level (a script's own ports always)
function allPins(ix, node, level) {
  const a = own(ix.actors, node.name);
  if (!a || node.kind === 'world') return { out: [], in: [] };
  const shown = (kind, key) => key.includes(':') || ix.vocab.shownAt(kind, key, level);
  return { out: (a.outputs || []).filter((k) => shown('output', k)).map((key) => ({ id: 'out:' + key, key, label: outLabel(ix, key, node.name), used: false })),
    in: (a.inputs || []).filter((k) => shown('verb', k)).map((key) => ({ id: 'in:' + key, key, label: inLabel(ix, key, node.name), used: false })) };
}

// The Story's nodes (read only): a dialogue (Start in, Ended out), an InfoLink (Play in, Heard out), an event (a rule
// card the Story runs); their rows are their actions, wired like a rule's.
const STORY_PINS = { dialogue: [['in:start', 'Start'], ['out:ended', 'Ended']], infolink: [['in:play', 'Play'], ['out:heard', 'Heard']], storyrule: [] };
function storyCause(w, ix) {
  const c = w.type === 'dead' ? { type: 'alive', actor: w.actor, is: false } : w.type === 'item' ? { type: 'item', item: w.item, has: true }
    : w.type === 'flag' ? { flag: w.flag, is: w.is !== false } : null;
  if (c) return conditionText(c, conditionNames(ix.ctx));
  if (w.type === 'near') return `JC comes within ${w.radius || 256} units of a point`;
  if (w.type === 'hostile') return `${w.faction || '?'} turns hostile`;
  return 'the map starts';
}
function storyNode(s, ix) {
  const it = s.item, first = list(it.steps).find((st) => st.type === 'line') || list(it.lines)[0];
  const rows = s.acts.map((act) => ({ id: `${s.node}/${act.id}`, act: act.id, index: 0, time: 0, timeText: '',
    text: act.x.verb === 'talk' || act.x.verb === 'play' ? `${act.x.verb === 'talk' ? 'start' : 'play'} ${ix.ctx.name(act.x.target)}`
      : own(ix.catalog.inputs, act.x.verb) ? ix.vocab.actText(act.x, ix.ctx) : act.x.verb,
    target: act.x.target ? thingId(act.x.target) : null, pin: act.x.target ? 'in:' + act.x.verb : null, key: act.x.verb, badges: [] }));
  return { id: s.node, kind: s.kind, word: own(ix.actors, s.node).word, readOnly: true, title: it.title || it.id, disabled: !!it.disabled, first: first ? first.text || '' : '',
    owner: it.owner ? thingId(it.owner) : null, caller: it.name || it.caller || '',
    cause: s.kind === 'storyrule' ? storyCause(it.when || {}, ix) : '', once: it.once !== false,
    checks: list(it.requires).map((c, i) => chipOf(c, i, ix)), rows,
    pins: { in: STORY_PINS[s.kind].filter(([id]) => id.startsWith('in:')).map(([id, label]) => ({ id, key: id.slice(3), label, used: true })),
      out: STORY_PINS[s.kind].filter(([id]) => id.startsWith('out:')).map(([id, label]) => ({ id, key: id.slice(4), label, used: true })) },
    pos: posOf(ix, s.node) };
}

// The Logic window's graph of the whole map: {nodes, wires, states, pages}. A wire's kind is a key of the canvas's own
// table (graph-canvas.js WIRE_KINDS: causes, signal, state, wiring), which gives it its look; the model draws nothing.
// options:
//   open      rule ids drawn as cards even when simple (the user clicked their wire's label)
//   showAll   node ids that show every pin they offer, not only those in use
//   level     the disclosure level of "+ Show all" ('basic', 'more', 'advanced': logic.json levels)
//   game      false: no original game wiring
export function logicGraph(ix, options = {}) {
  const open = new Set(options.open || []), showAll = new Set(options.showAll || []), level = options.level || ix.vocab.levels[0];
  const nodes = new Map(), wires = [];
  const node = (id) => nodes.get(id) || nodes.set(id, thingNode(ix, id)).get(id);
  const pinOut = (id, key, name) => usePin(node(id), 'out', key, outLabel(ix, key, name));
  const pinIn = (id, key, name) => usePin(node(id), 'in', key, inLabel(ix, key, name));
  for (const s of ix.story) nodes.set(s.node, storyNode(s, ix));          // first: a rule may act on them
  for (const r of ix.rules) {
    for (const c of r.causes) pinOut(c.node, c.key, c.src);
    for (const act of [...r.acts, ...r.otherwise].filter((a) => a.node)) {
      pinIn(act.node, verbKey(act.x), act.x.target);
      if (act.x.area || act.x.targetTag) Object.assign(node(act.node), groupOf(ix, act.x));
    }
    if (r.simple && !open.has(r.id)) { wires.push(collapsedOf(r, ix)); continue; }
    const card = cardOf(r, ix);
    nodes.set(card.id, card);
    card.causes.forEach((c, i) => wires.push({ id: `${r.node}/cause${i}`, kind: kindOfWire(c.node, ''), part: 'when', rule: r.id,
      from: { node: c.node, pin: c.pin }, to: { node: card.id, pin: 'cause:' + i } }));
    for (const row of [...card.sections.flatMap((s) => s.rows), ...card.otherwise]) {
      if (row.target) wires.push({ id: row.id, kind: kindOfWire('', row.target), part: 'do', rule: r.id, act: row.act,
        from: { node: card.id, pin: row.id }, to: { node: row.target, pin: row.pin }, delay: row.time });
    }
  }
  storyGraph(ix, node, nodes, wires);
  stateWires(ix, nodes, wires);
  if (options.game !== false) gameWires(ix, node, wires);
  for (const n of nodes.values()) {
    if (!n.pins || n.readOnly) continue;
    const all = allPins(ix, n, level), used = (side) => new Set(n.pins[side].map((p) => p.id));
    n.more = { out: all.out.filter((p) => !used('out').has(p.id)).length, in: all.in.filter((p) => !used('in').has(p.id)).length };
    if (showAll.has(n.id)) for (const side of ['out', 'in']) n.pins[side].push(...all[side].filter((p) => !used(side).has(p.id)));
  }
  return { nodes: [...nodes.values()], wires, states: [...ix.states.values()].map(stateSummary), pages: list(own(own(ix.logic, 'view'), 'pages')) };
}
const stateSummary = (s) => ({ name: s.name, type: s.type, setBy: s.setters.length, readBy: s.readers.length,
  setters: s.setters.map((u) => u.node).filter(Boolean), readers: s.readers.map((u) => u.node).filter(Boolean), elsewhere: s.elsewhere.length });

// a group an action makes on the spot: its words and members (what its tag reaches, or its area's saved members)
function groupOf(ix, x) {
  const S = ix.catalog.sentence;
  if (x.targetTag) return { label: fill(S.tagged, { tag: x.targetTag }), members: own(ix.input.tags, x.targetTag) || null };
  const area = x.area, members = Array.isArray(area.members) ? area.members : [];
  return { label: `${members.length} saved ${own(S.members, area.kind) || S.members.object}${area.dynamic ? ` + newcomers within ${area.radius} units` : ''}`,
    members, radius: area.radius || 0, at: area.at || null };
}
// the Story's nodes and wires: a dialogue's owner starts it, a Story action reaches what it acts on
function storyGraph(ix, node, nodes, wires) {
  for (const s of ix.story) {
    const n = nodes.get(s.node);
    if (s.kind === 'dialogue' && n.owner) {
      const how = s.item.start === 'near' ? 'near' : 'talk';
      const pin = usePin(node(n.owner), 'out', 'story:' + how, how === 'near' ? 'JC gets close (dialogue)' : 'JC talks to them (dialogue)');
      wires.push({ id: `${s.node}/start`, kind: 'causes', part: 'story', readOnly: true, from: { node: n.owner, pin }, to: { node: s.node, pin: 'in:start' } });
    }
    for (const row of n.rows.filter((x) => x.target)) {
      // into a dialogue's Start or an InfoLink's Play; into an object's input, as a rule's
      const to = node(row.target), pin = to.readOnly ? (to.pins.in[0] || {}).id || null : usePin(to, 'in', row.key, inLabel(ix, row.key, to.name));
      wires.push({ id: row.id, kind: 'causes', part: 'story', readOnly: true, from: { node: s.node, pin: row.id }, to: { node: row.target, pin } });
    }
  }
}
// the state dependencies: from what sets a state or counter to the chips that read it
function stateWires(ix, nodes, wires) {
  for (const s of ix.states.values()) {
    for (const set of s.setters.filter((u) => u.node && nodes.has(u.node))) {
      for (const read of s.readers.filter((u) => nodes.has(u.node) && u.node !== set.node)) {
        wires.push({ id: `state:${s.name}:${set.pin || set.node}>${read.node}/${read.pin}`, kind: 'state', state: s.name,
          from: { node: set.node, pin: set.pin }, to: { node: read.node, pin: read.pin } });
      }
    }
  }
}
// the original game's wiring (Event to Tag, keys, patrols): read only, never stored (the canvas's 'wiring' kind)
function gameWires(ix, node, wires) {
  const seen = new Set();
  for (const w of list(ix.input.wiring)) {
    if (!w.from || !w.to || w.from === w.to) continue;
    const id = `game:${w.from}>${w.to}:${w.why || ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const from = thingId(w.from), to = thingId(w.to);
    wires.push({ id, kind: 'wiring', readOnly: true, label: w.why || '', from: { node: from, pin: usePin(node(from), 'out', 'game', 'game wiring') },
      to: { node: to, pin: usePin(node(to), 'in', 'game', 'game wiring') } });
  }
}

// ---------------------------------------------------------------- scopes: never one wall by default
// The graph seen from a scope ({kind}): 'chain' (default), the selection's chain, one step upstream (what acts on it,
// and what sets that off) and the whole chain downstream; 'near', its direct neighbourhood (mission-graph-model.js
// neighbourhood); 'page', a page of edits.logic.view; 'state', what sets and reads a state or counter; 'map', all.
// Capped at `limit` nodes: {nodes, wires, root, total, hidden, more: {node id: how many neighbours are not shown}}.
export const SCOPE_LIMIT = 60;
const snapshotOf = (graph) => ({ nodes: graph.nodes, edges: graph.wires.map((w) => ({ source: w.from.node, target: w.to.node, relation: w.kind, id: w.id })) });
const STEP_KINDS = new Set(['rule', 'storyrule']);           // a step upstream goes on through these to their cause
function chainOrder(graph, root) {
  const { adjacent } = graphIndex(snapshotOf(graph)), kinds = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const order = [root], seen = new Set(order);
  const add = (id) => { if (!seen.has(id)) { seen.add(id); order.push(id); } };
  const into = (id) => (adjacent.get(id) || []).filter((e) => e.target === id && e.source !== id).map((e) => e.source);
  for (const up of into(root)) { add(up); if (STEP_KINDS.has(kinds.get(up))) into(up).forEach(add); }
  const down = [root];
  for (let i = 0; i < down.length; i++) {
    for (const e of adjacent.get(down[i]) || []) {
      if (e.source !== down[i] || seen.has(e.target)) continue;
      add(e.target);
      down.push(e.target);
    }
  }
  return order.filter((id) => kinds.has(id));
}
function scopeIds(graph, scope, ix) {
  const all = graph.nodes.map((n) => n.id), has = new Set(all);
  switch (scope.kind) {
    case 'map': return all;
    case 'page': return list(graph.pages).filter((p) => p.id === scope.page).flatMap((p) => p.nodes || []).filter((id) => has.has(id));
    case 'near': return has.has(scope.root) ? neighbourhood(snapshotOf(graph), scope.root, 2, Infinity).nodes.map((n) => n.id) : [];
    case 'state': {
      const s = ix && ix.states.get(stateKey(scope.state));
      const ids = s ? [...s.setters, ...s.readers].map((u) => u.node).filter((id) => has.has(id)) : [];
      const cards = graph.nodes.filter((n) => ids.includes(n.id) && n.causes);
      return [...new Set([...ids, ...cards.flatMap((n) => n.causes.map((c) => c.node))])];
    }
    default: return has.has(scope.root) ? chainOrder(graph, scope.root) : [];
  }
}
export function scopeOf(graph, scope = {}, { limit = SCOPE_LIMIT, ix = null } = {}) {
  const found = scopeIds(graph, scope, ix), kept = found.slice(0, limit), visible = new Set(kept);
  const byId = new Map(graph.nodes.map((n) => [n.id, n])), beyond = new Map();
  for (const w of graph.wires) {
    for (const [a, b] of [[w.from.node, w.to.node], [w.to.node, w.from.node]]) {
      if (visible.has(a) && !visible.has(b)) (beyond.get(a) || beyond.set(a, new Set()).get(a)).add(b);
    }
  }
  return { root: scope.root || null, nodes: kept.map((id) => byId.get(id)), wires: graph.wires.filter((w) => visible.has(w.from.node) && visible.has(w.to.node)),
    total: found.length, hidden: found.length - kept.length, more: Object.fromEntries([...beyond].map(([id, set]) => [id, set.size])) };
}
