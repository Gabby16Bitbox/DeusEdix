"""The emails and bulletins of computers written in the map editor (edits['texts'] = {computer name:
{'loc': [x, y, z], 'emails': [{user, from, to, cc, subject, body}], 'bulletins': [{title, body}]}}).

The game's computers read texts ("ExtString" objects) from a text package (Computers.TextPackage):
the inbox of an account is "<mission>_EmailMenu_<login>" (one <EMAIL=text name,subject,from,to,cc>
line per email), a public terminal's list is its bulletinTag (<FILE=text name,title> lines). Here each
text becomes a hidden UCTextBlock actor of the map (TextName, Text); UCBoot makes them into
ExtStrings of the editor's package (settings.PACKAGE) when the map starts, and the editor sets the
computer's TextPackage to it (and a public terminal's bulletinTag).
"""
import re
import sys
from pathlib import Path as _Path

sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import settings  # noqa: E402

PACKAGE = settings.PACKAGE


from gametext import plain, t3d  # noqa: E402  (what the game's fonts have; a T3D string as the engine reads it)


def mission(map_name):
    m = re.match(r'(\d\d)_', map_name or '')
    return m.group(1) if m else '00'


def _field(s):
    # a field of an <EMAIL=...> or <FILE=...> line: no commas or angle brackets inside
    return re.sub(r'[,<>]', ' ', str(s or '')).strip()


def body(text, title=''):
    """Plain text with line breaks -> the game's text format (white text, one <P> per line)."""
    lines = str(text or '').replace('\r', '').split('\n')
    out = '<DC=255,255,255>'
    if title:
        out += '<P><B>%s</B><P>' % _field(title)
    for line in lines:
        out += '<P>' + line.replace('<', '(').replace('>', ')')
    return out


def ident(s):
    return re.sub(r'\W', '_', str(s or ''))


def blocks(edits, map_name):
    """The UCTextBlock actors of the map: [{'cls', 'name', 'loc', 'props'}], like edits['added']."""
    texts = edits.get('texts') or {}
    out, inbox = [], {}
    nn = mission(map_name)
    k = 0

    def add(name, text, loc):
        nonlocal k
        k += 1
        text = plain(text)
        quoted = '"%s"' % t3d(text)
        out.append(dict(cls='UCTextBlock', name='UCText%d' % k, loc=list(loc or [0, 0, 0]),
                        props={'TextName': name, 'Text': quoted}))

    for comp, t in sorted(texts.items()):
        loc = t.get('loc') or [0, 0, 0]
        for i, e in enumerate(t.get('emails') or []):
            user = str(e.get('user') or '').strip()
            if not user or not (e.get('subject') or e.get('body')):
                continue
            name = 'UCEmail_%s_%s_%d' % (ident(map_name), ident(comp), i + 1)
            add(name, body(e.get('body')), loc)
            inbox.setdefault(user.lower(), (user, loc, []))[2].append(
                '<EMAIL=%s,%s,%s,%s,%s>' % (name, _field(e.get('subject')), _field(e.get('from')),
                                            _field(e.get('to') or user), _field(e.get('cc'))))
        files = []
        for i, b in enumerate(t.get('bulletins') or []):
            if not (b.get('title') or b.get('body')):
                continue
            name = 'UCBulletin_%s_%s_%d' % (ident(map_name), ident(comp), i + 1)
            add(name, body(b.get('body'), b.get('title')), loc)
            files.append('<FILE=%s,%s>' % (name, _field(b.get('title')) or 'Bulletin'))
        if files:
            add(bulletin_tag(map_name, comp), ''.join(files), loc)
    # one inbox per login (an account shows the same emails on every computer of the mission)
    for user, loc, lines in inbox.values():
        add('%s_EmailMenu_%s' % (nn, user), ''.join(lines), loc)
    return out


def bulletin_tag(map_name, comp):
    return 'UCBulletins_%s_%s' % (ident(map_name), ident(comp))


def report(edits):
    out = []
    for comp, t in sorted((edits.get('texts') or {}).items()):
        n, b = len(t.get('emails') or []), len(t.get('bulletins') or [])
        if n or b:
            out.append('  EDIT texts of %s: %d email(s), %d bulletin(s)' % (comp, n, b))
    return out
