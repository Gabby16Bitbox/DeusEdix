// The shortcut helper's modes and the search by key (static/shortcut-help.js), against the menus' own commands
// (static/menubar.js ACTIONS and CONTEXTS, read from its source): the strip follows rebinding, Shift, Ctrl and Alt
// change it, a key is found in every context it works in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { MODES, MAX_KEYS, MOUSE, modeOf, modsOf, splitCombo, normCombo, stripFor, findKey } from '../editor/static/shortcut-help.js';

// the menus' commands as menubar.js has them (that module needs a page)
const source = readFileSync(new URL('../editor/static/menubar.js', import.meta.url), 'utf8');
const block = (name) => { const at = source.indexOf(`const ${name} = `); return source.slice(at, source.indexOf(';', at) + 1); };
const menus = vm.createContext({});
vm.runInContext(`${block('ACTIONS')}\n${block('CONTEXTS')}\nthis.ACTIONS = ACTIONS; this.CONTEXTS = CONTEXTS;`, menus);
const ACTIONS = menus.ACTIONS.map(([id, label, def, ctx]) => ({ id, label, def, ctx }));
const keymapWith = (keys = {}) => ({ keyOf: (id) => keys[id] || ACTIONS.find((a) => a.id === id).def, actions: ACTIONS, contexts: menus.CONTEXTS });
const keymap = keymapWith();
const shown = (strip) => strip.items.map((i) => `${i.show} ${i.label}`);
const entries = (mode) => [mode.keys, ...Object.values(mode.held || {})].flat();

test('every command a mode names is one of the menus, in a context that works there', () => {
  const ids = new Set(ACTIONS.map((a) => a.id));
  for (const mode of MODES) for (const e of entries(mode)) for (const id of e.actions || [e.action || e.as].filter(Boolean)) {
    assert.ok(ids.has(id), `${mode.id}: ${id}`);
    const ctx = ACTIONS.find((a) => a.id === id).ctx;
    // Face selection's own commands are of its context (menubar.js: faces, over the 3D view's while it is on)
    const works = { fly: ['fly'], cutscene: [id.startsWith('cut') ? 'cut' : 'edit'], faces: ['faces', 'edit'] }[mode.id] || ['edit'];
    assert.ok(works.includes(ctx), `${mode.id}: ${id} (${ctx})`);
  }
});

test('every command on the strip has its short name, never the menus\' whole sentence', () => {
  const held = ['', ...new Set(ACTIONS.map((a) => splitCombo(a.def).mods).filter(Boolean))];
  for (const mode of MODES) for (const mods of held) for (const item of stripFor(mode.id, mods, keymap).items) {
    if (!item.action) continue;
    const full = ACTIONS.find((a) => a.id === item.action).label;
    assert.ok(item.label !== full || full.length <= 20, `${mode.id} ${mods || '(none)'}: ${item.show} "${item.label}"`);
  }
  assert.equal(stripFor('select', 'Shift', keymap).items.find((i) => i.action === 'maximize')?.label, 'Maximize');
});

test('each mode has 4 to 8 keys, and the keys held are written with exactly those modifiers', () => {
  for (const mode of MODES) {
    assert.ok(mode.keys.length >= 4 && mode.keys.length <= MAX_KEYS, `${mode.id}: ${mode.keys.length} keys`);
    for (const [mods, list] of Object.entries(mode.held || {})) {
      assert.equal(normCombo(mods), mods, `${mode.id}: ${mods} in comboOf's order`);
      for (const e of list) for (const k of e.actions ? e.actions.map((id) => keymap.keyOf(id)) : [].concat(e.key))
        assert.equal(splitCombo(k).mods, mods, `${mode.id}: ${k} under ${mods}`);
    }
    for (const mods of ['', 'Shift', 'Ctrl', 'Alt', 'Ctrl+Shift', 'Ctrl+Alt']) {
      const strip = stripFor(mode.id, mods, keymap);
      assert.ok(strip.items.length >= 1 && strip.items.length <= MAX_KEYS, `${mode.id} ${mods}`);
      assert.ok(strip.items.every((i) => i.show && i.label && i.does), `${mode.id} ${mods}: every key named`);
    }
  }
  assert.equal(stripFor('nothing', '', keymap), null);
});

test('the mode: the most particular first', () => {
  const at = (s) => modeOf({ map: true, ...s });
  assert.equal(modeOf(null), '');
  assert.equal(modeOf({ map: false, selected: true }), '');                 // no map, or the game played: no strip
  assert.equal(at({}), 'select');
  assert.equal(at({ selected: true, tool: 'translate' }), 'move');
  assert.equal(at({ selected: true, tool: 'rotate' }), 'rotate');
  assert.equal(at({ selected: true, tool: 'scale' }), 'scale');
  assert.equal(at({ selected: true, tool: 'scale', fly: true }), 'fly');   // the right button held wins
  assert.equal(at({ draw: 'wall', selected: true }), 'draw');
  assert.equal(at({ draw: 'stairs' }), 'stairs');
  assert.equal(at({ draw: 'roof' }), 'roof');
  assert.equal(at({ place: 'object' }), 'place');
  assert.equal(at({ place: 'block' }), 'block');
  assert.equal(at({ route: true, place: 'object' }), 'route');
  assert.equal(at({ vertices: true, selected: true, tool: 'translate' }), 'vertices');
  assert.equal(at({ measure: true }), 'measure');
  assert.equal(at({ faces: true }), 'faces');
  assert.equal(at({ slip: true, faces: true, selected: true, tool: 'translate' }), 'slip');   // a Texture Slip going on
  assert.equal(at({ slip: true, fly: true }), 'fly');
  assert.equal(at({ aim: true, selected: true, tool: 'rotate' }), 'aim');
  assert.equal(at({ pilot: true, selected: true }), 'pilot');
  assert.equal(at({ cutscene: true, selected: true, tool: 'translate' }), 'cutscene');
  assert.equal(at({ cutscene: true, place: 'object' }), 'place');
  for (const mode of MODES) assert.ok(['select', 'move', 'rotate', 'scale', 'draw', 'stairs', 'roof', 'place', 'block', 'route', 'vertices',
    'measure', 'faces', 'slip', 'aim', 'pilot', 'fly', 'cutscene'].includes(mode.id), mode.id);
});

test('modifiers and keys as comboOf writes them', () => {
  assert.equal(modsOf({ ctrlKey: true, shiftKey: true }), 'Ctrl+Shift');
  assert.equal(modsOf({ altKey: true, ctrlKey: true, shiftKey: true }), 'Ctrl+Alt+Shift');
  assert.equal(modsOf({}), '');
  assert.equal(modsOf({ type: 'keydown', key: 'Alt', altKey: false }), 'Alt');        // Alt pressed alone
  assert.equal(modsOf({ type: 'keydown', key: 'Control', shiftKey: true }), 'Ctrl+Shift');
  assert.equal(modsOf({ type: 'keyup', key: 'Shift', shiftKey: true, ctrlKey: true }), 'Ctrl');   // Shift let go
  assert.equal(modsOf({ type: 'pointermove', shiftKey: true }), 'Shift');
  assert.deepEqual(splitCombo('Ctrl+Shift+['), { mods: 'Ctrl+Shift', key: '[' });
  assert.deepEqual(splitCombo('Shift++'), { mods: 'Shift', key: '+' });
  assert.deepEqual(splitCombo('Alt'), { mods: 'Alt', key: '' });
  assert.deepEqual(splitCombo('Shift+click'), { mods: 'Shift', key: 'click' });
  assert.equal(normCombo('Shift+Ctrl+Z'), 'Ctrl+Shift+Z');
  assert.ok(MOUSE.has('click') && MOUSE.has('right-drag'));
});

test('the strip of a mode: its own keys, the commands with the user\'s keys', () => {
  assert.deepEqual(shown(stripFor('place', '', keymap)), ['click Place', 'R Turn 90°', 'G Grid snap', 'Esc Cancel', 'right-drag Look / fly']);
  assert.deepEqual(shown(stripFor('stairs', '', keymap)).slice(1, 3), ['[ ] Narrower / wider', ', . Lower / higher steps']);
  assert.deepEqual(shown(stripFor('draw', '', keymap)).slice(1, 3), ['Enter Finish', 'Backspace Undo point']);
  const move = stripFor('move', '', keymap);
  assert.equal(move.label, 'Move tool');
  assert.deepEqual(move.items.slice(0, 2).map((i) => [i.show, i.action]), [['E', 'rotate'], ['R', 'scale']]);
  assert.equal(move.items[0].does, 'Rotate tool');                          // the tooltip: the command's whole name
  // Settings gave Scale another key: the strip says so, in the gizmo's keys and as the key that turns what is placed
  const moved = keymapWith({ scale: 'J' });
  assert.equal(stripFor('move', '', moved).items[1].show, 'J');
  assert.equal(stripFor('place', '', moved).items[1].show, 'J');
  assert.equal(stripFor('place', '', moved).items[1].action, '');           // not the Scale tool there: a click searches the key
});

test('Face selection\'s Slip, and the Texture Slip\'s own keys, nothing else while it goes on', () => {
  assert.ok(shown(stripFor('faces', '', keymap)).includes('Y Slip'));
  assert.equal(stripFor('faces', '', keymap).items.find((i) => i.action === 'faceslip').does, 'Slip the texture (move: roll it, wheel: size it)');
  assert.deepEqual(shown(stripFor('slip', '', keymap)), ['Move Roll it', 'Wheel Larger / smaller', 'Arrows Nudge', 'P One pan for all',
    'click / Enter Keep it', 'Esc / right-click Cancel']);
  assert.deepEqual(shown(stripFor('slip', 'Shift', keymap)), ['Shift Finer']);
  assert.deepEqual(shown(stripFor('slip', 'Ctrl', keymap)), ['Ctrl Snap']);            // no Ctrl+Z, Ctrl+S...: they cancel it
  assert.deepEqual(shown(stripFor('slip', 'Alt', keymap)), shown(stripFor('slip', '', keymap)));
  // Settings gave the Slip another key: the strip says so; P, the arrows and Enter are the slip's while it goes on
  assert.ok(shown(stripFor('faces', '', keymapWith({ faceslip: 'J' }))).includes('J Slip'));
  const p = findKey('P', keymap);
  assert.ok(p.some((x) => x.where.includes('Texture Slip') && /^Every face the pan/.test(x.does)));
  assert.ok(p.some((x) => x.action === 'paths'));
  assert.deepEqual(findKey('Y', keymap).map((x) => [x.action, x.where]), [['faceslip', ['In the 3D view']]]);
});

test('Shift, Ctrl or Alt held: what they do now in that mode', () => {
  const ctrl = stripFor('select', 'Ctrl', keymap);
  assert.equal(ctrl.mods, 'Ctrl');
  assert.deepEqual(shown(ctrl).slice(0, 2), ['Ctrl+click Add / remove', 'Ctrl+drag Box select']);
  assert.ok(shown(ctrl).includes('Ctrl+Z Undo'));                         // the commands with Ctrl alone come after
  assert.ok(!shown(ctrl).some((k) => k.startsWith('Ctrl+Shift')));
  assert.equal(ctrl.items.length, MAX_KEYS);
  assert.deepEqual(shown(stripFor('move', 'Alt', keymap)).slice(0, 2), ['Alt+drag Copy (a handle)', 'Alt+click Pick a face']);
  assert.equal(shown(stripFor('rotate', 'Ctrl+Shift', keymap))[0], 'Ctrl+Shift+click Aim at the point');
  assert.equal(shown(stripFor('move', 'Ctrl+Shift', keymap))[0], 'Ctrl+Shift+drag Slide on surfaces');
  assert.ok(shown(stripFor('move', 'Ctrl+Shift', keymap)).includes('Ctrl+Shift+[ Previous selection'));
  assert.deepEqual(shown(stripFor('draw', 'Shift', keymap))[0], 'Shift 45° steps');
  assert.deepEqual(shown(stripFor('place', 'Shift', keymap))[0], 'Shift+click Place, keep going');
  // nothing for Alt while placing: the mode's own keys stay
  const alt = stripFor('place', 'Alt', keymap);
  assert.equal(alt.mods, '');
  assert.deepEqual(shown(alt), shown(stripFor('place', '', keymap)));
  // flying: its keys whatever is held (Shift only flies faster)
  assert.deepEqual(shown(stripFor('fly', 'Shift', keymap)), shown(stripFor('fly', '', keymap)));
  // a command rebound to other modifiers comes with them, and no longer with its old ones
  const rebound = keymapWith({ help: 'Ctrl+Shift+H', save: 'Alt+S' });
  assert.ok(shown(stripFor('measure', 'Ctrl+Shift', rebound)).includes('Ctrl+Shift+H Help'));
  assert.ok(!shown(stripFor('measure', 'Ctrl', rebound)).includes('Ctrl+S Save'));
  assert.deepEqual(shown(stripFor('place', 'Alt', rebound)), ['Alt+S Save']);
});

test('a key found in every context it works in', () => {
  const said = (q, km = keymap) => findKey(q, km).map((f) => `${f.key}: ${f.does} @ ${f.where.join(', ')}`);
  assert.deepEqual(said('R'), ['R: Scale tool @ In the 3D view',
    'R: Turns what is placed a quarter turn (kept for the next ones of its kind) @ Placing']);
  assert.deepEqual(findKey('W', keymap).map((f) => f.action), ['move', 'fwd']);
  assert.deepEqual(findKey('Shift+W', keymap).map((f) => f.action), ['fwd']);  // flying: Shift only faster
  assert.ok(said('Enter').some((s) => s.startsWith('Enter: Ends the shape') && s.endsWith('@ Drawing')));
  assert.ok(said('Enter').some((s) => s.endsWith('@ Patrol route')));
  assert.deepEqual(said('['), ['[ ]: Stairs or a roof 16 units narrower or wider @ Drawing stairs, Drawing a roof']);
  assert.ok(said(',').some((s) => s.includes('Steps 2 units lower')));
  // a command doing something else in a mode is said there too
  assert.deepEqual(said('Delete'), ['Delete: Delete @ In the 3D view', 'Delete: Takes the picked corners away @ Edit vertices']);
  assert.ok(said('K').includes('K: Cutscene: add a key @ Cutscene panel open'));
  assert.deepEqual(said('Alt+3'), ['Alt+3: Apply recent texture 3 @ Face selection',
    'Alt+1…9: Selects again what slot 1…9 keeps @ Selecting, Move tool, Rotate tool, Scale tool']);
  // rebinding: the old key no longer turns what is placed, the new one does
  const moved = keymapWith({ scale: 'J' });
  assert.deepEqual(said('R', moved), []);
  assert.equal(findKey('J', moved).length, 2);
  assert.deepEqual(findKey('F12', keymap), []);
  assert.deepEqual(findKey('', keymap), []);
});

test('a modifier alone: what holding it does with the mouse', () => {
  const alt = findKey('Alt', keymap);
  assert.ok(alt.length >= 4 && alt.every((f) => f.key.startsWith('Alt+') && !f.action));
  assert.ok(alt.some((f) => f.key === 'Alt+drag' && f.does.includes('a copy')));
  const shift = findKey('Shift', keymap).map((f) => `${f.key} @ ${f.where.join(', ')}`);
  assert.ok(shift.includes('Shift @ Flying') && shift.some((s) => s.startsWith('Shift @ Drawing')));
  assert.ok(!shift.some((s) => s.startsWith('Shift+D')));                    // keys are not listed for a modifier alone
  assert.ok(findKey('Ctrl+Shift', keymap).some((f) => f.key === 'Ctrl+Shift+click'));
  assert.deepEqual(findKey('Shift+click', keymap).map((f) => f.where[0]), ['Selecting', 'Placing', 'Edit vertices', 'Face selection']);
});

// Face selection's keys: Grow and Grow (any angle) with the mode's own, with Alt held the ten recent textures as one
// entry (their own keys, or each written out once one has another) before Grow, the 3D view's commands with Alt after
test('Face selection: Grow, and Alt+1…0 for the recent textures', () => {
  assert.deepEqual(shown(stripFor('faces', '', keymap)).slice(0, 4), ['click Pick a face', 'Q End', 'Alt+G Grow', 'Alt+Shift+G Grow (any angle)']);
  const alt = stripFor('faces', 'Alt', keymap);
  assert.equal(alt.mods, 'Alt');
  assert.deepEqual(shown(alt), ['Alt+1…0 Recent texture', 'Alt+G Grow']);
  assert.deepEqual(alt.items[0].keys, ['Alt+1', 'Alt+2', 'Alt+3', 'Alt+4', 'Alt+5', 'Alt+6', 'Alt+7', 'Alt+8', 'Alt+9', 'Alt+0']);
  assert.deepEqual(shown(stripFor('faces', 'Alt+Shift', keymap)), ['Alt+Shift+G Grow (any angle)']);
  // a recent texture given another key: the entry says every key, and that one no longer comes with Alt alone
  const moved = keymapWith({ facetex3: 'Ctrl+Alt+3', facegrow: 'Alt+J' });
  const altMoved = stripFor('faces', 'Alt', moved);
  assert.equal(altMoved.items[0].show, 'Alt+1 Alt+2 Ctrl+Alt+3 Alt+4 Alt+5 Alt+6 Alt+7 Alt+8 Alt+9 Alt+0');
  assert.deepEqual(shown(altMoved).slice(1), ['Alt+J Grow']);
  assert.ok(shown(stripFor('faces', 'Ctrl+Alt', moved)).includes('Ctrl+Alt+click Lights here'));
  // anywhere else Alt+1…9 are the selection slots' still
  assert.deepEqual(shown(stripFor('select', 'Alt', keymap)).slice(-1), ['Alt+1…9 Recall a selection']);
  assert.ok(!shown(stripFor('move', 'Alt', keymap)).some((k) => k.includes('Texture') || k.includes('Grow')));
  assert.deepEqual(findKey('Alt+G', keymap).map((f) => `${f.key}: ${f.does} @ ${f.where.join(', ')}`),
    ['Alt+G: Grow the face selection (faces in its plane) @ Face selection']);
});

// Ctrl+Alt+click lists the lamps lighting a point (Lights here), where things are picked and in Face selection
test('Ctrl+Alt held: Lights here with the mouse first', () => {
  for (const mode of ['select', 'move', 'faces']) assert.equal(shown(stripFor(mode, 'Ctrl+Alt', keymap))[0], 'Ctrl+Alt+click Lights here', mode);
  assert.ok(shown(stripFor('select', 'Ctrl+Alt', keymap)).includes('Ctrl+Alt+1…9 Keep the selection'));
});
