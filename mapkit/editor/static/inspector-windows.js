// Properties… windows, as Unity's floating Inspector (right click > Properties…): each shows the Inspector of one
// object of the map, live, while the Inspector panel follows the selection. A window holds its object by key in the
// map it was opened in (generation), as the panel's padlock does. No DOM here: inspector-windows-view.js draws the
// windows and app.js its Inspector in each; tests/test_inspector_windows.mjs.

export const MAX_WINDOWS = 3;
// the events an Inspector handles: while one of them is handled, the window it happens in is the Inspector at work
// (app.js's lookups by id look in it first)
export const INSPECTOR_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerover', 'lostpointercapture',
  'click', 'dblclick', 'contextmenu', 'keydown', 'keyup', 'input', 'change', 'focusin', 'focusout', 'toggle', 'dragover', 'drop', 'wheel', 'paste'];

// What asking for a window of this object does: {open: its window when one is open already (brought to the front), close:
// the window to close to make room (the one used longest ago) or null}
export function windowFor(list, key, generation) {
  const open = list.find((w) => w.key === key && w.generation === generation) || null;
  return { open, close: !open && list.length >= MAX_WINDOWS ? list[0] : null };
}
// the list with this window used last (the order says which one closes first)
export function toFront(list, w) { return [...list.filter((x) => x !== w), w]; }

// where the n-th window opens: left of the Inspector panel (panel: its width), each one a step lower and to the left,
// inside the editor (width × height under its menu bar: top)
export function cascade(n, { width, height, panel = 0, top = 0 }, size = { w: 300, h: 520 }) {
  const step = 26 * (n % MAX_WINDOWS);
  const x = width - panel - size.w - 16 - step, y = top + 40 + step;
  return { x: Math.max(0, Math.min(x, width - size.w)), y: Math.max(top, Math.min(y, height - Math.min(size.h, height - top))) };
}
