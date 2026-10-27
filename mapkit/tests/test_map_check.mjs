// Check map's rules about where things are (static/map-check.js): the same object twice at one spot, and what the
// game drops to the floor when the map starts, so that a thing left in the air is reported, and what hangs is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { STACK_NEAR, AIR_GAP, FALLING, STAYS_UP, fallsWhenLoaded, airGap, stackedCopies, propertiesKey } from '../editor/static/map-check.js';

const thing = (name, cls, loc, extra = {}) => ({ name, cls, loc, rot: [0, 16384, 0], rank: 0, mine: true, ...extra });

test('a double paste: same class, same turn, within 2 units; the one there first stays', () => {
  assert.equal(STACK_NEAR, 2);
  const found = stackedCopies([
    thing('Barrel0', 'Barrel1', [100, 100, 20], { rank: 0, mine: false }),
    thing('UCEdit3', 'Barrel1', [101, 100, 21], { rank: 4 }),
    thing('UCEdit1', 'Barrel1', [100, 101.5, 20], { rank: 2 }),
  ]);
  assert.deepEqual(found, [{ extra: 'UCEdit1', of: 'Barrel0' }, { extra: 'UCEdit3', of: 'Barrel0' }]);
});

test('two things at one spot set differently are put there on purpose: only the same properties are a double paste', () => {
  const sound = (name, extra) => thing(name, 'AmbientSound', [0, 0, 0], extra);
  assert.deepEqual(stackedCopies([sound('A', { props: { AmbientSound: 'Ambient.Hum' } }), sound('B', { rank: 1, props: { AmbientSound: 'Ambient.Rain' } })]), []);
  assert.deepEqual(stackedCopies([sound('A', { props: { AmbientSound: 'Ambient.Hum', SoundRadius: 64 } }),
    sound('B', { rank: 1, props: { SoundRadius: '64', AmbientSound: 'Ambient.Hum' } })]), [{ extra: 'B', of: 'A' }]);   // any order, text or number
  // a trigger with its Event changed beside one without: two triggers
  const trigger = (name, extra) => thing(name, 'FlagTrigger', [8, 8, 0], extra);
  assert.deepEqual(stackedCopies([trigger('FlagTrigger0', { mine: false, props: { Event: 'Door' } }), trigger('FlagTrigger1', { props: { Event: 'Alarm' } })]), []);
  // three at one spot, two the same: the one set differently stays, as does the first
  assert.deepEqual(stackedCopies([sound('A', { props: { AmbientSound: 'x' } }), sound('B', { rank: 1, props: { AmbientSound: 'y' } }),
    sound('C', { rank: 2, props: { AmbientSound: 'x' } })]), [{ extra: 'C', of: 'A' }]);
  assert.equal(propertiesKey(undefined), propertiesKey({}));
});

// app.js checkedProps: what Check map compares, an object's properties now (a light's colour and reach, its own,
// the Properties' changes, All properties'), run as it is
test('what is compared: a copy made by Duplicate has its original\'s properties, a changed one does not', () => {
  const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
  const body = (name) => {                                         // a function of one line, or up to its closing brace
    const at = source.indexOf(`function ${name}(`), first = source.slice(at, source.indexOf('\n', at));
    assert.ok(at >= 0, name);
    return first.trimEnd().endsWith('}') ? first : source.slice(at, source.indexOf('\n}', at) + 2);
  };
  const light = { name: 'Light4', cls: 'Light', light: { b: 200, hue: 10, sat: 90, radius: 20 }, props: { Tag: 'Lamp' } };
  const copy = { name: 'UCEdit3', cls: 'Light', light: light.light };
  const c = vm.createContext({ edits: { added: [{ ...copy }], props: { Light4: { LightRadius: '20' } }, rawprops: {} } });
  vm.runInContext(['checkedProps', 'ownProps', 'lightProps'].map(body).join('\n'), c);
  const proxy = (a, source) => ({ userData: { actor: a, kind: 'light', source } });
  const original = proxy(light, 'map');
  c.edits.added[0].props = JSON.parse(JSON.stringify(c.ownProps(original)));    // what dupOne gives the copy
  const added = proxy(copy, 'added');
  assert.equal(propertiesKey(c.checkedProps(added)), propertiesKey(c.checkedProps(original)));
  c.edits.props.UCEdit3 = { LightRadius: '40' };
  assert.notEqual(propertiesKey(c.checkedProps(added)), propertiesKey(c.checkedProps(original)));
  delete c.edits.props.UCEdit3;
  c.edits.rawprops.UCEdit3 = { bSpecialLit: 'True' };                 // All properties count too
  assert.notEqual(propertiesKey(c.checkedProps(added)), propertiesKey(c.checkedProps(original)));
});

test('not a copy: farther than 2 units, another class, another turn', () => {
  const base = thing('A', 'Barrel1', [0, 0, 0]);
  assert.deepEqual(stackedCopies([base, thing('B', 'Barrel1', [2.5, 0, 0], { rank: 1 })]), []);
  assert.deepEqual(stackedCopies([base, thing('B', 'Crate1', [0, 0, 0], { rank: 1 })]), []);
  assert.deepEqual(stackedCopies([base, thing('B', 'Barrel1', [0, 0, 0], { rank: 1, rot: [0, 0, 0] })]), []);
  // exactly 2 units apart is still one spot
  assert.deepEqual(stackedCopies([base, thing('B', 'Barrel1', [0, 0, 2], { rank: 1 })]), [{ extra: 'B', of: 'A' }]);
});

test('the same turn across the wrap: a whole turn more or less is the same turn', () => {
  const a = thing('A', 'Light', [0, 0, 0], { rot: [0, -16384, 0] }), b = thing('B', 'Light', [0, 0, 0], { rot: [0, 49152, 0], rank: 1 });
  assert.deepEqual(stackedCopies([a, b]), [{ extra: 'B', of: 'A' }]);
  assert.deepEqual(stackedCopies([{ ...a, rot: [0, 65536, 0] }, { ...b, rot: [0, 0, 0] }]), [{ extra: 'B', of: 'A' }]);
  // no rotation at all is no turn
  assert.deepEqual(stackedCopies([{ ...a, rot: undefined }, { ...b, rot: [0, 0, 0] }]), [{ extra: 'B', of: 'A' }]);
});

test('two of the map\'s own objects at one spot are as the game has them; things with no place are left out', () => {
  assert.deepEqual(stackedCopies([thing('A', 'Light', [0, 0, 0], { mine: false }), thing('B', 'Light', [0, 0, 0], { mine: false, rank: 0 })]), []);
  assert.deepEqual(stackedCopies([thing('A', 'Light', null), thing('B', 'Light', [0, 0, 0], { rank: 1 })]), []);
});

test('three at one spot: two extra ones, each of the first', () => {
  const found = stackedCopies([thing('C', 'Light', [0, 0, 0], { rank: 3 }), thing('A', 'Light', [0, 0, 0], { rank: 1 }),
    thing('B', 'Light', [0, 0.5, 0], { rank: 2 })]);
  assert.deepEqual(found, [{ extra: 'B', of: 'A' }, { extra: 'C', of: 'A' }]);
});

test('what falls when the map starts: decorations and things to pick up', () => {
  assert.deepEqual(FALLING, ['DeusExDecoration', 'Inventory']);
  assert.equal(fallsWhenLoaded(['Barrel1', 'Containers', 'DeusExDecoration', 'Decoration', 'Actor'], undefined, undefined), true);
  assert.equal(fallsWhenLoaded(['MedKit', 'DeusExPickup', 'Pickup', 'Inventory', 'Actor'], undefined, undefined), true);
  assert.equal(fallsWhenLoaded(['WeaponPistol', 'DeusExWeapon', 'Weapon', 'Inventory', 'Actor'], undefined, undefined), true);
  // lights, path nodes, triggers, characters: not
  assert.equal(fallsWhenLoaded(['Light', 'Actor'], undefined, undefined), false);
  assert.equal(fallsWhenLoaded(['PathNode', 'NavigationPoint', 'Actor'], undefined, undefined), false);
  assert.equal(fallsWhenLoaded(['JCDouble', 'HumanMilitary', 'ScriptedPawn', 'Pawn', 'Actor'], undefined, undefined), false);
  // a class the editor could not read (its chain is itself)
  assert.equal(fallsWhenLoaded(['SomeModThing'], undefined, undefined), false);
});

test('what hangs or sits on a wall by its class is left out, a mod\'s class under one of them too', () => {
  for (const chain of [['HangingChicken', 'HangingDecoration', 'RevDecoHook', 'DeusExDecoration'],
    ['Keypad1', 'Keypad', 'HackableDevices', 'ElectronicDevices', 'DeusExDecoration'],
    ['Lightbulb', 'RevDecoHook', 'DeusExDecoration'], ['Tree1', 'Trees', 'OutdoorThings', 'DeusExDecoration'],
    ['UCMeshDeco', 'DeusExDecoration'], ['MyLantern', 'HangingDecoration', 'DeusExDecoration']])
    assert.equal(fallsWhenLoaded(chain, undefined, undefined), false, chain[0]);
  assert.ok(STAYS_UP.includes('HangingDecoration') && !STAYS_UP.includes('DeusExDecoration') && !STAYS_UP.includes('Inventory'));
});

test('what is set on the object: Physics other than Falling, or no collision with the world, keeps it up on purpose', () => {
  const crate = ['CrateUnbreakableSmall', 'Containers', 'DeusExDecoration'];
  assert.equal(fallsWhenLoaded(crate, 'PHYS_None', undefined), false);          // Stick to surface sets it
  assert.equal(fallsWhenLoaded(crate, 'PHYS_Rotating', undefined), false);
  assert.equal(fallsWhenLoaded(crate, 'PHYS_Falling', undefined), true);
  assert.equal(fallsWhenLoaded(crate, '', undefined), true);                    // nothing set: its class's
  assert.equal(fallsWhenLoaded(crate, undefined, 'False'), false);
  assert.equal(fallsWhenLoaded(crate, undefined, 'false'), false);
  assert.equal(fallsWhenLoaded(crate, undefined, 'True'), true);
});

test('left in the air: more than 8 units over the surface under it', () => {
  assert.equal(AIR_GAP, 8);
  assert.equal(airGap(48, 0), 48);
  assert.equal(airGap(8.4, 0), 8.4);
  assert.equal(airGap(8, 0), 0);
  assert.equal(airGap(0.5, 0), 0);            // as Drop to floor leaves it
  assert.equal(airGap(-3, 0), 0);             // a little in the floor
  assert.equal(airGap(128.5, 128), 0);        // on a table (the ray meets its top)
});
