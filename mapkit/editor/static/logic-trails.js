// Trails (P2, final_design.json debugging 4): what the rules did in the game, drawn on the Logic window's graph and
// on the 3D view's wires, during Play and after it. The Console follows the game's log (every 0.4 s while Play runs)
// and hands its logic lines (logic-log.js) to a trail store; the window marks its graph with them (how many times a
// rule ran and when last, the condition that did not hold, the step that failed, what a block holds) and lights the
// wires a run went along. The whole session is kept as a timeline to scrub and replay until "Clear trails" or the next
// game. Until the game writes its time on every line (the Logic runtime v2's rules already do: rule@time), a line's
// time is when the editor got it, so it is 0.4-1 s late: enough to see the flow, not to time an animation.
//
// Pure (no DOM): tests/test_logic_trails.mjs. The rules come as logic-graph-model.js logicIndex's (ix.rules).
import { LOGIC_TAG, parseLogicLine, logicSentence, decodeCondition, blockValueText } from './logic-log.js';
import { conditionText, kindOf } from './conditions.js';

const low = (s) => String(s ?? '').toLowerCase();
const mapKey = (m) => low(m).replace(/\.(dx|unr)$/, '');
export const sameMap = (a, b) => mapKey(a) === mapKey(b);
const round = (t) => Math.round(t * 1000) / 1000;
// a line read back from the log with no time of its own (the Console opened after Play, Show the last Play): this
// far after the line before it, so that a replay still goes line by line
export const UNTIMED_STEP = 0.25;
export const MAX_LINES = 20000;

// The store: the logic lines of the game that runs or ran last, in the order they came, each with its time (seconds
// from the first, or from Play's start when it is known).
//   add(texts, {at, started})  lines of the game's log (only its logic lines are kept); at: when they came (ms since
//                              1970), null when read back from the log; started: when Play started (ms), if known
//   restart()                  a new game: its log starts again
//   clear()                    Clear trails (the same game goes on)
//   lines(map)                 that map's lines, [{n, t, timed, live (it came while the game ran), text, entry}]
//   subscribe(f)               f({added}) or f({reset}); returns the unsubscribe
export function createTrails({ max = MAX_LINES } = {}) {
  let all = [], base = null, seq = 0;
  const subs = new Set();
  const tell = (what) => { for (const f of [...subs]) { try { f(what); } catch (_) { /* one listener's error is its own */ } } };
  return {
    add(texts, { at = null, started = null } = {}) {
      const fresh = [];
      for (const raw of [].concat(texts || [])) {
        const text = String(raw);
        const entry = parseLogicLine(text.startsWith(LOGIC_TAG) ? text : LOGIC_TAG + text);
        if (!entry) continue;
        const last = all.length ? all[all.length - 1].t : 0;
        let t;
        if (Number.isFinite(at)) {
          if (base === null) base = Number.isFinite(started) && started <= at ? started : at;
          t = (at - base) / 1000;
        } else t = Number.isFinite(entry.time) ? entry.time : all.length ? last + UNTIMED_STEP : 0;
        const line = { n: seq++, t: round(Math.max(t, last)), timed: Number.isFinite(at) || Number.isFinite(entry.time), live: Number.isFinite(at),
          text: text.startsWith(LOGIC_TAG) ? text.slice(LOGIC_TAG.length) : text, entry };
        all.push(line);
        fresh.push(line);
      }
      if (all.length > max) all.splice(0, all.length - max);
      if (fresh.length) tell({ added: fresh });
      return fresh.length;
    },
    restart() { all = []; base = null; tell({ reset: true }); },
    clear() { all = []; tell({ reset: true }); },
    lines: (map) => (map === undefined ? all.slice() : all.filter((l) => sameMap(l.entry.map, map))),
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    get size() { return all.length; },
  };
}

// ---------------------------------------------------------------- a line -> the graph's parts
// a rule's action a line names: by its step id (rule@time#a2), else by what it does to what, else by what it acts on
export function actionOf(r, e) {
  const acts = [...(r.acts || []), ...(r.otherwise || [])];
  if (e.at) { const a = acts.find((x) => x.id === e.at); if (a) return a; }
  const target = low(e.target);
  return acts.find((x) => low(x.x.verb) === low(e.verb) && low(x.x.target) === target)
    || (target ? acts.find((x) => low(x.x.target) === target) : null)
    || (acts.filter((x) => low(x.x.verb) === low(e.verb)).length === 1 ? acts.find((x) => low(x.x.verb) === low(e.verb)) : null)
    || null;
}
// the condition of a rule a skip|cond line names (logic-log.js decodeCondition): its index in the rule's requires, -1
const condName = (c) => { const k = kindOf(c) || c.type; return `${k}|${low({ flag: c.flag, item: c.item, alive: c.actor, skill: c.skill, counter: c.counter }[k] || k)}`; };
export function conditionOf(r, detail) {
  const d = decodeCondition(detail), reqs = (r.l && r.l.requires) || [];
  if (!d) return -1;
  const text = conditionText(d), same = reqs.findIndex((c) => { try { return conditionText(c) === text; } catch { return false; } });
  return same >= 0 ? same : reqs.findIndex((c) => condName(c) === condName(d));
}
// the wires of the graph a line lights (graph-canvas.js pulse): a run its cause's wire (a simple rule: its own wire),
// an action its step's wire
export function wiresOf(r, e) {
  if (!r) return [];
  if (e.kind === 'fire' || e.kind === 'else') {
    if (r.simple) return e.kind === 'fire' ? [r.node] : [];
    const at = (r.causes || []).map((c, i) => ({ c, i })), mine = at.filter(({ c }) => low(c.src) === low(e.source));
    return (mine.length ? mine : at).map(({ i }) => `${r.node}/cause${i}`);
  }
  if (e.kind === 'act') {
    if (r.simple) return [r.node];
    const a = actionOf(r, e);
    return a && a.node ? [a.wire] : [];
  }
  return [];
}

// What the lines up to `upTo` say, part by part:
//   rules   rule id -> {fired, otherwise, skipped, failed, last (s), skip (the last reason), skips {why: n}, hook}
//   steps   an action's wire id (act:L7/a1) -> {done, failed, last, why}
//   conds   `${rule node}|if:${i}` -> {n, last}: a condition that did not hold when the rule heard its cause
//   blocks  a block's name (lower case) -> {text, t}: what it held last
//   states  a watched state's or counter's name (lower case) -> {name, value, old, t, changes}: what it held last
//           (UCLogicHub's state lines: value "" not set, "true"/"false", a number), when it last changed, how often
export function trailMarks(lines, ix, upTo = Infinity) {
  const byId = new Map((ix.rules || []).map((r) => [r.id, r]));
  const rules = new Map(), steps = new Map(), conds = new Map(), blocks = new Map(), states = new Map();
  const ofRule = (id) => rules.get(id) || rules.set(id, { fired: 0, otherwise: 0, skipped: 0, failed: 0, last: null, skip: '', skips: {}, hook: '' }).get(id);
  const ofStep = (id) => steps.get(id) || steps.set(id, { done: 0, failed: 0, last: null, why: '' }).get(id);
  for (const l of lines) {
    if (l.t > upTo) break;
    const e = l.entry;
    if (e.kind === 'value') { blocks.set(low(e.block), { text: e.text, t: l.t }); continue; }
    if (e.kind === 'state') {
      const was = states.get(low(e.name));
      states.set(low(e.name), { name: e.name, value: e.new, old: e.old, t: l.t, live: !!l.live, changes: (was ? was.changes : 0) + (e.old === '' && !was ? 0 : 1) });
      continue;
    }
    const r = byId.get(e.rule);
    if (!r) continue;
    const m = ofRule(r.id);
    if (e.kind === 'fire') { m.fired++; m.last = l.t; } else if (e.kind === 'else') { m.otherwise++; m.last = l.t; } else if (e.kind === 'skip') {
      m.skipped++; m.skip = e.why; m.skips[e.why] = (m.skips[e.why] || 0) + 1;
      if (e.why === 'cond') {
        const i = conditionOf(r, e.detail);
        if (i >= 0) { const k = `${r.node}|if:${i}`, c = conds.get(k) || conds.set(k, { n: 0, last: null }).get(k); c.n++; c.last = l.t; }
      }
    } else if (e.kind === 'act') { const a = actionOf(r, e); if (a) { const s = ofStep(a.wire); s.done++; s.last = l.t; } } else if (e.kind === 'fail') {
      m.failed++;
      const a = actionOf(r, e);
      if (a) { const s = ofStep(a.wire); s.failed++; s.last = l.t; s.why = logicSentence(e).parts.map((p) => (typeof p === 'string' ? p : p.name || p.rule)).join('').trim(); }
    } else if (e.kind === 'hook') m.hook = e.why;
  }
  return { rules, steps, conds, blocks, states };
}

export const secs = (t) => (t === null || t === undefined ? '' : `${Math.round(t * 10) / 10} s`);
// a rule's trail in a few words, on its card: "ran 3× · 12.4 s", "did not run ×2", "1 failed"
export function trailText(m) {
  if (!m) return '';
  const parts = [];
  if (m.fired) parts.push(`ran ${m.fired}×${m.last !== null ? ' · ' + secs(m.last) : ''}`);
  else if (m.otherwise) parts.push(`its Otherwise ${m.otherwise}×${m.last !== null ? ' · ' + secs(m.last) : ''}`);
  else if (m.skipped) parts.push(`did not run ×${m.skipped}`);
  else if (m.hook) parts.push('never set off');
  if (m.fired && m.otherwise) parts.push(`Otherwise ${m.otherwise}×`);
  if (m.failed) parts.push(`${m.failed} failed`);
  return parts.join(' · ');
}
const SKIP_WORDS = { once: 'it runs only once', running: 'it was still running', cond: 'a condition did not hold', phase: 'not in this phase',
  cooldown: 'too soon after the last run', max: 'it had run as often as it may', talking: 'the player was talking', full: '8 runs at once' };
// the same, as its tooltip: every count and why it did not run
export function trailTitle(m) {
  if (!m) return '';
  const out = [];
  if (m.fired) out.push(`Ran ${m.fired} time${m.fired === 1 ? '' : 's'}${m.last !== null ? `, the last at ${secs(m.last)}` : ''}.`);
  if (m.otherwise) out.push(`Its Otherwise ran ${m.otherwise} time${m.otherwise === 1 ? '' : 's'}.`);
  for (const [why, n] of Object.entries(m.skips)) out.push(`Did not run ${n} time${n === 1 ? '' : 's'}: ${SKIP_WORDS[why] || why}.`);
  if (m.failed) out.push(`${m.failed} action${m.failed === 1 ? '' : 's'} failed.`);
  if (m.hook) out.push('It could not be hooked to what sets it off: it never runs.');
  return out.join('\n');
}

// The canvas's data (logic-window.js canvasOf) marked with the trails: a rule card's count in its header (live), a
// chip on each step that ran or failed and on each condition that did not hold, a simple rule's count on its wire's
// label, a block's value in its header. graph: the model's graph shown (its nodes' names, for the blocks). Returns
// whether anything was marked.
export function markTrails(shown, marks, graph = { nodes: [] }) {
  let any = false;
  const nameOf = new Map((graph.nodes || []).map((n) => [n.id, n.name]));
  const block = (id) => {
    const name = nameOf.get(id), bare = String(id).replace(/^(obj|blk|ph):/, '');
    return marks.blocks.get(low(name)) || marks.blocks.get(low(bare)) || null;
  };
  for (const n of shown.nodes) {
    if (n.kind === 'rule') {
      const m = marks.rules.get(String(n.id).replace(/^rule:/, ''));
      if (m) { n.live = trailText(m); n.label = `${n.label || n.title}. In the Play: ${trailTitle(m).replace(/\n/g, ' ')}`; any = true; }
      for (const row of n.rows || []) {
        const c = marks.conds.get(`${n.id}|${row.id}`), s = marks.steps.get(row.id);
        if (c) {
          row.chips = [...(row.chips || []), { text: `no ×${c.n}`, tone: 'bad', title: `It did not hold when the rule heard its cause, ${c.n} time${c.n === 1 ? '' : 's'} (the last at ${secs(c.last)})` }];
          any = true;
        }
        if (s && s.failed) { row.chips = [...(row.chips || []), { text: 'failed', tone: 'bad', title: s.why || 'It failed' }]; any = true; } else if (s && s.done) {
          row.chips = [...(row.chips || []), { text: `×${s.done}`, tone: 'ok', title: `Done ${s.done} time${s.done === 1 ? '' : 's'}, the last at ${secs(s.last)}` }];
          any = true;
        }
      }
    } else {
      const b = block(n.id);
      if (b) { n.live = blockValueText(b.text); any = true; }
    }
  }
  for (const w of shown.wires) {
    if (!/^rule:[^/]+$/.test(String(w.id))) continue;            // a simple rule drawn as its wire
    const m = marks.rules.get(String(w.id).slice(5));
    if (!m || !(m.fired || m.skipped || m.failed)) continue;
    w.label = `${w.label || ''}${w.label ? ' · ' : ''}${m.fired ? `ran ${m.fired}×` : `did not run ×${m.skipped}`}${m.failed ? ` · ${m.failed} failed` : ''}`;
    w.title = `${w.title ? w.title + '\n\n' : ''}In the Play: ${trailTitle(m)}`;
    if (m.failed) w.tone = 'bad';
    any = true;
  }
  return any;
}

// the lines a move along the timeline went past: from < t <= to (a step back: none)
export const crossed = (lines, from, to) => lines.filter((l) => l.t > from && l.t <= to);
// what a set of lines lights: the graph's wires and rule cards (a simple rule is its wire), and the rules for the 3D
// view's wires
export function lightOf(lines, ix) {
  const byId = new Map((ix.rules || []).map((r) => [r.id, r]));
  const wires = new Set(), nodes = new Set(), rules = new Set();
  for (const l of lines) {
    const r = byId.get(l.entry.rule);
    if (!r) continue;
    for (const w of wiresOf(r, l.entry)) wires.add(w);
    if (l.entry.kind === 'fire' || l.entry.kind === 'else' || l.entry.kind === 'fail') { if (!r.simple) nodes.add(r.node); rules.add(r.id); }
    if (l.entry.kind === 'act') rules.add(r.id);
  }
  return { wires: [...wires], nodes: [...nodes], rules: [...rules] };
}
// the timeline's place in words: a line's sentence (logic-log.js), its names as the window says them; words: what
// else the sentence takes (storyTitle: a dialogue's, an InfoLink's title)
export function lineWords(l, name = (n) => n, words = {}) {
  const { mark, parts } = logicSentence(l.entry, words);
  return `${mark} ${parts.map((p) => (typeof p === 'string' ? p : p.rule ? p.rule : name(p.name))).join('')}`.replace(/\s+/g, ' ').trim();
}
