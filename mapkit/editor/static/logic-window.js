// Window > Logic: the map's rules seen as a graph, read as sentences, or tried (editor/LOGIC.md; the design:
// backup/20261027_logic_graph/final_design.json, its mock-up logic-di-deusedix.html; the look: editor/DESIGN.md and
// the Story's Graph). It draws logic-graph-model.js's projection of edits.links on the graph canvas (graph-canvas.js),
// logic-graph-read.js's prose and Try it (logic-try.js); it changes nothing: a node opened selects its object in the
// map, where the Inspector edits its rules. The page gives the model's input (app.js logicInput).
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
// Returns {refresh(), focus(name)}: refresh draws again (the edits changed); focus shows a name's chain.
import { logicIndex, logicGraph, scopeOf, thingId } from './logic-graph-model.js';
import { readView } from './logic-graph-read.js';
import { logicProblems, problemsByNode } from './logic-graph-problems.js';
import { createGraphCanvas } from './graph-canvas.js';
import { createLogicTry } from './logic-try.js';
import { escapeHtml as esc } from './shortcut-bar.js';

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
  group: '<circle cx="7" cy="8" r="2.5"/><circle cx="13" cy="8" r="2.5"/><path d="M3 16c0-2 2-3.5 4-3.5M17 16c0-2-2-3.5-4-3.5"/>',
  object: '<rect x="4" y="5" width="12" height="11" rx="1"/><path d="M4 8h12"/>',
};
const ICON_OF = { door: 'door', elevator: 'door', light: 'light', switchlight: 'light', character: 'character', carcass: 'character',
  keypad: 'keypad', computer: 'computer', zone: 'zone', targettrigger: 'zone', switchtrigger: 'zone', moretrigger: 'zone', timer: 'timer',
  script: 'script', item: 'item', alarm: 'alarm', camera: 'camera', turret: 'camera', laser: 'alarm', beam: 'alarm', cutscene: 'cutscene',
  world: 'map', group: 'group' };
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
    return capital(text.replace(at, 'it').replace(/\b(\w+) (up|on|off|in|out|down) it\b/, '$1 it $2')
      .replace(/\bit gets where they were sent\b/, 'it gets where it was sent'));
  }
  return capital('When ' + strip(c.short || c.text).replace(/^when /i, ''));
}
// the object a node stands for: a map object's name, a rule card's first cause's object
export function objectOf(graph, id) {
  if (id.startsWith(OBJECT)) return id.slice(OBJECT.length);
  const n = graph.nodes.find((x) => x.id === id);
  const c = n && n.kind === 'rule' && n.causes[0];
  return c && c.node.startsWith(OBJECT) ? c.node.slice(OBJECT.length) : '';
}

// The index at the side (pure): the things that start rules or are acted on, the states and counters (who sets and
// reads them), what to check. [{title, rows: [{key, text, note, tone, title}]}]
export function indexOf(ix, whole, problems) {
  const things = whole.nodes.filter((n) => n.kind === 'thing' || n.kind === 'world');
  const starts = new Map();
  for (const r of ix.rules) for (const c of r.causes) starts.set(c.node, (starts.get(c.node) || 0) + 1);
  const label = (n) => (n.kind === 'world' ? 'The map' : n.label || n.name);
  const objects = things.map((n) => ({ key: 'thing:' + n.id, text: label(n), sort: (n.kind === 'world' ? '0' : '1') + label(n).toLowerCase(),
    note: starts.get(n.id) ? `${starts.get(n.id)}` : '', tone: n.missing ? 'bad' : undefined,
    title: n.missing ? `${n.name} is not in the map` : `${label(n)}${n.word ? ' · ' + n.word : ''}${n.name ? ' (' + n.name + ')' : ''}`
      + (starts.get(n.id) ? `\nStarts ${starts.get(n.id)} rule${starts.get(n.id) === 1 ? '' : 's'}` : '') }))
    .sort((a, b) => a.sort.localeCompare(b.sort));
  const states = [...ix.states.values()].map((s) => ({ key: 'state:' + s.name, text: s.name, note: s.type === 'int' ? '#' : '',
    tone: !s.setters.length && !s.elsewhere.some((u) => u.kind === 'write') ? 'warn' : undefined,
    title: `${s.type === 'int' ? 'Counter' : 'State'} ${s.name}\nSet by: ${s.setters.map((u) => u.rule).filter(Boolean).join(', ') || 'nothing on this map'}`
      + `\nRead by: ${s.readers.map((u) => u.rule).filter(Boolean).join(', ') || 'nothing on this map'}` }))
    .sort((a, b) => a.text.localeCompare(b.text));
  const check = problems.filter((p) => p.level !== 'info').map((p, i) => ({ key: 'problem:' + i, node: p.node, rule: p.rule,
    text: p.text, tone: p.level === 'error' ? 'bad' : 'warn', title: p.text }));
  return [{ id: 'objects', title: 'Objects', rows: objects }, { id: 'states', title: 'States and counters', rows: states },
    { id: 'check', title: 'To check', rows: check }].filter((s) => s.rows.length);
}

// ---------------------------------------------------------------- the window
export function createLogicWindow({ root, input, select = () => {}, status = () => {}, trial = null, picture = null, listView = null }) {
  root.classList.add('logic-window');
  root.innerHTML = `<div class="lw-bar">
      <div class="lw-tabs" role="tablist">
        <button type="button" class="lw-tab" data-view="list" role="tab" title="The rules of the object as lists of steps, to edit">List</button>
        <button type="button" class="lw-tab" data-view="graph" role="tab" title="The rules as a graph">Graph</button>
        <button type="button" class="lw-tab" data-view="read" role="tab" title="The rules as sentences, object by object">Read</button>
        <button type="button" class="lw-tab" data-view="try" role="tab" title="Play the rules here, with no game: press what happens, see what they do and why not">Try it</button>
      </div>
      <span class="lw-div"></span>
      <div class="lw-tabs lw-scope" role="radiogroup" aria-label="What the graph shows">
        <button type="button" data-scope="chain" title="The selected object's rules: what sets them off and what they do">Selected</button>
        <button type="button" data-scope="map" title="Every rule of the map">Whole map</button>
      </div>
      <button type="button" class="lw-fit" title="Fit the graph (Home)">Fit</button>
      <span class="lw-info"></span>
    </div>
    <div class="lw-body">
      <nav class="lw-side" aria-label="Logic index"></nav>
      <div class="lw-main">
        <div class="lw-graph"></div>
        <div class="lw-list" hidden></div>
        <div class="lw-crumb" hidden></div>
        <div class="lw-read" hidden></div>
        <div class="lw-try" hidden></div>
      </div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  let view = 'graph', scope = 'chain', listSig = null, listRule = null, graph = { nodes: [], wires: [] }, focusName = '', focusState = '', drawn = '', fitted = '';
  let busy = null, again = false, index = [];
  const pictures = new Map();                          // a class's picture, once known: a URL, or null when it has none
  const canvas = createGraphCanvas($('.lw-graph'), { label: 'Logic graph', icons: ICONS,
    thumb: (key) => (picture ? picture(key) : Promise.resolve(null)),
    onOpen: (node) => { const name = objectOf(graph, node); if (name) select(name); },
    onSelect: (sel) => { const id = (sel.nodes || [])[0]; const name = id && objectOf(graph, id); if (name) focusName = name; },
    onCommand: () => {} });
  const tryPanel = trial ? createLogicTry({ root: $('.lw-try'), trial, status }) : null;
  if (!tryPanel) root.querySelector('.lw-tab[data-view=try]').remove();
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
  root.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { scope = b.dataset.scope; focusState = ''; tabs(); draw(); }));
  $('.lw-fit').addEventListener('click', () => canvas.fit());
  // the index: an object shows its rules (and is selected in the map), a state the rules that set and read it, a
  // problem its rule
  $('.lw-side').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-key]');
    if (!b) return;
    const key = b.dataset.key;
    if (key.startsWith('thing:')) {
      const id = key.slice(6);
      if (view !== 'list') view = 'graph';          // the List shows the object chosen, the other views its graph
      scope = 'chain'; focusState = '';
      if (id.startsWith(OBJECT)) { focusName = id.slice(OBJECT.length); select(focusName); } else focusName = '';
      if (id === 'world') { scope = 'map'; }
    } else if (key.startsWith('state:')) { view = 'graph'; focusState = key.slice(6); }
    else if (key.startsWith('problem:')) {
      const row = index.flatMap((s) => s.rows).find((r) => r.key === key);
      const rule = row && row.rule && graph.nodes.find((n) => n.rule === row.rule);
      const name = rule ? objectOf(graph, rule.id) : '';
      view = 'graph'; focusState = '';
      if (name) { focusName = name; scope = 'chain'; } else scope = 'map';
      if (row && row.rule) requestAnimationFrame(() => setTimeout(() => {
        const id = graph.nodes.find((n) => n.rule === row.rule)?.id;
        if (id) { canvas.select({ nodes: [id] }); canvas.reveal([id]); }
      }, 60));
    }
    tabs(); draw();
  });
  tabs();

  function sideHtml(sections) {
    const now = focusState ? 'state:' + focusState : scope === 'chain' && focusName ? 'thing:' + thingId(focusName) : '';
    return sections.map((s) => `<section><h4>${esc(s.title)}<span>${s.rows.length}</span></h4>`
      + s.rows.slice(0, 200).map((r) => `<button type="button" data-key="${esc(r.key)}" class="${r.tone || ''}${r.key === now ? ' on' : ''}"`
        + ` title="${esc(r.title || r.text)}"><span>${esc(r.text)}</span>${r.note ? `<i>${esc(r.note)}</i>` : ''}</button>`).join('')
      + '</section>').join('') || '<p class="hint">No rules on this map yet.</p>';
  }
  async function draw() {
    if (busy) { again = true; return busy; }
    busy = (async () => {
      try {
        const ix = logicIndex(await input());
        const problems = logicProblems(ix);
        const byNode = problemsByNode(problems);
        root.dataset.view = view;
        $('.lw-graph').hidden = view !== 'graph';
        $('.lw-read').hidden = view !== 'read';
        $('.lw-list').hidden = view !== 'list';
        $('.lw-try').hidden = view !== 'try';
        $('.lw-side').hidden = view === 'try';
        for (const el of root.querySelectorAll('.lw-scope, .lw-fit, .lw-div')) el.hidden = view !== 'graph';
        const count = ix.rules.length, check = problems.filter((p) => p.level !== 'info').length;
        $('.lw-info').textContent = `${count} rule${count === 1 ? '' : 's'}${check ? ` · ${check} to check` : ''}`;
        $('.lw-info').classList.toggle('warn', check > 0);
        const whole = logicGraph(ix);
        index = indexOf(ix, whole, problems);
        if (view === 'list') {                     // drawn again when its rules change or another thing is chosen
          $('.lw-side').innerHTML = sideHtml(index); $('.lw-crumb').hidden = true;
          const mine = (l) => (focusName ? l.src === focusName : !l.src);
          const rules = (ix.edits.links || []).filter((l) => mine(l) || (l.otherwiseOf && (ix.edits.links || []).some((m) => m.id === l.otherwiseOf && mine(m))));
          const sig = JSON.stringify([focusName, rules]);
          if (sig !== listSig && listView) { listSig = sig; const rule = listRule; listRule = null; await listView($('.lw-list'), focusName, rule); }
          return;
        }
        if (view === 'read') { $('.lw-read').innerHTML = readHtml(readView(ix)); $('.lw-side').innerHTML = sideHtml(index); $('.lw-crumb').hidden = true; return; }
        if (view === 'try') { $('.lw-crumb').hidden = true; await tryPanel.show(); return; }
        const rootId = focusName ? thingId(focusName) : null;
        const chain = scope === 'chain' && rootId && whole.nodes.some((n) => n.id === rootId);
        graph = focusState ? scopeOf(whole, { kind: 'state', state: focusState }, { ix })
          : chain ? scopeOf(whole, { kind: 'chain', root: rootId }, { ix }) : scopeOf(whole, { kind: 'map' }, { ix, limit: 400 });
        $('.lw-side').innerHTML = sideHtml(index);
        // where one is: what the graph shows now, in words
        const named = chain ? whole.nodes.find((n) => n.id === rootId) : null;
        $('.lw-crumb').hidden = false;
        $('.lw-crumb').textContent = focusState ? `The rules that set or read ${focusState}`
          : named ? `${named.label || named.name}: what sets its rules off and what they do`
            : scope === 'chain' ? 'Nothing selected has rules: the whole map' : 'The whole map';
        const shown = canvasOf(graph, byNode, (name) => {
          const a = ix.actors[name];
          return a && a.cls ? 'cls:' + a.cls : '';
        });
        const key = JSON.stringify(shown);
        if (key !== drawn) {
          canvas.set(shown); drawn = key;
          // other things shown (another chain, the whole map, a first draw): fitted, after the canvas has its size
          const ids = shown.nodes.map((n) => n.id).sort().join('\n');
          if (ids !== fitted) { fitted = ids; requestAnimationFrame(() => canvas.fit()); }
        }
        if (graph.hidden) $('.lw-info').textContent += ` · ${graph.hidden} more not shown`;
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
      focusName = name; focusState = ''; scope = 'chain'; view = v; listRule = rule; listSig = null; tabs();
      requestAnimationFrame(() => soon());
    },
    // the List drawn again now (its rules changed there)
    redrawList() { listSig = null; soon(); },
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
