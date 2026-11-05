// Replace with... in the page (static/app.js, its section run as it is): an object of the map becomes an added object
// under its name that replaces it, an added one changes in place; one undo; what does not fit is asked first; Delete
// of a replacement takes the map's own object away too.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as replace from '../editor/static/replace-class.js';
import { baseOf } from '../editor/static/prop-sets.js';
import { unquote } from '../editor/static/prop-kinds.js';
import { namedStep } from '../editor/static/history-names.js';

const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('// ---------------------------------------------------------------- Replace with...'),
  source.indexOf('// ---------------------------------------------------------------- palette and placing'));
const body = (name) => { const start = source.indexOf(`function ${name}(`); assert.ok(start >= 0, name); return source.slice(start, source.indexOf('\n}', start) + 2); };
const copy = (x) => JSON.parse(JSON.stringify(x));
// the classes of the fixture: what each has, what the rules can do with it
const CLASSES = {
  UNATCOTroop: { props: ['Tag', 'Event', 'BindName', 'Orders', 'OrderTag', 'Health', 'Alliance', 'RaiseAlarm', 'MultiSkins', 'Mesh'],
    outputs: ['dies', 'near'], inputs: ['attack', 'hostile', 'goto'], character: true },
  Barrel1: { props: ['Tag', 'Event', 'HitPoints', 'bExplosive'], outputs: ['destroyed', 'near'], inputs: ['blow'], character: false },
};

function fixture() {
  const troop = { name: 'Troop1', cls: 'MJ12Troop', loc: [90, 200, 48], rot: [0, 16384, 0], radius: 20, height: 48, kind: 'pawn',
    props: { Tag: 'Guards', Event: 'Alarm', Orders: 'Patrolling', OrderTag: 'P1', 'MultiSkins(0)': "Texture'Old.Face'", bHateShot: 'True' } };
  const crate = { name: 'UCEdit3', cls: 'CrateUnbreakableSmall', loc: [0, 0, 16], rot: [0, 0, 0], radius: 16, height: 16, props: { Tag: 'Box' } };
  const door = { name: 'Door1', cls: 'DeusExMover', loc: [0, 0, 0], rot: [0, 0, 0], props: {} };
  const proxies = { children: [], remove(p) { this.children = this.children.filter((x) => x !== p); } };
  const proxy = (actor, source, kind, at) => { const p = { userData: { actor, source, kind }, scale: { x: 1 }, position: at, rot: actor.rot, parent: proxies }; proxies.children.push(p); return p; };
  const calls = [], history = [];
  const c = vm.createContext({
    edits: { added: [copy(crate)], deleted: {}, moved: { Troop1: { cls: 'MJ12Troop', loc: [100, 200, 48], rot: [0, 16384, 0], orig: [90, 200, 48] } },
      props: { Troop1: { Health: '80', bFoo: 'True' } }, rawprops: { Troop1: { RaiseAlarm: 'RA_Never', Weird: '1' } },
      retexture: [{ kind: 'actor', name: 'Troop1', slot: 0, tex: 'Old' }, { kind: 'actor', name: 'Other', slot: 0, tex: 'Keep' }],
      links: [{ id: 'L1', src: 'Troop1', when: 'dies', do: [{ verb: 'open', target: 'Door1' }] },
        { id: 'L2', src: 'Button1', when: 'used', do: [{ verb: 'attack', target: 'Troop1' }] }] },
    baseActors: [troop, door], structures: {}, actorStruct: {}, proxies, mapGeneration: 1, propertySlider: null, anim: null,
    selected: null, groupPivot: { userData: {} }, members: () => [], placing: null, answer: true, asked: [],
    ...replace, baseOf, unquote, isEffectPoint: (a) => a.cls === 'UCEffectPoint', window: {}, console,
    r1: (x) => Math.round(x * 10) / 10, UE: (v) => [v.x, v.y, v.z], builtOf: () => 1, objectRotation: (p) => p.rot,
    modelClassInfo: () => ({}), addedKind: (cls) => (cls === 'Light' ? 'light' : 'prop'), hierLabel: (a) => a.name, routeUsers: () => [],
    isCharacter: (a) => a.kind === 'pawn' || !!CLASSES[a.cls]?.character, hasOriginalConversations: () => false,
    chainNow: {}, propSchema: {}, chainOf: async () => [], fieldOf: () => null, lkList: () => c.edits.links,
    lkEventsOf: (a) => CLASSES[a.cls]?.outputs || [], lkInputsOf: (a) => CLASSES[a.cls]?.inputs || [],
    lkWhenKey: (l) => l.when, lkVerbKey: (x) => x.verb, lkSentence: (l) => `rule ${l.id}`,
    classProps: async (_, cls) => { if (!CLASSES[cls]) throw new Error('unknown'); return { props: CLASSES[cls].props.map((name) => ({ name })) }; },
    behaveApi: {}, palette: [], itemLabel: (it) => it.cls, animIsMover: (p) => /Mover/.test(p.userData.actor.cls), requireUnlocked: () => true,
    status: (t) => calls.push(['status', t]), log: (t, k) => calls.push(['log', t, k]), confirm: (t) => { c.asked.push(t); return c.answer; },
    pushUndo: () => history.push(copy(c.edits)), setDirty: () => calls.push('dirty'), rebuildProxies: () => calls.push('rebuild'),
    showDetails: () => {}, closeAnim: () => {}, lightProps: () => ({}), poseOf: () => ({}), poseToPose: () => (v) => v,
    proxyOf: (name) => ({ name }), warnHiddenKinds: (list, done) => { c.warned = [list, done]; },
    namedStep, objectLabel: (p) => [p.userData.actor.name, ''],
  });
  vm.runInContext(section + '\n' + ['actorProp', 'ownProps', 'itemProps', 'removeOne', 'dropActorTextures', 'stepOf'].map(body).join('\n'), c);
  const troopP = proxy(troop, 'map', 'pawn', { x: 100, y: 200, z: 48 });
  const crateP = proxy(Object.assign({ kind: 'prop' }, c.edits.added[0]), 'added', 'prop', { x: 0, y: 0, z: 16 });
  const doorP = proxy(door, 'map', 'mover', { x: 0, y: 0, z: 0 });
  return { c, troopP, crateP, doorP, calls, history };
}

test('an object of the map becomes an added one under its name that replaces it, one undo', async () => {
  const { c, troopP, history } = fixture(), before = copy(c.edits);
  assert.equal(await c.replaceWith({ cls: 'UNATCOTroop', radius: 22, height: 50 }, [troopP]), true);
  assert.equal(history.length, 1);
  assert.deepEqual(copy(history[0]), before);
  const e = c.edits.added.find((x) => x.name === 'Troop1');
  assert.equal(e.cls, 'UNATCOTroop');
  assert.deepEqual(copy(e.replaces), { cls: 'MJ12Troop', orig: [90, 200, 48] });          // as Delete would have kept it
  assert.deepEqual(copy(e.loc), [100, 200, 50]);                                           // where it was moved, on its feet
  assert.deepEqual(copy(e.rot), [0, 16384, 0]);
  assert.deepEqual(copy([e.radius, e.height]), [22, 50]);
  // its Tag, Event, orders, route and the properties the new class has; not its look nor what the class lacks
  assert.deepEqual(copy(e.props), { Tag: 'Guards', Event: 'Alarm', Orders: 'Patrolling', OrderTag: 'P1', Health: '80' });
  assert.equal(c.edits.deleted.Troop1, undefined);
  assert.equal(c.edits.moved.Troop1, undefined);
  assert.equal(c.edits.props.Troop1, undefined);
  assert.deepEqual(copy(c.edits.rawprops.Troop1), { RaiseAlarm: 'RA_Never' });
  assert.deepEqual(copy(c.edits.retexture), [{ kind: 'actor', name: 'Other', slot: 0, tex: 'Keep' }]);     // its old look's go
  assert.deepEqual(copy(c.edits.links), before.links);                                      // its rules still name it
  assert.match(c.asked[0], /Not carried over \(UNATCOTroop has no such property\):\n {2}Troop1: bHateShot, bFoo, Weird/);
  assert.deepEqual(copy(c.warned), [[{ name: 'Troop1' }], 'Replaced']);           // of a kind the Show menu hides: said
});

test('an added object changes in place, nothing replaced; the same class is left alone', async () => {
  const { c, crateP, history } = fixture();
  assert.equal(await c.replaceWith({ cls: 'Barrel1', radius: 20, height: 24 }, [crateP]), true);
  assert.equal(c.edits.added[0].name, 'UCEdit3');
  assert.equal(c.edits.added[0].cls, 'Barrel1');
  assert.equal(c.edits.added[0].replaces, undefined);
  assert.deepEqual(copy(c.edits.added[0].loc), [0, 0, 24]);
  assert.equal(c.asked.length, 0);                                                    // nothing lost, nothing to ask
  crateP.userData.actor = Object.assign({ kind: 'prop' }, c.edits.added[0]);
  assert.equal(await c.replaceWith({ cls: 'Barrel1', radius: 20, height: 24 }, [crateP]), false);
  assert.equal(history.length, 1);
});

test('what no longer fits is asked first; Cancel changes nothing', async () => {
  const { c, troopP, history } = fixture(), before = copy(c.edits);
  c.answer = false;
  assert.equal(await c.replaceWith({ cls: 'Barrel1', radius: 20, height: 24 }, [troopP]), false);
  assert.deepEqual(copy(c.edits), before);
  assert.equal(history.length, 0);
  assert.equal(c.warned, undefined);
  assert.match(c.asked[0], /No longer fits[^\n]*\n {2}Troop1: Interaction "rule L1": it never does that\n {2}Troop1: Interaction "rule L2": it cannot do that/);
});

test('doors keep their kind; a piece or a block replaces nothing', async () => {
  const { c, doorP, troopP, history } = fixture();
  assert.equal(await c.replaceWith({ cls: 'Barrel1', radius: 20, height: 24 }, [doorP]), false);
  assert.equal(await c.replaceWith({ prefab: { id: 'x' }, radius: 4, height: 0 }, [troopP]), false);
  assert.equal(await c.replaceWith({ box: true, size: [1, 1, 1] }, [troopP]), false);
  assert.equal(history.length, 0);
});

test('a light keeps its middle and its own colour; the new light only fills in', async () => {
  const { c, crateP } = fixture();
  const lamp = { name: 'Lamp1', cls: 'Light', loc: [0, 0, 300], rot: [0, 0, 0], radius: 8, height: 16, kind: 'light',
    light: { b: 150, hue: 0, sat: 255, radius: 32 }, props: { Tag: 'Lamp' } };
  c.baseActors.push(lamp);
  const p = { userData: { actor: lamp, source: 'map', kind: 'light' }, scale: { x: 1 }, position: { x: 0, y: 0, z: 300 }, rot: [0, 0, 0], parent: c.proxies };
  c.proxies.children.push(p);
  c.lightProps = (a) => { const l = a.light || { b: 128, hue: 32, sat: 160, radius: 12 }; return { LightBrightness: l.b, LightHue: l.hue, LightSaturation: l.sat, LightRadius: l.radius }; };
  crateP.userData.actor.cls = 'TrafficLight';                               // a lamp whose class ends in Light: no light of its own
  assert.deepEqual(copy(c.ownProps(crateP)), { Tag: 'Box' });
  assert.deepEqual(copy(c.ownProps(p)), { LightBrightness: 150, LightHue: 0, LightSaturation: 255, LightRadius: 32, Tag: 'Lamp' });
  c.classProps = async () => ({ props: ['Tag', 'LightBrightness', 'LightHue', 'LightSaturation', 'LightRadius', 'LightEffect', 'LightCone'].map((name) => ({ name })) });
  assert.equal(await c.replaceWith({ cls: 'Spotlight', radius: 8, height: 8 }, [p]), true);
  const e = c.edits.added.find((x) => x.name === 'Lamp1');
  assert.deepEqual(copy(e.loc), [0, 0, 300]);
  assert.deepEqual(copy(e.props), { LightBrightness: 150, LightHue: 0, LightSaturation: 255, LightRadius: 32, LightEffect: 'LE_Spotlight', LightCone: 64, Tag: 'Lamp' });
});

test('Delete of a replacement takes the map object it replaced away too', async () => {
  const { c, troopP } = fixture();
  await c.replaceWith({ cls: 'UNATCOTroop', radius: 22, height: 50 }, [troopP]);
  const e = c.edits.added.find((x) => x.name === 'Troop1');
  const p = { userData: { actor: Object.assign({ kind: 'pawn' }, e), source: 'added', kind: 'pawn' } };
  c.proxies.children.push(p);
  c.removeOne(p);
  assert.equal(c.edits.added.some((x) => x.name === 'Troop1'), false);
  assert.deepEqual(copy(c.edits.deleted.Troop1), { cls: 'MJ12Troop', orig: [90, 200, 48] });
});
