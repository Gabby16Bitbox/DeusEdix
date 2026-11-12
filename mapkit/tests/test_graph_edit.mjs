// Editing from the graphs (12 Nov 2026): the quick add's filtering (editor/static/graph-quick-add.js) and the Story
// Graph's copy and paste of steps (story-graph.js copySteps / pasteSteps), each paste checked by playing the dialogue
// as the game would.
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterItems, remember, placeBox } from '../editor/static/graph-quick-add.js';
import { END, graphOf, copySteps, pasteSteps, connectStart, insertAt } from '../editor/static/story-graph.js';
import { createPlay } from '../editor/static/story-sim.js';

const ITEMS = [
  { id: 'line:npc', label: 'Line: Paul', group: 'Talk', words: ['say', 'talk'] },
  { id: 'line:jc', label: 'Line: JC Denton', group: 'Talk', words: ['say', 'talk'] },
  { id: 'choice', label: "JC's answers", group: 'Talk', words: ['options', 'reply'] },
  { id: 'if', label: 'Condition (flags)', group: 'Check', words: ['flag', 'branch'] },
  { id: 'give', label: 'Give JC an item', group: 'Change', words: ['weapon', 'inventory'] },
  { id: 'credits', label: 'Give or take credits', group: 'Change', words: ['money'] },
  { id: 'end', label: 'End of dialogue', group: 'End', words: ['stop'] },
];
const ids = (parts) => parts.map((p) => [p.group, p.items.map((it) => it.id)]);

test('unfiltered: the groups in order, the recent ones first, the lead groups before them', () => {
  assert.deepEqual(ids(filterItems(ITEMS, '', { groups: ['Talk', 'Check', 'Change', 'End'] })),
    [['Talk', ['line:npc', 'line:jc', 'choice']], ['Check', ['if']], ['Change', ['give', 'credits']], ['End', ['end']]]);
  const recent = filterItems(ITEMS, '', { groups: ['Talk', 'Check', 'Change', 'End'], recent: ['give', 'gone', 'if'] });
  assert.deepEqual(recent[0], { group: 'Recent', items: [ITEMS[4], ITEMS[3]] });
  const fits = [{ ...ITEMS[2], group: 'Fits here' }, ...ITEMS.filter((it) => it.id !== 'choice')];
  const lead = filterItems(fits, '', { groups: ['Talk'], recent: ['choice', 'end'], lead: ['Fits here'] });
  assert.deepEqual(ids(lead).slice(0, 2), [['Fits here', ['choice']], ['Recent', ['end']]]);
  assert.ok(!lead.some((p) => p.group === 'Recent' && p.items.some((it) => it.id === 'choice')), 'what fits is not twice');
});

test('typed: one list, best match first, by other words and with a typo', () => {
  assert.equal(filterItems(ITEMS, 'money')[0].items[0].id, 'credits');
  assert.equal(filterItems(ITEMS, 'weapn')[0].items[0].id, 'give');
  assert.equal(filterItems(ITEMS, 'line jc')[0].items[0].id, 'line:jc');
  assert.equal(filterItems(ITEMS, 'answers')[0].group, null);
  assert.deepEqual(filterItems(ITEMS, 'zzzzqqq'), []);
});

test('the recent list and where a box goes', () => {
  assert.deepEqual(remember(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.deepEqual(remember(['a', 'b', 'c', 'd', 'e'], 'f'), ['f', 'a', 'b', 'c', 'd']);
  assert.deepEqual(placeBox([10, 10], [100, 50], [600, 400]), [10, 10]);
  assert.deepEqual(placeBox([580, 390], [100, 50], [600, 400]), [496, 340]);      // moved in to fit, above the point
});

const line = (text, who = 'npc') => ({ type: 'line', who, text });
function play(steps, answers = []) {
  const run = createPlay(steps, {}, { random: () => 0 }), out = [];
  for (let guard = 0; guard < 200; guard++) {
    const e = run.next();
    if (e.type === 'line') out.push(e.text);
    else if (e.type === 'choice') { out.push('?' + e.options.filter((o) => o.shown).map((o) => o.text).join('|')); run.choose(answers.shift()); }
    else if (e.type === 'end') return out;
  }
  throw new Error('no end');
}
const idOf = (steps, text) => graphOf(steps).nodes.find((n) => n.step.text === text).id;
function deal() {
  return [line('You came alone?'), { type: 'choice', options: [{ text: 'Pay', goto: 'a1' }, { text: 'Threaten', goto: 'a2' }] },
    { type: 'label', name: 'a1' }, line('Pleasure.'), { type: 'end' },
    { type: 'label', name: 'a2' }, line('Fine, take it.'), { type: 'end' }];
}

test('copied steps keep their arrows among them, not the ones to steps left behind', () => {
  const steps = deal(), g = graphOf(steps);
  const ask = idOf(steps, 'You came alone?'), choice = g.nodes[1].id, pay = idOf(steps, 'Pleasure.');
  const clip = copySteps(steps, [ask, choice, pay]);
  assert.deepEqual(clip.steps.map((s) => s.type), ['line', 'choice', 'line']);
  assert.ok(clip.steps.every((s) => !s.id), 'no ids');
  assert.deepEqual(clip.steps[1].options.map((o) => o.goto), ['', ''], 'its answers go nowhere until pasted');
  assert.deepEqual(clip.wires, [[0, 'next', 1], [1, 0, 2]]);
  assert.equal(JSON.stringify(steps), JSON.stringify(deal().map((s, i) => ({ ...s, id: steps[i].id }))), 'the dialogue is not changed');
});

test('pasted steps: new ids, on their own, playing as the copy did', () => {
  const steps = deal(), g = graphOf(steps);
  const clip = copySteps(steps, [idOf(steps, 'You came alone?'), g.nodes[1].id, idOf(steps, 'Pleasure.')]);
  const was = play(steps, [0]);
  const made = pasteSteps(steps, clip);
  assert.equal(made.length, 3);
  assert.ok(made.every((id) => !g.nodes.some((n) => n.id === id)), 'new ids');
  assert.deepEqual(play(steps, [0]), was, 'the dialogue plays as before: nothing falls into the paste');
  connectStart(steps, made[0]);
  assert.deepEqual(play(steps, [0]), ['You came alone?', '?Pay|Threaten', 'Pleasure.']);
  const after = graphOf(steps).nodes.find((n) => n.id === made[1]);
  assert.equal(after.outs[1].to, null, 'the answer whose step was not copied goes nowhere');
});

test('paste into an empty dialogue starts it; a way to the End and an inventory-full way come back', () => {
  const src = [{ type: 'give', item: 'DeusEx.WeaponPistol', count: 1, fail: 'full' }, line('Here.'), { type: 'end' },
    { type: 'label', name: 'full' }, line('No room.'), { type: 'end' },
    { type: 'if', flag: 'Met', is: true, goto: 'yes' }, { type: 'end' }, { type: 'label', name: 'yes' }, { type: 'end' }];
  const g = graphOf(src);
  const give = g.nodes[0].id, here = idOf(src, 'Here.'), room = idOf(src, 'No room.'), cond = g.nodes.find((n) => n.step.type === 'if').id;
  const clip = copySteps(src, [give, here, room, cond]);
  assert.equal(clip.steps[0].fail, undefined);
  assert.deepEqual(clip.wires, [[0, 'next', 1], [0, 'jump', 2], [3, 'jump', END]]);
  const steps = [];
  const made = pasteSteps(steps, clip);
  assert.equal(graphOf(steps).start, made[0]);
  const n = graphOf(steps).nodes;
  assert.deepEqual(n.find((x) => x.id === made[0]).outs.map((o) => o.to), [made[1], made[2]]);
  const yes = n.find((x) => x.id === made[3]).outs[0].to;
  assert.ok(yes === END || n.find((x) => x.id === yes)?.step.type === 'end', 'its Yes ends the dialogue');
});

test("JC's answers put in a way: the first answer goes on where the way went", () => {
  const steps = [line('Hello.'), { type: 'signal', signal: 'S' }, line('Bye.')];
  const hello = idOf(steps, 'Hello.');
  insertAt(steps, hello, 'next', { type: 'choice', options: [{ text: 'Hi', goto: '' }, { text: 'No', goto: '' }] });
  assert.deepEqual(play(steps, [0]), ['Hello.', '?Hi|No', 'Bye.']);
  const g = graphOf(steps);
  assert.ok(g.nodes.every((n) => g.reachable.has(n.id)), 'every step still reached, no End left over');
  // on a condition's Yes, too
  const two = [{ type: 'if', flag: 'F', is: true, goto: 'y' }, line('No way.'), { type: 'end' }, { type: 'label', name: 'y' }, line('Yes!')];
  const cond = graphOf(two).nodes[0].id;
  insertAt(two, cond, 'jump', { type: 'choice', options: [{ text: 'Go', goto: '' }] });
  assert.deepEqual(play(two.map((s) => s.type === 'if' ? { ...s, flag: '' } : s), [0]).slice(-2), ['?Go', 'Yes!']);
});
