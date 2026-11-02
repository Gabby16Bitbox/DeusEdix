"""Prefer fast cores for private compiler workers on heterogeneous Windows CPUs.

Use Windows CPU Sets (soft placement), never realtime priority, hard affinity or
machine power settings. Existing CPU-set assignments and affinity limits win.
Unsupported APIs/topologies simply keep the normal Windows scheduling policy.
"""
import os
import struct
import threading
from contextlib import contextmanager
from functools import wraps

# work started from a thread inside background() (the Pieces scan): its engine processes run below normal priority
# and keep Windows' own core choice, so the programs the person is using come first (1 Nov 2026: the mouse
# stuttered while three scan engines held the fast cores)
_local = threading.local()


@contextmanager
def background():
    was = getattr(_local, 'background', False)
    _local.background = True
    try:
        yield
    finally:
        _local.background = was


def _in_background(process_handle):
    """In background(): the process below normal priority, and True (no fast cores asked for it)"""
    if not getattr(_local, 'background', False):
        return False
    if os.name == 'nt' and process_handle is not None:
        try:
            import ctypes as c
            from ctypes import wintypes as w
            k = c.WinDLL('kernel32', use_last_error=True)
            k.SetPriorityClass.argtypes = [w.HANDLE, w.DWORD]
            k.SetPriorityClass.restype = w.BOOL
            k.SetPriorityClass(w.HANDLE(process_handle), 0x4000)      # BELOW_NORMAL_PRIORITY_CLASS
        except (AttributeError, OSError, ValueError, TypeError):
            pass
    return True


def _enabled():
    return os.name == 'nt' and os.environ.get('DEUSEDIX_BUILD_CPU', 'auto').lower() != 'off'


def _select(data, mask):
    rows = []
    at = 0
    while at < len(data):
        if at + 8 > len(data):
            return []
        size, kind = struct.unpack_from('<II', data, at)
        if size < 8 or at + size > len(data):
            return []
        if kind == 0:
            if size < 32:
                return []
            ident, group, logical, _core, _cache, _numa, efficiency, flags = struct.unpack_from('<IH6B', data, at + 8)
            # Keep multi-group policies with Windows; this path targets ordinary
            # desktop hybrid CPUs. Reserved CPUs assigned elsewhere are excluded.
            if group:
                return []
            if mask & (1 << logical) and not (flags & 8) and (not flags & 2 or flags & 4):
                rows.append((ident, efficiency))
        at += size
    if not rows or len({eff for _, eff in rows}) < 2:
        return []
    fastest = max(eff for _, eff in rows)
    return [ident for ident, eff in rows if eff == fastest]


def _candidates(k, handle):
    import ctypes as c
    from ctypes import wintypes as w
    previous = k.GetProcessDefaultCpuSets
    previous.argtypes = [w.HANDLE, c.POINTER(w.ULONG), w.ULONG, c.POINTER(w.ULONG)]
    previous.restype = w.BOOL
    count = w.ULONG()
    if not previous(handle, None, 0, c.byref(count)) or count.value:
        return []
    affinity = k.GetProcessAffinityMask
    affinity.argtypes = [w.HANDLE, c.POINTER(c.c_size_t), c.POINTER(c.c_size_t)]
    affinity.restype = w.BOOL
    process_mask, system_mask = c.c_size_t(), c.c_size_t()
    if not affinity(handle, c.byref(process_mask), c.byref(system_mask)):
        return []
    query = k.GetSystemCpuSetInformation
    query.argtypes = [c.c_void_p, w.ULONG, c.POINTER(w.ULONG), w.HANDLE, w.ULONG]
    query.restype = w.BOOL
    size = w.ULONG()
    query(None, 0, c.byref(size), handle, 0)
    if not 0 < size.value <= 1024 * 1024:
        return []
    buffer = c.create_string_buffer(size.value)
    if not query(buffer, len(buffer), c.byref(size), handle, 0) or size.value > len(buffer):
        return []
    return _select(buffer.raw[:size.value], process_mask.value & system_mask.value)


def prefer_performance(process_handle=None):
    """Only call for a dedicated build process, or a newly spawned SDK worker.

    With no handle, affect this disposable build worker only. The editor server
    calls this with its child handle, so the server/UI scheduling is unchanged.
    Returns the selected CPU-set IDs, or [] when Windows retains its defaults.
    """
    if _in_background(process_handle):
        return []
    if not _enabled():
        return []
    try:
        import ctypes as c
        from ctypes import wintypes as w
        k = c.WinDLL('kernel32', use_last_error=True)
        k.GetCurrentProcess.restype = w.HANDLE
        handle = w.HANDLE(process_handle) if process_handle is not None else k.GetCurrentProcess()
        ids = _candidates(k, handle)
        if not ids:
            return []
        assign = k.SetProcessDefaultCpuSets
        assign.argtypes = [w.HANDLE, c.POINTER(w.ULONG), w.ULONG]
        assign.restype = w.BOOL
        values = (w.ULONG * len(ids))(*ids)
        return ids if assign(handle, values, len(ids)) else []
    except (AttributeError, OSError, ValueError, TypeError, struct.error):
        return []


def _prefer_thread():
    """Return a restoration callback only when we assigned this worker thread."""
    if not _enabled() or getattr(_local, 'background', False):
        return None
    try:
        import ctypes as c
        from ctypes import wintypes as w
        k = c.WinDLL('kernel32', use_last_error=True)
        k.GetCurrentThread.restype = w.HANDLE
        k.GetCurrentProcess.restype = w.HANDLE
        thread = k.GetCurrentThread()
        previous = k.GetThreadSelectedCpuSets
        previous.argtypes = [w.HANDLE, c.POINTER(w.ULONG), w.ULONG, c.POINTER(w.ULONG)]
        previous.restype = w.BOOL
        count = w.ULONG()
        if not previous(thread, None, 0, c.byref(count)) or count.value:
            return None
        ids = _candidates(k, k.GetCurrentProcess())
        if not ids:
            return None
        assign = k.SetThreadSelectedCpuSets
        assign.argtypes = [w.HANDLE, c.POINTER(w.ULONG), w.ULONG]
        assign.restype = w.BOOL
        values = (w.ULONG * len(ids))(*ids)
        if assign(thread, values, len(ids)):
            return lambda: assign(thread, None, 0)
    except (AttributeError, OSError, ValueError, TypeError, struct.error):
        pass
    return None


@contextmanager
def performance_thread():
    restore = _prefer_thread()
    try:
        yield
    finally:
        if restore is not None:
            restore()


def performance_work(function):
    """Bound the preference to this synchronous preview/build task, even on error."""
    @wraps(function)
    def run(*args, **kwargs):
        with performance_thread():
            return function(*args, **kwargs)
    return run
