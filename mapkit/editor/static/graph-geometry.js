// The maths of the node graph canvas (graph-canvas.js): the view (pan and zoom), the size of a node and where its
// pins are, how a wire runs from pin to pin, and what is under the pointer. Pure: tests/test_graph_geometry.mjs.
//
// Places are in the graph's own units ("world"); the view puts them on the screen: screen = world * k + (x, y).
// A node's pins are worked out from its fixed sizes (a 28 px header, 22 px rows: DESIGN.md), never read back from
// the page, so a move needs no layout and a pin's place can be kept until its node moves or changes.

// a node: its width, header and row heights (graph-canvas.js gives them to its stylesheet, so the two agree)
export const NODE = { w: 220, header: 28, row: 22, line: 17, body: 10 };   // body: a text block's padding (a line of the Story)
export const ZOOM = { min: 0.1, max: 2 };
// what a node shows at a zoom (semantic zoom): everything; from below 50% only titles and live values; from below
// 25% only frames, with the wires between them bundled
export const DETAIL = [{ min: 0.5, level: 'full' }, { min: 0.25, level: 'titles' }, { min: 0, level: 'frames' }];
// the backward wires' lanes: out of the node this far, each lane a step further; under the nodes this far
export const LANE = { out: 16, step: 8, under: 16, drop: 6, radius: 8 };
const SAMPLES = 16;                               // points along a curve, for hitting it and for its middle
const WHEEL_ZOOM = 0.0015;                        // a wheel's notch (100 px) zooms about 16%
export const DELAY = { pxPerSecond: 40, step: 0.1 };

// ---------------------------------------------------------------- the view

export const clampZoom = (k, limits = ZOOM) => Math.min(limits.max, Math.max(limits.min, k));
export const toWorld = (view, [sx, sy]) => [(sx - view.x) / view.k, (sy - view.y) / view.k];
export const toScreen = (view, [wx, wy]) => [wx * view.k + view.x, wy * view.k + view.y];
export const panBy = (view, dx, dy) => ({ x: view.x + dx, y: view.y + dy, k: view.k });

// zoom to k, the world point under `at` (a screen point) staying under it
export function zoomAt(view, k, at, limits = ZOOM) {
  const z = clampZoom(k, limits);
  return { x: at[0] - (at[0] - view.x) * z / view.k, y: at[1] - (at[1] - view.y) * z / view.k, k: z };
}

// a wheel turn (deltaY in pixels, up is negative) zooms in or out at the pointer
export function wheelZoom(view, deltaY, at, limits = ZOOM) {
  return zoomAt(view, view.k * Math.exp(-Math.max(-300, Math.min(300, deltaY)) * WHEEL_ZOOM), at, limits);
}

// the view that shows `box` [x, y, w, h] whole and centred in a screen of `size` [w, h], `pad` screen pixels round it
export function fitView(box, size, { pad = 24, min = ZOOM.min, max = 1 } = {}) {
  if (!box) return { x: size[0] / 2, y: size[1] / 2, k: 1 };
  const k = Math.min(max, Math.max(min, Math.min((size[0] - 2 * pad) / Math.max(1, box[2]), (size[1] - 2 * pad) / Math.max(1, box[3]))));
  return { x: size[0] / 2 - (box[0] + box[2] / 2) * k, y: size[1] / 2 - (box[1] + box[3] / 2) * k, k };
}

// the view that puts a world point in the middle of the screen, at the same zoom
export const centreOn = (view, [wx, wy], size) => ({ x: size[0] / 2 - wx * view.k, y: size[1] / 2 - wy * view.k, k: view.k });

// the part of the world on the screen
export function visibleBox(view, size) {
  const [x, y] = toWorld(view, [0, 0]);
  return [x, y, size[0] / view.k, size[1] / view.k];
}

export function detailAt(k) {
  return DETAIL.find((d) => k >= d.min).level;
}

// ---------------------------------------------------------------- nodes and pins

// a node's pins in order: the header's (in, out), then each row's (in, out). row -1 is the header
export function pinsOf(node) {
  const list = [];
  const add = (pin, side, row) => { if (pin) list.push({ id: pin.id, side, row, pin }); };
  add(node.in, 'in', -1);
  add(node.out, 'out', -1);
  (node.rows || []).forEach((r, i) => { add(r.in, 'in', i); add(r.out, 'out', i); });
  return list;
}

// whether a wire may go from an output pin into an input pin when the caller does not say (graph-canvas.js
// canConnect): a pin with no type fits any, typed pins fit their own type. -> true, or why not
export function pinsFit(out, into) {
  if (!out.type || !into.type || out.type === into.type) return true;
  return `${out.label || out.id} gives ${out.type}: ${into.label || into.id} takes ${into.type}`;
}

export function nodeSize(node) {
  return [node.w || NODE.w, NODE.header + bodyHeight(node) + ((node.rows || []).length + (node.foot ? 1 : 0)) * NODE.row];
}

// a node's text block under its header (body: {text, lines}): `lines` lines tall whatever its text, so the pins under it
// stay where the geometry puts them (a longer text is cut, the whole of it is in the node's tooltip and its editor)
export function bodyHeight(node) {
  const lines = node.body ? Math.max(1, Math.min(8, Math.round(+node.body.lines) || 1)) : 0;
  return lines ? lines * NODE.line + NODE.body : 0;
}

// where a pin is: on the node's left edge (in) or right edge (out), level with its row. Zoomed out too (the rows are
// under a cover then): a change of zoom level moves no wire
export function pinPoint(node, at, entry) {
  const x = entry.side === 'in' ? at[0] : at[0] + nodeSize(node)[0];
  return [x, at[1] + (entry.row < 0 ? NODE.header / 2 : NODE.header + bodyHeight(node) + entry.row * NODE.row + NODE.row / 2)];
}

// ---------------------------------------------------------------- wires

// the way a wire runs from an output at `a` to an input at `b` ([x, y] each):
//   forwards (b well right of a): one curve, leaving and arriving level;
//   backwards: out of its node into a lane, along under (or between) the two nodes, into the target's lane, in;
//   through reroute points (`via`): a curve from each point to the next.
// options: lane (the wire's number among its node's wires), boxes ([source box, target box]: what to go round).
// -> {d: the SVG path, mid: [x, y] for its label, pts: points along it for hitting it}
export function routeWire(a, b, { lane = 0, boxes = [], via = [] } = {}) {
  if (via.length || b[0] - a[0] >= LANE.out * 2) return throughPoints([a, ...via, b]);
  return around(a, b, lane, boxes);
}

// where a wire's label goes: its middle, or else the point along it (pts) nearest the middle that is on no node: a
// label under a card can be neither read nor clicked (12 Nov 2026). pad: half a label's size, round each box
export function labelPoint(pts, mid, boxes, pad = [28, 10]) {
  const free = (p) => !boxes.some((b) => b && p[0] > b[0] - pad[0] && p[0] < b[0] + b[2] + pad[0] && p[1] > b[1] - pad[1] && p[1] < b[1] + b[3] + pad[1]);
  if (free(mid)) return mid;
  let best = null, bestD = Infinity;
  for (const p of pts || []) {
    if (!free(p)) continue;
    const d = (p[0] - mid[0]) ** 2 + (p[1] - mid[1]) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best || mid;
}

// the control points of a curve that leaves a and reaches b level, bending more the further apart they are
function controls(a, b) {
  const c = Math.max(LANE.out * 2, Math.min(160, Math.abs(b[0] - a[0]) / 2));
  return [a, [a[0] + c, a[1]], [b[0] - c, b[1]], b];
}

// one curve from each point to the next; the label in the middle (on the middle point, or halfway along the middle curve)
function throughPoints(points) {
  let d = `M${n(points[0][0])},${n(points[0][1])}`;
  const pts = [points[0]];
  for (let i = 0; i + 1 < points.length; i++) {
    const p = controls(points[i], points[i + 1]);
    d += ` C${n(p[1][0])},${n(p[1][1])} ${n(p[2][0])},${n(p[2][1])} ${n(p[3][0])},${n(p[3][1])}`;
    for (let s = 1; s <= SAMPLES; s++) pts.push(cubic(p, s / SAMPLES));
  }
  const m = points.length >> 1;
  return { d, mid: points.length % 2 ? points[m] : cubic(controls(points[m - 1], points[m]), 0.5), pts };
}

// a backward wire: between the two nodes when there is room, else under both
function around(a, b, lane, boxes) {
  const [src, dst] = boxes, step = lane * LANE.step;
  const x1 = a[0] + LANE.out + step, x2 = b[0] - LANE.out - step;
  let y;
  if (src && dst && src[1] + src[3] + 2 * LANE.under <= dst[1]) y = (src[1] + src[3] + dst[1]) / 2;
  else if (src && dst && dst[1] + dst[3] + 2 * LANE.under <= src[1]) y = (dst[1] + dst[3] + src[1]) / 2;
  else y = Math.max(a[1], b[1], ...boxes.filter(Boolean).map((r) => r[1] + r[3])) + LANE.under + lane * LANE.drop;
  const pts = [a, [x1, a[1]], [x1, y], [x2, y], [x2, b[1]], b];
  return { d: rounded(pts, LANE.radius), mid: [(x1 + x2) / 2, y], pts };
}

// a path through `pts` with its corners rounded
function rounded(pts, radius) {
  let d = `M${n(pts[0][0])},${n(pts[0][1])}`;
  for (let i = 1; i + 1 < pts.length; i++) {
    const [p, q, s] = [pts[i - 1], pts[i], pts[i + 1]];
    const r = Math.min(radius, dist(p, q) / 2, dist(q, s) / 2);
    const a = towards(q, p, r), b = towards(q, s, r);
    d += ` L${n(a[0])},${n(a[1])} Q${n(q[0])},${n(q[1])} ${n(b[0])},${n(b[1])}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${n(last[0])},${n(last[1])}`;
}

// a wire between two bundles of nodes (zoomed out): from the right of one to the left of the other
export function bundleRoute(fromBox, toBox) {
  return routeWire([fromBox[0] + fromBox[2], fromBox[1] + fromBox[3] / 2], [toBox[0], toBox[1] + toBox[3] / 2], { boxes: [fromBox, toBox] });
}

// the wires between groups (a frame, or a node in none), one per pair with the wires it stands for, in first-seen
// order; wires inside one group are left out
export function bundleWires(wires, groupOf) {
  const bundles = new Map();
  for (const w of wires) {
    const from = groupOf(w.from.node), to = groupOf(w.to.node);
    if (from === undefined || to === undefined || from === to) continue;
    const pair = bundles.get(from)?.get(to);
    if (pair) pair.ids.push(w.id);
    else {
      if (!bundles.has(from)) bundles.set(from, new Map());
      bundles.get(from).set(to, { from, to, ids: [w.id] });
    }
  }
  return [...bundles.values()].flatMap((m) => [...m.values()]);
}

// node id -> the ids of its wires (either end)
export function wireIndex(wires) {
  const index = new Map();
  for (const w of wires) {
    for (const id of new Set([w.from.node, w.to.node])) {
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(w.id);
    }
  }
  return index;
}

// the wires to draw again when these nodes moved: only theirs
export function wiresOfNodes(index, ids) {
  const out = new Set();
  for (const id of ids) for (const w of index.get(id) || []) out.add(w);
  return out;
}

// a reroute point added where a wire was double-clicked: between the two points it runs between there
export function insertReroute(a, via, b, p) {
  const all = [a, ...via, b];
  let best = 0, bestD = Infinity;
  for (let i = 0; i + 1 < all.length; i++) {
    const d = segmentDistance(p, all[i], all[i + 1]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return [...via.slice(0, best), p, ...via.slice(best)];
}

// a delay chip dragged sideways: dx screen pixels from where it was, in steps of a tenth of a second, never below 0
export function delayFromDrag(start, dx) {
  const steps = Math.round((start + dx / DELAY.pxPerSecond) / DELAY.step);
  return Math.max(0, Math.round(steps * DELAY.step * 10) / 10);
}

export const delayText = (s) => `${Math.round(s * 10) / 10} s`;

// ---------------------------------------------------------------- what is under the pointer

// the wire nearest p within tol (world units): geoms is [[id, {pts, box}]...] (box: the bounds of pts); null if none
export function wireAt(geoms, p, tol) {
  let best = null, bestD = tol;
  for (const [id, g] of geoms) {
    const b = g.box;
    if (p[0] < b[0] - tol || p[0] > b[0] + b[2] + tol || p[1] < b[1] - tol || p[1] > b[1] + b[3] + tol) continue;
    for (let i = 0; i + 1 < g.pts.length; i++) {
      const d = segmentDistance(p, g.pts[i], g.pts[i + 1]);
      if (d <= bestD) { if (d < bestD || best === null) best = id; bestD = d; }
    }
  }
  return best;
}

// the pin nearest p within r: pins [{x, y, ...}] -> that pin, or null
export function pinNear(pins, p, r) {
  let best = null, bestD = r * r;
  for (const pin of pins) {
    const d = (pin.x - p[0]) ** 2 + (pin.y - p[1]) ** 2;
    if (d <= bestD && (best === null || d < bestD)) { best = pin; bestD = d; }
  }
  return best;
}

// the ids whose box [x, y, w, h] touches the box (box selection): boxes is [[id, box]...]
export function boxesTouching(boxes, box) {
  const out = [];
  for (const [id, b] of boxes) if (b[0] < box[0] + box[2] && box[0] < b[0] + b[2] && b[1] < box[1] + box[3] && box[1] < b[1] + b[3]) out.push(id);
  return out;
}

// the ids whose box lies wholly inside the box (what a frame carries when it is dragged)
export function boxesInside(boxes, box) {
  const out = [];
  for (const [id, b] of boxes) if (b[0] >= box[0] && b[1] >= box[1] && b[0] + b[2] <= box[0] + box[2] && b[1] + b[3] <= box[1] + box[3]) out.push(id);
  return out;
}

// the first frame whose box holds the point (frames: [[id, box]...]), or undefined
export function frameAt(frames, p) {
  for (const [id, b] of frames) if (p[0] >= b[0] && p[0] <= b[0] + b[2] && p[1] >= b[1] && p[1] <= b[1] + b[3]) return id;
  return undefined;
}

// the box from two corners, in any order
export const boxOf = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];

// the box round boxes (or points: [x, y] count as boxes of no size); undefined for none
export function boundsOf(list) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of list) {
    x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]);
    x1 = Math.max(x1, b[0] + (b[2] || 0)); y1 = Math.max(y1, b[1] + (b[3] || 0));
  }
  return x0 === Infinity ? undefined : [x0, y0, x1 - x0, y1 - y0];
}

// the nearest node the arrow keys go to from `from`: boxes [[id, box]...], dir 'left' | 'right' | 'up' | 'down'.
// Only nodes that way count; straight ahead beats off to the side
export function nearestToward(boxes, from, dir) {
  const centre = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
  const start = boxes.find(([id]) => id === from);
  if (!start) return boxes[0]?.[0];
  const [sx, sy] = centre(start[1]), [ax, ay] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
  let best, bestScore = Infinity;
  for (const [id, b] of boxes) {
    if (id === from) continue;
    const [cx, cy] = centre(b), ahead = (cx - sx) * ax + (cy - sy) * ay, side = Math.abs((cx - sx) * ay - (cy - sy) * ax);
    if (ahead <= 0) continue;
    const score = ahead + 2 * side;
    if (score < bestScore) { bestScore = score; best = id; }
  }
  return best;
}

// ---------------------------------------------------------------- small helpers

function cubic([p0, p1, p2, p3], t) {
  const u = 1 - t;
  return [0, 1].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]);
}

export function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const towards = (from, to, r) => { const d = dist(from, to) || 1; return [from[0] + (to[0] - from[0]) * r / d, from[1] + (to[1] - from[1]) * r / d]; };
const n = (v) => Math.round(v * 10) / 10;
