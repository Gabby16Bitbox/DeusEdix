"""Provenance checks for reusable, baked authoring prefabs.

Nesting and browser order do not change the built scene. All other non-empty
edits must match the build receipt; a clean original map can be copied directly.
"""
import hashlib
import json
from pathlib import Path

import atomicfile


def engine_edits(edits):
    if not isinstance(edits, dict):
        raise ValueError('Invalid prefab authoring state.')

    def normal(value):
        if isinstance(value, dict):
            return {k: normal(v) for k, v in value.items()}
        if isinstance(value, list):
            return [normal(v) for v in value]
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return value

    return {k: normal(v) for k, v in edits.items()
            if k not in ('nests', 'order') and v not in ({}, [], None)}


def _digest(value):
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def _signature(path):
    path = Path(path)
    st = path.stat()
    return {'path': str(path.resolve()), 'size': st.st_size, 'mtime': st.st_mtime_ns}


def _receipt(output):
    return Path(output).with_suffix('.prefab-build.json')


def _file_digest(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def source_state(source):
    return {'signature': _signature(source), 'sha': _file_digest(source)}


def record_build(output, edits, source, expected_source=None):
    """Call only after a successful build, with the edits captured BEFORE it."""
    output, source = Path(output), Path(source)
    state = source_state(source)
    if expected_source is not None and state != expected_source:
        raise ValueError('The source changed during Rebuild')
    receipt = {'version': 1, 'output': _signature(output), 'output_sha': _file_digest(output),
               'source': state['signature'], 'source_sha': state['sha'],
               'edits_sha': _digest(engine_edits(edits))}
    atomicfile.write_json(_receipt(output), receipt)


def require_current(output, edits, draft, folder, mesh_version, source, original=False):
    """Refuse stale/unsaved snapshots; never rebuild or save a user's map here."""
    output, folder, source = Path(output), Path(folder), Path(source)
    saved = engine_edits(edits)
    if saved != engine_edits(draft):
        raise ValueError('Rebuild first: the selection has unsaved geometry or property changes.')
    if not original or saved:
        try:
            receipt = json.loads(_receipt(output).read_text(encoding='utf-8'))
            valid = (isinstance(receipt, dict) and receipt.get('version') == 1
                     and receipt.get('output') == _signature(output)
                     and receipt.get('output_sha') == _file_digest(output)
                     and receipt.get('source') == _signature(source)
                     and receipt.get('source_sha') == _file_digest(source)
                     and receipt.get('edits_sha') == _digest(saved))
        except (OSError, ValueError, TypeError):
            valid = False
        if not valid:
            raise ValueError('Rebuild first: save the current geometry and transforms before making a prefab.')
    expected = '%s-%d-%d-m%d' % (output, output.stat().st_mtime_ns, output.stat().st_size, mesh_version)
    try:
        current = (folder / 'stamp.txt').read_text() == expected
    except OSError:
        current = False
    if not current:
        raise ValueError('Reload the map after Rebuild: its displayed geometry is out of date.')
