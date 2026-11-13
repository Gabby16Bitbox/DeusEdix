// The Counter block of P3 (slice 6) in Try it (editor/static/logic-sim.js), as the game plays it (project-template
// UCBCounter.uc): Add / Take / Reset change its number, kept in a counter (StateName, else the block's name); it says
// Changed, Reached at its goal and Lost under it; the rules on them see the new number; "starts again" goes back to 0;
// a rule changing the counter itself moves the block at its next look; at the start it takes the counter's number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../editor/static/logic-sim.js';
import { parseLogicLine, logicSentence, LOGIC_TAG } from '../editor/static/logic-log.js';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const deco = ['Button1', 'DeusExDecoration', 'Decoration', 'Actor'];
const block = (name, settings = {}) => ({ name, chain: ['UCBCounter', 'UCBlock', 'UCScript', 'Actor'], at: [0, 0, 0], block: settings });
const things = (...more) => ({ player: 'JCDentonMale0', actors: [
  { name: 'Button1', chain: deco, at: [0, 0, 0] }, { name: 'Button2', chain: deco, at: [50, 0, 0] },
  { name: 'Button3', chain: deco, at: [90, 0, 0] }, ...more] });
const q = (v) => `"${v}"`;
function rule(id, src, when, acts, more = {}) {
  const props = { Tag: `UCL_${src}`, When: when, Rule: q(id), Source: q(src), ...more };
  acts.forEach((a, i) => { props[`Act(${i})`] = q(a); });
  return { cls: 'UCLink', name: `UCLink_${id}`, props };
}
const onPort = (id, src, port, acts, more = {}) => rule(id, src, 'output', acts, { Tag: `UCLW_${id}`, Port: q(port), ...more });
const open = (actors, world, start = {}) => createSession({ actors, outputs: logic.outputs, world, start, map: 'M' });
const lines = (s) => s.log().map(({ line }) => line.split('|').filter((f, i) => i !== 1).join('|'));
const press = (s, thing) => { s.fire({ thing, output: 'used' }); s.run(0.3); };
const said = (s) => lines(s).filter((l) => l.startsWith('act|') && l.includes('|message|')).map((l) => l.split('|').pop());
const values = (s, n) => lines(s).filter((l) => l.startsWith(`value|${n}|`)).map((l) => l.split('|').pop());

test('Counter: Add counts up to its goal, says Changed each time and Reached once; the counter keeps the number', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|Kills|Add||']),
    onPort('P1', 'Kills', 'Reached', ['0|message||three||']), onPort('P2', 'Kills', 'Changed', ['0|message||changed||'])],
  things(block('Kills')));
  for (let k = 0; k < 4; k++) press(s, 'Button1');
  // (the rules of one output and the next run in their own order in a tick: count them)
  assert.equal(said(s).filter((m) => m === 'changed').length, 4);
  assert.equal(said(s).filter((m) => m === 'three').length, 1);
  assert.deepEqual(values(s, 'Kills'), ['count 0/3', 'count 1/3', 'count 2/3', 'count 3/3', 'count 4/3']);
  assert.equal(s.state().counters.Kills, 4, 'no StateName: the counter is named as the block');
});

test('Counter: the rules on Reached see the new number (no off-by-one)', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|C1|Add||']),
    onPort('P1', 'C1', 'Reached', ['0|message||seen 2||'], { 'Cond(0)': q('count|Hits|>=|2') })],
  things(block('C1', { goal: '2', statename: 'Hits' })));
  press(s, 'Button1');
  press(s, 'Button1');
  assert.deepEqual(said(s), ['seen 2']);
  assert.equal(s.state().counters.Hits, 2);
});

test('Counter: Take goes back under the goal (Lost) and never under 0; Reset sets it to 0', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|C1|Add||']), rule('L2', 'Button2', 'used', ['0|input|C1|Take||']),
    rule('L3', 'Button3', 'used', ['0|input|C1|Reset||']),
    onPort('P1', 'C1', 'Reached', ['0|message||reached||']), onPort('P2', 'C1', 'Lost', ['0|message||lost||'])],
  things(block('C1', { goal: '2' })));
  press(s, 'Button1');
  press(s, 'Button1');
  press(s, 'Button2');
  assert.deepEqual(said(s), ['reached', 'lost']);
  press(s, 'Button1');
  press(s, 'Button3');
  assert.deepEqual(said(s), ['reached', 'lost', 'reached', 'lost']);
  press(s, 'Button2');                                  // at 0: nothing
  assert.deepEqual(values(s, 'C1'), ['count 0/2', 'count 1/2', 'count 2/2', 'count 1/2', 'count 2/2', 'count 0/2']);
});

test('Counter: "starts again" goes back to 0 at its goal, so it says Reached every N', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|C1|Add||']), onPort('P1', 'C1', 'Reached', ['0|message||again||'])],
    things(block('C1', { goal: '2', again: true })));
  for (let k = 0; k < 5; k++) press(s, 'Button1');
  assert.deepEqual(said(s), ['again', 'again']);
  assert.equal(s.state().counters.C1, 1);
});

test('Counter: a rule that changes its counter moves it at its next look; at the start it takes the number there', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|count||Score|5|']),
    onPort('P1', 'C1', 'Reached', ['0|message||five||'])],
  things(block('C1', { goal: '5', statename: 'Score' })));
  s.run(0.6);
  press(s, 'Button1');
  s.run(0.6);
  assert.deepEqual(said(s), ['five']);
  assert.equal(s.state().blocks.C1.count, 5);
  // a counter another map left at 2: it starts there, saying nothing
  const t = open([onPort('P1', 'C1', 'Changed', ['0|message||WRONG||'])], things(block('C1', { goal: '3', statename: 'Score' })), { counters: { Score: 2 } });
  t.run(0.6);
  assert.deepEqual(said(t), []);
  assert.deepEqual(values(t, 'C1'), ['count 2/3']);
});

test('Counter: Goal 0 only counts; the log says the number in words', () => {
  const s = open([rule('L1', 'Button1', 'used', ['0|input|C1|Add||']), onPort('P1', 'C1', 'Reached', ['0|message||WRONG||'])],
    things(block('C1', { goal: '0' })));
  press(s, 'Button1');
  assert.deepEqual(said(s), []);
  assert.deepEqual(values(s, 'C1'), ['count 0', 'count 1']);
  const words = (text) => logicSentence(parseLogicLine(`${LOGIC_TAG}value|M|C1|${text}`)).parts.map((p) => (typeof p === 'string' ? p : p.name)).join('');
  assert.match(words('count 1'), /count: 1$/);
  assert.match(words('count 2/3'), /count: 2 of 3$/);
});

test('Counter: a "while" on its goal says from when it gets there until it goes back under it', async () => {
  const { vocabulary } = await import('../editor/static/logic-vocab.js');
  const vocab = vocabulary(logic);
  const labels = { 'output:Reached': 'it gets to its goal', 'output:Lost': 'it goes back under its goal' };
  const ctx = { name: (n) => n, family: () => 'counterblock', word: () => '', portLabel: (n, key) => labels[key] || key };
  const l = { id: 'L1', src: 'Kills', when: 'output', port: 'Reached', while: true, do: [] };
  assert.equal(vocab.whenText(l, ctx), 'From when Kills says "it gets to its goal" until it says "it goes back under its goal"');
  assert.match(vocab.whenText({ ...l, while: false }, ctx), /^When Kills says "it gets to its goal"$/);
  assert.match(vocab.whenText({ ...l, port: 'Changed' }, ctx), /^When /, 'nothing ends it: a plain When');
});

test('a rule kept to some phases says which (13 Nov 2026, Deep Ops: "only in some phases")', () => {
  const said = (names) => logicSentence({ kind: 'skip', why: 'phase', detail: 'DeepOp|3,4', rule: 'L4' }, names).parts
    .filter((p) => typeof p === 'string').join('').trim();
  assert.equal(said({ phaseNames: () => ['Infiltrate', 'Alarm', 'Extract', 'Done'] }), 'did not run: it works only in Extract or Done of DeepOp, not in the phase now');
  assert.equal(said({}), 'did not run: it works only in some phases, and this is not one of them');
});
