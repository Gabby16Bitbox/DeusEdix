"""The interactive tutorial (Help > Interactive tutorial; the page's side is static/tutorial.js).

A training map in the look of the game's own, built on the user's PC from a script of ours
(tools/mapkit/tutorial/tutorial_map.py: our geometry, the game's textures and classes by name), so no
map is ever shipped. The guide is Dr. Elias Hale (tutorial/guide.json, a Character Creator recipe);
his InfoLinks in the game are a story of the map (tutorial/story.json); the editor's steps are in
tutorial/tutorial.json.

  start(build, session=None)   a clean temporary exercise, or resume the current session token
  end(session)                discard that exercise without affecting a newer session
  reset(session=None)         invalidate the session and restore the stock map/story
  portrait(png)  DeusEdix installed: the guide's InfoLink portrait from the editor's picture of him
                 (64x64, 256 colours) into DeusEdix's package, compiled with the next story Apply
"""
import base64
import copy
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import sys
from pathlib import Path

ED = Path(__file__).resolve().parent
KIT = ED.parent
SRC = KIT / 'tutorial'
SCRIPT = 'deusedix_tutorial'
MAP = '00_DeusEdix_Tutorial'
_ACTIVE = None
_OUTPUTS = ('.dx', '.t3d', '.groups.json', '.disabled-actors.json')
sys.path.insert(0, str(KIT))
import settings  # noqa: E402


def info():
    t = json.loads((SRC / 'tutorial.json').read_text(encoding='utf-8'))
    if t.get('script') != SCRIPT or t.get('map') != MAP:
        raise ValueError('The tutorial template has an unexpected map identity.')
    t['recipe'] = json.loads((SRC / 'guide.json').read_text(encoding='utf-8'))
    t['target'] = getattr(settings, 'TARGET', 'revision')
    t['game'] = getattr(settings, 'GAME_NAME', 'Deus Ex: Revision')
    return t


def published_edits():
    """The authored arrangement is the editor baseline, never a completed exercise."""
    path = SRC / 'layout_defaults.json'
    if not path.is_file():
        return {}
    return copy.deepcopy(json.loads(path.read_text(encoding='utf-8')).get('edits', {}))


def play_start():
    """Every tutorial Play begins at reception, not at the editor camera."""
    return dict(at=[-120, -170, 48], yaw=0, pitch=0)


def is_script(value):
    return value == SCRIPT


def is_map(value):
    return value == MAP


def active_session():
    return _ACTIVE


def require_session(token):
    if not isinstance(token, str) or not _ACTIVE or not secrets.compare_digest(token, _ACTIVE):
        raise ValueError('This training session has ended. Open the tutorial again to start fresh.')
    return _ACTIVE


def _safe(root, path):
    """Check exact deletion/copy targets and reject Windows junctions before traversal."""
    root, path = Path(root).absolute(), Path(path).absolute()
    if path == root or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Tutorial files must remain inside their approved folder.')
    for part in (path, *path.parents):
        if part.exists() or part.is_symlink():
            stat = os.lstat(part)
            if part.is_symlink() or getattr(stat, 'st_file_attributes', 0) & 0x400:
                raise ValueError('Tutorial cleanup cannot follow a linked folder.')
        if part == root:
            break
    return path


def _remove(root, path):
    path = _safe(root, path)
    if path.is_dir():
        # Inspect the tree before deleting anything; never follow reparse points.
        for current, directories, files in os.walk(path, followlinks=False):
            for name in directories + files:
                _safe(root, Path(current) / name)
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def _training_project():
    targets = {'training': 'revision', 'training-revision': 'revision', 'training-vanilla': 'vanilla'}
    return bool(getattr(settings, 'MANAGED_PROJECT', False) and
                getattr(settings, 'PROJECT_KIND', None) == 'tutorial' and
                getattr(settings, 'PROJECT_ID', None) in targets and
                targets[settings.PROJECT_ID] == getattr(settings, 'TARGET', 'revision'))


def available():
    """Only the two target-locked disposable tutorial workers own lifecycle routes."""
    return _training_project()


def _restore_story(t):
    """The stock story is temporary map data; explicitly saved libraries remain untouched."""
    path = _safe(KIT, KIT / 'story' / (MAP + '.json'))
    path.parent.mkdir(parents=True, exist_ok=True)
    stock = (SRC / 'story.json').read_bytes()
    path.write_bytes(stock)
    if not _training_project():
        return False
    import story
    target = _safe(settings.PROJECT, settings.PROJECT / 'src' / settings.PACKAGE / 'Classes' / (story.class_name(MAP) + '.uc'))
    content = story.generate(MAP, json.loads(stock)).replace('\n', '\r\n').encode('latin1', 'replace')
    if target.exists() and target.read_bytes() == content:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return True


def prepare_runtime():
    """Seed the stock temporary story before the first runtime compile, not after it."""
    return _restore_story(info()) if _training_project() else False


def _cleanup():
    t = info()
    targets = [KIT / 'maps' / (SCRIPT + '.edits.json'),
               KIT / 'editor' / 'cache' / MAP, KIT / 'textures' / MAP]
    targets += [KIT / 'out' / (MAP + extension) for extension in _OUTPUTS]
    for target in targets:
        _safe(KIT, target)
    project_maps = Path(settings.PROJECT) / 'maps'
    installed = Path(settings.MAPS_DIR)
    if _training_project():
        for root in (project_maps, installed):
            for extension in _OUTPUTS:
                _safe(root, root / (MAP + extension))
    for target in targets:
        _remove(KIT, target)
    if _training_project():
        for root in (project_maps, installed):
            for extension in _OUTPUTS:
                _remove(root, root / (MAP + extension))
    return _restore_story(t)


def _fingerprint():
    digest = hashlib.sha256(('tutorial-session-v2:' + getattr(settings, 'TARGET', 'revision') + ':' + settings.PACKAGE).encode('utf-8'))
    paths = sorted(p for p in SRC.iterdir() if p.suffix in ('.py', '.json'))
    paths += [KIT / name for name in ('scene.py', 'geom.py', 'activation.py', 'settings.py', 'kit.py')]
    paths += [KIT / 'editor' / name for name in ('data.py', 'textures.py', 'documents.py')]
    for path in paths:
        if path.is_file():
            digest.update(str(path.relative_to(KIT)).encode('utf-8') + b'\0' + path.read_bytes())
    return digest.hexdigest()


def _cache_folder(fingerprint):
    return _safe(KIT, KIT / 'editor' / 'cache' / '_tutorial_pristine' / fingerprint)


def _cache_manifest(folder):
    try:
        manifest = json.loads(_safe(folder, folder / 'manifest.json').read_text(encoding='utf-8'))
        files = manifest.get('files')
        if manifest.get('version') != 1 or not isinstance(files, dict) or 'output/' + MAP + '.dx' not in files:
            return None
        for relative, expected in files.items():
            if (not isinstance(relative, str) or relative.startswith('/') or '\\' in relative or ':' in relative or '..' in Path(relative).parts or
                    not (relative in {'output/' + MAP + ext for ext in _OUTPUTS} or relative.startswith('scene/'))):
                return None
            path = _safe(folder, folder / relative)
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                return None
        return manifest
    except (OSError, ValueError, TypeError):
        return None


def _copy_cached(folder, manifest):
    for relative in manifest['files']:
        target = KIT / 'out' / relative[7:] if relative.startswith('output/') else KIT / 'editor' / 'cache' / MAP / relative[6:]
        target = _safe(KIT, target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(_safe(folder, folder / relative), target)


def _snapshot(fingerprint):
    folder = _cache_folder(fingerprint)
    _remove(KIT, folder)
    folder.mkdir(parents=True)
    files = {}
    for extension in _OUTPUTS:
        source = _safe(KIT, KIT / 'out' / (MAP + extension))
        if not source.is_file():
            continue
        relative = 'output/' + source.name
        target = _safe(folder, folder / relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        files[relative] = hashlib.sha256(target.read_bytes()).hexdigest()
    (folder / 'manifest.json').write_text(json.dumps(dict(version=1, files=files), indent=1), encoding='utf-8')


def cache_scene(session):
    """Optionally remember the first clean /scene export without importing engine/data code."""
    require_session(session)
    if (KIT / 'maps' / (SCRIPT + '.edits.json')).exists():
        return False
    folder = _cache_folder(_fingerprint())
    manifest = _cache_manifest(folder)
    built = KIT / 'out' / (MAP + '.dx')
    source = KIT / 'editor' / 'cache' / MAP
    if (not manifest or not built.is_file() or not source.is_dir() or
            hashlib.sha256(built.read_bytes()).hexdigest() != manifest['files']['output/' + MAP + '.dx']):
        return False
    if any(key.startswith('scene/') for key in manifest['files']):
        return True
    for current, directories, names in os.walk(source, followlinks=False):
        for name in directories + names:
            _safe(KIT, Path(current) / name)
        for name in names:
            file = Path(current) / name
            relative = 'scene/' + file.relative_to(source).as_posix()
            target = _safe(folder, folder / relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, target)
            manifest['files'][relative] = hashlib.sha256(target.read_bytes()).hexdigest()
    (folder / 'manifest.json').write_text(json.dumps(manifest, indent=1), encoding='utf-8')
    return True


def _paths(t):
    return (KIT / 'maps' / (t['script'] + '.py'), KIT / 'maps' / (t['script'] + '.edits.json'),
            KIT / 'story' / (t['map'] + '.json'), KIT / 'out' / (t['map'] + '.dx'))


def _refresh_story(path, previous, current):
    """Update unedited stock entries; keep recruits' dialogue, edits and deletions."""
    if not path.exists():
        result = current
    else:
        result = json.loads(path.read_text(encoding='utf-8'))
        for collection in ('infolinks', 'events'):
            old = {item['id']: item for item in previous.get(collection, [])}
            live = {item['id']: item for item in result.get(collection, [])}
            for item in current.get(collection, []):
                ident = item['id']
                if ident not in old and ident not in live:
                    result.setdefault(collection, []).append(copy.deepcopy(item))
                elif ident in old and ident in live:
                    for key, value in item.items():
                        if live[ident].get(key) == old[ident].get(key):
                            live[ident][key] = copy.deepcopy(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(result, indent=1) + '\n'
    if not path.exists() or path.read_text(encoding='utf-8') != encoded:
        path.write_text(encoded, encoding='utf-8')


def start(build=None, session=None):
    """A new opening is clean. Only the active token may resume the current exercise."""
    global _ACTIVE
    t = info()
    script, _edits, story, built = _paths(t)
    if session is not None:
        require_session(session)
        return dict(t, session=_ACTIVE, fresh=False, rebuilt=False, restored=False, lines=[],
                    built=built.exists(), standalone=settings.STANDALONE, storyRuntimeChanged=False)
    _ACTIVE = None
    runtime_changed = _cleanup()
    script.parent.mkdir(parents=True, exist_ok=True)
    src = SRC / 'tutorial_map.py'
    _safe(KIT, script)
    shutil.copy2(src, script)
    fingerprint = _fingerprint()
    folder = _cache_folder(fingerprint)
    cached = _cache_manifest(folder)
    if cached:
        _copy_cached(folder, cached)
    t['lines'] = []
    t['rebuilt'] = False
    t['restored'] = bool(cached)
    if not built.exists() and build:
        ok, lines = build(t['script'])
        t['lines'] = lines
        if not ok or not built.is_file():
            raise RuntimeError('the training map was not built:\n' + '\n'.join(lines[-12:]))
        t['rebuilt'] = True
        _snapshot(fingerprint)
    _ACTIVE = secrets.token_hex(24)
    t['session'] = _ACTIVE
    t['fresh'] = True
    t['storyRuntimeChanged'] = runtime_changed
    t['built'] = built.exists()
    t['standalone'] = settings.STANDALONE
    return t


def reset(session=None):
    global _ACTIVE
    if session is not None:
        require_session(session)
    _ACTIVE = None
    return dict(ok=True, storyRuntimeChanged=_cleanup())


def end(session):
    if not _ACTIVE or not isinstance(session, str) or not secrets.compare_digest(session, _ACTIVE):
        return dict(ok=True, closed=False)
    return dict(reset(session), closed=True)


def portrait(png_data_url):
    """The guide's InfoLink portrait (DeusEdix installed only: inside UNATCO Continues the mod's own
    portraits are not touched). Returns True when it changed."""
    if not settings.STANDALONE:
        return False
    from PIL import Image
    bind = info()['guide']['bind']
    if not re.fullmatch(r'[A-Za-z_]\w*', bind):
        raise ValueError('bad bind name')
    raw = base64.b64decode(png_data_url.split(',', 1)[1])
    pkg = settings.PROJECT / 'src' / settings.PACKAGE
    folder = pkg / 'Textures' / 'Portraits'
    folder.mkdir(parents=True, exist_ok=True)
    pcx = folder / ('UCPortrait_%s.pcx' % bind)
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    small = im.resize((64, 64), Image.LANCZOS).quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    buf = io.BytesIO()
    small.save(buf, format='PCX')
    if pcx.exists() and pcx.read_bytes() == buf.getvalue():
        return False
    pcx.write_bytes(buf.getvalue())
    write_portraits_class(pkg)
    return True


HEAD = """//=============================================================================
// UCPortraits - the InfoLink portraits of the user's own characters (64x64 like the game's InfoPortraits).
// GENERATED by the map editor from Textures\\Portraits: do not edit by hand.
// UCScene.Say asks Find(bindName) after the window has taken the game's portrait (InfoPortraits.<bind name>).
//=============================================================================
class UCPortraits extends Object
	abstract;

"""
TAIL = """
static function Texture Find(string bindName)
{
	if (bindName == "")
		return None;
	return Texture(DynamicLoadObject(string(class'UCPortraits'.Outer.Name) $ ".UCPortrait_" $ bindName, class'Texture', True));
}
"""


def write_portraits_class(pkg):
    lines = ['#exec TEXTURE IMPORT NAME=UCPortrait_%s FILE=Textures\\Portraits\\UCPortrait_%s.pcx MIPS=Off' % (p.stem[11:], p.stem[11:])
             for p in sorted((pkg / 'Textures' / 'Portraits').glob('UCPortrait_*.pcx'))]
    (pkg / 'Classes' / 'UCPortraits.uc').write_text(HEAD + '\n'.join(lines) + '\n' + TAIL, encoding='latin1')
