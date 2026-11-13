// Logic runtime v2 in Try it (editor/static/logic-sim.js): a rule of steps (UCLink bSteps) runs as the game's state
// code does: each step after its delay from the one before, an If (check) goes on or jumps to its Otherwise, a Wait
// until is looked at every 0.25 s until the character has arrived (a decision offered) or its time is up, a loop
// with no wait is stopped after 256 steps. The compiled actors are what links.py makes (tests/test_logic_steps.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../editor/static/logic-sim.js';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const world = { player: 'JCDentonMale0', actors: [
  { name: 'Button1', chain: ['Button1', 'DeusExDecoration', 'Decoration', 'Actor'], at: [0, 0, 0] },
  { name: 'Door1', chain: ['DeusExMover', 'Mover', 'Brush', 'Actor'], at: [100, 0, 0] },
  { name: 'Guard1', chain: ['UNATCOTroop', 'HumanMilitary', 'ScriptedPawn', 'Pawn', 'Actor'], at: [300, 0, 0] }] };
function rule(acts, conds = {}, more = {}) {
  const props = { Tag: 'UCL_Button1', When: 'used', Rule: '"L1"', Source: '"Button1"', bSteps: 'True', ...more };
  acts.forEach((a, i) => { props[`Act(${i})`] = `"${a}"`; });
  Object.entries(conds).forEach(([i, c]) => { props[`StepCond(${i})`] = `"${c}"`; });
  return createSession({ actors: [{ cls: 'UCLink', name: 'UCLink_L1', props }], outputs: logic.outputs, world, map: 'M' });
}
const lines = (s) => s.log().map(({ t, line }) => `${t} ${line.split('|').filter((f, i) => i !== 1).join('|')}`)
  .filter((l) => !/ fire\|/.test(l));
const LIST = ['0|message||Hi||', '0|check|all|0|1|4', '1|open|Door1|||', '0|jump|||5|', '0|message||No||', '0|message||End||'];

test('an If that holds: its steps, then past the Otherwise; each step after its delay from the one before', () => {
  const s = rule(LIST, { 0: 'flag|A|1' });
  s.set({ flags: { A: true } });
  s.fire({ thing: 'Button1', output: 'used' });
  s.run(3);
  assert.deepEqual(lines(s), ['0.1 act|L1|message||Hi', '0.1 check|L1|pass|1', '1.1 act|L1|open|Door1|', '1.1 act|L1|message||End']);
});

test('an If that does not hold: its Otherwise, the condition said in the log', () => {
  const s = rule(LIST, { 0: 'flag|A|1' });
  s.fire({ thing: 'Button1', output: 'used' });
  s.run(3);
  assert.deepEqual(lines(s), ['0.1 act|L1|message||Hi', '0.1 check|L1|fail|1|flag|A|1', '0.1 act|L1|message||No', '0.1 act|L1|message||End']);
});

test('Wait until a character arrives: a decision offered after he is sent; looked at every 0.25 s', () => {
  // the character's own walk (goto, as links.py writes it) is an action, not a jump
  const s = rule(['0|goto|Guard1|10.0|0.0|0.0', '0|until|Guard1|arrived|0|', '0|message||There||']);
  s.fire({ thing: 'Button1', output: 'used' });
  s.run(2);
  assert.ok(!lines(s).some((l) => /until/.test(l)), 'nothing yet');
  const d = s.decisions().find((x) => x.output === 'arrived');
  assert.ok(d, 'his arrival is offered');
  s.decide(d.id);
  s.run(0.5);
  assert.ok(lines(s).some((l) => / until\|L1\|done\|1\|Guard1$/.test(l)));
  assert.ok(lines(s).some((l) => / act\|L1\|message\|\|There$/.test(l)));
});

test('Wait until with a time limit: it runs out and the list goes on', () => {
  const s = rule(['0|until||cond|1|0', '0|message||Later||'], { 0: 'flag|Never|1' });
  s.fire({ thing: 'Button1', output: 'used' });
  s.run(2);
  const l = lines(s);
  assert.ok(l.some((x) => / until\|L1\|timeout\|0\|$/.test(x)), l.join('\n'));
  assert.ok(l.some((x) => / act\|L1\|message\|\|Later$/.test(x)));
});

test('a loop with no wait stops after 256 steps; one with a wait goes on', () => {
  const s = rule(['0|message||Round||', '0|jump|||0|']);
  s.fire({ thing: 'Button1', output: 'used' });
  s.run(1);
  assert.ok(lines(s).some((l) => / fail\|L1\|steps\|\|loop$/.test(l)));
  assert.equal(lines(s).filter((l) => /Round/.test(l)).length, 128);
  const w = rule(['1|message||Tick||', '0|jump|||0|']);
  w.fire({ thing: 'Button1', output: 'used' });
  w.run(5.2);                          // set off at 0.1 s: at 1.1, 2.1, 3.1, 4.1 and 5.1 s
  assert.equal(lines(w).filter((l) => /Tick/.test(l)).length, 5);
  assert.ok(!lines(w).some((l) => /loop/.test(l)));
});

// (13 Nov 2026, Navarre Test) the player who comes back to a map: "the map starts" ran again before a "back" (UCBoot's
// bStarted is saved with the map, so the game runs those rules on the first visit only)
test('a revisit: the rules on "the map starts" do not run again', () => {
  const start = { cls: 'UCLink', name: 'UCLink_L1', props: { Tag: 'UCL_Start', When: 'start', Rule: '"L1"', bSteps: 'True', 'Act(0)': '"0|message||Hello||"' } };
  const first = createSession({ actors: [start], outputs: logic.outputs, world, map: 'M' });
  first.run(1);
  assert.deepEqual(lines(first), ['0.6 act|L1|message||Hello']);   // (the first look, as the game's)
  const again = createSession({ actors: [start], outputs: logic.outputs, world, map: 'M', revisit: true });
  again.run(1);
  assert.deepEqual(lines(again), []);
});

// (13 Nov 2026, Edge Lab) a key the player presses: heard by its Tag (UCMutator triggers UCL_Key_K), offered in Try it
test('a key the player presses runs its rules, and Try it offers it', () => {
  const key = { cls: 'UCLink', name: 'UCLink_L1', props: { Tag: 'UCL_Key_K', When: 'keypress', Rule: '"L1"', bSteps: 'True', 'Act(0)': '"0|message||Key||"' } };
  const s = createSession({ actors: [key], outputs: logic.outputs, world, map: 'M' });
  const h = s.happenings().find((x) => x.output === 'keypress');
  assert.equal(h && h.thing, 'UCL_Key_K');
  assert.equal(h.key, 'K');
  s.fire({ thing: h.thing, output: 'keypress' });
  s.run(1);
  assert.deepEqual(lines(s).filter((l) => l.includes('message')), ['0.1 act|L1|message||Key']);
});
