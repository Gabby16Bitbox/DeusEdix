// A cutscene's events previewed in the editor (static/cutscene-preview.js): what the Events lane has done to the
// objects at time t, as the game does it (UCMotion.Play, the engine's Mover and its door states, ElevatorMover.SetSeq,
// UCLink's hide / show and lights, UCEditorStory.NpcGo), and the subtitles' voices sounding then (UCCutscene.ShowLines).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stateAt, shows, advance, moverFromProps, goal, voicesAt, lineLen, PICK_RAISE } from '../editor/static/cutscene-preview.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
const nearAll = (a, b, eps = 1e-6) => { assert.equal(a.length, b.length); a.forEach((v, i) => near(v, b[i], eps)); };
const ev = (verb, t, name, more = {}) => ({ verb, t, name, ...more });
const props = (p) => (key) => p[key];
// a door that slides 64 units along Y and turns a quarter in one second (MoveTime 1), as DeusExMover's defaults
const door = (more = {}) => ({ mover: moverFromProps(props({ 'KeyPos(1)': '(Y=-64.000000)', 'KeyRot(1)': '(Yaw=16384)', ...more })) });
const targets = (entries) => new Map(Object.entries(entries));

test('what the editor shows of each action, by what the object is', () => {
  const d = door(), motion = { motion: { len: 2, mode: 'once' } }, lamp = { light: { on: true } }, guy = { walker: { from: [0, 0, 0] } };
  assert.ok(shows('open', d) && shows('toggle', d) && shows('anim', d) && shows('animback', d));
  assert.ok(!shows('animstop', d), 'a mover goes on to its key: Stop changes nothing');
  assert.ok(!shows('floor', d) && shows('floor', { ...d, elevator: true }), 'only an elevator has floors');
  assert.ok(shows('anim', motion) && shows('animstop', motion) && !shows('open', motion));
  assert.ok(shows('lightoff', lamp) && !shows('lightoff', motion));
  assert.ok(shows('goto', guy) && shows('run', guy) && shows('stand', guy) && !shows('goto', d));
  for (const v of ['hide', 'show', 'leave', 'appear']) assert.ok(shows(v, {}), v);
  assert.ok(!shows('hide', null), 'an object the editor does not have');
  for (const v of ['message', 'sound', 'goal', 'attack', 'lock', 'explode']) assert.ok(!shows(v, { ...d, ...lamp, ...guy, ...motion }), v);
});

test('a door\'s keys from its properties: offsets from the key it stands at, MoveTime, glide, its delay and timed close', () => {
  const k = door().mover;
  assert.deepEqual(k.keys, [{ pos: [0, 0, 0], rot: [0, 0, 0] }, { pos: [0, -64, 0], rot: [0, 16384, 0] }]);
  assert.deepEqual(k.seg, [1]);
  assert.equal(k.at, 0); assert.equal(k.glide, true); assert.equal(k.delay, 0);
  assert.equal(k.stay, null, 'DeusExMover: TriggerToggle, it stays open');
  const timed = moverFromProps(props({ InitialState: 'TriggerOpenTimed', StayOpenTime: '2.5', DelayTime: '0.5', MoveTime: '3', MoverGlideType: 'MV_MoveByTime' }));
  assert.equal(timed.stay, 2.5); assert.equal(timed.delay, 0.5); assert.deepEqual(timed.seg, [3]); assert.equal(timed.glide, false);
  assert.equal(moverFromProps(props({ InitialState: 'BumpOpenTimed' })).stay, 4, 'Mover\'s StayOpenTime');
  assert.equal(moverFromProps(props({ InitialState: 'TriggerOpenTimed', bTriggerOnceOnly: 'True' })).stay, null, 'once only: it stays open');
  const lift = moverFromProps(props({ NumKeys: '3', KeyNum: '1', 'KeyPos(0)': '(Z=0)', 'KeyPos(1)': '(Z=128.0)', 'KeyPos(2)': '(Z=256.0)' }));
  assert.equal(lift.at, 1);
  assert.deepEqual(lift.keys.map((x) => x.pos[2]), [-128, 0, 128], 'it stands at its key 1');
  assert.equal(moverFromProps(props({ NumKeys: '12' })).keys.length, 8, 'a Mover has 8 keys at most');
});

test('Open: from its first key to its last over MoveTime, gliding; nothing before the event; it stays open', () => {
  const tg = targets({ D: door() }), evs = [ev('open', 2, 'D')];
  assert.equal(stateAt(evs, 1.99, tg).size, 0, 'before its second: as the editor shows it');
  nearAll(stateAt(evs, 2, tg).get('D').pose.pos, [0, 0, 0]);
  nearAll(stateAt(evs, 2.5, tg).get('D').pose.pos, [0, -32, 0]);
  nearAll(stateAt(evs, 2.25, tg).get('D').pose.rot, [0, 16384 * 0.15625, 0], 1e-3);     // eased: 3u² - 2u³
  nearAll(stateAt(evs, 9, tg).get('D').pose.pos, [0, -64, 0]);
  const linear = targets({ D: door({ MoverGlideType: 'MV_MoveByTime' }) });
  nearAll(stateAt(evs, 2.25, linear).get('D').pose.rot, [0, 4096, 0]);
});

test('a timed door waits its DelayTime, opens, stays StayOpenTime, then closes by itself', () => {
  const tg = targets({ D: door({ InitialState: 'TriggerOpenTimed', DelayTime: '1', StayOpenTime: '2' }) }), evs = [ev('open', 0, 'D')];
  nearAll(stateAt(evs, 0.9, tg).get('D').pose.pos, [0, 0, 0]);
  nearAll(stateAt(evs, 1.5, tg).get('D').pose.pos, [0, -32, 0]);
  nearAll(stateAt(evs, 3.9, tg).get('D').pose.pos, [0, -64, 0]);
  nearAll(stateAt(evs, 4.5, tg).get('D').pose.pos, [0, -32, 0]);
  nearAll(stateAt(evs, 6, tg).get('D').pose.pos, [0, 0, 0]);
});

test('Close goes from where it is to its first key in a whole MoveTime; Close at rest and Open while it moves do nothing', () => {
  const tg = targets({ D: door({ MoverGlideType: 'MV_MoveByTime' }) });
  const evs = [ev('open', 0, 'D'), ev('close', 0.5, 'D')];
  nearAll(stateAt(evs, 0.5, tg).get('D').pose.pos, [0, -32, 0]);
  nearAll(stateAt(evs, 1, tg).get('D').pose.pos, [0, -16, 0], 1e-9);                 // half way back in half its MoveTime
  nearAll(stateAt(evs, 1.5, tg).get('D').pose.pos, [0, 0, 0]);
  assert.equal(stateAt([ev('close', 0, 'D')], 1, tg).get('D').pose, undefined, 'shut already');
  nearAll(stateAt([ev('open', 0, 'D'), ev('open', 0.5, 'D')], 0.75, tg).get('D').pose.pos, [0, -48, 0], 1e-9);
});

test('Open or close: opens a shut door, closes an open (or opening) one', () => {
  const tg = targets({ D: door({ MoverGlideType: 'MV_MoveByTime' }) });
  nearAll(stateAt([ev('toggle', 0, 'D')], 1, tg).get('D').pose.pos, [0, -64, 0]);
  nearAll(stateAt([ev('toggle', 0, 'D'), ev('toggle', 2, 'D')], 3, tg).get('D').pose.pos, [0, 0, 0]);
  nearAll(stateAt([ev('toggle', 0, 'D'), ev('toggle', 0.5, 'D')], 1.5, tg).get('D').pose.pos, [0, 0, 0]);
});

test('a mover of several keys goes through them one step at a time; an elevator goes straight to a floor', () => {
  const read = props({ NumKeys: '3', 'KeyPos(1)': '(Z=100)', 'KeyPos(2)': '(Z=300)', MoveTime: '2', MoverGlideType: 'MV_MoveByTime' });
  const tg = targets({ L: { mover: moverFromProps(read), elevator: true } });
  nearAll(stateAt([ev('open', 0, 'L')], 1, tg).get('L').pose.pos, [0, 0, 50]);
  nearAll(stateAt([ev('open', 0, 'L')], 3, tg).get('L').pose.pos, [0, 0, 200]);
  nearAll(stateAt([ev('floor', 0, 'L', { a: '2' })], 1, tg).get('L').pose.pos, [0, 0, 150], 1e-9);  // straight: one MoveTime
  nearAll(stateAt([ev('floor', 0, 'L', { a: '2' }), ev('floor', 1, 'L', { a: '0' })], 3, tg).get('L').pose.pos, [0, 0, 300], 1e-9);
  assert.equal(stateAt([ev('floor', 0, 'L', { a: '7' })], 3, tg).get('L').pose, undefined, 'no such floor');
  // played as an animation (UCMotion.MoverGo): on to its last key, back to its first
  nearAll(stateAt([ev('anim', 0, 'L'), ev('animback', 5, 'L')], 6, tg).get('L').pose.pos, [0, 0, 200]);
});

test('an animation: played, backwards, stopped; once, in a loop, back and forth', () => {
  const tg = (mode) => targets({ A: { motion: { len: 2, mode } } });
  near(stateAt([ev('anim', 1, 'A')], 1.5, tg('once')).get('A').clock, 0.5);
  near(stateAt([ev('anim', 1, 'A')], 9, tg('once')).get('A').clock, 2);
  near(stateAt([ev('anim', 0, 'A'), ev('animstop', 0.75, 'A')], 5, tg('once')).get('A').clock, 0.75);
  near(stateAt([ev('anim', 0, 'A'), ev('animstop', 0.5, 'A'), ev('anim', 1, 'A')], 1.25, tg('once')).get('A').clock, 0.75);
  near(stateAt([ev('animback', 0, 'A')], 0.5, tg('once')).get('A').clock, 1.5);       // from its end
  near(stateAt([ev('anim', 0, 'A'), ev('anim', 3, 'A')], 3.5, tg('once')).get('A').clock, 0.5);   // at its end: from its start
  near(stateAt([ev('anim', 0, 'A')], 2.5, tg('loop')).get('A').clock, 0.5);
  near(stateAt([ev('anim', 0, 'A')], 2.5, tg('pingpong')).get('A').clock, 1.5);
  assert.deepEqual(advance(1, -1, 3, 2, 'once'), { c: 0, playing: false });
  assert.deepEqual(advance(0, 1, 1, 0, 'loop'), { c: 0, playing: false }, 'no length: nothing to play');
});

test('vanish, appear again, leave, come back; lights on, off, on or off', () => {
  const tg = targets({ X: {}, L: { light: { on: true } }, Dark: { light: { on: false } } });
  assert.equal(stateAt([ev('hide', 1, 'X'), ev('show', 3, 'X')], 2, tg).get('X').hidden, true);
  assert.equal(stateAt([ev('hide', 1, 'X'), ev('show', 3, 'X')], 3, tg).get('X').hidden, false);
  assert.equal(stateAt([ev('leave', 1, 'X')], 1, tg).get('X').hidden, true);
  assert.equal(stateAt([ev('leave', 1, 'X'), ev('appear', 2, 'X')], 2, tg).get('X').hidden, false);
  assert.equal(stateAt([ev('lightoff', 0, 'L')], 1, tg).get('L').light, false);
  assert.equal(stateAt([ev('lighttoggle', 0, 'L')], 1, tg).get('L').light, false);
  assert.equal(stateAt([ev('lighttoggle', 0, 'Dark')], 1, tg).get('Dark').light, true);
  assert.equal(stateAt([ev('lighttoggle', 0, 'L'), ev('lighttoggle', 1, 'L')], 1, tg).get('L').light, true);
});

test('events of one second happen in the rule\'s order; later ones and what the editor cannot show are left out', () => {
  const tg = targets({ X: {}, D: door() });
  assert.equal(stateAt([ev('hide', 1, 'X'), ev('show', 1, 'X')], 1, tg).get('X').hidden, false);
  assert.equal(stateAt([ev('show', 1, 'X'), ev('hide', 1, 'X')], 1, tg).get('X').hidden, true);
  assert.equal(stateAt([ev('hide', 2, 'X'), ev('show', 1, 'X')], 2, tg).get('X').hidden, true, 'by their seconds first');
  assert.equal(stateAt([ev('lock', 0, 'D'), ev('message', 0, 'D'), ev('hide', 0, 'Nobody')], 5, tg).size, 0);
});

test('Walk / Run to a place: there at its speed, facing the way; Stand still stops it; a new place from where it is', () => {
  const walker = { from: [0, 0, 50], yaw: 0, walk: 100, run: 300, height: 50 };
  const tg = targets({ G: { walker } }), to = [1000, 0, 40];          // picked 40 above the floor at z 0
  assert.deepEqual(goal(to, 50), [1000, 0, 50]);
  assert.equal(PICK_RAISE, 40);
  const w = (evs, t, route) => stateAt(evs, t, tg, route).get('G').walk;
  nearAll(w([ev('goto', 1, 'G', { at: to })], 3).pos, [200, 0, 50]);
  assert.equal(w([ev('goto', 1, 'G', { at: to })], 3).moving, true);
  assert.equal(w([ev('goto', 1, 'G', { at: to })], 3).walked, 2);
  nearAll(w([ev('run', 0, 'G', { at: to })], 2).pos, [600, 0, 50]);
  assert.equal(w([ev('run', 0, 'G', { at: to })], 2).run, true);
  const there = w([ev('goto', 0, 'G', { at: to })], 60);
  nearAll(there.pos, [1000, 0, 50]); assert.equal(there.moving, false); near(there.walked, 10);
  const back = w([ev('goto', 0, 'G', { at: [0, -500, 40] })], 2);
  assert.equal(back.yaw, -16384, 'facing where it goes (a quarter turn to -Y)');
  nearAll(w([ev('goto', 0, 'G', { at: to }), ev('stand', 2, 'G')], 9).pos, [200, 0, 50]);
  // a new place half way: from where it is then
  nearAll(w([ev('goto', 0, 'G', { at: to }), ev('goto', 2, 'G', { at: [200, 400, 40] })], 3).pos, [200, 100, 50]);
  assert.equal(stateAt([ev('goto', 0, 'G')], 3, tg).get('G').walk, undefined, 'no place chosen: it stays where it is');
});

test('a walk follows the way the caller gives (the AI paths), turning at each corner', () => {
  const tg = targets({ G: { walker: { from: [0, 0, 50], yaw: 0, walk: 100, run: 300, height: 50 } } });
  const asked = [];
  const route = (from, to, e) => { asked.push([from, to, e.nav]); return [from, [0, 300, 50], to]; };
  const evs = [ev('goto', 0, 'G', { at: [400, 300, 40], nav: false })];
  const mid = stateAt(evs, 2, tg, route).get('G').walk;
  nearAll(mid.pos, [0, 200, 50]); assert.equal(mid.yaw, 16384);
  const corner = stateAt(evs, 4, tg, route).get('G').walk;
  nearAll(corner.pos, [100, 300, 50]); assert.equal(corner.yaw, 0);
  assert.deepEqual(asked[0], [[0, 0, 50], [400, 300, 50], false]);
});

test('voices: a line\'s sound from when the line shows, to its end; a later line takes over, an earlier one comes back', () => {
  const len = { 'V.A': 3, 'V.B': 1 };
  const lines = [{ t: 1, d: 2, text: 'Hello', snd: 'V.A' }, { t: 5, d: 4, text: 'Long', snd: 'V.B' }, { t: 6, d: 1, text: 'Short', snd: 'V.A' },
    { t: 0, d: 9, text: '', snd: 'V.B' }];                // no text: not in the game
  const at = (t) => voicesAt(lines, t, (s) => len[s]).map((v) => [v.line, v.sound, Math.round(v.from * 100) / 100]);
  assert.deepEqual(at(0.5), []);
  assert.deepEqual(at(1), [[0, 'V.A', 0]]);
  assert.deepEqual(at(3.5), [[0, 'V.A', 2.5]], 'the voice goes on after its subtitle');
  assert.deepEqual(at(4.5), []);
  assert.deepEqual(at(5.5), [[1, 'V.B', 0.5]]);
  assert.deepEqual(at(6.5), [[2, 'V.A', 0.5]]);
  assert.deepEqual(at(7.2), [[2, 'V.A', 1.2], [1, 'V.B', 0.2]], 'the long line shows again: its voice again');
  assert.deepEqual(voicesAt(lines, 1.5, () => undefined), [], 'a sound not read yet');
  assert.equal(lineLen({ text: 'abc', d: 0 }), 2.18);
});
