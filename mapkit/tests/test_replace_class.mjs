// Replace with... (static/replace-class.js): which properties go over to the new class, where the new object stands,
// and which uses of the name the new class no longer answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KEEP, LOOK, carryProps, seatedAt, turnOf, usesOf, misfits, NEEDS, KEPT } from '../editor/static/replace-class.js';

const has = (...names) => (prop) => names.includes(prop);

test('the properties the new class has go over; its look and what it lacks do not; the lacking ones are listed', () => {
  const old = { Tag: 'Guards', Event: 'Alarm', Health: '80', 'MultiSkins(1)': "Texture'Old.Skin'", Mesh: "LodMesh'Old.Body'",
    bHateShot: 'True', 'InitialInventory(0)': '(Inventory=Class\'DeusEx.WeaponPistol\',Count=1)' };
  const r = carryProps(old, {}, has('Tag', 'Event', 'Health', 'InitialInventory', 'MultiSkins', 'Mesh'));
  assert.deepEqual(r.props, { Tag: 'Guards', Event: 'Alarm', Health: '80', 'InitialInventory(0)': old['InitialInventory(0)'] });
  assert.deepEqual(r.lost, ['bHateShot']);                // the look is the new class's, never listed as lost
});

test("the item's own preset wins over what goes over, but never over the object's Tag, Event, names and orders", () => {
  const old = { Tag: 'Guards', Event: 'Alarm', BindName: '"Gunther"', Orders: 'Patrolling', OrderTag: 'P1', Alliance: 'MJ12', Health: '80' };
  const preset = { Tag: 'Arrival', Alliance: 'UNATCO', Orders: 'Wandering', 'MultiSkins(0)': "Texture'New.Face'", BindName: '"UCEd_X"' };
  const r = carryProps(old, preset, () => true);
  assert.deepEqual(r.props, { Tag: 'Guards', Event: 'Alarm', BindName: '"Gunther"', Orders: 'Patrolling', OrderTag: 'P1',
    Alliance: 'UNATCO', Health: '80', 'MultiSkins(0)': "Texture'New.Face'" });
  assert.deepEqual(r.lost, []);
  for (const k of ['Tag', 'Event', 'BindName', 'textTag', 'Orders', 'OrderTag']) assert.ok(KEEP.has(k), k);
  for (const k of ['Mesh', 'Skin', 'MultiSkins', 'CollisionRadius', 'CollisionHeight', 'PrePivot', 'DrawScale']) assert.ok(LOOK.has(k), k);
});

test("what a new object of the item starts with only fills in: the old light's colour stays", () => {
  const r = carryProps({ Tag: 'Lamp', LightHue: '0', LightRadius: '32' }, {}, () => true,
    { LightBrightness: 128, LightHue: 32, LightRadius: 12, LightEffect: 'LE_Spotlight' });
  assert.deepEqual(r.props, { LightBrightness: 128, LightHue: '0', LightRadius: '32', LightEffect: 'LE_Spotlight', Tag: 'Lamp' });
});

test('a KEEP property the new class does not have is lost too, not forced on it', () => {
  const r = carryProps({ Tag: 'Crate1', OrderTag: 'P1' }, { Tag: 'Arrival' }, has('Tag'));
  assert.deepEqual(r.props, { Tag: 'Crate1' });
  assert.deepEqual(r.lost, ['OrderTag']);
  assert.deepEqual(carryProps(undefined, null, () => true), { props: {}, lost: [] });
});

test('the new object stands where the old one stood; something tipped keeps its middle', () => {
  assert.deepEqual(seatedAt([10, 20, 16], [0, 4000, 0], 16, 48), [10, 20, 48]);          // a crate's place, a guard on its feet
  assert.deepEqual(seatedAt([10, 20, 48], [0, 0, 0], 48, 16), [10, 20, 16]);
  assert.deepEqual(seatedAt([10, 20, 100], [-16384, 0, 0], 16, 48), [10, 20, 100]);      // a lamp on a wall
  assert.deepEqual(seatedAt([10, 20, 100], [0, 0, 512], 16, 48), [10, 20, 100]);
  assert.deepEqual(seatedAt([10, 20, 100], [65536, 0, 0], 16, 48), [10, 20, 132]);       // a whole turn is upright
  assert.deepEqual(seatedAt([1, 2, 3], [0, 0, 0], 0, 48), [1, 2, 3]);                     // a height not known
});

test('a character only keeps its yaw; anything else its whole turn', () => {
  assert.deepEqual(turnOf([-2000, 16384, 300], true), [0, 16384, 0]);
  assert.deepEqual(turnOf([-2000, 16384, 300], false), [-2000, 16384, 300]);
  assert.deepEqual(turnOf([], false), [0, 0, 0]);
});

const links = [
  { id: 'L1', src: 'Guard1', when: 'dies', do: [{ verb: 'open', target: 'Door1' }] },
  { id: 'L2', src: 'Button1', when: 'used', do: [{ verb: 'attack', target: 'Guard1' }, { verb: 'open', target: 'Door1' }],
    requires: [{ type: 'alive', actor: 'Guard1', is: true }] },
  { id: 'L3', src: 'Button2', when: 'used', do: [{ verb: 'open', target: 'Door1' }] },
];
const story = {
  dialogues: [{ id: 'd1', title: 'Hello', owner: 'Guard1', steps: [{ type: 'line', who: 'npc', text: 'Hi' }, { type: 'line', who: 'actor:Guard1', text: 'Again' }] },
    { id: 'd2', title: 'Other', owner: 'Bob', steps: [{ type: 'line', who: 'actor:Guard1', text: 'Me too' }] }],
  events: [{ id: 'e1', title: 'Shot', when: { type: 'dead', actor: 'Guard1' }, do: [{ type: 'door', actor: 'Guard1', act: 'open' }] },
    { id: 'e2', title: 'Start', when: { type: 'start' }, do: [{ type: 'npc', actor: 'Bob', act: 'goto' }] }],
};

test('every use of the name: rules, the Story, the editor data kept under it, routes through it', () => {
  const uses = usesOf('Guard1', { links, story, edits: { anims: { Guard1: { idle: 'Wave' } }, behave: { Bob: {} }, texts: { Guard1: {} } },
    routes: ['Officer Rossi'] });
  const kinds = uses.map((u) => u.need + ':' + (u.rule?.id || u.where || u.field || u.who));
  assert.deepEqual(kinds, ['output:L1', 'input:L2', 'character:L2', 'talker:dialogue "Hello"', 'talker:dialogue "Other"',
    'character:event "Shot"', 'door:event "Shot"', 'character:anims', 'computer:texts', 'patrol:Officer Rossi']);
  assert.equal(uses.find((u) => u.need === 'input').action.verb, 'attack');
  assert.equal(uses.find((u) => u.field === 'anims').label, KEPT.find(([f]) => f === 'anims')[2]);
  assert.deepEqual(usesOf('Nobody', { links, story }), []);
  assert.deepEqual(usesOf('Guard1'), []);
});

test('what the new class does not answer: needs as flags, rule outputs and inputs as tests', () => {
  const uses = usesOf('Guard1', { links, story });
  const barrel = { output: (u) => ['destroyed'].includes(u.rule.when), input: (u) => ['on', 'off'].includes(u.action.verb),
    character: false, talker: true, door: false };
  assert.deepEqual(misfits(uses, barrel).map((u) => u.need), ['output', 'input', 'character', 'character', 'door']);
  const troop = { output: (u) => u.rule.when === 'dies', input: (u) => u.action.verb === 'attack', character: true, talker: true, door: false };
  assert.deepEqual(misfits(uses, troop).map((u) => u.need), ['door']);
  for (const u of uses) assert.ok(NEEDS[u.need], u.need);       // each need says why it no longer fits
});
