// The Browser's favourites and tile sizes (static/browser-favourites.js): what is kept per project and read back, the
// stars toggled, the favourites whose asset is gone, the sizes and how Ctrl+wheel steps them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVOURITE_KINDS, FAVOURITES_GROUP, readFavourites, createFavourites, TILE_SIZES, DEFAULT_TILE_SIZE, tileSize, stepTileSize,
  wheelSteps } from '../editor/static/browser-favourites.js';

// a browser's storage: what was written, by key
function memoryStorage(initial = {}) {
  const kept = { ...initial };
  return { kept, getItem: (k) => (k in kept ? kept[k] : null), setItem: (k, v) => { kept[k] = String(v); } };
}

test('read back: only the kinds the browsers have, each id once, a label for each', () => {
  const data = readFavourites(JSON.stringify({
    objects: [{ id: 'Barrel1', label: 'Barrel' }, { id: 'Barrel1', label: 'again' }, { id: '' }, null, { label: 'no id' }, { id: 'Lamp1' }],
    textures: 'not a list', shaders: [{ id: 'x' }],
  }));
  assert.deepEqual(Object.keys(data), FAVOURITE_KINDS);
  assert.deepEqual(data.objects, [{ id: 'Barrel1', label: 'Barrel' }, { id: 'Lamp1', label: 'Lamp1' }]);
  assert.deepEqual(data.textures, []);
  assert.equal(data.shaders, undefined);
  for (const bad of [null, '', '{', '[1,2]', '"text"']) assert.deepEqual(readFavourites(bad).models, []);
});

test('a star toggled: on, kept in the project\'s storage in the order starred, off again', () => {
  const storage = memoryStorage(), changes = [];
  const favs = createFavourites({ storage: () => storage, key: () => 'p:alpha:favourites' });
  const stop = favs.subscribe((kind) => changes.push(kind));
  assert.equal(favs.toggle('models', { id: 'DeusExDeco.Plant1', label: 'Plant' }), true);
  assert.equal(favs.toggle('models', { id: 'DeusExDeco.Lamp1' }), true);
  assert.equal(favs.has('models', 'DeusExDeco.Plant1'), true);
  assert.equal(favs.has('sounds', 'DeusExDeco.Plant1'), false);
  assert.deepEqual(favs.list('models'), [{ id: 'DeusExDeco.Plant1', label: 'Plant' }, { id: 'DeusExDeco.Lamp1', label: 'DeusExDeco.Lamp1' }]);
  assert.deepEqual(JSON.parse(storage.kept['p:alpha:favourites']).models.map((f) => f.id), ['DeusExDeco.Plant1', 'DeusExDeco.Lamp1']);
  assert.equal(favs.toggle('models', { id: 'DeusExDeco.Plant1' }), false);
  assert.equal(favs.has('models', 'DeusExDeco.Plant1'), false);
  assert.deepEqual(changes, ['models', 'models', 'models']);
  stop();
  favs.toggle('sounds', { id: 'Ambient.Rain' });
  assert.deepEqual(changes, ['models', 'models', 'models']);
  // what list() gives is a copy: changing it changes nothing kept
  favs.list('sounds').push({ id: 'Other' });
  assert.equal(favs.list('sounds').length, 1);
});

test('no kind, no id: nothing changes', () => {
  const storage = memoryStorage();
  const favs = createFavourites({ storage: () => storage, key: () => 'k' });
  assert.equal(favs.toggle('shaders', { id: 'x' }), false);
  assert.equal(favs.toggle('objects', { id: '' }), false);
  assert.equal(favs.toggle('objects', null), false);
  assert.deepEqual(storage.kept, {});
  assert.deepEqual(favs.list('shaders'), []);
});

test('each project its own favourites: read again when the open project changes', () => {
  const storage = memoryStorage({ 'p:beta:favourites': JSON.stringify({ pieces: [{ id: 'piece7', label: 'Railing' }] }) });
  let project = 'alpha';
  const favs = createFavourites({ storage: () => storage, key: () => `p:${project}:favourites` });
  favs.toggle('pieces', { id: 'piece1', label: 'Fence' });
  assert.deepEqual(favs.list('pieces').map((f) => f.id), ['piece1']);
  project = 'beta';
  assert.deepEqual(favs.list('pieces').map((f) => f.id), ['piece7']);
  assert.equal(favs.has('pieces', 'piece1'), false);
  project = 'alpha';
  assert.equal(favs.has('pieces', 'piece1'), true);
});

test('no storage, or a storage that refuses: the favourites still work while the page is open', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } };
  for (const storage of [() => null, () => broken, () => { throw new Error('denied'); }]) {
    const favs = createFavourites({ storage, key: () => 'k' });
    assert.deepEqual(favs.list('objects'), []);
    assert.equal(favs.toggle('objects', { id: 'Light' }), true);
    assert.equal(favs.has('objects', 'Light'), true);
  }
});

test('entries: each favourite with what its browser has for it, null when it is gone', () => {
  const favs = createFavourites({ storage: () => memoryStorage(), key: () => 'k' });
  favs.toggle('prefabs', { id: 'pf1', label: 'Guard post' });
  favs.toggle('prefabs', { id: 'pf2', label: 'Deleted shed' });
  const library = new Map([['pf1', { id: 'pf1', label: 'Guard post' }]]);
  assert.deepEqual(favs.entries('prefabs', (id) => library.get(id)), [
    { fav: { id: 'pf1', label: 'Guard post' }, item: { id: 'pf1', label: 'Guard post' } },
    { fav: { id: 'pf2', label: 'Deleted shed' }, item: null },
  ]);
  assert.equal(FAVOURITES_GROUP, 'Favourites');
});

test('a label is kept short', () => {
  const favs = createFavourites({ storage: () => memoryStorage(), key: () => 'k' });
  favs.toggle('textures', { id: 'T', label: 'x'.repeat(500) });
  assert.equal(favs.list('textures')[0].label.length, 200);
});

test('tile sizes: a list, then small, medium and large; medium the size they always had', () => {
  assert.deepEqual(TILE_SIZES, ['list', 'small', 'medium', 'large']);
  assert.equal(DEFAULT_TILE_SIZE, 'medium');
  assert.equal(tileSize('large'), 'large');
  for (const bad of [null, undefined, '', 'huge', 3]) assert.equal(tileSize(bad), 'medium');
  assert.equal(stepTileSize('medium', 1), 'large');
  assert.equal(stepTileSize('medium', -1), 'small');
  assert.equal(stepTileSize('small', -1), 'list');
  assert.equal(stepTileSize('list', -3), 'list');
  assert.equal(stepTileSize('large', 2), 'large');
  assert.equal(stepTileSize('nonsense', 0), 'medium');
});

test('Ctrl+wheel: a notch of a mouse is one size, away from you bigger', () => {
  assert.deepEqual(wheelSteps(0, -100), { steps: 1, left: 0 });
  assert.deepEqual(wheelSteps(0, 100), { steps: -1, left: 0 });
  assert.deepEqual(wheelSteps(0, -125), { steps: 1, left: 0 });       // a scaled notch: still one
  assert.deepEqual(wheelSteps(0, 3, 1), { steps: -1, left: 0 });       // lines (3 a notch)
  assert.deepEqual(wheelSteps(0, -1, 2), { steps: 1, left: 0 });       // a page
});

test('Ctrl+wheel: a touchpad\'s small movements add up to one size; turning back starts again', () => {
  let left = 0, steps = 0;
  for (let i = 0; i < 4; i++) ({ steps, left } = wheelSteps(left, -10));
  assert.equal(steps, 0);
  assert.equal(left, 40);
  ({ steps, left } = wheelSteps(left, -12));
  assert.deepEqual({ steps, left }, { steps: 1, left: 0 });
  ({ steps, left } = wheelSteps(0, -30));
  ({ steps, left } = wheelSteps(left, 10));                            // the other way: 30 forgotten
  assert.deepEqual({ steps, left }, { steps: 0, left: -10 });
  assert.deepEqual(wheelSteps(left, 0), { steps: 0, left: -10 });
});
