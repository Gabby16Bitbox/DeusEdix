// Hear the map (the 3D view's speaker, scene-audio.js plays it): which ambient sounds of the map are heard from the
// camera, and how loud. As the game's audio does it (Galaxy, and OpenAL in Revision): an object's AmbientSound loops
// from where it is, heard within WorldSoundRadius = 25 x (SoundRadius + 1) units (byteReach: the sphere showSoundRange
// draws), at SoundVolume / 255 of the sound times the drivers' AmbientFactor (0.7 in DeusEx.ini), its pitch
// SoundPitch / 64 (64: as recorded). Its loudness falls in a straight line from all of it at its place to nothing at
// that radius (the drivers' attenuation, 1 - distance / radius). A zone's own sound is heard in its zone: Deus Ex's
// player gives the zone his head goes into a SoundRadius of 255 (6400 units) and the zone he leaves 0
// (DeusExPlayer.HeadZoneChange, "hack to get the zone's ambientsound working"). No page here: tested with node.
import { byteReach } from './range-handles.js';

export const AMBIENT_FACTOR = 0.7;
export const MAX_HEARD = 16;               // at most this many play at once: the nearest
// a zone's SoundRadius while the camera is in that zone, and once it has left it
export const ZONE_RADIUS = { in: 255, out: 0 };
// Actor's own values, where neither the object nor its class has one
const ACTOR = { radius: 32, volume: 128, pitch: 64 };
const byte = (v, fallback) => {
  const n = Math.round(Number(v));
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : fallback;
};

// How loud a sound is at a distance from its place, 0 to 1: all of it there, nothing at its radius and beyond
export function falloff(distance, radius) {
  return radius > 0 ? Math.max(0, Math.min(1, 1 - distance / radius)) : 0;
}

// A sound as it plays, {sound, radius (units), volume (0 to 1), pitch (its speed: 1 as recorded)}, from an object's
// sound properties (sound: its name, '' for none; radius, volume, pitch: SoundRadius, SoundVolume, SoundPitch as text
// or numbers). inZone: for a zone's own sound whether the camera is in that zone; undefined for any other object, or
// when the zones are not known (the zone's own SoundRadius, as the game has it until JC goes in). null: no sound.
export function ambience({ sound, radius, volume, pitch }, inZone) {
  if (!sound) return null;
  const r = inZone === undefined ? byte(radius, ACTOR.radius) : inZone ? ZONE_RADIUS.in : ZONE_RADIUS.out;
  return { sound, radius: byteReach(r), volume: byte(volume, ACTOR.volume) / 255 * AMBIENT_FACTOR, pitch: byte(pitch, ACTOR.pitch) / 64 };
}

// The map's sounds: objects [{id, at, props: their sound properties (ambience)}]; zones: the last rebuild's zones in
// their order ([{name: its zone actor, at, sound: {sound, radius, volume, pitch} or null}], data.zone_looks); camZone:
// the number of the zone the camera is in (undefined: not known). A zone actor the editor shows is one of the objects
// (its sound as edited), heard as its zone's; the zones' other sounds come from the rebuild, heard in their zone only.
// [{id, at, sound, radius, volume, pitch}]
export function mapSources(objects, zones, camZone) {
  const zoneOf = new Map(zones.map((z, i) => [z?.name, i])), shown = new Set(), out = [];
  const inZone = (i) => (i === undefined || camZone === undefined ? undefined : i === camZone);
  for (const o of objects) {
    shown.add(o.id);
    const s = ambience(o.props, inZone(zoneOf.get(o.id)));
    if (s) out.push({ ...s, id: o.id, at: o.at });
  }
  zones.forEach((z, i) => {
    const s = z?.sound && z.at && !shown.has(z.name) && ambience(z.sound, inZone(i));
    if (s) out.push({ ...s, id: 'zone:' + i, at: z.at });
  });
  return out;
}

// The sounds heard at a point ([x, y, z], the sources' units), nearest first, at most max: each source with its
// distance and its gain there (its volume times its falloff); one out of its reach is not heard
export function heardAt(at, sources, max = MAX_HEARD) {
  const out = [];
  for (const s of sources) {
    const distance = Math.hypot(s.at[0] - at[0], s.at[1] - at[1], s.at[2] - at[2]), gain = s.volume * falloff(distance, s.radius);
    if (gain > 0) out.push({ ...s, distance, gain });
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, max);
}
