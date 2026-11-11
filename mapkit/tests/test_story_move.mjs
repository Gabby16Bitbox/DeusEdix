// P5 "Move to Logic" (static/story-move.js): a Story event made a rule of the map that does the same in the game.
// Its cause (the map's start, or its condition becoming true, also when it holds at the start), its conditions
// checked together and each setting it off again ("Or when"), waiting for a conversation, the UNATCO route; the
// Story's actions as the rules' verbs; what cannot move, and why, in words; what Put back loses.
// tests/fixtures/story_move_vault.json is the rule test_story_move.py builds (links.blocks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moveEvent, moveAction, putBackLoss } from '../editor/static/story-move.js';

const own = { standalone: true };
const ev = (when, more = {}) => ({ id: 'e1', title: 'T', when, once: true, requires: [], do: [{ type: 'message', text: 'hi' }], ...more });

test('the fixture: an event on a state with two conditions, on the mod\'s UNATCO route', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/story_move_vault.json', import.meta.url), 'utf8'));
  const m = moveEvent(fx.event, fx.context);
  assert.deepEqual(m.refused, []);
  assert.deepEqual(m.rule, fx.rule);
  const r = m.rule;
  assert.equal(r.src, ''); assert.equal(r.when, 'becomes'); assert.equal(r.watchStart, true); assert.equal(r.talkBusy, 'wait');
  assert.deepEqual(r.watch, { flag: 'Vault_Open', is: true });
  // its own condition first, then the event's, then the route
  assert.deepEqual(r.requires.map((c) => c.flag || c.actor || c.item), ['Vault_Open', 'Guard1', 'DeusEx.Multitool', 'UNATCORouteCommitted']);
  // each of the event's conditions sets it off again when it becomes true (the Story looks at all of them together)
  assert.deepEqual(r.also.map((c) => [c.when, c.watch.flag || c.watch.actor || c.watch.item]),
    [['becomes', 'Guard1'], ['becomes', 'DeusEx.Multitool'], ['becomes', 'UNATCORouteCommitted']]);
  assert.deepEqual(r.do.map((a) => [a.verb, a.target || '', a.a || '', a.b || '']),
    [['message', '', 'The alarm!', ''], ['attack', 'Guard1', 'alone', ''], ['lock', 'Door2', '', ''], ['flag', '', 'Alarm', '1'], ['signal', '', 'Raid', '']]);
  assert.deepEqual(r.origin, { story: 'e3', title: 'Vault alarm' });
  assert.ok(m.notes.some((n) => /UNATCO route/.test(n)));
});

test('each kind of event start: the map\'s start, a state, a death, an item', () => {
  const start = moveEvent(ev({ type: 'start' }, { requires: [{ flag: 'A', is: true }] }), own).rule;
  assert.deepEqual([start.when, start.watchStart, start.also, start.requires], ['start', undefined, undefined, [{ flag: 'A', is: true }]]);
  const flag = moveEvent(ev({ type: 'flag', flag: 'Power', is: false }), own).rule;
  assert.deepEqual([flag.when, flag.watch, flag.also], ['becomes', { flag: 'Power', is: false }, undefined]);
  assert.equal(flag.requires, undefined);                 // alone, its becoming true says it holds
  assert.deepEqual(moveEvent(ev({ type: 'dead', actor: 'Boss' }), own).rule.watch, { type: 'alive', actor: 'Boss', is: false });
  assert.deepEqual(moveEvent(ev({ type: 'item', item: 'DeusEx.NanoKey' }), own).rule.watch, { type: 'item', item: 'DeusEx.NanoKey', has: true });
  // the player comes near a point: the condition "near a point", whole units, the Story's 256 when not said
  const near = moveEvent(ev({ type: 'near', at: [1200.4, -340, 48] }), own);
  assert.deepEqual(near.refused, []);
  assert.deepEqual([near.rule.when, near.rule.watchStart, near.rule.watch], ['becomes', true, { type: 'near', at: [1200, -340, 48], radius: 256, is: true }]);
  assert.match(moveEvent(ev({ type: 'near', at: [0, 'x', 0] }), own).refused.join(), /not filled in/);
  // a project of its own: no route
  assert.equal(start.requires.some((c) => c.flag === 'UNATCORouteCommitted'), false);
  // the Story's "always": no route either
  assert.equal(moveEvent(ev({ type: 'start' }), { route: 'always' }).rule.requires, undefined);
});

test('what cannot move says why, and refuses', () => {
  const why = (e) => moveEvent(e, own).refused.join(' / ');
  assert.match(why(ev({ type: 'hostile', faction: 'NSF' })), /faction turns hostile/);
  assert.match(why(ev({ type: 'flag', flag: '' })), /not filled in/);
  assert.match(why(ev({ type: 'start' }, { do: [{ type: 'trigger', tag: 'Boom' }] })), /make it a signal/);
  assert.match(why(ev({ type: 'start' }, { do: [{ type: 'faction', faction: 'NSF' }] })), /whole faction/);
  assert.match(why(ev({ type: 'start' }, { do: [{ type: 'npc', actor: 'G', act: 'join', faction: 'X' }] })), /joins a faction/);
  assert.match(why(ev({ type: 'start' }, { do: [] })), /no actions/);
  assert.match(why(ev({ type: 'start' }, { requires: [{ flag: '' }] })), /not filled in/);
  const many = Array.from({ length: 8 }, (_, i) => ({ flag: 'F' + i }));
  assert.match(why(ev({ type: 'flag', flag: 'A' }, { requires: many })), /9 conditions.*takes 8/);
  assert.deepEqual(moveEvent(ev({ type: 'start' }, { requires: many }), own).refused, []);
});

test('the Story\'s actions as the rules\' verbs', () => {
  const v = (a) => moveAction(a).act;
  assert.deepEqual(v({ type: 'flag', flag: 'A', is: false }), { delay: 0, verb: 'flag', a: 'A', b: '0' });
  assert.deepEqual(v({ type: 'goal', goal: 'G1', text: 'Find it', done: true }), { delay: 0, verb: 'goal', a: 'G1', b: 'Find it', c: 'done' });
  assert.deepEqual(v({ type: 'note', text: 'n' }), { delay: 0, verb: 'note', a: 'n' });
  assert.deepEqual(v({ type: 'talk', dialogue: 'd2' }), { delay: 0, verb: 'talk', a: 'd2' });
  assert.deepEqual(v({ type: 'infolink', infolink: 'i1' }), { delay: 0, verb: 'infolink', a: 'i1' });
  assert.deepEqual(v({ type: 'travel', map: '02_Next', tag: 'Arrive' }), { delay: 0, verb: 'travel', a: '02_Next', b: 'Arrive' });
  assert.deepEqual(v({ type: 'cutscene', cutscene: 'Cut1' }), { delay: 0, verb: 'cutplay', target: 'Cut1' });
  assert.deepEqual(v({ type: 'door', actor: 'D1', act: 'blow' }), { delay: 0, verb: 'blow', target: 'D1' });
  // the character acts (config/logic.json "story": stop, hide, show)
  assert.equal(v({ type: 'npc', actor: 'G', act: 'stop' }).verb, 'stand');
  assert.equal(v({ type: 'npc', actor: 'G', act: 'hide' }).verb, 'leave');
  assert.equal(v({ type: 'npc', actor: 'G', act: 'show' }).verb, 'appear');
  assert.deepEqual(v({ type: 'npc', actor: 'G', act: 'run', at: [1, 2, 3], nav: true }), { delay: 0, verb: 'run', target: 'G', at: [1, 2, 3], nav: true });
  assert.deepEqual(v({ type: 'npc', actor: 'G', act: 'hostile' }), { delay: 0, verb: 'hostile', target: 'G' });
  assert.deepEqual(v({ type: 'npc', actor: 'G', act: 'sit', seat: 'Chair3' }), { delay: 0, verb: 'sit', target: 'G', a: 'Chair3' });
  assert.match(moveAction({ type: 'npc', actor: 'G', act: 'sit' }).why, /no chair/);
  assert.match(moveAction({ type: 'door', act: 'open' }).why, /no door/);
});

test('what the preview says is not quite the same', () => {
  const notes = (e, c = own) => moveEvent(e, c).notes.join(' | ');
  assert.match(notes(ev({ type: 'flag', flag: 'A' }, { once: false })), /every half second/);
  assert.doesNotMatch(notes(ev({ type: 'flag', flag: 'A' })), /every half second/);
  assert.match(notes(ev({ type: 'flag', flag: 'A' })), /conversation/);
  assert.match(notes(ev({ type: 'flag', flag: 'A' })), /saved before the move/);
  assert.equal(notes(ev({ type: 'start' })), '');
});

test('Put back says what it loses', () => {
  const moved = moveEvent(ev({ type: 'start' }), own).rule;
  const inMap = { ...JSON.parse(JSON.stringify(moved)), id: 'L4', label: 'When the map starts: …' };
  inMap.do[0].id = 'a1';
  assert.equal(putBackLoss(inMap, moved), '');
  inMap.do[0].a = 'changed';
  assert.match(putBackLoss(inMap, moved), /changed in Logic/);
  assert.match(putBackLoss(null, moved), /no longer in the map/);
});
