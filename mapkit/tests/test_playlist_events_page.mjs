// app.js's own code for G29 and G38, run as it is on stand-ins: a sound effect's More sounds (playlistField: its list
// after its Sound, a drop target for each place and the next free one, Order only with two sounds or more, each change
// one undo step with only the places that change, its sliders and repeats; the Preview's picks at their times) and an
// animation's events in its preview (animEvents: a sound event played alongside, an Event said, nothing while a
// Rebuild holds the server; animEventTimes: one after the last key at the end).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as playlist from '../editor/static/sound-playlist.js';
import * as timed from '../editor/static/motion-events.js';
import { sameText, baseOf } from '../editor/static/prop-sets.js';
import { propText } from '../editor/static/prop-kinds.js';
import { numberField } from '../editor/static/number-expr.js';
import { propertyName } from '../editor/static/history-names.js';

const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = (name) => {                     // a function of one line, or up to its closing brace
  const at = source.indexOf(`function ${name}(`), first = source.slice(at, source.indexOf('\n', at));
  assert.ok(at >= 0, name);
  return first.trimEnd().endsWith('}') ? first : source.slice(at, source.indexOf('\n}', at) + 2);
};
const line = (start) => { const at = source.indexOf(start); assert.ok(at >= 0, start); return source.slice(at, source.indexOf('\n', at)); };

// ---- More sounds
function element(extra = {}) { return { value: '', dataset: {}, querySelectorAll: () => [], ...extra }; }
function playlistPage(own = {}) {
  const fields = { FXSound: ['None'], FXSounds: Array(7).fill('None'), FXOrder: ['0'], RandomPitch: ['0.000000'], RandomVolume: ['0.000000'],
    RepeatMin: ['0.000000'], RepeatMax: ['0.000000'], FXVolume: ['1.000000'], FXPitch: ['1.000000'], bOnTouch: ['True'], bTriggerOnceOnly: ['False'] };
  const els = {}, calls = [], previews = [];
  const fx = { name: 'SoundFX3', cls: 'UCSoundFX', props: {} };
  const c = vm.createContext({
    ...playlist, sameText, baseOf, propText, numberField, propertyName,
    fieldOf: (a, prop) => (fields[prop] ? { prop, default: fields[prop] } : null),
    actorProp: (a, key) => own[key],
    $: (sel) => (els[sel] ||= element()), requireUnlocked: () => true, hierLabel: (a) => a.name,
    pushUndo: (label) => calls.push(['undo', label]), putProp: (a, key, text) => { own[key] = text; calls.push(['put', key, text]); },
    setDirty: () => calls.push(['dirty']), playSound: () => {}, pickSound: (cur, done) => done('Ambient.Dogs.Bark9'),
    previewPlaylist: (fx) => previews.push(fx),
  });
  vm.runInContext([line('const soundRef = '), body('escapeHtml'), body('keyValue'), body('putPropsStep'), body('playlistField')].join('\n'), c);
  const redraw = () => calls.push(['redraw']);
  const row = c.playlistField(fx, {}, 'pp4', '<label>More sounds</label>', redraw);
  // the buttons the html has, as the box finds them (the same ones each time)
  const found = {}, buttons = (attr) => (found[attr] ||= [...row.html.matchAll(new RegExp(`data-${attr}="(\\d+)"(?: data-to="(-?\\d+)")?`, 'g'))]
    .map(([, at, to]) => element({ dataset: { [attr]: at, to } })));
  els['#pp4'] = element({ querySelectorAll: (sel) => buttons(sel.slice(6, -1)) });
  row.wire();
  return { row, els, calls, own, previews, c };
}
const sound = (name) => `Sound'${name}'`;

test('More sounds: the list after its Sound, a drop target for each place and the next free one; no Order with one sound', () => {
  const one = playlistPage({ FXSound: sound('Ambient.Dogs.Bark1') });
  assert.match(one.row.html, /data-sndprop="FXSounds\(0\)"[^>]*>.*Drop sounds here \(1\/8\)/s);
  assert.doesNotMatch(one.row.html, /id="pp4o"/);
  const three = playlistPage({ FXSound: sound('Ambient.Dogs.Bark1'), 'FXSounds(0)': sound('Ambient.Dogs.Bark2'), 'FXSounds(2)': sound('Ambient.Dogs.Bark3') });
  assert.match(three.row.html, /data-sndprop="FXSounds\(0\)"[^>]*><span class="hint"[^>]*>2</);
  assert.match(three.row.html, /data-sndprop="FXSounds\(2\)"[^>]*><span class="hint"[^>]*>3</);       // its place in the list
  assert.match(three.row.html, /data-sndprop="FXSounds\(1\)"[^>]*>.*Drop sounds here \(3\/8\)/s);   // the gap first
  assert.match(three.row.html, /id="pp4o"/);
  assert.match(three.row.html, /It plays once each time it is set off/);
});

test('More sounds: up, out and add are one undo step each, writing only the places that change', () => {
  const page = playlistPage({ FXSound: sound('Ambient.Dogs.Bark1'), 'FXSounds(0)': sound('Ambient.Dogs.Bark2'), 'FXSounds(1)': sound('Ambient.Dogs.Bark3') });
  const up = page.els['#pp4'].querySelectorAll('[data-plmove]').find((b) => b.dataset.plmove === '2' && b.dataset.to === '1');
  up.onclick();
  assert.deepEqual(page.calls, [['undo', 'Reorder the sounds of SoundFX3'], ['put', 'FXSounds(0)', sound('Ambient.Dogs.Bark3')],
    ['put', 'FXSounds(1)', sound('Ambient.Dogs.Bark2')], ['dirty'], ['redraw']]);
  const out = playlistPage({ FXSound: sound('Ambient.Dogs.Bark1'), 'FXSounds(0)': sound('Ambient.Dogs.Bark2') });
  out.els['#pp4'].querySelectorAll('[data-plx]').find((b) => b.dataset.plx === '1').onclick();
  assert.deepEqual(out.calls.filter(([k]) => k !== 'dirty' && k !== 'redraw'), [['undo', 'Take a sound out of the list of SoundFX3'], ['put', 'FXSounds(0)', 'None']]);
  const add = playlistPage({ FXSound: sound('Ambient.Dogs.Bark1') });
  add.els['#pp4a'].onclick();
  assert.deepEqual(add.calls.filter(([k]) => k === 'put'), [['put', 'FXSounds(0)', sound('Ambient.Dogs.Bark9')]]);
});

test('More sounds: Order, the sliders as a fraction, the repeats; the Preview gets the effect as the game plays it', () => {
  const page = playlistPage({ FXSound: sound('Ambient.Dogs.Bark1'), 'FXSounds(0)': sound('Ambient.Dogs.Bark2'), FXPitch: '1.200000', bOnTouch: 'False', RepeatMax: '6.000000' });
  assert.match(page.row.html, /until an interaction stops it/);
  page.els['#pp4o'].value = '1'; page.els['#pp4o'].onchange();
  page.els['#pp4RandomPitchn'].value = '15'; page.els['#pp4RandomPitchn'].onchange();
  page.els['#pp4RandomVolume'].value = '400'; page.els['#pp4RandomVolume'].onchange();          // past the slider's most
  page.els['#pp4r0'].value = '-2'; page.els['#pp4r0'].onchange();
  assert.deepEqual(page.calls.filter(([k]) => k === 'put'), [['put', 'FXOrder', '1'], ['put', 'RandomPitch', '0.150000'],
    ['put', 'RandomVolume', '1.000000']]);                                      // RepeatMin -2 is 0, as it was: no step
  assert.deepEqual(page.calls.filter(([k]) => k === 'undo').map(([, l]) => l), ['Order of the sounds of SoundFX3', 'Random pitch of SoundFX3', 'Random volume of SoundFX3']);
  page.els['#pp4pv'].onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(page.previews)), [{ sounds: ['Ambient.Dogs.Bark1', 'Ambient.Dogs.Bark2'], order: 1, volume: 1, pitch: 1.2,
    randomVolume: 1, randomPitch: 0.15, repeatMin: 0, repeatMax: 6 }]);
});

// ---- an animation's events in its preview
function eventsPage({ building = false } = {}) {
  const played = [], said = [];
  const c = vm.createContext({ ...timed, shots: { play: (list, alone) => { played.push([list, alone]); return Promise.resolve(true); } },
    shotsWait: () => building, status: (text) => said.push(text) });
  vm.runInContext([body('animEventTimes'), body('animEvents')].join('\n'), c);
  return { c, played, said };
}

test('the preview plays a sound event alongside what plays, says an Event, and waits while a Rebuild runs', () => {
  const m = { events: [{ t: 0.5, kind: 'sound', sound: 'Ambient.Machinery.Clank2', volume: 0.6 }, { t: 1, kind: 'event', tag: 'Alarm' },
    { t: 9, kind: 'sound', sound: '' }] };
  assert.deepEqual([...eventsPage().c.animEventTimes(m, 2)], [0.5, 1, 2]);
  const { c, played, said } = eventsPage();
  c.animEvents(m, [0, 1, 2]);
  assert.deepEqual(JSON.parse(JSON.stringify(played)), [[[{ sound: 'Ambient.Machinery.Clank2', volume: 0.6 }], false]]);
  assert.deepEqual(said, ['Animation event at 1.00 s: it triggers Alarm in the game']);
  const busy = eventsPage({ building: true });
  busy.c.animEvents(m, [0]);
  assert.deepEqual(busy.played, []);
});
