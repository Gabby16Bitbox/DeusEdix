// The previews' one-shot player (static/sound-shots.js) on a stand-in audio context: each sound once at its time,
// volume and pitch; decoded once; a new preview ends the last one, an event sound plays alongside; stop ends all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShots } from '../editor/static/sound-shots.js';

const param = (value = 0) => ({ value });
function rig() {
  const log = { loads: [], decoded: [], started: [], stopped: [], contexts: 0 };
  class Context {
    constructor() { log.contexts++; this.state = 'running'; this.currentTime = 10; this.destination = {}; }
    createGain() { return { gain: param(1), connect() {}, disconnect() {} }; }
    createBufferSource() {
      const src = { playbackRate: param(1), connect() {}, disconnect() {},
        start(at, from = 0) { log.started.push({ name: src.buffer.name, at, from, pitch: src.playbackRate.value }); },
        stop() { log.stopped.push(src.buffer.name); } };
      return src;
    }
    decodeAudioData(data) { log.decoded.push(data.name); return Promise.resolve({ name: data.name, duration: 1.5 }); }
  }
  const shots = createShots({ Context, load: async (name) => { log.loads.push(name); return { name }; } });
  return { shots, log };
}

test('each one once, at its time from now, at its pitch; their sounds decoded once', async () => {
  const { shots, log } = rig();
  assert.equal(await shots.play([{ sound: 'A.Dog1', at: 0, pitch: 1.2, volume: 0.5 }, { sound: 'A.Dog1', at: 2 }, { sound: 'A.Dog2', at: 3.5 }]), true);
  assert.deepEqual(log.started.map((s) => [s.name, Math.round((s.at - 10) * 100) / 100, s.pitch]),
    [['A.Dog1', 0.05, 1.2], ['A.Dog1', 2.05, 1], ['A.Dog2', 3.55, 1]]);
  assert.deepEqual(log.decoded, ['A.Dog1', 'A.Dog2']);
  assert.equal(log.contexts, 1);
  assert.equal(shots.playing, true);
});

test('lengths: how long each sound lasts, read once', async () => {
  const { shots, log } = rig();
  assert.deepEqual(await shots.lengths(['A.Dog1', 'A.Dog1', 'A.Dog2']), { 'A.Dog1': 1.5, 'A.Dog2': 1.5 });
  await shots.play([{ sound: 'A.Dog2' }]);
  assert.deepEqual(log.loads, ['A.Dog1', 'A.Dog2']);
});

test('a new preview ends the last one; an event sound plays alongside it; stop ends everything', async () => {
  const { shots, log } = rig();
  await shots.play([{ sound: 'A.Dog1' }, { sound: 'A.Dog2', at: 1 }]);
  await shots.play([{ sound: 'A.Siren' }]);
  assert.deepEqual(log.stopped, ['A.Dog1', 'A.Dog2']);
  await shots.play([{ sound: 'A.Clank' }], false);
  assert.deepEqual(log.stopped, ['A.Dog1', 'A.Dog2']);
  shots.stop();
  assert.deepEqual(log.stopped.slice(2).sort(), ['A.Clank', 'A.Siren']);
  assert.equal(shots.playing, false);
});

test('a voice from some seconds into it (a cutscene played from its middle); the decoded sound, for its waveform', async () => {
  const { shots, log } = rig();
  await shots.play([{ sound: 'V.Line1', from: 1.25 }, { sound: 'V.Line2', from: -3 }], false);
  assert.deepEqual(log.started.map((s) => [s.name, s.from]), [['V.Line1', 1.25], ['V.Line2', 0]]);
  assert.deepEqual(await shots.decoded('V.Line1'), { name: 'V.Line1', duration: 1.5 });
  assert.deepEqual(log.decoded, ['V.Line1', 'V.Line2'], 'decoded once');
});

test('stopped while its sounds load: none of it plays', async () => {
  const { shots, log } = rig();
  const going = shots.play([{ sound: 'A.Dog1' }]);
  shots.stop();
  assert.equal(await going, false);
  assert.deepEqual(log.started, []);
});
