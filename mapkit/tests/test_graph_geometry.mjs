// The node graph canvas's maths (static/graph-geometry.js): zoom at the pointer, fit, semantic zoom levels, where a
// node's pins are, how a wire runs (forwards, backwards round the nodes, through reroute points), what a click hits,
// the wires a move redraws, bundles, the delay chip.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE, ZOOM, LANE, DELAY, bodyHeight, toWorld, toScreen, panBy, zoomAt, wheelZoom, fitView, centreOn, visibleBox, detailAt, pinsOf, nodeSize,
  pinPoint, pinsFit, routeWire, bundleWires, wireIndex, wiresOfNodes, insertReroute, delayFromDrag, delayText, wireAt, pinNear, boxesTouching,
  boxesInside, frameAt, boxOf, boundsOf, nearestToward, segmentDistance, labelPoint,
} from '../editor/static/graph-geometry.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
const nearPt = (p, q, eps = 1e-6) => { near(p[0], q[0], eps); near(p[1], q[1], eps); };
const onPath = (pts, p, eps = 0.01) => pts.slice(1).some((q, i) => segmentDistance(p, pts[i], q) <= eps);

test('world and screen are each other\'s inverse; a pan moves the screen only', () => {
  const view = { x: 37, y: -12, k: 0.6 };
  nearPt(toWorld(view, toScreen(view, [123, -45])), [123, -45]);
  assert.deepEqual(panBy(view, 10, -5), { x: 47, y: -17, k: 0.6 });
});

test('zoom keeps the point under the pointer still, within the limits', () => {
  const view = { x: 40, y: 30, k: 1 }, at = [300, 200], under = toWorld(view, at);
  const z = zoomAt(view, 1.5, at);
  near(z.k, 1.5);
  nearPt(toWorld(z, at), under);
  assert.equal(zoomAt(view, 50, at).k, ZOOM.max);
  assert.equal(zoomAt(view, 0.001, at).k, ZOOM.min);
  // the wheel: up (negative) zooms in, down out, about 16% a notch, and the point stays
  const up = wheelZoom(view, -100, at), down = wheelZoom(view, 100, at);
  assert.ok(up.k > 1.1 && up.k < 1.2 && down.k < 1);
  nearPt(toWorld(up, at), under);
});

test('fit shows the whole box, centred, never closer than 100%', () => {
  const box = [100, 50, 400, 200], size = [800, 600], v = fitView(box, size);
  assert.equal(v.k, 1);
  nearPt(toScreen(v, [300, 150]), [400, 300]);
  const big = fitView([0, 0, 4000, 1000], size, { pad: 20 });
  near(big.k, (800 - 40) / 4000);
  const [x, y] = toScreen(big, [0, 0]), [x2, y2] = toScreen(big, [4000, 1000]);
  assert.ok(x >= 20 - 1e-9 && x2 <= 780 + 1e-9 && y >= 0 && y2 <= 600);
  // centring on a point keeps the zoom
  const c = centreOn({ x: 0, y: 0, k: 0.5 }, [1000, 500], size);
  assert.equal(c.k, 0.5);
  nearPt(toScreen(c, [1000, 500]), [400, 300]);
  assert.deepEqual(visibleBox({ x: -100, y: -50, k: 2 }, [800, 600]), [50, 25, 400, 300]);
});

test('semantic zoom: everything from 50%, titles from 25%, frames below', () => {
  assert.equal(detailAt(1), 'full');
  assert.equal(detailAt(0.5), 'full');
  assert.equal(detailAt(0.49), 'titles');
  assert.equal(detailAt(0.25), 'titles');
  assert.equal(detailAt(0.24), 'frames');
  assert.equal(detailAt(ZOOM.min), 'frames');
});

test('a node is a 28 px header and 22 px rows; its pins sit on its edges, level with their row', () => {
  const n = { id: 'rule:L7', in: { id: 'when' }, rows: [{ id: 'r0', text: 'only if' }, { id: 'a1', text: 'open Door3', out: { id: 'a1' } }, { id: 'a2', text: 'x', in: { id: 'go' }, out: { id: 'a2' } }], foot: 'ran 3x' };
  assert.deepEqual(nodeSize(n), [NODE.w, 28 + 4 * 22]);
  assert.deepEqual(nodeSize({ w: 300 }), [300, 28]);
  assert.deepEqual(pinsOf(n).map((p) => [p.id, p.side, p.row]), [['when', 'in', -1], ['a1', 'out', 1], ['go', 'in', 2], ['a2', 'out', 2]]);
  const at = [100, 40], [header, a1, go] = pinsOf(n);
  assert.deepEqual(pinPoint(n, at, header), [100, 40 + 14]);
  assert.deepEqual(pinPoint(n, at, a1), [100 + NODE.w, 40 + 28 + 22 + 11]);
  assert.deepEqual(pinPoint(n, at, go), [100, 40 + 28 + 44 + 11]);
});

test('a text block (a line of the Story) is its lines tall under the header; the rows and their pins go under it', () => {
  const n = { id: 'n1', in: { id: 'in' }, body: { text: 'Hello there.', lines: 3 }, rows: [{ id: 'way:0', text: 'Yes', out: { id: '0' } }] };
  assert.equal(bodyHeight(n), 3 * NODE.line + NODE.body);
  assert.equal(bodyHeight({ body: { text: '' } }), NODE.line + NODE.body);       // one line at least, whatever its text
  assert.equal(bodyHeight({ body: { lines: 40 } }), 8 * NODE.line + NODE.body);  // and eight at most
  assert.equal(bodyHeight({}), 0);
  assert.deepEqual(nodeSize(n), [NODE.w, 28 + bodyHeight(n) + 22]);
  const [inPin, yes] = pinsOf(n);
  assert.deepEqual(pinPoint(n, [0, 0], inPin), [0, 14]);                         // the header's pin stays on the header
  assert.deepEqual(pinPoint(n, [0, 0], yes), [NODE.w, 28 + bodyHeight(n) + 11]);
});

test('without a rule from the caller, typed pins fit their own type; a pin with no type fits any', () => {
  assert.equal(pinsFit({ id: 'used', type: 'event' }, { id: 'open', type: 'event' }), true);
  assert.equal(pinsFit({ id: 'used' }, { id: 'value', type: 'number' }), true);
  assert.equal(pinsFit({ id: 'count', label: 'value', type: 'number' }, { id: 'open', label: 'Open', type: 'event' }), 'value gives number: Open takes event');
});

test('a wire forwards is one curve, leaving and arriving level, its label halfway', () => {
  const a = [220, 61], b = [520, 140], r = routeWire(a, b);
  assert.match(r.d, /^M220,61 C\S+,61 \S+,140 520,140$/);
  nearPt(r.pts[0], a);
  nearPt(r.pts[r.pts.length - 1], b);
  nearPt(r.mid, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
});

test('a wire backwards goes out into its lane, round under both nodes, and into the target from its left', () => {
  const src = [300, 0, 220, 100], dst = [0, 40, 220, 100];
  const a = [520, 50], b = [0, 90];
  const r = routeWire(a, b, { boxes: [src, dst] });
  const bottom = Math.max(src[1] + src[3], dst[1] + dst[3]);
  assert.deepEqual(r.pts[1], [a[0] + LANE.out, a[1]], 'out to the right first');
  assert.ok(r.pts[2][1] > bottom && r.pts[3][1] > bottom, 'under both nodes');
  assert.deepEqual(r.pts[4], [b[0] - LANE.out, b[1]], 'in from the left');
  assert.equal(r.mid[1], r.pts[2][1]);
  // the next wire from the same node: a lane further out, and further down
  const r1 = routeWire(a, b, { lane: 1, boxes: [src, dst] });
  assert.equal(r1.pts[1][0], a[0] + LANE.out + LANE.step);
  assert.ok(r1.pts[2][1] > r.pts[2][1]);
  // nodes one over the other with room between: the wire runs between them, not under both
  const high = [300, 0, 220, 100], low = [0, 300, 220, 100];
  const between = routeWire([520, 50], [0, 350], { boxes: [high, low] });
  assert.ok(between.pts[2][1] > 100 && between.pts[2][1] < 300);
});

test('a wire through reroute points passes each one, its label on the middle one', () => {
  const via = [[400, 300], [700, 100]], r = routeWire([0, 0], [900, 0], { via });
  for (const p of via) assert.ok(onPath(r.pts, p), `passes ${p}`);
  const one = routeWire([0, 0], [600, 0], { via: [[300, 200]] });
  assert.deepEqual(one.mid, [300, 200]);
  // a point put where a wire is double-clicked goes between the two points it lies between
  assert.deepEqual(insertReroute([0, 0], via, [900, 0], [820, 60]), [[400, 300], [700, 100], [820, 60]]);
  assert.deepEqual(insertReroute([0, 0], via, [900, 0], [150, 120]), [[150, 120], [400, 300], [700, 100]]);
  assert.deepEqual(insertReroute([0, 0], [], [900, 0], [450, 5]), [[450, 5]]);
});

test('what a click hits: the nearest wire within reach, the nearest pin, the boxes a selection box touches', () => {
  const w1 = routeWire([0, 0], [400, 0]), w2 = routeWire([0, 40], [400, 40]);
  const geoms = [['w1', { pts: w1.pts, box: boundsOf(w1.pts) }], ['w2', { pts: w2.pts, box: boundsOf(w2.pts) }]];
  assert.equal(wireAt(geoms, [200, 3], 6), 'w1');
  assert.equal(wireAt(geoms, [200, 36], 6), 'w2');
  assert.equal(wireAt(geoms, [200, 20], 6), null);
  assert.equal(wireAt(geoms, [200, 22], 30), 'w2', 'the nearer of two in reach, not the first');
  const pins = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }];
  assert.equal(pinNear(pins, [7, 1], 14).id, 'b');
  assert.equal(pinNear(pins, [40, 0], 14), null);
  const boxes = [['A', [0, 0, 100, 50]], ['B', [200, 0, 100, 50]], ['C', [0, 100, 100, 50]]];
  assert.deepEqual(boxesTouching(boxes, boxOf([350, 40], [90, 10])), ['A', 'B']);
  assert.deepEqual(boxesInside(boxes, [-10, -10, 320, 80]), ['A', 'B']);
  assert.deepEqual(boxesInside(boxes, [-10, -10, 250, 80]), ['A']);
  assert.equal(frameAt([['f1', [0, 0, 100, 100]], ['f2', [50, 50, 100, 100]]], [60, 60]), 'f1');
  assert.equal(frameAt([['f1', [0, 0, 100, 100]]], [160, 60]), undefined);
  assert.deepEqual(boundsOf([[0, 0, 10, 10], [20, -5], [5, 5, 30, 1]]), [0, -5, 35, 15]);
  assert.equal(boundsOf([]), undefined);
});

test('a move redraws only the wires of the nodes moved', () => {
  const wires = [
    { id: 'w1', from: { node: 'A' }, to: { node: 'B' } }, { id: 'w2', from: { node: 'B' }, to: { node: 'C' } },
    { id: 'w3', from: { node: 'C' }, to: { node: 'D' } }, { id: 'w4', from: { node: 'E' }, to: { node: 'E' } },
  ];
  const index = wireIndex(wires);
  assert.deepEqual([...wiresOfNodes(index, ['A'])], ['w1']);
  assert.deepEqual([...wiresOfNodes(index, ['B', 'C'])].sort(), ['w1', 'w2', 'w3']);
  assert.deepEqual(index.get('E'), ['w4'], 'a wire from a node to itself is listed once');
  assert.deepEqual([...wiresOfNodes(index, ['Z'])], []);
});

test('zoomed out, the wires between two groups are one bundle with their count; inside a group none', () => {
  const group = { A: 'f1', B: 'f1', C: 'f2', D: 'D' };
  const wires = [['A', 'C'], ['B', 'C'], ['A', 'B'], ['C', 'D'], ['B', 'C']].map(([f, t], i) => ({ id: 'w' + i, from: { node: f }, to: { node: t } }));
  assert.deepEqual(bundleWires(wires, (id) => group[id]), [
    { from: 'f1', to: 'f2', ids: ['w0', 'w1', 'w4'] }, { from: 'f2', to: 'D', ids: ['w3'] },
  ]);
});

test('the delay chip: 40 px sideways is a second, in steps of a tenth, never below nothing', () => {
  assert.equal(delayFromDrag(2, DELAY.pxPerSecond), 3);
  assert.equal(delayFromDrag(2, 4), 2.1);
  assert.equal(delayFromDrag(0.3, 0), 0.3);
  assert.equal(delayFromDrag(1, -400), 0);
  assert.equal(delayText(2), '2 s');
  assert.equal(delayText(0.1 + 0.2), '0.3 s');
});

test('the arrows go to the nearest node that way, straight ahead before off to the side', () => {
  const boxes = [['M', [0, 0, 100, 50]], ['R', [300, 0, 100, 50]], ['RD', [200, 120, 100, 50]], ['D', [0, 200, 100, 50]], ['U', [0, -200, 100, 50]]];
  assert.equal(nearestToward(boxes, 'M', 'right'), 'R');
  assert.equal(nearestToward(boxes, 'M', 'down'), 'D');
  assert.equal(nearestToward(boxes, 'M', 'up'), 'U');
  assert.equal(nearestToward(boxes, 'M', 'left'), undefined);
  assert.equal(nearestToward(boxes, 'nothing', 'left'), 'M', 'from no node: the first');
});

// 12 Nov 2026: a wire's label at its middle could sit under a card, where it can be neither read nor clicked
test('a wire label goes to the nearest point of the wire that no card covers', () => {
  const pts = [[0, 0], [50, 0], [100, 0], [150, 0], [200, 0], [250, 0], [300, 0]];
  assert.deepEqual(labelPoint(pts, [150, 0], []), [150, 0], 'the middle when nothing covers it');
  const at = labelPoint(pts, [150, 0], [[110, -20, 80, 40]]);
  assert.ok(at[0] <= 110 - 28 || at[0] >= 190 + 28, `off the card: ${at}`);
  assert.deepEqual(at, [50, 0], 'the nearest free point');
  assert.deepEqual(labelPoint(pts, [150, 0], [[-100, -20, 500, 40]]), [150, 0], 'the middle when every point is covered');
});
