// "Give it phases" (editor/static/mover-phases.js, P3 slice 8): a door's two phases by its word (config/logic.json
// movers), a state name no other phase set has, the two rules that move the block, and a mover that has them already.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flagName, moverPhaseWords, freeStateName, phasesOfMover, moverPhasesPlan } from '../editor/static/mover-phases.js';

const WORDS = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8')).movers.words;

test('Mover phases: each word has its own, a door\'s when it has none or an unknown one', () => {
  assert.deepEqual(moverPhaseWords(WORDS, 'bridge'), ['Raised', 'Lowered']);
  assert.deepEqual(moverPhaseWords(WORDS, 'lift'), ['Down', 'Up']);
  assert.deepEqual(moverPhaseWords(WORDS, ''), ['Closed', 'Open']);
  assert.deepEqual(moverPhaseWords(WORDS, 'spaceship'), ['Closed', 'Open']);
  assert.deepEqual(moverPhaseWords(null, 'bridge'), ['Closed', 'Open'], 'no table yet');
});

test('Mover phases: the state name is the mover\'s, made free of the others in any letter case', () => {
  assert.equal(freeStateName('Door 3', []), 'Door_3');
  assert.equal(freeStateName('Bridge1', ['bridge1', 'Raid']), 'Bridge12');
  assert.equal(freeStateName('Bridge1', ['Bridge1', 'Bridge12']), 'Bridge13');
  assert.equal(freeStateName('', []), 'Door');
  assert.equal(flagName('3rd gate'), 'X_3rd_gate');
});

test('Mover phases: the plan opens to the second phase and closes to the first', () => {
  const plan = moverPhasesPlan({ label: 'Bridge1', name: 'DeusExMover4', word: 'bridge', words: WORDS, taken: [] });
  assert.equal(plan.stateName, 'Bridge1');
  assert.deepEqual(plan.props, { Phases: '"Raised, Lowered"', StateName: '"Bridge1"' });
  assert.deepEqual(plan.rules, [{ when: 'opened', input: 'GoTo_Lowered' }, { when: 'closed', input: 'GoTo_Raised' }]);
  assert.equal(moverPhasesPlan({ name: 'DeusExMover4', words: WORDS }).stateName, 'DeusExMover4', 'no label: its name');
});

test('Mover phases: a mover whose rules move a Phases block has them already', () => {
  const links = [
    { src: 'Lever', when: 'used', do: [{ verb: 'input', target: 'UCEdit0', a: 'GoTo_Open' }] },
    { src: 'Door1', when: 'used', do: [{ verb: 'input', target: 'UCEdit0', a: 'GoTo_Open' }] },
    { src: 'door1', when: 'opened', do: [{ verb: 'open', target: 'Door2' }, { verb: 'input', target: 'ucedit0', a: 'GoTo_Open' }] },
  ];
  assert.equal(phasesOfMover('Door1', links, ['UCEdit0']), 'UCEdit0');
  assert.equal(phasesOfMover('Door1', links, ['Other']), '', 'not a Phases block');
  assert.equal(phasesOfMover('Door1', links.slice(0, 2), ['UCEdit0']), '', 'only its own opened / closed rules count');
  assert.equal(phasesOfMover('Lever', links, ['UCEdit0']), '');
});
