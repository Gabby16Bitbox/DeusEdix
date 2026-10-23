"""Explicit distributable inventory for the optional local geometry tool.

Runs, map copies, caches and diagnostic evidence are runtime data and are never
discovered or copied into a release or into another project's application code.
"""
import json
from pathlib import Path, PurePosixPath
import re


def _no_links(path):
    for part in (path, *path.parents):
        if part.exists() or part.is_symlink():
            if part.is_symlink() or getattr(part.stat(), 'st_file_attributes', 0) & 1024:
                raise ValueError('Experimental tool code cannot contain links: ' + str(part))


def distribution_files(root, required=False):
    """Yield only explicitly listed, application-owned code and our native host."""
    root = Path(root)
    _no_links(root)
    manifest = root / 'distribution.json'
    if not manifest.is_file():
        if required or root.exists():
            raise ValueError('Missing experimental tool distribution manifest: ' + str(manifest))
        return
    _no_links(manifest)
    data = json.loads(manifest.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or set(data) != {'version', 'files'} or data['version'] != 1 or not isinstance(data['files'], list):
        raise ValueError('Invalid experimental tool distribution manifest.')
    names = data['files']
    if any(not isinstance(name, str) for name in names) or len(names) != len(set(names)):
        raise ValueError('Invalid or repeated experimental tool filename.')
    needed = {'app.py', 'worker_bridge.py', 'implementation.py', 'ui.html', 'bin/UCMapKitHost.exe'}
    if not needed.issubset(names):
        raise ValueError('Incomplete experimental tool distribution manifest.')
    for name in sorted(names):
        relative = PurePosixPath(name)
        if (relative.is_absolute() or relative.as_posix() != name or '\\' in name
                or any(part in {'', '.', '..'} for part in relative.parts)):
            raise ValueError('Invalid experimental tool relative path: ' + name)
        root_python = len(relative.parts) == 1 and re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*\.py', name) and not name.startswith('test_')
        own_native = (len(relative.parts) == 2 and relative.parts[0] == 'source'
                      and re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*\.(?:h|cpp)', relative.name))
        if not (root_python or own_native or name in {'ui.html', 'bin/UCMapKitHost.exe'}):
            raise ValueError('Unsupported experimental tool payload file: ' + name)
        file = root.joinpath(*relative.parts)
        _no_links(file)
        if not file.is_file():
            raise ValueError('Missing experimental tool payload file: ' + name)
        yield file, relative
    yield manifest, PurePosixPath('distribution.json')
