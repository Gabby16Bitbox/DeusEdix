// Particles (static/particles.js): the settings as the map writes them, the class's defaults from the game, the
// simulation of the preview (the game's generator: every checkTime, by frequency, numPerSpawn thrown along the arrow).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isParticleClass, PARTICLE_FIELDS, parseValue, formatValue, clampValue, defaultsFrom, fieldsOf, particleSettings,
  createSimulation, stepSimulation, particleLook, MAX_PARTICLES } from '../editor/static/particles.js';

const field = (key) => PARTICLE_FIELDS.find((f) => f.key === key);

test('the classes drawn as particles', () => {
  assert.ok(isParticleClass('ParticleGenerator') && isParticleClass('DeusEx.ParticleGenerator') && isParticleClass('UCParticles'));
  assert.ok(!isParticleClass('UCEffectPoint') && !isParticleClass('AmbientSound'));
});

test('values as the map writes them, both ways', () => {
  assert.equal(parseValue(field('riseRate'), '-4.000000'), -4);
  assert.equal(parseValue(field('numPerSpawn'), '6'), 6);
  assert.equal(parseValue(field('bGravity'), 'True'), true);
  assert.equal(parseValue(field('bGravity'), 'False'), false);
  assert.equal(parseValue(field('particleTexture'), "Texture'Effects.Smoke.SmokePuff1'"), 'Effects.Smoke.SmokePuff1');
  assert.equal(parseValue(field('particleTexture'), 'None'), '');
  assert.equal(parseValue(field('riseRate'), 'abc'), undefined);
  assert.equal(formatValue(field('riseRate'), -4), '-4.000000');
  assert.equal(formatValue(field('numPerSpawn'), 6.4), '6');
  assert.equal(formatValue(field('bFade'), true), 'True');
  assert.equal(formatValue(field('particleTexture'), 'Effects.Fire.SparkFX1'), "Texture'Effects.Fire.SparkFX1'");
  assert.equal(clampValue(field('frequency'), 3), 1);
  assert.equal(clampValue(field('numPerSpawn'), 0), 1);
  assert.equal(clampValue(field('ejectSpeed'), 'x'), null);
});

test('the class as the game says it: its defaults and the settings it has', () => {
  const props = { props: [{ name: 'riseRate', index: 0, default: '12.000000' }, { name: 'bGravity', index: 0, default: 'True' },
    { name: 'particleTexture', index: 0, default: "Texture'Effects.Smoke.SmokePuff1'" }, { name: 'DrawScale', index: 0, default: '1.0' }] };
  assert.deepEqual(defaultsFrom(props), { riseRate: 12, bGravity: true, particleTexture: 'Effects.Smoke.SmokePuff1' });
  assert.deepEqual(fieldsOf(props).map((f) => f.key), ['particleTexture', 'riseRate', 'bGravity']);
  assert.equal(fieldsOf(null), PARTICLE_FIELDS, 'not read yet: every setting');
  // the map's value, else the class's, else the fallback
  const s = particleSettings((k) => ({ ejectSpeed: '70.000000' })[k], defaultsFrom(props));
  assert.equal(s.ejectSpeed, 70);
  assert.equal(s.riseRate, 12);
  assert.equal(s.particleLifeSpan, field('particleLifeSpan').def);
});

// a random number source that gives these, again and again
const fixed = (...values) => { let i = 0; return () => values[i++ % values.length]; };
const SETTINGS = (over = {}) => ({ ...particleSettings(() => undefined), frequency: 1, checkTime: 0.1, numPerSpawn: 2, ejectSpeed: 100,
  riseRate: 0, particleLifeSpan: 1, bRandomEject: false, bGravity: false, ...over });

test('a puff every checkTime, numPerSpawn each, thrown along the arrow', () => {
  const sim = createSimulation(fixed(0.5)), s = SETTINGS();
  let list = stepSimulation(sim, s, 0.05);
  assert.equal(list.length, 0, 'no check yet');
  list = stepSimulation(sim, s, 0.05);
  assert.equal(list.length, 2);
  list = stepSimulation(sim, s, 0.1);
  assert.equal(list.length, 4);
  assert.ok(list[0].p[0] > 0 && Math.abs(list[0].p[1]) < 1e-9 && Math.abs(list[0].p[2]) < 1e-9, 'along +X');
});

test('frequency is the chance of a puff', () => {
  const never = createSimulation(fixed(0.9));
  assert.equal(stepSimulation(never, SETTINGS({ frequency: 0.5 }), 1).length, 0);
  const always = createSimulation(fixed(0.1));
  assert.equal(stepSimulation(always, SETTINGS({ frequency: 0.5 }), 0.1).length, 2);
});

test('they rise, fall with gravity, and go when their life is over', () => {
  const up = [0, 0, 1];
  const rising = createSimulation(fixed(0.5));
  stepSimulation(rising, SETTINGS({ ejectSpeed: 0, riseRate: 50 }), 0.1, up);
  const [r] = stepSimulation(rising, SETTINGS({ ejectSpeed: 0, riseRate: 50, frequency: 0 }), 0.5, up);
  assert.ok(Math.abs(r.p[2] - 25) < 1e-6, 'riseRate units a second, up');
  const falling = createSimulation(fixed(0.5));
  stepSimulation(falling, SETTINGS({ ejectSpeed: 0, bGravity: true }), 0.1, up);
  const [f] = stepSimulation(falling, SETTINGS({ ejectSpeed: 0, bGravity: true, frequency: 0 }), 0.2, up);
  assert.ok(f.p[2] < -10 && f.v[2] < 0, 'pulled down');
  const short = createSimulation(fixed(0.5));
  stepSimulation(short, SETTINGS({ particleLifeSpan: 0.3 }), 0.1);
  assert.equal(stepSimulation(short, SETTINGS({ particleLifeSpan: 0.3, frequency: 0 }), 0.35).length, 0);
});

test('spread out: around the arrow, never backwards', () => {
  const sim = createSimulation(Math.random), s = SETTINGS({ bRandomEject: true, numPerSpawn: 50 });
  const list = stepSimulation(sim, s, 0.1);
  assert.ok(list.length === 50 && list.every((q) => q.v[0] > 0));
  assert.ok(list.some((q) => Math.abs(q.v[1]) > 10), 'some go sideways');
});

test('a setting typed too big never chokes the view', () => {
  const sim = createSimulation(fixed(0.1));
  const list = stepSimulation(sim, SETTINGS({ numPerSpawn: 50, checkTime: 0.01, particleLifeSpan: 60 }), 5);
  assert.ok(list.length <= MAX_PARTICLES);
});

test('grow and fade over their life', () => {
  const s = SETTINGS({ bScale: true, bFade: true });
  assert.equal(particleLook(s, { age: 0, life: 1 }).scale, 1);
  assert.ok(particleLook(s, { age: 0.9, life: 1 }).scale > 2.5);
  assert.ok(particleLook(s, { age: 0.95, life: 1 }).alpha < 0.1);
  assert.equal(particleLook(SETTINGS({ bScale: false, bFade: false }), { age: 0.9, life: 1 }).alpha, 1);
});
