// The Story Graph's nodes and wires on the node canvas (static/story-graph-nodes.js): a line with who speaks (title,
// colour, face) and its text in the node, JC's answers and a condition's ways as coloured rows with a pin each, the
// Start and End, a jump to another conversation, a way that ends the dialogue or jumps to a missing label, steps
// nothing reaches, the places moved by hand kept and the others left to the canvas; the pin ids and back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { graphOf, END } from '../editor/static/story-graph.js';
import { canvasOf, START, WAYS, YES_NO, LINE_W, kindOf, pinOf, portOf, rowPort, problemOf, hasRows } from '../editor/static/story-graph-nodes.js';

const speaker = (s) => (s.who === 'jc' ? { name: 'JC Denton', colour: '#5aa2ff' } : { name: 'Mr Talker', colour: '#afa9ec' });
const summary = { title: (s) => ({ if: 'Check a condition', flag: 'Change state', checkitem: 'Check inventory' }[s.type] || s.type), text: (s) => (s.type === 'flag' ? 'Met = Yes' : s.type === 'if' ? 'Only if Met is Yes' : '') };
const nodesOf = (steps, at = {}) => {
  const g = canvasOf(graphOf(steps), { at, speaker, summary });
  return { ...g, node: (id) => g.nodes.find((n) => n.id === id), wire: (id) => g.wires.find((w) => w.id === id) };
};

test('a line: who says it (title, colour, face) and its text in the node, one way on', () => {
  const g = nodesOf([{ type: 'line', who: 'npc', text: 'Hello there.', voice: 'x.ogg' }, { type: 'line', who: 'jc', text: '' }]);
  const a = g.node('n1'), b = g.node('n2');
  assert.equal(a.kind, 'line');
  assert.equal(a.title, 'Mr Talker');
  assert.equal(a.colour, '#afa9ec');
  assert.equal(a.thumb, 'npc');                        // the canvas asks the face once per speaker
  assert.equal(a.w, LINE_W);
  assert.deepEqual(a.body, { text: 'Hello there.', empty: false, lines: 3 });
  assert.deepEqual(a.badges[0], { text: 'voice', title: 'Has a recorded voice' });
  assert.deepEqual(a.in, { id: 'in', title: 'Where the arrows into this step arrive' });
  assert.equal(a.out.id, 'next');
  assert.equal(a.rows, undefined);
  // an empty line: a placeholder, marked, and flagged as a problem; the last step goes on to the end
  assert.equal(b.thumb, 'jc');
  assert.deepEqual(b.body, { text: 'Double-click to write the line', empty: true, lines: 3 });
  assert.equal(b.tone, 'warn');
  assert.deepEqual(b.badges.map((x) => x.text), ['empty', 'end']);
  assert.deepEqual(g.wire('n1>next'), { id: 'n1>next', from: { node: 'n1', pin: 'next' }, to: { node: 'n2', pin: 'in' } });
  assert.equal(g.wires.some((w) => w.from.node === 'n2'), false);       // to END: no wire, the badge says it
});

test('the Start: its pin goes to the first step; free when the dialogue says nothing', () => {
  const g = nodesOf([{ type: 'line', text: 'Hi' }]);
  assert.deepEqual(g.nodes[0], { id: START, kind: 'start', title: 'Start', w: 100, at: undefined, label: 'Start of the dialogue',
    out: { id: 'start', title: 'Where the dialogue starts', free: false } });
  assert.deepEqual(g.wire(`${START}>start`).to, { node: 'n1', pin: 'in' });
  const empty = nodesOf([]);
  assert.equal(empty.nodes.length, 1);
  assert.equal(empty.nodes[0].out.free, true);
  assert.equal(empty.wires.length, 0);
});

test("JC's answers: a row each with its colour and pin; one that goes nowhere is free and a problem", () => {
  const steps = [
    { type: 'choice', options: [{ text: 'Yes', goto: 'a' }, { text: 'No', goto: '' }, { text: '', goto: 'gone' }] },
    { type: 'end' }, { type: 'label', name: 'a' }, { type: 'line', text: 'Good.' },
  ];
  const g = nodesOf(steps), c = g.node('n1');
  assert.equal(c.kind, 'choice');
  assert.equal(c.title, "JC's answers");
  assert.equal(c.out, undefined);
  assert.equal(c.body, undefined);
  assert.deepEqual(c.rows.map((r) => [r.id, r.text, r.colour, r.out.id, r.out.free]), [
    ['way:0', 'Yes', WAYS[0], '0', false], ['way:1', 'No', WAYS[1], '1', true], ['way:2', 'Answer 3', WAYS[2], '2', true]]);
  // a missing label: broken, said on the row
  assert.deepEqual(c.rows[2].chips, [{ text: 'broken', tone: 'bad', title: 'It jumps to a label the dialogue does not have' }]);
  assert.equal(c.tone, 'warn');
  assert.deepEqual(c.badges.map((b) => b.text), ['empty answer']);
  assert.deepEqual(g.wire('n1>0'), { id: 'n1>0', from: { node: 'n1', pin: '0' }, to: { node: 'n4', pin: 'in' }, colour: WAYS[0] });
  assert.equal(g.wires.filter((w) => w.from.node === 'n1').length, 1);
});

test("a condition: Yes and No rows in green and red, its summary as text; a way that ends says 'end'", () => {
  const g = nodesOf([{ type: 'if', flag: 'Met', is: true, goto: '' }, { type: 'flag', flag: 'Met', is: true }]);
  const c = g.node('n1');
  assert.equal(c.kind, 'cond');
  assert.equal(c.title, 'Check a condition');
  assert.deepEqual(c.body, { text: 'Only if Met is Yes', lines: 2 });
  assert.deepEqual(c.rows.map((r) => [r.text, r.colour, r.out.id]), [['Yes', YES_NO[0], 'jump'], ['No', YES_NO[1], 'next']]);
  assert.equal(g.wire('n1>next').colour, YES_NO[1]);
  // a step with one way: its pin on the header, its text the summary; to the end of the list: 'end'
  const f = g.node('n2');
  assert.equal(f.kind, 'act');
  assert.equal(f.out.id, 'next');
  assert.deepEqual(f.badges, [{ text: 'end', title: 'The dialogue ends after this step' }]);
  // a row's way that ends the dialogue
  const e = nodesOf([{ type: 'if', flag: 'X', goto: 'z' }, { type: 'line', text: 'a' }, { type: 'end' }, { type: 'label', name: 'z' }]);
  assert.deepEqual(e.node('n1').rows[0].chips, [{ text: 'end', title: 'The dialogue ends here' }]);
});

test('End, a jump to another conversation, a step nothing reaches, places kept', () => {
  const steps = [{ type: 'line', text: 'a' }, { type: 'goto', conversation: 'OtherCon' }, { type: 'end' }, { type: 'line', text: 'lost' }];
  const g = nodesOf(steps, { n1: [10, 20], [START]: [-200, 0] });
  assert.deepEqual([g.node('n2').kind, g.node('n2').title, g.node('n2').w, g.node('n2').out], ['end', 'Continues in OtherCon', 200, undefined]);
  assert.deepEqual([g.node('n3').title, g.node('n3').w, g.node('n3').dim], ['End', 100, true]);
  const lost = g.node('n4');
  assert.equal(lost.dim, true);
  assert.deepEqual(lost.badges[0], { text: 'not reached', title: 'Nothing leads to this step' });
  assert.deepEqual(g.node('n1').at, [10, 20]);
  assert.deepEqual(g.nodes[0].at, [-200, 0]);
  assert.equal(g.node('n4').at, undefined);              // laid out by the canvas
});

test('the small parts: kinds, pins and ports, rows, problems', () => {
  assert.deepEqual(['line', 'choice', 'if', 'random', 'checkvalue', 'end', 'goto', 'flag', 'give'].map((t) => kindOf({ type: t })),
    ['line', 'choice', 'cond', 'cond', 'cond', 'end', 'end', 'act', 'act']);
  assert.equal(pinOf(2), '2');
  assert.equal(portOf('2'), 2);
  assert.equal(portOf('next'), 'next');
  assert.equal(rowPort('way:1'), 1);
  assert.equal(rowPort('way:jump'), 'jump');
  assert.equal(rowPort('other'), null);
  assert.equal(rowPort(undefined), null);
  const one = { step: { type: 'flag' }, outs: [{ port: 'next', to: END }] };
  assert.equal(hasRows(one), false);
  assert.equal(problemOf(one), '');
  assert.equal(hasRows({ step: { type: 'choice' }, outs: [] }), true);
  assert.equal(problemOf({ step: { type: 'choice', options: [{ text: 'a' }] }, outs: [{ port: 0, to: null }] }), 'answer goes nowhere');
});
