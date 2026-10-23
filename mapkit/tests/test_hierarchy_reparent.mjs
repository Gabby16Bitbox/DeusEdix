import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../../research/rea-blender/three.module.mjs';
import { createRotations } from '../editor/static/rotation.js';
const rotations = createRotations(THREE);

const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
function body(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const functions = ['keyOf', 'objOf', 'nestLeaves', 'nestsWithin', 'newNest', 'nextNestLabel', 'dropEmptyNests',
  'poseToPose', 'rotUE', 'bakeOut', 'takeOutOf', 'stateTargets', 'stateKeys', 'captureHierarchyActors', 'retainHierarchyActors',
  'reparentCheck', 'moveTo', 'hierarchyRoots', 'nestKeys', 'unnestNest', 'rebuildProxies', 'beginGroupMove', 'followGroupMove', 'canScale'];

function setup() {
  const scene = new THREE.Scene(), proxies = new THREE.Group(), world = new THREE.Group(), groupPivot = new THREE.Group();
  scene.add(proxies, world, groupPivot);
  const room = new THREE.Group(); room.userData = { kind: 'structure', name: 'Room' }; world.add(room);
  const initial = { name: 'Light1', cls: 'Light', kind: 'light', loc: [260, 140, 128], rot: [0, 8192, 0] };
  const calls = [], history = [], locked = new Set();
  const context = vm.createContext({ THREE, rotations, scene, proxies, world, groupPivot, selected: null,
    objectRotation: p => p.userData.actor ? [p.userData.actor.rot?.[0] || 0, ((Math.round(-p.rotation.y*65536/(2*Math.PI))%65536)+65536)%65536, p.userData.actor.rot?.[2] || 0] : rotations.rot(p.quaternion),
    setObjectRotation: (p, r) => p.quaternion.copy(rotations.quat(r)),
    script: 'regression', baseActors: [initial], builtScale: {}, actorStruct: { Light1: 'Room' }, textureTransfer: null, surfaceTexturePreview: null,
    edits: { moved: {}, deleted: {}, groups: { Room: { offset: [128, -64, 16], yaw: 16384, scale: [2, 1, 1] } }, added: [], boxes: [], nests: [{ id: 'outer', label: 'Outer', items: ['n:inner'] }, { id: 'inner', label: 'Inner', items: [] }], unnest: [], copies: [], prefabs: [] },
    structures: { Room: { name: 'Room', label: 'Room', obj: room, pivot: [64, 80, 0], placement: { offset: [24, 16, 0], yaw: 8192, scale: [1.5, 1, 1] }, actors: ['Light1'], pieces: [], built: true, rotatable: true } },
    ONE: [1, 1, 1], NO_POSE: { offset: [0, 0, 0], yaw: 0, scale: [1, 1, 1] }, YAW: 65536,
    T: v => new THREE.Vector3(v[0], v[2], v[1]), UE: p => [p.x, p.z, p.y].map(x => Math.round(x * 10) / 10),
    r1: x => Math.round(x * 10) / 10, add3: (a, b) => a.map((x, i) => x + b[i]),
    yawToRad: yaw => -yaw * 2 * Math.PI / 65536,
    radToYaw: rad => ((Math.round(-rad * 65536 / (2 * Math.PI)) % 65536) + 65536) % 65536,
    scaleOf: pose => pose?.scale || [1, 1, 1], movedPose: pose => pose.offset?.some(Boolean) || !!pose.yaw || (pose.scale || [1, 1, 1]).some(v => v !== 1),
    takenOut: () => new Set(context.edits.unnest), unnests: () => context.edits.unnest,
    poseOf: st => ({ offset: [0, 0, 0], yaw: 0, scale: [1, 1, 1], ...context.edits.groups[st.name] }),
    piecesInside: st => st.pieces || [], objectsInside: st => Object.keys(context.actorStruct).filter(name => context.actorStruct[name] === st.name),
    isStruct: p => p?.userData.kind === 'structure', addedKind: cls => cls === 'Light' ? 'light' : 'prop',
    proxyOf: name => proxies.children.find(p => p.userData.actor?.name === name),
    nests: () => context.edits.nests, nestById: id => context.edits.nests.find(n => n.id === id), parentNest: key => context.edits.nests.find(n => n.items.includes(key)),
    members: () => groupPivot.userData.members || [], selKeys: () => context.selected ? context.selected === groupPivot ? ['n:inner'] : [context.keyOf(context.selected)] : [],
    selectionLocked: p => locked.has(context.keyOf(p)), requireUnlocked: p => !locked.has(context.keyOf(p)),
    viewState: () => ({ hidden: new Set(), locked: new Set() }),
    tc: { mode: 'translate', detach() {} }, status: (...args) => calls.push(args), log() {},
    pushUndo: () => history.push(JSON.stringify(context.edits)), setDirty() {}, showChanges() {}, buildHierarchy() {}, buildStructList() {},
    applyTextureOverrides() {}, applyLighting() {}, applyObjectVisibility() {}, disposeEffectPoint() {}, disposeViewportIcons() {}, select: p => { context.selected = p; }, selectNest() {}, selectKeys() {},
    makeBoxProxy() {}, syncStructures: () => { for (const id of context.edits.unnest) if (id.startsWith('a:')) delete context.actorStruct[id.slice(2)]; },
    beginStructMove: p => ({ st: context.structures[p.userData.name] }), followStructure: state => calls.push(['follow structure', state.st.name]),
  });
  context.makeProxy = (a, source) => {
    const p = new THREE.Group(); p.userData = { actor: a, source, kind: a.kind || 'prop' };
    p.position.copy(context.T(a.loc)); p.rotation.y = context.yawToRad(a.rot?.[1] || 0);
    p.scale.setScalar(source === 'added' ? a.scale || 1 : (context.edits.moved[a.name]?.scale || 1) / (context.builtScale[a.name] || 1));
    proxies.add(p); return p;
  };
  vm.runInContext(functions.map(body).join('\n'), context);
  const p = context.makeProxy(initial, 'map');
  // A light currently displayed at a different world pose than its last saved/built coordinates.
  p.position.set(384.2, 192.4, -125.6); p.rotation.y = -Math.PI / 2;
  context.selected = p;
  return { c: context, p, history, locked, calls, scene };
}
const worldPose = p => { p.updateWorldMatrix(true, false); return { position: p.getWorldPosition(new THREE.Vector3()), quaternion: p.getWorldQuaternion(new THREE.Quaternion()), scale: p.getWorldScale(new THREE.Vector3()) }; };
function samePose(expected, actual) {
  assert.ok(expected.position.distanceTo(actual.position) < 0.09, `position ${expected.position.toArray()} != ${actual.position.toArray()}`);
  assert.ok(1 - Math.abs(expected.quaternion.dot(actual.quaternion)) < 1e-8);
  assert.ok(expected.scale.distanceTo(actual.scale) < 1e-6);
}

test('a light dragged from a transformed structure into a nested Nest keeps its displayed world pose', () => {
  const { c, p, history } = setup(), before = worldPose(p), oldEdits = JSON.stringify(c.edits);
  c.moveTo('a:Light1', 'inner');
  samePose(before, worldPose(c.proxyOf('Light1')));
  assert.equal(c.parentNest('a:Light1').id, 'inner');
  assert.ok(c.edits.unnest.includes('a:Light1'));
  assert.equal(history.length, 1); assert.equal(history[0], oldEdits);
});

test('reparenting between Nests, then to top level, does not apply a parent offset twice', () => {
  const { c, p } = setup(), before = worldPose(p);
  c.moveTo('a:Light1', 'inner');
  c.moveTo('a:Light1', 'outer');
  samePose(before, worldPose(c.proxyOf('Light1')));
  c.moveTo('a:Light1', null);
  samePose(before, worldPose(c.proxyOf('Light1')));
  assert.equal(c.parentNest('a:Light1'), undefined);
});

test('source snapshots use real Three.js world transforms even when the display root is transformed', () => {
  const { c, p } = setup();
  c.proxies.position.set(80, 40, -20); c.proxies.rotation.y = Math.PI / 4; c.proxies.scale.setScalar(1.5);
  const before = worldPose(p), poses = c.captureHierarchyActors(['a:Light1']);
  c.retainHierarchyActors(poses);
  assert.deepEqual(Array.from(c.edits.moved.Light1.loc), c.UE(before.position));
  assert.equal(c.edits.moved.Light1.scale, 1.5);
});

test('grouping and ungrouping a light retain world pose and one undo per operation', () => {
  const { c, p, history } = setup(), before = worldPose(p);
  c.nestKeys(['a:Light1']); const id = c.parentNest('a:Light1').id;
  samePose(before, worldPose(c.proxyOf('Light1')));
  c.unnestNest(id);
  samePose(before, worldPose(c.proxyOf('Light1')));
  assert.equal(history.length, 2);
});

test('invalid, locked, unchanged and cyclic drops never mutate or consume undo', () => {
  const { c, history, locked } = setup(), before = JSON.stringify(c.edits);
  c.moveTo('n:outer', 'inner'); c.moveTo('n:inner', 'inner'); c.moveTo('a:Light1', 'missing');
  locked.add('a:Light1'); c.moveTo('a:Light1', 'inner'); locked.clear();
  c.moveTo('n:inner', 'outer');
  assert.equal(JSON.stringify(c.edits), before); assert.equal(history.length, 0);
});

test('grouping a selected parent and child preserves the existing child hierarchy', () => {
  const { c } = setup();
  c.nestById('inner').items.push('a:Light1');
  c.nestKeys(['n:outer', 'n:inner']);
  const wrapper = c.parentNest('n:outer');
  assert.ok(wrapper); assert.deepEqual(Array.from(wrapper.items), ['n:outer']);
  assert.equal(c.parentNest('n:inner').id, 'outer');
  assert.deepEqual(Array.from(c.hierarchyRoots(['s:Room', 'a:Light1'])), ['s:Room']);
});

test('nested group translation and rotation apply once around the shared pivot', () => {
  const { c, p } = setup();
  delete c.actorStruct.Light1;
  const b = c.makeProxy({ name: 'Crate1', cls: 'Crate', kind: 'prop', loc: [-20, 0, 20], rot: [0, 0, 0] }, 'added');
  p.position.set(20, 20, 0); p.rotation.y = 0;
  c.groupPivot.position.set(0, 20, 0); c.groupPivot.userData.members = [p, b];
  const state = c.beginGroupMove();
  c.groupPivot.position.add(new THREE.Vector3(100, 10, 50)); c.groupPivot.rotation.y = Math.PI / 2;
  c.followGroupMove(state);
  assert.ok(p.position.distanceTo(new THREE.Vector3(100, 30, 30)) < 1e-8);
  assert.ok(b.position.distanceTo(new THREE.Vector3(100, 30, 70)) < 1e-8);
  const first = p.position.clone(); c.followGroupMove(state); assert.ok(first.distanceTo(p.position) < 1e-8, 'No accumulated transform');
});

test('group scale is uniform and available only when every member can scale', () => {
  const { c, p } = setup();
  const a = c.makeProxy({ name: 'Box1', cls: 'Crate', kind: 'prop', loc: [20, 0, 20], rot: [0, 0, 0] }, 'added');
  const b = c.makeProxy({ name: 'Box2', cls: 'Crate', kind: 'prop', loc: [-20, 0, 20], rot: [0, 0, 0] }, 'added');
  c.groupPivot.position.set(0, 20, 0); c.groupPivot.userData.members = [a, b]; c.selected = c.groupPivot;
  assert.equal(c.canScale(c.groupPivot), true);
  c.tc.mode = 'scale'; const state = c.beginGroupMove(); c.groupPivot.scale.x = 2; c.followGroupMove(state);
  assert.ok(a.position.distanceTo(new THREE.Vector3(40, 20, 0)) < 1e-8);
  assert.deepEqual(a.scale.toArray(), [2, 2, 2]); assert.deepEqual(b.scale.toArray(), [2, 2, 2]);
  c.groupPivot.userData.members.push(p); assert.equal(c.canScale(c.groupPivot), false);
});

