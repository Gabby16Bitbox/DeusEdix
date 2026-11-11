// Your own blocks (P8 slice 1, editor/LOGIC.md "Your own blocks"): rules and logic pieces put in a box (Ctrl+G in the
// Logic window's graph), drawn as one node whose ports are the wires that cross its edge. A box is a way of looking:
// the rules stay the map's rules, and the game runs them as before.
//
// edits.logic.boxes = [{id: 'X1', name, rules: [rule ids], pieces: [piece node ids: blk:B1, sig:Alarm...],
//                       parent: a box's id or null, ports: {<port key>: a name given to it}}]
// A port's key is its outside end: 'in:<node>|<pin>' for what sets off a rule inside from outside, 'out:<node>|<pin>'
// for what a rule inside does to something outside; 'in:state:<name>' / 'out:state:<name>' for a state set on one side
// and read on the other. Its name, until one is given, is that pin's words (or the state's name).
//
// Pure (no DOM): tests/test_logic_boxes.mjs. The graph is logic-graph-model.js logicGraph's (or scopeOf's): {nodes,
// wires}, wires {id, from: {node, pin}, to: {node, pin}, rule?}.

export const BOX = 'box:';
export const PORT = 'port:';
const list = (v) => (Array.isArray(v) ? v : []);
const low = (s) => String(s ?? '').toLowerCase();
export const boxNode = (id) => BOX + id;

// the boxes of a map's edits, cleaned: a box with a name and an id, its lists of strings, its parent one of them
export function boxesOf(edits) {
  const raw = list(edits && edits.logic && edits.logic.boxes).filter((b) => b && typeof b === 'object' && /^X\d+$/.test(String(b.id)));
  const ids = new Set(raw.map((b) => b.id));
  return raw.map((b) => ({ id: b.id, name: String(b.name || b.id), rules: list(b.rules).map(String), pieces: list(b.pieces).map(String),
    parent: b.parent && ids.has(b.parent) && b.parent !== b.id ? b.parent : null,
    ports: b.ports && typeof b.ports === 'object' && !Array.isArray(b.ports) ? { ...b.ports } : {} }));
}

// a new box's id: X1, X2... the first free one
export function nextBoxId(boxes) {
  const used = new Set(boxes.map((b) => b.id));
  let n = 1;
  while (used.has('X' + n)) n++;
  return 'X' + n;
}

// the rule ids a box holds, those of the boxes inside it too
export function rulesInside(boxes, id) {
  const out = [], seen = new Set();
  const walk = (b) => {
    if (seen.has(b)) return;
    seen.add(b);
    const x = boxes.find((y) => y.id === b);
    if (!x) return;
    out.push(...x.rules);
    for (const y of boxes) if (y.parent === b) walk(y.id);
  };
  walk(id);
  return out;
}
// the box that holds a rule, nearest first (null when none): to show a rule, one goes into it
export function boxOfRule(boxes, rule) {
  const r = low(rule);
  return (boxes.find((b) => b.rules.some((x) => low(x) === r)) || {}).id || null;
}
// the rule ids in any box (they are drawn as cards: a simple rule's wire would cross the box's edge)
export function boxedRules(boxes) {
  return new Set(boxes.flatMap((b) => b.rules));
}

// the box that holds a node directly (a rule card rule:L7, a piece blk:B1, a box box:X2), or null
function ownerOf(boxes, node) {
  const id = String(node);
  if (id.startsWith(BOX)) return (boxes.find((b) => b.id === id.slice(BOX.length)) || {}).parent || null;
  if (id.startsWith('rule:')) { const r = id.slice(5); return (boxes.find((b) => b.rules.includes(r)) || {}).id || null; }
  return (boxes.find((b) => b.pieces.includes(id)) || {}).id || null;
}
// its boxes from the nearest out: [X3, X1] for a rule in X3, itself in X1
function chainOf(boxes, node) {
  const out = [], seen = new Set();
  for (let b = ownerOf(boxes, node); b && !seen.has(b); b = (boxes.find((x) => x.id === b) || {}).parent || null) { seen.add(b); out.push(b); }
  return out;
}
// what a node is drawn as when one looks at the level `at` (null: the map): itself, the box at that level that holds
// it (box:X1), or null when it is outside that level (only inside a box: what is not in it)
export function shownAs(boxes, node, at = null) {
  const chain = chainOf(boxes, node);
  if (at === null) return chain.length ? boxNode(chain[chain.length - 1]) : node;
  const k = chain.indexOf(at);
  if (k < 0) return null;
  return k === 0 ? node : boxNode(chain[k - 1]);
}

// the words of a pin of the graph: "Button 1: used" (its node's label or name, the pin's label)
function pinWords(byId, end, wire) {
  if (wire && wire.kind === 'state' && wire.state) return wire.state;     // a state set inside, read outside (or so)
  const n = byId.get(end.node);
  if (n && n.kind === 'rule') return `Rule ${n.rule}`;
  const who = n ? (n.kind === 'world' ? 'The map' : n.label || n.name || n.title || n.id) : end.node;
  const pins = n && n.pins ? [...(n.pins.out || []), ...(n.pins.in || [])] : [];
  const p = pins.find((x) => x.id === end.pin);
  const what = p ? String(p.label || '').replace(/\s*\([^)]*\)/g, '') : '';
  return what ? `${who}: ${what}` : String(who);
}
// a port's key: its outside end; a state's (set on one side, read on the other) the state, one port however many read it
const portKey = (side, end, w) => (w && w.kind === 'state' && w.state ? `${side}:state:${w.state}` : `${side}:${end.node}|${end.pin}`);

// The graph as seen at a level: the boxes there one node each, with a port for each outside end of the wires that
// cross them; inside a box (at), its own port nodes at the edges. Returns {nodes, wires, ports: [{key, side, name,
// words, box, ends}]} (the ports of the boxes drawn and, inside one, its own; ends: the inside ends it reaches,
// '<node>|<pin>'), the graph's other fields kept.
export function boxedView(graph, boxes, at = null) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes = new Map(), wires = [], seenWire = new Set(), ports = new Map();
  const box = (id) => boxes.find((b) => b.id === id);
  const named = (b, key, fallback) => (b && typeof b.ports[key] === 'string' && b.ports[key].trim() ? b.ports[key].trim() : fallback);
  // a box drawn at this level: its node, its pins added as wires cross it
  const boxDrawn = (nodeId) => {
    if (nodes.has(nodeId)) return nodes.get(nodeId);
    const b = box(nodeId.slice(BOX.length));
    const n = { id: nodeId, kind: 'thing', box: b.id, name: '', label: b.name, word: 'block', family: 'box', instance: b.instance || null,
      pins: { in: [], out: [] }, rules: 0, pos: null };
    nodes.set(nodeId, n);
    return n;
  };
  const addPin = (n, side, key, label) => {
    if (!n.pins[side].some((p) => p.id === key)) n.pins[side].push({ id: key, label });
  };
  const port = (key, side, b, words, inner) => {
    if (!ports.has(key + '@' + b.id)) ports.set(key + '@' + b.id, { key, side, name: named(b, key, words), box: b.id, words, ends: [] });
    const p = ports.get(key + '@' + b.id), end = `${inner.node}|${inner.pin}`;
    if (!p.ends.includes(end)) p.ends.push(end);
    return p;
  };
  // this level's own port nodes (inside a box): one per outside end
  const portNode = (key, side, words, inner) => {
    const b = box(at), p = port(key, side, b, words, inner), id = PORT + key;
    if (!nodes.has(id)) {
      nodes.set(id, { id, kind: 'thing', port: key, side, name: '', label: p.name, word: side === 'in' ? 'input' : 'output',
        family: 'port', pins: side === 'in' ? { in: [], out: [{ id: 'p', label: 'from outside' }] } : { in: [{ id: 'p', label: 'to outside' }], out: [] }, pos: null });
    }
    return id;
  };
  for (const n of graph.nodes) {
    const as = shownAs(boxes, n.id, at);
    if (as === null) continue;
    if (as === n.id) nodes.set(n.id, n);
    else { const bn = boxDrawn(as); if (n.kind === 'rule') bn.rules++; }
  }
  for (const w of graph.wires) {
    const a = shownAs(boxes, w.from.node, at), b = shownAs(boxes, w.to.node, at);
    if (a === null && b === null) continue;
    if (a !== null && a === b && a.startsWith(BOX)) continue;           // inside one box drawn closed
    let from = { ...w.from }, to = { ...w.to };
    if (a === null) from = { node: portNode(portKey('in', w.from, w), 'in', pinWords(byId, w.from, w), w.to), pin: 'p' };
    else if (a !== w.from.node) {                                       // out of a box drawn here: its output
      const bx = box(a.slice(BOX.length)), key = portKey('out', w.to, w), p = port(key, 'out', bx, pinWords(byId, w.to, w), w.from);
      addPin(boxDrawn(a), 'out', key, p.name);
      from = { node: a, pin: key };
    }
    if (b === null) to = { node: portNode(portKey('out', w.to, w), 'out', pinWords(byId, w.to, w), w.from), pin: 'p' };
    else if (b !== w.to.node) {                                         // into a box drawn here: its input
      const bx = box(b.slice(BOX.length)), key = portKey('in', w.from, w), p = port(key, 'in', bx, pinWords(byId, w.from, w), w.to);
      addPin(boxDrawn(b), 'in', key, p.name);
      to = { node: b, pin: key };
    }
    const sig = `${from.node}|${from.pin}>${to.node}|${to.pin}`;
    if (seenWire.has(sig)) continue;                                    // two rules on one port: one wire
    seenWire.add(sig);
    const changed = from.node !== w.from.node || to.node !== w.to.node;
    wires.push(changed ? { ...w, id: `${w.id}@${from.node}>${to.node}`, from, to, boxed: true } : w);
  }
  // a box's words under its name: how many rules it holds
  // a placed pattern (logic-patterns.js instanceBoxes): one of the project's patterns, its version said
  for (const n of nodes.values()) {
    if (n.family !== 'box') continue;
    const rules = n.rules ? `${n.rules} rule${n.rules === 1 ? '' : 's'}` : '';
    n.word = n.instance ? `pattern v${n.instance.v}${rules ? ', ' + rules : ''}${n.instance.newest ? ' · update' : ''}` : rules ? rules + ' inside' : 'block';
    delete n.instance;
  }
  return { ...graph, nodes: [...nodes.values()], wires, ports: [...ports.values()] };
}

// where one is: [{id: null, name: 'The map'}, {id: 'X1', name}, ...] down to `at`
export function boxPath(boxes, at) {
  const out = [];
  for (let b = at, seen = new Set(); b && !seen.has(b); b = (boxes.find((x) => x.id === b) || {}).parent || null) {
    seen.add(b);
    const x = boxes.find((y) => y.id === b);
    if (x) out.unshift({ id: x.id, name: x.name });
  }
  return [{ id: null, name: 'The map' }, ...out];
}

// the logic blocks a map places as objects (logic.json families: an All of these, a Counter, a Timer...): they can go
// in a block, as the logic's own items do (a pattern brings them along: logic-patterns.js)
export const BLOCK_FAMILIES = new Set(['allof', 'gate', 'switchblock', 'phases', 'atleast', 'counterblock', 'firstof', 'logicblock', 'timer']);

// What a selection of the graph puts in a new box: {rules, pieces, boxes} (rule cards and simple rules' wires, logic
// pieces and logic blocks placed as objects, boxes drawn at this level); other map objects, the Story and the World
// stay outside. A rule's "If not" rule goes with it (otherwiseOf). links: edits.links.
export function selectionMembers(sel, graph, links = []) {
  const rules = new Set(), pieces = new Set(), inner = new Set();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const id of list(sel && sel.nodes)) {
    const n = byId.get(id);
    if (String(id).startsWith(BOX)) inner.add(String(id).slice(BOX.length));
    else if (n && n.kind === 'rule') rules.add(n.rule);
    else if (/^(blk|ph|sig|grp|pt):/.test(String(id))) pieces.add(String(id));
    else if (n && String(id).startsWith('obj:') && BLOCK_FAMILIES.has(n.family)) pieces.add(String(id));
  }
  for (const w of list(sel && sel.wires)) {
    const m = /^rule:([^/@]+)/.exec(String(w));
    if (m) rules.add(m[1]);
  }
  for (const l of list(links)) if (l && l.otherwiseOf && rules.has(l.otherwiseOf)) rules.add(l.id);
  return { rules: [...rules], pieces: [...pieces], boxes: [...inner] };
}

// ---------------------------------------------------------------- the changes (each a new list of boxes)
// a new box at the level `at` holding the members (taken out of the boxes that held them at that level)
export function makeBox(boxes, members, { at = null, name = '' } = {}) {
  const id = nextBoxId(boxes);
  const rules = new Set(members.rules), pieces = new Set(members.pieces), inner = new Set(members.boxes);
  if (!rules.size && !pieces.size && !inner.size) throw new Error('Select rules or logic blocks first (map objects stay outside a block).');
  const out = boxes.map((b) => ({ ...b, rules: b.rules.filter((r) => !rules.has(r)), pieces: b.pieces.filter((p) => !pieces.has(p)),
    parent: inner.has(b.id) ? id : b.parent }));
  const n = boxes.length + 1;
  out.push({ id, name: String(name || '').trim() || `Block ${n}`, rules: [...rules], pieces: [...pieces], parent: at, ports: {} });
  return { boxes: out, id };
}
// the box taken away: what it held goes to its parent
export function unpackBox(boxes, id) {
  const x = boxes.find((b) => b.id === id);
  if (!x) return boxes;
  const parent = x.parent ? boxes.find((b) => b.id === x.parent) : null;
  return boxes.filter((b) => b.id !== id).map((b) => {
    if (parent && b.id === parent.id) return { ...b, rules: [...b.rules, ...x.rules], pieces: [...b.pieces, ...x.pieces] };
    return b.parent === id ? { ...b, parent: x.parent } : b;
  });
}
export function renameBox(boxes, id, name) {
  const t = String(name || '').trim();
  if (!t) throw new Error('A block needs a name.');
  return boxes.map((b) => (b.id === id ? { ...b, name: t } : b));
}
// a port renamed ('' gives it back its pin's words)
export function renamePort(boxes, id, key, name) {
  const t = String(name || '').trim();
  return boxes.map((b) => {
    if (b.id !== id) return b;
    const ports = { ...b.ports };
    if (t) ports[key] = t; else delete ports[key];
    return { ...b, ports };
  });
}
// the boxes without the rules and pieces that are gone (a rule deleted elsewhere); empty boxes stay (a level to fill)
export function pruneBoxes(boxes, ruleIds, pieceIds) {
  const r = new Set(ruleIds), p = new Set(pieceIds);
  return boxes.map((b) => ({ ...b, rules: b.rules.filter((x) => r.has(x)), pieces: b.pieces.filter((x) => p.has(x)) }));
}
// lower-case compare helper for ids typed by people
export const sameId = (a, b) => low(a) === low(b);
