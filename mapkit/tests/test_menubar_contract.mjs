import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { TABLES } from '../editor/static/object-table.js';
import { MAX_LAYOUTS } from '../editor/static/window-layouts.js';

const source = readFileSync(new URL('../editor/static/menubar.js', import.meta.url), 'utf8');
function setup(project = null) {
  const editor = { script: '', surfaceTools: {} }, calls = [], nodes = new Map();
  const projects = { current: project, visible: !project };
  let modal = false;
  const context = vm.createContext({
    window: { __editor: editor, __projects: projects, __projectContext: { ...project, session: 'test-session', homeUrl: 'http://localhost/' },
      __workspace: { isVisible: () => true, toggle: id => calls.push(id) } },
    document: { getElementById: id => nodes.get(id), querySelectorAll: () => modal ? [{getClientRects: () => [1], getBoundingClientRect: () => ({width: 400, height: 300}), checkVisibility: () => modal !== 'hidden'}] : [] },
    getComputedStyle: () => ({display: 'block'}), $: id => nodes.get(id.slice(1)), ed: () => editor,
    desktop: () => true, click: id => () => calls.push(id), press: id => calls.push(id),
    sep: {sep: true}, themes: () => [], lightItem: (mode,label) => ({label,run:()=>calls.push(mode)}), viewItem: (mode,label) => ({label,run:()=>calls.push(mode)}),
    openSettings: () => {}, openAbout: () => {}, openUrl: () => {}, closeMenus: () => {},
    keyOf: id => 'shortcut:' + id, pref: () => false, TABLES, MAX_LAYOUTS,
  });
  vm.runInContext(source.slice(source.indexOf('const experimentalGeometryItem'), source.indexOf('\nfunction themes'))
    + '\n' + source.slice(source.indexOf('const MENUS = ['), source.indexOf('\nfunction openUrl('))
    + '\nthis.api={describeMenu,runCommand};', context);
  return { editor, projects, calls, api: context.api, modal: value => { modal = value; }, window: context.window };
}
const item = (ctx, label) => ctx.api.describeMenu().flatMap(m => m.items).find(i => i.label === label);
test('project manager cannot create maps or mutate assets, even with stale map state', () => {
  const ctx = setup();
  ctx.editor.script = 'stale-map';
  for (const label of ['New map...','Open map...','Mod packages...','Character Creator...','Save','Rebuild','Undo','Install map...','Show all objects']) {
    const entry = item(ctx,label); assert.equal(entry.enabled,false); assert.equal(ctx.api.runCommand(entry.id),false);
  }
  assert.equal(ctx.calls.length,0);
});

test('tutorial cannot start in the hub or offer New/Open/Save in either disposable worker', () => {
  const hub=setup();assert.equal(item(hub,'Interactive tutorial...').enabled,false);
  for(const project of [{id:'training',kind:'tutorial'}, {id:'training-vanilla',kind:'tutorial',target:'vanilla'}]){
    const ctx=setup(project);ctx.editor.script='deusedix_tutorial';ctx.editor.temporaryTutorial=true;
    for(const label of ['New map...','Open map...','Save']){
      const command=item(ctx,label);assert.equal(command.enabled,false);assert.equal(ctx.api.runCommand(command.id),false);
    }
    assert.equal(item(ctx,'Interactive tutorial...').enabled,true);
    assert.equal(item(ctx,'Rebuild').enabled,true);
  }
});

test('an open legacy project may create a map but cannot modify a closed map', () => {
  const ctx = setup({id:'legacy',kind:'legacy',name:'Existing workspace'});
  const create = item(ctx,'New map...');
  assert.equal(create.enabled,true); assert.equal(ctx.api.runCommand(create.id),true);
  for (const label of ['Save','Rebuild','Undo','Install map...','Show all objects']) {
    const entry = item(ctx,label); assert.equal(entry.enabled,false); assert.equal(ctx.api.runCommand(entry.id),false);
  }
  assert.deepEqual(ctx.calls,['newmap']);
});
test('availability is checked at click time and dialogs block stale native callbacks', () => {
  const ctx = setup({id:'legacy',kind:'legacy',name:'Existing workspace'}); ctx.editor.script='warehouse';
  const undo = item(ctx,'Undo'); assert.equal(undo.enabled,true); assert.equal(ctx.api.runCommand(undo.id),true);
  assert.deepEqual(ctx.calls,['undo']);
  ctx.modal(true); assert.equal(item(ctx,'Undo').enabled,false); assert.equal(ctx.api.runCommand(undo.id),false);
  ctx.modal('hidden'); assert.equal(item(ctx,'Undo').enabled,true);     // a window hidden without display: none blocks nothing
  ctx.modal(true);                                                       // Help and Window stay on whatever is open
  for (const label of ['Quick help', 'Guide', 'About DeusEdix', 'Hierarchy']) { assert.equal(item(ctx,label).enabled,true,label); }
  assert.equal(ctx.api.runCommand(item(ctx,'Quick help').id),true);
  assert.equal(item(ctx,'Keyboard shortcuts').enabled,true); assert.equal(item(ctx,'Undo').enabled,false);
  ctx.modal(false);
  ctx.modal(false); ctx.projects.visible=true;
  assert.equal(item(ctx,'Undo').enabled,false); assert.equal(ctx.api.runCommand(undo.id),false);
  ctx.projects.visible=false; ctx.editor.script=''; assert.equal(ctx.api.runCommand(undo.id),false);
});
test('Search everything needs a project, not a map, and opens through its key', () => {
  const hub = setup(); assert.equal(item(hub,'Search everything…').enabled,false);
  const ctx = setup({id:'legacy',kind:'legacy',name:'Existing workspace'});
  const entry = item(ctx,'Search everything…');
  assert.equal(entry.enabled,true); assert.equal(entry.shortcut,'shortcut:palette');
  assert.equal(ctx.api.runCommand(entry.id),true); assert.deepEqual(ctx.calls,['palette']);
  ctx.modal(true); assert.equal(item(ctx,'Search everything…').enabled,false); assert.equal(ctx.api.runCommand(entry.id),false);
});
test('layout recovery is available without a map and uses shared commands', () => {
  const ctx = setup(); const hierarchy=item(ctx,'Hierarchy');
  assert.equal(hierarchy.checked,true); assert.equal(hierarchy.enabled,true);
  assert.equal(ctx.api.runCommand(hierarchy.id),true); assert.deepEqual(ctx.calls,['hierarchy']);
  assert.equal(ctx.api.runCommand('unknown'),false);
  const ids=ctx.api.describeMenu().flatMap(m=>m.items).filter(i=>!i.sep).map(i=>i.id);
  assert.equal(ids.length,new Set(ids).size);
});
// remap (the keys) on its own: with Settings or About open no key goes on to the editor's listeners, but Esc
test('the Settings window keeps the keys from the 3D view under it, but Esc', () => {
  let open = true;
  const context = vm.createContext({ dialog: { classList: { contains: c => c === 'open' && open } }, keySearch: false, recording: null,
    ed: () => ({ playing: false }), window: { __projects: { visible: false } },
    contextNow: () => 'edit', typing: () => false, comboOf: e => e.key, byUser: { edit: {} }, silenced: { edit: new Set() } });
  vm.runInContext(source.slice(source.indexOf('function layersOf(ctx) {'), source.indexOf("\nwindow.addEventListener('keydown', remap, true);"))
    + '\nthis.remap = remap;', context);
  const stopped = (key, type = 'keydown') => {
    const e = { key, type, stopped: false, stopImmediatePropagation() { this.stopped = true; } };
    context.remap(e);
    return e.stopped;
  };
  for (const key of ['Delete', 'z', 'd', 'w', 'Shift']) assert.equal(stopped(key), true, key);
  assert.equal(stopped('Shift', 'keyup'), true);
  assert.equal(stopped('Escape'), false);              // closeDialog's own listener closes it
  open = false;
  assert.equal(stopped('Delete'), false);              // closed: the 3D view has its keys again
});
// G39: Copy moved to another key silences Ctrl+C in the 3D view, but not in the Console's log, whose data-keys keep it
test("a panel's own keys (its data-keys) are left to it, whatever the 3D view's keys are", () => {
  const context = vm.createContext({ dialog: null, keySearch: false, recording: null,
    ed: () => ({ playing: false }), window: { __projects: { visible: false } },
    contextNow: () => 'edit', typing: () => false, comboOf: e => e.key, byUser: { edit: {} }, silenced: { edit: new Set(['Ctrl+C', 'Ctrl+A']) } });
  vm.runInContext(source.slice(source.indexOf('function layersOf(ctx) {'), source.indexOf("\nwindow.addEventListener('keydown', remap, true);"))
    + '\nthis.remap = remap;', context);
  const log = { closest: sel => (sel === '[data-keys]' ? { dataset: { keys: 'Ctrl+C Up Esc' } } : null) };
  const taken = (key, target) => {
    const e = { key, type: 'keydown', target, taken: false, preventDefault() { this.taken = true; }, stopImmediatePropagation() { this.taken = true; } };
    context.remap(e);
    return e.taken;
  };
  assert.equal(taken('Ctrl+C', log), false);           // the Console copies its lines
  assert.equal(taken('Ctrl+A', log), true);            // not one of its keys: silenced as anywhere
  assert.equal(taken('Ctrl+C', { closest: () => null }), true);
  assert.equal(taken('Ctrl+C', undefined), true);
});
test('the object tables open from the Window menu with a map, the one open checked', () => {
  const ctx = setup({id:'legacy',kind:'legacy',name:'Existing workspace'}), opened = [];
  assert.equal(item(ctx,'Lights table').enabled,false);
  ctx.editor.script='warehouse'; ctx.editor.objectTables={shown:'doors',toggle:id=>opened.push(id)};
  assert.equal(item(ctx,'Doors table').checked,true); assert.equal(item(ctx,'Lights table').checked,false);
  assert.equal(ctx.api.runCommand(item(ctx,'Characters table').id),true); assert.deepEqual(opened,['characters']);
});
// Window: the layouts saved under a name (workspace.js), each a click away, no empty slot shown; Delete and Export only
// with some; Maximize panel needs a map, is ticked while a panel is maximized and presses its key
test('the Window menu lists the saved layouts, a click puts one back; Maximize panel is its key', () => {
  const ctx = setup({id:'legacy',kind:'legacy',name:'Existing workspace'}), loaded = [];
  const ws = { names: [], layouts() { return this.names; }, loadLayout: name => loaded.push(name), maximized: null, isVisible: () => true };
  ctx.window.__workspace = ws;
  // the labels of the saved layouts' items, in an array of this realm (the menu's are the vm's)
  const saved = () => [...ctx.api.describeMenu().find(m => m.title === 'Window').items.filter(i => i.label?.startsWith('Layout: ')).map(i => i.label)];
  assert.deepEqual(saved(), []);
  assert.equal(item(ctx,'Delete layout…').enabled,false); assert.equal(item(ctx,'Export layouts…').enabled,false);
  assert.equal(item(ctx,'Save layout as…').enabled,true); assert.equal(item(ctx,'Import layouts…').enabled,true);
  ws.names = ['Story writing', 'Lighting'];
  assert.deepEqual(saved(), ['Layout: Story writing', 'Layout: Lighting']);
  assert.equal(ctx.api.runCommand(item(ctx,'Layout: Lighting').id),true); assert.deepEqual(loaded,['Lighting']);
  assert.equal(item(ctx,'Delete layout…').enabled,true); assert.equal(item(ctx,'Export layouts…').enabled,true);
  assert.equal(item(ctx,'Maximize panel').enabled,false); assert.equal(item(ctx,'Maximize panel').shortcut,'shortcut:maximize');
  ctx.editor.script='warehouse'; ws.maximized='right';
  assert.equal(item(ctx,'Maximize panel').checked,true);
  assert.equal(ctx.api.runCommand(item(ctx,'Maximize panel').id),true); assert.deepEqual(ctx.calls,['maximize']);
  ctx.modal(true); assert.equal(item(ctx,'Layout: Story writing').enabled,true);        // Window stays on whatever is open
  const ids = ctx.api.describeMenu().flatMap(m => m.items).filter(i => !i.sep).map(i => i.id);
  assert.equal(ids.length, new Set(ids).size);
});
test('Edit > Grid snap is ticked while snap is on (the command palette shows the same)', () => {
  const ctx = setup({id:'legacy',kind:'legacy',name:'Existing workspace'}); ctx.editor.script='warehouse';
  ctx.editor.snapOn=true; assert.equal(item(ctx,'Grid snap').checked,true);
  ctx.editor.snapOn=false; assert.equal(item(ctx,'Grid snap').checked,false);
  assert.equal(ctx.api.runCommand(item(ctx,'Grid snap').id),true); assert.deepEqual(ctx.calls,['snap']);
});
// G25/G26: View > Lightmap detail is one of the views; View > Effects needs a map, is ticked while on and turns it over
test('View > Lightmap detail and View > Effects', () => {
  const ctx = setup({id:'legacy',kind:'legacy',name:'Existing workspace'});
  let on = false;
  ctx.editor.setEffects = v => { on = v; };
  Object.defineProperty(ctx.editor, 'effectsOn', { get: () => on });
  assert.ok(item(ctx,'Lightmap detail'));
  assert.equal(ctx.api.runCommand(item(ctx,'Lightmap detail').id),true); assert.deepEqual(ctx.calls,['lightmap']);
  assert.equal(item(ctx,'Effects').enabled,false);
  ctx.editor.script='warehouse';
  assert.equal(item(ctx,'Effects').checked,false);
  assert.equal(ctx.api.runCommand(item(ctx,'Effects').id),true); assert.equal(on,true);
  assert.equal(item(ctx,'Effects').checked,true);
  assert.equal(ctx.api.runCommand(item(ctx,'Effects').id),true); assert.equal(on,false);
});
// G27: View > Hear the map needs a map, is ticked while on and turns it over
test('View > Hear the map', () => {
  const ctx = setup({id:'legacy',kind:'legacy',name:'Existing workspace'});
  let on = false;
  ctx.editor.setAudio = v => { on = v; };
  Object.defineProperty(ctx.editor, 'audioOn', { get: () => on });
  assert.equal(item(ctx,'Hear the map').enabled,false);
  ctx.editor.script='warehouse';
  assert.equal(item(ctx,'Hear the map').checked,false);
  assert.equal(ctx.api.runCommand(item(ctx,'Hear the map').id),true); assert.equal(on,true);
  assert.equal(item(ctx,'Hear the map').checked,true);
  assert.equal(ctx.api.runCommand(item(ctx,'Hear the map').id),true); assert.equal(on,false);
});
// G30: the keys' layer (ACTIONS to remap, and recordKey) with a 3D view in Face selection or not, the Texture Editor
// open or not, a cutscene panel open or not
function keyLayers() {
  const editor = { playing: false, cam: { look: false }, surfaceTools: { mode: false } }, texedit = { open: false };
  let cut = false;
  class KeyboardEvent { constructor(type, init) { Object.assign(this, init, { type }); } }
  const context = vm.createContext({ prefs: { keys: {} }, ed: () => editor, dialog: null, KeyboardEvent, Event: class { constructor(type) { this.type = type; } },
    window: { dispatchEvent() {}, __projects: { visible: false }, __texedit: { state: texedit }, __cutscene: { isOpen: () => cut } },
    store() {}, renderSettings() {}, warnText: '' });
  vm.runInContext(source.slice(source.indexOf('const ACTIONS = ['), source.indexOf("\nwindow.addEventListener('keydown', remap, true);"))
    + '\n' + source.slice(source.indexOf('function recordKey(e) {'), source.indexOf('\nasync function openAbout()'))
    + '\nthis.api = { remap, layersOf, remapTables, recordKey, record: (id) => { recording = ACTION[id]; }, ACTIONS, SHARED };', context);
  // a key pressed: { stopped, sent: the editor's own key it became, as comboOf writes it }
  const press = (combo, fn = context.api.remap) => {
    const parts = combo.split('+'), k = parts.pop(), sent = [];
    const e = { type: 'keydown', key: /^\d$/.test(k) ? k : k.toLowerCase(), code: /^\d$/.test(k) ? 'Digit' + k : 'Key' + k,
      ctrlKey: parts.includes('Ctrl'), altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift'), stopped: false,
      target: { tagName: 'CANVAS', closest: () => null, dispatchEvent: (ev) => sent.push(ev) },
      preventDefault() {}, stopImmediatePropagation() { this.stopped = true; } };
    fn(e);
    return { stopped: e.stopped, sent: sent.map((ev) => (ev.altKey ? 'Alt+' : '') + (ev.shiftKey ? 'Shift+' : '') + ev.code) };
  };
  return { editor, texedit, context, api: context.api, press, cut: (v) => { cut = v; } };
}
test('Face selection keys work over the 3D view while it is on, not under the Texture Editor', () => {
  const k = keyLayers();
  k.context.prefs.keys.facetex1 = 'Alt+Q'; k.context.prefs.keys.facegrow = 'Alt+J'; k.api.remapTables();
  // off: Alt+1 is the selection slots' (app.js), Alt+Q nothing of the menus'
  assert.deepEqual(k.press('Alt+Q'), { stopped: false, sent: [] });
  assert.deepEqual(k.press('Alt+1'), { stopped: false, sent: [] });
  assert.deepEqual([...k.api.layersOf('edit')], ['edit']);
  // on: the keys given become the editor's own, the old ones are silenced, the others go on to app.js
  k.editor.surfaceTools.mode = true;
  assert.deepEqual([...k.api.layersOf('edit')], ['faces', 'edit']);
  assert.deepEqual(k.press('Alt+Q'), { stopped: true, sent: ['Alt+Digit1'] });
  assert.deepEqual(k.press('Alt+1'), { stopped: true, sent: [] });
  assert.deepEqual(k.press('Alt+J'), { stopped: true, sent: ['Alt+KeyG'] });
  assert.deepEqual(k.press('Alt+2'), { stopped: false, sent: [] });
  // with a cutscene panel open too: its keys first, then Face selection's
  k.cut(true);
  assert.deepEqual([...k.api.layersOf('cut')], ['cut', 'faces', 'edit']);
  assert.deepEqual(k.press('Alt+Q'), { stopped: true, sent: ['Alt+Digit1'] });
  k.cut(false);
  // the Texture Editor open over it keeps its own keys: nothing of Face selection's is turned or silenced
  k.texedit.open = true;
  assert.deepEqual([...k.api.layersOf('edit')], ['edit']);
  assert.deepEqual(k.press('Alt+Q'), { stopped: false, sent: [] });
  assert.deepEqual(k.press('Alt+1'), { stopped: false, sent: [] });
  k.texedit.open = false;
  // flying: only the flying keys
  k.editor.cam.look = true;
  assert.deepEqual([...k.api.layersOf('fly')], ['fly']);
  assert.deepEqual(k.press('Alt+Q'), { stopped: false, sent: [] });
});
test('a key a Face selection command gave up works for the 3D view command given it, in Face selection too', () => {
  const k = keyLayers(), keys = k.context.prefs.keys;
  keys.facegrow = 'Alt+J'; keys.isolate = 'Alt+G'; k.api.remapTables();         // Grow leaves Alt+G, Isolate takes it
  assert.deepEqual(k.press('Alt+G'), { stopped: true, sent: ['Shift+KeyH'] });
  k.editor.surfaceTools.mode = true;
  assert.deepEqual(k.press('Alt+G'), { stopped: true, sent: ['Shift+KeyH'] });
  assert.deepEqual(k.press('Alt+J'), { stopped: true, sent: ['Alt+KeyG'] });
  k.cut(true);                                                                   // a cutscene panel open over it
  assert.deepEqual(k.press('Alt+G'), { stopped: true, sent: ['Shift+KeyH'] });
  k.cut(false);
  delete keys.isolate; k.api.remapTables();                                      // nobody's: Grow's old key silent
  assert.deepEqual(k.press('Alt+G'), { stopped: true, sent: [] });
});
test('a key can not go to two commands of contexts that work together', () => {
  const k = keyLayers(), prefs = k.context.prefs;
  // the editor's own keys: none twice among the 3D view's, a cutscene panel's and Face selection's
  for (const [ctx, others] of Object.entries(k.api.SHARED)) {
    const keys = k.api.ACTIONS.filter((a) => a[3] === ctx || others.includes(a[3])).map((a) => a[2]);
    assert.deepEqual([...keys.filter((x, i) => keys.indexOf(x) !== i)], [], ctx);
  }
  const give = (id, combo) => { k.api.record(id); k.press(combo, k.api.recordKey); return k.context.warnText; };
  assert.match(give('facegrowall', 'G'), /Grid snap/);                          // the 3D view's
  assert.match(give('facegrowall', 'K'), /Cutscene: add a key/);                // a cutscene panel's
  assert.match(give('facegrowall', 'Alt+2'), /Apply recent texture 2/);         // its own context's
  assert.match(give('snap', 'Alt+3'), /Apply recent texture 3/);
  assert.equal(prefs.keys.facegrowall, undefined); assert.equal(prefs.keys.snap, undefined);
  assert.equal(give('fwd', 'Alt+G'), '');                                       // flying works alone
  assert.equal(prefs.keys.fwd, 'Alt+G');
  assert.equal(give('facegrowall', 'Alt+H'), '');
  assert.equal(prefs.keys.facegrowall, 'Alt+H');
});
test('Edit > Slip the texture: with faces selected, by its key; a menu command ends a Texture Slip first', () => {
  const ctx = setup({id:'legacy',kind:'legacy',name:'Existing workspace'});
  ctx.editor.script = 'warehouse';
  ctx.editor.surfaceTools = { hasSelection: false };
  assert.equal(item(ctx,'Slip the texture').enabled,false);
  ctx.editor.surfaceTools.hasSelection = true;
  assert.equal(item(ctx,'Slip the texture').shortcut,'shortcut:faceslip');
  ctx.editor.textureSlip = { cancel: () => ctx.calls.push('cancel slip') };
  assert.equal(ctx.api.runCommand(item(ctx,'Slip the texture').id),true);
  assert.deepEqual(ctx.calls,['cancel slip','faceslip']);
});
// the Surface panel's Slip (app.js: window.__menubar.press('faceslip')) runs what Edit > Slip the texture runs: the
// command's own key (Y) sent to the page, whatever key the user gave it
test("the menus' press, for the Surface panel's Slip: Edit > Slip the texture's command", () => {
  const k = keyLayers(), sent = [];
  k.context.prefs.keys.faceslip = 'J'; k.api.remapTables();
  Object.assign(k.context, { document: { activeElement: null, body: { dispatchEvent: (ev) => sent.push(ev) } }, openSettings() {}, setPref() {},
    describeMenu() {}, runCommand() {}, closeMenus() {}, PANELS: [], SETTINGS_PAGES: [], nativeModalOpen() {} });
  const press = source.indexOf('function press(id) {'), exported = source.indexOf('window.__menubar = {');
  vm.runInContext(source.slice(press, source.indexOf('\n}', press) + 2) + '\n'
    + source.slice(exported, source.indexOf("\nwindow.addEventListener('pywebviewready'", exported)), k.context);
  k.context.window.__menubar.press('faceslip');
  assert.deepEqual(sent.map((e) => [e.type, e.key, e.code, e.__deusedix]), [['keydown', 'y', 'KeyY', true]]);
  assert.match(source, /label: 'Slip the texture', key: 'faceslip',[^\n]*run: \(\) => press\('faceslip'\) \}/);
});
test('while a Texture Slip goes on the keys are its own: none turned into a command given them', () => {
  const k = keyLayers();
  k.context.prefs.keys.paths = 'J'; k.context.prefs.keys.help = 'P'; k.api.remapTables();
  assert.deepEqual(k.press('P'), { stopped: true, sent: ['KeyH'] });            // Quick help took P from AI paths
  assert.deepEqual(k.press('J'), { stopped: true, sent: ['KeyP'] });
  k.editor.textureSlip = { active: true };
  assert.deepEqual(k.press('P'), { stopped: false, sent: [] });                 // the slip's own P (one pan for all)
  assert.deepEqual(k.press('J'), { stopped: false, sent: [] });
  k.editor.textureSlip.active = false;
  assert.deepEqual(k.press('P'), { stopped: true, sent: ['KeyH'] });
});
// a menu taller than the window (Edit: 51 items, some 1400 px, in a 768-px window) scrolls inside it: .mb-list as the stylesheets
// the page loads leave it, in their order (body .mb-list over .mb-list)
test('a menu taller than the window scrolls inside it (Edit in a 768-px window)', () => {
  const page = readFileSync(new URL('../editor/static/index.html', import.meta.url), 'utf8');
  const sheets = [...page.matchAll(/<link rel="stylesheet" href="\/static\/([\w.-]+\.css)">/g)]
    .map(([, name]) => readFileSync(new URL('../editor/static/' + name, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
  const style = {};
  for (const selector of ['.mb-list', 'body .mb-list']) {
    for (const css of sheets) for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selectors.split(',').some((s) => s.trim() === selector)) continue;
      for (const d of body.split(';')) {
        const i = d.indexOf(':'), prop = d.slice(0, i).trim(), value = d.slice(i + 1).trim();
        if (prop === 'overflow') { const [x, y = x] = value.split(/\s+/); Object.assign(style, { 'overflow-x': x, 'overflow-y': y }); } else if (i > 0) style[prop] = value;
      }
    }
  }
  assert.match(style['overflow-y'] ?? '', /^(auto|scroll)$/);
  // its bottom in a 768-px window: it hangs 3 px under its title in the 30-px menu bar (menubar.css: --top-h 30px)
  const px = (value) => [...value.replace(/var\(--top-h\)/g, '30px').replace(/(\d+)vh/g, (_, n) => `${n * 7.68}px`)
    .matchAll(/([+-]?)\s*(\d+(?:\.\d+)?)px/g)].reduce((sum, [, sign, n]) => sum + (sign === '-' ? -n : +n), 0);
  assert.match(style['max-height'] ?? '', /vh/);
  assert.ok(30 + 3 + px(style['max-height']) <= 768, style['max-height']);
});
test('Edit > Grow face selection: with faces selected, at any angle too, their keys shown', () => {
  const ctx = setup({id:'legacy',kind:'legacy',name:'Existing workspace'}), grown = [];
  ctx.editor.script = 'warehouse';
  ctx.editor.surfaceTools = { hasSelection: false, grow: (any) => grown.push(any) };
  for (const label of ['Grow face selection', 'Grow face selection (any angle)']) assert.equal(item(ctx,label).enabled,false,label);
  ctx.editor.surfaceTools.hasSelection = true;
  assert.equal(item(ctx,'Grow face selection').shortcut,'shortcut:facegrow');
  assert.equal(item(ctx,'Grow face selection (any angle)').shortcut,'shortcut:facegrowall');
  assert.equal(ctx.api.runCommand(item(ctx,'Grow face selection').id),true);
  assert.equal(ctx.api.runCommand(item(ctx,'Grow face selection (any angle)').id),true);
  assert.deepEqual(grown,[false,true]);
});
