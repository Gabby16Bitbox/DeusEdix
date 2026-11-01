import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waveformEnvelope, waveformPath } from '../editor/static/sound-browser.js';

test('waveform includes transients at each bucket boundary and end', () => {
  const peaks = waveformEnvelope([new Float32Array([0, .5, -.75, 0, 0, 1, -.9, -.25])], 4);
  assert.deepEqual(peaks.slice(0, 3), [[0, .5], [-.75, 0], [0, 1]]);
  assert.ok(Math.abs(peaks[3][0] + .9) < 1e-6);
});

test('opposite stereo phases remain visible instead of cancelling', () => {
  assert.deepEqual(waveformEnvelope([[.5, 1], [-.5, -1]], 2), [[-.5, .5], [-1, 1]]);
});

test('empty, silent, short and nonfinite samples produce bounded geometry', () => {
  assert.deepEqual(waveformEnvelope([], 96), []);
  assert.deepEqual(waveformEnvelope([[0, 0]], 96), [[0, 0], [0, 0]]);
  assert.deepEqual(waveformEnvelope([[Infinity, NaN, 3, -4]], 2), [[0, 0], [-1, 1]]);
  assert.equal(waveformPath([[0, 0], [-1, 1]]), 'M25.00,50.00V50.00M75.00,6.00V94.00');
});
