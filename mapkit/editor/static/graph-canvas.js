// The node graph canvas: the Logic window's graph (and, from P5, the Story Graph's). Nodes with typed pins (inputs on
// the left edge, outputs on the right, articy's dots), wires that cause (one kind each: WIRE_KINDS), a label chip on a
// wire with a delay that can be dragged sideways, reroute dots, frames, notes, a minimap, and semantic zoom: under 50%
// only titles and live values, under 25% only frames, the wires between them bundled with their count.
//
// One grammar for the editor's canvases (final_design.json ux_walkthrough I, graph-input.js): left-drag on empty space
// draws a selection box (or pans: settings.leftDrag 'pan'), the middle button, Space-drag or Alt-drag pan, the wheel
// zooms at the pointer (a trackpad's two fingers pan, Ctrl+wheel zooms), Shift or Ctrl+click add to the selection,
// F frames the selection, Home fits, Tab or a tap of Space adds, Delete deletes, the arrows go from node to node.
// No key fires while a field has the focus. The other keys stop at the canvas, so the 3D view's never act on the map
// from here; only the editor's global ones go on (graph-input.js PASS: undo, redo, save, Shift+Space...).
//
// It draws what it is given and changes nothing itself: each edit is a callback (one undo step each, app.js
// lkChange), and the caller gives the graph back with set(). Drawing is keyed by id: set() rebuilds only the nodes
// whose look changed, a move draws again only the wires of the nodes moved, and pins are placed from the fixed row
// heights (graph-geometry.js), never read back from the page. Pure parts: graph-geometry.js, graph-input.js and
// graph-layout.js (the layout, which a library could replace: options.layout).
//
// set({nodes, wires, frames, notes}):
//   node  {id, title, sub?, icon? (a key of options.icons), thumb? (a key for options.thumb), at? [x, y] (none: placed
//          by the layout, not saved until moved), w?, badges? [{text, title?}], live? (a live value: "2 / 3", "open"),
//          tone? 'ok'|'warn'|'bad' (status only), dim?, bar? (a block: a bar on its left), pinned?, label? (for screen
//          readers), in? / out? (header pins), rows? [row], foot?}
//   row   {id, text, title?, time? ("2 s"), head? (a section title), sep? (a line above), tone?, dim?, chips? [{text,
//          title?, tone?}], in? / out? (pins)}
//   pin   {id, type?, label?, title?, free? (goes nowhere yet)}
//   wire  {id, from: {node, pin}, to: {node, pin}, kind? (WIRE_KINDS), label?, delay? (seconds: a chip to drag),
//          tone?, title?, via? [[x, y]...] (reroute points)}
//   frame {id, title, rect: [x, y, w, h], tone? 0-3}      note {id, text, at? [x, y], on? (a node id: shown over it)}
// options: label (what the canvas is, for screen readers), settings {leftDrag: 'select'|'pan', wheel: 'auto'|'zoom',
//   minimap: true}, icons {key: SVG paths on the 20 px grid of editor-icons.js}, thumb(key) -> Promise of a picture's
//   URL (or null), layout (graph-layout.js layered's contract), canConnect(from, to) -> true or why not (asked while a
//   wire is dragged; without it, graph-geometry.js pinsFit on the pins' types), and the callbacks: onConnect(from, to) -> true or why not, onPinDrop(from, at), onMove(moves),
//   onDelay(wire, seconds), onReroute(wire, via), onSelect(selection), onOpen(node), onRow(node, row),
//   onWireOpen(wire), onWireDelete(wire), onDropOnWire(node, wire, moves) -> true (it kept the moves too) or why not,
//   onRetarget(wires, end, to) -> true or why not, onAdd(at), onDelete(selection), onContext(hit, at),
//   onCommand(name, detail).   from / to: {node, pin}; at: {world, screen, client}; moves: {nodes, frames, notes: {id:
//   place}}; selection: {nodes, wires, frames, notes: [ids]}.
import { NODE, DETAIL, detailAt, toWorld, panBy, zoomAt, wheelZoom, fitView, centreOn, visibleBox, pinsOf, pinsFit, nodeSize, pinPoint, routeWire,
  bundleRoute, bundleWires, wireIndex, wiresOfNodes, insertReroute, delayFromDrag, delayText, wireAt, pinNear, boxesTouching,
  boxesInside, frameAt, boxOf, boundsOf, nearestToward } from './graph-geometry.js';
import { keyFor, passesOn, keyNames, digitOf, typing, gestureFor, emptyDrag, wheelIntent, wheelUnit, emptySelection, isSelected,
  selectionSize, pressSelect, releaseSelect, boxSelect, only, pruneSelection, sameSelection, selectionLists, SELECTABLE } from './graph-input.js';
import { layered } from './graph-layout.js';
import { escapeHtml as esc } from './shortcut-bar.js';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./graph-canvas.css', import.meta.url).href;
document.head.appendChild(css);
// until the stylesheet is in, a canvas has no size of its own: its first fit waits for it
const styled = new Promise((done) => { css.addEventListener('load', done); css.addEventListener('error', done); });

// the wire kinds, one table (as ai-paths.js PATH_KINDS): each one's colour (a theme token) and dashes
export const WIRE_KINDS = {
  causes: { stroke: 'var(--dim)', dash: '', label: 'Causes' },
  signal: { stroke: 'var(--heading)', dash: '6 4', label: 'Signal' },
  wiring: { stroke: 'var(--dim)', dash: '1 4', label: 'Game wiring (read only)' },
  state: { stroke: 'var(--dim)', dash: '3 3', label: 'Reads a state' },
};

// The nodes' 1 / zoom at a zoom (--gc-inv on the node layer, which only the covers' title and value use): 1 at full
// detail; at the titles level in quarter steps rounded down (each step restyles every node: about 8 across the level),
// so a 13 px title is 11.4 to 13 px on the screen, never larger. Below that level the covers are blank
// (graph-canvas.css), so the step stays the titles level's last and zooming further out restyles no node
const TITLES_FROM = DETAIL.find((d) => d.level === 'titles').min;
function titleStep(k) {
  const level = detailAt(k);
  if (level === 'full') return '1';
  const inv = level === 'titles' ? 1 / k : 1 / TITLES_FROM;
  return String(Math.floor(inv * 4) / 4);
}
const TONES = ['ok', 'warn', 'bad'];               // status colours, for status only (DESIGN.md)
const FRAME_TONES = ['t0', 't1', 't2', 't3'];
const ICONS = { pinned: '<path d="M7 3h6l-1 5 3 3H5l3-3zM10 11v6"/>' };
// a run's trail (pulse): the wire takes the accent and its dashes run along it twice, then it is as it was (Web
// Animations: no class is left behind and nothing is measured); with reduced motion the accent alone, for as long
const PULSE = { stroke: 'var(--acc)', dash: '8 10', run: 36, ms: 450, times: 2 };
// what a press on each part of a wire, node, frame or note selects ({kind, id}: the id is hit[kind])
const PART_OF = { node: 'node', pin: 'node', wire: 'wire', chip: 'wire', delay: 'wire', dot: 'wire', frame: 'frame', resize: 'frame', note: 'note' };
const SVG = 'http://www.w3.org/2000/svg';
const MOVE_FROM = 3;                               // screen px a press goes before it is a drag
const SNAP = 14;                                   // screen px: a wire let go this near a pin goes to it
const HIT = 6;                                     // screen px: a click this near a wire is on it
const MIN_FRAME = 80;
const REASON_MS = 2600;
const DEFAULTS = { leftDrag: 'select', wheel: 'auto', minimap: true };
let canvases = 0;                                  // canvases made: their element ids stay apart

export function createGraphCanvas(host, options = {}) {
  const o = options, layout = o.layout || layered, uid = `gc${++canvases}`;
  let settings = { ...DEFAULTS, ...o.settings };
  const root = document.createElement('div');
  root.className = 'gc';
  root.tabIndex = 0;
  // its own keys, as the menus spell them: menubar.js's layer leaves them to the canvas while it has the focus, even
  // when a shortcut of the 3D view was moved onto one of them (the Console's log does the same)
  root.dataset.keys = keyNames().join(' ');
  root.setAttribute('role', 'application');
  root.setAttribute('aria-roledescription', 'node graph');
  root.setAttribute('aria-label', o.label || 'Graph');
  root.setAttribute('aria-describedby', `${uid}-help`);
  for (const [name, v] of [['--gc-w', NODE.w], ['--gc-header', NODE.header], ['--gc-row', NODE.row]]) root.style.setProperty(name, v + 'px');
  root.innerHTML = `<div class="gc-world"><div class="gc-frames"></div>
      <svg class="gc-wires" width="1" height="1" aria-hidden="true"><g class="gc-wire-g"></g><g class="gc-bundles"></g><g class="gc-ghosts"></g></svg>
      <div class="gc-chips"></div><div class="gc-nodes"></div><div class="gc-notes"></div></div>
    <div class="gc-box" hidden></div><div class="gc-reason" role="status" hidden></div>
    <div class="gc-corner"><button type="button" class="gc-zoom" title="Zoom to 100%">100%</button><canvas class="gc-mini" aria-hidden="true"></canvas></div>
    <p class="gc-sr gc-help" id="${uid}-help">Arrow keys go from node to node, Enter edits, Delete deletes, Tab or Space adds,
      F frames the selection, Home fits everything, Shift+Tab leaves the graph.</p><p class="gc-sr gc-say" aria-live="polite"></p>`;
  host.appendChild(root);
  const $ = (sel) => root.querySelector(sel);
  const world = $('.gc-world'), frameLayer = $('.gc-frames'), wireLayer = $('.gc-wire-g'), bundleLayer = $('.gc-bundles');
  const ghostLayer = $('.gc-ghosts'), chipLayer = $('.gc-chips'), nodeLayer = $('.gc-nodes'), noteLayer = $('.gc-notes');
  const boxEl = $('.gc-box'), reasonEl = $('.gc-reason'), zoomEl = $('.gc-zoom'), miniEl = $('.gc-mini'), sayEl = $('.gc-say');

  const nodes = new Map(), wires = new Map(), frames = new Map(), notes = new Map();   // id -> what is drawn for it
  const stores = { node: nodes, wire: wires, frame: frames, note: notes };
  const exists = (kind, id) => stores[kind].has(id);
  const owner = new WeakMap();                     // an element -> {kind, id} of what it draws
  const auto = new Map();                          // where the layout put the nodes the caller has no place for
  const thumbs = new Map();                        // a picture's key -> its URL (null: asked for, or none)
  const stats = { nodesMade: 0, nodesDrawn: 0, nodesMoved: 0, wiresMade: 0, wiresRouted: 0 };
  const none = () => ({ nodes: new Set(), wires: new Set() });
  let view = { x: 40, y: 40, k: 1 }, detail = 'full', size = [1, 1], rect = { left: 0, top: 0 };
  let index = new Map(), sel = emptySelection(), drag = null, cursor = null, pointer = null;
  let space = null, held = '', lit = none(), outside = null, hovered = null;
  let miniView = null, frame = 0, reasonTimer = 0, fitted = false, ready = false;

  // ---------------------------------------------------------------- nodes

  function nodeHtml(n) {
    const order = new Map(pinsOf(n).map((p, i) => [p.pin, i]));
    const pin = (p, side) => (p ? `<i class="gc-pin ${side}${p.free ? ' free' : ''}" data-pin="${order.get(p)}"${p.title || p.label ? ` title="${esc(p.title || p.label)}"` : ''}></i>` : '');
    const tone = (t) => (TONES.includes(t) ? ' ' + t : '');
    const chip = (c) => `<span class="gc-c${tone(c.tone)}"${c.title ? ` title="${esc(c.title)}"` : ''}>${esc(c.text)}</span>`;
    const picture = n.thumb && thumbs.get(n.thumb) ? '<i class="gc-thumb"></i>' : n.icon ? iconHtml(n.icon) : '';
    const head = `<div class="gc-h">${pin(n.in, 'in')}${picture}<b class="gc-t">${esc(n.title)}</b>`
      + `${n.sub ? `<span class="gc-sub">${esc(n.sub)}</span>` : ''}<span class="gc-sp"></span>`
      + (n.badges || []).map((b) => `<span class="gc-b"${b.title ? ` title="${esc(b.title)}"` : ''}>${esc(b.text)}</span>`).join('')
      + (n.pinned ? `<i class="gc-pinned" title="Pinned: Arrange leaves it where it is">${iconHtml('pinned')}</i>` : '')
      + (n.live != null && n.live !== '' ? `<span class="gc-live">${esc(n.live)}</span>` : '') + `${pin(n.out, 'out')}</div>`;
    const rows = (n.rows || []).map((r, i) => `<div class="gc-r${r.head ? ' head' : ''}${r.sep ? ' sep' : ''}${r.dim ? ' dim' : ''}${tone(r.tone)}"`
      + ` data-row="${i}"${r.title ? ` title="${esc(r.title)}"` : ''}>${pin(r.in, 'in')}`
      + (r.time != null && r.time !== '' ? `<span class="gc-time">${esc(r.time)}</span>` : '')
      + `<span class="gc-tx">${esc(r.text)}</span>${(r.chips || []).map(chip).join('')}${pin(r.out, 'out')}</div>`).join('');
    // zoomed out, a cover shows the title and live value only (the rows stay laid out under it: no layout to redo)
    const cover = `<div class="gc-big" aria-hidden="true"><b>${esc(n.title)}</b>${n.live != null && n.live !== '' ? `<span>${esc(n.live)}</span>` : ''}</div>`;
    return head + rows + (n.foot ? `<div class="gc-r gc-foot">${esc(n.foot)}</div>` : '') + cover;
  }
  function iconHtml(key) {
    const paths = (o.icons && o.icons[key]) || ICONS[key] || '';
    return `<svg class="gc-ic" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
  }
  // what a node looks like, apart from where it is: drawn again only when this changes
  const lookOf = (n) => JSON.stringify([n.title, n.sub, n.icon, n.thumb, thumbs.get(n.thumb) || '', n.badges, n.live, n.tone, n.dim, n.bar,
    n.pinned, n.label, n.w, n.in, n.out, n.rows, n.foot]);

  function drawNode(e) {
    const n = e.data, el = e.el;
    el.className = 'gc-node' + (TONES.includes(n.tone) ? ' ' + n.tone : '') + (n.dim ? ' dim' : '') + (n.bar ? ' bar' : '')
      + (sel.nodes.has(n.id) ? ' sel' : '') + (cursor === n.id ? ' cur' : '') + (lit.nodes.has(n.id) ? ' hot' : '');
    el.innerHTML = nodeHtml(n);
    el.setAttribute('aria-label', n.label || [n.title, n.sub, n.live].filter((t) => t != null && t !== '').join(', '));
    e.size = nodeSize(n);
    el.style.width = e.size[0] + 'px';
    el.style.height = e.size[1] + 'px';
    const list = pinsOf(n);
    e.pinEls = new Map([...el.querySelectorAll('.gc-pin')].map((pinEl) => [list[+pinEl.dataset.pin].id, pinEl]));
    e.linked = new Set();
    e.pins = null;
    const pic = n.thumb && thumbs.get(n.thumb);
    if (pic) el.querySelector('.gc-thumb').style.backgroundImage = `url(${JSON.stringify(pic)})`;
    else if (n.thumb && !thumbs.has(n.thumb) && o.thumb) askThumb(n.thumb);
    stats.nodesDrawn++;
  }
  // a picture asked for once per key; when it comes, only the nodes that show it are drawn again
  function askThumb(key) {
    thumbs.set(key, null);
    Promise.resolve(o.thumb(key)).then((url) => {
      if (!url) return;
      thumbs.set(key, url);
      for (const e of nodes.values()) if (e.data.thumb === key) { e.look = lookOf(e.data); drawNode(e); }
      markLinked();
    }, () => {});
  }
  function placeNode(e, at) {
    e.at = at;
    e.el.style.transform = `translate(${at[0]}px,${at[1]}px)`;
    e.pins = null;
    stats.nodesMoved++;
  }
  // a pin's place, worked out once per place (and look) of its node
  function pinAt(end) {
    const e = nodes.get(end?.node);
    if (!e) return null;
    if (!e.pins) e.pins = new Map(pinsOf(e.data).map((p) => [p.id, { entry: p, at: pinPoint(e.data, e.at, p) }]));
    return e.pins.get(end.pin) || null;
  }
  const nodeBox = (e) => [e.at[0], e.at[1], e.size[0], e.size[1]];
  function* nodeBoxes() { for (const [id, e] of nodes) yield [id, nodeBox(e)]; }
  function moveNodes(places) {                     // places: Map id -> [x, y]; their wires and notes follow
    for (const [id, p] of places) placeNode(nodes.get(id), p);
    const ids = new Set(places.keys());
    for (const id of wiresOfNodes(index, ids)) route(id);
    notesOn(ids);
    dirtyMini();
  }

  // ---------------------------------------------------------------- wires

  // a wire's path from its pins, through `via` (its own reroute points, or a drag's preview of them)
  function route(id, via = wires.get(id).data.via || []) {
    const e = wires.get(id), w = e.data, a = pinAt(w.from), b = pinAt(w.to);
    let geo;
    if (a && b) geo = routeWire(a.at, b.at, { lane: e.lane, boxes: [nodeBox(nodes.get(w.from.node)), nodeBox(nodes.get(w.to.node))], via });
    else if (a || b) {                             // one end gone: a short broken stub from the end that is there
      const p = (a || b).at, q = a ? [p[0] + 40, p[1]] : [p[0] - 40, p[1]];
      geo = { d: `M${p[0]},${p[1]} L${q[0]},${q[1]}`, mid: q, pts: [p, q] };
    } else geo = { d: '', mid: [0, 0], pts: [] };
    e.geo = { pts: geo.pts, box: boundsOf(geo.pts) || [0, 0, 0, 0] };
    e.path.setAttribute('d', geo.d);
    e.path.classList.toggle('bad', !(a && b) || w.tone === 'bad');
    if (e.chip) e.chip.style.transform = `translate(${geo.mid[0]}px,${geo.mid[1]}px) translate(-50%,-50%)`;
    via.forEach((p, i) => { if (e.dots[i]) e.dots[i].style.transform = `translate(${p[0]}px,${p[1]}px) translate(-50%,-50%)`; });
    stats.wiresRouted++;
  }
  const wireLook = (w) => JSON.stringify([w.kind, w.label, w.delay, w.tone, w.title, w.via, w.from, w.to]);
  function drawWire(e) {
    const w = e.data, kind = WIRE_KINDS[w.kind] || WIRE_KINDS.causes;
    e.path.setAttribute('class', 'gc-wire' + (w.tone === 'warn' ? ' warn' : '') + (sel.wires.has(w.id) ? ' sel' : '') + (lit.wires.has(w.id) ? ' hot' : ''));
    e.path.style.setProperty('--gc-stroke', kind.stroke);
    if (kind.dash) e.path.setAttribute('stroke-dasharray', kind.dash); else e.path.removeAttribute('stroke-dasharray');
    const hasChip = !!w.label || typeof w.delay === 'number';
    if (hasChip && !e.chip) { e.chip = document.createElement('div'); owner.set(e.chip, { kind: 'wire', id: w.id }); chipLayer.appendChild(e.chip); }
    if (!hasChip && e.chip) { e.chip.remove(); e.chip = null; }
    if (e.chip) {
      e.chip.className = 'gc-chip' + (sel.wires.has(w.id) ? ' sel' : '');
      e.chip.title = w.title || '';
      e.chip.innerHTML = (w.label ? `<span class="gc-cl">${esc(w.label)}</span>` : '')
        + (typeof w.delay === 'number' ? `<span class="gc-delay" title="Delay: drag sideways, or click and type">${esc(delayText(w.delay))}</span>` : '');
    }
    for (const d of e.dots) d.remove();
    e.dots = (w.via || []).map((_, i) => {
      const d = document.createElement('i');
      d.className = 'gc-dot';
      d.dataset.dot = String(i);
      d.title = 'Reroute point: drag to move, Alt+click to remove';
      owner.set(d, { kind: 'wire', id: w.id });
      chipLayer.appendChild(d);
      return d;
    });
  }
  // after a drag's preview (a delay, a reroute point) and the caller's answer: the wire as the caller has it now, so a
  // refused or clamped change does not stay on the screen (a caller that took it gave it back with set() already)
  function settle(id) {
    const e = wires.get(id);
    if (!e) return;
    drawWire(e);
    route(id);
  }
  function removeWire(e) { e.path.remove(); e.chip?.remove(); for (const d of e.dots) d.remove(); }
  function* wireGeoms(skip) { for (const [id, e] of wires) if (e.geo && !skip?.has(id)) yield [id, e.geo]; }

  // the pins with a wire show it (filled); kept per node, changed only where it changed
  function markLinked() {
    const now = new Map();
    for (const e of wires.values()) for (const end of [e.data.from, e.data.to]) {
      if (!now.has(end.node)) now.set(end.node, new Set());
      now.get(end.node).add(end.pin);
    }
    for (const [id, e] of nodes) {
      const want = now.get(id) || new Set();
      for (const [pinId, pinEl] of e.pinEls) if (want.has(pinId) !== e.linked.has(pinId)) pinEl.classList.toggle('on', want.has(pinId));
      e.linked = want;
    }
  }

  // ---------------------------------------------------------------- set: the graph, keyed

  function set(graph = {}) {
    const list = graph.nodes || [], wireList = graph.wires || [], dragged = drag?.ids || new Set();
    const moved = new Set(), seen = new Set(), unplaced = [];
    for (const n of list) {
      seen.add(n.id);
      let e = nodes.get(n.id);
      if (!e) {
        e = { data: n, el: document.createElement('div'), look: '', at: null, pinEls: new Map(), linked: new Set() };
        e.el.id = `${uid}-n${stats.nodesMade++}`;
        e.el.setAttribute('role', 'group');
        owner.set(e.el, { kind: 'node', id: n.id });
        nodes.set(n.id, e);
        nodeLayer.appendChild(e.el);
      }
      e.data = n;
      const look = lookOf(n);
      if (look !== e.look) { e.look = look; drawNode(e); moved.add(n.id); }
      if (n.at) auto.delete(n.id);
      const at = dragged.has(n.id) ? e.at : n.at || auto.get(n.id);
      if (!at) unplaced.push(n.id);
      else if (!e.at || at[0] !== e.at[0] || at[1] !== e.at[1]) { placeNode(e, at); moved.add(n.id); }
    }
    for (const [id, e] of nodes) if (!seen.has(id)) { e.el.remove(); nodes.delete(id); auto.delete(id); moved.add(id); }
    if (unplaced.length) placeNew(unplaced, wireList, moved);
    // the wires: made, drawn again when they changed, routed again when they changed or an end moved
    const lanes = new Map(), wireSeen = new Set();
    for (const w of wireList) {
      wireSeen.add(w.id);
      let e = wires.get(w.id);
      if (!e) {
        e = { data: w, path: document.createElementNS(SVG, 'path'), chip: null, dots: [], look: '', lane: 0, geo: null };
        wires.set(w.id, e);
        wireLayer.appendChild(e.path);
        stats.wiresMade++;
      }
      e.data = w;
      const lane = lanes.get(w.from.node) || 0;
      lanes.set(w.from.node, (lane + 1) % 4);
      const look = wireLook(w);
      if (look !== e.look) { e.look = look; drawWire(e); e.geo = null; }
      if (!e.geo || lane !== e.lane || moved.has(w.from.node) || moved.has(w.to.node)) { e.lane = lane; route(w.id); }
    }
    for (const [id, e] of wires) if (!wireSeen.has(id)) { removeWire(e); wires.delete(id); }
    index = wireIndex(wireList);
    markLinked();
    setFrames(graph.frames || []);
    setNotes(graph.notes || []);
    const kept = pruneSelection(sel, exists);
    if (!sameSelection(kept, sel)) applySelection(kept, true);
    if (cursor && !nodes.has(cursor)) cursor = null;
    if (detail === 'frames') bundle();
    fitOnce();
    dirtyMini();
  }
  // nodes the caller has not placed: laid out round the ones placed (which stay), kept here until moved
  function placeNew(ids, wireList, moved) {
    const at = {};
    for (const [id, e] of nodes) if (e.at && !ids.includes(id)) at[id] = e.at;
    const out = layout(graphOf(wireList), at, { only: ids, fixed: pinnedIds() });
    for (const id of ids) { auto.set(id, out[id]); placeNode(nodes.get(id), out[id]); moved.add(id); }
  }
  const graphOf = (wireList) => ({ nodes: [...nodes.values()].map((e) => ({ id: e.data.id, w: e.size[0], h: e.size[1] })),
    edges: wireList.map((w) => ({ from: w.from.node, to: w.to.node })) });
  const pinnedIds = () => [...nodes.values()].filter((e) => e.data.pinned).map((e) => e.data.id);

  function setFrames(list) {
    const seen = new Set();
    for (const f of list) {
      seen.add(f.id);
      let e = frames.get(f.id);
      if (!e) {
        e = { data: f, el: document.createElement('div') };
        e.el.innerHTML = '<div class="gc-ft"></div><i class="gc-fr" title="Drag to resize the frame"></i>';
        owner.set(e.el, { kind: 'frame', id: f.id });
        frames.set(f.id, e);
        frameLayer.appendChild(e.el);
      }
      e.data = f;
      drawFrame(e, f.rect);
    }
    for (const [id, e] of frames) if (!seen.has(id)) { e.el.remove(); frames.delete(id); }
  }
  function drawFrame(e, r) {
    e.rect = r;
    e.el.className = 'gc-frame ' + (FRAME_TONES[e.data.tone] || FRAME_TONES[0]) + (sel.frames.has(e.data.id) ? ' sel' : '');
    e.el.style.transform = `translate(${r[0]}px,${r[1]}px)`;
    e.el.style.width = r[2] + 'px';
    e.el.style.height = r[3] + 'px';
    e.el.firstChild.textContent = e.data.title || '';
  }
  function setNotes(list) {
    const seen = new Set();
    for (const nt of list) {
      seen.add(nt.id);
      let e = notes.get(nt.id);
      if (!e) {
        e = { data: nt, el: document.createElement('div') };
        owner.set(e.el, { kind: 'note', id: nt.id });
        notes.set(nt.id, e);
        noteLayer.appendChild(e.el);
      }
      e.data = nt;
      e.el.className = 'gc-note' + (nt.on ? ' on' : '') + (sel.notes.has(nt.id) ? ' sel' : '');
      e.el.textContent = nt.text || '';
      placeNote(e);
    }
    for (const [id, e] of notes) if (!seen.has(id)) { e.el.remove(); notes.delete(id); }
  }
  // a note on a node sits over it and goes where it goes; a free note where it was put
  function placeNote(e, at) {
    const over = e.data.on && nodes.get(e.data.on);
    e.at = at || (over ? [over.at[0], over.at[1] - 6] : e.data.at || [0, 0]);
    e.el.style.transform = `translate(${e.at[0]}px,${e.at[1]}px)` + (over && !at ? ' translateY(-100%)' : '');
  }
  function notesOn(ids) {
    for (const e of notes.values()) if (e.data.on && ids.has(e.data.on)) placeNote(e);
  }

  // ---------------------------------------------------------------- the view and semantic zoom

  function setView(v) {
    view = v;
    world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`;
    // 1 / zoom, for what keeps its size on the screen: the frames' titles and the bundles' counts at every step; the
    // nodes' titles in titleStep's steps. Set where it is used, so a zoom restyles nothing else
    const inv = Math.min(8, Math.max(1, 1 / v.k)), level = detailAt(v.k), step = titleStep(v.k);
    frameLayer.style.setProperty('--gc-inv', String(inv));
    bundleLayer.style.setProperty('--gc-inv', String(inv));
    if (nodeLayer.style.getPropertyValue('--gc-inv') !== step) nodeLayer.style.setProperty('--gc-inv', step);
    root.style.backgroundPosition = `${v.x}px ${v.y}px`;
    root.style.backgroundSize = `${22 * v.k}px ${22 * v.k}px`;
    zoomEl.textContent = Math.round(v.k * 100) + '%';
    if (level !== detail) setDetail(level);
    dirtyMini();
  }
  // a zoom level: what the nodes show (graph-canvas.css); the pins and wires stay where they are
  function setDetail(level) {
    detail = level;
    root.classList.toggle('gc-show-titles', level === 'titles');
    root.classList.toggle('gc-show-frames', level === 'frames');
    if (level === 'frames') bundle();
    else { bundleLayer.replaceChildren(); for (const e of nodes.values()) e.el.classList.remove('framed'); }
  }
  // zoomed right out: a node in a frame is hidden, and the wires between frames (or lone nodes) are one bundle each.
  // A group is a frame's entry or, for a node in no frame, the node's own
  function bundle() {
    const frameBoxes = [...frames].map(([id, e]) => [id, e.rect]);
    const groupOf = (id) => {
      const e = nodes.get(id);
      return e && (frames.get(frameAt(frameBoxes, [e.at[0] + e.size[0] / 2, e.at[1] + e.size[1] / 2])) || e);
    };
    const boxOfGroup = (g) => g.rect || nodeBox(g);
    for (const [id, e] of nodes) e.el.classList.toggle('framed', groupOf(id) !== e);
    bundleLayer.replaceChildren(...bundleWires([...wires.values()].map((e) => e.data), groupOf).flatMap((b) => {
      const geo = bundleRoute(boxOfGroup(b.from), boxOfGroup(b.to)), path = document.createElementNS(SVG, 'path');
      path.setAttribute('class', 'gc-bundle');
      path.setAttribute('d', geo.d);
      if (b.ids.length < 2) return [path];
      const count = document.createElementNS(SVG, 'text');
      count.setAttribute('class', 'gc-count');
      count.setAttribute('x', String(geo.mid[0]));
      count.setAttribute('y', String(geo.mid[1]));
      count.textContent = String(b.ids.length);
      return [path, count];
    }));
  }
  // the first time there are nodes and the canvas has its size (its stylesheet is in): all of them in view
  function fitOnce() { if (ready && !fitted && nodes.size && size[0] > 1 && size[1] > 1) { fitted = true; fit(); } }
  function fit() { setView(fitView(boundsOf([...nodeBoxes()].map(([, b]) => b).concat([...frames.values()].map((e) => e.rect))), size)); }
  // F: the selection framed (or everything, when nothing is selected)
  function frameSelection() {
    const boxes = [...sel.nodes].filter((id) => nodes.has(id)).map((id) => nodeBox(nodes.get(id)))
      .concat([...sel.frames].filter((id) => frames.has(id)).map((id) => frames.get(id).rect));
    if (!boxes.length) return fit();
    setView(fitView(boundsOf(boxes), size, { max: Math.max(1, view.k) }));
  }
  // the nodes brought into sight, the zoom kept, when one is outside it
  function reveal(ids) {
    const b = boundsOf(ids.filter((id) => nodes.has(id)).map((id) => nodeBox(nodes.get(id)))), v = visibleBox(view, size);
    if (!b || (b[0] >= v[0] && b[1] >= v[1] && b[0] + b[2] <= v[0] + v[2] && b[1] + b[3] <= v[1] + v[3])) return;
    setView(centreOn(view, [b[0] + b[2] / 2, b[1] + b[3] / 2], size));
  }

  // ---------------------------------------------------------------- the minimap

  // drawn once in the next frame, however many changes came first
  function dirtyMini() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; drawMini(); });
  }
  function drawMini() {
    miniEl.hidden = !settings.minimap || !nodes.size;
    const w = miniEl.clientWidth, h = miniEl.clientHeight, dpr = window.devicePixelRatio || 1;
    if (miniEl.hidden || !w || !h || !miniEl.getContext) return;
    if (miniEl.width !== Math.round(w * dpr)) { miniEl.width = Math.round(w * dpr); miniEl.height = Math.round(h * dpr); }
    const ctx = miniEl.getContext('2d'), style = getComputedStyle(root), token = (name) => style.getPropertyValue(name).trim();
    const seen = visibleBox(view, size), boxes = [...nodeBoxes()];
    miniView = fitView(boundsOf(boxes.map(([, b]) => b).concat([...frames.values()].map((e) => e.rect), [seen])), [w, h], { pad: 4, min: 0, max: Infinity });
    const r = (b) => [b[0] * miniView.k + miniView.x, b[1] * miniView.k + miniView.y, Math.max(1, b[2] * miniView.k), Math.max(1, b[3] * miniView.k)];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = token('--line');
    for (const e of frames.values()) ctx.strokeRect(...r(e.rect));
    ctx.fillStyle = token('--dim');
    ctx.globalAlpha = 0.55;
    for (const [id, b] of boxes) if (!sel.nodes.has(id)) ctx.fillRect(...r(b));
    ctx.globalAlpha = 1;
    ctx.fillStyle = token('--acc');
    for (const id of sel.nodes) if (nodes.has(id)) ctx.fillRect(...r(nodeBox(nodes.get(id))));
    ctx.strokeStyle = token('--acc');
    ctx.strokeRect(...r(seen));
  }

  // ---------------------------------------------------------------- the selection, lighting, the keyboard cursor

  // a new selection: only the elements whose state changed are touched; the caller hears of it unless it set it
  function applySelection(next, quiet = false) {
    const was = sel, changed = (key) => new Set([...was[key], ...next[key]]);
    sel = next;
    for (const id of changed('nodes')) nodes.get(id)?.el.classList.toggle('sel', next.nodes.has(id));
    for (const id of changed('wires')) {
      wires.get(id)?.path.classList.toggle('sel', next.wires.has(id));
      wires.get(id)?.chip?.classList.toggle('sel', next.wires.has(id));
    }
    for (const id of changed('frames')) frames.get(id)?.el.classList.toggle('sel', next.frames.has(id));
    for (const id of changed('notes')) notes.get(id)?.el.classList.toggle('sel', next.notes.has(id));
    dirtyMini();
    if (!quiet && !sameSelection(was, next)) o.onSelect?.(selectionLists(next));
  }
  // lit: these wires and nodes stand out, every other wire is dimmed (hover, or light() from the caller)
  function applyLight(next) {
    for (const id of lit.wires) if (!next.wires.has(id)) wires.get(id)?.path.classList.remove('hot');
    for (const id of lit.nodes) if (!next.nodes.has(id)) nodes.get(id)?.el.classList.remove('hot');
    for (const id of next.wires) wires.get(id)?.path.classList.add('hot');
    for (const id of next.nodes) nodes.get(id)?.el.classList.add('hot');
    lit = next;
    root.classList.toggle('gc-lit', next.wires.size > 0 || next.nodes.size > 0);
  }
  // what the pointer is over lights its wires (a pin's, a node's, or the wire itself) and what they lead to
  function hover(w, target) {
    const hit = target ? hitOf(target, w) : { on: 'empty' };
    const same = hovered && hovered.on === hit.on && hovered.node === hit.node && hovered.wire === hit.wire && hovered.pin?.id === hit.pin?.id;
    if (same) return;
    hovered = hit;
    if (!['pin', 'node', 'wire'].includes(hit.on)) return applyLight(outside || none());
    let ids = hit.on === 'wire' ? [hit.wire] : index.get(hit.node) || [];
    if (hit.on === 'pin') ids = ids.filter((id) => [wires.get(id).data.from, wires.get(id).data.to].some((end) => end.node === hit.node && end.pin === hit.pin.id));
    const ends = new Set(ids.flatMap((id) => [wires.get(id).data.from.node, wires.get(id).data.to.node]));
    ends.delete(hit.node);
    applyLight({ nodes: ends, wires: new Set(ids) });
  }
  function setCursor(id) {
    if (cursor) nodes.get(cursor)?.el.classList.remove('cur');
    cursor = id;
    const e = nodes.get(id);
    if (!e) { root.removeAttribute('aria-activedescendant'); return; }
    e.el.classList.add('cur');
    root.setAttribute('aria-activedescendant', e.el.id);
    sayEl.textContent = e.el.getAttribute('aria-label');
    reveal([id]);
  }

  // ---------------------------------------------------------------- what is under the pointer

  // -> {on: (graph-input.js gestureFor's), node?, pin? (pinsOf's entry), row?, wire?, dot?, frame?, note?}
  function hitOf(target, w) {
    if (target === miniEl) return { on: 'mini' };
    const nodeEl = target.closest?.('.gc-node'), node = nodeEl ? owner.get(nodeEl)?.id : undefined;
    const pinEl = target.closest?.('.gc-pin');
    if (pinEl && node !== undefined && detail === 'full') return { on: 'pin', node, pin: pinsOf(nodes.get(node).data)[+pinEl.dataset.pin] };
    const chip = target.closest?.('.gc-chip, .gc-dot');
    if (chip) {
      const wire = owner.get(chip).id;
      if (chip.classList.contains('gc-dot')) return { on: 'dot', wire, dot: +chip.dataset.dot };
      return { on: target.closest('.gc-delay') ? 'delay' : 'chip', wire };
    }
    const frameEl = target.closest?.('.gc-frame');
    if (frameEl && target.closest('.gc-fr')) return { on: 'resize', frame: owner.get(frameEl).id };
    if (frameEl && target.closest('.gc-ft')) return { on: 'frame', frame: owner.get(frameEl).id };
    const noteEl = target.closest?.('.gc-note');
    if (noteEl) return { on: 'note', note: owner.get(noteEl).id };
    if (node !== undefined) {
      const row = target.closest('.gc-r');
      return { on: 'node', node, row: row && row.dataset.row !== undefined ? +row.dataset.row : -1 };
    }
    const wire = detail === 'frames' ? null : wireAt(wireGeoms(), w, HIT / view.k);
    return wire === null ? { on: 'empty' } : { on: 'wire', wire };
  }
  const screenOf = (ev) => [ev.clientX - rect.left, ev.clientY - rect.top];
  const atOf = (ev) => { const s = screenOf(ev); return { screen: s, world: toWorld(view, s), client: [ev.clientX, ev.clientY] }; };
  const mods = (ev) => ({ shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey });
  // where an added thing goes: under the pointer when it is over the canvas, else the middle of the view
  const addAt = () => pointer || { screen: [size[0] / 2, size[1] / 2], world: toWorld(view, [size[0] / 2, size[1] / 2]), client: null };

  // ---------------------------------------------------------------- reasons at the pointer

  function showReason(text, screen) {
    clearTimeout(reasonTimer);
    reasonEl.textContent = text;
    reasonEl.hidden = false;
    reasonEl.style.left = Math.max(4, Math.min(size[0] - 290, screen[0] + 14)) + 'px';
    reasonEl.style.top = Math.max(4, Math.min(size[1] - 40, screen[1] + 16)) + 'px';
    reasonTimer = setTimeout(hideReason, REASON_MS);
  }
  function hideReason() { clearTimeout(reasonTimer); reasonEl.hidden = true; }
  // a callback's answer: true or nothing goes on; a sentence is why it was refused, shown at the pointer
  function refused(result, at) {
    if (typeof result !== 'string' || !result) return false;
    showReason(result, at.screen);
    return true;
  }

  // ---------------------------------------------------------------- drags: one maker per gesture

  // each returns {move(at, ev), end(at, moved, ev), cancel(), ids? (the nodes it moves: set() leaves their places)}
  const DRAGS = {
    pan(hit, at) {
      const start = { ...view };
      return {
        move(a) { setView(panBy(start, a.screen[0] - at.screen[0], a.screen[1] - at.screen[1])); if (space) space.panned = true; },
        end() {},
        cancel() { setView(start); },
      };
    },
    // Alt: a drag pans, a click takes the wire away (or the reroute point)
    'alt-click'(hit, at) {
      return { ...DRAGS.pan(hit, at), end(a, moved) {
        if (moved) return;
        if (hit.on === 'dot') o.onReroute?.(hit.wire, (wires.get(hit.wire).data.via || []).filter((_, i) => i !== hit.dot));
        else o.onWireDelete?.(hit.wire);
      } };
    },
    box(hit, at) {
      return {
        move(a) {
          const b = boxOf(at.screen, a.screen);
          boxEl.hidden = false;
          Object.assign(boxEl.style, { left: b[0] + 'px', top: b[1] + 'px', width: b[2] + 'px', height: b[3] + 'px' });
        },
        end(a, moved, ev) {
          boxEl.hidden = true;
          if (moved) applySelection(boxSelect(sel, boxesTouching(nodeBoxes(), boxOf(at.world, a.world)), mods(ev)));
          else if (hit.on === 'wire') applySelection(pressSelect(sel, { kind: 'wire', id: hit.wire }, mods(ev)));
          else if (!mods(ev).shift && !mods(ev).ctrl) applySelection(emptySelection());
        },
        cancel() { boxEl.hidden = true; },
      };
    },
    // on a wire: a click selects it, a drag does what a drag on empty space does
    wire(hit, at, ev) {
      if (emptyDrag(settings, mods(ev).shift || mods(ev).ctrl) === 'box') return DRAGS.box(hit, at);
      return { ...DRAGS.pan(hit, at), end(a, moved, e) { if (!moved) applySelection(pressSelect(sel, { kind: 'wire', id: hit.wire }, mods(e))); } };
    },
    node(hit, at, ev) {
      const item = { kind: 'node', id: hit.node };
      applySelection(pressSelect(sel, item, mods(ev)));
      const ids = new Set(sel.nodes.has(hit.node) ? sel.nodes : []), from = new Map([...ids].map((id) => [id, nodes.get(id).at]));
      const mine = new Set(index.get(hit.node) || []);
      let onto = null;                             // a wire the node would be dropped onto (one node, and onDropOnWire)
      const light = (next) => {
        if (onto !== null) wires.get(onto)?.path.classList.remove('drop');
        onto = next;
        if (onto !== null) wires.get(onto)?.path.classList.add('drop');
      };
      return {
        ids,
        move(a) {
          const dx = a.world[0] - at.world[0], dy = a.world[1] - at.world[1];
          moveNodes(new Map([...from].map(([id, p]) => [id, [p[0] + dx, p[1] + dy]])));
          if (ids.size !== 1 || !o.onDropOnWire) return;
          const b = nodeBox(nodes.get(hit.node)), next = wireAt(wireGeoms(mine), [b[0] + b[2] / 2, b[1] + b[3] / 2], HIT * 2 / view.k);
          if (next !== onto) light(next);
        },
        end(a, moved, e) {
          const dropped = onto;
          light(null);
          if (!moved) {
            applySelection(releaseSelect(sel, item, mods(e), false));
            const row = hit.row >= 0 && nodes.get(hit.node).data.rows?.[hit.row];
            if (row) o.onRow?.(hit.node, row.id);
            return;
          }
          const moves = { nodes: Object.fromEntries([...ids].map((id) => [id, nodes.get(id).at])) };
          for (const id of ids) auto.delete(id);
          if (dropped !== null && !refused(o.onDropOnWire(hit.node, dropped, moves), a)) return;
          o.onMove?.(moves);
        },
        cancel() { light(null); moveNodes(from); },
      };
    },
    link(hit, at) { return linkDrag({ node: hit.node, pin: hit.pin.id }, hit.pin.side); },
    // Ctrl+drag a pin: all its wires go to the pin they are let go on
    rewire(hit, at) {
      const end = hit.pin.side === 'out' ? 'from' : 'to', other = end === 'from' ? 'to' : 'from';
      const ids = (index.get(hit.node) || []).filter((id) => wires.get(id).data[end].node === hit.node && wires.get(id).data[end].pin === hit.pin.id);
      if (!ids.length) return linkDrag({ node: hit.node, pin: hit.pin.id }, hit.pin.side);
      const fixedEnds = ids.map((id) => pinAt(wires.get(id).data[other])).filter(Boolean), ghosts = fixedEnds.map(() => ghostPath());
      const targets = pinsWhere((p, node) => p.side === hit.pin.side && !(node === hit.node && p.id === hit.pin.id));
      let snap = null;
      return {
        move(a) {
          snap = pinNear(targets, a.world, SNAP / view.k);
          const tip = snap ? [snap.x, snap.y] : a.world;
          fixedEnds.forEach((f, i) => ghosts[i].setAttribute('d', (end === 'from' ? routeWire(tip, f.at) : routeWire(f.at, tip)).d));
        },
        end(a) {
          ghostLayer.replaceChildren();
          if (snap) refused(o.onRetarget?.(ids, end, { node: snap.node, pin: snap.pin }), a);
        },
        cancel() { ghostLayer.replaceChildren(); },
      };
    },
    // the chip shows the dragged delay as a preview; the wire's data stays the caller's until it answers
    delay(hit, at) {
      const e = wires.get(hit.wire), start = e.data.delay, span = e.chip.querySelector('.gc-delay');
      let value = start;
      return {
        move(a) { value = delayFromDrag(start, a.screen[0] - at.screen[0]); span.textContent = delayText(value); },
        end(a, moved) {
          if (!moved) return typeDelay(hit.wire, span);
          if (value !== start) o.onDelay?.(hit.wire, value);
          settle(hit.wire);
        },
        cancel() { settle(hit.wire); },
      };
    },
    chip(hit) {
      return { move() {}, cancel() {}, end(a, moved, ev) {
        if (moved) return;
        applySelection(pressSelect(sel, { kind: 'wire', id: hit.wire }, mods(ev)));
        o.onWireOpen?.(hit.wire);
      } };
    },
    // the wire is routed through the dragged point as a preview; its data stays the caller's until it answers
    dot(hit) {
      const from = (wires.get(hit.wire).data.via || []).map((p) => [...p]);
      let via = from;
      return {
        move(a) { via = from.map((p, i) => (i === hit.dot ? a.world : p)); route(hit.wire, via); },
        end(a, moved, ev) {
          if (!moved) return applySelection(pressSelect(sel, { kind: 'wire', id: hit.wire }, mods(ev)));
          o.onReroute?.(hit.wire, via);
          settle(hit.wire);
        },
        cancel() { settle(hit.wire); },
      };
    },
    // a frame dragged by its title takes along the nodes and free notes wholly inside it
    frame(hit, at, ev) {
      const item = { kind: 'frame', id: hit.frame }, f = frames.get(hit.frame), start = [...f.rect];
      applySelection(pressSelect(sel, item, mods(ev)));
      const ids = new Set(boxesInside(nodeBoxes(), start)), from = new Map([...ids].map((id) => [id, nodes.get(id).at]));
      const loose = boxesInside([...notes].filter(([, e]) => !e.data.on).map(([id, e]) => [id, [e.at[0], e.at[1], 1, 1]]), start).map((id) => notes.get(id));
      const noteFrom = new Map(loose.map((e) => [e, e.at]));
      const shift = (dx, dy) => {
        drawFrame(f, [start[0] + dx, start[1] + dy, start[2], start[3]]);
        for (const [e, p] of noteFrom) placeNote(e, [p[0] + dx, p[1] + dy]);
        moveNodes(new Map([...from].map(([id, p]) => [id, [p[0] + dx, p[1] + dy]])));
      };
      return {
        ids,
        move(a) { shift(a.world[0] - at.world[0], a.world[1] - at.world[1]); },
        end(a, moved, e) {
          if (!moved) return applySelection(releaseSelect(sel, item, mods(e), false));
          for (const id of ids) auto.delete(id);
          o.onMove?.({ frames: { [hit.frame]: f.rect }, nodes: Object.fromEntries([...ids].map((id) => [id, nodes.get(id).at])),
            notes: Object.fromEntries(loose.map((n) => [n.data.id, n.at])) });
        },
        cancel() { shift(0, 0); },
      };
    },
    resize(hit, at) {
      const f = frames.get(hit.frame), start = [...f.rect];
      return {
        move(a) {
          drawFrame(f, [start[0], start[1], Math.max(MIN_FRAME, start[2] + a.world[0] - at.world[0]), Math.max(MIN_FRAME, start[3] + a.world[1] - at.world[1])]);
          dirtyMini();
        },
        end(a, moved) { if (moved) o.onMove?.({ frames: { [hit.frame]: f.rect } }); },
        cancel() { drawFrame(f, start); },
      };
    },
    // a free note moves; a note on a node goes with its node, so a press only selects it
    note(hit, at, ev) {
      const item = { kind: 'note', id: hit.note }, e = notes.get(hit.note), start = e.at, free = !e.data.on;
      applySelection(pressSelect(sel, item, mods(ev)));
      return {
        move(a) { if (free) placeNote(e, [start[0] + a.world[0] - at.world[0], start[1] + a.world[1] - at.world[1]]); },
        end(a, moved, ev2) {
          if (!moved) applySelection(releaseSelect(sel, item, mods(ev2), false));
          else if (free) o.onMove?.({ notes: { [hit.note]: e.at } });
        },
        cancel() { if (free) placeNote(e, start); },
      };
    },
    minimap(hit, at, ev) {
      const go = (e) => {
        if (!miniView) return;
        const r = miniEl.getBoundingClientRect();
        setView(centreOn(view, toWorld(miniView, [e.clientX - r.left, e.clientY - r.top]), size));
      };
      go(ev);
      return { move(a, e) { go(e); }, end() {}, cancel() {} };
    },
    // a digit held and a click on empty space: what that key places, there
    place(hit, at) {
      const key = held;
      return { move() {}, cancel() {}, end(a, moved) { if (!moved) o.onCommand?.('place', { key, at }); } };
    },
  };

  // a wire dragged out of a pin: the pins it could go to light up (or say why not, at the pointer); let go on one it
  // asks onConnect, on empty space (or a click on the pin) onPinDrop: the add menu, already wired
  function linkDrag(from, side) {
    const start = pinAt(from), ghost = ghostPath(), verdicts = new Map();
    const targets = pinsWhere((p, node) => p.side !== side && node !== from.node);
    const ends = (to) => (side === 'out' ? [from, to] : [to, from]);
    const fits = o.canConnect || ((a, b) => pinsFit(pinAt(a).entry.pin, pinAt(b).entry.pin));
    for (const t of targets) {
      const v = fits(...ends({ node: t.node, pin: t.pin }));
      verdicts.set(t, v);
      nodes.get(t.node).pinEls.get(t.pin)?.classList.add(v === true ? 'ok' : 'no');
    }
    root.classList.add('gc-linking');
    let snap = null;
    const clear = () => {
      ghostLayer.replaceChildren();
      root.classList.remove('gc-linking');
      for (const t of targets) nodes.get(t.node)?.pinEls.get(t.pin)?.classList.remove('ok', 'no');
      hideReason();
    };
    return {
      move(a) {
        snap = pinNear(targets, a.world, SNAP / view.k);
        const tip = snap ? [snap.x, snap.y] : a.world, why = snap ? verdicts.get(snap) : true;
        ghost.setAttribute('d', (side === 'out' ? routeWire(start.at, tip) : routeWire(tip, start.at)).d);
        ghost.classList.toggle('no', typeof why === 'string');
        if (typeof why === 'string' && why) showReason(why, a.screen); else hideReason();
      },
      end(a) {
        clear();
        if (!snap) return o.onPinDrop?.({ ...from, side }, a);
        const why = verdicts.get(snap);
        refused(typeof why === 'string' ? why : o.onConnect?.(...ends({ node: snap.node, pin: snap.pin })), a);
      },
      cancel: clear,
    };
  }
  // every pin that passes `test(pin entry, node id)`, with its place: {node, pin, side, x, y}
  function pinsWhere(test) {
    const out = [];
    for (const [id, e] of nodes) for (const p of pinsOf(e.data)) {
      if (!test(p, id)) continue;
      const at = pinAt({ node: id, pin: p.id }).at;
      out.push({ node: id, pin: p.id, side: p.side, x: at[0], y: at[1] });
    }
    return out;
  }
  function ghostPath() {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('class', 'gc-ghost');
    ghostLayer.appendChild(path);
    return path;
  }
  // a click on a wire's delay: typed in place (Enter or leaving the field keeps it, Esc does not). Enter and Esc give
  // the focus back to the canvas; leaving the field (a click on another panel's field) only keeps the value: moving the
  // focus inside a blur cancels the move that caused it (Chromium), and the next keys would be the canvas's
  function typeDelay(id, span) {
    const field = document.createElement('input');
    field.type = 'number';
    field.className = 'gc-field';
    field.min = '0';
    field.step = '0.1';
    field.value = String(wires.get(id).data.delay);
    field.setAttribute('aria-label', 'Delay in seconds');
    const chip = span.closest('.gc-chip');
    chip.classList.add('typing');
    span.replaceChildren(field);
    field.focus();
    field.select();
    let done = false;
    const finish = (keep, refocus) => {
      if (done) return;
      done = true;
      chip.classList.remove('typing');
      const start = wires.get(id)?.data.delay, v = Math.max(0, Math.round((+field.value || 0) * 10) / 10);
      if (keep && v !== start) o.onDelay?.(id, v);
      settle(id);                                  // the chip shows the caller's delay: the one typed, or not if refused
      if (refocus) root.focus({ preventScroll: true });
    };
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(e.key === 'Enter', true); }
    });
    field.addEventListener('blur', () => finish(true, false));
  }

  // ---------------------------------------------------------------- the mouse

  function refreshRect() {
    const r = root.getBoundingClientRect();
    rect = { left: r.left, top: r.top };
    size = [Math.max(1, root.clientWidth), Math.max(1, root.clientHeight)];
  }
  function onDown(ev) {
    if (drag || ev.target === zoomEl || ev.target.closest?.('.gc-field')) return;
    refreshRect();
    hideReason();
    root.classList.remove('gc-kbd');
    root.focus({ preventScroll: true });
    const at = atOf(ev), hit = hitOf(ev.target, at.world);
    const gesture = gestureFor({ button: ev.button, alt: ev.altKey, ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey, space: !!space, held, on: hit.on }, settings);
    if (gesture === 'none') return;
    ev.preventDefault();
    const started = DRAGS[gesture](hit, at, ev);
    drag = { ...started, ids: started.ids || new Set(), pointerId: ev.pointerId, at, moved: false };
    root.classList.toggle('gc-panning', gesture === 'pan' || gesture === 'alt-click');
    try { root.setPointerCapture?.(ev.pointerId); } catch { /* a made-up event's pointer (a script, the tutorial): no capture */ }
  }
  function onMove(ev) {
    const at = atOf(ev);
    pointer = at;
    if (!drag) return hover(at.world, ev.target);
    if (ev.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(at.screen[0] - drag.at.screen[0], at.screen[1] - drag.at.screen[1]) > MOVE_FROM) drag.moved = true;
    if (drag.moved) drag.move(at, ev);
  }
  function onUp(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const was = drag;
    drag = null;
    root.classList.remove('gc-panning');
    if (root.hasPointerCapture?.(ev.pointerId)) root.releasePointerCapture(ev.pointerId);
    was.end(atOf(ev), was.moved, ev);
    dirtyMini();
  }
  function cancelDrag() {
    if (!drag) return;
    const was = drag;
    drag = null;
    root.classList.remove('gc-panning');
    if (root.hasPointerCapture?.(was.pointerId)) root.releasePointerCapture(was.pointerId);
    was.cancel();
  }
  function onWheel(ev) {
    ev.preventDefault();
    if (drag) return;
    const at = screenOf(ev), unit = wheelUnit(ev);
    if (wheelIntent(ev, settings) === 'zoom') setView(wheelZoom(view, ev.deltaY * unit, at));
    else setView(panBy(view, -ev.deltaX * unit, -ev.deltaY * unit));
  }
  function onDouble(ev) {
    if (ev.target.closest?.('.gc-chip, .gc-field') || ev.target === zoomEl || ev.target === miniEl) return;
    const at = atOf(ev), hit = hitOf(ev.target, at.world);
    if (hit.on === 'node') o.onOpen?.(hit.node);
    else if (hit.on === 'frame') o.onCommand?.('rename', { frame: hit.frame });
    else if (hit.on === 'wire') {
      const w = wires.get(hit.wire).data, a = pinAt(w.from), b = pinAt(w.to);
      if (a && b) o.onReroute?.(hit.wire, insertReroute(a.at, w.via || [], b.at, at.world));
    } else if (hit.on === 'empty') o.onAdd?.(at);
  }
  // a right-click selects what it is on (unless it is selected already) and asks the caller for its menu
  function onContext(ev) {
    ev.preventDefault();
    if (drag) return;
    refreshRect();
    const at = atOf(ev), hit = hitOf(ev.target, at.world), kind = PART_OF[hit.on];
    const item = kind ? { kind, id: hit[kind] } : null;
    if (item && !isSelected(sel, item)) applySelection(only(item));
    o.onContext?.(item ? { ...item, pin: hit.on === 'pin' ? { node: hit.node, pin: hit.pin.id, side: hit.pin.side } : undefined } : { kind: 'empty' }, at);
  }

  // ---------------------------------------------------------------- the keys

  // the commands the canvas does itself; any other of graph-input.js KEYS goes to onCommand
  const OWN = {
    add: () => o.onAdd?.(addAt()),
    delete: () => { if (selectionSize(sel)) o.onDelete?.(selectionLists(sel)); },
    'frame-selection': () => frameSelection(),
    fit: () => fit(),
    'select-all': () => applySelection(boxSelect(emptySelection(), [...nodes.keys()])),
  };
  // Esc: a drag cancelled, a reason hidden, or the selection cleared; false when there was nothing to cancel
  function onEscape() {
    if (drag) cancelDrag();
    else if (!reasonEl.hidden) hideReason();
    else if (selectionSize(sel)) applySelection(emptySelection());
    else return false;
    return true;
  }
  // a key of the canvas, done; false when it had nothing to do and goes on to the editor (Esc, graph-input.js PASS)
  function run(entry, ev) {
    const command = entry.command;
    if (command === 'escape') return onEscape();
    if (command === 'space') { if (!ev.repeat && !space) { space = { panned: false }; root.classList.add('gc-grab'); } }
    else if (command === 'hold') held = digitOf(ev);
    else if (command === 'go') { root.classList.add('gc-kbd'); go(entry.dir); }
    else if (command === 'bookmark') o.onCommand?.('bookmark', { slot: digitOf(ev), view: { ...view } });
    else if (OWN[command]) OWN[command]();
    else o.onCommand?.(command, { selection: selectionLists(sel), cursor, at: addAt() });
    return true;
  }
  function onKey(ev) {
    if (typing(ev.target)) return;                 // a field in the canvas (a delay being typed) keeps its keys
    // the canvas's keys, pressed on the canvas itself: on its zoom button Space, Enter and Tab are the button's. A key
    // the menus' layer sent again as the 3D view's own (a shortcut moved in Settings: menubar.js marks it __deusedix)
    // is meant for the 3D view, never a command of the graph
    const entry = ev.target === root && !ev.__deusedix ? keyFor(ev) : null;
    if (entry && run(entry, ev)) { ev.preventDefault(); ev.stopPropagation(); return; }
    // any other key stops here, so it never reaches the 3D view's shortcuts (End would drop the map's selection to the
    // floor, B place a block); the browser's own (Shift+Tab leaving the canvas) still happens
    if (!passesOn(ev)) ev.stopPropagation();
  }
  function onKeyUp(ev) {
    if (ev.key === ' ' && space) {
      const tapped = !space.panned && !drag;
      space = null;
      root.classList.remove('gc-grab');
      if (tapped && ev.target === root) o.onAdd?.(addAt());
    }
    if (held && digitOf(ev) === held) held = '';
  }
  // the zoom button: 100% at the middle. Clicked with the mouse (detail: how many clicks) it gives the focus back to
  // the canvas, which the press had given the button, where every graph key would stop; pressed from the keyboard
  // (Enter, Space: detail 0) it keeps the focus, so Tab goes on from it
  function zoomTo100(ev) {
    refreshRect();
    setView(zoomAt(view, 1, [size[0] / 2, size[1] / 2]));
    if (ev.detail > 0) root.focus({ preventScroll: true });
  }
  // the arrows: to the nearest node that way, which is selected (as a list's arrows do)
  function go(dir) {
    const next = cursor && nodes.has(cursor) ? nearestToward([...nodeBoxes()], cursor, dir)
      : [...sel.nodes].find((id) => nodes.has(id)) ?? nodes.keys().next().value;
    if (next === undefined) return;
    setCursor(next);
    applySelection(only({ kind: 'node', id: next }));
  }

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', cancelDrag);
  root.addEventListener('lostpointercapture', (ev) => { if (drag && ev.pointerId === drag.pointerId) cancelDrag(); });
  root.addEventListener('pointerenter', refreshRect);
  root.addEventListener('pointerleave', () => { pointer = null; if (!drag) hover(null, null); });
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('dblclick', onDouble);
  root.addEventListener('contextmenu', onContext);
  root.addEventListener('keydown', onKey);
  root.addEventListener('keyup', onKeyUp);
  root.addEventListener('blur', () => { space = null; held = ''; root.classList.remove('gc-grab'); });
  zoomEl.addEventListener('click', zoomTo100);
  const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { refreshRect(); fitOnce(); dirtyMini(); }) : null;
  watch?.observe(root);
  refreshRect();
  setView(view);
  styled.then(() => { ready = true; refreshRect(); fitOnce(); dirtyMini(); });

  return {
    set,
    // the selection, from the caller (the Inspector, the 3D view): onSelect is not called back
    select(lists = {}) {
      const next = emptySelection();
      for (const key of Object.values(SELECTABLE)) for (const id of lists[key] || []) next[key].add(id);
      applySelection(pruneSelection(next, exists), true);
    },
    selection: () => selectionLists(sel),
    view: () => ({ ...view }),
    setView: (v) => setView({ ...v }),
    fit, frameSelection,
    reveal: (ids) => reveal([...ids]),
    // Arrange: the nodes given (or every node) laid out again by the layout, the pinned ones left; one onMove
    arrange(ids) {
      const at = Object.fromEntries([...nodes].map(([id, e]) => [id, e.at]));
      const out = layout(graphOf([...wires.values()].map((e) => e.data)), at, { only: ids && ids.length ? ids : undefined, fixed: pinnedIds() });
      const places = new Map(Object.entries(out).filter(([id, p]) => p[0] !== at[id][0] || p[1] !== at[id][1]));
      if (!places.size) return;
      for (const id of places.keys()) auto.delete(id);
      moveNodes(places);
      o.onMove?.({ nodes: Object.fromEntries(places) });
    },
    positions: () => Object.fromEntries([...nodes].map(([id, e]) => [id, [...e.at]])),
    // lit from outside (follow the 3D selection, a search): these stand out until light(null)
    light(ids) {
      outside = ids ? { nodes: new Set(ids.nodes || []), wires: new Set(ids.wires || []) } : null;
      hovered = null;
      applyLight(outside || none());
    },
    // a run went along these wires (Try it, Play): each lights for a moment (PULSE), then is as it was
    pulse(ids) {
      const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      const look = (offset) => (still ? { stroke: PULSE.stroke } : { stroke: PULSE.stroke, strokeDasharray: PULSE.dash, strokeDashoffset: String(offset) });
      const timing = still ? { duration: PULSE.ms * PULSE.times } : { duration: PULSE.ms, iterations: PULSE.times };
      for (const id of ids) {
        const e = wires.get(id);
        if (!e?.path.animate) continue;
        e.pulse?.cancel();                         // again while it still runs: from the start
        e.pulse = e.path.animate([look(PULSE.run), look(0)], timing);
      }
    },
    settings: () => ({ ...settings }),
    setSettings(s) { settings = { ...settings, ...s }; dirtyMini(); },
    worldAt: (clientX, clientY) => { refreshRect(); return toWorld(view, [clientX - rect.left, clientY - rect.top]); },
    focus: () => root.focus({ preventScroll: true }),
    stats: () => ({ ...stats, nodes: nodes.size, wires: wires.size }),
    element: root,
    destroy() {
      cancelDrag();
      watch?.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(reasonTimer);
      root.remove();
    },
  };
}
