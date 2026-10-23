"""The editor's guide (docs/tutorials/07-map-editor.md and the other tutorials) as a web page: a small
Markdown renderer for what the tutorials use (headings, paragraphs, lists, tables, code, links, bold,
italics), so the editor needs no extra package. Served at /guide (Help -> Open the full guide)."""
import html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import settings  # noqa: E402

PROJECT = Path(__file__).resolve().parents[3]
if settings.STANDALONE:          # DeusEdix installed: its own guide (made from 07-map-editor.md)
    TUTORIALS = PROJECT / 'docs' / 'guide'
    REPO = ''
    DEFAULT = 'guide.md'
    TITLE = 'DeusEdix'
else:
    TUTORIALS = PROJECT / 'docs' / 'tutorials'
    REPO = 'https://github.com/Gabby16Bitbox/unatco-continues/blob/main/'
    DEFAULT = '07-map-editor.md'
    TITLE = 'UNATCO Continues Map Editor'


def _link(url):
    if re.match(r'^(https?:|mailto:|#|/)', url):
        return url
    target = (TUTORIALS / url).resolve()
    if target.parent == TUTORIALS.resolve() and target.suffix == '.md':
        return '/guide?doc=' + target.name
    if not REPO:                 # installed: no repository to link to
        return '#'
    try:
        return REPO + target.relative_to(PROJECT.resolve()).as_posix()
    except ValueError:
        return url


def _inline(s):
    codes = []

    def keep(m):
        codes.append('<code>%s</code>' % html.escape(m.group(1), quote=False))
        return '\x00%d\x00' % (len(codes) - 1)

    s = re.sub(r'`([^`]+)`', keep, s)
    s = html.escape(s, quote=False)
    s = re.sub(r'!\[([^\]]*)\]\(([^)\s]+)\)', lambda m: '<img alt="%s" src="%s">' % (m.group(1), _link(m.group(2))), s)
    s = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', lambda m: '<a href="%s">%s</a>' % (_link(m.group(2)), m.group(1)), s)
    s = re.sub(r'&lt;(https?://[^&\s]+)&gt;', r'<a href="\1">\1</a>', s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<i>\1</i>', s)
    return re.sub('\x00(\\d+)\x00', lambda m: codes[int(m.group(1))], s)


def _slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def render_markdown(md):
    """HTML body and the list of (level, text, anchor) headings."""
    out, heads = [], []
    lines = md.replace('\r\n', '\n').split('\n')
    i = 0
    para, items, kind = [], [], None

    def flush():
        nonlocal para, items, kind
        if para:
            out.append('<p>%s</p>' % _inline(' '.join(para)))
        if items:
            tag = 'ol' if kind == 'ol' else 'ul'
            out.append('<%s>%s</%s>' % (tag, ''.join('<li>%s</li>' % _inline(x) for x in items), tag))
        para, items, kind = [], [], None

    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if s.startswith('```'):
            flush()
            j = i + 1
            while j < len(lines) and not lines[j].strip().startswith('```'):
                j += 1
            out.append('<pre>%s</pre>' % html.escape('\n'.join(lines[i + 1:j])))
            i = j + 1
            continue
        if line.startswith('    ') and not items and not para:
            j = i
            while j < len(lines) and (lines[j].startswith('    ') or not lines[j].strip()):
                j += 1
            out.append('<pre>%s</pre>' % html.escape('\n'.join(x[4:] for x in lines[i:j]).rstrip()))
            i = j
            continue
        m = re.match(r'^(#{1,4})\s+(.*)$', s)
        if m:
            flush()
            level, text = len(m.group(1)), m.group(2).strip()
            anchor = _slug(text)
            heads.append((level, text, anchor))
            out.append('<h%d id="%s">%s</h%d>' % (level, anchor, _inline(text), level))
            i += 1
            continue
        if s.startswith('|'):
            flush()
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')])
                i += 1
            body = [r for r in rows if not all(re.fullmatch(r':?-{2,}:?', c) or not c for c in r)]
            if body:
                head, rest = body[0], body[1:]
                th = ''.join('<th>%s</th>' % _inline(c) for c in head) if any(head) else ''
                out.append('<table>%s%s</table>' % ('<tr>%s</tr>' % th if th else '',
                                                     ''.join('<tr>%s</tr>' % ''.join('<td>%s</td>' % _inline(c) for c in r)
                                                             for r in rest)))
            continue
        m = re.match(r'^(-|\*|\d+\.)\s+(.*)$', s)
        if m and not line.startswith('    '):
            k = 'ol' if m.group(1)[0].isdigit() else 'ul'
            if para or (items and kind != k):
                flush()
            kind = k
            items.append(m.group(2))
            i += 1
            continue
        if not s:
            flush()
            i += 1
            continue
        if items and line.startswith((' ', '\t')):
            items[-1] += ' ' + s
        else:
            if items:
                flush()
            para.append(s)
        i += 1
    flush()
    return '\n'.join(out), heads


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>%(title)s</title>
<style>
:root { --bg:#14161b; --panel:#1d2027; --line:#2c313b; --text:#d9dde5; --dim:#8b93a3; --acc:#5aa2ff; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.6 "Segoe UI", system-ui, sans-serif; }
header { position:sticky; top:0; z-index:2; background:var(--panel); border-bottom:1px solid var(--line); padding:8px 20px; display:flex; flex-wrap:wrap; gap:6px 16px; align-items:center; } header span.tuts { flex:1; text-align:right; color:var(--dim); font-size:13px; } header span.tuts a { margin-left:6px; }
header b { font-size:15px; } header a { color:var(--acc); text-decoration:none; }
.wrap { display:flex; max-width:1180px; margin:0 auto; gap:28px; padding:0 20px; }
nav { position:sticky; top:56px; align-self:flex-start; width:230px; flex:none; padding:18px 0; max-height:calc(100vh - 60px); overflow:auto; font-size:13px; }
nav a { display:block; color:var(--dim); text-decoration:none; padding:2px 0; } nav a:hover { color:var(--text); }
nav a.l3 { padding-left:14px; }
main { flex:1; min-width:0; padding:10px 0 60px; }
h1 { font-size:28px; margin:22px 0 10px; } h2 { font-size:21px; margin:34px 0 8px; padding-top:6px; border-top:1px solid var(--line); }
h3 { font-size:17px; margin:24px 0 6px; } a { color:var(--acc); }
code { background:#262a33; border:1px solid var(--line); border-radius:4px; padding:0 4px; font:13px Consolas, monospace; }
pre { background:#1a1d24; border:1px solid var(--line); border-radius:6px; padding:10px 12px; overflow:auto; font:13px/1.45 Consolas, monospace; }
table { border-collapse:collapse; margin:10px 0; width:100%%; display:block; overflow-x:auto; }
th, td { border:1px solid var(--line); padding:6px 10px; text-align:left; vertical-align:top; }
th { background:var(--panel); } td:first-child { white-space:nowrap; color:#cfe3ff; }
li { margin:3px 0; } img { max-width:100%%; border-radius:6px; }
@media (max-width: 800px) { nav { display:none; } td:first-child { white-space:normal; } }
</style></head><body>
<header><b>%(app)s</b><a href="/">&larr; back to the editor</a><span class="tuts">%(others)s</span></header>
<div class="wrap"><nav>%(toc)s</nav><main>%(body)s</main></div></body></html>"""


def page(doc=None):
    """(status, html) of a tutorial as a page; only files of docs/tutorials."""
    name = doc if doc and re.fullmatch(r'[\w.-]+\.md', doc) else DEFAULT
    path = TUTORIALS / name
    if not path.exists():
        return 404, '<p>Not found.</p>'
    body, heads = render_markdown(path.read_text(encoding='utf-8'))
    title = heads[0][1] if heads else name
    toc = ''.join('<a class="l%d" href="#%s">%s</a>' % (lvl, a, html.escape(t)) for lvl, t, a in heads if lvl in (2, 3))
    others = ' '.join('<a href="/guide?doc=%s">%s</a>' % (p.name, html.escape(p.stem.split('-', 1)[0]))
                      for p in sorted(TUTORIALS.glob('*.md')))
    docs = sorted(TUTORIALS.glob('*.md'))
    return 200, PAGE % dict(title=html.escape(title), toc=toc, body=body, app=html.escape(TITLE),
                            others=('tutorials: ' + others) if len(docs) > 1 else '')
