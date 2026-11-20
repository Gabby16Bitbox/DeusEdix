import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneTextures } from '../editor/static/scene-textures.js';

// What is being placed loads before the map's textures still waiting (17 Nov 2026: a Player Start clicked while a
// map loaded waited behind all of them)
test('a texture hurried goes before every other waiting one, and only once', async () => {
  const started = [], done = new Map();
  const queue = createSceneTextures({ createTexture: () => ({ userData: {}, dispose() {} }), placeholder: {}, limit: 1,
    loadImage: (url, ready) => { started.push(url); done.set(url, ready); } });
  const tick = () => new Promise((r) => queueMicrotask(r));
  queue.load('map/a.png'); queue.load('map/b.png'); queue.load('map/c.png');
  const wanted = queue.load('pal/flag.png');
  await tick();
  assert.deepEqual(started, ['map/a.png']);
  queue.hurry(wanted);
  queue.hurry(wanted);
  done.get('map/a.png')({ width: 1 });
  await tick();
  assert.deepEqual(started, ['map/a.png', 'pal/flag.png']);
  done.get('pal/flag.png')({ width: 1 });
  await tick();
  assert.deepEqual(started, ['map/a.png', 'pal/flag.png', 'map/b.png']);
  assert.equal(wanted.userData.pending, false);
  queue.hurry(wanted);                               // already there: nothing to do
  assert.equal(started.length, 3);
  queue.clear();                                     // (its timers)
});
