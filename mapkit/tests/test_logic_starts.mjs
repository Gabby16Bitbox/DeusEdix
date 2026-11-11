// Named starts (P2, editor/static/logic-starts.js): a Play scenario as Try it's start, and a moment of Try it kept as
// a scenario, with what Play cannot set said, not dropped silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startOf, startFromState, startSummary, phaseFlags } from '../editor/static/logic-starts.js';
import { scenarioDraft, cleanScenario } from '../editor/static/play-scenarios.js';
import { createSession } from '../editor/static/logic-sim.js';
import { conditionHolds } from '../editor/static/conditions.js';

test('a scenario as Try it\'s start: its states, the items by either name, credits, skills by bare name', () => {
  const s = scenarioDraft({ name: 'Power on', flags: 'Power=1, Alarm=0;Talked', items: [{ cls: 'DeusEx.Multitool', count: 2 }, { cls: 'Lockpick', count: 1 }],
    credits: 50, skills: [{ cls: 'DeusEx.SkillLockpicking', level: 2 }] });
  const st = startOf(s);
  assert.deepEqual(st.flags, { Power: true, Alarm: false, Talked: true });
  assert.deepEqual(st.items, ['DeusEx.Multitool', 'Multitool', 'Lockpick', 'DeusEx.Lockpick']);
  assert.equal(st.credits, 50);
  assert.deepEqual(st.skills, { SkillLockpicking: 2 });
  assert.deepEqual(startOf(null), {});
  assert.deepEqual(startOf(scenarioDraft({ name: 'x' })), { flags: {}, items: [] }, 'no credits: the game\'s own');
  // the conditions the rules ask read it as the game would
  const game = { flag: (n) => !!st.flags[n], carries: (c) => st.items.includes(c), skill: (n) => st.skills[n] ?? 0, credits: st.credits };
  assert.equal(conditionHolds({ type: 'item', item: 'DeusEx.Multitool', has: true }, game), true);
  assert.equal(conditionHolds({ type: 'item', item: 'Multitool', has: true }, game), true);
  assert.equal(conditionHolds({ type: 'skill', skill: 'SkillLockpicking', level: 2 }, game), true);
});

test('a moment kept as a scenario: over the start it began from, the rest of it kept, what Play cannot set said', () => {
  const base = cleanScenario({ name: 'Lab', start: 'playerstart', setup: 'Mission1', flags: 'Old=1', items: [{ cls: 'DeusEx.Multitool', count: 3 }],
    augs: ['DeusEx.AugSpeed'], health: 80 });
  const derived = phaseFlags({ actors: [{ name: 'UCEdit0', block: { statename: 'Gate 1', phases: ['Closed', 'Open'] } }] });
  assert.deepEqual([...derived], ['gate_1_closed', 'gate_1_open']);
  const state = { flags: { Old: true, Power: true, Gate_1_Open: true, Gate_1_Closed: false }, counters: { Levers: 2, Zero: 0, Gate_1: 2 },
    items: ['DeusEx.Multitool', 'Multitool', 'Crowbar'], credits: 120, skills: { SkillTech: 1 }, dead: ['Guard1'] };
  const { scenario, left } = startFromState(state, { name: 'Power on', base, derived });
  assert.equal(scenario.name, 'Power on');
  assert.equal(scenario.flags, 'Old=1, Power=1', 'a Phases block\'s own states are not a start\'s');
  assert.deepEqual(scenario.items, [{ cls: 'DeusEx.Multitool', count: 3 }, { cls: 'DeusEx.Crowbar', count: 1 }]);
  assert.deepEqual(scenario.skills, [{ cls: 'DeusEx.SkillTech', level: 1 }]);
  assert.equal(scenario.credits, 120);
  assert.equal(scenario.start, 'playerstart');
  assert.equal(scenario.setup, 'Mission1');
  assert.deepEqual(scenario.augs, ['DeusEx.AugSpeed']);
  assert.deepEqual(left, ['the counters (Levers = 2)', 'the phases (Gate_1_Open)', 'who is dead (Guard1)']);
  // it is a scenario the Play window keeps as it is
  const kept = cleanScenario(scenario);
  assert.equal(kept.flags, 'Old=1, Power=1');
  assert.deepEqual(kept.items, scenario.items);
  assert.equal(startSummary(kept), '2 states · 4 items · 120 credits · 1 skill');
  assert.match(startSummary(null), /^The map as it starts/);
});

test('Try it started from a scenario: the rules hear its states and see what the player carries', () => {
  const kit = new URL('../', import.meta.url);
  const logic = JSON.parse(readFileSync(new URL('editor/config/logic.json', kit), 'utf8'));
  const actors = [{ cls: 'UCLink', name: 'UCLink1', props: { Rule: '"L1"', When: 'used', Source: 'Button1', Tag: 'UCL_Button1',
    'Cond(0)': '"flag|Power|1"', 'Cond(1)': '"item|DeusEx.Multitool|1"', 'Act(0)': '"0|message||open"' } }];
  const world = { player: 'JCDentonMale0', actors: [{ name: 'Button1', chain: ['Button1'] }] };
  const run = (start) => {
    const s = createSession({ actors, outputs: logic.outputs, world, map: 'M', start });
    s.fire({ thing: 'Button1', output: 'used' });
    s.step(1);
    return s.log().map((l) => l.line.split('|')[0]);
  };
  assert.deepEqual(run({}), ['skip']);
  const s = scenarioDraft({ name: 'Ready', flags: 'Power=1', items: [{ cls: 'Multitool', count: 1 }] });
  assert.deepEqual(run(startOf(s)), ['fire', 'act']);
});
