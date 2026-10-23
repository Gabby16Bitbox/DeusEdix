import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const model = await readFile(new URL('../editor/static/state-model.js', import.meta.url), 'utf8');
const modelURL = 'data:text/javascript;base64,' + Buffer.from(model).toString('base64');
const source = (await readFile(new URL('../editor/static/story-state.js', import.meta.url), 'utf8')).replace("'./state-model.js'", JSON.stringify(modelURL));
const {collectDraftStates, conditionProblems, conditionRows, removeCondition} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const ids = {playedFlag: dialogue => (dialogue.replaces || 'UCEd1234_' + dialogue.id) + '_Played', heardFlag: info => 'UCEd1234_' + info.id + '_Heard'};
const fixture = {
  dialogues: [{id: 'd1', title: 'Guard', owner: 'Guard0', requires: [{flag: 'Clearance', is: false, expiration: 3}], steps: [
    {type: 'if', flag: 'OldPlaceholder', goto: 'End', requires: [{flag: 'Alarm', is: true, expiration: 7}]},
    {type: 'flag', flag: 'OldWrite', requires: [{flag: 'Alarm', is: false, expiration: 99}]},
    {type: 'choice', options: [{text: 'Open the gate', flag: 'GatePermission', is: false, requires: [{flag: 'NativeChoice', is: true, expiration: 4}]}]},
    {type: 'do', do: [{type: 'flag', flag: 'TalkedToGuard', is: true}]},
  ]}, {id: 'copy', replaces: 'OriginalCon', steps: []}, {id: 'off', disabled: true, steps: []}],
  infolinks: [{id: 'i1', title: 'Briefing', do: [{type: 'flag', flag: 'Briefed', is: true}]}],
  events: [{id: 'e1', title: 'Arrival', when: {type: 'flag', flag: 'GatePermission', is: true}, requires: [{flag: 'Clearance', is: true}], do: [{type: 'flag', flag: 'Arrived', is: true}]}],
};
const links = [{id: 'L1', src: 'Button0', label: 'Open gate', do: [{verb: 'flag', a: 'DoorOpen', b: '1'}, {verb: 'message', a: 'Not a flag'}]}];
const original = structuredClone(fixture), originalLinks = structuredClone(links);
const entries = collectDraftStates(fixture, '01_Gate', ids, links);
const byName = Object.fromEntries(entries.map(entry => [entry.flag, entry]));
assert.deepEqual(fixture, original); assert.deepEqual(links, originalLinks);
assert.equal(byName.OldPlaceholder, undefined); assert.equal(byName.OldWrite, undefined);
assert.deepEqual(new Set(byName.Alarm.uses.map(use => use.kind)), new Set(['read', 'write']));
assert.equal(byName.NativeChoice.uses[0].kind, 'read');
assert.equal(byName.NativeChoice.uses[0].context, 'Dialogue: Guard · Answer: Open the gate');
assert.deepEqual(byName.DoorOpen.uses, [{map: '01_Gate', context: 'Interaction: Open gate', kind: 'write'}]);
assert.equal(byName.UCEd1234_d1_Played.source, 'automatic');
assert.equal(byName.UCEd1234_d1_Played.label, 'Guard · Played');
assert.equal(byName.UCEd1234_i1_Heard.label, 'Briefing · Heard');
assert.ok(byName.OriginalCon_Played); assert.equal(byName.UCEd1234_off_Played, undefined);
assert.ok(entries.every(entry => entry.type === 'bool' && Array.isArray(entry.uses)));
assert.deepEqual(conditionProblems(fixture), []);

const lower = collectDraftStates({events: [{id: 'e', when: {type: 'flag', flag: 'OneFlag'}, do: [{type: 'flag', flag: 'oneflag'}]}]}, 'Map', ids);
assert.equal(lower.length, 1); assert.equal(lower[0].uses.length, 2);

const choice = {text: 'Continue', goto: 'End', flag: 'LegacyGate', is: false, skill: 'DeusEx.SkillComputer', skillLevel: 2,
  expiration: 17, voice: {ref: 'Reference'}, requires: [{flag: 'NativeGate', is: true, expiration: 5, imported: {keep: true}}]};
const unchangedChoice = structuredClone(choice);
const rows = conditionRows(choice.requires, choice);
assert.equal(rows[0], choice); assert.equal(rows[1], choice.requires[0]);
assert.deepEqual(choice, unchangedChoice, 'Drawing never migrates a primary choice condition');
assert.ok(removeCondition(choice.requires, choice, choice));
assert.equal(choice.flag, undefined); assert.equal(choice.is, undefined);
assert.equal(choice.expiration, 17); assert.equal(choice.skillLevel, 2); assert.deepEqual(choice.voice, {ref: 'Reference'});
assert.deepEqual(choice.requires, unchangedChoice.requires, 'Deleting primary must not delete native conditions');
assert.equal(removeCondition(choice.requires, {}, choice), false, 'An absent reference must not splice the final row');
const native = choice.requires[0];
assert.equal(removeCondition(choice.requires, native, choice, {minimum: 1}), false);
assert.deepEqual(choice.requires, unchangedChoice.requires);
assert.ok(removeCondition(choice.requires, native, choice)); assert.deepEqual(choice.requires, []);
assert.deepEqual(native, unchangedChoice.requires[0], 'Deleting a row does not mutate its native metadata');

const otherChoice = structuredClone(unchangedChoice);
assert.ok(removeCondition(otherChoice.requires, otherChoice.requires[0], otherChoice));
assert.equal(otherChoice.flag, 'LegacyGate'); assert.equal(otherChoice.is, false);
assert.deepEqual(conditionRows(otherChoice.requires, otherChoice), [otherChoice]);
assert.equal(removeCondition(otherChoice.requires, otherChoice, otherChoice, {minimum: 1}), false);
assert.deepEqual(conditionRows(null), []);

const invalid = {
  dialogues: [{id: 'bad', requires: [{flag: ''}], steps: [
    {type: 'flag', flag: ''}, {type: 'if', requires: [{flag: 'bad name'}]},
    {type: 'choice', options: [{text: 'One', flag: '1invalid', requires: [{flag: ''}]}, {text: 'Always', flag: ''}]},
    {type: 'do', do: [{type: 'flag', flag: ''}]},
  ]}, {id: 'disabled', disabled: true, requires: [{flag: ''}], steps: [{type: 'flag', flag: ''}]}],
  events: [{id: 'badEvent', when: {type: 'flag', flag: ''}, requires: [{flag: 'bad-id'}], do: [{type: 'flag', flag: ''}]}],
  infolinks: [{id: 'badRadio', do: [{type: 'flag', flag: ''}]}],
};
const invalidOriginal = structuredClone(invalid);
const errors = conditionProblems(invalid);
assert.equal(errors.length, 10);
assert.ok(errors.some(error => error.includes('Dialogue "bad" · Step 3 · Answer 1 · Condition 1')));
assert.ok(errors.some(error => error.includes('Event "badEvent" · When')));
assert.ok(errors.some(error => error.includes('InfoLink "badRadio"')));
assert.ok(errors.every(error => !error.includes('disabled')));
assert.deepEqual(invalid, invalidOriginal, 'Validation cannot repair or discard authored data');
assert.deepEqual(conditionProblems({dialogues: [{id: 'emptyNative', steps: [{type: 'if', requires: []}]}]}), ['Dialogue "emptyNative" · Step 1: choose a state.']);
assert.deepEqual(conditionProblems(null), []);
console.log('Story state: draft read/write catalog, native/legacy choice preservation, last-row safety and contextual validation passed');
