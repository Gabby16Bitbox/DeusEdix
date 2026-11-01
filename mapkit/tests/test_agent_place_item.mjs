// The AI assistant's place_object (static/agent.js OPS.place, run as it is on a stand-in editor) places a palette item
// the way the palette's own button does: app.js placingOf (its own code, read from app.js), given to agent.js by the
// editor's kit. Given as it is, a decoration whose item has a mesh (TrashCan1: {mesh: 'DeusExDeco.TrashCan1'}, no base)
// made placeWith read placing.base.r and throw (B6 in the game, 27 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../editor/static/agent.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const bodyIn = (text, name) => { const at = text.indexOf(`function ${name}(`); assert.ok(at >= 0, name); return text.slice(at, text.indexOf('\n}', at) + 2); };
const line = (start) => { const at = source.indexOf(start); assert.ok(at >= 0, start); return source.slice(at, source.indexOf('\n', at)); };
const ops = source.slice(source.indexOf('const OPS = {'), source.indexOf('\n};\n', source.indexOf('const OPS = {')) + 3);

// the Objects browser's items as editor/data.py gives them (numbers as text; a decoration with its mesh)
const TRASH = { cls: 'TrashCan1', name: 'Trash can', radius: '20', height: '24', sub: 'Trash', mesh: 'DeusExDeco.TrashCan1', scale: 1 };
const GUARD = { cls: 'UNATCOTroop', name: 'Guard', radius: '20', height: '47', preset: { Tag: 'Guard' }, mesh: 'DeusExCharacters.GM_Jumpsuit' };

function editor() {
  const calls = [], vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
  const ed = { mapName: '01_Lab', script: 'new_01_lab', playing: false, building: false, selected: null, proxies: { children: [] },
    structures: {}, edits: { added: [], boxes: [], drawn: [], deleted: {}, props: {}, moved: {} } };
  const c = vm.createContext({ window: { __editor: ed, __characters: { item: (id) => ({ cls: 'UCCustom', custom: id, radius: 20, height: 47 }) } },
    document: { getElementById: () => null }, THREE: { Vector3: function (x, y, z) { Object.assign(this, { x, y, z }); } } });
  vm.runInContext(bodyIn(app, 'placingOf') + '\nthis.placingOf = placingOf;', c);       // the palette's own, from app.js
  const kit = { T: (a) => vec(a[0], a[2], a[1]), UE: (v) => [v.x, v.z, v.y], YAW: 65536, placing: null,
    palette: () => [{ category: 'Decorations', items: [TRASH] }, { category: 'Characters', items: [GUARD] }],
    startPlacing(item) { calls.push(['start', item]); kit.placing = item; },
    cancelPlacing() { kit.placing = null; },
    // app.js placeWith: an item with a mesh is a model, its size from base (the browser's Models: placing.base.r)
    placeWith(r) {
      const placing = kit.placing;
      const radius = placing.mesh ? placing.base.r : placing.radius;
      const a = { name: placing.cls + '0', cls: placing.cls, loc: kit.UE(r.p), radius, props: { ...(placing.preset || {}) } };
      ed.edits.added.push(a);
      ed.selected = { userData: { actor: a }, position: r.p };
      calls.push(['placed', a.name]);
    },
    allActors: () => ed.edits.added, proxyOf: () => ed.selected, hierLabel: (a) => a.name, isCharacter: () => false,
    chainOf: () => null, structureOf: () => null, rebuildProxies() {}, select() {}, setDirty() {} };
  kit.placingOf = c.placingOf;
  ed.agentKit = kit;
  vm.runInContext([line('const E = () =>'), bodyIn(source, 'need'), line('const REBUILDING = '), bodyIn(source, 'needEditable'),
    line('const nameOf = '), bodyIn(source, 'paletteItem'), ops, 'this.OPS = OPS;'].join('\n'), c);
  return { OPS: c.OPS, calls, ed, placingOf: c.placingOf };
}

test('place_object gives startPlacing what the palette\'s own button gives (placingOf): a decoration with a mesh places', () => {
  const { OPS, calls, ed, placingOf } = editor();
  const placed = OPS.place({ cls: 'TrashCan1', at: [100, 200, 30], exact: true });
  const [, item] = calls.find(([kind]) => kind === 'start');
  assert.deepEqual(JSON.parse(JSON.stringify(item)), JSON.parse(JSON.stringify(placingOf(TRASH))));
  assert.deepEqual(JSON.parse(JSON.stringify(item)), { cls: 'TrashCan1', radius: 20, height: 24, preset: null, name: '' });
  assert.equal(placed.name, 'TrashCan10');
  assert.deepEqual(ed.edits.added.map((a) => [a.cls, a.loc, a.radius]), [['TrashCan1', [100, 200, 30], 20]]);
});

test('a character of the palette keeps its preset; a class the palette has not, its own small cylinder', () => {
  const { OPS, calls, ed } = editor();
  OPS.place({ cls: 'unatcotroop', at: [0, 0, 48], exact: true, yaw: 16384 });
  OPS.place({ cls: 'SomeMod.Gadget', at: [64, 0, 16], exact: true });
  const items = calls.filter(([kind]) => kind === 'start').map(([, it]) => JSON.parse(JSON.stringify(it)));
  assert.deepEqual(items[0], { cls: 'UNATCOTroop', radius: 20, height: 47, preset: { Tag: 'Guard' }, name: 'Guard' });
  assert.deepEqual(items[1], { cls: 'SomeMod.Gadget', name: 'SomeMod.Gadget', radius: 16, height: 16 });
  assert.equal(ed.edits.added[0].rot[1], 16384);
});

test('app.js gives agent.js the palette\'s placingOf in window.__editor.agentKit', () => {
  const kit = app.slice(app.indexOf('window.__editor.agentKit = {'), app.indexOf('};', app.indexOf('window.__editor.agentKit = {')));
  assert.match(kit, /\bplacingOf\b/);
});
