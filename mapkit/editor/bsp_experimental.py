"""Open the optional BSP lab using a frozen, private map copy.

This adapter never imports the compiler and never publishes a rebuilt map. The
normal editor keeps ownership of its source, overlays and last successful build.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid


def _sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def _snapshot(paths):
    result = {}
    for item in paths:
        path = Path(item).resolve()
        if path.exists() and not path.is_file():
            raise ValueError('An experimental map context is no longer a file: ' + str(path))
        result[str(path)] = _sha(path) if path.is_file() else None
    return result


def _unchanged(snapshot):
    if _snapshot(snapshot) != snapshot:
        raise ValueError('The map or its editor settings changed. Open the experimental tool again.')


def _private(root, path):
    """Do not let a project junction redirect the handoff outside this kit."""
    root, path = Path(root).absolute(), Path(path).absolute()
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('The experimental tool must remain inside this project.')
    for part in (path, *path.parents):
        if part.exists() or part.is_symlink():
            stat = os.lstat(part)
            if part.is_symlink() or getattr(stat, 'st_file_attributes', 0) & 0x400:
                raise ValueError('The experimental handoff cannot use linked folders.')
        if part == root:
            break
    return path


def validate_request(body):
    if not isinstance(body, dict) or set(body) - {'script', 'brush'}:
        raise ValueError('Choose a map already open in this project.')
    script = body.get('script')
    if not isinstance(script, str) or not script or len(script) > 128:
        raise ValueError('Choose a map already open in this project.')
    brush = body.get('brush')
    if brush is not None and (not isinstance(brush, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]{0,127}', brush)):
        raise ValueError('Choose one existing brush, or open the tool without a selection.')
    return script, brush


def launch(source, *, kit_dir, python_command, label, brush=None, context_paths=()):
    """Run under the editor's project operation and lock; inputs are server-owned."""
    validate_request({'script': 'handoff', 'brush': brush})
    kit_dir = Path(kit_dir).resolve()
    payload = _private(kit_dir, kit_dir / 'experimental_bsp')
    app = _private(kit_dir, payload / 'app.py')
    if not app.is_file():
        raise ValueError('The experimental BSP tool is not installed in this project. Update DeusEdix and reopen the project.')
    source = Path(source).resolve()
    if source.suffix.lower() != '.dx' or not source.is_file():
        raise ValueError('Rebuild this map once before opening the experimental tool.')
    frozen = _snapshot((source, *context_paths))
    root = _private(kit_dir, payload / 'handoffs')
    root.mkdir(exist_ok=True)
    folder = _private(kit_dir, root / uuid.uuid4().hex)
    folder.mkdir()
    copied = folder / 'source.dx'
    shutil.copyfile(source, copied)
    digest = _sha(copied)
    if digest != frozen[str(source)]:
        raise ValueError('The map changed while its experimental copy was being made.')
    _unchanged(frozen)
    handoff = dict(version=1, source=str(copied), sha256=digest, label=str(label),
                   context_sha256=frozen)
    if brush:
        handoff['brush'] = brush
    request = folder / 'handoff.json'
    with request.open('x', encoding='utf-8') as stream:
        json.dump(handoff, stream, indent=2, allow_nan=False)
        stream.flush()
        os.fsync(stream.fileno())
    _unchanged(frozen)
    with (folder / 'launcher.log').open('xb') as log:
        process = subprocess.Popen(
            [*python_command, str(app), '--handoff', str(request)], cwd=str(payload),
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if process.poll() is not None:
        raise RuntimeError('The experimental tool could not start. See ' + str(folder / 'launcher.log'))
    return dict(ok=True, started=True, message='Experimental BSP opened a private copy of the last rebuilt map. '
                'Saved edits are included only after Rebuild; this tool does not replace or install your map.')


def open_for_editor(editor, body):
    """Resolve the current project's map; never accept a client filesystem path."""
    script, brush = validate_request(body)
    map_name = editor.map_of(script)
    if (editor.tutorial.is_script(script) or editor.tutorial.is_map(map_name)
            or getattr(editor.settings, 'PROJECT_KIND', '') == 'tutorial'):
        raise ValueError('The experimental BSP tool is unavailable during the temporary tutorial.')
    if editor.game_running() or editor.PLAY.get('active') or editor.LIVE.get('active'):
        raise ValueError('Stop Play before opening the experimental BSP tool.')
    editor.project_server.ensure_runtime()
    context = [editor.edits_path(script), editor.KIT / 'packages.json',
               editor.PROJECT / 'deusedix.json', editor.PROJECT / 'deusedix-project.json']
    if editor.is_dx(script):
        source = editor.dxmaps.shown(map_name)
        context += [editor.dxmaps.source(map_name), editor.dxmaps._info_path(map_name),
                    editor.dxmaps._authoring_path(map_name).with_suffix('.json'),
                    editor.dxmaps.MOD_MAPS / (map_name + '.dx')]
    else:
        source = editor.data.OUT / (map_name + '.dx')
        context += [editor.KIT / 'maps' / (script + '.py')]
    return launch(source, kit_dir=editor.KIT, python_command=editor.settings.python(),
                  label=map_name, brush=brush, context_paths=context)
