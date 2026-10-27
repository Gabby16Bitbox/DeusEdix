// The AI assistant's calls while a Rebuild runs (static/agent.js need, needEditable and OPS, run as they are, on a
// stand-in editor): the calls that change the map, save, build or open another are refused, saying so, with nothing
// done; the ones that read (state, find, object, select) go on, and editor_state says a build runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../editor/static/agent.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = (name) => { const at = source.indexOf(`function ${name}(`); assert.ok(at >= 0, name); return source.slice(at, source.indexOf('\n}', at) + 2); };
const line = (start) => { const at = source.indexOf(start); assert.ok(at >= 0, start); return source.slice(at, source.indexOf('\n', at)); };
const ops = source.slice(source.indexOf('const OPS = {'), source.indexOf('\n};\n', source.indexOf('const OPS = {')) + 3);

function editor({ building = true } = {}) {
  const calls = [], vec = (x = 0, y = 0, z = 0) => ({ x, y, z, copy(v) { Object.assign(this, { x: v.x, y: v.y, z: v.z }); } });
  const lamp = { userData: { actor: { name: 'Lamp1', cls: 'Lamp1', props: {} } }, position: vec(), rotation: { y: 0 }, scale: { setScalar() {} } };
  const kit = { allActors: () => [lamp.userData.actor], proxyOf: () => lamp, UE: (v) => [v.x, v.z, v.y], T: (a) => vec(a[0], a[2], a[1]),
    hierLabel: (a) => a.name, isCharacter: () => false, chainOf: () => null, structureOf: () => null, boxKind: () => 'solid',
    radToYaw: () => 0, yawToRad: () => 0, builtScale: () => 1, undoDepth: 0, redoDepth: 0, placing: null,
    pushUndo: (label) => calls.push(['step', label]), commit: () => calls.push('commit'), select: () => calls.push('select'), setMulti() {},
    focusSelected() {}, setProp: () => calls.push('setProp'), unsetProp() {}, rebuildProxies() {}, showDetails() {}, setDirty: () => calls.push('dirty'),
    deleteSelected: () => calls.push('delete'), undoStep: () => calls.push('undo'), redoStep: () => calls.push('redo'),
    save: async () => calls.push('save'), startPlacing: () => calls.push('place'), cancelPlacing() {}, mapList: () => [{ script: 'dx:02_Other', name: '02_Other' }],
    openMap: async () => calls.push('openMap'), palette: () => [] };
  const ed = { mapName: '01_Lab', script: 'dx:01_Lab', playing: false, building, dirty: false, viewMode: 'shaded', selected: null,
    proxies: { children: [lamp] }, structures: {}, edits: { added: [], boxes: [], drawn: [], deleted: {}, props: {}, moved: {} },
    camera: { position: vec() }, cam: { yaw: 0, pitch: 0 }, agentKit: kit, rebuild: async () => calls.push('rebuild') };
  const c = vm.createContext({ window: { __editor: ed }, document: { getElementById: () => null }, errors: [], DRAW_DEFAULTS: { wall: { height: 128 } },
    THREE: {}, r1: (v) => v, sleep: async () => {} });
  vm.runInContext([line('const E = () =>'), body('need'), line('const REBUILDING = '), body('needEditable'), line('const nameOf = '),
    body('proxyNamed'), body('proxyOrFail'), body('messages'), ops, 'this.OPS = OPS;'].join('\n'), c);
  return { OPS: c.OPS, calls, ed, lamp };
}

test('while a Rebuild runs, a call that changes the map is refused, saying so, and nothing is done', async () => {
  const { OPS, calls, lamp } = editor();
  const refused = /^A Rebuild is running: wait for it to end or cancel it\.$/;
  for (const [op, args] of [['move', { name: 'Lamp1', loc: [10, 20, 30] }], ['place', { cls: 'Lamp1', at: [0, 0, 0] }],
    ['set', { name: 'Lamp1', props: { Tag: 'x' } }], ['draw', { kind: 'wall', points: [[0, 0, 0], [64, 0, 0]] }],
    ['delete', { names: ['Lamp1'] }], ['undo', {}], ['redo', {}], ['save', {}], ['rebuild', {}], ['open_map', { script: 'dx:02_Other' }]])
    await assert.rejects(async () => OPS[op](args), (e) => refused.test(e.message), op);
  assert.deepEqual(calls, []);
  assert.deepEqual([lamp.position.x, lamp.position.y, lamp.position.z], [0, 0, 0], 'the 3D view does not show a move that was not made');
});

test('while a Rebuild runs, the calls that read go on; editor_state says a build runs', () => {
  const { OPS, calls } = editor();
  assert.equal(OPS.state().building, true);
  assert.equal(OPS.find({}).count, 1);
  assert.equal(OPS.object({ name: 'Lamp1' }).name, 'Lamp1');
  OPS.select({ names: ['Lamp1'] });
  assert.deepEqual(calls, ['select']);                   // selecting looks: the view is look-only, not shut
});

test('with no Rebuild the same calls work', async () => {
  const { OPS, calls, lamp } = editor({ building: false });
  assert.equal(OPS.state().building, false);
  OPS.move({ name: 'Lamp1', loc: [10, 20, 30] });
  assert.deepEqual(calls, [['step', 'Assistant: move Lamp1'], 'commit']);
  assert.equal(lamp.position.y, 30);
  await OPS.rebuild({});
  assert.ok(calls.includes('rebuild'));
});
