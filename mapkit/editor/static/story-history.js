// The Story's changes in the editor's history (P5: the Story joins the map's Ctrl+Z, Ctrl+Y and History panel;
// history-names.js keeps the steps, story.js records them). What a change did, found by comparing the Story as it
// was with the Story now: "Add the dialogue "Gate talk"", "Change the InfoLink "Call"", "Delete 2 Story events".
// The logic only, no page code.

// the Story's lists, each with the word a step says
const KINDS = [['dialogues', 'dialogue', 'dialogues'], ['infolinks', 'InfoLink', 'InfoLinks'], ['events', 'Story event', 'Story events']];
const list = (s, key) => (Array.isArray(s?.[key]) ? s[key] : []);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const titleOf = (x) => String(x?.title || x?.id || '').trim() || 'untitled';

// before, after: the Story (story.js: {dialogues, infolinks, events, places, ...}) -> the step's name
export function storyStepName(before, after) {
  const changes = [];            // [verb, kind (its index in KINDS), item]
  for (const [k, [key]] of KINDS.entries()) {
    const was = list(before, key), now = list(after, key);
    const wasById = new Map(was.map((x) => [x?.id, x])), nowById = new Map(now.map((x) => [x?.id, x]));
    let found = false;
    for (const x of now) if (!wasById.has(x?.id)) { changes.push(['Add', k, x]); found = true; }
    for (const x of was) if (!nowById.has(x?.id)) { changes.push(['Delete', k, x]); found = true; }
    // a change says the item as it was (its title being written: the title it had)
    for (const x of now) if (wasById.has(x?.id) && !same(wasById.get(x?.id), x)) { changes.push(['Change', k, wasById.get(x?.id)]); found = true; }
    // only the order: a dialogue moved up or down (its speaker's priority)
    if (!found && !same(was.map((x) => x?.id), now.map((x) => x?.id))) changes.push(['Reorder', k, null]);
  }
  if (changes.length === 1) {
    const [verb, k, x] = changes[0];
    if (verb === 'Reorder') return `Change the order of the ${KINDS[k][2]}`;
    return `${verb} the ${KINDS[k][1]} "${titleOf(x)}"`;
  }
  if (changes.length > 1) {
    const verbs = new Set(changes.map((c) => c[0])), kinds = new Set(changes.map((c) => c[1]));
    if (verbs.size === 1 && kinds.size === 1 && !verbs.has('Reorder')) {
      const [verb, k] = changes[0];
      return `${verb} ${changes.length} ${KINDS[k][2]}`;
    }
    return 'Change the Story';
  }
  // nothing in the lists: a dialogue's graph arranged (its nodes moved, Tidy), or the Story's other settings. The
  // places of its nodes: `places` (the node canvas, since 9 Nov 2026) or `layout` (the older top-down Graph's)
  const PLACES = ['places', 'layout'];
  const moved = [...new Set(PLACES.flatMap((key) => {
    const was = before?.[key] || {}, now = after?.[key] || {};
    return [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((id) => !same(was[id], now[id]));
  }))];
  const others = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter((key) => !PLACES.includes(key) && !KINDS.some(([k]) => k === key) && !same(before?.[key], after?.[key]));
  if (moved.length === 1 && !others.length) {
    const d = list(after, 'dialogues').find((x) => x?.id === moved[0]);
    return d ? `Arrange the graph of "${titleOf(d)}"` : 'Arrange a dialogue\'s graph';
  }
  return 'Change the Story';
}
