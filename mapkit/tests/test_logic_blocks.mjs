// The logic blocks and the signals of P3 in Try it (editor/static/logic-sim.js), as the game plays them
// (project-template UCBAllOf.uc, UCBGate.uc, UCBSwitch.uc, UCLink.DoMore "signal"): an All of these counts each object
// once (a rule on none: the rule), takes a tick back, starts again; a Gate lets through or stops; a Switch picks in turn, in order (then "no
// more ways") or at random by weight; a signal sets off every rule waiting for it. The compiled actors are what
// links.py makes (tests/test_logic_blocks.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../editor/static/logic-sim.js';
import { parseLogicLine, logicSentence, LOGIC_TAG } from '../editor/static/logic-log.js';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const deco = ['Button1', 'DeusExDecoration', 'Decoration', 'Actor'];
const block = (name, cls, settings = {}) => ({ name, chain: [cls, 'UCBlock', 'UCScript', 'Actor'], at: [0, 0, 0], block: settings });
const things = (...more) => ({ player: 'JCDentonMale0', actors: [
  { name: 'Button1', chain: deco, at: [0, 0, 0] }, { name: 'Button2', chain: deco, at: [50, 0, 0] },
  { name: 'Button3', chain: deco, at: [90, 0, 0] }, ...more] });
const q = (v) => `"${v}"`;
// a rule (UCLink) on an object's output, its actions "delay|verb|target|a|b|c"
function rule(id, src, when, acts, more = {}) {
  const props = { Tag: `UCL_${src}`, When: when, Rule: q(id), Source: q(src), ...more };
  acts.forEach((a, i) => { props[`Act(${i})`] = q(a); });
  return { cls: 'UCLink', name: `UCLink_${id}`, props };
}
// a rule on a block's output (a script's port)
const onPort = (id, src, port, acts) => rule(id, src, 'output', acts, { Tag: `UCLW_${id}`, Port: q(port) });
const open = (actors, world) => createSession({ actors, outputs: logic.outputs, world, map: 'M' });
const lines = (s) => s.log().map(({ line }) => line.split('|').filter((f, i) => i !== 1).join('|'));
const press = (s, thing) => { s.fire({ thing, output: 'used' }); s.run(0.3); };
const said = (s) => lines(s).filter((l) => l.startsWith('act|') && l.includes('|message|')).map((l) => l.split('|').pop());

test('All of these: each object counts once, then Done; the log shows the count', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|All1|Add||']), rule('L2', 'Button2', 'used', ['0|input|All1|Add||']),
    onPort('L3', 'All1', 'Done', ['0|message||Both||'])], things(block('All1', 'UCBAllOf')));
  press(s, 'Button1');
  press(s, 'Button1');                         // the same object again: still 1 of 2
  assert.deepEqual(said(s), []);
  press(s, 'Button2');
  assert.deepEqual(said(s), ['Both']);
  const values = lines(s).filter((l) => l.startsWith('value|')).map((l) => l.split('|').pop());
  assert.deepEqual(values, ['0/2', '1/2', '2/2']);
  assert.equal(s.state().blocks.All1.done, true);
  // done: more ticks change nothing (until Reset)
  press(s, 'Button1');
  assert.deepEqual(said(s), ['Both']);
});

test('All of these: one takes back only its own tick, Need overrides the count', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|All1|Add||']), rule('L2', 'Button2', 'used', ['0|input|All1|Add||']),
    rule('L4', 'Button3', 'used', ['0|input|All1|TakeBack||']),
    rule('L5', 'Button3', 'used', ['0|input|All1|Add||']),
    onPort('L3', 'All1', 'Done', ['0|message||Done||']), onPort('L6', 'All1', 'Undone', ['0|message||Undone||'])],
  things(block('All1', 'UCBAllOf', { need: '2' })));
  press(s, 'Button1');
  press(s, 'Button2');
  assert.deepEqual(said(s), ['Done']);
  // Button3: L4 takes back a tick it never gave (nothing), L5 cannot add (done)
  press(s, 'Button3');
  assert.deepEqual(said(s), ['Done']);
  assert.equal(s.state().blocks.All1.need, 2, 'Need 2, not the 3 objects that tick it off');
});

test('All of these: an object takes its own tick back (a plate stepped on, then off)', () => {
  const plate = { name: 'Plate1', chain: ['UCTriggerBox', 'Trigger', 'Triggers', 'Actor'], at: [0, 200, 0] };
  const s = open([rule('L1', 'Plate1', 'enter', ['0|input|All1|Add||']), rule('L2', 'Button2', 'used', ['0|input|All1|Add||']),
    rule('L4', 'Plate1', 'leave', ['0|input|All1|TakeBack||']),               // another rule on the same object
    onPort('L3', 'All1', 'Done', ['0|message||Done||']), onPort('L6', 'All1', 'Undone', ['0|message||Undone||'])],
  things(block('All1', 'UCBAllOf'), plate));
  s.fire({ thing: 'Plate1', output: 'enter' });
  s.run(0.3);
  press(s, 'Button2');
  s.fire({ thing: 'Plate1', output: 'leave' });
  s.run(0.3);
  assert.deepEqual(said(s), ['Done', 'Undone']);
  assert.deepEqual(s.state().blocks.All1.ticked, ['Button2']);
  assert.equal(s.state().blocks.All1.need, 2, 'two objects tick it off');
});

test('All of these: a rule on no object counts as itself (a signal, the start)', () => {
  const s = open([rule('L1', '', 'signal', ['0|input|All1|Add||'], { Tag: 'UCS_A', Source: undefined }),
    rule('L2', '', 'signal', ['0|input|All1|Add||'], { Tag: 'UCS_B', Source: undefined }),
    rule('L5', 'Button1', 'used', ['0|signal||A||']), rule('L6', 'Button2', 'used', ['0|signal||B||']),
    onPort('L3', 'All1', 'Done', ['0|message||Done||'])], things(block('All1', 'UCBAllOf')));
  press(s, 'Button1');
  press(s, 'Button1');
  assert.deepEqual(said(s), []);
  press(s, 'Button2');
  assert.deepEqual(said(s), ['Done']);
  assert.deepEqual(s.state().blocks.All1.ticked, ['L1', 'L2']);
});

test('All of these: Reset empties it, and it can be done again', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|All1|Add||']), rule('L2', 'Button2', 'used', ['0|input|All1|Reset||']),
    onPort('L3', 'All1', 'Done', ['0|message||Done||'])], things(block('All1', 'UCBAllOf', { need: '1' })));
  press(s, 'Button1');
  press(s, 'Button2');
  assert.deepEqual(s.state().blocks.All1.ticked, []);
  press(s, 'Button1');
  assert.deepEqual(said(s), ['Done', 'Done']);
  assert.ok(lines(s).includes('value|All1|0/1'));
});

test('All of these, starts again when done: each round says Done', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|All1|Add||']), rule('L2', 'Button2', 'used', ['0|input|All1|Add||']),
    onPort('L3', 'All1', 'Done', ['0|message||Round||'])], things(block('All1', 'UCBAllOf', { again: true })));
  for (let k = 0; k < 2; k++) { press(s, 'Button1'); press(s, 'Button2'); }
  assert.deepEqual(said(s), ['Round', 'Round']);
});

test('Gate: open lets through, closed stops; open, close and toggle', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|Gate1|Pass||']), rule('L2', 'Button2', 'used', ['0|input|Gate1|Toggle||']),
    onPort('L3', 'Gate1', 'Out', ['0|message||Through||']), onPort('L4', 'Gate1', 'Blocked', ['0|message||Stopped||'])],
  things(block('Gate1', 'UCBGate', { closed: true })));
  press(s, 'Button1');
  press(s, 'Button2');
  press(s, 'Button1');
  press(s, 'Button2');
  press(s, 'Button1');
  assert.deepEqual(said(s), ['Stopped', 'Through', 'Stopped']);
  const values = lines(s).filter((l) => l.startsWith('value|')).map((l) => l.split('|').pop());
  assert.deepEqual(values, ['closed', 'open', 'closed']);
});

test('Switch in turn: 1, 2, 3, then 1 again; a flip-flop with two ways', () => {
  const ports = (b, n) => Array.from({ length: n }, (_, k) => onPort(`P${b}${k + 1}`, b, `Out${k + 1}`, [`0|message||${b}:${k + 1}||`]));
  const s = open([rule('L1', 'Button1', 'used', ['0|input|Sw1|Next||']), rule('L2', 'Button2', 'used', ['0|input|Flip1|Next||']),
    ...ports('Sw1', 3), ...ports('Flip1', 2)], things(block('Sw1', 'UCBSwitch', { choices: '3' }), block('Flip1', 'UCBSwitch', {})));
  for (let k = 0; k < 4; k++) press(s, 'Button1');
  for (let k = 0; k < 3; k++) press(s, 'Button2');
  assert.deepEqual(said(s), ['Sw1:1', 'Sw1:2', 'Sw1:3', 'Sw1:1', 'Flip1:1', 'Flip1:2', 'Flip1:1']);
});

test('Switch in order: 1 to the last once, then "has no more ways"; Reset starts it again', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|Sw1|Next||']), rule('L2', 'Button2', 'used', ['0|input|Sw1|Reset||']),
    onPort('P1', 'Sw1', 'Out1', ['0|message||1||']), onPort('P2', 'Sw1', 'Out2', ['0|message||2||']),
    onPort('P3', 'Sw1', 'Over', ['0|message||over||'])], things(block('Sw1', 'UCBSwitch', { mode: 'In order' })));
  for (let k = 0; k < 3; k++) press(s, 'Button1');
  press(s, 'Button2');
  press(s, 'Button1');
  assert.deepEqual(said(s), ['1', '2', 'over', '1']);
});

test('Switch at random: a way of weight 0 is never picked; the picks are the same on a replay', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|Sw1|Next||']),
    ...[1, 2, 3].map((k) => onPort(`P${k}`, 'Sw1', `Out${k}`, [`0|message||${k}||`]))],
  things(block('Sw1', 'UCBSwitch', { choices: '3', mode: 'At random', weights: '1,0,3' })));
  for (let k = 0; k < 40; k++) press(s, 'Button1');
  const picks = said(s);
  assert.equal(picks.length, 40);
  assert.ok(!picks.includes('2'), 'weight 0');
  assert.ok(picks.filter((p) => p === '3').length > picks.filter((p) => p === '1').length, 'weight 3 more often than 1');
  s.restart();
  for (let k = 0; k < 40; k++) press(s, 'Button1');
  assert.deepEqual(said(s), picks);
});

test('a block called on an input it does not have says so (noinput)', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|Gate1|Next||'])], things(block('Gate1', 'UCBGate')));
  press(s, 'Button1');
  assert.ok(lines(s).includes('noinput|Gate1|Next'));
});

test('a signal sets off every rule waiting for it; one with no name says so', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|signal||Alarm||']),
    rule('L2', '', 'signal', ['0|message||Heard||'], { Tag: 'UCS_Alarm', Source: undefined }),
    rule('L3', '', 'signal', ['0|message||Also||'], { Tag: 'UCS_Alarm', Source: undefined }),
    rule('L4', '', 'signal', ['0|message||Other||'], { Tag: 'UCS_Other', Source: undefined }),
    rule('L5', 'Button2', 'used', ['0|signal||||'])], things());
  press(s, 'Button1');
  assert.deepEqual(said(s), ['Heard', 'Also']);
  const fire = lines(s).find((l) => l.startsWith('fire|L2|'));
  assert.equal(fire.split('|')[4], 'UCLink_L1', 'set off by the rule that sent it');
  press(s, 'Button2');
  assert.ok(lines(s).includes('fail|L5|signal||noname'));
});

test('the log says a block\'s value in words', () => {
  const words = (line) => logicSentence(parseLogicLine(LOGIC_TAG + line)).parts.map((p) => (typeof p === 'string' ? p : p.name)).join('');
  assert.equal(words('value|M|All1|2/3'), 'All1: 2 of 3 done');
  assert.equal(words('value|M|Gate1|closed'), 'Gate1: closed');
  assert.equal(words('value|M|Sw1|picked 2'), 'Sw1: picked way 2');
  assert.equal(words('value|M|Sw1|next 1'), 'Sw1: way 1 next');
  assert.equal(words('value|M|Sw1|over'), 'Sw1: no more ways');
});

test('Try it offers a signal by its name, and never a logic block\'s outputs (the block says them itself)', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|Gate1|Pass||']), onPort('L3', 'Gate1', 'Out', ['0|message||Through||']),
    rule('L2', '', 'signal', ['0|message||Heard||'], { Tag: 'UCS_Alarm', Source: undefined })], things(block('Gate1', 'UCBGate')));
  const hs = s.happenings();
  assert.deepEqual(hs.map((h) => [h.thing, h.output, h.signal]), [['Button1', 'used', undefined], ['UCS_Alarm', 'signal', 'Alarm']]);
});

// ---------------------------------------------------------------- P3 slice 2: Phases, At least N, First of
const values = (s, n) => lines(s).filter((l) => l.startsWith(`value|${n}|`)).map((l) => l.split('|').pop());

test('Phases: the map starts in the first phase, kept in the flags; Go to / Next say leaves, enters, changed', () => {
  const ph = block('Ph1', 'UCBPhases', { phases: ['Arrive', 'Alarm', 'Escape'], statename: '' });
  const s = open([rule('L1', 'Button1', 'used', ['0|input|Ph1|GoTo_Escape||']), rule('L2', 'Button2', 'used', ['0|input|Ph1|Next||']),
    rule('L3', 'Button3', 'used', ['0|input|Ph1|GoTo_Nowhere||']),
    onPort('P1', 'Ph1', 'Leave_Arrive', ['0|message||left Arrive||']), onPort('P2', 'Ph1', 'Enter_Escape', ['0|message||in Escape||']),
    onPort('P3', 'Ph1', 'Changed', ['0|message||changed||']), onPort('P4', 'Ph1', 'Enter_Arrive', ['0|message||WRONG||'])],
  things(ph));
  s.run(0.3);
  assert.deepEqual(said(s), [], 'the first phase at the start says nothing');
  assert.equal(s.state().counters.Phase, 1);
  assert.equal(s.state().flags.Phase_Arrive, true);
  assert.equal(s.state().flags.Phase_Escape, false);
  press(s, 'Button1');
  assert.deepEqual(said(s), ['left Arrive', 'in Escape', 'changed']);
  assert.equal(s.state().counters.Phase, 3);
  assert.equal(s.state().flags.Phase_Arrive, false);
  assert.equal(s.state().flags.Phase_Escape, true);
  press(s, 'Button2');                         // past the last: nothing
  press(s, 'Button1');                         // the phase it is in: nothing
  assert.equal(said(s).length, 3);
  press(s, 'Button3');
  assert.ok(lines(s).includes('fail|Ph1|phase|Nowhere|nophase'), lines(s).join('\n'));
  assert.deepEqual(values(s, 'Ph1'), ['Arrive', 'Escape']);
});

test('Phases: its own flag name, and a phase name made as the game makes it', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|Ph1|GoTo_2nd floor||']), rule('L2', 'Button2', 'used', ['0|input|Ph1|Previous||']),
    onPort('P1', 'Ph1', 'Enter_X_2nd_floor', ['0|message||up||'])],
  things(block('Ph1', 'UCBPhases', { phases: 'Lobby, 2nd floor', statename: 'Tower' })));
  press(s, 'Button1');
  assert.deepEqual(said(s), ['up']);
  assert.equal(s.state().counters.Tower, 2);
  assert.equal(s.state().flags.Tower_X_2nd_floor, true);
  press(s, 'Button2');
  assert.equal(s.state().flags.Tower_Lobby, true);
});

test('At least N: it looks at its states, says Reached and Lost, and keeps a state of its own', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|flag||Valve1|1|']), rule('L2', 'Button2', 'used', ['0|flag||Valve2|1|']),
    rule('L3', 'Button3', 'used', ['0|flag||Valve1|0|']),
    onPort('P1', 'Some1', 'Reached', ['0|message||enough||']), onPort('P2', 'Some1', 'Lost', ['0|message||not enough||'])],
  things(block('Some1', 'UCBAtLeast', { states: 'Valve1, Valve2, Valve3', need: '2', statename: 'Pressure' })));
  s.run(0.6);
  press(s, 'Button1');
  s.run(0.6);
  assert.deepEqual(said(s), []);
  press(s, 'Button2');
  s.run(0.6);
  assert.deepEqual(said(s), ['enough']);
  assert.equal(s.state().flags.Pressure, true);
  press(s, 'Button3');
  s.run(0.6);
  assert.deepEqual(said(s), ['enough', 'not enough']);
  assert.equal(s.state().flags.Pressure, false);
  assert.deepEqual(values(s, 'Some1'), ['0/2 hold', '1/2 hold', '2/2 hold', '1/2 hold']);
});

test('At least N: "!Name" counts while that state is No; Need 0 is all of them; the first look says nothing', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|flag||Seen|1|']),
    onPort('P1', 'All1', 'Reached', ['0|message||WRONG at the start||']), onPort('P2', 'All1', 'Lost', ['0|message||lost||'])],
  things(block('All1', 'UCBAtLeast', { states: '!Seen, !Heard' })));
  s.run(0.6);
  assert.deepEqual(said(s), [], 'both hold from the start: no Reached');
  assert.equal(s.state().blocks.All1.enough, true);
  press(s, 'Button1');
  s.run(0.6);
  assert.deepEqual(said(s), ['lost']);
});

test('First of: the first that comes says its way, the others are not heard until Reset', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|Race1|In2||']), rule('L2', 'Button2', 'used', ['0|input|Race1|In1||']),
    rule('L3', 'Button3', 'used', ['0|input|Race1|Reset||']),
    onPort('P1', 'Race1', 'First1', ['0|message||1 first||']), onPort('P2', 'Race1', 'First2', ['0|message||2 first||'])],
  things(block('Race1', 'UCBFirstOf', { choices: '2' })));
  press(s, 'Button1');
  press(s, 'Button2');
  assert.deepEqual(said(s), ['2 first']);
  press(s, 'Button3');
  press(s, 'Button2');
  assert.deepEqual(said(s), ['2 first', '1 first']);
  assert.deepEqual(values(s, 'Race1'), ['waiting', 'first 2', 'waiting', 'first 1']);
});

test('First of: the clock runs out first (TimedOut); a way past NumWays is not heard', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|Race1|Start||']), rule('L2', 'Button2', 'used', ['0|input|Race1|In3||']),
    rule('L3', 'Button3', 'used', ['0|input|Race1|In1||']),
    onPort('P1', 'Race1', 'TimedOut', ['0|message||too late||']), onPort('P2', 'Race1', 'First1', ['0|message||WRONG after the time||']),
    onPort('P3', 'Race1', 'First3', ['0|message||WRONG way 3||'])],
  things(block('Race1', 'UCBFirstOf', { choices: '2', timelimit: '2' })));
  press(s, 'Button1');
  press(s, 'Button2');                         // In3 with two ways: nothing
  assert.equal(s.state().blocks.Race1.over, false);
  s.runToNext();                               // the clock is what is due next
  assert.deepEqual(said(s), ['too late']);
  press(s, 'Button3');
  assert.deepEqual(said(s), ['too late']);
  assert.deepEqual(values(s, 'Race1'), ['waiting', 'clock 2', 'timed out']);
});

test('First of: the clock can start with the map', () => {
  const s = open([onPort('P1', 'Race1', 'TimedOut', ['0|message||too late||'])],
    things(block('Race1', 'UCBFirstOf', { timelimit: '1', clockatstart: true })));
  s.run(1.5);
  assert.deepEqual(said(s), ['too late']);
});

test('the log says the new blocks\' values in words', () => {
  const words = (line) => logicSentence(parseLogicLine(LOGIC_TAG + line)).parts.map((p) => (typeof p === 'string' ? p : p.name)).join('');
  assert.equal(words('value|M|Some1|1/2 hold'), 'Some1: 1 of 2 hold');
  assert.equal(words('value|M|Race1|clock 10'), 'Race1: the clock runs: 10 s');
  assert.equal(words('value|M|Race1|first 2'), 'Race1: 2 came first');
  assert.equal(words('value|M|Race1|timed out'), 'Race1: the time ran out');
  assert.equal(words('value|M|Ph1|Alarm'), 'Ph1: Alarm');
  assert.equal(words('fail|M|Ph1|phase|Nowhere|nophase'), '  phase Nowhere: it has no such phase');
});
