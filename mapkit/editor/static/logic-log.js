// The logic log (editor/LOGIC.md): lines the game writes under the log tag DeusEdixLogic while Play runs
// (UCLink.Report, UCScript Input/Output), read back as sentences for the Console. Pure: tests/test_logic_log.mjs.
//
//   fire|map|rule|source|when|by|label      skip|map|rule|why|detail      act|map|rule|verb|target|detail
//   fail|map|rule|verb|target|why           hook|map|rule|source|why
//   input|map|script|name|args              output|map|script|name|count  noinput|map|script|name
//   check|map|rule|pass or fail|step|cond   until|map|rule|done or timeout|step|who   (a list of steps, Logic v2)
//   else|map|rule|source|when|by            (a rule's Otherwise runs: its conditions do not hold)
//   value|map|block|text                    (what a logic block holds now: "2/3", "open", "next 2", a phase...)
//   state|map|name|old|new                  (a state or counter watched while playing changed, UCLogicHub: "" not
//                                            set, "true"/"false" a state, a number a counter; old "" the first look)
//   start|map|name|value|set or kept         (a start value on the map's first visit, UCLogicHub: set, or kept as an
//                                            earlier map or a Play scenario had set it)
//   live|map|rule|what|detail               (live control from the editor while Play runs, P7: logic-live.js)
//   trace|map|rule|by|phase|bits             (a traced rule heard its cause: its phase and conditions then, 1 or 0)
//   break|map|rule|why|step                  (the game paused at a rule: it runs, or after its action)
// A rule of the Logic runtime v2 (UCRule) names itself "rule@time#step": the game time of the line in seconds
// (entry.time) and the editor's id of the step doing it (entry.at).
import { conditionText } from './conditions.js';
import { formulaText } from './logic-numbers.js';

export const LOGIC_TAG = 'DeusEdixLogic: ';

const FIELDS = {
  fire: ['map', 'rule', 'source', 'when', 'by', 'label'], skip: ['map', 'rule', 'why', 'detail'],
  act: ['map', 'rule', 'verb', 'target', 'detail'], fail: ['map', 'rule', 'verb', 'target', 'why'], hook: ['map', 'rule', 'source', 'why'],
  input: ['map', 'script', 'name', 'args'], output: ['map', 'script', 'name', 'count', 'value'], noinput: ['map', 'script', 'name'],
  bad: ['map', 'rule', 'detail'],
  check: ['map', 'rule', 'result', 'step', 'detail'], until: ['map', 'rule', 'result', 'step', 'who'],
  else: ['map', 'rule', 'source', 'when', 'by'],
  value: ['map', 'block', 'text'],                    // what a logic block holds now (UCBlock.Value, P3)
  state: ['map', 'name', 'old', 'new'],               // a watched state or counter changed (UCLogicHub, P5)
  start: ['map', 'name', 'value', 'how'],             // a start value on the map's first visit (UCLogicHub, P5)
  live: ['map', 'rule', 'verb', 'detail'],            // live control from the editor (P7, logic-live.js)
  trace: ['map', 'rule', 'by', 'phase', 'bits'],      // a traced rule heard its cause (P7)
  break: ['map', 'rule', 'why', 'step'],              // the game paused at a rule (P7)
  prop: ['map', 'rule', 'target', 'name', 'value'],   // a property set by a rule, as the game took it (P9 slice 4)
};
// a watched state's or counter's value as the game writes it -> words: "Yes", "No", "3", "not set"
export function stateValueText(v) {
  const t = String(v ?? '');
  return t === 'true' ? 'Yes' : t === 'false' ? 'No' : t === '' ? 'not set' : t;
}
// a logic block's value as the game writes it ("2/3", "open", "next 2", "picked 1", "over", "2/3 hold", "clock 10",
// "first 2", "timed out", "waiting", a phase's name) -> words
export function blockValueText(text) {
  const t = String(text || ''), m = /^(\d+)\/(\d+)( hold)?$/.exec(t), w = /^(next|picked|clock|first) (\d+)$/.exec(t);
  if (m) return `${m[1]} of ${m[2]} ${m[3] ? 'hold' : 'done'}`;
  const c = /^count (-?\d+)(?:\/(\d+))?$/.exec(t);     // a Counter (UCBCounter.Show)
  if (c) return c[2] ? `count: ${c[1]} of ${c[2]}` : `count: ${c[1]}`;
  if (w) return { next: `way ${w[2]} next`, picked: `picked way ${w[2]}`, clock: `the clock runs: ${w[2]} s`, first: `${w[2]} came first` }[w[1]];
  return { open: 'open', closed: 'closed', over: 'no more ways', 'timed out': 'the time ran out', waiting: 'waiting' }[t] || t;
}

// a line of the game's log -> {kind, map, rule, ...}, or null when it is not one of the logic log
export function parseLogicLine(line) {
  if (!String(line).startsWith(LOGIC_TAG)) return null;
  const parts = String(line).slice(LOGIC_TAG.length).split('|');
  const names = Object.hasOwn(FIELDS, parts[0]) ? FIELDS[parts[0]] : null;      // not 'constructor'...
  if (!names) return null;
  const entry = { kind: parts[0] };
  // the last field keeps any | after it (a label, a condition's own fields)
  names.forEach((name, i) => { entry[name] = i === names.length - 1 ? parts.slice(i + 1).join('|') : parts[i + 1] ?? ''; });
  if (/^UCLink_/.test(entry.rule || '')) entry.rule = entry.rule.slice(7);      // a map built before rules had an id
  const m = /^([^@#]*)(?:@(\d+(?:\.\d+)?))?(?:#(\w+))?$/.exec(entry.rule || '');
  if (m && (m[2] || m[3])) {                          // UCRule: rule@time#step
    entry.rule = m[1];
    if (m[2]) entry.time = +m[2];
    if (m[3]) entry.at = m[3];
  }
  return entry;
}

// "item|DeusEx.Multitool|1" (UCLink.Cond, conditions.py encode) -> the condition it says
export function decodeCondition(text) {
  const f = String(text).split('|');
  const num = (s) => (String(s).startsWith('=') ? formulaText(s) : +s);      // a formula of counters (P9 slice 5): its text
  switch (f[0]) {
    case 'flag': return { flag: f[1], is: f[2] !== '0' };
    case 'item': return { type: 'item', item: f[1], has: f[2] !== '0' };
    case 'alive': return { type: 'alive', actor: f[1], is: f[2] !== '0' };
    case 'skill': return { type: 'skill', skill: f[1], level: +f[2] };
    case 'count': return { type: 'counter', counter: f[1], op: f[2], value: num(f[3]) };
    case 'credits': return { type: 'credits', op: f[1], value: num(f[2]) };
    case 'near': return { type: 'near', at: [+f[1] || 0, +f[2] || 0, +f[3] || 0], radius: +f[4] || 0, is: f[5] !== '0' };
    // the player's own (P9 slice 2)
    case 'health': case 'energy': case 'skillpoints': return { type: f[0], op: f[1], value: num(f[2]) };
    case 'aug': return { type: 'aug', aug: f[1], how: f[2], ...(f[2] === 'level' ? { level: +f[3] } : {}), is: f[4] !== '0' };
    case 'water': return { type: 'water', is: f[1] !== '0' };
    case 'zone': return { type: 'zone', zone: f[1], is: f[2] !== '0' };
    case 'items': return { type: 'items', item: f[1], op: f[2], value: num(f[3]) };
    default: return null;
  }
}

const SKIPS = { once: 'it runs only once, and has run', running: 'it is still doing its actions',
  max: 'it has run as many times as it may', cooldown: 'too soon after its last run', restarted: 'set off again: it starts over',
  cancelled: 'another rule stopped it', talking: 'the player is talking: it gives up', full: 'it already runs 8 times at once',
  how: 'it happened the other way (killed, not knocked out, or the other way round)',
  phase: 'it works only in some phases, and this is not one of them',
  muted: 'it is muted for this Play' };
const FAILS = { missing: 'it is not in the map', cannot: 'it cannot do that', nosound: 'there is no such sound',
  noname: 'it has no name', noscript: 'it is not a script', nofloor: 'it has no such floor',
  nophase: 'it has no such phase',
  // P9 slice 4: an augmentation, a property
  noaug: 'the game has no such augmentation', noslot: 'the player has no free slot for it',
  nothad: 'the player does not have it', noprop: 'it is not a property the rules may set',
  full: 'it said more than 8 outputs before the map started: this one was lost',
  loop: 'its steps went round 256 times with no end: stopped (a wait in the loop lets it go on)',
  fast: 'it was set off more than 20 times in a second: it waits for the next second (do rules set each other off?)',
  blocked: 'there is no room there',
  // P5: the Story's dialogue or InfoLink (UCLink.StoryAction)
  busy: 'the player is already talking', refused: 'the game would not start it now',
  unmet: "the dialogue's own conditions do not hold", played: 'it plays once, and it was played already',
  heard: 'it plays once, and it was heard already', nostory: "the map's Story is not in the game yet: Build the map",
  off: "the map's Story does not run here yet" };
// a rule's dialogue, InfoLink (P5): the Story's id, said by its title when names.storyTitle knows it
const STORY_VERBS = { talk: ['dialogues', 'start the dialogue'], infolink: ['infolinks', 'play the InfoLink'] };
const storyName = (verb, id, names) => `"${names.storyTitle ? names.storyTitle(STORY_VERBS[verb][0], id) : id}"`;
// a Wait until the Story's end (P5): its Tag, UCD_<id> / UCI_<id>, said by the title
function storyEnd(who, names) {
  const m = /^UC([DI])_(.+)$/i.exec(who || '');
  if (!m) return null;
  const d = m[1].toUpperCase() === 'D', id = m[2], key = d ? 'dialogues' : 'infolinks';
  const t = `"${names.storyTitle ? names.storyTitle(key, id) : id}"`;
  return [d ? `the dialogue ${t} has ended: on` : `the InfoLink ${t} has been heard: on`];
}
const NOCLASS = { giveitem: 'the game has no such item', spawn: 'the game has no such character', music: 'the game has no such music',
  aug: 'the game has no such augmentation' };
const NONAME = { count: 'the counter has no name', flag: 'no state chosen', goal: 'the goal has no name', signal: 'the signal has no name',
  talk: 'no dialogue chosen', infolink: 'no InfoLink chosen' };
const STORY_MISSING = { talk: "the map's Story has no such dialogue, or its character is not in the map",
  infolink: "the map's Story has no such InfoLink" };
const HOOKS = { missing: 'is not in the map: the rule never runs', noslot: 'has no free slot left for this rule (4 untrigger events in use)',
  target: 'uses its event as a list of targets, or never sends it: a rule cannot start from it this way' };

// who set a rule off: an object; the map's Story (its class UCEd_<map>: a signal, a dialogue's end...); another rule
// (its UCLink_<id>: a signal it sent)
function byParts(by) {
  if (!by) return [];
  // (UCLink<n>: the one rule the Story spawns to do its Logic actions, UCEditorStory.RunAct; the map's are UCLink_<id>)
  if (/^(UCEd_\w+|UCLink\d+)$/i.test(by)) return [' (by the Story)'];
  const r = /^UCLink_(\w+)$/i.exec(by);
  return r ? [' (by rule ', { rule: r[1] }, ')'] : [' (by ', { name: by }, ')'];
}
// The sentence of an entry as parts: plain text, or {name} (an object to select) and {rule} (a rule to open).
// names: {actor(name), state(c)...} as conditions.js takes them.
export function logicSentence(e, names = {}) {
  const rule = e.rule ? [{ rule: e.rule }, ' '] : [];
  // an action the Story did (P5, UCEditorStory.RunAct: the rule "story:<event, dialogue or InfoLink id>"): no rule's
  // line before it, so it says who did it
  const lead = /^story:/i.test(e.rule || '') ? 'The Story: ' : '  ';
  switch (e.kind) {
    case 'fire': return { mark: '▶', parts: [...rule, e.label || `${e.source} ${e.when}`, ...byParts(e.by)] };
    case 'skip': return { mark: '⏸', parts: [...rule, 'did not run: ', e.why === 'cond'
      ? 'only if ' + (decodeCondition(e.detail) ? conditionText(decodeCondition(e.detail), names) : e.detail) + ' — and that does not hold'
      : SKIPS[e.why] || e.why] };
    case 'else': return { mark: '↪', parts: [...rule, 'its Otherwise', ...byParts(e.by)] };
    case 'act': if (STORY_VERBS[e.verb]) return { mark: '→', parts: ['  ', STORY_VERBS[e.verb][1], ' ', storyName(e.verb, e.detail, names)] };
      if (e.verb === 'spawned') return { mark: '→', parts: ['  ', `${+e.detail || 0} came`, ...(e.target ? [` (${e.target})`] : [])] };
      return { mark: '→', parts: [lead, e.verb, ' ', ...(e.target ? [/^(area|tag|group) /.test(e.target) ? e.target : { name: e.target }] : []),
      ...(e.detail ? [`${e.target ? ' ' : ''}"${e.detail.startsWith('=') ? formulaText(e.detail) : e.detail}"`] : [])] };
    case 'fail': if (STORY_VERBS[e.verb]) {
      return { mark: '✗', parts: ['  ', STORY_VERBS[e.verb][1], ...(e.target ? [' ', storyName(e.verb, e.target, names)] : []), ': ',
        (e.why === 'noname' && NONAME[e.verb]) || (e.why === 'missing' && STORY_MISSING[e.verb]) || FAILS[e.why] || e.why] };
    }
      return { mark: '✗', parts: [lead, e.verb, ' ', ...(e.target ? [e.why === 'nosound' || e.why === 'nophase' || NOCLASS[e.verb] ? e.target : { name: e.target }] : []), ': ',
      (e.why === 'noname' && NONAME[e.verb]) || (e.why === 'missing' && NOCLASS[e.verb]) || FAILS[e.why] || e.why] };     // (a sound's name: not an object)
    case 'hook': return { mark: '⚠', parts: [...rule, { name: e.source }, ' ', HOOKS[e.why] || e.why] };
    case 'input': return { mark: '↘', parts: [{ name: e.script }, ': input ', e.name, ...(e.args ? [' (', e.args.replace(/;/g, ', '), ')'] : [])] };
    case 'output': return { mark: '↗', parts: [{ name: e.script }, ' says ', e.name, ...(e.value ? [` with ${e.value}`] : []),     // (OutputValue: P8 slice 5b)
      ` (${+e.count || 0} rule${+e.count === 1 ? '' : 's'})`] };
    case 'noinput': return { mark: '✗', parts: [{ name: e.script }, ' has no input ', e.name, ': add it to its Input() switch'] };
    case 'check': {                                   // an If of a list of steps
      const c = e.result === 'fail' && e.detail ? decodeCondition(e.detail) : null;
      return { mark: '◇', parts: [...rule, e.result === 'pass' ? 'the If holds: its steps' : `the If does not hold`
        + `${c ? ` (${conditionText(c, names)})` : ''}: its Otherwise, or on after it`] };
    }
    case 'until': return { mark: '⏱', parts: [...rule, ...(e.result === 'timeout' ? ['the wait ran out: on with the next step']
      : storyEnd(e.who, names) || (e.who ? [{ name: e.who }, ' has arrived: on'] : ['what it waited for is so: on']))] };
    case 'bad': return { mark: '⚠', parts: [...rule, 'a condition this version of the game classes does not know: ', e.detail] };
    case 'value': return { mark: '▣', parts: [{ name: e.block }, ': ', blockValueText(e.text)] };
    case 'state': return { mark: '◆', parts: [e.name, e.old === '' ? ` is ${stateValueText(e.new)}`
      : `: ${stateValueText(e.old)} → ${stateValueText(e.new)}`] };
    case 'start': return { mark: '◆', parts: [e.name, e.how === 'kept' ? ` keeps ${stateValueText(e.value)}: it was set before this map`
      : ` starts as ${stateValueText(e.value)}`] };
    case 'live': return { mark: '⌁', parts: liveParts(e, rule) };
    case 'trace': return { mark: '⌕', parts: [...rule, 'heard it', ...byParts(e.by), ': ', traceWords(e, names)] };
    case 'prop': return { mark: '→', parts: [lead, { name: e.target }, `: ${e.name} is now ${e.value}`] };
    case 'break': return { mark: '⏯', parts: [...rule, e.why === 'act'
      ? `the game is paused after its step ${(+e.step || 0) + 1}` : 'the game is paused here: it runs'] };
    default: return { mark: '·', parts: [JSON.stringify(e)] };
  }
}

// ---------------------------------------------------------------- live control (P7)
const LIVE = { fire: 'set off from the editor', step: 'Step: one action, then the game pauses',
  'mute on': 'muted for this Play', 'mute off': 'heard again', 'trace on': 'traced: each time it is set off, how its conditions are',
  'trace off': 'no longer traced', 'break on': 'the game pauses when it runs', 'break off': 'the game no longer pauses on it' };
const LIVE_GAME = { continue: 'The game goes on', resumed: 'The game goes on',
  clear: 'No rule is muted, traced or paused on any more' };
function liveParts(e, rule) {
  if (e.rule) return [...rule, LIVE[e.detail ? `${e.verb} ${e.detail}` : e.verb] || `${e.verb} ${e.detail}`.trim()];
  if (e.verb === 'set') {
    const [name, value] = String(e.detail).split('=');
    return [name, ` set to ${stateValueText({ yes: 'true', no: 'false' }[value] ?? value)} from the editor`];
  }
  if (e.verb === 'input' || e.verb === 'happen') return [e.detail, ' from the editor'];
  return [LIVE_GAME[e.verb] || e.verb];
}
// a trace's phase and conditions in words: with names.conditionsOf(rule) (the rule's requires, in order) each by its
// sentence, else as how many hold
function traceWords(e, names) {
  const conds = String(e.bits || '').split('').filter((x) => x === '0' || x === '1').map((x) => x === '1');
  const phase = e.phase === '1' ? 'in its phase' : e.phase === '0' ? 'not in its phase' : '';
  const reqs = names.conditionsOf ? names.conditionsOf(e.rule) || [] : [];
  let words;
  if (!conds.length) words = 'it has no conditions';
  else if (reqs.length === conds.length) {
    words = conds.map((ok, i) => { let t; try { t = conditionText(reqs[i], names); } catch { t = `condition ${i + 1}`; } return `${t} ${ok ? '✓' : '✗'}`; }).join(', ');
  } else words = `${conds.filter(Boolean).length} of ${conds.length} conditions hold`;
  return phase ? `${phase}; ${words}` : words;
}
