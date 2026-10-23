"""Small UI preferences independent of a worker's temporary localhost port."""
import json
import os
from pathlib import Path
import threading
import uuid

import settings

_lock = threading.Lock()
GLOBAL = {'deusedix.prefs', 'deusedix.workspace.v1', 'deusedix.inspector.folds'}


def shared_key(key):
    return key in GLOBAL or key.startswith('ucmap.')


def _read(path):
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def paths():
    return settings.APP_ROOT / '.deusedix-ui.json', settings.PROJECT / '.deusedix-project-ui.json'


def load(ident=None):
    shared, private = paths()
    prefix = 'deusedix.project:' + str(ident) + ':'
    values = {k: v for k, v in _read(shared).items() if shared_key(k) and isinstance(v, str)}
    if ident:
        values.update({k: v for k, v in _read(private).items() if k.startswith(prefix) and isinstance(v, str)})
    return values


def save(values, ident=None):
    if not isinstance(values, dict) or len(json.dumps(values)) > 2 * 1024 * 1024:
        raise ValueError('Invalid project preferences.')
    prefix = 'deusedix.project:' + str(ident) + ':'
    shared, private = {}, {}
    for key, value in values.items():
        if not isinstance(key, str) or not isinstance(value, str) or len(key) > 256:
            raise ValueError('Invalid preference value.')
        if shared_key(key):
            shared[key] = value
        elif ident and key.startswith(prefix):
            private[key] = value
        else:
            raise ValueError('Preference belongs to another project.')
    with _lock:
        for path, content in zip(paths(), (shared, private)):
            if path.name == '.deusedix-project-ui.json' and not ident:
                continue
            tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
            try:
                tmp.write_text(json.dumps(content, ensure_ascii=False), encoding='utf-8')
                os.replace(tmp, path)
            finally:
                tmp.unlink(missing_ok=True)

