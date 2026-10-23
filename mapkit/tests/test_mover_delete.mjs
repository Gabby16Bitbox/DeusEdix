import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(process.env.DEUSEDIX_TEST_APP || new URL('../editor/static/app.js', import.meta.url), 'utf8');
const body = name => {
  const start = source.indexOf(`function ${name}(`), lineEnd = source.indexOf('\n', start);
  assert.ok(start >= 0, name);
  return source.slice(start, source.slice(start, lineEnd).trimEnd().endsWith('}') ? lineEnd : source.indexOf('\n}', start) + 2);
};

function fixture() {
  const calls = [], undo = [], redoStack = [];
  const originals = ['DoorA', 'DoorB', 'Lamp'].map((name, i) => ({name, cls: i < 2 ? 'DeusExMover' : 'Light', kind: i < 2 ? 'mover' : 'light', loc: [i * 10, 0, 0], rot: [0, 0, 0]}));
  const proxies = {children: [], remove(p) { this.children = this.children.filter(o => o !== p); p.parent = null; }, clear() { for (const p of this.children) p.parent = null; this.children = []; }};
  const wall = {userData: {kind: 'structure', name: 'Room'}, visible: true};
  const c = vm.createContext({
    edits: {deleted: {}, moved: {}, added: [], boxes: [], drawn: [], groups: {}, prefabs: [], copies: [], nests: [{id:'n1', items: ['a:DoorA', 'a:DoorB']}],
      props: {DoorA: {bLocked: 'True'}}, motions: {DoorA: {pos: [{t:0,v:[0,0,0]}, {t:1,v:[0,40,0]}]}}},
    baseActors: originals, proxies, structures: {Room: {name:'Room', obj:wall, placement:{}, actors:['DoorA','DoorB','Lamp']}}, actorStruct: {DoorA:'Room',DoorB:'Room'},
    undo, redoStack, selected: null, groupPivot: {userData:{}}, anim: null, textureTransfer: null, surfaceTexturePreview: null,
    confirm: message => { calls.push(['confirm', message]); return c.answer; }, answer:true,
    requireUnlocked: () => !c.locked, locked: false, isStruct:p => p?.userData.kind === 'structure', members: () => c.groupMembers || [],
    poseOf: () => ({offset:[0,0,0],yaw:0}), poseToPose: () => loc => loc.map((v,i) => v + (c.offset?.[i] || 0)), r1: v => v,
    keyOf:p => p.userData.actor ? 'a:' + p.userData.actor.name : p.userData.box ? 'b:' + p.userData.box.name : 's:' + p.userData.name,
    nests: () => c.edits.nests, nestsWithin: () => [],
    closeAnim: () => { c.anim = null; calls.push('closeAnim'); },
    setDirty: () => calls.push('dirty'), showDetails: () => calls.push('details'), log: (...args) => calls.push(['log', ...args]),
    tc: {detach: () => calls.push('detach')}, select: p => { c.selected = p; },
    syncStructures: () => {}, disposeEffectPoint: () => {}, disposeViewportIcons: () => {},
    applyTextureOverrides: () => {}, applyLighting: () => {}, applyObjectVisibility: () => {},
    selectKeys: () => {}, selectNest: () => {}, showChanges: () => {}, buildStructList: () => {}, buildHierarchy: () => {},
    logicBox: {style: {display: 'none'}}, renderLogic: () => {}, YAW:65536,
    addedKind: cls => /Mover/.test(cls) ? 'mover' : 'prop',
    makeProxy: (a, owner) => { const p = {parent:proxies, children:[{geometry: 'mesh:' + a.name}], userData:{actor:a, kind:a.kind, source:owner}}; proxies.children.push(p); return p; },
    makeBoxProxy: b => { proxies.children.push({parent:proxies, children:[{geometry:b.name}], userData:{kind:'box',box:b}}); },
    drawTools: {proxy: () => {}},
  });
  vm.runInContext(['removeOne','confirmMoverDeletion','deleteSelected','animIsMover','pushUndo','afterHistory','rebuildProxies','forgetKeys','dropEmptyNests','removeStructure'].map(body).join('\n'), c);
  c.rebuildProxies(); c.selected = proxies.children[0]; calls.length = 0;
  return {c, calls, wall, proxies, undo, redoStack};
}
const copy = value => JSON.parse(JSON.stringify(value));

test('Cancel leaves door, model, links, selection and undo untouched', () => {
  const {c, calls, undo, proxies} = fixture(), before = JSON.stringify(c.edits), door = c.selected;
  c.answer = false; c.deleteSelected();
  assert.equal(JSON.stringify(c.edits), before); assert.equal(c.selected, door);
  assert.ok(proxies.children.includes(door)); assert.equal(door.children[0].geometry, 'mesh:DoorA');
  assert.equal(undo.length, 0); assert.ok(!calls.includes('dirty'));
  assert.match(calls[0][1], /DoorA/); assert.match(calls[0][1], /mission scripts/); assert.match(calls[0][1], /Ctrl\+Z/);
});

test('Delete removes only mover and its mesh; actual history rebuild restores it and redo removes it', () => {
  const {c, wall, proxies, undo, redoStack} = fixture(), before = copy(c.edits), door = c.selected;
  c.deleteSelected();
  assert.equal(door.parent, null); assert.deepEqual(proxies.children.map(p => p.userData.actor.name), ['DoorB','Lamp']);
  assert.equal(c.structures.Room.obj, wall); assert.equal(wall.visible, true); assert.deepEqual(copy(c.edits.groups), {});
  assert.deepEqual(copy(c.edits.deleted.DoorA), {cls:'DeusExMover',orig:[0,0,0]});
  assert.deepEqual(copy(c.edits.props), before.props); assert.deepEqual(copy(c.edits.motions), before.motions);
  assert.deepEqual(copy(c.edits.nests[0].items), ['a:DoorB']); assert.equal(undo.length,1);
  const deleted = JSON.stringify(c.edits);
  redoStack.push(JSON.stringify(c.edits)); c.edits = JSON.parse(undo.pop()); c.afterHistory();
  assert.deepEqual(copy(c.edits), before); assert.equal(proxies.children[0].children[0].geometry, 'mesh:DoorA');
  undo.push(JSON.stringify(c.edits)); c.edits = JSON.parse(redoStack.pop()); c.afterHistory();
  assert.equal(JSON.stringify(c.edits), deleted); assert.ok(!proxies.children.some(p => p.userData.actor.name === 'DoorA'));
});

test('Locked mover cannot be deleted, and no confirmation is offered', () => {
  const {c,calls,undo}=fixture(); c.locked=true; c.deleteSelected();
  assert.equal(undo.length,0); assert.equal(calls.length,0);
});

test('Deleting moved mover retains original-match coordinates and closes its animation only after confirmation', () => {
  const {c,calls}=fixture(); c.edits.moved.DoorA={cls:'DeusExMover',orig:[100,200,300],loc:[110,210,310]};
  c.anim={p:c.selected}; c.answer=false; c.deleteSelected(); assert.ok(c.anim);
  c.answer=true; c.deleteSelected(); assert.equal(c.anim,null); assert.ok(calls.includes('closeAnim'));
  assert.deepEqual(copy(c.edits.deleted.DoorA.orig),[100,200,300]); assert.equal(c.edits.moved.DoorA,undefined);
});

test('Moved containing structure is accounted for without deleting it', () => {
  const {c}=fixture(); c.offset=[25,40,12]; c.deleteSelected();
  assert.deepEqual(copy(c.edits.deleted.DoorA.orig),[25,40,12]); assert.deepEqual(copy(c.edits.groups),{});
});

test('Unnested mover follows the same confirmation and deletion path', () => {
  const {c}=fixture(); c.actorStruct={}; c.deleteSelected();
  assert.ok(c.edits.deleted.DoorA); assert.equal(Object.keys(c.edits.deleted).length,1);
});

test('Multi-delete asks once for movers; cancel is atomic; undo snapshot contains every item', () => {
  const {c,calls,undo,proxies}=fixture(); c.groupMembers=proxies.children.slice(0,2); c.selected=c.groupPivot;
  c.answer=false; c.deleteSelected(); assert.equal(proxies.children.length,3); assert.equal(undo.length,0);
  c.answer=true; c.deleteSelected(); assert.equal(undo.length,1); assert.equal(proxies.children.length,1);
  assert.equal(calls.filter(x=>Array.isArray(x)&&x[0]==='confirm').length,2);
  assert.match(calls[0][1],/2 doors/); assert.deepEqual(Object.keys(c.edits.deleted),['DoorA','DoorB']);
});

test('Added mover and animated block also require confirmation, ordinary props do not', () => {
  for (const mode of ['added','box','ordinary']) {
    const {c,calls,undo}=fixture();
    if(mode==='added') { const a={name:'NewDoor',cls:'DeusExMover',kind:'mover'}; c.edits.added.push(a); c.selected=c.makeProxy(a,'added'); }
    else if(mode==='box') { const b={name:'MovingBlock',mover:true}; c.edits.boxes.push(b); c.makeBoxProxy(b); c.selected=c.proxies.children.at(-1); }
    else c.selected=c.proxies.children.at(-1);
    c.deleteSelected(); assert.equal(undo.length,1);
    assert.equal(calls.filter(x=>Array.isArray(x)&&x[0]==='confirm').length, mode==='ordinary'?0:1);
    if(mode==='added') assert.equal(c.edits.added.length,0);
    if(mode==='box') assert.equal(c.edits.boxes.length,0);
  }
});
