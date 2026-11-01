// The one vocabulary of the level logic (static/logic-vocab.js, config/logic.json v2): it says every sentence the way
// app.js said it before (LK_WHEN, LK_VERBS, lkVerbLabel, LK_KIND, lkWhenText, lkActText, lkSentence, loaded by name
// from app.js while it has them, and tests/logic_sentences_20261027.json after), and its new fields hold together:
// labels, sentences, typed arguments, inverse verbs, games, levels, keywords, mover words, Connect pairs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { vocabulary, fill, wholeOf, whenKey, verbKey, gameName, ARG_TYPES, SENTENCE_WORDS } from '../editor/static/logic-vocab.js';
import { cases, appSentences, declaration, world, OUTPUTS, VERBS, FAMILIES, TAG_FIXED } from './logic_vocab_cases.mjs';

const data = JSON.parse(fs.readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const golden = JSON.parse(fs.readFileSync(new URL('./logic_sentences_20261027.json', import.meta.url), 'utf8')).sentences;
const appSource = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
const app = appSentences(appSource);
const vocab = vocabulary(data);

// what the vocabulary says for a case of logic_vocab_cases.mjs
function say(c, ctx = world) {
  switch (c.kind) {
    case 'when': return vocab.whenText(c.rule, ctx);
    case 'act': return vocab.actText(c.act, ctx);
    case 'rule': return vocab.sentence(c.rule, ctx);
    case 'outputLabel': return vocab.outputLabel(c.when);
    case 'verbLabel': return vocab.verbLabel(c.verb, c.family);
    case 'noun': return vocab.noun(c.family);
    case 'acts': return vocab.acts(c.verb);
    default: throw new Error('unknown case ' + c.kind);
  }
}
const differences = (list, expected) => list.filter((c) => c.got !== expected(c)).map((c) => `${c.id}: ${JSON.stringify(c.got)} != ${JSON.stringify(expected(c))}`);

test('every sentence app.js made before, the vocabulary makes the same: outputs, verbs, labels, nouns, rules', () => {
  const all = cases().map((c) => ({ ...c, got: say(c) }));
  assert.equal(all.length, Object.keys(golden).length);
  assert.deepEqual(differences(all, (c) => golden[c.id]), []);
});

test('app.js still says what the golden keeps (until its sentence functions move to logic-vocab.js)', (t) => {
  if (!app) { t.skip('app.js has no LK_WHEN / lkActText any more: the golden is the sentences from before'); return; }
  const all = cases().map((c) => ({ ...c, got: app(c) }));
  assert.deepEqual(all.map((c) => c.id), Object.keys(golden));
  assert.deepEqual(differences(all, (c) => golden[c.id]), []);
});

test('the cases cover every output, verb and family app.js and logic.json know', (t) => {
  for (const id of OUTPUTS) assert.ok(Object.hasOwn(data.outputs, id), id);
  for (const id of VERBS) assert.ok(Object.hasOwn(data.inputs, id), id);
  assert.deepEqual(data.families.map((f) => f.id).sort(), [...FAMILIES].sort());
  const when = new Set(cases().filter((c) => c.kind === 'when').map((c) => c.rule.when));
  const verbs = new Set(cases().filter((c) => c.kind === 'act').map((c) => c.act.verb));
  assert.deepEqual(OUTPUTS.filter((w) => !when.has(w)), []);
  assert.deepEqual(VERBS.filter((v) => !verbs.has(v)), []);
  if (!app) { t.skip('app.js has no LK_WHEN any more'); return; }
  assert.deepEqual(Object.keys(app.tables.LK_WHEN).sort(), [...OUTPUTS].sort());
  assert.deepEqual(Object.keys(app.tables.LK_VERBS).sort(), [...VERBS].sort());
  assert.deepEqual(Object.keys(app.tables.LK_KIND).filter((f) => !FAMILIES.includes(f)), []);
});

test('objects tagged alike: the two sentences app.js got wrong ("goe to floor") read right', () => {
  const tagged = (act) => vocab.actText({ targetTag: 'MONSTER', ...act }, world);
  assert.deepEqual(TAG_FIXED, ['floor', 'npcuse']);
  assert.equal(tagged({ verb: 'floor', a: '2' }), 'objects tagged MONSTER go to floor 2');
  assert.equal(tagged({ verb: 'npcuse', a: 'Crate', b: '4' }), 'objects tagged MONSTER go and use the object Crate for 4 s, crouching');
  assert.equal(tagged({ verb: 'npcuse', a: 'Crate', c: 'stand' }), 'objects tagged MONSTER go and use the object Crate');
  assert.equal(vocab.actText({ verb: 'floor', target: 'Lift1', a: '2' }, world), 'the elevator Lift1 goes to floor 2');
});

// ---------------------------------------------------------------- the new fields
const entries = () => [...Object.entries(data.outputs).map(([id, e]) => ['output', id, e]), ...Object.entries(data.inputs).map(([id, e]) => ['verb', id, e])];
const templates = (say) => (Array.isArray(say) ? say.map((v) => v.say) : [say]);
const slots = (text) => [...String(text).matchAll(/\{(\w+)(?::(\w+))?\}/g)].map((m) => ({ key: m[1], type: m[2] }));

test('every output and verb has its label, sentence, level, games and keywords', () => {
  assert.equal(data.v, 2);
  assert.deepEqual(data.levels, ['basic', 'more', 'advanced']);
  assert.deepEqual(data.games, ['revision', 'vanilla']);
  for (const [kind, id, e] of entries()) {
    assert.ok(typeof e.label === 'string' && e.label, `${kind} ${id}: label`);
    assert.ok(e.say !== undefined, `${kind} ${id}: say`);
    assert.ok(data.levels.includes(e.level), `${kind} ${id}: level ${e.level}`);
    assert.ok(e.games.length && e.games.every((g) => data.games.includes(g)), `${kind} ${id}: games`);
    assert.ok(Array.isArray(e.kw) && e.kw.length, `${kind} ${id}: keywords`);
  }
  // what the editor read before stays: how an output is heard, whether a verb needs an object
  assert.equal(data.outputs.code.hears, 'keypad');
  assert.equal(data.inputs.message.target, false);
});

test('a sentence names only the words, arguments and pieces it has, and its variants end with one for all', () => {
  for (const [kind, id, e] of entries()) {
    const known = new Set([...SENTENCE_WORDS[kind], ...(e.args || []).map((a) => a.id), ...Object.keys(e.pieces || {})]);
    const says = [e.say, e.many, ...Object.values(e.pieces || {})].filter((s) => s !== undefined);
    for (const s of says) {
      if (Array.isArray(s)) {
        assert.ok(s.length && !s[s.length - 1].if, `${kind} ${id}: its last variant has no "if"`);
        for (const v of s) for (const key of Object.keys(v.if || {})) assert.ok(known.has(key) || key === 'target', `${kind} ${id}: if ${key}`);
      }
      for (const text of templates(s)) for (const { key, type } of slots(text)) {
        assert.ok(known.has(key), `${kind} ${id}: {${key}} in "${text}"`);
        if (type) assert.ok(ARG_TYPES.includes(type), `${kind} ${id}: type ${type}`);
      }
    }
  }
  for (const text of [data.sentence.rule, data.sentence.when, data.sentence.step, data.sentence.area]) assert.ok(slots(text).length, text);
});

test('arguments are typed with the types logic.json describes, and the vocabulary reads each of them', () => {
  assert.deepEqual(Object.keys(data.types).sort(), [...ARG_TYPES].sort());
  for (const [kind, id, e] of entries()) for (const arg of e.args || []) {
    assert.ok(Object.hasOwn(data.types, arg.type), `${kind} ${id}: ${arg.id} ${arg.type}`);
    if (arg.type === 'choice') assert.ok(arg.choices.length > 1, `${kind} ${id}: ${arg.id} choices`);
  }
  assert.deepEqual(vocab.args('verb', 'count').map((a) => a.id), ['a', 'b', 'c']);
  assert.deepEqual(vocab.args('output', 'near'), [{ id: 'near', type: 'number', label: 'within (units)', default: 256 }]);
  assert.deepEqual(vocab.args('verb', 'open'), []);
});

test('inverse verbs undo each other, and only verbs that can be undone have one', () => {
  for (const [v, e] of Object.entries(data.inputs)) if (e.inverse) {
    assert.ok(Object.hasOwn(data.inputs, e.inverse), `${v}: ${e.inverse}`);
    assert.equal(data.inputs[e.inverse].inverse, v, `${e.inverse} undoes ${v}`);
  }
  for (const [a, b] of [['open', 'close'], ['lock', 'unlock'], ['lighton', 'lightoff'], ['on', 'off'], ['hide', 'show'], ['friend', 'hostile'],
    ['leave', 'appear'], ['anim', 'animback']]) assert.equal(vocab.inverse(a), b);
  for (const v of ['toggle', 'lighttoggle', 'attack', 'message', 'bogus']) assert.equal(vocab.inverse(v), '', v);
});

test('a family says on and off its own way, and a group of objects says them as its kind', () => {
  assert.equal(vocab.verbLabel('on', 'soundfx'), 'Play it');
  assert.equal(vocab.verbLabel('off', 'alarm'), 'Stop the alarm');
  assert.equal(vocab.verbLabel('on', 'door'), 'Switch on');
  assert.equal(vocab.inputLabel('on', 'Music1', world), 'Play it');
  assert.equal(vocab.inputLabel('input:Start', 'Gen0', world), 'Start the generator');
  assert.equal(vocab.whenLabel('output:Sabotaged', 'Gen0', world), 'it says "Sabotaged!"');
  assert.equal(vocab.whenLabel('opened', 'Door3', world), 'it has opened');
  assert.equal(vocab.actText({ verb: 'off', area: { kind: 'object', members: ['A'], dynamic: false } }, world), 'switch off: 1 saved objects');
});

test('mover words: a bridge is lowered and raised, a lift sent up, and a door keeps its own words', () => {
  const words = { Bridge1: 'bridge', LiftDoor: 'lift', Door3: 'door', Odd: 'spaceship' };
  const ctx = { ...world, word: (n) => words[n] || '', family: (n) => (Object.hasOwn(words, n) ? 'door' : world.family(n)) };
  assert.deepEqual(vocab.movers().map((w) => w.id), ['door', 'bridge', 'lift', 'platform', 'hatch']);
  assert.deepEqual(vocab.moverFamilies(), ['door']);
  assert.equal(vocab.verbLabel('open', 'door', 'bridge'), 'Lower');
  assert.equal(vocab.verbLabel('toggle', 'door', 'bridge'), 'Raise or lower');
  assert.equal(vocab.verbLabel('lock', 'door', 'bridge'), 'Lock');                         // what it does not change
  assert.equal(vocab.inputLabel('close', 'Bridge1', ctx), 'Raise');
  assert.equal(vocab.actText({ verb: 'open', target: 'Bridge1' }, ctx), 'lower Bridge1 (missing)');
  assert.equal(vocab.actText({ verb: 'close', target: 'LiftDoor' }, ctx), 'send LiftDoor (missing) down');
  assert.equal(vocab.whenText({ src: 'Bridge1', when: 'opened' }, ctx), 'When Bridge1 (missing) has been lowered');
  assert.equal(vocab.whenLabel('closed', 'LiftDoor', ctx), 'it starts going down');
  assert.equal(vocab.actText({ verb: 'open', target: 'Door3' }, ctx), 'open the door Door3');
  assert.equal(vocab.actText({ verb: 'open', target: 'Odd' }, ctx), 'open Odd (missing)');      // a word it does not know
  assert.equal(vocab.noun('door', 'bridge'), 'bridge');
  assert.equal(vocab.noun('door', 'spaceship'), 'door');
  assert.equal(vocab.noun('computer'), '');
  for (const w of data.movers.words) {
    for (const v of Object.keys(w.verbs || {})) assert.ok(data.families.find((f) => f.id === 'door').inputs.includes(v), `${w.id}: ${v}`);
    for (const o of Object.keys(w.outputs || {})) assert.ok(data.families.find((f) => f.id === 'door').outputs.includes(o), `${w.id}: ${o}`);
  }
});

test('Connect pairs: what both families offer, the likeliest first, and a character is never first attacked', () => {
  const family = (id) => data.families.find((f) => f.id === id);
  for (const [from, targets] of Object.entries(data.pairs)) for (const [to, pairs] of Object.entries(targets)) {
    assert.ok(from === 'any' || family(from), from);
    assert.ok(family(to), to);
    for (const p of pairs) {
      if (p.when) assert.ok(family(from).outputs.includes(p.when), `${from} > ${to}: ${p.when}`);
      for (const v of p.do) assert.ok(family(to).inputs.includes(v), `${from} > ${to}: ${v}`);
      for (const a of p.ask || []) assert.ok(vocab.ask(a), `${from} > ${to}: ask ${a}`);
    }
  }
  assert.deepEqual(vocab.pairs('keypad', 'door')[0], { when: 'code', do: ['unlock', 'open'], ask: ['code', 'lockAtStart'] });
  assert.deepEqual(vocab.pairs('object', 'door')[0], { when: 'used', do: ['open'] });
  assert.deepEqual(vocab.pairs('object', 'elevator')[0].ask, ['floor']);
  assert.deepEqual(vocab.ask('code'), { label: 'The code', of: 'source', prop: 'validCode' });
  for (const f of data.families.filter((x) => x.outputs.length)) {
    const first = vocab.pairs(f.id, 'character')[0];
    assert.ok(first, `${f.id} > character`);
    assert.notEqual(first.do[0], 'attack', `${f.id} > character`);
    assert.ok(f.outputs.includes(first.when), `${f.id} > character: ${first.when}`);
  }
  // no 'when': the source's first output; the same pair twice is offered once
  assert.deepEqual(vocab.pairs('door', 'character').map((p) => `${p.when} ${p.do}`), ['opened hostile', 'opened attack', 'opened goto', 'opened follow']);
  assert.deepEqual(vocab.pairs('light', 'character'), []);                                 // a light starts nothing
  assert.deepEqual(vocab.pairs('nothing', 'door'), []);
  assert.deepEqual(vocab.pairs('zone', 'computer'), []);                                   // none listed: Connect's own
});

test('search finds by label, keyword and id, at a level and in a game', () => {
  const found = (text, opts) => vocab.search(text, opts).map((r) => `${r.kind}:${r.id}`);
  assert.ok(found('kill').includes('verb:attack'));
  assert.ok(found('kill').includes('output:dies'));
  assert.ok(found('elevator').includes('verb:floor'));
  assert.ok(found('Walk').includes('verb:goto'));
  assert.deepEqual(found('keypad wrong'), ['output:wrongcode']);
  assert.ok(found('script').includes('verb:input'));
  assert.ok(!found('script', { level: 'basic' }).includes('verb:input'));
  assert.ok(found('timer', { level: 'more' }).includes('verb:timerstart'));
  assert.ok(!found('timer', { level: 'basic' }).includes('verb:timerstart'));
  assert.deepEqual(found('zzz'), []);
  // a verb only one game runs is not offered for the other
  const narrow = vocabulary({ ...data, inputs: { ...data.inputs, attack: { ...data.inputs.attack, games: ['revision'] } } });
  assert.ok(!narrow.search('kill', { game: 'vanilla' }).some((r) => r.id === 'attack'));
  assert.ok(narrow.search('kill', { game: 'revision' }).some((r) => r.id === 'attack'));
  assert.equal(narrow.worksIn('verb', 'attack', 'vanilla'), false);
  assert.equal(vocab.worksIn('verb', 'attack', 'vanilla'), true);
  assert.equal(vocab.levelOf('verb', 'input'), 'advanced');
  assert.equal(vocab.levelOf('output', 'finished'), 'more');
  assert.equal(vocab.levelOf('verb', 'bogus'), 'advanced');
  assert.equal(vocab.shownAt('verb', 'open', 'basic'), true);
});

test('templates: a [part] goes when a value in it is empty, and the texts put in are not read again', () => {
  assert.equal(fill('start {t}[ ({a} s)]', { t: 'Timer1', a: '' }), 'start Timer1');
  assert.equal(fill('start {t}[ ({a} s)]', { t: 'Timer1', a: 45 }), 'start Timer1 (45 s)');
  assert.equal(fill('the message "{a}"', { a: '{t} [x]' }), 'the message "{t} [x]"');
  assert.equal(fill('{a:line}', (key, type) => `${key}/${type}`), 'a/line');
  assert.equal(vocab.actText({ verb: 'message', a: 'Hi {there}', target: '' }, world), 'the message "Hi {there}"');
});

test('a rule\'s steps in the order the game runs them, one way for its "do" and its "otherwise"', () => {
  const acts = [{ verb: 'message', a: 'Later', delay: 2.5 }, { verb: 'open', target: 'Door3' }, { verb: 'message', a: 'Soon', delay: 1 }];
  assert.equal(vocab.steps(acts, world), 'open the door Door3, after 1 s the message "Soon", after 2.5 s the message "Later"');
  assert.equal(vocab.steps([], world), '');
  assert.equal(vocab.sentence({ src: 'Button1', when: 'used', do: acts }, world), `When JC uses the object Button1: ${vocab.steps(acts, world)}`);
  assert.equal(vocab.sentence({ src: 'Button1', when: 'used' }, world), 'When JC uses the object Button1: nothing yet');
  assert.deepEqual(acts.map((x) => x.a || x.verb), ['Later', 'open', 'Soon'], 'the list itself is not sorted');
});

// The names conditions.py ident gives (Python 3.10: python -c "import conditions; print(conditions.ident(...))"), which
// links.py writes for a state, a counter and a goal and conditions.encode for a condition
test('a state\'s or a counter\'s name as the game writes it, as conditions.ident does', () => {
  const ident = [['Keys found', 'Keys_found'], ['Keys_found', 'Keys_found'], ['città', 'citta'], ['3rd door', 'X_3rd_door'], ['Ça va?', 'Ca_va_'],
    ['naïve café', 'naive_cafe'], ['x'.repeat(80), 'x'.repeat(60)], ['9'.repeat(70), 'X_' + '9'.repeat(58)], ['ﬁle', 'file'], ['ẞig', '_ig'],
    ['a\u0bcdb', 'ab'], ['a\u0bbeb', 'a_b'], ['a\u{1F600}b', 'a_b'], [' Spaced  ', 'Spaced']];
  assert.deepEqual(ident.map(([s]) => gameName(s)), ident.map(([, name]) => name));
  assert.equal(gameName('3rd goal', 'G'), 'G_3rd_goal');
  // a blank name stays blank (links.py _game_name: the game says noname); a lone accent is a name, of nothing
  assert.deepEqual(['', '   ', null, undefined, 0].map((s) => gameName(s)), ['', '', '', '', '']);
  assert.equal(gameName('\u0301'), 'X_');
});

test('numbers and keys as app.js reads them (lkWholeOf, lkWhenKey, lkVerbKey)', (t) => {
  assert.equal(wholeOf('', 1), 1);
  assert.equal(wholeOf('2.9', 1), 2);
  assert.equal(wholeOf('9999999999', 0), 2147483647);
  assert.equal(whenKey({ when: 'output', port: 'Done' }), 'output:Done');
  assert.equal(verbKey({ verb: 'input', a: 'Start' }), 'input:Start');
  assert.equal(verbKey({ verb: 'open' }), 'open');
  if (!app) { t.skip('app.js has no lkWholeOf any more'); return; }
  const lf = appSource.replace(/\r\n/g, '\n');
  const theirs = new Function(`${['lkWholeOf', 'lkWhenKey', 'lkVerbKey'].map((n) => declaration(lf, n)).join('\n')}; return { lkWholeOf, lkWhenKey, lkVerbKey };`)();
  for (const v of ['', ' ', '3', '-3.7', 'x', null, undefined, 1e12, -1e12, '0x10', 2.5]) for (const d of [0, 1]) assert.equal(wholeOf(v, d), theirs.lkWholeOf(v, d), `${v} ${d}`);
  for (const l of [{ when: 'output' }, { when: 'output', port: 'A' }, { when: 'used' }]) assert.equal(whenKey(l), theirs.lkWhenKey(l));
  for (const x of [{ verb: 'input' }, { verb: 'input', a: 'B' }, { verb: 'on' }]) assert.equal(verbKey(x), theirs.lkVerbKey(x));
});
