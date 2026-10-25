// The logic log read back as sentences (static/logic-log.js) and the page's condition model (static/conditions.js):
// what the game writes (UCLink.Report, UCScript) and what the editor writes (conditions.py encode) agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLogicLine, logicSentence, decodeCondition } from '../editor/static/logic-log.js';
import { conditionText, conditionProblem, newCondition, kindOf } from '../editor/static/conditions.js';
import { conditionProblems, collectDraftStates } from '../editor/static/story-state.js';

const text = (e) => logicSentence(e).parts.map((p) => (typeof p === 'string' ? p : p.rule || p.name)).join('');

test('a rule that runs: its label, who set it off, links to the rule and the object', () => {
  const e = parseLogicLine('DeusEdixLogic: fire|01_Crypt|L3|Button1|used|JCDenton0|When JC uses Button1: open Door3');
  assert.deepEqual(e, { kind: 'fire', map: '01_Crypt', rule: 'L3', source: 'Button1', when: 'used', by: 'JCDenton0',
    label: 'When JC uses Button1: open Door3' });
  const s = logicSentence(e);
  assert.equal(s.mark, '▶');
  assert.deepEqual(s.parts.filter((p) => typeof p !== 'string'), [{ rule: 'L3' }, { name: 'JCDenton0' }]);
});

test('a label keeps its bars, a map built before rules had ids names the actor', () => {
  assert.equal(parseLogicLine('DeusEdixLogic: fire|M|L1|B|used||a | b').label, 'a | b');
  assert.equal(parseLogicLine('DeusEdixLogic: skip|M|UCLink_L7|once|').rule, 'L7');
});

test('why a rule did not run, conditions in words', () => {
  assert.match(text(parseLogicLine('DeusEdixLogic: skip|M|L2|cond|item|DeusEx.Multitool|1')), /only if JC carries Multitool/);
  assert.match(text(parseLogicLine('DeusEdixLogic: skip|M|L2|cond|count|Levers|>=|3')), /the counter Levers is at least 3/);
  assert.match(text(parseLogicLine('DeusEdixLogic: skip|M|L2|once|')), /runs only once/);
  assert.match(text(parseLogicLine('DeusEdixLogic: hook|M|L2|Pad1|noslot')), /no free slot/);
});

test('actions, failures, scripts', () => {
  assert.equal(text(parseLogicLine('DeusEdixLogic: act|M|L1|open|Door3')), '  open Door3');
  assert.equal(text(parseLogicLine('DeusEdixLogic: act|M|L1|lightoff|area light')), '  lightoff area light');
  assert.equal(text(parseLogicLine('DeusEdixLogic: act|M|L2|message||Press counted')), '  message "Press counted"');   // what it says
  assert.match(text(parseLogicLine('DeusEdixLogic: fail|M|L1|open|Door3|missing')), /Door3: it is not in the map/);
  assert.match(text(parseLogicLine('DeusEdixLogic: input|M|Gen0|Start|Seconds=4;Mode=red')), /Gen0: input Start \(Seconds=4, Mode=red\)/);
  assert.match(text(parseLogicLine('DeusEdixLogic: output|M|Gen0|Done|1')), /Gen0 says Done \(1 rule\)/);
  assert.match(text(parseLogicLine('DeusEdixLogic: noinput|M|Gen0|Stop')), /has no input Stop/);
});

test('failures of the bug hunt of 25 Oct: no name, no floor, an output lost, a sound is not an object', () => {
  assert.match(text(parseLogicLine('DeusEdixLogic: fail|M|L1|count||noname')), /count : the counter has no name/);
  assert.match(text(parseLogicLine('DeusEdixLogic: fail|M|L1|flag||noname')), /flag : no state chosen/);
  assert.match(text(parseLogicLine('DeusEdixLogic: fail|M|L1|goal||noname')), /goal : the goal has no name/);
  assert.match(text(parseLogicLine('DeusEdixLogic: fail|M|L1|floor|Lift0|nofloor')), /Lift0: it has no such floor/);
  assert.match(text(parseLogicLine('DeusEdixLogic: fail|M||output|Gen0|full')), /more than 8 outputs/);
  const sound = logicSentence(parseLogicLine('DeusEdixLogic: fail|M|L1|sound|Ambient.Hum|nosound'));
  assert.ok(sound.parts.includes('Ambient.Hum'));                       // plain text: nothing to select in the map
  assert.ok(!sound.parts.some((p) => typeof p === 'object' && p.name === 'Ambient.Hum'));
});

test('other lines are not the logic log', () => {
  assert.equal(parseLogicLine('ScriptLog: fire|M|L1'), null);
  assert.equal(parseLogicLine('DeusEdixLogic: weather|M'), null);
});

test('every condition the editor encodes comes back as itself', () => {
  // the strings of conditions.py encode() (tests/test_logic_rules.py checks that side)
  const pairs = [['flag|Crypt_Gen|0', { flag: 'Crypt_Gen', is: false }], ['item|DeusEx.Multitool|1', { type: 'item', item: 'DeusEx.Multitool', has: true }],
    ['alive|Guard1|1', { type: 'alive', actor: 'Guard1', is: true }], ['skill|SkillLockpicking|2', { type: 'skill', skill: 'SkillLockpicking', level: 2 }],
    ['count|Levers|>=|3', { type: 'counter', counter: 'Levers', op: '>=', value: 3 }], ['credits|<|100', { type: 'credits', op: '<', value: 100 }]];
  for (const [s, c] of pairs) assert.deepEqual(decodeCondition(s), c, s);
  assert.equal(decodeCondition('weather|rain'), null);
});

test('the sentences and the problems of each kind', () => {
  assert.equal(conditionText({ type: 'alive', actor: 'Guard1', is: false }, { actor: (n) => `the guard ${n}` }), 'the guard Guard1 is not alive');
  assert.equal(conditionText({ type: 'skill', skill: 'SkillLockpicking', level: 3 }), "JC's Lockpicking skill is at least Master");
  assert.equal(conditionText({ type: 'credits', op: '>=', value: 50 }), 'JC has at least 50 credits');
  for (const kind of ['flag', 'item', 'alive', 'skill', 'counter', 'credits']) assert.equal(kindOf(newCondition(kind)), kind);
  assert.equal(conditionProblem(newCondition('item')), 'choose the item');
  assert.equal(conditionProblem(newCondition('skill')), '');
});

test('a line named after an Object property is not read as one of ours', () => {
  for (const kind of ['constructor', 'toString', '__proto__']) assert.equal(parseLogicLine(`DeusEdixLogic: ${kind}|x`), null);
});

test("the Story's Apply accepts an event's new conditions, and says what an unfinished one lacks", () => {
  const story = { events: [{ title: 'Vault', requires: [{ type: 'item', item: 'DeusEx.Multitool' }, { type: 'counter', counter: 'Levers', op: '>=', value: 3 },
    { flag: 'Ok' }, { type: 'alive', actor: '' }] }] };
  assert.deepEqual(conditionProblems(story), ['Event "Vault" · Condition 4: choose the character.']);
});

test('the Story indexes the counters and the states the rules use', () => {
  const links = [{ id: 'L1', label: 'press', requires: [{ type: 'counter', counter: 'Levers', op: '>=', value: 2 }, { flag: 'Gen' }],
    do: [{ verb: 'count', a: 'Levers', b: '1' }] }];
  const found = Object.fromEntries(collectDraftStates({}, 'M', { playedFlag: () => '', heardFlag: () => '' }, links).map((e) => [e.flag, e]));
  assert.equal(found.Levers.type, 'int');
  assert.deepEqual(found.Levers.uses.map((u) => u.kind).sort(), ['read', 'write']);
  assert.equal(found.Gen.type, 'bool');
});
