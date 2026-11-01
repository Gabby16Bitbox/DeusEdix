// One cache of the editor's decoded sounds for all its players: Hear the map (scene-audio.js), a sound effect's Preview
// and an animation's sound events (app.js's shots, sound-shots.js) and a cutscene's voices (cutscene.js's). A sound's
// data is loaded once (load(name): an ArrayBuffer, the file the browser gets for a preview) and decoded once, by the
// audio context of the player that asks first (a decoded sound plays in any context); the `keep` last used are kept.
// A sound that could not be read or decoded is asked again the next time (a player that says so only once keeps its
// own list). No page here: node's tests give stand-ins.
export const KEEP = 48;

export function createSoundCache({ load, keep = KEEP }) {
  const asked = new Map(), ready = new Map();       // name -> the promise of its decoded sound; name -> the sound decoded
  const used = (name, buffer) => { asked.delete(name); asked.set(name, buffer); };      // the last used at the end
  // a sound decoded (context(): the audio context that decodes it, made only when one must be), asked once, also while it
  // loads; the oldest beyond `keep` forgotten
  function decoded(name, context) {
    let buffer = asked.get(name);
    if (!buffer) {
      buffer = Promise.resolve().then(() => load(name)).then((data) => context().decodeAudioData(data));
      const mine = buffer;
      buffer.then((b) => { if (asked.get(name) === mine) ready.set(name, b); }, () => { if (asked.get(name) === mine) asked.delete(name); });
    }
    used(name, buffer);
    while (asked.size > keep) {
      const old = asked.keys().next().value;
      asked.delete(old);
      ready.delete(old);
    }
    return buffer;
  }
  // a sound decoded already (its AudioBuffer, kept as the last used), else undefined: for a player that plays every frame
  function readyOf(name) {
    const buffer = ready.get(name);
    if (buffer) used(name, asked.get(name));
    return buffer;
  }
  return { decoded, ready: readyOf };
}
