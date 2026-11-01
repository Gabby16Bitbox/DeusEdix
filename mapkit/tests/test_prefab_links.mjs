// Linked prefabs (editor/static/prefab-links.js): which placed copies are linked to a prefab of the library and at
// which version, what the user changed on a copy's objects (overrides), Update instances keeping those changes (and
// where the build looks for each object), Apply to prefab clearing the ones the new version has, Unpack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { linkOf, linkFields, copiesOf, outdated, isMember, overridesOf, updateCopy, appliedCopy, unpack, copyCounts, freePid,
  isLibraryVersion, overridesData, putOverrides, memberTag } from '../editor/static/prefab-links.js';

const V1 = 'usr_' + '1'.repeat(32), V2 = 'usr_' + '2'.repeat(32), V3 = 'usr_' + '3'.repeat(32), OTHER = 'usr_' + 'a'.repeat(32);
const clone = (v) => JSON.parse(JSON.stringify(v));

test('a copy of a library prefab is linked: by its line, at its version; others and unpacked copies are not', () => {
  assert.deepEqual(linkOf({ pid: 'p1', prefab: V1 }), { line: V1, version: 1 });          // placed before versions
  assert.deepEqual(linkOf({ pid: 'p1', prefab: V2, line: V1, version: 2 }), { line: V1, version: 2 });
  assert.equal(linkOf({ pid: 'p1', prefab: 'obj_pipe' }), null);                           // a piece of the Pieces
  assert.equal(linkOf({ pid: 'p1', prefab: 'lib_01_NYC_Street_Kiosk' }), null);
  assert.equal(linkOf({ pid: 'p1', prefab: V2, line: V1, version: 2, unpacked: true }), null);
  assert.equal(linkOf(null), null);
  assert.deepEqual(linkFields({ id: V2, line: V1, version: 2 }), { line: V1, version: 2 });
  assert.deepEqual(linkFields({ id: V1 }), { line: V1, version: 1 });                     // an older server's item
  assert.deepEqual(linkFields({ id: 'obj_pipe', kind: 'prefab' }), {});
});

test('the copies of a prefab, the ones behind its newest version and their count for its card', () => {
  const entries = [{ pid: 'p1', prefab: V1 }, { pid: 'p2', prefab: V2, line: V1, version: 2 }, { pid: 'p3', prefab: OTHER },
    { pid: 'p4', prefab: V1, unpacked: true }, { pid: 'p5', prefab: 'obj_pipe' }];
  assert.deepEqual(copiesOf(entries, V1).map((e) => e.pid), ['p1', 'p2']);
  const newest = { id: V2, line: V1, version: 2 };
  assert.equal(outdated(entries[0], newest), true);
  assert.equal(outdated(entries[1], newest), false);
  assert.equal(outdated(entries[2], newest), false);                                        // another prefab
  assert.deepEqual(copyCounts(entries, newest), { count: 2, older: 1 });
});

test("a copy's objects are named after its pid and their slot, nothing else", () => {
  assert.equal(isMember('UCPfp1A3', 'p1'), true);
  assert.equal(isMember('UCPfp1B0', 'p1'), true);
  assert.equal(isMember('UCPfp12A3', 'p1'), false);                                         // the copy p12's
  assert.equal(isMember('UCPfp1M3', 'p1'), false);                                          // its brush's model
  assert.equal(isMember('Light4', 'p1'), false);
});

// a map with two copies of the desk prefab: the user moved, deleted, changed and replaced objects of p1
function map() {
  return {
    prefabs: [{ pid: 'p1', prefab: V1, label: 'Desk', offset: [100, 0, 0], yaw: 16384 }, { pid: 'p2', prefab: V1, label: 'Desk', offset: [0, 0, 0] }],
    moved: { UCPfp1A1: { cls: 'Light', loc: [140, 10, 64], rot: [0, 0, 0], orig: [110, 10, 64] }, Crate1: { cls: 'Crate', loc: [1, 2, 3], orig: [0, 0, 0] } },
    deleted: { UCPfp1A2: { cls: 'Light', orig: [90, -10, 64] }, UCPfp2A2: { cls: 'Light', orig: [90, -10, 64] } },
    props: { UCPfp1A1: { LightBrightness: '200' } },
    rawprops: {},
    disabled: { UCPfp1A4: true, UCPfp1A5: false },
    added: [{ name: 'UCPfp1A3', cls: 'Lamp2', loc: [5, 5, 5], replaces: { cls: 'Lamp1', orig: [5, 5, 5] } }, { name: 'UCEdit1', cls: 'Crate', loc: [0, 0, 0] }],
  };
}

test('overrides: what was changed on one copy, by object', () => {
  const edits = map();
  assert.deepEqual(overridesOf(edits, edits.prefabs[0]), [
    { name: 'UCPfp1A1', kinds: ['moved', 'changed'] }, { name: 'UCPfp1A2', kinds: ['deleted'] },
    { name: 'UCPfp1A3', kinds: ['replaced'] }, { name: 'UCPfp1A4', kinds: ['off in game'] }]);
  assert.deepEqual(overridesOf(edits, edits.prefabs[1]), [{ name: 'UCPfp2A2', kinds: ['deleted'] }]);
  assert.deepEqual(overridesOf({}, { pid: 'p9' }), []);
});

test('Update instances keeps the copy where it is and its changes on the objects the new version still has', () => {
  const edits = map(), entry = edits.prefabs[0];
  // version 2: the light A1 stands elsewhere in the prefab, A2 and A4 are gone, a lamp A6 is new; A3 is still there
  const members = { UCPfp1B0: { cls: 'Brush', loc: [100, 0, 0] }, UCPfp1A1: { cls: 'Light', loc: [100, 30, 64] },
    UCPfp1A3: { cls: 'Lamp1', loc: [6, 6, 6] }, UCPfp1A6: { cls: 'Lamp1', loc: [100, 0, 90] } };
  const gone = updateCopy(edits, entry, { id: V2, line: V1, version: 2, label: 'Office desk' }, members);
  assert.deepEqual(gone, ['UCPfp1A2', 'UCPfp1A4']);
  assert.deepEqual(entry, { pid: 'p1', prefab: V2, label: 'Office desk', offset: [100, 0, 0], yaw: 16384, line: V1, version: 2 });
  // the user's move stays; the build finds the light where version 2 puts it
  assert.deepEqual(edits.moved.UCPfp1A1, { cls: 'Light', loc: [140, 10, 64], rot: [0, 0, 0], orig: [100, 30, 64] });
  assert.deepEqual(edits.props.UCPfp1A1, { LightBrightness: '200' });
  assert.equal(edits.deleted.UCPfp1A2, undefined);
  assert.equal(edits.disabled.UCPfp1A4, undefined);
  assert.deepEqual(edits.added[0].replaces, { cls: 'Lamp1', orig: [6, 6, 6] });
  // the other copy and the map's own objects are left alone
  assert.deepEqual(edits.deleted.UCPfp2A2, map().deleted.UCPfp2A2);
  assert.deepEqual(edits.moved.Crate1, map().moved.Crate1);
  assert.deepEqual(edits.prefabs[1], map().prefabs[1]);
  assert.deepEqual(overridesOf(edits, entry).map((o) => o.name), ['UCPfp1A1', 'UCPfp1A3']);
});

test('Update instances: an object replaced on the copy and gone from the new version stays, as an object of its own', () => {
  const edits = map(), entry = edits.prefabs[0];
  const gone = updateCopy(edits, entry, { id: V2, line: V1, version: 2 }, { UCPfp1A1: { loc: [0, 0, 0] } });
  assert.ok(gone.includes('UCPfp1A3'));
  assert.deepEqual(edits.added[0], { name: 'UCPfp1A3', cls: 'Lamp2', loc: [5, 5, 5] });
  assert.equal(entry.label, 'Desk');                                                        // no new name given
  assert.throws(() => updateCopy(edits, { pid: 'p9', prefab: 'obj_pipe' }, { id: V3, version: 3 }, {}), /not linked/);
});

test('Apply to prefab: the copy is the new version, the changes the build put into its objects are the prefab\'s now', () => {
  const edits = map(), entry = edits.prefabs[0];
  const cleared = appliedCopy(edits, entry, { id: V2, line: V1, version: 2, label: 'Desk' });
  assert.deepEqual(cleared, ['UCPfp1A1', 'UCPfp1A2', 'UCPfp1A3']);
  assert.deepEqual(entry, { pid: 'p1', prefab: V2, label: 'Desk', offset: [100, 0, 0], yaw: 16384, line: V1, version: 2 });
  assert.equal(edits.moved.UCPfp1A1, undefined);
  assert.equal(edits.props.UCPfp1A1, undefined);
  assert.equal(edits.deleted.UCPfp1A2, undefined);
  assert.deepEqual(edits.added.map((a) => a.name), ['UCEdit1']);                            // the replacing lamp is in the version
  assert.equal(edits.disabled.UCPfp1A4, true);                                              // off in game: still the copy's
  assert.deepEqual(edits.deleted.UCPfp2A2, map().deleted.UCPfp2A2);
  assert.deepEqual(overridesOf(edits, entry), [{ name: 'UCPfp1A4', kinds: ['off in game'] }]);
});

test('a new copy\'s pid: never one the edits still name, a deleted copy\'s records keep theirs', () => {
  assert.equal(freePid({}), 'p1');
  assert.equal(freePid({ prefabs: [{ pid: 'p1' }, { pid: 'p3' }] }), 'p2');
  // p1 deleted (removeStructure takes its entry only): what was done to its objects stays, and Undo brings it back with it
  const left = { prefabs: [], moved: { UCPfp1A0: { cls: 'Light', loc: [9, 9, 9], orig: [1, 1, 1] } }, deleted: { UCPfp2A1: { cls: 'Light' } } };
  assert.equal(freePid(left), 'p3');
  // named anywhere: an object given another class, an animation, a cutscene's target, a folder, a hidden or locked object
  assert.equal(freePid({ added: [{ name: 'UCPfp1A3', replaces: { cls: 'Lamp1' } }] }), 'p2');
  assert.equal(freePid({ motions: { UCPfp1B0: {} } }), 'p2');
  assert.equal(freePid({ cutscenes: { Intro: { events: [{ target: 'UCPfp1A2' }] } } }), 'p2');
  assert.equal(freePid({ nests: [{ id: 'n1', items: ['s:paste~p1'] }] }), 'p2');
  assert.equal(freePid({}, ['a:UCPfp1A0', 'b:UCPfp2B0']), 'p3');
  // other names are no copy's: p12's objects, a brush's model, a map's own objects
  assert.equal(freePid({ moved: { UCPfp12A0: {}, UCPfp1M3: {}, Light4: {} }, prefabs: [{ pid: 'p12' }] }), 'p1');
});

test('the finding\'s case: a copy placed after another was deleted has none of its changes, Update moves none onto it', () => {
  const edits = { prefabs: [{ pid: 'p1', prefab: V1, line: V1, version: 1 }],
    moved: { UCPfp1A0: { cls: 'Light', loc: [500, 0, 64], orig: [110, 10, 64] } }, deleted: { UCPfp1A1: { cls: 'Light', orig: [90, -10, 64] } } };
  edits.prefabs = [];                                                                     // the copy deleted
  const entry = { pid: freePid(edits), prefab: V1, line: V1, version: 1 };
  edits.prefabs.push(entry);
  assert.notEqual(entry.pid, 'p1');
  assert.deepEqual(overridesOf(edits, entry), []);
  const members = Object.fromEntries(['A0', 'A1'].map((slot, i) => [`UCPf${entry.pid}${slot}`, { loc: [2000 + i, 0, 64] }]));
  assert.deepEqual(updateCopy(edits, entry, { id: V2, line: V1, version: 2 }, members), []);
  assert.deepEqual(edits.moved.UCPfp1A0.orig, [110, 10, 64]);                            // left where the build skips it
  assert.equal(isLibraryVersion(V1), true);
  assert.equal(isLibraryVersion('obj_pipe'), false);
});

test('another copy of a copy (Duplicate, Copy and Paste) takes what was changed on its objects, moved with it', () => {
  const edits = map(), before = clone(edits), data = overridesData(edits, 'p1');
  assert.deepEqual(Object.keys(data).sort(), ['added', 'deleted', 'disabled', 'moved', 'props']);    // by slot; no rawprops here
  assert.deepEqual(data.moved, { A1: before.moved.UCPfp1A1 });
  data.moved.A1.loc[0] = 0;
  assert.deepEqual(edits, before);                                      // a copy of the records: they are as they were
  putOverrides(edits, overridesData(edits, 'p1'), 'p3', [50, -20, 8]);
  assert.deepEqual(edits.moved.UCPfp3A1, { cls: 'Light', loc: [190, -10, 72], rot: [0, 0, 0], orig: [160, -10, 72] });
  assert.deepEqual(edits.deleted.UCPfp3A2, { cls: 'Light', orig: [140, -30, 72] });
  assert.deepEqual(edits.props.UCPfp3A1, { LightBrightness: '200' });
  assert.deepEqual([edits.disabled.UCPfp3A4, edits.disabled.UCPfp3A5], [true, false]);
  assert.deepEqual(edits.added.at(-1), { name: 'UCPfp3A3', cls: 'Lamp2', loc: [55, -15, 13], replaces: { cls: 'Lamp1', orig: [55, -15, 13] } });
  // the new copy's overrides are the old one's, by slot; the other copy's and the map's own records left alone
  const slots = (pid) => overridesOf(edits, { pid }).map(({ name, kinds }) => [name.slice(memberTag(pid).length), kinds]);
  assert.deepEqual(slots('p3'), slots('p1'));
  assert.deepEqual([edits.deleted.UCPfp2A2, edits.moved.Crate1], [before.deleted.UCPfp2A2, before.moved.Crate1]);
  edits.moved.UCPfp3A1.loc[0] = 0;
  assert.deepEqual(edits.moved.UCPfp1A1, before.moved.UCPfp1A1);       // records of its own
  const kept = overridesData(edits, 'p1'), asTaken = clone(kept);      // the changes given twice (two pastes of one copy)
  putOverrides(edits, kept, 'p6', [1, 0, 0]);
  putOverrides(edits, kept, 'p7', [2, 0, 0]);
  assert.deepEqual(kept, asTaken);
  assert.deepEqual([edits.moved.UCPfp6A1.orig, edits.moved.UCPfp7A1.orig], [[111, 10, 64], [112, 10, 64]]);
  // a copy with nothing changed gives nothing, and nothing is added for it
  assert.deepEqual(overridesData(edits, 'p9'), {});
  const now = clone(edits);
  putOverrides(edits, {}, 'p8', [1, 1, 1]);
  assert.deepEqual(edits, now);
});

test('Unpack forgets the prefab and nothing else', () => {
  const edits = map(), entry = Object.assign(edits.prefabs[0], { prefab: V2, line: V1, version: 2 }), before = clone(edits);
  unpack(entry);
  assert.equal(linkOf(entry), null);
  assert.deepEqual(entry, { pid: 'p1', prefab: V2, label: 'Desk', offset: [100, 0, 0], yaw: 16384, unpacked: true });
  delete before.prefabs[0].line; delete before.prefabs[0].version; before.prefabs[0].unpacked = true;
  assert.deepEqual(edits, before);
  assert.deepEqual(copiesOf(edits.prefabs, V1).map((e) => e.pid), ['p2']);
});
