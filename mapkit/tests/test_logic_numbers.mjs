// P9 slice 5 on the page: whole-number formulas of counters ("Alarms + 1") in a counter change, an amount (skill
// points, credits, health, energy) and a compared value (logic-numbers.js, the same as formula.py: the shared cases in
// tests/fixtures/formulas.json). Never run: read into the game's tokens, worked out on a stack. Their sentences, the
// form's fields, the logic log, and Try it (logic-sim.js) as UCEditorStory.NumberOf works them out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gameNumber, evaluate, formulaText, valueText, isFormula, formulaProblem, valueNow } from '../editor/static/logic-numbers.js';
import { conditionText, conditionHolds, conditionProblem } from '../editor/static/conditions.js';
import { vocabulary } from '../editor/static/logic-vocab.js';
import { argRowsHtml } from '../editor/static/logic-rule-ui.js';
import { createSession } from '../editor/static/logic-sim.js';
import { decodeCondition, parseLogicLine, logicSentence, LOGIC_TAG } from '../editor/static/logic-log.js';
import { partsText } from '../editor/static/console-lines.js';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const CASES = JSON.parse(readFileSync(new URL('./fixtures/formulas.json', import.meta.url), 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);
const counter = (n) => CASES.counters[n] ?? 0;

test('the shared cases: what the game reads, what it works out, the text again (formula.py gives the same)', () => {
  for (const [typed, game, value, text] of CASES.good) {
    assert.equal(gameNumber(typed), game, typed);
    assert.equal(evaluate(game, counter, CASES.value), value, typed);
    assert.equal(formulaText(game), text, typed);
  }
  for (const [typed, problem] of CASES.bad) {
    assert.ok(isFormula(typed), typed);
    assert.equal(formulaProblem(typed), problem, typed);
    assert.equal(gameNumber(typed, 7), '7', 'a bad one takes the default');
  }
  for (const [game, value] of CASES.worked) assert.equal(evaluate(game, counter, CASES.value), value, game);
});

test('a plain number is no formula; a name is', () => {
  for (const v of ['3', ' -2 ', '2.5', '2,5', '1e3', '']) assert.equal(isFormula(v), false, v);
  for (const v of ['Alarms', 'Infinity', 'a+1', '- 3']) assert.equal(isFormula(v), true, v);
  assert.equal(valueText('Alarms+1'), 'Alarms + 1');
  assert.equal(valueText(4), '4');
  assert.equal(valueNow('Coins * 2', counter), 20);
});

test('conditions: a counter compared with a counter or a formula, the player\'s numbers too', () => {
  const c = { type: 'counter', counter: 'Alarms', op: '>=', value: 'Guards + 1' };
  assert.equal(conditionText(c), 'the counter Alarms is at least Guards + 1');
  assert.equal(conditionText({ type: 'credits', op: '<', value: 'Price*2' }), 'the player has less than Price * 2 credits');
  const game = { counter: (n) => ({ Alarms: 4, Guards: 3, Price: 60 })[n] ?? 0, credits: 100 };
  assert.equal(conditionHolds(c, game), true);
  assert.equal(conditionHolds({ ...c, value: 'Guards + 2' }, game), false);
  assert.equal(conditionHolds({ type: 'credits', op: '<', value: 'Price * 2' }, game), true);
  assert.equal(conditionProblem({ ...c, value: 'Guards +' }), 'the formula: the formula stops too soon');
  assert.equal(conditionProblem(c), '');
  // the game's string read back (the logic log, Why not?)
  assert.deepEqual(decodeCondition('count|Alarms|>=|=@Guards,1,+'), { type: 'counter', counter: 'Alarms', op: '>=', value: 'Guards + 1' });
  assert.deepEqual(decodeCondition('health|<|=@Low'), { type: 'health', op: '<', value: 'Low' });
  assert.deepEqual(decodeCondition('count|Alarms|>=|3').value, 3);
});

test('the sentences and the form of an amount', () => {
  const v = vocabulary(logic);
  const ctx = { name: (n) => n, family: () => '' };
  assert.equal(v.actText({ verb: 'count', a: 'Score', b: 'Kills*10' }, ctx), 'add Kills * 10 to the counter Score');
  assert.equal(v.actText({ verb: 'count', a: 'Score', b: 'Kills', c: 'set' }, ctx), 'set the counter Score to Kills');
  assert.equal(v.actText({ verb: 'credits', a: 'Bonus + 5' }, ctx), 'give the player Bonus + 5 credits');
  assert.equal(v.actText({ verb: 'credits', a: '-30' }, ctx), 'take 30 credits', 'a number as before');
  const h = { esc, name: (n) => n };
  const plain = argRowsHtml(logic.inputs.credits.args, { a: '100' }, 0, h);
  assert.match(plain, /type="number"[^>]*data-k="a"/);
  assert.match(plain, /data-lkfx="0"/, 'a button makes it a formula');
  const typed = argRowsHtml(logic.inputs.credits.args, { a: 'Bonus + 5' }, 0, h);
  assert.match(typed, /type="text"[^>]*data-k="a" value="Bonus \+ 5"/);
  assert.doesNotMatch(typed, /data-lkfx/);
  assert.doesNotMatch(argRowsHtml(logic.inputs.floor.args, { a: '1' }, 0, h), /data-lkfx/, 'only the amounts that take one');
  for (const [verb, arg] of [['count', 'b'], ['skillpoints', 'a'], ['credits', 'a'], ['health', 'a'], ['energy', 'a']]) {
    assert.equal(logic.inputs[verb].args.find((a) => a.id === arg).formula, true, verb);
  }
});

// rules on "a saved game is loaded" doing the steps as links.py writes them (tests/test_logic_numbers.py)
const q = (v) => `"${v}"`;
const rule = (id, acts, cond = []) => ({ cls: 'UCRule', name: 'UCLink_' + id,
  props: { Tag: 'UCLW_' + id, When: 'loaded', Rule: q(id), ...Object.fromEntries(acts.map((a, i) => [`Act(${i})`, q(a)])),
    ...Object.fromEntries(cond.map((c, i) => [`Cond(${i})`, q(c)])) } });
// a rule that runs when its condition becomes true (UCLink.TickWatch reads Holds every look)
const becomes = (id, watch, text) => ({ cls: 'UCLink', name: 'UCLink_' + id,
  props: { Tag: 'UCLW_' + id, When: 'becomes', Rule: q(id), Watch: q(watch), 'Act(0)': q(`0|message||${text}||`) } });
const world = { player: 'JC', actors: [] };

test('Try it: the amounts worked out with the counters when the step runs, the conditions compared with them', () => {
  const s = createSession({ actors: [
    rule('N', ['0|count||Alarms|4|set', '0|count||Total|=@Alarms,1,+|set', '0|count||Total|=@Alarms,~|', '0|credits||=@Alarms,10,*||',
      '0|energy||=@Alarms,20,*,~||', '0|count||Zero|=5,@Nothing,/|set']),
    becomes('Y', 'count|Alarms|==|=@Total,3,+', 'yes'),
    becomes('X', 'count|Alarms|>|=@Total,3,+', 'no'),
  ], outputs: logic.outputs, world, map: 'M' });
  s.run(1);
  s.fire({ thing: '', output: 'loaded' });
  s.run(1);
  const st = s.state();
  assert.equal(st.counters.Alarms, 4);
  assert.equal(st.counters.Total, 1, '4 + 1, then 4 taken');
  assert.equal(st.counters.Zero, 0, 'a division by 0 gives 0');
  assert.equal(st.energy, 20);
  const said = s.log().map(({ line }) => line);
  assert.ok(said.some((l) => /^act\|[^|]*\|Y\|message\|\|yes$/.test(l)), said.join('\n'));
  assert.ok(!said.some((l) => /\|X\|message/.test(l)));
});

test('the logic log says a formula as it was written', () => {
  const e = parseLogicLine(`${LOGIC_TAG}act|M|R|credits||=@Alarms,10,*`);
  assert.match(partsText(logicSentence(e).parts), /"Alarms \* 10"/);
});
