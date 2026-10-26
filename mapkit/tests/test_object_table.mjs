// The object tables (static/object-table.js), as Unity's Light Explorer: what each table has, the order and the
// filter of its rows, which rows an edit is for, and the values typed for them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLES, columnKey, tableOf, listed, cellText, sortRows, filterRows, rangeNames, editTargets, typedValues } from '../editor/static/object-table.js';

const row = (name, label, cells, cls = 'Light') => ({ name, label, cls, cells });
const lights = [
  row('Light10', 'Light', { LightBrightness: { value: 64, row: 'int' }, bSpecialLit: { value: false, row: 'bool' }, LightType: { value: 'LT_Steady', row: 'choice' } }),
  row('Light2', 'Light', { LightBrightness: { value: 200, row: 'int' }, bSpecialLit: { value: true, row: 'bool' }, LightType: { value: 'LT_Flicker', row: 'choice' } }),
  row('Spotlight0', 'Spotlight', { LightBrightness: { value: 128, row: 'int' }, LightType: { value: 'LT_Steady', row: 'choice' } }, 'Spotlight'),
];
const names = (rows) => rows.map((r) => r.name);

test('the tables: lights, doors and characters, each column known once, the Light Explorer\'s and the gap\'s columns', () => {
  assert.deepEqual(TABLES.map((t) => [t.id, t.kind]), [['lights', 'light'], ['doors', 'mover'], ['characters', 'pawn']]);
  for (const t of TABLES) {
    const keys = t.columns.map(columnKey);
    assert.equal(new Set(keys).size, keys.length, t.id);
    assert.ok(keys.includes('enabled') && keys.includes('name') && keys.includes('cls'), t.id);
    assert.ok(t.columns.every((c) => c.prop || c.label), `${t.id}: a column the editor works out has a label`);
  }
  const has = (id, ...props) => props.every((p) => tableOf(id).columns.some((c) => c.prop === p));
  assert.ok(has('lights', 'LightType', 'LightEffect', 'LightBrightness', 'LightHue', 'LightSaturation', 'LightRadius', 'LightPeriod', 'LightCone', 'bSpecialLit'));
  assert.ok(has('doors', 'KeyIDNeeded', 'bLocked', 'lockStrength', 'bPickable', 'bBreakable', 'doorStrength'));
  assert.ok(has('characters', 'Orders', 'Alliance', 'Health', 'BindName'));
  // the swatch is the hue's colour picker, a column of its own beside the Hue
  assert.deepEqual(tableOf('lights').columns.filter((c) => c.prop === 'LightHue').map(columnKey), ['colour', 'LightHue']);
  assert.equal(tableOf('nothing'), null);
});

test('a table lists the objects with one of its properties: a Player Start is no character', () => {
  const characters = tableOf('characters');
  const start = row('PlayerStart0', 'Player Start', { enabled: { value: true, row: 'bool' }, name: { value: 'Player Start' }, cls: { value: 'PlayerStart' } }, 'PlayerStart');
  const guard = row('UCEdit8', 'Officer', { ...start.cells, Health: { value: 100, row: 'int' } }, 'CustomSoldier');
  assert.equal(listed(characters, start), false);
  assert.equal(listed(characters, guard), true);
});

test('sorting: numbers as numbers, off before on, names as people sort them, a row without the column last', () => {
  assert.deepEqual(names(sortRows(lights, 'LightBrightness')), ['Light10', 'Spotlight0', 'Light2']);
  assert.deepEqual(names(sortRows(lights, 'LightBrightness', -1)), ['Light2', 'Spotlight0', 'Light10']);
  // Spotlight0 has no Special lit: last both ways
  assert.deepEqual(names(sortRows(lights, 'bSpecialLit')), ['Light10', 'Light2', 'Spotlight0']);
  assert.deepEqual(names(sortRows(lights, 'bSpecialLit', -1)), ['Light2', 'Light10', 'Spotlight0']);
  // by name (no column): the label, then the name with its number read as one (Light2 before Light10)
  assert.deepEqual(names(sortRows(lights, null)), ['Light2', 'Light10', 'Spotlight0']);
  // ties by label and name
  assert.deepEqual(names(sortRows(lights, 'LightType')), ['Light2', 'Light10', 'Spotlight0']);
  assert.notEqual(sortRows(lights, null), lights, 'a new list: the rows given stay as they were');
});

test('the filter: every word, in the label, the name, the class or a cell, any case', () => {
  assert.deepEqual(names(filterRows(lights, 'spot')), ['Spotlight0']);
  assert.deepEqual(names(filterRows(lights, 'flicker')), ['Light2']);
  assert.deepEqual(names(filterRows(lights, 'light steady')), ['Light10', 'Spotlight0']);
  assert.deepEqual(names(filterRows(lights, '  ')), names(lights));
  assert.deepEqual(names(filterRows(lights, 'on')), ['Light2'], 'a switch on reads "on"');
  assert.deepEqual(filterRows(lights, 'nothing like it'), []);
  assert.equal(cellText({ value: false }), 'off');
  assert.equal(cellText({ value: 12 }), '12');
  assert.equal(cellText(undefined), '');
});

test('Shift+click: the rows between the one clicked before and this one', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(rangeNames(order, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(rangeNames(order, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(rangeNames(order, 'gone', 'c'), ['c']);
  assert.deepEqual(rangeNames(order, 'a', 'gone'), []);
});

test('an edit is for its row, or for every selected row that edits that column when its row is selected', () => {
  const rows = [
    row('A', 'Door', { lockStrength: { value: 0.2, row: 'number' }, BindName: { value: 'Guard', row: 'text', one: true } }),
    row('B', 'Door', { lockStrength: { value: 0.5, row: 'number' } }),
    row('C', 'Elevator', {}),                            // an elevator: no lock
    row('D', 'Door', { lockStrength: { value: 0.9, row: 'number' }, keyfound: { value: 'no' }, BindName: { value: 'X', row: 'text', one: true } }),
  ];
  assert.deepEqual(names(editTargets(rows, 'B', 'lockStrength', new Set(['A', 'B', 'C']))), ['A', 'B']);
  assert.deepEqual(names(editTargets(rows, 'D', 'lockStrength', new Set(['A', 'B']))), ['D'], 'its row not selected: it alone');
  assert.deepEqual(names(editTargets(rows, 'A', 'BindName', new Set(['A', 'D']))), ['A'], 'a conversation name is one row\'s');
  assert.deepEqual(editTargets(rows, 'D', 'keyfound', new Set(['D'])), [], 'a cell worked out is read only');
  assert.deepEqual(editTargets(rows, 'C', 'lockStrength', new Set(['C'])), []);
});

test('typed values: a sum, += on each one\'s own, L and R over the rows; other cells the same for all', () => {
  assert.deepEqual(typedValues('2*50', 'int', [64]), { values: [100] });
  assert.deepEqual(typedValues('+=16', 'int', [64, 200, '10']), { values: [80, 216, 26] });
  assert.deepEqual(typedValues('L(0,100)', 'int', [1, 2, 3]), { values: [0, 50, 100] });
  assert.deepEqual(typedValues('0.1+0.2', 'number', [0]), { values: [0.3] });
  assert.deepEqual(typedValues('2.6', 'int', [0]), { values: [3] });
  const spread = typedValues('R(10,20)', 'number', [0, 0, 0]).values;
  assert.ok(spread.every((v) => v >= 10 && v <= 20));
  assert.match(typedValues('L(0,1)', 'int', [5]).error, /several objects/);
  assert.match(typedValues('2+', 'int', [5]).error, /missing/);
  assert.deepEqual(typedValues(true, 'bool', [false, true]), { values: [true, true] });
  assert.deepEqual(typedValues('LT_Pulse', 'choice', ['a', 'b']), { values: ['LT_Pulse', 'LT_Pulse'] });
  assert.deepEqual(typedValues('#ff0000', 'color', ['#000000']), { values: ['#ff0000'] });
});
