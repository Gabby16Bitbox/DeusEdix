// app.js's own code for the lighting of the 3D view (G25, G26), run as it is on stand-ins: a view of the last rebuild
// chosen while View > Effects shows lights the map again (setViewMode, setLightMode), Effects does not draw every frame
// while Play runs (drawEveryFrame); the lamps as the project's game shows them (part B, 1 Nov 2026: Revision never lights
// a flickering lamp: the live preview and Lights here leave it out, Effects gives it no light; a corona only with a Skin;
// the Properties' notes; Effects' frame number); Lights here's Special lit face; Lights here's lamps (liveLamps: not
// those off in game, only the kind of lamp that
// lights the kind of surface clicked), the class's values read through keyValue. Part B2 (1 Nov 2026): a lamp's values as
// Rebuild writes them (All properties' win), the notes written again as they change, coronas of lamps of no brightness
// and none of a lamp off in game, a palette lamp Revision leaves dark, coronas hidden by walls (wallBetween), the texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { THREE, noThree } from './three.mjs';
import { baseOf } from '../editor/static/prop-sets.js';
import { lightLevel, givesLight, lightNotes, nearestLights, MOVING_LIGHTS, NOTE_PROPS } from '../editor/static/light-effects.js';
import { FX_MAX } from '../editor/static/light-effects-view.js';
import { engineColour, LIGHT_EFFECTS } from '../editor/static/light-reach.js';
import { byteReach } from '../editor/static/range-handles.js';

const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = (name) => {                     // a function of one line, or up to its closing brace
  const at = source.indexOf(`function ${name}(`), first = source.slice(at, source.indexOf('\n', at));
  assert.ok(at >= 0, name);
  return first.trimEnd().endsWith('}') ? first : source.slice(at, source.indexOf('\n}', at) + 2);
};
const VIEW_MODES = [['wire', 'Wireframe'], ['cuts', 'BSP cuts'], ['zones', 'Zones'], ['lightmap', 'Lightmap detail']];

// ---- Effects and the views of the last rebuild
function viewPage({ effects = true } = {}) {
  const c = vm.createContext({
    VIEW_MODES, effectsOn: effects, lightMode: 'lit', mapName: 'Lab', lit: 0, vpBar: null, status() {},
    localStorage: { setItem() {} },
    viewModes: { mode: null, set(mode) { this.mode = mode; return Promise.resolve(); } },
    applyLighting() { c.lit++; }, wake() {},
    // drawEveryFrame's
    awakeUntil: 0, cam: { look: false }, previewing: null, tc: { dragging: false }, anim: null, effectPreviewsActive: () => false,
    showPaths: false, gameView: { active: false },
  });
  vm.runInContext(['effectsShown', 'setViewMode', 'setLightMode', 'drawEveryFrame'].map(body).join('\n'), c);
  return c;
}

test('a view of the last rebuild chosen while Effects shows lights the map again, once; back to Lit, once', () => {
  const c = viewPage();
  assert.equal(c.effectsShown(), true);
  c.setLightMode('cuts');                       // BSP cuts: Effects no longer shows, the frame it stopped at goes
  assert.equal(c.viewModes.mode, 'cuts');
  assert.equal(c.effectsShown(), false);
  assert.equal(c.lit, 1);
  c.setLightMode('zones');                      // from one view to another: nothing to light again
  assert.equal(c.lit, 1);
  c.setLightMode('lit');                        // back: lit once (by setLightMode), not twice
  assert.equal(c.viewModes.mode, null);
  assert.equal(c.lit, 2);
  c.setViewMode('lightmap');                    // the view's own way in (the editor's API) and out
  c.setViewMode(null);
  assert.equal(c.lit, 4);
});

test('Effects off: a view of the last rebuild is chosen without lighting the map again', () => {
  const c = viewPage({ effects: false });
  c.setLightMode('wire');
  c.setViewMode(null);
  assert.equal(c.lit, 0);
});

test('Effects draws every frame, but not while Play runs over the 3D view', () => {
  const c = viewPage();
  assert.equal(c.drawEveryFrame(1000), true);
  c.gameView.active = true;
  assert.equal(c.drawEveryFrame(1000), false);
  c.awakeUntil = 2000;                          // the mouse or a key still wakes it
  assert.equal(c.drawEveryFrame(1000), true);
  c.awakeUntil = 0; c.gameView.active = false; c.effectsOn = false;
  assert.equal(c.drawEveryFrame(1000), false);
  assert.match(body('animate'), /if \(!drawEveryFrame\(now\) && now - lastDraw < 250\) return;/);
});

// ---- Lights here's lamps (and the live preview's, a lamp's corona and notes): the project made for `game`, more lamps
// ([name, props]) after the four
function lampPage({ game = 'revision', more = [] } = {}) {
  const proxy = (name, props, cls = 'Light') => ({ position: { x: 0, y: 64, z: 0 }, quaternion: {}, userData: { kind: 'light', actor: { name, cls, kind: 'light', props } } });
  const lamps = [proxy('Light1', {}), proxy('Light6', {}), proxy('Light7', { bSpecialLit: 'True' }), proxy('Spot2', {}, 'Spotlight'),
    ...more.map(([name, props]) => proxy(name, props))];
  // the class's values, as the Properties have them (fieldOf: propSchema's field, its default)
  const schema = { Light: { LightType: 'LT_Steady', LightPeriod: '32', LightPhase: '0', LightEffect: 'LE_None', LightCone: '128', bSpecialLit: 'False', bCorona: 'False' },
    Spotlight: { LightType: 'LT_Steady', LightEffect: 'LE_Spotlight', LightCone: '64', bSpecialLit: 'False' } };
  const lit = [], edits = { disabled: { Light6: true }, props: {}, rawprops: {}, deleted: {} };
  const c = vm.createContext({
    proxies: { children: lamps }, edits, baseOf, LIGHT_EFFECTS, engineColour, byteReach,
    actorProp: (a, key) => (key in (edits.props[a.name] || {}) ? edits.props[a.name][key] : a.props[key]),      // edited, else the map's
    fieldOf: (a, prop) => (schema[a.cls]?.[prop] === undefined ? null : { prop, default: [schema[a.cls][prop]] }),
    liveLight: (a) => ({ b: +(a.props.LightBrightness ?? 64), hue: 0, sat: 255, radius: 10 }), lampSeed: () => 7, lampsOff: new Set(),
    objectRotation: () => [0, 0, 0], rotationToVector: () => [1, 0, 0], UE: (v) => [v.x, v.z, v.y],
    givesLight, lightNotes, projectGame: (p) => p?.target || 'revision', projectContext: { target: game },
    // the live preview's (stepLiveLighting): the lamps it lights, by name
    lightMode: 'preview', viewModes: { mode: null }, selected: null, camera: { position: { x: 0, y: 0, z: 0 } }, lightGain: 1,
    THREE: { Vector3: class { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } applyQuaternion() { return this; } } },
    liveLighting: { update: (lights) => lit.splice(0, lit.length, ...lights.map((l) => l.id)) }, lit,
  });
  vm.runInContext(['builtValue', 'lampType', 'lampSkin', 'keyValue', 'lampKind', 'coronaOf', 'lampNotes', 'liveLamps', 'stepLiveLighting'].map(body).join('\n'), c);
  return c;
}
const actorOf = (c, name) => c.proxies.children.find((p) => p.userData.actor.name === name).userData.actor;
const names = (list) => [...list].map((x) => x.id.userData.actor.name);       // (made in the page's context)

test('Lights here: not a lamp off in game; a Special lit surface only the Special lit lamps, the others none of them', () => {
  const c = lampPage();
  assert.deepEqual(names(c.liveLamps(false)), ['Light1', 'Spot2']);
  assert.deepEqual(names(c.liveLamps(true)), ['Light7']);
  c.edits.disabled.Light6 = false;              // switched on again: lighting again
  assert.deepEqual(names(c.liveLamps(false)), ['Light1', 'Light6', 'Spot2']);
});

test('the lamps\' class values come through keyValue: a spotlight\'s cone and effect, a lamp\'s type and period', () => {
  const c = lampPage();
  const spot = c.liveLamps(false).find((x) => x.id.userData.actor.name === 'Spot2').L;
  assert.equal(spot[7], LIGHT_EFFECTS.indexOf('LE_Spotlight'));            // [x, y, z, r, g, b, reach, effect, ...]
  assert.equal(spot.at(-1), 64);
  assert.deepEqual(JSON.parse(JSON.stringify(c.lampKind(c.proxies.children[0].userData.actor))),
    { type: 'LT_Steady', period: 32, phase: 0, seed: 7, off: false, skin: '' });
});

test('Lights here and the live preview leave out a lamp the project\'s game never lights: a flickering one in Revision', () => {
  const flicker = [['Flicker9', { LightType: 'LT_Flicker' }]];
  const rev = lampPage({ more: flicker }), old = lampPage({ game: 'vanilla', more: flicker });
  assert.deepEqual(names(rev.liveLamps(false)), ['Light1', 'Spot2']);
  assert.deepEqual(names(old.liveLamps(false)), ['Light1', 'Spot2', 'Flicker9']);
  rev.stepLiveLighting(); old.stepLiveLighting();
  assert.deepEqual([...rev.lit], ['Light1', 'Light7', 'Spot2']);              // (Light6: off in game)
  assert.deepEqual([...old.lit], ['Light1', 'Light7', 'Spot2', 'Flicker9']);
});

test('a lamp\'s corona: only with bCorona; its Skin and DrawScale, All properties\' first; the notes of the project\'s game', () => {
  const more = [['Glow1', { bCorona: 'True', Skin: "Texture'Effects.Corona.Corona_G'" }], ['Bare2', { bCorona: 'True' }],
    ['Flick3', { LightType: 'LT_Flicker', bCorona: 'True', Skin: 'None' }]];
  const c = lampPage({ more }), corona = (name) => JSON.parse(JSON.stringify(c.coronaOf(actorOf(c, name))));
  assert.equal(c.coronaOf(actorOf(c, 'Light1')), null);
  assert.deepEqual(corona('Glow1'), { skin: "Texture'Effects.Corona.Corona_G'", size: 1 });
  assert.deepEqual(corona('Bare2'), { skin: '', size: 1 });
  assert.deepEqual(corona('Flick3'), { skin: '', size: 1 });
  c.edits.rawprops.Bare2 = { Skin: "Texture'Effects.Corona.Corona_E'", DrawScale: '0.5' };       // set in All properties
  assert.deepEqual(corona('Bare2'), { skin: "Texture'Effects.Corona.Corona_E'", size: 0.5 });
  actorOf(c, 'Glow1').meshDrawScale = 2;                                                          // the map's DrawScale
  assert.equal(corona('Glow1').size, 2);
  const props = (page, name) => [...page.lampNotes(actorOf(page, name))].map((n) => n.prop);
  assert.deepEqual(props(c, 'Light1'), []);
  assert.deepEqual(props(c, 'Glow1'), []);
  assert.deepEqual(props(c, 'Flick3'), ['LightType', 'bCorona']);              // dark in Revision; a corona without a Skin
  assert.deepEqual(props(lampPage({ game: 'vanilla', more }), 'Flick3'), ['LightPeriod', 'LightPhase', 'bCorona']);
  // part B's #14: a lamp's own Period reaches its notes; All properties' bCorona counts
  const blink = lampPage({ more: [['Blink4', { LightType: 'LT_Blink', LightPeriod: '0' }]] });
  assert.match([...blink.lampNotes(actorOf(blink, 'Blink4'))].find((n) => n.prop === 'LightPeriod').text, /stays on after 256 s/);
  c.edits.rawprops.Light1 = { bCorona: 'True', Skin: "Texture'Effects.Corona.Corona_G'" };
  assert.deepEqual(corona('Light1'), { skin: "Texture'Effects.Corona.Corona_G'", size: 1 });
});

test('a lamp\'s values as Rebuild writes them: All properties\' win over the Properties\' in the previews, the notes and its period', () => {
  const c = lampPage({ more: [['Flick5', { LightType: 'LT_Flicker' }]] });
  c.edits.rawprops.Light1 = { LightType: 'LT_Flicker' };          // a steady lamp made a flickering one there: Revision never lights it
  c.edits.rawprops.Flick5 = { LightType: 'LT_Steady' };           // and the other way round
  assert.deepEqual(names(c.liveLamps(false)), ['Spot2', 'Flick5']);
  c.stepLiveLighting();
  assert.deepEqual([...c.lit], ['Light7', 'Spot2', 'Flick5']);
  assert.deepEqual([...c.lampNotes(actorOf(c, 'Light1'))].map((n) => n.prop), ['LightType']);
  assert.deepEqual([...c.lampNotes(actorOf(c, 'Flick5'))], []);
  c.edits.rawprops.Light1 = { LightType: 'LT_Blink', LightPeriod: '0' };
  assert.equal(c.lampKind(actorOf(c, 'Light1')).period, 0);
});

test('liveLight: a lamp\'s colour and brightness as Rebuild writes them, All properties\' first', () => {
  const edits = { props: { Light1: { LightHue: '40' } }, rawprops: {} }, a = { name: 'Light1', props: { LightBrightness: '128' }, light: {} };
  const c = vm.createContext({ edits, actorProp: (x, key) => edits.props[x.name]?.[key] ?? x.props[key], baseOf, fieldOf: () => null });
  vm.runInContext(['builtValue', 'keyValue', 'liveLight'].map(body).join('\n'), c);
  assert.deepEqual([c.liveLight(a).hue, c.liveLight(a).b], [40, 128]);
  edits.rawprops.Light1 = { LightBrightness: '0', LightHue: '200' };
  assert.deepEqual([c.liveLight(a).hue, c.liveLight(a).b], [200, 0]);
});

// part B2's #1 (B3, 1 Nov 2026): the Properties' own colour rows show what their slider and picker write, the Properties'
// values, as the rows beside them; the lamp itself (liveLight's default) as Rebuild writes it, All properties' first
test('the Properties\' colour rows read the Properties\' own values, the lamp\'s preview All properties\' (liveLight\'s read)', () => {
  const edits = { props: { Light1: { LightHue: '40' } }, rawprops: { Light1: { LightHue: '200', LightBrightness: '0' } } };
  const a = { name: 'Light1', cls: 'Light', kind: 'light', props: { LightBrightness: '64' }, light: {} }, lamp = { userData: { kind: 'light', actor: a } };
  const swatch = { value: '' }, hint = { textContent: '' };
  const c = vm.createContext({ edits, baseOf, fieldOf: () => null, propertySlider: null, lightHex: (l) => `hue ${l.hue}`,
    $: (sel) => ({ '#details [data-light-color]': swatch, '#details [data-light-hint]': hint })[sel] || null,
    updateScriptTagField() {}, refreshLight() {}, showSoundRange() {}, refreshLampNotes() {},
    // propRows' (the Inspector of several objects): a lamp's colour field, shown as the Properties store it
    propRow: () => ({ row: 'int' }), INSPECTOR_LABELS: {}, propShown: (kind, v) => v, propValue: (x, f) => c.actorProp(x, f.prop) ?? f.default[0] });
  vm.runInContext(['builtValue', 'keyValue', 'actorProp', 'liveLight', 'previewPropertySlider', 'propRows'].map(body).join('\n'), c);
  assert.deepEqual([c.liveLight(a).hue, c.liveLight(a).b], [200, 0]);                               // the lamp's preview
  assert.deepEqual([c.liveLight(a, c.actorProp).hue, c.liveLight(a, c.actorProp).b], [40, 64]);     // the Properties'
  c.previewPropertySlider(lamp);
  assert.deepEqual([swatch.value, hint.textContent], ['hue 40', 'brightness 64, radius 64']);
  c.propertySlider = { a, key: 'LightHue', value: '20' };                                           // the Hue slider dragged
  c.previewPropertySlider(lamp);
  assert.equal(swatch.value, 'hue 20');
  c.propertySlider = null;
  c.fieldOf = () => ({ prop: 'LightHue', kind: 'lightcolor', label: 'Colour', help: '', default: ['0'] });
  const [colour, hue] = c.propRows([lamp], 'LightHue', 1);
  assert.deepEqual([[...colour.values], [...hue.values]], [['hue 40'], ['40']]);
  assert.match(body('drawProps'), /\n      const l = liveLight\(a, actorProp\), hex = lightHex\(l\);\n/);     // its colour row
});

test('a lamp of no brightness keeps the note of its corona without a Skin, and only that', () => {
  const c = lampPage({ more: [['Glow0', { LightBrightness: '0', LightType: 'LT_Flicker', bCorona: 'True' }]] });
  assert.equal(c.lampKind(actorOf(c, 'Glow0')), null);
  assert.deepEqual([...c.lampNotes(actorOf(c, 'Glow0'))].map((n) => n.prop), ['bCorona']);
});

test('a palette lamp whose Skin Revision leaves dark (Corona_G) is out of Lights here and the live preview there, not in the original game', () => {
  const palette = [['Palette8', { LightType: 'LT_TexturePaletteLoop', Skin: "Texture'Effects.Corona.Corona_G'" }]];
  const rev = lampPage({ more: palette }), old = lampPage({ game: 'vanilla', more: palette });
  assert.deepEqual(names(rev.liveLamps(false)), ['Light1', 'Spot2']);
  assert.deepEqual(names(old.liveLamps(false)), ['Light1', 'Spot2', 'Palette8']);
  rev.stepLiveLighting(); old.stepLiveLighting();
  assert.deepEqual([...rev.lit], ['Light1', 'Light7', 'Spot2']);
  assert.deepEqual([...old.lit], ['Light1', 'Light7', 'Spot2', 'Palette8']);
  // its note knows its Skin though its Corona is not ticked (not "Without a Skin")
  assert.match([...rev.lampNotes(actorOf(rev, 'Palette8'))][0].text, /^Revision gives a palette lamp with this Skin no light/);
  assert.match([...old.lampNotes(actorOf(old, 'Palette8'))][0].text, /^Its colour and level come from its Skin's palette/);
});

test('the Properties keep a box for a lamp\'s notes under each property they are about, there even with no note', () => {
  const draw = body('drawProps');
  assert.match(draw, /notes = lampNotes\(a\)/);
  assert.match(draw, /if \(NOTE_PROPS\.includes\(f\.prop\)\) html \+= `<div data-lamp-note="\$\{f\.prop\}" data-lamp="\$\{escapeHtml\(a\.name\)\}">\$\{lampNoteHtml\(notes, f\.prop\)\}<\/div>`;\n  \}\);\n  if \(group\)/);
});

// the boxes of a lamp's notes (drawProps: one under each property the notes are about) and what writes them again: a
// slider of the Properties (previewPropertySlider, dragged or let go), All properties (behaveApi.written)
function notesPage() {
  const c = lampPage({ more: [['Blink4', { LightType: 'LT_Blink', LightPeriod: '32' }]] });
  // (and a box of another lamp, Light1's, in another Inspector: left as it is)
  const boxes = [...NOTE_PROPS.map((prop) => ({ dataset: { lampNote: prop, lamp: 'Blink4' }, innerHTML: '' })),
    { dataset: { lampNote: 'LightType', lamp: 'Light1' }, innerHTML: 'its own' }];
  Object.assign(c, { escapeHtml: (s) => String(s), document: { querySelectorAll: (sel) => (sel === '[data-lamp-note]' ? boxes : []) },
    updateScriptTagField() {}, refreshLight() {}, showSoundRange() {}, $: () => null, lightHex: () => '#ffffff' });
  vm.runInContext(['lampNoteHtml', 'refreshLampNotes', 'previewPropertySlider'].map(body).join('\n'), c);
  const lamp = c.proxies.children.find((p) => p.userData.actor.name === 'Blink4');
  return { c, lamp, box: (prop, of = 'Blink4') => boxes.find((b) => b.dataset.lampNote === prop && b.dataset.lamp === of).innerHTML };
}

test('a lamp\'s notes are written again as its Period changes (a slider dragged or let go) and after All properties\' writes', () => {
  const { c, lamp, box } = notesPage();
  c.previewPropertySlider(lamp);
  assert.equal(box('LightPeriod'), '');                                   // Period 32: a Revision blink never stays on
  // in the warning colour, given by the note itself as app.js's other warning hints: a class "warn" next to "hint" loses
  // to index.html's .hint rule (the page showed the notes grey, 1 Nov 2026)
  assert.match(box('LightType'), /^<div class="hint" style="margin:0 0 4px;color:var\(--warn\)">A blinking lamp keeps no time/);
  c.edits.props.Blink4 = { LightPeriod: 0 };                              // its Period set in the Properties (setProp)
  c.previewPropertySlider(lamp);
  assert.match(box('LightPeriod'), /stays on after 256 s/);
  c.edits.props.Blink4 = { LightPeriod: 32 };
  c.previewPropertySlider(lamp);
  assert.equal(box('LightPeriod'), '');
  c.edits.rawprops.Blink4 = { LightPeriod: '0' };                         // written in All properties: said again
  c.refreshLampNotes(actorOf(c, 'Blink4'));
  assert.match(box('LightPeriod'), /stays on after 256 s/);
  assert.equal(box('LightType', 'Light1'), 'its own');
  assert.match(source, /\n  written: \(actors\) => actors\.forEach\(refreshLampNotes\),\n\};/);      // behaveApi, which all-props.js tells
});

// ---- View > Effects' frames (stepEffects with its pickLamps): lamps ([name, props]) of the last rebuild where their
// objects stand, in mapLights' order; what each frame gave light-effects-view.js (steps), a lamp's level in a step
function effectsPage({ game = 'revision', lamps }) {
  const proxies = lamps.map(([name, props]) => ({ visible: true, userData: { actor: { name, cls: 'Light', kind: 'light', props } },
    getWorldPosition: (v) => Object.assign(v, { x: 1, y: 2, z: 3 }) }));
  const schema = { LightType: 'LT_Steady', LightPeriod: '32', LightPhase: '0', bCorona: 'False' }, steps = [];
  const c = vm.createContext({
    effectsShown: () => true, lightEffects: { running: false, step(t, o) { this.running = true; steps.push(o); }, stop() {} },
    fxLamps: { at: -Infinity, of: null, moving: [], ids: new Set(), near: [], coronas: [] }, effectsClock: 0, effectsFrame: 0,
    mapLights: lamps.map((_, i) => [i * 1000, 0, 0, 1, 1, 1, 100, 0, 0, 0, -1, 0]), mapLampNames: () => lamps.map(([name]) => name),
    proxies: { children: proxies }, edits: { rawprops: {}, disabled: {} }, baseOf, lightLevel, givesLight, MOVING_LIGHTS, nearestLights, FX_MAX,
    actorProp: (a, key) => a.props[key], fieldOf: (a, prop) => (schema[prop] === undefined ? null : { prop, default: [schema[prop]] }),
    liveLight: (a) => ({ b: +(a.props.LightBrightness ?? 64) }), lightColor: () => 0xffd25a, lampSeed: (name) => name.length, lampsOff: new Set(), lightObject() {},
    lampClasses: async () => {}, litGeos: new Map(), cameraZone: () => null, lightGain: 1, camera: { position: { x: 0, y: 0, z: 0 } },
    UE: (v) => [v.x, v.z, v.y], THREE: { Vector3: function () {} }, projectGame: (p) => p?.target || 'revision', projectContext: { target: game },
  });
  vm.runInContext(['builtValue', 'lampType', 'lampSkin', 'keyValue', 'lampKind', 'coronaOf', 'pickLamps', 'stepEffects'].map(body).join('\n'), c);
  return { c, steps, level: (step, i) => step.lights.find((x) => x.L[0] === i * 1000)?.level };
}

test('Effects, each frame: the levels of the project\'s game, the frame from its start, strobes in step; a corona only with a Skin, at its DrawScale', () => {
  const lamps = [['Flicker1', { LightType: 'LT_Flicker' }], ['Strobe2', { LightType: 'LT_Strobe' }],
    ['Strobe3', { LightType: 'LT_Strobe', LightPeriod: '200', LightPhase: '100' }],
    ['Glow4', { bCorona: 'True', Skin: "Texture'Effects.Corona.Corona_G'" }], ['Bare5', { bCorona: 'True' }]];
  const rev = effectsPage({ lamps });
  for (let now = 1000; now < 1200; now += 16) rev.c.stepEffects(now);
  assert.deepEqual(rev.steps.slice(0, 3).map((s) => s.frame), [1, 2, 3]);
  assert.ok(rev.steps.every((s) => rev.level(s, 0) === 0));                       // Revision: the flickering lamp gives none
  assert.deepEqual(rev.steps.slice(0, 4).map((s) => [rev.level(s, 1), rev.level(s, 2)]), [[0, 0], [1, 1], [0, 0], [1, 1]]);
  assert.deepEqual(JSON.parse(JSON.stringify(rev.steps[0].coronas)), [{ name: 'Glow4', at: { x: 1, y: 2, z: 3 }, colour: 0xffd25a, size: 1 }]);
  rev.c.lightEffects.running = false;                                            // Effects shown again: frames from 1
  rev.c.stepEffects(5000);
  assert.equal(rev.steps.at(-1).frame, 1);
  const old = effectsPage({ game: 'vanilla', lamps });
  for (let now = 1000; now < 2000; now += 16) old.c.stepEffects(now);
  assert.ok(old.steps.some((s) => old.level(s, 0) > 0) && old.steps.some((s) => old.level(s, 0) === 0));   // it flickers there
});

test('Effects\' coronas: a lamp of no brightness has its corona (the original maps\' glows), a lamp off in game none', () => {
  const G = "Texture'Effects.Corona.Corona_G'";
  const fx = effectsPage({ lamps: [['Light168', { LightBrightness: '0', bCorona: 'True', Skin: G }], ['Lit1', { bCorona: 'True', Skin: G }],
    ['Off2', { bCorona: 'True', Skin: G }]] });
  fx.c.edits.disabled.Off2 = true;                                      // Enabled in game unticked: out of the map at Rebuild
  fx.c.stepEffects(1000);
  assert.deepEqual([...fx.steps[0].coronas].map((c) => c.name), ['Light168', 'Lit1']);
});

test('Effects: a palette lamp whose Skin Revision leaves dark moves at no light there; in the original game it stays steady', () => {
  const lamps = [['Palette1', { LightType: 'LT_TexturePaletteLoop', Skin: "Texture'Effects.Corona.Corona_G'" }]];
  const rev = effectsPage({ lamps }), old = effectsPage({ game: 'vanilla', lamps });
  rev.c.stepEffects(1000); old.c.stepEffects(1000);
  assert.equal(rev.level(rev.steps[0], 0), 0);
  assert.equal(old.level(old.steps[0], 0), undefined);                   // not among the lamps that move
});

// ---- a corona hidden by a wall (part B's #13): the page's own wallBetween, on three.js, is what Effects is given
test('a wall of the map between the camera and a lamp hides its corona, not one within the last 2 units; Effects is given wallBetween', { skip: noThree }, () => {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(10, 200, 200), new THREE.MeshBasicMaterial());     // x from -5 to 5
  wall.updateMatrixWorld();
  const c = vm.createContext({ THREE, presentHits: (hits) => hits, worldMeshes: [wall] });
  vm.runInContext(body('wallBetween'), c);
  const at = (x) => new THREE.Vector3(x, 0, 0);
  assert.equal(c.wallBetween(at(-100), at(100)), true);
  assert.equal(c.wallBetween(at(20), at(100)), false);                  // both on one side
  assert.equal(c.wallBetween(at(-100), at(-4)), false);                 // the wall 1 unit before the lamp: a lamp on a wall
  assert.equal(c.wallBetween(at(-100), at(-2)), true);
  c.worldMeshes = [];
  assert.equal(c.wallBetween(at(-100), at(100)), false);
  assert.match(source, /createLightEffects\(THREE, \{ renderer, scene, camera, blocked: wallBetween \}\)/);
});

// ---- the texts (part B's #5): what each game does, not "as their Type, Period and Phase say"
test('Effects\' status line and the shortcuts table say the lamps move as the project\'s game draws them', () => {
  const said = [];
  const c = vm.createContext({ effectsOn: false, lightMode: 'lit', localStorage: { setItem() {} }, applyLighting() {}, wake() {}, status: (t) => said.push(t) });
  vm.runInContext(body('setEffects'), c);
  c.setEffects(true);
  const games = /lamps pulse, blink, flicker and strobe as the project's game draws them \(a blink at random, a flickering lamp dark in Revision\)/;
  assert.match(said[0], games);
  const html = fs.readFileSync(new URL('../editor/static/index.html', import.meta.url), 'utf8');
  assert.match(html, new RegExp('View &gt; Effects[^<]*</td><td>[^<]*' + games.source));
  assert.doesNotMatch(html, /as their Type, Period and Phase say/);
});

// ---- Lights here's surface (batch 6's test gap #5): Special lit as its BSP face's flags say (geoFaces, by triangle),
// else as its mesh's; the lamps asked for (liveLamps' special)
function herePage() {
  const asked = [];
  const c = vm.createContext({ THREE, status() {}, script: 'lab', lampClasses: async () => {}, PF: { special: 0x100000 },
    geoFaces: { 5: { flags: 0 }, 9: { flags: 0x100000 | 0x400000 } },
    liveLamps: (special) => { asked.push(special); return []; }, lightsHere: () => ({ lit: [], blocked: [] }), wallBetween: () => false,
    T: (a) => new THREE.Vector3(a[0], a[2], a[1]), UE: (v) => [v.x, v.z, v.y], openMenu() {}, keyLabel: () => ['', ''], keyOf: () => '',
    specSelect() {}, lightHex: () => '#ffffff', liveLight: () => ({}) });
  vm.runInContext('async ' + body('lightsHereAt'), c);
  const at = (faceIndex, flags = 0) => c.lightsHereAt({ clientX: 0, clientY: 0 }, { face: { normal: new THREE.Vector3(0, 1, 0) }, faceIndex,
    point: new THREE.Vector3(), object: { matrixWorld: new THREE.Matrix4(), userData: { faces: [5, 9, 12], flags } } }, new THREE.Vector3(0, -1, 0));
  return { at, asked };
}

test('Lights here on a Special lit face asks for the Special lit lamps: its face\'s own flags, else its mesh\'s', { skip: noThree }, async () => {
  const { at, asked } = herePage();
  await at(1);                 // face 9: Special lit (and Unlit)
  await at(0);                 // face 5: not
  await at(2, 0x100000);       // face 12, not in the faces read: its mesh's flags
  await at(2);
  assert.deepEqual(asked, [true, false, true, false]);
});
