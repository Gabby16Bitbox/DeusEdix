// Patterns (P8 slice 2, editor/static/logic-patterns.js): a block of the Logic window as a pattern's version, its
// rules R1..., the map's objects they name as slots ({door}), the logic blocks the map added carried along, its ports
// and states. tests/test_logicpatterns.py tests how the project keeps them (editor/logicpatterns.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicIndex, logicGraph } from '../editor/static/logic-graph-model.js';
import { boxesOf, boxedRules, boxedView, selectionMembers } from '../editor/static/logic-boxes.js';
import { patternOf, patternWords, slotOf, slotText, expandInstances, instanceBoxes, nextInstanceId, fillSlots, versionChanges } from '../editor/static/logic-patterns.js';
import { readFileSync } from 'node:fs';
import { featureLab } from './logic_graph_world.mjs';

function labPattern(box) {
  const lab = featureLab();
  lab.edits.logic = { ...(lab.edits.logic || {}), boxes: [box] };
  const ix = logicIndex(lab), bl = boxesOf(ix.edits);
  const states = [...ix.states.values()].map((s) => ({ name: s.name, type: s.type, rules: [...s.setters, ...s.readers].map((u) => u.rule).filter(Boolean) }));
  const ports = boxedView(logicGraph(ix, { open: [...boxedRules(bl)] }), bl, box.id).ports;
  return { ix, p: patternOf({ edits: ix.edits, boxes: bl, id: box.id, actors: ix.actors, ports, states }) };
}

test('Feature Lab: a block of three rules as a pattern', () => {
  const { p } = labPattern({ id: 'X1', name: 'Presses', rules: ['L1', 'L2', 'L8'], pieces: [], parent: null, ports: { 'in:obj:UCEdit5|out:used': 'Pressed' } });
  assert.deepEqual(p.rules.map((r) => r.id), ['R1', 'R2', 'R3']);
  assert.ok(p.rules.every((r) => !('label' in r)));
  // the objects the rules name, in order, as slots; the rules say {slot} where they named them
  assert.deepEqual(p.slots, [{ id: 'object', words: 'the object', family: 'object', carried: false },
    { id: 'door', words: 'the door', family: 'door', carried: false }, { id: 'character', words: 'the character', family: 'character', carried: false }]);
  assert.deepEqual(p.was, { object: 'UCEdit5', door: 'UCEditBox7', character: 'UCEdit8' });
  assert.deepEqual(p.rules.map((r) => [r.src, ...r.do.map((x) => x.target || '')]), [['{object}', '{door}', '{character}'], ['{object}', '', ''], ['{object}', '{door}']]);
  assert.ok(!JSON.stringify(p.rules).includes('UCEdit'));
  // the counter stays a counter of its own name; its condition untouched
  assert.deepEqual(p.states, [{ name: 'Test_Presses', type: 'int' }]);
  assert.deepEqual(p.rules[2].requires, [{ type: 'counter', counter: 'Test_Presses', op: '>=', value: 3 }]);
  // the ports, with slots; only the name given kept
  assert.deepEqual(p.ports.map((x) => [x.key, x.side, x.name]), [['in:{object}|out:used', 'in', 'Pressed'], ['out:{door}|in:anim', 'out', null],
    ['out:{character}|in:goto', 'out', null], ['out:{door}|in:blow', 'out', null], ['out:state:Test_Presses', 'out', null]]);
  assert.equal(patternWords(p), '3 rules, 3 objects to choose (the object, the door, the character)');
});

test('a block with no rules is no pattern', () => {
  assert.throws(() => labPattern({ id: 'X1', name: 'Empty', rules: [], pieces: [], parent: null, ports: {} }), /no rules to save/);
});

test('a logic block the map added comes with the pattern; its "If not" rule and step ids follow the new ids', () => {
  const edits = {
    links: [
      { id: 'A_1', src: 'Btn01', when: 'used', do: [{ id: 'A_1_a1', verb: 'input', target: 'All1', a: 'Add' }], label: 'tick 1' },
      { id: 'A_done', src: 'All1', when: 'output:Done', do: [{ id: 'A_done_a1', verb: 'unlock', target: 'Gate1' }, { id: 'A_done_a2', verb: 'unlock', group: 'G1' }] },
      { id: 'A_not', otherwiseOf: 'A_done', src: 'All1', when: 'output:Done', do: [{ verb: 'message', a: 'no' }] },
      { id: 'Other', src: 'Btn09', when: 'used', do: [] }],
    added: [{ name: 'All1', cls: 'UCBAllOf', loc: [100, 200, 48], props: { Count: '2' } }, { name: 'Timer1', cls: 'UCTimer', loc: [164, 180, 48], props: {} }],
    logic: { groups: [{ id: 'G1', name: 'Gates', members: ['Gate1', 'Gate2'] }] },
  };
  const actors = { Btn01: { family: 'object' }, All1: { family: 'allof', word: 'All of these block' }, Timer1: { family: 'timer', word: 'timer' },
    Gate1: { family: 'door', word: 'door' }, Gate2: { family: 'door', word: 'door' }, Btn09: { family: 'object' }, 'grp:G1': { family: 'group' } };
  const boxes = [{ id: 'X1', name: 'Gate', rules: ['A_1', 'A_done', 'A_not'], pieces: ['obj:All1', 'grp:G1'], parent: null, ports: {} },
    { id: 'X2', name: 'Inner', rules: [], pieces: ['obj:Timer1'], parent: 'X1', ports: {} }];
  const p = patternOf({ edits, boxes, id: 'X1', actors });
  assert.deepEqual(p.rules.map((r) => [r.id, r.otherwiseOf || '', r.src, (r.do || []).map((x) => x.id || '')]),
    [['R1', '', '{object}', ['R1_a1']], ['R2', '', '{all_of_these_block}', ['R2_a1', 'R2_a2']], ['R3', 'R2', '{all_of_these_block}', ['']]]);
  assert.equal(p.rules[0].do[0].target, '{all_of_these_block}');
  assert.equal(p.rules[1].do[1].group, 'B1');                         // the group, its new id
  assert.deepEqual(p.pieces, [{ kind: 'groups', item: { id: 'B1', name: 'Gates', members: ['{door}', '{door2}'] } }]);
  // the logic blocks held (the inner block's too) are carried: where they are from the first one
  assert.deepEqual(p.objects, [{ slot: 'all_of_these_block', cls: 'UCBAllOf', props: { Count: '2' }, at: [0, 0, 0] },
    { slot: 'timer', cls: 'UCTimer', props: {}, at: [64, -20, 0] }]);
  assert.deepEqual(p.slots.map((s) => [s.id, s.words, s.family, s.carried]), [['object', 'the object', 'object', false],
    ['all_of_these_block', 'the All of these block', 'allof', true], ['door', 'the door', 'door', false], ['door2', 'the door', 'door', false],
    ['timer', 'the timer', 'timer', true]]);
  assert.equal(patternWords(p), '3 rules, 3 objects to choose (the object, the door, the door), 2 logic blocks it brings, 1 logic item');
  // ports: what comes from objects the pattern does not name is said by its inside end, once; the graph's nouns name slots
  const ports = [{ key: 'in:obj:Btn08|out:used', side: 'in', ends: ['obj:All1|in:input:Add'] },
    { key: 'in:obj:Btn07|out:used', side: 'in', ends: ['obj:All1|in:input:Add'] }, { key: 'in:obj:Btn01|out:used', side: 'in', ends: ['rule:A_1|cause:0'] },
    { key: 'out:rule:Far|cause:0', side: 'out', ends: ['obj:All1|out:output:Done'] },
    { key: 'out:obj:Gate1|in:unlock', side: 'out', ends: ['rule:A_done|act:A_done/A_done_a1'] }];
  const q = patternOf({ edits, boxes: [{ ...boxes[0], ports: { 'in:obj:Btn07|out:used': 'Add one' } }, boxes[1]], id: 'X1', actors,
    nouns: { Btn01: 'button' }, ports });
  assert.deepEqual(q.ports, [{ key: 'in:inside:{all_of_these_block}|in:input:Add', side: 'in', name: 'Add one', ends: ['{all_of_these_block}|in:input:Add'] },
    { key: 'in:{button}|out:used', side: 'in', name: null, ends: ['rule:R1|cause:0'] },
    { key: 'out:inside:{all_of_these_block}|out:output:Done', side: 'out', name: null, ends: ['{all_of_these_block}|out:output:Done'] },
    { key: 'out:{door}|in:unlock', side: 'out', name: null, ends: ['rule:R2|act:R2/R2_a1'] }]);     // a step's id follows its rule's
  assert.equal(q.slots[0].id, 'button');
});

test('slots as the rules write them', () => {
  assert.equal(slotText('door'), '{door}');
  assert.equal(slotOf('{door2}'), 'door2');
  assert.equal(slotOf('door'), null);
  assert.equal(slotOf('{Door}'), null);
});

test('a logic block placed as an object can be put in a block; other objects cannot', () => {
  const graph = { nodes: [{ id: 'obj:All1', kind: 'thing', family: 'allof' }, { id: 'obj:Door1', kind: 'thing', family: 'door' }, { id: 'obj:Timer1', kind: 'thing', family: 'timer' }], wires: [] };
  assert.deepEqual(selectionMembers({ nodes: ['obj:All1', 'obj:Door1', 'obj:Timer1'] }, graph).pieces, ['obj:All1', 'obj:Timer1']);
});

// ---- placed patterns (P8 slice 3): written out as editor/logicpatterns.py expand does (the same fixture)
const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/logic_patterns/${n}.json`, import.meta.url), 'utf8'));

test('placed patterns written out as the build does', () => {
  const { edits } = fixture('expand_input'), want = fixture('expand_expected');
  const out = expandInstances(edits);
  assert.deepEqual(out.links, want.links);
  assert.deepEqual(out.logic, want.logic);
  assert.equal(out.logicPatterns, edits.logicPatterns);
  const none = { links: [{ id: 'L1' }] };
  assert.equal(expandInstances(none), none);
});

test('a placed pattern is a block of the graph, read-only', () => {
  const { edits } = fixture('expand_input');
  const boxes = instanceBoxes(expandInstances(edits), { 'gate-network': 3 });
  assert.deepEqual(boxes.map((b) => [b.id, b.name, b.rules, b.pieces, b.instance]), [
    ['P1', 'North gates', ['P1_R1', 'P1_R2', 'P1_R3'], ['grp:P1_B1', 'obj:UCEdit40'], { pattern: 'gate-network', v: 2, missing: false, newest: 3 }],
    ['P2', 'gone', [], [], { pattern: 'gone', v: 1, missing: true, newest: null }],
    ['P3', 'gate-network', ['P3_R1', 'P3_R2', 'P3_R3'], ['grp:P3_B1', 'obj:UCEdit41'], { pattern: 'gate-network', v: 2, missing: false, newest: 3 }]]);
  assert.deepEqual(instanceBoxes({ links: [] }), []);
});

test('a new placed pattern takes an id no rule left by an unpacked one starts with', () => {
  const { edits } = fixture('expand_input');
  assert.equal(nextInstanceId(edits), 'P4');
  assert.equal(nextInstanceId({ links: [{ id: 'P1_R1' }], logic: { groups: [{ id: 'P2_B1' }] } }), 'P3');
  assert.equal(nextInstanceId({}), 'P1');
});

test('the settings of a block it brings name the objects of its slots', () => {
  assert.deepEqual(fillSlots({ Target: '{door}', Other: '{nope}', N: 2, L: ['{door}'] }, { door: 'Gate1' }), { Target: 'Gate1', Other: '{nope}', N: 2, L: ['Gate1'] });
});

test('what an update changes, in words', () => {
  const old = { rules: [{ id: 'R1', src: '{button}', when: 'used' }, { id: 'R2' }], slots: [{ id: 'button', words: 'the button' }] };
  const neu = { rules: [{ id: 'R1', src: '{button}', when: 'frobbed' }, { id: 'R3' }],
    slots: [{ id: 'button', words: 'the button' }, { id: 'lamp', words: 'the lamp' }, { id: 'timer', words: 'the timer', carried: true }] };
  const c = versionChanges(old, neu);
  assert.deepEqual([c.changed, c.added, c.removed, c.slots, c.objects], [['R1'], ['R3'], ['R2'], ['the lamp'], ['the timer']]);
  assert.equal(c.words, '1 rule changed, 1 new rule, 1 rule gone, a new place to fill (the lamp), it brings the timer too');
  assert.equal(versionChanges(old, old).words, 'nothing its rules do');
});
