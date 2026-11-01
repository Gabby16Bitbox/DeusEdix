// One cache of decoded sounds for the editor's players (static/sound-cache.js): Hear the map (scene-audio.js) and the
// previews (sound-shots.js) given the same cache load and decode a sound once, whoever asks first; the last used are
// kept, the oldest asked again; one that failed is asked again; a voice keeps playing the sound it has when the cache
// has let it go.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoundCache } from '../editor/static/sound-cache.js';
import { createSceneAudio } from '../editor/static/scene-audio.js';
import { createShots } from '../editor/static/sound-shots.js';

const param = (value = 0) => ({ value, setTargetAtTime(v) { this.value = v; } });
const node = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra });
// a stand-in AudioContext for both players
function contextClass(log) {
  return class {
    constructor() {
      this.state = 'running'; this.currentTime = 0; this.destination = node(); log.contexts++;
      this.listener = { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(),
        upX: param(), upY: param(), upZ: param() };
    }
    createGain() { return node({ gain: param(1) }); }
    createPanner() { return node({ positionX: param(), positionY: param(), positionZ: param() }); }
    createBufferSource() {
      const src = node({ playbackRate: param(1), start() { log.started.push(src.buffer.name); }, stop() {} });
      return src;
    }
    decodeAudioData(data) { log.decoded.push(data.name); return Promise.resolve({ name: data.name, duration: 2 }); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  };
}
function rig(keep) {
  const log = { contexts: 0, loads: [], decoded: [], started: [] };
  const cache = createSoundCache({ load: async (name) => { log.loads.push(name); if (/Bad/.test(name) && !log.fixed) throw new Error('no file'); return { name }; }, keep });
  return { log, cache, Context: contextClass(log) };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const LISTENER = { at: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] };

test('Hear the map and the previews given one cache: a sound loaded and decoded once, whoever asks first', async () => {
  const { log, cache, Context } = rig();
  const audio = createSceneAudio({ Context, cache, on: true });
  const shots = createShots({ Context, cache });
  audio.unlock();
  const hum = [{ id: 'Radio2', at: [10, 0, 0], sound: 'A.Hum', radius: 1000, volume: 0.7, pitch: 1 }];
  for (let i = 0; i < 3; i++) { audio.update(LISTENER, hum); await settle(); }
  assert.equal(audio.playing, 1);
  assert.equal(await shots.play([{ sound: 'A.Hum' }, { sound: 'A.Dog' }]), true);
  assert.equal((await shots.decoded('A.Dog')).name, 'A.Dog');
  assert.deepEqual(log.loads, ['A.Hum', 'A.Dog']);
  assert.deepEqual(log.decoded, ['A.Hum', 'A.Dog']);
  assert.equal(cache.ready('A.Dog').name, 'A.Dog');
});

test('the last used kept, the oldest asked again; a sound that failed asked again', async () => {
  const { log, cache } = rig(2);
  const ctx = () => ({ decodeAudioData: async (data) => ({ name: data.name }) });
  for (const name of ['A', 'B', 'C']) await cache.decoded(name, ctx);
  assert.equal(cache.ready('A'), undefined);
  assert.equal(cache.ready('C').name, 'C');
  await cache.decoded('A', ctx);
  assert.deepEqual(log.loads, ['A', 'B', 'C', 'A']);
  await assert.rejects(cache.decoded('Bad', ctx), /no file/);
  log.fixed = true;
  assert.equal((await cache.decoded('Bad', ctx)).name, 'Bad');
  assert.deepEqual(log.loads.slice(-2), ['Bad', 'Bad']);
});

test('a sound the cache let go keeps playing in Hear the map, not read again', async () => {
  const { log, cache, Context } = rig(1);
  const audio = createSceneAudio({ Context, cache, on: true });
  audio.unlock();
  const hum = [{ id: 'Radio2', at: [10, 0, 0], sound: 'A.Hum', radius: 1000, volume: 0.7, pitch: 1 }];
  for (let i = 0; i < 3; i++) { audio.update(LISTENER, hum); await settle(); }
  await cache.decoded('A.Other', () => new Context());       // another player's sound: A.Hum let go
  assert.equal(cache.ready('A.Hum'), undefined);
  audio.update(LISTENER, hum); await settle();
  assert.equal(audio.playing, 1);
  assert.deepEqual(log.started, ['A.Hum']);                  // still the voice it started
  assert.deepEqual(log.loads, ['A.Hum', 'A.Other']);
});
