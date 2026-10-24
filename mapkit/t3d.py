"""Read UE1 T3D map exports (MAP EXPORT): actors, their properties and brush polygons."""
import math
import re

def import_text(blocks):
    """MAP IMPORTADD payload that cannot consume a real piece as the builder.

    UE1 reserves the first plain Brush actor for its editor builder brush. A
    brush-only prefab would otherwise exist as an actor but never enter BSP.
    The empty model MUST precede Brush=Model: reversing this crashes PrepBrush.
    Actor-only and Movers-only imports retain their existing behaviour.
    """
    text = ''.join(block if block.endswith('\n') else block + '\n' for block in blocks)
    if re.search(r'^[ \t]*Begin Actor Class=(?:[A-Za-z_]\w*\.)?Brush\b', text, re.M | re.I):
        names = {name.casefold() for name in re.findall(r'\bName=([A-Za-z_]\w*)', text, re.I)}
        suffix = 0
        while True:
            name = 'UCImportBuilder' + (str(suffix) if suffix else '')
            model = name + 'Model'
            if name.casefold() not in names and model.casefold() not in names:
                break
            suffix += 1
        sentinel = ("Begin Actor Class=Brush Name=%s\n"
                    "    Location=(X=0,Y=0,Z=0)\n"
                    "    Begin Brush Name=%s\n"
                    "        Begin PolyList\n"
                    "        End PolyList\n"
                    "    End Brush\n"
                    "    Brush=Model'MyLevel.%s'\n"
                    "End Actor\n") % (name, model, model)
        text = sentinel + text
    return 'Begin Map\n' + text + 'End Map\n'


class Block:
    """One Begin <kind> ... End <kind> block of a T3D text: Map, Actor, Brush, PolyList, Polygon.

    kind      'Actor', 'Polygon', ...
    head      the rest of its Begin line ('Class=Light Name=Light5'), fields: its key=value words
    lines     its own lines, stripped (an actor's properties, a polygon's Origin / Normal / Vertex lines),
              not those of the blocks inside it; children: those blocks
    start     where the word Begin is in the text; head_end: the end of the Begin line
    tail      where the word End is (None while the block is open); tail_line: the start of that line;
              end: the end of that line
    """
    __slots__ = ('kind', 'head', '_fields', 'lines', 'children', 'start', 'head_end', 'tail', 'tail_line', 'end')

    def __init__(self, kind, head, start, head_end):
        self.kind, self.head, self.start, self.head_end = kind, head, start, head_end
        self._fields = None
        self.lines, self.children = [], []
        self.tail = self.tail_line = self.end = None

    @property
    def fields(self):
        if self._fields is None:            # read when asked: most blocks of a map are never looked at
            self._fields = dict(w.split('=', 1) for w in self.head.split() if '=' in w)
        return self._fields

    def line(self, key):
        """The value of its own line '<key> <value>' (a polygon's Normal, TextureU...), or None."""
        for s in self.lines:
            words = s.split(None, 1)
            if len(words) == 2 and words[0] == key:
                return words[1]
        return None

    def numbers(self, key):
        """Its line '<key> +00001.000000,-00002.500000,...' as floats, or None."""
        value = self.line(key)
        return None if value is None else [float(x) for x in value.replace('+', '').split(',')]


def blocks(text):
    """The outermost blocks of a T3D text (an export has one, Map), each with the blocks inside it. A block whose
    End is missing stays open (tail None); an End with no open block of its kind is ignored."""
    top, stack, pos = [], [], 0
    for line in text.split('\n'):
        eol = pos + len(line)
        s = line.strip()
        if s.startswith('Begin '):
            words = s.split(None, 2)
            b = Block(words[1], words[2] if len(words) > 2 else '', pos + line.index('Begin'), eol)
            (stack[-1].children if stack else top).append(b)
            stack.append(b)
        elif s.startswith('End ') and stack:
            kind = s.split(None, 2)[1]
            if any(b.kind == kind for b in stack):
                while True:
                    b = stack.pop()
                    if b.kind == kind:
                        b.tail, b.tail_line, b.end = pos + line.index('End'), pos, eol
                        break
        elif s and stack:
            stack[-1].lines.append(s)
        pos = eol + 1
    return top


def walk(found):
    """Every block of blocks(), the outer ones first."""
    for b in found:
        yield b
        yield from walk(b.children)


def _blank_lines_end(text, i):
    """i: the end of a line. The end of the blank lines right after it (the end of the text when only blanks
    follow): where an actor's text has always ended, so that raw and body stay as they were."""
    j = i
    while j < len(text) and text[j].isspace():
        j += 1
    return len(text) if j == len(text) else text.rfind('\n', i, j)


def actors(text):
    """Yield dicts: cls, name, body (raw text), props (top-level key -> raw value)."""
    for b in walk(blocks(text)):
        if b.kind != 'Actor' or b.tail is None or 'Class' not in b.fields or 'Name' not in b.fields:
            continue
        props = dict(s.split('=', 1) for s in b.lines if '=' in s)
        yield dict(cls=b.fields['Class'], name=b.fields['Name'], body=text[_blank_lines_end(text, b.head_end):b.tail_line],
                   props=props, raw=text[b.start:_blank_lines_end(text, b.end)])


def struct(value):
    """A struct value as T3D writes it, '(X=1.0,Y=2.0,Z=3.0)' or '(Scale=(X=1,Y=1,Z=1),SheerAxis=SHEER_None)' ->
    {'X': '1.0', ...}, the structs inside it as dicts; {} for anything else."""
    s = (value or '').strip()

    def read(i):                    # s[i] is '('
        out = {}
        i += 1
        while i < len(s) and s[i] != ')':
            eq = s.find('=', i)
            if eq < 0:
                return out, len(s)
            key = s[i:eq].strip()
            i = eq + 1
            if i < len(s) and s[i] == '(':
                out[key], i = read(i)
            else:
                j = i
                while j < len(s) and s[j] not in ',)':
                    j += 1
                out[key], i = s[i:j].strip(), j
            if i < len(s) and s[i] == ',':
                i += 1
        return out, i + 1
    return read(0)[0] if s.startswith('(') else {}


def vec(value, default=(0.0, 0.0, 0.0)):
    if not value:
        return default
    d = struct(value)
    return (float(d.get('X', 0)), float(d.get('Y', 0)), float(d.get('Z', 0)))


def rot(value):
    if not value:
        return (0, 0, 0)
    d = struct(value)
    return (int(d.get('Pitch', 0)), int(d.get('Yaw', 0)), int(d.get('Roll', 0)))


def polys(body):
    """Brush polygons of an actor body: list of dicts (texture, flags, verts, raw)."""
    out = []
    for b in walk(blocks(body)):
        if b.kind != 'Polygon' or b.tail is None:
            continue
        flags = b.fields.get('Flags', '')
        out.append(dict(texture=b.fields.get('Texture'), flags=int(flags) if flags.isdigit() else 0,
                        verts=[tuple(float(x) for x in s.split(None, 1)[1].split(',')) for s in b.lines
                               if s.split(None, 1)[0] == 'Vertex'],
                        raw=body[b.start:b.tail + len('End Polygon')]))
    return out


def _scale(props, key):
    v = props.get(key)
    if not v:
        return (1.0, 1.0, 1.0)
    d = struct(v)
    d = d['Scale'] if isinstance(d.get('Scale'), dict) else d          # MainScale / PostScale: (Scale=(X=..),...)
    return (float(d.get('X', 1)), float(d.get('Y', 1)), float(d.get('Z', 1)))


def _rotate(p, r):
    pitch, yaw, roll = (a * math.pi / 32768.0 for a in r)
    x, y, z = p
    # UE1 order: roll (X), pitch (Y), yaw (Z)
    cr, sr = math.cos(roll), math.sin(roll)
    y, z = y * cr - z * sr, y * sr + z * cr
    cp, sp = math.cos(pitch), math.sin(pitch)
    x, z = x * cp - z * sp, x * sp + z * cp
    cy, sy = math.cos(yaw), math.sin(yaw)
    x, y = x * cy - y * sy, x * sy + y * cy
    return (x, y, z)


def world_verts(actor):
    """Brush polygon vertices in world space (approximate: MainScale, Rotation, PostScale)."""
    p = actor['props']
    loc = vec(p.get('Location'))
    pre = vec(p.get('PrePivot'))
    main = _scale(p, 'MainScale')
    post = _scale(p, 'PostScale')
    r = rot(p.get('Rotation'))
    res = []
    for poly in polys(actor['body']):
        vs = []
        for v in poly['verts']:
            q = tuple((v[i] - pre[i]) * main[i] for i in range(3))
            q = _rotate(q, r)
            q = tuple(q[i] * post[i] + loc[i] for i in range(3))
            vs.append(q)
        res.append((poly, vs))
    return res


def bounds(actor):
    pts = [v for _, vs in world_verts(actor) for v in vs]
    if not pts:
        return None
    return (tuple(min(p[i] for p in pts) for i in range(3)), tuple(max(p[i] for p in pts) for i in range(3)))
