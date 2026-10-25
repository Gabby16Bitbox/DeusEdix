"""The editor for an AI assistant (MCP): the switch that allows it, and the calls on their way to the editor's page.

An assistant (Claude Code or any other MCP client) runs deusedix_mcp.py. That finds the running DeusEdix in
assistant.json (in the user's own folder, written only while the user allows assistants: Tools > AI assistant...),
asks the hub for the open project (/api/assistant/target) and posts each tool call to that project's server
(/api/agent/call). The server keeps the call until the editor's page takes it (/api/agent/next, a long poll), runs it
with the editor's own functions (static/agent.js) and posts the result back (/api/agent/result). So an assistant
changes the map the way a click does: undo, unsaved changes, Save and Rebuild are the user's as they are.

What an assistant can do here it could already do with the project's own API: the session in assistant.json is the
page's. The switch is the user's consent; the servers check it on every call (allowed()), not only the file.
"""
import json
import os
from pathlib import Path
import threading
import time
import uuid

import atomicfile

FILE = Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local') / 'DeusEdix' / 'assistant.json'
POLL = 25            # seconds a page waits for a call before it asks again
PAGE_GONE = 8        # a page that has not asked for this long is not open any more
# what the page knows how to do (static/agent.js OPS): anything else is refused here, before it waits for a page
OPS = frozenset(('state', 'maps', 'open_map', 'find', 'object', 'select', 'place', 'move', 'set', 'delete',
                 'undo', 'redo', 'save', 'rebuild', 'view', 'story_list', 'story_get', 'story_write', 'story_play',
                 'run_js'))


class PageClosed(RuntimeError):
    """No editor page is open for this project: nothing can run the call."""


def _read():
    try:
        value = json.loads(FILE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _write(value):
    FILE.parent.mkdir(parents=True, exist_ok=True)
    atomicfile.write_json(FILE, value)


def allowed():
    return _read().get('allowed') is True


def editors():
    """{app folder: {url, session, pid, since}} of the DeusEdix hubs an assistant may use (one per install)."""
    value = _read().get('editors')
    return value if isinstance(value, dict) and allowed() else {}


def set_allowed(on, url, session, root):
    """The user's switch. On: this hub can be found. Off: no hub can be found any more (every one is forgotten)."""
    value = _read()
    value['allowed'] = bool(on)
    value['editors'] = dict(value.get('editors') or {}, **{str(root): dict(url=url, session=session, pid=os.getpid(),
                                                                           since=time.time())}) if on else {}
    _write(value)
    return dict(allowed=value['allowed'])


def register(url, session, root):
    """A hub starting: findable again if the user allowed assistants before."""
    if allowed():
        set_allowed(True, url, session, root)


def unregister(root):
    value = _read()
    if str(root) in (value.get('editors') or {}):
        del value['editors'][str(root)]
        _write(value)


class Calls:
    """Calls waiting for the page, and the page's answers. One project server has one of these (CALLS)."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._cond = threading.Condition()
        self._waiting = []                 # calls no page has taken yet
        self._taken = {}                   # id -> a call a page is running
        self._asking = 0                   # pages waiting in next() right now
        self._asked = float('-inf')        # when a page last asked
        self.last_call = None              # when an assistant last called (the dialog's "connected")

    def page_open(self):
        with self._cond:
            return self._asking > 0 or self._clock() - self._asked < PAGE_GONE

    def call(self, op, args, timeout):
        """Run `op` in the page and return {ok, value} or {ok: False, error}. Raises PageClosed, TimeoutError."""
        if op not in OPS:
            raise ValueError('Unknown editor call: %s' % op)
        self.last_call = time.time()
        if not self.page_open():
            raise PageClosed('No editor page is open for this project. Open the project in DeusEdix.')
        job = dict(id=uuid.uuid4().hex, op=op, args=args, done=threading.Event(), result=None)
        with self._cond:
            self._waiting.append(job)
            self._cond.notify_all()
        if not job['done'].wait(timeout):
            with self._cond:
                if job in self._waiting:
                    self._waiting.remove(job)
                self._taken.pop(job['id'], None)
            raise TimeoutError('The editor did not finish "%s" in %d s.' % (op, timeout))
        return job['result']

    def next(self, wait=POLL):
        """The page asking for a call: {id, op, args}, or None when none came within `wait` seconds."""
        with self._cond:
            self._asking += 1
            try:
                end = self._clock() + wait
                while not self._waiting:
                    left = end - self._clock()
                    if left <= 0:
                        return None
                    self._cond.wait(left)
                job = self._waiting.pop(0)
                self._taken[job['id']] = job
                return dict(id=job['id'], op=job['op'], args=job['args'])
            finally:
                self._asking -= 1
                self._asked = self._clock()

    def result(self, ident, ok, value=None, error=''):
        """The page's answer. False: no call waits for it (it timed out)."""
        with self._cond:
            job = self._taken.pop(ident, None)
            self._asked = self._clock()
        if job is None:
            return False
        job['result'] = dict(ok=True, value=value) if ok else dict(ok=False, error=str(error or 'The call failed.'))
        job['done'].set()
        return True


CALLS = Calls()
