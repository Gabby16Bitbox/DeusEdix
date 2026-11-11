// P3's rules that hold "while" in the Logic window and Try it: the rule and its end are what links.py expand_while
// makes (tests/test_logic_while.py), played as the game plays them (UCLink.uc TickWatch bWatchStart: a "while" on a
// condition runs at its first look when it already holds); the sentence says the lasting state ("While the player is
// in Zone1"); "To check" says when nothing ends it or nothing it does can be undone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../editor/static/logic-sim.js';
import { logicIndex } from '../editor/static/logic-graph-model.js';
import { logicProblems } from '../editor/static/logic-graph-problems.js';
import { world as graphWorld } from './logic_graph_world.mjs';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const world = { player: 'JCDentonMale0', actors: [
  { name: 'Zone1', chain: ['Trigger', 'Triggers', 'Actor'], at: [0, 0, 0] },
  { name: 'Door1', chain: ['DeusExMover', 'Mover', 'Brush', 'Actor'], at: [100, 0, 0] },
  { name: 'Lamp1', chain: ['Light', 'Actor'], at: [200, 0, 0] }] };
const open = (actors, start = {}) => createSession({ actors, outputs: logic.outputs, world, start, map: 'M' });
const fires = (s) => s.log().map(({ t, line }) => line.split('|')).filter((f) => f[0].endsWith('fire')).map((f) => f[2].split('@')[0]);
const acts = (s) => s.log().map(({ line }) => line.split('|')).filter((f) => f[0].endsWith('act')).map((f) => f.slice(3).join('|'));
// links.py: {id: 'W2', when: 'becomes', watch: {flag: 'Power'}, while: true, do: [{verb: 'open', target: 'Door1'}]}
const powered = [
  { cls: 'UCLink', name: 'UCLink_W2', props: { Tag: 'UCLW_W2', When: 'becomes', Rule: '"W2"', Watch: '"flag|Power|1"', bWatchStart: 'True',
    'Act(0)': '"0|open|Door1|||"' } },
  { cls: 'UCLink', name: 'UCLink_W2_until', props: { Tag: 'UCLW_W2_until', When: 'becomes', Rule: '"W2_until"', Watch: '"flag|Power|0"',
    bWatchStart: 'True', 'Act(0)': '"0|close|Door1|||"' } }];

test('a "while" on a condition that holds at the start: it runs at the first look, its end does not', () => {
  const s = open(powered, { flags: { Power: true } });
  s.run(0.6);
  assert.deepEqual(fires(s), ['W2']);
  s.set({ flags: { Power: false } });
  s.run(0.5);
  assert.deepEqual(fires(s), ['W2', 'W2_until']);
  assert.deepEqual(acts(s).map((a) => a.split('|')[0]), ['open', 'close']);
});

test('a "while" on a condition that does not hold at the start: its end sets things right at once', () => {
  const s = open(powered, { flags: { Power: false } });
  s.run(0.6);
  assert.deepEqual(fires(s), ['W2_until'], 'the door closed, as it is while there is no power');
  s.set({ flags: { Power: true } });
  s.run(0.5);
  assert.deepEqual(fires(s), ['W2_until', 'W2']);
});

test('a plain "becomes" still only notes how things are at its first look', () => {
  const plain = [{ cls: 'UCLink', name: 'UCLink_B', props: { Tag: 'UCLW_B', When: 'becomes', Rule: '"B"', Watch: '"flag|Power|1"',
    'Act(0)': '"0|message||B||"' } }];
  const s = open(plain, { flags: { Power: true } });
  s.run(1.2);
  assert.deepEqual(fires(s), []);
});

const ix = (links) => logicIndex(graphWorld(links));
const brief = (ps) => ps.map((p) => `${p.level} ${p.code} ${p.node}: ${p.text}`).filter((p) => / while-/.test(p));

test('the sentence says the lasting state', () => {
  const i = ix([]);
  assert.equal(i.vocab.whenText({ src: 'Door3', when: 'opened', while: true }, i.ctx).startsWith('While '), true);
  assert.match(i.vocab.whenText({ when: 'becomes', watch: { flag: 'Power' }, while: true }, i.ctx), /^While /);
  assert.match(i.vocab.whenText({ src: 'Door3', when: 'opened' }, i.ctx), /^When /);
  assert.match(i.vocab.whenText({ src: 'Door3', when: 'used', while: true }, i.ctx), /^When /, 'nothing ends a use');
  assert.deepEqual(i.vocab.untilOf({ src: 'P1', when: 'output', port: 'Enter_Alarm' }), { when: 'output', port: 'Leave_Alarm' });
  assert.deepEqual(i.vocab.untilOf({ src: 'P1', when: 'output', port: 'Reached' }), { when: 'output', port: 'Lost' });
  assert.equal(i.vocab.untilOf({ src: 'P1', when: 'output', port: 'Done' }), null);
  assert.equal(i.vocab.untilOf({ src: 'Door3', when: 'opened' }).when, 'closed');
});

test('To check: nothing ends it, nothing can be undone, some steps stay', () => {
  const ps = brief(logicProblems(ix([
    { id: 'L1', src: 'Button1', when: 'used', while: true, do: [{ verb: 'open', target: 'Door3' }] },
    { id: 'L2', src: 'Door3', when: 'opened', while: true, do: [{ verb: 'message', a: 'x' }] },
    { id: 'L3', src: 'Door3', when: 'opened', while: true, do: [{ verb: 'lighton', target: 'Lamp1' }, { verb: 'message', a: 'x' }] },
    { id: 'L4', src: 'Door3', when: 'opened', while: true, do: [{ verb: 'lighton', target: 'Lamp1' }] }])));
  assert.ok(ps.some((p) => p.startsWith('warn while-no-end rule:L1')), ps.join('\n'));
  assert.ok(ps.some((p) => p.startsWith('warn while-no-undo rule:L2')), ps.join('\n'));
  assert.ok(ps.some((p) => p.startsWith('info while-stays rule:L3')), ps.join('\n'));
  assert.ok(!ps.some((p) => p.includes('rule:L4')), ps.join('\n'));
});
