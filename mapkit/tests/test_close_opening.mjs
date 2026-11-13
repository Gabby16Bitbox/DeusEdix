// Tools > Close an opening (editor/static/close-opening.js): measured in a world of rooms, as the game's BSP is
// (the air a union of boxes; a surface faces the air it bounds).
import test from 'node:test';
import assert from 'node:assert/strict';
import { measureOpening, fillBox, mappingFromNums, mappingFromTriangle, uvAt, MARGIN } from '../editor/static/close-opening.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// the nearest surface facing the ray: where the air the ray is in (or next meets) ends
function caster(rooms) {
  return (from, dir, far = Infinity) => {
    const l = Math.hypot(...dir), d = dir.map((x) => x / l), spans = [];
    for (const [lo, hi] of rooms) {
      let t0 = -Infinity, t1 = Infinity, out = null;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(d[k]) < 1e-12) { if (from[k] < lo[k] || from[k] > hi[k]) { t0 = Infinity; break; } continue; }
        let a = (lo[k] - from[k]) / d[k], b = (hi[k] - from[k]) / d[k];
        const exitN = [0, 0, 0]; exitN[k] = d[k] > 0 ? -1 : 1;           // the face it leaves by, facing back in
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        if (b < t1) { t1 = b; out = exitN; }
      }
      if (t0 < t1 && t1 > 1e-9) spans.push([t0, t1, out]);
    }
    spans.sort((x, y) => x[0] - y[0]);
    let cur = null;
    for (const s of spans) {
      if (!cur) { cur = [...s]; continue; }
      if (s[0] <= cur[1] + 1e-9) { if (s[1] > cur[1]) { cur[1] = s[1]; cur[2] = s[2]; } } else break;
    }
    if (!cur || cur[1] > far) return null;
    return { d: cur[1], n: cur[2], p: from.map((x, k) => x + d[k] * cur[1]) };
  };
}
const near = (a, b, e = 0.3) => Math.abs(a - b) <= e;

// two rooms, a wall 16 thick between them (x 512..528) and a doorway 64 wide, 112 high through it
const DOOR = [[[0, 0, 0], [512, 512, 256]], [[528, 0, 0], [1040, 512, 256]], [[511, 200, 0], [529, 264, 112]]];

test('a doorway: its sides, its depth, the faces in front and behind', () => {
  const m = measureOpening(caster(DOOR), [100, 230, 60], [1, 0.02, -0.01]);
  assert.equal(m.ok, true, m.why);
  assert.deepEqual(m.n, [-1, 0, 0]);
  assert.equal(m.kind, 'wall');
  assert.equal(m.front, -512);              // n.p: the wall's face at x = 512
  assert.equal(m.depth, 16);                 // exact: from the wall behind, not the quarter-unit search
  assert.ok(near(m.sides.left + m.sides.right, 64), JSON.stringify(m.sides));
  assert.ok(near(m.sides.down + m.sides.up, 112), JSON.stringify(m.sides));
  assert.ok(m.frontHit && near(m.frontHit.p[0], 512));
  assert.ok(m.backHit && near(m.backHit.p[0], 528) && m.backHit.n[0] === 1);
  assert.ok(m.depths.down > 500);           // the floor goes on under the doorway (to the far wall): not the wall's depth
  const b = fillBox(m);
  assert.equal(b.rot, null);
  assert.ok(near(b.lo[0], 512) && near(b.hi[0], 528), JSON.stringify(b));
  assert.ok(near(b.lo[1], 200 - MARGIN) && near(b.hi[1], 264 + MARGIN), JSON.stringify(b));
  assert.ok(near(b.lo[2], -MARGIN) && near(b.hi[2], 112 + MARGIN), JSON.stringify(b));
});

test('seen at a slant, the jamb is not taken for the wall', () => {
  const m = measureOpening(caster(DOOR), [380, 60, 90], [512 - 380, 232 - 60, 50 - 90]);
  assert.equal(m.ok, true, m.why);
  assert.deepEqual(m.n, [-1, 0, 0]);
  assert.ok(near(m.depth, 16));
});

test('a pit in a floor', () => {
  const rooms = [[[0, 0, 0], [512, 512, 256]], [[0, 0, -272], [512, 512, -24]], [[100, 100, -25], [164, 164, 1]]];
  const m = measureOpening(caster(rooms), [140, 120, 200], [0.01, 0.02, -1]);
  assert.equal(m.ok, true, m.why);
  assert.equal(m.kind, 'floor');
  assert.deepEqual(m.n, [0, 0, 1]);
  assert.ok(near(m.depth, 24), `depth ${m.depth}`);
  const b = fillBox(m);
  assert.ok(near(b.lo[2], -24) && near(b.hi[2], 0), JSON.stringify(b));
  assert.ok(near(b.lo[0], 100 - MARGIN) && near(b.hi[1], 164 + MARGIN), JSON.stringify(b));
});

test('a window in a wall at an angle: a turned block', () => {
  // the same doorway in a wall seen from a frame turned 30 degrees: the caster turns the rays back
  const a = Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
  const toLocal = (p) => [c * p[0] + s * p[1], -s * p[0] + c * p[1], p[2]];
  const toWorld = (p) => [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
  const win = [[[0, 0, 0], [512, 512, 256]], [[528, 0, 0], [1040, 512, 256]], [[511, 200, 40], [529, 264, 120]]];
  const local = caster(win);
  const cast = (from, dir, far) => { const h = local(toLocal(from), toLocal(dir), far); return h && { d: h.d, n: toWorld(h.n), p: toWorld(h.p) }; };
  const m = measureOpening(cast, toWorld([100, 232, 80]), toWorld([1, 0, 0]));
  assert.equal(m.ok, true, m.why);
  assert.ok(near(m.depth, 16));
  assert.ok(near(m.sides.down + m.sides.up, 80), JSON.stringify(m.sides));
  const b = fillBox(m);
  assert.ok(b.rot && near(b.rot[1], Math.round(((Math.PI + a) / (2 * Math.PI)) * 65536), 1), JSON.stringify(b.rot));
  assert.ok(near(b.hi[0] - b.lo[0], 16) && near(b.hi[1] - b.lo[1], 64 + 2 * MARGIN) && near(b.hi[2] - b.lo[2], 80 + 2 * MARGIN));
});

test('what cannot be closed says why', () => {
  const cast = caster(DOOR);
  assert.match(measureOpening(cast, [100, 100, 60], [1, 0, 0]).why, /wall itself/);       // the wall, no opening
  const passage = [[[0, 0, 0], [512, 512, 256]], [[511, 200, 0], [3000, 264, 112]]];
  assert.match(measureOpening(caster(passage), [100, 230, 60], [1, 0.02, 0]).why, /passage/);
});

test('a face mapping as the T3D writes it gives the texture coordinates the game draws', () => {
  const nums = [10, 20, 30, 0, 2, 0, 0, 0, -1.5, 37, -12, 256, 128];
  const m = mappingFromNums(nums);
  for (const P of [[512, 40, 70], [512, 300, -8]]) {
    const du = (P[0] - 10) * 0 + (P[1] - 20) * 2 + (P[2] - 30) * 0, dv = (P[2] - 30) * -1.5;
    const [u, v] = uvAt(m, P);
    assert.ok(near(u, (du + 37) / 256, 1e-9) && near(v, (dv - 12) / 128, 1e-9));
  }
  // the same mapping read back from a triangle of the 3D view
  const P = [[512, 40, 70], [512, 140, 70], [512, 40, 10]];
  const t = P.map((p) => uvAt(m, p));
  const m2 = mappingFromTriangle(P, t, 256, 128);
  for (const Q of [[512, 999, -400], [512, -50, 33]]) {
    const a = uvAt(m, Q), b = uvAt(m2, Q);
    assert.ok(near(a[0], b[0], 1e-6) && near(a[1], b[1], 1e-6));
  }
});
