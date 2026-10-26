// Maths in the Inspector's number fields (static/number-expr.js): sums, the field's own value (+=, -=, *=, /=),
// L and R over several objects, mistakes that stay mistakes, and the steps of a dragged label.
import test from 'node:test';
import assert from 'node:assert/strict';
import { numberField, plainNumber, evaluate, evaluateAll, fieldText, stepped, steppedBy } from '../editor/static/number-expr.js';

const value = (text, options) => evaluate(text, options).value;
const error = (text, options) => evaluate(text, options).error;

test('sums: the four operations, brackets, powers and the order of operations', () => {
  assert.equal(value('2+3'), 5);
  assert.equal(value('10/4'), 2.5);
  assert.equal(value('2+3*4'), 14);
  assert.equal(value('(2+3)*4'), 20);
  assert.equal(value(' 7 % 4 '), 3);
  assert.equal(value('2^3^2'), 512);                       // powers from the right
  assert.equal(value('-2^2'), -4);
  assert.equal(value('2^-1'), 0.5);
  assert.equal(value('--3'), 3);
  assert.equal(value('128*1.5e1'), 1920);
  assert.equal(value('8-2-1'), 5);                         // the others from the left
  assert.equal(value('16/4/2'), 2);
});

test('constants and functions, in any case, radians as Unity has them', () => {
  assert.equal(value('pi'), Math.PI);
  assert.equal(value('PI/2'), Math.PI / 2);
  assert.equal(value('sqrt(16)+1'), 5);
  assert.ok(Math.abs(value('sin(pi/2)') - 1) < 1e-12);
  assert.ok(Math.abs(value('cos(pi)') + 1) < 1e-12);
  assert.equal(value('Sqrt(2)^2').toFixed(9), '2.000000000');
  assert.equal(value('floor(2.7)+ceil(2.2)+round(2.5)'), 8);
  assert.equal(value('tan(0)'), 0);
});

test('a plain number is itself, a comma is a decimal point when typed alone', () => {
  assert.equal(value('42'), 42);
  assert.equal(value('-0.5'), -0.5);
  assert.equal(value('2,5'), 2.5);
  assert.equal(plainNumber(' 1.25 '), 1.25);
  assert.equal(plainNumber('.5'), 0.5);
  assert.ok(Number.isNaN(plainNumber('2+3')));
  assert.ok(Number.isNaN(plainNumber('(X=1,Y=2,Z=3)')));    // UnrealEd's text is not a number
  assert.ok(Number.isNaN(plainNumber('')));
});

test("+=, -=, *= and /= work on the field's own value, with a sum after them", () => {
  assert.equal(value('+=16', { current: 100 }), 116);
  assert.equal(value('-= 8', { current: 100 }), 92);
  assert.equal(value('*=0.8', { current: 300 }), 240);
  assert.equal(value('/=4', { current: 10 }), 2.5);
  assert.equal(value('+=2*8', { current: 0 }), 16);
  assert.match(error('+=16'), /no number to \+= on/);      // an empty field: nothing to add to
});

test('mistakes are errors, never a number made up, and nothing is run', () => {
  assert.match(error('2+'), /missing/);
  assert.match(error('(2+3'), /"\)" is missing/);
  assert.match(error('2 3'), /out of place/);
  assert.match(error('2pi'), /"pi" is out of place/);
  assert.match(error('foo(2)'), /"foo" is unknown/);
  assert.match(error('sqrt(1,2)'), /sqrt\(\) takes 1 number/);
  assert.match(error('1/0'), /not a number/);
  assert.match(error('sqrt(-1)'), /not a number/);
  assert.match(error('alert(1)'), /unknown/);
  assert.match(error('2;3'), /";" is not maths/);
  assert.match(error('(X=1,Y=2,Z=3)'), /unknown|not maths/);
  assert.match(error('1+'.repeat(150) + '1'), /too long/);
  assert.match(error('   '), /nothing/);
});

test('L and R are refused where one object is edited', () => {
  assert.match(error('L(0,10)'), /L\(\) works when several objects are edited together/);
  assert.match(error('r(0,65535)'), /r\(\) works when several/);
});

test('L spreads evenly in order, R at random between its ends, sums around them', () => {
  assert.deepEqual(evaluateAll('L(0,10)', [7, 7, 7]).values, [0, 5, 10]);
  assert.deepEqual(evaluateAll('L(4,9)', [1]).values, [4]);                 // alone: the first end
  assert.deepEqual(evaluateAll('+=L(0,32)', [100, 200, 300]).values, [100, 216, 332]);
  const rolls = [0, 0.5, 0.75];
  assert.deepEqual(evaluateAll('R(10,20)', [0, 0, 0], () => rolls.shift()).values, [10, 15, 17.5]);
  // Unity's example, objects round a circle of radius 5 (X of five, the last back where the first is)
  const xs = evaluateAll('cos(L(0,2*pi))*5', Array(5).fill(0)).values.map((x) => Math.round(x * 1e9) / 1e9 + 0);   // + 0: no -0
  assert.deepEqual(xs, [5, 0, -5, 0, 5]);
  assert.match(evaluateAll('+=1', [1, NaN]).error, /no number/);
  assert.match(evaluateAll('L(0)', [1, 2]).error, /takes 2 numbers/);
});

test('the text a field shows: whole numbers in an int field, no float noise, never -0', () => {
  assert.equal(fieldText(0.1 + 0.2), '0.3');
  assert.equal(fieldText(2.5, true), '3');
  assert.equal(fieldText(-0.0000001), '0');
  assert.equal(fieldText(-0.4, true), '0');
  assert.equal(fieldText(65535), '65535');
});

test('a dragged label or an arrow key: whole steps inside min and max, as many decimals as the step', () => {
  assert.equal(stepped(0.1, 2, { step: 0.05 }), '0.2');
  assert.equal(stepped(10, -3, { step: 4, min: '0' }), '0');
  assert.equal(stepped(250, 3, { step: 1, min: '0', max: '255' }), '253');
  assert.equal(stepped(254, 3, { step: 1, min: '0', max: '255' }), '255');
  assert.equal(stepped(5, 1, { step: 1, min: '', max: '' }), '6');
  assert.equal(stepped(-950, 1, { step: 50 }), '-900');
});

test('a label dragged on a field of objects whose values differ: the steps as a sum on each one\'s own value', () => {
  assert.equal(steppedBy(2, { step: 4 }), '+=8');
  assert.equal(steppedBy(-3, { step: 0.25 }), '-=0.75');
  assert.equal(steppedBy(5), '+=5');
  assert.equal(steppedBy(0, { step: 4 }), '');
  assert.equal(steppedBy(-0), '');                         // Math.round(-0.4): no step, never "-=0"
  // what the field's change gives each object: its own value moved, not one value for all
  assert.deepEqual(evaluateAll(steppedBy(2, { step: 4 }), [-768, 0, 1576]).values, [-760, 8, 1584]);
  assert.deepEqual(evaluateAll(steppedBy(-1, { step: 0.05 }), [1, 0.5]).values.map((v) => +fieldText(v)), [0.95, 0.45]);
});

test('the field attributes: a text field the Inspector knows, "int" for whole numbers', () => {
  assert.match(numberField(), /^type="text" data-expr autocomplete="off" spellcheck="false"$/);
  assert.match(numberField(true), /data-expr="int"/);
});
