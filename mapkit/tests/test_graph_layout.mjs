// The node graph's layout (static/graph-layout.js): left to right, what causes before what it causes, nothing on top of
// anything, the same answer for the same graph, pinned nodes never moved, a new node beside its pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layered, placeBeside, crossings, GAP } from '../editor/static/graph-layout.js';

const node = (id, w = 200, h = 72) => ({ id, w, h });
const graph = (ids, pairs) => ({ nodes: ids.map((id) => node(id)), edges: pairs.map(([from, to]) => ({ from, to })) });
const boxOf = (g, at, id) => { const n = g.nodes.find((x) => x.id === id); return [at[id][0], at[id][1], n.w, n.h]; };
const apart = (a, b) => a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1];
function assertNoOverlap(g, at) {
  const ids = g.nodes.map((n) => n.id);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    assert.ok(apart(boxOf(g, at, ids[i]), boxOf(g, at, ids[j])), `${ids[i]} and ${ids[j]} overlap: ${at[ids[i]]} / ${at[ids[j]]}`);
  }
}
// a made-up level: 40 things, each causing one or two of the later ones (the same every run)
function bigGraph(count = 40) {
  const ids = Array.from({ length: count }, (_, i) => `N${i}`), pairs = [];
  let seed = 7;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < count - 1; i++) {
    pairs.push([ids[i], ids[i + 1 + Math.floor(next() * Math.min(5, count - i - 1))]]);
    if (next() < 0.4 && i < count - 2) pairs.push([ids[i], ids[i + 2 + Math.floor(next() * Math.min(4, count - i - 2))]]);
  }
  return graph(ids, pairs);
}

test('a chain runs left to right on one line, a column gap apart', () => {
  const g = graph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]), at = layered(g);
  assert.deepEqual(at.A, [0, 0]);
  assert.equal(at.B[0], 200 + GAP.x);
  assert.equal(at.C[0], 2 * (200 + GAP.x));
  assert.equal(at.A[1], at.B[1]);
  assert.equal(at.B[1], at.C[1]);
});

test('what causes is left of what it causes, nothing overlaps, and a node lines up with what leads to it', () => {
  const g = bigGraph(), at = layered(g);
  assert.equal(Object.keys(at).length, g.nodes.length);
  for (const e of g.edges) assert.ok(at[e.from][0] < at[e.to][0], `${e.from} -> ${e.to}`);
  assertNoOverlap(g, at);
  // the layout starts at the top it was given, it does not drift down (the 12 nodes' first column all moves down)
  for (const laid of [at, layered(bigGraph(12))]) assert.equal(Math.min(...Object.values(laid).map((p) => p[1])), 0);
});

test('a node is level with the middle of what leads to it; a fan-in stays centred', () => {
  const centre = (at, id) => at[id][1] + 36;
  const fan = layered(graph(['A', 'B', 'C'], [['A', 'C'], ['B', 'C']]));
  assert.equal(centre(fan, 'C'), (centre(fan, 'A') + centre(fan, 'B')) / 2);
  assert.deepEqual(fan.A, [0, 0], 'A stays at the top: it is not the one way into C');
  // the one way into a node pushed down by a tall one above it is lowered level with it
  const g = { nodes: [node('A'), node('B'), node('Y1', 200, 200), node('Y2'), node('Z')], edges: [['A', 'Y1'], ['B', 'Y2'], ['Y1', 'Z'], ['Y2', 'Z']].map(([from, to]) => ({ from, to })) };
  const at = layered(g);
  assert.equal(at.B[1], at.Y2[1], 'B is level with Y2, under the tall Y1');
  assert.equal(at.Y1[1], 0);
});

test('a source sits just left of what it leads to, not in the first column', () => {
  const g = graph(['A', 'B', 'C', 'X'], [['A', 'B'], ['B', 'C'], ['X', 'C']]), at = layered(g);
  assert.equal(at.X[0], at.B[0], 'X leads only to C: its column is just before C');
});

test('a loop is laid out (no hang) with the wire that closes it turned round', () => {
  const g = graph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C'], ['C', 'A']]), at = layered(g);
  assert.ok(at.A[0] < at.B[0] && at.B[0] < at.C[0]);
  assertNoOverlap(g, at);
});

test('crossings are counted, and the order that takes them out is the one used', () => {
  // one piece (both lead on to D), listed so that B1 comes first though A2, the lower one, leads to it
  const g = graph(['A1', 'A2', 'B1', 'B2', 'D'], [['A1', 'B2'], ['A2', 'B1'], ['B1', 'D'], ['B2', 'D']]);
  assert.equal(crossings([['A1', 'A2'], ['B1', 'B2']], g.edges), 1);
  assert.equal(crossings([['A1', 'A2'], ['B2', 'B1']], g.edges), 0);
  const at = layered(g);
  assert.ok(at.B2[1] < at.B1[1], 'B2 (led to by the upper A1) is above B1');
  assert.ok(at.A1[1] < at.A2[1]);
});

test('the same graph gives the same places, whatever ran before', () => {
  const a = layered(bigGraph()), b = layered(bigGraph());
  assert.deepEqual(a, b);
  layered(graph(['Q', 'R'], [['R', 'Q']]));
  assert.deepEqual(layered(bigGraph()), a);
});

test('a pinned node never moves, and the others go round it', () => {
  const g = bigGraph(12), first = layered(g);
  // pin N3 a little off where N5 was laid out: everything is arranged again around it
  const pin = [first.N5[0] + 10, first.N5[1] + 10], at = { ...first, N3: pin };
  const out = layered(g, at, { fixed: ['N3'] });
  assert.deepEqual(out.N3, pin);
  for (const n of g.nodes) if (n.id !== 'N3') assert.ok(apart(boxOf(g, out, n.id), boxOf(g, out, 'N3')), `${n.id} lands on the pinned N3`);
  // pinned far away, it stays there too
  assert.deepEqual(layered(g, { ...first, N3: [5000, -700] }, { fixed: ['N3'] }).N3, [5000, -700]);
});

test('only: the nodes asked for are arranged where they were, every other one stays', () => {
  const g = graph(['A', 'B', 'C', 'D'], [['A', 'B'], ['C', 'D']]);
  const at = { A: [0, 0], B: [500, 300], C: [1000, 40], D: [990, 60] };
  const out = layered(g, at, { only: ['C', 'D'] });
  assert.deepEqual(out.A, at.A);
  assert.deepEqual(out.B, at.B);
  assert.deepEqual(out.C, [990, 40], 'the block starts at the top-left of where its nodes were');
  assert.equal(out.D[0], 990 + 200 + GAP.x);
});

test('nodes not placed yet (as the canvas asks: only them) go right of the ones placed, which stay', () => {
  const g = graph(['A', 'B', 'C', 'D'], [['A', 'B'], ['C', 'D']]);
  const at = { A: [0, 0], B: [300, 0] };
  const out = layered(g, at, { only: ['C', 'D'] });
  assert.deepEqual(out.A, [0, 0]);
  assert.deepEqual(out.B, [300, 0]);
  assert.deepEqual(out.C, [500 + GAP.x, 0]);
  assert.ok(out.D[0] > out.C[0]);
  // with nothing asked, every node is arranged (Arrange all), from where the placed ones started
  const all = layered(g, at);
  assert.deepEqual(all.A, [0, 0]);
  assert.equal(all.B[0], 200 + GAP.x);
});

test('pieces that do not touch are stacked, never mixed', () => {
  const g = graph(['A', 'B', 'C', 'D'], [['A', 'B'], ['C', 'D']]), at = layered(g);
  assert.ok(at.C[1] >= at.A[1] + 72 + GAP.y, 'the second piece starts under the first');
  assertNoOverlap(g, at);
});

test('a new node goes right of an output, its pin level with that one', () => {
  const g = graph(['A'], []), out = placeBeside(g, { A: [100, 50] }, node('N', 200, 50), { node: 'A', side: 'out', y: 50 + 61 });
  assert.deepEqual(out.N, [100 + 200 + GAP.x, 50 + 61 - 14]);
  assert.deepEqual(out.A, [100, 50]);
});

test('a new node goes left of an input', () => {
  const g = graph(['A'], []), out = placeBeside(g, { A: [100, 50] }, node('N', 180, 50), { node: 'A', side: 'in', y: 64 });
  assert.deepEqual(out.N, [100 - GAP.x - 180, 50]);
});

test('what the new node lands on moves down, and what that lands on in turn; a pinned node stays', () => {
  const g = graph(['A', 'B', 'C', 'P'], []);
  const at = { A: [0, 0], B: [264, 0], C: [264, 90], P: [264, 600] };
  const out = placeBeside(g, at, node('N', 200, 72), { node: 'A', side: 'out', y: 14 }, { fixed: ['P'] });
  assert.deepEqual(out.N, [264, 0]);
  assert.deepEqual(out.B, [264, 72 + GAP.y], 'B goes under N');
  assert.deepEqual(out.C, [264, out.B[1] + 72 + GAP.y], 'C goes under B');
  assert.deepEqual(out.P, [264, 600]);
  // the new node lands on a pinned node: it goes under it instead
  const pinned = placeBeside(g, at, node('N', 200, 72), { node: 'A', side: 'out', y: 14 }, { fixed: ['B'] });
  assert.deepEqual(pinned.B, [264, 0]);
  assert.deepEqual(pinned.N, [264, 72 + GAP.y]);
  assert.ok(apart([...pinned.C, 200, 72], [...pinned.N, 200, 72]), 'C moved out of the way of N');
  assert.deepEqual(at, { A: [0, 0], B: [264, 0], C: [264, 90], P: [264, 600] }, 'the places given are not changed');
});

// 12 Nov 2026: a rule reading a state another rule sets made a column of its own each time (7 columns for 14 rules)
test('a weak wire (a state read) keeps the two together but makes no column', () => {
  const g = { nodes: ['Keypad', 'R3', 'R4', 'R5', 'Guard'].map((id) => node(id)),
    edges: [{ from: 'Keypad', to: 'R3' }, { from: 'R3', to: 'R4', weak: true }, { from: 'R4', to: 'R5', weak: true }, { from: 'R5', to: 'Guard' }] };
  const at = layered(g), cols = new Set(Object.values(at).map((p) => p[0]));
  assert.equal(cols.size, 2, `columns: ${[...cols]}`);
  assert.equal(at.R4[0], at.R3[0], 'the loose reader sits in the column of what it reads');
  assert.ok(at.R4[1] > at.R3[1], 'under it');
  assert.ok(at.R5[0] < at.Guard[0], 'a rule still left of what it acts on');
  assertNoOverlap(g, at);
  assert.deepEqual(layered(g), at, 'the same answer each time');
});
