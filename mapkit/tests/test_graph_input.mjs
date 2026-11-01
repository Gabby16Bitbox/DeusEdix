// The node graph canvas's grammar (static/graph-input.js): its keys (and the editor's global ones, which go on), what
// a press starts (D3: left-drag on empty space draws a box, with a setting to pan instead), the wheel, the selection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KEYS, PASS, keyFor, commandFor, passesOn, keyNames, digitOf, typing, gestureFor, wheelIntent, wheelNotch, wheelUnit, emptySelection,
  isSelected, selectionSize, pressSelect, releaseSelect, boxSelect, only, pruneSelection, sameSelection, selectionLists,
} from '../editor/static/graph-input.js';

const sel = (lists = {}) => ({ nodes: new Set(lists.nodes || []), wires: new Set(lists.wires || []), frames: new Set(lists.frames || []), notes: new Set(lists.notes || []) });
const N = (id) => ({ kind: 'node', id });

test('the canvas\'s keys, and the editor\'s left alone (undo, save, Shift+Space, Shift+Tab, Alt)', () => {
  assert.equal(commandFor({ key: 'Delete' }), 'delete');
  assert.equal(commandFor({ key: 'Backspace' }), 'delete');
  assert.equal(commandFor({ key: 'Tab' }), 'add');
  assert.equal(commandFor({ key: 'Tab', shiftKey: true }), '', 'Shift+Tab leaves the canvas: no keyboard trap');
  assert.equal(commandFor({ key: ' ' }), 'space');
  assert.equal(commandFor({ key: ' ', shiftKey: true }), '', 'Shift+Space maximises the panel (app.js)');
  assert.equal(commandFor({ key: 'f' }), 'frame-selection');
  assert.equal(commandFor({ key: 'F' }), 'frame-selection');
  assert.equal(commandFor({ key: 'Home' }), 'fit');
  assert.equal(commandFor({ key: 'z', ctrlKey: true }), '', 'Ctrl+Z is the editor\'s global undo');
  assert.equal(commandFor({ key: 'y', ctrlKey: true }), '');
  assert.equal(commandFor({ key: 's', ctrlKey: true }), '');
  assert.equal(commandFor({ key: 'c', ctrlKey: true }), 'copy', 'not the 3D view\'s copy');
  assert.equal(commandFor({ key: 'c', metaKey: true }), 'copy');
  assert.equal(commandFor({ key: 'c' }), 'frame-around');
  assert.equal(commandFor({ key: 'g', ctrlKey: true }), 'make-block');
  assert.equal(commandFor({ key: 'G', ctrlKey: true, shiftKey: true }), 'open-block');
  assert.equal(commandFor({ key: 'A', shiftKey: true }), 'add-selected');
  assert.equal(commandFor({ key: 'a', ctrlKey: true }), 'select-all');
  assert.equal(commandFor({ key: 'Delete', altKey: true }), '');
  assert.equal(commandFor({ key: 'q' }), '', 'not a command of the graph (and it stops there: PASS)');
  assert.deepEqual([keyFor({ key: 'ArrowLeft' }).command, keyFor({ key: 'ArrowLeft' }).dir], ['go', 'left']);
  assert.equal(keyFor({ key: 'ArrowUp', shiftKey: true }), null);
  // digits: held to place, with Ctrl a bookmark; Alt+digit stays the editor's selection slots
  assert.equal(commandFor({ key: '3', code: 'Digit3' }), 'hold');
  assert.equal(commandFor({ key: '3', code: 'Digit3', ctrlKey: true }), 'bookmark');
  assert.equal(commandFor({ key: '3', code: 'Digit3', altKey: true }), '');
  assert.equal(commandFor({ key: '#', code: 'Digit3', shiftKey: true }), '');
  assert.equal(digitOf({ key: '#', code: 'Digit3' }), '3');
  assert.equal(digitOf({ key: 'x', code: 'KeyX' }), '');
  // every entry is reachable: no two entries take the same key with the same modifiers
  const seen = new Set();
  for (const k of KEYS) {
    const id = `${k.digit ? 'digit' : k.key.toLowerCase()}|${!!k.ctrl}|${!!k.shift}`;
    assert.ok(!seen.has(id), `two entries for ${id}`);
    seen.add(id);
  }
});

test('#12 only the editor\'s global keys go on from the graph: the 3D view\'s shortcuts stop there', () => {
  for (const e of [{ key: 'z', ctrlKey: true }, { key: 'Z', ctrlKey: true, shiftKey: true }, { key: 'y', ctrlKey: true },
    { key: 's', ctrlKey: true }, { key: 'u', ctrlKey: true }, { key: 'k', metaKey: true }, { key: ' ', shiftKey: true }, { key: 'Escape' }]) {
    assert.equal(passesOn(e), true, JSON.stringify(e));
  }
  // End drops the 3D selection, B places a block, Ctrl+\ pushes to the grid, Alt+1 recalls a selection slot, Ctrl+I
  // inverts and Shift+D deselects the 3D selection, the letters switch the 3D view's tools
  for (const e of [{ key: 'End' }, { key: 'b' }, { key: 'q' }, { key: 'e' }, { key: 'l' }, { key: '\\', ctrlKey: true },
    { key: 'F', ctrlKey: true, shiftKey: true }, { key: 'f', ctrlKey: true, altKey: true }, { key: '1', code: 'Digit1', altKey: true },
    { key: 'i', ctrlKey: true }, { key: 'D', shiftKey: true }, { key: 'z', ctrlKey: true, altKey: true }]) {
    assert.equal(passesOn(e), false, JSON.stringify(e));
  }
  // what goes on is never a command of the graph too, apart from Esc (its own only when it has something to cancel)
  for (const k of PASS) {
    const e = { key: k.key, ctrlKey: !!k.ctrl, shiftKey: !!k.shift };
    assert.equal(commandFor(e), k.key === 'Escape' ? 'escape' : '', JSON.stringify(e));
  }
});

// menubar.js's own keyName and comboOf, taken from its source (it runs in a page): the spelling of data-keys
function menubarCombo() {
  const src = readFileSync(new URL('../editor/static/menubar.js', import.meta.url), 'utf8');
  const take = (start) => {
    const i = src.indexOf(start);
    assert.ok(i >= 0, `menubar.js has ${start}`);
    let depth = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break;
    return src.slice(i, j + 1);
  };
  const body = ['const NAMES = ', 'const PLACES = ', 'function keyName(e) ', 'function comboOf(e, fly) '].map(take).join(';\n');
  return new Function(`${body}; return comboOf;`)();
}
// the key event a press of an entry of KEYS makes (for a digit entry, that digit)
function pressOf(k, digit) {
  const key = k.digit ? digit : k.key;
  const code = k.digit ? 'Digit' + digit : /^[a-z]$/.test(key) ? 'Key' + key.toUpperCase() : key === ' ' ? 'Space' : key;
  return { key: k.shift && key.length === 1 ? key.toUpperCase() : key, code, ctrlKey: !!k.ctrl, shiftKey: !!k.shift, altKey: false, metaKey: false };
}

test('#19 the canvas\'s keys spelt as the menus spell them (its data-keys): every key, and only those', () => {
  const comboOf = menubarCombo(), names = keyNames();
  const pressed = KEYS.flatMap((k) => (k.digit ? [...'0123456789'] : [null]).map((d) => pressOf(k, d)));
  assert.deepEqual(names, pressed.map((e) => comboOf(e, false)));
  for (const e of pressed) assert.ok(keyFor(e), `${e.key} is a key of the graph`);
  assert.equal(new Set(names).size, names.length);
  for (const name of ['Delete', 'Backspace', 'Tab', 'Space', 'F', 'Home', 'Esc', 'Ctrl+A', 'Enter', 'F2', 'Shift+A', 'Ctrl+C', 'Ctrl+Shift+G',
    'Left', 'Down', 'F9', '0', '9', 'Ctrl+0', 'Ctrl+9']) assert.ok(names.includes(name), name);
  assert.ok(!names.includes('Ctrl+Z') && !names.includes('Shift+Space'), 'the editor\'s global keys stay the menus\'');
});

test('a field has its keys: typing never fires the canvas\'s', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(typing({ tagName }), true);
  assert.equal(typing({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(typing({ tagName: 'DIV', isContentEditable: false }), false);
  assert.equal(typing(null), false);
});

test('D3: left-drag on empty space draws a box; middle, Space or Alt pan; the setting turns left-drag into a pan', () => {
  assert.equal(gestureFor({ on: 'empty' }), 'box');
  assert.equal(gestureFor({ on: 'empty', button: 1 }), 'pan');
  assert.equal(gestureFor({ on: 'node', button: 1 }), 'pan', 'the middle button pans even over a node');
  assert.equal(gestureFor({ on: 'node', space: true }), 'pan');
  assert.equal(gestureFor({ on: 'empty', alt: true }), 'pan');
  assert.equal(gestureFor({ on: 'node', alt: true }), 'pan');
  assert.equal(gestureFor({ on: 'empty' }, { leftDrag: 'pan' }), 'pan');
  assert.equal(gestureFor({ on: 'empty', shift: true }, { leftDrag: 'pan' }), 'box', 'with the pan setting, Shift draws the box');
  assert.equal(gestureFor({ on: 'empty', ctrl: true }, { leftDrag: 'pan' }), 'box');
  assert.equal(gestureFor({ on: 'empty', button: 2 }), 'none', 'the right button is the context menu');
});

test('a press on each part starts its own drag', () => {
  assert.equal(gestureFor({ on: 'pin' }), 'link');
  assert.equal(gestureFor({ on: 'pin', ctrl: true }), 'rewire');
  assert.equal(gestureFor({ on: 'node' }), 'node');
  assert.equal(gestureFor({ on: 'node', shift: true }), 'node');
  assert.equal(gestureFor({ on: 'delay' }), 'delay');
  assert.equal(gestureFor({ on: 'chip' }), 'chip');
  assert.equal(gestureFor({ on: 'dot' }), 'dot');
  assert.equal(gestureFor({ on: 'frame' }), 'frame');
  assert.equal(gestureFor({ on: 'resize' }), 'resize');
  assert.equal(gestureFor({ on: 'note' }), 'note');
  assert.equal(gestureFor({ on: 'wire' }), 'wire');
  assert.equal(gestureFor({ on: 'wire', alt: true }), 'alt-click', 'Alt+click deletes a wire');
  assert.equal(gestureFor({ on: 'dot', alt: true }), 'alt-click');
  assert.equal(gestureFor({ on: 'empty', held: '1' }), 'place', 'a digit held and a click places');
  assert.equal(gestureFor({ on: 'node', held: '1' }), 'node');
  assert.equal(gestureFor({ on: 'mini' }), 'minimap');
  assert.equal(gestureFor({ on: 'mini', button: 1 }), 'none');
});

test('the wheel zooms, a trackpad\'s two fingers pan, Ctrl or a pinch zooms', () => {
  assert.equal(wheelIntent({ deltaY: 100 }), 'zoom');
  assert.equal(wheelIntent({ deltaY: -120 }), 'zoom');
  assert.equal(wheelIntent({ deltaY: 3, deltaMode: 1 }), 'zoom', 'lines: a mouse wheel');
  assert.equal(wheelIntent({ deltaY: 4 }), 'pan', 'small steps: a trackpad');
  assert.equal(wheelIntent({ deltaY: 4, deltaX: 2 }), 'pan');
  assert.equal(wheelIntent({ deltaY: 100, deltaX: 30 }), 'pan', 'sideways too: two fingers');
  assert.equal(wheelIntent({ deltaY: 4, ctrlKey: true }), 'zoom', 'a pinch');
  assert.equal(wheelIntent({ deltaY: 4 }, { wheel: 'zoom' }), 'zoom', 'the setting for a free-spinning wheel');
  assert.equal(wheelUnit({ deltaMode: 0 }), 1);
  assert.equal(wheelUnit({ deltaMode: 1 }), 33);
});

test('#29 a wheel set to scroll 1 line a notch (33.3 px in Chromium) still zooms; a trackpad\'s small steps still pan', () => {
  assert.equal(wheelIntent({ deltaY: 33.33333206176758 }), 'zoom', 'Windows\' lines to scroll at 1, as Chromium gives it');
  assert.equal(wheelIntent({ deltaY: -100 / 3 }), 'zoom');
  assert.equal(wheelIntent({ deltaY: 4, wheelDeltaY: -120 }), 'zoom', 'the legacy wheelDeltaY: 120 a notch');
  assert.equal(wheelIntent({ deltaY: 12.5 }), 'pan');
  assert.equal(wheelIntent({ deltaY: 33 }), 'pan', 'not a whole number of lines');
  assert.equal(wheelIntent({ deltaY: 4, wheelDeltaY: -5 }), 'pan');
  assert.equal(wheelIntent({ deltaY: 100 / 3, deltaX: 2 }), 'pan', 'sideways: still two fingers');
  assert.equal(wheelNotch({ deltaY: 0 }), false);
  assert.equal(wheelNotch({ deltaY: 200 / 3 }), true);
});

test('a click selects alone; on something selected it keeps the selection to drag; Shift adds, Ctrl toggles', () => {
  const two = sel({ nodes: ['A', 'B'], wires: ['w1'] });
  assert.ok(sameSelection(pressSelect(two, N('C')), sel({ nodes: ['C'] })));
  assert.ok(sameSelection(pressSelect(two, N('A')), two), 'kept, to drag them all');
  assert.ok(sameSelection(pressSelect(two, N('C'), { shift: true }), sel({ nodes: ['A', 'B', 'C'], wires: ['w1'] })));
  assert.ok(sameSelection(pressSelect(two, N('A'), { ctrl: true }), sel({ nodes: ['B'], wires: ['w1'] })));
  assert.ok(sameSelection(pressSelect(two, N('C'), { ctrl: true }), sel({ nodes: ['A', 'B', 'C'], wires: ['w1'] })));
  assert.ok(sameSelection(pressSelect(two, { kind: 'wire', id: 'w2' }), sel({ wires: ['w2'] })));
  assert.ok(sameSelection(two, sel({ nodes: ['A', 'B'], wires: ['w1'] })), 'the selection given is never changed');
  // let go without moving: a plain click on one of several keeps only it; a drag, Shift or Ctrl keep them all
  assert.ok(sameSelection(releaseSelect(two, N('A')), sel({ nodes: ['A'] })));
  assert.equal(releaseSelect(two, N('A'), {}, true), two);
  assert.equal(releaseSelect(two, N('A'), { shift: true }), two);
  assert.equal(releaseSelect(two, N('Z')), two);
});

test('a box selects what it touches, or adds it with Shift or Ctrl; what is gone leaves the selection', () => {
  const was = sel({ nodes: ['A'], wires: ['w1'] });
  assert.ok(sameSelection(boxSelect(was, ['B', 'C']), sel({ nodes: ['B', 'C'] })));
  assert.ok(sameSelection(boxSelect(was, ['B'], { shift: true }), sel({ nodes: ['A', 'B'], wires: ['w1'] })));
  assert.ok(sameSelection(boxSelect(was, ['B'], { ctrl: true }), sel({ nodes: ['A', 'B'], wires: ['w1'] })));
  const kept = pruneSelection(sel({ nodes: ['A', 'B'], wires: ['w1'], frames: ['f1'] }), (kind, id) => !(kind === 'node' && id === 'B') && kind !== 'frame');
  assert.deepEqual(selectionLists(kept), { nodes: ['A'], wires: ['w1'], frames: [], notes: [] });
  assert.equal(selectionSize(kept), 2);
  assert.equal(isSelected(kept, N('A')), true);
  assert.equal(isSelected(kept, { kind: 'wire', id: 'w2' }), false);
  assert.ok(sameSelection(only({ kind: 'note', id: 'n1' }), sel({ notes: ['n1'] })));
  assert.ok(!sameSelection(sel({ nodes: ['A'] }), sel({ nodes: ['B'] })));
  assert.ok(!sameSelection(sel({ nodes: ['A'] }), sel({ nodes: ['A', 'B'] })));
  assert.equal(selectionSize(emptySelection()), 0);
});
