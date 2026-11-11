// An object added in the editor whose name the engine already knows in another letter case comes back from the build
// under the engine's spelling (21_Logic_Counter: the added Counter "C2" is "c2" in the built map and in the game's log).
// Unreal names ignore letter case, so the editor takes the built copy for the added object: one row in the Hierarchy,
// one actor for the Logic window (the edit's, with its StateName), the game's "c2" finds it, new names never clash.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(process.env.DEUSEDIX_TEST_APP || new URL('../editor/static/app.js', import.meta.url), 'utf8');
function body(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const clone = (v) => JSON.parse(JSON.stringify(v));

function fixture() {
  const counter = { name: 'C2', cls: 'UCBCounter', loc: [0, 0, 64], rot: [0, 0, 0], props: { StateName: '"Score"', Goal: '2' } };
  const kills = { name: 'Kills', cls: 'UCBCounter', loc: [64, 0, 64], rot: [0, 0, 0], props: { Goal: '3' } };
  const node = { name: 'PathNode5', cls: 'PathNode', loc: [128, 0, 40], rot: [0, 0, 0], props: {} };
  // the built map: the engine's spellings ("c2", "pathnode5"), "Kills" as it was, and an object of the map's own
  const built = [
    { name: 'c2', cls: 'UCBCounter', loc: [0, 0, 64], rot: [0, 0, 0], kind: 'logic' },
    { name: 'Kills', cls: 'UCBCounter', loc: [64, 0, 64], rot: [0, 0, 0], kind: 'logic' },
    { name: 'pathnode5', cls: 'PathNode', loc: [128, 0, 40], rot: [0, 0, 0], kind: 'path' },
    { name: 'Lamp7', cls: 'Light', loc: [0, 64, 96], rot: [0, 0, 0], kind: 'light' },
  ];
  const proxies = { children: [], clear() { this.children = []; } };
  const c = vm.createContext({
    edits: { added: [counter, kills, node], deleted: {}, moved: {}, props: {}, boxes: [], drawn: [], prefabs: [] },
    baseActors: built, proxies, structures: {}, actorStruct: {}, selected: null, groupPivot: {},
    textureTransfer: null, surfaceTexturePreview: null, skyTool: { syncViewport() {} }, tc: { detach() {} }, syncStructures() {}, disposeEffectPoint() {},
    disposeParticleGizmo() {}, disposeViewportIcons() {},
    makeProxy(a, src) { const p = { userData: { actor: a, source: src, kind: a.kind } }; proxies.children.push(p); return p; },
    makeBoxProxy() {}, addedKind: () => 'logic', drawTools: { proxy() {} }, applyTextureOverrides() {}, applyLighting() {},
    applyObjectVisibility() {}, select() {}, selectKeys() {}, selectNest() {}, showChanges() {}, buildStructList() {}, buildHierarchy() {},
    viewState: () => ({ hidden: [], locked: [] }),
    pathData: { points: { pathnode5: [0, 128, 0, 40] } }, pathGroups: () => [], T: (v) => v,
    NAV_CLASSES: /^(PathNode|PatrolPoint|WanderPoint|HidePoint|AmbushPoint|GuardPoint)$/,
  });
  vm.runInContext(['rebuildProxies', 'allActors', 'proxyOf', 'nextName', 'navNodes'].map(body).join('\n'), c);
  c.rebuildProxies();
  const rows = () => proxies.children.map((p) => `${p.userData.source}:${p.userData.actor.name}`);
  return { c, rows };
}

test('the built copy of an added object spelt in another case is not shown again (one Hierarchy row)', () => {
  const { rows } = fixture();
  assert.deepEqual(rows().sort(), ['added:C2', 'added:Kills', 'added:PathNode5', 'map:Lamp7']);
});

test('allActors has the object once, as the edit has it (the Logic window reads its StateName)', () => {
  const { c } = fixture();
  const counters = c.allActors().filter((a) => a.cls === 'UCBCounter');
  assert.deepEqual(counters.map((a) => a.name).sort(), ['C2', 'Kills']);
  assert.equal(counters.find((a) => a.name === 'C2').props.StateName, '"Score"');
});

test('a name the game writes ("c2" in its log) finds the object; the exact spelling comes first', () => {
  const { c, rows } = fixture();
  assert.equal(c.proxyOf('c2').userData.actor.name, 'C2');
  assert.equal(c.proxyOf('C2').userData.actor.name, 'C2');
  assert.equal(c.proxyOf('LAMP7').userData.actor.name, 'Lamp7');
  assert.equal(c.proxyOf('Nobody'), undefined);
  assert.equal(c.proxyOf(undefined), undefined);
  // two objects that differ only by case (an unbuilt one beside the map's, before a build): each finds its own
  c.proxies.children.push({ userData: { actor: { name: 'lamp7', cls: 'Light' }, source: 'added' } });
  assert.equal(c.proxyOf('lamp7').userData.source, 'added');
  assert.equal(c.proxyOf('Lamp7').userData.source, 'map');
  assert.ok(rows().length);
});

test('a new name is never one Unreal would take for a name already used in another case', () => {
  const { c } = fixture();
  c.baseActors.push({ name: 'ucedit0', cls: 'Light' });
  c.edits.added.push({ name: 'UCEDIT1', cls: 'Light', props: {} });
  c.edits.props.UcEdit2 = { LightHue: 4 };
  assert.equal(c.nextName('UCEdit'), 'UCEdit3');
  assert.equal(c.nextName('c'), 'c0');
  assert.equal(c.nextName('C'), 'C0');
  c.edits.added.push({ name: 'C0', cls: 'Light', props: {} });
  assert.equal(c.nextName('c'), 'c1');
});

test('a path node added here and built under another case is one AI path node', () => {
  const { c } = fixture();
  assert.deepEqual(clone(c.navNodes()).map((n) => n.name), ['pathnode5']);
  c.edits.added.push({ name: 'PathNode9', cls: 'PathNode', loc: [256, 0, 40], props: {} });   // not built yet
  assert.deepEqual(clone(c.navNodes()).map((n) => n.name), ['pathnode5', 'PathNode9']);
});
