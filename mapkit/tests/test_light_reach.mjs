// How much of a lamp's light a point takes (static/light-reach.js): the falloff, the angle, a spotlight's cone, the
// engine's colour and brightness curve, and Lights here's list (brightest first, the ones a wall hides apart).
import test from 'node:test';
import assert from 'node:assert/strict';
import { lightReach, engineColour, lightHue, lightsHere, LIGHT_EFFECTS, SPOT_LIGHTS, NON_INCIDENCE } from '../editor/static/light-reach.js';

// a white lamp of the dump's 12 numbers at (x, y, z), its reach, effect and cone, facing down
const lamp = (x, y, z, reach = 1000, effect = 0, cone = 0, rgb = [0.5, 0.5, 0.5]) => [x, y, z, ...rgb, reach, effect, 0, 0, -1, cone];

test('the light falls off over its reach and meets the surface at an angle', () => {
  assert.equal(lightReach(lamp(0, 0, 100), 0, 0, 0, 0, 0, 1), 0.9);                 // a floor under it, straight on
  assert.equal(lightReach(lamp(0, 0, 1000), 0, 0, 0, 0, 0, 1), 0);                  // at its reach: nothing
  assert.ok(Math.abs(lightReach(lamp(100, 0, 100), 0, 0, 0, 0, 0, 1) - (1 - Math.SQRT2 / 10) * Math.SQRT1_2) < 1e-9);
  assert.equal(lightReach(lamp(0, 0, -100), 0, 0, 0, 0, 0, 1), 0);                  // behind the surface
  const nonIncidence = LIGHT_EFFECTS.indexOf('LE_NonIncidence');
  assert.equal(lightReach(lamp(100, 0, 0, 1000, nonIncidence), 0, 0, 0, 0, 0, 1), 0.9);   // grazing, at full
});

test('a spotlight lights only inside its cone, softly toward its edge', () => {
  const spot = LIGHT_EFFECTS.indexOf('LE_Spotlight'), staticSpot = LIGHT_EFFECTS.indexOf('LE_StaticSpot');
  assert.deepEqual(SPOT_LIGHTS, [staticSpot, spot]);
  assert.equal(NON_INCIDENCE, LIGHT_EFFECTS.indexOf('LE_NonIncidence'));
  assert.equal(lightReach(lamp(0, 0, 100, 1000, spot, 64), 0, 0, 0, 0, 0, 1), 0.9);              // under it: full
  assert.equal(lightReach(lamp(0, 0, 100, 1000, spot, 64), 300, 0, 0, 0, 0, 1), 0);              // outside the cone
  const edge = lightReach(lamp(0, 0, 100, 1000, staticSpot, 64), 35, 0, 0, 0, 0, 1);            // near the rim (22.5°): dimmer
  assert.ok(edge > 0 && edge < 0.6);
});

test('the colour is the engine\'s: hue, saturation and the brightness curve', () => {
  assert.deepEqual(lightHue(0, 255), [1, 1, 1]);
  assert.deepEqual(lightHue(0, 0), [1, 0, 0]);
  assert.deepEqual(lightHue(170, 0), [0, 0, 1]);
  const dim = engineColour(0, 255, 32)[0], bright = engineColour(0, 255, 255)[0];
  assert.ok(dim > 32 / 255 * 1.5, 'a dim light counts for more than its byte');
  assert.ok(Math.abs(bright - 0.8213) < 1e-4, 'the brightest is not quite full (the curve at 255)');
  assert.equal(engineColour(0, 255, 0)[0], 0);
});

test('Lights here: brightest first, its share of the light there, a hidden lamp apart', () => {
  const lights = [{ id: 'far', L: lamp(0, 0, 800) }, { id: 'near', L: lamp(0, 0, 100) }, { id: 'walled', L: lamp(50, 0, 100) },
    { id: 'away', L: lamp(0, 0, 5000) }];
  const here = lightsHere(lights, [0, 0, 0], [0, 0, 1], (L) => L[0] === 50);
  assert.deepEqual(here.lit.map((r) => r.id), ['near', 'far']);
  assert.deepEqual(here.blocked, ['walled']);
  assert.ok(Math.abs(here.lit[0].share + here.lit[1].share - 1) < 1e-9);
  assert.ok(Math.abs(here.lit[0].light[0] - 2 * 0.5 * 0.9) < 1e-9);       // doubled, as on the surfaces
  assert.deepEqual(lightsHere([], [0, 0, 0], [0, 0, 1], () => false), { lit: [], blocked: [] });
});
