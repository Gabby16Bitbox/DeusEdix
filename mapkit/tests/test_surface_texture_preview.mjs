// The 3D view's preview of the Surface panel's queued rows (static/surface-texture-preview.js) on three.js meshes as the
// editor builds them from geometry.json (a mesh per texture, its triangles' faces, UVs as data.py writes them): every
// face as its rows not built yet leave it (pan, scale, rotate, flips, Floor, Wall, a texture's size) and as built, what
// it cannot know left as it is (and said), a texture swap as before, the Texture Slip's faces written live on a copy
// made once, everything put back by restore. Real faces of the Feature Lab map (Feature Test project).
import test, { THREE } from './three.mjs';
import assert from 'node:assert/strict';
import { createSurfaceTexturePreview } from '../editor/static/surface-texture-preview.js';
import { mappingOf, mappingAfter, uvOf, faceNormal } from '../editor/static/texture-slip.js';

// geometry.json's faces: an added wall (Brush212 face 1), the room's floor (Brush2, a hole: csg 2) cut by the BSP in two
// pieces, its ceiling, and a face whose pieces are mapped otherwise (map null)
const WALL = [64, 400, 0, -0, -1, -0, -0, -0, -1, 0, 0, 128, 128], FLOOR = [0, 0, 0, 1, -0, -0, -0, 1, -0, 0, 0, 128, 128];
const CEILING = [0, 0, 384, 2, 0, 0, 0, -2, 0, 0, 0, 128, 128];
const FACES = [
  { brush: 'Brush212', poly: 1, tex: 'Pkg.Wall', flags: 0, structure: '', map: WALL, csg: 1 },
  { brush: 'Brush2', poly: 4, tex: 'Pkg.Wall', flags: 0, structure: '', map: FLOOR, csg: 2 },
  { brush: 'Brush2', poly: 5, tex: 'Pkg.Wall', flags: 0, structure: '', map: CEILING, csg: 2 },
  { brush: 'Brush7', poly: 0, tex: 'Pkg.Wall', flags: 0, structure: '', map: null, csg: 1 },
];
// each face's BSP pieces (corners in the map's frame), as the dump gives them
const PIECES = [
  [[[64, 528, 0], [64, 528, 96], [64, 272, 96], [64, 272, 0]]],
  [[[0, 0, 0], [0, 256, 0], [256, 256, 0], [256, 0, 0]], [[256, 0, 0], [256, 256, 0], [384, 0, 0]]],
  [[[0, 0, 384], [256, 0, 384], [256, 256, 384], [0, 256, 384]]],
  [[[500, 0, 0], [500, 0, 64], [500, 64, 0]]],
];
// one mesh of them all, as data.py writes it (fans; the UVs of each piece's own mapping), the corners kept as built
function meshOf(faces = FACES, pieces = PIECES) {
  const pos = [], uv = [], ids = [], piece = [];
  let polygon = 0;
  faces.forEach((f, id) => pieces[id].forEach((points) => {
    const m = mappingOf(f.map || WALL, f.tex);
    for (let k = 1; k < points.length - 1; k++) {
      ids.push(id); piece.push(polygon);
      for (const j of [0, k, k + 1]) { pos.push(...points[j]); uv.push(...uvOf(m, points[j])); }
    }
    polygon++;
  }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.userData = { faces: ids, tex: 'Pkg.Wall' };
  return { mesh, corners: { pos, piece } };
}
function setup({ frame = {}, tiles = { 'Pkg.Big': [256, 512] } } = {}) {
  const { mesh, corners } = meshOf(), made = [];
  const preview = createSurfaceTexturePreview({ THREE,
    textureInfo: (ref) => ({ 'Pkg.Wall': { url: 'wall.png', w: 128, h: 128 }, 'Pkg.Big': { url: 'big.png', w: 256, h: 512 },
      'Pkg.Odd': { url: 'odd.png', w: 64, h: 32 } })[ref] || null,
    materialFor: (info) => { const m = new THREE.MeshBasicMaterial(); m.name = info.url; made.push(m); return m; },
    cornersOf: (m) => (m === mesh ? corners : null), tileOf: (ref) => tiles[ref] || null, frameOf: () => frame });
  // the UVs a face shows now: [u, v] of each of its triangles' corners
  const uvs = (id) => { const at = mesh.geometry.getAttribute('uv'), out = [];
    mesh.userData.faces.forEach((f, t) => { if (f === id) for (let j = 0; j < 3; j++) out.push([at.getX(t * 3 + j), at.getY(t * 3 + j)]); });
    return out; };
  // the UVs a mapping gives on a face's corners
  const want = (id, m) => { const out = []; for (const points of PIECES[id]) for (let k = 1; k < points.length - 1; k++) for (const j of [0, k, k + 1]) out.push(uvOf(m, points[j])); return out; };
  const near = (a, b, what) => { assert.equal(a.length, b.length, what); a.forEach((p, i) => p.forEach((x, k) => assert.ok(Math.abs(x - b[i][k]) < 1e-4, `${what}: ${a[i]} vs ${b[i]}`))); };
  return { mesh, corners, preview, uvs, want, near, made, geometry: mesh.geometry, material: mesh.material };
}
const at = (brush, poly) => ({ brush, poly });

test('queued pan, scale, rotate and flips show on their faces as the host will leave them; restore puts the view back', () => {
  const s = setup(), before = [0, 1, 2, 3].map(s.uvs);
  const rows = [{ op: 'pan', args: [16, -8], targets: [at('Brush212', 1)] }, { op: 'scale', args: [2, 0.5], targets: [at('Brush2', '*')] },
    { op: 'rotate', args: [], targets: [at('Brush2', 5)] }, { op: 'flip-u', args: [], targets: [at('Brush212', 1)] }];
  const report = s.preview.apply([s.mesh], FACES, { surfaces: rows }, []);
  assert.deepEqual(report, { later: [], refused: [] });
  assert.notEqual(s.mesh.geometry, s.geometry);                         // a copy: the shared geometry is never written
  assert.equal(s.mesh.material, s.material);                            // no texture swapped: its material as it was
  for (const id of [0, 1, 2]) {
    const m = mappingAfter(mappingOf(FACES[id].map), rows.filter((r) => r.targets.some((t) => t.brush === FACES[id].brush && (t.poly === '*' || t.poly === FACES[id].poly))));
    s.near(s.uvs(id), s.want(id, m), `face ${id}`);
    assert.deepEqual(s.preview.current(id), m);
    assert.deepEqual(s.preview.asBuilt(id), mappingOf(FACES[id].map, FACES[id].tex));    // as built, whatever is queued
  }
  assert.equal(s.preview.asBuilt(3), null);                                               // mapped otherwise: none
  s.near(s.uvs(3), before[3], 'a face with no rows');
  s.preview.restore();
  assert.equal(s.mesh.geometry, s.geometry);
  [0, 1, 2, 3].forEach((id) => s.near(s.uvs(id), before[id], `face ${id} put back`));
  // the rows built already: nothing to show, nothing copied
  s.preview.apply([s.mesh], FACES, { surfaces: rows }, rows);
  assert.equal(s.mesh.geometry, s.geometry);
  assert.deepEqual(s.preview.current(0), mappingOf(WALL));
});

test('Floor and Wall from the face\'s pieces; what the view cannot know stays as it is, and is said', () => {
  const s = setup(), before = [0, 1, 2, 3].map(s.uvs);
  const rows = [{ op: 'wall', args: [], targets: [at('Brush212', 1)] }, { op: 'floor', args: [], targets: [at('Brush2', 4)] },
    { op: 'cylinder', args: [], targets: [at('Brush2', '*')] }, { op: 'pan', args: [4, 0], targets: [at('Brush7', 0)] }];
  const report = s.preview.apply([s.mesh], FACES, { surfaces: rows }, []);
  // the floor: two pieces, a hole's (its source polygon faces down); its normal from both pieces put together again
  const floor = s.preview.shapeOf(1);
  assert.equal(floor.pieces.length, 2);
  assert.deepEqual(floor.normal, faceNormal(PIECES[1][0]).map((c) => (c ? -c : 0)));
  s.near(s.uvs(0), s.want(0, mappingAfter(mappingOf(WALL), [rows[0]], s.preview.shapeOf(0))), 'Wall');
  // Around a cylinder (the floor's caps keep theirs: its face is horizontal; the ceiling too), a face with no single
  // mapping: as they are, and listed
  assert.deepEqual(report.later.sort(), [3]);
  s.near(s.uvs(3), before[3], 'no single mapping');
  // a structure moved since the Rebuild: Floor and Wall are anchored to the world, so they wait for it
  const moved = setup({ frame: { moved: true } });
  const after = moved.preview.apply([moved.mesh], FACES, { surfaces: rows }, []);
  assert.deepEqual(after.later.sort(), [0, 1, 3]);
  moved.near(moved.uvs(0), before[0], 'Wall on a moved structure');
  // resized since: its UVs are texture-scale.js's, nothing written
  const resized = setup({ frame: { resized: true } });
  resized.preview.apply([resized.mesh], FACES, { surfaces: [{ op: 'pan', args: [4, 0], targets: [at('Brush212', 1)] }] }, []);
  assert.equal(resized.mesh.geometry, resized.geometry);
  // the rows built not known: every face a row names waits for a Rebuild
  const unknown = setup();
  assert.deepEqual(unknown.preview.apply([unknown.mesh], FACES, { surfaces: rows }, null).later.sort(), [0, 1, 2, 3]);
  assert.equal(unknown.mesh.geometry, unknown.geometry);
});

test('a structure resized since the Rebuild: its rows wait for it (said), a texture swap still shows; texture-scale.js\'s copy stays', () => {
  const s = setup({ frame: { resized: true } }), before = [0, 1, 2, 3].map(s.uvs);
  const report = s.preview.apply([s.mesh], FACES, { surfaces: [{ op: 'pan', args: [4, 0], targets: [at('Brush212', 1)] },
    { op: 'texture', args: ['Pkg.Odd'], targets: [at('Brush2', 5)] }] }, []);
  assert.deepEqual(report.later.sort(), [0, 2]);                        // the pan (and the swap's alignment): after a Rebuild
  s.near(s.uvs(0), before[0], 'the pan not drawn');
  // the swap as before: its picture, the UVs made the new image's from the old one's (128 to 64 by 32)
  assert.deepEqual(s.mesh.material.map((m) => m.name), ['', 'odd.png']);
  s.near(s.uvs(2), before[2].map(([u, v]) => [u * 2, v * 4]), 'the swap');
  // resized again: texture-scale.js puts its own copy on the mesh (its UVs); restore leaves it, the material put back
  const scaled = s.mesh.geometry.clone();
  s.mesh.geometry = scaled;
  s.preview.restore();
  assert.equal(s.mesh.geometry, scaled);
  assert.equal(s.mesh.material, s.material);
  // its own copy still on the mesh: restore puts back the geometry apply found
  s.preview.apply([s.mesh], FACES, { surfaces: [{ op: 'texture', args: ['Pkg.Odd'], targets: [at('Brush2', 5)] }] }, []);
  assert.notEqual(s.mesh.geometry, scaled);
  s.preview.restore();
  assert.equal(s.mesh.geometry, scaled);
});

test('the rows Save or the Rebuild would refuse, said with their faces', () => {
  const s = setup();
  const report = s.preview.apply([s.mesh], FACES, { surfaces: [{ op: 'pan', args: [32767, 0], targets: [at('Brush212', 1)] },
    { op: 'pan', args: [32767, 0], targets: [at('Brush212', 1)] }, { op: 'pan', args: [0.5, 0], targets: [at('Brush2', 5)] }] }, []);
  assert.deepEqual(report.refused.map((r) => [r.id, r.stage, r.refused]), [[0, 'rebuild', "Pan exceeds the engine's signed 16-bit range"],
    [2, 'save', 'Pan uses whole texels, between -32767 and 32767.']]);
});

test('a texture swapped: its size known, the UVs from the face\'s mapping; not known, scaled by the images as before', () => {
  const s = setup(), before = s.uvs(0);
  s.preview.apply([s.mesh], FACES, { surfaces: [{ op: 'texture', args: ['Pkg.Big'], targets: [at('Brush212', 1)] },
    { op: 'texture', args: ['Pkg.Odd'], targets: [at('Brush2', 5)] }] }, []);
  assert.deepEqual(s.mesh.material.map((m) => m.name), ['', 'big.png', 'odd.png']);
  assert.deepEqual(s.preview.current(0).tile, [256, 512]);
  s.near(s.uvs(0), s.want(0, { ...mappingOf(WALL), tile: [256, 512] }), 'the size known');
  assert.ok(s.uvs(0).some((p, i) => Math.abs(p[1] - before[i][1]) > 1e-3));
  // Pkg.Odd's tile not known: the UVs made the new image's from the old one's (128 to 64 by 32)
  const ceiling = mappingOf(CEILING);
  s.near(s.uvs(2), s.want(2, ceiling).map(([u, v]) => [u * 2, v * 4]), 'the size not known');
  assert.equal(s.preview.current(2), null);
  assert.equal(s.mesh.geometry.groups.length > 1, true);
  s.preview.restore();
  assert.equal(s.mesh.material, s.material);
  assert.ok(s.made.every((m) => m.name));
});

test('the Texture Slip: its faces written at each call on one copy, the others as apply left them', () => {
  const s = setup(), before = [0, 1, 2, 3].map(s.uvs);
  s.preview.apply([s.mesh], FACES, { surfaces: [{ op: 'pan', args: [8, 0], targets: [at('Brush2', 5)] }] }, []);
  const copy = s.mesh.geometry, panned = s.uvs(2);
  const slid = mappingAfter(mappingOf(FLOOR), [{ op: 'scale', args: [1.18921, 1.18921] }, { op: 'pan', args: [3, -7] }]);
  s.preview.slip(new Map([[1, slid], [3, null]]));
  assert.equal(s.mesh.geometry, copy);
  s.near(s.uvs(1), s.want(1, slid), 'the face slipped');
  s.near(s.uvs(2), panned, 'a face with its own rows');
  s.near(s.uvs(3), before[3], 'a face left out');
  const again = mappingAfter(slid, [{ op: 'pan', args: [1, 1] }]);
  s.preview.slip(new Map([[1, again]]));
  assert.equal(s.mesh.geometry, copy);
  s.near(s.uvs(1), s.want(1, again), 'slipped again');
  // with no rows of its own a mesh is copied at the first call, once
  const t = setup();
  t.preview.apply([t.mesh], FACES, { surfaces: [] }, []);
  assert.equal(t.mesh.geometry, t.geometry);
  t.preview.slip(new Map([[0, mappingAfter(mappingOf(WALL), [{ op: 'pan', args: [2, 2] }])]]));
  const own = t.mesh.geometry;
  assert.notEqual(own, t.geometry);
  t.preview.slip(new Map([[0, mappingOf(WALL)]]));
  assert.equal(t.mesh.geometry, own);
  t.preview.restore();
  assert.equal(t.mesh.geometry, t.geometry);
  [0, 1, 2, 3].forEach((id) => t.near(t.uvs(id), before[id], `face ${id} put back`));
});

test('an older geometry (no mappings): a texture swap as before, the alignment after a Rebuild', () => {
  const old = FACES.map(({ map, csg, ...rest }) => rest);
  const s = setup(), before = s.uvs(0);
  const report = s.preview.apply([s.mesh], old, { surfaces: [{ op: 'pan', args: [8, 0], targets: [at('Brush212', 1)] },
    { op: 'texture', args: ['Pkg.Big'], targets: [at('Brush212', 1)] }] }, []);
  assert.deepEqual(report.later, [0]);
  s.near(s.uvs(0), before.map(([u, v]) => [u / 2, v / 4]), 'scaled by the images');
  assert.equal(s.preview.current(0), null);
});
