// Window > Logic: the map's rules seen as a graph, read as sentences, or tried (editor/LOGIC.md; the design:
// backup/20261027_logic_graph/final_design.json, its mock-up logic-di-deusedix.html; the look: editor/DESIGN.md and
// the Story's Graph). It draws logic-graph-model.js's projection of edits.links on the graph canvas (graph-canvas.js),
// logic-graph-read.js's prose and Try it (logic-try.js); it changes nothing: a node opened selects its object in the
// map, where the Inspector edits its rules (a dialogue's opens its Story Graph here, the Story's own editor). The page gives the model's input (app.js logicInput).
//
// What it shows is what a level designer needs, in their words: things by the names the Hierarchy gives them (the
// object's own name only in the tooltip), a rule card titled by what sets it off, its conditions and its steps (their
// time only when one waits), simple rules as a labelled wire, and an index at the side (the objects, the states and
// counters, what to check) to find one's way.
//
// createLogicWindow({root, input, select, status, trial})
//   input()       a Promise of logic-graph-model.js's input ({catalog, edits, actors, items, story, wiring, tags, map})
//   select(name)  the map object of that name selected (its rules in the Inspector)
//   trial()       for Try it (logic-try.js): a Promise of the compiled rules and the world they run in
//   phases()      for the Phases page (logic-phases-page.js): a Promise of the map's Phases blocks
//   addRule(block, port)  a new rule on a block's output (the Phases page's "+ When it starts…")
//   proposal()    the AI assistant's proposal waiting for the user, or null (app.js logicProposalNow: {id, summary,
//                 input (the model's input with it), ghost (the node ids it adds or changes), added, changed, removed,
//                 groups, blocks, problems}): drawn instead of the map's rules, its own as ghosts, with a bar to answer
//   decide(how)   the user's answer: 'accept', 'edit' (accept, then its first rule in the List) or 'reject'
//   why({rule, object})  "Why didn't it run?" (app.js logicWhy): a Promise of {notes, rules: [{id, src, sentence, play,
//                 tried, checks}]}, asked with W on a selected rule or object, or with the bar's Why not?
//   trails        the trails of the game (logic-trails.js createTrails): the graph marked with what the rules did in
//                 Play (counts, the condition that did not hold, the step that failed, a block's value), its wires lit
//                 as the lines come, and a timeline under the graph to scrub and replay the session
//   lastPlay()    a Promise of the last Play's lines of this map ({lines, notes}: app.js logicPlayed), for "Show the last
//                 Play" when the trails have none (the page opened after Play)
//   played(rules) the rules a replay or a step went past: the 3D view's wires light for them
//   starts        Try it's named starts, the project's Play scenarios (logic-try.js; app.js logicStarts)
//   storyGraph(host, id)  a dialogue's node opened (P5): a Promise of its Story Graph mounted in host ({title, speaker,
//                 destroy()}, or null: story.js __story.mountGraph), shown in place of the rules' graph until "← Logic graph"
//   storyOpen(key, id)  an InfoLink's or a Story event's node opened, or "Open in the Story panel": the Story panel on
//                 it ('dialogues' | 'infolinks' | 'events'; story.js __story.openItem, false when it is not there)
//   watch(name, on)  a state's or counter's pin clicked in the list (P5): watched while playing, or no more (app.js:
//                 the map's edits.logic.watch, undoable; the Rebuild gives the map's UCLogicHub the list)
//   startValue(name, value)  the start value chosen over one state's graph (P5): true / false / a whole number, or
//                 undefined for none (app.js: edits.logic.start, undoable; UCLogicHub sets it on the first visit)
//   live(line, {quiet})  live control while Play runs (P7, logic-live.js): a "deusedix ..." line to the game, a
//                 Promise of its answer in words (app.js logicLive, through the Console; quiet: not shown there, for the
//                 "paused" asked every second while a rule may pause the game); the bar over the graph sets the rule chosen
//                 off, mutes, traces or pauses on it (M, F9), Step and Continue when the game is paused at a rule, sets
//                 a state now; what the game says of it (its live and break lines, in the trails) presses the buttons
//   boxes(label, list)  the map's blocks of its own changed (P8, logic-boxes.js): edits.logic.boxes becomes the list,
//                 one undoable step named label (app.js lgBoxes). Ctrl+G puts the rules and logic pieces selected in the
//                 graph in a block; a block's node opens with a double click, Enter or Ctrl+Shift+G (the bar over the
//                 graph says where one is, its names go back up, Esc too); F2 renames a block or a port; Unpack takes
//                 the block away. The game runs the rules as before: a block is a way of looking at them.
//   patterns      the project's logic patterns (P8, logic-patterns.js; app.js: /api/logic_patterns): {save(name,
//                 version)} a Promise of the pattern kept ({name, v, ...}); a block's Save as pattern... makes the version
// Returns {refresh(), focus(name), open(), redrawList(), tryWhy(id)}: refresh draws again (the edits changed); focus
// shows a name's chain; tryWhy(id, key) is Try it's answer for a rule (null when nothing was tried with the rules of
// that key: app.js logicTrial's, the map and its edits now).
import { logicIndex, logicGraph, scopeOf, thingId, PIECE_KINDS, STORY_KINDS } from './logic-graph-model.js';
import { readView } from './logic-graph-read.js';
import { logicProblems, problemsByNode } from './logic-graph-problems.js';
import { createGraphCanvas } from './graph-canvas.js';
import { createLogicTry } from './logic-try.js';
import { phasesPage, phasesHtml } from './logic-phases-page.js';
import { escapeHtml as esc } from './shortcut-bar.js';
import { trailMarks, markTrails, crossed, lightOf, lineWords, secs, sameMap } from './logic-trails.js';
import { stateValueText } from './logic-log.js';
import { editorIcon } from './editor-icons.js';
import { liveCommand, liveBook, liveOf, liveRead, ruleLive, liveAny, liveBarHtml, liveAnswered, pausedAnswer } from './logic-live.js';
import { boxesOf, boxedRules, boxedView, boxPath, selectionMembers, makeBox, unpackBox, renameBox, renamePort, rulesInside, boxOfRule, BOX, PORT } from './logic-boxes.js';
import { patternOf, patternWords, instanceBoxes } from './logic-patterns.js';

const OBJECT = 'obj:';
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./logic-window.css', import.meta.url).href;
document.head.appendChild(css);

// 13 px icons on the 20 px grid (editor-icons.js), one per kind of thing: shown when a thing has no picture
export const ICONS = {
  door: '<path d="M5 17V3h10v14M3 17h14"/><path d="M12 10h.01"/>',
  light: '<path d="M10 3a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9zM8 17h4"/>',
  character: '<circle cx="10" cy="6" r="3"/><path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6"/>',
  keypad: '<rect x="5" y="3" width="10" height="14" rx="1.5"/><path d="M8 7h.01M10 7h.01M12 7h.01M8 10h.01M10 10h.01M12 10h.01M8 13h.01M10 13h.01M12 13h.01"/>',
  computer: '<rect x="3" y="4" width="14" height="9" rx="1"/><path d="M7 16h6M10 13v3"/>',
  zone: '<rect x="3" y="3" width="14" height="14" rx="1" stroke-dasharray="2 2"/>',
  timer: '<circle cx="10" cy="11" r="6"/><path d="M10 8v3l2 1M8 2h4"/>',
  script: '<path d="M7 6l-4 4 4 4M13 6l4 4-4 4"/>',
  map: '<path d="M3 5l4-2 6 2 4-2v12l-4 2-6-2-4 2z"/><path d="M7 3v12M13 5v12"/>',
  item: '<path d="M4 7l6-4 6 4v6l-6 4-6-4z"/>',
  alarm: '<path d="M6 14V9a4 4 0 0 1 8 0v5M4 14h12M10 3v1"/>',
  camera: '<rect x="3" y="7" width="10" height="7" rx="1"/><path d="M13 9l4-2v7l-4-2"/>',
  cutscene: '<rect x="3" y="5" width="14" height="10" rx="1"/><path d="M8 8v4l4-2z"/>',
  story: '<path d="M4 4h12v9H8l-4 3z"/>',
  signal: '<circle cx="10" cy="10" r="1.5"/><path d="M6.5 6.5a5 5 0 0 0 0 7M13.5 6.5a5 5 0 0 1 0 7M4 4a8.5 8.5 0 0 0 0 12M16 4a8.5 8.5 0 0 1 0 12"/>',
  group: '<circle cx="7" cy="8" r="2.5"/><circle cx="13" cy="8" r="2.5"/><path d="M3 16c0-2 2-3.5 4-3.5M17 16c0-2-2-3.5-4-3.5"/>',
  object: '<rect x="4" y="5" width="12" height="11" rx="1"/><path d="M4 8h12"/>',
  box: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M2 8h2M2 12h2M16 8h2M16 12h2"/>',
  port: '<path d="M4 10h8M9 6l4 4-4 4M16 4v12"/>',
};
const ICON_OF = { door: 'door', elevator: 'door', light: 'light', switchlight: 'light', character: 'character', carcass: 'character',
  keypad: 'keypad', computer: 'computer', zone: 'zone', targettrigger: 'zone', switchtrigger: 'zone', moretrigger: 'zone', timer: 'timer',
  script: 'script', item: 'item', alarm: 'alarm', camera: 'camera', turret: 'camera', laser: 'alarm', beam: 'alarm', cutscene: 'cutscene',
  world: 'map', group: 'group', signal: 'signal', box: 'box', port: 'port' };
const iconOf = (family) => ICON_OF[family] || 'object';
const capital = (s) => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };

// ---------------------------------------------------------------- the model's graph as the canvas draws it (pure)
// A thing's pins are rows: what it can set off (outputs, on the right), what rules make it do (inputs, on the left),
// only those in use. A rule card: titled by what sets it off (its pin on the header), "Only if" with its conditions,
// its steps (each with its time when one of them waits), "Otherwise". A pin a wire names but the node lacks is the
// node's header pin. pictures(name): the key of a thing's picture (graph-canvas.js thumb) or ''.
export function canvasOf(graph, problems = new Map(), pictures = () => '') {
  const nodes = [], pins = new Map();
  // a rule's "If not" rule (otherwiseOf, action-list.js): drawn inside its card, under "If not", when both are shown
  const byRule = new Map(graph.nodes.filter((n) => n.kind === 'rule').map((n) => [n.rule, n]));
  const folded = new Map(graph.nodes.filter((n) => n.kind === 'rule' && n.otherwiseOf && byRule.has(n.otherwiseOf))
    .map((n) => [n.id, byRule.get(n.otherwiseOf).id]));
  const ifNot = new Map([...folded].map(([other, main]) => [main, graph.nodes.find((n) => n.id === other)]));
  const tone = (id) => { const p = problems.get(id) || []; return p.some((x) => x.level === 'error') ? 'bad' : p.some((x) => x.level === 'warn') ? 'warn' : undefined; };
  const said = (id) => (problems.get(id) || []).filter((x) => x.level !== 'info').map((x) => x.text).join('\n') || undefined;
  for (const n of graph.nodes) {
    if (folded.has(n.id)) continue;
    const ids = new Set();
    const row = (r) => { if (r.in) ids.add(r.in.id); if (r.out) ids.add(r.out.id); return r; };
    let out;
    if (n.kind === 'rule') {
      const one = n.causes.length === 1, rows = [];
      if (!one) for (const [i, c] of n.causes.entries()) rows.push(row({ id: 'cause:' + i, text: capital(c.short || c.text), title: c.text, in: { id: 'cause:' + i } }));
      if (n.checks.length) rows.push({ id: 'ifhead', head: true, sep: !one, text: n.match === 'any' ? 'Only if one of these holds' : 'Only if' });
      for (const c of n.checks) rows.push(row({ id: c.pin, text: capital(c.text), tone: c.problem ? 'bad' : c.unset ? 'warn' : undefined,
        title: c.unset ? 'Nothing sets it yet' : c.setBy.length ? 'Set by ' + c.setBy.map((s) => s.text).join(', ') : undefined, in: { id: c.pin } }));
      const steps = [...n.sections.flatMap((s) => s.rows), ...n.otherwise];
      const timed = steps.some((r) => r.time > 0), time = (r) => (timed ? (r.time > 0 ? `+${r.timeText}` : 'now') : undefined);
      if (n.checks.length || !one) rows.push({ id: 'dohead', head: true, sep: true, text: 'Then' });
      // a step's row: an If or an Otherwise of a list a head, its steps indented, its End not shown
      const step = (r) => {
        if (r.flow === 'end') return;
        if (r.flow === 'if') { rows.push({ id: r.id, head: true, indent: r.depth * 12, text: capital(r.text.replace(/:$/, '')), title: r.text }); return; }
        if (r.flow === 'else') { rows.push({ id: r.id, head: true, indent: r.depth * 12, text: 'Otherwise' }); return; }
        // a list of steps: a step's own wait as "+2 s" (from the step before), nothing when it has none
        const t = r.flow === undefined ? time(r) : r.pause || !(r.time > 0) ? undefined : `+${r.timeText}`;
        rows.push(row({ id: r.id, text: capital(r.text), time: t, indent: (r.depth || 0) * 12,
          out: r.target ? { id: r.id } : undefined, title: r.text }));
      };
      n.sections.forEach((s, k) => {
        if (s.title) rows.push({ id: 'sec' + k, head: true, text: s.title });
        s.rows.forEach(step);
      });
      if (!steps.length) rows.push({ id: 'none', dim: true, text: 'Nothing yet' });
      const other = ifNot.get(n.id);
      if (other) {
        rows.push({ id: 'ifnothead', head: true, sep: true, text: 'If not' });
        other.sections.forEach((s) => s.rows.forEach((r) => rows.push(row({ id: r.id, text: capital(r.text),
          time: r.time > 0 ? `+${r.timeText}` : undefined, out: r.target ? { id: r.id } : undefined, title: r.text }))));
        if (!other.sections.some((s) => s.rows.length)) rows.push({ id: 'ifnotnone', dim: true, text: 'Nothing yet' });
      }
      if (n.otherwise.length) {
        rows.push({ id: 'elsehead', head: true, sep: true, text: 'Otherwise' });
        for (const r of n.otherwise) rows.push(row({ id: r.id, text: capital(r.text), time: time(r), out: r.target ? { id: r.id } : undefined, title: r.text }));
      }
      const head = one ? causeTitle(n.causes[0], graph) : 'When one of these happens';
      out = { id: n.id, kind: 'rule', title: capital(head), rows, dim: n.muted, tone: tone(n.id), w: 264,
        label: n.sentence, badges: [...(n.badges || []).map((b) => ({ text: b.text || String(b), title: b.title || '' })),
          { text: n.rule, title: `Rule ${n.rule}: ${n.sentence}${said(n.id) ? '\n\n' + said(n.id) : ''}` }] };
      if (one) out.in = { id: 'cause:0', title: n.causes[0].text };
    } else if (n.readOnly) {
      const rows = [...n.pins.in.map((p) => row({ id: p.id, text: capital(p.label), in: { id: p.id } })),
        ...(n.rows || []).map((r) => row({ id: r.id, text: capital(r.text), out: r.target ? { id: r.id } : undefined }))];
      out = { id: n.id, kind: 'story', icon: 'story', title: n.title || n.id,
        sub: n.kind === 'dialogue' ? 'dialogue' : n.kind === 'infolink' ? 'InfoLink' : 'Story', rows, dim: n.disabled };
    } else {
      // a pin's words without the hints in brackets (they are in its tooltip)
      const words = (p) => ({ text: capital(String(p.label || '').replace(/\s*\([^)]*\)/g, '')), title: p.label });
      const rows = [...n.pins.out.map((p) => row({ id: p.id, ...words(p), out: { id: p.id } })),
        ...n.pins.in.map((p) => row({ id: p.id, ...words(p), in: { id: p.id } }))];
      const title = n.kind === 'world' ? 'The map' : capital(n.label || n.name);
      const word = n.kind === 'world' ? '' : String(n.word || '');
      out = { id: n.id, kind: n.kind === 'world' ? 'world' : 'thing', icon: iconOf(n.family), thumb: n.kind === 'world' ? '' : pictures(n.name),
        title, sub: n.missing ? 'not in the map' : word && n.kind !== 'group' && !title.toLowerCase().includes(word.toLowerCase()) ? word : undefined,
        rows, dim: n.disabled, tone: n.missing ? 'bad' : tone(n.id), label: `${title}${word ? ', ' + word : ''}${n.name ? ' (' + n.name + ')' : ''}` };
    }
    if (!out.in) out.in = { id: 'in' };
    out.out = { id: 'out' };                                  // the header pins: a wire whose pin the node lacks
    if (n.pos) out.at = n.pos;
    pins.set(n.id, ids);
    nodes.push(out);
  }
  // the wires of a folded "If not" rule: from its rows, now its card's; the one into it (its cause, the card's too) not drawn
  const at = (id) => folded.get(id) || id;
  const pinOf = (end, side) => ({ node: at(end.node), pin: end.pin && pins.get(at(end.node))?.has(end.pin) ? end.pin
    : side === 'in' && end.pin === 'cause:0' ? 'cause:0' : side });
  const wires = graph.wires.filter((w) => !folded.has(w.to.node) && pins.has(at(w.from.node)) && pins.has(at(w.to.node))).map((w) => ({
    id: w.id, kind: w.kind || 'causes', from: pinOf(w.from, 'out'), to: pinOf(w.to, 'in'), label: w.label || undefined,
    delay: w.delay || undefined, tone: tone(w.id), title: w.sentence || undefined }));
  return { nodes, wires };
}

// A rule card's title: what sets it off, the thing it is wired to called "it" (When JC chooses "Lights off" on it),
// without the hints in brackets; the short words when the thing's name is not in the sentence
function causeTitle(c, graph) {
  const strip = (t) => String(t || '').replace(/\s*\([^)]*\)/g, '').trim();
  const thing = graph.nodes.find((x) => x.id === c.node);
  const name = thing && (thing.kind === 'world' ? '' : thing.label || thing.name);
  const text = strip(c.text);
  // the thing as the sentence names it ("Door3", "the door Door3"): "it"; then "picks up it" -> "picks it up", and
  // "gets where they were sent" said of one thing
  const at = name ? new RegExp(`(?:\\bthe \\w+ )?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null;
  if (at && at.test(text)) {
    // ("is in it", a "while" (P3), is no phrasal verb)
    return capital(text.replace(at, 'it').replace(/\b(?!is\b|are\b)(\w+) (up|on|off|in|out|down) it\b/, '$1 it $2')
      .replace(/\bit gets where they were sent\b/, 'it gets where it was sent'));
  }
  if (/^(while|from when) /i.test(text)) return capital(text);   // a "while" (P3): its lasting state, never the short "When ..."
  return capital('When ' + strip(c.short || c.text).replace(/^when /i, ''));
}
// the object a node stands for: a map object's name, a rule card's first cause's object
export function objectOf(graph, id) {
  if (id.startsWith(OBJECT)) return id.slice(OBJECT.length);
  const n = graph.nodes.find((x) => x.id === id);
  const c = n && n.kind === 'rule' && n.causes[0];
  return c && c.node.startsWith(OBJECT) ? c.node.slice(OBJECT.length) : '';
}
// the Story item a node stands for (dlg:d4, info:i2, story:e3): {key: 'dialogues' | 'infolinks' | 'events', id}, or null
export function storyItemOf(id) {
  const k = STORY_KINDS.find(([, prefix]) => String(id || '').startsWith(prefix));
  const rest = k ? String(id).slice(k[1].length) : '';
  return rest ? { key: k[0], id: rest } : null;
}

// The index at the side (pure): the things that start rules or are acted on, the states and counters (who sets and
// reads them), what to check. [{title, rows: [{key, text, note, tone, title}]}]
// The states and counters watched while playing (P5, the map's edits.logic.watch: pinned in this list) have a pin
// (row.pin: {name, on}), those no rule of the map uses too; with `values` (logic-trails.js trailMarks' states: what the
// game said each one holds), their value as the note, and `fresh` (lower-case name -> seconds since it changed, while
// it fades) marks the ones that changed a moment ago (row.age).
export const WATCH_MAX = 32;                           // UCLogicHub.Watch[32] (links.py MAX_WATCH)
export const FRESH_SECS = 4;                           // a change stays marked this long, fading
// a state's or counter's start value (P5, the map's edits.logic.start: {name: true / false / a whole number}),
// whatever the case of its name; undefined when it has none. As words: "Yes", "No", "3".
export function startOf(edits, name) {
  const given = edits && edits.logic && edits.logic.start && typeof edits.logic.start === 'object' ? edits.logic.start : {};
  const k = Object.keys(given).find((x) => x.toLowerCase() === String(name).toLowerCase());
  return k === undefined ? undefined : given[k];
}
export const startText = (v) => (typeof v === 'number' ? String(v) : v ? 'Yes' : 'No');
// The bar over the graph of one state's rules: its start value, a Yes / No list for a state, a number for a counter
// (type 'int'); one no rule of the map uses is a state unless its start value is a number.
export function startBarHtml(name, type, value) {
  const counter = type === 'int' || (type !== 'bool' && typeof value === 'number');
  const tip = "On the map's first visit, if nothing has set it yet (an earlier map, a Play scenario), it starts so";
  const field = counter
    ? `<input type="number" step="1" class="lw-startval" value="${typeof value === 'number' ? value : ''}" placeholder="not set (0)" aria-label="${esc(name)} starts at">`
    : `<select class="lw-startval" aria-label="${esc(name)} starts as">${[['', 'not set (No)'], ['1', 'Yes'], ['0', 'No']].map(([v, t]) =>
      `<option value="${v}"${(value === undefined ? '' : value ? '1' : '0') === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  return `<label title="${esc(tip)}">${counter ? 'Starts at' : 'Starts as'} ${field}</label>`;
}
export function watchList(edits) {
  const w = edits && edits.logic && Array.isArray(edits.logic.watch) ? edits.logic.watch : [];
  return w.filter((n) => typeof n === 'string' && n.trim());
}
export function indexOf(ix, whole, problems, { values = null, fresh = null } = {}) {
  const watch = watchList(ix.edits), pinned = new Set(watch.map((n) => n.toLowerCase()));
  const starts = new Map();
  for (const r of ix.rules) for (const c of r.causes) starts.set(c.node, (starts.get(c.node) || 0) + 1);
  // (a named group that starts rules, P9: anyone of a kind or a faction, is one of them too)
  const things = whole.nodes.filter((n) => n.kind === 'thing' || n.kind === 'world' || (n.kind === 'group' && !n.unnamed && starts.get(n.id)));
  const label = (n) => (n.kind === 'world' ? 'The map' : n.label || n.name);
  const objects = things.map((n) => ({ key: 'thing:' + n.id, text: label(n), sort: (n.kind === 'world' ? '0' : '1') + label(n).toLowerCase(),
    note: starts.get(n.id) ? `${starts.get(n.id)}` : '', tone: n.missing ? 'bad' : undefined,
    title: n.missing ? `${n.name} is not in the map` : `${label(n)}${n.word ? ' · ' + n.word : ''}${n.name ? ' (' + n.name + ')' : ''}`
      + (starts.get(n.id) ? `\nStarts ${starts.get(n.id)} rule${starts.get(n.id) === 1 ? '' : 's'}` : '') }))
    .sort((a, b) => a.sort.localeCompare(b.sort));
  // a watched one: its pin, and what the game said it holds (the note), changed a moment ago (its age)
  const live = (row, name) => {
    const on = pinned.has(name.toLowerCase()), v = on && values ? values.get(name.toLowerCase()) : null;
    const start = startOf(ix.edits, name);
    row.pin = { name, on };
    if (start !== undefined) {               // its start value: the note until the game says what it holds
      row.note = '=' + startText(start);
      row.title += `\nStarts as ${startText(start)} on the map's first visit, if nothing has set it yet`;
      if (row.tone === 'warn') row.tone = undefined;
    }
    if (v) {
      row.note = stateValueText(v.value);
      row.title += `\nIn the game: ${stateValueText(v.value)}${v.changes ? ` (changed ${v.changes} time${v.changes === 1 ? '' : 's'}, last at ${secs(v.t)})` : ''}`;
      const age = fresh ? fresh.get(name.toLowerCase()) : undefined;
      if (age !== undefined && age < FRESH_SECS) row.age = age;
    }
    row.title += on ? '\nWatched while playing: its changes go to the Console and show here (click the pin to stop)'
      : '\nClick the pin to watch it while playing';
    return row;
  };
  const states = [...ix.states.values()].map((s) => live({ key: 'state:' + s.name, text: s.name, note: s.type === 'int' ? '#' : '',
    tone: !s.setters.length && !s.elsewhere.some((u) => u.kind === 'write') ? 'warn' : undefined,
    title: `${s.type === 'int' ? 'Counter' : 'State'} ${s.name}\nSet by: ${[...new Set(s.setters.map((u) => u.rule || u.text))].filter(Boolean).join(', ') || 'nothing on this map'}`
      + `\nRead by: ${[...new Set(s.readers.map((u) => u.rule || u.text))].filter(Boolean).join(', ') || 'nothing on this map'}` }, s.name));
  // watched ones no rule of this map uses (the Story's, the map's own scripts'): still in the list, with their pin
  const known = new Set([...ix.states.values()].map((s) => s.name.toLowerCase()));
  for (const name of watch) {
    if (known.has(name.toLowerCase())) continue;
    known.add(name.toLowerCase());
    states.push(live({ key: 'state:' + name, text: name, note: '', title: `${name}\nNo rule of this map sets or reads it` }, name));
  }
  states.sort((a, b) => (b.pin.on - a.pin.on) || a.text.localeCompare(b.text));      // the watched ones first
  const check = problems.filter((p) => p.level !== 'info').map((p, i) => ({ key: 'problem:' + i, node: p.node, rule: p.rule,
    text: p.text, tone: p.level === 'error' ? 'bad' : 'warn', title: p.text }));
  // the signals (P3): how many rules send each and wait for it
  const signals = whole.nodes.filter((n) => n.kind === 'signal' && (ix.actors[n.name] || {}).hub).map((n) => {
    const sends = ix.rules.filter((r) => [...r.acts, ...r.otherwise].some((a) => a.node === n.id && a.x.verb === 'signal')).length;
    const waits = ix.rules.filter((r) => r.causes.some((c) => c.node === n.id)).length;
    return { key: 'thing:' + n.id, text: n.label, note: `${sends} → ${waits}`, tone: !sends || !waits ? 'warn' : undefined,
      title: `The signal "${n.label}"
Sent by ${sends} rule${sends === 1 ? '' : 's'}, waited for by ${waits}` };
  }).sort((a, b) => a.text.localeCompare(b.text));
  return [{ id: 'objects', title: 'Objects', rows: objects }, { id: 'signals', title: 'Signals', rows: signals }, { id: 'states', title: 'States and counters', rows: states },
    { id: 'check', title: 'To check', rows: check }].filter((s) => s.rows.length);
}

// ---------------------------------------------------------------- the window
export function createLogicWindow({ root, input, select = () => {}, status = () => {}, trial = null, picture = null, listView = null, phases = null, addRule = null, proposal = null, decide = null, why = null,
  trails = null, lastPlay = null, played = () => {}, starts = null, storyGraph = null, storyOpen = null, watch = null, startValue = null, live = null,
  boxes = null, patterns = null, scripts = null }) {
  root.classList.add('logic-window');
  root.innerHTML = `<div class="lw-bar">
      <div class="lw-tabs" role="tablist">
        <button type="button" class="lw-tab" data-view="list" role="tab" title="The rules of the object as lists of steps, to edit">List</button>
        <button type="button" class="lw-tab" data-view="graph" role="tab" title="The rules as a graph">Graph</button>
        <button type="button" class="lw-tab" data-view="read" role="tab" title="The rules as sentences, object by object">Read</button>
        <button type="button" class="lw-tab" data-view="phases" role="tab" title="The phases of the map from first to last: what starts and ends each one, and what moves the mission on">Phases</button>
        <button type="button" class="lw-tab" data-view="try" role="tab" title="Play the rules here, with no game: press what happens, see what they do and why not">Try it</button>
      </div>
      <span class="lw-div"></span>
      <div class="lw-tabs lw-scope" role="radiogroup" aria-label="What the graph shows">
        <button type="button" data-scope="chain" title="The selected object's rules: what sets them off and what they do">Selected</button>
        <button type="button" data-scope="map" title="Every rule of the map">Whole map</button>
      </div>
      <button type="button" class="lw-fit" title="Fit the graph (Home)">Fit</button>
      <button type="button" class="lw-patsbtn" title="The project's patterns: place one in this map, its places filled with this map's objects">Patterns</button>
      <button type="button" class="lw-whybtn" title="Why didn't it run? For the rule or the object selected: what the last Play and Try it say of it, and what to check (W)">Why not?</button>
      <span class="lw-info"></span>
    </div>
    <div class="lw-body">
      <nav class="lw-side" aria-label="Logic index"></nav>
      <div class="lw-main">
        <div class="lw-propose" role="region" aria-label="The assistant's proposal" hidden></div>
        <div class="lw-why" role="region" aria-label="Why didn't it run?" hidden></div>
        <div class="lw-pats" role="region" aria-label="Patterns" hidden></div>
        <div class="lw-graph"></div>
        <div class="lw-trail" role="region" aria-label="Trails of the Play" hidden></div>
        <div class="lw-live" role="region" aria-label="Live control while playing" hidden></div>
        <div class="lw-list" hidden></div>
        <div class="lw-crumb" hidden></div>
        <div class="lw-startbar" role="group" aria-label="Start value" hidden></div>
        <div class="lw-read" hidden></div>
        <div class="lw-phases" hidden></div>
        <div class="lw-try" hidden></div>
        <div class="lw-story" role="region" aria-label="Dialogue" hidden>
          <div class="lw-storybar">
            <button type="button" class="lw-storyback" title="Back to the rules' graph">← Logic graph</button>
            <span class="lw-storytitle"></span>
            <button type="button" class="lw-storypanel" title="This dialogue in the Story panel, with its other pages">Open in the Story panel</button>
          </div>
          <div class="lw-storyhost"></div>
        </div>
      </div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  let view = 'graph', scope = 'chain', listSig = null, listRule = null, graph = { nodes: [], wires: [] }, focusName = '', focusState = '', drawn = '', fitted = '';
  let busy = null, again = false, index = [], picked = null, asked = 0;
  // the trails: the graph as drawn before they mark it (shown, its index and graph), and where the timeline is (at:
  // Infinity follows the game as its lines come)
  let base = null;
  const tl = { at: Infinity, playing: false, speed: 1, raf: 0, built: '' };
  const pictures = new Map();                          // a class's picture, once known: a URL, or null when it has none
  const canvas = createGraphCanvas($('.lw-graph'), { label: 'Logic graph', icons: ICONS,
    thumb: (key) => (picture ? picture(key) : Promise.resolve(null)),
    onOpen: (node) => {
      if (String(node).startsWith(BOX)) { openBox(String(node).slice(BOX.length)); return; }
      if (String(node).startsWith(PORT)) { boxUp(); return; }      // a port: what it reaches is outside, one level up
      const item = storyItemOf(node);
      if (item) { openStory(item); return; }
      const name = objectOf(graph, node); if (name) select(name);
    },
    onSelect: (sel) => { picked = sel; const id = (sel.nodes || [])[0]; const name = id && objectOf(graph, id); if (name) focusName = name; liveBar(); crumb(); },
    onCommand: (name, d) => {
      if (name === 'why') askWhy(d && d.selection);
      else if (name === 'mute' || name === 'breakpoint') liveToggle(name === 'mute' ? 'mute' : 'break', d && d.selection);
      else if (name === 'make-block') makeBlock(d && d.selection);
      else if (name === 'open-block') { const b = boxPicked(d && d.selection); if (b) openBox(b); else status('Select a block first (Ctrl+G makes one).', 'warn'); }
      else if (name === 'rename') renameStart(d && d.selection);
      else if (name === 'edit') {                  // Enter on a node opens it, as a double click does
        const id = ((d && d.selection && d.selection.nodes) || [])[0], item = id && storyItemOf(id);
        if (id && String(id).startsWith(BOX)) openBox(String(id).slice(BOX.length));
        else if (item) openStory(item);
        else if (id) { const obj = objectOf(graph, id); if (obj) select(obj); }
      }
    } });
  const tryPanel = trial ? createLogicTry({ root: $('.lw-try'), trial, status, starts }) : null;
  if (!why) $('.lw-whybtn').remove();
  // A dialogue's node opens its Story Graph here, in place of the rules' graph (the Story's own view: its changes are
  // the Story's, undone with the editor's Ctrl+Z); an InfoLink's or a Story event's opens the Story panel on it.
  // storyAt: the dialogue shown ({id, back: the view to go back to}), storyMount: the mounted graph ({id, destroy()})
  let storyAt = null, storyMount = null;
  function openStory(item) {
    if (item.key === 'dialogues' && storyGraph) {
      storyAt = { id: item.id, back: view === 'story' ? (storyAt?.back || 'graph') : view };
      view = 'story'; tabs(); draw();
    } else if (storyOpen) {
      Promise.resolve(storyOpen(item.key, item.id)).then((ok) => { if (ok === false) status('It is not in the Story any more.', 'warn'); });
    }
  }
  function closeStory() {
    if (storyMount) { storyMount.destroy(); storyMount = null; }
  }
  async function showStory() {
    if (!storyAt) { view = 'graph'; tabs(); again = true; return; }      // drawn again, as the graph, after this draw
    if (storyMount && storyMount.id === storyAt.id) return;
    closeStory();
    const want = storyAt.id, host = $('.lw-storyhost');
    $('.lw-storytitle').textContent = '';
    const m = await storyGraph(host, want);
    if (view !== 'story' || storyAt?.id !== want || storyMount) { m?.destroy(); return; }     // left meanwhile
    if (!m) {
      host.innerHTML = '<p class="hint">This dialogue is not in the Story any more.</p>';
      storyMount = { id: want, destroy() { host.innerHTML = ''; } };
      return;
    }
    storyMount = { id: want, destroy: () => m.destroy() };
    const t = $('.lw-storytitle');
    t.innerHTML = `<b>${esc(m.title)}</b>${m.speaker ? ` <span>${esc(m.speaker)}</span>` : ''}`;
    t.title = `The dialogue "${m.title}"${m.speaker ? ' of ' + m.speaker : ''}: its changes are the Story's (Ctrl+Z steps back)`;
  }
  $('.lw-storyback').addEventListener('click', () => { view = storyAt?.back || 'graph'; storyAt = null; tabs(); draw(); });
  // the Story panel on it, and back to the rules here: one dialogue is not edited in two places at once
  $('.lw-storypanel').addEventListener('click', () => {
    if (!storyAt || !storyOpen) return;
    const id = storyAt.id;
    view = storyAt.back || 'graph'; storyAt = null; tabs(); draw();
    Promise.resolve(storyOpen('dialogues', id)).then((ok) => { if (ok === false) status('It is not in the Story any more.', 'warn'); });
  });
  // "Why didn't it run?": the rule picked in the graph (a card, or a simple rule's wire), else the object picked, else
  // the object the window shows; the answer in a panel over the view
  // the rule picked in the graph (a card, or a simple rule's wire: rule:L7/a1) and its words, else null
  function ruleOf(sel) {
    const node = (sel && sel.nodes || [])[0], wire = (sel && sel.wires || [])[0];
    const card = node && graph.nodes.find((n) => n.id === node && n.kind === 'rule');
    if (card) return { id: card.rule, title: capital(card.sentence || card.rule) };
    if (node || !wire || !/^rule:/.test(String(wire))) return null;
    const id = String(wire).split('/')[0].slice(5), w = graph.wires.find((x) => String(x.id).split('/')[0] === 'rule:' + id);
    return { id, title: capital((w && w.sentence) || id) };
  }
  async function askWhy(sel = picked) {
    if (!why) return;
    const node = (sel && sel.nodes || [])[0];
    const rule = ruleOf(sel)?.id || '';
    const object = rule ? '' : (node && objectOf(graph, node)) || focusName;
    if (!rule && !object) { status('Select a rule or an object first, then ask Why not? (W).', 'warn'); return; }
    if (object && /:/.test(object)) { status('Ask it of a rule or a map object (a signal has no rules of its own).', 'warn'); return; }
    const panel = $('.lw-why'), mine = ++asked;
    panel.hidden = false;
    panel.innerHTML = '<p class="hint">Reading the last Play…</p>';
    try {
      const a = await why(rule ? { rule } : { object });
      if (mine === asked) panel.innerHTML = whyHtml(a);
    } catch (e) {
      if (mine === asked) panel.innerHTML = whyHtml({ notes: [String(e.message || e)], rules: [] });
    }
  }
  $('.lw-whybtn')?.addEventListener('click', () => askWhy());
  $('.lw-why').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.classList.contains('lw-whyclose')) { $('.lw-why').hidden = true; asked++; return; }
    if (b.dataset.rule) {                          // a rule of the answer: opened in the List, on its object
      if (b.dataset.src) select(b.dataset.src);
      focusName = b.dataset.src || ''; focusState = ''; scope = 'chain'; view = 'list'; listRule = b.dataset.rule; listSig = null; tabs(); draw();
    }
  });
  $('.lw-why').addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { $('.lw-why').hidden = true; asked++; ev.stopPropagation(); } });
  if (!tryPanel) root.querySelector('.lw-tab[data-view=try]').remove();
  if (!phases) root.querySelector('.lw-tab[data-view=phases]').remove();
  // the Phases page: a rule opens in the List (on its object), "Its rules" selects the block, "+ When it starts…"
  // adds a rule on that output (the page's addRule, which opens it)
  $('.lw-phases').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.rule) {
      if (b.dataset.src) select(b.dataset.src);
      focusName = b.dataset.src || ''; focusState = ''; scope = 'chain'; view = 'list'; listRule = b.dataset.rule; listSig = null; tabs(); draw();
    } else if (b.classList.contains('lp-open')) {
      select(b.dataset.block);
      focusName = b.dataset.block; focusState = ''; scope = 'chain'; view = 'list'; listSig = null; tabs(); draw();
    } else if (b.classList.contains('lp-add') && addRule) addRule(b.dataset.block, b.dataset.port);
    else if (b.classList.contains('lp-go')) liveSend('input', b.dataset.block, 'GoTo_' + b.dataset.phase);
  });
  const tabs = () => {
    root.querySelectorAll('.lw-tab').forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
    });
    root.querySelectorAll('[data-scope]').forEach((b) => {
      const on = b.dataset.scope === (focusState ? 'state' : scope);
      b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    });
  };
  root.querySelectorAll('.lw-tab').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; tabs(); draw(); }));
  root.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { scope = b.dataset.scope; focusState = ''; boxAt = null; renaming = null; tabs(); draw(); }));
  $('.lw-fit').addEventListener('click', () => canvas.fit());
  $('.lw-propose').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-decide]');
    if (b && decide) { b.disabled = true; Promise.resolve(decide(b.dataset.decide)).finally(() => soon()); }
  });
  // the index: an object shows its rules (and is selected in the map), a state the rules that set and read it, a
  // problem its rule
  $('.lw-side').addEventListener('keydown', (ev) => {
    const f = ev.target.closest('.lw-watchadd');
    if (!f) return;
    ev.stopPropagation();                         // typed here, not the editor's keys
    if (ev.key === 'Escape') { f.value = ''; f.blur(); return; }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const name = f.value.trim();
    if (!name) return;
    if (!/^[A-Za-z_]\w*$/.test(name)) { status('A state\'s name is letters, digits and underscores, not starting with a digit.', 'warn'); return; }
    const now = watchList(sideOf && sideOf.ix.edits);
    if (now.some((n) => n.toLowerCase() === name.toLowerCase())) { status(`${name} is already watched.`); f.value = ''; return; }
    if (now.length >= WATCH_MAX) { status(`At most ${WATCH_MAX} states and counters can be watched on a map.`, 'warn'); return; }
    f.value = '';
    if (watch) watch(name, true);
  });
  $('.lw-side').addEventListener('click', (ev) => {
    if (ev.target.closest('.lw-watchadd')) return;
    // a state's pin: watched while playing, or no more (the map's edits: app.js, undoable)
    const p = ev.target.closest('[data-pin]');
    if (p) {
      ev.preventDefault();
      const on = p.getAttribute('aria-checked') !== 'true';
      if (on && watchList(sideOf && sideOf.ix.edits).length >= WATCH_MAX) { status(`At most ${WATCH_MAX} states and counters can be watched on a map.`, 'warn'); return; }
      if (watch) watch(p.dataset.pin, on);
      return;
    }
    const b = ev.target.closest('[data-key]');
    if (!b) return;
    const key = b.dataset.key;
    boxAt = null; renaming = null;                  // an object, a state, a problem: seen from the map (a problem's rule in its block)
    if (key.startsWith('thing:')) {
      const id = key.slice(6);
      if (view !== 'list') view = 'graph';          // the List shows the object chosen, the other views its graph
      scope = 'chain'; focusState = '';
      if (id.startsWith(OBJECT)) { focusName = id.slice(OBJECT.length); select(focusName); }
      else if (id.startsWith(PIECE_KINDS.signals[0])) { focusName = id; view = 'graph'; }   // a signal's hub: its senders and hearers
      else focusName = '';
      if (id === 'world') { scope = 'map'; }
    } else if (key.startsWith('state:')) { view = 'graph'; focusState = key.slice(6); }
    else if (key.startsWith('problem:')) {
      const row = index.flatMap((s) => s.rows).find((r) => r.key === key);
      const rule = row && row.rule && graph.nodes.find((n) => n.rule === row.rule);
      const name = rule ? objectOf(graph, rule.id) : '';
      view = 'graph'; focusState = '';
      boxAt = row && row.rule ? boxOfRule(shownBoxes(), row.rule) : null;
      if (boxAt) scope = 'map';
      else if (name) { focusName = name; scope = 'chain'; } else scope = 'map';
      if (row && row.rule) requestAnimationFrame(() => setTimeout(() => {
        const id = graph.nodes.find((n) => n.rule === row.rule)?.id;
        if (id) { canvas.select({ nodes: [id] }); canvas.reveal([id]); }
      }, 60));
    }
    tabs(); draw();
  });
  tabs();

  // ---- the trails (logic-trails.js): the graph marked with what the rules did up to the timeline's place
  const mapNow = () => (base ? base.ix.input.map || '' : '');
  const trailLines = () => (trails && base ? trails.lines(mapNow()) : []);
  function trailOn(shown) {
    const lines = trailLines();
    if (!lines.length) return;
    const marks = trailMarks(lines, base.ix, tl.at);
    markTrails(shown, marks, base.graph);
    // a block's node: the runs of the rules inside it, added up
    const list = allBoxes(base.ix.edits);
    for (const n of shown.nodes) {
      if (!String(n.id).startsWith(BOX)) continue;
      let ran = 0, failed = 0;
      for (const r of rulesInside(list, String(n.id).slice(BOX.length))) { const m = marks.rules.get(r); if (m) { ran += m.fired || 0; failed += m.failed || 0; } }
      if (ran || failed) n.live = `ran ${ran}×${failed ? ` · ${failed} failed` : ''}`;
    }
  }
  // the graph marked again (a line came, the timeline moved), without reading the rules again
  function retrail() {
    if (!base || view !== 'graph' || !seen()) return;
    const shown = structuredClone(base.shown);
    trailOn(shown);
    const key = JSON.stringify(shown);
    if (key !== drawn) { canvas.set(shown); drawn = key; }
  }
  let trailFrame = 0;
  const trailSoon = () => { if (!trailFrame) trailFrame = requestAnimationFrame(() => { trailFrame = 0; retrail(); strip(); renderSide(); }); };
  // what some lines lit: the graph's wires and rule cards (the 3D view's wires: `played`, for a replay or a step)
  function lightUp(lines, again3d) {
    if (!lines.length || !base) return;
    const l = lightOf(lines.slice(-40), base.ix);
    canvas.pulse(l.wires);
    canvas.flash?.(l.nodes);
    if (again3d && l.rules.length) played(l.rules);
  }
  // the names in a line as the window says them; whoever set a rule off in the game is the player (never in the map's edits)
  const names = (n) => { if (/^JCDenton\w*$/i.test(n || '')) return 'the player'; try { return base ? base.ix.ctx.name(n) || n : n; } catch { return n; } };
  const storyTitle = (key, id) => { try { return base ? base.ix.ctx.storyTitle(key, id) : id; } catch { return id; } };
  // the timeline under the graph: Replay, a step back and on, the place, where it is in words, speed, Live, Clear
  function strip() {
    const el = $('.lw-trail');
    $('.lw-main').classList.toggle('with-trail', !!trails && !el.hidden);
    if (!trails || el.hidden) return;
    requestAnimationFrame(() => $('.lw-main').style.setProperty('--lw-trail-h', `${el.offsetHeight + 16}px`));
    const lines = trailLines();
    const kind = lines.length ? 'session' : 'none';
    if (tl.built !== kind) {
      tl.built = kind;
      el.innerHTML = kind === 'none'
        ? `<span class="hint">No trails yet: Play the map, and the rules light up here as they run.</span>${lastPlay ? '<button type="button" data-t="load" title="Read what the rules did in the last Play of this map from the game\'s log">Show the last Play</button>' : ''}`
        : '<button type="button" data-t="play" class="lw-tplay" title="Replay the session from the start, or from here">Replay</button>'
          + '<button type="button" data-t="prev" title="One line back">‹</button>'
          + '<input type="range" class="lw-tscrub" min="0" max="1000" step="1" aria-label="Where in the session">'
          + '<button type="button" data-t="next" title="One line on">›</button>'
          + '<span class="lw-ttime"></span><span class="lw-tnow"></span>'
          + '<button type="button" data-t="speed" class="lw-tspeed" title="How fast the replay goes">1×</button>'
          + '<button type="button" data-t="live" class="lw-tlive" title="Follow the game: each rule lights as it runs">Live</button>'
          + '<button type="button" data-t="clear" title="Clear trails: the counts and the session go (the game\'s log stays as it is)">Clear trails</button>';
    }
    if (kind === 'none') return;
    const first = lines[0].t, end = lines[lines.length - 1].t, at = Math.min(tl.at, end), span = end - first;
    const upTo = lines.filter((x) => x.t <= at), now = upTo[upTo.length - 1];
    const scrub = el.querySelector('.lw-tscrub');
    if (document.activeElement !== scrub || tl.playing) scrub.value = String(span > 0 ? Math.round(((at - first) / span) * 1000) : 1000);
    const timed = lines.some((x) => x.timed);
    el.querySelector('.lw-ttime').textContent = `${secs(at)} of ${secs(end)} · ${upTo.length} of ${lines.length} lines`;
    el.querySelector('.lw-ttime').title = timed
      ? 'Live, a line comes 0.4 to 1 s after it happens: the game writes it, the editor reads its log every 0.4 s, and its time is when the editor got it. '
        + 'The game pauses while the editor has the focus: to watch, keep the game in front and this window beside it.'
      : 'These lines were read back from the game\'s log: their times are not known, so they come in order, a quarter of a second apart.';
    el.querySelector('.lw-tnow').textContent = now ? lineWords(now, names, { storyTitle }) : '';
    el.querySelector('.lw-tplay').textContent = tl.playing ? 'Pause' : 'Replay';
    el.querySelector('.lw-tspeed').textContent = `${tl.speed}×`;
    el.querySelector('.lw-tlive').classList.toggle('on', tl.at === Infinity && !tl.playing);
    el.querySelector('.lw-tlive').setAttribute('aria-pressed', String(tl.at === Infinity && !tl.playing));
  }
  // the timeline to t (Infinity: Live); going on, what it went past lights up
  function moveTo(t, light = true) {
    const lines = trailLines();
    if (!lines.length) return;
    const end = lines[lines.length - 1].t, from = Math.min(tl.at, end);
    tl.at = t;
    if (light && t > from) {
      const went = crossed(lines, from, Math.min(t, end));
      lightUp(went, true);
      // a watched state that changed on the way (a replay, a step on): marked in the list a moment, as a live one is;
      // its first line in the session is where it starts, no change
      for (const x of went) {
        if (x.entry.kind !== 'state' || x.entry.old === x.entry.new) continue;
        const k = String(x.entry.name).toLowerCase();
        if (lines.some((l) => l.n < x.n && l.entry.kind === 'state' && String(l.entry.name).toLowerCase() === k)) fresh.set(k, performance.now());
      }
    }
    retrail(); strip(); renderSide();
  }
  function stopReplay() { tl.playing = false; cancelAnimationFrame(tl.raf); tl.raf = 0; }
  function replay() {
    const lines = trailLines();
    if (!lines.length) return;
    if (tl.playing) { stopReplay(); strip(); return; }
    const end = lines[lines.length - 1].t;
    if (!(tl.at < end)) tl.at = lines[0].t - 0.001;   // from the start (from where it is, when it is not at the end)
    tl.playing = true;
    let last = performance.now();
    const tick = (now) => {
      if (!tl.playing) return;
      const t = tl.at + ((now - last) / 1000) * tl.speed;
      last = now;
      if (t >= end) { stopReplay(); moveTo(end); tl.at = Infinity; strip(); return; }
      moveTo(t);
      tl.raf = requestAnimationFrame(tick);
    };
    tl.raf = requestAnimationFrame(tick);
    strip();
  }
  $('.lw-trail').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-t]');
    if (!b || !trails) return;
    const lines = trailLines(), at = lines.length ? Math.min(tl.at, lines[lines.length - 1].t) : 0;
    switch (b.dataset.t) {
      case 'play': replay(); break;
      case 'prev': { stopReplay(); const back = lines.filter((x) => x.t < at).pop(); if (back) { moveTo(back.t, false); lightUp([back], true); } break; }
      case 'next': { stopReplay(); const on = lines.find((x) => x.t > at); if (on) moveTo(on.t); break; }
      case 'speed': tl.speed = { 1: 4, 4: 16, 16: 1 }[tl.speed] || 1; strip(); break;
      case 'live': stopReplay(); moveTo(Infinity, false); break;
      case 'clear': stopReplay(); tl.at = Infinity; trails.clear(); break;
      case 'load': {
        if (!lastPlay) break;
        b.disabled = true;
        try {
          const got = await lastPlay();
          if (!got.lines.length) status((got.notes || [])[0] || 'The last Play wrote nothing for this map.', 'warn');
          else { tl.at = Infinity; trails.add(got.lines); if ((got.notes || [])[0]) status(got.notes[0]); }
        } catch (e) { status('The game\'s log could not be read: ' + (e.message || e), 'warn'); }
        b.disabled = false;
        break;
      }
      default:
    }
  });
  $('.lw-trail').addEventListener('input', (ev) => {
    if (!ev.target.classList.contains('lw-tscrub')) return;
    const lines = trailLines();
    if (!lines.length) return;
    stopReplay();
    const first = lines[0].t, end = lines[lines.length - 1].t;
    moveTo(first + ((+ev.target.value) / 1000) * (end - first), true);
  });
  trails?.subscribe(({ added, reset }) => {
    if (reset) { stopReplay(); tl.at = Infinity; looked.clear(); fresh.clear(); trailSoon(); return; }
    const mine = (added || []).filter((x) => sameMap(x.entry.map, sideMap()));
    if (!mine.length) return;
    // a watched state's change that came while the game runs: marked in the list a moment (its first look is no change)
    for (const x of mine) {
      if (x.entry.kind !== 'state') continue;
      const k = String(x.entry.name).toLowerCase();
      if (x.live && looked.has(k) && x.entry.old !== x.entry.new) fresh.set(k, performance.now());
      looked.add(k);
    }
    // Live: what came lights up at once (the 3D view's wires: app.js, for every line that comes)
    if (tl.at === Infinity && !tl.playing && view === 'graph' && seen()) lightUp(mine.filter((x) => x.live), false);
    trailSoon();
  });

  // ---- live control while Play runs (P7, logic-live.js): the bar, what the game was told (from its lines), the keys
  let playing = false, book = liveBook(), liveDrawn = '';
  let liveTargetNow = { rule: null, happen: null, state: null };
  const liveNow = () => liveOf(book, sideMap());
  // what the bar is about: the rule picked in the graph, else the object chosen and what its rules wait for; and the
  // state or counter shown
  function liveTarget() {
    const ix = sideOf && sideOf.ix;
    const rule = view === 'graph' ? ruleOf(picked) : null;
    const node = view === 'graph' ? ((picked && picked.nodes) || [])[0] : null;
    const object = rule ? '' : (node && objectOf(graph, node)) || (view === 'graph' && scope === 'chain' && !focusState ? focusName : '');
    let happen = null;
    if (ix && object && !/:/.test(object)) {
      const seen = new Map();
      for (const r of ix.rules) for (const c of r.causes) {
        const w = c.cause && c.cause.when;
        if (!w || w === 'start' || w === 'signal' || String(c.src || '').toLowerCase() !== object.toLowerCase() || seen.has(w)) continue;
        let text = w;
        try { text = capital(ix.vocab.whenText(c.cause, ix.ctx)); } catch { /* its key, then */ }
        seen.set(w, { key: w, text });
      }
      happen = { object, title: names(object), list: [...seen.values()] };
    }
    const st = ix && focusState ? [...ix.states.values()].find((x) => x.name.toLowerCase() === focusState.toLowerCase()) : null;
    const state = focusState && view === 'graph' ? { name: focusState, type: st && st.type === 'int' ? 'int' : 'bool' } : null;
    return { rule, happen, state };
  }
  function liveBar() {
    const el = $('.lw-live');
    const on = !!live && playing && view !== 'try' && view !== 'story';
    $('.lw-main').classList.toggle('with-live', on);
    if (!on) { el.hidden = true; liveDrawn = ''; return; }
    const s = liveNow(), t = liveTarget();
    const held = s.paused && graph.nodes.find((n) => n.kind === 'rule' && String(n.rule).toLowerCase() === String(s.paused.rule).toLowerCase());
    const html = liveBarHtml({ rule: t.rule, flags: t.rule ? ruleLive(s, t.rule.id) : {}, paused: s.paused,
      pausedTitle: s.paused ? capital((held && held.sentence) || s.paused.rule) : '', happen: t.happen, state: t.state, any: liveAny(s) });
    el.hidden = false;
    if (html !== liveDrawn) { el.innerHTML = html; liveDrawn = html; }
    liveTargetNow = t;
  }
  // a line to the game; its answer in the status line (what it did shows in the trails and the buttons, as the game says)
  async function liveSend(verb, a, b, c) {
    let line;
    try { line = liveCommand(verb, a, b, c); } catch (e) { status(e.message, 'warn'); return; }
    try {
      const answer = await live(line);
      status(answer);
      const e = liveAnswered(verb, a, b, answer);       // the buttons at once, before the game's log says it
      if (e) { liveRead(book, { ...e, map: book.last || sideMap() }); liveBar(); }
      if (verb !== 'paused') setTimeout(askPaused, 350);  // did a rule pause the game? (its break line comes later)
    } catch (e) { status('The game did not get it: ' + (e.message || e), 'warn'); }
  }
  // "deusedix paused", unseen in the Console: whether a rule holds the game, and where, as the break line would say
  let asking = false;
  async function askPaused() {
    if (!live || !playing || asking) return;
    asking = true;
    try {
      const p = pausedAnswer(await live('deusedix paused', { quiet: true }));
      const s = liveNow(), map = book.last || sideMap();
      if (p && p.at && (!s.paused || String(s.paused.rule).toLowerCase() !== p.at.rule.toLowerCase() || s.paused.step !== p.at.step)) {
        const was = s.paused;
        liveRead(book, { kind: 'break', map, rule: p.at.rule, why: p.at.why, step: p.at.step === null ? '' : String(p.at.step) });
        liveBar();
        if (!was) heldInSight(p.at.rule);
      } else if (p && !p.paused && s.paused) { liveRead(book, { kind: 'live', map, rule: '', verb: 'resumed', detail: '' }); liveBar(); }
    } catch { /* the game is closing: its log says the rest */ }
    asking = false;
  }
  // every second while a rule may pause the game (Pause here or Step on), or holds it
  setInterval(() => { const s = liveNow(); if (playing && live && (s.paused || s.breaks.size || s.stepping.size)) askPaused(); }, 1000);
  // the game just paused at a rule of this map: its card in sight and chosen (the bar's Step is about it)
  function heldInSight(rule, went = false) {
    if (view !== 'graph') return;
    const id = graph.nodes.find((n) => n.kind === 'rule' && String(n.rule).toLowerCase() === String(rule).toLowerCase())?.id;
    if (id) { picked = { nodes: [id], wires: [] }; canvas.select({ nodes: [id] }); canvas.reveal([id]); canvas.flash?.([id]); liveBar(); crumb(); return; }
    // in a block: into it, then the card
    const inside = !went && boxOfRule(shownBoxes(), rule);
    if (inside) { boxAt = inside; picked = null; renaming = null; Promise.resolve(draw()).then(() => heldInSight(rule, true)); }
  }
  // M and F9 on a rule in the graph: mute it, or pause the game on it, while playing
  function liveToggle(what, sel) {
    if (!live || !playing) {
      status(what === 'mute' ? 'Mute works while playing: Play the map, then select a rule and press M.'
        : 'Pause here works while playing: Play the map, then select a rule and press F9.', 'warn');
      return;
    }
    const rule = ruleOf(sel || picked);
    if (!rule) { status('Select a rule first.', 'warn'); return; }
    const f = ruleLive(liveNow(), rule.id);
    liveSend(what, rule.id, !(what === 'mute' ? f.muted : f.breaks));
  }
  $('.lw-live').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-live]');
    if (!b) return;
    const s = liveNow(), t = liveTargetNow, verb = b.dataset.live;
    if (verb === 'step') { if (s.paused) liveSend('step', s.paused.rule); return; }
    if (verb === 'continue' || verb === 'clear') { liveSend(verb); return; }
    if (verb === 'happen') { const f = $('.lw-lhappen'); if (t.happen && f) liveSend('happen', t.happen.object, f.value); return; }
    if (verb === 'set') {
      const f = $('.lw-lvalue');
      if (t.state && f) liveSend('set', t.state.name, f.tagName === 'SELECT' ? f.value === '1' : f.value.trim());
      return;
    }
    if (!t.rule) return;
    if (verb === 'fire') { liveSend('fire', t.rule.id); return; }
    const f = ruleLive(s, t.rule.id);
    liveSend(verb, t.rule.id, !{ mute: f.muted, trace: f.traced, break: f.breaks }[verb]);
  });
  $('.lw-live').addEventListener('keydown', (ev) => {
    ev.stopPropagation();                          // typed here, not the editor's keys
    if (ev.key === 'Enter' && ev.target.matches('input.lw-lvalue')) { ev.preventDefault(); $('.lw-live [data-live=set]')?.click(); }
  });
  window.addEventListener('deusedix:play-state', (e) => {
    const now = !!(e.detail && e.detail.active);
    if (now && !playing) book = liveBook();       // a new Play: the game was told nothing yet
    const was = playing;
    playing = now;
    liveBar();
    if (was !== now && view === 'phases') soon();  // its Go here now buttons
  });
  trails?.subscribe(({ added }) => {
    let any = false, held = null;
    for (const x of added || []) {
      if (!x.live) continue;
      const before = liveNow().paused;
      liveRead(book, x.entry);
      any = any || x.entry.kind === 'live' || x.entry.kind === 'break';
      if (x.entry.kind === 'break' && !before && sameMap(x.entry.map, sideMap())) held = x.entry.rule;
    }
    if (any) liveBar();
    if (held) heldInSight(held);
  });

  // ---- your own blocks (P8, logic-boxes.js): rules and logic pieces in a box, drawn as one node with the wires that
  // cross its edge as its ports; opened, a level of the graph of its own. Only a way of looking: the game runs the rules
  // as before. boxAt: the block the graph shows (null: the map), boxPending: what to select once it is drawn,
  // renaming: the name being typed over the graph ({kind: 'box' | 'port', id, key, value})
  let boxAt = null, boxPending = null, renaming = null, crumbText = '', crumbDrawn = '';
  const boxList = () => boxesOf(sideOf && sideOf.ix.edits);         // the map's own: the ones saved
  // with the patterns placed in the map (logic-patterns.js instanceBoxes): blocks too, read-only
  let patternsTop = {};                                // the project's patterns: slug -> its newest version
  const allBoxes = (edits) => [...boxesOf(edits), ...instanceBoxes(edits, patternsTop)];
  const shownBoxes = () => allBoxes(sideOf && sideOf.ix.edits);
  const instanceOf = (id) => (shownBoxes().find((b) => b.id === id) || {}).instance || null;
  const boxPicked = (sel = picked) => { const id = ((sel && sel.nodes) || []).find((n) => String(n).startsWith(BOX)); return id ? String(id).slice(BOX.length) : null; };
  const portPicked = (sel = picked) => { const id = ((sel && sel.nodes) || []).find((n) => String(n).startsWith(PORT)); return id ? String(id).slice(PORT.length) : null; };
  const boxLinks = () => (sideOf && sideOf.ix.edits.links) || [];
  const proposing = () => !!(proposal && proposal());
  // the list of blocks changed, one undoable step (app.js); `then`: selected once drawn
  function saveBoxes(label, list, then = null) {
    if (!boxes) return false;
    if (proposing()) { status('Answer the assistant\'s proposal first.', 'warn'); return false; }
    boxPending = then;
    boxes(label, list);
    return true;
  }
  const count = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  function makeBlock(sel = picked) {
    if (view !== 'graph' || !boxes) return;
    const m = selectionMembers(sel, graph, boxLinks());
    if ((boxAt && instanceOf(boxAt)) || m.boxes.some((b) => instanceOf(b)) || m.rules.some((r) => (sideOf.ix.edits.links || []).some((l) => l.id === r && l.instance))) {
      status('A placed pattern is the pattern\'s: Unpack it first to put its rules in a block of the map.', 'warn'); return;
    }
    let made;
    try { made = makeBox(boxList(), m, { at: boxAt }); } catch (e) { status(e.message, 'warn'); return; }
    const b = made.boxes.find((x) => x.id === made.id);
    const what = [m.rules.length && count(m.rules.length, 'rule'), m.pieces.length && count(m.pieces.length, 'logic block'),
      m.boxes.length && count(m.boxes.length, 'block')].filter(Boolean).join(', ');
    if (saveBoxes(`Make the block "${b.name}"`, made.boxes, { nodes: [BOX + made.id] })) {
      status(`"${b.name}" holds ${what}. Double-click it to go in, F2 to name it. The game runs the rules as before.`);
    }
  }
  function openBox(id) {
    if (!shownBoxes().some((b) => b.id === id)) return;
    boxAt = id; picked = null; renaming = null; view = 'graph'; tabs(); draw();
  }
  // one level up (Esc, a port's double click): the block one was in, selected
  function boxUp() {
    if (!boxAt) return false;
    const was = boxAt;
    boxAt = (shownBoxes().find((b) => b.id === was) || {}).parent || null;
    boxPending = { nodes: [BOX + was] }; picked = null; renaming = null; draw();
    return true;
  }
  function renameStart(sel = picked) {
    const b = boxPicked(sel), port = !b && boxAt ? portPicked(sel) : null;
    if ((b && instanceOf(b)) || (port && instanceOf(boxAt))) { status('A placed pattern keeps the names of its pattern: Unpack it to change them.', 'warn'); return; }
    const list = boxList();
    if (b) renaming = { kind: 'box', id: b, value: (list.find((x) => x.id === b) || {}).name || '' };
    else if (port) renaming = { kind: 'port', id: boxAt, key: port, value: (graph.ports || []).find((p) => p.key === port && p.box === boxAt)?.name || '' };
    else { status('F2 renames a block or, inside one, a port: select it first.', 'warn'); return; }
    crumb();
  }
  function renameDone(value) {
    const r = renaming;
    renaming = null;
    if (!r) return;
    const t = String(value || '').trim();
    if (r.kind === 'pattern') { crumb(); if (t) savePattern(r.id, t); return; }
    if (r.kind === 'script') { crumb(); if (t) turnIntoScript(r.rules, t); return; }
    if (t === r.value) { crumb(); return; }
    try {
      if (r.kind === 'box') saveBoxes(`Rename the block "${r.value}"`, renameBox(boxList(), r.id, t), { nodes: [BOX + r.id] });
      else saveBoxes(t ? `Name the port "${t}"` : 'Give the port back its words', renamePort(boxList(), r.id, r.key, t), { nodes: [PORT + r.key] });
    } catch (e) { status(e.message, 'warn'); }
    crumb();
  }
  // ---- Turn into script (P8 slice 6, rulescript.py): the rules picked, and those inside the blocks picked
  function scriptRules(m) {
    const ids = new Set(m.rules);
    const list = shownBoxes();
    for (const id of m.boxes) for (const r of rulesInside(list, id)) ids.add(r);
    const b = boxPicked();
    if (b && !instanceOf(b)) for (const r of rulesInside(list, b)) ids.add(r);
    return [...ids];
  }
  // the one object picked, when it is a script made by Turn into script
  function scriptObject() {
    const id = ((picked && picked.nodes) || [])[0];
    if (!id || !String(id).startsWith('obj:')) return '';
    const n = (graph.nodes.find((x) => x.id === id) || {}).name || String(id).slice(4);
    return n && scripts.does(n).length ? n : '';
  }
  async function scriptStart() {
    if (proposing()) { status('Answer the assistant\'s proposal first.', 'warn'); return; }
    const rules = scriptRules(selectionMembers(picked, graph, boxLinks()));
    if (!rules.length) return;
    let value = 'RulesScript';
    try { value = await scripts.freeName(); } catch (e) { /* the default name */ }
    renaming = { kind: 'script', rules, value };
    crumb();
  }
  async function turnIntoScript(rules, name) {
    status(`Writing the script ${name}…`);
    try {
      const r = await scripts.turn(rules, name);
      const no = (r.refused || []).map((x) => `${x.id}: ${x.why}`).join('; ');
      if (r.error) { status(r.error, 'warn'); return; }
      if (!(r.rules || []).length) { status(`No rule could be turned into a script${no ? ' (' + no + ')' : ''}.`, 'warn'); return; }
      status(`The script ${r.name} does what ${r.rules.length === 1 ? 'the rule' : r.rules.length + ' rules'} did: change it in Tools > Scripts (Ctrl+Z takes the map back).${no ? ' Left as rules: ' + no + '.' : ''}`, no ? 'warn' : 'ok');
    } catch (e) { status('The script could not be made: ' + (e.message || e), 'warn'); }
  }
  function scriptBack() {
    const n = scriptObject();
    if (!n) return;
    if (proposing()) { status('Answer the assistant\'s proposal first.', 'warn'); return; }
    const k = scripts.back(n);
    status(`${k} rule${k === 1 ? '' : 's'} back as ${k === 1 ? 'it was' : 'they were'} (Ctrl+Z takes it back); the script stays in Tools > Scripts.`, 'ok');
  }
  // a block kept as a pattern of the project (a new version when one of that name is there)
  async function savePattern(id, name) {
    if (!patterns || !sideOf) return;
    const ix = sideOf.ix, list = boxList();
    let version;
    try {
      const states = [...ix.states.values()].map((s) => ({ name: s.name, type: s.type, rules: [...s.setters, ...s.readers].map((u) => u.rule).filter(Boolean) }));
      const nouns = Object.fromEntries(sideOf.whole.nodes.filter((n) => String(n.id).startsWith('obj:') && n.word).map((n) => [n.name, n.word]));
      version = patternOf({ edits: ix.edits, boxes: list, id, actors: ix.actors, nouns, ports: boxedView(sideOf.whole, list, id).ports, states });
    } catch (e) { status(e.message, 'warn'); return; }
    delete version.was;
    status(`Saving the pattern "${name}"…`);
    try {
      const kept = await patterns.save(name, version);
      status(`Saved as the pattern "${kept.name}"${kept.v > 1 ? `, version ${kept.v}` : ''}: ${patternWords(version)}.`, 'ok');
      refreshTop();
    } catch (e) { status('The pattern could not be saved: ' + (e.message || e), 'warn'); }
  }
  function unpack(id) {
    const b = boxList().find((x) => x.id === id);
    if (!b) return;
    if (saveBoxes(`Unpack the block "${b.name}"`, unpackBox(boxList(), id))) status(`"${b.name}" is gone: its rules are where they were.`);
  }
  // ---- the project's patterns placed here (P8 slice 3): the Patterns panel lists them, Place... asks for the map's
  // objects for its places (slots), the instance a block of the graph
  let patsList = null, patsChoosing = null, patsObjects = new Map();
  let updating = null;                                 // an Update asked: {id, v, words}, to confirm over the graph
  async function refreshTop() {
    if (!patterns || !patterns.list) return;
    try {
      patsList = await patterns.list();
      const top = Object.fromEntries(patsList.map((x) => [x.slug, x.v]));
      if (JSON.stringify(top) !== JSON.stringify(patternsTop)) { patternsTop = top; draw(); }
    } catch (e) { patsList = []; }
  }
  const objectsFor = async (family) => {
    const key = family || '';
    if (!patsObjects.has(key)) patsObjects.set(key, await patterns.objects(family));
    return patsObjects.get(key);
  };
  async function patsShow(open = true) {
    const el = $('.lw-pats');
    if (!open) { el.hidden = true; patsChoosing = null; return; }
    el.hidden = false;
    if (!patsList) el.innerHTML = '<p class="lw-whynote">Looking for the project\'s patterns…</p>';
    patsObjects = new Map();
    await refreshTop();
    await patsDraw();
  }
  async function patsDraw() {
    const el = $('.lw-pats'), out = ['<div class="lw-whyhead"><b>Patterns of the project</b>'
      + '<button type="button" class="lw-whyclose" data-pat="close" title="Close (Esc)" aria-label="Close">×</button></div>'];
    if (!patsList || !patsList.length) out.push('<p class="lw-whynote">No patterns yet. Select rules in the graph, Ctrl+G puts them in a block, then Save as pattern… keeps it for any map.</p>');
    if ((patsList || []).some((x) => x.shipped) && patterns.example)      // the library's, at work in an example map (P8)
      out.push('<p class="lw-whynote lw-patlab">The patterns that come with DeusEdix are at work in the Logic Lab map, one in each room. '
        + '<button type="button" data-pat="lab" title="Open the Logic Lab map (added to the project\'s maps the first time)">Open the Logic Lab</button></p>');
    for (const x of patsList || []) {
      const open = patsChoosing === x.slug, wanted = x.slots.filter((sl) => !sl.carried), brings = x.slots.filter((sl) => sl.carried);
      out.push(`<section class="lw-pat${open ? ' open' : ''}" data-slug="${esc(x.slug)}"><h4><span>${esc(x.name)}</span>`
        + `<span class="lw-patv">version ${x.v} · ${count(x.rules, 'rule')}${x.shipped ? ' · comes with DeusEdix' : ''}</span>`
        + (open ? '' : '<button type="button" data-pat="choose" title="Place it in this map: choose the objects it acts on">Place…</button>') + '</h4>');
      if (!open) out.push(`<p class="lw-whynote">${wanted.length ? 'Acts on ' + esc(wanted.map((sl) => sl.words).join(', ')) : 'Acts on nothing of the map'}${brings.length ? '; brings ' + esc(brings.map((sl) => sl.words).join(', ')) : ''}.</p>`);
      else {
        let first = true;
        for (const sl of wanted) {
          const objs = await objectsFor(sl.family);
          const pre = first && objs.some((o) => o.name === focusName && o.fits !== false) ? focusName : '';
          first = false;
          const opt = (o) => `<option value="${esc(o.name)}"${o.name === pre ? ' selected' : ''}>${esc(o.label)}${o.label !== o.name ? ` (${esc(o.name)})` : ''}</option>`;
          const fits = objs.filter((o) => o.fits !== false), rest = objs.filter((o) => o.fits === false);
          out.push(`<label class="lw-patslot"><span>${esc(capital(sl.words))}</span><select data-slot="${esc(sl.id)}">`
            + `<option value="">(none: its rules wait for one)</option>`
            + (rest.length && fits.length ? `<optgroup label="Of the same kind as ${esc(sl.words)}">${fits.map(opt).join('')}</optgroup>` : fits.map(opt).join(''))
            + (rest.length ? `<optgroup label="Other objects (its rules may not fit them)">${rest.map(opt).join('')}</optgroup>` : '')
            + '</select><button type="button" data-pat="mine" title="The object selected in the 3D view or the graph">Use selected</button></label>');
        }
        if (brings.length) out.push(`<p class="lw-whynote">It brings ${esc(brings.map((sl) => sl.words).join(', '))}: made next to the first object chosen.</p>`);
        out.push('<div class="lw-pbtns"><button type="button" class="primary" data-pat="place" title="One step: Ctrl+Z takes it back">Place</button>'
          + '<button type="button" data-pat="cancel">Cancel</button></div>');
      }
      out.push('</section>');
    }
    el.innerHTML = out.join('');
    el.querySelector('select')?.focus();
  }
  async function placeChosen() {
    const sec = $(`.lw-pats .lw-pat[data-slug="${patsChoosing}"]`);
    if (!sec || !patterns.place) return;
    const chosen = Object.fromEntries([...sec.querySelectorAll('select[data-slot]')].map((x) => [x.dataset.slot, x.value]).filter(([, v]) => v));
    const x = (patsList || []).find((p) => p.slug === patsChoosing);
    try {
      boxPending = null;
      const done = await patterns.place(patsChoosing, chosen);
      patsShow(false);
      scope = 'map'; boxAt = null; view = 'graph'; tabs();
      boxPending = { nodes: [BOX + done.id] };
      const empty = ((x && x.slots) || []).filter((sl) => !sl.carried && !chosen[sl.id]).length;
      status(`Placed "${done.name}": its rules run in the game as the map's own${empty ? `, but ${count(empty, 'place')} left empty wait for an object` : ''}. Open its block to see them; Unpack makes them the map's to change.`, 'ok');
      draw();
    } catch (e) { status('The pattern could not be placed: ' + (e.message || e), 'warn'); }
  }
  function unplace(id, how) {
    const b = shownBoxes().find((x) => x.id === id);
    if (!b || !patterns.unplace) return;
    if (proposing()) { status('Answer the assistant\'s proposal first.', 'warn'); return; }
    if (boxAt === id) boxAt = null;
    patterns.unplace(id, how);
    status(how === 'keep' ? `"${b.name}" is unpacked: its rules are the map's own now, to change here.` : `"${b.name}" is taken away: its rules are gone, the objects it brought are still in the map.`);
  }
  // Update: first what it changes, in words, over the graph; then, confirmed, the change
  async function updatePlaced(id, sure = false) {
    if (!patterns.update) return;
    try {
      if (!sure && patterns.changes) {
        const c = await patterns.changes(id);
        if (!c) return;
        if (c.same) { status('It already uses the newest version.', 'ok'); return; }
        updating = { id, v: c.v, words: c.words }; crumb();
        return;
      }
      updating = null;
      const r = await patterns.update(id);
      if (r) status(r.same ? 'It already uses the newest version.' : `Now on version ${r.v} of the pattern${r.words ? ': ' + r.words : ''}.`, 'ok');
      crumb();
    } catch (e) { updating = null; crumb(); status('The pattern could not be updated: ' + (e.message || e), 'warn'); }
  }
  if (!patterns || !patterns.list) $('.lw-patsbtn').remove();
  else {
    $('.lw-patsbtn').addEventListener('click', () => patsShow($('.lw-pats').hidden));
    $('.lw-pats').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-pat]');
      if (!b) return;
      const what = b.dataset.pat;
      if (what === 'close') patsShow(false);
      else if (what === 'choose') { patsChoosing = b.closest('.lw-pat').dataset.slug; patsDraw(); }
      else if (what === 'cancel') { patsChoosing = null; patsDraw(); }
      else if (what === 'place') placeChosen();
      else if (what === 'lab') patterns.example('logic_lab').catch((e) => status('The Logic Lab could not be opened: ' + (e.message || e), 'warn'));
      else if (what === 'mine') {
        const field = b.closest('.lw-patslot').querySelector('select');
        if (focusName && [...field.options].some((o) => o.value === focusName)) field.value = focusName;
        else status('Select an object of the map first (in the 3D view or the graph), then press Use selected.', 'warn');
      }
    });
    $('.lw-pats').addEventListener('keydown', (ev) => {
      ev.stopPropagation();                        // its fields, not the editor's keys
      if (ev.key === 'Escape') { ev.preventDefault(); if (patsChoosing) { patsChoosing = null; patsDraw(); } else patsShow(false); }
    });
    refreshTop();
  }
  // the bar over the graph: where one is (the blocks one is in go back up), what the selection can do with blocks, or
  // the name being typed
  function crumb() {
    const el = $('.lw-crumb');
    if (view !== 'graph') { el.hidden = true; return; }
    el.hidden = false;
    const list = shownBoxes(), out = [];
    if (boxAt) {
      const path = boxPath(list, boxAt);
      out.push(path.map((p, i) => (i === path.length - 1 ? `<b>${esc(p.name)}</b>`
        : `<button type="button" data-box="${esc(p.id || '')}" title="Back to ${esc(p.name)} (Esc goes up one level)">${esc(p.name)}</button>`)).join('<span class="lw-csep">›</span>'));
    } else out.push(`<span class="lw-ctext">${esc(crumbText)}</span>`);
    if (updating && boxPicked() !== updating.id) updating = null;
    if (updating) {
      out.push(`<span class="lw-ctext">Version ${updating.v}: ${esc(updating.words)}.</span>`,
        '<span class="lw-boxacts"><button type="button" data-bx="update-yes" title="One step: Ctrl+Z takes it back">Update</button>'
        + '<button type="button" data-bx="update-no">Not now</button></span>');
    } else if (renaming) {
      const what = { box: 'The block\'s name', port: 'The port\'s name', pattern: 'The pattern\'s name', script: 'The script\'s name' }[renaming.kind];
      if (renaming.kind === 'pattern') out.push('<span class="lw-ctext">Save as pattern:</span>');
      if (renaming.kind === 'script') out.push(`<span class="lw-ctext">Turn ${renaming.rules.length === 1 ? 'the rule' : 'the ' + renaming.rules.length + ' rules'} into the script (the window then shows a script, not what ${renaming.rules.length === 1 ? 'it does' : 'they do'}; Back to rules undoes it):</span>`);
      out.push(`<input class="lw-boxname" type="text" spellcheck="false" value="${esc(renaming.value)}" aria-label="${what}"`
        + ` placeholder="${renaming.kind === 'port' ? 'its words (empty: the pin\'s own)' : 'a name'}" title="${renaming.kind === 'pattern'
          ? 'Enter to save it (a pattern of the same name gets a new version), Esc to leave it' : renaming.kind === 'script'
            ? 'Enter to make the script (letters, digits and _), Esc to leave the rules as they are' : 'Enter to keep it, Esc to leave it as it was'}">`);
    } else if (boxes && !proposing()) {
      const b = boxPicked(), port = boxAt ? portPicked() : null, one = ((picked && picked.nodes) || []).length + ((picked && picked.wires) || []).length === 1;
      const m = selectionMembers(picked, graph, boxLinks()), any = m.rules.length + m.pieces.length + m.boxes.length;
      const acts = [];
      const inst = b && one ? instanceOf(b) : null;
      if (inst) {
        acts.push('<button type="button" data-bx="open" title="See the rules it writes (double-click, Enter)">Open</button>');
        if (inst.newest) acts.push(`<button type="button" data-bx="update" title="Use the newest version of the pattern: what it does then is what was last saved">Update to version ${inst.newest}</button>`);
        acts.push('<button type="button" data-bx="keep" title="Make its rules the map\'s own, to change them here: the pattern no longer updates them">Unpack</button>',
          '<button type="button" data-bx="drop" title="Take the pattern away: its rules go, the objects it brought stay">Remove</button>');
      } else if (b && one) {
        acts.push('<button type="button" data-bx="open" title="Go into the block (double-click, Enter, Ctrl+Shift+G)">Open</button>',
          '<button type="button" data-bx="rename" title="Name the block (F2)">Rename</button>',
          '<button type="button" data-bx="unpack" title="Take the block away: its rules stay as they are">Unpack</button>');
        if (patterns) acts.push('<button type="button" data-bx="pattern" title="Keep this block in the project\'s patterns, to place it again in this map or another: the objects its rules name become places to fill">Save as pattern…</button>');
      } else if (port && one) acts.push('<button type="button" data-bx="rename" title="Name this port: how the block\'s node calls it outside (F2)">Rename</button>');
      const toScript = scripts && !inst ? scriptRules(m) : [];
      if (toScript.length) acts.push(`<button type="button" data-bx="script" title="Write ${toScript.length === 1 ? 'this rule' : 'these ' + toScript.length + ' rules'} as a script of Tools &gt; Scripts, to change in code: each cause stays a rule that calls it">Turn into script…</button>`);
      const obj = scripts && one ? scriptObject() : '';
      if (obj) acts.push(`<button type="button" data-bx="back" title="The rules this script does put back as they were: its object and the rules that call it go (the script stays in Tools &gt; Scripts)">Back to rules</button>`);
      if (any && !(b && one)) acts.push(`<button type="button" data-bx="make" title="Put the selected rules and logic blocks in a block of their own: one node, the wires that cross it its ports (Ctrl+G). The game runs them as before.">Make a block</button>`);
      if (acts.length) out.push(`<span class="lw-boxacts">${acts.join('')}</span>`);
    }
    const html = out.join('');
    el.classList.toggle('lw-crumbin', !!boxAt || html.includes('<button') || !!renaming || !!updating);
    if (html === crumbDrawn) return;
    el.innerHTML = html; crumbDrawn = html;
    const f = el.querySelector('.lw-boxname');
    if (f) { f.focus(); f.select(); }
  }
  $('.lw-crumb').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.box !== undefined) { boxAt = b.dataset.box || null; picked = null; renaming = null; draw(); return; }
    const id = boxPicked();
    if (b.dataset.bx === 'open' && id) openBox(id);
    else if (b.dataset.bx === 'rename') renameStart();
    else if (b.dataset.bx === 'unpack' && id) unpack(id);
    else if ((b.dataset.bx === 'keep' || b.dataset.bx === 'drop') && id) unplace(id, b.dataset.bx);
    else if (b.dataset.bx === 'update' && id) updatePlaced(id);
    else if (b.dataset.bx === 'update-yes' && updating) updatePlaced(updating.id, true);
    else if (b.dataset.bx === 'update-no') { updating = null; crumb(); }
    else if (b.dataset.bx === 'make') makeBlock();
    else if (b.dataset.bx === 'script') scriptStart();
    else if (b.dataset.bx === 'back') scriptBack();
    else if (b.dataset.bx === 'pattern' && id) { renaming = { kind: 'pattern', id, value: (boxList().find((x) => x.id === id) || {}).name || '' }; crumb(); }
  });
  $('.lw-crumb').addEventListener('keydown', (ev) => {
    if (!ev.target.matches('.lw-boxname')) return;
    ev.stopPropagation();                          // typed here, not the editor's keys
    if (ev.key === 'Enter') { ev.preventDefault(); renameDone(ev.target.value); canvasFocus(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); renaming = null; crumb(); canvasFocus(); }
  });
  $('.lw-crumb').addEventListener('focusout', (ev) => { if (ev.target.matches('.lw-boxname') && renaming) renameDone(ev.target.value); });
  const canvasFocus = () => $('.lw-graph .gc')?.focus?.();
  // Esc with nothing selected: one level up
  $('.lw-graph').addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && boxAt && !ev.defaultPrevented && !renaming) { ev.stopPropagation(); ev.preventDefault(); boxUp(); }
  });

  function sideHtml(sections) {
    const now = focusState ? 'state:' + focusState : scope === 'chain' && focusName ? 'thing:' + thingId(focusName) : '';
    const pin = (r) => (r.pin ? `<b class="lw-pin${r.pin.on ? ' on' : ''}" data-pin="${esc(r.pin.name)}" role="switch" aria-checked="${r.pin.on}"`
      + ` aria-label="Watch ${esc(r.pin.name)} while playing">${editorIcon('pin', 12)}</b>` : '');
    return sections.map((s) => `<section><h4>${esc(s.title)}<span>${s.rows.length}</span></h4>`
      + s.rows.slice(0, 200).map((r) => `<button type="button" data-key="${esc(r.key)}" class="${r.tone || ''}${r.key === now ? ' on' : ''}${r.age !== undefined ? ' fresh' : ''}"`
        + `${r.age !== undefined ? ` style="--age:-${r.age.toFixed(2)}s"` : ''}`
        + ` title="${esc(r.title || r.text)}">${pin(r)}<span>${esc(r.text)}</span>${r.note ? `<i>${esc(r.note)}</i>` : ''}</button>`).join('')
      + (s.id === 'states' && watch ? WATCH_FIELD : '')
      + '</section>').join('') || '<p class="hint">No rules on this map yet.</p>';
  }
  // a state or counter no rule of the map uses (the map's own scripts', another map's) watched by its name
  const WATCH_FIELD = '<input class="lw-watchadd" type="text" spellcheck="false" placeholder="Watch another by name…"'
    + ' aria-label="Watch a state or counter by its name while playing"'
    + ' title="Type the name of a state or counter (as the game names it) and press Enter: it is watched while playing">';
  // the start value of the state shown (P5): drawn again only when it changed, so a number being typed stays
  let barDrawn = '';
  function startBar(ix) {
    const el = $('.lw-startbar');
    if (!focusState || !startValue) { el.hidden = true; barDrawn = ''; return; }
    const s = [...ix.states.values()].find((x) => x.name.toLowerCase() === focusState.toLowerCase());
    const html = startBarHtml(focusState, s ? s.type : '', startOf(ix.edits, focusState));
    el.hidden = false;
    if (html !== barDrawn) { el.innerHTML = html; barDrawn = html; }
  }
  $('.lw-startbar').addEventListener('change', (ev) => {
    const f = ev.target.closest('.lw-startval');
    if (!f || !focusState || !startValue) return;
    const raw = f.value.trim();
    if (f.tagName === 'SELECT') startValue(focusState, raw === '' ? undefined : raw === '1');
    else if (raw === '') startValue(focusState, undefined);
    else if (/^-?\d+$/.test(raw) && Math.abs(+raw) < 2 ** 31) startValue(focusState, +raw);
    else { status('A counter starts at a whole number.', 'warn'); barDrawn = ''; soon(); }
  });
  $('.lw-startbar').addEventListener('keydown', (ev) => {
    ev.stopPropagation();                          // typed here, not the editor's keys
    if (ev.key === 'Enter' && ev.target.matches('input.lw-startval')) ev.target.blur();
  });
  // the list at the side, with what the game says the watched states hold now (or at the timeline's place)
  const looked = new Set(), fresh = new Map();
  let sideOf = null, sideDrawn = '';
  const sideMap = () => (sideOf ? sideOf.ix.input.map || '' : mapNow());
  function renderSide() {
    if (!sideOf) return;
    const at = performance.now(), ages = new Map();
    for (const [k, t] of fresh) { const age = (at - t) / 1000; if (age < FRESH_SECS) ages.set(k, age); else fresh.delete(k); }
    const values = trails ? trailMarks(trails.lines(sideMap()), { rules: [] }, tl.at).states : null;
    index = indexOf(sideOf.ix, sideOf.whole, sideOf.problems, { values, fresh: ages });
    const html = sideHtml(index);
    if (html === sideDrawn) return;
    // drawn again while a name is being typed in the field: the field keeps it, and the caret
    const typing = document.activeElement && document.activeElement.classList.contains('lw-watchadd') && root.contains(document.activeElement)
      ? { value: document.activeElement.value, at: document.activeElement.selectionStart } : null;
    $('.lw-side').innerHTML = html; sideDrawn = html;
    const field = typing && $('.lw-side .lw-watchadd');
    if (field) { field.value = typing.value; field.focus(); field.setSelectionRange(typing.at, typing.at); }
  }
  async function draw() {
    if (busy) { again = true; return busy; }
    busy = (async () => {
      try {
        // the assistant's proposal, when one waits: its rules drawn instead of the map's, with the bar to answer it
        const q = proposal ? proposal() : null, bar = $('.lw-propose');
        const ix = logicIndex(q ? q.input : await input());
        bar.hidden = !q;
        if (q && bar.dataset.id !== String(q.id)) { bar.dataset.id = String(q.id); bar.innerHTML = proposalHtml(q); }
        if (!q) delete bar.dataset.id;
        const problems = logicProblems(ix);
        const byNode = problemsByNode(problems);
        root.dataset.view = view;
        if (view !== 'graph' || !focusState || q) { $('.lw-startbar').hidden = true; barDrawn = ''; }
        $('.lw-graph').hidden = view !== 'graph';
        $('.lw-read').hidden = view !== 'read';
        $('.lw-phases').hidden = view !== 'phases';
        $('.lw-list').hidden = view !== 'list';
        $('.lw-try').hidden = view !== 'try';
        $('.lw-story').hidden = view !== 'story';
        if (view !== 'story') { closeStory(); storyAt = null; }
        $('.lw-side').hidden = view === 'try' || view === 'story';
        $('.lw-trail').hidden = view !== 'graph' || !trails || !!q;
        for (const el of root.querySelectorAll('.lw-scope, .lw-fit, .lw-div, .lw-patsbtn')) el.hidden = view !== 'graph';
        if (view !== 'graph') $('.lw-pats').hidden = true;
        const whyBtn = $('.lw-whybtn');
        if (whyBtn) whyBtn.hidden = view === 'try' || view === 'story';     // Try it has its own, for its session
        const count = ix.rules.length, check = problems.filter((p) => p.level !== 'info').length;
        $('.lw-info').textContent = `${count} rule${count === 1 ? '' : 's'}${check ? ` · ${check} to check` : ''}`;
        $('.lw-info').classList.toggle('warn', check > 0);
        // the map's blocks (P8): their rules always cards (a simple rule's wire would cross a block's edge)
        const bl = allBoxes(ix.edits);
        if (boxAt && !bl.some((b) => b.id === boxAt)) boxAt = null;
        const whole = logicGraph(ix, { open: [...boxedRules(bl)] });
        sideOf = { ix, whole, problems };
        index = indexOf(ix, whole, problems);
        liveBar();
        if (view === 'list') {                     // drawn again when its rules change or another thing is chosen
          renderSide(); $('.lw-crumb').hidden = true;
          const mine = (l) => (focusName ? l.src === focusName : !l.src);
          const rules = (ix.edits.links || []).filter((l) => mine(l) || (l.otherwiseOf && (ix.edits.links || []).some((m) => m.id === l.otherwiseOf && mine(m))));
          const sig = JSON.stringify([focusName, rules]);
          if (sig !== listSig && listView) { listSig = sig; const rule = listRule; listRule = null; await listView($('.lw-list'), focusName, rule); }
          return;
        }
        if (view === 'read') { $('.lw-read').innerHTML = readHtml(readView(ix)); renderSide(); $('.lw-crumb').hidden = true; return; }
        if (view === 'try') { $('.lw-crumb').hidden = true; await tryPanel.show(); return; }
        if (view === 'story') { $('.lw-crumb').hidden = true; await showStory(); return; }
        if (view === 'phases') {
          $('.lw-phases').innerHTML = phasesHtml(phasesPage(ix, await phases()), { live: !!live && playing });
          renderSide(); $('.lw-crumb').hidden = true;
          return;
        }
        const rootId = focusName ? thingId(focusName) : null;
        const chain = scope === 'chain' && rootId && whole.nodes.some((n) => n.id === rootId);
        // inside a block: all it holds, its ports at its edges; else the scope chosen, its blocks one node each
        graph = boxAt ? boxedView(whole, bl, boxAt)
          : boxedView(focusState ? scopeOf(whole, { kind: 'state', state: focusState }, { ix })
            : chain ? scopeOf(whole, { kind: 'chain', root: rootId }, { ix }) : scopeOf(whole, { kind: 'map' }, { ix, limit: 400 }), bl, null);
        renderSide();
        // where one is: what the graph shows now, in words
        const named = chain ? whole.nodes.find((n) => n.id === rootId) : null;
        startBar(ix);
        crumbText = focusState ? `The rules that set or read ${focusState}`
          : named && named.kind === 'signal' ? `The signal "${named.label}": the rules that send it and those that wait for it`
          : named ? `${named.label || named.name}: what sets its rules off and what they do`
            : scope === 'chain' ? 'Nothing selected has rules: the whole map' : 'The whole map';
        crumb();
        const shown = canvasOf(graph, byNode, (name) => {
          const a = ix.actors[name];
          return a && a.cls ? 'cls:' + a.cls : '';
        });
        markShown(shown, q, ix);
        base = q ? null : { shown: structuredClone(shown), ix, graph };
        if (base) trailOn(shown);
        const key = JSON.stringify(shown);
        if (key !== drawn) {
          canvas.set(shown); drawn = key;
          // other things shown (another chain, the whole map, a first draw): fitted, after the canvas has its size
          const ids = shown.nodes.map((n) => n.id).sort().join('\n');
          if (ids !== fitted) { fitted = ids; requestAnimationFrame(() => canvas.fit()); }
        }
        // a block just made, renamed or left: selected (the bar's Open, Rename and Unpack are about it)
        if (boxPending) {
          const sel = { nodes: boxPending.nodes.filter((id) => shown.nodes.some((n) => n.id === id)), wires: [] };
          boxPending = null;
          if (sel.nodes.length) requestAnimationFrame(() => { canvas.select(sel); canvas.reveal(sel.nodes); picked = sel; crumb(); liveBar(); });
        }
        if (graph.hidden) $('.lw-info').textContent += ` · ${graph.hidden} more not shown`;
        strip();
        liveBar();
      } catch (e) {
        status('Logic window: ' + (e.message || e), 'warn');
      }
    })();
    try { await busy; } finally { busy = null; if (again) { again = false; draw(); } }
  }
  // drawn only while it can be seen (a panel behind another tab has no size): shown again, it draws what changed
  let stale = true;
  const seen = () => root.offsetWidth > 0 && root.offsetHeight > 0;
  const soon = () => { if (seen()) { stale = false; draw(); } else stale = true; };
  new ResizeObserver(() => { if (stale && seen()) soon(); }).observe(root);
  return {
    refresh: soon,
    focus(name) {
      if ((name || '') === focusName) return;
      focusName = name || '';
      if ((scope === 'chain' && !focusState) || view === 'list') soon();
    },
    // shown on a thing ('' the map), in a view, a rule of it brought into sight (the Inspector's Edit logic, Graph)
    open({ name = '', view: v = 'list', rule = null } = {}) {
      focusName = name; focusState = ''; scope = 'chain'; view = v; listRule = rule; listSig = null; boxAt = null; renaming = null; tabs();
      requestAnimationFrame(() => soon());
    },
    // the List drawn again now (its rules changed there)
    redrawList() { listSig = null; soon(); },
    tryWhy: (id, key) => (tryPanel ? tryPanel.why(id, key) : null),
  };
}

// the Read view's HTML: the rules object by object (their ids at the side), the Story, what to check
function readHtml(v) {
  const out = [];
  if (!v.sections.length) out.push('<p class="hint">No rules on this map yet. Select an object and add one in the Inspector (Interactions).</p>');
  const line = (l) => {
    const text = typeof l === 'string' ? l : l.text || '';
    const m = /^([A-Za-z]\w*): (.*)$/.exec(text);
    return m ? `<li><span>${esc(capital(m[2]))}</span><i>${esc(m[1])}</i></li>` : `<li><span>${esc(capital(text))}</span></li>`;
  };
  for (const s of v.sections) {
    if (s.title) out.push(`<h3>${esc(s.title)}</h3>`);
    for (const g of s.groups) out.push(`<div class="lw-group"><h4>${esc(capital(g.title))}</h4><ul>${g.lines.map(line).join('')}</ul></div>`);
  }
  if (v.story.length) out.push(`<div class="lw-group"><h4>Story</h4><ul>${v.story.map(line).join('')}</ul></div>`);
  const checks = v.problems.filter((p) => p.level !== 'info'), notes = v.problems.filter((p) => p.level === 'info');
  if (checks.length) out.push(`<div class="lw-group"><h4>To check</h4><ul>${checks.map((p) => `<li class="${p.level === 'error' ? 'bad' : 'warn'}"><span>${esc(p.text)}</span></li>`).join('')}</ul></div>`);
  if (notes.length) out.push(`<div class="lw-group"><h4>Notes</h4><ul>${notes.map((p) => `<li class="dim"><span>${esc(p.text)}</span></li>`).join('')}</ul></div>`);
  return out.join('');
}

// "Why didn't it run?" as the panel shows it (app.js logicWhy's answer): notes on the last Play, then rule by rule what
// that Play and Try it say of it and what to check; a rule's sentence opens it in the List
export function whyHtml(a) {
  const MAX = 12, rules = (a.rules || []).slice(0, MAX), li = (w) => `<li>${esc(w.text)}</li>`;
  const out = ['<div class="lw-whyhead"><b>Why didn\'t it run?</b>'
    + '<button type="button" class="lw-whyclose" title="Close (Esc)" aria-label="Close">×</button></div>'];
  for (const n of a.notes || []) out.push(`<p class="lw-whynote">${esc(n)}</p>`);
  if (!(a.rules || []).length && !(a.notes || []).length) out.push('<p class="hint">It has no rules: nothing sets it off and nothing acts on it.</p>');
  for (const r of rules) {
    out.push(`<section><h4><button type="button" data-rule="${esc(r.id)}" data-src="${esc(r.src || '')}" title="Open it in the List">`
      + `${esc(capital(r.sentence || r.id))}</button><i>${esc(r.id)}</i></h4>`);
    if ((r.play || []).length) out.push(`<h5>In the last Play</h5><ul>${r.play.map(li).join('')}</ul>`);
    if ((r.tried || []).length) out.push(`<h5>In Try it</h5><ul>${r.tried.map(li).join('')}</ul>`);
    if ((r.checks || []).length) {
      out.push(`<h5>To check</h5><ul>${r.checks.map((p) => `<li class="${p.level === 'error' ? 'bad' : p.level === 'warn' ? 'warn' : 'dim'}">${esc(p.text)}</li>`).join('')}</ul>`);
    }
    if (!(r.play || []).length && !(r.tried || []).length && !(r.checks || []).length) {
      out.push('<p class="hint">Nothing to say of it yet: Play the map, or set it off in Try it.</p>');
    }
    out.push('</section>');
  }
  if ((a.rules || []).length > MAX) out.push(`<p class="hint">And ${a.rules.length - MAX} more rules: select one of them to ask about it.</p>`);
  return out.join('');
}

// The bar of the assistant's proposal: what it does, in words, and the answers
export function proposalHtml(q) {
  const n = (k, one, many) => (k ? `${k} ${k === 1 ? one : many}` : '');
  const parts = [n(q.added.length, 'new rule', 'new rules'), n(q.changed.length, 'rule changed', 'rules changed'),
    n(q.removed.length, 'rule removed', 'rules removed'), n(q.groups.length, 'new group', 'new groups'), n(q.blocks.length, 'new block', 'new blocks')].filter(Boolean);
  const brought = (q.problems?.brought || []).filter((p) => p.level !== 'info');
  return `<div class="lw-ptext"><b>The assistant proposes${q.summary ? ': ' + esc(q.summary) : ''}</b>`
    + `<span>${esc(parts.join(', ') || 'No change')}. Its rules are drawn dashed: nothing changes until you accept.</span>`
    + (q.removed.length ? `<span class="lw-pgone">Removes: ${q.removed.map((r) => esc(capital(r.sentence))).join('; ')}</span>` : '')
    + (brought.length ? `<span class="warn">To check after it: ${brought.map((p) => esc(p.text)).join(' ')}</span>` : '')
    + '</div><div class="lw-pbtns"><button type="button" data-decide="accept" class="primary" title="Make the change (one step: Ctrl+Z takes it back)">Accept</button>'
    + '<button type="button" data-decide="edit" title="Make the change and open its first rule in the List to change it">Accept and edit</button>'
    + '<button type="button" data-decide="reject" title="Leave the rules as they are">Reject</button></div>';
}
// What the canvas is given, marked: the proposal's own nodes and their wires as ghosts (dashed), and a rule the
// assistant made, until the user changes it, with a faint "assistant" badge
export function markShown(shown, q, ix) {
  const ghost = q ? q.ghost : new Set();
  const by = new Set((ix.edits.links || []).filter((l) => l.by === 'assistant').map((l) => 'rule:' + l.id));
  for (const n of shown.nodes) {
    if (ghost.has(n.id)) n.ghost = true;
    else if (by.has(n.id)) n.badges = [{ text: 'assistant', title: 'Made by the AI assistant: the mark goes once you change the rule' }, ...(n.badges || [])];
  }
  // a simple rule drawn as a wire has its rule's id (rule:L7), its parts too (rule:L7/a1)
  for (const w of shown.wires) {
    const rule = String(w.id).split('/')[0];
    if (ghost.has(w.from.node) || ghost.has(w.to.node) || ghost.has(rule)) w.ghost = true;
    else if (by.has(w.id)) w.title = (w.title ? w.title + '\n\n' : '') + 'Made by the AI assistant: the mark goes once you change the rule';
  }
  return shown;
}
