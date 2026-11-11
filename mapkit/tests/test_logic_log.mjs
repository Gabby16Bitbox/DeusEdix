// The logic log read back as sentences (static/logic-log.js) and the page's condition model (static/conditions.js):
// what the game writes (UCLink.Report, UCScript) and what the editor writes (conditions.py encode) agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLogicLine, logicSentence, decodeCondition, stateValueText } from '../editor/static/logic-log.js';
import { conditionText, conditionProblem, newCondition, kindOf } from '../editor/static/conditions.js';
import { conditionProblems, collectDraftStates } from '../editor/static/story-state.js';

const text = (e) => logicSentence(e).parts.map((p) => (typeof p === 'string' ? p : p.rule || p.name)).join('');

test('a rule that runs: its label, who set it off, links to the rule and the object', () => {
  const e = parseLogicLine('DeusEdixLogic: fire|01_Crypt|L3|Button1|used|JCDenton0|When the player uses Button1: open Door3');
  assert.deepEqual(e, { kind: 'fire', map: '01_Crypt', rule: 'L3', source: 'Button1', when: 'used', by: 'JCDenton0',
    label: 'When the player uses Button1: open Door3' });
  const s = logicSentence(e);
  assert.equal(s.mark, '▶');
  assert.deepEqual(s.parts.filter((p) => typeof p !== 'string'), [{ rule: 'L3' }, { name: 'JCDenton0' }]);
});

test('a watched state or counter (UCLogicHub, P5): where it starts, its changes, in words', () => {
  const first = parseLogicLine('DeusEdixLogic: state|01_Crypt|Met||false');
  assert.deepEqual(first, { kind: 'state', map: '01_Crypt', name: 'Met', old: '', new: 'false' });
  assert.equal(text(first), 'Met is No');
  assert.equal(logicSentence(first).mark, '◆');
  assert.equal(text(parseLogicLine('DeusEdixLogic: state|01_Crypt|Met|false|true')), 'Met: No → Yes');
  assert.equal(text(parseLogicLine('DeusEdixLogic: state|01_Crypt|Keys|2|3')), 'Keys: 2 → 3');
  assert.equal(text(parseLogicLine('DeusEdixLogic: state|01_Crypt|Keys||')), 'Keys is not set');
  assert.equal(text(parseLogicLine('DeusEdixLogic: state|01_Crypt|Keys|3|')), 'Keys: 3 → not set');
  assert.deepEqual(['true', 'false', '', '0', '-2'].map(stateValueText), ['Yes', 'No', 'not set', '0', '-2']);
});

test('a start value on the map\'s first visit (UCLogicHub, P5): set, or kept from before', () => {
  const set = parseLogicLine('DeusEdixLogic: start|01_Crypt|Keys|3|set');
  assert.deepEqual(set, { kind: 'start', map: '01_Crypt', name: 'Keys', value: '3', how: 'set' });
  assert.equal(text(set), 'Keys starts as 3');
  assert.equal(logicSentence(set).mark, '◆');
  assert.equal(text(parseLogicLine('DeusEdixLogic: start|01_Crypt|Met|true|set')), 'Met starts as Yes');
  assert.equal(text(parseLogicLine('DeusEdixLogic: start|01_Crypt|Met|false|kept')), 'Met keeps No: it was set before this map');
});

test('a label keeps its bars, a map built before rules had ids names the actor', () => {
  assert.equal(parseLogicLine('DeusEdixLogic: fire|M|L1|B|used||a | b').label, 'a | b');
  assert.equal(parseLogicLine('DeusEdixLogic: skip|M|UCLink_L7|once|').rule, 'L7');
});

test('why a rule did not run, conditions in words', () => {
  assert.match(text(parseLogicLine('DeusEdixLogic: skip|M|L2|cond|item|DeusEx.Multitool|1')), /only if the player carries Multitool/);
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
  assert.equal(conditionText({ type: 'skill', skill: 'SkillLockpicking', level: 3 }), "the player's Lockpicking skill is at least Master");
  assert.equal(conditionText({ type: 'credits', op: '>=', value: 50 }), 'the player has at least 50 credits');
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

test('a rule of the Logic runtime v2 names its game time and its step; its Otherwise, a spawn, the new reasons', () => {
  const e = parseLogicLine('DeusEdixLogic: act|Lab|L7@12.25#a3|message||Hi');
  assert.equal(e.rule, 'L7'); assert.equal(e.time, 12.25); assert.equal(e.at, 'a3'); assert.equal(e.verb, 'message');
  const f = parseLogicLine('DeusEdixLogic: fire|Lab|L7@3.50|Button1|used|JCDenton|Open it');
  assert.equal(f.rule, 'L7'); assert.equal(f.time, 3.5); assert.equal(f.at, undefined); assert.equal(f.label, 'Open it');
  const o = parseLogicLine('DeusEdixLogic: else|Lab|L7@4.00|Button1|used|JCDenton');
  assert.equal(o.kind, 'else'); assert.match(logicSentence(o).parts.join(''), /Otherwise/);
  const s = logicSentence(parseLogicLine('DeusEdixLogic: act|Lab|L8@9.00#a1|spawned|Reinf|3'));
  assert.equal(s.parts.join(''), '  3 came (Reinf)');
  const k = logicSentence(parseLogicLine('DeusEdixLogic: skip|Lab|L9@1.00|cooldown|2.5'));
  assert.match(k.parts.slice(2).join(''), /too soon/);
  const g = logicSentence(parseLogicLine('DeusEdixLogic: fail|Lab|L9@1.00#a2|giveitem|DeusEx.Nope|missing'));
  assert.ok(g.parts.includes('DeusEx.Nope')); assert.match(g.parts.join(''), /no such item/);
  assert.equal(parseLogicLine('DeusEdixLogic: fire|Lab|Old_Rule|B|used||x').rule, 'Old_Rule');   // a UCLink: as it was
});
