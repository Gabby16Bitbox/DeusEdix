// The AI assistant's proposals for a map's level logic (P3, logic_propose: deusedix_mcp.py -> agent.js -> app.js
// logicKit). A proposal is a list of operations applied to a copy of the map's edits: nothing changes in the map until
// the user accepts it in the Logic window, where it is drawn as ghost nodes and dashed wires. Accepting it is one undo
// step ("Assistant: ..."). Pure: tests/test_logic_propose.mjs.
//
// applyOps(edits, ops, ctx) -> {edits, added, changed, removed, groups, blocks, refs, errors}
//   edits   the map's edits (not changed: the result is a copy)
//   ops     [{op, ...}] in order:
//     add_rule    {rule: {src, when, do, else?, once?, also?, ...}, ref?}  a rule as logic_read gives it; its id is kept
//                 when it is free (else a new one)
//     update_rule {id, set: {...}}       its fields changed (null takes one away; do, else, also replaced whole)
//     delete_rule {id}                   (and its "If not" rules)
//     connect     {from, output, to, input, a?, delay?, once?}   one rule: when `from` <output> (a word of logic_offer,
//                 "output:Done" for a block's or a script's port), `to` <input> ("open", "input:Add"...)
//     add_block   {cls, at, props?, name?, ref?}   a logic block (BLOCK_CLASSES) placed in the map
//     make_group  {name, members?, filter?, ref?}  a named group (filter: {tag}, {area}, or P9 {kind} / {faction}:
//                 every character of that class or that faction, newcomers too; a rule on it has src '' and its group)
//     set_phase   {id, set, in}          the rule works only in these phases of a Phases block (set null: always)
//     place_pattern {pattern, slots?, ref?}  a pattern of the project placed (P8): its newest version, each of its places
//                 to fill ({slot id: object}) an object of the map; the logic blocks it brings added near the first one
//     make_box    {rules?, blocks?, name?, ref?}  rules and logic blocks put in a block of their own (P8: one node)
//   A later operation names what an earlier one made by "$<ref>" (a block's name, a group's id, a rule's id); a step's
//   group may also be the group's name.
//   ctx     {exists(name), outputsOf(name) (its whens, or null when unknown), inputsOf(name) (its verbs, or null),
//            verbs: {verb: {target}}, outputs: {when: {}}, free: [verbs with no object], newName(cls, taken),
//            where(name) (a place for a rule's mark), pattern(slug) (its newest version, {name, v, slots, objects,
//            rules...}, loaded before: null when the project has none)}
// It refuses what the game cannot run (errors, in words): an unknown object, a cause or a verb the object does not
// have, a block of a class that is no logic block. The build's own check (/api/logic/compile) comes after it.

import { createSession } from './logic-sim.js';
import { vocabulary } from './logic-vocab.js';
import { lineText, saidLine } from './logic-try.js';
import { boxesOf, makeBox, BOX } from './logic-boxes.js';
import { nextInstanceId, versionKey, fillSlots } from './logic-patterns.js';
import { WORLD_CAUSES, GAME_WORLD } from './logic-rule-ui.js';

export const BLOCK_CLASSES = ['UCBAllOf', 'UCBGate', 'UCBSwitch', 'UCBPhases', 'UCBAtLeast', 'UCBFirstOf', 'UCBCounter'];
export const OPS = ['add_rule', 'update_rule', 'delete_rule', 'connect', 'add_block', 'make_group', 'set_phase', 'place_pattern', 'make_box'];
const FLOW = new Set(['if', 'else', 'end', 'wait']);
// causes that belong to the map, not to an object (no src): the Logic window's "The map" list (P9 slice 3: the
// world's own happenings too, a rule of their own only)
const MAP_CAUSES = new Set(WORLD_CAUSES);
// what starts a rule on anyone of a kind or a faction (P9: links.EVERY_WHENS), its group its only object
const SET_WHENS = new Set(['killed', 'knockedout', 'dies', 'hurt', 'sees', 'turnshostile', 'findsbody']);
const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
const low = (s) => String(s ?? '').toLowerCase();

export function applyOps(edits, ops, ctx) {
  const next = clone(edits) || {};
  next.links = Array.isArray(next.links) ? next.links : [];
  next.added = Array.isArray(next.added) ? next.added : [];
  const errors = [], refs = {}, added = [], changed = new Set(), removed = [], groups = [], blocks = [], instances = [], boxes = [];
  const logic = () => (next.logic && typeof next.logic === 'object' ? next.logic : (next.logic = {}));
  const groupList = () => (Array.isArray(logic().groups) ? logic().groups : (logic().groups = []));
  const madeBlocks = new Map();                       // a block of the proposal: name -> its class
  const has = (name) => madeBlocks.has(name) || !!ctx.exists(name);
  if (!Array.isArray(ops) || !ops.length) return { edits: next, added, changed: [], removed, groups, blocks, instances, boxes, refs, errors: ['ops: a list of operations.'] };

  // "$ref" -> what it names, in any string of a value
  const deref = (v) => {
    if (typeof v === 'string' && v.startsWith('$')) {
      if (!(v.slice(1) in refs)) throw new Error(`${v}: no earlier operation has the ref "${v.slice(1)}"`);
      return refs[v.slice(1)];
    }
    if (Array.isArray(v)) return v.map(deref);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deref(x)]));
    return v;
  };
  const newRuleId = () => {
    let n = 1;
    for (const l of next.links) n = Math.max(n, (+String(l.id).replace(/\D/g, '') || 0) + 1);
    return 'L' + n;
  };
  const groupOf = (g) => {
    const list = groupList();
    return list.find((x) => x.id === g) || list.find((x) => low(x.name) === low(g)) || null;
  };
  const outputsOf = (name) => (madeBlocks.has(name) ? ctx.blockIo?.(madeBlocks.get(name))?.outputs ?? null : ctx.outputsOf(name));
  const inputsOf = (name) => (madeBlocks.has(name) ? ctx.blockIo?.(madeBlocks.get(name))?.inputs ?? null : ctx.inputsOf(name));
  const whenKey = (c) => (c.when === 'output' ? 'output:' + (c.port || '') : c.when);
  const free = new Set(ctx.free || []);

  // a cause (the rule's own or an "also"): its object and what sets it off
  function checkCause(c, where, also = false) {
    if (!c.when || !(c.when in (ctx.outputs || {}))) throw new Error(`${where}: "${c.when ?? ''}" is not something that can set a rule off`);
    const set = !c.src && c.group ? groupOf(c.group) : null;
    if (set && set.filter && (set.filter.kind || set.filter.faction)) {
      if (also) throw new Error(`${where}: an "Or when..." cannot be on a group of a kind or a faction (make it a rule of its own)`);
      if (!SET_WHENS.has(c.when)) throw new Error(`${where}: a group of a kind or a faction starts a rule on ${[...SET_WHENS].join(', ')}, not "${c.when}"`);
      c.group = set.id;
      return;
    }
    if (!c.src) {
      if (!MAP_CAUSES.has(c.when)) throw new Error(`${where}: "${c.when}" needs an object (src)`);
      if (also && GAME_WORLD.includes(c.when)) throw new Error(`${where}: "${c.when}" cannot be an "Or when..." (make it a rule of its own)`);
      return;
    }
    if (!has(c.src)) throw new Error(`${where}: there is no object "${c.src}" in the map`);
    const outs = outputsOf(c.src);
    if (outs && !outs.includes(whenKey(c)) && !MAP_CAUSES.has(c.when))
      throw new Error(`${where}: ${c.src} cannot "${whenKey(c)}" (it can: ${outs.join(', ') || 'nothing'})`);
  }
  // a step: its verb, its object (or objects by tag, by radius, a group)
  function checkStep(x, where) {
    if (!x || typeof x !== 'object' || typeof x.verb !== 'string') throw new Error(`${where}: a step is {verb, target, ...}`);
    if (FLOW.has(x.verb)) return;
    const v = (ctx.verbs || {})[x.verb];
    if (!v) throw new Error(`${where}: "${x.verb}" is not a step the game knows`);
    if (x.group) {
      const g = groupOf(x.group);
      if (!g) throw new Error(`${where}: there is no group "${x.group}"`);
      x.group = g.id;
      x.target = '';
      return;
    }
    if (x.targetTag || x.area) return;                // links.py checks a tag or a radius
    if (!v.target || free.has(x.verb) && !x.target) return;
    if (!x.target) throw new Error(`${where}: "${x.verb}" needs an object (target)`);
    if (x.target.startsWith('@')) return;             // what set the rule off (@by, @it)
    if (!has(x.target)) throw new Error(`${where}: there is no object "${x.target}" in the map`);
    const ins = inputsOf(x.target), key = x.verb === 'input' ? 'input:' + (x.a || '') : x.verb;
    if (ins && !ins.includes(key)) throw new Error(`${where}: ${x.target} cannot "${key}" (it can: ${ins.join(', ') || 'nothing'})`);
  }
  function checkRule(l, where) {
    checkCause(l, where);
    (l.also || []).forEach((c, i) => checkCause(c, `${where}, also ${i + 1}`, true));
    if (!Array.isArray(l.do) || !l.do.length) throw new Error(`${where}: a rule needs its steps (do)`);
    l.do.forEach((x, i) => checkStep(x, `${where}, step ${i + 1}`));
    (l.else || []).forEach((x, i) => checkStep(x, `${where}, otherwise ${i + 1}`));
    for (const x of [...l.do, ...(l.else || [])]) if (typeof x.delay !== 'number') x.delay = +x.delay || 0;
    if (typeof l.once !== 'boolean') l.once = false;
    if (!Array.isArray(l.at)) l.at = ctx.where ? ctx.where(l.src) : [0, 0, 0];
  }
  const ruleOf = (id) => {
    const l = next.links.find((x) => x.id === id);
    if (!l) throw new Error(`there is no rule "${id}" (logic_read gives their ids)`);
    return l;
  };

  ops.forEach((raw, k) => {
    const where = `ops[${k}] ${raw && raw.op}`;
    try {
      if (!raw || !OPS.includes(raw.op)) throw new Error(`the operations are: ${OPS.join(', ')}`);
      const o = deref(raw);
      if (o.op === 'add_rule' || o.op === 'connect') {
        let l;
        if (o.op === 'connect') {
          if (!o.from || !o.output || !o.to || !o.input) throw new Error('connect needs from, output, to and input');
          const out = String(o.output), inp = String(o.input);
          const step = inp.startsWith('input:') ? { verb: 'input', target: o.to, a: inp.slice(6) } : { verb: inp, target: o.to };
          if (o.a !== undefined && step.verb !== 'input') step.a = o.a;
          step.delay = +o.delay || 0;
          l = { src: o.from, when: out.startsWith('output:') ? 'output' : out, do: [step], once: !!o.once };
          if (out.startsWith('output:')) l.port = out.slice(7);
        } else {
          if (!o.rule || typeof o.rule !== 'object') throw new Error('add_rule needs the rule');
          l = clone(o.rule);
        }
        delete l.label;
        if (!l.id || next.links.some((x) => x.id === l.id) || !/^[A-Za-z]\w*$/.test(String(l.id))) l.id = newRuleId();
        l.by = 'assistant';
        checkRule(l, where);
        next.links.push(l);
        added.push(l.id);
        if (o.ref) refs[o.ref] = l.id;
      } else if (o.op === 'update_rule') {
        const l = ruleOf(o.id);
        if (!o.set || typeof o.set !== 'object') throw new Error('update_rule needs set: the fields to change');
        const before = clone(l);
        for (const [key, v] of Object.entries(o.set)) {
          if (key === 'id' || key === 'by') continue;
          if (v === null) delete l[key]; else l[key] = clone(v);
        }
        delete l.label;
        try { checkRule(l, where); } catch (e) { Object.keys(l).forEach((key) => delete l[key]); Object.assign(l, before); throw e; }
        if (!added.includes(l.id)) changed.add(l.id);
      } else if (o.op === 'delete_rule') {
        const l = ruleOf(o.id);
        const gone = new Set([l.id, ...next.links.filter((x) => x.otherwiseOf === l.id).map((x) => x.id)]);
        next.links = next.links.filter((x) => !gone.has(x.id));
        for (const id of gone) {
          changed.delete(id);
          const i = added.indexOf(id);
          if (i >= 0) added.splice(i, 1); else removed.push(id);
        }
      } else if (o.op === 'set_phase') {
        const l = ruleOf(o.id);
        if (o.set === null || o.set === '') delete l.phase;
        else {
          if (!has(o.set)) throw new Error(`there is no Phases block "${o.set}"`);
          if (!Array.isArray(o.in) || !o.in.length) throw new Error('set_phase needs in: the phases the rule works in');
          l.phase = { set: o.set, in: o.in.map(String) };
        }
        if (!added.includes(l.id)) changed.add(l.id);
      } else if (o.op === 'add_block') {
        if (!BLOCK_CLASSES.includes(o.cls)) throw new Error(`a logic block is one of ${BLOCK_CLASSES.join(', ')}`);
        if (!Array.isArray(o.at) || o.at.length !== 3 || o.at.some((v) => typeof v !== 'number')) throw new Error('add_block needs at: [x, y, z]');
        const taken = (n) => has(n) || next.added.some((a) => low(a.name) === low(n));
        if (o.name && (taken(o.name) || !/^[A-Za-z]\w*$/.test(o.name))) throw new Error(`the name "${o.name}" is taken or not a name`);
        const name = o.name || ctx.newName(o.cls, taken);
        const props = Object.fromEntries(Object.entries(o.props || {}).map(([key, v]) => [key, String(v)]));
        next.added.push({ name, cls: o.cls, loc: o.at.map(Math.round), rot: [0, 0, 0], props });
        madeBlocks.set(name, o.cls);
        blocks.push(name);
        if (o.ref) refs[o.ref] = name;
      } else if (o.op === 'make_group') {
        const name = String(o.name || '').trim().slice(0, 60);
        if (!name) throw new Error('make_group needs its name');
        if (groupOf(name)) throw new Error(`there is a group "${name}" already`);
        const members = [...new Set((o.members || []).map(String))];
        for (const n of members) if (!has(n)) throw new Error(`there is no object "${n}" in the map`);
        const used = new Set(groupList().map((g) => g.id));
        let i = 1;
        while (used.has('G' + i)) i++;
        const g = { id: 'G' + i, name, members };
        if (o.filter) {
          const word = (v) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(String(v ?? ''));        // (links.every_set)
          if (o.filter.tag) g.filter = { tag: String(o.filter.tag) }, g.members = [];
          else if (o.filter.area && typeof o.filter.area === 'object') g.filter = { area: clone(o.filter.area) };
          else if (o.filter.kind !== undefined && word(o.filter.kind)) g.filter = { kind: String(o.filter.kind) }, g.members = [];
          else if (o.filter.faction !== undefined && word(o.filter.faction)) g.filter = { faction: String(o.filter.faction) }, g.members = [];
          else throw new Error('a filter is {tag}, {area: {kind, at, radius, tag, dynamic}}, {kind: a character class} or {faction: a faction}');
        }
        groupList().push(g);
        groups.push(g.id);
        if (o.ref) refs[o.ref] = g.id;
      } else if (o.op === 'place_pattern') {
        const ver = ctx.pattern ? ctx.pattern(String(o.pattern || '')) : null;
        if (!ver) throw new Error(`there is no pattern "${o.pattern ?? ''}" in the project (logic_patterns lists them)`);
        const places = (ver.slots || []).filter((x) => !x.carried).map((x) => x.id);
        const slots = {};
        for (const [k, n] of Object.entries(o.slots || {})) {
          if (!places.includes(k)) throw new Error(`"${k}" is not a place of the pattern "${ver.name}" (its places: ${places.join(', ') || 'none'})`);
          if (n && !has(String(n))) throw new Error(`there is no object "${n}" in the map`);
          if (n) slots[k] = String(n);
        }
        const first = Object.values(slots)[0];
        const base = (first && ctx.where ? ctx.where(first) : [0, 0, 0]).map((v, i) => Math.round(v + [96, 0, 48][i]));
        const taken = (n) => has(n) || next.added.some((a) => low(a.name) === low(n));
        const made = [];
        for (const x of ver.objects || []) {
          const name = ctx.newName(x.cls, taken);
          const e = { name, cls: x.cls, loc: base.map((v, i) => v + ((x.at || [])[i] || 0)), rot: [0, 0, 0], props: { ...(x.props || {}) } };
          next.added.push(e);
          madeBlocks.set(name, x.cls);
          made.push(e);
          slots[x.slot] = name;
        }
        for (const e of made) e.props = fillSlots(e.props, slots);
        const id = nextInstanceId(next);
        logic().instances = [...(Array.isArray(logic().instances) ? logic().instances : []), { id, pattern: String(o.pattern), v: ver.v, name: ver.name, slots }];
        next.logicPatterns = { ...(next.logicPatterns || {}), [versionKey(String(o.pattern), ver.v)]: clone(ver) };
        blocks.push(...made.map((e) => e.name));
        instances.push(id);
        if (o.ref) refs[o.ref] = id;
      } else if (o.op === 'make_box') {
        const rules = [...new Set((o.rules || []).map(String))];
        for (const id of rules) ruleOf(id);
        const pieces = [...new Set((o.blocks || []).map(String))].map((n) => {
          if (!has(n)) throw new Error(`there is no object "${n}" in the map`);
          return 'obj:' + n;
        });
        if (!rules.length && !pieces.length) throw new Error('make_box needs rules (their ids) or blocks (logic blocks\' names)');
        const made = makeBox(boxesOf(next), { rules, pieces, boxes: [] }, { name: o.name || '' });
        logic().boxes = made.boxes;
        boxes.push(made.id);
        if (o.ref) refs[o.ref] = made.id;
      }
    } catch (e) {
      const msg = String(e.message || e);
      errors.push(msg.startsWith(where) ? msg : `${where}: ${msg}`);
    }
  });
  return { edits: next, added, changed: [...changed].filter((id) => next.links.some((l) => l.id === id)), removed, groups, blocks, instances, boxes, refs, errors };
}

// The node ids of the Logic graph (logic-graph-model.js) a proposal adds or changes: drawn as ghosts
export function ghostIds(p) {
  return new Set([...p.added, ...p.changed].map((id) => 'rule:' + id).concat(p.blocks.map((n) => 'obj:' + n), p.groups.map((g) => 'grp:' + g),
    [...(p.instances || []), ...(p.boxes || [])].map((id) => BOX + id)));
}

// What the assistant should hear of the problems: those the proposal brings (not on the map before), and the rest
export function newProblems(before, after) {
  const key = (p) => `${p.level}|${p.text}`;
  const had = new Set(before.map(key));
  return { brought: after.filter((p) => !had.has(key(p))), fixed: before.filter((p) => !after.some((q) => key(q) === key(p))) };
}

// The words the rules are said in (logic-vocab.js's context, as Try it says them), from what app.js logicTrial gives:
// things by the Hierarchy's names, ports and options by their labels, groups by their names
export function trialWords(t) {
  const names = t.names || {}, labels = t.labels || {}, options = t.options || {};
  return { name: (n) => names[n] || n, portLabel: (n, k) => (labels[n] || {})[k] || k.split(':')[1] || '?',
    optionText: (l) => (options[l.src] || [])[+l.option || 0] || '', family: (n) => (t.families || {})[n] || 'other', word: () => '',
    usable: (n) => !!(t.usable || {})[n], itemName: (cls) => (t.items || {})[cls] || String(cls).split('.').pop(),
    groupName: (id) => (t.groups || {})[id] || '',
    // a dialogue, an InfoLink by its title (P5; app.js logicWorld storyTitles)
    storyTitle: (key, id) => ((t.storyTitles || {})[key] || {})[id] || String(id) };
}

// The happening a proposal is tried with when the assistant gives none: what sets off its first new rule
export function mainHappening(p) {
  const l = p.edits.links.find((x) => x.id === (p.added[0] || p.changed[0]));
  if (!l || !l.src || MAP_CAUSES.has(l.when)) return null;
  return l.when === 'output' ? { thing: l.src, output: 'output', port: l.port } : l.when === 'option'
    ? { thing: l.src, output: 'option', option: l.option } : { thing: l.src, output: l.when };
}

// A run of the rules in the simulator (logic-sim.js, as Try it plays them), for the assistant: what happens in words.
//   t       what app.js logicTrial gives ({compiled, world, catalog, names, labels, options, families, rules, items,
//           usable, groups (id -> name), map})
//   fires   [{thing, output, port?, option?}]: what happens, one after the other, at the start
//   seconds how long it runs after them
// A dialogue that starts plays through (P5: Try it plays the Story's conversations), each choice taking the first
// answer offered; its lines are in what happened.
// -> {happened: [{t, text}], state: {flags, counters, ...}} or {error}
export function simulate(t, fires = [], seconds = 5, start = {}) {
  const c = t.compiled || {};
  if (c.error) return { error: `The rules cannot be built: ${c.error}` };
  const vocab = vocabulary(t.catalog), words = trialWords(t);
  const session = createSession({ actors: c.actors || [], outputs: c.outputs || t.catalog.outputs, left: c.left || [], world: t.world,
    map: t.map || 'Map', vocab, ctx: words, start });
  const sentences = {};
  for (const l of t.rules || []) { try { sentences[l.id] = vocab.sentence(l, words); } catch { sentences[l.id] = l.label || l.id; } }
  const stops = [];
  // the conversation playing, on to its end (at most 200 lines and answers a time)
  const talkThrough = () => {
    for (let n = 0; n < 200 && session.talking(); n++) {
      const shown = session.talking().shown;
      session.say(shown?.type === 'choice' ? (shown.options.find((o) => o.shown) || { k: -1 }).k : -1);
    }
  };
  for (const f of fires) {
    if (!f || !f.thing || !f.output) return { error: 'Each happening is {thing, output, port?, option?}.' };
    session.fire({ thing: f.thing, output: f.output, port: f.port, option: f.option });
    talkThrough();
    const r = session.step(1);
    if (r && r.stopped) stops.push(r.stopped.text);
  }
  for (let left = Math.max(0.1, Math.min(600, +seconds || 5)); left > 1e-6; left -= 0.5) {
    talkThrough();
    const r = session.run(Math.min(0.5, left));
    if (r && r.stopped) { stops.push(r.stopped.text); break; }
  }
  talkThrough();
  const said = { vocab, words, sentences, player: t.world?.player || '' };
  // the game's log, and what was said in the conversations where it was said
  const lines = session.log(), told = session.said(), happened = [];
  const at10 = (x) => Math.round(x * 10) / 10;
  let k = 0;
  for (let n = 0; n <= lines.length; n++) {
    for (; k < told.length && told[k].at <= n; k++) {
      const s = saidLine(told[k], { words, player: said.player });
      if (s) happened.push({ t: at10(told[k].t), text: s.text });
    }
    if (n < lines.length) happened.push({ t: at10(lines[n].t), text: lineText(lines[n].line, said).text });
  }
  const st = session.state();
  const state = {};
  for (const k of ['flags', 'counters', 'dead', 'owned', 'destroyed', 'items', 'credits', 'jc']) {   // jc: where the player is
    const v = st[k];
    if (v && (Array.isArray(v) ? v.length : typeof v === 'object' ? Object.keys(v).length : true)) state[k] = v;
  }
  return Object.assign({ happened: happened.slice(-120), state, at: session.t }, stops.length ? { stopped: stops } : {},
    (c.left || []).length ? { notInGame: c.left.map((l) => `${l.id}: ${l.text}`) } : {});
}
