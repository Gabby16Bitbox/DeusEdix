// Saved window layouts and the maximized panel, as Unity's Layout menu and Window > Maximize View (Shift+Space).
// A layout is what workspace.js getState gives (where each panel is docked, how wide the docks are, which tab is in
// front), kept under a name of the user's in this browser for every project, and written to or read from a JSON
// file. No DOM here: workspace.js keeps and applies them, menubar.js lists them; tests/test_window_layouts.mjs.

export const MAX_LAYOUTS = 10;             // the Window menu lists them all
export const NAME_LENGTH = 40;
const FILE_KIND = 'deusedix-layouts';      // what Export writes, so that Import knows the file

// a name as it is kept: trimmed, its spaces one, at most NAME_LENGTH letters; throws when nothing is left
export function layoutName(text) {
  const name = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_LENGTH).trim();
  if (!name) throw new Error('Give the layout a name.');
  return name;
}
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
export function findLayout(list, name) { return list.find((l) => same(l.name, name)) || null; }

// the list with this state under this name: a name already there (in any case) is replaced where it is, a new one
// goes last; one more than MAX_LAYOUTS throws
export function withLayout(list, name, state) {
  const clean = layoutName(name), entry = { name: clean, state };
  if (findLayout(list, clean)) return list.map((l) => (same(l.name, clean) ? entry : l));
  if (list.length >= MAX_LAYOUTS) throw new Error(`At most ${MAX_LAYOUTS} layouts are kept: delete one first (Window > Delete layout…).`);
  return [...list, entry];
}
export function withoutLayout(list, name) { return list.filter((l) => !same(l.name, name)); }

// the layouts as they were kept, or as a file gives them: [{name, state}], each state checked by validate (workspace.js
// validateLayout), each name cleaned and taken once, at most MAX_LAYOUTS; anything else is left out
export function readLayouts(value, validate) {
  let list = [];
  for (const l of Array.isArray(value) ? value : []) {
    let name;
    try { name = layoutName(l?.name); } catch { continue; }
    if (!l.state || typeof l.state !== 'object' || findLayout(list, name) || list.length >= MAX_LAYOUTS) continue;
    list = [...list, { name, state: validate(l.state) }];
  }
  return list;
}

// Export: every saved layout in one file
export function layoutsFile(list) { return JSON.stringify({ kind: FILE_KIND, version: 1, layouts: list }, null, 1); }

// Import: the layouts of a file put into the list (one with a name already there replaces it). The file is Export's,
// or a single layout as getState gives it (it takes the file's name). {list, names (those put in)}; throws when the
// file holds no layout, or when they would be too many
export function importLayouts(list, text, validate, fileName = 'Imported') {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('This file is not JSON.'); }
  const given = data?.kind === FILE_KIND ? data.layouts
    : data?.version === 1 && data.panels ? [{ name: String(fileName).replace(/\.json$/i, ''), state: data }] : null;
  const read = readLayouts(given, validate);
  if (!read.length) throw new Error('This file holds no window layout of DeusEdix.');
  let out = list;
  for (const l of read) out = withLayout(out, l.name, l.state);
  return { list: out, names: read.map((l) => l.name) };
}

// Maximize (Shift+Space): what is under the pointer ('left', 'right', 'bottom' for a dock, 'view' for the 3D view, null
// for nothing that can be maximized) fills the editor; pressed again (or Esc), the layout is back
export function nextMaximized(current, under) { return current ? null : under || null; }
// a panel the maximized one does not cover: a floating one, one in the dock maximized; the 3D view maximized covers every
// docked panel (with nothing maximized, none is covered)
export const uncovered = (panel, maximized) => !maximized || panel.dock === 'float' || panel.dock === maximized;
// the layout as it is shown while maximized: the 3D view maximized hides every docked panel (floating panels stay); a
// dock maximized covers the rest without changing it (workspace.css). The real layout is never changed.
export function shownLayout(layout, maximized) {
  if (maximized !== 'view') return layout;
  return { ...layout, panels: Object.fromEntries(Object.entries(layout.panels)
    .map(([id, p]) => [id, uncovered(p, maximized) ? p : { ...p, hidden: true }])) };
}
