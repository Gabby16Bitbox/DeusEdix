import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textureUVToPoint, buildUVIslands, continuousUVHits, triangleCanvasPolygons } from '../editor/static/texture-paint-uv.js';

const near = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} should equal ${expected}`);
const tri = (faceIndex, positions, uvs) => ({ faceIndex, positions, uvs });
const a = tri(0, [[0, 0, 0], [1, 0, 0], [1, 1, 0]], [[0, 0], [1, 0], [1, 1]]);
const b = tri(1, [[0, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 0], [1, 1], [0, 1]]);
const area = polygon => Math.abs(polygon.reduce((sum, point, i) => { const next = polygon[(i + 1) % polygon.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0)) / 2;

test('Deus Ex top-down UVs address the visible texel, including non-square images', () => {
  const p = textureUVToPoint([.25, .75], 256, 128);
  assert.equal(p.x, 64); assert.equal(p.y, 96);
  const flipped = textureUVToPoint({ x: .25, y: .75 }, 256, 128, { flipY: true });
  assert.equal(flipped.y, 32);
  assert.equal(textureUVToPoint([NaN, 0], 256, 128), null);
});
test('UV borders remain valid sample pixels rather than going out of bounds', () => {
  const p = textureUVToPoint([1, 1], 256, 128);
  assert.equal(Math.floor(p.x), 255); assert.equal(Math.floor(p.y), 127);
  assert.equal(textureUVToPoint([0, 0], 256, 128).x, 0);
});
test('negative and repeated texture UVs wrap like Three.js textures', () => {
  const p = textureUVToPoint([-.25, 2.25], 256, 128);
  assert.equal(p.x, 192); assert.equal(p.y, 32);
  assert.equal(p.tileU, -1); assert.equal(p.tileV, 2);
  const mirrored = textureUVToPoint([1.25, -.25], 256, 128, { wrapS: 1002, wrapT: 1002 });
  assert.equal(mirrored.x, 192); assert.equal(mirrored.y, 32);
  const clamped = textureUVToPoint([-1, 2], 256, 128, { wrapS: 1001, wrapT: 1001 });
  assert.equal(clamped.x, 0); assert.equal(Math.floor(clamped.y), 127);
});
test('texture transforms are applied before wrapping and flipping', () => {
  const p = textureUVToPoint([.25, .75], 256, 128,
    { matrix: [2, 0, 0, 0, 2, 0, .25, -.25, 1], flipY: true });
  assert.equal(p.x, 192); assert.equal(p.y, 96); assert.equal(p.tileV, 1);
});
test('non-indexed triangles sharing geometry and UV edge form one island', () => {
  const result = buildUVIslands([a, b]);
  assert.equal(result.islands.size, 1);
  assert.equal(result.byFace.get(0), result.byFace.get(1));
  assert.ok(result.adjacent.get(0).has(1)); assert.ok(result.adjacent.get(1).has(0));
});
test('UV seams and disconnected geometry remain separate islands', () => {
  const seam = { ...b, uvs: [[.5, 0], [.5, 1], [0, 1]] };
  assert.equal(buildUVIslands([a, seam]).islands.size, 2);
  const disconnected = { ...b, positions: b.positions.map(p => [p[0], p[1], 10]) };
  assert.equal(buildUVIslands([a, disconnected]).islands.size, 2);
});
test('a point touching another shell is not an edge connection', () => {
  const point = tri(2, [[1, 1, 0], [2, 1, 0], [2, 2, 0]], [[1, 1], [2, 1], [2, 2]]);
  assert.equal(buildUVIslands([a, point]).islands.size, 2);
});
test('continuous strokes cross adjacent faces but never jump shells, wraps, or occluders', () => {
  const previous = { x: 40, y: 50, objectId: 'crate', islandId: 0, faceIndex: 0, tileU: 0, tileV: 0 };
  const next = { ...previous, x: 43, faceIndex: 1, adjacentFaces: new Set([0]) };
  const opts = { width: 256, height: 256, brushSize: 8 };
  assert.equal(continuousUVHits(previous, next, opts), true);
  for (const change of [{ objectId: 'person' }, { islandId: 1 }, { tileU: 1 }, { adjacentFaces: new Set() }, { x: 240 }])
    assert.equal(continuousUVHits(previous, { ...next, ...change }, opts), false);
  assert.equal(continuousUVHits(null, next, opts), false);
});
test('repeated triangles split at UV seams instead of producing an atlas-wide diagonal', () => {
  const polygons = triangleCanvasPolygons([[.9, .2], [1.1, .2], [.9, .4]]);
  assert.equal(polygons.length, 2);
  near(polygons.reduce((sum, polygon) => sum + area(polygon), 0), .02);
  for (const polygon of polygons) {
    const xs = polygon.map(p => p[0]);
    assert.ok(Math.max(...xs) - Math.min(...xs) <= .101);
    assert.ok(polygon.flat().every(v => v >= 0 && v <= 1));
  }
});
test('wrapped UV masks retain texture transform, mirrored repeat, and flipY orientation', () => {
  const polygons = triangleCanvasPolygons([[1.2, .2], [1.4, .2], [1.2, .4]], { wrapS: 'mirror', flipY: true });
  const points = polygons.flat();
  assert.ok(points.some(p => Math.abs(p[0] - .8) < 1e-7 && Math.abs(p[1] - .8) < 1e-7));
  near(area(polygons[0]), .02);
  const transformed = triangleCanvasPolygons([[0, 0], [.2, 0], [0, .2]], { matrix: [2, 0, 0, 0, 2, 0, .1, .1, 1] });
  near(area(transformed[0]), .08);
});
test('clamped triangle masks retain true clipping intersections', () => {
  const polygon = triangleCanvasPolygons([[-1, 0], [.5, 1], [.5, 0]], { wrapS: 'clamp', wrapT: 'clamp' })[0];
  assert.equal(polygon.length, 4);
  assert.ok(polygon.some(p => p[0] === 0 && Math.abs(p[1] - 2 / 3) < 1e-7));
  near(area(polygon), 5 / 12);
});
test('opposite winding triangles create same-winding masks; malformed UVs are bounded', () => {
  const forward = triangleCanvasPolygons([[0, 0], [1, 0], [0, 1]])[0];
  const backward = triangleCanvasPolygons([[0, 1], [1, 0], [0, 0]])[0];
  const signed = points => points.reduce((s, p, i) => { const q = points[(i + 1) % points.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  assert.ok(signed(forward) > 0 && signed(backward) > 0);
  assert.deepEqual(triangleCanvasPolygons([[NaN, 0], [1, 0], [0, 1]]), []);
  assert.throws(() => triangleCanvasPolygons([[0, 0], [10000, 0], [0, 10000]]), /paint limit/);
});
