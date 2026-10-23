"""Replace authored documents only after a complete durable sibling write."""
import json
import os
from pathlib import Path
import uuid


def write_text(path, content, encoding='utf-8'):
    path = Path(path)
    # Encode before opening anything: bad input cannot damage a saved document.
    raw = content.encode(encoding)
    temporary = path.with_name('.' + path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def write_json(path, value, *, indent=1, ensure_ascii=True):
    write_text(path, json.dumps(value, indent=indent, ensure_ascii=ensure_ascii))
