// Signals as hubs in the Logic window (P3, the design's "one small hub node per signal, with dashed wires to its
// senders and hearers"): logic-graph-model.js gives every signal the rules send or wait for one node, sig:<name>,
// whatever the case it is written in; a rule that sends it is wired into the hub, a rule that waits for it is wired
// out of it (signal wires), never from the map. The problems name a signal nobody waits for and one nobody sends; the
// Read view puts the rules waiting for one under it; the index lists the signals; a chain goes through a hub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicIndex, logicGraph, scopeOf } from '../editor/static/logic-graph-model.js';
import { logicProblems } from '../editor/static/logic-graph-problems.js';
import { readView } from '../editor/static/logic-graph-read.js';
import { world } from './logic_graph_world.mjs';

const LINKS = [
  { id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'signal', a: 'Alarm' }, { verb: 'message', a: 'Sent' }] },
  { id: 'L2', when: 'signal', signal: 'alarm', do: [{ verb: 'open', target: 'Door3' }] },                 // another case
  { id: 'L3', when: 'signal', signal: 'Alarm ', requires: [{ flag: 'Power', is: true }], do: [{ verb: 'message', a: 'Heard' }] },
  { id: 'L4', src: 'Button2', when: 'used', do: [{ verb: 'message', a: 'x' }], else: [{ verb: 'signal', a: 'Lights out' }] },
  { id: 'L5', when: 'signal', signal: 'Nobody sends', do: [{ verb: 'message', a: 'never' }] },
  { id: 'L6', when: 'start', do: [{ verb: 'flag', a: 'Power', b: '1' }] },
];
const ix = () => logicIndex(world(LINKS));
const wire = (g, id) => g.wires.find((w) => w.id === id);

test('signal hubs: one node per signal, its senders wired in and the rules waiting for it wired out', () => {
  const g = logicGraph(ix());
  const hubs = g.nodes.filter((n) => n.kind === 'signal');
  assert.deepEqual(hubs.map((n) => [n.id, n.label, n.word, n.missing]).sort(),
    [['sig:Alarm', 'Alarm', 'Signal', false], ['sig:Lights out', 'Lights out', 'Signal', false], ['sig:Nobody sends', 'Nobody sends', 'Signal', false]]);
  const alarm = hubs.find((n) => n.id === 'sig:Alarm');
  assert.deepEqual([alarm.pins.in.map((p) => p.label), alarm.pins.out.map((p) => p.label)], [['send it'], ['it is sent']]);
  // L1's step goes into the hub; L2 (simple) is a wire out of it; L3's card hears it
  assert.deepEqual([wire(g, 'act:L1/a1').kind, wire(g, 'act:L1/a1').to], ['signal', { node: 'sig:Alarm', pin: 'in:signal' }]);
  assert.deepEqual([wire(g, 'rule:L2').kind, wire(g, 'rule:L2').from, wire(g, 'rule:L2').label], ['signal', { node: 'sig:Alarm', pin: 'out:signal' }, 'it is sent → Open']);
  assert.deepEqual(wire(g, 'rule:L3/cause0').from, { node: 'sig:Alarm', pin: 'out:signal' });
  assert.deepEqual(wire(g, 'act:L4/e1').to.node, 'sig:Lights out', 'an Otherwise sends it too');
  // the map no longer starts them: only L6 is on it
  const map = g.nodes.find((n) => n.id === 'world');
  assert.deepEqual(map.pins.out.map((p) => p.key), ['start']);
  assert.equal(g.nodes.find((n) => n.id === 'rule:L3').causes[0].short, 'it is sent');
});

test('signal hubs: the problems say which signal nobody waits for and which nobody sends', () => {
  const found = logicProblems(ix()).filter((p) => p.code.startsWith('signal-')).map((p) => [p.code, p.node]);
  assert.deepEqual(found, [['signal-unheard', 'sig:Lights out'], ['signal-never-sent', 'sig:Nobody sends']]);
  const none = logicProblems(logicIndex(world([LINKS[0], LINKS[1]]))).filter((p) => p.code.startsWith('signal-'));
  assert.deepEqual(none, [], 'sent and heard: nothing to say');
});

test('signal hubs: the Read view puts the rules waiting for one under it, and a chain goes through it', () => {
  const view = readView(ix());
  const groups = view.sections.flatMap((s) => s.groups).map((g) => [g.title, g.lines.map((l) => l.rule)]);
  assert.deepEqual(groups.find(([t]) => t.includes('Alarm')), ['The signal "Alarm"', ['L2', 'L3']]);
  assert.deepEqual(groups.find(([, r]) => r.includes('L6')), ['When the map starts', ['L6']]);
  // Button1's chain: its rule, the hub, and what the hub sets off
  const chain = scopeOf(logicGraph(ix()), { kind: 'chain', root: 'obj:Button1' }).nodes.map((n) => n.id);
  for (const id of ['rule:L1', 'sig:Alarm', 'obj:Door3', 'rule:L3']) assert.ok(chain.includes(id), id);
  assert.ok(!chain.includes('sig:Lights out'));
});

test('signal hubs: no rule with a signal, no hub; a signal with no name stays where it was', () => {
  const g = logicGraph(logicIndex(world([{ id: 'L1', when: 'signal', signal: '', do: [{ verb: 'signal', a: ' ' }] }])));
  assert.deepEqual(g.nodes.filter((n) => n.kind === 'signal'), []);
  assert.ok(g.nodes.some((n) => n.id === 'world'));
});

test('a cause\'s own values (logic.json outputs\' args) are in its words, never an unknown badge', async () => {
  const { ruleBadges, RULE_FIELDS } = await import('../editor/static/logic-graph-model.js');
  const { catalog } = await import('./logic_graph_world.mjs');
  const args = Object.values(catalog.outputs).flatMap((o) => (o.args || []).map((a) => a.id));
  for (const id of args) assert.ok(Object.hasOwn(RULE_FIELDS, id), id);
  assert.deepEqual(ruleBadges(LINKS[1], ix()).map((b) => b.text), []);
});
