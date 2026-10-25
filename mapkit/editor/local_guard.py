"""Which requests the editor's servers answer: ones addressed to this PC by name, and sent by pages of this PC.

The servers listen on 127.0.0.1 only, so nothing on the network reaches them. A web page open in the browser still
can, by DNS rebinding: a site points its own name at 127.0.0.1, and its pages become same-origin with the editor's
(they could read a page of the editor, and the session in it). So a request that names any host but this PC, or that
a page of another site sent, is refused before anything else, as Jupyter and the MCP SDK refuse them.
"""
from urllib.parse import urlsplit

NAMES = ('127.0.0.1', 'localhost', '[::1]')     # how the editor's own pages and programs name this PC


def host_allowed(host, port):
    """The Host header: this PC, at this server's own port (browsers and urllib always send it)."""
    return (host or '').strip().lower() in {'%s:%d' % (name, port) for name in NAMES}


def origin_allowed(origin):
    """The Origin header, sent by pages with a POST or a fetch: none, or a page of this PC (any port: the projects'
    page and a project's are on different ones). "null" (a sandboxed frame, a file) is not a page of the editor."""
    if not origin:
        return True
    try:
        parts = urlsplit(origin)
        return parts.scheme == 'http' and parts.hostname in ('127.0.0.1', 'localhost', '::1') and parts.port is not None
    except ValueError:
        return False
