// The ranges of a selected object as drag handles (static/range-handles.js): a light's reach and a sound's radius in
// the engine's bytes (25 x (radius + 1) units), a spotlight's cone, a trigger's cylinder and a collision box's sides,
// each written in the units the game keeps it (the texts the Inspector's fields store), on the grid when it is on,
// with the note the view shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { byteReach, reachByte, coneAngle, angleCone, coneRim, rangeHandles, rangeDrag, seenFrom, ALONG, SPOT_EFFECTS, MIN_RANGE }
  from '../editor/static/range-handles.js';
import { FACES } from '../editor/static/block-handles.js';

const near = (a, b, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${msg}: ${a} vs ${b}`));
const ID = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

test('how a view sees a dot: left out when its line runs toward the eye, a side facing away dimmer', () => {
  const box = { centre: [0, 0, 64], size: [128, 128, 128], axes: ID }, [px, nx, , , pz] = rangeHandles({ ...box, shape: 'box' });
  const down = [0, 0, -1], front = [0, -1, 0];                    // a view looking down (Top), one looking along -Y (Front)
  assert.equal(seenFrom(pz, down), null);                          // the top side's dot runs at a view from above
  assert.deepEqual(seenFrom(pz, front), { dim: false });           // the Front view drags it: square to it
  assert.deepEqual(seenFrom(px, front), { dim: false });           // edge on
  assert.deepEqual(seenFrom(nx, [-Math.cos(1), 0, -Math.sin(1)]), { dim: true });     // down and toward -X: it faces away
  const slant = (d) => [d, 0, -Math.sqrt(1 - d * d)];              // a look that runs at the +X side's line by d
  assert.deepEqual(seenFrom(px, slant(ALONG - 0.01)), { dim: true });
  assert.equal(seenFrom(px, slant(ALONG + 0.01)), null);
  const light = rangeHandles({ shape: 'sphere', centre: [0, 0, 0], size: 100, props: ['LightRadius'] });
  assert.deepEqual(seenFrom(light[0], front), { dim: false });     // only a box's sides are ever dim
});

test("a byte radius reaches 25 x (radius + 1) units, and back to the nearest whole byte, 0 to 255", () => {
  assert.equal(byteReach(64), 1625);
  assert.equal(byteReach(0), 25);
  assert.equal(reachByte(1625), 64);
  assert.equal(reachByte(1640), 65);                  // 64.6: the nearest
  assert.equal(reachByte(3), 0);
  assert.equal(reachByte(1e6), 255);
  for (const v of [0, 1, 12, 200, 255]) assert.equal(reachByte(byteReach(v)), v);
});

test("a cone's byte is its angle from the middle as the editor's lighting has it: 256 a quarter turn", () => {
  assert.equal(coneAngle(128), Math.PI / 4);
  assert.equal(angleCone(Math.PI / 4), 128);
  assert.equal(angleCone(Math.PI), 255);
  assert.equal(angleCone(-1), 0);
  assert.ok(SPOT_EFFECTS.test('LE_Spotlight') && SPOT_EFFECTS.test('LE_StaticSpot') && !SPOT_EFFECTS.test('LE_NonIncidence'));
});

test("a light's sphere: six dots on its reach; a drag writes the whole byte", () => {
  const light = { shape: 'sphere', centre: [100, 0, 50], size: byteReach(12), props: ['LightRadius'], unit: 'byte', fields: { LightRadius: { label: 'Radius', kind: 'byte' } } };
  const hs = rangeHandles(light);
  assert.equal(hs.length, 6);
  near(hs[0].at, [100 + 325, 0, 50], '+X dot');
  const r = rangeDrag(light, hs[0], 500, { step: 16 });     // the grid cannot make a byte finer
  assert.deepEqual(r.props, { LightRadius: '19' });
  assert.equal(r.range.size, 500);
  assert.equal(r.centre, null);
  assert.equal(r.note, 'Radius 19 (500 units)');
  assert.deepEqual(rangeDrag(light, hs[0], -40).props, { LightRadius: '0' });
});

test("a sound effect's sphere is in units: on the grid, or to a tenth, never under the smallest", () => {
  const fx = { shape: 'sphere', centre: [0, 0, 0], size: 1024, props: ['FXRadius'], unit: 'units' };
  const h = rangeHandles(fx)[2];
  assert.deepEqual(rangeDrag(fx, h, 700, { step: 16 }).props, { FXRadius: '704.000000' });
  assert.deepEqual(rangeDrag(fx, h, 700.04).props, { FXRadius: '700.000000' });
  assert.deepEqual(rangeDrag(fx, h, -5).props, { FXRadius: MIN_RANGE.toFixed(6) });
  assert.equal(rangeDrag(fx, h, 700, { step: 16 }).note, 'FXRadius 704 units');
});

test("a trigger's cylinder: four dots on its radius, two on its height; the object stays in the middle", () => {
  const zone = { shape: 'cylinder', centre: [0, 0, 40], radius: 40, height: 40, props: ['CollisionRadius', 'CollisionHeight'], scale: 1,
    fields: { CollisionRadius: { label: 'Radius', kind: 'float' }, CollisionHeight: { label: 'Height', kind: 'float' } } };
  const hs = rangeHandles(zone);
  assert.deepEqual(hs.map((h) => h.part), ['radius', 'radius', 'radius', 'radius', 'height', 'height']);
  near(hs[4].at, [0, 0, 80], 'top');
  assert.deepEqual(rangeDrag(zone, hs[1], 70, { step: 16 }).props, { CollisionRadius: '64.000000' });
  const up = rangeDrag(zone, hs[4], 90);
  assert.deepEqual(up.props, { CollisionHeight: '90.000000' });
  assert.equal(up.range.height, 90);
  assert.equal(up.note, 'Height 90 units');
  // a collision box's cylinder of a scaled object: its props are the sizes divided by the scale, shown as the Inspector does
  const box = { ...zone, scale: 2, props: ['CylinderRadius', 'CylinderHeight'], fields: { CylinderHeight: { label: 'Height', kind: 'half' } } };
  const r = rangeDrag(box, rangeHandles(box)[5], 96, { step: 16 });
  assert.deepEqual(r.props, { CylinderHeight: '48.000000' });
  assert.equal(r.note, 'Height 96 units');                   // the Inspector shows a half size whole
});

test("a spotlight's cone: its tip is the reach, its rim on the reach; a rim dot opens it, in rotation steps on the grid", () => {
  const spot = { shape: 'cone', centre: [0, 0, 0], dir: [1, 0, 0], size: byteReach(39), angle: coneAngle(128), props: ['LightRadius', 'LightCone'] };
  const rim = coneRim(spot);
  near(rim.centre, [1000 * Math.SQRT1_2, 0, 0], 'rim middle');
  assert.ok(Math.abs(rim.radius - 1000 * Math.SQRT1_2) < 1e-6);
  const hs = rangeHandles(spot);
  assert.deepEqual(hs.map((h) => h.part), ['reach', 'cone', 'cone', 'cone', 'cone']);
  near(hs[0].at, [1000, 0, 0], 'tip');
  for (const h of hs.slice(1)) {
    assert.ok(Math.abs(Math.hypot(...h.at) - 1000) < 1e-6, 'a rim dot is on the reach');
    assert.ok(Math.abs(h.dir.reduce((s, v, k) => s + v * h.at[k], 0)) < 1e-6, 'it slides square to the line from the tip');
  }
  assert.deepEqual(rangeDrag(spot, hs[0], 1525).props, { LightRadius: '60' });
  // sliding the rim dot out by the reach opens the cone by 45 degrees (atan 1): from 45 to 90, a byte at most 255
  assert.deepEqual(rangeDrag(spot, hs[1], 1000).props, { LightCone: '255' });
  const narrower = rangeDrag(spot, hs[2], -1000 * Math.tan(Math.PI / 12));     // 15 degrees in: 30 from the middle
  assert.deepEqual(narrower.props, { LightCone: '85' });
  assert.equal(narrower.note, 'LightCone 85 (60° wide)');
  // with the grid on it goes in the rotation step (15 degrees here)
  const stepped = rangeDrag(spot, hs[1], -1000 * Math.tan(Math.PI / 18), { angleStep: 15 });   // 35 degrees -> 30
  assert.deepEqual(stepped.props, { LightCone: '85' });
  assert.equal(stepped.range.angle, coneAngle(85));
  assert.deepEqual(rangeDrag(spot, hs[3], -5000).props, { LightCone: '0' });
});

test("a collision box's sides: one side moves, the object's middle follows, its half sizes written", () => {
  const box = { shape: 'box', centre: [0, 0, 64], size: [128, 64, 128], axes: ID, props: ['BoxX', 'BoxY', 'BoxZ'], scale: 1,
    fields: { BoxX: { label: 'Width', kind: 'half' }, BoxY: { label: 'Depth', kind: 'half' }, BoxZ: { label: 'Height', kind: 'half' } } };
  const hs = rangeHandles(box);
  assert.equal(hs.length, 6);
  const px = hs[FACES.findIndex((f) => f.axis === 0 && f.sign === 1)];
  const r = rangeDrag(box, px, 96, { step: 16 });
  assert.deepEqual(r.props, { BoxX: '80.000000' });                   // only the size that changed
  assert.deepEqual(Object.keys(rangeDrag(box, px, 128, { shift: true }).props), ['BoxX', 'BoxY', 'BoxZ']);
  near(r.centre, [16, 0, 64], 'middle');
  assert.equal(r.note, 'Width 160');
  const alt = rangeDrag(box, px, 96, { step: 16, alt: true });
  near(alt.centre, [0, 0, 64], 'Alt keeps the middle');
  assert.equal(alt.props.BoxX, '96.000000');
  assert.equal(rangeDrag(box, px, 128, { shift: true }).note, 'Width 192 · Depth 96 · Height 192');
  // a block (no props): its sides only
  const block = { shape: 'box', centre: [0, 0, 0], size: [128, 64, 32], axes: ID };
  const b = rangeDrag(block, rangeHandles(block)[0], 100);
  assert.equal(b.props, null);
  assert.deepEqual(b.range.size, [164, 64, 32]);
  assert.equal(b.note, 'Width 164');
});
