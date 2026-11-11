// P8 slice 5b: an output of a script that comes with a number. The script declares it with Args="Value" and says
// OutputValue("Found", 3) (project-template UCScript.uc); the rules it starts read the number as Value in their
// numbers and conditions (token $, UCEditorStory.CameWith), each run of a rule its own (UCRule.RCame). Here: the Ports
// table (script-ports.js), Try it (logic-sim.js) as the game works it out, the logic log, and the rules check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePorts, portLine, portWords, writePorts } from '../editor/static/script-ports.js';
import { createSession } from '../editor/static/logic-sim.js';
import { parseLogicLine, logicSentence, LOGIC_TAG } from '../editor/static/logic-log.js';
import { partsText } from '../editor/static/console-lines.js';
import { usesValue, gameNumber } from '../editor/static/logic-numbers.js';
import { conditionHolds } from '../editor/static/conditions.js';
import { logicIndex } from '../editor/static/logic-graph-model.js';
import { logicProblems } from '../editor/static/logic-graph-problems.js';
import { world, ACTORS } from './logic_graph_world.mjs';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));

test('the Ports table: an output with Args="Value" comes with a number, and is written back so', () => {
  const text = 'class Finder extends UCScript;\n\ndefaultproperties\n{\n'
    + '\tOutputs(0)=(Id="Found",Label="it finds coins",Args="Value")\n\tOutputs(1)=(Id="Done",Label="it is done")\n}\n';
  const p = parsePorts(text);
  assert.deepEqual(p.outputs, [{ id: 'Found', label: 'it finds coins', carries: true }, { id: 'Done', label: 'it is done' }]);
  assert.equal(portLine('outputs', 0, p.outputs[0]), 'Outputs(0)=(Id="Found",Label="it finds coins",Args="Value")');
  assert.equal(portLine('outputs', 1, p.outputs[1]), 'Outputs(1)=(Id="Done",Label="it is done")');
  assert.equal(portWords(p.outputs[0]), 'it finds coins (with a number)');
  assert.equal(writePorts(text, p), text, 'read and written again: the same text');
  delete p.outputs[0].carries;
  assert.match(writePorts(text, p), /Outputs\(0\)=\(Id="Found",Label="it finds coins"\)\n/);
});

test('Value in the numbers: the token $, never a counter', () => {
  assert.equal(gameNumber('Value'), '=$');
  assert.equal(gameNumber('Coins + value'), '=@Coins,$,+');
  assert.equal(usesValue('Coins + Value'), true);
  assert.equal(usesValue('=@Coins,$,+'), true);
  assert.equal(usesValue('Coins + 1'), false);
  assert.equal(usesValue('3'), false);
  assert.equal(usesValue('Coins +'), false, 'a bad formula uses nothing');
  const game = { counter: (n) => ({ Coins: 10 })[n] ?? 0, value: 5 };
  assert.equal(conditionHolds({ type: 'counter', counter: 'Coins', op: '>', value: 'Value' }, game), true);
  assert.equal(conditionHolds({ type: 'counter', counter: 'Coins', op: '>', value: 'Value * 2' }, game), false);
});

// a script (UCScript) with an output that comes with a number, and rules on it as links.py writes them
const q = (v) => `"${v}"`;
const finder = { name: 'Finder', chain: ['Finder', 'UCScript', 'Actor'], at: [0, 0, 0],
  ports: { inputs: [], outputs: [{ id: 'Found', label: 'it finds coins', carries: true }, { id: 'Done', label: 'it is done' }] } };
function onPort(id, port, acts, { cls = 'UCLink', cond = [], more = {} } = {}) {
  const props = { Tag: `UCLW_${id}`, When: 'output', Rule: q(id), Source: q('Finder'), Port: q(port), ...more };
  acts.forEach((a, i) => { props[`Act(${i})`] = q(a); });
  cond.forEach((c, i) => { props[`Cond(${i})`] = q(c); });
  return { cls, name: `UCLink_${id}`, props };
}
const open = (rules) => createSession({ actors: rules, outputs: logic.outputs, world: { player: 'JC', actors: [finder] }, map: 'M' });
const found = (s, value) => { s.fire({ thing: 'Finder', output: 'output', port: 'Found', ...(value === undefined ? {} : { value }) }); s.run(0.3); };

test('Try it: the rules on the output add Value; a condition compares with it; a plain one reads 0', () => {
  const s = open([onPort('A', 'Found', ['0|count||Coins|=$|']),
    onPort('B', 'Found', ['0|count||Big|1|'], { cond: ['count|Coins|<|=$,10,*'] })]);
  s.run(0.5);
  found(s, 3);
  found(s, 4);
  found(s);
  const st = s.state();
  assert.equal(st.counters.Coins, 7, '3 + 4 + 0');
  assert.equal(st.counters.Big, 2, 'Coins < Value * 10 at 3 and at 4, not with no number');
  const out = s.log().map(({ line }) => line).filter((l) => l.startsWith('output|'));
  assert.deepEqual(out, ['output|M|Finder|Found|2|3', 'output|M|Finder|Found|2|4', 'output|M|Finder|Found|2'],
    'the log has the number only when the output came with one (UCScript.Tell)');
});

test('Try it: each run of a rule keeps the Value it started with (UCRule RCame), after a delay too', () => {
  const s = open([onPort('R', 'Found', ['1|count||Later|=$|'], { cls: 'UCRule', more: { Again: 'each' } })]);
  s.run(0.5);
  s.fire({ thing: 'Finder', output: 'output', port: 'Found', value: 2 });
  s.run(0.1);
  s.fire({ thing: 'Finder', output: 'output', port: 'Found', value: 5 });
  s.run(2);
  assert.equal(s.state().counters.Later, 7);
});

test('Try it offers the output with a box for its number; the log says it', () => {
  const s = open([onPort('A', 'Found', ['0|count||Coins|=$|']), onPort('B', 'Done', ['0|count||Over|1|'])]);
  const hs = s.happenings();
  assert.equal(hs.find((h) => h.port === 'Found').carries, true);
  assert.equal(hs.find((h) => h.port === 'Done').carries, undefined);
  const said = (line) => partsText(logicSentence(parseLogicLine(LOGIC_TAG + line)).parts);
  assert.match(said('output|M|Finder|Found|1|3'), /Finder says Found with 3 \(1 rule\)/);
  assert.match(said('output|M|Finder|Done|2'), /Finder says Done \(2 rules\)/);
  assert.match(said('output|M|Finder|Found|1|0'), /with 0/);
});

test('the rules check: Value with no cause that comes with a number is a warning', () => {
  const carrying = { ...ACTORS, Gen0: { ...ACTORS.Gen0, carries: ['output:Sabotaged'] } };
  const rule = (over) => ({ id: 'L1', src: 'Gen0', when: 'output', port: 'Sabotaged', do: [{ verb: 'count', a: 'Coins', b: 'Value' }], ...over });
  const codes = (links, actors) => logicProblems(logicIndex(world(links, { actors }))).map((p) => p.code);
  assert.ok(!codes([rule()], carrying).includes('value-unset'), 'the output comes with a number');
  assert.ok(codes([rule()], ACTORS).includes('value-unset'), 'it does not');
  assert.ok(codes([rule({ src: 'Button1', when: 'used', port: undefined })], carrying).includes('value-unset'), 'a button says no number');
  assert.ok(!codes([rule({ do: [{ verb: 'count', a: 'Coins', b: 'Coins + 1' }] })], ACTORS).includes('value-unset'), 'no Value: nothing said');
  const cond = rule({ src: 'Button1', when: 'used', port: undefined, do: [{ verb: 'count', a: 'Coins', b: '1' }],
    requires: [{ type: 'counter', counter: 'Coins', op: '<', value: 'Value' }] });
  assert.ok(codes([cond], carrying).includes('value-unset'), 'in a condition too');
});
