"""DeusEdix in the web browser (no window of its own, deusedix.py browser()): it runs while one of its pages
is open, and closes by itself when the last one is closed (Gabby, 17 Oct 2026: no message box to press OK
on, that one could close by mistake).

Every page of the hub and of the projects says it is open: GET /alive?tab=<id> every few seconds (on the
hub's address, as the projects run on ports of their own), and POST /bye?tab=<id> when it goes away
(navigator.sendBeacon on pagehide). A page that only moves on (a reload, the hub to a project) says
alive again at once from its new page.
"""
import re
import threading
import time

STALE = 150          # browsers slow a hidden tab's timers down to once a minute: never closed for that
GRACE = 12           # after the last page went away: a reload or the next page has said alive by then
_TAB = re.compile(r'[A-Za-z0-9_-]{1,40}')
_tabs = {}
_lock = threading.Lock()
_seen = threading.Event()


def alive(tab):
    if not isinstance(tab, str) or not _TAB.fullmatch(tab):
        return
    with _lock:
        _tabs[tab] = time.monotonic()
    _seen.set()


def bye(tab):
    if not isinstance(tab, str) or not _TAB.fullmatch(tab):
        return
    with _lock:
        _tabs.pop(tab, None)


def open_pages():
    now = time.monotonic()
    with _lock:
        for tab, seen in list(_tabs.items()):
            if now - seen > STALE:
                del _tabs[tab]
        return len(_tabs)


def wait_for_first(timeout):
    """True when a page said alive within `timeout` seconds."""
    return _seen.wait(timeout)


def wait_until_closed(poll=2.0):
    """Returns when no page has been open for GRACE seconds."""
    empty_since = None
    while True:
        time.sleep(poll)
        if open_pages():
            empty_since = None
            continue
        empty_since = empty_since or time.monotonic()
        if time.monotonic() - empty_since >= GRACE:
            return


# the script every page gets in browser mode (project_server.page)
PAGE_SCRIPT = '''<script>(() => {
const hub = String((window.__projectContext || {}).homeUrl || (location.origin + '/')).replace(/\\/?$/, '/');
const tab = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
const alive = () => fetch(hub + 'alive?tab=' + tab, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
alive(); setInterval(alive, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) alive(); });
addEventListener('pagehide', () => { try { navigator.sendBeacon(hub + 'bye?tab=' + tab); } catch (e) { /* closing */ } });
})();</script>'''
