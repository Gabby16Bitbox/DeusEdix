"""Whole-number formulas of the Logic (P9 slice 5, Advanced): "Alarms + 1", "Guards * 2 - Dead", "(Coins + 5) / 2".
Whole numbers, counter names, + - * / %, brackets, a minus in front; the word Value (P8 slice 5b) is the number the
script's output that set the rule off came with (token $, UCEditorStory.CameWith), never a counter. Never run: a formula is read here into the
game's tokens, written after an "=" (=@Alarms,1,+) and worked out by the game on a small stack of its own
(UCEditorStory.NumberOf); a division by 0 gives 0, as % by 0. A plain number stays a plain number, so what was
written before this slice reads the same. static/logic-numbers.js is the same for the page."""
import re

from conditions import name_of

LONGEST = 120               # characters: a sum, not a program
MOST_TOKENS = 24            # what the game's loop works through
DEEPEST = 8                 # the game's stack
_INT = 2 ** 31
_PLAIN = re.compile(r'\s*[+-]?\d+\s*')
_DECIMAL = re.compile(r'\s*[+-]?(?:\d+[.,]?\d*|[.,]\d+)(?:[eE][+-]?\d+)?\s*')
_TOKEN = re.compile(r'\s*(?:(\d+)|([^\W\d]\w*)|(\S))', re.UNICODE)
_LOOSE = {'+': 1, '-': 1, '*': 2, '/': 2, '%': 2}
VALUE = 'Value'             # the word for the number a script's output came with (token $)


class FormulaError(ValueError):
    pass


def is_formula(v):
    """A text that is not a plain whole number (a counter's name, a sum)."""
    return isinstance(v, str) and v.strip() != '' and not _PLAIN.fullmatch(v) and not _float(v)


def _float(v):
    return bool(_DECIMAL.fullmatch(v))


def tokens(text):
    """The formula's game tokens, in the order the game works them out (reverse Polish): '@Name', '12', an
    operator, '~' a minus in front. FormulaError says what is wrong in words."""
    text = str(text)
    if len(text) > LONGEST:
        raise FormulaError('a formula is at most %d characters' % LONGEST)
    items = []
    at = 0
    while at < len(text):
        m = _TOKEN.match(text, at)
        if not m or m.end() == at:
            break
        at = m.end()
        if m.group(1):
            n = int(m.group(1))
            if n >= _INT:
                raise FormulaError('%s is too big a number' % m.group(1))
            items.append(('num', str(n)))
        elif m.group(2) and m.group(2).lower() == VALUE.lower():
            items.append(('name', '$'))              # the value the output came with (not a counter)
        elif m.group(2):
            items.append(('name', '@' + name_of(m.group(2))))
        elif m.group(3) in '+-*/%()':
            items.append(('op', m.group(3)))
        else:
            raise FormulaError('"%s" cannot be in a formula' % m.group(3))
    if not items:
        raise FormulaError('the formula is empty')
    out = []
    pos = [0]

    def peek():
        return items[pos[0]] if pos[0] < len(items) else None

    def expr(level=1):
        if level > 2:
            return unary()
        expr(level + 1)
        while peek() and peek()[0] == 'op' and _LOOSE.get(peek()[1]) == level:
            op = items[pos[0]][1]
            pos[0] += 1
            expr(level + 1)
            out.append(op)

    def unary():
        t = peek()
        if t and t == ('op', '-'):
            pos[0] += 1
            unary()
            out.append('~')
            return
        if t and t == ('op', '+'):
            pos[0] += 1
            unary()
            return
        if t is None:
            raise FormulaError('the formula stops too soon')
        if t[0] in ('num', 'name'):
            pos[0] += 1
            out.append(t[1])
            return
        if t == ('op', '('):
            pos[0] += 1
            expr()
            if peek() != ('op', ')'):
                raise FormulaError('a ")" is missing')
            pos[0] += 1
            return
        raise FormulaError('"%s" is in the wrong place' % t[1])

    expr()
    if peek() is not None:
        t = peek()
        raise FormulaError('"%s" is in the wrong place' % t[1].lstrip('@'))
    if len(out) > MOST_TOKENS:
        raise FormulaError('the formula is too long')
    depth = 0
    for t in out:
        depth += -1 if t in _LOOSE else 0 if t == '~' else 1
        if depth > DEEPEST:
            raise FormulaError('the formula has too many brackets')
    return out


def game_number(v, default=None):
    """What the game reads in a number's place: a plain whole number ('3', '-2'), or '=' and the formula's tokens.
    A number with a decimal part loses it. A bad formula: FormulaError, or the default when one is given."""
    if isinstance(v, bool):
        v = int(v)
    if isinstance(v, (int, float)):
        return '%d' % max(-_INT, min(_INT - 1, int(v)))
    s = str(v if v is not None else '').strip()
    if s == '' and default is not None:
        return game_number(default)
    if not is_formula(s):
        try:
            return '%d' % max(-_INT, min(_INT - 1, int(float(s.replace(',', '.')))))
        except (ValueError, OverflowError):
            if default is not None:
                return game_number(default)
            raise FormulaError('not a number')
    try:
        t = tokens(s)
    except FormulaError:
        if default is not None:
            return game_number(default)
        raise
    if len(t) == 1 and not t[0].startswith(('@', '$')):
        return t[0]
    return '=' + ','.join(t)


def evaluate(game, counter, value=0):
    """What the game works out (UCEditorStory.NumberOf), for the tests and the tools: counter(name) -> int; value:
    the number the output came with (Value)."""
    if not str(game).startswith('='):
        try:
            return int(game)
        except ValueError:
            return 0
    stack = []
    for t in game[1:].split(','):
        if t.startswith('@'):
            stack.append(counter(t[1:]))
        elif t == '$':
            stack.append(int(value or 0))
        elif t == '~':
            stack.append(-stack.pop() if stack else 0)
        elif t in _LOOSE:
            b = stack.pop() if stack else 0
            a = stack.pop() if stack else 0
            stack.append(_op(t, a, b))
        else:
            try:
                stack.append(int(t))
            except ValueError:
                stack.append(0)
    return stack[-1] if stack else 0


def _op(op, a, b):
    if op == '+':
        r = a + b
    elif op == '-':
        r = a - b
    elif op == '*':
        r = a * b
    elif b == 0:
        return 0
    else:
        q = abs(a) // abs(b) * (1 if (a < 0) == (b < 0) else -1)      # towards 0, as the game's int / int
        r = q if op == '/' else a - q * b
    return (r + _INT) % (2 * _INT) - _INT                             # the game's int wraps


def text_of(game):
    """The formula as a person writes it, from the game's tokens: '=@Alarms,1,+' -> 'Alarms + 1'."""
    s = str(game)
    if not s.startswith('='):
        return s
    stack = []                                       # (text, level): 3 a single thing, 2 * / %, 1 + -
    for t in s[1:].split(','):
        if t.startswith('@'):
            stack.append((t[1:], 3))
        elif t == '$':
            stack.append((VALUE, 3))
        elif t == '~':
            x = stack.pop() if stack else ('0', 3)
            stack.append(('-' + (x[0] if x[1] == 3 else '(%s)' % x[0]), 3))
        elif t in _LOOSE:
            b = stack.pop() if stack else ('0', 3)
            a = stack.pop() if stack else ('0', 3)
            lv = _LOOSE[t]
            left = a[0] if a[1] >= lv else '(%s)' % a[0]
            right = b[0] if b[1] > lv else '(%s)' % b[0]
            stack.append(('%s %s %s' % (left, t, right), lv))
        else:
            stack.append((t, 3))
    return stack[-1][0] if stack else ''


def names_in(game):
    """The counters a formula reads (Value is not one)."""
    s = str(game)
    return [t[1:] for t in s[1:].split(',') if t.startswith('@')] if s.startswith('=') else []


def uses_value(game):
    """Whether a formula (as the game reads it) reads Value, the number an output came with."""
    s = str(game)
    return s.startswith('=') and '$' in s[1:].split(',')
