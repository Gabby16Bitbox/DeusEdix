// Maths in the Inspector's number fields, as Unity's (InspectorNumericFields): 2+3, 10/4, 2^3, pi, sqrt(2),
// sin, cos, tan, floor, ceil, round and brackets; "+=16", "-=8", "*=2" and "/=4" work on the field's own value;
// L(a,b) and R(a,b) give each of several objects edited together a value of its own: spread evenly from a to b
// in their order, or at random between a and b. A small parser of its own, never eval: what is typed becomes a
// number or an error, nothing in it runs. No page here: app.js wires the Inspector's fields (numberField).

// The attributes of such a field: a text field (a number field refuses "2+3"), "int" when it holds whole numbers.
export const numberField = (int = false) => `type="text" data-expr${int ? '="int"' : ''} autocomplete="off" spellcheck="false"`;

const LONGEST = 200;                     // characters: a sum, not a program
const CONSTANTS = { pi: Math.PI };
// the angles are radians, as Unity's: pi is half a turn
const FUNCTIONS = {
  sqrt: { args: 1, run: Math.sqrt }, sin: { args: 1, run: Math.sin }, cos: { args: 1, run: Math.cos }, tan: { args: 1, run: Math.tan },
  floor: { args: 1, run: Math.floor }, ceil: { args: 1, run: Math.ceil }, round: { args: 1, run: Math.round },
  // over several objects (spread: {index, count, random}): the first gets a, the last b, the others evenly between
  l: { args: 2, spread: (a, b, s) => (s.count > 1 ? a + (b - a) * s.index / (s.count - 1) : a) },
  r: { args: 2, spread: (a, b, s) => a + (b - a) * s.random() },
};
const OPS = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '%': (a, b) => a % b };
const LEVELS = [['+', '-'], ['*', '/', '%']];             // the binary operators, the loosest first
const RELATIVE = /^([-+*/])=(.*)$/s;                     // "+=16": the field's own value, then the operator
const PLAIN = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i;
const TOKEN = /\s*(?:((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)|([a-z_]\w*)|(\S))/iy;

class SumError extends Error {}

// A number as typed, nothing else ("2,5" is 2.5 too, as an Italian keyboard writes it); NaN otherwise.
export function plainNumber(text) {
  const t = String(text ?? '').trim();
  return PLAIN.test(t) ? Number(t.replace(',', '.')) : NaN;
}

function tokens(text) {
  const out = [];
  TOKEN.lastIndex = 0;
  for (let m; TOKEN.lastIndex < text.length && (m = TOKEN.exec(text));) {
    if (m[1]) out.push({ num: Number(m[1]) });
    else if (m[2]) out.push({ name: m[2].toLowerCase(), text: m[2] });
    else if (m[3] && '+-*/%^(),'.includes(m[3])) out.push({ op: m[3] });
    else if (m[3]) throw new SumError(`"${m[3]}" is not maths`);
  }
  return out;
}

// expression := level 0; a level: the next one, joined by its operators; unary := (+|-) unary | power;
// power := primary (^ unary)?, so -2^2 is -4 and 2^-1 is 0.5; primary := number, constant, function(...), (expression)
function calc(text, spread) {
  const list = tokens(text);
  let at = 0;
  const isOp = (op) => list[at]?.op === op;
  const expect = (op) => { if (!isOp(op)) throw new SumError(list[at] ? `"${op}" expected` : `a "${op}" is missing`); at++; };
  const level = (i) => {
    if (i === LEVELS.length) return unary();
    let v = level(i + 1);
    while (list[at] && LEVELS[i].includes(list[at].op)) v = OPS[list[at++].op](v, level(i + 1));
    return v;
  };
  const unary = () => {
    if (isOp('-')) { at++; return -unary(); }
    if (isOp('+')) { at++; return unary(); }
    const base = primary();
    if (!isOp('^')) return base;
    at++;
    return base ** unary();
  };
  const call = (name, text) => {
    const f = FUNCTIONS[name];
    expect('(');
    const args = [level(0)];
    while (isOp(',')) { at++; args.push(level(0)); }
    expect(')');
    if (args.length !== f.args) throw new SumError(`${text}() takes ${f.args} number${f.args === 1 ? '' : 's'}`);
    if (!f.spread) return f.run(...args);
    if (!spread) throw new SumError(`${text}() works when several objects are edited together`);
    return f.spread(...args, spread);
  };
  const primary = () => {
    const t = list[at++];
    if (!t) throw new SumError('a number is missing');
    if ('num' in t) return t.num;
    if (t.op === '(') { const v = level(0); expect(')'); return v; }
    if (t.name && t.name in FUNCTIONS) return call(t.name, t.text);
    if (t.name && t.name in CONSTANTS) return CONSTANTS[t.name];
    throw new SumError(t.name ? `"${t.text}" is unknown` : `"${t.op}" is out of place`);
  };
  const v = level(0);
  if (at < list.length) throw new SumError(`"${list[at].text ?? list[at].op ?? list[at].num}" is out of place`);
  return v;
}

// What is typed in a field: {value} or {error}. current: the field's own value (for +=, -=, *=, /=);
// spread: {index, count, random} when several objects are edited together (L and R), else they are refused.
export function evaluate(text, { current = NaN, spread = null } = {}) {
  const t = String(text ?? '').trim();
  if (!t) return { error: 'nothing is typed' };
  if (t.length > LONGEST) return { error: 'too long' };
  const plain = plainNumber(t);
  if (Number.isFinite(plain)) return { value: plain };
  const rel = RELATIVE.exec(t);
  if (rel && !Number.isFinite(current)) return { error: `the field has no number to ${rel[1]}= on` };
  try {
    const v = calc(rel ? rel[2] : t, spread);
    const value = rel ? OPS[rel[1]](current, v) : v;
    return Number.isFinite(value) ? { value } : { error: 'the result is not a number (a division by 0?)' };
  } catch (e) {
    if (e instanceof SumError) return { error: e.message };
    throw e;
  }
}

// The same text for each of several objects (their own values in their order, as L counts them): {values} or {error}.
export function evaluateAll(text, currents, random = Math.random) {
  const values = [];
  for (const [index, current] of currents.entries()) {
    const r = evaluate(text, { current, spread: { index, count: currents.length, random } });
    if (r.error) return r;
    values.push(r.value);
  }
  return { values };
}

// The text a field shows for a value: whole for an "int" field, else without the noise of float sums (0.1+0.2).
export function fieldText(value, int = false) {
  const v = int ? Math.round(value) : +value.toFixed(6);
  return String(v === 0 ? 0 : v);                         // never "-0"
}

// A value moved by whole steps (dragging a label, the arrow keys): inside min and max (empty: no limit),
// shown with as many decimals as the step has.
export function stepped(start, steps, { step = 1, min = '', max = '' } = {}) {
  let v = start + steps * step;
  if (min !== '' && min != null) v = Math.max(+min, v);
  if (max !== '' && max != null) v = Math.min(+max, v);
  return String(+v.toFixed((String(step).split('.')[1] || '').length));
}

// A label dragged on a field of several objects whose values differ (it shows none): the steps as a sum on each
// one's own value, "+=8" or "-=0.25" (empty: no step), so that each moves from where it is
export function steppedBy(steps, { step = 1 } = {}) {
  const v = stepped(0, steps, { step });
  return +v > 0 ? '+=' + v : +v < 0 ? '-=' + v.slice(1) : '';
}
