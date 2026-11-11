// P9 slice 4 on the page: the changes a rule can make (config/logic.json): the player's energy, an augmentation of the
// player (give, raise, set a level, on, off), how two factions see each other, a property of the safe list (Advanced).
// Their sentences, the form's rows, the steps menu, and Try it (logic-sim.js) as UCLink.ChangeAug / Allies /
// SetSafeProp do them (tests/test_logic_changes.py for links.py's side).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vocabulary } from '../editor/static/logic-vocab.js';
import { argRowsHtml } from '../editor/static/logic-rule-ui.js';
import { STEP_GROUPS } from '../editor/static/action-list.js';
import { createSession } from '../editor/static/logic-sim.js';
import { parseLogicLine, logicSentence, LOGIC_TAG } from '../editor/static/logic-log.js';
import { partsText } from '../editor/static/console-lines.js';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);

test('the sentences of the changes', () => {
  const v = vocabulary(logic);
  const ctx = { name: (n) => n, family: () => '' };
  const say = (x) => v.actText(x, ctx);
  assert.deepEqual([
    say({ verb: 'energy', a: '30' }), say({ verb: 'energy', a: '-20' }),
    say({ verb: 'aug', a: 'AugCloak', b: 'give' }), say({ verb: 'aug', a: 'AugSpeed', b: 'raise' }),
    say({ verb: 'aug', a: 'AugSpeed', b: 'level', c: '3' }), say({ verb: 'aug', a: 'AugVision', b: 'on' }),
    say({ verb: 'aug', a: 'AugVision', b: 'off' }),
    say({ verb: 'allies', a: 'MJ12', b: 'UNATCO', c: 'hostile', both: true }), say({ verb: 'allies', a: 'Gang', b: 'Player', c: 'friendly', both: false }),
    say({ verb: 'setprop', target: 'Guard1', a: 'GroundSpeed', b: '400' }), say({ verb: 'setprop', target: 'Guard1', a: 'bInvincible', b: 'True' }),
  ], [
    'give the player 30 energy', 'take 20 energy from the player',
    'give the player Cloak', "raise the player's Speed Enhancement one level", "set the player's Speed Enhancement to level 3",
    "turn on the player's Vision Enhancement", "turn off the player's Vision Enhancement",
    'MJ12 and UNATCO become hostile to each other', 'Gang become friendly to the player',
    'set the running speed of Guard1 to 400', 'set the invincible of Guard1 to yes',
  ]);
});

test('the form: an augmentation, a faction, the properties of the object, the steps menu', () => {
  const h = { esc, name: (n) => n, props: [['Health', 'health'], ['DrawScale', 'size']] };
  const aug = argRowsHtml(logic.inputs.aug.args, { a: 'AugCloak', b: 'level', c: '3' }, 0, h);
  assert.match(aug, /<option value="AugCloak" selected>Cloak<\/option>/);
  assert.match(aug, /<option value="level" selected>set its level<\/option>/);
  const allies = argRowsHtml(logic.inputs.allies.args, { a: 'MJ12', b: '', c: 'hostile', both: true }, 0, h);
  assert.equal((allies.match(/list="factionlist"/g) || []).length, 2, 'both factions offer the faction list');
  assert.doesNotMatch(allies, /<datalist id="factionlist"/, 'the page has that list already');
  assert.match(allies, /type="checkbox"[^>]*data-k="both" checked/);
  const prop = argRowsHtml(logic.inputs.setprop.args, { a: 'health', b: '50' }, 0, h);
  assert.match(prop, /<option value="Health" selected>health<\/option>/, 'any case');
  assert.match(argRowsHtml(logic.inputs.setprop.args, { a: 'LightRadius' }, 0, h), /LightRadius \(not for this object\)/);
  assert.match(prop, /placeholder="a number, or yes \/ no"/);
  const groups = Object.fromEntries(STEP_GROUPS);
  assert.ok(groups['The player'].includes('energy') && groups['The player'].includes('aug'));
  assert.ok(groups['The world'].includes('allies'));
  assert.equal(logic.inputs.setprop.level, 'advanced');
  for (const f of ['character', 'door', 'light', 'object', 'crate', 'other']) {
    assert.ok(logic.families.find((x) => x.id === f).inputs.includes('setprop'), f);
  }
});

// a rule on "a saved game is loaded" doing the steps (links.py writes them so: tests/test_logic_changes.py)
const q = (v) => `"${v}"`;
const rule = (id, acts) => ({ cls: 'UCRule', name: 'UCLink_' + id,
  props: { Tag: 'UCLW_' + id, When: 'loaded', Rule: q(id), ...Object.fromEntries(acts.map((a, i) => [`Act(${i})`, q(a)])) } });
const world = { player: 'JC', actors: [
  { name: 'Guard1', chain: ['UNATCOTroop', 'ScriptedPawn', 'Pawn', 'Actor'], at: [0, 0, 0], alliance: 'UNATCO' },
  { name: 'Guard2', chain: ['MJ12Troop', 'ScriptedPawn', 'Pawn', 'Actor'], at: [0, 0, 0], alliance: 'MJ12' },
  { name: 'Door1', chain: ['DeusExMover', 'Mover', 'Actor'], at: [0, 0, 0] }] };
const run = (acts, before) => {
  const s = createSession({ actors: [rule('C', acts)], outputs: logic.outputs, world, map: 'M' });
  s.run(1);
  if (before) s.set(before);
  const n = s.log().length;
  s.fire({ thing: '', output: 'loaded' });
  s.run(0.5);
  return { s, lines: s.log().slice(n).map(({ line }) => line).filter((l) => !l.startsWith('fire|')) };
};

test('Try it: energy and augmentations change what the conditions read', () => {
  let { s } = run(['0|energy||-30||']);
  assert.equal(s.state().energy, 70);
  ({ s } = run(['0|energy||50||'], { energy: 80 }));
  assert.equal(s.state().energy, 100, 'at most full');
  ({ s } = run(['0|aug||AugSpeed|give|2', '0|aug||AugCloak|level|3', '0|aug||AugVision|raise|2', '0|aug||AugLight|level|4']));
  assert.deepEqual(s.state().augs, { augspeed: { has: true, on: false, level: 1 }, augcloak: { has: true, on: false, level: 3 },
    augvision: { has: true, on: false, level: 1 }, auglight: { has: true, on: false, level: 1 } }, 'raise gives it first; Light has one level');
  ({ s } = run(['0|aug||AugSpeed|raise|2', '0|aug||AugSpeed|on|2'], { augs: { AugSpeed: { has: true, level: 2 } } }));
  assert.deepEqual(s.state().augs.augspeed, { has: true, on: true, level: 3 });
  const { lines } = run(['0|aug||AugNothing|give|2', '0|aug||AugCloak|on|2']);
  assert.deepEqual(lines.filter((l) => l.startsWith('fail')).map((l) => l.replace(/@[\d.]+(#a\d+)?/, '')), ['fail|M|C|aug|AugNothing|noaug', 'fail|M|C|aug|AugCloak|nothad']);
});

test('Try it: a property as the game takes it, factions, the log in words', () => {
  const { lines } = run(['0|setprop|Guard1|GroundSpeed|400.5|', '0|setprop|Guard1|bInvincible|True|', '0|setprop|Guard1|Health|0|',
    '0|setprop|Door1|||', '0|allies||MJ12|UNATCO|hostile both', '0|allies|||Player|hostile']);
  const own = lines.filter((l) => /^(prop|fail)\|/.test(l)).map((l) => l.replace(/@[\d.]+(#a\d+)?/, ''));
  assert.deepEqual(own, ['prop|M|C|Guard1|GroundSpeed|400.500000', 'prop|M|C|Guard1|bInvincible|True', 'prop|M|C|Guard1|Health|1',
    'fail|M|C|setprop|Door1|noprop', 'fail|M|C|allies||noname']);
  const words = (l) => partsText(logicSentence(parseLogicLine(LOGIC_TAG + l)).parts).trim();
  assert.equal(words('prop|M|C|Guard1|GroundSpeed|400.500000'), 'Guard1: GroundSpeed is now 400.500000');
  assert.match(words('fail|M|C|aug|AugNothing|noaug'), /AugNothing: the game has no such augmentation/);
  assert.match(words('fail|M|C|setprop|Door1|noprop'), /not a property the rules may set/);
});
