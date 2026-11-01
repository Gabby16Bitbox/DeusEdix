// The building blocks of the Interactions (editor/static/interaction-blocks.js): sentences, defaults,
// the rows of their actions and the Usable section.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BLOCK_VERBS, BLOCK_WHEN, blockActText, blockDefaults, blockRowsHtml, blockWhenText, effectOptionText,
  effectOptions, usableChange, usableDefault, usableHtml, usableSummary, withExact } from '../editor/static/interaction-blocks.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const nameOf = (n) => `the object ${n}`;

test('new whens and verbs have plain labels', () => {
  for (const w of ['npcused', 'finished', 'stopped', 'arrived']) assert.ok(BLOCK_WHEN[w]);
  for (const v of ['timerstart', 'timerstop', 'timerpause', 'timerresume', 'npcuse', 'effect']) assert.ok(BLOCK_VERBS[v][0]);
  assert.equal(blockWhenText('finished', 'the timer Timer1'), 'When the timer Timer1 runs out');
  assert.equal(blockWhenText('npcused', 'Crate'), 'When a character has used Crate');
  assert.equal(blockWhenText('opened', 'x'), '');
});

test('action sentences', () => {
  assert.equal(blockActText({ verb: 'timerstart', a: '45' }, 'Timer1', nameOf), 'start Timer1 (45 s)');
  assert.equal(blockActText({ verb: 'timerstop' }, 'Timer1', nameOf), 'stop Timer1');
  assert.equal(blockActText({ verb: 'npcuse', a: 'Crate', b: '4', c: 'crouch' }, 'Guard', nameOf),
    'Guard goes and uses the object Crate for 4 s, crouching');
  assert.equal(blockActText({ verb: 'effect', a: 'mist', b: '0' }, 'Crate', nameOf), 'mist pouring out on Crate until stopped');
  assert.equal(blockActText({ verb: 'effect', a: 'blinklight', b: '30', c: 'red beep' }, 'Bomb', nameOf),
    'a red blinking light (beeping) on Bomb for 30 s');
  assert.equal(blockActText({ verb: 'effect', a: 'off' }, 'Bomb', nameOf), 'stop the effects on Bomb');
  assert.equal(blockActText({ verb: 'open' }, 'Door', nameOf), '');
});

test('defaults of new actions', () => {
  const u = { verb: 'npcuse' }; blockDefaults(u);
  assert.deepEqual([u.b, u.c], ['4', 'crouch']);
  const e = { verb: 'effect', a: 'nonsense' }; blockDefaults(e);
  assert.deepEqual([e.a, e.b], ['mist', '0']);
  const l = { verb: 'effect', a: 'pulse' }; blockDefaults(l);
  assert.equal(l.c, 'red');
  assert.deepEqual(effectOptions('Green BEEP'), { colour: 'green', beep: true, exact: false });
  assert.equal(effectOptionText('purple', false), 'red');
  assert.equal(effectOptionText('blue', true), 'blue beep');
  assert.equal(effectOptionText('blue', true, true), 'blue beep exact');
});

test('exactly on the object, and effects on an effect point', () => {
  assert.equal(withExact('', true), 'exact');
  assert.equal(withExact('red beep', true), 'red beep exact');
  assert.equal(withExact('red exact beep', false), 'red beep');
  assert.equal(withExact(withExact('green', true), true), 'green exact');
  assert.equal(effectOptions('green beep exact').exact, true);
  assert.equal(blockActText({ verb: 'effect', a: 'mist', b: '0', c: 'exact' }, 'Crate', nameOf), 'mist pouring out on Crate (exactly on it) until stopped');
  assert.equal(blockActText({ verb: 'effect', a: 'sparks', b: '5' }, 'effect point P1', nameOf, { point: true }),
    'sparks at effect point P1, along its arrow for 5 s');
  assert.equal(blockActText({ verb: 'effect', a: 'pulse', b: '0', c: 'blue' }, 'effect point P1', nameOf, { point: true }),
    'a blue pulsing light at effect point P1 until stopped');
  // an ordinary object: the checkbox and the button to put it on an effect point instead
  const obj = blockRowsHtml({ verb: 'effect', a: 'smoke', b: '0', c: 'exact' }, 3, esc, nameOf);
  assert.match(obj, /data-lkexact="3" checked/);
  assert.match(obj, /data-lkfxpt="3"/);
  // an effect point: no checkbox (it is always exact), a line that says where it goes
  const pt = blockRowsHtml({ verb: 'effect', a: 'smoke', b: '0' }, 3, esc, nameOf, { point: true });
  assert.doesNotMatch(pt, /data-lkexact|data-lkfxpt/);
  assert.match(pt, /along its big arrow/);
  assert.doesNotMatch(blockRowsHtml({ verb: 'effect', a: 'off' }, 0, esc, nameOf), /data-lkexact/);
});

test('rows of the actions carry the fields the generic handlers read', () => {
  const npc = blockRowsHtml({ verb: 'npcuse', target: 'Guard', a: 'Crate', b: '4', c: 'stand' }, 2, esc, nameOf);
  assert.match(npc, /data-lkuse="2"/);
  assert.match(npc, /data-lkarg="2" data-k="b"/);
  assert.match(npc, /<option value="stand" selected>/);
  const fx = blockRowsHtml({ verb: 'effect', a: 'blinklight', b: '10', c: 'green beep' }, 0, esc, nameOf);
  assert.match(fx, /data-lkcol="0"/);
  assert.match(fx, /data-lkbeep="0" checked/);
  assert.match(fx, /<option selected>green<\/option>/);
  assert.doesNotMatch(blockRowsHtml({ verb: 'effect', a: 'off' }, 0, esc, nameOf), /data-k="b"/);
  assert.match(blockRowsHtml({ verb: 'timerstart', a: '' }, 1, esc, nameOf), /data-lkarg="1" data-k="a"/);
  assert.equal(blockRowsHtml({ verb: 'open' }, 0, esc, nameOf), '');
});

test('usable section and its changes', () => {
  const items = [{ cls: 'DeusEx.Multitool', name: 'Multitool', cat: 'Tools' }];
  assert.match(usableHtml(null, items, esc), /data-us="on"/);
  assert.doesNotMatch(usableHtml(null, items, esc), /data-us="text"/);
  const u = usableDefault();
  const h = usableHtml(Object.assign(u, { item: 'DeusEx.Multitool' }), items, esc);
  for (const f of ['text', 'secs', 'crouch', 'item', 'consume', 'uses', 'hidden']) assert.match(h, new RegExp(`data-us="${f}"`));
  assert.match(h, /value="DeusEx.Multitool" selected/);
  usableChange(u, 'secs', { value: '2.25', type: 'number' });
  usableChange(u, 'uses', { value: '1.6', type: 'number' });
  usableChange(u, 'text', { value: '  Defuse ', type: 'text' });
  usableChange(u, 'hidden', { checked: true, type: 'checkbox' });
  assert.deepEqual([u.secs, u.uses, u.text, u.hidden], [2.3, 2, 'Defuse', true]);
  usableChange(u, 'item', { value: '', type: 'select-one' });
  assert.equal(u.consume, false);
  assert.equal(usableSummary(u), '"Defuse", takes 2.3 s, 2 times, hidden at start');
});
