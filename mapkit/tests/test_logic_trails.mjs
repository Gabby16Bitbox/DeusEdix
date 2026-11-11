// Trails (P2, editor/static/logic-trails.js): the game's logic lines kept as a session, and what they mark on the Logic
// window's graph (a rule's count, the condition that did not hold, a step that ran or failed, a block's value) and
// which wires they light, as the window draws them (logic-window.js canvasOf).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrails, trailMarks, markTrails, crossed, lightOf, lineWords, trailText, UNTIMED_STEP } from '../editor/static/logic-trails.js';
import { logicIndex, logicGraph } from '../editor/static/logic-graph-model.js';
import { world } from './logic_graph_world.mjs';

async function load() {
  const inert = () => new Proxy(function () {}, { get: (t, key) => (key === 'then' ? undefined : key === Symbol.toPrimitive ? () => '' : inert()),
    apply: () => inert(), construct: () => inert(), set: () => true });
  const had = Object.hasOwn(globalThis, 'document');
  if (!had) globalThis.document = inert();
  try { return await import('../editor/static/logic-window.js'); } finally { if (!had) delete globalThis.document; }
}
const { canvasOf } = await load();
const TAG = 'DeusEdixLogic: ';

const RULES = [
  { id: 'L1', src: 'Comp1', when: 'option', option: 2, requires: [{ flag: 'Power', is: true }],
    do: [{ id: 'a1', verb: 'open', target: 'Door3' }, { id: 'a2', verb: 'message', a: 'Hi' }] },
  { id: 'L2', src: 'Button1', when: 'used', do: [{ id: 'a1', verb: 'open', target: 'Door3' }] },          // simple: a wire
];
const setup = () => {
  const ix = logicIndex(world(RULES)), graph = logicGraph(ix);
  return { ix, graph, shown: canvasOf(graph) };
};

test('the store keeps only logic lines, timed from Play\'s start, and lines read back go a quarter second apart', () => {
  const t = createTrails(), seen = [];
  t.subscribe((w) => seen.push(w));
  t.add([TAG + 'fire|M|L2|Button1|used|JCDentonMale0|', 'Log: something else'], { at: 11000, started: 10000 });
  t.add([TAG + 'act|M|L2|open|Door3|'], { at: 12500 });
  t.add([TAG + 'fire|Other|L2|Button1|used||']);                   // read back: no time of its own
  assert.deepEqual(t.lines().map((l) => [l.t, l.timed, l.live]), [[1, true, true], [2.5, true, true], [2.5 + UNTIMED_STEP, false, false]]);
  assert.equal(t.lines('m').length, 2, 'a map by its name, any case');
  assert.equal(t.lines('M.dx').length, 2);
  assert.equal(seen.length, 3);
  t.restart();
  assert.equal(t.size, 0);
  assert.deepEqual(seen.at(-1), { reset: true });
  t.add(['fire|M|L2@4.50|Button1|used||']);                        // a v2 line has the game's time
  assert.equal(t.lines()[0].t, 4.5);
  assert.equal(t.lines()[0].timed, true);
});

test('the marks: counts, the condition that did not hold, a step done and one failed, a block, up to a time', () => {
  const { ix } = setup(), t = createTrails();
  t.add([TAG + 'skip|M|L1|cond|flag|Power|1'], { at: 1000, started: 0 });
  t.add([TAG + 'value|M|UCEdit0|2/3'], { at: 2000 });
  t.add([TAG + 'fire|M|L1|Comp1|option|JCDentonMale0|', TAG + 'act|M|L1|open|Door3|', TAG + 'fail|M|L1|message||cannot'], { at: 3000 });
  t.add([TAG + 'fire|M|L2|Button1|used||', TAG + 'act|M|L2|open|Door3|'], { at: 4000 });
  const m = trailMarks(t.lines('M'), ix);
  assert.deepEqual({ ...m.rules.get('L1'), skips: { ...m.rules.get('L1').skips } },
    { fired: 1, otherwise: 0, skipped: 1, failed: 1, last: 3, skip: 'cond', skips: { cond: 1 }, hook: '' });
  assert.deepEqual(m.conds.get('rule:L1|if:0'), { n: 1, last: 1 });
  assert.equal(m.steps.get('act:L1/a1').done, 1);
  assert.equal(m.steps.get('act:L1/a2').failed, 1);
  assert.match(m.steps.get('act:L1/a2').why, /cannot do that/);
  assert.deepEqual(m.blocks.get('ucedit0'), { text: '2/3', t: 2 });
  assert.equal(trailText(m.rules.get('L1')), 'ran 1× · 3 s · 1 failed');
  const early = trailMarks(t.lines('M'), ix, 1.5);
  assert.equal(early.rules.get('L1').fired, 0, 'scrubbed back: only what came before');
  assert.equal(trailText(early.rules.get('L1')), 'did not run ×1');
  assert.equal(early.rules.has('L2'), false);
});

test('the watched states (P5): what each holds last, how often it changed, up to a time', () => {
  const { ix } = setup(), t = createTrails();
  t.add([TAG + 'state|M|Met||false', TAG + 'state|M|Keys||0'], { at: 1000, started: 0 });
  t.add([TAG + 'state|M|Keys|0|1'], { at: 2000 });
  t.add([TAG + 'state|M|Met|false|true', TAG + 'state|M|Keys|1|2'], { at: 3000 });
  const m = trailMarks(t.lines('M'), ix);
  assert.deepEqual(m.states.get('met'), { name: 'Met', value: 'true', old: 'false', t: 3, live: true, changes: 1 });
  assert.deepEqual(m.states.get('keys'), { name: 'Keys', value: '2', old: '1', t: 3, live: true, changes: 2 });
  const early = trailMarks(t.lines('M'), ix, 2);
  assert.equal(early.states.get('met').value, 'false');
  assert.equal(early.states.get('met').changes, 0, 'where it starts is no change');
  assert.equal(early.states.get('keys').value, '1');
  assert.equal(trailMarks(t.lines('M'), { rules: [] }).states.size, 2, 'no rules needed for the states');
});

test('the graph marked: the card\'s header, chips on its rows, the simple rule\'s wire label; the data drawn is not touched', () => {
  const { ix, graph, shown } = setup(), t = createTrails();
  t.add([TAG + 'skip|M|L1|cond|flag|Power|1', TAG + 'fire|M|L1|Comp1|option||', TAG + 'act|M|L1|open|Door3|',
    TAG + 'fire|M|L2|Button1|used||', TAG + 'fire|M|L2|Button1|used||'], { at: 2000, started: 0 });
  const before = JSON.stringify(shown), marked = structuredClone(shown);
  assert.equal(markTrails(marked, trailMarks(t.lines('M'), ix), graph), true);
  assert.equal(JSON.stringify(shown), before);
  const card = marked.nodes.find((n) => n.id === 'rule:L1');
  assert.equal(card.live, 'ran 1× · 2 s');
  assert.deepEqual(card.rows.find((r) => r.id === 'if:0').chips.map((c) => [c.text, c.tone]), [['no ×1', 'bad']]);
  assert.deepEqual(card.rows.find((r) => r.id === 'act:L1/a1').chips.map((c) => [c.text, c.tone]), [['×1', 'ok']]);
  assert.equal(card.rows.find((r) => r.id === 'act:L1/a2').chips, undefined, 'a step not done has no chip');
  const wire = marked.wires.find((w) => w.id === 'rule:L2');
  assert.match(wire.label, / · ran 2×$/);
  assert.match(wire.title, /Ran 2 times, the last at 2 s/);
  assert.equal(markTrails(structuredClone(shown), trailMarks([], ix), graph), false);
});

test('what lines light: the cause\'s wire and the card for a run, the step\'s wire for an action, a simple rule\'s own wire', () => {
  const { ix, shown } = setup(), t = createTrails();
  t.add([TAG + 'fire|M|L1|Comp1|option||', TAG + 'act|M|L1|open|Door3|', TAG + 'fire|M|L2|Button1|used||'], { at: 1000, started: 0 });
  t.add([TAG + 'act|M|L1@3.00#a2|message||'], { at: 3000 });
  const lines = t.lines('M'), l = lightOf(lines, ix);
  const wires = new Set(shown.wires.map((w) => w.id));
  assert.deepEqual(l.wires, ['rule:L1/cause0', 'act:L1/a1', 'rule:L2']);
  assert.ok(l.wires.filter((w) => w !== 'act:L1/a1').every((w) => wires.has(w)), 'ids the canvas has');
  assert.deepEqual(l.nodes, ['rule:L1']);
  assert.deepEqual(l.rules, ['L1', 'L2']);
  assert.deepEqual(crossed(lines, 1, 3).map((x) => x.entry.kind), ['act']);
  assert.deepEqual(crossed(lines, 3, 1), []);
  assert.equal(lineWords(lines[0], (n) => ({ Comp1: 'Computer 1' })[n] || n), '▶ L1 Comp1 option');
  assert.equal(lineWords({ entry: { kind: 'act', rule: 'L1', verb: 'open', target: 'Door3' } }, (n) => (n === 'Door3' ? 'Door 3' : n)), '→ open Door 3');
});
