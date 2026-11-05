// Particles of any colour (editor/static/particle-colour.js) and over an area (particles.js, UCParticles' FxArea).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, lookOf, colourOf, baseName, existingTexture, normalHex, tintPixels, fallbackPixels } from '../editor/static/particle-colour.js';
import { PARTICLE_FIELDS, createSimulation, stepSimulation, particleSettings, fieldsOf } from '../editor/static/particles.js';

test("a colour's texture: its look and colour from its name, its name from them", () => {
  assert.deepEqual(colourOf("Texture'MyLevel.Imported.UCT_Puff_ff3020_1'"), { look: 'puff', hex: '#ff3020' });
  assert.deepEqual(colourOf('MyLevel.Imported.UCT_Spark_00FF80_12'), { look: 'spark', hex: '#00ff80' });
  assert.equal(colourOf("Texture'Effects.Smoke.SmokePuff1'"), null);
  assert.equal(colourOf('MyLevel.Imported.UCT_TrafficLightTex1_1'), null, "a picture of the user's is not a colour");
  assert.equal(baseName('puff', '#FF3020'), 'Puff_ff3020');
  assert.equal(baseName('spark', 'abc'), 'Spark_aabbcc');
  assert.equal(normalHex('nonsense'), '#ffffff');
  assert.equal(existingTexture(['UCT_Puff_ff3020_2', 'UCT_Spark_ff3020_1'], 'puff', '#ff3020'), 'UCT_Puff_ff3020_2');
  assert.equal(existingTexture(['UCT_Puff_ff3020_2'], 'spark', '#ff3020'), '');
});

test('the look of a texture: sparks and glows are dots, the rest puffs', () => {
  assert.equal(lookOf("Texture'Effects.Fire.SparkFX1'"), 'spark');
  assert.equal(lookOf("Texture'Effects.Corona.Corona_A'"), 'spark');
  assert.equal(lookOf("Texture'Effects.Smoke.SmokePuff1'"), 'puff');
  assert.equal(lookOf("Texture'Effects.Smoke.Gas_Poison'"), 'puff');
  assert.equal(lookOf('MyLevel.Imported.UCT_Spark_ff0000_1'), 'spark', 'a colour keeps its look');
  for (const k of Object.keys(LOOKS)) assert.match(LOOKS[k].back, /^Effects\./);
});

test('the picture in a colour: its light turned into the colour, the brightest pixel at the peak, opaque', () => {
  const src = new Uint8ClampedArray([0, 0, 0, 255, 13, 13, 13, 255, 26, 20, 10, 255, 26, 26, 26, 0]);
  const out = tintPixels(src, '#ff8000', 0.5);
  assert.deepEqual([...out.slice(0, 4)], [0, 0, 0, 255], 'black stays see-through (the game adds light)');
  assert.deepEqual([...out.slice(4, 8)], [64, 32, 0, 255]);
  assert.deepEqual([...out.slice(8, 12)], [128, 64, 0, 255]);
  assert.equal(out[15], 255, 'every pixel opaque: not a masked texture');
  const blank = tintPixels(new Uint8ClampedArray(8), '#ffffff', 1);
  assert.deepEqual([...blank], [0, 0, 0, 255, 0, 0, 0, 255]);
});

test('with no picture of the game: a soft puff and a dot, bright in the middle, black at the corners', () => {
  for (const look of ['puff', 'spark']) {
    const size = LOOKS[look].size, px = fallbackPixels(look);
    assert.equal(px.length, size * size * 4);
    const at = (x, y) => px[(y * size + x) * 4];
    assert.ok(at(size >> 1, size >> 1) > 200, look);
    assert.equal(at(0, 0), 0, look);
  }
});

test('over an area: the particles start on the disc round it, across the arrow', () => {
  assert.ok(fieldsOf(null, 'UCParticles').some((f) => f.key === 'FxArea'));
  assert.ok(!fieldsOf(null, 'ParticleGenerator').some((f) => f.key === 'FxArea'), "not the game's generator's");
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const s = particleSettings(() => undefined);
  Object.assign(s, { frequency: 1, checkTime: 0.1, numPerSpawn: 4, ejectSpeed: 0, riseRate: 0, particleLifeSpan: 10, FxArea: 160 });
  const sim = createSimulation(rand);
  const list = stepSimulation(sim, s, 1.0);
  assert.ok(list.length >= 30);
  for (const q of list) {
    assert.equal(q.p[0], 0, 'across the arrow');
    assert.ok(Math.hypot(q.p[1], q.p[2]) <= 160 + 1e-9);
  }
  assert.ok(list.some((q) => Math.hypot(q.p[1], q.p[2]) > 80), 'spread over it');
  const point = stepSimulation(createSimulation(rand), Object.assign({}, s, { FxArea: 0 }), 1.0);
  assert.ok(point.every((q) => q.p.every((c) => c === 0)), 'no area: all from its point');
  assert.equal(PARTICLE_FIELDS.find((f) => f.key === 'FxArea').own, 'UCParticles');
});
