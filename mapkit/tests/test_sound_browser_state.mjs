import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSoundBrowser } from '../editor/static/sound-browser.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture({ delayedPlay = false, delayedWave = false, withTiles = false, duration = 1 } = {}) {
  const listeners = {}, requests = new Map(), players = [], animations = new Set();
  let animationId = 0, clears = 0;
  const controls = new Map();
  const inspector = { innerHTML: '', querySelector(selector) {
    if (!controls.has(selector)) controls.set(selector, { attributes:{}, style:{setProperty(){}},
      setAttribute(key,value) { this.attributes[key]=value; }, value: '', textContent: '', focus(){},
      getBoundingClientRect:()=>({left:10,width:200}), setPointerCapture(){}, hasPointerCapture:()=>false });
    return controls.get(selector);
  } };
  const buttons = ['Own.First', 'Own.Second'].map(name => ({ dataset: { splay: name }, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; } }));
  const tiles = buttons.map(button => {
    const thumbnail = { dataset: {}, innerHTML: '' }, length = { textContent: '' };
    return { dataset: { snd: button.dataset.splay }, classList: { toggle() {} }, setAttribute() {},
      querySelector: selector => ({ '.sound-thumbnail': thumbnail, '.sound-length': length, '[data-splay]': button }[selector] || null) };
  });
  globalThis.document = { querySelectorAll: () => buttons, activeElement: null };
  globalThis.location = { href: 'http://localhost:8792/' };
  globalThis.requestAnimationFrame = () => { const id = ++animationId; animations.add(id); return id; };
  globalThis.cancelAnimationFrame = id => animations.delete(id);
  globalThis.window = { addEventListener(name, callback) { listeners[name] = callback; }, __workspace: { show() {} },
    AudioContext: class { async decodeAudioData() { return { duration: 1, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => new Float32Array([0, .5, -.5, 0]) }; } async close() {} } };
  globalThis.Audio = class {
    constructor(url) { this.url = url; this.currentTime = 0; this.duration = duration; this.paused = true; this.starts = []; players.push(this); }
    async play() { this.paused = false; this.starts.push(this.currentTime); if (delayedPlay) await new Promise(resolve => { this.finishPlay = resolve; }); }
    pause() { this.paused = true; }
  };
  globalThis.fetch = delayedWave ? () => new Promise(() => {}) : async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(2) });
  let browser;
  browser = createSoundBrowser({ api: url => new Promise(resolve => requests.set(new URL(url, location.href).searchParams.get('name'), resolve)),
    container: { querySelectorAll: () => withTiles ? tiles : [], setAttribute() {} }, inspector: () => inspector,
    onSelect: () => browser.clearSelection(false), onClear: () => { clears++; inspector.innerHTML = 'scene inspector'; } });
  browser.setCatalog({ sounds: [{ name: 'Own.First', own: true }, { name: 'Own.Second', own: true }] });
  return { browser, requests, players, animations, buttons, tiles, inspector, controls, listeners, clears: () => clears };
}

test('late metadata cannot replace the newly selected sound or scene Inspector', async () => {
  const f = fixture();
  await f.browser.selectByName('Own.First');
  await f.browser.selectByName('Own.Second');
  f.requests.get('Own.Second')({ url: '/second.wav', format: 'WAV', seconds: 2, bytes: 0 });
  await flush();
  assert.match(f.inspector.innerHTML, /data-sound-inspector="Own.Second"/);
  assert.match(f.inspector.innerHTML, /<dt>Size<\/dt><dd>—<\/dd>/);
  assert.match(f.browser.tileHtml({ name: 'Own.Second', own: true }), /sound-length">2\.0 s/);
  f.requests.get('Own.First')({ url: '/first.wav', format: 'WAV', seconds: 1 });
  await flush();
  assert.match(f.inspector.innerHTML, /data-sound-inspector="Own.Second"/);
  f.browser.clearSelection();
  assert.equal(f.inspector.innerHTML, 'scene inspector');
  assert.equal(f.browser.selection(), null);
});

test('stopping while a preview request is pending prevents delayed playback', async () => {
  const f = fixture();
  const pending = f.browser.play('Own.First');
  f.browser.stop();
  f.requests.get('Own.First')({ url: '/first.wav' });
  await pending;
  assert.equal(f.players.length, 0);
});

test('a second press cancels loading immediately and cannot start audio later', async () => {
  const f = fixture();
  const pending = f.browser.play('Own.First');
  assert.equal(f.buttons[0].attributes['aria-label'], 'Stop First');
  assert.equal(f.buttons[0].attributes['aria-busy'], 'true');
  const cancel = f.browser.play('Own.First');
  assert.equal(f.buttons[0].attributes['aria-label'], 'Play First');
  assert.equal(f.buttons[0].attributes['aria-busy'], 'false');
  f.requests.get('Own.First')({ url: '/first.wav' });
  await Promise.all([pending, cancel]);
  assert.equal(f.players.length, 0);
});

test('Space on a wired tile cancels a pending preview and stops active playback', async () => {
  const f = fixture({ withTiles: true });
  f.browser.wireTiles();
  const tile = f.tiles[0];
  let prevented = 0, stopped = 0;
  const space = () => tile.onkeydown({ target: tile, key: ' ', preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  space();
  assert.equal(f.browser.selection().name, 'Own.First');
  assert.equal(f.buttons[0].attributes['aria-busy'], 'true');
  space();
  assert.equal(f.buttons[0].attributes['aria-label'], 'Play First');
  assert.equal(f.buttons[0].attributes['aria-busy'], 'false');
  f.requests.get('Own.First')({ url: '/first.wav' }); await flush();
  assert.equal(f.players.length, 0, 'Cancelled metadata must not start playback later');
  space(); await flush();
  assert.equal(f.players.length, 1);
  assert.equal(f.players[0].paused, false);
  space();
  assert.equal(f.players[0].paused, true, 'Space pauses the playing preview synchronously');
  assert.equal(f.buttons[0].attributes['aria-label'], 'Play First');
  await flush();
  assert.equal(f.players.length, 1, 'Stopping must not create a replacement player');
  assert.equal(prevented, 4); assert.equal(stopped, 4);
});

test('rapid different previews then Stop discard every late result', async () => {
  const f = fixture();
  const first = f.browser.play('Own.First');
  const second = f.browser.play('Own.Second');
  assert.equal(f.buttons[0].attributes['aria-label'], 'Play First');
  assert.equal(f.buttons[1].attributes['aria-label'], 'Stop Second');
  f.browser.stop();
  f.requests.get('Own.Second')({ url: '/second.wav' });
  f.requests.get('Own.First')({ url: '/first.wav' });
  await Promise.all([first, second]);
  assert.equal(f.players.length, 0);
  assert.ok(f.buttons.every(button => button.attributes['aria-label'].startsWith('Play ')));
});

test('Stop pauses synchronously while the media play promise is pending', async () => {
  const f = fixture({ delayedPlay: true });
  const pending = f.browser.play('Own.First');
  f.requests.get('Own.First')({ url: '/first.wav' }); await flush();
  assert.equal(f.players[0].paused, false);
  f.browser.stop();
  assert.equal(f.players[0].paused, true);
  assert.equal(f.players[0].currentTime, 0);
  f.players[0].finishPlay(); await pending;
  assert.equal(f.players[0].paused, true);
  assert.equal(f.animations.size, 0);
});

test('switch and Stop pause immediately without waiting for the waveform', async () => {
  const f = fixture({ delayedWave: true });
  const first = f.browser.play('Own.First');
  f.requests.get('Own.First')({ url: '/first.wav' }); await first;
  f.players[0].currentTime = .5;
  const second = f.browser.play('Own.Second');
  assert.equal(f.players[0].paused, true);
  assert.equal(f.players[0].currentTime, 0);
  assert.equal(f.animations.size, 0);
  f.requests.get('Own.Second')({ url: '/second.wav' }); await second;
  f.browser.stop();
  assert.equal(f.players[1].paused, true);
  assert.equal(f.animations.size, 0);
});

test('only one preview and animation loop run; map changes clear the asset', async () => {
  const f = fixture();
  await f.browser.selectByName('Own.First');
  f.requests.get('Own.First')({ url: '/first.wav', seconds: 1 }); await flush();
  await f.browser.play('Own.First'); await flush();
  assert.equal(f.players.length, 1);
  assert.equal(f.animations.size, 1);
  f.browser.renderInspector(); f.browser.renderInspector();
  assert.equal(f.animations.size, 1);
  const second = f.browser.play('Own.Second');
  f.requests.get('Own.Second')({ url: '/second.wav', seconds: 1 }); await second; await flush();
  assert.equal(f.players[0].paused, true);
  assert.equal(f.players[1].paused, false);
  assert.equal(f.animations.size, 1);
  f.listeners['deusedix:map-state']({ detail: { open: false } });
  assert.equal(f.players[1].paused, true);
  assert.equal(f.animations.size, 0);
  assert.equal(f.browser.selection(), null);
  assert.equal(f.clears(), 1);
});

test('download drag data exists only after imported audio is prepared', async () => {
  const f = fixture();
  assert.equal(f.browser.getDragData('Own.First'), null);
  await f.browser.selectByName('Own.First');
  f.requests.get('Own.First')({ url: '/cache/first.wav' }); await flush();
  assert.deepEqual(f.browser.getDragData('Own.First'), { url: 'http://localhost:8792/cache/first.wav', filename: 'First.wav' });
  assert.equal(f.browser.getDragData('Unknown.GameSound'), null);
});

test('a cursor can be set before first Play; selecting and decoding never plays audio', async () => {
  const f = fixture({duration:10});
  await f.browser.selectByName('Own.First');
  f.requests.get('Own.First')({url:'/first.wav',seconds:10}); await flush();
  assert.equal(f.players.length,0);
  assert.match(f.inspector.innerHTML,/Audio waveform/);
  assert.equal(f.browser.seek('Own.First',5),true);
  assert.equal(f.controls.get('[data-sound-seek]').attributes['aria-valuenow'],'5');
  await f.browser.play('Own.First');
  assert.deepEqual(f.players[0].starts,[5]);
  f.browser.stop();
});

test('Pause and Play resume the same preview at its cursor without another request', async () => {
  const f=fixture({duration:10});
  const pending=f.browser.play('Own.First'); f.requests.get('Own.First')({url:'/first.wav',seconds:10}); await pending;
  f.players[0].currentTime=4;
  await f.browser.play('Own.First');
  assert.equal(f.players[0].paused,true); assert.equal(f.players[0].currentTime,4); assert.equal(f.animations.size,0);
  f.browser.seek('Own.First',7);
  await f.browser.play('Own.First');
  assert.equal(f.players.length,1); assert.deepEqual(f.players[0].starts,[0,7]);
  assert.equal(f.buttons[0].attributes['aria-label'],'Pause First');
  f.browser.stop();
});

test('seek during playback updates immediately and clamps to the duration', async () => {
  const f=fixture({duration:10});
  const pending=f.browser.play('Own.First'); f.requests.get('Own.First')({url:'/first.wav',seconds:10}); await pending;
  f.browser.seek('Own.First',6); assert.equal(f.players[0].currentTime,6); assert.equal(f.players[0].paused,false);
  f.browser.seek('Own.First',-20); assert.equal(f.players[0].currentTime,0);
  f.browser.seek('Own.First',100); assert.equal(f.players[0].currentTime,10);
  assert.equal(f.browser.seek('Own.First',NaN),false); assert.equal(f.browser.seek('Missing',4),false);
  f.browser.stop();
});

test('late media metadata uses the most recent chosen position', async () => {
  const f=fixture({duration:NaN});
  await f.browser.selectByName('Own.First'); f.requests.get('Own.First')({url:'/first.wav',seconds:10}); await flush();
  f.browser.seek('Own.First',4); await f.browser.play('Own.First'); f.browser.seek('Own.First',7);
  f.players[0].duration=10; f.players[0].onloadedmetadata();
  assert.equal(f.players[0].currentTime,7);
  f.browser.stop();
});

test('seeking is usable when waveform generation is unavailable', async () => {
  const f=fixture({duration:10});
  await f.browser.selectByName('Own.First');
  f.requests.get('Own.First')({url:'/large.wav',seconds:10,bytes:80*1024*1024}); await flush();
  assert.match(f.inspector.innerHTML,/too large to draw a waveform/);
  assert.equal(f.browser.seek('Own.First',5),true);
  await f.browser.play('Own.First'); assert.equal(f.players[0].currentTime,5);
  f.browser.stop();
});

test('pointer and keyboard cursor controls do not start playback or escape to map shortcuts', async () => {
  const f=fixture({duration:10});
  await f.browser.selectByName('Own.First'); f.requests.get('Own.First')({url:'/first.wav',seconds:10}); await flush();
  const track=f.controls.get('[data-sound-seek]'); let consumed=0;
  const event={button:0,pointerId:1,clientX:110,preventDefault(){consumed++;},stopPropagation(){consumed++;}};
  track.onpointerdown(event); assert.equal(track.attributes['aria-valuenow'],'5');
  track.onpointermove({...event,clientX:150}); assert.equal(track.attributes['aria-valuenow'],'7');
  track.onpointerup(event);
  track.onkeydown({...event,key:'ArrowRight',shiftKey:true}); assert.equal(track.attributes['aria-valuenow'],'8');
  track.onkeydown({...event,key:'Home'}); assert.equal(track.attributes['aria-valuenow'],'0');
  track.onkeydown({...event,key:'End'}); assert.equal(track.attributes['aria-valuenow'],'10');
  assert.equal(f.players.length,0); assert.equal(consumed,9);
});

test('a late Play promise cannot pause a newer resume of the same player', async () => {
  const f=fixture({delayedPlay:true});
  const first=f.browser.play('Own.First'); f.requests.get('Own.First')({url:'/first.wav',seconds:1}); await flush();
  const finishFirst=f.players[0].finishPlay;
  await f.browser.play('Own.First');
  const resumed=f.browser.play('Own.First'), finishResumed=f.players[0].finishPlay;
  finishFirst(); await first; assert.equal(f.players[0].paused,false);
  finishResumed(); await resumed; assert.equal(f.players[0].paused,false); assert.equal(f.players.length,1);
  f.browser.stop();
});
