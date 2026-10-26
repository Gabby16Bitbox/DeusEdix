// The plain fields of the Inspector's Properties (static/prop-kinds.js): what each kind shows of UnrealEd's text and
// the text it stores, the same for one object (renderProps) and several (the multi-object Inspector).
import test from 'node:test';
import assert from 'node:assert/strict';
import { unquote, classRef, propShown, propText, propRow } from '../editor/static/prop-kinds.js';

test('UnrealEd\'s quoted strings and class references', () => {
  assert.equal(unquote('"Hello"'), 'Hello');
  assert.equal(unquote('Hello'), 'Hello');
  assert.equal(unquote('"'), '"');
  assert.equal(unquote(undefined), '');
  assert.equal(classRef("Class'DeusEx.Medkit'"), 'DeusEx.Medkit');
  assert.equal(classRef('None'), '');
});

test('booleans, whole numbers, floats and bytes', () => {
  assert.equal(propShown('bool', 'True'), true);
  assert.equal(propShown('bool', 'false'), false);
  assert.equal(propText('bool', true), 'True');
  assert.equal(propText('bool', false), 'False');
  assert.equal(propShown('int', '12'), 12);
  assert.equal(propShown('int', ''), 0);
  assert.equal(propText('int', '12.6'), '13');
  assert.equal(propText('float', 0.5), '0.500000');
  assert.equal(propText('float', 'x'), '0.000000');
  assert.equal(propText('byte', 300), '255');
  assert.equal(propText('byte', -4), '0');
  assert.equal(propText('lightcolor', 31.6), '32');
});

test('names, strings, factions and items', () => {
  assert.equal(propShown('name', 'None'), '');
  assert.equal(propShown('name', 'Door3'), 'Door3');
  assert.equal(propText('name', ' my door '), 'my_door');
  assert.equal(propText('name', ''), 'None');
  assert.equal(propShown('string', '"1234"'), '1234');
  assert.equal(propText('string', ' 1234 '), '1234');
  assert.equal(propShown('faction', 'None'), '');
  assert.equal(propText('faction', 'Mj 12'), 'Mj_12');
  assert.equal(propShown('item', "Class'DeusEx.Medkit'"), 'DeusEx.Medkit');
  assert.equal(propText('item', 'DeusEx.Medkit'), "Class'DeusEx.Medkit'");
  assert.equal(propText('item', ''), 'None');
  assert.equal(propShown('choice', 'Standing'), 'Standing');
  assert.equal(propText('enum', 'LT_Pulse'), 'LT_Pulse');
});

test('a collision box: its half size shown whole, never under 2 shown units; a radius as it is', () => {
  assert.equal(propShown('half', '32.000000'), 64);
  assert.equal(propText('half', 64), '32.000000');
  assert.equal(propText('half', 1), '2.000000');
  assert.equal(propText('half', ''), '2.000000');
  assert.equal(propShown('radius', '40'), 40);
  assert.equal(propText('radius', 'x'), '2.000000');
});

test('which kinds several objects edit, with their steps; the others one object at a time', () => {
  assert.deepEqual(propRow('byte'), { row: 'int', step: 1, min: 0, max: 255 });
  assert.deepEqual(propRow('float'), { row: 'number', step: 0.05, min: undefined, max: undefined });
  assert.deepEqual(propRow('half'), { row: 'number', step: 8, min: 4, max: undefined });
  assert.equal(propRow('bool').row, 'bool');
  assert.equal(propRow('enum').row, 'choice');
  assert.equal(propRow('item').row, 'choice');
  assert.equal(propRow('faction').row, 'text');
  for (const kind of ['users', 'options', 'emails', 'sound', 'relations', 'inventory', 'mapurl', 'hidden', undefined]) assert.equal(propRow(kind), null);
});
