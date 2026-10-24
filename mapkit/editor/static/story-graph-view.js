// The Story's Graph view of a dialogue, as articy:draft shows a flow: each step a node (a line in the colour of who
// speaks, JC's answers with an arrow from each, conditions with Yes and No), the arrows where it goes on. Drag a node
// to move it, drag from a dot to connect it or, on empty space, to add the next step there; double-click the empty
// space to add a step on its own. The selected node is edited at the side with the List view's own fields; Play-test
// runs the dialogue there as the game would (story-sim.js), lighting the node it is at. The model: story-graph.js.
import { END, graphOf, ensureIds, connect, connectStart, insertAt, remove } from './story-graph.js';
import { createPlay, answerConditions, conditionsOf } from './story-sim.js';

const W = 236;                                   // a node's width; its height is its own
const GAP_X = 44, GAP_Y = 56;
const UNDO = 60;
const STYLE = `
.sg { display:flex; flex-direction:column; height:calc(100vh - 330px); min-height:380px; border:1px solid #2c313b; border-radius:6px; overflow:hidden; }
.sg-bar { display:flex; gap:6px; align-items:center; padding:5px 8px; border-bottom:1px solid #2c313b; background:#1f232b; flex-wrap:wrap; }
.sg-bar .sp { flex:1; }
.sg-main { flex:1; display:flex; min-height:0; }
.sg-canvas { position:relative; flex:1; overflow:hidden; background:#15181e; background-image:radial-gradient(#2a2f39 1px, transparent 1px); background-size:22px 22px; cursor:grab; outline:none; }
.sg-canvas.panning { cursor:grabbing; }
.sg-world { position:absolute; left:0; top:0; transform-origin:0 0; }
.sg-edges { position:absolute; left:0; top:0; overflow:visible; pointer-events:none; }
.sg-edges path { fill:none; stroke:#6c7586; stroke-width:1.6; }
.sg-edges path.sel { stroke:#5aa2ff; stroke-width:2.2; }
.sg-edges path.broken { stroke:#ff6b6b; stroke-dasharray:5 4; }
.sg-edges path.drag { stroke:#5aa2ff; stroke-dasharray:6 4; }
.sg-edges text { fill:#8b93a3; font-size:11px; }
.sg-node { position:absolute; width:${W}px; background:#1f232b; border:1px solid #343a46; border-radius:8px; color:#d9dde5; font-size:12px; cursor:default; user-select:none; }
.sg-node.sel { border-color:#5aa2ff; box-shadow:0 0 0 2px #5aa2ff55; }
.sg-node.now { box-shadow:0 0 0 3px #ffd25a; }
.sg-node.seen { border-color:#ffd25a88; }
.sg-node.far { opacity:.55; }
.sg-node.warn { border-color:#ffb347; }
.sg-node .h { display:flex; align-items:center; gap:6px; padding:5px 9px 3px; color:#8b93a3; font-size:11px; cursor:move; }
.sg-node .h b { color:#d9dde5; font-weight:600; font-size:12px; }
.sg-node .h .dot { width:9px; height:9px; border-radius:50%; flex:none; }
.sg-node .h .tag { margin-left:auto; font-size:10px; color:#ffb347; }
.sg-node .t { padding:0 9px 8px; line-height:1.35; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; white-space:pre-wrap; }
.sg-node .t.empty { color:#6c7586; font-style:italic; }
.sg-node .row { position:relative; display:flex; align-items:center; gap:6px; padding:4px 22px 4px 9px; border-top:1px solid #2c313b; }
.sg-node .row span { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sg-node.line { border-left:4px solid var(--who, #5aa2ff); }
.sg-node.choice { border-left:4px solid #5dcaa5; }
.sg-node.cond { border-left:4px solid #ef9f27; }
.sg-node.act { border-left:4px solid #f0997b; }
.sg-node.end, .sg-node.start { width:auto; min-width:70px; border-radius:16px; text-align:center; padding:5px 14px; color:#8b93a3; }
.sg-node.start { border-color:#5aa2ff88; color:#9fc3ff; }
.sg-port { position:absolute; width:12px; height:12px; border-radius:50%; background:#2c313b; border:2px solid #6c7586; cursor:crosshair; z-index:1; }
.sg-port:hover, .sg-port.free { border-color:#5aa2ff; }
.sg-port.free::after { content:'+'; position:absolute; left:50%; top:50%; transform:translate(-50%,-56%); font-size:11px; line-height:1; color:#5aa2ff; }
.sg-node > .sg-port { left:50%; bottom:-7px; margin-left:-7px; }
.sg-node .row > .sg-port { right:4px; top:50%; margin-top:-7px; }
.sg-menu { position:absolute; z-index:5; background:#232833; border:1px solid #3a4150; border-radius:6px; padding:4px; box-shadow:0 8px 22px #000a; min-width:180px; max-height:calc(100% - 8px); overflow:auto; }
.sg-menu button { display:block; width:100%; text-align:left; padding:4px 8px; border:0; background:transparent; }
.sg-menu button:hover { background:#2d3442; }
.sg-menu hr { border:0; border-top:1px solid #343a46; margin:3px 0; }
.sg-hint { position:absolute; left:10px; bottom:8px; color:#6c7586; font-size:11px; pointer-events:none; }
.sg-side { width:340px; flex:none; border-left:1px solid #2c313b; overflow:auto; padding:8px 10px; background:#1a1d24; }
/* a narrow panel: the side goes under the graph */
.sg { container-type:inline-size; }
@container (max-width:720px) { .sg-main { flex-direction:column; } .sg-canvas { min-height:300px; } .sg-side { width:auto; max-height:46%; border-left:0; border-top:1px solid #2c313b; } }
.sg-side h5 { margin:2px 0 6px; font-size:12px; color:#8b93a3; text-transform:uppercase; letter-spacing:.05em; }
.sg-play .say { margin:6px 0; } .sg-play .say b { display:block; color:#ffb347; font-size:11px; letter-spacing:.04em; text-transform:uppercase; }
.sg-play .fx { color:#8b93a3; font-style:italic; font-size:11px; margin:3px 0; }
.sg-play .fin { color:#8b93a3; border-top:1px solid #2c313b; padding-top:6px; margin-top:8px; }
.sg-play .ans { display:block; width:100%; text-align:left; margin:4px 0; }
.sg-play .ans[disabled] { opacity:.45; }
.sg-play .state label { display:flex; align-items:center; gap:6px; margin:3px 0; }
.sg-play .state input[type=number] { width:80px; }
`;
let styled = false;

// dialogue: {steps, owner...}; layout: {node id: [x, y]} (kept in the story, not compiled); speaker(step) ->
// {name, colour}; summary(step) -> the text of a node that is not a line; inspect(el, index): the List view's fields of
// step `index` in el; changed(): the story was edited; newStep(type, who): a step of that kind
export function createGraphView({ host, dialogue: d, layout, speaker, summary, inspect, changed, newStep, menu }) {
  if (!styled) { const s = document.createElement('style'); s.textContent = STYLE; document.head.appendChild(s); styled = true; }
  host.innerHTML = `<div class="sg"><div class="sg-bar">
      <button data-add="line" title="A line after the selected step (Enter)">+ Line</button>
      <button data-add="choice" title="JC's answers after the selected step">+ JC's answers</button>
      <button data-add="if" title="A condition after the selected step: Yes and No go on their own ways">+ Condition</button>
      <button data-add="more" title="Every other kind of step">+ More…</button>
      <span class="sp"></span>
      <button data-do="undo" title="Undo the last change of the graph (Ctrl+Z)">Undo</button>
      <button data-do="tidy" title="Lay every node out again, from the start down">Tidy</button>
      <button data-do="fit" title="See the whole dialogue (F)">Fit</button>
      <button data-do="play" class="primary" title="Play the dialogue here, as the game will">▶ Play-test</button></div>
    <div class="sg-main"><div class="sg-canvas" tabindex="0"><div class="sg-world"><svg class="sg-edges" width="1" height="1"></svg></div>
      <div class="sg-hint">Drag a dot to connect or to add the next step · double-click to add · wheel to zoom · Delete removes</div></div>
      <div class="sg-side"></div></div></div>`;
  const canvas = host.querySelector('.sg-canvas'), world = host.querySelector('.sg-world'), svg = host.querySelector('.sg-edges');
  const side = host.querySelector('.sg-side');
  let view = { x: 40, y: 30, k: 1 }, selected = null, graph = null, playing = null, undo = [], fitted = false;
  let drag = null, menuEl = null;
  const steps = () => (d.steps = d.steps || []);
  const nodeEl = (id) => world.querySelector(`.sg-node[data-id="${CSS.escape(id)}"]`);

  // ---------------------------------------------------------------- drawing
  function kindOf(s) {
    if (s.type === 'line') return 'line';
    if (s.type === 'choice') return 'choice';
    if (['if', 'checkitem', 'checkvalue', 'random'].includes(s.type)) return 'cond';
    if (s.type === 'end' || s.type === 'goto') return 'end';      // a jump to another conversation ends this one
    return 'act';
  }
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function nodeHtml(n) {
    const s = n.step, kind = kindOf(s), far = !graph.reachable.has(n.id);
    const port = (o) => `<i class="sg-port${o.to === null ? ' free' : ''}" data-port="${o.port}" title="${o.to === null ? 'Drag to connect, or click to add the next step' : 'Drag to connect elsewhere'}"></i>`;
    const warn = problemOf(n);
    let body;
    if (kind === 'end') return `<div class="sg-node end${far ? ' far' : ''}" data-id="${esc(n.id)}">${s.type === 'goto' ? 'Continues in ' + esc(s.conversation) : 'End'}</div>`;
    if (kind === 'line') {
      const who = speaker(s);
      body = `<div class="h"><i class="dot" style="background:${who.colour}"></i><b>${esc(who.name)}</b>${s.voice ? '<span title="Has a recorded voice">🎙</span>' : ''}${warn ? `<span class="tag">${esc(warn)}</span>` : ''}</div>
        <div class="t${s.text ? '' : ' empty'}">${esc(s.text || 'Double-click to write the line')}</div>${n.outs.map(port).join('')}`;
      return `<div class="sg-node line${far ? ' far' : ''}${warn ? ' warn' : ''}" data-id="${esc(n.id)}" style="--who:${who.colour}">${body}</div>`;
    }
    const title = { choice: "JC's answers", cond: 'Condition' }[kind] || summary.title(s);
    body = `<div class="h"><b>${esc(title)}</b>${warn ? `<span class="tag">${esc(warn)}</span>` : ''}</div>`;
    if (kind !== 'choice') body += `<div class="t">${esc(summary.text(s))}</div>`;
    // one way on: a dot under the node; several (answers, Yes and No): a row each, its dot at its end
    if (kind === 'choice' || n.outs.length > 1) body += n.outs.map((o) => `<div class="row"><span>${esc(o.text || '…')}</span>${port(o)}</div>`).join('');
    else body += n.outs.map(port).join('');
    return `<div class="sg-node ${kind}${far ? ' far' : ''}${warn ? ' warn' : ''}" data-id="${esc(n.id)}">${body}</div>`;
  }
  function problemOf(n) {
    const s = n.step;
    if (s.type === 'line' && !String(s.text || '').trim()) return 'empty';
    if (s.type === 'choice' && (s.options || []).some((o) => !String(o.text || '').trim())) return 'empty answer';
    if (n.outs.some((o) => o.broken)) return 'broken';
    if (s.type === 'choice' && n.outs.some((o) => o.to === null)) return 'answer goes nowhere';
    return '';
  }
  // where a node is: its own place, else under the step that leads to it, else laid out from the start
  function place() {
    const at = layout, auto = autoLayout();
    for (const n of graph.nodes) if (!at[n.id]) at[n.id] = auto[n.id];
  }
  function autoLayout() {
    const byId = new Map(graph.nodes.map((n) => [n.id, n])), depth = new Map(), rows = [];
    const queue = [[graph.start, 0]];
    while (queue.length) {
      const [id, k] = queue.shift();
      if (!byId.has(id) || depth.has(id)) continue;
      depth.set(id, k);
      (rows[k] = rows[k] || []).push(id);
      for (const o of byId.get(id).outs) queue.push([o.to, k + 1]);
    }
    const far = graph.nodes.filter((n) => !depth.has(n.id)).map((n) => n.id);
    const height = (id) => { const s = byId.get(id).step; return s.type === 'choice' ? 40 + 26 * (s.options || []).length : s.type === 'end' ? 34 : 86; };
    const out = {};
    let y = 70, widest = 0;
    rows.forEach((row) => {
      row.forEach((id, i) => { out[id] = [(i - (row.length - 1) / 2) * (W + GAP_X), y]; });
      widest = Math.max(widest, row.length);
      y += Math.max(...row.map(height)) + GAP_Y;
    });
    far.forEach((id, i) => { out[id] = [(widest / 2 + 0.8) * (W + GAP_X), 70 + i * 110]; });
    return out;
  }
  function draw() {
    graph = graphOf(steps());
    place();
    const startAt = graph.start && layout[graph.start] ? layout[graph.start] : [0, 70];
    world.querySelectorAll('.sg-node').forEach((e) => e.remove());
    world.insertAdjacentHTML('beforeend', `<div class="sg-node start" data-id="@start" style="left:${startAt[0] + W / 2 - 40}px;top:${startAt[1] - 64}px">Start<i class="sg-port${graph.start === END ? ' free' : ''}" data-port="start"></i></div>`
      + graph.nodes.map((n) => nodeHtml(n).replace('class="sg-node', `style="left:${layout[n.id][0]}px;top:${layout[n.id][1]}px" class="sg-node`)).join(''));
    for (const id of [selected, playing?.now].filter(Boolean)) nodeEl(id)?.classList.add(id === selected ? 'sel' : 'now');
    for (const id of playing?.seen || []) nodeEl(id)?.classList.add('seen');
    edges();
    if (!fitted) { fit(); fitted = true; }
  }
  // the arrows: from a dot to the top of the node it goes to (to the End under it when the dialogue ends there)
  function edges(extra = '') {
    const at = (el) => { let x = 0, y = 0; for (let e = el; e && e !== world; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; } return [x, y]; };
    let paths = '';
    const curve = ([x1, y1], [x2, y2]) => `M${x1},${y1} C${x1},${y1 + Math.max(40, (y2 - y1) / 2)} ${x2},${y2 - Math.max(40, (y2 - y1) / 2)} ${x2},${y2}`;
    const lines = [[ '@start', 'start', graph.start ]];
    for (const n of graph.nodes) for (const o of n.outs) lines.push([n.id, o.port, o.to, o.broken]);
    for (const [from, port, to, broken] of lines) {
      const src = nodeEl(from)?.querySelector(`.sg-port[data-port="${port}"]`);
      if (!src || to === null) continue;
      const [px, py] = at(src), a = [px + 7, py + 7];
      if (broken) { paths += `<path class="broken" d="M${a[0]},${a[1]} l0,30"></path>`; continue; }
      if (to === END) { paths += `<path d="M${a[0]},${a[1]} l0,22"></path><text x="${a[0] - 10}" y="${a[1] + 36}">end</text>`; continue; }
      const dst = nodeEl(to);
      if (!dst) continue;
      const [dx, dy] = at(dst);
      paths += `<path class="${from === selected || to === selected ? 'sel' : ''}" d="${curve(a, [dx + dst.offsetWidth / 2, dy])}" marker-end="url(#sg-arrow)"></path>`;
    }
    svg.innerHTML = `<defs><marker id="sg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#6c7586"></path></marker></defs>${paths}${extra}`;
  }
  function setView() { world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`; }
  function fit() {
    const pts = graph.nodes.map((n) => layout[n.id]);
    if (!pts.length) { view = { x: canvas.clientWidth / 2 - W / 2, y: 40, k: 1 }; return setView(); }
    const x0 = Math.min(...pts.map((p) => p[0])) - 20, x1 = Math.max(...pts.map((p) => p[0])) + W + 20;
    const y0 = Math.min(...pts.map((p) => p[1])) - 80, y1 = Math.max(...pts.map((p) => p[1])) + 160;
    const k = Math.max(0.3, Math.min(1.1, canvas.clientWidth / (x1 - x0), canvas.clientHeight / (y1 - y0)));
    view = { k, x: (canvas.clientWidth - (x1 - x0) * k) / 2 - x0 * k, y: 10 - y0 * k };
    setView();
  }
  const toWorld = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left - view.x) / view.k, (e.clientY - r.top - view.y) / view.k]; };

  // ---------------------------------------------------------------- editing
  function edit(fn) {                            // a change of the graph: undoable, saved with the story
    undo.push(JSON.stringify({ steps: steps(), layout }));
    if (undo.length > UNDO) undo.shift();
    const result = fn(steps());
    changed();
    draw();
    return result;
  }
  function undoLast() {
    const last = undo.pop();
    if (!last) return;
    const was = JSON.parse(last);
    d.steps = was.steps;
    for (const k of Object.keys(layout)) delete layout[k];
    Object.assign(layout, was.layout);
    if (selected && !d.steps.some((s) => s.id === selected)) selected = null;
    changed(); draw(); showSide();
  }
  function add(type, from = selected, port, at) {
    const step = newStep(type, followingSpeaker(from));
    let id;
    if (from) {
      const n = graph.nodes.find((x) => x.id === from);
      port = port ?? (n.outs.find((o) => o.port === 'next') || n.outs.find((o) => o.to === null) || n.outs[0])?.port;
      if (port === undefined) { menuAt(null, 'This step ends the dialogue: add the new one from another step, or double-click the empty space.'); return; }
      id = edit((s) => (port === 'start' ? addFirst(s, step) : insertAt(s, from, port, step)));
      const p = layout[from];
      layout[id] = at || [p[0] + (typeof port === 'number' ? (port - 0.5) * (W + GAP_X) / 2 : 0), p[1] + 120];
      graph = graphOf(steps());
      makeRoom(id);
    } else {
      id = edit((s) => addApart(s, step));
      layout[id] = at || [0, 70];
    }
    select(id);
    draw();
    focusText();
  }
  function addFirst(s, step) { s.unshift(step); return insertedId(s, step); }
  function addApart(s, step) {                    // a step on its own: after an End, nothing falls into it
    if (!s.length || s[s.length - 1].type !== 'end') s.push({ type: 'end' });
    s.push(step);
    return insertedId(s, step);
  }
  function insertedId(s, step) { ensureIds(s); return step.id; }
  function followingSpeaker(from) {               // a line after a line: the other one speaks
    const s = from && steps().find((x) => x.id === from);
    return s && s.type === 'line' ? (s.who === 'jc' ? 'npc' : 'jc') : 'npc';
  }
  function focusText() { requestAnimationFrame(() => side.querySelector('textarea, input[type=text]')?.focus()); }

  // a node put at `at` between others: the step it now leads to, if in the way, goes down under it
  function makeRoom(id) {
    const n = graph.nodes.find((x) => x.id === id), next = n && n.outs.find((o) => o.port === 'next')?.to;
    const p = layout[id], q = next && layout[next];
    if (!p || !q || Math.abs(q[0] - p[0]) >= W || q[1] >= p[1] + 110 || q[1] < p[1] - 40) return;
    layout[next] = [q[0], p[1] + 120];
    makeRoom(next);
  }

  // ---------------------------------------------------------------- the side: the selected node, or the play-test
  function select(id) {
    selected = id;
    if (!playing) showSide();
    world.querySelectorAll('.sg-node.sel').forEach((e) => e.classList.remove('sel'));
    if (id) nodeEl(id)?.classList.add('sel');
    edges();
  }
  function showSide() {
    if (playing) return showPlay();
    const i = steps().findIndex((s) => s.id === selected);
    if (i < 0) {
      side.innerHTML = `<h5>Dialogue</h5><div class="tip">Click a step to edit it here. Drag the dot under a step to add the next one, or to connect it to another step. A step nobody reaches is shown faded.</div>
        <div class="tip">${graph.nodes.length} steps · ${graph.nodes.filter((n) => !graph.reachable.has(n.id)).length} not reached</div>`;
      return;
    }
    side.innerHTML = '<div class="sg-inspect"></div><div class="f" style="margin-top:8px"><button data-del class="bad" title="Delete this step (Delete): what led to it goes on to where it went">Delete step</button></div>';
    inspect(side.querySelector('.sg-inspect'), i);
    side.querySelector('[data-del]').onclick = () => removeSelected();
  }
  function removeSelected() {
    if (!selected) return;
    const id = selected;
    selected = null;
    edit((s) => remove(s, id));
    delete layout[id];
    showSide();
  }
  // fields edited at the side: the node shows them at once
  let redraw = 0;
  side.addEventListener('input', () => { cancelAnimationFrame(redraw); redraw = requestAnimationFrame(draw); });
  side.addEventListener('change', () => { cancelAnimationFrame(redraw); redraw = requestAnimationFrame(draw); });
  side.addEventListener('click', (e) => { if (e.target.closest('button') && !playing) { cancelAnimationFrame(redraw); redraw = requestAnimationFrame(draw); } });

  // the play-test: the run as the game plays it, the state it starts with (changed: it starts again)
  function startPlay() {
    const used = usedState();
    const state = playing?.initial || { flags: Object.fromEntries(used.flags.map((f) => [f, false])), credits: 500, health: 100, skillpoints: 0, items: [] };
    playing = { initial: state, run: createPlay(steps(), state), log: [], seen: new Set(), now: null, used };
    advance();
  }
  function advance() {
    for (let guard = 0; guard < 400; guard++) {
      const e = playing.run.next();
      if (e.id) { playing.now = e.id; playing.seen.add(e.id); }
      if (e.type === 'choice' || e.type === 'end') { playing.wait = e; break; }
      playing.log.push(e);
    }
    draw(); showPlay();
  }
  function usedState() {
    const flags = new Set(), items = new Set();
    for (const s of steps()) {
      for (const c of [...conditionsOf(s), ...(s.type === 'choice' ? (s.options || []).flatMap(answerConditions) : [])]) if (c.flag) flags.add(c.flag);
      if (s.type === 'flag') for (const c of s.requires?.length ? s.requires : [s]) if (c.flag) flags.add(c.flag);
      if (s.type === 'checkitem' && s.item) items.add(s.item);
    }
    for (const c of d.requires || []) if (c.flag) flags.add(c.flag);
    return { flags: [...flags].sort(), items: [...items].sort() };
  }
  function showPlay() {
    const p = playing, st = p.run.state, w = p.wait;
    const say = (e) => e.type === 'line' ? `<div class="say"><b>${esc(speaker({ type: 'line', who: e.who }).name)}</b>${esc(e.text)}</div>` : `<div class="fx">${esc(e.text)}</div>`;
    let html = `<h5>Play-test</h5><div class="sg-play">${p.log.map(say).join('')}`;
    if (w?.type === 'choice' && !w.options.length) html += "<div class=\"fin\">JC's answers here have no text yet: the game shows none.</div>";
    if (w?.type === 'choice') html += w.options.map((o) => `<button class="ans" data-ans="${o.k}" ${o.shown ? '' : 'disabled title="Its conditions do not match now: the game does not show it"'}>${o.k + 1}. ${esc(o.text)}</button>`).join('');
    if (w?.type === 'end') html += `<div class="fin">${esc(w.why)}</div>`;
    html += `<div class="f"><button data-play="again">Start again</button><button data-play="stop">Close</button></div>
      <h5 style="margin-top:12px">State ${p.log.length || w ? '(now)' : ''}</h5><div class="state">
      ${p.used.flags.map((f) => `<label><input type="checkbox" data-flag="${esc(f)}" ${st.flags[f] ? 'checked' : ''}> ${esc(f)}</label>`).join('') || '<div class="tip">This dialogue reads no flags.</div>'}
      <label>Credits <input type="number" data-val="credits" value="${st.credits}"></label>
      <label>Health <input type="number" data-val="health" value="${st.health}"></label>
      <label>Skill points <input type="number" data-val="skillpoints" value="${st.skillpoints}"></label>
      ${p.used.items.map((it) => `<label><input type="checkbox" data-item="${esc(it)}" ${st.items.has(it) ? 'checked' : ''}> carries ${esc(it)}</label>`).join('')}
      <div class="tip">Changing the state starts the dialogue again with it.</div></div></div>`;
    side.innerHTML = html;
    side.querySelectorAll('[data-ans]').forEach((b) => b.onclick = () => { p.log.push({ type: 'line', who: 'jc', id: w.id, text: w.options.find((o) => o.k === +b.dataset.ans).text }); p.run.choose(+b.dataset.ans); p.wait = null; advance(); });
    side.querySelector('[data-play="again"]').onclick = () => startPlay();
    side.querySelector('[data-play="stop"]').onclick = () => { playing = null; draw(); showSide(); };
    const restartWith = (fn) => { fn(p.initial); startPlay(); };
    side.querySelectorAll('[data-flag]').forEach((c) => c.onchange = () => restartWith((s) => { s.flags = { ...s.flags, [c.dataset.flag]: c.checked }; }));
    side.querySelectorAll('[data-val]').forEach((c) => c.onchange = () => restartWith((s) => { s[c.dataset.val] = +c.value || 0; }));
    side.querySelectorAll('[data-item]').forEach((c) => c.onchange = () => restartWith((s) => { s.items = c.checked ? [...new Set([...s.items, c.dataset.item])] : s.items.filter((x) => x !== c.dataset.item); }));
  }

  // ---------------------------------------------------------------- the quick menu: what to add
  function menuAt(e, note, onPick) {
    menuEl?.remove();
    menuEl = document.createElement('div');
    menuEl.className = 'sg-menu';
    const r = canvas.getBoundingClientRect();
    menuEl.style.left = (e ? e.clientX - r.left : 20) + 'px';
    menuEl.style.top = (e ? e.clientY - r.top : 20) + 'px';
    menuEl.innerHTML = note ? `<div class="tip" style="max-width:240px;margin:4px 6px">${esc(note)}</div>`
      : menu.map((m) => (m === '-' ? '<hr>' : `<button data-pick="${m[0]}" data-who="${m[2] || ''}">${esc(m[1])}</button>`)).join('');
    canvas.appendChild(menuEl);
    const room = [canvas.clientWidth - menuEl.offsetWidth - 6, canvas.clientHeight - menuEl.offsetHeight - 6];
    menuEl.style.left = Math.max(4, Math.min(room[0], menuEl.offsetLeft)) + 'px';
    menuEl.style.top = Math.max(4, Math.min(room[1], menuEl.offsetTop)) + 'px';
    menuEl.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { const pick = [b.dataset.pick, b.dataset.who]; closeMenu(); onPick(pick); });
    if (note) setTimeout(closeMenu, 2600);
  }
  function closeMenu() { menuEl?.remove(); menuEl = null; }

  // ---------------------------------------------------------------- the mouse and the keys
  canvas.addEventListener('mousedown', (e) => {
    if (e.target.closest('.sg-menu')) return;
    closeMenu();
    canvas.focus({ preventScroll: true });
    const port = e.target.closest('.sg-port'), node = e.target.closest('.sg-node');
    if (port && e.button === 0) {
      const from = node.dataset.id, which = port.dataset.port;
      drag = { kind: 'link', from, port: which === 'start' || which === 'next' || which === 'jump' ? which : +which, x: e.clientX, y: e.clientY };
    } else if (node && e.button === 0 && node.dataset.id !== '@start') {
      select(node.dataset.id);
      const p = layout[node.dataset.id];
      drag = { kind: 'node', id: node.dataset.id, x: e.clientX, y: e.clientY, p: [...p], moved: false };
    } else {
      if (e.button === 0 && !node) select(null);
      drag = { kind: 'pan', x: e.clientX, y: e.clientY, v: { ...view } };
      canvas.classList.add('panning');
    }
    e.preventDefault();
  });
  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.kind === 'pan') { view.x = drag.v.x + dx; view.y = drag.v.y + dy; setView(); }
    else if (drag.kind === 'node') {
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      layout[drag.id] = [drag.p[0] + dx / view.k, drag.p[1] + dy / view.k];
      const el = nodeEl(drag.id);
      el.style.left = layout[drag.id][0] + 'px'; el.style.top = layout[drag.id][1] + 'px';
      edges();
    } else if (drag.kind === 'link') {
      const src = nodeEl(drag.from).querySelector(`.sg-port[data-port="${drag.port}"]`).getBoundingClientRect(), r = canvas.getBoundingClientRect();
      const a = [(src.left + 7 - r.left - view.x) / view.k, (src.top + 7 - r.top - view.y) / view.k], b = toWorld(e);
      edges(`<path class="drag" d="M${a[0]},${a[1]} L${b[0]},${b[1]}"></path>`);
    }
  };
  const onUp = (e) => {
    const was = drag;
    drag = null;
    canvas.classList.remove('panning');
    if (!was) return;
    if (was.kind === 'node' && was.moved) changed();
    if (was.kind !== 'link') return;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.sg-node');
    const far = Math.abs(e.clientX - was.x) + Math.abs(e.clientY - was.y) > 6;
    if (target && target.dataset.id !== '@start' && target.dataset.id !== was.from) {
      const to = target.dataset.id;
      edit((s) => (was.port === 'start' ? connectStart(s, to) : connect(s, was.from, was.port, to)));
      return;
    }
    if (!canvas.contains(e.target) && !target) { edges(); return; }
    // dropped on empty space (or a click on the dot): the step to add there
    const at = toWorld(e);
    menuAt(e, null, ([type, who]) => {
      if (type === 'end' && was.port !== 'start') { edit((s) => connect(s, was.from, was.port, END)); return; }
      const step = newStep(type, who || followingSpeaker(was.from));
      let id;
      if (was.port === 'start') id = edit((s) => addFirst(s, step)); else id = edit((s) => insertAt(s, was.from, was.port, step));
      layout[id] = far ? [at[0] - W / 2, at[1]] : [layout[was.from]?.[0] ?? 0, (layout[was.from]?.[1] ?? 0) + 120];
      graph = graphOf(steps());
      makeRoom(id);
      select(id); draw(); focusText();
    });
    edges();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.max(0.25, Math.min(2, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    view.x = mx - (mx - view.x) * k / view.k; view.y = my - (my - view.y) * k / view.k; view.k = k;
    setView();
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const node = e.target.closest('.sg-node');
    if (node && node.dataset.id !== '@start') { select(node.dataset.id); focusText(); return; }
    if (node) return;
    const at = toWorld(e);
    menuAt(e, null, ([type, who]) => { const step = newStep(type, who || 'npc'); const id = edit((s) => addApart(s, step)); layout[id] = [at[0] - W / 2, at[1]]; select(id); draw(); focusText(); });
  });
  canvas.addEventListener('keydown', (e) => {
    if (e.target !== canvas) return;
    e.stopPropagation();                         // the keys of the graph are not the 3D view's (Delete, Ctrl+Z...)
    const k = e.key.toLowerCase();
    if ((k === 'delete' || k === 'backspace') && selected) { e.preventDefault(); removeSelected(); }
    else if (k === 'enter' && selected) { e.preventDefault(); add('line'); }
    else if (k === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); undoLast(); }
    else if (k === 'f') { e.preventDefault(); fit(); }
    else if (k === 'escape') { closeMenu(); select(null); }
  });
  host.querySelectorAll('[data-add]').forEach((b) => b.onclick = (e) => {
    if (b.dataset.add !== 'more') return add(b.dataset.add);
    menuAt(e, null, ([type, who]) => { if (type === 'end' && selected) { const n = graph.nodes.find((x) => x.id === selected); const o = n.outs.find((x) => x.port === 'next'); if (o) return edit((s) => connect(s, selected, 'next', END)); } add(type); });
  });
  host.querySelector('[data-do="undo"]').onclick = () => undoLast();
  host.querySelector('[data-do="tidy"]').onclick = () => { undo.push(JSON.stringify({ steps: steps(), layout })); for (const k of Object.keys(layout)) delete layout[k]; changed(); draw(); fit(); };
  host.querySelector('[data-do="fit"]').onclick = () => fit();
  host.querySelector('[data-do="play"]').onclick = () => startPlay();

  draw();
  showSide();
  return {
    refresh: () => draw(),
    destroy() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); closeMenu(); },
  };
}
