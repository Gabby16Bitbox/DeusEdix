// P5 slice 4: the Story sends signals. A dialogue's step and a Story action {"type": "signal", "signal": "Alarm"}
// reach the map's rules "When the signal ... is sent". The names offered (logic-rule-ui.js signalsOf), the graph (the
// dialogue's or the event's wire into the signal's hub, logic-graph-model.js), the check (a signal the Story sends is
// sent: logic-graph-problems.js) and the Story's own simulator (story-sim.js). The build: test_logic_story_signals.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicIndex, logicGraph, storyId, pieceId } from '../editor/static/logic-graph-model.js';
import { logicProblems } from '../editor/static/logic-graph-problems.js';
import { signalsOf } from '../editor/static/logic-rule-ui.js';
import { world } from './logic_graph_world.mjs';

const story = {
  dialogues: [{ id: 'd1', title: 'Gate talk', owner: 'Guard1', steps: [{ type: 'line', who: 'npc', text: 'Halt.' },
    { type: 'signal', signal: 'Alarm on' }, { type: 'do', do: [{ type: 'signal', signal: 'Talked' }] }, { type: 'end' }] }],
  infolinks: [{ id: 'i1', title: 'Jock calls', do: [{ type: 'signal', signal: 'Heard Jock' }] }],
  events: [{ id: 'e1', title: 'At the start', when: { type: 'start' }, do: [{ type: 'signal', signal: 'Begin' }, { type: 'signal', signal: '' }] }] };
const heard = (id, signal) => ({ id, src: '', when: 'signal', signal, do: [{ verb: 'message', a: id }] });
const codes = (ps, node) => ps.filter((p) => p.node === node).map((p) => p.code);

test('the names offered: the rules\' and the Story\'s, each once whatever the case', () => {
  const links = [heard('L1', 'alarm on'), { id: 'L2', src: 'Button1', when: 'used', do: [{ verb: 'signal', a: 'Lights' }] }];
  assert.deepEqual(signalsOf(links, story), ['alarm on', 'Begin', 'Heard Jock', 'Lights', 'Talked']);
  assert.deepEqual(signalsOf(links), ['alarm on', 'Lights'], 'no Story: the rules\' only');
});

test('the graph: the dialogue, the InfoLink and the event wire into the signal\'s hub, a signal wire', () => {
  const links = [heard('L1', 'Alarm on'), heard('L2', 'Talked'), heard('L3', 'Heard Jock'), heard('L4', 'begin')];
  const ix = logicIndex(world(links, { story }));
  const g = logicGraph(ix);
  const into = (from) => g.wires.filter((w) => w.from.node === from && w.to.node.startsWith('sig:')).map((w) => [w.to.node, w.kind]);
  assert.deepEqual(into(storyId('dialogues', 'd1')), [[pieceId('signals', 'Alarm on'), 'signal'], [pieceId('signals', 'Talked'), 'signal']]);
  assert.deepEqual(into(storyId('infolinks', 'i1')), [[pieceId('signals', 'Heard Jock'), 'signal']]);
  // one hub for "Begin" and "begin", named as the rules wrote it first; none for no name
  assert.deepEqual(into(storyId('events', 'e1')), [[pieceId('signals', 'begin'), 'signal']]);
  const rows = g.nodes.find((n) => n.id === storyId('dialogues', 'd1')).rows.map((r) => r.text);
  assert.ok(rows.some((t) => /send the signal/i.test(t) && /Alarm on/.test(t)), rows.join(' | '));
});

test('the check: a signal only the Story sends is sent; one only the Story sends and no rule hears does nothing', () => {
  const links = [heard('L1', 'Alarm on'), heard('L9', 'Nobody sends')];
  const ps = logicProblems(logicIndex(world(links, { story })));
  assert.deepEqual(codes(ps, pieceId('signals', 'Alarm on')), []);
  assert.deepEqual(codes(ps, pieceId('signals', 'Talked')), ['signal-unheard']);
  assert.deepEqual(codes(ps, pieceId('signals', 'Nobody sends')), ['signal-never-sent']);
  assert.match(ps.find((p) => p.code === 'signal-never-sent').text || JSON.stringify(ps), /no rule, no dialogue or event of the Story/);
});

test('the Story\'s simulator says the step', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../editor/static/story-sim.js', import.meta.url), 'utf8');
  assert.match(src, /case 'signal': at\+\+; return \{ type: 'effect', id: s\.id, text: `Sends the signal \$\{s\.signal \|\| '\?'\}` \};/);
});

test('the log: a rule set off by the Story says so; by another rule, that rule (no class names)', async () => {
  const { logicSentence } = await import('../editor/static/logic-log.js');
  const by = (who) => logicSentence({ kind: 'fire', rule: 'G1', label: 'Alarm', by: who }).parts.slice(3);
  assert.deepEqual(by('UCEd_22_Story_Bridge0'), [' (by the Story)']);
  assert.deepEqual(by('UCLink_L2'), [' (by rule ', { rule: 'L2' }, ')']);
  assert.deepEqual(by('JCDentonMale0'), [' (by ', { name: 'JCDentonMale0' }, ')']);
  assert.deepEqual(by(''), []);
});
