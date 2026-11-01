// View > Effects' coronas (static/light-effects-view.js) on three.js: the game's size on the screen (coronaScale), over
// the walls, its lamp's colour and not dimmed by it; shown while its line of sight is clear (CORONA_LOOKS lines a frame,
// in turn) and faded in and out; the CORONA_MAX nearest the camera; none left once Effects stops, the next start's
// coming in from nothing (lights_research.md of batch 6: the game's coronas, 28 Oct 2026).
import test, { THREE } from './three.mjs';
import assert from 'node:assert/strict';
import { createLightEffects } from '../editor/static/light-effects-view.js';
import { coronaScale, coronaGlow, CORONA_MAX, CORONA_LOOKS } from '../editor/static/light-effects.js';
import { radialTexture, dotTexture } from '../editor/static/search-view.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const corona = (name, x, size = 1) => ({ name, at: new THREE.Vector3(x, 0, -100), colour: 0xff8000, size });
// Effects with these coronas; wall: the names of the lamps a wall hides (blocked); step(dt): a frame dt seconds later
function rig(list, wall = new Set()) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(75, 16 / 9, 1, 65536), looked = [];
  const fx = createLightEffects(THREE, { renderer: {}, scene, camera,
    blocked: (from, to) => { const c = list.find((x) => x.at === to); looked.push(c.name); return wall.has(c.name); } });
  let t = 0, frame = 0;
  const step = (dt = 1 / 60) => { t += dt; fx.step(t, { lights: [], coronas: list, zone: null, gain: 1, frame: ++frame }); };
  const restart = () => { t = 0; frame = 0; };
  const sprites = () => scene.getObjectByName('Effects: coronas')?.children.filter((s) => s.visible) || [];
  return { fx, camera, step, restart, sprites, looked };
}

test('a corona is the game\'s size on the screen at its DrawScale, over the walls, its lamp\'s colour, nearest first', () => {
  const r = rig([corona('Far', 50, 0.5), corona('Near', 0, 1)]);
  r.step();
  const [near, far] = r.sprites();
  assert.deepEqual([near.position.x, far.position.x], [0, 50]);
  assert.equal(near.material.sizeAttenuation, false);
  assert.equal(near.material.depthTest, false);                // its line of sight says whether it shows, not each pixel
  close(near.scale.x, coronaScale(1, r.camera.projectionMatrix.elements[0]));
  close(far.scale.x, near.scale.x / 2);
  assert.equal(near.material.color.getHex(), 0xff8000);
});

test('a corona\'s picture: its glow as wide inside the square as the game\'s Corona_G (coronaGlow), filtered smoothly', () => {
  const r = rig([corona('Seen', 0)]);
  r.step();
  const map = r.sprites()[0].material.map, { data, width: n } = map.image;
  assert.deepEqual([map.magFilter, map.minFilter], [THREE.LinearFilter, THREE.LinearFilter]);
  const row = Array.from({ length: n }, (_, x) => data[((n / 2) * n + x) * 4 + 3]);           // its middle row's alpha
  const wide = (level) => row.filter((a) => a >= level).length / n;                          // of the square's side
  close(wide(128), 14 / 160, 2 / n);                                                          // measured: 14, 34, 58 px of 160
  close(wide(64), 34 / 160, 2 / n);
  close(wide(32), 58 / 160, 2 / n);
  assert.equal(data[3], 0);                                                                   // its corner
});

// part B2's #7 (B3, 1 Nov 2026): the search view's dot (an icon behind a wall) and the corona's picture come from one
// builder, search-view.js radialTexture; the dot as it was before (32 x 32, (1 - r)^1.5, a DataTexture's own filters)
test('the search view\'s dot and the corona\'s picture are made by one builder (radialTexture), the dot as it was', () => {
  const dot = dotTexture(THREE), n = 32, was = new Uint8Array(n * n * 4), plain = new THREE.DataTexture();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    was.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2)) ** 1.5)], (y * n + x) * 4);
  assert.deepEqual([dot.image.width, dot.image.height, dot.magFilter, dot.minFilter], [n, n, plain.magFilter, plain.minFilter]);
  assert.deepEqual(dot.image.data, was);
  const r = rig([corona('Seen', 0)]);
  r.step();
  const map = r.sprites()[0].material.map, same = radialTexture(THREE, 128, coronaGlow, THREE.LinearFilter);
  assert.deepEqual([map.image.width, map.magFilter, map.minFilter], [128, same.magFilter, same.minFilter]);
  assert.deepEqual(map.image.data, same.image.data);
});

test('a corona comes in while its lamp is in sight and goes in a third of a second when a wall hides it; one hidden stays dark', () => {
  const wall = new Set(['Hidden']), r = rig([corona('Seen', 0), corona('Hidden', 30)], wall);
  const shown = () => r.sprites().map((s) => Math.round(s.material.opacity * 100) / 100);
  r.step(0.1);
  assert.deepEqual(shown(), [0.3, 0]);                           // not dimmed by its lamp: 3 a second whatever its level
  r.step(0.1); r.step(0.1); r.step(0.1);
  assert.deepEqual(shown(), [1, 0]);
  wall.add('Seen');
  r.step(0.1);
  assert.deepEqual(shown(), [0.7, 0]);
  r.step(0.3);
  assert.deepEqual(shown(), [0, 0]);
});

test('CORONA_LOOKS lines of sight a frame, in turn; the CORONA_MAX nearest drawn', () => {
  const list = Array.from({ length: 40 }, (_, i) => corona('L' + i, i * 10)), r = rig(list);
  r.step();
  assert.equal(r.sprites().length, CORONA_MAX);
  assert.ok(r.sprites().every((s) => s.position.x < CORONA_MAX * 10));
  assert.equal(r.looked.length, CORONA_LOOKS);
  for (let i = 1; i < CORONA_MAX / CORONA_LOOKS; i++) r.step();
  assert.equal(new Set(r.looked).size, CORONA_MAX);               // each of them looked at within a few frames
});

test('Effects stopped: no corona left; the next start\'s come in from nothing', () => {
  const r = rig([corona('Seen', 0)]);
  for (let i = 0; i < 30; i++) r.step();
  assert.equal(r.sprites()[0].material.opacity, 1);
  r.fx.stop();
  assert.equal(r.sprites().length, 0);
  r.restart();
  r.step(0.05);
  close(r.sprites()[0].material.opacity, 0.15, 1e-6);
});
