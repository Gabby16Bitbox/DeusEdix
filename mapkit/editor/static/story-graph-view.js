// The Story's Graph view of a dialogue, as articy:draft shows a flow, on the editor's node canvas (graph-canvas.js, the
// Logic window's): each step a node (a line in the colour of who speaks with its face and text, JC's answers and a
// condition's Yes / No as rows with an arrow each), the arrows where it goes on, left to right. The canvas's grammar:
// drag empty space to select (the middle button, Space or Alt to move the view), the wheel zooms, F frames the
// selection, Home fits. Drag a dot to connect it or, on empty space, to add the next step there (a click on a dot adds
// it beside); double-click the empty space to add a step on its own. A line or an answer is written in the node itself
// (double-click it, or F2: Enter goes on to the next line, Tab changes who says it); Enter on a step adds the next line;
// everything else of the selected node is at the side, with the List view's own fields. Play-test runs the dialogue
// there as the game would (story-sim.js), lighting the node it is at. The nodes: story-graph-nodes.js; the model:
// story-graph.js.
import { END, graphOf, ensureIds, connect, connectStart, insertAt, remove } from './story-graph.js';
import { createPlay, answerConditions, conditionsOf } from './story-sim.js';
import { createGraphCanvas } from './graph-canvas.js';
import { nodeSize } from './graph-geometry.js';
import { START, canvasOf, portOf, rowPort } from './story-graph-nodes.js';

const GAP_X = 70;                                // between a step and the one added after it
const WRITE_ZOOM = 0.75;                         // under this a line is written at 100% (the canvas covers nodes under 50%)
const UNDO = 60;
const STYLE = `
.sg { display:flex; flex-direction:column; height:calc(100vh - 330px); min-height:380px; border:1px solid #2c313b; border-radius:6px; overflow:hidden; }
.sg-bar { display:flex; gap:6px; align-items:center; padding:5px 8px; border-bottom:1px solid #2c313b; background:#1f232b; flex-wrap:wrap; }
.sg-bar .sp { flex:1; }
.sg-main { flex:1; display:flex; min-height:0; }
.sg-canvas { position:relative; flex:1; min-width:0; min-height:0; }
.sg-canvas > .gc { position:absolute; inset:0; }
.sg-menu { position:absolute; z-index:5; background:#232833; border:1px solid #3a4150; border-radius:6px; padding:4px; box-shadow:0 8px 22px #000a; min-width:180px; max-height:calc(100% - 8px); overflow:auto; }
.sg-menu button { display:block; width:100%; text-align:left; padding:4px 8px; border:0; background:transparent; }
.sg-menu button:hover { background:#2d3442; }
.sg-menu hr { border:0; border-top:1px solid #343a46; margin:3px 0; }
.sg-hint { position:absolute; left:10px; bottom:8px; right:190px; color:#6c7586; font-size:11px; pointer-events:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sg-side { width:340px; flex:none; border-left:1px solid #2c313b; overflow:auto; padding:8px 10px; background:#1a1d24; }
/* a narrow panel: the side goes under the graph */
.sg { container-type:inline-size; }
@container (max-width:720px) { .sg-main { flex-direction:column; } .sg-canvas { min-height:300px; } .sg-side { width:auto; max-height:46%; border-left:0; border-top:1px solid #2c313b; } }
.sg-side h5 { margin:2px 0 6px; font-size:12px; color:#8b93a3; text-transform:uppercase; letter-spacing:.05em; }
.sg-play .face { width:40px; height:40px; flex:none; border-radius:5px; background:#11141a center/cover no-repeat; }
.sg-play .say { display:flex; gap:8px; margin:6px 0; }
.sg-play .say b { display:block; color:#ffb347; font-size:11px; letter-spacing:.04em; text-transform:uppercase; }
.sg-play .fx { color:#8b93a3; font-style:italic; font-size:11px; margin:3px 0; }
.sg-play .fin { color:#8b93a3; border-top:1px solid #2c313b; padding-top:6px; margin-top:8px; }
.sg-play .ans { display:block; width:100%; text-align:left; margin:4px 0; }
.sg-play .ans[disabled] { opacity:.45; }
.sg-play .state label { display:flex; align-items:center; gap:6px; margin:3px 0; }
.sg-play .state input[type=number] { width:80px; }
.sg-canvas .gc-node.k-start, .sg-canvas .gc-node.k-end { border-radius:14px; }
.sg-canvas .gc-node.k-start .gc-t, .sg-canvas .gc-node.k-end .gc-t { font-weight:500; color:var(--dim); }
`;
let styled = false;

// dialogue: {steps, owner...}; layout: {node id: [x, y]}, the places moved by hand (kept in the story, not compiled;
// the others are laid out by the canvas); speaker(step) -> {name, colour}; speakers(): [{who, name}] who can say a
// line; face(step) -> a Promise of the picture of who says it (null: none); summary {title(step), text(step)} of a node
// that is not a line; inspect(el, index): the List view's fields of step `index` in el; changed(): the story was
// edited; newStep(type, who): a step of that kind; menu: [[type, label, who?] | '-'] what can be added; undo(), redo():
// the editor's own history, which the Story's changes are steps of (P5; none: the graph's own Undo, its changes only);
// start: {view, selected, focused} as an earlier view of the same dialogue left them (getView): its zoom and
// selection kept, and the keys' focus (a step back with Ctrl+Z draws the panel again: the next Ctrl+Z still works)
export function createGraphView({ host, dialogue: d, layout, speaker, speakers, face, summary, inspect, changed, newStep, menu,
  undo: undoHistory = null, redo: redoHistory = null, start = null }) {
  if (!styled) { const s = document.createElement('style'); s.textContent = STYLE; document.head.appendChild(s); styled = true; }
  host.innerHTML = `<div class="sg"><div class="sg-bar">
      <button data-add="line" title="A line after the selected step (Enter)">+ Line</button>
      <button data-add="choice" title="JC's answers after the selected step">+ JC's answers</button>
      <button data-add="if" title="A condition after the selected step: Yes and No go on their own ways">+ Condition</button>
      <button data-add="more" title="Every other kind of step">+ More…</button>
      <span class="sp"></span>
      <button data-do="undo" title="${undoHistory ? 'Undo the last change (Ctrl+Z), as Edit > Undo' : 'Undo the last change of the graph'}">Undo</button>
      <button data-do="tidy" title="Lay every node out again, from the start">Tidy</button>
      <button data-do="fit" title="See the whole dialogue (Home)">Fit</button>
      <button data-do="play" class="primary" title="Play the dialogue here, as the game will (T)">▶ Play-test</button></div>
    <div class="sg-main"><div class="sg-canvas">
      <div class="sg-hint">Double-click a line to write it (Enter: next line, Tab: who speaks) · drag a dot to connect or add · drag the empty space to select, the middle button to move</div></div>
      <div class="sg-side"></div></div></div>`;
  const canvasHost = host.querySelector('.sg-canvas'), side = host.querySelector('.sg-side');
  let selected = null, many = [], graph = null, playing = null, undo = [], drawn = new Map();
  let menuEl = null, writing = null;              // writing: the line or answer being written in its node
  const steps = () => (d.steps = d.steps || []);
  if (start?.selected && steps().some((s) => s.id === start.selected)) selected = start.selected;
  const stepOf = (id) => steps().find((s) => s.id === id);

  const canvas = createGraphCanvas(canvasHost, {
    label: `Dialogue ${d.title || d.id}`,
    thumb: (who) => face({ type: 'line', who }),
    onSelect: (sel) => {
      many = sel.nodes.filter((id) => id !== START);
      selected = many.length === 1 ? many[0] : null;
      if (!playing) showSide();
    },
    onMove: (moves) => {
      for (const [id, p] of Object.entries(moves.nodes || {})) layout[id] = [Math.round(p[0]), Math.round(p[1])];
      changed();
    },
    onConnect: (from, to) => {
      if (to.node === START) return 'The Start has no way in';
      if (from.node === START) edit((s) => connectStart(s, to.node));
      else edit((s) => connect(s, from.node, portOf(from.pin), to.node));
      return true;
    },
    onPinDrop: (from, at) => { if (from.side === 'out') addFromPin(from, at); },
    onAdd: (at) => menuAt(at.screen, null, ([type, who]) => addApart(type, who, at.world)),
    onOpen: (id, row) => open(id, row),
    onDelete: (sel) => removeSteps(sel.nodes),
    onCommand: (name) => {
      if (name === 'edit' && selected) add('line');
      else if (name === 'rename' && selected) open(selected);
      else if (name === 'try') startPlay();
    },
    onContext: (hit, at) => contextMenu(hit, at),
  });

  // ---------------------------------------------------------------- drawing
  function draw() {
    if (writing) return;                         // the node being written keeps its field
    graph = graphOf(steps());
    const g = canvasOf(graph, { at: layout, speaker, summary });
    drawn = new Map(g.nodes.map((n) => [n.id, n]));
    canvas.set(g);
    canvas.select({ nodes: many.length > 1 ? many : selected ? [selected] : [] });
    canvas.light(playing?.now ? { nodes: [playing.now] } : null);
  }
  // where a node is now (its place, or where the canvas laid it out) and its size
  const placeOf = (id) => canvas.positions()[id] || layout[id] || [0, 0];
  const sizeOf = (id) => (drawn.has(id) ? nodeSize(drawn.get(id)) : [220, 60]);
  const rightOf = (id) => { const p = placeOf(id); return [p[0] + sizeOf(id)[0] + GAP_X, p[1]]; };
  function middle() {
    const v = canvas.view(), w = canvasHost.clientWidth || 600, h = canvasHost.clientHeight || 400;
    return [(w / 2 - v.x) / v.k - 110, (h / 2 - v.y) / v.k - 30];
  }

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
    if (undoHistory) { undoHistory(); return; }
    const last = undo.pop();
    if (!last) return;
    const was = JSON.parse(last);
    d.steps = was.steps;
    for (const k of Object.keys(layout)) delete layout[k];
    Object.assign(layout, was.layout);
    if (selected && !d.steps.some((s) => s.id === selected)) selected = null;
    changed(); draw(); showSide();
  }
  // a new step after `from` (its way `port`; none: the way on of a single-way step, else its first free one), beside it
  function add(type, from = selected, port, who) {
    const step = newStep(type, who || followingSpeaker(from));
    if (!from) return placeNew(edit((s) => apart(s, step)), middle(), step);
    const n = graph.nodes.find((x) => x.id === from);
    port = port ?? (n?.outs.find((o) => o.port === 'next') || n?.outs.find((o) => o.to === null) || n?.outs[0])?.port;
    if (port === undefined) { menuAt(null, 'This step ends the dialogue: add the new one from another step, or double-click the empty space.'); return; }
    const at = rightOf(from);
    placeNew(edit((s) => insertAt(s, from, port, step)), at, step);
  }
  function addApart(type, who, at) { const step = newStep(type, who || 'npc'); placeNew(edit((s) => apart(s, step)), [at[0] - 110, at[1] - 20], step); }
  // a wire dragged out of a dot onto empty space, or a click on the dot: the menu of what to add there
  function addFromPin(from, at) {
    const port = from.node === START ? 'start' : portOf(from.pin);
    const box = placeOf(from.node), size = sizeOf(from.node);
    const near = at.world[0] < box[0] + size[0] + 30 && at.world[0] > box[0] - 10 && at.world[1] > box[1] - 10 && at.world[1] < box[1] + size[1] + 10;
    menuAt(at.screen, null, ([type, who]) => {
      if (type === 'end' && port !== 'start') { edit((s) => connect(s, from.node, port, END)); return; }
      const step = newStep(type, who || followingSpeaker(from.node));
      const id = edit((s) => (port === 'start' ? first(s, step) : insertAt(s, from.node, port, step)));
      placeNew(id, near ? rightOf(from.node) : [at.world[0], at.world[1] - 14], step);
    });
  }
  function placeNew(id, at, step) {
    layout[id] = [Math.round(at[0]), Math.round(at[1])];
    graph = graphOf(steps());
    makeRoom(id);
    selected = id; many = [id];
    draw();
    canvas.reveal([id]);                           // in sight, to be written
    showSide();
    if (step.type === 'line') write(id); else focusText();
  }
  function first(s, step) { s.unshift(step); return ensureIds(s) && step.id; }
  function apart(s, step) {                      // a step on its own: after an End, nothing falls into it
    if (!s.length || s[s.length - 1].type !== 'end') s.push({ type: 'end' });
    s.push(step);
    ensureIds(s);
    return step.id;
  }
  function followingSpeaker(from) {               // a line after a line: the other one speaks
    const s = from && stepOf(from);
    return s && s.type === 'line' ? (s.who === 'jc' ? 'npc' : 'jc') : 'npc';
  }
  function focusText() { requestAnimationFrame(() => side.querySelector('textarea, input[type=text]')?.focus()); }
  // a node put in the way of the step it now leads to: that one goes on to the right of it, and so on
  function makeRoom(id) {
    const n = graph.nodes.find((x) => x.id === id), next = n && n.outs.find((o) => o.port === 'next')?.to;
    if (!next || next === END || !drawn.has(next) && !layout[next]) return;
    const p = layout[id], q = placeOf(next), w = sizeOf(id)[0];
    if (!p || q[0] >= p[0] + w + 20 || q[0] < p[0] - 40 || Math.abs(q[1] - p[1]) > 90) return;
    layout[next] = [p[0] + w + GAP_X, q[1]];
    makeRoom(next);
  }
  function removeSteps(ids) {
    const list = (ids || []).filter((id) => id !== START && stepOf(id));
    if (!list.length) return;
    selected = null; many = [];
    edit((s) => { for (const id of list) remove(s, id); return s; });
    for (const id of list) delete layout[id];
    showSide();
  }
  // double click (or F2) on a node: a line written in it, an answer in its row; any other step's fields at the side
  function open(id, row) {
    if (id === START) return;
    const s = stepOf(id);
    if (!s) return;
    selected = id; many = [id];
    canvas.select({ nodes: [id] });
    showSide();
    const port = rowPort(row);
    if (s.type === 'line') write(id);
    else if (s.type === 'choice' && typeof port === 'number') write(id, port);
    else focusText();
  }

  // ---------------------------------------------------------------- writing in the node
  // `which`: 'text' (a line) or an answer's number. Enter: the next line (or the next answer), Shift+Enter: a new line in
  // the text, Tab: another speaker for the line, Esc or a click elsewhere: done.
  function write(id, which = 'text') {
    // zoomed out, the node is a cover with its title and the text is too small to write: at 100%, the node in the middle
    if (canvas.view().k < WRITE_ZOOM && stepOf(id)) {
      const p = placeOf(id), size = sizeOf(id), w = canvasHost.clientWidth || 600, h = canvasHost.clientHeight || 400;
      canvas.setView({ k: 1, x: Math.round(w / 2 - p[0] - size[0] / 2), y: Math.round(h / 2 - p[1] - size[1] / 2) });
    }
    const s = stepOf(id), spot = canvas.part(id, which === 'text' ? 'body' : 'way:' + which);
    if (!s || !spot || (which !== 'text' && !s.options?.[which])) return;
    const box = document.createElement('textarea');
    box.className = 'gc-field';
    box.value = (which === 'text' ? s.text : s.options[which].text) || '';
    box.placeholder = which === 'text' ? 'What they say' : 'What JC can answer';
    box.setAttribute('aria-label', box.placeholder);
    const was = [...spot.childNodes];              // put back when done: the canvas draws a node again only if its look changed
    spot.replaceChildren(box);
    writing = box;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
    const keep = () => {
      const v = box.value;
      if (which === 'text') { if (v !== (s.text || '')) { s.text = v; changed(); } }
      else if (v !== (s.options[which].text || '')) { s.options[which].text = v; changed(); }
    };
    const done = (then) => { keep(); writing = null; if (box.parentNode === spot) spot.replaceChildren(...was); draw(); showSide(); if (then) then(); else canvas.focus(); };
    // left for something else on the page: done. The window losing the focus (another program, a screenshot) is not
    // leaving it: the field has the focus again when the window has
    box.addEventListener('blur', () => { if (writing === box && document.hasFocus()) done(() => {}); });
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();                       // the graph's own keys (Delete, Enter) and the editor's are not for the text
      if (e.key === 'Escape') { e.preventDefault(); done(); }
      else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (which === 'text') return done(() => add('line', id));
        const next = which + 1;
        if (next >= s.options.length && s.options.length < 6) { s.options.push({ text: '', goto: '' }); changed(); }
        done(() => { if (next < s.options.length) write(id, next); });
      } else if (e.key === 'Tab' && which === 'text') {
        e.preventDefault();
        const list = speakers(), at = list.findIndex((x) => x.who === (s.who || 'npc'));
        s.who = list[(at + (e.shiftKey ? list.length - 1 : 1)) % list.length].who;
        changed();
        done(() => write(id));
      }
    });
  }
  // the speaker of a line, chosen from a menu
  function chooseSpeaker(screen, id) {
    const s = stepOf(id);
    menuAt(screen, null, ([who]) => { if (s.who !== who) { s.who = who; changed(); draw(); showSide(); } },
      speakers().map((x) => [x.who, x.name]));
  }
  // a right click: what can be done with that node, or what to add there
  function contextMenu(hit, at) {
    if (hit.kind === 'node' && hit.pin && hit.pin.side === 'out') return addFromPin(hit.pin, at);
    if (hit.kind !== 'node') return menuAt(at.screen, null, ([type, who]) => addApart(type, who, at.world));
    if (hit.id === START) return;
    const s = stepOf(hit.id);
    if (!s) return;
    const items = [];
    if (s.type === 'line') items.push(['write', 'Write the line'], ['who', 'Who says it…']);
    if (s.type === 'choice') items.push(['write', 'Write the first answer']);
    items.push(['next', 'Add a line after it'], '-', ['delete', 'Delete step']);
    menuAt(at.screen, null, ([what]) => {
      if (what === 'write') open(hit.id, s.type === 'choice' ? 'way:0' : undefined);
      else if (what === 'who') chooseSpeaker(at.screen, hit.id);
      else if (what === 'next') { selected = hit.id; add('line'); }
      else if (what === 'delete') removeSteps(many.includes(hit.id) ? many : [hit.id]);
    }, items);
  }

  // ---------------------------------------------------------------- the side: the selected node, or the play-test
  function showSide() {
    if (playing) return showPlay();
    if (many.length > 1) {
      side.innerHTML = `<h5>${many.length} steps</h5><div class="f"><button data-del class="bad" title="Delete these steps (Delete): what led to each goes on to where it went">Delete ${many.length} steps</button></div>`;
      side.querySelector('[data-del]').onclick = () => removeSteps(many);
      return;
    }
    const i = steps().findIndex((s) => s.id === selected);
    if (i < 0) {
      side.innerHTML = `<h5>Dialogue</h5><div class="tip">Click a step to edit it here. Drag the dot on the right of a step to add the next one, or to connect it to another step. A step nobody reaches is shown faded.</div>
        <div class="tip">${graph.nodes.length} steps · ${graph.nodes.filter((n) => !graph.reachable.has(n.id)).length} not reached</div>`;
      return;
    }
    side.innerHTML = '<div class="sg-inspect"></div><div class="f" style="margin-top:8px"><button data-del class="bad" title="Delete this step (Delete): what led to it goes on to where it went">Delete step</button></div>';
    inspect(side.querySelector('.sg-inspect'), i);
    side.querySelector('[data-del]').onclick = () => removeSteps([selected]);
  }
  // fields edited at the side: the node shows them at once
  let redraw = 0;
  const soon = () => { cancelAnimationFrame(redraw); redraw = requestAnimationFrame(draw); };
  side.addEventListener('input', soon);
  side.addEventListener('change', soon);
  side.addEventListener('click', (e) => { if (e.target.closest('button') && !playing) soon(); });

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
    draw();
    if (playing.now) canvas.reveal([playing.now]);
    showPlay();
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
  const faces = new Map();                       // who -> the picture of their face in the play-test (null: none)
  function faceUrl(who) {
    if (!faces.has(who)) { faces.set(who, null); face({ type: 'line', who }).then((url) => { if (url) { faces.set(who, url); if (playing) showPlay(); } }, () => {}); }
    return faces.get(who);
  }
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function showPlay() {
    const p = playing, st = p.run.state, w = p.wait;
    const say = (e) => {
      if (e.type !== 'line') return `<div class="fx">${esc(e.text)}</div>`;
      const url = faceUrl(e.who || 'npc');
      return `<div class="say">${url ? `<i class="face" style="background-image:url('${url}')"></i>` : ''}<div><b>${esc(speaker({ type: 'line', who: e.who }).name)}</b>${esc(e.text)}</div></div>`;
    };
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
  // screen: [x, y] in the canvas (none: its top left corner); a note instead of items is said for a moment
  function menuAt(screen, note, onPick, items = menu) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'sg-menu';
    menuEl.style.left = (screen ? screen[0] : 20) + 'px';
    menuEl.style.top = (screen ? screen[1] : 20) + 'px';
    menuEl.innerHTML = note ? `<div class="tip" style="max-width:240px;margin:4px 6px">${esc(note)}</div>`
      : items.map((m) => (m === '-' ? '<hr>' : `<button data-pick="${esc(m[0])}" data-who="${esc(m[2] || '')}">${esc(m[1])}</button>`)).join('');
    canvasHost.appendChild(menuEl);
    const room = [canvasHost.clientWidth - menuEl.offsetWidth - 6, canvasHost.clientHeight - menuEl.offsetHeight - 6];
    menuEl.style.left = Math.max(4, Math.min(room[0], menuEl.offsetLeft)) + 'px';
    menuEl.style.top = Math.max(4, Math.min(room[1], menuEl.offsetTop)) + 'px';
    menuEl.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { const pick = [b.dataset.pick, b.dataset.who]; closeMenu(); onPick(pick); });
    if (note) setTimeout(closeMenu, 2600);
  }
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  // a press anywhere else closes the menu (the canvas takes the pointer on its own press: this runs first)
  const outside = (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); };
  document.addEventListener('pointerdown', outside, true);
  const escape = (e) => { if (e.key === 'Escape' && menuEl) { closeMenu(); e.stopPropagation(); } };
  canvasHost.addEventListener('keydown', escape, true);

  host.querySelectorAll('[data-add]').forEach((b) => b.onclick = (e) => {
    if (b.dataset.add !== 'more') return add(b.dataset.add);
    const r = canvasHost.getBoundingClientRect();
    menuAt([e.clientX - r.left, 8], null, ([type, who]) => {
      if (type === 'end' && selected) { const n = graph.nodes.find((x) => x.id === selected); const o = n?.outs.find((x) => x.port === 'next'); if (o) return edit((s) => connect(s, selected, 'next', END)); }
      add(type, selected, undefined, who);
    });
  });
  host.querySelector('[data-do="undo"]').onclick = () => undoLast();
  host.querySelector('[data-do="tidy"]').onclick = () => { canvas.arrange(); canvas.fit(); };
  host.querySelector('[data-do="fit"]').onclick = () => canvas.fit();
  host.querySelector('[data-do="play"]').onclick = () => startPlay();

  draw();
  if (start?.view) canvas.setView(start.view);
  showSide();
  if (start?.focused) canvas.focus();
  return {
    refresh: () => draw(),
    // where the view is, for the next view of this dialogue (story.js render: a step back or forward draws it again)
    getView: () => ({ view: canvas.view(), selected, focused: !!document.activeElement && canvasHost.contains(document.activeElement) }),
    destroy() {
      document.removeEventListener('pointerdown', outside, true);
      cancelAnimationFrame(redraw);
      closeMenu();
      canvas.destroy();
    },
  };
}
