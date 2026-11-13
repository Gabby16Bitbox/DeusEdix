// A rule as a list of steps (the Inspector's Interactions, 5 Nov 2026: a numbered list read top to bottom, as
// adventure-game toolkits show a sequence of actions, so that complex things need no code). Pure: tests/test_action_list.mjs.
//
// The rule stays as the game runs it today (edits.links, UCLink): its conditions are checked when it is set off, its
// actions run at their delay from that moment. The list is how it reads:
//   Check   the rule's conditions ("go on only if")
//   steps   its actions in the order of their time; a Wait step where the time goes on ("Wait 2 s")
//   If not  the steps when the check fails: a second rule on the same cause with the opposite condition, which
//           names the first (otherwiseOf). The game runs it already; it needs exactly one condition that can be
//           turned round (a skill has only "at least").
// A step added goes after the last one (at its time); changing a Wait moves every step after it.

const round = (v) => Math.round(v * 10) / 10;
export const timeOf = (x) => Math.max(0, +x.delay || 0);

// [{kind: 'wait', from, seconds} | {kind: 'act', j (its index in rule.do), x, at}] in the order they run
export function stepsOf(rule) {
  if (rule.steps) return listSteps(rule);         // a list of steps: in its order (below)
  const acts = (rule.do || []).map((x, j) => ({ x, j, at: timeOf(x) })).sort((a, b) => a.at - b.at || a.j - b.j);
  const out = [];
  let t = 0;
  for (const a of acts) {
    if (a.at > t) { out.push({ kind: 'wait', from: t, seconds: round(a.at - t) }); t = a.at; }
    out.push({ kind: 'act', j: a.j, x: a.x, at: a.at });
  }
  return out;
}
// the time of the last step (where a step added goes)
export const lastTime = (rule) => Math.max(0, ...(rule.do || []).map(timeOf));

// The Wait that starts at `from` made `seconds` long: every action after it moves by the difference (never before
// `from`). -> whether something changed
export function setWait(rule, from, seconds) {
  const later = (rule.do || []).filter((x) => timeOf(x) > from);
  if (!later.length) return false;
  const next = Math.min(...later.map(timeOf)), delta = round(Math.max(0, +seconds || 0) - (next - from));
  if (!delta) return false;
  for (const x of later) x.delay = round(Math.max(from, timeOf(x) + delta));
  return true;
}

// ---------------------------------------------------------------- "If not"
const INVERSE = { '>=': '<', '<': '>=', '>': '<=', '<=': '>', '==': '!=', '!=': '==' };
const yes = (c, key) => !Object.hasOwn(c, key) || c[key] === undefined || (c[key] !== null && typeof c[key] === 'object'
  ? Object.keys(c[key]).length > 0 : !!c[key]);                  // conditions.js yesOf, as the game reads it
// The condition that holds exactly when this one does not, or null when the game cannot say it (a skill)
export function negate(c) {
  if (!c || typeof c !== 'object') return null;
  const kind = c.type || ('flag' in c ? 'flag' : null);
  switch (kind) {
    case 'flag': return { ...c, is: !yes(c, 'is') };
    case 'item': return { ...c, has: !yes(c, 'has') };
    case 'alive': case 'near': case 'aug': case 'water': case 'zone': return { ...c, is: !yes(c, 'is') };
    case 'counter': case 'credits': case 'health': case 'energy': case 'skillpoints': case 'items':
      return INVERSE[c.op] ? { ...c, op: INVERSE[c.op] } : null;
    default: return null;
  }
}
// whether a rule's check can have "If not" steps: exactly one condition, one the game can turn round
export const canOtherwise = (rule) => (rule.requires || []).length === 1 && !!negate(rule.requires[0]) && rule.when !== 'start' || false;
// the rule of a rule's "If not" steps
export const otherwiseOf = (rule, links) => (links || []).find((l) => l && l.otherwiseOf === rule.id) || null;
// what sets a rule off, which its "If not" rule shares
export const CAUSE_FIELDS = ['src', 'when', 'option', 'port', 'near', 'key', 'also', 'at', 'phase'];
// The "If not" rule made to follow its rule: the same cause and Only once, the opposite condition
export function syncOtherwise(main, other) {
  for (const f of CAUSE_FIELDS) {
    if (main[f] === undefined) delete other[f];
    else other[f] = JSON.parse(JSON.stringify(main[f]));
  }
  other.once = !!main.once;
  other.otherwiseOf = main.id;
  other.requires = [negate(main.requires[0])];
  if (!other.do) other.do = [];
  return other;
}
// a new "If not" rule for a rule (its id given)
export function newOtherwise(main, id) {
  return syncOtherwise(main, { id, do: [] });
}

// ---------------------------------------------------------------- the steps one can add, by kind
// The actions with no object, in groups as a menu shows them (verbs not listed go under "More")
export const STEP_GROUPS = [
  ['Messages and goals', ['message', 'goal', 'note']],
  ['The Story', ['talk', 'infolink']],
  ['States and counters', ['flag', 'count']],
  ['Sound and effects', ['sound', 'effect', 'explode', 'shake', 'fade', 'flash', 'music']],
  ['The player', ['skillpoints', 'credits', 'health', 'energy', 'aug', 'giveitem', 'takeitem', 'moveplayer', 'fpmoment', 'travel']],
  ['The world', ['spawn', 'allies', 'hurtzone', 'autosave', 'endgame', 'cancel']],
];
export function groupSteps(free) {
  const left = new Set(free), out = [];
  for (const [title, verbs] of STEP_GROUPS) {
    const has = verbs.filter((v) => left.has(v));
    has.forEach((v) => left.delete(v));
    if (has.length) out.push([title, has]);
  }
  if (left.size) out.push(['More', [...left]]);
  return out;
}

// ---------------------------------------------------------------- lists of steps (Logic runtime v2: UCLink bSteps)
// A rule with rule.steps runs its "do" in its order (links.py step_items): each step's delay counts from the step
// before; If / Otherwise / End make branches (an If's conditions in its requires, all or any of them: match); Wait
// until waits for a character to arrive or a condition to hold (until, at most max seconds); a Wait of its own is
// {verb: 'wait'} with only its delay.
export const FLOW = new Set(['if', 'else', 'end', 'wait']);
export const isFlow = (x) => !!x && FLOW.has(x.verb);
// a rule made a list of steps (an If or a Wait until is added): its actions in the order of their time, each delay
// from the one before
export function toSteps(rule) {
  if (rule.steps) return rule;
  const acts = (rule.do || []).map((x, j) => ({ x, j })).sort((a, b) => timeOf(a.x) - timeOf(b.x) || a.j - b.j).map((a) => a.x);
  let t = 0;
  for (const x of acts) { const at = timeOf(x); x.delay = round(at - t); t = at; }
  rule.do = acts;
  rule.steps = true;
  return rule;
}
// the steps of a list in its order, each with how deep in If blocks it is: a step's own delay is a Wait row before it
function listSteps(rule) {
  const out = [];
  let depth = 0;
  (rule.do || []).forEach((x, j) => {
    if (x.verb === 'else' || x.verb === 'end') depth = Math.max(0, depth - 1);
    const pause = x.verb === 'wait' && !x.until;
    if (pause) out.push({ kind: 'wait', j, seconds: round(timeOf(x)), depth, pause: true });
    else {
      if (timeOf(x) > 0) out.push({ kind: 'wait', j, seconds: round(timeOf(x)), depth });
      out.push({ kind: x.verb === 'wait' ? 'until' : ['if', 'else', 'end'].includes(x.verb) ? x.verb : 'act', j, x, depth, at: 0 });
    }
    if (x.verb === 'if' || x.verb === 'else') depth++;
  });
  return out;
}
// the Otherwise and the End of the If at index i (-1: none)
export function blockOf(rule, i) {
  const list = rule.do || [];
  let depth = 0, otherwise = -1;
  for (let k = i + 1; k < list.length; k++) {
    const v = list[k].verb;
    if (v === 'if') depth++;
    else if (v === 'end') { if (!depth) return { otherwise, end: k }; depth--; }
    else if (v === 'else' && !depth) otherwise = k;
  }
  return { otherwise, end: -1 };
}
// steps added at `at` (the end of the list when not given): an If (and its End), an If with an Otherwise, a Wait
// until, a Wait; the rule made a list of steps first. -> the index of the first one
export function addFlow(rule, kind, at) {
  toSteps(rule);
  const list = rule.do, where = at === undefined || at < 0 || at > list.length ? list.length : at;
  const step = (verb, more = {}) => ({ verb, delay: 0, ...more });
  const items = kind === 'if' ? [step('if', { requires: [], match: 'all' }), step('end')]
    : kind === 'ifelse' ? [step('if', { requires: [], match: 'all' }), step('else'), step('end')]
      : kind === 'until' ? [step('wait', { until: { type: 'arrived', actor: '' }, max: 0 })]
        : [step('wait', { delay: 1 })];
  list.splice(where, 0, ...items);
  return where;
}
// a step taken out: an If with its Otherwise and End (the steps inside stay, in its place); an Otherwise alone
// (its steps join the If's); an End is not taken out on its own
export function removeStep(rule, j) {
  const list = rule.do || [], x = list[j];
  if (!x || x.verb === 'end') return false;
  const gone = [j];
  if (x.verb === 'if') { const b = blockOf(rule, j); if (b.otherwise >= 0) gone.push(b.otherwise); if (b.end >= 0) gone.push(b.end); }
  for (const k of gone.sort((a, b) => b - a)) list.splice(k, 1);
  return true;
}
// a step moved one place up (-1) or down (+1): into or out of a block as it passes its marker
export function moveStep(rule, j, dir) {
  const list = rule.do || [], k = j + dir;
  if (k < 0 || k >= list.length) return false;
  [list[j], list[k]] = [list[k], list[j]];
  return true;
}
// a step of a list in words: "if A is Yes:", "otherwise:", "wait until Guard2 arrives (at most 20 s)", "wait 2 s";
// words: {name(n), cond(c), storyTitle(key, id)}
export function flowText(x, words = {}) {
  const name = words.name || ((n) => n), cond = words.cond || ((c) => JSON.stringify(c));
  const title = (key, id) => (id ? `"${words.storyTitle ? words.storyTitle(key, id) : id}"` : '?');
  const most = +x.max > 0 ? ` (at most ${+x.max} s)` : '';
  switch (x.verb) {
    case 'if': return `if ${(x.requires || []).map(cond).join(x.match === 'any' ? ' or ' : ' and ') || '…'}:`;
    case 'else': return 'otherwise:';
    case 'end': return 'then';
    case 'wait':
      if (!x.until) return `wait ${round(timeOf(x))} s`;
      if (x.until.type === 'arrived') return `wait until ${x.until.actor ? name(x.until.actor) : '?'} arrives${most}`;
      // P5: the Story's (links.STORY_UNTIL)
      if (x.until.type === 'ended') return `wait until the dialogue ${title('dialogues', x.until.dialogue)} has ended${most}`;
      if (x.until.type === 'heard') return `wait until the InfoLink ${title('infolinks', x.until.infolink)} has been heard${most}`;
      return `wait until ${cond(x.until)}${most}`;
    default: return x.verb || '';
  }
}
// a list of steps in words, in its order: each step after its wait ("after 2 s ...")
export function stepsText(rule, actText, words) {
  return (rule.do || []).map((x) => {
    const pause = x.verb === 'wait' && !x.until;
    const t = isFlow(x) ? flowText(x, words) : actText(x);
    return pause ? t : (timeOf(x) > 0 ? `after ${round(timeOf(x))} s ` : '') + t;
  }).reduce((out, t) => (!out ? t : out + (out.endsWith(':') || out.endsWith(', then') ? ' ' : ', ') + t), '')     // "if A:" / "then" and its step, no comma
    .replace(/, then$/, '');                // an End that closes the list: nothing comes "then" (13 Nov 2026, Deep Ops)
}
