// The map's undo history with a name for each step, as Unity's Undo History window and its Edit menu ("Undo Move 3
// objects"). A step is the edits as a change found them (their JSON) and the change's short name, kept together: the
// name goes wherever its snapshot goes (undone, redone, taken back by a drag that changed nothing, dropped by the cap).
// The logic only, without the page: app.js keeps the history of the map open (it is not kept across a reload, nor a
// Rebuild, which loads the map again: the edits themselves are saved and autosaved), history-panel.js lists it.

export const HISTORY_LIMIT = 100;          // steps kept: past it the oldest goes
export const MAP_OPENED = 'Map opened';    // the bottom of the list: the map as it was opened
export const OLDEST_KEPT = `Before the oldest step kept (${HISTORY_LIMIT} at most)`;   // the bottom once the cap dropped steps
export const UNNAMED = 'Change';           // a step whose change gave no name
const LONGEST = 60;                        // a name is one short line

// undo: the steps Ctrl+Z takes back, the last one first; redo: those Ctrl+Y brings back, the last one first;
// trimmed: the cap dropped steps (the bottom is no longer the map as it was opened); kept: what the last step recorded
// took away (recordStep), for dropStep to give it back
export function createHistory() { return { undo: [], redo: [], trimmed: false, kept: null }; }
// another map, or the same one opened again: no steps
export function clearHistory(h) { h.undo.length = 0; h.redo.length = 0; h.trimmed = false; h.kept = null; }

// a name as it is kept and shown: one line, at most LONGEST characters, UNNAMED for none
export function stepName(label) {
  const text = String(label ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return UNNAMED;
  return text.length > LONGEST ? text.slice(0, LONGEST - 1).trimEnd() + '…' : text;
}
// What a change did and to what: "Move Light4" for one thing, "Move 3 objects" for several, the verb alone for none;
// tail after them ("Align Light4 with the view")
export function namedStep(verb, names, tail = '') {
  const what = names.length === 1 ? names[0] : names.length ? `${names.length} objects` : '';
  return [verb, what, tail].filter(Boolean).join(' ');
}
// a property's name as a step says it: "LightBrightness" is "Light brightness", "bHidden" "Hidden", "AIHorizon"
// "AI horizon" (a word in capitals stays so)
export function propertyName(key) {
  const words = String(key).replace(/^b(?=[A-Z])/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(' ');
  return words.map((w, i) => (i && !/^[A-Z0-9]+$/.test(w) ? w.toLowerCase() : w)).join(' ');
}

// a change about to be made: state, the edits before it; label, its name. The steps Redo had go (they followed
// another past); past the cap the oldest goes. Both are kept aside until the next step, or a step back or forward
export function recordStep(h, state, label, limit = HISTORY_LIMIT) {
  const step = { state, label: stepName(label) };
  h.undo.push(step);
  const oldest = h.undo.length > limit ? h.undo.splice(0, h.undo.length - limit) : [];
  h.kept = { step, redo: h.redo.splice(0), oldest, trimmed: h.trimmed };
  if (oldest.length) h.trimmed = true;
}
// The last step taken back unused (a click on the gizmo or an animation key that moved nothing, a pool with no floor
// under it): with its name, and with what recording it took away given back (Redo's steps, the oldest step), so the
// history is as if it had never been: a click does not empty Redo
export function dropStep(h) {
  const step = h.undo.pop() || null, kept = h.kept;
  h.kept = null;
  if (step && kept?.step === step) { h.redo.push(...kept.redo); h.undo.unshift(...kept.oldest); h.trimmed = kept.trimmed; }
  return step;
}
// the last step named again (an Alt copy that the drag went on to move is one step: "Duplicate and move")
export function renameStep(h, label) { const s = h.undo.at(-1); if (s) s.label = stepName(label); }
// One step back (way 'undo') or forward ('redo'). now: the edits now (JSON), the way back to them. Returns the step
// taken ({state: the edits to put in place, label}), or null when there is none that way
export function travelStep(h, way, now) {
  h.kept = null;                           // past the last step recorded: nothing to give back any more
  const [from, to] = way === 'undo' ? [h.undo, h.redo] : [h.redo, h.undo];
  const s = from.pop();
  if (!s) return null;
  to.push({ state: now, label: s.label });
  return s;
}

// Edit > Undo and Redo with the name of the step they take ("Undo Move 3 objects"); the word alone with none
export function menuLabel(h, way) {
  const s = (way === 'undo' ? h.undo : h.redo).at(-1), verb = way === 'undo' ? 'Undo' : 'Redo';
  return s ? `${verb} ${s.label}` : verb;
}
// the name of the step the map is at now (the bottom's when every step is undone)
export function currentName(h) { return h.undo.at(-1)?.label ?? bottomName(h); }
const bottomName = (h) => (h.trimmed ? OLDEST_KEPT : MAP_OPENED);

// The History panel's rows, newest first: the steps Redo would bring back (redo), the one the map is at (current), the
// steps behind it, and at the bottom the map as it was opened (bottom). at: the steps from now to that row (below
// zero: that many undone; above: redone), what a click on it does (stepsTo)
export function historyRows(h) {
  const rows = h.redo.map((s, i) => ({ label: s.label, at: h.redo.length - i, redo: true }));
  for (let i = h.undo.length - 1; i >= 0; i--) rows.push({ label: h.undo[i].label, at: i + 1 - h.undo.length });
  rows.push({ label: bottomName(h), at: -h.undo.length, bottom: true });
  for (const r of rows) r.current = r.at === 0;
  return rows;
}
// what a row's at takes: way 'undo' or 'redo', count steps (0: the map is there already)
export function stepsTo(at) { return { way: at < 0 ? 'undo' : 'redo', count: Math.abs(at) }; }
