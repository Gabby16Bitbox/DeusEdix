import test from 'node:test';
import assert from 'node:assert/strict';
import { blockActText, blockRowsHtml } from '../editor/static/interaction-blocks.js';
import { logicIndex, logicGraph } from '../editor/static/logic-graph-model.js';
import { logicProblems } from '../editor/static/logic-graph-problems.js';
import { createSession } from '../editor/static/logic-sim.js';
import { world, catalog, ACTORS } from './logic_graph_world.mjs';

const seatRule = a => ({ id: 'L1', when: 'start', do: [{ verb: 'sit', target: 'Guard1', a }] });
const esc = s => String(s).replace(/[&<>"']/g, c => '&#'+c.charCodeAt(0)+';');

test('seat picker keeps long names contained and escaped; standing needs no chair', () => {
  const a = { verb: 'sit', a: 'Chair2' };
  const html = blockRowsHtml(a, 2, esc, () => '<img onerror="bad">' + 'Long office chair '.repeat(20));
  assert.match(html, /data-lkseat="2"/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /text-overflow:ellipsis/);
  assert.match(html, /Change/);
  assert.match(blockRowsHtml({ verb: 'sit' }, 1, esc, n => n), /Choose a chair/);
  assert.equal(blockRowsHtml({ verb: 'standup' }, 2, esc, n => n), '');
  assert.equal(blockActText(a, 'Guard', n => n), 'Guard walks to Chair2 and sits down');
});

test('graph distinguishes missing, disabled and non-seat targets', () => {
  const actors = { ...ACTORS, Chair2: { family: 'object', chain: ['Seat'], inputs: [], outputs: [] },
    Crate: { ...ACTORS.Crate, chain: ['DeusExDecoration'] } };
  const check = (chair, edits = {}) => logicProblems(logicIndex(world([seatRule(chair)], { actors, edits })))
    .filter(p => ['no-seat', 'seat-disabled', 'not-seat', 'cannot-input'].includes(p.code)).map(p => p.code);
  assert.deepEqual(check('Chair2'), []);
  assert.deepEqual(check(''), ['no-seat']);
  assert.deepEqual(check('Chair2', { deleted: { Chair2: true } }), ['no-seat']);
  assert.deepEqual(check('Chair2', { disabled: { Chair2: true } }), ['seat-disabled']);
  assert.deepEqual(check('Crate'), ['not-seat']);
  const story = { events: [{ id: 'sit', title: 'Sit', when: { type: 'start' },
    do: [{ type: 'npc', actor: 'Guard1', act: 'sit', seat: 'Chair2' }] }] };
  const graph = logicGraph(logicIndex(world([], { actors, story })));
  assert.match(JSON.stringify(graph), /Chair2/);
});

test('logic simulation rejects a missing chair or a non-character, without inventing path results', () => {
  const play = (target, seat, verb = 'sit') => {
    const s = createSession({ map: 'Seats', outputs: catalog.outputs,
      world: { actors: [{ name: 'Guard1', chain: ['ScriptedPawn'] }, { name: 'Chair2', chain: ['Seat'] }] },
      actors: [{ name: 'UCLink_L1', cls: 'UCLink', props: { Rule: '"L1"', When: 'start', Tag: 'UCLW_L1',
        'Act(0)': `"0|${verb}|${target}|${seat}||"` } }] });
    s.scrub(2);
    return s.log().map(l => l.line);
  };
  assert.ok(play('Guard1', 'Chair2').some(l => l.includes('|act|') || l.startsWith('act|')));
  assert.ok(!play('Guard1', 'Chair2').some(l => l.startsWith('fail|')));
  assert.ok(play('Guard1', 'Gone').some(l => l.startsWith('fail|')));
  assert.ok(play('Chair2', 'Chair2').some(l => l.startsWith('fail|')));
  assert.ok(!play('Guard1', '', 'standup').some(l => l.startsWith('fail|')));
});
