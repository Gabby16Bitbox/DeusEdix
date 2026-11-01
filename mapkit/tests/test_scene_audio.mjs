// Hear the map's player (static/scene-audio.js) on a stand-in audio context: nothing before it is on and the page may
// play, the 16 nearest looped at their gain, pitch and place, the sounds read one at a time (nearest first) and once,
// one that cannot be read said once, Play and a hidden tab silencing it, the map closed ending it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSceneAudio } from '../editor/static/scene-audio.js';

// an audio parameter: the value it glides to
const param = (value = 0) => ({ value, setTargetAtTime(v) { this.value = v; } });
const node = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra });
// a stand-in AudioContext (state: as the browser leaves a new one; ready: its first resume works)
function contextClass(log, { state = 'running' } = {}) {
  return class {
    constructor() {
      this.state = state; this.currentTime = 0; this.destination = node(); log.contexts.push(this);
      this.listener = { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(),
        upX: param(), upY: param(), upZ: param() };
    }
    createGain() { const g = node({ gain: param(1) }); log.gains.push(g); return g; }
    createPanner() { const p = node({ positionX: param(), positionY: param(), positionZ: param() }); log.panners.push(p); return p; }
    createBufferSource() {
      const src = node({ playbackRate: param(1), start() { log.started.push(src.buffer.name); }, stop() { log.stopped.push(src.buffer.name); } });
      log.sources.push(src);
      return src;
    }
    decodeAudioData(data) { log.decoded.push(data.name); return Promise.resolve({ name: data.name, duration: 2 }); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  };
}
function rig(options = {}) {
  const log = { contexts: [], started: [], stopped: [], decoded: [], loads: [], errors: [], gains: [], panners: [], sources: [] };
  const audio = createSceneAudio({ Context: contextClass(log, options), on: options.on,
    load: async (name) => { log.loads.push(name); if (name === 'Bad.Sound') throw new Error('no file'); return { name }; },
    canLoad: () => !options.busy?.(), onError: (name, e) => log.errors.push(`${name}: ${e.message}`) });
  return { audio, log };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('each audio parameter is read by its own name, never by one built from strings', () => {
  const text = fs.readFileSync(new URL('../editor/static/scene-audio.js', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /\[\s*[\w.]+\s*\+\s*['"`]/);
});
const LISTENER = { at: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] };
const source = (id, x, sound = 'A.Hum', extra = {}) => ({ id, at: [x, 0, 0], sound, radius: 1000, volume: 0.7, pitch: 1, ...extra });
// the sounds' data read one by one: as many updates as it takes
async function heard(audio, sources, rounds = 4) { for (let i = 0; i < rounds; i++) { audio.update(LISTENER, sources); await settle(); } audio.update(LISTENER, sources); }

test('off at first: no audio context, nothing read, nothing played', async () => {
  const { audio, log } = rig();
  await heard(audio, [source('S1', 10)]);
  assert.equal(log.contexts.length, 0);
  assert.deepEqual(log.loads, []);
  assert.equal(audio.playing, 0);
});

test('on from the start (kept from the last time): it waits for the page\'s first click or key', async () => {
  const { audio, log } = rig({ on: true, state: 'suspended' });
  await heard(audio, [source('S1', 10)]);
  assert.equal(log.contexts.length, 0);                    // no context made without a gesture
  audio.unlock();                                          // the first click
  assert.equal(log.contexts.length, 1);
  await heard(audio, [source('S1', 10)]);
  assert.equal(audio.playing, 1);
});

test('the 16 nearest play, each at its gain, pitch and place; a sound read once and decoded once', async () => {
  const { audio, log } = rig();
  audio.setOn(true);
  const sources = Array.from({ length: 20 }, (_, i) => source('S' + i, 40 * (i + 1), i % 2 ? 'A.Hum' : 'B.Rain', { pitch: 1.5 }));
  await heard(audio, sources);
  assert.equal(audio.playing, 16);
  assert.deepEqual(log.loads, ['B.Rain', 'A.Hum']);       // the nearest's first, one at a time
  assert.deepEqual(log.decoded, ['B.Rain', 'A.Hum']);
  assert.equal(log.started.length, 16);
  // a voice: its gain the source's volume x falloff, its rate the pitch, its panner where it is (the first one: S0,
  // B.Rain, 40 units away; the context's own gain first); the listener the camera
  const ctx = log.contexts[0], at = log.sources.findIndex((s) => s.buffer.name === 'B.Rain');
  assert.equal(ctx.listener.forwardZ.value, -1);
  assert.ok(Math.abs(log.gains[at + 1].gain.value - 0.7 * (1 - 40 / 1000)) < 1e-9);
  assert.equal(log.sources[at].playbackRate.value, 1.5);
  assert.equal(log.sources[at].loop, true);
  assert.equal(log.panners[at].positionX.value, 40);
  assert.equal(log.panners[at].rolloffFactor, 0);           // the distance is the gain's only
  audio.update({ ...LISTENER, at: [40, 0, 0] }, sources);   // the camera on S0: all of it
  assert.equal(log.gains[at + 1].gain.value, 0.7);
  assert.equal(ctx.listener.positionX.value, 40);
  assert.equal(audio.playing, 16);
});

test('a sound out of reach stops; another sound on the same object starts again', async () => {
  const { audio, log } = rig();
  audio.setOn(true);
  await heard(audio, [source('S1', 10), source('S2', 20)]);
  assert.equal(audio.playing, 2);
  await heard(audio, [source('S1', 10), source('S2', 5000)]);
  assert.equal(audio.playing, 1);
  assert.deepEqual(log.stopped, ['A.Hum']);
  await heard(audio, [source('S1', 10, 'C.Wind')]);
  assert.equal(audio.playing, 1);
  assert.deepEqual(log.started, ['A.Hum', 'A.Hum', 'C.Wind']);
});

test('a sound that cannot be read is said once and left out; nothing is read while the server is busy', async () => {
  let busy = true;
  const { audio, log } = rig({ busy: () => busy });
  audio.setOn(true);
  await heard(audio, [source('S1', 10, 'Bad.Sound'), source('S2', 20)]);
  assert.deepEqual(log.loads, []);                         // a Rebuild: not asked for
  busy = false;
  await heard(audio, [source('S1', 10, 'Bad.Sound'), source('S2', 20)]);
  await heard(audio, [source('S1', 10, 'Bad.Sound'), source('S2', 20)]);
  assert.deepEqual(log.errors, ['Bad.Sound: no file']);
  assert.deepEqual(log.loads, ['Bad.Sound', 'A.Hum']);
  assert.equal(audio.playing, 1);
});

test('Play or a hidden tab silences it until they end; off and the map closed end what plays', async () => {
  const { audio, log } = rig();
  audio.setOn(true);
  const sources = [source('S1', 10)];
  await heard(audio, sources);
  audio.hold('play');
  assert.equal(audio.playing, 0);
  assert.equal(log.contexts[0].state, 'suspended');
  await heard(audio, sources);
  assert.equal(audio.playing, 0);
  audio.hold('hidden');
  audio.release('play');
  await heard(audio, sources);
  assert.equal(audio.playing, 0);                          // still hidden
  audio.release('hidden');
  await heard(audio, sources);
  assert.equal(audio.playing, 1);
  audio.stop();                                            // the map closed
  assert.equal(audio.playing, 0);
  await heard(audio, sources);
  audio.setOn(false);
  assert.equal(audio.playing, 0);
  await heard(audio, sources);
  assert.equal(audio.playing, 0);
});
