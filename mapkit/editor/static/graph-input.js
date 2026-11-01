// The node graph canvas's grammar (graph-canvas.js), one for the Logic, Story and Studio canvases
// (final_design.json ux_walkthrough I): what a press of the mouse starts, what a key does, whether the wheel zooms or
// pans, and how a click or a box changes the selection. Pure: tests/test_graph_input.mjs.

// ---------------------------------------------------------------- keys

// a key the canvas answers: its command. `ctrl` is Ctrl or Cmd; a listed modifier must be held, an unlisted one must
// not. `digit`: any of 0-9. A key not listed here stops at the canvas too (PASS below), so it never reaches the 3D
// view's shortcuts
export const KEYS = [
  { key: 'Delete', command: 'delete' }, { key: 'Backspace', command: 'delete' },
  { key: 'Tab', command: 'add' },                 // Shift+Tab is not taken: it leaves the canvas, so the keys never trap
  { key: ' ', command: 'space' },                 // a tap adds, held it pans (graph-canvas.js)
  { key: 'f', command: 'frame-selection' }, { key: 'Home', command: 'fit' },
  { key: 'Escape', command: 'escape' },
  { key: 'a', ctrl: true, command: 'select-all' },
  { key: 'Enter', command: 'edit' }, { key: 'F2', command: 'rename' },
  { key: 'a', shift: true, command: 'add-selected' },
  { key: 'c', ctrl: true, command: 'copy' }, { key: 'x', ctrl: true, command: 'cut' },
  { key: 'v', ctrl: true, command: 'paste' }, { key: 'd', ctrl: true, command: 'duplicate' },
  { key: 'c', command: 'frame-around' }, { key: 'n', command: 'note' },
  { key: 'g', ctrl: true, command: 'make-block' }, { key: 'g', ctrl: true, shift: true, command: 'open-block' },
  { key: 't', command: 'try' }, { key: 'w', command: 'why' }, { key: 'm', command: 'mute' }, { key: 'F9', command: 'breakpoint' },
  { key: 'ArrowLeft', command: 'go', dir: 'left' }, { key: 'ArrowRight', command: 'go', dir: 'right' },
  { key: 'ArrowUp', command: 'go', dir: 'up' }, { key: 'ArrowDown', command: 'go', dir: 'down' },
  { digit: true, ctrl: true, command: 'bookmark' },
  { digit: true, command: 'hold' },               // held while clicking: place what that key places
];

// the keys that go on to the editor while the canvas has the focus, when the canvas does not use them: its global
// ones (undo, redo, save, the History panel, the search, Maximize panel) and Esc when the graph has nothing to cancel
// (a maximized panel is put back). Every other key stops at the canvas: the 3D view's End would drop the map's
// selection to the floor, B would place a block, Alt+1 recall a selection slot
export const PASS = [
  { key: 'z', ctrl: true }, { key: 'z', ctrl: true, shift: true }, { key: 'y', ctrl: true }, { key: 's', ctrl: true },
  { key: 'u', ctrl: true }, { key: 'k', ctrl: true }, { key: ' ', shift: true }, { key: 'Escape' },
];

// whether a key event (or {key, code, ctrlKey, metaKey, shiftKey, altKey}) is an entry's key
function fits(entry, e) {
  const key = String(e.key || '');
  const digit = /^Digit\d$/.test(e.code || '') || (/^\d$/.test(key) && !e.code);
  return (entry.digit ? digit : entry.key.toLowerCase() === key.toLowerCase())
    && !!entry.ctrl === !!(e.ctrlKey || e.metaKey) && !!entry.shift === !!e.shiftKey && !e.altKey;
}

// a key event -> its entry of KEYS, or null when the canvas does not answer it
export const keyFor = (e) => KEYS.find((k) => fits(k, e)) || null;

export const commandFor = (e) => keyFor(e)?.command || '';

// whether a key the canvas does not use goes on to the editor (PASS)
export const passesOn = (e) => PASS.some((k) => fits(k, e));

// the canvas's keys spelt as the menus spell them (menubar.js keyName and comboOf: Ctrl+Shift+G, Space, Esc, Left), for
// the canvas's data-keys: the menus' layer then leaves these to the canvas while it has the focus, even when a shortcut
// of the 3D view was moved onto one of them in Settings > Keyboard shortcuts
const SPELT = { ' ': 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
const DIGITS = [...'0123456789'];
export const keyNames = (list = KEYS) => list.flatMap((k) => (k.digit ? DIGITS : [SPELT[k.key] || (k.key.length === 1 ? k.key.toUpperCase() : k.key)])
  .map((name) => (k.ctrl ? 'Ctrl+' : '') + (k.shift ? 'Shift+' : '') + name));

// the digit of a key event, for 'hold' and 'bookmark'
export const digitOf = (e) => (/^Digit(\d)$/.exec(e.code || '') || /^(\d)$/.exec(e.key || '') || [])[1] || '';

// focus in a field: its keys are the field's, never the canvas's
export const typing = (target) => !!target && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || !!target.isContentEditable);

// ---------------------------------------------------------------- the mouse

// what a press starts. on: what is under the pointer: 'mini' (the minimap), 'pin', 'delay' (a wire's delay), 'chip'
// (a wire's label), 'dot' (a reroute point), 'frame' (a frame's title), 'resize' (its corner), 'note', 'node', 'wire',
// 'empty'. held: a digit key held down. settings.leftDrag: 'select' (a box, the default) or 'pan'.
// -> 'minimap' | 'pan' | 'alt-click' (pans if dragged; a click deletes the wire or point) | 'link' | 'rewire' (Ctrl:
//    move the pin's wires) | 'delay' | 'chip' | 'dot' | 'frame' | 'resize' | 'note' | 'node' | 'place' | 'wire' (a
//    click selects it, a drag is as on empty space) | 'box' | 'none'
export function gestureFor({ button = 0, alt = false, ctrl = false, shift = false, space = false, held = '', on = 'empty' }, settings = {}) {
  if (on === 'mini') return button === 0 ? 'minimap' : 'none';
  if (button === 1) return 'pan';
  if (button !== 0) return 'none';
  if (space) return 'pan';
  if (alt) return on === 'wire' || on === 'dot' ? 'alt-click' : 'pan';
  if (on === 'pin') return ctrl ? 'rewire' : 'link';
  if (['delay', 'chip', 'dot', 'frame', 'resize', 'note', 'node'].includes(on)) return on;
  if (held) return 'place';
  if (on === 'wire') return 'wire';
  return emptyDrag(settings, shift || ctrl);
}

// a drag on empty space: a selection box, or (settings.leftDrag 'pan') a pan, Shift or Ctrl then drawing the box
export const emptyDrag = (settings, adding) => (settings.leftDrag === 'pan' && !adding ? 'pan' : 'box');

// the wheel: 'zoom' or 'pan'. Ctrl+wheel and a trackpad's pinch (the browser adds Ctrl) zoom; a sideways scroll is two
// fingers on a trackpad and pans; a wheel's notch (lines, 50 px and more, or wheelNotch's) zooms; small steps are a
// trackpad's and pan. settings.wheel 'zoom' makes every up-and-down turn zoom (a free-spinning wheel with small steps)
export function wheelIntent(e, settings = {}) {
  const { deltaX = 0, deltaY = 0, deltaMode = 0, ctrlKey = false, metaKey = false } = e;
  if (ctrlKey || metaKey) return 'zoom';
  if (deltaX !== 0) return 'pan';
  if (deltaMode !== 0 || settings.wheel === 'zoom') return 'zoom';
  return Math.abs(deltaY) >= 50 || wheelNotch(e) ? 'zoom' : 'pan';
}

// Chromium's (and WebView2's) pixels for one line of a wheel's turn: Windows sends lines x 100/3 a notch, so with its
// "lines to scroll" at 1 a notch is 33.3 px, under the 50 px that tell a wheel from a trackpad
const LINE_PX = 100 / 3;
// a mouse wheel's notch however few lines it scrolls: a whole number of lines in pixels, or the legacy wheelDeltaY in
// steps of 120 (a notch, in every browser that still gives it)
export function wheelNotch({ deltaY = 0, wheelDeltaY = 0 }) {
  const lines = Math.abs(deltaY) / LINE_PX;
  return (lines > 0.5 && Math.abs(lines - Math.round(lines)) < 1e-3) || (wheelDeltaY !== 0 && wheelDeltaY % 120 === 0);
}

// the pixels in one unit of a wheel's turn, whatever unit the browser gave it in (lines, pages)
export const wheelUnit = (e) => (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);

// ---------------------------------------------------------------- the selection

// the selection: a set of ids for each kind of thing that can be selected
export const SELECTABLE = { node: 'nodes', wire: 'wires', frame: 'frames', note: 'notes' };

export const emptySelection = () => ({ nodes: new Set(), wires: new Set(), frames: new Set(), notes: new Set() });

const copyOf = (sel) => ({ nodes: new Set(sel.nodes), wires: new Set(sel.wires), frames: new Set(sel.frames), notes: new Set(sel.notes) });
export const isSelected = (sel, item) => sel[SELECTABLE[item.kind]].has(item.id);
export const selectionSize = (sel) => sel.nodes.size + sel.wires.size + sel.frames.size + sel.notes.size;

// a press on a thing ({kind, id}). Shift adds it; Ctrl adds or takes it out; a plain press on something not selected
// selects it alone, and on something selected keeps the whole selection (to drag it)
export function pressSelect(sel, item, { shift = false, ctrl = false } = {}) {
  const out = copyOf(sel), set = out[SELECTABLE[item.kind]];
  if (ctrl) { if (set.has(item.id)) set.delete(item.id); else set.add(item.id); return out; }
  if (shift || set.has(item.id)) { set.add(item.id); return out; }
  return only(item);
}

// the release of a press that did not move: a plain click on one of several selected keeps only it
export function releaseSelect(sel, item, { shift = false, ctrl = false } = {}, moved = false) {
  if (moved || shift || ctrl || !item || !isSelected(sel, item) || selectionSize(sel) === 1) return sel;
  return only(item);
}

// a selection box over these nodes: they alone, or (Shift or Ctrl) added to what was selected
export function boxSelect(sel, nodeIds, { shift = false, ctrl = false } = {}) {
  const out = shift || ctrl ? copyOf(sel) : emptySelection();
  for (const id of nodeIds) out.nodes.add(id);
  return out;
}

export function only(item) {
  const out = emptySelection();
  out[SELECTABLE[item.kind]].add(item.id);
  return out;
}

// the selection with what no longer exists taken out (`has(kind, id)`)
export function pruneSelection(sel, has) {
  const out = emptySelection();
  for (const [kind, key] of Object.entries(SELECTABLE)) for (const id of sel[key]) if (has(kind, id)) out[key].add(id);
  return out;
}

export const sameSelection = (a, b) => Object.values(SELECTABLE).every((key) => a[key].size === b[key].size && [...a[key]].every((id) => b[key].has(id)));

// the selection as plain lists, for the callbacks
export const selectionLists = (sel) => ({ nodes: [...sel.nodes], wires: [...sel.wires], frames: [...sel.frames], notes: [...sel.notes] });
