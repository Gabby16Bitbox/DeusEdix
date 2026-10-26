// Several objects edited together in the Inspector (static/multi-edit.js, static/multi-inspector.js): shared and
// mixed values, Narrow the selection, Set all to, what the status bar says, and the rows as the page draws them;
// with number-expr.js evaluateAll, a sum typed in a field gives each object its own value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIXED, TRANSFORM, shared, kindCounts, valueChoices, valueText, valuesText } from '../editor/static/multi-edit.js';
import { multiRows, narrowRows } from '../editor/static/multi-inspector.js';
import { evaluateAll } from '../editor/static/number-expr.js';

const E = { escapeHtml: (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), multiField: () => {} };

test('a value they all share, or mixed; compared as the field shows them', () => {
  assert.deepEqual(shared([64, 64, 64]), { mixed: false, value: 64 });
  assert.deepEqual(shared([64, 128]), { mixed: true });
  assert.deepEqual(shared(['None', 'None']), { mixed: false, value: 'None' });
  assert.deepEqual(shared([true, false]), { mixed: true });
  assert.equal(shared([0, -0]).mixed, false);                // -0 shows as 0
  assert.equal(shared([5]).mixed, false);
});

test('the shared Transform: the view\'s axes over the game\'s, then the turns and the size', () => {
  assert.deepEqual(TRANSFORM.map((t) => t.key), ['x', 'z', 'y', 'yaw', 'pitch', 'roll', 'scale']);
  assert.deepEqual(TRANSFORM.slice(0, 3).map((t) => t.label), ['X', 'Y', 'Z']);
  assert.match(TRANSFORM[1].title, /height/);
  assert.deepEqual(TRANSFORM.map((t) => t.row), ['number', 'number', 'number', 'int', 'int', 'int', 'int']);
});

test('Narrow the selection: each kind with how many, the most first, then by name', () => {
  assert.deepEqual(kindCounts(['Light', 'Block', 'Light', 'Spotlight', 'Light', 'Block']),
    [{ kind: 'Light', count: 3 }, { kind: 'Block', count: 2 }, { kind: 'Spotlight', count: 1 }]);
  assert.deepEqual(kindCounts(['b', 'a']), [{ kind: 'a', count: 1 }, { kind: 'b', count: 1 }]);
  assert.deepEqual(kindCounts([]), []);
});

test('Set all to: one choice for each value, named by the first that has it; none when they agree', () => {
  assert.deepEqual(valueChoices(['L1', 'L2', 'L3', 'L4'], [64, 128, 64, 200]),
    [{ name: 'L1', value: 64 }, { name: 'L2', value: 128 }, { name: 'L4', value: 200 }]);
  assert.deepEqual(valueChoices(['A', 'B'], ['x', 'x']), []);
  assert.equal(valueChoices([...'abcdefghijklmnop'], [...Array(16).keys()]).length, 12);
  assert.equal(valueChoices(['a', 'b', 'c'], [1, 2, 3], 2).length, 2);
  assert.deepEqual(valueChoices(['a', 'b', 'c'], [NaN, 4, 5]), [{ name: 'b', value: 4 }, { name: 'c', value: 5 }]);
});

test('values in words: on and off, empty, a few, a range', () => {
  assert.equal(valueText(true), 'on');
  assert.equal(valueText(false), 'off');
  assert.equal(valueText(''), '(empty)');
  assert.equal(valueText('LT_Steady'), 'LT_Steady');
  assert.equal(valuesText([16, 16, 16]), '16');
  assert.equal(valuesText([0, 128, 256]), '0, 128, 256');
  assert.equal(valuesText([5, 1, 9, 3, 7, 2]), '1 to 9');
  assert.equal(valuesText(['a', 'b', 'c', 'a', 'b', 'c']), '3 different values');
});

test('a sum over the objects: each one its own value, L spread in their order, R between its bounds', () => {
  assert.deepEqual(evaluateAll('+=16', [0, 100, -16]).values, [16, 116, 0]);
  assert.deepEqual(evaluateAll('L(0,512)', [7, 7, 7, 7, 7]).values, [0, 128, 256, 384, 512]);
  assert.deepEqual(evaluateAll('128', [1, 2]).values, [128, 128]);
  const r = evaluateAll('R(10,20)', [0, 0, 0], () => 0.5).values;
  assert.deepEqual(r, [15, 15, 15]);
  assert.match(evaluateAll('+=1', [1, NaN]).error, /no number/);
});

test('rows: the shared value, a dim mixed mark, a mixed checkbox, a choice with the mark first', () => {
  const row = (r) => ({ id: 'f', label: 'Brightness', names: ['L1', 'L2'], apply: () => true, ...r });
  const same = multiRows(E, [row({ row: 'int', values: [64, 64], min: 0, max: 255 })]).html;
  assert.match(same, /value="64"/);
  assert.match(same, /placeholder=""/);
  assert.match(same, /data-expr="int"/);
  assert.match(same, / min="0" max="255"/);
  const mixed = multiRows(E, [row({ row: 'number', values: [64, 128] })]).html;
  assert.match(mixed, new RegExp(`value="" placeholder="${MIXED}"`));
  assert.match(mixed, /data-mixed="1"/);
  assert.match(multiRows(E, [row({ row: 'bool', values: [true, false] })]).html, /type="checkbox" id="f" data-mixed="1"/);
  assert.match(multiRows(E, [row({ row: 'bool', values: [true, true] })]).html, /type="checkbox" id="f" checked>/);
  const choice = multiRows(E, [row({ row: 'choice', values: ['LT_Steady', 'LT_Pulse'], options: ['LT_Steady', 'LT_Pulse', 'LT_Blink'] })]).html;
  assert.match(choice, new RegExp(`<option value="" disabled selected>${MIXED}</option><option >LT_Steady`));
  const own = multiRows(E, [row({ row: 'choice', values: ['Odd', 'Odd'], options: ['A'] })]).html;
  assert.match(own, /<option selected>Odd<\/option><option >A<\/option>/);       // a value the options lack is kept
});

test('rows: "2 of 3" when fewer objects have the field, the text escaped', () => {
  const html = multiRows(E, [{ id: 'f', label: 'Scale %', row: 'number', names: ['a', 'b'], values: [100, 100], of: 3, apply: () => true },
    { id: 'g', label: 'Tag', row: 'text', names: ['a'], values: ['"x"'], apply: () => true }]).html;
  assert.match(html, /2 of 3/);
  assert.match(html, /value="&quot;x&quot;"/);
});

test('Narrow the selection: nothing to narrow with one kind; a button for each kind with its count', () => {
  assert.equal(narrowRows(E, [{ kind: 'Light', count: 3, label: 'Light' }], () => {}).html, '');
  const html = narrowRows(E, [{ kind: 'DeusEx.Light', count: 3, label: 'Light' }, { kind: 'Block', count: 1, label: 'Block' }], () => {}).html;
  assert.match(html, /data-narrow="0"[^>]*>Light <small>3<\/small>/);
  assert.match(html, /data-narrow="1"/);
});
