// Hear the map: the 3D view's speaker (Unity's Scene view audio). While it is on, the map's ambient sounds loop where
// they are, heard from the camera (ambient-sound.js says which and how loud): each one a voice, its sound looped at its
// pitch through its gain and a panner at its place that only gives the side it comes from (the distance is in the
// gain, as the game's falloff). The browser lets a page's audio start only after a click or a key: the audio starts
// with setOn(true) (the speaker pressed) or the first unlock() (the page's first click or key) after the editor opened
// with it on. hold(reason) silences it while Play runs or the tab is hidden, release(reason) lets it play again;
// stop() ends what plays (the map closed). The sounds come decoded from the editor's one cache (cache: sound-cache.js,
// shared with its other players; given load(name) alone, a cache of its own), asked one at a time, nearest first; a
// sound that cannot be read is said once (onError) and left out. No page here: the audio context's class is given
// (Context), node's tests give a stand-in.
import { heardAt, MAX_HEARD } from './ambient-sound.js';
import { createSoundCache } from './sound-cache.js';

const GLIDE = 0.05;            // seconds a gain, a pitch or a place takes to reach its new value (no clicks)

// listener: {at, forward, up} ([x, y, z] in the 3D view's axes: the panner's sides are the camera's); a source:
// {id, at, sound, radius, volume, pitch} (ambient-sound.js mapSources)
export function createSceneAudio({ Context, cache = null, load, canLoad = () => true, onError = () => {}, on = false, max = MAX_HEARD }) {
  let ctx = null, out = null, loading = '', waking = null;
  const held = new Set(), voices = new Map(), failed = new Set(), sounds = cache || createSoundCache({ load });

  function context() {
    if (!ctx) {
      ctx = new Context();
      out = ctx.createGain();
      out.connect(ctx.destination);
    }
    return ctx;
  }
  // an audio parameter to a value, gliding there (a parameter the browser lacks: its old setter, else nothing)
  const glide = (param, value) => param?.setTargetAtTime(value, ctx.currentTime, GLIDE);
  // a point given to the three audio parameters of its x, y and z (a browser without them: old(x, y, z), else nothing)
  function place([px, py, pz], [x, y, z], old) {
    if (px) { glide(px, x); glide(py, y); glide(pz, z); } else old?.(x, y, z);
  }
  function listen({ at, forward, up }) {
    const l = ctx.listener;
    place([l.positionX, l.positionY, l.positionZ], at, l.setPosition?.bind(l));
    if (l.forwardX) { place([l.forwardX, l.forwardY, l.forwardZ], forward); place([l.upX, l.upY, l.upZ], up); } else l.setOrientation?.(...forward, ...up);
  }
  function start(s, buffer) {
    const src = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createPanner();
    src.buffer = buffer;
    src.loop = true;
    pan.panningModel = 'equalpower';
    pan.distanceModel = 'linear';
    pan.rolloffFactor = 0;               // the side only: the distance is the gain's
    gain.gain.value = 0;                 // it comes in gliding
    src.connect(gain); gain.connect(pan); pan.connect(out);
    src.start();
    const v = { sound: s.sound, src, gain, pan };
    voices.set(s.id, v);
    return v;
  }
  function end(id) {
    const v = voices.get(id);
    voices.delete(id);
    try { v.src.stop(); } catch { /* never started */ }
    v.src.disconnect(); v.pan.disconnect();
  }
  function stop() { for (const id of [...voices.keys()]) end(id); }
  // a sound asked of the cache, unless one is on its way (the nearest first: update asks in that order), it failed
  // already or a Rebuild holds the server (canLoad)
  function want(name) {
    if (loading || failed.has(name) || !canLoad()) return;
    loading = name;
    sounds.decoded(name, context).catch((e) => { failed.add(name); onError(name, e); }).finally(() => { loading = ''; });
  }
  // a frame: the camera where it is, the nearest sounds heard playing at their gain, pitch and place, the others ended
  function update(listener, sources) {
    if (!on || held.size || !ctx) return;
    if (ctx.state === 'suspended') {
      if (!waking) waking = ctx.resume().catch(() => {}).finally(() => { waking = null; });
      return;
    }
    listen(listener);
    const playing = new Set();
    for (const s of heardAt(listener.at, sources, max)) {
      let v = voices.get(s.id);
      // decoded in the cache, else the one its voice plays (the cache may have let it go since)
      const buffer = sounds.ready(s.sound) || (v?.sound === s.sound ? v.src.buffer : undefined);
      if (!buffer) { want(s.sound); continue; }
      if (v && v.sound !== s.sound) { end(s.id); v = null; }
      v ||= start(s, buffer);
      glide(v.gain.gain, s.gain);
      glide(v.src.playbackRate, s.pitch);
      place([v.pan.positionX, v.pan.positionY, v.pan.positionZ], s.at, v.pan.setPosition?.bind(v.pan));
      playing.add(s.id);
    }
    for (const id of [...voices.keys()]) if (!playing.has(id)) end(id);
  }
  function setOn(value) {
    on = !!value;
    if (on) unlock();
    else { stop(); ctx?.suspend(); }
  }
  // a click or a key: the audio may start now
  function unlock() {
    if (!on || held.size) return;
    if (context().state === 'suspended') ctx.resume().catch(() => {});
  }
  function hold(reason) { held.add(reason); stop(); ctx?.suspend(); }
  function release(reason) { held.delete(reason); }
  return { update, setOn, unlock, hold, release, stop,
    get on() { return on; }, get playing() { return voices.size; }, get held() { return held.size > 0; } };
}
