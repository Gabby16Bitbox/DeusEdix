// What is wrong with a map's logic, and where (editor/static/logic-graph-problems.js): missing or disabled objects,
// what a class cannot do, unfinished rules, states nobody sets, a door opened by logic but not locked, rules that set
// each other off with no delay (checked on the shared runtime fixtures, tests/fixtures/logic), what needs runtime v2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicIndex } from '../editor/static/logic-graph-model.js';
import { logicProblems, problemsByNode, FIXES } from '../editor/static/logic-graph-problems.js';
import { catalog, featureLab, world, fixtureWorld, ACTORS } from './logic_graph_world.mjs';

const problems = (input, options) => logicProblems(logicIndex(input), options);
const brief = (ps) => ps.map((p) => `${p.level} ${p.code} ${p.node}${p.act ? '/' + p.act : ''}${p.pin ? ' ' + p.pin : ''}: ${p.text}`);
const rule = (over = {}, acts = [{ verb: 'open', target: 'Door3' }]) => ({ id: 'L1', src: 'Button1', when: 'used', do: acts, ...over });

test('Feature Lab has nothing wrong: only a counter and a state nobody reads', () => {
  assert.deepEqual(brief(problems(featureLab())), [
    'info never-read rule:L5 act:L5/a2: Nothing reads the counter Test_Done.',
    'info never-read dlg:d1: Nothing reads the state UCEd9fd2_d1_Played.']);
});

test('a scripting tag no object of the map has: a warning naming the tags there; any case finds it (as the game)', () => {
  const act = (tag) => [{ verb: 'lightoff', targetTag: tag, delay: 0 }];
  const tags = { white: ['Lamp1'], VAULT: ['Door3'] };
  const ps = brief(problems(world([rule({ id: 'L1' }, act('Light'))], { tags })));
  assert.deepEqual(ps.filter((p) => p.includes('tag-empty')), ['warn tag-empty rule:L1/a1: No object on this map has the scripting tag '
    + '"Light": this action reaches nothing. Tags here: VAULT, white. (An object\'s tag is its Scripting tag in the Inspector.)']);
  // the kinds of the tags known: a light action lists the lights' tags
  const kinds = brief(problems(world([rule({ id: 'L1' }, act('Light'))], { tags: { ...tags, red: ['Crate'] },
    tagFamilies: { white: ['light'], VAULT: ['door'], red: ['object'] } })));
  assert.deepEqual(kinds.filter((p) => p.includes('tag-empty')), ['warn tag-empty rule:L1/a1: No object on this map has the scripting tag '
    + '"Light": this action reaches nothing. The lights here are tagged: white. (An object\'s tag is its Scripting tag in the Inspector.)']);
  assert.deepEqual(brief(problems(world([rule({ id: 'L1' }, act('WHITE'))], { tags }))).filter((p) => p.includes('tag-empty')), []);
  assert.deepEqual(brief(problems(world([rule({ id: 'L1' }, act('Light'))]))).filter((p) => p.includes('tag-empty')), [],
    'the tags not given: nothing said');
});

test('objects that are gone or disabled, outputs and inputs the class does not have', () => {
  const light = [{ verb: 'lighton', target: 'Lamp1' }];
  const ps = problems(world([
    rule({ id: 'L1', src: 'Gone1' }, light),
    rule({ id: 'L2' }, [{ verb: 'open', target: 'Gone2' }, { verb: 'open', target: 'Door3' }, { verb: 'open', target: 'Lamp1' }]),
    rule({ id: 'L3', src: 'Body1', when: 'dies' }, [{ verb: 'input', target: 'Gen0', a: 'Stop' }]),
    rule({ id: 'L4', src: 'Gen0', when: 'output', port: 'Renamed' }, light),
    rule({ id: 'L5', src: 'Crate' }, [{ verb: 'open', target: 'Gone3' }]),          // not built: nothing else said
    rule({ id: 'L6', src: 'Button2' }, [{ verb: 'open', target: 'VaultDoor' }]),
  ], { edits: { deleted: { Door3: true }, disabled: { Crate: true, VaultDoor: true } } }));
  assert.deepEqual(brief(ps.filter((p) => p.code !== 'not-locked')), [
    'error no-source rule:L1: Gone1 is not in the map any more: the rule never runs.',
    'error no-target rule:L2/a1: Gone2 is not in the map any more.',
    'error no-target rule:L2/a2: Door3 is not in the map any more.',
    'error cannot-input rule:L2/a3: the light Lamp1 cannot Open: try Turn on or off.',
    'error cannot-output rule:L3: "they are killed or knocked out" never happens to the body Body1. A body fires no event of its own.',
    'error cannot-input rule:L3/a1: the script Gen0 has no input "Stop" any more.',
    'error cannot-output rule:L4: the script Gen0 has no output "Renamed" any more.',
    'info source-disabled rule:L5: the object Crate is disabled in the game: the rule is not built.',
    'warn target-disabled rule:L6/a1: the door VaultDoor is disabled in the game: this action does nothing.']);
  assert.deepEqual(ps.find((p) => p.code === 'no-target').fix, 'removeAction');
  assert.equal(FIXES[ps.find((p) => p.code === 'no-source').fix], 'Remove the rule');
});

test('what the game does on any object is not an error: a sound, an explosion, hide, show, an effect; on and off may be ignored', () => {
  const beep = { verb: 'sound', a: 'DeusExSounds.Generic.Beep1', c: '512' };
  const on = (acts) => brief(problems(world([rule({}, acts)])).filter((p) => p.code !== 'not-locked'));
  assert.deepEqual(on([{ ...beep, target: 'Lamp1' }, { ...beep, target: 'Timer1' }, { ...beep, target: 'Zone1' }, { ...beep, target: 'Cut1' }, { ...beep, target: 'P1' }]), []);
  assert.deepEqual(on([{ verb: 'explode', target: 'Lamp1', a: '50' }, { verb: 'hide', target: 'Lamp1' }, { verb: 'show', target: 'Timer1' },
    { verb: 'effect', target: 'Zone1', a: 'sparks' }]), []);
  assert.deepEqual(on([{ verb: 'on', target: 'Lamp1' }, { verb: 'off', target: 'Cut1' }]), [
    'warn may-ignore rule:L1/a1: the light Lamp1 may ignore "Switch on": the game only passes it a trigger, and its class decides.',
    'warn may-ignore rule:L1/a2: the cutscene "Intro" may ignore "Switch off": the game only passes it a trigger, and its class decides.']);
  // what needs its class still does: an animation (a UCMotion or a door), a light's own verbs, a door's
  assert.deepEqual(on([{ verb: 'anim', target: 'Lamp1' }, { verb: 'lighton', target: 'Crate' }]).map((p) => p.split(':')[0]), ['error cannot-input rule', 'error cannot-input rule']);
});

test('an output the rule hears on the object\'s event, which the object sends: a warning, not an error (the runtime fixture)', () => {
  // used_and_any_one_event: "any" of a decoration is the event "used" sends too, and the game runs both
  assert.deepEqual(brief(problems(fixtureWorld('used_and_any_one_event'))), [
    'warn same-event rule:L2: Button1 does not offer "it triggers its event", but the rule hears its event: it runs when "the player uses it" happens.']);
  // a zone sends its event when the player walks in; a body sends none; a mover's "blown up" is only a door's
  const heard = (src, when) => brief(problems(world([rule({ src, when }, [{ verb: 'message', a: 'x' }])]))).map((p) => p.split(':')[0]);
  assert.deepEqual(heard('Zone1', 'used'), ['warn same-event rule']);
  assert.deepEqual(heard('Body1', 'used'), ['error cannot-output rule']);
  assert.deepEqual(heard('Crate', 'destroyed'), ['error cannot-output rule']);
  assert.deepEqual(heard('Crate', 'leave'), ['error cannot-output rule']);
});

test('an action that needs an object and has none: on, hide and an effect too (logic.json inputs[verb].target)', () => {
  const ps = problems(world([rule({}, [{ verb: 'on' }, { verb: 'hide' }, { verb: 'effect', a: 'mist' }, { verb: 'anim' }, { verb: 'explode', a: '50' }, { verb: 'sound', a: 'x.y.z' }])]));
  assert.deepEqual(brief(ps), [
    'error no-object rule:L1/a1: "Switch on" has no object.',
    'error no-object rule:L1/a2: "Vanish" has no object.',
    'error no-object rule:L1/a3: "An effect on it (mist, sparks, light...)" has no object.',
    'error no-object rule:L1/a4: "Play its animation" has no object.']);
});

test('rules not finished: no action, no object, no name, a condition half made, too many', () => {
  const ps = problems(world([
    rule({ id: 'L1' }, []),
    rule({ id: 'L2', requires: [{ type: 'item', item: '', has: true }, { type: 'phase', set: 'Base', is: 'Alarm' }] },
      [{ verb: 'open' }, { verb: 'count', a: '', b: '1' }, { verb: 'flag', a: ' ' }, { verb: 'goal', b: 'Find it' }, { verb: 'fly', target: 'Crate' }]),
    rule({ id: 'L3', requires: Array.from({ length: 9 }, (_, k) => ({ flag: 'S' + k, is: true })) }, Array.from({ length: 25 }, () => ({ verb: 'message', a: 'x' }))),
  ]));
  assert.deepEqual(brief(ps.filter((p) => p.code !== 'never-set')), [
    'warn nothing-yet rule:L1: It does nothing yet.',
    'error unfinished-condition rule:L2 if:0: A condition is not finished (choose the item).',
    'error unfinished-condition rule:L2 if:1: A condition is not finished (a kind the game classes do not know).',
    'error no-object rule:L2/a1: "Open" has no object.',
    'error no-name rule:L2/a2: The counter has no name.',
    'error no-name rule:L2/a3: No state chosen.',
    'error no-name rule:L2/a4: The goal has no name.',
    'error unknown-verb rule:L2/a5: "fly" is not an action the game classes know.',
    'error too-many-conditions rule:L3: It has 9 conditions: the game checks 8 at most.',
    'error too-many-actions rule:L3: It has 25 actions: a rule takes 24 at most.']);
});

test('a state or counter read and never set stays No or 0; one set elsewhere is fine', () => {
  const read = (flag, more = {}) => brief(problems(world([rule({ requires: [{ flag, is: true }] })], more)).filter((p) => p.code === 'never-set'));
  assert.deepEqual(read('Vault_Power'), ['warn never-set rule:L1 if:0: Nothing sets the state Vault_Power, so it stays No.']);
  assert.deepEqual(problems(world([rule({ requires: [{ flag: 'Vault_Power' }] })])).find((p) => p.code === 'never-set').fix, 'set');
  const setBy = (more) => read('Vault_Power', more);
  assert.deepEqual(setBy({ external: [{ flag: 'VAULT_POWER', uses: [{ map: '02_Roof', context: 'Dialogue: Jock', kind: 'write' }] }] }), []);   // flags ignore case
  assert.deepEqual(setBy({ story: { infolinks: [{ id: 'i1', do: [{ type: 'flag', flag: 'Vault_Power', is: true }] }] } }), []);
  assert.deepEqual(read('UCFate1a2b3c_Guard1_Dead'), []);
  // a start value given (P5): it stays that, said as a note, no fix to offer
  const started = problems(world([rule({ requires: [{ flag: 'Vault_Power', is: true }] })], { edits: { logic: { start: { vault_power: true } } } }))
    .filter((p) => p.code === 'never-set');
  assert.deepEqual(brief(started), ['info never-set rule:L1 if:0: Nothing sets the state Vault_Power: it stays Yes, its start value.']);
  assert.equal(started[0].fix, undefined);
  const counter = problems(world([rule({ requires: [{ type: 'counter', counter: 'Levers', op: '>=', value: 3 }] }), rule({ id: 'L2' }, [{ verb: 'count', a: 'levers', b: '1' }])]));
  assert.deepEqual(brief(counter), []);
  assert.deepEqual(brief(problems(world([rule({ requires: [{ type: 'counter', counter: 'Levers', op: '>=', value: 3 }] })]))),
    ['warn never-set rule:L1 if:0: Nothing sets the counter Levers, so it stays 0.']);
  // a logic block keeps it (P3: a Counter's number, a Phases block's states): set as the map runs, never "never read"
  const kept = { keeps: [{ block: 'Kills', name: 'levers', type: 'int', text: 'Counter' }] };
  assert.deepEqual(brief(problems(world([rule({ requires: [{ type: 'counter', counter: 'Levers', op: '>=', value: 3 }] })], kept))), []);
  assert.deepEqual(brief(problems(world([], kept))), []);
  assert.deepEqual(brief(problems(world([rule({ requires: [{ type: 'counter', counter: 'Levers', op: '>=', value: 3 }] })],
    { ...kept, edits: { deleted: { Kills: true } } }))), ['warn never-set rule:L1 if:0: Nothing sets the counter Levers, so it stays 0.']);
  // set and never read: said, quietly; a dialogue's automatic Played is not
  assert.deepEqual(brief(problems(world([rule({}, [{ verb: 'flag', a: 'Done', b: '1' }])]))), ['info never-read rule:L1 act:L1/a1: Nothing reads the state Done.']);
  const played = { playedFlag: (d) => `UCEd_${d.id}_Played`, heardFlag: () => '' };
  assert.deepEqual(brief(problems(world([], { story: { dialogues: [{ id: 'd1', steps: [] }] }, storyFlags: played }))), []);
});

test('a door opened by logic but not locked: "Lock it"; not when locked, nor when a rule locks it', () => {
  const opens = (links, actors) => brief(problems({ ...world(links), ...(actors ? { actors } : {}) }).filter((p) => p.code === 'not-locked'));
  assert.deepEqual(opens([rule({}, [{ verb: 'open', target: 'VaultDoor' }]), rule({ id: 'L2', src: 'Pad1', when: 'code' }, [{ verb: 'unlock', target: 'VaultDoor' }])]),
    ['warn not-locked obj:VaultDoor: the door VaultDoor opens by logic (L1 and L2) but is not locked: the player can open it by hand.']);
  assert.equal(problems(world([rule({}, [{ verb: 'open', target: 'VaultDoor' }])])).find((p) => p.code === 'not-locked').fix, 'lock');
  assert.deepEqual(opens([rule({}, [{ verb: 'open', target: 'Door3' }])]), []);
  assert.deepEqual(opens([rule({}, [{ verb: 'open', target: 'VaultDoor' }]), rule({ id: 'L2', src: '', when: 'start' }, [{ verb: 'lock', target: 'VaultDoor' }])]), []);
  assert.deepEqual(opens([rule({}, [{ verb: 'close', target: 'VaultDoor' }])]), []);
  const base = world([]).actors;
  assert.deepEqual(opens([rule({}, [{ verb: 'open', target: 'VaultDoor' }])], { ...base, VaultDoor: { ...base.VaultDoor, frobbable: false } }), []);
});

test('rules that set each other off with no delay: the runtime fixtures\' loop, not a rule that sets off itself', () => {
  const loop = problems(fixtureWorld('zero_delay_loop')).filter((p) => p.code === 'zero-delay-cycle');
  assert.deepEqual(brief(loop), [
    'warn zero-delay-cycle rule:L2: L2 and L3 set each other off with no delay: they run again every tick, for ever.',
    'warn zero-delay-cycle rule:L3: L2 and L3 set each other off with no delay: they run again every tick, for ever.']);
  assert.deepEqual(problems(fixtureWorld('self_retrigger_skips_running')).filter((p) => p.code === 'zero-delay-cycle'), []);
  // a delay, or a wait, breaks it
  const fx = fixtureWorld('zero_delay_loop');
  const delayed = JSON.parse(JSON.stringify(fx));
  delayed.edits.links[2].do[1].delay = 0.5;
  assert.deepEqual(problems({ ...delayed, catalog }).filter((p) => p.code === 'zero-delay-cycle'), []);
  // a script answering an input at once
  const script = problems(world([
    rule({ id: 'L1', src: 'Gen0', when: 'output', port: 'Sabotaged' }, [{ verb: 'input', target: 'Gen0', a: 'Start' }, { verb: 'message', a: 'x' }]),
    rule({ id: 'L2', src: 'Gen0', when: 'output', port: 'Sabotaged' }, [{ verb: 'on', target: 'Gen0' }]),
  ])).filter((p) => p.code === 'zero-delay-cycle');
  assert.deepEqual(script.map((p) => p.rule), ['L1', 'L2']);
});

test('no loop for ever: through a rule that runs once, or cutscenes played with no rule of the loop stopping one', () => {
  const cycles = (input) => problems(input).filter((p) => p.code === 'zero-delay-cycle').map((p) => p.rule);
  // the fixture's loop with L2 run once: the game refuses it the second time round (UCLink.RunRule)
  const once = JSON.parse(JSON.stringify(fixtureWorld('zero_delay_loop')));
  assert.deepEqual(cycles(once), ['L2', 'L3']);
  once.edits.links.find((l) => l.id === 'L2').once = true;
  assert.deepEqual(cycles({ ...once, catalog }), []);
  once.edits.links.find((l) => l.id === 'L2').once = 0;                       // links.py writes no bOnce for 0
  assert.deepEqual(cycles({ ...once, catalog }), ['L2', 'L3']);
  // two cutscenes starting each other: the second is queued while the first plays (UCCutscene.Play)
  const actors = { ...ACTORS, Cut2: ACTORS.Cut1 };
  const plays = [rule({ id: 'L1', src: 'Cut1', when: 'cutstart' }, [{ verb: 'cutplay', target: 'Cut2' }]),
    rule({ id: 'L2', src: 'Cut2', when: 'cutstart' }, [{ verb: 'cutplay', target: 'Cut1' }])];
  assert.deepEqual(cycles({ ...world(plays), actors }), []);
  // each stopping the one that plays first: it goes round
  const stopped = [rule({ id: 'L1', src: 'Cut1', when: 'cutstart' }, [{ verb: 'cutstop', target: 'Cut1' }, { verb: 'cutplay', target: 'Cut2' }]),
    rule({ id: 'L2', src: 'Cut2', when: 'cutstart' }, [{ verb: 'cutstop', target: 'Cut2' }, { verb: 'cutplay', target: 'Cut1' }])];
  assert.deepEqual(cycles({ ...world(stopped), actors }), ['L1', 'L2']);
  // a play kept out of a loop leaves the rest of it: L3 and L4 still set each other off
  const mixed = [...plays, rule({ id: 'L3', src: 'Gen0', when: 'output', port: 'Sabotaged' }, [{ verb: 'input', target: 'Gen0', a: 'Start' }, { verb: 'cutplay', target: 'Cut1' }]),
    rule({ id: 'L4', src: 'Gen0', when: 'output', port: 'Sabotaged' }, [{ verb: 'on', target: 'Gen0' }])];
  assert.deepEqual(cycles({ ...world(mixed), actors }), ['L3', 'L4']);
});

test('the rule options (P6): at most N or a cooldown end a loop; a rule that starts again while it runs loops on itself', () => {
  const cycles = (input) => problems(input).filter((p) => p.code === 'zero-delay-cycle');
  const fx = fixtureWorld('zero_delay_loop');
  const withL2 = (more) => { const w = JSON.parse(JSON.stringify(fx)); Object.assign(w.edits.links.find((l) => l.id === 'L2'), more); return { ...w, catalog }; };
  assert.deepEqual(cycles(withL2({ max: 3 })), []);
  assert.deepEqual(cycles(withL2({ cooldown: 1 })), []);
  assert.deepEqual(cycles(withL2({ again: 'each' })).map((p) => p.rule), ['L2', 'L3'], 'still a loop of two');
  // a script answering its own input at once, the rule starting again each time: itself
  const self = (again) => cycles(world([rule({ id: 'L1', src: 'Gen0', when: 'output', port: 'Sabotaged', again },
    [{ verb: 'input', target: 'Gen0', a: 'Start' }])]));
  assert.deepEqual(self(undefined), [], 'still running: it skips');
  assert.deepEqual(brief(self('restart')), ['warn zero-delay-cycle rule:L1: L1 sets itself off again with no delay and starts again while it runs: it runs every tick, for ever.']);
  assert.equal(self('each').length, 1);
  // its Otherwise counts too
  const other = cycles(world([
    rule({ id: 'L1', src: 'Gen0', when: 'output', port: 'Sabotaged', requires: [{ flag: 'Never' }], else: [{ verb: 'input', target: 'Gen0', a: 'Start' }] }, [{ verb: 'message', a: 'x' }]),
    rule({ id: 'L2', src: 'Gen0', when: 'output', port: 'Sabotaged' }, [{ verb: 'on', target: 'Gen0' }])]));
  assert.deepEqual(other.map((p) => p.rule), ['L1', 'L2']);
});

test('what needs Logic runtime v2, what the project\'s game cannot run', () => {
  const later = (l, acts) => problems(world([rule(l, acts)])).filter((p) => p.code === 'needs-runtime');
  // a Wait among a rule's actions (not a list of steps: links.py drops it) is not built yet; "while" and a phase are
  // (links.expand_while, links.phase_gate: P3)
  const v2 = later({ else: [{ verb: 'message', a: 'No' }], cooldown: 5, phase: { set: 'Base', in: ['Alarm'] }, while: true },
    [{ verb: 'open', target: 'Door3', requires: [{ flag: 'X' }] }, { verb: 'wait', until: { type: 'arrived', actor: 'Guard1' } }]);
  assert.deepEqual(brief(v2), ['warn needs-runtime rule:L1: It uses "wait until": it needs Logic runtime v2, and today\'s build ignores it.']);
  assert.deepEqual(later({ while: true }), []);
  assert.deepEqual(problems(world([rule({ once: true, mute: true })])).filter((p) => p.code === 'needs-runtime'), []);
  // what links.blocks builds as a UCRule / bSteps and ran in both games (backup/20261105_logic_b make_m4_p4.py,
  // 20261106_chain, 20261107_logic_p3b): no warning
  const built = later({ requires: [{ flag: 'A' }, { flag: 'B' }], match: 'any', also: [{ src: 'Button2', when: 'used' }],
    else: [{ verb: 'message', a: 'No' }, { verb: 'wait', until: { type: 'arrived', actor: 'Guard1' } }],
    max: 3, cooldown: 2.5, again: 'each', talkBusy: 'giveup' }, [{ verb: 'open', target: 'Door3', requires: [{ flag: 'X' }] }]);
  assert.deepEqual(built, []);
  assert.deepEqual(later({ steps: true }, [{ verb: 'if', requires: [{ flag: 'X' }] }, { verb: 'open', target: 'Door3' }, { verb: 'end' },
    { verb: 'wait', until: { type: 'arrived', actor: 'Guard1' }, max: 20 }, { verb: 'open', target: 'Door3', requires: [{ flag: 'Y' }] }]), []);
  // a vocabulary where Open works only in Revision: the original game cannot run it
  const narrowed = JSON.parse(JSON.stringify(catalog));
  narrowed.inputs.open.games = ['revision'];
  narrowed.outputs.used.games = ['revision'];
  const ps = (game) => brief(problems({ ...world([rule({}, [{ verb: 'open', target: 'Door3' }])]), catalog: narrowed }, { game }).filter((p) => p.code === 'not-in-game'));
  assert.deepEqual(ps('vanilla'), ['error not-in-game rule:L1: "the player uses it" does not work in this game.', 'error not-in-game rule:L1/a1: "Open" does not work in this game.']);
  assert.deepEqual(ps('revision'), []);
});

test('the logic\'s own items: an input nothing reaches, an All of of one input, a phase nobody goes to', () => {
  const logic = { blocks: [{ id: 'B1', kind: 'allof', name: 'Alarms off', inputs: 2 }, { id: 'B2', kind: 'anyof', name: 'Any', inputs: 1 }],
    phases: [{ id: 'Base', name: 'Base alert', list: ['Quiet', 'Alarm', 'Lockdown'] }] };
  const ps = problems(world([rule({}, [{ verb: 'input', target: 'blk:B1', a: 'in1' }, { verb: 'input', target: 'ph:Base', a: 'goto_Alarm' }, { verb: 'input', target: 'blk:B2', a: 'in1' }])], { edits: { logic } }));
  assert.deepEqual(brief(ps), [
    'warn unwired-input blk:B1 in:input:in2: Nothing reaches input 2 of block "Alarms off".',
    'warn one-input blk:B2: block "Any" has one input: a plain wire does the same.',
    'info phase-never-entered ph:Base in:input:goto_Lockdown: Nothing makes phases "Base alert" go to Lockdown.']);
});

test('the problems of each node and wire, for their badges', () => {
  const ps = problems(world([rule({ id: 'L1' }, [{ verb: 'open', target: 'Gone' }]), rule({ id: 'L2', src: 'Gone' })]));
  const by = problemsByNode(ps);
  assert.deepEqual([...by.keys()], ['rule:L1', 'act:L1/a1', 'rule:L2']);
  assert.deepEqual(by.get('act:L1/a1').map((p) => p.code), ['no-target']);
});
