// A small layered layout for node graphs, left to right as dagre's "rankdir LR": what causes on the left, what it
// causes on the right. Deterministic (the same graph and places give the same answer), and pinned nodes never move:
// the others go around them. Pure: tests/test_graph_layout.mjs.
//
// Pluggable: graph-canvas.js takes any function with layered's contract as its `layout` option, so a library (dagre,
// MIT) could replace this one later without touching the canvas.
//
//   graph    {nodes: [{id, w, h}], edges: [{from, to}]}   from / to: node ids (edges to other ids are left out)
//   at       {id: [x, y]}: where the nodes are now, their top-left corner (a node without one has not been placed)
//   options  {fixed: ids that never move (pinned), only: the ids to arrange (every other node stays), gapX, gapY,
//             origin: [x, y] where the arranged block starts}
//   returns  {id: [x, y]} for every node of the graph
export const GAP = { x: 64, y: 24 };
const SWEEPS = 8;                                 // barycentre passes over the columns, down and up in turn

export function layered(graph, at = {}, options = {}) {
  const gapX = options.gapX ?? GAP.x, gapY = options.gapY ?? GAP.y;
  const size = sizesOf(graph), moving = movingIds(graph, at, options), out = {};
  for (const n of graph.nodes) if (!moving.has(n.id)) out[n.id] = [...at[n.id]];
  const ids = graph.nodes.map((n) => n.id).filter((id) => moving.has(id));
  if (!ids.length) return out;
  const edges = edgesAmong(graph.edges, moving);
  // each piece of the graph laid out on its own, the pieces stacked down in the order of their first node
  const pieces = componentsOf(ids, edges).map((piece) => {
    const inPiece = new Set(piece), own = edges.filter((e) => inPiece.has(e.from));
    return { columns: orderColumns(columnsOf(piece, ranksOf(piece, own)), own), edges: own };
  });
  // the columns line up across the pieces: a column is as wide as its widest node in any piece
  const widths = [];
  for (const p of pieces) p.columns.forEach((col, r) => { widths[r] = Math.max(widths[r] || 0, ...col.map((id) => size.get(id)[0])); });
  const [x0, y0] = originOf(ids, at, out, size, options, gapX), colX = [];
  widths.forEach((w, r) => { colX[r] = r ? colX[r - 1] + widths[r - 1] + gapX : x0; });
  let top = y0;
  for (const p of pieces) {
    const ys = rowsOf(p.columns, p.edges, size, top, gapY);
    p.columns.forEach((col, r) => col.forEach((id) => { out[id] = [colX[r], ys.get(id)]; }));
    top = Math.max(...p.columns.flat().map((id) => ys.get(id) + size.get(id)[1])) + gapY * 2;
  }
  const fixedBoxes = Object.keys(out).filter((id) => !moving.has(id)).map((id) => boxOf(out, size, id));
  if (fixedBoxes.length) avoidFixed(pieces, out, size, fixedBoxes, gapY);
  return out;
}

// A new node beside the pin it was dragged from: to the right of an output, to the left of an input, its own pin
// level with that one. What it lands on is pushed down out of the way (and what that lands on, in turn); a pinned
// node is never pushed: the new node (or the node pushed) goes under it instead.
//   anchor {node: id, side: 'out' | 'in', y: the pin's y}   node {id, w, h}   options.pinY: where the new node's own
//   pin is, from its top (14: the middle of a 28 px header); options.fixed: the pinned ids
export function placeBeside(graph, at, node, anchor, options = {}) {
  const gapX = options.gapX ?? GAP.x, gapY = options.gapY ?? GAP.y, pinY = options.pinY ?? 14;
  const size = sizesOf(graph), fixed = new Set(options.fixed || []), out = { ...at };
  size.set(node.id, [node.w || 0, node.h || 0]);
  const from = at[anchor.node];
  if (!from) { out[node.id] = [0, 0]; return out; }
  const x = anchor.side === 'in' ? from[0] - gapX - node.w : from[0] + size.get(anchor.node)[0] + gapX;
  const fixedBoxes = [...fixed].filter((id) => out[id] && size.has(id)).map((id) => boxOf(out, size, id));
  out[node.id] = [x, clearOf(fixedBoxes, [x, (anchor.y ?? from[1] + pinY) - pinY, node.w, node.h], gapY)];
  makeRoom(out, size, fixed, fixedBoxes, node.id, gapY);
  return out;
}

// how many pairs of wires between neighbouring columns cross (columns: lists of ids, top to bottom)
export function crossings(columns, edges) {
  const col = new Map(), place = placeOf(columns), byColumn = new Map();
  columns.forEach((c, r) => c.forEach((id) => col.set(id, r)));
  for (const e of edges) if (col.get(e.to) === col.get(e.from) + 1) listIn(byColumn, col.get(e.from)).push([place.get(e.from), place.get(e.to)]);
  let count = 0;
  for (const list of byColumn.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if ((list[i][0] - list[j][0]) * (list[i][1] - list[j][1]) < 0) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------- the steps

function sizesOf(graph) {
  return new Map(graph.nodes.map((n) => [n.id, [n.w || 0, n.h || 0]]));
}

function listIn(map, key) {
  if (!map.has(key)) map.set(key, []);
  return map.get(key);
}

// what leads into each node, and where each leads
function neighbours(edges) {
  const ins = new Map(), outs = new Map();
  for (const e of edges) { listIn(ins, e.to).push(e.from); listIn(outs, e.from).push(e.to); }
  return { ins, outs };
}

// the nodes to arrange: `only` (or every node), less the fixed ones; a node not placed yet is always arranged
function movingIds(graph, at, options) {
  const fixed = new Set(options.fixed || []), only = options.only ? new Set(options.only) : null;
  return new Set(graph.nodes.map((n) => n.id).filter((id) => !at[id] || (!fixed.has(id) && (!only || only.has(id)))));
}

function edgesAmong(edges, ids) {
  return (edges || []).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
}

// the connected pieces, each listed in the graph's own order
function componentsOf(ids, edges) {
  const { ins, outs } = neighbours(edges), order = new Map(ids.map((x, i) => [x, i]));
  const seen = new Set(), pieces = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const piece = [], stack = [id];
    seen.add(id);
    while (stack.length) {
      const at = stack.pop();
      piece.push(at);
      for (const n of [...(outs.get(at) || []), ...(ins.get(at) || [])]) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    pieces.push(piece.sort((a, b) => order.get(a) - order.get(b)));
  }
  return pieces;
}

// the column of each node: the longest way in from a node nothing leads to, after turning round the wires that close
// a loop (found by a walk from each node in turn); a node that only leads somewhere sits just left of its nearest target
function ranksOf(ids, edges) {
  const { outs } = neighbours(edges), state = new Map(), forward = [];
  for (const root of ids) {
    if (state.has(root)) continue;
    const stack = [[root, 0]];
    state.set(root, 'open');
    while (stack.length) {
      const top = stack[stack.length - 1], list = outs.get(top[0]) || [];
      if (top[1] >= list.length) { state.set(top[0], 'done'); stack.pop(); continue; }
      const to = list[top[1]++];
      if (state.get(to) === 'open') continue;           // back to a node on the way: this wire closes a loop
      forward.push({ from: top[0], to });
      if (!state.has(to)) { state.set(to, 'open'); stack.push([to, 0]); }
    }
  }
  const { ins, outs: next } = neighbours(forward), rank = new Map();
  const waiting = new Map(ids.map((id) => [id, (ins.get(id) || []).length])), ready = ids.filter((id) => !waiting.get(id));
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i];
    rank.set(id, Math.max(0, ...(ins.get(id) || []).map((p) => rank.get(p) + 1)));
    for (const s of next.get(id) || []) { waiting.set(s, waiting.get(s) - 1); if (!waiting.get(s)) ready.push(s); }
  }
  for (const id of ids) if (!ins.has(id) && next.has(id)) rank.set(id, Math.min(...next.get(id).map((s) => rank.get(s))) - 1);
  const low = Math.min(...rank.values());
  for (const id of ids) rank.set(id, rank.get(id) - low);
  return rank;
}

function columnsOf(ids, rank) {
  const columns = [];
  for (const id of ids) (columns[rank.get(id)] = columns[rank.get(id)] || []).push(id);
  return Array.from(columns, (c) => c || []);
}

function placeOf(columns) {
  const place = new Map();
  for (const col of columns) col.forEach((id, i) => place.set(id, i));
  return place;
}

// fewer crossings: each node moved to the average place of its neighbours in the columns before (then after), the
// best order seen kept; ties keep the order they had, so the result depends on nothing but the input
function orderColumns(columns, edges) {
  const { ins, outs } = neighbours(edges), order = columns.map((c) => [...c]);
  let best = order.map((c) => [...c]), fewest = crossings(order, edges);
  for (let sweep = 0; sweep < SWEEPS && fewest > 0; sweep++) {
    const down = sweep % 2 === 0, near = down ? ins : outs, place = placeOf(order);
    const span = order.map((_, r) => r);
    for (const r of down ? span.slice(1) : span.reverse().slice(1)) {
      const centre = (id, i) => {
        const ns = near.get(id) || [];
        return ns.length ? ns.reduce((s, n) => s + place.get(n), 0) / ns.length : i;
      };
      order[r] = order[r].map((id, i) => [id, centre(id, i), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]);
      order[r].forEach((id, i) => place.set(id, i));
    }
    const now = crossings(order, edges);
    if (now < fewest) { fewest = now; best = order.map((c) => [...c]); }
  }
  return best;
}

// where the arranged block starts: as asked, else where its nodes were, else right of the nodes that stay
function originOf(ids, at, staying, size, options, gapX) {
  if (options.origin) return options.origin;
  const placed = ids.filter((id) => at[id]);
  if (placed.length) return [Math.min(...placed.map((id) => at[id][0])), Math.min(...placed.map((id) => at[id][1]))];
  const others = Object.keys(staying);
  if (!others.length) return [0, 0];
  return [Math.max(...others.map((id) => staying[id][0] + (size.get(id)?.[0] || 0))) + gapX, Math.min(...others.map((id) => staying[id][1]))];
}

// the heights in each column: stacked in order, each node lowered (never raised) level with the middle of what leads
// to it; then a node of the first column that is the one way into the one node it leads to, lowered level with it.
// The piece then starts at `top`
function rowsOf(columns, edges, size, top, gapY) {
  const ys = new Map(), { ins, outs } = neighbours(edges);
  const centre = (id) => ys.get(id) + size.get(id)[1] / 2;
  const settle = (col, near) => {
    let floor = top;
    for (const id of col) {
      const ns = (near.get(id) || []).filter((n) => ys.has(n) && n !== id);
      ys.set(id, Math.max(floor, ns.length ? median(ns.map(centre)) - size.get(id)[1] / 2 : floor));
      floor = ys.get(id) + size.get(id)[1] + gapY;
    }
  };
  columns.forEach((col, r) => settle(col, r ? ins : new Map()));
  const heads = columns[0].filter((id) => (outs.get(id) || []).length === 1 && ins.get(outs.get(id)[0]).length === 1);
  if (columns.length > 1) settle(columns[0], new Map(heads.map((id) => [id, outs.get(id)])));
  const lift = Math.min(...ys.values()) - top;
  for (const [id, y] of ys) ys.set(id, y - lift);
  return ys;
}

function median(list) {
  const s = [...list].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// an arranged node that lands on one that stays goes down under it, and the nodes under it in its column with it
function avoidFixed(pieces, out, size, fixedBoxes, gapY) {
  const columns = new Map();
  for (const p of pieces) for (const id of p.columns.flat()) listIn(columns, out[id][0]).push(id);
  for (const col of columns.values()) {
    col.sort((a, b) => out[a][1] - out[b][1]);
    let floor = -Infinity;
    for (const id of col) {
      const [w, h] = size.get(id);
      out[id] = [out[id][0], clearOf(fixedBoxes, [out[id][0], Math.max(out[id][1], floor), w, h], gapY)];
      floor = out[id][1] + h + gapY;
    }
  }
}

// what `id` now lands on goes down under it, in turn, nearest first; a fixed node stays, and one pushed goes under it
function makeRoom(out, size, fixed, fixedBoxes, id, gapY) {
  const queue = [id], others = Object.keys(out).filter((o) => o !== id && !fixed.has(o) && size.has(o));
  for (let guard = 0; queue.length && guard < 4 * others.length + 4; guard++) {
    const at = queue.shift(), box = boxOf(out, size, at);
    const hit = others.filter((o) => o !== at && overlaps(boxOf(out, size, o), box, gapY)).sort((a, b) => out[a][1] - out[b][1] || (a < b ? -1 : 1));
    for (const o of hit) {
      const [w, h] = size.get(o);
      out[o] = [out[o][0], clearOf(fixedBoxes, [out[o][0], box[1] + box[3] + gapY, w, h], gapY)];
      queue.push(o);
    }
  }
}

// the first height at or under box's own where it lands on none of the boxes that stay
function clearOf(fixedBoxes, box, gapY) {
  let y = box[1];
  for (let guard = 0; guard <= fixedBoxes.length; guard++) {
    const hit = fixedBoxes.find((f) => overlaps(f, [box[0], y, box[2], box[3]], gapY));
    if (!hit) break;
    y = hit[1] + hit[3] + gapY;
  }
  return y;
}

function boxOf(out, size, id) {
  const [w, h] = size.get(id) || [0, 0];
  return [out[id][0], out[id][1], w, h];
}

// two boxes [x, y, w, h] with less than `gap` between them on both axes
function overlaps(a, b, gap) {
  return a[0] < b[0] + b[2] + gap && b[0] < a[0] + a[2] + gap && a[1] < b[1] + b[3] + gap && b[1] < a[1] + a[3] + gap;
}
