// P3's rules kept to some phases of a Phases block in Try it, as the game plays them (UCLink.InPhase: the block's
// counter, its first phase before it starts, is one of the gate's), the log's words, and the Logic window: the Read
// view's section ("While Raid is Red alert"), "To check" (a block gone, no phase ticked, a phase it has not). The
// compiled actors are what links.py makes (tests/test_logic_phase_gate.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../editor/static/logic-sim.js';
import { parseLogicLine, logicSentence, LOGIC_TAG } from '../editor/static/logic-log.js';
import { logicIndex } from '../editor/static/logic-graph-model.js';
import { logicProblems } from '../editor/static/logic-graph-problems.js';
import { readView } from '../editor/static/logic-graph-read.js';
import { world as graphWorld, actorOf } from './logic_graph_world.mjs';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const world = { player: 'JCDentonMale0', actors: [
  { name: 'Button1', chain: ['Button1', 'DeusExDecoration', 'Decoration', 'Actor'], at: [0, 0, 0] }] };
const q = (v) => `"${v}"`;
const link = (id, gate, more = {}) => ({ cls: more.cls || 'UCLink', name: `UCLink_${id}`, props: { Tag: 'UCL_Button1', When: 'used', Rule: q(id),
  Source: '"Button1"', PhaseGate: q(gate), 'Act(0)': `"0|message||${id}||"`, ...(more.props || {}) } });
const open = (actors, start = {}) => createSession({ actors, outputs: logic.outputs, world, start, map: 'M' });
const lines = (s) => s.log().map(({ line }) => line.split('|')).filter((f) => /fire|skip/.test(f[0])).map((f) => `${f[0].split(':').pop()} ${f[2].split('@')[0]} ${f[3]}`);
const press = (s) => { s.fire({ thing: 'Button1', output: 'used' }); s.run(0.3); };

test('a rule kept to phases runs only in them; before the block starts, its first phase counts', () => {
  const rules = [link('A', 'Raid|1'), link('B', 'Raid|2,3'), link('C', 'Raid|2', { cls: 'UCRule', props: { bSteps: 'True' } })];
  let s = open(rules);
  press(s);
  assert.deepEqual(lines(s), ['fire A Button1', 'skip B phase', 'skip C phase']);
  s = open(rules, { counters: { Raid: 2 } });
  press(s);
  assert.deepEqual(lines(s), ['skip A phase', 'fire B Button1', 'fire C Button1']);
});

test('a gate no phase passes ("?|", "Raid|") never lets it run', () => {
  const s = open([link('A', '?|'), link('B', 'Raid|')], { counters: { Raid: 1 } });
  press(s);
  assert.deepEqual(lines(s), ['skip A phase', 'skip B phase']);
});

test('the log says why in words', () => {
  const words = logicSentence(parseLogicLine(LOGIC_TAG + 'skip|M|A|phase|Raid|2')).parts.map((p) => (typeof p === 'string' ? p : p.rule || p.name)).join('');
  assert.match(words, /works only in some phases/);
});

const phases = [{ id: 'Calm', text: 'Calm' }, { id: 'Red_alert', text: 'Red alert' }];
const input = (links) => {
  const w = graphWorld(links);
  return { ...w, actors: { ...w.actors, Ph1: actorOf('phases', { title: 'Phases 1', stateName: 'Raid', phases }) } };
};
const brief = (ps) => ps.filter((p) => /^phase-/.test(p.code)).map((p) => `${p.level} ${p.code} ${p.node}`);
const used = (extra) => ({ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'message', a: 'x' }], ...extra });

test('the Read view puts it under its phases, in their words', () => {
  const view = readView(logicIndex(input([used({ phase: { set: 'Ph1', in: ['Red_alert'] } }), used({ id: 'L2' })])));
  assert.deepEqual(view.sections.map((s) => s.title), ['While Raid is Red alert', 'Always']);
});

test('To check: the block gone, no phase ticked, a phase it has not; none when all is well', () => {
  const ps = (phase) => brief(logicProblems(logicIndex(input([used({ phase })]))));
  assert.deepEqual(ps({ set: 'Ph9', in: ['Calm'] }), ['error phase-gone rule:L1']);
  assert.deepEqual(ps({ set: 'Ph1', in: [] }), ['warn phase-none rule:L1']);
  assert.deepEqual(ps({ set: 'Ph1', in: ['Calm', 'Nowhere'] }), ['warn phase-unknown rule:L1']);
  assert.deepEqual(ps({ set: 'Ph1', in: ['calm'] }), []);
});
