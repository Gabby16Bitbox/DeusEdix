// The Logic's safe edits (editor/LOGIC.md, the Logic design's P0), app.js's own functions run on stand-ins: Duplicate
// copies the rules its objects start (copyLogicOf: causes kept to the copied objects, the set's targets and
// conditions remapped to the copies, the rest kept, Usable settings moved with the copy and scripting tags copied),
// and Delete asks first when rules name what goes (confirmRuleLoss, with logicNames).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
const body = (name) => {
  const i = source.indexOf(`function ${name}(`);
  assert.ok(i >= 0, name);
  return source.slice(i, source.indexOf('\n}', i) + 2);
};

function page(edits) {
  const asked = [];
  const c = vm.createContext({
    edits, asked,
    lkList: () => (edits.links ||= []),
    lkNewId: () => 'L' + (Math.max(0, ...edits.links.map((l) => +String(l.id).replace(/\D/g, '') || 0)) + 1),
    lkWhere: (n) => [n.length, 0, 0],
    lkSentence: (l) => `rule ${l.id} on ${l.src}`,
    isStruct: (p) => p.userData.kind === 'structure',
    confirm: (text) => { asked.push(text); return false; },
  });
  vm.runInContext([body('logicNames'), body('copyLogicOf'), body('confirmRuleLoss')].join('\n'), c);
  return c;
}
const proxy = (name) => ({ userData: { actor: { name } } });
// values made in the page's realm (vm) compared as plain data
const eq = (actual, expected, message) => assert.deepEqual(actual === undefined ? undefined : JSON.parse(JSON.stringify(actual)), expected, message);

test('Duplicate copies the rules the originals start: the set remapped, the rest kept, only the copied causes', () => {
  const edits = {
    usable: { Lever: { at: [10, 20, 30], text: 'Pull' } }, objectTags: { Lever: { mode: 'manual', value: 'LEVERS' } },
    links: [
      { id: 'L1', src: 'Lever', when: 'used', do: [{ id: 'a1', verb: 'open', target: 'Door' }, { id: 'a2', verb: 'lighton', target: 'Lamp' }],
        requires: [{ type: 'alive', actor: 'Lamp' }] },
      { id: 'L2', src: 'Zone', when: 'enter', also: [{ src: 'Lever', when: 'used' }], do: [{ id: 'a1', verb: 'message', target: '', a: 'hi' }] },
      { id: 'L3', src: 'Door', when: 'opened', do: [{ id: 'a1', verb: 'lightoff', target: 'Lamp' }] },
      { id: 'L4', src: '', when: 'start', do: [{ id: 'a1', verb: 'hide', target: 'Lever' }] },
    ] };
  const c = page(edits);
  const made = c.copyLogicOf([['Lever', 'Lever2'], ['Lamp', 'Lamp2']], 48);
  eq(made, ['L5', 'L6']);
  const [l5, l6] = edits.links.slice(4);
  // L1: its cause the copy, the door outside the set kept, the lamp (in the set) the copy's, its condition too
  assert.equal(l5.src, 'Lever2');
  eq(l5.do.map((x) => x.target), ['Door', 'Lamp2']);
  eq(l5.requires, [{ type: 'alive', actor: 'Lamp2' }]);
  assert.equal(l5.label, 'rule L5 on Lever2');
  eq(l5.at, [6, 0, 0]);
  // L2: heard on the zone and, as well, on the lever: the copy hears only the copied lever
  assert.equal(l6.src, 'Lever2');
  assert.equal(l6.when, 'used');
  assert.equal(l6.also, undefined);
  // L3 (the door, not copied) and L4 (the map's start) are not copied; the originals are as they were
  assert.equal(edits.links.length, 6);
  assert.equal(edits.links[0].src, 'Lever');
  eq(edits.links[0].do.map((x) => x.target), ['Door', 'Lamp']);
  // the copy's Usable settings moved with it, its tag copied
  eq(edits.usable.Lever2, { at: [58, 20, 30], text: 'Pull' });
  eq(edits.objectTags.Lever2, { mode: 'manual', value: 'LEVERS' });
  eq(c.copyLogicOf([['Crate', 'Crate2']], 48), [], 'no rule on it: nothing made');
});

test('Delete asks when rules name what goes, and says which; nothing asked otherwise', () => {
  const edits = { links: [
    { id: 'L1', src: 'Button', when: 'used', do: [{ id: 'a1', verb: 'open', target: 'Door' }] },
    { id: 'L2', src: 'Zone', when: 'enter', requires: [{ type: 'alive', actor: 'Guard' }], do: [] },
  ] };
  const c = page(edits);
  assert.equal(c.confirmRuleLoss([proxy('Crate')]), true);
  eq(c.asked, []);
  assert.equal(c.confirmRuleLoss([proxy('Door'), proxy('Guard')]), false);
  eq(c.asked, ['Door, Guard are used by rules L1, L2. Without them those rules do nothing (Window > Logic shows what is '
    + 'missing). Delete anyway?']);
  assert.equal(c.confirmRuleLoss([{ userData: { kind: 'structure', name: 'Room' } }]), true, 'a structure: its own question');
});
