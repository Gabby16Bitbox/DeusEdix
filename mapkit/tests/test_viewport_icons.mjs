// Run with Node; use the same Three.js revision as the editor, without WebGL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { THREE, threeURL } from './three.mjs';   // without three.js 0.160.0 the test is skipped
const kindsURL = new URL('../editor/static/scene-kinds.js', import.meta.url);
const source = (await readFile(new URL('../editor/static/viewport-icons.js', import.meta.url), 'utf8'))
  .replace("from 'three'", `from '${threeURL}'`).replace("from './scene-kinds.js'", `from '${kindsURL.href}'`);
const { classKind } = await import(kindsURL);

test('the viewport icons: kinds, pictures, colours, sizes', async () => {
const { viewportIconKind, viewportIconSpec, createViewportIcon, disposeViewportIcons, setViewportIconSize, objectPreviewIcon } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

for (const [cls, kind, expected] of [
  ['Light', 'light', 'light'], ['Engine.Spotlight', 'light', 'light'],
  ['UCCutscene', 'logic', 'camera'], ['InterpolationPoint', 'path', 'camera'],
  ['PathNode', 'path', 'walk'], ['PatrolPoint', 'path', 'walk'], ['HidePoint', 'path', 'walk'],
  ['AmbientSound', 'logic', 'sound'], ['UCSoundFX', 'logic', 'sound'],
  ['UCTriggerBox', 'logic', 'box'], ['Trigger', 'logic', 'trigger'],
  ['WaterZone', 'logic', 'water'], ['ZoneInfo', 'logic', 'zone'], ['PrecipitationZone', 'logic', 'weather'],
  ['Teleporter', 'logic', 'exit'], ['FlagTrigger', 'logic', 'flag'], ['Dispatcher', 'logic', 'logic'],
  ['RevAmbientSound', 'logic', 'sound'], ['MusicEvent', 'logic', 'sound'], ['WarpZoneInfo', 'logic', 'zone'],
  ['RevLightningZone', 'logic', 'zone'], ['RevSoundZone', 'logic', 'zone'], ['ZoneTrigger', 'logic', 'trigger'],
  ['PrecipitationShelter', 'logic', 'logic'],
]) assert.equal(viewportIconKind({ cls, kind }), expected, cls);
// one classification: a speaker, a camera or a zone's picture is drawn for the Show menu's sounds, cameras and zones
// (scene-kinds.js classKind) and nothing else
const ZONE_ICONS = ['zone', 'water', 'weather'];
for (const cls of ['AmbientSound', 'AmbientSoundTriggered', 'RevStalkingSound', 'DXOggMusicTrigger', 'UCSoundFX', 'UCCutscene',
  'CameraPoint', 'InterpolationPoint', 'ZoneInfo', 'WaterZone', 'SnowZone', 'SkyZoneInfo', 'WarpZoneInfo', 'RevSoundZone',
  'WarpZoneMarker', 'ZoneTrigger', 'Trigger', 'Dispatcher', 'PrecipitationShelter', 'RevLightningZoneCreator']) {
  const icon = viewportIconKind({ cls, kind: 'logic' }), own = classKind(cls);
  assert.equal(icon === 'sound', own === 'sound', cls);
  assert.equal(icon === 'camera', own === 'camera', cls);
  assert.equal(ZONE_ICONS.includes(icon), own === 'zone', cls);
}
// a character's class is a character's, whatever its name says (the engine's Camera is a PlayerPawn)
assert.notEqual(viewportIconKind({ cls: 'Engine.Camera', kind: 'pawn' }), 'camera');
assert.equal(viewportIconKind({ cls: 'Engine.Camera', kind: 'logic' }), 'camera');
// the Browser's picture of a class with no model: what it makes (water, weather, a zone), though in the 3D view these
// classes keep the icon of their row of the Show menu, which is not Zones
const picture = (cls) => /data-icon="(\w+)"/.exec(objectPreviewIcon(cls))[1];
// (the weather's picture says which: snow or rain, iconGlyph, since 2 Nov 2026)
for (const [cls, made] of [['SnowPrecipitator', 'snow'], ['PrecipitationNode', 'rain'], ['Raindrop', 'rain'],
  ['RevRaindrop', 'rain'], ['WaterDrips', 'water'], ['WaterDrop', 'water'], ['RaindropRing', 'rain'], ['Snowflake', 'snow'],
  ['RevLightningZoneCreator', 'zone']]) {
  assert.equal(picture(cls), made, cls);
  assert.equal(classKind(cls), null, cls);
  assert.ok(!ZONE_ICONS.includes(viewportIconKind({ cls, kind: 'logic' })), `${cls}: no zone's icon in the 3D view`);
}
// the others as the 3D view draws them (a thing of none of these: a box)
for (const [cls, made] of [['WaterZone', 'water'], ['ZoneInfo', 'zone'], ['AmbientSound', 'sound'], ['ZoneTrigger', 'trigger'],
  ['Dispatcher', 'logic'], ['UCCutscene', 'camera'], ['Barrel1', 'box']]) assert.equal(picture(cls), made, cls);
assert.equal(viewportIconSpec({ kind: 'light' }, 0x12ab34).color, 0x12ab34);
assert.equal(viewportIconSpec({ kind: 'light' }, 0).color, 0);
assert.equal(viewportIconSpec({}, NaN).color, 0xc58cff);

let created = 0;
globalThis.Path2D = class { constructor(path) { assert.ok(path.startsWith('M')); } };
globalThis.document = { createElement(tag) {
  assert.equal(tag, 'canvas'); created++;
  return { getContext: () => ({ stroke() {} }) };
} };
const light = createViewportIcon({ cls: 'Light', kind: 'light' }, 0x12ab34);
const second = createViewportIcon({ cls: 'Light', kind: 'light' }, 0xff4400);
assert.ok(light.isSprite);
assert.equal(light.material.map, second.material.map, 'share a single texture across light colours');
assert.equal(created, 1);
assert.equal(light.material.depthTest, true, 'world walls occlude symbols');
assert.equal(light.material.depthWrite, false);
assert.equal(light.material.color.getHex(), 0x12ab34);
light.material.color.setHex(0xff00ff);
assert.equal(light.material.color.getHex(), 0xff00ff, 'existing light Inspector updates remain live');
assert.equal(second.material.color.getHex(), 0xff4400, 'colours stay independent');
assert.equal(created, 1, 'colour changes allocate no textures');
assert.equal(light.scale.x, 32);
setViewportIconSize(48, [light, null, new THREE.Mesh(), second]);          // the Show menu's slider: icons only
assert.deepEqual([light.scale.x, light.scale.y, second.scale.x], [48, 48, 48]);
assert.equal(createViewportIcon({ kind: 'path', cls: 'PathNode' }).scale.x, 48, 'icons made later take the size');
assert.equal(viewportIconSpec({ kind: 'light' }).size, 48);
setViewportIconSize(32, [light, second]);
assert.equal(light.scale.x, 32);

const group = new THREE.Group(); group.rotation.y = Math.PI / 2; group.add(light);
group.updateMatrixWorld(true);
const camera = new THREE.PerspectiveCamera(60, 1, 1, 1000);
camera.position.set(70, 35, 100); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0, 0), camera);
assert.equal(ray.intersectObject(group, true).length, 1, 'billboard remains pickable after actor rotation and camera orbit');
let disposed = 0;
light.material.addEventListener('dispose', () => disposed++);
disposeViewportIcons(group);
assert.equal(disposed, 1);
assert.equal(createViewportIcon({ kind: 'light' }, 0).material.map, second.material.map, 'rebuild retains shared glyph');
console.log('PASS viewport glyph classification, colours, texture sharing, occlusion material, picking and disposal');
});
