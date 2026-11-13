// Unreal names ignore letter case and the engine keeps the first spelling it ever registered: a map script's actor
// 'BtnAugs' came back from the build as 'btnAugs' (Revision's code already has the name btnAugs), while the rules in
// edits.links still say 'BtnAugs'. The game runs them (UnrealScript compares names ignoring case); the Logic window
// must too: no "is not in the map any more", one node per object whatever spelling names it, and what links.py writes
// unchanged (the rules keep their spelling).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { logicIndex, logicGraph, present, actorOf as known } from '../editor/static/logic-graph-model.js';
import { logicProblems } from '../editor/static/logic-graph-problems.js';
import { catalog, actorOf } from './logic_graph_world.mjs';

const rule = (over = {}) => ({ id: 'L1', src: 'BtnAugs', when: 'used', do: [{ verb: 'open', target: 'Door3' }], ...over });
const button = actorOf('object', { title: 'the button BtnAugs' });
const door = actorOf('door', { title: 'the door Door3', locked: true });
const input = (links, actors, edits = {}) => ({ catalog, edits: { links, ...edits }, actors, map: '01_Case' });
const objectNodes = (ix) => logicGraph(ix).nodes.filter((n) => n.id.startsWith('obj:')).map((n) => n.id).sort();
const errors = (ix) => logicProblems(ix).filter((p) => p.level === 'error').map((p) => `${p.code}: ${p.text}`);

test("a rule on 'BtnAugs' finds the built 'btnAugs': no problem, one node, not missing", () => {
  const ix = logicIndex(input([rule()], { btnAugs: button, Door3: door }));
  assert.deepEqual(errors(ix), []);
  assert.equal(present(ix, 'BtnAugs'), true);
  assert.equal(known(ix, 'BtnAugs'), button);
  assert.deepEqual(objectNodes(ix), ['obj:Door3', 'obj:btnAugs']);
  assert.equal(logicGraph(ix).nodes.find((n) => n.id === 'obj:btnAugs').missing, false);
  assert.equal(ix.rules[0].l.src, 'BtnAugs');             // the rule as it is: links.py writes it unchanged
});

test('targets, "Or when" sources and the page keyed by the rule\'s spelling: one node for both spellings', () => {
  const links = [
    rule({ also: [{ src: 'BTNAUGS', when: 'used' }] }),
    { id: 'L2', src: 'door3', when: 'opened', do: [{ verb: 'close', target: 'btnaugs' }] },
    { id: 'L3', src: 'Door3', when: 'closed', do: [{ verb: 'lock', target: 'DOOR3' }] }];
  // the page names each object by the spelling a rule gave it (app.js logicInput: actors[n] from lkActor(n))
  const ix = logicIndex(input(links, { BtnAugs: button, btnaugs: button, door3: door, Door3: door }));
  assert.deepEqual(objectNodes(ix), ['obj:BtnAugs', 'obj:door3']);
  assert.deepEqual(errors(ix).filter((e) => /no-source|no-target/.test(e)), []);
  // the wires all reach those two nodes
  const ends = new Set(logicGraph(ix).wires.flatMap((w) => [w.from.node, w.to.node]).filter((id) => id.startsWith('obj:')));
  assert.deepEqual([...ends].sort(), ['obj:BtnAugs', 'obj:door3']);
});

test('deleted or disabled under the built spelling: so is the rule\'s object', () => {
  const gone = logicIndex(input([rule()], { btnAugs: button, Door3: door }, { deleted: { btnAugs: true } }));
  assert.equal(present(gone, 'BtnAugs'), false);
  assert.deepEqual(errors(gone).filter((e) => e.startsWith('no-source')).length, 1);
  const off = logicIndex(input([rule()], { btnAugs: button, Door3: door }, { disabled: { btnAugs: true } }));
  assert.ok(logicProblems(off).some((p) => p.code === 'source-disabled'));
  // "used" by the built spelling (the Inspector writes edits.usable under the object's own name)
  const used = logicIndex(input([rule()], { btnAugs: button, Door3: door }, { usable: { btnAugs: true } }));
  assert.equal(used.ctx.usable('BtnAugs'), true);
});

test('group members in another letter case are in the map', () => {
  const links = [{ id: 'L1', group: 'G1', when: 'used', do: [{ verb: 'open', target: 'Door3' }] }];
  const logic = { groups: [{ id: 'G1', name: 'Buttons', members: ['BtnAugs'] }] };
  const ix = logicIndex(input(links, { btnAugs: button, Door3: door }, { logic }));
  assert.deepEqual(logicProblems(ix).filter((p) => p.code === 'group-empty'), []);
});

test('a door opened in one spelling and locked in another is locked (no "not locked" warning)', () => {
  const links = [{ id: 'L1', src: 'BtnAugs', when: 'used', do: [{ verb: 'open', target: 'vaultdoor' }, { verb: 'lock', target: 'VaultDoor' }] }];
  const vault = actorOf('door', { title: 'the vault door', locked: false });
  const ix = logicIndex(input(links, { BtnAugs: button, vaultdoor: vault, VaultDoor: vault }));      // as the page names them
  assert.deepEqual(logicProblems(ix).filter((p) => p.code === 'not-locked'), []);
});

// app.js lkActor: exact first, then in any case; deleted under the built spelling; a moving block too
const source = fs.readFileSync(process.env.DEUSEDIX_TEST_APP || new URL('../editor/static/app.js', import.meta.url), 'utf8');
function body(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function page(baseActors, edits) {
  const c = vm.createContext({ baseActors, edits: { added: [], deleted: {}, boxes: [], ...edits }, chainNow: { DeusExMover: ['DeusExMover'] }, chainOf() {} });
  vm.runInContext(`${body('allActors')}\n${body('lkActor')}\nthis.lkActor = lkActor;`, c);
  return c;
}

test("lkActor('BtnAugs') finds the built 'btnAugs'; an exact name wins; deleted is gone", () => {
  const built = [{ name: 'btnAugs', cls: 'Button1' }, { name: 'Lamp1', cls: 'Light' }];
  assert.equal(page(built).lkActor('BtnAugs').name, 'btnAugs');
  assert.equal(page(built).lkActor('lamp1').name, 'Lamp1');
  assert.equal(page(built).lkActor('Nothing'), null);
  assert.equal(page(built, { deleted: { btnAugs: true } }).lkActor('BtnAugs'), null);
  // an object added here keeps its own spelling (7 Nov: allActors shows the edit's entry only)
  const added = page([{ name: 'c2', cls: 'UCBCounter' }], { added: [{ name: 'C2', cls: 'UCBCounter' }] });
  assert.equal(added.lkActor('c2').name, 'C2');
  assert.equal(added.lkActor('C2').name, 'C2');
  const mover = page([], { boxes: [{ name: 'LiftBox', mover: true, lo: [0, 0, 0], hi: [64, 64, 64] }] }).lkActor('liftbox');
  assert.equal(mover.name, 'LiftBox');
  assert.equal(mover.cls, 'DeusExMover');
});
