// The 3D view's Show menu (static/scene-kinds.js): its rows are the Hierarchy's kinds, each thing is in one of them,
// and its state (hidden, locked, icons off, the icons' size) is kept and read back, whatever was kept before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HIER_KINDS, HIER_FOLDERS, SHOW_KINDS, SHOW_KIND, KIND_STATES, ICON_SIZE, ZONE_CLASSES, classKind, showKindOf, iconSizeOf,
  createKindFilter } from '../editor/static/scene-kinds.js';

test('the rows: the structures, the Hierarchy\'s kinds in its order, then sounds, cameras and zones', () => {
  assert.deepEqual(SHOW_KINDS.map((k) => k.id), ['structure', ...HIER_KINDS.map(([id]) => id), 'sound', 'camera', 'zone']);
  assert.deepEqual(SHOW_KINDS.map((k) => k.label), ['Structures', 'Characters', 'Lights', 'Objects', 'Doors and elevators',
    'Triggers and logic', 'AI paths', 'Blocks', 'Sounds', 'Cameras and cutscenes', 'Zones']);
  // only kinds drawn as icons have an icon switch
  assert.deepEqual(SHOW_KINDS.filter((k) => k.icons).map((k) => k.id), ['light', 'logic', 'path', 'sound', 'camera', 'zone']);
  assert.equal(SHOW_KIND.light.label, 'Lights');
  assert.ok(Object.isFrozen(SHOW_KINDS) && Object.isFrozen(SHOW_KINDS[0]));
  // the Hierarchy's folders of objects are the same rows, but the structures (a folder of their own)
  assert.deepEqual(HIER_FOLDERS, SHOW_KINDS.slice(1));
});

test('each thing is in one row: its class first, else its kind', () => {
  assert.equal(showKindOf('structure'), 'structure');
  assert.equal(showKindOf('box'), 'box');
  assert.equal(showKindOf('drawn'), 'box');                       // a drawing goes with the blocks
  assert.equal(showKindOf('pawn', 'UCCustomCivilian'), 'pawn');
  assert.equal(showKindOf('light', 'Spotlight'), 'light');
  assert.equal(showKindOf('logic', 'Trigger'), 'logic');
  assert.equal(showKindOf('logic', 'AmbientSound'), 'sound');
  assert.equal(showKindOf('logic', 'UCSoundFX'), 'sound');
  assert.equal(showKindOf('logic', 'UCCutscene'), 'camera');
  assert.equal(showKindOf('prop', 'SecurityCamera'), 'camera');    // a camera with a model is a camera all the same
  assert.equal(showKindOf('logic', 'InterpolationPoint'), 'camera');
  assert.equal(showKindOf('logic', 'WaterZone'), 'zone');
  assert.equal(showKindOf('logic', 'Engine.ZoneInfo'), 'zone');    // with its package
  assert.equal(showKindOf('mover', 'DeusExMover'), 'mover');
  assert.equal(showKindOf('path', 'PatrolPoint'), 'path');
  assert.equal(showKindOf(undefined, 'Whatever'), 'prop');         // anything else with the objects
  assert.equal(showKindOf('group'), 'prop');
  assert.equal(classKind(undefined), null);
  // by a word of the name, so the classes of the game and of a mod alike (the 3D view draws their icons by it too);
  // a zone's name ends with it; with two words, the last one
  for (const [cls, kind] of [['AmbientSoundTriggered', 'sound'], ['RevAmbientSound', 'sound'], ['RevFollowingSound', 'sound'],
    ['RevStalkingSound', 'sound'], ['MusicEvent', 'sound'], ['DXOggMusicTrigger', 'sound'], ['PrecipitationSound', 'sound'],
    ['WarpZoneInfo', 'zone'], ['RevLightningZone', 'zone'], ['RevSoundZone', 'zone'], ['SkyZoneInfo', 'zone'],
    ['CameraPoint', 'camera'], ['Engine.Camera', 'camera'], ['WarpZoneMarker', null], ['ZoneTrigger', null],
    ['RevLightningZoneCreator', null], ['Trigger', null], ['ScriptedPawn', null]]) assert.equal(classKind(cls), kind, cls);
  assert.equal(showKindOf('logic', 'AmbientSoundTriggered'), 'sound');
  assert.equal(showKindOf('path', 'WarpZoneMarker'), 'path');
  // a character stays one, whatever its name says: the engine's Camera is a PlayerPawn
  assert.equal(classKind('Engine.Camera', 'pawn'), null);
  assert.equal(showKindOf('pawn', 'Engine.Camera'), 'pawn');
  assert.equal(showKindOf('pawn', 'Camera'), 'pawn');
  assert.equal(showKindOf('pawn', 'RevAmbientSound'), 'pawn');
  assert.equal(classKind('SecurityCamera', 'prop'), 'camera');      // anything else by its name, as before
  assert.equal(showKindOf('logic', 'Engine.Camera'), 'camera');
  assert.ok(ZONE_CLASSES.test('SkyZoneInfo') && !ZONE_CLASSES.test('Engine.ZoneInfo'));   // the editor's own test of a bare class
});

test('a new project: everything shown, unlocked, with icons, at the first size', () => {
  for (const saved of [null, undefined, {}, 'nonsense', 42, { hidden: 'light', locked: null }]) {
    const f = createKindFilter(saved);
    for (const s of KIND_STATES) assert.deepEqual(f.kinds(s), [], `${JSON.stringify(saved)} ${s}`);
    assert.equal(f.filtering, false);
    assert.equal(f.iconSize, ICON_SIZE.start);
  }
});

test('states are set, read back in the menu\'s order, kept and taken back', () => {
  const f = createKindFilter(null);
  f.set('hidden', 'zone', true);
  f.set('hidden', 'light', true);
  f.set('locked', 'structure', true);
  f.set('noIcons', 'path', true);
  f.set('hidden', 'nothing', true);                                // not a kind: ignored
  f.set('sideways', 'light', true);                                // not a state: ignored
  assert.equal(f.has('hidden', 'light'), true);
  assert.equal(f.has('hidden', 'pawn'), false);
  assert.equal(f.has('hidden', null), false);                      // a thing of no kind (the group's pivot)
  assert.equal(f.has('locked', 'structure'), true);
  assert.deepEqual(f.kinds('hidden'), ['light', 'zone']);
  assert.equal(f.filtering, true);
  f.setIconSize(50);
  const kept = JSON.parse(JSON.stringify(f));
  assert.deepEqual(kept, { hidden: ['light', 'zone'], locked: ['structure'], noIcons: ['path'], iconSize: 52 });
  const back = createKindFilter(kept);
  assert.deepEqual(KIND_STATES.map((s) => back.kinds(s)), [['light', 'zone'], ['structure'], ['path']]);
  assert.equal(back.iconSize, 52);
  f.set('hidden', 'light', false);
  assert.deepEqual(f.kinds('hidden'), ['zone']);
  f.reset();
  assert.equal(f.filtering, false);
  assert.equal(f.iconSize, 52);                                    // the size is the slider's own
});

test('a kept state with kinds that are no longer there drops them', () => {
  const f = createKindFilter({ hidden: ['light', 'brushes', 3, null], locked: ['pawn', 'pawn'], noIcons: 'logic', iconSize: '24' });
  assert.deepEqual(f.kinds('hidden'), ['light']);
  assert.deepEqual(f.kinds('locked'), ['pawn']);
  assert.deepEqual(f.kinds('noIcons'), []);
  assert.equal(f.iconSize, 24);
});

test('a kind\'s name shows only it; again, every kind; the locks stay', () => {
  const f = createKindFilter({ hidden: ['pawn'], locked: ['structure'] });
  f.solo('logic');
  assert.deepEqual(f.kinds('hidden'), SHOW_KINDS.map((k) => k.id).filter((id) => id !== 'logic'));
  f.solo('logic');
  assert.deepEqual(f.kinds('hidden'), []);
  f.solo('light');
  f.solo('sound');                                                 // another one: only that one
  assert.deepEqual(SHOW_KINDS.map((k) => k.id).filter((id) => !f.has('hidden', id)), ['sound']);
  f.solo('nothing');
  assert.deepEqual(SHOW_KINDS.map((k) => k.id).filter((id) => !f.has('hidden', id)), ['sound']);
  assert.deepEqual(f.kinds('locked'), ['structure']);
});

test('the icons\' size: on a step, within the ends, the first size for what is no number', () => {
  assert.equal(iconSizeOf(32), 32);
  assert.equal(iconSizeOf(33), 32);
  assert.equal(iconSizeOf(35), 36);
  assert.equal(iconSizeOf('64'), 64);
  assert.equal(iconSizeOf(1), ICON_SIZE.min);
  assert.equal(iconSizeOf(1000), ICON_SIZE.max);
  for (const v of [null, undefined, '', 'big', NaN, Infinity]) assert.equal(iconSizeOf(v), ICON_SIZE.start, String(v));
  const f = createKindFilter(null);
  assert.equal(f.setIconSize(-5), ICON_SIZE.min);
  assert.equal(f.iconSize, ICON_SIZE.min);
});
