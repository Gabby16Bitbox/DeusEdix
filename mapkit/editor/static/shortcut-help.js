// What the keys do in each mode of the 3D view, for the shortcut helper (shortcut-bar.js: the strip at the right of the
// status bar) and the search by key (Settings > Keyboard shortcuts > Press a key), as Unity's Shortcut Helper Bar and
// its Shortcuts window. A mode (placing, drawing, a patrol route, Edit vertices, a gizmo tool, flying...) has 4 to 8
// keys, and others for while Shift, Ctrl or Alt are held. A key is one of the menus' rebindable commands (menubar.js
// ACTIONS: its key is the user's, so rebinding changes what is shown), a command's key doing something else in that
// mode (R turns what is placed: the menus' layer turns the Scale tool's key into the editor's own R), or a key or a
// mouse gesture of that mode alone ([ ] , . of stairs, Enter and Backspace while drawing, Alt+drag copying...).
// No page code here.
//
// keymap (menubar.js): { keyOf(id): a command's key now, actions: [{ id, label, ctx }], contexts: { ctx: its name } }.
// A key is written as comboOf writes it (menubar.js): Ctrl, Alt, Shift in that order, then the key ('Ctrl+Shift+[').

// the modifiers in comboOf's order, and their flag on an event
const MODS = [['Ctrl', 'ctrlKey'], ['Alt', 'altKey'], ['Shift', 'shiftKey']];
const MOD_NAMES = MODS.map(([m]) => m);
// what the mouse does: these are not pressed, a modifier alone finds them (what holding it does with the mouse)
export const MOUSE = new Set(['click', 'double-click', 'drag', 'right-click', 'right-drag', 'Wheel']);
export const MAX_KEYS = 8;

// the commands' names on the strip, short (the whole name is in its tooltip and in Settings)
const SHORT = { save: 'Save', undo: 'Undo', redo: 'Redo', copy: 'Copy', paste: 'Paste', duplicate: 'Duplicate', delete: 'Delete',
  cut: 'Cut', selectall: 'Select all', invert: 'Invert', deselect: 'Deselect', selback: 'Previous selection', selnext: 'Next selection',
  move: 'Move', rotate: 'Rotate', scale: 'Scale', pivot: 'Center / Pivot', space: 'Global / Local', aim: 'Aim at pointer',
  alignview: 'Align with view', movetoview: 'Move to view', snap: 'Grid snap', drop: 'Drop', focus: 'Frame',
  viewtoselected: 'View from it', pilot: 'Pilot', pushgrid: 'Push to grid', gridless: 'Half grid', gridmore: 'Double grid',
  block: 'Block', paths: 'AI paths', light: 'Lighting', faces: 'Faces', vertices: 'Vertices', measure: 'Measure',
  isolate: 'Isolate', nest: 'Nest', unnest: 'Un-nest', palette: 'Search', help: 'Help',
  fwd: 'Forward', back: 'Back', left: 'Left', right: 'Right', down: 'Down', up: 'Up', cutkey: 'Add a key', cutplay: 'Play / pause' };

const digits = (mods) => Array.from({ length: 9 }, (_, i) => mods + (i + 1));
const LOOK = { key: 'right-drag', label: 'Look / fly', does: 'Right mouse held: look round; with W A S D, Q E: fly' };
const CANCEL = { key: 'Esc', label: 'Cancel', does: 'Stops placing: nothing is placed' };
const COPY = { key: 'Alt+drag', label: 'Copy (a handle)', does: 'Dragging a gizmo handle with Alt: a copy, moved (one Ctrl+Z)' };
const KEEP_PLACING = { Shift: [{ key: 'Shift+click', label: 'Place, keep going', does: 'Places one and keeps placing copies' }] };
const STEPS_45 = { Shift: [{ key: 'Shift', label: '45° steps', does: 'Held while drawing: the line keeps to steps of 45 degrees from the last point' }] };
const WIDTH = { key: ['[', ']'], show: '[ ]', label: 'Narrower / wider', does: 'Stairs or a roof 16 units narrower or wider' };
const STOP_DRAWING = { key: 'Esc', label: 'Cancel', does: 'Stops drawing: nothing is made' };
// what Shift, Ctrl and Alt do with the mouse where things are picked (selecting, and the gizmo's tools)
const PICKING = {
  Shift: [{ key: 'Shift+click', label: 'Add / remove', does: 'Adds what is under the pointer to the selection, or takes it out' },
    { key: 'Shift+drag', label: 'Box select', does: 'Selects what is inside the box drawn' },
    { key: 'Shift+Wheel', label: 'Zoom farther', does: 'The wheel moves the view three times as far' }],
  Ctrl: [{ key: 'Ctrl+click', label: 'Add / remove', does: 'Adds what is under the pointer to the selection, or takes it out' },
    { key: 'Ctrl+drag', label: 'Box select', does: 'Selects what is inside the box drawn' },
    { key: 'Ctrl+right-click', label: 'All under pointer', does: 'The list of everything under the pointer, to pick one' },
    { key: digits('Ctrl+'), show: 'Ctrl+1…9', label: 'Keep the view', does: 'Keeps the camera in bookmark 1…9 (1…9 goes back)' }],
  Alt: [{ key: 'Alt+click', label: 'Pick a face', does: 'Selects the face under the pointer: a wall, a floor, a ceiling' },
    { key: 'Alt+drag', label: 'Orbit', does: 'Turns the view round the selection (with none: round what is under the pointer)' },
    { key: 'Alt+right-drag', label: 'Dolly', does: 'Moves the view toward that point, or away from it' },
    { key: digits('Alt+'), show: 'Alt+1…9', label: 'Recall a selection', does: 'Selects again what slot 1…9 keeps' }],
  'Ctrl+Alt': [{ key: digits('Ctrl+Alt+'), show: 'Ctrl+Alt+1…9', label: 'Keep the selection', does: 'Keeps the selection in slot 1…9 (Alt+1…9 brings it back)' }],
};

// The modes: id, the name shown, the keys, the keys while modifiers are held (held: { 'Ctrl+Shift': [...] }), and the
// context whose commands with just those modifiers come after them (fill: 'edit' when not said). An entry is
// { action } (a command, its short name), { as: a command, label, does } (that command's key does this here) or
// { key: a key or several, show, label, does }.
export const MODES = [
  { id: 'select', label: 'Selecting', keys: [
    { key: 'click', label: 'Select', does: 'Selects what is under the pointer; again on the same spot: the next thing behind it' },
    LOOK, { action: 'palette' }, { action: 'block' }, { action: 'measure' }, { action: 'light' },
    { key: digits(''), show: '1…9', label: 'Kept views', does: 'Goes back to the view kept with Ctrl+1…9' }, { action: 'help' }],
  held: PICKING },
  { id: 'move', label: 'Move tool', keys: [{ action: 'rotate' }, { action: 'scale' }, { action: 'snap' }, { action: 'focus' },
    { action: 'drop' }, { action: 'space' },
    { as: 'vertices', label: 'Hold: corner snap', does: 'Held while the gizmo drags: the nearest corner goes onto the corner under the pointer' },
    { action: 'delete' }],
  held: { ...PICKING, Alt: [COPY, ...PICKING.Alt], 'Ctrl+Shift': [{ key: 'Ctrl+Shift+drag', label: 'Slide on surfaces',
    does: "Dragging the gizmo's middle square: it slides over what is under the pointer and rests on it" }] } },
  { id: 'rotate', label: 'Rotate tool', keys: [{ action: 'move' }, { action: 'scale' }, { action: 'snap' }, { action: 'aim' },
    { action: 'focus' }, { action: 'pivot' }, { action: 'space' }, { action: 'delete' }],
  held: { ...PICKING, Alt: [COPY, ...PICKING.Alt], 'Ctrl+Shift': [{ key: 'Ctrl+Shift+click', label: 'Aim at the point',
    does: 'The selection turns to look at the point clicked' }] } },
  { id: 'scale', label: 'Scale tool', keys: [{ action: 'move' }, { action: 'rotate' }, { action: 'snap' }, { action: 'focus' },
    { action: 'pivot' }, { action: 'space' }, { action: 'drop' }, { action: 'delete' }],
  held: { ...PICKING,
    Shift: [{ key: 'Shift+drag', label: 'Every side (a dot)', does: "Dragging a block's side dot: every side alike" }, ...PICKING.Shift],
    Alt: [{ key: 'Alt+drag', label: 'Both sides (a dot)', does: "Dragging a block's side dot: the opposite side moves too" }, COPY, ...PICKING.Alt] } },
  { id: 'place', label: 'Placing', keys: [{ key: 'click', label: 'Place', does: 'Places it on the floor or the wall clicked' },
    { as: 'scale', label: 'Turn 90°', does: 'Turns what is placed a quarter turn (kept for the next ones of its kind)' },
    { action: 'snap' }, CANCEL, LOOK], held: KEEP_PLACING },
  { id: 'block', label: 'Placing a block', keys: [{ key: 'click', label: 'Place', does: 'Places the block on the floor or the wall clicked' },
    { action: 'snap' }, CANCEL, LOOK], held: KEEP_PLACING },
  { id: 'draw', label: 'Drawing', keys: [{ key: 'click', label: 'A point', does: 'One more point of the wall, road, floor or ceiling' },
    { key: 'Enter', label: 'Finish', does: 'Ends the shape (a double-click, or its first point again, too)' },
    { key: 'Backspace', label: 'Undo point', does: 'Takes the last point back' }, STOP_DRAWING, { action: 'snap' }], held: STEPS_45 },
  { id: 'stairs', label: 'Drawing stairs', keys: [{ key: 'click', label: 'Start, then end', does: 'Where the stairs start, then where they arrive' },
    WIDTH, { key: [',', '.'], show: ', .', label: 'Lower / higher steps', does: 'Steps 2 units lower or higher' },
    STOP_DRAWING, { action: 'snap' }], held: STEPS_45 },
  { id: 'roof', label: 'Drawing a roof', keys: [{ key: 'click', label: 'Eave, then ridge', does: 'The eave, then the ridge (the top of the slope)' },
    WIDTH, STOP_DRAWING, { action: 'snap' }], held: STEPS_45 },
  { id: 'route', label: 'Patrol route', keys: [{ key: 'click', label: 'A point', does: 'One more point of the patrol route' },
    { key: ['Enter', 'Esc'], show: 'Enter / Esc', label: 'Done', does: 'Ends the patrol route (it is walked in a loop)' },
    { action: 'snap' }, LOOK] },
  { id: 'vertices', label: 'Edit vertices', keys: [{ key: 'click', label: 'Pick a corner', does: 'Picks the corner under the pointer: the gizmo moves it' },
    { action: 'delete', label: 'Delete corners', does: 'Takes the picked corners away' }, { action: 'snap' },
    { action: 'vertices', label: 'End', does: 'Ends Edit vertices' }, { key: 'Esc', label: 'End', does: 'Ends Edit vertices' }],
  held: { Shift: [{ key: 'Shift+click', label: 'One more corner', does: 'Picks one more corner (or lets one go)' }],
    Ctrl: [{ key: 'Ctrl+click', label: 'One more corner', does: 'Picks one more corner (or lets one go)' }] } },
  { id: 'measure', label: 'Measure', keys: [{ key: 'click', label: 'A point', does: 'A point of the measure (two make one, a third starts again)' },
    { action: 'snap' }, { action: 'measure', label: 'End', does: 'Ends Measure' }, { key: 'Esc', label: 'End', does: 'Ends Measure' }, LOOK] },
  { id: 'faces', label: 'Face selection', keys: [{ key: 'click', label: 'Pick a face', does: 'Selects the face under the pointer' },
    { action: 'faces', label: 'End', does: 'Back to selecting objects' }, { action: 'undo' }, LOOK],
  held: { Shift: [{ key: 'Shift+click', label: 'One more face', does: 'Adds a face to the faces selected' }] } },
  { id: 'aim', label: 'Aim', keys: [{ key: 'click', label: 'The point', does: 'The selection turns to look at the point clicked' },
    { key: 'Esc', label: 'Cancel', does: 'Cancels Aim at a point' }, { action: 'undo' }, LOOK] },
  { id: 'pilot', label: 'Pilot', keys: [{ key: 'right-drag', label: 'Fly it', does: 'Right mouse held and W A S D: the view flies, the piloted object goes along' },
    { key: 'Wheel', label: 'Forward / back', does: 'While piloting: the view goes forward or back, the object along' },
    { action: 'pilot', label: 'End', does: 'Ends the pilot: the object stays where the view took it' },
    { key: 'Esc', label: 'End', does: 'Ends the pilot: the object stays where the view took it' }] },
  { id: 'fly', label: 'Flying', fill: 'fly', keys: [{ action: 'fwd' }, { action: 'back' }, { action: 'left' }, { action: 'right' },
    { action: 'up' }, { action: 'down' }, { key: 'Shift', label: 'Faster', does: 'Held while flying: three times faster' },
    { key: 'Wheel', label: 'Speed', does: 'While flying: the fly speed (kept in Settings > Camera)' }] },
  { id: 'cutscene', label: 'Cutscene', keys: [{ action: 'cutkey' }, { action: 'cutplay' },
    { key: 'Esc', label: 'Stop', does: 'Stops playing, or stops looking through the camera' }, LOOK] },
];
const MODE = Object.fromEntries(MODES.map((m) => [m.id, m]));
const TOOLS = { translate: 'move', rotate: 'rotate', scale: 'scale' };      // the gizmo's mode (three.js) -> the mode
const DRAWN = { stairs: 'stairs', roof: 'roof' };      // what is drawn with keys of its own (the rest: 'draw')

// the mode the 3D view is in, from what app.js says (shortcutState): the first that holds, the most particular first.
// s: { map, fly, pilot, aim, route, draw: its kind, place: 'object' | 'block', vertices, measure, faces, cutscene,
// selected, tool: the gizmo's mode }; '' without a map
export function modeOf(s) {
  if (!s || !s.map) return '';
  if (s.fly) return 'fly';
  if (s.pilot) return 'pilot';
  if (s.aim) return 'aim';
  if (s.route) return 'route';
  if (s.draw) return DRAWN[s.draw] || 'draw';
  if (s.place) return s.place === 'block' ? 'block' : 'place';
  if (s.vertices) return 'vertices';
  if (s.measure) return 'measure';
  if (s.faces) return 'faces';
  if (s.cutscene) return 'cutscene';
  if (s.selected) return TOOLS[s.tool] || 'move';
  return 'select';
}

// the modifiers held on an event, in comboOf's order ('Ctrl+Shift'), '' for none. The modifier a key event is about
// counts as held when pressed (its own keydown may not say so) and not when let go.
const MOD_KEYS = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
export function modsOf(e) {
  const own = MOD_KEYS[e.key];
  return MODS.filter(([m, flag]) => (own === m ? e.type !== 'keyup' : !!e[flag])).map(([m]) => m).join('+');
}
// a key: its modifiers (in comboOf's order) and the rest ('' for a modifier alone); 'Shift++' is Shift and +
export function splitCombo(combo) {
  const m = /^((?:(?:Ctrl|Alt|Shift)\+)*)(.*)$/.exec(String(combo || ''));
  const mods = m[1].split('+').filter(Boolean);
  let key = m[2];
  if (MOD_NAMES.includes(key)) { mods.push(key); key = ''; }
  return { mods: MOD_NAMES.filter((x) => mods.includes(x)).join('+'), key };
}
const joinCombo = ({ mods, key }) => (mods && key ? `${mods}+${key}` : mods || key);
export const normCombo = (combo) => joinCombo(splitCombo(combo));
const withoutShift = (mods) => mods.split('+').filter((m) => m && m !== 'Shift').join('+');

const actionOf = (keymap, id) => keymap.actions.find((a) => a.id === id);
// an entry with its keys now: { keys: [combos], show: as written on the strip, label, does, action: the command it is }
function resolve(e, keymap) {
  const id = e.action || e.as, keys = (id ? [keymap.keyOf(id)] : [].concat(e.key)).map(normCombo);
  const full = e.action ? actionOf(keymap, e.action)?.label : '';
  const label = e.label || SHORT[e.action] || full || '';
  return { keys, show: e.show || keys.join(' '), label, does: e.does || full || label, action: e.action || '' };
}
const entriesOf = (mode) => [mode.keys, ...Object.values(mode.held || {})].flat();

// The keys of the strip for mode `id` with the modifiers `mods` held ('Ctrl+Shift', '' for none): the mode's own for
// them, then its context's commands with just those modifiers; with nothing for them, the mode's keys as they are.
// { id, label, mods: what the keys are for ('' when the mode's own), items: [resolve's], at most MAX_KEYS } or null
export function stripFor(id, mods, keymap) {
  const mode = MODE[id];
  if (!mode) return null;
  let held = [];
  if (mods) {
    const ctx = mode.fill || 'edit';
    held = [...(mode.held?.[mods] || []), ...keymap.actions
      .filter((a) => a.ctx === ctx && splitCombo(keymap.keyOf(a.id)).mods === mods).map((a) => ({ action: a.id }))];
  }
  const items = [];
  for (const r of (held.length ? held : mode.keys).map((e) => resolve(e, keymap))) {
    if (!items.some((x) => (r.action ? x.action === r.action : x.show === r.show && x.label === r.label))) items.push(r);
  }
  return { id, label: mode.label, mods: held.length ? mods : '', items: items.slice(0, MAX_KEYS) };
}

// What `query` does in each context: a key as comboOf writes it, a mouse gesture ('Shift+click'), or a modifier alone
// (then what holding it does with the mouse). First the commands with that key, in their context (flying leaves Shift
// out: it only flies faster), then each mode's own keys, and a command where it does something else there (Delete in
// Edit vertices). [{ key, does, where: [context and mode names], action: the command, '' for a mode's own }]
export function findKey(query, keymap) {
  const q = splitCombo(query);
  if (!q.mods && !q.key) return [];
  const hits = (combo, fly = false) => {
    const k = splitCombo(combo);
    if (!q.key) return k.mods === q.mods && (!k.key || MOUSE.has(k.key));
    return k.key === q.key && k.mods === (fly ? withoutShift(q.mods) : q.mods);
  };
  const out = [];
  const add = (key, does, where, action) => {
    let f = out.find((x) => x.key === key && x.does === does && x.action === action);
    if (!f) out.push(f = { key, does, where: [], action });
    if (!f.where.includes(where)) f.where.push(where);
  };
  for (const a of keymap.actions) {
    const key = keymap.keyOf(a.id);
    if (hits(key, a.ctx === 'fly')) add(normCombo(key), a.label, keymap.contexts[a.ctx] || a.ctx, a.id);
  }
  for (const mode of MODES) for (const e of entriesOf(mode)) {
    if (e.action && !e.does) continue;                     // the command itself: listed above
    const r = resolve(e, keymap);
    if (r.keys.some((k) => hits(k))) add(r.show, r.does, mode.label, '');
  }
  return out;
}
