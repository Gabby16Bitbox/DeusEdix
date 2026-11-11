// The logic's wires in the 3D view, which ones (editor/static/logic-wires-model.js): the four modes of TrenchBroom's
// entity links (Off, the selected object's, its chain either way, all), wires for every action on every object it
// reaches, side by side between the same two objects, a list's own steps left out, state wires from the rule that
// sets a state to the rules that read it, in many combinations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wiresOf, arcOf, labelsOf, roomFor, WIRE_MODES } from '../editor/static/logic-wires-model.js';

const act = (verb, target, more = {}) => ({ verb, target, delay: 0, ...more });
const rule = (id, src, acts, more = {}) => ({ id, src, when: 'used', do: acts, ...more });
const pairs = (ws) => ws.map((w) => `${w.from}>${w.to}`).sort();
const of = (links, more) => wiresOf(links, more);

test('the four modes on one button and one door', () => {
  const links = [rule('L1', 'Button', [act('open', 'Door')])];
  assert.deepEqual(WIRE_MODES.map(([m]) => m), ['off', 'selected', 'chain', 'all']);
  assert.deepEqual(of(links, { mode: 'off', selected: 'Button' }), []);
  assert.deepEqual(pairs(of(links, { mode: 'selected', selected: 'Button' })), ['Button>Door']);
  assert.deepEqual(pairs(of(links, { mode: 'selected', selected: 'Door' })), ['Button>Door'], 'the target selected: its wire too');
  assert.deepEqual(of(links, { mode: 'selected', selected: 'Lamp' }), []);
  assert.deepEqual(of(links, { mode: 'selected', selected: '' }), [], 'nothing selected: only All draws');
  assert.deepEqual(pairs(of(links, { mode: 'all' })), ['Button>Door']);
  const [w] = of(links, { mode: 'selected', selected: 'Button' });
  assert.deepEqual({ rule: w.rule, act: w.act, kind: w.kind, label: w.label, lane: w.lane, lanes: w.lanes, hot: w.hot },
    { rule: 'L1', act: 0, kind: 'act', label: 'used → open', lane: 0, lanes: 1, hot: true });
  assert.equal(of(links, { mode: 'all' })[0].hot, false, 'All with nothing selected: none is hot');
});

test('the chain: everything it sets off, on and on, and what sets it off, back; a loop ends', () => {
  const links = [rule('L1', 'X', [act('on', 'A')]), rule('L2', 'A', [act('open', 'B')]), rule('L3', 'B', [act('on', 'C')]),
    rule('L4', 'C', [act('hide', 'D')]), rule('L5', 'Y', [act('on', 'Z')]), rule('L6', 'Q', [act('on', 'C')])];
  assert.deepEqual(pairs(of(links, { mode: 'chain', selected: 'B' })), ['A>B', 'B>C', 'C>D', 'X>A']);
  assert.deepEqual(pairs(of(links, { mode: 'selected', selected: 'B' })), ['A>B', 'B>C']);
  assert.ok(!pairs(of(links, { mode: 'chain', selected: 'B' })).includes('Q>C'), 'what else sets off a thing down the chain: not this chain');
  const loop = [rule('L1', 'A', [act('on', 'B')]), rule('L2', 'B', [act('on', 'A')])];
  assert.deepEqual(pairs(of(loop, { mode: 'chain', selected: 'A' })), ['A>B', 'B>A']);
});

test('wires between the same two objects side by side, either way; several actions, several targets', () => {
  const links = [rule('L1', 'A', [act('open', 'B'), act('close', 'B', { delay: 2 })]), rule('L2', 'A', [act('lock', 'B')]),
    rule('L3', 'B', [act('on', 'A')]), rule('L4', 'A', [act('on', 'C'), act('on', 'D')])];
  const ws = of(links, { mode: 'all' });
  const ab = ws.filter((w) => [w.from, w.to].sort().join() === 'A,B');
  assert.deepEqual(ab.map((w) => w.lane), [0, 1, 2, 3]);
  assert.ok(ab.every((w) => w.lanes === 4));
  assert.equal(ws.find((w) => w.rule === 'L1' && w.act === 1).delay, 2);
  assert.deepEqual(pairs(ws.filter((w) => w.rule === 'L4')), ['A>C', 'A>D']);
  assert.equal(new Set(ws.map((w) => w.id)).size, ws.length, 'every wire its own id');
});

test('objects tagged alike and areas: a wire to each object it reaches that is in the map', () => {
  const links = [rule('L1', 'Switch', [act('lightoff', '', { targetTag: 'white' })])];
  const targetsOf = (x) => (x.targetTag === 'white' ? ['Light1', 'Light2', 'Light3'] : [x.target]);
  const present = (n) => n !== 'Light2';
  assert.deepEqual(pairs(of(links, { mode: 'all', targetsOf, present })), ['Switch>Light1', 'Switch>Light3']);
  assert.deepEqual(of(links, { mode: 'all' }), [], 'with no members known: no wire');
});

test('a list of steps: its If, Otherwise, End and Waits are no wires, the actions inside them are; "otherwise" too', () => {
  const links = [rule('L1', 'Button', [act('message', ''), { verb: 'if', requires: [{ flag: 'A' }] }, act('open', 'Door', { delay: 1 }),
    { verb: 'else' }, act('on', 'Alarm'), { verb: 'end' }, { verb: 'wait', until: { type: 'arrived', actor: 'Guard' } }, act('hostile', 'Guard')],
  { steps: true }), rule('L2', 'Lever', [act('open', 'Door')], { requires: [{ flag: 'P' }], else: [act('on', 'Siren')] })];
  assert.deepEqual(pairs(of(links, { mode: 'all' }).filter((w) => w.kind === 'act')),
    ['Button>Alarm', 'Button>Door', 'Button>Guard', 'Lever>Door', 'Lever>Siren']);
  assert.equal(of(links, { mode: 'all' }).find((w) => w.to === 'Siren').act, 'e0');
});

test('every cause draws its wires ("also"); a rule with no object, a muted one, a missing one, a self-target draw none', () => {
  const links = [rule('L1', 'Button', [act('open', 'Door')], { also: [{ src: 'Zone', when: 'enter' }] }),
    { id: 'L2', src: '', when: 'start', do: [act('open', 'Door')] }, { id: 'L3', src: '', when: 'keypress', key: 'K', do: [act('on', 'Lamp')] },
    rule('L4', 'Lamp', [act('on', 'Fan')], { mute: true }), rule('L5', 'Gone', [act('on', 'Fan')]), rule('L6', 'Fan', [act('hide', 'Fan')]),
    rule('L7', 'Fan', [act('message', '')])];
  const present = (n) => n !== 'Gone';
  assert.deepEqual(pairs(of(links, { mode: 'all', present })), ['Button>Door', 'Zone>Door']);
});

test('a state one rule sets and another reads: a dotted wire between their objects (conditions, Ifs, Wait until)', () => {
  const links = [rule('L1', 'Generator', [act('flag', '', { a: 'Power', b: '1' })]),
    rule('L2', 'Door', [act('open', 'Door2')], { requires: [{ flag: 'power', is: true }] }),
    rule('L3', 'Lever', [act('count', '', { a: 'Pulls', b: '1' })]),
    rule('L4', 'Gate', [{ verb: 'if', requires: [{ type: 'counter', counter: 'Pulls', op: '>=', value: 3 }] }, act('open', 'Gate2'), { verb: 'end' }], { steps: true }),
    rule('L5', 'Clock', [{ verb: 'wait', until: { flag: 'Power', is: true } }, act('on', 'Lamp')], { steps: true }),
    rule('L6', 'Generator', [act('message', '')], { requires: [{ flag: 'Power' }] })];
  const states = of(links, { mode: 'all' }).filter((w) => w.kind === 'state');
  assert.deepEqual(states.map((w) => `${w.from}>${w.to} ${w.label}`).sort(),
    ['Generator>Clock Power', 'Generator>Door Power', 'Lever>Gate Pulls'], 'case does not matter; the same object: no wire');
  assert.equal(states.find((w) => w.to === 'Door').setter, 'L1');
  assert.deepEqual(pairs(of(links, { mode: 'chain', selected: 'Generator' })).filter((p) => p.startsWith('Generator') || p.startsWith('Door')),
    ['Door>Door2', 'Generator>Clock', 'Generator>Door'], 'the chain goes on through a state');
});

test('the arc: higher with the distance (24 to 400 units over the higher end) and with its lane', () => {
  const a = { x: 0, y: 0, z: 0 };
  assert.equal(arcOf(a, { x: 40, y: 0, z: 0 })[1].y, 24);
  assert.equal(arcOf(a, { x: 800, y: 0, z: 0 })[1].y, 200);
  assert.equal(arcOf(a, { x: 5000, y: 0, z: 0 })[1].y, 400);
  assert.equal(arcOf(a, { x: 800, y: 100, z: 0 }, 2)[1].y, 100 + Math.hypot(800, 100) * 0.25 + 56, 'over the higher end, the lane 28 units each');
  assert.deepEqual(arcOf(a, { x: 800, y: 0, z: 200 })[1].x, 400);
});

test('labels: one for an action however many objects it reaches, one for a state; too many: the selection only', () => {
  const links = [rule('L1', 'Computer', [act('lightoff', '', { targetTag: 'white' })]), rule('L2', 'Button', [act('open', 'Door')]),
    rule('L3', 'Generator', [act('flag', '', { a: 'Power', b: '1' })]),
    rule('L4', 'Door', [act('open', 'Door2')], { requires: [{ flag: 'Power' }] }), rule('L5', 'Lamp', [act('on', 'Fan')], { requires: [{ flag: 'Power' }] })];
  const targetsOf = (x) => (x.targetTag ? ['Light1', 'Light2', 'Light3'] : [x.target]);
  const ws = of(links, { mode: 'all', targetsOf });
  const many = labelsOf(ws);
  assert.deepEqual([...many].map(([w, n]) => `${w.from}>${w.to} ${n}`).sort(),
    ['Button>Door 1', 'Computer>Light1 3', 'Door>Door2 1', 'Generator>Door 2', 'Lamp>Fan 1']);
  assert.equal(labelsOf(ws, 2).size, 0, 'over the limit with nothing selected: no label');
  const hot = of(links, { mode: 'all', selected: 'Computer', targetsOf });
  assert.deepEqual([...labelsOf(hot, 2)].map(([w, n]) => `${w.from} ${n}`), ['Computer 3'], 'over the limit: the selected object only');
});

test('a place for a label: where it is, a line or two up when another is there, else none', () => {
  const placed = [];
  assert.equal(roomFor(placed, 100, 100, 80), 100);
  assert.equal(roomFor(placed, 120, 100, 80), 80, 'over the first: one line up');
  assert.equal(roomFor(placed, 110, 100, 80), 60);
  assert.equal(roomFor(placed, 100, 100, 80), null, 'three deep: it waits');
  assert.equal(roomFor(placed, 300, 100, 80), 100, 'beside them: where it is');
  assert.equal(placed.length, 4);
});

test('a state read by several rules of one object, set by several of another: one wire between them', () => {
  const links = [rule('L1', 'Medkit', [act('flag', '', { a: 'GotKit', b: '1' })], { when: 'picked' }),
    rule('L2', 'Medkit', [act('flag', '', { a: 'gotkit', b: '0' })]),
    rule('L3', 'Button', [act('message', '')], { requires: [{ flag: 'GotKit', is: false }] }),
    rule('L4', 'Button', [act('message', '')], { requires: [{ flag: 'GotKit', is: true }] }),
    rule('L5', 'Button', [{ verb: 'if', requires: [{ flag: 'GotKit' }] }, act('message', ''), { verb: 'end' }], { steps: true })];
  const ws = of(links, { mode: 'all' });
  assert.deepEqual(ws.map((w) => `${w.from}>${w.to} ${w.kind} ${w.lanes}`), ['Medkit>Button state 1']);
  assert.equal(ws[0].rule, 'L3', 'its label opens the first rule that reads it');
});
