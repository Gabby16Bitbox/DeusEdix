import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// studio-props.js imports 'three' (the page's import map), so its pure gameTriangles is taken from the source
const source = fs.readFileSync(new URL('../editor/static/studio-props.js', import.meta.url), 'utf8');
const start = source.indexOf('export function gameTriangles(');
const context = vm.createContext({ Float32Array });
vm.runInContext(source.slice(start + 'export '.length, source.indexOf('\n}', start) + 2), context);
const { gameTriangles } = context;

// the normal three.js draws in front: (b - a) x (c - a), in our axes
function normal(pos, t) {
  const p = (k) => [0, 1, 2].map((i) => pos[9 * t + 3 * k + i]);
  const [a, b, c] = [p(0), p(1), p(2)], u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
  return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
}

test('a prop triangle keeps the side the game shows: the mirror of the axes and the corner order cancel out', () => {
  const posUE = [0, 0, 0, 0, 1, 0, 1, 0, 0];
  const uvGame = [0, 0, 0, 1, 1, 0];
  const { pos, uv } = gameTriangles(posUE, uvGame);
  assert.deepEqual([...pos], [0, 0, 0, 1, 0, 0, 0, 0, 1], 'corners 0, 2, 1 with y and z swapped');
  assert.deepEqual([...uv], [0, 0, 1, 0, 0, 1], 'each corner keeps its own texture point');
  // the game's corners give (b - a) x (c - a) in Unreal's axes; the same physical direction in ours (y and z swapped)
  // must be the side three.js draws, as with the characters (studio.js); the old order gave the opposite one
  const front = normal(posUE, 0), ours = normal(pos, 0);
  assert.deepEqual(ours, [front[0], front[2], front[1]]);
});

test('every triangle of a part is turned the same way, positions and texture together', () => {
  const posUE = [], uvGame = [];
  for (let t = 0; t < 3; t++) { posUE.push(t, 0, 0, t, 1, 0, t + 1, 0, 5); uvGame.push(t, 0, t, 1, t + 1, 0); }
  const { pos, uv } = gameTriangles(posUE, uvGame);
  for (let t = 0; t < 3; t++) {
    assert.deepEqual([...pos.slice(9 * t, 9 * t + 9)], [t, 0, 0, t + 1, 5, 0, t, 0, 1]);
    assert.deepEqual([...uv.slice(6 * t, 6 * t + 6)], [t, 0, t + 1, 0, t, 1]);
  }
});
