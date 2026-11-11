// P3's named groups in Try it (editor/static/logic-sim.js), as the game plays them (project-template UCLink.uc
// DoMembers): a step on a group ("members" mode, field 7 the group's name, field 8 its first UCLinkGroup) is said once
// for the group, then done by each member that can do the verb (TagKind: a light does not open), never by the rule's
// own object; a member deleted (not in the map) is left out. The compiled actors are what links.py makes
// (tests/test_logic_groups.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../editor/static/logic-sim.js';
import { parseLogicLine, logicSentence, LOGIC_TAG } from '../editor/static/logic-log.js';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const mover = ['DeusExMover', 'Mover', 'Brush', 'Actor'];
const world = { player: 'JCDentonMale0', actors: [
  { name: 'Button1', chain: ['Button1', 'DeusExDecoration', 'Decoration', 'Actor'], at: [0, 0, 0] },
  { name: 'Door1', chain: mover, at: [100, 0, 0] }, { name: 'Door2', chain: mover, at: [200, 0, 0] },
  { name: 'Light1', chain: ['Light', 'Actor'], at: [300, 0, 0] }] };
const q = (v) => `"${v}"`;
function rule(id, acts) {
  const props = { Tag: 'UCL_Button1', When: 'used', Rule: q(id), Source: '"Button1"' };
  acts.forEach((a, i) => { props[`Act(${i})`] = q(a); });
  return { cls: 'UCLink', name: `UCLink_${id}`, props };
}
const group = (name, members) => ({ cls: 'UCLinkGroup', name, props: Object.fromEntries(members.map((m, i) => [`Member(${i})`, m])) });
const open = (actors) => createSession({ actors, outputs: logic.outputs, world, map: 'M' });
const acts = (s) => s.log().map(({ line }) => line.split('|')).filter((f) => f[0].endsWith('act')).map((f) => f.slice(3).join('|'));
const press = (s) => { s.fire({ thing: 'Button1', output: 'used' }); s.run(0.5); };

test('a step on a group: said once for the group, then done by each member that can', () => {
  const s = open([rule('L1', ['0|open|||||members|Lab doors|UCLG_L1_0_0']),
    group('UCLG_L1_0_0', ['Door1', 'Button1', 'Light1', 'Door2', 'Door1'])]);
  press(s);
  const done = acts(s);
  assert.equal(done[0], 'open|group Lab doors', done.join('\n'));
  assert.deepEqual(done.slice(1).map((l) => l.split('|')[1]), ['Door1', 'Door2'], 'not the light, not the button of the rule, Door1 once');
});

test('the lights of a group: only they turn off', () => {
  const s = open([rule('L1', ['0|lightoff|||||members|Mixed|UCLG_L1_0_0']), group('UCLG_L1_0_0', ['Door1', 'Light1'])]);
  press(s);
  assert.deepEqual(acts(s).slice(1).map((l) => l.split('|')[1]), ['Light1']);
});

test('a member that is not in the map is left out', () => {
  const s = open([rule('L1', ['0|open|||||members|Lab doors|UCLG_L1_0_0']), group('UCLG_L1_0_0', ['Gone1', 'Door2'])]);
  press(s);
  assert.deepEqual(acts(s).slice(1).map((l) => l.split('|')[1]), ['Door2']);
});

test('the log says a group step with the group\'s name', () => {
  const words = (line) => logicSentence(parseLogicLine(LOGIC_TAG + line)).parts.map((p) => (typeof p === 'string' ? p : p.name)).join('');
  assert.match(words('act|M|L1@0.00|open|group Lab doors'), /group Lab doors/);
});
