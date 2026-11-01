// View > Lightmap detail (static/lightmap-detail.js): a face's units a sample from its corners in the world and in the
// lightmap atlas, its triangles taken together, no lightmap on the full-bright corner, a trim one sample across; the
// bands and the map's totals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleSizes, detailBand, lightmapTotals, DETAIL_BANDS, NO_LIGHTMAP } from '../editor/static/lightmap-detail.js';

const ATLAS = [1024, 512];
// a square wall of `side` units in two triangles, its lightmap `cells` samples across at atlas pixel (x, y)
function square(side, cells, x = 10, y = 20) {
  const P = [[0, 0, 0], [side, 0, 0], [side, 0, side], [0, 0, side]], A = [[0, 0], [cells, 0], [cells, cells], [0, cells]];
  const pos = [], uv = [];
  for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...P[k]); uv.push((x + A[k][0]) / ATLAS[0], (y + A[k][1]) / ATLAS[1]); }
  return { pos, uv };
}

test('a face takes its world area over its samples, its triangles together', () => {
  const { pos, uv } = square(256, 8);
  const s = sampleSizes(pos, uv, [3, 3], ATLAS);
  assert.equal(s.length, 2);
  assert.ok(Math.abs(s[0] - 32) < 1e-3 && Math.abs(s[1] - 32) < 1e-3);
  const fine = square(256, 32);
  assert.ok(Math.abs(sampleSizes(fine.pos, fine.uv, [-1, -1], ATLAS)[0] - 8) < 1e-3);
});

test('no lightmap: every corner on the full-bright pixel', () => {
  const pos = [0, 0, 0, 100, 0, 0, 0, 100, 0], corner = [1.5 / ATLAS[0], 1.5 / ATLAS[1]];
  assert.deepEqual([...sampleSizes(pos, [...corner, ...corner, ...corner], [0], ATLAS)], [0]);
});

test('a trim one sample across: its samples along its length', () => {
  // 256 long, 4 high: 8 samples along, one across (the atlas places it on one row)
  const pos = [0, 0, 0, 256, 0, 0, 256, 0, 4, 0, 0, 0, 256, 0, 4, 0, 0, 4];
  const at = (s) => [(10 + s) / ATLAS[0], 20 / ATLAS[1]];
  const uv = [...at(0), ...at(8), ...at(8), ...at(0), ...at(8), ...at(0)];
  const s = sampleSizes(pos, uv, [1, 1], ATLAS);
  assert.ok(Math.abs(s[0] - 32) < 1e-3, String(s[0]));
});

test('the bands: sizes to colours, no lightmap grey', () => {
  assert.equal(detailBand(8), DETAIL_BANDS[0]);
  assert.equal(detailBand(32), DETAIL_BANDS[2]);
  assert.equal(detailBand(48), DETAIL_BANDS[2]);
  assert.equal(detailBand(500), DETAIL_BANDS.at(-1));
  assert.equal(detailBand(0), NO_LIGHTMAP);
});

test('the map\'s totals: lightmaps, samples and the 32-bit estimate', () => {
  assert.deepEqual(lightmapTotals({ surfs: { 3: [4, 0, 10, 8, 0, 0, 32, 32], 7: [20, 0, 2, 3, 0, 0, 16, 16] } }),
    { lightmaps: 2, samples: 86, bytes: 344 });
  assert.deepEqual(lightmapTotals(null), { lightmaps: 0, samples: 0, bytes: 0 });
});
