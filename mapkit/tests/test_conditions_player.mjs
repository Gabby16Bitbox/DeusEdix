// P9 slice 2 on the page: the player's own conditions (static/conditions.js): health, energy, skill points, an
// augmentation, in water, in a zone, things of a kind. The strings are conditions.py's (tests/test_conditions_player.py
// writes the same), read back as the game reads them (UCEditorStory.Holds); a rule set off when one becomes true says
// it in the player's words (comesText); Try it (logic-sim.js) keeps the player's state, offers each such condition the
// rules ask about with a button that makes it so, and judges the rules by it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { conditionHolds, conditionText, comesText, conditionProblem, newCondition, CONDITION_KINDS } from '../editor/static/conditions.js';
import { decodeCondition } from '../editor/static/logic-log.js';
import { negate } from '../editor/static/action-list.js';
import { PLAYER_CAUSES } from '../editor/static/logic-rule-ui.js';
import { createSession } from '../editor/static/logic-sim.js';

const CASES = [
  [{ type: 'health', op: '<', value: 30 }, 'health|<|30'],
  [{ type: 'energy', op: '<', value: 20 }, 'energy|<|20'],
  [{ type: 'skillpoints', op: '>=', value: 2000 }, 'skillpoints|>=|2000'],
  [{ type: 'aug', aug: 'AugSpeed', how: 'has', is: true }, 'aug|AugSpeed|has|0|1'],
  [{ type: 'aug', aug: 'AugSpeed', how: 'on', is: true }, 'aug|AugSpeed|on|0|1'],
  [{ type: 'aug', aug: 'AugVision', how: 'level', level: 3, is: false }, 'aug|AugVision|level|3|0'],
  [{ type: 'water', is: true }, 'water|1'],
  [{ type: 'zone', zone: 'UCZone_Pool', is: false }, 'zone|UCZone_Pool|0'],
  [{ type: 'items', item: 'DeusEx.DeusExWeapon', op: '>=', value: 1 }, 'items|DeusEx.DeusExWeapon|>=|1'],
];

test('the strings conditions.py writes come back as the same conditions', () => {
  for (const [c, written] of CASES) assert.deepEqual(decodeCondition(written), c, written);
  // a new one is ready, but for what must be chosen (a zone, as a state, an item, a character, a counter)
  for (const [kind] of CONDITION_KINDS) if (!['flag', 'item', 'alive', 'counter', 'zone'].includes(kind)) assert.equal(conditionProblem(newCondition(kind)), '', kind);
  assert.equal(conditionProblem(newCondition('zone')), 'choose the zone');
  assert.equal(conditionProblem({ type: 'aug', aug: 'AugSpeed', how: 'level', level: 0 }), 'choose a level from 1 to 4');
});

test('the sentences: a check, and a cause that comes true', () => {
  const names = { zone: (n) => (n === 'UCZone_Pool' ? 'Pool (water)' : n) };
  const said = CASES.map(([c]) => [conditionText(c, names), comesText(c, names)]);
  assert.deepEqual(said, [
    ["the player's health is less than 30", "the player's health falls below 30"],
    ["the player's energy is less than 20", "the player's energy falls below 20"],
    ['the player has at least 2000 skill points', "the player's skill points reach 2000"],
    ['the player has Speed Enhancement', 'the player gets Speed Enhancement'],
    ["the player's Speed Enhancement is on", 'the player turns on Speed Enhancement'],
    ["the player's Vision Enhancement is below level 3", "the player's Vision Enhancement drops below level 3"],
    ['the player is in water', 'the player enters water'],
    ['the player is not in Pool (water)', 'the player leaves Pool (water)'],
    ['the player carries at least one weapon', 'the player gets a weapon'],
  ]);
  assert.equal(comesText({ type: 'items', item: 'DeusEx.MedKit', op: '>=', value: 3 }), 'the player has at least 3 med kits');
  assert.equal(comesText({ type: 'credits', op: '>=', value: 500 }), "the player's credits reach 500");
  assert.equal(conditionText({ type: 'items', item: 'DeusEx.DeusExAmmo', op: '<', value: 1 }), 'the player carries less than one box of ammunition');
  assert.equal(conditionText({ type: 'items', item: 'DeusEx.Flare', op: '==', value: 2 }, { item: () => 'Flare' }), 'the player carries exactly 2 × Flare');
  assert.equal(comesText({ flag: 'Alarm', is: true }), null, 'a state: "... becomes true" as before');
  assert.equal(comesText({ type: 'zone', zone: 'UCZone_Pool', is: true }), 'the player enters Pool (water)', 'a pool, with no names given');
  assert.equal(conditionText({ type: 'zone', zone: 'ZoneInfo2', is: true }), 'the player is in ZoneInfo2');
  // every one the "+ When..." menu makes says itself
  for (const [, , watch] of PLAYER_CAUSES) assert.ok(comesText(watch), JSON.stringify(watch));
});

test("judged as the game judges them: an augmentation had, on, at a level; things of a kind counted", () => {
  const g = { aug: (n) => ({ AugSpeed: { has: true, on: false, level: 2 } })[n] || null, countOf: (cls) => (cls === 'DeusEx.MedKit' ? 3 : 0) };
  const aug = (how, extra = {}) => conditionHolds({ type: 'aug', aug: 'AugSpeed', how, is: true, ...extra }, g);
  assert.deepEqual([aug('has'), aug('on'), aug('level', { level: 2 }), aug('level', { level: 3 })], [true, false, true, false]);
  assert.equal(conditionHolds({ type: 'aug', aug: 'AugCloak', how: 'on', is: false }, g), true, 'not had: not on');
  assert.equal(conditionHolds({ type: 'items', item: 'DeusEx.MedKit', op: '>=', value: 3 }, g), true);
  assert.equal(conditionHolds({ type: 'items', item: 'DeusEx.MedKit', op: '>', value: 3 }, g), false);
  assert.equal(conditionHolds({ type: 'zone', zone: 'POOL', is: true }, { zone: 'pool' }), true, 'any case, as the game');
  for (const [c] of CASES) assert.notEqual(conditionHolds(negate(c), g), conditionHolds(c, g), `${JSON.stringify(c)} and its opposite`);
});

// what links.py makes of three rules (tests/test_conditions_player.py): the player's energy falls below 20, Speed
// Enhancement turned on, Button1 used with at least 2 weapons carried
const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const q = (v) => `"${v}"`;
const RULES = [
  { cls: 'UCLink', name: 'UCLink_P1', props: { Tag: 'UCLW_P1', When: 'becomes', Rule: q('P1'), Watch: q('energy|<|20'), 'Act(0)': q('0|message||low energy||') } },
  { cls: 'UCLink', name: 'UCLink_P2', props: { Tag: 'UCLW_P2', When: 'becomes', Rule: q('P2'), Watch: q('aug|AugSpeed|on|0|1'), 'Act(0)': q('0|message||speed on||') } },
  { cls: 'UCLink', name: 'UCLink_P3', props: { Tag: 'UCL_Button1', When: 'used', Rule: q('P3'), Source: q('Button1'),
    'Cond(0)': q('items|DeusEx.DeusExWeapon|>=|2'), 'Act(0)': q('0|message||armed||') } },
];
const world = { player: 'JC', actors: [{ name: 'Button1', chain: ['Button1', 'DeusExDecoration', 'Decoration', 'Actor'], at: [0, 0, 0] },
  { name: 'Pistol1', chain: ['WeaponPistol', 'DeusExWeapon', 'Weapon', 'Inventory', 'Actor'], at: [100, 0, 0] }] };
const open = () => createSession({ actors: RULES, outputs: logic.outputs, world, map: 'M' });
const lines = (s) => s.log().map(({ line }) => line.split('|').filter((f, i) => i !== 1).join('|'));

test('Try it: the player starts with full health and energy, and each condition the rules ask about is a row', () => {
  const s = open();
  const st = s.state();
  assert.deepEqual([st.health, st.energy, st.skillpoints, st.water, st.zone, st.augs], [100, 100, 5000, false, '', {}]);
  assert.deepEqual(s.asks().map((p) => [p.text, p.rules, p.holds]),
    [['energy|<|20', ['P1'], false], ['aug|AugSpeed|on|0|1', ['P2'], false], ['items|DeusEx.DeusExWeapon|>=|2', ['P3'], false]]);
});

test('Try it: "Make it so" sets the player so, and the rule watching it runs at its next look', () => {
  const s = open();
  s.run(0.6);                                            // the first look: nothing holds
  s.makeAsk(0, true);
  assert.equal(s.state().energy, 19);
  s.run(0.6);
  assert.ok(lines(s).includes('act|P1|message||low energy'), lines(s).join('\n'));
  s.makeAsk(1, true);
  assert.deepEqual(s.state().augs, { augspeed: { has: true, on: true, level: 1 } });
  s.run(0.6);
  assert.ok(lines(s).includes('act|P2|message||speed on'));
  s.makeAsk(1, false);
  assert.equal(s.asks()[1].holds, false);
});

test('Try it: things of a kind are the class or one under it (an item of the map tells its chain)', () => {
  const s = open();
  s.set({ items: ['DeusEx.WeaponPistol'] });
  s.fire({ thing: 'Button1', output: 'used' });
  s.run(0.1);
  assert.ok(lines(s).some((l) => l.startsWith('skip|P3|cond')), 'one weapon: not enough');
  s.makeAsk(2, true);
  assert.equal(s.asks()[2].holds, true);
  assert.equal(s.state().items.filter((i) => i === 'DeusEx.DeusExWeapon').length, 2, 'the pistol taken away, two of the kind given');
  const n = s.log().length;
  s.fire({ thing: 'Button1', output: 'used' });
  s.run(0.1);
  assert.ok(lines(s).slice(n).includes('act|P3|message||armed'));
});
