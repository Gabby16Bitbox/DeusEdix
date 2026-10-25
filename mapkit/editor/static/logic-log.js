// The logic log (editor/LOGIC.md): lines the game writes under the log tag DeusEdixLogic while Play runs
// (UCLink.Report, UCScript Input/Output), read back as sentences for the Console. Pure: tests/test_logic_log.mjs.
//
//   fire|map|rule|source|when|by|label      skip|map|rule|why|detail      act|map|rule|verb|target|detail
//   fail|map|rule|verb|target|why           hook|map|rule|source|why
//   input|map|script|name|args              output|map|script|name|count  noinput|map|script|name
import { conditionText } from './conditions.js';

export const LOGIC_TAG = 'DeusEdixLogic: ';

const FIELDS = {
  fire: ['map', 'rule', 'source', 'when', 'by', 'label'], skip: ['map', 'rule', 'why', 'detail'],
  act: ['map', 'rule', 'verb', 'target', 'detail'], fail: ['map', 'rule', 'verb', 'target', 'why'], hook: ['map', 'rule', 'source', 'why'],
  input: ['map', 'script', 'name', 'args'], output: ['map', 'script', 'name', 'count'], noinput: ['map', 'script', 'name'],
  bad: ['map', 'rule', 'detail'],
};

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
  return entry;
}

// "item|DeusEx.Multitool|1" (UCLink.Cond, conditions.py encode) -> the condition it says
export function decodeCondition(text) {
  const f = String(text).split('|');
  switch (f[0]) {
    case 'flag': return { flag: f[1], is: f[2] !== '0' };
    case 'item': return { type: 'item', item: f[1], has: f[2] !== '0' };
    case 'alive': return { type: 'alive', actor: f[1], is: f[2] !== '0' };
    case 'skill': return { type: 'skill', skill: f[1], level: +f[2] };
    case 'count': return { type: 'counter', counter: f[1], op: f[2], value: +f[3] };
    case 'credits': return { type: 'credits', op: f[1], value: +f[2] };
    default: return null;
  }
}

const SKIPS = { once: 'it runs only once, and has run', running: 'it is still doing its actions' };
const FAILS = { missing: 'it is not in the map', cannot: 'it cannot do that', nosound: 'there is no such sound',
  noname: 'it has no name', noscript: 'it is not a script', nofloor: 'it has no such floor',
  full: 'it said more than 8 outputs before the map started: this one was lost' };
const NONAME = { count: 'the counter has no name', flag: 'no state chosen', goal: 'the goal has no name' };
const HOOKS = { missing: 'is not in the map: the rule never runs', noslot: 'has no free slot left for this rule (4 untrigger events in use)',
  target: 'uses its event as a list of targets, or never sends it: a rule cannot start from it this way' };

// The sentence of an entry as parts: plain text, or {name} (an object to select) and {rule} (a rule to open).
// names: {actor(name), state(c)...} as conditions.js takes them.
export function logicSentence(e, names = {}) {
  const rule = e.rule ? [{ rule: e.rule }, ' '] : [];
  switch (e.kind) {
    case 'fire': return { mark: '▶', parts: [...rule, e.label || `${e.source} ${e.when}`, ...(e.by ? [' (by ', { name: e.by }, ')'] : [])] };
    case 'skip': return { mark: '⏸', parts: [...rule, 'did not run: ', e.why === 'cond'
      ? 'only if ' + (decodeCondition(e.detail) ? conditionText(decodeCondition(e.detail), names) : e.detail) + ' — and that does not hold'
      : SKIPS[e.why] || e.why] };
    case 'act': return { mark: '→', parts: ['  ', e.verb, ' ', ...(e.target ? [/^(area|tag) /.test(e.target) ? e.target : { name: e.target }] : []),
      ...(e.detail ? [`${e.target ? ' ' : ''}"${e.detail}"`] : [])] };
    case 'fail': return { mark: '✗', parts: ['  ', e.verb, ' ', ...(e.target ? [e.why === 'nosound' ? e.target : { name: e.target }] : []), ': ',
      (e.why === 'noname' && NONAME[e.verb]) || FAILS[e.why] || e.why] };     // (a sound's name: not an object)
    case 'hook': return { mark: '⚠', parts: [...rule, { name: e.source }, ' ', HOOKS[e.why] || e.why] };
    case 'input': return { mark: '↘', parts: [{ name: e.script }, ': input ', e.name, ...(e.args ? [' (', e.args.replace(/;/g, ', '), ')'] : [])] };
    case 'output': return { mark: '↗', parts: [{ name: e.script }, ' says ', e.name, ` (${+e.count || 0} rule${+e.count === 1 ? '' : 's'})`] };
    case 'noinput': return { mark: '✗', parts: [{ name: e.script }, ' has no input ', e.name, ': add it to its Input() switch'] };
    case 'bad': return { mark: '⚠', parts: [...rule, 'a condition this version of the game classes does not know: ', e.detail] };
    default: return { mark: '·', parts: [JSON.stringify(e)] };
  }
}
