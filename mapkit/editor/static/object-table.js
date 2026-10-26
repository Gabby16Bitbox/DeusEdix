// Tables of the map's objects (Window > Lights table, Doors table, Characters table), as Unity's Light Explorer:
// every object of a kind in a row, its properties in columns that sort and edit in place. The logic only: what
// each table has, the order and the filter of its rows, which rows an edit is for and the values typed for them
// (number-expr.js: a sum, +=16 on each one's own, L(a,b) spread in the rows' order, R(a,b) at random).
// object-table-view.js draws the window; app.js says what the cells hold and writes them (the Inspector's way:
// the same fields, one Ctrl+Z).
import { evaluate, evaluateAll, fieldText, plainNumber } from './number-expr.js';

// A table: {id, title, kind (its objects': app.js's userData.kind), note (under the table), columns}. A column is a
// property of the Inspector's ({prop}: editor/props.py FIELDS, named as the Inspector names it unless it has a
// label; colour: the colour picker of a light's hue, which sets the saturation too) or one the editor works out
// ({key, label}): enabled (in game), name, cls (its class), attitude (towards JC), relations (with the factions),
// keyfound (whether a key with the door's Key ID is in the map). key: what the window knows it by (the prop's name).
export const TABLES = [
  { id: 'lights', title: 'Lights', kind: 'light', note: 'The 3D view shows a new colour at once; walls and objects are lit again by Map > Rebuild lighting.',
    columns: [
      { key: 'enabled', label: 'In game', title: 'Enabled in game (after Rebuild)' },
      { key: 'colour', prop: 'LightHue', colour: true, label: 'Colour', title: 'Pick the colour (sets Hue and Saturation)' },
      { key: 'name', label: 'Name' }, { key: 'cls', label: 'Class' },
      { prop: 'LightType' }, { prop: 'LightEffect' }, { prop: 'LightBrightness' }, { prop: 'LightHue', label: 'Hue' },
      { prop: 'LightSaturation' }, { prop: 'LightRadius' }, { prop: 'LightPeriod' }, { prop: 'LightCone' }, { prop: 'bSpecialLit' },
    ] },
  { id: 'doors', title: 'Doors', kind: 'mover', note: 'Doors and elevators: an elevator has none of the lock\'s fields. Rebuild puts the changes in the map.',
    columns: [
      { key: 'enabled', label: 'In game', title: 'Enabled in game (after Rebuild)' },
      { key: 'name', label: 'Name' }, { key: 'cls', label: 'Class' },
      { prop: 'KeyIDNeeded' }, { key: 'keyfound', label: 'Key in map', title: 'Is a key (NanoKey) with this Key ID in the map?' },
      { prop: 'bLocked' }, { prop: 'lockStrength' }, { prop: 'bPickable' }, { prop: 'bBreakable' }, { prop: 'doorStrength' },
      { prop: 'bFrobbable' }, { prop: 'bOneWay' }, { prop: 'MoveTime' }, { prop: 'StayOpenTime' },
    ] },
  { id: 'characters', title: 'Characters', kind: 'pawn', note: 'Relations with the other factions: in the Inspector or Map > Factions. Rebuild puts the changes in the map.',
    columns: [
      { key: 'enabled', label: 'In game', title: 'Enabled in game (after Rebuild)' },
      { key: 'name', label: 'Name' }, { key: 'cls', label: 'Class' },
      { prop: 'Orders' }, { prop: 'Alliance' },
      { key: 'attitude', label: 'Towards JC', title: 'How they treat JC when the map starts (sets their relation with the Player)' },
      { key: 'relations', label: 'Relations', title: 'Their relations with JC and the factions (the Inspector edits them)' },
      { prop: 'Health' }, { prop: 'BindName' }, { prop: 'bInWorld' }, { prop: 'bInvincible' }, { prop: 'bImportant' },
    ] },
];

// what the window knows a column by
export const columnKey = (c) => c.key || c.prop;
export const tableOf = (id) => TABLES.find((t) => t.id === id) || null;
// a row the table lists: an object with one of its properties at least (a Player Start is no character)
export const listed = (table, row) => table.columns.some((c) => c.prop && row.cells[columnKey(c)]);

// A row: {name (the object's), label, cls, cells: {column key: cell}}; a cell: {value (as its field shows it: a number,
// true or false, a text), row: 'bool' | 'int' | 'number' | 'text' | 'choice' | 'color' (how it edits; none: read only),
// options (a choice's), one (an edit is for its own row alone)}. An object without a column has no cell in it.

// What a cell says, as the filter reads it
export function cellText(cell) {
  if (!cell) return '';
  return typeof cell.value === 'boolean' ? (cell.value ? 'on' : 'off') : String(cell.value ?? '');
}

const NAMES = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
// two values of a column: numbers as numbers, off before on, texts as people sort them (Light2 before Light10)
function compareValues(x, y) {
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  if (typeof x === 'boolean' && typeof y === 'boolean') return x - y;
  return NAMES.compare(String(x ?? ''), String(y ?? ''));
}

// The rows by a column (dir 1: up, -1: down); a row without it last either way, then by label and name
export function sortRows(rows, key, dir = 1) {
  const byName = (a, b) => NAMES.compare(a.label, b.label) || NAMES.compare(a.name, b.name);
  if (!key) return [...rows].sort(byName);
  return [...rows].sort((a, b) => {
    const x = a.cells[key], y = b.cells[key];
    if (!x || !y) return (!x - !y) || byName(a, b);
    return dir * compareValues(x.value, y.value) || byName(a, b);
  });
}

// The rows that have every word typed in their label, name, class or one of their cells (any case)
export function filterRows(rows, text) {
  const words = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const all = [r.label, r.name, r.cls, ...Object.values(r.cells).map(cellText)].join('\n').toLowerCase();
    return words.every((w) => all.includes(w));
  });
}

// Shift+click: the names from the row clicked before to this one, both in, in the rows' order (none before: this one)
export function rangeNames(names, from, to) {
  const i = names.indexOf(from), j = names.indexOf(to);
  if (j < 0) return [];
  if (i < 0) return [to];
  return names.slice(Math.min(i, j), Math.max(i, j) + 1);
}

// The rows an edit of a cell is for (rows: as shown, in their order; picked: the names selected): its row and the
// other selected rows that edit that column when its row is selected, as Unity's tables; else, or when the cell
// is one row's alone, its row
export function editTargets(rows, name, key, picked) {
  const row = rows.find((r) => r.name === name), cell = row?.cells[key];
  if (!cell?.row) return [];
  if (cell.one || !picked.has(name)) return [row];
  return rows.filter((r) => picked.has(r.name) && r.cells[key]?.row);
}

// What is typed or picked in a cell, for each of the rows it is for (currents: their values, in their order):
// {values} or {error}. A number takes a sum, +=16 on each one's own value; L(a,b) and R(a,b) with several rows.
export function typedValues(typed, row, currents) {
  if (row !== 'int' && row !== 'number') return { values: currents.map(() => typed) };
  const text = String(typed ?? '').trim(), own = currents.map((v) => plainNumber(String(v)));
  const r = currents.length > 1 ? evaluateAll(text, own) : evaluate(text, { current: own[0] });
  if (r.error) return { error: r.error };
  return { values: (r.values || [r.value]).map((v) => +fieldText(v, row === 'int')) };
}
