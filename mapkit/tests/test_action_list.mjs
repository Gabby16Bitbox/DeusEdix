// A rule as a list of steps (editor/static/action-list.js): its actions in the order of their time with a Wait where
// the time goes on, a Wait changed moves the steps after it, "If not" as a second rule with the opposite condition.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stepsOf, lastTime, setWait, negate, canOtherwise, otherwiseOf, syncOtherwise, newOtherwise, groupSteps } from '../editor/static/action-list.js';
import { conditionText } from '../editor/static/conditions.js';

const rule = (acts, more = {}) => ({ id: 'L1', src: 'Button1', when: 'used', do: acts, ...more });
const brief = (steps) => steps.map((s) => (s.kind === 'wait' ? `wait ${s.seconds}` : `${s.x.verb}@${s.at}`));

test('the steps: the actions in the order of their time, a Wait where the time goes on', () => {
  const l = rule([{ verb: 'message', delay: 3 }, { verb: 'open', delay: 0 }, { verb: 'sound', delay: 1 }, { verb: 'hide', delay: 1 }]);
  assert.deepEqual(brief(stepsOf(l)), ['open@0', 'wait 1', 'sound@1', 'hide@1', 'wait 2', 'message@3']);
  assert.deepEqual(stepsOf(l).filter((s) => s.kind === 'act').map((s) => s.j), [1, 2, 3, 0], 'each step knows its action');
  assert.equal(lastTime(l), 3);
  assert.deepEqual(stepsOf(rule([])), []);
  assert.deepEqual(brief(stepsOf(rule([{ verb: 'open', delay: 2 }]))), ['wait 2', 'open@2'], 'a first step that waits');
});

test('a Wait changed moves every step after it, never before it', () => {
  const l = rule([{ verb: 'open', delay: 0 }, { verb: 'sound', delay: 1 }, { verb: 'message', delay: 3 }]);
  assert.equal(setWait(l, 0, 2.5), true);
  assert.deepEqual(l.do.map((x) => x.delay), [0, 2.5, 4.5]);
  assert.equal(setWait(l, 2.5, 0.5), true);
  assert.deepEqual(l.do.map((x) => x.delay), [0, 2.5, 3]);
  assert.equal(setWait(l, 0, 0), true, 'a Wait of 0: the steps after it run with those before');
  assert.deepEqual(l.do.map((x) => x.delay), [0, 0, 0.5]);
  assert.equal(setWait(l, 9, 2), false, 'nothing after it');
});

test('the opposite of each condition the game can turn round; a skill has none', () => {
  const cases = [
    [{ flag: 'Alarm', is: true }, 'Alarm is No'], [{ flag: 'Alarm', is: 0 }, 'Alarm is Yes'], [{ flag: 'Alarm' }, 'Alarm is No'],
    [{ type: 'item', item: 'DeusEx.Multitool', has: true }, 'the player does not carry Multitool'],
    [{ type: 'alive', actor: 'Guard1', is: true }, 'Guard1 is not alive'],
    [{ type: 'counter', counter: 'Keys', op: '>=', value: 3 }, 'the counter Keys is less than 3'],
    [{ type: 'counter', counter: 'Keys', op: '==', value: 2 }, 'the counter Keys is not 2'],
    [{ type: 'credits', op: '<', value: 100 }, 'the player has at least 100 credits'],
  ];
  for (const [c, text] of cases) assert.equal(conditionText(negate(c)), text);
  for (const [c] of cases) assert.equal(conditionText(negate(negate(c))), conditionText(c), 'turned round twice: itself');
  assert.equal(negate({ type: 'skill', skill: 'SkillLockpicking', level: 2 }), null);
  assert.equal(negate({ type: 'counter', counter: 'K', op: '~', value: 1 }), null);
});

test('"If not": one condition the game can turn round; a second rule on the same cause, the opposite condition', () => {
  assert.equal(canOtherwise(rule([], { requires: [{ flag: 'A', is: true }] })), true);
  assert.equal(canOtherwise(rule([])), false, 'no condition: nothing to fail');
  assert.equal(canOtherwise(rule([], { requires: [{ flag: 'A' }, { flag: 'B' }] })), false, 'two: "If not" would be either');
  assert.equal(canOtherwise(rule([], { requires: [{ type: 'skill', skill: 'SkillLockpicking', level: 1 }] })), false);
  const main = rule([{ verb: 'open', target: 'Door3' }], { when: 'option', option: 2, once: true, requires: [{ type: 'counter', counter: 'K', op: '>=', value: 2 }] });
  const other = newOtherwise(main, 'L2');
  assert.deepEqual(other, { id: 'L2', src: 'Button1', when: 'option', option: 2, once: true, otherwiseOf: 'L1',
    requires: [{ type: 'counter', counter: 'K', op: '<', value: 2 }], do: [] });
  assert.equal(otherwiseOf(main, [main, other]), other);
  main.when = 'used'; delete main.option; main.requires[0].value = 5; main.once = false;
  syncOtherwise(main, other);
  assert.equal(other.when, 'used');
  assert.equal(other.option, undefined);
  assert.equal(other.once, false);
  assert.deepEqual(other.requires, [{ type: 'counter', counter: 'K', op: '<', value: 5 }]);
});

test('the steps to add, in groups; the ones no group names under "More"', () => {
  assert.deepEqual(groupSteps(['message', 'goal', 'flag', 'count', 'sound', 'travel', 'odd']),
    [['Messages and goals', ['message', 'goal']], ['States and counters', ['flag', 'count']], ['Sound and effects', ['sound']],
      ['The player', ['travel']], ['More', ['odd']]]);
  assert.deepEqual(groupSteps(['infolink', 'message', 'talk']), [['Messages and goals', ['message']], ['The Story', ['talk', 'infolink']]],
    'a dialogue or an InfoLink of the map\'s Story');
});

// ---------------------------------------------------------------- lists of steps (Logic runtime v2)
import { toSteps, blockOf, addFlow, removeStep, moveStep, flowText, stepsText } from '../editor/static/action-list.js';

test('a list made of steps: its actions in the order of their time, each delay from the one before', () => {
  const l = rule([{ verb: 'message', a: 'C', delay: 3 }, { verb: 'open', delay: 0 }, { verb: 'sound', delay: 1 }]);
  toSteps(l);
  assert.equal(l.steps, true);
  assert.deepEqual(l.do.map((x) => [x.verb, x.delay]), [['open', 0], ['sound', 1], ['message', 2]]);
  assert.deepEqual(brief(stepsOf(l)), ['open@0', 'wait 1', 'sound@0', 'wait 2', 'message@0']);
  toSteps(l);
  assert.deepEqual(l.do.map((x) => x.delay), [0, 1, 2], 'made once');
});

test('If, Otherwise, End: added where asked, found as a block, nested, taken out with the steps inside kept', () => {
  const l = rule([{ verb: 'open' }, { verb: 'message', a: 'x' }]);
  assert.equal(addFlow(l, 'ifelse', 1), 1);
  assert.deepEqual(l.do.map((x) => x.verb), ['open', 'if', 'else', 'end', 'message']);
  assert.deepEqual(blockOf(l, 1), { otherwise: 2, end: 3 });
  addFlow(l, 'if', 2);                                  // inside the first branch
  assert.deepEqual(l.do.map((x) => x.verb), ['open', 'if', 'if', 'end', 'else', 'end', 'message']);
  assert.deepEqual(blockOf(l, 1), { otherwise: 4, end: 5 });
  assert.deepEqual(stepsOf(l).map((s) => `${s.kind}:${s.depth}`), ['act:0', 'if:0', 'if:1', 'end:1', 'else:0', 'end:0', 'act:0']);
  assert.equal(removeStep(l, 5), false, 'an End is not taken out on its own');
  assert.equal(removeStep(l, 1), true);
  assert.deepEqual(l.do.map((x) => x.verb), ['open', 'if', 'end', 'message']);
  assert.equal(moveStep(l, 3, -1), true);
  assert.deepEqual(l.do.map((x) => x.verb), ['open', 'if', 'message', 'end'], 'moved into the block');
  assert.equal(moveStep(l, 0, -1), false);
});

test('Wait until and a Wait of its own; the steps in words, in their order', () => {
  const l = rule([{ verb: 'goto', target: 'Guard2' }]);
  addFlow(l, 'until');
  l.do[1].until.actor = 'Guard2'; l.do[1].max = 20;
  addFlow(l, 'wait');
  l.do.push({ verb: 'message', a: 'Here', delay: 0 });
  assert.deepEqual(stepsOf(l).map((s) => (s.kind === 'wait' ? `wait ${s.seconds}` : s.kind)), ['act', 'until', 'wait 1', 'act']);
  const words = { name: (n) => (n === 'Guard2' ? 'the guard' : n), cond: (c) => `${c.flag} is ${c.is === false ? 'No' : 'Yes'}` };
  assert.equal(flowText(l.do[1], words), 'wait until the guard arrives (at most 20 s)');
  assert.equal(flowText({ verb: 'wait', until: { flag: 'Power' } }, words), 'wait until Power is Yes');
  assert.equal(flowText({ verb: 'if', requires: [{ flag: 'A' }, { flag: 'B', is: false }], match: 'any' }, words), 'if A is Yes or B is No:');
  assert.equal(stepsText(l, (x) => `${x.verb} ${x.target || x.a}`, words),
    'goto Guard2, wait until the guard arrives (at most 20 s), wait 1 s, message Here');
});

test('a list of steps in words: "then" with its step, no "then" at the end (13 Nov 2026, Deep Ops)', () => {
  const act = (x) => x.verb + (x.a ? ' ' + x.a : '');
  const words = { cond: (c) => `${c.flag} is Yes` };
  const r = { steps: true, do: [{ verb: 'if', requires: [{ flag: 'A' }] }, { verb: 'message', a: 'x' }, { verb: 'else' }, { verb: 'message', a: 'y' },
    { verb: 'end' }, { verb: 'message', a: 'z' }] };
  assert.equal(stepsText(r, act, words), 'if A is Yes: message x, otherwise: message y, then message z');
  r.do.pop();
  assert.equal(stepsText(r, act, words), 'if A is Yes: message x, otherwise: message y');
});
