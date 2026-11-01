import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { numberField } from '../editor/static/number-expr.js';

const source = readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function num('), source.indexOf('// Keep the fields and the preview alive'));
const context = vm.createContext({ numberField });
vm.runInContext(functions, context);
const html = vm.runInContext('positionRows([100, 200, 300])', context);
const rows = [...html.matchAll(/<label[^>]*for="([^"]+)"[^>]*>([XYZ])<\/label><input[^>]*value="([^"]+)"/g)];
const fields = Object.fromEntries(rows.map((r) => [r[2], { id: r[1], value: +r[3] }]));
const vector = class { constructor(x, y, z) { Object.assign(this, {x,y,z}); } };
context.THREE = { Vector3: vector }; context.r1 = (v) => v;
vm.runInContext(source.match(/const T = .*?;/)[0] + source.match(/const UE = .*?;/)[0], context);

test('Inspector displays X Y Z with Y height and original map positions intact', () => {
  assert.deepEqual(rows.map((r) => r[2]), ['X','Y','Z']);
  assert.deepEqual(fields, {X:{id:'px',value:100},Y:{id:'pz',value:300},Z:{id:'py',value:200}});
  assert.match(html, /Y position \(height\)/);
});

test('typing Y raises a character or structure and round-trips to native Z', () => {
  const values = {px:100,py:200,pz:300}; values[fields.Y.id] += 25;
  context.$ = (selector) => ({value:values[selector.slice(1)]});
  let position;
  context.p = {position:{copy(v){ position = v; }}};
  const statements = source.match(/p\.position\.copy\(T\(\[\+\$\('#px'\)\.value,.*?;/g);
  assert.equal(statements.length, 2, 'both structure and actor paths');
  for (const statement of statements) {
    vm.runInContext(statement, context);
    assert.deepEqual({...position}, {x:100,y:325,z:200});
    context.position = position;
    assert.deepEqual(Array.from(vm.runInContext('UE(position)',context)), [100,200,325]);
  }
});

test('scrubbing each visible axis agrees with the viewport gizmo', () => {
  const mapping = vm.runInContext('(' + source.match(/axis: (\{ px:.*?\})\[id\]/)[1] + ')', context);
  for (const axis of ['X','Y','Z']) assert.equal(mapping[fields[axis].id], axis.toLowerCase());
});

test('block Y edits change native height without changing depth or extents', () => {
  const values = {px:100,py:200,pz:325,sx:32,sy:64,sz:96};
  context.$ = (selector) => ({value:values[selector.slice(1)]});
  context.d = {box:{}};
  // the block's turn (pitch, yaw, roll) is applied to its preview too
  Object.assign(context, {YAW: 65536, p: {quaternion: {copy() {}}}, rotations: {quat: () => ({})}});
  const start = source.indexOf("const b = d.box, cx = +$('#px').value");
  vm.runInContext(source.slice(start,source.indexOf("b.tex =",start)),context);
  assert.deepEqual(Array.from(context.d.box.lo),[84,168,277]);
  assert.deepEqual(Array.from(context.d.box.hi),[116,232,373]);
});

test('structure scale fields follow the same visible XYZ order', () => {
  const line = source.split('\n').find((l) => l.includes('<label>Scale %</label>') && l.includes("num('ssx'"));
  assert.deepEqual([...line.matchAll(/num\('(ss.)'/g)].map((m)=>m[1]), ['ssx','ssz','ssy']);
  assert.match(line, /Y scale % \(height\)/);
});
