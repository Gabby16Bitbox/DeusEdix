import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { projectStorageKey } from '../editor/static/projects.js';
import { createSceneVisibility } from '../editor/static/scene-visibility.js';
import { SHOW_KINDS, SHOW_KIND, KIND_STATES, ICON_KINDS, showKindOf, createKindFilter } from '../editor/static/scene-kinds.js';
import { defaultFolder } from '../editor/static/hierarchy-folders.js';
import { namedStep } from '../editor/static/history-names.js';
import { linkOf } from '../editor/static/prefab-links.js';

const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
const stateSource = source.slice(source.indexOf('function keyOf(o)'), source.indexOf('const nestById ='));
const menuSource = source.slice(source.indexOf('function specSelect(spec)'), source.indexOf('// the Hierarchy: drag things'));
const dragSource = source.slice(source.indexOf('// the Hierarchy: drag things'), source.indexOf('// the 3D view: a right click'));
const body = name => { const start = source.indexOf(`function ${name}(`); return source.slice(start, source.indexOf('\n}', start) + 2); };
const actor = (name, kind = 'pawn', owner) => ({ userData: { actor: { name, cls: 'ScientistMale', kind }, source: owner || 'map', kind }, visible: true });

function fixture() {
  const storage = new Map(), a = actor('Hale'), b = actor('Guard'), prop = actor('Crate', 'prop');
  const structure = { userData: { kind: 'structure', name: 'Room' }, visible: true };
  const scene = { children: [a, b, prop], remove(p) { this.children = this.children.filter(child => child !== p); } }, calls = [], group = { userData: { kind: 'group' }, members: [a, b] };
  const context = vm.createContext({
    script: 'test-map', baseActors: [a, b, prop].map(p => p.userData.actor), edits: { props: { Hale: { Health: '80' } }, anims: { Hale: { idle: 'Wave' } }, moved: {}, nests: [], added: [], boxes: [] },
    projectContext: {id:'legacy',kind:'legacy'}, projectStorageKey, temporaryTutorial:()=>false,
    buildJob: null, waitsForRebuild: () => false,       // no Rebuild running (rebuildMap)
    selected: null, structures: { Room: { obj: structure, name: 'Room' } }, actorStruct: { Hale: 'Room' }, proxies: scene, groupPivot: group,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    poseOf: () => ({ deleted: false }), proxyOf: name => scene.children.find(p => p.userData.actor.name === name),
    isStruct: p => p?.userData.kind === 'structure', members: () => group.members,
    lgSelNames: () => [], lgGroups: () => [],          // the Logic's named groups (none here)
    factionOf: () => 'None', lgKindLabel: (cls) => cls, lgMakeSet: () => null,      // a group of a kind, of a faction (P9)
    mayHavePhases: () => false, moverPhasesOf: () => '', lkActor: () => null,     // no door to give phases to (P3 slice 8)
    parentNest: key => context.edits.nests.find(n => n.items.includes(key)), nestById: id => context.edits.nests.find(n => n.id === id),
    nestLeaves: n => (n?.items || []).map(k => context.objOf(k)).filter(Boolean), piecesInside: st => st.pieces || [],
    tc: { detach: () => calls.push('detach') }, outline: {}, lightRange: {}, soundRange: {}, triggerZone: {}, anim: null,
    select: p => { context.selected = p; calls.push(['select', p?.userData.actor?.name]); }, selectNest: () => {},
    buildHierarchy: () => calls.push('hierarchy'), showDetails: () => calls.push('details'),
    pushUndo: () => calls.push(['undo', structuredClone(context.edits)]), setDirty: () => calls.push('dirty'),
    status: text => calls.push(['status', text]), hierLabel: a => a.name,
    namedStep, keyLabel: k => [k.slice(k.indexOf(':') + 1), ''], objectLabel: p => [p.userData.actor?.name ?? p.userData.name, ''],
    selKeys: () => context.selected ? context.selected === group ? group.members.map(p => context.keyOf(p)) : [context.keyOf(context.selected)] : [],
    window: { __story: { openFor: name => calls.push(['dialogue', name]) }, __studio: { open: cls => calls.push(['studio', cls]) } },
    menuKey: id => id, texRows: () => [], propSchema: {}, isCharacter: a => a.kind === 'pawn',
    focusInspector: (...args) => calls.push(['inspector', ...args]), openAnim: p => calls.push(['animate', p.userData.actor.name]),
    duplicateSelected: () => calls.push('duplicate'), copySelected: () => calls.push('copy'), cutSelected: () => calls.push('cut'), dropSelected: () => calls.push('drop'),
    PLACE_MODES: [['drop', 'Drop to floor'], ['stick', 'Stick to surface']], placeMode: 'drop', placeSelected: m => calls.push(['place', m]),
    armAim: () => calls.push('aim'), replaceSelection: () => calls.push('replace'),
    focusSelected: () => calls.push('focus'), deleteSelected: () => calls.push('delete'), nestKeys: () => {},
    nests: () => context.edits.nests, nestsWithin: () => [], canTakeApart: () => false, takeOut: () => {}, moveTo: () => {},
    $: () => null, console, clsShown: c => String(c || '').split('.').pop(), gameView: null,
    createSceneVisibility, vpBar: null,
    SHOW_KINDS, SHOW_KIND, KIND_STATES, ICON_KINDS, showKindOf, createKindFilter, showIcons: true, wake: () => {},
    clearTutorialViewPreferences: () => {},
    setViewportIconSize: size => calls.push(['iconSize', size]),
    defaultFolder, setNewObjectsFolder: id => calls.push(['newObjects', id]),
    // linked prefabs (prefabMenu): the copies, the library's newest version of their prefab, its actions
    linkOf, pasteEntry: name => context.edits.prefabs?.find(e => 'paste~' + e.pid === name), prefabOfCopy: () => context.newest,
    selectInstances: line => calls.push(['instances', line]), updateInstances: line => calls.push(['update', line]),
    applyToPrefab: name => calls.push(['apply', name]), unpackCopies: names => calls.push(['unpack', names]),
  });
  vm.runInContext(stateSource + '\n' + menuSource + '\n' + ['nextName', 'newNest', 'removeOne', 'resetTutorialView', 'reparentCheck', 'stepOf'].map(body).join('\n'), context);
  return { context, a, b, prop, structure, storage, calls, group };
}
// the Hierarchy's drag (app.js's block, run as it is) on stand-in rows: drag(key) is true when that row's drag starts
function hierarchyDrag(c) {
  const node = () => ({ hidden: false, style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener() {}, after() {}, before() {},
    querySelectorAll: () => [] });
  const hier = { ...node(), on: {}, addEventListener(type, f) { this.on[type] = f; }, parentElement: { style: {} }, offsetTop: 0 };
  Object.assign(c, { $: sel => (sel === '#hier' ? hier : node()), document: { createElement: node, body: { appendChild() {} } },
    getComputedStyle: () => ({ position: 'relative' }), closeMenu() {} });
  vm.runInContext(dragSource, c);
  return key => {
    let started = true;
    hier.on.dragstart({ target: { closest: () => ({ dataset: { key } }) }, preventDefault() { started = false; }, dataTransfer: { setData() {}, setDragImage() {} } });
    return started;
  };
}

test('Scene visibility is local, survives reload, and is isolated per map', () => {
  const { context: c, a, storage, calls } = fixture();
  const before = JSON.stringify(c.edits);
  c.setObjectView(['a:Hale'], 'hidden', true);
  assert.equal(a.visible, false);
  assert.equal(c.objectHidden(a), true);
  assert.equal(JSON.stringify(c.edits), before);
  assert.equal(calls.includes('dirty'), false);
  assert.deepEqual(JSON.parse(storage.get(projectStorageKey('objects.test-map',c.projectContext))).hidden, ['a:Hale']);
  c.script = 'another-map'; c.applyObjectVisibility(); assert.equal(a.visible, true);
  c.script = 'test-map'; c.applyObjectVisibility(); assert.equal(a.visible, false);
  c.showAllObjects(); assert.equal(a.visible, true);
});

test('Hiding a structure also hides its actors, and show reveals hidden parents', () => {
  const { context: c, a, b, structure } = fixture();
  c.setObjectView(['s:Room'], 'hidden', true);
  assert.equal(structure.visible, false); assert.equal(a.visible, false); assert.equal(b.visible, true);
  c.setObjectView(['a:Hale'], 'hidden', false);
  assert.equal(structure.visible, true); assert.equal(a.visible, true);
});

test('Locked children protect multi-selection and their containing structure', () => {
  const { context: c, a, b, structure, group, calls } = fixture();
  c.setObjectView(['a:Hale'], 'locked', true);
  assert.equal(c.objectLocked(a), true); assert.equal(c.objectLocked(b), false);
  assert.equal(c.selectionLocked(structure), true); assert.equal(c.selectionLocked(group), true);
  assert.equal(c.requireUnlocked(group), false);
  assert.equal(calls.includes('dirty'), false);
  c.setObjectView(['s:Room'], 'locked', false);
  assert.equal(c.selectionLocked(structure), false); assert.equal(c.selectionLocked(group), false);
});

test('Nest visibility and locks apply to members without modifying map data', () => {
  const { context: c, a, b } = fixture();
  c.edits.nests = [{ id: 'n1', items: ['a:Hale', 'a:Guard'] }];
  const before = JSON.stringify(c.edits);
  c.setObjectView(['n:n1'], 'hidden', true); c.setObjectView(['n:n1'], 'locked', true);
  assert.equal(c.objectHidden(a), true); assert.equal(c.objectHidden(b), true);
  assert.equal(c.objectLocked(a), true); assert.equal(c.objectLocked(b), true);
  assert.equal(JSON.stringify(c.edits), before);
  c.unlockAllObjects(); assert.equal(c.objectLocked(a), false); assert.equal(c.objectLocked(b), false);
});

test('Enabled in game is undoable, retains configuration and does not hide its editor proxy', () => {
  const { context: c, a, calls } = fixture();
  const before = JSON.stringify(c.edits);
  c.setGameEnabled(['Hale'], false);
  assert.equal(c.edits.disabled.Hale, true); assert.equal(a.visible, true);
  assert.equal(c.edits.props.Hale.Health, '80'); assert.equal(c.edits.anims.Hale.idle, 'Wave');
  assert.equal(calls.filter(x => Array.isArray(x) && x[0] === 'undo').length, 1);
  c.setGameEnabled(['Hale'], false);
  assert.equal(calls.filter(x => Array.isArray(x) && x[0] === 'undo').length, 1, 'No-op does not consume undo');
  c.setGameEnabled(['Hale'], true);
  assert.equal(JSON.stringify(c.edits), before);
});

test('Game activation rejects locked targets without changing edits', () => {
  const { context: c } = fixture();
  c.setObjectView(['a:Hale'], 'locked', true);
  const before = JSON.stringify(c.edits);
  c.setGameEnabled(['Hale'], false);
  assert.equal(JSON.stringify(c.edits), before);
});

test('Deleting an added inactive or hidden actor cannot pass its settings to the next placed object', () => {
  const { context: c } = fixture(), old = actor('UCEdit0', 'prop', 'added');
  c.proxies.children.push(old); c.edits.added.push(old.userData.actor);
  c.setGameEnabled(['UCEdit0'], false);
  c.setObjectView(['a:UCEdit0'], 'hidden', true);
  c.removeOne(old);
  const replacement = actor(c.nextName('UCEdit'), 'prop', 'added');
  assert.notEqual(replacement.userData.actor.name, old.userData.actor.name);
  assert.equal(!!c.edits.disabled[replacement.userData.actor.name], false);
  assert.equal(c.objectHidden(replacement), false);
  assert.equal(c.edits.disabled.UCEdit0, true, 'Old settings remain recoverable by Undo');
  c.edits.props.UCEdit1 = { Health: '21' };
  c.edits.motions = { UCEdit2: { pos: [] } };
  assert.equal(c.nextName('UCEdit'), 'UCEdit3', 'Other saved settings also reserve their actor identity');
});

test('A new Nest cannot inherit the visibility or lock of a removed Nest', () => {
  const { context: c, a, b } = fixture();
  const old = c.newNest('Old group', ['a:Hale']);
  c.setObjectView(['n:' + old.id], 'hidden', true);
  c.setObjectView(['n:' + old.id], 'locked', true);
  c.edits.nests = [];
  const fresh = c.newNest('Fresh group', ['a:Guard']);
  assert.notEqual(fresh.id, old.id);
  assert.equal(c.objectHidden(a), false);
  assert.equal(c.objectHidden(b), false);
  assert.equal(c.objectLocked(b), false);
});

test('Character context action selects the clicked actor and opens its own dialogue flow', () => {
  const { context: c, b, calls } = fixture();
  c.selected = b;
  const menu = c.menuFor('a:Hale');
  const dialogue = menu.find(item => item.label === 'Dialogue…');
  assert.ok(dialogue); assert.equal(dialogue.off, false);
  dialogue.run();
  assert.deepEqual(calls.slice(-2), [['select', 'Hale'], ['dialogue', 'Hale']]);
  assert.ok(menu.find(item => item.label === 'Animation Studio…'));
});

test('right click on a folder: New objects go here, then back to the top level; not on an object', () => {
  const { context: c, calls } = fixture();
  c.edits.nests = [{ id: 'n1', label: 'Office 2 props', items: ['a:Guard'] }];
  const item = label => c.menuFor('n:n1').find(x => x.label === label);
  assert.equal(item('New objects go to the top level'), undefined);
  item('New objects go here').run();
  assert.deepEqual(calls.at(-1), ['newObjects', 'n1']);
  c.edits.defaultFolder = 'n1';
  assert.equal(item('New objects go here'), undefined);
  item('New objects go to the top level').run();
  assert.deepEqual(calls.at(-1), ['newObjects', null]);
  assert.equal(c.menuFor('a:Guard').some(x => /New objects/.test(x.label)), false);
});

test('Multi-selection context actions preserve the group and omit single-character editors', () => {
  const { context: c, group, calls } = fixture(); c.selected = group;
  const menu = c.menuFor('a:Hale');
  assert.equal(menu.some(item => item.label === 'Dialogue…'), false);
  menu.find(item => item.label === 'Copy').run();
  assert.equal(c.selected, group); assert.equal(calls.at(-1), 'copy');
});

test('Locked context menu permits restoration and disables editing actions', () => {
  const { context: c } = fixture(); c.setObjectView(['a:Hale'], 'locked', true);
  const menu = c.menuFor('a:Hale');
  assert.ok(menu.find(item => item.label === 'Unlock selection'));
  for (const label of ['Disable in game', 'Dialogue…', 'Animation Studio…', 'Animate movement…', 'Duplicate', 'Drop to floor', 'Delete'])
    assert.equal(menu.find(item => item.label === label)?.off, true, label);
});

test('Cut in the right-click menu: the whole selection, off when locked; Select under cursor only from the 3D view', () => {
  const { context: c, group, calls } = fixture(); c.selected = group;
  const menu = c.menuFor('a:Hale');
  menu.find(item => item.label === 'Cut').run();
  assert.equal(c.selected, group); assert.equal(calls.at(-1), 'cut');
  assert.equal(menu.some(item => item.label === 'Select under cursor…'), false);
  const under = () => calls.push('under');
  c.menuFor('a:Hale', { owner: null, hit: null, under }).find(item => item.label === 'Select under cursor…').run();
  assert.equal(calls.at(-1), 'under');
  c.setObjectView(['a:Hale'], 'locked', true);
  assert.equal(c.menuFor('a:Hale').find(item => item.label === 'Cut')?.off, true);
});

test('Aim at a point… in the right-click menu: the clicked object or the whole selection, off when locked', () => {
  const { context: c, a, group, calls } = fixture(); c.selected = group;
  c.menuFor('a:Hale').find(item => item.label === 'Aim at a point…').run();
  assert.equal(c.selected, group); assert.equal(calls.at(-1), 'aim');
  c.selected = null;
  c.menuFor('a:Hale').find(item => item.label === 'Aim at a point…').run();
  assert.equal(c.selected, a); assert.equal(calls.at(-1), 'aim');
  assert.equal(c.menuFor('a:Hale').find(item => item.label === 'Aim at a point…').key, 'aim');     // its key (menuKey)
  c.setObjectView(['a:Hale'], 'locked', true);
  assert.equal(c.menuFor('a:Hale').find(item => item.label === 'Aim at a point…')?.off, true);
});

test('Replace with… in the right-click menu: the clicked object or the whole selection, off when locked', () => {
  const { context: c, a, group, calls } = fixture(); c.selected = group;
  c.menuFor('a:Hale').find(item => item.label === 'Replace with…').run();
  assert.equal(c.selected, group); assert.equal(calls.at(-1), 'replace');
  c.selected = null;
  c.menuFor('a:Hale').find(item => item.label === 'Replace with…').run();
  assert.equal(c.selected, a); assert.equal(calls.at(-1), 'replace');
  c.setObjectView(['a:Hale'], 'locked', true);
  assert.equal(c.menuFor('a:Hale').find(item => item.label === 'Replace with…')?.off, true);
});

test('temporary tutorial object visibility remains in-session and is not persisted', () => {
  const {context:c,a,storage}=fixture();c.temporaryTutorial=()=>true;
  c.setObjectView(['a:Hale'],'hidden',true);
  assert.equal(a.visible,false);assert.equal(storage.size,0);
});

test('Isolate shows the selection and the structure it stands in, then the map comes back; nothing is saved', () => {
  const { context: c, a, b, prop, structure, storage, calls } = fixture();
  const before = JSON.stringify(c.edits);
  c.selected = a; c.toggleIsolation();
  assert.deepEqual([a, structure, b, prop].map(p => p.visible), [true, true, false, false]);
  assert.equal(c.objectHidden(b), true); assert.equal(c.objectEyeOff(b), false);
  assert.ok(c.menuFor('a:Guard').find(item => item.label === 'Hide in Scene'), 'the eye of an isolated-out object is still on');
  assert.equal(storage.size, 0); assert.equal(JSON.stringify(c.edits), before); assert.equal(calls.includes('dirty'), false);
  c.toggleIsolation();
  assert.deepEqual([a, structure, b, prop].map(p => p.visible), [true, true, true, true]);
});

test('Isolating a structure keeps its objects; a new object is shown; nothing selected isolates nothing', () => {
  const { context: c, a, b, prop, structure, calls } = fixture();
  c.toggleIsolation();
  assert.equal(calls.at(-1)[0], 'status'); assert.match(calls.at(-1)[1], /Select what to isolate/);
  assert.deepEqual([a, structure, b, prop].map(p => p.visible), [true, true, true, true]);
  c.selected = structure; c.toggleIsolation();
  assert.deepEqual([a, structure, b, prop].map(p => p.visible), [true, true, false, false]);
  const added = actor('UCEdit0', 'prop', 'added');
  c.proxies.children.push(added); c.applyObjectVisibility();
  assert.equal(added.visible, true);
});

test('Show hidden reveals what the eye hid for now, inside the isolation only, and keeps the eye off', () => {
  const { context: c, a, b, prop, storage, calls } = fixture();
  c.setObjectView(['a:Guard'], 'hidden', true); c.setObjectView(['a:Crate'], 'hidden', true);
  const saved = storage.get(projectStorageKey('objects.test-map', c.projectContext));
  c.toggleRevealHidden();
  assert.match(calls.at(-1)[1], /shown for now \(2\)/);
  assert.equal(b.visible, true); assert.equal(prop.visible, true); assert.equal(c.objectEyeOff(b), true);
  c.selected = b; c.toggleIsolation();
  assert.deepEqual([a, b, prop].map(p => p.visible), [false, true, false]);
  c.toggleRevealHidden();
  assert.equal(b.visible, false, 'inside the isolation the eye still hides it');
  c.toggleIsolation();
  assert.deepEqual([a, b, prop].map(p => p.visible), [true, false, false]);
  assert.equal(storage.get(projectStorageKey('objects.test-map', c.projectContext)), saved);
});

test('Show menu: a kind hidden as a whole, apart from each object\'s own eye, kept per project', () => {
  const { context: c, a, b, prop, structure, storage } = fixture();
  const before = JSON.stringify(c.edits);
  c.setKindView('pawn', 'hidden', true);
  assert.deepEqual([a, b, prop, structure].map(p => p.visible), [false, false, true, true]);
  assert.equal(c.objectEyeOff(a), false, 'its own eye stays on');
  assert.ok(c.menuFor('a:Hale').find(item => item.label === 'Hide in Scene'));
  c.setObjectView(['a:Hale'], 'hidden', true);
  c.setKindView('pawn', 'hidden', false);
  assert.deepEqual([a, b].map(p => p.visible), [false, true], 'showing the kind never turns an object\'s eye back on');
  c.showAllObjects();
  assert.equal(a.visible, true);
  c.setKindView('pawn', 'hidden', true); c.showAllObjects();
  assert.equal(a.visible, false, 'nor Show all objects a kind\'s');
  assert.deepEqual(JSON.parse(storage.get(projectStorageKey('showKinds', c.projectContext))).hidden, ['pawn']);
  assert.equal(JSON.stringify(c.edits), before);
  c.projectContext = { id: 'another', kind: 'custom' }; c.applyObjectVisibility();
  assert.equal(a.visible, true, 'another project has its own');
  c.projectContext = { id: 'legacy', kind: 'legacy' }; c.applyObjectVisibility();
  assert.equal(a.visible, false);
  c.soloKind('structure');
  assert.deepEqual([a, b, prop, structure].map(p => p.visible), [false, false, false, true]);
  c.soloKind('structure');
  assert.deepEqual([a, b, prop, structure].map(p => p.visible), [true, true, true, true]);
});

test('Show menu: a locked kind cannot be picked or edited, its own padlock stays open, its structure still moves', () => {
  const { context: c, a, b, structure, group, calls } = fixture();
  c.setKindView('pawn', 'locked', true);
  assert.equal(c.objectLocked(a), true); assert.equal(c.objectLocked(b), true);
  assert.equal(c.selectionLocked(a, true), false, 'its own padlock is open');
  assert.equal(c.selectionLocked(structure), false, 'the room Hale stands in still moves');
  assert.equal(c.selectionLocked(group), true);
  assert.equal(c.requireUnlocked(a), false);
  assert.match(calls.at(-1)[1], /^Characters: locked in the Show menu/);
  const menu = c.menuFor('a:Hale');
  assert.ok(menu.find(item => item.label === 'Lock selection'), 'the menu\'s padlock is the object\'s own');
  assert.equal(menu.find(item => item.label === 'Delete')?.off, true);
  c.setObjectView(['a:Hale'], 'locked', true);
  assert.equal(c.selectionLocked(structure), true, 'an object\'s own padlock still holds its room');
  c.requireUnlocked(a);
  assert.match(calls.at(-1)[1], /Unlock it in the Hierarchy/);
  c.setKindView('structure', 'locked', true); c.unlockAllObjects();
  assert.equal(c.selectionLocked(structure), true, 'Unlock all objects leaves the kinds');
  c.resetKinds();
  assert.equal(c.objectLocked(a), false); assert.equal(c.selectionLocked(structure), false);
});

test('Show menu: how many of each kind, the icons\' size, Isolate under a hidden kind, nothing kept in a tutorial', () => {
  const { context: c, prop, storage, calls } = fixture();
  assert.deepEqual({ ...c.showKindCounts() }, { ...Object.fromEntries(SHOW_KINDS.map(k => [k.id, 0])), structure: 1, pawn: 2, prop: 1 });
  assert.equal(c.setIconSize(50, false), 52);
  assert.deepEqual(calls.at(-1), ['iconSize', 52]);
  assert.equal(storage.get(projectStorageKey('showKinds', c.projectContext)), undefined, 'kept when the slider is let go');
  c.setIconSize(52, true);
  assert.equal(JSON.parse(storage.get(projectStorageKey('showKinds', c.projectContext))).iconSize, 52);
  c.setKindView('prop', 'hidden', true);
  c.selected = prop; c.toggleIsolation();
  assert.match(calls.at(-1)[1], /\(Objects stay hidden: the Show menu hides them\)/);
  assert.equal(prop.visible, false);
  const t = fixture(); t.context.temporaryTutorial = () => true;
  t.context.setKindView('light', 'hidden', true);
  assert.deepEqual(t.context.kindFilter().kinds('hidden'), ['light'], 'in the session');
  assert.equal(t.storage.size, 0);
});

test('Show menu in the tutorial: its own kinds, from nothing at each fresh start, never the project\'s', () => {
  const { context: c, storage } = fixture();
  storage.set(projectStorageKey('showKinds', c.projectContext), JSON.stringify({ hidden: ['pawn'] }));
  c.temporaryTutorial = () => true;
  assert.deepEqual(c.kindFilter().kinds('hidden'), [], 'what the project keeps is not the tutorial\'s');
  c.setKindView('light', 'hidden', true);
  c.resetTutorialView();
  assert.deepEqual(c.kindFilter().kinds('hidden'), [], 'a fresh start shows every kind again');
  c.temporaryTutorial = () => false;
  assert.deepEqual(c.kindFilter().kinds('hidden'), ['pawn'], 'out of the tutorial: the project\'s');
});

test('Show menu: a folder with a locked or hidden kind in it still moves as one, as a structure does; another group not', () => {
  const { context: c, a, prop, group } = fixture();
  group.members = [a, prop];
  c.setKindView('pawn', 'locked', true); c.setKindView('pawn', 'hidden', true);
  assert.equal(c.selectionLocked(group), true, 'a group of Ctrl+clicks is held by its kinds');
  assert.equal(c.selectionHidden(group), true);
  c.edits.nests = [{ id: 'n1', label: 'Office', items: ['a:Hale', 'a:Crate'] }];
  group.userData.nest = 'n1';                       // the folder selected whole
  assert.equal(c.selectionLocked(group), false, 'the folder moves with Hale in it');
  assert.equal(c.selectionHidden(group), false, 'and has its gizmo');
  assert.equal(c.requireUnlocked(group), true);
  group.userData.nest = null; group.userData.keys = ['n:n1', 'a:Guard'];      // the folder Ctrl+clicked with a character
  assert.equal(c.selectionLocked(group), true, 'the character on its own is held by its kind');
  assert.equal(c.selectionHidden(group), true);
  group.userData.keys = ['n:n1', 'a:Crate'];
  assert.equal(c.selectionLocked(group), false, 'with an object: the folder still moves');
  group.userData.nest = 'n1'; group.userData.keys = null;
  c.setObjectView(['a:Hale'], 'locked', true);
  assert.equal(c.selectionLocked(group), true, 'Hale\'s own padlock holds the folder');
  c.setObjectView(['a:Hale'], 'locked', false); c.setObjectView(['a:Hale'], 'hidden', true);
  assert.equal(c.selectionHidden(group), true, 'and its own eye hides it');
  assert.equal(c.selectionHidden(prop), false); assert.equal(c.selectionHidden(null), false);
});

test('Show menu: a folder with a locked kind in it is dragged, moved and edited from its menu; its things\' own padlocks hold it', () => {
  const { context: c } = fixture();
  c.edits.nests = [{ id: 'n1', label: 'Office', items: ['a:Guard'] }, { id: 'n2', label: 'Store', items: ['a:Crate'] }];
  const drag = hierarchyDrag(c), off = (spec, label) => c.menuFor(spec).find(item => item.label === label)?.off;
  const EDITS = ['Delete', 'Duplicate', 'Cut', 'Drop to floor', 'Create folder'];
  c.setKindView('pawn', 'locked', true);
  assert.equal(drag('n:n1'), true, 'the folder is dragged, Guard in it');
  assert.equal(drag('a:Hale'), false, 'a character on its own is held by its kind');
  assert.equal(c.reparentCheck('a:Crate', 'n1').reason, undefined, 'something goes into the folder');
  assert.equal(c.reparentCheck('n:n1', 'n2').reason, undefined, 'the folder into another');
  assert.equal(c.reparentCheck('n:n2', 'n1').reason, undefined, 'another folder into it');
  assert.match(c.reparentCheck('a:Guard', 'n2').reason, /^Unlock/, 'a character moved on its own is held');
  for (const label of EDITS) assert.equal(off('n:n1', label), false, label);
  assert.equal(off('a:Guard', 'Delete'), true, 'the character\'s own menu: held');
  c.setObjectView(['a:Guard'], 'locked', true);                 // its own padlock holds the folder, everywhere
  assert.equal(drag('n:n1'), false);
  assert.match(c.reparentCheck('a:Crate', 'n1').reason, /^Unlock/);
  assert.match(c.reparentCheck('n:n1', 'n2').reason, /^Unlock/);
  for (const label of EDITS) assert.equal(off('n:n1', label), true, label);
  assert.ok(c.menuFor('n:n1').find(item => item.label === 'Unlock selection'), 'its padlock is the folder\'s own');
});

test('Show menu: a folder with a locked kind in it is nested, un-nested, mirrored, dropped and aimed as one', () => {
  const { context: c, b, group, calls } = fixture();
  c.edits.nests = [{ id: 'n1', label: 'Office', items: ['a:Guard'] }];
  Object.assign(c, { hierarchyRoots: keys => keys, captureHierarchyActors: () => ({}), retainHierarchyActors() {}, takeOutOf() {},
    dropEmptyNests() {}, rebuildProxies() {}, selectKeys() {}, log: (...x) => calls.push(['log', ...x]) });
  vm.runInContext(['nextNestLabel', 'nestKeys', 'unnestNest'].map(body).join('\n'), c);
  c.setKindView('pawn', 'locked', true);
  const said = () => calls.filter(x => x[0] === 'status').length;
  let before = said();
  c.nestKeys(['n:n1']);                                          // Create folder on it (or Ctrl+G with it selected whole)
  assert.equal(c.edits.nests.length, 2, 'a new folder holds it');
  assert.equal(said(), before, 'nothing refused');
  c.nestKeys(['a:Hale']);                                        // a character on its own: held by its kind
  assert.equal(c.edits.nests.length, 2);
  assert.match(calls.filter(x => x[0] === 'status').at(-1)[1], /^Characters: locked in the Show menu/);
  const outer = c.edits.nests.find(n => n.id !== 'n1').id;
  c.unnestNest(outer);
  assert.deepEqual(c.edits.nests.map(n => n.id), ['n1'], 'un-nested');
  group.members = [b]; group.userData.nest = 'n1'; c.selected = group;     // the folder selected whole
  assert.equal(c.requireUnlocked(), true, 'Mirror goes through');
  assert.equal(c.memberLocked(b), false, 'Drop to floor and Aim keep its character');
  group.userData.nest = undefined; group.userData.keys = ['a:Guard'];     // the same character picked as one of a group
  assert.equal(c.memberLocked(b), true);
  assert.equal(c.requireUnlocked(), false);
  group.userData.nest = 'n1'; group.userData.keys = undefined;
  c.setObjectView(['a:Guard'], 'locked', true);                  // its own padlock holds the folder, everywhere
  before = c.edits.nests.length;
  c.nestKeys(['n:n1']);
  assert.equal(c.edits.nests.length, before);
  assert.match(calls.filter(x => x[0] === 'status').at(-1)[1], /^This selection is locked/);
  c.unnestNest('n1');
  assert.equal(c.edits.nests.length, before, 'not un-nested');
  assert.equal(c.memberLocked(b), true);
  assert.equal(c.requireUnlocked(), false);
});

test('Show menu: what is placed or pasted of a hidden or locked kind says so', () => {
  const { context: c, a, prop, calls } = fixture();
  c.warnHiddenKinds([a, prop, null], 'Placed');
  assert.equal(calls.some(x => x[0] === 'status'), false, 'nothing to say');
  c.setKindView('pawn', 'hidden', true); c.setKindView('prop', 'locked', true);
  c.warnHiddenKinds([a], 'Placed');
  assert.deepEqual(calls.at(-1), ['status', 'Placed, but Characters are hidden in the Show menu of the 3D view: show them there to see what was placed.']);
  c.warnHiddenKinds([prop], 'Pasted');
  assert.deepEqual(calls.at(-1), ['status', 'Pasted, but Objects are locked in the Show menu of the 3D view: unlock them there to edit what was pasted.']);
  c.warnHiddenKinds([prop, a], 'Drawn');
  assert.match(calls.at(-1)[1], /^Drawn, but Characters are hidden/, 'hidden says more than locked');
});

test('Show menu: a kind\'s icons off hides the icons of that kind only, while the bulb is on', () => {
  const { context: c } = fixture();
  const lamp = actor('Lamp1', 'light'), node = actor('Node1', 'path');
  for (const p of [lamp, node]) { p.userData.body = { visible: true }; c.proxies.children.push(p); }
  c.setKindView('light', 'noIcons', true);
  assert.deepEqual([lamp, node].map(p => [p.visible, p.userData.body.visible]), [[true, false], [true, true]]);
  c.showIcons = false; c.applyObjectVisibility();
  assert.equal(node.userData.body.visible, false, 'the bulb hides every icon');
  c.showIcons = true; c.setKindView('light', 'noIcons', false);
  assert.deepEqual([lamp, node].map(p => p.userData.body.visible), [true, true]);
  lamp.userData.model = {}; c.setKindView('light', 'noIcons', true);
  assert.equal(lamp.userData.body.visible, true, 'a light drawn with its model has no icon to hide');
});

// right click > Properties…: a floating Inspector of that one object (openProperties: inspector-windows-view.js), the
// selection left as it is; none for several things at once or for a folder
test('Properties… opens a window of the object right-clicked, not of a group or a folder', () => {
  const { context: c, group, calls } = fixture();
  c.openProperties = p => calls.push(['properties', c.keyOf(p)]);
  c.menuFor('a:Hale').find(item => item.label === 'Properties…').run();
  assert.deepEqual(calls.at(-1), ['properties', 'a:Hale']);
  assert.equal(calls.some(x => x[0] === 'select'), false, 'the selection stays');
  c.edits.nests = [{ id: 'n1', label: 'Office', items: ['a:Guard'] }];
  assert.equal(c.menuFor('n:n1').some(item => item.label === 'Properties…'), false);
  c.selected = group;
  assert.equal(c.menuFor('a:Hale').some(item => item.label === 'Properties…'), false);
});

test('a linked copy of a prefab: its menu has Select instances, Apply (Update instances when it is older) and Unpack', () => {
  const { context: c, calls } = fixture(), V1 = 'usr_11111111111111111111111111111111', V2 = 'usr_22222222222222222222222222222222';
  const copy = pid => ({ userData: { kind: 'structure', name: 'paste~' + pid }, visible: true });
  c.edits.prefabs = [{ pid: 'p1', prefab: V1, label: 'Desk' }, { pid: 'p2', prefab: 'obj_pipe', label: 'Pipe' }];
  c.structures['paste~p1'] = { name: 'paste~p1', obj: copy('p1'), paste: true };
  c.structures['paste~p2'] = { name: 'paste~p2', obj: copy('p2'), paste: true };
  const labels = spec => Array.from(c.menuFor(spec), x => x.label).filter(l => /instances|prefab|Unpack/.test(l || ''));
  c.newest = { id: V1, line: V1, version: 1 };
  assert.deepEqual(labels('s:paste~p1'), ['Save as prefab…', 'Select instances', 'Apply to prefab', 'Unpack prefab']);
  assert.deepEqual(labels('s:paste~p2'), ['Save as prefab…'], 'a piece of the Pieces: not linked');
  for (const label of ['Select instances', 'Apply to prefab', 'Unpack prefab']) c.menuFor('s:paste~p1').find(x => x.label === label).run();
  c.newest = { id: V2, line: V1, version: 2 };                // an older copy: updated first, not applied
  assert.deepEqual(labels('s:paste~p1'), ['Save as prefab…', 'Select instances', 'Update instances', 'Unpack prefab']);
  c.menuFor('s:paste~p1').find(x => x.label === 'Update instances').run();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(-4))), [['instances', V1], ['apply', 'paste~p1'], ['unpack', ['paste~p1']], ['update', V1]]);
  c.newest = null;                                           // the prefab was deleted: nothing to update or apply to
  assert.deepEqual(labels('s:paste~p1'), ['Save as prefab…', 'Select instances', 'Unpack prefab']);
});
