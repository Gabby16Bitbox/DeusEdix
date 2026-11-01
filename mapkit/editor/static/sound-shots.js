// Sounds the editor's previews play once each: a sound effect's playlist (its Preview: a few picks as the game makes
// them), the sound events of an object's animation (its preview plays them as the playhead passes them) and a
// cutscene's voices (cutscene.js: from where its playhead is). Each at its volume (1 = as recorded, more is louder) and
// pitch (as the game's: 2 is an octave higher and twice as fast), at its time from now, from its start or some seconds
// into it. The sounds come decoded from the editor's one cache (cache: sound-cache.js, shared with its other players;
// given load(name) alone, a cache of its own); decoded(name) gives one, for a waveform. No page: the audio context's
// class is given (Context), as scene-audio.js; node's tests give a stand-in.
import { createSoundCache } from './sound-cache.js';

const LEAD = 0.05;             // seconds from now the first one starts (scheduled ahead: none starts late)

export function createShots({ Context, cache = null, load }) {
  let ctx = null, serial = 0;
  const playing = new Set(), sounds = cache || createSoundCache({ load });
  const context = () => (ctx ||= new Context());
  // a sound decoded (sound-cache.js: asked once, also while it loads; one that failed is asked again)
  const decoded = (name) => sounds.decoded(name, context);
  // how long each of these sounds lasts as recorded (seconds), {name: seconds}: decoded first
  async function lengths(names) {
    const out = {};
    for (const name of new Set(names)) out[name] = (await decoded(name)).duration;
    return out;
  }
  function end() {
    for (const src of playing) try { src.stop(); } catch { /* never started */ }
    playing.clear();
  }
  // Plays [{sound, at (seconds from now), from (seconds into it), volume, pitch}]; alone: what an earlier call still
  // plays ends (a later call, or stop, while its sounds load: none of it plays). False when it did not play
  async function play(shots, alone = true) {
    const mine = alone ? ++serial : serial;
    if (alone) end();
    const sounds = await Promise.all(shots.map((s) => decoded(s.sound)));
    if (mine !== serial) return false;
    const c = context();
    if (c.state === 'suspended') await c.resume?.();
    const start = c.currentTime + LEAD;
    shots.forEach((s, i) => {
      const src = c.createBufferSource(), gain = c.createGain();
      src.buffer = sounds[i];
      src.playbackRate.value = Math.max(0.05, s.pitch ?? 1);
      gain.gain.value = Math.max(0, s.volume ?? 1);
      src.connect(gain);
      gain.connect(c.destination);
      src.onended = () => { playing.delete(src); gain.disconnect(); };
      src.start(start + Math.max(0, s.at || 0), Math.max(0, s.from || 0));
      playing.add(src);
    });
    return true;
  }
  function stop() { serial++; end(); }
  return { play, stop, lengths, decoded, get playing() { return playing.size > 0; } };
}
