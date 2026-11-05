// The page's twin of the game's UCEditorStory.Holds (static/conditions.js conditionHolds): every kind of condition
// judged as the game judges it, from what the game reads. The Logic simulator (logic-sim.js) judges rules with it;
// the Story's Play-test (story-sim.js) knows states only and must agree with it on them. A Yes or No is read as the
// game gets it everywhere: in Holds, in the page's sentence and fields, and in the Play-test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { conditionHolds, conditionText, mountConditions, newCondition, CONDITION_KINDS, OPS } from '../editor/static/conditions.js';
import { decodeCondition } from '../editor/static/logic-log.js';
import { holds as storyHolds } from '../editor/static/story-sim.js';

// the game as Holds reads it: states, counters, the player's items, credits and skills, who is alive
const game = ({ flags = {}, counters = {}, items = [], alive = [], skills = {}, credits = 0 } = {}) => ({
  flag: (n) => !!flags[n], counter: (n) => counters[n] || 0, carries: (cls) => items.includes(cls), alive: (n) => alive.includes(n),
  skill: (n) => skills[n] ?? 0, credits });
// [the page's value of a Yes or No, the digit conditions.py _yes writes for it (test_logic_compile.py checks it),
// which Holds reads]: 0, null, '', an empty list or object are No, as Python takes them
const WRITTEN = [[true, '1'], [false, '0'], [1, '1'], [0, '0'], [null, '0'], ['', '0'], ['no', '1'], [[], '0'], [{}, '0'],
  [undefined, '1']];
// each kind with a Yes or No, holding `value`: [the page's condition, its key, the string the game gets]
const yesNoKinds = (value, digit) => [[{ flag: 'Alarm', is: value }, 'is', `flag|Alarm|${digit}`],
  [{ type: 'item', item: 'DeusEx.Lockpick', has: value }, 'has', `item|DeusEx.Lockpick|${digit}`],
  [{ type: 'alive', actor: 'Guard2', is: value }, 'is', `alive|Guard2|${digit}`]];

test('a state: Yes or No as asked, and a state never set is No', () => {
  const g = game({ flags: { Power: true, Alarm: false } });
  assert.equal(conditionHolds({ flag: 'Power', is: true }, g), true);
  assert.equal(conditionHolds({ flag: 'Power', is: false }, g), false);
  assert.equal(conditionHolds({ flag: 'Alarm', is: false }, g), true);
  assert.equal(conditionHolds({ flag: 'Never', is: true }, g), false);
  assert.equal(conditionHolds({ flag: 'Never', is: false }, g), true);
  assert.equal(conditionHolds({ flag: 'Power' }, g), true, 'no "is": Yes, as the editor writes it (conditions.py _yes)');
});

test('the player carries an item, or does not', () => {
  const g = game({ items: ['DeusEx.Multitool'] });
  assert.equal(conditionHolds({ type: 'item', item: 'DeusEx.Multitool', has: true }, g), true);
  assert.equal(conditionHolds({ type: 'item', item: 'DeusEx.Multitool', has: false }, g), false);
  assert.equal(conditionHolds({ type: 'item', item: 'DeusEx.Lockpick', has: false }, g), true);
  assert.equal(conditionHolds({ type: 'item', item: 'DeusEx.Lockpick', has: true }, g), false);
});

test('a character is alive (not killed, not knocked out, still there), or not', () => {
  const g = game({ alive: ['Guard1'] });
  assert.equal(conditionHolds({ type: 'alive', actor: 'Guard1', is: true }, g), true);
  assert.equal(conditionHolds({ type: 'alive', actor: 'Guard1', is: false }, g), false);
  assert.equal(conditionHolds({ type: 'alive', actor: 'Guard2', is: false }, g), true);
  assert.equal(conditionHolds({ type: 'alive', actor: 'Guard2', is: true }, g), false);
});

test("the player's skill is at least the level; a skill the game does not know (-1) never is", () => {
  const g = game({ skills: { SkillLockpicking: 2 } });
  assert.equal(conditionHolds({ type: 'skill', skill: 'SkillLockpicking', level: 2 }, g), true);
  assert.equal(conditionHolds({ type: 'skill', skill: 'SkillLockpicking', level: 3 }, g), false);
  assert.equal(conditionHolds({ type: 'skill', skill: 'SkillTech', level: 1 }, g), false, 'untrained');
  assert.equal(conditionHolds({ type: 'skill', skill: 'SkillNone', level: 0 }, { skill: () => -1 }), false);
});

test("a counter and the player's credits, with each comparison as the game's Compare makes it", () => {
  // [value, op, number, holds]: each op on both sides of its edge
  const table = [[2, '<', 3, true], [3, '<', 3, false], [3, '<=', 3, true], [4, '<=', 3, false], [3, '==', 3, true], [2, '==', 3, false],
    [2, '!=', 3, true], [3, '!=', 3, false], [3, '>=', 3, true], [2, '>=', 3, false], [4, '>', 3, true], [3, '>', 3, false]];
  assert.deepEqual([...new Set(table.map((r) => r[1]))].sort(), OPS.map((o) => o[0]).sort(), 'every comparison the editor offers');
  for (const [value, op, n, yes] of table) {
    assert.equal(conditionHolds({ type: 'counter', counter: 'Levers', op, value: n }, game({ counters: { Levers: value } })), yes, `${value} ${op} ${n}`);
    assert.equal(conditionHolds({ type: 'credits', op, value: n }, game({ credits: value })), yes, `credits ${value} ${op} ${n}`);
  }
  assert.equal(conditionHolds({ type: 'counter', counter: 'Levers', op: '=>', value: 0 }, game()), false, 'an op the game does not know');
});

test("numbers read as the game's int(): a fraction cut, not a number 0", () => {
  assert.equal(conditionHolds({ type: 'counter', counter: 'C', op: '==', value: 2.9 }, game({ counters: { C: 2 } })), true);
  assert.equal(conditionHolds({ type: 'counter', counter: 'C', op: '==', value: 'x' }, game()), true);
  assert.equal(conditionHolds({ type: 'skill', skill: 'SkillTech', level: 1.7 }, game({ skills: { SkillTech: 1 } })), true);
});

test('what the game cannot read is nothing set; a kind it does not know never holds', () => {
  assert.equal(conditionHolds({ flag: 'Power', is: false }, {}), true);
  assert.equal(conditionHolds({ type: 'item', item: 'DeusEx.Multitool', has: false }, {}), true);
  assert.equal(conditionHolds({ type: 'alive', actor: 'Guard1', is: true }, {}), false, 'nobody is alive');
  assert.equal(conditionHolds({ type: 'counter', counter: 'C', op: '==', value: 0 }, {}), true);
  assert.equal(conditionHolds({ type: 'credits', op: '<', value: 1 }, {}), true);
  assert.equal(conditionHolds({ type: 'weather', is: true }, game()), false);
});

test('every kind the editor offers has its twin, in the page\'s form and in the game\'s string alike', () => {
  const g = game({ flags: { F: true }, items: ['DeusEx.Multitool'], alive: ['Guard1'], skills: { SkillLockpicking: 1 }, counters: { C: 1 },
    credits: 100 });
  const filled = { flag: { flag: 'F', is: true }, item: { type: 'item', item: 'DeusEx.Multitool', has: true },
    alive: { type: 'alive', actor: 'Guard1', is: true }, skill: newCondition('skill'), counter: { ...newCondition('counter'), counter: 'C' },
    credits: newCondition('credits') };
  const encoded = { flag: 'flag|F|1', item: 'item|DeusEx.Multitool|1', alive: 'alive|Guard1|1', skill: 'skill|SkillLockpicking|1',
    counter: 'count|C|>=|1', credits: 'credits|>=|100' };
  for (const [kind] of CONDITION_KINDS) {
    assert.equal(conditionHolds(filled[kind], g), true, kind);
    assert.equal(conditionHolds(decodeCondition(encoded[kind]), g), true, `${kind}, as UCLink.Cond holds it`);
    assert.equal(conditionHolds(filled[kind], game()), false, `${kind}, with nothing set`);
  }
});

test("a Yes or No as the game gets it: what conditions.py writes 0 for (0, null, '', an empty list) is No", () => {
  for (const [value, digit] of WRITTEN) {
    for (const [c, , written] of yesNoKinds(value, digit)) {
      assert.equal(conditionHolds(c, game()), conditionHolds(decodeCondition(written), game()), `${String(value)}: written ${written}`);
    }
  }
});

// a list of conditions shown by mountConditions on a stand-in host: its markup, and the values the state field is given
function mounted(list) {
  const none = { querySelector: () => none, querySelectorAll: () => [] };
  const host = { innerHTML: '', querySelector: () => none, querySelectorAll: () => [] }, states = [];
  mountConditions(host, list, { change() {}, mountState: (el, value) => states.push(value) });
  return { html: host.innerHTML, states };
}
// the digit a row's Yes / No shows: a state's in its state field, the others' in their own select
function rowShows(c, key) {
  const { html, states } = mounted([c]);
  if ('flag' in c) return states[0].is ? '1' : '0';
  const select = new RegExp(`<select data-cf="${key}">(.*?)</select>`).exec(html)[1];
  return /<option value="(\d)" selected>/.exec(select)[1];
}

test("the page says the Yes or No the game reads: a condition's sentence, the state's words and the row's fields", () => {
  for (const [value, digit] of WRITTEN) {
    for (const [c, key, written] of yesNoKinds(value, digit)) {
      const what = `${String(value)}: written ${written}`;
      assert.equal(conditionText(c), conditionText(decodeCondition(written)), what);
      assert.equal(rowShows(c, key), digit, `${what}, its row`);
    }
    assert.equal(conditionText({ flag: 'Alarm', is: value }, { state: (c) => c.is }), digit === '1',
      `${String(value)}: the page's state words`);
  }
});

test("the Story's Play-test judges states the same", () => {
  for (const flags of [{}, { A: true }, { A: false, B: true }, { A: true, B: true }]) {
    for (const c of [{ flag: 'A', is: true }, { flag: 'A', is: false }, { flag: 'B' }]) {
      assert.equal(storyHolds([c], flags), conditionHolds(c, game({ flags })), `${JSON.stringify(c)} with ${JSON.stringify(flags)}`);
    }
  }
});

test("the Story's Play-test reads a Yes or No as the game gets it too: 0, null or '' is No", () => {
  for (const [value] of WRITTEN) {
    for (const flags of [{}, { A: true }]) {
      const c = { flag: 'A', is: value };
      assert.equal(storyHolds([c], flags), conditionHolds(c, game({ flags })), `${String(value)} with ${JSON.stringify(flags)}`);
    }
  }
});
