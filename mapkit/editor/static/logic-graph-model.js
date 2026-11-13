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
//   keeps       the flags the map's logic blocks keep as they run (P3): [{block, name, type, text}] (a Phases block's
//               number and phase states, At least N's state, a Counter's number)
//   map         the map's name
import { vocabulary, fill, whenKey, verbKey, conditionNames, gameName, goalTexts } from './logic-vocab.js';
import { conditionText, conditionProblem, kindOf, CONDITION_KINDS, comesText } from './conditions.js';
import { collectDraftStates } from './story-state.js';
import { parseFate, flagCategory, stateLabel } from './state-model.js';
import { graphIndex, neighbourhood } from './mission-graph-model.js';
import { isFormula, gameNumber, FormulaError } from './logic-numbers.js';

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
// Unreal names ignore letter case and the engine keeps the first spelling it knew (13 Nov 2026: a rule on 'BtnAugs'
// whose actor the build gave back as 'btnAugs', a name Revision's code already has, was "not in the map any more").
// A map object is one node whatever spelling names it: the first the page's actors use, else the first a rule uses.
// The rules keep their own spelling (the game compares names ignoring case). The logic's own items are as they are.
function spellings(actors) {
  const first = new Map();
  const canon = (name) => {
    if (!name || typeof name !== 'string' || QUALIFIED.test(name)) return name;
    const low = name.toLowerCase();
    if (!first.has(low)) first.set(low, name);
    return first.get(low);
  };
  Object.keys(actors).forEach(canon);
  return canon;
}
// the names of a table keyed by object names (edits.deleted, edits.disabled), as the game compares them
class Caseless extends Set {
  constructor(names) { super([...names].map((n) => String(n).toLowerCase())); }
  has(name) { return name != null && super.has(String(name).toLowerCase()); }
}
// a table keyed by object names (edits.usable, the logic's words): exact first, then in any letter case
const ownAnyCase = (table, key) => {
  if (!table || key == null) return undefined;
  if (Object.hasOwn(table, key)) return table[key];
  const low = String(key).toLowerCase(), k = Object.keys(table).find((x) => x.toLowerCase() === low);
  return k === undefined ? undefined : table[k];
};
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
// badge), 'chips' (the only-if row), 'rows' (the do rows), a badge (its text), or nowhere, with the reason. needs: a
// field of the design that no build runs yet (links.py does not compile it, UCLink / UCRule have no code for it): its
// badge is greyed out and Check map says so. The rest of the runtime v2 (also, match, max, cooldown, again, talkBusy,
// else, an action's own requires, Wait until) is built by links.blocks as a UCRule / bSteps and ran in both games
// (backup/20261105_logic_b make_m4_p4.py, 20261106_chain, 20261107_logic_p3b). absent: the value links.py builds when
// the rule leaves the field out, shown as that.
const V2 = 'Logic runtime v2';
export const RULE_FIELDS = {
  id: { shown: 'the dim id beside the cause' },
  src: { shown: 'cause' },
  when: { shown: 'cause' },
  // a computer's option and how near: in the cause's words, and a badge on a collapsed wire
  option: { shown: 'cause', applies: (l) => l.when === 'option', absent: 0, wire: (v, l, ix) => ix.ctx.optionText(l) || `button ${(+v || 0) + 1}` },
  near: { shown: 'cause', applies: (l) => l.when === 'near', absent: 256, wire: (v) => `within ${+v || 256}` },
  port: { shown: 'cause', applies: (l) => l.when === 'output' },
  // the other values a cause takes (logic.json outputs' args): in its words, and on a collapsed wire (whose short words
  // do not say them) a badge; a signal's is its hub
  signal: { shown: 'cause' },
  // a dialogue's, an InfoLink's end (P5): the wire comes out of its node
  dialogue: { shown: 'cause', applies: (l) => l.when === 'ended', wire: (v, l, ix) => `"${ix.ctx.storyTitle('dialogues', v)}"` },
  infolink: { shown: 'cause', applies: (l) => l.when === 'heard', wire: (v, l, ix) => `"${ix.ctx.storyTitle('infolinks', v)}"` },
  key: { shown: 'cause', applies: (l) => l.when === 'keypress', wire: (v) => `key ${v}` },
  gameTag: { shown: 'cause', applies: (l) => l.when === 'gametag', wire: (v) => `tag ${v}` },
  below: { shown: 'cause', applies: (l) => ['damaged', 'hurt', 'jchealth'].includes(l.when), wire: (v) => `below ${v}` },
  floor: { shown: 'cause', applies: (l) => l.when === 'atfloor', wire: (v) => `floor ${v}` },
  // the world's own (P9 slice 3): a goal's name (none: any goal), the kind of noise and how near, a character or a body
  goal: { shown: 'cause', applies: (l) => l.when === 'goaldone', wire: (v) => (String(v || '').trim() ? `"${v}"` : 'any goal') },
  noise: { shown: 'cause', applies: (l) => l.when === 'noise', wire: (v) => String(v || 'loud') },
  within: { shown: 'cause', applies: (l) => l.when === 'noise' && +l.within > 0, wire: (v) => `within ${+v}` },
  what: { shown: 'cause', applies: (l) => l.when === 'appears', wire: (v) => String(v || 'character') },
  // what a "becomes" or a "changes" rule watches: its words say it (the player's own, P9: "the player turns on Speed
  // Enhancement"), and its short words on a card's title and a wire (shortOf)
  watch: { shown: 'cause', applies: (l) => l.when === 'becomes' || l.when === 'changes' },
  requires: { shown: 'chips' },
  do: { shown: 'rows' },
  once: { dflt: false, badge: () => '1×', title: 'Only once' },
  label: { none: 'made again from the rule (lkFixLabels), saved for the log' },
  // the rule whose "If not" steps this rule is (action-list.js: the same cause, the opposite condition)
  otherwiseOf: { none: 'the rule its "If not" steps belong to' },
  // a list of steps run in its order (action-list.js, UCLink bSteps): its rows say so already
  steps: { none: 'its steps run in their order, each after its wait' },
  // where links.py places the rule's actor (the source's place when the rule was made; none: the map's origin): it
  // shows only when something happens there
  at: { applies: (l) => happensAtRule(l), absent: [0, 0, 0], badge: (v) => 'at ' + placeText(v), title: 'Where its explosion or its sound with no object happens' },
  // UCRuleAlso, UCRule bAny / MaxRuns / Cooldown / Again / TalkBusy / ElseAt (links.blocks)
  also: { dflt: [], shown: 'cause' },
  match: { dflt: 'all', badge: () => 'any of these', title: 'Only if any of these holds' },
  // P3: only in some phases of a Phases block (links.phase_gate, UCLink.PhaseGate)
  phase: { dflt: null, badge: (v) => 'phase: ' + ((v && v.in) || []).join(' or '), title: 'It works only in these phases' },
  max: { dflt: 0, badge: (v) => `${+v}×`, title: 'At most this many times' },
  cooldown: { dflt: 0, badge: (v) => `cooldown ${+v} s`, title: 'Not again for this long' },
  again: { dflt: 'ignore', badge: (v) => ({ restart: 'again: start over', each: 'again: run another' })[v] || 'again: ' + v,
    title: 'If it happens again while its steps run' },
  // '' goes on (logic-rule-ui TALK_BUSY); wait and giveup are built (UCRule.TalkBusy)
  talkBusy: { dflt: '', badge: (v) => v === 'wait' ? 'in a conversation: wait' : v === 'giveup' ? 'in a conversation: give up' : 'in a conversation: ' + v,
    title: 'When a step is due while the player is in a conversation' },
  else: { dflt: [], shown: 'rows' },
  // P3: links.expand_while adds the rule that undoes it when its cause ends (the player walks out, the condition stops
  // holding...)
  while: { dflt: false, badge: () => 'while', title: 'Undone when it stops' },
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
  // a check step before it (links.step_items, UCLink bSteps): failing, only it is skipped
  requires: { dflt: [], badge: () => 'if', title: (v, ix) => 'Only if ' + checksText(v, ix) },
  until: { shown: 'its section\'s title' },
  max: { shown: 'its section\'s title' },
  _group: { none: 'written by links.blocks only' },
};
// a Wait among a rule's own actions that is not a list of steps: links.py builds only the verbs of the catalogue
// there (_plain_acts), so the game never waits (in a list of steps, or in an Otherwise, it is an until / wait step)
const WAIT = { field: 'wait', word: '"wait until"' };
// the ids of the verbs' arguments (logic.json inputs[verb].args): on an action of a verb that does not take one, it
// changes nothing it does
const argIdsOf = (catalog) => new Set(Object.values(catalog.inputs || {}).flatMap((v) => (v.args || []).map((a) => a.id)));

// A rule whose explosion, or sound heard within a radius (c), has no object: it happens where the rule's actor is
// (UCLink.DoAct: Boom(Location), PlaySound from the link)
function happensAtRule(l) {
  return [...list(l.do), ...list(l.else)].some((x) => !x.target && !x.area && !x.targetTag && (x.verb === 'explode' || (x.verb === 'sound' && +x.c > 0)));
}

// What a rule uses that today's build does not run (phase, while, a Wait outside a list of steps): [{field, word}],
// each once, in the tables' order
export function laterFields(l) {
  const acts = l.steps ? [] : list(l.do);       // a list of steps, and an Otherwise (links.blocks: flow), run their waits
  return [...Object.entries(RULE_FIELDS).filter(([field, f]) => f.needs && !isDefault(l[field], f.dflt)).map(([field, f]) => ({ field, word: f.word })),
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
// a named group's objects (P3): those it holds; a group by tag (slice 11, filter.tag) those with the tag, as the game
// compares tags (case-insensitive), null when the page does not say which objects have which tag
// (a group of a kind or a faction, P9: the characters in it now, as the page found them (input.sets), null unknown)
export const isSetGroup = (item) => !!item && !!item.filter && typeof item.filter === 'object' && !!(item.filter.kind || item.filter.faction);
// what can start a rule on anyone of a kind or a faction (links.EVERY_WHENS): a character's, as the game rules look
export const SET_WHENS = ['killed', 'knockedout', 'dies', 'hurt', 'sees', 'turnshostile', 'findsbody'];
function groupMembers(item, tags, sets) {
  if (isSetGroup(item)) return sets ? (Array.isArray(own(sets, item.id)) ? own(sets, item.id) : []).filter((n) => typeof n === 'string') : null;
  const tag = item.filter && typeof item.filter === 'object' ? item.filter.tag : '';
  if (!tag) return [...(item.members || [])];
  if (!tags) return null;
  return Object.entries(tags).filter(([t]) => t.toLowerCase() === String(tag).toLowerCase()).flatMap(([, n]) => n);
}
function pieceActors(logic, catalog, tags, sets) {
  const out = {};
  for (const [key, [, kind]] of Object.entries(PIECE_KINDS)) {
    for (const item of list(own(logic, key))) {
      const family = key === 'blocks' ? item.kind : kind, spec = own(catalog.pieces, family) || { in: [], out: [] };
      const name = pieceId(key, key === 'signals' ? item.name : item.id), ports = { in: portsOf(spec, item, 'in'), out: portsOf(spec, item, 'out') };
      out[name] = { family, kind, item, ports, label: item.name || item.id, title: `${spec.noun || family} "${item.name || item.id}"`,
        format: spec.value || '', inputs: ports.in.map((p) => p.key), outputs: key === 'groups' && isSetGroup(item) ? [...SET_WHENS] : ports.out.map((p) => p.key),
        labels: Object.fromEntries([...ports.in, ...ports.out].map((p) => [p.key, p.label])),
        members: key === 'groups' ? groupMembers(item, tags, sets) : undefined,
        filter: key === 'groups' && item.filter && typeof item.filter === 'object' ? item.filter : undefined };
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
function contextOf(input, actors, canon) {
  const edits = input.edits || {}, actor = (n) => own(actors, n) || own(actors, canon(n));      // in any letter case
  return {
    name: (n) => (!n ? 'nothing' : own(SPECIAL, n) ? SPECIAL[n] : actor(n) ? actor(n).title || n : `${String(n).replace(QUALIFIED, '')} (missing)`),
    family: (n) => (actor(n) && actor(n).family) || 'other',
    word: (n) => ownAnyCase(own(edits.logic, 'words'), n) || (actor(n) && actor(n).word) || '',
    usable: (n) => !!ownAnyCase(edits.usable, n),
    optionText: (l) => ((actor(l.src) || {}).options || [])[+l.option || 0] || '',
    portLabel: (n, key) => own(actor(n) && actor(n).labels, key) || key.split(':')[1] || '?',
    itemName: (cls) => own(input.items, cls) || String(cls).split('.').pop(),
    groupName: (id) => (list(own(edits.logic, 'groups')).find((g) => g.id === id) || {}).name || '',
    // a dialogue's, an InfoLink's title (P5), "(missing)" when the Story given has no such one
    storyTitle: (key, id) => (!input.story ? String(id) : (actor(storyId(key, id)) || {}).label || `${id} (missing)`),
    // a Phases block (P3): its name in the flags and its phases ({id, text}), null when it is no such block
    phaseSet: (n) => (actor(n) && Array.isArray(actor(n).phases) ? { name: actor(n).stateName || actor(n).title || n, phases: actor(n).phases } : null),
    goalText: goalTexts(edits.links),
    // where a character is sent, by what stands there (input.placeName, app.js lkPointName): "runs to Path Node 2"
    placeName: typeof input.placeName === 'function' ? input.placeName : null,
  };
}

// A rule's causes (its own and its "also"), each a thing's output pin; its actions, each its id, its wire and the pin
// of what it acts on
// (a rule started by any of a named group, P3: on its first object, as the game builds it; its words say the group)
// (a rule waiting for a signal (P3): on the signal's hub, sig:<name>, not on the map)
// (a rule on a dialogue's end or an InfoLink heard (P5): out of that node's Ended / Heard, when the Story has it)
// (a rule on anyone of a kind or a faction (P9: no src, its group): out of the group's node)
function causesOf(l, hubs, storyIds, canon) {
  return [l, ...list(l.also)].map((c) => ({ src: c.when === 'start' ? '' : c.src || '', key: whenKey(c), cause: c,
    node: c.when === 'signal' && hubOf(hubs, c.signal) ? hubOf(hubs, c.signal) : storySource(c, storyIds)
      || (c.group && !c.src && c.when !== 'start' ? pieceId('groups', c.group) : thingId(c.when === 'start' ? '' : canon(c.src))),
    pin: 'out:' + whenKey(c) }));
}
const STORY_OUT = { ended: ['dialogues', 'dialogue'], heard: ['infolinks', 'infolink'] };
const storySource = (c, storyIds) => {
  const k = own(STORY_OUT, c.when) ? STORY_OUT[c.when] : null, id = k && c[k[1]] ? storyId(k[0], c[k[1]]) : null;
  return id && storyIds && storyIds.has(id) ? id : null;
};
// Signals as hubs (P3, the design's "one small hub node per signal"): every name the rules send ("Send a signal") or
// wait for, once whatever its case (the game's Tag UCS_<name> ignores it), as it was first written. {key: node id}
const signalKey = (name) => gameName(String(name ?? '').trim()).toLowerCase();
function signalHubs(links, story) {
  const out = new Map();
  const add = (n) => { const s = String(n ?? '').trim(); if (s && !out.has(signalKey(s))) out.set(signalKey(s), pieceId('signals', s)); };
  for (const l of links) {
    for (const c of [l, ...list(l.also)]) if (c.when === 'signal') add(c.signal);
    for (const x of [...list(l.do), ...list(l.else)]) if (x.verb === 'signal') add(x.a);
  }
  // the Story's signals (P5): its dialogues', events' and InfoLinks' "Send a signal"
  for (const key of ['dialogues', 'events', 'infolinks']) for (const item of list((story || {})[key])) for (const a of storyActions(item)) if (a.type === 'signal') add(a.signal);
  return out;
}
const hubOf = (hubs, name) => (hubs && String(name ?? '').trim() ? hubs.get(signalKey(name)) || null : null);
// a signal's hub in the index (its name written either way), null when no rule or Story part names it
export const signalHub = (ix, name) => hubOf(ix.hubs, name);
// a hub as a thing of the map: what a sentence calls it, its two pins' words (logic.json pieces.signal)
function hubActors(hubs, catalog) {
  const spec = own(own(catalog, 'pieces'), 'signal') || {}, say = (side, k) => ((list(spec[side])[0] || {}).label || k);
  return Object.fromEntries([...hubs.values()].map((id) => {
    const name = id.slice(PIECE_KINDS.signals[0].length);
    return [id, { family: 'signal', kind: 'signal', label: name, title: `the signal "${name}"`, hub: { in: say('in', 'send it'), out: say('out', 'it is sent') },
      inputs: ['signal'], outputs: ['signal'] }];
  }));
}
// what set the rule's run off (UCRule: @by, @it) is no object of the map: no node, no wire, its words in the row
const SPECIAL = { '@by': 'whoever set it off', '@it': 'the object it happened to' };
// a rule's dialogue to start, InfoLink to play (P5): the Story's node and its pin (STORY_PINS)
const STORY_IN = { talk: ['dialogues', 'in:start'], infolink: ['infolinks', 'in:play'] };
const storyTarget = (x, storyIds) => (own(STORY_IN, x.verb) && x.a && storyIds && storyIds.has(storyId(STORY_IN[x.verb][0], x.a))
  ? storyId(STORY_IN[x.verb][0], x.a) : null);
function targetOf(rule, x, id, hubs, storyIds, canon) {
  if (x.verb === 'signal' && hubOf(hubs, x.a)) return hubOf(hubs, x.a);      // sending a signal (P3): into its hub
  if (storyTarget(x, storyIds)) return storyTarget(x, storyIds);
  if (x.area) return `${GROUP_KINDS.area}${rule}/${id}`;
  if (x.targetTag) return GROUP_KINDS.tag + x.targetTag;
  if (x.group) return pieceId('groups', x.group);         // a named group (P3): its own node
  return x.target && !own(SPECIAL, x.target) ? thingId(canon(x.target)) : null;
}
function actsOf(l, acts, prefix, hubs, storyIds, canon) {
  const ids = actionIds(acts, prefix);
  return acts.map((x, j) => ({ x, j, id: ids[j], wire: actId(l.id, ids[j]), node: targetOf(l.id, x, ids[j], hubs, storyIds, canon),
    pin: storyTarget(x, storyIds) ? STORY_IN[x.verb][1] : targetOf(l.id, x, ids[j], hubs, storyIds, canon) ? 'in:' + verbKey(x) : null }));
}
function ruleEntry(l, hubs, storyIds, canon) {
  return { l, id: l.id, node: ruleId(l.id), causes: causesOf(l, hubs, storyIds, canon), acts: actsOf(l, list(l.do), 'a', hubs, storyIds, canon),
    otherwise: actsOf(l, list(l.else), 'e', hubs, storyIds, canon), simple: isSimple(l) };
}

// The Story's dialogues, InfoLinks and events as read-only nodes: their states (story-state.js reads them, one item
// at a time so each use keeps its node) and the actions they take, as a rule's (logic.json "story": their words).
function storyActions(item) {
  // (a dialogue's signal step (P5) is one of them, where it is in the dialogue)
  const steps = list(item.steps).flatMap((s) => (s.type === 'do' ? list(s.do) : s.type === 'signal' ? [s] : []));
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
    case 'signal': return { verb: 'signal', a: a.signal || '' };
    case 'act': return { ...(a.act || {}), verb: (a.act && a.act.verb) || '?' };     // a Logic action (P5): the rule's own
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
// the counters a formula reads (P9 slice 5: "Alarms + 1" reads Alarms); none for a number or a bad one
function formulaCounters(v) {
  if (!isFormula(v)) return [];
  try { return gameNumber(v).slice(1).split(',').filter((t) => t.startsWith('@')).map((t) => t.slice(1)); } catch (e) { if (e instanceof FormulaError) return []; throw e; }
}
// the amounts that take a formula (logic.json "formula")
const FORMULA_ARGS = { count: 'b', skillpoints: 'a', credits: 'a', health: 'a', energy: 'a' };

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
      for (const n of formulaCounters(c && c.value)) add(n, 'int', 'readers', use);
    });
    const watch = r.l.watch;          // a condition watched by "becomes" / "changes": its state or counter, its formula's
    if (watch && typeof watch === 'object') {
      const use = { node: r.node, pin: null, rule: r.id, text: who };
      if (kindOf(watch) === 'flag') add(watch.flag, 'bool', 'readers', use);      // (12 Nov 2026: was "Nothing reads")
      if (kindOf(watch) === 'counter') add(watch.counter, 'int', 'readers', use);
      for (const n of formulaCounters(watch.value)) add(n, 'int', 'readers', use);
    }
    // the conditions of its steps: an If, a Wait until, an action's own check, in its list and its Otherwise (13 Nov
    // 2026, Deep Ops: "if RookGaveCode" on the keypad, and still "Nothing reads the state RookGaveCode")
    for (const x of [...list(r.l.do), ...list(r.l.else)]) {
      const use = { node: r.node, pin: null, rule: r.id, text: who };
      for (const c of [...list(x && x.requires), ...(x && x.until && typeof x.until === 'object' ? [x.until] : [])]) {
        if (kindOf(c) === 'flag') add(c.flag, 'bool', 'readers', use);
        if (kindOf(c) === 'counter') add(c.counter, 'int', 'readers', use);
        for (const n of formulaCounters(c && c.value)) add(n, 'int', 'readers', use);
      }
    }
    for (const act of [...r.acts, ...r.otherwise]) {
      const use = { node: r.node, pin: act.wire, rule: r.id, text: who };
      if (act.x.verb === 'flag') add(act.x.a, 'bool', 'setters', use);
      if (act.x.verb === 'count') add(act.x.a, 'int', 'setters', use);
      if (Object.hasOwn(FORMULA_ARGS, act.x.verb)) for (const n of formulaCounters(act.x[FORMULA_ARGS[act.x.verb]])) add(n, 'int', 'readers', use);
    }
  }
  for (const s of ix.story) {
    // (a dialogue's Played and an InfoLink's Heard are set by the game itself: auto)
    const text = ix.ctx.name(s.node);
    for (const st of s.states) {
      for (const u of st.uses) add(st.flag, st.type, u.kind === 'read' ? 'readers' : 'setters', { node: s.node, pin: null, text, auto: u.kind === 'automatic' });
      if (st.label && st.source === 'automatic' && st.uses.length) entry(st.flag, st.type).label ||= st.label;   // "Rook at the docks · Played"
    }
  }
  // what the logic blocks keep in the flags: set as the map runs (automatic: not "never read" when nothing reads it)
  for (const k of list(ix.input.keeps)) {
    if (!ix.gone.has(k.block)) add(k.name, k.type === 'int' ? 'int' : 'bool', k.reads ? 'readers' : 'setters', { node: actorOf(ix, k.block) ? ix.canon(k.block) : null, pin: null, text: k.text || k.block, auto: !k.reads });
  }
  for (const st of list(ix.input.external)) {
    const elsewhere = list(st.uses).filter((u) => u.map !== (ix.input.map || ''));
    if (!elsewhere.length && flagCategory(st) !== 'original') continue;
    const e = entry(st.flag || st.name, st.type === 'int' ? 'int' : 'bool');
    // a dialogue's Played, an InfoLink's Heard by its title, and the map it is on (13 Nov 2026, Deep Ops: the list said
    // "UCEdc36e_i1_Heard")
    if (st.label && st.source === 'automatic' && elsewhere.length) e.label ||= `${st.label} (${elsewhere[0].map})`;
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
  const edits = input.edits || {}, logic = edits.logic || {}, links = list(edits.links).filter((l) => l.id), hubs = signalHubs(links, input.story);
  const actors = { ...hubActors(hubs, input.catalog), ...pieceActors(logic, input.catalog, input.tags, input.sets), ...storyActors(input.story), ...(input.actors || {}) };
  const storyIds = new Set(Object.keys(storyActors(input.story))), canon = spellings(actors);
  const ix = { input, catalog: input.catalog, vocab: vocabOf(input.catalog), argIds: argIdsOf(input.catalog), edits, logic, actors, canon, ctx: contextOf(input, actors, canon),
    gone: new Caseless(Object.keys(edits.deleted || {})), off: new Caseless(Object.keys(edits.disabled || {}).filter((n) => edits.disabled[n])),
    hubs, rules: links.map((l) => ruleEntry(l, hubs, storyIds, canon)), story: storyEntries(input) };
  ix.states = stateIndex(ix);
  return ix;
}
// what the page knows of an object (or an item of the logic): by its name, else in any letter case (spellings above)
export const actorOf = (ix, name) => own(ix.actors, name) || (ix.canon ? own(ix.actors, ix.canon(name)) : undefined);
// an object of the map (or an item of the logic) that is there: not deleted, known
export const present = (ix, name) => !!actorOf(ix, name) && !ix.gone.has(name);

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
  const what = u.type === 'arrived' ? `${ix.ctx.name(u.actor)} arrives`
    : u.type === 'ended' ? `the dialogue "${ix.ctx.storyTitle('dialogues', u.dialogue || '?')}" has ended`        // P5
    : u.type === 'heard' ? `the InfoLink "${ix.ctx.storyTitle('infolinks', u.infolink || '?')}" has been heard`
    : kindOf(u) ? conditionText(u, conditionNames(ix.ctx)) : 'the wait';
  return `After ${what}${+x.max > 0 ? ` (at most ${+x.max} s)` : ''}:`;
}
// the rows of a list in sections: a wait starts one, the rows of each in time order (links.blocks sorts them so).
// A list of steps (rule.steps, action-list.js): its rows in their order, each with its depth in If blocks and, for
// If / Otherwise / End, its flow; a Wait of its own is a row, a Wait until starts a section the game now runs
function sectionsOf(acts, ix, steps = false) {
  const out = [{ title: '', rows: [] }];
  let depth = 0;
  for (const act of acts) {
    const v = act.x.verb, flow = ['if', 'else', 'end'].includes(v) ? v : '';
    if (v === 'wait' && (!steps || act.x.until)) { out.push({ title: sectionTitle(act.x, ix), wait: act.wire, needs: steps ? '' : V2, rows: [] }); continue; }
    if (flow === 'else' || flow === 'end') depth = Math.max(0, depth - 1);
    const row = rowOf(act, ix);
    if (steps) Object.assign(row, { depth, flow, pause: v === 'wait' });
    out[out.length - 1].rows.push(row);
    if (flow === 'if' || flow === 'else') depth++;
  }
  if (!steps) for (const s of out) s.rows.sort((p, q) => p.time - q.time);
  return out.filter((s, k) => k === 0 || s.rows.length || s.title);
}
// A rule card (an articy fragment crossed with a PlayMaker state)
function cardOf(r, ix) {
  const l = r.l;
  return { id: r.node, kind: 'rule', rule: r.id, readOnly: false, muted: !!l.mute,
    causes: r.causes.map((c) => ({ node: c.node, pin: c.pin, text: ix.vocab.whenText(c.cause, ix.ctx), short: shortOf(ix, c) })),
    badges: ruleBadges(l, ix), match: l.match === 'any' ? 'any' : 'all', checks: list(l.requires).map((c, i) => chipOf(c, i, ix)),
    sections: sectionsOf(r.acts, ix, !!l.steps), otherwise: sectionsOf(r.otherwise, ix)[0].rows, sentence: ix.vocab.sentence(l, ix.ctx),
    otherwiseOf: l.otherwiseOf || null,
    pos: posOf(ix, r.node) };
}
// A simple rule as a wire from its cause's pin to its object's input: "the player uses it → Open", its badges
function collapsedOf(r, ix) {
  const c = r.causes[0], act = r.acts[0];
  return { id: r.node, kind: kindOfWire(c.node, act.node), part: 'rule', rule: r.id, act: act.id, muted: !!r.l.mute,
    from: { node: c.node, pin: c.pin }, to: { node: act.node, pin: act.pin },
    label: `${shortOf(ix, c)} → ${ix.vocab.inputLabel(verbKey(act.x), act.x.target, ix.ctx)}`,
    badges: [...ruleBadges(r.l, ix, true), ...actionBadges(act.x, ix, true)], sentence: ix.vocab.sentence(r.l, ix.ctx) };
}
// a cause's short words: a signal's hub says "it is sent"
const shortOf = (ix, c) => ((own(ix.actors, c.node) || {}).hub || {}).out || comesShort(c, ix) || ix.vocab.whenLabel(c.key, c.src, ix.ctx);
// a condition that says how it comes true (conditions.js comesText): "the player enters water", not "a condition
// becomes true"
const comesShort = (c, ix) => {
  const l = c.cause;
  if (!l || l.when !== 'becomes' || l.while || !l.watch || typeof l.watch !== 'object') return '';
  try {
    const comes = comesText(l.watch, { item: ix.ctx.itemName });
    if (comes) return comes;
    // a state or a counter: the card says which one ("When Alarm is Yes"), not two cards "When a condition becomes true"
    return ['flag', 'counter'].includes(kindOf(l.watch)) ? conditionText(l.watch, conditionNames(ix.ctx)) : '';
  } catch { return ''; }
};
const kindOfWire = (from, to) => ([from, to || ''].some((id) => id.startsWith(PIECE_KINDS.signals[0])) ? 'signal' : 'causes');
const posOf = (ix, id) => own(own(own(ix.logic, 'view'), 'pos'), id) || null;

// A node for a thing (a map object, the World, an item of the logic, a group made on the spot), its pins added as
// they are used
function thingNode(ix, id) {
  if (id === 'world') return { id, kind: 'world', name: '', label: 'The map', word: '', family: 'world', pins: { out: [], in: [] }, pos: posOf(ix, id) };
  if (isGroup(id)) return { id, kind: 'group', unnamed: true, name: id, label: '', word: 'group', family: 'group', members: [], pins: { out: [], in: [] }, pos: posOf(ix, id) };
  const name = id.startsWith(OBJECT) ? id.slice(OBJECT.length) : id, a = actorOf(ix, name) || {};
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
// (a signal's hub: "it is sent" out, "send it" in)
const pieceLabel = (ix, key, name, side) => { const a = actorOf(ix, name); return a && a.hub ? a.hub[side] : a && a.ports ? own(a.labels, key) : undefined; };
const outLabel = (ix, key, name) => pieceLabel(ix, key, name, 'out') || ix.vocab.whenLabel(key, name, ix.ctx);
const inLabel = (ix, key, name) => pieceLabel(ix, key, name, 'in') || ix.vocab.inputLabel(key, name, ix.ctx);
// the pins not in use, for "+ Show all": what it offers at the disclosure level (a script's own ports always)
function allPins(ix, node, level) {
  const a = actorOf(ix, node.name);
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
    target: act.x.verb === 'signal' ? hubOf(ix.hubs, act.x.a) : act.x.target ? thingId(ix.canon(act.x.target)) : null,      // a signal: its hub (P5)
    pin: act.x.target ? 'in:' + act.x.verb : null, key: act.x.verb, badges: [] }));
  return { id: s.node, kind: s.kind, word: own(ix.actors, s.node).word, readOnly: true, title: it.title || it.id, disabled: !!it.disabled, first: first ? first.text || '' : '',
    owner: it.owner ? thingId(ix.canon(it.owner)) : null, caller: it.name || it.caller || '',
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
    const hub = (id) => (own(ix.actors, id) || {}).hub;                  // a signal's hub names its own pins
    for (const c of r.causes) pinOut(c.node, c.key, hub(c.node) ? c.node : c.src);
    for (const act of [...r.acts, ...r.otherwise].filter((a) => a.node)) {
      if (node(act.node).readOnly) continue;                             // the Story's: its own pins (STORY_PINS)
      pinIn(act.node, verbKey(act.x), hub(act.node) ? act.node : act.x.target);
      if (act.x.area || act.x.targetTag) Object.assign(node(act.node), groupOf(ix, act.x));
    }
    if (r.simple && !open.has(r.id)) { wires.push(collapsedOf(r, ix)); continue; }
    const card = cardOf(r, ix);
    nodes.set(card.id, card);
    // the map's "a condition becomes true" into a rule that watches a state or a counter: drawn, but the layout puts the
    // card by the rules that set that state (graph-layout.js weak 'tie'), not in a column after the map
    const watchesState = (r.l.when === 'becomes' || r.l.when === 'changes') && r.l.watch && typeof r.l.watch === 'object' && (r.l.watch.flag || r.l.watch.counter);
    card.causes.forEach((c, i) => wires.push({ id: `${r.node}/cause${i}`, kind: kindOfWire(c.node, ''), part: 'when', rule: r.id,
      from: { node: c.node, pin: c.pin }, to: { node: card.id, pin: 'cause:' + i }, ...(watchesState && c.node === 'world' ? { layout: 'tie' } : {}) }));
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
  if (x.targetTag) {                     // its members as the game compares tags (UCObjectTag.Matches: case-insensitive)
    const tags = ix.input.tags, want = String(x.targetTag).toLowerCase();
    const members = tags ? Object.entries(tags).filter(([t]) => t.toLowerCase() === want).flatMap(([, n]) => n) : null;
    return { label: fill(S.tagged, { tag: x.targetTag }), members: members && members.length ? members : (tags ? [] : null) };
  }
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
      const pin = usePin(node(n.owner), 'out', 'story:' + how, how === 'near' ? 'the player gets close (dialogue)' : 'the player talks to them (dialogue)');
      wires.push({ id: `${s.node}/start`, kind: 'causes', part: 'story', readOnly: true, from: { node: n.owner, pin }, to: { node: s.node, pin: 'in:start' } });
    }
    for (const row of n.rows.filter((x) => x.target)) {
      // into a dialogue's Start or an InfoLink's Play; into an object's input, as a rule's
      const to = node(row.target), pin = to.readOnly ? (to.pins.in[0] || {}).id || null : usePin(to, 'in', row.key, inLabel(ix, row.key, to.name));
      wires.push({ id: row.id, kind: kindOfWire(s.node, row.target), part: 'story', readOnly: true, from: { node: s.node, pin: row.id }, to: { node: row.target, pin } });
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
    const from = thingId(ix.canon(w.from)), to = thingId(ix.canon(w.to));
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
