"""3D models in the map editor (the Models tab of the browser).

- Every model the game can load: the game's, Revision's, HDTP's, the packages of other mods (Packages
  panel) and the mod's own UCModels (host UC_MESHLIST, cache/_models/list.json). The models of a package
  are exported for the browser the first time it is opened (UC_MESHES on one UCMeshDeco per mesh:
  cache/_models/<package>/).
- A model is placed as a UCMeshDeco of the mod (src/UnatcoContinues/Classes/UCMeshDeco.uc): its Mesh, a
  collision cylinder around it and a PrePivot that centres it on the cylinder.
- Import: a model from a file (OBJ, FBX, glTF/GLB: read in the browser by three.js, sent here as triangles,
  UVs and pictures) becomes a mesh of the mod's package UCModels, made by Deus Ex's own mesh importer
  (host UC_MESHIMPORT = UEditorEngine::meshImport, 16-bit vertices) and TEXTURE IMPORT. The sources stay in
  tools/mapkit/models/<name>/; UCModels.u is made again from all of them, in dist\\ and, when the game is
  closed, in the game (else at the next Install).
- Animated models (Gabby, 20 Oct 2026): a file with a skeleton or shape keys and animations (glTF/GLB, FBX,
  DAE) is played in the browser and every chosen clip baked into frames of positions, as the game keeps its
  own animations (a vertex mesh has no bones): frames.bin (float32, the frames one after the other, in
  Unreal's axes and units) next to model.json, whose `sequences` [{name, start, count, rate}] become the mesh's
  sequences (MESH SEQUENCE); `idle` is the one a placed model (UCMeshDeco.IdleAnim) loops in the game.
"""
import base64
import hashlib
import io
import json
import os
import re
import shutil
import struct
import tempfile
from pathlib import Path

import kit
import settings
import data
import packages

HERE = Path(__file__).resolve().parent
CACHE = HERE / 'cache' / '_models'
SOURCES = HERE.parent / 'models'
PACKAGE = settings.MODELS_PACKAGE
DIST = kit.PROJECT / 'dist' / (PACKAGE + '.u')
MAX_TRIS = 30000
MAX_VERTICES = 8191  # _a.3d's uint16 frame-size header holds eight bytes per vertex.
MAX_MATERIALS = 8
MAX_FRAMES = 4000
MAX_FRAME_VERTICES = 3000000   # frames x vertices: 24 MB of _a.3d at most
LIST_VERSION = 2
# loaded by every run from its own System folder (dist\): not again from the game's copy
OWN = (settings.PACKAGE, 'UnatcoVoices', settings.ANIMS_PACKAGE, PACKAGE)
SKIP = ('Core', 'Editor', 'IpDrv', 'IpServer', 'UWindow', 'UBrowser', 'Fire', 'DXOgg', 'RF', 'ConSys', 'Extension')
MESH_REF = re.compile(r"(\w+)'(\w+)\.([\w.]+)'")


def _safe(s):
    return re.sub(r'[^\w.-]', '_', str(s))


def _mtime(f):
    try:
        return int(Path(f).stat().st_mtime)
    except OSError:
        return 0


def mesh_packages():
    """{name: .u file} of the packages that can hold models."""
    out = {}
    for n, d in packages.found().items():
        if packages.NOISE.search(n) or n in SKIP or n in OWN:
            continue
        out[n] = str(Path(d) / (n + '.u'))
    for p in kit.extra_packages():
        if p.get('path'):
            out[p['name']] = p['path']
    if DIST.exists():
        out[PACKAGE] = str(DIST)
    return out


def _load_cmd(name, files):
    """OBJ LOAD of a package: by name when the engine's paths find it (the run's System folder, the
    SDK's HDTP, the game's System: its dependencies are found the same way, and a package already loaded
    is not loaded again from another file), else from its file."""
    run_paths = (kit.DEV, kit.DEV.parent / 'HDTP' / 'System', packages.GAME / 'System')
    if name in OWN or any((d / (name + '.u')).exists() for d in run_paths):
        return 'OBJ LOAD FILE="%s.u"' % name
    return kit.load_cmd(files[name])          # a long path too (another mod's package in the project)


def listing(log=print):
    """{packages: [{name, count}], meshes: [{mesh, pkg, cls, tris, frames, seqs}]}, made once per set of
    packages (a package changed or added: made again)."""
    files = mesh_packages()
    sig = hashlib.sha1(json.dumps(sorted((n, _mtime(f)) for n, f in files.items())).encode()).hexdigest()[:12]
    f = CACHE / 'list.json'
    if f.exists():
        try:
            d = json.loads(f.read_text(encoding='utf-8'))
            if d.get('sig') == sig and d.get('version') == LIST_VERSION:
                return d
        except ValueError:
            pass
    log('reading the models of %d packages (once)...' % len(files))
    CACHE.mkdir(parents=True, exist_ok=True)
    s = kit.Session([], 'editor-models')
    loaded = []
    try:
        s.batch(['MAP NEW', 'OBJ LOAD FILE="%s.u"' % settings.PACKAGE])
        for n in sorted(files):
            try:
                s.batch([_load_cmd(n, files)], timeout=600)
                loaded.append(n)
            except RuntimeError as e:
                log('models: %s not loaded (%s)' % (n, str(e)[:120]))
        s.batch([r'UC_MESHLIST ..\Output\meshlist.jsonl'])
        rows = kit.rows(s.folder / 'Output' / 'meshlist.jsonl')
    finally:
        s.close()
    meshes = [dict(mesh=r['mesh'], pkg=r['package'], cls=r['class'], tris=r['triangles'], frames=r['frames'], seqs=r['sequences'])
              for r in rows if r['package'] in files and r['triangles'] > 0]
    # the object of the game that uses it: its name, and the size it has there (its class's DrawScale)
    by_mesh = {}
    for c in data.catalog(log=lambda *a: None):
        if c.get('mesh') and c['mesh'] != 'None':
            by_mesh.setdefault(c['mesh'], c)
    for m in meshes:
        c = by_mesh.get(m['mesh'])
        if c:
            m.update(used=c['cls'], label=c['name'], scale=c.get('scale') or 1.0)
    meshes.sort(key=lambda m: (m['pkg'].lower(), m['mesh'].lower()))
    counts = {}
    for m in meshes:
        counts[m['pkg']] = counts.get(m['pkg'], 0) + 1
    order = sorted(counts, key=lambda n: (n != PACKAGE, n.lower()))           # the imported ones first
    d = dict(sig=sig, version=LIST_VERSION, packages=[dict(name=n, count=counts[n]) for n in order], meshes=meshes)
    f.write_text(json.dumps(d), encoding='utf-8')
    return d


def placement(model):
    """Collision cylinder and PrePivot of a model (its triangles relative to the actor, DrawScale 1):
    the cylinder goes round it whatever way it is turned, the PrePivot puts its middle at the actor."""
    lo, hi, r = [1e9] * 3, [-1e9] * 3, 0.0
    for part in model.get('parts') or []:
        pos = part['pos']
        for k in range(0, len(pos), 3):
            x, y, z = pos[k:k + 3]
            lo = [min(lo[0], x), min(lo[1], y), min(lo[2], z)]
            hi = [max(hi[0], x), max(hi[1], y), max(hi[2], z)]
            r = max(r, (x * x + y * y) ** 0.5)
    if lo[0] > hi[0]:
        return None
    return dict(lo=[round(v, 1) for v in lo], hi=[round(v, 1) for v in hi], r=round(max(1.0, r), 1),
                h=round(max(1.0, (hi[2] - lo[2]) / 2), 1), pz=round(-(hi[2] + lo[2]) / 2, 1))


def package_models(pkg, log=print):
    """The models of one package for the browser: cache/_models/<pkg>/index.json {models: {mesh: {file,
    tris, lo, hi, r, h, pz}}, textures} and one json per model (like the palette's)."""
    lst = listing(log)
    files = mesh_packages()
    if pkg not in files:
        raise ValueError('no package %s with models' % pkg)
    meshes = [m for m in lst['meshes'] if m['pkg'] == pkg]
    folder = CACHE / _safe(pkg)
    idx = folder / 'index.json'
    stamp = '%s-%d-%d' % (pkg, _mtime(files[pkg]), data.MESH_VERSION)
    if idx.exists():
        try:
            d = json.loads(idx.read_text(encoding='utf-8'))
            if d.get('stamp') == stamp:
                return d
        except ValueError:
            pass
    shutil.rmtree(folder, ignore_errors=True)
    (folder / 'models').mkdir(parents=True)
    log('exporting the %d models of %s (once)...' % (len(meshes), pkg))
    found = {}
    s = kit.Session([], 'editor-models-' + _safe(pkg)[:20])
    start = ['MAP NEW', 'OBJ LOAD FILE="%s.u"' % settings.PACKAGE, _load_cmd(pkg, files)]
    try:
        s.batch(start)
        for k in range(0, len(meshes), 50):
            chunk = meshes[k:k + 50]
            body = ''.join("Begin Actor Class=UCMeshDeco Name=UCM%d\n    Location=(X=%d,Y=%d,Z=0)\n    Mesh=%s'%s'\nEnd Actor\n"
                           % (k + i, (i % 8) * 800 - 3200, (i // 8) * 800 - 3200, m['cls'], m['mesh']) for i, m in enumerate(chunk))
            (s.folder / 'T3D' / 'models.t3d').write_text('Begin Map\n' + body + 'End Map\n', encoding='latin1')
            try:
                s.batch(['MAP NEW', r'MAP IMPORTADD FILE="..\T3D\models.t3d"', r'UC_MESHES ..\Output\meshes.bin'])
            except RuntimeError as e:
                log('models of %s, chunk %d: %s' % (pkg, k, str(e)[:160]))
                s.close()
                s = kit.Session([], 'editor-models-' + _safe(pkg)[:20])
                s.batch(start)
                continue
            for name, m in data.parse_meshes(s.folder / 'Output' / 'meshes.bin').items():
                if name.startswith('UCM') and name[3:].isdigit():
                    found[meshes[int(name[3:])]['mesh']] = m
        textures = {p['tex']: (0, 0) for m in found.values() for p in m['parts']}
        tex_info = data.export_textures(s, textures, folder, log) if textures else {}
    finally:
        s.close()
    models = {}
    for info in meshes:
        m = found.get(info['mesh'])
        place = placement(m) if m else None
        if not place:
            continue
        fname = 'models/%s.json' % _safe(info['mesh'])
        (folder / fname).write_text(json.dumps(dict(parts=m['parts'])), encoding='utf-8')
        models[info['mesh']] = dict(file=fname, cls=info['cls'], tris=info['tris'], frames=info['frames'],
                                    scale=info.get('scale', 1.0), label=info.get('label', ''), used=info.get('used', ''), **place)
    d = dict(stamp=stamp, models=models, textures=tex_info)
    idx.write_text(json.dumps(d), encoding='utf-8')
    return d


def load_commands(edits):
    """OBJ LOAD of the packages whose models the map's objects use (a Mesh in their properties)."""
    files = mesh_packages()
    used = set()
    for a in edits.get('added') or []:
        for v in (a.get('props') or {}).values():
            for m in MESH_REF.finditer(str(v)):
                if m.group(1).endswith('Mesh'):
                    used.add(m.group(2))
    for p in (edits.get('props') or {}).values():
        for m in MESH_REF.finditer(str(p.get('Mesh') or '')):
            used.add(m.group(2))
    return [_load_cmd(n, files) for n in sorted(used) if n in files or n in OWN]


# ---------------------------------------------------------------- imported models (UCModels)
def _name(s):
    s = re.sub(r'\W', '', str(s or '').strip().replace(' ', '_'))[:28]
    return s if s and not s[0].isdigit() else ('M' + s)[:28]


def imported():
    out = []
    if SOURCES.exists():
        for d in sorted(SOURCES.iterdir()):
            f = d / 'model.json'
            if f.exists():
                m = json.loads(f.read_text(encoding='utf-8'))
                out.append(dict(name=d.name, mesh='%s.UCM_%s' % (PACKAGE, d.name), tris=len(m['indices']) // 3,
                                materials=len(m['materials']), source=m.get('source', ''), frames=m.get('frames', 1),
                                sequences=[s['name'] for s in m.get('sequences', [])], idle=m.get('idle', '')))
    return out


def _frames_of(folder, m):
    """The baked frames of an animated model (floats, frame after frame), or None for a still one."""
    f = folder / 'frames.bin'
    if not m.get('sequences') or not f.exists():
        return None
    import array
    a = array.array('f')
    a.frombytes(f.read_bytes())
    return a


def _sequences(body, nv):
    """The animation clips of an import, checked: (frames as bytes or None, frame count, sequences, idle)."""
    seqs = body.get('sequences') or []
    raw = body.get('frames') or ''
    if not seqs or not raw:
        return None, 1, [], ''
    try:
        data_ = base64.b64decode(raw, validate=True)
    except ValueError as exc:
        raise ValueError('the animation data is damaged') from exc
    if not nv or len(data_) % (nv * 12):
        raise ValueError('the animation frames do not match the model (%d vertices)' % nv)
    nf = len(data_) // (nv * 12)
    if nf > MAX_FRAMES or nf * nv > MAX_FRAME_VERTICES:
        raise ValueError('too much animation: %d frames of %d vertices (at most %d frames, and %d frames x vertices)'
                         % (nf, nv, MAX_FRAMES, MAX_FRAME_VERTICES))
    out, names = [], set()
    for s in seqs:
        name = re.sub(r'\W', '', str(s.get('name') or ''))[:32]
        if not name or name[0].isdigit():
            name = ('A' + name)[:32]
        if name.lower() in names or name.lower() in ('all',):
            raise ValueError('two animations are called %s: give them different names' % name)
        start, count, rate = int(s.get('start', 0)), int(s.get('count', 0)), float(s.get('rate', 15))
        if count < 1 or start < 0 or start + count > nf or not 1 <= rate <= 120:
            raise ValueError('the animation %s does not fit its frames' % name)
        names.add(name.lower())
        out.append(dict(name=name, start=start, count=count, rate=round(rate, 3)))
    idle = re.sub(r'\W', '', str(body.get('idle') or ''))
    if idle and idle.lower() not in names:
        idle = ''
    return data_, nf, out, idle


def _pcx(png_bytes, color, out_path, max_size=512):
    """A picture (or a plain colour) as an 8-bit PCX for TEXTURE IMPORT: power of two sides, colour 0
    see-through when it has transparent parts (a masked texture). Returns masked."""
    from PIL import Image
    if png_bytes:
        im = Image.open(io.BytesIO(png_bytes)).convert('RGBA')
    else:
        c = tuple(int(max(0, min(255, round(float(x) * 255)))) for x in (color or [0.7, 0.7, 0.7])[:3])
        im = Image.new('RGBA', (16, 16), c + (255,))

    def pow2(n):
        p = 8
        while p < max_size and p * 2 <= max(8, n) * 1.5:
            p *= 2
        return p
    w, h = pow2(im.width), pow2(im.height)
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
                idx[k] = 0
        palette = [0, 0, 0] + pal.getpalette()[:255 * 3]
        out = Image.new('P', (w, h))
        out.putpalette(palette + [0] * (768 - len(palette)))
        out.putdata(idx)
    else:
        out = rgb.quantize(colors=256, method=Image.MEDIANCUT)
    out.save(out_path, format='PCX')
    return masked


def _write_3d(m, folder, mesh, masked, frames=None):
    """The two Unreal 3D files of a model: _d.3d (triangles: vertices, UVs, texture, kind) and _a.3d (its
    frames of Deus Ex's 16-bit vertices: one, or every baked frame of an animated model). Returns the
    MESHMAP SCALE that gives back its size in units."""
    pos, uv, idx = m['positions'], m['uvs'], m['indices']
    mats = m.get('triMaterials') or [0] * (len(idx) // 3)
    nv = len(pos) // 3
    if nv > MAX_VERTICES:
        raise ValueError('too many vertices (%d, at most %d)' % (nv, MAX_VERTICES))
    every = frames if frames is not None else pos
    big = max(max((abs(v) for v in every), default=0.0), 1e-3)
    k = 32000.0 / big
    nf = len(every) // (nv * 3)
    with open(folder / (mesh + '_a.3d'), 'wb') as f:
        f.write(struct.pack('<HH', nf, nv * 8))
        for i in range(nf * nv):
            f.write(struct.pack('<hhhh', int(round(every[i * 3] * k)), int(round(every[i * 3 + 1] * k)), int(round(every[i * 3 + 2] * k)), 0))
    with open(folder / (mesh + '_d.3d'), 'wb') as f:
        nt = len(idx) // 3
        f.write(struct.pack('<HHHH', nt, nv, 0, 0) + struct.pack('<7I', 0, 0, 0, 0, 0, 0, 0) + b'\0' * 12)
        for t in range(nt):
            a, b, c = idx[t * 3:t * 3 + 3]
            mat = max(0, min(MAX_MATERIALS - 1, int(mats[t])))
            info = m['materials'][mat] if mat < len(m['materials']) else {}
            # James' mesh kinds: 0 one-sided, 1 two-sided, 2 translucent, 3 masked (two-sided); +16 unlit. Translucent
            # unlit: a weapon's muzzle flash, black (unseen) until the game puts its flash texture there
            kind = 2 | 16 if info.get('blend') == 'translucent' else 3 if masked.get(mat) else (1 if info.get('twosided') else 0)
            uvb = []
            for j in range(3):                # UVs belong to the corners of the triangles (as in the file)
                u, w = uv[(t * 3 + j) * 2], uv[(t * 3 + j) * 2 + 1]
                uvb += [max(0, min(255, int(round(u * 255)))), max(0, min(255, int(round(w * 255))))]
            f.write(struct.pack('<3HBB6BBB', a, b, c, kind, 0, *uvb, mat, 0))
    return 1.0 / k


def _publish_package(made, destinations):
    """Stage every copy before publishing; retain usable packages on any failure."""
    staged, backups, committed, preserve = {}, {}, [], set()
    try:
        for destination in destinations:
            destination = Path(destination)
            if destination in staged:
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            fd, filename = tempfile.mkstemp(prefix='.' + destination.stem + '-', suffix='.tmp', dir=destination.parent)
            os.close(fd)
            staged[destination] = Path(filename)
            shutil.copy2(made, staged[destination])
            if destination.exists():
                fd, filename = tempfile.mkstemp(prefix='.' + destination.stem + '-backup-', suffix='.tmp', dir=destination.parent)
                os.close(fd)
                backups[destination] = Path(filename)
                shutil.copy2(destination, backups[destination])
        for destination, temporary in staged.items():
            os.replace(temporary, destination)
            committed.append(destination)
    except Exception as exc:
        recovery = []
        for destination in reversed(committed):
            try:
                if destination in backups:
                    os.replace(backups[destination], destination)
                else:
                    destination.unlink(missing_ok=True)
            except OSError as rollback_error:
                if destination in backups:
                    preserve.add(backups[destination])
                    recovery.append(str(backups[destination]))
                else:
                    recovery.append('%s (%s)' % (destination, rollback_error))
        if recovery:
            raise RuntimeError('Package update failed; recovery files retained: ' + ', '.join(recovery)) from exc
        raise
    finally:
        for temporary in [*staged.values(), *backups.values()]:
            if temporary not in preserve:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass  # A leftover staging file is safer than masking the build error.


def pack(log=print):
    """UCModels.u made again from every imported model: (ok, lines)."""
    import live
    models = [d for d in sorted(SOURCES.iterdir()) if (d / 'model.json').exists()] if SOURCES.exists() else []
    s = kit.Session([], 'editor-models-pack')
    lines = []
    try:
        inp = s.folder / 'Input'
        cmds = ['MAP NEW']
        for d in models:
            m = json.loads((d / 'model.json').read_text(encoding='utf-8'))
            mesh = 'UCM_' + d.name
            masked, texcmds = {}, []
            for i, mat in enumerate(m['materials'][:MAX_MATERIALS]):
                tex = '%s_%d' % (mesh, i)
                png = d / ('tex_%d.png' % i)
                masked[i] = _pcx(png.read_bytes() if png.exists() else None, mat.get('color'), inp / (tex + '.pcx'))
                texcmds += [r'TEXTURE IMPORT FILE="..\Input\%s.pcx" NAME=%s GROUP=Skins PACKAGE=%s MIPS=1 FLAGS=%d'
                            % (tex, tex, PACKAGE, 2 if masked[i] else 0),
                            'MESHMAP SETTEXTURE MESHMAP=%s NUM=%d TEXTURE=%s' % (mesh, i, tex)]
            # its inventory icons (Tools > Weapons): pictures of their own in the package, UCI_<model>_<kind>
            for kind in m.get('icons') or []:
                png = d / ('icon_%s.png' % kind)
                if not png.exists():
                    continue
                tex = 'UCI_%s_%s' % (d.name, kind)
                _pcx(png.read_bytes(), None, inp / (tex + '.pcx'))
                texcmds.append(r'TEXTURE IMPORT FILE="..\Input\%s.pcx" NAME=%s GROUP=Icons PACKAGE=%s MIPS=0 FLAGS=2' % (tex, tex, PACKAGE))
            frames = _frames_of(d, m)
            scale = _write_3d(m, inp, mesh, masked, frames)
            seqs = m.get('sequences') if frames is not None else []
            nf = len(frames) // len(m['positions']) if frames is not None else 1
            cmds += [r'UC_MESHIMPORT %s %s ..\Input\%s_a.3d ..\Input\%s_d.3d 0 1' % (PACKAGE, mesh, mesh, mesh),
                     'MESHMAP SCALE MESHMAP=%s X=%.8f Y=%.8f Z=%.8f' % (mesh, scale, scale, scale),
                     'MESH SEQUENCE MESH=%s SEQ=All STARTFRAME=0 NUMFRAMES=%d' % (mesh, nf)]
            if not any(s['name'].lower() == 'still' for s in seqs):
                cmds.append('MESH SEQUENCE MESH=%s SEQ=Still STARTFRAME=0 NUMFRAMES=1' % mesh)
            cmds += ['MESH SEQUENCE MESH=%s SEQ=%s STARTFRAME=%d NUMFRAMES=%d RATE=%g' % (mesh, s['name'], s['start'], s['count'], s['rate'])
                     for s in seqs]
            cmds += texcmds
        cmds.append(r'UC_SAVEPKG %s ..\Output\%s.u' % (PACKAGE, PACKAGE))
        out = s.batch(cmds, timeout=1800)
        made = s.folder / 'Output' / (PACKAGE + '.u')
        bad = [l for l in out.splitlines() if re.search(r'meshimport\|\w+\|0|Vertex error|savepkg\|.*\|0', l)]
        if bad or not made.exists():
            return False, ['%s.u was not made' % PACKAGE] + bad[:5]
        install = not live.running()
        destinations = [DIST]
        if install:
            destinations.append(settings.PACKAGES_DIR / (PACKAGE + '.u'))
            # the game reads its maps folder (UnatcoMaps, where Install puts the mod's packages) before System: a copy
            # there would hide the new one (20 Oct 2026: an imported model was not in the game), so it is replaced too
            maps = getattr(settings, 'MAPS_DIR', None)
            if maps is not None and (maps / (PACKAGE + '.u')).exists():
                destinations.append(maps / (PACKAGE + '.u'))
        _publish_package(made, destinations)
    finally:
        s.close()
    lines.append('%s.u: %d model%s (%.1f MB) in dist\\' % (PACKAGE, len(models), '' if len(models) == 1 else 's',
                                                                DIST.stat().st_size / 1e6))
    if not install:
        lines.append('The game is open: the models go in with the next Install.')
    else:
        lines.append('Installed in the game (%s).' % (settings.PACKAGES_DIR / (PACKAGE + '.u')))
    shutil.rmtree(CACHE / PACKAGE, ignore_errors=True)
    return True, lines


def import_model(body, log=print):
    """body: {name, source, positions (Unreal units, the model centred), uvs, indices, triMaterials,
    materials: [{name, color, twosided, png (data URL or '')}]}. Returns (ok, lines, mesh)."""
    name = _name(body.get('name'))
    if not name:
        raise ValueError('give the model a name')
    pos, idx = body.get('positions') or [], body.get('indices') or []
    if not idx or len(idx) % 3 or len(idx) // 3 > MAX_TRIS:
        raise ValueError('a model needs 1 to %d triangles (this one has %d)' % (MAX_TRIS, len(idx) // 3))
    if len(pos) // 3 > MAX_VERTICES:
        raise ValueError('too many vertices (%d, at most %d)' % (len(pos) // 3, MAX_VERTICES))
    mats = (body.get('materials') or [{}])[:MAX_MATERIALS]
    # Decode and convert the complete payload before touching saved model sources.
    keep, pictures = [], {}
    for i, mat in enumerate(mats):
        url = mat.get('png') or ''
        if url.startswith('data:'):
            try:
                pictures[i] = base64.b64decode(url.split(',', 1)[1], validate=True)
            except (ValueError, IndexError) as exc:
                raise ValueError('model texture data is damaged') from exc
        keep.append(dict(name=str(mat.get('name') or 'material %d' % (i + 1))[:60], color=mat.get('color'),
                         twosided=bool(mat.get('twosided'))))
        if mat.get('blend') == 'translucent':
            keep[-1]['blend'] = 'translucent'
    icons = {}
    for kind, url in (body.get('icons') or {}).items():
        if re.fullmatch(r'[a-z]{1,12}', str(kind)) and str(url).startswith('data:image/png'):
            try:
                icons[kind] = base64.b64decode(str(url).split(',', 1)[1], validate=True)
            except (ValueError, IndexError) as exc:
                raise ValueError('icon data is damaged') from exc
    uvs = body.get('uvs') or []
    if len(uvs) != len(idx) * 2:              # one UV for each corner of each triangle
        uvs = [0.0] * (len(idx) * 2)
    frames, nf, sequences, idle = _sequences(body, len(pos) // 3)
    model = dict(source=str(body.get('source') or '')[:200], positions=[round(float(v), 3) for v in pos],
                 uvs=[round(float(v), 5) for v in uvs],
                 indices=[int(v) for v in idx], triMaterials=[int(v) for v in body.get('triMaterials') or []],
                 materials=keep)
    if frames:
        model.update(frames=nf, sequences=sequences, idle=idle)
    if icons:
        model['icons'] = sorted(icons)
    serialized = json.dumps(model, allow_nan=False)
    SOURCES.parent.mkdir(parents=True, exist_ok=True)
    # Keep the backup outside SOURCES: pack() must see only the proposed version.
    temporary = Path(tempfile.mkdtemp(prefix='.model-import-', dir=SOURCES.parent))
    candidate, previous = temporary / 'candidate', temporary / 'previous'
    committed = False
    try:
        candidate.mkdir()
        for i, raw in pictures.items():
            (candidate / ('tex_%d.png' % i)).write_bytes(raw)
        for kind, raw in icons.items():
            (candidate / ('icon_%s.png' % kind)).write_bytes(raw)
        if frames:
            (candidate / 'frames.bin').write_bytes(frames)
        (candidate / 'model.json').write_text(serialized, encoding='utf-8')
        SOURCES.mkdir(exist_ok=True)
        folder = SOURCES / name
        had_previous = folder.exists()
        if had_previous:
            folder.rename(previous)
        try:
            candidate.rename(folder)
            ok, lines = pack(log)
            if not ok:
                return False, lines, None
            committed = True
            return True, lines, '%s.UCM_%s' % (PACKAGE, name)
        finally:
            if not committed:
                if folder.exists():
                    shutil.rmtree(folder)
                if had_previous:
                    previous.rename(folder)
    finally:
        # A filesystem error during rollback must not erase the only backup.
        if committed or not previous.exists():
            shutil.rmtree(temporary)


def delete_model(name):
    folder = SOURCES / _name(name)
    if not folder.exists():
        raise ValueError('no imported model %s' % name)
    temporary = Path(tempfile.mkdtemp(prefix='.model-delete-', dir=SOURCES.parent))
    previous = temporary / 'previous'
    committed = False
    try:
        folder.rename(previous)
        try:
            ok, lines = pack()
            committed = ok
            return ok, lines
        finally:
            if not committed:
                previous.rename(folder)
    finally:
        if committed or not previous.exists():
            shutil.rmtree(temporary)
