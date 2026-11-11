// Mission phases in the page (editor/static/mission-phases.js, P3 slice 7): a Phases block linked to a set of the
// project's takes its phases and its name, as editor/missionphases.py apply() gives them to the builds
// (tests/test_mission_phases.py); linking and unlinking keep edits.logic tidy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setProps, missionLinks, linkedSet, linkedId, linkBlock, syncMission, cleanText } from '../editor/static/mission-phases.js';

const RAID = { id: 'MP1', name: 'Raid', phases: ['Calm', 'Alarm', 'Escape'] };

test('Mission phases: a set says a block\'s settings as the edits keep them', () => {
  assert.deepEqual(setProps(RAID), { Phases: '"Calm, Alarm, Escape"', StateName: '"Raid"' });
  assert.equal(cleanText(' Ra"id, |x '), 'Raid x');
});

test('Mission phases: linking a block gives it the set; unlinking leaves no empty logic behind', () => {
  const edits = { props: { Ph: { Phases: '"One"', bDebug: 'True' } } };
  linkBlock(edits, 'Ph', 'MP1', [RAID]);
  assert.deepEqual(edits.logic, { mission: { Ph: 'MP1' } });
  assert.deepEqual(edits.props.Ph, { Phases: '"Calm, Alarm, Escape"', StateName: '"Raid"', bDebug: 'True' });
  assert.equal(linkedSet(edits, 'ph', [RAID]), RAID, 'names in any case, as the engine');
  linkBlock(edits, 'PH', '', [RAID]);
  assert.equal(edits.logic, undefined);
  assert.equal(edits.props.Ph.StateName, '"Raid"', 'unlinked, it keeps the phases it has');
});

test('Mission phases: a changed set changes the linked blocks; a gone set leaves them as they are', () => {
  const edits = { logic: { mission: { A: 'MP1', B: 'MP7' }, groups: {} }, props: { B: { Phases: '"x"' } } };
  assert.deepEqual(syncMission(edits, [RAID]), ['A']);
  assert.deepEqual(syncMission(edits, [RAID]), [], 'nothing more to change');
  assert.deepEqual(syncMission(edits, [{ ...RAID, phases: ['Calm'] }]), ['A']);
  assert.equal(edits.props.A.Phases, '"Calm"');
  assert.deepEqual(edits.props.B, { Phases: '"x"' });
  assert.equal(linkedSet(edits, 'B', [RAID]), null);
  assert.equal(linkedId(edits, 'B'), 'MP7', 'its link is kept: the Inspector says the set is gone');
  assert.deepEqual(missionLinks({ logic: { mission: { C: '' } } }), {});
});

test('Mission phases: All properties do not win over the set', () => {
  const edits = { logic: { mission: { Ph: 'MP1' } }, rawprops: { ph: { stateName: '"Other"', bHidden: 'True' } } };
  assert.deepEqual(syncMission(edits, [RAID]), ['Ph']);
  assert.deepEqual(edits.rawprops.ph, { bHidden: 'True' });
});
