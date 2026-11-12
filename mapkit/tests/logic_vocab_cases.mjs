// The cases the logic's sentences are checked on (tests/test_logic_vocab.mjs): every output and every verb that
// app.js worded on 27 Oct 2026 (LK_WHEN, LK_VERBS), with the arguments that change their sentence, the labels by
// family, the kinds' nouns and whole rules. appSentences runs app.js's own declarations on them, loaded by name
// into a vm, while app.js still has them; tests/logic_sentences_20261027.json keeps what they said, for after
// they move to static/logic-vocab.js (backup/20261027_logic_phase_a/vocabulary/write_golden.mjs wrote it).
import vm from 'node:vm';
import { BLOCK_WHEN, BLOCK_VERBS, blockWhenText, blockActText } from '../editor/static/interaction-blocks.js';
import { conditionText } from '../editor/static/conditions.js';
import { fateFlag, parseFate, stateLabel } from '../editor/static/state-model.js';
import { AREA_VERBS } from '../editor/static/connect-area.js';
import { optionsText } from '../editor/static/logic-rule-ui.js';
import { stepsText } from '../editor/static/action-list.js';
import { isFormula, valueText } from '../editor/static/logic-numbers.js';
import { goalTexts } from '../editor/static/logic-vocab.js';

// the outputs, verbs and families of 27 Oct 2026
export const OUTPUTS = ['opened', 'closed', 'destroyed', 'used', 'code', 'wrongcode', 'option', 'enter', 'leave', 'laser', 'alarm',
  'dies', 'any', 'picked', 'gone', 'near', 'arrived', 'start', 'animdone', 'cutstart', 'cutdone', 'npcused', 'finished', 'stopped', 'output', 'bodydone', 'keypress'];
export const VERBS = ['open', 'close', 'toggle', 'lock', 'unlock', 'blow', 'key', 'attack', 'hostile', 'friend', 'neutral', 'stand',
  'wander', 'follow', 'goto', 'run', 'leave', 'appear', 'npcuse', 'lighton', 'lightoff', 'lighttoggle', 'on', 'off', 'hide', 'show',
  'explode', 'sound', 'effect', 'anim', 'animback', 'animstop', 'cutplay', 'cutstop', 'timerstart', 'timerstop', 'timerpause',
  'timerresume', 'input', 'floor', 'message', 'goal', 'note', 'flag', 'count', 'travel', 'sit', 'standup', 'body', 'bodystop', 'fpmoment'];
// an object of each family
export const ACTOR = { other: 'Thing1', door: 'Door3', elevator: 'Lift1', keypad: 'Pad1', computer: 'Comp1', character: 'Guard1',
  carcass: 'Body1', laser: 'Laser1', beam: 'Beam1', alarm: 'Siren1', camera: 'Cam1', turret: 'Gun1', soundfx: 'Music1', zone: 'Zone1',
  targettrigger: 'Orders1', switchtrigger: 'Burn1', moretrigger: 'More1', light: 'Lamp1', switchlight: 'Cage1', item: 'Item1',
  object: 'Button1', timer: 'Timer1', cutscene: 'Cut1', effectpoint: 'P1', script: 'Gen0' };
// the families of 27 Oct, and those P4 added (5 Nov: crates, hackable devices) and P3 (the logic blocks), not in the 27 Oct sentences
const OCT27 = Object.keys(ACTOR);
export const FAMILIES = [...OCT27, 'crate', 'hackable', 'allof', 'gate', 'switchblock', 'phases', 'atleast', 'firstof', 'counterblock', 'logicblock'];   // P3 (7 Nov): the logic blocks (the Counter: slice 6)
// verbs whose "objects tagged X" sentence was "goe to floor", "goe and uses": not offered for tags (TAG_VERBS), worded
// right in logic.json ('many') and checked on their own
export const TAG_FIXED = ['floor', 'npcuse'];

// What the page knows about the map, the same for app.js's functions and for the vocabulary (ctx)
const FAMILY = { ...Object.fromEntries(Object.entries(ACTOR).map(([f, n]) => [n, f])), Crate: 'object' };
const OPTIONS = { Comp1: ['Unlock the vault', '', 'Call the guards', ''] };
const PORTS = { Gen0: { 'output:Sabotaged': 'Sabotaged!', 'input:Start': 'Start the generator' } };
const ITEMS = { 'DeusEx.Multitool': 'Multitool' };
const USABLE = new Set(['Crate']);
const has = (table, key) => Object.hasOwn(table, key);
export const world = {
  name: (n) => (!n ? 'nothing' : has(FAMILY, n) ? `the ${FAMILY[n]} ${n}` : `${n} (missing)`),
  family: (n) => (n && has(FAMILY, n) ? FAMILY[n] : 'other'),
  usable: (n) => USABLE.has(n),
  optionText: (l) => (OPTIONS[l.src] || [])[+l.option || 0] || '',
  portLabel: (n, key) => (has(PORTS, n) && PORTS[n][key]) || key.split(':')[1] || '?',
  itemName: (cls) => ITEMS[cls] || String(cls).split('.').pop(),
};

const SOURCE = { opened: 'Door3', closed: 'Door3', destroyed: 'Door3', used: 'Button1', code: 'Pad1', wrongcode: 'Pad1', option: 'Comp1',
  enter: 'Zone1', leave: 'Zone1', laser: 'Laser1', alarm: 'Siren1', dies: 'Guard1', any: 'Lift1', picked: 'Item1', gone: 'Body1',
  near: 'Cam1', arrived: 'Guard1', start: '', animdone: 'Crate', cutstart: 'Cut1', cutdone: 'Cut1', npcused: 'Crate', finished: 'Timer1',
  stopped: 'Timer1', output: 'Gen0', bodydone: 'Guard1', keypress: '' };
const TARGET = { door: 'Door3', character: 'Guard1', light: 'Lamp1', any: 'Crate', script: 'Gen0', elevator: 'Lift1', cutscene: 'Cut1',
  timer: 'Timer1' };
const FATE = fateFlag('01_Map', 'Guard1', 'Dead');
// the arguments that change a verb's sentence
const ARGS = {
  key: [{ a: 'Vault key' }],
  attack: [{ a: 'alone' }],
  goto: [{ at: [10, 20, 30], nav: true }],
  explode: [{ a: '50', b: '256' }],
  sound: [{ a: 'Ambient.Group.Hum', c: '1024', target: 'Music1' }, { a: 'Ambient.Group.Hum', c: '1024', target: '' }, { a: 'Ambient.Hum', c: '0' },
    { a: '', c: '0' }, { a: 'X.Y', c: '-5' }, { a: 'Pkg.' }, { a: 'Pkg.Snd', c: '512', targetTag: 'SPEAKER' }],
  message: [{ a: 'Hello there' }, { a: 'M'.repeat(70) }, { a: '' }, { a: 'Hi {there} [x]' }],
  goal: [{ c: 'done', b: 'Find the key', a: 'G1' }, { c: 'done', a: 'Goal_name' }, { c: 'done', a: 'A'.repeat(70) }, { b: 'Reach the roof', a: 'G2' },
    { b: '' }, { c: 'done', b: '0', a: 'G3' }],
  note: [{ a: 'The code is 1234' }],
  flag: [{ a: 'Crypt_Gen', b: '1' }, { a: 'Crypt_Gen', b: '0' }, { a: '', b: '1' }, { a: FATE, b: '1' }, { a: FATE, b: '0' }, { a: 'X', b: 0 }],
  count: [{ a: 'Levers', b: '1' }, { a: 'Levers', b: '-2' }, { a: 'Levers', b: '3', c: 'set' }, { a: 'Levers', b: '-3', c: 'set' }, { a: '', b: '' },
    { a: 'L', b: '-0.5' }, { a: 'L', b: '2.9' }, { a: 'L', b: 'x' }, { a: 'L', b: '' }, { a: 'L', b: '', c: 'set' }],
  travel: [{ a: '02_Next', b: 'Arrive1' }, { a: '02_Next' }, { a: '' }],
  input: [{ a: 'Start', b: 'Seconds=4;Mode=red' }, { a: 'Start' }, { a: 'Stop', b: '' }, { a: '' }],
  floor: [{ a: '2' }, { a: '-1' }, { a: 'x' }, { a: '' }, { a: 2.7 }],
  timerstart: [{ a: '45' }, { a: '0' }, { a: '' }, { a: '2.5' }],
  npcuse: [{ a: 'Crate', b: '4', c: 'crouch' }, { a: 'Crate', b: '4', c: 'stand' }, { a: '', b: '0' }, { a: 'Crate' }, {}],
  effect: [{ a: 'mist', b: '0' }, { a: 'mist', b: '5' }, { a: 'sparks', b: '5', c: 'exact' }, { a: 'blinklight', b: '30', c: 'red beep' },
    { a: 'pulse', b: '0', c: 'blue' }, { a: 'pulse', c: 'green beep exact' }, { a: 'off' }, { a: 'nonsense', b: '2' },
    { a: 'sparks', b: '5', target: 'P1' }, { a: 'pulse', b: '0', c: 'blue', target: 'P1' }, { a: 'blinklight', c: 'yellow beep', target: 'P1' },
    { a: 'smoke', b: '0', c: 'exact', target: 'P1' }],
};

// A case: {id, kind: 'when' | 'act' | 'rule' | 'outputLabel' | 'verbLabel' | 'noun' | 'acts', ...its input}
export function cases() {
  const out = [];
  const add = (id, kind, input) => out.push({ id, kind, ...input });
  const show = (v) => (typeof v === 'string' ? `'${v}'` : String(v));     // 2 and '2' are two cases
  // the outputs: as the rules on them begin
  for (const when of OUTPUTS) add(`when:${when}`, 'when', { rule: { id: 'L1', src: SOURCE[when], when, do: [] } });
  add('when:used:usable', 'when', { rule: { id: 'L1', src: 'Crate', when: 'used' } });
  for (const option of [0, 1, 2, 3, undefined, '2']) add(`when:option:${show(option)}`, 'when', { rule: { src: 'Comp1', when: 'option', option } });
  add('when:option:other', 'when', { rule: { src: 'Pad1', when: 'option', option: 1 } });
  for (const near of [300, '', 0, undefined, '96']) add(`when:near:${show(near)}`, 'when', { rule: { src: 'Cam1', when: 'near', near } });
  for (const port of ['Sabotaged', 'Other', undefined]) add(`when:output:${show(port)}`, 'when', { rule: { src: 'Gen0', when: 'output', port } });
  add('when:output:other', 'when', { rule: { src: 'Door3', when: 'output', port: 'Sabotaged' } });
  for (const when of ['bogus', 'constructor', '', undefined]) add(`when:unknown:${show(when)}`, 'when', { rule: { src: 'Thing1', when } });
  add('when:opened:missing', 'when', { rule: { src: 'Ghost', when: 'opened' } });
  add('when:start:source', 'when', { rule: { src: 'Button1', when: 'start' } });
  add('when:keypress:F', 'when', { rule: { src: '', when: 'keypress', key: 'F' } });
  // the verbs: on their usual object, on none, on objects with a tag, with their arguments
  const target = (v) => {
    const fam = { open: 'door', close: 'door', toggle: 'door', lock: 'door', unlock: 'door', blow: 'door', key: 'door', lighton: 'light',
      lightoff: 'light', lighttoggle: 'light', input: 'script', floor: 'elevator', cutplay: 'cutscene', cutstop: 'cutscene', timerstart: 'timer',
      timerstop: 'timer', timerpause: 'timer', timerresume: 'timer', on: 'any', off: 'any', hide: 'any', show: 'any', explode: 'any',
      effect: 'any', anim: 'any', animback: 'any', animstop: 'any', sound: 'any' }[v];
    return fam ? TARGET[fam] : ['message', 'goal', 'note', 'flag', 'count', 'travel', 'fpmoment'].includes(v) ? '' : TARGET.character;
  };
  for (const verb of VERBS) {
    const made = verb === 'effect' ? { a: 'mist', b: '0' } : {};      // blockDefaults: an effect always has its kind
    add(`act:${verb}`, 'act', { act: { verb, target: target(verb), delay: 0, ...made } });
    add(`act:${verb}:none`, 'act', { act: { verb, ...made } });
    if (!TAG_FIXED.includes(verb)) add(`act:${verb}:tagged`, 'act', { act: { verb, targetTag: 'MONSTER', ...made } });
    (ARGS[verb] || []).forEach((args, i) => add(`act:${verb}:${i}`, 'act', { act: { verb, target: target(verb), ...args } }));
  }
  for (const fam of OCT27) for (const verb of ['on', 'off']) add(`act:${verb}:${fam}`, 'act', { act: { verb, target: ACTOR[fam] } });
  for (const verb of ['bogus', '']) add(`act:unknown:${show(verb)}`, 'act', { act: { verb, target: 'Crate' } });
  add('act:tagged:empty', 'act', { act: { verb: 'attack', target: 'Guard1', targetTag: '' } });
  // a group within a radius (connect-area.js): each kind's verbs
  for (const [kind, verbs] of Object.entries(AREA_VERBS)) {
    for (const verb of verbs) add(`area:${kind}:${verb}`, 'act', { act: { verb, area: { kind, members: ['A', 'B'], dynamic: false, radius: 512 } } });
    add(`area:${kind}:dynamic`, 'act', { act: { verb: verbs[0], area: { kind, members: [], dynamic: true, radius: 384 } } });
  }
  add('area:tagged', 'act', { act: { verb: 'hide', targetTag: 'X', area: { kind: 'other', members: ['A'], dynamic: false } } });
  // whole rules: conditions, actions in the order of their seconds, once, nothing yet
  add('rule:basic', 'rule', { rule: { id: 'L1', src: 'Button1', when: 'used', once: false, do: [{ verb: 'open', target: 'Door3', delay: 0 }] } });
  add('rule:checks', 'rule', { rule: { id: 'L2', src: 'Pad1', when: 'code', once: true,
    requires: [{ flag: 'Crypt_Gen', is: true }, { flag: 'Crypt_Gen', is: false }, { flag: FATE, is: false }, { type: 'item', item: 'DeusEx.Multitool', has: true },
      { type: 'item', item: 'DeusEx.Crowbar', has: false }, { type: 'alive', actor: 'Guard1', is: true }, { type: 'alive', actor: 'Ghost', is: false },
      { type: 'skill', skill: 'SkillLockpicking', level: 2 }, { type: 'counter', counter: 'Levers', op: '>=', value: 3 }, { type: 'credits', op: '<', value: 50 }],
    do: [{ verb: 'message', a: 'Later', delay: 2 }, { verb: 'unlock', target: 'Door3', delay: 0 }, { verb: 'attack', targetTag: 'MONSTER', delay: 1.5 },
      { verb: 'open', target: 'Door3', delay: 0 }, { verb: 'count', a: 'Levers', b: '-1', delay: -1 }] } });
  add('rule:nothing', 'rule', { rule: { id: 'L3', src: 'Zone1', when: 'enter', once: true, do: [] } });
  add('rule:start', 'rule', { rule: { id: 'L4', src: '', when: 'start', do: [{ verb: 'flag', a: FATE, b: '1', delay: 0.5 }] } });
  add('rule:area', 'rule', { rule: { id: 'L5', src: 'Siren1', when: 'alarm', do: [{ verb: 'hostile', area: { kind: 'character', members: ['G1', 'G2', 'G3'], dynamic: true, radius: 1024 } }] } });
  // the labels of the menus and chips, the kinds' nouns, the kind of object a verb acts on
  for (const when of OUTPUTS.concat('bogus')) add(`label:when:${when}`, 'outputLabel', { when });
  for (const verb of VERBS.concat('bogus')) for (const family of OCT27.concat('')) add(`label:verb:${verb}:${family}`, 'verbLabel', { verb, family });
  for (const family of OCT27) add(`noun:${family}`, 'noun', { family });
  for (const verb of VERBS) add(`acts:${verb}`, 'acts', { verb });
  return out;
}

// The end of a declaration in source from its start: the ';' that closes it, outside strings and brackets.
function statementEnd(src, i) {
  const stack = [];
  for (; i < src.length; i++) {
    const ch = src[i], top = stack[stack.length - 1];
    if (top === "'" || top === '"' || top === '`') {
      if (ch === '\\') i++;
      else if (ch === top) stack.pop();
      else if (top === '`' && ch === '$' && src[i + 1] === '{') { stack.push('{'); i++; }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`' || ch === '{' || ch === '(' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ')' || ch === ']') stack.pop();
    else if (ch === ';' && !stack.length) return i + 1;
  }
  return -1;
}
// A declaration of app.js by name (a function, or a const and the Object.assign that completes it), or null.
// source: with LF line ends.
export function declaration(source, name) {
  let start = source.indexOf(`\nfunction ${name}(`);
  if (start >= 0) return source.slice(start, source.indexOf('\n}\n', start) + 3);
  start = source.indexOf(`\nconst ${name} =`);
  if (start < 0) return null;
  let end = statementEnd(source, start + 1);
  const more = `\nObject.assign(${name},`;
  if (source.startsWith(more, end)) end = statementEnd(source, end + 1);
  return source.slice(start, end);
}

// app.js's sentence functions by name, run on the world: case -> text (its .tables: LK_WHEN, LK_VERBS, LK_KIND);
// null when app.js no longer has them.
export const APP_DECLARATIONS = ['LK_WHEN', 'LK_VERBS', 'lkVerbLabel', 'LK_KIND', 'lkWholeOf', 'lkWhenKey', 'lkVerbKey', 'lkWhenText',
  'lkActText', 'lkActText1', 'lkCondNames', 'lkStepsSaid', 'lkSentence'];
export function appSentences(source) {
  const lf = source.replace(/\r\n/g, '\n');                      // app.js is saved with CRLF
  const code = APP_DECLARATIONS.map((name) => declaration(lf, name));
  if (code.some((c) => c === null)) return null;
  const context = vm.createContext({
    BLOCK_WHEN, BLOCK_VERBS, blockWhenText, blockActText, conditionText, parseFate, stateLabel,
    isFormula, amountText: valueText,                          // P9 slice 5: a counter changed by a formula
    lkName: world.name, lkActor: (n) => (n && has(FAMILY, n) ? { name: n } : null), lkCatOf: (a) => (a ? world.family(a.name) : 'other'),
    lkPortLabel: world.portLabel, lkOptionText: world.optionText,
    // what app.js asks the catalogue for (the P4 words: lkVocabWhen, lkVocabAct) and the rule's options (P6)
    lkVocabWhen: () => '', lkVocabAct: () => '', optionsText, lkMainOf: (l) => l, stepsText,
    lkPhaseText: () => '',                                     // P3: a rule kept to phases (none in the cases)
    goalTexts,                                                 // a goal completed by its words (12 Nov 2026)
    edits: { usable: Object.fromEntries([...USABLE].map((n) => [n, { text: 'Use' }])) },
    propItems: Object.entries(ITEMS).map(([cls, name]) => ({ cls, name })),
  });
  vm.runInContext(code.join('\n'), context);
  const app = vm.runInContext('({ LK_WHEN, LK_VERBS, LK_KIND, lkVerbLabel, lkWhenText, lkActText, lkSentence })', context);
  const run = (c) => {
    switch (c.kind) {
      case 'when': return app.lkWhenText(c.rule);
      case 'act': return app.lkActText(c.act);
      case 'rule': return app.lkSentence(c.rule);
      case 'outputLabel': return app.LK_WHEN[c.when] || c.when;
      case 'verbLabel': return app.lkVerbLabel(c.verb, c.family);
      case 'noun': return app.LK_KIND[c.family] ?? '';
      case 'acts': return (app.LK_VERBS[c.verb] || [])[1] ?? '';
      default: throw new Error('unknown case ' + c.kind);
    }
  };
  run.tables = { LK_WHEN: app.LK_WHEN, LK_VERBS: app.LK_VERBS, LK_KIND: app.LK_KIND };
  return run;
}
