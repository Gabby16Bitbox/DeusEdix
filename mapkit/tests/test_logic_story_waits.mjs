// P5 slice 3: the step "Wait until" of a list of steps waits for the map's Story too: {"verb": "wait", "until":
// {"type": "ended", "dialogue": "d1"}} (the dialogue has ended) and {"type": "heard", "infolink": "i1"} (the InfoLink
// has been heard), since the wait began. The words (action-list.js flowText, logic-vocab.js), the section of the
// graph (logic-graph-model.js), the map check (logic-graph-problems.js), the log (logic-log.js) and Try it
// (logic-sim.js: the story remembers each end, UCEditorStory.Seen). The game's side: test_logic_story_waits.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { logicIndex, logicGraph } from '../editor/static/logic-graph-model.js';
import { logicProblems } from '../editor/static/logic-graph-problems.js';
import { createSession } from '../editor/static/logic-sim.js';
import { vocabulary } from '../editor/static/logic-vocab.js';
import { flowText } from '../editor/static/action-list.js';
import { logicSentence } from '../editor/static/logic-log.js';
import { world } from './logic_graph_world.mjs';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const story = { dialogues: [{ id: 'd1', title: 'Gate talk', owner: 'Guard1', steps: [] }], infolinks: [{ id: 'i1', title: 'Jock calls' }] };
const titles = { d1: 'Gate talk', i1: 'Jock calls' };
const storyTitle = (key, id) => titles[id] || `${id} (missing)`;
const codes = (ps, rule) => ps.filter((p) => p.rule === rule).map((p) => p.code);
const waitFor = (type, id, max = 0) => ({ verb: 'wait', until: { type, [type === 'ended' ? 'dialogue' : 'infolink']: id }, max });

test('the step in words: the dialogue or InfoLink by its title, none chosen a "?"', () => {
  assert.equal(flowText(waitFor('ended', 'd1', 20), { storyTitle }), 'wait until the dialogue "Gate talk" has ended (at most 20 s)');
  assert.equal(flowText(waitFor('heard', 'i1'), { storyTitle }), 'wait until the InfoLink "Jock calls" has been heard');
  assert.equal(flowText(waitFor('heard', '')), 'wait until the InfoLink ? has been heard');
  assert.equal(flowText(waitFor('ended', 'd1')), 'wait until the dialogue "d1" has ended', 'no titles: the id');
  const v = vocabulary(logic), ctx = { name: (n) => n, storyTitle };
  assert.equal(v.actText(waitFor('ended', 'd9'), ctx), 'wait until the dialogue "d9 (missing)" has ended');
  // the whole rule (the Logic window's Read view): the title there too
  const rule = { id: 'L1', src: 'Button1', when: 'used', steps: true, do: [waitFor('heard', 'i1'), { verb: 'message', a: 'x' }] };
  assert.match(v.sentence(rule, ctx), /wait until the InfoLink "Jock calls" has been heard/);
});

test('the graph: the wait starts a section said with the title', () => {
  const links = [{ id: 'L1', src: 'Button1', when: 'used', steps: true,
    do: [{ verb: 'talk', a: 'd1' }, waitFor('ended', 'd1', 30), { verb: 'message', a: 'Bye' }, waitFor('heard', 'i1'), { verb: 'message', a: 'Over' }] }];
  const g = logicGraph(logicIndex(world(links, { story })));
  const text = JSON.stringify(g);
  assert.match(text, /After the dialogue \\"Gate talk\\" has ended \(at most 30 s\):/);
  assert.match(text, /After the InfoLink \\"Jock calls\\" has been heard:/);
});

test('the map check: a wait for no dialogue, or one not in the Story, is a warning (only once the Story is read)', () => {
  const links = [{ id: 'L1', src: 'Button1', when: 'used', steps: true, do: [waitFor('ended', ''), { verb: 'message', a: 'x' }] },
    { id: 'L2', src: 'Button1', when: 'used', steps: true, do: [waitFor('heard', 'i9', 10), { verb: 'message', a: 'x' }] },
    { id: 'L3', src: 'Button1', when: 'used', steps: true, do: [waitFor('ended', 'd1'), waitFor('heard', 'i1'), { verb: 'message', a: 'x' }] }];
  const read = logicProblems(logicIndex(world(links, { story })));
  assert.deepEqual(codes(read, 'L1'), ['story-none']);
  assert.deepEqual(codes(read, 'L2'), ['story-missing']);
  assert.deepEqual(codes(read, 'L3'), []);
  assert.match(JSON.stringify(read.find((p) => p.rule === 'L1')), /the game does not wait there/);
  assert.match(JSON.stringify(read.find((p) => p.rule === 'L2')), /the rest waits 10 s/);
  assert.ok(read.filter((p) => p.rule === 'L1' || p.rule === 'L2').every((p) => p.level === 'warn'));
  assert.deepEqual(codes(logicProblems(logicIndex(world(links))), 'L2'), [], 'the Story not read: no "missing"');
});

test('the log: the wait over said with the title, not as a character', () => {
  const parts = logicSentence({ kind: 'until', rule: 'L1', result: 'done', who: 'UCD_d1' }, { storyTitle }).parts;
  assert.deepEqual(parts.slice(-1), ['the dialogue "Gate talk" has ended: on']);
  const heard = logicSentence({ kind: 'until', rule: 'L1', result: 'done', who: 'UCI_i1' }, {}).parts;
  assert.deepEqual(heard.slice(-1), ['the InfoLink "i1" has been heard: on']);
  const arrived = logicSentence({ kind: 'until', rule: 'L1', result: 'done', who: 'Guard1' }, {}).parts;
  assert.deepEqual(arrived.slice(-2), [{ name: 'Guard1' }, ' has arrived: on']);
});

const W = { player: 'JCDentonMale0', actors: [{ name: 'Button1', chain: ['Button1', 'DeusExDecoration', 'Decoration', 'Actor'], at: [0, 0, 0] }] };
function rule(acts, more = []) {
  const props = { Tag: 'UCL_Button1', When: 'used', Rule: '"L1"', Source: '"Button1"', bSteps: 'True' };
  acts.forEach((a, i) => { props[`Act(${i})`] = `"${a}"`; });
  return createSession({ actors: [{ cls: 'UCLink', name: 'UCLink_L1', props }, ...more], outputs: logic.outputs, world: W, map: 'M' });
}
const lines = (s) => s.log().map(({ t, line }) => `${t} ${line.split('|').filter((f, i) => i !== 1).join('|')}`).filter((l) => !/ fire\|/.test(l));

test('Try it: the dialogue it starts ends at once, so the wait is over; the list goes on', () => {
  const s = rule(['0|talk||d1||', '0|until|UCD_d1|ended|0|', '0|message||Bye||']);
  s.fire({ thing: 'Button1', output: 'used' });
  s.run(1);
  const l = lines(s);
  assert.ok(l.some((x) => / until\|L1\|done\|1\|UCD_d1$/.test(x)), l.join('\n'));
  assert.ok(l.some((x) => / act\|L1\|message\|\|Bye$/.test(x)));
});

test('Try it: an end before the wait does not count; one after it does, offered as a button, also the InfoLink\'s', () => {
  const s = rule(['0|until|UCI_i1|heard|0|', '0|message||Over||']);
  s.fire({ thing: 'UCI_i1', output: 'heard' });       // heard before the rule started waiting
  s.step(1);
  s.fire({ thing: 'Button1', output: 'used' });
  s.run(2);
  assert.ok(!lines(s).some((x) => / until\|/.test(x)), 'still waiting');
  const h = s.happenings().find((x) => x.output === 'heard');
  assert.deepEqual([h.thing, h.infolink, h.rules], ['UCI_i1', 'i1', ['L1']]);
  s.fire({ thing: h.thing, output: 'heard' });
  s.run(1);
  const l = lines(s);
  assert.ok(l.some((x) => / until\|L1\|done\|0\|UCI_i1$/.test(x)), l.join('\n'));
  assert.ok(l.some((x) => / act\|L1\|message\|\|Over$/.test(x)));
});

test('Try it: with an at most and no end, the wait runs out', () => {
  const s = rule(['0|until|UCD_d1|ended|1|', '0|message||Later||']);
  s.fire({ thing: 'Button1', output: 'used' });
  s.run(2);
  const l = lines(s);
  assert.ok(l.some((x) => / until\|L1\|timeout\|0\|UCD_d1$/.test(x)), l.join('\n'));
  assert.ok(l.some((x) => / act\|L1\|message\|\|Later$/.test(x)));
});
