// The Logic window's Read view (the design's "three views": Graph, Sentences, Read): the map's logic as plain prose,
// by phase, then by the thing each rule belongs to, with the Story's conversations and the problems after; and the
// same as plain text for Copy as text (reviews, forum posts, the assistant). Pure: tests/test_logic_graph_read.mjs.
import { fill } from './logic-vocab.js';
import { ruleBadges, logicGraph } from './logic-graph-model.js';
import { logicProblems } from './logic-graph-problems.js';

// what the rule's sentence already says (logic-vocab sentence: its once, its checks, its delays)
const SAID = new Set(['once', 'requires', 'do']);

// "While Base alert is Quiet or Alarm" for a rule kept to phases; '' for one that always works
function phaseTitle(ix, phase) {
  if (!phase || !phase.set) return '';
  const set = (ix.logic.phases || []).find((p) => p.id === phase.set);
  return `While ${set ? set.name || set.id : phase.set} is ${(phase.in || []).join(' or ')}`;
}
// one rule in words: "L3: When ...: ... (muted, cooldown 5 s); otherwise: ..." (its otherwise as the sentence says
// its own steps)
function ruleLine(ix, r) {
  const extra = ruleBadges(r.l, ix).filter((b) => !SAID.has(b.field) && b.field !== 'phase').map((b) => b.text);
  const otherwise = (r.l.else || []).length ? `; otherwise: ${ix.vocab.steps(r.l.else, ix.ctx)}` : '';
  return { rule: r.id, node: r.node, text: `${r.id}: ${ix.vocab.sentence(r.l, ix.ctx)}${extra.length ? ` [${extra.join(', ')}]` : ''}${otherwise}` };
}
// a dialogue, an InfoLink or a Story event in words, from its node in the graph; an event's cause as a rule's says its
// own (logic.json sentence.when: "When", "As soon as" after the rename pass)
function storyLine(ix, n) {
  const what = n.word.charAt(0).toUpperCase() + n.word.slice(1);
  const checks = n.checks.length ? `, only if ${n.checks.map((c) => c.text).join(' and ')}` : '';
  const rows = n.rows.length ? `: ${n.rows.map((r) => r.text).join(', ')}` : '';
  const head = n.kind === 'storyrule' ? fill(ix.catalog.sentence.when, { say: n.cause }) + checks : n.kind === 'dialogue' ? `"${n.first}"${checks}` : n.caller || '';
  return { node: n.id, text: `${what} "${n.title}"${n.disabled ? ' (off)' : ''}${head ? ' - ' + head : ''}${rows}` };
}

// The Read view: {title, sections: [{title, groups: [{title, node, lines: [{rule, node, text}]}]}], story: [{node, text}],
// problems: [{level, node, text}]}. only: the node and wire ids to say (a scope's, a selection's); none: all.
export function readView(ix, { only = null, game = '' } = {}) {
  const keep = (id) => !only || only.has(id);
  const sections = new Map();
  for (const r of ix.rules.filter((x) => keep(x.node))) {
    const title = phaseTitle(ix, r.l.phase);
    if (!sections.has(title)) sections.set(title, new Map());
    const groups = sections.get(title), c = r.causes[0];
    if (!groups.has(c.node)) groups.set(c.node, { title: c.src ? ix.ctx.name(c.src) : 'When the map starts', node: c.node, lines: [] });
    groups.get(c.node).lines.push(ruleLine(ix, r));
  }
  const ordered = [...sections].sort(([a], [b]) => (a === '') - (b === '') || 0);         // phases first, then always
  const graph = logicGraph(ix, { game: false });
  return {
    title: `${ix.input.map || 'This map'}: logic`,
    sections: ordered.map(([title, groups]) => ({ title: title || (ordered.length > 1 ? 'Always' : ''), groups: [...groups.values()] })),
    story: graph.nodes.filter((n) => n.readOnly && keep(n.id)).map((n) => storyLine(ix, n)),
    problems: logicProblems(ix, { game }).filter((p) => keep(p.node) || keep(p.wire)).map((p) => ({ level: p.level, node: p.node, text: `${p.rule ? p.rule + ': ' : ''}${p.text}` })),
  };
}

// The Read view as plain text (Copy as text)
export function readText(view) {
  const out = [view.title];
  for (const s of view.sections) {
    out.push('');
    if (s.title) out.push(s.title);
    for (const g of s.groups) out.push(g.title, ...g.lines.map((l) => '  ' + l.text));
  }
  if (view.story.length) out.push('', 'Conversations and Story events', ...view.story.map((l) => '  ' + l.text));
  if (view.problems.length) out.push('', 'Problems', ...view.problems.map((p) => `  ${p.level}: ${p.text}`));
  if (!view.sections.length && !view.story.length) out.push('', 'No logic yet.');
  return out.join('\n') + '\n';
}
