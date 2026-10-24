"""Textures of the map editor: export the texture of a selected object (its PNG), import an edited
picture back and put it on that object (its skin slot), on a structure (the faces that had the old
texture) or on the whole map.

An imported picture becomes a texture of the map itself (package MyLevel, group Imported): PCX with 256
colours, sides a power of two, colour 0 transparent when the picture has transparency (a masked
texture, like fences). Its DrawScale keeps the world size of the texture it replaces, so walls keep
their tiling.

edits['textures'] = {name: {pcx, png, w, h, masked, scale, from}}       (files in tools/mapkit/textures/<map>/)
edits['retexture'] = [{kind: 'actor', name, slot, tex}                  an object's skin slot (MultiSkins)
                      {kind: 'actors', old, tex}                        every object of the map wearing texture old
                      {kind: 'structure', name, old, tex}               the faces of a structure with texture old
                      {kind: 'map', old, tex}]                          every face of the map with texture old

The texture editor (static/texedit.js) starts from a texture at its full size (source(): the host's
UC_TEXDUMP up to 2048 pixels, cache/_texfull) and can keep pictures in a library of its own
(textures/_library, "My textures").
"""
import base64
import io
import json
import math
import os
import re
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
ROOT = KIT / 'textures'
PF_MASKED = 2
PROJECT_FORMAT = 'deusedix-texture-project'
PROJECT_SUFFIX = '.texture.json'
MAX_TEXTURE_SIDE = 2048
MAX_TEXTURE_LAYERS = 32
MAX_LAYER_PIXELS = 32 * 1024 * 1024
MAX_PROJECT_BYTES = 192 * 1024 * 1024
_BLEND_MODES = {'source-over', 'multiply', 'screen'}


def _asset_name(value):
    """An existing texture/map file name, never a path supplied by a client."""
    if not isinstance(value, str) or not re.fullmatch(r'[\w-]{1,64}', value):
        raise ValueError('Invalid texture name.')
    # Windows reserved device names are not regular texture files.
    if re.fullmatch(r'(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])', value):
        raise ValueError('Invalid texture name.')
    return value


def _png(data_url, expected=None):
    """Decode bounded, real PNG data and discard extraneous file metadata."""
    from PIL import Image, UnidentifiedImageError
    prefix = 'data:image/png;base64,'
    if not isinstance(data_url, str) or not data_url.startswith(prefix):
        raise ValueError('Choose a PNG texture.')
    limit = MAX_TEXTURE_SIDE * MAX_TEXTURE_SIDE * 8 + 65536
    if expected:
        limit = min(limit, expected[0] * expected[1] * 8 + 65536)
    if len(data_url) > limit:
        raise ValueError('The PNG texture is too large.')
    try:
        raw = base64.b64decode(data_url[len(prefix):], validate=True)
        with Image.open(io.BytesIO(raw)) as picture:
            if picture.format != 'PNG' or getattr(picture, 'n_frames', 1) != 1:
                raise ValueError('Choose a single PNG texture.')
            if not all(1 <= n <= MAX_TEXTURE_SIDE for n in picture.size):
                raise ValueError('Editable textures must be at most 2048 × 2048 pixels.')
            if expected and picture.size != expected:
                raise ValueError('Every layer must have the texture dimensions.')
            picture.load()
            im = picture.convert('RGBA')
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
        raise ValueError('The PNG texture is damaged or unreadable.') from exc
    out = io.BytesIO()
    im.save(out, format='PNG')
    return im, out.getvalue()


def validate_document(document, expected=None):
    """An editable sidecar contains canvas pixels, never engine commands or file paths."""
    if not isinstance(document, dict) or type(document.get('version')) is not int or document.get('version') != 1:
        raise ValueError('Unsupported texture project version.')
    if document.get('format', PROJECT_FORMAT) != PROJECT_FORMAT:
        raise ValueError('This is not a DeusEdix texture project.')
    width, height = document.get('width'), document.get('height')
    if any(type(n) is not int or not 1 <= n <= MAX_TEXTURE_SIDE for n in (width, height)):
        raise ValueError('Editable textures must be at most 2048 × 2048 pixels.')
    if expected and (width, height) != expected:
        raise ValueError('The texture project and flattened PNG must have matching dimensions.')
    layers = document.get('layers')
    if not isinstance(layers, list) or not 1 <= len(layers) <= MAX_TEXTURE_LAYERS:
        raise ValueError('A texture project needs between 1 and 32 layers.')
    if not isinstance(layers[0], dict) or layers[0].get('id') != 'original':
        raise ValueError('The original texture must remain the first layer.')
    if width * height * len(layers) > MAX_LAYER_PIXELS:
        raise ValueError('The texture project exceeds the layer memory limit (128 MB).')
    clean, ids = [], set()
    for layer in layers:
        if not isinstance(layer, dict):
            raise ValueError('Invalid texture layer.')
        identity, name = layer.get('id'), layer.get('name')
        if not isinstance(identity, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', identity) or identity in ids:
            raise ValueError('Texture layers need unique identifiers.')
        if not isinstance(name, str) or not name.strip() or len(name) > 80 or any(ord(c) < 32 for c in name):
            raise ValueError('Layer names must contain 1–80 printable characters.')
        visible, locked = layer.get('visible', True), layer.get('locked', False)
        opacity, blend = layer.get('opacity', 1), layer.get('blendMode', 'source-over')
        if type(visible) is not bool or type(locked) is not bool:
            raise ValueError('Layer visibility and locking must be on or off.')
        if type(opacity) not in (int, float) or not math.isfinite(opacity) or not 0 <= opacity <= 1:
            raise ValueError('Layer opacity must be between 0 and 1.')
        if not isinstance(blend, str) or blend not in _BLEND_MODES:
            raise ValueError('Unsupported layer blend mode.')
        _, raw = _png(layer.get('png'), (width, height))
        ids.add(identity)
        clean.append(dict(id=identity, name=name, visible=visible, locked=locked, opacity=opacity,
                          blendMode=blend, png='data:image/png;base64,' + base64.b64encode(raw).decode('ascii')))
    active = document.get('activeLayerId', clean[-1]['id'])
    if not isinstance(active, str) or active not in ids:
        raise ValueError('The active texture layer does not exist.')
    return dict(format=PROJECT_FORMAT, version=1, width=width, height=height, activeLayerId=active, layers=clean)


def _document_bytes(document, expected):
    if document is None:
        return None
    clean = validate_document(document, expected)
    raw = json.dumps(clean, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    if len(raw) > MAX_PROJECT_BYTES:
        raise ValueError('The texture project is too large.')
    return raw


def _read_document(path):
    """A missing or damaged sidecar must not prevent opening the flattened texture."""
    try:
        if path.stat().st_size > MAX_PROJECT_BYTES:
            return None
        return validate_document(json.loads(path.read_text(encoding='utf-8')))
    except (OSError, ValueError, TypeError):
        return None


def _write_assets(assets):
    """Validate first; stage every file before replacing a saved texture or its layers."""
    staged, before, committed = {}, {}, []
    try:
        for path, raw in assets.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            before[path] = path.read_bytes() if path.exists() else None
            if raw is not None:
                fd, tmp = tempfile.mkstemp(prefix='.' + path.stem + '-', suffix='.tmp', dir=path.parent)
                staged[path] = Path(tmp)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(raw)
        for path, raw in assets.items():
            if raw is None:
                path.unlink(missing_ok=True)
            else:
                os.replace(staged[path], path)
            committed.append(path)
    except OSError:
        for path in reversed(committed):
            if before[path] is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(before[path])
        raise
    finally:
        for tmp in staged.values():
            tmp.unlink(missing_ok=True)


def _pow2(n):
    """The power of two nearest to n (8..1024)."""
    p = 8
    while p < 1024 and abs(p * 2 - n) <= abs(p - n):
        p *= 2
    return p


def short(name):
    return str(name or '').split('.')[-1]


def import_png(map_name, data_url, base_tex='', world=None, existing=(), document=None):
    """A picture from the browser (data URL) -> PCX + PNG in textures/<map>/. world: (w, h) in world
    units of the texture it replaces (the new one gets the DrawScale that keeps that size)."""
    from PIL import Image
    map_name = _asset_name(map_name)
    im, _ = _png(data_url)
    project = _document_bytes(document, im.size)
    w, h = _pow2(im.width), _pow2(im.height)
    if (w, h) != im.size:
        im = im.resize((w, h), Image.LANCZOS)
    alpha = im.getchannel('A')
    masked = alpha.getextrema()[0] < 128
    rgb = im.convert('RGB')
    if masked:
        pal = rgb.quantize(colors=255, method=Image.MEDIANCUT)
        idx = [i + 1 for i in pal.getdata()]
        for k, a in enumerate(alpha.getdata()):
            if a < 128:
                idx[k] = 0                       # colour 0: see-through on a masked texture
        palette = [0, 0, 0] + pal.getpalette()[:255 * 3]
        out = Image.new('P', (w, h))
        out.putpalette(palette + [0] * (768 - len(palette)))
        out.putdata(idx)
    else:
        out = rgb.quantize(colors=256, method=Image.MEDIANCUT)
    base = re.sub(r'\W', '', short(base_tex))[:20] or 'Tex'
    folder = ROOT / map_name
    _safe_path(ROOT, folder)
    n = 1
    while ('UCT_%s_%d' % (base, n) in existing or
           any((folder / ('UCT_%s_%d%s' % (base, n, ext))).exists() for ext in ('.png', '.pcx', PROJECT_SUFFIX))):
        n += 1
    name = 'UCT_%s_%d' % (base, n)
    scale = 1.0
    if world and world[0]:
        scale = round(float(world[0]) / w, 6)
        if not math.isfinite(scale) or scale <= 0:
            raise ValueError('Texture world size must be positive and finite.')
    pcx, png = io.BytesIO(), io.BytesIO()
    out.save(pcx, format='PCX')
    im.save(png, format='PNG')
    _write_assets({folder / (name + '.pcx'): pcx.getvalue(), folder / (name + '.png'): png.getvalue(),
                   folder / (name + PROJECT_SUFFIX): project})
    return dict(name=name, pcx='%s/%s.pcx' % (map_name, name), png='%s/%s.png' % (map_name, name), w=w, h=h,
                masked=masked, scale=scale, base=short(base_tex))


def ref(name):
    """How an object property refers to an imported texture."""
    return "Texture'MyLevel.Imported.%s'" % name


def import_commands(edits, run_folder):
    """Editor commands that load the imported textures into the map (the PCX copied into the run)."""
    import shutil
    cmds = []
    for name, t in sorted((edits.get('textures') or {}).items()):
        src = ROOT / t['pcx']
        if not src.exists():
            continue
        shutil.copy2(src, Path(run_folder) / 'Input' / src.name)
        cmds.append(r'TEXTURE IMPORT FILE="..\Input\%s" NAME=%s GROUP=Imported PACKAGE=MyLevel MIPS=1 FLAGS=%d'
                    % (src.name, name, PF_MASKED if t.get('masked') else 0))
        if abs(float(t.get('scale') or 1) - 1) > 1e-6:
            cmds.append('UC_OBJPROP %s DrawScale %.6f' % (name, float(t['scale'])))
    return cmds


def wearers(map_name, edits, old):
    """[(actor name, skin slot)] of every object of the map whose model wears texture old (the editor's
    last look at the map, cache/<map>/meshes.json, and the objects added since: their class's model)."""
    from data import CACHE, GAME_CACHE
    want = short(old).lower()
    out, seen = [], set()
    deleted = edits.get('deleted') or {}

    def take(name, model):
        for part in (model or {}).get('parts') or []:
            slot = part.get('slot', -1)
            if slot is not None and slot >= 0 and short(part.get('tex')).lower() == want and (name, slot) not in seen:
                seen.add((name, slot))
                out.append((name, slot))
    meshes = load_json(CACHE / map_name / 'meshes.json') if map_name else {}
    added = {a['name']: a for a in edits.get('added') or []}
    for name, m in meshes.items():
        if name not in deleted and name not in added:
            take(name, m)
    for name, a in added.items():
        take(name, load_json(GAME_CACHE / '_palette' / 'models' / (a['cls'].split('.')[-1] + '.json')))
    return out


def actor_commands(edits, map_name=None):
    """Skins of objects: MultiSkins(slot) = the imported texture (one object, or every object wearing
    the old texture)."""
    cmds = []
    textures = edits.get('textures') or {}
    for r in edits.get('retexture') or []:
        if r.get('tex') not in textures:
            continue
        if r.get('kind') == 'actor':
            cmds.append('UC_PROP %s MultiSkins(%d) %s' % (r['name'], max(0, int(r.get('slot') or 0)), ref(r['tex'])))
        elif r.get('kind') == 'actors':
            for name, slot in wearers(map_name, edits, r.get('old')):
                if re.fullmatch(r'\w+', name):
                    cmds.append('UC_PROP %s MultiSkins(%d) %s' % (name, slot, ref(r['tex'])))
    return cmds


FULL = HERE / 'cache' / '_texfull'
try:                                     # shared by the projects of the game (settings.GAME_CACHE)
    import settings as _settings
    FULL = _settings.GAME_CACHE / '_texfull'
except Exception:
    pass
LIBRARY = ROOT / '_library'


def _safe_path(folder, path):
    if not path.resolve().is_relative_to(folder.resolve()):
        raise ValueError('Texture paths must stay inside the current project.')
    return path


def source(tex, map_name, log=print):
    """A texture at its full size for the texture editor: {url, w, h, masked}. An imported texture of the
    map: its own picture; a texture of the game: read once from its package (UC_TEXDUMP, up to 2048)."""
    import kit
    from PIL import Image
    if not isinstance(tex, str) or not re.fullmatch(r'[\w.]+', tex):
        raise ValueError('not a texture: %r' % tex)
    name = short(tex)
    own = _safe_path(ROOT, ROOT / _asset_name(map_name) / (name + '.png'))
    if name.startswith('UCT_') and own.exists():
        with Image.open(own) as im:
            result = dict(url='/textures/%s/%s.png' % (map_name, name), w=im.width, h=im.height,
                          masked=im.mode == 'RGBA' and im.getchannel('A').getextrema()[0] < 128)
        document = _read_document(_safe_path(ROOT, own.with_suffix(PROJECT_SUFFIX)))
        if document:
            result['document'] = document
        return result
    out = FULL / (re.sub(r'[^\w.-]', '_', tex) + '.png')
    if not out.exists():
        FULL.mkdir(parents=True, exist_ok=True)
        s = kit.Session([], 'editor-texfull')
        try:
            s.cmd(r'UC_TEXDUMP %s ..\Output\full.raw 2048' % tex)
            raw = s.folder / 'Output' / 'full.raw'
            if not raw.exists():
                raise RuntimeError('the game has no texture %s (or its format is not readable)' % tex)
            w, h, pix = kit.texdump(raw)
        finally:
            s.close()
        Image.frombytes('RGBA', (w, h), pix).save(out)
    im = Image.open(out)
    return dict(url='/cache/_texfull/%s?v=%d' % (out.name, out.stat().st_mtime_ns), w=im.width, h=im.height,
                masked=im.getchannel('A').getextrema()[0] < 128)


def library():
    """My textures: [{name, url, w, h}]."""
    from PIL import Image
    out = []
    for f in sorted(LIBRARY.glob('*.png')) if LIBRARY.exists() else []:
        try:
            with Image.open(f) as im:
                w, h = im.size
        except OSError:
            continue
        project = f.with_suffix(PROJECT_SUFFIX)
        editable = project.is_file()
        out.append(dict(name=f.stem, url='/textures/_library/%s?v=%d' % (f.name, f.stat().st_mtime_ns), w=w, h=h,
                        editable=editable, documentUrl='/api/texture_project?name=' + f.stem if editable else None))
    return out


def library_save(name, data_url, document=None):
    if name is not None and not isinstance(name, str):
        raise ValueError('Invalid texture name.')
    name = re.sub(r'[^\w-]', '_', name or '').strip('_')[:48] or 'texture'
    _asset_name(name)
    im, png = _png(data_url)
    project = _document_bytes(document, im.size)
    _write_assets({_safe_path(LIBRARY, LIBRARY / (name + '.png')): png,
                   _safe_path(LIBRARY, LIBRARY / (name + PROJECT_SUFFIX)): project})
    return name


def library_project(name):
    """Load layers on demand, so the library listing stays small and quick."""
    name = _asset_name(name)
    return dict(document=_read_document(_safe_path(LIBRARY, LIBRARY / (name + PROJECT_SUFFIX))))


def library_delete(name):
    name = _asset_name(name)
    _write_assets({_safe_path(LIBRARY, LIBRARY / (name + '.png')): None,
                   _safe_path(LIBRARY, LIBRARY / (name + PROJECT_SUFFIX)): None})


def surface_commands(edits, structures):
    """Faces of existing maps (no rebuild: the lighting stays): UC_SURFTEX per brush."""
    cmds = []
    textures = edits.get('textures') or {}
    for r in edits.get('retexture') or []:
        if r.get('tex') not in textures:
            continue
        if r.get('kind') == 'structure':
            # the structure, and the pieces taken out of it in the editor (Un-nest)
            for name, s in structures.items():
                if name != r.get('name') and s.get('piece_of') != r.get('name'):
                    continue
                for b in s.get('brush_names') or []:
                    cmds.append('UC_SURFTEX %s %s %s' % (b, short(r['old']), r['tex']))
        elif r.get('kind') == 'map':
            cmds.append('UC_SURFTEX * %s %s' % (short(r['old']), r['tex']))
    return cmds


def _in(scene, group, name):
    """group is the structure name, or a piece taken out of it in the editor (Un-nest)."""
    if hasattr(scene, 'in_structure'):
        return scene.in_structure(group, name)
    return group == name


def scene_apply(scene, edits):
    """Map scripts: the imported textures join the scene's own (registered at their world size) and the
    faces of structures (brushes made by the script, pieces pasted from other maps) take them."""
    import geom
    textures = edits.get('textures') or {}
    if not textures:
        return []
    report = []
    for name, t in sorted(textures.items()):
        src = ROOT / t['pcx']
        if not src.exists():
            report.append('  EDIT texture %s missing (%s)' % (name, src))
            continue
        scene.texture(src, name, 'Imported', bool(t.get('masked')))
        sc = float(t.get('scale') or 1)
        geom.register(name, t['w'] * sc, t['h'] * sc)
        if abs(sc - 1) > 1e-6:
            scene.after_textures.append('UC_OBJPROP %s DrawScale %.6f' % (name, sc))
    for r in edits.get('retexture') or []:
        if r.get('tex') not in textures or r.get('kind') not in ('structure', 'map'):
            continue
        old, new = short(r['old']).lower(), r['tex']
        n = 0
        for i, (kind, brush, flags) in enumerate(scene.ops):
            if r['kind'] == 'structure' and not _in(scene, scene.op_group[i], r.get('name')):
                continue
            if any(f.mat and f.mat.tex.lower() == old for f in brush.faces):
                faces = [geom.Face(f.verts, f.mat.with_(tex=new) if f.mat and f.mat.tex.lower() == old else f.mat,
                                   f.normal, f.u, f.v, f.origin) for f in brush.faces]
                scene.ops[i] = (kind, geom.Brush(faces, brush.name, brush.wrap), flags)
                n += 1
        pat = re.compile(r'(Texture=)(?:[\w.]*\.)?%s\b' % re.escape(short(r['old'])), re.I)
        for k, block in enumerate(scene.actors):
            m = re.match(r'Begin Actor Class=\S+ Name=(\S+)', block)
            if not m or 'Begin Brush' not in block:
                continue
            if r['kind'] == 'structure' and not _in(scene, scene.actor_group.get(m.group(1)), r.get('name')):
                continue
            new_block, c = pat.subn(r'\g<1>%s' % new, block)
            if c:
                scene.actors[k] = new_block
                n += 1
        report.append('  EDIT texture %s on %s (%d brushes)' % (new, r.get('name') or 'the whole map', n))
    for line in report:
        print(line)
    return report


SIGN_FRAME = 'DrtyIronPlain_A'


def sign_mats(b, edits):
    """The faces of a sign (a block with b['sign'] = {text, style, face, tex}, editor "+ Sign"): its
    front face shows the picture of the text (an imported texture, edits['textures']) stretched over the
    whole face, its edges and back are iron. Other blocks: their one texture."""
    import geom
    tex = b.get('tex') or 'ClenGreyCncrt_A'
    s = b.get('sign') or {}
    t = (edits.get('textures') or {}).get(s.get('tex') or '')
    face = s.get('face')
    if not t or face not in ('-x', '+x', '-y', '+y'):
        return geom.Mat(tex)
    lo, hi = b['lo'], b['hi']
    geom.register(s['tex'], t['w'], t['h'])
    axis = 'xy'.index(face[1])
    other = 1 - axis                               # the face spans the other horizontal axis and Z
    width, height = hi[other] - lo[other], hi[2] - lo[2]
    # the texture's top left corner as seen from in front of the face: U runs to the viewer's right
    # (geom.mapping: u = normal x up), V downwards
    n = [0.0, 0.0, 0.0]
    n[axis] = 1.0 if face[0] == '+' else -1.0
    u = (n[1], -n[0], 0.0)                         # cross(n, (0, 0, 1))
    corner = [0.0, 0.0, hi[2]]
    corner[axis] = hi[axis] if face[0] == '+' else lo[axis]
    corner[other] = lo[other] if u[other] > 0 else hi[other]
    front = geom.Mat(s['tex'], tile=(width, height), align=tuple(corner))
    return {face: front, 'all': geom.Mat(SIGN_FRAME)}


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
