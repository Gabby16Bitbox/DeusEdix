// P9 slice 3 on the page: the world's own happenings (config/logic.json hears 'world'): a saved game loaded, the player
// coming back to the map, a goal completed, a noise near the player, a character or a body appearing. Their sentences,
// the "+ When..." menu's "The world" part (never an "Or when..."), and Try it (logic-sim.js): a button for each, the
// rules of that happening started as UCRule.LookAtWorld / HearNoise / HearSpawn start them (tests/test_logic_world.py
// for links.py's side).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vocabulary } from '../editor/static/logic-vocab.js';
import { WORLD_CAUSES, GAME_WORLD, causeDefaults, causeRowsHtml, ruleOptionsHtml } from '../editor/static/logic-rule-ui.js';
import { createSession } from '../editor/static/logic-sim.js';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);

test('the sentences of the world', () => {
  const v = vocabulary(logic);
  const ctx = { name: (n) => n, family: () => '' };
  const say = (c) => v.whenText({ src: '', ...c }, ctx);
  assert.deepEqual([
    say({ when: 'loaded' }), say({ when: 'back' }), say({ when: 'goaldone', goal: 'FindIt' }), say({ when: 'goaldone', goal: '' }),
    say({ when: 'noise', noise: 'gunshot', within: '0' }), say({ when: 'noise', noise: 'loud', within: '300' }),
    say({ when: 'noise', noise: 'alarm' }), say({ when: 'noise', noise: 'cry' }), say({ when: 'appears', what: 'body' }), say({ when: 'appears' }),
  ], [
    'When a saved game is loaded', 'When the player comes back to the map', 'When the goal "FindIt" is completed',
    'When a goal is completed', 'When a gunshot is heard', 'When a loud noise is heard within 300 units of the player',
    'When an alarm starts', 'When someone cries for help', 'When a body appears', 'When a character appears',
  ]);
});

test('the rule form: "The world" causes, their rows, never an "Or when..."', () => {
  assert.deepEqual(GAME_WORLD, Object.keys(logic.outputs).filter((w) => logic.outputs[w].hears === 'world'));
  for (const w of GAME_WORLD) assert.ok(WORLD_CAUSES.includes(w), w);
  const c = causeDefaults({ when: 'noise' });
  assert.deepEqual([c.noise, c.within], ['loud', '0']);
  assert.equal(causeDefaults({ when: 'appears' }).what, 'character');
  assert.equal(causeDefaults({ when: 'goaldone' }).goal, '');
  const rows = causeRowsHtml(logic.outputs.noise, { when: 'noise', noise: 'cry', within: '0' }, -1, { esc });
  assert.match(rows, /<select data-lkwarg="-1" data-k="noise"/);
  assert.match(rows, /<option value="cry" selected>/);
  assert.match(causeRowsHtml(logic.outputs.goaldone, { when: 'goaldone', goal: '' }, -1, { esc }), /placeholder="any goal"/);
  const more = ruleOptionsHtml({ id: 'L1', when: 'used', src: 'Button1' }, { esc, name: (n) => n, whenLabel: (c, w) => w, eventsOf: () => [], entryOf: () => null });
  for (const w of GAME_WORLD) assert.ok(!more.includes(`value="${w}"`), w);
});

// what links.py makes of the rules (tests/test_logic_world.py)
const q = (v) => `"${v}"`;
const rule = (id, when, arg, more = {}) => ({ cls: 'UCRule', name: 'UCLink_' + id,
  props: { Tag: 'UCLW_' + id, When: when, Rule: q(id), ...(arg ? { WorldArg: q(arg) } : {}), 'Act(0)': q(`0|message||${id}||`), ...more } });
const RULES = [rule('W1', 'loaded'), rule('W2', 'back'), rule('W3', 'goaldone', 'FindIt'), rule('W4', 'goaldone'),
  rule('W5', 'noise', 'gunshot', { NearDist: '0.000000' }), rule('W6', 'noise', 'loud', { NearDist: '0.000000' }),
  rule('W9', 'appears', 'character'), rule('W10', 'appears', 'body')];
const world = { player: 'JC', actors: [{ name: 'Guard1', chain: ['UNATCOTroop', 'ScriptedPawn', 'Pawn', 'Actor'], at: [0, 0, 0] }] };
const open = () => createSession({ actors: RULES, outputs: logic.outputs, world, map: 'M' });
const fired = (s, from = 0) => s.log().slice(from).filter(({ line }) => line.startsWith('fire|')).map(({ line }) => line.split('|')[2].split('@')[0]);

test('Try it: a button for each happening, as the rules ask for it', () => {
  const s = open();
  assert.deepEqual(s.happenings().map((h) => [h.output, h.world, h.rules]), [
    ['loaded', {}, ['W1']], ['back', {}, ['W2']], ['goaldone', { goal: 'FindIt' }, ['W3']], ['goaldone', { goal: 'AnyGoal' }, ['W4']],
    ['noise', { noise: 'gunshot' }, ['W5']], ['noise', { noise: 'loud' }, ['W6']], ['appears', { what: 'character' }, ['W9']],
    ['appears', { what: 'body' }, ['W10']]]);
  s.run(1);
  assert.deepEqual(fired(s), [], 'nothing of the world happens by itself');
});

test('Try it: each happening starts the rules it fits', () => {
  const s = open();
  s.run(1);
  const when = (h) => { const n = s.log().length; s.fire(h); s.run(0.2); return fired(s, n); };
  assert.deepEqual(when({ thing: '', output: 'loaded' }), ['W1']);
  assert.deepEqual(when({ thing: '', output: 'back' }), ['W2']);
  assert.deepEqual(when({ thing: '', output: 'goaldone', goal: 'findit' }), ['W3', 'W4'], 'a goal of its name (any case), and any goal');
  assert.deepEqual(when({ thing: '', output: 'goaldone', goal: 'Other' }), ['W4']);
  assert.deepEqual(when({ thing: 'Guard1', output: 'noise', noise: 'gunshot' }), ['W5', 'W6'], 'a rule on a loud noise hears a shot');
  assert.deepEqual(when({ thing: '', output: 'noise', noise: 'loud' }), ['W6']);
  assert.deepEqual(when({ thing: '', output: 'noise', noise: 'alarm' }), []);
  assert.deepEqual(when({ thing: 'Guard1', output: 'appears', what: 'body' }), ['W10']);
  const line = s.log().filter(({ line }) => line.startsWith('fire|M|W10'))[0].line;
  assert.equal(line.split('|').slice(3, 6).join('|'), 'Guard1|appears|Guard1', 'the one who appeared: "it" and "by"');
});
