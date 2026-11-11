// P5: the Story's action rows use the rules' verbs. A Story action {type: 'act', act: {verb, target, a, b, c...}} is
// a rule's own action: drawn by the rules' rows (app.js lkStoryActs, lkActHtml), said in their words, done in the game
// by UCEditorStory.RunAct (test_story_verbs.py). Here: Try it does what the rules hear and the conditions read, says
// it as the Logic window does; the graph shows it as a rule's action; the log names the Story; Move to Logic keeps it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../editor/static/logic-sim.js';
import { vocabulary } from '../editor/static/logic-vocab.js';
import { saidLine } from '../editor/static/logic-try.js';
import { logicSentence } from '../editor/static/logic-log.js';
import { moveAction } from '../editor/static/story-move.js';
import { logicIndex, logicGraph, storyId } from '../editor/static/logic-graph-model.js';
import { world } from './logic_graph_world.mjs';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const ACTS = [{ type: 'act', act: { verb: 'count', a: 'Keys found', b: '2' } },
  { type: 'act', act: { verb: 'flag', a: 'Door told', b: '1' } },
  { type: 'act', act: { verb: 'signal', a: 'Jock done' } },
  { type: 'act', act: { verb: 'giveitem', a: 'DeusEx.Medkit', b: '1' } },
  { type: 'act', act: { verb: 'credits', a: '50' } },
  { type: 'act', act: { verb: 'explode', target: 'Crate1', a: '40', b: '200' } }];
const i1 = { id: 'i1', once: true, flag: '', name: 'Jock', lines: [{ text: 'Heads up.' }], do: ACTS };
const story = { dialogues: [], infolinks: [i1], talks: {} };
const W = { player: 'JCDentonMale0', story, actors: [{ name: 'Button1', chain: ['Button1', 'DeusExDecoration', 'Decoration', 'Actor'], at: [0, 0, 0] },
  { name: 'Crate1', chain: ['CrateExplosiveSmall', 'DeusExDecoration', 'Decoration', 'Actor'], at: [64, 0, 0] }] };
function link(id, when, tag, acts, source = '') {
  const props = { Tag: tag, When: when, Rule: `"${id}"`, ...(source ? { Source: `"${source}"` } : {}) };
  acts.forEach((a, i) => { props[`Act(${i})`] = `"${a}"`; });
  return { cls: 'UCLink', name: `UCLink_${id}`, props };
}
const RULES = [link('L1', 'used', 'UCL_Button1', ['0|infolink||i1||'], 'Button1'),
  link('L2', 'signal', 'UCS_Jock_done', ['0|message||Heard||'])];

test('Try it: the Story\'s Logic actions set what the rules hear and the conditions read', () => {
  const s = createSession({ actors: RULES, outputs: logic.outputs, world: W, map: 'M' });
  s.fire({ thing: 'Button1', output: 'used' });
  s.step(3);
  while (s.talking && s.talking()) { s.say(-1); s.step(1); }
  s.step(3);
  const st = s.state();
  assert.equal(st.counters.Keys_found, 2, JSON.stringify(st.counters));
  assert.equal(st.flags.Door_told, true);
  assert.equal(st.credits >= 50, true);
  assert.ok(JSON.stringify(st.items || []).includes('Medkit'), JSON.stringify(st.items));
  const heard = s.log().map(({ line }) => line).filter((l) => /^act\|M\|L2\|message/.test(l));
  assert.equal(heard.length, 1, 'the rule on the signal ran');
});

test('Try it says it in the rules\' words', () => {
  const vocab = vocabulary(logic);
  const t = (act) => saidLine({ kind: 'effect', action: { type: 'act', act } }, { vocab }).text;
  assert.match(t({ verb: 'count', a: 'Keys found', b: '2' }), /^[A-Z].*Keys found/);
  assert.match(t({ verb: 'explode', target: 'Crate1', a: '40', b: '200' }), /Crate1/);
  assert.equal(saidLine({ kind: 'effect', action: { type: 'act', act: { verb: 'count' } } }).text, 'Count', 'no words known: its verb');
});

test('the log: an action the Story did says "The Story:"', () => {
  const p = logicSentence({ kind: 'act', rule: 'story:i1', verb: 'explode', target: 'Crate1', detail: '' }).parts;
  assert.equal(p[0], 'The Story: ');
  assert.equal(logicSentence({ kind: 'act', rule: 'L1', verb: 'explode', target: 'Crate1', detail: '' }).parts[0], '  ');
  assert.equal(logicSentence({ kind: 'fail', rule: 'story:e1', verb: 'open', target: 'Door1', why: 'missing' }).parts[0], 'The Story: ');
});

test('Move to Logic keeps it as it is, done at once', () => {
  assert.deepEqual(moveAction({ type: 'act', act: { verb: 'explode', target: 'Crate1', a: '40', delay: 5 } }).act,
    { verb: 'explode', target: 'Crate1', a: '40', delay: 0 });
  assert.match(moveAction({ type: 'act', act: {} }).why, /nothing to do/);
});

test('the graph: the InfoLink\'s Logic actions are its rows, its signal a wire', () => {
  const ix = logicIndex(world([{ id: 'L2', src: '', when: 'signal', signal: 'Jock done', do: [{ verb: 'message', a: 'x' }] }],
    { story: { dialogues: [], events: [], infolinks: [{ id: 'i1', title: 'Jock calls', do: ACTS }] } }));
  const g = logicGraph(ix);
  const n = g.nodes.find((x) => x.id === storyId('infolinks', 'i1'));
  assert.ok(n && n.rows.length >= ACTS.length, JSON.stringify(n && n.rows.map((r) => r.text)));
  assert.ok(n.rows.some((r) => /Keys found/.test(r.text)), n.rows.map((r) => r.text).join(' | '));
  assert.ok(g.wires.some((w) => w.from.node === n.id && w.to.node.startsWith('sig:') && w.kind === 'signal'));
});

test('the page: the Story\'s rows are the rules\' rows', () => {
  const app = readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
  const sj = readFileSync(new URL('../editor/static/story.js', import.meta.url), 'utf8');
  assert.match(app, /function lkActHtml\(l, step, num, pad\)/);
  assert.match(app, /if \(lkCarriers\.has\(id\)\) return lkCarriers\.get\(id\);/);
  assert.match(app, /if \(l && l\.carrier\) \{ fn\(\); l\.carrier\.changed\(\); return; \}/);     // (null: a new rule)
  assert.match(app, /window\.__editor\.storyActs = lkStoryActs;/);
  assert.match(app, /const LK_STORY_NO = new Set\(\['ownorders'\]\);/);
  assert.match(sj, /acts\(\)\.mount\(card\.querySelector\('\.st-actrows'\), a\.act/);
  assert.match(sj, /acts\(\)\?\.hook\(pickHook\)/);
});

test('the log: a rule set off by the Story\'s doer (UCLink<n>, the one it spawns) is set off by the Story', () => {
  const by = (who) => logicSentence({ kind: 'fire', rule: 'T_sv', label: 'x', by: who }).parts.slice(3);
  assert.deepEqual(by('UCLink0'), [' (by the Story)']);
  assert.deepEqual(by('UCLink_L2'), [' (by rule ', { rule: 'L2' }, ')']);
});
