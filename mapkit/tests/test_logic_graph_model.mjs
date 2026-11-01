// The Logic window's model (editor/static/logic-graph-model.js): the map's rules as thing nodes with the pins in use,
// rule cards and collapsed wires, the Story and the game wiring read only, the logic's own items, and the scopes. The
// badge rule: every field of a rule or an action away from its default shows on its card or its wire, so nothing
// hides behind a collapsed wire. Feature Test's map (01_Feature_Lab, frozen in tests/fixtures/logic_graph) is one of
// the inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicIndex, logicGraph, scopeOf, actionIds, ensureActionIds, isSimple, liveValue, ruleBadges, thingId, pieceId, storyId, stateKey,
  RULE_FIELDS, ACTION_FIELDS, SCOPE_LIMIT, PIECE_KINDS, STORY_KINDS, GROUP_KINDS } from '../editor/static/logic-graph-model.js';
import { logicProblems } from '../editor/static/logic-graph-problems.js';
import { catalog, featureLab, liveFeatureLab, world, canvasWireKinds, ACTORS, TARGET_OF } from './logic_graph_world.mjs';

const graphOf = (input, options) => logicGraph(logicIndex(input), options);
const nodeOf = (g, id) => g.nodes.find((n) => n.id === id);
const wireOf = (g, id) => g.wires.find((w) => w.id === id);
const pins = (n, side) => n.pins[side].map((p) => `${p.id}=${p.label}`);
const lab = featureLab();

// ---------------------------------------------------------------- a real map: Feature Test's 01_Feature_Lab
test('Feature Lab: its things show only the pins in use, with their words', () => {
  const g = graphOf(lab);
  assert.deepEqual(pins(nodeOf(g, 'obj:UCEdit5'), 'out'), ['out:used=JC uses it']);
  assert.deepEqual(pins(nodeOf(g, 'obj:UCEdit5'), 'in'), []);
  assert.deepEqual(nodeOf(g, 'obj:UCEdit5').more, { out: 2, in: 5 });           // object: gone, near; hide, show, sound...
  const door = nodeOf(g, 'obj:UCEditBox7');
  assert.equal(door.word, 'door');
  assert.deepEqual(pins(door, 'out'), ['out:opened=it has opened', 'out:destroyed=it is blown up']);
  assert.deepEqual(pins(door, 'in'), ['in:anim=Play its animation', 'in:blow=Blow up']);
  const script = nodeOf(g, 'obj:UCEdit29');                                       // its own ports, as the script names them
  assert.deepEqual(pins(script, 'in'), ['in:input:Start=Start it']);
  assert.deepEqual(pins(script, 'out'), ['out:output:Done=it says "it is done"']);
  assert.equal(nodeOf(g, 'obj:UCEdit8').label, 'Officer Rossi');
  // "+ Show all": every pin it offers, the unused ones marked
  const all = graphOf(lab, { showAll: ['obj:UCEdit5'] });
  assert.deepEqual(nodeOf(all, 'obj:UCEdit5').pins.out.map((p) => [p.key, p.used]), [['used', true], ['gone', false], ['near', false]]);
  assert.equal(nodeOf(all, 'obj:UCEdit5').pins.in.length, 5);
  // at the basic level a timer's "more" verbs are not offered: a script's port always is
  const timer = graphOf(world([{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'timerstart', target: 'Timer1' }, { verb: 'message', a: 'x' }] }]), { showAll: ['obj:Timer1'] });
  assert.deepEqual(nodeOf(timer, 'obj:Timer1').pins.in.map((p) => p.key), ['timerstart']);
  const more = graphOf(world([{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'timerstart', target: 'Timer1' }, { verb: 'message', a: 'x' }] }]), { showAll: ['obj:Timer1'], level: 'more' });
  assert.deepEqual(nodeOf(more, 'obj:Timer1').pins.in.map((p) => p.key), ['timerstart', 'timerstop', 'timerpause', 'timerresume']);
});

test('Feature Lab: rule cards, the one simple rule a wire, conditions say who sets their counter', () => {
  const g = graphOf(lab);
  assert.deepEqual(g.nodes.filter((n) => n.kind === 'rule').map((n) => n.rule), ['L1', 'L2', 'L3', 'L5', 'L6', 'L7', 'L8']);
  const l4 = wireOf(g, 'rule:L4');                                                 // one action on one object: a wire
  assert.equal(l4.label, 'JC uses it → Start it');
  assert.deepEqual([l4.from, l4.to], [{ node: 'obj:UCEdit5', pin: 'out:used' }, { node: 'obj:UCEdit29', pin: 'in:input:Start' }]);
  assert.deepEqual(l4.badges.map((b) => b.text), ['its values: Seconds=1']);
  const l1 = nodeOf(g, 'rule:L1');
  assert.deepEqual(l1.causes.map((c) => [c.text, c.short, c.node, c.pin]), [['When JC uses Button UCEdit5', 'JC uses it', 'obj:UCEdit5', 'out:used']]);
  assert.deepEqual(l1.sections[0].rows.map((r) => [r.timeText, r.text, r.target, r.pin, r.badges.map((b) => b.text)]), [
    ['0 s', 'play the animation of door UCEditBox7', 'obj:UCEditBox7', 'in:anim', []],
    ['0 s', 'Officer Rossi UCEdit8 walks to a place', 'obj:UCEdit8', 'in:goto', ['to 1573, -208, 40']]]);
  const l8 = nodeOf(g, 'rule:L8');
  assert.deepEqual(l8.badges.map((b) => b.text), ['1×']);
  assert.deepEqual(l8.checks.map((c) => [c.text, c.setBy, c.unset]), [['the counter Test_Presses is at least 3', [{ node: 'rule:L2', text: 'Button UCEdit5 (L2)' }], false]]);
  // what sets the counter reaches what reads it: state wires
  assert.deepEqual(g.wires.filter((w) => w.kind === 'state').map((w) => `${w.from.pin}>${w.to.node}/${w.to.pin}`), ['act:L2/a1>rule:L3/if:0', 'act:L2/a1>rule:L8/if:0']);
  assert.deepEqual(g.states.find((s) => s.name === 'Test_Presses'), { name: 'Test_Presses', type: 'int', setBy: 1, readBy: 2, setters: ['rule:L2'], readers: ['rule:L3', 'rule:L8'], elsewhere: 0 });
  // every card says what app.js saved as the rule's label (its sentence)
  for (const l of lab.edits.links) assert.equal((nodeOf(g, 'rule:' + l.id) || wireOf(g, 'rule:' + l.id)).sentence, l.label, l.id);
  // Officer Rossi's dialogue: started by talking to him, read only
  const d1 = nodeOf(g, 'dlg:d1');
  assert.deepEqual([d1.kind, d1.readOnly, d1.title, d1.first, d1.owner], ['dialogue', true, 'Rossi at the door', 'why are you mad?', 'obj:UCEdit8']);
  const start = wireOf(g, 'dlg:d1/start');
  assert.deepEqual([start.readOnly, start.from, start.to], [true, { node: 'obj:UCEdit8', pin: 'out:story:talk' }, { node: 'dlg:d1', pin: 'in:start' }]);
});

test('the projection changes nothing it reads', () => {
  const before = JSON.stringify(lab.edits) + JSON.stringify(lab.story);
  graphOf(lab, { open: ['L4'], showAll: ['obj:UCEdit5'] });
  assert.equal(JSON.stringify(lab.edits) + JSON.stringify(lab.story), before);
  assert.ok(lab.edits.links.every((l) => l.do.every((x) => !('id' in x))), 'no action got an id');
});

// The live project, only when DEUSEDIX_FEATURE_TEST names it: it is edited, so nothing exact, only that every rule is
// drawn and the views read it without changing it
test('the live Feature Test project, when asked for: every rule drawn, nothing changed', (t) => {
  const live = liveFeatureLab();
  if (!live) { t.skip('set DEUSEDIX_FEATURE_TEST to the Feature Test project\'s tools/mapkit to look at it'); return; }
  const before = JSON.stringify(live.edits) + JSON.stringify(live.story);
  const ix = logicIndex(live), g = logicGraph(ix);
  for (const l of live.edits.links.filter((x) => x.id)) assert.ok(nodeOf(g, 'rule:' + l.id) || wireOf(g, 'rule:' + l.id), l.id);
  assert.ok(Array.isArray(logicProblems(ix)));
  assert.equal(JSON.stringify(live.edits) + JSON.stringify(live.story), before);
});

// ---------------------------------------------------------------- the badge rule
// Every field a rule can have, from links.py (docstring, blocks, act_string), editor/LOGIC.md and the design's
// version 2 fields, with a value away from its default ('none': a field that changes nothing the rule does)
const RULE_SAMPLES = {
  id: { value: 'L9' }, src: { value: 'Button2' }, when: { value: 'gone' }, once: { value: true }, requires: { value: [{ flag: 'Power', is: true }] },
  do: { value: [{ verb: 'close', target: 'Door3' }] },
  option: { value: 2, base: { src: 'Comp1', when: 'option' } }, near: { value: 512, base: { when: 'near' } },
  port: { value: 'Other', base: { src: 'Gen0', when: 'output', port: 'Sabotaged' } },
  label: { value: 'anything', none: true }, at: { value: [10, 20, 30], base: { do: [{ verb: 'explode', a: '50' }] } },
  also: { value: [{ src: 'Button2', when: 'used' }] }, match: { value: 'any', base: { requires: [{ flag: 'A' }, { flag: 'B' }] } },
  phase: { value: { set: 'Base', in: ['Alarm'] } }, max: { value: 3 }, cooldown: { value: 5 }, again: { value: 'restart' },
  talkBusy: { value: 'skip' }, else: { value: [{ verb: 'message', a: 'No power.' }] }, while: { value: true }, mute: { value: true },
  note: { value: 'Second keypad on the roof?' }, origin: { value: { story: 'e3' } },
};
// Every field of an action (the verbs' own arguments are below, by verb)
const ACTION_SAMPLES = {
  verb: { value: 'close' }, target: { value: 'VaultDoor' }, delay: { value: 2 }, targetTag: { value: 'VAULT' },
  area: { value: { kind: 'object', at: [0, 0, 0], radius: 512, members: ['Crate'] }, base: { verb: 'hide' } },
  requires: { value: [{ flag: 'Power', is: true }] }, id: { value: 'a7', none: true }, _group: { value: 'UCLG_L1_0', none: true },
  until: { value: { type: 'arrived', actor: 'Guard1' }, base: { verb: 'wait', target: '' } }, max: { value: 20, base: { verb: 'wait', target: '' } },
};
// a value away from the default of an argument of each type (logic.json "types")
function sampleOf(arg) {
  const by = { text: 'Vault key', state: 'Vault_Power', counter: 'Levers', goal: 'G9', map: '02_Next', tag: 'Arrive1', port: 'Start',
    args: 'Seconds=4', toggle: arg.value, yesno: '0', look: 'blue beep', sound: 'Ambient.Group.Hum', object: 'Crate', place: [10, 20, 30],
    whole: '7', amount: '7', number: '77', seconds: '9', floor: '2', button: 2, effect: 'sparks', line: 'Hello there', bool: !arg.default,
    choice: (arg.choices || []).map((c) => c[0]).find((v) => v !== (arg.default ?? '')) };
  return by[arg.type];
}
// what is drawn for a rule: its card (causes, id, badges, chips, sections and rows, otherwise) or its wire (label, badges)
function shown(g, id) {
  const card = nodeOf(g, 'rule:' + id), wire = wireOf(g, 'rule:' + id), texts = (bs) => bs.map((b) => b.text);
  if (card) {
    return JSON.stringify([card.rule, card.causes.map((c) => c.text), texts(card.badges), card.checks.map((c) => c.text),
      card.sections.map((s) => [s.title, s.rows.map((r) => [r.timeText, r.text, r.target, texts(r.badges)])]),
      card.otherwise.map((r) => [r.timeText, r.text, texts(r.badges)])]);
  }
  return JSON.stringify([wire.rule, wire.from.node, wire.label, wire.to.node, texts(wire.badges)]);
}
const rule = (over = {}, acts = [{ verb: 'open', target: 'Door3' }]) => ({ id: 'L1', src: 'Button1', when: 'used', once: false, do: acts, ...over });
const drawn = (l) => shown(graphOf(world([l])), l.id);

test('the badge rule: every field of a rule away from its default shows on its card and on its wire', () => {
  assert.deepEqual(Object.keys(RULE_SAMPLES).sort(), Object.keys(RULE_FIELDS).sort(), 'the samples and the model know the same fields');
  const missing = [];
  for (const [field, s] of Object.entries(RULE_SAMPLES)) {
    for (const acts of [undefined, [{ verb: 'open', target: 'Door3' }, { verb: 'message', a: 'Hi' }]]) {   // a wire, a card
      const base = rule(s.base, acts), changed = { ...base, [field]: s.value };
      if ((drawn(base) === drawn(changed)) !== !!s.none) missing.push(`${field} (${acts ? 'card' : 'wire'})`);
    }
  }
  assert.deepEqual(missing, [], 'a field away from its default that nothing shows, or a field said to change nothing that shows');
  assert.ok(Object.entries(RULE_FIELDS).filter(([, f]) => f.none).every(([k]) => RULE_SAMPLES[k].none), 'what shows nowhere says why');
});

test('the badge rule: every field and argument of an action away from its default shows on its row and on its wire', () => {
  const ARGS = ['a', 'b', 'c', 'at', 'nav'];
  assert.deepEqual([...Object.keys(ACTION_SAMPLES)].sort(), Object.keys(ACTION_FIELDS).sort());
  const argIds = new Set(Object.values(catalog.inputs).flatMap((v) => (v.args || []).map((a) => a.id)));
  assert.deepEqual([...argIds].sort(), [...ARGS].sort(), 'the verbs take no argument the badges do not know');
  const missing = [], onWire = [];
  const check = (what, x, field, value, none = false) => {
    const base = { ...x }, changed = { ...x, [field]: value };
    const card = (y) => drawn(rule({}, [y, { verb: 'message', a: 'Hi' }]));
    if ((card(base) === card(changed)) !== none) missing.push(`${what} (card)`);
    if (!isSimple(rule({}, [changed]))) return;
    onWire.push(what);
    if ((drawn(rule({}, [base])) === drawn(rule({}, [changed]))) !== none) missing.push(`${what} (wire)`);
  };
  for (const [field, s] of Object.entries(ACTION_SAMPLES)) check(field, { verb: 'open', target: 'Door3', ...s.base }, field, s.value, !!s.none);
  const targeted = [];
  for (const [verb, v] of Object.entries(catalog.inputs)) {
    const target = (v.acts && TARGET_OF[v.acts]) || (verb === 'sound' ? 'Crate' : '');
    for (const arg of v.args || []) {
      check(`${verb}.${arg.id}`, { verb, target }, arg.id, sampleOf(arg));
      if (target) targeted.push(`${verb}.${arg.id}`);
    }
  }
  // a radius group's own fields: what it names, how many, the newcomers and their radius, a tag; the radius of saved
  // members only changes nothing (links.py: only "newcomers" use it)
  const area = { kind: 'object', at: [0, 0, 0], radius: 512, members: ['Crate'], dynamic: true };
  for (const [field, value] of [['kind', 'light'], ['members', ['Crate', 'Button2']], ['dynamic', false], ['radius', 1024], ['tag', 'BLUE']]) {
    check(`area.${field}`, { verb: 'hide', area }, 'area', { ...area, [field]: value });
  }
  const saved = { ...area, dynamic: false };
  check('area.radius of saved members', { verb: 'hide', area: saved }, 'area', { ...saved, radius: 1024 }, true);
  assert.deepEqual(missing, []);
  assert.deepEqual(targeted.filter((w) => !onWire.includes(w)), [], 'every argument of a verb on an object was checked on a wire too');
  assert.ok(onWire.includes('delay') && onWire.includes('requires') === false, 'a step check makes a card');
});

test('the badge rule: where the rule is shows when its explosion or its sound has no object (they happen there)', () => {
  const at = (acts, over = {}) => ruleBadges(rule({ at: [12.4, -30, 0], ...over }, acts), logicIndex(world([]))).filter((b) => b.field === 'at').map((b) => b.text);
  assert.deepEqual(at([{ verb: 'explode', a: '50' }]), ['at 12, -30, 0']);
  assert.deepEqual(at([{ verb: 'message', a: 'x' }], { else: [{ verb: 'sound', a: 'DeusExSounds.Generic.Beep1', c: '512' }] }), ['at 12, -30, 0']);
  // a start rule made with none: the map's origin, as links.py places it
  assert.deepEqual(ruleBadges({ id: 'L2', when: 'start', do: [{ verb: 'explode', a: '50' }] }, logicIndex(world([]))).map((b) => b.text), ['at 0, 0, 0']);
  // elsewhere it changes nothing: an explosion at an object, a sound heard everywhere (c 0) or from an object
  assert.deepEqual(at([{ verb: 'explode', target: 'Crate', a: '50' }]), []);
  assert.deepEqual(at([{ verb: 'explode', targetTag: 'VAULT' }]), []);
  assert.deepEqual(at([{ verb: 'sound', a: 'DeusExSounds.Generic.Beep1' }, { verb: 'sound', a: 'DeusExSounds.Generic.Beep1', target: 'Crate', c: '512' }]), []);
  assert.deepEqual(at([{ verb: 'open', target: 'Door3' }]), []);
  assert.equal(RULE_FIELDS.at.none, undefined, 'not said to change nothing');
});

test('the badge rule reads a yes or no as links.py does: once 0 is no, once "false" yes', () => {
  const badges = (over) => ruleBadges(rule(over), logicIndex(world([]))).map((b) => b.text);
  assert.deepEqual(badges({ once: 0 }), []);
  assert.deepEqual(badges({ once: 'false' }), ['1×']);
  assert.deepEqual(badges({ once: 1, mute: '' }), ['1×']);
  assert.deepEqual(badges({ mute: 'no' }), ['muted']);
  assert.deepEqual(badges({ mute: 0, while: null }), []);
});

test('the badge rule: a field nobody knows still shows, with its name', () => {
  assert.match(drawn(rule({ hurry: 2 })), /hurry/);
  assert.match(drawn(rule({}, [{ verb: 'open', target: 'Door3', speed: 3 }])), /speed/);
  assert.match(drawn(rule({}, [{ verb: 'open', target: 'Door3', speed: 3 }, { verb: 'message', a: 'Hi' }])), /speed/);
  // what Logic runtime v2 runs is greyed out with its reason
  const g = graphOf(world([rule({ cooldown: 5 })]));
  assert.deepEqual(wireOf(g, 'rule:L1').badges.find((b) => b.field === 'cooldown'), { field: 'cooldown', text: 'cooldown 5 s', title: 'Not again for this long', needs: 'Logic runtime v2' });
});

test('a rule is a wire only with one cause, no checks, one action on one object', () => {
  const simple = (over, acts) => isSimple(rule(over, acts));
  assert.equal(simple(), true);
  assert.equal(simple({ once: true, mute: true }), true);                          // options are badges on the wire
  assert.equal(simple({ requires: [{ flag: 'A' }] }), false);
  assert.equal(simple({ also: [{ src: 'Button2', when: 'used' }] }), false);
  assert.equal(simple({ else: [{ verb: 'message', a: 'x' }] }), false);
  assert.equal(simple({}, [{ verb: 'open', target: 'Door3' }, { verb: 'open', target: 'VaultDoor' }]), false);
  assert.equal(simple({}, [{ verb: 'message', a: 'Hi' }]), false);                  // no object: a card
  assert.equal(simple({}, [{ verb: 'open', targetTag: 'VAULT' }]), false);
  assert.equal(simple({}, [{ verb: 'open', target: 'Door3', requires: [{ flag: 'A' }] }]), false);
  assert.equal(simple({}, []), false);
  // clicking its label opens it as a card; it folds back when the window forgets it
  const l = rule();
  assert.ok(wireOf(graphOf(world([l])), 'rule:L1'));
  assert.equal(nodeOf(graphOf(world([l]), { open: ['L1'] }), 'rule:L1').kind, 'rule');
  // a card's rows in time order, as the game runs them (links.blocks sorts them), each keeping its place in the list
  const timed = nodeOf(graphOf(world([rule({}, [{ verb: 'open', target: 'Door3', delay: 3 }, { verb: 'message', a: 'Hi' }, { verb: 'close', target: 'Door3', delay: 1.5 }])])), 'rule:L1');
  assert.deepEqual(timed.sections[0].rows.map((r) => [r.timeText, r.index, r.act]), [['0 s', 1, 'a2'], ['1.5 s', 2, 'a3'], ['3 s', 0, 'a1']]);
  // a rule of the map's start comes from the World
  const start = graphOf(world([{ id: 'L2', src: '', when: 'start', do: [{ verb: 'lock', target: 'VaultDoor' }] }]));
  assert.deepEqual(pins(nodeOf(start, 'world'), 'out'), ['out:start=the map starts']);
  assert.deepEqual([wireOf(start, 'rule:L2').from, wireOf(start, 'rule:L2').label], [{ node: 'world', pin: 'out:start' }, 'the map starts → Lock']);
});

// ---------------------------------------------------------------- the logic's own items, the Story, the game wiring
test('logic.json\'s sections for the window hold together: setsOff, pieces, the Story\'s words', () => {
  for (const [verb, outs] of Object.entries(catalog.setsOff)) {
    assert.ok(Object.hasOwn(catalog.inputs, verb), verb);
    for (const o of outs) assert.ok(o === 'output' || Object.hasOwn(catalog.outputs, o), `${verb} sets off ${o}`);
  }
  for (const [kind, p] of Object.entries(catalog.pieces)) {
    assert.ok(p.label && p.noun && catalog.levels.includes(p.level), kind);
    for (const port of [...p.in, ...p.out]) {
      assert.match(port.id, /^\w+$/, `${kind} ${port.id}`);
      assert.ok([undefined, 'inputs', 'outputs', 'list'].includes(port.many), `${kind} ${port.id} many`);
      assert.equal(/\{n\}/.test(port.label), port.many === 'inputs' || port.many === 'outputs', `${kind} ${port.id}: {n} only when numbered`);
      assert.equal(/\{name\}/.test(port.label), port.many === 'list', `${kind} ${port.id}: {name} only per phase`);
    }
  }
  for (const [word, verb] of Object.entries(catalog.story)) assert.ok(Object.hasOwn(catalog.inputs, verb), `${word} -> ${verb}`);
});

test('a big map is quick to project: 1,000 rules', () => {
  const links = [], actors = { ...ACTORS };
  for (let k = 0; k < 1000; k++) {
    actors['B' + k] = ACTORS.Button1; actors['D' + k] = ACTORS.Door3;
    links.push(k % 2 ? { id: 'L' + k, src: 'B' + k, when: 'used', do: [{ verb: 'open', target: 'D' + k }] }
      : { id: 'L' + k, src: 'B' + k, when: 'used', requires: [{ type: 'counter', counter: 'C' + (k % 50), op: '>=', value: 1 }],
        do: [{ verb: 'count', a: 'C' + ((k + 1) % 50), b: '1' }, { verb: 'open', target: 'D' + k, delay: 1 }] });
  }
  const t0 = performance.now(), ix = logicIndex({ ...world(links), actors }), g = logicGraph(ix);
  scopeOf(g, { kind: 'chain', root: 'obj:B0' });
  assert.ok(performance.now() - t0 < 3000, `${Math.round(performance.now() - t0)} ms`);
  assert.equal(g.nodes.filter((n) => n.kind === 'rule').length, 500);
});

test('edits.logic: blocks, phases, signals, groups and points are nodes with ports a rule reaches like a script\'s', () => {
  const logic = {
    blocks: [{ id: 'B1', kind: 'allof', name: 'Alarms off', inputs: 3, takeBack: true }, { id: 'B2', kind: 'counter', name: 'Generators down', goal: 3 },
      { id: 'B6', kind: 'switch', name: 'Which vent', outputs: 2, mode: 'random' }],
    phases: [{ id: 'Base', name: 'Base alert', list: ['Quiet', 'Alarm', 'Lockdown'], start: 'Quiet' }],
    signals: [{ name: 'AlarmRaised' }], groups: [{ id: 'G1', name: 'Lab B guards', members: ['Guard1'] }],
    points: [{ id: 'P1', name: 'Reinforcement door', at: [1200, -300, 48], radius: 300 }],
  };
  const links = [
    { id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'input', target: 'blk:B1', a: 'in2' }] },
    { id: 'L2', src: 'blk:B1', when: 'output', port: 'all', do: [{ verb: 'open', target: 'Door3' }, { verb: 'input', target: 'sig:AlarmRaised', a: 'send' }] },
    { id: 'L3', src: 'sig:AlarmRaised', when: 'output', port: 'sent', do: [{ verb: 'input', target: 'ph:Base', a: 'goto_Alarm' }] },
    { id: 'L4', src: 'Zone1', when: 'enter', do: [{ verb: 'hostile', target: 'grp:G1' }] },
    { id: 'L5', src: 'blk:B2', when: 'output', port: 'reached', do: [{ verb: 'message', a: 'All three down' }] },
  ];
  const g = graphOf(world(links, { edits: { logic } }));
  const b1 = nodeOf(g, 'blk:B1');
  assert.deepEqual([b1.kind, b1.family, b1.label, b1.word], ['block', 'allof', 'Alarms off', 'All of']);
  assert.deepEqual(pins(b1, 'in'), ['in:input:in2=input 2']);
  assert.equal(b1.more.in, 3);                                                     // input 1, input 3, reset
  assert.deepEqual(nodeOf(graphOf(world(links, { edits: { logic } }), { showAll: ['blk:B2'] }), 'blk:B2').pins.out.map((p) => p.label), ['reaches 3', 'changed']);
  assert.deepEqual(nodeOf(g, 'rule:L2').causes.map((c) => c.text), ['When block "Alarms off" says "all done"']);
  assert.deepEqual(pins(nodeOf(g, 'ph:Base'), 'in'), ['in:input:goto_Alarm=go to Alarm']);
  assert.equal(nodeOf(g, 'ph:Base').word, 'Phase set');
  assert.deepEqual(nodeOf(g, 'grp:G1').members, ['Guard1']);
  assert.deepEqual(['blk:B6', 'pt:P1'].map((id) => nodeOf(g, id)), [undefined, undefined]);    // not used: not drawn
  // their live values, in words, from what Try it or the log knows
  assert.deepEqual([liveValue(b1, { done: 2 }), liveValue(nodeOf(g, 'ph:Base'), { phase: 'Alarm' }), liveValue(b1, null), liveValue(nodeOf(g, 'obj:Button1'), { x: 1 })],
    ['2 / 3', 'Phase: Alarm', '', '']);
  // a signal is a hub: what goes in and out of it are signal wires
  assert.deepEqual(g.wires.filter((w) => w.kind === 'signal').map((w) => w.id), ['act:L2/a2', 'rule:L3']);
});

test('every node key is made from the prefix tables: things, the logic\'s items, the Story, groups made on the spot', () => {
  const logic = { blocks: [{ id: 'B1', kind: 'allof', name: 'Alarms off', inputs: 2 }], phases: [{ id: 'Base', name: 'Base alert', list: ['Quiet', 'Alarm', 'Lockdown'] }],
    signals: [{ name: 'AlarmRaised' }] };
  const story = { dialogues: [{ id: 'd1', title: 'Gate talk', owner: 'Guard1', steps: [] }], infolinks: [{ id: 'i1', title: 'Jock calls' }],
    events: [{ id: 'e1', when: {}, do: [{ type: 'talk', dialogue: 'd1' }, { type: 'infolink', infolink: 'i1' }] }] };
  const blk = pieceId('blocks', 'B1'), ph = pieceId('phases', 'Base'), sig = pieceId('signals', 'AlarmRaised');
  const links = [{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'input', target: blk, a: 'in1' }, { verb: 'input', target: ph, a: 'goto_Alarm' },
    { verb: 'input', target: sig, a: 'send' }, { verb: 'hide', area: { kind: 'object', at: [0, 0, 0], radius: 64, members: ['Crate'] } }, { verb: 'open', targetTag: 'VAULT' }] }];
  const ix = logicIndex(world(links, { story, edits: { logic } })), g = logicGraph(ix);
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const id of [blk, ph, sig, storyId('dialogues', 'd1'), storyId('infolinks', 'i1'), storyId('events', 'e1'), GROUP_KINDS.area + 'L1/a4', GROUP_KINDS.tag + 'VAULT']) {
    assert.ok(ids.has(id), id);
    assert.equal(thingId(id), id, `${id} is a node key already`);
  }
  assert.equal(thingId('Crate'), 'obj:Crate');
  assert.deepEqual(g.wires.filter((w) => w.kind === 'signal').map((w) => w.to.node), [sig]);
  // the Story's start of a dialogue and play of an InfoLink reach their nodes
  assert.deepEqual(nodeOf(g, storyId('events', 'e1')).rows.map((r) => r.target), [storyId('dialogues', 'd1'), storyId('infolinks', 'i1')]);
  // the problems point at the same keys
  const problems = logicProblems(ix).filter((p) => ['unwired-input', 'phase-never-entered'].includes(p.code)).map((p) => p.node);
  assert.deepEqual(problems, [blk, ph]);
  // the tables' prefixes are all different, and each ends its kind's word
  const prefixes = [...Object.values(PIECE_KINDS).map(([p]) => p), ...STORY_KINDS.map(([, p]) => p), ...Object.values(GROUP_KINDS)];
  assert.equal(new Set(prefixes).size, prefixes.length);
  assert.ok(prefixes.every((p) => /^\w+:$/.test(p)), prefixes.join(' '));
});

test('the model\'s wires take the canvas\'s wire kinds (graph-canvas.js WIRE_KINDS): game wiring is drawn read only', async () => {
  const kinds = await canvasWireKinds();
  const links = [{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'count', a: 'Levers', b: '1' }, { verb: 'input', target: 'sig:AlarmRaised', a: 'send' }] },
    { id: 'L2', src: 'Button2', when: 'used', requires: [{ type: 'counter', counter: 'Levers', op: '>=', value: 1 }], do: [{ verb: 'open', target: 'Door3' }, { verb: 'message', a: 'x' }] }];
  const g = graphOf(world(links, { edits: { logic: { signals: [{ name: 'AlarmRaised' }] } }, wiring: [{ from: 'Pad1', to: 'Door3', why: 'triggers' }] }));
  const used = [...new Set(g.wires.map((w) => w.kind))].sort();
  assert.deepEqual(used, Object.keys(kinds).sort(), 'the model uses every kind the canvas draws, and no other');
  const game = g.wires.find((w) => w.readOnly && w.label === 'triggers');
  assert.match(kinds[game.kind].dash, /\d/, 'game wiring is dashed or dotted, not a solid "causes" wire');
  assert.match(kinds[game.kind].label, /read only/);
});

test('groups made on the spot: a radius group and a scripting tag are unnamed group nodes', () => {
  const area = { kind: 'light', at: [0, 0, 0], radius: 512, members: ['Lamp1', 'Lamp2'], dynamic: true };
  const g = graphOf(world([{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'lightoff', area }, { verb: 'open', targetTag: 'VAULT' }] }], { tags: { VAULT: ['Door3', 'VaultDoor'] } }));
  const a = nodeOf(g, 'area:L1/a1'), tag = nodeOf(g, 'tag:VAULT');
  assert.deepEqual([a.kind, a.unnamed, a.label, a.members], ['group', true, '2 saved lights + newcomers within 512 units', ['Lamp1', 'Lamp2']]);
  assert.deepEqual([tag.label, tag.members], ['objects tagged VAULT', ['Door3', 'VaultDoor']]);
  assert.deepEqual(nodeOf(g, 'rule:L1').sections[0].rows.map((r) => [r.text, r.target, r.pin]), [
    ['turn off: 2 saved lights + newcomers within 512 units', 'area:L1/a1', 'in:lightoff'], ['open objects tagged VAULT', 'tag:VAULT', 'in:open']]);
});

test('the Story, read only: its events act on things, start dialogues, set the states rules read', () => {
  const story = {
    dialogues: [{ id: 'd1', title: 'Gate talk', owner: 'Guard1', start: 'near', requires: [{ flag: 'Met', is: true }], steps: [{ type: 'line', who: 'npc', text: 'Halt.' }] }],
    infolinks: [{ id: 'i1', title: 'Jock calls', caller: 'Jock', name: 'Jock', lines: [{ text: 'Get to the roof.' }], do: [{ type: 'flag', flag: 'Roof', is: true }] }],
    events: [{ id: 'e1', title: 'Body found', when: { type: 'dead', actor: 'Guard1' }, do: [{ type: 'door', actor: 'Door3', act: 'open' }, { type: 'talk', dialogue: 'd1' }, { type: 'npc', actor: 'Guard1', act: 'stop' }] }],
  };
  const g = graphOf(world([{ id: 'L1', src: 'Button1', when: 'used', requires: [{ flag: 'Roof', is: true }, { flag: 'Nobody', is: true }], do: [{ verb: 'open', target: 'VaultDoor' }] }], { story }));
  const e1 = nodeOf(g, 'story:e1');
  assert.deepEqual([e1.kind, e1.readOnly, e1.cause], ['storyrule', true, 'the character Guard1 is not alive']);
  assert.deepEqual(e1.rows.map((r) => [r.text, r.target, r.pin]), [['open the door Door3', 'obj:Door3', 'in:open'], ['start the dialogue "Gate talk"', 'dlg:d1', 'in:talk'],
    ['the character Guard1 stands still', 'obj:Guard1', 'in:stand']]);
  // a dialogue that is not in the Story: missing, by its own id
  const lost = graphOf(world([], { story: { events: [{ id: 'e2', when: {}, do: [{ type: 'talk', dialogue: 'd9' }] }] } }));
  assert.deepEqual(nodeOf(lost, 'story:e2').rows.map((r) => r.text), ['start d9 (missing)']);
  assert.equal(nodeOf(lost, 'dlg:d9').missing, true);
  assert.deepEqual(wireOf(g, 'story:e1/s2').to, { node: 'dlg:d1', pin: 'in:start' });          // into the dialogue's Start
  assert.deepEqual(pins(nodeOf(g, 'obj:Guard1'), 'out'), ['out:story:near=JC gets close (dialogue)']);
  assert.deepEqual(nodeOf(g, 'dlg:d1').checks.map((c) => [c.text, c.unset]), [['Met is Yes', true]]);
  const [roof, nobody] = nodeOf(g, 'rule:L1').checks;
  assert.deepEqual([roof.setBy, roof.unset], [[{ node: 'info:i1', text: 'the InfoLink "Jock calls"' }], false]);
  assert.deepEqual(['dlg:d1', 'info:i1', 'story:e1'].map((id) => nodeOf(g, id).word), ['dialogue', 'InfoLink', 'Story event']);
  assert.deepEqual([nobody.setBy, nobody.unset], [[], true]);
  assert.ok(g.wires.some((w) => w.kind === 'state' && w.from.node === 'info:i1' && w.to.pin === 'if:0'));
});

test('who sets a state: another map, the original game, a character\'s fate, a mission state', () => {
  const read = (flag, more = {}) => nodeOf(graphOf(world([{ id: 'L1', src: 'Button1', when: 'used', requires: [{ flag, is: true }], do: [{ verb: 'open', target: 'VaultDoor' }] }], more)), 'rule:L1').checks[0];
  assert.equal(read('Vault_Power').unset, true);
  const other = read('Vault_Power', { external: [{ flag: 'Vault_Power', source: 'project', type: 'bool', uses: [{ map: '02_Roof', context: 'Interaction: L4', kind: 'write' }] }] });
  assert.deepEqual([other.setBy, other.unset], [[{ node: null, text: 'Interaction: L4 (02_Roof)' }], false]);
  assert.equal(read('M02_Quiet', { external: [{ flag: 'M02_Quiet', source: 'original mission script', uses: [] }] }).unset, false);
  assert.equal(read('Vault_Power', { external: [{ flag: 'Vault_Power', uses: [{ map: '01_Test', context: 'x', kind: 'write' }] }] }).unset, true);   // this map's own: not elsewhere
  // a character's fate: the game sets it, said as the state field says it (state-model.js stateLabel)
  assert.deepEqual([read('UCFate1a2b3c_Guard1_Dead').setBy, read('UCFate1a2b3c_Guard1_Dead').unset], [[{ node: null, text: 'the game (Guard1 · Was killed)' }], false]);
  assert.deepEqual(read('UCFate1a2b3c_Guard1_Down').setBy, [{ node: null, text: 'the game (Guard1 · Was killed or knocked out)' }]);
  assert.equal(read('Vault_Power', { edits: { logic: { states: [{ name: 'Vault_Power', scope: 'mission' }] } } }).unset, false);
});

test('a state or a counter is one by the name the game gives it: "Keys found" is Keys_found, "città" citta', () => {
  const links = [{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'count', a: 'Keys found', b: '1' }, { verb: 'flag', a: 'città', b: '1' }] },
    { id: 'L2', src: 'Button2', when: 'used', requires: [{ type: 'counter', counter: 'Keys_found', op: '>=', value: 1 }, { flag: 'CITTA', is: true }],
      do: [{ verb: 'open', target: 'Door3' }] }];
  const ix = logicIndex(world(links)), g = logicGraph(ix);
  assert.deepEqual(g.states.map((s) => [s.name, s.setBy, s.readBy]), [['Keys found', 1, 1], ['città', 1, 1]]);       // named as first typed
  assert.deepEqual(nodeOf(g, 'rule:L2').checks.map((c) => c.unset), [false, false]);
  assert.deepEqual(g.wires.filter((w) => w.kind === 'state').map((w) => `${w.from.pin}>${w.to.pin}`), ['act:L1/a1>if:0', 'act:L1/a2>if:1']);
  assert.deepEqual(logicProblems(ix).filter((p) => ['never-set', 'never-read'].includes(p.code)), []);
  assert.deepEqual(['Keys found', ' keys_FOUND ', 'città', '3rd door'].map(stateKey), ['keys_found', 'keys_found', 'citta', 'x_3rd_door']);
  assert.equal(ix.states.get(stateKey('Keys_found')), ix.states.get(stateKey('Keys found')));
});

test('the original game wiring: read-only dotted wires between the things, not when hidden', () => {
  const wiring = [{ from: 'Button1', to: 'Door3', why: 'triggers' }, { from: 'Button1', to: 'Door3', why: 'triggers' }, { from: 'Pad1', to: 'Pad1', why: 'x' }];
  const g = graphOf(world([], { wiring }));
  assert.deepEqual(g.wires.map((w) => [w.kind, w.readOnly, w.label, w.from, w.to]), [['wiring', true, 'triggers', { node: 'obj:Button1', pin: 'out:game' }, { node: 'obj:Door3', pin: 'in:game' }]]);
  assert.deepEqual(graphOf(world([], { wiring }), { game: false }).wires, []);
});

test('the verbs\' arguments are logic.json\'s: one a verb does not take changes nothing, one nobody takes shows', () => {
  const extended = JSON.parse(JSON.stringify(catalog));
  extended.inputs.message.args.push({ id: 'd', type: 'text', label: 'Colour' });
  const fields = (cat, x) => logicGraph(logicIndex({ ...world([rule({}, [x, { verb: 'message', a: 'Hi' }])]), catalog: cat })).nodes
    .find((n) => n.id === 'rule:L1').sections[0].rows[0].badges.map((b) => b.field);
  assert.deepEqual(fields(extended, { verb: 'open', target: 'Door3', d: 'red' }), []);           // a message's argument, on an open
  assert.deepEqual(fields(catalog, { verb: 'open', target: 'Door3', d: 'red' }), ['d']);          // nobody's: shown with its name
  assert.deepEqual(fields(catalog, { verb: 'open', target: 'Door3', a: 'x' }), []);
});

test('action ids: kept when there, the first free otherwise, written only when asked', () => {
  assert.deepEqual(actionIds([{}, { id: 'a1' }, {}, { id: 'a3' }, {}]), ['a2', 'a1', 'a4', 'a3', 'a5']);
  assert.deepEqual(actionIds([{}, {}], 'e'), ['e1', 'e2']);
  const links = [{ id: 'L1', do: [{ verb: 'open' }, { id: 'a1', verb: 'close' }], else: [{ verb: 'message' }] }];
  ensureActionIds(links);
  assert.deepEqual([links[0].do.map((x) => x.id), links[0].else.map((x) => x.id)], [['a2', 'a1'], ['e1']]);
  const g = graphOf(world([{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'open', target: 'Door3' }, { verb: 'close', target: 'VaultDoor', id: 'a1' }] }]));
  assert.deepEqual(g.wires.filter((w) => w.part === 'do').map((w) => w.id), ['act:L1/a2', 'act:L1/a1']);
});

// ---------------------------------------------------------------- scopes
test('chain of the selection: one step upstream, the whole chain downstream, capped with "+N more"', () => {
  // a long chain: Button1 -> Timer... each rule sets off the next, through cards
  const links = [{ id: 'L0', src: 'Button1', when: 'used', do: [{ verb: 'timerstart', target: 'T1' }, { verb: 'message', a: 'go' }] }];
  const actors = { ...ACTORS };
  for (let k = 1; k <= 40; k++) {
    actors['T' + k] = ACTORS.Timer1;
    links.push({ id: 'L' + k, src: 'T' + k, when: 'finished', do: [{ verb: 'timerstart', target: 'T' + (k + 1) }, { verb: 'message', a: String(k) }] });
  }
  actors.T41 = ACTORS.Timer1;
  const g = graphOf({ ...world(links), actors });
  const s = scopeOf(g, { kind: 'chain', root: 'obj:T5' });
  assert.equal(s.nodes[0].id, 'obj:T5');
  assert.deepEqual(s.nodes.slice(1, 3).map((n) => n.id), ['rule:L4', 'obj:T4']);   // upstream first: the rule that acts on it, its cause
  assert.equal(s.nodes.length, SCOPE_LIMIT);
  assert.equal(s.total, 1 + 2 + 2 * 36);                                           // T5; upstream L4, T4; L5 .. L40 and T6 .. T41
  assert.equal(s.hidden, s.total - SCOPE_LIMIT);
  const last = s.nodes[s.nodes.length - 1].id;
  assert.deepEqual(s.more, { [last]: 1, 'obj:T4': 1 });                           // the stubs: one past the end, one above T4
  assert.ok(s.wires.every((w) => s.nodes.some((n) => n.id === w.from.node) && s.nodes.some((n) => n.id === w.to.node)));
  assert.deepEqual(scopeOf(g, { kind: 'chain', root: 'obj:Nothing' }).nodes, []);
  const f = graphOf(lab), script = scopeOf(f, { kind: 'chain', root: 'obj:UCEdit29' });
  assert.deepEqual(script.nodes.map((n) => n.id), ['obj:UCEdit29', 'obj:UCEdit5', 'rule:L5']);   // the button (its wire L4), what it says
  assert.deepEqual(script.more, { 'obj:UCEdit5': 4 });
  const button = scopeOf(f, { kind: 'chain', root: 'obj:UCEdit5' });
  assert.deepEqual(button.nodes.map((n) => n.id).sort(), ['dlg:d1', 'obj:UCEdit29', 'obj:UCEdit5', 'obj:UCEdit8', 'obj:UCEditBox7', 'rule:L1', 'rule:L2', 'rule:L3', 'rule:L5', 'rule:L6', 'rule:L7', 'rule:L8']);
});

test('the other scopes: near (neighbourhood), a page, a state, the whole map', () => {
  const links = [{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'count', a: 'Levers', b: '1' }, { verb: 'open', target: 'Door3' }] },
    { id: 'L2', src: 'Button2', when: 'used', requires: [{ type: 'counter', counter: 'Levers', op: '>=', value: 2 }], do: [{ verb: 'open', target: 'VaultDoor' }] },
    { id: 'L3', src: 'Zone1', when: 'enter', do: [{ verb: 'lighton', target: 'Lamp1' }] }];
  const view = { pages: [{ id: 'pg1', name: 'Vault', nodes: ['obj:Button2', 'rule:L2', 'obj:Gone'] }] };
  const input = world(links, { edits: { logic: { view } } }), ix = logicIndex(input), g = logicGraph(ix);
  const ids = (s) => s.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids(scopeOf(g, { kind: 'near', root: 'obj:Button1' })), ['obj:Button1', 'obj:Door3', 'rule:L1', 'rule:L2']);
  assert.deepEqual(ids(scopeOf(g, { kind: 'page', page: 'pg1' })), ['obj:Button2', 'rule:L2']);
  assert.deepEqual(scopeOf(g, { kind: 'page', page: 'pg1' }).more, { 'rule:L2': 2 });           // VaultDoor, and L1 that sets its counter
  assert.deepEqual(ids(scopeOf(g, { kind: 'state', state: 'levers' }, { ix })), ['obj:Button1', 'obj:Button2', 'rule:L1', 'rule:L2']);
  assert.equal(scopeOf(g, { kind: 'map' }).nodes.length, g.nodes.length);
  assert.deepEqual(g.pages, view.pages);
});
