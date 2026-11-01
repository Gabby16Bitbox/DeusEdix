"""Explicit, request-local caches for one generated-map build.

No module-global game data: keys expire when the scope exits. References and
actors return defensive copies; the class-defaults reader has a read-only
contract inside a build scope, matching its current build callers.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from pathlib import Path
import json

_current = ContextVar('deusedix_build_cache', default=None)


@contextmanager
def scope():
    token = _current.set({})
    try:
        yield
    finally:
        _current.reset(token)


def memo(key, factory, copy=False):
    cache = _current.get()
    if cache is None:
        return factory()
    if key not in cache:
        cache[key] = factory()
    return deepcopy(cache[key]) if copy else cache[key]


def file_key(path):
    path = Path(path)
    stat = path.stat()
    # Lexical aliases may have separate entries. Resolving junctions on every
    # lookup is costly and unnecessary for correctness. File identity also
    # detects an atomic replacement preserving the previous size and date.
    return str(path.absolute()), stat.st_dev, stat.st_ino, stat.st_mtime_ns, stat.st_size


def json_file(path):
    # Class dictionaries are read by the existing code. Defensive copies here
    # are costly: callers that mutate defaults must continue obtaining their
    # own copy. Outside a build scope this is exactly the original disk read.
    return memo(('json', *file_key(path)), lambda: json.loads(Path(path).read_text(encoding='utf-8')))


def actor(path, name, parse):
    if _current.get() is None:
        for row in parse(Path(path).read_text(encoding='latin1', errors='replace')):
            if row['name'] == name:
                return row
        raise KeyError(name)
    def index():
        result = {}
        for row in parse(Path(path).read_text(encoding='latin1', errors='replace')):
            result.setdefault(row['name'], row)
        return result
    actors = memo(('actors', parse, *file_key(path)), index)
    return deepcopy(actors[name])


def reference(map_name, source, factory):
    if _current.get() is None:
        return factory()
    return memo(('reference', map_name, *file_key(source)), factory, copy=True)
