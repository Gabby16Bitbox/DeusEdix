// "Why didn't it run?" from the game's own log of the last Play (static/logic-sim.js whyFromLog): the lines the game
// wrote for a map, read with the compiled logic as Try it's own answer reads its session (explain), said without the
// times the game's UCLink lines do not have, and without Try it's State panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession, whyFromLog } from '../editor/static/logic-sim.js';
import { vocabulary } from '../editor/static/logic-vocab.js';

const kit = new URL('../', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, kit), 'utf8'));
const logic = read('editor/config/logic.json');
const { cases } = read('tests/logic_sim_cases.json');
const vocab = vocabulary(logic);

// the case "why" played in the simulator as test_logic_sim.mjs plays it: its log is what the game would write
function played() {
  const s = createSession({ ...cases.why, outputs: logic.outputs, map: 'M', vocab });
  for (const [t, thing] of [[1, 'Button1'], [1.5, 'Lever1'], [2, 'Button2'], [3, 'Button2'], [3, 'Button1'], [4, 'Lever1']]) {
    s.scrub(t);
    s.fire({ thing, output: 'used' });
  }
  s.scrub(4.5);
  return s.log().map((l) => l.line);
}
const fromLog = (lines, more = {}) => whyFromLog({ ...cases.why, outputs: logic.outputs, map: 'M', vocab, lines, ...more });

test('the last Play, rule by rule: the same reasons as Try it, with no times and no State panel', () => {
  const w = fromLog(played());
  const why = (id) => w.why(id).map((x) => `${x.why}: ${x.text}`);
  assert.deepEqual(why('L1'), ['cond: It heard it, but "Power is Yes" did not hold. Only L2 sets Power to Yes, and it had not done it by then.']);
  assert.deepEqual(why('L3'), ['cond: It heard it, but "the counter Levers is at least 2" did not hold. L4 had changed the counter Levers 1 time by then: not enough.']);
  assert.deepEqual(why('L5'), ['cond: It heard it, but "the player carries Multitool" did not hold. That is up to the game and the player.']);
  assert.deepEqual(why('L9'), ['cond: It heard it, but "Nobody is Yes" did not hold. No rule sets Nobody to Yes (the Story or the game may).']);
  assert.deepEqual(why('L6'), ['running: It was still doing its actions (they take 3 s) when it was set off again: a rule that is running ignores that.',
    'fired: It ran once.'], 'nothing of what it does now: the game is not here');
  assert.deepEqual(why('L13'), ['once: It had already run and runs only once: it was refused 1 time after.', 'fired: It ran once.']);
  assert.deepEqual(why('L7'), ['hook: L7 Ghost1 is not in the map: the rule never runs.']);
  assert.deepEqual(why('L8'), ['never: "When the player comes within 256 units of Crate1" never happened in the last Play. It is looked at every half second, '
    + 'and the first look only notes what is already so: it has to become so after.']);
  assert.deepEqual(why('L10'), ['left: L10 is not in the game: its object is deleted.']);
  assert.deepEqual(why('L11'), ['fired: It ran 2 times.', 'fail: An action of it failed: hide Crate9: it is not in the map.']);
  assert.deepEqual(why('L99'), ['unknown: There is no rule L99 in the compiled logic: rebuild it, or check its id.']);
  assert.ok(w.rules.includes('L1') && !w.rules.includes('L99'));
});

test("only this map's lines count, and a Play that never set a rule off says so", () => {
  const other = played().map((l) => l.replace(/^(\w+)\|M\|/, '$1|Other|'));
  const w = fromLog(other);
  assert.equal(w.lines.length, 0);
  assert.match(w.why('L1')[0].text, /^"When the player uses Button1" never happened in the last Play\.$/);
  const start = cases.why.actors.find((a) => /^"?L12"?$/.test((a.props || {}).Rule || ''));
  assert.ok(start, 'L12 waits for the map to start');
  assert.match(w.why('L12')[0].text, /^It wrote nothing when the map started/);
});

test("the Logic runtime v2's lines: their times, the other reasons, an Otherwise, a phase's block", () => {
  const w = fromLog(['fire|M|L1@2.50|Button1|used|JCDentonMale0|', 'skip|M|L1@4.25|cooldown|', 'skip|M|L1@5.00|cooldown|',
    'else|M|L3@6.00|Button1|used|JCDentonMale0', 'skip|M|L5|phase|Alarm|2']);
  const texts = (id) => w.why(id).map((x) => x.text);
  assert.deepEqual(texts('L1'), ['It did not run at 5 s: too soon after its last run (2 times).', 'It ran once, the last at 2.5 s.']);
  assert.deepEqual(texts('L3'), ['It heard it at 6 s, but its conditions did not hold: its Otherwise ran.']);
  assert.deepEqual(texts('L5'), ['It did not run: it works only in some phases, and this is not one of them.']);
  assert.deepEqual(w.why('L1').map((x) => x.t), [5, 2.5]);
});

test("a state a Phases block keeps is said as the block's, with the phase it was at (the game's own lines)", () => {
  const actors = [{ cls: 'UCLink', name: 'UCLink3', props: { Rule: '"D_check_open"', When: 'used', Source: 'BtnCheck', Tag: 'UCL_BtnCheck',
    'Cond(0)': '"flag|Gate1_Open|1"', 'Act(0)': '"0|message||D: the check says Open"' } }];
  const world = { player: 'JCDentonMale0', actors: [{ name: 'BtnCheck', chain: ['Button1'] },
    { name: 'UCEdit0', chain: ['UCBPhases', 'UCBlock', 'UCScript'], block: { statename: 'Gate1', phases: ['Closed', 'Open'] } }] };
  const lines = ['value|23_Door_Phases|UCEdit0|Closed', 'skip|23_Door_Phases|D_check_open|cond|flag|Gate1_Open|1',
    'value|23_Door_Phases|UCEdit0|Open', 'fire|23_Door_Phases|D_check_open|BtnCheck|used|JCDentonMale0|open?'];
  const w = whyFromLog({ actors, outputs: logic.outputs, world, map: '23_Door_Phases', lines, vocab,
    ctx: { name: (n) => ({ UCEdit0: 'Phases', BtnCheck: 'Button 1' })[n] || n } });
  assert.deepEqual(w.why('D_check_open').map((x) => x.text), [
    'It heard it, but "Gate1_Open is Yes" did not hold. Phases keeps it: it is Yes while it is at the phase "Open", and it was at "Closed" then.',
    'It ran once.']);
});
