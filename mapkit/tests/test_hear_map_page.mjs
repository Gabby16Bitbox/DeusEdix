// app.js's own code for G27 and G28, run as it is on stand-ins: Hear the map's choice of the map's sounds each frame
// (pickAudio, stepAudio: the objects with a sound, their class's own, the disabled left out, the rebuild's zones in the
// 3D view's axes, each sound where its object is now) and a zone's Reverb row (reverbField: the preset shown, a preset
// chosen is one undo step with every value, Revision's OpenAL preset with it, Custom, a value of its own).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { mapSources } from '../editor/static/ambient-sound.js';
import * as reverb from '../editor/static/zone-reverb.js';
import { sameText, baseOf } from '../editor/static/prop-sets.js';
import { propText } from '../editor/static/prop-kinds.js';
import { numberField } from '../editor/static/number-expr.js';
import { soundFile, soundBytes } from '../editor/static/sound-browser.js';

const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = (name) => {                     // a function of one line, or up to its closing brace
  const at = source.indexOf(`function ${name}(`), first = source.slice(at, source.indexOf('\n', at));
  assert.ok(at >= 0, name);
  return first.trimEnd().endsWith('}') ? first : source.slice(at, source.indexOf('\n}', at) + 2);
};
const line = (start) => { const at = source.indexOf(start); assert.ok(at >= 0, start); return source.slice(at, source.indexOf('\n', at)); };
const vec = (x, y, z) => ({ x, y, z, toArray() { return [this.x, this.y, this.z]; } });
const plain = (v) => JSON.parse(JSON.stringify(v));          // made in the page's context: compared as data

// ---- Hear the map
function audioPage() {
  const proxy = (name, cls, props, at) => ({ position: vec(...at), userData: { actor: { name, cls, props } } });
  const c = vm.createContext({
    proxies: { children: [
      proxy('AmbientSound1', 'AmbientSound', { AmbientSound: "Sound'Ambient.Ambient.Hum'", SoundRadius: '40' }, [0, 0, 0]),
      proxy('SecurityCamera0', 'SecurityCamera', {}, [100, 0, 0]),             // its class hums
      proxy('Radio2', 'DeusExDecoration', { AmbientSound: "Sound'X.Radio'" }, [0, 0, 50]),
      proxy('Chair3', 'Chair', {}, [5, 5, 5]),
      { position: vec(0, 0, 0), userData: { box: {} } },                       // a block: no sound
    ] },
    edits: { disabled: { Radio2: true }, props: {} },
    actorProp: (a, key) => a.props[key], baseOf,
    // the class's values (keyValue: the Properties' field and its default)
    fieldOf: (a, prop) => {
      const value = a.cls === 'SecurityCamera' ? { AmbientSound: "Sound'DeusExSounds.Generic.CameraHum'", SoundRadius: '48' }[prop] : undefined;
      return value === undefined ? null : { prop, default: [value] };
    },
    // the last rebuild's zones (data.zone_looks), their places in the game's axes; the camera in zone 1
    zoneLooks: [{ name: 'LevelInfo0', at: [0, 0, 0], sound: null }, { name: 'ZoneInfo7', at: [10, 20, 30], sound: { sound: 'Ambient.Ambient.Bar', radius: 40, volume: 64, pitch: 64 } }],
    T: (a) => vec(a[0], a[2], a[1]), cameraZoneNumber: () => 1, audioClasses: () => { c.asked++; return Promise.resolve(); }, asked: 0,
    mapGeneration: 3, mapName: 'Lab', camera: { position: vec(0, 0, 0) }, forward: () => vec(0, 0, -1), mapSources,
    sceneAudio: { on: true, frames: [], update(listener, sources) { this.frames.push({ listener, sources }); } },
    audioPick: { at: -Infinity, gen: -1, objects: [], zones: [], camZone: undefined },
  });
  vm.runInContext([line('const soundRef = '), body('keyValue'), body('pickAudio'), body('stepAudio')].join('\n'), c);
  return c;
}

test('Hear the map: the objects with a sound (their class\'s too), not the disabled, and the zone the camera is in', () => {
  const c = audioPage();
  c.stepAudio(1000);
  const { listener, sources } = c.sceneAudio.frames[0];
  assert.deepEqual(plain(listener), { at: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] });
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(byId).sort(), ['AmbientSound1', 'SecurityCamera0', 'zone:1']);
  assert.equal(byId.SecurityCamera0.sound, 'DeusExSounds.Generic.CameraHum');
  assert.equal(byId.SecurityCamera0.radius, 25 * 49);
  assert.equal(byId.AmbientSound1.radius, 25 * 41);
  assert.equal(byId['zone:1'].radius, 6400);                     // the camera is in the bar's zone
  assert.deepEqual(plain(byId['zone:1'].at), [10, 30, 20]);             // the game's x, y, z in the 3D view's axes
  assert.equal(c.asked, 1);                                      // the map's classes asked for once
});

test('Hear the map: each frame the sounds are where their objects are now; looked for again twice a second', () => {
  const c = audioPage();
  c.stepAudio(1000);
  c.proxies.children[0].position.x = 300;                         // dragged with the gizmo
  c.proxies.children[0].userData.actor.props.SoundRadius = '80';  // not looked at again yet
  c.stepAudio(1100);
  let s = c.sceneAudio.frames[1].sources.find((x) => x.id === 'AmbientSound1');
  assert.deepEqual(plain([s.at, s.radius]), [[300, 0, 0], 25 * 41]);
  c.stepAudio(1600);
  s = c.sceneAudio.frames[2].sources.find((x) => x.id === 'AmbientSound1');
  assert.equal(s.radius, 25 * 81);
  assert.equal(c.asked, 1);
  c.mapGeneration = 4;                                            // another map: looked for at once, its classes asked for
  c.stepAudio(1650);
  assert.equal(c.asked, 2);
  c.sceneAudio.on = false;
  c.stepAudio(5000);
  c.sceneAudio.on = true; c.mapName = null;
  c.stepAudio(6000);
  assert.equal(c.sceneAudio.frames.length, 4);                     // off, or no map: nothing
});

// ---- the sounds' data of the editor's players (Hear the map, the previews, the voices: one cache, sound-cache.js)
test('a sound\'s data is found and read as the sound browser does, refused over 64 MB before it is read', async () => {
  const asked = [], fetched = [], real = globalThis.fetch;
  const c = vm.createContext({ soundFile, soundBytes,
    api: async (url) => { asked.push(url); return { url: '/cache/_sounds/play/' + url.split('=')[1] + '.wav', bytes: /Big/.test(url) ? 70 * 1024 * 1024 : 900 }; } });
  vm.runInContext('async ' + body('soundData'), c);
  globalThis.fetch = async (url) => { fetched.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
  try {
    assert.equal((await c.soundData('Ambient.Hum')).byteLength, 8);
    await assert.rejects(c.soundData('Ambient.Big'), /too large/);
  } finally { globalThis.fetch = real; }
  assert.deepEqual(asked, ['/api/sound_play?name=Ambient.Hum', '/api/sound_play?name=Ambient.Big']);
  assert.deepEqual(fetched, ['/cache/_sounds/play/Ambient.Hum.wav']);
});

// ---- a zone's Reverb row
function element(extra = {}) { return { value: '', on: {}, addEventListener(type, fn) { this.on[type] = fn; }, ...extra }; }
function reverbPage({ own = {}, efx = false, game = 'vanilla' } = {}) {
  const fields = { bReverbZone: ['False'], MasterGain: ['100'], CutoffHz: ['6000'], Delay: ['20', '34', '0', '0', '0', '0'], Gain: ['150', '70', '0', '0', '0', '0'] };
  if (efx) fields.ReverbPreset = [efx === true ? 'RP_None' : efx];      // true: a RevZoneInfo's, else the class's own
  const els = {}, calls = [];
  const zone = { name: 'ZoneInfo3', cls: efx === 'RP_Underwater' ? 'WaterZone' : efx ? 'RevZoneInfo' : 'ZoneInfo', props: {} };
  const c = vm.createContext({
    ...reverb, sameText, baseOf, propText, numberField, projectContext: { target: game }, projectGame: (p) => p?.target || 'revision',
    fieldOf: (a, prop) => (fields[prop] ? { prop, default: fields[prop] } : null),
    actorProp: (a, key) => own[key], reverbValuesOpen: false,
    $: (sel) => (els[sel] ||= element()), requireUnlocked: () => true, hierLabel: (a) => a.name,
    pushUndo: (label) => calls.push(['undo', label]), putProp: (a, key, text) => { own[key] = text; calls.push(['put', key, text]); },
    setProp: (a, key, text) => { own[key] = text; calls.push(['set', key, text]); }, setDirty: () => calls.push(['dirty']),
  });
  vm.runInContext([body('escapeHtml'), body('keyValue'), body('putPropsStep'), body('reverbField')].join('\n'), c);
  const redraw = () => calls.push(['redraw']);
  const row = c.reverbField(zone, {}, 'pp7', '<label>Reverb</label>', redraw);
  row.wire();
  const choose = (value) => { els['#pp7'].value = value; els['#pp7'].selectedOptions = [{ textContent: reverb.REVERB_PRESETS.find((p) => p.id === value)?.label || 'Custom' }]; els['#pp7'].onchange(); };
  return { c, row, els, calls, own, choose };
}
const selected = (html) => /<option value="(\w+)" selected>/.exec(html)?.[1];

test('Reverb: a zone as its class has it shows None; a preset is one undo step with all its values', () => {
  const { row, calls, own, choose } = reverbPage();
  assert.equal(selected(row.html), 'none');
  assert.doesNotMatch(row.html, /<details id="pp7d" open>/);
  assert.match(row.html, /The game's Galaxy audio plays these echoes/);
  choose('hall');
  assert.deepEqual(calls.filter(([k]) => k === 'undo'), [['undo', 'Reverb Hall of ZoneInfo3']]);
  assert.deepEqual(calls.at(-2), ['dirty']);
  assert.deepEqual(calls.at(-1), ['redraw']);
  // what differs from the zone's values now: the class's MasterGain and CutoffHz are Hall's already
  const { MasterGain, CutoffHz, ...rest } = reverb.presetProps('hall', false);
  assert.deepEqual({ ...own }, rest);
  assert.deepEqual([MasterGain, CutoffHz], ['100', '6000']);
  calls.length = 0;
  choose('hall');                                                 // already Hall: nothing to undo
  assert.deepEqual(calls, [['redraw']]);
  const again = reverbPage({ own }).row;
  assert.equal(selected(again.html), 'hall');
});

test('Reverb: Custom turns the echo on with the values as they are and shows them; a value is changed by itself', () => {
  const { c, calls, own, choose, els } = reverbPage();
  choose('custom');
  assert.deepEqual(calls.filter(([k]) => k === 'put'), [['put', 'bReverbZone', 'True']]);
  assert.equal(c.reverbValuesOpen, true);
  const next = reverbPage({ own });
  assert.equal(selected(next.row.html), 'custom');
  assert.match(next.row.html, /<details id="pp7d" open>/);
  // the boxes: Echo loudness, Cutoff, then the six delays and the six gains
  els['#pp7v4'].value = '77.4'; els['#pp7v4'].onchange();        // Delay(2)
  els['#pp7v1'].value = '9000'; els['#pp7v1'].onchange();        // CutoffHz: no byte
  els['#pp7v9'].value = '300'; els['#pp7v9'].onchange();         // Gain(1): a byte
  assert.deepEqual(calls.filter(([k]) => k === 'set'), [['set', 'Delay(2)', '77'], ['set', 'CutoffHz', '9000'], ['set', 'Gain(1)', '255']]);
});

test('Reverb: a Custom value typed out of its range is stored at its nearest end', () => {
  const { own, els, choose } = reverbPage();
  choose('custom');
  els['#pp7v1'].value = '-500'; els['#pp7v1'].onchange();        // Cutoff (Hz), 0 to 22050
  assert.equal(own.CutoffHz, '0');
  els['#pp7v1'].value = '999999'; els['#pp7v1'].onchange();
  assert.equal(own.CutoffHz, '22050');
  els['#pp7v1'].value = 'loud'; els['#pp7v1'].onchange();        // not a number
  assert.equal(own.CutoffHz, '0');
  els['#pp7v0'].value = '-3'; els['#pp7v0'].onchange();          // Echo loudness: a byte
  assert.equal(own.MasterGain, '0');
});

test('Reverb in Revision: a RevZoneInfo\'s OpenAL preset goes with it; a plain ZoneInfo says what plays it', () => {
  const rev = reverbPage({ efx: true, game: 'revision' });
  assert.match(rev.row.html, /a preset sets both/);
  assert.match(rev.row.html, /Galaxy audio plays these echoes \(their gains are the class's: this zone's Gain is OpenAL's\), Revision's OpenAL audio the OpenAL reverb: a preset sets both/);
  rev.choose('tunnel');
  assert.equal(rev.own.ReverbPreset, 'RP_SewerPipe');
  assert.equal(rev.own['Delay(2)'], '51');
  const plain = reverbPage({ game: 'revision' });
  assert.match(plain.row.html, /OpenAL audio imitates them\. A RevZoneInfo also has OpenAL's own reverbs/);
  plain.choose('cave');
  assert.equal('ReverbPreset' in plain.own, false);
});

test('Reverb on a class with OpenAL\'s own reverb: no echo gain boxes; a water zone keeps its underwater reverb', () => {
  const rev = reverbPage({ efx: true, game: 'revision' });
  assert.doesNotMatch(rev.row.html, /id="pp7v(8|9|1[0-3])"/);            // 2 levels and 6 delays: 8 boxes, no Gain(i)
  assert.doesNotMatch(rev.row.html, /how loud/);
  assert.equal(Object.keys(rev.els).filter((k) => /^#pp7v\d+$/.test(k)).length, 8);    // wire() takes the boxes drawn only
  rev.els['#pp7v7'].value = '90'; rev.els['#pp7v7'].onchange();          // the last box: Delay(5)
  assert.deepEqual(rev.calls.filter(([k]) => k === 'set'), [['set', 'Delay(5)', '90']]);
  const water = reverbPage({ efx: 'RP_Underwater', game: 'revision' });
  assert.equal(selected(water.row.html), 'none');                        // as it comes: None, not Custom
  assert.doesNotMatch(water.row.html, /<details id="pp7d" open>/);
  assert.match(water.row.html, /own OpenAL reverb \(RP_Underwater: the presets leave it, None puts it back\)/);
  water.choose('none');
  assert.deepEqual(water.calls.filter(([k]) => k === 'put'), []);        // RP_Underwater already, the echo off
  water.choose('hall');
  assert.equal('ReverbPreset' in water.own, false);
  assert.equal(Object.keys(water.own).some((k) => k.startsWith('Gain(')), false);
  assert.equal(water.own['Delay(0)'], '50');
});
