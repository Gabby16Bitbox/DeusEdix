"""Text as the game takes it. Its fonts and its packages are Latin-1, and a T3D's quoted strings go through the
engine's own reader (Core's ReadToken), which has its own escapes. Used by the rules (links.py), the computers'
texts (comptexts.py) and the scripts (scripts.py)."""

# typographic punctuation pasted from a word processor or a phone, and its plain form
PLAIN = {'“': '"', '”': '"', '‘': "'", '’': "'", '—': '-', '–': '-', '…': '...'}


def plain(s):
    """What the game's fonts have (Latin-1): typographic quotes and dashes made plain, the rest '?'."""
    s = ''.join(PLAIN.get(c, c) for c in str(s or ''))
    return s.encode('latin1', 'replace').decode('latin1')


def t3d(s):
    """A string value written between quotes in a T3D. ReadToken reads a backslash as an escape: two of them are
    one backslash, a backslash and two characters a hex byte (a non-hex character counts as 0, and the string
    ends at that NUL). It has no escape for a quote: a quote is written as the byte 22."""
    return str(s).replace('\\', '\\\\').replace('"', '\\22')
