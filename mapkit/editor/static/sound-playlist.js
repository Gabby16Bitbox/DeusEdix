// A sound effect's playlist (Unity's Audio Random Container): UCSoundFX plays one of its sounds each time it plays
// (FXSound, then FXSounds[0..6]: up to 8; their empty places left out), at random but never the same one twice in a
// row, or in sequence (FXOrder); its volume and pitch varied by up to RandomVolume and RandomPitch of them either way;
// and once it has played, again after a random wait between RepeatMin and RepeatMax seconds (RepeatMax 0: once). An
// effect with one sound and none of these plays as it always did. The logic only, as UCSoundFX does it in the game:
// app.js draws the list in a sound effect's Inspector and previews a few picks (sound-shots.js plays them).

export const LIST_KEYS = ['FXSound', ...Array.from({ length: 7 }, (_, i) => `FXSounds(${i})`)];
export const PART_KEYS = ['FXOrder', 'RandomPitch', 'RandomVolume', 'RepeatMin', 'RepeatMax'];
export const ORDERS = [[0, 'Random', 'A different one each time: never the same one twice in a row'],
  [1, 'In sequence', 'One after the other, then from the first again']];
// the most each slider gives: the pitch up to half again or half as high, the volume from silent to twice as loud
export const MOST = { RandomPitch: 0.5, RandomVolume: 1 };
export const PREVIEW_PICKS = 4;            // a Preview plays this many
export const PREVIEW_GAP = 0.4;            // seconds between two when it does not repeat by itself (as if triggered again)

// The list's 8 places (names, '' for an empty one) after a change, its sounds packed from the first place: a sound
// added (in the first empty place, null when it is full), the sound i of the list taken away, one moved from its
// place in the list to another
export function listWith(names, name) {
  const at = names.findIndex((n) => !n);
  if (at < 0) return null;
  const out = names.slice();
  out[at] = name;
  return out;
}
export function listWithout(names, i) { return packed(names.filter(Boolean).filter((_, j) => j !== i)); }
export function listMoved(names, from, to) {
  const list = names.filter(Boolean), [it] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, to)), 0, it);
  return packed(list);
}
const packed = (list) => LIST_KEYS.map((_, i) => list[i] || '');
// the keys a change gives a new value, with their UnrealEd text: [[key, text]]
export function listChanges(before, after) {
  return LIST_KEYS.flatMap((key, i) => ((before[i] || '') === (after[i] || '') ? [] : [[key, after[i] ? `Sound'${after[i]}'` : 'None']]));
}

// The place in the list of the next one of n sounds after the last (-1: none yet), as UCSoundFX.PickSound: in sequence
// (order 1) the next, else one at random that is not the last. rand(): the game's FRand, from 0 to below 1
export function nextPick(n, last, order, rand) {
  if (n <= 0) return -1;
  if (order === 1) return last + 1 < n ? last + 1 : 0;
  if (n === 1 || last < 0 || last >= n) return Math.floor(rand() * n);
  const k = Math.floor(rand() * (n - 1));
  return k >= last ? k + 1 : k;
}
// a volume or a pitch varied by up to spread of it either way (UCSoundFX.Varied); no spread: as it is
export function varied(x, spread, rand) { return spread > 0 ? x * (1 + Math.min(1, spread) * (2 * rand() - 1)) : x; }
// the wait before it plays again (UCSoundFX.NextWait): from the smaller of min and max to max seconds; 0: it does not
export function nextWait(min, max, rand) {
  if (!(max > 0)) return 0;
  const lo = Math.max(0, Math.min(+min || 0, max));
  return lo + (max - lo) * rand();
}

// A few plays of a sound effect as the game makes them: [{sound, volume, pitch, wait}] (wait: when it repeats by itself,
// the seconds before the next). fx: {sounds (the list without its empty places), order, volume, pitch, randomVolume,
// randomPitch, repeatMin, repeatMax}
export function previewPicks(fx, count = PREVIEW_PICKS, rand = Math.random) {
  const out = [];
  let last = -1;
  for (let i = 0; i < count && fx.sounds.length; i++) {
    last = nextPick(fx.sounds.length, last, fx.order, rand);
    out.push({ sound: fx.sounds[last], volume: varied(fx.volume, fx.randomVolume, rand), pitch: varied(fx.pitch, fx.randomPitch, rand),
      wait: nextWait(fx.repeatMin, fx.repeatMax, rand) });
  }
  return out;
}
// When each of them starts (seconds from the first): after the wait the one before drew, else when the one before has
// ended and PREVIEW_GAP more (as if triggered again). seconds(name): how long a sound lasts as recorded (its pitch plays
// it faster or slower)
export function timesOf(picks, seconds) {
  let at = 0;
  return picks.map((p, i) => {
    if (i) { const q = picks[i - 1]; at += q.wait > 0 ? q.wait : seconds(q.sound) / Math.max(0.05, q.pitch) + PREVIEW_GAP; }
    return at;
  });
}
