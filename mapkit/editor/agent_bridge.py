"""The editor for an AI assistant (MCP): the switch that allows it, and the calls on their way to the editor's page.

An assistant (Claude Code or any other MCP client) runs deusedix_mcp.py. That finds the running DeusEdix in
assistant.json (in the user's own folder, written only while the user allows assistants: Tools > AI assistant...),
asks the hub for the open project (/api/assistant/target) and posts each tool call to that project's server
(/api/agent/call). The server keeps the call until the editor's page takes it (/api/agent/next, a long poll), runs it
with the editor's own functions (static/agent.js) and posts the result back (/api/agent/result). So an assistant
changes the map the way a click does: undo, unsaved changes, Save and Rebuild are the user's as they are.

What an assistant can do here it could already do with the project's own API: the session in assistant.json is the
page's. The switch is the user's consent; the servers check it on every call (allowed()), not only the file. A second
switch (advanced()) allows the tools that can do anything the page can (ADVANCED, and project_api's writes in
deusedix_mcp.py): off, an assistant steered by text in a map or a mod made by someone else ("prompt injection") can
still only do what the other tools do, each of them undoable and unsaved until a save.
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
                 'run_js', 'classes', 'textures', 'draw', 'batch', 'picture', 'logic_read', 'logic_offer', 'logic_check',
                 'logic_try', 'logic_propose', 'logic_proposal', 'logic_why', 'logic_log', 'logic_patterns'))
MAX_BATCH = 100                        # calls in one batch
ADVANCED = frozenset(('run_js',))      # only with the second switch: JavaScript in the page can do anything it can
MAX_WAITING = 32                       # calls waiting for the page at once (an assistant waits for each one)
MAX_PAGES = 16                         # page loads remembered (their order: the newest one still open takes the calls)


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


def advanced():
    value = _read()
    return value.get('allowed') is True and value.get('advanced') is True


def editors():
    """{app folder: {url, session, pid, since}} of the DeusEdix hubs an assistant may use (one per install)."""
    value = _read().get('editors')
    return value if isinstance(value, dict) and allowed() else {}


def set_allowed(on, url, session, root, advanced=False):
    """The user's switches. On: this hub can be found. Off: no hub can be found any more (every one is forgotten), and
    advanced tools are off too."""
    value = _read()
    value['allowed'] = bool(on)
    value['advanced'] = bool(on and advanced)
    value['editors'] = dict(value.get('editors') or {}, **{str(root): dict(url=url, session=session, pid=os.getpid(),
                                                                           since=time.time())}) if on else {}
    _write(value)
    return dict(allowed=value['allowed'])


# the user's own folders, most particular first: written as their variables where a command is shown
SHOWN_ROOTS = ('LOCALAPPDATA', 'APPDATA', 'USERPROFILE')


def shown(parts, env=os.environ):
    """A command as Tools > AI assistant... shows it: paths in the user's own folders as %LOCALAPPDATA%\\..., so a
    screenshot of it does not carry the Windows user name (the dialog's Copy still gives the real command)."""
    roots = [(env[k].rstrip('\\'), '%' + k + '%') for k in SHOWN_ROOTS if env.get(k)]
    out = []
    for part in parts:
        for root, name in roots:
            if part.lower().startswith(root.lower() + '\\'):
                part = name + part[len(root):]
                break
        out.append(part)
    return out


def register(url, session, root):
    """A hub starting: findable again if the user allowed assistants before."""
    if allowed():
        set_allowed(True, url, session, root, advanced=advanced())


def unregister(root):
    value = _read()
    if str(root) in (value.get('editors') or {}):
        del value['editors'][str(root)]
        _write(value)


class Calls:
    """Calls waiting for the page, and the page's answers. One project server has one of these (CALLS).

    Each load of the editor's page asks with its own id (agent.js PAGE). Only the newest load that is still there
    takes calls: when a page is reloaded, the old load's long poll is still waiting here (the server does not know its
    socket is gone until it writes to it), and a call handed to it would never run. So a new page id wakes the older
    loads' asks and they leave empty-handed ({superseded: True}); an older load that is really open (a second tab)
    keeps asking now and then, and takes over when the newer one is gone. An ask can also say how to tell that its
    connection is closed (gone): it then never takes a call."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._cond = threading.Condition()
        self._waiting = []                 # calls no page has taken yet
        self._taken = {}                   # id -> a call a page is running
        self._asking = 0                   # pages waiting in next() right now
        self._asked = float('-inf')        # when a page last asked
        self._pages = {}                   # page id -> {order, asked, asking}: the page loads that asked lately
        self._loads = 0                    # page loads seen (their order)
        self.last_call = None              # when an assistant last called (the dialog's "connected")

    def page_open(self):
        with self._cond:
            return self._asking > 0 or self._clock() - self._asked < PAGE_GONE

    def _newest(self):
        """The newest page load that is still there (asking, asked lately, or running a call). A load that went quiet
        keeps its place in the order: back (a background tab the browser slowed down), it is still the older one."""
        now, running = self._clock(), {job.get('page') for job in self._taken.values()}
        there = [p for p, v in self._pages.items() if v['asking'] or now - v['asked'] < PAGE_GONE or p in running]
        return max(there, key=lambda p: self._pages[p]['order'], default=None)

    def call(self, op, args, timeout):
        """Run `op` in the page and return {ok, value} or {ok: False, error}. Raises PageClosed, TimeoutError,
        PermissionError (an advanced tool the user has not allowed)."""
        if op not in OPS:
            raise ValueError('Unknown editor call: %s' % op)
        inner = [c.get('op') for c in args.get('calls', []) if isinstance(c, dict)] if op == 'batch' else []
        if op == 'batch' and (not isinstance(args.get('calls'), list) or not 0 < len(inner) == len(args['calls']) <= MAX_BATCH
                              or any(o not in OPS or o == 'batch' for o in inner)):
            raise ValueError('batch: 1 to %d calls of the other operations.' % MAX_BATCH)
        for o in [op] + inner:
            if o in ADVANCED and not advanced():
                raise PermissionError('%s is an advanced tool: the user allows those in Tools > AI assistant... '
                                      '(Allow advanced tools).' % o)
        self.last_call = time.time()
        if not self.page_open():
            raise PageClosed('No editor page is open for this project. Open the project in DeusEdix.')
        job = dict(id=uuid.uuid4().hex, op=op, args=args, done=threading.Event(), result=None, page=None)
        with self._cond:
            if len(self._waiting) >= MAX_WAITING:
                raise RuntimeError('Too many calls are waiting for the editor: wait for their answers.')
            self._waiting.append(job)
            self._cond.notify_all()
        if not job['done'].wait(timeout):
            with self._cond:
                if job in self._waiting:
                    self._waiting.remove(job)
                self._taken.pop(job['id'], None)
            raise TimeoutError('The editor did not finish "%s" in %d s.' % (op, timeout))
        return job['result']

    def next(self, wait=POLL, page=None, gone=None):
        """The page asking for a call: {id, op, args}; None when none came within `wait` seconds or the asking
        connection is gone (gone() true); {superseded: True} when a newer load of the page asks too (page: the
        load's id; None for a page that does not say, which is never set aside)."""
        with self._cond:
            self._asking += 1
            info = None
            if page is not None:
                info = self._pages.get(page)
                if info is None:
                    self._loads += 1
                    info = self._pages[page] = dict(order=self._loads, asked=self._clock(), asking=0)
                    if len(self._pages) > MAX_PAGES:       # the oldest loads that are not asking are forgotten
                        for p in sorted(self._pages, key=lambda p: self._pages[p]['order'])[:-MAX_PAGES]:
                            if not self._pages[p]['asking']:
                                del self._pages[p]
                info['asking'] += 1
                if self._asking > 1:
                    self._cond.notify_all()        # older loads waiting now see this one and step aside
            try:
                end, closed = self._clock() + wait, False
                while True:
                    if page is not None and self._newest() != page:
                        return dict(superseded=True)
                    if self._waiting:
                        if gone is not None and gone():
                            closed = True          # nobody would read what is sent: leave the call to a live page
                            return None
                        job = self._waiting.pop(0)
                        job['page'] = page
                        self._taken[job['id']] = job
                        return dict(id=job['id'], op=job['op'], args=job['args'])
                    left = end - self._clock()
                    if left <= 0:
                        return None
                    self._cond.wait(left)
            finally:
                self._asking -= 1
                if not closed:                     # a closed connection says nothing about an open page
                    self._asked = self._clock()
                if info is not None:
                    info['asking'] -= 1
                    info['asked'] = float('-inf') if closed else self._asked
                if closed:
                    self._cond.notify_all()        # an older load waiting now may take the call

    def give_back(self, ident):
        """A call that was taken but could not be sent to the page (its connection broke): first in line again."""
        with self._cond:
            job = self._taken.pop(ident, None)
            if job is None or job['done'].is_set():
                return False
            job['page'] = None
            self._waiting.insert(0, job)
            self._cond.notify_all()
        return True

    def result(self, ident, ok, value=None, error=''):
        """The page's answer. False: no call waits for it (it timed out)."""
        with self._cond:
            job = self._taken.pop(ident, None)
            self._asked = self._clock()
            if job is not None and job.get('page') in self._pages:
                self._pages[job['page']]['asked'] = self._asked
        if job is None:
            return False
        job['result'] = dict(ok=True, value=value) if ok else dict(ok=False, error=str(error or 'The call failed.'))
        job['done'].set()
        return True


CALLS = Calls()
