import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleCurve, upsertKey, moveKeys, deleteKeys, duplicateKeys, continuousAngle } from '../editor/static/studio-curves.js';

const key = (f, v, mode = 'smooth') => ({ f, v, mode });
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message || 'value'}: ${actual} != ${expected}`);
const freeze = (keys) => Object.freeze(keys.map((k) => Object.freeze({ ...k })));

test('linear, constant and hold curves retain exact keys and held endpoints', () => {
  const linear = [key(2, 10, 'linear'), key(10, 30, 'hold'), key(14, -4)];
  near(sampleCurve(linear, 6), 20);
  assert.equal(sampleCurve(linear, 13.999), 30);
  assert.equal(sampleCurve(linear, 14), -4);
  assert.equal(sampleCurve(linear, -20), 10);
  assert.equal(sampleCurve(linear, 200), -4);
  for (const k of linear) assert.equal(sampleCurve(linear, k.f), k.v);
  for (let f = -1; f <= 20; f += 0.125) assert.equal(sampleCurve([key(0, 7), key(5, 7), key(15, 7)], f), 7);
  assert.equal(sampleCurve([key(4, 12)], 500), 12);
});

test('smooth endpoints ease into a two-key movement', () => {
  const keys = [key(0, 0), key(8, 8)];
  near(sampleCurve(keys, 2), 1.25);
  near(sampleCurve(keys, 4), 4);
  near(sampleCurve(keys, 6), 6.75);
});

test('smooth nonuniform spacing stays monotone between keys without overshoot', () => {
  for (const values of [[0, 20, 21, 80], [80, 21, 20, 0]]) {
    const keys = [key(0, values[0]), key(1, values[1]), key(24, values[2]), key(26, values[3])];
    for (let i = 0; i < keys.length - 1; i++) {
      let previous = keys[i].v;
      for (let step = 1; step <= 100; step++) {
        const value = sampleCurve(keys, keys[i].f + (keys[i + 1].f - keys[i].f) * step / 100);
        assert.ok(value >= Math.min(keys[i].v, keys[i + 1].v) - 1e-10);
        assert.ok(value <= Math.max(keys[i].v, keys[i + 1].v) + 1e-10);
        assert.ok(values[3] > values[0] ? value >= previous - 1e-10 : value <= previous + 1e-10);
        previous = value;
      }
    }
  }
});

test('local extrema have continuous flat tangents and do not overshoot', () => {
  const keys = [key(0, 0), key(3, 9), key(11, -3), key(15, 0)];
  for (const f of [3, 11]) {
    const v = sampleCurve(keys, f), dt = 1e-4;
    assert.ok(Math.abs((v - sampleCurve(keys, f - dt)) / dt) < 0.002);
    assert.ok(Math.abs((sampleCurve(keys, f + dt) - v) / dt) < 0.002);
  }
  for (let f = 0; f <= 15; f += 0.025) assert.ok(sampleCurve(keys, f) >= -3 && sampleCurve(keys, f) <= 9);
});

test('loop seam evaluates before the first key, including negative/multiple cycles', () => {
  const keys = [key(2, 0, 'linear'), key(6, 8, 'linear')], options = { loop: true, frames: 10 };
  near(sampleCurve(keys, 8, options), 16 / 3);
  near(sampleCurve(keys, 0, options), 8 / 3);
  near(sampleCurve(keys, 1, options), 4 / 3);
  assert.equal(sampleCurve(keys, 2, options), 0);
  assert.equal(sampleCurve(keys, 6, options), 8);
  for (const f of [-13, -1, 0, 1, 9, 12, 24.5]) near(sampleCurve(keys, f, options), sampleCurve(keys, f + 30, options));
  const held = [key(2, 0, 'linear'), key(6, 8, 'hold')];
  assert.equal(sampleCurve(held, 1.99, options), 8);
  assert.equal(sampleCurve(held, 2, options), 0);
});

test('smooth loop is continuous at frame zero with no seam overshoot', () => {
  const keys = [key(2, 0), key(6, 8), key(8, 3)], options = { loop: true, frames: 12 };
  near(sampleCurve(keys, -1e-8, options), sampleCurve(keys, 12 - 1e-8, options));
  const left = (sampleCurve(keys, 0, options) - sampleCurve(keys, -1e-5, options)) / 1e-5;
  const right = (sampleCurve(keys, 1e-5, options) - sampleCurve(keys, 0, options)) / 1e-5;
  assert.ok(Math.abs(left - right) < 1e-4);
  for (let f = 0; f < 12; f += 0.025) assert.ok(sampleCurve(keys, f, options) >= 0 && sampleCurve(keys, f, options) <= 8);
});

test('upsert and delete are immutable and preserve interpolation', () => {
  const keys = freeze([key(0, 1, 'hold'), key(5, 2, 'linear')]);
  assert.deepEqual(upsertKey([], key(2, 3)), [key(2, 3)]);
  assert.deepEqual(upsertKey(keys, { f: 5, v: 9 }), [key(0, 1, 'hold'), key(5, 9, 'linear')]);
  const added = upsertKey(keys, key(3, 7));
  assert.deepEqual(added.map((k) => k.f), [0, 3, 5]);
  added[0].v = 100;
  assert.equal(keys[0].v, 1);
  assert.deepEqual(deleteKeys(keys, [0]), [key(5, 2, 'linear')]);
  assert.throws(() => deleteKeys(keys, [0, 5]), /at least one key/);
  assert.throws(() => deleteKeys(keys, [4]), /no curve key/);
});

test('multi-key moves snap together, preserve values/modes and reject collisions atomically', () => {
  const keys = freeze([key(0, 1, 'hold'), key(3, 2, 'linear'), key(8, 4)]);
  const moved = moveKeys(keys, new Set([0, 3]), 1.6, -0.5, 12);
  assert.deepEqual(moved, [key(2, 0.5, 'hold'), key(5, 1.5, 'linear'), key(8, 4)]);
  assert.throws(() => moveKeys(keys, [0, 3], 5, 100, 12), /occupy frame/);
  assert.throws(() => moveKeys(keys, [0], -1, 0, 12), /non-negative/);
  assert.throws(() => moveKeys(keys, [8], 4, 0, 12), /within frames/);
  assert.deepEqual(keys, [key(0, 1, 'hold'), key(3, 2, 'linear'), key(8, 4)]);
});

test('duplicating a selection preserves spacing and never overwrites any original', () => {
  const keys = freeze([key(0, 1, 'hold'), key(3, 2, 'linear'), key(8, 4)]);
  assert.deepEqual(duplicateKeys(keys, [0, 3], 4.1, 12), [key(0, 1, 'hold'), key(3, 2, 'linear'), key(4, 1, 'hold'), key(7, 2, 'linear'), key(8, 4)]);
  assert.throws(() => duplicateKeys(keys, [0, 3], 5, 12), /occupy frame/);
  assert.throws(() => duplicateKeys(keys, [0, 3], 0, 12), /occupy frame/);
  assert.throws(() => duplicateKeys(keys, [0, 3], 10, 12), /within frames/);
  assert.deepEqual(keys, [key(0, 1, 'hold'), key(3, 2, 'linear'), key(8, 4)]);
});

test('invalid numbers, duplicate keys, interpolation and durations fail descriptively', () => {
  for (const bad of [NaN, Infinity, -Infinity, '2']) {
    assert.throws(() => sampleCurve([key(0, 0)], bad), /finite number/);
    assert.throws(() => sampleCurve([key(0, bad)], 0), /finite number/);
    assert.throws(() => upsertKey([], key(bad, 0)), /finite number/);
    assert.throws(() => moveKeys([key(0, 0)], [0], 0, bad, 5), /finite number/);
    assert.throws(() => continuousAngle(bad, 0), /finite number/);
  }
  assert.throws(() => sampleCurve([], 0), /at least one key/);
  assert.throws(() => sampleCurve([key(0, 0), key(0, 1)], 0), /occupy frame/);
  assert.throws(() => sampleCurve([key(0.5, 0)], 0), /integer/);
  assert.throws(() => sampleCurve([key(0, 0, 'magic')], 0), /Interpolation/);
  assert.throws(() => sampleCurve([key(5, 0)], 0, { loop: true, frames: 5 }), /within frames/);
  assert.throws(() => sampleCurve([key(0, 0)], 0, { loop: true, frames: 0 }), /at least one frame/);
  assert.throws(() => moveKeys([key(0, 0)], [], 1, 0, 5), /Select at least one/);
  assert.throws(() => moveKeys([key(0, 0)], [2], 1, 0, 5), /no curve key/);
});

test('degree unwrapping chooses the equivalent angle nearest the previous value', () => {
  assert.equal(continuousAngle(-170, 170), 190);
  assert.equal(continuousAngle(170, -170), -190);
  assert.equal(continuousAngle(10, 350), 370);
  assert.equal(continuousAngle(-180, 180), 180);
  assert.equal(continuousAngle(10, 1090), 1090);
  assert.throws(() => continuousAngle(0, NaN), /finite number/);
});
