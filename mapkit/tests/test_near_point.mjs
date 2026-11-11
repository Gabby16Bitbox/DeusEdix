// The condition "the player is near a point" (P5, static/conditions.js): its words, what it misses, whether it holds
// as the game says (whole units, 3D distance: UCEditorStory.Near), read back from the log (logic-log.js), turned round
// (action-list.js negate), and in Try it (logic-sim.js): a rule that hears the player come near a point runs when he
// goes there, its condition refuses it when he is not, and the places the rules ask about are listed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { conditionText, conditionProblem, conditionHolds, nearHolds, newCondition, CONDITION_KINDS } from '../editor/static/conditions.js';
import { decodeCondition } from '../editor/static/logic-log.js';
import { negate } from '../editor/static/action-list.js';
import { createSession } from '../editor/static/logic-sim.js';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const near = { type: 'near', at: [1200, -340, 48], radius: 300, is: true };

test('its words, what it misses, a new one', () => {
  assert.ok(CONDITION_KINDS.some(([k]) => k === 'near'));
  assert.equal(conditionText(near), 'the player is within 300 units of the point (1200, -340, 48)');
  assert.equal(conditionText({ ...near, is: false }, { place: () => 'Door2' }), 'the player is not within 300 units of the point by Door2');
  assert.equal(conditionProblem(near), '');
  assert.equal(conditionProblem({ type: 'near', at: [0, 0] }), 'choose the point');
  assert.match(conditionProblem({ ...near, radius: 0 }), /distance/);
  assert.deepEqual(newCondition('near', [10.6, 2, 3]), { type: 'near', at: [11, 2, 3], radius: 256, is: true });
  assert.deepEqual(negate(near), { ...near, is: false });
});

test('it holds as the game says, and reads back from the log', () => {
  assert.equal(nearHolds(near, [1200, -340, 348]), true);                 // 300 above: on the edge, in
  assert.equal(nearHolds(near, [1200, -340, 349]), false);
  assert.equal(nearHolds({ ...near, at: [1200.4, -340, 48] }, [1200, -40, 48]), true);  // whole units, as the game gets them
  assert.equal(conditionHolds(near, { player: null }), false);             // nowhere: not near
  assert.equal(conditionHolds({ ...near, is: false }, { player: null }), true);
  assert.equal(conditionHolds(near, { player: [1300, -340, 48] }), true);
  assert.deepEqual(decodeCondition('near|1200|-340|48|300|1'), near);
  assert.deepEqual(decodeCondition('near|0|0|0|64|0'), { type: 'near', at: [0, 0, 0], radius: 64, is: false });
});

const q = (v) => `"${v}"`;
const rule = (id, props, acts) => ({ cls: 'UCRule', name: `UCLink_${id}`,
  props: { Rule: q(id), ...props, ...Object.fromEntries(acts.map((a, i) => [`Act(${i})`, q(a)])) } });
const said = (s) => s.log().map(({ line }) => line.split('|')).filter((f) => f[0] === 'act' && f[3] === 'message').map((f) => f.at(-1));

test('Try it: the player goes to the point, the rule hears it; away, its condition refuses another', () => {
  const s = createSession({ map: 'M', outputs: logic.outputs, world: { player: 'JCDentonMale0', actors: [] }, actors: [
    rule('L1', { When: 'becomes', Watch: q('near|1200|-340|48|300|1'), bWatchStart: 'True', bOnce: 'False' }, ['0|message||here||']),
    rule('L2', { When: 'start', 'Cond(0)': q('near|0|0|0|64|1') }, ['0|message||start||'])] });
  s.run(1);
  assert.deepEqual(said(s), [], 'nowhere near either point at the start');
  assert.deepEqual(s.places().map((p) => [p.at, p.radius, p.rules, p.here]),
    [[[1200, -340, 48], 300, ['L1'], false], [[0, 0, 0], 64, ['L2'], false]]);
  s.set({ jc: [1200, -340, 48] });
  s.run(1);
  assert.deepEqual(said(s), ['here']);
  assert.equal(s.places()[0].here, true);
  s.set({ jc: null }); s.run(1);
  s.set({ jc: [1250, -340, 48] }); s.run(1);
  assert.deepEqual(said(s), ['here', 'here'], 'each time he comes back');
});

test('Try it: a rule that looks at the start runs when the player starts at the point', () => {
  const s = createSession({ map: 'M', outputs: logic.outputs, world: { player: 'JCDentonMale0', actors: [] }, start: { jc: [0, 0, 10] },
    actors: [rule('L1', { When: 'becomes', Watch: q('near|0|0|0|64|1'), bWatchStart: 'True', bOnce: 'True' }, ['0|message||here||'])] });
  s.run(1);
  assert.deepEqual(said(s), ['here']);
});

test('a rule set off by it says the player comes near (or goes away)', async () => {
  const { vocabulary } = await import('../editor/static/logic-vocab.js');
  const v = vocabulary(logic), ctx = { name: (n) => n, names: { place: () => 'Door2' } };
  assert.equal(v.whenText({ src: '', when: 'becomes', watch: near }, ctx), 'When the player comes within 300 units of the point by Door2');
  assert.equal(v.whenText({ src: '', when: 'becomes', watch: { ...near, is: false } }, { name: (n) => n }),
    'When the player goes further than 300 units from the point (1200, -340, 48)');
});
