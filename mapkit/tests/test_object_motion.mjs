import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// app.js's object animation curve (UCMotion's in the game), loaded by name
const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
const body = (name) => { const i = source.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return source.slice(i, source.indexOf('\n}', i) + 2); };
const c = vm.createContext({});
vm.runInContext(['animComp', 'animCloses', 'animSlope', 'animValue', 'sampleTrack'].map(body).join('\n'), c);
const key = (t, v, e = 1) => ({ t, v: [v, 0, 0], e });
const path = (keys, len, loop = false, step = 0.01) => { const out = []; for (let t = 0; t <= len + 1e-9; t += step) out.push(c.sampleTrack(keys, t, 3, loop, len)[0]); return out; };

test('played from its first key, an object never goes back past it: a small short step before a long big one', () => {
  const keys = [key(0, 0), key(1, 10), key(1.5, 200)];
  const xs = path(keys, 1.5);
  assert.ok(Math.min(...xs) >= -1e-9, `it went to ${Math.min(...xs).toFixed(2)}`);     // the plain spline went to about -12.7
  assert.ok(Math.max(...xs) <= 200 + 1e-9);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1] - 1e-9, 'it only goes forward');
  assert.equal(xs[0], 0); assert.equal(c.sampleTrack(keys, 1, 3)[0], 10); assert.equal(c.sampleTrack(keys, 1.5, 3)[0], 200);
});

test('a key where the motion turns back is where it stops: never past it', () => {
  const keys = [key(0, 0), key(1, 100), key(1.2, 0)];
  const xs = path(keys, 1.2);
  assert.ok(Math.max(...xs) <= 100 + 1e-9, `it went to ${Math.max(...xs).toFixed(2)}`);
  assert.ok(Math.min(...xs) >= -1e-9);
  assert.equal(c.animSlope(keys, 1, 0, false, 1.2), 0);
});

test('even keys keep their smooth curve (the speed through both neighbours)', () => {
  const keys = [key(0, 0), key(1, 10), key(2, 20), key(3, 30)];
  assert.equal(c.animSlope(keys, 1, 0, false, 3), 10);
  assert.equal(c.animSlope(keys, 2, 0, false, 3), 10);
  assert.ok(Math.abs(c.sampleTrack(keys, 1.5, 3)[0] - 15) < 1e-9);
});

test('a loop goes on through its closing key, held back the same way', () => {
  const keys = [key(0, 0), key(1, 50), key(2, 60), key(3, 0)];
  const s0 = c.animSlope(keys, 0, 0, true, 3), s3 = c.animSlope(keys, 3, 0, true, 3);
  assert.equal(s0, s3, 'the same speed leaving and coming back');
  const xs = path(keys, 3, true);
  assert.ok(Math.max(...xs) <= 60 + 1e-9 && Math.min(...xs) >= -1e-9, 'within its keys');
});

test('Linear, Hold and Ease keys behave as before', () => {
  const lin = [key(0, 0, 0), key(1, 10, 0), key(2, 30, 1), key(3, 40)];
  assert.equal(c.sampleTrack(lin, 0.5, 3)[0], 5);
  assert.equal(c.animSlope(lin, 1, 0, false, 3), 10, 'after a straight step: on with its speed');
  const hold = [key(0, 0, 4), key(1, 10), key(2, 30)];
  assert.equal(c.sampleTrack(hold, 0.9, 3)[0], 0);
  const ease = [key(0, 0), key(1, 10, 2), key(2, 30)];
  assert.equal(c.animSlope(ease, 1, 0, false, 2), 0, 'an Ease in starts from rest');
});
