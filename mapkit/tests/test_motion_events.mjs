// The timed events of an object's animation (static/motion-events.js), as UCMotion fires them in the game: when its
// clock passes their time, in every pass of a loop and both ways of Back and forth, once per pass (at a turn the pass
// that reaches it plays it), an event right at the start of a run the clock was put at, and in the order met.
import test from 'node:test';
import assert from 'node:assert/strict';
import { passed, playStep, eventTime, eventText, MAX_EVENTS } from '../editor/static/motion-events.js';

// a played animation, frame by frame as UCMotion.Tick runs it: every event fired, with the pass it fired in
function run(len, mode, times, { dt = 0.1, frames = 100, t = 0, dir = 1, moved = false } = {}) {
  let clock = { t, dir, moved }, pass = 0;
  const out = [];
  for (let f = 0; f < frames; f++) {
    const next = playStep(clock, dt, len, mode, times);
    const wrapped = mode === 'loop' && (clock.dir > 0 ? next.t < clock.t : next.t > clock.t);
    for (const i of next.fired) out.push([pass + (wrapped && times[i] === (clock.dir > 0 ? 0 : len) ? 1 : 0), i]);
    if (next.dir !== clock.dir || wrapped) pass++;             // a new pass: turned back, or a loop from its start
    clock = next;
    if (!next.playing) break;
  }
  return { out, clock };
}
const firedIn = (out, pass) => out.filter(([p]) => p === pass).map(([, i]) => i);

test('passed: an event at the end of a step is passed, one at its start only where the clock was put', () => {
  const times = [0, 0.5, 1];
  assert.deepEqual(passed(times, 0, 0.5, false), [0, 1]);
  assert.deepEqual(passed(times, 0, 0.5, true), [1]);
  assert.deepEqual(passed(times, 0.5, 1, true), [2]);
  assert.deepEqual(passed(times, 1, 0.25, true), [1]);                    // backwards: met from the end
  assert.deepEqual(passed(times, 1, 0, false), [2, 1, 0]);
  assert.deepEqual(passed(times, 0.3, 0.3, false), []);                   // no move: nothing
});

test('passed: several in one frame come in the order the clock meets them, either way', () => {
  const times = [0.6, 0.2, 0.4];                                            // (not in order)
  assert.deepEqual(passed(times, 0, 1, true), [1, 2, 0]);
  assert.deepEqual(passed(times, 1, 0, true), [0, 2, 1]);
});

test('once: every event once, the one at the start and the one at the end too', () => {
  const { out, clock } = run(1, 'once', [0, 0.35, 1]);
  assert.deepEqual(out.map(([, i]) => i), [0, 1, 2]);
  assert.equal(clock.playing, false);
  assert.equal(clock.t, 1);
});

test('loop: every pass plays all of them, its start and its end each once', () => {
  const { out } = run(1, 'loop', [0, 0.5, 1], { dt: 0.1, frames: 31 });
  const all = out.map(([, i]) => i);
  assert.deepEqual(all.slice(0, 9), [0, 1, 2, 0, 1, 2, 0, 1, 2]);
  for (let pass = 0; pass < 3; pass++) assert.deepEqual(firedIn(out, pass), [0, 1, 2], `pass ${pass}`);
});

test('loop played backwards: from its end, every pass, in the order met', () => {
  const { out } = run(1, 'loop', [0.25, 0.75], { t: 1, dir: -1, frames: 25 });
  assert.deepEqual(out.map(([, i]) => i).slice(0, 4), [1, 0, 1, 0]);
});

test('back and forth: both ways, and the turn plays once (not again as the next pass starts there)', () => {
  const { out } = run(1, 'pingpong', [0, 0.5, 1], { dt: 0.1, frames: 44 });
  const seq = out.map(([, i]) => i);
  // forward 0, 0.5, 1; back 0.5, 0; forward 0.5, 1; back 0.5, 0
  assert.deepEqual(seq.slice(0, 9), [0, 1, 2, 1, 0, 1, 2, 1, 0]);
  for (let k = 1; k < seq.length; k++) assert.notEqual(seq[k], seq[k - 1], 'never the same one twice in a row');
});

test('a frame longer than the animation: the loop still plays this pass to its end, then the next from its start', () => {
  const step = playStep({ t: 0.9, dir: 1, moved: true }, 0.3, 1, 'loop', [0, 0.1, 0.95]);
  assert.deepEqual(step.fired, [2, 0, 1]);
  assert.ok(Math.abs(step.t - 0.2) < 1e-9);
});

test('a play resumed where it stopped does not play the event there again; one put there does', () => {
  const stopped = playStep({ t: 0.4, dir: 1, moved: true }, 0.1, 1, 'once', [0.4, 0.45]);
  assert.deepEqual(stopped.fired, [1]);
  const put = playStep({ t: 0.4, dir: 1, moved: false }, 0.1, 1, 'once', [0.4, 0.45]);
  assert.deepEqual(put.fired, [0, 1]);
});

test('played backwards from the end it just reached: the end is not played again', () => {
  const { out, clock } = run(1, 'once', [0.2, 1]);
  assert.deepEqual(out.map(([, i]) => i), [0, 1]);
  const back = run(1, 'once', [0.2, 1], { t: clock.t, dir: -1, moved: clock.moved });
  assert.deepEqual(back.out.map(([, i]) => i), [0]);
});

test('an event after the last key happens at the end; its words', () => {
  assert.equal(eventTime({ t: 7 }, 2), 2);
  assert.equal(eventTime({ t: -1 }, 2), 0);
  assert.equal(eventTime({ t: 'x' }, 2), 0);
  assert.equal(eventText({ kind: 'sound', sound: 'Ambient.Machinery.Clank2' }), 'Sound Clank2');
  assert.equal(eventText({ kind: 'event', tag: 'Alarm' }), 'Event Alarm');
  assert.equal(eventText({ kind: 'event', tag: '' }), 'Event (no Tag yet)');
  assert.equal(MAX_EVENTS, 16);
});
