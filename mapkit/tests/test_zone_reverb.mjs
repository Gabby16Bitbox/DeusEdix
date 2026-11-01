// A zone's Reverb row (static/zone-reverb.js): each preset sets UE1's ZoneInfo reverb in full (bReverbZone, MasterGain,
// CutoffHz, the six Delay and Gain), Revision's OpenAL preset with it where the class has one (and there no Gain: that
// class's Gain is OpenAL's float), None only turns the echo off, and a zone's values are found again as their preset,
// else Custom. A class whose own OpenAL reverb is not RP_None (a water zone's RP_Underwater) keeps it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { REVERB_PRESETS, REVERB_LEVELS, DELAYS, GAINS, ECHOES, EFX, presetProps, presetOf, reverbValue } from '../editor/static/zone-reverb.js';

// a zone's values as the Properties read them (the class's own where it sets nothing: ZoneInfo's defaults)
const CLASS = { bReverbZone: 'False', MasterGain: '100', CutoffHz: '6000', 'Delay(0)': '20', 'Delay(1)': '34', 'Gain(0)': '150', 'Gain(1)': '70',
  ReverbPreset: 'RP_None' };
const zone = (own = {}) => (key) => own[key] ?? CLASS[key] ?? (/^(Delay|Gain)\(/.test(key) ? '0' : undefined);

test('the presets: None, Small room, Office, Hall, Tunnel / Sewer, Hangar, Cave, each with six echoes in bytes', () => {
  assert.deepEqual(REVERB_PRESETS.map((p) => p.label), ['None', 'Small room', 'Office', 'Hall', 'Tunnel / Sewer', 'Hangar', 'Cave']);
  assert.deepEqual(DELAYS, ['Delay(0)', 'Delay(1)', 'Delay(2)', 'Delay(3)', 'Delay(4)', 'Delay(5)']);
  assert.equal(GAINS.length, ECHOES);
  for (const p of REVERB_PRESETS.filter((x) => x.on)) {
    assert.equal(p.delay.length, ECHOES); assert.equal(p.gain.length, ECHOES);
    for (const v of [p.master, ...p.delay, ...p.gain]) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${p.id}: ${v}`);
    const used = p.delay.filter((d) => d > 0);
    assert.deepEqual(used, [...used].sort((a, b) => a - b), `${p.id}: the echoes in their order`);
    assert.ok(p.cutoff > 0 && p.cutoff <= REVERB_LEVELS.find(([k]) => k === 'CutoffHz')[3]);
    assert.match(p.efx, /^RP_\w+$/);
  }
  // the game's own big rooms (NSF headquarters, the MJ12 lab): Hall is theirs
  const hall = REVERB_PRESETS.find((p) => p.id === 'hall');
  assert.deepEqual([hall.delay, hall.gain], [[50, 75, 100, 125, 150, 200], [100, 60, 50, 40, 30, 20]]);
});

test('a preset gives a zone every reverb value; Revision\'s OpenAL preset only where the class has it', () => {
  const cave = presetProps('cave', false);
  assert.deepEqual(Object.keys(cave), ['bReverbZone', 'MasterGain', 'CutoffHz', ...DELAYS.flatMap((d, i) => [d, GAINS[i]])]);
  assert.equal(cave.bReverbZone, 'True');
  assert.equal(cave['Delay(5)'], '250');
  assert.equal(cave.CutoffHz, '2000');
  assert.equal(presetProps('cave', true)[EFX], 'RP_Cave');
  assert.equal(presetProps('tunnel', true)[EFX], 'RP_SewerPipe');
  assert.deepEqual(presetProps('none', false), { bReverbZone: 'False' });             // the numbers stay as they are
  assert.deepEqual(presetProps('none', true), { bReverbZone: 'False', ReverbPreset: 'RP_None' });
});

test('a zone whose class has the OpenAL reverb gets no echo gains: its Gain is OpenAL\'s float, which hides them', () => {
  // RevZoneInfo.uc: `var(ZoneAudio) float Gain` (0-1, the class 0.32). The Hangar preset's Gain(0) 120 became
  // Gain=120.000000 in the map and Gain(1)..Gain(5) were lost (B6 in the game, build_report.txt, 28 Oct 2026)
  for (const p of REVERB_PRESETS) {
    assert.deepEqual(Object.keys(presetProps(p.id, true)).filter((k) => /^Gain(\(|$)/.test(k)), [], p.id);
    assert.equal(presetProps(p.id, true)[EFX], p.efx);
  }
  const hangar = presetProps('hangar', true);
  assert.deepEqual(Object.keys(hangar), ['bReverbZone', 'MasterGain', 'CutoffHz', ...DELAYS, EFX]);
  assert.deepEqual(DELAYS.map((d) => hangar[d]), ['60', '100', '140', '180', '220', '255']);
  assert.deepEqual([hangar.MasterGain, hangar.CutoffHz, hangar.bReverbZone], ['120', '7000', 'True']);
  // a zone without it (the original game's, Revision's plain ZoneInfo): the six gains as before
  assert.deepEqual(GAINS.map((g) => presetProps('hangar', false)[g]), ['120', '95', '75', '55', '40', '25']);
  // found again as its preset, whatever its gains (the class's, or the ones an older editor wrote there: the builds
  // leave those out, editor/props.py commands)
  assert.equal(presetOf(zone(hangar), true), 'hangar');
  assert.equal(presetOf(zone({ ...hangar, 'Gain(0)': '120', 'Gain(3)': '55' }), true), 'hangar');
});

test('a water zone keeps its own OpenAL reverb: as it comes it is None, None puts it back, the presets leave it', () => {
  // Revision's WaterZone.uc: ReverbPreset=RP_Underwater, which its QueryEffects gives OpenAL whether its echo is on or
  // not. A stock one read Custom (Values open by itself), and None wrote RP_None over it (28 Oct 2026)
  const OWN = 'RP_Underwater';
  const water = (own = {}) => zone({ ReverbPreset: OWN, ...own });
  assert.equal(presetOf(water(), OWN), 'none');
  assert.deepEqual(presetProps('none', OWN), { bReverbZone: 'False', ReverbPreset: OWN });
  assert.equal(presetOf(water({ ReverbPreset: 'RP_Cave' }), OWN), 'custom');      // a hand change shows, None undoes it
  for (const p of REVERB_PRESETS.filter((x) => x.on)) {
    const props = presetProps(p.id, OWN);
    assert.equal(props[EFX], undefined, `${p.id} leaves the class's ${OWN}`);
    assert.deepEqual(Object.keys(props).filter((k) => /^Gain(\(|$)/.test(k)), [], p.id);   // and no echo gains either
    assert.equal(presetOf(water(props), OWN), p.id);
  }
  // a class whose own is RP_None (RevZoneInfo, RevSoundZone, rain and snow zones): as true, the preset's own
  for (const p of REVERB_PRESETS) assert.deepEqual(presetProps(p.id, 'RP_None'), presetProps(p.id, true), p.id);
});

const DEFAULTS = new URL('../editor/cache/_palette/defaults.json', import.meta.url);
test('this PC\'s class defaults: a water zone as it comes is None and keeps its reverb; the other OpenAL zones as before',
  { skip: !fs.existsSync(DEFAULTS) && 'no class defaults here (cache/_palette/defaults.json)' }, () => {
    const classes = JSON.parse(fs.readFileSync(DEFAULTS, 'utf8')).classes;
    // as app.js keyValue reads a zone that sets nothing: its class's default for the key and index
    const stock = (cls) => (key) => classes[cls].props[key.split('(')[0]]?.[+(/\((\d+)\)/.exec(key)?.[1] ?? 0)];
    const own = (cls) => classes[cls].props[EFX]?.[0];
    const zones = Object.keys(classes).filter((cls) => own(cls));
    if (!zones.length) return;                                                     // the original game: no OpenAL reverb
    assert.equal(own('WaterZone'), 'RP_Underwater');
    for (const cls of zones) {
      assert.equal(presetOf(stock(cls), own(cls)), 'none', cls);
      assert.equal(presetProps('none', own(cls))[EFX], own(cls), cls);
    }
    assert.equal(presetProps('hall', own('WaterZone'))[EFX], undefined);
    assert.equal(presetProps('hall', own('RevZoneInfo'))[EFX], 'RP_Auditorium');
  });

test('a zone\'s values are their preset, else Custom', () => {
  assert.equal(presetOf(zone(), false), 'none');                                       // ZoneInfo as it comes: no echo
  for (const p of REVERB_PRESETS) {
    assert.equal(presetOf(zone(presetProps(p.id, false)), false), p.id);
    assert.equal(presetOf(zone(presetProps(p.id, true)), true), p.id);
  }
  assert.equal(presetOf(zone({ bReverbZone: 'True' }), false), 'custom');               // the class's own echo
  assert.equal(presetOf(zone({ ...presetProps('hall', false), 'Gain(3)': '41' }), false), 'custom');
  assert.equal(presetOf(zone({ ...presetProps('hall', false), MasterGain: '100.000000', bReverbZone: 'true' }), false), 'hall');   // as text
  assert.equal(presetOf(zone({ ...presetProps('hall', true), ReverbPreset: 'RP_Cave' }), true), 'custom');   // OpenAL's apart
  assert.equal(presetOf(zone({ ReverbPreset: 'RP_Cave' }), true), 'custom');
  assert.equal(presetOf(zone({ ...presetProps('none', false), MasterGain: '7' }), false), 'none');            // off: whatever it keeps
});

test('a box of Custom stores a whole number from 0 to its most, whatever is typed', () => {
  const cutoff = REVERB_LEVELS.find(([key]) => key === 'CutoffHz')[3];
  assert.equal(cutoff, 22050);
  assert.deepEqual(['-500', '999999', '8000.6', '', 'loud'].map((t) => reverbValue(t, cutoff)), ['0', '22050', '8001', '0', '0']);
  assert.deepEqual(['300', '-1', '77.4'].map((t) => reverbValue(t, 255)), ['255', '0', '77']);
});
