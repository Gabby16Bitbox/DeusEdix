// What is wrong with a map's logic, and where (the design's "debugging" 1, "Problems where they are"): each problem a
// sentence, its level (error: the game will not do it; warn: it may not do what the author thinks; info), the node,
// rule, action and pin it belongs to, and its fix when there is one. The Logic window's badges and Problems list read
// them; phase B's Check map too, so that there is one list. Pure: tests/test_logic_graph_problems.mjs.
import { verbKey } from './logic-vocab.js';
import { conditionProblem, kindOf, CONDITION_KINDS, MAX_CONDITIONS } from './conditions.js';
import { laterFields, present, thingId, ruleId, pieceId } from './logic-graph-model.js';

const own = (table, key) => (table && Object.hasOwn(table, key) ? table[key] : undefined);
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const words = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

export const MAX_ACTS = 24;                    // a rule's actions (links.py MAX_ACTS, UCLink.Act[24])
// the fixes a problem offers: what its button says (the page does it)
export const FIXES = { lock: 'Lock it', set: 'Make something set it', remove: 'Remove the rule', removeAction: 'Remove the action' };
// an action that names nothing (links.py builds it with none, the game says noname: logic-log.js)
const NO_NAME = { count: 'The counter has no name.', flag: 'No state chosen.', goal: 'The goal has no name.' };
// the actions that open a door (a door opened by logic should be locked, at the start or by a rule's lock)
const OPENS = new Set(['open', 'toggle', 'unlock']);
// What the game does with a verb on an object whose family does not offer it (UCLink.DoAct). A verb that needs no
// object (logic.json inputs[verb].target false: a sound, an explosion) happens at whatever it is given. These work on
// any actor: hide and show switch its look and collision, an effect plays at it. On and off pass it Trigger and
// UnTrigger, which its class may ignore: a warning. Any other verb needs its family's class (an animation: a UCMotion
// or a door, UCLink.Animate).
const ANY_ACTOR = new Set(['hide', 'show', 'effect']);
const TRIGGERS = new Set(['on', 'off']);
// The outputs a rule hears on its object's Event (logic.json outputs[when].hears 'event') that run on any Trigger of
// it (UCLink.Trigger), but closed and leave (they come on UnTrigger) and destroyed (a door's only)
const NOT_ON_TRIGGER = new Set(['closed', 'leave', 'destroyed']);
// An action that sets its object off again at once only after a rule stops it: a cutscene played while it plays is
// left alone or queued (UCCutscene.Play), so a loop of plays goes round only with a stop in it
const NEEDS_STOP = { cutplay: 'cutstop' };

// Every problem of the map's logic: [{level, code, text, node, rule?, act?, pin?, wire?, fix?}]. ix: logicIndex;
// game: the project's game ('revision', 'vanilla': logic.json games), to name what it cannot run.
export function logicProblems(ix, { game = '' } = {}) {
  const out = [];
  const add = (level, code, text, at) => out.push({ level, code, text, ...at });
  for (const r of ix.rules) ruleProblems(ix, r, add, game);
  stateProblems(ix, add);
  doorProblems(ix, add);
  cycleProblems(ix, add);
  pieceProblems(ix, add);
  return out;
}
// the problems of each node and wire, for their badges
export function problemsByNode(problems) {
  const out = new Map();
  for (const p of problems) for (const id of [p.node, p.wire].filter(Boolean)) (out.get(id) || out.set(id, []).get(id)).push(p);
  return out;
}

// a rule: its causes, its conditions, its actions, what today's runtime leaves out
function ruleProblems(ix, r, add, game) {
  const at = { node: r.node, rule: r.id };
  for (const c of r.causes) {
    if (!c.src) continue;
    const a = own(ix.actors, c.src);
    if (!present(ix, c.src)) { add('error', 'no-source', `${c.src} is not in the map any more: the rule never runs.`, { ...at, fix: 'remove' }); continue; }
    if (ix.off.has(c.src)) { add('info', 'source-disabled', `${ix.ctx.name(c.src)} is disabled in the game: the rule is not built.`, at); return; }
    if (Array.isArray(a.outputs) && !a.outputs.includes(c.key)) {
      const same = onTrigger(ix, c.key) && a.outputs.find((key) => onTrigger(ix, key));
      if (same) add('warn', 'same-event', `${ix.ctx.name(c.src)} does not offer "${ix.vocab.outputLabel(c.cause.when)}", but the rule hears its event: it runs when "${ix.vocab.outputLabel(same)}" happens.`, at);
      else add('error', 'cannot-output', cannotSay(ix, c, a), at);
    }
    if (game && !ix.vocab.worksIn('output', c.cause.when, game)) add('error', 'not-in-game', `"${ix.vocab.outputLabel(c.cause.when)}" does not work in this game.`, at);
  }
  if (!r.acts.length) add('warn', 'nothing-yet', 'It does nothing yet.', at);
  const reqs = list(r.l.requires);
  if (reqs.length > MAX_CONDITIONS) add('error', 'too-many-conditions', `It has ${reqs.length} conditions: the game checks ${MAX_CONDITIONS} at most.`, at);
  reqs.forEach((c, i) => {
    const why = CONDITION_KINDS.some(([k]) => k === kindOf(c)) ? conditionProblem(c) : 'a kind the game classes do not know';
    if (why) add('error', 'unfinished-condition', `A condition is not finished (${why}).`, { ...at, pin: 'if:' + i });
  });
  if (r.acts.length > MAX_ACTS) add('error', 'too-many-actions', `It has ${r.acts.length} actions: a rule takes ${MAX_ACTS} at most.`, at);
  for (const act of [...r.acts, ...r.otherwise]) actionProblems(ix, r, act, add, game);
  const later = laterFields(r.l);
  if (later.length) add('warn', 'needs-runtime', `It uses ${words(later.map((f) => f.word))}: they need Logic runtime v2, and today's build ignores them.`, at);
}
// an output the rule hears on any Trigger of its object's Event
const onTrigger = (ix, when) => (own(ix.catalog.outputs, when) || {}).hears === 'event' && !NOT_ON_TRIGGER.has(when);
// "the body Body1 never says ...: a body fires no event of its own" (the family's own note when it has one)
function cannotSay(ix, c, a) {
  if (c.cause.when === 'output') return `${ix.ctx.name(c.src)} has no output "${c.cause.port || ''}" any more.`;
  const note = ((ix.catalog.families || []).find((f) => f.id === a.family) || {}).note || '';
  return `"${ix.vocab.outputLabel(c.cause.when)}" never happens to ${ix.ctx.name(c.src)}.${note ? ' ' + note : ''}`;
}
function actionProblems(ix, r, act, add, game) {
  const x = act.x, at = { node: r.node, rule: r.id, act: act.id, wire: act.wire };
  if (x.verb === 'wait') return;                         // a wait is Logic runtime v2's (laterFields)
  const verb = own(ix.catalog.inputs, x.verb);
  if (!verb) { add('error', 'unknown-verb', `"${x.verb}" is not an action the game classes know.`, at); return; }
  if (x.target && !x.area && !x.targetTag) {
    const a = own(ix.actors, x.target);
    if (!present(ix, x.target)) add('error', 'no-target', `${x.target} is not in the map any more.`, { ...at, fix: 'removeAction' });
    else if (ix.off.has(x.target)) add('warn', 'target-disabled', `${ix.ctx.name(x.target)} is disabled in the game: this action does nothing.`, at);
    else if (Array.isArray(a.inputs) && !a.inputs.includes(verbKey(x)) && verb.target && !ANY_ACTOR.has(x.verb)) {
      if (TRIGGERS.has(x.verb)) add('warn', 'may-ignore', `${ix.ctx.name(x.target)} may ignore "${ix.vocab.verbLabel(x.verb)}": the game only passes it a trigger, and its class decides.`, at);
      else add('error', 'cannot-input', cannotDo(ix, x, a), at);
    }
  }
  // (logic.json inputs[verb].target: the action needs an object; without one the game does nothing: fail cannot)
  if (verb.target && !x.target && !x.area && !x.targetTag) add('error', 'no-object', `"${ix.vocab.verbLabel(x.verb)}" has no object.`, at);
  if (own(NO_NAME, x.verb) && !String(x.a || '').trim()) add('error', 'no-name', NO_NAME[x.verb], at);
  if (x.verb === 'sit') {
    const seat = own(ix.actors, x.a);
    if (!x.a || !present(ix, x.a)) add('error', 'no-seat', 'Choose a chair that is in the map.', at);
    else if (ix.off.has(x.a)) add('warn', 'seat-disabled', 'The chosen chair is disabled in the game.', at);
    else if (Array.isArray(seat.chain) && !seat.chain.includes('Seat')) add('error', 'not-seat', 'Choose a game seat from Objects; geometry alone has no seat points.', at);
  }
  if (game && !ix.vocab.worksIn('verb', x.verb, game)) add('error', 'not-in-game', `"${ix.vocab.verbLabel(x.verb)}" does not work in this game.`, at);
}
// "the light Lamp1 cannot Open: try Turn on or off" (its usual input); a script's renamed input
function cannotDo(ix, x, a) {
  if (x.verb === 'input') return `${ix.ctx.name(x.target)} has no input "${x.a || ''}" any more.`;
  const usual = (a.inputs || [])[0];
  return `${ix.ctx.name(x.target)} cannot ${ix.vocab.verbLabel(x.verb)}${usual ? `: try ${ix.vocab.inputLabel(usual, x.target, ix.ctx)}` : ''}.`;
}

// a state or counter read and never set (it keeps its start value), or set and never read
function stateProblems(ix, add) {
  for (const s of ix.states.values()) {
    const what = s.type === 'int' ? `the counter ${s.name}` : `the state ${s.name}`;
    const sets = s.setters.length || s.elsewhere.some((u) => u.kind === 'write');
    const reads = s.readers.length || s.elsewhere.some((u) => u.kind === 'read');
    if (!sets) for (const u of s.readers) add('warn', 'never-set', `Nothing sets ${what}, so it stays ${s.type === 'int' ? '0' : 'No'}.`, { node: u.node, pin: u.pin, rule: u.rule, state: s.name, fix: 'set' });
    if (!reads && s.setters.some((u) => !u.auto)) {
      for (const u of s.setters.filter((v) => v.node && !v.auto)) add('info', 'never-read', `Nothing reads ${what}.`, { node: u.node, pin: u.pin, rule: u.rule, state: s.name });
    }
  }
}

// a door opened by logic that is not locked: JC can open it by hand anyway (one problem per door, its "Lock it")
function doorProblems(ix, add) {
  const opened = new Map(), locked = new Set();
  const acts = [...ix.rules.flatMap((r) => [...r.acts, ...r.otherwise].map((act) => [r.id, act.x])), ...ix.story.flatMap((s) => s.acts.map((act) => [s.node, act.x]))];
  for (const [by, x] of acts) {
    if (x.verb === 'lock') locked.add(x.target);
    if (OPENS.has(x.verb) && x.target) (opened.get(x.target) || opened.set(x.target, []).get(x.target)).push(by);
  }
  for (const [name, by] of opened) {
    const a = own(ix.actors, name);
    if (!a || a.family !== 'door' || a.locked !== false || a.frobbable === false || locked.has(name)) continue;
    add('warn', 'not-locked', `${ix.ctx.name(name)} opens by logic (${words([...new Set(by)])}) but is not locked: JC can open it by hand.`, { node: thingId(name), fix: 'lock' });
  }
}

// Rules that set each other off with no time between (logic.json setsOff: what an action makes its object say again
// at once) run again every tick, for ever. Not one: a rule setting off itself (it is still running and skips), a
// loop through a rule that runs once (UCLink.RunRule refuses it the second time), a loop of cutscenes played with no
// rule of it stopping one (NEEDS_STOP).
function cycleProblems(ix, add) {
  const rules = ix.rules.filter((r) => !r.l.once);                          // truthy, as links.py writes bOnce
  const next = new Map(rules.map((r) => [r.id, []]));                       // id -> [{to, verb}]
  for (const r of rules) {
    const wait = r.acts.findIndex((act) => act.x.verb === 'wait');            // after a wait, time has passed
    for (const act of (wait < 0 ? r.acts : r.acts.slice(0, wait)).filter((a) => !(+a.x.delay > 0) && a.node)) {
      const says = own(ix.catalog.setsOff, act.x.verb) || [];
      const said = (key) => says.includes(key) || (says.includes('output') && key.startsWith('output:'));
      for (const other of rules) if (other !== r && other.causes.some((c) => c.node === act.node && said(c.key))) next.get(r.id).push({ to: other.id, verb: act.x.verb });
    }
  }
  const byId = new Map(rules.map((r) => [r.id, r]));
  const stops = (id, verb) => byId.get(id).acts.some((act) => act.x.verb === NEEDS_STOP[verb]);
  for (const loop of loops(next, stops)) {
    for (const id of loop) add('warn', 'zero-delay-cycle', `${words(loop)} set each other off with no delay: they run again every tick, for ever.`, { node: ruleId(id), rule: id });
  }
}
// The loops of a graph {id: [{to, verb}]}: its strongly connected components of more than one rule, once the edges of
// an action that needs a stop (NEEDS_STOP) are left out of each loop where no rule stops (stops(id, verb)), again
// until none is left out
function loops(next, stops) {
  for (;;) {
    const found = components(next).filter((c) => c.length > 1), loopOf = new Map(found.flatMap((c, k) => c.map((id) => [id, k])));
    const kept = (id, e) => !own(NEEDS_STOP, e.verb) || loopOf.get(id) === undefined || loopOf.get(id) !== loopOf.get(e.to)
      || found[loopOf.get(id)].some((other) => stops(other, e.verb));
    if ([...next].every(([id, out]) => out.every((e) => kept(id, e)))) return found;
    next = new Map([...next].map(([id, out]) => [id, out.filter((e) => kept(id, e))]));
  }
}
// the strongly connected components of a graph {id: [{to}]} (Tarjan), each in the order its ids were met
function components(next) {
  const index = new Map(), low = new Map(), stack = [], on = new Set(), out = [];
  let k = 0;
  const visit = (v) => {
    index.set(v, k); low.set(v, k); k++; stack.push(v); on.add(v);
    for (const { to: w } of next.get(v) || []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) !== index.get(v)) return;
    const c = [];
    for (let w = null; w !== v;) { w = stack.pop(); on.delete(w); c.push(w); }
    out.push(c.reverse());
  };
  for (const v of next.keys()) if (!index.has(v)) visit(v);
  return out;
}

// the logic's own items: a block input nothing wires to, an "All of" of one input, a phase nobody goes to
function pieceProblems(ix, add) {
  const used = new Map();                                   // node -> the inputs the rules reach on it
  for (const act of ix.rules.flatMap((r) => [...r.acts, ...r.otherwise]).filter((a) => a.node)) (used.get(act.node) || used.set(act.node, new Set()).get(act.node)).add(verbKey(act.x));
  const reached = (node, key) => !!used.get(node) && used.get(node).has(key);
  for (const b of list(own(ix.logic, 'blocks'))) {
    const node = pieceId('blocks', b.id), a = own(ix.actors, node);
    if (['allof', 'anyof', 'firstof'].includes(b.kind) && +b.inputs === 1) add('warn', 'one-input', `${ix.ctx.name(node)} has one input: a plain wire does the same.`, { node });
    for (const p of a.ports.in.filter((q) => q.of === 'in' && !reached(node, q.key))) add('warn', 'unwired-input', `Nothing reaches ${p.label} of ${ix.ctx.name(node)}.`, { node, pin: 'in:' + p.key });
  }
  for (const ph of list(own(ix.logic, 'phases'))) {
    const node = pieceId('phases', ph.id), first = ph.start || (ph.list || [])[0];
    for (const p of own(ix.actors, node).ports.in.filter((q) => q.of === 'goto' && q.name !== first && !reached(node, q.key))) {
      add('info', 'phase-never-entered', `Nothing makes ${ix.ctx.name(node)} go to ${p.name}.`, { node, pin: 'in:' + p.key });
    }
  }
}
