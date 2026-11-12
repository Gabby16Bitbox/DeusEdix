// The Story Graph's nodes and wires for graph-canvas.js (story-graph-view.js draws them). A dialogue's graph
// (story-graph.js graphOf: each step that does something a node, labels and jumps the arrows) becomes the canvas's
// nodes: a line with the colour and face of who speaks and its text in the node, JC's answers and a condition's Yes /
// No as rows with a way (a colour) each, the dialogue's Start, its End and its jumps to another conversation. The flow
// goes left to right as in the Logic window. Pure: tests/test_story_graph_nodes.mjs.
import { END } from './story-graph.js';

export const START = '@start';                   // the dialogue's Start node (not a step)
// the colours of a node's ways on when it has several: answers and random branches one each, Yes / No green and red
export const WAYS = ['#5dcaa5', '#5aa2ff', '#e98bd5', '#ffb347', '#a58bff', '#7fd36b', '#ff8a80', '#4dd0e1'];
export const YES_NO = ['#6bcf7f', '#ff7b7b'];
export const LINE_W = 240;                       // a line's node: wider, for its text
export const END_W = 100;
const CONDITIONS = ['if', 'checkitem', 'checkvalue', 'random'];

// what a step looks like: line, choice (JC's answers), cond, end (an End, or a jump to another conversation), act
export function kindOf(s) {
  if (s.type === 'line') return 'line';
  if (s.type === 'choice') return 'choice';
  if (CONDITIONS.includes(s.type)) return 'cond';
  if (s.type === 'end' || s.type === 'goto') return 'end';
  return 'act';
}
// a port of story-graph.js ('next', 'jump', an answer's number) as a pin id of the canvas, and back
export const pinOf = (port) => String(port);
export const portOf = (pin) => (/^\d+$/.test(String(pin)) ? +pin : String(pin));
const rowId = (port) => 'way:' + port;
export const rowPort = (id) => (String(id || '').startsWith('way:') ? portOf(String(id).slice(4)) : null);

// what is wrong with a node, in a word or two ('' : nothing)
export function problemOf(n) {
  const s = n.step;
  if (s.type === 'line' && !String(s.text || '').trim()) return 'empty';
  if (s.type === 'choice' && (s.options || []).some((o) => !String(o.text || '').trim())) return 'empty answer';
  if (n.outs.some((o) => o.broken)) return 'broken';
  if (s.type === 'choice' && n.outs.some((o) => o.to === null)) return 'answer goes nowhere';
  return '';
}
// the colour of a node's way on number i: only nodes with several ways (and JC's answers) have one
export function wayColour(n, i) {
  if (n.outs.length < 2 && n.step.type !== 'choice') return '';
  return ['choice', 'random'].includes(n.step.type) ? WAYS[i % WAYS.length] : YES_NO[i] || WAYS[i % WAYS.length];
}
// an answer's own chip: its conditions, a click edits them ('opt:<k>')
function answerChips(s, port) {
  const o = s.type === 'choice' && typeof port === 'number' ? s.options?.[port] : null;
  const n = o?.requires?.length || 0;
  return n ? [{ text: n === 1 ? 'if 1' : `if ${n}`, value: `opt:${port}`, title: 'Shown only when its conditions match: click to change them' }] : [];
}
// a node with rows: each way on is a row (JC's answers always, others when they have more than one)
export const hasRows = (n) => n.step.type === 'choice' || n.outs.length > 1;

// graph: graphOf's {nodes, start, reachable}. Options: at {node id: [x, y]} (the places moved by hand; the others the
// canvas lays out), speaker(step) -> {name, colour}, summary {title(step), text(step), parts?(step) -> [{text, value?}]: the
// text in pieces, those with a value clickable (story-graph-view.js edits it where it is)}. A line's speaker is a value
// ('who'), and an answer with conditions has a chip for them ('opt:<k>').
// -> {nodes, wires} for graph-canvas.js set()
export function canvasOf(graph, { at = {}, speaker, summary }) {
  const nodes = [], wires = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const wire = (from, pin, to, colour) => {
    if (!ids.has(to)) return;
    wires.push({ id: `${from}>${pin}`, from: { node: from, pin }, to: { node: to, pin: 'in' }, ...(colour ? { colour } : {}) });
  };
  nodes.push({ id: START, kind: 'start', title: 'Start', w: END_W, at: at[START], label: 'Start of the dialogue',
    out: { id: 'start', title: graph.start === END ? 'The dialogue says nothing: drag to the first step' : 'Where the dialogue starts', free: graph.start === END } });
  wire(START, 'start', graph.start);
  for (const n of graph.nodes) {
    const s = n.step, kind = kindOf(s), far = !graph.reachable.has(n.id), warn = problemOf(n);
    const base = { id: n.id, kind, at: at[n.id], dim: far, in: { id: 'in', title: 'Where the arrows into this step arrive' } };
    if (far) base.badges = [{ text: 'not reached', title: 'Nothing leads to this step' }];
    if (warn) { base.tone = 'warn'; base.badges = [...(base.badges || []), { text: warn }]; }
    if (kind === 'end') {
      nodes.push({ ...base, w: s.type === 'goto' ? 200 : END_W, title: s.type === 'goto' ? 'Continues in ' + (s.conversation || '?') : 'End' });
      continue;
    }
    const node = { ...base };
    if (kind === 'line') {
      const who = speaker(s);
      Object.assign(node, { w: LINE_W, title: who.name, titleValue: 'who', colour: who.colour, thumb: s.who || 'npc',
        body: { text: s.text || 'Double-click to write the line', empty: !s.text, lines: 3 } });
      if (s.voice) node.badges = [{ text: 'voice', title: 'Has a recorded voice' }, ...(node.badges || [])];
    } else if (kind === 'choice') node.title = "JC's answers";
    else {
      node.title = kind === 'cond' ? summary.title(s) || 'Condition' : summary.title(s);
      const text = summary.text(s), parts = summary.parts ? summary.parts(s) : null;
      if (text || parts?.length) node.body = { text: parts?.length ? parts.map((p) => p.text).join('') : text, lines: 2, ...(parts?.length ? { parts } : {}) };
    }
    if (hasRows(n)) {
      node.rows = n.outs.map((o, i) => ({
        id: rowId(o.port), text: o.text || '…', colour: wayColour(n, i),
        out: { id: pinOf(o.port), free: o.to === null, title: o.to === null ? 'Goes nowhere yet: drag to a step, or click to add one' : undefined },
        chips: [...answerChips(s, o.port), ...(o.broken ? [{ text: 'broken', tone: 'bad', title: 'It jumps to a label the dialogue does not have' }]
          : o.to === END ? [{ text: 'end', title: 'The dialogue ends here' }] : [])],
      }));
      n.outs.forEach((o, i) => wire(n.id, pinOf(o.port), o.to, wayColour(n, i)));
    } else if (n.outs.length) {
      const o = n.outs[0];
      node.out = { id: pinOf(o.port), free: o.to === null, title: o.to === null ? 'Drag to connect, or click to add the next step' : 'Drag to connect it elsewhere' };
      if (o.to === END) node.badges = [...(node.badges || []), { text: 'end', title: 'The dialogue ends after this step' }];
      wire(n.id, node.out.id, o.to);
    }
    nodes.push(node);
  }
  return { nodes, wires };
}
