// Whole-number formulas of the Logic (P9 slice 5): "Alarms + 1", "Guards * 2 - Dead", "(Coins + 5) / 2" in a counter
// change, an amount (skill points, credits, health, energy) and a compared value. Whole numbers, counter names,
// + - * / %, brackets, a minus in front. The same as formula.py: read into the game's tokens after an "=" (=@Alarms,1,+),
// worked out on a small stack (UCEditorStory.NumberOf), never run; a division by 0 gives 0, as % by 0. A plain number
// stays a plain number. The word Value (P8 slice 5b) is the number the script's output that set the rule off came with
// (token $, UCEditorStory.CameWith), never a counter. No imports: conditions.js and logic-vocab.js use it.

const LONGEST = 120;          // characters: a sum, not a program
const MOST_TOKENS = 24;       // what the game's loop works through
const DEEPEST = 8;            // the game's stack
const INT = 2 ** 31;
const PLAIN = /^\s*[+-]?\d+\s*$/;
const DECIMAL = /^\s*[+-]?(?:\d+[.,]?\d*|[.,]\d+)(?:e[+-]?\d+)?\s*$/i;
const TOKEN = /\s*(?:(\d+)|([\p{L}_][\p{L}\p{N}_]*)|(\S))/uy;
const LOOSE = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 };
export const VALUE = 'Value';      // the word for the number a script's output came with (token $)

export class FormulaError extends Error {}

// A state's, a counter's or a goal's name as links.py writes it (_game_name, conditions.ident, which conditions.encode
// uses too): an accent dropped (città -> citta), anything but an ASCII letter, a digit or _ made _, a leading digit
// after the fallback and _ (X_3rd_door), 60 characters at most. A blank name stays blank: the game says noname.
export function gameName(s, fallback = 'X') {
  const text = String(s || '').trim();
  if (!text) return '';
  let name = [...text.normalize('NFKD')].filter((ch) => !combining(ch)).join('').replace(/[^A-Za-z0-9_]/gu, '_');
  if (!name || /^[0-9]/.test(name)) name = fallback + '_' + name;
  return name.slice(0, 60);
}
// a character with a combining class, which ident drops (Python's unicodedata.combining; a mark of class 0 becomes _):
// normalising moves it past a mark of the lowest class (U+0334) or of the highest (U+0345), never one of class 0
const combining = (ch) => (ch + '̴').normalize('NFD') !== ch + '̴' || ('ͅ' + ch).normalize('NFD') !== 'ͅ' + ch;

// A text that is not a plain number (a counter's name, a sum).
export const isFormula = (v) => typeof v === 'string' && v.trim() !== '' && !PLAIN.test(v) && !DECIMAL.test(v);

// The formula's game tokens in the order the game works them out: '@Name', '12', an operator, '~' a minus in front.
// FormulaError says what is wrong in words.
export function formulaTokens(text) {
  text = String(text);
  if (text.length > LONGEST) throw new FormulaError(`a formula is at most ${LONGEST} characters`);
  const items = [];
  TOKEN.lastIndex = 0;
  for (let m; TOKEN.lastIndex < text.length && (m = TOKEN.exec(text));) {
    if (m[1]) {
      if (+m[1] >= INT) throw new FormulaError(`${m[1]} is too big a number`);
      items.push(['num', String(+m[1])]);
    } else if (m[2] && m[2].toLowerCase() === VALUE.toLowerCase()) items.push(['name', '$']);    // not a counter
    else if (m[2]) items.push(['name', '@' + gameName(m[2])]);
    else if (m[3] && '+-*/%()'.includes(m[3])) items.push(['op', m[3]]);
    else if (m[3]) throw new FormulaError(`"${m[3]}" cannot be in a formula`);
  }
  if (!items.length) throw new FormulaError('the formula is empty');
  const out = [];
  let at = 0;
  const peek = () => items[at];
  const isOp = (op) => peek() && peek()[0] === 'op' && peek()[1] === op;
  const expr = (level = 1) => {
    if (level > 2) return unary();
    expr(level + 1);
    while (peek() && peek()[0] === 'op' && LOOSE[peek()[1]] === level) {
      const op = items[at++][1];
      expr(level + 1);
      out.push(op);
    }
  };
  const unary = () => {
    const t = peek();
    if (isOp('-')) { at++; unary(); out.push('~'); return; }
    if (isOp('+')) { at++; unary(); return; }
    if (!t) throw new FormulaError('the formula stops too soon');
    if (t[0] === 'num' || t[0] === 'name') { at++; out.push(t[1]); return; }
    if (isOp('(')) {
      at++;
      expr();
      if (!isOp(')')) throw new FormulaError('a ")" is missing');
      at++;
      return;
    }
    throw new FormulaError(`"${t[1]}" is in the wrong place`);
  };
  expr();
  if (peek()) throw new FormulaError(`"${peek()[1].replace(/^@/, '')}" is in the wrong place`);
  if (out.length > MOST_TOKENS) throw new FormulaError('the formula is too long');
  let depth = 0;
  for (const t of out) {
    depth += Object.hasOwn(LOOSE, t) ? -1 : t === '~' ? 0 : 1;
    if (depth > DEEPEST) throw new FormulaError('the formula has too many brackets');
  }
  return out;
}

// What is wrong with a formula in words, '' when nothing (a plain number: nothing)
export function formulaProblem(v) {
  if (!isFormula(v)) return '';
  try { formulaTokens(v); return ''; } catch (e) { if (e instanceof FormulaError) return e.message; throw e; }
}

const clampInt = (n) => Math.max(-INT, Math.min(INT - 1, n));

// What the game reads in a number's place (formula.game_number): '3', or '=' and the tokens; a bad one: the default
// when one is given, else a FormulaError
export function gameNumber(v, dflt) {
  if (typeof v === 'boolean') v = +v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(clampInt(Math.trunc(v))) : gameNumber(dflt ?? 0);
  const s = String(v ?? '').trim();
  if (s === '' && dflt !== undefined) return gameNumber(dflt);
  if (!isFormula(s)) {
    const n = Math.trunc(Number(s.replace(',', '.')));
    if (s !== '' && Number.isFinite(n)) return String(clampInt(n));
    if (dflt !== undefined) return gameNumber(dflt);
    throw new FormulaError('not a number');
  }
  let t;
  try { t = formulaTokens(s); } catch (e) { if (dflt !== undefined && e instanceof FormulaError) return gameNumber(dflt); throw e; }
  return t.length === 1 && !/^[@$]/.test(t[0]) ? t[0] : '=' + t.join(',');
}

const wrap = (r) => ((((r + INT) % (2 * INT)) + 2 * INT) % (2 * INT)) - INT;     // the game's int wraps
function op(o, a, b) {
  if (o === '+') return wrap(a + b);
  if (o === '-') return wrap(a - b);
  if (o === '*') return wrap(Number(BigInt(a) * BigInt(b) % (2n ** 32n)));
  if (b === 0) return 0;
  const q = Math.trunc(a / b);                     // towards 0, as the game's int / int
  return wrap(o === '/' ? q : a - q * b);
}

// What the game works out (UCEditorStory.NumberOf); counter(name) -> its value; value: what the output came with
export function evaluate(game, counter, value = 0) {
  const s = String(game ?? '');
  if (!s.startsWith('=')) return parseInt(s, 10) || 0;
  const stack = [];
  for (const t of s.slice(1).split(',')) {
    if (t.startsWith('@')) stack.push(Math.trunc(+counter(t.slice(1)) || 0));
    else if (t === '$') stack.push(Math.trunc(+value || 0));
    else if (t === '~') stack.push(stack.length ? -stack.pop() : 0);
    else if (Object.hasOwn(LOOSE, t)) { const b = stack.length ? stack.pop() : 0, a = stack.length ? stack.pop() : 0; stack.push(op(t, a, b)); }
    else stack.push(parseInt(t, 10) || 0);
  }
  return stack.length ? stack[stack.length - 1] : 0;
}

// A value as typed (a number or a formula) worked out now; a bad formula: 0
export function valueNow(v, counter, value = 0) {
  try { return evaluate(gameNumber(v), counter, value); } catch (e) { if (e instanceof FormulaError) return 0; throw e; }
}

// Whether a value as typed (or as the game reads it) uses Value, the number a script's output came with
export function usesValue(v) {
  let s = String(v ?? '');
  if (!s.startsWith('=')) { if (!isFormula(s)) return false; try { s = gameNumber(s); } catch (e) { return false; } }
  return s.startsWith('=') && s.slice(1).split(',').includes('$');
}

// The formula as a person writes it, from the game's tokens: '=@Alarms,1,+' -> 'Alarms + 1' (the logic log)
export function formulaText(game) {
  const s = String(game ?? '');
  if (!s.startsWith('=')) return s;
  const stack = [];                                // [text, level]: 3 a single thing, 2 * / %, 1 + -
  for (const t of s.slice(1).split(',')) {
    if (t.startsWith('@')) stack.push([t.slice(1), 3]);
    else if (t === '$') stack.push([VALUE, 3]);
    else if (t === '~') { const x = stack.pop() || ['0', 3]; stack.push(['-' + (x[1] === 3 ? x[0] : `(${x[0]})`), 3]); }
    else if (Object.hasOwn(LOOSE, t)) {
      const b = stack.pop() || ['0', 3], a = stack.pop() || ['0', 3], lv = LOOSE[t];
      stack.push([`${a[1] >= lv ? a[0] : `(${a[0]})`} ${t} ${b[1] > lv ? b[0] : `(${b[0]})`}`, lv]);
    } else stack.push([t, 3]);
  }
  return stack.length ? stack[stack.length - 1][0] : '';
}

// A value as typed shown in a sentence: a number as a number, a formula tidied ("alarms+1" -> "alarms + 1")
export function valueText(v) {
  if (!isFormula(v)) return String(Math.trunc(Number(String(v ?? '').replace(',', '.'))) || 0);
  try { return formulaText(gameNumber(v)); } catch (e) { if (e instanceof FormulaError) return String(v).trim(); throw e; }
}
