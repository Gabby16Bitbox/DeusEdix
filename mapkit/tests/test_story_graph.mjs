// The Story's Graph view and Play-test (editor/static/story-graph.js, story-sim.js): the graph read from a dialogue's
// steps, every edit made on the steps, and each checked by playing the dialogue as the game would.
import test from 'node:test';
import assert from 'node:assert/strict';
import { END, graphOf, connect, connectStart, insertAt, remove } from '../editor/static/story-graph.js';
import { createPlay } from '../editor/static/story-sim.js';

const line = (text, who = 'npc') => ({ type: 'line', who, text });
// what the player sees, answering with `answers` (indices) in turn
function play(steps, answers = [], state = {}) {
  const run = createPlay(steps, state, { random: () => 0 }), out = [];
  for (let guard = 0; guard < 200; guard++) {
    const e = run.next();
    if (e.type === 'line') out.push(e.text);
    else if (e.type === 'choice') { out.push('?' + e.options.filter((o) => o.shown).map((o) => o.text).join('|')); run.choose(answers.shift()); }
    else if (e.type === 'end') { out.push('END' + (e.why === 'End of dialogue' ? '' : ': ' + e.why)); return out; }
  }
  throw new Error('no end');
}
const node = (steps, text) => graphOf(steps).nodes.find((n) => n.step.text === text).id;
function deal() {                 // a dialogue as the List view makes it: a choice, each answer on a label of its own
  return [line('You came alone?'), { type: 'choice', options: [{ text: 'Pay', goto: 'a1' }, { text: 'Threaten', goto: 'a2' }] },
    { type: 'label', name: 'a1' }, line('Pleasure.'), { type: 'end' },
    { type: 'label', name: 'a2' }, line('Fine, take it.'), { type: 'end' }];
}

test('labels and jumps are the arrows, not nodes', () => {
  const steps = deal(), g = graphOf(steps);
  assert.deepEqual(g.nodes.map((n) => n.step.type), ['line', 'choice', 'line', 'end', 'line', 'end']);
  const choice = g.nodes[1];
  assert.deepEqual(choice.outs.map((o) => [o.text, o.to]), [['Pay', node(steps, 'Pleasure.')], ['Threaten', node(steps, 'Fine, take it.')]]);
  assert.equal(g.start, g.nodes[0].id);
  assert.equal(g.reachable.size, 6);
  assert.deepEqual(play(steps, [1]), ['You came alone?', '?Pay|Threaten', 'Fine, take it.', 'END']);
});

test('a missing label is a broken arrow, a step after an end nobody reaches is shown apart', () => {
  const steps = [line('A'), { type: 'goto', label: 'nowhere' }, line('B')];
  const g = graphOf(steps);
  assert.equal(g.nodes[0].outs[0].to, null);
  assert.equal(g.reachable.has(node(steps, 'B')), false);
  assert.deepEqual(play(steps), ['A', 'END: The label "nowhere" is missing']);
});

test('a step inserted after another plays between them', () => {
  const steps = deal();
  insertAt(steps, node(steps, 'You came alone?'), 'next', line('Close the door.'));
  assert.deepEqual(play(steps, [0]), ['You came alone?', 'Close the door.', '?Pay|Threaten', 'Pleasure.', 'END']);
});

test('a step inserted on an answer plays before where the answer went', () => {
  const steps = deal(), choice = graphOf(steps).nodes[1].id;
  insertAt(steps, choice, 1, line('You would not dare.'));
  assert.deepEqual(play(steps, [1]), ['You came alone?', '?Pay|Threaten', 'You would not dare.', 'Fine, take it.', 'END']);
  assert.deepEqual(play(steps, [0]), ['You came alone?', '?Pay|Threaten', 'Pleasure.', 'END']);   // the other answer as it was
});

test('a step on an answer that went nowhere ends after it, and nothing falls into it', () => {
  const steps = [line('Hi'), { type: 'choice', options: [{ text: 'Bye', goto: '' }] }];
  insertAt(steps, graphOf(steps).nodes[1].id, 0, line('See you.'));
  assert.deepEqual(play(steps, [0]), ['Hi', '?Bye', 'See you.', 'END']);
  const tail = [line('Last words')];                       // the list ran off its end: the new place is closed off
  const ask = { type: 'choice', options: [{ text: 'Go on', goto: '' }] };
  tail.unshift(ask);
  insertAt(tail, graphOf(tail).nodes[0].id, 0, line('Going on.'));
  assert.deepEqual(play(tail, [0]), ['?Go on', 'Going on.', 'END']);
});

test('connecting changes only that arrow', () => {
  const steps = deal(), first = node(steps, 'You came alone?');
  connect(steps, first, 'next', node(steps, 'Fine, take it.'));
  assert.deepEqual(play(steps), ['You came alone?', 'Fine, take it.', 'END']);
  connect(steps, first, 'next', END);
  assert.deepEqual(play(steps), ['You came alone?', 'END']);
  const again = deal(), choice = graphOf(again).nodes[1].id;
  connect(again, choice, 0, node(again, 'Fine, take it.'));
  assert.deepEqual(play(again, [0]), ['You came alone?', '?Pay|Threaten', 'Fine, take it.', 'END']);
  connect(again, choice, 0, END);
  assert.deepEqual(play(again, [0]), ['You came alone?', '?Pay|Threaten', 'END']);
  connect(again, choice, 1, null);
  assert.deepEqual(play(again, [1]), ['You came alone?', '?Pay|Threaten', 'END: This answer goes nowhere']);
});

test('the dialogue can start somewhere else', () => {
  const steps = deal();
  connectStart(steps, node(steps, 'Fine, take it.'));
  assert.deepEqual(play(steps), ['Fine, take it.', 'END']);
  connectStart(steps, node(steps, 'You came alone?'));
  assert.deepEqual(play(steps, [0]), ['You came alone?', '?Pay|Threaten', 'Pleasure.', 'END']);
});

test('a step taken away: what came into it goes on to where it went', () => {
  const steps = deal();
  remove(steps, graphOf(steps).nodes[1].id);
  assert.deepEqual(play(steps), ['You came alone?', 'Pleasure.', 'END']);
});

test('conditions, values and loops play as in the game', () => {
  const steps = [{ type: 'if', flag: 'Paid', is: true, goto: 'paid' }, line('Pay first.'), { type: 'end' },
    { type: 'label', name: 'paid' }, { type: 'checkvalue', valueType: 'EP_Credits', condition: 'EC_GreaterEqual', amount: 100, goto: 'rich' },
    line('Poor.'), { type: 'end' }, { type: 'label', name: 'rich' },
    { type: 'choice', options: [{ text: 'Buy', goto: 'buy' }, { text: 'Secret', goto: 'buy', flag: 'Friend', is: true }] },
    { type: 'label', name: 'buy' }, { type: 'flag', flag: 'Bought', is: true }, { type: 'credits', amount: -100 }, line('Sold.'), { type: 'end' }];
  assert.deepEqual(play(steps), ['Pay first.', 'END']);
  assert.deepEqual(play(steps, [], { flags: { Paid: true } }), ['Poor.', 'END']);
  assert.deepEqual(play(steps, [0], { flags: { Paid: true }, credits: 150 }), ['?Buy', 'Sold.', 'END']);
  const run = createPlay(steps, { flags: { Paid: true, Friend: true }, credits: 150 });
  while (run.next().type !== 'choice');
  run.choose(1);
  while (run.next().type !== 'end');
  assert.equal(run.state.flags.Bought, true);
  assert.equal(run.state.credits, 50);
  assert.deepEqual(play([{ type: 'label', name: 'l' }, line('Again'), { type: 'goto', label: 'l' }]).slice(-1), ['END: It goes round in a loop']);
});
