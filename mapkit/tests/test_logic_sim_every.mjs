// P9 slice 1 in Try it (editor/static/logic-sim.js): the game rules on anyone of a set (UCRule Every), as the game
// plays them (UCRule.uc LookAtMembers, LookAtFates, DoEvery), checked against Feature Test's 27_P9_Sets in both games
// (10 Nov 2026, backup/20261110_p9/run_m22_*.txt): a member killed or knocked out noticed on the next Tick, the other
// "skip how"; sees, turns hostile, hurt, finds a body at the half-second look (the first look only takes how things
// are); "hurt below 50%" once; a step on every one of a kind, each living one; a rule's "hostile" seen by "turns
// hostile". The compiled actors are what links.py makes of make_m22_p9sets.py's rules (tests/test_logic_every.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../editor/static/logic-sim.js';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const trooper = ['UNATCOTroop', 'HumanMilitary', 'ScriptedPawn', 'Pawn', 'Actor'];
const world = { player: 'JC', actors: [
  { name: 'Guard1', chain: trooper, alliance: 'UNATCO', at: [-200, 200, 48] },
  { name: 'Guard2', chain: trooper, alliance: 'UNATCO', at: [300, 800, 48] },
  { name: 'Guard3', chain: trooper, alliance: 'UNATCO', at: [-700, 700, 48] },
  { name: 'Bum1', chain: ['BumMale', 'HumanCivilian', 'ScriptedPawn', 'Pawn', 'Actor'], alliance: 'Bums', at: [0, 0, 48] },
  { name: 'Chief', chain: ['UNATCOChief', 'HumanMilitary', 'ScriptedPawn', 'Pawn', 'Actor'], alliance: 'UNATCO', at: [0, 100, 48] },
  { name: 'BtnAll', chain: ['Button1', 'DeusExDecoration', 'Decoration', 'Actor'], at: [-300, -1016, 64] }] };
const q = (v) => `"${v}"`;
function setRule(id, when, every, acts, more = {}) {
  const props = { Tag: `UCLW_${id}`, When: when, Rule: q(id), Every: q(every), Label: q(when), bSteps: 'True', Again: 'each', ...more };
  acts.forEach((a, i) => { props[`Act(${i})`] = q(a); props[`ActId(${i})`] = q(`a${i + 1}`); });
  return { cls: 'UCRule', name: `UCLink_${id}`, props };
}
const RULES = [
  setRule('S1', 'findsbody', 'class:UNATCOTroop', ['0|message||S1 a body||', '0|count||P9_Bodies|1|']),
  setRule('S2', 'sees', 'faction:UNATCO', ['0|message||S2 seen||']),
  setRule('S3', 'killed', 'class:UNATCOTroop', ['0|message||S3 killed||']),
  setRule('S4', 'knockedout', 'class:UNATCOTroop', ['0|message||S4 out||']),
  setRule('S5', 'turnshostile', 'names:Guard3', ['0|message||S5 hostile||']),
  setRule('S6', 'hurt', 'faction:UNATCO', ['0|message||S6 hurt||', '0|stand|@it|||'], { EveryArg: '50' }),
  { cls: 'UCRule', name: 'UCLink_S7', props: { Tag: 'UCL_BtnAll', When: 'used', Rule: q('S7'), Source: q('BtnAll'), Label: q('used'),
    bSteps: 'True', 'Act(0)': q('0|hostile|||||every|class:UNATCOTroop|Troopers'), 'ActId(0)': q('a1') } },
];
const open = () => createSession({ actors: RULES, outputs: logic.outputs, world, map: 'M' });
// the log's lines without the map and the time stamp of a UCRule's id ("S2@0.99" -> "S2")
const lines = (s) => s.log().map(({ line }) => line.split('|').filter((f, i) => i !== 1).join('|').replace(/@[\d.]+/, ''));
const since = (s, n) => lines(s).slice(n);

test('the first look takes how things are; then each member that comes to see the player starts a run, the player its @by', () => {
  const s = open();
  s.fire({ thing: 'Guard1', output: 'sees' });           // before the first look: taken as how it is
  s.run(0.6);
  assert.deepEqual(lines(s), []);
  s.run(0.5);                                             // it does not see the player any more
  s.fire({ thing: 'Guard2', output: 'sees' });
  s.fire({ thing: 'Chief', output: 'sees' });             // a faction: a chief too
  s.fire({ thing: 'Bum1', output: 'sees' });              // not of the faction
  s.run(0.6);
  assert.deepEqual(lines(s).filter((l) => l.startsWith('fire')), ['fire|S2|Guard2|sees|JC|sees', 'fire|S2|Chief|sees|JC|sees']);
  assert.equal(lines(s).filter((l) => l === 'act|S2#a1|message||S2 seen').length, 2, 'a run each (Again each)');
});

test('killed or knocked out: noticed on the next Tick, @it the member, the other rule "skip how"', () => {
  const s = open();
  s.run(0.6);                                             // the members taken
  s.fire({ thing: 'Guard1', output: 'killed' });
  s.run(0.2);
  assert.deepEqual(lines(s), ['fire|S3|Guard1|killed||killed', 'act|S3#a1|message||S3 killed', 'skip|S4|how|knockedout|Guard1']);
  const n = lines(s).length;
  s.fire({ thing: 'Guard2', output: 'knockedout' });
  s.fire({ thing: 'Guard1', output: 'killed' });           // gone already: no second time
  s.run(0.2);
  assert.deepEqual(since(s, n), ['skip|S3|how|killed|Guard2', 'fire|S4|Guard2|knockedout||knockedout', 'act|S4#a1|message||S4 out']);
});

test('hurt below 50%: once for each member, no @by; its step on @it', () => {
  const s = open();
  s.run(0.6);
  s.fire({ thing: 'Guard2', output: 'hurt' });
  s.run(0.6);
  assert.deepEqual(lines(s), ['fire|S6|Guard2|hurt||hurt', 'act|S6#a1|message||S6 hurt', 'act|S6#a2|stand|Guard2|']);
  const n = lines(s).length;
  s.fire({ thing: 'Guard2', output: 'hurt' });             // below already: not again
  s.run(1);
  assert.deepEqual(since(s, n), []);
});

test('a step on every one of a kind: each living one; a rule that makes one hostile is seen by "turns hostile"', () => {
  const s = open();
  s.run(0.6);
  s.fire({ thing: 'Guard1', output: 'killed' });
  s.run(0.2);
  const n = lines(s).length;
  s.fire({ thing: 'BtnAll', output: 'used' });
  s.run(0.6);
  assert.deepEqual(since(s, n), ['fire|S7|BtnAll|used|JC|used', 'act|S7#a1|hostile|every Troopers', 'act|S7#a1|hostile|Guard2|',
    'act|S7#a1|hostile|Guard3|', 'fire|S5|Guard3|turnshostile|JC|turnshostile', 'act|S5#a1|message||S5 hostile']);
  const m = lines(s).length;
  s.run(2);
  assert.deepEqual(since(s, m), [], 'hostile it stays: once');
});

test('finds a body: at the look after, the member its @it; Try it\'s buttons are the members there now', () => {
  const s = open();
  s.run(0.6);
  s.fire({ thing: 'Guard3', output: 'findsbody' });
  s.run(0.6);
  assert.deepEqual(lines(s), ['fire|S1|Guard3|findsbody||findsbody', 'act|S1#a1|message||S1 a body', 'act|S1#a2|count||P9_Bodies']);
  assert.equal(s.state().counters.P9_Bodies, 1);
  s.fire({ thing: 'Guard2', output: 'killed' });
  s.run(0.2);
  const buttons = s.happenings().filter((h) => h.output === 'killed').map((h) => h.thing);
  assert.deepEqual(buttons, ['Guard1', 'Guard3'], 'a member gone down is no button');
  assert.ok(s.happenings().some((h) => h.thing === 'Chief' && h.output === 'sees' && h.rules.includes('S2')));
  assert.ok(!s.happenings().some((h) => h.thing === 'Bum1'));
});
