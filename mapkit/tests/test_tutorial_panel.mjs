import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../editor/static/tutorial-panel.js', import.meta.url), 'utf8');
const { clampTutorialPosition: clamp, chooseTutorialPosition: choose } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const view = { width: 1200, height: 800 }, size = { width: 380, height: 360 };
const intersects = (p, s, r) => p.left < r.right && p.left + s.width > r.left && p.top < r.bottom && p.top + s.height > r.top;

assert.deepEqual(clamp({ left: -300, top: 900 }, size, view), { left: 8, top: 432 });
assert.deepEqual(clamp({ left: 600, top: 500 }, size, { width: 320, height: 240 }), { left: 8, top: 8 });
const manual = { left: 490, top: 90 };
assert.deepEqual(choose(manual, size, view, [{ left: 8, top: 10, right: 100, bottom: 40 }]), manual, 'An unobstructed user position must stay put');

const control = { left: 740, top: 130, right: 830, bottom: 154 };
const relocated = choose(manual, size, view, [control]);
assert.equal(intersects(relocated, size, control), false, 'A panel covering a control must move away');
assert.deepEqual(choose(relocated, size, view, [control]), relocated, 'Repeated frames must not shuffle a safe position');
const crowded = [{ left: 0, top: 0, right: 1200, bottom: 800 }];
assert.deepEqual(choose(manual, size, view, crowded), manual, 'Do not move if every position is equally obstructed');

const world = { left: 400, top: 80, right: 1100, bottom: 600 };
const jointly = choose(manual, size, view, [world, { left: 8, top: 8, right: 180, bottom: 220 }]);
assert.equal(intersects(jointly, size, world), false, 'Consider the world cue and the control together');
assert.equal(intersects(jointly, size, { left: 8, top: 8, right: 180, bottom: 220 }), false);
const small = { width: 260, height: 42 };
const minimized = choose({ left: 490, top: 90 }, small, view, [{ left: 500, top: 100, right: 700, bottom: 140 }]);
assert.equal(intersects(minimized, small, { left: 500, top: 100, right: 700, bottom: 140 }), false, 'The minimized header also avoids its target');
assert.deepEqual(choose(manual, size, view, [{ left: NaN, top: 0, right: 10, bottom: 20 }, { left: 1400, top: 0, right: 1500, bottom: 30 }]), manual);

// Clamping after restore, content-height growth and a smaller window keeps the header reachable.
for (const bounds of [{ width: 900, height: 600 }, { width: 640, height: 480 }]) {
  const moved = choose({ left: 1000, top: 700 }, size, bounds, []);
  assert.ok(moved.left >= 8 && moved.top >= 8);
  assert.ok(moved.left + size.width <= bounds.width - 8);
  assert.ok(moved.top + size.height <= bounds.height - 8);
}
console.log('Tutorial panel placement: 9 scenarios passed');
