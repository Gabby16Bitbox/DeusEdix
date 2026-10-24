"""Data for the map editor: final geometry with textures, actors, asset palette, edits.

prepare(map_name) loads the last build (tools/mapkit/out/<map>.dx) in the headless SDK editor,
dumps every visible BSP polygon (UC_BSPDUMP) and exports the textures it uses as small PNGs,
into tools/mapkit/editor/cache/<map>/. Coordinates stay in Unreal units (X, Y, Z up).
"""
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
sys.path.insert(0, str(KIT))
import kit  # noqa: E402
import settings  # noqa: E402
import sizes  # noqa: E402
import t3d  # noqa: E402
import activation  # noqa: E402
import props as props_mod  # noqa: E402

CACHE = HERE / 'cache'
OUT = KIT / 'out'
# what is made from the game itself, shared by the projects of that game (settings.GAME_CACHE): these folders
# and the original maps read for the Pieces (ref_<map>)
GAME_CACHE = settings.GAME_CACHE
GAME_DIRS = ('_palette', '_objects', '_texthumbs', '_texfull', '_anims', '_gamecons', '_gamevoices', '_gamecontent', '_characters')


def is_game_cache(name):
    return name in GAME_DIRS or name.startswith('ref_')


def map_folder(map_name):
    """The cache folder of a map: an original map read for the Pieces (ref_<map>) in the shared game cache."""
    return (GAME_CACHE if str(map_name).startswith('ref_') else CACHE) / map_name


def cache_file(rel):
    """A file under /cache/ (a relative path): in the shared game cache or in the project's."""
    rel = Path(rel)
    return (GAME_CACHE if rel.parts and is_game_cache(rel.parts[0]) else CACHE) / rel


def _share_game_caches():
    """The first time a project uses the shared game cache, what it had already made from the game moves there
    (a rename on the same disk: nothing is made again). A folder the shared cache already has stays where it
    was (a duplicate, no longer read)."""
    if GAME_CACHE == CACHE or not CACHE.is_dir():
        return
    try:
        GAME_CACHE.mkdir(parents=True, exist_ok=True)
    except OSError:
        return
    old_classes = CACHE / '_palette' / 'classes.json'            # the project's own class list stays here
    if old_classes.is_file() and not (CACHE / '_classes.json').exists():
        try:
            old_classes.replace(CACHE / '_classes.json')
        except OSError:
            pass
    for p in list(CACHE.iterdir()):
        if not is_game_cache(p.name) or not p.is_dir() or p.is_symlink() or (GAME_CACHE / p.name).exists():
            continue
        own = p / 'defaults.json' if p.name == '_palette' else None    # the classes' defaults: the project's (props.py)
        keep = own.read_bytes() if own and own.is_file() else None
        try:
            p.rename(GAME_CACHE / p.name)
        except OSError:
            continue
        if keep is not None:
            p.mkdir(exist_ok=True)
            (p / 'defaults.json').write_bytes(keep)
            (GAME_CACHE / p.name / 'defaults.json').unlink(missing_ok=True)


_share_game_caches()
PF = dict(masked=2, translucent=4, modulated=64, fakebackdrop=128, twosided=256, unlit=4194304, mirror=134217728)


def _safe(name):
    return re.sub(r'[^\w.-]', '_', name)


MESH_VERSION = 11         # 10: stable brush/polygon identities for face selection
                          # counted after the special verts (they were spiky blobs)
                          # 4: the game's lighting (lightmaps of the surfaces, light on the objects)
                          # 5: the engine's brightness curve in the lighting; 6: overbright lights; 7: objects lit only by the lights that see them
                          # 8: objects at least as bright as the floor under them; 9: per-vertex light on the objects
ASSEMBLY = 4              # geometry.json only (no SDK pass): 4: exact texture frames for scale previews


def prepare(map_name, force=False, log=print, src=None, analyse=None, lite=False):
    """Geometry + textures + objects of a map (default: the last build of a map script; src: any .dx).
    The SDK editor pass is cached until the .dx changes; geometry.json (polygons split by structure)
    is put together again whenever the structures change. analyse(folder) runs in between (the
    automatic structures of existing maps). lite: no lighting and no object models (the reference
    caches of the original maps, cache/ref_<map>: the Pieces and the prefabs use only their brushes)."""
    src = Path(src) if src else OUT / (map_name + '.dx')
    if not src.exists():
        raise FileNotFoundError('no build of %s in %s' % (map_name, OUT))
    folder = map_folder(map_name)
    stamp = folder / 'stamp.txt'
    key = '%s-%d-%d-m%d' % (src, src.stat().st_mtime_ns, src.stat().st_size, MESH_VERSION)
    if force or not stamp.exists() or stamp.read_text() != key or not (folder / 'polys.json').exists():
        _dump(map_name, src, folder, log, lite)
        stamp.write_text(key)
        (folder / 'assembled.txt').unlink(missing_ok=True)
    elif not (folder / 'paths.json').exists():     # a map shown before the AI paths view existed
        _dump_paths(map_name, src, folder)
    if analyse:
        analyse(folder)
    gfile = OUT / (map_name + '.groups.json')
    akey = key + '-a%d' % ASSEMBLY + ('-%d' % gfile.stat().st_mtime_ns if gfile.exists() else '')
    done = folder / 'assembled.txt'
    if not done.exists() or done.read_text() != akey or not (folder / 'geometry.json').exists():
        _assemble(map_name, folder)
        done.write_text(akey)
    return folder


def _dump(map_name, src, folder, log, lite=False):
    """The SDK editor pass: BSP polygons, brushes, real objects, actors, textures (lite: no lighting and
    no object models, a third of the time of a big map)."""
    shutil.rmtree(folder, ignore_errors=True)
    (folder / 'tex').mkdir(parents=True)
    log('loading %s in the SDK editor' % map_name)
    s = kit.Session([src], 'editor-' + map_name)
    try:
        s.cmd(r'MAP LOAD FILE="..\Input\%s"' % src.name)
        dump = s.folder / 'Output' / 'bsp.bin'
        s.cmd(r'UC_BSPDUMP ..\Output\bsp.bin')     # relative: the project path has spaces
        s.cmd(r'UC_BRUSHES ..\Output\brushes.jsonl')
        if not lite:
            s.cmd(r'UC_MESHES ..\Output\meshes.bin')   # the real 3D models of the objects and the doors
            s.cmd(r'UC_LIGHTDUMP ..\Output\lights.bin')  # the game's lighting, for the "Lit" view
        s.cmd(r'UC_PATHS ..\Output\paths.jsonl')      # the AI's path network, for the "AI paths" view
        s.cmd(r'UC_TEXFLAGS ..\Output\texflags.jsonl')  # Only packages already needed by this map.
        scene_flags = {row['texture']: row['flags'] for row in kit.rows(s.folder / 'Output' / 'texflags.jsonl')}
        (folder / 'texflags.json').write_text(json.dumps(scene_flags), encoding='utf-8')
        write_paths(s.folder / 'Output' / 'paths.jsonl', folder)
        s.cmd(r'MAP EXPORT FILE="..\Output\scene.t3d"')
        shutil.copy2(s.folder / 'Output' / 'scene.t3d', folder / 'scene.t3d')
        brushes = parse_brushes(s.folder / 'Output' / 'brushes.jsonl')
        meshes = parse_meshes(s.folder / 'Output' / 'meshes.bin')     # {} when lite (no file)
        saved = activation.load(src)
        for name, mesh in saved.get('meshes', {}).items():
            meshes.setdefault(name, mesh)
        if saved:
            scene_file = folder / 'scene.t3d'
            scene_file.write_text(activation.editor_text(scene_file.read_text(encoding='latin1'), saved), encoding='latin1')
        polys = []
        textures = {}
        header, bsp = kit.arrays(dump)
        names, mapping, pan, vertices = header.get('textures', []), bsp.get('mapping'), bsp.get('pan'), bsp.get('vertices')
        at = 0
        for i in range(header.get('polygons', 0)):
            tex, flags = names[bsp['texture'][i]], bsp['flags'][i]
            # base 3, U 3, V 3, pan 2, tile w h
            nums = mapping[i * 11:i * 11 + 9].tolist() + [float(pan[i * 2]), float(pan[i * 2 + 1])] \
                + mapping[i * 11 + 9:i * 11 + 11].tolist()
            n = bsp['vertexCount'][i] * 3
            verts = vertices[at:at + n].tolist()
            at += n
            polys.append((tex, flags, nums, verts, bsp['brush'][i]))     # brush: the build order of its brush
            textures.setdefault(tex, (nums[11], nums[12]))
        psurf = list(bsp.get('surface', ()))       # the BSP surface of each polygon (its lightmap)
        pface = list(bsp.get('brushPoly', ()))     # the source brush polygon (survives BSP rebuilds)
        for m in meshes.values():
            for part in m['parts']:
                textures.setdefault(part['tex'], (0, 0))
        log('%d polygons, %d objects, %d textures' % (len(polys), len(meshes), len(textures)))
        tex_info = export_textures(s, textures, folder, log)
        lights = s.folder / 'Output' / 'lights.bin'
        if lights.exists():
            lightmap_atlas(lights, folder, log)
    finally:
        s.close()
    (folder / 'psurf.json').write_text(json.dumps(psurf), encoding='utf-8')
    (folder / 'pface.json').write_text(json.dumps(pface), encoding='utf-8')
    (folder / 'meshes.json').write_text(json.dumps(meshes), encoding='utf-8')
    (folder / 'textures.json').write_text(json.dumps(tex_info), encoding='utf-8')
    (folder / 'polys.json').write_text(json.dumps(polys), encoding='utf-8')
    # every brush with the box of its visible polygons (automatic structures of existing maps)
    for tex, flags, nums, verts, brush in polys:
        if 0 <= brush < len(brushes):
            b = brushes[brush]
            pts = [verts[i:i + 3] for i in range(0, len(verts), 3)]
            lo = [min(p[k] for p in pts) for k in range(3)]
            hi = [max(p[k] for p in pts) for k in range(3)]
            if b.get('lo'):
                lo = [min(a, c) for a, c in zip(b['lo'], lo)]
                hi = [max(a, c) for a, c in zip(b['hi'], hi)]
            b['lo'], b['hi'] = lo, hi
            b.setdefault('tex', {})
            t = tex.split('.')[-1]
            b['tex'][t] = b['tex'].get(t, 0) + 1
    (folder / 'brushes.json').write_text(json.dumps(brushes), encoding='utf-8')


def write_paths(dump, folder):
    """UC_PATHS -> paths.json: {points: {name: [class, x, y, z]}, links: [[start, end, flags, radius, height,
    distance], ...]} (the reach spec's room: the AI paths view draws each link as wide as that)."""
    points, links = {}, []
    for row in kit.rows(dump):
        if row['kind'] == 'point':
            points[row['name']] = [row['class']] + [float(x) for x in row['location']]
        elif row['kind'] == 'link':
            links.append([row['start'], row['end'], row['flags'], row['radius'], row['height'], row['distance']])
    (folder / 'paths.json').write_text(json.dumps(dict(points=points, links=links)), encoding='utf-8')


def _dump_paths(map_name, src, folder):
    s = kit.Session([src], 'editor-paths-' + map_name)
    try:
        s.cmd(r'MAP LOAD FILE="..\Input\%s"' % src.name)
        s.cmd(r'UC_PATHS ..\Output\paths.jsonl')
        write_paths(s.folder / 'Output' / 'paths.jsonl', folder)
    finally:
        s.close()


def _assemble(map_name, folder):
    """geometry.json: the polygons as triangles with UVs, one mesh per texture (per structure)."""
    from texture_mapping import frame
    polys = json.loads((folder / 'polys.json').read_text(encoding='utf-8'))
    tex_info = json.loads((folder / 'textures.json').read_text(encoding='utf-8'))
    brushes = json.loads((folder / 'brushes.json').read_text(encoding='utf-8'))
    # polygons of the structures the editor can move (out/<map>.groups.json) stay in their own meshes
    owner = {}
    by_name = {b['name']: b['ord'] for b in brushes}
    for name, info in structures(map_name).items():
        for i in info.get('brushes', []):
            owner[i] = name
        for n in info.get('brush_names', []):
            if n in by_name:
                owner[by_name[n]] = name
    groups = {}
    lm = json.loads((folder / 'lightmap.json').read_text(encoding='utf-8')) if (folder / 'lightmap.json').exists() else None
    psurf = json.loads((folder / 'psurf.json').read_text(encoding='utf-8')) if (folder / 'psurf.json').exists() else []
    pface = json.loads((folder / 'pface.json').read_text(encoding='utf-8')) if (folder / 'pface.json').exists() else []
    faces, face_ids = [], {}
    for pi, (tex, flags, nums, verts, brush) in enumerate(polys):
        b, u, v = nums[0:3], nums[3:6], nums[6:9]
        pu, pv, tw, th = nums[9], nums[10], nums[11] or 128, nums[12] or 128
        st = owner.get(brush, '')
        key = '%s|%s|%d' % (st, tex, flags & (PF['masked'] | PF['translucent'] | PF['modulated'] | PF['unlit'] | PF['fakebackdrop']))
        g = groups.setdefault(key, dict(tex=tex, flags=flags, structure=st, pos=[], uv=[], uv2=[], faces=[], uvFrames=[]))
        face_id = -1
        if 0 <= brush < len(brushes) and pi < len(pface) and pface[pi] >= 0:
            source = (brushes[brush]['name'], pface[pi])
            if source not in face_ids:
                face_ids[source] = len(faces)
                faces.append(dict(brush=source[0], poly=source[1], tex=tex, flags=flags, structure=st, ord=brush))
            face_id = face_ids[source]
        pts = [verts[i:i + 3] for i in range(0, len(verts), 3)]
        uvs, lmuv = [], []
        rect = lm['surfs'].get(str(psurf[pi])) if lm and pi < len(psurf) else None
        aw, ah = lm['size'] if lm else (1, 1)
        for p in pts:
            d = (p[0] - b[0], p[1] - b[1], p[2] - b[2])
            du, dv = d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * v[0] + d[1] * v[1] + d[2] * v[2]
            uvs.append(((du + pu) / tw, (dv + pv) / th))
            if rect:        # lightmap lattice point -> atlas pixel centre (1 pixel of border around each map)
                x0, y0, w, h, panu, panv, us, vs = rect
                lu = min(max((du - panu) / us, 0), w - 1)
                lv = min(max((dv - panv) / vs, 0), h - 1)
                lmuv.append(((x0 + 1 + lu + 0.5) / aw, (y0 + 1 + lv + 0.5) / ah))
            else:           # no lightmap (unlit, sky...): the full-bright corner of the atlas
                lmuv.append((1.5 / aw, 1.5 / ah))
        for k in range(1, len(pts) - 1):          # triangle fan
            g['faces'].append(face_id)
            if st:
                g['uvFrames'].append(frame(nums))
            for j in (0, k, k + 1):
                g['pos'] += [round(c, 2) for c in pts[j]]
                g['uv'] += [round(uvs[j][0], 4), round(uvs[j][1], 4)]
                g['uv2'] += [round(lmuv[j][0], 5), round(lmuv[j][1], 5)]
    (folder / 'geometry.json').write_text(json.dumps(dict(textures=tex_info, groups=list(groups.values()), faces=faces,
                                                          texflags=json.loads((folder / 'texflags.json').read_text(encoding='utf-8')) if (folder / 'texflags.json').exists() else {},
                                                          lightmap='lightmap.png' if lm else None,
                                                          actorlight=(lm or {}).get('actors', {}),
                                                          lights=(lm or {}).get('lights', []),
                                                          objectlight=(lm or {}).get('objects', {}))),
                                          encoding='utf-8')


def lightmap_atlas(path, folder, log=print):
    """UC_LIGHTDUMP -> lightmap.png (every surface's lightmap packed in rows, 1 pixel of border copied from
    its edge; the corner 4x4 is full bright for unlit surfaces) + lightmap.json (where each surface is,
    its mapping, the light on each object: one colour, and the lights that reach it for per-vertex light)."""
    from PIL import Image
    header, a = kit.arrays(path)
    surfs, actors, objects = [], {}, {}
    at = 0
    for i, s in enumerate(a['surface']):      # its lightmap: w x h, mapping (pan u, pan v, scale u, scale v), rgb
        w, h = a['size'][i * 2], a['size'][i * 2 + 1]
        surfs.append((s, w, h, a['mapping'][i * 4:i * 4 + 4].tolist(), a['rgb'][at:at + w * h * 3].tobytes()))
        at += w * h * 3
    # x y z r g b radius effect dir(3) cone
    lights = [a['lights'][k:k + 12].tolist() for k in range(0, len(a['lights']), 12)]
    first = 0
    for i, name in enumerate(header['actors']):     # its light; its ambient and the lights that see it
        n = a['actorLightCount'][i]
        actors[name] = [round(x, 3) for x in a['actorLight'][i * 3:i * 3 + 3]]
        objects[name] = [round(x, 3) for x in a['actorAmbient'][i * 3:i * 3 + 3]] + [a['actorLights'][first:first + n].tolist()]
        first += n
    width = 1024
    total = sum((w + 2) * (h + 2) for _, w, h, _, _ in surfs)
    while width < 8192 and total > width * width * 0.6:
        width *= 2
    place, x, y, row = {}, 4, 0, 4
    for s, w, h, m, data in sorted(surfs, key=lambda r: -r[2]):
        if x + w + 2 > width:
            x, y, row = 0, y + row, 0
        place[s] = (x, y)
        x += w + 2
        row = max(row, h + 2)
    height = 1
    while height < y + row:
        height *= 2
    atlas = Image.new('RGB', (width, height), (0, 0, 0))
    atlas.paste((128, 128, 128), (0, 0, 4, 4))
    rects = {}
    for s, w, h, m, data in surfs:
        x0, y0 = place[s]
        img = Image.frombytes('RGB', (w, h), data)
        for dx, dy in ((0, 1), (2, 1), (1, 0), (1, 2), (0, 0), (2, 0), (0, 2), (2, 2), (1, 1)):
            atlas.paste(img, (x0 + dx, y0 + dy))
        rects[str(s)] = [x0, y0, w, h] + m
    atlas.save(folder / 'lightmap.png')
    (folder / 'lightmap.json').write_text(json.dumps(dict(size=[width, height], surfs=rects, actors=actors,
                                                          lights=lights, objects=objects)), encoding='utf-8')
    log('lighting: %d lightmaps in a %dx%d atlas, light on %d objects' % (len(rects), width, height, len(actors)))


def _game_loads():
    """OBJ LOAD of the game's own packages for the maps (Revision's mission scripts; none for the original game)."""
    return ['OBJ LOAD FILE="%s"' % p for p in settings.GAME_LOADS]


GAME_TEXTURE_DIRS = tuple(settings.TEXTURE_DIRS[:1] + settings.TEXTURE_DIRS[-1:]) if settings.IS_REVISION \
    else tuple(settings.TEXTURE_DIRS)


def texture_flags(log=print):
    """{texture path: PolyFlags} of every texture of the game that has some (cache/_texflags.json, made
    once): the renderer adds them to the flags of the surfaces (fences, grates and leaves are masked by
    their texture, not by the surface), so the editor does too."""
    path = CACHE / '_texflags.json'
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    packages = sorted({p.stem for d in GAME_TEXTURE_DIRS if d.exists() for p in d.glob('*.utx')})
    log('reading the flags of the textures of %d packages (once)...' % len(packages))
    out = {}
    s = kit.Session([], 'editor-texflags')
    try:
        for pkg in packages:
            try:
                s.batch(['OBJ LOAD FILE="%s.utx"' % pkg, r'UC_TEXFLAGS ..\Output\texflags.jsonl'], timeout=600)
            except (RuntimeError, OSError) as e:   # a package that crashes the editor: skipped, a new session
                log('texture package %s skipped: %s' % (pkg, str(e)[:120]))
                try:
                    s.close()
                except Exception:
                    pass
                s = kit.Session([], 'editor-texflags')
                continue
            for row in kit.rows(s.folder / 'Output' / 'texflags.jsonl'):
                out[row['texture']] = row['flags']
    finally:
        s.close()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out), encoding='utf-8')
    log('texture flags: %d textures' % len(out))
    return out


def export_textures(session, textures, folder, log=print):
    """Textures (full package paths) as PNGs of at most 256 pixels in folder/tex."""
    bmp_dir = session.folder / 'Output' / 'tex'
    bmp_dir.mkdir(exist_ok=True)
    (folder / 'tex').mkdir(parents=True, exist_ok=True)
    cmds = [r'OBJ EXPORT TYPE=Texture NAME=%s FILE="..\Output\tex\%s.bmp"' % (tex, _safe(tex))
            for tex in textures if tex != 'none']
    try:
        session.batch(cmds, timeout=1800)
    except RuntimeError as e:      # a texture that cannot be exported keeps a flat colour
        log('some textures were not exported: %s' % str(e)[:200])
    # compressed (DXT1) and true-colour textures come out of OBJ EXPORT as empty files: decoded by the host
    def empty(tex):
        f = bmp_dir / (_safe(tex) + '.bmp')
        return not f.exists() or f.stat().st_size == 0
    raw = [tex for tex in textures if tex != 'none' and empty(tex)]
    if raw:
        try:
            session.batch([r'UC_TEXDUMP %s ..\Output\tex\%s.raw' % (tex, _safe(tex)) for tex in raw], timeout=600)
        except RuntimeError as e:
            log('some textures were not decoded: %s' % str(e)[:200])
    from PIL import Image
    tex_info = {}
    for tex, (w, h) in textures.items():
        bmp = bmp_dir / (_safe(tex) + '.bmp')
        rawf = bmp_dir / (_safe(tex) + '.raw')
        png = None
        if rawf.exists():
            data_ = rawf.read_bytes()
            head, _, pix = data_.partition(b'\n')    # a JSON line {width, height}, then the RGBA pixels
            try:
                size = json.loads(head)
                rw, rh = int(size['width']), int(size['height'])
            except (ValueError, KeyError, TypeError):
                rw = rh = 0
            if rw and rh:
                if len(pix) >= rw * rh * 4:
                    im = Image.frombytes('RGBA', (rw, rh), pix[:rw * rh * 4])
                    if max(im.size) > 256:
                        k = 256.0 / max(im.size)
                        im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
                    png = 'tex/%s.png' % _safe(tex)
                    im.save(folder / png)
        if png is None and bmp.exists() and bmp.stat().st_size:
            try:
                im = Image.open(bmp)
                if im.mode == 'P' and 'transparency' not in im.info:
                    # masked textures use palette index 0 as transparent
                    im.info['transparency'] = 0
                im = im.convert('RGBA')
                if max(im.size) > 256:
                    k = 256.0 / max(im.size)
                    im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))))
                png = 'tex/%s.png' % _safe(tex)
                im.save(folder / png)
            except OSError:
                png = None
        tex_info[tex] = dict(png=png, w=w, h=h)
    return tex_info


def parse_brushes(path):
    """UC_BRUSHES output -> [{ord, name, csg (1 add, 2 subtract), flags, group, loc, rot, prepivot}]."""
    return [dict(ord=r['ord'], name=r['name'], csg=r['csg'], flags=r['flags'], group=r['group'],
                 loc=[float(x) for x in r['location']], rot=r['rotation'], prepivot=[float(x) for x in r['prePivot']])
            for r in kit.rows(path)]


STY = {2: PF['masked'], 3: PF['translucent'], 4: PF['modulated']}
HIDDEN_TEX = ('pinkmasktex', 'graymasktex', 'blackmasktex')   # parts the game never draws (masks)


def parse_meshes(path):
    """UC_MESHES output -> {actor: {cls, kind, parts: [{tex, flags, pos, uv}]}} (coordinates relative
    to the actor, unrotated, Unreal axes)."""
    header, a = kit.arrays(path)
    names = header.get('textures', [])
    out, first = {}, 0
    for row in header.get('actors', []):            # its triangles follow the previous actor's
        style = STY.get(row['style'], 0)
        parts = {}
        for t in range(first, first + row['triangles']):
            tex, flags = names[a['texture'][t]], a['flags'][t] | style
            if flags & 1 or tex.split('.')[-1].lower() in HIDDEN_TEX:
                continue
            slot = a['slot'][t]                 # MultiSkins index of the face (-1: a mover's)
            key = '%s|%d|%d' % (tex, flags & (PF['masked'] | PF['translucent'] | PF['modulated'] | PF['unlit']), slot)
            part = parts.setdefault(key, dict(tex=tex, flags=flags, slot=slot, pos=[], uv=[]))
            nums = a['corners'][t * 15:t * 15 + 15].tolist()      # x y z u v of each corner
            for k in range(3):
                part['pos'] += nums[k * 5:k * 5 + 3]
                part['uv'] += nums[k * 5 + 3:k * 5 + 5]
        first += row['triangles']
        out[row['actor']] = dict(cls=row['class'], kind=row['kind'], parts=list(parts.values()))
    return out


def palette_meshes(log=print):
    """Real 3D models of every class in the palette (cache/_palette), made once (in chunks: a class that
    cannot be placed in an empty map does not stop the others)."""
    folder = GAME_CACHE / '_palette'
    classes = sorted({it['cls'] for c in palette() for it in c['items'] if it['cls'] not in NO_MODEL and not it.get('nomodel')})
    done = folder / 'meshes.json'
    cached = {}
    if done.exists():
        cached = json.loads(done.read_text(encoding='utf-8'))
        if cached.get('_version') != MESH_VERSION:         # older models without the skin slots: made again
            cached = {}
        if all(c in cached for c in classes):
            if not (folder / 'index.json').exists():
                _publish_palette(folder, cached)
            return cached
    todo = [c for c in classes if c not in cached]
    folder.mkdir(parents=True, exist_ok=True)
    meshes = {k: v for k, v in cached.items() if not k.startswith('_')}
    tex_info = dict(cached.get('_textures', {}))
    s = kit.Session([], 'editor-palette')
    try:
        s.batch(['MAP NEW', 'OBJ LOAD FILE="%s.u"' % settings.PACKAGE] + _game_loads())
        for k in range(0, len(todo), 60):
            chunk = todo[k:k + 60]
            body = ''.join('Begin Actor Class=%s Name=P%d_%d\n    Location=(X=%d,Y=%d,Z=0)\nEnd Actor\n'
                           % (c, k, i, (i % 8) * 600 - 2400, (i // 8) * 600 - 2400) for i, c in enumerate(chunk))
            (s.folder / 'T3D' / 'palette.t3d').write_text('Begin Map\n' + body + 'End Map\n', encoding='ascii')
            try:
                s.batch(['MAP NEW', r'MAP IMPORTADD FILE="..\T3D\palette.t3d"', r'UC_MESHES ..\Output\meshes.bin'])
            except RuntimeError as e:
                log('palette chunk %d: %s' % (k, str(e)[:160]))
                s.close()                # a crashed editor stays broken: start a new one
                s = kit.Session([], 'editor-palette')
                s.batch(['MAP NEW', 'OBJ LOAD FILE="%s.u"' % settings.PACKAGE] + _game_loads())
                continue
            for name, m in parse_meshes(s.folder / 'Output' / 'meshes.bin').items():
                meshes.setdefault(m['cls'], m)
        textures = {p['tex']: (0, 0) for m in meshes.values() if m for p in m['parts'] if p['tex'] not in tex_info}
        if textures:
            tex_info.update(export_textures(s, textures, folder, log))
    finally:
        s.close()
    result = dict(meshes, _textures=tex_info, _version=MESH_VERSION)
    for c in classes:
        result.setdefault(c, None)
    done.write_text(json.dumps(result), encoding='utf-8')
    _publish_palette(folder, result)
    return result


def _publish_palette(folder, result):
    """For the browser: index.json (classes with a model, textures) and one small file per model,
    loaded when an object of that class is shown (all of them together are tens of MB)."""
    models = folder / 'models'
    models.mkdir(exist_ok=True)
    have = []
    for cls, m in result.items():
        if cls.startswith('_') or not isinstance(m, dict):
            continue
        (models / (cls + '.json')).write_text(json.dumps(m), encoding='utf-8')
        have.append(cls)
    (folder / 'index.json').write_text(json.dumps(dict(classes=sorted(have), _textures=result.get('_textures', {}))),
                                       encoding='utf-8')


def structures(map_name):
    """Structures of the last build (Scene.structures): brushes, actors, pivot, placement."""
    p = OUT / (map_name + '.groups.json')
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except ValueError:
        return {}


EDITABLE_SKIP = ('Brush', 'LevelInfo', 'DeusExLevelInfo', 'ZoneInfo', 'SkyZoneInfo', 'Camera', 'InterpolationPoint',
                 'UCLink', 'UCLinkGroup', 'UCLightMemory', 'UCObjectTag')     # the interactions: made again from the edits at every build (links.py)


def object_tags(map_name):
    import object_tags as scripting_tags
    path = map_folder(map_name) / 'scene.t3d'
    if not path.exists():path = OUT / (map_name + '.t3d')
    return scripting_tags.from_text(path.read_text(encoding='latin1', errors='replace')) if path.exists() else {}


def actors(map_name):
    """Actors of the map shown in the editor with position, rotation, collision size and a category."""
    path = map_folder(map_name) / 'scene.t3d'
    if not path.exists():
        path = OUT / (map_name + '.t3d')
    text = path.read_text(encoding='latin1', errors='replace')
    out = []
    cache = sizes.load()
    try:
        by_cls = {c['cls']: c for c in catalog(log=lambda *a: None)}
    except Exception:
        by_cls = {}
    # the conversation name a character has in the game: the map's, else its class's (ScientistFemale has
    # "ScientistFemale"): the Story writes its lines for that name, or they bind to nobody and the dialogue stops
    try:
        class_defaults = props_mod.defaults(log=lambda *a: None).get('classes', {})
    except Exception:
        class_defaults = {}

    tree = props_mod.tree_of(class_defaults)

    def bind_of(cls, p):
        own = p.get('BindName', '').strip('"')
        if own:
            return own
        return (((class_defaults.get(cls) or {}).get('props') or {}).get('BindName') or [''])[0].strip('"')
    for a in t3d.actors(text):
        cls = a['cls']
        # Unreal omits default Location=(0,0,0) from exports. Ordinary editable objects at the
        # origin still need a row, including after re-enabling them; hidden runtime helpers do not.
        if cls in EDITABLE_SKIP or ('Location' not in a['props'] and cls not in by_cls
                                   and cls not in NO_MODEL and 'Mover' not in cls):
            continue
        p = a['props']
        loc = t3d.vec(p.get('Location'))
        rot = t3d.rot(p.get('Rotation', ''))
        r, h = cache.get(cls, [16.0, 16.0]) or [16.0, 16.0]
        kind = tree.kind(cls)                   # by its parents: a TrafficLight is a decoration, a Beam a light
        light = None
        if kind == 'light':
            light = dict(b=int(p.get('LightBrightness', 64) or 64), hue=int(p.get('LightHue', 0) or 0),
                         sat=int(p.get('LightSaturation', 255) or 255), radius=int(p.get('LightRadius', 64) or 64))
        cat = (by_cls.get(cls) or {}).get('cat', '')
        if cat == 'Characters' and kind == 'prop':
            kind = 'pawn'
        out.append(dict(name=a['name'], cls=cls, loc=list(loc), rot=list(rot), radius=r, height=h, kind=kind,
                        tag=p.get('Tag', ''), event=p.get('Event', ''), props=props_mod.t3d_props(p),
                        light=light, bind=bind_of(cls, p),
                        mesh=(by_cls.get(cls) or {}).get('mesh', ''),
                        meshDrawScale=float(p.get('DrawScale', (by_cls.get(cls) or {}).get('scale', 1.0))),
                        meshPrePivot=p.get('PrePivot', (((class_defaults.get(cls) or {}).get('props') or {}).get('PrePivot') or [''])[0]),
                        label=(by_cls.get(cls) or {}).get('name', ''),
                        talker=cat in ('Characters', 'Decorations') or cls.startswith('UCCustom')))
    return out


# How the Browser (Objects) sorts the game's classes: editor/config/palette.json, data rather than code (its "about"
# says what each list does)
PALETTE_CONFIG = json.loads((HERE / 'config' / 'palette.json').read_text(encoding='utf-8'))
FAVOURITES = {'Most used': PALETTE_CONFIG['mostUsed']}
NO_MODEL = tuple(PALETTE_CONFIG['noModel'])          # no 3D model: an icon (an effect point: its arrows)
CATEGORY = PALETTE_CONFIG['categories']
SUB = PALETTE_CONFIG['subcategories']
HOOKS = tuple(PALETTE_CONFIG['hooks'])
PALETTE_SKIP = tuple(PALETTE_CONFIG['skipClasses'])
SKIP_PREFIXES = tuple(PALETTE_CONFIG['skipClassPrefixes'])
SKIP_PARENTS = tuple(PALETTE_CONFIG['skipParents'])


def catalog(log=print):
    """Every actor class of the game and the editor's package that can be placed and has a 3D model (UC_CLASSES),
    with its English name from the game (ItemName / FamiliarName) and its collision size."""
    path = CACHE / '_classes.json'              # the project's own (its package, its other mods' packages)
    if not path.exists() and (CACHE / '_palette' / 'classes.json').exists():
        path = CACHE / '_palette' / 'classes.json'
    if path.exists():
        out = json.loads(path.read_text(encoding='utf-8'))
        # a list made with other categories (an older editor's, in Italian, or before palette.json changed) is made again
        known = set(CATEGORY.values()) | {p['name'] for p in kit.extra_packages()}
        if all(c.get('cat') in known for c in out):
            return out
    path.parent.mkdir(parents=True, exist_ok=True)
    s = kit.Session([], 'editor-classes')
    try:
        s.batch(['OBJ LOAD FILE="%s.u"' % settings.PACKAGE] + _game_loads() +
                [r'UC_CLASSES ..\Output\classes.jsonl'])
        classes = kit.rows(s.folder / 'Output' / 'classes.jsonl')
    finally:
        s.close()
    out = []
    extra = {p['name'] for p in kit.extra_packages()}       # packages of other mods (the Packages panel)
    for c in classes:
        name, pkg, flags, draw, mesh = c['class'], c['package'], c['flags'], c['drawType'], c['mesh']
        parents = c['parents']
        label = (c['itemName'] or c['familiarName']).strip().strip('"').strip()
        if name in PALETTE_SKIP or name.startswith(SKIP_PREFIXES):
            continue                     # crash the editor when placed (flock spawner, NPC-only weapons)
        chain = '/'.join(parents)
        if flags & 0x201 or any(k in chain for k in SKIP_PARENTS) and 'DeusExCarcass' not in parents:
            continue                     # abstract, not placeable in the editor, effects and projectiles
        top = next((p for p in parents if p in CATEGORY), None)
        if pkg in extra and (top is None or mesh == 'None' or draw != 2):
            # another mod's triggers, zones, logic...: under the package's name, placed as a marker
            out.append(dict(cls=name, pkg=pkg, cat=pkg, sub=parents[0] if parents else '', name=label,
                            radius=float(c['radius']), height=float(c['height']), nomodel=True))
            continue
        if mesh == 'None' or draw != 2:
            continue                     # no 3D model
        if top is None:
            continue
        below = [p for p in parents[:parents.index(top)] if p not in HOOKS]
        sub = below[-1] if below else ''
        out.append(dict(cls=name, pkg=pkg, cat=CATEGORY[top], sub=SUB.get(sub, sub), name=label,
                        radius=float(c['radius']), height=float(c['height']), mesh=mesh, scale=float(c['drawScale'])))
    out.sort(key=lambda c: (c['cat'], c['sub'], c['name'] or c['cls']))
    path.write_text(json.dumps(out, indent=0), encoding='utf-8')
    # collision sizes for drop / snap in the map scripts too
    cache = sizes.load()
    cache.update({c['cls']: [c['radius'], c['height']] for c in out if c['cls'] not in cache})
    sizes.CACHE.write_text(json.dumps(cache, indent=1, sort_keys=True))
    return out


# weapons only creatures and robots use (a dog's bite, a spider bot's discharge): not things to give
NPC_ONLY = re.compile('|'.join(re.escape(name) for name in PALETTE_CONFIG['npcOnlyWeapons']))
# the game's placeholder names ("DEFAULT DECORATION NAME - REPORT THIS AS A BUG"), as app.js gameName()
PLACEHOLDER_NAME = re.compile(r'DEFAULT\s+\w+\s+NAME|REPORT THIS AS A BUG', re.I)


def items():
    """What can be given or carried: weapons, ammo and pickups of the game and the editor's package (Pkg.Class).
    Not the game's own stand-ins named 'DEFAULT AMMO NAME - REPORT THIS AS A BUG' (AmmoNone: the ammo of what
    shoots nothing, 24 Oct 2026)."""
    return [dict(cls='%s.%s' % (c['pkg'], c['cls']), name=c['name'], cat=c['cat'])
            for c in catalog(log=lambda *a: None)
            if c['cat'] in ('Weapons', 'Ammo', 'Pickups') and c['name'] and not NPC_ONLY.search(c['cls'])
            and not PLACEHOLDER_NAME.search(c['name'])]


ORDER = ['Most used', 'Level', 'Triggers', 'AI', 'Sounds', 'Zones', 'Decorations', 'Pickups', 'Weapons', 'Ammo', 'Characters', 'Bodies', 'Lights']


def palette():
    """Categories of the palette: the most used first, then every class of the game."""
    cat = catalog()
    by_cls = {c['cls']: c for c in cat}
    groups = {}
    for c in cat:
        groups.setdefault(c['cat'], []).append(dict(cls=c['cls'], radius=c['radius'], height=c['height'],
                                                    name=c['name'], sub=c['sub'], mesh=c.get('mesh', ''), meshDrawScale=c.get('scale', 1.0),
                                                    **({'nomodel': True} if c.get('nomodel') else {})))
    fav = []
    for c in FAVOURITES['Most used']:
        if c in NO_MODEL:
            fav.append(dict(cls=c, radius=8, height=8, name='', sub=''))
        elif c in by_cls:
            b = by_cls[c]
            fav.append(dict(cls=c, radius=b['radius'], height=b['height'], name=b['name'], sub=''))
    groups['Most used'] = fav
    groups['Lights'] = [dict(cls='Light', radius=8, height=8, name='', sub=''),
                      dict(cls='Spotlight', radius=8, height=8, name='', sub='')]
    # the ways in and out of the map (Links): an exit to another map, an arrival point, the start
    groups['Level'] = [dict(cls='Teleporter', radius=40, height=64, name='Map exit (to another map)', sub='',
                            preset={'URL': '""', 'CollisionRadius': '40.000000', 'CollisionHeight': '64.000000'}),
                       dict(cls='Teleporter', radius=16, height=40, name='Arrival point', sub='',
                            preset={'bEnabled': 'False', 'Tag': 'Arrival'}),
                       dict(cls='PlayerStart', radius=18, height=40, name='Player start', sub='')]
    # the AI's points: the path network the characters walk on (PATHS DEFINE at Rebuild), patrols, wandering
    groups['Sounds'] = [dict(cls='AmbientSound', radius=12, height=12, name='Ambient sound (over and over: rain, a hum, wind)', sub=''),
                        dict(cls='UCSoundFX', radius=64, height=64, name='Sound effect: when JC walks in (a sound zone)', sub='',
                             preset={'bOnTouch': 'True'}),
                        dict(cls='UCSoundFX', radius=16, height=16, name='Sound effect: when triggered (by a door, a button, a keypad...)', sub='',
                             preset={'bOnTouch': 'False', 'Tag': 'SoundFX'}),
                        dict(cls='Trigger', radius=64, height=64, name='Trigger (when JC walks in, it triggers its Event)', sub='',
                             preset={'CollisionRadius': '64.000000', 'CollisionHeight': '64.000000'})]
    # zones: a closed area (walls and zone portals, or the water of a pool) with its own light, sound, damage...
    groups['Zones'] = [dict(cls='ZoneInfo', radius=16, height=16, name='Zone: light, sound, damage, gravity of a closed area (+ Portal in its doorways)', sub='')]
    if 'weather' in settings.FEATURES:          # Revision's rain and snow (Precipitation): not in the original game
        groups['Zones'] += [dict(cls='PrecipitationZone', radius=16, height=16, name='Rain zone (outdoors: rain round JC in the whole zone)', sub='',
                                 preset={'PrecipClass': "Class'Revision.RevRaindrop'", 'PrecipDensity': '6', 'bSlanty': 'False'}),
                            dict(cls='SnowZone', radius=16, height=16, name='Snow zone (snow round JC in the whole zone)', sub='')]
    groups['Zones'] += [dict(cls='WaterZone', radius=16, height=16, name='Water zone (inside closed water: + Water makes a whole pool)', sub=''),
                       dict(cls='SkyZoneInfo', radius=16, height=16, name='Sky zone (inside a sky box: what the sky surfaces show)', sub='')]
    # triggers: a collision box (when JC walks in / out; solid: an invisible wall), a trigger (a cylinder)
    groups['Triggers'] = [dict(cls='UCTriggerBox', radius=64, height=64, name='Collision box (JC walks in or out: an event; solid: an invisible wall)', sub='',
                               preset={'BoxX': '64.000000', 'BoxY': '64.000000', 'BoxZ': '64.000000'}),
                          dict(cls='Trigger', radius=64, height=64, name='Trigger (a cylinder: when JC walks in)', sub='',
                               preset={'CollisionRadius': '64.000000', 'CollisionHeight': '64.000000'}),
                          dict(cls='UCCutscene', radius=16, height=16, name='Cutscene camera (a camera path on a timeline: a cutscene)', sub=''),
                          dict(cls='UCTimer', radius=16, height=16, name='Timer (counts down, on the HUD if it has a label; when it runs out: an interaction)', sub='',
                               preset={'Seconds': '30.000000', 'HUDLabel': '"Time left"'}),
                          dict(cls='UCEffectPoint', radius=8, height=8, name='Effect point (where an effect of an interaction goes; its big arrow is the way mist, smoke, sparks or fire blow)', sub='')]
    groups['AI'] = [dict(cls='PathNode', radius=12, height=14.5, name='Path node (where characters can walk)', sub=''),
                    dict(cls='PatrolPoint', radius=12, height=14.5, name='Patrol point (see Patrol route of a character)', sub=''),
                    dict(cls='WanderPoint', radius=12, height=14.5, name='Wander point (wandering characters stop and look here)', sub=''),
                    dict(cls='HidePoint', radius=12, height=14.5, name='Hide point (where scared characters hide)', sub='')]
    return [dict(category=k, items=groups[k]) for k in ORDER if k in groups] + \
           [dict(category=k, items=v) for k, v in groups.items() if k not in ORDER]


