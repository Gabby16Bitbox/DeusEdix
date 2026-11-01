// Hear the map's maths (static/ambient-sound.js): how loud an ambient sound is from the camera (the game's straight
// falloff to WorldSoundRadius = 25 x (SoundRadius + 1), SoundVolume x AmbientFactor, SoundPitch / 64), a zone's sound
// heard in its zone only (Deus Ex's 255 / 0), and the 16 nearest chosen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { falloff, ambience, mapSources, heardAt, AMBIENT_FACTOR, MAX_HEARD, ZONE_RADIUS } from '../editor/static/ambient-sound.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('the loudness falls in a straight line from the place to nothing at the radius', () => {
  close(falloff(0, 825), 1);
  close(falloff(412.5, 825), 0.5);
  close(falloff(825, 825), 0);
  close(falloff(2000, 825), 0);
  close(falloff(0, 0), 0);                       // no radius: never heard
});

test('a sound plays at WorldSoundRadius, SoundVolume / 255 x AmbientFactor and SoundPitch / 64', () => {
  const s = ambience({ sound: 'Ambient.Ambient.Bar', radius: '40', volume: '200', pitch: '32' });
  assert.deepEqual({ sound: s.sound, radius: s.radius }, { sound: 'Ambient.Ambient.Bar', radius: 25 * 41 });
  close(s.volume, 200 / 255 * AMBIENT_FACTOR);
  close(s.pitch, 0.5);
  // what neither the object nor its class says: Actor's (radius 32, volume 128, pitch 64); text it cannot read too
  const d = ambience({ sound: 'X.Y', radius: undefined, volume: '', pitch: 'fast' });
  assert.equal(d.radius, 25 * 33);
  close(d.volume, 128 / 255 * AMBIENT_FACTOR);
  close(d.pitch, 1);
  assert.equal(ambience({ sound: 'X.Y', radius: '999' }).radius, 25 * 256);       // a byte
  assert.equal(ambience({ sound: '', radius: '40' }), null);
});

test("a zone's own sound: 6400 units while the camera is in its zone, 25 out of it, its own radius when not known", () => {
  const props = { sound: 'Ambient.Ambient.Machinery', radius: '40', volume: '200', pitch: '64' };
  assert.equal(ambience(props, true).radius, 25 * (ZONE_RADIUS.in + 1));
  assert.equal(ambience(props, true).radius, 6400);
  assert.equal(ambience(props, false).radius, 25);
  assert.equal(ambience(props, undefined).radius, 1025);
});

test("the map's sounds: its objects', a zone actor's as its zone's, the rebuild's other zones in their zone only", () => {
  const objects = [
    { id: 'AmbientSound3', at: [0, 0, 0], props: { sound: 'A.Hum', radius: '10', volume: '255', pitch: '64' } },
    { id: 'WaterZone0', at: [500, 0, 0], props: { sound: 'Ambient.Ambient.Underwater', radius: '0', volume: '128', pitch: '64' } },
    { id: 'Chair1', at: [9, 9, 9], props: { sound: '' } },
  ];
  const zones = [
    { name: 'LevelInfo0', at: [0, 0, 0], sound: null },
    { name: 'WaterZone0', at: [500, 0, 0], sound: { sound: 'Old.Sound', radius: 0, volume: 128, pitch: 64 } },  // shown: its edits win
    { name: 'ZoneInfo2', at: [0, 0, 900], sound: { sound: 'Ambient.Ambient.Bar', radius: 40, volume: 64, pitch: 64 } },
  ];
  const byId = (list) => Object.fromEntries(list.map((s) => [s.id, s]));
  let s = byId(mapSources(objects, zones, 1));             // the camera in the water
  assert.deepEqual(Object.keys(s).sort(), ['AmbientSound3', 'WaterZone0', 'zone:2']);
  assert.equal(s.WaterZone0.sound, 'Ambient.Ambient.Underwater');
  assert.equal(s.WaterZone0.radius, 6400);
  assert.equal(s['zone:2'].radius, 25);                    // the bar's zone: the camera is not in it
  assert.equal(s.AmbientSound3.radius, 275);               // not a zone: its own radius
  s = byId(mapSources(objects, zones, 2));                 // the camera in the bar
  assert.equal(s.WaterZone0.radius, 25);
  assert.equal(s['zone:2'].radius, 6400);
  assert.deepEqual(s['zone:2'].at, [0, 0, 900]);
  // the camera's zone not known (no rebuild with zones): a zone actor at its own radius, the rebuild's zones as theirs
  s = byId(mapSources(objects, zones, undefined));
  assert.equal(s.WaterZone0.radius, 25);                   // SoundRadius 0
  assert.equal(s['zone:2'].radius, 1025);
  assert.equal(mapSources(objects, [], undefined).length, 2);
});

test('the nearest sounds heard play, at most 16, each at its volume times its falloff', () => {
  const sources = Array.from({ length: 30 }, (_, i) => ({ id: 'S' + i, at: [100 * i, 0, 0], radius: 5000, volume: 0.5 }));
  sources.push({ id: 'Far', at: [0, 3000, 0], radius: 1000, volume: 1 });       // out of its reach
  const heard = heardAt([0, 0, 0], sources);
  assert.equal(heard.length, MAX_HEARD);
  assert.deepEqual(heard.map((s) => s.id), sources.slice(0, 16).map((s) => s.id));
  close(heard[3].distance, 300);
  close(heard[3].gain, 0.5 * (1 - 300 / 5000));
  assert.equal(heardAt([0, 0, 0], sources, 4).length, 4);
  assert.deepEqual(heardAt([0, 2500, 0], [sources.at(-1)]).map((s) => s.id), ['Far']);
  assert.deepEqual(heardAt([0, 0, 0], [{ id: 'Mute', at: [0, 0, 0], radius: 500, volume: 0 }]), []);
});
