// The timing maths of View > Effects (static/light-effects.js), as the game's renderers do it (lights_research.md of
// batch 6, 28 Oct 2026): the light types' curves with LightPeriod and LightPhase in each game (a blink at random that
// ends steady, Revision's dark flicker, the strobe one switch turned every frame), what each game never lights, the
// notes of what a setting does not do, Auto U/V Pan's speed, the zone's view fog, the lamps animated first, the coronas'
// size on the screen, fade and lines of sight.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lightLevel, noise, lampSeed, panRate, zoneView, nearestLights, givesLight, blinkSteadyFrom, lightNotes, coronaScale,
  coronaFade, coronaTurn, coronaGlow, MOVING_LIGHTS, RENDERERS, TICKS, ZONE_PAN, PF_AUTOUPAN, PF_AUTOVPAN, CORONA_SIZE, CORONA_FADE,
  CORONA_LOOKS, NOTE_PROPS }
  from '../editor/static/light-effects.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('a pulse goes round every LightPeriod ticks, LightPhase / 256 of a round later', () => {
  const round = 32 / TICKS;                                    // the default LightPeriod: 32 ticks, 0.91 s
  close(lightLevel('LT_Pulse', 32, 0, 0), 0.6);
  close(lightLevel('LT_Pulse', 32, 0, round / 4), 0.99);      // a quarter round: the top
  close(lightLevel('LT_Pulse', 32, 0, round * 3 / 4), 0.21);  // three quarters: the bottom
  close(lightLevel('LT_Pulse', 32, 64, 0), 0.99);             // a phase of 64: a quarter round ahead
  close(lightLevel('LT_Pulse', 64, 0, round / 4), 0.6 + 0.39 * Math.SQRT1_2);   // twice the period: half as fast
  close(lightLevel('LT_SubtlePulse', 32, 0, round / 4), 0.99);
  close(lightLevel('LT_SubtlePulse', 32, 0, round * 3 / 4), 0.81);
});

// a lamp's levels over n drawn frames from t0 seconds, 60 a second, each up to 4 ms late as a browser's are (frames from
// 1, as View > Effects counts them). At exactly 1/60 s some periods alias into runs (the game's steady frame rate too)
const run = (type, period, phase, t0, { n = 3000, game = 'revision', seed = 7 } = {}) =>
  Array.from({ length: n }, (_, i) => lightLevel(type, period, phase, t0 + i / 60 + noise(i, 9) / 250, { frame: i + 1, seed, game }));
const share = (xs) => xs.filter((v) => v > 0).length / xs.length;

test('a blink keeps no time: on or off at random in about half the frames at any period, LightPhase changes nothing', () => {
  for (const game of ['revision', 'vanilla'])
    for (const period of [30, 32, 255]) {
      const levels = run('LT_Blink', period, 0, 20, { game, n: 600 });          // before any of them stays on
      assert.ok(Math.abs(share(levels) - 0.5) < 0.1, `${game}, period ${period}: on ${share(levels)}`);
      assert.ok(levels.every((v) => v === 0 || v === 1));
      // phase 128: the same frames (measured: Ph0 and Ph128 identical); in 24 bits (the original game) adding LightPhase x
      // 256 can round the sum's last bit where it passes a power of two, a frame in a few hundred
      const same = run('LT_Blink', period, 128, 20, { game, n: 600 }).filter((v, i) => v === levels[i]).length / levels.length;
      assert.ok(game === 'revision' ? same === 1 : same > 0.98, `${game}, period ${period}: phase 128 the same in ${same}`);
    }
  // no square wave of its period: it changes from a frame to the next more often than not; two periods blink apart
  const blink = run('LT_Blink', 30, 0, 36), other = run('LT_Blink', 32, 0, 36);
  assert.ok(blink.slice(1).filter((v, i) => v !== blink[i]).length / (blink.length - 1) > 0.35);
  assert.ok(blink.filter((v, i) => v === other[i]).length / blink.length < 0.7);
});

test('a blink stays on for good once its sum has no fraction: in Revision when LightPeriod + 1 is a power of two, in the original game at any period', () => {
  assert.equal(blinkSteadyFrom(0, 'revision'), 256);           // measured: random at 36-48 s, on in every frame at 293-303 s
  assert.equal(blinkSteadyFrom(7, 'revision'), 2048);
  assert.equal(blinkSteadyFrom(32, 'revision'), null);         // the default period never
  close(blinkSteadyFrom(0, 'vanilla'), 7.314, 1e-3);
  close(blinkSteadyFrom(30, 'vanilla'), 226.743, 1e-3);        // 7.31 x 31 (measured: on in 16 photos of 16 at 260-290 s)
  const on = (xs) => xs.every((v) => v === 1);
  assert.ok(!on(run('LT_Blink', 0, 0, 36)) && on(run('LT_Blink', 0, 0, 300)));
  assert.ok(!on(run('LT_Blink', 32, 0, 300)));
  assert.ok(on(run('LT_Blink', 0, 0, 8, { game: 'vanilla' })));                      // measured: lit in every photo
  assert.ok(!on(run('LT_Blink', 30, 0, 100, { game: 'vanilla' })) && on(run('LT_Blink', 30, 0, 230, { game: 'vanilla' })));
  assert.ok(!on(run('LT_Blink', 255, 0, 280, { game: 'vanilla' })));                 // measured: still at random then
});

test('a flicker: Revision never lights it; the original game: off about half the frames, else half to all of it, a new value each frame, lamps of one table entry together', () => {
  for (const [period, phase] of [[32, 0], [0, 0], [255, 255]]) assert.ok(run('LT_Flicker', period, phase, 5).every((v) => v === 0));
  const flicker = run('LT_Flicker', 32, 0, 5, { game: 'vanilla' });
  assert.ok(Math.abs(share(flicker) - 0.5) < 0.05);                                  // measured: lit in 45 % of the captures
  assert.ok(flicker.every((v) => v === 0 || (v >= 0.5 && v < 1)));                    // measured: lit 0.51 to 1 of the top
  assert.deepEqual(run('LT_Flicker', 32, 0, 5, { game: 'vanilla' }), flicker);         // the same frames: the same
  assert.deepEqual(run('LT_Flicker', 0, 99, 5, { game: 'vanilla', seed: 7 + 256 }), flicker);   // one entry of 256: together
  assert.notDeepEqual(run('LT_Flicker', 32, 0, 5, { game: 'vanilla', seed: 8 }), flicker);
  const frames = Array.from({ length: 50 }, (_, i) => lightLevel('LT_Flicker', 32, 0, 1, { frame: i + 1, seed: 3, game: 'vanilla' }));
  assert.ok(new Set(frames).size > 10);                                               // a new value each drawn frame, same t
  assert.ok(noise(1, 2) >= 0 && noise(1, 2) < 1);
  assert.equal(lampSeed('Light12'), lampSeed('Light12'));          // a lamp's own, the same each time
  assert.notEqual(lampSeed('Light12'), lampSeed('Light13'));
});

test('a strobe: one switch for every strobe lamp of the map, turned every drawn frame; LightPeriod and LightPhase do nothing', () => {
  const strobe = run('LT_Strobe', 32, 0, 5, { n: 8 });
  assert.deepEqual(strobe, [0, 1, 0, 1, 0, 1, 0, 1]);
  for (const game of ['revision', 'vanilla'])         // measured: P32 Ph0 and P200 Ph100 identical in every capture
    assert.deepEqual(run('LT_Strobe', 200, 100, 9.3, { n: 8, game, seed: 99 }), strobe);
});

test('steady types and the palette ones stay at their light; LT_None gives none, nor LT_Flicker in Revision', () => {
  for (const type of ['LT_Steady', 'LT_BackdropLight', 'LT_TexturePaletteOnce', 'LT_TexturePaletteLoop', undefined])
    for (const t of [0, 0.3, 7]) for (const game of ['revision', 'vanilla']) assert.equal(lightLevel(type, 32, 0, t, { game }), 1);
  assert.equal(lightLevel('LT_None', 32, 0, 1), 0);
  assert.deepEqual([...MOVING_LIGHTS].sort(), ['LT_Blink', 'LT_Flicker', 'LT_Pulse', 'LT_Strobe', 'LT_SubtlePulse']);
  assert.deepEqual(Object.keys(RENDERERS).sort(), ['revision', 'vanilla']);
  assert.deepEqual([givesLight('LT_Flicker', 'revision'), givesLight('LT_Flicker', 'vanilla')], [false, true]);
  assert.deepEqual([givesLight('LT_None', 'vanilla'), givesLight('LT_Blink', 'revision')], [false, true]);
  assert.equal(givesLight('LT_Flicker', undefined), false);      // a project that names no game: Revision's (projects.js)
});

test('a palette lamp whose Skin is Revision\'s Effects.Corona.Corona_G gives no light there (measured), however the Skin is written', () => {
  for (const skin of ["Texture'Effects.Corona.Corona_G'", 'effects.corona.CORONA_G'])
    for (const type of ['LT_TexturePaletteOnce', 'LT_TexturePaletteLoop']) {
      assert.deepEqual([givesLight(type, 'revision', skin), givesLight(type, 'vanilla', skin)], [false, true]);
      assert.deepEqual([lightLevel(type, 32, 0, 1, { game: 'revision', skin }), lightLevel(type, 32, 0, 1, { game: 'vanilla', skin })], [0, 1]);
    }
  // another Skin, or another type with that Skin: as before
  assert.equal(givesLight('LT_TexturePaletteLoop', 'revision', "Texture'Effects.Corona.Corona_E'"), true);
  assert.equal(givesLight('LT_Steady', 'revision', "Texture'Effects.Corona.Corona_G'"), true);
  assert.deepEqual(RENDERERS.revision.darkPalette, ['effects.corona.corona_g']);
});

test('the notes: what a lamp\'s settings do not do in each game, under the property they are about', () => {
  const notes = (lamp, game) => lightNotes({ period: 32, corona: false, skin: '', ...lamp }, game);
  const props = (list) => list.map((n) => n.prop);
  assert.deepEqual(notes({ type: 'LT_Steady' }, 'revision'), []);
  assert.deepEqual(notes({ type: 'LT_Pulse', period: 0 }, 'vanilla'), []);
  // a flickering lamp: dark in Revision (and nothing about its period or phase then), at random in the original game
  assert.deepEqual(props(notes({ type: 'LT_Flicker' }, 'revision')), ['LightType']);
  assert.match(notes({ type: 'LT_Flicker' }, 'revision')[0].text, /^Revision never lights a flickering lamp.*use LT_Blink/);
  assert.deepEqual(props(notes({ type: 'LT_Flicker' }, 'vanilla')), ['LightPeriod', 'LightPhase']);
  // a blinking lamp: at random, its phase nothing; when it stays on, in each game
  assert.deepEqual(props(notes({ type: 'LT_Blink' }, 'revision')), ['LightType', 'LightPhase']);      // 32: never on for good
  const period = (lamp, game) => notes(lamp, game).find((n) => n.prop === 'LightPeriod').text;
  assert.match(period({ type: 'LT_Blink', period: 0 }, 'revision'), /stays on after 256 s of the map/);
  assert.match(period({ type: 'LT_Blink', period: 7 }, 'revision'), /stays on after 34 min of the map/);
  assert.match(period({ type: 'LT_Blink' }, 'vanilla'), /stays on after 241 s of the map \(in the original game every blinking lamp does/);
  // a strobe: all together; palette types: steady without a Skin, with one its palette (in Revision Corona_G dark, the
  // only one measured)
  assert.match(notes({ type: 'LT_Strobe' }, 'vanilla')[0].text, /^Every strobe lamp of the map switches together/);
  assert.deepEqual(props(notes({ type: 'LT_Strobe' }, 'revision')), ['LightType', 'LightPeriod', 'LightPhase']);
  assert.match(notes({ type: 'LT_TexturePaletteLoop' }, 'revision')[0].text, /^Without a Skin this lamp is steady/);
  // a Skin the editor lights (Corona_E, or one not of Effects): its note says what was measured, not that it gives no light
  for (const skin of ['Effects.Corona.Corona_E', 'CoreTexMetal.Metal_A']) {
    const lit = notes({ type: 'LT_TexturePaletteLoop', skin }, 'revision')[0].text;
    assert.doesNotMatch(lit, /no light/, skin);
    assert.match(lit, /^Its colour and level come from its Skin's palette.*; in Revision only Effects\.Corona\.Corona_G was measured \(dark\), this Skin was not\.$/);
  }
  // Corona_G itself: dark in Revision, as the editor shows it (and nothing about a Phase of a lamp that gives no light)
  const dark = notes({ type: 'LT_TexturePaletteLoop', skin: "Texture'Effects.Corona.Corona_G'" }, 'revision');
  assert.deepEqual(props(dark), ['LightType']);
  assert.match(dark[0].text, /^Revision gives a palette lamp with this Skin no light \(measured\): it is dark here too/);
  assert.doesNotMatch(notes({ type: 'LT_TexturePaletteLoop', skin: 'Effects.Corona.Corona_G' }, 'vanilla')[0].text, /Revision/);
  assert.deepEqual(props(notes({ type: 'LT_TexturePaletteLoop' }, 'vanilla')), ['LightType', 'LightPhase']);    // its Period sweeps
  // a corona needs a Skin
  assert.deepEqual(props(notes({ type: 'LT_Steady', corona: true }, 'vanilla')), ['bCorona']);
  assert.match(notes({ type: 'LT_Steady', corona: true }, 'revision')[0].text, /^No corona in the game without a Skin/);
  assert.deepEqual(notes({ type: 'LT_Steady', corona: true, skin: 'Effects.Corona.Corona_G' }, 'revision'), []);
  // the properties the notes are about, where the Properties keep a box for them
  assert.deepEqual(NOTE_PROPS, ['LightType', 'LightPeriod', 'LightPhase', 'bCorona']);
});

test('a corona\'s glow inside its square is as big as Corona_G\'s in the game: 128, 64 and 32 of 255 over 14, 34 and 58 px of 160', () => {
  // lights_research.md run 2: UCEdit17, DrawScale 0.5, a 160 px square on a 1600 px picture, its profile through the middle
  for (const [px, level] of [[14, 128], [34, 64], [58, 32]]) assert.equal(Math.round(255 * coronaGlow(px / 2 / 80)), level);
  assert.deepEqual([coronaGlow(0), coronaGlow(0.5), coronaGlow(0.8)], [1, 0, 0]);          // nothing in the square's corners
  for (let r = 0; r < 0.5; r += 0.01) assert.ok(coronaGlow(r) > coronaGlow(r + 0.01));      // dimmer outwards
});

test('a corona: a fifth of the view\'s width times its DrawScale on the screen at any distance, coming and going in a third of a second, its lines of sight looked along a few a frame', () => {
  // three's sprite with sizeAttenuation off (sprite_vert.glsl): a corner (scale / 2) x -z beside the centre in the
  // camera's space, then the projection (x scale p00, three's makePerspective for a 75 degree view of 1600 x 900)
  const W = 1600, p00 = 1 / ((1600 / 900) * Math.tan(75 * Math.PI / 360));
  for (const [size, z] of [[1, -340], [1, -990], [0.5, -775]]) {         // measured: the same pixels at 340 to 1040 units
    const corner = (coronaScale(size, p00) / 2) * -z, ndc = (p00 * corner) / -z;
    close(ndc * W, CORONA_SIZE * W * size, 1e-9);                         // its side: twice ndc, of half the width
  }
  assert.equal(coronaFade(0, true, 1 / 3), 1);
  close(coronaFade(1, false, 1 / 6), 0.5);
  assert.deepEqual([coronaFade(0.2, false, 1), coronaFade(0.9, true, 1)], [0, 1]);
  assert.equal(CORONA_FADE, 3);
  assert.deepEqual([coronaTurn(0, 5), coronaTurn(2, 5)], [[], [0, 1]]);
  assert.equal(coronaTurn(10, 1).length, CORONA_LOOKS);
  const looked = new Set();
  for (let frame = 1; frame <= Math.ceil(10 / CORONA_LOOKS); frame++) for (const i of coronaTurn(10, frame)) looked.add(i);
  assert.equal(looked.size, 10);                                          // each looked at within a few frames
});

test('Auto U / V Pan: the zone\'s texels a second over the texture\'s size, on the axes flagged', () => {
  assert.deepEqual(panRate(PF_AUTOUPAN, ZONE_PAN, [64, 128]), [35 / 64, 0]);
  assert.deepEqual(panRate(PF_AUTOVPAN, [70, 17.5], [64, 128]), [0, 17.5 / 128]);
  assert.deepEqual(panRate(PF_AUTOUPAN | PF_AUTOVPAN, [0, 35], [64, 64]), [0, 35 / 64]);
  assert.deepEqual(panRate(0, ZONE_PAN, [64, 64]), [0, 0]);
});

test('the zone\'s view: scale with ViewFlash, fog with ViewFog, the game\'s thresholds, a haze to FogDistance', () => {
  assert.equal(zoneView(null), null);
  assert.equal(zoneView({ viewFog: [0, 0.01, 0], viewFlash: [-0.01, 0, 0], fogDistance: 0 }), null);   // under the thresholds
  assert.deepEqual(zoneView({ viewFog: [0, 0.05, 0.1], viewFlash: [0, 0, 0] }), { scale: 1, fog: [0, 0.05, 0.1], haze: null });
  assert.deepEqual(zoneView({ viewFog: [0, 0, 0], viewFlash: [-0.4, 0, 0] }).scale, 0.6);
  assert.deepEqual(zoneView({ viewFog: [0, 0, 0], viewFlash: [0, 0, 0], fogColour: [255, 0, 51], fogDistance: 2000 }).haze,
    { colour: [1, 0, 0.2], distance: 2000 });
});

test('the lamps animated first are those whose reach is nearest', () => {
  const at = (x, reach) => ({ L: [x, 0, 0, 1, 1, 1, reach, 0, 0, 0, -1, 0], x });
  const lights = [at(5000, 100), at(3000, 2900), at(200, 50), at(-900, 100)];
  assert.deepEqual(nearestLights(lights, [0, 0, 0], 3).map((l) => l.x), [3000, 200, -900]);
  assert.deepEqual(nearestLights(lights, [0, 0, 0], 10).length, 4);
});

// the guide of a working copy (docs/tutorials, where editor/guide.py reads it), none beside an installed editor's tests
const GUIDE = new URL('../../../docs/tutorials/07-map-editor.md', import.meta.url);
test('the guide gives a pulse\'s and a subtle pulse\'s range as lightLevel makes them', {
  skip: !fs.existsSync(GUIDE) && 'no working copy\'s guide beside this editor (docs/tutorials/07-map-editor.md)' }, () => {
  const text = fs.readFileSync(GUIDE, 'utf8').replace(/\s+/g, ' ');
  const range = (type) => {               // a whole round of the default period, in percent of the lamp
    const levels = Array.from({ length: 1000 }, (_, i) => lightLevel(type, 32, 0, (i / 1000) * 32 / TICKS));
    return [Math.round(Math.min(...levels) * 100), Math.round(Math.max(...levels) * 100)];
  };
  const [lo, hi] = range('LT_Pulse'), [subtleLo, subtleHi] = range('LT_SubtlePulse');
  assert.deepEqual([lo, hi, subtleLo, subtleHi], [21, 99, 81, 99]);
  assert.ok(text.includes(`a pulse goes from ${lo} to ${hi}% of the lamp`), 'the pulse');
  assert.ok(text.includes(`a subtle pulse from ${subtleLo} to ${subtleHi}%`), 'the subtle pulse');
});
