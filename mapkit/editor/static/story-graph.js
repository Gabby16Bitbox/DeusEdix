// The Story's dialogues as a graph (the Graph view of story-graph-view.js). A dialogue stays what story.py compiles: a
// list of steps, as Deus Ex's own conversations are a list of events, where labels mark places and choices,
// conditions and jumps go to them. Here each step that does something is a node; labels and plain jumps are not, they
// are the arrows. Every edit (connect, insert, remove) is made on the list itself, so the List view, the compiler and
// the stories made before stay as they are. Pure functions: tests/test_story_graph.mjs.

export const END = 'end';                    // the dialogue ends (an End step, or the end of the list)

// where a step can go: [{port, label?, text?}]. 'next' is the step after it in the list; the other ports hold the name
// of a label (field: where it is written in the step)
export function portsOf(s) {
  switch (s.type) {
    case 'end': return [];
    case 'goto': return s.conversation ? [] : [{ port: 'jump', label: s.label || '', field: 'label' }];
    case 'choice': return (s.options || []).map((o, k) => ({ port: k, label: o.goto || '', text: o.text || `Answer ${k + 1}` }));
    case 'random': return (s.labels || []).map((label, k) => ({ port: k, label, text: `Random ${k + 1}` }));
    case 'if': return [{ port: 'jump', label: s.goto || '', field: 'goto', text: 'Yes' }, { port: 'next', text: 'No' }];
    case 'checkitem': return [{ port: 'next', text: 'Has it' }, { port: 'jump', label: s.goto || '', field: 'goto', text: 'Missing' }];
    case 'checkvalue': return [{ port: 'jump', label: s.goto || '', field: 'goto', text: 'Yes' }, { port: 'next', text: 'No' }];
    case 'give': return s.fail ? [{ port: 'next', text: 'Given' }, { port: 'jump', label: s.fail, field: 'fail', text: 'Inventory full' }] : [{ port: 'next' }];
    default: return [{ port: 'next' }];
  }
}
const isNode = (s) => s.type !== 'label' && !(s.type === 'goto' && !s.conversation);

// every step a stable id (the graph's positions and selection keep to it when the list changes)
export function ensureIds(steps) {
  const used = new Set(steps.map((s) => s.id).filter(Boolean));
  let k = 1;
  for (const s of steps) {
    if (s.id) continue;
    while (used.has('n' + k)) k++;
    s.id = 'n' + k;
    used.add(s.id);
  }
  return steps;
}

const indexOf = (steps, id) => steps.findIndex((s) => s.id === id);
const labelAt = (steps, name) => (name ? steps.findIndex((s) => s.type === 'label' && s.name === name) : -1);

// the node reached from position i of the list: labels are passed, plain jumps followed; END past the last step,
// null when a jump goes to a label the dialogue does not have
export function resolve(steps, i, seen = new Set()) {
  while (i < steps.length) {
    const s = steps[i];
    if (s.type === 'label') { i++; continue; }
    if (s.type === 'goto' && !s.conversation) {
      if (seen.has(i)) return null;                        // a jump to itself: nowhere
      seen.add(i);
      const at = labelAt(steps, s.label);
      if (at < 0) return null;
      i = at + 1;
      continue;
    }
    return s.id;
  }
  return END;
}
export function resolveLabel(steps, name) {
  const at = labelAt(steps, name);
  return at < 0 ? null : resolve(steps, at + 1);
}

// {nodes: [{id, step, outs: [{port, text, to}]}], start, reachable}; to: a node id, END, or null (not connected, or a
// label that is missing: broken)
export function graphOf(steps) {
  ensureIds(steps);
  const nodes = [];
  steps.forEach((s, i) => {
    if (!isNode(s)) return;
    const outs = portsOf(s).map((p) => ({ port: p.port, text: p.text || '', label: p.label,
      to: p.port === 'next' ? resolve(steps, i + 1) : (p.label ? resolveLabel(steps, p.label) : null),
      broken: p.port !== 'next' && !!p.label && labelAt(steps, p.label) < 0 }));
    nodes.push({ id: s.id, step: s, outs });
  });
  const start = resolve(steps, 0);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const reachable = new Set();
  const walk = [start];
  while (walk.length) {
    const id = walk.pop();
    if (!byId.has(id) || reachable.has(id)) continue;
    reachable.add(id);
    for (const o of byId.get(id).outs) walk.push(o.to);
  }
  return { nodes, start, reachable };
}

function newLabel(steps, id) {
  const used = new Set(steps.filter((s) => s.type === 'label').map((s) => s.name));
  let name = 'to_' + id;
  for (let k = 2; used.has(name); k++) name = `to_${id}_${k}`;
  return name;
}
// the name of a label just before node `id` (one already there, else a new one named after the node)
export function labelFor(steps, id) {
  const i = indexOf(steps, id);
  for (let j = i - 1; j >= 0 && steps[j].type === 'label'; j--) if (steps[j].name) return steps[j].name;
  const name = newLabel(steps, id);
  steps.splice(i, 0, { type: 'label', name });
  return name;
}

// does the dialogue run off the end of the list (its last step goes on, or is a label something jumps to)?
function runsOff(steps) {
  const last = steps[steps.length - 1];
  return !!last && (last.type === 'label' || portsOf(last).some((p) => p.port === 'next'));
}
// an End step at the end of the list (the one there, else a new one): its id
function endOfList(steps) {
  if (steps[steps.length - 1]?.type !== 'end') steps.push({ type: 'end' });
  return ensureIds(steps)[steps.length - 1].id;
}
function targetOf(steps, id, port) {
  const i = indexOf(steps, id);
  if (port === 'next') return resolve(steps, i + 1);
  const p = portsOf(steps[i]).find((q) => q.port === port);
  return p && p.label ? resolveLabel(steps, p.label) : null;
}
function setJump(steps, i, port, name) {
  const s = steps[i];
  if (s.type === 'choice') s.options[port].goto = name;
  else if (s.type === 'random') s.labels[port] = name;
  else s[portsOf(s).find((p) => p.port === port).field] = name;
}

// port `port` of node `id` goes to `to` (a node id, END, or null: nowhere)
export function connect(steps, id, port, to) {
  ensureIds(steps);
  if (port === 'next') {
    if (targetOf(steps, id, 'next') === to) return steps;
    const name = to && to !== END ? labelFor(steps, to) : null;
    const j = indexOf(steps, id) + 1;
    const hop = steps[j]?.type === 'goto' && !steps[j].conversation;      // its way on was a jump: that one changes
    steps.splice(j, hop ? 1 : 0, name ? { type: 'goto', label: name } : { type: 'end' });
    return ensureIds(steps);
  }
  const name = to === END ? labelFor(steps, endOfList(steps)) : to ? labelFor(steps, to) : '';
  setJump(steps, indexOf(steps, id), port, name);
  return steps;
}

// the dialogue starts at node `to` (END: it says nothing)
export function connectStart(steps, to) {
  ensureIds(steps);
  if (resolve(steps, 0) === to) return steps;
  const name = to && to !== END ? labelFor(steps, to) : null;
  const hop = steps[0]?.type === 'goto' && !steps[0].conversation;
  steps.splice(0, hop ? 1 : 0, name ? { type: 'goto', label: name } : { type: 'end' });
  return ensureIds(steps);
}

// a new step on port `port` of node `id`, between it and where that port went: the new step's id
export function insertAt(steps, id, port, step) {
  ensureIds(steps);
  if (port === 'next') {
    steps.splice(indexOf(steps, id) + 1, 0, step);
    ensureIds(steps);
    return step.id;
  }
  const was = targetOf(steps, id, port);
  if (runsOff(steps)) steps.push({ type: 'end' });          // what is last may not fall into the new place
  steps.push(step);
  ensureIds(steps);
  const name = newLabel(steps, step.id);
  steps.splice(steps.length - 1, 0, { type: 'label', name });
  if (portsOf(step).some((p) => p.port === 'next')) steps.push(was && was !== END ? { type: 'goto', label: labelFor(steps, was) } : { type: 'end' });
  setJump(steps, indexOf(steps, id), port, name);
  ensureIds(steps);
  return step.id;
}

// node `id` taken away: what came into it goes on to where it went
export function remove(steps, id) {
  const i = indexOf(steps, id);
  if (i >= 0) steps.splice(i, 1);
  return steps;
}
