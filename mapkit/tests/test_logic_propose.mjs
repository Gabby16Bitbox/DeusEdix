// The AI assistant's proposals for the level logic (static/logic-propose.js, P3 logic_propose): the operations on a
// copy of the edits, what they refuse, the ghosts the Logic window draws, and a run in the simulator. The page's glue
// (app.js logicPropose / logicDecide) and the window's bar (logic-window.js proposalHtml, markShown) are checked here
// on their own parts and in the editor by hand (backup/20261108_logic_p3k/README.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyOps, ghostIds, newProblems, mainHappening, simulate, BLOCK_CLASSES } from '../editor/static/logic-propose.js';

const kit = new URL('../', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, kit), 'utf8'));
const logic = read('editor/config/logic.json');
const { cases } = read('tests/logic_sim_cases.json');

// a map of a button, a door, a light and a Phases block, with one rule
const IO = {
  Button1: { outputs: ['used'], inputs: ['on', 'off'] },
  Door1: { outputs: ['opened', 'closed', 'destroyed'], inputs: ['open', 'close', 'lock', 'unlock'] },
  Lamp1: { outputs: ['any'], inputs: ['lighton', 'lightoff', 'lighttoggle'] },
  Phases1: { outputs: ['output:Phase1'], inputs: ['input:Next'] },
};
const BLOCK_IO = { UCBAllOf: { outputs: ['output:Done', 'output:Undone'], inputs: ['input:Add', 'input:TakeBack', 'input:Reset'] } };
const ctx = {
  exists: (n) => n in IO, outputsOf: (n) => IO[n]?.outputs ?? null, inputsOf: (n) => IO[n]?.inputs ?? null,
  blockIo: (cls) => BLOCK_IO[cls] || null, verbs: logic.inputs, outputs: logic.outputs, free: logic.free,
  where: () => [1, 2, 3], newName: (cls, taken) => { let i = 0; while (taken('UCEdit' + i)) i++; return 'UCEdit' + i; },
};
const edits = () => ({ links: [{ id: 'L1', src: 'Button1', when: 'used', once: false, at: [0, 0, 0], label: 'x', do: [{ id: 'a1', verb: 'open', target: 'Door1', delay: 0 }] }],
  added: [], logic: { groups: [] } });

test('a new rule: its id, the assistant\'s mark, a place; the map\'s edits untouched', () => {
  const base = edits();
  const p = applyOps(base, [{ op: 'add_rule', rule: { id: 'L1', src: 'Door1', when: 'opened', do: [{ verb: 'lighton', target: 'Lamp1' }] } }], ctx);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.added, ['L2']);                 // L1 is taken
  const l = p.edits.links.find((x) => x.id === 'L2');
  assert.equal(l.by, 'assistant');
  assert.deepEqual(l.at, [1, 2, 3]);
  assert.equal(l.do[0].delay, 0);
  assert.equal(l.once, false);
  assert.equal(base.links.length, 1);
  assert.deepEqual(ghostIds(p), new Set(['rule:L2']));
});

test('connect is one rule, a block\'s port both ways', () => {
  const p = applyOps(edits(), [
    { op: 'add_block', cls: 'UCBAllOf', at: [0, 0, 64], props: { Need: 2 }, ref: 'all' },
    { op: 'connect', from: 'Button1', output: 'used', to: '$all', input: 'input:Add' },
    { op: 'connect', from: '$all', output: 'output:Done', to: 'Door1', input: 'open', delay: 2 },
  ], ctx);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.blocks, ['UCEdit0']);
  assert.deepEqual(p.edits.added[0], { name: 'UCEdit0', cls: 'UCBAllOf', loc: [0, 0, 64], rot: [0, 0, 0], props: { Need: '2' } });
  const [, a, b] = p.edits.links;
  assert.deepEqual(a.do, [{ verb: 'input', target: 'UCEdit0', a: 'Add', delay: 0 }]);
  assert.equal(b.when, 'output');
  assert.equal(b.port, 'Done');
  assert.equal(b.do[0].delay, 2);
  assert.ok(ghostIds(p).has('obj:UCEdit0'));
  assert.deepEqual(mainHappening(p), { thing: 'Button1', output: 'used' });
});

test('what the game cannot run is refused, in words', () => {
  const errs = (ops) => applyOps(edits(), ops, ctx).errors.join('\n');
  assert.match(errs([{ op: 'add_rule', rule: { src: 'Nobody', when: 'used', do: [{ verb: 'open', target: 'Door1' }] } }]), /no object "Nobody"/);
  assert.match(errs([{ op: 'add_rule', rule: { src: 'Button1', when: 'opened', do: [{ verb: 'open', target: 'Door1' }] } }]), /Button1 cannot "opened" \(it can: used\)/);
  assert.match(errs([{ op: 'add_rule', rule: { src: 'Button1', when: 'used', do: [{ verb: 'open', target: 'Lamp1' }] } }]), /Lamp1 cannot "open"/);
  assert.match(errs([{ op: 'add_rule', rule: { src: 'Button1', when: 'used', do: [{ verb: 'fly', target: 'Door1' }] } }]), /"fly" is not a step/);
  assert.match(errs([{ op: 'add_rule', rule: { src: 'Button1', when: 'used', do: [] } }]), /needs its steps/);
  assert.match(errs([{ op: 'add_block', cls: 'Light', at: [0, 0, 0] }]), /a logic block is one of/);
  assert.match(errs([{ op: 'update_rule', id: 'L9', set: { once: true } }]), /no rule "L9"/);
  assert.match(errs([{ op: 'connect', from: '$nope', output: 'used', to: 'Door1', input: 'open' }]), /no earlier operation has the ref "nope"/);
  assert.match(errs([{ op: 'format' }]), /the operations are/);
  // a message needs no object; the map's own causes need no src
  assert.equal(errs([{ op: 'add_rule', rule: { when: 'start', do: [{ verb: 'message', a: 'Hi' }] } }]), '');
  assert.match(errs([{ op: 'add_rule', rule: { when: 'used', do: [{ verb: 'message', a: 'Hi' }] } }]), /needs an object/);
});

test('an update is checked and taken back whole when it is wrong; a removal; a phase', () => {
  const bad = applyOps(edits(), [{ op: 'update_rule', id: 'L1', set: { do: [{ verb: 'open', target: 'Lamp1' }] } }], ctx);
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.edits.links[0].do[0].target, 'Door1');
  const p = applyOps(edits(), [{ op: 'update_rule', id: 'L1', set: { once: true, label: null } }, { op: 'set_phase', id: 'L1', set: 'Phases1', in: ['Vault'] }], ctx);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.changed, ['L1']);
  assert.equal(p.edits.links[0].once, true);
  assert.deepEqual(p.edits.links[0].phase, { set: 'Phases1', in: ['Vault'] });
  assert.equal(p.edits.links[0].by, undefined);      // a rule the user made is not marked as the assistant's
  const gone = applyOps(edits(), [{ op: 'delete_rule', id: 'L1' }], ctx);
  assert.deepEqual([gone.removed, gone.edits.links.length, gone.changed], [['L1'], 0, []]);
  // one it adds and removes again is neither
  const both = applyOps(edits(), [{ op: 'connect', from: 'Button1', output: 'used', to: 'Lamp1', input: 'lighton', ref: 'r' }, { op: 'delete_rule', id: '$r' }], ctx);
  assert.deepEqual([both.added, both.removed], [[], []]);
});

test('a group: by its name or its ref in a step, its filter', () => {
  const p = applyOps(edits(), [
    { op: 'make_group', name: 'Lamps', members: ['Lamp1'], ref: 'g' },
    { op: 'make_group', name: 'White', filter: { tag: 'white' } },
    { op: 'add_rule', rule: { src: 'Button1', when: 'used', do: [{ verb: 'lightoff', group: 'lamps' }, { verb: 'lighton', group: '$g' }, { verb: 'lightoff', group: 'White' }] } },
  ], ctx);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.groups, ['G1', 'G2']);
  assert.deepEqual(p.edits.logic.groups[1], { id: 'G2', name: 'White', members: [], filter: { tag: 'white' } });
  assert.deepEqual(p.edits.links[1].do.map((x) => x.group), ['G1', 'G1', 'G2']);
  assert.match(applyOps(p.edits, [{ op: 'make_group', name: 'lamps' }], ctx).errors[0], /a group "lamps" already/);
  assert.match(applyOps(edits(), [{ op: 'make_group', name: 'X', members: ['Ghost'] }], ctx).errors[0], /no object "Ghost"/);
});

// P9 slice 1: a group of a kind or a faction, and a rule on anyone of it (no src, its group)
test('a group of a kind or a faction; a rule when any of them sees the player; what cannot be', () => {
  const p = applyOps(edits(), [
    { op: 'make_group', name: 'Troopers', filter: { kind: 'UNATCOTroop' }, ref: 't' },
    { op: 'make_group', name: 'MJ12', filter: { faction: 'MJ12' } },
    { op: 'add_rule', rule: { src: '', group: '$t', when: 'sees', do: [{ verb: 'hostile', group: 'MJ12' }] } },
  ], ctx);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.edits.logic.groups, [{ id: 'G1', name: 'Troopers', members: [], filter: { kind: 'UNATCOTroop' } },
    { id: 'G2', name: 'MJ12', members: [], filter: { faction: 'MJ12' } }]);
  const l = p.edits.links.find((x) => x.id === 'L2');
  assert.deepEqual([l.src, l.group, l.when, l.do[0].group], ['', 'G1', 'sees', 'G2']);
  const bad = (ops) => applyOps(p.edits, ops, ctx).errors[0] || '';
  assert.match(bad([{ op: 'add_rule', rule: { src: '', group: 'Troopers', when: 'opened', do: [] } }]), /not "opened"/);
  assert.match(bad([{ op: 'add_rule', rule: { src: 'Button1', when: 'used', also: [{ src: '', group: 'G1', when: 'sees' }], do: [] } }]), /Or when/);
  assert.match(bad([{ op: 'make_group', name: 'Bad', filter: { kind: 'a b' } }]), /a filter is/);
});

test('the problems a proposal brings, and those it takes away', () => {
  const a = { level: 'warn', text: 'A' }, b = { level: 'error', text: 'B' }, c = { level: 'warn', text: 'C' };
  assert.deepEqual(newProblems([a, b], [b, c]), { brought: [c], fixed: [a] });
});

test('a proposal tried in the simulator says what happens', () => {
  const k = cases.doors;
  const t = { compiled: { actors: k.actors, outputs: logic.outputs, left: k.left || [] }, world: k.world, catalog: logic, rules: k.edits.links,
    names: { Door1: 'the vault door' }, map: 'M' };
  const run = simulate(t, [{ thing: 'Button1', output: 'used' }], 2);
  assert.ok(!run.error, run.error);
  const text = run.happened.map((h) => h.text).join('\n');
  assert.match(text, /vault door/);
  assert.match(text, /Door1 destroyed/);
  assert.ok(run.at >= 2);
  assert.match(simulate({ ...t, compiled: { error: 'Interaction L1: wrong' } }, []).error, /cannot be built: Interaction L1/);
  assert.match(simulate(t, [{ thing: 'Button1' }]).error, /thing, output/);
});

test('the blocks it may place are the simulator\'s', () => {
  const sim = readFileSync(new URL('editor/static/logic-sim.js', kit), 'utf8');
  // (the Timer is no block there: the simulator plays it as the game's UCTimer, with its verbs timerstart...)
  for (const cls of BLOCK_CLASSES.filter((c) => c !== 'UCTimer')) assert.match(sim, new RegExp(`\\['${cls}', '`));
  assert.match(sim, /timerstart: 'UCTimer'/);
});

// P8 slice 7: a pattern of the project placed, rules and blocks put in a block of their own
const VER = { name: 'Two of these', v: 2, slots: [{ id: 'button', words: 'a button', family: 'button' }, { id: 'all', carried: true, family: 'allof' }],
  objects: [{ slot: 'all', cls: 'UCBAllOf', at: [0, 0, 0], props: { Need: '2', Note: '{button}' } }],
  rules: [{ id: 'R1', src: '{button}', when: 'used', do: [{ verb: 'input', target: '{all}', a: 'Add' }] }] };
const withPatterns = { ...ctx, pattern: (slug) => (slug === 'two-of-these' ? VER : null) };

test('place_pattern: its newest version, its places filled, the blocks it brings, the instance', () => {
  const p = applyOps(edits(), [{ op: 'place_pattern', pattern: 'two-of-these', slots: { button: 'Button1' }, ref: 'two' }], withPatterns);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.instances, ['P1']);
  assert.deepEqual(p.blocks, ['UCEdit0']);
  assert.deepEqual(p.edits.added[0], { name: 'UCEdit0', cls: 'UCBAllOf', loc: [97, 2, 51], rot: [0, 0, 0], props: { Need: '2', Note: 'Button1' } });
  assert.deepEqual(p.edits.logic.instances, [{ id: 'P1', pattern: 'two-of-these', v: 2, name: 'Two of these', slots: { button: 'Button1', all: 'UCEdit0' } }]);
  assert.equal(p.edits.logicPatterns['two-of-these@2'].name, 'Two of these');
  assert.equal(p.refs.two, 'P1');
  assert.ok(ghostIds(p).has('box:P1') && ghostIds(p).has('obj:UCEdit0'));
});

test('place_pattern refuses an unknown pattern, place or object, in words', () => {
  const bad = (op) => applyOps(edits(), [op], withPatterns).errors[0];
  assert.match(bad({ op: 'place_pattern', pattern: 'nope' }), /no pattern "nope".*logic_patterns/);
  assert.match(bad({ op: 'place_pattern', pattern: 'two-of-these', slots: { lamp: 'Lamp1' } }), /"lamp" is not a place.*its places: button/);
  assert.match(bad({ op: 'place_pattern', pattern: 'two-of-these', slots: { button: 'Nobody' } }), /no object "Nobody"/);
  assert.match(bad({ op: 'place_pattern', pattern: 'two-of-these', slots: { all: 'Button1' } }), /"all" is not a place/);   // carried: brought
});

test('make_box: the rules and blocks named, earlier ones by ref', () => {
  const p = applyOps(edits(), [
    { op: 'add_block', cls: 'UCBAllOf', at: [0, 0, 64], ref: 'all' },
    { op: 'connect', from: 'Button1', output: 'used', to: '$all', input: 'input:Add', ref: 'r' },
    { op: 'make_box', name: 'Doors', rules: ['L1', '$r'], blocks: ['$all'], ref: 'box' },
  ], ctx);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.boxes, ['X1']);
  assert.deepEqual(p.edits.logic.boxes, [{ id: 'X1', name: 'Doors', rules: ['L1', 'L2'], pieces: ['obj:UCEdit0'], parent: null, ports: {} }]);
  assert.equal(p.refs.box, 'X1');
  assert.ok(ghostIds(p).has('box:X1'));
  assert.match(applyOps(edits(), [{ op: 'make_box', rules: [] }], ctx).errors[0], /needs rules/);
  assert.match(applyOps(edits(), [{ op: 'make_box', rules: ['L9'] }], ctx).errors[0], /no rule "L9"/);
});

// P9 slice 6: the world's own happenings (slice 3) are causes of the map for the assistant too, a rule of their own only;
// a formula of counters (slice 5) goes through as the user would write it
test('the world\'s happenings and formulas in a proposal', () => {
  const p = applyOps(edits(), [
    { op: 'add_rule', rule: { src: '', when: 'loaded', do: [{ verb: 'count', a: 'Loads', b: 'Loads + 1', c: 'set' }] } },
    { op: 'add_rule', rule: { src: '', when: 'goaldone', do: [{ verb: 'credits', a: 'Goals * 50' }],
      requires: [{ type: 'counter', counter: 'Goals', op: '>=', value: 'Loads' }] } },
  ], ctx);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.edits.links.find((l) => l.when === 'loaded').do[0].b, 'Loads + 1');
  const also = applyOps(edits(), [{ op: 'update_rule', id: 'L1', set: { also: [{ src: '', when: 'noise' }] } }], ctx);
  assert.match(also.errors.join('\n'), /"noise" cannot be an "Or when\.\.\."/);
});

test('a rule changed: its "If not" follows its phases and cause (13 Nov 2026: it ran out of the rule\'s phase)', () => {
  const base = { links: [
    { id: 'L1', src: '', when: 'back', once: false, at: [0, 0, 0], requires: [{ flag: 'Dead', is: true }], do: [{ id: 'a1', verb: 'lighton', target: 'Lamp1', delay: 0 }] },
    { id: 'L2', src: '', when: 'back', once: false, at: [0, 0, 0], otherwiseOf: 'L1', requires: [{ flag: 'Dead', is: false }], do: [{ id: 'a1', verb: 'lightoff', target: 'Lamp1', delay: 0 }] },
  ], added: [], logic: { groups: [] } };
  const p = applyOps(base, [{ op: 'update_rule', id: 'L1', set: { phase: { set: 'Phases1', in: ['Over'] }, once: true } }], ctx);
  assert.deepEqual(p.errors, []);
  const other = p.edits.links.find((x) => x.id === 'L2');
  assert.deepEqual(other.phase, { set: 'Phases1', in: ['Over'] });
  assert.equal(other.once, true);
  assert.deepEqual(other.requires, [{ flag: 'Dead', is: false }]);
  assert.deepEqual(other.do[0].verb, 'lightoff');      // its own steps kept
  assert.ok(p.changed.includes('L2'));
});

// (13 Nov 2026, Edge Lab) what the assistant fires with no thing: a key, a signal, a dialogue's end, the world's causes
test('happenings with no thing: by their Tag, or the world\'s own', async () => {
  const { happeningOf } = await import('../editor/static/logic-propose.js');
  const outs = JSON.parse((await import('node:fs')).readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8')).outputs;
  assert.deepEqual(happeningOf({ output: 'keypress', key: 'K' }, outs), { thing: 'UCL_Key_K', output: 'keypress', port: undefined, option: undefined });
  assert.equal(happeningOf({ output: 'signal', signal: 'Ping' }, outs).thing, 'UCS_Ping');
  assert.equal(happeningOf({ output: 'ended', dialogue: 'Intro' }, outs).thing, 'UCD_Intro');
  assert.deepEqual(happeningOf({ output: 'goaldone', goal: 'Survive' }, outs), { thing: '', output: 'goaldone', port: undefined, option: undefined, goal: 'Survive' });
  assert.equal(happeningOf({ output: 'back' }, outs).thing, '');
  assert.equal(happeningOf({ output: 'used' }, outs), null, 'an object\'s output needs its object');
  assert.equal(happeningOf({ thing: 'Button1', output: 'used' }, outs).thing, 'Button1');
});

test('a rule proposed with an If and no steps is made a list of steps (13 Nov 2026, Deep Ops)', () => {
  const p = applyOps(edits(), [{ op: 'add_rule', rule: { src: 'Button1', when: 'used', do: [
    { verb: 'if', requires: [{ flag: 'A', is: true }] }, { verb: 'open', target: 'Door1' }, { verb: 'else' },
    { verb: 'lighton', target: 'Lamp1' }, { verb: 'end' }] } }], ctx);
  assert.deepEqual(p.errors, []);
  assert.equal(p.edits.links.find((x) => x.id === p.added[0]).steps, true);
  const plain = applyOps(edits(), [{ op: 'add_rule', rule: { src: 'Button1', when: 'used', do: [{ verb: 'open', target: 'Door1' }] } }], ctx);
  assert.equal(plain.edits.links.find((x) => x.id === plain.added[0]).steps, undefined);
});

test('a step\'s choice only of its choices (13 Nov 2026, Deep Ops: a goal "failed")', () => {
  const v = { ...logic.inputs };
  const c2 = { ...ctx, verbs: v };
  const p = applyOps(edits(), [{ op: 'add_rule', rule: { src: 'Button1', when: 'used', do: [{ verb: 'goal', a: 'G', c: 'failed' }] } }], c2);
  assert.match(p.errors.join('\n'), /"goal" c \(completed\) is one of "", "done", not "failed"/);
  const ok = applyOps(edits(), [{ op: 'add_rule', rule: { src: 'Button1', when: 'used', do: [{ verb: 'goal', a: 'G', c: 'done' }] } }], c2);
  assert.deepEqual(ok.errors, []);
});
