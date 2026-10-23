"""A test map in the game's project folder, without committing editor changes."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import threading
import uuid

import settings

ROOT = Path(__file__).resolve().parents[1] / 'out' / '.play-preview'
_LOCK = threading.RLock()
_DIGEST = re.compile(r'[a-f0-9]{64}')
_IDENT = re.compile(r'[a-f0-9]{32}')


def _hash(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _current(path):
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise RuntimeError('The Play destination is not an ordinary map file; no map was overwritten.')
    return _hash(path) if path.exists() else None


def _entry(raw):
    try:
        entry = json.loads(raw)
        if (not isinstance(entry, dict) or entry.get('version', 1) != 1
                or not isinstance(entry.get('id'), str) or not _IDENT.fullmatch(entry['id'])
                or not isinstance(entry.get('target'), str)
                or not isinstance(entry.get('staged'), str) or not _DIGEST.fullmatch(entry['staged'])
                or 'previous' not in entry
                or (entry['previous'] is not None and (not isinstance(entry['previous'], str)
                                                      or not _DIGEST.fullmatch(entry['previous'])))):
            raise ValueError('Invalid manifest fields')
        target = Path(entry['target'])
        if (not target.is_absolute() or target.is_symlink() or target.resolve().parent != settings.MAPS_DIR.resolve()
                or target.suffix.lower() != '.dx'):
            raise ValueError('Invalid destination')
        backup = ROOT / (entry['id'] + '.dx')
        if backup.is_symlink() or backup.resolve().parent != ROOT.resolve():
            raise ValueError('Invalid backup')
        return entry, target, backup
    except (ValueError, TypeError, KeyError, OSError) as exc:
        raise RuntimeError('Invalid Play preview journal; no files were changed. Its recovery files have been kept.') from exc


def _same_journal(manifest, raw):
    if not manifest.is_file() or manifest.is_symlink() or manifest.read_bytes() != raw:
        raise RuntimeError('The Play recovery journal changed; no map was overwritten.')


def _atomic_copy(source, target, expected, guard=lambda: None, content_hash=None):
    """Copy off to the side, then replace a still-matching destination in one step."""
    temporary = target.with_name('.' + target.name + '.' + uuid.uuid4().hex + '.play-tmp')
    try:
        shutil.copy2(source, temporary)
        with temporary.open('r+b') as stream:
            os.fsync(stream.fileno())
        if content_hash is not None and _hash(temporary) != content_hash:
            raise RuntimeError('The source map changed while preparing Play; no map was overwritten.')
        guard()
        if _current(target) != expected:
            raise RuntimeError('The Play destination changed outside DeusEdix; no map was overwritten.')
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def _write_journal(entry):
    manifest = ROOT / 'active.json'
    temporary = ROOT / (entry['id'] + '.journal-tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(json.dumps(entry).encode('utf-8'))
            stream.flush()
            os.fsync(stream.fileno())
        # Windows rename fails rather than overwriting an existing recovery journal.
        if os.name == 'nt':
            os.rename(temporary, manifest)
        else:
            os.link(temporary, manifest)
            temporary.unlink()
    finally:
        temporary.unlink(missing_ok=True)
    return manifest.read_bytes()


def restore():
    """Restore only the exact file staged by us; keep externally modified files."""
    with _LOCK:
        manifest = ROOT / 'active.json'
        if not manifest.exists():
            return []
        if manifest.is_symlink():
            raise RuntimeError('Invalid Play preview journal; no files were changed.')
        raw = manifest.read_bytes()
        entry, target, backup = _entry(raw)
        current = _current(target)
        if current not in (entry['staged'], entry['previous']):
            raise RuntimeError('The Play copy changed outside DeusEdix. Its backup has been kept; no map was overwritten.')
        if entry['previous'] is not None:
            if not backup.is_file() or _hash(backup) != entry['previous']:
                raise RuntimeError('The Play backup is missing or changed; no map was overwritten.')
            # previous is valid too: interruption before staging or after restoring.
            if current != entry['previous']:
                _atomic_copy(backup, target, entry['staged'], lambda: _same_journal(manifest, raw), entry['previous'])
        elif current is not None:
            _same_journal(manifest, raw)
            if _current(target) != entry['staged']:
                raise RuntimeError('The Play copy changed outside DeusEdix; no map was removed.')
            target.unlink()
        _same_journal(manifest, raw)
        manifest.unlink()
        backup.unlink(missing_ok=True)
        return ['Play copy discarded; the previous installed map was restored.']


def stage(source, map_name):
    if (not isinstance(map_name, str) or not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_-]{0,127}', map_name)
            or re.fullmatch(r'(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])', map_name)):
        raise ValueError('Invalid preview map name.')
    with _LOCK:
        restore()
        source = Path(source)
        if not source.is_file():
            raise ValueError('Rebuild the map before playing.')
        target = settings.MAPS_DIR / (map_name + '.dx')
        if target.is_symlink() or target.resolve().parent != settings.MAPS_DIR.resolve() or source.resolve() == target.resolve():
            raise ValueError('Invalid preview map destination.')
        ROOT.mkdir(parents=True, exist_ok=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        ident = uuid.uuid4().hex
        previous = _current(target)
        if previous is not None:
            backup = ROOT / (ident + '.dx')
            _atomic_copy(target, backup, None, content_hash=previous)
            if _hash(backup) != previous or _current(target) != previous:
                raise RuntimeError('The installed map changed while preparing Play; no map was overwritten.')
        staged_hash = _hash(source)
        entry = dict(version=1, id=ident, target=str(target.resolve()), previous=previous, staged=staged_hash)
        raw = _write_journal(entry)
        # Journal before replacing the test map so an interrupted launch is recoverable.
        def guard():
            _same_journal(ROOT / 'active.json', raw)
            if _hash(source) != staged_hash:
                raise RuntimeError('The rebuild changed while preparing Play. Try Play again.')
        _atomic_copy(source, target, previous, guard, staged_hash)
        return ['Prepared a temporary Play copy; the editable map stays in the project.']
