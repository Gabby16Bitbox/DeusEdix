// P5: Try it plays the Story's conversations. A dialogue started by a rule ("Start the dialogue"), by the Story (an
// action) or by the player (logic-sim.js talks / talk) plays line by line in the session: the player's answers, its
// states, signals and events as the game does them; the rules waiting for its end run only when it ends, then its
// "do" steps' actions (UCEditorStory.TickEnds, then TickStory). An InfoLink says its lines and does its actions.
// What happens is kept with its tick, so the clock goes back and forward again. The page: logic-try.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../editor/static/logic-sim.js';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const d1 = { id: 'd1', title: 'Gate talk', owner: 'Guard1', steps: [
  { type: 'line', who: 'npc', text: 'Halt.' },
  { type: 'signal', signal: 'Mid talk' },
  { type: 'choice', options: [{ text: 'Let me in.', goto: 'a' }, { text: 'I have the pass.', goto: 'a', flag: 'Has pass', is: true }] },
  { type: 'label', name: 'a' },
  { type: 'flag', flag: 'Gate done', is: true },
  { type: 'do', do: [{ type: 'signal', signal: 'After talk' }, { type: 'flag', flag: 'Talked', is: true }] },
  { type: 'line', who: 'jc', text: 'Thanks.' },
  { type: 'end' }] };
const d2 = { id: 'd2', title: 'Second talk', owner: 'Guard1', once: false, requires: [{ flag: 'Gate done', is: true }],
  steps: [{ type: 'line', who: 'npc', text: 'Again?' }] };
const i1 = { id: 'i1', once: true, flag: '', name: 'Jock', lines: [{ text: 'Heads up.' }, { text: '' }], do: [{ type: 'signal', signal: 'Call' }] };
const story = { dialogues: ['d1', 'd2'], infolinks: [i1], talks: { d1, d2 } };
const W = { player: 'JCDentonMale0', story, actors: [{ name: 'Button1', chain: ['Button1', 'DeusExDecoration', 'Decoration', 'Actor'], at: [0, 0, 0] },
  { name: 'Guard1', chain: ['UNATCOTroop', 'ScriptedPawn', 'Pawn', 'Actor'], at: [64, 0, 0] }] };
// a compiled rule: hears Tag, when, its actions ('delay|verb|target|a|b|c')
function link(id, when, tag, acts, source = '') {
  const props = { Tag: tag, When: when, Rule: `"${id}"`, ...(source ? { Source: `"${source}"` } : {}) };
  acts.forEach((a, i) => { props[`Act(${i})`] = `"${a}"`; });
  return { cls: 'UCLink', name: `UCLink_${id}`, props };
}
const RULES = [link('L1', 'used', 'UCL_Button1', ['0|talk||d1||'], 'Button1'),
  link('L2', 'ended', 'UCD_d1', ['0|message||Over||']),
  link('L3', 'signal', 'UCS_Mid_talk', ['0|message||Mid||']),
  link('L4', 'signal', 'UCS_After_talk', ['0|message||After||']),
  link('L5', 'used', 'UCL_Button2', ['0|infolink||i1||'], 'Button1'),
  link('L6', 'signal', 'UCS_Call', ['0|message||Called||'])];
const session = (world = W) => createSession({ actors: RULES, outputs: logic.outputs, world, map: 'M' });
const said = (s) => s.log().map(({ line }) => line).filter((l) => /^act\|M\|L\d\|message/.test(l)).map((l) => l.split('|').pop());
const kinds = (s) => s.said().map((e) => e.kind + (e.text ? `:${e.text}` : ''));

test('a rule starts the dialogue: it plays line by line, the rules on its signal run at that line, on its end only at the end', () => {
  const s = session();
  s.fire({ thing: 'Button1', output: 'used' });
  s.step(1);
  assert.deepEqual(s.talking().shown, { type: 'line', id: 0, who: 'Guard1', text: 'Halt.' });
  assert.deepEqual(said(s), [], 'nothing heard yet: the dialogue is playing');
  s.say(-1);
  s.step(1);
  assert.deepEqual(said(s), ['Mid'], 'the step "Send a signal" in the middle');
  const shown = s.talking().shown;
  assert.equal(shown.type, 'choice');
  assert.deepEqual(shown.options.map((o) => [o.text, o.shown]), [['Let me in.', true], ['I have the pass.', false]]);
  s.say(1);                                           // not offered: its condition does not hold
  assert.equal(s.talking().shown.type, 'choice');
  s.say(0);
  assert.equal(s.state().flags.Gate_done, true, 'its state, as the game names it');
  assert.deepEqual(s.talking().shown, { type: 'line', id: 6, who: 'JCDentonMale0', text: 'Thanks.' });
  s.say(-1);
  s.step(1);
  assert.equal(s.talking(), null);
  assert.deepEqual(said(s), ['Mid', 'Over', 'After'], 'the end, then its "do" actions (TickEnds, TickStory)');
  assert.equal(s.state().flags.Talked, true);
  assert.deepEqual(kinds(s), ['start', 'line:Halt.', 'effect', 'answer:Let me in.', 'effect', 'line:Thanks.', 'end',
    'effect', 'effect']);
  const end = s.said().find((e) => e.kind === 'end');
  assert.deepEqual([end.dialogue, end.why], ['d1', 'End of dialogue']);
  const by = s.log().map(({ line }) => line).find((l) => /^fire\|M\|L4\|/.test(l));
  assert.match(by, /UCEd_M0/, 'set off by the Story');
});

test('the player talks: what can start, busy while one plays, its conditions, played once', () => {
  const s = session();
  const why = () => Object.fromEntries(s.talks().map((t) => [t.id, t.why]));
  assert.deepEqual(s.talks().map((t) => [t.id, t.title, t.owner, t.start]), [['d1', 'Gate talk', 'Guard1', 'talk'], ['d2', 'Second talk', 'Guard1', 'talk']]);
  assert.deepEqual(why(), { d1: '', d2: 'unmet' });
  s.talk('d1');
  assert.equal(s.said()[0].by, 'JCDentonMale0');
  assert.deepEqual(why(), { d1: 'busy', d2: 'busy' });
  s.fire({ thing: 'Button1', output: 'used' });      // the rule's "Start the dialogue" while it plays
  s.step(1);
  assert.ok(s.log().some(({ line }) => line === 'fail|M|L1|talk|d1|busy'), s.log().map((x) => x.line).join('\n'));
  for (const k of [-1, -1, 0, -1]) s.say(k);
  assert.equal(s.talking(), null);
  assert.deepEqual(why(), { d1: 'played', d2: '' });
  s.talk('d2');
  s.say(-1);
  s.talk('d2');
  assert.equal(s.talking().id, 'd2', 'once: false, it plays again');
});

test('an owner the state says is missing cannot talk; one the world does not list can', () => {
  const s = session({ ...W, actors: W.actors.filter((a) => a.name !== 'Guard1') });
  assert.equal(s.talks()[0].why, '');
  s.set({ missing: ['Guard1'] });
  assert.equal(s.talks()[0].why, 'missing');
  const t = session();
  t.set({ dead: ['Guard1'] });
  assert.equal(t.talks()[0].why, 'missing');
});

test('an InfoLink says its lines and does its actions; heard once', () => {
  const s = createSession({ actors: RULES.map((r) => (r.name === 'UCLink_L5' ? link('L5', 'used', 'UCL_Button1', ['0|infolink||i1||'], 'Button1') : r))
    .filter((r) => r.name !== 'UCLink_L1'), outputs: logic.outputs, world: W, map: 'M' });
  s.fire({ thing: 'Button1', output: 'used' });
  s.step(1);
  assert.deepEqual(said(s), ['Called']);
  assert.deepEqual(s.said().filter((e) => e.kind === 'line').map((e) => [e.infolink, e.who, e.text]), [['i1', 'Jock', 'Heads up.']]);
  s.fire({ thing: 'Button1', output: 'used' });
  s.step(1);
  assert.ok(s.log().some(({ line }) => line === 'fail|M|L5|infolink|i1|heard'), 'the second time: heard already');
});

test('the clock back and forward: the conversation as it was', () => {
  const s = session();
  s.step(2);
  s.talk('d1');
  s.step(1);
  s.say(-1);
  s.step(1);
  const at = s.t, before = JSON.stringify([s.talking(), s.said(), s.log()]);
  s.scrub(0);
  assert.equal(s.talking(), null);
  assert.deepEqual(s.said(), []);
  s.scrub(at);
  assert.equal(JSON.stringify([s.talking(), s.said(), s.log()]), before);
  s.restart();
  assert.deepEqual(s.said(), []);
});

test('no steps given: the dialogue a rule starts ends at once, as before', () => {
  const s = session({ ...W, story: { dialogues: ['d1'], infolinks: [] } });
  s.fire({ thing: 'Button1', output: 'used' });
  s.step(1);
  assert.equal(s.talking(), null);
  assert.deepEqual(said(s), ['Over']);
  assert.deepEqual(s.talks(), []);
});

test('Try it\'s log: a rule set off by the Story or by another rule says so, with no class names', async () => {
  const { lineText } = await import('../editor/static/logic-try.js');
  const { vocabulary } = await import('../editor/static/logic-vocab.js');
  const ctx = { vocab: vocabulary(logic), words: { name: (n) => n }, sentences: { G1: 'when the signal Alarm is sent' }, player: 'JCDentonMale0' };
  const fire = (by) => lineText(`fire|M|G1|UCS_Alarm|signal|${by}|`, ctx).text;
  assert.equal(fire('UCEd_22_Story_Bridge0'), 'When the signal Alarm is sent (set off by the Story)');
  assert.equal(fire('UCLink_L2'), 'When the signal Alarm is sent (set off by rule L2)');
  assert.equal(fire('Guard1'), 'When the signal Alarm is sent (set off by Guard1)');
  assert.equal(fire('JCDentonMale0'), 'When the signal Alarm is sent');
});

test('the assistant\'s Try it (logic_try): the dialogue plays through, the first answer offered, its lines in what happened', async () => {
  const { simulate } = await import('../editor/static/logic-propose.js');
  const t = { compiled: { actors: RULES, outputs: logic.outputs }, world: W, catalog: logic, map: 'M', rules: [],
    names: { Guard1: 'Guard' }, storyTitles: { dialogues: { d1: 'Gate talk' } } };
  const r = simulate(t, [{ thing: 'Button1', output: 'used' }], 2);
  const text = r.happened.map((h) => h.text);
  const at = (s) => text.findIndex((x) => x.includes(s));
  assert.ok(at('Guard: "Halt."') >= 0, text.join('\n'));
  assert.ok(at('The player answers: "Let me in."') > at('Guard: "Halt."'));
  assert.ok(at('The player: "Thanks."') > at('The player answers'));
  assert.ok(at('The dialogue "Gate talk" has ended') > at('The player: "Thanks."'));
  assert.ok(text.some((x) => /message "Over"/i.test(x)), text.join('\n'));
  assert.equal(r.state.flags.Talked, true);
});

test('saidLine: a start by a rule says nothing (the rule\'s line does), one by the player says who', async () => {
  const { saidLine } = await import('../editor/static/logic-try.js');
  const ctx = { words: { name: (n) => ({ Guard1: 'Guard' })[n] || n, storyTitle: (k, id) => ({ d1: 'Gate talk' })[id] || id }, player: 'P' };
  assert.equal(saidLine({ kind: 'start', dialogue: 'd1', who: 'Guard1', by: 'UCLink_L1' }, ctx), null);
  assert.equal(saidLine({ kind: 'start', dialogue: 'd1', who: 'Guard1', by: 'P' }, ctx).text, 'The player talks to Guard: "Gate talk"');
  assert.equal(saidLine({ kind: 'effect', step: { type: 'flag', flag: 'A', is: false } }, ctx).text, 'Sets A to No');
  assert.equal(saidLine({ kind: 'effect', action: { type: 'npc', actor: 'Guard1', act: 'attack' } }, ctx).text, 'Guard: attack (the game does it)');
  assert.equal(saidLine({ kind: 'end', dialogue: 'd1', why: 'This answer goes nowhere' }, ctx).text, 'The dialogue "Gate talk" has ended (this answer goes nowhere)');
  assert.equal(saidLine({ kind: 'line', infolink: 'i1', who: 'Jock', text: 'Hi.' }, ctx).text, 'Jock: "Hi."');
});
