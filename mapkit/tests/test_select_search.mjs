// Long drop-down lists with a search field (static/select-search.js): which choices a select gives, which selects are
// long, and the search over them (word by word, typos, groups kept in order when nothing is typed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { itemsOf, isLong, filterOptions, LONG } from '../editor/static/select-search.js';

const opt = (value, label, extra = {}) => ({ value, label, text: label, hidden: false, disabled: false, title: '', parentNode: { tagName: 'SELECT' }, ...extra });
const group = (label) => ({ tagName: 'OPTGROUP', label });
const select = (options, extra = {}) => ({ options, multiple: false, size: 0, disabled: false, dataset: {}, ...extra });

const STEPS = ['A message on the screen', 'A goal', 'A note in the DataVault', 'Set a state', 'Change a counter', 'Play a sound',
  'Take the player to another map', 'Give skill points', 'Give credits', 'Heal or hurt the player', 'Give the player an item',
  'Take an item from the player', 'Shake the view', 'Fade the view', 'Change the music'];

test('a placeholder that says what to do, hidden and disabled choices are not choices', () => {
  const s = select([opt('', '+ Add a step...'), opt('msg', 'A message'), opt('x', 'Gone', { hidden: true }), opt('y', 'Off', { disabled: true }),
    opt('', '(none)')]);
  assert.deepEqual(itemsOf(s).map((it) => it.label), ['A message', '(none)']);
  assert.deepEqual(itemsOf(s).map((it) => it.index), [1, 4]);
});

test('only long single-choice lists get the search', () => {
  const few = select(STEPS.slice(0, LONG).map((l, i) => opt('s' + i, l)));
  const many = select(STEPS.map((l, i) => opt('s' + i, l)));
  assert.equal(isLong(few), false);
  assert.equal(isLong(many), true);
  assert.equal(isLong({ ...many, multiple: true }), false);
  assert.equal(isLong({ ...many, size: 8 }), false);
  assert.equal(isLong({ ...many, dataset: { nosearch: '' } }), false);
  assert.equal(isLong({ ...many, disabled: true }), false);
});

test('nothing typed: every choice in its order, a group each time one starts', () => {
  const a = group('Story'), b = group('Player');
  const s = select([opt('1', 'Goal', { parentNode: a }), opt('2', 'Note', { parentNode: a }), opt('3', 'Credits', { parentNode: b }),
    opt('4', 'Loose'), opt('5', 'Item', { parentNode: b })]);
  const parts = filterOptions(itemsOf(s));
  assert.deepEqual(parts.map((p) => [p.group, p.items.map((it) => it.value)]),
    [['Story', ['1', '2']], ['Player', ['3']], [null, ['4']], ['Player', ['5']]]);
});

test('typed: word by word, best first, typos forgiven', () => {
  const items = itemsOf(select(STEPS.map((l, i) => opt('s' + i, l))));
  const top = (q) => filterOptions(items, q)[0]?.items.map((it) => it.label) || [];
  assert.equal(top('item')[0], 'Give the player an item');
  assert.ok(top('item').includes('Take an item from the player'));
  assert.equal(top('give item')[0], 'Give the player an item');
  assert.ok(!top('give item').includes('Take an item from the player'));
  assert.equal(top('musci')[0], 'Change the music');
  assert.deepEqual(filterOptions(items, 'zzzz'), []);
});
