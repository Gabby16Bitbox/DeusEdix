// What is wrong with a map's logic, and where (the design's "debugging" 1, "Problems where they are"): each problem a
// sentence, its level (error: the game will not do it; warn: it may not do what the author thinks; info), the node,
// rule, action and pin it belongs to, and its fix when there is one. The Logic window's badges and Problems list read
// them; phase B's Check map too, so that there is one list. Pure: tests/test_logic_graph_problems.mjs.
import { verbKey } from './logic-vocab.js';
import { conditionProblem, kindOf, CONDITION_KINDS, MAX_CONDITIONS } from './conditions.js';
import { negate, FLOW } from './action-list.js';
import { usesValue } from './logic-numbers.js';
import { laterFields, present, thingId, ruleId, pieceId, PIECE_KINDS, storyId, signalHub, isSetGroup, SET_WHENS } from './logic-graph-model.js';

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
  signalProblems(ix, add);
  return out;
}
// the problems of each node and wire, for their badges
export function problemsByNode(problems) {
  const out = new Map();
  for (const p of problems) for (const id of [p.node, p.wire].filter(Boolean)) (out.get(id) || out.set(id, []).get(id)).push(p);
  return out;
}

// a named group reaches something: one of its objects is in the map (a group by tag: one with the tag, when the page
// says; by radius with newcomers: always, they may come)
function groupReaches(ix, g) {
  const f = g.filter && typeof g.filter === 'object' ? g.filter : null;
  if (f && f.area && f.area.dynamic) return true;
  if (isSetGroup(g)) return true;                 // a kind, a faction (P9): the game finds them as it plays, newcomers too
  const members = (own(ix.actors, pieceId('groups', g.id)) || {}).members;
  return members === null || (members || g.members || []).some((n) => present(ix, n));
}
// a rule: its causes, its conditions, its actions, what today's runtime leaves out
function ruleProblems(ix, r, add, game) {
  const at = { node: r.node, rule: r.id };
  if (r.l.group) {                    // started by any of a named group (P3): the group must have something in the map
    const g = own(ix.actors, pieceId('groups', r.l.group));
    if (!g) add('error', 'no-group', 'Its group no longer exists: the rule never runs.', at);
    else if (isSetGroup(g.item) && !r.l.src) {          // anyone of a kind or a faction (P9, UCRule Every)
      if (!SET_WHENS.includes(r.l.when)) add('error', 'set-when', `The group "${g.label}" is a kind or a faction: a rule on it starts when one of them is killed, knocked out, hurt, sees the player, turns hostile or finds a body, not on "${ix.vocab.outputLabel(r.l.when)}".`, at);
      else if (Array.isArray(g.members) && !g.members.some((n) => present(ix, n))) add('info', 'set-empty', `No character of the group "${g.label}" is in the map now: the rule runs for those that come later.`, at);
    } else if (g.filter && g.filter.tag) add('error', 'group-by-tag', `The group "${g.label}" is everything tagged ${g.filter.tag}: it keeps no objects, so no rule can start on it.`, at);
    else if (!(g.members || []).some((n) => present(ix, n))) add('error', 'group-empty', `The group "${g.label}" has nothing in the map: the rule never runs.`, at);
  }
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
  storyProblems(ix, r, add, at);
  if (!r.acts.length) add('warn', 'nothing-yet', 'It does nothing yet.', at);
  const reqs = list(r.l.requires);
  if (reqs.length > MAX_CONDITIONS) add('error', 'too-many-conditions', `It has ${reqs.length} conditions: the game checks ${MAX_CONDITIONS} at most.`, at);
  reqs.forEach((c, i) => {
    const why = CONDITION_KINDS.some(([k]) => k === kindOf(c)) ? conditionProblem(c) : 'a kind the game classes do not know';
    if (why) add('error', 'unfinished-condition', `A condition is not finished (${why}).`, { ...at, pin: 'if:' + i });
  });
  if (r.acts.length > MAX_ACTS) add('error', 'too-many-actions', `It has ${r.acts.length} actions: a rule takes ${MAX_ACTS} at most.`, at);
  for (const act of [...r.acts, ...r.otherwise]) actionProblems(ix, r, act, add, game);
  if (r.l.while) whileProblems(ix, r, add, at);
  valueProblems(ix, r, reqs, add, at);
  if (r.l.phase && r.l.phase.set) phaseProblems(ix, r, add, at);
  const later = laterFields(r.l);
  if (later.length) add('warn', 'needs-runtime', `It uses ${words(later.map((f) => f.word))}: ${later.length > 1 ? 'they need' : 'it needs'} Logic runtime v2, and today's build ignores ${later.length > 1 ? 'them' : 'it'}.`, at);
}
// Value (P8 slice 5b) is the number a script's output came with (OutputValue): a rule using it in a condition or an
// action's number with no cause that comes with one reads 0 (said only when its objects' outputs are known)
function valueProblems(ix, r, reqs, add, at) {
  const numbers = (act) => list((own(ix.catalog.inputs, act.x.verb) || {}).args).filter((a) => a.formula).map((a) => act.x[a.id]);
  const uses = reqs.some((c) => usesValue(c.value)) || [...r.acts, ...r.otherwise].some((act) => numbers(act).some(usesValue));
  if (!uses) return;
  const known = r.causes.every((c) => !c.src || Array.isArray((own(ix.actors, c.src) || {}).outputs));
  const carries = r.causes.some((c) => c.src && String(c.key).startsWith('output:') && ((own(ix.actors, c.src) || {}).carries || []).includes(c.key));
  if (known && !carries) add('warn', 'value-unset', 'It uses Value, the number an output of a script comes with, but nothing that starts it comes with a number: Value is 0 there.', at);
}
// a dialogue or an InfoLink of the map's Story (P5) that a rule waits for, starts or plays: one is chosen, and the Story
// has it (said only when the page gave the Story: while it is read, nothing)
const STORY_WAITS = { ended: ['dialogues', 'dialogue', 'a dialogue', 'dialogue'], heard: ['infolinks', 'infolink', 'an InfoLink', 'InfoLink'] };
const STORY_USES = { talk: ['dialogues', 'a', 'a dialogue', 'dialogue'], infolink: ['infolinks', 'a', 'an InfoLink', 'InfoLink'] };
function storyProblems(ix, r, add, at) {
  const missing = (key, id) => !!ix.input.story && !own(ix.actors, storyId(key, id));
  for (const c of r.causes) {
    const k = own(STORY_WAITS, c.cause.when);
    if (!k) continue;
    const id = String(c.cause[k[1]] || '').trim();
    if (!id) add('error', 'story-none', `It waits for ${k[2]}, but none is chosen: it never runs.`, at);
    else if (missing(k[0], id)) add('error', 'story-missing', `The map's Story has no ${k[3]} "${id}": the rule never runs.`, at);
  }
  for (const act of [...r.acts, ...r.otherwise]) {
    const u = act.x.verb === 'wait' && act.x.until, w = u && own(STORY_WAITS, u.type);
    if (w) {                    // a "Wait until" the Story's end: none is no wait (links.py), a missing one waits for ever (or its at most)
      const id = String(u[w[1]] || '').trim(), here = { ...at, act: act.id, wire: act.wire };
      const then = +act.x.max > 0 ? `the rest waits ${+act.x.max} s` : 'the rest never runs';
      if (!id) add('warn', 'story-none', `It waits until ${w[2]} ends, but none is chosen: the game does not wait there.`, here);
      else if (missing(w[0], id)) add('warn', 'story-missing', `The map's Story has no ${w[3]} "${id}": ${then}.`, here);
      continue;
    }
    const k = own(STORY_USES, act.x.verb);
    if (!k) continue;
    const id = String(act.x.a || '').trim(), here = { ...at, act: act.id, wire: act.wire };
    if (!id) add('warn', 'story-none', `No ${k[3]} chosen: the game does nothing there.`, here);
    else if (missing(k[0], id)) add('warn', 'story-missing', `The map's Story has no ${k[3]} "${id}": the game does nothing there.`, here);
  }
}
// a rule kept to some phases of a Phases block (P3, links.phase_gate): the block is in the map, a phase is ticked,
// each one is in its list
function phaseProblems(ix, r, add, at) {
  const ph = r.l.phase, set = ix.ctx.phaseSet ? ix.ctx.phaseSet(ph.set) : null;
  if (!set) {
    if (!list(own(ix.logic, 'phases')).some((p) => p.id === ph.set)) add('error', 'phase-gone', `It works only in phases of ${ix.ctx.name(ph.set)}, which is no Phases block in the map: it never runs.`, at);
    return;
  }
  const chosen = Array.isArray(ph.in) ? ph.in.filter((x) => typeof x === 'string' && x) : [];      // (names: not list())
  if (!chosen.length) { add('warn', 'phase-none', `It works only in phases of ${set.name}, but none is ticked: it never runs.`, at); return; }
  const lost = chosen.filter((id) => !set.phases.some((p) => p.id.toLowerCase() === String(id).toLowerCase()));
  if (lost.length) add('warn', 'phase-unknown', `${set.name} has no phase ${lost.map((x) => `"${x}"`).join(', ')}: ${lost.length === chosen.length ? 'it never runs' : 'that part never counts'}.`, at);
}
// a rule that holds "while" (P3, links.while_end): something must end it, and what it does must have a way back
function whileProblems(ix, r, add, at) {
  const l = r.l, end = ix.vocab.untilOf(l);
  if (!end || (l.when === 'becomes' && !negate(l.watch))) {
    add('warn', 'while-no-end', 'It holds "while", but nothing ends what sets it off: its steps are never undone.', at);
    return;
  }
  const acts = (l.do || []).filter((x) => x && !FLOW.has(x.verb));
  const stays = acts.filter((x) => (x.verb === 'flag' ? /^UCFate[0-9a-f]{6}_/i.test(String(x.a || '')) : !ix.vocab.inverse(x.verb)));
  if (acts.length && stays.length === acts.length) add('warn', 'while-no-undo', 'It holds "while", but none of its steps can be undone.', at);
  else if (stays.length) add('info', 'while-stays', `When it stops, ${stays.map((x) => `"${ix.vocab.verbLabel(x.verb)}"`).join(', ')} ${stays.length === 1 ? 'is' : 'are'} not undone.`, at);
}
// an output the rule hears on any Trigger of its object's Event
const onTrigger = (ix, when) => (own(ix.catalog.outputs, when) || {}).hears === 'event' && !NOT_ON_TRIGGER.has(when);
// "the body Body1 never says ...: a body fires no event of its own" (the family's own note when it has one)
function cannotSay(ix, c, a) {
  if (c.cause.when === 'output') return `${ix.ctx.name(c.src)} has no output "${c.cause.port || ''}" any more.`;
  const note = ((ix.catalog.families || []).find((f) => f.id === a.family) || {}).note || '';
  return `"${ix.vocab.outputLabel(c.cause.when)}" never happens to ${ix.ctx.name(c.src)}.${note ? ' ' + note : ''}`;
}
// the names with a scripting tag, compared as the game does (UCObjectTag.Matches: ~=, case-insensitive)
// what a tag action reaches (UCLink.TagKind): lights, doors or characters by its verb, else any object
const TAG_KIND = (verb) => (verb.startsWith('light') ? 'light' : ['open', 'close', 'toggle', 'lock', 'unlock', 'blow'].includes(verb) ? 'door'
  : ['attack', 'hostile', 'friend', 'neutral', 'stand', 'wander', 'follow', 'goto', 'run', 'leave', 'appear'].includes(verb) ? 'character' : '');
const KIND_PLURAL = { light: 'lights', door: 'doors', character: 'characters' };
const tagMembers = (tags, tag) => Object.entries(tags).filter(([t]) => t.toLowerCase() === String(tag).toLowerCase()).flatMap(([, n]) => n);
function actionProblems(ix, r, act, add, game) {
  const x = act.x, at = { node: r.node, rule: r.id, act: act.id, wire: act.wire };
  if (['wait', 'if', 'else', 'end'].includes(x.verb)) return;     // a step of a list of steps, not an action
  const verb = own(ix.catalog.inputs, x.verb);
  if (!verb) { add('error', 'unknown-verb', `"${x.verb}" is not an action the game classes know.`, at); return; }
  if (x.target && !x.area && !x.targetTag && x.target !== '@by' && x.target !== '@it') {     // (what set it off: no object)
    const a = own(ix.actors, x.target);
    if (!present(ix, x.target)) add('error', 'no-target', `${x.target} is not in the map any more.`, { ...at, fix: 'removeAction' });
    else if (ix.off.has(x.target)) add('warn', 'target-disabled', `${ix.ctx.name(x.target)} is disabled in the game: this action does nothing.`, at);
    else if (Array.isArray(a.inputs) && !a.inputs.includes(verbKey(x)) && verb.target && !ANY_ACTOR.has(x.verb)) {
      if (TRIGGERS.has(x.verb)) add('warn', 'may-ignore', `${ix.ctx.name(x.target)} may ignore "${ix.vocab.verbLabel(x.verb)}": the game only passes it a trigger, and its class decides.`, at);
      else add('error', 'cannot-input', cannotDo(ix, x, a), at);
    }
  }
  // objects tagged alike (input.tags: tag -> the names that have it, UCObjectTag.Of): a tag no object has reaches nothing
  if (x.targetTag && ix.input.tags && !tagMembers(ix.input.tags, x.targetTag).length) {
    const kind = TAG_KIND(x.verb), fams = ix.input.tagFamilies || {};
    const all = Object.keys(ix.input.tags).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    const fit = kind ? all.filter((t) => (fams[t] || []).includes(kind)) : [];
    const here = (fit.length ? fit : all).slice(0, 8);
    const said = fit.length ? ` The ${KIND_PLURAL[kind]} here are tagged: ` : ' Tags here: ';
    add('warn', 'tag-empty', `No object on this map has the scripting tag "${x.targetTag}": this action reaches nothing.`
      + `${here.length ? said + here.join(', ') + '.' : ''} (An object's tag is its Scripting tag in the Inspector.)`, at);
  }
  // (logic.json inputs[verb].target: the action needs an object; without one the game does nothing: fail cannot)
  if (verb.target && !x.target && !x.area && !x.targetTag && !x.group) add('error', 'no-object', `"${ix.vocab.verbLabel(x.verb)}" has no object.`, at);
  // a named group (P3, edits.logic.groups): one that is gone, or has nothing in the map, reaches nothing
  if (x.group) {
    const g = (Array.isArray(ix.logic && ix.logic.groups) ? ix.logic.groups : []).find((v) => v && v.id === x.group);
    if (!g) add('error', 'no-group', 'Its group no longer exists.', at);
    else if (!groupReaches(ix, g)) add('warn', 'group-empty', `The group "${g.name || g.id}" has nothing in the map: this action reaches nothing.`, at);
    else if (isSetGroup(g) && ix.vocab.acts(x.verb) !== 'character') add('warn', 'set-not-character', `The group "${g.name || g.id}" holds characters only: "${ix.vocab.verbLabel(x.verb)}" reaches none of them.`, at);
  }
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
// (a start value given in the Logic window, edits.logic.start: then it stays that, said as a note)
function stateProblems(ix, add) {
  const given = ix.edits && ix.edits.logic && ix.edits.logic.start && typeof ix.edits.logic.start === 'object' ? ix.edits.logic.start : {};
  const startOf = (name) => { const k = Object.keys(given).find((x) => x.toLowerCase() === name.toLowerCase()); return k === undefined ? undefined : given[k]; };
  for (const s of ix.states.values()) {
    const what = s.type === 'int' ? `the counter ${s.name}` : `the state ${s.name}`;
    const sets = s.setters.length || s.elsewhere.some((u) => u.kind === 'write');
    const reads = s.readers.length || s.elsewhere.some((u) => u.kind === 'read');
    const start = startOf(s.name);
    if (!sets && start !== undefined) {
      for (const u of s.readers) add('info', 'never-set', `Nothing sets ${what}: it stays ${typeof start === 'number' ? start : start ? 'Yes' : 'No'}, its start value.`, { node: u.node, pin: u.pin, rule: u.rule, state: s.name });
    } else if (!sets) for (const u of s.readers) add('warn', 'never-set', `Nothing sets ${what}, so it stays ${s.type === 'int' ? '0' : 'No'}.`, { node: u.node, pin: u.pin, rule: u.rule, state: s.name, fix: 'set' });
    if (!reads && s.setters.some((u) => !u.auto)) {
      for (const u of s.setters.filter((v) => v.node && !v.auto)) add('info', 'never-read', `Nothing reads ${what}.`, { node: u.node, pin: u.pin, rule: u.rule, state: s.name });
    }
  }
}

// a door opened by logic that is not locked: the player can open it by hand anyway (one problem per door, its "Lock it")
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
    add('warn', 'not-locked', `${ix.ctx.name(name)} opens by logic (${words([...new Set(by)])}) but is not locked: the player can open it by hand.`, { node: thingId(name), fix: 'lock' });
  }
}

// Rules that set each other off with no time between (logic.json setsOff: what an action makes its object say again
// at once) run again every tick, for ever. Not one: a loop through a rule that runs once (UCLink.RunRule refuses it
// the second time), at most so many times (UCRule MaxRuns) or not again before a cooldown (time passes); a loop of
// cutscenes played with no rule of it stopping one (NEEDS_STOP). A rule setting off itself is one only when it starts
// again while it runs (UCRule Again restart or each): else it is still running and skips. Its Otherwise counts too.
// (The game stops a rule started more than 20 times in a second for the rest of that second: UCRule.Start.)
function cycleProblems(ix, add) {
  const rules = ix.rules.filter((r) => !r.l.once && !(+r.l.max > 0) && !(+r.l.cooldown > 0));   // truthy, as links.py writes them
  const again = (r) => r.l.again === 'restart' || r.l.again === 'each';
  const next = new Map(rules.map((r) => [r.id, []]));                       // id -> [{to, verb}]
  const quick = (acts) => {                                                 // after a wait, time has passed
    const wait = acts.findIndex((act) => act.x.verb === 'wait');
    return (wait < 0 ? acts : acts.slice(0, wait)).filter((a) => !(+a.x.delay > 0) && a.node);
  };
  for (const r of rules) {
    for (const act of [...quick(r.acts), ...quick(r.otherwise || [])]) {
      const says = own(ix.catalog.setsOff, act.x.verb) || [];
      const said = (key) => says.includes(key) || (says.includes('output') && key.startsWith('output:'));
      for (const other of rules) {
        if ((other !== r || again(r)) && other.causes.some((c) => c.node === act.node && said(c.key))) next.get(r.id).push({ to: other.id, verb: act.x.verb });
      }
    }
  }
  const byId = new Map(rules.map((r) => [r.id, r]));
  const stops = (id, verb) => byId.get(id).acts.some((act) => act.x.verb === NEEDS_STOP[verb]);
  for (const loop of loops(next, stops)) {
    const text = loop.length === 1 ? `${loop[0]} sets itself off again with no delay and starts again while it runs: it runs every tick, for ever.`
      : `${words(loop)} set each other off with no delay: they run again every tick, for ever.`;
    for (const id of loop) add('warn', 'zero-delay-cycle', text, { node: ruleId(id), rule: id });
  }
}
// The loops of a graph {id: [{to, verb}]}: its strongly connected components of more than one rule, once the edges of
// an action that needs a stop (NEEDS_STOP) are left out of each loop where no rule stops (stops(id, verb)), again
// until none is left out
function loops(next, stops) {
  for (;;) {
    const self = (id) => (next.get(id) || []).some((e) => e.to === id);
    const found = components(next).filter((c) => c.length > 1 || self(c[0])), loopOf = new Map(found.flatMap((c, k) => c.map((id) => [id, k])));
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
// a signal (P3) sent with no rule waiting for it does nothing; one waited for that no rule sends never comes (a name
// written two ways is one signal: its hub, ix.hubs)
function signalProblems(ix, add) {
  const sent = new Set(), heard = new Set();
  for (const r of ix.rules) {
    for (const c of r.causes) if (c.node.startsWith(PIECE_KINDS.signals[0])) heard.add(c.node);
    for (const a of [...r.acts, ...r.otherwise]) if (a.x.verb === 'signal' && a.node) sent.add(a.node);
  }
  for (const s of list(ix.story)) for (const a of s.acts) if (a.x.verb === 'signal' && signalHub(ix, a.x.a)) sent.add(signalHub(ix, a.x.a));   // the Story's (P5)
  for (const node of ix.hubs ? ix.hubs.values() : []) {
    const name = node.slice(PIECE_KINDS.signals[0].length);
    if (!heard.has(node)) add('warn', 'signal-unheard', `No rule waits for the signal "${name}": sending it does nothing.`, { node });
    if (!sent.has(node)) add('warn', 'signal-never-sent', `Nothing sends the signal "${name}" (no rule, no dialogue or event of the Story): the rules waiting for it never run.`, { node });
  }
}
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
