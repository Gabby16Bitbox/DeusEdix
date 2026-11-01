// The views of the last rebuild (static/view-modes.js) on a stand-in world: a view whose data comes after the map was
// read again (reset: a Rebuild ended, another map opened) draws nothing; Lightmap detail is drawn once, from the
// lightmaps of the geometry shown, whichever answer comes first.
import test, { THREE } from './three.mjs';
import assert from 'node:assert/strict';

const element = () => ({ hidden: false, id: '', textContent: '', innerHTML: '', appendChild() {} });
globalThis.document = { createElement: element, head: element(), body: element() };
const { createViewModes } = await import('../editor/static/view-modes.js');

// a world of one surface (two corners in the lightmaps' atlas each); lightmaps(): each read waits for the test
function rig() {
  const world = new THREE.Group(), geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 64, 0, 0, 0, 0, 64]), 3));
  geo.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array([0, 0, 0.5, 0, 0, 0.5]), 2));
  const surface = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  surface.userData = { world: true, faces: [0] };
  world.add(surface);
  const reads = [];
  const views = createViewModes(THREE, { load: async () => ({ structures: {}, zones: [], zoned: true }), place: () => null,
    worldMeshes: () => world.children.filter((o) => o.userData.world), lightmaps: () => new Promise((resolve) => reads.push(resolve)) });
  const overlays = () => world.children.filter((o) => o.material?.isShaderMaterial);
  return { views, reads, overlays, surface };
}
const OLD = { size: [64, 64], surfs: { 1: [0, 0, 4, 4] } }, NEW = { size: [512, 256], surfs: { 1: [0, 0, 8, 8], 2: [8, 0, 2, 2] } };

test('Lightmap detail: the map read again while its lightmaps load, the new ones come first: drawn once, from them', async () => {
  const { views, reads, overlays, surface } = rig();
  const first = views.set('lightmap');
  const second = views.reset();
  assert.equal(reads.length, 2);
  reads[1](NEW); await second;
  reads[0](OLD); await first;
  assert.equal(overlays().length, 1);
  assert.deepEqual(overlays()[0].material.uniforms.atlas.value.toArray(), [512, 256]);
  assert.equal(surface.visible, false);                       // the world's own surface hidden under it
});

test('Lightmap detail: the old lightmaps coming first are not drawn, nor kept', async () => {
  const { views, reads, overlays } = rig();
  const first = views.set('lightmap');
  const second = views.reset();
  reads[0](OLD); await first;
  assert.equal(overlays().length, 0);
  reads[1](NEW); await second;
  assert.equal(overlays().length, 1);
  assert.deepEqual(overlays()[0].material.uniforms.atlas.value.toArray(), [512, 256]);
  await views.set('wire');                                    // another view and back: the lightmaps kept are the new ones
  await views.set('lightmap');
  assert.equal(reads.length, 2);
  assert.deepEqual(overlays()[0].material.uniforms.atlas.value.toArray(), [512, 256]);
});

// Wireframe, BSP cuts and Zones read the views (load) as Lightmap detail its lightmaps: each read waits for the test
function viewsRig() {
  const world = new THREE.Group(), holder = new THREE.Group(), loads = [];
  world.add(holder);
  const views = createViewModes(THREE, { load: () => new Promise((resolve) => loads.push(resolve)),
    place: () => ({ holder, center: [0, 0, 0], turn: null }), worldMeshes: () => [], lightmaps: async () => null });
  const lines = () => holder.children.map((o) => o.geometry.getAttribute('position').count);   // each drawing's corners
  return { views, loads, lines };
}
const VIEWS = (n) => ({ zoned: true, zones: [], structures: { s: { wire: new Array(n * 3).fill(0), cuts: [], tris: [], zone: [] } } });

test('Wireframe: the map read again while its views load, the new ones come first: drawn once, from them, and kept (batch 6 gap #6)', async () => {
  const { views, loads, lines } = viewsRig();
  const first = views.set('wire');
  const second = views.reset();
  assert.equal(loads.length, 2);
  loads[1](VIEWS(4)); await second;
  loads[0](VIEWS(2)); await first;                            // the old views, last: not drawn, not kept
  assert.deepEqual(lines(), [4]);
  await views.set('cuts');
  await views.set('wire');                                    // another view and back: the views kept are the new ones
  assert.equal(loads.length, 2);
  assert.deepEqual(lines(), [4]);
});

test('another view chosen while the lightmaps load: nothing drawn for Lightmap detail', async () => {
  const { views, reads, overlays } = rig();
  const first = views.set('lightmap');
  await views.set('wire');
  reads[0](NEW); await first;
  assert.equal(overlays().length, 0);
  assert.equal(views.mode, 'wire');
});
