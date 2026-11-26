// What the Blackout Protocol test mission (26 Nov 2026, a 2-map mission made only with the Logic) found wrong in the
// page's side of the scripting: a Phases block made in the same proposal as its rules, a NanoKey condition (the key
// is on the keyring, the pickup destroyed), a gate opened while a condition holds. Write-up:
// backup/20261126_blackout/README.md
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyOps } from '../editor/static/logic-propose.js';
import { conditionHolds, conditionText, conditionProblem } from '../editor/static/conditions.js';
import { decodeCondition } from '../editor/static/logic-log.js';

const kit = new URL('../', import.meta.url);
const logic = JSON.parse(readFileSync(new URL('editor/config/logic.json', kit), 'utf8'));

test('the rules of a Phases block made in the same proposal use its own phases\' ports', () => {
  // the page's blockIo reads the block's props as the Logic window does (app.js blockPorts): here its phases
  const phasePorts = (props) => {
    const ids = String(props?.Phases || '').split(',').map((s) => s.trim()).filter(Boolean);
    return { inputs: ids.map((p) => 'input:GoTo_' + p), outputs: ids.flatMap((p) => ['output:Enter_' + p, 'output:Leave_' + p]) };
  };
  const seen = [];
  const ctx = {
    exists: (n) => n === 'Button1', outputsOf: (n) => (n === 'Button1' ? ['used'] : null), inputsOf: () => null,
    blockIo: (cls, props, name) => { seen.push([cls, name]); return cls === 'UCBPhases' ? phasePorts(props) : null; },
    verbs: logic.inputs, outputs: logic.outputs, free: logic.free,
    where: () => [0, 0, 0], newName: (cls, taken) => { let i = 0; while (taken('UCEdit' + i)) i++; return 'UCEdit' + i; },
  };
  const p = applyOps({ links: [], added: [], logic: { groups: [] } }, [
    { op: 'add_block', cls: 'UCBPhases', at: [0, 0, 0], props: { Phases: 'Infiltrate, Sabotage, Blackout' }, ref: 'ph' },
    { op: 'add_rule', rule: { src: 'Button1', when: 'used', do: [{ verb: 'input', target: '$ph', a: 'GoTo_Sabotage' }] } },
    { op: 'add_rule', rule: { src: '$ph', when: 'output', port: 'Enter_Blackout', do: [{ verb: 'message', a: 'Dark' }] } },
  ], ctx);
  assert.deepEqual(p.errors, []);                     // was: cannot input:GoTo_Sabotage (the class's ports only)
  assert.deepEqual(seen[0], ['UCBPhases', 'UCEdit0']);
});

test('a NanoKey condition reads the keyring: the key of a Key ID, or any key', () => {
  const ring = (keys) => ({ carries: (cls, id) => (/nanokey$/i.test(cls) ? (id ? keys.includes(id.toLowerCase()) : keys.length > 0) : false) });
  const c = { type: 'item', item: 'DeusEx.NanoKey', has: true, keyId: 'EastCage' };
  assert.equal(conditionHolds(c, ring([])), false);
  assert.equal(conditionHolds(c, ring(['eastcage'])), true);
  assert.equal(conditionHolds(c, ring(['other'])), false);
  assert.equal(conditionHolds({ ...c, keyId: '' }, ring(['other'])), true);
  assert.equal(conditionHolds({ ...c, has: false }, ring([])), true);
  assert.equal(conditionText(c), 'the player has the key EastCage on the keyring');
  assert.equal(conditionText({ ...c, keyId: '' }), 'the player has any key on the keyring');
  assert.equal(conditionProblem(c), '');
  assert.match(conditionProblem({ ...c, keyId: 'two words' }), /Key ID/);
  // the game's log line says it back whole
  assert.deepEqual(decodeCondition('item|DeusEx.NanoKey|1|EastCage'), c);
  assert.deepEqual(decodeCondition('item|DeusEx.Multitool|0'), { type: 'item', item: 'DeusEx.Multitool', has: false });
});

test('a gate opened while a condition holds is closed when it stops; a climbable area as before', () => {
  assert.deepEqual(logic.inversePorts, { On: 'Off', Off: 'On', Open: 'Close', Close: 'Open' });
  const gate = logic.families?.find?.((f) => f.id === 'gate') || null;
  if (gate) for (const port of ['Open', 'Close']) assert.ok(gate.ports.inputs.some((i) => i.id === port), port);
});

// ---- Try it (logic-sim.js): a climbable area is a block (UCClimbArea extends UCBlock): On, Off, Toggle, its start
import { createSession } from '../editor/static/logic-sim.js';
const deco = ['Button1', 'DeusExDecoration', 'Decoration', 'Actor'];
const q = (v) => `"${v}"`;
function rule(id, src, when, acts) {
  const props = { Tag: `UCL_${src}`, When: when, Rule: q(id), Source: q(src) };
  acts.forEach((a, i) => { props[`Act(${i})`] = q(a); });
  return { cls: 'UCLink', name: `UCLink_${id}`, props };
}
test('Try it: a climbable area turned on, off and toggled (26 Nov 2026: "has no input On")', () => {
  const world = { player: 'JCDentonMale0', actors: [
    { name: 'Button1', chain: deco, at: [0, 0, 0] }, { name: 'Button2', chain: deco, at: [50, 0, 0] },
    { name: 'Climb1', chain: ['UCClimbArea', 'UCBlock', 'UCScript', 'Actor'], at: [0, 0, 0], block: { off: true } }] };
  const s = createSession({ actors: [rule('L1', 'Button1', 'used', ['0|input|Climb1|On||']), rule('L2', 'Button2', 'used', ['0|input|Climb1|Toggle||'])],
    outputs: logic.outputs, world, map: 'M' });
  for (const b of ['Button1', 'Button2', 'Button2']) { s.fire({ thing: b, output: 'used' }); s.run(0.3); }
  const lines = s.log().map(({ line }) => line.split('|'));
  assert.deepEqual(lines.filter((f) => f[0] === 'noinput'), []);
  assert.deepEqual(lines.filter((f) => f[0] === 'value').map((f) => f.pop()), ['off', 'on', 'off', 'on']);
});

test('Try it: the player coming near a thing again sets its rule off again (they walked away in between)', () => {
  const world = { player: 'JCDentonMale0', actors: [{ name: 'Door1', chain: ['DeusExMover', 'Mover', 'Actor'], at: [0, 0, 0] }] };
  const near = rule('L1', 'Door1', 'near', ['0|message||Near||']);
  near.props.NearDist = '96';
  const s = createSession({ actors: [near], outputs: logic.outputs, world, map: 'M' });
  s.run(0.6);
  for (let k = 0; k < 2; k++) { s.fire({ thing: 'Door1', output: 'near' }); s.run(1.5); }
  const said = s.log().map(({ line }) => line.split('|')).filter((f) => f[0] === 'act' && f[3] === 'message').map((f) => f.pop());
  assert.deepEqual(said, ['Near', 'Near']);
});

// ---- reinforcements (26 Nov 2026): "MJ12Troop" went into the game as no class ("spawn||missing"), nobody came
import { logicIndex } from '../editor/static/logic-graph-model.js';
import { logicProblems } from '../editor/static/logic-graph-problems.js';
import { world } from './logic_graph_world.mjs';
test('a character class without its package: a proposal takes the known one or refuses it, the checks say so', () => {
  const ctx = { exists: (n) => n === 'Button1', outputsOf: (n) => (n === 'Button1' ? ['used'] : null), inputsOf: () => null, blockIo: () => null,
    verbs: logic.inputs, outputs: logic.outputs, free: logic.free, where: () => [0, 0, 0], newName: () => 'UCEdit0' };
  const propose = (a) => applyOps({ links: [], added: [], logic: { groups: [] } },
    [{ op: 'add_rule', rule: { src: 'Button1', when: 'used', do: [{ verb: 'spawn', a, b: 2, at: [0, 0, 0] }] } }], ctx);
  for (const [a, as] of [['MJ12Troop', 'DeusEx.MJ12Troop'], ['mj12troop', 'DeusEx.MJ12Troop'], ['DeusEx.Cop', 'DeusEx.Cop'], ['RevPawns.Guard', 'RevPawns.Guard']]) {
    const p = propose(a);
    assert.deepEqual(p.errors, [], a);
    assert.equal(p.edits.links[0].do[0].a, as, a);
  }
  assert.match(propose('Troopz').errors[0], /Package\.Class \(e\.g\. DeusEx\.MJ12Troop\), not "Troopz"/);
  const ps = logicProblems(logicIndex(world([{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'spawn', a: 'MJ12Troop', b: 2, at: [0, 0, 0] }] }])));
  assert.deepEqual(ps.filter((p) => p.code === 'class-package').map((p) => p.level), ['error']);
  const ok = logicProblems(logicIndex(world([{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'spawn', a: 'DeusEx.MJ12Troop', b: 2, at: [0, 0, 0] }] }])));
  assert.deepEqual(ok.filter((p) => p.code === 'class-package'), []);
});
