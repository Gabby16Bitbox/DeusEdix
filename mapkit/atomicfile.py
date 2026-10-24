"""Replace authored documents only after a complete durable sibling write.

The same swap keeps hard links safe: a private System folder is mostly hard links to the game's own files, and
writing into one of them would change the game's file too. Replacing the name leaves the game's file as it was."""
import json
import os
from pathlib import Path
import shutil
import uuid


def copy_file(source, path):
    """shutil.copy2 onto `path` as a new file: copied beside it, then swapped in (path may be a hard link)."""
    path = Path(path)
    temporary = path.with_name('.' + path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


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
