// The Logic simulator, "Try it" (static/logic-sim.js): the compiled logic played as the game's UCLink plays it. Every
// behaviour fixture (tests/fixtures/logic, written by hand from UCLink.uc and friends) must come out as the game's
// lines at the game's times; the maps of tests/logic_sim_cases.json (compiled by links.py: test_logic_compile.py
// checks them) drive the rest: what the user decides, the clock, the state, the counts and "why didn't it fire?".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createSession } from '../editor/static/logic-sim.js';
import { vocabulary } from '../editor/static/logic-vocab.js';
import { LOGIC_TAG, parseLogicLine } from '../editor/static/logic-log.js';

const kit = new URL('../', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, kit), 'utf8'));
const logic = read('editor/config/logic.json');
const fixtures = readdirSync(new URL('tests/fixtures/logic/', kit)).filter((f) => f.endsWith('.json')).sort()
  .map((f) => read(`tests/fixtures/logic/${f}`));
const { cases } = read('tests/logic_sim_cases.json');
const vocab = vocabulary(logic);
const fixture = (id) => fixtures.find((fx) => fx.id === id);

const sessionOf = (fx, more = {}) => createSession({ actors: fx.compiled, outputs: logic.outputs, world: fx.world, start: fx.start,
  map: fx.map, frame: fx.frame, ...more });
// a fixture played: each input at its time (the player's part of its tick), then on to its last tick
function play(fx, more) {
  const s = sessionOf(fx, more);
  for (const input of fx.inputs) {
    s.scrub(input.t);
    if (input.fire) s.fire(input.fire); else s.set(input.set);
  }
  s.scrub(fx.until);
  return s;
}
// a case of logic_sim_cases.json, named with the vocabulary as the page will
const open = (name, more = {}) => createSession({ ...cases[name], outputs: logic.outputs, map: 'M', vocab, ...more });
const lines = (s) => s.log().map(({ t, line }) => `${t} ${line}`);
const at = (s, t, f) => { s.scrub(t); return f(s); };

test('there are fixtures and cases to play', () => {
  assert.ok(fixtures.length >= 25, `${fixtures.length} fixtures`);
  assert.ok(Object.keys(cases).length >= 8);
});

test('every behaviour fixture writes the lines the game writes, at its times (to 1 ms), and ends in its state', () => {
  for (const fx of fixtures) {
    const s = play(fx), log = s.log(), have = [], want = [];
    let i = 0;
    for (const e of fx.expected) {          // an anyOrder group: its lines as a set (the map's actor order, A2)
      const n = e.anyOrder ? e.anyOrder.length : 1, part = log.slice(i, i + n);
      i += n;
      have.push({ ms: part.map((l) => Math.round(l.t * 1000)), lines: part.map((l) => l.line).sort() });
      want.push({ ms: Array(n).fill(Math.round(e.t * 1000)), lines: [...(e.anyOrder || [e.line])].sort() });
    }
    assert.deepEqual(have, want, fx.id);
    assert.deepEqual(log.slice(i).map((l) => l.line), [], `${fx.id}: lines the game does not write`);
    const state = s.state();
    for (const [part, values] of Object.entries(fx.end || {})) {
      for (const [name, value] of Object.entries(values)) assert.deepEqual(state[part][name], value, `${fx.id}: ${part}.${name}`);
    }
  }
});

test('every line is one the Console reads (logic-log.js)', () => {
  const all = [...fixtures.map((fx) => play(fx)), ...Object.keys(cases).map((name) => at(open(name), 8, (s) => s))];
  for (const s of all) for (const { line } of s.log()) assert.ok(parseLogicLine(LOGIC_TAG + line), line);
});

test('a condition the game does not know: a bad line, and the rule refused on it', () => {
  const fx = structuredClone(fixture('condition_flag'));
  fx.compiled.find((a) => a.cls === 'UCLink').props['Cond(0)'] = '"weird|x"';      // a map from a newer editor
  const s = play(fx);
  assert.deepEqual(s.log().slice(0, 2).map((l) => l.line), ['bad|LogicFixtures||weird|x', 'skip|LogicFixtures|L1|cond|weird|x']);
});

// ---------------------------------------------------------------- what only the game decides
test('a door blown up by an action: its destroyed rules run on their next Tick, not its opened ones', () => {
  const s = open('doors');
  at(s, 1, () => s.fire({ thing: 'Button1', output: 'used' }));
  s.scrub(1.5);
  assert.deepEqual(lines(s), ['1 fire|M|L1|Button1|used|JCDentonMale0|Button1 used', '1.1 act|M|L1|blow|Door1|',
    '1.1 fire|M|L3|Door1|destroyed|Door1|Door1 destroyed', '1.1 act|M|L3|message||Door1 destroyed']);
  assert.deepEqual(s.state().destroyed, ['Door1']);
});

test('a door opened by an action leaves "has opened" to the user; open on what is no door cannot', () => {
  const s = open('doors');
  at(s, 2, () => s.fire({ thing: 'Button2', output: 'used' }));
  s.scrub(2.4);
  assert.deepEqual(s.decisions(), [{ id: 'opened:Door2', thing: 'Door2', output: 'opened', by: 'Door2', text: 'Door2: it has opened' }]);
  s.decide('opened:Door2');
  s.scrub(3);
  assert.deepEqual(lines(s).slice(1), ['2.1 act|M|L4|open|Door2|', '2.1 act|M|L4|open|Crate1|', '2.1 fail|M|L4|open|Crate1|cannot',
    '2.5 fire|M|L5|Door2|opened|Door2|Door2 opened', '2.5 act|M|L5|message||Door2 opened']);
  assert.deepEqual(s.decisions(), [], 'decided');
});

test('a character sent somewhere, an object used by a character, an animation: offered, then decided', () => {
  const s = open('decisions');
  at(s, 1, () => s.fire({ thing: 'Button1', output: 'used' }));
  s.scrub(1.2);
  assert.deepEqual(s.decisions().map((d) => [d.id, d.by, d.text]), [
    ['arrived:Guard1', 'Guard1', 'Guard1: they get where they were sent (Walk / Run to a place)'],
    ['npcused:Crate1', 'Guard1', 'Crate1: a character has used it'],
    ['animdone:Crate2', 'UCMotion_Crate2', 'Crate2: its animation has finished']]);
  s.decide('arrived:Guard1');
  s.decide('npcused:Crate1');
  assert.deepEqual(s.state().at, { Guard1: [512, 0, 0] }, 'there now');
  at(s, 2, () => s.fire({ thing: 'Button2', output: 'used' }));
  s.scrub(2.2);
  assert.deepEqual(s.decisions(), [], 'the animation stopped: nothing left to decide');
  s.fire({ thing: 'Guard1', output: 'dies' });
  assert.deepEqual(s.state().dead, ['Guard1'], 'who dies is dead');
  assert.deepEqual(lines(s).slice(4), ['1.2 fire|M|L3|Crate1|npcused|Guard1|Crate1 npcused', '1.3 act|M|L3|message||used',
    '1.5 fire|M|L2|Guard1|arrived||Guard1 arrived', '1.6 act|M|L2|message||there',     // watched: at the next look
    '2 fire|M|L5|Button2|used|JCDentonMale0|Button2 used', '2.1 act|M|L5|animstop|Crate2|']);
});

test('the end of an animation is set off by its UCMotion (UCLink.Who), or by the object when the world does not say', () => {
  const s = open('decisions');
  at(s, 1, () => s.fire({ thing: 'Button1', output: 'used' }));
  at(s, 1.2, () => s.decide('animdone:Crate2'));
  assert.equal(lines(s).at(-1), '1.2 fire|M|L4|Crate2|animdone|UCMotion_Crate2|Crate2 animdone');
  const fired = open('decisions');
  assert.deepEqual(at(fired, 1, () => fired.fire({ thing: 'Crate2', output: 'animdone' })),
    [{ t: 1, line: 'fire|M|L4|Crate2|animdone|UCMotion_Crate2|Crate2 animdone' }], 'made to happen by the user, the same');
  const world = structuredClone(cases.decisions.world);
  delete world.actors.find((a) => a.name === 'Crate2').motion;
  const plain = open('decisions', { world });
  assert.deepEqual(at(plain, 1, () => plain.fire({ thing: 'Crate2', output: 'animdone' })).map((l) => l.line),
    ['fire|M|L4|Crate2|animdone|Crate2|Crate2 animdone']);
});

test('a cutscene: its start rules at once, no looks while it plays, and skipped its start rules hurry', () => {
  const s = open('cutscene');
  at(s, 1, () => s.set({ jc: [0, 0, 0] }));                 // the player near the crate while it plays: nobody looks
  s.scrub(2);
  assert.deepEqual(s.decisions().map((d) => d.id), ['cutdone:Cut1', 'skip:Cut1']);
  s.decide('skip:Cut1');
  s.scrub(3);
  assert.deepEqual(lines(s), ['0.5 fire|M|L1||start||start', '0.6 act|M|L1|cutplay|Cut1|', '0.6 fire|M|L2|Cut1|cutstart|Cut1|Cut1 cutstart',
    '0.6 act|M|L2|message||a', '2 fire|M|L3|Cut1|cutdone|Cut1|Cut1 cutdone', '2.1 act|M|L2|message||b', '2.1 act|M|L3|message||over',
    '2.5 fire|M|L4|Crate1|near||Crate1 near', '2.6 act|M|L4|message||near']);
  const played = open('cutscene');
  at(played, 1.5, () => played.decide('cutdone:Cut1'));      // not skipped: its start rule keeps its 5 s
  played.scrub(6);
  assert.deepEqual(lines(played).slice(4), ['1.5 fire|M|L3|Cut1|cutdone|Cut1|Cut1 cutdone', '1.6 act|M|L3|message||over',
    '5.6 act|M|L2|message||b']);
});

test('a rule that stops a cutscene ends it as skipped: its start rules hurry, then its end rules are told', () => {
  const s = open('cutstop');                                  // Timer1 runs out at 1.9 s, while L2 waits for its 5 s
  s.scrub(1);
  assert.deepEqual(s.decisions().map((d) => d.id), ['cutdone:Cut1', 'skip:Cut1']);
  s.scrub(3);
  assert.deepEqual(lines(s), ['0.5 fire|M|L1||start||start', '0.6 act|M|L1|cutplay|Cut1|', '0.6 fire|M|L2|Cut1|cutstart|Cut1|Cut1 cutstart',
    '0.6 act|M|L2|message||a', '1.9 fire|M|L3|Timer1|finished|Timer1|Timer1 finished', '1.9 act|M|L3|cutstop|Cut1|',
    '1.9 fire|M|L4|Cut1|cutdone|Cut1|Cut1 cutdone', '1.9 act|M|L4|message||over', '2 act|M|L2|message||b']);
  assert.deepEqual([s.decisions(), s.state().playing], [[], []], 'nothing left to decide, nothing plays');
});

test('cutplay on a cutscene that plays does nothing, nor on one played only once, nor on one with no keys', () => {
  const s = open('cutplay');
  for (const [t, thing] of [[1, 'Button1'], [2, 'Button1']]) at(s, t, () => s.fire({ thing, output: 'used' }));
  at(s, 2.5, () => s.decide('cutdone:Cut1'));
  for (const [t, thing] of [[3, 'Button1'], [4, 'Button4']]) at(s, t, () => s.fire({ thing, output: 'used' }));
  s.scrub(5);
  assert.deepEqual(lines(s), ['1 fire|M|L1|Button1|used|JCDentonMale0|Button1 used', '1.1 act|M|L1|cutplay|Cut1|',
    '1.1 fire|M|L5|Cut1|cutstart|Cut1|Cut1 cutstart', '1.1 act|M|L5|message||one',
    '2 fire|M|L1|Button1|used|JCDentonMale0|Button1 used', '2.1 act|M|L1|cutplay|Cut1|',              // it plays
    '2.5 fire|M|L7|Cut1|cutdone|Cut1|Cut1 cutdone', '2.6 act|M|L7|message||one over',
    '3 fire|M|L1|Button1|used|JCDentonMale0|Button1 used', '3.1 act|M|L1|cutplay|Cut1|',              // only once
    '4 fire|M|L4|Button4|used|JCDentonMale0|Button4 used', '4.1 act|M|L4|cutplay|Cut3|']);             // no keys
  assert.deepEqual([s.state().played, s.state().playing], [['Cut1'], []]);
  const again = open('cutplay');                              // Cut2 plays again (its once is false)
  at(again, 1, () => again.fire({ thing: 'Button2', output: 'used' }));
  at(again, 1.5, () => again.decide('cutdone:Cut2'));
  at(again, 2, () => again.fire({ thing: 'Button2', output: 'used' }));
  again.scrub(2.5);
  assert.deepEqual(lines(again).filter((l) => l.includes('cutstart')), ['1.1 fire|M|L6|Cut2|cutstart|Cut2|Cut2 cutstart',
    '2.1 fire|M|L6|Cut2|cutstart|Cut2|Cut2 cutstart']);
});

test('a cutscene played while another plays waits, and starts in its own turn once that one has ended', () => {
  const s = open('cutplay');
  at(s, 1, () => s.fire({ thing: 'Button1', output: 'used' }));
  at(s, 2, () => s.fire({ thing: 'Button2', output: 'used' }));
  s.scrub(2.2);
  assert.deepEqual([s.state().playing, s.state().queued], [['Cut1'], ['Cut2']]);
  assert.deepEqual(s.decisions().map((d) => d.id), ['cutdone:Cut1', 'skip:Cut1'], 'its end is not offered while it waits');
  assert.deepEqual(s.runToNext(), { t: 2.2, stopped: null, idle: true }, 'only the end of the other starts it');
  at(s, 3, () => s.decide('cutdone:Cut1'));
  s.scrub(3.5);
  assert.deepEqual(lines(s).slice(4), ['2 fire|M|L2|Button2|used|JCDentonMale0|Button2 used', '2.1 act|M|L2|cutplay|Cut2|',
    '3 fire|M|L7|Cut1|cutdone|Cut1|Cut1 cutdone', '3.1 fire|M|L6|Cut2|cutstart|Cut2|Cut2 cutstart', '3.1 act|M|L6|message||two',
    '3.1 act|M|L7|message||one over']);
  assert.deepEqual([s.state().playing, s.state().queued], [['Cut2'], []]);
  const set = open('cutplay');                                // the other's end set by hand: due in the next tick
  at(set, 1, () => set.fire({ thing: 'Button1', output: 'used' }));
  at(set, 2, () => set.fire({ thing: 'Button2', output: 'used' }));
  at(set, 2.5, () => set.set({ playing: [] }));
  assert.equal(set.runToNext().t, 2.6);
  assert.deepEqual(lines(set).slice(-2), ['2.6 fire|M|L6|Cut2|cutstart|Cut2|Cut2 cutstart', '2.6 act|M|L6|message||two']);
});

test('a cutscene stopped while it waits never starts', () => {
  const s = open('cutplay');
  for (const [t, thing] of [[1, 'Button1'], [2, 'Button2'], [2.5, 'Button3']]) at(s, t, () => s.fire({ thing, output: 'used' }));
  at(s, 3, () => s.decide('cutdone:Cut1'));
  s.scrub(4);
  assert.deepEqual(lines(s).slice(6), ['2.5 fire|M|L3|Button3|used|JCDentonMale0|Button3 used', '2.6 act|M|L3|cutstop|Cut2|',
    '3 fire|M|L7|Cut1|cutdone|Cut1|Cut1 cutdone', '3.1 act|M|L7|message||one over']);
  assert.deepEqual([s.state().playing, s.state().queued, s.state().played], [[], [], ['Cut1']]);
});

test("a cutscene's end is the user's to decide even when no rule waits for it, so one waiting behind it never waits for ever", () => {
  // the cutplay map without L7: no rule waits for Cut1's end; L6 waits for Cut2's start
  const map = { actors: cases.cutplay.actors.filter((a) => a.name !== 'UCLink_L7') };
  for (const [id, ends] of [['cutdone:Cut1', 'ended'], ['skip:Cut1', 'skipped by the player']]) {
    const s = open('cutplay', map);
    at(s, 1, () => s.fire({ thing: 'Button1', output: 'used' }));
    at(s, 2, () => s.fire({ thing: 'Button2', output: 'used' }));
    s.scrub(2.2);
    assert.deepEqual([s.state().playing, s.state().queued], [['Cut1'], ['Cut2']]);
    assert.deepEqual(s.decisions().map((d) => d.id), ['cutdone:Cut1', 'skip:Cut1'], 'its end is offered');
    at(s, 3, () => s.decide(id));
    s.scrub(3.5);
    assert.deepEqual(lines(s).slice(-2), ['3.1 fire|M|L6|Cut2|cutstart|Cut2|Cut2 cutstart', '3.1 act|M|L6|message||two'],
      `Cut1 ${ends}, Cut2 starts in the next tick`);
    assert.deepEqual([s.state().playing, s.state().queued, s.decisions().map((d) => d.id)], [['Cut2'], [], ['cutdone:Cut2', 'skip:Cut2']]);
  }
});

test('what a target cannot do: cannot, nofloor, noscript, and the next actions still run', () => {
  const s = open('cannot');
  at(s, 1, () => s.fire({ thing: 'Button1', output: 'used' }));
  s.scrub(1.5);
  assert.deepEqual(lines(s).slice(1), ['1.1 act|M|L1|timerstart|Crate1|', '1.1 fail|M|L1|timerstart|Crate1|cannot',
    '1.1 act|M|L1|cutplay|Crate1|', '1.1 fail|M|L1|cutplay|Crate1|cannot', '1.1 act|M|L1|floor|Lift1|5', '1.1 fail|M|L1|floor|Lift1|nofloor',
    '1.1 act|M|L1|floor|Lift1|1', '1.1 act|M|L1|floor|Crate1|0', '1.1 fail|M|L1|floor|Crate1|cannot', '1.1 act|M|L1|open|Crate1|',
    '1.1 fail|M|L1|open|Crate1|cannot', '1.1 act|M|L1|input|Crate1|Go', '1.1 fail|M|L1|input|Crate1|noscript', '1.1 act|M|L1|message||after']);
});

test('a timer that starts with the map and loops counts from the first tick, in its own turn', () => {
  const s = open('timers');
  assert.deepEqual(s.state().timers, { Timer1: { running: true, paused: false, left: 0.9 } });
  s.scrub(3);
  assert.deepEqual(lines(s).filter((l) => l.includes('fire')), ['0.9 fire|M|L1|Timer1|finished|Timer1|Timer1 finished',
    '1.9 fire|M|L1|Timer1|finished|Timer1|Timer1 finished', '2.9 fire|M|L1|Timer1|finished|Timer1|Timer1 finished']);
  assert.deepEqual(s.state().counters, { Ticks: 3 });
});

test("names ignore case as the game's do, and a text's backslash is the T3D's doubled one", () => {
  const s = open('names');
  at(s, 1, () => s.fire({ thing: 'Button1', output: 'used' }));
  at(s, 2, () => s.fire({ thing: 'Button2', output: 'used' }));
  at(s, 3, () => s.fire({ thing: 'Button1', output: 'used' }));
  s.scrub(3.5);
  assert.deepEqual(lines(s), ['1 skip|M|L1|cond|flag|Ready|1', '2 fire|M|L2|Button2|used|JCDentonMale0|Button2 used',
    '2.1 act|M|L2|flag||ready', '2.1 act|M|L2|lightoff|tag RED', '2.1 act|M|L2|lightoff|Light1|',
    '3 fire|M|L1|Button1|used|JCDentonMale0|Back\\slash', '3.1 act|M|L1|message||a\\b']);
});

test('a script switched on says what its Triggered() says, and its rules are told at once', () => {
  const s = open('script_on');
  at(s, 1, () => s.fire({ thing: 'Button1', output: 'used' }));
  s.scrub(1.5);
  assert.deepEqual(lines(s).slice(1), ['1.1 act|M|L1|on|Gen0|', '1.1 fire|M|L2|Gen0|output|Gen0|Gen0 output',
    '1.1 output|M|Gen0|Ready|1', '1.1 act|M|L2|message||ready']);
  assert.deepEqual(s.state().scripts, { Gen0: { started: true, waiting: [] } });
});

test('a watched output made to happen changes the world, and its rule notices at its next look', () => {
  const s = open('why');
  at(s, 1.2, () => s.fire({ thing: 'Crate1', output: 'near' }));
  assert.deepEqual(s.state().jc, [300, 0, 0], 'the player is at the crate');
  s.scrub(1.6);
  assert.deepEqual(lines(s).slice(-2), ['1.5 fire|M|L8|Crate1|near||Crate1 near', '1.6 act|M|L8|message||near']);
  const fx = fixture('picked_watch'), p = sessionOf(fx);
  at(p, 1.2, () => p.fire({ thing: 'MedKit1', output: 'picked' }));
  p.scrub(1.6);
  assert.deepEqual(p.state().owned, ['MedKit1']);
  assert.deepEqual(lines(p), ['1.5 fire|LogicFixtures|L1|MedKit1|picked||When JC picks up MedKit1: the message Taken',
    '1.6 act|LogicFixtures|L1|message||Taken']);
});

test('what is not there says nothing; an output the catalogue does not know, or a part of no state, is refused', () => {
  const s = open('why');
  assert.deepEqual(s.fire({ thing: 'Ghost1', output: 'used' }), []);
  const aims = sessionOf(fixture('missing_source_hook'));
  assert.deepEqual(aims.fire({ thing: 'AllyTrig1', output: 'any' }), [], 'its event is its targets: the rule never hooked it');
  assert.throws(() => s.fire({ thing: 'Button1', output: 'sneezes' }), /sneezes/);
  assert.throws(() => s.set({ mood: 'calm' }), /mood/);
  assert.throws(() => createSession({ ...cases.why }), /outputs/);
});

// ---------------------------------------------------------------- the clock
test('the clock goes back and forward again; something new after going back is a new branch', () => {
  const s = open('why');
  for (const [t, thing] of [[1, 'Button1'], [1.5, 'Lever1'], [2, 'Button2'], [3, 'Button2']]) at(s, t, () => s.fire({ thing, output: 'used' }));
  s.scrub(6.5);
  const whole = s.log();
  assert.deepEqual(s.scrub(2), { t: 2, stopped: null });
  assert.deepEqual(s.log(), whole.filter((l) => l.t <= 2), 'as it was at 2 s, what the player did then included');
  assert.equal(s.back().t, 1.9);
  s.scrub(6.5);
  assert.deepEqual(s.log(), whole, 'and forward again the same');
  s.scrub(2);
  s.fire({ thing: 'Lever1', output: 'used' });
  s.scrub(6.5);
  assert.ok(!s.log().some((l) => l.t === 3), 'what was done at 3 s is gone');
  assert.equal(s.restart().t, 0);
  assert.deepEqual(lines(s), ['0 hook|M|L7|Ghost1|missing'], 'from the start, nothing done');
});

test('run to the next thing due by itself: an action, a timer; idle when nothing is', () => {
  const s = sessionOf(fixture('once_checked_before_running'));
  at(s, 1, () => s.fire({ thing: 'Button1', output: 'used' }));
  assert.equal(s.runToNext().t, 1.1);
  assert.equal(s.runToNext().t, 4.1);
  assert.deepEqual(s.runToNext(), { t: 4.1, stopped: null, idle: true });
  assert.deepEqual(s.decisions(), [], 'Door1 opens, but no rule waits for it to have opened: nothing to decide');
  assert.equal(open('timers').runToNext().t, 0.9);
  assert.equal(open('why').runToNext().t, 0.5, 'the map starts at the first look');
});

test('the loop guard: rules firing in every tick for a second stop the clock, once, and can be turned off', () => {
  const fx = fixture('zero_delay_loop'), s = sessionOf(fx);
  at(s, 1, () => s.fire(fx.inputs[0].fire));
  const stop = s.run(5);
  assert.equal(stop.t, 2);
  assert.deepEqual(stop.stopped.rules, ['L2', 'L3']);
  assert.match(stop.stopped.text, /no delay/);
  assert.deepEqual(s.run(1), { t: 3, stopped: null }, 'stepping on goes on');
  const off = sessionOf(fx, { loopTicks: 0 });
  at(off, 1, () => off.fire(fx.inputs[0].fire));
  assert.deepEqual(off.run(5), { t: 6, stopped: null });
});

// ---------------------------------------------------------------- what it reads
// the why case played: Button1 at 1 s and 3 s, Lever1 at 1.5 s and 4 s, Button2 at 2 s and 3 s
function whyPlayed(more) {
  const s = open('why', more);
  for (const [t, thing] of [[1, 'Button1'], [1.5, 'Lever1'], [2, 'Button2'], [3, 'Button2'], [3, 'Button1'], [4, 'Lever1']]) {
    at(s, t, () => s.fire({ thing, output: 'used' }));
  }
  return s;
}

test("the state: the world, the player's, and each block's own", () => {
  const s = whyPlayed();
  s.scrub(4.5);
  const st = s.state();
  assert.equal(st.t, 4.5);
  assert.deepEqual([st.flags, st.counters, st.jc], [{ Power: true }, { Levers: 2 }, [2000, 0, 0]]);
  assert.deepEqual(st.rules.L6, { done: true, running: true, step: 1, next: 5.1 });
  assert.deepEqual(st.rules.L13, { done: true, running: false, step: 1, next: null });
});

test('the counts of each rule', () => {
  const s = whyPlayed();
  s.scrub(6);
  const c = s.counts();
  assert.deepEqual(c.L6, { fired: 1, once: 0, running: 1, cond: 0, acted: 2, failed: 0, last: 2 });
  assert.deepEqual(c.L11, { fired: 2, once: 0, running: 0, cond: 0, acted: 2, failed: 2, last: 3 });
  assert.deepEqual(c.L1, { fired: 0, once: 0, running: 0, cond: 2, acted: 0, failed: 0, last: null });
  assert.deepEqual(c.L13, { fired: 1, once: 1, running: 0, cond: 0, acted: 1, failed: 0, last: 1.5 });
});

test('the counts cost the rules, not the log: each line is read once, however often the page asks', () => {
  // the timers case with its rule copied 200 times and its timer running out in every tick: 400 lines a tick
  const { actors: [rule], world } = cases.timers;
  const actors = Array.from({ length: 200 }, (_, i) => ({ ...rule, name: `UCLink_L${i}`, props: { ...rule.props, Rule: `"L${i}"` } }));
  const s = open('timers', { actors, world: { ...world, actors: world.actors.map((a) => ({ ...a, seconds: 0.1 })) }, loopTicks: 0 });
  s.scrub(20);
  const fires = (id) => s.log().filter((l) => l.line.startsWith(`fire|M|${id}|`)).length;
  const timed = (f) => Math.min(...[0, 1, 2].map(() => { const t0 = performance.now(); f(); return performance.now() - t0; }));
  const whole = timed(() => { for (const { line } of s.log()) parseLogicLine(LOGIC_TAG + line); });    // the log read once
  s.counts();
  s.step(1);
  const asked = timed(() => s.counts());
  assert.ok(asked < whole / 10, `counts() after a step took ${asked.toFixed(2)} ms; reading the whole log takes ${whole.toFixed(2)} ms`);
  assert.deepEqual(s.counts().L7, { fired: fires('L7'), once: 0, running: 0, cond: 0, acted: fires('L7'), failed: 0, last: 20.1 });
  s.scrub(1);
  assert.deepEqual([s.counts().L7.fired, s.counts().L7.last], [fires('L7'), 1], 'gone back: counted again from the start');
});

test('what the rules wait for, thing by thing', () => {
  const h = open('why').happenings();
  assert.deepEqual(h.map((x) => [x.thing, x.output, x.rules, x.watched, x.present]), [
    ['Button1', 'used', ['L1', 'L3', 'L5', 'L9'], false, true], ['Lever1', 'used', ['L2', 'L4', 'L13'], false, true],
    ['Button2', 'used', ['L6', 'L11'], false, true], ['Ghost1', 'used', ['L7'], false, false], ['Crate1', 'near', ['L8'], true, true]]);
});

test('why did it not fire: in sentences, from the session and the compiled logic', () => {
  const s = whyPlayed();
  s.scrub(4.5);
  const why = (id) => s.why(id).map((w) => `${w.why}: ${w.text}`);
  assert.deepEqual(why('L1'), ['cond: It heard it at 3 s, but "Power is Yes" did not hold. Only L2 sets Power to Yes, and it had not done it by then.']);
  assert.deepEqual(why('L3'), ['cond: It heard it at 3 s, but "the counter Levers is at least 2" did not hold. L4 had changed the counter Levers 1 time by then: not enough.']);
  assert.deepEqual(why('L5'), ['cond: It heard it at 3 s, but "the player carries Multitool" did not hold. That is up to the game: change it in the State panel to try it.']);
  assert.deepEqual(why('L9'), ['cond: It heard it at 3 s, but "Nobody is Yes" did not hold. No rule sets Nobody to Yes (the Story or the game may): to try it, set it in the State panel.']);
  assert.deepEqual(why('L6'), ['running: It was still doing its actions (they take 3 s) when it was set off again at 3 s: a rule that is running ignores that.',
    'fired: It ran once, the last at 2 s.', 'now: It is doing its actions now: the next at 5.1 s.']);
  assert.deepEqual(why('L13'), ['once: It had already run (at 1.5 s) and runs only once: it was refused 1 time after.', 'fired: It ran once, the last at 1.5 s.']);
  assert.deepEqual(why('L7'), ['hook: L7 Ghost1 is not in the map: the rule never runs.']);
  assert.deepEqual(why('L8'), ['never: "When the player comes within 256 units of Crate1" never happened in this session. It is looked at every half second, '
    + 'and the first look only notes what is already so: it has to become so after.']);
  assert.deepEqual(why('L10'), ['left: L10 is not in the game: its object is deleted.']);
  assert.deepEqual(why('L11'), ['fired: It ran 2 times, the last at 3 s.', 'fail: An action of it failed at 3.1 s: hide Crate9: it is not in the map.']);
  assert.deepEqual(why('L99'), ['unknown: There is no rule L99 in the compiled logic: rebuild it, or check its id.']);
  s.scrub(6.5);
  assert.deepEqual(why('L1'), ['cond: It heard it at 3 s, but "Power is Yes" did not hold. Only L2 sets Power to Yes, and it had not done it by then.'],
    'what L2 did after does not change why it was refused then');
  const fresh = open('why');
  assert.deepEqual(fresh.why('L12').map((w) => w.text), ['The map has not started yet: its first look is at 0.5 s.']);
});

test('why: a state its rule had set, and something set back since', () => {
  const s = open('why');
  at(s, 1, () => s.fire({ thing: 'Lever1', output: 'used' }));       // L2 sets Power at 3.1 s, L4 adds 1 at 1.1 s
  at(s, 3.2, () => s.set({ flags: { Power: false } }));
  at(s, 3.3, () => s.fire({ thing: 'Button1', output: 'used' }));
  const texts = s.why('L1').map((w) => w.text);
  assert.deepEqual(texts, ['It heard it at 3.3 s, but "Power is Yes" did not hold. L2 had set Power to Yes before then: something set it back since.']);
});

test("why, with no vocabulary and the page's own names", () => {
  const s = open('why', { vocab: null, ctx: { name: (n) => `the ${n}` } });
  assert.match(s.why('L8')[0].text, /^"When the Crate1: near" never happened/);
  at(s, 1, () => s.fire({ thing: 'Button1', output: 'used' }));
  assert.match(s.why('L5')[0].text, /"the player carries Multitool"/);
  assert.deepEqual(s.decisions(), []);
});
