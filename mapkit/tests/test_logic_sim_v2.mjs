// The Logic runtime v2 and the P4 outputs in Try it (editor/static/logic-sim.js), as the game plays them (UCRule.uc,
// UCRuleAlso.uc, UCLink.uc PawnTold / TickWatch), checked against Feature Test's 14_Logic_P4 in both games (5 Nov
// 2026, backup/20261105_logic_b/game_m4_p4.py): other causes name their own object, Otherwise, again restart / each
// (8 runs, the 9th refused), max, cooldown, a step's own condition, stop a rule; killed and knocked out told apart a
// tick later; a property's output noticed at the next look; a condition that becomes so; a value that changes; an
// event of the game. The compiled actors are what links.py makes (tests/test_logic_rule_v2.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../editor/static/logic-sim.js';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const pawn = ['ScriptedPawn', 'Pawn', 'Actor'];
const world = { player: 'JCDentonMale0', actors: [
  { name: 'Button1', chain: ['Button1', 'DeusExDecoration', 'Decoration', 'Actor'], at: [0, 0, 0] },
  { name: 'Button2', chain: ['Button1', 'DeusExDecoration', 'Decoration', 'Actor'], at: [50, 0, 0] },
  { name: 'Door1', chain: ['DeusExMover', 'Mover', 'Brush', 'Actor'], at: [100, 0, 0] },
  { name: 'Bum1', chain: ['BumMale', 'HumanCivilian', ...pawn], at: [200, 0, 0] },
  { name: 'Bum3', chain: ['BumMale', 'HumanCivilian', ...pawn], at: [300, 0, 0] }] };
const quoted = (v) => `"${v}"`;
// a UCRule on Button1 (its steps, their ids a1, a2...), and more actors after it
function ruleActor(id, acts, more = {}) {
  const props = { Tag: 'UCL_Button1', When: 'used', Rule: quoted(id), Source: '"Button1"', bSteps: 'True', ...more };
  acts.forEach((a, i) => { props[`Act(${i})`] = quoted(a); props[`ActId(${i})`] = quoted(`${id}_a${i + 1}`); });
  return { cls: 'UCRule', name: `UCLink_${id}`, props };
}
const open = (actors, start = {}) => createSession({ actors, outputs: logic.outputs, world, start, map: 'M' });
const lines = (s) => s.log().map(({ t, line }) => `${t} ${line.split('|').filter((f, i) => i !== 1).join('|')}`);
const press = (s, thing = 'Button1') => s.fire({ thing, output: 'used' });

test('the map\'s start values (UCLogicHub, P5): set as the map loads, before the rules look; one set already kept', () => {
  const hub = { cls: 'UCLogicHub', name: 'UCLogicHub0', props: { 'Start(0)': '"Door|b|1"', 'Start(1)': '"Keys|i|3"', 'Start(2)': '"Met|b|0"',
    'Start(3)': '"bad"', 'Watch(0)': '"Keys"' } };
  const rule = ruleActor('R1', ['0|message||Open||'], { When: 'start', 'Cond(0)': '"flag|Door|1"', 'Cond(1)': '"count|Keys|>=|3"' });
  let s = open([rule, hub]);
  s.run(1);
  assert.deepEqual(lines(s).filter((l) => / start\|/.test(l)), ['0 start|Door|true|set', '0 start|Keys|3|set', '0 start|Met|false|set']);
  assert.equal(s.state().flags.Door, true);
  assert.equal(s.state().counters.Keys, 3);
  assert.ok(lines(s).some((l) => / act\|R1/.test(l)), 'the start rule saw them');
  // a Play scenario's (or an earlier map's) value is kept
  s = open([rule, hub], { flags: { Met: true }, counters: { Keys: 1 } });
  s.run(1);
  assert.deepEqual(lines(s).filter((l) => / start\|/.test(l)), ['0 start|Door|true|set', '0 start|Keys|1|kept', '0 start|Met|true|kept']);
  assert.ok(!lines(s).some((l) => / act\|R1/.test(l)), 'Keys is 1, not 3');
});

test('another cause sets the rule off, and the log names it, not the rule\'s own object', () => {
  const s = open([ruleActor('R1', ['0|message||Hi||']),
    { cls: 'UCRuleAlso', name: 'UCRuleAlso_R1_1', props: { Tag: 'UCL_Button2', When: 'used', Rule: '"R1"', Source: '"Button2"',
      Main: '"UCLink_R1"' } }]);
  press(s, 'Button2');
  s.run(0.5);
  assert.deepEqual(lines(s), ['0 fire|R1@0.00|Button2|used|JCDentonMale0|', '0.1 act|R1@0.10#R1_a1|message||Hi']);
  assert.equal(s.state().rules.R1.done, true, 'one entry for the rule and its other cause');
});

test('Otherwise: its conditions refused, it jumps past the main list (ElseAt)', () => {
  const s = open([ruleActor('R1', ['0|message||Yes||', '0|jump|||stop|', '1|message||No||'], { 'Cond(0)': '"flag|A|1"', ElseAt: '2' })]);
  press(s);
  s.run(2);
  assert.deepEqual(lines(s), ['0 skip|R1@0.00|cond|flag|A|1', '0 else|R1@0.00|Button1|used|JCDentonMale0',
    '1.1 act|R1@1.10#R1_a3|message||No']);
});

test('again restart: the run going on ends, a new one starts; one end only', () => {
  const s = open([ruleActor('R1', ['0|message||Start||', '3|message||End||'], { Again: 'restart' })]);
  press(s);
  s.run(1);
  press(s);
  s.run(5);
  const said = lines(s).filter((l) => / act\|| skip\|/.test(l)).map((l) => l.replace(/^[\d.]+ /, '').replace(/@[\d.]+/, ''));
  assert.deepEqual(said, ['act|R1#R1_a1|message||Start', 'skip|R1|restarted|', 'act|R1#R1_a1|message||Start', 'act|R1#R1_a2|message||End']);
});

test('again each: 8 runs at once, the 9th refused; each ends on its own', () => {
  const s = open([ruleActor('R1', ['0|message||Start||', '5|message||End||'], { Again: 'each' })]);
  for (let k = 0; k < 9; k++) { press(s); s.run(0.1); }
  assert.equal(s.state().rules.R1.runs, 8);
  assert.equal(lines(s).filter((l) => / skip\|R1@[\d.]+\|full\|/.test(l)).length, 1);
  s.run(6);
  assert.equal(lines(s).filter((l) => /message\|\|End$/.test(l)).length, 8);
  assert.equal(s.state().rules.R1.running, false);
});

test('max and cooldown', () => {
  const s = open([ruleActor('R1', ['0|message||Hi||'], { MaxRuns: '2' }),
    { ...ruleActor('R2', ['0|message||Cool||'], { Cooldown: '5.000000' }), name: 'UCLink_R2' }]);
  // both on Button1: R2 hears it too
  for (let k = 0; k < 3; k++) { press(s); s.run(1); }
  const skips = lines(s).filter((l) => / skip\|/.test(l)).map((l) => l.split('|').slice(0, 1).concat(l.split('|').slice(1, 3)).join('|')
    .replace(/^[\d.]+ /, '').replace(/@[\d.]+/, ''));
  assert.deepEqual(skips, ['skip|R2|cooldown', 'skip|R1|max', 'skip|R2|cooldown']);
});

test('stop a rule: its runs end, said in its log, and its later steps never come', () => {
  const s = open([ruleActor('R1', ['0|message||Long||', '5|message||Late||']),
    { cls: 'UCLink', name: 'UCLink_C1', props: { Tag: 'UCL_Button2', When: 'used', Rule: '"C1"', Source: '"Button2"',
      'Act(0)': '"0|cancel||R1||"' } }]);
  press(s);
  s.run(1);
  press(s, 'Button2');
  s.run(6);
  assert.ok(lines(s).some((l) => / skip\|R1@[\d.]+\|cancelled\|$/.test(l)), lines(s).join('\n'));
  assert.ok(!lines(s).some((l) => /Late/.test(l)));
});

test('killed or knocked out: the death heard, told apart a tick later', () => {
  const tagged = (id, when) => ({ cls: 'UCLink', name: `UCLink_${id}`, props: { Tag: 'UCL_Bum1', When: when, Rule: quoted(id),
    Source: '"Bum1"', 'Act(0)': `"0|message||${id}||"` } });
  const s = open([tagged('K', 'killed'), tagged('O', 'knockedout')]);
  s.fire({ thing: 'Bum1', output: 'knockedout' });
  assert.deepEqual(lines(s), [], 'nothing in the tick it happens');
  s.run(0.5);
  assert.deepEqual(lines(s).slice(0, 2), ['0.1 skip|K|how|killed', '0.1 fire|O|Bum1|knockedout|JCDentonMale0|']);
  assert.deepEqual(s.state().dead, ['Bum1']);
});

test("a property's output: noticed at the rules' next look (the first look only notes), every look for a fall", () => {
  const watched = (id, when, watch) => ({ cls: 'UCLink', name: `UCLink_${id}`, props: { Tag: `UCLW_${id}`, When: when,
    Rule: quoted(id), Source: '"Bum3"', bWatchProp: 'True', Watch: quoted(watch), 'Act(0)': `"0|message||${id}||"` } });
  const s = open([watched('Hurt', 'hurt', 'Health down'), watched('Half', 'hurt', 'Health<%50')]);
  s.run(0.6);                                           // past the first look
  s.fire({ thing: 'Bum3', output: 'hurt' });
  assert.equal(s.runToNext().t, 1, 'due at the next look');
  assert.deepEqual(lines(s).filter((l) => / fire\|/.test(l)), ['1 fire|Hurt|Bum3|hurt|Bum3|', '1 fire|Half|Bum3|hurt|Bum3|']);
  s.run(1);
  assert.equal(lines(s).filter((l) => / fire\|/.test(l)).length, 2, 'one look only');
  const h = s.happenings().find((x) => x.thing === 'Bum3');
  assert.equal(h.watched, true);
});

test("the player's health: a property of his, its button his", () => {
  const s = open([{ cls: 'UCLink', name: 'UCLink_Low', props: { Tag: 'UCLW_Low', When: 'jchealth', Rule: '"Low"', bWatchProp: 'True',
    Watch: '"Health<30"', 'Act(0)': '"0|message||Low||"' } }]);
  assert.deepEqual(s.happenings().map((h) => [h.thing, h.output, h.present]), [['JCDentonMale0', 'jchealth', true]]);
  s.run(0.6);
  s.fire({ thing: 'JCDentonMale0', output: 'jchealth' });
  s.run(0.5);
  assert.deepEqual(lines(s).filter((l) => / fire\|/.test(l)), ['1 fire|Low||jchealth|JCDentonMale0|']);
});

test('a condition that becomes so, a value that changes: read at each look', () => {
  const s = open([
    { cls: 'UCLink', name: 'UCLink_B', props: { Tag: 'UCLW_B', When: 'becomes', Rule: '"B"', Watch: '"count|Hits|>=|3"',
      'Act(0)': '"0|message||B||"' } },
    { cls: 'UCLink', name: 'UCLink_C', props: { Tag: 'UCLW_C', When: 'changes', Rule: '"C"', Watch: '"flag|Open"',
      'Act(0)': '"0|message||C||"' } }], { counters: { Hits: 1 } });
  assert.deepEqual(s.happenings(), [], 'no buttons: the State panel sets them');
  s.run(0.6);
  s.set({ counters: { Hits: 3 } });
  s.run(0.5);
  s.set({ counters: { Hits: 4 } });                    // still so: not again
  s.set({ flags: { Open: true } });
  s.run(0.5);
  s.set({ flags: { Open: false } });                    // changes back: again
  s.run(0.5);
  assert.deepEqual(lines(s).filter((l) => / fire\|/.test(l)), ['1 fire|B||becomes||', '1.5 fire|C||changes||', '2 fire|C||changes||']);
});

test("an event of the game: whatever has its Tag hears it, no object needed", () => {
  const s = open([{ cls: 'UCLink', name: 'UCLink_G', props: { Tag: 'Ping', When: 'gametag', Rule: '"G"', 'Act(0)': '"0|message||G||"' } }]);
  assert.deepEqual(s.happenings().map((h) => [h.thing, h.output]), [['Ping', 'gametag']]);
  s.fire({ thing: 'Ping', output: 'gametag' });
  s.run(0.2);
  assert.deepEqual(lines(s), ['0 fire|G||gametag|JCDentonMale0|', '0.1 act|G|message||G']);
});

test('what is due next: a run of a UCRule', () => {
  const s = open([ruleActor('R1', ['2|message||Later||'])]);
  press(s);
  s.run(0.1);
  assert.equal(s.runToNext().t, 2.1);
  assert.ok(lines(s).some((l) => /^2\.1 act\|R1@2\.10#R1_a1\|message\|\|Later$/.test(l)), lines(s).join('\n'));
  assert.ok(s.why('R1').some((w) => w.why === 'fired'));
});
