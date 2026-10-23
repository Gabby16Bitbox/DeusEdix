"""Editor-only actor activation. Disabled actors are absent from the playable map.

The edits remain intact; a build-bound sidecar retains their editor representation.
This is independent of bHidden (an engine property) and editor visibility.
"""
import hashlib
import json
import re
from pathlib import Path

import t3d


def names(edits):
    disabled = edits.get('disabled', {})
    if not isinstance(disabled, dict):
        raise ValueError('Disabled objects must be a name-to-boolean object.')
    for name, value in disabled.items():
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name) or not isinstance(value, bool):
            raise ValueError('Each disabled object needs a valid actor name and a boolean.')
    return {name for name, value in disabled.items() if value}


def commands(edits):
    disabled = names(edits)
    if not disabled:
        return []
    return [r'MAP EXPORT FILE="..\Output\editor-enabled.t3d"',
            r'UC_MESHES ..\Output\editor-enabled-meshes.jsonl'] + ['UC_DEL ' + name for name in sorted(disabled)]


def sidecar(map_path):
    return Path(map_path).with_suffix('.disabled-actors.json')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(map_path, run_folder, edits):
    """Publish only after the runtime map exists; stale sidecars never match a new build."""
    disabled = names(edits)
    dst = sidecar(map_path)
    if not disabled:
        dst.unlink(missing_ok=True)
        return
    output = Path(run_folder) / 'Output'
    text = (output / 'editor-enabled.t3d').read_text(encoding='latin1')
    actors = [a['raw'] for a in t3d.actors(text) if a['name'] in disabled]
    # This parser only converts the engine's mesh dump; it does not open a game session.
    import data
    meshes = data.parse_meshes(output / 'editor-enabled-meshes.jsonl')
    payload = dict(version=1, runtime_sha256=digest(map_path), actors=actors,
                   meshes={name: value for name, value in meshes.items() if name in disabled})
    dst.write_text(json.dumps(payload), encoding='utf-8')


def load(map_path):
    """Only restore representations belonging to this exact runtime build."""
    path = sidecar(map_path)
    if not path.exists() or not Path(map_path).exists():
        return {}
    try:
        result = json.loads(path.read_text(encoding='utf-8'))
        if result.get('version') != 1 or result.get('runtime_sha256') != digest(map_path):
            return {}
        return result
    except (OSError, ValueError, TypeError, AttributeError):
        return {}


def editor_text(text, saved):
    """Real actors win if a name has been reused; never replace the current actor."""
    have = {a['name'] for a in t3d.actors(text)}
    extra = [a['raw'] for raw in saved.get('actors', []) for a in t3d.actors(raw) if a['name'] not in have]
    return text + '\n' + '\n'.join(extra) if extra else text
